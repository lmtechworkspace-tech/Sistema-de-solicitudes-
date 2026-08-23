'use strict';

// v11.0 Fase 4 — procesos del SGC (§4.4, y base de §8.1/§8.5/§8.6).
//
// Lo que protegen estos tests:
//  1. Que los 14 procesos del mapa sean los del DOC-03 v02, con sus tres
//     categorias. Son el documento aprobado.
//  2. Que §4.4 no se de por cumplida por tener el mapa: la norma pide
//     ademas responsables y objetivos por proceso (§4.4.2 e).
//  3. Que la jerarquia se respete: un proceso de servicio cuelga de uno del
//     mapa, uno del mapa no cuelga de nadie, y no se puede dejar huerfano un
//     subproceso al quitar su padre.
//  4. Que §8.1, §8.5 y §8.6 queden en PARCIAL con la definicion cargada y NO
//     en completo. Tener escrito como se presta un servicio no demuestra que
//     se haya prestado -- eso es la Fase 8.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  [
    'SGC_PROCESOS', 'SGC_PROCESO_PASOS', 'SGC_RIESGOS', 'SGC_CONTEXTO',
    'SGC_PARTES_INTERESADAS', 'SGC_ALCANCE', 'SGC_EXCLUSIONES', 'SGC_ROLES',
    'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES', 'SGC_DOC_DESTINATARIOS', 'SGC_DOC_ACUSES',
    'SGC_PERSONAS', 'SGC_DESCRIPTORES', 'SGC_PERSONA_DOCUMENTOS', 'SGC_INDUCCIONES',
    'SGC_EVALUACIONES', 'SGC_CAPACITACIONES', 'SGC_CAPACITACION_ASISTENTES', 'SGC_NC',
    'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS', 'SGC_QUEJAS', 'SGC_PROVEEDORES',
    'SGC_PROVEEDOR_EVALUACIONES', 'SGC_REVISIONES', 'SGC_REVISION_ACUERDOS',
    'SGC_OBJETIVOS', 'SGC_INDICADOR_LECTURAS', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA',
    'NOVEDADES', 'LOG_SISTEMA', 'USUARIOS', 'CUENTAS_PORTAL', 'AREAS'
  ].forEach((h) => { if (ctx.COLUMNAS[h]) seedSheet(ctx, h, ctx.COLUMNAS[h]); });

  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES, [
    ['R1', 'sgc@homepymes.cl', 'ENCARGADO_SGC', '', '', true, new Date().toISOString()],
    ['R2', 'operativo@homepymes.cl', 'OPERATIVO', 'CONTABILIDAD', '', true, new Date().toISOString()]
  ]);
  return ctx;
}

const ENC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };

function clausula(ctx, codigo) {
  return ctx.MatrizCobertura.listar({}, ENC).clausulas.filter((c) => c.codigo === codigo)[0];
}

function mapaPorCodigo(ctx, codigo) {
  return ctx.Procesos.listar({}, ENC).mapa.filter((p) => p.codigo === codigo)[0];
}

// --- 1. El mapa del DOC-03 ---------------------------------------------------

test('el mapa sembrado son los 14 procesos del DOC-03 v02, en sus tres categorías', () => {
  const ctx = loadConSchema();
  const r = ctx.Procesos.sembrarMapa({}, ENC);
  assert.equal(r.total, 14, 'el DOC-03 v02 tiene 14 procesos, no 13');

  const d = ctx.Procesos.listar({}, ENC);
  assert.deepEqual(toPlain(d.resumen.por_tipo), {
    ESTRATEGICO: 3, OPERATIVO: 6, APOYO: 5
  });
  assert.equal(d.servicios.length, 0, 'los de servicio se cargan por planilla, no aquí');
  assert.match(ctx.Procesos.sembrarMapa({}, ENC).message, /ya está cargado/i);
});

test('cada proceso del mapa trae sus contenidos y su código', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);

  const contabilidad = mapaPorCodigo(ctx, 'PO-04');
  assert.equal(contabilidad.nombre, 'Gestión de Contabilidad');
  assert.equal(contabilidad.area, 'Contabilidad');
  assert.match(contabilidad.actividades, /F29/);
  assert.match(contabilidad.documentos, /DOC-10/);

  // El código dice el tipo de un vistazo: PE / PO / PA.
  assert.ok(ctx.Procesos.listar({}, ENC).mapa.every((p) =>
    (p.tipo === 'ESTRATEGICO' && p.codigo.indexOf('PE-') === 0) ||
    (p.tipo === 'OPERATIVO' && p.codigo.indexOf('PO-') === 0) ||
    (p.tipo === 'APOYO' && p.codigo.indexOf('PA-') === 0)));
});

test('la duda del DOC-03 sobre Comercial viaja como observación, no se resuelve sola', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);
  const comercial = mapaPorCodigo(ctx, 'PO-01');
  assert.match(comercial.observaciones, /EXT/,
    'el mapa lo marca externo y el análisis de agosto dice que pasó a interno: lo decide la empresa');
});

test('el flujo del mapa (necesidades → satisfacción) viaja con la respuesta', () => {
  const ctx = loadConSchema();
  const d = ctx.Procesos.listar({}, ENC);
  assert.match(d.flujo.entrada.titulo, /Necesidades/i);
  assert.match(d.flujo.salida.titulo, /Satisfacción/i);
  assert.ok(d.flujo.salida.items.some((i) => /90%/.test(i)));
  assert.match(d.flujo.ciclo, /PHVA/);
});

// --- 2. Jerarquía ------------------------------------------------------------

test('un proceso de servicio tiene que colgar de uno del mapa', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);

  const r = ctx.Procesos.guardar({
    nombre: 'Proceso suelto', tipo: 'OPERATIVO', nivel: 'SERVICIO'
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /colgar de un proceso del mapa/i);
});

test('un proceso del mapa no cuelga de otro', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);
  const padre = mapaPorCodigo(ctx, 'PO-04');

  const r = ctx.Procesos.guardar({
    nombre: 'Otro del mapa', tipo: 'OPERATIVO', nivel: 'MAPA', proceso_padre_id: padre.proceso_id
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /nivel más alto/i);
});

test('quitar un proceso con subprocesos se rechaza en vez de dejarlos huérfanos', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);
  const padre = mapaPorCodigo(ctx, 'PO-04');
  ctx.Procesos.guardar({
    nombre: 'Declaración de Renta', tipo: 'OPERATIVO', nivel: 'SERVICIO',
    proceso_padre_id: padre.proceso_id, area: 'Contabilidad'
  }, ENC);

  const r = ctx.Procesos.anular({ proceso_id: padre.proceso_id }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /proceso\(s\) de servicio colgando/i);
  assert.ok(mapaPorCodigo(ctx, 'PO-04'), 'sigue ahí');
});

test('el código correlativo va por prefijo', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);

  const r = ctx.Procesos.guardar({ nombre: 'Nuevo de apoyo', tipo: 'APOYO', nivel: 'MAPA' }, ENC);
  assert.equal(r.ok, true);
  const creado = ctx.Procesos.listar({}, ENC).mapa.filter((p) => p.proceso_id === r.proceso_id)[0];
  assert.equal(creado.codigo, 'PA-06', 'el DOC-03 traía 5 procesos de apoyo');
});

// --- 3. La ficha del proceso -------------------------------------------------

test('la ficha muestra pasos, subprocesos y riesgos del proceso', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);
  const padre = mapaPorCodigo(ctx, 'PO-04');

  const hijo = ctx.Procesos.guardar({
    nombre: 'Proceso Mensual de IVA', tipo: 'OPERATIVO', nivel: 'SERVICIO',
    proceso_padre_id: padre.proceso_id, area: 'Contabilidad'
  }, ENC);

  ctx.agregarFila_(ctx.SHEETS.SGC_PROCESO_PASOS, {
    paso_id: 'P1', proceso_id: hijo.proceso_id, numero: 1, nombre: 'Recepción',
    responsable: 'Contador', input: 'Facturas', actividades: 'Revisar',
    evidencias: 'F29', output: 'Declaración', activa: true
  });

  ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  const r5 = ctx.Riesgos.listar({}, ENC).riesgos.filter((x) => x.codigo === 'R5')[0];
  ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_RIESGOS, 'riesgo_id', r5.riesgo_id,
    { proceso_id: padre.proceso_id });

  const detPadre = ctx.Procesos.getDetalle({ proceso_id: padre.proceso_id }, ENC);
  assert.equal(detPadre.subprocesos.length, 1);
  assert.equal(detPadre.riesgos.length, 1);
  assert.equal(detPadre.riesgos[0].codigo, 'R5');
  assert.equal(detPadre.riesgos[0].banda, 'Alto', 'la valoración se calcula igual que en la matriz');

  const detHijo = ctx.Procesos.getDetalle({ proceso_id: hijo.proceso_id }, ENC);
  assert.equal(detHijo.pasos.length, 1);
  assert.equal(detHijo.pasos[0].responsable, 'Contador');
});

test('los pasos salen ordenados por número, no por orden de carga', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);
  const padre = mapaPorCodigo(ctx, 'PO-03');
  const p = ctx.Procesos.guardar({
    nombre: 'Ingreso del trabajador', tipo: 'OPERATIVO', nivel: 'SERVICIO',
    proceso_padre_id: padre.proceso_id
  }, ENC);

  [3, 1, 2].forEach((n) => {
    ctx.agregarFila_(ctx.SHEETS.SGC_PROCESO_PASOS, {
      paso_id: 'P' + n, proceso_id: p.proceso_id, numero: n, nombre: 'Paso ' + n, activa: true
    });
  });

  const d = ctx.Procesos.getDetalle({ proceso_id: p.proceso_id }, ENC);
  assert.deepEqual(toPlain(d.pasos).map((x) => x.numero), [1, 2, 3]);
});

// --- 4. Efecto en la matriz de cobertura ------------------------------------

test('4.4 pasa de faltante a parcial al cargar el mapa, y dice qué falta', () => {
  const ctx = loadConSchema();
  assert.equal(clausula(ctx, '4.4').estado, 'FALTANTE');

  ctx.Procesos.sembrarMapa({}, ENC);

  const d = ctx.MatrizCobertura.getDetalle({ codigo: '4.4' }, ENC);
  assert.equal(d.estado, 'PARCIAL', 'el mapa sin responsables no cierra §4.4.2 e');
  assert.match(d.nota, /sin responsable asignado/i);
  assert.match(d.nota, /sin objetivo definido/i);
  assert.match(d.resumen, /14 procesos en el mapa/);
});

test('4.4 se cierra cuando cada proceso tiene responsable y objetivo', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);

  ctx.leerFilasSeguro_(ctx.SHEETS.SGC_PROCESOS).forEach((p) => {
    ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_PROCESOS, 'proceso_id', p.proceso_id,
      { responsable_email: 'jefe@homepymes.cl', objetivo: 'Objetivo del proceso.' });
  });

  assert.equal(clausula(ctx, '4.4').estado, 'COMPLETO');
});

test('un mapa sin revisar en más de un año degrada 4.4', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);
  ctx.leerFilasSeguro_(ctx.SHEETS.SGC_PROCESOS).forEach((p) => {
    ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_PROCESOS, 'proceso_id', p.proceso_id, {
      responsable_email: 'jefe@homepymes.cl', objetivo: 'Objetivo.',
      fecha_ultima_revision: '2024-01-10'
    });
  });

  assert.equal(clausula(ctx, '4.4').estado, 'PARCIAL');
  assert.match(ctx.MatrizCobertura.getDetalle({ codigo: '4.4' }, ENC).nota, /última revisión tiene \d+ meses/i);

  ctx.Procesos.registrarRevision({}, ENC);
  assert.equal(clausula(ctx, '4.4').estado, 'COMPLETO');
});

test('8.1, 8.5 y 8.6 quedan en PARCIAL con la definición: falta la ejecución', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);
  const padre = mapaPorCodigo(ctx, 'PO-04');
  ctx.Procesos.guardar({
    nombre: 'Declaración de Renta', tipo: 'OPERATIVO', nivel: 'SERVICIO',
    proceso_padre_id: padre.proceso_id
  }, ENC);

  ['8.1', '8.5', '8.6'].forEach((cod) => {
    const d = ctx.MatrizCobertura.getDetalle({ codigo: cod }, ENC);
    assert.equal(d.estado, 'PARCIAL',
      cod + ': tener escrito cómo se presta un servicio no demuestra que se haya prestado');
    // Hasta la v11.0 F8 la nota decía "falta la Fase 8". Ahora esa fase
    // existe, así que la nota apunta a lo que falta HACER: registrar las
    // prestaciones. El estado no cambia -- la definición sola nunca cierra.
    assert.match(d.nota, /prestaci/i,
      cod + ': la nota tiene que decir qué falta, no dejarlo a la interpretación');
  });
});

test('sin procesos de servicio, 8.1 sigue faltante', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);
  assert.equal(clausula(ctx, '8.1').estado, 'FALTANTE',
    'el mapa solo no alcanza: 8.1 se apoya en los procesos de servicio');
});

test('un proceso de servicio sin pasos se avisa en la nota de 8.5', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);
  const padre = mapaPorCodigo(ctx, 'PO-03');
  ctx.Procesos.guardar({
    nombre: 'Sin pasos todavía', tipo: 'OPERATIVO', nivel: 'SERVICIO',
    proceso_padre_id: padre.proceso_id
  }, ENC);

  assert.match(ctx.MatrizCobertura.getDetalle({ codigo: '8.5' }, ENC).nota,
    /sin pasos definidos/i);
});

// --- 5. Permisos -------------------------------------------------------------

test('solo el Encargado edita el mapa, pero cualquiera lo lee', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Procesos.sembrarMapa({}, OPERATIVO)._forbidden, true);
  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_PROCESOS).length, 0);

  ctx.Procesos.sembrarMapa({}, ENC);
  const d = ctx.Procesos.listar({}, OPERATIVO);
  assert.equal(d.puede_gestionar, false);
  assert.equal(d.mapa.length, 14, 'saber cómo opera la organización es toma de conciencia (§7.3)');
});

test('el nombre y un tipo válido son obligatorios', () => {
  const ctx = loadConSchema();
  assert.match(ctx.Procesos.guardar({ tipo: 'OPERATIVO' }, ENC).message, /nombre/i);
  assert.match(ctx.Procesos.guardar({ nombre: 'X', tipo: 'OTRO' }, ENC).message,
    /estratégico, operativo o de apoyo/i);
});
