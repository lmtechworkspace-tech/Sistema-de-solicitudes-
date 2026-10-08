'use strict';

/**
 * Correcciones de la auditoría de Codex del 2026-10-08 (autenticación y
 * separación de datos). Datos FICTICIOS, base en memoria, sin correos reales.
 *   Hallazgo 2: una cuenta SOLICITANTE no lee detalle ni pauta ajenos.
 *   Hallazgo 3: cambiar o resetear una contraseña cierra las sesiones viejas.
 *   Hallazgo 4: el código de «Mis solicitudes» se invalida tras 5 fallos y
 *               no se pueden pedir códigos sin fin.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Hash = require('../logica/passwordHash');
const Cache = require('../logica/cacheEfimero');
const Notificaciones = require('../logica/notificaciones');
const SolicitudesPublico = require('../logica/solicitudesPublico');
const { ejecutarAccion } = require('../server/router');

const CLAVE = 'Clave-Demo-123';

function preparar() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  const cuenta = (id, usuario, rol, emails, modulos) => {
    const salt = Hash.generarSalt();
    agregarFila_(db, 'CUENTAS_PORTAL', {
      cuenta_id: id, usuario, nombre: usuario, cargo: '', emails: JSON.stringify(emails), rol, modulos: JSON.stringify(modulos || []),
      empresa_id: 'HP', activo: true, salt, hash_password: Hash.hashPassword(CLAVE, salt), debe_cambiar_password: false
    });
  };
  cuenta('C-ADM', 'admin', 'ADM', ['admin@demo.cl'], ['administracion']);
  cuenta('C-ADM2', 'admin2', 'ADM', ['admin2@demo.cl'], ['administracion']);
  cuenta('C-SOL', 'solicita', 'SOLICITANTE', ['sol@demo.cl', 'sol.segundo@demo.cl'], ['bandeja', 'mi_trabajo']);
  cuenta('C-DEV', 'planta', 'DEV', ['dev@demo.cl'], ['bandeja', 'mi_trabajo']);
  return db;
}
async function login(db, usuario, clave) {
  const r = await ejecutarAccion(db, 'portalLogin', { usuario, password: clave || CLAVE }, { ip: '10.0.0.1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.token;
}
const llamar = (db, accion, token, extra) => ejecutarAccion(db, accion, Object.assign({ portal_token: token }, extra || {}), { ip: '10.0.0.9' });
const valida = async (db, token) => (await llamar(db, 'portalSesion', token, { token })).status === 200;

function sembrarSolicitudes(db) {
  const sol = (id, solicitante, empresa) => agregarFila_(db, 'SOLICITUDES', { solicitud_id: id, empresa_id: empresa, empresa_nombre: empresa, solicitante_nombre: 'X', solicitante_email: solicitante, estado_derivado: 'S02', prioridad_derivada: 'P2', fecha_creacion: '2026-10-01T10:00:00Z' });
  const item = (sub, id, asignado) => agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: sub, solicitud_id: id, numero_item: 1, titulo: 'Ítem ' + sub, estado: 'S02', prioridad: 'P2', desarrollador_asignado: asignado, tipo: 'MEJ' });
  sol('SOL-A', 'otra@empresa-a.cl', 'A'); item('SUB-A1', 'SOL-A', 'dev@demo.cl');          // ajena para el SOLICITANTE
  sol('SOL-B', 'sol.segundo@demo.cl', 'B'); item('SUB-B1', 'SOL-B', 'dev@demo.cl');         // la pidió (con su 2.º correo)
  sol('SOL-C', 'tercero@empresa-c.cl', 'C'); item('SUB-C1', 'SOL-C', 'sol@demo.cl');        // tiene un ítem asignado
}

test('hallazgo 2: SOLICITANTE solo abre lo que pidió o lo que tiene asignado; la planta ve todo', async () => {
  const db = preparar();
  sembrarSolicitudes(db);
  const tSol = await login(db, 'solicita');
  const tDev = await login(db, 'planta');
  const ajena = await llamar(db, 'getSolicitudDetalle', tSol, { solicitud_id: 'SOL-A' });
  assert.equal(ajena.status, 403, JSON.stringify(ajena.body));
  assert.equal((await llamar(db, 'getSolicitudDetalle', tSol, { solicitud_id: 'SOL-B' })).status, 200, 'la pidió con su segundo correo');
  assert.equal((await llamar(db, 'getSolicitudDetalle', tSol, { solicitud_id: 'SOL-C' })).status, 200, 'tiene un ítem asignado');
  assert.equal((await llamar(db, 'getSolicitudDetalle', tDev, { solicitud_id: 'SOL-A' })).status, 200, 'la planta ve el trabajo de sus compañeros');
});

test('hallazgo 2: SOLICITANTE solo saca su propia pauta; data.desarrollador manipulado no sirve', async () => {
  const db = preparar();
  sembrarSolicitudes(db);
  const tSol = await login(db, 'solicita');
  const tDev = await login(db, 'planta');
  const ajena = await llamar(db, 'getPautaTrabajo', tSol, { desarrollador: 'dev@demo.cl' });
  assert.equal(ajena.status, 403);
  const propia = await llamar(db, 'getPautaTrabajo', tSol, { desarrollador: 'sol@demo.cl' });
  assert.equal(propia.status, 200);
  assert.ok(JSON.stringify(propia.body).includes('SUB-C1'));
  assert.ok(!JSON.stringify(propia.body).includes('SUB-A1'));
  assert.equal((await llamar(db, 'getPautaTrabajo', tDev, { desarrollador: 'sol@demo.cl' })).status, 200, 'la planta saca la pauta de un compañero');
});

test('hallazgo 3: la clave puesta por la administración cierra todas las sesiones de esa cuenta', async () => {
  for (const operacion of ['resetear_password', 'asignar_password']) {
    const db = preparar();
    const t1 = await login(db, 'planta');
    const t2 = await login(db, 'planta');
    const tAdm = await login(db, 'admin');
    const r = await llamar(db, 'gestionarCuentaPortal', tAdm, { operacion, cuenta_id: 'C-DEV', password: 'Nueva-Clave-456' });
    assert.equal(r.status, 200, operacion + ' ' + JSON.stringify(r.body));
    assert.equal(await valida(db, t1), false, operacion + ': sesión 1 cerrada');
    assert.equal(await valida(db, t2), false, operacion + ': sesión 2 cerrada');
    assert.equal(await valida(db, tAdm), true, operacion + ': la del administrador sigue');
    const nueva = operacion === 'asignar_password' ? 'Nueva-Clave-456' : r.body.data.password_temporal;
    assert.equal((await ejecutarAccion(db, 'portalLogin', { usuario: 'planta', password: CLAVE }, { ip: '10.0.0.2' })).status !== 200, true, 'la clave vieja ya no entra');
    await login(db, 'planta', nueva);
  }
});

test('hallazgo 3: cambiar la propia clave cierra las OTRAS sesiones y deja la actual', async () => {
  const db = preparar();
  const otra = await login(db, 'planta');
  const actual = await login(db, 'planta');
  const r = await ejecutarAccion(db, 'portalCambiarPassword', { token: actual, password_actual: CLAVE, password_nueva: 'Otra-Clave-789' }, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await valida(db, otra), false, 'la otra sesión queda fuera');
  assert.equal(await valida(db, actual), true, 'la sesión desde donde se cambió sigue');
  await login(db, 'planta', 'Otra-Clave-789');
});

test('hallazgo 4: tras 5 códigos incorrectos el código deja de servir; máximo 3 códigos cada 10 minutos', async (t) => {
  const db = preparar();
  const enviados = [];
  const original = Notificaciones.enviarCodigoAcceso;
  Notificaciones.enviarCodigoAcceso = async (d, email, codigo) => { enviados.push(codigo); };
  t.after(() => { Notificaciones.enviarCodigoAcceso = original; Cache.limpiarTodo_(); });
  Cache.limpiarTodo_();
  const correo = 'persona@demo.cl';
  await SolicitudesPublico.solicitarCodigoAcceso(db, { email: correo });
  const bueno = enviados[0];
  assert.match(bueno, /^\d{6}$/);
  const malo = bueno === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.equal(SolicitudesPublico.misSolicitudes(db, { email: correo, codigo: malo })._forbidden, true);
  assert.equal(SolicitudesPublico.misSolicitudes(db, { email: correo, codigo: bueno })._forbidden, true, 'después de 5 fallos, ni el correcto entra');
  // Un código nuevo sí funciona, y es de un solo uso.
  await SolicitudesPublico.solicitarCodigoAcceso(db, { email: correo });
  const nuevo = enviados[1];
  assert.ok(!SolicitudesPublico.misSolicitudes(db, { email: correo, codigo: nuevo })._forbidden, 'el código nuevo entra');
  assert.equal(SolicitudesPublico.misSolicitudes(db, { email: correo, codigo: nuevo })._forbidden, true, 'y no sirve dos veces');
  // Tercer envío permitido; el cuarto responde ok pero no manda nada.
  await SolicitudesPublico.solicitarCodigoAcceso(db, { email: correo });
  const r4 = await SolicitudesPublico.solicitarCodigoAcceso(db, { email: correo });
  assert.equal(r4.ok, true, 'no revela nada');
  assert.equal(enviados.length, 3, 'el cuarto pedido en 10 minutos no envía');
  // Otro correo no se ve afectado.
  await SolicitudesPublico.solicitarCodigoAcceso(db, { email: 'otra@demo.cl' });
  assert.equal(enviados.length, 4);
});

// --- Segunda ronda de Codex ---------------------------------------------------------------

test('2.ª ronda: correo_cliente solo da acceso si la solicitud es de cliente', async () => {
  const db = preparar();
  const sol = (id, esCliente) => agregarFila_(db, 'SOLICITUDES', { solicitud_id: id, empresa_id: 'Z', empresa_nombre: 'Z', solicitante_nombre: 'X', solicitante_email: 'otro@z.cl', es_cliente: esCliente, correo_cliente: 'sol@demo.cl', estado_derivado: 'S02', prioridad_derivada: 'P2', fecha_creacion: '2026-10-01T10:00:00Z' });
  sol('SOL-NO-CLIENTE', false); agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'SUB-N', solicitud_id: 'SOL-NO-CLIENTE', numero_item: 1, titulo: 'n', estado: 'S02', prioridad: 'P2', desarrollador_asignado: 'dev@demo.cl', tipo: 'MEJ' });
  sol('SOL-CLIENTE', true); agregarFila_(db, 'SUBSOLICITUDES', { subsolicitud_id: 'SUB-C', solicitud_id: 'SOL-CLIENTE', numero_item: 1, titulo: 'c', estado: 'S02', prioridad: 'P2', desarrollador_asignado: 'dev@demo.cl', tipo: 'MEJ' });
  const tSol = await login(db, 'solicita');
  assert.equal((await llamar(db, 'getSolicitudDetalle', tSol, { solicitud_id: 'SOL-NO-CLIENTE' })).status, 403, 'es_cliente=false: el correo_cliente no cuenta');
  assert.equal((await llamar(db, 'getSolicitudDetalle', tSol, { solicitud_id: 'SOL-CLIENTE' })).status, 200, 'es_cliente=true: sí cuenta');
});

test('2.ª ronda: el límite de códigos es una ventana deslizante de 10 minutos', async (t) => {
  const db = preparar();
  const enviados = [];
  const original = Notificaciones.enviarCodigoAcceso;
  Notificaciones.enviarCodigoAcceso = async (d, email, codigo) => { enviados.push(codigo); };
  let ahora = Date.parse('2026-10-08T12:00:00Z');
  t.mock.method(Date, 'now', () => ahora);
  t.after(() => { Notificaciones.enviarCodigoAcceso = original; Cache.limpiarTodo_(); });
  Cache.limpiarTodo_();
  const pedir = (min) => { ahora = Date.parse('2026-10-08T12:00:00Z') + min * 60000; return SolicitudesPublico.solicitarCodigoAcceso(db, { email: 'v@demo.cl' }); };
  // Minutos 0, 9 y 18: tres envíos; en el minuto 20 solo el de 18 está dentro de la ventana → se envía.
  await pedir(0); await pedir(9); await pedir(18);
  assert.equal(enviados.length, 3);
  await pedir(20);
  assert.equal(enviados.length, 4, 'en el minuto 20 hay cupo');
  // Tres dentro de la ventana bloquean el cuarto, y el cupo vuelve al vencer la ventana.
  await pedir(21);
  assert.equal(enviados.length, 5);
  await pedir(22);
  assert.equal(enviados.length, 5, 'tres en los últimos 10 min (18, 20, 21): el cuarto no se envía');
  await pedir(28.5);
  assert.equal(enviados.length, 6, 'a los 28,5 min el de las 18 ya salió de la ventana');
});
