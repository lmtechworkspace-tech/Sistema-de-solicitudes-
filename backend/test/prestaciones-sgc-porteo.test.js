'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 v11.0 Fase 8 (evidencia de
 * servicios prestados, §8.1/§8.5/§8.6/§8.7) -- mismos escenarios de
 * prestaciones.test.js, corridos contra backend/logica/prestacionesSgc.js,
 * incluido su efecto en backend/logica/matrizCoberturaSgc.js (que sube
 * evaluarPrestaciones_ y evaluarSalidasNoConformes_ a su lógica completa
 * al fin en este incremento -- último de las 8 fases v11).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Procesos = require('../logica/procesosSgc');
const Prestaciones = require('../logica/prestacionesSgc');
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
  agregarFila_(db, 'CAT_CLIENTES', {
    cliente_id: 'CLI-1', razon_social: 'Constructora Andes SpA', rut: '76.111.111-1',
    codigo_cliente: 'C001', contacto: 'Ana', correo: 'a@andes.cl', telefono: '', representante_legal: '',
    direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true
  });
  agregarFila_(db, 'CAT_CLIENTES', {
    cliente_id: 'CLI-2', razon_social: 'Pyme Sur Ltda', rut: '77.222.222-2',
    codigo_cliente: 'C002', contacto: 'Luis', correo: 'l@sur.cl', telefono: '', representante_legal: '',
    direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true
  });
  return db;
}
function conProcesos(db) {
  Procesos.sembrarMapa(db, {}, ENC);
  const padre = Procesos.listar(db, {}, ENC).mapa.find((p) => p.codigo === 'PO-04');
  const a = Procesos.guardar(db, {
    nombre: 'Proceso Mensual de IVA', tipo: 'OPERATIVO', nivel: 'SERVICIO', proceso_padre_id: padre.proceso_id
  }, ENC);
  const b = Procesos.guardar(db, {
    nombre: 'Declaración de Renta', tipo: 'OPERATIVO', nivel: 'SERVICIO', proceso_padre_id: padre.proceso_id
  }, ENC);
  // Cada proceso de servicio con al menos un paso: §8.5.1 a) pide
  // información documentada que defina cómo se presta, y sin eso la
  // cláusula no cierra aunque haya prestaciones.
  [a, b].forEach((p, i) => {
    agregarFila_(db, 'SGC_PROCESO_PASOS', {
      paso_id: 'PASO-' + i, proceso_id: p.proceso_id, numero: 1, nombre: 'Recepción',
      responsable: 'Asistente', input: 'Solicitud', actividades: 'Procesar',
      evidencias: 'Formulario', output: 'Entrega', activa: true
    });
  });
  return { padre, srv1: a.proceso_id, srv2: b.proceso_id };
}
function registrar(db, extra) {
  return Prestaciones.registrar(db, Object.assign({
    cliente_id: 'CLI-1', fecha_prestacion: '2026-08-05',
    responsable_email: 'asistente@homepymes.cl', evidencia: 'F29 folio 12345'
  }, extra || {}), ENC);
}
function clausula(db, codigo) {
  return MatrizCobertura.listar(db, {}, ENC).clausulas.find((c) => c.codigo === codigo);
}

// --- 1. Escala ---------------------------------------------------------------

test('nada se pre-genera: la hoja arranca vacía aunque haya clientes y procesos', () => {
  const db = crear();
  conProcesos(db);

  assert.equal(filas(db, 'SGC_PRESTACIONES').length, 0,
    '2 clientes x 2 procesos x 12 meses serían 48 filas vacías, y con los datos reales 24.000 al año');
  assert.equal(Prestaciones.listar(db, {}, ENC).prestaciones.length, 0);
});

test('el listado sin filtro se acota y lo dice', () => {
  const db = crear();
  const p = conProcesos(db);
  for (let i = 1; i <= 120; i++) {
    registrar(db, {
      proceso_id: p.srv1, periodo: '2026-M' + String(i).padStart(2, '0'),
      fecha_prestacion: '2026-08-' + String((i % 28) + 1).padStart(2, '0')
    });
  }

  const sinFiltro = Prestaciones.listar(db, {}, ENC);
  assert.equal(sinFiltro.acotada, true);
  assert.equal(sinFiltro.prestaciones.length, sinFiltro.tope);
  assert.ok(sinFiltro.total_filtrado > sinFiltro.tope, 'el total real se informa aunque no se devuelva entero');

  const conFiltro = Prestaciones.listar(db, { periodo: '2026-M05' }, ENC);
  assert.equal(conFiltro.acotada, false);
  assert.equal(conFiltro.prestaciones.length, 1);
});

test('el módulo mide su propio volumen y avisa antes de que duela', () => {
  const db = crear();
  const p = conProcesos(db);
  registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });

  const v = Prestaciones.listar(db, {}, ENC).volumen;
  assert.equal(v.filas, 1);
  assert.equal(v.supera_umbral, false);
  assert.equal(v.aviso, '');
  assert.deepEqual(v.por_anio, [{ anio: '2026', total: 1 }]);
});

// --- 2. El cliente no se duplica --------------------------------------------

test('el cliente sale de CAT_CLIENTES y no se acepta uno inventado', () => {
  const db = crear();
  const p = conProcesos(db);

  const r = registrar(db, { cliente_id: 'NO-EXISTE', proceso_id: p.srv1 });
  assert.equal(r.ok, false);
  assert.match(r.message, /no está en el catálogo/i);

  assert.equal(registrar(db, { proceso_id: p.srv1 }).ok, true);
  // El nombre queda desnormalizado, como en SOLICITUDES: el listado no puede
  // depender de un cruce por cada fila.
  assert.equal(Prestaciones.listar(db, {}, ENC).prestaciones[0].cliente_nombre, 'Constructora Andes SpA');
});

test('el listado ofrece los clientes del catálogo, no una lista propia', () => {
  const db = crear();
  conProcesos(db);
  const d = Prestaciones.listar(db, {}, ENC);
  assert.deepEqual(d.clientes.map((c) => c.nombre).sort(), ['Constructora Andes SpA', 'Pyme Sur Ltda']);
});

// --- 3. Reglas del registro --------------------------------------------------

test('solo se registran procesos de SERVICIO, no los del mapa', () => {
  const db = crear();
  const p = conProcesos(db);
  const r = registrar(db, { proceso_id: p.padre.proceso_id });
  assert.equal(r.ok, false);
  assert.match(r.message, /procesos de SERVICIO/i);
});

test('un servicio recurrente no admite dos prestaciones del mismo período', () => {
  const db = crear();
  const p = conProcesos(db);
  assert.equal(registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' }).ok, true);

  const r = registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });
  assert.equal(r.ok, false);
  assert.match(r.message, /Ya hay una prestación/i);

  // Otro cliente en el mismo período sí.
  assert.equal(registrar(db, { cliente_id: 'CLI-2', proceso_id: p.srv1, periodo: '2026-M08' }).ok, true);
});

test('un servicio puntual se registra varias veces sin período', () => {
  const db = crear();
  const p = conProcesos(db);
  // Los DOC-10 a 13 distinguen "Mensual" de "Puntual": forzar un período a
  // un servicio puntual obligaría a inventarlo.
  assert.equal(registrar(db, { proceso_id: p.srv2, fecha_prestacion: '2026-08-01' }).ok, true);
  assert.equal(registrar(db, { proceso_id: p.srv2, fecha_prestacion: '2026-08-15' }).ok, true);
  assert.equal(Prestaciones.listar(db, { proceso_id: p.srv2 }, ENC).prestaciones.length, 2);
});

test('faltan datos obligatorios y lo dice cuál', () => {
  const db = crear();
  const p = conProcesos(db);
  assert.match(Prestaciones.registrar(db, {}, ENC).message, /qué cliente/i);
  assert.match(registrar(db, { proceso_id: '' }).message, /qué proceso/i);
  assert.match(registrar(db, { proceso_id: p.srv1, fecha_prestacion: '' }).message, /fecha/i);
  assert.match(registrar(db, { proceso_id: p.srv1, responsable_email: '' }).message, /quién prestó/i);
});

// --- 4. Liberación (§8.6) ----------------------------------------------------

test('la liberación traza a la persona que autoriza y cuándo', () => {
  const db = crear();
  const p = conProcesos(db);
  const r = registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });

  const lib = Prestaciones.liberar(db, {
    prestacion_id: r.prestacion_id, liberado_por: 'contador@homepymes.cl', fecha_liberacion: '2026-08-06'
  }, ENC);
  assert.equal(lib.ok, true);

  const x = Prestaciones.listar(db, {}, ENC).prestaciones[0];
  assert.equal(x.estado, 'LIBERADO');
  assert.equal(x.liberado_por, 'contador@homepymes.cl');
  assert.equal(x.fecha_liberacion, '2026-08-06');
  assert.equal(x.liberada_por_el_mismo, false);
});

test('liberar uno mismo lo que uno prestó se permite pero se avisa y se ve', () => {
  const db = crear();
  const p = conProcesos(db);
  const r = registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });

  // No se bloquea: ningún documento lo prohíbe. Pero el DOC-01 dice que
  // libera la jefatura del área, así que la debilidad queda visible.
  const lib = Prestaciones.liberar(db, { prestacion_id: r.prestacion_id, liberado_por: 'asistente@homepymes.cl' }, ENC);
  assert.equal(lib.ok, true);
  assert.match(lib.message, /quien liberó es quien prestó/i);

  assert.equal(Prestaciones.listar(db, {}, ENC).prestaciones[0].liberada_por_el_mismo, true);
  assert.match(MatrizCobertura.getDetalle(db, { codigo: '8.6' }, ENC).nota, /misma persona que prestó el servicio/i);
});

test('no se libera dos veces', () => {
  const db = crear();
  const p = conProcesos(db);
  const r = registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });
  Prestaciones.liberar(db, { prestacion_id: r.prestacion_id, liberado_por: 'c@h.cl' }, ENC);
  assert.match(Prestaciones.liberar(db, { prestacion_id: r.prestacion_id, liberado_por: 'c@h.cl' }, ENC).message,
    /ya está liberada/i);
});

// --- 5. Salidas no conformes (§8.7) -----------------------------------------

test('una salida no conforme necesita motivo y deja de estar liberada', () => {
  const db = crear();
  const p = conProcesos(db);
  const r = registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });
  Prestaciones.liberar(db, { prestacion_id: r.prestacion_id, liberado_por: 'contador@homepymes.cl' }, ENC);

  assert.match(Prestaciones.marcarNoConforme(db, { prestacion_id: r.prestacion_id }, ENC).message, /Describe en qué no conformó/i);

  Prestaciones.marcarNoConforme(db, { prestacion_id: r.prestacion_id, observaciones: 'Se declaró con un RUT equivocado.' }, ENC);

  const x = Prestaciones.listar(db, {}, ENC).prestaciones[0];
  assert.equal(x.estado, 'NO_CONFORME');
  assert.equal(x.liberado_por, '', '§8.7 pide no entregar una salida no conforme hasta corregirla');
});

test('una salida no conforme no se libera', () => {
  const db = crear();
  const p = conProcesos(db);
  const r = registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });
  Prestaciones.marcarNoConforme(db, { prestacion_id: r.prestacion_id, observaciones: 'error' }, ENC);

  const lib = Prestaciones.liberar(db, { prestacion_id: r.prestacion_id, liberado_por: 'c@h.cl' }, ENC);
  assert.equal(lib.ok, false);
  assert.match(lib.message, /primero hay que tratarla/i);
});

test('la salida no conforme deriva en una NC por el camino que ya existía', () => {
  const db = crear();
  const p = conProcesos(db);
  const r = registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });

  assert.match(Prestaciones.abrirNoConformidad(db, { prestacion_id: r.prestacion_id }, ENC).message, /Primero marca la prestación/i);

  Prestaciones.marcarNoConforme(db, { prestacion_id: r.prestacion_id, observaciones: 'RUT equivocado' }, ENC);
  const nc = Prestaciones.abrirNoConformidad(db, { prestacion_id: r.prestacion_id, responsable_email: 'contador@homepymes.cl' }, ENC);
  assert.equal(nc.ok, true);

  const fila = filas(db, 'SGC_NC').find((n) => n.nc_id === nc.nc_id);
  assert.equal(fila.fuente, 'PROCESO', 'la fuente ya existía en el catálogo: no hizo falta inventar una');
  assert.equal(fila.origen_ref, r.prestacion_id);
  assert.equal(fila.referencia_normativa, '8.7');
  assert.match(fila.descripcion, /Salida no conforme/);

  assert.match(Prestaciones.abrirNoConformidad(db, { prestacion_id: r.prestacion_id }, ENC).message, /ya tiene su no conformidad/i);
});

// --- 6. Efecto en la matriz --------------------------------------------------

test('8.1 y 8.5 pasan de parcial a completo cuando todo tiene evidencia', () => {
  const db = crear();
  const p = conProcesos(db);

  assert.match(MatrizCobertura.getDetalle(db, { codigo: '8.5' }, ENC).nota, /no demuestra que se haya prestado/i);

  registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });
  // Falta el segundo proceso de servicio: la cláusula no puede cerrarse con
  // un catálogo de procesos y prestaciones en uno solo.
  assert.match(MatrizCobertura.getDetalle(db, { codigo: '8.5' }, ENC).nota, /sin ninguna prestación registrada/i);

  registrar(db, { proceso_id: p.srv2, fecha_prestacion: '2026-08-10' });
  assert.equal(clausula(db, '8.5').estado, 'COMPLETO');
  assert.equal(clausula(db, '8.1').estado, 'COMPLETO');
});

test('una prestación sin evidencia mantiene 8.5 en parcial', () => {
  const db = crear();
  const p = conProcesos(db);
  registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });
  registrar(db, { proceso_id: p.srv2, fecha_prestacion: '2026-08-10', evidencia: '' });

  const d = MatrizCobertura.getDetalle(db, { codigo: '8.5' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /sin evidencia/i);
});

test('8.7 mide salidas no conformes, no las NC del sistema', () => {
  const db = crear();
  const p = conProcesos(db);

  // Sin prestaciones no se puede afirmar que las salidas se controlan.
  assert.match(MatrizCobertura.getDetalle(db, { codigo: '8.7' }, ENC).nota, /Sin registro de servicios|Registra las prestaciones/i);

  registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });
  const d = MatrizCobertura.getDetalle(db, { codigo: '8.7' }, ENC);
  assert.equal(d.estado, 'COMPLETO');
  assert.match(d.nota, /que no haya hallazgos es un resultado, no una omisión/i,
    'una ausencia de hallazgos no es lo mismo que no controlar');
});

test('una salida no conforme sin NC deja 8.7 en parcial', () => {
  const db = crear();
  const p = conProcesos(db);
  const r = registrar(db, { proceso_id: p.srv1, periodo: '2026-M08' });
  Prestaciones.marcarNoConforme(db, { prestacion_id: r.prestacion_id, observaciones: 'error' }, ENC);

  let d = MatrizCobertura.getDetalle(db, { codigo: '8.7' }, ENC);
  assert.equal(d.estado, 'PARCIAL');
  assert.match(d.nota, /sin no conformidad abierta/i);

  Prestaciones.abrirNoConformidad(db, { prestacion_id: r.prestacion_id, responsable_email: 'c@h.cl' }, ENC);
  assert.equal(clausula(db, '8.7').estado, 'COMPLETO');
});

// --- 7. Permisos -------------------------------------------------------------

// Etapa A del control interno (auditoría de procesos 30-09-2026): el área
// registra y su jefatura libera; hasta aquí todo pasaba por el Encargado.
const OTRA_AREA = { email: 'rrhh@homepymes.cl', nombre: 'Asistente RR.HH.', rol: 'DEV' };
const JEFA = { email: 'jefa.conta@homepymes.cl', nombre: 'Jefa Contabilidad', rol: 'DEV' };
const SIN_ROL = { email: 'nadie@homepymes.cl', nombre: 'Sin rol', rol: 'DEV' };
function conAreas(db) {
  Calidad.gestionarRol(db, { usuario_email: OTRA_AREA.email, rol_sgc: 'OPERATIVO', area_id: 'RRHH' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: JEFA.email, rol_sgc: 'JEFATURA_AREA', area_id: 'CONTABILIDAD' }, CTX_ADM);
}

test('sin rol del SGC no se ve ni se registra nada', () => {
  const db = crear();
  const p = conProcesos(db);
  assert.equal(Prestaciones.listar(db, {}, SIN_ROL)._forbidden, true);
  assert.equal(Prestaciones.registrar(db, {
    cliente_id: 'CLI-1', proceso_id: p.srv1, fecha_prestacion: '2026-08-05', responsable_email: 'x@h.cl'
  }, SIN_ROL)._forbidden, true);
  assert.equal(filas(db, 'SGC_PRESTACIONES').length, 0);
});

test('el personal del área registra los servicios de su área y solo los ve a ellos', () => {
  const db = crear();
  conAreas(db);
  const p = conProcesos(db);
  // PO-04 es 'Contabilidad' en el mapa y el rol dice 'CONTABILIDAD': misma área.
  const r = Prestaciones.registrar(db, { cliente_id: 'CLI-1', proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-10', responsable_email: OPERATIVO.email }, OPERATIVO);
  assert.equal(r.ok, true);
  const vista = Prestaciones.listar(db, {}, OPERATIVO);
  assert.equal(vista.puede_registrar, true);
  assert.equal(vista.puede_liberar, false, 'el personal operativo registra pero no libera');
  assert.equal(vista.prestaciones.length, 1);

  // RR.HH. no ve los servicios de Contabilidad ni puede registrarlos.
  const otra = Prestaciones.listar(db, {}, OTRA_AREA);
  assert.equal(otra.procesos.length, 0);
  assert.equal(otra.prestaciones.length, 0);
  assert.equal(Prestaciones.registrar(db, { cliente_id: 'CLI-2', proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-10', responsable_email: OTRA_AREA.email }, OTRA_AREA)._forbidden, true);
  assert.equal(Calidad.seccionesVisiblesSgc_(db, OPERATIVO).servicios, true);
  assert.equal(Calidad.seccionesVisiblesSgc_(db, SIN_ROL).servicios, false);
});

test('registro por lote: un mes completo de una vez, sin duplicar lo ya registrado', () => {
  const db = crear();
  const p = conProcesos(db);
  Prestaciones.registrar(db, { cliente_id: 'CLI-1', proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-10', responsable_email: OPERATIVO.email }, OPERATIVO);

  const r = Prestaciones.registrarLote(db, {
    proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-20',
    cliente_ids: ['CLI-1', 'CLI-2', 'CLI-2', 'NO-EXISTE'], evidencia: 'https://drive.google.com/matriz-iva'
  }, OPERATIVO);
  assert.equal(r.ok, true);
  assert.equal(r.creadas, 1);
  assert.deepEqual(r.omitidas.map((o) => o.motivo), ['Ya estaba registrado en ese período.', 'No está en el catálogo de clientes.']);
  const nueva = filas(db, 'SGC_PRESTACIONES').find((x) => x.cliente_id === 'CLI-2');
  assert.equal(nueva.responsable_email, OPERATIVO.email, 'sin responsable explícito, prestó quien registra');
  assert.equal(nueva.evidencia, 'https://drive.google.com/matriz-iva');
  assert.equal(nueva.estado, 'PRESTADO');

  assert.match(Prestaciones.registrarLote(db, { proceso_id: p.srv1, periodo: '', fecha_prestacion: '2026-09-20', cliente_ids: ['CLI-1'] }, OPERATIVO).message, /período/);
  assert.match(Prestaciones.registrarLote(db, { proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-20', cliente_ids: [] }, OPERATIVO).message, /al menos un cliente/);
  const muchos = Array.from({ length: 301 }, (_, i) => 'C' + i);
  assert.match(Prestaciones.registrarLote(db, { proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-20', cliente_ids: muchos }, OPERATIVO).message, /máximo/);
});

test('libera la jefatura del área, a su nombre y nunca lo que ella misma prestó', () => {
  const db = crear();
  conAreas(db);
  const p = conProcesos(db);
  Prestaciones.registrarLote(db, { proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-20', cliente_ids: ['CLI-1'] }, OPERATIVO);
  Prestaciones.registrarLote(db, { proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-20', cliente_ids: ['CLI-2'], responsable_email: JEFA.email }, OPERATIVO);
  const ids = filas(db, 'SGC_PRESTACIONES').map((x) => x.prestacion_id);

  // El operativo no libera.
  assert.equal(Prestaciones.liberarLote(db, { prestacion_ids: ids }, OPERATIVO)._forbidden, true);

  // La jefatura intenta liberar a nombre de otro: queda a su propio nombre.
  const r = Prestaciones.liberarLote(db, { prestacion_ids: ids, liberado_por: 'otro@homepymes.cl' }, JEFA);
  assert.equal(r.ok, true);
  assert.equal(r.liberadas, 1);
  assert.equal(r.omitidas.length, 1);
  assert.match(r.omitidas[0].motivo, /La prestaste tú/);
  const lib = filas(db, 'SGC_PRESTACIONES').find((x) => x.cliente_id === 'CLI-1');
  assert.equal(lib.estado, 'LIBERADO');
  assert.equal(lib.liberado_por, JEFA.email);

  // Lo que prestó la jefatura lo libera el Encargado del SGC.
  const propia = filas(db, 'SGC_PRESTACIONES').find((x) => x.cliente_id === 'CLI-2');
  assert.match(Prestaciones.liberar(db, { prestacion_id: propia.prestacion_id }, JEFA).message, /La prestaste tú/);
  assert.equal(Prestaciones.liberar(db, { prestacion_id: propia.prestacion_id }, ENC).ok, true);

  // Una jefatura de otra área no libera servicios ajenos.
  Calidad.gestionarRol(db, { usuario_email: OTRA_AREA.email, rol_sgc: 'JEFATURA_AREA', area_id: 'RRHH' }, CTX_ADM);
  Prestaciones.registrarLote(db, { proceso_id: p.srv2, periodo: '2026-M09', fecha_prestacion: '2026-09-20', cliente_ids: ['CLI-1'] }, OPERATIVO);
  const ajena = filas(db, 'SGC_PRESTACIONES').find((x) => x.proceso_id === p.srv2);
  assert.equal(Prestaciones.liberar(db, { prestacion_id: ajena.prestacion_id }, OTRA_AREA)._forbidden, true);
});

test('la liberación no acepta fecha futura', () => {
  const db = crear();
  conAreas(db);
  const p = conProcesos(db);
  const r = Prestaciones.registrar(db, { cliente_id: 'CLI-1', proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-10', responsable_email: OPERATIVO.email }, OPERATIVO);
  assert.match(Prestaciones.liberar(db, { prestacion_id: r.prestacion_id, fecha_liberacion: '2999-01-01' }, JEFA).message, /fecha futura/);
});

test('quien registró por error lo anula mientras no esté liberado', () => {
  const db = crear();
  conAreas(db);
  const p = conProcesos(db);
  const a = Prestaciones.registrar(db, { cliente_id: 'CLI-1', proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-10', responsable_email: OPERATIVO.email }, OPERATIVO);
  const b = Prestaciones.registrar(db, { cliente_id: 'CLI-2', proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-10', responsable_email: OPERATIVO.email }, OPERATIVO);
  assert.equal(Prestaciones.anular(db, { prestacion_id: a.prestacion_id }, OPERATIVO).ok, true);
  Prestaciones.liberar(db, { prestacion_id: b.prestacion_id }, JEFA);
  assert.equal(Prestaciones.anular(db, { prestacion_id: b.prestacion_id }, OPERATIVO)._forbidden, true,
    'liberada ya es evidencia: solo la anula el Encargado');
});

test('la jefatura marca la salida no conforme; la NC la abre el Encargado', () => {
  const db = crear();
  conAreas(db);
  const p = conProcesos(db);
  const r = Prestaciones.registrar(db, { cliente_id: 'CLI-1', proceso_id: p.srv1, periodo: '2026-M09', fecha_prestacion: '2026-09-10', responsable_email: OPERATIVO.email }, OPERATIVO);
  assert.equal(Prestaciones.marcarNoConforme(db, { prestacion_id: r.prestacion_id, observaciones: 'F29 declarado con base errónea' }, OPERATIVO)._forbidden, true);
  assert.equal(Prestaciones.marcarNoConforme(db, { prestacion_id: r.prestacion_id, observaciones: 'F29 declarado con base errónea' }, JEFA).ok, true);
  assert.equal(Prestaciones.abrirNoConformidad(db, { prestacion_id: r.prestacion_id }, JEFA)._forbidden, true);
  assert.equal(Prestaciones.abrirNoConformidad(db, { prestacion_id: r.prestacion_id }, ENC).ok, true);
});

test('las claves de área del rol y los nombres del mapa son la misma área', () => {
  assert.equal(Prestaciones.claveArea_('Recursos Humanos'), Prestaciones.claveArea_('RRHH'));
  assert.equal(Prestaciones.claveArea_('Contabilidad'), Prestaciones.claveArea_('CONTABILIDAD'));
  assert.equal(Prestaciones.claveArea_('Prevención de Riesgos'), Prestaciones.claveArea_('PREVENCION'));
  assert.notEqual(Prestaciones.claveArea_('Contabilidad'), Prestaciones.claveArea_('RRHH'));
});
