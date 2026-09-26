'use strict';

/**
 * documentoV2.js — PDF de los documentos que NO tienen pantalla (Acta de
 * reunión, reporte de Proyecto, evidencia por cláusula…), con el MISMO diseño
 * v2 que los reportes en pantalla (R-3b de la auditoría de reportes).
 *
 * Cómo: se ejecutan en el servidor los mismos archivos del frontend que arman
 * los reportes (iconos.js, ui-v2.js, reportes-v2.js) dentro de un contexto
 * `vm` aislado — son funciones que devuelven HTML en texto, sin tocar el DOM
 * al cargar —, y el CSS se toma de las mismas hojas de la plataforma, en el
 * orden de plataforma.html, filtrado a las reglas cuyas clases aparecen en el
 * documento (con el mismo analizador de reportes-v2.js). No hay un segundo
 * sistema visual que mantener: cambiar una tarjeta en pantalla la cambia en
 * el papel.
 *
 * En el VPS esos archivos llegan a /opt/sigso/frontend/ (ver el despliegue);
 * la ruta relativa es la misma que en el repositorio. El PDF lo imprime
 * pdfChromium.js; si no hay Chromium, disponible() es false y quien llama
 * cae a su versión pdfkit.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Motor = require('./pdfChromium');
const ReportePdf = require('./reportePdf');

const RAIZ = path.join(__dirname, '..', '..', 'frontend');
const SCRIPTS = ['js/iconos.js', 'js/ui-v2.js', 'js/reportes-v2.js'];
const PAGINA = 'plataforma.html';

// Mismo formato que PYv2.fecha (frontend/js/proyectos-v2/nucleo.js).
function fecha_(valor, conAnio) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return dd + '/' + mm + (conAnio ? '/' + d.getUTCFullYear() : '');
}

let cache_ = null; // { firma, ctx, hojas }
function firma_() {
  return SCRIPTS.concat([PAGINA]).map((r) => { try { return fs.statSync(path.join(RAIZ, r)).mtimeMs; } catch (e) { return 0; } }).join('|');
}

function hojasEnOrden_() {
  const html = fs.readFileSync(path.join(RAIZ, PAGINA), 'utf8');
  const rutas = [];
  html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/i);
    if (m && !/^https?:/i.test(m[1])) rutas.push(m[1]);
    return tag;
  });
  return rutas.map((r) => {
    try { return fs.readFileSync(path.join(RAIZ, r.split('?')[0]), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); } catch (e) { return ''; }
  });
}

function cargar_() {
  const firma = firma_();
  if (cache_ && cache_.firma === firma) return cache_;
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  // Lo mínimo que las piezas consultan de la plataforma. Los nombres llegan ya
  // resueltos desde el servidor; persona() solo los devuelve.
  // Componentes.escaparHtml (components.js) usa textContent→innerHTML; aquí, lo
  // mismo más comillas (idéntico en texto, más seguro dentro de atributos).
  ctx.Componentes = {
    escaparHtml: (t) => String(t === undefined || t === null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/ /g, '&nbsp;')
  };
  ctx.PYv2 = {
    fecha: fecha_,
    persona: (email, nombre) => ({ email: email || '', nombre: nombre || email || '' }),
    miNombre: () => ''
  };
  SCRIPTS.forEach((r) => {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, r), 'utf8'), ctx, { filename: r, timeout: 2000 });
  });
  cache_ = { firma, ctx, hojas: hojasEnOrden_() };
  return cache_;
}

function disponible() {
  return Motor.disponible() && SCRIPTS.concat([PAGINA]).every((r) => fs.existsSync(path.join(RAIZ, r)));
}

/** { R: SigsoReportes, U: UIv2 } del frontend, para armar el cuerpo. */
function piezas() {
  const c = cargar_();
  return { R: c.ctx.SigsoReportes, U: c.ctx.UIv2 };
}

// Sin DOM, "toca al documento" = todas las clases que exige el selector están en
// el HTML generado. Lo que va dentro de :not()/:is()/:where()/:has() no exige
// nada; un selector con id (#gerencia-v2 …) es de la plataforma, no del papel.
function cssPara(html) {
  const c = cargar_();
  const R = c.ctx.SigsoReportes;
  const usadas = new Set(['sx2', 'rp2-pdf']);
  String(html).replace(/class="([^"]*)"/g, (m, cl) => { cl.split(/\s+/).forEach((x) => { if (x) usadas.add(x); }); return m; });
  const toca = (sel) => {
    let s = String(sel).replace(R._css.pseudo, '').trim();
    s = s.replace(/:(not|is|where|has)\((?:[^()]|\([^()]*\))*\)/g, '');
    if (/#[A-Za-z_-]/.test(s.replace(/\[[^\]]*\]/g, ''))) return false;
    const clases = (s.match(/\.[A-Za-z0-9_-]+/g) || []).map((x) => x.slice(1));
    return clases.every((x) => usadas.has(x));
  };
  return c.hojas.map((t) => R._css.filtrar(t, toca)).filter(Boolean).join('\n');
}

// En pantalla, las barras y los arcos parten en 0 y los anima ui-v2.js (animar()) con
// JavaScript; aquí no corre JS, así que se escriben directamente con su valor final.
function valoresFinales(html) {
  return String(html)
    .replace(/data-sx-pct="([\d.]+)"/g, 'data-sx-pct="$1" style="width:$1%"')
    .replace(/stroke-dashoffset="[^"]*"(\s+)data-sx-arco="([^"]*)"/g, 'stroke-dashoffset="$2"$1data-sx-arco="$2"');
}

/** Correo → nombre, de las cuentas del portal (para no imprimir correos). */
function nombresPorCorreo(db) {
  const mapa = {};
  try {
    const { leerFilas_ } = require('../db/sqliteRepo');
    const { COLUMNAS } = require('../db/schema');
    const { parsearListaPortal } = require('./portal');
    leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).forEach((c) => {
      const n = String(c.nombre || '').trim();
      if (n) parsearListaPortal(c.emails).forEach((e) => { mapa[String(e).trim().toLowerCase()] = n; });
    });
  } catch (e) { /* sin cuentas: quedan los correos */ }
  return mapa;
}

/**
 * Arma el documento completo y lo imprime.
 * o: { titulo, subtitulo, modulo, codigo, periodo, filtros, cuerpo (html),
 *      nombreArchivo, horizontal }. Devuelve { pdf_base64, filename }.
 */
async function aPdf(db, contexto, o) {
  const { R } = piezas();
  const generadoPor = ReportePdf.nombreCuenta_(db, contexto || {});
  const html = '<main class="rp2-documento">' +
    R.cabeceraDocumento({ titulo: o.titulo, subtitulo: o.subtitulo, modulo: o.modulo, codigo: o.codigo,
      periodo: o.periodo, generadoPor: generadoPor, filtros: o.filtros || [] }) +
    valoresFinales(o.cuerpo) + R.pieDocumento() + '</main>';
  const doc = ReportePdf.componerDocumento({ titulo: o.titulo, css: cssPara(html), html });
  const pie = ReportePdf.piePagina({ titulo: o.titulo, generadoPor: generadoPor || 'SIGSO', fecha: ReportePdf.fechaChile_(new Date()) });
  const buf = await Motor.htmlAPdf(doc, { pie, horizontal: !!o.horizontal });
  return { pdf_base64: buf.toString('base64'), filename: ReportePdf.nombreArchivo_(o.nombreArchivo || o.titulo) };
}

module.exports = { disponible, piezas, cssPara, aPdf, nombresPorCorreo, valoresFinales, fecha_, RAIZ };
