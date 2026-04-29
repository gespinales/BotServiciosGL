const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { spawn } = require('child_process');
const path = require('path');
const QRCode = require('qrcode');
const fs = require('fs');
const https = require('https');
const http = require('http');

class WhatsAppService {
    TIMEOUT_MINUTOS = 5;
    
    constructor() {
        this.client = null;
        this.ready = false;
        this.userState = {};
    }
    
    enviarConCodigo(msg, texto) {
        if (!msg || !msg.reply) {
            console.log(texto);
            return;
        }
        return msg.reply("```\n" + texto + "\n```");
    }
    
    verificarTimeout(from) {
        const estado = this.userState[from];
        if (!estado || !estado.ultimaActividad) return false;
        
        const ahora = Date.now();
        const diferencia = (ahora - estado.ultimaActividad) / 1000 / 60;
        
        if (diferencia >= this.TIMEOUT_MINUTOS) {
            console.log(`[${new Date().toLocaleTimeString()}] Session expired for ${from}`);
            delete this.userState[from];
            return true;
        }
        return false;
    }
    
    actualizarActividad(from) {
        if (this.userState[from]) {
            this.userState[from].ultimaActividad = Date.now();
        }
    }

    async connect() {
        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: './data/session',
                clientId: 'botserviciosgl'
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process'
                ]
            },
            webVersionCache: {
                type: 'local',
                path: './.wwebjs_cache'
            }
        });

        this.client.on('qr', async (qr) => {
            console.log('\n========================================');
            console.log('  ESCANEA EL CODIGO QR CON WHATSAPP');
            console.log('========================================');
            console.log('1. Abre WhatsApp en tu telefono');
            console.log('2. Menu > Dispositivos vinculados');
            console.log('3. Vincular dispositivo');
            console.log('========================================\n');
            
            const qrPath = path.join(__dirname, '..', 'data', 'qr.png');
            await QRCode.toFile(qrPath, qr, { width: 400 });
            console.log(`QR guardado en: ${qrPath}`);
            console.log('Abre el archivo para escanearlo\n');
        });

        this.client.on('loading_screen', (percent, message) => {
            console.log(`Cargando: ${percent}% - ${message}`);
        });

        this.client.on('authenticated', () => {
            console.log('WhatsApp autenticado!');
        });

        this.client.on('auth_failure', (msg) => {
            console.error('Error de autenticacion:', msg);
        });

        this.client.on('ready', () => {
            console.log('WhatsApp conectado y listo!');
            this.ready = true;
        });

        this.client.on('message', async (msg) => {
            await this.handleMessage(msg);
        });

        this.client.on('disconnected', (reason) => {
            console.log('WhatsApp desconectado:', reason);
            this.ready = false;
        });

        await this.client.initialize();
    }

    async handleMessage(msg) {
        if (msg.fromMe) return;
        if (msg.from === 'status@broadcast') return;
        if (!msg.body || msg.body.trim() === '') return;

        const from = msg.from;
        const text = msg.body.trim().toUpperCase();

        // Verificar timeout de sesión
        if (this.verificarTimeout(from)) {
            this.userState[from] = { primer_mensaje: true, ultimaActividad: Date.now() };
            await this.enviarBienvenida(msg);
            this.enviarConCodigo(msg, 'Tu sesión ha expirado y se ha cerrado por inactividad.\n\nPero no te preocupes, podemos comenzar de nuevo! :)');
            return;
        }
        
        // Verificar si es el primer mensaje del usuario
        const estado = this.userState[from];
        
        // Si no hay estado, es el primer mensaje -> dar bienvenida
        if (!estado) {
            this.userState[from] = { primer_mensaje: true, ultimaActividad: Date.now() };
            try {
                await this.enviarBienvenida(msg);
            } catch (error) {
                console.error('Error al enviar bienvenida:', error);
            }
            return;
        }
        
        // Actualizar timestamp de actividad
        this.actualizarActividad(from);
        
        // Si hay estado pero solo primer_mensaje, es el segundo mensaje -> departamentos
        if (estado.primer_mensaje) {
            delete this.userState[from];
            try {
                await this.enviarDepartamentos(msg);
            } catch (error) {
                console.error('Error al enviar departamentos:', error);
                this.enviarConCodigo('Lo siento, hubo un error al cargar los departamentos. Intenta nuevamente.');
            }
            return;
        }

        if (text === '0' || text === 'MENU' || text === 'INICIO') {
            delete this.userState[from];
            await this.enviarDepartamentos(msg);
            return;
        }

        if (text === 'X' || text === 'SALIR' || text === 'SALIDA') {
            delete this.userState[from];
            this.enviarConCodigo('Hasta luego!');
            return;
        }

        if (!estado.departamento) {
            const num = parseInt(text);
            const deptos = await this.obtenerDepartamentos();
            
            if (isNaN(num) || num < 1 || num > deptos.length) {
                this.enviarConCodigo('Número no válido. Selecciona el departamento:');
                return;
            }
            
            const depto = deptos[num - 1];
            this.userState[from] = {
                departamento: num,
                deptoNombre: depto.NOMBRE
            };
            
            await this.enviarEntidades(msg, from);
            return;
        }

        if (!estado.entidad) {
            const num = parseInt(text);
            
            if (isNaN(num) || !estado.entidades || num < 1 || num > estado.entidades.length) {
                this.enviarConCodigo('Número no válido. Selecciona la entidad:');
                return;
            }
            
            const ent = estado.entidades[num - 1];
            this.userState[from].entidad = num;
            this.userState[from].entidadId = ent.ID_ENTIDAD;
            this.userState[from].entidadNombre = ent.ENTIDAD;
            
            await this.enviarTipoBusqueda(msg);
            return;
        }

        if (!estado.tipoBusqueda) {
            // Definir tipos (común para Ollama y fallback)
            const tipos = {
                'TARJETA': { tipo: 'TARJETA', prompt: 'Ingresa el NÚMERO DE TARJETA:', placeholder: 'tarjeta' },
                'CATASTRO': { tipo: 'CATASTRO', prompt: 'Ingresa el NÚMERO DE CATASTRO:', placeholder: 'catastro' },
                'CONTRIBUYENTE': { tipo: 'CONTRIBUYENTE', prompt: 'Ingresa el DPI del contribuyente:', placeholder: 'DPI' }
            };
            
            // Paso 3: Intentar Ollama primero (modo híbrido)
            const clasificacion = await this.clasificarBusqueda(msg.body);
            
            // clasificacion puede ser un array (múltiples consultas) o un objeto (una sola)
            const consultas = Array.isArray(clasificacion) ? clasificacion : [clasificacion];
            
            // BUSCAR CONSULTA CON IDENTIFICADOR ESPECÍFICO (prioridad por especificidad)
            // CATASTRO > TARJETA > CONTRIBUYENTE (más específico a menos específico)
            let consultaValida = null;
            
            // Primero buscar CATASTRO con identificador
            consultaValida = consultas.find(c => c && c.tipo === 'CATASTRO' && c.identificador && c.identificador.length >= 3);
            
            // Si no hay CATASTRO, buscar TARJETA con identificador
            if (!consultaValida) {
                consultaValida = consultas.find(c => c && c.tipo === 'TARJETA' && c.identificador && c.identificador.length >= 3);
            }
            
            // Si no hay TARJETA, buscar CONTRIBUYENTE con identificador
            if (!consultaValida) {
                consultaValida = consultas.find(c => c && c.tipo === 'CONTRIBUYENTE' && c.identificador && c.identificador.length >= 3);
            }
            
            // Si no hay ninguna con identificador, tomar la primera válida
            if (!consultaValida) {
                consultaValida = consultas.find(c => c && c.tipo && tipos[c.tipo]);
            }
            
            if (consultaValida) {
                // Ollama identificó el tipo de búsqueda
                const tipoInfo = tipos[consultaValida.tipo];
                this.userState[from].tipoBusqueda = tipoInfo.tipo;
                this.userState[from].promptBusqueda = tipoInfo.prompt;
                
                // Solo mostrar mensaje de espera si NO se proporcionó identificador
                if (!consultaValida.identificador || consultaValida.identificador.length < 3) {
                    this.enviarConCodigo(msg, `Has elegido (IA): Buscar por ${tipoInfo.tipo}\n\n${tipoInfo.prompt}\n(Escribe X para reiniciar)`);
                } else {
                    this.enviarConCodigo(msg, `Has elegido (IA): Buscar por ${tipoInfo.tipo}`);
                }
                
                // Si Ollama también identificó el identificador, procesarlo directamente
                if (consultaValida.identificador && consultaValida.identificador.length >= 3) {
                    this.userState[from].identificador = consultaValida.identificador.toUpperCase();
                    
                    if (tipoInfo.tipo === 'CONTRIBUYENTE') {
                        await this.buscarContribuyente(msg, from);
                    } else if (tipoInfo.tipo === 'CATASTRO') {
                        await this.mostrarTarjetasCatastro(msg, from);
                    } else if (tipoInfo.tipo === 'TARJETA') {
                        const respuesta = await this.ejecutarPython('id_tarjeta_por_identificador', {
                            identificador: consultaValida.identificador,
                            id_entidad: this.userState[from].entidadId
                        });
                        console.log(`[TARJETA-IA] Buscando tarjeta: ${consultaValida.identificador}, Respuesta: ${respuesta}`);
                        // Manejar respuesta no-JSON (texto plano)
                        let tarjetas = [];
                        try {
                            if (respuesta.trim().startsWith('[')) {
                                tarjetas = JSON.parse(respuesta.trim());
                            }
                        } catch (e) {
                            // Respuesta no es JSON válido
                        }
                        if (!tarjetas || tarjetas.length === 0) {
                            this.enviarConCodigo(msg, 'No se encontró la tarjeta. Verifica el número e intenta nuevamente.');
                            delete this.userState[from].identificador;
                            return;
                        }
                        this.userState[from].tarjetaId = String(tarjetas[0].ID_TARJETA);
                        this.userState[from].id_servicio = String(tarjetas[0].ID_SERVICIO_CATASTRO);
                        this.userState[from].tarjetaSeleccionada = consultaValida.identificador;
                        await this.enviarMenu(msg, from);
                    }
                    return;
                }
                return;
            }
            
            // Fallback: menú numérico tradicional
            const tiposNumericos = {
                '1': { tipo: 'TARJETA', prompt: 'Ingresa el NÚMERO DE TARJETA:', placeholder: 'tarjeta' },
                '2': { tipo: 'CATASTRO', prompt: 'Ingresa el NÚMERO DE CATASTRO:', placeholder: 'catastro' },
                '3': { tipo: 'CONTRIBUYENTE', prompt: 'Ingresa el DPI del contribuyente:', placeholder: 'DPI' }
            };
            
            if (!tiposNumericos[text]) {
                this.enviarConCodigo('Opción no válida. Selecciona el tipo de búsqueda:\n1️⃣ TARJETA\n2️⃣ CATASTRO\n3️⃣ CONTRIBUYENTE');
                return;
            }
            
            this.userState[from].tipoBusqueda = tiposNumericos[text].tipo;
            this.userState[from].promptBusqueda = tiposNumericos[text].prompt;
            
            this.enviarConCodigo(msg, `Has elegido: Buscar por ${tiposNumericos[text].tipo}\n\n${tiposNumericos[text].prompt}\n(Escribe X para reiniciar)`);
            return;
        }

        if (!estado.identificador && estado.tipoBusqueda !== 'TARJETA_SELECT') {
            if (text.length >= 3) {
                this.userState[from].identificador = msg.body.trim().toUpperCase();
                
                if (estado.tipoBusqueda === 'CONTRIBUYENTE') {
                    await this.buscarContribuyente(msg, from);
                } else if (estado.tipoBusqueda === 'CATASTRO') {
                    await this.mostrarTarjetasCatastro(msg, from);
                } else if (estado.tipoBusqueda === 'TARJETA') {
                    // Buscar el ID_TARJETA y ID_SERVICIO_CATASTRO a partir del identificador
                    const respuesta = await this.ejecutarPython('id_tarjeta_por_identificador', {
                        identificador: this.userState[from].identificador,
                        id_entidad: this.userState[from].entidadId
                    });
                    console.log(`[TARJETA] Buscando tarjeta: ${this.userState[from].identificador}, Respuesta: ${respuesta}`);
                    if (respuesta.startsWith('ERROR') || !respuesta.trim()) {
                        this.enviarConCodigo(msg, 'No se encontró la tarjeta. Verifica el número e intenta nuevamente.');
                        delete this.userState[from].identificador;
                        return;
                    }
                    // Formato json devuelve array
                    const tarjetas = JSON.parse(respuesta.trim());
                    if (!tarjetas || tarjetas.length === 0) {
                        this.enviarConCodigo(msg, 'No se encontró la tarjeta. Verifica el número e intenta nuevamente.');
                        delete this.userState[from].identificador;
                        return;
                    }
                    this.userState[from].tarjetaId = String(tarjetas[0].ID_TARJETA);
                    this.userState[from].id_servicio = String(tarjetas[0].ID_SERVICIO_CATASTRO);
                    this.userState[from].tarjetaSeleccionada = this.userState[from].identificador;
                    await this.enviarMenu(msg, from);
                } else {
                    await this.enviarMenu(msg, from);
                }
            } else {
                this.enviarConCodigo(`${estado.promptBusqueda}\n(Debe tener al menos 3 caracteres)`);
            }
            return;
        }

        if (estado.tipoBusqueda === 'CONTRIBUYENTE' && !estado.catastroSeleccionado && !estado.queryType) {
            if (text === 'T') {
                // Load all cards from all catastros
                this.userState[from].tipoBusqueda = 'CONTRIBUYENTE_TODOS';
                // Combine cards from all catastros
                const promises = estado.catastros.map(c => this.obtenerTarjetasCatastro(c.CATASTRO, estado.entidadId));
                const results = await Promise.all(promises);
                const todasTarjetas = results.flat();
                
                if (!todasTarjetas || todasTarjetas.length === 0) {
                    this.enviarConCodigo('No se encontraron tarjetas.');
                    return;
                }
                
                this.userState[from].tarjetasCatastro = todasTarjetas;
                this.userState[from].todasLasTarjetas = todasTarjetas;
                this.userState[from].catastroSeleccionado = 'TODOS';
                
                let mensaje = `CONTRIBUYENTE: ${estado.identificador}\nTodas las tarjetas\n\nSe encontraron ${todasTarjetas.length} tarjeta(s):\n\n`;
                todasTarjetas.forEach((t, i) => {
                    const nombre = `${t.NOMBRE || ''} ${t.APELLIDO_PATERNO || ''} ${t.APELLIDO_MATERNO || ''}`.trim();
                    mensaje += `${this.getNumeroEmoji(i)} ${nombre} - ${t.CATASTRO}\n`;
                });
                mensaje += `\nT. Ver todas las cuentas (T)\n\nEscribe el número de tarjeta para ver sus cuentas, o T para ver todas:`;
                
                await this.enviarConCodigo(msg, mensaje);
                this.userState[from].esperandoTarjeta = true;
                return;
            }
            
            const num = parseInt(text);
            if (isNaN(num) || !estado.catastros || num < 1 || num > estado.catastros.length) {
                this.enviarConCodigo('Número no válido. Selecciona el catastro:');
                return;
            }
            
            this.userState[from].catastroSeleccionado = estado.catastros[num - 1].CATASTRO;
            // Use catastroSeleccionado to show cards
            const tarjetas = await this.obtenerTarjetasCatastro(this.userState[from].catastroSeleccionado, estado.entidadId);
            
            if (!tarjetas || tarjetas.length === 0) {
                this.enviarConCodigo(`No se encontraron tarjetas para el catastro: ${this.userState[from].catastroSeleccionado}`);
                return;
            }
            
            this.userState[from].tarjetasCatastro = tarjetas;
            this.userState[from].todasLasTarjetas = tarjetas;
            this.userState[from].tipoBusqueda = 'CONTRIBUYENTE';
            
            let mensaje = `CONTRIBUYENTE: ${estado.identificador}\nCatastro: ${this.userState[from].catastroSeleccionado}\n\nSe encontraron ${tarjetas.length} tarjeta(s):\n\n`;
            tarjetas.forEach((t, i) => {
                const nombre = `${t.NOMBRE || ''} ${t.APELLIDO_PATERNO || ''} ${t.APELLIDO_MATERNO || ''}`.trim();
                mensaje += `${this.getNumeroEmoji(i)} ${nombre} - ${t.CATASTRO}\n`;
            });
            mensaje += `\nT. Ver todas las cuentas (T)\n\nEscribe el número de tarjeta para ver sus cuentas, o T para ver todas:`;
            
            await this.enviarConCodigo(msg, mensaje);
            this.userState[from].esperandoTarjeta = true;
            return;
        }

        if (estado.esperandoTarjeta && (estado.tipoBusqueda === 'CATASTRO' || estado.tipoBusqueda === 'CONTRIBUYENTE' || estado.tipoBusqueda === 'CONTRIBUYENTE_TODOS')) {
            if (text === 'T') {
                delete this.userState[from].esperandoTarjeta;
                await this.enviarMenu(msg, from);
                return;
            }
            
            const num = parseInt(text);
            if (isNaN(num) || num < 1 || num > estado.tarjetasCatastro.length) {
                this.enviarConCodigo('Número no válido. Selecciona la tarjeta:');
                return;
            }
            
            const t = estado.tarjetasCatastro[num - 1];
            // Formato igual que simulate.py:
            // - tarjetaSeleccionada = IDENTIFICADOR del catastro (CATASTRO)
            // - tarjetaId = ID_TARJETA para queries
            // - tarjetaNombre = nombre completo
            // - id_servicio = ID_SERVICIO_CATASTRO
            this.userState[from].tarjetaSeleccionada = t.CATASTRO || estado.identificador;
            this.userState[from].tarjetaId = t.ID_TARJETA;
            this.userState[from].tarjetaNombre = `${t.NOMBRE || ''} ${t.APELLIDO_PATERNO || ''} ${t.APELLIDO_MATERNO || ''}`.trim();
            this.userState[from].tipoBusqueda = 'TARJETA_CATASTRO';
            this.userState[from].id_servicio = t.ID_SERVICIO_CATASTRO;
            this.userState[from].idServicioCatastro = t.ID_SERVICIO_CATASTRO;
            delete this.userState[from].esperandoTarjeta;
            await this.enviarMenu(msg, from);
            return;
        }

        // MANEJO PRIORITARIO DE RESPUESTA S/N - ANTES DE TODO
        if (estado.esperandoDetalle) {
            if (text === 'S') {
                delete this.userState[from].esperandoDetalle;
                await this.runDetalle(msg, from);
                return;
            } else if (text === 'N' || text === 'X') {
                delete this.userState[from];
                this.enviarConCodigo('Gracias por usar el servicio. Hasta luego!');
                return;
            } else {
                this.enviarConCodigo('Opción no válida. Escribe S para ver detalle o N para salir.');
                return;
            }
        }

        if (!estado.queryType) {
            if (['1', '2'].includes(text)) {
                const opciones = this.getOpcionesConsulta(estado.tipoBusqueda, estado.catastroSeleccionado);
                const opcion = opciones[text];
                
                this.userState[from].queryResumen = opcion.resumen;
                this.userState[from].queryDetalle = opcion.detalle;
                this.userState[from].queryName = opcion.nombre;
                this.userState[from].menuOption = text;
                
                if (text === '2') {
                    await this.generarDocumentoCobro(msg, from);
                    return;
                }
                
                await this.runResumen(msg, from);
                return;
            }
            
            this.enviarConCodigo('Opción no válida.\nEscribe 0 para reiniciar.');
            return;
        }

        // Manejar selección de tarjeta para detalle
        if (estado.solicitandoDetalleTarjeta) {
            if (text === 'T') {
                // Ver todas las tarjetas del catastro
                delete this.userState[from].solicitandoDetalleTarjeta;
                // Mantener los datos necesarios para el detalle
                this.userState[from] = {
                    departamento: estado.departamento,
                    deptoNombre: estado.deptoNombre,
                    entidad: estado.entidad,
                    entidadId: estado.entidadId,
                    entidadNombre: estado.entidadNombre,
                    tipoBusqueda: estado.tipoBusqueda,
                    identificador: estado.identificador,
                    queryName: estado.queryName,
                    queryDetalle: estado.queryDetalle,
                    queryResumen: estado.queryResumen,
                    tarjetasCatastro: estado.tarjetasCatastro
                };
                await this.runDetalle(msg, from);
            } else {
                const num = parseInt(text);
if (isNaN(num) || !estado.tarjetasCatastro || num < 1 || num > estado.tarjetasCatastro.length) {
                this.enviarConCodigo('Número no válido. Selecciona la tarjeta:');
                    return;
                }
                // Guardar la tarjeta seleccionada y cambiar el tipo para el detalle
                this.userState[from].tarjetaDetalleSeleccionada = estado.tarjetasCatastro[num - 1].ID_TARJETA;
                this.userState[from].tarjetaNombre = estado.tarjetasCatastro[num - 1].NOMBRE;
                this.userState[from].tipoBusqueda = 'TARJETA_CATASTRO';
                this.userState[from].id_servicio = estado.tarjetasCatastro[num - 1].ID_SERVICIO_CATASTRO;
                this.userState[from].tarjetaId = estado.tarjetasCatastro[num - 1].ID_TARJETA;
                this.userState[from].tarjetaSeleccionada = `${estado.tarjetasCatastro[num - 1].NOMBRE} ${estado.tarjetasCatastro[num - 1].APELLIDO_PATERNO || ''}`.trim();
                delete this.userState[from].solicitandoDetalleTarjeta;
                await this.runDetalleTarjeta(msg, from);
            }
            return;
        }

        this.enviarConCodigo('Opción no válida.\nEscribe 0 para reiniciar.');
    }

getOpcionesConsulta(tipo, catastro) {
        const opciones = {
            '1': {
                sufijo: 'pendiente',
                nombre: 'Cuentas Pendientes',
                queries: {
                    'CONTRIBUYENTE': { resumen: 'cta_pendiente_contribuyente', detalle: 'cta_pendiente_detalle_contribuyente' },
                    'CONTRIBUYENTE_TODOS': { resumen: 'cta_pendiente_contribuyente', detalle: 'cta_pendiente_detalle_contribuyente' },
                    'CATASTRO': { resumen: 'cta_pendiente_catastro', detalle: 'cta_pendiente_detalle' },
                    'TARJETA_CATASTRO': { resumen: 'cta_pendiente_tarjeta', detalle: 'cta_pendiente_detalle_tarjeta' },
                    'TARJETA': { resumen: 'cta_pendiente_tarjeta', detalle: 'cta_pendiente_detalle_tarjeta' }
                }
            },
            '2': {
                sufijo: 'documento',
                nombre: 'Generar Documento de Cobro',
                queries: {
                    'CONTRIBUYENTE': { resumen: 'cta_pendiente_contribuyente', detalle: 'documento_cobro' },
                    'CONTRIBUYENTE_TODOS': { resumen: 'cta_pendiente_contribuyente', detalle: 'documento_cobro' },
                    'CATASTRO': { resumen: 'cta_pendiente_catastro', detalle: 'documento_cobro' },
                    'TARJETA_CATASTRO': { resumen: 'cta_pendiente_tarjeta', detalle: 'documento_cobro' },
                    'TARJETA': { resumen: 'cta_pendiente_tarjeta', detalle: 'documento_cobro' }
                }
            }
        };
        
        const result = {};
        for (const [key, config] of Object.entries(opciones)) {
            const queriesForType = config.queries[tipo] || config.queries['TARJETA'];
            result[key] = {
                resumen: queriesForType.resumen,
                detalle: queriesForType.detalle,
                nombre: config.nombre
            };
        }
        return result;
    }

    getOpcionesTotales(tipo) {
        return {};
    }

async enviarDepartamentos(msg) {
        try {
            const deptos = await this.obtenerDepartamentos();
            
            if (!deptos || deptos.length === 0) {
                this.enviarConCodigo('Error: No se pudieron cargar los departamentos. Intenta nuevamente.');
                return;
            }
            
            let mensaje = `CONSULTAS DE CUENTA CORRIENTE\n\nPaso 1: Selecciona el DEPARTAMENTO\n\n`;
            deptos.forEach((d, i) => {
                mensaje += `${this.getNumeroEmoji(i)} ${d.NOMBRE}\n`;
            });
            mensaje += '\nEscribe el número';
            
            await this.enviarConCodigo(msg, mensaje);
        } catch (error) {
            console.error('Error en enviarDepartamentos:', error);
            this.enviarConCodigo('Error al cargar departamentos. Por favor intenta nuevamente.');
        }
}

    getSaludo() {
        const ahora = new Date();
        const hora = ahora.getHours();
        
        let saludo = '¡Hola!';
        
        if (hora >= 5 && hora < 12) {
            saludo = '¡Buenos días!';
        } else if (hora >= 12 && hora < 18) {
            saludo = '¡Buenas tardes!';
        } else {
            saludo = '¡Buenas noches!';
        }
        
        return saludo;
    }

    getNumeroEmoji(num) {
        const digitEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
        const n = num + 1;
        return String(n).split('').map(d => digitEmojis[parseInt(d)]).join('') + ' ';
    }

    async enviarBienvenida(msg) {
        const saludo = this.getSaludo();
        
        const mensaje = `${saludo}

Soy el asistente de consultas de Cuenta Corriente.

Puedo ayudarte a realizar lo siguiente:
- Consultar cuentas pendientes
- Generar documento de cobro

Para comenzar, escribe cualquier texto o numero para iniciar la consulta.

Escribe 0 en cualquier momento para reiniciar.
Escribe X para salir.`;
        
        await this.enviarConCodigo(msg, mensaje);
        
        // Iniciar flujo normal
        this.userState[msg.from] = {};
        await this.enviarDepartamentos(msg);
    }

    async enviarEntidades(msg, from) {
        try {
            const estado = this.userState[from];
            const entidades = await this.obtenerEntidades(estado.departamento);
            
            if (!entidades || entidades.length === 0) {
                this.enviarConCodigo('No hay entidades en este departamento.\n\nSelecciona otro departamento:');
                delete this.userState[from];
                await this.enviarDepartamentos(msg);
                return;
            }
            
            this.userState[from].entidades = entidades;
            
            let mensaje = `DEPARTAMENTO: ${estado.deptoNombre}\n\nPaso 2: Selecciona la ENTIDAD\n\n`;
            entidades.forEach((e, i) => {
                mensaje += `${this.getNumeroEmoji(i)} ${e.ENTIDAD}\n`;
            });
            mensaje += '\nEscribe el número';
            
            await this.enviarConCodigo(msg, mensaje);
        } catch (error) {
            console.error('Error:', error);
            this.enviarConCodigo('Error al cargar entidades.');
        }
    }

    async clasificarBusqueda(texto) {
        try {
            const scriptPath = path.join(__dirname, '..', 'src', 'services', 'classify_search.py');
            const result = await new Promise((resolve) => {
                const proc = spawn('python', [scriptPath, texto]);
                let output = '';
                proc.stdout.on('data', (data) => { output += data.toString(); });
                proc.on('close', () => {
                    try {
                        const parsed = JSON.parse(output.trim());
                        // Ensure we always return an array for consistency
                        resolve(Array.isArray(parsed) ? parsed : [parsed]);
                    } catch (e) {
                        resolve([]);
                    }
                });
            });
            return result;
        } catch (error) {
            console.log('[classify_search] Error:', error);
            return { tipo: null, identificador: null };
        }
    }

    async enviarTipoBusqueda(msg) {
        const from = msg.from;
        const estado = this.userState[from];
        
        const mensaje = `ENTIDAD: ${estado.entidadNombre}

Paso 3: Selecciona el TIPO DE BUSQUEDA

1️⃣ Por TARJETA
   (Buscar directamente por numero de tarjeta)

2️⃣ Por CATASTRO
   (Un catastro puede tener varias tarjetas)

3️⃣ Por CONTRIBUYENTE (DPI)
   (Un contribuyente puede tener varios catastros)

Escribe el numero (1, 2 o 3)`;
        
        await this.enviarConCodigo(msg, mensaje);
    }

    async buscarContribuyente(msg, from) {
        const estado = this.userState[from];
        
        try {
            const catastros = await this.obtenerCatastrosContribuyente(estado.identificador, estado.departamento);
            
            if (!catastros || catastros.length === 0) {
                this.enviarConCodigo(msg, `No se encontraron catastros para el DPI: ${estado.identificador}. Verifica el número e intenta nuevamente.`);
                delete this.userState[from].identificador;
                return;
            }
            
            this.userState[from].catastros = catastros;
            
            // Guardar nombre completo del contribuyente
            const primerCatastro = catastros[0];
            const nombreCompleto = `${primerCatastro.NOMBRE || ''} ${primerCatastro.APELLIDO_PATERNO || ''} ${primerCatastro.APELLIDO_MATERNO || ''}`.trim();
            this.userState[from].contribuyenteNombre = nombreCompleto;
            
            let mensaje = `CONTRIBUYENTE: ${estado.identificador} - ${nombreCompleto}\n\nSe encontraron ${catastros.length} catastro(s):\n\n`;
            catastros.forEach((c, i) => {
                mensaje += `${this.getNumeroEmoji(i)} CATASTRO: ${c.CATASTRO}\n   Entidad: ${c.ENTIDAD}\n\n`;
            });
            mensaje += `T. Ver todas las tarjetas (T)\n\nEscribe el número del catastro para ver sus cuentas, o T para ver todas:`;
            
            await this.enviarConCodigo(msg, mensaje);
        } catch (error) {
            console.error('Error:', error);
            this.enviarConCodigo('Error al buscar contribuyente.');
        }
    }

    async mostrarTarjetasCatastro(msg, from) {
        const estado = this.userState[from];
        
        try {
            const tarjetas = await this.obtenerTarjetasCatastro(estado.identificador, estado.entidadId);
            
            if (!tarjetas || tarjetas.length === 0) {
                this.enviarConCodigo(`No se encontraron tarjetas para el catastro: ${estado.identificador}\n\nEscribe otro catastro o 0 para reiniciar.`);
                delete this.userState[from].identificador;
                return;
            }
            
            this.userState[from].tarjetasCatastro = tarjetas;
            
            // Guardar todas las tarjetas para referencia futura
            this.userState[from].todasLasTarjetas = tarjetas;
            
            let mensaje = `CATASTRO: ${estado.identificador}\n\nSe encontraron ${tarjetas.length} tarjeta(s) en este catastro:\n\n`;
            tarjetas.forEach((t, i) => {
                // Formato igual que simulate.py: nombre completo + identificador de catastro
                const nombre = `${t.NOMBRE || ''} ${t.APELLIDO_PATERNO || ''} ${t.APELLIDO_MATERNO || ''}`.trim();
                const catastroIdent = t.CATASTRO || estado.identificador;
                mensaje += `${this.getNumeroEmoji(i)} ${nombre} - ${catastroIdent}\n`;
            });
			
            mensaje += `\nEscribe el número de tarjeta para ver sus cuentas, o T para ver el resumen completo del catastro:`;
            
            await this.enviarConCodigo(msg, mensaje);
            this.userState[from].esperandoTarjeta = true;
        } catch (error) {
            console.error('Error:', error);
            this.enviarConCodigo('Error al buscar tarjetas del catastro.');
        }
    }

    async enviarMenu(msg, from) {
        const estado = this.userState[from];
        
        // Formato exactamente igual que simulate.py
        let tipo = estado.tipoBusqueda;
        let idMostrar = '';
        
        if (tipo === 'TARJETA') {
            idMostrar = `Tarjeta: ${estado.identificador}`;
        } else if (tipo === 'CATASTRO') {
            idMostrar = `Catastro: ${estado.identificador}`;
        } else if (tipo === 'TARJETA_CATASTRO') {
            idMostrar = `Tarjeta: ${estado.tarjetaSeleccionada || ''}`;
        } else if (tipo === 'CONTRIBUYENTE') {
            let nombre = estado.contribuyenteNombre || estado.identificador;
            let catastro = estado.catastroSeleccionado || '';
            idMostrar = `Contribuyente: ${nombre} - Catastro: ${catastro}`;
        } else {
            idMostrar = `ID: ${estado.identificador}`;
        }
        
        const mensaje = `CONSULTA DE CUENTA CORRIENTE

Departamento: ${estado.deptoNombre}
Entidad: ${estado.entidadNombre}
Tipo: ${tipo}
${idMostrar}

Paso 4: Selecciona la consulta:
1️⃣ Cuentas Pendientes
2️⃣ Generar Documento de Cobro

0. Reiniciar
X. Salir`;
        
        await this.enviarConCodigo(msg, mensaje);
    }

    async pedirSeleccionTarjetaDetalle(msg, from) {
        const estado = this.userState[from];
        
        // Lista de tarjetas para seleccionar cual ver en detalle
        let mensaje = ``;
        estado.tarjetasCatastro.forEach((t, i) => {
            // Formato: numero + nombre completo + catastro (identificador)
            const nombre = `${t.NOMBRE || ''} ${t.APELLIDO_PATERNO || ''} ${t.APELLIDO_MATERNO || ''}`.trim();
            const catastro = t.CATASTRO || estado.identificador;
            mensaje += `${this.getNumeroEmoji(i)} ${nombre} - ${catastro}\n`;
        });
        mensaje += `\nT. Ver todas las tarjetas\n\nEscribe el número de la tarjeta:`;
        
        await this.enviarConCodigo(msg, mensaje);
        this.userState[from].solicitandoDetalleTarjeta = true;
    }

    async preguntarDetalle(msg, from) {
        // Preguntar si desea ver el detalle - formato igual que simulate.py
        const estado = this.userState[from];
        
        let mensaje = `Deseas ver el DETALLE? (S/N)\n\n`;
        mensaje += `Escribe S para ver el detalle.\n`;
        mensaje += `Escribe N o X para salir.`;
        
        await this.enviarConCodigo(msg, mensaje);
        this.userState[from].esperandoDetalle = true;
    }

async generarDocumentoCobro(msg, from) {
        const estado = this.userState[from];
        
        console.log(`[DOCUMENTO_COBRO] Tipo: ${estado.tipoBusqueda}, Identificador: ${estado.identificador}, TarjetaId: ${estado.tarjetaId}, id_servicio: ${estado.id_servicio}, EntidadId: ${estado.entidadId}`);
        
        try {
            let cuentas = [];
            
            // Obtener cuentas según el tipo de búsqueda
            if (estado.tipoBusqueda === 'TARJETA' || estado.tipoBusqueda === 'TARJETA_CATASTRO') {
                const respuesta = await this.ejecutarPython('cuentas_corrientes_pendientes', {
                    id_tarjeta: estado.tarjetaId,
                    id_entidad: estado.entidadId
                });
                console.log(`[DOCUMENTO_COBRO] Respuesta cuentas: ${respuesta.substring(0, 300)}`);
                if (!respuesta.startsWith('ERROR') && respuesta.trim()) {
                    cuentas = JSON.parse(respuesta.trim());
                }
            } else if (estado.tipoBusqueda === 'CATASTRO') {
                const respuesta = await this.ejecutarPython('cuentas_corrientes_pendientes_catastro', {
                    catastro: estado.identificador,
                    id_entidad: estado.entidadId
                });
                if (!respuesta.startsWith('ERROR') && respuesta.trim()) {
                    cuentas = JSON.parse(respuesta.trim());
                }
            } else if (estado.tipoBusqueda === 'CONTRIBUYENTE') {
                const respuesta = await this.ejecutarPython('cuentas_corrientes_pendientes_contribuyente', {
                    dpi: estado.identificador,
                    id_entidad: estado.entidadId
                });
                if (!respuesta.startsWith('ERROR') && respuesta.trim()) {
                    cuentas = JSON.parse(respuesta.trim());
                }
            }
            
            console.log(`[DOCUMENTO_COBRO] Cuentas obtenidas: ${cuentas.length}`);
            
            if (!cuentas || cuentas.length === 0) {
                await this.enviarConCodigo(msg, 'No hay cuentas pendientes para generar documento de cobro.');
                delete this.userState[from];
                return;
            }
            
            // Hay cuentas -> generar documento directamente
            await this.procesarDocumentoCobro(msg, from, cuentas.map(c => c.ID_CUENTA_CORRIENTE));
        } catch (error) {
            console.error('[DOCUMENTO_COBRO] Error:', error);
            this.enviarConCodigo('Error al procesar la consulta.');
            delete this.userState[from];
        }
    }

async procesarDocumentoCobro(msg, from, idsCuentas) {
        const estado = this.userState[from];
        
        try {
            // Obtener ID_CONTRIBUYENTE según el tipo de búsqueda
            const idContribuyente = await this.obtenerIdContribuyente(estado);
            
            console.log(`[procesarDocumentoCobro] idContribuyente: ${idContribuyente}`);
            
            if (!idContribuyente) {
                await this.enviarConCodigo(msg, 'No se pudo obtener el identificador del contribuyente.');
                delete this.userState[from];
                return;
            }
            
            // Enviar mensaje de espera
            await this.enviarConCodigo(msg, `Generando documento de cobro para ${idsCuentas.length} cuenta(s)...`);
            
            // URL del API
            const apiUrl = 'http://localhost:5562/api/comunicabanco/consultareporte';
            
            // Preparar JSON body
            const body = JSON.stringify({
                "ID_ENTIDAD": estado.entidadId,
                "STR_USR": "sias",
                "STRPWD": "Password.Secreto",
                "REPORTE": "GENERAR_DOCUMENTO_COBRO_CUENTA_CORRIENTE",
                "ID_CONTRIBUYENTE_DOC": parseInt(idContribuyente),
                "CUENTAS_CORRIENTES": idsCuentas.join(',')
            });
            
            console.log(`[procesarDocumentoCobro] Body: ${body}`);
            
            // Descargar el PDF usando POST
            const pdfBuffer = await this.descargarPdfPost(apiUrl, body);
            
            if (!pdfBuffer) {
                await this.enviarConCodigo(msg, 'Error al generar el documento. Intenta nuevamente.');
                delete this.userState[from];
                return;
            }
            
            // Parsear la respuesta JSON del API
            let respuesta;
            try {
                respuesta = JSON.parse(pdfBuffer.toString('utf8'));
                console.log(`[procesarDocumentoCobro] Respuesta API: ${pdfBuffer.toString('utf8').substring(0, 300)}`);
            } catch (e) {
                console.log(`[procesarDocumentoCobro] Error parseando JSON: ${e}`);
                await this.enviarConCodigo(msg, 'Error al procesar la respuesta del servidor.');
                delete this.userState[from];
                return;
            }
            
// Extraer el PDF de la respuesta
            let pdfBytes;
            try {
                console.log(`[procesarDocumentoCobro] Respuesta: ${JSON.stringify(respuesta).substring(0, 500)}`);
                
                // El campo "data" contiene un JSON stringified
                let dataObj;
                const dataStr = respuesta.data;
                if (typeof dataStr === 'string') {
                    // Parsear el string inner JSON
                    dataObj = JSON.parse(dataStr);
                } else {
                    dataObj = dataStr;
                }
                
                console.log(`[procesarDocumentoCobro] dataObj: ${JSON.stringify(dataObj).substring(0, 300)}`);
                
                // Buscar Documento_Bytes en diferentes ubicaciones
                if (dataObj.Documento_Bytes) {
                    pdfBytes = Buffer.from(dataObj.Documento_Bytes, 'base64');
                } else if (dataObj.mdlDocumento && dataObj.mdlDocumento[0] && dataObj.mdlDocumento[0].Documento_Bytes) {
                    pdfBytes = Buffer.from(dataObj.mdlDocumento[0].Documento_Bytes, 'base64');
                }
                
                if (!pdfBytes || pdfBytes.length === 0) {
                    console.log(`[procesarDocumentoCobro] No hay Documento_Bytes. dataObj: ${JSON.stringify(dataObj)}`);
                    await this.enviarConCodigo(msg, 'Error: No se generó el documento.');
                    delete this.userState[from];
                    return;
                }
            } catch (e) {
                console.log(`[procesarDocumentoCobro] Error extrayendo PDF: ${e}`);
                await this.enviarConCodigo(msg, 'Error al procesar el documento.');
                delete this.userState[from];
                return;
            }
            
            console.log(`[procesarDocumentoCobro] PDF bytes: ${pdfBytes.length}`);
            
            // Enviar el PDF por WhatsApp usando msg.reply
            const tempPath = path.join(__dirname, '..', 'data', `temp_${Date.now()}.pdf`);
            const dataDir = path.join(__dirname, '..', 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(tempPath, pdfBytes);
            
            try {
                const media = MessageMedia.fromFilePath(tempPath);
                console.log(`[procesarDocumentoCobro] Media mime: ${media.mimetype}, size: ${media.data.length}`);
                // Usar msg.reply para mantener el contexto del chat
                await msg.reply(media);
                console.log(`[procesarDocumentoCobro] PDF enviado exitosamente`);
            } catch (e) {
                console.log(`[procesarDocumentoCobro] Error sending media: ${e}, stack: ${e.stack}`);
                await this.enviarConCodigo(msg, `Error al enviar PDF. Descárgalo aquí: ${tempPath}`);
            } finally {
                try { fs.unlinkSync(tempPath); } catch (e) {}
            }
            
            await this.enviarConCodigo(msg, `Documento de cobro enviado!\n\nGracias por usar el servicio!`);
            delete this.userState[from];
            
        } catch (error) {
            console.error('Error generando documento:', error);
            this.enviarConCodigo('Error al generar el documento de cobro. Intenta nuevamente.');
            delete this.userState[from];
        }
    }
    
    descargarPdfPost(url, body) {
        console.log(`[descargarPdfPost] URL: ${url}, Body: ${body}`);
        return new Promise((resolve, reject) => {
            const req = http.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            }, (res) => {
                console.log(`[descargarPdfPost] Status: ${res.statusCode}`);
                if (res.statusCode !== 200) {
                    resolve(null);
                    return;
                }
                
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    console.log(`[descargarPdfPost] Bytes recibidos: ${Buffer.concat(chunks).length}`);
                    resolve(Buffer.concat(chunks));
                });
                res.on('error', (err) => {
                    console.log(`[descargarPdfPost] Error: ${err}`);
                    resolve(null);
                });
            });
            
            req.write(body);
            req.on('error', (err) => {
                console.log(`[descargarPdfPost] Request error: ${err}`);
                resolve(null);
            });
        });
    }

async obtenerIdContribuyente(estado) {
        try {
            let queryId, params;
            
            console.log(`[obtenerIdContribuyente] tipoBusqueda: ${estado.tipoBusqueda}, tarjetaId: ${estado.tarjetaId}, id_servicio: ${estado.id_servicio}`);
            
if (estado.tipoBusqueda === 'CONTRIBUYENTE') {
                queryId = 'id_contribuyente_por_dpi';
                params = { dpi: estado.identificador };
            } else if (estado.tipoBusqueda === 'TARJETA') {
                // Para TARJETA: obtener id_servicio de multiples fuentes
                let id_servicio = estado.id_servicio || estado.id_servicio_catastro || estado.id_servicioCatastro;
                if (!id_servicio && estado.tarjetaId) {
                    const respuestaId = await this.ejecutarPython('id_servicio_catastro_por_identificador', {
                        id_tarjeta: estado.tarjetaId
                    });
                    if (!respuestaId.startsWith('ERROR') && respuestaId.trim() && respuestaId.trim() !== 'None') {
                        try {
                            const idData = JSON.parse(respuestaId.trim());
                            id_servicio = idData?.[0]?.ID_SERVICIO_CATASTRO;
                        } catch (e) {}
                    }
                }
                if (!id_servicio) {
                    console.log('[obtenerIdContribuyente] No hay id_servicio para TARJETA');
                    return null;
                }
                console.log(`[obtenerIdContribuyente] id_servicio: ${id_servicio}`);
                queryId = 'id_contribuyente_por_tarjeta';
                params = { id_servicio_catastro: String(id_servicio) };
            } else if (estado.tipoBusqueda === 'TARJETA_CATASTRO') {
                // Para TARJETA_CATASTRO: obtener id_servicio_catastro de multiples fuentes
                let id_servicio = estado.id_servicio || estado.id_servicio_catastro || estado.id_servicioCatastro;
                if (!id_servicio && estado.tarjetaId) {
                    // Intentar obtener desde la tarjeta
                    const respuestaId = await this.ejecutarPython('id_servicio_catastro_por_identificador', {
                        id_tarjeta: estado.tarjetaId
                    });
                    if (!respuestaId.startsWith('ERROR') && respuestaId.trim() && respuestaId.trim() !== 'None') {
                        try {
                            const idData = JSON.parse(respuestaId.trim());
                            id_servicio = idData?.[0]?.ID_SERVICIO_CATASTRO;
                        } catch (e) {}
                    }
                }
                console.log(`[obtenerIdContribuyente] id_servicio: ${id_servicio}`);
                queryId = 'id_contribuyente_por_tarjeta';
                params = { id_servicio_catastro: String(id_servicio) };
            } else if (estado.tipoBusqueda === 'CATASTRO') {
                // Usar todasLasTarjetas o query directa
                let tarjetas = estado.todasLasTarjetas;
                if (!tarjetas) {
                    const respuestaTarjetas = await this.ejecutarPython('tarjetas_por_catastro', {
                        catastro: estado.identificador,
                        id_entidad: estado.entidadId
                    });
                    if (!respuestaTarjetas.startsWith('ERROR') && respuestaTarjetas.trim()) {
                        try {
                            tarjetas = JSON.parse(respuestaTarjetas.trim());
                        } catch (e) {}
                    }
                }
                if (tarjetas && tarjetas.length > 0) {
                    queryId = 'id_contribuyente_por_tarjeta';
                    params = { id_servicio_catastro: String(tarjetas[0].ID_SERVICIO_CATASTRO) };
                } else {
                    queryId = 'id_contribuyente_por_catastro';
                    params = { catastro: estado.identificador, id_entidad: estado.entidadId };
                }
            }
            
console.log(`[obtenerIdContribuyente] Query: ${queryId}, Params:`, params);
            const respuesta = await this.ejecutarPython(queryId, params);
            console.log(`[obtenerIdContribuyente] Respuesta: ${respuesta}`);
            if (respuesta.startsWith('ERROR') || !respuesta.trim()) {
                console.log(`[obtenerIdContribuyente] Error o vacio: ${respuesta}`);
                return null;
            }
            
            // Extraer el ID_CONTRIBUYENTE del resultado
            try {
                const data = JSON.parse(respuesta.trim());
                //_handle both array and simple formats
                if (Array.isArray(data) && data[0] && data[0].ID_CONTRIBUYENTE) {
                    return String(data[0].ID_CONTRIBUYENTE);
                } else if (typeof data === 'number') {
                    return String(data);
                } else if (typeof data === 'string' && data.match(/^\d+$/)) {
                    return data;
                }
            } catch (e) {
                // Maybe it's just a number/string directly
                const trimmed = respuesta.trim();
                if (trimmed.match(/^\d+$/)) {
                    return trimmed;
                }
                console.log(`[obtenerIdContribuyente] Error parseando: ${e}`);
            }
            return null;
        } catch (error) {
            console.error('Error obteniendo ID contribuyente:', error);
            return null;
        }
    }

    async runDetalleTarjeta(msg, from) {
        const estado = this.userState[from];
        
        try {
            let params, queryId;
            
            if (estado.tipoBusqueda === 'TARJETA' || estado.tipoBusqueda === 'TARJETA_CATASTRO') {
                params = {
                    id_tarjeta: estado.tarjetaId,
                    id_entidad: estado.entidadId
                };
                queryId = 'cta_pendiente_detalle_tarjeta';
            } else {
                params = {
                    identificador: estado.identificador,
                    id_entidad: estado.entidadId
                };
                queryId = 'cta_pendiente_detalle';
            }
            
            const respuesta = await this.ejecutarPython(queryId, params);
            
            let header = `DETALLE: ${estado.queryName}\n`;
            if (estado.tipoBusqueda === 'TARJETA' || estado.tipoBusqueda === 'TARJETA_CATASTRO') {
                header += `Tarjeta: ${estado.tarjetaSeleccionada}\n\n`;
            } else {
                header += `Catastro: ${estado.identificador}\n\n`;
            }
            
            if (respuesta.startsWith('ERROR')) {
                await this.enviarConCodigo(msg, respuesta.replace('ERROR: ', ''));
            } else {
                this.enviarConCodigo(msg, header + respuesta);
            }
        } catch (error) {
            console.error('Error:', error);
            this.enviarConCodigo('Error al procesar la consulta.');
        }
        
        delete this.userState[from];
    }

    async runResumen(msg, from) {
        const estado = this.userState[from];
        
        try {
            const params = this.getQueryParams(estado);
            
            const respuesta = await this.ejecutarPython(
                estado.queryResumen, 
                params
            );
            
            // Formato igual que simulate.py
            let header = `${estado.queryName}\n`;
            header += `Departamento: ${estado.deptoNombre}\nEntidad: ${estado.entidadNombre}\n`;
            
            let tipoInfo = estado.tipoBusqueda;
            if (estado.tipoBusqueda === 'TARJETA' || estado.tipoBusqueda === 'TARJETA_CATASTRO') {
                tipoInfo = `Tarjeta: ${estado.tarjetaSeleccionada || estado.identificador}`;
            } else if (estado.tipoBusqueda === 'CONTRIBUYENTE' && estado.catastroSeleccionado) {
                let nombre = estado.contribuyenteNombre || estado.identificador;
                tipoInfo = `Contribuyente: ${nombre} - Catastro: ${estado.catastroSeleccionado}`;
            } else if (estado.tipoBusqueda === 'CATASTRO') {
                tipoInfo = `Catastro: ${estado.identificador}`;
            } else if (estado.tipoBusqueda === 'TARJETA') {
                tipoInfo = `Tarjeta: ${estado.identificador}`;
            }
            
            header += `${tipoInfo}\n\n`;
            
            if (respuesta.startsWith('ERROR')) {
                await this.enviarConCodigo(msg, respuesta.replace('ERROR: ', ''));
                delete this.userState[from];
            } else if (respuesta.includes('No se encontraron')) {
                this.enviarConCodigo(msg, header + respuesta);
                delete this.userState[from];
            } else {
                // MOSTRAR el resumen (ya incluye "¿Deseas ver el detalle? (S/N)")
                this.enviarConCodigo(msg, header + respuesta);
                
                // Solo establecer flag para esperar respuesta S/N
                // NO enviar otro mensaje - el formateador ya incluye la pregunta
                this.userState[from].esperandoDetalle = true;
            }
        } catch (error) {
            console.error('Error:', error);
            this.enviarConCodigo('Error al procesar la consulta.');
            delete this.userState[from];
        }
    }

    async runDetalle(msg, from) {
        const estado = this.userState[from];
        
        try {
            let params;
            let queryId = estado.queryDetalle;
            
            // Exactamente igual que simulate.py
if (estado.tipoBusqueda === 'CATASTRO') {
                params = {
                    identificador: estado.identificador,
                    id_entidad: estado.entidadId
                };
                queryId = 'cta_pendiente_detalle';
            } else if (estado.tipoBusqueda === 'TARJETA_CATASTRO') {
                params = {
                    id_tarjeta: estado.tarjetaId,
                    id_entidad: estado.entidadId
                };
                queryId = 'cta_pendiente_detalle_tarjeta';
            } else if (estado.tipoBusqueda === 'TARJETA') {
                params = {
                    id_tarjeta: estado.tarjetaId,
                    id_entidad: estado.entidadId
                };
                queryId = 'cta_pendiente_detalle_tarjeta';
            } else if (estado.tipoBusqueda === 'CONTRIBUYENTE') {
                params = {
                    dpi: estado.identificador,
                    id_entidad: estado.entidadId
                };
                queryId = 'cta_pendiente_detalle_contribuyente';
            } else {
                params = this.getQueryParams(estado);
            }
            
            const respuesta = await this.ejecutarPython(queryId, params);
            
            // Formato igual que simulate.py
            let header = `DETALLE: ${estado.queryName}\n`;
            if (estado.tipoBusqueda === 'TARJETA' || estado.tipoBusqueda === 'TARJETA_CATASTRO') {
                header += `Tarjeta: ${estado.tarjetaSeleccionada || ''}\n`;
            } else if (estado.tipoBusqueda === 'CATASTRO') {
                header += `Catastro: ${estado.identificador}\n`;
            } else if (estado.tipoBusqueda === 'CONTRIBUYENTE') {
                header += `Contribuyente: ${estado.contribuyenteNombre || estado.identificador}\n`;
            } else {
                header += `ID: ${estado.identificador}\n`;
            }
            
            if (respuesta.startsWith('ERROR')) {
                await this.enviarConCodigo(msg, respuesta.replace('ERROR: ', ''));
            } else {
                this.enviarConCodigo(msg, header + respuesta);
            }
        } catch (error) {
            console.error('Error:', error);
            this.enviarConCodigo('Error al procesar la consulta.');
        }
        
        delete this.userState[from];
    }

    async runQuery(msg, from) {
        const estado = this.userState[from];
        
        try {
            const params = this.getQueryParams(estado);
            
            const respuesta = await this.ejecutarPython(estado.queryType, params);
            
            let header = `${estado.queryName}\n`;
            header += `Departamento: ${estado.deptoNombre}\nEntidad: ${estado.entidadNombre}\n`;
            header += `Tipo: ${estado.tipoBusqueda}`;
            if (estado.catastroSeleccionado) {
                header += ` > ${estado.catastroSeleccionado}`;
            }
            header += `\nID: ${estado.identificador}\n\n`;
            
            if (respuesta.startsWith('ERROR')) {
                await this.enviarConCodigo(msg, respuesta.replace('ERROR: ', ''));
            } else if (respuesta.includes('No se encontraron')) {
                this.enviarConCodigo(msg, header + respuesta);
            } else {
                this.enviarConCodigo(msg, header + respuesta);
            }
        } catch (error) {
            console.error('Error:', error);
            this.enviarConCodigo('Error al procesar la consulta.');
        }
        
        delete this.userState[from];
    }

    getQueryParams(estado) {
        if (estado.tipoBusqueda === 'CONTRIBUYENTE') {
            return {
                dpi: estado.identificador,
                id_entidad: estado.entidadId
            };
        } else if (estado.tipoBusqueda === 'CATASTRO') {
            return {
                identificador: estado.identificador,
                id_entidad: estado.entidadId
            };
        } else if (estado.tipoBusqueda === 'TARJETA') {
            return {
                identificador: estado.identificador,
                id_entidad: estado.entidadId
            };
        } else if (estado.tipoBusqueda === 'TARJETA_CATASTRO') {
            return {
                identificador: estado.tarjetaSeleccionada,
                id_entidad: estado.entidadId
            };
        } else {
            return {
                identificador: estado.tarjetaSeleccionada || estado.identificador,
                id_entidad: estado.entidadId
            };
        }
    }

    async obtenerDepartamentos() {
        const script = `
import sys
sys.path.insert(0, '.')
from src.queries.query_router import load_queries, execute_query
import json

try:
    queries = json.load(open('config/queries.json', 'r', encoding='utf-8'))
    load_queries(queries)

    result = execute_query('departamentos', {})
    if result.success and result.data:
        print(json.dumps(result.data))
    else:
        print('ERROR')
except Exception as e:
    print('ERROR:', str(e))
        `;
        
        const result = await this.ejecutarPythonRaw(script);
        
        if (result.trim() === 'ERROR' || !result.trim() || result.trim().startsWith('ERROR:')) {
            return [];
        }
        
        try {
            return JSON.parse(result.trim());
        } catch (e) {
            console.error('Error parseando JSON:', e);
            return [];
        }
    }

    async obtenerEntidades(codigoDepto) {
        const script = `
import sys
sys.path.insert(0, '.')
from src.queries.query_router import load_queries, execute_query
import json

try:
    queries = json.load(open('config/queries.json', 'r', encoding='utf-8'))
    load_queries(queries)

    result = execute_query('entidades_por_departamento', {'codigo_departamento': ${codigoDepto}})
    if result.success and result.data:
        print(json.dumps(result.data))
    else:
        print('ERROR')
except Exception as e:
    print('ERROR:', str(e))
        `;
        
        const result = await this.ejecutarPythonRaw(script);
        
        if (result.trim() === 'ERROR' || !result.trim() || result.trim().startsWith('ERROR:')) {
            return [];
        }
        
        try {
            return JSON.parse(result.trim());
        } catch (e) {
            console.error('Error parseando JSON:', e);
            return [];
        }
    }

    async obtenerCatastrosContribuyente(dpi, codigoDepto) {
        const script = `
import sys
sys.path.insert(0, '.')
from src.queries.query_router import load_queries, execute_query
import json

try:
    queries = json.load(open('config/queries.json', 'r', encoding='utf-8'))
    load_queries(queries)

    result = execute_query('catastros_por_contribuyente', {'dpi': '${dpi}', 'codigo_departamento': ${codigoDepto}})
    if result.success and result.data:
        print(json.dumps(result.data))
    else:
        print('ERROR')
except Exception as e:
    print('ERROR:', str(e))
        `;
        
        const result = await this.ejecutarPythonRaw(script);
        
        if (result.trim() === 'ERROR' || !result.trim() || result.trim().startsWith('ERROR:')) {
            return [];
        }
        
        try {
            return JSON.parse(result.trim());
        } catch (e) {
            console.error('Error parseando JSON:', e);
            return [];
        }
    }

    async obtenerTarjetasCatastro(catastro, idEntidad) {
        const script = `
import sys
sys.path.insert(0, '.')
from src.queries.query_router import load_queries, execute_query
import json

try:
    queries = json.load(open('config/queries.json', 'r', encoding='utf-8'))
    load_queries(queries)

    result = execute_query('tarjetas_por_catastro', {'catastro': '${catastro}', 'id_entidad': ${idEntidad}})
    if result.success and result.data:
        print(json.dumps(result.data))
    else:
        print('ERROR')
except Exception as e:
    print('ERROR:', str(e))
        `;
        
        const result = await this.ejecutarPythonRaw(script);
        
        if (result.trim() === 'ERROR' || !result.trim() || result.trim().startsWith('ERROR:')) {
            return [];
        }
        
        try {
            return JSON.parse(result.trim());
        } catch (e) {
            console.error('Error parseando JSON:', e);
            return [];
        }
    }

    async ejecutarPython(queryId, params) {
        console.log(`[ejecutarPython] Query: ${queryId}, Params:`, params);
        return new Promise((resolve, reject) => {
            const paramsStr = Object.entries(params)
                .map(([k, v]) => `'${k}': '${v}'`)
                .join(', ');
            
            const script = `
import sys
sys.path.insert(0, '.')
from src.queries.query_router import load_queries, execute_query
import json

try:
    queries = json.load(open('config/queries.json', 'r', encoding='utf-8'))
    load_queries(queries)
    
    q = next((x for x in queries if x['id'] == '${queryId}'), None)
    print(f'QUERY_Found: {q is not None}, Format: {q.get("format") if q else "N/A"}', file=__import__(\"sys\").stderr)

    result = execute_query('${queryId}', {${paramsStr}})
    if result.success:
        print(result.formatted_output)
    else:
        print(f'ERROR: {result.error}')
except Exception as e:
    print(f'ERROR: {str(e)}')
            `;

            const proceso = spawn('python', ['-c', script], { cwd: process.cwd() });

            let stdout = '';
            let stderr = '';

            proceso.stdout.on('data', (data) => { stdout += data.toString(); });
            proceso.stderr.on('data', (data) => { stderr += data.toString(); });

            proceso.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    console.error('Error en query:', stderr);
                    resolve('ERROR: Error al ejecutar la consulta.');
                }
            });

            proceso.on('error', (err) => {
                console.error(`[${new Date().toLocaleTimeString()}] Error al ejecutar Python:`, err);
                reject(err);
            });
        });
    }

    async ejecutarPythonRaw(script) {
        return new Promise((resolve, reject) => {
            const proceso = spawn('python', ['-c', script], { cwd: process.cwd() });

            let stdout = '';
            let stderr = '';

            proceso.stdout.on('data', (data) => { stdout += data.toString(); });
            proceso.stderr.on('data', (data) => { stderr += data.toString(); });

            proceso.on('close', (code) => {
                if (code !== 0 && stderr) {
                    console.error(`[${new Date().toLocaleTimeString()}] Python stderr:`, stderr);
                }
                resolve(stdout.trim());
            });

            proceso.on('error', (err) => {
                console.error(`[${new Date().toLocaleTimeString()}] Error al ejecutar Python raw:`, err);
                reject(err);
            });
        });
    }

    async disconnect() {
        if (this.client) {
            await this.client.destroy();
        }
    }
}

module.exports = new WhatsAppService();
