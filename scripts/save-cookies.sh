#!/bin/bash
# Save cookies from Chromium to auth-state.json

COOKIE_FILE="$HOME/snap/chromium/common/chromium/Default/Cookies"
AUTH_FILE="/tmp/notebook-lm-gateway/auth-state.json"

if [ ! -f "$COOKIE_FILE" ]; then
    echo "Error: Cookie file not found at $COOKIE_FILE"
    echo "Make sure you've logged in to Google first!"
    exit 1
fi

echo "Extracting cookies from Chromium..."

# Use sqlite3 to extract cookies for Google domains
sqlite3 "$COOKIE_FILE" <<EOF | python3 -c '
import json, sys, base64, struct, datetime

def chrome_decrypt(encrypted_value):
    # Chromium on Linux uses AES-256-GCM with key from Secret Service
    # For now, we just extract what we can
    return encrypted_value.hex()

cookies = []
for line in sys.stdin:
    parts = line.strip().split("|")
    if len(parts) >= 7:
        host_key, name, value, path, expires_utc, is_secure, is_httponly = parts[:7]
        
        # Convert Chrome time (microseconds since Jan 1 1601) to Unix timestamp
        if expires_utc and expires_utc != "0":
            expires = (int(expires_utc) - 11644473600000000) / 1000000
        else:
            expires = 0
        
        cookies.append({
            "name": name,
            "value": value,
            "domain": host_key,
            "path": path,
            "secure": bool(int(is_secure)),
            "httpOnly": bool(int(is_httponly)),
            "sameSite": "Lax",
            "expires": int(expires) if expires > 0 else None
        })

print(json.dumps({"cookies": cookies}, indent=2))
' > "$AUTH_FILE"

SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly FROM cookies WHERE host_key LIKE '%google.com%' OR host_key LIKE '%notebooklm.google.com%';
.quit
EOF

echo "Cookies saved to $AUTH_FILE"
echo "Restart the gateway to use new cookies: pm2 restart nlm-gateway"
