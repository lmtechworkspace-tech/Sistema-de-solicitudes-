'use strict';

/**
 * Destinatarios por persona (2026-10-06). Una solicitud a Soporte de
 * plataformas no le llegó a Leo: el formulario no decía a quién iba, el aviso
 * era solo por correo y los correos no salían (y nadie sabía por qué).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Solicitudes = require('../logica/solicitudes');
const Catalogos = require('../logica/catalogos');
const Salud = require('../logica/saludConfig');
const { EMAIL_DESARROLLO } = require('../logica/constantesSolicitudes');

delete process.env.RESEND_API_KEY;

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']]);
  sembrarTabla_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS, [['HP', 'HomePymes', '', true, ''], ['RLD', 'RLD', '', true, '']]);
  return db;
}
function vacio(hoja) { return Object.fromEntries(COLUMNAS[hoja].map((c) => [c, ''])); }
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leo(db, extra) {
  agregarFila_(db, 'CUENTAS_PORTAL', Object.assign(vacio('CUENTAS_PORTAL'), {
    cuenta_id: 'c-leo', usuario: 'lestay', nombre: 'Leo Estay', cargo: 'Desarrollador', emails: JSON.stringify([EMAIL_DESARROLLO]),
    rol: 'DEV', modulos: JSON.stringify(['bandeja']), empresa_id: 'RLD', activo: true
  }, extra || {}));
}

test('el formulario técnico dice quién recibe «No estoy seguro»: la persona de Soporte de plataformas', () => {
  const db = dbConSchema();
  leo(db);
  assert.deepEqual(Catalogos.getCatalogosPublicos(db).soporte, { persona: 'Leo Estay', cargo: 'Desarrollador', empresa: 'RLD' });
});

test('una solicitud técnica avisa al responsable también en la campana, y la respuesta dice a quién le llegó', async () => {
  const db = dbConSchema();
  leo(db);
  const r = await Solicitudes.crearSolicitud(db, {
    empresa_id: 'HP', asociada_plataforma: false, area: '', solicitante_nombre: 'Ana', solicitante_cargo: 'Ventas', solicitante_email: 'ana@homepymes.cl',
    subsolicitudes: [{ titulo: 'No carga la intranet', descripcion: 'Sale un error al entrar.', tipo: 'ERR', impacto: 'MEDIO' }]
  });
  assert.ok(r.solicitud_id, JSON.stringify(r));
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].desarrollador_asignado, EMAIL_DESARROLLO);
  const campana = filas(db, 'NOTIFICACIONES_APP').filter((n) => n.tipo === 'SOLICITUD_ASIGNADA');
  assert.deepEqual(campana.map((n) => n.destinatario_email), [EMAIL_DESARROLLO]);
  assert.deepEqual(r.destinatarios, [{ nombre: 'Leo Estay', cargo: 'Desarrollador', empresa: 'RLD', directo: true }]);
});

test('si el correo falla queda el motivo, y la salud avisa que no salen y quién recibe sin entrar', async () => {
  const db = dbConSchema();
  leo(db, { debe_cambiar_password: true, ultimo_acceso: '2026-09-17T11:41:30.828Z' });
  agregarFila_(db, 'CAT_AREAS', { area_id: 'AREA_013', nombre: 'DESARROLADOR_LEO', responsable_email: EMAIL_DESARROLLO, activo: true });
  await Solicitudes.crearSolicitud(db, {
    empresa_id: 'HP', asociada_plataforma: false, area: 'AREA_013', solicitante_nombre: 'Ana', solicitante_cargo: 'Ventas', solicitante_email: 'ana@homepymes.cl',
    subsolicitudes: [{ titulo: 'No carga la intranet', descripcion: 'Sale un error al entrar.', tipo: 'ERR', impacto: 'MEDIO' }]
  });
  const error = filas(db, 'LOG_SISTEMA').filter((l) => l.contexto === 'CORREO_ERROR');
  assert.equal(error.length, 1, 'el mismo error se anota una vez, no por cada correo');
  assert.match(error[0].mensaje, /RESEND_API_KEY/);
  // Ya pasaron los reintentos: queda FALLIDO.
  filas(db, 'LOG_NOTIFICACIONES').forEach((n) => require('../db/sqliteRepo').actualizarFilaPorId_(db, 'LOG_NOTIFICACIONES', 'log_id', n.log_id, { resultado: 'FALLIDO' }));
  const checks = Salud.revisar(db).checks;
  const correo = checks.find((c) => c.id === 'correo_no_sale');
  assert.equal(correo.severidad, 'critico');
  assert.match(correo.casos[0].texto, /RESEND_API_KEY/);
  const receptores = checks.find((c) => c.id === 'receptores_sin_entrar');
  assert.equal(receptores.casos.length, 1);
  assert.match(receptores.casos[0].texto, /Leo Estay .*clave temporal sin cambiar, último acceso 2026-09-17/);
});
