'use strict';

// v11.0 Fase 2 — contexto de la organizacion (§4.1) y partes interesadas (§4.2).
//
// Lo que protegen estos tests, por orden de importancia para el auditor:
//  1. Que los 24 factores sembrados sean EXACTAMENTE los del DOC-02 y las 4
//     partes las del DOC-04. Es material aprobado: si el sistema inventa un
//     factor, el analisis deja de ser evidencia del documento.
//  2. Que §4.1 y §4.2 NO se den por cumplidas solo por tener datos. La norma
//     pide seguimiento y revision: un FODA completo sin revisar en dos años
//     no cumple, y darlo por completo mentiria en la pantalla que el
//     Encargado usa para prepararse la auditoria.
//  3. Que la vigencia se mida por la fecha MAS ANTIGUA. Con la mas reciente,
//     revisar una sola parte interesada daria por revisado todo lo demas.
//  4. Que nada se siembre solo, igual que en la Fase 1.
//  5. Que "lo revisamos y sigue igual" se pueda registrar. Sin eso, la unica
//     forma de dejar constancia seria modificar un factor sin necesidad.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  [
    'SGC_CONTEXTO', 'SGC_PARTES_INTERESADAS', 'SGC_ALCANCE', 'SGC_EXCLUSIONES',
    'SGC_ROLES', 'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES', 'SGC_DOC_DESTINATARIOS',
    'SGC_DOC_ACUSES', 'SGC_PERSONAS', 'SGC_DESCRIPTORES', 'SGC_PERSONA_DOCUMENTOS',
    'SGC_INDUCCIONES', 'SGC_EVALUACIONES', 'SGC_CAPACITACIONES',
    'SGC_CAPACITACION_ASISTENTES', 'SGC_NC', 'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS',
    'SGC_QUEJAS', 'SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES', 'SGC_REVISIONES',
    'SGC_REVISION_ACUERDOS', 'SGC_OBJETIVOS', 'SGC_INDICADOR_LECTURAS',
    'NOVEDADES', 'LOG_SISTEMA', 'USUARIOS', 'CUENTAS_PORTAL'
  ].forEach((hoja) => seedSheet(ctx, hoja, ctx.COLUMNAS[hoja]));

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

function envejecerContexto(ctx, fecha) {
  ctx.leerFilasSeguro_(ctx.SHEETS.SGC_CONTEXTO).forEach((f) => {
    ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_CONTEXTO, 'factor_id', f.factor_id,
      { fecha_ultima_revision: fecha });
  });
}

// --- 1. Nada se siembra solo -------------------------------------------------

test('sin contexto cargado se OFRECEN las propuestas, pero la planilla sigue vacía', () => {
  const ctx = loadConSchema();
  const r = ctx.Contexto.obtener({}, ENC);

  assert.equal(r.factores.length, 0);
  assert.equal(r.partes.length, 0);
  assert.equal(r.propuesta_foda.length, 24, 'el DOC-02 trae 24 factores');
  assert.equal(r.propuesta_partes.length, 4, 'el DOC-04 v02 trae 4 partes');
  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_CONTEXTO).length, 0);
  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_PARTES_INTERESADAS).length, 0);
});

test('el FODA sembrado tiene los cuatro cuadrantes del DOC-02, con sus cantidades', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Contexto.sembrarFoda({}, ENC).total, 24);

  const r = ctx.Contexto.obtener({}, ENC);
  assert.deepEqual(toPlain(r.resumen.por_tipo), {
    FORTALEZA: 7, OPORTUNIDAD: 6, DEBILIDAD: 7, AMENAZA: 4
  }, 'son las cantidades exactas del documento aprobado');

  // El origen se deriva del tipo, que es la definicion del analisis FODA.
  const internos = r.factores.filter((f) => f.origen === 'INTERNO');
  assert.equal(internos.length, 14, 'fortalezas y debilidades son internas');
  assert.ok(r.factores.every((f) =>
    (f.tipo === 'FORTALEZA' || f.tipo === 'DEBILIDAD') === (f.origen === 'INTERNO')));
});

test('los factores se pueden citar por código corto', () => {
  const ctx = loadConSchema();
  ctx.Contexto.sembrarFoda({}, ENC);
  const r = ctx.Contexto.obtener({}, ENC);

  const d3 = r.factores.filter((f) => f.codigo === 'D3')[0];
  assert.ok(d3, 'debe existir D3');
  assert.match(d3.descripcion, /contratos formales/i,
    'D3 es la debilidad que la matriz de riesgos del DOC-08 recoge como riesgo crítico');
});

test('no se siembra dos veces', () => {
  const ctx = loadConSchema();
  ctx.Contexto.sembrarFoda({}, ENC);
  assert.match(ctx.Contexto.sembrarFoda({}, ENC).message, /ya está cargado/i);
  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_CONTEXTO).length, 24);
});

test('solo el Encargado del SGC edita el contexto, pero cualquiera lo lee', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Contexto.sembrarFoda({}, OPERATIVO)._forbidden, true);
  assert.equal(ctx.Contexto.sembrarPartes({}, OPERATIVO)._forbidden, true);
  assert.equal(ctx.leerFilasSeguro_(ctx.SHEETS.SGC_CONTEXTO).length, 0);

  // Conocer el contexto es toma de conciencia (§7.3), no informacion reservada.
  assert.equal(ctx.Contexto.obtener({}, OPERATIVO).puede_gestionar, false);
  assert.ok(Array.isArray(ctx.Contexto.obtener({}, OPERATIVO).factores));
});

// --- 2. Partes interesadas ---------------------------------------------------

test('las partes sembradas son las del DOC-04, con sus seis columnas reales', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Contexto.sembrarPartes({}, ENC).total, 4);

  const partes = ctx.Contexto.obtener({}, ENC).partes;
  assert.deepEqual(
    toPlain(partes).map((p) => p.nombre),
    ['Clientes (Pymes y Contratistas)', 'Alta Dirección', 'Colaboradores Internos', 'Proveedores (Plataformas)']
  );
  assert.ok(partes.every((p) => p.necesidades && p.expectativa && p.efecto_sgc && p.impacto && p.influencia));
});

test('los campos de seguimiento van vacíos: el DOC-04 no los trae', () => {
  const ctx = loadConSchema();
  ctx.Contexto.sembrarPartes({}, ENC);
  const partes = ctx.Contexto.obtener({}, ENC).partes;

  assert.ok(partes.every((p) => p.metodo_seguimiento === ''),
    'un campo vacío es honesto; uno inventado sería un hallazgo de auditoría');
  assert.ok(partes.every((p) => p.frecuencia_seguimiento === ''));
  assert.ok(partes.every((p) => p.responsable_email === ''));
});

test('una parte interesada sin necesidades no se guarda', () => {
  const ctx = loadConSchema();
  const r = ctx.Contexto.guardarParte({ nombre: 'Municipalidad', impacto: 'Alto', influencia: 'Bajo' }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /necesidades o requisitos/i);
});

test('el impacto y la influencia solo aceptan Alto, Medio o Bajo', () => {
  const ctx = loadConSchema();
  assert.match(
    ctx.Contexto.guardarParte({ nombre: 'X', necesidades: 'y', impacto: 'Altísimo', influencia: 'Alto' }, ENC).message,
    /Alto, Medio o Bajo/
  );
  // Pero no se exige respetar mayúsculas al escribirlo.
  const ok = ctx.Contexto.guardarParte({ nombre: 'X', necesidades: 'y', impacto: 'alto', influencia: 'MEDIO' }, ENC);
  assert.equal(ok.ok, true);
  assert.equal(ctx.Contexto.obtener({}, ENC).partes[0].impacto, 'Alto', 'se normaliza al guardar');
});

// --- 3. Numeración y edición -------------------------------------------------

test('un factor nuevo sigue la numeración de su cuadrante, no la global', () => {
  const ctx = loadConSchema();
  ctx.Contexto.sembrarFoda({}, ENC);

  const r = ctx.Contexto.guardarFactor({ tipo: 'DEBILIDAD', descripcion: 'Factor nuevo.' }, ENC);
  const creado = ctx.Contexto.obtener({}, ENC).factores.filter((f) => f.factor_id === r.factor_id)[0];
  assert.equal(creado.codigo, 'D8', 'el DOC-02 traía 7 debilidades');

  const r2 = ctx.Contexto.guardarFactor({ tipo: 'AMENAZA', descripcion: 'Otro factor.' }, ENC);
  const creado2 = ctx.Contexto.obtener({}, ENC).factores.filter((f) => f.factor_id === r2.factor_id)[0];
  assert.equal(creado2.codigo, 'A5', 'y 4 amenazas');
});

test('un factor superado se conserva y deja de contar', () => {
  const ctx = loadConSchema();
  ctx.Contexto.sembrarFoda({}, ENC);
  const d1 = ctx.Contexto.obtener({}, ENC).factores.filter((f) => f.codigo === 'D1')[0];

  ctx.Contexto.guardarFactor({
    factor_id: d1.factor_id, tipo: 'DEBILIDAD',
    descripcion: d1.descripcion, estado: 'SUPERADO'
  }, ENC);

  const r = ctx.Contexto.obtener({}, ENC);
  assert.equal(r.resumen.por_tipo.DEBILIDAD, 6, 'deja de contar entre las vigentes');
  assert.equal(r.resumen.superados, 1);
  assert.equal(r.factores.length, 24, 'pero sigue en la lista: el histórico es evidencia');
});

test('el tipo tiene que ser uno de los cuatro cuadrantes', () => {
  const ctx = loadConSchema();
  assert.match(ctx.Contexto.guardarFactor({ tipo: 'RIESGO', descripcion: 'x' }, ENC).message,
    /fortaleza, oportunidad, debilidad o amenaza/i);
});

// --- 4. Seguimiento y revisión: el corazón de §4.1 y §4.2 --------------------

test('4.1 y 4.2 pasan de faltante a completo al cargar el contexto', () => {
  const ctx = loadConSchema();
  assert.equal(clausula(ctx, '4.1').estado, 'FALTANTE');
  assert.equal(clausula(ctx, '4.2').estado, 'FALTANTE');

  ctx.Contexto.sembrarFoda({}, ENC);
  ctx.Contexto.sembrarPartes({}, ENC);

  assert.equal(clausula(ctx, '4.1').estado, 'COMPLETO');
  assert.equal(clausula(ctx, '4.2').estado, 'COMPLETO');
});

test('un contexto sin revisar degrada 4.1 aunque esté completo', () => {
  const ctx = loadConSchema();
  ctx.Contexto.sembrarFoda({}, ENC);
  ctx.Contexto.sembrarPartes({}, ENC);
  assert.equal(clausula(ctx, '4.1').estado, 'COMPLETO');

  envejecerContexto(ctx, '2024-01-15');

  const d = ctx.MatrizCobertura.getDetalle({ codigo: '4.1' }, ENC);
  assert.equal(d.estado, 'PARCIAL', 'tener los datos no es cumplir: la norma pide seguimiento');
  assert.match(d.nota, /última revisión tiene \d+ meses/i);
});

test('la vigencia se mide por la fecha MÁS ANTIGUA, no la más reciente', () => {
  const ctx = loadConSchema();
  ctx.Contexto.sembrarFoda({}, ENC);
  ctx.Contexto.sembrarPartes({}, ENC);
  envejecerContexto(ctx, '2024-01-15');

  // Se revisa UNA sola parte interesada, hoy.
  const parte = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_PARTES_INTERESADAS)[0];
  ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_PARTES_INTERESADAS, 'parte_id', parte.parte_id,
    { fecha_ultima_revision: new Date().toISOString().slice(0, 10) });

  assert.equal(ctx.Contexto.obtener({}, ENC).resumen.revision_vencida, true,
    'revisar una fila no puede dar por revisado todo lo demás');
  assert.equal(clausula(ctx, '4.1').estado, 'PARCIAL');
});

test('registrar la revisión deja constancia sin tener que cambiar nada', () => {
  const ctx = loadConSchema();
  ctx.Contexto.sembrarFoda({}, ENC);
  ctx.Contexto.sembrarPartes({}, ENC);
  envejecerContexto(ctx, '2024-01-15');
  assert.equal(clausula(ctx, '4.1').estado, 'PARCIAL');

  const r = ctx.Contexto.registrarRevision({}, ENC);
  assert.equal(r.ok, true);

  assert.equal(clausula(ctx, '4.1').estado, 'COMPLETO');
  assert.equal(clausula(ctx, '4.2').estado, 'COMPLETO');
  assert.equal(ctx.Contexto.obtener({}, ENC).resumen.revision_vencida, false);

  // Y la revisión alcanza a TODO, no solo al FODA.
  const partes = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_PARTES_INTERESADAS);
  const hoy = new Date().toISOString().slice(0, 10);
  assert.ok(partes.every((p) => String(p.fecha_ultima_revision).slice(0, 10) === hoy));
});

test('no se registra una revisión de algo que no existe', () => {
  const ctx = loadConSchema();
  assert.match(ctx.Contexto.registrarRevision({}, ENC).message, /nada que revisar/i);
});

test('un FODA al que le falta un cuadrante entero no cierra 4.1', () => {
  const ctx = loadConSchema();
  ctx.Contexto.sembrarPartes({}, ENC);
  ctx.Contexto.guardarFactor({ tipo: 'FORTALEZA', descripcion: 'Única fortaleza.' }, ENC);

  const d = ctx.MatrizCobertura.getDetalle({ codigo: '4.1' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /oportunidad/i);
  assert.match(d.nota, /debilidad/i);
  assert.match(d.nota, /amenaza/i);
});

test('una parte sin requisitos escritos mantiene 4.2 en parcial', () => {
  const ctx = loadConSchema();
  ctx.Contexto.sembrarPartes({}, ENC);
  assert.equal(clausula(ctx, '4.2').estado, 'COMPLETO');

  // Se escribe directo en la hoja: la API lo impide, pero alguien puede
  // vaciar la celda a mano y 4.2 tiene que notarlo.
  const parte = ctx.leerFilasSeguro_(ctx.SHEETS.SGC_PARTES_INTERESADAS)[0];
  ctx.actualizarFilaPorId_(ctx.SHEETS.SGC_PARTES_INTERESADAS, 'parte_id', parte.parte_id,
    { necesidades: '' });

  const d = ctx.MatrizCobertura.getDetalle({ codigo: '4.2' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /sin necesidades o requisitos/i);
});
