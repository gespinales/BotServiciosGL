#!/bin/bash
echo "=== Iniciando Bot ==="

# Matar procesos viejos
pkill -9 -f chrome 2>/dev/null || true
pkill -9 -f Xvfb 2>/dev/null || true
sleep 2

# NO borrar sesión, solo locks
mkdir -p /app/data/session
rm -f /app/data/session/session-botserviciosgl/Singleton* 2>/dev/null || true

# Limpiar cache HTTP de Chrome (NO toca Service Worker, IndexedDB ni
# LocalStorage = sesion). OJO: borrar el Service Worker fuerza LOGOUT
# de WhatsApp Web, por eso NO se toca.
PROF="/app/data/session/session-botserviciosgl/Default"
for D in "Cache" "Code Cache" "GPUCache" "GrShaderCache" "GraphiteDawnCache"; do
    if [ -d "$PROF/$D" ]; then
        find "$PROF/$D" -mindepth 1 -maxdepth 2 -exec rm -rf {} + 2>/dev/null || true
    fi
done
echo "Cache HTTP de Chrome limpiado (sesion intacta)"

# Iniciar Xvfb
Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX > /dev/null 2>&1 &
export DISPLAY=:99
sleep 2

echo "Iniciando bot..."
exec node /app/whatsapp/bot.cjs
