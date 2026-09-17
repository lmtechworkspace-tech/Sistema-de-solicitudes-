'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 Fase 3a (PRO-06, no conformidades) --
 * mismos escenarios de no-conformidades.test.js, corridos contra
 * backend/logica/noConformidadesSgc.js. Sin adaptaciones de R2: este modulo
 * no toca archivos, todo el ciclo (correccion/causa/accion/eficacia) es
 * texto + una ACTIVIDAD real, así que se porta 1:1.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Actividades = require('../logica/actividades');
const NoConformidades = require('../logica/noConformidadesSgc');
const Resend = require('../logica/resend');

function conMockCorreo(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'x' }));
  t.after(() => { delete process.env.RESEND_API_KEY; });
  return mock;
}

const TABLAS = [
  'SGC_NC', 'SGC_ROLES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS',
  'CONFIG_FERIADOS', 'LOG_SISTEMA', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP',
  'CONFIG_NOTIFICACIONES', 'CAT_AREAS'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

const CTX_SGC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_RESP = { email: 'resp@homepymes.cl', nombre: 'Responsable', rol: 'DEV' };
const CTX_AJENO = { email: 'ajeno@homepymes.cl', nombre: 'Ajeno', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

function sembrar(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'resp@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ADM);
}

function crearNc(db, overrides) {
  return NoConformidades.crear(db, Object.assign({
    descripcion: 'Se entregaron liquidaciones fuera del plazo comprometido.',
    fuente: 'PROCESO',
    responsable_email: 'resp@homepymes.cl',
    area_id: 'RRHH'
  }, overrides), CTX_SGC);
}

// --- la decision central: correccion y AC son ACTIVIDADES ------------------

test('la correccion se crea como ACTIVIDAD real, asignada al responsable', async () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);

  const actualizada = await NoConformidades.registrarCorreccion(db, {
    nc_id: nc.nc_id, descripcion: 'Reenviar las liquidaciones pendientes hoy mismo.'
  }, CTX_SGC);
  assert.ok(actualizada.correccion_actividad_id, 'debe quedar vinculada a una actividad');
  assert.equal(actualizada.estado, 'EN_CORRECCION');

  const tarea = filas(db, 'ACTIVIDADES').filter((a) => a.actividad_id === actualizada.correccion_actividad_id)[0];
  assert.ok(tarea, 'la actividad debe existir en ACTIVIDADES');
  assert.equal(tarea.responsable_email, 'resp@homepymes.cl');
  assert.equal(tarea.sgc_origen_tipo, 'NC_CORRECCION');
  assert.equal(tarea.sgc_origen_id, nc.nc_id);
  assert.ok(tarea.titulo.indexOf(nc.correlativo) !== -1, 'el titulo debe identificar la NC');
});

test('el responsable la ve en "Mi trabajo" y puede hacer check-in como con cualquier tarea', async () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);
  const conCorreccion = await NoConformidades.registrarCorreccion(db, {
    nc_id: nc.nc_id, descripcion: 'Reenviar liquidaciones.'
  }, CTX_SGC);

  const mias = Actividades.listar(db, {}, CTX_RESP);
  const lista = mias.actividades || mias;
  assert.ok(lista.some((a) => a.actividad_id === conCorreccion.correccion_actividad_id),
    'la correccion debe aparecer en Mi trabajo del responsable');

  const avanzada = Actividades.checkin(db, {
    actividad_id: conCorreccion.correccion_actividad_id, tipo: 'avance', avance_pct: 50
  }, CTX_RESP);
  assert.equal(avanzada.estado, 'EN_CURSO');
  assert.equal(avanzada.avance_pct, 50);
});

test('el detalle de la NC refleja el estado REAL de la actividad, no una copia', async () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);
  const conC = await NoConformidades.registrarCorreccion(db, { nc_id: nc.nc_id, descripcion: 'Reenviar.' }, CTX_SGC);

  Actividades.checkin(db, { actividad_id: conC.correccion_actividad_id, tipo: 'listo' }, CTX_RESP);

  const detalle = NoConformidades.getDetalle(db, { nc_id: nc.nc_id }, CTX_SGC);
  assert.equal(detalle.correccion_actividad.terminada, true);
  assert.equal(detalle.resumen.correccion_terminada, true);
});

// --- el orden del ciclo ----------------------------------------------------

test('sin causa raiz no se puede definir la accion correctiva', async () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);

  const sinCausa = await NoConformidades.registrarAccion(db, { nc_id: nc.nc_id, descripcion: 'Cambiar el procedimiento.' }, CTX_SGC);
  assert.equal(sinCausa._validationError, true);

  NoConformidades.registrarCausa(db, {
    nc_id: nc.nc_id, porque_1: 'No se reviso el calendario de cierre.',
    causa_raiz: 'No hay un control de plazos antes del cierre mensual.'
  }, CTX_SGC);

  const conCausa = await NoConformidades.registrarAccion(db, { nc_id: nc.nc_id, descripcion: 'Incorporar checklist de plazos al cierre mensual.' }, CTX_SGC);
  assert.ok(conCausa.accion_actividad_id);
  assert.equal(conCausa.estado, 'EN_ACCION');
});

test('el analisis de causa exige el primer por que y la causa raiz', () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);
  assert.equal(NoConformidades.registrarCausa(db, { nc_id: nc.nc_id, causa_raiz: 'Algo' }, CTX_SGC)._validationError, true);
  assert.equal(NoConformidades.registrarCausa(db, { nc_id: nc.nc_id, porque_1: 'Algo' }, CTX_SGC)._validationError, true);
});

test('la accion correctiva tambien es una ACTIVIDAD, con su propio origen', async () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);
  NoConformidades.registrarCausa(db, { nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Falta control de plazos.' }, CTX_SGC);
  const conAccion = await NoConformidades.registrarAccion(db, { nc_id: nc.nc_id, descripcion: 'Checklist de plazos.' }, CTX_SGC);

  const tarea = filas(db, 'ACTIVIDADES').filter((a) => a.actividad_id === conAccion.accion_actividad_id)[0];
  assert.equal(tarea.sgc_origen_tipo, 'NC_ACCION');
  assert.equal(tarea.sgc_origen_id, nc.nc_id);
  assert.equal(tarea.prioridad, 'P2');
});

// --- eficacia y reapertura --------------------------------------------------

test('eficacia positiva cierra la NC; exige explicar como se verifico', async () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);
  NoConformidades.registrarCausa(db, { nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Y' }, CTX_SGC);
  await NoConformidades.registrarAccion(db, { nc_id: nc.nc_id, descripcion: 'Accion.' }, CTX_SGC);

  assert.equal(NoConformidades.verificarEficacia(db, { nc_id: nc.nc_id, resultado: 'EFICAZ', observaciones: 'ok' }, CTX_SGC)._validationError, true);

  NoConformidades.cerrarEtapa(db, { nc_id: nc.nc_id, etapa: 'ACCION' }, CTX_SGC);

  assert.equal(NoConformidades.verificarEficacia(db, { nc_id: nc.nc_id, resultado: 'EFICAZ' }, CTX_SGC)._validationError, true);

  const cerrada = NoConformidades.verificarEficacia(db, {
    nc_id: nc.nc_id, resultado: 'EFICAZ', observaciones: 'Se revisaron los cierres de 2 meses siguientes: sin atrasos.'
  }, CTX_SGC);
  assert.equal(cerrada.estado, 'CERRADA');
  assert.ok(cerrada.fecha_cierre);
});

test('eficacia negativa REABRE con un ciclo nuevo en vez de cerrar', async () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);
  NoConformidades.registrarCausa(db, { nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Y' }, CTX_SGC);
  await NoConformidades.registrarAccion(db, { nc_id: nc.nc_id, descripcion: 'Primer intento.' }, CTX_SGC);
  NoConformidades.cerrarEtapa(db, { nc_id: nc.nc_id, etapa: 'ACCION' }, CTX_SGC);

  const reabierta = NoConformidades.verificarEficacia(db, {
    nc_id: nc.nc_id, resultado: 'NO_EFICAZ', observaciones: 'Volvio a ocurrir en el cierre siguiente.'
  }, CTX_SGC);
  assert.equal(reabierta.estado, 'EN_ACCION');
  assert.equal(reabierta.ciclo, 2);
  assert.equal(reabierta.accion_actividad_id, '');

  const segundoIntento = await NoConformidades.registrarAccion(db, { nc_id: nc.nc_id, descripcion: 'Segundo intento, con control automatico.' }, CTX_SGC);
  assert.ok(segundoIntento.accion_actividad_id);
  const tareas = filas(db, 'ACTIVIDADES').filter((a) => a.sgc_origen_id === nc.nc_id);
  assert.equal(tareas.filter((a) => a.sgc_origen_tipo === 'NC_ACCION').length, 2);
});

// --- plazos en dias habiles -------------------------------------------------

test('los plazos son en DIAS HABILES y saltan fin de semana', () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db, { fecha_deteccion: '2026-08-07T12:00:00.000Z' });
  const plazo = new Date(nc.correccion_plazo);
  assert.equal(plazo.toISOString().slice(0, 10), '2026-08-21');
});

test('los feriados configurados tambien corren el plazo', () => {
  const db = db_();
  sembrar(db);
  agregarFila_(db, 'CONFIG_FERIADOS', { fecha: '2026-08-10', nombre: 'Feriado de prueba', anio: 2026 });
  const nc = crearNc(db, { fecha_deteccion: '2026-08-07T12:00:00.000Z' });
  assert.equal(new Date(nc.correccion_plazo).toISOString().slice(0, 10), '2026-08-24');
});

test('el plazo de la eficacia arranca cuando se implementa la accion, no antes', async () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);
  NoConformidades.registrarCausa(db, { nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Y' }, CTX_SGC);
  await NoConformidades.registrarAccion(db, { nc_id: nc.nc_id, descripcion: 'A.' }, CTX_SGC);

  const antes = NoConformidades.getDetalle(db, { nc_id: nc.nc_id }, CTX_SGC).nc;
  assert.equal(antes.eficacia_plazo, '');

  const cerrada = NoConformidades.cerrarEtapa(db, { nc_id: nc.nc_id, etapa: 'ACCION', fecha: '2026-08-07T12:00:00.000Z' }, CTX_SGC);
  assert.ok(cerrada.eficacia_plazo);
  assert.equal(cerrada.estado, 'EN_VERIFICACION');
});

// --- correlativo, permisos y trazabilidad -----------------------------------

test('el correlativo es legible y correlativo por ano', () => {
  const db = db_();
  sembrar(db);
  const a = crearNc(db, { fecha_deteccion: '2026-03-01T12:00:00.000Z' });
  const b = crearNc(db, { fecha_deteccion: '2026-04-01T12:00:00.000Z' });
  assert.equal(a.correlativo, 'NC-2026-001');
  assert.equal(b.correlativo, 'NC-2026-002');
});

test('solo el Encargado SGC o ADM registran y gestionan no conformidades', async () => {
  const db = db_();
  sembrar(db);
  assert.equal(NoConformidades.crear(db, { descripcion: 'X', fuente: 'PROCESO', responsable_email: 'resp@homepymes.cl' }, CTX_RESP)._forbidden, true);

  const nc = crearNc(db);
  assert.equal((await NoConformidades.registrarCorreccion(db, { nc_id: nc.nc_id, descripcion: 'X' }, CTX_RESP))._forbidden, true);
});

test('el responsable ve SU no conformidad; alguien ajeno no', () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);

  assert.ok(NoConformidades.getDetalle(db, { nc_id: nc.nc_id }, CTX_RESP).nc);
  assert.equal(NoConformidades.getDetalle(db, { nc_id: nc.nc_id }, CTX_AJENO)._forbidden, true);
  assert.equal(NoConformidades.listar(db, {}, CTX_AJENO).no_conformidades.length, 0);
  assert.equal(NoConformidades.listar(db, {}, CTX_RESP).no_conformidades.length, 1);
});

test('anular exige motivo y NO borra la fila', () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);
  assert.equal(NoConformidades.anular(db, { nc_id: nc.nc_id }, CTX_SGC)._validationError, true);

  const anulada = NoConformidades.anular(db, { nc_id: nc.nc_id, motivo: 'Duplicada de NC-2026-001.' }, CTX_SGC);
  assert.equal(anulada.estado, 'ANULADA');
  assert.equal(filas(db, 'SGC_NC').length, 1);
});

test('crear exige descripcion, fuente valida y responsable', () => {
  const db = db_();
  sembrar(db);
  assert.equal(NoConformidades.crear(db, { fuente: 'PROCESO', responsable_email: 'a@b.cl' }, CTX_SGC)._validationError, true);
  assert.equal(NoConformidades.crear(db, { descripcion: 'X', fuente: 'INVENTADA', responsable_email: 'a@b.cl' }, CTX_SGC)._validationError, true);
  assert.equal(NoConformidades.crear(db, { descripcion: 'X', fuente: 'PROCESO' }, CTX_SGC)._validationError, true);
});

// --- referencia normativa ----------------------------------------------------

test('referencia_normativa es opcional al crear una NC manual', () => {
  const db = db_();
  sembrar(db);
  const sinRef = crearNc(db);
  assert.equal(sinRef.referencia_normativa, '');
  const conRef = crearNc(db, { referencia_normativa: '7.5' });
  assert.equal(conRef.referencia_normativa, '7.5');
});

test('referencia_normativa se puede completar o corregir al registrar la causa', () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);
  const actualizada = NoConformidades.registrarCausa(db, { nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Y', referencia_normativa: '8.5' }, CTX_SGC);
  assert.equal(actualizada.referencia_normativa, '8.5');
});

test('el resumen y el detalle de la NC muestran la referencia normativa', () => {
  const db = db_();
  sembrar(db);
  crearNc(db, { referencia_normativa: '7.2' });
  const listado = NoConformidades.listar(db, {}, CTX_SGC);
  assert.equal(listado.no_conformidades[0].referencia_normativa, '7.2');
});

// --- indicadores -------------------------------------------------------------

test('los indicadores cuentan abiertas, cerradas, vencidas y % de eficacia', async () => {
  const db = db_();
  sembrar(db);
  const ok = crearNc(db);
  NoConformidades.registrarCausa(db, { nc_id: ok.nc_id, porque_1: 'X', causa_raiz: 'Y' }, CTX_SGC);
  await NoConformidades.registrarAccion(db, { nc_id: ok.nc_id, descripcion: 'A.' }, CTX_SGC);
  NoConformidades.cerrarEtapa(db, { nc_id: ok.nc_id, etapa: 'ACCION' }, CTX_SGC);
  NoConformidades.verificarEficacia(db, { nc_id: ok.nc_id, resultado: 'EFICAZ', observaciones: 'Verificado.' }, CTX_SGC);
  crearNc(db, { descripcion: 'Vieja sin resolver', fecha_deteccion: '2020-01-01T00:00:00.000Z' });

  const ind = NoConformidades.listar(db, {}, CTX_SGC).indicadores;
  assert.equal(ind.cerradas, 1);
  assert.equal(ind.abiertas, 1);
  assert.equal(ind.vencidas, 1);
  assert.equal(ind.pct_eficacia_positiva, 100);
  assert.ok(ind.dias_promedio_resolucion !== null);
});

test('el % de eficacia cuenta verificaciones, no NC: cerrar al segundo intento da 50%', async () => {
  const db = db_();
  sembrar(db);
  const nc = crearNc(db);
  NoConformidades.registrarCausa(db, { nc_id: nc.nc_id, porque_1: 'X', causa_raiz: 'Y' }, CTX_SGC);

  async function intentar(descripcion, resultado) {
    await NoConformidades.registrarAccion(db, { nc_id: nc.nc_id, descripcion }, CTX_SGC);
    NoConformidades.cerrarEtapa(db, { nc_id: nc.nc_id, etapa: 'ACCION' }, CTX_SGC);
    return NoConformidades.verificarEficacia(db, { nc_id: nc.nc_id, resultado, observaciones: 'Revisado.' }, CTX_SGC);
  }
  await intentar('Charla al equipo.', 'NO_EFICAZ');
  await intentar('Bloqueo en el sistema.', 'EFICAZ');

  const ind = NoConformidades.listar(db, {}, CTX_SGC).indicadores;
  assert.equal(ind.pct_eficacia_positiva, 50);
  assert.equal(ind.cerradas, 1);
});

// --- avisos con escalado ----------------------------------------------------

test('aviso de vencida: llega al responsable y al Encargado SGC, agrupado', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  crearNc(db, { fecha_deteccion: '2020-01-01T00:00:00.000Z' });
  crearNc(db, { descripcion: 'Otra vieja', fecha_deteccion: '2020-02-01T00:00:00.000Z' });

  const r = await NoConformidades.recordatorioVencidas(db);
  assert.ok(r.avisos >= 2);

  const correos = filas(db, 'LOG_NOTIFICACIONES').filter((l) => String(l.evento || '').indexOf('SGC_NC_VENCIDA') === 0);
  const alResponsable = correos.filter((c) => c.destinatario === 'resp@homepymes.cl');
  assert.equal(alResponsable.length, 1, 'UN correo con las dos, no uno por NC');
  assert.ok(correos.some((c) => c.destinatario === 'sgc@homepymes.cl'));
});

test('aviso de vencida: ESCALA a Direccion cuando lleva varios dias vencida', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  Calidad.gestionarRol(db, { usuario_email: 'director@homepymes.cl', rol_sgc: 'DIRECCION' }, CTX_ADM);
  crearNc(db, { fecha_deteccion: '2020-01-01T00:00:00.000Z' });

  const r = await NoConformidades.recordatorioVencidas(db);
  assert.ok(r.escaladas >= 1);
  const correos = filas(db, 'LOG_NOTIFICACIONES').filter((l) => String(l.evento || '').indexOf('SGC_NC_VENCIDA') === 0);
  assert.ok(correos.some((c) => c.destinatario === 'director@homepymes.cl'));
});

test('aviso de vencida: una NC dentro de plazo no genera nada', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  crearNc(db);
  const r = await NoConformidades.recordatorioVencidas(db);
  assert.equal(r.avisos, 0);
});

test('aviso de vencida: no se repite el mismo dia', async (t) => {
  conMockCorreo(t);
  const db = db_();
  sembrar(db);
  crearNc(db, { fecha_deteccion: '2020-01-01T00:00:00.000Z' });
  await NoConformidades.recordatorioVencidas(db);
  const primera = filas(db, 'LOG_NOTIFICACIONES').length;
  await NoConformidades.recordatorioVencidas(db);
  assert.equal(filas(db, 'LOG_NOTIFICACIONES').length, primera);
});
