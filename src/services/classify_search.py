#!/usr/bin/env python3
import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from src.services.ollama_client import ollama_client

def classify_search_intent(user_message):
    """
    Usa Ollama para clasificar la intención de búsqueda.
    Retorna: {'tipo': 'TARJETA'|'CATASTRO'|'CONTRIBUYENTE'|None, 'identificador': str|None}
    """
    prompt = """Analiza el siguiente mensaje de un usuario que está en el paso 3 de un bot de consulta de cuenta corriente.
El usuario debe seleccionar el tipo de búsqueda: Por Tarjeta, Por Catastro, o Por Contribuyente (DPI).

Mensaje del usuario: "{msg}"

Responde ÚNICAMENTE en formato JSON:
{{"tipo": "TARJETA" si menciona tarjeta, "CATASTRO" si menciona catastro, "CONTRIBUYENTE" si menciona contribuyente/DPI, o null si no se puede determinar,
"identificador": "el número o valor que identifica la búsqueda (tarjeta, catastro o DPI) si se proporciona, o null si no se menciona"}}

Ejemplos:
- "1" -> {{"tipo": null, "identificador": null}}
- "por tarjeta" -> {{"tipo": "TARJETA", "identificador": null}}
- "tarjeta 12345" -> {{"tipo": "TARJETA", "identificador": "12345"}}
- "buscar catastro 11608-721-122E" -> {{"tipo": "CATASTRO", "identificador": "11608-721-122E"}}
- "consultar por DPI 1234567890123" -> {{"tipo": "CONTRIBUYENTE", "identificador": "1234567890123"}}
- "por contribuyente" -> {{"tipo": "CONTRIBUYENTE", "identificador": null}}
""".replace("{msg}", user_message)
    
    try:
        response = ollama_client.client.generate(
            model=ollama_client.model,
            prompt=prompt,
            system="Eres un asistente que clasifica intenciones de búsqueda. Responde solo con JSON válido."
        )
        
        text = response['response'].strip() if isinstance(response, dict) else str(response).strip()
        
        # Intentar extraer JSON de la respuesta
        start = text.find('{')
        end = text.rfind('}') + 1
        
        if start >= 0 and end > start:
            json_str = text[start:end]
            result = json.loads(json_str)
            return result
        
        return {'tipo': None, 'identificador': None}
    except Exception as e:
        sys.stderr.write("ERROR: {}\n".format(str(e)))
        return {'tipo': None, 'identificador': None}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({'tipo': None, 'identificador': None}))
        sys.exit(0)
    
    user_message = ' '.join(sys.argv[1:])
    result = classify_search_intent(user_message)
    print(json.dumps(result))
