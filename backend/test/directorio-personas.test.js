'use strict';

/**
 * Directorio de Personas, Fase 1 (2026-09-22). Cubre las dos piezas:
 *   1. asegurarDirectorioPersonas_ (schema.js, vía asegurarEsquema): la
 *      siembra automática desde CUENTAS_PORTAL + SGC_PERSONAS al arrancar,
 *      idempotente, con el RUT como llave natural (colapsa el multi-cargo).
 *   2. directorioPersonas.js: resolución (correo->persona) y búsqueda (por
 *      RUT/nombre/cargo), org-scoped.
 *
 * Fase 1 no cambia nada visible: acá se prueba solo la infraestructura de
 * lectura, ninguna pantalla existente la usa todavía.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { asegurarEsquema, COLUMNAS, ORGANIZACION_POR_DEFECTO_ID } = require('../db/schema');
const Directorio = require('../logica/directorioPersonas');

const CTX_ADM = { email: 'lmendoza@homepymes.cl', rol: 'ADM', organizacion_id: ORGANIZACION_POR_DEFECTO_ID };
const CTX_DEV = { email: 'dev@homepymes.cl', rol: 'DEV', organizacion_id: ORGANIZACION_POR_DEFECTO_ID };

function dir(db) { return leerFilas_(db, 'DIRECTORIO_PERSONAS', COLUMNAS.DIRECTORIO_PERSONAS); }

// db con las tablas creadas (esquema completo) + fuentes sembradas + la
// siembra del directorio ya corrida (segunda pasada de asegurarEsquema).
function dbSembrada(cuentas, personasSgc) {
  const db = abrirDb_();
  asegurarEsquema(db); // crea todas las tablas vacías
  (cuentas || []).forEach((c) => agregarFila_(db, 'CUENTAS_PORTAL', c));
  (personasSgc || []).forEach((p) => agregarFila_(db, 'SGC_PERSONAS', p));
  asegurarEsquema(db); // ahora la siembra ve las fuentes y puebla el directorio
  return db;
}

test('siembra: una cuenta con login genera una persona, con su RUT tomado de SGC_PERSONAS por correo', () => {
  const db = dbSembrada(
    [{ cuenta_id: 'c-1', usuario: 'cpena', nombre: 'Camila Peña', cargo: 'Encargada de Prevención',
       emails: '["cpena@grupohb.cl"]', rol: 'DEV', empresa_id: 'HP', activo: true, organizacion_id: ORGANIZACION_POR_DEFECTO_ID }],
    [{ persona_id: 'SGCP-06', usuario_email: 'cpena@grupohb.cl', nombre: 'Camila Peña', rut: '18.383.016-3',
       cargo: 'Encargada de Prevención', tipo: 'INT', activa: true }]
  );
  const filas = dir(db);
  assert.equal(filas.length, 1, 'una sola persona (la cuenta), no dos');
  const p = Directorio.resolverPorEmail(db, 'cpena@grupohb.cl');
  assert.ok(p);
  assert.equal(p.nombre, 'Camila Peña');
  assert.equal(p.cargo, 'Encargada de Prevención');
  assert.equal(p.rut, '18.383.016-3', 'el RUT se enriquece desde SGC_PERSONAS');
  assert.equal(p.tiene_cuenta, true);
  assert.equal(p.etiqueta, 'Camila Peña — Encargada de Prevención');
});

test('siembra: dos fichas SGC de la MISMA persona (mismo RUT, CORREOS distintos, sin cuenta) colapsan en UNA entrada', () => {
  // Correos distintos a propósito: si se colapsan, es por el RUT (la llave
  // natural), no por el correo. Formato de RUT distinto (con y sin puntos)
  // para probar que la normalización los reconoce como el mismo.
  const db = dbSembrada([], [
    { persona_id: 'SGCP-06', usuario_email: 'cpena@grupohb.cl', nombre: 'Camila Peña', rut: '18.383.016-3', cargo: 'Prevención (interno)', tipo: 'INT', activa: true },
    { persona_id: 'SGCP-99', usuario_email: 'camila.otro@homepymes.cl', nombre: 'Camila Peña', rut: '18383016-3', cargo: 'Prevención (servicios a clientes)', tipo: 'INT', activa: true }
  ]);
  const filas = dir(db);
  assert.equal(filas.length, 1, 'el RUT (aunque con formato distinto) las une en una sola persona');
  assert.equal(Directorio.resolverPorRut(db, '18.383.016-3').tiene_cuenta, false);
});

test('siembra: una persona del SGC sin cuenta de login entra como colaborador externo (tiene_cuenta=false)', () => {
  const db = dbSembrada([], [
    { persona_id: 'SGCP-20', usuario_email: 'colab@externo.cl', nombre: 'Colaborador Externo', rut: '9.999.999-9', cargo: 'Asesor', tipo: 'EXT', activa: true }
  ]);
  const p = Directorio.resolverPorEmail(db, 'colab@externo.cl');
  assert.ok(p);
  assert.equal(p.tiene_cuenta, false);
  assert.equal(p.rut, '9.999.999-9');
});

test('siembra: es idempotente -- correr asegurarEsquema muchas veces no duplica', () => {
  const db = dbSembrada(
    [{ cuenta_id: 'c-1', usuario: 'a', nombre: 'A', cargo: 'X', emails: '["a@x.cl"]', rol: 'DEV', empresa_id: 'HP', activo: true }],
    []
  );
  asegurarEsquema(db); asegurarEsquema(db); asegurarEsquema(db);
  assert.equal(dir(db).length, 1);
});

test('siembra: una fila enriquecida a mano NO se sobrescribe en el siguiente arranque', () => {
  const db = dbSembrada(
    [{ cuenta_id: 'c-1', usuario: 'a', nombre: 'A', cargo: 'X', emails: '["a@x.cl"]', rol: 'DEV', empresa_id: 'HP', activo: true }],
    []
  );
  // Simula una edición manual futura (Fase posterior): se le pone un RUT.
  const fila = dir(db)[0];
  const { actualizarFilaPorId_ } = require('../db/sqliteRepo');
  actualizarFilaPorId_(db, 'DIRECTORIO_PERSONAS', 'persona_id', fila.persona_id, { rut: '11.111.111-1' });
  asegurarEsquema(db); // no debe volver a insertar ni pisar
  const filas = dir(db);
  assert.equal(filas.length, 1);
  assert.equal(Directorio.resolverPorEmail(db, 'a@x.cl').rut, '11.111.111-1', 'el RUT puesto a mano sobrevive el arranque');
});

test('siembra: se siembran activas E inactivas (para que los registros históricos resuelvan)', () => {
  const db = dbSembrada(
    [{ cuenta_id: 'c-1', usuario: 'baja', nombre: 'Persona Baja', cargo: 'X', emails: '["baja@x.cl"]', rol: 'DEV', empresa_id: 'HP', activo: false }],
    []
  );
  const p = Directorio.resolverPorEmail(db, 'baja@x.cl');
  assert.ok(p, 'una persona inactiva igual resuelve (para pintar registros viejos)');
  assert.equal(p.activa, false);
});

test('resolverPorEmail: un correo desconocido devuelve null (el llamador muestra el correo crudo)', () => {
  const db = dbSembrada([], []);
  assert.equal(Directorio.resolverPorEmail(db, 'nadie@x.cl'), null);
  assert.equal(Directorio.resolverPorEmail(db, ''), null);
});

test('resolverVarios: resuelve muchos correos de una sola pasada', () => {
  const db = dbSembrada(
    [{ cuenta_id: 'c-1', usuario: 'a', nombre: 'Ana', cargo: 'X', emails: '["a@x.cl"]', rol: 'DEV', empresa_id: 'HP', activo: true },
     { cuenta_id: 'c-2', usuario: 'b', nombre: 'Beto', cargo: 'Y', emails: '["b@x.cl"]', rol: 'DEV', empresa_id: 'HP', activo: true }],
    []
  );
  const mapa = Directorio.resolverVarios(db, ['a@x.cl', 'B@X.CL', 'nadie@x.cl']);
  assert.equal(mapa['a@x.cl'].nombre, 'Ana');
  assert.equal(mapa['b@x.cl'].nombre, 'Beto', 'normaliza mayúsculas');
  assert.equal(mapa['nadie@x.cl'], undefined);
});

test('buscarPersonas: encuentra por nombre, por cargo y por RUT; exige sesión', () => {
  const db = dbSembrada(
    [{ cuenta_id: 'c-1', usuario: 'cpena', nombre: 'Camila Peña', cargo: 'Encargada de Prevención', emails: '["cpena@grupohb.cl"]', rol: 'DEV', empresa_id: 'HP', activo: true }],
    [{ persona_id: 'SGCP-06', usuario_email: 'cpena@grupohb.cl', nombre: 'Camila Peña', rut: '18.383.016-3', cargo: 'Prevención', tipo: 'INT', activa: true }]
  );
  assert.equal(Directorio.buscarPersonas(db, { texto: 'camila' }, CTX_DEV).personas.length, 1, 'por nombre');
  assert.equal(Directorio.buscarPersonas(db, { texto: 'prevención' }, CTX_DEV).personas.length, 1, 'por cargo (ignora acentos)');
  assert.equal(Directorio.buscarPersonas(db, { texto: '18383016' }, CTX_DEV).personas.length, 1, 'por RUT sin puntos');
  assert.equal(Directorio.buscarPersonas(db, { texto: 'nadie' }, CTX_DEV).personas.length, 0);
  assert.ok(Directorio.buscarPersonas(db, { texto: 'x' }, null)._forbidden, 'sin sesión, forbidden');
});

test('buscarPersonas: por defecto solo activas; incluir_inactivas las suma', () => {
  const db = dbSembrada(
    [{ cuenta_id: 'c-1', usuario: 'baja', nombre: 'Persona Baja', cargo: 'X', emails: '["baja@x.cl"]', rol: 'DEV', empresa_id: 'HP', activo: false }],
    []
  );
  assert.equal(Directorio.buscarPersonas(db, { texto: 'baja' }, CTX_DEV).personas.length, 0, 'inactiva no aparece por defecto');
  assert.equal(Directorio.buscarPersonas(db, { texto: 'baja', incluir_inactivas: true }, CTX_DEV).personas.length, 1);
});

test('listar: solo ADM', () => {
  const db = dbSembrada(
    [{ cuenta_id: 'c-1', usuario: 'a', nombre: 'Ana', cargo: 'X', emails: '["a@x.cl"]', rol: 'DEV', empresa_id: 'HP', activo: true }],
    []
  );
  assert.ok(Directorio.listar(db, {}, CTX_DEV)._forbidden, 'un DEV no puede ver el volcado completo');
  assert.equal(Directorio.listar(db, {}, CTX_ADM).personas.length, 1);
});

test('buscarPersonas: acota por organización (multi-tenant) -- no ves personas de otro cliente', () => {
  const db = dbSembrada(
    [{ cuenta_id: 'c-1', usuario: 'a', nombre: 'Ana Cliente1', cargo: 'X', emails: '["a@x.cl"]', rol: 'DEV', empresa_id: 'HP', activo: true, organizacion_id: 'org-cliente-1' }],
    []
  );
  const ctxCliente2 = { email: 'z@y.cl', rol: 'DEV', organizacion_id: 'org-cliente-2' };
  assert.equal(Directorio.buscarPersonas(db, { texto: 'ana' }, ctxCliente2).personas.length, 0, 'otro cliente no ve a Ana');
  const ctxCliente1 = { email: 'z@y.cl', rol: 'DEV', organizacion_id: 'org-cliente-1' };
  assert.equal(Directorio.buscarPersonas(db, { texto: 'ana' }, ctxCliente1).personas.length, 1);
});
