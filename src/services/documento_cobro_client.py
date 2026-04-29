import requests
import base64
import os
from dotenv import load_dotenv

load_dotenv()

API_BASE_URL = os.getenv("DOCUMENTO_COBRO_API_URL")
API_USER = os.getenv("DOCUMENTO_COBRO_USER")
API_PASSWORD = os.getenv("DOCUMENTO_COBRO_PASSWORD")


class DocumentoCobroClient:
    
    def __init__(self, base_url: str = None, user: str = None, password: str = None):
        self.base_url = base_url or API_BASE_URL
        self.user = user or API_USER
        self.password = password or API_PASSWORD
    
    def generar_documento_cobro(self, id_entidad: int, id_contribuyente: int, cuentas_corrientes: list[int]) -> dict:
        payload = {
            "ID_ENTIDAD": id_entidad,
            "STR_USR": self.user,
            "STRPWD": self.password,
            "REPORTE": "GENERAR_DOCUMENTO_COBRO_CUENTA_CORRIENTE",
            "ID_CONTRIBUYENTE_DOC": id_contribuyente,
            "CUENTAS_CORRIENTES": ",".join(map(str, cuentas_corrientes))
        }
        
        url = f"{self.base_url}/api/comunicabanco/consultareporte"
        
        try:
            response = requests.post(url, json=payload, timeout=60)
            response.raise_for_status()
            return self._parse_response(response.json())
        except requests.exceptions.Timeout:
            return {
                "success": False,
                "error": "Tiempo de espera agotado al conectar con el API"
            }
        except requests.exceptions.ConnectionError:
            return {
                "success": False,
                "error": "No se pudo conectar con el API. Verifique que esté corriendo."
            }
        except requests.exceptions.RequestException as e:
            return {
                "success": False,
                "error": f"Error en la petición: {str(e)}"
            }
    
    def _parse_response(self, response_data: dict) -> dict:
        try:
            if response_data.get("mensajeError"):
                return {
                    "success": False,
                    "error": response_data.get("mensajeError")
                }
            
            documento_bytes = ""
            
            if response_data.get("Documento_Bytes"):
                documento_bytes = response_data.get("Documento_Bytes", "")
            elif response_data.get("data"):
                import json
                data_str = response_data.get("data", "")
                if data_str:
                    inner_data = json.loads(data_str)
                    documento_bytes = inner_data.get("Documento_Bytes", "")
            
            if documento_bytes:
                pdf_bytes = base64.b64decode(documento_bytes)
                return {
                    "success": True,
                    "pdf_bytes": pdf_bytes,
                    "documento_info": response_data.get("mdlDocumento", [])
                }
            else:
                return {
                    "success": False,
                    "error": "El API no retornó bytes del documento"
                }
                
        except Exception as e:
            return {
                "success": False,
                "error": f"Error al procesar respuesta: {str(e)}"
            }
            
            if documento_bytes:
                pdf_bytes = base64.b64decode(documento_bytes)
                return {
                    "success": True,
                    "pdf_bytes": pdf_bytes,
                    "documento_info": response_data.get("mdlDocumento", [])
                }
            else:
                return {
                    "success": False,
                    "error": "El API no retornó bytes del documento"
                }
                
        except Exception as e:
            return {
                "success": False,
                "error": f"Error al procesar respuesta: {str(e)}"
            }
    
    def guardar_pdf(self, pdf_bytes: bytes, filename: str) -> str:
        output_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "documentos")
        os.makedirs(output_dir, exist_ok=True)
        
        filepath = os.path.join(output_dir, filename)
        with open(filepath, "wb") as f:
            f.write(pdf_bytes)
        
        return filepath


documento_client = DocumentoCobroClient()