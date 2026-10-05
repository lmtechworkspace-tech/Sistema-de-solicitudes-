'use strict';

/**
 * Solicitudes, etapa 2 (2026-10-05): pedidos a DEPARTAMENTOS con catálogo de
 * servicios; la cola del departamento la reparte su jefatura y la toman sus
 * miembros (la lista es CI_MIEMBROS, la misma del módulo del área).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Servicios = require('../logica/serviciosSolicitud');
const Solicitudes = require('../logica/solicitudes');
const BO = require('../logica/solicitudesBackoffice');
const Dashboard = require('../logica/dashboard');
const Portal = require('../logica/portal');

delete process.env.RESEND_API_KEY;

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']]);
  sembrarTabla_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS, [['HP', 'HomePymes', '', true, '']]);
  return db;
}
function vacio(hoja) { return Object.fromEntries(COLUMNAS[hoja].map((c) => [c, ''])); }
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function miembro(db, depto, email, rol) {
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: depto + email, depto, usuario_email: email, rol, creado_por: 't', fecha_creacion: '', activa: true });
}
function cuenta(db, nombre, email, rol) {
  agregarFila_(db, 'CUENTAS_PORTAL', Object.assign(vacio('CUENTAS_PORTAL'),
    { cuenta_id: 'C-' + email, usuario: email.split('@')[0], nombre, emails: JSON.stringify([email]), rol: rol || 'SOLICITANTE', activo: true, empresa_id: 'HP' }));
}
// Como llega desde el portal: SOLICITANTE normalizado a DEV (router.js).
function ctx(email, rolCuenta) { return { email, rol: rolCuenta === 'ADM' ? 'ADM' : 'DEV', rol_origen: rolCuenta || 'SOLICITANTE', via_portal: true }; }

const JEFA = 'francisca@homepymes.cl', ANALISTA = 'barbara@homepymes.cl', LECTORA = 'vanessa@homepymes.cl', OTRA = 'lisseth@homepymes.cl', PIDE = 'juan@homepymes.cl';
function equipoContabilidad(db) {
  miembro(db, 'CONTABILIDAD', JEFA, 'JEFATURA');
  miembro(db, 'CONTABILIDAD', ANALISTA, 'REGISTRA');
  miembro(db, 'CONTABILIDAD', LECTORA, 'LECTURA');
  miembro(db, 'RRHH', OTRA, 'REGISTRA');
  [['Francisca', JEFA], ['Bárbara', ANALISTA], ['Vanessa', LECTORA], ['Lisseth', OTRA], ['Juan', PIDE]].forEach(([n, e]) => cuenta(db, n, e));
}
async function pedir(db, item, extra) {
  return Solicitudes.crearSolicitud(db, Object.assign({
    empresa_id: 'HP', asociada_plataforma: false, solicitante_nombre: 'Juan', solicitante_cargo: 'Ventas', solicitante_email: PIDE,
    subsolicitudes: [Object.assign({ titulo: 'Factura para cliente X', descripcion: 'Necesito la factura de septiembre.', depto: 'CONTABILIDAD' }, item)]
  }, extra));
}

// --- catálogo ----------------------------------------------------------------------------

test('catálogo: solo la jefatura (o ADM) lo administra; valida nombre, plazo y duplicados', () => {
  const db = dbConSchema();
  equipoContabilidad(db);
  assert.ok(Servicios.guardar(db, { depto: 'CONTABILIDAD', nombre: 'Emitir factura' }, ctx(ANALISTA))._forbidden);
  assert.ok(Servicios.guardar(db, { depto: 'RRHH', nombre: 'Contrato' }, ctx(JEFA))._forbidden, 'jefatura de otro departamento');
  const s = Servicios.guardar(db, { depto: 'CONTABILIDAD', nombre: 'Emitir factura', plazo_dias: 2, prioridad: 'P3', ayuda: 'RUT y monto' }, ctx(JEFA));
  assert.equal(s.nombre, 'Emitir factura');
  assert.equal(s.plazo_dias, 2);
  assert.ok(Servicios.guardar(db, { depto: 'CONTABILIDAD', nombre: 'emitir factura' }, ctx(JEFA))._validationError, 'duplicado');
  assert.ok(Servicios.guardar(db, { depto: 'CONTABILIDAD', nombre: 'Algo', plazo_dias: 0 }, ctx(JEFA))._validationError, 'plazo inválido');
  Servicios.guardar(db, { servicio_id: s.servicio_id, activa: false }, ctx(JEFA));
  const cat = Servicios.catalogo(db).departamentos.find((d) => d.clave === 'CONTABILIDAD');
  assert.equal(cat.servicios.length, 0, 'el desactivado no se ofrece');
  assert.equal(cat.con_equipo, true);
  assert.equal(Servicios.listarAdmin(db, {}, ctx(JEFA)).departamentos[0].servicios.length, 1, 'la jefatura sí lo ve para reactivarlo');
});

test('catálogo: importa los servicios del mapa de procesos del SGC del departamento, sin duplicar', () => {
  const db = dbConSchema();
  equipoContabilidad(db);
  agregarFila_(db, 'SGC_PROCESOS', Object.assign(vacio('SGC_PROCESOS'), { proceso_id: 'PO-04', codigo: 'PO-04', nombre: 'Contabilidad', nivel: 'MAPA', area: 'Contabilidad', activa: true }));
  agregarFila_(db, 'SGC_PROCESOS', Object.assign(vacio('SGC_PROCESOS'), { proceso_id: 'S1', codigo: 'SRV-CON-01', nombre: 'Facturas', nivel: 'SERVICIO', proceso_padre_id: 'PO-04', activa: true }));
  agregarFila_(db, 'SGC_PROCESOS', Object.assign(vacio('SGC_PROCESOS'), { proceso_id: 'S2', codigo: 'SRV-RHH-01', nombre: 'Remuneraciones', nivel: 'SERVICIO', area: 'Recursos Humanos', activa: true }));
  assert.deepEqual(Servicios.importarDesdeProcesos(db, { depto: 'CONTABILIDAD' }, ctx(JEFA)), { creados: 1, revisados: 1 });
  assert.deepEqual(Servicios.importarDesdeProcesos(db, { depto: 'CONTABILIDAD' }, ctx(JEFA)), { creados: 0, revisados: 1 });
  const s = filas(db, 'SOL_SERVICIOS');
  assert.equal(s.length, 1);
  assert.equal(s[0].proceso_codigo, 'SRV-CON-01');
});

// --- crear ---------------------------------------------------------------------------------

test('un pedido a un departamento llega SIN asignar, con el plazo y la prioridad del servicio, y avisa al equipo', async () => {
  const db = dbConSchema();
  equipoContabilidad(db);
  const sv = Servicios.guardar(db, { depto: 'CONTABILIDAD', nombre: 'Emitir factura', plazo_dias: 2, prioridad: 'P4' }, ctx(JEFA));
  const r = await pedir(db, { servicio_id: sv.servicio_id });
  assert.ok(r.solicitud_id, JSON.stringify(r));
  const item = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(item.depto, 'CONTABILIDAD');
  assert.equal(item.depto_nombre, 'Contabilidad');
  assert.equal(item.servicio_nombre, 'Emitir factura');
  assert.equal(item.desarrollador_asignado, '');
  assert.equal(item.prioridad, 'P4');
  assert.equal(Number(item.sla_objetivo_horas), 2 * Servicios.HORAS_JORNADA);
  const avisos = filas(db, 'LOG_NOTIFICACIONES').filter((l) => String(l.evento).indexOf('PEDIDO_DEPTO:') === 0);
  assert.deepEqual(avisos.map((a) => a.destinatario), [JEFA], 'correo solo a la jefatura');
  const campana = filas(db, 'NOTIFICACIONES_APP').filter((n) => n.tipo === 'SOLICITUD_DEPTO').map((n) => n.destinatario_email).sort();
  assert.deepEqual(campana, [ANALISTA, JEFA].sort(), 'campana a quienes trabajan el área (no a lectura)');
});

test('urgente sube a P2 y usa el plazo de P2 si es menor; "Otro pedido" usa el plazo de su prioridad', async () => {
  const db = dbConSchema();
  equipoContabilidad(db);
  const sv = Servicios.guardar(db, { depto: 'CONTABILIDAD', nombre: 'Balance', plazo_dias: 10, prioridad: 'P4' }, ctx(JEFA));
  await pedir(db, { servicio_id: sv.servicio_id, urgente: true });
  await pedir(db, { titulo: 'Otra cosa', descripcion: 'Algo distinto de la lista.' });
  const [urgente, otro] = filas(db, 'SUBSOLICITUDES');
  assert.equal(urgente.prioridad, 'P2');
  assert.equal(Number(urgente.sla_objetivo_horas), 24);
  assert.equal(otro.servicio_nombre, 'Otro pedido');
  assert.equal(otro.prioridad, 'P3');
  assert.equal(Number(otro.sla_objetivo_horas), 72);
});

test('un pedido a departamento no exige tipo ni módulo; uno técnico sí', async () => {
  const db = dbConSchema();
  const ok = await pedir(db, {});
  assert.ok(ok.solicitud_id);
  const tecnico = await pedir(db, { depto: '' }, { asociada_plataforma: true, plataforma: 'SIGSO' });
  assert.ok(tecnico._validationError);
  assert.ok(tecnico.fields.some((f) => /tipo/.test(f.campo)));
  const malo = await pedir(db, { depto: 'NO_EXISTE' });
  assert.ok(malo._validationError);
});

// --- cola, tomar y repartir --------------------------------------------------------------

test('la cola del departamento: la ven sus miembros; un ajeno no; lo sin asignar no aparece como huérfano de otros', async () => {
  const db = dbConSchema();
  equipoContabilidad(db);
  await pedir(db, {});
  const cola = Dashboard.getCola(db, { depto: 'CONTABILIDAD' }, ctx(ANALISTA));
  assert.equal(cola.items.length, 1);
  assert.equal(cola.items[0].puede_tomar, true);
  assert.equal(cola.items[0].puede_asignar, false);
  assert.equal(cola.solo_lectura, false);
  assert.deepEqual(cola.colas.map((c) => [c.clave, c.abiertos, c.sin_asignar]), [['CONTABILIDAD', 1, 1]]);
  const lectura = Dashboard.getCola(db, { depto: 'CONTABILIDAD' }, ctx(LECTORA));
  assert.equal(lectura.solo_lectura, true);
  assert.equal(lectura.items[0].puede_tomar, false);
  assert.ok(Dashboard.getCola(db, { depto: 'CONTABILIDAD' }, ctx(OTRA))._forbidden);
  // En "mi bandeja" de alguien de RR.HH. (DEV normalizado) no aparece como huérfano.
  assert.equal(Dashboard.getCola(db, {}, ctx(OTRA)).items.length, 0);
  const jefa = Dashboard.getCola(db, { depto: 'CONTABILIDAD' }, ctx(JEFA));
  assert.equal(jefa.items[0].puede_asignar, true);
  assert.deepEqual(jefa.responsables.map((r) => r.email).sort(), [ANALISTA, JEFA].sort(), 'reparte entre su equipo');
});

test('tomar: queda a su nombre y pasa a Recibida; nadie lo pisa después; un ajeno no puede', async () => {
  const db = dbConSchema();
  equipoContabilidad(db);
  await pedir(db, {});
  const id = filas(db, 'SUBSOLICITUDES')[0].subsolicitud_id;
  assert.ok(BO.tomarItem(db, { subsolicitud_id: id }, ctx(OTRA))._forbidden);
  assert.ok(BO.tomarItem(db, { subsolicitud_id: id }, ctx(LECTORA))._forbidden);
  const r = BO.tomarItem(db, { subsolicitud_id: id }, ctx(ANALISTA));
  assert.equal(r.desarrollador_asignado, ANALISTA);
  const item = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(item.desarrollador_asignado, ANALISTA);
  assert.equal(item.estado, 'S02');
  assert.ok(BO.tomarItem(db, { subsolicitud_id: id }, ctx(JEFA))._validationError, 'ya lo tomó otra persona');
  assert.equal(filas(db, 'HISTORIAL_ASIGNACION').length, 1);
  // Ya es suyo: puede avanzarlo.
  assert.ok(!BO.actualizarEstado(db, { subsolicitud_id: id, estado_nuevo: 'S05', comentario: '' }, ctx(ANALISTA))._forbidden);
});

test('repartir: la jefatura asigna dentro de su equipo y actúa sobre lo de su departamento; no fuera del equipo', async () => {
  const db = dbConSchema();
  equipoContabilidad(db);
  const r = await pedir(db, {});
  const id = filas(db, 'SUBSOLICITUDES')[0].subsolicitud_id;
  // Un miembro que no es jefatura no reparte lo que no es suyo.
  assert.ok((await BO.derivarSolicitud(db, { solicitud_id: r.solicitud_id, subsolicitud_id: id, responsable_nuevo: JEFA, motivo: 'Lo reparto yo mismo' }, ctx(ANALISTA)))._forbidden);
  assert.ok((await BO.derivarSolicitud(db, { solicitud_id: r.solicitud_id, subsolicitud_id: id, responsable_nuevo: OTRA, motivo: 'Fuera del equipo, no' }, ctx(JEFA)))._forbidden);
  const ok = await BO.derivarSolicitud(db, { solicitud_id: r.solicitud_id, subsolicitud_id: id, responsable_nuevo: ANALISTA, motivo: 'Bárbara lo ve esta semana' }, ctx(JEFA));
  assert.equal(ok.total, 1);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].desarrollador_asignado, ANALISTA);
  // La jefatura cambia el estado de algo asignado a otra persona de su área.
  assert.ok(!BO.actualizarEstado(db, { subsolicitud_id: id, estado_nuevo: 'S02', comentario: '' }, ctx(JEFA))._forbidden);
  // Alguien de otra área, no.
  assert.ok(BO.actualizarEstado(db, { subsolicitud_id: id, estado_nuevo: 'S05', comentario: '' }, ctx(OTRA))._forbidden);
  const det = BO.getDetalle(db, r.solicitud_id, ctx(JEFA));
  assert.equal(det.solo_lectura, false);
  assert.deepEqual(det.responsables.map((x) => x.email).sort(), [ANALISTA, JEFA].sort());
});

test('la sesión trae las colas de la persona (para mostrarle la Bandeja aunque no tenga el módulo)', () => {
  const db = dbConSchema();
  equipoContabilidad(db);
  const fila = filas(db, 'CUENTAS_PORTAL').find((c) => c.usuario === 'vanessa');
  assert.deepEqual(Portal.perfilPublico(fila, db).colas_solicitudes, ['CONTABILIDAD']);
  const juan = filas(db, 'CUENTAS_PORTAL').find((c) => c.usuario === 'juan');
  assert.deepEqual(Portal.perfilPublico(juan, db).colas_solicitudes, []);
});
