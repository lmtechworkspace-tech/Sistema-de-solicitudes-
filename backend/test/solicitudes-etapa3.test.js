'use strict';

/**
 * Solicitudes, etapa 3 (2026-10-05): cinco estados visibles (Nueva → En curso
 * ⇄ Esperando respuesta → Resuelta → Cerrada, más Rechazada y Cancelada) con
 * los 11 códigos por dentro, y la conversación equipo ↔ solicitante.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const C = require('../logica/constantesSolicitudes');
const Notificaciones = require('../logica/notificaciones');
const BO = require('../logica/solicitudesBackoffice');
const Publico = require('../logica/solicitudesPublico');
const Dashboard = require('../logica/dashboard');

delete process.env.RESEND_API_KEY;

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}
function vacio(hoja) { return Object.fromEntries(COLUMNAS[hoja].map((c) => [c, ''])); }
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
const PIDE = 'juan@homepymes.cl', ATIENDE = 'barbara@homepymes.cl';
const ADM = { email: 'admin@homepymes.cl', rol: 'ADM' };
function cuenta(db, nombre, email) {
  agregarFila_(db, 'CUENTAS_PORTAL', Object.assign(vacio('CUENTAS_PORTAL'),
    { cuenta_id: 'C-' + email, usuario: email.split('@')[0], nombre, emails: JSON.stringify([email]), rol: 'SOLICITANTE', activo: true, empresa_id: 'HP' }));
}
function base(db, estado, extraItem) {
  cuenta(db, 'Juan Pérez', PIDE);
  cuenta(db, 'Bárbara Analista', ATIENDE);
  agregarFila_(db, 'SOLICITUDES', Object.assign(vacio('SOLICITUDES'), {
    solicitud_id: 'SOL-1', empresa_id: 'HP', solicitante_nombre: 'Juan', solicitante_email: PIDE, estado_derivado: estado, fecha_creacion: '2026-10-01T12:00:00.000Z'
  }));
  agregarFila_(db, 'SUBSOLICITUDES', Object.assign(vacio('SUBSOLICITUDES'), {
    subsolicitud_id: 'SOL-1-01', solicitud_id: 'SOL-1', numero_item: 1, titulo: 'Certificado', descripcion: 'x', estado, prioridad: 'P3',
    desarrollador_asignado: ATIENDE, fecha_creacion: '2026-10-01T12:00:00.000Z'
  }, extraItem));
}
function item(db) { return filas(db, 'SUBSOLICITUDES')[0]; }
function correos(db) { return filas(db, 'LOG_NOTIFICACIONES'); }

test('estado visible: los 11 códigos caben en 5 (+2) y el vocabulario es uno solo', () => {
  assert.deepEqual(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11'].map(C.etiquetaVisible_),
    ['Nueva', 'En curso', 'En curso', 'En curso', 'En curso', 'Esperando respuesta', 'En curso', 'Resuelta', 'Cerrada', 'Rechazada', 'Cancelada']);
  assert.equal(C.ETIQUETA_ESTADO.S05, 'En curso');
  assert.equal(C.ETIQUETA_ESTADO.S08, 'Resuelta');
  // Frontend y backend dicen lo mismo.
  const utils = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../frontend/js/utils.js'), 'utf8');
  Object.keys(C.ESTADO_VISIBLE).forEach((k) => assert.match(utils, new RegExp(k + ": '" + C.ESTADO_VISIBLE[k] + "'")));
});

test('"En curso" se avisa una vez (al salir de Nueva) y nombra a quien atiende', () => {
  const db = dbConSchema();
  base(db, 'S01');
  Notificaciones.notificarCambioEstado(db, 'SOL-1', 'SOL-1-01', 'S01', 'S05');
  Notificaciones.notificarCambioEstado(db, 'SOL-1', 'SOL-1-01', 'S05', 'S07');
  const log = correos(db);
  assert.equal(log.length, 1);
  assert.match(log[0].asunto, /está en curso/);
  assert.match(log[0].cuerpo, /Bárbara Analista recibió tu solicitud/);
});

test('"Marcar resuelta" con lo que se hizo: le llega en el correo y queda en la conversación', () => {
  const db = dbConSchema();
  base(db, 'S05');
  const r = BO.actualizarEstado(db, { subsolicitud_id: 'SOL-1-01', estado_nuevo: 'S08', comentario: 'Se emitió y te lo envié por correo.', comentario_al_solicitante: true }, ADM);
  assert.ok(!r._forbidden && !r._validationError, JSON.stringify(r));
  const pub = filas(db, 'COMENTARIOS').filter((c) => !(c.es_interno === true || c.es_interno === 'TRUE'));
  assert.equal(pub.length, 1);
  assert.match(correos(db)[0].cuerpo, /Lo que se hizo:\n«Se emitió/);
});

test('el motivo de un cambio SIN la marca sigue siendo del equipo (no sale)', () => {
  const db = dbConSchema();
  base(db, 'S05');
  BO.actualizarEstado(db, { subsolicitud_id: 'SOL-1-01', estado_nuevo: 'S10', comentario: 'Cliente moroso, no se atiende.' }, ADM);
  assert.equal(filas(db, 'COMENTARIOS').length, 0);
  assert.doesNotMatch(correos(db)[0].cuerpo, /moroso/);
});

test('pedir información: la pregunta va al correo y a la conversación; al responder vuelve solo a En curso', async () => {
  const db = dbConSchema();
  base(db, 'S05');
  BO.actualizarEstado(db, { subsolicitud_id: 'SOL-1-01', estado_nuevo: 'S06', comentario: '¿Para qué institución?' }, ADM);
  assert.equal(item(db).estado, 'S06');
  assert.equal(filas(db, 'COMENTARIOS').length, 1);
  const r = await Publico.responderConsulta(db, { solicitud_id: 'SOL-1', subsolicitud_id: 'SOL-1-01', email: PIDE, texto: 'Para la municipalidad.' });
  assert.ok(r.ok);
  assert.equal(item(db).estado, 'S05');
  const campana = filas(db, 'NOTIFICACIONES_APP').filter((n) => n.tipo === 'SOLICITUD_MENSAJE_EQUIPO');
  assert.deepEqual(campana.map((n) => n.destinatario_email), [ATIENDE]);
});

test('el solicitante escribe cuando quiere; la Bandeja marca "te escribió" hasta que el equipo actúa', async () => {
  const db = dbConSchema();
  base(db, 'S05');
  const r = await Publico.enviarMensajeSolicitud(db, { solicitud_id: 'SOL-1', email: PIDE, texto: '¿Cómo va?' });
  assert.ok(r.ok);
  assert.equal(item(db).estado, 'S05', 'un mensaje no cambia el estado si no esperaba respuesta');
  const ver = () => Dashboard.getCola(db, {}, ADM).items[0].respuesta_pendiente;
  assert.equal(ver(), true);
  await new Promise((ok) => setTimeout(ok, 5));
  agregarFila_(db, 'COMENTARIOS', { comentario_id: 'c2', solicitud_id: 'SOL-1', subsolicitud_id: '', usuario: ATIENDE, texto: 'Mañana lo tienes', es_interno: false, timestamp: new Date().toISOString() });
  assert.equal(ver(), false);
  const det = Publico.estadoPublico(db, 'SOL-1', PIDE);
  assert.deepEqual(det.mensajes.map((m) => m.autor), ['tu', 'equipo']);
});

test('mensaje del solicitante: correo equivocado no; solicitud cerrada no', async () => {
  const db = dbConSchema();
  base(db, 'S09');
  assert.ok((await Publico.enviarMensajeSolicitud(db, { solicitud_id: 'SOL-1', email: 'otro@x.cl', texto: 'hola' }))._forbidden);
  assert.ok((await Publico.enviarMensajeSolicitud(db, { solicitud_id: 'SOL-1', email: PIDE, texto: 'hola' }))._validationError);
  assert.equal(filas(db, 'COMENTARIOS').length, 0);
});
