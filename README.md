# Agente SQL + WhatsApp

Agente de IA que responde consultas de base de datos Oracle vía WhatsApp, usando modelos locales (Ollama).

## Características

- Conexión directa a Oracle Database
- Bot de WhatsApp con Baileys
- Consultas predefinidas de solo lectura
- Flujo de 3 pasos: Departamento → Entidad → Identificador
- Búsqueda por: Tarjeta, Catastro, Contribuyente (DPI)
- Resumen agrupado por concepto + opción de detalle
- Mensaje de bienvenida según hora del servidor

## Requisitos

- Python 3.10+
- Node.js 18+
- Oracle Database
- Ollama (opcional, paraIA)

## Instalación

```bash
# Clonar el repositorio
git clone <url-del-repositorio>
cd WSPython

# Instalar dependencias Python
pip install -r requirements.txt

# Instalar dependencias Node
npm install
```

## Configuración

1. Copiar el archivo de configuración:
```bash
cp .env.example .env
```

2. Editar `.env` con tus credenciales:
```env
ORACLE_USER=SERVICIOS
ORACLE_PASSWORD=TU_PASSWORD
ORACLE_DSN=172.18.28.233:1521/PDBQA

WHATSAPP_SESSION=./data/session
```

## Ejecución

```bash
# Iniciar el bot de WhatsApp
npm start
```

Escanea el código QR con tu WhatsApp para conectar.

## Flujo del Bot

1. **Bienvenida**: Saludo según hora (Buenos días/tardes/noches)
2. **Departamento**: Seleccionar departamento
3. **Entidad**: Seleccionar municipalidad
4. **Tipo de búsqueda**:
   - Por Tarjeta
   - Por Catastro
   - Por Contribuyente (DPI)
5. **Identificador**: Ingresar número según tipo
6. **Consulta**: Seleccionar tipo de cuenta
7. **Resumen**: Ver resumen agrupado
8. **Detalle**: Solicitar por tarjeta específica

## Estructura del Proyecto

```
WSPython/
├── config/
│   ├── queries.json       # Consultas SQL
│   └── settings.py        # Configuración
├── src/
│   ├── queries/
│   │   ├── query_router.py
│   │   └── manager.py
│   ├── services/
│   │   ├── oracle_client.py
│   │   └── ollama_client.py
│   └── models/
│       └── schemas.py
├── whatsapp/
│   └── service.cjs        # Bot de WhatsApp
├── test_bot.py            # Script de prueba
├── requirements.txt
└── package.json
```

## Licencia

MIT