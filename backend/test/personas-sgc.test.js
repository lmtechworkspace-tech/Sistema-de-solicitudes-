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
  // v10.0 Fase 2b
  seedSheet(ctx, 'SGC_EVALUACIONES', ctx.COLUMNAS.SGC_EVALUACIONES);
  seedSheet(ctx, 'SGC_CAPACITACIONES', ctx.COLUMNAS.SGC_CAPACITACIONES);
  seedSheet(ctx, 'SGC_CAPACITACION_ASISTENTES', ctx.COLUMNAS.SGC_CAPACITACION_ASISTENTES);
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES);
  return ctx;
}

// v10.0 Tanda A: los items de la evaluacion salen del descriptor vigente de
// la persona (FO-PRO-02-04 "segun descriptor de cargo"), no de una lista
// fija -- por eso hace falta un descriptor con items antes de poder evaluar.
function descriptorConItems(ctx, personaId, overrides) {
  return ctx.Personas.guardarDescriptor(Object.assign({
    persona_id: personaId, version: 'v01', objetivo: 'Objetivo del cargo.',
    items_responsabilidades: ['Cumple plazos', 'Aplica el SGC', 'Reporta desviaciones'],
    items_habilidades: ['Conocimiento técnico', 'Trabajo en equipo']
  }, overrides), CTX_ENCARGADO);
}

// Mismo valor para todos los items de un grupo (largo n).
function respuestas(valor, n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(valor);
  return out;
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

test('guardarPersona: exige nombre, correo y tipo; el mismo correo+cargo EXACTO no se puede duplicar', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  assert.equal(ctx.Personas.guardarPersona({ usuario_email: 'x@y.cl', tipo: 'INT' }, CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.Personas.guardarPersona({ nombre: 'X', tipo: 'INT' }, CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.Personas.guardarPersona({ nombre: 'X', usuario_email: 'x@y.cl', tipo: 'RARO' }, CTX_ENCARGADO)._validationError, true);
  // Ana ya existe con cargo 'Prevencionista' (ver sembrar()) -- repetir
  // EXACTAMENTE el mismo cargo para el mismo correo es un duplicado real
  // (tipico doble clic), no un segundo cargo.
  assert.equal(ctx.Personas.guardarPersona({
    nombre: 'Ana Duplicada', usuario_email: 'ana@homepymes.cl', cargo: 'Prevencionista', tipo: 'INT'
  }, CTX_ENCARGADO)._validationError, true);
});

// v14.0 (bug real reportado): "Nueva persona" no deshabilitaba el boton al
// enviar, y la verificacion de duplicado + la creacion no eran atomicas --
// un doble clic (o dos pestañas) podian pasar AMBOS la verificacion antes
// de que cualquiera terminara de escribir, y crear dos fichas identicas.
// Fix real: LockService.getScriptLock().waitLock() alrededor de
// "verificar que no exista" + "crear" (mismo patron que Correlativo.gs ya
// usa para el numero de solicitud). Este test prueba que el lock se
// SUELTA incluso cuando la verificacion rechaza el duplicado (el `return`
// esta DENTRO del try) -- si no se soltara, la siguiente persona de este
// mismo test quedaria trabada esperando un lock que nadie libera.
test('guardarPersona: el lock se libera incluso si se rechaza un duplicado (no bloquea la siguiente creación)', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);

  const rechazado = ctx.Personas.guardarPersona({
    nombre: 'Ana Duplicada', usuario_email: 'ana@homepymes.cl', cargo: 'Prevencionista', tipo: 'INT'
  }, CTX_ENCARGADO);
  assert.equal(rechazado._validationError, true);

  // Si el lock hubiera quedado tomado, esta segunda creación (persona y
  // cargo totalmente distintos) fallaría o colgaría esperando el lock.
  const nueva = ctx.Personas.guardarPersona({
    nombre: 'Otra Persona', usuario_email: 'otra@homepymes.cl', cargo: 'Analista', tipo: 'INT'
  }, CTX_ENCARGADO);
  assert.equal(nueva._validationError, undefined);
  assert.notEqual(nueva.persona_id, ana.persona_id);
});

// v14.0: una persona con DOS CARGOS reales en la empresa (ej. Camila es
// Encargada de Prevención de Riesgos interna Y externa) se vincula con LA
// MISMA cuenta -- nunca se le pide un segundo correo, y cada cargo lleva su
// propio descriptor/inducción/evaluaciones sin mezclarse.
test('una persona puede tener DOS fichas (dos cargos) con el MISMO correo, cada una con su propio descriptor', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);

  const anaExterna = ctx.Personas.guardarPersona({
    nombre: 'Ana Perez', usuario_email: 'ana@homepymes.cl',
    cargo: 'Prevencionista (servicios a clientes)', tipo: 'EXT', area_id: 'PREVENCION'
  }, CTX_ENCARGADO);
  assert.equal(anaExterna._validationError, undefined, 'un cargo DISTINTO para el mismo correo se debe poder crear');
  assert.notEqual(anaExterna.persona_id, ana.persona_id, 'son dos fichas independientes');

  // El personal operativo, con su UNICA cuenta, ve SUS DOS cargos -- ni uno
  // solo, ni los de nadie mas.
  const propias = ctx.Personas.listar({}, CTX_ANA).personas;
  assert.equal(propias.length, 2);
  assert.ok(propias.every((p) => p.usuario_email === 'ana@homepymes.cl'));

  // Cada cargo lleva su propio descriptor, sin mezclarse con el del otro.
  ctx.Personas.guardarDescriptor({
    persona_id: ana.persona_id, version: 'v01', objetivo: 'Objetivo del cargo interno.'
  }, CTX_ENCARGADO);
  ctx.Personas.guardarDescriptor({
    persona_id: anaExterna.persona_id, version: 'v01', objetivo: 'Objetivo del cargo externo (clientes).'
  }, CTX_ENCARGADO);

  const fichaInterna = ctx.Personas.getFicha({ persona_id: ana.persona_id }, CTX_ENCARGADO);
  const fichaExterna = ctx.Personas.getFicha({ persona_id: anaExterna.persona_id }, CTX_ENCARGADO);
  assert.equal(fichaInterna.descriptor_vigente.objetivo, 'Objetivo del cargo interno.');
  assert.equal(fichaExterna.descriptor_vigente.objetivo, 'Objetivo del cargo externo (clientes).');
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

// v14.0: quitar del alcance del SGC -- DISTINTO de desvincular. Es para
// corregir una carga masiva que trajo personal de mas, no una salida real
// de la empresa (por eso no toca `estado`/`fecha_desvinculacion`, usa el
// flag `activa` que ya filtraban listar/buscarPersonaSgc_/getFicha).
test('quitarDelAlcance: NO es lo mismo que desvincular -- no toca estado ni fecha_desvinculacion', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);

  ctx.Personas.quitarDelAlcance({ persona_id: ana.persona_id }, CTX_ENCARGADO);

  assert.equal(ctx.Personas.listar({}, CTX_ENCARGADO).personas.length, 1, 'desaparece del listado por defecto');
  const fila = ctx.leerFilas_('SGC_PERSONAS').filter((p) => p.persona_id === ana.persona_id)[0];
  assert.equal(fila.estado, 'ACTIVO', 'no queda marcada como si hubiera renunciado');
  assert.equal(fila.fecha_desvinculacion, '', 'sin fecha de salida falsa');
  assert.equal(fila.activa, false);
});

test('quitarDelAlcance: solo quien gobierna, y solo el/la propia gobernante puede reincluir', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  assert.equal(ctx.Personas.quitarDelAlcance({ persona_id: ana.persona_id }, CTX_ANA)._forbidden, true,
    'el personal operativo no se puede quitar a si mismo del alcance');

  ctx.Personas.quitarDelAlcance({ persona_id: ana.persona_id }, CTX_ENCARGADO);
  const reincluida = ctx.Personas.quitarDelAlcance({ persona_id: ana.persona_id, reactivar: true }, CTX_ENCARGADO);
  assert.equal(reincluida.activa, true);
  assert.equal(ctx.Personas.listar({}, CTX_ENCARGADO).personas.length, 2, 'vuelve a aparecer');
});

test('quitarDelAlcance: solo quien gobierna puede pedir "incluir_fuera_alcance"; nadie mas los ve ni con el filtro', () => {
  const ctx = loadConSchema();
  const { ana, pedro } = sembrar(ctx);
  ctx.Personas.quitarDelAlcance({ persona_id: ana.persona_id }, CTX_ENCARGADO);

  assert.equal(ctx.Personas.listar({}, CTX_ENCARGADO).personas.length, 1, 'oculta por defecto');
  const conFiltro = ctx.Personas.listar({ incluir_fuera_alcance: true }, CTX_ENCARGADO).personas;
  assert.equal(conFiltro.length, 2, 'el Encargado SGC puede pedirlos para poder reincluirlos');
  assert.equal(conFiltro.filter((p) => p.persona_id === ana.persona_id)[0].fuera_de_alcance, true);
  assert.equal(conFiltro.filter((p) => p.persona_id === pedro.persona_id)[0].fuera_de_alcance, false);

  // Pedro (operativo) no gobierna: el filtro se ignora, jamas ve a Ana.
  const sinPermiso = ctx.Personas.listar({ incluir_fuera_alcance: true }, CTX_PEDRO).personas;
  assert.equal(sinPermiso.filter((p) => p.persona_id === ana.persona_id).length, 0);
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

// v14.0: "Editar" el descriptor vigente -- corrige la MISMA fila (una
// redaccion, no un cambio real de contenido regido). Distinto de
// guardarDescriptor ("Nueva versión"), que archiva y crea una fila nueva.
test('actualizarDescriptor: corrige la version vigente SIN versionar (misma fila)', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);

  const v01 = ctx.Personas.guardarDescriptor({
    persona_id: ana.persona_id, version: 'v01', objetivo: 'Asesorar en prevencion de riesgos.',
    items_responsabilidades: ['Cumple plazos']
  }, CTX_ENCARGADO);

  ctx.Personas.actualizarDescriptor({
    persona_id: ana.persona_id, descriptor_id: v01.descriptor_id,
    objetivo: 'Asesorar en prevención de riesgos laborales (corregido).',
    items_responsabilidades: ['Cumple plazos']
  }, CTX_ENCARGADO);

  const todos = ctx.leerFilas_('SGC_DESCRIPTORES').filter((d) => d.persona_id === ana.persona_id);
  assert.equal(todos.length, 1, 'editar NO crea una fila nueva');
  assert.equal(todos[0].version, 'v01', 'la version no se toca al editar');
  assert.equal(todos[0].objetivo, 'Asesorar en prevención de riesgos laborales (corregido).');

  const ficha = ctx.Personas.getFicha({ persona_id: ana.persona_id }, CTX_ENCARGADO);
  assert.equal(ficha.descriptor_vigente.objetivo, 'Asesorar en prevención de riesgos laborales (corregido).');
});

test('actualizarDescriptor: exige objetivo, solo gobierna lo edita, y no toca un descriptor ya archivado', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  const v01 = ctx.Personas.guardarDescriptor({ persona_id: ana.persona_id, version: 'v01', objetivo: 'X' }, CTX_ENCARGADO);

  assert.equal(ctx.Personas.actualizarDescriptor({
    persona_id: ana.persona_id, descriptor_id: v01.descriptor_id, objetivo: ''
  }, CTX_ENCARGADO)._validationError, true);

  assert.equal(ctx.Personas.actualizarDescriptor({
    persona_id: ana.persona_id, descriptor_id: v01.descriptor_id, objetivo: 'Y'
  }, CTX_ANA)._forbidden, true, 'el propio trabajador no edita su descriptor');

  // Se archiva v01 al crear v02 -- ahora v01 ya no es la vigente.
  ctx.Personas.guardarDescriptor({ persona_id: ana.persona_id, version: 'v02', objetivo: 'Z' }, CTX_ENCARGADO);
  assert.equal(ctx.Personas.actualizarDescriptor({
    persona_id: ana.persona_id, descriptor_id: v01.descriptor_id, objetivo: 'Y'
  }, CTX_ENCARGADO)._validationError, true, 'no se puede editar una version ya archivada');
});

test('actualizarDescriptor: si llega un archivo nuevo, reemplaza el de la MISMA fila', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  const v01 = ctx.Personas.guardarDescriptor({
    persona_id: ana.persona_id, version: 'v01', objetivo: 'X',
    nombre_archivo: 'original.pdf', contenido_base64: PDF_B64
  }, CTX_ENCARGADO);

  ctx.Personas.actualizarDescriptor({
    persona_id: ana.persona_id, descriptor_id: v01.descriptor_id, objetivo: 'X',
    nombre_archivo: 'corregido.pdf', contenido_base64: PDF_B64
  }, CTX_ENCARGADO);

  const todos = ctx.leerFilas_('SGC_DESCRIPTORES').filter((d) => d.persona_id === ana.persona_id);
  assert.equal(todos.length, 1);
  assert.equal(todos[0].archivo_nombre, 'corregido.pdf');
});

test('descargarDescriptor: mismo permiso que ver la ficha, y exige que haya archivo', () => {
  const ctx = loadConSchema();
  const { ana, pedro } = sembrar(ctx);
  const v01 = ctx.Personas.guardarDescriptor({
    persona_id: ana.persona_id, version: 'v01', objetivo: 'X',
    nombre_archivo: 'descriptor.pdf', contenido_base64: PDF_B64
  }, CTX_ENCARGADO);

  assert.ok(ctx.Personas.descargarDescriptor({
    persona_id: ana.persona_id, descriptor_id: v01.descriptor_id
  }, CTX_ANA).contenido_base64, 'Ana puede bajar el suyo');

  assert.equal(ctx.Personas.descargarDescriptor({
    persona_id: ana.persona_id, descriptor_id: v01.descriptor_id
  }, CTX_PEDRO)._forbidden, true, 'Pedro no ve la ficha de Ana');

  const sinArchivo = ctx.Personas.guardarDescriptor({ persona_id: pedro.persona_id, version: 'v01', objetivo: 'X' }, CTX_ENCARGADO);
  assert.equal(ctx.Personas.descargarDescriptor({
    persona_id: pedro.persona_id, descriptor_id: sinArchivo.descriptor_id
  }, CTX_PEDRO)._validationError, true, 'sin archivo adjunto, no hay que descargar');
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

// --- v10.0 Fase 2b + Tanda A: monitoreo de competencias (FO-PRO-02-04) -----
// v10.0 Tanda A: los items de la evaluacion salen del descriptor vigente
// (real: "segun descriptor de cargo"), califica DOS bloques por separado
// (responsabilidades / habilidades) y cada uno tiene su propio promedio.

test('no se puede evaluar sin un descriptor de cargo con items cargados', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  const r = ctx.Personas.registrarEvaluacion({ persona_id: ana.persona_id }, CTX_JEFA);
  assert.equal(r._validationError, true);
  assert.match(r.message, /descriptor/i);
});

test('evaluacion: los promedios se derivan de los puntajes del descriptor, no se escriben a mano', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  descriptorConItems(ctx, ana.persona_id);
  const e = ctx.Personas.registrarEvaluacion({
    persona_id: ana.persona_id,
    respuestas_responsabilidades: respuestas(4, 3),
    respuestas_habilidades: respuestas(4, 2)
  }, CTX_JEFA);
  assert.equal(e.promedio_responsabilidades, 4);
  assert.equal(e.promedio_habilidades, 4);
  assert.equal(e.requiere_capacitacion, false);
  assert.ok(e.proxima_evaluacion, 'debe quedar agendada la proxima a 12 meses');
  assert.equal(new Date(e.proxima_evaluacion).getFullYear() - new Date(e.fecha).getFullYear(), 1);
});

test('evaluacion: promedio bajo 3 en CUALQUIERA de los dos bloques marca necesidad de capacitacion', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  descriptorConItems(ctx, ana.persona_id);
  // Responsabilidades bien, habilidades mal: no se promedian entre si.
  const mixta = ctx.Personas.registrarEvaluacion({
    persona_id: ana.persona_id,
    respuestas_responsabilidades: respuestas(4, 3),
    respuestas_habilidades: respuestas(2, 2)
  }, CTX_JEFA);
  assert.equal(mixta.promedio_responsabilidades, 4);
  assert.equal(mixta.promedio_habilidades, 2);
  assert.equal(mixta.requiere_capacitacion, true);

  // Y el Encargado SGC se entera: un hallazgo que se queda en la planilla
  // no sirve de nada.
  const notifs = ctx.leerFilas_('NOTIFICACIONES_APP')
    .filter((n) => n.tipo === 'SGC_COMPETENCIA' && n.destinatario_email === 'sgc@homepymes.cl');
  assert.ok(notifs.length >= 1);
});

test('evaluacion: exige calificar TODOS los items del descriptor, entre 1 y 4', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  descriptorConItems(ctx, ana.persona_id);
  // Faltan respuestas de habilidades.
  assert.equal(ctx.Personas.registrarEvaluacion({
    persona_id: ana.persona_id, respuestas_responsabilidades: respuestas(3, 3)
  }, CTX_JEFA)._validationError, true);
  // Fuera de escala.
  assert.equal(ctx.Personas.registrarEvaluacion({
    persona_id: ana.persona_id,
    respuestas_responsabilidades: respuestas(5, 3), respuestas_habilidades: respuestas(3, 2)
  }, CTX_JEFA)._validationError, true);
  assert.equal(ctx.Personas.registrarEvaluacion({
    persona_id: ana.persona_id,
    respuestas_responsabilidades: respuestas(0, 3), respuestas_habilidades: respuestas(3, 2)
  }, CTX_JEFA)._validationError, true);
});

test('evaluacion: la hace la jefatura directa o el Encargado SGC, y nadie se evalua a si mismo', () => {
  const ctx = loadConSchema();
  const { ana, pedro } = sembrar(ctx);
  descriptorConItems(ctx, ana.persona_id);
  descriptorConItems(ctx, pedro.persona_id);
  const datosAna = {
    persona_id: ana.persona_id,
    respuestas_responsabilidades: respuestas(3, 3), respuestas_habilidades: respuestas(3, 2)
  };
  const datosPedro = {
    persona_id: pedro.persona_id,
    respuestas_responsabilidades: respuestas(3, 3), respuestas_habilidades: respuestas(3, 2)
  };

  // Pedro no es jefatura de Ana.
  assert.equal(ctx.Personas.registrarEvaluacion(datosAna, CTX_PEDRO)._forbidden, true);

  // Ana no puede autoevaluarse.
  assert.equal(ctx.Personas.registrarEvaluacion(datosAna, CTX_ANA)._forbidden, true);

  // La jefatura si.
  assert.ok(ctx.Personas.registrarEvaluacion(datosAna, CTX_JEFA).evaluacion_id);
  // Y el Encargado SGC tambien, aunque no sea la jefatura.
  assert.ok(ctx.Personas.registrarEvaluacion(datosPedro, CTX_ENCARGADO).evaluacion_id);
});

test('la ficha trae el historial de evaluaciones y marca si esta vencida', () => {
  const ctx = loadConSchema();
  const { ana } = sembrar(ctx);
  descriptorConItems(ctx, ana.persona_id);
  // Evaluacion vieja -> su proxima ya vencio.
  ctx.Personas.registrarEvaluacion({
    persona_id: ana.persona_id, fecha: '2020-01-01T00:00:00.000Z',
    respuestas_responsabilidades: respuestas(3, 3), respuestas_habilidades: respuestas(3, 2)
  }, CTX_JEFA);

  const ficha = ctx.Personas.getFicha({ persona_id: ana.persona_id }, CTX_ENCARGADO);
  assert.equal(ficha.evaluaciones.length, 1);
  assert.equal(ficha.evaluacion_vencida, true);
  assert.equal(ficha.escala_evaluacion.length, 4);
  assert.equal(ficha.items_responsabilidades.length, 3);
  assert.equal(ficha.items_habilidades.length, 2);
  assert.equal(ficha.evaluaciones[0].respuestas_responsabilidades.length, 3);
  assert.equal(ficha.evaluaciones[0].respuestas_responsabilidades[0].item, 'Cumple plazos');
});

// --- capacitaciones (FO-PRO-02-03 / FO-PRO-02-05) --------------------------

test('capacitacion: se programa, se realiza con asistentes, y suma horas solo a quien asistio', () => {
  const ctx = loadConSchema();
  const { ana, pedro } = sembrar(ctx);

  const cap = ctx.Personas.guardarCapacitacion({
    nombre: 'Interpretacion ISO 9001', horas: 8, fecha_programada: '2026-04-10', relator: 'Consultora X'
  }, CTX_ENCARGADO);
  assert.equal(cap.estado, 'PROGRAMADA');

  // Se convoca a ambos pero solo asiste Ana.
  ctx.Personas.registrarRealizacion({
    capacitacion_id: cap.capacitacion_id,
    fecha_realizada: new Date().toISOString(),
    asistentes: [ana.persona_id]
  }, CTX_ENCARGADO);

  const r = ctx.Personas.listarCapacitaciones({}, CTX_ENCARGADO);
  const horas = {};
  r.horas_por_persona.forEach((h) => { horas[h.persona_id] = h; });
  assert.equal(horas[ana.persona_id].horas, 8);
  assert.equal(horas[ana.persona_id].cumple_meta, true, '8 hrs supera la meta de 5');
  assert.equal(horas[pedro.persona_id].horas, 0);
  assert.equal(horas[pedro.persona_id].cumple_meta, false);
});

test('capacitacion: exige nombre y horas positivas; solo la gestiona el Encargado SGC', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  assert.equal(ctx.Personas.guardarCapacitacion({ horas: 4 }, CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.Personas.guardarCapacitacion({ nombre: 'X', horas: 0 }, CTX_ENCARGADO)._validationError, true);
  assert.equal(ctx.Personas.guardarCapacitacion({ nombre: 'X', horas: 4 }, CTX_ANA)._forbidden, true);
});

test('eficacia: es POR PARTICIPANTE, no por curso -- dos personas pueden tener resultado distinto', () => {
  const ctx = loadConSchema();
  const { ana, pedro } = sembrar(ctx);
  const cap = ctx.Personas.guardarCapacitacion({ nombre: 'Curso', horas: 4 }, CTX_ENCARGADO);

  assert.equal(ctx.Personas.registrarEficaciaAsistente({
    capacitacion_id: cap.capacitacion_id, persona_id: ana.persona_id, resultado: 'EFICAZ'
  }, CTX_ENCARGADO)._validationError, true, 'no se evalua algo que aun no se hace');

  ctx.Personas.registrarRealizacion({
    capacitacion_id: cap.capacitacion_id, asistentes: [ana.persona_id, pedro.persona_id]
  }, CTX_ENCARGADO);

  assert.equal(ctx.Personas.registrarEficaciaAsistente({
    capacitacion_id: cap.capacitacion_id, persona_id: ana.persona_id, resultado: 'NO_EFICAZ'
  }, CTX_ENCARGADO)._validationError, true, 'si no fue eficaz hay que decir por que');

  const okAna = ctx.Personas.registrarEficaciaAsistente({
    capacitacion_id: cap.capacitacion_id, persona_id: ana.persona_id, resultado: 'EFICAZ'
  }, CTX_ENCARGADO);
  assert.equal(okAna.eficacia_resultado, 'EFICAZ');

  const okPedro = ctx.Personas.registrarEficaciaAsistente({
    capacitacion_id: cap.capacitacion_id, persona_id: pedro.persona_id,
    resultado: 'NO_EFICAZ', observaciones: 'No aplicó lo aprendido.'
  }, CTX_ENCARGADO);
  assert.equal(okPedro.eficacia_resultado, 'NO_EFICAZ');
});

test('eficacia: no se puede evaluar a quien no asistio', () => {
  const ctx = loadConSchema();
  const { ana, pedro } = sembrar(ctx);
  const cap = ctx.Personas.guardarCapacitacion({ nombre: 'Curso', horas: 4 }, CTX_ENCARGADO);
  ctx.Personas.registrarRealizacion({
    capacitacion_id: cap.capacitacion_id, asistentes: [ana.persona_id]
  }, CTX_ENCARGADO);
  assert.equal(ctx.Personas.registrarEficaciaAsistente({
    capacitacion_id: cap.capacitacion_id, persona_id: pedro.persona_id, resultado: 'EFICAZ'
  }, CTX_ENCARGADO)._validationError, true);
});

test('eficacia pendiente: se marca sola a los 60 dias de realizada, por participante', () => {
  const ctx = loadConSchema();
  const { ana, pedro } = sembrar(ctx);
  const cap = ctx.Personas.guardarCapacitacion({ nombre: 'Curso viejo', horas: 4 }, CTX_ENCARGADO);
  const hace70dias = new Date(Date.now() - 70 * 86400000).toISOString();
  ctx.Personas.registrarRealizacion({
    capacitacion_id: cap.capacitacion_id, fecha_realizada: hace70dias,
    asistentes: [ana.persona_id, pedro.persona_id]
  }, CTX_ENCARGADO);
  ctx.Personas.registrarEficaciaAsistente({
    capacitacion_id: cap.capacitacion_id, persona_id: ana.persona_id, resultado: 'EFICAZ'
  }, CTX_ENCARGADO);

  const fila = ctx.Personas.listarCapacitaciones({}, CTX_ENCARGADO).capacitaciones[0];
  assert.equal(fila.eficacia_pendiente, true, 'Pedro sigue sin evaluar');
  const asistAna = fila.asistentes.filter((a) => a.persona_id === ana.persona_id)[0];
  const asistPedro = fila.asistentes.filter((a) => a.persona_id === pedro.persona_id)[0];
  assert.equal(asistAna.eficacia_pendiente, false);
  assert.equal(asistPedro.eficacia_pendiente, true);
});

// --- avisos automaticos ----------------------------------------------------

test('aviso: quien nunca fue evaluado aparece como pendiente (no solo los vencidos)', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  const r = ctx.Personas.recordatorioCompetencias();
  assert.ok(r.evaluaciones >= 1);

  const correos = ctx.leerFilas_('LOG_NOTIFICACIONES')
    .filter((l) => String(l.evento || '').indexOf('SGC_EVAL_PENDIENTE') === 0);
  assert.ok(correos.some((c) => c.destinatario === 'sgc@homepymes.cl'),
    'el Encargado SGC debe recibir la lista completa');
});

test('aviso: una persona recien evaluada deja de aparecer', () => {
  const ctx = loadConSchema();
  const { ana, pedro } = sembrar(ctx);
  descriptorConItems(ctx, ana.persona_id);
  descriptorConItems(ctx, pedro.persona_id);
  const datos = { respuestas_responsabilidades: respuestas(4, 3), respuestas_habilidades: respuestas(4, 2) };
  ctx.Personas.registrarEvaluacion(Object.assign({ persona_id: ana.persona_id }, datos), CTX_JEFA);
  ctx.Personas.registrarEvaluacion(Object.assign({ persona_id: pedro.persona_id }, datos), CTX_ENCARGADO);

  const r = ctx.Personas.recordatorioCompetencias();
  assert.equal(r.evaluaciones, 0, 'si todos estan al dia no hay nada que avisar');
});

test('aviso: horas bajo la meta llegan al Encargado SGC (Objetivo 4)', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  ctx.Personas.recordatorioCompetencias();
  const correos = ctx.leerFilas_('LOG_NOTIFICACIONES')
    .filter((l) => String(l.evento || '').indexOf('SGC_HORAS_BAJO_META') === 0);
  assert.ok(correos.some((c) => c.destinatario === 'sgc@homepymes.cl'));
});

test('aviso: no se repite dentro de la misma ventana (semana / semestre)', () => {
  const ctx = loadConSchema();
  sembrar(ctx);
  ctx.Personas.recordatorioCompetencias();
  const primera = ctx.leerFilas_('LOG_NOTIFICACIONES').length;
  ctx.Personas.recordatorioCompetencias();
  const segunda = ctx.leerFilas_('LOG_NOTIFICACIONES').length;
  assert.equal(segunda, primera, 'forzar la pasada de nuevo no debe reenviar lo mismo');
});
