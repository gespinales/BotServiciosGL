import os
from dotenv import load_dotenv
from src.queries.manager import load_queries_config, process_message
from src.services.whatsapp_client import whatsapp

load_dotenv()

async def main():
    print("Iniciando Agente IA SQL + WhatsApp...")
    
    load_queries_config()
    
    print("Conectando WhatsApp...")
    await whatsapp.connect()
    
    print("Agente listo. Esperando mensajes...")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
