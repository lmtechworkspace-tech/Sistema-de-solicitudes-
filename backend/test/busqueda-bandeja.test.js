'use strict';

/**
 * v6.3: busqueda unificada de la Bandeja de trabajo.
 *
 * El problema que resuelve: el buscador tenia DOS definiciones. En el
 * navegador miraba varios campos; en el servidor, el mismo texto se
 * interpretaba solo como `solicitante`. Escribir "Item" mostraba resultados y
 * pulsar "Actualizar" los hacia desaparecer.
 *
 * Ahora hay una unica definicion (textoBusquedaSolicitud_) que:
 *   - usa coincideFiltros_ para filtrar en el servidor, y
 *   - viaja en recientes[].texto_busqueda para que el cliente compare contra
 *     LA MISMA cadena.
 *
 * Estos tests fijan esa equivalencia: si alguien cambia los campos buscables
 * en un lado y no en el otro, el ultimo test falla.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  return ctx;
}

function seedSolicitud(ctx, overrides, tituloItem) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', empresa_nombre: 'HomePymes',
      plataforma: 'INT_GDE', plataforma_nombre: 'Intranet GDE', modulo: 'MOD_FACTURACION',
      tipo: 'ERR', solicitante_nombre: 'Juan Pérez', solicitante_cargo: 'Analista',
      solicitante_email: 'juan@homepymes.cl',
      es_cliente: false, empresa_cliente: '', cliente_mandante: '', cliente_obra: '',
      contacto_cliente: '', correo_cliente: '', telefono_cliente: '', urgencia_cliente: '',
      estado_derivado: 'S02', prioridad_derivada: 'P2', orden_atencion: '',
      doc_estado: '', doc_reintentos: 0, url_doc: '', url_pdf: '', version_documento: 0,
      url_pdf_historial: '', dedup_hash: 'x', estimacion_total_horas: 4, horas_reales: '',
      observaciones_generales: '', resumen_whatsapp: '',
      fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');
  ss.getSheetByName('SOLICITUDES').appendRow(ctx.COLUMNAS.SOLICITUDES.map((c) => base[c]));
  const sub = {
    subsolicitud_id: base.solicitud_id + '-01', solicitud_id: base.solicitud_id, numero_item: 1,
    titulo: tituloItem, descripcion: 'd', contexto: '', resultado_esperado: '', impacto: '',
    prioridad: base.prioridad_derivada, estado: base.estado_derivado, url_modulo: '',
    usuario_prueba: '', ref_credencial: '', centro_costos: '', url_video: '', observaciones: '',
    sla_objetivo_horas: 24, estimacion_horas: '', horas_reales: '',
    fecha_creacion: base.fecha_creacion, modulo: base.modulo, tipo: base.tipo
  };
  ss.getSheetByName('SUBSOLICITUDES').appendRow(ctx.COLUMNAS.SUBSOLICITUDES.map((c) => sub[c]));
  return base;
}

function sembrarEscenario_(ctx) {
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', empresa_nombre: 'HomePymes',
    modulo: 'MOD_FACTURACION', solicitante_nombre: 'Juan Pérez', solicitante_email: 'juan@homepymes.cl'
  }, 'Incorporar duración de la capacitación');
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-RLD-0002', empresa_id: 'RLD', empresa_nombre: 'RLD',
    plataforma: 'RLD_GDE', plataforma_nombre: 'GDE', modulo: 'MOD_LIQUIDACIONES',
    solicitante_nombre: 'Camila Soto', solicitante_email: 'camila@rld.cl'
  }, 'Error al exportar liquidaciones');
}

function buscar_(ctx, termino) {
  const datos = toPlain(ctx.Dashboard.getData({ busqueda: termino }, { rol: 'ADM', email: 'adm@hp.cl' }));
  return datos.recientes.map((r) => r.solicitud_id).sort();
}

// --- Un solo campo cubre todos los criterios pedidos ---------------------

test('busqueda por ID de solicitud', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  assert.deepEqual(buscar_(ctx, 'RLD-0002'), ['SOL-2026-RLD-0002']);
});

test('busqueda por TITULO del item (vive en SUBSOLICITUDES, no en SOLICITUDES)', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  // Este es exactamente el caso que antes fallaba: el titulo no era buscable
  // en el servidor porque coincideFiltros_ solo miraba SOLICITUDES.
  assert.deepEqual(buscar_(ctx, 'capacitación'), ['SOL-2026-HP-0001']);
  assert.deepEqual(buscar_(ctx, 'liquidaciones'), ['SOL-2026-RLD-0002']);
});

test('busqueda por nombre del solicitante', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  assert.deepEqual(buscar_(ctx, 'camila'), ['SOL-2026-RLD-0002']);
});

test('busqueda por correo del solicitante', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  assert.deepEqual(buscar_(ctx, 'juan@homepymes.cl'), ['SOL-2026-HP-0001']);
});

test('busqueda por empresa (codigo y nombre)', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  assert.deepEqual(buscar_(ctx, 'RLD'), ['SOL-2026-RLD-0002']);
  assert.deepEqual(buscar_(ctx, 'HomePymes'), ['SOL-2026-HP-0001']);
});

test('busqueda por modulo', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  assert.deepEqual(buscar_(ctx, 'MOD_LIQUIDACIONES'), ['SOL-2026-RLD-0002']);
});

test('busqueda sin coincidencias devuelve lista vacia (no todas)', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  assert.deepEqual(buscar_(ctx, 'zzzz-no-existe'), []);
});

test('busqueda insensible a mayusculas y con espacios sobrantes', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  assert.deepEqual(buscar_(ctx, '  CaMiLa  '), ['SOL-2026-RLD-0002']);
});

test('busqueda vacia no filtra nada', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  assert.equal(buscar_(ctx, '').length, 2);
});

// --- La coherencia cliente/servidor, que es el punto del cambio -----------

test('recientes[].texto_busqueda contiene todos los campos buscables', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  const datos = toPlain(ctx.Dashboard.getData({}, { rol: 'ADM', email: 'adm@hp.cl' }));
  const fila = datos.recientes.filter((r) => r.solicitud_id === 'SOL-2026-HP-0001')[0];

  assert.ok(fila.texto_busqueda, 'la fila debe traer texto_busqueda para el filtrado en vivo');
  ['sol-2026-hp-0001', 'capacitación', 'juan pérez', 'juan@homepymes.cl', 'hp', 'homepymes', 'mod_facturacion']
    .forEach(function (fragmento) {
      assert.ok(
        fila.texto_busqueda.indexOf(fragmento) !== -1,
        'texto_busqueda deberia contener "' + fragmento + '", fue: ' + fila.texto_busqueda
      );
    });
});

test('CLIENTE y SERVIDOR devuelven lo mismo: filtrar texto_busqueda == filtrar en el backend', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  // Sin este test, alguien podria ampliar los campos de un lado y no del
  // otro, y volveria el bug original ("veo resultados, pulso Actualizar y
  // desaparecen").
  const todas = toPlain(ctx.Dashboard.getData({}, { rol: 'ADM', email: 'adm@hp.cl' })).recientes;

  ['capacitación', 'camila', 'RLD', 'MOD_LIQUIDACIONES', 'juan@homepymes.cl', 'zzzz'].forEach(function (termino) {
    // Lo que haria el navegador sobre la lista ya cargada.
    const enCliente = todas
      .filter((r) => r.texto_busqueda.indexOf(termino.trim().toLowerCase()) !== -1)
      .map((r) => r.solicitud_id).sort();
    // Lo que devuelve el backend al pulsar "Actualizar".
    const enServidor = buscar_(ctx, termino);
    assert.deepEqual(enCliente, enServidor, 'divergen para el termino "' + termino + '"');
  });
});

test('busqueda + filtro de empresa se combinan (AND), no se pisan', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  const conAmbos = toPlain(ctx.Dashboard.getData(
    { busqueda: 'liquidaciones', empresa_id: 'HP' }, { rol: 'ADM', email: 'adm@hp.cl' }
  ));
  assert.deepEqual(conAmbos.recientes.map((r) => r.solicitud_id), [],
    'el item de liquidaciones es de RLD: acotado a HP no debe aparecer');
});

test('el filtro `solicitante` del Panel de Gerencia NO se ensancha con el cambio', () => {
  const ctx = loadConSchema();
  sembrarEscenario_(ctx);
  // Gerencia comparte coincideFiltros_ y tiene un campo rotulado
  // "Solicitante": ahi buscar por titulo seria incorrecto. `solicitante` debe
  // seguir mirando SOLO nombre y correo.
  const porTitulo = toPlain(ctx.Dashboard.getData(
    { solicitante: 'capacitación' }, { rol: 'ADM', email: 'adm@hp.cl' }
  ));
  assert.deepEqual(porTitulo.recientes.map((r) => r.solicitud_id), [],
    '`solicitante` no debe encontrar por titulo');

  const porNombre = toPlain(ctx.Dashboard.getData(
    { solicitante: 'juan' }, { rol: 'ADM', email: 'adm@hp.cl' }
  ));
  assert.deepEqual(porNombre.recientes.map((r) => r.solicitud_id), ['SOL-2026-HP-0001']);
});
