#!/usr/bin/env python3
import sys
import os
import json
import re
import ollama

def extract_identifiers(text):
    """Extract ALL identifiers from message, avoiding substring duplicates"""
    text_upper = text.upper()
    identifiers = []
    
    # Patrones en orden: el más específico primero
    patrones = [
        r'\b(\d{13})\b',  # 13 dígitos DPI
        r'\b([A-Z0-9]+(?:-[A-Z0-9]+){1,3})\b',  # 2-4 partes con guiones (09-01-U01-196852)
        r'\b([A-Z]+\d+)\b',  # Letra + dígitos, sin guiones (A124, ASDB123)
        r'\b(\d+)\b',  # Solo dígitos (123, 456)
    ]
    
    # Primera pasada: recolectar todos los identificadores potenciales
    for patron in patrones:
        for match in re.finditer(patron, text_upper):
            identifier = match.group(1)
            if identifier not in identifiers:
                identifiers.append(identifier)
    
    # Segunda pasada: remover identificadores que son substring de otros
    # Comparar posiciones en el texto original para decidir
    filtered = []
    for ident in identifiers:
        is_substring = False
        ident_pos = text_upper.find(ident)
        for other in identifiers:
            if ident != other and ident in other:
                other_pos = text_upper.find(other)
                # Si other contiene a ident y están en la misma posición o superpuesta, filtrar ident
                if ident_pos >= other_pos and ident_pos < other_pos + len(other):
                    is_substring = True
                    break
        if not is_substring:
            filtered.append(ident)
    
    return filtered

def get_context_type(text, identifier):
    """Get type based on keyword that DIRECTLY PRECEDES the identifier"""
    text_upper = text.upper()
    idx = text_upper.find(identifier)
    if idx < 0:
        return None
    
    # Buscar hacia atrás desde la posición del identificador (máximo 30 caracteres)
    # para encontrar la palabra clave que lo precede
    search_start = max(0, idx - 30)
    preceding_text = text_upper[search_start:idx]
    
    # Buscar la ÚLTIMA ocurrencia de cada palabra clave en el texto precedente
    last_tarjeta = preceding_text.rfind('TARJETA')
    last_tarjetas = preceding_text.rfind('TARJETAS')
    last_catastro = preceding_text.rfind('CATASTRO')
    last_catastral = preceding_text.rfind('CATRASTRAL')
    last_contribuyente = preceding_text.rfind('CONTRIBUYENTE')
    last_dpi = preceding_text.rfind('DPI')
    last_cedula = preceding_text.rfind('CEDULA')
    
    # Encontrar cuál está más cerca (mayor posición en el texto precedente)
    candidates = [
        (last_tarjeta, "TARJETA"),
        (last_tarjetas, "TARJETA"),
        (last_catastro, "CATASTRO"),
        (last_catastral, "CATASTRO"),
        (last_contribuyente, "CONTRIBUYENTE"),
        (last_dpi, "CONTRIBUYENTE"),
        (last_cedula, "CONTRIBUYENTE"),
    ]
    
    # Filtrar solo los que se encontraron (posición >= 0)
    found = [(pos, tipo) for pos, tipo in candidates if pos >= 0]
    
    if not found:
        return None
    
    # El que tenga la posición más alta (más cercano al identificador)
    found.sort(key=lambda x: x[0], reverse=True)
    return found[0][1]

def classify_with_ollama(user_message):
    """Use Ollama to classify type - only if no keyword context found"""
    prompt = 'Analiza: "' + user_message + '"\n\nResponde SOLO JSON sin markdown:\n{"tipo": "TARJETA"}\n{"tipo": "CATASTRO"}\n{"tipo": "CONTRIBUYENTE"}\n{"tipo": ""}'
    
    try:
        response = ollama.generate(
            model='llama3.2:1b',
            prompt=prompt,
            system="You are a classifier. Respond only valid JSON without extra text.",
            options={'temperature': 0, 'num_predict': 50}
        )
        
        text = response['response'].strip()
        start = text.find('{')
        end = text.rfind('}') + 1
        
        if start >= 0 and end > start:
            json_str = text[start:end].replace("'", '"')
            # Only extract the 'tipo' field, ignore others
            result = json.loads(json_str)
            tipo_ollama = result.get('tipo', '')
            if tipo_ollama in ['TARJETA', 'CATASTRO', 'CONTRIBUYENTE']:
                return tipo_ollama
    except Exception as e:
        sys.stderr.write("ERROR Ollama: {}\n".format(str(e)))
    
    return ""

def classify_search_intent(user_message):
    """
    For each identifier, detect type based on keyword that DIRECTLY PRECEDES it.
    Use Ollama ONLY if no keyword context is found.
    Return LIST of queries for multiple searches.
    """
    results = []
    
    # 1. Extract ALL identifiers
    identifiers = extract_identifiers(user_message)
    
    # 2. For each identifier, detect type based on preceding keyword
    for ident in identifiers:
        tipo = get_context_type(user_message, ident)
        
        # Si no hay contexto, usar Ollama como respaldo
        if not tipo:
            tipo = classify_with_ollama(user_message)
            if not tipo:
                tipo = None
        
        results.append({
            'tipo': tipo,
            'identificador': ident
        })
    
    return results

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps([]))
        sys.exit(0)
    
    user_message = ' '.join(sys.argv[1:])
    result = classify_search_intent(user_message)
    print(json.dumps(result))