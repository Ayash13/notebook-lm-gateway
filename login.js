const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { execSync, spawn } = require('child_process');

const AUTH_STATE_PATH = path.join(__dirname, 'auth-state.json');
const isWin = os.platform() === 'win32';

function saveCookies(cookies) {
    const filtered = cookies.filter(c => c.domain.includes('google.com'));
    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify({ cookies: filtered, origins: [] }, null, 2));
    console.log(`Extracted ${filtered.length} Google cookies. Saved to ${AUTH_STATE_PATH}`);
}

if (isWin) {
    extractCookiesWindows().then(saveCookies).catch(err => {
        console.error('Failed:', err.message);
        process.exit(1);
    });
} else {
    saveCookies(extractCookiesMac());
}

// ── Windows: Use Chrome CDP to get decrypted cookies ──────────────────────────

function findChrome() {
    const candidates = [
        path.join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function isChromeRunning() {
    try {
        const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { encoding: 'utf8' });
        return out.toLowerCase().includes('chrome.exe');
    } catch { return false; }
}

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function waitForPort(port, retries = 15) {
    return new Promise((resolve, reject) => {
        let attempt = 0;
        const tryConnect = () => {
            httpGet(`http://127.0.0.1:${port}/json/version`)
                .then(resolve)
                .catch(() => {
                    if (++attempt >= retries) return reject(new Error('Chrome did not start in time'));
                    setTimeout(tryConnect, 1000);
                });
        };
        tryConnect();
    });
}

async function extractCookiesWindows() {
    const chromePath = findChrome();
    if (!chromePath) {
        throw new Error('Chrome not found. Install Google Chrome first.');
    }

    if (isChromeRunning()) {
        console.log('Chrome is running. Please close all Chrome windows first, then re-run this script.');
        process.exit(1);
    }

    const port = 9222;
    const userDataDir = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');

    console.log('Launching Chrome headless to extract cookies...');
    const chrome = spawn(chromePath, [
        '--headless=new',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--disable-gpu',
        '--disable-extensions',
    ], { stdio: 'ignore', detached: true });

    try {
        const versionJson = await waitForPort(port);
        const { webSocketDebuggerUrl } = JSON.parse(versionJson);

        const WebSocket = require('ws');
        const ws = new WebSocket(webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        const cookies = await new Promise((resolve, reject) => {
            ws.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
            ws.on('message', msg => {
                const data = JSON.parse(msg.toString());
                if (data.id === 1) {
                    if (data.error) return reject(new Error(data.error.message));
                    resolve(data.result.cookies);
                }
            });
            setTimeout(() => reject(new Error('CDP timeout')), 10000);
        });

        ws.close();

        return cookies.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite === 'None' ? 'None' : c.sameSite === 'Lax' ? 'Lax' : 'Strict',
            expires: c.expires ? Math.floor(c.expires) : -1,
        }));
    } finally {
        try { process.kill(-chrome.pid); } catch {}
        try { chrome.kill(); } catch {}
    }
}

// ── macOS: SQLite + Keychain decryption ───────────────────────────────────────

function extractCookiesMac() {
    const Database = require('better-sqlite3');
    const authMod = require('./src/auth/mac');
    const key = authMod.getMacKey();

    function decrypt(buf) {
        if (!buf || buf.length < 4) return '';
        const prefix = buf.slice(0, 3).toString('ascii');
        if (prefix !== 'v10' && prefix !== 'v11') return buf.toString('utf8');
        return authMod.decryptMac(buf, key);
    }

    function chromeTimeToUnix(t) {
        if (!t || t === 0) return -1;
        return Math.floor(t / 1000000) - 11644473600;
    }

    console.log('Extracting cookies from Chrome...\n');

    const userDataMac = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
    const possiblePaths = [
        path.join(userDataMac, 'Default', 'Cookies'),
        path.join(userDataMac, 'Default', 'Network', 'Cookies'),
        path.join(userDataMac, 'Profile 1', 'Cookies'),
        path.join(userDataMac, 'Profile 1', 'Network', 'Cookies'),
    ];

    let COOKIES_DB = null;
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) { COOKIES_DB = p; break; }
    }
    if (!COOKIES_DB) {
        console.error('Cookie database not found.');
        process.exit(1);
    }

    const db = new Database(COOKIES_DB, { readonly: true, fileMustExist: true });

    const rows = db.prepare(`
        SELECT host_key, name, path, encrypted_value, is_secure, is_httponly, expires_utc, samesite
        FROM cookies WHERE host_key LIKE '%google.com%'
    `).all();

    const cookies = [];
    for (const row of rows) {
        const value = decrypt(row.encrypted_value);
        if (!value || !row.name) continue;
        cookies.push({
            name: row.name,
            value,
            domain: row.host_key,
            path: row.path,
            secure: !!row.is_secure,
            httpOnly: !!row.is_httponly,
            sameSite: row.samesite === 0 ? 'None' : row.samesite === 1 ? 'Lax' : 'Strict',
            expires: chromeTimeToUnix(row.expires_utc),
        });
    }

    db.close();
    return cookies;
}
