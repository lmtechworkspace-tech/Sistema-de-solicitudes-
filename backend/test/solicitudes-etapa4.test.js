'use strict';

/**
 * Solicitudes, etapa 4 (2026-10-05): el servicio decide si el formulario pide
 * el cliente, y los reportes de pedidos por departamento, servicio y persona
 * (tiempo hasta tomarlo, resolución dentro del plazo, atrasados), que también
 * entran al informe mensual de cada área.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Servicios = require('../logica/serviciosSolicitud');
const Solicitudes = require('../logica/solicitudes');
const RS = require('../logica/reporteSolicitudes');
const Ind = require('../logica/indicadoresDepto');

delete process.env.RESEND_API_KEY;

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']]);
  sembrarTabla_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS, [['HP', 'HomePymes', '', true, '']]);
  return db;
}
function vacio(hoja) { return Object.fromEntries(COLUMNAS[hoja].map((c) => [c, ''])); }
function miembro(db, depto, email, rol) {
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: depto + email, depto, usuario_email: email, rol, creado_por: 't', fecha_creacion: '', activa: true });
}
function ctx(email, rol) { return { email, rol: rol || 'DEV', rol_origen: 'SOLICITANTE', via_portal: true }; }
const JEFA = 'francisca@homepymes.cl', ANALISTA = 'barbara@homepymes.cl', OTRA = 'lisseth@homepymes.cl', PIDE = 'juan@homepymes.cl';

test('servicio: decide si el formulario pide el cliente; si lo exige, sin cliente no se crea', async () => {
  const db = dbConSchema();
  miembro(db, 'CONTABILIDAD', JEFA, 'JEFATURA');
  const f30 = Servicios.guardar(db, { depto: 'CONTABILIDAD', nombre: 'Certificado F30', plazo_dias: 2, pide_cliente: 'si' }, ctx(JEFA));
  const otro = Servicios.guardar(db, { depto: 'CONTABILIDAD', nombre: 'Consulta general' }, ctx(JEFA));
  assert.equal(f30.pide_cliente, 'si');
  assert.equal(otro.pide_cliente, 'opcional', 'por defecto, opcional (como hasta ahora)');
  assert.equal(Servicios.guardar(db, { servicio_id: otro.servicio_id, pide_cliente: 'cualquier cosa' }, ctx(JEFA)).pide_cliente, 'opcional');
  const cat = Servicios.catalogo(db).departamentos.find((d) => d.clave === 'CONTABILIDAD');
  assert.deepEqual(cat.servicios.map((s) => s.pide_cliente).sort(), ['opcional', 'si']);
  const base = { empresa_id: 'HP', asociada_plataforma: false, solicitante_nombre: 'Juan', solicitante_cargo: 'Ventas', solicitante_email: PIDE };
  const item = { titulo: 'F30 de Panadería Sol', descripcion: 'Lo pide el mandante.', depto: 'CONTABILIDAD', servicio_id: f30.servicio_id };
  const sin = await Solicitudes.crearSolicitud(db, Object.assign({ subsolicitudes: [item] }, base));
  assert.equal(sin._validationError, true);
  assert.ok(sin.fields.some((x) => /cliente/.test(x.mensaje)));
  const con = await Solicitudes.crearSolicitud(db, Object.assign({ subsolicitudes: [item], empresa_cliente: 'Panadería Sol SpA' }, base));
  assert.ok(con.solicitud_id, JSON.stringify(con));
});

// Septiembre de 2026 (Chile, UTC-3). Lunes 7 = día hábil; jornada 09:00–18:00.
const Z = (dia, hora) => '2026-09-' + String(dia).padStart(2, '0') + 'T' + String(hora + 3).padStart(2, '0') + ':00:00.000Z';
function pedido(db, id, depto, servicio, creado, estado, sla, asignado) {
  agregarFila_(db, 'SUBSOLICITUDES', Object.assign(vacio('SUBSOLICITUDES'), {
    subsolicitud_id: id, solicitud_id: id.split('-').slice(0, 3).join('-'), numero_item: 1, titulo: 'Pedido ' + id, descripcion: 'x',
    estado, prioridad: 'P3', sla_objetivo_horas: sla, fecha_creacion: creado, desarrollador_asignado: asignado || '',
    depto, depto_nombre: depto === 'CONTABILIDAD' ? 'Contabilidad' : 'Prevención de riesgos', servicio_id: servicio ? 'SRV-' + servicio : '', servicio_nombre: servicio || 'Otro pedido'
  }));
}
function paso(db, id, de, a, ts) {
  agregarFila_(db, 'HISTORIAL_ESTADOS', { historial_id: id + de + a + ts, solicitud_id: '', subsolicitud_id: id, estado_anterior: de, estado_nuevo: a, usuario: JEFA, comentario: '', timestamp: ts });
}
function sembrarSeptiembre(db, depto) {
  // A: tomado en 2 h, resuelto en 11 h hábiles con plazo de 27 h → a tiempo.
  pedido(db, 'HP-2026-0001-01', depto, 'F30', Z(7, 10), 'S08', 27, ANALISTA);
  paso(db, 'HP-2026-0001-01', 'S01', 'S02', Z(7, 12)); paso(db, 'HP-2026-0001-01', 'S02', 'S08', Z(8, 12));
  // B: tomado en 9 h; 9 h esperando al solicitante (no cuentan); resuelto en 18 h con plazo de 9 h → tarde.
  pedido(db, 'HP-2026-0002-01', depto, 'Factura', Z(7, 10), 'S09', 9, ANALISTA);
  paso(db, 'HP-2026-0002-01', 'S01', 'S05', Z(8, 10)); paso(db, 'HP-2026-0002-01', 'S05', 'S06', Z(8, 11));
  paso(db, 'HP-2026-0002-01', 'S06', 'S05', Z(9, 11)); paso(db, 'HP-2026-0002-01', 'S05', 'S08', Z(10, 10)); paso(db, 'HP-2026-0002-01', 'S08', 'S09', Z(11, 10));
  // C: tomado en 1 h y sigue abierto con plazo de 9 h → atrasado.
  pedido(db, 'HP-2026-0003-01', depto, 'F30', Z(1, 10), 'S02', 9, JEFA);
  paso(db, 'HP-2026-0003-01', 'S01', 'S02', Z(1, 11));
  // D: rechazado: cuenta como recibido, no en el cumplimiento.
  pedido(db, 'HP-2026-0004-01', depto, '', Z(2, 10), 'S10', 27, '');
  paso(db, 'HP-2026-0004-01', 'S01', 'S10', Z(2, 15));
}

test('reporte: tiempos en horas hábiles, plazo del servicio, pausa al esperar al solicitante y atrasados', () => {
  const db = dbConSchema();
  miembro(db, 'CONTABILIDAD', JEFA, 'JEFATURA');
  miembro(db, 'CONTABILIDAD', ANALISTA, 'REGISTRA');
  miembro(db, 'RRHH', OTRA, 'REGISTRA');
  sembrarSeptiembre(db, 'CONTABILIDAD');
  pedido(db, 'HP-2026-0009-01', 'RRHH', '', Z(7, 10), 'S01', 27, '');
  const r = RS.reporte(db, { depto: 'CONTABILIDAD', periodo: '2026-M09' }, ctx(JEFA));
  assert.deepEqual(
    [r.total.recibidos, r.total.rechazados, r.total.tomados, r.total.mediana_tomar_h, r.total.resueltos, r.total.mediana_resolver_h, r.total.con_plazo, r.total.a_tiempo, r.total.pct_a_tiempo, r.total.abiertos, r.total.atrasados],
    [4, 1, 3, 2, 2, 14.5, 2, 1, 50, 1, 1]);
  const f30 = r.por_servicio.find((x) => x.nombre === 'F30');
  assert.deepEqual([f30.recibidos, f30.resueltos, f30.a_tiempo, f30.atrasados], [2, 1, 1, 1]);
  const barbara = r.por_persona.find((x) => x.clave === ANALISTA);
  assert.deepEqual([barbara.resueltos, barbara.a_tiempo, barbara.abiertos], [2, 1, 0]);
  assert.equal(r.atrasados.length, 1);
  assert.equal(r.atrasados[0].subsolicitud_id, 'HP-2026-0003-01');
  assert.ok(r.atrasados[0].dias_atraso > 15, 'más de 15 días hábiles de atraso a fin de mes');
  assert.equal(r.serie.length, 6);
  assert.equal(r.serie[5].periodo, '2026-M09');
  // El mes siguiente ya no recibe ni resuelve nada, pero C sigue atrasado.
  const oct = RS.reporte(db, { depto: 'CONTABILIDAD', periodo: '2026-M10' }, ctx(ANALISTA));
  assert.deepEqual([oct.total.recibidos, oct.total.resueltos, oct.total.atrasados], [0, 0, 1]);
});

test('reporte: lo ve quien está en la lista del departamento; todos los departamentos, solo el administrador', () => {
  const db = dbConSchema();
  miembro(db, 'CONTABILIDAD', JEFA, 'JEFATURA');
  miembro(db, 'RRHH', OTRA, 'REGISTRA');
  sembrarSeptiembre(db, 'CONTABILIDAD');
  assert.equal(RS.reporte(db, { depto: 'CONTABILIDAD' }, ctx(OTRA))._forbidden, true, 'de otro departamento');
  assert.equal(RS.reporte(db, { depto: 'CONTABILIDAD' }, ctx(PIDE))._forbidden, true, 'sin departamento');
  assert.match(RS.reporte(db, {}, ctx(JEFA)).message, /Elige un departamento/);
  const adm = RS.reporte(db, { periodo: '2026-M09' }, ctx('admin@homepymes.cl', 'ADM'));
  assert.equal(adm.depto, '');
  assert.deepEqual(adm.por_departamento.map((x) => [x.clave, x.recibidos]), [['CONTABILIDAD', 4]]);
  assert.ok(adm.departamentos.length >= 6);
});

test('informe mensual del área: tema «Pedidos internos» con a tiempo, tiempo hasta tomar y atrasados', () => {
  const db = dbConSchema();
  miembro(db, 'PREVENCION', JEFA, 'JEFATURA');
  sembrarSeptiembre(db, 'PREVENCION');
  const r = Ind.calcularArea_(db, 'PREVENCION', '2026-M09');
  const k = (c) => r.kpis.find((x) => x.clave === c);
  assert.equal(k('pedidos_recibidos').valor, 4);
  assert.equal(k('pedidos_a_tiempo').valor, 50);
  assert.equal(k('pedidos_a_tiempo').estado, 'info', 'con menos de 5 casos no se pinta de rojo');
  assert.equal(k('pedidos_respuesta').valor, 2);
  assert.equal(k('pedidos_atrasados').valor, 1);
  assert.ok(r.kpis.filter((x) => /^pedidos_/.test(x.clave)).every((x) => x.tema === 'Pedidos internos'));
  assert.ok(r.detalle.pedidos_por_servicio.some((x) => x.servicio === 'F30'));
  // Un área sin pedidos en 12 meses no muestra el tema.
  const otra = Ind.calcularArea_(db, 'MARKETING', '2026-M09');
  assert.ok(!otra.kpis.some((x) => /^pedidos_/.test(x.clave)));
});
