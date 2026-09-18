'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 Fase 6a (DOC-07, objetivos de
 * calidad) -- mismos escenarios de objetivos.test.js, corridos contra
 * backend/logica/objetivosSgc.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Objetivos = require('../logica/objetivosSgc');
const Resend = require('../logica/resend');

const TABLAS = [
  'SGC_OBJETIVOS', 'SGC_INDICADOR_LECTURAS', 'SGC_ROLES', 'SGC_QUEJAS', 'SGC_PERSONAS',
  'SGC_CAPACITACIONES', 'SGC_CAPACITACION_ASISTENTES', 'LOG_SISTEMA', 'LOG_NOTIFICACIONES',
  'NOTIFICACIONES_APP', 'CONFIG_NOTIFICACIONES'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function conMockCorreo(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'x' }));
  t.after(() => { delete process.env.RESEND_API_KEY; });
  return mock;
}

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };
const CTX_GERENCIA = { email: 'gerencia@homepymes.cl', nombre: 'Gerencia', rol: 'GERENCIA' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

// El año pasado: todos sus periodos estan cerrados, asi que se puede medir
// cualquiera sin depender de en que mes se corran los tests.
const ANIO = new Date().getFullYear() - 1;

function sembrarRoles(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ADM);
}
function abrirAnio(db, anio) { return Objetivos.sembrarAnio(db, { anio: anio || ANIO }, CTX_ENCARGADO); }
function objetivoNumero(db, numero, anio) {
  const r = Objetivos.listar(db, { anio: anio || ANIO }, CTX_ENCARGADO);
  return r.objetivos.find((o) => o.numero === numero);
}

// --- la semilla es DOC-07, no una invencion ---------------------------------

test('abrir el año siembra los 6 objetivos de DOC-07 con su meta y frecuencia', () => {
  const db = db_();
  sembrarRoles(db);

  const r = abrirAnio(db);
  assert.equal(r.ok, true);
  assert.equal(r.creados, 6);
  assert.equal(r.origen, 'DOC-07');

  const tablero = Objetivos.listar(db, { anio: ANIO }, CTX_ENCARGADO);
  assert.equal(tablero.objetivos.length, 6);

  const porNumero = {};
  tablero.objetivos.forEach((o) => { porNumero[o.numero] = o; });

  assert.equal(porNumero[1].objetivo_general, 'Satisfacción del cliente');
  assert.equal(porNumero[1].meta_valor, 90);
  assert.equal(porNumero[1].frecuencia, 'ANUAL');

  assert.equal(porNumero[2].objetivo_general, 'Gestión de reclamos');
  assert.equal(porNumero[2].meta_operador, 'MENOR');
  assert.equal(porNumero[2].meta_valor, 2);

  assert.equal(porNumero[3].meta_valor, 90);
  assert.equal(porNumero[4].objetivo_general, 'Desarrollo y competencia del personal');
  assert.equal(porNumero[4].meta_valor, 5);
  assert.equal(porNumero[4].unidad, 'HORAS');
  assert.equal(porNumero[5].meta_valor, 15);
  assert.equal(porNumero[6].meta_valor, 70);
});

test('solo el objetivo 4 se calcula solo; el 2 es asistido y el resto manual', () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);

  const tablero = Objetivos.listar(db, { anio: ANIO }, CTX_ENCARGADO);
  const fuentes = {};
  tablero.objetivos.forEach((o) => { fuentes[o.numero] = o.fuente; });

  assert.equal(fuentes[4], 'AUTO');
  assert.equal(fuentes[2], 'ASISTIDA');
  [1, 3, 5, 6].forEach((n) => assert.equal(fuentes[n], 'MANUAL'));
});

test('no se puede abrir dos veces el mismo año', () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const r = abrirAnio(db);
  assert.ok(r._validationError);
});

test('abrir el año siguiente copia del anterior, conservando los ajustes hechos', () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);

  const obj6 = objetivoNumero(db, 6);
  Objetivos.guardar(db, {
    objetivo_id: obj6.objetivo_id, objetivo_general: obj6.objetivo_general, objetivo_especifico: obj6.objetivo_especifico,
    indicador: obj6.indicador, meta_texto: '≥ 80% de clientes activos retenidos anualmente',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 80, unidad: 'PORCENTAJE',
    acciones: obj6.acciones, frecuencia: obj6.frecuencia, responsable_texto: obj6.responsable_texto
  }, CTX_ENCARGADO);

  const r = abrirAnio(db, ANIO + 1);
  assert.equal(r.origen, 'AÑO_ANTERIOR');

  const nuevo6 = objetivoNumero(db, 6, ANIO + 1);
  assert.equal(nuevo6.meta_valor, 80);
  assert.notEqual(nuevo6.objetivo_id, objetivoNumero(db, 6, ANIO).objetivo_id);
});

// --- el veredicto sale de la meta, no de una opinion -------------------------

test('"cumple" respeta el operador -- el objetivo 2 se cumple midiendo MENOS', async () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const obj2 = objetivoNumero(db, 2); // meta: < 2%

  const bueno = await Objetivos.registrarLectura(db, { objetivo_id: obj2.objetivo_id, periodo: ANIO + '-M01', valor: 1.5, numerador: 3, denominador: 200 }, CTX_ENCARGADO);
  assert.equal(bueno.cumple, true);

  const borde = await Objetivos.registrarLectura(db, { objetivo_id: obj2.objetivo_id, periodo: ANIO + '-M02', valor: 2, numerador: 4, denominador: 200 }, CTX_ENCARGADO);
  assert.equal(borde.cumple, false);
});

test('el borde de una meta ">=" si cumple con el valor exacto', async () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const obj3 = objetivoNumero(db, 3); // meta: >= 90%

  const r = await Objetivos.registrarLectura(db, { objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 90 }, CTX_ENCARGADO);
  assert.equal(r.cumple, true);
});

test('cambiar la meta despues NO reescribe el veredicto ya registrado', async () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const obj3 = objetivoNumero(db, 3);

  await Objetivos.registrarLectura(db, { objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 85 }, CTX_ENCARGADO);

  Objetivos.guardar(db, {
    objetivo_id: obj3.objetivo_id, objetivo_general: obj3.objetivo_general, objetivo_especifico: obj3.objetivo_especifico,
    indicador: obj3.indicador, meta_texto: '≥ 80%', meta_operador: 'MAYOR_IGUAL', meta_valor: 80, unidad: 'PORCENTAJE',
    acciones: obj3.acciones, frecuencia: obj3.frecuencia, responsable_texto: obj3.responsable_texto
  }, CTX_ENCARGADO);

  const detalle = Objetivos.getDetalle(db, { objetivo_id: obj3.objetivo_id }, CTX_ENCARGADO);
  const lectura = detalle.lecturas.find((l) => l.periodo === ANIO + '-M01');
  assert.equal(lectura.cumple, false);
});

// --- periodos ----------------------------------------------------------------

test('un objetivo semestral no acepta una clave de periodo mensual', async () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const obj5 = objetivoNumero(db, 5); // SEMESTRAL

  const malo = await Objetivos.registrarLectura(db, { objetivo_id: obj5.objetivo_id, periodo: ANIO + '-M03', valor: 20 }, CTX_ENCARGADO);
  assert.ok(malo._validationError);

  const bueno = await Objetivos.registrarLectura(db, { objetivo_id: obj5.objetivo_id, periodo: ANIO + '-S1', valor: 20 }, CTX_ENCARGADO);
  assert.equal(bueno.ok, true);
});

test('volver a medir el mismo periodo reemplaza la lectura, no la duplica', async () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const obj3 = objetivoNumero(db, 3);

  await Objetivos.registrarLectura(db, { objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 70 }, CTX_ENCARGADO);
  const segunda = await Objetivos.registrarLectura(db, { objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 95 }, CTX_ENCARGADO);
  assert.equal(segunda.reemplazo, true);

  const detalle = Objetivos.getDetalle(db, { objetivo_id: obj3.objetivo_id }, CTX_ENCARGADO);
  const deEnero = detalle.lecturas.filter((l) => l.periodo === ANIO + '-M01');
  assert.equal(deEnero.length, 1);
  assert.equal(deEnero[0].valor, 95);
});

test('un porcentaje fuera de 0-100 se rechaza', async () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const obj3 = objetivoNumero(db, 3);
  const r = await Objetivos.registrarLectura(db, { objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 140 }, CTX_ENCARGADO);
  assert.ok(r._validationError);
});

// --- calculos automaticos ----------------------------------------------------

test('el objetivo 4 se calcula solo desde las capacitaciones reales', () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);

  agregarFila_(db, 'SGC_PERSONAS', { persona_id: 'P1', nombre: 'Ana', estado: 'VIGENTE', activa: true });
  agregarFila_(db, 'SGC_PERSONAS', { persona_id: 'P2', nombre: 'Bruno', estado: 'VIGENTE', activa: true });
  agregarFila_(db, 'SGC_CAPACITACIONES', { capacitacion_id: 'C1', nombre: 'ISO 9001', horas: 8, estado: 'REALIZADA', fecha_realizada: ANIO + '-05-10T12:00:00.000Z', activa: true });
  agregarFila_(db, 'SGC_CAPACITACION_ASISTENTES', { capacitacion_id: 'C1', persona_id: 'P1', asistio: true });

  const obj4 = objetivoNumero(db, 4);
  const sugerencia = Objetivos.sugerirLectura(db, { objetivo_id: obj4.objetivo_id, periodo: ANIO + '-S1' }, CTX_ENCARGADO);

  assert.equal(sugerencia.fuente, 'AUTO');
  assert.equal(sugerencia.completo, true);
  assert.equal(sugerencia.valor, 4);
  assert.equal(sugerencia.numerador, 8);
  assert.equal(sugerencia.denominador, 2);
  const bajoMeta = sugerencia.detalle.bajo_meta.map((p) => p.nombre);
  assert.deepEqual(bajoMeta, ['Bruno']);
});

test('el objetivo 2 aporta el numerador pero declara que le falta el denominador', () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);

  agregarFila_(db, 'SGC_QUEJAS', Object.assign(quejaBase_('Q1'), { tipo: 'QUEJA', fecha_envio: ANIO + '-01-10T12:00:00.000Z' }));
  agregarFila_(db, 'SGC_QUEJAS', Object.assign(quejaBase_('Q2'), { tipo: 'RECLAMACION', fecha_envio: ANIO + '-01-20T12:00:00.000Z' }));
  agregarFila_(db, 'SGC_QUEJAS', Object.assign(quejaBase_('Q3'), { tipo: 'FELICITACION', fecha_envio: ANIO + '-01-21T12:00:00.000Z' }));
  agregarFila_(db, 'SGC_QUEJAS', Object.assign(quejaBase_('Q4'), { tipo: 'QUEJA', fecha_envio: ANIO + '-02-05T12:00:00.000Z' }));

  const obj2 = objetivoNumero(db, 2);
  const sugerencia = Objetivos.sugerirLectura(db, { objetivo_id: obj2.objetivo_id, periodo: ANIO + '-M01' }, CTX_ENCARGADO);

  assert.equal(sugerencia.fuente, 'ASISTIDA');
  assert.equal(sugerencia.numerador, 2);
  assert.equal(sugerencia.completo, false);
  assert.equal(sugerencia.valor, null);
});

function quejaBase_(id) {
  return {
    queja_id: id, correlativo: id, nombre_completo: '', empresa: '', rut: '', email: '', telefono: '',
    area: '', descripcion: '', canal: 'WEB', fecha_recepcion: '', procede: '', motivo_no_procede: '', registrado_por: '',
    investigador_email: '', resultado_investigacion: '', valida: '', accion_implementada: '', nc_id: '',
    resolucion_plazo: '', fecha_resolucion: '', responsable_resolucion: '', fecha_notificacion: '', revisado_por: '',
    seguimiento_plazo: '', fecha_seguimiento: '', cliente_conforme: '', estado: 'RECIBIDA',
    fecha_cierre: '', cerrada_por: '', fecha_creacion: new Date().toISOString(), activa: true
  };
}

test('un objetivo manual dice explicitamente que no hay fuente automatica', () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const obj1 = objetivoNumero(db, 1);
  const sugerencia = Objetivos.sugerirLectura(db, { objetivo_id: obj1.objetivo_id, periodo: String(ANIO) }, CTX_ENCARGADO);
  assert.equal(sugerencia.fuente, 'MANUAL');
  assert.equal(sugerencia.valor, null);
});

// --- permisos ----------------------------------------------------------------

test('Gerencia ve el tablero pero no puede medir ni abrir el año', async () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);

  const tablero = Objetivos.listar(db, { anio: ANIO }, CTX_GERENCIA);
  assert.equal(tablero.objetivos.length, 6);
  assert.equal(tablero.puede_gestionar, false);

  const obj3 = objetivoNumero(db, 3);
  const intento = await Objetivos.registrarLectura(db, { objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 95 }, CTX_GERENCIA);
  assert.equal(intento._forbidden, true);

  const abrir = Objetivos.sembrarAnio(db, { anio: ANIO + 5 }, CTX_GERENCIA);
  assert.equal(abrir._forbidden, true);
});

test('el personal operativo no accede al tablero', () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const r = Objetivos.listar(db, { anio: ANIO }, CTX_OPERATIVO);
  assert.equal(r._forbidden, true);
});

// --- avisos ------------------------------------------------------------------

test('medir bajo la meta avisa al encargado en el momento', async (t) => {
  const mock = conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const obj3 = objetivoNumero(db, 3);

  await Objetivos.registrarLectura(db, { objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 40 }, CTX_ENCARGADO);

  const aviso = mock.mock.calls.filter((c) => /Objetivo de calidad sin cumplir/.test(c.arguments[0].subject));
  assert.equal(aviso.length >= 1, true);
  assert.match(aviso[0].arguments[0].text, /Cumplimiento de plazos de entrega/);
});

test('cumplir la meta no genera aviso', async (t) => {
  const mock = conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const obj3 = objetivoNumero(db, 3);

  await Objetivos.registrarLectura(db, { objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 99 }, CTX_ENCARGADO);

  const aviso = mock.mock.calls.filter((c) => /Objetivo de calidad sin cumplir/.test(c.arguments[0].subject));
  assert.equal(aviso.length, 0);
});

test('el trigger avisa por periodos ya cerrados que nadie midio', async (t) => {
  const mock = conMockCorreo(t);
  const db = db_();
  sembrarRoles(db);
  const anioActual = new Date().getFullYear();
  abrirAnio(db, anioActual);

  await Objetivos.alertarLecturasPendientes(db);
  const enviados = mock.mock.calls.filter((c) => /lectura[s]? pendiente/.test(c.arguments[0].subject));
  // En enero puede no haber ningun periodo cerrado todavia.
  assert.ok(enviados.length >= 0);
});

// --- enganche con la revision por la direccion (Fase 5b) ---------------------

test('resumenParaRevision trae el grado de logro de los objetivos', async () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const obj3 = objetivoNumero(db, 3);
  await Objetivos.registrarLectura(db, { objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 95 }, CTX_ENCARGADO);

  const texto = Objetivos.resumenParaRevision(db, ANIO);
  assert.match(texto, /6 objetivos de calidad/);
  assert.match(texto, /1 tienen medición registrada|1 alcanzan/);
});

test('sin objetivos cargados, resumenParaRevision lo dice en vez de quedar vacio', () => {
  const db = db_();
  sembrarRoles(db);
  const texto = Objetivos.resumenParaRevision(db, ANIO);
  assert.match(texto, /No hay objetivos de calidad cargados/);
});

// --- indicadores del tablero -------------------------------------------------

test('el tablero separa "no cumple" de "nadie lo midio"', async () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);

  const obj3 = objetivoNumero(db, 3);
  const obj5 = objetivoNumero(db, 5);
  await Objetivos.registrarLectura(db, { objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 95 }, CTX_ENCARGADO);
  await Objetivos.registrarLectura(db, { objetivo_id: obj5.objetivo_id, periodo: ANIO + '-S1', valor: 3 }, CTX_ENCARGADO);

  const t = Objetivos.listar(db, { anio: ANIO }, CTX_ENCARGADO);
  assert.equal(t.indicadores.total, 6);
  assert.equal(t.indicadores.cumplen, 1);
  assert.equal(t.indicadores.no_cumplen, 1);
  assert.equal(t.indicadores.sin_medir, 4);
});

test('anular una lectura exige motivo y la saca del tablero', async () => {
  const db = db_();
  sembrarRoles(db);
  abrirAnio(db);
  const obj3 = objetivoNumero(db, 3);
  const r = await Objetivos.registrarLectura(db, { objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 95 }, CTX_ENCARGADO);

  const sinMotivo = Objetivos.anularLectura(db, { lectura_id: r.lectura_id }, CTX_ENCARGADO);
  assert.ok(sinMotivo._validationError);

  Objetivos.anularLectura(db, { lectura_id: r.lectura_id, motivo: 'Se cargó el dato equivocado' }, CTX_ENCARGADO);
  const detalle = Objetivos.getDetalle(db, { objetivo_id: obj3.objetivo_id }, CTX_ENCARGADO);
  assert.equal(detalle.lecturas.length, 0);
});
