#!/usr/bin/env python3
import sys
import os
import json
import ollama

def classify_search_intent(user_message):
    """
    Usa Ollama para clasificar la intención de búsqueda.
    Retorna: {'tipo': 'TARJETA'|'CATASTRO'|'CONTRIBUYENTE'|None, 'identificador': str|None}
    """
    prompt = """Extrae tipo e identificador de: "{}"

Responde JSON:
{{"tipo": "TARJETA"|"CATASTRO"|"CONTRIBUYENTE"|"", "identificador": "valor"|""}}

Ejemplos:
"por tarjeta 12345" -> {{"tipo": "TARJETA", "identificador": "12345"}}
"catastro 11608-721-122E" -> {{"tipo": "CATASTRO", "identificador": "11608-721-122E"}}
"DPI 1234567890123" -> {{"tipo": "CONTRIBUYENTE", "identificador": "1234567890123"}}
"por tarjeta" -> {{"tipo": "TARJETA", "identificador": ""}}""".format(user_message)
    
    try:
        response = ollama.generate(
            model='llama3.2:1b',
            prompt=prompt,
            system="Eres un asistente que responde solo con JSON válido.",
            options={'temperature': 0, 'num_predict': 100}
        )
        
        text = response['response'].strip()
        
        # Buscar JSON en la respuesta
        start = text.find('{')
        end = text.rfind('}') + 1
        
        if start >= 0 and end > start:
            json_str = text[start:end]
            # Reemplazar comillas simples por dobles si es necesario
            json_str = json_str.replace("'", '"')
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
