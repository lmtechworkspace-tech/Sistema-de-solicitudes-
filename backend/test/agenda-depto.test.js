'use strict';

/**
 * Agenda de los departamentos (2026-10-04): fechas en días hábiles, la
 * escalera de recordatorios con su mensaje listo, el registro de cada envío y
 * de la respuesta del cliente, tareas internas, fechas propias, ajustes por
 * la jefatura o el superusuario y las alertas de la mañana.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, actualizarFilaPorId_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const C = require('../logica/calidadDatos');
const A = require('../logica/agendaDepto');
const { PROPUESTA } = require('../logica/agendaPropuesta');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const p = (email) => ({ email, rol: 'DEV', modulos: [] });
const FRANCISCA = p('francisca@homepymes.cl'), BARBARA = p('barbara@homepymes.cl'), ROGELIO = p('rogelio@homepymes.cl'), LUIS = p('luis@homepymes.cl');
const SUPER = { email: 'super@homepymes.cl', rol: 'DEV', modulos: [], super_admin: true };

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  C.asegurarFeriados_(db);
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }, { email: BARBARA.email, rol: 'JEFATURA' }, { email: ROGELIO.email, rol: 'LECTURA' }] }, ADM);
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'C1', razon_social: 'Panadería Sol SpA', contacto: 'MARÍA PÉREZ', telefono: '+56 9 8765 4321', correo: 'maria@sol.cl', activo: true });
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'C2', razon_social: 'Ferretería Norte', contacto: '', telefono: '87654321', correo: '', activo: true });
  // IVA de septiembre (vence el martes 20 de octubre): C1 debe $500.000; C2 ya pagó; C3 no tiene monto.
  const iva = (id, cli, nombre, datos) => agregarFila_(db, 'CI_REGISTROS', { registro_id: id, depto: 'CONTABILIDAD', matriz: 'IVA', periodo: '2026-M09', cliente_id: cli, cliente_nombre: nombre, datos, estado: 'PENDIENTE', activa: true });
  iva('I1', 'C1', 'Panadería Sol SpA', { monto_pago: '5.0E5' });
  iva('I2', 'C2', 'Ferretería Norte', { monto_pago: 120000, fecha_pago: '2026-10-05' });
  iva('I3', 'C3', 'Otra', { monto_pago: 0 });
  return db;
}
const grupo = (h, clave) => h.grupos.find((g) => g.clave === clave);
const obl = (db, clave) => A.obligaciones_(db, null, true).find((o) => o.clave === clave);

test('fechas: vencimiento hábil, escalones en días hábiles y feriados', () => {
  const db = crear();
  const fer = new Set(leerFilas_(db, 'CONFIG_FERIADOS', COLUMNAS.CONFIG_FERIADOS).map((f) => String(f.fecha).slice(0, 10)));
  const regla = { tipo: 'mensual', mes: 1, dia: 20, habil: true };
  assert.equal(A.fechaLimite_(regla, '2026-M08', fer), '2026-09-21', 'el 20-sep-2026 es domingo');
  assert.equal(A.fechaLimite_(regla, '2026-M09', fer), '2026-10-20');
  assert.equal(A.sumarHabiles_('2026-10-20', -5, fer), '2026-10-13', 'salta el feriado del 12 de octubre');
  assert.equal(A.sumarHabiles_('2026-10-20', 1, fer), '2026-10-21');
  assert.equal(A.fechaLimite_({ tipo: 'mensual', mes: 0, dia: 'ultimo', habil: true }, '2026-M10', fer), '2026-10-30', 'el 31-oct-2026 es sábado');
  assert.equal(A.fechaLimite_({ tipo: 'mensual', mes: 1, dia: 13, habil: false }, '2026-M09', fer), '2026-10-13');
  assert.equal(A.fechaLimite_({ tipo: 'anual', mes: 4, dia: 30, habil: true }, '2027-M04', fer), '2027-04-30');
  assert.equal(A.habilesEntre_('2026-10-13', '2026-10-20', fer), 5);
  assert.equal(A.telefono_('+56 9 8765 4321'), '56987654321');
  assert.equal(A.telefono_('87654321'), '56987654321');
  assert.equal(A.telefono_('987654321'), '56987654321');
  assert.equal(A.telefono_(''), '');
});

test('la propuesta se carga una vez y nunca pisa lo editado', () => {
  const db = crear();
  A.asegurarPropuesta_(db);
  assert.equal(A.obligaciones_(db, null, true).length, PROPUESTA.length);
  const db2 = crear();
  A.asegurarPropuesta_(db2);
  assert.equal(leerFilas_(db2, 'DEP_OBLIGACIONES', COLUMNAS.DEP_OBLIGACIONES).length, PROPUESTA.length, 'idempotente');
});

test('Hoy: el recordatorio del día con el mensaje listo; registrar, responder y cerrar', () => {
  const db = crear();
  const h = A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-13' }, FRANCISCA);
  const g = grupo(h, 'IVA_F29');
  assert.ok(g, 'aparece el IVA');
  assert.equal(g.fecha_limite, '2026-10-20');
  assert.equal(g.filas.length, 1, 'solo el cliente con monto y sin pagar');
  const f = g.filas[0];
  assert.equal(f.estado, 'HOY');
  assert.equal(f.escalon.id, 'R1');
  assert.equal(f.escalon.canal, 'CORREO');
  assert.equal(f.correo, 'maria@sol.cl');
  assert.equal(f.telefono, '56987654321');
  assert.match(f.mensaje.texto, /Hola María:/);
  assert.match(f.mensaje.texto, /\$500\.000/);
  assert.match(f.mensaje.texto, /martes 20 de octubre/);
  assert.match(f.mensaje.texto, /\{firma\}/, 'la firma la pone la pantalla');
  assert.match(f.mensaje.asunto, /IVA de septiembre de 2026 · Panadería Sol SpA/);
  assert.equal(h.resumen.por_enviar >= 1, true);
  assert.equal(h.proximo.titulo, 'IVA mensual (F29) con monto a pagar');
  assert.equal(h.proximo.dias_habiles, 5);

  // Lectura no registra; quien registra sí.
  const datos = { obligacion_id: g.obligacion_id, periodo: g.periodo, item_clave: f.item_clave, escalon_id: 'R1', canal: 'CORREO', cliente_id: 'C1', cliente_nombre: f.cliente_nombre, destino: f.correo, mensaje: 'texto enviado' };
  assert.equal(A.registrarEnvio(db, datos, ROGELIO)._forbidden, true);
  const r = A.registrarEnvio(db, datos, FRANCISCA);
  assert.equal(r.ok, true);
  assert.equal(grupo(A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-13' }, FRANCISCA), 'IVA_F29'), undefined, 'enviado: ya no está por enviar');

  // Se salta R2 (16-oct): el 19 toca R3 «Mañana vence» como HOY.
  const h19 = grupo(A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-19' }, FRANCISCA), 'IVA_F29');
  assert.equal(h19.filas[0].escalon.id, 'R3');
  assert.equal(h19.filas[0].estado, 'HOY');
  // El 16 sin enviar R2 y mirando el 16: atrasado al día siguiente (sábado → lunes 19 ya es R3).
  const h16 = grupo(A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-16' }, FRANCISCA), 'IVA_F29');
  assert.equal(h16.filas[0].escalon.id, 'R2');

  // El cliente pidió plazo: sigue en la lista. Ya cumplió: sale.
  assert.equal(A.responder(db, { obligacion_id: g.obligacion_id, periodo: g.periodo, item_clave: f.item_clave, cliente_id: 'C1', respuesta: 'PIDIO_PLAZO', nota: 'paga el lunes' }, FRANCISCA).ok, true);
  assert.ok(grupo(A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-19' }, FRANCISCA), 'IVA_F29'));
  A.responder(db, { obligacion_id: g.obligacion_id, periodo: g.periodo, item_clave: f.item_clave, cliente_id: 'C1', respuesta: 'CUMPLIO' }, FRANCISCA);
  assert.equal(grupo(A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-19' }, FRANCISCA), 'IVA_F29'), undefined);

  // Registro e historial por cliente.
  const reg = A.listarRegistro(db, { depto: 'CONTABILIDAD' }, FRANCISCA);
  assert.equal(reg.resumen.envios, 1);
  assert.equal(reg.resumen.correo, 1);
  assert.equal(reg.resumen.respuestas, 2);
  const pc = A.porCliente(db, { depto: 'CONTABILIDAD', cliente_id: 'C1' }, BARBARA);
  assert.equal(pc.historial.length, 3);
  assert.equal(pc.cliente.nombre, 'Panadería Sol SpA');

  // Deshacer: solo quien lo registró o la jefatura.
  const env = reg.filas.find((x) => x.tipo === 'ENVIO');
  assert.equal(A.deshacer(db, { recordatorio_id: env.recordatorio_id }, ROGELIO)._forbidden, true);
  assert.equal(A.deshacer(db, { recordatorio_id: env.recordatorio_id }, FRANCISCA).ok, true);
});

test('Hoy: lo pagado en la matriz sale solo; después del último aviso queda «sin respuesta»', () => {
  const db = crear();
  const g0 = grupo(A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-21' }, FRANCISCA), 'IVA_F29');
  assert.equal(g0.filas[0].escalon.id, 'R5');
  A.registrarEnvio(db, { obligacion_id: g0.obligacion_id, periodo: g0.periodo, item_clave: g0.filas[0].item_clave, escalon_id: 'R5', cliente_id: 'C1', cliente_nombre: 'Panadería Sol SpA' }, FRANCISCA);
  const h = A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-22' }, FRANCISCA);
  assert.equal(grupo(h, 'IVA_F29').filas[0].estado, 'SIN_RESPUESTA');
  assert.equal(h.resumen.sin_respuesta, 1);
  actualizarFilaPorId_(db, 'CI_REGISTROS', 'registro_id', 'I1', { datos: { monto_pago: 500000, fecha_pago: '2026-10-22' } });
  assert.equal(grupo(A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-22' }, FRANCISCA), 'IVA_F29'), undefined, 'pagado en la matriz: sale');
});

test('tareas internas y cuotas de convenio', () => {
  const db = crear();
  // Revisión de convenios: el 15 (jueves 15-oct-2026).
  const h = A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-15' }, FRANCISCA);
  const g = grupo(h, 'REVISION_CONVENIOS');
  assert.equal(g.filas[0].interno, true);
  assert.equal(g.filas[0].estado, 'HOY');
  A.registrarEnvio(db, { obligacion_id: g.obligacion_id, periodo: g.periodo, item_clave: 'interno', escalon_id: 'T' }, FRANCISCA);
  assert.equal(grupo(A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-15' }, FRANCISCA), 'REVISION_CONVENIOS'), undefined, 'hecho: se cierra');

  agregarFila_(db, 'CI_CONVENIOS', { convenio_id: 'V1', cliente_id: 'C1', cliente_nombre: 'Panadería Sol SpA', activa: true,
    cuotas: JSON.stringify([{ n: 3, vencimiento: '2026-10-30', monto: 80000, tgr: 'NO', revision: '' }, { n: 2, vencimiento: '2026-09-30', monto: 80000, tgr: 'SI', revision: '' }]) });
  const hc = grupo(A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-27' }, FRANCISCA), 'CONVENIO_CUOTA');
  assert.equal(hc.filas.length, 1);
  assert.equal(hc.fecha_limite, '2026-10-30');
  assert.match(hc.filas[0].mensaje.texto, /cuota 3 del convenio TGR de Panadería Sol SpA \(\$80\.000\)/);
});

test('fechas propias y vencimientos manuales (examen ocupacional)', () => {
  const db = crear();
  const CAMILA = p('camila@homepymes.cl'), AMARLLA = p('amarlla@homepymes.cl');
  CI.guardarMiembros(db, { depto: 'PREVENCION', miembros: [{ email: CAMILA.email, rol: 'JEFATURA' }, { email: AMARLLA.email, rol: 'REGISTRA' }] }, ADM);
  const ex = obl(db, 'EXAMEN_OCUPACIONAL');
  assert.equal(A.guardarEvento(db, { depto: 'PREVENCION', obligacion_id: ex.obligacion_id, fecha: '2026-10-22', hora: '09:30', cliente_id: 'C1', cliente_nombre: 'Panadería Sol SpA', trabajador: 'Juan Soto', lugar: 'ACHS Santiago' }, AMARLLA).ok, true);
  const g = grupo(A.hoy(db, { depto: 'PREVENCION', fecha: '2026-10-21' }, AMARLLA), 'EXAMEN_OCUPACIONAL');
  assert.match(g.filas[0].mensaje.texto, /Juan Soto/);
  assert.match(g.filas[0].mensaje.texto, /09:30/);
  assert.match(g.filas[0].mensaje.texto, /ACHS Santiago/);
  // Una fecha para toda el área la pone la jefatura; quien registra, solo personales.
  assert.equal(A.guardarEvento(db, { depto: 'PREVENCION', titulo: 'Reunión de área', fecha: '2026-10-23' }, AMARLLA).ok, false);
  assert.equal(A.guardarEvento(db, { depto: 'PREVENCION', titulo: 'Visita personal', fecha: '2026-10-23', alcance: 'PERSONAL' }, AMARLLA).ok, true);
  assert.equal(A.guardarEvento(db, { depto: 'PREVENCION', titulo: 'Reunión de área', fecha: '2026-10-23' }, CAMILA).ok, true);
  const cal = A.calendario(db, { depto: 'PREVENCION', mes: '2026-M10' }, CAMILA);
  assert.ok(cal.eventos.some((e) => e.tipo === 'EVENTO' && e.titulo === 'Reunión de área'));
  assert.ok(cal.eventos.some((e) => e.tipo === 'CLIENTE' && e.fecha === '2026-10-22'));
  assert.ok(cal.eventos.some((e) => e.tipo === 'FERIADO' && e.fecha === '2026-10-12'));
  assert.ok(cal.eventos.some((e) => e.tipo === 'INTERNO' && /Coordinar reuniones/.test(e.titulo)));
  assert.equal(A.calendario(db, { depto: 'PREVENCION', mes: '2026-M10' }, FRANCISCA)._forbidden, true);
});

test('calendario de Contabilidad: vencimientos, escalones y tareas', () => {
  const db = crear();
  const cal = A.calendario(db, { depto: 'CONTABILIDAD', mes: '2026-M10' }, FRANCISCA);
  const iva = cal.eventos.find((e) => e.tipo === 'LIMITE' && e.clave === 'IVA_F29');
  assert.equal(iva.fecha, '2026-10-20');
  assert.equal(iva.pendientes, 1);
  assert.ok(cal.eventos.some((e) => e.tipo === 'RECORDATORIO' && e.fecha === '2026-10-13'));
  assert.ok(cal.eventos.some((e) => e.tipo === 'ESCALAMIENTO' && e.fecha === '2026-10-21'));
  assert.ok(cal.eventos.some((e) => e.tipo === 'INTERNO' && e.clave === 'REVISION_CONVENIOS' && e.fecha === '2026-10-15'));
  assert.ok(!cal.eventos.some((e) => e.tipo === 'INTERNO' && e.clave === 'PRE_IVA' && e.fecha === '2026-10-30'), 'una tarea de un paso no muestra el ancla');
  // Sin depto (Administración): todas las áreas que ve.
  const todo = A.calendario(db, { mes: '2026-M10' }, ADM);
  assert.ok(todo.eventos.some((e) => e.depto === 'RRHH'));
  assert.equal(todo.eventos.filter((e) => e.tipo === 'FERIADO' && e.fecha === '2026-10-12').length, 1);
});

test('ajustes: la jefatura o el superusuario editan; quien registra no; restaurar e historial', () => {
  const db = crear();
  const o = obl(db, 'IVA_F29');
  const aj = A.ajustes(db, { depto: 'CONTABILIDAD' }, FRANCISCA);
  assert.equal(aj.puede_editar, false);
  assert.equal(A.ajustes(db, { depto: 'CONTABILIDAD' }, BARBARA).puede_editar, true);
  assert.equal(A.ajustes(db, { depto: 'CONTABILIDAD' }, SUPER).puede_editar, true);
  const cambio = { obligacion_id: o.obligacion_id, nombre: 'IVA mensual', regla: { tipo: 'mensual', mes: 1, dia: 20 },
    escalones: [{ id: 'R1', nombre: 'Único aviso', offset: -3, canal: 'WHATSAPP', texto: 'Hola {contacto}, tu IVA es {monto}.' }] };
  assert.equal(A.guardarObligacion(db, cambio, FRANCISCA)._forbidden, true);
  assert.equal(A.guardarObligacion(db, cambio, BARBARA).ok, true);
  const h = grupo(A.hoy(db, { depto: 'CONTABILIDAD', fecha: '2026-10-15' }, FRANCISCA), 'IVA_F29');
  assert.equal(h.filas[0].mensaje.texto, 'Hola María, tu IVA es $500.000.');
  assert.equal(obl(db, 'IVA_F29').origen, 'EDITADA');
  assert.equal(A.guardarObligacion(db, Object.assign({}, cambio, { escalones: [] }), BARBARA).ok, false, 'sin recordatorios no se guarda');
  assert.equal(A.restaurarPropuesta(db, { obligacion_id: o.obligacion_id }, SUPER).ok, true);
  assert.equal(obl(db, 'IVA_F29').escalones.length, 5);
  assert.equal(A.historialObligacion(db, { obligacion_id: o.obligacion_id }, BARBARA).historial.length, 2);
  // Nueva obligación propia: interna o manual, nunca una fuente de matriz.
  const n = A.guardarObligacion(db, { depto: 'CONTABILIDAD', nombre: 'Cierre semestral', fuente: 'iva_por_pagar', regla: { tipo: 'anual', mes: 6, dia: 'ultimo' },
    escalones: [{ nombre: 'Preparar', offset: -5, canal: 'INTERNO', texto: 'Preparar el cierre.' }] }, BARBARA);
  assert.equal(n.ok, true);
  const nueva = A.obligaciones_(db, 'CONTABILIDAD', true).find((x) => x.obligacion_id === n.obligacion_id);
  assert.equal(nueva.fuente, 'interno');
  assert.equal(nueva.tipo, 'INTERNO');
  assert.equal(nueva.origen, 'PROPIA');
  assert.equal(A.restaurarPropuesta(db, { obligacion_id: n.obligacion_id }, BARBARA).ok, false);
});

test('medición: recordatorios a tiempo, sin respuesta y atribución del atraso del F29', () => {
  const db = crear();
  const o = obl(db, 'IVA_F29');
  const env = (id, item, cli, esc, fecha) => agregarFila_(db, 'DEP_RECORDATORIOS', { recordatorio_id: id, depto: 'CONTABILIDAD', obligacion_id: o.obligacion_id, periodo: '2026-M09', fecha_limite: '2026-10-20',
    item_clave: item, cliente_id: cli, cliente_nombre: cli === 'C1' ? 'Panadería Sol SpA' : 'Ferretería Norte', escalon_id: esc, canal: 'WHATSAPP', destino: '', mensaje: '', respuesta: '', nota: '', usuario_email: FRANCISCA.email, fecha, activa: true });
  env('X1', 'C1', 'C1', 'R1', '2026-10-13T15:00:00.000Z'); // a tiempo (R1 = 13-oct)
  env('X2', 'C2', 'C2', 'R2', '2026-10-19T15:00:00.000Z'); // tarde (R2 = 16-oct)
  A.responder(db, { obligacion_id: o.obligacion_id, periodo: '2026-M09', item_clave: 'C2', cliente_id: 'C2', respuesta: 'CONFIRMO' }, FRANCISCA);
  const m = A.medirMes_(db, 'CONTABILIDAD', '2026-M10');
  assert.equal(m.envios, 2);
  assert.equal(m.a_tiempo, 1);
  assert.equal(m.tarde, 1);
  assert.deepEqual(m.sin_respuesta, ['Panadería Sol SpA']);
  assert.deepEqual(A.avisos_(db, 'IVA_F29', '2026-M09'), { C1: '2026-10-13', C2: '2026-10-19' });

  // En el indicador del área: el F29 atrasado de C1 tuvo aviso antes del vencimiento (atraso del cliente).
  const IND = require('../logica/indicadoresDepto');
  actualizarFilaPorId_(db, 'CI_REGISTROS', 'registro_id', 'I1', { datos: { monto_pago: 500000, fecha_declaracion: '2026-10-22' } });
  actualizarFilaPorId_(db, 'CI_REGISTROS', 'registro_id', 'I2', { datos: { monto_pago: 120000, fecha_declaracion: '2026-10-19' } });
  const c = IND.contexto_(db, '2026-M10'); c.hoy = '2026-11-20';
  const r = IND.calcularArea_(db, 'CONTABILIDAD', '2026-M10', c);
  const k = r.kpis.find((x) => x.clave === 'f29_a_tiempo');
  assert.equal(k.extra.atraso_cliente, 1);
  assert.equal(k.extra.atraso_interno, 0);
  assert.match(r.detalle.f29_atrasos_mes[0].recordatorio, /^Sí, desde el 13-10-2026/);
  const r10 = r;
  assert.equal(r10.kpis.find((x) => x.clave === 'recordatorios_a_tiempo').valor, 50);
  assert.equal(r10.kpis.find((x) => x.clave === 'clientes_sin_respuesta').valor, 1);
  assert.equal(IND.calcularArea_(db, 'CONTABILIDAD', '2026-M08').kpis.some((x) => x.clave === 'recordatorios_a_tiempo'), false, 'antes de la agenda no se mide');
});

test('contadores y alertas de la mañana', () => {
  const db = crear();
  const r = A.calcularHoy_(db, 'CONTABILIDAD', '2026-10-13');
  assert.ok(r.resumen.por_enviar >= 1);
  const pend = A.resumen(db, {}, FRANCISCA);
  assert.ok('dep_contabilidad' in pend.pendientes);
  assert.equal(A.resumen(db, {}, LUIS).pendientes.dep_contabilidad, undefined, 'quien no está en el área no tiene contador');
});

test('Prevención: indicadores desde la Agenda y metas propias de la jefatura', () => {
  const db = crear();
  const CAMILA = p('camila@homepymes.cl'), AMARLLA = p('amarlla@homepymes.cl');
  CI.guardarMiembros(db, { depto: 'PREVENCION', miembros: [{ email: CAMILA.email, rol: 'JEFATURA' }, { email: AMARLLA.email, rol: 'REGISTRA' }] }, ADM);
  // Metas: las define la jefatura; quien registra, no.
  assert.equal(A.guardarMeta(db, { depto: 'PREVENCION', nombre: 'Visitas a terreno realizadas', unidad: 'visitas', meta: 12 }, AMARLLA)._forbidden, true);
  assert.equal(A.guardarMeta(db, { depto: 'PREVENCION', nombre: 'Visitas a terreno realizadas', unidad: 'visitas', meta: 12 }, CAMILA).ok, true);
  const meta = A.listarMetas(db, { depto: 'PREVENCION' }, AMARLLA).metas[0];
  assert.equal(meta.meta, 12);
  // El área anota el valor del mes en su reporte.
  const RD = require('../logica/departamentosReportes');
  const g = RD.guardar(db, { depto: 'PREVENCION', periodo: '2026-M10', contenido: { resumen: '', metas: [{ meta_id: meta.meta_id, valor: '10', comentario: 'faltaron dos por lluvia' }] } }, AMARLLA);
  // Comité paritario (vence el 23-oct) hecho a tiempo; visitas (1-oct) sin hacer.
  const comite = obl(db, 'COMITE_PARITARIO');
  agregarFila_(db, 'DEP_RECORDATORIOS', { recordatorio_id: 'T1', depto: 'PREVENCION', obligacion_id: comite.obligacion_id, periodo: '2026-M10', fecha_limite: '2026-10-30', item_clave: 'interno', cliente_id: '', cliente_nombre: '',
    escalon_id: 'T', canal: 'INTERNO', destino: '', mensaje: '', respuesta: '', nota: '', usuario_email: AMARLLA.email, fecha: '2026-10-20T14:00:00.000Z', activa: true });
  const IND = require('../logica/indicadoresDepto');
  const c = IND.contexto_(db, '2026-M10'); c.hoy = '2026-11-05';
  const r = IND.calcularArea_(db, 'PREVENCION', '2026-M10', c);
  assert.equal(r.con_indicadores, true, 'Prevención ya no sale «sin datos»');
  const t = r.kpis.find((k) => k.clave === 'tareas_a_tiempo');
  assert.equal(t.valor, 50);
  assert.match(t.explicacion, /1 de 2 fechas cumplidas a tiempo; 1 sin hacer: Programar visitas/);
  const km = r.kpis.find((k) => k.clave === 'meta_' + meta.meta_id);
  assert.equal(km.valor, 10);
  assert.equal(km.estado, 'alerta');
  assert.match(km.explicacion, /Bajo la meta\. Faltaron dos por lluvia\./);
  assert.ok(r.portada.cifras.includes('tareas_a_tiempo'));
  // Sin resumen se puede enviar: SIGSO ya mide el mes.
  const e = RD.enviar(db, { reporte_id: g.reporte.reporte_id }, CAMILA);
  assert.notEqual(e.ok, false, e.message);
});
