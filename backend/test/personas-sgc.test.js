'use strict';

// v10.0 Fase 2a (documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md):
// la ficha del trabajador (PRO-02). Evidencia de ISO 9001 7.2 (competencia).
//
// Lo que protegen estos tests, en orden de importancia:
//  1. EL AISLAMIENTO DE LA FICHA. Una ficha trae RUT, contrato y
//     evaluaciones: que el personal operativo pueda ver la de un companero
//     no es un detalle de UX, es un problema de datos personales.
//  2. Que desvincular NO borre (la especificacion lo pide y la norma lo
//     necesita: el historial es evidencia).
//  3. Que el descriptor de cargo quede versionado -- hay que poder
//     demostrar que descriptor regia cuando se evaluo a la persona.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  seedSheet(ctx, 'SGC_PERSONAS', ctx.COLUMNAS.SGC_PERSONAS);
  seedSheet(ctx, 'SGC_DESCRIPTORES', ctx.COLUMNAS.SGC_DESCRIPTORES);
  seedSheet(ctx, 'SGC_PERSONA_DOCUMENTOS', ctx.COLUMNAS.SGC_PERSONA_DOCUMENTOS);
  seedSheet(ctx, 'SGC_INDUCCIONES', ctx.COLUMNAS.SGC_INDUCCIONES);
  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES);
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS);
  seedSheet(ctx, 'LOG_SISTEMA', ctx.COLUMNAS.LOG_SISTEMA);
  return ctx;
}

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_JEFA = { email: 'jefa@homepymes.cl', nombre: 'Jefa Prevencion', rol: 'DEV' };
const CTX_ANA = { email: 'ana@homepymes.cl', nombre: 'Ana', rol: 'DEV' };
const CTX_PEDRO = { email: 'pedro@homepymes.cl', nombre: 'Pedro', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };
const CTX_GERENCIA = { email: 'gerencia@homepymes.cl', nombre: 'Gerencia', rol: 'GERENCIA' };

const PDF_B64 = Buffer.from('%PDF-1.4 descriptor').toString('base64');

function sembrar(ctx) {
  ctx.Calidad.gestionarRol({ usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  ctx.Calidad.gestionarRol({ usuario_email: 'jefa@homepymes.cl', rol_sgc: 'JEFATURA_AREA', area_id: 'PREVENCION' }, CTX_ADM);
  ctx.Calidad.gestionarRol({ usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  ctx.Calidad.gestionarRol({ usuario_email: 'pedro@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'CONTABILIDAD' }, CTX_ADM);

  const ana = ctx.Personas.guardarPersona({
    usuario_email: 'ana@homepymes.cl', nombre: 'Ana Perez', rut: '11.111.111-1',
    cargo: 'Prevencionista', tipo: 'EXT', area_id: 'PREVENCION',
    jefatura_email: 'jefa@homepymes.cl', fecha_ingreso: '2025-03-01'
  }, CTX_ENCARGADO);
  const pedro = ctx.Personas.guardarPersona({
    usuario_email: 'pedro@homepymes.cl', nombre: 'Pedro Soto', rut: '22.222.222-2',
    cargo: 'Analista Contable', tipo: 'INT', area_id: 'CONTABILIDAD',
    fecha_ingreso: '2024-05-01'
  }, CTX_ENCARGADO);
  return { ana, pedro };
}

// --- aislamiento de la ficha: lo mas importante del modulo -----------------

test('el personal operativo ve UNICAMENTE su propia ficha', () => {
  const ctx = loadConSchema();
  const { ana, pedro } = sembrar(ctx);

  const listaAna = ctx.Personas.listar({}, CTX_ANA);
  assert.equal(listaAna.personas.length, 1, 'Ana no debe ver a nadie mas');
  assert.equal(listaAna.personas[0].usuario_email, 'ana@homepymes.cl');
  assert.equal(listaAna.puede_gestionar, false);

  // Y aunque se salte el listado y pida la ficha de Pedro por id.
  assert.equal(ctx.Personas.getFicha({ persona_id: pedro.persona_id }, CTX_ANA)._forbidden, true);
  assert.ok(ctx.Personas.getFicha({ persona_id: ana.persona_id }, CTX_ANA).persona);
});

test('la jefatura ve su ficha y la de su equipo, no la de otras areas', () => {
  const ctx = loadConSchema();
  const { ana, pedro } = sembrar(ctx);

  // Ana declara a jefa@ como jefatura directa en su ficha del SGC.
  assert.ok(ctx.Personas.getFicha({ persona_id: ana.persona_id }, CTX_JEFA).persona);
  assert.equal(ctx.Personas.getFicha({ persona_id: pedro.persona_id }, CTX_JEFA)._forbidden, true);
});

test('la jerarquia de JEFATURAS tambien da acceso, sin repetir el dato en la ficha', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  // Pedro no declaro jefatura en su ficha, pero existe en JEFATURAS.
  ctx.agregarFila_('JEFATURAS', {
    jefatura_id: 'J1', jefe_email: 'jefa@homepymes.cl', subordinado_email: 'pedro@homepymes.cl', activo: true
  });
  const pedro = ctx.leerFilas_('SGC_PERSONAS').filter((p) => p.usuario_email === 'pedro@homepymes.cl')[0];
  assert.ok(ctx.Personas.getFicha({ persona_id: pedro.persona_id }, CTX_JEFA).persona,
    'la jerarquia operativa que ya existe debe bastar');
});

test('Encargado SGC, ADM, Direccion y Gerencia ven todas las fichas', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  assert.equal(ctx.Personas.listar({}, CTX_ENCARGADO).personas.length, 2);
  assert.equal(ctx.Personas.listar({}, CTX_ADM).personas.length, 2);
  assert.equal(ctx.Personas.listar({}, CTX_GERENCIA).personas.length, 2);
});

// --- alta y baja -----------------------------------------------------------

test('guardarPersona: exige nombre, correo y tipo; el correo no se puede duplicar', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  assert.equal(ctx.Personas.guardarPersona({ usuario_email: 'x@y.cl', tipo: 'INT' }, CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.Personas.guardarPersona({ nombre: 'X', tipo: 'INT' }, CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.Personas.guardarPersona({ nombre: 'X', usuario_email: 'x@y.cl', tipo: 'RARO' }, CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.Personas.guardarPersona({
    nombre: 'Ana Duplicada', usuario_email: 'ana@homepymes.cl', tipo: 'INT'
  }, CTX_ENCARGADO)._validationError, true);
});

test('guardarPersona: solo el Encargado SGC o ADM; el personal no crea fichas', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  assert.equal(ctx.Personas.guardarPersona({
    nombre: 'Intruso', usuario_email: 'intruso@y.cl', tipo: 'INT'
  }, CTX_ANA)._forbidden, true);
});

test('al crear una persona se siembra su induccion con los 5 items del SGC', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  const items = ctx.leerFilas_('SGC_INDUCCIONES').filter((i) => i.persona_id === ana.persona_id);
  assert.equal(items.length, 5);
  assert.ok(items.every((i) => i.estado === 'PENDIENTE'));
  assert.ok(items.some((i) => i.item === 'Política de Calidad'));
});

test('desvincular NO borra: la persona sale del listado pero conserva su historial', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);

  ctx.Personas.desvincular({ persona_id: ana.persona_id }, CTX_ENCARGADO);

  assert.equal(ctx.Personas.listar({}, CTX_ENCARGADO).personas.length, 1, 'por defecto no aparece');
  assert.equal(ctx.Personas.listar({ incluir_desvinculados: true }, CTX_ENCARGADO).personas.length, 2,
    'pero se puede consultar');
  assert.equal(ctx.leerFilas_('SGC_PERSONAS').length, 2, 'la fila nunca se borra');
  assert.equal(ctx.leerFilas_('SGC_INDUCCIONES').filter((i) => i.persona_id === ana.persona_id).length, 5,
    'su historial de induccion sigue ahi');

  const reactivada = ctx.Personas.desvincular({ persona_id: ana.persona_id, reactivar: true }, CTX_ENCARGADO);
  assert.equal(reactivada.estado, 'ACTIVO');
});

// --- descriptor de cargo (FO-PRO-02-01) ------------------------------------

test('descriptor: se versiona -- el anterior deja de ser vigente pero se conserva', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);

  ctx.Personas.guardarDescriptor({
    persona_id: ana.persona_id, version: 'v01', objetivo: 'Asesorar en prevencion de riesgos.',
    funciones: 'Visitas a terreno.', nivel_educacional: 'Tecnico'
  }, CTX_ENCARGADO);
  ctx.Personas.guardarDescriptor({
    persona_id: ana.persona_id, version: 'v02', objetivo: 'Asesorar y capacitar en prevencion.',
    funciones: 'Visitas a terreno y capacitaciones.'
  }, CTX_ENCARGADO);

  const todos = ctx.leerFilas_('SGC_DESCRIPTORES').filter((d) => d.persona_id === ana.persona_id);
  assert.equal(todos.length, 2, 'el descriptor anterior se conserva');
  const vigentes = todos.filter((d) => d.vigente === true || d.vigente === 'TRUE');
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0].version, 'v02');

  const ficha = ctx.Personas.getFicha({ persona_id: ana.persona_id }, CTX_ENCARGADO);
  assert.equal(ficha.descriptor_vigente.version, 'v02');
});

test('descriptor: exige version y objetivo, y solo lo edita quien gobierna el SGC', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  assert.equal(ctx.Personas.guardarDescriptor({ persona_id: ana.persona_id, objetivo: 'X' }, CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.Personas.guardarDescriptor({ persona_id: ana.persona_id, version: 'v01' }, CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.Personas.guardarDescriptor({
    persona_id: ana.persona_id, version: 'v01', objetivo: 'X'
  }, CTX_ANA)._forbidden, true);
});

test('el listado avisa quien no tiene descriptor todavia', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  ctx.Personas.guardarDescriptor({ persona_id: ana.persona_id, version: 'v01', objetivo: 'X' }, CTX_ENCARGADO);

  const lista = ctx.Personas.listar({}, CTX_ENCARGADO).personas;
  const fAna = lista.filter((p) => p.usuario_email === 'ana@homepymes.cl')[0];
  const fPedro = lista.filter((p) => p.usuario_email === 'pedro@homepymes.cl')[0];
  assert.equal(fAna.tiene_descriptor, true);
  assert.equal(fAna.descriptor_version, 'v01');
  assert.equal(fPedro.tiene_descriptor, false);
});

// --- documentos del personal ------------------------------------------------

test('documentos del personal: se cargan validados y solo los ve quien ve la ficha', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);

  const doc = ctx.Personas.guardarDocumento({
    persona_id: ana.persona_id, tipo: 'CV', nombre: 'CV Ana',
    nombre_archivo: 'cv.pdf', contenido_base64: PDF_B64
  }, CTX_ENCARGADO);
  assert.ok(doc.archivo_id);

  assert.equal(ctx.Personas.guardarDocumento({
    persona_id: ana.persona_id, tipo: 'INVENTADO', nombre_archivo: 'x.pdf', contenido_base64: PDF_B64
  }, CTX_ENCARGADO)._validationError, true);

  // Pedro no ve la ficha de Ana -> tampoco puede bajar su CV.
  assert.equal(ctx.Personas.descargarDocumento({
    persona_id: ana.persona_id, doc_id: doc.doc_id
  }, CTX_PEDRO)._forbidden, true);

  // Ana si puede bajar el suyo.
  assert.ok(ctx.Personas.descargarDocumento({
    persona_id: ana.persona_id, doc_id: doc.doc_id
  }, CTX_ANA).contenido_base64);
});

// --- induccion (FO-PRO-02-02) -----------------------------------------------

test('induccion: la completa el Encargado SGC o la jefatura directa, no el propio trabajador', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  const item = ctx.leerFilas_('SGC_INDUCCIONES').filter((i) => i.persona_id === ana.persona_id)[0];

  assert.equal(ctx.Personas.registrarInduccion({
    persona_id: ana.persona_id, induccion_id: item.induccion_id, estado: 'COMPLETADA'
  }, CTX_ANA)._forbidden, true, 'nadie firma su propia induccion');

  const porJefa = ctx.Personas.registrarInduccion({
    persona_id: ana.persona_id, induccion_id: item.induccion_id,
    estado: 'COMPLETADA', fecha: '2025-03-05'
  }, CTX_JEFA);
  assert.equal(porJefa.estado, 'COMPLETADA');
  assert.equal(porJefa.relator_email, 'jefa@homepymes.cl', 'el relator por defecto es quien la registra');

  const lista = ctx.Personas.listar({}, CTX_ENCARGADO).personas
    .filter((p) => p.usuario_email === 'ana@homepymes.cl')[0];
  assert.equal(lista.induccion_completadas, 1);
  assert.equal(lista.induccion_total, 5);
});
