const crypto = require('crypto');
const { execSync } = require('child_process');

function getMacKey() {
    try {
        const password = execSync('security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"').toString().trim();
        return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    } catch (e) {
        console.error("Failed to get macOS keychain password. Are you sure Chrome is installed and you've allowed access?");
        process.exit(1);
    }
}

function decryptMac(buf, key) {
    try {
        const iv = Buffer.alloc(16, 0x20);
        const encrypted = buf.slice(3);
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(false);
        let dec = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        
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

module.exports = { getMacKey, decryptMac };
