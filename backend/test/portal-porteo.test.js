'use strict';

/**
 * Prueba de portabilidad: los MISMOS escenarios de backend/test/portal.test.js
 * (login/logout/sesion/cambiarPassword) corridos contra backend/logica/
 * portal.js (Node + SQLite + scrypt) en vez de Portal.gs (Apps Script +
 * Sheets + SHA-256 iterado). No se porta "el hash de Intake y el de
 * Backoffice son identicos": esa prueba existia porque el .gs duplica el
 * hash entre DOS proyectos separados (backend/intake y backend/backoffice) y
 * podian divergir; aqui hay un solo modulo compartido (passwordHash.js), la
 * duplicacion que motivaba el test ya no existe.
 *
 * Sesiones.js usa un Map en memoria (a nivel de modulo, sobrevive entre
 * tests del mismo archivo) para el limite anti fuerza bruta -- cada test usa
 * un usuario DISTINTO a proposito para no heredar intentos fallidos de un
 * test anterior.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Portal = require('../logica/portal');
const CuentasPortal = require('../logica/cuentasPortal');

const ADMIN = { email: 'admin@homepymes.cl', rol: 'ADM' };

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

function crearCuenta(db, usuario, extra) {
  const res = CuentasPortal.gestionar(db, Object.assign({
    operacion: 'crear', usuario: usuario, nombre: 'Camila Pena', emails: usuario + '@gde.cl'
  }, extra), ADMIN);
  assert.ok(!res._validationError, JSON.stringify(res));
  return res;
}

test('login con cuenta creada por el Admin: clave temporal funciona y exige cambio', () => {
  const db = dbConSchema();
  const creada = crearCuenta(db, 'cpena-login-ok', {
    cargo: 'Jefa de Operaciones', emails: 'camila@gde.cl, camila.pena@gmail.com', rol: 'SOLICITANTE'
  });

  const res = Portal.login(db, { usuario: 'CPena-Login-OK', password: creada.password_temporal });
  assert.ok(res.token, 'debe emitir token');
  assert.equal(res.cuenta.nombre, 'Camila Pena');
  assert.equal(res.cuenta.debe_cambiar_password, true);
  assert.deepEqual(res.cuenta.modulos, ['nueva_solicitud', 'mis_solicitudes', 'mi_trabajo']);
  assert.deepEqual(res.cuenta.emails, ['camila@gde.cl', 'camila.pena@gmail.com']);
  assert.equal(res.cuenta.hash_password, undefined);
  assert.equal(res.cuenta.salt, undefined);
});

test('login con clave incorrecta o usuario inexistente: mismo mensaje (no filtra usuarios)', () => {
  const db = dbConSchema();
  crearCuenta(db, 'cpena-mismo-msg');

  const malaClave = Portal.login(db, { usuario: 'cpena-mismo-msg', password: 'no-es-la-clave' });
  const noExiste = Portal.login(db, { usuario: 'fantasma-mismo-msg', password: 'lo-que-sea' });
  assert.equal(malaClave._forbidden, true);
  assert.equal(noExiste._forbidden, true);
  assert.equal(malaClave.message, noExiste.message);
});

// Anti-enumeración por TIEMPO, no solo por mensaje: antes de esta prueba,
// Hash.coincide (scrypt) solo se calculaba si la cuenta existia -- un
// usuario inexistente respondia casi al instante, delatando por tiempo lo
// que el mensaje identico (prueba de arriba) ya escondia. Se corre cada
// camino varias veces y se compara el promedio: no deberia haber una
// diferencia de orden de magnitud entre "cuenta no existe" y "cuenta existe,
// clave mala" (ambos deben pagar el costo de scrypt).
test('login: el TIEMPO de respuesta tampoco delata si la cuenta existe', () => {
  const db = dbConSchema();
  crearCuenta(db, 'cpena-timing');

  function medir(usuario) {
    const antes = process.hrtime.bigint();
    Portal.login(db, { usuario, password: 'lo-que-sea-nunca-coincide' });
    return Number(process.hrtime.bigint() - antes) / 1e6;
  }

  const REPETICIONES = 15;
  let totalExistente = 0;
  let totalInexistente = 0;
  for (let i = 0; i < REPETICIONES; i++) {
    totalExistente += medir('cpena-timing');
    totalInexistente += medir('fantasma-timing-' + i); // usuario distinto: no dispara el bloqueo por intentos
  }
  const promedioExistente = totalExistente / REPETICIONES;
  const promedioInexistente = totalInexistente / REPETICIONES;

  // No deberian diferir en mas de 5x -- sin el fix, cuenta inexistente
  // corria en microsegundos y cuenta existente pagaba scrypt completo
  // (decenas de ms), una diferencia de dos ordenes de magnitud.
  const razon = Math.max(promedioExistente, promedioInexistente) / Math.max(1, Math.min(promedioExistente, promedioInexistente));
  assert.ok(razon < 5, 'la razon de tiempos deberia ser chica; existente=' + promedioExistente.toFixed(2) + 'ms inexistente=' + promedioInexistente.toFixed(2) + 'ms razon=' + razon.toFixed(2));
});

test('5 intentos fallidos bloquean el login 10 minutos, incluso con la clave correcta', () => {
  const db = dbConSchema();
  const creada = crearCuenta(db, 'cpena-bloqueo');

  for (let i = 0; i < 5; i++) {
    Portal.login(db, { usuario: 'cpena-bloqueo', password: 'mala-' + i });
  }
  const bloqueado = Portal.login(db, { usuario: 'cpena-bloqueo', password: creada.password_temporal });
  assert.equal(bloqueado._forbidden, true);
  assert.match(bloqueado.message, /Demasiados intentos/);
});

// El bloqueo se indexa por (usuario, IP): sin esto, un atacante sin ninguna
// credencial podia mandar 5 intentos fallidos con el usuario de otra
// persona y dejarla bloqueada 10 minutos, aunque el atacante nunca haya
// tenido acceso a esa cuenta.
test('el bloqueo por intentos fallidos es por IP: un atacante no puede bloquear a la victima desde SU propia IP', () => {
  const db = dbConSchema();
  const creada = crearCuenta(db, 'cpena-ip-victima');

  // El atacante, desde su propia IP, intenta adivinar la clave 5 veces.
  for (let i = 0; i < 5; i++) {
    Portal.login(db, { usuario: 'cpena-ip-victima', password: 'adivinando-' + i }, '203.0.113.9');
  }
  const atacanteBloqueado = Portal.login(db, { usuario: 'cpena-ip-victima', password: 'otra-mas' }, '203.0.113.9');
  assert.equal(atacanteBloqueado._forbidden, true, 'el atacante si queda bloqueado en SU IP');

  // La victima, desde SU propia IP (distinta), entra normal con su clave real.
  const victima = Portal.login(db, { usuario: 'cpena-ip-victima', password: creada.password_temporal }, '198.51.100.42');
  assert.ok(victima.token, 'la victima no hereda el bloqueo que genero el atacante desde otra IP');
});

test('un login exitoso limpia el contador de intentos', () => {
  const db = dbConSchema();
  const creada = crearCuenta(db, 'cpena-limpia');

  for (let i = 0; i < 4; i++) {
    Portal.login(db, { usuario: 'cpena-limpia', password: 'mala-' + i });
  }
  const ok = Portal.login(db, { usuario: 'cpena-limpia', password: creada.password_temporal });
  assert.ok(ok.token);
  Portal.login(db, { usuario: 'cpena-limpia', password: 'mala-de-nuevo' });
  const ok2 = Portal.login(db, { usuario: 'cpena-limpia', password: creada.password_temporal });
  assert.ok(ok2.token);
});

test('portalSesion restaura la sesion; logout la invalida', () => {
  const db = dbConSchema();
  const creada = crearCuenta(db, 'cpena-sesion');
  const { token } = Portal.login(db, { usuario: 'cpena-sesion', password: creada.password_temporal });

  assert.equal(Portal.sesion(db, { token }).cuenta.usuario, 'cpena-sesion');
  Portal.logout(db, { token });
  assert.equal(Portal.sesion(db, { token })._forbidden, true);
});

test('desactivar la cuenta corta la sesion aunque el token siga vigente', () => {
  const db = dbConSchema();
  const creada = crearCuenta(db, 'cpena-desactivar');
  const { token } = Portal.login(db, { usuario: 'cpena-desactivar', password: creada.password_temporal });
  assert.ok(Portal.sesion(db, { token }).cuenta);

  const { actualizarFilaPorId_ } = require('../db/sqliteRepo');
  actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'usuario', 'cpena-desactivar', { activo: false });
  assert.equal(Portal.sesion(db, { token })._forbidden, true);
  assert.equal(Portal.login(db, { usuario: 'cpena-desactivar', password: creada.password_temporal })._forbidden, true);
});

test('cambiarPassword: exige la actual, minimo 8, y apaga debe_cambiar_password', () => {
  const db = dbConSchema();
  const creada = crearCuenta(db, 'cpena-cambiar');
  const { token } = Portal.login(db, { usuario: 'cpena-cambiar', password: creada.password_temporal });

  assert.equal(Portal.cambiarPassword(db, {
    token, password_actual: 'equivocada', password_nueva: 'clave-nueva-larga'
  })._forbidden, true);
  assert.equal(Portal.cambiarPassword(db, {
    token, password_actual: creada.password_temporal, password_nueva: 'corta'
  })._validationError, true);

  const ok = Portal.cambiarPassword(db, {
    token, password_actual: creada.password_temporal, password_nueva: 'clave-nueva-larga'
  });
  assert.equal(ok.ok, true);
  assert.equal(Portal.login(db, { usuario: 'cpena-cambiar', password: creada.password_temporal })._forbidden, true);
  const relogin = Portal.login(db, { usuario: 'cpena-cambiar', password: 'clave-nueva-larga' });
  assert.ok(relogin.token);
  assert.equal(relogin.cuenta.debe_cambiar_password, false);
});
