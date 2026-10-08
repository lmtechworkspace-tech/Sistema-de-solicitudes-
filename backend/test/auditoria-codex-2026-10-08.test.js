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

// --- Opción B del hallazgo 1: ver o tocar una solicitud exige PROBAR el correo -----------------

function preparaPublico() {
  const db = preparar();
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']]);
  return db;
}
const DATOS_SOL = (email) => ({
  empresa_id: 'HP', plataforma: 'ERP', es_cliente: false, solicitante_nombre: 'Juan Demo', solicitante_cargo: 'Jefe',
  solicitante_email: email, fecha_propuesta: '2026-10-20T18:00',
  subsolicitudes: [{ titulo: 'No cargan las facturas', descripcion: 'Pantalla en blanco', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: 'ERR' }]
});
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const publica = (db, accion, data) => ejecutarAccion(db, accion, data, { ip: '1.1.1.1' });

test('opción B: número + correo ya no bastan; con el código verificado sí', async (t) => {
  const db = preparaPublico();
  const enviados = [];
  const original = Notificaciones.enviarCodigoAcceso;
  Notificaciones.enviarCodigoAcceso = async (d, email, codigo) => { enviados.push(codigo); };
  t.after(() => { Notificaciones.enviarCodigoAcceso = original; Cache.limpiarTodo_(); });
  Cache.limpiarTodo_();
  const c = await publica(db, 'crearSolicitud', DATOS_SOL('juan@cliente.cl'));
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const id = c.body.data.solicitud_id;
  for (const [accion, extra] of [['consultarEstado', {}], ['editarSubsolicitud', { subsolicitud_id: id + '-01', titulo: 'Cambiado' }],
    ['enviarMensajeSolicitud', { texto: 'hola' }], ['subirArchivo', { nombre_archivo: 'a.png', contenido_base64: PNG }]]) {
    const r = await publica(db, accion, Object.assign({ solicitud_id: id, email: 'juan@cliente.cl' }, extra));
    assert.equal(r.status, 403, accion);
    assert.equal(r.body.requiere_codigo, true, accion + ': la página sabe que debe pedir el código');
  }
  // Código → pase → consulta.
  await publica(db, 'solicitarCodigoAcceso', { email: 'juan@cliente.cl' });
  const v = await publica(db, 'verificarCodigoAcceso', { email: 'juan@cliente.cl', codigo: enviados[0] });
  assert.equal(v.status, 200);
  const pase = v.body.data.pase_acceso;
  assert.equal((await publica(db, 'consultarEstado', { solicitud_id: id, email: 'juan@cliente.cl', pase_acceso: [pase] })).status, 200);
  // El pase prueba ESE correo: no sirve para declarar otro.
  const otro = await publica(db, 'crearSolicitud', DATOS_SOL('maria@cliente.cl'));
  assert.equal((await publica(db, 'consultarEstado', { solicitud_id: otro.body.data.solicitud_id, email: 'maria@cliente.cl', pase_acceso: [pase] })).status, 403);
  // misSolicitudes con código también entrega pase.
  await publica(db, 'solicitarCodigoAcceso', { email: 'maria@cliente.cl' });
  const m = await publica(db, 'misSolicitudes', { email: 'maria@cliente.cl', codigo: enviados[1] });
  assert.ok(m.body.data.pase_acceso);
  assert.equal((await publica(db, 'consultarEstado', { solicitud_id: otro.body.data.solicitud_id, email: 'maria@cliente.cl', pase_acceso: m.body.data.pase_acceso })).status, 200);
});

test('opción B: el pase de crearSolicitud sirve SOLO para esa solicitud (adjuntos del formulario)', async (t) => {
  const db = preparaPublico();
  t.after(() => Cache.limpiarTodo_());
  const conBucket = require('../logica/almacenamiento');
  const orig = conBucket.subirArchivo_;
  conBucket.subirArchivo_ = async (clave) => ({ ok: true, clave });
  t.after(() => { conBucket.subirArchivo_ = orig; });
  const a = await publica(db, 'crearSolicitud', DATOS_SOL('victima@cliente.cl'));
  const b = await publica(db, 'crearSolicitud', DATOS_SOL('victima@cliente.cl')); // alguien escribe el correo de otra persona
  const paseB = b.body.data.pase_acceso;
  assert.ok(paseB);
  const sub = await publica(db, 'subirArchivo', { solicitud_id: b.body.data.solicitud_id, email: 'victima@cliente.cl', nombre_archivo: 'a.png', contenido_base64: PNG, pase_acceso: [paseB] });
  assert.equal(sub.status, 200, 'sube los adjuntos de la que acaba de crear: ' + JSON.stringify(sub.body));
  assert.equal((await publica(db, 'consultarEstado', { solicitud_id: a.body.data.solicitud_id, email: 'victima@cliente.cl', pase_acceso: [paseB] })).status, 403,
    'pero no abre otra solicitud de ese correo');
});

test('opción B: con sesión de la plataforma basta la cuenta; los adjuntos de «Nueva solicitud» funcionan sin correo', async (t) => {
  const db = preparaPublico();
  t.after(() => Cache.limpiarTodo_());
  const Alm = require('../logica/almacenamiento');
  const orig = Alm.subirArchivo_;
  Alm.subirArchivo_ = async (clave) => ({ ok: true, clave });
  t.after(() => { Alm.subirArchivo_ = orig; });
  const tSol = await login(db, 'solicita');
  const tDev = await login(db, 'planta');
  const c = await publica(db, 'crearSolicitud', DATOS_SOL('sol.segundo@demo.cl'));
  const id = c.body.data.solicitud_id;
  assert.equal((await publica(db, 'consultarEstado', { solicitud_id: id, email: 'sol.segundo@demo.cl', portal_token: tSol })).status, 200, 'su cuenta tiene ese correo');
  assert.equal((await publica(db, 'consultarEstado', { solicitud_id: id, email: 'sol.segundo@demo.cl', portal_token: tDev })).status, 403, 'otra cuenta no');
  const sub = await publica(db, 'subirArchivo', { solicitud_id: id, subsolicitud_id: id + '-01', nombre_archivo: 'a.png', contenido_base64: PNG, portal_token: tSol });
  assert.equal(sub.status, 200, 'sin correo: el servidor usa el de la cuenta que corresponde: ' + JSON.stringify(sub.body));
});

// --- Revisión de Codex de D-002 (2026-10-08) ------------------------------------------------

test('D-002 rev. H1: el pase de creación SOLO sube adjuntos de esa solicitud; el de código hace todo', async (t) => {
  const db = preparaPublico();
  t.after(() => Cache.limpiarTodo_());
  const Alm = require('../logica/almacenamiento');
  const orig = Alm.subirArchivo_;
  Alm.subirArchivo_ = async (clave) => ({ ok: true, clave });
  t.after(() => { Alm.subirArchivo_ = orig; });
  const a = await publica(db, 'crearSolicitud', DATOS_SOL('pepa@cliente.cl'));
  const b = await publica(db, 'crearSolicitud', DATOS_SOL('pepa@cliente.cl'));
  const id = a.body.data.solicitud_id, pase = [a.body.data.pase_acceso];
  const base = { solicitud_id: id, subsolicitud_id: id + '-01', email: 'pepa@cliente.cl', pase_acceso: pase };
  assert.equal((await publica(db, 'subirArchivo', Object.assign({ nombre_archivo: 'a.png', contenido_base64: PNG }, base))).status, 200, 'sus adjuntos sí');
  const otras = [['consultarEstado', {}], ['editarSubsolicitud', { titulo: 'Cambiado' }], ['eliminarArchivo', { archivo_id: 'x' }], ['responderConsulta', { texto: 'r' }],
    ['enviarMensajeSolicitud', { texto: 'hola' }], ['validarCierre', { accion: 'confirmar', comentario: '' }]];
  for (const [accion, extra] of otras) {
    const r = await publica(db, accion, Object.assign({}, base, extra));
    assert.equal(r.status, 403, accion + ' con pase de creación');
  }
  const sub = require('../db/sqliteRepo').leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES).find((x) => x.subsolicitud_id === id + '-01');
  assert.notEqual(sub.titulo, 'Cambiado', 'no cambió nada');
  assert.equal((await publica(db, 'subirArchivo', { solicitud_id: b.body.data.solicitud_id, email: 'pepa@cliente.cl', nombre_archivo: 'a.png', contenido_base64: PNG, pase_acceso: pase })).status, 403, 'ni en otra solicitud');
  // Con el pase de código, lo normal sigue funcionando.
  const codigo = SolicitudesPublico.crearPaseAcceso_('pepa@cliente.cl');
  assert.equal((await publica(db, 'consultarEstado', { solicitud_id: id, email: 'pepa@cliente.cl', pase_acceso: [codigo] })).status, 200);
  assert.equal((await publica(db, 'editarSubsolicitud', { solicitud_id: id, subsolicitud_id: id + '-01', email: 'pepa@cliente.cl', titulo: 'Nuevo título', descripcion: 'La pantalla de facturas queda en blanco al abrirla desde el menú.', pase_acceso: [codigo] })).status, 200);
});

test('D-002 rev. H2: los pases vencidos se purgan sin consultarlos; los vigentes quedan; hay tope', (t) => {
  t.after(() => Cache.limpiarTodo_());
  Cache.limpiarTodo_();
  let ahora = Date.parse('2026-10-08T12:00:00Z');
  t.mock.method(Date, 'now', () => ahora);
  const viejos = [];
  for (let i = 0; i < 50; i++) viejos.push(SolicitudesPublico.crearPaseAcceso_('v' + i + '@x.cl'));
  ahora += 9 * 3600 * 1000; // más de 8 h
  const vigente = SolicitudesPublico.crearPaseAcceso_('vigente@x.cl');
  Cache.purgarVencidas_();
  assert.equal(Cache.tamano_(), 1, 'solo queda el vigente, sin haber consultado los viejos');
  assert.deepEqual(SolicitudesPublico.correosVerificados_(null, { pase_acceso: [vigente] }, 'consultarEstado'), ['vigente@x.cl']);
  // La purga corre sola al escribir pasado el minuto.
  ahora += 9 * 3600 * 1000;
  SolicitudesPublico.crearPaseAcceso_('otro@x.cl');
  assert.equal(Cache.tamano_(), 1, 'el vigente anterior ya venció y se purgó al escribir');
  // Tope: nunca pasa de MAX_ENTRADAS.
  for (let i = 0; i < Cache.MAX_ENTRADAS + 50; i++) Cache.put('k' + i, '1', 3600);
  assert.ok(Cache.tamano_() <= Cache.MAX_ENTRADAS);
});

test('D-002 rev. H4: si el correo no sale, se dice; el código no queda vigente y no gasta cupo', async (t) => {
  const db = preparar();
  const original = Notificaciones.enviarCodigoAcceso;
  t.after(() => { Notificaciones.enviarCodigoAcceso = original; Cache.limpiarTodo_(); });
  Cache.limpiarTodo_();
  let modo = 'ok', ultimo = '';
  Notificaciones.enviarCodigoAcceso = async (d, email, codigo) => {
    ultimo = codigo;
    return modo === 'ok' ? { enviado: true } : { enviado: false, motivo: modo };
  };
  for (const motivo of ['canal_desactivado', 'error_envio']) {
    modo = motivo;
    const r = await publica(db, 'solicitarCodigoAcceso', { email: 'q@demo.cl' });
    assert.equal(r.status, 400, motivo);
    assert.match(r.body.message, /No pudimos enviar el código/);
    assert.equal((await publica(db, 'verificarCodigoAcceso', { email: 'q@demo.cl', codigo: ultimo })).status, 403, motivo + ': el código no quedó vigente');
  }
  // Los fallos no gastaron cupo: tres envíos buenos siguen permitidos.
  modo = 'ok';
  for (let i = 0; i < 3; i++) assert.equal((await publica(db, 'solicitarCodigoAcceso', { email: 'q@demo.cl' })).status, 200);
  assert.equal((await publica(db, 'verificarCodigoAcceso', { email: 'q@demo.cl', codigo: ultimo })).status, 200);
  // La respuesta no depende de si el correo tiene solicitudes (q@demo.cl no tiene ninguna).
});

// --- 2.ª ronda de Codex sobre D-003: envíos simultáneos del código -------------------------

function transporteControlado(t) {
  const original = Notificaciones.enviarCodigoAcceso;
  const pendientes = [];
  Notificaciones.enviarCodigoAcceso = (d, email, codigo) => new Promise((resolver) => pendientes.push({ codigo, resolver }));
  t.after(() => { Notificaciones.enviarCodigoAcceso = original; Cache.limpiarTodo_(); });
  Cache.limpiarTodo_();
  const esperar = async (n) => { for (let i = 0; i < 50 && pendientes.length < n; i++) await new Promise((r) => setImmediate(r)); };
  return { pendientes, esperar };
}
const OK = { enviado: true }, FALLA = { enviado: false, motivo: 'error_envio' };
const verifica = (db, email, codigo) => SolicitudesPublico.verificarCodigoAcceso(db, { email, codigo });
const envios = (email) => JSON.parse(Cache.get('CODIGO_ACCESO_ENVIOS:' + email) || '[]').length;

test('D-003 2.ª: A falla y B sale (pedidos cruzados): el código de B vale y cuenta un envío', async (t) => {
  const db = preparar(), c = transporteControlado(t), email = 'cruce@demo.cl';
  const a = SolicitudesPublico.solicitarCodigoAcceso(db, { email });
  const b = SolicitudesPublico.solicitarCodigoAcceso(db, { email });
  await c.esperar(1);
  assert.equal(c.pendientes.length, 1, 'van en fila: B no genera su código hasta que A termine');
  c.pendientes[0].resolver(FALLA);
  assert.equal((await a)._validationError, true);
  await c.esperar(2);
  c.pendientes[1].resolver(OK);
  assert.deepEqual(await b, { ok: true });
  assert.ok(verifica(db, email, c.pendientes[1].codigo).pase_acceso, 'el código de B vale');
  assert.equal(envios(email), 1, 'cuenta solo el envío que salió');
});

test('D-003 2.ª: A sale y B falla: el código de A sigue valiendo', async (t) => {
  const db = preparar(), c = transporteControlado(t), email = 'inverso@demo.cl';
  const a = SolicitudesPublico.solicitarCodigoAcceso(db, { email });
  const b = SolicitudesPublico.solicitarCodigoAcceso(db, { email });
  await c.esperar(1); c.pendientes[0].resolver(OK); await a;
  await c.esperar(2); c.pendientes[1].resolver(FALLA);
  assert.equal((await b)._validationError, true);
  assert.equal(verifica(db, email, c.pendientes[1].codigo)._forbidden, true, 'el de B no quedó vigente');
  assert.ok(verifica(db, email, c.pendientes[0].codigo).pase_acceso, 'el de A, que sí llegó, vale');
  assert.equal(envios(email), 1);
});

test('D-003 2.ª: dos fallos simultáneos no dejan código ni gastan cupo; tras éxito + fallo quedan 2 envíos', async (t) => {
  const db = preparar(), c = transporteControlado(t), email = 'dos@demo.cl';
  const a = SolicitudesPublico.solicitarCodigoAcceso(db, { email });
  const b = SolicitudesPublico.solicitarCodigoAcceso(db, { email });
  await c.esperar(1); c.pendientes[0].resolver(FALLA); await a;
  await c.esperar(2); c.pendientes[1].resolver(FALLA); await b;
  assert.equal(envios(email), 0);
  assert.equal(verifica(db, email, c.pendientes[0].codigo)._forbidden, true);
  assert.equal(verifica(db, email, c.pendientes[1].codigo)._forbidden, true);
  // Un éxito y un fallo: dentro de la ventana quedan exactamente dos envíos más.
  const pedir = async (resultado) => { const p = SolicitudesPublico.solicitarCodigoAcceso(db, { email }); const n = c.pendientes.length; await c.esperar(n + 1); if (c.pendientes.length > n) c.pendientes[n].resolver(resultado); return p; };
  await pedir(OK); await pedir(FALLA);
  assert.equal(envios(email), 1);
  await pedir(OK); await pedir(OK);
  const antes = c.pendientes.length;
  assert.deepEqual(await pedir(OK), { ok: true }, 'el cuarto responde ok (no revela nada)…');
  assert.equal(c.pendientes.length, antes, '…pero ya no envía: van 3 en la ventana');
});

test('D-003 H3 (regresión): con sessionStorage bloqueado, api.js conserva el pase en memoria y lo envía', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const bloq = () => { throw new Error('bloqueado'); };
  const pedidos = [];
  const respuestas = [{ ok: true, data: { pase_acceso: 'PASE-DE-PRUEBA' } }, { ok: true, data: {} }];
  const ctx = {
    window: { SIGSO_CONFIG: { NODE_API_URL: 'http://prueba.invalid/v1/accion' } },
    localStorage: { getItem: bloq, setItem: bloq, removeItem: bloq },
    sessionStorage: { getItem: bloq, setItem: bloq, removeItem: bloq },
    performance: { now: () => Date.now() }, console, setTimeout, clearTimeout, AbortController, JSON, Promise, Date, Map, WeakMap,
    fetch: async (url, op) => { pedidos.push(JSON.parse(op.body)); const r = respuestas.shift(); return { headers: { get: () => null }, text: async () => JSON.stringify(r) }; }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/api.js'), 'utf8'), ctx);
  const r1 = await vm.runInContext("llamarApi('', 'verificarCodigoAcceso', { email: 'a@b.cl', codigo: '123456' })", ctx);
  assert.equal(r1.data.pase_acceso, 'PASE-DE-PRUEBA');
  await vm.runInContext("llamarApi('', 'consultarEstado', { solicitud_id: 'S1', email: 'a@b.cl' })", ctx);
  assert.deepEqual(pedidos[1].data.pase_acceso, ['PASE-DE-PRUEBA'], 'la consulta siguiente lleva el pase, sin sessionStorage');
});
