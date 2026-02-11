let itemActual = null;
let cantidad = 1;
let scannerStarting = false;
let zxingReader = null;
let zxingControls = null;


let pendientesCache = [];     
let pendientesView = [];      
let devolverTarget = null;    

function $(id){ return document.getElementById(id); }
const BASE = document.body?.dataset?.base || "";
const API  = (path) => `${BASE}${path}`;

function setStep(step){

  const d1 = $("dot-1"), d2 = $("dot-2");
  if(d1 && d2){
    d1.classList.toggle("active", step === 1);
    d2.classList.toggle("active", step === 2);
  }
}

function showMsg(id, text){
  const el = $(id);
  if(el) el.textContent = text || "";
}

function show(id, on){
  const el = $(id);
  if(el) el.style.display = on ? "block" : "none";
}

function normalizeText(s){
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

async function iniciarSesion(){
  showMsg("login-msg", "");
  const nombre = $("login-nombre").value.trim();
  const password = $("login-pass").value.trim();

  if(!nombre || !password){
    showMsg("login-msg", "Completa nombre y contraseña.");
    return;
  }

  const res = await fetch(API("/api/login"), {
    method:"POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({nombre, password})
  });

  const data = await res.json();
  if(!res.ok){
    showMsg("login-msg", data.message || "No autorizado");
    return;
  }

  $("auth-section").style.display = "none";
  $("menu-section").style.display = "block";

  if($("user-display-menu")){
    $("user-display-menu").textContent = `Hola, ${data.nombre}`;
  }
  
}

async function cerrarSesion(){
  await fetch(API("/api/logout"), {method:"POST"});
  location.reload();
}


function volverMenu(){

  show("scan-section", false);
  show("detail-section", false);
  show("menu-section", true);

  try{
    $("codigo").value = "";
  }catch(_e){}
  resetScan();
  limpiarDetalle();
}

function irARegistroSalida(){

  show("menu-section", false);
  show("detail-section", false);
  show("scan-section", true);

  setStep(1);

  const codigo = $("codigo");
  if(codigo){
    codigo.value = "";
    codigo.focus();
    codigo.onkeydown = (e) => {
      if(e.key === "Enter"){
        e.preventDefault();
        buscarCodigo();
      }
    };
  }

  resetScan();
}

function resetScan(){
  itemActual = null;
  cantidad = 1;
  $("preview").style.display = "none";
  $("btn-continuar").disabled = true;
  showMsg("scan-msg", "");
}

function limpiarDetalle(){
  showMsg("detail-msg", "");
  $("detalle-equipo").style.display = "none";
  $("detalle-herramienta").style.display = "none";
}

async function buscarCodigo(){
  limpiarDetalle();
  showMsg("scan-msg", "");

  const codigo = $("codigo").value.trim();
  if(!codigo){
    showMsg("scan-msg", "Ingresa o escanea un código.");
    return;
  }

  const res = await fetch(API(`/api/item/${encodeURIComponent(codigo)}`));
  const data = await res.json();

  if(!res.ok){
    showMsg("scan-msg", data.message || "No encontrado.");
    resetScan();
    $("codigo").value = "";
    $("codigo").focus();
    return;
  }

  itemActual = data;

  $("preview").style.display = "block";
  $("p-tipo").textContent = data.tipo;
  $("p-nombre").textContent = data.nombre;

  if(data.tipo === "EQUIPO"){
    $("p-stock").textContent = data.disponible ? "Estado: DISPONIBLE" : `Estado: ${data.estado}`;
  } else {
    $("p-stock").textContent = `Stock disponible: ${data.stock}`;
  }

  if(!data.disponible){
    showMsg("scan-msg", "No disponible. Ingresa/escanea otro código.");
    $("btn-continuar").disabled = true;
    $("codigo").value = "";
    $("codigo").focus();
    return;
  }

  $("btn-continuar").disabled = false;
}

function continuar(){
  if(!itemActual) return;

  $("scan-section").style.display = "none";
  $("detail-section").style.display = "block";
  setStep(2);

  if(itemActual.tipo === "EQUIPO"){
    $("detalle-equipo").style.display = "block";
    $("detalle-herramienta").style.display = "none";

    $("e-nombre").textContent = itemActual.nombre || "";
    $("e-marca").textContent = itemActual.marca || "-";
    $("e-modelo").textContent = itemActual.modelo || "-";
    $("e-serie").textContent = itemActual.num_serie || "-";
  } else {
    $("detalle-equipo").style.display = "none";
    $("detalle-herramienta").style.display = "block";

    cantidad = 1;
    $("cantidad").textContent = "1";
    $("h-nombre").textContent = itemActual.nombre || "";
    $("h-modelo").textContent = itemActual.modelo || "-";
    $("h-tipo").textContent = itemActual.tipo_modelo || "-";
    $("h-stock").textContent = String(itemActual.stock ?? 0);
  }
}

function volver(){
  $("detail-section").style.display = "none";
  $("scan-section").style.display = "block";
  setStep(1);

  $("codigo").value = "";
  resetScan();
  limpiarDetalle();
  $("codigo").focus();
}

function mas(){
  if(!itemActual || itemActual.tipo !== "HERRAMIENTA") return;
  const max = Number(itemActual.stock || 0);
  if(cantidad < max){
    cantidad++;
    $("cantidad").textContent = String(cantidad);
  }
}

function menos(){
  if(!itemActual || itemActual.tipo !== "HERRAMIENTA") return;
  if(cantidad > 1){
    cantidad--;
    $("cantidad").textContent = String(cantidad);
  }
}

function abrirConfirm(){
  showMsg("detail-msg", "");
  if(!itemActual) return;

  let txt = "";
  if(itemActual.tipo === "EQUIPO"){
    txt = `¿Confirmas el retiro del equipo "${itemActual.nombre}"?`;
  } else {
    txt = `¿Confirmas el retiro de ${cantidad} unidad(es) de la herramienta "${itemActual.nombre}"?`;
  }

  $("confirm-text").textContent = txt;
  $("confirm-modal").style.display = "flex";
}

function cerrarConfirm(){
  $("confirm-modal").style.display = "none";
}

async function registrarConfirmado(){
  cerrarConfirm();
  if(!itemActual) return;

  const payload = {
    tipo: itemActual.tipo,
    codigo: itemActual.codigo,
    cantidad: (itemActual.tipo === "EQUIPO") ? 1 : cantidad
  };

  const res = await fetch(API("/api/movimiento"), {
    method:"POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if(!res.ok){
    showMsg("detail-msg", data.message || "Error registrando.");
    return;
  }

  showMsg("detail-msg", "Registrado correctamente ✅");
  setTimeout(() => {
    volver();
  }, 500);
}

function abrirPendientes(){
  showMsg("pendientes-msg", "");
  if($("pendientes-q")) $("pendientes-q").value = "";
  $("pendientes-modal").style.display = "flex";
  recargarPendientes();
}

function cerrarPendientes(){
  $("pendientes-modal").style.display = "none";
  showMsg("pendientes-msg", "");
}

async function recargarPendientes(){
  showMsg("pendientes-msg", "");
  if($("pendientes-sub")) $("pendientes-sub").textContent = "Cargando…";

  const tbody = $("pendientes-tbody");
  if(tbody){
    tbody.innerHTML = `<tr><td colspan="7" style="padding:14px 12px; color: rgba(255,255,255,0.70);">Cargando…</td></tr>`;
  }

  try{

    const res = await fetch(API("/api/pendientes"), { method: "GET" });
    const data = await res.json().catch(()=> ({}));

    if(!res.ok){
      showMsg("pendientes-msg", data.message || "No se pudo cargar tus pendientes.");
      if($("pendientes-sub")) $("pendientes-sub").textContent = "No disponible";
      if(tbody){
        tbody.innerHTML = `<tr><td colspan="7" style="padding:14px 12px; color: rgba(255,255,255,0.70);">No disponible</td></tr>`;
      }
      return;
    }

    const items = data.items || [];
    pendientesCache = items;
    pendientesView = items;

    if($("pendientes-sub")){
      $("pendientes-sub").textContent = `${items.length} pendiente(s)`;
    }

    renderPendientesTable(pendientesView);

  }catch(e){
    console.error(e);
    showMsg("pendientes-msg", "Error de conexión cargando pendientes.");
    if($("pendientes-sub")) $("pendientes-sub").textContent = "Error";
    if(tbody){
      tbody.innerHTML = `<tr><td colspan="7" style="padding:14px 12px; color: rgba(255,255,255,0.70);">Error</td></tr>`;
    }
  }
}

function filtrarPendientesLocal(){
  const q = normalizeText($("pendientes-q")?.value || "");
  if(!q){
    pendientesView = pendientesCache;
    renderPendientesTable(pendientesView);
    if($("pendientes-sub")) $("pendientes-sub").textContent = `${pendientesView.length} pendiente(s)`;
    return;
  }

  pendientesView = (pendientesCache || []).filter(it => {
    const blob = normalizeText([
      it.item_nombre,
      it.codigo_item,
      it.tipo_item,
      it.especificacion,
      it.marca,
      it.modelo,
      it.tipo_modelo,
      it.num_serie
    ].filter(Boolean).join(" "));
    return blob.includes(q);
  });

  renderPendientesTable(pendientesView);
  if($("pendientes-sub")) $("pendientes-sub").textContent = `${pendientesView.length} pendiente(s)`;
}

function renderPendientesTable(items){
  const tbody = $("pendientes-tbody");
  if(!tbody) return;

  if(!items || !items.length){
    tbody.innerHTML = `<tr><td colspan="7" style="padding:14px 12px; color: rgba(255,255,255,0.70);">No tienes pendientes 🎉</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(it => {
    const tipo = escapeHtml(it.tipo_item || "-");
    const nombre = escapeHtml(it.item_nombre || "-");
    const codigo = escapeHtml(it.codigo_item || "-");
    const detalle = escapeHtml(it.especificacion || "-");
    const cant = escapeHtml(it.cantidad ?? 1);
    const fecha = escapeHtml(fmtFecha(it.fecha_salida));
    const idMov = escapeHtml(it.id_mov ?? "");

    return `
      <tr>
        <td style="padding:10px 12px;">${fecha}</td>
        <td style="padding:10px 12px;">${tipo}</td>
        <td style="padding:10px 12px;"><b>${nombre}</b></td>
        <td style="padding:10px 12px;">${codigo}</td>
        <td style="padding:10px 12px;">${detalle}</td>
        <td style="padding:10px 12px;">${cant}</td>
        <td style="padding:10px 12px; text-align:right;">
          <button class="btn primary" style="padding:8px 10px;" onclick="abrirDevolverConfirm('${idMov}')">Devolver</button>
        </td>
      </tr>
    `;
  }).join("");
}

function abrirDevolverConfirm(idMov){
  showMsg("devolver-msg", "");
  const it = (pendientesCache || []).find(x => String(x.id_mov) === String(idMov));
  if(!it){
    showMsg("pendientes-msg", "No se encontró ese pendiente. Refresca la lista.");
    return;
  }

  devolverTarget = it;

  const nombre = it.item_nombre || it.codigo_item || "ítem";
  const cant = Number(it.cantidad || 1);
  const tipo = it.tipo_item || "";

  let txt = "";
  if(tipo === "EQUIPO"){
    txt = `¿Confirmas la devolución del equipo "${nombre}" (${it.codigo_item})?`;
  } else {
    txt = `¿Confirmas la devolución de ${cant} unidad(es) de "${nombre}" (${it.codigo_item})?`;
  }

  if($("devolver-text")) $("devolver-text").textContent = txt;
  $("devolver-modal").style.display = "flex";
}

function cerrarDevolverConfirm(){
  $("devolver-modal").style.display = "none";
  showMsg("devolver-msg", "");
  devolverTarget = null;
}

async function devolverConfirmado(){
  showMsg("devolver-msg", "");
  if(!devolverTarget){
    showMsg("devolver-msg", "No hay ítem seleccionado.");
    return;
  }

  try{

    const res = await fetch(API("/api/devolver"), {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ id_mov: devolverTarget.id_mov })
    });

    const data = await res.json().catch(()=> ({}));
    if(!res.ok){
      showMsg("devolver-msg", data.message || "No se pudo devolver.");
      return;
    }

    showMsg("devolver-msg", "Devuelto correctamente ✅");

    pendientesCache = (pendientesCache || []).filter(x => String(x.id_mov) !== String(devolverTarget.id_mov));
    filtrarPendientesLocal();

    setTimeout(() => {
      cerrarDevolverConfirm();

      if($("pendientes-sub")) $("pendientes-sub").textContent = `${pendientesView.length} pendiente(s)`;
    }, 450);

  }catch(e){
    console.error(e);
    showMsg("devolver-msg", "Error de conexión.");
  }
}

function ayudaScanner(){
  showMsg("scanner-msg", "Tip: buena luz + enfocar. Acerca el código de barras y mantén estable. Si no detecta, escribe manual.");
}

async function abrirScanner(){
  if(scannerStarting) return;
  scannerStarting = true;

  showMsg("scanner-msg", "Abriendo cámara...");
  $("scanner-modal").style.display = "flex";

  try{
    if(!window.ZXingBrowser){
      showMsg("scanner-msg", "No se pudo cargar el escáner. Revisa tu conexión a internet.");
      return;
    }

    await detenerScannerZXing();

    if(!zxingReader){
      zxingReader = new window.ZXingBrowser.BrowserMultiFormatReader();
    }

    const videoEl = $("scanner-video");

    const hints = new Map();
    if (window.ZXingBrowser?.DecodeHintType && window.ZXingBrowser?.BarcodeFormat) {
      const F = window.ZXingBrowser.BarcodeFormat;
      const H = window.ZXingBrowser.DecodeHintType;

      hints.set(H.POSSIBLE_FORMATS, [
        F.CODE_128, F.CODE_39, F.ITF, F.CODABAR,
        F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
        F.QR_CODE, F.DATA_MATRIX, F.PDF_417
      ]);

      hints.set(H.TRY_HARDER, true);
    }

    zxingControls = await zxingReader.decodeFromVideoDevice(
      undefined,
      videoEl,
      (result, err) => {
        if(result){
          const raw = (result.getText ? result.getText() : String(result)).trim();
          if(raw){
            $("codigo").value = raw;
            cerrarScanner();
            buscarCodigo();
          }
        } else if (err) {
          const name = err?.name || "";
          if(name && name !== "NotFoundException") console.log("ZXing err:", err);
        }
      },
      hints
    );

    tapToFocus(videoEl);
    showMsg("scanner-msg", "Escaneando... apunta al código de barras.");

  }catch(e){
    console.log("abrirScanner error:", e);
    showMsg("scanner-msg", "No se pudo acceder a la cámara. Revisa permisos del navegador.");
  }finally{
    scannerStarting = false;
  }
}

function tapToFocus(videoEl){
  if(!videoEl) return;

  if(videoEl.dataset.tapFocus === "1") return;
  videoEl.dataset.tapFocus = "1";

  videoEl.addEventListener("click", async () => {
    try{
      const stream = videoEl.srcObject;
      const track = stream?.getVideoTracks?.()[0];
      if(!track) return;

      const caps = track.getCapabilities ? track.getCapabilities() : {};
      const settings = track.getSettings ? track.getSettings() : {};

      let applied = false;

      if(Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")){
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
        applied = true;
      }

      console.log("Focus constraints. applied:", applied, "settings:", settings, "caps:", caps);
      showMsg("scanner-msg", applied ? "Enfocando… ✅" : "Enfoque automático (normal).");
      setTimeout(() => showMsg("scanner-msg", "Escaneando... apunta al código."), 700);

    }catch(e){
      console.log("tapToFocus failed:", e);
    }
  });
}

async function detenerScannerZXing(){

  try{
    if(zxingControls && typeof zxingControls.stop === "function"){
      zxingControls.stop();
    }
  }catch(_e){}
  zxingControls = null;

  try{
    if(zxingReader && typeof zxingReader.reset === "function"){
      zxingReader.reset();
    }
  }catch(_e){}

  const videoEl = $("scanner-video");
  if(videoEl){
    const stream = videoEl.srcObject;
    if(stream && stream.getTracks){
      try{
        stream.getTracks().forEach(t => t.stop());
      }catch(_e){}
    }

    try{ videoEl.pause(); }catch(_e){}
    videoEl.srcObject = null;
    videoEl.load();
    videoEl.removeAttribute("src");
    videoEl.removeAttribute("srcObject");
  }
}

async function cerrarScanner(){
  $("scanner-modal").style.display = "none";
  await detenerScannerZXing();
  showMsg("scanner-msg", "");
}

(function init(){
  const pass = $("login-pass");
  if(pass){
    pass.addEventListener("keydown", (e) => {
      if(e.key === "Enter") iniciarSesion();
    });
  }

})();

function volverAlMenuPrincipal() {
  const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";

  if (isLocal) {
    // tu menú principal en local (asistencias)
    window.location.href = "http://127.0.0.1:5000/";
    return;
  }

  // menú principal ya desplegado (asistencias en Railway)
  window.location.href = "https://sis-asistencia-railway-production.up.railway.app/";
 
}


