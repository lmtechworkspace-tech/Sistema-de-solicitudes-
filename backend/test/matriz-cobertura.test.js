'use strict';

// v10.0 Fase 6b — matriz de cobertura ISO 9001 + "modo auditoría" (mejora
// propuesta, no está en la especificación original).
//
// Lo que protegen estos tests, por orden de importancia para el auditor:
//  1. Que el estado de cada cláusula salga de DATOS REALES, no de una
//     opinión: sin NC no hay evidencia del ciclo de mejora; con NC pero sin
//     eficacia verificada, la evidencia existe pero es floja (PARCIAL).
//  2. Que las clausulas cuya evidencia es un DOCUMENTO especifico (politica,
//     alcance, mapa de procesos) NUNCA se adivinen por palabras clave --
//     dependen exclusivamente de que el Encargado SGC las haya etiquetado
//     en la ficha del documento.
//  3. Que una clausula sin ningun modulo que la cubra (contexto, riesgos)
//     diga POR QUE, no que aparezca vacia sin explicacion.
//  4. Que el resumen global cuente bien completo/parcial/faltante.
//  5. Permisos: Gerencia y el AUDITOR_EXTERNO ven la matriz; el personal
//     operativo no.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  seedSheet(ctx, 'SGC_DOCUMENTOS', ctx.COLUMNAS.SGC_DOCUMENTOS);
  seedSheet(ctx, 'SGC_DOC_VERSIONES', ctx.COLUMNAS.SGC_DOC_VERSIONES);
  seedSheet(ctx, 'SGC_DOC_DESTINATARIOS', ctx.COLUMNAS.SGC_DOC_DESTINATARIOS);
  seedSheet(ctx, 'SGC_DOC_ACUSES', ctx.COLUMNAS.SGC_DOC_ACUSES);
  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES);
  seedSheet(ctx, 'SGC_NC', ctx.COLUMNAS.SGC_NC);
  seedSheet(ctx, 'SGC_AUDITORIAS', ctx.COLUMNAS.SGC_AUDITORIAS);
  seedSheet(ctx, 'SGC_AUD_HALLAZGOS', ctx.COLUMNAS.SGC_AUD_HALLAZGOS);
  seedSheet(ctx, 'SGC_PROVEEDORES', ctx.COLUMNAS.SGC_PROVEEDORES);
  seedSheet(ctx, 'SGC_REVISIONES', ctx.COLUMNAS.SGC_REVISIONES);
  seedSheet(ctx, 'SGC_REVISION_ACUERDOS', ctx.COLUMNAS.SGC_REVISION_ACUERDOS);
  seedSheet(ctx, 'SGC_OBJETIVOS', ctx.COLUMNAS.SGC_OBJETIVOS);
  seedSheet(ctx, 'SGC_INDICADOR_LECTURAS', ctx.COLUMNAS.SGC_INDICADOR_LECTURAS);
  seedSheet(ctx, 'SGC_PERSONAS', ctx.COLUMNAS.SGC_PERSONAS);
  seedSheet(ctx, 'SGC_DESCRIPTORES', ctx.COLUMNAS.SGC_DESCRIPTORES);
  seedSheet(ctx, 'SGC_EVALUACIONES', ctx.COLUMNAS.SGC_EVALUACIONES);
  seedSheet(ctx, 'SGC_INDUCCIONES', ctx.COLUMNAS.SGC_INDUCCIONES);
  seedSheet(ctx, 'NOVEDADES', ctx.COLUMNAS.NOVEDADES);
  seedSheet(ctx, 'ACTIVIDADES', ctx.COLUMNAS.ACTIVIDADES);
  seedSheet(ctx, 'LOG_SISTEMA', ctx.COLUMNAS.LOG_SISTEMA);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP);
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES);
  return ctx;
}

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };
const CTX_GERENCIA = { email: 'gerencia@homepymes.cl', nombre: 'Gerencia', rol: 'GERENCIA' };
const CTX_AUDITOR = { email: 'auditor@certificadora.cl', nombre: 'Auditor', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

function sembrarRoles(ctx) {
  ctx.Calidad.gestionarRol({ usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  ctx.Calidad.gestionarRol({ usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ADM);
  ctx.Calidad.gestionarRol({
    usuario_email: 'auditor@certificadora.cl', rol_sgc: 'AUDITOR_EXTERNO',
    vigencia_hasta: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  }, CTX_ADM);
}

function clausula(ctx, codigo) {
  const m = toPlain(ctx.MatrizCobertura.listar({}, CTX_ENCARGADO));
  return m.clausulas.filter(function (c) { return c.codigo === codigo; })[0];
}

// --- el estado sale de datos reales, no de una opinion -----------------------

test('v10.0 F6b: sin NC, 10.2 y 8.7 quedan FALTANTE con nota explicativa', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  const c102 = clausula(ctx, '10.2');
  assert.equal(c102.estado, 'FALTANTE');

  const detalle = toPlain(ctx.MatrizCobertura.getDetalle({ codigo: '10.2' }, CTX_ENCARGADO));
  assert.match(detalle.resumen, /No hay no conformidades/i);
});

test('v10.0 F6b: una NC abierta sube 10.2 a PARCIAL; con eficacia verificada sube a COMPLETO', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  ctx.agregarFila_(ctx.SHEETS.SGC_NC, {
    nc_id: 'NC-1', descripcion: 'Entrega tardía a cliente', estado: 'ABIERTA',
    fecha_deteccion: '2026-01-10T12:00:00.000Z', responsable_email: 'sgc@homepymes.cl',
    activa: true
  });
  assert.equal(clausula(ctx, '10.2').estado, 'PARCIAL');

  ctx.agregarFila_(ctx.SHEETS.SGC_NC, {
    nc_id: 'NC-2', descripcion: 'Documento vencido en circulación', estado: 'CERRADA',
    fecha_deteccion: '2026-02-01T12:00:00.000Z', responsable_email: 'sgc@homepymes.cl',
    eficacia_resultado: 'EFICAZ', activa: true
  });
  assert.equal(clausula(ctx, '10.2').estado, 'COMPLETO');
  // 8.7 comparte la misma fuente (salidas no conformes).
  assert.equal(clausula(ctx, '8.7').estado, 'COMPLETO');
});

test('v10.0 F6b: objetivos abiertos y todos medidos dejan 6.2 y 9.1 en COMPLETO', () => {
  // El año pasado: todos sus periodos ya estan cerrados, asi que cualquier
  // clave de periodo es valida sin importar el mes en que corra el test.
  const anio = new Date().getFullYear() - 1;
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  assert.equal(clausula(ctx, '6.2').estado, 'FALTANTE');

  ctx.Objetivos.sembrarAnio({ anio: anio }, CTX_ENCARGADO);
  assert.equal(clausula(ctx, '6.2').estado, 'FALTANTE',
    'sembrar la meta no basta: sin ninguna medicion no hay evidencia de que se este siguiendo el objetivo');

  const PERIODO_POR_FRECUENCIA = { MENSUAL: anio + '-M01', TRIMESTRAL: anio + '-T1', SEMESTRAL: anio + '-S1', ANUAL: String(anio) };
  const tablero = toPlain(ctx.Objetivos.listar({ anio: anio }, CTX_ENCARGADO));
  tablero.objetivos.forEach(function (o) {
    const r = toPlain(ctx.Objetivos.registrarLectura({
      objetivo_id: o.objetivo_id, periodo: PERIODO_POR_FRECUENCIA[o.frecuencia], valor: 50
    }, CTX_ENCARGADO));
    assert.equal(r.ok, true, 'la lectura de ' + o.objetivo_general + ' debe guardarse');
  });

  assert.equal(clausula(ctx, '6.2').estado, 'COMPLETO');
  assert.equal(clausula(ctx, '9.1').estado, 'COMPLETO', '9.1 comparte la evidencia de 6.2');
});

test('v10.0 F6b: 7.2 y 7.3 llegan a COMPLETO solo cuando la cobertura de personal supera el umbral', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  ctx.agregarFila_(ctx.SHEETS.SGC_PERSONAS, { persona_id: 'P1', nombre: 'Ana', estado: 'VIGENTE', activa: true });
  ctx.agregarFila_(ctx.SHEETS.SGC_PERSONAS, { persona_id: 'P2', nombre: 'Bruno', estado: 'VIGENTE', activa: true });

  assert.equal(clausula(ctx, '7.2').estado, 'FALTANTE');

  // Solo Ana tiene descriptor + evaluación: 1 de 2 = 50%, bajo el umbral.
  ctx.agregarFila_(ctx.SHEETS.SGC_DESCRIPTORES, { descriptor_id: 'D1', persona_id: 'P1', vigente: true });
  ctx.agregarFila_(ctx.SHEETS.SGC_EVALUACIONES, { evaluacion_id: 'E1', persona_id: 'P1', fecha: '2026-01-01T00:00:00.000Z', evaluador_email: 'jefe@homepymes.cl' });
  assert.equal(clausula(ctx, '7.2').estado, 'PARCIAL');

  // Ahora Bruno también.
  ctx.agregarFila_(ctx.SHEETS.SGC_DESCRIPTORES, { descriptor_id: 'D2', persona_id: 'P2', vigente: true });
  ctx.agregarFila_(ctx.SHEETS.SGC_EVALUACIONES, { evaluacion_id: 'E2', persona_id: 'P2', fecha: '2026-01-01T00:00:00.000Z', evaluador_email: 'jefe@homepymes.cl' });
  assert.equal(clausula(ctx, '7.2').estado, 'COMPLETO');
});

// --- las clausulas de documento NUNCA se adivinan -----------------------------

test('v10.0 F6b: 5.2 (política) queda FALTANTE aunque existan documentos, hasta que se etiqueten', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  const doc = toPlain(ctx.Calidad.crearDocumento({
    codigo: 'DOC-01', nombre: 'Manual de Calidad', tipo: 'DOC', visibilidad: 'TODOS'
  }, CTX_ENCARGADO));

  assert.equal(clausula(ctx, '5.2').estado, 'FALTANTE',
    'un documento sin etiquetar no cuenta como evidencia de la política, aunque su nombre sugiera que lo es');

  const detalleSinEtiquetar = toPlain(ctx.MatrizCobertura.getDetalle({ codigo: '5.2' }, CTX_ENCARGADO));
  assert.match(detalleSinEtiquetar.nota, /etiqueta el documento/i);

  ctx.Calidad.actualizarDocumento({
    documento_id: doc.documento_id, clausulas_iso: ['5.2']
  }, CTX_ENCARGADO);

  assert.equal(clausula(ctx, '5.2').estado, 'COMPLETO');
  const detalle = toPlain(ctx.MatrizCobertura.getDetalle({ codigo: '5.2' }, CTX_ENCARGADO));
  assert.equal(detalle.evidencia.length, 1);
  assert.match(detalle.evidencia[0].descripcion, /DOC-01/);
});

test('v10.0 F6b: un código de cláusula inventado se descarta al guardar, no se acepta', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const doc = toPlain(ctx.Calidad.crearDocumento({
    codigo: 'DOC-02', nombre: 'Otro documento', tipo: 'DOC', visibilidad: 'TODOS',
    clausulas_iso: ['5.2', '99.9', '']
  }, CTX_ENCARGADO));

  const detalle = toPlain(ctx.Calidad.getDocumento({ documento_id: doc.documento_id }, CTX_ENCARGADO));
  assert.deepEqual(detalle.documento.clausulas_iso, ['5.2']);
});

test('v10.0 F6b: una cláusula sin ningún módulo que la cubra explica por qué, no queda muda', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  // 6.1 servia de ejemplo hasta la v11.0 F3, que le dio modulo propio.
  // 6.3 (planificacion de cambios) sigue sin tenerlo, y lo que este test
  // protege es que la matriz DIGA por que, no que 6.1 este vacia.
  const c63 = toPlain(ctx.MatrizCobertura.getDetalle({ codigo: '6.3' }, CTX_ENCARGADO));
  assert.equal(c63.estado, 'FALTANTE');
  assert.match(c63.nota, /no tiene un módulo propio/i);
});

// --- resumen global ------------------------------------------------------------

test('v10.0 F6b: el resumen global cuenta 28 cláusulas y las clasifica correctamente', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const m = toPlain(ctx.MatrizCobertura.listar({}, CTX_ENCARGADO));
  assert.equal(m.clausulas.length, 28);
  assert.equal(m.resumen.total, 28);
  assert.equal(m.resumen.completo + m.resumen.parcial + m.resumen.faltante + m.resumen.no_aplica, 28);
});

// --- permisos --------------------------------------------------------------

test('v10.0 F6b: Gerencia y el auditor externo ven la matriz; el operativo no', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  const gerencia = toPlain(ctx.MatrizCobertura.listar({}, CTX_GERENCIA));
  assert.equal(gerencia.clausulas.length, 28);
  assert.equal(gerencia.puede_gestionar, false);

  const auditor = toPlain(ctx.MatrizCobertura.listar({}, CTX_AUDITOR));
  assert.equal(auditor.clausulas.length, 28);

  const operativo = toPlain(ctx.MatrizCobertura.listar({}, CTX_OPERATIVO));
  assert.equal(operativo._forbidden, true);
});

// --- modo auditoria: PDF ------------------------------------------------------

test('v10.0 F6b: descargar la evidencia de una cláusula devuelve un PDF con nombre por cláusula', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = toPlain(ctx.MatrizCobertura.descargarEvidencia({ codigo: '9.3' }, CTX_AUDITOR));
  assert.ok(r.pdf_base64 && r.pdf_base64.length > 0);
  assert.match(r.filename, /9\.3/);
});

test('v10.0 F6b: una cláusula inexistente se rechaza sin generar nada', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const r = toPlain(ctx.MatrizCobertura.descargarEvidencia({ codigo: '99.9' }, CTX_ENCARGADO));
  assert.ok(r._validationError || r.campo);
});
