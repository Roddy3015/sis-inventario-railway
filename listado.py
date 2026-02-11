import os
from datetime import datetime
from flask import Flask, request, jsonify, render_template, session
from flask_cors import CORS
import mysql.connector
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
CORS(app, supports_credentials=True)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.config["APP_BASE"] = os.getenv("APP_BASE", "")

app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev_secret_key_change_me")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=(os.getenv("COOKIE_SECURE", "0") == "1"),
)

def get_db():
    conn = mysql.connector.connect(
        host=os.getenv("MYSQLHOST", "mysql_global"),
        user=os.getenv("MYSQLUSER", "app_user"),
        password=os.getenv("MYSQLPASSWORD", "app_pass"),
        database=os.getenv("MYSQLDATABASE", "empresa_db"),
        port=int(os.getenv("MYSQLPORT", "3306")),
        charset="utf8mb4",
        use_unicode=True,
        use_pure=True,
    )
    return conn

def json_utf8(payload, status=200):
    resp = jsonify(payload)
    resp.status_code = status
    resp.headers["Content-Type"] = "application/json; charset=utf-8"
    return resp

def dt_to_str(x):
    if isinstance(x, datetime):
        return x.strftime("%Y-%m-%d %H:%M:%S")
    return x


@app.get("/")
def home():
    return render_template("index.html")

@app.get("/admin")
def admin_page():
    return render_template("admin.html")

# AUTH JEFE
@app.post("/api/login")
def api_login_jefe():
    data = request.get_json(silent=True) or {}
    nombre = (data.get("nombre") or "").strip()
    password = (data.get("password") or "").strip()

    if not nombre or not password:
        return json_utf8({"status": "error", "message": "Faltan credenciales"}, 400)

    conn = get_db()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT id_usuario, nombre_completo, rol, activo
        FROM usuarios
        WHERE nombre_completo=%s AND password=%s AND rol='JEFE' AND activo=1
        """,
        (nombre, password),
    )
    user = cur.fetchone()
    cur.close()
    conn.close()

    if not user:
        return json_utf8({"status": "error", "message": "Credenciales inválidas o no eres JEFE"}, 401)

    session["user_id"] = user["id_usuario"]
    session["user_name"] = user["nombre_completo"]
    session["role"] = user["rol"]
    return json_utf8({"status": "ok", "nombre": user["nombre_completo"]})

@app.post("/api/logout")
def api_logout():
    session.clear()
    return json_utf8({"status": "ok"})

def require_jefe():
    return session.get("role") == "JEFE" and session.get("user_id") is not None


# =========================
# AUTH ADMIN
# =========================
def require_admin():
    return session.get("admin_role") == "ADMIN" and session.get("admin_id") is not None

@app.post("/api/admin/login")
def api_login_admin():
    data = request.get_json(silent=True) or {}
    nombre = (data.get("nombre") or "").strip()
    password = (data.get("password") or "").strip()

    if not nombre or not password:
        return json_utf8({"status": "error", "message": "Faltan credenciales"}, 400)

    conn = get_db()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT id_usuario, nombre_completo, rol, activo
        FROM usuarios
        WHERE nombre_completo=%s AND password=%s AND rol='ADMIN' AND activo=1
        """,
        (nombre, password),
    )
    user = cur.fetchone()
    cur.close()
    conn.close()

    if not user:
        return json_utf8({"status": "error", "message": "Credenciales inválidas o no eres ADMIN"}, 401)

    session["admin_id"] = user["id_usuario"]
    session["admin_name"] = user["nombre_completo"]
    session["admin_role"] = user["rol"]
    return json_utf8({"status": "ok", "nombre": user["nombre_completo"]})

@app.post("/api/admin/logout")
def api_logout_admin():
    session.pop("admin_id", None)
    session.pop("admin_name", None)
    session.pop("admin_role", None)
    return json_utf8({"status": "ok"})

# ADMIN: LISTA DE JEFES (para filtros)
@app.get("/api/admin/jefes")
def api_admin_jefes():
    if not require_admin():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    conn = get_db()
    cur = conn.cursor(dictionary=True)
    cur.execute("""
        SELECT id_usuario, nombre_completo
        FROM usuarios
        WHERE rol='JEFE' AND activo=1
        ORDER BY nombre_completo ASC
    """)
    items = cur.fetchall() or []
    cur.close()
    conn.close()

    return json_utf8({"status": "ok", "items": items, "total": len(items)})

# ITEM LOOKUP (JEFE)
@app.get("/api/item/<codigo>")
def api_buscar_item(codigo: str):
    if not require_jefe():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    codigo = (codigo or "").strip()
    if not codigo:
        return json_utf8({"status": "error", "message": "Código vacío"}, 400)

    conn = get_db()
    cur = conn.cursor(dictionary=True)

    if codigo.upper().startswith("EQ"):
        cur.execute(
            """
            SELECT codigo_e, equipo, marca, modelo, num_serie, ubicacion, estado
            FROM equipos
            WHERE codigo_e=%s
            """,
            (codigo,),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            return json_utf8({"status": "not_found", "message": "Equipo no encontrado"}, 404)

        disponible = (row["estado"] == "DISPONIBLE")
        return json_utf8({
            "status": "ok",
            "tipo": "EQUIPO",
            "codigo": row["codigo_e"],
            "nombre": row["equipo"],
            "marca": row["marca"],
            "modelo": row["modelo"],
            "num_serie": row["num_serie"],
            "ubicacion": row["ubicacion"],
            "estado": row["estado"],
            "disponible": disponible,
            "stock": 1 if disponible else 0,
        })

    if codigo.upper().startswith("HE"):
        cur.execute(
            """
            SELECT codigo_h, herramienta, marca, modelo, tipo_modelo, ubicacion, stock
            FROM herramientas
            WHERE codigo_h=%s
            """,
            (codigo,),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            return json_utf8({"status": "not_found", "message": "Herramienta no encontrada"}, 404)

        disponible = (row["stock"] > 0)
        return json_utf8({
            "status": "ok",
            "tipo": "HERRAMIENTA",
            "codigo": row["codigo_h"],
            "nombre": row["herramienta"],
            "marca": row["marca"],
            "modelo": row["modelo"],
            "tipo_modelo": row["tipo_modelo"],
            "ubicacion": row["ubicacion"],
            "disponible": disponible,
            "stock": int(row["stock"]),
        })

    cur.close()
    conn.close()
    return json_utf8({"status": "error", "message": "Código inválido (debe empezar por EQ o HE)"}, 400)


# =========================
# REGISTER MOVEMENT (JEFE)
# =========================
@app.post("/api/movimiento")
def api_registrar_movimiento():
    if not require_jefe():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    data = request.get_json(silent=True) or {}
    codigo = (data.get("codigo") or "").strip()
    tipo = (data.get("tipo") or "").strip().upper()
    cantidad = int(data.get("cantidad") or 1)

    if not codigo or tipo not in ("EQUIPO", "HERRAMIENTA"):
        return json_utf8({"status": "error", "message": "Datos inválidos"}, 400)

    if tipo == "HERRAMIENTA" and cantidad <= 0:
        return json_utf8({"status": "error", "message": "Cantidad inválida"}, 400)

    user_id = session["user_id"]
    residente = session["user_name"]

    conn = get_db()
    try:
        conn.start_transaction()
        cur = conn.cursor(dictionary=True)

        if tipo == "HERRAMIENTA":
            cur.execute(
                "SELECT stock, herramienta, marca, modelo, tipo_modelo FROM herramientas WHERE codigo_h=%s FOR UPDATE",
                (codigo,)
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("Herramienta no encontrada")

            stock = int(row["stock"])
            if stock < cantidad:
                raise ValueError("Sin stock suficiente")

            especificacion = f"{row['herramienta']} | Marca: {row['marca']} | Modelo: {row['modelo']} | Tipo: {row['tipo_modelo']}"

            cur.execute(
                """
                INSERT INTO movimientos (id_usuario, residente, tipo_item, codigo_item, cantidad, especificacion, fecha_salida, estado_retorno)
                VALUES (%s, %s, 'HERRAMIENTA', %s, %s, %s, %s, 'PENDIENTE')
                """,
                (user_id, residente, codigo, cantidad, especificacion, datetime.now()),
            )

            cur.execute(
                "UPDATE herramientas SET stock = stock - %s WHERE codigo_h=%s",
                (cantidad, codigo),
            )

        else:
            cur.execute(
                "SELECT estado, equipo, marca, modelo, num_serie FROM equipos WHERE codigo_e=%s FOR UPDATE",
                (codigo,)
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("Equipo no encontrado")

            if row["estado"] != "DISPONIBLE":
                raise ValueError("El equipo no está disponible")

            especificacion = f"{row['equipo']} | Marca: {row['marca']} | Modelo: {row['modelo']} | Serie: {row['num_serie']}"

            cur.execute(
                """
                INSERT INTO movimientos (id_usuario, residente, tipo_item, codigo_item, cantidad, especificacion, fecha_salida, estado_retorno)
                VALUES (%s, %s, 'EQUIPO', %s, 1, %s, %s, 'PENDIENTE')
                """,
                (user_id, residente, codigo, especificacion, datetime.now()),
            )

            cur.execute("UPDATE equipos SET estado='PRESTADO' WHERE codigo_e=%s", (codigo,))

        conn.commit()
        cur.close()
        return json_utf8({"status": "ok"})

    except ValueError as e:
        conn.rollback()
        return json_utf8({"status": "error", "message": str(e)}, 400)
    except Exception:
        conn.rollback()
        return json_utf8({"status": "error", "message": "Error interno"}, 500)
    finally:
        conn.close()

@app.get("/api/pendientes")
def api_pendientes_jefe():
    if not require_jefe():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    user_id = session["user_id"]

    conn = get_db()
    cur = conn.cursor(dictionary=True)

    cur.execute("""
        SELECT
            m.id_mov,
            m.fecha_salida,
            m.tipo_item,
            m.codigo_item,
            m.cantidad,
            m.especificacion,
            m.estado_retorno,
            CASE
                WHEN m.tipo_item='EQUIPO' THEN e.equipo
                WHEN m.tipo_item='HERRAMIENTA' THEN h.herramienta
            END AS item_nombre,
            e.marca AS eq_marca,
            e.modelo AS eq_modelo,
            e.num_serie,
            h.marca AS he_marca,
            h.modelo AS he_modelo,
            h.tipo_modelo
        FROM movimientos m
        LEFT JOIN equipos e
            ON m.tipo_item='EQUIPO' AND m.codigo_item = e.codigo_e
        LEFT JOIN herramientas h
            ON m.tipo_item='HERRAMIENTA' AND m.codigo_item = h.codigo_h
        WHERE
            m.id_usuario = %s
            AND m.estado_retorno = 'PENDIENTE'
        ORDER BY m.fecha_salida ASC
    """, (user_id,))

    items = cur.fetchall() or []
    cur.close()
    conn.close()

    for it in items:
        it["fecha_salida"] = dt_to_str(it.get("fecha_salida"))

    return json_utf8({
        "status": "ok",
        "items": items,
        "total": len(items)
    })

@app.post("/api/devolver")
def api_devolver_item():
    if not require_jefe():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    data = request.get_json(silent=True) or {}
    id_mov = data.get("id_mov")

    if not id_mov:
        return json_utf8({"status": "error", "message": "id_mov requerido"}, 400)

    user_id = session["user_id"]

    conn = get_db()
    try:
        conn.start_transaction()
        cur = conn.cursor(dictionary=True)

        cur.execute("""
            SELECT *
            FROM movimientos
            WHERE id_mov=%s AND id_usuario=%s
            FOR UPDATE
        """, (id_mov, user_id))

        mov = cur.fetchone()
        if not mov:
            raise ValueError("Movimiento no encontrado")

        if mov["estado_retorno"] != "PENDIENTE":
            raise ValueError("Este movimiento ya fue procesado")

        tipo = mov["tipo_item"]
        codigo = mov["codigo_item"]
        cantidad = int(mov["cantidad"] or 1)

        if tipo == "HERRAMIENTA":
            cur.execute("""
                UPDATE herramientas
                SET stock = stock + %s
                WHERE codigo_h=%s
            """, (cantidad, codigo))

        elif tipo == "EQUIPO":
            cur.execute("""
                UPDATE equipos
                SET estado='DISPONIBLE'
                WHERE codigo_e=%s
            """, (codigo,))

        cur.execute("""
            UPDATE movimientos
            SET
                estado_retorno='DEVUELTO',
                fecha_retorno=%s
            WHERE id_mov=%s
        """, (datetime.now(), id_mov))

        conn.commit()
        cur.close()
        return json_utf8({"status": "ok"})

    except ValueError as e:
        conn.rollback()
        return json_utf8({"status": "error", "message": str(e)}, 400)
    except Exception as e:
        conn.rollback()
        return json_utf8({"status": "error", "message": "Error interno"}, 500)
    finally:
        conn.close()

# MOVIMIENTOS ADMIN (SOLO LECTURA)
@app.get("/api/admin/movimientos")
def api_admin_movimientos():
    if not require_admin():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    try:
        offset = int(request.args.get("offset", "0"))
        limit = int(request.args.get("limit", "20"))
    except ValueError:
        return json_utf8({"status": "error", "message": "offset/limit inválidos"}, 400)

    limit = max(1, min(limit, 10000))
    offset = max(0, offset)

    estado = (request.args.get("estado") or "").strip().upper()
    tipo = (request.args.get("tipo") or "").strip().upper()
    q = (request.args.get("q") or "").strip()
    residente = (request.args.get("residente") or "").strip()

    where = ["1=1"]
    params = []

    if estado in ("PENDIENTE", "DEVUELTO", "ANULADO"):
        where.append("m.estado_retorno=%s")
        params.append(estado)

    if tipo in ("EQUIPO", "HERRAMIENTA"):
        where.append("m.tipo_item=%s")
        params.append(tipo)

    if q:
        like = f"%{q}%"
        where.append("""
        (
          m.residente LIKE %s
          OR m.codigo_item LIKE %s
          OR m.especificacion LIKE %s
          OR (m.tipo_item='EQUIPO' AND e.equipo LIKE %s)
          OR (m.tipo_item='HERRAMIENTA' AND h.herramienta LIKE %s)
        )
        """)
        params.extend([like, like, like, like, like])

    if residente:
        where.append("m.residente=%s")
        params.append(residente)

    where_sql = " AND ".join(where)

    conn = get_db()
    cur = conn.cursor(dictionary=True)

    cur.execute(f"""
        SELECT COUNT(*) AS total
        FROM movimientos m
        LEFT JOIN equipos e ON (m.tipo_item='EQUIPO' AND m.codigo_item = e.codigo_e)
        LEFT JOIN herramientas h ON (m.tipo_item='HERRAMIENTA' AND m.codigo_item = h.codigo_h)
        WHERE {where_sql}
    """, params)
    total = int(cur.fetchone()["total"])

    kpi_where = ["1=1"]
    kpi_params = []

    if tipo in ("EQUIPO", "HERRAMIENTA"):
        kpi_where.append("m.tipo_item=%s")
        kpi_params.append(tipo)

    if q:
        like = f"%{q}%"
        kpi_where.append("""
        (
          m.residente LIKE %s
          OR m.codigo_item LIKE %s
          OR m.especificacion LIKE %s
          OR (m.tipo_item='EQUIPO' AND e.equipo LIKE %s)
          OR (m.tipo_item='HERRAMIENTA' AND h.herramienta LIKE %s)
        )
        """)
        kpi_params.extend([like, like, like, like, like])
    
    if residente:
        kpi_where.append("m.residente=%s")
        kpi_params.append(residente)

    kpi_where_sql = " AND ".join(kpi_where)

    cur.execute(f"""
        SELECT
          SUM(CASE WHEN m.estado_retorno='PENDIENTE' THEN 1 ELSE 0 END) AS PENDIENTE,
          SUM(CASE WHEN m.estado_retorno='DEVUELTO' THEN 1 ELSE 0 END) AS DEVUELTO,
          SUM(CASE WHEN m.estado_retorno='ANULADO' THEN 1 ELSE 0 END) AS ANULADO
        FROM movimientos m
        LEFT JOIN equipos e ON (m.tipo_item='EQUIPO' AND m.codigo_item = e.codigo_e)
        LEFT JOIN herramientas h ON (m.tipo_item='HERRAMIENTA' AND m.codigo_item = h.codigo_h)
        WHERE {kpi_where_sql}
    """, kpi_params)
    counts_row = cur.fetchone() or {}
    counts = {
        "PENDIENTE": int(counts_row.get("PENDIENTE") or 0),
        "DEVUELTO": int(counts_row.get("DEVUELTO") or 0),
        "ANULADO": int(counts_row.get("ANULADO") or 0),
    }

    cur.execute(f"""
        SELECT
          m.id_mov,
          m.fecha_salida,
          m.residente,
          m.tipo_item,
          m.codigo_item,
          CASE
            WHEN m.tipo_item='EQUIPO' THEN e.equipo
            WHEN m.tipo_item='HERRAMIENTA' THEN h.herramienta
            ELSE NULL
          END AS item_nombre,
          m.especificacion,
          m.estado_retorno,
          m.fecha_retorno
        FROM movimientos m
        LEFT JOIN equipos e ON (m.tipo_item='EQUIPO' AND m.codigo_item = e.codigo_e)
        LEFT JOIN herramientas h ON (m.tipo_item='HERRAMIENTA' AND m.codigo_item = h.codigo_h)
        WHERE {where_sql}
        ORDER BY m.fecha_salida DESC
        LIMIT %s OFFSET %s
    """, params + [limit, offset])

    items = cur.fetchall() or []
    cur.close()
    conn.close()

    for it in items:
        it["fecha_salida"] = dt_to_str(it.get("fecha_salida"))
        it["fecha_retorno"] = dt_to_str(it.get("fecha_retorno"))


    return json_utf8({
        "status": "ok",
        "items": items,
        "total": total,
        "counts": counts,
    })

@app.get("/api/admin/equipos")
def api_admin_list_equipos():
    if not require_admin():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    conn = get_db()
    cur = conn.cursor(dictionary=True)
    cur.execute("""
        SELECT codigo_e, equipo, marca, modelo, num_serie, ubicacion, estado
        FROM equipos
        ORDER BY equipo ASC, codigo_e ASC
    """)
    items = cur.fetchall() or []
    cur.close()
    conn.close()
    return json_utf8({"status": "ok", "items": items, "total": len(items)})


@app.post("/api/admin/equipos")
def api_admin_create_equipo():
    if not require_admin():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    data = request.get_json(silent=True) or {}
    codigo_e = (data.get("codigo_e") or "").strip()
    equipo = (data.get("equipo") or "").strip()
    marca = (data.get("marca") or "").strip()
    modelo = (data.get("modelo") or "").strip()
    num_serie = (data.get("num_serie") or "").strip()
    ubicacion = (data.get("ubicacion") or "").strip()

    if not codigo_e or not equipo:
        return json_utf8({"status": "error", "message": "codigo_e y equipo son obligatorios"}, 400)

    if not codigo_e.upper().startswith("EQ"):
        return json_utf8({"status": "error", "message": "El código debe empezar por EQ"}, 400)

    conn = get_db()
    cur = conn.cursor()
    try:

        estado = "DISPONIBLE"

        cur.execute("""
            INSERT INTO equipos (codigo_e, equipo, marca, modelo, num_serie, ubicacion, estado)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (codigo_e, equipo, marca, modelo, num_serie, ubicacion, estado))

        conn.commit()
        return json_utf8({"status": "ok"})
    except mysql.connector.IntegrityError:
        conn.rollback()
        return json_utf8({"status": "error", "message": "Ya existe un equipo con ese código"}, 409)
    except Exception:
        conn.rollback()
        return json_utf8({"status": "error", "message": "Error interno"}, 500)
    finally:
        cur.close()
        conn.close()

@app.put("/api/admin/equipos/<codigo_e>")
def api_admin_update_equipo(codigo_e):
    if not require_admin():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    codigo_e = (codigo_e or "").strip()
    if not codigo_e:
        return json_utf8({"status": "error", "message": "Código inválido"}, 400)

    data = request.get_json(silent=True) or {}
    equipo = (data.get("equipo") or "").strip()
    marca = (data.get("marca") or "").strip()
    modelo = (data.get("modelo") or "").strip()
    num_serie = (data.get("num_serie") or "").strip()
    ubicacion = (data.get("ubicacion") or "").strip()

    if not equipo:
        return json_utf8({"status": "error", "message": "equipo es obligatorio"}, 400)

    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("""
            UPDATE equipos
            SET equipo=%s, marca=%s, modelo=%s, num_serie=%s, ubicacion=%s
            WHERE codigo_e=%s
        """, (equipo, marca, modelo, num_serie, ubicacion, codigo_e))

        if cur.rowcount == 0:
            conn.rollback()
            return json_utf8({"status": "error", "message": "Equipo no existe"}, 404)

        conn.commit()
        return json_utf8({"status": "ok"})
    except Exception:
        conn.rollback()
        return json_utf8({"status": "error", "message": "Error interno"}, 500)
    finally:
        cur.close()
        conn.close()

# HERRAMIENTAS ADMIN (LISTA + CREAR)
@app.get("/api/admin/herramientas")
def api_admin_list_herramientas():
    if not require_admin():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    conn = get_db()
    cur = conn.cursor(dictionary=True)
    cur.execute("""
        SELECT codigo_h, herramienta, marca, modelo, tipo_modelo, ubicacion, stock
        FROM herramientas
        ORDER BY herramienta ASC, codigo_h ASC
    """)
    items = cur.fetchall() or []
    cur.close()
    conn.close()
    return json_utf8({"status": "ok", "items": items, "total": len(items)})


@app.post("/api/admin/herramientas")
def api_admin_create_herramienta():
    if not require_admin():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    data = request.get_json(silent=True) or {}
    codigo_h = (data.get("codigo_h") or "").strip()
    herramienta = (data.get("herramienta") or "").strip()
    marca = (data.get("marca") or "").strip()
    modelo = (data.get("modelo") or "").strip()
    tipo_modelo = (data.get("tipo_modelo") or "").strip()
    ubicacion = (data.get("ubicacion") or "").strip()
    try:
        stock = int(data.get("stock") or 0)
    except ValueError:
        return json_utf8({"status": "error", "message": "Stock inválido"}, 400)

    if not codigo_h or not herramienta:
        return json_utf8({"status": "error", "message": "codigo_h y herramienta son obligatorios"}, 400)

    if not codigo_h.upper().startswith("HE"):
        return json_utf8({"status": "error", "message": "El código debe empezar por HE"}, 400)

    if stock < 0:
        return json_utf8({"status": "error", "message": "Stock no puede ser negativo"}, 400)

    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO herramientas (codigo_h, herramienta, marca, modelo, tipo_modelo, ubicacion, stock)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (codigo_h, herramienta, marca, modelo, tipo_modelo, ubicacion, stock))

        conn.commit()
        return json_utf8({"status": "ok"})
    except mysql.connector.IntegrityError:
        conn.rollback()
        return json_utf8({"status": "error", "message": "Ya existe una herramienta con ese código"}, 409)
    except Exception:
        conn.rollback()
        return json_utf8({"status": "error", "message": "Error interno"}, 500)
    finally:
        cur.close()
        conn.close()

@app.put("/api/admin/herramientas/<codigo_h>")
def api_admin_update_herramienta(codigo_h):
    if not require_admin():
        return json_utf8({"status": "error", "message": "No autorizado"}, 401)

    codigo_h = (codigo_h or "").strip()
    if not codigo_h:
        return json_utf8({"status": "error", "message": "Código inválido"}, 400)

    data = request.get_json(silent=True) or {}
    herramienta = (data.get("herramienta") or "").strip()
    marca = (data.get("marca") or "").strip()
    modelo = (data.get("modelo") or "").strip()
    tipo_modelo = (data.get("tipo_modelo") or "").strip()
    ubicacion = (data.get("ubicacion") or "").strip()

    try:
        stock = int(data.get("stock") if data.get("stock") is not None else 0)
    except ValueError:
        return json_utf8({"status": "error", "message": "Stock inválido"}, 400)

    if not herramienta:
        return json_utf8({"status": "error", "message": "herramienta es obligatorio"}, 400)
    if stock < 0:
        return json_utf8({"status": "error", "message": "Stock no puede ser negativo"}, 400)

    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("""
            UPDATE herramientas
            SET herramienta=%s, marca=%s, modelo=%s, tipo_modelo=%s, ubicacion=%s, stock=%s
            WHERE codigo_h=%s
        """, (herramienta, marca, modelo, tipo_modelo, ubicacion, stock, codigo_h))

        if cur.rowcount == 0:
            conn.rollback()
            return json_utf8({"status": "error", "message": "Herramienta no existe"}, 404)

        conn.commit()
        return json_utf8({"status": "ok"})
    except Exception:
        conn.rollback()
        return json_utf8({"status": "error", "message": "Error interno"}, 500)
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
