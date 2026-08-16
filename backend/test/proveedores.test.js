'use strict';

// v10.0 Fase 5a — proveedores externos (PRO-04, §8.4 de la norma).
//
// Lo que protegen estos tests, por orden de importancia para el auditor:
//  1. Que el corte de aprobacion sea EXACTAMENTE el del procedimiento:
//     "se desechara cuando obtenga calificacion promedio inferior o igual
//     a 5.0". Un 5.0 reprueba; un 5.01 no.
//  2. Que el proveedor UNICO no se trate como el resto: no se desecha, se
//     le pide una reunion de mejora. Tratarlos igual seria pedir algo
//     imposible de cumplir.
//  3. Que el listado maestro (FO-PRO-04-01) refleje solo la ultima
//     evaluacion, sin que nadie tenga que actualizarlo a mano.
//  4. Que la evaluacion sea anual y que no evaluar tambien se avise.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  seedSheet(ctx, 'SGC_PROVEEDORES', ctx.COLUMNAS.SGC_PROVEEDORES);
  seedSheet(ctx, 'SGC_PROVEEDOR_EVALUACIONES', ctx.COLUMNAS.SGC_PROVEEDOR_EVALUACIONES);
  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES);
  seedSheet(ctx, 'LOG_SISTEMA', ctx.COLUMNAS.LOG_SISTEMA);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP);
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES);
  return ctx;
}

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };
const CTX_GERENCIA = { email: 'gerencia@homepymes.cl', nombre: 'Gerencia', rol: 'GERENCIA' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

function sembrarRoles(ctx) {
  ctx.Calidad.gestionarRol({ usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  ctx.Calidad.gestionarRol({ usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ADM);
}

function crearProveedor(ctx, overrides, contexto) {
  return ctx.Proveedores.guardar(Object.assign({
    nombre: 'Insumos Oficina SpA',
    rut: '76.111.111-1',
    producto_servicio: 'Artículos de oficina'
  }, overrides), contexto || CTX_ENCARGADO);
}

// Notas que dan un promedio exacto conocido.
function notas(valor) {
  return {
    calidad: valor, plazo_entrega: valor, costos: valor,
    tiempo_respuesta: valor, precio: valor, postventa: valor
  };
}

// --- alta y listado maestro -------------------------------------------------

test('guardar: exige nombre y producto/servicio (las dos primeras columnas del FO-PRO-04-01)', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  assert.equal(crearProveedor(ctx, { nombre: '' })._validationError, true);
  assert.equal(crearProveedor(ctx, { producto_servicio: '' })._validationError, true);
  assert.equal(crearProveedor(ctx, { email: 'no-es-correo' })._validationError, true);

  const p = crearProveedor(ctx);
  assert.equal(p.nombre, 'Insumos Oficina SpA');
  // Nace SIN evaluar: aprobarlo es resultado de evaluarlo, no del alta.
  assert.equal(p.estado, 'SIN_EVALUAR');
});

test('guardar: el RUT no se repite -- duplicarlo partiria el historial en dos fichas', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearProveedor(ctx);
  const dup = crearProveedor(ctx, { nombre: 'Otro nombre, mismo RUT' });
  assert.equal(dup._validationError, true);
});

test('guardar: solo el Encargado SGC (o ADM) mantiene el listado', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  assert.equal(crearProveedor(ctx, {}, CTX_OPERATIVO)._forbidden, true);
  assert.equal(crearProveedor(ctx, { rut: '77.999.999-9' }, CTX_ADM).nombre, 'Insumos Oficina SpA');
});

// --- el corte de PRO-04 §6.2 ------------------------------------------------

test('evaluar: 5.0 REPRUEBA -- el procedimiento dice "inferior o igual a 5.0"', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const p = crearProveedor(ctx);

  const r = ctx.Proveedores.evaluar(Object.assign({ proveedor_id: p.proveedor_id }, notas(5)), CTX_ENCARGADO);
  assert.equal(r.evaluacion.promedio, 5);
  assert.equal(r.evaluacion.aprobado, false, 'un 5.0 exacto no puede quedar aprobado');
  assert.equal(r.proveedor.estado, 'REPROBADO');
  // La escala cualitativa y el corte numerico NO coinciden, y eso es del
  // procedimiento: 5.0 cae en "Regular" pero igual reprueba.
  assert.equal(r.evaluacion.resultado, 'REGULAR');
});

test('evaluar: por encima de 5.0 aprueba, y la escala cualitativa sigue a PRO-04', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  const p1 = crearProveedor(ctx, { rut: '1-1' });
  const bueno = ctx.Proveedores.evaluar(Object.assign({ proveedor_id: p1.proveedor_id }, notas(8)), CTX_ENCARGADO);
  assert.equal(bueno.evaluacion.aprobado, true);
  assert.equal(bueno.evaluacion.resultado, 'BUENO');
  assert.equal(bueno.proveedor.estado, 'APROBADO');

  const p2 = crearProveedor(ctx, { rut: '2-2' });
  const malo = ctx.Proveedores.evaluar(Object.assign({ proveedor_id: p2.proveedor_id }, notas(3)), CTX_ENCARGADO);
  assert.equal(malo.evaluacion.resultado, 'MALO');
  assert.equal(malo.evaluacion.aprobado, false);

  const p3 = crearProveedor(ctx, { rut: '3-3' });
  const regular = ctx.Proveedores.evaluar(Object.assign({ proveedor_id: p3.proveedor_id }, notas(6)), CTX_ENCARGADO);
  assert.equal(regular.evaluacion.resultado, 'REGULAR');
  assert.equal(regular.evaluacion.aprobado, true, '6.0 supera el corte de 5.0');
});

test('evaluar: promedia los SEIS criterios de PRO-04, no un subconjunto', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const p = crearProveedor(ctx);

  const r = ctx.Proveedores.evaluar({
    proveedor_id: p.proveedor_id,
    calidad: 10, plazo_entrega: 8, costos: 6,
    tiempo_respuesta: 4, precio: 2, postventa: 6
  }, CTX_ENCARGADO);

  assert.equal(r.evaluacion.promedio, 6, '(10+8+6+4+2+6)/6 = 6');
  assert.equal(r.evaluacion.calidad, 10);
  assert.equal(r.evaluacion.postventa, 6);
});

test('evaluar: exige calificar los seis criterios, en escala 1 a 10', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const p = crearProveedor(ctx);

  const incompleta = ctx.Proveedores.evaluar({ proveedor_id: p.proveedor_id, calidad: 8 }, CTX_ENCARGADO);
  assert.equal(incompleta._validationError, true);

  const fueraDeEscala = ctx.Proveedores.evaluar(
    Object.assign({ proveedor_id: p.proveedor_id }, notas(11)), CTX_ENCARGADO);
  assert.equal(fueraDeEscala._validationError, true);

  const cero = ctx.Proveedores.evaluar(
    Object.assign({ proveedor_id: p.proveedor_id }, notas(0)), CTX_ENCARGADO);
  assert.equal(cero._validationError, true, 'la escala parte en 1, no en 0');
});

// --- el proveedor unico ------------------------------------------------------

test('evaluar: reprobar a un proveedor UNICO pide reunión de mejora, no desecharlo', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const normal = crearProveedor(ctx, { rut: '1-1' });
  const unico = crearProveedor(ctx, { rut: '2-2', nombre: 'Certificadora', es_unico: true });

  const rNormal = ctx.Proveedores.evaluar(
    Object.assign({ proveedor_id: normal.proveedor_id }, notas(3)), CTX_ENCARGADO);
  const rUnico = ctx.Proveedores.evaluar(
    Object.assign({ proveedor_id: unico.proveedor_id }, notas(3)), CTX_ENCARGADO);

  assert.equal(rNormal.consecuencia, 'DESECHAR');
  assert.equal(rUnico.consecuencia, 'REUNION_MEJORA',
    'a un proveedor único no se le puede pedir que se deseche: no hay reemplazo');
  // Los dos quedan reprobados: lo que cambia es QUE HACER, no la nota.
  assert.equal(rNormal.proveedor.estado, 'REPROBADO');
  assert.equal(rUnico.proveedor.estado, 'REPROBADO');
});

test('evaluar: el aviso de reprobación dice qué corresponde hacer segun sea único o no', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const unico = crearProveedor(ctx, { nombre: 'Certificadora', es_unico: true });
  ctx.Proveedores.evaluar(Object.assign({ proveedor_id: unico.proveedor_id }, notas(2)), CTX_ENCARGADO);

  // LOG_NOTIFICACIONES solo deja la traza del envío (no el texto), así que
  // el contenido se comprueba en el correo que efectivamente salió.
  assert.equal(ctx.MailApp._enviados.length, 1, 'debe avisar al Encargado SGC');
  const enviado = ctx.MailApp._enviados[0];
  assert.equal(enviado.destinatario, 'sgc@homepymes.cl');
  assert.match(String(enviado.cuerpo), /ÚNICO/i);
  assert.match(String(enviado.cuerpo), /reunión/i);
  assert.doesNotMatch(String(enviado.cuerpo), /dejar de comprarle/i,
    'a un proveedor único no se le manda la instrucción de reemplazarlo');
});

// --- el listado maestro se mantiene solo ------------------------------------

test('evaluar: actualiza el "Resultado evaluación" y el "Estatus" del listado maestro', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const p = crearProveedor(ctx);

  ctx.Proveedores.evaluar(
    Object.assign({ proveedor_id: p.proveedor_id, fecha: '2026-03-01T00:00:00.000Z' }, notas(9)),
    CTX_ENCARGADO);

  const listado = ctx.Proveedores.listar({}, CTX_ENCARGADO);
  const fila = listado.proveedores[0];
  assert.equal(fila.estado, 'APROBADO');
  assert.equal(fila.ultima_evaluacion_promedio, 9);
  assert.equal(fila.ultima_evaluacion_resultado, 'BUENO');
  // El seguimiento es cada 12 meses (PRO-04 §6.2), calculado solo.
  assert.equal(String(fila.proxima_evaluacion).slice(0, 7), '2027-03');
});

test('evaluar dos veces: manda la ULTIMA evaluación, y el historial se conserva', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const p = crearProveedor(ctx);

  ctx.Proveedores.evaluar(
    Object.assign({ proveedor_id: p.proveedor_id, fecha: '2025-01-10T00:00:00.000Z' }, notas(9)), CTX_ENCARGADO);
  ctx.Proveedores.evaluar(
    Object.assign({ proveedor_id: p.proveedor_id, fecha: '2026-01-10T00:00:00.000Z' }, notas(4)), CTX_ENCARGADO);

  const detalle = ctx.Proveedores.getDetalle({ proveedor_id: p.proveedor_id }, CTX_ENCARGADO);
  assert.equal(detalle.evaluaciones.length, 2, 'no se pisa la evaluación anterior');
  assert.equal(detalle.evaluaciones[0].promedio, 4, 'la más reciente primero');
  assert.equal(detalle.proveedor.estado, 'REPROBADO', 'el estado sigue a la última');
});

// --- alertas ----------------------------------------------------------------

test('recordatorio: avisa por el proveedor nunca evaluado, no solo por el vencido', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearProveedor(ctx);

  const r = ctx.Proveedores.recordatorioPendientes();
  assert.equal(r.vencidos, 1, 'nunca evaluado también incumple §8.4');

  const correos = ctx.leerFilas_('LOG_NOTIFICACIONES')
    .filter((n) => String(n.evento || '').indexOf('SGC_PROVEEDOR_EVAL_VENCIDA') === 0);
  assert.equal(correos.length, 1);
  assert.match(String(correos[0].destinatario), /sgc@homepymes\.cl/);
});

test('recordatorio: un proveedor evaluado hace poco NO genera aviso', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const p = crearProveedor(ctx);
  ctx.Proveedores.evaluar(Object.assign({ proveedor_id: p.proveedor_id }, notas(8)), CTX_ENCARGADO);

  const r = ctx.Proveedores.recordatorioPendientes();
  assert.equal(r.vencidos, 0);
  assert.equal(r.reprobados, 0);
});

test('recordatorio: no se repite el mismo día', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearProveedor(ctx);

  ctx.Proveedores.recordatorioPendientes();
  ctx.Proveedores.recordatorioPendientes();

  const correos = ctx.leerFilas_('LOG_NOTIFICACIONES')
    .filter((n) => String(n.evento || '').indexOf('SGC_PROVEEDOR_EVAL_VENCIDA') === 0);
  assert.equal(correos.length, 1, 'la deduplicación por día debe evitar el segundo correo');
});

// --- permisos y baja ---------------------------------------------------------

test('listar: Gerencia puede consultar (es entrada de la revisión por la dirección) pero no gestionar', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearProveedor(ctx);

  const vista = ctx.Proveedores.listar({}, CTX_GERENCIA);
  assert.ok(!vista._forbidden, 'Gerencia debe poder ver el desempeño de proveedores');
  assert.equal(vista.puede_gestionar, false);
  assert.equal(vista.proveedores.length, 1);
});

test('listar: el personal operativo no accede al listado de proveedores', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  crearProveedor(ctx);
  assert.equal(ctx.Proveedores.listar({}, CTX_OPERATIVO)._forbidden, true);
});

test('desactivar: exige motivo y NO borra -- las evaluaciones siguen siendo evidencia', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const p = crearProveedor(ctx);
  ctx.Proveedores.evaluar(Object.assign({ proveedor_id: p.proveedor_id }, notas(8)), CTX_ENCARGADO);

  assert.equal(ctx.Proveedores.desactivar({ proveedor_id: p.proveedor_id, motivo: 'corto' }, CTX_ENCARGADO)._validationError, true);

  ctx.Proveedores.desactivar(
    { proveedor_id: p.proveedor_id, motivo: 'Dejó de operar en el país.' }, CTX_ENCARGADO);

  assert.equal(ctx.Proveedores.listar({}, CTX_ENCARGADO).proveedores.length, 0, 'sale del listado');
  assert.equal(ctx.leerFilas_('SGC_PROVEEDOR_EVALUACIONES').length, 1, 'su evaluación se conserva');
});

test('indicadores: separan aprobados, reprobados, sin evaluar y únicos reprobados', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  const a = crearProveedor(ctx, { rut: '1-1' });
  const b = crearProveedor(ctx, { rut: '2-2' });
  const u = crearProveedor(ctx, { rut: '3-3', es_unico: true });
  crearProveedor(ctx, { rut: '4-4' }); // queda sin evaluar

  ctx.Proveedores.evaluar(Object.assign({ proveedor_id: a.proveedor_id }, notas(9)), CTX_ENCARGADO);
  ctx.Proveedores.evaluar(Object.assign({ proveedor_id: b.proveedor_id }, notas(2)), CTX_ENCARGADO);
  ctx.Proveedores.evaluar(Object.assign({ proveedor_id: u.proveedor_id }, notas(2)), CTX_ENCARGADO);

  const ind = ctx.Proveedores.listar({}, CTX_ENCARGADO).indicadores;
  assert.equal(ind.total, 4);
  assert.equal(ind.aprobados, 1);
  assert.equal(ind.reprobados, 2);
  assert.equal(ind.sin_evaluar, 1);
  assert.equal(ind.unicos_reprobados, 1, 'los únicos reprobados se cuentan aparte: se gestionan distinto');
});
