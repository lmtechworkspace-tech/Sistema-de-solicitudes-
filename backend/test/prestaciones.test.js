'use strict';

// v11.0 Fase 8 — evidencia de servicios prestados (§8.1, §8.5, §8.6, §8.7).
//
// Lo que protegen estos tests, por orden de importancia:
//  1. LA ESCALA. Nada se pre-genera y el listado sin filtro no devuelve la
//     hoja entera. Es la única razón por la que esta fase es viable: con 50
//     clientes y 40 procesos, una matriz completa serían 24.000 filas al año
//     casi todas vacías.
//  2. Que el cliente NO se duplique: sale de CAT_CLIENTES, que existe desde
//     la v1.0, y no se acepta uno que no esté ahí.
//  3. Que §8.6 trace a la PERSONA que autoriza la liberación, que es lo que
//     la cláusula pide textualmente, y que se vea cuando esa persona es la
//     misma que prestó el servicio.
//  4. Que una salida no conforme no se libere, y que pueda derivar en una NC
//     por el mismo camino que ya usan las quejas.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  Object.keys(ctx.COLUMNAS).forEach((h) => {
    try { seedSheet(ctx, h, ctx.COLUMNAS[h]); } catch (e) { /* sin columnas */ }
  });
  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES, [
    ['R1', 'sgc@homepymes.cl', 'ENCARGADO_SGC', '', '', true, new Date().toISOString()],
    ['R2', 'operativo@homepymes.cl', 'OPERATIVO', 'CONTABILIDAD', '', true, new Date().toISOString()]
  ]);
  seedSheet(ctx, 'CAT_CLIENTES', ctx.COLUMNAS.CAT_CLIENTES, [
    ['CLI-1', 'Constructora Andes SpA', '76.111.111-1', 'C001', 'Ana', 'a@andes.cl', '', '', '', 'ACTIVO', '', true],
    ['CLI-2', 'Pyme Sur Ltda', '77.222.222-2', 'C002', 'Luis', 'l@sur.cl', '', '', '', 'ACTIVO', '', true]
  ]);
  return ctx;
}

const ENC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };

function conProcesos(ctx) {
  ctx.Procesos.sembrarMapa({}, ENC);
  const padre = ctx.Procesos.listar({}, ENC).mapa.filter((p) => p.codigo === 'PO-04')[0];
  const a = ctx.Procesos.guardar({
    nombre: 'Proceso Mensual de IVA', tipo: 'OPERATIVO', nivel: 'SERVICIO', proceso_padre_id: padre.proceso_id
  }, ENC);
  const b = ctx.Procesos.guardar({
    nombre: 'Declaración de Renta', tipo: 'OPERATIVO', nivel: 'SERVICIO', proceso_padre_id: padre.proceso_id
  }, ENC);
  // Cada proceso de servicio con al menos un paso: §8.5.1 a) pide
  // información documentada que defina cómo se presta, y sin eso la
  // cláusula no cierra aunque haya prestaciones (lo prueba procesos.test).
  [a, b].forEach((p, i) => {
    ctx.agregarFila_(ctx.SHEETS.SGC_PROCESO_PASOS, {
      paso_id: 'PASO-' + i, proceso_id: p.proceso_id, numero: 1, nombre: 'Recepción',
      responsable: 'Asistente', input: 'Solicitud', actividades: 'Procesar',
      evidencias: 'Formulario', output: 'Entrega', activa: true
    });
  });
  return { padre: padre, srv1: a.proceso_id, srv2: b.proceso_id };
}

function registrar(ctx, extra) {
  return ctx.Prestaciones.registrar(Object.assign({
    cliente_id: 'CLI-1', fecha_prestacion: '2026-08-05',
    responsable_email: 'asistente@homepymes.cl', evidencia: 'F29 folio 12345'
  }, extra || {}), ENC);
}

function clausula(ctx, codigo) {
  return ctx.MatrizCobertura.listar({}, ENC).clausulas.filter((c) => c.codigo === codigo)[0];
}

// --- 1. Escala ---------------------------------------------------------------

test('nada se pre-genera: la hoja arranca vacía aunque haya clientes y procesos', () => {
  const ctx = loadConSchema();
  conProcesos(ctx);

  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_PRESTACIONES).length, 0,
    '2 clientes x 2 procesos x 12 meses serían 48 filas vacías, y con los datos reales 24.000 al año');
  assert.equal(ctx.Prestaciones.listar({}, ENC).prestaciones.length, 0);
});

test('el listado sin filtro se acota y lo dice', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  for (let i = 1; i <= 120; i++) {
    registrar(ctx, {
      proceso_id: p.srv1, periodo: '2026-M' + String(i).padStart(2, '0'),
      fecha_prestacion: '2026-08-' + String((i % 28) + 1).padStart(2, '0')
    });
  }

  const sinFiltro = ctx.Prestaciones.listar({}, ENC);
  assert.equal(sinFiltro.acotada, true);
  assert.equal(sinFiltro.prestaciones.length, sinFiltro.tope);
  assert.ok(sinFiltro.total_filtrado > sinFiltro.tope,
    'el total real se informa aunque no se devuelva entero');

  const conFiltro = ctx.Prestaciones.listar({ periodo: '2026-M05' }, ENC);
  assert.equal(conFiltro.acotada, false);
  assert.equal(conFiltro.prestaciones.length, 1);
});

test('el módulo mide su propio volumen y avisa antes de que duela', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });

  const v = ctx.Prestaciones.listar({}, ENC).volumen;
  assert.equal(v.filas, 1);
  assert.equal(v.supera_umbral, false);
  assert.equal(v.aviso, '');
  assert.deepEqual(toPlain(v.por_anio), [{ anio: '2026', total: 1 }]);
});

// --- 2. El cliente no se duplica --------------------------------------------

test('el cliente sale de CAT_CLIENTES y no se acepta uno inventado', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);

  const r = registrar(ctx, { cliente_id: 'NO-EXISTE', proceso_id: p.srv1 });
  assert.equal(r.ok, false);
  assert.match(r.message, /no está en el catálogo/i);

  assert.equal(registrar(ctx, { proceso_id: p.srv1 }).ok, true);
  // El nombre queda desnormalizado, como en SOLICITUDES: el listado no puede
  // depender de un cruce por cada fila.
  assert.equal(ctx.Prestaciones.listar({}, ENC).prestaciones[0].cliente_nombre, 'Constructora Andes SpA');
});

test('el listado ofrece los clientes del catálogo, no una lista propia', () => {
  const ctx = loadConSchema();
  conProcesos(ctx);
  const d = ctx.Prestaciones.listar({}, ENC);
  assert.deepEqual(toPlain(d.clientes).map((c) => c.nombre).sort(),
    ['Constructora Andes SpA', 'Pyme Sur Ltda']);
});

// --- 3. Reglas del registro --------------------------------------------------

test('solo se registran procesos de SERVICIO, no los del mapa', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  const r = registrar(ctx, { proceso_id: p.padre.proceso_id });
  assert.equal(r.ok, false);
  assert.match(r.message, /procesos de SERVICIO/i);
});

test('un servicio recurrente no admite dos prestaciones del mismo período', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  assert.equal(registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' }).ok, true);

  const r = registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });
  assert.equal(r.ok, false);
  assert.match(r.message, /Ya hay una prestación/i);

  // Otro cliente en el mismo período sí.
  assert.equal(registrar(ctx, { cliente_id: 'CLI-2', proceso_id: p.srv1, periodo: '2026-M08' }).ok, true);
});

test('un servicio puntual se registra varias veces sin período', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  // Los DOC-10 a 13 distinguen "Mensual" de "Puntual": forzar un período a
  // un servicio puntual obligaría a inventarlo.
  assert.equal(registrar(ctx, { proceso_id: p.srv2, fecha_prestacion: '2026-08-01' }).ok, true);
  assert.equal(registrar(ctx, { proceso_id: p.srv2, fecha_prestacion: '2026-08-15' }).ok, true);
  assert.equal(ctx.Prestaciones.listar({ proceso_id: p.srv2 }, ENC).prestaciones.length, 2);
});

test('faltan datos obligatorios y lo dice cuál', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  assert.match(ctx.Prestaciones.registrar({}, ENC).message, /qué cliente/i);
  assert.match(registrar(ctx, { proceso_id: '' }).message, /qué proceso/i);
  assert.match(registrar(ctx, { proceso_id: p.srv1, fecha_prestacion: '' }).message, /fecha/i);
  assert.match(registrar(ctx, { proceso_id: p.srv1, responsable_email: '' }).message, /quién prestó/i);
});

// --- 4. Liberación (§8.6) ----------------------------------------------------

test('la liberación traza a la persona que autoriza y cuándo', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  const r = registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });

  const lib = ctx.Prestaciones.liberar({
    prestacion_id: r.prestacion_id, liberado_por: 'contador@homepymes.cl', fecha_liberacion: '2026-08-06'
  }, ENC);
  assert.equal(lib.ok, true);

  const x = ctx.Prestaciones.listar({}, ENC).prestaciones[0];
  assert.equal(x.estado, 'LIBERADO');
  assert.equal(x.liberado_por, 'contador@homepymes.cl');
  assert.equal(x.fecha_liberacion, '2026-08-06');
  assert.equal(x.liberada_por_el_mismo, false);
});

test('liberar uno mismo lo que uno prestó se permite pero se avisa y se ve', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  const r = registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });

  // No se bloquea: ningún documento lo prohíbe. Pero el DOC-01 dice que
  // libera la jefatura del área, así que la debilidad queda visible.
  const lib = ctx.Prestaciones.liberar({
    prestacion_id: r.prestacion_id, liberado_por: 'asistente@homepymes.cl'
  }, ENC);
  assert.equal(lib.ok, true);
  assert.match(lib.message, /quien liberó es quien prestó/i);

  assert.equal(ctx.Prestaciones.listar({}, ENC).prestaciones[0].liberada_por_el_mismo, true);
  assert.match(ctx.MatrizCobertura.getDetalle({ codigo: '8.6' }, ENC).nota,
    /misma persona que prestó el servicio/i);
});

test('no se libera dos veces', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  const r = registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });
  ctx.Prestaciones.liberar({ prestacion_id: r.prestacion_id, liberado_por: 'c@h.cl' }, ENC);
  assert.match(ctx.Prestaciones.liberar({ prestacion_id: r.prestacion_id, liberado_por: 'c@h.cl' }, ENC).message,
    /ya está liberada/i);
});

// --- 5. Salidas no conformes (§8.7) -----------------------------------------

test('una salida no conforme necesita motivo y deja de estar liberada', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  const r = registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });
  ctx.Prestaciones.liberar({ prestacion_id: r.prestacion_id, liberado_por: 'contador@homepymes.cl' }, ENC);

  assert.match(ctx.Prestaciones.marcarNoConforme({ prestacion_id: r.prestacion_id }, ENC).message,
    /Describe en qué no conformó/i);

  ctx.Prestaciones.marcarNoConforme({
    prestacion_id: r.prestacion_id, observaciones: 'Se declaró con un RUT equivocado.'
  }, ENC);

  const x = ctx.Prestaciones.listar({}, ENC).prestaciones[0];
  assert.equal(x.estado, 'NO_CONFORME');
  assert.equal(x.liberado_por, '', '§8.7 pide no entregar una salida no conforme hasta corregirla');
});

test('una salida no conforme no se libera', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  const r = registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });
  ctx.Prestaciones.marcarNoConforme({ prestacion_id: r.prestacion_id, observaciones: 'error' }, ENC);

  const lib = ctx.Prestaciones.liberar({ prestacion_id: r.prestacion_id, liberado_por: 'c@h.cl' }, ENC);
  assert.equal(lib.ok, false);
  assert.match(lib.message, /primero hay que tratarla/i);
});

test('la salida no conforme deriva en una NC por el camino que ya existía', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  const r = registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });

  assert.match(ctx.Prestaciones.abrirNoConformidad({ prestacion_id: r.prestacion_id }, ENC).message,
    /Primero marca la prestación/i);

  ctx.Prestaciones.marcarNoConforme({ prestacion_id: r.prestacion_id, observaciones: 'RUT equivocado' }, ENC);
  const nc = ctx.Prestaciones.abrirNoConformidad({
    prestacion_id: r.prestacion_id, responsable_email: 'contador@homepymes.cl'
  }, ENC);
  assert.equal(nc.ok, true);

  const fila = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_NC).filter((n) => n.nc_id === nc.nc_id)[0];
  assert.equal(fila.fuente, 'PROCESO', 'la fuente ya existía en el catálogo: no hizo falta inventar una');
  assert.equal(fila.origen_ref, r.prestacion_id);
  assert.equal(fila.referencia_normativa, '8.7');
  assert.match(fila.descripcion, /Salida no conforme/);

  assert.match(ctx.Prestaciones.abrirNoConformidad({ prestacion_id: r.prestacion_id }, ENC).message,
    /ya tiene su no conformidad/i);
});

// --- 6. Efecto en la matriz --------------------------------------------------

test('8.1 y 8.5 pasan de parcial a completo cuando todo tiene evidencia', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);

  assert.match(ctx.MatrizCobertura.getDetalle({ codigo: '8.5' }, ENC).nota,
    /no demuestra que se haya prestado/i);

  registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });
  // Falta el segundo proceso de servicio: la cláusula no puede cerrarse con
  // un catálogo de procesos y prestaciones en uno solo.
  assert.match(ctx.MatrizCobertura.getDetalle({ codigo: '8.5' }, ENC).nota,
    /sin ninguna prestación registrada/i);

  registrar(ctx, { proceso_id: p.srv2, fecha_prestacion: '2026-08-10' });
  assert.equal(clausula(ctx, '8.5').estado, 'COMPLETO');
  assert.equal(clausula(ctx, '8.1').estado, 'COMPLETO');
});

test('una prestación sin evidencia mantiene 8.5 en parcial', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });
  registrar(ctx, { proceso_id: p.srv2, fecha_prestacion: '2026-08-10', evidencia: '' });

  const d = ctx.MatrizCobertura.getDetalle({ codigo: '8.5' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /sin evidencia/i);
});

test('8.7 mide salidas no conformes, no las NC del sistema', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);

  // Sin prestaciones no se puede afirmar que las salidas se controlan.
  assert.match(ctx.MatrizCobertura.getDetalle({ codigo: '8.7' }, ENC).nota,
    /Sin registro de servicios|Registra las prestaciones/i);

  registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });
  const d = ctx.MatrizCobertura.getDetalle({ codigo: '8.7' }, ENC);
  assert.equal(d.estado, 'COMPLETO');
  assert.match(d.nota, /que no haya hallazgos es un resultado, no una omisión/i,
    'una ausencia de hallazgos no es lo mismo que no controlar');
});

test('una salida no conforme sin NC deja 8.7 en parcial', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  const r = registrar(ctx, { proceso_id: p.srv1, periodo: '2026-M08' });
  ctx.Prestaciones.marcarNoConforme({ prestacion_id: r.prestacion_id, observaciones: 'error' }, ENC);

  let d = ctx.MatrizCobertura.getDetalle({ codigo: '8.7' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /sin no conformidad abierta/i);

  ctx.Prestaciones.abrirNoConformidad({ prestacion_id: r.prestacion_id, responsable_email: 'c@h.cl' }, ENC);
  assert.equal(clausula(ctx, '8.7').estado, 'COMPLETO');
});

// --- 7. Permisos -------------------------------------------------------------

test('un operativo no ve ni registra prestaciones', () => {
  const ctx = loadConSchema();
  const p = conProcesos(ctx);
  assert.equal(ctx.Prestaciones.listar({}, OPERATIVO)._forbidden, true);
  assert.equal(ctx.Prestaciones.registrar({
    cliente_id: 'CLI-1', proceso_id: p.srv1, fecha_prestacion: '2026-08-05', responsable_email: 'x@h.cl'
  }, OPERATIVO)._forbidden, true);
  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_PRESTACIONES).length, 0);
});
