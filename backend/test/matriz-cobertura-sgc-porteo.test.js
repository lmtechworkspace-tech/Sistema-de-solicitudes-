'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 Fase 6b (matriz de cobertura ISO +
 * histórico semanal) -- escenarios de matriz-cobertura.test.js y
 * cobertura-historico.test.js, corridos contra
 * backend/logica/matrizCoberturaSgc.js.
 *
 * Adaptación (v11 Alcance/Contexto/Riesgos/Procesos/Indicadores/Prestaciones
 * aún no portadas, ver cabecera del módulo): las cláusulas 4.1/4.2/4.3/4.4/
 * 6.1/8.x/9.1 se prueban en su estado REAL de degradación (FALTANTE/PARCIAL
 * según haya o no documentos etiquetados), no en el estado que tendrían una
 * vez portadas esas fases -- exactamente el mismo comportamiento que tenía
 * el propio `.gs` antes de que existieran esos módulos.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Personas = require('../logica/personasSgc');
const Objetivos = require('../logica/objetivosSgc');
const MatrizCobertura = require('../logica/matrizCoberturaSgc');

const TABLAS = [
  'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES', 'SGC_DOC_DESTINATARIOS', 'SGC_DOC_ACUSES', 'SGC_ROLES',
  'SGC_NC', 'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS', 'SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES',
  'SGC_REVISIONES', 'SGC_REVISION_ACUERDOS', 'SGC_OBJETIVOS', 'SGC_INDICADOR_LECTURAS',
  'SGC_PERSONAS', 'SGC_DESCRIPTORES', 'SGC_EVALUACIONES', 'SGC_INDUCCIONES',
  'SGC_CAPACITACIONES', 'SGC_CAPACITACION_ASISTENTES', 'SGC_PERSONA_DOCUMENTOS',
  'NOVEDADES', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'JEFATURAS', 'CONFIG_FERIADOS', 'SGC_COBERTURA_HISTORICO',
  'LOG_SISTEMA', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP', 'CONFIG_NOTIFICACIONES', 'CAT_AREAS'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };
const CTX_GERENCIA = { email: 'gerencia@homepymes.cl', nombre: 'Gerencia', rol: 'GERENCIA' };
const CTX_AUDITOR = { email: 'auditor@certificadora.cl', nombre: 'Auditor', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

function sembrarRoles(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'auditor@certificadora.cl', rol_sgc: 'AUDITOR_EXTERNO', vigencia_hasta: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() }, CTX_ADM);
}
function clausula(db, codigo) {
  const m = MatrizCobertura.listar(db, {}, CTX_ENCARGADO);
  return m.clausulas.find((c) => c.codigo === codigo);
}

// --- el estado sale de datos reales, no de una opinion -----------------------

test('sin NC, 10.2 y 8.7 quedan FALTANTE con nota explicativa', () => {
  const db = db_();
  sembrarRoles(db);

  assert.equal(clausula(db, '10.2').estado, 'FALTANTE');
  const detalle = MatrizCobertura.getDetalle(db, { codigo: '10.2' }, CTX_ENCARGADO);
  assert.match(detalle.resumen, /No hay no conformidades/i);
});

test('una NC abierta sube 10.2 a PARCIAL; con eficacia verificada sube a COMPLETO', () => {
  const db = db_();
  sembrarRoles(db);

  agregarFila_(db, 'SGC_NC', Object.assign(ncBase_('NC-1'), { descripcion: 'Entrega tardía a cliente', estado: 'ABIERTA', fecha_deteccion: '2026-01-10T12:00:00.000Z', responsable_email: 'sgc@homepymes.cl' }));
  assert.equal(clausula(db, '10.2').estado, 'PARCIAL');

  agregarFila_(db, 'SGC_NC', Object.assign(ncBase_('NC-2'), { descripcion: 'Documento vencido en circulación', estado: 'CERRADA', fecha_deteccion: '2026-02-01T12:00:00.000Z', responsable_email: 'sgc@homepymes.cl', eficacia_resultado: 'EFICAZ' }));
  assert.equal(clausula(db, '10.2').estado, 'COMPLETO');

  // 8.7 mide algo distinto de 10.2 y depende de SGC_PRESTACIONES (v11 Fase
  // 8, no portada): sin prestaciones registradas queda PARCIAL, apoyada en
  // la evidencia de NC mientras tanto.
  assert.equal(clausula(db, '8.7').estado, 'PARCIAL');
  assert.match(MatrizCobertura.getDetalle(db, { codigo: '8.7' }, CTX_ENCARGADO).nota, /Registra las prestaciones/i);
});

function ncBase_(id) {
  return {
    nc_id: id, correlativo: id, fuente: 'PROCESO', origen_ref: '', referencia_normativa: '', descripcion: '',
    area_id: '', detectada_por: '', fecha_deteccion: '', responsable_email: '', estado: 'ABIERTA', ciclo: 1,
    correccion_descripcion: '', correccion_actividad_id: '', correccion_plazo: '', correccion_fecha_cierre: '',
    porque_1: '', porque_2: '', porque_3: '', porque_4: '', porque_5: '', causa_raiz: '',
    accion_descripcion: '', accion_actividad_id: '', accion_plazo: '', accion_fecha_cierre: '',
    eficacia_plazo: '', eficacia_fecha: '', eficacia_resultado: '', eficacia_observaciones: '',
    fecha_cierre: '', cerrada_por: '', fecha_creacion: new Date().toISOString(), activa: true
  };
}

test('objetivos abiertos sin medir dejan 6.2 en FALTANTE; medidos, en COMPLETO (9.1 queda PARCIAL sin indicadores de proceso, v11 Fase 6 pendiente)', async () => {
  const anio = new Date().getFullYear() - 1;
  const db = db_();
  sembrarRoles(db);

  assert.equal(clausula(db, '6.2').estado, 'FALTANTE');

  Objetivos.sembrarAnio(db, { anio }, CTX_ENCARGADO);
  assert.equal(clausula(db, '6.2').estado, 'FALTANTE', 'sembrar la meta no basta sin ninguna medición');

  const PERIODO_POR_FRECUENCIA = { MENSUAL: anio + '-M01', TRIMESTRAL: anio + '-T1', SEMESTRAL: anio + '-S1', ANUAL: String(anio) };
  const tablero = Objetivos.listar(db, { anio }, CTX_ENCARGADO);
  for (const o of tablero.objetivos) {
    const r = await Objetivos.registrarLectura(db, { objetivo_id: o.objetivo_id, periodo: PERIODO_POR_FRECUENCIA[o.frecuencia], valor: 50 }, CTX_ENCARGADO);
    assert.equal(r.ok, true);
  }

  assert.equal(clausula(db, '6.2').estado, 'COMPLETO');

  // Hasta que se porte Indicadores (v11 Fase 6), 9.1 nunca puede pasar de
  // PARCIAL: exige además medir el desempeño de los procesos (§9.1.3 e).
  assert.equal(clausula(db, '9.1').estado, 'PARCIAL');
  assert.match(MatrizCobertura.getDetalle(db, { codigo: '9.1' }, CTX_ENCARGADO).nota, /indicadores de proceso/i);
});

test('7.2 llega a COMPLETO solo cuando la cobertura de personal supera el umbral', () => {
  const db = db_();
  sembrarRoles(db);

  agregarFila_(db, 'SGC_PERSONAS', personaBase_('P1', 'Ana'));
  agregarFila_(db, 'SGC_PERSONAS', personaBase_('P2', 'Bruno'));

  assert.equal(clausula(db, '7.2').estado, 'FALTANTE');

  agregarFila_(db, 'SGC_DESCRIPTORES', descriptorBase_('D1', 'P1'));
  agregarFila_(db, 'SGC_EVALUACIONES', evaluacionBase_('E1', 'P1'));
  assert.equal(clausula(db, '7.2').estado, 'PARCIAL');

  agregarFila_(db, 'SGC_DESCRIPTORES', descriptorBase_('D2', 'P2'));
  agregarFila_(db, 'SGC_EVALUACIONES', evaluacionBase_('E2', 'P2'));
  assert.equal(clausula(db, '7.2').estado, 'COMPLETO');
});

function personaBase_(id, nombre) {
  return { persona_id: id, usuario_email: '', nombre, rut: '', cargo: '', tipo: 'INT', area_id: '', jefatura_email: '', subrogante_email: '', fecha_ingreso: '', estado: 'VIGENTE', fecha_desvinculacion: '', creado_por: '', fecha_creacion: new Date().toISOString(), activa: true };
}
function descriptorBase_(id, personaId) {
  return { descriptor_id: id, persona_id: personaId, version: 'v01', objetivo: '', funciones: '', responsabilidades: '', habilidades: '', items_responsabilidades: '[]', items_habilidades: '[]', nivel_educacional: '', formacion_tecnica: '', experiencia: '', archivo_id: '', archivo_nombre: '', archivo_mime: '', vigente: true, creado_por: '', fecha: new Date().toISOString() };
}
function evaluacionBase_(id, personaId) {
  return { evaluacion_id: id, persona_id: personaId, descriptor_id: '', fecha: '2026-01-01T00:00:00.000Z', evaluador_email: 'jefe@homepymes.cl', respuestas_responsabilidades: '[]', respuestas_habilidades: '[]', promedio_responsabilidades: 0, promedio_habilidades: 0, requiere_capacitacion: false, observaciones: '', recomendado_por: '', proxima_evaluacion: '' };
}

test('7.3 llega a COMPLETO cerrando la inducción por donde la cierra el sistema', () => {
  const db = db_();
  sembrarRoles(db);

  const p = Personas.guardarPersona(db, { usuario_email: 'ana@homepymes.cl', nombre: 'Ana', tipo: 'INT' }, CTX_ENCARGADO);
  assert.equal(clausula(db, '7.3').estado, 'FALTANTE');

  const suyas = leerFilas_(db, 'SGC_INDUCCIONES', COLUMNAS.SGC_INDUCCIONES).filter((i) => i.persona_id === p.persona_id);
  assert.equal(suyas.length, 5);

  suyas.forEach((item, n) => {
    Personas.registrarInduccion(db, { persona_id: p.persona_id, induccion_id: item.induccion_id, estado: 'COMPLETADA', fecha: '2026-03-0' + (n + 1) + 'T00:00:00.000Z' }, CTX_ENCARGADO);
  });

  assert.equal(clausula(db, '7.3').estado, 'COMPLETO');
});

// --- las clausulas de documento NUNCA se adivinan -----------------------------

test('5.2 (política) queda FALTANTE aunque existan documentos, hasta que se etiqueten', async () => {
  const db = db_();
  sembrarRoles(db);

  const doc = await Calidad.crearDocumento(db, { codigo: 'DOC-01', nombre: 'Manual de Calidad', tipo: 'DOC', visibilidad: 'TODOS' }, CTX_ENCARGADO);
  assert.equal(clausula(db, '5.2').estado, 'FALTANTE');

  const detalleSinEtiquetar = MatrizCobertura.getDetalle(db, { codigo: '5.2' }, CTX_ENCARGADO);
  assert.match(detalleSinEtiquetar.nota, /etiqueta el documento/i);

  await Calidad.actualizarDocumento(db, { documento_id: doc.documento_id, clausulas_iso: ['5.2'] }, CTX_ENCARGADO);

  assert.equal(clausula(db, '5.2').estado, 'COMPLETO');
  const detalle = MatrizCobertura.getDetalle(db, { codigo: '5.2' }, CTX_ENCARGADO);
  assert.equal(detalle.evidencia.length, 1);
  assert.match(detalle.evidencia[0].descripcion, /DOC-01/);
});

test('un código de cláusula inventado se descarta al guardar, no se acepta', async () => {
  const db = db_();
  sembrarRoles(db);
  const doc = await Calidad.crearDocumento(db, { codigo: 'DOC-02', nombre: 'Otro documento', tipo: 'DOC', visibilidad: 'TODOS', clausulas_iso: ['5.2', '99.9', ''] }, CTX_ENCARGADO);
  const detalle = Calidad.getDocumento(db, { documento_id: doc.documento_id }, CTX_ENCARGADO);
  assert.deepEqual(detalle.documento.clausulas_iso, ['5.2']);
});

test('una cláusula sin ningún módulo que la cubra explica por qué, no queda muda', () => {
  const db = db_();
  sembrarRoles(db);
  const c63 = MatrizCobertura.getDetalle(db, { codigo: '6.3' }, CTX_ENCARGADO);
  assert.equal(c63.estado, 'FALTANTE');
  assert.match(c63.nota, /no tiene un módulo propio/i);
});

test('una cláusula sin módulo propio SÍ cuenta el documento etiquetado', async () => {
  const db = db_();
  sembrarRoles(db);

  const doc = await Calidad.crearDocumento(db, { codigo: 'DOC-01', nombre: 'Manual de Calidad', tipo: 'DOC', visibilidad: 'TODOS' }, CTX_ENCARGADO);
  assert.equal(clausula(db, '6.3').estado, 'FALTANTE');

  await Calidad.actualizarDocumento(db, { documento_id: doc.documento_id, clausulas_iso: ['6.3'] }, CTX_ENCARGADO);

  const c63 = MatrizCobertura.getDetalle(db, { codigo: '6.3' }, CTX_ENCARGADO);
  assert.equal(c63.estado, 'PARCIAL');
  assert.equal(c63.evidencia.length, 1);
  assert.match(c63.evidencia[0].descripcion, /DOC-01/);
  assert.match(c63.nota, /no tiene un módulo propio/i);
});

test('6.1 (riesgos): sin la matriz cargada, degrada a FALTANTE o PARCIAL según haya documentos etiquetados', async () => {
  const db = db_();
  sembrarRoles(db);
  assert.equal(clausula(db, '6.1').estado, 'FALTANTE');

  const doc = await Calidad.crearDocumento(db, { codigo: 'DOC-01', nombre: 'Matriz de riesgos', tipo: 'DOC', visibilidad: 'TODOS' }, CTX_ENCARGADO);
  await Calidad.actualizarDocumento(db, { documento_id: doc.documento_id, clausulas_iso: ['6.1'] }, CTX_ENCARGADO);
  assert.equal(clausula(db, '6.1').estado, 'PARCIAL');
});

// --- resumen global ------------------------------------------------------------

test('el resumen global cuenta 28 cláusulas y las clasifica correctamente', () => {
  const db = db_();
  sembrarRoles(db);
  const m = MatrizCobertura.listar(db, {}, CTX_ENCARGADO);
  assert.equal(m.clausulas.length, 28);
  assert.equal(m.resumen.total, 28);
  assert.equal(m.resumen.completo + m.resumen.parcial + m.resumen.faltante + m.resumen.no_aplica, 28);
});

// --- permisos --------------------------------------------------------------

test('Gerencia y el auditor externo ven la matriz; el operativo no', () => {
  const db = db_();
  sembrarRoles(db);

  const gerencia = MatrizCobertura.listar(db, {}, CTX_GERENCIA);
  assert.equal(gerencia.clausulas.length, 28);
  assert.equal(gerencia.puede_gestionar, false);

  const auditor = MatrizCobertura.listar(db, {}, CTX_AUDITOR);
  assert.equal(auditor.clausulas.length, 28);

  const operativo = MatrizCobertura.listar(db, {}, CTX_OPERATIVO);
  assert.equal(operativo._forbidden, true);
});

// ===========================================================================
// Histórico semanal de cobertura (v12.8)
// ===========================================================================

test('archivar dos veces la misma semana escribe UNA sola fila', () => {
  const db = db_();
  sembrarRoles(db);
  const primera = MatrizCobertura.archivarFoto(db);
  const segunda = MatrizCobertura.archivarFoto(db);
  assert.equal(primera.escrita, true);
  assert.equal(segunda.escrita, false);
  assert.equal(leerFilas_(db, 'SGC_COBERTURA_HISTORICO', COLUMNAS.SGC_COBERTURA_HISTORICO).length, 1);
});

test('el período es el LUNES de la semana', () => {
  assert.equal(MatrizCobertura.lunesDeLaSemana_(new Date('2026-09-05T12:00:00Z')), '2026-08-31');
  assert.equal(MatrizCobertura.lunesDeLaSemana_(new Date('2026-08-31T00:00:00Z')), '2026-08-31');
  assert.equal(MatrizCobertura.lunesDeLaSemana_(new Date('2026-09-06T23:00:00Z')), '2026-08-31');
  assert.equal(MatrizCobertura.lunesDeLaSemana_(new Date('2026-09-07T00:00:00Z')), '2026-09-07');
});

test('lo archivado es EXACTAMENTE lo que muestra la matriz de hoy', () => {
  const db = db_();
  sembrarRoles(db);
  const hoy = MatrizCobertura.matrizCalculada_(db);
  MatrizCobertura.archivarFoto(db);

  const fila = leerFilas_(db, 'SGC_COBERTURA_HISTORICO', COLUMNAS.SGC_COBERTURA_HISTORICO)[0];
  assert.equal(Number(fila.pct_listo), hoy.resumen.pct_listo);
  assert.equal(Number(fila.aplicables), hoy.resumen.aplicables);
  assert.equal(Number(fila.completo), hoy.resumen.completo);
  assert.equal(Number(fila.parcial), hoy.resumen.parcial);
  assert.equal(Number(fila.faltante), hoy.resumen.faltante);
  assert.equal(Number(fila.no_aplica), hoy.resumen.no_aplica);
});

test('se guarda el desglose de los siete capítulos de la norma', () => {
  const db = db_();
  sembrarRoles(db);
  MatrizCobertura.archivarFoto(db);
  const fila = leerFilas_(db, 'SGC_COBERTURA_HISTORICO', COLUMNAS.SGC_COBERTURA_HISTORICO)[0];

  const porCapitulo = {};
  MatrizCobertura.saludPorCapitulo_(MatrizCobertura.matrizCalculada_(db).clausulas).forEach((c) => { porCapitulo[c.numero] = c.pct; });

  ['4', '5', '6', '7', '8', '9', '10'].forEach((n) => {
    assert.equal(Number(fila['cap_' + n]), porCapitulo[n]);
  });
});

test('el histórico llega ordenado de lo más antiguo a lo más nuevo', () => {
  const db = db_();
  sembrarRoles(db);
  const cols = COLUMNAS.SGC_COBERTURA_HISTORICO;
  function fila(periodo, pct) {
    const obj = {};
    cols.forEach((c) => { obj[c] = 0; });
    obj.cobertura_id = 'C-' + periodo; obj.periodo = periodo; obj.fecha = periodo; obj.pct_listo = pct; obj.aplicables = 28;
    return obj;
  }
  [fila('2026-03-02', 40), fila('2026-01-05', 20), fila('2026-02-02', 30)].forEach((f) => agregarFila_(db, 'SGC_COBERTURA_HISTORICO', f));

  const r = MatrizCobertura.listarHistorico(db, {}, CTX_ADM);
  assert.deepEqual(r.fotos.map((f) => f.periodo), ['2026-01-05', '2026-02-02', '2026-03-02']);
  assert.deepEqual(r.fotos.map((f) => f.pct_listo), [20, 30, 40]);
});

test('el histórico trae también el valor de HOY, sin esperar al lunes', () => {
  const db = db_();
  sembrarRoles(db);
  const r = MatrizCobertura.listarHistorico(db, {}, CTX_ADM);
  assert.equal(r.actual.pct_listo, MatrizCobertura.matrizCalculada_(db).resumen.pct_listo);
});

test('el histórico tiene el MISMO portón que la matriz', () => {
  const db = db_();
  const r = MatrizCobertura.listarHistorico(db, {}, CTX_OPERATIVO);
  assert.equal(r._forbidden, true);
  assert.equal(r.fotos, undefined);
});

test('con la hoja creada, hoja_lista es true aunque no haya ninguna foto', () => {
  const db = db_();
  sembrarRoles(db);
  const r = MatrizCobertura.listarHistorico(db, {}, CTX_ADM);
  assert.equal(r.hoja_lista, true);
  assert.deepEqual(r.fotos, []);
});

test('sin la hoja del histórico, hoja_lista lo DICE en vez de parecer una serie vacía', () => {
  const db = abrirDb_();
  TABLAS.filter((h) => h !== 'SGC_COBERTURA_HISTORICO').forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  sembrarRoles(db);

  const r = MatrizCobertura.listarHistorico(db, {}, CTX_ADM);
  assert.equal(r.hoja_lista, false);
  assert.deepEqual(r.fotos, []);
  assert.ok(r.actual, 'el indicador de hoy sigue siendo correcto: eso no depende de la hoja');
});
