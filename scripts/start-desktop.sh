#!/bin/bash
# Start desktop + browser for Google login

export DISPLAY=:99

# Kill existing
pkill -f "Xvfb :99" 2>/dev/null
pkill -f "fluxbox" 2>/dev/null
pkill -f "x11vnc.*:99" 2>/dev/null
pkill -f "websockify.*6080" 2>/dev/null
sleep 1

# Start X virtual framebuffer
Xvfb :99 -screen 0 1280x720x24 &
sleep 2

# Start window manager
fluxbox &
sleep 1

# Start VNC (no password, localhost only for security via SSH tunnel)
x11vnc -display :99 -nopw -listen localhost -xkb -forever -shared &
sleep 1

# Start noVNC websockify
websockify --web=/usr/share/novnc 6080 localhost:5900 &
sleep 2

# Launch Chromium to Google login
chromium-browser \
  --no-sandbox \
  --disable-gpu \
  --disable-software-rasterizer \
  --disable-dev-shm-usage \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --window-size=1280,720 \
  --window-position=0,0 \
  --app=https://accounts.google.com/signin &

echo "=========================================="
echo "Desktop ready!"
echo "VNC:     localhost:5900 (use SSH tunnel)"
echo "noVNC:   http://$(curl -s http://ifconfig.me):6080/vnc.html"
echo "=========================================="
echo ""
echo "To login to Google:"
echo "1. Open the noVNC URL above in your browser"
echo "2. Click 'Connect' (no password needed)"
echo "3. Login to Google in the browser window"
echo "4. After login, run: /tmp/notebook-lm-gateway/scripts/save-cookies.sh"
echo ""
echo "Press Ctrl+C to stop"
wait