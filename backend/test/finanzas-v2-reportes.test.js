'use strict';

/**
 * Finanzas v2 (2026-10-20), fases 5 y 6: contrato de reportes, comparaciones,
 * calidad, comentarios con evidencia, exportación, editor de reglas, cierre
 * reproducible y centro de cargas. Casos T04, T24, T29–T31, T35–T37, T40, T42
 * (con libros sintéticos que imitan la estructura real).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { preparar, versionDe, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const Op = require('../logica/finanzasOperaciones');
const R = require('../logica/finanzasReportes');
const X = require('../logica/finanzasExportar');
const Rg = require('../logica/finanzasReglas');
const Ci = require('../logica/finanzasCierre');
const Ca = require('../logica/finanzasCargas');
const Cat = require('../logica/finanzasCatalogos');
const P = require('../logica/finanzasPresupuesto');

const op = (db, D, ctx, o) => Op.guardar(db, D(Object.assign({ empresa: 'HomePymes', medio: 'EFECTIVO', confirmar: true }, o)), ctx);

test('T29 · comparaciones sin infinitos ni mejoras engañosas', () => {
  assert.deepEqual([R.comparar_(0, 0).estado, R.comparar_(0, 0).pct], ['AMBOS_CERO', 0]);
  const bc = R.comparar_(500, 0);
  assert.deepEqual([bc.estado, bc.pct, bc.diferencia], ['BASE_CERO', null, 500]);
  assert.equal(R.comparar_(100, -50).estado, 'CAMBIO_SIGNO');
  assert.equal(R.comparar_(100, -50).pct, null);
  assert.equal(R.comparar_(-80, -50).estado, 'BASE_NEGATIVA');
  assert.equal(R.comparar_(100, null).estado, 'SIN_BASE');
  const ok = R.comparar_(110, 100);
  assert.deepEqual([ok.estado, ok.pct, ok.diferencia], ['COMPARABLE', 10, 10]);
  assert.equal(R.comparar_(55.5, 50, { puntos: true }).texto, '+5,5 pp');
  assert.ok(!/Infinity|NaN/.test(JSON.stringify([R.comparar_(1, 0), R.comparar_(0, 1), R.comparar_(-1, 0)])));
});

test('T31 · comentario automático: flujo 3,1 M vs 3,4 M (−0,3 M); siete abonos sin revisar por 0,9 M lo dejan provisorio', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-07-10', sentido: 'ENTRADA', monto: 17000000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  op(db, D, ctx, { fecha: '2026-07-11', sentido: 'SALIDA', monto: 13600000, tipo: 'EGRESO', cuenta: 'Sueldos' });
  op(db, D, ctx, { fecha: '2026-08-10', sentido: 'ENTRADA', monto: 19400000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  op(db, D, ctx, { fecha: '2026-08-11', sentido: 'SALIDA', monto: 13600000, tipo: 'EGRESO', cuenta: 'Sueldos' });
  op(db, D, ctx, { fecha: '2026-08-12', sentido: 'SALIDA', monto: 2700000, tipo: 'EGRESO', cuenta: 'Arriendo Mensual' });
  F.importarCartola(db, D({ filas: cartola(Array.from({ length: 7 }, (_, i) => ['2' + i + '/08/2026', 'TRANSFER DE CLIENTE ' + i, 0, [100000, 150000, 120000, 130000, 140000, 110000, 150000][i], String(i + 1)])), empresa: 'HomePymes' }), ctx);
  const c = R.reporte(db, D({ periodo: '2026-08' }), ctx);
  assert.deepEqual([c.metrics.ingresos, c.metrics.egresos, c.metrics.flujo_propio], [19400000, 16300000, 3100000]);
  const cmp = c.comparisons.flujo_propio.PREVIOUS_PERIOD;
  assert.deepEqual([cmp.base, cmp.diferencia], [3400000, -300000]);
  assert.equal(c.quality.status !== 'COMPLETO', true);
  const pend = c.quality.reasons.find((r) => r.codigo === 'PENDIENTES');
  assert.deepEqual([pend.cantidad, pend.monto], [7, 900000]);
  const f = c.insights.find((i) => i.rule_id === 'FLUJO_PROPIO');
  // I09.4: con datos provisorios la caída se informa sin calificar (no es «alerta»); la provisionalidad la dice DATOS_INCOMPLETOS.
  assert.equal(f.severidad, 'info');
  assert.match(f.texto, /sin calificar/);
  assert.match(f.texto, /−\$300\.000/);
  // I09.4: cada concepto se informa por su efecto en el flujo (más arriendo pagado = −$2,7 M de flujo).
  assert.match(f.texto, /movió el flujo: Arriendo Mensual −\$2\.700\.000/, 'dice qué concepto cambió');
  assert.match(f.limites, /no explica por qué/, 'no atribuye causas');
  assert.deepEqual(f.acciones, ['COMO_SE_CALCULO', 'VER_QUE_CAMBIO', 'REVISAR_PENDIENTES']);
  assert.equal(c.insights[0].rule_id === 'DATOS_INCOMPLETOS' || c.insights[0].severidad === 'critico', true, 'lo material primero');
  // «Ver qué cambió»: los hechos detrás de la cifra, de los dos meses.
  const det = R.detalle(db, D({ periodo: '2026-08', metric: 'egresos', comparar: true }), ctx);
  assert.deepEqual([det.total, det.comparacion.total, det.hechos.length], [16300000, 13600000, 2]);
});

test('T30 · cobertura incompleta y mes en curso: no se presenta como completo; meses de caja por determinar sin aperturas', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'COMISION MANTENCION', 5000, 0, '1']], { periodo: '01-08-2026 al 15-08-2026' }), empresa: 'HomePymes' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  F.clasificar(db, D({ items: [{ id: m.id, tipo: 'EGRESO', cuenta: 'Comisión Banco' }] }), ctx);
  op(db, D, ctx, { fecha: '2026-08-06', sentido: 'SALIDA', monto: 1000, tipo: 'FONDO_PAGADO', cuenta: 'IVA', cliente_id: 'CL-1' });
  const c = R.reporte_(db, { periodo: '2026-08', hoy: '2026-10-20' });
  assert.equal(c.quality.status, 'INCOMPLETO');
  assert.ok(c.quality.reasons.some((r) => r.codigo === 'COBERTURA' && /desde el 16/.test(r.texto)));
  assert.ok(c.quality.reasons.some((r) => r.codigo === 'APERTURA'));
  assert.equal(c.metrics.meses_caja, null);
  assert.equal(c.metrics.caja_libre, null, 'sin aperturas ni cartolas completas, la caja propia no se publica como validada');
  assert.equal(c.metrics.caja_libre_estado, 'POR_DETERMINAR');
  const enCurso = R.reporte_(db, { periodo: '2026-08', hoy: '2026-08-20' });
  assert.ok(enCurso.quality.reasons.some((r) => r.codigo === 'MES_EN_CURSO'));
  assert.ok(c.series.length >= 1);
});

test('series con huecos: un mes sin datos es null, no cero', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-06-10', sentido: 'ENTRADA', monto: 1000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  op(db, D, ctx, { fecha: '2026-08-10', sentido: 'ENTRADA', monto: 2000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  const c = R.reporte_(db, { periodo: '2026-08' });
  const julio = c.series.find((s) => s.periodo === '2026-07');
  assert.deepEqual([julio.sin_datos, julio.ingresos], [true, null]);
});

test('presupuesto en otra base: «base no comparable», nunca un porcentaje falso', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-08-10', sentido: 'ENTRADA', monto: 2000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  P.guardar(db, D({ anio: 2026, empresa: 'HomePymes', expected_version: versionDe('FIN_PRESUPUESTO', '2026|HomePymes'), base: 'DOCUMENT_NET', lineas: [{ tipo: 'INGRESO', cuenta: 'Servicio Mensual', meses: Array(12).fill(1000) }] }), ctx);
  P.aprobar(db, D({ anio: 2026, empresa: 'HomePymes', expected_version: versionDe('FIN_PRESUPUESTO', '2026|HomePymes') }), ctx);
  const c = R.reporte_(db, { periodo: '2026-08', empresa: 'HomePymes' });
  assert.equal(c.comparisons.ingresos.BUDGET.estado, 'SIN_BASE');
  assert.match(c.comparisons.ingresos.BUDGET.texto, /no comparable/);
  const doc = R.reporte_(db, { periodo: '2026-08', empresa: 'HomePymes', base: 'DOCUMENT_NET' });
  assert.equal(doc.basis, 'DOCUMENT_NET');
});

test('T35 · exportar: CSV con fórmulas neutralizadas y negativos numéricos; XLSX real; misma revisión que la pantalla', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-08-10', sentido: 'SALIDA', monto: 1234, tipo: 'EGRESO', cuenta: 'Sueldos', tercero: '=HYPERLINK("x")' });
  const csv = X.exportar(db, D({ tipo: 'operaciones', formato: 'csv', filtros: { periodo: '2026-08' } }), ctx);
  const texto = Buffer.from(csv.base64, 'base64').toString('utf8');
  assert.ok(texto.charCodeAt(0) === 0xfeff, 'UTF-8 con BOM');
  assert.match(texto, /;-1234;/, 'el negativo sigue siendo número');
  assert.match(texto, /"'=HYPERLINK\(""x""\)"/, 'la fórmula queda neutralizada');
  assert.match(texto, /Revisión de datos/);
  const xlsx = X.exportar(db, D({ tipo: 'movimientos', formato: 'xlsx', filtros: { periodo: '2026-08' } }), ctx);
  assert.equal(Buffer.from(xlsx.base64, 'base64').slice(0, 2).toString(), 'PK');
  assert.equal(X.exportar(db, D({ tipo: 'informe', filtros: { periodo: '2026-08' }, data_revision: 'otra' }), ctx).codigo, 'CONFLICTO_VERSION');
  assert.ok(X.exportar(db, D({ tipo: 'informe', formato: 'csv', filtros: { periodo: '2026-08' } }), ctx).base64);
  assert.equal(X.celdaSegura_(-5), -5);
  assert.equal(X.celdaSegura_('+56 9'), "'+56 9");
});

test('T35/FIN-39 · el PDF se arma en el servidor desde el contrato; con datos cambiados pide recargar', (t) => {
  const { db, ctx, D } = preparar(t);
  op(db, D, ctx, { fecha: '2026-08-10', sentido: 'ENTRADA', monto: 5000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  const c = R.reporte(db, D({ periodo: '2026-08' }), ctx);
  const html = R.informeHtml_(c, 'Persona <Uno>', 'hoy');
  assert.match(html, /Informe financiero/);
  assert.match(html, /Persona &lt;Uno&gt;/, 'escapado');
  assert.ok(!/<script/i.test(html));
  op(db, D, ctx, { fecha: '2026-08-11', sentido: 'ENTRADA', monto: 1, tipo: 'INGRESO', cuenta: 'Servicio Mensual' });
  const r = R.informePdf(db, D({ periodo: '2026-08', data_revision: c.data_revision }), ctx);
  assert.equal(r.codigo, 'CONFLICTO_VERSION');
});

test('T40 · editar una regla: vista previa del impacto; desactivarla cambia lo pendiente y no toca lo confirmado', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['01/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 500000, '1'], ['02/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 500000, '2']]), empresa: 'HomePymes' }), ctx);
  const [a, b] = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  F.clasificar(db, D({ items: [{ id: a.id, tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' }] }), ctx);
  assert.equal(F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos.find((m) => m.id === b.id).sugerencia.certeza, 'alta');
  const regla = Rg.listar(db, D({}), ctx).reglas[0];
  const prev = Rg.guardarRegla(db, D({ id: regla.id, activa: false, previsualizar: true }), ctx);
  assert.deepEqual([prev.impacto.pendientes, prev.impacto.cambian.length], [1, 1]);
  assert.equal(Rg.listar(db, D({}), ctx).reglas[0].activa, true, 'la vista previa no guarda');
  const g = Rg.guardarRegla(db, D({ id: regla.id, activa: false, expected_version: regla.version }), ctx);
  assert.equal(g.cambiadas, 1);
  const ms = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos;
  assert.notEqual(ms.find((m) => m.id === b.id).sugerencia.certeza, 'alta');
  assert.equal(ms.find((m) => m.id === a.id).clasif.cliente_id, 'CL-1', 'lo confirmado no cambia');
  assert.equal(Rg.guardarRegla(db, D({ id: regla.id, activa: true, expected_version: 0 }), ctx).codigo, 'CONFLICTO_VERSION');
  assert.equal(Rg.listar(db, D({}), ctx).reglas[0].historial.length, 1);
});

test('T24/T36 · cierre: revisión con observación, versión reproducible; reabrir y cerrar crea otra versión', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'COMISION MANTENCION', 5000, 0, '1']]), empresa: 'HomePymes' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  F.clasificar(db, D({ items: [{ id: m.id, tipo: 'EGRESO', cuenta: 'Comisión Banco' }] }), ctx);
  assert.equal(Ci.enviarRevision(db, D({ periodo: '2026-08', nota: 'listo' }), ctx).estado, 'EN_REVISION');
  assert.ok(Ci.observar(db, D({ periodo: '2026-08', observacion: 'x' }), ctx)._validationError, 'la observación necesita texto');
  Ci.observar(db, D({ periodo: '2026-08', observacion: 'Falta revisar la comisión' }), ctx);
  assert.match(Ci.cerrar(db, D({ periodo: '2026-08' }), ctx).message, /observación/);
  Ci.resolverObservacion(db, D({ periodo: '2026-08', indice: 0, respuesta: 'revisada' }), ctx);
  const c1 = Ci.cerrar(db, D({ periodo: '2026-08' }), ctx);
  assert.deepEqual([c1.estado, c1.version], ['CERRADO', 1]);
  // Cambiar un catálogo después no altera la versión guardada.
  Cat.guardar(db, D({ tipo: 'CONCEPTO', id: 'Comisión Banco', nombre: 'Comisión Banco', grupo: 'EGRESO', activo: false }), ctx);
  const v1 = Ci.versionCierre(db, D({ periodo: '2026-08', version: 1 }), ctx);
  assert.equal(v1.grupo.metrics.egresos, 5000);
  assert.equal(v1.catalogos.conceptos.find((c) => c.id === 'Comisión Banco').activo, true, 'el catálogo de ese momento');
  Ci.reabrir(db, D({ periodo: '2026-08', motivo: 'corregir comisión' }), ctx);
  const c2 = Ci.cerrar(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(c2.version, 2);
  assert.equal(Ci.versionCierre(db, D({ periodo: '2026-08', version: 1 }), ctx).version, 1, 'la versión anterior se conserva');
  const est = Ci.estado(db, D({}), ctx).meses.find((x) => x.periodo === '2026-08');
  assert.deepEqual(est.versiones.map((v) => v.version), [2, 1]);
});

test('cierre: una cuenta sin cartola se puede dejar fuera con excepción autorizada (con motivo, a la vista)', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'COMISION', 5000, 0, '1']], { periodo: '01-08-2026 al 15-08-2026' }), empresa: 'HomePymes' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  F.clasificar(db, D({ items: [{ id: m.id, tipo: 'EGRESO', cuenta: 'Comisión Banco' }] }), ctx);
  assert.equal(Ci.verificar_('2026-08').listo, false);
  assert.ok(Ci.excepcion(db, D({ periodo: '2026-08', tipo: 'CUENTA', cuenta_ref: m.cuenta_ref, motivo: 'x' }), ctx)._validationError);
  Ci.excepcion(db, D({ periodo: '2026-08', tipo: 'CUENTA', cuenta_ref: m.cuenta_ref, motivo: 'la cuenta no tuvo movimientos después del 15' }), ctx);
  const v = Ci.verificar_('2026-08');
  assert.equal(v.listo, true);
  assert.match(v.pasos[0].detalle, /fuera de alcance/);
});

// ---------------------------------------------------------------- cargas

function libro(hojas) { return { nombre: 'libro.xlsx', hash: crypto.createHash('sha256').update(JSON.stringify(hojas)).digest('hex'), hojas }; }
const SIGECO = () => [
  { nombre: 'CATÁLOGOS', filas: [['EMPRESAS', '', 'PLAN DE CUENTAS', 'TIPO', '', 'CANALES', '', 'VENDEDORES'], ['GDE', '', 'Servicio Mensual', 'Ingreso', '', 'Referido', '', 'Vendedora Demo'], ['HomePymes Antiguo', '', 'Vacaciones', 'Provisión', '', 'Marketing'], ['PAZ']] },
  { nombre: 'CLIENTES', filas: [['ID', 'RUT', 'RAZÓN SOCIAL', 'EMPRESA FACTURADORA', 'CANAL DE CAPTACIÓN', 'VENDEDOR', 'PROYECTO ASIGNADO', '% ASIGNACIÓN', 'SERVICIO CONTRATADO', 'MONTO MENSUAL (NETO)', 'DÍA FACTURACIÓN', 'FECHA INGRESO', 'ESTADO', 'OBSERVACIONES'],
    ['C001', '76.086.428-5', 'ANDES MONTAJES INDUSTRIALES SPA', 'HomePymes Antiguo', 'Referido', 'Vendedora Demo', 'P01', '0', 'Remuneraciones', '150000', '5', '45658', 'Activo', 'cliente antiguo'],
    ['C002', '99.999.999-9', 'NO EXISTE SPA', 'GDE', '', '', '', '', '', '', '', '', 'Activo', '']] },
  { nombre: 'PROYECTOS', filas: [['ID', 'PROYECTO', 'TIPO', 'EMPRESA PATROCINADORA', 'INVERSIÓN PRESUPUESTADA', 'FECHA INICIO', 'ESTADO', 'OBSERVACIONES'], ['P01', 'Proyecto demo', 'Desarrollo', 'GDE', '8000000.0', '46082.0', 'En inversión', '']] },
  { nombre: 'FACTURAS', filas: [['N° FACTURA', 'FECHA EMISIÓN', 'ID CLIENTE', 'CLIENTE', 'EMPRESA EMISORA'], []] },
  { nombre: 'PAGOS', filas: [['FECHA PAGO', 'ID CLIENTE'], []] },
  { nombre: 'MOVIMIENTOS', filas: [['FECHA', 'MES (AAAA-MM)', 'EMPRESA', 'TIPO', 'CUENTA', 'DETALLE', 'MONTO'], []] },
  { nombre: 'CUENTA BANCARIA', filas: [['FECHA', 'BANCO', 'EMPRESA', 'TIPO', 'CLIENTE / GLOSA', 'DETALLE', 'INGRESO', 'EGRESO'], []] },
  { nombre: 'PRESUPUESTO', filas: [['AÑO', 'EMPRESA', 'TIPO', 'CUENTA', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'],
    ['2026.0', 'GDE', 'Ingreso', 'Servicio Mensual'].concat(Array(12).fill('1.0E7')), ['2026.0', 'GDE', 'Egreso', 'Sueldos'].concat(Array(12).fill('1.0E7')), ['2026.0', 'GDE', 'Egreso', 'Arriendo Mensual', 'abc']] },
  { nombre: 'MEJORAS', filas: [['FECHA', 'QUIÉN', 'HOJA', 'IDEA / MEJORA PROPUESTA', 'ESTADO', 'COMENTARIO'], ['46239.0', '', 'CUENTA BANCARIA', 'poner listado de los clientes para no escribirlos ', '', '']] },
  { nombre: 'FLUJO · GRUPO', filas: [['CONCEPTO', 'ENE'], ['Ingresos', '1']] }
];

test('T37/T42 · SIGECO: se reconoce, entra a staging con todas las hojas y se publica hoja a hoja sin duplicar', (t) => {
  const { db, ctx, D } = preparar(t);
  const lb = libro(SIGECO());
  const c = Ca.cargar(db, D(lb), ctx);
  assert.equal(c.tipo, 'SIGECO');
  assert.equal(Ca.cargar(db, D(lb), ctx).repetido, true, 'el mismo archivo no entra dos veces');
  const hojas = Ca.fuentes(db, D({}), ctx).lotes[0].hojas.map((h) => h.nombre);
  assert.equal(hojas.length, 10, 'ninguna hoja se omite');
  const pub = (hoja) => Ca.publicar(db, D({ lote_id: c.lote_id, hoja }), ctx).resultado;
  assert.deepEqual(pub('CATÁLOGOS'), { PUBLICADA: 2, INCIDENCIA: 1 }, 'PAZ no crea una empresa');
  assert.ok(Cat.buscar_('CANAL', 'Referido') && Cat.buscar_('VENDEDOR', 'Vendedora Demo'));
  pub('PROYECTOS');
  const cl = pub('CLIENTES');
  assert.deepEqual(cl, { PUBLICADA: 1, INCIDENCIA: 1 }, 'un RUT que no está en SIGSO queda como incidencia');
  const ficha = require('../logica/finanzasClientes').fichas_().get('CL-1');
  assert.deepEqual([ficha.codigo_legado, ficha.empresa_facturadora, ficha.canal], ['C001', 'HomePymes', 'Referido']);
  assert.equal(require('../logica/finanzasClientes').asignaciones_('CL-1')[0].porcentaje, 0, '0 % sigue siendo 0 %');
  assert.deepEqual(pub('CLIENTES'), { INCIDENCIA: 1 }, 'volver a publicar solo reintenta lo pendiente');
  const pr = pub('PRESUPUESTO');
  assert.deepEqual(pr, { PARCIAL: 2, INCIDENCIA: 1 }, 'valores uniformes marcados; una celda «abc» no se vuelve cero');
  assert.match(P.aprobar(db, D({ anio: 2026, empresa: 'GDE', expected_version: versionDe('FIN_PRESUPUESTO', '2026|GDE') }), ctx).message, /relleno/);
  assert.deepEqual(pub('MEJORAS'), { PUBLICADA: 1 });
  assert.deepEqual(pub('FLUJO · GRUPO'), { HISTORICA: 1 });
  const dq = Ca.dondeQuedo(db, D({ lote_id: c.lote_id, hoja: 'CLIENTES', fila: 2 }), ctx);
  assert.match(dq.destino, /ficha de ANDES/);
  assert.equal(dq.valores[0], 'C001', 'el valor original se conserva');
});

test('T04 · BANCOS: hojas ocultas incluidas; la historia de Santander repetida en otro libro no se vuelve a cargar; grupos UNITARIO', (t) => {
  const { db, ctx, D } = preparar(t);
  const bci = { nombre: 'AYS - BCI', filas: [[], ['', '', '', '', '', 'TOTAL', '0'], [], ['AB', '.', 'TOTAL', 'SALDO', 'FECHA', 'DETALLE', 'PLAN DE CUENTA', 'UNITARIO', 'OBS', 'DETALLE BANCO'],
    ['1', '', '2100000', '0', '46208', 'ARMA HIERRO', '', '', 'IMPOSICIONES', 'Transferencia recibida de Enfierradura Arma Hierro Spa'],
    ['2', '', '-1258430', '0', '46216', 'ARMA HIERRO', 'Obra A', '', 'IMPOSICIONES', 'Pago en línea previred'],
    ['3', '', '-386260', '0', '46216', 'ARMA HIERRO', 'Obra B', '', 'IMPOSICIONES', 'Pago en línea previred'],
    ['4', '', '-353571', '0', '46216', 'ARMA HIERRO', 'Obra C', '101739', 'PENDIENTE', 'Pago en línea previred']],
  formulas: [[], [], [], [], [], [], [], ['', '', '', '', '', '', '', '=+C5+C6+C7+C8']] };
  const santander = { nombre: 'HC - SANTANDER', oculta: true, filas: [[], ['AB', 'TOTAL', 'SALDO', 'FECHA', 'DETALLE', 'OBSERVACION'], ['1', '394432', '0', '46030', 'DAL', 'CREACION EMPRESA + ABONO']] };
  const julio = Ca.cargar(db, D(libro([bci, santander])), ctx);
  assert.equal(julio.tipo, 'BANCOS');
  assert.equal(julio.hojas.find((h) => h.nombre === 'HC - SANTANDER').oculta, true);
  const agosto = Ca.cargar(db, D(libro([Object.assign({}, bci, { filas: bci.filas.slice(0, 5) }), santander, { nombre: 'extra', filas: [] }])), ctx);
  const sant = agosto.hojas.find((h) => h.nombre === 'HC - SANTANDER');
  assert.deepEqual([sant.filas, sant.repetidas], [1, 1], 'la fila de Santander ya estaba en el libro de julio');
  // Publicar Santander del primer libro: un BORRADOR (sin cartola, no se confirma solo).
  assert.deepEqual(Ca.publicar(db, D({ lote_id: julio.lote_id, hoja: 'HC - SANTANDER' }), ctx).resultado, { PUBLICADA: 1 });
  const ops = Op.listar(db, D({}), ctx).operaciones;
  assert.deepEqual([ops.length, ops[0].estado, ops[0].empresa, ops[0].monto], [1, 'BORRADOR', 'Homeconsulting', 394432]);
  // BCI sin cuenta elegida: incidencia; con cuenta: sugerencias + grupo candidato con la fórmula y el remanente de la planilla.
  F.importarCartola(db, D({ filas: cartola([['21/07/2026', 'TRANSFER DE ENFIERRADURA', 0, 2100000, '1']], { periodo: '01-07-2026 al 31-07-2026' }), empresa: 'HomePymes' }), ctx);
  assert.deepEqual(Ca.publicar(db, D({ lote_id: julio.lote_id, hoja: 'AYS - BCI' }), ctx).resultado, { INCIDENCIA: 4 });
  const cuenta = F.movimientos(db, D({ periodo: '2026-07' }), ctx).movimientos[0].cuenta_ref;
  Ca.publicar(db, D({ lote_id: julio.lote_id, hoja: 'AYS - BCI', cuenta_ref: cuenta }), ctx);
  const cand = Ca.candidatas(db, D({ lote_id: julio.lote_id }), ctx);
  assert.equal(cand.grupos.length, 1);
  assert.deepEqual([cand.grupos[0].formula, cand.grupos[0].remanente_planilla, cand.grupos[0].suma, cand.grupos[0].miembros.length], ['=+C5+C6+C7+C8', 101739, 101739, 4]);
});

test('I13 · BANCOS real: filas de plantilla no se cargan; volver a publicar no borra los grupos ni falla sin filas con fecha', (t) => {
  const { db, ctx, D } = preparar(t);
  // Como el Excel real: cientos de filas con solo el correlativo y el saldo calculado, y una fila con solo texto.
  const plantilla = Array.from({ length: 50 }, (_, i) => [String(10 + i), '', '', '101739']);
  const bci = { nombre: 'AYS - BCI', filas: [['AB', '.', 'TOTAL', 'SALDO', 'FECHA', 'DETALLE', 'PLAN DE CUENTA', 'UNITARIO', 'OBS', 'DETALLE BANCO'],
    ['1', '', '2100000', '0', '46208', 'ARMA HIERRO', '', '', 'IMPOSICIONES', 'Transferencia recibida'],
    ['2', '', '-1258430', '0', '46216', 'ARMA HIERRO', 'Obra A', '', 'IMPOSICIONES', 'Pago en línea previred'],
    ['3', '', '-386260', '0', '46216', 'ARMA HIERRO', 'Obra B', '', 'IMPOSICIONES', 'Pago en línea previred'],
    ['4', '', '-353571', '0', '46216', 'ARMA HIERRO', 'Obra C', '101739', 'PENDIENTE', 'Pago en línea previred'],
    ['5', '', '', '101739', '', 'nota suelta']].concat(plantilla),
  formulas: [[], [], [], [], ['', '', '', '', '', '', '', '=+C2+C3+C4+C5']] };
  const c = Ca.cargar(db, D(libro([bci])), ctx);
  assert.deepEqual([c.hojas[0].filas, c.hojas[0].plantilla], [5, 50], 'la plantilla se cuenta, no se carga como datos');
  F.importarCartola(db, D({ filas: cartola([['21/07/2026', 'TRANSFER DE ENFIERRADURA', 0, 2100000, '1']], { periodo: '01-07-2026 al 31-07-2026' }), empresa: 'HomePymes' }), ctx);
  const cuenta = F.movimientos(db, D({ periodo: '2026-07' }), ctx).movimientos[0].cuenta_ref;
  Ca.publicar(db, D({ lote_id: c.lote_id, hoja: 'AYS - BCI', cuenta_ref: cuenta }), ctx);
  assert.equal(Ca.candidatas(db, D({ lote_id: c.lote_id }), ctx).grupos.length, 1);
  // Volver a publicar (antes: excepción por no haber filas con fecha, y los grupos quedaban vacíos).
  assert.deepEqual(Ca.publicar(db, D({ lote_id: c.lote_id, hoja: 'AYS - BCI', cuenta_ref: cuenta }), ctx).resultado, {});
  assert.equal(Ca.candidatas(db, D({ lote_id: c.lote_id }), ctx).grupos[0].remanente_planilla, 101739, 'el grupo candidato sigue ahí');
  assert.equal(require('../logica/finanzasPagadores').aprenderExcelBancos(db, D({ filas: [bci.filas[0], bci.filas[5]], cuenta }), ctx).filas, 0, 'sin filas con fecha: nada que aprender, sin error');
  assert.equal(Ca.cuadroControl(db, D({ lote_id: c.lote_id }), ctx).hojas[0].plantilla, 50);
});

test('QA-R17 · ELOHIM: dos recepciones iguales; la gestión desde la planilla toma los movimientos de ese cliente y da −1', (t) => {
  const { db, ctx, D } = preparar(t);
  const dia = (n) => { const d = new Date(Date.UTC(1899, 11, 30) + n * 864e5); return [d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear()].map((x) => String(x).padStart(2, '0')).join('/'); };
  const bci = { nombre: 'AYS - BCI', filas: [['AB', '.', 'TOTAL', 'SALDO', 'FECHA', 'DETALLE', 'PLAN DE CUENTA', 'UNITARIO', 'OBS', 'DETALLE BANCO'],
    ['1', '', '5000000', '0', '46208', 'ELOHIM', '', '', 'IMPOSICIONES', ''], ['2', '', '5000000', '0', '46208', 'ELOHIM', '', '', 'IMPOSICIONES', ''],
    ['3', '', '1302013', '0', '46208', 'ELOHIM', '', '', 'IMPOSICIONES', ''], ['4', '', '-11302014', '0', '46209', 'ELOHIM', '', '-1', 'IMPOSICIONES', '']],
  formulas: [[], [], [], [], ['', '', '', '', '', '', '', '=+C2+C3+C4+C5']] };
  // En el banco hay un TERCER abono de $5.000.000, de otro cliente, a la misma distancia que la segunda recepción.
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([[dia(46208), 'TRANSFER ELOHIM UNO', 0, 5000000, '1'], [dia(46208), 'TRANSFER ELOHIM TRES', 0, 1302013, '2'],
    [dia(46209), 'PAGO PREVIRED', 11302014, 0, '3'], [dia(46211), 'TRANSFER OTRO CLIENTE', 0, 5000000, '4'], [dia(46211), 'TRANSFER ELOHIM DOS', 0, 5000000, '5']], { anterior: 0, periodo: '01-07-2026 al 31-07-2026' }) }), ctx);
  const movs = F.movimientos(db, D({ periodo: '2026-07' }), ctx).movimientos;
  const fondo = { cuenta: 'Imposiciones', cliente_id: 'CL-1', recordar: false };
  F.clasificar(db, D({ items: movs.map((m) => Object.assign({ id: m.id, expected_version: m.version }, m.glosa === 'TRANSFER OTRO CLIENTE' ? { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-2', recordar: false }
    : m.cargo ? Object.assign({ tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION' }, fondo) : Object.assign({ tipo: 'FONDO_RECIBIDO', subtipo: 'RECEPCION' }, fondo))) }), ctx);
  const c = Ca.cargar(db, D(libro([bci])), ctx);
  Ca.publicar(db, D({ lote_id: c.lote_id, hoja: 'AYS - BCI', cuenta_ref: movs[0].cuenta_ref }), ctx);
  const r = Ca.crearGestionDeCandidata(db, D({ lote_id: c.lote_id, indice: 0, cliente_id: 'CL-1', obligacion: 'Imposiciones', periodo_obligacion: '2026-06' }), ctx);
  assert.deepEqual([r.asignadas, r.revisar.length, r.saldo_sistema, r.remanente_planilla, r.diferencia], [4, 0, -1, -1, 0], 'el abono de otro cliente no se toma por parecido');
});

test('QA-R16 · publicación interrumpida a mitad de hoja: al reintentar, cada fila queda una sola vez', (t) => {
  const { db, ctx, D } = preparar(t);
  const Base = require('../logica/finanzasBase');
  const sant = { nombre: 'HC - SANTANDER', filas: [['AB', 'TOTAL', 'SALDO', 'FECHA', 'DETALLE', 'OBSERVACION'], ['1', '394432', '0', '46030', 'DAL', 'ABONO'], ['2', '-120000', '0', '46031', 'ARRIENDO', ''], ['3', '-50000', '0', '46032', 'LUZ', '']] };
  const c = Ca.cargar(db, D(libro([sant])), ctx);
  const original = Base.transaccion_;
  let n = 0;
  Base.transaccion_ = (fn) => { if (++n === 2) throw new Error('corte simulado'); return original(fn); };
  try { assert.throws(() => Ca.publicar(db, D({ lote_id: c.lote_id, hoja: 'HC - SANTANDER' }), ctx), /corte simulado/); } finally { Base.transaccion_ = original; }
  assert.equal(Op.listar(db, D({}), ctx).operaciones.length, 1, 'la primera fila alcanzó a guardarse; nada más');
  const r = Ca.publicar(db, D({ lote_id: c.lote_id, hoja: 'HC - SANTANDER' }), ctx).resultado;
  assert.equal(Op.listar(db, D({}), ctx).operaciones.length, 3, 'tres filas, tres borradores: la ya guardada no se duplica');
  assert.equal((r.PUBLICADA || 0) + (r.REPETIDA || 0), 3);
  assert.deepEqual(Ca.publicar(db, D({ lote_id: c.lote_id, hoja: 'HC - SANTANDER' }), ctx).resultado, {}, 'un tercer intento no hace nada');
});

test('formato no soportado: error claro, no un éxito parcial', (t) => {
  const { db, ctx, D } = preparar(t);
  const r = Ca.cargar(db, D(libro([{ nombre: 'Hoja1', filas: [['a', 'b'], ['1', '2']] }])), ctx);
  assert.equal(r.codigo, 'FUENTE_NO_SOPORTADA');
  assert.equal(F.leerCartola([['x']]).error !== undefined, true);
});
