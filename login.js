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
    if (prefix !== 'v10' && prefix !== 'v11' && prefix !== 'v20') return buf.toString('utf8');
    return isWin ? authMod.decryptWin(buf, key) : authMod.decryptMac(buf, key);
}

function chromeTimeToUnix(t) {
    if (!t || t === 0) return -1;
    return Math.floor(t / 1000000) - 11644473600;
}

console.log('Extracting cookies from Chrome...\n');

const userDataWin = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
const userDataMac = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');

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

let COOKIES_DB = null;
for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
        COOKIES_DB = p;
        break;
    }
}

if (!COOKIES_DB) {
    console.error(`Cookie database not found in any of the standard locations.`);
    console.error('Make sure Chrome is installed and you have browsed the web/logged in.');
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

fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify({ cookies, origins: [] }, null, 2));
console.log(`Extracted ${cookies.length} cookies. Saved to ${AUTH_STATE_PATH}`);
