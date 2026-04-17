const whatsapp = require('./service.cjs');

console.log('Iniciando Agente IA SQL + WhatsApp...');

async function main() {
    try {
        await whatsapp.connect();
        console.log('Agente listo. Esperando mensajes...');
    } catch (error) {
        console.error('Error al iniciar:', error);
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    console.log('\nApagando...');
    await whatsapp.disconnect();
    process.exit(0);
});

main();
