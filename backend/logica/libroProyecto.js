'use strict';

/**
 * libroProyecto.js — puerto de Proyectos.descargarLibro (Proyectos.gs) +
 * ExcelGantt.gs: exporta un proyecto a .xlsx con hasta 6 hojas -- Resumen,
 * Carta Gantt (barras de color sobre un calendario semanal -- acá, celdas
 * coloreadas de la hoja, no dibujo pixel a pixel), Tareas, Hitos, Historial
 * y Dependencias.
 *
 * Arma el OOXML a mano igual que el .gs (mismo criterio "dependencias
 * mínimas" que aws4fetch/pdfkit/scrypt en este proyecto): xlsxZip.js
 * reemplaza a Utilities.zip de Apps Script. A diferencia de la Carta Gantt
 * del PDF configurable (día×tarea sobre un lienzo de tamaño fijo, dejada
 * para su propio incremento -- ver reporteProyecto.js), acá la "grilla" ES
 * la hoja de cálculo: cada semana es una columna y cada barra es el relleno
 * de una celda, así que no hay coordenadas ni paginación que calcular a
 * mano -- se porta completo, sin recortar alcance.
 *
 * Fechas (auditoría 2026-09-29): se escriben como FECHA REAL de Excel
 * (número de serie con formato dd/mm/aaaa), así se pueden ordenar y filtrar.
 * El día se resuelve con Utils.claveDiaCampo_: un campo de fecha
 * (fecha_compromiso, fecha_objetivo, plan_inicio…) es una etiqueta de día y
 * se lee tal cual -- antes se llevaba la medianoche UTC a la hora de Chile y
 * el 03/09 salía 02/09. Solo un instante real (fecha_terminada, timestamp de
 * la bitácora) se lleva al día de calendario de America/Santiago.
 * Porcentajes: número con formato % (no texto "19.6%").
 */

const Proyectos = require('./proyectos');
const ReportePdf = require('./reportePdf');
const Utils = require('./utils');
const { construirZip_ } = require('./xlsxZip');

const TZ = 'America/Santiago';

// --- estilos: mismo orden que XLSX_EST en ExcelGantt.gs (ESTABLE: styles.xml
// los define en este orden exacto) ------------------------------------------
const XLSX_EST = {
  NORMAL: 0,
  HEADER: 1,
  BOLD: 2,
  TENUE: 3,
  BARRA: {
    'al-dia': 4, terminada: 4, 'terminada ': 4,
    riesgo: 5,
    atrasada: 6,
    bloqueada: 7,
    revision: 8,
    pendiente: 9
  },
  BARRA_ATRASO: 10,
  HITO_MARCA: 11,
  FECHA: 12,
  PORCENTAJE: 13,
  // Carta Gantt (auditoría 2026-09-29, etapa 2): los MISMOS tonos que la
  // pantalla (tokens de css/tokens.css). Por tono, relleno lleno = parte hecha
  // de la barra y relleno suave = lo que falta, como el relleno de la pantalla.
  TONO: {
    ok: [14, 15], info: [16, 17], alerta: [18, 19], critico: [20, 21],
    hito: [22, 23], primario: [24, 25], neutro: [26, 27]
  },
  RESUMEN: [28, 29],   // barra resumen del hito (hecho / falta)
  HOY: 30              // encabezado de la semana de hoy
};
// Mismo mapa que TONO_SEMAFORO del frontend (proyectos-v2/gantt-dibujo.js;
// un test vigila que coincidan).
const TONO_SEMAFORO_XLSX_ = {
  terminada: 'ok', 'al-dia': 'info', riesgo: 'alerta', atrasada: 'critico',
  bloqueada: 'hito', pendiente: 'neutro', revision: 'primario', cancelada: 'neutro'
};
const SITUACION_XLSX_ = {
  terminada: 'Terminada', 'al-dia': 'Al día', riesgo: 'En riesgo', atrasada: 'Atrasada',
  bloqueada: 'Bloqueada', pendiente: 'Pendiente', revision: 'En revisión', cancelada: 'Cancelada'
};
// [lleno, suave] por tono, en el orden de XLSX_EST.TONO.
const COLORES_TONO_XLSX_ = [
  ['FF1F7A55', 'FFDCF2E7'], ['FF2563EB', 'FFE3ECFD'], ['FFB45309', 'FFFCEDD8'], ['FFC2362B', 'FFFBE3E1'],
  ['FF6D28D9', 'FFEBE1FA'], ['FF2A5FD6', 'FFE7EEFC'], ['FF8A93A5', 'FFDDE2EA']
];

function stylesXmlXlsx_() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>' +
    '<fonts count="4">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><sz val="11"/><color rgb="FF6B7280"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="' + (12 + COLORES_TONO_XLSX_.length * 2 + 2) + '">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF14213D"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF16A34A"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFD97706"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFDC2626"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF7C3AED"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF64748B"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFB91C1C"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F4F9"/></patternFill></fill>' +
      // 12..25: tonos (lleno, suave) · 26/27: resumen del hito
      COLORES_TONO_XLSX_.map((c) => '<fill><patternFill patternType="solid"><fgColor rgb="' + c[0] + '"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="' + c[1] + '"/></patternFill></fill>').join('') +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF475569"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFCBD5E1"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="31">' +
      '<xf xfId="0" fontId="0" fillId="0" borderId="0"/>' +
      '<xf xfId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>' +
      '<xf xfId="0" fontId="2" fillId="10" borderId="0" applyFont="1" applyFill="1"/>' +
      '<xf xfId="0" fontId="3" fillId="0" borderId="0" applyFont="1"/>' +
      '<xf xfId="0" fontId="0" fillId="3" borderId="0" applyFill="1"/>' +
      '<xf xfId="0" fontId="0" fillId="4" borderId="0" applyFill="1"/>' +
      '<xf xfId="0" fontId="0" fillId="5" borderId="0" applyFill="1"/>' +
      '<xf xfId="0" fontId="0" fillId="6" borderId="0" applyFill="1"/>' +
      '<xf xfId="0" fontId="0" fillId="7" borderId="0" applyFill="1"/>' +
      '<xf xfId="0" fontId="0" fillId="8" borderId="0" applyFill="1"/>' +
      '<xf xfId="0" fontId="0" fillId="9" borderId="0" applyFill="1"/>' +
      '<xf xfId="0" fontId="2" fillId="0" borderId="0" applyFont="1"><alignment horizontal="center"/></xf>' +
      '<xf xfId="0" numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +
      '<xf xfId="0" numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +
      // 14..27: celdas de barra por tono · 28/29: resumen del hito · 30: "hoy"
      COLORES_TONO_XLSX_.map((c, k) => '<xf xfId="0" fontId="0" fillId="' + (12 + k * 2) + '" borderId="0" applyFill="1"/>' +
        '<xf xfId="0" fontId="0" fillId="' + (13 + k * 2) + '" borderId="0" applyFill="1"/>').join('') +
      '<xf xfId="0" fontId="0" fillId="26" borderId="0" applyFill="1"/>' +
      '<xf xfId="0" fontId="0" fillId="27" borderId="0" applyFill="1"/>' +
      '<xf xfId="0" fontId="1" fillId="22" borderId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
}

// --- primitivas OOXML -------------------------------------------------------
function escXmlXlsx_(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function colLetraXlsx_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function celdaXmlXlsx_(ref, cell) {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string' || typeof cell === 'number') cell = { v: cell };
  const s = (cell.s ? ' s="' + cell.s + '"' : '');
  const vacio = (cell.v === undefined || cell.v === null || cell.v === '');
  if (vacio) return '<c r="' + ref + '"' + s + '/>';
  const esNum = cell.t === 'n' || (cell.t !== 's' && typeof cell.v === 'number');
  if (esNum) return '<c r="' + ref + '"' + s + '><v>' + cell.v + '</v></c>';
  return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + escXmlXlsx_(cell.v) + '</t></is></c>';
}
function sheetXmlXlsx_(hoja) {
  const cols = (hoja.cols && hoja.cols.length)
    ? '<cols>' + hoja.cols.map((c) => '<col min="' + c.min + '" max="' + c.max + '" width="' + c.ancho + '" customWidth="1"/>').join('') + '</cols>'
    : '';
  const filasXml = (hoja.filas || []).map((fila, i) => {
    const r = i + 1;
    const celdas = (fila || []).map((cell, j) => celdaXmlXlsx_(colLetraXlsx_(j + 1) + r, cell)).join('');
    return '<row r="' + r + '">' + celdas + '</row>';
  }).join('');
  const merges = (hoja.merges && hoja.merges.length)
    ? '<mergeCells count="' + hoja.merges.length + '">' + hoja.merges.map((m) => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>'
    : '';
  let panes = '';
  if (hoja.congelar && (hoja.congelar.filas || hoja.congelar.cols)) {
    const xSplit = hoja.congelar.cols || 0, ySplit = hoja.congelar.filas || 0;
    const topLeft = colLetraXlsx_(xSplit + 1) + (ySplit + 1);
    panes = '<sheetViews><sheetView workbookViewId="0">' +
      '<pane xSplit="' + xSplit + '" ySplit="' + ySplit + '" topLeftCell="' + topLeft + '" activePane="bottomRight" state="frozen"/>' +
      '</sheetView></sheetViews>';
  }
  // Filtro de columnas en las hojas de datos, y la Carta Gantt lista para imprimir:
  // apaisada, ajustada al ancho de la hoja (auditoría E3/E4).
  const filtro = hoja.filtro ? '<autoFilter ref="' + hoja.filtro + '"/>' : '';
  const sheetPr = hoja.imprimir ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '';
  const impresion = hoja.imprimir
    ? '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    sheetPr + panes + cols + '<sheetData>' + filasXml + '</sheetData>' + filtro + merges + impresion + '</worksheet>';
}

function construirXlsx_(hojas) {
  const n = hojas.length;
  let contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
  for (let i = 0; i < n; i++) {
    contentTypes += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }
  contentTypes += '</Types>';

  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  let sheetsWb = '', relsWb = '';
  for (let j = 0; j < n; j++) {
    const rid = 'rId' + (j + 1);
    sheetsWb += '<sheet name="' + escXmlXlsx_(hojas[j].nombre.slice(0, 31)) + '" sheetId="' + (j + 1) + '" r:id="' + rid + '"/>';
    relsWb += '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (j + 1) + '.xml"/>';
  }
  const stylesRid = 'rId' + (n + 1);
  relsWb += '<Relationship Id="' + stylesRid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

  // Nombres definidos: rango del filtro (Excel lo espera) y títulos que se
  // repiten al imprimir (la fila de semanas y las columnas de la tarea).
  const nombres = [];
  hojas.forEach((h, k) => {
    const ref = "'" + escXmlXlsx_(h.nombre.slice(0, 31)).replace(/'/g, "''") + "'!";
    if (h.filtro) nombres.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + k + '" hidden="1">' + ref + h.filtro.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2') + '</definedName>');
    if (h.titulos) nombres.push('<definedName name="_xlnm.Print_Titles" localSheetId="' + k + '">' + ref + '$' + h.titulos.cols.replace(':', ':$') + ',' + ref + '$' + h.titulos.filas.replace(':', ':$') + '</definedName>');
  });
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheetsWb + '</sheets>' + (nombres.length ? '<definedNames>' + nombres.join('') + '</definedNames>' : '') + '</workbook>';
  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relsWb + '</Relationships>';

  const entradas = [
    { nombre: '[Content_Types].xml', contenido: contentTypes },
    { nombre: '_rels/.rels', contenido: rels },
    { nombre: 'xl/workbook.xml', contenido: workbook },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: workbookRels },
    { nombre: 'xl/styles.xml', contenido: stylesXmlXlsx_() }
  ];
  hojas.forEach((hoja, k) => entradas.push({ nombre: 'xl/worksheets/sheet' + (k + 1) + '.xml', contenido: sheetXmlXlsx_(hoja) }));
  return construirZip_(entradas);
}

// --- fechas ------------------------------------------------------------------
// Timestamp real (ISO con hora) -> día de calendario en Santiago, como clave
// AAAA-MM-DD (via Utils.claveDia_, mismo criterio que el resto del backend).
function claveDeFecha_(valor) {
  if (!valor) return null;
  const f = new Date(valor);
  if (isNaN(f.getTime())) return null;
  return Utils.claveDia_(f, TZ);
}
// dd/mm/aaaa como TEXTO (solo para frases, ej. el período del Resumen).
function fechaTextoXlsx_(valor) {
  const c = Utils.claveDiaCampo_(valor, TZ);
  return c ? c.slice(8, 10) + '/' + c.slice(5, 7) + '/' + c.slice(0, 4) : '';
}
// Celda de FECHA real de Excel: número de serie (días desde 1899-12-30) con
// formato dd/mm/aaaa. Vacía si no hay fecha.
function fechaXlsx_(valor) {
  const c = Utils.claveDiaCampo_(valor, TZ);
  if (!c) return '';
  const serie = (Date.UTC(+c.slice(0, 4), +c.slice(5, 7) - 1, +c.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
  return { v: serie, t: 'n', s: XLSX_EST.FECHA };
}
// Porcentaje 0-100 -> celda numérica con formato 0,0 %.
function porcentajeXlsx_(pct) {
  if (pct === null || pct === undefined || pct === '' || isNaN(Number(pct))) return '';
  return { v: Math.round(Number(pct) * 10) / 1000, t: 'n', s: XLSX_EST.PORCENTAJE };
}
function sumarDiasClave_(clave, n) {
  const partes = clave.split('-').map(Number);
  return new Date(Date.UTC(partes[0], partes[1] - 1, partes[2] + n)).toISOString().slice(0, 10);
}
function lunesDeClave_(clave) {
  const dow = Utils.diaSemanaClave_(clave); // 0=domingo..6=sabado
  return sumarDiasClave_(clave, dow === 0 ? -6 : -(dow - 1));
}
// Semanas lunes->domingo (como claves) que cubren [claveMin..claveMax], con tope.
function semanasXlsx_(claveMin, claveMax, tope) {
  const semanas = [];
  let cursor = lunesDeClave_(claveMin);
  while (cursor <= claveMax && semanas.length < (tope || 40)) {
    const finClave = sumarDiasClave_(cursor, 6);
    semanas.push({ inicioClave: cursor, finClave, etiqueta: cursor.slice(8, 10) + '/' + cursor.slice(5, 7) });
    cursor = sumarDiasClave_(cursor, 7);
  }
  return semanas;
}
function inicioBarraClave_(a, proyIniClave, plan) {
  // El inicio de plan que calcula obtenerRendimiento (propio, por dependencia
  // o por creación): el MISMO que dibuja la Carta Gantt de la pantalla.
  if (plan && plan.plan_inicio) return Utils.claveDiaCampo_(plan.plan_inicio, TZ);
  const cre = claveDeFecha_(a.fecha_creacion);
  const com = Utils.claveDiaCampo_(a.fecha_compromiso, TZ) || null;
  if (cre !== null && com !== null) {
    if (cre <= com) return cre;
    if (proyIniClave !== null && proyIniClave <= com) return proyIniClave;
    return com;
  }
  return cre !== null ? cre : (proyIniClave !== null ? proyIniClave : com);
}

// --- armado del libro del proyecto ------------------------------------------
const XLSX_ESTADO_TAREA_ = {
  NO_INICIADA: 'Sin empezar', EN_CURSO: 'En curso', BLOQUEADA: 'Bloqueada',
  EN_REVISION: 'En revisión', TERMINADA: 'Terminada', CANCELADA: 'Cancelada'
};
const XLSX_ESTADO_HITO_ = { PENDIENTE: 'Pendiente', EN_CURSO: 'En curso', COMPLETADO: 'Completado', CANCELADO: 'Cancelado' };

function xlsxGanttProyecto_(detalle, tareas, rendimiento, bitacora, nombres) {
  nombres = nombres || {};
  // Nombre de la persona, nunca el correo crudo (auditoría E6).
  const persona = (email, nombre) => (nombre && !/@/.test(nombre) ? String(nombre).trim() : '') || nombres[String(email || '').toLowerCase()] || email || '';
  tareas = tareas.map((a) => Object.assign({}, a, { responsable_nombre: persona(a.responsable_email, a.responsable_nombre) }));
  const p = detalle.proyecto;
  const hitos = (detalle.hitos || []).filter((h) => h.fecha_objetivo)
    .slice().sort((a, b) => new Date(a.fecha_objetivo) - new Date(b.fecha_objetivo));
  const tareasPorId = {}; tareas.forEach((t) => { tareasPorId[t.actividad_id] = t; });
  const planPorId = {}; ((rendimiento && rendimiento.plan_seguimiento) || []).forEach((t) => { planPorId[t.actividad_id] = t; });

  const hojas = [
    hojaResumenXlsx_(detalle, tareas, hitos),
    hojaCartaGanttXlsx_(p, tareas, hitos, planPorId),
    hojaTareasXlsx_(tareas, hitos, planPorId),
    hojaHitosXlsx_(hitos, tareas)
  ];
  if (bitacora && bitacora.length) hojas.push(hojaHistorialXlsx_(bitacora, tareasPorId, persona));
  if (tareas.some((t) => t.depende_de)) hojas.push(hojaDependenciasXlsx_(tareas, tareasPorId));
  // Refactor "Planificación" Etapa 8 (§28/§30 del encargo): dos hojas
  // nuevas, AL FINAL a propósito -- así las hojas de siempre (Resumen/Carta
  // Gantt/Tareas/Hitos/Historial/Dependencias) conservan el mismo índice de
  // archivo que ya usan los tests existentes (sheet5.xml/sheet6.xml), en vez
  // de correrse por insertar en el medio. Mismos números que ya calcula
  // obtenerRendimiento (planPorId, Etapa 2) -- nunca una fórmula aparte.
  hojas.push(hojaControlPlazosXlsx_(tareas, planPorId));
  hojas.push(hojaResponsablesXlsx_(tareas));

  return construirXlsx_(hojas);
}

function hojaResumenXlsx_(detalle, tareas, hitos) {
  const p = detalle.proyecto;
  const total = tareas.length;
  const completadas = tareas.filter((t) => t.estado === 'TERMINADA').length;
  const enCurso = tareas.filter((t) => t.estado === 'EN_CURSO' || t.estado === 'EN_REVISION' || t.estado === 'BLOQUEADA').length;
  const pendientes = tareas.filter((t) => t.estado === 'NO_INICIADA').length;
  const atrasadas = tareas.filter((t) => t.semaforo === 'atrasada').length;
  const B = XLSX_EST.BOLD, T = XLSX_EST.TENUE;
  const par = (l, v) => [{ v: l, s: T }, v];
  return {
    nombre: 'Resumen',
    cols: [{ min: 1, max: 1, ancho: 26 }, { min: 2, max: 2, ancho: 40 }],
    filas: [
      [{ v: 'LIBRO DEL PROYECTO', s: B }],
      [{ v: p.nombre || '', s: B }],
      [],
      par('Código', p.codigo || '-'),
      par('Período', fechaTextoXlsx_(p.fecha_inicio) + ' - ' + fechaTextoXlsx_(p.fecha_objetivo)),
      par('Salud', (detalle.salud_etiqueta || detalle.salud || '') + ''),
      par('Avance general', (detalle.avance_pct === null || detalle.avance_pct === undefined) ? '-' : porcentajeXlsx_(detalle.avance_pct)),
      [],
      [{ v: 'Hitos', s: T }, { v: hitos.length, t: 'n' }],
      [{ v: 'Tareas', s: T }, { v: total, t: 'n' }],
      [{ v: 'Completadas', s: T }, { v: completadas, t: 'n' }],
      [{ v: 'En curso', s: T }, { v: enCurso, t: 'n' }],
      [{ v: 'Pendientes', s: T }, { v: pendientes, t: 'n' }],
      [{ v: 'Atrasadas', s: T }, { v: atrasadas, t: 'n' }]
    ]
  };
}

// Carta Gantt del Excel (auditoría 2026-09-29, etapa 2): las MISMAS reglas que la
// pantalla y el PDF -- inicio de barra = plan_inicio (propio, por dependencia o
// por creación), color = semáforo de la tarea con los tonos de la plataforma,
// la parte hecha de la barra en tono lleno y lo que falta en tono suave, barra
// resumen por hito, semana de hoy marcada y leyenda al pie. La columna
// "Situación" dice lo mismo que el color (antes "Sin empezar" pintada de rojo).
function hojaCartaGanttXlsx_(p, tareas, hitos, planPorId) {
  planPorId = planPorId || {};
  const H = XLSX_EST.HEADER, HITOEST = XLSX_EST.BOLD, MARCA = XLSX_EST.HITO_MARCA;
  const FIJAS = 7;
  const tareasConFecha = tareas.filter((t) => t.fecha_compromiso && t.estado !== 'CANCELADA');
  const ahoraClave = Utils.claveDia_(new Date(), TZ);
  const proyIniClave = p.fecha_inicio ? (Utils.claveDiaCampo_(p.fecha_inicio, TZ) || null) : null;
  const claves = [ahoraClave];
  if (proyIniClave) claves.push(proyIniClave);
  const proyFinClave = p.fecha_objetivo ? (Utils.claveDiaCampo_(p.fecha_objetivo, TZ) || null) : null;
  if (proyFinClave) claves.push(proyFinClave);
  hitos.forEach((h) => { const c = Utils.claveDiaCampo_(h.fecha_objetivo, TZ); if (c) claves.push(c); });
  tareasConFecha.forEach((a) => {
    claves.push(inicioBarraClave_(a, proyIniClave, planPorId[a.actividad_id]));
    const c = Utils.claveDiaCampo_(a.fecha_compromiso, TZ);
    if (c) claves.push(c);
  });
  const claveMin = claves.reduce((m, c) => (m === null || c < m) ? c : m, null);
  const claveMax = claves.reduce((m, c) => (m === null || c > m) ? c : m, null);
  const semanas = semanasXlsx_(claveMin, claveMax, 60);
  const esHoy = (s) => s.inicioClave <= ahoraClave && s.finClave >= ahoraClave;

  const encabezado = [{ v: 'Hito', s: H }, { v: 'Tarea', s: H }, { v: 'Responsable', s: H },
    { v: 'Situación', s: H }, { v: 'Avance', s: H }, { v: 'Inicio', s: H }, { v: 'Fin', s: H }];
  semanas.forEach((s) => encabezado.push({ v: s.etiqueta, s: esHoy(s) ? XLSX_EST.HOY : H }));

  const avanceDe = (a) => {
    const pl = planPorId[a.actividad_id];
    if (pl && pl.avance_real_pct !== null && pl.avance_real_pct !== undefined) return Number(pl.avance_real_pct);
    return a.estado === 'TERMINADA' ? 100 : (Number(a.avance_pct) || 0);
  };
  // Celdas de una barra [ini..fin]: las primeras en lleno según el avance.
  function celdasBarra_(ini, fin, avance, estilos, atrasoHasta) {
    const enBarra = semanas.map((s) => s.finClave >= ini && s.inicioClave <= fin);
    const total = enBarra.filter(Boolean).length;
    const hechas = Math.round(total * Math.max(0, Math.min(100, avance)) / 100);
    let k = 0;
    return semanas.map((s, i) => {
      if (enBarra[i]) { k++; return { s: k <= hechas ? estilos[0] : estilos[1] }; }
      if (atrasoHasta && s.inicioClave > fin && s.inicioClave <= atrasoHasta) return { s: XLSX_EST.BARRA_ATRASO };
      return null;
    });
  }
  function filaTarea_(a) {
    const ini = inicioBarraClave_(a, proyIniClave, planPorId[a.actividad_id]);
    const fin = Utils.claveDiaCampo_(a.fecha_compromiso, TZ);
    const terminal = a.estado === 'TERMINADA' || a.estado === 'CANCELADA';
    const tono = TONO_SEMAFORO_XLSX_[a.semaforo] || 'neutro';
    const avance = avanceDe(a);
    return [
      '',
      a.titulo || '',
      a.responsable_nombre || a.responsable_email || '',
      { v: SITUACION_XLSX_[a.semaforo] || XLSX_ESTADO_TAREA_[a.estado] || a.estado || '', s: XLSX_EST.TONO[tono][1] },
      porcentajeXlsx_(avance),
      fechaXlsx_(ini),
      fechaXlsx_(a.fecha_compromiso)
    ].concat(celdasBarra_(ini, fin, avance, XLSX_EST.TONO[tono], terminal ? null : ahoraClave));
  }

  const porHito = {}, sinHito = [];
  tareasConFecha.forEach((a) => {
    if (a.hito_id && hitos.some((h) => h.hito_id === a.hito_id)) (porHito[a.hito_id] = porHito[a.hito_id] || []).push(a);
    else sinHito.push(a);
  });
  const porInicio = (a, b) => {
    const x = inicioBarraClave_(a, proyIniClave, planPorId[a.actividad_id]), y = inicioBarraClave_(b, proyIniClave, planPorId[b.actividad_id]);
    return String(x).localeCompare(String(y)) || Utils.claveDiaCampo_(a.fecha_compromiso, TZ).localeCompare(Utils.claveDiaCampo_(b.fecha_compromiso, TZ));
  };
  // Barra resumen del grupo: de la primera a la última tarea, avance ponderado
  // por tamaño (S/M/L/XL), igual que la pantalla.
  function filaGrupo_(nombre, estado, objClave, suyas) {
    const fila = [{ v: nombre, s: HITOEST }, '', '', { v: estado, s: HITOEST }];
    let celdas = semanas.map(() => null);
    let avanceGrupo = '';
    if (suyas.length) {
      const peso = { S: 1, M: 2, L: 3, XL: 5 };
      let tot = 0, hecho = 0;
      suyas.forEach((a) => { const w = peso[a.tamano] || 2; tot += w; hecho += w * avanceDe(a) / 100; });
      const av = tot ? Math.round(hecho / tot * 100) : 0;
      avanceGrupo = porcentajeXlsx_(av);
      const ini = suyas.map((a) => inicioBarraClave_(a, proyIniClave, planPorId[a.actividad_id])).sort()[0];
      const fin = suyas.map((a) => Utils.claveDiaCampo_(a.fecha_compromiso, TZ)).sort().slice(-1)[0];
      celdas = celdasBarra_(ini, fin, av, XLSX_EST.RESUMEN, null);
    }
    if (objClave) semanas.forEach((s, i) => { if (objClave >= s.inicioClave && objClave <= s.finClave) celdas[i] = { v: '◆', s: MARCA }; });
    return fila.concat([avanceGrupo, '', fechaXlsx_(objClave)]).concat(celdas);
  }

  const filas = [encabezado];
  hitos.forEach((h) => {
    const suyas = (porHito[h.hito_id] || []).sort(porInicio);
    filas.push(filaGrupo_(h.nombre, XLSX_ESTADO_HITO_[h.estado] || h.estado, Utils.claveDiaCampo_(h.fecha_objetivo, TZ), suyas));
    suyas.forEach((a) => filas.push(filaTarea_(a)));
  });
  if (sinHito.length) {
    filas.push(filaGrupo_('Sin hito', '', null, sinHito.sort(porInicio)));
    sinHito.forEach((a) => filas.push(filaTarea_(a)));
  }

  // Leyenda al pie: el color va en la primera columna de semanas y el texto al lado.
  const vacias = () => Array(FIJAS).fill('');
  filas.push([]);
  filas.push([{ v: 'Leyenda', s: HITOEST }]);
  [['info', 'En curso'], ['ok', 'Terminada'], ['alerta', 'En riesgo'], ['critico', 'Atrasada'], ['hito', 'Bloqueada'], ['primario', 'En revisión'], ['neutro', 'Pendiente']]
    .forEach((x) => filas.push(vacias().concat([{ s: XLSX_EST.TONO[x[0]][0] }, { s: XLSX_EST.TONO[x[0]][1] }, x[1] + ' (lleno = avance, suave = lo que falta)'])));
  filas.push(vacias().concat([{ s: XLSX_EST.RESUMEN[0] }, { s: XLSX_EST.RESUMEN[1] }, 'Resumen del hito']));
  filas.push(vacias().concat([{ v: '◆', s: MARCA }, '', 'Fecha objetivo del hito']));
  filas.push(vacias().concat([{ s: XLSX_EST.BARRA_ATRASO }, '', 'Semanas de atraso (vencida y sin terminar)']));
  filas.push(vacias().concat([{ v: 'Hoy', s: XLSX_EST.HOY }, '', 'Semana de hoy']));

  const cols = [{ min: 1, max: 1, ancho: 24 }, { min: 2, max: 2, ancho: 36 }, { min: 3, max: 3, ancho: 22 },
    { min: 4, max: 4, ancho: 12 }, { min: 5, max: 5, ancho: 8 }, { min: 6, max: 7, ancho: 11 }];
  if (semanas.length) cols.push({ min: FIJAS + 1, max: FIJAS + semanas.length, ancho: 4.5 });
  return {
    nombre: 'Carta Gantt', cols, filas, congelar: { filas: 1, cols: FIJAS },
    imprimir: true, titulos: { filas: '1:1', cols: 'A:' + colLetraXlsx_(FIJAS) }
  };
}

// Auditoría 2026-09-29 (E5): sin el ID interno (UUID) al comienzo, una sola
// columna de avance (el real, el mismo de la pantalla) junto a lo esperado, y la
// Situación con el mismo texto y color que la Carta Gantt.
function hojaTareasXlsx_(tareas, hitos, planPorId) {
  const H = XLSX_EST.HEADER;
  const hitoNombre = {}; hitos.forEach((h) => { hitoNombre[h.hito_id] = h.nombre; });
  const enc = ['Hito', 'Tarea', 'Responsable', 'Situación', 'Inicio plan', 'Fin plan', 'Avance', 'Esperado a hoy', 'Desviación (pp)']
    .map((t) => ({ v: t, s: H }));
  const filas = [enc];
  tareas.forEach((a) => {
    const plan = planPorId[a.actividad_id] || {};
    const tono = TONO_SEMAFORO_XLSX_[a.semaforo] || 'neutro';
    const real = (plan.avance_real_pct !== null && plan.avance_real_pct !== undefined) ? plan.avance_real_pct
      : (a.estado === 'TERMINADA' ? 100 : a.avance_pct);
    filas.push([
      a.hito_id ? (hitoNombre[a.hito_id] || '') : '',
      a.titulo || '',
      a.responsable_nombre || a.responsable_email || '',
      { v: SITUACION_XLSX_[a.semaforo] || XLSX_ESTADO_TAREA_[a.estado] || a.estado || '', s: XLSX_EST.TONO[tono][1] },
      fechaXlsx_(plan.plan_inicio || a.fecha_creacion),
      fechaXlsx_(plan.plan_fin || a.fecha_compromiso),
      porcentajeXlsx_(real),
      porcentajeXlsx_(plan.avance_esperado_pct),
      (plan.desviacion_pp === null || plan.desviacion_pp === undefined) ? '' : { v: plan.desviacion_pp, t: 'n' }
    ]);
  });
  return {
    nombre: 'Tareas',
    cols: [{ min: 1, max: 1, ancho: 24 }, { min: 2, max: 2, ancho: 40 }, { min: 3, max: 3, ancho: 26 },
      { min: 4, max: 4, ancho: 13 }, { min: 5, max: 6, ancho: 12 }, { min: 7, max: 9, ancho: 13 }],
    filas, congelar: { filas: 1 }, filtro: 'A1:I' + filas.length
  };
}

// Refactor "Planificación" Etapa 8 (§28 del encargo): plan vs real por
// tarea, con la columna Estado coloreada -- mismos fills que ya usa la
// Carta Gantt para el semáforo (BARRA.atrasada/riesgo/al-dia), reusados tal
// cual en vez de definir estilos nuevos. Sin fórmulas condicionales nativas
// de Excel (este motor no las escribe): el color se decide en Node al
// armar la fila, igual criterio que las barras de la Carta Gantt de más
// arriba ("celdas coloreadas de la hoja, no dibujo pixel a pixel").
const ESTADO_PLAZO_ESTILO_XLSX_ = {
  ATRASADA: XLSX_EST.BARRA.atrasada, EN_RIESGO: XLSX_EST.BARRA.riesgo, EN_PLAZO: XLSX_EST.BARRA['al-dia']
};
const ESTADO_PLAZO_LABEL_XLSX_ = {
  ATRASADA: 'Atrasada', EN_RIESGO: 'En riesgo', EN_PLAZO: 'En plazo', COMPLETADA: 'Completada', SIN_FECHA: 'Sin fecha'
};
function hojaControlPlazosXlsx_(tareas, planPorId) {
  const H = XLSX_EST.HEADER;
  const enc = ['Tarea', 'Responsable', 'Inicio plan', 'Fin plan', 'Inicio real', 'Fin real',
    'Duración plan (d)', 'Duración real (d)', 'Desviación (d)', 'Estado'].map((t) => ({ v: t, s: H }));
  const filas = [enc];
  tareas.forEach((a) => {
    const plan = planPorId[a.actividad_id] || {};
    const duracionPlan = Proyectos.calcularDuracionDias_(plan.plan_inicio, plan.plan_fin);
    const duracionReal = Proyectos.calcularDuracionDias_(plan.fecha_inicio_real, plan.fecha_fin_real);
    const estilo = ESTADO_PLAZO_ESTILO_XLSX_[plan.estado_plazo];
    filas.push([
      a.titulo || '',
      a.responsable_nombre || a.responsable_email || '',
      fechaXlsx_(plan.plan_inicio),
      fechaXlsx_(plan.plan_fin),
      plan.fecha_inicio_real ? fechaXlsx_(plan.fecha_inicio_real) : 'No registrado',
      plan.fecha_fin_real ? fechaXlsx_(plan.fecha_fin_real) : 'No registrado',
      duracionPlan === null ? '' : { v: duracionPlan, t: 'n' },
      duracionReal === null ? '' : { v: duracionReal, t: 'n' },
      (plan.desviacion_dias === null || plan.desviacion_dias === undefined) ? '' : { v: plan.desviacion_dias, t: 'n' },
      { v: ESTADO_PLAZO_LABEL_XLSX_[plan.estado_plazo] || plan.estado_plazo || '', s: estilo }
    ]);
  });
  return {
    nombre: 'Control de Plazos',
    cols: [{ min: 1, max: 1, ancho: 34 }, { min: 2, max: 2, ancho: 22 }, { min: 3, max: 6, ancho: 13 },
      { min: 7, max: 9, ancho: 15 }, { min: 10, max: 10, ancho: 13 }],
    filas, congelar: { filas: 1 }, filtro: 'A1:J' + filas.length
  };
}

// Refactor "Planificación" Etapa 8 (§30 del encargo): carga por
// responsable -- mismo criterio de conteo que Actividades.semaforoActividad_
// (semaforo === 'atrasada') y que el estado de la tarea, ningún cálculo
// nuevo.
function hojaResponsablesXlsx_(tareas) {
  const H = XLSX_EST.HEADER;
  const porResponsable = {};
  tareas.forEach((a) => {
    const clave = a.responsable_email || '(sin asignar)';
    if (!porResponsable[clave]) {
      porResponsable[clave] = { nombre: a.responsable_nombre || a.responsable_email || 'Sin asignar', total: 0, completadas: 0, enCurso: 0, atrasadas: 0 };
    }
    const r = porResponsable[clave];
    r.total++;
    if (a.estado === 'TERMINADA') r.completadas++;
    else if (a.estado !== 'CANCELADA') r.enCurso++;
    if (a.semaforo === 'atrasada') r.atrasadas++;
  });
  const totalGeneral = tareas.length || 1;
  const enc = ['Responsable', 'Total tareas', 'Completadas', 'En curso', 'Atrasadas', 'Carga relativa'].map((t) => ({ v: t, s: H }));
  const filas = [enc];
  Object.keys(porResponsable)
    .sort((x, y) => porResponsable[y].total - porResponsable[x].total)
    .forEach((clave) => {
      const r = porResponsable[clave];
      filas.push([
        r.nombre,
        { v: r.total, t: 'n' }, { v: r.completadas, t: 'n' }, { v: r.enCurso, t: 'n' }, { v: r.atrasadas, t: 'n' },
        porcentajeXlsx_((r.total / totalGeneral) * 100)
      ]);
    });
  return {
    nombre: 'Responsables',
    cols: [{ min: 1, max: 1, ancho: 28 }, { min: 2, max: 6, ancho: 14 }],
    filas, congelar: { filas: 1 }, filtro: 'A1:F' + filas.length
  };
}

function hojaHitosXlsx_(hitos, tareas) {
  const H = XLSX_EST.HEADER;
  const enc = ['Hito', 'Fecha objetivo', 'Estado', 'Avance', 'Total tareas', 'Completadas'].map((t) => ({ v: t, s: H }));
  const filas = [enc];
  hitos.forEach((h) => {
    const suyas = tareas.filter((t) => t.hito_id === h.hito_id);
    const comp = suyas.filter((t) => t.estado === 'TERMINADA').length;
    filas.push([
      h.nombre || '',
      fechaXlsx_(h.fecha_objetivo),
      XLSX_ESTADO_HITO_[h.estado] || h.estado || '',
      (h.avance_pct === null || h.avance_pct === undefined) ? '' : { v: Math.round(h.avance_pct), t: 'n' },
      { v: suyas.length, t: 'n' },
      { v: comp, t: 'n' }
    ]);
  });
  return {
    nombre: 'Hitos',
    cols: [{ min: 1, max: 1, ancho: 30 }, { min: 2, max: 2, ancho: 15 }, { min: 3, max: 3, ancho: 14 }, { min: 4, max: 6, ancho: 13 }],
    filas, congelar: { filas: 1 }, filtro: 'A1:F' + filas.length
  };
}

// Auditoría 2026-09-29 (C5): el tipo en palabras (antes CREADA, CHECKIN_AVANCE,
// en_proceso) y quién lo registró. Mismas etiquetas que el PDF.
const BITACORA_TIPO_XLSX_ = {
  CREADA: 'Asignada', CHECKIN_AVANCE: 'Avance', CHECKIN_SIN_CAMBIO: 'Sin cambios',
  DESBLOQUEO: 'Se destrabó', BLOQUEO: 'Bloqueada', ENTREGA: 'Entregada', VALIDACION: 'Revisión',
  REGISTRO_DIA: 'Registro del día'
};
const ESTADO_DIA_XLSX_ = { en_proceso: 'en proceso', bloqueado: 'bloqueado', pausado: 'pausado', finalizado: 'finalizado',
  entregado: 'entregado', revision: 'en revisión', esperando_tercero: 'esperando a un tercero', listo: 'listo', sin_avance: 'sin avance' };
function hojaHistorialXlsx_(bitacora, tareasPorId, persona) {
  const H = XLSX_EST.HEADER;
  const enc = ['Fecha', 'Tarea', 'Qué pasó', 'Quién', 'Nota', 'Horas'].map((t) => ({ v: t, s: H }));
  const filas = [enc];
  bitacora.slice().sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .forEach((b) => {
      const tarea = tareasPorId[b.actividad_id];
      let que = BITACORA_TIPO_XLSX_[b.tipo] || b.tipo || '';
      if (b.tipo === 'REGISTRO_DIA' && b.estado_dia) que += ' (' + (ESTADO_DIA_XLSX_[b.estado_dia] || String(b.estado_dia).replace(/_/g, ' ')) + ')';
      filas.push([
        fechaXlsx_(b.dia || b.timestamp),
        tarea ? (tarea.titulo || '') : 'Tarea eliminada',
        que,
        persona ? persona(b.autor_email, b.autor_nombre) : (b.autor_nombre || b.autor_email || ''),
        b.nota || '',
        (b.horas === '' || b.horas === null || b.horas === undefined) ? '' : { v: Number(b.horas), t: 'n' }
      ]);
    });
  return {
    nombre: 'Historial',
    cols: [{ min: 1, max: 1, ancho: 12 }, { min: 2, max: 2, ancho: 36 }, { min: 3, max: 3, ancho: 22 }, { min: 4, max: 4, ancho: 24 },
      { min: 5, max: 5, ancho: 44 }, { min: 6, max: 6, ancho: 8 }],
    filas, congelar: { filas: 1 }, filtro: 'A1:F' + filas.length
  };
}

function hojaDependenciasXlsx_(tareas, tareasPorId) {
  const H = XLSX_EST.HEADER;
  const enc = ['Tarea', 'Depende de', 'Estado de la que la bloquea'].map((t) => ({ v: t, s: H }));
  const filas = [enc];
  // Una fila por cada dependencia (una tarea puede depender de varias).
  tareas.forEach((t) => {
    Proyectos.dependenciasDe_(t).forEach((pid) => {
      const padre = tareasPorId[pid];
      filas.push([
        t.titulo || '',
        padre ? (padre.titulo || '') : 'Tarea eliminada',
        padre ? (XLSX_ESTADO_TAREA_[padre.estado] || padre.estado || '') : ''
      ]);
    });
  });
  return {
    nombre: 'Dependencias',
    cols: [{ min: 1, max: 2, ancho: 34 }, { min: 3, max: 3, ancho: 20 }],
    filas, congelar: { filas: 1 }, filtro: 'A1:C' + filas.length
  };
}

// --- acción --------------------------------------------------------------
function descargarLibro(db, data, contexto) {
  const detalle = Proyectos.getDetalle(db, data, contexto);
  if (detalle && (detalle._validationError || detalle._forbidden)) return detalle;
  const tareas = Proyectos.listarTareas(db, data, contexto);
  const bitacora = Proyectos.listarBitacora(db, data, contexto);
  const rendimiento = Proyectos.obtenerRendimiento(db, data, contexto);

  const nombres = {};
  try { Object.assign(nombres, require('./documentoV2').nombresPorCorreo(db)); } catch (e) { /* sin cuentas: quedan los correos */ }
  (detalle.integrantes || []).forEach((i) => { if (i.usuario_nombre && !/@/.test(i.usuario_nombre)) nombres[String(i.usuario_email || '').toLowerCase()] = i.usuario_nombre; });
  const buffer = xlsxGanttProyecto_(detalle, tareas, rendimiento, bitacora, nombres);
  const p = detalle.proyecto;
  // Mismo nombre que los PDF del proyecto (auditoría P5): sigso-proyecto-<código o nombre>-<fecha>.xlsx
  const filename = ReportePdf.nombreArchivo_('sigso-proyecto-' + ([p.codigo, p.nombre].filter(Boolean).join('-') || 'proyecto')).replace(/\.pdf$/, '.xlsx');
  return { xlsx_base64: buffer.toString('base64'), filename };
}

module.exports = { descargarLibro, TONO_SEMAFORO_XLSX_ };
