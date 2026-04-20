#!/usr/bin/env python3
"""
Simulador de conversación del Bot de WhatsApp.
Permite probar el flujo completo de 4 pasos de manera interactiva.
"""
import json
import os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

from src.queries.query_router import load_queries, execute_query

load_queries(json.load(open('config/queries.json', 'r', encoding='utf-8')))


class SimuladorBot:
    def __init__(self):
        self.estado = {}
        self.departamentos = []
        self.entidades = []
        self.tarjetas = []
        self.catastros = []
        self.query_seleccionada = None
        
    def get_saludo(self):
        ahora = datetime.now()
        hora = ahora.hour
        
        if 5 <= hora < 12:
            return '¡Buenos días!'
        elif 12 <= hora < 18:
            return '¡Buenas tardes!'
        else:
            return '¡Buenas noches!'
    
    def limpiar_estado(self):
        self.estado = {}
        self.entidades = []
        self.tarjetas = []
        self.catastros = []
        self.query_seleccionada = None
    
    def paso_bienvenida(self):
        print("\n" + "=" * 60)
        print(">>> USUARIO ENVÍA: 'Hola'")
        print("=" * 60)
        
        saludo = self.get_saludo()
        print(f"\n{saludo}")
        print()
        print("Soy el asistente de consultas de Cuenta Corriente.")
        print()
        print("Puedo ayudarte a consultar:")
        print("- Cuentas pendientes")
        print()
        print("Para comenzar, escribe cualquier texto o numero para iniciar la consulta.")
        print()
        print("Escribe 0 en cualquier momento para reiniciar.")
        print("Escribe X para salir.")
        print()
        
        input(">>> Presiona ENTER para continuar...")
    
    def paso_departamentos(self):
        result = execute_query('departamentos', {})
        self.departamentos = result.data
        
        print("\n" + "=" * 60)
        print("PASO 1: SELECCIONAR DEPARTAMENTO")
        print("=" * 60)
        print()
        print("CONSULTAS DE CUENTA CORRIENTE")
        print()
        print("Paso 1: Selecciona el DEPARTAMENTO")
        print()
        
        for i, d in enumerate(self.departamentos, 1):
            print(f"{i}. {d['NOMBRE']}")
        
        print()
        print("Escribe el numero")
        
        return self._obtener_opcion(len(self.departamentos), "departamento")
    
    def paso_entidades(self, depto_idx):
        depto = self.departamentos[depto_idx - 1]
        self.estado['departamento'] = depto['CODIGO_DEPARTAMENTO']
        self.estado['deptoNombre'] = depto['NOMBRE']
        
        result = execute_query('entidades_por_departamento', {
            'codigo_departamento': depto['CODIGO_DEPARTAMENTO']
        })
        self.entidades = result.data
        
        print("\n" + "=" * 60)
        print(f"PASO 2: ENTIDADES - {depto['NOMBRE']}")
        print("=" * 60)
        print()
        print(f"DEPARTAMENTO: {depto['NOMBRE']}")
        print()
        print("Paso 2: Selecciona la ENTIDAD")
        print()
        
        for i, e in enumerate(self.entidades, 1):
            print(f"{i}. {e['ENTIDAD']}")
        
        print()
        print("Escribe el numero")
        
        return self._obtener_opcion(len(self.entidades), "entidad")
    
    def paso_tipo_busqueda(self, entidad_idx):
        ent = self.entidades[entidad_idx - 1]
        self.estado['entidad'] = ent['ID_ENTIDAD']
        self.estado['entidadNombre'] = ent['ENTIDAD']
        
        print("\n" + "=" * 60)
        print("PASO 3: TIPO DE BUSQUEDA")
        print("=" * 60)
        print()
        print(f"ENTIDAD: {ent['ENTIDAD']}")
        print()
        print("Paso 3: Selecciona el TIPO DE BUSQUEDA")
        print()
        print("1. Por TARJETA")
        print("   (Buscar directamente por numero de tarjeta)")
        print()
        print("2. Por CATASTRO")
        print("   (Un catastro puede tener varias tarjetas)")
        print()
        print("3. Por CONTRIBYENTE (DPI)")
        print("   (Un contribuyente puede tener varios catastros)")
        print()
        print("Escribe el numero (1, 2 o 3)")
        
        return self._obtener_opcion(3, "tipo_busqueda")
    
    def _obtener_opcion(self, max_opcion, nombre_opcion):
        while True:
            try:
                opcion = input(f"\n>>> Tu respuesta: ").strip().upper()
                
                if opcion in ['X', 'SALIR']:
                    print("\nHasta luego!")
                    return None
                
                if opcion == '0':
                    print("\nReiniciando...")
                    self.limpiar_estado()
                    return 'REINICIAR'
                
                num = int(opcion)
                if 1 <= num <= max_opcion:
                    return num
                else:
                    print(f"Numero no valido. Debe ser entre 1 y {max_opcion}")
            except ValueError:
                print("Debes ingresar un numero")
    
    def paso_identificador(self, tipo_idx):
        tipos = {1: 'TARJETA', 2: 'CATASTRO', 3: 'CONTRIBUYENTE'}
        prompts = {
            1: 'Ingresa el NUMERO DE TARJETA',
            2: 'Ingresa el NUMERO DE CATASTRO',
            3: 'Ingresa el DPI del contribuyente'
        }
        
        tipo = tipos[tipo_idx]
        self.estado['tipoBusqueda'] = tipo
        
        print("\n" + "=" * 60)
        print(f"PASO 4: IDENTIFICADOR ({tipo})")
        print("=" * 60)
        print()
        print(f"Has elegido: Buscar por {tipo}")
        print()
        print(f"{prompts[tipo_idx]}):")
        print("(Escribe X para reiniciar)")
        
        identificador = input("\n>>> Tu respuesta: ").strip().upper()
        
        if identificador in ['X']:
            print("\nReiniciando...")
            self.limpiar_estado()
            return None
        
        self.estado['identificador'] = identificador
        return identificador
    
    def mostrar_catastros_contribuyente(self, dpi):
        result = execute_query('catastros_por_contribuyente', {
            'dpi': dpi,
            'codigo_departamento': self.estado['departamento']
        })
        
        if result.success and result.data:
            self.catastros = result.data
            print("\n" + "=" * 60)
            print(f"CATASTROS DEL CONTRIBUYENTE: {dpi}")
            print("=" * 60)
            print()
            print(f"CONTRIBUYENTE: {dpi}")
            print()
            print(f"Se encontraron {len(result.data)} catastro(s):")
            print()
            
            for i, c in enumerate(result.data, 1):
                print(f"{i}. CATASTRO: {c['CATASTRO']}")
                print(f"   Entidad: {c['ENTIDAD']}")
                print()
            
            print("T. Ver todas las tarjetas (T)")
            print()
            print("Escribe el numero del catastro para ver sus cuentas, o T para ver todas:")
            
            opcion = self._obtener_opcion(len(self.catastros), "catastro")
            
            if opcion == 'REINICIAR':
                return None
            
            if opcion == 'T':
                self.estado['catastroSeleccionado'] = 'TODAS'
            else:
                self.estado['catastroSeleccionado'] = self.catastros[opcion - 1]['CATASTRO']
            
            return True
        else:
            print(f"\nNo se encontraron catastros para el DPI: {dpi}")
            return None
    
    def mostrar_tarjetas_catastro(self, catastro):
        result = execute_query('tarjetas_por_catastro', {
            'catastro': catastro,
            'id_entidad': self.estado['entidad']
        })
        
        if result.success and result.data:
            self.tarjetas = result.data
            print("\n" + "=" * 60)
            print(f"TARJETAS DEL CATASTRO: {catastro}")
            print("=" * 60)
            print()
            print(f"CATASTRO: {catastro}")
            print()
            print(f"Se encontraron {len(result.data)} tarjeta(s) en este catastro:")
            print()
            
            for i, t in enumerate(result.data, 1):
                print(f"{i}. TARJETA: {t['ID_TARJETA']}")
                print(f"   Nombre: {t['NOMBRE']}")
                print()
            
            print("T. Ver todas las cuentas del catastro (T)")
            print()
            print("Escribe el numero de tarjeta para ver sus cuentas, o T para ver el resumen completo del catastro:")
            
            opcion = self._obtener_opcion(len(self.tarjetas), "tarjeta")
            
            if opcion == 'REINICIAR':
                return None
            
            if opcion == 'T':
                self.estado['tarjetaSeleccionada'] = 'TODAS'
                self.estado['tipoBusqueda'] = 'CATASTRO'
            else:
                self.estado['tarjetaSeleccionada'] = self.tarjetas[opcion - 1]['ID_TARJETA']
                self.estado['tarjetaNombre'] = self.tarjetas[opcion - 1]['NOMBRE']
                self.estado['tipoBusqueda'] = 'TARJETA_CATASTRO'
            
            return True
        else:
            print(f"\nNo se encontraron tarjetas para el catastro: {catastro}")
            return None
    
    def paso_menu_consultas(self):
        print("\n" + "=" * 60)
        print("PASO 5: CONSULTAS")
        print("=" * 60)
        print()
        
        id_label = self.estado.get('identificador', '')
        if self.estado.get('tipoBusqueda') == 'TARJETA_CATASTRO':
            id_label = f"{self.estado.get('identificador')} > {self.estado.get('tarjetaSeleccionada')}"
        
        print("CONSULTA DE CUENTA CORRIENTE")
        print()
        print(f"Departamento: {self.estado.get('deptoNombre')}")
        print(f"Entidad: {self.estado.get('entidadNombre')}")
        print(f"Tipo: {self.estado.get('tipoBusqueda')}")
        if self.estado.get('catastroSeleccionado'):
            print(f"ID: {self.estado.get('identificador')} > {self.estado.get('catastroSeleccionado')}")
        else:
            print(f"ID: {id_label}")
        print()
        print("Paso 4: Selecciona la consulta:")
        print("1. Cuentas Pendientes")
        print()
        print("0. Reiniciar")
        print("X. Salir")
        
        return self._obtener_opcion(1, "consulta")
    
    def ejecutar_resumen(self):
        query_id = 'cta_pendiente_tarjeta_agrupado'
        params = {
            'identificador': self.estado['identificador'],
            'id_entidad': self.estado['entidad']
        }
        
        if self.estado.get('tipoBusqueda') == 'TARJETA_CATASTRO':
            query_id = 'cta_pendiente_tarjeta'
            params = {
                'id_tarjeta': self.estado['tarjetaSeleccionada'],
                'id_entidad': self.estado['entidad']
            }
        elif self.estado.get('tipoBusqueda') == 'CONTRIBUYENTE':
            query_id = 'cta_pendiente_contribuyente'
            dpi = self.estado.get('catastroSeleccionado', self.estado['identificador'])
            params = {
                'dpi': dpi,
                'id_entidad': self.estado['entidad']
            }
        
        result = execute_query(query_id, params)
        
        print("\n" + "=" * 60)
        print("RESUMEN DE CUENTAS")
        print("=" * 60)
        print()
        
        if result.success:
            header = "Cuentas Pendientes\n"
            header += f"Depto: {self.estado.get('deptoNombre')} | Entidad: {self.estado.get('entidadNombre')}\n"
            header += f"Tipo: {self.estado.get('tipoBusqueda')}"
            if self.estado.get('catastroSeleccionado'):
                header += f" > {self.estado.get('catastroSeleccionado')}"
            header += f"\nID: {self.estado.get('identificador')}\n"
            
            print(header)
            print(result.formatted_output)
        else:
            print(f"Error: {result.error}")
        
        return result.success
    
    def pedir_seleccion_detalle(self):
        if not self.tarjetas:
            result = execute_query('tarjetas_por_catastro', {
                'catastro': self.estado['identificador'],
                'id_entidad': self.estado['entidad']
            })
            if result.success and result.data:
                self.tarjetas = result.data
            else:
                return None
        
        print("\n" + "=" * 60)
        print("SELECCIONAR TARJETA PARA DETALLE")
        print("=" * 60)
        print()
        print("Deseas ver el DETALLE?")
        print()
        
        for i, t in enumerate(self.tarjetas, 1):
            print(f"{i}. {t['ID_TARJETA']} - {t.get('NOMBRE', 'N/A')}")
        
        print()
        print("T. Ver todas las tarjetas")
        print()
        print("Escribe el numero de la tarjeta:")
        
        return self._obtener_opcion(len(self.tarjetas), "detalle_tarjeta")
    
    def ejecutar_detalle(self, opcion_tarjeta=None):
        if opcion_tarjeta == 'T':
            tarjeta_sel = 'TODAS'
            query_id = 'cta_pendiente_detalle'
            params = {
                'identificador': self.estado['identificador'],
                'id_entidad': self.estado['entidad']
            }
        elif opcion_tarjeta and self.tarjetas:
            t = self.tarjetas[opcion_tarjeta - 1]
            tarjeta_sel = t['ID_TARJETA']
            nombre_sel = t.get('NOMBRE', 'N/A')
            query_id = 'cta_pendiente_detalle_tarjeta'
            params = {
                'id_tarjeta': tarjeta_sel,
                'id_entidad': self.estado['entidad']
            }
        else:
            tarjeta_sel = self.estado.get('identificador')
            query_id = 'cta_pendiente_detalle_tarjeta'
            params = {
                'id_tarjeta': tarjeta_sel,
                'id_entidad': self.estado['entidad']
            }
            nombre_sel = self.estado.get('tarjetaNombre', '')
        
        result = execute_query(query_id, params)
        
        print("\n" + "=" * 60)
        print("DETALLE DE CUENTAS")
        print("=" * 60)
        print()
        
        if result.success:
            header = f"DETALLE: Cuentas Pendientes\n"
            if tarjeta_sel != self.estado.get('identificador'):
                header += f"Tarjeta: {tarjeta_sel}"
                if nombre_sel:
                    header += f" - {nombre_sel}"
                header += "\n"
            
            print(header)
            print(result.formatted_output)
        else:
            print(f"Error: {result.error}")
        
        return result.success
    
    def run(self):
        print("\n" + "=" * 60)
        print("  SIMULADOR DE BOT DE WHATSAPP")
        print("  ChatBot de Cuenta Corriente - Guatemala")
        print("=" * 60)
        
        while True:
            self.paso_bienvenida()
            
            depto_idx = self.paso_departamentos()
            if depto_idx is None:
                break
            
            entidad_idx = self.paso_entidades(depto_idx)
            if entidad_idx is None:
                continue
            
            tipo_idx = self.paso_tipo_busqueda(entidad_idx)
            if tipo_idx is None:
                continue
            
            identificador = self.paso_identificador(tipo_idx)
            if identificador is None:
                continue
            
            tipo = self.estado.get('tipoBusqueda')
            
            if tipo == 'CONTRIBUYENTE':
                if self.mostrar_catastros_contribuyente(identificador) is None:
                    continue
            elif tipo == 'CATASTRO':
                if self.mostrar_tarjetas_catastro(identificador) is None:
                    continue
            elif tipo == 'TARJETA':
                self.estado['tarjetaSeleccionada'] = identificador
                self.estado['tipoBusqueda'] = 'TARJETA'
            
            sel_consulta = self.paso_menu_consultas()
            if sel_consulta is None:
                continue
            
            self.ejecutar_resumen()
            
            input("\n>>> Presiona ENTER para continuar al detalle...")
            
            opcion = self.pedir_seleccion_detalle()
            if opcion and opcion != 'REINICIAR':
                self.ejecutar_detalle(opcion)
            
            input("\n>>> Presiona ENTER para nueva consulta...")
            
            print("\n" + "=" * 60)
            print(">>> Nueva consulta...")
            print("=" * 60)


def main():
    try:
        simulador = SimuladorBot()
        simulador.run()
    except KeyboardInterrupt:
        print("\n\n Simulacion finalizada.")
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()