const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const AUTH_STATE_PATH = path.join(__dirname, 'auth-state.json');
const isWin = os.platform() === 'win32';

const userDataWin = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
const userDataMac = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');

// --- Database extraction (works for v10/v11 cookies) ---

function extractFromDatabase() {
    let authMod, key;
    try {
        if (isWin) {
            authMod = require('./src/auth/win');
            key = authMod.getWindowsKey();
        } else {
            authMod = require('./src/auth/mac');
            key = authMod.getMacKey();
        }
    } catch {
        return [];
    }

    function decrypt(buf) {
        if (!buf || buf.length < 4) return '';
        const prefix = buf.slice(0, 3).toString('ascii');
        if (prefix !== 'v10' && prefix !== 'v11' && prefix !== 'v20') return buf.toString('utf8');
        return isWin ? authMod.decryptWin(buf, key) : authMod.decryptMac(buf, key);
    }

    function chromeTimeToUnix(t) {
        if (!t || t === 0) return -1;
        return Math.floor(t / 1000000) - 11644473600;
    }

    const possiblePaths = isWin ? [
        path.join(userDataWin, 'Default', 'Network', 'Cookies'),
        path.join(userDataWin, 'Default', 'Cookies'),
        path.join(userDataWin, 'Profile 1', 'Network', 'Cookies'),
        path.join(userDataWin, 'Profile 1', 'Cookies'),
        path.join(userDataWin, 'Profile 2', 'Network', 'Cookies'),
        path.join(userDataWin, 'Profile 2', 'Cookies')
    ] : [
        path.join(userDataMac, 'Default', 'Cookies'),
        path.join(userDataMac, 'Default', 'Network', 'Cookies'),
        path.join(userDataMac, 'Profile 1', 'Cookies'),
        path.join(userDataMac, 'Profile 1', 'Network', 'Cookies')
    ];

    let cookiesDb = null;
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) { cookiesDb = p; break; }
    }
    if (!cookiesDb) return [];

    let dbToRead = cookiesDb;
    if (isWin) {
        dbToRead = path.join(os.tmpdir(), 'chrome_cookies_copy.sqlite');
        fs.copyFileSync(cookiesDb, dbToRead);
    }

    const db = new Database(dbToRead, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`
        SELECT host_key, name, path, encrypted_value, is_secure, is_httponly, expires_utc, samesite
        FROM cookies WHERE host_key LIKE '%google.com%'
    `).all();

    const cookies = [];
    for (const row of rows) {
        const value = decrypt(row.encrypted_value);
        if (!value || !row.name) continue;
        cookies.push({
            name: row.name, value,
            domain: row.host_key, path: row.path,
            secure: !!row.is_secure, httpOnly: !!row.is_httponly,
            sameSite: row.samesite === 0 ? 'None' : row.samesite === 1 ? 'Lax' : 'Strict',
            expires: chromeTimeToUnix(row.expires_utc)
        });
    }

    db.close();
    if (isWin && fs.existsSync(dbToRead)) {
        try { fs.unlinkSync(dbToRead); } catch {}
    }
    return cookies;
}

// --- Playwright CDP extraction (works for v20 App-Bound Encryption) ---

async function extractViaPlaywright() {
    const { chromium } = require('playwright');
    const userDataDir = isWin ? userDataWin : path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');

    console.log('Launching Chrome via Playwright to extract cookies...');
    console.log('Make sure Chrome is fully closed.\n');

    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless: true,
        args: ['--disable-extensions', '--no-first-run', '--disable-gpu']
    });

    const page = context.pages()[0] || await context.newPage();
    const client = await context.newCDPSession(page);
    const { cookies: raw } = await client.send('Network.getAllCookies');
    await context.close();

    return raw
        .filter(c => c.domain.includes('google.com'))
        .map(c => ({
            name: c.name, value: c.value,
            domain: c.domain, path: c.path,
            secure: c.secure, httpOnly: c.httpOnly,
            sameSite: c.sameSite === 'None' ? 'None' : c.sameSite === 'Lax' ? 'Lax' : 'Strict',
            expires: c.expires === -1 ? -1 : Math.floor(c.expires)
        }));
}

// --- Main ---

async function main() {
    console.log('Extracting cookies from Chrome...\n');

    let cookies = extractFromDatabase();

    if (cookies.length === 0) {
        console.log('Database decryption yielded 0 cookies (Chrome v20 App-Bound Encryption).');
        console.log('Falling back to Playwright CDP extraction...\n');
        cookies = await extractViaPlaywright();
    }

    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify({ cookies, origins: [] }, null, 2));
    console.log(`\nExtracted ${cookies.length} cookies. Saved to ${AUTH_STATE_PATH}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
