const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const AUTH_STATE_PATH = path.join(__dirname, 'auth-state.json');
const isWin = os.platform() === 'win32';

const readline = require('readline');

const chromeUserDataDir = isWin
    ? path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data')
    : path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');

function getAvailableProfiles() {
    if (!fs.existsSync(chromeUserDataDir)) return [];
    try {
        const files = fs.readdirSync(chromeUserDataDir);
        return files.filter(file => {
            if (file !== 'Default' && !file.startsWith('Profile ')) return false;
            const cookiePath = isWin
                ? path.join(chromeUserDataDir, file, 'Network', 'Cookies')
                : path.join(chromeUserDataDir, file, 'Cookies');
            return fs.existsSync(cookiePath);
        }).sort((a, b) => {
            if (a === 'Default') return -1;
            if (b === 'Default') return 1;
            return a.localeCompare(b, undefined, { numeric: true });
        });
    } catch {
        return [];
    }
}

function askProfile(profiles) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('Available Chrome Profiles:');
        profiles.forEach((p, idx) => {
            console.log(`  [${idx + 1}] ${p}`);
        });
        console.log('');

        rl.question(`Select profile [1-${profiles.length}] (default: 1): `, (answer) => {
            rl.close();
            const num = parseInt(answer.trim(), 10);
            if (!isNaN(num) && num >= 1 && num <= profiles.length) {
                resolve(profiles[num - 1]);
            } else {
                resolve(profiles[0]);
            }
        });
    });
}

function chromeTimeToUnix(t) {
    if (!t || t === 0) return -1;
    return Math.floor(t / 1000000) - 11644473600;
}

async function main() {
    let profile = 'Default';
    const profileArg = process.argv.find(arg => arg.startsWith('--profile='));
    
    if (profileArg) {
        profile = profileArg.split('=')[1];
    } else {
        const profiles = getAvailableProfiles();
        if (profiles.length > 1) {
            profile = await askProfile(profiles);
        } else if (profiles.length === 1) {
            profile = profiles[0];
        }
    }

    const COOKIES_DB = isWin
        ? path.join(chromeUserDataDir, profile, 'Network', 'Cookies')
        : path.join(chromeUserDataDir, profile, 'Cookies');

    if (!fs.existsSync(COOKIES_DB)) {
        console.error(`Cookie database not found at:\n${COOKIES_DB}`);
        console.error(`Make sure Chrome is installed and the profile "${profile}" exists.`);
        process.exit(1);
    }

    let authMod, key;
    if (isWin) {
        authMod = require('./src/auth/win');
        key = authMod.getWindowsKey();
    } else {
        authMod = require('./src/auth/mac');
        key = authMod.getMacKey();
    }

    function decrypt(buf) {
        if (!buf || buf.length < 4) return '';
        const prefix = buf.slice(0, 3).toString('ascii');
        if (prefix !== 'v10' && prefix !== 'v11') return buf.toString('utf8');
        return isWin ? authMod.decryptWin(buf, key) : authMod.decryptMac(buf, key);
    }

    console.log(`\nExtracting cookies from Chrome (Profile: ${profile})...\n`);

    // Copy DB to a temp file on Windows to avoid "database is locked" error if Chrome is running
    let dbToRead = COOKIES_DB;
    if (isWin) {
        dbToRead = path.join(os.tmpdir(), 'chrome_cookies_copy.sqlite');
        fs.copyFileSync(COOKIES_DB, dbToRead);
    }

    const db = new Database(dbToRead, { readonly: true, fileMustExist: true });

    const rows = db.prepare(`
        SELECT host_key, name, path, encrypted_value, is_secure, is_httponly, expires_utc, samesite
        FROM cookies
        WHERE host_key LIKE '%google.com%'
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
            expires: chromeTimeToUnix(row.expires_utc)
        });
    }

    db.close();
    if (isWin && fs.existsSync(dbToRead)) {
        try { fs.unlinkSync(dbToRead); } catch {}
    }

    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify({ cookies, origins: [] }, null, 2));
    console.log(`Extracted ${cookies.length} cookies. Saved to ${AUTH_STATE_PATH}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
