const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const AUTH_STATE_PATH = path.join(__dirname, 'auth-state.json');
const isWin = os.platform() === 'win32';

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

function chromeTimeToUnix(t) {
    if (!t || t === 0) return -1;
    return Math.floor(t / 1000000) - 11644473600;
}

console.log('Extracting cookies from Chrome...\n');

const COOKIES_DB = isWin
    ? path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies')
    : path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies');

if (!fs.existsSync(COOKIES_DB)) {
    console.error(`Cookie database not found at:\n${COOKIES_DB}`);
    console.error('Make sure Chrome is installed and you are logged into Google.');
    process.exit(1);
}

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

const authState = { cookies, origins: [] };
fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(authState, null, 2));
fs.writeFileSync(path.join(__dirname, '.env'), `AUTH_STATE=${JSON.stringify(authState)}\n`);
console.log(`Extracted ${cookies.length} cookies. Saved to ${AUTH_STATE_PATH} and updated .env`);
