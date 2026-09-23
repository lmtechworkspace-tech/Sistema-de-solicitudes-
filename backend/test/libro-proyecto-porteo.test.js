'use strict';

/**
 * Prueba de portabilidad: Proyectos.descargarLibro (Proyectos.gs) +
 * ExcelGantt.gs, corridos contra libroProyecto.js. Escenarios adaptados de
 * backend/test/proyectos-libro-excel.test.js (el .gs, vía gasSandbox), que
 * ya probaba contra el ZIP crudo porque su mock de Utilities.zip guarda sin
 * comprimir. Acá el ZIP real usa DEFLATE (xlsxZip.js), así que las
 * aserciones se corren sobre el contenido DESCOMPRIMIDO de cada hoja
 * (leerZip_), no sobre los bytes crudos del archivo.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Actividades = require('../logica/actividades');
const Libro = require('../logica/libroProyecto');
const { leerZip_ } = require('../logica/xlsxZip');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV' };

const TABLAS = [
  'PROYECTOS', 'PROYECTO_INTEGRANTES', 'PROYECTO_HITOS', 'PROYECTO_EVENTOS',
  'PROYECTO_ENTREGABLES', 'PROYECTO_RIESGOS', 'PROYECTO_PLANTILLAS', 'PROYECTO_PLANTILLA_HITOS',
  'PROYECTO_DOCUMENTOS', 'PROYECTO_DOC_VERSIONES', 'PROYECTO_REUNIONES', 'PROYECTO_REUNION_ACUERDOS',
  'PROYECTO_DECISIONES', 'SOLICITUDES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS',
  'LOG_NOTIFICACIONES', 'CONFIG_FERIADOS', 'NOTIFICACIONES_APP', 'CAT_AREAS'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function crearProyectoBase(db, over) {
  return Proyectos.crear(db, Object.assign({ nombre: 'Migración ERP', fecha_inicio: '2026-01-15', fecha_objetivo: '2026-11-30' }, over), CTX_LEO);
}
function armarEscenario(db) {
  const p = crearProyectoBase(db);
  const hito = Proyectos.gestionarHito(db, { proyecto_id: p.proyecto_id, accion: 'crear', nombre: 'Puesta en marcha', fecha_objetivo: '2026-06-30' }, CTX_LEO);
  const t1 = Proyectos.crearTarea(db, {
    proyecto_id: p.proyecto_id, titulo: 'Levantar requerimientos',
    responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-03-15', hito_id: hito.hito_id
  }, CTX_LEO);
  const t2 = Proyectos.crearTarea(db, {
    proyecto_id: p.proyecto_id, titulo: 'Migrar datos',
    responsable_email: 'leo@rld.cl', fecha_compromiso: '2026-05-20'
  }, CTX_LEO);
  Proyectos.editarTarea(db, { proyecto_id: p.proyecto_id, actividad_id: t2.actividad_id, depende_de: t1.actividad_id }, CTX_LEO);
  Actividades.confirmar(db, { actividad_id: t1.actividad_id }, CTX_LEO);
  Actividades.confirmar(db, { actividad_id: t2.actividad_id }, CTX_LEO);
  return { p, hito, t1, t2 };
}

function textoDelLibro_(r) {
  const buf = Buffer.from(r.xlsx_base64, 'base64');
  return leerZip_(buf).map((e) => e.contenido.toString('utf8')).join('\n---\n');
}
function hojaTexto_(r, nombreParte) {
  const buf = Buffer.from(r.xlsx_base64, 'base64');
  const entrada = leerZip_(buf).find((e) => e.nombre === nombreParte);
  return entrada ? entrada.contenido.toString('utf8') : '';
}

test('descargarLibro: proyecto inexistente devuelve _validationError (nunca un .xlsx a medias)', () => {
  const db = db_();
  const res = Libro.descargarLibro(db, { proyecto_id: 'NO-EXISTE' }, CTX_LEO);
  assert.equal(res._validationError, true);
});

test('descargarLibro: un ajeno no puede descargar el libro (mismo gate que el PDF)', () => {
  const db = db_();
  const { p } = armarEscenario(db);
  const res = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_OTRO);
  assert.equal(res._forbidden, true);
});

test('descargarLibro: devuelve un .xlsx (ZIP válido, firma PK) con las 6 hojas del proyecto', () => {
  const db = db_();
  const { p } = armarEscenario(db);
  const res = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  assert.ok(res.xlsx_base64, 'debe devolver el archivo en base64');
  assert.match(res.filename, /\.xlsx$/);
  const buf = Buffer.from(res.xlsx_base64, 'base64');
  assert.equal(buf[0], 0x50); assert.equal(buf[1], 0x4b); // "PK"
  const txt = textoDelLibro_(res);
  ['Resumen', 'Carta Gantt', 'Tareas', 'Hitos', 'Dependencias'].forEach((n) => {
    assert.ok(txt.includes('<sheet name="' + n + '"'), 'falta la hoja ' + n);
  });
});

test('descargarLibro: la Carta Gantt trae el hito, las tareas y celdas-barra con estilo de color', () => {
  const db = db_();
  const { p } = armarEscenario(db);
  const res = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const txt = textoDelLibro_(res);
  assert.ok(txt.includes('Puesta en marcha'), 'falta el nombre del hito');
  assert.ok(txt.includes('Levantar requerimientos') && txt.includes('Migrar datos'), 'faltan tareas');
  // celda-barra: celda vacía con un estilo de relleno (4=verde .. 10=atraso).
  assert.match(txt, /<c r="[A-Z]+\d+" s="([4-9]|10)"\/>/, 'no hay ninguna celda-barra pintada');
  assert.ok(txt.indexOf('◆') !== -1, 'falta el ◆ del hito en la línea de tiempo');
});

test('descargarLibro: la Dependencia sale por TÍTULO del padre, no por su id', () => {
  const db = db_();
  const { p, t1 } = armarEscenario(db);
  const res = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const hojaDep = hojaTexto_(res, 'xl/worksheets/sheet6.xml');
  assert.ok(hojaDep.includes('Depende de'), 'falta el encabezado de dependencias');
  assert.ok(hojaDep.includes('Levantar requerimientos'), 'la dependencia debe salir por el título del padre');
  assert.ok(hojaDep.indexOf(t1.actividad_id) === -1, 'el id del padre no debe escaparse a la celda de dependencia');
});

test('descargarLibro: un proyecto recién creado (sin tareas) igual produce un .xlsx válido, sin hoja de Dependencias', () => {
  const db = db_();
  const p = crearProyectoBase(db, { nombre: 'Recién creado', fecha_inicio: '2026-01-01', fecha_objetivo: '2026-12-01' });
  const res = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const buf = Buffer.from(res.xlsx_base64, 'base64');
  assert.equal(buf[0], 0x50); assert.equal(buf[1], 0x4b);
  const txt = textoDelLibro_(res);
  assert.ok(txt.includes('<sheet name="Resumen"') && txt.includes('<sheet name="Carta Gantt"'));
  assert.ok(!txt.includes('<sheet name="Dependencias"'), 'sin dependencias no debe haber hoja de dependencias');
  assert.ok(!txt.includes('<sheet name="Historial"'), 'sin bitácora no debe haber hoja de historial');
});

test('descargarLibro: la Historial trae la bitácora (registro del día con horas)', () => {
  const db = db_();
  const { p, t1 } = armarEscenario(db);
  Actividades.checkin(db, { actividad_id: t1.actividad_id, tipo: 'avance', nota: 'Avanzando bien', horas: 4 }, CTX_LEO);
  const res = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const txt = textoDelLibro_(res);
  assert.ok(txt.includes('<sheet name="Historial"'), 'falta la hoja de Historial');
  const hojaHist = hojaTexto_(res, 'xl/worksheets/sheet5.xml');
  assert.ok(hojaHist.includes('Avanzando bien'), 'falta la nota de la bitácora');
});

// --- Refactor "Planificación" Etapa 8 (§28/§30 del encargo) ----------------
// Todas estas pruebas usan textoDelLibro_ (el ZIP completo concatenado) en
// vez de apuntar a un sheetN.xml fijo: Control de Plazos y Responsables van
// AL FINAL a propósito (ver el comentario en libroProyecto.js), así que su
// índice real depende de si el escenario tiene Historial/Dependencias --
// buscar en el texto completo es la forma robusta de probarlas sin acoplar
// el test a ese índice.

test('descargarLibro: Control de Plazos y Responsables van SIEMPRE al final, sin correr el índice de las hojas de siempre', () => {
  const db = db_();
  const { p } = armarEscenario(db);
  const res = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const txt = textoDelLibro_(res);
  ['Resumen', 'Carta Gantt', 'Tareas', 'Hitos', 'Dependencias', 'Control de Plazos', 'Responsables'].forEach((n) => {
    assert.ok(txt.includes('<sheet name="' + n + '"'), 'falta la hoja ' + n);
  });
  // Dependencias sigue siendo sheet6.xml (no se corrió) -- misma aserción
  // que el test de arriba de "sale por título del padre", repetida acá
  // como red de seguridad de que Etapa 8 no le movió el piso.
  const hojaDep = hojaTexto_(res, 'xl/worksheets/sheet6.xml');
  assert.ok(hojaDep.includes('Depende de'), 'Dependencias debe seguir siendo sheet6.xml tras agregar las hojas nuevas');
});

// En armarEscenario (2 tareas, ambas con fecha_compromiso vieja respecto al
// reloj real, Historial + Dependencias presentes), el orden de hojas queda
// fijo y verificado empíricamente: Control de Plazos = sheet7.xml,
// Responsables = sheet8.xml.
test('descargarLibro: Control de Plazos trae Inicio real y Fin real correctos -- fecha real si se registró, "No registrado" si no, nunca inventada', () => {
  const db = db_();
  const { p } = armarEscenario(db);
  const res = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const hojaPlazos = hojaTexto_(res, 'xl/worksheets/sheet7.xml');
  assert.ok(hojaPlazos.includes('Levantar requerimientos') && hojaPlazos.includes('Migrar datos'), 'faltan las tareas');
  assert.ok(hojaPlazos.includes('No registrado'), 'ninguna tarea del escenario terminó -- Fin real debe decir "No registrado", no una fecha inventada');
  // Duracion plan (dias) = Proyectos.calcularDuracionDias_(plan_inicio, plan_fin),
  // mismo numero que ya usa la plataforma -- Levantar requerimientos:
  // 15/01/2026 a 15/03/2026 = 59 dias.
  assert.ok(hojaPlazos.includes('<v>59</v>'), 'la duracion plan en dias debe salir del mismo calculo centralizado (59 dias)');
});

test('descargarLibro: Control de Plazos colorea el estado "Atrasada" con el mismo fill rojo (estilo 6) que ya usa la Carta Gantt', () => {
  const db = db_();
  const { p } = armarEscenario(db); // fecha_compromiso 2026, muy anterior al reloj real (2026-09-23) -- ambas quedan Atrasadas
  const res = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const hojaPlazos = hojaTexto_(res, 'xl/worksheets/sheet7.xml');
  assert.match(hojaPlazos, /s="6" t="inlineStr"><is><t xml:space="preserve">Atrasada<\/t>/, 'la celda de estado "Atrasada" debe llevar el fill rojo (estilo 6), igual que las barras de atraso de la Carta Gantt');
});

test('descargarLibro: Responsables agrupa por persona y suma total/completadas/en curso/atrasadas/carga relativa', () => {
  const db = db_();
  const { p } = armarEscenario(db); // 2 tareas, ambas de leo@rld.cl, ninguna terminada, ambas atrasadas
  const res = Libro.descargarLibro(db, { proyecto_id: p.proyecto_id }, CTX_LEO);
  const hojaResp = hojaTexto_(res, 'xl/worksheets/sheet8.xml');
  assert.ok(hojaResp.includes('leo@rld.cl'), 'falta el responsable');
  assert.ok(hojaResp.includes('<c r="B2"><v>2</v></c>'), 'Total tareas debe ser 2');
  assert.ok(hojaResp.includes('<c r="C2"><v>0</v></c>'), 'Completadas debe ser 0 (ninguna terminada en el escenario)');
  assert.ok(hojaResp.includes('<c r="D2"><v>2</v></c>'), 'En curso debe ser 2');
  assert.ok(hojaResp.includes('<c r="E2"><v>2</v></c>'), 'Atrasadas debe ser 2 (fecha_compromiso muy en el pasado)');
  assert.ok(hojaResp.includes('100%'), 'Carga relativa del único responsable del proyecto debe ser 100%');
});
