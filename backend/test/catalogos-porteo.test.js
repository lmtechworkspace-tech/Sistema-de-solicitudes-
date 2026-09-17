'use strict';

/**
 * Prueba de portabilidad del modulo de logica: los MISMOS escenarios de
 * catalogos-admin.test.js (el comportamiento real de Catalogos.gs, con sus
 * reglas de permisos por rol), corridos contra backend/logica/catalogos.js
 * (Node + SQLite) en vez del .gs (Apps Script + Sheets).
 *
 * No se porta el test final "doPost action=guardarCatalogo responde ok:true
 * end-to-end": ese prueba el router completo con resolucion de identidad
 * (USUARIOS, Session.getActiveUser) -- Auth.gs todavia no esta portado. La
 * integracion HTTP de este modulo se prueba aparte en
 * backend/test/server-catalogos.test.js, con un contexto ya resuelto.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Catalogos = require('../logica/catalogos');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

// v3.0 (Fase 1): CRUD del catalogo de areas -> responsable (solo Admin).
test('Catalogos.guardar (AREA, v3.0): Admin crea un area con su responsable', () => {
  const db = dbConSchema();
  const resultado = Catalogos.guardar(
    db,
    { tipo: 'AREA', registro: { area_id: 'PLAT', nombre: 'Plataformas', responsable_email: 'luis@rld.cl', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  assert.equal(resultado.responsable_email, 'luis@rld.cl');
  const filas = require('../db/sqliteRepo').leerFilas_(db, 'CAT_AREAS', COLUMNAS.CAT_AREAS);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].nombre, 'Plataformas');
});

test('Catalogos.guardar (AREA, v3.0): rechaza al rol Analista (solo Admin)', () => {
  const db = dbConSchema();
  const resultado = Catalogos.guardar(
    db,
    { tipo: 'AREA', registro: { area_id: 'PLAT', nombre: 'Plataformas', responsable_email: 'luis@rld.cl', activo: true } },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._forbidden, true);
});

// P12 (v2.0, Sprint 3): CONFIG_NOTIFICACIONES via el mismo CRUD generico,
// solo Admin (es una decision de gobierno, no de operacion diaria).
test('Catalogos.guardar (NOTIFICACION, P12) permite a Admin desactivar el aviso automatico a Leo', () => {
  const db = dbConSchema();
  const { agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
  agregarFila_(db, 'CONFIG_NOTIFICACIONES', {
    notif_id: 'AVISO_LEO', evento: 'AVISO_DESARROLLO', rol_destinatario: '', emails_extra: '', activo: true
  });

  const resultado = Catalogos.guardar(
    db,
    { tipo: 'NOTIFICACION', registro: { notif_id: 'AVISO_LEO', evento: 'AVISO_DESARROLLO', activo: false } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  assert.equal(resultado.activo, false);
  const filas = leerFilas_(db, 'CONFIG_NOTIFICACIONES', COLUMNAS.CONFIG_NOTIFICACIONES);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].activo, false);
});

test('Catalogos.guardar (NOTIFICACION) rechaza al rol Analista (P12, solo Admin)', () => {
  const db = dbConSchema();
  const resultado = Catalogos.guardar(
    db,
    { tipo: 'NOTIFICACION', registro: { notif_id: 'AVISO_LEO', activo: false } },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._forbidden, true);
});

test('Catalogos.guardar (Admin) crea una empresa nueva', () => {
  const db = dbConSchema();
  const resultado = Catalogos.guardar(
    db,
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: 'https://x.cl/logo.png', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  assert.equal(resultado.empresa_id, 'HP');
  const empresas = require('../db/sqliteRepo').leerFilas_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS);
  assert.equal(empresas.length, 1);
  assert.equal(empresas[0].logo, 'https://x.cl/logo.png');
});

test('Catalogos.guardar (Admin) actualiza una empresa existente en vez de duplicarla', () => {
  const db = dbConSchema();
  Catalogos.guardar(
    db,
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  Catalogos.guardar(
    db,
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: false } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  const empresas = require('../db/sqliteRepo').leerFilas_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS);
  assert.equal(empresas.length, 1);
  assert.equal(empresas[0].activo, false);
});

test('Catalogos.guardar rechaza EMPRESA/PLATAFORMA para el rol Analista', () => {
  const db = dbConSchema();
  const resultado = Catalogos.guardar(
    db,
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', activo: true } },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._forbidden, true);
});

test('Catalogos.guardar permite MODULO/TIPO para el rol Analista (nivel basico)', () => {
  const db = dbConSchema();
  const resultado = Catalogos.guardar(
    db,
    { tipo: 'MODULO', registro: { modulo_id: 'MOD_X', nombre: 'Modulo X', plataforma_id: 'ERP', activo: true } },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado.modulo_id, 'MOD_X');
});

test('Catalogos.guardar (MODULO) acepta modulo_padre_id para armar jerarquia', () => {
  const db = dbConSchema();
  Catalogos.guardar(
    db,
    { tipo: 'MODULO', registro: { modulo_id: 'GENDOC', nombre: 'Generador Documental', plataforma_id: 'RLD_GDE', modulo_padre_id: '', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  const resultado = Catalogos.guardar(
    db,
    { tipo: 'MODULO', registro: { modulo_id: 'GENDOC_FIRMA', nombre: 'Firma R Generador', plataforma_id: 'RLD_GDE', modulo_padre_id: 'GENDOC', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  assert.equal(resultado.modulo_padre_id, 'GENDOC');
  const modulos = require('../db/sqliteRepo').leerFilas_(db, 'CAT_MODULOS', COLUMNAS.CAT_MODULOS);
  const raiz = modulos.find((m) => m.modulo_id === 'GENDOC');
  const hijo = modulos.find((m) => m.modulo_id === 'GENDOC_FIRMA');
  assert.equal(raiz.modulo_padre_id, '');
  assert.equal(hijo.modulo_padre_id, 'GENDOC');
});

test('Catalogos.guardar responde error de validacion sin el identificador del registro', () => {
  const db = dbConSchema();
  const resultado = Catalogos.guardar(
    db,
    { tipo: 'EMPRESA', registro: { nombre: 'Sin id' } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(resultado._validationError, true);
});

test('Catalogos.guardar responde error de validacion para un tipo desconocido', () => {
  const db = dbConSchema();
  const resultado = Catalogos.guardar(
    db,
    { tipo: 'INVALIDO', registro: { id: 'x' } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(resultado._validationError, true);
});

test('Catalogos.listar devuelve activos e inactivos (a diferencia del catalogo publico)', () => {
  const db = dbConSchema();
  Catalogos.guardar(
    db,
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  Catalogos.guardar(
    db,
    { tipo: 'EMPRESA', registro: { empresa_id: 'OLD', nombre: 'De baja', logo: '', activo: false } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  const lista = Catalogos.listar(db, { tipo: 'EMPRESA' }, { email: 'admin@homepymes.cl', rol: 'ADM' });
  assert.equal(lista.length, 2);
});

test('Catalogos.listar rechaza tipo desconocido y rol sin permiso', () => {
  const db = dbConSchema();
  assert.equal(Catalogos.listar(db, { tipo: 'INVALIDO' }, { rol: 'ADM' })._validationError, true);
  assert.equal(Catalogos.listar(db, { tipo: 'EMPRESA' }, { rol: 'ANA' })._forbidden, true);
});

// --- Catalogos.getCatalogosPublicos (puerto de Catalogos.getAll, Intake) ---
// El catalogo que ve el formulario publico de nueva solicitud: solo activos,
// sin auth, distinto de listar() (Backoffice, todo incluido inactivos).

test('getCatalogosPublicos devuelve solo entradas activas de cada catalogo', () => {
  const db = dbConSchema();
  const { agregarFila_ } = require('../db/sqliteRepo');
  agregarFila_(db, 'CAT_EMPRESAS', { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: true });
  agregarFila_(db, 'CAT_EMPRESAS', { empresa_id: 'OLD', nombre: 'Empresa dada de baja', logo: '', activo: false });
  agregarFila_(db, 'CAT_PLATAFORMAS', { plataforma_id: 'ERP', nombre: 'ERP', empresa_id: 'HP', url_base: '', activo: true });
  agregarFila_(db, 'CAT_MODULOS', { modulo_id: 'FACT', nombre: 'Facturacion', plataforma_id: 'ERP', modulo_padre_id: '', activo: true });
  agregarFila_(db, 'CAT_MODULOS', { modulo_id: 'LEGACY', nombre: 'Modulo viejo', plataforma_id: 'ERP', modulo_padre_id: '', activo: false });
  agregarFila_(db, 'CAT_TIPOS', { tipo_id: 'ERR', nombre: 'Error', prioridad_default: 'P2', activo: true, es_urgente: false });
  agregarFila_(db, 'CAT_TIPOS', { tipo_id: 'MOD', nombre: 'Modificacion', prioridad_default: 'P3', activo: true, es_urgente: false });

  const catalogos = Catalogos.getCatalogosPublicos(db);

  assert.equal(catalogos.empresas.length, 1);
  assert.equal(catalogos.empresas[0].empresa_id, 'HP');
  assert.equal(catalogos.plataformas.length, 1);
  assert.equal(catalogos.modulos.length, 1);
  assert.equal(catalogos.modulos[0].modulo_id, 'FACT');
  assert.equal(catalogos.tipos.length, 2);
});

test('getCatalogosPublicos proyecta CAT_AREAS a {area_id, nombre} -- el responsable_email nunca viaja al navegador publico', () => {
  const db = dbConSchema();
  const { agregarFila_ } = require('../db/sqliteRepo');
  agregarFila_(db, 'CAT_AREAS', { area_id: 'AREA_1', nombre: 'Soporte', responsable_email: 'soporte@rld.cl', activo: true });
  agregarFila_(db, 'CAT_AREAS', { area_id: 'AREA_2', nombre: 'De baja', responsable_email: 'x@x.cl', activo: false });

  const catalogos = Catalogos.getCatalogosPublicos(db);

  assert.deepEqual(catalogos.areas, [{ area_id: 'AREA_1', nombre: 'Soporte' }]);
  assert.equal(JSON.stringify(catalogos.areas).indexOf('soporte@rld.cl'), -1);
});
