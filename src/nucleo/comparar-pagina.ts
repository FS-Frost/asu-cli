// Página de una comparación (index.html): autocontenida, funciona servida por asu (con acciones) o
// abierta como archivo (solo lectura). Los datos van incrustados; con servidor se releen de la API.
import type { Resultados } from "./comparar-resultados.ts";

function escapar(texto: string): string {
    return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** JSON seguro dentro de <script>: "<" escapado para que nada pueda cerrar el script. */
function jsonIncrustado(valor: unknown): string {
    return JSON.stringify(valor).replace(/</g, String.fromCharCode(92) + "u003c");
}

export function generarPagina(resultados: Resultados): string {
    const titulo = `Comparación x264 — ${resultados.episodio.serie} ${resultados.episodio.episodio} (${resultados.salida.etiqueta})`;
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
<style>${ESTILOS}</style>
</head>
<body>
<header>
  <div class="fila">
    <h1>${escapar(titulo)}</h1>
    <span class="separador"></span>
    <span id="modo" class="tenue"></span>
    <button id="abrir-carpeta" class="solo-servidor">Abrir carpeta</button>
    <button id="cerrar" class="solo-servidor">Cerrar servidor</button>
  </div>
  <div id="metodo" class="tenue"></div>
  <div id="tabla"></div>
  <nav id="pestanas"></nav>
</header>
<main>
  <section id="vista-ciegas"></section>
  <section id="vista-capturas"></section>
  <section id="vista-clips"></section>
  <section id="vista-grafico"></section>
</main>
<script>const DATOS_INCRUSTADOS = ${jsonIncrustado(resultados)};</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

const ESTILOS = `
:root { color-scheme: dark; --fondo: #18181b; --panel: #232327; --borde: #3f3f46; --texto: #e4e4e7; --tenue: #a1a1aa; --acento: #60a5fa; --peligro: #f87171; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--fondo); color: var(--texto); font: 14px/1.4 system-ui, sans-serif; }
header { padding: 10px 16px 0; background: var(--panel); position: sticky; top: 0; z-index: 5; }
h1 { margin: 0; font-size: 17px; }
.fila { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.separador { flex: 1; }
.tenue { color: var(--tenue); }
button, select, input { background: var(--fondo); color: var(--texto); border: 1px solid var(--borde); border-radius: 4px; padding: 4px 10px; font: inherit; }
button { cursor: pointer; } button:hover { border-color: var(--acento); }
button.activo { border-color: var(--acento); color: var(--acento); }
button:disabled { opacity: .4; cursor: not-allowed; }
.oculto { display: none !important; }
body.archivo .solo-servidor { display: none !important; }
table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 13px; }
th, td { border-bottom: 1px solid var(--borde); padding: 3px 8px; text-align: left; vertical-align: top; }
th:nth-child(n+3), td:nth-child(n+3) { text-align: right; white-space: nowrap; }
code { color: var(--tenue); font-size: 12px; }
kbd { border: 1px solid #555; border-radius: 3px; padding: 0 4px; font-size: 12px; }
nav { display: flex; gap: 4px; margin-top: 6px; }
nav button { border-bottom: none; border-radius: 6px 6px 0 0; }
main section { padding: 8px 16px; }
.controles { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 6px; }
.visor { position: relative; overflow: auto; height: calc(100vh - 330px); min-height: 300px; background: #000; border: 1px solid var(--borde); cursor: grab; }
.visor.arrastrando { cursor: grabbing; }
.lienzo { position: relative; margin: 0 auto; }
.lienzo img, .lienzo canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; image-rendering: pixelated; user-select: none; -webkit-user-drag: none; }
.divisor { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--acento); pointer-events: none; }
.rotulo { position: absolute; top: 6px; padding: 2px 6px; background: rgba(0,0,0,.7); border-radius: 3px; font-weight: 600; pointer-events: none; }
.miniaturas { display: flex; gap: 6px; overflow-x: auto; padding: 6px 0; }
.miniatura { flex: none; width: 150px; cursor: pointer; border: 2px solid transparent; border-radius: 4px; background: var(--panel); font-size: 11px; }
.miniatura.activa { border-color: var(--acento); }
.miniatura img { width: 100%; display: block; border-radius: 2px 2px 0 0; }
.miniatura div { padding: 2px 4px; }
.adoptar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; padding: 6px 8px; background: var(--panel); border-radius: 4px; }
.adoptar code { color: var(--texto); background: var(--fondo); padding: 2px 6px; border-radius: 3px; }
.videos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.videos video { width: 100%; background: #000; }
.votos { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.votos button { min-width: 90px; font-size: 15px; }
.aviso { padding: 6px 10px; background: #3b2f0b; border: 1px solid #92400e; border-radius: 4px; margin: 6px 0; }
svg text { fill: var(--tenue); font-size: 11px; }
.leyenda { display: flex; gap: 12px; flex-wrap: wrap; margin: 4px 0; }
.leyenda span::before { content: ""; display: inline-block; width: 12px; height: 3px; margin-right: 4px; vertical-align: middle; background: var(--color); }
`;

const SCRIPT = `
"use strict";
const COLORES = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#2dd4bf"];
const parametros = new URLSearchParams(location.search);
const TOKEN = parametros.get("token");
const SERVIDOR = location.protocol.startsWith("http") && !!TOKEN;
let D = DATOS_INCRUSTADOS;
const nombres = D.variantes.map((v) => v.nombre);
const clave = (sufijo) => "asu-comparar:" + D.fecha + ":" + sufijo;
const guardado = (sufijo, porDefecto) => { try { return JSON.parse(localStorage.getItem(clave(sufijo))) ?? porDefecto; } catch { return porDefecto; } };
const guardar = (sufijo, valor) => { try { localStorage.setItem(clave(sufijo), JSON.stringify(valor)); } catch {} };

const sesion = guardado("sesion", null) || (() => { const s = Math.random().toString(36).slice(2) + Date.now().toString(36); guardar("sesion", s); return s; })();
let revelado = guardado("revelado", false);
let misVotos = guardado("votos", {});

document.body.classList.toggle("archivo", !SERVIDOR);
document.getElementById("modo").textContent = SERVIDOR ? "conectado a asu" : "solo lectura (abierta como archivo)";

function el(etiqueta, atributos = {}, ...hijos) {
  const e = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
  }
  for (const h of hijos.flat()) if (h !== null && h !== undefined) e.append(h instanceof Node ? h : String(h));
  return e;
}
const num = (v, d) => (v === null || v === undefined ? "—" : v === Infinity ? "∞" : Number(v).toFixed(d));
const tiempo = (s) => { const t = Math.floor(s), m = Math.floor(t / 60); return String(m).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); };

async function api(ruta, cuerpo) {
  const r = await fetch("/api/" + ruta, {
    method: cuerpo ? "POST" : "GET",
    headers: { "x-asu-token": TOKEN, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json();
  if (!r.ok) throw new Error(datos.error || "Error " + r.status);
  return datos;
}

function copiar(texto, boton) {
  const listo = () => { boton.textContent = "Copiado"; setTimeout(() => (boton.textContent = "Copiar"), 1500); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(texto).then(listo, () => antiguo() && listo());
  else if (antiguo()) listo();
  function antiguo() { const a = el("textarea"); a.value = texto; document.body.append(a); a.select(); const ok = document.execCommand("copy"); a.remove(); return ok; }
}

// ---------- Encabezado y tabla ----------
const MOTIVOS_TRAMO = { oscuro: "más oscuro", movimiento: "más movimiento", detalle: "más detalle", fijo: "fijo", manual: "manual" };
document.getElementById("metodo").textContent = D.metodo.descripcion + " Tramos: " +
  D.tramos.map((t) => t.indice + ") " + tiempo(t.inicio) + "-" + tiempo(t.inicio + t.duracion) + " " + MOTIVOS_TRAMO[t.motivo]).join(" · ");

function conteo() {
  const c = { empate: 0 }; nombres.forEach((n) => (c[n] = 0));
  for (const v of D.votos) c[v.eleccion] = (c[v.eleccion] || 0) + 1;
  return c;
}

function dibujarTabla() {
  const caja = document.getElementById("tabla");
  caja.replaceChildren();
  if (!revelado) {
    caja.append(el("div", { class: "tenue" }, "Tabla y nombres ocultos hasta votar o revelar (pestaña A ciegas)."));
    return;
  }
  const votos = conteo();
  caja.append(el("table", {},
    el("thead", {}, el("tr", {}, ["Variante", "Ajustes", "kbps", "kbps con CRF", "fps", "SSIM", "PSNR (dB)", "Votos"].map((t) => el("th", {}, t)))),
    el("tbody", {}, D.variantes.map((v, i) => el("tr", {},
      el("td", {}, el("kbd", {}, i + 1), " ", el("b", { style: "color:" + COLORES[i % COLORES.length] }, v.nombre)),
      el("td", {}, v.descripcion, el("br"), el("code", {}, v.argumentos || "(sin cambios)")),
      el("td", {}, num(v.promedio.kbps, 0)), el("td", {}, num(v.promedio.kbpsCrf, 0)), el("td", {}, num(v.promedio.fps, 1)),
      el("td", {}, num(v.promedio.ssim, 5)), el("td", {}, num(v.promedio.psnr, 2)), el("td", {}, votos[v.nombre] || 0),
    ))),
  ));
  if (votos.empate) caja.append(el("div", { class: "tenue" }, "Empates: " + votos.empate));
}

// ---------- Pestañas ----------
const PESTANAS = [["ciegas", "A ciegas"], ["capturas", "Capturas"], ["clips", "Clips"], ["grafico", "Gráfico"]];
let pestana = revelado ? guardado("pestana", "capturas") : "ciegas";
function dibujarPestanas() {
  const nav = document.getElementById("pestanas");
  nav.replaceChildren(...PESTANAS.map(([id, texto]) => el("button", {
    class: id === pestana ? "activo" : "",
    disabled: !revelado && id !== "ciegas" ? true : null,
    title: !revelado && id !== "ciegas" ? "Vota o revela primero" : null,
    onclick: () => { pestana = id; guardar("pestana", id); mostrar(); },
  }, texto)));
}
function mostrar() {
  dibujarPestanas();
  for (const [id] of PESTANAS) document.getElementById("vista-" + id).classList.toggle("oculto", id !== pestana);
  ({ ciegas: vistaCiegas, capturas: vistaCapturas, clips: vistaClips, grafico: vistaGrafico })[pestana]();
}

// ---------- Visor con zoom y arrastre ----------
let zoom = guardado("zoom", 0); // 0 = ajustar
function crearVisor() {
  const visor = el("div", { class: "visor" });
  const lienzo = el("div", { class: "lienzo" });
  visor.append(lienzo);
  let arrastre = null;
  visor.addEventListener("mousedown", (e) => { arrastre = { x: e.clientX, y: e.clientY, l: visor.scrollLeft, t: visor.scrollTop }; visor.classList.add("arrastrando"); e.preventDefault(); });
  addEventListener("mousemove", (e) => { if (arrastre) { visor.scrollLeft = arrastre.l - (e.clientX - arrastre.x); visor.scrollTop = arrastre.t - (e.clientY - arrastre.y); } });
  addEventListener("mouseup", () => { arrastre = null; visor.classList.remove("arrastrando"); });
  return { visor, lienzo, arrastrando: () => arrastre !== null };
}
function ajustarLienzo(visor, lienzo, ancho, alto) {
  let escala = zoom;
  if (!escala) escala = Math.min((visor.clientWidth - 2) / ancho, (visor.clientHeight - 2) / alto, 1);
  const izq = visor.scrollLeft / (lienzo.offsetWidth || 1), arr = visor.scrollTop / (lienzo.offsetHeight || 1);
  lienzo.style.width = ancho * escala + "px";
  lienzo.style.height = alto * escala + "px";
  visor.scrollLeft = izq * lienzo.offsetWidth; visor.scrollTop = arr * lienzo.offsetHeight;
}
function controlesZoom(alCambiar) {
  return el("span", {}, "Zoom: ", [[0, "Ajustar"], [1, "1x"], [2, "2x"], [4, "4x"]].map(([z, t]) =>
    el("button", { class: zoom === z ? "activo" : "", onclick: () => { zoom = z; guardar("zoom", z); alCambiar(); } }, t)));
}

// ---------- A ciegas ----------
function orden(captura) {
  // Orden aleatorio estable por sesión y captura.
  let semilla = 0; for (const c of sesion + ":" + captura) semilla = (semilla * 31 + c.charCodeAt(0)) >>> 0;
  const lista = [...nombres];
  for (let i = lista.length - 1; i > 0; i--) { semilla = (semilla * 1664525 + 1013904223) >>> 0; const j = semilla % (i + 1); [lista[i], lista[j]] = [lista[j], lista[i]]; }
  return lista;
}
let ciegaCaptura = guardado("ciegaCaptura", 0), ciegaVersion = 0;
const LETRAS = "ABCDEFG";
function vistaCiegas() {
  const caja = document.getElementById("vista-ciegas");
  caja.replaceChildren();
  const c = D.capturas[ciegaCaptura];
  const lista = orden(ciegaCaptura);
  const votadas = Object.keys(misVotos).length;
  const { visor, lienzo } = crearVisor();
  const img = el("img", { alt: "" });
  img.src = ciegaVersion === 0 ? c.fuente : c.variantes[lista[ciegaVersion - 1]];
  img.onload = () => ajustarLienzo(visor, lienzo, img.naturalWidth, img.naturalHeight);
  lienzo.append(img, el("span", { class: "rotulo", style: "left:6px" }, ciegaVersion === 0 ? "fuente" : (revelado ? lista[ciegaVersion - 1] : LETRAS[ciegaVersion - 1])));

  const votar = async (eleccion) => {
    misVotos[ciegaCaptura] = eleccion; guardar("votos", misVotos);
    if (SERVIDOR) {
      try { await api("votos", { sesion, captura: ciegaCaptura, eleccion }); D = await api("resultados"); }
      catch (e) { alert("No se pudo guardar el voto: " + e.message); }
    } else {
      D.votos = D.votos.filter((v) => !(v.sesion === sesion && v.captura === ciegaCaptura)).concat([{ sesion, captura: ciegaCaptura, eleccion, fecha: new Date().toISOString() }]);
    }
    if (ciegaCaptura < D.capturas.length - 1) { ciegaCaptura++; ciegaVersion = 0; guardar("ciegaCaptura", ciegaCaptura); }
    else if (!revelado) revelar();
    mostrar();
  };

  caja.append(
    el("div", { class: "controles" },
      el("b", {}, "Captura " + (ciegaCaptura + 1) + "/" + D.capturas.length),
      el("span", { class: "tenue" }, "Tramo " + c.tramo + " · " + tiempo(c.segundo) + " · votadas " + votadas),
      el("button", { onclick: () => { if (ciegaCaptura > 0) { ciegaCaptura--; ciegaVersion = 0; mostrar(); } } }, "← Anterior"),
      el("button", { onclick: () => { if (ciegaCaptura < D.capturas.length - 1) { ciegaCaptura++; ciegaVersion = 0; mostrar(); } } }, "Siguiente →"),
      el("span", { class: "separador" }),
      revelado ? el("span", { class: "tenue" }, "Revelado") : el("button", { onclick: () => { if (confirm("¿Revelar nombres y resultados?")) revelar(); } }, "Revelar"),
    ),
    el("div", { class: "controles" },
      el("button", { class: ciegaVersion === 0 ? "activo" : "", onclick: () => { ciegaVersion = 0; mostrar(); } }, "0 fuente"),
      lista.map((n, i) => el("button", { class: ciegaVersion === i + 1 ? "activo" : "", onclick: () => { ciegaVersion = i + 1; mostrar(); } }, (i + 1) + " " + (revelado ? n : LETRAS[i]))),
      controlesZoom(mostrar),
    ),
    visor,
    el("div", { class: "votos" },
      el("span", {}, "¿Cuál se ve mejor?"),
      lista.map((n, i) => el("button", { class: misVotos[ciegaCaptura] === n ? "activo" : "", onclick: () => votar(n) }, revelado ? n : LETRAS[i])),
      el("button", { class: misVotos[ciegaCaptura] === "empate" ? "activo" : "", onclick: () => votar("empate") }, "Empate"),
    ),
    el("div", { class: "tenue" }, "Teclas: 0-" + lista.length + " cambian de versión, ←/→ de captura. Las letras se mezclan en cada captura." + (SERVIDOR ? "" : " Sin servidor, los votos solo quedan en este navegador.")),
  );
}
function revelar() { revelado = true; guardar("revelado", true); pestana = "capturas"; dibujarTabla(); mostrar(); }

// ---------- Capturas ----------
let captura = guardado("captura", 0), modoVista = guardado("modoVista", "alternar"), version = 1;
let izquierda = nombres[0], derecha = nombres[1] || nombres[0], amplificacion = 8, posicionCortina = 50, cortinaFija = false;
const imagenes = {};
function cargar(src) { return imagenes[src] || (imagenes[src] = new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = src; })); }
const rutaVersion = (c, n) => (n === "fuente" ? c.fuente : c.variantes[n]);

function vistaCapturas() {
  const caja = document.getElementById("vista-capturas");
  caja.replaceChildren();
  const c = D.capturas[captura];
  const { visor, lienzo, arrastrando } = crearVisor();
  const versiones = ["fuente", ...nombres];
  const selector = (valor, alCambiar) => el("select", { onchange: (e) => alCambiar(e.target.value) }, versiones.map((n) => el("option", { value: n, selected: n === valor ? true : null }, n)));

  const controles = el("div", { class: "controles" },
    "Vista: ", [["alternar", "Alternar"], ["cortina", "Cortina"], ["diferencia", "Diferencia"]].map(([m, t]) =>
      el("button", { class: modoVista === m ? "activo" : "", onclick: () => { modoVista = m; guardar("modoVista", m); mostrar(); } }, t)),
    controlesZoom(mostrar));
  caja.append(controles);

  const ssim = nombres.map((n, i) => el("span", { style: "color:" + COLORES[i % COLORES.length] }, n + " " + num(c.ssim[n], 5))).flatMap((s, i) => (i ? [" · ", s] : [s]));
  caja.append(el("div", { class: "tenue" }, "Captura " + (captura + 1) + "/" + D.capturas.length + " · tramo " + c.tramo + " · " + tiempo(c.segundo) + " · frame " + c.frame +
    " · " + (c.motivo === "diferencia" ? "donde más difieren" : "donde alguna cae más") + " · SSIM: ", ...ssim));

  let adoptarVariante = null;
  if (modoVista === "alternar") {
    caja.append(el("div", { class: "controles" }, versiones.map((n, i) => el("button", { class: version === i ? "activo" : "", onclick: () => { version = i; mostrar(); } }, i + " " + n))));
    const nombre = versiones[version];
    const img = el("img", { alt: "" }); img.src = rutaVersion(c, nombre);
    img.onload = () => ajustarLienzo(visor, lienzo, img.naturalWidth, img.naturalHeight);
    lienzo.append(img, el("span", { class: "rotulo", style: "left:6px" }, nombre));
    adoptarVariante = nombre;
  } else if (modoVista === "cortina") {
    caja.append(el("div", { class: "controles" }, "Izquierda: ", selector(izquierda, (v) => { izquierda = v; mostrar(); }), " Derecha: ", selector(derecha, (v) => { derecha = v; mostrar(); }),
      el("span", { class: "tenue" }, "El divisor sigue al mouse; clic lo fija o lo suelta.")));
    const base = el("img", { alt: "" }); base.src = rutaVersion(c, derecha);
    const arriba = el("img", { alt: "" }); arriba.src = rutaVersion(c, izquierda);
    const divisor = el("div", { class: "divisor" });
    const aplicar = () => { arriba.style.clipPath = "inset(0 " + (100 - posicionCortina) + "% 0 0)"; divisor.style.left = posicionCortina + "%"; };
    base.onload = () => ajustarLienzo(visor, lienzo, base.naturalWidth, base.naturalHeight);
    lienzo.append(base, arriba, divisor, el("span", { class: "rotulo", style: "left:6px" }, izquierda), el("span", { class: "rotulo", style: "right:6px" }, derecha));
    aplicar();
    lienzo.addEventListener("mousemove", (e) => { if (cortinaFija || arrastrando()) return; const r = lienzo.getBoundingClientRect(); posicionCortina = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)); aplicar(); });
    lienzo.addEventListener("click", () => (cortinaFija = !cortinaFija));
    adoptarVariante = derecha;
  } else {
    const variante = nombres.includes(izquierda) ? izquierda : nombres[0];
    caja.append(el("div", { class: "controles" }, "Variante: ", el("select", { onchange: (e) => { izquierda = e.target.value; mostrar(); } }, nombres.map((n) => el("option", { value: n, selected: n === variante ? true : null }, n))),
      " Amplificación ×", el("input", { type: "range", min: 1, max: 16, value: amplificacion, oninput: (e) => { amplificacion = Number(e.target.value); etiquetaAmp.textContent = amplificacion; pintar(); } }),
      etiquetaAmp = el("b", {}, amplificacion), el("span", { class: "tenue" }, "|variante − fuente| × amplificación: lo que brilla es lo que se perdió.")));
    const lienzoDif = el("canvas");
    lienzo.append(lienzoDif, el("span", { class: "rotulo", style: "left:6px" }, "diferencia: " + variante));
    let pixeles = null;
    async function pintar() {
      if (!pixeles) {
        try {
          const [a, b] = await Promise.all([cargar(rutaVersion(c, variante)), cargar(c.fuente)]);
          const w = a.naturalWidth, h = a.naturalHeight;
          const leer = (img) => { const cv = el("canvas"); cv.width = w; cv.height = h; const x = cv.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
          pixeles = { a: leer(a), b: leer(b), w, h };
          lienzoDif.width = w; lienzoDif.height = h; ajustarLienzo(visor, lienzo, w, h);
        } catch {
          caja.insertBefore(el("div", { class: "aviso" }, "La vista de diferencia necesita la página servida por asu (asu comparar abrir): abierta como archivo, el navegador no permite leer los píxeles."), visor);
          return;
        }
      }
      const { a, b, w, h } = pixeles;
      const salida = new ImageData(w, h);
      for (let i = 0; i < a.length; i += 4) {
        salida.data[i] = Math.min(255, Math.abs(a[i] - b[i]) * amplificacion);
        salida.data[i + 1] = Math.min(255, Math.abs(a[i + 1] - b[i + 1]) * amplificacion);
        salida.data[i + 2] = Math.min(255, Math.abs(a[i + 2] - b[i + 2]) * amplificacion);
        salida.data[i + 3] = 255;
      }
      lienzoDif.getContext("2d").putImageData(salida, 0, 0);
    }
    var etiquetaAmp;
    pintar();
    adoptarVariante = variante;
  }

  caja.append(visor);
  caja.append(el("div", { class: "miniaturas" }, D.capturas.map((cap, i) => el("div", { class: "miniatura" + (i === captura ? " activa" : ""), onclick: () => { captura = i; guardar("captura", i); mostrar(); } },
    el("img", { src: cap.fuente, alt: "", loading: "lazy" }),
    el("div", {}, "T" + cap.tramo + " " + tiempo(cap.segundo) + " · mín " + num(Math.min(...nombres.map((n) => cap.ssim[n] ?? 1)), 4))))));
  caja.append(cajaAdoptar(adoptarVariante));
}

async function adoptar(variante, salidas) {
  if (!salidas.length) return alert("Marca al menos una salida.");
  if (!confirm("¿Adoptar los ajustes de \\"" + variante + "\\" en: " + salidas.join(", ") + "? Se modifica tu config de asu.")) return;
  try { await api("adoptar", { variante, salidas }); alert("Listo: \\"" + variante + "\\" adoptada en " + salidas.join(", ") + "."); }
  catch (e) { alert("No se pudo adoptar: " + e.message); }
}
let salidasMp4 = null;
function cajaAdoptar(nombre) {
  const caja = el("div", { class: "adoptar" });
  const v = D.variantes.find((x) => x.nombre === nombre);
  if (!v) { caja.append(el("span", { class: "tenue" }, "Fuente: el .avs sin codificar (referencia visual).")); return caja; }
  if (!v.adoptar) { caja.append(el("span", { class: "tenue" }, v.nombre + ": son los ajustes que ya usa la salida; no hay nada que adoptar.")); return caja; }
  if (SERVIDOR) {
    caja.append("Adoptar ", el("b", {}, v.nombre), " en:");
    const marcas = el("span");
    const pintarMarcas = (lista) => marcas.replaceChildren(...lista.map((s) => el("label", {}, el("input", { type: "checkbox", value: s, checked: s === D.salida.nombre ? true : null }), " " + s + " ")));
    if (salidasMp4) pintarMarcas(salidasMp4); else api("salidas").then((l) => { salidasMp4 = l; pintarMarcas(l); }).catch(() => pintarMarcas([D.salida.nombre]));
    caja.append(marcas, el("button", { onclick: () => adoptar(v.nombre, [...marcas.querySelectorAll("input:checked")].map((i) => i.value)) }, "Adoptar…"));
  } else {
    const boton = el("button", { onclick: () => copiar(v.adoptar, boton) }, "Copiar");
    caja.append("Adoptar " + v.nombre + ": ", el("code", {}, v.adoptar), boton);
  }
  return caja;
}

// ---------- Clips ----------
let clipTramo = 0, clipIzq = nombres[0], clipDer = nombres[1] || nombres[0];
function vistaClips() {
  const caja = document.getElementById("vista-clips");
  caja.replaceChildren();
  const ruta = (n) => D.variantes.find((v) => v.nombre === n).porTramo[clipTramo].clip;
  const selector = (valor, alCambiar) => el("select", { onchange: (e) => alCambiar(e.target.value) }, nombres.map((n) => el("option", { value: n, selected: n === valor ? true : null }, n)));
  const a = el("video", { src: ruta(clipIzq), controls: true, preload: "auto" });
  const b = el("video", { src: ruta(clipDer), muted: true, preload: "auto" });
  b.muted = true;
  const sincronizar = () => { if (Math.abs(b.currentTime - a.currentTime) > 0.05) b.currentTime = a.currentTime; b.playbackRate = a.playbackRate; };
  a.addEventListener("play", () => { sincronizar(); b.play(); });
  a.addEventListener("pause", () => { b.pause(); sincronizar(); });
  a.addEventListener("seeked", sincronizar);
  a.addEventListener("ratechange", sincronizar);
  const intervalo = setInterval(() => { if (!document.body.contains(a)) return clearInterval(intervalo); if (!a.paused) sincronizar(); }, 250);
  const abrirClip = (n) => SERVIDOR ? el("button", { onclick: () => api("abrir", { tipo: "archivo", ruta: ruta(n) }).catch((e) => alert(e.message)) }, "Abrir en reproductor") : null;
  caja.append(
    el("div", { class: "controles" },
      "Tramo: ", el("select", { onchange: (e) => { clipTramo = Number(e.target.value); mostrar(); } }, D.tramos.map((t, i) => el("option", { value: i, selected: i === clipTramo ? true : null }, t.indice + ") " + tiempo(t.inicio) + " " + MOTIVOS_TRAMO[t.motivo]))),
      " Izquierda: ", selector(clipIzq, (v) => { clipIzq = v; mostrar(); }), " Derecha: ", selector(clipDer, (v) => { clipDer = v; mostrar(); }),
      el("span", { class: "tenue" }, "Los controles del video izquierdo mueven ambos.")),
    el("div", { class: "videos" },
      el("div", {}, el("b", {}, clipIzq), " ", abrirClip(clipIzq), a),
      el("div", {}, el("b", {}, clipDer), " ", abrirClip(clipDer), b)),
  );
}

// ---------- Gráfico ----------
function vistaGrafico() {
  const caja = document.getElementById("vista-grafico");
  caja.replaceChildren();
  caja.append(el("div", { class: "leyenda" }, nombres.map((n, i) => el("span", { style: "--color:" + COLORES[i % COLORES.length] }, n))),
    el("div", { class: "tenue" }, "SSIM de cada frame contra el .avs. Las líneas verticales son las capturas (clic para verla)."));
  const NS = "http://www.w3.org/2000/svg";
  const svg = (etiqueta, atributos) => { const e = document.createElementNS(NS, etiqueta); for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v); return e; };
  D.tramos.forEach((t, ti) => {
    const series = D.variantes.map((v) => v.porTramo[ti].ssimPorFrame);
    const largo = Math.max(...series.map((s) => s.length), 1);
    const minimo = Math.max(0, Math.floor(Math.min(...series.flat()) * 200) / 200 - 0.005);
    const W = 1000, H = 220, M = 40;
    const x = (n) => M + (n / Math.max(1, largo - 1)) * (W - M - 10);
    const y = (v) => 10 + (1 - (v - minimo) / (1 - minimo || 1)) * (H - 30);
    const grafico = svg("svg", { viewBox: "0 0 " + W + " " + H, width: "100%" });
    for (const v of [minimo, (minimo + 1) / 2, 1]) {
      grafico.append(svg("line", { x1: M, x2: W - 10, y1: y(v), y2: y(v), stroke: "#333" }));
      const texto = svg("text", { x: 2, y: y(v) + 4 }); texto.textContent = v.toFixed(3); grafico.append(texto);
    }
    D.capturas.forEach((c) => {
      if (c.tramo !== t.indice) return;
      const linea = svg("line", { x1: x(c.frame), x2: x(c.frame), y1: 10, y2: H - 20, stroke: "#888", "stroke-dasharray": "4 3", style: "cursor:pointer" });
      linea.addEventListener("click", () => { captura = c.indice; pestana = "capturas"; mostrar(); });
      grafico.append(linea);
    });
    series.forEach((s, i) => grafico.append(svg("polyline", { points: s.map((v, n) => x(n).toFixed(1) + "," + y(v).toFixed(1)).join(" "), fill: "none", stroke: COLORES[i % COLORES.length], "stroke-width": 1.2 })));
    const pie = svg("text", { x: M, y: H - 4 }); pie.textContent = "Tramo " + t.indice + " · " + tiempo(t.inicio) + "-" + tiempo(t.inicio + t.duracion) + " · " + MOTIVOS_TRAMO[t.motivo] + " · " + largo + " frames"; grafico.append(pie);
    caja.append(grafico);
  });
}

// ---------- Teclado y arranque ----------
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const total = D.capturas.length;
  if (pestana === "ciegas") {
    if (/^[0-9]$/.test(e.key) && Number(e.key) <= nombres.length) { ciegaVersion = Number(e.key); mostrar(); }
    else if (e.key === "ArrowRight" && ciegaCaptura < total - 1) { ciegaCaptura++; ciegaVersion = 0; mostrar(); }
    else if (e.key === "ArrowLeft" && ciegaCaptura > 0) { ciegaCaptura--; ciegaVersion = 0; mostrar(); }
  } else if (pestana === "capturas") {
    if (/^[0-9]$/.test(e.key) && Number(e.key) <= nombres.length) { modoVista = "alternar"; version = Number(e.key); mostrar(); }
    else if (e.key === "ArrowRight") { captura = (captura + 1) % total; guardar("captura", captura); mostrar(); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { captura = (captura - 1 + total) % total; guardar("captura", captura); mostrar(); e.preventDefault(); }
  }
});
document.getElementById("abrir-carpeta").onclick = () => api("abrir", { tipo: "carpeta" }).catch((e) => alert(e.message));
document.getElementById("cerrar").onclick = async () => { if (confirm("¿Cerrar el servidor? La página quedará sin acciones.")) { await api("cerrar", {}).catch(() => {}); document.getElementById("modo").textContent = "servidor cerrado"; } };

(async () => {
  if (SERVIDOR) { try { D = await api("resultados"); } catch {} }
  if (ciegaCaptura >= D.capturas.length) ciegaCaptura = 0;
  if (captura >= D.capturas.length) captura = 0;
  dibujarTabla();
  mostrar();
})();
`;
