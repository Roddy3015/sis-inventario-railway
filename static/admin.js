function $(id){ return document.getElementById(id); }
const BASE = document.body?.dataset?.base || "";
const API  = (path) => `${BASE}${path}`; 

function setMsg(id, text){
  const el = $(id);
  if(el) el.textContent = text || "";
}
function setVisible(id, on){
  const el = $(id);
  if(el) el.style.display = on ? "" : "none";
}
function safeSetText(id, text){
  const el = $(id);
  if(el) el.textContent = text ?? "";
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function fmtFecha(v){
  if(!v) return "-";
  const s = String(v).replace("T"," ");
  return s.length >= 16 ? s.slice(0,16) : s;
}
function badgeEstado(estado){
  const e = (estado || "").toUpperCase();
  if(e === "PENDIENTE") return `<span class="badge b-warn">PENDIENTE</span>`;
  if(e === "DEVUELTO")  return `<span class="badge b-ok">DEVUELTO</span>`;
  if(e === "ANULADO")   return `<span class="badge b-bad">ANULADO</span>`;
  return `<span class="badge">${escapeHtml(estado || "-")}</span>`;
}
function badgeTipo(tipo){
  const t = (tipo || "").toUpperCase();
  if(t === "EQUIPO") return `<span class="pill pill-blue">EQUIPO</span>`;
  if(t === "HERRAMIENTA") return `<span class="pill pill-cyan">HERRAMIENTA</span>`;
  return `<span class="pill">${escapeHtml(tipo || "-")}</span>`;
}

let editingEquipoCodigo = null;        
let editingHerramientaCodigo = null;   

let cacheEquipos = [];      
let cacheHerramientas = [];  
let currentListKind = null;

function eqSaveBtn(){ return document.querySelector("#view-equipos .row-actions .btn.primary"); }
function heSaveBtn(){ return document.querySelector("#view-herramientas .row-actions .btn.primary"); }

function setEqEditMode(on){
  const code = $("eq-codigo");
  if(code){
    code.disabled = on;
  }
  const btn = eqSaveBtn();
  if(btn){
    btn.textContent = on ? "Guardar cambios" : "Guardar equipo";
  }
}

function setHeEditMode(on){
  const code = $("he-codigo");
  if(code){
    code.disabled = on;
  }
  const btn = heSaveBtn();
  if(btn){
    btn.textContent = on ? "Guardar cambios" : "Guardar herramienta";
  }
}

/* ---------------- Tabs ---------------- */
function switchTab(name){
  if($("tabbtn-movs")) $("tabbtn-movs").classList.toggle("active", name === "movs");
  if($("tabbtn-eq")) $("tabbtn-eq").classList.toggle("active", name === "equipos");
  if($("tabbtn-he")) $("tabbtn-he").classList.toggle("active", name === "herramientas");

  setVisible("view-movs", name === "movs");
  setVisible("view-equipos", name === "equipos");
  setVisible("view-herramientas", name === "herramientas");

  if(name === "movs") {
      cargarJefes();
      cargarMovimientos();
  }
}

/* ---------------- Auth ---------------- */
async function adminLogin(){
  setMsg("admin-login-msg", "");
  const nombre = $("admin-nombre")?.value?.trim() || "";
  const password = $("admin-pass")?.value?.trim() || "";

  if(!nombre || !password){
    setMsg("admin-login-msg", "Completa nombre y contraseña.");
    return;
  }

  const res = await fetch(API("/api/admin/login"), {
    method:"POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ nombre, password })
  });

  const data = await res.json().catch(() => ({}));
  if(!res.ok){
    setMsg("admin-login-msg", data.message || "No autorizado");
    return;
  }

  setVisible("admin-auth", false);
  setVisible("admin-dashboard", true);
  safeSetText("admin-who", data.nombre || "ADMIN");

  switchTab("movs");
}

async function adminLogout(){
  await fetch(API("/api/admin/logout"), { method:"POST" });
  location.reload();
}

/* ---------------- Movimientos con FILTROS ---------------- */
async function cargarJefes() {
    const select = $("filter-residente");
    if (!select) return;

    if(select.dataset.loaded === '1') return;

    try {
        const res = await fetch(API("/api/admin/jefes"));
        const data = await res.json().catch(() => ({}));
        if(!res.ok) return;

        const jefes = data.items || [];

        select.querySelectorAll("option:not([value=''])").forEach(o => o.remove());

        jefes.sort((a, b) =>
          (a.nombre_completo || "").localeCompare(b.nombre_completo || "", "es")
        );

        jefes.forEach(j => {
            const nombre = (j.nombre_completo || "").trim();
            if(!nombre) return;

            const opt = document.createElement("option");
            opt.value = nombre;
            opt.textContent = nombre;
            select.appendChild(opt);
        });

        select.dataset.loaded = "1";
        if(!jefes.length) console.warn("No hay jefes para cargar")
    } catch (e) {
        console.error("Error cargando jefes:", e);
    }
}

function limpiarFiltros() {
    if ($("filter-residente")) $("filter-residente").value = "";
    if ($("filter-tipo")) $("filter-tipo").value = "";
    cargarMovimientos();
}

function rowMovHtml(m){
  return `
    <tr>
      <td class="td-nowrap">${fmtFecha(m.fecha_salida)}</td>
      <td>${escapeHtml(m.residente || "-")}</td>
      <td>${badgeTipo(m.tipo_item)}</td>
      <td>
        <div class="cell-title">${escapeHtml(m.item_nombre || "-")}</div>
        <div class="cell-sub muted">Código: ${escapeHtml(m.codigo_item || "-")}</div>
      </td>
      <td class="td-wide">${escapeHtml(m.especificacion || "-")}</td>
      <td>${badgeEstado(m.estado_retorno)}</td>
    </tr>
  `;
}

async function cargarMovimientos(){
  setMsg("admin-msg", "");
  if($("tbody")) $("tbody").innerHTML = `<tr><td colspan="6" class="td-empty">Cargando...</td></tr>`;

  const residente = ($("filter-residente")?.value || "").trim();
  const tipo = ($("filter-tipo")?.value || "").trim();

  const params = new URLSearchParams({ offset: "0", limit: "10000" });
  if(residente) params.set("residente", residente);
  if(tipo) params.set("tipo", tipo);

  const res = await fetch(API(`/api/admin/movimientos?${params.toString()}`));
  const data = await res.json().catch(() => ({}));

  if(!res.ok){
    if($("tbody")) $("tbody").innerHTML = `<tr><td colspan="6" class="td-empty">Error cargando movimientos</td></tr>`;
    setMsg("admin-msg", data.message || "No se pudo cargar");
    return;
  }

  const items = data.items || [];
  const total = Number(data.total ?? items.length) || items.length;

  safeSetText("mov-total", total);
  safeSetText("mov-info", items.length ? `Mostrando ${items.length} registro(s)` : "—");

  if($("tbody")){
    $("tbody").innerHTML = items.length
      ? items.map(rowMovHtml).join("")
      : `<tr><td colspan="6" class="td-empty">Sin resultados para los filtros aplicados</td></tr>`;
  }
}

/* ---------------- Modal listas + EDITAR ---------------- */
function openListModal(tipo){
  currentListKind = tipo;
  setVisible("list-modal", true);
  setMsg("list-msg", "");
  safeSetText("list-subtitle", "Cargando...");

  if(tipo === "equipos"){
    safeSetText("list-title", "Lista de equipos");
    renderListHeader("equipos");
    loadList("/api/admin/equipos", "equipos");
  }else{
    safeSetText("list-title", "Lista de herramientas");
    renderListHeader("herramientas");
    loadList("/api/admin/herramientas", "herramientas");
  }
}

function closeListModal(){
  setVisible("list-modal", false);
}

function renderListHeader(kind){
  const thead = $("list-thead");
  if(!thead) return;

  if(kind === "equipos"){
    thead.innerHTML = `
      <tr>
        <th class="td-nowrap">Código</th>
        <th>Equipo</th>
        <th class="td-nowrap">Marca</th>
        <th class="td-nowrap">Modelo</th>
        <th class="td-nowrap">Serie</th>
        <th class="td-nowrap">Ubicación</th>
        <th class="td-nowrap">Acciones</th>
      </tr>
    `;
  } else {
    thead.innerHTML = `
      <tr>
        <th class="td-nowrap">Código</th>
        <th>Herramienta</th>
        <th class="td-nowrap">Marca</th>
        <th class="td-nowrap">Modelo</th>
        <th class="td-nowrap">Tipo</th>
        <th class="td-nowrap">Ubicación</th>
        <th class="td-nowrap">Stock</th>
        <th class="td-nowrap">Acciones</th>
      </tr>
    `;
  }
}

function rowEqHtml(e){
  const codigo = (e.codigo_e ?? e.codigo ?? "").trim();
  return `
    <tr>
      <td class="td-nowrap">${escapeHtml(codigo || "-")}</td>
      <td>${escapeHtml(e.equipo ?? e.nombre ?? "-")}</td>
      <td class="td-nowrap">${escapeHtml(e.marca ?? "-")}</td>
      <td class="td-nowrap">${escapeHtml(e.modelo ?? "-")}</td>
      <td class="td-nowrap">${escapeHtml(e.num_serie ?? e.serie ?? "-")}</td>
      <td class="td-nowrap">${escapeHtml(e.ubicacion ?? "-")}</td>
      <td class="td-nowrap">
        <button class="btn tiny" onclick="editarEquipoDesdeLista('${escapeHtml(codigo)}')">Editar</button>
      </td>
    </tr>
  `;
}

function rowHeHtml(h){
  const codigo = (h.codigo_h ?? h.codigo ?? "").trim();
  return `
    <tr>
      <td class="td-nowrap">${escapeHtml(codigo || "-")}</td>
      <td>${escapeHtml(h.herramienta ?? h.nombre ?? "-")}</td>
      <td class="td-nowrap">${escapeHtml(h.marca ?? "-")}</td>
      <td class="td-nowrap">${escapeHtml(h.modelo ?? "-")}</td>
      <td class="td-nowrap">${escapeHtml(h.tipo_modelo ?? h.tipo ?? "-")}</td>
      <td class="td-nowrap">${escapeHtml(h.ubicacion ?? "-")}</td>
      <td class="td-nowrap">${escapeHtml(h.stock ?? "-")}</td>
      <td class="td-nowrap">
        <button class="btn tiny" onclick="editarHerramientaDesdeLista('${escapeHtml(codigo)}')">Editar</button>
      </td>
    </tr>
  `;
}

async function loadList(url, kind){
  const tbody = $("list-tbody");
  const colspan = (kind === "equipos") ? 7 : 8;
  if(tbody) tbody.innerHTML = `<tr><td class="td-empty" colspan="${colspan}">Cargando...</td></tr>`;

  const res = await fetch(API(url), { method:"GET" });
  const data = await res.json().catch(() => ({}));

  if(!res.ok){
    safeSetText("list-subtitle", "No disponible");
    setMsg("list-msg", data.message || "Endpoint no disponible o error.");
    if(tbody) tbody.innerHTML = `<tr><td class="td-empty" colspan="${colspan}">No disponible</td></tr>`;
    if(kind === "equipos") safeSetText("eq-total", 0);
    if(kind === "herramientas") safeSetText("he-total", 0);
    return;
  }

  const items = Array.isArray(data) ? data : (data.items || []);
  safeSetText("list-subtitle", `${items.length} registro(s)`);

  if(kind === "equipos") cacheEquipos = items;
  if(kind === "herramientas") cacheHerramientas = items;

  if(kind === "equipos") safeSetText("eq-total", items.length);
  if(kind === "herramientas") safeSetText("he-total", items.length);

  if(tbody){
    if(!items.length){
      tbody.innerHTML = `<tr><td class="td-empty" colspan="${colspan}">Sin registros</td></tr>`;
    } else {
      tbody.innerHTML = items.map(it => kind === "equipos" ? rowEqHtml(it) : rowHeHtml(it)).join("");
    }
  }
}

function editarEquipoDesdeLista(codigo){
  const item = (cacheEquipos || []).find(x => String(x.codigo_e ?? x.codigo ?? "").trim() === String(codigo).trim());
  if(!item){
    setMsg("list-msg", "No se pudo cargar el equipo para editar.");
    return;
  }

  switchTab("equipos");

  if($("eq-codigo")) $("eq-codigo").value = item.codigo_e || item.codigo || "";
  if($("eq-equipo")) $("eq-equipo").value = item.equipo || item.nombre || "";
  if($("eq-marca")) $("eq-marca").value = item.marca || "";
  if($("eq-modelo")) $("eq-modelo").value = item.modelo || "";
  if($("eq-serie")) $("eq-serie").value = item.num_serie || item.serie || "";
  if($("eq-ubi")) $("eq-ubi").value = item.ubicacion || "";

  editingEquipoCodigo = String(item.codigo_e || item.codigo || "").trim();
  setEqEditMode(true);

  setMsg("eq-msg", `Editando ${editingEquipoCodigo} (el código no se puede cambiar)`);
  closeListModal();
}

function editarHerramientaDesdeLista(codigo){
  const item = (cacheHerramientas || []).find(x => String(x.codigo_h ?? x.codigo ?? "").trim() === String(codigo).trim());
  if(!item){
    setMsg("list-msg", "No se pudo cargar la herramienta para editar.");
    return;
  }

  switchTab("herramientas");

  if($("he-codigo")) $("he-codigo").value = item.codigo_h || item.codigo || "";
  if($("he-nombre")) $("he-nombre").value = item.herramienta || item.nombre || "";
  if($("he-marca")) $("he-marca").value = item.marca || "";
  if($("he-modelo")) $("he-modelo").value = item.modelo || "";
  if($("he-tipo")) $("he-tipo").value = item.tipo_modelo || item.tipo || "";
  if($("he-ubi")) $("he-ubi").value = item.ubicacion || "";
  if($("he-stock")) $("he-stock").value = String(item.stock ?? "0");

  editingHerramientaCodigo = String(item.codigo_h || item.codigo || "").trim();
  setHeEditMode(true);

  setMsg("he-msg", `Editando ${editingHerramientaCodigo} (el código no se puede cambiar)`);
  closeListModal();
}

/* ---------------- Crear/Editar equipo/herramienta ---------------- */
async function crearEquipo(){
  setMsg("eq-msg", "");

  const codigoForm = $("eq-codigo")?.value?.trim() || "";
  const payload = {
    equipo: $("eq-equipo")?.value?.trim() || "",
    marca: $("eq-marca")?.value?.trim() || "",
    modelo: $("eq-modelo")?.value?.trim() || "",
    num_serie: $("eq-serie")?.value?.trim() || "",
    ubicacion: $("eq-ubi")?.value?.trim() || "",
  };

  // Modo CREAR
  if(!editingEquipoCodigo){
    const payloadCreate = { codigo_e: codigoForm, ...payload };
    if(!payloadCreate.codigo_e || !payloadCreate.equipo){
      setMsg("eq-msg", "Código y nombre de equipo son obligatorios.");
      return;
    }

    const res = await fetch(API("/api/admin/equipos"), {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payloadCreate)
    });

    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      setMsg("eq-msg", data.message || "Error guardando equipo.");
      return;
    }

    setMsg("eq-msg", "Equipo guardado ✅");
    limpiarEquipo();
    return;
  }

  // Modo EDITAR (PUT)
  if(!payload.equipo){
    setMsg("eq-msg", "El nombre de equipo es obligatorio.");
    return;
  }

  const codigo = editingEquipoCodigo;
  const res = await fetch(API(`/api/admin/equipos/${encodeURIComponent(codigo)}`), {
    method:"PUT",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    setMsg("eq-msg", data.message || "Error actualizando equipo.");
    return;
  }

  setMsg("eq-msg", `Equipo ${codigo} actualizado ✅`);
  limpiarEquipo();
}

function limpiarEquipo(){
  ["eq-codigo","eq-equipo","eq-marca","eq-modelo","eq-serie","eq-ubi"].forEach(id => {
    if($(id)) $(id).value = "";
  });

  // salir modo edición
  editingEquipoCodigo = null;
  setEqEditMode(false);
}

async function crearHerramienta(){
  setMsg("he-msg", "");

  const codigoForm = $("he-codigo")?.value?.trim() || "";
  const payload = {
    herramienta: $("he-nombre")?.value?.trim() || "",
    marca: $("he-marca")?.value?.trim() || "",
    modelo: $("he-modelo")?.value?.trim() || "",
    tipo_modelo: $("he-tipo")?.value?.trim() || "",
    ubicacion: $("he-ubi")?.value?.trim() || "",
    stock: Number($("he-stock")?.value || 0),
  };

  if(payload.stock < 0){
    setMsg("he-msg", "Stock inválido.");
    return;
  }

  // Modo CREAR
  if(!editingHerramientaCodigo){
    const payloadCreate = { codigo_h: codigoForm, ...payload };
    if(!payloadCreate.codigo_h || !payloadCreate.herramienta){
      setMsg("he-msg", "Código y nombre de herramienta son obligatorios.");
      return;
    }

    const res = await fetch(API("/api/admin/herramientas"), {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payloadCreate)
    });

    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      setMsg("he-msg", data.message || "Error guardando herramienta.");
      return;
    }

    setMsg("he-msg", "Herramienta guardada ✅");
    limpiarHerramienta();
    return;
  }

  // Modo EDITAR
  if(!payload.herramienta){
    setMsg("he-msg", "El nombre de herramienta es obligatorio.");
    return;
  }

  const codigo = editingHerramientaCodigo;
  const res = await fetch(API(`/api/admin/herramientas/${encodeURIComponent(codigo)}`), {
    method:"PUT",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    setMsg("he-msg", data.message || "Error actualizando herramienta.");
    return;
  }

  setMsg("he-msg", `Herramienta ${codigo} actualizada ✅`);
  limpiarHerramienta();
}

function limpiarHerramienta(){
  ["he-codigo","he-nombre","he-marca","he-modelo","he-tipo","he-ubi"].forEach(id => {
    if($(id)) $(id).value = "";
  });
  if($("he-stock")) $("he-stock").value = "1";

  editingHerramientaCodigo = null;
  setHeEditMode(false);
}

(function init(){
  const pass = $("admin-pass");
  if(pass){
    pass.addEventListener("keydown", (e) => {
      if(e.key === "Enter") adminLogin();
    });
  }
})();
