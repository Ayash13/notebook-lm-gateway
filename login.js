const Database = require('better-sqlite3');
const crypto = require('crypto');
const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const AUTH_STATE_PATH = path.join(__dirname, 'auth-state.json');
const isWin = os.platform() === 'win32';

// Resolve database and local state paths depending on OS
const COOKIES_DB = isWin
    ? path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies')
    : path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies');

const LOCAL_STATE_PATH = isWin
    ? path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Local State')
    : null;

function getWindowsKey() {
    try {
        const dpapi = require('win-dpapi');
        const localState = JSON.parse(fs.readFileSync(LOCAL_STATE_PATH, 'utf8'));
        const encryptedKey = Buffer.from(localState.os_crypt.encrypted_key, 'base64');
        // Remove DPAPI prefix 'DPAPI' (5 bytes)
        const keyWithoutPrefix = encryptedKey.slice(5);
        return dpapi.unprotectData(keyWithoutPrefix, null, 'CurrentUser');
    } catch (e) {
        console.error("Failed to get Windows DPAPI key. Ensure win-dpapi is installed.");
        process.exit(1);
    }
}

function getMacKey() {
    try {
        const password = execSync('security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"').toString().trim();
        return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    } catch (e) {
        console.error("Failed to get macOS keychain password. Are you sure Chrome is installed and you've allowed access?");
        process.exit(1);
    }
}

const key = isWin ? getWindowsKey() : getMacKey();

function decryptMac(buf) {
    try {
        const iv = Buffer.alloc(16, 0x20);
        const encrypted = buf.slice(3);
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(false);
        let dec = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        
        // Remove PKCS7 padding
        const padLen = dec[dec.length - 1];
        if (padLen > 0 && padLen <= 16) dec = dec.slice(0, dec.length - padLen);
        
        const full = dec.toString('utf8');
        if (dec.length > 32) {
            const after32 = dec.slice(32).toString('utf8');
            if (after32.length > 0 && !/[\x00-\x08\x0e-\x1f\ufffd]/.test(after32)) return after32;
        }
        for (let i = 0; i < Math.min(48, dec.length); i++) {
            const sub = dec.slice(i).toString('utf8');
            if (sub.length > 0 && !/[\x00-\x08\x0e-\x1f\ufffd]/.test(sub)) return sub;
        }
        const stripped = full.replace(/[\x00-\x1f\ufffd]/g, '').trim();
        return stripped.length > 2 ? stripped : '';
    } catch { return ''; }
}

function decryptWin(buf) {
    try {
        // Windows Chrome uses AES-256-GCM. 
        // Format: v10 (3 bytes) + IV (12 bytes) + Ciphertext + AuthTag (16 bytes)
        const iv = buf.slice(3, 15);
        const payload = buf.slice(15, buf.length - 16);
        const authTag = buf.slice(buf.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        return decipher.update(payload, undefined, 'utf8') + decipher.final('utf8');
    } catch { return ''; }
}

function decrypt(buf) {
    if (!buf || buf.length < 4) return '';
    const prefix = buf.slice(0, 3).toString('ascii');
    if (prefix !== 'v10' && prefix !== 'v11') return buf.toString('utf8');
    return isWin ? decryptWin(buf) : decryptMac(buf);
}

function chromeTimeToUnix(t) {
    if (!t || t === 0) return -1;
    return Math.floor(t / 1000000) - 11644473600;
}

console.log('Extracting cookies from Chrome...\n');

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

fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify({ cookies, origins: [] }, null, 2));
console.log(`Extracted ${cookies.length} cookies. Saved to ${AUTH_STATE_PATH}`);
