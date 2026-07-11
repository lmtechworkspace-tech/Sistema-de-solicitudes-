'use strict';

// v3.0 (Fase 1, multi-responsable, documentacion/SIGSO-v3.0-multi-
// responsable-y-control.md §2-§3): el formulario elige un AREA; crearSolicitud
// resuelve area -> responsable_email, lo escribe en desarrollador_asignado
// (para que el filtro "asignadas a mi" del Backoffice funcione) y le avisa a
// ESE responsable en vez de al buzon fijo. Si no hay area configurada, cae al
// buzon por defecto (EMAIL_DESARROLLO) -- retrocompatible.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, seedSheet } = require('./helpers/gasSandbox');

const BUZON_DEFECTO = 'lestay@rld.cl'; // EMAIL_DESARROLLO en Notificaciones.gs

function loadConSchema(areas) {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'COUNTERS', ctx.COLUMNAS.COUNTERS);
  seedSheet(ctx, 'CONFIG_SLA', ctx.COLUMNAS.CONFIG_SLA, [
    ['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']
  ]);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  // Catalogos base vacios: Catalogos.getAll los lee (no van envueltos en
  // try/catch como las areas), asi que la hoja debe existir.
  seedSheet(ctx, 'CAT_EMPRESAS', ctx.COLUMNAS.CAT_EMPRESAS);
  seedSheet(ctx, 'CAT_PLATAFORMAS', ctx.COLUMNAS.CAT_PLATAFORMAS);
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS);
  seedSheet(ctx, 'CAT_TIPOS', ctx.COLUMNAS.CAT_TIPOS);
  // areas === undefined simula una instalacion previa a v3.0 (sin la hoja).
  if (areas !== undefined) {
    seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS, areas);
  }
  return ctx;
}

function datosValidos(overrides) {
  return Object.assign(
    {
      empresa_id: 'HP', plataforma: 'ERP', es_cliente: false,
      solicitante_nombre: 'Juan', solicitante_cargo: 'Jefe', solicitante_email: 'juan@homepymes.cl',
      subsolicitudes: [
        { titulo: 'x', descripcion: 'y', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'ERR' }
      ]
    },
    overrides
  );
}

function avisosDesarrollo(ctx) {
  return ctx.leerFilas_('LOG_NOTIFICACIONES').filter((n) => n.evento === 'AVISO_DESARROLLO');
}

test('crearSolicitud (v3.0): un area configurada rutea al responsable (desarrollador_asignado + aviso)', () => {
  const ctx = loadConSchema([['AREA_PLAT', 'Plataformas', 'luis@rld.cl', true]]);
  ctx.Solicitudes.crearSolicitud(datosValidos({ area: 'AREA_PLAT' }));

  const sub = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(sub.desarrollador_asignado, 'luis@rld.cl');
  assert.equal(sub.area, 'AREA_PLAT');
  assert.equal(sub.area_nombre, 'Plataformas');

  const avisos = avisosDesarrollo(ctx);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].destinatario, 'luis@rld.cl');
});

test('crearSolicitud (v3.0): "No estoy seguro" (area vacia) cae al buzon por defecto', () => {
  const ctx = loadConSchema([['AREA_PLAT', 'Plataformas', 'luis@rld.cl', true]]);
  ctx.Solicitudes.crearSolicitud(datosValidos({ area: '' }));

  const sub = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(sub.desarrollador_asignado, BUZON_DEFECTO);
  assert.equal(avisosDesarrollo(ctx)[0].destinatario, BUZON_DEFECTO);
});

test('crearSolicitud (v3.0): sin la hoja CAT_AREAS (instalacion previa) rutea al buzon por defecto sin romper', () => {
  const ctx = loadConSchema(); // no se siembra CAT_AREAS
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({ area: 'AREA_PLAT' }));

  assert.equal(resultado.estado, 'S01');
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].desarrollador_asignado, BUZON_DEFECTO);
});

test('crearSolicitud (v3.0): un area INACTIVA cae al buzon por defecto', () => {
  const ctx = loadConSchema([['AREA_X', 'X', 'x@rld.cl', false]]);
  ctx.Solicitudes.crearSolicitud(datosValidos({ area: 'AREA_X' }));

  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].desarrollador_asignado, BUZON_DEFECTO);
});

test('crearSolicitud (v3.0): items en distintas areas -> cada responsable recibe un aviso; misma area -> uno solo', () => {
  const ctx = loadConSchema([
    ['A1', 'Uno', 'a@rld.cl', true],
    ['A2', 'Dos', 'b@rld.cl', true]
  ]);
  ctx.Solicitudes.crearSolicitud(datosValidos({
    subsolicitudes: [
      { titulo: 'i1', descripcion: 'd1', impacto: 'PLANIFICADO', modulo: 'M', tipo: 'ERR', area: 'A1' },
      { titulo: 'i2', descripcion: 'd2', impacto: 'PLANIFICADO', modulo: 'M', tipo: 'ERR', area: 'A2' },
      { titulo: 'i3', descripcion: 'd3', impacto: 'PLANIFICADO', modulo: 'M', tipo: 'ERR', area: 'A1' }
    ]
  }));

  const subs = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(subs[0].desarrollador_asignado, 'a@rld.cl');
  assert.equal(subs[1].desarrollador_asignado, 'b@rld.cl');
  assert.equal(subs[2].desarrollador_asignado, 'a@rld.cl');

  const destinatarios = avisosDesarrollo(ctx).map((a) => a.destinatario).sort();
  // A1 aparece en dos items pero recibe un solo aviso (dedup por destinatario).
  assert.deepEqual(destinatarios, ['a@rld.cl', 'b@rld.cl']);
});

test('crearSolicitud (v3.0): el area de la solicitud es el default de los items que no la sobreescriben', () => {
  const ctx = loadConSchema([['A1', 'Uno', 'a@rld.cl', true], ['A2', 'Dos', 'b@rld.cl', true]]);
  ctx.Solicitudes.crearSolicitud(datosValidos({
    area: 'A1',
    subsolicitudes: [
      { titulo: 'i1', descripcion: 'd1', impacto: 'PLANIFICADO', modulo: 'M', tipo: 'ERR' }, // hereda A1
      { titulo: 'i2', descripcion: 'd2', impacto: 'PLANIFICADO', modulo: 'M', tipo: 'ERR', area: 'A2' }
    ]
  }));

  const subs = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(subs[0].area, 'A1');
  assert.equal(subs[0].desarrollador_asignado, 'a@rld.cl');
  assert.equal(subs[1].area, 'A2');
  assert.equal(subs[1].desarrollador_asignado, 'b@rld.cl');
});

test('Catalogos.getAll (v3.0): expone areas ACTIVAS por nombre, sin el correo del responsable', () => {
  const ctx = loadConSchema([
    ['A1', 'Uno', 'a@rld.cl', true],
    ['A2', 'Dos', 'b@rld.cl', false]
  ]);
  const cat = ctx.Catalogos.getAll();

  assert.equal(cat.areas.length, 1);
  assert.equal(cat.areas[0].area_id, 'A1');
  assert.equal(cat.areas[0].nombre, 'Uno');
  // El responsable_email NUNCA viaja al navegador publico.
  assert.equal(cat.areas[0].responsable_email, undefined);
});

test('Catalogos.getAll (v3.0): sin la hoja CAT_AREAS devuelve areas vacio (no rompe el formulario)', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Catalogos.getAll().areas.length, 0);
});
