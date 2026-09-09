/**
 * ExcelGantt.gs — exportación de un proyecto a .xlsx (Carta Gantt + tablas).
 *
 * POR QUÉ A MANO (y no una Hoja temporal de Drive): un .xlsx ES un ZIP de
 * archivos XML (OOXML). Se arma con Utilities.zip (misma familia que ya usa el
 * proyecto), 100% dentro de Apps Script -- SIN pedir un permiso de Drive nuevo,
 * SIN crear/limpiar una Hoja temporal, SIN re-autorizar el script. Es el mismo
 * criterio "cero costo, cero scope nuevo" de todo SIGSO.
 *
 * Alcance: un libro con hasta 6 hojas -- Resumen, Carta Gantt (barras sobre un
 * calendario semanal), Tareas, Hitos, Historial y Dependencias. Las fechas se
 * escriben como TEXTO (dd/mm/aaaa), no como serial de Excel: es legible y
 * robusto; una versión futura podría pasar a fecha real si se necesita ordenar.
 */

// --- estilos: índices que referencian las celdas (atributo s="") ------------
// Se mantienen ESTABLES: styles.xml los define en este orden exacto.
var XLSX_EST = {
  NORMAL: 0,
  HEADER: 1,      // encabezado de tabla: negrita, texto blanco sobre navy
  BOLD: 2,        // negrita (fila de hito, totales)
  TENUE: 3,       // texto gris (metadatos)
  BARRA: {        // relleno de barra por semáforo (celda vacía coloreada)
    'al-dia': 4, terminada: 4, 'terminada ': 4,
    riesgo: 5,
    atrasada: 6,
    bloqueada: 7,
    revision: 8,
    pendiente: 9
  },
  BARRA_ATRASO: 10,  // tramo vencido sin cerrar (rojo oscuro)
  HITO_MARCA: 11     // ◆ del hito en el calendario (navy, centrado)
};

// styles.xml fijo. El orden de <fills>/<fonts>/<cellXfs> tiene que calzar con
// XLSX_EST -- si se agrega un estilo, se agrega acá Y en el mapa de arriba.
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
      '<fill><patternFill patternType="none"/></fill>' +                                   // 0
      '<fill><patternFill patternType="gray125"/></fill>' +                                // 1 (convención OOXML)
      '<fill><patternFill patternType="solid"><fgColor rgb="FF14213D"/></patternFill></fill>' + // 2 navy (header)
      '<fill><patternFill patternType="solid"><fgColor rgb="FF16A34A"/></patternFill></fill>' + // 3 verde
      '<fill><patternFill patternType="solid"><fgColor rgb="FFD97706"/></patternFill></fill>' + // 4 ámbar
      '<fill><patternFill patternType="solid"><fgColor rgb="FFDC2626"/></patternFill></fill>' + // 5 rojo
      '<fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/></patternFill></fill>' + // 6 azul
      '<fill><patternFill patternType="solid"><fgColor rgb="FF7C3AED"/></patternFill></fill>' + // 7 morado
      '<fill><patternFill patternType="solid"><fgColor rgb="FF64748B"/></patternFill></fill>' + // 8 gris
      '<fill><patternFill patternType="solid"><fgColor rgb="FFB91C1C"/></patternFill></fill>' + // 9 rojo oscuro
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/></patternFill></fill>' + // 10 gris claro (hito row)
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F4F9"/></patternFill></fill>' + // 11 (reserva)
    '</fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="12">' +
      '<xf xfId="0" fontId="0" fillId="0" borderId="0"/>' +                                // 0 NORMAL
      '<xf xfId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>' + // 1 HEADER
      '<xf xfId="0" fontId="2" fillId="10" borderId="0" applyFont="1" applyFill="1"/>' +   // 2 BOLD (hito row, gris claro)
      '<xf xfId="0" fontId="3" fillId="0" borderId="0" applyFont="1"/>' +                  // 3 TENUE
      '<xf xfId="0" fontId="0" fillId="3" borderId="0" applyFill="1"/>' +                  // 4 barra verde
      '<xf xfId="0" fontId="0" fillId="4" borderId="0" applyFill="1"/>' +                  // 5 barra ámbar
      '<xf xfId="0" fontId="0" fillId="5" borderId="0" applyFill="1"/>' +                  // 6 barra rojo
      '<xf xfId="0" fontId="0" fillId="6" borderId="0" applyFill="1"/>' +                  // 7 barra azul
      '<xf xfId="0" fontId="0" fillId="7" borderId="0" applyFill="1"/>' +                  // 8 barra morado
      '<xf xfId="0" fontId="0" fillId="8" borderId="0" applyFill="1"/>' +                  // 9 barra gris
      '<xf xfId="0" fontId="0" fillId="9" borderId="0" applyFill="1"/>' +                  // 10 barra atraso
      '<xf xfId="0" fontId="2" fillId="0" borderId="0" applyFont="1"><alignment horizontal="center"/></xf>' + // 11 ◆ hito
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
// Letra(s) de columna a partir del índice 1 (1->A, 26->Z, 27->AA).
function colLetraXlsx_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
// Una celda. `cell` puede ser: string/number (estilo NORMAL), o
// {v, t:'n'|'s', s:estilo}. Sin valor pero con estilo -> celda vacía coloreada
// (así se pintan las barras). null/undefined -> no se emite celda.
function celdaXmlXlsx_(ref, cell) {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string' || typeof cell === 'number') cell = { v: cell };
  var s = (cell.s ? ' s="' + cell.s + '"' : '');
  var vacio = (cell.v === undefined || cell.v === null || cell.v === '');
  if (vacio) return '<c r="' + ref + '"' + s + '/>';
  var esNum = cell.t === 'n' || (cell.t !== 's' && typeof cell.v === 'number');
  if (esNum) return '<c r="' + ref + '"' + s + '><v>' + cell.v + '</v></c>';
  return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + escXmlXlsx_(cell.v) + '</t></is></c>';
}
// Una hoja: { nombre, filas: [[cell,...],...], cols: [{min,max,ancho},...],
//   merges: ['A1:C1',...], congelar: {filas, cols} }.
function sheetXmlXlsx_(hoja) {
  var cols = (hoja.cols && hoja.cols.length)
    ? '<cols>' + hoja.cols.map(function (c) {
        return '<col min="' + c.min + '" max="' + c.max + '" width="' + c.ancho + '" customWidth="1"/>';
      }).join('') + '</cols>'
    : '';
  var filasXml = (hoja.filas || []).map(function (fila, i) {
    var r = i + 1;
    var celdas = (fila || []).map(function (cell, j) {
      return celdaXmlXlsx_(colLetraXlsx_(j + 1) + r, cell);
    }).join('');
    return '<row r="' + r + '">' + celdas + '</row>';
  }).join('');
  var merges = (hoja.merges && hoja.merges.length)
    ? '<mergeCells count="' + hoja.merges.length + '">' +
      hoja.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>'
    : '';
  var panes = '';
  if (hoja.congelar && (hoja.congelar.filas || hoja.congelar.cols)) {
    var xSplit = hoja.congelar.cols || 0, ySplit = hoja.congelar.filas || 0;
    var topLeft = colLetraXlsx_(xSplit + 1) + (ySplit + 1);
    panes = '<sheetViews><sheetView workbookViewId="0">' +
      '<pane xSplit="' + xSplit + '" ySplit="' + ySplit + '" topLeftCell="' + topLeft + '" activePane="bottomRight" state="frozen"/>' +
      '</sheetView></sheetViews>';
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    panes + cols + '<sheetData>' + filasXml + '</sheetData>' + merges + '</worksheet>';
}

// Arma el .xlsx a partir de una lista de hojas y devuelve el Blob (ZIP OOXML).
function construirXlsx_(hojas, nombreArchivo) {
  var n = hojas.length;
  var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
  for (var i = 0; i < n; i++) {
    contentTypes += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }
  contentTypes += '</Types>';

  var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  var sheetsWb = '', relsWb = '';
  for (var j = 0; j < n; j++) {
    var rid = 'rId' + (j + 1);
    sheetsWb += '<sheet name="' + escXmlXlsx_(hojas[j].nombre.slice(0, 31)) + '" sheetId="' + (j + 1) + '" r:id="' + rid + '"/>';
    relsWb += '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (j + 1) + '.xml"/>';
  }
  var stylesRid = 'rId' + (n + 1);
  relsWb += '<Relationship Id="' + stylesRid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

  var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheetsWb + '</sheets></workbook>';
  var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relsWb + '</Relationships>';

  var blobs = [
    Utilities.newBlob(contentTypes, 'application/xml', '[Content_Types].xml'),
    Utilities.newBlob(rels, 'application/xml', '_rels/.rels'),
    Utilities.newBlob(workbook, 'application/xml', 'xl/workbook.xml'),
    Utilities.newBlob(workbookRels, 'application/xml', 'xl/_rels/workbook.xml.rels'),
    Utilities.newBlob(stylesXmlXlsx_(), 'application/xml', 'xl/styles.xml')
  ];
  for (var k = 0; k < n; k++) {
    blobs.push(Utilities.newBlob(sheetXmlXlsx_(hojas[k]), 'application/xml', 'xl/worksheets/sheet' + (k + 1) + '.xml'));
  }
  return Utilities.zip(blobs, (nombreArchivo || 'libro') + '.xlsx');
}

// --- armado del libro del proyecto ------------------------------------------
var XLSX_ESTADO_TAREA_ = {
  NO_INICIADA: 'Sin empezar', EN_CURSO: 'En curso', BLOQUEADA: 'Bloqueada',
  EN_REVISION: 'En revision', TERMINADA: 'Terminada', CANCELADA: 'Cancelada'
};
var XLSX_ESTADO_HITO_ = { PENDIENTE: 'Pendiente', EN_CURSO: 'En curso', COMPLETADO: 'Completado', CANCELADO: 'Cancelado' };

function fechaXlsx_(valor) {
  if (!valor) return '';
  try { return Utilities.formatDate(new Date(valor), 'America/Santiago', 'dd/MM/yyyy'); }
  catch (err) { return String(valor).slice(0, 10); }
}
function inicioBarraTimeXlsx_(a, proyIniTime) {
  var cre = a.fecha_creacion ? new Date(a.fecha_creacion).getTime() : null;
  var com = a.fecha_compromiso ? new Date(a.fecha_compromiso).getTime() : null;
  if (cre !== null && com !== null) {
    if (cre <= com) return cre;
    if (proyIniTime !== null && proyIniTime <= com) return proyIniTime;
    return com;
  }
  return cre !== null ? cre : (proyIniTime !== null ? proyIniTime : com);
}
// Semanas lunes->domingo que cubren [minTime..maxTime], con tope.
function semanasXlsx_(minTime, maxTime, tope) {
  var d = new Date(minTime);
  var dow = d.getDay(); // 0=domingo
  d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (dow === 0 ? 6 : dow - 1));
  var semanas = [];
  while (d.getTime() <= maxTime && semanas.length < (tope || 40)) {
    var ini = new Date(d.getTime());
    var fin = new Date(d.getTime() + 6 * 86400000 + 86399000);
    semanas.push({ ini: ini.getTime(), fin: fin.getTime(), etiqueta: Utilities.formatDate(ini, 'America/Santiago', 'dd/MM') });
    d = new Date(d.getTime() + 7 * 86400000);
  }
  return semanas;
}

// Punto de entrada: arma el .xlsx completo del proyecto.
function xlsxGanttProyecto_(detalle, tareas, rendimiento, bitacora) {
  var p = detalle.proyecto;
  var hitos = (detalle.hitos || []).filter(function (h) { return h.fecha_objetivo; })
    .slice().sort(function (a, b) { return new Date(a.fecha_objetivo) - new Date(b.fecha_objetivo); });
  var tareasPorId = {}; tareas.forEach(function (t) { tareasPorId[t.actividad_id] = t; });
  var planPorId = {}; ((rendimiento && rendimiento.plan_seguimiento) || []).forEach(function (t) { planPorId[t.actividad_id] = t; });

  var hojas = [
    hojaResumenXlsx_(detalle, tareas, hitos, rendimiento),
    hojaCartaGanttXlsx_(p, tareas, hitos),
    hojaTareasXlsx_(tareas, hitos, planPorId),
    hojaHitosXlsx_(hitos, tareas)
  ];
  if (bitacora && bitacora.length) hojas.push(hojaHistorialXlsx_(bitacora, tareasPorId));
  if (tareas.some(function (t) { return t.depende_de; })) hojas.push(hojaDependenciasXlsx_(tareas, tareasPorId));

  var nombre = 'Carta_Gantt_' + String(p.codigo || p.nombre || 'proyecto').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
  return construirXlsx_(hojas, nombre);
}

function hojaResumenXlsx_(detalle, tareas, hitos, rendimiento) {
  var p = detalle.proyecto;
  var total = tareas.length;
  var completadas = tareas.filter(function (t) { return t.estado === 'TERMINADA'; }).length;
  var enCurso = tareas.filter(function (t) { return t.estado === 'EN_CURSO' || t.estado === 'EN_REVISION' || t.estado === 'BLOQUEADA'; }).length;
  var pendientes = tareas.filter(function (t) { return t.estado === 'NO_INICIADA'; }).length;
  var atrasadas = tareas.filter(function (t) { return t.semaforo === 'atrasada'; }).length;
  var B = XLSX_EST.BOLD, T = XLSX_EST.TENUE;
  function par(l, v) { return [{ v: l, s: T }, v]; }
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
      par('Avance general', (detalle.avance_pct === null || detalle.avance_pct === undefined ? '-' : detalle.avance_pct + '%')),
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
  var H = XLSX_EST.HEADER, HITOEST = XLSX_EST.BOLD, MARCA = XLSX_EST.HITO_MARCA;
  var tareasConFecha = tareas.filter(function (t) { return t.fecha_compromiso; });
  var ahora = Date.now();
  var proyIniTime = p.fecha_inicio ? new Date(p.fecha_inicio).getTime() : null;
  var tiempos = [ahora];
  if (proyIniTime !== null) tiempos.push(proyIniTime);
  if (p.fecha_objetivo) tiempos.push(new Date(p.fecha_objetivo).getTime());
  hitos.forEach(function (h) { tiempos.push(new Date(h.fecha_objetivo).getTime()); });
  tareasConFecha.forEach(function (a) {
    tiempos.push(inicioBarraTimeXlsx_(a, proyIniTime));
    tiempos.push(new Date(a.fecha_compromiso).getTime());
  });
  var minTime = Math.min.apply(null, tiempos);
  var maxTime = Math.max.apply(null, tiempos);
  var semanas = semanasXlsx_(minTime, maxTime, 40);

  var encabezado = [{ v: 'Hito', s: H }, { v: 'Tarea', s: H }, { v: 'Responsable', s: H },
    { v: 'Estado', s: H }, { v: 'Inicio', s: H }, { v: 'Fin', s: H }];
  semanas.forEach(function (s) { encabezado.push({ v: s.etiqueta, s: H }); });

  function celdasBarra_(a) {
    var barIni = inicioBarraTimeXlsx_(a, proyIniTime);
    var fin = new Date(a.fecha_compromiso).getTime();
    var terminal = (a.estado === 'TERMINADA' || a.estado === 'CANCELADA');
    var estiloBarra = XLSX_EST.BARRA[a.semaforo] || XLSX_EST.BARRA.pendiente;
    return semanas.map(function (s) {
      var enBarra = (s.fin >= barIni && s.ini <= fin);
      if (enBarra) return { s: estiloBarra };
      var enAtraso = (!terminal && s.ini > fin && s.ini <= ahora);
      if (enAtraso) return { s: XLSX_EST.BARRA_ATRASO };
      return null;
    });
  }
  function filaTarea_(a) {
    var base = [
      '',
      a.titulo || '',
      a.responsable_nombre || a.responsable_email || '',
      XLSX_ESTADO_TAREA_[a.estado] || a.estado || '',
      fechaXlsx_(inicioBarraTimeXlsx_(a, proyIniTime)),
      fechaXlsx_(a.fecha_compromiso)
    ];
    return base.concat(celdasBarra_(a));
  }

  var porHito = {}, sinHito = [];
  tareasConFecha.forEach(function (a) {
    if (a.hito_id && hitos.some(function (h) { return h.hito_id === a.hito_id; })) (porHito[a.hito_id] = porHito[a.hito_id] || []).push(a);
    else sinHito.push(a);
  });
  var porFin = function (a, b) { return new Date(a.fecha_compromiso) - new Date(b.fecha_compromiso); };

  var filas = [encabezado];
  hitos.forEach(function (h) {
    var objTime = new Date(h.fecha_objetivo).getTime();
    var fila = [{ v: h.nombre, s: HITOEST }, '', '', { v: XLSX_ESTADO_HITO_[h.estado] || h.estado, s: HITOEST }, '', ''];
    semanas.forEach(function (s) { fila.push((objTime >= s.ini && objTime <= s.fin) ? { v: '◆', s: MARCA } : null); });
    filas.push(fila);
    (porHito[h.hito_id] || []).sort(porFin).forEach(function (a) { filas.push(filaTarea_(a)); });
  });
  if (sinHito.length) {
    var filaSin = [{ v: 'Sin hito', s: HITOEST }, '', '', '', '', ''];
    semanas.forEach(function () { filaSin.push(null); });
    filas.push(filaSin);
    sinHito.sort(porFin).forEach(function (a) { filas.push(filaTarea_(a)); });
  }

  var cols = [{ min: 1, max: 1, ancho: 22 }, { min: 2, max: 2, ancho: 32 }, { min: 3, max: 3, ancho: 22 },
    { min: 4, max: 4, ancho: 13 }, { min: 5, max: 6, ancho: 11 }];
  if (semanas.length) cols.push({ min: 7, max: 6 + semanas.length, ancho: 4.5 });
  return { nombre: 'Carta Gantt', cols: cols, filas: filas, congelar: { filas: 1, cols: 6 } };
}

function hojaTareasXlsx_(tareas, hitos, planPorId) {
  var H = XLSX_EST.HEADER;
  var hitoNombre = {}; hitos.forEach(function (h) { hitoNombre[h.hito_id] = h.nombre; });
  var enc = ['ID', 'Hito', 'Tarea', 'Responsable', 'Estado', 'Inicio plan', 'Fin plan', 'Avance', 'Esperado', 'Real', 'Desviacion (pp)']
    .map(function (t) { return { v: t, s: H }; });
  var filas = [enc];
  tareas.forEach(function (a) {
    var plan = planPorId[a.actividad_id] || {};
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
    filas: filas, congelar: { filas: 1 }
  };
}

function hojaHitosXlsx_(hitos, tareas) {
  var H = XLSX_EST.HEADER;
  var enc = ['Hito', 'Fecha objetivo', 'Estado', 'Avance', 'Total tareas', 'Completadas']
    .map(function (t) { return { v: t, s: H }; });
  var filas = [enc];
  hitos.forEach(function (h) {
    var suyas = tareas.filter(function (t) { return t.hito_id === h.hito_id; });
    var comp = suyas.filter(function (t) { return t.estado === 'TERMINADA'; }).length;
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
    filas: filas, congelar: { filas: 1 }
  };
}

function hojaHistorialXlsx_(bitacora, tareasPorId) {
  var H = XLSX_EST.HEADER;
  var enc = ['Fecha', 'Tarea', 'Tipo', 'Detalle', 'Horas'].map(function (t) { return { v: t, s: H }; });
  var filas = [enc];
  bitacora.slice().sort(function (a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); })
    .forEach(function (b) {
      var tarea = tareasPorId[b.actividad_id];
      var etiqueta = (b.tipo === 'REGISTRO_DIA') ? (b.estado_dia || 'Registro del dia') : (b.tipo || '');
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
    filas: filas, congelar: { filas: 1 }
  };
}

function hojaDependenciasXlsx_(tareas, tareasPorId) {
  var H = XLSX_EST.HEADER;
  var enc = ['Tarea', 'Depende de', 'Estado de la que la bloquea'].map(function (t) { return { v: t, s: H }; });
  var filas = [enc];
  tareas.filter(function (t) { return t.depende_de; }).forEach(function (t) {
    var padre = tareasPorId[t.depende_de];
    filas.push([
      t.titulo || '',
      padre ? (padre.titulo || '') : t.depende_de,
      padre ? (XLSX_ESTADO_TAREA_[padre.estado] || padre.estado || '') : ''
    ]);
  });
  return {
    nombre: 'Dependencias',
    cols: [{ min: 1, max: 2, ancho: 34 }, { min: 3, max: 3, ancho: 20 }],
    filas: filas, congelar: { filas: 1 }
  };
}
