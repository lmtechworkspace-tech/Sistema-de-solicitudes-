'use strict';

/**
 * Control interno (2026-10-01): las matrices de Contabilidad y RR.HH. en
 * SIGSO. Permisos reales (módulo + departamento + quién libera), validación
 * por tipo de campo, "abrir el mes", liberación sin auto-liberar, historial
 * y reportes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Procesos = require('../logica/procesosSgc');
const Prestaciones = require('../logica/prestacionesSgc');
const CI = require('../logica/controlInterno');
const { MATRICES } = require('../logica/controlInternoMatrices');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const conModulo = (email, rol) => ({ email, rol: rol || 'DEV', modulos: ['control_interno'] });
const FRANCISCA = conModulo('francisca@homepymes.cl');
const BARBARA = conModulo('barbara@homepymes.cl', 'JEFATURA');
const VANESSA = conModulo('vanessa@homepymes.cl');
const LECTORA = conModulo('lectora@homepymes.cl');
const SIN_MODULO = { email: 'francisca@homepymes.cl', rol: 'DEV', modulos: [] };

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  ['Constructora Andes SpA', 'Pyme Sur Ltda', 'Servicios Norte SpA'].forEach((n, i) => agregarFila_(db, 'CAT_CLIENTES', {
    cliente_id: 'CLI-' + (i + 1), razon_social: n, rut: '7' + i + '.111.111-1', codigo_cliente: 'HP-00' + i, contacto: '', correo: '', telefono: '',
    representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true
  }));
  // Áreas con servicios en el mapa: sin eso no se puede designar quién libera.
  const ENC = { email: 'sgc@homepymes.cl', rol: 'DEV' };
  Calidad.gestionarRol(db, { usuario_email: ENC.email, rol_sgc: 'ENCARGADO_SGC' }, ADM);
  Procesos.sembrarMapa(db, {}, ENC);
  const mapa = Procesos.listar(db, {}, ENC).mapa;
  Procesos.guardar(db, { nombre: 'IVA', tipo: 'OPERATIVO', nivel: 'SERVICIO', proceso_padre_id: mapa.find((p) => p.codigo === 'PO-04').proceso_id }, ENC);
  Procesos.guardar(db, { nombre: 'Remuneraciones', tipo: 'OPERATIVO', nivel: 'SERVICIO', proceso_padre_id: mapa.find((p) => p.codigo === 'PO-03').proceso_id }, ENC);
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }, { email: LECTORA.email, rol: 'LECTURA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'RRHH', miembros: [{ email: VANESSA.email, rol: 'REGISTRA' }] }, ADM);
  Prestaciones.guardarLiberadores(db, { areas: [{ area_clave: 'CONTABILIDAD', emails: [BARBARA.email] }] }, ADM);
  return db;
}
const filas = (db, h) => leerFilas_(db, h, COLUMNAS[h]);
function nuevo(db, extra, ctx) {
  return CI.guardar(db, Object.assign({ matriz: 'IVA', periodo: '2026-M09', cliente_id: 'CLI-1' }, extra || {}), ctx || FRANCISCA);
}

test('las 18 matrices están bien declaradas', () => {
  assert.equal(MATRICES.length, 18);
  const claves = new Set();
  MATRICES.forEach((m) => {
    assert.ok(!claves.has(m.clave), 'clave repetida ' + m.clave);
    claves.add(m.clave);
    assert.ok(m.estados.length && m.estados.some((e) => e.final), m.clave + ' necesita un estado final');
    const campos = new Set();
    m.campos.forEach((c) => {
      assert.ok(!campos.has(c.clave), m.clave + ': campo repetido ' + c.clave);
      campos.add(c.clave);
      if (c.tipo === 'lista') assert.ok(c.opciones && c.opciones.length, m.clave + '.' + c.clave + ' sin opciones');
    });
    if (m.fechaPrincipal) assert.ok(campos.has(m.fechaPrincipal), m.clave + ': fechaPrincipal inexistente');
    (m.copiar || []).forEach((k) => assert.ok(campos.has(k), m.clave + ': copiar ' + k + ' inexistente'));
    (m.tiempos || []).forEach((k) => assert.ok(campos.has(k), m.clave + ': tiempos ' + k + ' inexistente'));
  });
});

test('sin el módulo en la cuenta no se entra; cada uno ve solo su departamento', () => {
  const db = crear();
  assert.equal(CI.getConfig(db, {}, SIN_MODULO)._forbidden, true);
  const f = CI.getConfig(db, {}, FRANCISCA);
  assert.deepEqual(f.departamentos.map((d) => d.clave), ['CONTABILIDAD']);
  assert.ok(f.matrices.every((m) => m.depto === 'CONTABILIDAD'));
  const v = CI.getConfig(db, {}, VANESSA);
  assert.deepEqual(v.departamentos.map((d) => d.clave), ['RRHH']);
  assert.equal(CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, VANESSA)._forbidden, true);
  // Bárbara no es miembro, pero libera Contabilidad: la ve.
  assert.deepEqual(CI.getConfig(db, {}, BARBARA).departamentos.map((d) => d.clave), ['CONTABILIDAD']);
  assert.equal(CI.getConfig(db, {}, ADM).departamentos.length, 2);
  assert.deepEqual(CI.getConfig(db, {}, FRANCISCA).departamentos[0].liberadores, [BARBARA.email]);
});

test('solo lectura no registra', () => {
  const db = crear();
  assert.equal(nuevo(db, {}, LECTORA)._forbidden, true);
  assert.equal(CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, LECTORA).puede_registrar, false);
});

test('crear, validar por tipo y no duplicar el cliente en una matriz de una fila por cliente', () => {
  const db = crear();
  const r = nuevo(db, { datos: { monto_pago: '1.234.567', fecha_declaracion: '2026-09-20', posterga: 'No' } });
  assert.equal(r.ok, true);
  assert.equal(r.registro.datos.monto_pago, 1234567, 'el monto se escribe como en el Drive: con puntos');
  assert.equal(r.registro.fecha, '2026-09-20');
  assert.equal(r.registro.responsable_email, FRANCISCA.email);
  assert.equal(r.registro.estado, 'PENDIENTE');
  assert.match(nuevo(db).message, /ya tiene su registro/);
  assert.match(nuevo(db, { cliente_id: 'CLI-2', datos: { posterga: 'Quizás' } }).message, /no está en la lista/);
  assert.match(nuevo(db, { cliente_id: 'CLI-2', datos: { fecha_declaracion: '20/09/2026' } }).message, /fecha no es válida/);
  assert.match(nuevo(db, { cliente_id: 'NO-EXISTE' }).message, /no está en el catálogo/);
  // Fuera del catálogo: se escribe el nombre y queda marcado para conciliar.
  const fuera = nuevo(db, { cliente_id: '', cliente_nombre: 'Cliente Nuevo SpA' });
  assert.equal(fuera.ok, true);
  assert.equal(fuera.registro.cliente_id, '');
});

test('editar por celda conserva lo demás y deja historial', () => {
  const db = crear();
  const r = nuevo(db, { datos: { monto_pago: 1000, fecha_carta: '2026-09-10' } }).registro;
  const e = CI.guardar(db, { registro_id: r.registro_id, datos: { monto_pago: 2500 } }, FRANCISCA);
  assert.equal(e.registro.datos.monto_pago, 2500);
  assert.equal(e.registro.datos.fecha_carta, '2026-09-10', 'la edición parcial no borra los otros campos');
  assert.equal(CI.guardar(db, { registro_id: r.registro_id, datos: { monto_pago: 2500 } }, FRANCISCA).message, 'Sin cambios.');
  const h = CI.getRegistro(db, { registro_id: r.registro_id }, FRANCISCA).historial;
  assert.deepEqual(h.map((x) => x.accion).sort(), ['CREADO', 'EDITADO']);
  assert.match(h.find((x) => x.accion === 'EDITADO').detalle, /Monto a pagar/);
});

test('matriz por requerimiento: el período sale de la fecha principal', () => {
  const db = crear();
  const r = CI.guardar(db, { matriz: 'FINIQUITOS', cliente_id: 'CLI-1', datos: { fecha_recepcion: '2026-08-14', trabajador: 'Juan Pérez', causal: '159-2 Renuncia del trabajador' } }, VANESSA);
  assert.equal(r.ok, true);
  assert.equal(r.registro.periodo, '2026-M08');
  const mover = CI.guardar(db, { registro_id: r.registro.registro_id, datos: { fecha_recepcion: '2026-09-02' } }, VANESSA);
  assert.equal(mover.registro.periodo, '2026-M09');
  assert.equal(CI.listar(db, { matriz: 'FINIQUITOS', periodo: '2026-M09' }, VANESSA).registros.length, 1);
});

test('convenios: el estado sale de las cuotas vencidas', () => {
  const db = crear();
  const sin = CI.guardar(db, { matriz: 'CONVENIOS', periodo: '2026-M09', cliente_id: 'CLI-1', datos: { convenios: [] } }, FRANCISCA);
  assert.equal(sin.registro.estado, 'SIN_CONVENIO');
  const con = CI.guardar(db, { registro_id: sin.registro.registro_id, datos: { convenios: [
    { tipo: 'IVA', folio: '123', cuotas_pagadas: 7, cuotas_vencidas: 0 },
    { tipo: 'Renta', folio: '456', cuotas_vencidas: 2 },
    { tipo: '', folio: '' }
  ] } }, FRANCISCA);
  assert.equal(con.registro.datos.convenios.length, 2, 'la fila vacía no se guarda');
  assert.equal(con.registro.estado, 'CON_VENCIDAS');
  assert.equal(CI.guardar(db, { registro_id: sin.registro.registro_id, estado: 'AL_DIA' }, FRANCISCA).registro.estado, 'CON_VENCIDAS', 'no se puede forzar a mano');
});

test('contabilización: la checklist calcula el avance sobre lo que aplica', () => {
  const db = crear();
  const r = CI.guardar(db, { matriz: 'CONTABILIZACION', periodo: '2026-M09', cliente_id: 'CLI-1', datos: { tareas: {
    centralizaciones: { quien: FRANCISCA.email, fecha: '2026-09-05', items: { Compras: 'OK', Banco: 'OK', 'Mantención de vehículos': 'NO_APLICA', Combustible: 'NO_APLICA', Ventas: 'PENDIENTE', Honorarios: 'NO_APLICA' } }
  } } }, FRANCISCA);
  assert.equal(r.ok, true);
  // 22 ítems en total, 3 no aplican → 19 aplican, 2 OK.
  assert.deepEqual(r.registro.avance, { ok: 2, aplica: 19, pct: 11 });
  assert.equal(r.registro.datos.tareas.centralizaciones.quien, FRANCISCA.email);
});

test('abrir el mes copia los clientes del mes anterior una sola vez', () => {
  const db = crear();
  nuevo(db, { periodo: '2026-M08', datos: { clasificacion: 'HP', monto_pago: 500 } });
  nuevo(db, { periodo: '2026-M08', cliente_id: 'CLI-2' });
  nuevo(db, { periodo: '2026-M09', cliente_id: 'CLI-2' });
  const r = CI.abrirPeriodo(db, { matriz: 'IVA', periodo: '2026-M09' }, FRANCISCA);
  assert.equal(r.creadas, 1);
  assert.equal(r.omitidas, 1);
  const sep = CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, FRANCISCA).registros;
  const copiado = sep.find((x) => x.cliente_id === 'CLI-1');
  assert.equal(copiado.datos.clasificacion, 'HP', 'se copia lo que se arrastra (clasificación)');
  assert.equal(copiado.datos.monto_pago, undefined, 'no se copian los montos del mes');
  assert.equal(CI.abrirPeriodo(db, { matriz: 'IVA', periodo: '2026-M09' }, FRANCISCA).creadas, 0);
  assert.match(CI.abrirPeriodo(db, { matriz: 'FACTURACION', periodo: '2026-M09' }, FRANCISCA).message, /no se abre por mes/);
});

test('libera quien libera el área, solo lo terminado y nunca lo propio; editar lo liberado lo devuelve a revisión', () => {
  const db = crear();
  const a = nuevo(db).registro;
  const b = nuevo(db, { cliente_id: 'CLI-2', estado: 'CERRADO' }).registro;
  const c = nuevo(db, { cliente_id: 'CLI-3', estado: 'CERRADO', responsable_email: BARBARA.email }).registro;
  assert.equal(CI.accionLote(db, { matriz: 'IVA', accion: 'liberar', ids: [b.registro_id] }, FRANCISCA)._forbidden, true);
  const r = CI.accionLote(db, { matriz: 'IVA', accion: 'liberar', ids: [a.registro_id, b.registro_id, c.registro_id] }, BARBARA);
  assert.equal(r.hechos, 1);
  assert.deepEqual(r.omitidas.map((o) => o.motivo), ['Todavía no está terminado (Pendiente).', 'Lo realizaste tú: lo libera otra persona.']);
  const lib = CI.getRegistro(db, { registro_id: b.registro_id }, FRANCISCA).registro;
  assert.equal(lib.liberado_por, BARBARA.email);
  assert.ok(lib.fecha_liberacion);
  assert.equal(CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, FRANCISCA).resumen.liberados, 1);

  const ed = CI.guardar(db, { registro_id: b.registro_id, datos: { monto_pago: 99 } }, FRANCISCA);
  assert.match(ed.message, /liberar de nuevo/);
  assert.equal(ed.registro.liberado_por, '');
  assert.ok(CI.getRegistro(db, { registro_id: b.registro_id }, FRANCISCA).historial.some((h) => h.accion === 'LIBERACION_REVERTIDA'));
});

test('anular: lo liberado solo lo anula el Encargado', () => {
  const db = crear();
  const b = nuevo(db, { estado: 'CERRADO' }).registro;
  CI.accionLote(db, { matriz: 'IVA', accion: 'liberar', ids: [b.registro_id] }, BARBARA);
  const r = CI.accionLote(db, { matriz: 'IVA', accion: 'anular', ids: [b.registro_id] }, FRANCISCA);
  assert.equal(r.hechos, 0);
  assert.match(r.omitidas[0].motivo, /lo anula el Encargado/);
  const otro = nuevo(db, { cliente_id: 'CLI-2' }).registro;
  assert.equal(CI.accionLote(db, { matriz: 'IVA', accion: 'anular', ids: [otro.registro_id] }, FRANCISCA).hechos, 1);
  assert.equal(CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, FRANCISCA).registros.length, 1);
});

test('reporte: por mes, por responsable, arrastre y tiempos', () => {
  const db = crear();
  CI.guardar(db, { matriz: 'FINIQUITOS', cliente_id: 'CLI-1', estado: 'ENVIADO', datos: { fecha_recepcion: '2026-07-01', fecha_envio: '2026-07-04' } }, VANESSA);
  CI.guardar(db, { matriz: 'FINIQUITOS', cliente_id: 'CLI-2', estado: 'ENVIADO', datos: { fecha_recepcion: '2026-07-10', fecha_envio: '2026-07-12' } }, VANESSA);
  CI.guardar(db, { matriz: 'FINIQUITOS', cliente_id: 'CLI-1', datos: { fecha_recepcion: '2026-08-03' } }, VANESSA);
  const r = CI.reporte(db, { matriz: 'FINIQUITOS', desde: '2026-07-M'.replace('-07-M', '-M07'), hasta: '2026-M09' }, VANESSA);
  assert.deepEqual(r.por_mes.map((x) => [x.periodo, x.total, x.finalizados]), [['2026-M07', 2, 2], ['2026-M08', 1, 0], ['2026-M09', 0, 0]]);
  assert.equal(r.por_responsable[0].email, VANESSA.email);
  assert.equal(r.por_responsable[0].total, 3);
  assert.equal(r.tiempos.por_mes[0].promedio, 2.5, '3 y 2 días entre recepción y envío');
  assert.equal(r.arrastre.length, 1, 'agosto quedó sin terminar');
  assert.equal(r.arrastre[0].periodo, '2026-M08');
});

test('los accesos los reparte solo el administrador', () => {
  const db = crear();
  assert.equal(CI.guardarMiembros(db, { depto: 'RRHH', miembros: [] }, FRANCISCA)._forbidden, true);
  assert.equal(CI.listarMiembros(db, {}, FRANCISCA)._forbidden, true);
  const r = CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'LECTURA' }] }, ADM);
  assert.deepEqual([r.altas, r.bajas, r.cambios], [0, 1, 1]);
  assert.equal(nuevo(db)._forbidden, true, 'pasó a solo lectura');
  assert.deepEqual(CI.listarMiembros(db, {}, ADM).departamentos[0].liberadores, [BARBARA.email]);
});

test('las consultas van por índice (matriz, período)', () => {
  const db = crear();
  nuevo(db);
  CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, FRANCISCA);
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM "CI_REGISTROS" WHERE "matriz" = ? AND "periodo" = ? AND "activa" = ?').all('"IVA"', '"2026-M09"', 'true');
  assert.ok(plan.some((p) => /ix_ci_registros_matriz_periodo/.test(p.detail)), JSON.stringify(plan));
  assert.equal(filas(db, 'CI_REGISTROS').length, 1);
});
