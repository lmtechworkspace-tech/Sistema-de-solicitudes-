'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 v11.0 Fase 4 (procesos, §4.4, y base
 * de §8.1/§8.5/§8.6) -- mismos escenarios de procesos.test.js, corridos
 * contra backend/logica/procesosSgc.js, incluido su efecto en
 * backend/logica/matrizCoberturaSgc.js (que deja de usar los stubs de
 * Procesos en este incremento, y sube evaluarPrestaciones_ a su lógica
 * completa).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Riesgos = require('../logica/riesgosSgc');
const Procesos = require('../logica/procesosSgc');
const MatrizCobertura = require('../logica/matrizCoberturaSgc');

const TABLAS = [
  'SGC_PROCESOS', 'SGC_PROCESO_PASOS', 'SGC_RIESGOS', 'SGC_CONTEXTO', 'SGC_PARTES_INTERESADAS',
  'SGC_ALCANCE', 'SGC_EXCLUSIONES', 'SGC_ROLES', 'SGC_DOCUMENTOS', 'SGC_DOC_VERSIONES',
  'SGC_DOC_DESTINATARIOS', 'SGC_DOC_ACUSES', 'SGC_PERSONAS', 'SGC_DESCRIPTORES',
  'SGC_PERSONA_DOCUMENTOS', 'SGC_INDUCCIONES', 'SGC_EVALUACIONES', 'SGC_CAPACITACIONES',
  'SGC_CAPACITACION_ASISTENTES', 'SGC_NC', 'SGC_AUDITORIAS', 'SGC_AUD_HALLAZGOS', 'SGC_QUEJAS',
  'SGC_PROVEEDORES', 'SGC_PROVEEDOR_EVALUACIONES', 'SGC_REVISIONES', 'SGC_REVISION_ACUERDOS',
  'SGC_OBJETIVOS', 'SGC_INDICADOR_LECTURAS', 'SGC_COBERTURA_HISTORICO',
  'ACTIVIDADES', 'ACTIVIDADES_BITACORA', 'NOVEDADES', 'LOG_SISTEMA'
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

function sembrarRoles(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'operativo@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'CONTABILIDAD' }, CTX_ADM);
}
function clausula(db, codigo) {
  return MatrizCobertura.listar(db, {}, ENC).clausulas.find((c) => c.codigo === codigo);
}
function mapaPorCodigo(db, codigo) {
  return Procesos.listar(db, {}, ENC).mapa.find((p) => p.codigo === codigo);
}
function crear() {
  const db = db_();
  sembrarRoles(db);
  return db;
}

// --- 1. El mapa del DOC-03 ---------------------------------------------------

test('el mapa sembrado son los 14 procesos del DOC-03 v02, en sus tres categorías', () => {
  const db = crear();
  const r = Procesos.sembrarMapa(db, {}, ENC);
  assert.equal(r.total, 14, 'el DOC-03 v02 tiene 14 procesos, no 13');

  const d = Procesos.listar(db, {}, ENC);
  assert.deepEqual(d.resumen.por_tipo, { ESTRATEGICO: 3, OPERATIVO: 6, APOYO: 5 });
  assert.equal(d.servicios.length, 0, 'los de servicio se cargan por planilla, no aquí');
  assert.match(Procesos.sembrarMapa(db, {}, ENC).message, /ya está cargado/i);
});

test('cada proceso del mapa trae sus contenidos y su código', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);

  const contabilidad = mapaPorCodigo(db, 'PO-04');
  assert.equal(contabilidad.nombre, 'Gestión de Contabilidad');
  assert.equal(contabilidad.area, 'Contabilidad');
  assert.match(contabilidad.actividades, /F29/);
  assert.match(contabilidad.documentos, /DOC-10/);

  // El código dice el tipo de un vistazo: PE / PO / PA.
  assert.ok(Procesos.listar(db, {}, ENC).mapa.every((p) =>
    (p.tipo === 'ESTRATEGICO' && p.codigo.indexOf('PE-') === 0) ||
    (p.tipo === 'OPERATIVO' && p.codigo.indexOf('PO-') === 0) ||
    (p.tipo === 'APOYO' && p.codigo.indexOf('PA-') === 0)));
});

test('la duda del DOC-03 sobre Comercial viaja como observación, no se resuelve sola', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);
  const comercial = mapaPorCodigo(db, 'PO-01');
  assert.match(comercial.observaciones, /EXT/,
    'el mapa lo marca externo y el análisis de agosto dice que pasó a interno: lo decide la empresa');
});

test('el flujo del mapa (necesidades → satisfacción) viaja con la respuesta', () => {
  const db = crear();
  const d = Procesos.listar(db, {}, ENC);
  assert.match(d.flujo.entrada.titulo, /Necesidades/i);
  assert.match(d.flujo.salida.titulo, /Satisfacción/i);
  assert.ok(d.flujo.salida.items.some((i) => /90%/.test(i)));
  assert.match(d.flujo.ciclo, /PHVA/);
});

// --- 2. Jerarquía ------------------------------------------------------------

test('un proceso de servicio tiene que colgar de uno del mapa', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);

  const r = Procesos.guardar(db, { nombre: 'Proceso suelto', tipo: 'OPERATIVO', nivel: 'SERVICIO' }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /colgar de un proceso del mapa/i);
});

test('un proceso del mapa no cuelga de otro', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);
  const padre = mapaPorCodigo(db, 'PO-04');

  const r = Procesos.guardar(db, {
    nombre: 'Otro del mapa', tipo: 'OPERATIVO', nivel: 'MAPA', proceso_padre_id: padre.proceso_id
  }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /nivel más alto/i);
});

test('quitar un proceso con subprocesos se rechaza en vez de dejarlos huérfanos', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);
  const padre = mapaPorCodigo(db, 'PO-04');
  Procesos.guardar(db, {
    nombre: 'Declaración de Renta', tipo: 'OPERATIVO', nivel: 'SERVICIO',
    proceso_padre_id: padre.proceso_id, area: 'Contabilidad'
  }, ENC);

  const r = Procesos.anular(db, { proceso_id: padre.proceso_id }, ENC);
  assert.equal(r.ok, false);
  assert.match(r.message, /proceso\(s\) de servicio colgando/i);
  assert.ok(mapaPorCodigo(db, 'PO-04'), 'sigue ahí');
});

test('el código correlativo va por prefijo', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);

  const r = Procesos.guardar(db, { nombre: 'Nuevo de apoyo', tipo: 'APOYO', nivel: 'MAPA' }, ENC);
  assert.equal(r.ok, true);
  const creado = Procesos.listar(db, {}, ENC).mapa.find((p) => p.proceso_id === r.proceso_id);
  assert.equal(creado.codigo, 'PA-06', 'el DOC-03 traía 5 procesos de apoyo');
});

// --- 3. La ficha del proceso -------------------------------------------------

test('la ficha muestra pasos, subprocesos y riesgos del proceso', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);
  const padre = mapaPorCodigo(db, 'PO-04');

  const hijo = Procesos.guardar(db, {
    nombre: 'Proceso Mensual de IVA', tipo: 'OPERATIVO', nivel: 'SERVICIO',
    proceso_padre_id: padre.proceso_id, area: 'Contabilidad'
  }, ENC);

  agregarFila_(db, 'SGC_PROCESO_PASOS', {
    paso_id: 'P1', proceso_id: hijo.proceso_id, numero: 1, nombre: 'Recepción',
    responsable: 'Contador', input: 'Facturas', actividades: 'Revisar',
    evidencias: 'F29', output: 'Declaración', activa: true
  });

  Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  const r5 = Riesgos.listar(db, {}, ENC).riesgos.find((x) => x.codigo === 'R5');
  actualizarFilaPorId_(db, 'SGC_RIESGOS', 'riesgo_id', r5.riesgo_id, { proceso_id: padre.proceso_id });

  const detPadre = Procesos.getDetalle(db, { proceso_id: padre.proceso_id }, ENC);
  assert.equal(detPadre.subprocesos.length, 1);
  assert.equal(detPadre.riesgos.length, 1);
  assert.equal(detPadre.riesgos[0].codigo, 'R5');
  assert.equal(detPadre.riesgos[0].banda, 'Alto', 'la valoración se calcula igual que en la matriz');

  const detHijo = Procesos.getDetalle(db, { proceso_id: hijo.proceso_id }, ENC);
  assert.equal(detHijo.pasos.length, 1);
  assert.equal(detHijo.pasos[0].responsable, 'Contador');
});

test('los pasos salen ordenados por número, no por orden de carga', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);
  const padre = mapaPorCodigo(db, 'PO-03');
  const p = Procesos.guardar(db, {
    nombre: 'Ingreso del trabajador', tipo: 'OPERATIVO', nivel: 'SERVICIO',
    proceso_padre_id: padre.proceso_id
  }, ENC);

  [3, 1, 2].forEach((n) => {
    agregarFila_(db, 'SGC_PROCESO_PASOS', {
      paso_id: 'P' + n, proceso_id: p.proceso_id, numero: n, nombre: 'Paso ' + n, activa: true
    });
  });

  const d = Procesos.getDetalle(db, { proceso_id: p.proceso_id }, ENC);
  assert.deepEqual(d.pasos.map((x) => x.numero), [1, 2, 3]);
});

// --- 4. Efecto en la matriz de cobertura ------------------------------------

test('4.4 pasa de faltante a parcial al cargar el mapa, y dice qué falta', () => {
  const db = crear();
  assert.equal(clausula(db, '4.4').estado, 'FALTANTE');

  Procesos.sembrarMapa(db, {}, ENC);

  const d = MatrizCobertura.getDetalle(db, { codigo: '4.4' }, ENC);
  assert.equal(d.estado, 'PARCIAL', 'el mapa sin responsables no cierra §4.4.2 e');
  assert.match(d.nota, /sin responsable asignado/i);
  assert.match(d.nota, /sin objetivo definido/i);
  assert.match(d.resumen, /14 procesos en el mapa/);
});

test('4.4 se cierra cuando cada proceso tiene responsable y objetivo', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);

  filas(db, 'SGC_PROCESOS').forEach((p) => {
    actualizarFilaPorId_(db, 'SGC_PROCESOS', 'proceso_id', p.proceso_id,
      { responsable_email: 'jefe@homepymes.cl', objetivo: 'Objetivo del proceso.' });
  });

  assert.equal(clausula(db, '4.4').estado, 'COMPLETO');
});

test('un mapa sin revisar en más de un año degrada 4.4', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);
  filas(db, 'SGC_PROCESOS').forEach((p) => {
    actualizarFilaPorId_(db, 'SGC_PROCESOS', 'proceso_id', p.proceso_id, {
      responsable_email: 'jefe@homepymes.cl', objetivo: 'Objetivo.',
      fecha_ultima_revision: '2024-01-10'
    });
  });

  assert.equal(clausula(db, '4.4').estado, 'PARCIAL');
  assert.match(MatrizCobertura.getDetalle(db, { codigo: '4.4' }, ENC).nota, /última revisión tiene \d+ meses/i);

  Procesos.registrarRevision(db, {}, ENC);
  assert.equal(clausula(db, '4.4').estado, 'COMPLETO');
});

test('8.1, 8.5 y 8.6 quedan en PARCIAL con la definición: falta la ejecución', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);
  const padre = mapaPorCodigo(db, 'PO-04');
  Procesos.guardar(db, {
    nombre: 'Declaración de Renta', tipo: 'OPERATIVO', nivel: 'SERVICIO',
    proceso_padre_id: padre.proceso_id
  }, ENC);

  ['8.1', '8.5', '8.6'].forEach((cod) => {
    const d = MatrizCobertura.getDetalle(db, { codigo: cod }, ENC);
    assert.equal(d.estado, 'PARCIAL',
      cod + ': tener escrito cómo se presta un servicio no demuestra que se haya prestado');
    // Sin SGC_PRESTACIONES (Fase 8, no portada) la nota apunta a lo que
    // falta HACER: registrar las prestaciones. El estado no cambia -- la
    // definición sola nunca cierra.
    assert.match(d.nota, /prestaci/i,
      cod + ': la nota tiene que decir qué falta, no dejarlo a la interpretación');
  });
});

test('sin procesos de servicio, 8.1 sigue faltante', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);
  assert.equal(clausula(db, '8.1').estado, 'FALTANTE',
    'el mapa solo no alcanza: 8.1 se apoya en los procesos de servicio');
});

test('un proceso de servicio sin pasos se avisa en la nota de 8.5', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);
  const padre = mapaPorCodigo(db, 'PO-03');
  Procesos.guardar(db, {
    nombre: 'Sin pasos todavía', tipo: 'OPERATIVO', nivel: 'SERVICIO',
    proceso_padre_id: padre.proceso_id
  }, ENC);

  assert.match(MatrizCobertura.getDetalle(db, { codigo: '8.5' }, ENC).nota, /sin pasos definidos/i);
});

// --- 5. Permisos -------------------------------------------------------------

test('solo el Encargado edita el mapa, pero cualquiera lo lee', () => {
  const db = crear();
  assert.equal(Procesos.sembrarMapa(db, {}, OPERATIVO)._forbidden, true);
  assert.equal(filas(db, 'SGC_PROCESOS').length, 0);

  Procesos.sembrarMapa(db, {}, ENC);
  const d = Procesos.listar(db, {}, OPERATIVO);
  assert.equal(d.puede_gestionar, false);
  assert.equal(d.mapa.length, 14, 'saber cómo opera la organización es toma de conciencia (§7.3)');
});

test('el nombre y un tipo válido son obligatorios', () => {
  const db = crear();
  assert.match(Procesos.guardar(db, { tipo: 'OPERATIVO' }, ENC).message, /nombre/i);
  assert.match(Procesos.guardar(db, { nombre: 'X', tipo: 'OTRO' }, ENC).message,
    /estratégico, operativo o de apoyo/i);
});
