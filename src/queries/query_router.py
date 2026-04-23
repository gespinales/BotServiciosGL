from typing import Optional
from src.services.oracle_client import db
from src.services.ollama_client import ollama_client
from src.models.schemas import QueryResult

QUERIES = []

def load_queries(queries_config: list):
    global QUERIES
    QUERIES = queries_config

def find_query(query_id: str):
    for q in QUERIES:
        if q["id"] == query_id:
            return q
    return None

def route_query(user_message: str) -> tuple[Optional[str], Optional[dict], dict]:
    query_id, params = ollama_client.classify_intent(user_message, QUERIES)
    
    if query_id == "NONE":
        return None, None, {}
    
    query = find_query(query_id)
    return query_id, query, params

def execute_query(query_id: str, params: Optional[dict] = None) -> QueryResult:
    query = find_query(query_id)
    
    if not query:
        return QueryResult(
            query_id=query_id,
            success=False,
            error="Query not found"
        )
    
    try:
        data = db.execute_query(query["sql"], params)
        
        formatted = format_results(query["format"], data)
        
        return QueryResult(
            query_id=query_id,
            success=True,
            data=data,
            formatted_output=formatted
        )
    except Exception as e:
        return QueryResult(
            query_id=query_id,
            success=False,
            error=str(e)
        )

EXCLUDE_FIELDS = {'ID_CUENTA_CORRIENTE', 'ESTADO', 'FECHA_CREACION', 'FECHA_PAGO', 'MULTADA', 'IDENTIFICADOR', 'MONTO_IVA', 'ID_ENTIDAD'}

HEADERS_DISPLAY = {
    'DESCRIPCION': 'DESCRIPCION',
    'MONTO': 'MONTO TOTAL (Q)',
    'FECHA_MAX_PAGO': 'FECHA MAX PAGO',
    'FECHA_DEVENGADO': 'FECHA DEVENGADO',
    'TOTAL_CUENTAS': 'TOTAL CUENTAS',
    'TOTAL_ADEUDO': 'TOTAL ADEUDO (Q)',
    'IVA_TOTAL': 'IVA (Q)',
    'ENTIDAD_NOMBRE': 'ENTIDAD'
}

def format_date(date_val):
    if date_val is None:
        return "-"
    if hasattr(date_val, 'strftime'):
        return date_val.strftime('%d/%m/%Y')
    try:
        from datetime import datetime
        if isinstance(date_val, str):
            dt = datetime.fromisoformat(date_val.replace(' ', 'T'))
            return dt.strftime('%d/%m/%Y')
    except:
        pass
    return str(date_val)[:10]

def format_results(format_type: str, data: list[dict]) -> str:
    if not data:
        return "No se encontraron resultados."
    
    if format_type == "table":
        if not data:
            return "Sin datos."
        
        headers = [h for h in data[0].keys() if h not in EXCLUDE_FIELDS]
        
        if not headers:
            return "Sin datos."
        
        lines = []
        for i, row in enumerate(data[:10]):
            descripcion = row.get('DESCRIPCION', 'Sin descripción')
            monto = row.get('MONTO', 0) or 0
            iva = row.get('MONTO_IVA', 0) or 0
            total = monto + iva
            fecha = format_date(row.get('FECHA_MAX_PAGO'))
            
            desc_short = descripcion
            
            lines.append(f"- {desc_short}\n  Q{total:,.2f} | Vence: {fecha}")
        
        result = "\n".join(lines)
        
        if len(data) > 10:
            result += f"\n\n... y {len(data) - 10} cuentas más"
        
        return result
    
    elif format_type == "total":
        if not data:
            return "No se encontraron resultados."
        
        row = data[0]
        total_cuentas = row.get('TOTAL_CUENTAS', 0) or 0
        total_adeudo = row.get('TOTAL_ADEUDO', 0) or 0
        
        return f"""*RESUMEN DE ADEUDO*

Tienes {total_cuentas:,} cuenta(s) pendiente(s) de pago.

*Total a pagar: Q{total_adeudo:,.2f}*

¿Deseas ver el detalle de estas cuentas?"""
    
    elif format_type == "resumen":
        if not data:
            return "No se encontraron resultados."
        
        lineas = []
        total_general = 0
        total_cuentas = 0
        
        for row in data:
            concepto = row.get('CONCEPTO', row.get('ESTADO', 'Servicio'))
            cantidad = row.get('TOTAL_CUENTAS', 0) or 0
            monto = row.get('MONTO_TOTAL', 0) or 0
            total_general += monto
            total_cuentas += cantidad
            
            if cantidad == 1:
                texto_cantidad = "1 cuenta"
            else:
                texto_cantidad = f"{cantidad} cuentas"
            
            lineas.append(f"*{concepto.upper()}*\n  {texto_cantidad} - Q{monto:,.2f}")
        
        resultado = f"RESUMEN\nTotal de cuentas: {total_cuentas}\n\n"
        resultado += "\n\n".join(lineas)
        resultado += f"\n\nTOTAL A PAGAR: Q{total_general:,.2f}\n\nDeseas ver el detalle? (S/N)"
        
        return resultado
    
    elif format_type == "detalle_por_tarjeta":
        if not data:
            return "No se encontraron resultados."
        
        tarjetas_data = {}
        for row in data:
            id_tarjeta = row.get('ID_TARJETA', 0)
            nombre = row.get('NOMBRE', '')
            ape_pat = row.get('APELLIDO_PATERNO', '')
            ape_mat = row.get('APELLIDO_MATERNO', '')
            nombre_tarjeta = f"{nombre} {ape_pat} {ape_mat}".strip() or f"Tarjeta {id_tarjeta}"
            if id_tarjeta not in tarjetas_data:
                tarjetas_data[id_tarjeta] = {
                    'nombre': nombre_tarjeta,
                    'cuentas': [],
                    'total': 0
                }
            
            desc = row.get('DESCRIPCION', '')[:40]
            monto = row.get('MONTO', 0) or 0
            iva = row.get('MONTO_IVA', 0) or 0
            fecha = format_date(row.get('FECHA_MAX_PAGO'))
            tarjetas_data[id_tarjeta]['cuentas'].append({
                'desc': desc,
                'monto': monto + iva,
                'fecha': fecha
            })
            tarjetas_data[id_tarjeta]['total'] += monto + iva
        
        resultado = "DETALLE POR TARJETA\n\n"
        limite_por_tarjeta = 10
        
        for id_tarjeta, datos in sorted(tarjetas_data.items()):
            resultado += "=" * 28 + "\n"
            resultado += f">>> TARJETA: {id_tarjeta} - {datos['nombre']}\n"
            resultado += f"   {len(datos['cuentas'])} cuentas - Q{datos['total']:,.2f}\n"
            resultado += "=" * 28 + "\n"
            
            cuentas_mostrar = datos['cuentas'][:limite_por_tarjeta]
            for c in cuentas_mostrar:
                resultado += f"- {c['desc']}: Q{c['monto']:,.2f} (Vence: {c['fecha']})\n"
            
            if len(datos['cuentas']) > limite_por_tarjeta:
                resultado += f"\n... y {len(datos['cuentas']) - limite_por_tarjeta} cuentas mas\n"
            
            resultado += "\n"
        
        return resultado.strip()
    
    elif format_type == "detalle":
        if not data:
            return "No se encontraron resultados."
        
        if len(data) > 15:
            lineas = []
            total = 0
            for row in data[:15]:
                desc = row.get('DESCRIPCION', '')
                monto = row.get('MONTO', 0) or 0
                iva = row.get('MONTO_IVA', 0) or 0
                total += monto + iva
                fecha = format_date(row.get('FECHA_MAX_PAGO') or row.get('FECHA_PAGO'))
                lineas.append(f"• {desc}: Q{monto + iva:,.2f} (Vence: {fecha})")
            
            return f"AVISO: Informacion muy extensa\n{len(data)} cuentas - Q{total:,.2f}\n\nSolo se muestran las primeras 15:\n\n" + "\n".join(lineas)
        
        lineas = []
        total = 0
        for row in data:
            desc = row.get('DESCRIPCION', '')
            monto = row.get('MONTO', 0) or 0
            iva = row.get('MONTO_IVA', 0) or 0
            total += monto + iva
            fecha = format_date(row.get('FECHA_MAX_PAGO') or row.get('FECHA_PAGO'))
            lineas.append(f"- {desc}: Q{monto + iva:,.2f} (Vence: {fecha})")
        
        return "*DETALLE DE CUENTAS*\n\n" + "\n".join(lineas) + "\n\n*TOTAL: Q" + f"{total:,.2f}*"
    
    elif format_type == "json":
        import json
        return json.dumps(data, indent=2, default=str)
    
    elif format_type == "menu":
        if not data:
            return "No se encontraron opciones."
        
        opciones = []
        for i, row in enumerate(data, 1):
            nombre = row.get('NOMBRE', row.get('ENTIDAD', ''))
            opciones.append(f"{i}. {nombre}")
        
        return "\n".join(opciones) + "\n\n*Escribe el número*"
    
    elif format_type == "entidades":
        if not data:
            return "No se encontraron entidades."
        
        opciones = []
        for i, row in enumerate(data, 1):
            entidad = row.get('ENTIDAD_NOMBRE', row.get('ENTIDAD', ''))
            opciones.append(f"{i}. {entidad}")
        
        return "*Selecciona la entidad:*\n\n" + "\n".join(opciones) + "\n\n*Escribe el número de la entidad*"
    
    elif format_type == "contribuyentes":
        if not data:
            return "No se encontraron contribuyentes."
        
        resultados = {}
        for row in data:
            dpi = row.get('DPI', '')
            catastros = resultados.get(dpi, [])
            catastros.append({
                'CATASTRO': row.get('CATASTRO', ''),
                'NOMBRE': row.get('NOMBRE', ''),
                'ENTIDAD': row.get('ID_ENTIDAD', '')
            })
            resultados[dpi] = catastros
        
        lineas = []
        for dpi, cats in resultados.items():
            lineas.append(f"DPI: {dpi}")
            lineas.append(f"Nombre: {cats[0]['NOMBRE']}")
            for c in cats:
                lineas.append(f"  - Catastro: {c['CATASTRO']}")
            lineas.append("")
        
        return "".join(lineas)
    
    elif format_type == "catastros":
        if not data:
            return "No se encontraron catastros."
        
        lineas = []
        for row in data:
            lineas.append(f"Catastro: {row.get('CATASTRO', '')}")
            lineas.append(f"Propietario: {row.get('PROPIETARIO', '')}")
            lineas.append("")
        
        return "".join(lineas)
    
    elif format_type == "resumen_agrupado":
        if not data:
            return "No se encontraron resultados."
        
        catastros_data = {}
        for row in data:
            catastro = row.get('CATASTRO', 'SIN_CATASTRO')
            if catastro not in catastros_data:
                catastros_data[catastro] = {
                    'conceptos': {},
                    'total_cuentas': 0,
                    'total_monto': 0
                }
            
            concepto = row.get('CONCEPTO', 'Servicio')
            cantidad = row.get('TOTAL_CUENTAS', 0) or 0
            monto = row.get('MONTO_TOTAL', 0) or 0
            
            catastros_data[catastro]['conceptos'][concepto] = {
                'cantidad': cantidad,
                'monto': monto
            }
            catastros_data[catastro]['total_cuentas'] += cantidad
            catastros_data[catastro]['total_monto'] += monto
        
        total_general = 0
        total_cuentas_general = 0
        
        resultado = "RESUMEN\n"
        
        for catastro, datos in sorted(catastros_data.items()):
            resultado += f"\n*CATASTRO: {catastro}*\n"
            resultado += f"  {datos['total_cuentas']} cuentas - Q{datos['total_monto']:,.2f}\n"
            
            for concepto, info in datos['conceptos'].items():
                cantidad = info['cantidad']
                monto = info['monto']
                txt_cant = "1 cuenta" if cantidad == 1 else f"{cantidad} cuentas"
                resultado += f"  *{concepto.upper()}*\n"
                resultado += f"    {txt_cant} - Q{monto:,.2f}\n"
            
            total_general += datos['total_monto']
            total_cuentas_general += datos['total_cuentas']
        
        resultado += f"\n*TOTAL GENERAL: {total_cuentas_general} cuentas - Q{total_general:,.2f}*\n\nDeseas ver el detalle? (S/N)"
        
        return resultado
    
    elif format_type == "resumen_por_tarjeta":
        if not data:
            return "No se encontraron resultados."
        
        tarjetas_data = {}
        for row in data:
            id_tarjeta = row.get('ID_TARJETA', 0)
            nombre = row.get('NOMBRE', '')
            ape_pat = row.get('APELLIDO_PATERNO', '')
            ape_mat = row.get('APELLIDO_MATERNO', '')
            nombre_tarjeta = f"{nombre} {ape_pat} {ape_mat}".strip() or f"Tarjeta {id_tarjeta}"
            if id_tarjeta not in tarjetas_data:
                tarjetas_data[id_tarjeta] = {
                    'nombre': nombre_tarjeta,
                    'conceptos': {},
                    'total_cuentas': 0,
                    'total_monto': 0
                }
            
            concepto = row.get('CONCEPTO', 'Servicio')
            cantidad = row.get('TOTAL_CUENTAS', 0) or 0
            monto = row.get('MONTO_TOTAL', 0) or 0
            
            tarjetas_data[id_tarjeta]['conceptos'][concepto] = {
                'cantidad': cantidad,
                'monto': monto
            }
            tarjetas_data[id_tarjeta]['total_cuentas'] += cantidad
            tarjetas_data[id_tarjeta]['total_monto'] += monto
        
        total_general = 0
        total_cuentas_general = 0
        
        resultado = "RESUMEN POR TARJETA\n"
        
        for id_tarjeta, datos in sorted(tarjetas_data.items()):
            resultado += f"\n*>>> TARJETA: {id_tarjeta} - {datos['nombre']} <<<*\n"
            resultado += f"   {datos['total_cuentas']} cuentas - Q{datos['total_monto']:,.2f}\n"
            
            for concepto, info in datos['conceptos'].items():
                cantidad = info['cantidad']
                monto = info['monto']
                txt_cant = "1 cuenta" if cantidad == 1 else f"{cantidad} cuentas"
                resultado += f"   *{concepto.upper()}*\n"
                resultado += f"     {txt_cant} - Q{monto:,.2f}\n"
            
            total_general += datos['total_monto']
            total_cuentas_general += datos['total_cuentas']
        
        resultado += f"\n*TOTAL GENERAL: {total_cuentas_general} cuentas - Q{total_general:,.2f}*\n\nDeseas ver el detalle? (S/N)"
        
        return resultado
    
    elif format_type == "simple":
        if not data:
            return None
        return str(data[0].get('ID_CONTRIBUYENTE'))
    
    elif format_type == "simple_list":
        if not data:
            return []
        return [str(row.get('ID_CUENTA_CORRIENTE')) for row in data]
    
    else:
        return str(data)
