import asyncio
import logging
from typing import Optional
from config.settings import config

logger = logging.getLogger(__name__)

class WhatsAppService:
    def __init__(self):
        self.client: Optional[Any] = None
        self.sock: Optional[Any] = None

    async def connect(self):
        try:
            from Baileys import WaSocket
            from Baileys.Store.Memory import MemoryStore
            
            self.sock = WaSocket(MemoryStore(), True)
            
            session = await self.load_session()
            if session:
                await self.sock.connect()
                logger.info("WhatsApp conectado")
            else:
                logger.info("Necesitas escanear el código QR")
        except Exception as e:
            logger.error(f"Error conectando WhatsApp: {e}")

    async def load_session(self) -> bool:
        import os
        session_file = os.path.join(config.whatsapp_session, "auth.json")
        
        if os.path.exists(session_file):
            with open(session_file, "rb") as f:
                return f.read()
        return None

    async def save_session(self, session_data):
        import os
        os.makedirs(config.whatsapp_session, exist_ok=True)
        with open(os.path.join(config.whatsapp_session, "auth.json"), "wb") as f:
            f.write(session_data)

    async def send_message(self, jid: str, message: str):
        if self.sock:
            await self.sock.sendMessage(jid, message)

    async def on_message(self, handler):
        pass

whatsapp = WhatsAppService()
