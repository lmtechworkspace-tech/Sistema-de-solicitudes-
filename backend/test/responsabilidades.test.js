'use strict';

/**
 * Mapa de responsabilidades (Plan de control, P2): propuesta desde el
 * descriptor, procesos y Agenda; edición y aprobación de la jefatura;
 * registro con evidencia por período; entrada al índice; permisos.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const R = require('../logica/responsabilidades');
const CR = require('../logica/cumplimientoResponsables');

const ANA = 'ana@homepymes.cl';
const JEFE = { email: 'jefa@homepymes.cl', rol: 'DEV', modulos: [] };
const OTRA = { email: 'otra@homepymes.cl', rol: 'DEV', modulos: [] };
const CTX_ANA = { email: ANA, rol: 'DEV', modulos: [] };

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Ana Pérez', email: ANA, rol: 'DEV', activo: true });
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'J1', jefe_email: JEFE.email, subordinado_email: ANA, activo: true });
  agregarFila_(db, 'SGC_PERSONAS', { persona_id: 'P1', usuario_email: ANA, nombre: 'Ana Pérez', cargo: 'Asistente de Contabilidad', estado: 'ACTIVO', activa: true });
  agregarFila_(db, 'SGC_DESCRIPTORES', { descriptor_id: 'D1', persona_id: 'P1', version: 1, vigente: true,
    items_responsabilidades: JSON.stringify(['Preparar el pre-IVA mensual de los clientes', 'Revisar cada semana las notificaciones del SII', 'Atender consultas cuando el cliente lo requiera']) });
  agregarFila_(db, 'SGC_PROCESOS', { proceso_id: 'PR1', codigo: 'PO-CONT-01', nombre: 'Contabilizaciones', responsable_email: ANA, estado: 'VIGENTE', activa: true });
  return db;
}

test('la frecuencia sale del texto y el período de cada frecuencia', () => {
  assert.equal(R.frecuenciaDelTexto_('Revisar cada semana las notificaciones'), 'SEMANAL');
  assert.equal(R.frecuenciaDelTexto_('Atender consultas cuando el cliente lo requiera'), 'EVENTUAL');
  assert.equal(R.frecuenciaDelTexto_('Preparar la Renta anual'), 'ANUAL');
  assert.equal(R.frecuenciaDelTexto_('Preparar el pre-IVA'), 'MENSUAL');
  assert.deepEqual(R.periodoDe_('SEMANAL', '2026-11-19'), { clave: 'S:2026-11-16', desde: '2026-11-16', hasta: '2026-11-22' });
  assert.deepEqual(R.periodoDe_('MENSUAL', '2026-11-19'), { clave: 'M:2026-11', desde: '2026-11-01', hasta: '2026-11-30' });
  assert.deepEqual(R.periodoDe_('TRIMESTRAL', '2026-11-19'), { clave: 'T:2026-4', desde: '2026-10-01', hasta: '2026-12-31' });
});

test('la jefatura genera la propuesta, la ajusta y la aprueba; la persona no edita', () => {
  const db = crear();
  assert.ok(R.proponer(db, { email: ANA }, CTX_ANA)._forbidden, 'la persona no arma su propio mapa');
  const p = R.proponer(db, { email: ANA }, JEFE);
  assert.equal(p.agregadas, 4, '3 del descriptor + 1 proceso');
  assert.equal(R.proponer(db, { email: ANA }, JEFE).agregadas, 0, 'no duplica al volver a generar');
  let m = R.listar(db, { email: ANA }, JEFE);
  assert.equal(m.resumen.propuestas, 4);
  assert.equal(m.puede_editar, true);
  const sem = m.items.find((i) => /notificaciones del SII/.test(i.texto));
  assert.equal(sem.frecuencia, 'SEMANAL');
  assert.equal(sem.origen_txt, 'Descriptor de cargo');
  assert.ok(m.items.some((i) => i.origen === 'PROCESO' && /PO-CONT-01 Contabilizaciones/.test(i.texto)));
  // Agregar una a mano y aprobar todo.
  R.guardar(db, { persona_email: ANA, texto: 'Ordenar la carpeta FACTURAS del Drive', frecuencia: 'MENSUAL', medicion: 'EVIDENCIA' }, JEFE);
  const a = R.aprobar(db, { email: ANA }, JEFE);
  assert.equal(a.aprobadas, 5);
  m = R.listar(db, {}, CTX_ANA);
  assert.equal(m.resumen.aprobadas, 5);
  assert.equal(m.es_propio, true);
  assert.equal(m.puede_editar, false);
  // Cambiar lo que se exige la devuelve a propuesta.
  const item = m.items.find((i) => /pre-IVA/.test(i.texto));
  const g = R.guardar(db, { resp_id: item.resp_id, frecuencia: 'SEMANAL' }, JEFE);
  assert.equal(g.estado, 'PROPUESTA');
  assert.ok(R.guardar(db, { resp_id: item.resp_id, frecuencia: 'CADA_TANTO' }, JEFE)._validationError);
});

test('la persona marca hecha con evidencia; entra al índice como responsabilidad del cargo', () => {
  const db = crear();
  R.proponer(db, { email: ANA }, JEFE);
  R.aprobar(db, { email: ANA }, JEFE);
  const m = R.listar(db, {}, CTX_ANA);
  const sem = m.items.find((i) => /notificaciones del SII/.test(i.texto));
  assert.equal(sem.periodo_actual.estado, 'PENDIENTE');
  assert.ok(R.registrar(db, { resp_id: sem.resp_id, evidencia: '' }, CTX_ANA)._validationError, 'sin respaldo no se marca');
  assert.ok(R.registrar(db, { resp_id: sem.resp_id, evidencia: 'x' }, JEFE)._forbidden, 'la marca la persona, no la jefatura');
  const reg = R.registrar(db, { resp_id: sem.resp_id, evidencia: 'https://drive.google.com/notificaciones-noviembre' }, CTX_ANA);
  assert.ok(reg.registro_id);
  const m2 = R.listar(db, {}, CTX_ANA);
  assert.equal(m2.items.find((i) => i.resp_id === sem.resp_id).periodo_actual.estado, 'HECHA');
  assert.equal(m2.resumen.hechas, 1);
  assert.equal(R.deshacer(db, { registro_id: reg.registro_id }, CTX_ANA).deshecho, true);
  // Índice: las semanales cuyo período terminó en el mes cuentan en el componente C.
  const aprobada = new Date().toISOString().slice(0, 10);
  const casos = R.casosIndice_(db, ANA, '2026-11-01', '2026-11-30', {}, '2026-12-05');
  const semanales = casos.filter((c) => /notificaciones del SII/.test(c.referencia));
  // Solo desde que se aprobó: si se aprobó en noviembre de 2026, cuentan las semanas que terminan desde ese día.
  assert.ok(semanales.every((c) => c.plazo >= aprobada.slice(0, 10) || aprobada > '2026-11-30'));
  assert.ok(casos.every((c) => c.tipo === 'Responsabilidad del cargo'));
  const r = CR.calcularPersona_(db, ANA, '2026-11', { hoy: '2026-12-05' });
  assert.equal(r.componentes.find((c) => c.clave === 'C').nombre, 'Responsabilidades del cargo y SGC');
});

test('índice: cada período cerrado en el mes es un caso; a tiempo si se marcó dentro del período', () => {
  const db = crear();
  agregarFila_(db, 'RESP_MAPA', { resp_id: 'RS', persona_email: ANA, texto: 'Revisar notificaciones', origen: 'MANUAL', frecuencia: 'SEMANAL', medicion: 'EVIDENCIA', estado: 'APROBADA', fecha_aprobacion: '2026-11-01T12:00:00.000Z', activa: true });
  agregarFila_(db, 'RESP_MAPA', { resp_id: 'RM', persona_email: ANA, texto: 'Ordenar carpeta', origen: 'MANUAL', frecuencia: 'MENSUAL', medicion: 'EVIDENCIA', estado: 'APROBADA', fecha_aprobacion: '2026-11-01T12:00:00.000Z', activa: true });
  agregarFila_(db, 'RESP_MAPA', { resp_id: 'RA', persona_email: ANA, texto: 'Pre-IVA', origen: 'AGENDA', frecuencia: 'MENSUAL', medicion: 'AUTOMATICA', estado: 'APROBADA', fecha_aprobacion: '2026-11-01T12:00:00.000Z', activa: true });
  agregarFila_(db, 'RESP_REGISTROS', { registro_id: 'G1', resp_id: 'RS', persona_email: ANA, periodo: 'S:2026-11-02', hecho_en: '2026-11-04T15:00:00.000Z', evidencia: 'x', activa: true });
  agregarFila_(db, 'RESP_REGISTROS', { registro_id: 'G2', resp_id: 'RM', persona_email: ANA, periodo: 'M:2026-11', hecho_en: '2026-12-02T15:00:00.000Z', evidencia: 'x', activa: true });
  const casos = R.casosIndice_(db, ANA, '2026-11-01', '2026-11-30', {}, '2026-12-05');
  // Semanas que terminan en noviembre (desde la aprobación): 1, 8, 15, 22 y 29 → 5; más el mes.
  assert.equal(casos.filter((c) => c.referencia === 'Revisar notificaciones').length, 5);
  assert.equal(casos.filter((c) => c.referencia === 'Revisar notificaciones' && c.ok).length, 1);
  const mes = casos.find((c) => c.referencia === 'Ordenar carpeta');
  assert.equal(mes.ok, false, 'marcada el 2 de diciembre: tarde');
  assert.ok(!casos.some((c) => c.referencia === 'Pre-IVA'), 'las automáticas no se duplican: ya las mide la Agenda');
  // El mes en curso: la semana que termina hoy todavía no es atraso.
  const enCurso = R.casosIndice_(db, ANA, '2026-11-01', '2026-11-22', {}, '2026-11-22');
  assert.ok(!enCurso.some((c) => c.plazo === '2026-11-22'));
});

test('quién ve qué: la persona lo suyo, la jefatura su equipo, la empresa Control/gerencia', () => {
  const db = crear();
  assert.ok(R.listar(db, { email: ANA }, OTRA)._forbidden);
  assert.ok(R.listar(db, { alcance: 'empresa' }, JEFE)._forbidden);
  const eq = R.listar(db, { alcance: 'equipo' }, JEFE);
  assert.deepEqual(eq.personas.map((p) => p.email), [ANA]);
  assert.equal(eq.resumen.sin_mapa, 1);
  const emp = R.listar(db, { alcance: 'empresa' }, { email: 'g@h.cl', rol: 'GERENCIA', modulos: [] });
  assert.ok(emp.personas.some((p) => p.email === ANA && p.cargo === 'Asistente de Contabilidad'));
});
