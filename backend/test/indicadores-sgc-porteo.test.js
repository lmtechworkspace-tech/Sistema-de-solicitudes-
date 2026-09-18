'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 v11.0 Fase 6 (indicadores de
 * proceso, §9.1.1) -- mismos escenarios de indicadores.test.js, corridos
 * contra backend/logica/indicadoresSgc.js, incluido su efecto en
 * backend/logica/matrizCoberturaSgc.js (que deja de usar el stub de
 * Indicadores en este incremento) y la no-regresión de la Fase 6a
 * (objetivosSgc.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Objetivos = require('../logica/objetivosSgc');
const Procesos = require('../logica/procesosSgc');
const Indicadores = require('../logica/indicadoresSgc');
const MatrizCobertura = require('../logica/matrizCoberturaSgc');

const TABLAS = [
  'SGC_INDICADORES', 'SGC_INDICADOR_LECTURAS', 'SGC_OBJETIVOS', 'SGC_PROCESOS',
  'SGC_PROCESO_PASOS', 'SGC_RIESGOS', 'SGC_CONTEXTO', 'SGC_PARTES_INTERESADAS',
  'SGC_ALCANCE', 'SGC_EXCLUSIONES', 'SGC_ROLES', 'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES',
  'SGC_DOC_DESTINATARIOS', 'SGC_DOC_ACUSES', 'SGC_PERSONAS', 'SGC_DESCRIPTORES',
  'SGC_PERSONA_DOCUMENTOS', 'SGC_INDUCCIONES', 'SGC_EVALUACIONES', 'SGC_CAPACITACIONES',
  'SGC_CAPACITACION_ASISTENTES', 'SGC_NC', 'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS', 'SGC_QUEJAS',
  'SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES', 'SGC_REVISIONES', 'SGC_REVISION_ACUERDOS',
  'SGC_COBERTURA_HISTORICO', 'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'NOVEDADES',
  'LOG_SISTEMA', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP', 'CONFIG_NOTIFICACIONES'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };
const ENC = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const OPERATIVO = { email: 'operativo@homepymes.cl', nombre: 'Operativo', rol: 'DEV' };
const ANIO = new Date().getFullYear();

function sembrarRoles(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'CONTABILIDAD' }, CTX_ADM);
}
function crear() {
  const db = db_();
  sembrarRoles(db);
  return db;
}
function crearIndicador(db, extra) {
  return Indicadores.guardar(db, Object.assign({
    nombre: 'Cumplimiento de plazos',
    formula: 'entregas a tiempo / entregas totales × 100',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 90, tolerancia_valor: 85,
    frecuencia: 'MENSUAL', unidad: 'PORCENTAJE'
  }, extra || {}), ENC);
}

// --- 1. No regresión de la Fase 6a ------------------------------------------

test('las lecturas de indicador NO se cuelan en el tablero de objetivos', () => {
  const db = crear();
  Objetivos.sembrarAnio(db, { anio: ANIO }, ENC);
  const antes = Objetivos.listar(db, { anio: ANIO }, ENC).indicadores;

  const i = crearIndicador(db);
  ['M01', 'M02', 'M03'].forEach((p) => {
    Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-' + p, valor: 95 }, ENC);
  });

  const despues = Objetivos.listar(db, { anio: ANIO }, ENC);
  assert.deepEqual(despues.indicadores, antes,
    'el tablero de objetivos es evidencia de §6.2: si cambia por esto, empieza a mentir');
  assert.ok(despues.objetivos.every((o) => !o.ultima_lectura),
    'ningún objetivo puede quedar "medido" por una lectura que no es suya');
});

test('un indicador que ALIMENTA un objetivo tampoco lo da por medido', () => {
  const db = crear();
  Objetivos.sembrarAnio(db, { anio: ANIO }, ENC);
  const objetivo = Objetivos.listar(db, { anio: ANIO }, ENC).objetivos[0];

  const i = crearIndicador(db, { objetivo_id: objetivo.objetivo_id, frecuencia: 'ANUAL', tolerancia_valor: '' });
  Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: String(ANIO), valor: 95 }, ENC);

  const tablero = Objetivos.listar(db, { anio: ANIO }, ENC);
  assert.equal(tablero.objetivos.filter((o) => o.ultima_lectura).length, 0,
    'ningún objetivo puede quedar medido por la lectura de un indicador que lo alimenta');
  assert.equal(tablero.indicadores.sin_medir, 6);

  // Pero el vínculo sí se ve desde el lado del indicador.
  const listado = Indicadores.listar(db, {}, ENC).indicadores[0];
  assert.match(listado.objetivo, /^OBJ-/);
});

test('una lectura de indicador nace sin objetivo_id, y por eso es invisible', () => {
  const db = crear();
  const i = crearIndicador(db);
  Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 95 }, ENC);

  const l = filas(db, 'SGC_INDICADOR_LECTURAS')[0];
  assert.equal(l.objetivo_id, '', 'todo el tablero de objetivos cruza por objetivo_id');
  assert.equal(l.indicador_id, i.indicador_id);
});

test('el aviso de lecturas pendientes de objetivos sigue mirando solo objetivos', async () => {
  const db = crear();
  const i = crearIndicador(db);
  Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 95 }, ENC);
  assert.deepEqual(await Objetivos.alertarLecturasPendientes(db), [],
    'sin objetivos sembrados no hay nada pendiente, aunque haya lecturas de indicador');
});

// --- 2. Los tres veredictos --------------------------------------------------

test('la tolerancia crea el escalón intermedio', () => {
  const db = crear();
  const i = crearIndicador(db); // meta ≥90, tolerancia 85

  const casos = [[95, 'CUMPLE'], [90, 'CUMPLE'], [87, 'ALERTA'], [85, 'ALERTA'], [84, 'NO_CUMPLE'], [40, 'NO_CUMPLE']];
  casos.forEach((c, idx) => {
    const r = Indicadores.registrarLectura(db, {
      indicador_id: i.indicador_id, periodo: ANIO + '-M0' + (idx + 1), valor: c[0]
    }, ENC);
    assert.equal(r.veredicto, c[1], 'valor ' + c[0]);
  });
});

test('sin tolerancia solo hay cumple y no cumple', () => {
  const db = crear();
  const i = crearIndicador(db, { tolerancia_valor: '' });
  assert.equal(Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 87 }, ENC).veredicto,
    'NO_CUMPLE', 'sin tolerancia definida no hay zona de alerta');
});

test('la tolerancia tiene que ser más laxa que la meta', () => {
  const db = crear();
  let r = Indicadores.guardar(db, {
    nombre: 'X', formula: 'f', meta_operador: 'MAYOR_IGUAL', meta_valor: 90,
    tolerancia_valor: 95, frecuencia: 'MENSUAL'
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /más laxa/i);

  r = Indicadores.guardar(db, {
    nombre: 'Reclamos', formula: 'f', meta_operador: 'MENOR', meta_valor: 2,
    tolerancia_valor: 1, frecuencia: 'MENSUAL'
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /mayor que 2/);

  r = Indicadores.guardar(db, {
    nombre: 'Reclamos', formula: 'f', meta_operador: 'MENOR', meta_valor: 2,
    tolerancia_valor: 3, frecuencia: 'MENSUAL'
  }, ENC);
  assert.equal(r.ok, true, 'con "menor que", una tolerancia mayor sí es más laxa');
});

test('un indicador de "menor que" evalúa al revés', () => {
  const db = crear();
  const i = Indicadores.guardar(db, {
    nombre: 'Reclamos sobre total de servicios', formula: 'reclamos / servicios × 100',
    meta_operador: 'MENOR', meta_valor: 2, tolerancia_valor: 3,
    frecuencia: 'MENSUAL', unidad: 'PORCENTAJE'
  }, ENC);

  assert.equal(Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 1.5 }, ENC).veredicto, 'CUMPLE');
  assert.equal(Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-M02', valor: 2.5 }, ENC).veredicto, 'ALERTA');
  assert.equal(Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-M03', valor: 8 }, ENC).veredicto, 'NO_CUMPLE');
});

// --- 3. El veredicto queda congelado ----------------------------------------

test('bajar la meta no reescribe lo que ya se midió', () => {
  const db = crear();
  const i = crearIndicador(db);
  Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 60 }, ENC);

  const antes = filas(db, 'SGC_INDICADOR_LECTURAS')[0];
  assert.equal(antes.origen, 'NO_CUMPLE');

  Indicadores.guardar(db, {
    indicador_id: i.indicador_id, nombre: 'Cumplimiento de plazos', formula: 'f',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 50, frecuencia: 'MENSUAL'
  }, ENC);

  const despues = filas(db, 'SGC_INDICADOR_LECTURAS')[0];
  assert.equal(despues.origen, 'NO_CUMPLE',
    'lo que se midió con la meta de entonces tiene que seguir diciendo lo mismo');
});

// --- 4. Períodos y cálculo ---------------------------------------------------

test('la clave de período tiene que corresponder a la frecuencia', () => {
  const db = crear();
  const i = crearIndicador(db, { frecuencia: 'SEMESTRAL', tolerancia_valor: '' });

  const r = Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-M03', valor: 95 }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /no corresponde a la frecuencia semestral/i);

  assert.equal(Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-S1', valor: 95 }, ENC).ok, true);
});

test('el numerador y el denominador se guardan aparte y derivan el valor', () => {
  const db = crear();
  const i = crearIndicador(db);
  const r = Indicadores.registrarLectura(db, {
    indicador_id: i.indicador_id, periodo: ANIO + '-M01', numerador: 45, denominador: 50
  }, ENC);

  assert.equal(r.valor, 90);
  const l = filas(db, 'SGC_INDICADOR_LECTURAS')[0];
  assert.equal(Number(l.numerador), 45);
  assert.equal(Number(l.denominador), 50);
});

test('el denominador cero se rechaza en vez de producir infinito', () => {
  const db = crear();
  const i = crearIndicador(db);
  const r = Indicadores.registrarLectura(db, {
    indicador_id: i.indicador_id, periodo: ANIO + '-M01', numerador: 1, denominador: 0
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /no puede ser cero/i);
});

test('volver a medir el mismo período reemplaza y conserva la anterior', () => {
  const db = crear();
  const i = crearIndicador(db);
  Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 95 }, ENC);
  Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 70 }, ENC);

  const todas = filas(db, 'SGC_INDICADOR_LECTURAS');
  const activas = todas.filter((l) => l.activa === true || l.activa === 1);
  assert.equal(activas.length, 1);
  assert.equal(Number(activas[0].valor), 70);
  assert.equal(todas.length, 2, 'la anterior se conserva anulada, no se borra');
});

// --- 5. Validaciones y permisos ---------------------------------------------

test('un indicador sin fórmula no se guarda', () => {
  const db = crear();
  const r = Indicadores.guardar(db, {
    nombre: 'Algo', meta_operador: 'MAYOR_IGUAL', meta_valor: 90, frecuencia: 'MENSUAL'
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /cómo se calcula/i);
});

test('el código correlativo se asigna solo', () => {
  const db = crear();
  crearIndicador(db);
  const segundo = crearIndicador(db, { nombre: 'Otro' });
  const lista = Indicadores.listar(db, {}, ENC).indicadores;
  assert.deepEqual(lista.map((x) => x.codigo).sort(), ['IND-01', 'IND-02']);
  assert.ok(segundo.ok);
});

test('solo el Encargado define y mide', () => {
  const db = crear();
  assert.equal(Indicadores.guardar(db, { nombre: 'X', formula: 'f', meta_operador: 'MAYOR_IGUAL', meta_valor: 1, frecuencia: 'ANUAL' }, OPERATIVO)._forbidden, true);
  const i = crearIndicador(db);
  assert.equal(Indicadores.registrarLectura(db, { indicador_id: i.indicador_id, periodo: ANIO + '-M01', valor: 95 }, OPERATIVO)._forbidden, true);
  assert.equal(Indicadores.listar(db, {}, OPERATIVO)._forbidden, true);
});

// --- 6. Efecto en la matriz --------------------------------------------------

test('9.1 exige indicadores de proceso, no solo los objetivos', () => {
  const db = crear();
  Objetivos.sembrarAnio(db, { anio: ANIO }, ENC);

  let d = MatrizCobertura.getDetalle(db, { codigo: '9.1' }, ENC);
  assert.match(d.nota, /no hay indicadores de proceso definidos/i,
    'medir solo los seis objetivos corporativos deja los procesos sin medición');

  crearIndicador(db);
  d = MatrizCobertura.getDetalle(db, { codigo: '9.1' }, ENC);
  assert.match(d.nota, /nunca medido/i, 'definirlo no es medirlo');
  assert.match(d.resumen, /1 indicador\(es\) de proceso/);
});

test('el tablero cuenta cuántos procesos del mapa quedan sin indicador', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);

  let r = Indicadores.listar(db, {}, ENC).resumen;
  assert.equal(r.procesos_mapa, 14);
  assert.equal(r.procesos_sin_indicador, 14, 'es la medida de la debilidad D1 del FODA');

  const proceso = Procesos.listar(db, {}, ENC).mapa.find((p) => p.codigo === 'PA-05');
  crearIndicador(db, { proceso_id: proceso.proceso_id });

  r = Indicadores.listar(db, {}, ENC).resumen;
  assert.equal(r.procesos_sin_indicador, 13);
});
