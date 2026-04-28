# BotServiciosGL - Agente de Consultas de Cuenta Corriente por WhatsApp

Agente conversacional que permite consultar cuentas pendientes de impuestos y servicios municipales de Guatemala a través de WhatsApp, interactuando directamente con una base de datos Oracle.

## Tabla de Contenidos

1. [Descripción General](#descripción-general)
2. [Tecnologías Usadas](#tecnologías-usadas)
3. [Arquitectura del Sistema](#arquitectura-del-sistema)
4. [Estructura de la Base de Datos](#estructura-de-la-base-de-datos)
5. [Flujo del Bot](#flujo-del-bot)
6. [Configuración](#configuración)
7. [Ejecución](#ejecución)
8. [Estructura de Archivos](#estructura-de-archivos)

---

## Descripción General

Este bot permite a los contribuyentes consultar el estado de sus cuentas pendientes (impuestos, arbitrios, tasas) sin necesidad de presentarse a una oficina municipal. El usuario inicia una conversación por WhatsApp y sigue un flujo guiado de 4 pasos:

1. Seleccionar el departamento (municipalidad)
2. Seleccionar la entidad (área dentro de la municipalidad)
3. Elegir tipo de búsqueda (número de tarjeta, catastro o DPI)
4. Ingresar el identificador correspondiente

El sistema devuelve un resumen agrupado por concepto de cobro y permite profundizar al detalle por tarjeta específica.

---

## Tecnologías Usadas

### Backend (Python)

| Tecnología | Propósito | Versión |
|------------|----------|---------|
| **Python 3.10+** | Lenguaje de programación | 3.10+ |
| **oracledb** | Driver de conexión a Oracle Database | 2.x |
| **Pydantic** | Validación de esquemas y tipos | 2.x |
| **python-dotenv** | Cargar configuración desde archivo .env | - |
| **Ollama** (opcional) | Modelo de lenguaje local para respuestas IA | Latest |

### Frontend (WhatsApp)

| Tecnología | Propósito | Versión |
|------------|----------|---------|
| **Node.js** | Runtime de JavaScript | 18+ |
| **whatsapp-web.js** | Cliente de WhatsApp Web | 1.x |
| **Puppeteer** | Navegador headless para WhatsApp Web | 21.x |
| **QRCode** | Generación de códigos QR | - |

### Base de Datos

- **Oracle Database 19c+** - Base de datos relacional corporativa

---

## Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                        WhatsApp User                             │
└─────────────────────────────┬───────────────────────────────────┘
                              │ mensajes
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    WhatsApp Bot (Node.js)                       │
│                  whatsapp/service.cjs (whatsapp-web.js)                    │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ Flujo de    │    │ Session     │    │ Python      │       │
│  │ conversación│    │ Manager     │    │ Bridge      │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
└─────────────────────────────┬───────────────────────────────────┘
                              │ spawn python
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Python Backend                                 │
│                  src/queries/query_router.py                         │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ Query      │    │ Oracle      │    │ Response   │       │
│  │ Router    │    │ Client     │    │ Formatter  │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
└─────────────────────────────┬───────────────────────────────────┘
                              │ SQL
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Oracle Database (172.18.28.233)                  │
│                       SERVICE: PDBQA                            │
└─────────────────────────────────────────────────────────────────┘
```

### Componentes Principales

1. **WhatsApp Bot (Node.js)**
   - Maneja la sesión de WhatsApp Web
   - Gestiona el flujo conversacional de 4 pasos
   - Envía mensajes usando la librería whatsapp-web.js
   - Ejecuta scripts Python para consultas

2. **Query Router (Python)**
   - Carga queries desde `config/queries.json`
   - Valida parámetros con Pydantic
   - Selecciona la query correcta según tipo de búsqueda

3. **Oracle Client**
   - Conexión directa a Oracle usando `oracledb`
   - Ejecuta consultas SQL con parámetros
   - Manejo de conexiones y errores

4. **Response Formatter**
   - Convierte resultados SQL a texto amigable
   - Agrupa por concepto (CG_DETALLE_SERVICIO)
   - Limita a 15 registros en detalle

---

## Estructura de la Base de Datos

### Tablas Principales

| Tabla | Descripción |
|-------|-------------|
| `CPR_DEPARTAMENTO` |Departamentos de Guatemala (22 municipios) |
| `CG_ENTIDAD` | Entidades/municipalidades dentro de cada departamento |
| `CUENTA_CORRIENTE` | Cuentas de cobro (impuestos, tasas, arbitrios) |
| `CONTRIBUYENTE_SERVICIO` | Contribuyentes relacionados con servicios |
| `SERVICIO_CATASTRO` | Catastros (identificadores de propiedades) |
| `CG_DETALLE_SERVICIO` | Conceptos de cobro (Descripción de servicios) |
| `CG_CONTRIBUYENTE` | Datos de contribuyentes (personas) |

### Relaciones entre Tablas

```
CPR_DEPARTAMENTO (CODIGO_DEPARTAMENTO)
    │
    └──► CG_ENTIDAD (ID_DEPARTAMENTO)
              │
              └──► CUENTA_CORRIENTE (ID_ENTIDAD)
                        │
                        ├──► CONTRIBUYENTE_SERVICIO (ID_CONTRIBUYENTE_SERVICIO)
                        │         │
                        │         └──► SERVICIO_CATASTRO (ID_SERVICIO_CATASTRO)
                        │         │
                        │         └──► CG_CONTRIBUYENTE (ID_CONTRIBUYENTE)
                        │
                        └──► CG_DETALLE_SERVICIO (ID_DETALLE_SERVICIO)
```

### Identificadores Comunes

- **Tarjeta**: ID en `CONTRIBUYENTE_SERVICIO.ID_CONTRIBUYENTE_SERVICIO`
- **Catastro**: Identificador en `SERVICIO_CATASTRO.IDENTIFICADOR` (formato: XXXXX-XXX-XXX)
- **DPI**: Documento Personal de Identificación en `CONTRIBUYENTE_SERVICIO.DPI`

---

## Flujo del Bot

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ 1. Bienvenida│───►│ 2. Depto    │───►│ 3. Entidad │───►│ 4. Tipo   │
│ (saludo     │    │ (1-22)      │    │ (1-N)      │    │ búsqueda  │
│ segun hora) │    │             │    │             │    │ (1/2/3)   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                             │
                                                             ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ 7. Resumen │◄───│ 6. Consulta│◄───│ 5. ID     │────│ (T/C/DPI) │
│ (agrupado   │    │ (seleccion)│    │ (ingreso) │    │           │
│ por concep)│    │            │    │            │    └─────────────┘
└─────────────┘    └─────────────┘    └─────────────┘
      │
      ▼
┌─────────────┐
│ 8. Detalle │
│ (por       │
│ tarjeta)   │
└─────────────┘
```

### Tipos de Búsqueda

1. **Por Tarjeta**: Buscar directamente por número de tarjeta
2. **Por Catastro**: Un catastro puede tener varias tarjetas
3. **Por Contribuyente (DPI)**: Un DPI puede tener varios catastros

### Ejemplo de Conversación

```
Usuario: Hola
Bot: ¡Buenos días!
    Soy el asistente de consultas de Cuenta Corriente.
    Puedo ayudarte a consultar: Cuentas pendientes
    Escribe 0 para reiniciar o X para salir.

Bot: Paso 1: Selecciona el DEPARTAMENTO
    1️⃣ Guatemala
    2️⃣ Escuintla
    ...

Usuario: 1

Bot: DEPARTAMENTO: Guatemala
    Paso 2: Selecciona la ENTIDAD
    1️⃣ Servicio de Agua
    2️⃣ Impuesto Único
    ...

Usuario: 1

Bot: ENTIDAD: Servicio de Agua
    Paso 3: Selecciona el TIPO DE BÚSQUEDA
    1️⃣ Por TARJETA
    2️⃣ Por CATASTRO
    3️⃣ Por CONTRIBUYENTE (DPI)

Usuario: 2

Bot: Has elegido: Buscar por CATASTRO
    Ingresa el NÚMERO DE CATASTRO:
    (Escribe X para reiniciar)

Usuario: 11608-721-122E

Bot: CATASTRO: 11608-721-122E
    Se encontraron 2 tarjeta(s) en este catastro:
    1️⃣ TARJETA: 12345   Nombre: JUAN PEREZ
    2️⃣ TARJETA: 67890   Nombre: MARIA LOPEZ

    T. Ver todas las cuentas del catastro (T)

Usuario: T

Bot: Paso 4: Selecciona la consulta:
    1️⃣ Cuentas Pendientes
    2️⃣ Generar Documento de Cobro

    0. Reiniciar
    X. Salir

Usuario: 1

Bot: Cuentas Pendientes
    Depto: Guatemala | Entidad: Servicio de Agua
    Tipo: CATASTRO
    ID: 11608-721-122E

    RESUMEN:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Concepto: AGUA POTABLE - Tasa de Mantenimiento
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Tarjeta: 12345 - JUAN PEREZ
      Total cuentas: 3
      Monto total: Q. 450.00

    Tarjeta: 67890 - MARIA LOPEZ
      Total cuentas: 2
      Monto total: Q. 300.00

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    TOTAL: Q. 750.00 (5 cuentas pendientes)

    Deseas ver el DETALLE?

    1️⃣ 12345 - JUAN PEREZ
    2️⃣ 67890 - MARIA LOPEZ
    T. Ver todas las tarjetas

    Escribe el número de la tarjeta:

Usuario: 1

Bot: DETALLE: Cuentas Pendientes
    Tarjeta: 12345 - JUAN PEREZ

    1️⃣ AGUA POTABLE - Tasa de Mantenimiento
       Periodo: ENE-2024
       Monto: Q. 150.00
       Estado: POR_PAGAR
       Vence: 15/02/2024
    ...
```
Usuario: Hola
Bot: ¡Buenos días!
    Soy el asistente de consultas de Cuenta Corriente.
    Puedo ayudarte a consultar: Cuentas pendientes
    Escribe 0 para reiniciar o X para salir.

Bot: Paso 1: Selecciona el DEPARTAMENTO
    1. Guatemala
    2. Escuintla
    ...

Usuario: 1

Bot: DEPARTAMENTO: Guatemala
    Paso 2: Selecciona la ENTIDAD
    1. Servicio de Agua
    2. Impuesto Único
    ...

Usuario: 1

Bot: ENTIDAD: Servicio de Agua
    Paso 3: Selecciona el TIPO DE BUSQUEDA
    1. Por TARJETA
    2. Por CATASTRO
    3. Por CONTRIBUYENTE (DPI)

Usuario: 2

Bot: Has elegido: Buscar por CATASTRO
    Ingresa el NUMERO DE CATASTRO:
    (Escribe X para reiniciar)

Usuario: 11608-721-122E

Bot: CATASTRO: 11608-721-122E
    Se encontraron 2 tarjeta(s) en este catastro:
    1. TARJETA: 12345   Nombre: JUAN PEREZ
    2. TARJETA: 67890   Nombre: MARIA LOPEZ

    T. Ver todas las cuentas del catastro (T)

Usuario: T

Bot: Paso 4: Selecciona la consulta:
    1. Cuentas Pendientes

    0. Reiniciar
    X. Salir

Usuario: 1

Bot: Cuentas Pendientes
    Depto: Guatemala | Entidad: Servicio de Agua
    Tipo: CATASTRO
    ID: 11608-721-122E

    RESUMEN:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Concepto: AGUA POTABLE - Tasa de Mantenimiento
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Tarjeta: 12345 - JUAN PEREZ
      Total cuentas: 3
      Monto total: Q. 450.00

    Tarjeta: 67890 - MARIA LOPEZ
      Total cuentas: 2
      Monto total: Q. 300.00

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    TOTAL: Q. 750.00 (5 cuentas pendientes)

    Deseas ver el DETALLE?

    1. 12345 - JUAN PEREZ
    2. 67890 - MARIA LOPEZ
    T. Ver todas las tarjetas

    Escribe el numero de la tarjeta:

Usuario: 1

Bot: DETALLE: Cuentas Pendientes
    Tarjeta: 12345 - JUAN PEREZ

    1. AGUA POTABLE - Tasa de Mantenimiento
       Periodo: ENE-2024
       Monto: Q. 150.00
       Estado: POR_PAGAR
       Vence: 15/02/2024
    ...
```

---

## Configuración

### 1. Variables de Entorno

Crear archivo `.env` en la raíz del proyecto:

```env
# Oracle Database
ORACLE_USER=SERVICIOS
ORACLE_PASSWORD=TU_PASSWORD_AQUI
ORACLE_DSN=172.18.28.233:1521/PDBQA

# WhatsApp (opcional, usa path por defecto)
WHATSAPP_SESSION=./data/session

# Ollama (opcional)
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

### 2. Dependencias

```bash
# Python
pip install -r requirements.txt

# Node.js
npm install
```

### 3. Consultas SQL

Las queries están definidas en `config/queries.json`. Cada query tiene:

- `id`: Identificador único
- `description`: Descripción legible
- `sql`: Sentencia SQL con parámetros
- `format`: Formato de respuesta
- `params`: Lista de parámetros requeridos

---

## Ejecución

### Iniciar el Bot

```bash
npm start
```

### Escaneo de QR

1. Al iniciar, se genera un código QR en `data/qr.png`
2. Abre WhatsApp en tu teléfono
3. Menú → Dispositivos vinculados → Vincular dispositivo
4. Escanea el código QR

### reiniciar el Bot

- Escribe `0` o `MENU` en cualquier momento
- Escribe `X` o `SALIR` para terminar

---

## Estructura de Archivos

```
BotServiciosGL/
├── .env                    # Configuración (no incluir en git)
├── .env.example            # Plantilla de configuración
├── .gitignore               # Archivos a ignorar
├── README.md                # Este archivo
├── requirements.txt        # Dependencias Python
├── package.json            # Dependencias Node.js
├── test_bot.py             # Script de prueba (sin WhatsApp)
│
├── config/
│   ├── queries.json        # Definición de queries SQL
│   ├── settings.py         # Configuración de conexión
│   └── __pycache__/        # Cache de Python
│
├── src/
│   ├── queries/
│   │   ├── query_router.py # Enrutador de queries
│   │   └── manager.py      # Gestor de consultas
│   ├── services/
│   │   ├── oracle_client.py # Cliente Oracle
│   │   └── ollama_client.py # Cliente Ollama (opcional)
│   └── models/
│       └── schemas.py      # Esquemas Pydantic
│
├── whatsapp/
│   ├── service.cjs        # Lógica del bot de WhatsApp
│   ├── bot.cjs            # Punto de entrada
│   └── data/
│       └── session/        # Sesión de WhatsApp (auto-generado)
│
└── data/                  # Archivos de datos
    └── qr.png             # Código QR (auto-generado)
```

---

## Formatos de Respuesta

### Formatos Soportados

| Format | Descripción | Ejemplo |
|--------|--------------|---------|
| `menu` | Lista numerada | "1. Opción A\n2. Opción B" |
| `resumen` | Resumen agrupado por concepto | "Concepto: AGUA\nTotal: Q.100" |
| `resumen_por_tarjeta` | Resumen con desglose por tarjeta | "Tarjeta: 123\nConcepto: AGUA" |
| `detalle` | Lista de cuentas individuales | "Periodo: ENE-2024\nMonto: Q.50" |
| `contribuyentes` | Lista de contribuyentes | "DPI: 12345678\nNombre: Juan" |

### Límites

- **Detalle**: Máximo 15 registros por consulta
- **Mensaje**: WhatsApp acepta hasta 64KB por mensaje

---

## Licencia

MIT