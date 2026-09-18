'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 v11.0 Fase 7 (tablero, el centro de
 * control del SGC) -- mismos escenarios de tablero.test.js, corridos
 * contra backend/logica/tableroSgc.js.
 *
 * NO se portan los escenarios de tablero-sgc-cache.test.js: la capa de
 * CacheService no se porta (mismo criterio que Dashboard/Sesiones -- ver
 * el comentario en tableroSgc.js), así que no hay nada de ese archivo que
 * probar en Node.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, actualizarFilaPorId_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Alcance = require('../logica/alcanceSgc');
const Contexto = require('../logica/contextoSgc');
const Riesgos = require('../logica/riesgosSgc');
const Procesos = require('../logica/procesosSgc');
const Tablero = require('../logica/tableroSgc');
const MatrizCobertura = require('../logica/matrizCoberturaSgc');

const TABLAS = Object.keys(COLUMNAS);
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* hojas sin columnas */ } });
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
function crear() {
  const db = db_();
  sembrarRoles(db);
  return db;
}
function diasDesdeHoy(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }
function alertaPorTitulo(t, re) { return t.alertas.filter((a) => re.test(a.titulo))[0]; }

// --- 1. Un solo número -------------------------------------------------------

test('el porcentaje del tablero ES el de la matriz de cobertura', () => {
  const db = crear();
  Alcance.guardar(db, Alcance.obtener(db, {}, ENC).propuesta, ENC);
  Contexto.sembrarFoda(db, {}, ENC);
  Procesos.sembrarMapa(db, {}, ENC);

  const t = Tablero.resumen(db, {}, ENC);
  const m = MatrizCobertura.listar(db, {}, ENC);

  assert.equal(t.salud.pct, m.resumen.pct_listo,
    'dos cifras distintas llamadas "avance del SGC" harían que nadie confíe en ninguna');
  assert.equal(t.salud.aplicables, m.resumen.aplicables);
});

test('el aviso de que es un indicador interno viaja siempre', () => {
  const db = crear();
  const t = Tablero.resumen(db, {}, ENC);
  assert.match(t.salud.aviso, /indicador interno de gestión/i);
  assert.match(t.salud.aviso, /no es un porcentaje oficial de certificación/i);
});

test('la salud se agrupa por los siete capítulos de la norma', () => {
  const db = crear();
  const t = Tablero.resumen(db, {}, ENC);

  assert.deepEqual(t.salud.capitulos.map((c) => c.numero), ['4', '5', '6', '7', '8', '9', '10']);
  const suma = t.salud.capitulos.reduce((acc, c) => acc + c.total, 0);
  assert.equal(suma, 28);
});

test('una cláusula excluida sale del denominador de su capítulo', () => {
  const db = crear();
  Alcance.guardar(db, Alcance.obtener(db, {}, ENC).propuesta, ENC);
  const antes = Tablero.resumen(db, {}, ENC).salud.capitulos.filter((c) => c.numero === '8')[0];

  Alcance.guardarExclusion(db, {
    clausula: '8.3', titulo: 'Diseño y desarrollo', justificacion: 'No se diseñan servicios nuevos.'
  }, ENC);

  const despues = Tablero.resumen(db, {}, ENC).salud.capitulos.filter((c) => c.numero === '8')[0];
  assert.equal(despues.no_aplica, 1);
  assert.equal(despues.aplicables, antes.aplicables - 1);
  assert.equal(despues.total, antes.total, 'sigue en el catálogo, solo sale del cálculo');
});

// --- 2. Alertas accionables --------------------------------------------------

test('un sistema vacío avisa de lo que falta, y cada alerta sabe a dónde lleva', () => {
  const db = crear();
  const t = Tablero.resumen(db, {}, ENC);

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
  const db = crear();
  const t = Tablero.resumen(db, {}, ENC);
  const orden = { CRITICA: 0, ALTA: 1, MEDIA: 2 };
  const severidades = t.alertas.map((a) => orden[a.severidad]);
  assert.deepEqual(severidades, severidades.slice().sort((a, b) => a - b));
});

test('una NC con un plazo pasado es crítica; una en curso, no', () => {
  const db = crear();
  agregarFila_(db, 'SGC_NC', {
    nc_id: 'NC1', correlativo: 'NC-2026-01', estado: 'EN_CURSO',
    correccion_plazo: diasDesdeHoy(-5), activa: true
  });
  agregarFila_(db, 'SGC_NC', {
    nc_id: 'NC2', correlativo: 'NC-2026-02', estado: 'EN_CURSO',
    correccion_plazo: diasDesdeHoy(10), activa: true
  });

  const t = Tablero.resumen(db, {}, ENC);
  const vencidas = alertaPorTitulo(t, /No conformidades con plazo vencido/i);
  assert.equal(vencidas.total, 1);
  assert.equal(vencidas.severidad, 'CRITICA');

  const abiertas = alertaPorTitulo(t, /No conformidades abiertas/i);
  assert.equal(abiertas.total, 1, 'la vencida no se cuenta dos veces');
});

test('una NC cerrada no genera alerta aunque tenga plazos viejos', () => {
  const db = crear();
  agregarFila_(db, 'SGC_NC', {
    nc_id: 'NC1', correlativo: 'NC-2026-01', estado: 'CERRADA',
    correccion_plazo: diasDesdeHoy(-90), accion_plazo: diasDesdeHoy(-60), activa: true
  });
  const t = Tablero.resumen(db, {}, ENC);
  assert.equal(alertaPorTitulo(t, /No conformidades/i), undefined);
});

test('un documento con la revisión vencida es crítico; uno próximo, medio', () => {
  const db = crear();
  Calidad.crearDocumento(db, { codigo: 'PRO-01', nombre: 'Viejo', tipo: 'PRO', visibilidad: 'TODOS' }, ENC);
  Calidad.crearDocumento(db, { codigo: 'PRO-02', nombre: 'Por vencer', tipo: 'PRO', visibilidad: 'TODOS' }, ENC);
  const docs = filas(db, 'SGC_DOCUMENTOS');
  actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', docs[0].documento_id, { proxima_revision: diasDesdeHoy(-1) });
  actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', docs[1].documento_id, { proxima_revision: diasDesdeHoy(20) });

  const t = Tablero.resumen(db, {}, ENC);
  assert.equal(alertaPorTitulo(t, /revisión vencida/i).severidad, 'CRITICA');
  assert.equal(alertaPorTitulo(t, /Documentos por revisar/i).severidad, 'MEDIA');
});

test('un riesgo alto sin revalorar es crítico; uno ya revalorado no aparece', () => {
  const db = crear();
  Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  // El DOC-08 trae todos los riesgos con revaloración, así que no hay alerta.
  assert.equal(alertaPorTitulo(Tablero.resumen(db, {}, ENC), /sin revalorar/i), undefined);

  // Se le quita la revaloración a uno crítico.
  const r3 = filas(db, 'SGC_RIESGOS').filter((r) => r.codigo === 'R3')[0];
  actualizarFilaPorId_(db, 'SGC_RIESGOS', 'riesgo_id', r3.riesgo_id, { probabilidad_residual: '', impacto_residual: '' });

  const a = alertaPorTitulo(Tablero.resumen(db, {}, ENC), /sin revalorar/i);
  assert.equal(a.total, 1);
  assert.equal(a.severidad, 'CRITICA');
  assert.equal(a.seccion, 'riesgos');
});

test('los procesos del mapa sin responsable se avisan con su número real', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);
  assert.equal(alertaPorTitulo(Tablero.resumen(db, {}, ENC), /sin responsable/i).total, 14);

  filas(db, 'SGC_PROCESOS').slice(0, 4).forEach((p) => {
    actualizarFilaPorId_(db, 'SGC_PROCESOS', 'proceso_id', p.proceso_id, { responsable_email: 'jefe@homepymes.cl' });
  });
  assert.equal(alertaPorTitulo(Tablero.resumen(db, {}, ENC), /sin responsable/i).total, 10);
});

test('un proveedor nunca evaluado cuenta como vencido', () => {
  const db = crear();
  agregarFila_(db, 'SGC_PROVEEDORES', { proveedor_id: 'P1', nombre: 'Plataforma X', activa: true });
  const a = alertaPorTitulo(Tablero.resumen(db, {}, ENC), /sin evaluación vigente/i);
  assert.equal(a.total, 1, 'es el mismo criterio que usa el módulo de proveedores desde la Fase 5a');
});

// --- 3. Hitos ----------------------------------------------------------------

test('los hitos son solo futuros y salen en orden', () => {
  const db = crear();
  agregarFila_(db, 'SGC_NC', {
    nc_id: 'NC1', correlativo: 'NC-01', estado: 'EN_CURSO',
    correccion_plazo: diasDesdeHoy(30), accion_plazo: diasDesdeHoy(10),
    eficacia_plazo: diasDesdeHoy(-5), activa: true
  });

  const t = Tablero.resumen(db, {}, ENC);
  const fechas = t.hitos.map((h) => h.fecha);
  assert.deepEqual(fechas, fechas.slice().sort(), 'un timeline desordenado no sirve para planificar');
  assert.ok(fechas.every((f) => f >= t.fecha), 'lo vencido va en alertas, no en próximos hitos');
  assert.equal(fechas.length, 2);
});

// --- 4. Permisos y conteos ---------------------------------------------------

test('el tablero es de gobierno: un operativo no lo ve', () => {
  const db = crear();
  assert.equal(Tablero.resumen(db, {}, OPERATIVO)._forbidden, true);
  assert.equal(Tablero.resumen(db, {}, ENC)._forbidden, undefined);
});

test('el tablero trae el mapa de secciones para pintar la barra', () => {
  const db = crear();
  const t = Tablero.resumen(db, {}, ENC);
  assert.ok(t.secciones_visibles);
  assert.equal(t.secciones_visibles.tablero, true);
  assert.equal(t.secciones_visibles.documentos, true);
});

test('los conteos reflejan lo que hay cargado', () => {
  const db = crear();
  Procesos.sembrarMapa(db, {}, ENC);
  Riesgos.sembrarDesdeDoc08(db, {}, ENC);
  Calidad.sembrarDocumentosExternos(db, {}, ENC);

  const c = Tablero.resumen(db, {}, ENC).conteos;
  assert.equal(c.procesos_mapa, 14);
  assert.equal(c.riesgos, 11, 'las oportunidades no se cuentan como riesgos');
  assert.equal(c.riesgos_altos, 6);
  assert.equal(c.documentos_externos, 6);
  assert.equal(c.documentos_vigentes, 6);
});

test('la portada muestra el alcance declarado cuando existe', () => {
  const db = crear();
  assert.equal(Tablero.resumen(db, {}, ENC).alcance, null);

  Alcance.guardar(db, Alcance.obtener(db, {}, ENC).propuesta, ENC);
  const a = Tablero.resumen(db, {}, ENC).alcance;
  assert.match(a.razon_social, /Asesorías Integrales AyS SpA/);
  assert.equal(a.norma, 'ISO 9001:2015');
  assert.equal(a.version, '01');
});
