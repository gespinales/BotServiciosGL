const { Client, LocalAuth } = require('whatsapp-web.js');
const { spawn } = require('child_process');
const path = require('path');
const QRCode = require('qrcode');

class WhatsAppService {
    TIMEOUT_MINUTOS = 5;
    
    constructor() {
        this.client = null;
        this.ready = false;
        this.userState = {};
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
            await msg.reply('Tu sesión ha expirado y se ha cerrado por inactividad.\n\nPero no te preocupes, podemos comenzar de nuevo! :)');
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
                await msg.reply('Lo siento, hubo un error al cargar los departamentos. Intenta nuevamente.');
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
            await msg.reply('Hasta luego!');
            return;
        }

        if (!estado.departamento) {
            const num = parseInt(text);
            const deptos = await this.obtenerDepartamentos();
            
            if (isNaN(num) || num < 1 || num > deptos.length) {
                await msg.reply('Numero no valido. Selecciona el departamento:');
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
            
            if (isNaN(num) || num < 1 || num > estado.entidades.length) {
                await msg.reply('Numero no valido. Selecciona la entidad:');
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
            if (!['1', '2', '3'].includes(text)) {
                await msg.reply('Opcion no valida. Selecciona el tipo de busqueda:');
                return;
            }
            
            const tipos = {
                '1': { tipo: 'TARJETA', prompt: 'Ingresa el NUMERO DE TARJETA:', placeholder: 'tarjeta' },
                '2': { tipo: 'CATASTRO', prompt: 'Ingresa el NUMERO DE CATASTRO:', placeholder: 'catastro' },
                '3': { tipo: 'CONTRIBUYENTE', prompt: 'Ingresa el DPI del contribuyente:', placeholder: 'DPI' }
            };
            
            this.userState[from].tipoBusqueda = tipos[text].tipo;
            this.userState[from].promptBusqueda = tipos[text].prompt;
            
            await msg.reply(`Has elegido: Buscar por ${tipos[text].tipo}\n\n${tipos[text].prompt}\n(Escribe X para reiniciar)`);
            return;
        }

        if (!estado.identificador && estado.tipoBusqueda !== 'TARJETA_SELECT') {
            if (text.length >= 3) {
                this.userState[from].identificador = msg.body.trim().toUpperCase();
                
                if (estado.tipoBusqueda === 'CONTRIBUYENTE') {
                    await this.buscarContribuyente(msg, from);
                } else if (estado.tipoBusqueda === 'CATASTRO') {
                    await this.mostrarTarjetasCatastro(msg, from);
                } else {
                    await this.enviarMenu(msg, from);
                }
            } else {
                await msg.reply(`${estado.promptBusqueda}\n(Debe tener al menos 3 caracteres)`);
            }
            return;
        }

        if (estado.tipoBusqueda === 'CONTRIBUYENTE' && !estado.catastroSeleccionado && !estado.queryType) {
            if (text === 'T') {
                await this.enviarMenu(msg, from);
                return;
            }
            
            const num = parseInt(text);
            if (isNaN(num) || num < 1 || num > estado.catastros.length) {
                await msg.reply('Numero no valido. Selecciona el catastro:');
                return;
            }
            
            this.userState[from].catastroSeleccionado = estado.catastros[num - 1].CATASTRO;
            await this.enviarMenu(msg, from);
            return;
        }

        if (estado.esperandoTarjeta && estado.tipoBusqueda === 'CATASTRO') {
            if (text === 'T') {
                delete this.userState[from].esperandoTarjeta;
                await this.enviarMenu(msg, from);
                return;
            }
            
            const num = parseInt(text);
            if (isNaN(num) || num < 1 || num > estado.tarjetasCatastro.length) {
                await msg.reply('Numero no valido. Selecciona la tarjeta:');
                return;
            }
            
            const t = estado.tarjetasCatastro[num - 1];
            // Formato igual que simulate.py:
            // - tarjetaSeleccionada = IDENTIFICADOR del catastro (CATASTRO)
            // - tarjetaId = ID_TARJETA para queries
            // - tarjetaNombre = nombre completo
            this.userState[from].tarjetaSeleccionada = t.CATASTRO || estado.identificador;
            this.userState[from].tarjetaId = t.ID_TARJETA;
            this.userState[from].tarjetaNombre = `${t.NOMBRE || ''} ${t.APELLIDO_PATERNO || ''} ${t.APELLIDO_MATERNO || ''}`.trim();
            this.userState[from].tipoBusqueda = 'TARJETA_CATASTRO';
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
                await msg.reply('Gracias por usar el servicio. Hasta luego!');
                return;
            } else {
                await msg.reply('Opcion no valida. Escribe S para ver detalle o N para salir.');
                return;
            }
        }

        if (!estado.queryType) {
            if (['1'].includes(text)) {
                const opciones = this.getOpcionesConsulta(estado.tipoBusqueda, estado.catastroSeleccionado);
                const opcion = opciones[text];
                
                this.userState[from].queryResumen = opcion.resumen;
                this.userState[from].queryDetalle = opcion.detalle;
                this.userState[from].queryName = opcion.nombre;
                
                await this.runResumen(msg, from);
                return;
            }
            
            await msg.reply('Opcion no valida.\nEscribe 0 para reiniciar.');
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
                if (isNaN(num) || num < 1 || num > estado.tarjetasCatastro.length) {
                    await msg.reply('Numero no valido. Selecciona la tarjeta:');
                    return;
                }
                // Guardar la tarjeta seleccionada y cambiar el tipo para el detalle
                this.userState[from].tarjetaDetalleSeleccionada = estado.tarjetasCatastro[num - 1].ID_TARJETA;
                this.userState[from].tarjetaNombre = estado.tarjetasCatastro[num - 1].NOMBRE;
                this.userState[from].tipoBusqueda = 'TARJETA_CATASTRO';
                delete this.userState[from].solicitandoDetalleTarjeta;
                await this.runDetalleTarjeta(msg, from);
            }
            return;
        }

        await msg.reply('Opcion no valida.\nEscribe 0 para reiniciar.');
    }

    getOpcionesConsulta(tipo, catastro) {
        // Definición de opciones de consulta
        // Estructura: numero: { sufijo, nombre, queries: { tipo_busqueda: {resumen, detalle} } }
        const opciones = {
            '1': {
                sufijo: 'pendiente',
                nombre: 'Cuentas Pendientes',
                queries: {
// Exactamente igual que simulate.py
                'CONTRIBUYENTE': { resumen: 'cta_pendiente_contribuyente', detalle: 'cta_pendiente_detalle_contribuyente' },
                'CATASTRO': { resumen: 'cta_pendiente_catastro', detalle: 'cta_pendiente_detalle' },
                'TARJETA_CATASTRO': { resumen: 'cta_pendiente_tarjeta', detalle: 'cta_pendiente_detalle_tarjeta' },
                'TARJETA': { resumen: 'cta_pendiente_tarjeta', detalle: 'cta_pendiente_detalle_tarjeta' }
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
                await msg.reply('Error: No se pudieron cargar los departamentos. Intenta nuevamente.');
                return;
            }
            
            let mensaje = `CONSULTAS DE CUENTA CORRIENTE\n\nPaso 1: Selecciona el DEPARTAMENTO\n\n`;
            deptos.forEach((d, i) => {
                mensaje += `${i + 1}. ${d.NOMBRE}\n`;
            });
            mensaje += '\nEscribe el numero';
            
            await msg.reply(mensaje);
        } catch (error) {
            console.error('Error en enviarDepartamentos:', error);
            await msg.reply('Error al cargar departamentos. Por favor intenta nuevamente.');
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

    async enviarBienvenida(msg) {
        const saludo = this.getSaludo();
        
        const mensaje = `${saludo}

Soy el asistente de consultas de Cuenta Corriente.

Puedo ayudarte a consultar:
- Cuentas pendientes

Para comenzar, escribe cualquier texto o numero para iniciar la consulta.

Escribe 0 en cualquier momento para reiniciar.
Escribe X para salir.`;
        
        await msg.reply(mensaje);
        
        // Iniciar flujo normal
        this.userState[msg.from] = {};
        await this.enviarDepartamentos(msg);
    }

    async enviarEntidades(msg, from) {
        try {
            const estado = this.userState[from];
            const entidades = await this.obtenerEntidades(estado.departamento);
            
            if (!entidades || entidades.length === 0) {
                await msg.reply('No hay entidades en este departamento.\n\nSelecciona otro departamento:');
                delete this.userState[from];
                await this.enviarDepartamentos(msg);
                return;
            }
            
            this.userState[from].entidades = entidades;
            
            let mensaje = `DEPARTAMENTO: ${estado.deptoNombre}\n\nPaso 2: Selecciona la ENTIDAD\n\n`;
            entidades.forEach((e, i) => {
                mensaje += `${i + 1}. ${e.ENTIDAD}\n`;
            });
            mensaje += '\nEscribe el numero';
            
            await msg.reply(mensaje);
        } catch (error) {
            console.error('Error:', error);
            await msg.reply('Error al cargar entidades.');
        }
    }

    async enviarTipoBusqueda(msg) {
        const mensaje = `ENTIDAD: ${this.userState[msg.from].entidadNombre}\n\nPaso 3: Selecciona el TIPO DE BUSQUEDA\n\n1. Por TARJETA\n   (Buscar directamente por numero de tarjeta)\n\n2. Por CATASTRO\n   (Un catastro puede tener varias tarjetas)\n\n3. Por CONTRIBYENTE (DPI)\n   (Un contribuyente puede tener varios catastros)\n\n\nEscribe el numero (1, 2 o 3)`;
        
        await msg.reply(mensaje);
    }

    async buscarContribuyente(msg, from) {
        const estado = this.userState[from];
        
        try {
            const catastros = await this.obtenerCatastrosContribuyente(estado.identificador, estado.departamento);
            
            if (!catastros || catastros.length === 0) {
                await msg.reply(`No se encontraron catastros para el DPI: ${estado.identificador}\n\nEscribe otro DPI o 0 para reiniciar.`);
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
                mensaje += `${i + 1}. CATASTRO: ${c.CATASTRO}\n   Entidad: ${c.ENTIDAD}\n\n`;
            });
            mensaje += `T. Ver todas las tarjetas (T)\n\nEscribe el numero del catastro para ver sus cuentas, o T para ver todas:`;
            
            await msg.reply(mensaje);
        } catch (error) {
            console.error('Error:', error);
            await msg.reply('Error al buscar contribuyente.');
        }
    }

    async mostrarTarjetasCatastro(msg, from) {
        const estado = this.userState[from];
        
        try {
            const tarjetas = await this.obtenerTarjetasCatastro(estado.identificador, estado.entidadId);
            
            if (!tarjetas || tarjetas.length === 0) {
                await msg.reply(`No se encontraron tarjetas para el catastro: ${estado.identificador}\n\nEscribe otro catastro o 0 para reiniciar.`);
                delete this.userState[from].identificador;
                return;
            }
            
            this.userState[from].tarjetasCatastro = tarjetas;
            
            let mensaje = `CATASTRO: ${estado.identificador}\n\nSe encontraron ${tarjetas.length} tarjeta(s) en este catastro:\n\n`;
            tarjetas.forEach((t, i) => {
                // Formato igual que simulate.py: nombre completo + identificador de catastro
                const nombre = `${t.NOMBRE || ''} ${t.APELLIDO_PATERNO || ''} ${t.APELLIDO_MATERNO || ''}`.trim();
                const catastroIdent = t.CATASTRO || estado.identificador;
                mensaje += `${i + 1}. ${nombre} - ${catastroIdent}\n`;
            });
            mensaje += `\nT. Ver todas las cuentas del catastro (T)\n\nEscribe el numero de tarjeta para ver sus cuentas, o T para ver el resumen completo del catastro:`;
            
            await msg.reply(mensaje);
            this.userState[from].esperandoTarjeta = true;
        } catch (error) {
            console.error('Error:', error);
            await msg.reply('Error al buscar tarjetas del catastro.');
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
1. Cuentas Pendientes

0. Reiniciar
X. Salir`;
        
        await msg.reply(mensaje);
    }

    async pedirSeleccionTarjetaDetalle(msg, from) {
        const estado = this.userState[from];
        
        // Lista de tarjetas para seleccionar cual ver en detalle
        let mensaje = ``;
        estado.tarjetasCatastro.forEach((t, i) => {
            // Formato: numero + nombre completo + catastro (identificador)
            const nombre = `${t.NOMBRE || ''} ${t.APELLIDO_PATERNO || ''} ${t.APELLIDO_MATERNO || ''}`.trim();
            const catastro = t.CATASTRO || estado.identificador;
            mensaje += `${i + 1}. ${nombre} - ${catastro}\n`;
        });
        mensaje += `\nT. Ver todas las tarjetas\n\nEscribe el numero de la tarjeta:`;
        
        await msg.reply(mensaje);
        this.userState[from].solicitandoDetalleTarjeta = true;
    }

    async preguntarDetalle(msg, from) {
        // Preguntar si desea ver el detalle - formato igual que simulate.py
        const estado = this.userState[from];
        
        let mensaje = `Deseas ver el DETALLE? (S/N)\n\n`;
        mensaje += `Escribe S para ver el detalle.\n`;
        mensaje += `Escribe N o X para salir.`;
        
        await msg.reply(mensaje);
        this.userState[from].esperandoDetalle = true;
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
                await msg.reply(header + respuesta.replace('ERROR: ', ''));
            } else {
                await msg.reply(header + respuesta);
            }
        } catch (error) {
            console.error('Error:', error);
            await msg.reply('Error al procesar la consulta.');
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
            header += `Depto: ${estado.deptoNombre} | Entidad: ${estado.entidadNombre}\n`;
            
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
                await msg.reply(header + respuesta.replace('ERROR: ', ''));
                delete this.userState[from];
            } else if (respuesta.includes('No se encontraron')) {
                await msg.reply(header + respuesta);
                delete this.userState[from];
            } else {
                // MOSTRAR el resumen (ya incluye "¿Deseas ver el detalle? (S/N)")
                await msg.reply(header + respuesta);
                
                // Solo establecer flag para esperar respuesta S/N
                // NO enviar otro mensaje - el formateador ya incluye la pregunta
                this.userState[from].esperandoDetalle = true;
            }
        } catch (error) {
            console.error('Error:', error);
            await msg.reply('Error al procesar la consulta.');
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
                await msg.reply(header + respuesta.replace('ERROR: ', ''));
            } else {
                await msg.reply(header + respuesta);
            }
        } catch (error) {
            console.error('Error:', error);
            await msg.reply('Error al procesar la consulta.');
        }
        
        delete this.userState[from];
    }

    async runQuery(msg, from) {
        const estado = this.userState[from];
        
        try {
            const params = this.getQueryParams(estado);
            
            const respuesta = await this.ejecutarPython(estado.queryType, params);
            
            let header = `${estado.queryName}\n`;
            header += `Depto: ${estado.deptoNombre} | Entidad: ${estado.entidadNombre}\n`;
            header += `Tipo: ${estado.tipoBusqueda}`;
            if (estado.catastroSeleccionado) {
                header += ` > ${estado.catastroSeleccionado}`;
            }
            header += `\nID: ${estado.identificador}\n\n`;
            
            if (respuesta.startsWith('ERROR')) {
                await msg.reply(header + respuesta.replace('ERROR: ', ''));
            } else if (respuesta.includes('No se encontraron')) {
                await msg.reply(header + respuesta);
            } else {
                await msg.reply(header + respuesta);
            }
        } catch (error) {
            console.error('Error:', error);
            await msg.reply('Error al procesar la consulta.');
        }
        
        delete this.userState[from];
    }

    getQueryParams(estado) {
        // Exactamente igual que simulate.py
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
