'use strict';

/**
 * SIGSO v2, Módulo 7A — Salud de la configuración (SaludConfig): revisiones
 * cruzadas (cuentas, jefaturas, pausas, datos) y arreglos en un clic que
 * pasan por las mismas funciones de Administración.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const SaludConfig = require('../logica/saludConfig');

const ADM = { rol: 'ADM', email: 'admin@x.cl' };

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function cuenta(db, id, email, o) {
  agregarFila_(db, 'CUENTAS_PORTAL', Object.assign({
    cuenta_id: id, usuario: id, nombre: 'Nombre ' + id, emails: JSON.stringify([email]), rol: 'DEV',
    modulos: JSON.stringify(['nueva_solicitud']), empresa_id: 'HP', activo: true, debe_cambiar_password: false,
    ultimo_acceso: new Date().toISOString(), hash_password: 'h', salt: 's'
  }, o || {}));
}
function check(r, id) { return r.checks.find((c) => c.id === id); }

test('Solo ADM ve la salud y aplica arreglos', () => {
  const db = db_();
  assert.equal(SaludConfig.getSalud(db, {}, { rol: 'DEV', email: 'x@x.cl' })._forbidden, true);
  assert.equal(SaludConfig.arreglar(db, {}, { rol: 'GERENCIA', email: 'x@x.cl' })._forbidden, true);
});

test('Detecta clave temporal, jefe sin módulo, jefe sin cuenta y correo repetido', () => {
  const db = db_();
  cuenta(db, 'A', 'ana@x.cl', { debe_cambiar_password: true });
  cuenta(db, 'B', 'beto@x.cl');
  cuenta(db, 'C', 'beto@x.cl');
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'J1', jefe_email: 'beto@x.cl', subordinado_email: 'ana@x.cl', activo: true });
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'J2', jefe_email: 'fantasma@x.cl', subordinado_email: 'ana@x.cl', activo: true });
  const r = SaludConfig.getSalud(db, {}, ADM);
  assert.equal(check(r, 'claves_temporales').casos.length, 1);
  assert.ok(check(r, 'jefe_sin_modulo').casos[0].arreglos[0].tipo === 'dar_modulo');
  assert.equal(check(r, 'jefe_sin_cuenta').casos.length, 1);
  assert.equal(check(r, 'correos_repetidos').casos.length, 1);
  assert.equal(r.checks[0].severidad, 'critico', 'lo crítico primero');
});

test('Detecta datos de plantilla y personas del legado sin cuenta', () => {
  const db = db_();
  agregarFila_(db, 'SOLICITUDES', { solicitud_id: 'S1', solicitante_email: '[CORREO_LUIS]', desarrollador_asignado: '[CORREO_LEO]' });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Vieja', email: 'vieja@x.cl', activo: true });
  const r = SaludConfig.getSalud(db, {}, ADM);
  assert.match(check(r, 'datos_plantilla').casos[0].texto, /\[CORREO_LEO\]/);
  assert.equal(check(r, 'legado_sin_cuenta').casos.length, 1);
});

test('Arreglos: dar y quitar módulo, agregar a la lista de pausas, generar clave', () => {
  const db = db_();
  cuenta(db, 'A', 'ana@x.cl', { modulos: JSON.stringify(['nueva_solicitud', 'pausas']) });
  agregarFila_(db, 'PAUSAS_CONFIG', { empresa_id: 'HP', hora_habitual: '12:00', activo: true });
  let r = SaludConfig.getSalud(db, {}, ADM);
  const caso = check(r, 'modulo_pausas_fuera_lista').casos[0];
  assert.deepEqual(caso.arreglos.map((a) => a.tipo), ['agregar_lista_pausas', 'quitar_modulo']);
  SaludConfig.arreglar(db, caso.arreglos[0], ADM);
  assert.equal(leerFilas_(db, 'PAUSAS_TRABAJADORES', COLUMNAS.PAUSAS_TRABAJADORES)[0].email, 'ana@x.cl');
  r = SaludConfig.getSalud(db, {}, ADM);
  assert.equal(check(r, 'modulo_pausas_fuera_lista'), undefined, 'ya no aparece');

  SaludConfig.arreglar(db, { tipo: 'dar_modulo', params: { cuenta_id: 'A', modulo: 'jefatura' } }, ADM);
  let mods = JSON.parse(leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL)[0].modulos);
  assert.ok(mods.indexOf('jefatura') !== -1);
  SaludConfig.arreglar(db, { tipo: 'quitar_modulo', params: { cuenta_id: 'A', modulo: 'jefatura' } }, ADM);
  mods = JSON.parse(leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL)[0].modulos);
  assert.equal(mods.indexOf('jefatura'), -1);
  assert.ok(SaludConfig.arreglar(db, { tipo: 'dar_modulo', params: { cuenta_id: 'A', modulo: 'inventado' } }, ADM)._validationError);

  const clave = SaludConfig.arreglar(db, { tipo: 'resetear_clave', params: { cuenta_id: 'A' } }, ADM);
  assert.ok(clave.password_temporal);
});
