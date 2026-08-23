'use strict';

// v11.0 Fase 7 — el tablero del SGC.
//
// Lo que protegen estos tests:
//  1. Que el porcentaje sea EL MISMO que el de la matriz de cobertura y no
//     un segundo número. Dos cifras distintas llamadas "avance del SGC" en
//     el mismo producto es lo que hace que nadie confíe en ninguna.
//  2. Que el aviso de "indicador interno de gestión" viaje siempre. El
//     usuario pidió explícitamente que no se presente como porcentaje
//     oficial de certificación.
//  3. Que cada alerta sepa a qué sección lleva: una lista de problemas sin
//     el camino para resolverlos es una lista de reproches.
//  4. Que las alertas se disparen por FECHAS reales de cada módulo, y que
//     una cosa vencida pese más que una próxima a vencer.
//  5. Que el tablero sea de gobierno: un operativo no lo ve.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  Object.keys(ctx.COLUMNAS).forEach((h) => {
    try { seedSheet(ctx, h, ctx.COLUMNAS[h]); } catch (e) { /* hojas sin columnas */ }
  });
  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES, [
    ['R1', 'sgc@homepymes.cl', 'ENCARGADO_SGC', '', '', true, new Date().toISOString()],
    ['R2', 'operativo@homepymes.cl', 'OPERATIVO', 'CONTABILIDAD', '', true, new Date().toISOString()]
  ]);
  return ctx;
}

const ENC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };

function diasDesdeHoy(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

function alertaPorTitulo(t, re) {
  return t.alertas.filter((a) => re.test(a.titulo))[0];
}

// --- 1. Un solo número -------------------------------------------------------

test('el porcentaje del tablero ES el de la matriz de cobertura', () => {
  const ctx = loadConSchema();
  ctx.Alcance.guardar(ctx.Alcance.obtener({}, ENC).propuesta, ENC);
  ctx.Contexto.sembrarFoda({}, ENC);
  ctx.Procesos.sembrarMapa({}, ENC);

  const t = ctx.Tablero.resumen({}, ENC);
  const m = ctx.MatrizCobertura.listar({}, ENC);

  assert.equal(t.salud.pct, m.resumen.pct_listo,
    'dos cifras distintas llamadas "avance del SGC" harían que nadie confíe en ninguna');
  assert.equal(t.salud.aplicables, m.resumen.aplicables);
});

test('el aviso de que es un indicador interno viaja siempre', () => {
  const ctx = loadConSchema();
  const t = ctx.Tablero.resumen({}, ENC);
  assert.match(t.salud.aviso, /indicador interno de gestión/i);
  assert.match(t.salud.aviso, /no es un porcentaje oficial de certificación/i);
});

test('la salud se agrupa por los siete capítulos de la norma', () => {
  const ctx = loadConSchema();
  const t = ctx.Tablero.resumen({}, ENC);

  assert.deepEqual(toPlain(t.salud.capitulos).map((c) => c.numero), ['4', '5', '6', '7', '8', '9', '10']);
  // Las 28 cláusulas del catálogo tienen que repartirse entre los capítulos
  // sin que se pierda ni se duplique ninguna.
  const suma = t.salud.capitulos.reduce((acc, c) => acc + c.total, 0);
  assert.equal(suma, 28);
});

test('una cláusula excluida sale del denominador de su capítulo', () => {
  const ctx = loadConSchema();
  ctx.Alcance.guardar(ctx.Alcance.obtener({}, ENC).propuesta, ENC);
  const antes = ctx.Tablero.resumen({}, ENC).salud.capitulos.filter((c) => c.numero === '8')[0];

  ctx.Alcance.guardarExclusion({
    clausula: '8.3', titulo: 'Diseño y desarrollo', justificacion: 'No se diseñan servicios nuevos.'
  }, ENC);

  const despues = ctx.Tablero.resumen({}, ENC).salud.capitulos.filter((c) => c.numero === '8')[0];
  assert.equal(despues.no_aplica, 1);
  assert.equal(despues.aplicables, antes.aplicables - 1);
  assert.equal(despues.total, antes.total, 'sigue en el catálogo, solo sale del cálculo');
});

// --- 2. Alertas accionables --------------------------------------------------

test('un sistema vacío avisa de lo que falta, y cada alerta sabe a dónde lleva', () => {
  const ctx = loadConSchema();
  const t = ctx.Tablero.resumen({}, ENC);

  assert.ok(t.alertas.length >= 5);
  assert.ok(t.alertas.every((a) => a.seccion), 'sin sección, la alerta es un reproche sin salida');

  const alcance = alertaPorTitulo(t, /alcance del SGC no está declarado/i);
  assert.equal(alcance.severidad, 'CRITICA', 'es lo primero que pide una auditoría');
  assert.equal(alcance.seccion, 'alcance');

  assert.equal(alertaPorTitulo(t, /análisis de contexto/i).seccion, 'contexto');
  assert.equal(alertaPorTitulo(t, /matriz de riesgos/i).seccion, 'riesgos');
  assert.equal(alertaPorTitulo(t, /mapa de procesos/i).seccion, 'procesos');
});

test('las alertas salen ordenadas: primero lo crítico', () => {
  const ctx = loadConSchema();
  const t = ctx.Tablero.resumen({}, ENC);
  const orden = { CRITICA: 0, ALTA: 1, MEDIA: 2 };
  const severidades = t.alertas.map((a) => orden[a.severidad]);
  assert.deepEqual(toPlain(severidades), toPlain(severidades).slice().sort((a, b) => a - b));
});

test('una NC con un plazo pasado es crítica; una en curso, no', () => {
  const ctx = loadConSchema();
  ctx.agregarFila_(ctx.SHEETS.SGC_NC, {
    nc_id: 'NC1', correlativo: 'NC-2026-01', estado: 'EN_CURSO',
    correccion_plazo: diasDesdeHoy(-5), activa: true
  });
  ctx.agregarFila_(ctx.SHEETS.SGC_NC, {
    nc_id: 'NC2', correlativo: 'NC-2026-02', estado: 'EN_CURSO',
    correccion_plazo: diasDesdeHoy(10), activa: true
  });

  const t = ctx.Tablero.resumen({}, ENC);
  const vencidas = alertaPorTitulo(t, /No conformidades con plazo vencido/i);
  assert.equal(vencidas.total, 1);
  assert.equal(vencidas.severidad, 'CRITICA');

  const abiertas = alertaPorTitulo(t, /No conformidades abiertas/i);
  assert.equal(abiertas.total, 1, 'la vencida no se cuenta dos veces');
});

test('una NC cerrada no genera alerta aunque tenga plazos viejos', () => {
  const ctx = loadConSchema();
  ctx.agregarFila_(ctx.SHEETS.SGC_NC, {
    nc_id: 'NC1', correlativo: 'NC-2026-01', estado: 'CERRADA',
    correccion_plazo: diasDesdeHoy(-90), accion_plazo: diasDesdeHoy(-60), activa: true
  });
  const t = ctx.Tablero.resumen({}, ENC);
  assert.equal(alertaPorTitulo(t, /No conformidades/i), undefined);
});

test('un documento con la revisión vencida es crítico; uno próximo, medio', () => {
  const ctx = loadConSchema();
  ctx.Calidad.crearDocumento({ codigo: 'PRO-01', nombre: 'Viejo', tipo: 'PRO', visibilidad: 'TODOS' }, ENC);
  ctx.Calidad.crearDocumento({ codigo: 'PRO-02', nombre: 'Por vencer', tipo: 'PRO', visibilidad: 'TODOS' }, ENC);
  const docs = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_DOCUMENTOS);
  ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_DOCUMENTOS, 'documento_id', docs[0].documento_id,
    { proxima_revision: diasDesdeHoy(-1) });
  ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_DOCUMENTOS, 'documento_id', docs[1].documento_id,
    { proxima_revision: diasDesdeHoy(20) });

  const t = ctx.Tablero.resumen({}, ENC);
  assert.equal(alertaPorTitulo(t, /revisión vencida/i).severidad, 'CRITICA');
  assert.equal(alertaPorTitulo(t, /Documentos por revisar/i).severidad, 'MEDIA');
});

test('un riesgo alto sin revalorar es crítico; uno ya revalorado no aparece', () => {
  const ctx = loadConSchema();
  ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  // El DOC-08 trae todos los riesgos con revaloración, así que no hay alerta.
  assert.equal(alertaPorTitulo(ctx.Tablero.resumen({}, ENC), /sin revalorar/i), undefined);

  // Se le quita la revaloración a uno crítico.
  const r3 = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_RIESGOS).filter((r) => r.codigo === 'R3')[0];
  ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_RIESGOS, 'riesgo_id', r3.riesgo_id,
    { probabilidad_residual: '', impacto_residual: '' });

  const a = alertaPorTitulo(ctx.Tablero.resumen({}, ENC), /sin revalorar/i);
  assert.equal(a.total, 1);
  assert.equal(a.severidad, 'CRITICA');
  assert.equal(a.seccion, 'riesgos');
});

test('los procesos del mapa sin responsable se avisan con su número real', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);
  assert.equal(alertaPorTitulo(ctx.Tablero.resumen({}, ENC), /sin responsable/i).total, 14);

  ctx.leerFilasSeguro_(ctx.SHEETS.SGC_PROCESOS).slice(0, 4).forEach((p) => {
    ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_PROCESOS, 'proceso_id', p.proceso_id,
      { responsable_email: 'jefe@homepymes.cl' });
  });
  assert.equal(alertaPorTitulo(ctx.Tablero.resumen({}, ENC), /sin responsable/i).total, 10);
});

test('un proveedor nunca evaluado cuenta como vencido', () => {
  const ctx = loadConSchema();
  ctx.agregarFila_(ctx.SHEETS.SGC_PROVEEDORES, {
    proveedor_id: 'P1', nombre: 'Plataforma X', activa: true
  });
  const a = alertaPorTitulo(ctx.Tablero.resumen({}, ENC), /sin evaluación vigente/i);
  assert.equal(a.total, 1, 'es el mismo criterio que usa el módulo de proveedores desde la Fase 5a');
});

// --- 3. Hitos ----------------------------------------------------------------

test('los hitos son solo futuros y salen en orden', () => {
  const ctx = loadConSchema();
  ctx.agregarFila_(ctx.SHEETS.SGC_NC, {
    nc_id: 'NC1', correlativo: 'NC-01', estado: 'EN_CURSO',
    correccion_plazo: diasDesdeHoy(30), accion_plazo: diasDesdeHoy(10),
    eficacia_plazo: diasDesdeHoy(-5), activa: true
  });

  const t = ctx.Tablero.resumen({}, ENC);
  const fechas = t.hitos.map((h) => h.fecha);
  assert.deepEqual(toPlain(fechas), toPlain(fechas).slice().sort(),
    'un timeline desordenado no sirve para planificar');
  assert.ok(fechas.every((f) => f >= t.fecha), 'lo vencido va en alertas, no en próximos hitos');
  assert.equal(fechas.length, 2);
});

// --- 4. Permisos y conteos ---------------------------------------------------

test('el tablero es de gobierno: un operativo no lo ve', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Tablero.resumen({}, OPERATIVO)._forbidden, true);
  assert.equal(ctx.Tablero.resumen({}, ENC)._forbidden, undefined);
});

test('el tablero trae el mapa de secciones para pintar la barra', () => {
  const ctx = loadConSchema();
  const t = ctx.Tablero.resumen({}, ENC);
  // Es la primera pantalla del módulo: si no trajera el mapa, la barra se
  // pintaría sin saber qué puede abrir cada quien.
  assert.ok(t.secciones_visibles);
  assert.equal(t.secciones_visibles.tablero, true);
  assert.equal(t.secciones_visibles.documentos, true);
});

test('los conteos reflejan lo que hay cargado', () => {
  const ctx = loadConSchema();
  ctx.Procesos.sembrarMapa({}, ENC);
  ctx.Riesgos.sembrarDesdeDoc08({}, ENC);
  ctx.Calidad.sembrarDocumentosExternos({}, ENC);

  const c = ctx.Tablero.resumen({}, ENC).conteos;
  assert.equal(c.procesos_mapa, 14);
  assert.equal(c.riesgos, 11, 'las oportunidades no se cuentan como riesgos');
  assert.equal(c.riesgos_altos, 6);
  assert.equal(c.documentos_externos, 6);
  assert.equal(c.documentos_vigentes, 6);
});

test('la portada muestra el alcance declarado cuando existe', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Tablero.resumen({}, ENC).alcance, null);

  ctx.Alcance.guardar(ctx.Alcance.obtener({}, ENC).propuesta, ENC);
  const a = ctx.Tablero.resumen({}, ENC).alcance;
  assert.match(a.razon_social, /Asesorías Integrales AyS SpA/);
  assert.equal(a.norma, 'ISO 9001:2015');
  assert.equal(a.version, '01');
});
