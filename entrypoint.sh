#!/bin/bash
echo "=== Iniciando Bot ==="

# Matar procesos viejos
pkill -9 -f chrome 2>/dev/null || true
pkill -9 -f Xvfb 2>/dev/null || true
sleep 2

# NO borrar sesión, solo locks
mkdir -p /app/data/session
rm -f /app/data/session/bot-session/SingletonLock 2>/dev/null || true

# Iniciar Xvfb
Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX > /dev/null 2>&1 &
export DISPLAY=:99
sleep 2

echo "Iniciando bot..."
exec node /app/whatsapp/bot.js
