@echo off
chcp 65001 >nul
echo ===========================================
echo   Reiniciando Bot de WhatsApp
echo ===========================================
echo.

echo Paso 1: Limpiando sesion anterior...
if exist "data\session\session\*" (
    rmdir /s /q "data\session\session" 2>nul
    echo    Sesion anterior eliminada.
) else (
    echo    No hay sesion previa.
)

echo.
echo Paso 2: Verificando dependencias...
call npm list whatsapp-web.js >nul 2>&1
if %errorlevel% neq 0 (
    echo    Instalando dependencias...
    call npm install
) else (
    echo    Dependencias OK.
)

echo.
echo Paso 3: Iniciando bot...
echo ===========================================
echo   INSTRUCCIONES:
echo   1. Espera a que aparezca el QR
echo   2. Abre WhatsApp en tu telefono
echo   3. Menu - Dispositivos vinculados
echo   4. Vincular dispositivo
echo   5. Escanear el QR
echo ===========================================
echo.

node whatsapp/bot.cjs

echo.
echo ===========================================
echo   Bot detenido
echo ===========================================
pause
