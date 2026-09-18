'use strict';

/**
 * Tests de la herramienta temporal de migracion (backend/logica/migracion.js).
 * No es un puerto del .gs -- es infraestructura nueva, propia de este corte
 * de Sheets a SQLite -- pero se prueba con el mismo cuidado por el riesgo
 * real de tocar datos de produccion sin red de seguridad.
 *
 * Esta vez, scopeada solo a CAT_CLIENTES (284 filas reales, la unica hoja
 * pendiente de migrar cuando se escribio este incremento).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Migracion = require('../logica/migracion');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

const ADMIN = { email: 'admin@homepymes.cl', rol: 'ADM' };

test('importarTabla rechaza a quien no es ADM', () => {
  const db = dbConSchema();
  const resultado = Migracion.importarTabla(db, { hoja: 'CAT_CLIENTES', filas: [] }, { email: 'x@x.cl', rol: 'DEV' });
  assert.equal(resultado._forbidden, true);
});

test('importarTabla rechaza una hoja no reconocida (evita importar a una tabla arbitraria)', () => {
  const db = dbConSchema();
  const resultado = Migracion.importarTabla(db, { hoja: 'SOLICITUDES', filas: [] }, ADMIN);
  assert.equal(resultado._validationError, true);
});

test('importarTabla vacia CAT_CLIENTES y la reemplaza con las filas nuevas (idempotente)', () => {
  const db = dbConSchema();
  agregarFila_(db, 'CAT_CLIENTES', {
    cliente_id: 'PRUEBA', razon_social: 'Cliente de prueba', rut: '', codigo_cliente: '',
    contacto: '', correo: '', telefono: '', representante_legal: '', direccion: '',
    estado: '', bloqueo: '', activo: true
  });

  const resultado = Migracion.importarTabla(db, {
    hoja: 'CAT_CLIENTES',
    filas: [
      { cliente_id: 'CLI-1', razon_social: 'Andes SpA', rut: '76.111.111-1', codigo_cliente: 'C001', contacto: '', correo: '', telefono: '', representante_legal: '', direccion: '', estado: 'Activo', bloqueo: 'Activo', activo: true },
      { cliente_id: 'CLI-2', razon_social: 'Sur Ltda', rut: '77.222.222-2', codigo_cliente: 'C002', contacto: '', correo: '', telefono: '', representante_legal: '', direccion: '', estado: 'Activo', bloqueo: 'Activo', activo: true }
    ]
  }, ADMIN);

  assert.equal(resultado.importadas, 2);
  const filas = leerFilas_(db, 'CAT_CLIENTES', COLUMNAS.CAT_CLIENTES);
  assert.equal(filas.length, 2, 'la fila de prueba anterior debe desaparecer');
  assert.deepEqual(filas.map((f) => f.cliente_id).sort(), ['CLI-1', 'CLI-2']);
});

test('importarTabla preserva campos con acentos y numeros como telefono', () => {
  const db = dbConSchema();
  const fila = {
    cliente_id: 'CLI-3', razon_social: 'Agencia Sintonía SpA', rut: '77.576.676-K', codigo_cliente: 'HC-156-1',
    contacto: 'Alejandra Barraza', correo: 'a@b.cl', telefono: 999178905, representante_legal: 'Alejandra Andrea Barraza',
    direccion: 'Dr M Barros Borgoño 71', estado: 'Activo', bloqueo: 'Activo', activo: true
  };
  Migracion.importarTabla(db, { hoja: 'CAT_CLIENTES', filas: [fila] }, ADMIN);

  const filas = leerFilas_(db, 'CAT_CLIENTES', COLUMNAS.CAT_CLIENTES);
  assert.equal(filas[0].razon_social, 'Agencia Sintonía SpA');
  assert.equal(String(filas[0].telefono), '999178905');
  assert.equal(filas[0].rut, '77.576.676-K');
});
