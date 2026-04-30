import whatsappWeb from 'whatsapp-web.js';
const { Client, LocalAuth } = whatsappWeb;
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WhatsAppService {
    constructor() {
        this.client = null;
        this.ready = false;
    }

    async connect() {
        if (this.client) {
            console.log('Client already exists, skipping initialization');
            return;
        }

        const sessionPath = path.join(__dirname, '..', 'data', 'session');
        
        console.log(`Using session path: ${sessionPath}`);
        
        // Clean up any existing lock files
        try {
            fs.rmSync(path.join(sessionPath, 'session', 'SingletonLock'), { force: true });
            fs.rmSync(path.join(sessionPath, 'session', 'SingletonCookie'), { force: true });
            fs.rmSync(path.join(sessionPath, 'session', 'SingletonSocket'), { force: true });
        } catch (e) {
            // ignore
        }
        
        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: sessionPath
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer'
                ]
            }
        });

        this.client.on('qr', async (qr) => {
            console.log('\n=== ESCANEA EL CÓDIGO QR ===');
            console.log('Abre WhatsApp > Dispositivos vinculados > Vincular dispositivo\n');
            
            const qrPath = path.join(__dirname, '..', 'data', 'qr.png');
            await QRCode.toFile(qrPath, qr);
            console.log(`QR guardado en: ${qrPath}`);
            console.log('Abre el archivo para escanearlo con WhatsApp\n');
        });

        this.client.on('ready', () => {
            console.log('WhatsApp conectado!');
            this.ready = true;
        });

        this.client.on('message', async (msg) => {
            await this.handleMessage(msg);
        });

        this.client.on('disconnected', () => {
            console.log('WhatsApp desconectado');
            this.ready = false;
        });

        await this.client.initialize();
    }

    async handleMessage(msg) {
        if (msg.fromMe) return;

        const userMessage = msg.body;
        console.log(`Mensaje de ${msg.from}: ${userMessage}`);

        try {
            const respuesta = await this.ejecutarPython(userMessage);
            await msg.reply(respuesta);
        } catch (error) {
            console.error('Error:', error);
            await msg.reply('Lo siento, hubo un error al procesar tu consulta.');
        }
    }

    async ejecutarPython(mensaje) {
        return new Promise((resolve, reject) => {
            const proceso = spawn('python', [
                '-c',
                `
import sys
sys.path.insert(0, '.')
from src.queries.manager import load_queries_config, process_message
load_queries_config()
result = process_message('${mensaje.replace(/'/g, "\\'")}')
print(result)
                `
            ], { cwd: process.cwd() });

            let stdout = '';
            let stderr = '';

            proceso.stdout.on('data', (data) => { stdout += data.toString(); });
            proceso.stderr.on('data', (data) => { stderr += data.toString(); });

            proceso.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    console.error('Python error:', stderr);
                    reject(new Error(stderr));
                }
            });

            proceso.on('error', reject);
        });
    }

    async sendMessage(jid, message) {
        if (this.ready) {
            await this.client.sendMessage(jid, message);
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.destroy();
        }
    }
}

const whatsapp = new WhatsAppService();
export default whatsapp;

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
