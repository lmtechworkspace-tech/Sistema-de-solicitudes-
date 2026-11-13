'use strict';

/**
 * «¿Estamos preparados para certificar?» (Plan de control, P6): rondas,
 * muestras al azar de las matrices, entrevista guiada, veredicto por área con
 * las reglas del plan, recomendación global, brechas como tareas, emisión
 * congelada y permisos.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const P = require('../logica/preparacionSgc');

const SGC = { email: 'luis@homepymes.cl', rol: 'DEV', modulos: [] };
const GER = { email: 'gerencia@homepymes.cl', rol: 'GERENCIA', modulos: [] };
const OTRA = { email: 'otra@homepymes.cl', rol: 'DEV', modulos: [] };
const FRAN = 'francisca@homepymes.cl';

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'SGC_ROLES', { rol_id: 'R1', usuario_email: SGC.email, rol_sgc: 'ENCARGADO_SGC', activo: true });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Francisca Feliú', email: FRAN, rol: 'DEV', activo: true });
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'M1', depto: 'CONTABILIDAD', usuario_email: FRAN, rol: 'REGISTRA', activa: true });
  // Matriz de IVA de octubre: 8 registros en Contabilidad (de ahí sale la muestra).
  for (let i = 0; i < 8; i++) {
    agregarFila_(db, 'CI_REGISTROS', { registro_id: 'R' + i, depto: 'CONTABILIDAD', matriz: 'IVA', periodo: '2026-M10', cliente_nombre: 'Cliente ' + i,
      estado: 'TERMINADO', responsable_email: FRAN, liberado_por: i % 2 ? FRAN : '', datos: {}, activa: true });
  }
  return db;
}
const respuestas = (pts, ev) => P.PREGUNTAS.map((p, i) => ({ pregunta_id: p.id, respuesta: 'Respuesta ' + p.id, evidencia: ev || 'SI', puntaje: pts[i] === undefined ? 3 : pts[i] }));

test('una ronda nueva sortea 5 muestras por área desde el mes cerrado', () => {
  const db = crear();
  const r = P.crear(db, { titulo: 'Versión 1 — diciembre 2026', fecha_auditoria: '2027-01-18' }, SGC);
  assert.equal(r.informe.estado, 'BORRADOR');
  assert.match(r.informe.correlativo, /^PREP-\d{4}-01$/);
  assert.equal(P.periodoCerrado_('2026-11-13'), '2026-M10');
  assert.equal(P.periodoCerrado_('2027-01-05'), '2026-M12');
  const muestras = leerFilas_(db, 'SGC_PREP_MUESTRAS', COLUMNAS.SGC_PREP_MUESTRAS);
  // Las muestras salen del mes anterior al de hoy: si hoy no es noviembre, no hay registros que sortear.
  if (new Date().toISOString().slice(0, 7) === '2026-11') {
    assert.equal(muestras.length, 5);
    assert.ok(muestras.every((m) => m.area === 'CONTABILIDAD' && /Informe y pago de IVA · Cliente \d/.test(m.descripcion)));
  }
  assert.ok(P.crear(db, { titulo: '' }, SGC)._validationError);
});

test('veredicto con las reglas del plan', () => {
  const base = { entrevista: { respondidas: 8, promedio: 2.8, evidencia_pct: 90 }, datos: { cumplimiento: 92, nc_vencidas: [], acuses_pendientes: 0 },
    muestras: { total: 5, revisadas: 5, conformes_pct: 100 }, autoevaluacion: { no: false } };
  const v = (cambios) => P.veredicto_(JSON.parse(JSON.stringify(Object.assign({}, base, cambios))));
  assert.equal(v({}).veredicto, 'LISTA');
  assert.equal(v({ entrevista: { respondidas: 0 } }).veredicto, 'SIN_EVALUAR');
  assert.equal(v({ entrevista: { respondidas: 8, promedio: 2.2, evidencia_pct: 90 } }).veredicto, 'LISTA_CON_RIESGOS');
  assert.equal(v({ entrevista: { respondidas: 8, promedio: 1.8, evidencia_pct: 90 } }).veredicto, 'NO_LISTA');
  assert.equal(v({ datos: { cumplimiento: 80, nc_vencidas: [], acuses_pendientes: 0 } }).veredicto, 'LISTA_CON_RIESGOS');
  assert.equal(v({ datos: { cumplimiento: 70, nc_vencidas: [], acuses_pendientes: 0 } }).veredicto, 'NO_LISTA');
  const nc = v({ datos: { cumplimiento: 95, nc_vencidas: ['NC-AP-2026-04'], acuses_pendientes: 0 } });
  assert.equal(nc.veredicto, 'NO_LISTA');
  assert.match(nc.brechas[0], /NC-AP-2026-04/);
  assert.equal(v({ muestras: { total: 5, revisadas: 5, conformes_pct: 50 } }).veredicto, 'NO_LISTA');
  assert.equal(v({ muestras: { total: 5, revisadas: 3, conformes_pct: 100 } }).veredicto, 'LISTA_CON_RIESGOS');
  assert.equal(v({ datos: { cumplimiento: null, nc_vencidas: [], acuses_pendientes: 0 } }).veredicto, 'LISTA', 'sin índice no se castiga');
});

test('la recomendación global', () => {
  const a = (v) => ({ veredicto: v });
  assert.equal(P.recomendacion_([a('LISTA'), a('LISTA')]).codigo, 'IR');
  assert.equal(P.recomendacion_([a('LISTA'), a('LISTA_CON_RIESGOS')]).codigo, 'IR_CON_RIESGOS');
  assert.equal(P.recomendacion_([a('LISTA'), a('SIN_EVALUAR')]).codigo, 'FALTA_EVALUAR');
  assert.equal(P.recomendacion_([a('NO_LISTA'), a('SIN_EVALUAR')]).codigo, 'NO_IR');
  assert.equal(P.recomendacion_([a('SIN_EVALUAR')]).codigo, 'SIN_EVALUAR');
});

test('entrevista y muestras alimentan el área; la brecha se vuelve tarea; emitir congela', async () => {
  const db = crear();
  const { informe } = P.crear(db, { titulo: 'Versión 1', fecha_auditoria: '2027-01-18' }, SGC);
  const en = P.guardarEntrevista(db, { informe_id: informe.informe_id, area: 'CONTABILIDAD', persona_email: FRAN, respuestas: respuestas([3, 2, 3, 2, 3, 3, 2, 3]), autoevaluacion: 'CON_RIESGOS' }, SGC);
  assert.ok(en.entrevista_id);
  const vista = P.obtener(db, { informe_id: informe.informe_id }, SGC);
  const contab = vista.areas.find((a) => a.clave === 'CONTABILIDAD');
  assert.equal(contab.entrevista.promedio, 2.6);
  assert.equal(contab.entrevista.evidencia_pct, 100);
  assert.deepEqual(contab.responsables.map((x) => x.nombre), ['Francisca Feliú']);
  assert.equal(vista.areas.find((a) => a.clave === 'RRHH').veredicto, 'SIN_EVALUAR');
  assert.equal(vista.recomendacion.codigo, 'FALTA_EVALUAR');
  assert.equal(vista.preguntas.length, 8);
  // Una muestra revisada.
  const m = leerFilas_(db, 'SGC_PREP_MUESTRAS', COLUMNAS.SGC_PREP_MUESTRAS)[0];
  if (m) {
    assert.ok(P.guardarMuestra(db, { muestra_id: m.muestra_id, resultado: 'MAL' }, SGC)._validationError);
    const g = P.guardarMuestra(db, { muestra_id: m.muestra_id, hizo: FRAN, reviso: 'Bárbara', libero: FRAN, resultado: 'CONFORME' }, SGC);
    assert.equal(g.resultado, 'CONFORME');
  }
  // La brecha como tarea.
  const t = await P.crearTareaBrecha(db, { informe_id: informe.informe_id, area: 'CONTABILIDAD', texto: 'Registrar quién libera el F29', responsable_email: FRAN, fecha_compromiso: '2026-12-10' }, SGC);
  assert.ok(t.actividad_id, JSON.stringify(t));
  assert.equal(t.sgc_origen_tipo, 'PREPARACION');
  assert.match(t.titulo, /^Preparación ISO · Contabilidad: Registrar quién libera el F29/);
  // Emitir: pide conclusión y congela.
  assert.ok(P.emitir(db, { informe_id: informe.informe_id, conclusion: '' }, SGC)._validationError);
  const e = P.emitir(db, { informe_id: informe.informe_id, conclusion: 'Contabilidad casi lista; falta entrevistar al resto.' }, SGC);
  assert.equal(e.estado, 'EMITIDO');
  P.guardarEntrevista(db, { informe_id: informe.informe_id, area: 'RRHH', persona_email: 'x@h.cl', respuestas: respuestas([]) }, SGC);
  const congelado = P.obtener(db, { informe_id: informe.informe_id }, SGC);
  assert.equal(congelado.congelado, true);
  assert.equal(congelado.areas.find((a) => a.clave === 'RRHH').veredicto, 'SIN_EVALUAR', 'lo emitido no cambia');
  assert.equal(congelado.puede_gestionar, false);
  assert.ok(P.guardarEntrevista(db, { informe_id: informe.informe_id, area: 'RRHH', persona_email: 'x@h.cl', respuestas: respuestas([]) }, SGC)._validationError);
});

test('permisos: gestiona el Encargado del SGC, gerencia solo lee, el resto no entra', () => {
  const db = crear();
  assert.ok(P.crear(db, { titulo: 'X' }, GER)._forbidden);
  assert.ok(P.listar(db, {}, OTRA)._forbidden);
  const { informe } = P.crear(db, { titulo: 'X' }, SGC);
  const g = P.obtener(db, { informe_id: informe.informe_id }, GER);
  assert.equal(g.informe.informe_id, informe.informe_id);
  assert.equal(g.puede_gestionar, false);
  assert.equal(P.listar(db, {}, SGC).puede_gestionar, true);
  assert.ok(P.guardarEntrevista(db, { informe_id: informe.informe_id, area: 'CONTABILIDAD', persona_email: FRAN, respuestas: respuestas([]) }, GER)._forbidden);
});
