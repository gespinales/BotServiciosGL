const { Client, LocalAuth } = require('whatsapp-web.js');
const { spawn } = require('child_process');
const path = require('path');
const QRCode = require('qrcode');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.ready = false;
        this.userState = {};
    }

    async connect() {
        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: './data/session'
            }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        this.client.on('qr', async (qr) => {
            console.log('\n=== ESCANEA EL CODIGO QR ===');
            const qrPath = path.join(__dirname, '..', 'data', 'qr.png');
            await QRCode.toFile(qrPath, qr);
            console.log(`QR guardado en: ${qrPath}\n`);
        });

        this.client.on('ready', () => {
            console.log('WhatsApp conectado!');
            this.ready = true;
        });

        this.client.on('message', async (msg) => {
            await this.handleMessage(msg);
        });

        await this.client.initialize();
    }

    async handleMessage(msg) {
        if (msg.fromMe) return;
        if (msg.from === 'status@broadcast') return;
        if (!msg.body || msg.body.trim() === '') return;

        const from = msg.from;
        const text = msg.body.trim().toUpperCase();

        console.log(`Mensaje de ${from}: ${text}`);

        // Verificar si es el primer mensaje del usuario
        const estado = this.userState[from];
        
        // Si no hay estado, es el primer mensaje -> dar bienvenida
        if (!estado) {
            this.userState[from] = { primer_mensaje: true };
            await this.enviarBienvenida(msg);
            return;
        }
        
        // Si hay estado pero solo primer_mensaje, es el segundo mensaje -> departamentos
        if (estado.primer_mensaje) {
            delete this.userState[from];
            await this.enviarDepartamentos(msg);
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
            
            this.userState[from].tarjetaSeleccionada = estado.tarjetasCatastro[num - 1].ID_TARJETA;
            this.userState[from].tarjetaNombre = estado.tarjetasCatastro[num - 1].NOMBRE;
            this.userState[from].tipoBusqueda = 'TARJETA_CATASTRO';
            delete this.userState[from].esperandoTarjeta;
            await this.enviarMenu(msg, from);
            return;
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
        const base = {
            '1': { sufijos: ['pendiente'], nombre: ['Cuentas Pendientes'] },
        };
        
        const result = {};
        for (let i = 1; i <= 1; i++) {
            let resumen, detalle;
            
            if (tipo === 'CONTRIBUYENTE') {
                resumen = `cta_${base['1'].sufijos[i-1]}_contribuyente`;
                detalle = `cta_${base['1'].sufijos[i-1]}_detalle`;
            } else if (tipo === 'CATASTRO') {
                resumen = `cta_${base['1'].sufijos[i-1]}_tarjeta_agrupado`;
                detalle = `cta_${base['1'].sufijos[i-1]}_detalle`;
            } else if (tipo === 'TARJETA_CATASTRO') {
                resumen = `cta_${base['1'].sufijos[i-1]}_tarjeta`;
                detalle = `cta_${base['1'].sufijos[i-1]}_detalle_tarjeta`;
            } else {
                resumen = `cta_${base['1'].sufijos[i-1]}_tarjeta`;
                detalle = `cta_${base['1'].sufijos[i-1]}_detalle_tarjeta`;
            }
            
            result[i.toString()] = { resumen, detalle, nombre: base['1'].nombre[i-1] };
        }
        return result;
    }

    getOpcionesTotales(tipo) {
        return {};
    }

    async enviarDepartamentos(msg) {
        try {
            const deptos = await this.obtenerDepartamentos();
            
            let mensaje = `CONSULTAS DE CUENTA CORRIENTE\n\nPaso 1: Selecciona el DEPARTAMENTO\n\n`;
            deptos.forEach((d, i) => {
                mensaje += `${i + 1}. ${d.NOMBRE}\n`;
            });
            mensaje += '\nEscribe el numero';
            
            await msg.reply(mensaje);
        } catch (error) {
            console.error('Error:', error);
            await msg.reply('Error al cargar departamentos.');
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
            
            let mensaje = `CONTRIBUYENTE: ${estado.identificador}\n\nSe encontraron ${catastros.length} catastro(s):\n\n`;
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
                mensaje += `${i + 1}. TARJETA: ${t.ID_TARJETA}\n   Nombre: ${t.NOMBRE}\n\n`;
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
        
        let tipoLabel = estado.tipoBusqueda;
        let idLabel = estado.identificador;
        
        if (estado.tipoBusqueda === 'CONTRIBUYENTE' && estado.catastroSeleccionado) {
            tipoLabel = 'CONTRIBUYENTE > CATASTRO';
            idLabel = `${estado.identificador} > ${estado.catastroSeleccionado}`;
        } else if (estado.tipoBusqueda === 'TARJETA_CATASTRO') {
            tipoLabel = 'CATASTRO > TARJETA';
            idLabel = `${estado.identificador} > ${estado.tarjetaSeleccionada}`;
        }
        
        const mensaje = `CONSULTA DE CUENTA CORRIENTE

Departamento: ${estado.deptoNombre}
Entidad: ${estado.entidadNombre}
Tipo: ${tipoLabel}
ID: ${idLabel}

Paso 4: Selecciona la consulta:
1. Cuentas Pendientes

0. Reiniciar
X. Salir`;
        
        await msg.reply(mensaje);
    }

    async pedirSeleccionTarjetaDetalle(msg, from) {
        const estado = this.userState[from];
        
        let mensaje = `Deseas ver el DETALLE?\n\n`;
        estado.tarjetasCatastro.forEach((t, i) => {
            mensaje += `${i + 1}. ${t.ID_TARJETA} - ${t.NOMBRE}\n`;
        });
        mensaje += `\nT. Ver todas las tarjetas\n\nEscribe el numero de la tarjeta:`;
        
        await msg.reply(mensaje);
        this.userState[from].solicitandoDetalleTarjeta = true;
    }

    async runDetalleTarjeta(msg, from) {
        const estado = this.userState[from];
        
        try {
            const params = {
                id_tarjeta: estado.tarjetaDetalleSeleccionada,
                id_entidad: estado.entidadId
            };
            
            const respuesta = await this.ejecutarPython(
                'cta_pendiente_detalle_tarjeta', 
                params
            );
            
            let header = `DETALLE: ${estado.queryName}\n`;
            header += `Tarjeta: ${estado.tarjetaDetalleSeleccionada} - ${estado.tarjetaNombre}\n\n`;
            
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
            
            let header = `${estado.queryName}\n`;
            header += `Depto: ${estado.deptoNombre} | Entidad: ${estado.entidadNombre}\n`;
            header += `Tipo: ${estado.tipoBusqueda}`;
            if (estado.catastroSeleccionado) {
                header += ` > ${estado.catastroSeleccionado}`;
            }
            header += `\nID: ${estado.identificador}\n\n`;
            
            if (respuesta.startsWith('ERROR')) {
                await msg.reply(header + respuesta.replace('ERROR: ', ''));
                delete this.userState[from];
            } else if (respuesta.includes('No se encontraron')) {
                await msg.reply(header + respuesta);
                delete this.userState[from];
            } else {
                if (estado.tarjetasCatastro && estado.tarjetasCatastro.length > 0) {
                    await this.pedirSeleccionTarjetaDetalle(msg, from);
                } else {
                    await this.runDetalle(msg, from);
                }
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
            
            // Si es CATASTRO y选择了 "T" (ver todas), usar query de detalle por catastro
            if (estado.tipoBusqueda === 'CATASTRO' && !estado.tarjetaDetalleSeleccionada) {
                params = {
                    identificador: estado.identificador,
                    id_entidad: estado.entidadId
                };
                queryId = 'cta_pendiente_detalle';
            } else if (estado.tipoBusqueda === 'TARJETA_CATASTRO') {
                // Detail specific
                params = {
                    id_tarjeta: estado.tarjetaDetalleSeleccionada,
                    id_entidad: estado.entidadId
                };
                queryId = 'cta_pendiente_detalle_tarjeta';
            } else {
                params = this.getQueryParams(estado);
                if (estado.tipoBusqueda === 'TARJETA' && !queryId.endsWith('_tarjeta')) {
                    queryId = queryId + '_tarjeta';
                }
            }
            
            const respuesta = await this.ejecutarPython(queryId, params);
            
            let header = `DETALLE: ${estado.queryName}\n`;
            header += `Tipo: ${estado.tipoBusqueda}`;
            if (estado.catastroSeleccionado) {
                header += ` > ${estado.catastroSeleccionado}`;
            }
            header += `\nID: ${estado.identificador}\n\n`;
            
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
        if (estado.tipoBusqueda === 'CONTRIBUYENTE') {
            return {
                dpi: estado.catastroSeleccionado ? estado.catastroSeleccionado : estado.identificador,
                id_entidad: estado.entidadId,
                codigo_departamento: estado.departamento
            };
        } else if (estado.tipoBusqueda === 'CATASTRO') {
            return {
                identificador: estado.identificador,
                id_entidad: estado.entidadId
            };
        } else if (estado.tipoBusqueda === 'TARJETA_CATASTRO') {
            return {
                id_tarjeta: estado.tarjetaSeleccionada,
                id_entidad: estado.entidadId
            };
        } else {
            return {
                id_tarjeta: estado.identificador,
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

queries = json.load(open('config/queries.json', 'r', encoding='utf-8'))
load_queries(queries)

result = execute_query('departamentos', {})
if result.success and result.data:
    print(json.dumps(result.data))
else:
    print('ERROR')
        `;
        
        const result = await this.ejecutarPythonRaw(script);
        if (result.trim() === 'ERROR' || !result.trim()) {
            return [];
        }
        return JSON.parse(result.trim());
    }

    async obtenerEntidades(codigoDepto) {
        const script = `
import sys
sys.path.insert(0, '.')
from src.queries.query_router import load_queries, execute_query
import json

queries = json.load(open('config/queries.json', 'r', encoding='utf-8'))
load_queries(queries)

result = execute_query('entidades_por_departamento', {'codigo_departamento': ${codigoDepto}})
if result.success and result.data:
    print(json.dumps(result.data))
else:
    print('ERROR')
        `;
        
        const result = await this.ejecutarPythonRaw(script);
        if (result.trim() === 'ERROR' || !result.trim() || result.trim() === '[]') {
            return [];
        }
        return JSON.parse(result.trim());
    }

    async obtenerCatastrosContribuyente(dpi, codigoDepto) {
        const script = `
import sys
sys.path.insert(0, '.')
from src.queries.query_router import load_queries, execute_query
import json

queries = json.load(open('config/queries.json', 'r', encoding='utf-8'))
load_queries(queries)

result = execute_query('catastros_por_contribuyente', {'dpi': '${dpi}', 'codigo_departamento': ${codigoDepto}})
if result.success and result.data:
    print(json.dumps(result.data))
else:
    print('ERROR')
        `;
        
        const result = await this.ejecutarPythonRaw(script);
        if (result.trim() === 'ERROR' || !result.trim() || result.trim() === '[]') {
            return [];
        }
        return JSON.parse(result.trim());
    }

    async obtenerTarjetasCatastro(catastro, idEntidad) {
        const script = `
import sys
sys.path.insert(0, '.')
from src.queries.query_router import load_queries, execute_query
import json

queries = json.load(open('config/queries.json', 'r', encoding='utf-8'))
load_queries(queries)

result = execute_query('tarjetas_por_catastro', {'catastro': '${catastro}', 'id_entidad': ${idEntidad}})
if result.success and result.data:
    print(json.dumps(result.data))
else:
    print('ERROR')
        `;
        
        const result = await this.ejecutarPythonRaw(script);
        if (result.trim() === 'ERROR' || !result.trim() || result.trim() === '[]') {
            return [];
        }
        return JSON.parse(result.trim());
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

queries = json.load(open('config/queries.json', 'r', encoding='utf-8'))
load_queries(queries)

result = execute_query('${queryId}', {${paramsStr}})
if result.success:
    print(result.formatted_output)
else:
    print(f'ERROR: {result.error}')
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
                    console.error('Python error:', stderr);
                    resolve('ERROR: Error al ejecutar la consulta.');
                }
            });

            proceso.on('error', reject);
        });
    }

    async ejecutarPythonRaw(script) {
        return new Promise((resolve, reject) => {
            const proceso = spawn('python', ['-c', script], { cwd: process.cwd() });

            let stdout = '';

            proceso.stdout.on('data', (data) => { stdout += data.toString(); });

            proceso.on('close', () => {
                resolve(stdout.trim());
            });

            proceso.on('error', reject);
        });
    }

    async disconnect() {
        if (this.client) {
            await this.client.destroy();
        }
    }
}

module.exports = new WhatsAppService();
