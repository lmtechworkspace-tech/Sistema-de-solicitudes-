'use strict';

/**
 * Portal de clientes, etapa 1 (2026-10-07): la base segura.
 *  - El contratista entra por un canal propio (cliente_token) y nunca alcanza
 *    una acción del personal; un token del personal tampoco abre las suyas.
 *  - Todo se acota a SU cliente: no ve ni toca datos de otra empresa.
 *  - Invitación de un solo uso, clave de 6 números no obvia, freno de fuerza
 *    bruta y registro de cada ingreso.
 *  - Administra el super admin y quien él autorice.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { ejecutarAccion } = require('../server/router');
const Sesiones = require('../logica/sesiones');

delete process.env.RESEND_API_KEY;

const SUPER = 'luis@ctrly.cl', VANESSA = 'vanessa@homepymes.cl', LISSETH = 'lisseth@homepymes.cl', OTRA = 'otra@homepymes.cl';
const RUT_PEDRO = '12.345.678-5', RUT_ANA = '11.111.111-1';

function dbPortal() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS, [['HP', 'HomePymes', '', true, '']]);
  const vacio = (hoja) => Object.fromEntries(COLUMNAS[hoja].map((c) => [c, '']));
  [['Luis', SUPER, 'ADM', true], ['Vanessa Sepúlveda', VANESSA, 'SOLICITANTE', false], ['Lisseth Vilchez', LISSETH, 'SOLICITANTE', false], ['Otra', OTRA, 'SOLICITANTE', false]]
    .forEach(([n, e, r, sa]) => agregarFila_(db, 'CUENTAS_PORTAL', Object.assign(vacio('CUENTAS_PORTAL'), {
      cuenta_id: 'c-' + e, usuario: e.split('@')[0], nombre: n, emails: JSON.stringify([e]), rol: r, activo: true, empresa_id: 'HP', super_admin: sa })));
  [[VANESSA, 'REGISTRA'], [LISSETH, 'JEFATURA']].forEach(([e, r], i) => agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'm' + i, depto: 'RRHH', usuario_email: e, rol: r, activa: true }));
  [['CLI-1', 'Constructora Cerro Alto SpA', '76.543.210-K'], ['CLI-2', 'Constructora Vecina SpA', '77.777.777-7']]
    .forEach(([id, n, rut]) => agregarFila_(db, 'CAT_CLIENTES', Object.assign(vacio('CAT_CLIENTES'), { cliente_id: id, razon_social: n, rut, activo: true })));
  return db;
}
// Sesión del personal: un token real en SESIONES_PORTAL, como en producción.
function tokenStaff(db, email) { return Sesiones.crearSesion(db, 'c-' + email); }
async function staff(db, email, action, data) {
  const r = await ejecutarAccion(db, action, Object.assign({ portal_token: tokenStaff(db, email) }, data || {}), { ip: '10.0.0.1' });
  return r;
}
async function cliente(db, action, data, ip) { return ejecutarAccion(db, action, data || {}, { ip: ip || '200.1.1.1' }); }
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
const codigoDe = (enlace) => enlace.split('#invitacion=')[1];

async function clienteListo(db, clienteId, rut, nombre) {
  let r = await staff(db, SUPER, 'portalAdmGuardarCliente', { cliente_id: clienteId, habilitado: true, servicios: ['RRHH'], encargados: { RRHH: VANESSA }, telefono: '+56 9 5555 0099' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await staff(db, SUPER, 'portalAdmInvitar', { cliente_id: clienteId, nombre, rut, telefono: '9 5555 0099' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
async function activado(db, clienteId, rut, nombre) {
  const inv = await clienteListo(db, clienteId, rut, nombre);
  const r = await cliente(db, 'clienteActivar', { invitacion: codigoDe(inv.enlace), pin: '482915', pin2: '482915', dispositivo: 'Android' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.cliente_token;
}

test('invitación: enlace de un solo uso, WhatsApp listo, y la clave queda guardada solo como hash', async () => {
  const db = dbPortal();
  const inv = await clienteListo(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  assert.match(inv.enlace, /#invitacion=/);
  assert.match(inv.whatsapp, /^https:\/\/wa\.me\/56955550099\?text=/);
  assert.match(inv.mensaje, /Pedro/);
  const ver = await cliente(db, 'clienteVerInvitacion', { invitacion: codigoDe(inv.enlace) });
  assert.equal(ver.body.data.empresa, 'Constructora Cerro Alto SpA');
  // Clave obvia: rechazada.
  let r = await cliente(db, 'clienteActivar', { invitacion: codigoDe(inv.enlace), pin: '123456', pin2: '123456' });
  assert.equal(r.status, 400);
  r = await cliente(db, 'clienteActivar', { invitacion: codigoDe(inv.enlace), pin: '482915', pin2: '482915' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.data.cliente_token);
  assert.equal(r.body.data.perfil.cliente.razon_social, 'Constructora Cerro Alto SpA');
  assert.equal(r.body.data.perfil.encargados[0].nombre, 'Vanessa Sepúlveda');
  const c = filas(db, 'PORTAL_CONTACTOS')[0];
  assert.equal(c.estado, 'ACTIVO');
  assert.notEqual(c.pin_hash, '482915');
  assert.equal(c.invitacion_hash, '', 'el enlace se gasta');
  // El mismo enlace no sirve dos veces.
  r = await cliente(db, 'clienteActivar', { invitacion: codigoDe(inv.enlace), pin: '482915', pin2: '482915' });
  assert.equal(r.status, 403);
  const acciones = filas(db, 'PORTAL_REGISTRO').map((x) => x.accion);
  assert.ok(acciones.includes('INVITACION') && acciones.includes('ACTIVACION') && acciones.includes('INGRESO'), acciones.join(','));
  // La sesión guarda solo el hash del token.
  const tokenPrimero = (await cliente(db, 'clienteEntrar', { rut: RUT_PEDRO, pin: '482915' })).body.data.cliente_token;
  assert.ok(tokenPrimero);
  assert.ok(!JSON.stringify(filas(db, 'PORTAL_SESIONES')).includes(tokenPrimero), 'el token en claro no queda guardado');
});

test('entrar con RUT (con o sin puntos) y clave; error genérico; pausa y bloqueo por intentos', async () => {
  const db = dbPortal();
  await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  let r = await cliente(db, 'clienteEntrar', { rut: '123456785', pin: '482915', recordar: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await cliente(db, 'clienteEntrar', { rut: RUT_PEDRO, pin: '000001' });
  assert.equal(r.status, 403);
  assert.equal(r.body.message, 'RUT o clave incorrectos.');
  r = await cliente(db, 'clienteEntrar', { rut: '99.999.999-9', pin: '482915' });
  assert.equal(r.body.message, 'RUT o clave incorrectos.', 'un RUT que no existe responde igual');
  // 5 fallos (desde IPs distintas, para no chocar con el freno por IP) = pausa en la base.
  for (let i = 2; i <= 5; i++) await cliente(db, 'clienteEntrar', { rut: RUT_PEDRO, pin: '000001' }, '200.1.1.' + (10 + i));
  r = await cliente(db, 'clienteEntrar', { rut: RUT_PEDRO, pin: '482915' }, '200.9.9.9');
  assert.equal(r.status, 403);
  assert.match(r.body.message, /espera unos minutos/);
  // 10 fallos seguidos = bloqueado hasta que el personal lo desbloquee.
  const c = filas(db, 'PORTAL_CONTACTOS')[0];
  const { actualizarFilaPorId_ } = require('../db/sqliteRepo');
  actualizarFilaPorId_(db, 'PORTAL_CONTACTOS', 'contacto_id', c.contacto_id, { pausa_hasta: '', fallos: 9 });
  await cliente(db, 'clienteEntrar', { rut: RUT_PEDRO, pin: '000001' }, '200.8.8.8');
  assert.equal(filas(db, 'PORTAL_CONTACTOS')[0].estado, 'BLOQUEADO');
  r = await cliente(db, 'clienteEntrar', { rut: RUT_PEDRO, pin: '482915' }, '200.7.7.7');
  assert.equal(r.status, 403);
  await staff(db, SUPER, 'portalAdmContacto', { contacto_id: c.contacto_id, operacion: 'desbloquear' });
  r = await cliente(db, 'clienteEntrar', { rut: RUT_PEDRO, pin: '482915' }, '200.6.6.6');
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('aislamiento: el token del contratista no abre acciones del personal y el del personal no abre las del contratista', async () => {
  const db = dbPortal();
  const tok = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  // Con su token como si fuera de personal: rechazado.
  for (const accion of ['getColaSolicitudes', 'listarCuentasPortal', 'portalAdmEstado', 'getSolicitudDetalle', 'listarBitacoraProyecto']) {
    const r = await ejecutarAccion(db, accion, { portal_token: tok, cliente_token: tok }, { ip: '1.1.1.1' });
    assert.notEqual(r.status, 200, accion + ' no debe responder al contratista');
  }
  // Token del personal en una acción del contratista: sesión inválida.
  const r = await ejecutarAccion(db, 'clienteSesion', { cliente_token: tokenStaff(db, SUPER), portal_token: tokenStaff(db, SUPER) }, {});
  assert.equal(r.status, 403);
  // Sin token: nada.
  assert.equal((await cliente(db, 'clienteTrabajadores', {})).status, 403);
});

test('cada contratista ve y toca solo lo de su empresa', async () => {
  const db = dbPortal();
  const tok1 = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  const tok2 = await activado(db, 'CLI-2', RUT_ANA, 'Ana Vecina');
  let r = await cliente(db, 'clienteGuardarObra', { cliente_token: tok1, nombre: 'Los Robles', comuna: 'Puente Alto' });
  const obra1 = r.body.data.obra_id;
  r = await cliente(db, 'clienteGuardarTrabajador', { cliente_token: tok1, nombre: 'Juan Pérez', rut: '12.345.678-5', cargo: 'Maestro', obra_id: obra1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const juan = r.body.data.trabajador_id;
  // El cliente 2 no ve a Juan, no puede editarlo ni usar la obra del cliente 1, aunque mande su id.
  r = await cliente(db, 'clienteTrabajadores', { cliente_token: tok2 });
  assert.equal(r.body.data.trabajadores.length, 0);
  r = await cliente(db, 'clienteGuardarTrabajador', { cliente_token: tok2, trabajador_id: juan, nombre: 'Cambiado' });
  assert.equal(r.status, 400);
  r = await cliente(db, 'clienteGuardarTrabajador', { cliente_token: tok2, nombre: 'Otro', obra_id: obra1 });
  assert.equal(r.status, 400);
  r = await cliente(db, 'clienteGuardarTrabajador', { cliente_token: tok2, nombre: 'Otro', cliente_id: 'CLI-1' });
  assert.equal(r.status, 200);
  assert.equal(filas(db, 'PORTAL_TRABAJADORES').find((t) => t.nombre === 'Otro').cliente_id, 'CLI-2', 'el cliente_id del pedido se ignora');
  assert.equal(filas(db, 'PORTAL_TRABAJADORES').find((t) => t.trabajador_id === juan).nombre, 'Juan Pérez');
  // RUT inválido del trabajador: se avisa.
  r = await cliente(db, 'clienteGuardarTrabajador', { cliente_token: tok1, nombre: 'Malo', rut: '12.345.678-0' });
  assert.equal(r.status, 400);
});

test('administración: solo el super admin y a quien él autorice; el encargado debe ser del equipo del área', async () => {
  const db = dbPortal();
  let r = await staff(db, OTRA, 'portalAdmEstado');
  assert.equal(r.status, 403);
  r = await staff(db, VANESSA, 'portalAdmPermisos', { operacion: 'otorgar', email: VANESSA });
  assert.equal(r.status, 403, 'solo el super admin otorga');
  r = await staff(db, SUPER, 'portalAdmPermisos', { operacion: 'otorgar', email: VANESSA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await staff(db, VANESSA, 'portalAdmEstado');
  assert.equal(r.status, 200);
  assert.ok(r.body.data.equipos.RRHH.some((p) => p.email === VANESSA && p.nombre === 'Vanessa Sepúlveda'));
  r = await staff(db, VANESSA, 'portalAdmGuardarCliente', { cliente_id: 'CLI-1', encargados: { RRHH: OTRA } });
  assert.equal(r.status, 400, 'alguien fuera del equipo de RR. HH. no puede ser la encargada');
  r = await staff(db, VANESSA, 'portalAdmGuardarCliente', { cliente_id: 'CLI-1', encargados: { RRHH: LISSETH } });
  assert.equal(r.status, 200);
  r = await staff(db, SUPER, 'portalAdmPermisos', { operacion: 'revocar', email: VANESSA });
  r = await staff(db, VANESSA, 'portalAdmEstado');
  assert.equal(r.status, 403);
  // El perfil de la sesión del personal marca el menú solo a quien administra.
  const Portal = require('../logica/portal');
  const cuentas = filas(db, 'CUENTAS_PORTAL');
  assert.equal(Portal.perfilPublico(cuentas.find((c) => c.cuenta_id === 'c-' + SUPER), db).portal_clientes, true);
  assert.equal(Portal.perfilPublico(cuentas.find((c) => c.cuenta_id === 'c-' + OTRA), db).portal_clientes, undefined);
});

test('volver a invitar borra la clave y cierra sus sesiones; bloquear corta la sesión; deshabilitar el cliente también', async () => {
  const db = dbPortal();
  const tok = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  assert.equal((await cliente(db, 'clienteSesion', { cliente_token: tok })).status, 200);
  const c = filas(db, 'PORTAL_CONTACTOS')[0];
  let r = await staff(db, SUPER, 'portalAdmInvitar', { cliente_id: 'CLI-1', contacto_id: c.contacto_id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await cliente(db, 'clienteSesion', { cliente_token: tok })).status, 403, 'la sesión vieja ya no sirve');
  const tok2 = (await cliente(db, 'clienteActivar', { invitacion: codigoDe(r.body.data.enlace), pin: '739154', pin2: '739154' })).body.data.cliente_token;
  assert.equal((await cliente(db, 'clienteSesion', { cliente_token: tok2 })).status, 200);
  await staff(db, SUPER, 'portalAdmContacto', { contacto_id: c.contacto_id, operacion: 'bloquear' });
  assert.equal((await cliente(db, 'clienteSesion', { cliente_token: tok2 })).status, 403);
  await staff(db, SUPER, 'portalAdmContacto', { contacto_id: c.contacto_id, operacion: 'desbloquear' });
  const tok3 = (await cliente(db, 'clienteEntrar', { rut: RUT_PEDRO, pin: '739154' })).body.data.cliente_token;
  assert.equal((await cliente(db, 'clienteSesion', { cliente_token: tok3 })).status, 200);
  await staff(db, SUPER, 'portalAdmGuardarCliente', { cliente_id: 'CLI-1', habilitado: false });
  assert.equal((await cliente(db, 'clienteSesion', { cliente_token: tok3 })).status, 403, 'portal deshabilitado = nadie de esa empresa entra');
  // El registro lo cuenta todo y queda en la ficha del cliente.
  r = await staff(db, SUPER, 'portalAdmCliente', { cliente_id: 'CLI-1' });
  const acciones = r.body.data.registro.map((x) => x.accion);
  ['INVITACION_NUEVA', 'CONTACTO_BLOQUEAR', 'CONTACTO_DESBLOQUEAR', 'CLIENTE_EDITADO', 'INGRESO'].forEach((a) => assert.ok(acciones.includes(a), a + ' en ' + acciones.join(',')));
  assert.ok(!JSON.stringify(r.body.data.contactos).includes('pin_hash'), 'el hash de la clave nunca viaja');
});

test('un RUT inválido o repetido no se invita', async () => {
  const db = dbPortal();
  await clienteListo(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  let r = await staff(db, SUPER, 'portalAdmInvitar', { cliente_id: 'CLI-1', nombre: 'X', rut: '12.345.678-0' });
  assert.equal(r.status, 400);
  await staff(db, SUPER, 'portalAdmGuardarCliente', { cliente_id: 'CLI-2', habilitado: true });
  r = await staff(db, SUPER, 'portalAdmInvitar', { cliente_id: 'CLI-2', nombre: 'Pedro otra vez', rut: '123456785' });
  assert.equal(r.status, 400, 'el mismo RUT no entra por dos empresas');
});
