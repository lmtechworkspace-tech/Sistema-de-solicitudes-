'use strict';

/**
 * Finanzas v5.9 · segunda revisión con gerencia (02-11-2026): préstamos y aportes de socios, «¿de qué es el saldo?» de
 * cada semana de la cuenta de paso, apartados por persona y el respaldo cifrado que se abre fuera de SIGSO.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { preparar, cartola } = require('./_finanzasPrueba');
const F = require('../logica/finanzasBancos');
const H = require('../logica/finanzasHoja');
const CP = require('../logica/finanzasCuentaPaso');
const PS = require('../logica/finanzasPrestamosSocio');
const A = require('../logica/finanzasAreas');
const R = require('../logica/finanzasRespaldo');
const B = require('../logica/finanzasBoveda');
const { ejecutarAccion } = require('../server/router');

function base(t, movs, periodo) {
  const p = preparar(t);
  const { db, ctx, D } = p;
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola(movs, { periodo: periodo || '01-09-2026 al 30-09-2026', anterior: 0 }) }), ctx);
  const cuenta = B.dbFin().prepare('SELECT id FROM FIN_CUENTAS').get().id;
  const g = (campos) => { const r = H.guardar(db, D({ cuenta_ref: cuenta, campos }), ctx); assert.ok(!r._validationError, r.message); return r; };
  return Object.assign(p, { cuenta, g });
}

test('préstamos y aportes · se juntan por quién prestó, con lo que falta devolver; no son ingreso ni gasto', (t) => {
  const { db, ctx, D, cuenta, g } = base(t, [['01/09/2026', 'TRANSFER DE ROGELIO', 0, 2000000, '1'], ['05/09/2026', 'TRANSFER DE ROGELIO', 0, 500000, '2'],
    ['20/09/2026', 'TRASPASO A OTRO BANCO', 800000, 0, '3'], ['25/09/2026', 'TRANSFER DE INVERSIONES SUR', 0, 300000, '4']]);
  g({ fecha: '2026-09-01', monto: 2000000, nombre: 'ROGELIO', obs: 'ABONO', plan: 'Préstamo recibido' });
  g({ fecha: '2026-09-05', monto: 500000, nombre: 'ROGELIO', obs: 'ABONO', plan: 'Aporte de socio' });
  g({ fecha: '2026-09-20', monto: -800000, nombre: 'ROGELIO', obs: 'ABONO', plan: 'Devolución de préstamo' });
  g({ fecha: '2026-09-25', monto: 300000, nombre: 'INVERSIONES SUR', obs: 'ABONO', plan: 'Préstamo recibido' });
  const h = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx);
  assert.deepEqual(h.filas.filter((f) => f.monto === 500000).map((f) => [f.que.k, f.que.t]), [['tra', 'Aporte']], 'el aporte no es honorario');
  assert.equal(h.totales.ABONO || 0, 0, 'nada de esto suma como honorario');
  assert.ok(!PS.guardarPrestamista(db, D({ nombre: 'ROGELIO', tipo: 'GERENCIA', acordado: '$2.000.000', fecha_devolucion: '2026-10-31', nota: 'Para sueldos de septiembre' }), ctx)._validationError);
  assert.ok(PS.guardarPrestamista(db, D({ nombre: 'X', tipo: 'OTRO' }), ctx)._validationError);
  const r = PS.prestamos(db, D({}), ctx);
  const ro = r.prestamistas.find((x) => x.nombre === 'ROGELIO');
  assert.deepEqual([ro.entro, ro.devuelto, ro.saldo, ro.aportes, ro.tipo_nombre, ro.movimientos.length], [2000000, 800000, 1200000, 500000, 'Gerencia o socio', 3]);
  assert.deepEqual([r.totales.por_devolver, r.totales.aportes, r.totales.prestamistas], [1500000, 500000, 2]);
  const f = H.flujo(db, D({ hasta: '2026-09', meses: 1, cuenta_ref: cuenta }), ctx);
  assert.deepEqual([f.otros.prestamos_entran['2026-09'], f.otros.prestamos_salen['2026-09'], f.otros.aportes['2026-09']], [2300000, 800000, 500000]);
  assert.equal(f.ingresos.reduce((s, l) => s + (l.valores['2026-09'] || 0), 0), 0, 'el FLUJO no los cuenta como ingreso');
});

test('cuenta de paso · cada semana dice de qué cliente es el saldo y qué queda sin identificar', (t) => {
  const { db, ctx, D, cuenta, g } = base(t, [['02/09/2026', 'TRANSFER DE CONSTRUCTORA', 0, 700000, '1'], ['03/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '2'],
    ['04/09/2026', 'DEPOSITO EN EFECTIVO', 0, 200000, '3'], ['08/09/2026', 'PAGO CUENTAS VIA INTERNET', 500000, 0, '4'], ['09/09/2026', 'TRASPASO A OTRO BANCO', 357000, 0, '5']]);
  g({ fecha: '2026-09-02', monto: 700000, nombre: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES', grupo: 'A' });
  g({ fecha: '2026-09-03', monto: 357000, nombre: 'ANDES MONTAJES', obs: 'ABONO' });
  g({ fecha: '2026-09-08', monto: -500000, nombre: 'CONSTRUCTORA NORTE', obs: 'IMPOSICIONES', grupo: 'A' });
  g({ fecha: '2026-09-09', monto: -357000, nombre: 'BANCO EMPRESA', obs: 'ABONO', plan: 'Traspaso a cuenta empresa' });
  CP.guardar(db, D({ cuenta_ref: cuenta, desde: '2026-09' }), ctx);
  const s = H.hoja(db, D({ periodo: '2026-09', cuenta_ref: cuenta }), ctx).cuenta_paso.semanas;
  // Semana 1 (al 06-09): entró 1.257.000 → 357.000 honorario + 700.000 de Constructora Norte + 200.000 que nadie anotó.
  assert.equal(s[0].saldo, 1257000);
  assert.deepEqual(s[0].detalle.map((x) => [x.cliente, x.monto]), [['CONSTRUCTORA NORTE', 700000]]);
  assert.equal(s[0].por_traspasar, 357000);
  assert.equal(s[0].sin_completar + s[0].sin_identificar, 200000, 'el depósito sin anotar queda a la vista, no se reparte');
  // Semana 2 (al 13-09): se pagó la imposición y se traspasó el honorario → quedan 200.000 de Constructora Norte (sobró).
  assert.deepEqual(s[1].detalle.map((x) => [x.cliente, x.monto]), [['CONSTRUCTORA NORTE', 200000]]);
  assert.equal(s[1].por_traspasar, 0);
});

test('apartados · quien tiene ajuste solo usa sus apartados; quien no, todo; quien no está en la lista sigue sin ver nada', async (t) => {
  const p = preparar(t);
  const prev = process.env.SIGSO_FINANZAS_AREAS;
  t.after(() => { if (prev === undefined) delete process.env.SIGSO_FINANZAS_AREAS; else process.env.SIGSO_FINANZAS_AREAS = prev; });
  process.env.SIGSO_FINANZAS_AREAS = 'c-2:FLUJO|INFORMES';
  assert.equal(A.areaDe_('finanzasHoja'), 'PLANILLA');
  assert.equal(A.areaDe_('finanzasEntrar'), null, 'entrar no es un apartado');
  assert.equal(A.areaDe_('finanzasGuardarCatalogo'), 'AJUSTES', 'lo no listado es configuración');
  assert.equal(A.exigirArea_('finanzasHoja', p.ctx), null, 'c-1 no tiene ajuste: ve todo');
  assert.match(A.exigirArea_('finanzasHoja', p.ctx2).message, /no incluye este apartado/);
  assert.equal(A.exigirArea_('finanzasHojaFlujo', p.ctx2), null);
  assert.deepEqual(A.areasVisibles_(p.ctx2), ['FLUJO', 'INFORMES']);
  const cat = F.catalogo(p.db, p.D2({}), p.ctx2);
  assert.deepEqual(cat.areas, ['FLUJO', 'INFORMES'], 'la pantalla recibe sus apartados');
  // Las acciones de la lista de cada área existen en el router (si se renombra una, la prueba avisa).
  const { ACCIONES } = require('../server/router');
  ['finanzasHoja', 'finanzasHojaFlujo', 'finanzasPrestamosSocios', 'finanzasPanoramaClientes', 'finanzasDescargarRespaldo'].forEach((a) => assert.ok(ACCIONES[a], a));
  assert.equal(typeof ejecutarAccion, 'function');
});

test('respaldo · un archivo que se abre con la clave (fuera de SIGSO) y trae la planilla, facturas, deudas y préstamos', async (t) => {
  const { db, ctx, D, g } = base(t, [['02/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '1']]);
  g({ fecha: '2026-09-02', monto: 357000, nombre: 'ANDES MONTAJES', obs: 'ABONO', plan: 'Servicio Mensual' });
  assert.match(R.descargar(db, D({ clave: 'corta' }), ctx).message, /al menos 10/);
  const r = R.descargar(db, D({ clave: 'clave-de-prueba-123' }), ctx);
  assert.match(r.nombre, /^Respaldo Finanzas \d{4}-\d{2}-\d{2}\.html$/);
  assert.ok(!/ANDES MONTAJES/.test(r.html), 'el archivo no lleva nada legible');
  const paquete = JSON.parse(r.html.match(/var P=(\{[^;]*\});/)[1]);
  const datos = JSON.parse(R.descifrar_(paquete, 'clave-de-prueba-123'));
  const pl = datos.hojas.find((h) => /^Planilla BCI/.test(h.nombre));
  assert.ok(pl && pl.filas.some((f) => f[1] === 'ANDES MONTAJES' && f[4] === 357000));
  assert.ok(datos.hojas.some((h) => h.nombre === 'Deudas anteriores'));
  assert.throws(() => R.descifrar_(paquete, 'otra-clave-cualquiera'));
  // Automático: sin clave en el servidor no hace nada; con clave guarda la copia (y no repite la misma semana).
  const prevClave = process.env.SIGSO_FINANZAS_RESPALDO_CLAVE, prevDir = process.env.SIGSO_FINANZAS_RESPALDO_DIR, prevCorreo = process.env.SIGSO_FINANZAS_RESPALDO_CORREO;
  t.after(() => { [['SIGSO_FINANZAS_RESPALDO_CLAVE', prevClave], ['SIGSO_FINANZAS_RESPALDO_DIR', prevDir], ['SIGSO_FINANZAS_RESPALDO_CORREO', prevCorreo]].forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }); });
  delete process.env.SIGSO_FINANZAS_RESPALDO_CLAVE; delete process.env.SIGSO_FINANZAS_RESPALDO_CORREO;
  assert.equal((await R.programado(db, new Date(2026, 10, 2, 8, 1))).motivo, 'sin_clave');
  process.env.SIGSO_FINANZAS_RESPALDO_CLAVE = 'clave-del-servidor-123';
  process.env.SIGSO_FINANZAS_RESPALDO_DIR = path.join(path.dirname(process.env.SIGSO_FINANZAS_DB_PATH), 'resp');
  const a = await R.programado(db, new Date(2026, 10, 2, 8, 1));
  assert.equal(a.hecho, true);
  assert.ok(fs.existsSync(path.join(process.env.SIGSO_FINANZAS_RESPALDO_DIR, a.archivo)));
  assert.equal((await R.programado(db, new Date(2026, 10, 2, 8, 3))).motivo, 'ya_hecho');
  assert.equal(R.semanaIso_(new Date(2026, 10, 2)), '2026-S45');
});
