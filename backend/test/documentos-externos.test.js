'use strict';

// v11.0 Fase 5 — documentos de origen externo (§7.5.3.2).
//
// Lo que protegen estos tests:
//  1. Que los seis externos sean los del FO-PRO-01-01 y NO nazcan como si
//     fueran documentos propios: sin elaborador, revisor ni aprobador. De un
//     documento externo la organizacion no controla la version.
//  2. Que no exijan archivo. Nadie sube el texto de la Ley 16.744 al Drive,
//     y obligar a hacerlo convertiria la funcion en inutilizable.
//  3. Que no exijan acuse. No se le puede pedir a nadie que confirme que
//     "conoce" el Codigo del Trabajo entero.
//  4. Que §7.5 mida por separado lo interno y lo externo: son dos
//     obligaciones distintas de la norma, y tener lo propio ordenado no
//     cubre la otra.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  [
    'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES', 'SGC_DOC_DESTINATARIOS', 'SGC_DOC_ACUSES',
    'SGC_ROLES', 'SGC_PROCESOS', 'SGC_PROCESO_PASOS', 'SGC_RIESGOS', 'SGC_CONTEXTO',
    'SGC_PARTES_INTERESADAS', 'SGC_ALCANCE', 'SGC_EXCLUSIONES', 'SGC_PERSONAS',
    'SGC_DESCRIPTORES', 'SGC_PERSONA_DOCUMENTOS', 'SGC_INDUCCIONES', 'SGC_EVALUACIONES',
    'SGC_CAPACITACIONES', 'SGC_CAPACITACION_ASISTENTES', 'SGC_NC', 'SGC_AUDITORIAS',
    'SGC_AUD_HALLAZGOS', 'SGC_QUEJAS', 'SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES',
    'SGC_REVISIONES', 'SGC_REVISION_ACUERDOS', 'SGC_OBJETIVOS', 'SGC_INDICADOR_LECTURAS',
    'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'NOVEDADES', 'LOG_SISTEMA', 'USUARIOS',
    'CUENTAS_PORTAL', 'AREAS'
  ].forEach((h) => { if (ctx.COLUMNAS[h]) seedSheet(ctx, h, ctx.COLUMNAS[h]); });

  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES, [
    ['R1', 'sgc@homepymes.cl', 'ENCARGADO_SGC', '', '', true, new Date().toISOString()],
    ['R2', 'operativo@homepymes.cl', 'OPERATIVO', 'CONTABILIDAD', '', true, new Date().toISOString()]
  ]);
  return ctx;
}

const ENC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };

function externos(ctx) {
  return ctx.leerFilasSeguro_(ctx.SHEETS.SGC_DOCUMENTOS).filter((d) => d.tipo === 'EXTERNO');
}

function clausula(ctx, codigo) {
  return ctx.MatrizCobertura.listar({}, ENC).clausulas.filter((c) => c.codigo === codigo)[0];
}

// --- 1. La carga -------------------------------------------------------------

test('se cargan los seis documentos externos del FO-PRO-01-01', () => {
  const ctx = loadConSchema();
  const r = ctx.Calidad.sembrarDocumentosExternos({}, ENC);
  assert.equal(r.total, 6);

  assert.deepEqual(
    toPlain(externos(ctx)).map((d) => d.codigo).sort(),
    ['Código del Trabajo', 'DS 44', 'DS 594', 'ISO 9001:2015', 'ISO 19011:2018', 'Ley 16.744'].sort()
  );
});

test('un documento externo NO nace con elaborador, revisor ni aprobador', () => {
  const ctx = loadConSchema();
  ctx.Calidad.sembrarDocumentosExternos({}, ENC);

  // La organización no controla la versión de una ley: no puede haberla
  // elaborado, revisado ni aprobado. Ponerle un nombre ahí sería mentir.
  assert.ok(externos(ctx).every((d) =>
    !String(d.elaborado_por || '').trim() &&
    !String(d.revisado_por || '').trim() &&
    !String(d.aprobado_por || '').trim()));
});

test('un documento externo no lleva archivo ni acuse', () => {
  const ctx = loadConSchema();
  ctx.Calidad.sembrarDocumentosExternos({}, ENC);

  assert.ok(externos(ctx).every((d) => !d.archivo_id),
    'nadie sube el texto de la Ley 16.744 al repositorio');
  assert.ok(externos(ctx).every((d) => d.requiere_acuse === false),
    'no se le puede exigir a alguien que confirme que conoce el Código del Trabajo entero');
});

test('cada externo trae su emisor y su clase', () => {
  const ctx = loadConSchema();
  ctx.Calidad.sembrarDocumentosExternos({}, ENC);

  const iso = externos(ctx).filter((d) => d.codigo === 'ISO 9001:2015')[0];
  assert.match(iso.emisor, /ISO/);
  assert.equal(iso.clase_externa, 'Norma');

  const ley = externos(ctx).filter((d) => d.codigo === 'Ley 16.744')[0];
  assert.match(ley.emisor, /Congreso/i);
  assert.equal(ley.clase_externa, 'Ley');

  assert.ok(externos(ctx).every((d) => String(d.emisor || '').trim()),
    'sin emisor el documento no está identificado: no se sabe dónde buscar la versión vigente');
});

test('la fecha de vigencia va vacía: el documento solo declara el año de la edición', () => {
  const ctx = loadConSchema();
  ctx.Calidad.sembrarDocumentosExternos({}, ENC);

  assert.ok(externos(ctx).every((d) => !String(d.fecha_vigencia || '').trim()),
    'inventar un día y un mes sería darle al sistema una precisión que el documento no tiene');
  // Pero la revisión SÍ es una fecha real del FO-PRO-01-01.
  assert.ok(externos(ctx).every((d) => String(d.proxima_revision).slice(0, 10) === '2027-03-01'));
});

test('cargar dos veces no duplica', () => {
  const ctx = loadConSchema();
  ctx.Calidad.sembrarDocumentosExternos({}, ENC);
  const r = ctx.Calidad.sembrarDocumentosExternos({}, ENC);

  assert.equal(r.total, 0);
  assert.equal(externos(ctx).length, 6);
  assert.match(r.message, /ya estaban todos/i);
});

test('si ya existe uno con ese código, se salta y se avisa', () => {
  const ctx = loadConSchema();
  ctx.Calidad.crearDocumento({
    codigo: 'DS 44', nombre: 'Mi copia del DS 44', tipo: 'EXTERNO', visibilidad: 'TODOS'
  }, ENC);

  const r = ctx.Calidad.sembrarDocumentosExternos({}, ENC);
  assert.equal(r.total, 5);
  assert.deepEqual(toPlain(r.omitidos), ['DS 44']);
  assert.match(r.message, /Ya existían: DS 44/);
});

test('solo el Encargado del SGC carga el listado externo', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Calidad.sembrarDocumentosExternos({}, OPERATIVO)._forbidden, true);
  assert.equal(externos(ctx).length, 0);
});

// --- 2. Crear uno a mano -----------------------------------------------------

test('se puede registrar un documento externo sin archivo', () => {
  const ctx = loadConSchema();
  const d = ctx.Calidad.crearDocumento({
    codigo: 'NCh 3262', nombre: 'Sistema de gestión de igualdad de género',
    tipo: 'EXTERNO', visibilidad: 'TODOS',
    emisor: 'INN', clase_externa: 'Norma'
  }, ENC);

  assert.ok(d.documento_id);
  assert.equal(d.archivo_id, '');
  assert.equal(d.emisor, 'INN');
  assert.equal(d.clase_externa, 'Norma');
});

// --- 3. Efecto en §7.5 -------------------------------------------------------

test('7.5 mide por separado lo interno y lo externo', () => {
  const ctx = loadConSchema();

  // Solo documentos internos: 7.5 no puede darse por cerrada.
  for (let i = 1; i <= 6; i++) {
    ctx.Calidad.crearDocumento({
      codigo: 'PRO-0' + i, nombre: 'Procedimiento ' + i, tipo: 'PRO', visibilidad: 'TODOS'
    }, ENC);
  }
  let d = ctx.MatrizCobertura.getDetalle({ codigo: '7.5' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /origen externo/i);
  assert.match(d.nota, /7\.5\.3\.2/);

  ctx.Calidad.sembrarDocumentosExternos({}, ENC);

  d = ctx.MatrizCobertura.getDetalle({ codigo: '7.5' }, ENC);
  assert.equal(d.estado, 'COMPLETO');
  assert.match(d.resumen, /6 documentos internos vigentes y 6 de origen externo/);
});

test('un externo sin emisor mantiene 7.5 en parcial', () => {
  const ctx = loadConSchema();
  for (let i = 1; i <= 6; i++) {
    ctx.Calidad.crearDocumento({
      codigo: 'PRO-0' + i, nombre: 'Procedimiento ' + i, tipo: 'PRO', visibilidad: 'TODOS'
    }, ENC);
  }
  ctx.Calidad.sembrarDocumentosExternos({}, ENC);
  assert.equal(clausula(ctx, '7.5').estado, 'COMPLETO');

  const uno = externos(ctx)[0];
  ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_DOCUMENTOS, 'documento_id', uno.documento_id, { emisor: '' });

  const d = ctx.MatrizCobertura.getDetalle({ codigo: '7.5' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /sin emisor identificado/i);
});

test('los externos aparecen como evidencia de 7.5, separados de los internos', () => {
  const ctx = loadConSchema();
  ctx.Calidad.crearDocumento({
    codigo: 'PRO-01', nombre: 'Control de documentos', tipo: 'PRO', visibilidad: 'TODOS'
  }, ENC);
  ctx.Calidad.sembrarDocumentosExternos({}, ENC);

  const ev = toPlain(ctx.MatrizCobertura.getDetalle({ codigo: '7.5' }, ENC).evidencia);
  assert.ok(ev.some((e) => e.tipo === 'Documento interno vigente'));
  assert.ok(ev.some((e) => e.tipo === 'Documento externo identificado'));
  const iso = ev.filter((e) => /ISO 9001/.test(e.descripcion))[0];
  assert.match(iso.descripcion, /\(ISO/, 'el emisor viaja hasta la pantalla del auditor');
});
