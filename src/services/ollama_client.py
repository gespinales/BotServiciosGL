import ollama
import re
from config.settings import config

class OllamaClient:
    def __init__(self):
        self.model = config.ollama_model
        self.host = config.ollama_host
        self._keyword_rules = {
            "pendiente": "cta_pendiente_catastro",
            "pendientes": "cta_pendiente_catastro",
            "vencida": "cta_vencida_catastro",
            "vencidas": "cta_vencida_catastro",
            "pagada": "cta_pagadas_catastro",
            "pagadas": "cta_pagadas_catastro",
            "multa": "cta_multas_catastro",
            "multas": "cta_multas_catastro",
            "todas": "cta_all_catastro",
            "todo": "cta_all_catastro",
            "resumen": "resumen_catastro",
            "adeudo": "total_adeudo_catastro",
            "total": "total_adeudo_catastro",
            "entidad": "entidades_catastro",
            "entidades": "entidades_catastro",
            "municipalidad": "entidades_catastro",
            "municipalidades": "entidades_catastro",
        }

    def classify_intent(self, user_message: str, available_queries: list[dict]) -> tuple[str, dict]:
        msg_lower = user_message.lower()
        
        for keyword, query_id in self._keyword_rules.items():
            if keyword in msg_lower:
                identificador = self._extract_identificador(user_message)
                if identificador:
                    return query_id, {"identificador": identificador}
        
        try:
            query_descriptions = "\n".join([
                f"- {q['id']}: {q['description']}" 
                for q in available_queries
            ])
            
            prompt = f"""Clasifica esta solicitud. Responde solo con el ID.

Solicitud: {user_message}
IDs: cta_pendiente_catastro, cta_vencida_catastro, cta_pagadas_catastro, cta_multas_catastro, cta_all_catastro, resumen_catastro, total_adeudo_catastro"""

            response = ollama.generate(
                model=self.model,
                prompt=prompt,
                options={"temperature": 0, "num_predict": 50}
            )
            
            result_text = response['response'].strip()
            query_id = self._extract_query_id(result_text, available_queries)
            
            if query_id != "NONE":
                identificador = self._extract_identificador(user_message)
                params = {"identificador": identificador} if identificador else {}
                return query_id, params
        except:
            pass
        
        return "NONE", {}

    def _extract_query_id(self, text: str, available_queries: list[dict]) -> str:
        valid_ids = [q['id'] for q in available_queries]
        text_lower = text.lower()
        for vid in valid_ids:
            if vid.lower() in text_lower:
                return vid
        return "NONE"

    def _extract_identificador(self, text: str) -> str:
        text_upper = text.upper()
        
        patrones = [
            r'IDENTIFICADOR[:\s]+([A-Z0-9\-]+)',
            r'CUENTA[:\s]+([A-Z0-9\-]+)',
            r'REFERENCIA[:\s]+([A-Z0-9\-]+)',
            r'\b([A-Z]-\d+[A-Z0-9]*)\b',
            r'\b([A-Z]{1,2}-\d+)\b',
            r'\b([A-Z]{1,4}\d{3,})\b',
            r'\b(\d{4,})\b',
        ]
        
        for patron in patrones:
            match = re.search(patron, text_upper)
            if match:
                return match.group(1)
        
        return ""

    def generate_response(self, data: str) -> str:
        return data

ollama_client = OllamaClient()
