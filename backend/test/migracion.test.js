'use strict';

/**
 * Tests de la herramienta temporal de migracion (backend/logica/migracion.js).
 * No es un puerto del .gs -- es infraestructura nueva, propia de este corte
 * de Sheets a SQLite -- pero se prueba con el mismo cuidado por el riesgo
 * real de tocar datos de produccion sin red de seguridad.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Migracion = require('../logica/migracion');
const Hash = require('../logica/passwordHash');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

const ADMIN = { email: 'admin@homepymes.cl', rol: 'ADM' };

test('importarTabla rechaza a quien no es ADM', () => {
  const db = dbConSchema();
  const resultado = Migracion.importarTabla(db, { hoja: 'CAT_EMPRESAS', filas: [] }, { email: 'x@x.cl', rol: 'DEV' });
  assert.equal(resultado._forbidden, true);
});

test('importarTabla rechaza una hoja no reconocida (evita importar a una tabla arbitraria)', () => {
  const db = dbConSchema();
  const resultado = Migracion.importarTabla(db, { hoja: 'CAT_CLIENTES', filas: [] }, ADMIN);
  assert.equal(resultado._validationError, true);
});

test('importarTabla vacia la tabla y la reemplaza con las filas nuevas (idempotente)', () => {
  const db = dbConSchema();
  agregarFila_(db, 'CAT_EMPRESAS', { empresa_id: 'PRUEBA', nombre: 'Empresa de prueba', logo: '', activo: true });

  const resultado = Migracion.importarTabla(db, {
    hoja: 'CAT_EMPRESAS',
    filas: [
      { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: 'TRUE' },
      { empresa_id: 'GDE', nombre: 'GDE', logo: '', activo: 'TRUE' }
    ]
  }, ADMIN);

  assert.equal(resultado.importadas, 2);
  const filas = leerFilas_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS);
  assert.equal(filas.length, 2, 'la fila de prueba anterior debe desaparecer');
  assert.deepEqual(filas.map((f) => f.empresa_id).sort(), ['GDE', 'HP']);
});

test('importarTabla preserva campos de texto largo y JSON-en-celda (SUBSOLICITUDES)', () => {
  const db = dbConSchema();
  const fila = {
    subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: '1',
    titulo: 'Titulo real', descripcion: 'Descripcion\ncon salto de linea', urls_adicionales: '["https://a.cl","https://b.cl"]',
    imagen_descripciones: '["foto 1"]', estado: 'S09'
  };
  Migracion.importarTabla(db, { hoja: 'SUBSOLICITUDES', filas: [fila] }, ADMIN);

  const filas = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES);
  assert.equal(filas[0].descripcion, 'Descripcion\ncon salto de linea');
  assert.equal(filas[0].urls_adicionales, '["https://a.cl","https://b.cl"]');
  assert.deepEqual(JSON.parse(filas[0].urls_adicionales), ['https://a.cl', 'https://b.cl']);
});

test('importarTabla en CUENTAS_PORTAL genera una clave temporal distinta por cuenta, nunca copia el hash viejo', () => {
  const db = dbConSchema();
  const filas = [
    { cuenta_id: 'c1', usuario: 'lmendoza', nombre: 'Luis Mendoza', cargo: 'Analista', hash_password: 'HASH_VIEJO_1', salt: 'SAL_VIEJA_1', emails: '["a@a.cl"]', rol: 'ADM', modulos: '["administracion"]', empresa_id: 'HP', activo: 'TRUE', debe_cambiar_password: 'FALSE', ultimo_acceso: '2026-01-01', creado_por: 'sistema' },
    { cuenta_id: 'c2', usuario: 'daniel', nombre: 'Daniel', cargo: '', hash_password: 'HASH_VIEJO_2', salt: 'SAL_VIEJA_2', emails: '["d@d.cl"]', rol: 'DEV', modulos: '["mi_trabajo"]', empresa_id: 'HP', activo: 'FALSE', debe_cambiar_password: 'FALSE', ultimo_acceso: '', creado_por: 'sistema' }
  ];

  const resultado = Migracion.importarTabla(db, { hoja: 'CUENTAS_PORTAL', filas }, ADMIN);

  assert.equal(resultado.credenciales.length, 2);
  const claves = resultado.credenciales.map((c) => c.password_temporal);
  assert.notEqual(claves[0], claves[1], 'cada cuenta debe recibir una clave distinta');

  const importadas = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL);
  const lmendoza = importadas.find((c) => c.usuario === 'lmendoza');
  const daniel = importadas.find((c) => c.usuario === 'daniel');

  // El hash viejo nunca se copia -- y el nuevo SI valida contra la clave devuelta.
  assert.notEqual(lmendoza.hash_password, 'HASH_VIEJO_1');
  assert.notEqual(lmendoza.salt, 'SAL_VIEJA_1');
  const claveDeLmendoza = resultado.credenciales.find((c) => c.usuario === 'lmendoza').password_temporal;
  assert.equal(Hash.coincide(claveDeLmendoza, lmendoza.salt, lmendoza.hash_password), true);

  // Todas migran con debe_cambiar_password=true, sin importar el valor original.
  assert.equal(lmendoza.debe_cambiar_password, true);
  assert.equal(daniel.debe_cambiar_password, true);

  // Una cuenta ya desactivada NO se reactiva por el solo hecho de migrar.
  assert.equal(daniel.activo, false);
  assert.equal(lmendoza.activo, true);

  // El resto de los datos de la cuenta se preserva tal cual.
  assert.equal(lmendoza.nombre, 'Luis Mendoza');
  assert.equal(lmendoza.emails, '["a@a.cl"]');
  assert.equal(lmendoza.rol, 'ADM');
});
