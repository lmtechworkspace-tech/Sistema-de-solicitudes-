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
 * Fechas: se escriben como TEXTO dd/mm/aaaa (no serial de Excel), igual que
 * el .gs. Para timestamps reales (fecha_compromiso, etc.) se resuelve el
 * día de calendario vía Intl con zona horaria America/Santiago -- igual que
 * fechaCorta_ en proyectos.js. Para claves ya-solo-día (plan_inicio, que
 * viene de claveFecha_ en proyectos.js como 'AAAA-MM-DD') NUNCA se
 * reinterpreta con una zona horaria: es una etiqueta de día, no un
 * instante -- mismo criterio que utils.js (anteriorDiaClave_/
 * siguienteDiaClave_) documenta explícitamente.
 */

const Proyectos = require('./proyectos');
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
  HITO_MARCA: 11
};

function stylesXmlXlsx_() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="4">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><sz val="11"/><color rgb="FF6B7280"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="12">' +
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
    '</fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="12">' +
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
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    panes + cols + '<sheetData>' + filasXml + '</sheetData>' + merges + '</worksheet>';
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

  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheetsWb + '</sheets></workbook>';
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
// dd/mm/aaaa para mostrar. Si `valor` ya es una clave de solo-día
// (AAAA-MM-DD, ej. plan_inicio de obtenerRendimiento) se reordena como
// texto -- NUNCA se reinterpreta con new Date()+timezone, porque ya es una
// etiqueta de día, no un instante (ver cabecera del archivo).
function fechaXlsx_(valor) {
  if (!valor) return '';
  const s = String(valor);
  const soloDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (soloDia) return soloDia[3] + '/' + soloDia[2] + '/' + soloDia[1];
  try {
    return new Intl.DateTimeFormat('es-CL', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(valor));
  } catch (err) { return s.slice(0, 10); }
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
function inicioBarraClave_(a, proyIniClave) {
  const cre = claveDeFecha_(a.fecha_creacion);
  const com = claveDeFecha_(a.fecha_compromiso);
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
  EN_REVISION: 'En revision', TERMINADA: 'Terminada', CANCELADA: 'Cancelada'
};
const XLSX_ESTADO_HITO_ = { PENDIENTE: 'Pendiente', EN_CURSO: 'En curso', COMPLETADO: 'Completado', CANCELADO: 'Cancelado' };

function xlsxGanttProyecto_(detalle, tareas, rendimiento, bitacora) {
  const p = detalle.proyecto;
  const hitos = (detalle.hitos || []).filter((h) => h.fecha_objetivo)
    .slice().sort((a, b) => new Date(a.fecha_objetivo) - new Date(b.fecha_objetivo));
  const tareasPorId = {}; tareas.forEach((t) => { tareasPorId[t.actividad_id] = t; });
  const planPorId = {}; ((rendimiento && rendimiento.plan_seguimiento) || []).forEach((t) => { planPorId[t.actividad_id] = t; });

  const hojas = [
    hojaResumenXlsx_(detalle, tareas, hitos),
    hojaCartaGanttXlsx_(p, tareas, hitos),
    hojaTareasXlsx_(tareas, hitos, planPorId),
    hojaHitosXlsx_(hitos, tareas)
  ];
  if (bitacora && bitacora.length) hojas.push(hojaHistorialXlsx_(bitacora, tareasPorId));
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
      [{ v: 'CARTA GANTT', s: B }],
      [{ v: p.nombre || '', s: B }],
      [],
      par('Codigo', p.codigo || '-'),
      par('Periodo', fechaXlsx_(p.fecha_inicio) + ' - ' + fechaXlsx_(p.fecha_objetivo)),
      par('Estado', (detalle.salud_etiqueta || detalle.salud || '') + ''),
      par('Avance general', (detalle.avance_pct === null || detalle.avance_pct === undefined) ? '-' : detalle.avance_pct + '%'),
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

function hojaCartaGanttXlsx_(p, tareas, hitos) {
  const H = XLSX_EST.HEADER, HITOEST = XLSX_EST.BOLD, MARCA = XLSX_EST.HITO_MARCA;
  const tareasConFecha = tareas.filter((t) => t.fecha_compromiso);
  const ahoraClave = Utils.claveDia_(new Date(), TZ);
  const proyIniClave = p.fecha_inicio ? claveDeFecha_(p.fecha_inicio) : null;
  const claves = [ahoraClave];
  if (proyIniClave) claves.push(proyIniClave);
  const proyFinClave = p.fecha_objetivo ? claveDeFecha_(p.fecha_objetivo) : null;
  if (proyFinClave) claves.push(proyFinClave);
  hitos.forEach((h) => { const c = claveDeFecha_(h.fecha_objetivo); if (c) claves.push(c); });
  tareasConFecha.forEach((a) => {
    claves.push(inicioBarraClave_(a, proyIniClave));
    const c = claveDeFecha_(a.fecha_compromiso);
    if (c) claves.push(c);
  });
  const claveMin = claves.reduce((m, c) => (m === null || c < m) ? c : m, null);
  const claveMax = claves.reduce((m, c) => (m === null || c > m) ? c : m, null);
  const semanas = semanasXlsx_(claveMin, claveMax, 40);

  const encabezado = [{ v: 'Hito', s: H }, { v: 'Tarea', s: H }, { v: 'Responsable', s: H },
    { v: 'Estado', s: H }, { v: 'Inicio', s: H }, { v: 'Fin', s: H }];
  semanas.forEach((s) => encabezado.push({ v: s.etiqueta, s: H }));

  function celdasBarra_(a) {
    const barIni = inicioBarraClave_(a, proyIniClave);
    const fin = claveDeFecha_(a.fecha_compromiso);
    const terminal = (a.estado === 'TERMINADA' || a.estado === 'CANCELADA');
    const estiloBarra = XLSX_EST.BARRA[a.semaforo] || XLSX_EST.BARRA.pendiente;
    return semanas.map((s) => {
      const enBarra = (s.finClave >= barIni && s.inicioClave <= fin);
      if (enBarra) return { s: estiloBarra };
      const enAtraso = (!terminal && s.inicioClave > fin && s.inicioClave <= ahoraClave);
      if (enAtraso) return { s: XLSX_EST.BARRA_ATRASO };
      return null;
    });
  }
  function filaTarea_(a) {
    const base = [
      '',
      a.titulo || '',
      a.responsable_nombre || a.responsable_email || '',
      XLSX_ESTADO_TAREA_[a.estado] || a.estado || '',
      fechaXlsx_(inicioBarraClave_(a, proyIniClave)),
      fechaXlsx_(a.fecha_compromiso)
    ];
    return base.concat(celdasBarra_(a));
  }

  const porHito = {}, sinHito = [];
  tareasConFecha.forEach((a) => {
    if (a.hito_id && hitos.some((h) => h.hito_id === a.hito_id)) (porHito[a.hito_id] = porHito[a.hito_id] || []).push(a);
    else sinHito.push(a);
  });
  const porFin = (a, b) => new Date(a.fecha_compromiso) - new Date(b.fecha_compromiso);

  const filas = [encabezado];
  hitos.forEach((h) => {
    const objClave = claveDeFecha_(h.fecha_objetivo);
    const fila = [{ v: h.nombre, s: HITOEST }, '', '', { v: XLSX_ESTADO_HITO_[h.estado] || h.estado, s: HITOEST }, '', ''];
    semanas.forEach((s) => fila.push((objClave >= s.inicioClave && objClave <= s.finClave) ? { v: '◆', s: MARCA } : null));
    filas.push(fila);
    (porHito[h.hito_id] || []).sort(porFin).forEach((a) => filas.push(filaTarea_(a)));
  });
  if (sinHito.length) {
    const filaSin = [{ v: 'Sin hito', s: HITOEST }, '', '', '', '', ''];
    semanas.forEach(() => filaSin.push(null));
    filas.push(filaSin);
    sinHito.sort(porFin).forEach((a) => filas.push(filaTarea_(a)));
  }

  const cols = [{ min: 1, max: 1, ancho: 22 }, { min: 2, max: 2, ancho: 32 }, { min: 3, max: 3, ancho: 22 },
    { min: 4, max: 4, ancho: 13 }, { min: 5, max: 6, ancho: 11 }];
  if (semanas.length) cols.push({ min: 7, max: 6 + semanas.length, ancho: 4.5 });
  return { nombre: 'Carta Gantt', cols, filas, congelar: { filas: 1, cols: 6 } };
}

function hojaTareasXlsx_(tareas, hitos, planPorId) {
  const H = XLSX_EST.HEADER;
  const hitoNombre = {}; hitos.forEach((h) => { hitoNombre[h.hito_id] = h.nombre; });
  const enc = ['ID', 'Hito', 'Tarea', 'Responsable', 'Estado', 'Inicio plan', 'Fin plan', 'Avance', 'Esperado', 'Real', 'Desviacion (pp)']
    .map((t) => ({ v: t, s: H }));
  const filas = [enc];
  tareas.forEach((a) => {
    const plan = planPorId[a.actividad_id] || {};
    filas.push([
      a.codigo || a.actividad_id || '',
      a.hito_id ? (hitoNombre[a.hito_id] || '') : '',
      a.titulo || '',
      a.responsable_nombre || a.responsable_email || '',
      XLSX_ESTADO_TAREA_[a.estado] || a.estado || '',
      fechaXlsx_(plan.plan_inicio || a.fecha_creacion),
      fechaXlsx_(plan.plan_fin || a.fecha_compromiso),
      (a.avance_pct === '' || a.avance_pct === null || a.avance_pct === undefined) ? '' : { v: Number(a.avance_pct), t: 'n' },
      (plan.avance_esperado_pct === null || plan.avance_esperado_pct === undefined) ? '' : { v: plan.avance_esperado_pct, t: 'n' },
      (plan.avance_real_pct === null || plan.avance_real_pct === undefined) ? '' : { v: plan.avance_real_pct, t: 'n' },
      (plan.desviacion_pp === null || plan.desviacion_pp === undefined) ? '' : { v: plan.desviacion_pp, t: 'n' }
    ]);
  });
  return {
    nombre: 'Tareas',
    cols: [{ min: 1, max: 1, ancho: 14 }, { min: 2, max: 2, ancho: 22 }, { min: 3, max: 3, ancho: 34 },
      { min: 4, max: 4, ancho: 22 }, { min: 5, max: 5, ancho: 14 }, { min: 6, max: 7, ancho: 12 }, { min: 8, max: 11, ancho: 12 }],
    filas, congelar: { filas: 1 }
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
    'Duracion plan (d)', 'Duracion real (d)', 'Desviacion (d)', 'Estado'].map((t) => ({ v: t, s: H }));
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
    filas, congelar: { filas: 1 }
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
      porResponsable[clave] = { nombre: a.responsable_nombre || a.responsable_email || '(sin asignar)', total: 0, completadas: 0, enCurso: 0, atrasadas: 0 };
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
        Math.round((r.total / totalGeneral) * 1000) / 10 + '%'
      ]);
    });
  return {
    nombre: 'Responsables',
    cols: [{ min: 1, max: 1, ancho: 28 }, { min: 2, max: 6, ancho: 14 }],
    filas, congelar: { filas: 1 }
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
    filas, congelar: { filas: 1 }
  };
}

function hojaHistorialXlsx_(bitacora, tareasPorId) {
  const H = XLSX_EST.HEADER;
  const enc = ['Fecha', 'Tarea', 'Tipo', 'Detalle', 'Horas'].map((t) => ({ v: t, s: H }));
  const filas = [enc];
  bitacora.slice().sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .forEach((b) => {
      const tarea = tareasPorId[b.actividad_id];
      const etiqueta = (b.tipo === 'REGISTRO_DIA') ? (b.estado_dia || 'Registro del dia') : (b.tipo || '');
      filas.push([
        fechaXlsx_(b.dia || b.timestamp),
        tarea ? (tarea.titulo || '') : '',
        etiqueta,
        b.nota || '',
        (b.horas === '' || b.horas === null || b.horas === undefined) ? '' : { v: Number(b.horas), t: 'n' }
      ]);
    });
  return {
    nombre: 'Historial',
    cols: [{ min: 1, max: 1, ancho: 13 }, { min: 2, max: 2, ancho: 30 }, { min: 3, max: 3, ancho: 18 }, { min: 4, max: 4, ancho: 44 }, { min: 5, max: 5, ancho: 8 }],
    filas, congelar: { filas: 1 }
  };
}

function hojaDependenciasXlsx_(tareas, tareasPorId) {
  const H = XLSX_EST.HEADER;
  const enc = ['Tarea', 'Depende de', 'Estado de la que la bloquea'].map((t) => ({ v: t, s: H }));
  const filas = [enc];
  tareas.filter((t) => t.depende_de).forEach((t) => {
    const padre = tareasPorId[t.depende_de];
    filas.push([
      t.titulo || '',
      padre ? (padre.titulo || '') : t.depende_de,
      padre ? (XLSX_ESTADO_TAREA_[padre.estado] || padre.estado || '') : ''
    ]);
  });
  return {
    nombre: 'Dependencias',
    cols: [{ min: 1, max: 2, ancho: 34 }, { min: 3, max: 3, ancho: 20 }],
    filas, congelar: { filas: 1 }
  };
}

// --- acción --------------------------------------------------------------
function descargarLibro(db, data, contexto) {
  const detalle = Proyectos.getDetalle(db, data, contexto);
  if (detalle && (detalle._validationError || detalle._forbidden)) return detalle;
  const tareas = Proyectos.listarTareas(db, data, contexto);
  const bitacora = Proyectos.listarBitacora(db, data, contexto);
  const rendimiento = Proyectos.obtenerRendimiento(db, data, contexto);

  const buffer = xlsxGanttProyecto_(detalle, tareas, rendimiento, bitacora);
  const p = detalle.proyecto;
  return { xlsx_base64: buffer.toString('base64'), filename: (p.nombre || 'Proyecto') + '.xlsx' };
}

module.exports = { descargarLibro };
