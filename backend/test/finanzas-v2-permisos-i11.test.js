'use strict';

/**
 * Finanzas · corrección v2, I11 (2026-10-21): permisos, concurrencia, revisión
 * y cierre. Matriz de permisos probada por API sobre TODAS las acciones del
 * router; actualizar sin la versión vista no pisa; política de cierre
 * configurable; excepciones con evidencia y limitación que no se borran;
 * cierre, reapertura y nuevo cierre con versiones consultables. Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, cartola, versionDe } = require('./_finanzasPrueba');
const { ACCIONES } = require('../server/router');
const Base = require('../logica/finanzasBase');
const B = require('../logica/finanzasBoveda');
const F = require('../logica/finanzasBancos');
const Op = require('../logica/finanzasOperaciones');
const Ci = require('../logica/finanzasCierre');
const Cat = require('../logica/finanzasCatalogos');
const R = require('../logica/finanzasReportes');

// Lecturas conocidas (todo lo demás escribe y debe pedir capacidad). Si se agrega una escritura sin capacidad, esta prueba falla.
const LECTURAS = ['finanzasResumen', 'finanzasLibro', 'finanzasLibroNombres', 'finanzasLibroFlujo', 'finanzasLibroClientes', 'finanzasHoja', 'finanzasHojaFlujo', 'finanzasHojaClientes', 'finanzasHojaCobranza', 'finanzasBitacora', 'finanzasCatalogo', 'finanzasRevisarCartola', 'finanzasMovimientos', 'finanzasResumenBancos', 'finanzasRevisarVentas', 'finanzasCobranza',
  'finanzasFichaCliente', 'finanzasInformePdf', 'finanzasPresupuesto', 'finanzasCierre', 'finanzasRevisarAntes', 'finanzasElMes', 'finanzasRevisarExcelBancos', 'finanzasCatalogos', 'finanzasOperaciones',
  'finanzasOperacion', 'finanzasPerfiles', 'finanzasRevisarOperacion', 'finanzasFuentesObligacion', 'finanzasFuenteObligacion', 'finanzasPrevisualizarPlantillas', 'finanzasConciliacion', 'finanzasCandidatos',
  'finanzasFondos', 'finanzasFichaFondos', 'finanzasClientes', 'finanzasCliente', 'finanzasDescargarAdjunto', 'finanzasRelacionesCobro', 'finanzasFacturas', 'finanzasCobrosElegibles', 'finanzasPendientes',
  'finanzasPrevisualizarReparto', 'finanzasGastosCompartidos', 'finanzasPrestamos', 'finanzasProyectos', 'finanzasProvisiones', 'finanzasCompromisos', 'finanzasProyeccion', 'finanzasReporte',
  'finanzasReporteDetalle', 'finanzasExportar', 'finanzasReglas', 'finanzasFuentes', 'finanzasFuente', 'finanzasCuadroControl', 'finanzasCandidatas', 'finanzasDondeQuedo', 'finanzasMejoras', 'finanzasVersionCierre'];
const ACCESO = ['finanzasEstado', 'finanzasPrepararAutenticador', 'finanzasActivarAutenticador', 'finanzasEntrar', 'finanzasSalir'];
// Escrituras que validan el nombre de la acción antes del permiso (sin escribir nada).
const VALIDAN_ANTES = ['finanzasDecidirApertura'];
const op = (db, D, ctx, o) => Op.guardar(db, D(Object.assign({ empresa: 'HomePymes', medio: 'EFECTIVO', confirmar: true, fecha: '2026-08-05', sentido: 'ENTRADA', monto: 1000, tipo: 'INGRESO', cuenta: 'Servicio Mensual' }, o)), ctx);

test('I11.1 · matriz por API: con solo lectura, toda escritura pide capacidad y nada cambia; las lecturas responden', (t) => {
  const { db, ctx, ctx2, D, D2 } = preparar(t, { soloLectura: true });
  op(db, D, ctx, {});
  const nombres = Object.keys(ACCIONES).filter((k) => /^finanzas/.test(k) && ACCESO.indexOf(k) === -1);
  assert.ok(nombres.length >= 120, 'se probaron ' + nombres.length + ' acciones');
  const fallas = [];
  for (const n of nombres) {
    const antes = Base.revision_();
    let r;
    try { r = ACCIONES[n](db, D2({}), ctx2); } catch (e) { r = { _excepcion: e.message }; }
    if (Base.revision_() !== antes) fallas.push(n + ': cambió datos');
    if (r && r._excepcion) { fallas.push(n + ': ' + r._excepcion); continue; }
    if (r && typeof r.then === 'function') continue; // el PDF (asíncrono) exige EXPORTAR, que solo lectura tiene
    const permiso = r && (r._forbidden || r.codigo === 'PERMISO');
    if (LECTURAS.indexOf(n) !== -1) { if (permiso && !r.boveda_cerrada) fallas.push(n + ': una lectura pidió permiso'); }
    else if (!permiso && VALIDAN_ANTES.indexOf(n) === -1) fallas.push(n + ': una escritura respondió sin pedir capacidad');
  }
  assert.deepEqual(fallas, []);
  // La que valida antes, con datos válidos, también pide capacidad.
  assert.equal(ACCIONES.finanzasDecidirApertura(db, D2({ id: 'x', accion: 'APROBAR' }), ctx2).codigo, 'PERMISO');
});

test('I11.1 · capacidades finas: quien solo registra no aplica, no cierra ni configura', (t) => {
  const { db, ctx, D } = preparar(t, { capacidades: 'c-1:CONSULTAR|REGISTRAR' });
  assert.ok(op(db, D, ctx, { confirmar: false }).id, 'registrar borradores sí');
  ['finanzasCerrarMes', 'finanzasAplicar', 'finanzasGuardarCatalogo', 'finanzasGuardarRegla', 'finanzasAprobarPresupuesto', 'finanzasExportar'].forEach((n) => {
    assert.equal(ACCIONES[n](db, D({ periodo: '2026-08', tipo: 'informe' }), ctx).codigo, 'PERMISO', n);
  });
});

test('I11.2 · actualizar sin la versión vista no pisa (antes se aceptaba); con versión vieja, conflicto', (t) => {
  const { db, ctx, D } = preparar(t);
  const a = op(db, D, ctx, { confirmar: false, monto: 120 });
  const sin = Op.guardar(db, D({ id: a.id, empresa: 'HomePymes', medio: 'EFECTIVO', fecha: '2026-08-05', sentido: 'ENTRADA', monto: 999, tipo: 'INGRESO', cuenta: 'Servicio Mensual' }), ctx);
  assert.equal(sin.codigo, 'VERSION_REQUERIDA');
  assert.equal(Op.porId_(a.id).monto, 120, 'no se pisó');
  const vieja = Op.guardar(db, D({ id: a.id, expected_version: 0, empresa: 'HomePymes', medio: 'EFECTIVO', fecha: '2026-08-05', sentido: 'ENTRADA', monto: 999, tipo: 'INGRESO', cuenta: 'Servicio Mensual' }), ctx);
  assert.equal(vieja.codigo, 'CONFLICTO_VERSION');
  // Un movimiento ya confirmado no se reclasifica sin su versión.
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE CLIENTE', 0, 5000, '1']]), empresa: 'HomePymes' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  const primera = F.clasificar(db, D({ items: [{ id: m.id, tipo: 'INGRESO', cuenta: 'Servicio Mensual' }] }), ctx);
  assert.equal(primera.hechos, 1, 'la primera clasificación de un pendiente: ' + JSON.stringify(primera.errores));
  const r = F.clasificar(db, D({ items: [{ id: m.id, tipo: 'INGRESO', cuenta: 'Otros Ingresos' }] }), ctx);
  assert.equal(r.errores[0].codigo, 'VERSION_REQUERIDA');
  assert.equal(F.clasificar(db, D({ items: [{ id: m.id, expected_version: versionDe('FIN_MOVIMIENTOS', m.id), tipo: 'INGRESO', cuenta: 'Otros Ingresos' }] }), ctx).hechos, 1);
  // Idempotencia: misma clave con otro contenido, conflicto; con el mismo, el mismo resultado.
  const k1 = op(db, D, ctx, { idempotency_key: 'k-i11', monto: 7000 });
  assert.equal(op(db, D, ctx, { idempotency_key: 'k-i11', monto: 7000 }).id, k1.id);
  assert.equal(op(db, D, ctx, { idempotency_key: 'k-i11', monto: 8000 }).codigo, 'IDEMPOTENCIA');
});

test('I11.3 · política de cierre configurable: exige revisión y dos personas; con la política por defecto se cierra como siempre', (t) => {
  const { db, ctx, ctx2, D, D2 } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE CLIENTE', 0, 5000, '1']], { periodo: '01-08-2026 al 31-08-2026' }), empresa: 'HomePymes' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  F.clasificar(db, D({ items: [{ id: m.id, tipo: 'INGRESO', cuenta: 'Servicio Mensual' }] }), ctx);
  assert.equal(Ci.estado(db, D({}), ctx).meses.find((x) => x.periodo === '2026-08').listo, true, 'el mes de prueba cumple lo obligatorio');
  const p = Cat.lista_('PARAMETRO', { todos: true });
  const setParam = (id, valor) => { const c = p.find((x) => x.id === id); const r = Cat.guardar(db, D({ tipo: 'PARAMETRO', id: c.id, nombre: c.nombre, valor, expected_version: c.version }), ctx); assert.ok(!r._validationError, r.message); };
  setParam('cierre_exige_revision', 1); setParam('cierre_dos_personas', 1);
  assert.equal(Ci.politicaCierre_().exige_revision, true);
  assert.match(Ci.cerrar(db, D({ periodo: '2026-08' }), ctx).message, /exige enviar/);
  Ci.enviarRevision(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(Ci.cerrar(db, D({ periodo: '2026-08' }), ctx).codigo, 'PERMISO', 'quien envió no cierra');
  assert.equal(Ci.cerrar(db, D2({ periodo: '2026-08' }), ctx2).estado, 'CERRADO', 'otra persona sí');
});

test('I11.4/I11.5 · excepción con evidencia y limitación, visible en el informe; quitarla no la borra; cierre, reapertura y nuevo cierre con versiones', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['05/08/2026', 'TRANSFER DE CLIENTE', 0, 5000, '1']]), empresa: 'HomePymes' }), ctx);
  const cta = F.resumenBancos(db, D({}), ctx).cuentas[0];
  const mov = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  F.clasificar(db, D({ items: [{ id: mov.id, tipo: 'INGRESO', cuenta: 'Servicio Mensual' }] }), ctx);
  // Un cliente con fondos y sin saldo inicial aprobado: el paso «aperturas» falta y la excepción tiene sobre qué actuar.
  op(db, D, ctx, { fecha: '2026-08-10', monto: 30000, tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-2' });
  assert.ok(Ci.excepcion(db, D({ periodo: '2026-08', tipo: 'IDENTIDAD', motivo: 'quiero cerrar igual' }), ctx)._validationError, 'no se exceptúa un invariante');
  Ci.excepcion(db, D({ periodo: '2026-08', tipo: 'APERTURAS', motivo: 'faltan saldos de dos clientes', evidencia: 'correo de contabilidad' }), ctx);
  Ci.excepcion(db, D({ periodo: '2026-08', tipo: 'CUENTA', cuenta_ref: cta.id, motivo: 'cuenta sin movimientos, el banco no emite cartola' }), ctx);
  let lista = Ci.excepcionesLista_('2026-08');
  const ap = lista.find((e) => e.tipo === 'APERTURAS');
  assert.deepEqual([ap.evidencia, ap.aprobado_por, ap.vigente], ['correo de contabilidad', 'Persona Uno', true]);
  assert.match(ap.limitacion, /disponibilidad propia sigue no determinable/);
  const c = R.reporte_(db, { periodo: '2026-08' });
  assert.equal(c.excepciones.length, 2, 'el informe las muestra');
  assert.notEqual(c.evaluacion.caja_libre.status, 'DETERMINED', 'aceptar la falta de apertura no habilita la disponibilidad propia');
  assert.ok(R.informeHtml_(c, 'x', 'hoy').indexOf('Excepciones aceptadas') !== -1);
  Ci.excepcion(db, D({ periodo: '2026-08', tipo: 'CUENTA', cuenta_ref: cta.id, quitar: true, motivo: 'ya llegó la cartola' }), ctx);
  lista = Ci.excepcionesLista_('2026-08');
  assert.deepEqual(lista.map((e) => [e.tipo, e.vigente]), [['APERTURAS', true], ['CUENTA', false]], 'la quitada sigue en la historia');
  // Cierre → reapertura con motivo → nuevo cierre: las dos versiones quedan consultables.
  const est = Ci.estado(db, D({}), ctx).meses.find((x) => x.periodo === '2026-08');
  assert.equal(est.listo, true, 'el mes cumple lo obligatorio (con la excepción de aperturas)');
  const v1 = Ci.cerrar(db, D({ periodo: '2026-08' }), ctx);
  Ci.reabrir(db, D({ periodo: '2026-08', motivo: 'faltaba una comisión' }), ctx);
  const v2 = Ci.cerrar(db, D({ periodo: '2026-08' }), ctx);
  assert.deepEqual([v1.version, v2.version], [1, 2]);
  const ver1 = Ci.versionCierre(db, D({ periodo: '2026-08', version: 1 }), ctx);
  assert.equal(ver1.aprobacion.excepciones.length, 2, 'la versión 1 guarda las excepciones como estaban');
});
