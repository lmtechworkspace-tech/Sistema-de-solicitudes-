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
  assert.deepEqual(d.body.data.categorias.map((c) => c.id), ['redes', 'gobierno', 'bancos', 'correo', 'software', 'oficina', 'clientes']);
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

// --- Claves de clientes (2026-10-19) -------------------------------------------------------------

function sembrarClientes(db) {
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CLI-1', razon_social: 'CONSTRUCTORA SAN PABLO SPA', rut: '76.353.457-K', codigo_cliente: 'HP-016-1', estado: 'Activo', bloqueo: 'Activo', activo: true });
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CLI-2', razon_social: 'ESTANCO SPA', rut: '76.516.163-0', codigo_cliente: 'HP-049-1', estado: 'Inactivo', bloqueo: 'Bloqueado', activo: false });
}

test('claves de clientes: la categoría aparece en bóvedas antiguas y se ve solo con acceso', async (t) => {
  const db = preparar(t);
  sembrarClientes(db);
  // Una bóveda creada antes del cambio: sin la categoría «clientes».
  C.dbCred().prepare("DELETE FROM CRED_CATEGORIAS WHERE id = 'clientes'").run();
  C.reiniciarParaPruebas_();
  assert.ok(C.dbCred().prepare("SELECT 1 FROM CRED_CATEGORIAS WHERE id = 'clientes'").get());
  const due = await login(db, 'dueno');
  const { boveda } = await activar(db, due.token);
  assert.equal((await llamar(db, 'credDarAcceso', due.token, { boveda_token: boveda, categoria_id: 'redes', cuenta_id: 'C-MKT' })).status, 200);
  const mkt = await login(db, 'marketing');
  assert.equal((await llamar(db, 'credClientesDatos', mkt.token)).status, 404, 'con otra categoría no ve los clientes');
  assert.equal((await llamar(db, 'credClientesDatos', (await login(db, 'otra')).token)).status, 404);
  const d = await llamar(db, 'credClientesDatos', due.token);
  assert.equal(d.status, 200);
  assert.deepEqual(d.body.data.clientes.map((c) => c.razon_social), ['CONSTRUCTORA SAN PABLO SPA', 'ESTANCO SPA']);
  // No se cuela como credencial suelta de la vista de tarjetas.
  assert.equal((await llamar(db, 'credGuardarCuenta', due.token, { boveda_token: boveda, categoria_id: 'clientes', plataforma: 'ACHS' })).status, 400);
});

test('claves de clientes: cifrada, la lista no la trae, verla exige bóveda y queda en la bitácora', async (t) => {
  const db = preparar(t);
  sembrarClientes(db);
  const due = await login(db, 'dueno');
  const { boveda } = await activar(db, due.token);
  assert.equal((await llamar(db, 'credDarAcceso', due.token, { boveda_token: boveda, categoria_id: 'clientes', cuenta_id: 'C-OTR' })).status, 200);
  const prev = await login(db, 'otra');
  const m = await activar(db, prev.token);
  const sin = await llamar(db, 'credClienteGuardar', prev.token, { cliente_id: 'CLI-1', tipo: 'MUTUAL', institucion: 'ACHS', usuario: '76353457-K', clave: 'achs-777' });
  assert.equal(sin.status, 403);
  const g = await llamar(db, 'credClienteGuardar', prev.token, { boveda_token: m.boveda, cliente_id: 'CLI-1', tipo: 'MUTUAL', institucion: 'ACHS', usuario: '76353457-K', clave: 'achs-777' });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const id = g.body.data.fila.id;
  assert.equal(g.body.data.fila.institucion, 'ACHS');
  assert.equal(g.body.data.fila.estado, 'SIN_PROBAR');
  const fila = C.dbCred().prepare('SELECT secreto FROM CRED_CLIENTES WHERE id = ?').get(id);
  assert.match(fila.secreto, /^v1:/);
  const d = await llamar(db, 'credClientesDatos', prev.token);
  assert.ok(!JSON.stringify(d.body.data).includes('achs-777'));
  assert.equal(d.body.data.filas[0].tiene_clave, true);
  assert.equal(d.body.data.filas[0].usuario, '76353457-K');
  assert.equal((await llamar(db, 'credClienteVerClave', prev.token, { id })).status, 403);
  assert.equal((await llamar(db, 'credClienteVerClave', prev.token, { id, boveda_token: m.boveda })).body.data.clave, 'achs-777');
  // Editar sin clave no la borra; la mutual escrita a mano se reconoce.
  const e = await llamar(db, 'credClienteGuardar', prev.token, { boveda_token: m.boveda, cliente_id: 'CLI-1', tipo: 'MUTUAL', institucion: 'Mutual de Seguridad', usuario: '76353457-K' });
  assert.equal(e.body.data.fila.institucion, 'MUTUAL');
  assert.equal((await llamar(db, 'credClienteVerClave', prev.token, { id, boveda_token: m.boveda })).body.data.clave, 'achs-777');
  // ¿Funcionó? → no; y al cambiar la clave vuelve a «sin probar».
  const n = await llamar(db, 'credClienteMarcar', prev.token, { boveda_token: m.boveda, id, estado: 'NO_FUNCIONA', nota: 'la cambiaron' });
  assert.equal(n.body.data.fila.estado, 'NO_FUNCIONA');
  const c = await llamar(db, 'credClienteGuardar', prev.token, { boveda_token: m.boveda, cliente_id: 'CLI-1', tipo: 'MUTUAL', clave: 'achs-888' });
  assert.equal(c.body.data.fila.estado, 'SIN_PROBAR');
  assert.equal(c.body.data.fila.institucion, 'MUTUAL', 'sin institución se conserva la anterior');
  // Empresa fuera de la base: por RUT válido y con nombre.
  assert.equal((await llamar(db, 'credClienteGuardar', prev.token, { boveda_token: m.boveda, rut: '76.580.031-6', razon_social: 'X', tipo: 'SEREMI' })).status, 400, 'RUT con DV malo');
  const s = await llamar(db, 'credClienteGuardar', prev.token, { boveda_token: m.boveda, rut: '77393259k', razon_social: 'AMMET II SPA', tipo: 'SEREMI', usuario: 'ammet', clave: 's-1' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.data.fila.cliente_id, 'RUT-77393259K');
  assert.equal(s.body.data.fila.rut, '77.393.259-K');
  const d2 = await llamar(db, 'credClientesDatos', prev.token);
  assert.ok(d2.body.data.clientes.some((x) => x.fuera_de_base && x.razon_social === 'AMMET II SPA'));
  const b = await llamar(db, 'credBitacora', due.token, { boveda_token: boveda });
  const acciones = b.body.data.filas.filter((f) => f.categoria_id === 'clientes').map((f) => f.accion);
  ['CREAR', 'VER_CLAVE', 'EDITAR', 'CLAVE_NO_FUNCIONA', 'CAMBIAR_CLAVE'].forEach((a) => assert.ok(acciones.includes(a), a));
  assert.equal(b.body.data.cadena.ok, true);
});

test('claves de clientes: la carga masiva muestra vista previa, no borra claves y avisa errores', async (t) => {
  const db = preparar(t);
  sembrarClientes(db);
  const due = await login(db, 'dueno');
  const { boveda } = await activar(db, due.token);
  await llamar(db, 'credClienteGuardar', due.token, { boveda_token: boveda, cliente_id: 'CLI-1', tipo: 'SEREMI', usuario: 'sp', clave: 'vieja' });
  const filas = [
    { empresa: 'Constructora San Pablo', rut: '76353457-k', mutual: 'achs', usuario_mutual: 'sp-achs', clave_mutual: 'm-1', usuario_seremi: 'sp', clave_seremi: '' },
    { empresa: 'Nueva SPA', rut: '77.649.209-4', mutual: 'IST', usuario_mutual: 'n', clave_mutual: 'n-1' },
    { empresa: 'Mala', rut: '78-8', mutual: 'achs' },
    { empresa: 'Repetida', rut: '76.353.457-K', mutual: 'IST' },
    { empresa: 'Rara', rut: '76.516.163-0', mutual: 'Otra cosa', usuario_seremi: 'e', clave_seremi: 'e-1' }
  ];
  const p = await llamar(db, 'credClientesImportar', due.token, { boveda_token: boveda, filas });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.data.vista_previa, true);
  assert.deepEqual(p.body.data.conteo, { nuevas: 3, actualizadas: 0, sin_cambios: 1, errores: 2, fuera_de_base: 1 });
  assert.equal(C.dbCred().prepare('SELECT COUNT(*) AS n FROM CRED_CLIENTES').get().n, 1, 'la vista previa no guarda');
  assert.ok(p.body.data.filas.some((f) => f.avisos && f.avisos.length));
  const ok = await llamar(db, 'credClientesImportar', due.token, { boveda_token: boveda, filas, confirmar: true });
  assert.equal(ok.body.data.conteo.nuevas, 3);
  const d = (await llamar(db, 'credClientesDatos', due.token)).body.data;
  const seremi = d.filas.find((f) => f.cliente_id === 'CLI-1' && f.tipo === 'SEREMI');
  assert.equal((await llamar(db, 'credClienteVerClave', due.token, { boveda_token: boveda, id: seremi.id })).body.data.clave, 'vieja', 'celda vacía no borra');
  assert.equal(d.filas.find((f) => f.cliente_id === 'CLI-1' && f.tipo === 'MUTUAL').institucion, 'ACHS');
  assert.ok(d.clientes.some((c) => c.cliente_id === 'RUT-776492094' && c.razon_social === 'Nueva SPA'));
});
