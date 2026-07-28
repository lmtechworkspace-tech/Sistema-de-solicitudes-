'use strict';

/**
 * v6.1 (Fase 1, gestion preventiva de SLA).
 *
 * Cubre las tres cosas que introdujo el cambio:
 *
 *  1. Sla.medir / Sla.situacion como UNICA fuente de verdad del eje SLA
 *     (A-08: >= 80% consumido y no vencido = EN_RIESGO). Antes la regla estaba
 *     triplicada en Dashboard.estaVencidoSla_, Dashboard.slaRestanteHoras_ y
 *     Triggers.ratioSlaConsumido_.
 *  2. Los casos limite que hacen que un item NO tenga situacion: cerrado,
 *     rechazado/cancelado, sin sla_objetivo_horas (P5 / atencion directa).
 *  3. La coherencia KPI -> lista: el orden por urgencia garantiza que lo
 *     vencido y lo en riesgo entra en la ventana de RECIENTES_LIMITE, que es
 *     lo que antes hacia que el contador y las filas visibles no cuadraran.
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

// Un miercoles a las 09:00 (dia habil, inicio de jornada) como origen fijo:
// asi las horas habiles transcurridas son deterministas y no dependen de
// cuando se corra el test.
const MIERCOLES_9AM = '2026-07-22T09:00:00.000-04:00';

function subDePrueba(overrides) {
  return Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01',
      solicitud_id: 'SOL-2026-HP-0001',
      estado: 'S02',
      sla_objetivo_horas: 10,
      fecha_creacion: MIERCOLES_9AM
    },
    overrides
  );
}

// --- 1. Sla: la regla A-08, en un solo lugar --------------------------------

test('Sla.situacion: EN_PLAZO mientras se consumio menos del 80% del SLA', () => {
  const ctx = loadConSchema();
  // 5 h habiles de 10 = 50%.
  const situacion = ctx.Sla.situacion(subDePrueba({ sla_objetivo_horas: 10 }), {
    ahora: new Date('2026-07-22T14:00:00.000-04:00')
  });
  assert.equal(situacion, 'EN_PLAZO');
});

test('Sla.situacion: EN_RIESGO exactamente en el umbral A-08 del 80%', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.SLA_UMBRAL_RIESGO, 0.8, 'el umbral A-08 debe seguir siendo 80%');
  // 8 h habiles de 10 = 80% justo.
  const situacion = ctx.Sla.situacion(subDePrueba({ sla_objetivo_horas: 10 }), {
    ahora: new Date('2026-07-22T17:00:00.000-04:00')
  });
  assert.equal(situacion, 'EN_RIESGO');
});

test('Sla.situacion: EN_RIESGO tambien justo antes de vencer (99%), no FUERA_DE_PLAZO', () => {
  const ctx = loadConSchema();
  // 8,9 h de 9 (jornada 09:00-18:00 completa es 9 h).
  const situacion = ctx.Sla.situacion(subDePrueba({ sla_objetivo_horas: 9 }), {
    ahora: new Date('2026-07-22T17:54:00.000-04:00')
  });
  assert.equal(situacion, 'EN_RIESGO');
});

test('Sla.situacion: FUERA_DE_PLAZO al pasar el 100% del SLA', () => {
  const ctx = loadConSchema();
  // Dos dias habiles despues: 9 h del miercoles + jornada del jueves > 10 h.
  const situacion = ctx.Sla.situacion(subDePrueba({ sla_objetivo_horas: 10 }), {
    ahora: new Date('2026-07-23T17:00:00.000-04:00')
  });
  assert.equal(situacion, 'FUERA_DE_PLAZO');
});

test('Sla.medir devuelve horas restantes negativas cuando ya vencio', () => {
  const ctx = loadConSchema();
  const medicion = ctx.Sla.medir(subDePrueba({ sla_objetivo_horas: 2 }), {
    ahora: new Date('2026-07-22T17:00:00.000-04:00')
  });
  assert.equal(medicion.situacion, 'FUERA_DE_PLAZO');
  assert.ok(medicion.restantes_horas < 0, 'restantes_horas deberia ser negativo, fue ' + medicion.restantes_horas);
  assert.ok(medicion.ratio > 1, 'ratio deberia superar 1, fue ' + medicion.ratio);
});

// --- 2. Casos limite: cuando NO hay situacion que mostrar -------------------

test('Sla.medir: null para un item ya cerrado (S09) -- su reloj se detuvo', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Sla.medir(subDePrueba({ estado: 'S09' })), null);
});

test('Sla.medir: null para rechazada (S10) y cancelada (S11)', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Sla.medir(subDePrueba({ estado: 'S10' })), null);
  assert.equal(ctx.Sla.medir(subDePrueba({ estado: 'S11' })), null);
});

test('Sla.medir: null sin sla_objetivo_horas (P5 / atencion directa)', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Sla.medir(subDePrueba({ sla_objetivo_horas: '' })), null);
  assert.equal(ctx.Sla.medir(subDePrueba({ sla_objetivo_horas: null })), null);
  assert.equal(ctx.Sla.medir(subDePrueba({ sla_objetivo_horas: undefined })), null);
});

test('Sla.medir: un item TERMINADA (S08) sigue midiendo SLA -- "Terminada + Fuera de plazo" es un estado real', () => {
  const ctx = loadConSchema();
  // S08 detiene el reloj del COMPROMISO (Cumplimiento), no el de respuesta
  // (A-08). Son dos ejes distintos a proposito: por eso el detalle puede
  // mostrar estado "Terminada" y situacion "Fuera de plazo" a la vez.
  const medicion = ctx.Sla.medir(subDePrueba({ estado: 'S08', sla_objetivo_horas: 2 }), {
    ahora: new Date('2026-07-22T17:00:00.000-04:00')
  });
  assert.notEqual(medicion, null, 'S08 no debe excluirse del eje SLA');
  assert.equal(medicion.situacion, 'FUERA_DE_PLAZO');
});

test('Sla.peorSituacion: una solicitud toma la PEOR situacion de sus items, no la del que tiene menos horas', () => {
  const ctx = loadConSchema();
  assert.equal(ctx.Sla.peorSituacion(['EN_PLAZO', 'EN_RIESGO']), 'EN_RIESGO');
  assert.equal(ctx.Sla.peorSituacion(['EN_RIESGO', 'FUERA_DE_PLAZO']), 'FUERA_DE_PLAZO');
  assert.equal(ctx.Sla.peorSituacion(['EN_PLAZO', 'EN_PLAZO']), 'EN_PLAZO');
  // Ningun item con SLA vigente (todos cerrados / P5) -> sin situacion.
  assert.equal(ctx.Sla.peorSituacion([null, null]), null);
  assert.equal(ctx.Sla.peorSituacion([]), null);
});

// --- 3. Dashboard: KPI "en riesgo", situacion_sla y coherencia -------------

function seedSolicitudConSla(ctx, solicitudId, estado, slaHoras, fechaCreacion) {
  const base = {
    solicitud_id: solicitudId, empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
    tipo: 'ERR', solicitante_nombre: 'Juan', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
    es_cliente: false, empresa_cliente: '', cliente_mandante: '', cliente_obra: '',
    contacto_cliente: '', correo_cliente: '', telefono_cliente: '', urgencia_cliente: '',
    estado_derivado: estado, prioridad_derivada: 'P3', orden_atencion: '',
    doc_estado: '', doc_reintentos: 0, url_doc: '', url_pdf: '', version_documento: 0, url_pdf_historial: '',
    dedup_hash: 'x', estimacion_total_horas: 4, horas_reales: '', observaciones_generales: '',
    resumen_whatsapp: '', fecha_creacion: fechaCreacion, creado_por: 'juan@homepymes.cl'
  };
  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');
  ss.getSheetByName('SOLICITUDES').appendRow(ctx.COLUMNAS.SOLICITUDES.map((col) => base[col]));
  const sub = {
    subsolicitud_id: solicitudId + '-01', solicitud_id: solicitudId, numero_item: 1,
    titulo: 't', descripcion: 'd', contexto: '', resultado_esperado: '', impacto: '',
    prioridad: 'P3', estado: estado, url_modulo: '', usuario_prueba: '',
    ref_credencial: '', centro_costos: '', url_video: '', observaciones: '',
    sla_objetivo_horas: slaHoras, estimacion_horas: '', horas_reales: '', fecha_creacion: fechaCreacion,
    modulo: base.modulo, tipo: base.tipo
  };
  ss.getSheetByName('SUBSOLICITUDES').appendRow(ctx.COLUMNAS.SUBSOLICITUDES.map((col) => sub[col]));
}

// Horas habiles hacia atras, aproximadas con dias de calendario: para estos
// tests basta que "hace mucho" sea claramente mas que el SLA y "hace poco"
// claramente menos.
function haceDias(dias) {
  return new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString();
}

test('Dashboard.getData expone resumen.en_riesgo y situacion_sla por solicitud', () => {
  const ctx = loadConSchema();
  // SLA de 500 h habiles y creada hoy: lejisimos del 80% -> EN_PLAZO.
  seedSolicitudConSla(ctx, 'SOL-2026-HP-0001', 'S02', 500, new Date().toISOString());
  // SLA de 2 h habiles y creada hace 10 dias -> pasadisima -> FUERA_DE_PLAZO.
  seedSolicitudConSla(ctx, 'SOL-2026-HP-0002', 'S02', 2, haceDias(10));

  const datos = toPlain(ctx.Dashboard.getData({}, { rol: 'ADM', email: 'adm@homepymes.cl' }));

  assert.ok('en_riesgo' in datos.resumen, 'el resumen debe traer el contador en_riesgo');
  assert.equal(datos.resumen.sla_vencido, 1);

  const porId = {};
  datos.recientes.forEach((r) => { porId[r.solicitud_id] = r; });
  assert.equal(porId['SOL-2026-HP-0001'].situacion_sla, 'EN_PLAZO');
  assert.equal(porId['SOL-2026-HP-0002'].situacion_sla, 'FUERA_DE_PLAZO');
});

test('Dashboard.getData: situacion_sla es null cuando la solicitud ya esta cerrada', () => {
  const ctx = loadConSchema();
  seedSolicitudConSla(ctx, 'SOL-2026-HP-0001', 'S09', 2, haceDias(10));

  const datos = toPlain(ctx.Dashboard.getData({}, { rol: 'ADM', email: 'adm@homepymes.cl' }));

  assert.equal(datos.recientes[0].situacion_sla, null);
  // Y no cuenta como vencida: su reloj se detuvo al cerrar (RN-019/020).
  assert.equal(datos.resumen.sla_vencido, 0);
  assert.equal(datos.resumen.en_riesgo, 0);
});

test('Dashboard.getData ordena por urgencia: lo vencido va primero aunque sea la solicitud MAS ANTIGUA', () => {
  const ctx = loadConSchema();
  // La vencida es la mas vieja: con el orden por fecha_creacion (hasta v6.0)
  // habria quedado al final de la lista, no arriba.
  seedSolicitudConSla(ctx, 'SOL-2026-HP-0001', 'S02', 2, haceDias(30));
  seedSolicitudConSla(ctx, 'SOL-2026-HP-0002', 'S02', 500, new Date().toISOString());

  const datos = toPlain(ctx.Dashboard.getData({}, { rol: 'ADM', email: 'adm@homepymes.cl' }));

  assert.equal(datos.recientes[0].solicitud_id, 'SOL-2026-HP-0001');
  assert.equal(datos.recientes[0].situacion_sla, 'FUERA_DE_PLAZO');
});

test('Dashboard.getData deja las cerradas al final del orden (no compiten con el trabajo pendiente)', () => {
  const ctx = loadConSchema();
  seedSolicitudConSla(ctx, 'SOL-2026-HP-0001', 'S09', 500, new Date().toISOString());
  seedSolicitudConSla(ctx, 'SOL-2026-HP-0002', 'S02', 500, haceDias(20));

  const datos = toPlain(ctx.Dashboard.getData({}, { rol: 'ADM', email: 'adm@homepymes.cl' }));

  assert.equal(datos.recientes[0].solicitud_id, 'SOL-2026-HP-0002', 'la abierta va antes que la cerrada');
  assert.equal(datos.recientes[1].solicitud_id, 'SOL-2026-HP-0001');
});

test('Dashboard.getData: coherencia KPI -> lista -- TODAS las vencidas entran en la ventana de RECIENTES_LIMITE', () => {
  const ctx = loadConSchema();
  // Se siembran mas solicitudes que el limite (50) y se dejan 3 vencidas como
  // las MAS ANTIGUAS: justo el caso que antes rompia la coherencia (el KPI
  // contaba sobre toda la hoja, la lista mostraba solo el top-50 por fecha).
  for (let i = 1; i <= 60; i++) {
    const id = 'SOL-2026-HP-' + String(i).padStart(4, '0');
    const esVencida = i <= 3;
    seedSolicitudConSla(
      ctx, id, 'S02',
      esVencida ? 2 : 500,
      esVencida ? haceDias(100 + i) : haceDias(i % 10)
    );
  }

  const datos = toPlain(ctx.Dashboard.getData({}, { rol: 'ADM', email: 'adm@homepymes.cl' }));

  assert.equal(datos.recientes.length, ctx.RECIENTES_LIMITE, 'la lista sigue acotada');
  assert.equal(datos.total_solicitudes, 60);
  assert.equal(datos.recientes_truncado, true, 'debe avisar que la lista quedo recortada');

  // El contador global de vencidas...
  assert.equal(datos.resumen.sla_vencido, 3);
  // ...tiene que poder verse completo en la lista que se manda al frontend,
  // porque es esa lista la que el frontend cuenta y filtra.
  const vencidasEnLista = datos.recientes.filter((r) => r.situacion_sla === 'FUERA_DE_PLAZO');
  assert.equal(vencidasEnLista.length, 3, 'las 3 vencidas deben venir en la ventana, no quedar fuera por antiguas');
});

test('Solicitudes.getDetalle expone situacion_sla y cumplimiento por item (los dos ejes, separados)', () => {
  const ctx = loadConSchema();
  // getDetalle arma la vista completa: necesita tambien las hojas de
  // historial/archivos que la bandeja no toca.
  ['HISTORIAL_PRIORIDAD', 'HISTORIAL_COMPROMISO', 'HISTORIAL_ASIGNACION', 'ARCHIVOS'].forEach((hoja) => {
    seedSheet(ctx, hoja, ctx.COLUMNAS[hoja]);
  });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ctx.COLUMNAS.USUARIOS.map((col) => ({
      email: 'adm@homepymes.cl', nombre: 'Admin', rol: 'ADM', empresa_id: 'HP', activo: true
    }[col]))
  ]);
  seedSolicitudConSla(ctx, 'SOL-2026-HP-0001', 'S02', 2, haceDias(10));

  const detalle = toPlain(ctx.Solicitudes.getDetalle('SOL-2026-HP-0001', { rol: 'ADM', email: 'adm@homepymes.cl' }));
  const item = detalle.subsolicitudes[0];

  assert.equal(item.situacion_sla, 'FUERA_DE_PLAZO', 'eje SLA (A-08)');
  assert.ok(item.cumplimiento, 'eje compromiso (v2.1 §6) sigue presente y aparte');
  assert.ok(item.sla_restante_horas < 0);
});
