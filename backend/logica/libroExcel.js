'use strict';

/**
 * libroExcel.js — generador .xlsx COMPARTIDO de los reportes (R-4 de la
 * auditoría de reportes, documentacion/SIGSO-v2-reportes-auditoria.md §5 y §7):
 * reemplaza los CSV (sin formato, sin tipos, abiertos con acentos rotos) por un
 * libro real:
 *  - hoja "Resumen": los niveles 1–2 del reporte — título, filtros, la frase
 *    con el estado en color, los KPI, lo que requiere decisión y lo que va bien;
 *  - una hoja por tabla: encabezado con formato, filtros, primera fila fija,
 *    anchos ajustados, números/porcentajes/fechas como VALORES (se pueden
 *    sumar, ordenar y filtrar), estados con color y barras de datos dentro de
 *    las celdas de porcentaje.
 *
 * Entrada (lo que arma el frontend a partir de lo que se ve, o el servidor):
 *   { titulo, subtitulo, meta: [[etiqueta, valor]], resumen: { estado, frase,
 *     kpis: [{ etiqueta, valor, nota }], alertas: [{ severidad, cantidad,
 *     titulo, detalle, dueno }], bien: [texto] }, hojas: [{ nombre, columnas:
 *     [titulo], filas: [[celda]] }] }
 * Celda: texto, número, o { v, tono } (tono: ok|alerta|critico|info|neutro).
 * Los textos "42 %", "1.234,5", "31/12/2026" se convierten a número/fecha.
 *
 * Sin dependencias: el ZIP lo escribe xlsxZip.js (Node trae deflate y crc32).
 * Las celdas de texto van como inlineStr: nunca se interpretan como fórmula
 * (el CSV sí permitía inyectar "=…").
 */

const { construirZip_ } = require('./xlsxZip');

// --- Estilos ----------------------------------------------------------------------------------
// Índices de cellXfs (ver stylesXml_). Colores alineados con los tonos v2.
const S = {
  normal: 0, encabezado: 1, texto: 2, entero: 3, decimal: 4, pct0: 5, pct1: 6, fecha: 7,
  titulo: 8, metaEtq: 9, metaVal: 10, seccion: 11, kpi: 12, nota: 13, frase: 14,
  ok: 15, alerta: 16, critico: 17, info: 18, neutro: 19
};
const TONOS = { ok: S.ok, alerta: S.alerta, critico: S.critico, info: S.info, neutro: S.neutro, primario: S.info, hito: S.info };

function stylesXml_() {
  const fuente = (o) => '<font>' + (o.b ? '<b/>' : '') + (o.i ? '<i/>' : '') + '<sz val="' + (o.sz || 11) + '"/>' +
    (o.color ? '<color rgb="FF' + o.color + '"/>' : '') + '<name val="Calibri"/><family val="2"/></font>';
  const relleno = (c) => '<fill><patternFill patternType="solid"><fgColor rgb="FF' + c + '"/><bgColor indexed="64"/></patternFill></fill>';
  const fuentes = [
    {}, { b: 1, color: 'FFFFFF' }, { b: 1, sz: 16, color: '0F172A' }, { sz: 10, color: '64748B' }, { b: 1, sz: 10, color: '0F172A' },
    { b: 1, sz: 10, color: '475569' }, { b: 1, sz: 14, color: '0F172A' }, { i: 1, sz: 9, color: '64748B' },
    { b: 1, color: '166534' }, { b: 1, color: '92400E' }, { b: 1, color: '991B1B' }, { b: 1, color: '1E40AF' }, { b: 1, color: '475569' }, { sz: 11, color: '0F172A' }
  ];
  const rellenos = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    relleno('1E293B'), relleno('DCFCE7'), relleno('FEF3C7'), relleno('FEE2E2'), relleno('DBEAFE'), relleno('F1F5F9')];
  const bordes = '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>';
  const alin = (h, v, wrap) => '<alignment' + (h ? ' horizontal="' + h + '"' : '') + ' vertical="' + (v || 'top') + '"' + (wrap ? ' wrapText="1"' : '') + '/>';
  const xf = (o) => '<xf numFmtId="' + (o.num || 0) + '" fontId="' + (o.f || 0) + '" fillId="' + (o.fill || 0) + '" borderId="' + (o.b || 0) + '" xfId="0"' +
    (o.num ? ' applyNumberFormat="1"' : '') + (o.f ? ' applyFont="1"' : '') + (o.fill ? ' applyFill="1"' : '') + (o.b ? ' applyBorder="1"' : '') +
    ' applyAlignment="1">' + alin(o.h, o.v, o.wrap) + '</xf>';
  const xfs = [
    xf({}),                                                     // normal
    xf({ f: 1, fill: 2, b: 1, v: 'center', wrap: 1 }),           // encabezado
    xf({ wrap: 1 }),                                            // texto
    xf({ num: 3, h: 'right' }),                                 // entero
    xf({ num: 164, h: 'right' }),                               // decimal
    xf({ num: 9, h: 'right' }),                                 // pct0
    xf({ num: 165, h: 'right' }),                               // pct1
    xf({ num: 166, h: 'left' }),                                // fecha
    xf({ f: 2, v: 'center' }),                                  // titulo
    xf({ f: 3 }),                                               // metaEtq
    xf({ f: 4, wrap: 1 }),                                      // metaVal
    xf({ f: 5, b: 1, v: 'bottom' }),                            // seccion
    xf({ f: 6, h: 'left' }),                                    // kpi
    xf({ f: 7, wrap: 1 }),                                      // nota
    xf({ f: 13, wrap: 1 }),                                     // frase
    xf({ f: 8, fill: 3, wrap: 1 }), xf({ f: 9, fill: 4, wrap: 1 }), xf({ f: 10, fill: 5, wrap: 1 }),
    xf({ f: 11, fill: 6, wrap: 1 }), xf({ f: 12, fill: 7, wrap: 1 })
  ];
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.0"/><numFmt numFmtId="165" formatCode="0.0%"/>' +
    '<numFmt numFmtId="166" formatCode="dd/mm/yyyy"/></numFmts>' +
    '<fonts count="' + fuentes.length + '">' + fuentes.map(fuente).join('') + '</fonts>' +
    '<fills count="' + rellenos.length + '">' + rellenos.join('') + '</fills>' + bordes +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
    '</styleSheet>';
}

// --- Tipos: el texto de la pantalla se vuelve valor ---------------------------------------------
const MAX_TEXTO = 32000; // Excel admite 32.767 caracteres por celda.

function serialFecha_(y, m, d) {
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

/**
 * Convierte una celda a { v, t: 'n'|'s', s: estilo, clase }. clase agrupa por tipo
 * para decidir las barras de datos y el ancho: 'pct'|'num'|'fecha'|'texto'|'vacio'.
 */
function inferir(celda) {
  if (celda && typeof celda === 'object' && !Array.isArray(celda)) {
    const v = celda.v === undefined || celda.v === null ? '' : String(celda.v);
    if (celda.tono && TONOS[celda.tono] !== undefined) return { v: v.slice(0, MAX_TEXTO), t: 's', s: TONOS[celda.tono], clase: 'texto' };
    return inferir(celda.v);
  }
  if (typeof celda === 'number' && isFinite(celda)) return { v: celda, t: 'n', s: Number.isInteger(celda) ? S.entero : S.decimal, clase: 'num' };
  const s = String(celda === undefined || celda === null ? '' : celda).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s === '—' || s === '-' || s === '–') return { v: '', t: 's', s: S.texto, clase: 'vacio' };
  let m = s.match(/^(-|−)?(\d+(?:[.,]\d+)?)\s?%$/);
  if (m) {
    const n = Number(m[2].replace(',', '.')) / 100 * (m[1] ? -1 : 1);
    return { v: n, t: 'n', s: /[.,]/.test(m[2]) ? S.pct1 : S.pct0, clase: 'pct' };
  }
  // Número chileno: 1.234 · 1.234,5 · 12,5 · 42. Sin ceros a la izquierda (códigos como 0012).
  m = s.match(/^(-|−)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/);
  if (m && !(/^0\d/.test(m[2]))) {
    const n = Number(m[2].replace(/\./g, '') + (m[3] ? '.' + m[3] : '')) * (m[1] ? -1 : 1);
    return { v: n, t: 'n', s: m[3] ? S.decimal : S.entero, clase: 'num' };
  }
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?$/);
  if (m) {
    const [y, mo, d] = m[1].length === 4 ? [+m[1], +m[2], +m[3]] : [+m[3], +m[2], +m[1]];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { v: serialFecha_(y, mo, d), t: 'n', s: S.fecha, clase: 'fecha' };
  }
  return { v: s.slice(0, MAX_TEXTO), t: 's', s: S.texto, clase: 'texto' };
}

// --- XML ---------------------------------------------------------------------------------------
function esc_(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Caracteres de control prohibidos en XML (salvo tab, salto de línea y retorno).
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
function col_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function celdaXml_(ref, c) {
  if (!c) return '';
  if (c.v === '' || c.v === undefined || c.v === null) return '<c r="' + ref + '" s="' + c.s + '"/>';
  if (c.t === 'n') return '<c r="' + ref + '" s="' + c.s + '"><v>' + c.v + '</v></c>';
  return '<c r="' + ref + '" s="' + c.s + '" t="inlineStr"><is><t xml:space="preserve">' + esc_(c.v) + '</t></is></c>';
}

// hoja: { nombre, filas: [{ celdas: [{v,t,s}], ht }], anchos: [n], merges: [ref], congelarFilas,
//         filtro: ref, barras: [ref], horizontal }
function hojaXml_(h) {
  const filas = h.filas.map((f, i) => '<row r="' + (i + 1) + '"' + (f.ht ? ' ht="' + f.ht + '" customHeight="1"' : '') + '>' +
    (f.celdas || []).map((c, j) => celdaXml_(col_(j + 1) + (i + 1), c)).join('') + '</row>').join('');
  const vista = h.congelarFilas
    ? '<sheetViews><sheetView workbookViewId="0" zoomScale="100"><pane ySplit="' + h.congelarFilas + '" topLeftCell="A' + (h.congelarFilas + 1) +
      '" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A' + (h.congelarFilas + 1) + '" sqref="A' + (h.congelarFilas + 1) + '"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0" showGridLines="' + (h.sinGrilla ? '0' : '1') + '"/></sheetViews>';
  const cols = h.anchos && h.anchos.length
    ? '<cols>' + h.anchos.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' : '';
  const merges = h.merges && h.merges.length ? '<mergeCells count="' + h.merges.length + '">' + h.merges.map((m) => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>' : '';
  const barras = (h.barras || []).map((ref, i) =>
    '<conditionalFormatting sqref="' + ref + '"><cfRule type="dataBar" priority="' + (i + 1) + '"><dataBar>' +
    '<cfvo type="num" val="0"/><cfvo type="num" val="1"/><color rgb="FF60A5FA"/></dataBar></cfRule></conditionalFormatting>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' + vista + '<sheetFormatPr defaultRowHeight="15"/>' + cols +
    '<sheetData>' + filas + '</sheetData>' + (h.filtro ? '<autoFilter ref="' + h.filtro + '"/>' : '') + merges + barras +
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    '<pageSetup paperSize="9" orientation="' + (h.horizontal ? 'landscape' : 'portrait') + '" fitToWidth="1" fitToHeight="0"/></worksheet>';
}

// --- Hojas -------------------------------------------------------------------------------------
const ESTADO_TEXTO = { ok: 'En control', alerta: 'Requiere atención', critico: 'Crítico', neutro: 'Sin actividad' };

function hojaResumen_(o) {
  const filas = [], merges = [];
  const t = (v, s) => ({ v: v === undefined || v === null ? '' : String(v).slice(0, MAX_TEXTO), t: 's', s });
  const fila = (celdas, ht) => { filas.push({ celdas, ht }); return filas.length; };
  const lineas = (texto, porLinea) => Math.max(1, Math.ceil(String(texto || '').length / porLinea));

  const r1 = fila([t(o.titulo, S.titulo)], 26); merges.push('A' + r1 + ':F' + r1);
  if (o.subtitulo) { const r = fila([t(o.subtitulo, S.nota)]); merges.push('A' + r + ':F' + r); }
  (o.meta || []).forEach((m) => { const r = fila([t(m[0], S.metaEtq), t(m[1], S.metaVal)]); merges.push('B' + r + ':F' + r); });
  const res = o.resumen || {};
  if (res.frase || (res.kpis || []).length) {
    fila([]);
    const rs = fila([t('EN UNA LÍNEA', S.seccion)]); merges.push('A' + rs + ':F' + rs);
    const est = ESTADO_TEXTO[res.estado] ? res.estado : 'ok';
    const rf = fila([t(ESTADO_TEXTO[est], TONOS[est === 'neutro' ? 'neutro' : est]), t(res.frase, S.frase)], Math.min(409, 16 * lineas(res.frase, 95)));
    merges.push('B' + rf + ':F' + rf);
    if ((res.kpis || []).length) {
      fila([t('Indicador', S.encabezado), t('Valor', S.encabezado), t('Detalle', S.encabezado)]);
      res.kpis.forEach((k) => {
        const val = inferir(k.valor);
        const r = fila([t(k.etiqueta, S.texto), Object.assign(val, { s: val.t === 'n' ? val.s : S.kpi }), t(k.nota, S.nota)]);
        merges.push('C' + r + ':F' + r);
      });
    }
  }
  if (res.alertas) {
    fila([]);
    const rs = fila([t('LO QUE REQUIERE DECISIÓN', S.seccion)]); merges.push('A' + rs + ':F' + rs);
    if (!res.alertas.length) { const r = fila([t('Nada requiere una decisión en este corte.', S.nota)]); merges.push('A' + r + ':F' + r); }
    else {
      fila([t('Severidad', S.encabezado), t('Cantidad', S.encabezado), t('Qué', S.encabezado), t('Detalle', S.encabezado), t('Responsable', S.encabezado)]);
      res.alertas.forEach((a) => {
        const sev = a.severidad === 'critico' ? 'critico' : 'alerta';
        const cant = inferir(a.cantidad);
        fila([t(sev === 'critico' ? 'Crítico' : 'Atención', TONOS[sev]), cant.clase === 'vacio' ? t('', S.texto) : cant,
          t(a.titulo, S.metaVal), t(a.detalle, S.texto), t(a.dueno, S.texto)], Math.min(409, 15 * lineas(a.detalle, 60)));
      });
    }
  }
  if ((res.bien || []).length) {
    fila([]);
    const rs = fila([t('LO QUE VA BIEN', S.seccion)]); merges.push('A' + rs + ':F' + rs);
    res.bien.forEach((b) => { const r = fila([t(b, S.texto)]); merges.push('A' + r + ':F' + r); });
  }
  return { nombre: 'Resumen', filas, merges, anchos: [20, 13, 34, 58, 24, 8], sinGrilla: true };
}

function hojaDatos_(h) {
  const columnas = (h.columnas || []).map((c) => String(c == null ? '' : c));
  const filas = (h.filas || []).map((f) => (f || []).map(inferir));
  const n = Math.max(columnas.length, filas.reduce((m, f) => Math.max(m, f.length), 0));
  if (!n) return null;
  const clases = [];
  for (let j = 0; j < n; j++) {
    const cs = filas.map((f) => (f[j] ? f[j].clase : 'vacio')).filter((c) => c !== 'vacio');
    clases.push(cs.length && cs.every((c) => c === cs[0]) ? cs[0] : 'mixta');
  }
  // Ancho: el contenido más largo, acotado (el texto largo se ajusta en la celda).
  const anchos = [];
  for (let j = 0; j < n; j++) {
    const largo = Math.max(String(columnas[j] || '').length, ...filas.map((f) => {
      const c = f[j];
      if (!c || c.v === '') return 0;
      if (c.clase === 'fecha') return 10;
      if (c.t === 'n') return String(Math.round(Number(c.v) * 100) / 100).length + 3;
      return String(c.v).length;
    }));
    anchos.push(Math.max(8, Math.min(60, largo + 2)));
  }
  const ultima = col_(n);
  const encabezado = { celdas: columnas.concat(Array(Math.max(0, n - columnas.length)).fill('')).map((c) => ({ v: c, t: 's', s: S.encabezado })), ht: 20 };
  const cuerpo = filas.map((f) => ({ celdas: f }));
  const total = cuerpo.length + 1;
  const barras = [];
  clases.forEach((c, j) => { if (c === 'pct' && cuerpo.length) barras.push(col_(j + 1) + '2:' + col_(j + 1) + total); });
  return {
    nombre: h.nombre, filas: [encabezado].concat(cuerpo), anchos, congelarFilas: 1,
    filtro: cuerpo.length ? 'A1:' + ultima + total : null, barras, horizontal: n > 6
  };
}

// Nombre de hoja válido (≤ 31, sin []:*?/\) y único dentro del libro.
function nombresHoja_(hojas) {
  const usados = {};
  hojas.forEach((h, i) => {
    let base = String(h.nombre || ('Datos ' + (i + 1))).replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31).trim() || 'Datos ' + (i + 1);
    if (base.toLowerCase() === 'resumen' && i > 0) base = 'Resumen (datos)';
    let nombre = base, k = 2;
    while (usados[nombre.toLowerCase()]) { const suf = ' (' + k++ + ')'; nombre = base.slice(0, 31 - suf.length) + suf; }
    usados[nombre.toLowerCase()] = true;
    h.nombre = nombre;
  });
  return hojas;
}

function libroXml_(hojas) {
  const n = hojas.length;
  const tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    hojas.map((h, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
    '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
  // El filtro de cada hoja necesita su nombre definido oculto para que Excel lo reconozca como tal.
  const nombresDef = hojas.map((h, i) => h.filtro
    ? '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + esc_(h.nombre).replace(/'/g, "''") + '\'!$' + h.filtro.replace(/([A-Z]+)(\d+)/g, '$1$$$2').replace(':', ':$') + '</definedName>'
    : '').join('');
  const libro = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
    hojas.map((h, i) => '<sheet name="' + esc_(h.nombre) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>' +
    (nombresDef ? '<definedNames>' + nombresDef + '</definedNames>' : '') + '</workbook>';
  const libroRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    hojas.map((h, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
    '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const ahora = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + esc_(hojas.titulo || '') + '</dc:title><dc:creator>SIGSO</dc:creator>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + ahora + '</dcterms:created></cp:coreProperties>';
  return [
    { nombre: '[Content_Types].xml', contenido: tipos }, { nombre: '_rels/.rels', contenido: rels },
    { nombre: 'docProps/core.xml', contenido: core },
    { nombre: 'xl/workbook.xml', contenido: libro }, { nombre: 'xl/_rels/workbook.xml.rels', contenido: libroRels },
    { nombre: 'xl/styles.xml', contenido: stylesXml_() }
  ].concat(hojas.map((h, i) => ({ nombre: 'xl/worksheets/sheet' + (i + 1) + '.xml', contenido: hojaXml_(h) })));
}

/** Arma el .xlsx a partir de la especificación del reporte. Devuelve un Buffer. */
function construirLibro(o) {
  o = o || {};
  const res = o.resumen || {};
  const conResumen = !!(o.titulo || res.frase || (res.kpis || []).length || res.alertas);
  const hojas = [];
  if (conResumen) hojas.push(hojaResumen_(o));
  (o.hojas || []).forEach((h) => { const d = hojaDatos_(h); if (d) hojas.push(d); });
  if (!hojas.length) hojas.push({ nombre: 'Datos', filas: [{ celdas: [{ v: 'Sin datos.', t: 's', s: S.nota }] }], anchos: [30] });
  nombresHoja_(hojas);
  hojas.titulo = o.titulo;
  return construirZip_(libroXml_(hojas));
}

module.exports = { construirLibro, inferir, S };
