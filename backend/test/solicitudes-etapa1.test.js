'use strict';

/**
 * Solicitudes, etapa 1 (auditoría 2026-10-05): correos solo en hitos y con
 * nombres de estado, mensajes del equipo que sí le llegan al solicitante,
 * cierre automático a los 5 días hábiles con aviso previo, y áreas del
 * formulario con nombre de departamento (no de persona).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Notificaciones = require('../logica/notificaciones');
const Comentarios = require('../logica/comentarios');
const Publico = require('../logica/solicitudesPublico');
const CierreAutomatico = require('../logica/cierreAutomaticoSolicitudes');
const Catalogos = require('../logica/catalogos');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}
function vacio(hoja) { return Object.fromEntries(COLUMNAS[hoja].map((c) => [c, ''])); }
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function cuenta(db, id, nombre, email, rol) {
  agregarFila_(db, 'CUENTAS_PORTAL', Object.assign(vacio('CUENTAS_PORTAL'),
    { cuenta_id: id, usuario: id, nombre, emails: JSON.stringify([email]), rol: rol || 'SOLICITANTE', activo: true, empresa_id: 'HP' }));
}
function solicitud(db, extra) {
  agregarFila_(db, 'SOLICITUDES', Object.assign(vacio('SOLICITUDES'), {
    solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', solicitante_nombre: 'Juan', solicitante_email: 'juan@homepymes.cl',
    estado_derivado: 'S05', fecha_creacion: '2026-09-28T12:00:00.000Z'
  }, extra));
}
function item(db, n, extra) {
  agregarFila_(db, 'SUBSOLICITUDES', Object.assign(vacio('SUBSOLICITUDES'), {
    subsolicitud_id: 'SOL-2026-HP-0001-0' + n, solicitud_id: 'SOL-2026-HP-0001', numero_item: n,
    titulo: 'Ítem ' + n, estado: 'S05', prioridad: 'P2', fecha_creacion: '2026-09-28T12:00:00.000Z'
  }, extra));
}
function correos(db) { return filas(db, 'LOG_NOTIFICACIONES'); }

// --- hitos -------------------------------------------------------------------

test('hitoSolicitante_: solo los hitos generan correo', () => {
  const h = Notificaciones.hitoSolicitante_;
  // Etapa 3: "En curso" es hito solo al salir de Nueva (estado visible).
  assert.equal(h('S01', 'S02'), 'EN_CURSO');
  assert.equal(h('S01', 'S05'), 'EN_CURSO');
  assert.equal(h('S02', 'S03'), null);
  assert.equal(h('S03', 'S04'), null);
  assert.equal(h('S04', 'S05'), null);
  assert.equal(h('S08', 'S05'), null, 'reabrir no es un hito');
  assert.equal(h('S06', 'S05'), null, 'volver de Esperando información no es un hito nuevo');
  assert.equal(h('S05', 'S06'), 'PREGUNTA');
  assert.equal(h('S05', 'S07'), null);
  assert.equal(h('S07', 'S08'), 'RESUELTA');
  assert.equal(h('S08', 'S09'), 'CERRADA');
  assert.equal(h('S03', 'S10'), 'RECHAZADA');
  assert.equal(h('S02', 'S11'), 'CANCELADA');
});

test('un cambio que no es hito solo va a la campana (si cambia lo que se ve), sin correo', () => {
  const db = dbConSchema();
  cuenta(db, 'C1', 'Juan Pérez', 'juan@homepymes.cl');
  solicitud(db); item(db, 1);
  // Dentro de "En curso" (Recibida → En revisión): ni correo ni campana.
  assert.equal(Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S02', 'S03').motivo, 'no_es_hito');
  assert.equal(filas(db, 'NOTIFICACIONES_APP').length, 0);
  // Reabierto (Resuelta → En curso): campana con el nombre visible, sin correo.
  const r = Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S08', 'S05');
  assert.equal(r.motivo, 'no_es_hito');
  assert.equal(correos(db).length, 0);
  const campana = filas(db, 'NOTIFICACIONES_APP');
  assert.equal(campana.length, 1);
  assert.match(campana[0].titulo, /En curso/);
});

test('el correo de un hito usa nombres de estado, enlace a Mis solicitudes y agrupa los ítems de un lote', () => {
  const db = dbConSchema();
  cuenta(db, 'C1', 'Juan Pérez', 'juan@homepymes.cl');
  solicitud(db); item(db, 1); item(db, 2);
  Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S07', 'S08');
  const r2 = Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-02', 'S07', 'S08');
  assert.equal(r2.agrupado, true);
  const log = correos(db);
  assert.equal(log.length, 1, 'un solo correo para los dos ítems resueltos');
  assert.equal(log[0].resultado, 'PENDIENTE_REINTENTO');
  assert.doesNotMatch(log[0].asunto + log[0].cuerpo, /S0\d/, 'nunca códigos de estado');
  assert.match(log[0].cuerpo, /Ítem 1/);
  assert.match(log[0].cuerpo, /Ítem 2/);
  assert.match(log[0].cuerpo, /#\/mis_solicitudes/);
});

test('sin cuenta en la plataforma, el enlace del correo es la página pública de estado', () => {
  const db = dbConSchema();
  solicitud(db); item(db, 1);
  Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S01', 'S05');
  const log = correos(db);
  assert.equal(log.length, 1);
  assert.match(log[0].cuerpo, /estado\.html/);
  assert.equal(filas(db, 'NOTIFICACIONES_APP').length, 0, 'sin cuenta no hay campana');
});

test('la pregunta (Esperando información) llega escrita en el correo, una por ítem', () => {
  const db = dbConSchema();
  solicitud(db); item(db, 1); item(db, 2);
  Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S05', 'S06', { comentario: '¿Qué RUT corresponde?' });
  Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-02', 'S05', 'S06', { comentario: '¿De qué mes?' });
  const log = correos(db);
  assert.equal(log.length, 2);
  assert.ok(log.some((l) => l.cuerpo.indexOf('¿Qué RUT corresponde?') !== -1));
  assert.ok(log.some((l) => l.cuerpo.indexOf('¿De qué mes?') !== -1));
});

// --- mensajes del equipo -----------------------------------------------------

test('un mensaje del equipo (no interno) avisa al solicitante; una nota interna no', async (t) => {
  const db = dbConSchema();
  cuenta(db, 'C1', 'Juan Pérez', 'juan@homepymes.cl');
  cuenta(db, 'C2', 'Leo Estay', 'leo@homepymes.cl', 'DEV');
  solicitud(db); item(db, 1);
  const enviados = [];
  t.mock.method(Notificaciones, 'avisarMensajeEquipo', async (d, c) => { enviados.push(c.texto); });
  Comentarios.agregarComentario(db, { solicitud_id: 'SOL-2026-HP-0001', texto: 'Ya lo estamos viendo', es_interno: false }, { email: 'leo@homepymes.cl', rol: 'DEV' });
  Comentarios.agregarComentario(db, { solicitud_id: 'SOL-2026-HP-0001', texto: 'ojo: cliente moroso', es_interno: true }, { email: 'leo@homepymes.cl', rol: 'DEV' });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(enviados, ['Ya lo estamos viendo']);
});

test('avisarMensajeEquipo: correo con el nombre de quien escribe; nada si escribe el propio solicitante', async () => {
  const db = dbConSchema();
  cuenta(db, 'C1', 'Juan Pérez', 'juan@homepymes.cl');
  cuenta(db, 'C2', 'Leo Estay', 'leo@homepymes.cl', 'DEV');
  solicitud(db); item(db, 1);
  const propio = await Notificaciones.avisarMensajeEquipo(db, { comentario_id: 'x1', solicitud_id: 'SOL-2026-HP-0001', usuario: 'juan@homepymes.cl', texto: 'hola' });
  assert.equal(propio.motivo, 'es_del_solicitante');
  await Notificaciones.avisarMensajeEquipo(db, { comentario_id: 'x2', solicitud_id: 'SOL-2026-HP-0001', usuario: 'leo@homepymes.cl', texto: 'Necesito el PDF' });
  const log = correos(db);
  assert.equal(log.length, 1);
  assert.match(log[0].cuerpo, /Leo Estay te escribió/);
  assert.match(log[0].cuerpo, /Necesito el PDF/);
  const campana = filas(db, 'NOTIFICACIONES_APP');
  assert.equal(campana.length, 1);
  assert.match(campana[0].titulo, /mensaje de Leo Estay/);
});

test('estadoPublico entrega los mensajes no internos (los del equipo desde el corte), sin correos del equipo', () => {
  const db = dbConSchema();
  cuenta(db, 'C2', 'Leo Estay', 'leo@homepymes.cl', 'DEV');
  solicitud(db, { solicitud_id: 'SOL-2026-HP-0001' });
  item(db, 1, { desarrollador_asignado: 'leo@homepymes.cl' });
  const com = (id, usuario, texto, interno, ts) => agregarFila_(db, 'COMENTARIOS', Object.assign(vacio('COMENTARIOS'),
    { comentario_id: id, solicitud_id: 'SOL-2026-HP-0001', usuario, texto, es_interno: interno, timestamp: ts }));
  com('a', 'leo@homepymes.cl', 'nota vieja de la vista clásica', false, '2026-09-01T12:00:00.000Z');
  com('b', 'leo@homepymes.cl', 'nota interna', true, '2026-10-01T12:00:00.000Z');
  com('c', 'leo@homepymes.cl', 'Ya quedó listo', false, '2026-10-02T12:00:00.000Z');
  com('d', 'juan@homepymes.cl', 'Gracias', false, '2026-10-03T12:00:00.000Z');

  const r = Publico.estadoPublico(db, 'SOL-2026-HP-0001', 'juan@homepymes.cl');
  assert.deepEqual(r.mensajes.map((m) => m.texto), ['Ya quedó listo', 'Gracias']);
  assert.equal(r.mensajes[0].autor, 'equipo');
  assert.equal(r.mensajes[0].nombre, 'Leo Estay');
  assert.equal(r.mensajes[1].autor, 'tu');
  assert.equal(JSON.stringify(r).indexOf('leo@homepymes.cl'), -1, 'el correo del equipo nunca viaja');
  assert.equal(r.subsolicitudes[0].responsable_nombre, 'Leo Estay');
});

// --- cierre automático -------------------------------------------------------

function itemTerminado(db, n, fechaTerminada) {
  item(db, n, { estado: 'S08', fecha_terminada: fechaTerminada });
}
const LUNES = '2026-10-05T15:00:00.000Z';

test('cierre automático: avisa a los 3 días hábiles y no cierra sin aviso previo', () => {
  const db = dbConSchema();
  solicitud(db, { estado_derivado: 'S08' });
  itemTerminado(db, 1, '2026-09-21T15:00:00.000Z'); // terminado hace 2 semanas, nunca avisado
  itemTerminado(db, 2, '2026-10-02T15:00:00.000Z'); // terminado el viernes: 1 día hábil
  const r = CierreAutomatico.revisar(db, new Date(LUNES));
  assert.deepEqual(r, { avisadas: 1, cerrados: 0 });
  const avisos = correos(db).filter((l) => l.evento.indexOf('AVISO_CIERRE:') === 0);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].cuerpo, /Ítem 1/);
  assert.doesNotMatch(avisos[0].cuerpo, /Ítem 2/);
  assert.equal(filas(db, 'SUBSOLICITUDES').find((i) => i.numero_item === 1).estado, 'S08');
  // Correrlo de nuevo el mismo día no vuelve a avisar.
  assert.deepEqual(CierreAutomatico.revisar(db, new Date(LUNES)), { avisadas: 0, cerrados: 0 });
});

test('cierre automático: cierra 2 días hábiles después del aviso', () => {
  const db = dbConSchema();
  solicitud(db, { estado_derivado: 'S08' });
  itemTerminado(db, 1, '2026-09-21T15:00:00.000Z');
  CierreAutomatico.revisar(db, new Date(LUNES));
  // El aviso quedó registrado con la hora real de la prueba: se fija al lunes.
  const log = correos(db)[0];
  const { actualizarFilaPorId_ } = require('../db/sqliteRepo');
  actualizarFilaPorId_(db, 'LOG_NOTIFICACIONES', 'log_id', log.log_id, { timestamp: LUNES });

  assert.equal(CierreAutomatico.revisar(db, new Date('2026-10-06T15:00:00.000Z')).cerrados, 0, 'martes: 1 día hábil desde el aviso');
  assert.equal(CierreAutomatico.revisar(db, new Date('2026-10-07T15:00:00.000Z')).cerrados, 1, 'miércoles: 2 días hábiles');
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].estado, 'S09');
});

test('cierre automático: sin correo del solicitante cierra al plazo sin aviso', () => {
  const db = dbConSchema();
  solicitud(db, { estado_derivado: 'S08', solicitante_email: '' });
  itemTerminado(db, 1, '2026-09-21T15:00:00.000Z');
  assert.deepEqual(CierreAutomatico.revisar(db, new Date(LUNES)), { avisadas: 0, cerrados: 1 });
});

test('fechaCierreEstimada: 5 días hábiles desde terminado, nunca antes de 2 hábiles tras el aviso', () => {
  const db = dbConSchema();
  const i = { solicitud_id: 'SOL-2026-HP-0001', estado: 'S08', fecha_terminada: '2026-10-05T15:00:00.000Z' };
  const fecha = CierreAutomatico.fechaCierreEstimada(db, i, new Date(LUNES));
  assert.equal(fecha.slice(0, 10), '2026-10-12');
  assert.equal(CierreAutomatico.fechaCierreEstimada(db, Object.assign({}, i, { estado: 'S05' })), '');
});

// --- áreas del formulario ----------------------------------------------------

test('el formulario muestra departamentos, una vez cada uno, sin el nombre de la persona', () => {
  const db = dbConSchema();
  const nombres = ['RRHH_LISSETH', 'CONTABILIDAD_FRANCISCA', 'RRHH_VANESSA', 'DESARROLADOR_LEO', 'FACTURACIÓN_MARISOL', 'Plataformas', 'CONTROL Y GESTIÓN'];
  nombres.forEach((n, i) => agregarFila_(db, 'CAT_AREAS', Object.assign(vacio('CAT_AREAS'),
    { area_id: 'AREA_00' + (i + 1), nombre: n, responsable_email: 'p' + i + '@homepymes.cl', activo: true })));
  agregarFila_(db, 'CAT_AREAS', Object.assign(vacio('CAT_AREAS'), { area_id: 'AREA_099', nombre: 'MARKETING_X', activo: false }));
  const areas = Catalogos.getCatalogosPublicos(db).areas;
  assert.deepEqual(areas.map((a) => a.nombre), ['Contabilidad', 'Control y Gestión', 'Desarrollo / TI', 'Facturación y Cobranzas', 'Plataformas', 'Recursos Humanos']);
  assert.equal(areas.find((a) => a.nombre === 'Recursos Humanos').area_id, 'AREA_001', 'el departamento usa su primera área');
  assert.equal(JSON.stringify(areas).indexOf('@'), -1);
});

test('la campana deja UN aviso por solicitud (se actualiza), no uno por cada cambio', () => {
  const db = dbConSchema();
  cuenta(db, 'C1', 'Juan Pérez', 'juan@homepymes.cl');
  solicitud(db); item(db, 1); item(db, 2);
  Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S01', 'S02');
  Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-02', 'S01', 'S02');
  Notificaciones.notificarCambioEstado(db, 'SOL-2026-HP-0001', 'SOL-2026-HP-0001-01', 'S05', 'S06');
  const campana = filas(db, 'NOTIFICACIONES_APP');
  assert.equal(campana.length, 1);
  assert.equal(campana[0].titulo, 'SOL-2026-HP-0001: Esperando respuesta');
});
