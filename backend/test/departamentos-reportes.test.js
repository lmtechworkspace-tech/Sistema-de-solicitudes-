'use strict';

/**
 * Reporte mensual de los departamentos (2026-10-03): el área lo prepara, su
 * jefatura lo valida y Administración lo recibe, según el organigrama de
 * HomePymes. Se prueba el camino completo, las devoluciones, quién puede
 * cada paso y lo que SIGSO arma solo con el mes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const RD = require('../logica/departamentosReportes');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const p = (email) => ({ email, rol: 'DEV', modulos: [] });
const FRANCISCA = p('francisca@homepymes.cl');   // Contabilidad, registra
const BARBARA = p('barbara@homepymes.cl');       // Contabilidad, jefatura
const VANESSA = p('vanessa@homepymes.cl');       // RR.HH., registra (sin jefatura asignada)
const IGNACIO = p('ignacio@homepymes.cl');       // Marketing, jefatura y única persona
const LISSETH = p('lisseth@homepymes.cl');       // Administración, recibe
const DIRECTOR = p('rogelio@homepymes.cl');      // Administración, solo lectura
const PER = '2026-M09';

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CLI-1', razon_social: 'Constructora Andes SpA', rut: '76.111.111-1', codigo_cliente: 'HP-001', estado: 'ACTIVO', activo: true });
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }, { email: BARBARA.email, rol: 'JEFATURA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'RRHH', miembros: [{ email: VANESSA.email, rol: 'REGISTRA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'MARKETING', miembros: [{ email: IGNACIO.email, rol: 'JEFATURA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'ADMINISTRACION', miembros: [{ email: LISSETH.email, rol: 'REGISTRA' }, { email: DIRECTOR.email, rol: 'LECTURA' }] }, ADM);
  return db;
}
const CONTENIDO = {
  resumen: 'Se cerró el IVA de todos los clientes. Clave SII: abc12345',
  actividades: [{ cliente: 'Constructora Andes SpA', actividad: 'Declaración F29', fecha: '2026-09-20', estado: 'Terminado', observacion: '' }, { cliente: '', actividad: '', fecha: '', estado: '', observacion: '' }],
  indicadores: [{ indicador: 'F29 a tiempo', meta: '100 %', resultado: '100 %', comentario: '' }],
  dificultades: 'Ninguna', pendientes: 'Renta 2027', respaldos: 'Drive › Contabilidad › 2026-09'
};
function avisosDe(db, email) { return leerFilas_(db, 'NOTIFICACIONES_APP', COLUMNAS.NOTIFICACIONES_APP).filter((n) => n.destinatario_email === email && n.tipo === 'DEP_REPORTE'); }

test('el camino completo: área → jefatura (devuelve y valida) → Administración (recibe)', () => {
  const db = crear();
  // El mes todavía no tiene reporte: llega la plantilla para empezarlo.
  const vacio = RD.obtener(db, { depto: 'CONTABILIDAD', periodo: PER }, FRANCISCA);
  assert.equal(vacio.nuevo, true);
  assert.equal(vacio.reporte.estado, 'SIN_INICIAR');
  assert.equal(vacio.acciones.editar, true);

  const g = RD.guardar(db, { depto: 'CONTABILIDAD', periodo: PER, contenido: CONTENIDO }, FRANCISCA);
  assert.equal(g.ok, true, g.message);
  const id = g.reporte.reporte_id;
  assert.equal(g.reporte.estado, 'BORRADOR');
  // Un solo reporte MENSUAL por área y mes: guardar de nuevo usa el mismo.
  assert.equal(RD.guardar(db, { depto: 'CONTABILIDAD', periodo: PER, contenido: CONTENIDO }, FRANCISCA).reporte.reporte_id, id);
  const leido = RD.obtener(db, { reporte_id: id }, FRANCISCA);
  assert.equal(leido.contenido.resumen, 'Se cerró el IVA de todos los clientes. [clave omitida]', 'las claves nunca se guardan');
  assert.equal(leido.contenido.actividades.length, 1, 'las filas vacías no se guardan');

  // Donde no hay indicadores automáticos (Prevención), sin resumen no se envía.
  CI.guardarMiembros(db, { depto: 'PREVENCION', miembros: [{ email: 'amarlla@homepymes.cl', rol: 'REGISTRA' }, { email: 'camila@homepymes.cl', rol: 'JEFATURA' }] }, ADM);
  assert.match(RD.enviar(db, { depto: 'PREVENCION', periodo: PER, contenido: { resumen: '' } }, p('amarlla@homepymes.cl')).message, /resumen/);
  RD.guardar(db, { reporte_id: id, contenido: Object.assign({}, CONTENIDO, { resumen: '' }) }, FRANCISCA);
  const env = RD.enviar(db, { reporte_id: id, contenido: CONTENIDO }, FRANCISCA);
  assert.equal(env.reporte.estado, 'EN_REVISION', env.message);
  assert.equal(avisosDe(db, BARBARA.email).length, 1, 'le avisa a la jefatura');
  assert.match(RD.guardar(db, { reporte_id: id, contenido: CONTENIDO }, FRANCISCA).message, /ya se envió/);

  // Solo la jefatura valida o devuelve.
  assert.equal(RD.validar(db, { reporte_id: id }, FRANCISCA)._forbidden, true);
  assert.equal(RD.validar(db, { reporte_id: id }, LISSETH)._forbidden, true);
  assert.match(RD.devolver(db, { reporte_id: id }, BARBARA).message, /qué hay que corregir/);
  const dev = RD.devolver(db, { reporte_id: id, observacion: 'Falta el indicador de Renta.' }, BARBARA);
  assert.equal(dev.reporte.estado, 'OBSERVADO');
  assert.equal(avisosDe(db, FRANCISCA.email).length, 1, 'le avisa al área');
  assert.equal(RD.pendientes(db, {}, FRANCISCA).pendientes.dep_contabilidad, 1, 'el devuelto queda pendiente para el área');

  // El área corrige y reenvía; la jefatura valida.
  assert.equal(RD.enviar(db, { reporte_id: id, contenido: CONTENIDO }, FRANCISCA).reporte.estado, 'EN_REVISION');
  assert.equal(RD.pendientes(db, {}, BARBARA).pendientes.dep_contabilidad, 1);
  const val = RD.validar(db, { reporte_id: id, observacion: 'Conforme.' }, BARBARA);
  assert.equal(val.reporte.estado, 'VALIDADO');
  assert.equal(val.reporte.validado_por, BARBARA.email);
  assert.equal(avisosDe(db, LISSETH.email).length, 1, 'le llega a Administración');
  assert.equal(avisosDe(db, DIRECTOR.email).length, 0, 'solo lectura no recibe avisos');

  // Administración lo ve, el Director solo mira, Lisseth recibe.
  const pan = RD.panel(db, { periodo: PER }, LISSETH);
  assert.deepEqual(pan.areas.map((a) => [a.depto, a.estado]), [['CONTABILIDAD', 'VALIDADO'], ['RRHH', 'SIN_INICIAR'], ['PREVENCION', 'BORRADOR'], ['MARKETING', 'SIN_INICIAR']]);
  assert.equal(pan.por_recibir.length, 1);
  assert.equal(pan.puede_recibir, true);
  assert.equal(RD.panel(db, { periodo: PER }, DIRECTOR).puede_recibir, false);
  assert.equal(RD.recibir(db, { reporte_id: id }, DIRECTOR)._forbidden, true);
  assert.equal(RD.panel(db, { periodo: PER }, FRANCISCA)._forbidden, true, 'las áreas no ven el panel de Administración');
  assert.equal(RD.pendientes(db, {}, LISSETH).pendientes.dep_administracion, 1);
  const rec = RD.recibir(db, { reporte_id: id, observacion: 'Gracias.' }, LISSETH);
  assert.equal(rec.reporte.estado, 'RECIBIDO');
  assert.equal(RD.pendientes(db, {}, LISSETH).pendientes.dep_administracion, 0);

  // El historial cuenta el camino completo.
  const h = RD.obtener(db, { reporte_id: id }, LISSETH).historial.map((x) => x.accion);
  assert.deepEqual(h, ['REPORTE_CREADO', 'REPORTE_EDITADO', 'REPORTE_EDITADO', 'REPORTE_ENVIADO', 'REPORTE_DEVUELTO', 'REPORTE_ENVIADO', 'REPORTE_VALIDADO', 'REPORTE_RECIBIDO']);
});

test('la jefatura que envía su propio reporte lo deja validado; sin jefatura no se envía', () => {
  const db = crear();
  const mk = RD.enviar(db, { depto: 'MARKETING', periodo: PER, contenido: CONTENIDO }, IGNACIO);
  assert.equal(mk.ok, true, mk.message);
  assert.equal(mk.reporte.estado, 'VALIDADO');
  assert.equal(avisosDe(db, LISSETH.email).length, 1);
  assert.match(RD.obtener(db, { reporte_id: mk.reporte.reporte_id }, IGNACIO).historial.pop().detalle, /jefatura del área/);
  // RR.HH. todavía sin jefatura: se pide asignarla antes de enviar.
  const rh = RD.enviar(db, { depto: 'RRHH', periodo: PER, contenido: CONTENIDO }, VANESSA);
  assert.match(rh.message, /no tiene jefatura asignada/);
  assert.equal(RD.obtener(db, { depto: 'RRHH', periodo: PER }, VANESSA).reporte.estado, 'BORRADOR', 'lo escrito queda guardado');
});

test('Administración puede devolverlo al área; cada área ve solo lo suyo', () => {
  const db = crear();
  const id = RD.enviar(db, { depto: 'CONTABILIDAD', periodo: PER, contenido: CONTENIDO }, FRANCISCA).reporte.reporte_id;
  RD.validar(db, { reporte_id: id }, BARBARA);
  assert.equal(RD.devolver(db, { reporte_id: id, observacion: 'x' }, BARBARA)._forbidden, true, 'ya validado: la jefatura no lo devuelve');
  const d = RD.devolver(db, { reporte_id: id, observacion: 'Adjunta el respaldo del F29.' }, LISSETH);
  assert.equal(d.reporte.estado, 'OBSERVADO');
  assert.equal(d.reporte.devuelto_por, LISSETH.email);
  assert.ok(avisosDe(db, BARBARA.email).length >= 2, 'a la jefatura también le avisa');
  // Otras áreas no lo ven; Administración sí.
  assert.equal(RD.obtener(db, { reporte_id: id }, VANESSA)._forbidden, true);
  assert.equal(RD.listar(db, { depto: 'CONTABILIDAD' }, VANESSA)._forbidden, true);
  assert.equal(RD.listar(db, { depto: 'CONTABILIDAD', anio: '2026' }, LISSETH).reportes.length, 1);
  assert.equal(RD.guardar(db, { reporte_id: id, contenido: CONTENIDO }, LISSETH)._forbidden, true, 'Administración no escribe el reporte del área');
  // Extraordinarios: varios por mes, aparte del mensual.
  const ex = RD.guardar(db, { depto: 'CONTABILIDAD', periodo: PER, tipo: 'EXTRAORDINARIO', titulo: 'Fiscalización SII', contenido: CONTENIDO }, FRANCISCA);
  assert.notEqual(ex.reporte.reporte_id, id);
  assert.equal(RD.panel(db, { periodo: PER }, LISSETH).areas[0].extraordinarios.length, 1);
});

test('lo que SIGSO arma solo: matrices, tareas y solicitudes del mes; se congela al enviarlo', () => {
  const db = crear();
  const f = CI.guardar(db, { matriz: 'IVA', periodo: PER, cliente_id: 'CLI-1', datos: { monto_pago: 1000 } }, FRANCISCA);
  assert.equal(f.ok, true, f.message);
  agregarFila_(db, 'ACTIVIDADES', { actividad_id: 'A1', titulo: 'Cerrar IVA de septiembre', responsable_email: FRANCISCA.email, estado: 'TERMINADA', fecha_terminada: '2026-09-25T15:00:00Z', activa: true });
  agregarFila_(db, 'ACTIVIDADES', { actividad_id: 'A2', titulo: 'Renta', responsable_email: FRANCISCA.email, estado: 'EN_CURSO', fecha_compromiso: '2026-01-10', activa: true });
  agregarFila_(db, 'ACTIVIDADES', { actividad_id: 'A3', titulo: 'De otra área', responsable_email: VANESSA.email, estado: 'TERMINADA', fecha_terminada: '2026-09-02', activa: true });
  const a = RD.obtener(db, { depto: 'CONTABILIDAD', periodo: PER }, FRANCISCA).auto;
  assert.deepEqual(a.matrices.map((m) => [m.clave, m.total]), [['IVA', 1]]);
  assert.equal(a.tareas.terminadas, 1);
  assert.equal(a.tareas.abiertas, 1);
  assert.equal(a.tareas.atrasadas, 1);
  assert.equal(a.tareas.lista[0].titulo, 'Cerrar IVA de septiembre');
  // Al enviarlo queda congelado: lo que pase después no cambia lo validado.
  const id = RD.enviar(db, { depto: 'CONTABILIDAD', periodo: PER, contenido: CONTENIDO }, FRANCISCA).reporte.reporte_id;
  agregarFila_(db, 'ACTIVIDADES', { actividad_id: 'A4', titulo: 'Tardía', responsable_email: FRANCISCA.email, estado: 'TERMINADA', fecha_terminada: '2026-09-30', activa: true });
  const o = RD.obtener(db, { reporte_id: id }, BARBARA);
  assert.equal(o.congelado, true);
  assert.equal(o.auto.tareas.terminadas, 1);
});

test('el organigrama arma los equipos: la jefatura del área tiene a cargo a quienes registran en ella', () => {
  const db = crear();
  const Jefatura = require('../logica/jefatura');
  const Portal = require('../logica/portal');
  // Contabilidad: Bárbara (jefatura) tiene a Francisca; nadie más.
  assert.deepEqual(Jefatura.obtenerEquipoJefe_(db, BARBARA.email), [FRANCISCA.email]);
  assert.equal(Jefatura.jefeDeSubordinado_(db, FRANCISCA.email), BARBARA.email);
  // Quien solo lee no queda a cargo de nadie; Administración no tiene jefatura en este ejemplo.
  assert.equal(Jefatura.jefeDeSubordinado_(db, DIRECTOR.email), '');
  assert.deepEqual(Jefatura.obtenerEquipoJefe_(db, IGNACIO.email), [], 'Marketing es una sola persona');
  // Se suma a la relación de Administración › Jefaturas, sin repetir.
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'J1', jefe_email: BARBARA.email, subordinado_email: 'externo@homepymes.cl', activo: true });
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'J2', jefe_email: BARBARA.email, subordinado_email: FRANCISCA.email, activo: true });
  assert.deepEqual(Jefatura.obtenerEquipoJefe_(db, BARBARA.email).sort(), ['externo@homepymes.cl', FRANCISCA.email].sort());
  // La sesión dice dónde es jefatura (su "Mi equipo" vive dentro del área).
  const cuenta = (e) => ({ cuenta_id: 'X', emails: JSON.stringify([e]), rol: 'DEV', modulos: '[]' });
  assert.deepEqual(Portal.perfilPublico(cuenta(BARBARA.email), db).jefatura_de, ['dep_contabilidad']);
  assert.deepEqual(Portal.perfilPublico(cuenta(FRANCISCA.email), db).jefatura_de, []);
  // "Mi equipo" (el panel de la jefatura) ya trae a Francisca.
  const MiEquipo = require('../logica/miEquipo');
  assert.ok(MiEquipo.getMiEquipo(db, {}, BARBARA).equipo.map((e) => String(e).toLowerCase()).indexOf(FRANCISCA.email) !== -1);
});
