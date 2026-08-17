'use strict';

// v10.0 Fase 6a — objetivos de calidad (DOC-07, §6.2 y §9.1.1 de la norma).
//
// Lo que protegen estos tests, por orden de importancia para el auditor:
//  1. Que los seis objetivos sembrados sean EXACTAMENTE los de DOC-07, con
//     su meta y su frecuencia. Es el documento aprobado: si el sistema
//     inventa una meta, el tablero deja de ser evidencia.
//  2. Que "cumple" salga de comparar contra la meta y no de una opinion, y
//     que respete el operador (el objetivo 2 se cumple midiendo MENOS, no
//     mas -- invertirlo daria por bueno justo lo contrario).
//  3. Que el veredicto quede CONGELADO en la lectura: cambiar la meta el
//     año siguiente no puede reescribir si 2026 cumplio o no.
//  4. Que las claves de periodo respeten la frecuencia del objetivo (uno
//     semestral no acepta una lectura mensual).
//  5. Que el objetivo 4 se calcule solo desde las capacitaciones reales, y
//     que el 2 declare que le falta el denominador en vez de inventarlo.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  seedSheet(ctx, 'SGC_OBJETIVOS', ctx.COLUMNAS.SGC_OBJETIVOS);
  seedSheet(ctx, 'SGC_INDICADOR_LECTURAS', ctx.COLUMNAS.SGC_INDICADOR_LECTURAS);
  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES);
  seedSheet(ctx, 'SGC_QUEJAS', ctx.COLUMNAS.SGC_QUEJAS);
  seedSheet(ctx, 'SGC_PERSONAS', ctx.COLUMNAS.SGC_PERSONAS);
  seedSheet(ctx, 'SGC_CAPACITACIONES', ctx.COLUMNAS.SGC_CAPACITACIONES);
  seedSheet(ctx, 'SGC_CAPACITACION_ASISTENTES', ctx.COLUMNAS.SGC_CAPACITACION_ASISTENTES);
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

// El año pasado: todos sus periodos estan cerrados, asi que se puede medir
// cualquiera sin depender de en que mes se corran los tests.
const ANIO = new Date().getFullYear() - 1;

function sembrarRoles(ctx) {
  ctx.Calidad.gestionarRol({ usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  ctx.Calidad.gestionarRol({ usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ADM);
}

function abrirAnio(ctx, anio) {
  return ctx.Objetivos.sembrarAnio({ anio: anio || ANIO }, CTX_ENCARGADO);
}

function objetivoNumero(ctx, numero, anio) {
  const r = ctx.Objetivos.listar({ anio: anio || ANIO }, CTX_ENCARGADO);
  return toPlain(r).objetivos.filter(function (o) { return o.numero === numero; })[0];
}

// --- la semilla es DOC-07, no una invencion ---------------------------------

test('v10.0 F6a: abrir el año siembra los 6 objetivos de DOC-07 con su meta y frecuencia', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  const r = toPlain(abrirAnio(ctx));
  assert.equal(r.ok, true);
  assert.equal(r.creados, 6);
  assert.equal(r.origen, 'DOC-07');

  const tablero = toPlain(ctx.Objetivos.listar({ anio: ANIO }, CTX_ENCARGADO));
  assert.equal(tablero.objetivos.length, 6);

  // Los seis, con la meta literal del documento aprobado.
  const porNumero = {};
  tablero.objetivos.forEach(function (o) { porNumero[o.numero] = o; });

  assert.equal(porNumero[1].objetivo_general, 'Satisfacción del cliente');
  assert.equal(porNumero[1].meta_valor, 90);
  assert.equal(porNumero[1].frecuencia, 'ANUAL');

  assert.equal(porNumero[2].objetivo_general, 'Gestión de reclamos');
  assert.equal(porNumero[2].meta_operador, 'MENOR'); // "< 2%"
  assert.equal(porNumero[2].meta_valor, 2);

  assert.equal(porNumero[3].meta_valor, 90);
  assert.equal(porNumero[4].objetivo_general, 'Desarrollo y competencia del personal');
  assert.equal(porNumero[4].meta_valor, 5);
  assert.equal(porNumero[4].unidad, 'HORAS');
  assert.equal(porNumero[5].meta_valor, 15);
  assert.equal(porNumero[6].meta_valor, 70);
});

test('v10.0 F6a: solo el objetivo 4 se calcula solo; el 2 es asistido y el resto manual', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);

  const tablero = toPlain(ctx.Objetivos.listar({ anio: ANIO }, CTX_ENCARGADO));
  const fuentes = {};
  tablero.objetivos.forEach(function (o) { fuentes[o.numero] = o.fuente; });

  assert.equal(fuentes[4], 'AUTO');
  assert.equal(fuentes[2], 'ASISTIDA');
  [1, 3, 5, 6].forEach(function (n) {
    assert.equal(fuentes[n], 'MANUAL', 'el objetivo ' + n + ' no tiene fuente automatica todavia');
  });
});

test('v10.0 F6a: no se puede abrir dos veces el mismo año', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);

  const r = toPlain(abrirAnio(ctx));
  assert.ok(r._validationError || r.campo, 'deberia rechazar el año duplicado');
});

test('v10.0 F6a: abrir el año siguiente copia del anterior, conservando los ajustes hechos', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);

  // La empresa sube la meta del objetivo 6 de 70 a 80.
  const obj6 = objetivoNumero(ctx, 6);
  ctx.Objetivos.guardar({
    objetivo_id: obj6.objetivo_id,
    objetivo_general: obj6.objetivo_general,
    objetivo_especifico: obj6.objetivo_especifico,
    indicador: obj6.indicador,
    meta_texto: '≥ 80% de clientes activos retenidos anualmente',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 80, unidad: 'PORCENTAJE',
    acciones: obj6.acciones, frecuencia: obj6.frecuencia,
    responsable_texto: obj6.responsable_texto
  }, CTX_ENCARGADO);

  const r = toPlain(abrirAnio(ctx, ANIO + 1));
  assert.equal(r.origen, 'AÑO_ANTERIOR');

  // El año nuevo hereda la meta ajustada, no la semilla original.
  const nuevo6 = objetivoNumero(ctx, 6, ANIO + 1);
  assert.equal(nuevo6.meta_valor, 80);
  // Y el año viejo conserva la suya (aunque aca ya quedo en 80 porque se
  // edito ese mismo registro; lo que importa es que son filas distintas).
  assert.notEqual(nuevo6.objetivo_id, objetivoNumero(ctx, 6, ANIO).objetivo_id);
});

// --- el veredicto sale de la meta, no de una opinion -------------------------

test('v10.0 F6a: "cumple" respeta el operador -- el objetivo 2 se cumple midiendo MENOS', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);
  const obj2 = objetivoNumero(ctx, 2); // meta: < 2%

  // 1,5% esta bajo el 2%: cumple.
  const bueno = toPlain(ctx.Objetivos.registrarLectura({
    objetivo_id: obj2.objetivo_id, periodo: ANIO + '-M01',
    valor: 1.5, numerador: 3, denominador: 200
  }, CTX_ENCARGADO));
  assert.equal(bueno.cumple, true);

  // 2,0% exacto NO cumple: la meta dice "menor que 2", no "menor o igual".
  const borde = toPlain(ctx.Objetivos.registrarLectura({
    objetivo_id: obj2.objetivo_id, periodo: ANIO + '-M02',
    valor: 2, numerador: 4, denominador: 200
  }, CTX_ENCARGADO));
  assert.equal(borde.cumple, false, 'un 2,0% exacto no cumple una meta de "< 2%"');
});

test('v10.0 F6a: el borde de una meta ">=" si cumple con el valor exacto', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);
  const obj3 = objetivoNumero(ctx, 3); // meta: >= 90%

  const r = toPlain(ctx.Objetivos.registrarLectura({
    objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 90
  }, CTX_ENCARGADO));
  assert.equal(r.cumple, true, '90 exacto cumple una meta de ">= 90"');
});

test('v10.0 F6a: cambiar la meta despues NO reescribe el veredicto ya registrado', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);
  const obj3 = objetivoNumero(ctx, 3); // >= 90

  // Se mide 85%: no cumple.
  ctx.Objetivos.registrarLectura({
    objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 85
  }, CTX_ENCARGADO);

  // Alguien baja la meta a 80 mas adelante.
  ctx.Objetivos.guardar({
    objetivo_id: obj3.objetivo_id,
    objetivo_general: obj3.objetivo_general, objetivo_especifico: obj3.objetivo_especifico,
    indicador: obj3.indicador, meta_texto: '≥ 80%',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 80, unidad: 'PORCENTAJE',
    acciones: obj3.acciones, frecuencia: obj3.frecuencia,
    responsable_texto: obj3.responsable_texto
  }, CTX_ENCARGADO);

  const detalle = toPlain(ctx.Objetivos.getDetalle({ objetivo_id: obj3.objetivo_id }, CTX_ENCARGADO));
  const lectura = detalle.lecturas.filter(function (l) { return l.periodo === ANIO + '-M01'; })[0];
  assert.equal(lectura.cumple, false,
    'la lectura conserva el veredicto que se evaluo en su momento, no el de la meta nueva');
});

// --- periodos ----------------------------------------------------------------

test('v10.0 F6a: un objetivo semestral no acepta una clave de periodo mensual', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);
  const obj5 = objetivoNumero(ctx, 5); // SEMESTRAL

  const malo = toPlain(ctx.Objetivos.registrarLectura({
    objetivo_id: obj5.objetivo_id, periodo: ANIO + '-M03', valor: 20
  }, CTX_ENCARGADO));
  assert.ok(malo._validationError || malo.campo, 'un semestral no puede recibir una lectura mensual');

  const bueno = toPlain(ctx.Objetivos.registrarLectura({
    objetivo_id: obj5.objetivo_id, periodo: ANIO + '-S1', valor: 20
  }, CTX_ENCARGADO));
  assert.equal(bueno.ok, true);
});

test('v10.0 F6a: volver a medir el mismo periodo reemplaza la lectura, no la duplica', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);
  const obj3 = objetivoNumero(ctx, 3);

  ctx.Objetivos.registrarLectura({ objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 70 }, CTX_ENCARGADO);
  const segunda = toPlain(ctx.Objetivos.registrarLectura({
    objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 95
  }, CTX_ENCARGADO));
  assert.equal(segunda.reemplazo, true);

  const detalle = toPlain(ctx.Objetivos.getDetalle({ objetivo_id: obj3.objetivo_id }, CTX_ENCARGADO));
  const deEnero = detalle.lecturas.filter(function (l) { return l.periodo === ANIO + '-M01'; });
  assert.equal(deEnero.length, 1, 'queda una sola lectura vigente por periodo');
  assert.equal(deEnero[0].valor, 95);
});

test('v10.0 F6a: un porcentaje fuera de 0-100 se rechaza', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);
  const obj3 = objetivoNumero(ctx, 3);

  const r = toPlain(ctx.Objetivos.registrarLectura({
    objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 140
  }, CTX_ENCARGADO));
  assert.ok(r._validationError || r.campo);
});

// --- calculos automaticos ----------------------------------------------------

test('v10.0 F6a: el objetivo 4 se calcula solo desde las capacitaciones reales', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);

  // Dos personas vigentes; un curso de 8 h al que asiste solo una.
  ctx.agregarFila_(ctx.SHEETS.SGC_PERSONAS, {
    persona_id: 'P1', nombre: 'Ana', estado: 'VIGENTE', activa: true
  });
  ctx.agregarFila_(ctx.SHEETS.SGC_PERSONAS, {
    persona_id: 'P2', nombre: 'Bruno', estado: 'VIGENTE', activa: true
  });
  ctx.agregarFila_(ctx.SHEETS.SGC_CAPACITACIONES, {
    capacitacion_id: 'C1', nombre: 'ISO 9001', horas: 8, estado: 'REALIZADA',
    fecha_realizada: ANIO + '-05-10T12:00:00.000Z', activa: true
  });
  ctx.agregarFila_(ctx.SHEETS.SGC_CAPACITACION_ASISTENTES, {
    capacitacion_id: 'C1', persona_id: 'P1', asistio: true
  });

  const obj4 = objetivoNumero(ctx, 4);
  const sugerencia = toPlain(ctx.Objetivos.sugerirLectura({
    objetivo_id: obj4.objetivo_id, periodo: ANIO + '-S1'
  }, CTX_ENCARGADO));

  assert.equal(sugerencia.fuente, 'AUTO');
  assert.equal(sugerencia.completo, true);
  // 8 h entre 2 personas = 4 h promedio, bajo la meta de 5.
  assert.equal(sugerencia.valor, 4);
  assert.equal(sugerencia.numerador, 8);
  assert.equal(sugerencia.denominador, 2);
  // Y dice QUIEN quedo bajo la meta -- Bruno, que no asistio a nada.
  // Ana asistio (8 h, sobre la meta de 5); Bruno no fue a nada. El promedio
  // queda bajo meta, pero el desglose apunta a quien realmente falta.
  const bajoMeta = sugerencia.detalle.bajo_meta.map(function (p) { return p.nombre; });
  assert.deepEqual(bajoMeta, ['Bruno']);
});

test('v10.0 F6a: el objetivo 2 aporta el numerador pero declara que le falta el denominador', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);

  // Dos reclamos en enero, mas una felicitacion que NO debe contar.
  ctx.agregarFila_(ctx.SHEETS.SGC_QUEJAS, {
    queja_id: 'Q1', tipo: 'QUEJA', fecha_envio: ANIO + '-01-10T12:00:00.000Z', activa: true
  });
  ctx.agregarFila_(ctx.SHEETS.SGC_QUEJAS, {
    queja_id: 'Q2', tipo: 'RECLAMACION', fecha_envio: ANIO + '-01-20T12:00:00.000Z', activa: true
  });
  ctx.agregarFila_(ctx.SHEETS.SGC_QUEJAS, {
    queja_id: 'Q3', tipo: 'FELICITACION', fecha_envio: ANIO + '-01-21T12:00:00.000Z', activa: true
  });
  // Y una queja de otro mes, que tampoco entra en el periodo.
  ctx.agregarFila_(ctx.SHEETS.SGC_QUEJAS, {
    queja_id: 'Q4', tipo: 'QUEJA', fecha_envio: ANIO + '-02-05T12:00:00.000Z', activa: true
  });

  const obj2 = objetivoNumero(ctx, 2);
  const sugerencia = toPlain(ctx.Objetivos.sugerirLectura({
    objetivo_id: obj2.objetivo_id, periodo: ANIO + '-M01'
  }, CTX_ENCARGADO));

  assert.equal(sugerencia.fuente, 'ASISTIDA');
  assert.equal(sugerencia.numerador, 2, 'solo QUEJA y RECLAMACION de enero');
  assert.equal(sugerencia.completo, false, 'falta el total de servicios prestados');
  assert.equal(sugerencia.valor, null, 'no inventa el porcentaje sin denominador');
});

test('v10.0 F6a: un objetivo manual dice explicitamente que no hay fuente automatica', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);
  const obj1 = objetivoNumero(ctx, 1);

  const sugerencia = toPlain(ctx.Objetivos.sugerirLectura({
    objetivo_id: obj1.objetivo_id, periodo: String(ANIO)
  }, CTX_ENCARGADO));
  assert.equal(sugerencia.fuente, 'MANUAL');
  assert.equal(sugerencia.valor, null);
});

// --- permisos ----------------------------------------------------------------

test('v10.0 F6a: Gerencia ve el tablero pero no puede medir ni abrir el año', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);

  const tablero = toPlain(ctx.Objetivos.listar({ anio: ANIO }, CTX_GERENCIA));
  assert.equal(tablero.objetivos.length, 6, 'Gerencia si ve el tablero (§9.3.2 e)');
  assert.equal(tablero.puede_gestionar, false);

  const obj3 = objetivoNumero(ctx, 3);
  const intento = toPlain(ctx.Objetivos.registrarLectura({
    objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 95
  }, CTX_GERENCIA));
  assert.equal(intento._forbidden, true);

  const abrir = toPlain(ctx.Objetivos.sembrarAnio({ anio: ANIO + 5 }, CTX_GERENCIA));
  assert.equal(abrir._forbidden, true);
});

test('v10.0 F6a: el personal operativo no accede al tablero', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);

  const r = toPlain(ctx.Objetivos.listar({ anio: ANIO }, CTX_OPERATIVO));
  assert.equal(r._forbidden, true);
});

// --- avisos ------------------------------------------------------------------

test('v10.0 F6a: medir bajo la meta avisa al encargado en el momento', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);
  const obj3 = objetivoNumero(ctx, 3);

  ctx.Objetivos.registrarLectura({
    objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 40
  }, CTX_ENCARGADO);

  const correos = ctx.MailApp._enviados;
  const aviso = correos.filter(function (c) {
    return /Objetivo de calidad sin cumplir/.test(c.asunto);
  });
  assert.equal(aviso.length >= 1, true, 'tiene que avisar al no alcanzar la meta');
  assert.match(aviso[0].cuerpo, /Cumplimiento de plazos de entrega/);
});

test('v10.0 F6a: cumplir la meta no genera aviso', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);
  const obj3 = objetivoNumero(ctx, 3);

  ctx.Objetivos.registrarLectura({
    objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 99
  }, CTX_ENCARGADO);

  const aviso = ctx.MailApp._enviados.filter(function (c) {
    return /Objetivo de calidad sin cumplir/.test(c.asunto);
  });
  assert.equal(aviso.length, 0);
});

test('v10.0 F6a: el trigger avisa por periodos ya cerrados que nadie midio', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  // El año EN CURSO: sus periodos ya cerrados son los que corresponde medir.
  const anioActual = new Date().getFullYear();
  abrirAnio(ctx, anioActual);

  const r = ctx.Objetivos.alertarLecturasPendientes();
  const enviados = ctx.MailApp._enviados.filter(function (c) {
    return /lectura[s]? pendiente/.test(c.asunto);
  });
  // En enero puede no haber ningun periodo cerrado todavia; en ese caso no
  // hay nada que avisar y la funcion devuelve vacio. Las dos ramas son
  // correctas, asi que se afirma la coherencia entre ambas.
  if (toPlain(r).length) {
    assert.equal(enviados.length >= 1, true);
  } else {
    assert.equal(enviados.length, 0);
  }
});

// --- enganche con la revision por la direccion (Fase 5b) ---------------------

test('v10.0 F6a: el item 8 del acta de revision deja de estar pendiente y se prellena', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);
  const obj3 = objetivoNumero(ctx, 3);
  ctx.Objetivos.registrarLectura({
    objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 95
  }, CTX_ENCARGADO);

  // Ya no queda declarado como pendiente de una fase futura.
  const entrada8 = toPlain(ctx.ENTRADAS_REVISION).filter(function (e) { return e.numero === 8; })[0];
  assert.equal(entrada8.auto, true);
  assert.equal(entrada8.pendiente_fase, undefined);

  const texto = ctx.Objetivos.resumenParaRevision(ANIO);
  assert.match(texto, /6 objetivos de calidad/);
  assert.match(texto, /1 tienen medición registrada|1 alcanzan/);
});

test('v10.0 F6a: sin objetivos cargados, el item 8 lo dice en vez de quedar vacio', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);

  const texto = ctx.Objetivos.resumenParaRevision(ANIO);
  assert.match(texto, /No hay objetivos de calidad cargados/);
});

// --- indicadores del tablero -------------------------------------------------

test('v10.0 F6a: el tablero separa "no cumple" de "nadie lo midio"', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);

  const obj3 = objetivoNumero(ctx, 3);
  const obj5 = objetivoNumero(ctx, 5);
  ctx.Objetivos.registrarLectura({ objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 95 }, CTX_ENCARGADO);
  ctx.Objetivos.registrarLectura({ objetivo_id: obj5.objetivo_id, periodo: ANIO + '-S1', valor: 3 }, CTX_ENCARGADO);

  const t = toPlain(ctx.Objetivos.listar({ anio: ANIO }, CTX_ENCARGADO));
  assert.equal(t.indicadores.total, 6);
  assert.equal(t.indicadores.cumplen, 1);   // el 3
  assert.equal(t.indicadores.no_cumplen, 1); // el 5 (3% contra meta de 15%)
  assert.equal(t.indicadores.sin_medir, 4);
});

test('v10.0 F6a: anular una lectura exige motivo y la saca del tablero', () => {
  const ctx = loadConSchema();
  sembrarRoles(ctx);
  abrirAnio(ctx);
  const obj3 = objetivoNumero(ctx, 3);
  const r = toPlain(ctx.Objetivos.registrarLectura({
    objetivo_id: obj3.objetivo_id, periodo: ANIO + '-M01', valor: 95
  }, CTX_ENCARGADO));

  const sinMotivo = toPlain(ctx.Objetivos.anularLectura({ lectura_id: r.lectura_id }, CTX_ENCARGADO));
  assert.ok(sinMotivo._validationError || sinMotivo.campo);

  ctx.Objetivos.anularLectura({ lectura_id: r.lectura_id, motivo: 'Se cargó el dato equivocado' }, CTX_ENCARGADO);
  const detalle = toPlain(ctx.Objetivos.getDetalle({ objetivo_id: obj3.objetivo_id }, CTX_ENCARGADO));
  assert.equal(detalle.lecturas.length, 0);
});
