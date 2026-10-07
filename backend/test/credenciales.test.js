'use strict';

/**
 * Credenciales (2026-10-07): la bóveda de claves de la empresa. Se prueba que
 * quien no tiene ninguna categoría ni sepa que existe, que la lista nunca
 * lleve la clave, que ver o cambiar una clave exija el código, que el acceso
 * sea por categoría y que la bitácora delate ediciones a mano.
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
const C = require('../logica/credenciales');
const B = require('../logica/finanzasBoveda');

const CLAVE = 'Clave-Segura-123';

function preparar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-cred-'));
  const previo = { SIGSO_CREDENCIALES_DB_PATH: process.env.SIGSO_CREDENCIALES_DB_PATH, SIGSO_CREDENCIALES_LLAVE: process.env.SIGSO_CREDENCIALES_LLAVE, SIGSO_FINANZAS_LLAVE: process.env.SIGSO_FINANZAS_LLAVE };
  process.env.SIGSO_CREDENCIALES_DB_PATH = path.join(dir, 'credenciales.db');
  delete process.env.SIGSO_CREDENCIALES_LLAVE;
  process.env.SIGSO_FINANZAS_LLAVE = crypto.randomBytes(32).toString('base64');
  C.reiniciarParaPruebas_();
  t.after(() => {
    C.reiniciarParaPruebas_();
    Object.keys(previo).forEach((k) => { if (previo[k] === undefined) delete process.env[k]; else process.env[k] = previo[k]; });
  });
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  const cuenta = (id, usuario, nombre, extra) => {
    const salt = Hash.generarSalt();
    agregarFila_(db, 'CUENTAS_PORTAL', Object.assign({
      cuenta_id: id, usuario, nombre, cargo: '', emails: JSON.stringify([usuario + '@demo.cl']), rol: 'DEV', modulos: '[]', empresa_id: 'HP',
      activo: true, salt, hash_password: Hash.hashPassword(CLAVE, salt), debe_cambiar_password: false
    }, extra || {}));
  };
  cuenta('C-DUE', 'dueno', 'Dueño Demo', { rol: 'ADM', super_admin: true });
  cuenta('C-MKT', 'marketing', 'Camila Demo');
  cuenta('C-OTR', 'otra', 'Otra Persona');
  cuenta('C-EX', 'exdemo', 'Ex Trabajador', { activo: false });
  return db;
}
async function login(db, usuario) {
  const r = await ejecutarAccion(db, 'portalLogin', { usuario, password: CLAVE }, { ip: '10.0.0.1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
const llamar = (db, accion, token, extra) => ejecutarAccion(db, accion, Object.assign({ portal_token: token, equipo: 'eq-1' }, extra || {}), { ip: '10.0.0.9' });
const codigo = (clave, d) => B.codigoTotp(clave.replace(/\s/g, ''), B.contadorActual_() + (d || 0));
async function activar(db, token) {
  const p = await llamar(db, 'credPrepararAutenticador', token, { password: CLAVE });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const a = await llamar(db, 'credActivarAutenticador', token, { codigo: codigo(p.body.data.clave) });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  return { clave: p.body.data.clave, boveda: a.body.data.boveda_token };
}

test('sin categorías la bóveda «no existe»; el super admin la ve y el perfil lo marca', async (t) => {
  const db = preparar(t);
  const otra = await login(db, 'otra');
  assert.equal((await llamar(db, 'credDatos', otra.token)).status, 404);
  assert.equal((await llamar(db, 'credEstado', otra.token)).status, 404);
  assert.ok(!otra.cuenta.credenciales);
  const due = await login(db, 'dueno');
  assert.equal(due.cuenta.credenciales, true);
  const d = await llamar(db, 'credDatos', due.token);
  assert.equal(d.status, 200);
  assert.equal(d.body.data.es_admin, true);
  assert.deepEqual(d.body.data.categorias.map((c) => c.id), ['redes', 'gobierno', 'bancos', 'correo', 'software', 'oficina']);
});

test('la clave va cifrada, la lista no la trae y verla exige la bóveda abierta y queda registrado', async (t) => {
  const db = preparar(t);
  const due = await login(db, 'dueno');
  const { boveda } = await activar(db, due.token);
  const sin = await llamar(db, 'credGuardarCuenta', due.token, { categoria_id: 'redes', plataforma: 'Facebook', clave: 'demo-123' });
  assert.equal(sin.status, 403);
  assert.equal(sin.body.boveda_cerrada, true);
  const g = await llamar(db, 'credGuardarCuenta', due.token, {
    boveda_token: boveda, categoria_id: 'redes', plataforma: 'Facebook', usuario: 'HomePymes', clave: 'demo-123', notas_privadas: 'pregunta: perro',
    dos_pasos: false, personas: [{ nombre: 'Camila Demo', rol: 'PUBLICA' }, { nombre: 'Ex Trabajador', rol: 'EDITA' }, { nombre: 'camila demo' }]
  });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const id = g.body.data.cuenta.id;
  const fila = C.dbCred().prepare('SELECT secreto, clave_cambiada_en FROM CRED_CUENTAS WHERE id = ?').get(id);
  assert.match(fila.secreto, /^v1:/);
  assert.ok(!fila.secreto.includes('demo-123'));
  assert.ok(fila.clave_cambiada_en);
  const d = await llamar(db, 'credDatos', due.token);
  assert.ok(!JSON.stringify(d.body.data).includes('demo-123'));
  const c = d.body.data.cuentas[0];
  assert.equal(c.tiene_clave, true);
  assert.equal(c.personas.length, 2, 'sin duplicados por mayúsculas');
  const tipos = d.body.data.avisos.map((a) => a.tipo).sort();
  assert.deepEqual(tipos, ['PERSONA_INACTIVA', 'SIN_2FA']);
  assert.equal((await llamar(db, 'credVerClave', due.token, { id })).status, 403);
  const v = await llamar(db, 'credVerClave', due.token, { id, boveda_token: boveda });
  assert.equal(v.body.data.clave, 'demo-123');
  assert.equal(v.body.data.notas_privadas, 'pregunta: perro');
  // Editar sin mandar la clave no la borra ni mueve la fecha de cambio.
  const e = await llamar(db, 'credGuardarCuenta', due.token, { boveda_token: boveda, id, categoria_id: 'redes', plataforma: 'Facebook', usuario: 'HomePymes', dos_pasos: true });
  assert.equal(e.status, 200);
  assert.equal((await llamar(db, 'credVerClave', due.token, { id, boveda_token: boveda })).body.data.clave, 'demo-123');
  const b = await llamar(db, 'credBitacora', due.token, { boveda_token: boveda });
  const acciones = b.body.data.filas.map((f) => f.accion);
  ['CREAR', 'VER_CLAVE', 'EDITAR', 'ENTRAR', 'AUTENTICADOR_ACTIVADO'].forEach((a) => assert.ok(acciones.includes(a), a));
  assert.equal(b.body.data.cadena.ok, true);
});

test('el acceso es por categoría y solo el super admin lo da o quita', async (t) => {
  const db = preparar(t);
  const due = await login(db, 'dueno');
  const { boveda } = await activar(db, due.token);
  const r = await llamar(db, 'credGuardarCuenta', due.token, { boveda_token: boveda, categoria_id: 'redes', plataforma: 'TikTok', clave: 'tt-1' });
  const g = await llamar(db, 'credGuardarCuenta', due.token, { boveda_token: boveda, categoria_id: 'gobierno', plataforma: 'SII', clave: 'sii-1' });
  assert.equal((await llamar(db, 'credDarAcceso', due.token, { boveda_token: boveda, categoria_id: 'redes', cuenta_id: 'C-MKT' })).status, 200);
  const mkt = await login(db, 'marketing');
  assert.equal(mkt.cuenta.credenciales, true);
  const d = await llamar(db, 'credDatos', mkt.token);
  assert.deepEqual(d.body.data.categorias.map((c) => c.id), ['redes']);
  assert.deepEqual(d.body.data.cuentas.map((c) => c.plataforma), ['TikTok']);
  assert.equal(d.body.data.es_admin, false);
  const m = await activar(db, mkt.token);
  assert.equal((await llamar(db, 'credVerClave', mkt.token, { boveda_token: m.boveda, id: r.body.data.cuenta.id })).body.data.clave, 'tt-1');
  assert.equal((await llamar(db, 'credVerClave', mkt.token, { boveda_token: m.boveda, id: g.body.data.cuenta.id })).status, 400);
  assert.equal((await llamar(db, 'credGuardarCuenta', mkt.token, { boveda_token: m.boveda, categoria_id: 'gobierno', plataforma: 'TGR' })).status, 400);
  assert.equal((await llamar(db, 'credDarAcceso', mkt.token, { boveda_token: m.boveda, categoria_id: 'gobierno', cuenta_id: 'C-MKT' })).status, 403);
  // Quitar el acceso cierra su bóveda abierta y el módulo desaparece.
  assert.equal((await llamar(db, 'credQuitarAcceso', due.token, { boveda_token: boveda, categoria_id: 'redes', cuenta_id: 'C-MKT' })).status, 200);
  assert.equal((await llamar(db, 'credDatos', mkt.token)).status, 404);
});

test('códigos: no se repiten y 5 malos bloquean', async (t) => {
  const db = preparar(t);
  const due = await login(db, 'dueno');
  const { clave } = await activar(db, due.token);
  assert.equal((await llamar(db, 'credEntrar', due.token, { codigo: codigo(clave) })).status, 400, 'el mismo código ya se usó');
  for (let i = 0; i < 3; i++) assert.equal((await llamar(db, 'credEntrar', due.token, { codigo: '000000' })).status, 400);
  assert.equal((await llamar(db, 'credEntrar', due.token, { codigo: '000000' })).status, 400);
  assert.equal((await llamar(db, 'credEntrar', due.token, { codigo: codigo(clave, 1) })).status, 403, 'bloqueado aunque el código sea bueno');
});

test('editar la bitácora a mano rompe la cadena', async (t) => {
  const db = preparar(t);
  const due = await login(db, 'dueno');
  await activar(db, due.token);
  assert.equal(C.verificarCadena_().ok, true);
  C.dbCred().prepare("UPDATE CRED_BITACORA SET nombre = 'otro' WHERE id = 1").run();
  assert.equal(C.verificarCadena_().ok, false);
});

test('sin llave de Finanzas ni propia, la bóveda avisa y no cifra', async (t) => {
  const db = preparar(t);
  delete process.env.SIGSO_FINANZAS_LLAVE;
  const due = await login(db, 'dueno');
  const e = await llamar(db, 'credEstado', due.token);
  assert.equal(e.body.data.llave_configurada, false);
  assert.equal((await llamar(db, 'credPrepararAutenticador', due.token, { password: CLAVE })).status, 403);
});
