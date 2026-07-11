'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'CAT_EMPRESAS', ctx.COLUMNAS.CAT_EMPRESAS);
  seedSheet(ctx, 'CAT_PLATAFORMAS', ctx.COLUMNAS.CAT_PLATAFORMAS);
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS);
  seedSheet(ctx, 'CAT_TIPOS', ctx.COLUMNAS.CAT_TIPOS);
  seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS);
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES);
  return ctx;
}

// v3.0 (Fase 1): CRUD del catalogo de areas -> responsable (solo Admin).
test('Catalogos.guardar (AREA, v3.0): Admin crea un area con su responsable', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'AREA', registro: { area_id: 'PLAT', nombre: 'Plataformas', responsable_email: 'luis@rld.cl', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  assert.equal(resultado.responsable_email, 'luis@rld.cl');
  const filas = ctx.leerFilas_('CAT_AREAS');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].nombre, 'Plataformas');
});

test('Catalogos.guardar (AREA, v3.0): rechaza al rol Analista (solo Admin)', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'AREA', registro: { area_id: 'PLAT', nombre: 'Plataformas', responsable_email: 'luis@rld.cl', activo: true } },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._forbidden, true);
});

// P12 (v2.0, Sprint 3): CONFIG_NOTIFICACIONES via el mismo CRUD generico,
// solo Admin (es una decision de gobierno, no de operacion diaria).
test('Catalogos.guardar (NOTIFICACION, P12) permite a Admin desactivar el aviso automatico a Leo', () => {
  const ctx = loadConSchema();
  ctx.agregarFila_('CONFIG_NOTIFICACIONES', {
    notif_id: 'AVISO_LEO', evento: 'AVISO_DESARROLLO', rol_destinatario: '', emails_extra: '', activo: true
  });

  const resultado = ctx.Catalogos.guardar(
    { tipo: 'NOTIFICACION', registro: { notif_id: 'AVISO_LEO', evento: 'AVISO_DESARROLLO', activo: false } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  assert.equal(resultado.activo, false);
  const filas = ctx.leerFilas_('CONFIG_NOTIFICACIONES');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].activo, false);
});

test('Catalogos.guardar (NOTIFICACION) rechaza al rol Analista (P12, solo Admin)', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'NOTIFICACION', registro: { notif_id: 'AVISO_LEO', activo: false } },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._forbidden, true);
});

test('Catalogos.guardar (Admin) crea una empresa nueva', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: 'https://x.cl/logo.png', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  assert.equal(resultado.empresa_id, 'HP');
  const empresas = ctx.leerFilas_('CAT_EMPRESAS');
  assert.equal(empresas.length, 1);
  assert.equal(empresas[0].logo, 'https://x.cl/logo.png');
});

test('Catalogos.guardar (Admin) actualiza una empresa existente en vez de duplicarla', () => {
  const ctx = loadConSchema();
  ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: false } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  const empresas = ctx.leerFilas_('CAT_EMPRESAS');
  assert.equal(empresas.length, 1);
  assert.equal(empresas[0].activo, false);
});

test('Catalogos.guardar rechaza EMPRESA/PLATAFORMA para el rol Analista', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', activo: true } },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado._forbidden, true);
});

test('Catalogos.guardar permite MODULO/TIPO para el rol Analista (nivel basico)', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'MODULO', registro: { modulo_id: 'MOD_X', nombre: 'Modulo X', plataforma_id: 'ERP', activo: true } },
    { email: 'analista@homepymes.cl', rol: 'ANA' }
  );
  assert.equal(resultado.modulo_id, 'MOD_X');
});

test('Catalogos.guardar (MODULO) acepta modulo_padre_id para armar jerarquia (post-Fase 8)', () => {
  const ctx = loadConSchema();
  ctx.Catalogos.guardar(
    { tipo: 'MODULO', registro: { modulo_id: 'GENDOC', nombre: 'Generador Documental', plataforma_id: 'RLD_GDE', modulo_padre_id: '', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'MODULO', registro: { modulo_id: 'GENDOC_FIRMA', nombre: 'Firma R Generador', plataforma_id: 'RLD_GDE', modulo_padre_id: 'GENDOC', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  assert.equal(resultado.modulo_padre_id, 'GENDOC');
  const modulos = ctx.leerFilas_('CAT_MODULOS');
  const raiz = modulos.find((m) => m.modulo_id === 'GENDOC');
  const hijo = modulos.find((m) => m.modulo_id === 'GENDOC_FIRMA');
  assert.equal(raiz.modulo_padre_id, '');
  assert.equal(hijo.modulo_padre_id, 'GENDOC');
});

test('Catalogos.guardar responde error de validacion sin el identificador del registro', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { nombre: 'Sin id' } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(resultado._validationError, true);
});

test('Catalogos.guardar responde error de validacion para un tipo desconocido', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Catalogos.guardar(
    { tipo: 'INVALIDO', registro: { id: 'x' } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  assert.equal(resultado._validationError, true);
});

test('Catalogos.listar devuelve activos e inactivos (a diferencia de getAll)', () => {
  const ctx = loadConSchema();
  ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'HP', nombre: 'HomePymes', logo: '', activo: true } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );
  ctx.Catalogos.guardar(
    { tipo: 'EMPRESA', registro: { empresa_id: 'OLD', nombre: 'De baja', logo: '', activo: false } },
    { email: 'admin@homepymes.cl', rol: 'ADM' }
  );

  const lista = ctx.Catalogos.listar({ tipo: 'EMPRESA' }, { email: 'admin@homepymes.cl', rol: 'ADM' });
  assert.equal(lista.length, 2);
});

test('doPost action=guardarCatalogo responde ok:true end-to-end', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  ctx.Session = { getActiveUser: () => ({ getEmail: () => 'admin@homepymes.cl' }) };

  const output = ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'guardarCatalogo',
        data: { tipo: 'TIPO', registro: { tipo_id: 'ERR', nombre: 'Error', prioridad_default: 'P2', activo: true } }
      })
    }
  });
  const parsed = JSON.parse(output.getContent());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.tipo_id, 'ERR');
});
