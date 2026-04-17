import json
import os
from config.settings import config
from src.queries.query_router import load_queries, route_query, execute_query
from src.services.ollama_client import ollama_client

QUERIES_FILE = "config/queries.json"

def load_queries_config():
    if os.path.exists(QUERIES_FILE):
        with open(QUERIES_FILE, "r", encoding="utf-8") as f:
            queries = json.load(f)
            load_queries(queries)
            print(f"Cargadas {len(queries)} consultas")

def save_queries_config(queries: list):
    with open(QUERIES_FILE, "w", encoding="utf-8") as f:
        json.dump(queries, f, indent=2, ensure_ascii=False)
    load_queries_config()

def process_message(user_message: str) -> str:
    query_id, query, params = route_query(user_message)
    
    if not query:
        return "Lo siento, no pude entender tu consulta. ¿Podrías reformularla?"
    
    if not params.get("identificador"):
        return "No encontré el identificador en tu mensaje. Por favor incluye el número de cuenta o identificador."
    
    result = execute_query(query_id, params)
    
    if not result.success:
        return f"Error al ejecutar la consulta: {result.error}"
    
    return result.formatted_output
