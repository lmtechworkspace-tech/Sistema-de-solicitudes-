'use strict';

/**
 * Finanzas, Etapa 1 (2026-10-06): la bóveda. Lo que se prueba es que nadie
 * fuera de la lista pueda ni saber que existe, que el segundo factor sea de
 * verdad (TOTP RFC 6238, sin repetir códigos, con bloqueo) y que la
 * bitácora delate cualquier edición a mano.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Hash = require('../logica/passwordHash');
const { ejecutarAccion } = require('../server/router');
const B = require('../logica/finanzasBoveda');

const CLAVE = 'Clave-Segura-123';

function preparar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-fin-'));
  const previo = {
    SIGSO_FINANZAS_DB_PATH: process.env.SIGSO_FINANZAS_DB_PATH, SIGSO_FINANZAS_LLAVE: process.env.SIGSO_FINANZAS_LLAVE,
    SIGSO_FINANZAS_ACCESO: process.env.SIGSO_FINANZAS_ACCESO, SIGSO_FINANZAS_AVISAR: process.env.SIGSO_FINANZAS_AVISAR
  };
  process.env.SIGSO_FINANZAS_DB_PATH = path.join(dir, 'finanzas.db');
  process.env.SIGSO_FINANZAS_LLAVE = crypto.randomBytes(32).toString('base64');
  process.env.SIGSO_FINANZAS_ACCESO = 'balvarez, Lisseth@HomePymes.cl';
  process.env.SIGSO_FINANZAS_AVISAR = 'luis@homepymes.cl';
  B.reiniciarParaPruebas_();
  t.after(() => {
    B.reiniciarParaPruebas_();
    Object.keys(previo).forEach((k) => { if (previo[k] === undefined) delete process.env[k]; else process.env[k] = previo[k]; });
  });

  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  const cuenta = (id, usuario, nombre, email, rol, extra) => {
    const salt = Hash.generarSalt();
    agregarFila_(db, 'CUENTAS_PORTAL', Object.assign({
      cuenta_id: id, usuario, nombre, cargo: '', emails: JSON.stringify([email]), rol, modulos: '[]', empresa_id: 'HP',
      activo: true, salt, hash_password: Hash.hashPassword(CLAVE, salt), debe_cambiar_password: false
    }, extra || {}));
  };
  cuenta('C-BAR', 'balvarez', 'Bárbara Álvarez', 'barbara@homepymes.cl', 'JEFATURA');
  cuenta('C-LIS', 'lvilchez', 'Lisseth Vilchez', 'lisseth@homepymes.cl', 'DEV');
  // ADM y super admin de SIGSO, pero fuera de la lista de la bóveda.
  cuenta('C-ADM', 'admin', 'Administrador', 'admin@homepymes.cl', 'ADM', { super_admin: true });
  return db;
}

async function login(db, usuario) {
  const r = await ejecutarAccion(db, 'portalLogin', { usuario, password: CLAVE }, { ip: '10.0.0.1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
const llamar = (db, accion, token, extra) => ejecutarAccion(db, accion, Object.assign({ portal_token: token, equipo: 'eq-1' }, extra || {}), { ip: '10.0.0.9' });
function codigoAhora(clave, desfase) { return B.codigoTotp(clave.replace(/\s/g, ''), B.contadorActual_() + (desfase || 0)); }

async function activar(db, token) {
  const p = await llamar(db, 'finanzasPrepararAutenticador', token, { password: CLAVE });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const a = await llamar(db, 'finanzasActivarAutenticador', token, { codigo: codigoAhora(p.body.data.clave) });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  return { clave: p.body.data.clave, boveda: a.body.data.boveda_token };
}

test('TOTP calza con los vectores del RFC 6238 (SHA1, 6 dígitos)', () => {
  const secreto = B.base32(Buffer.from('12345678901234567890'));
  assert.equal(secreto, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  // RFC 6238 Anexo B: T=59 -> 94287082, T=1111111109 -> 07081804 (8 dígitos; aquí los últimos 6).
  assert.equal(B.codigoTotp(secreto, Math.floor(59 / 30)), '287082');
  assert.equal(B.codigoTotp(secreto, Math.floor(1111111109 / 30)), '081804');
  assert.deepEqual(B.desdeBase32(secreto), Buffer.from('12345678901234567890'));
});

test('el cifrado es AES-GCM de verdad: ida y vuelta, y otra llave no lo abre', (t) => {
  preparar(t);
  const sobre = B.cifrar('saldo 1.234.567');
  assert.match(sobre, /^v1:/);
  assert.ok(!sobre.includes('1.234.567'));
  assert.equal(B.descifrar(sobre), 'saldo 1.234.567');
  process.env.SIGSO_FINANZAS_LLAVE = crypto.randomBytes(32).toString('base64');
  assert.throws(() => B.descifrar(sobre));
});

test('fuera de la lista (aunque sea ADM y super admin) la bóveda no existe: 404 idéntico a una acción inventada', async (t) => {
  const db = preparar(t);
  const adm = await login(db, 'admin');
  assert.equal(adm.cuenta.finanzas, undefined, 'la sesión ni siquiera trae el campo');
  const inventada = await llamar(db, 'finanzasNoExiste', adm.token);
  for (const accion of ['finanzasEstado', 'finanzasPrepararAutenticador', 'finanzasEntrar', 'finanzasBitacora', 'finanzasResumen', 'finanzasSalir']) {
    const r = await llamar(db, accion, adm.token, { password: CLAVE, codigo: '123456' });
    assert.equal(r.status, 404, accion);
    assert.deepEqual(Object.keys(r.body), Object.keys(inventada.body));
    assert.equal(r.body.error, 'Acción desconocida: ' + accion);
  }
  // Sin sesión de SIGSO, lo de siempre.
  assert.equal((await ejecutarAccion(db, 'finanzasEstado', {}, {})).status, 403);
});

test('la lista acepta usuario o correo (sin importar mayúsculas) y la sesión lo avisa al menú', async (t) => {
  const db = preparar(t);
  assert.equal((await login(db, 'balvarez')).cuenta.finanzas, true);
  assert.equal((await login(db, 'lvilchez')).cuenta.finanzas, true, 'entró por su correo');
  process.env.SIGSO_FINANZAS_ACCESO = '';
  assert.equal((await login(db, 'balvarez')).cuenta.finanzas, undefined, 'lista vacía = nadie');
});

test('con cuenta_id en la lista, renombrar otra cuenta con ese usuario, correo o id no da acceso', async (t) => {
  const db = preparar(t);
  const ID = '0f0e0d0c-0b0a-4090-8070-605040302010';
  require('../db/sqliteRepo').actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', 'C-BAR', { cuenta_id: ID });
  process.env.SIGSO_FINANZAS_ACCESO = ID;
  assert.equal((await login(db, 'balvarez')).cuenta.finanzas, true);
  // El ADM se pone como usuario el UUID de Bárbara: no calza.
  require('../db/sqliteRepo').actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', 'C-ADM', { usuario: ID, emails: JSON.stringify([ID]) });
  assert.equal((await login(db, ID)).cuenta.finanzas, undefined);
});

test('sin llave en el servidor la bóveda no abre (pero a la lista le explica por qué)', async (t) => {
  const db = preparar(t);
  const s = await login(db, 'balvarez');
  delete process.env.SIGSO_FINANZAS_LLAVE;
  const e = await llamar(db, 'finanzasEstado', s.token);
  assert.equal(e.body.data.llave_configurada, false);
  assert.equal((await llamar(db, 'finanzasPrepararAutenticador', s.token, { password: CLAVE })).status, 403);
});

test('activar el autenticador exige la contraseña de SIGSO; con un código válido abre la bóveda', async (t) => {
  const db = preparar(t);
  const s = await login(db, 'balvarez');
  const mala = await llamar(db, 'finanzasPrepararAutenticador', s.token, { password: 'otra' });
  assert.equal(mala.status, 403);
  const p = await llamar(db, 'finanzasPrepararAutenticador', s.token, { password: CLAVE });
  assert.match(p.body.data.uri, /^otpauth:\/\/totp\/SIGSO%20Finanzas%3Abalvarez\?secret=[A-Z2-7]{32}&issuer=SIGSO%20Finanzas/);
  // El secreto no queda en claro en la base.
  const fila = B.dbFin().prepare('SELECT secreto FROM FIN_AUTENTICADOR WHERE cuenta_id = ?').get('C-BAR');
  assert.ok(!fila.secreto.includes(p.body.data.clave.replace(/\s/g, '')));
  const r = await llamar(db, 'finanzasActivarAutenticador', s.token, { codigo: codigoAhora(p.body.data.clave) });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.boveda_token);
  const e = await llamar(db, 'finanzasEstado', s.token, { boveda_token: r.body.data.boveda_token });
  assert.deepEqual([e.body.data.autenticador_activo, e.body.data.sesion_activa], [true, true]);
  // Un autenticador activo no se reemplaza desde la pantalla.
  assert.equal((await llamar(db, 'finanzasPrepararAutenticador', s.token, { password: CLAVE })).status, 403);
});

test('un código no sirve dos veces, uno viejo tampoco, y 5 malos bloquean', async (t) => {
  const db = preparar(t);
  const s = await login(db, 'balvarez');
  const { clave } = await activar(db, s.token);
  const repetido = await llamar(db, 'finanzasEntrar', s.token, { codigo: codigoAhora(clave) });
  assert.equal(repetido.status, 400, 'el mismo código que se usó al activar');
  assert.equal((await llamar(db, 'finanzasEntrar', s.token, { codigo: codigoAhora(clave, -1) })).status, 400, 'un paso anterior ya consumido');
  assert.equal((await llamar(db, 'finanzasEntrar', s.token, { codigo: codigoAhora(clave, -10) })).status, 400, 'fuera de la ventana');
  const ok = await llamar(db, 'finanzasEntrar', s.token, { codigo: codigoAhora(clave, 1) });
  assert.equal(ok.status, 200, 'el siguiente paso sí (reloj del teléfono adelantado)');
  for (let i = 0; i < 5; i++) await llamar(db, 'finanzasEntrar', s.token, { codigo: '000000' });
  const bloqueado = await llamar(db, 'finanzasEntrar', s.token, { codigo: codigoAhora(clave, 1) });
  assert.equal(bloqueado.status, 403);
  assert.match(bloqueado.body.message, /15 minutos/);
});

test('los datos exigen la bóveda abierta; se cierra al salir y por inactividad', async (t) => {
  const db = preparar(t);
  const s = await login(db, 'balvarez');
  const { boveda } = await activar(db, s.token);
  const sinBoveda = await llamar(db, 'finanzasResumen', s.token);
  assert.equal(sinBoveda.status, 403);
  assert.equal(sinBoveda.body.boveda_cerrada, true);
  const con = await llamar(db, 'finanzasResumen', s.token, { boveda_token: boveda });
  assert.equal(con.status, 200);
  assert.equal(con.body.data.personas_con_acceso, 2);
  // El token de Bárbara no le sirve a Lisseth.
  const lis = await login(db, 'lvilchez');
  assert.equal((await llamar(db, 'finanzasResumen', lis.token, { boveda_token: boveda })).status, 403);
  // Inactividad: se envejece el último uso 16 minutos.
  B.dbFin().prepare('UPDATE FIN_SESIONES SET ultimo_uso = ultimo_uso - ?').run(16 * 60 * 1000);
  assert.equal((await llamar(db, 'finanzasResumen', s.token, { boveda_token: boveda })).status, 403);
  const { boveda: b2 } = { boveda: (await llamar(db, 'finanzasEntrar', s.token, { codigo: B.codigoTotp((B.descifrar(B.dbFin().prepare('SELECT secreto FROM FIN_AUTENTICADOR').get().secreto)), B.contadorActual_() + 1) })).body.data.boveda_token };
  assert.equal((await llamar(db, 'finanzasSalir', s.token, { boveda_token: b2 })).status, 200);
  assert.equal((await llamar(db, 'finanzasResumen', s.token, { boveda_token: b2 })).status, 403);
});

test('bitácora encadenada: registra todo, y editar una fila a mano rompe la cadena', async (t) => {
  const db = preparar(t);
  const s = await login(db, 'balvarez');
  await llamar(db, 'finanzasPrepararAutenticador', s.token, { password: 'mala' });
  const { boveda } = await activar(db, s.token);
  const r = await llamar(db, 'finanzasBitacora', s.token, { boveda_token: boveda });
  const acciones = r.body.data.filas.map((f) => f.accion).reverse();
  assert.deepEqual(acciones, ['AUTENTICADOR_CLAVE_INCORRECTA', 'AUTENTICADOR_PREPARADO', 'AUTENTICADOR_ACTIVADO', 'ENTRAR', 'VER_BITACORA']);
  assert.equal(r.body.data.filas[0].ip, '10.0.0.9');
  assert.equal(r.body.data.cadena.ok, true);
  B.dbFin().prepare("UPDATE FIN_BITACORA SET nombre = 'Otra persona' WHERE accion = 'ENTRAR'").run();
  const despues = B.verificarCadena_();
  assert.equal(despues.ok, false);
  assert.ok(despues.rota_en > 0);
});

test('ingreso desde un equipo nuevo avisa en SIGSO a quien corresponde, sin cifras', async (t) => {
  const db = preparar(t);
  const s = await login(db, 'balvarez');
  await activar(db, s.token);
  const avisos = require('../db/sqliteRepo').leerFilas_(db, 'NOTIFICACIONES_APP', COLUMNAS.NOTIFICACIONES_APP);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].destinatario_email, 'luis@homepymes.cl');
  assert.match(avisos[0].titulo, /equipo nuevo/);
  assert.ok(!/\$|\d{3}\.\d{3}/.test(avisos[0].mensaje));
});

test('reiniciar el autenticador (teléfono perdido) cierra sus sesiones y queda en la bitácora', async (t) => {
  const db = preparar(t);
  const s = await login(db, 'balvarez');
  const { boveda } = await activar(db, s.token);
  assert.equal(B.reiniciarAutenticador_('C-BAR', 'teléfono perdido'), 1);
  assert.equal((await llamar(db, 'finanzasResumen', s.token, { boveda_token: boveda })).status, 403);
  assert.equal((await llamar(db, 'finanzasEstado', s.token)).body.data.autenticador_activo, false);
  assert.equal(B.verificarCadena_().ok, true);
});
