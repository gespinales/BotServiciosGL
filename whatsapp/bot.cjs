const whatsapp = require('./service.cjs');

console.log('Iniciando Agente IA SQL + WhatsApp...');

// Nunca matar el proceso por una promesa rechazada: reconectar en su lugar
process.on('unhandledRejection', (reason) => {
    console.error('Promesa sin manejar:', reason);
    whatsapp.reconnect().catch(() => {});
});

process.on('uncaughtException', (err) => {
    console.error('Excepcion no capturada, se intenta reconectar:', err.message);
    whatsapp.reconnect().catch(() => {});
});

async function main() {
    await whatsapp.connect();
    console.log('Agente listo. Esperando mensajes...');
}

process.on('SIGINT', async () => {
    console.log('\nApagando...');
    await whatsapp.disconnect();
    process.exit(0);
});

(async () => {
    try {
        await main();
    } catch (error) {
        console.error('Error al iniciar, reintentando en 15s:', error);
        setTimeout(async () => {
            try { await main(); } catch (e) { console.error('Reintento fallo:', e.message); }
        }, 15000);
    }
})();