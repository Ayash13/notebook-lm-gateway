const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOCAL_STATE_PATH = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Local State');

function getWindowsKey() {
    try {
        const localState = JSON.parse(fs.readFileSync(LOCAL_STATE_PATH, 'utf8'));
        const encryptedKey = Buffer.from(localState.os_crypt.encrypted_key, 'base64');
        const keyWithoutPrefix = encryptedKey.slice(5);
        
        // Use PowerShell instead of win-dpapi native addon
        // System.Security.Cryptography.ProtectedData is built into Windows
        const b64 = keyWithoutPrefix.toString('base64');
        const ps = `$b=[Convert]::FromBase64String('${b64}');` +
                   `$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser');` +
                   `[Convert]::ToBase64String($p)`;
        
        const result = execSync('powershell.exe -NoProfile -NonInteractive -Command "' + ps + '"', {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 10000
        }).trim();
        
        return Buffer.from(result, 'base64');
    } catch (e) {
        console.error("Failed to decrypt Windows Chrome key.");
        console.error("Error:", e.message);
        console.error("\nTroubleshooting:");
        console.error("1. Make sure you're running as the same user who is logged into Chrome");
        console.error("2. Chrome must be installed and you must be logged into Google");
        console.error("3. Try running: powershell -Command \"[System.Security.Cryptography.ProtectedData]::Unprotect\"");
        process.exit(1);
    }
}

function decryptWin(buf, key) {
    try {
        const iv = buf.slice(3, 15);
        const payload = buf.slice(15, buf.length - 16);
        const authTag = buf.slice(buf.length - 16);
        const crypto = require('crypto');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        return decipher.update(payload, undefined, 'utf8') + decipher.final('utf8');
    } catch { return ''; }
}

module.exports = { getWindowsKey, decryptWin };
