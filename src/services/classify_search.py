#!/usr/bin/env python3
import sys
import os
import json
import re

def classify_search_intent(user_message):
    """
    Clasifica el tipo de búsqueda basado en palabras clave.
    Extrae identificador con regex.
    """
    text_upper = user_message.upper()
    
    # 1. Determinar tipo por palabras clave
    tipo = None
    if re.search(r'\b(TARJETA|TARJETAS)\b', text_upper):
        tipo = 'TARJETA'
    elif re.search(r'\b(CATASTRO|CATASTRAL)\b', text_upper):
        tipo = 'CATASTRO'
    elif re.search(r'\b(CONTRIBUYENTE|DPI|CEDULA)\b', text_upper):
        tipo = 'CONTRIBUYENTE'
    
    # 2. Extraer identificador con regex
    identifier = None
    
    # Patrones específicos (orden: del más específico al general)
    patrones = [
        r'\b([A-Z0-9]{2,10}-[A-Z0-9]{1,10}-[A-Z0-9]{1,10}-[A-Z0-9]{1,10})\b',  # Catastro: 09-01-U01-196852
        r'\b(\d{5}-\d{3}-\d{3}[A-Z]?)\b',         # Catastro: 12345-678-901A
        r'\b(\d{13})\b',                           # DPI: 13 dígitos
        r'\b([A-Z0-9]{1,10}-[A-Z0-9]{1,10})\b',  # Con guión: A123-1, 196852-000031
        r'\b([A-Z]\d{1,6})\b',                  # Sin guión: A124, B456 (letra + dígitos)
    ]
    
    for patron in patrones:
        match = re.search(patron, text_upper)
        if match:
            identifier = match.group(1)
            break
    
    return {
        'tipo': tipo,
        'identificador': identifier
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({'tipo': None, 'identificador': None}))
        sys.exit(0)
    
    user_message = ' '.join(sys.argv[1:])
    result = classify_search_intent(user_message)
    print(json.dumps(result))
