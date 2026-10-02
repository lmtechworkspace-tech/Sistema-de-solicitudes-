'use strict';

/**
 * Seguimiento de convenios TGR (2026-10-01): pegar la tabla de la TGR, la
 * revisión manual cuota por cuota (pagada / vencida / contabilizada), la
 * situación calculada, el estado del convenio y el puente con la matriz
 * Convenios (crear fichas desde ella y llenarla desde el seguimiento).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const CV = require('../logica/controlInternoConvenios');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const conModulo = (email, rol) => ({ email, rol: rol || 'DEV', modulos: ['control_interno'] });
const FRANCISCA = conModulo('francisca@homepymes.cl');
const LECTORA = conModulo('lectora@homepymes.cl');
const VANESSA = conModulo('vanessa@homepymes.cl');
// Los rechazos de permiso vienen como { _forbidden } (el router responde 403) o { ok: false }.
const rechazado = (r) => !!r && (r._forbidden === true || r.ok === false);

// Así se copia de "Imprimir cuotas de convenios vigentes" (con tabulaciones y el "(*)").
const TGR = [
  'Folio N°: 123456789',
  'Cuota\tFecha de Vencimiento\tMonto ($)\tPagada',
  '(*) 1\t31-03-2025\t77.717\tSI',
  '2\t30-04-2025\t1.736.315\tSI',
  '3\t31-05-2025\t77.717\tNO',
  '4\t30-06-2030\t77.717\tNO',
  '5\t31-07-2030\t0\tNO'
].join('\n');

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  ['Constructora Andes SpA', 'Pyme Sur Ltda'].forEach((n, i) => agregarFila_(db, 'CAT_CLIENTES', {
    cliente_id: 'CLI-' + (i + 1), razon_social: n, rut: '7' + i + '.111.111-1', codigo_cliente: 'HP-00' + i, contacto: '', correo: '', telefono: '',
    representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true
  }));
  // "Quién realiza" sale del nombre de la cuenta (FRANCISCA), como en la planilla.
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'C1', usuario: 'ffeliu', nombre: 'Francisca Feliú', cargo: 'Asistente', emails: JSON.stringify([FRANCISCA.email]), rol: 'DEV', modulos: '[]', empresa_id: 'HP', activo: true });
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }, { email: LECTORA.email, rol: 'LECTURA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'RRHH', miembros: [{ email: VANESSA.email, rol: 'REGISTRA' }] }, ADM);
  return db;
}
function nuevo(db, extra) {
  return CV.guardar(db, Object.assign({ cliente_id: 'CLI-1', folio: '123456789', tipo: 'iva', fecha_convenio: '2025-02-15', pie: '150.000', deuda_total: '2.000.000' }, extra || {}), FRANCISCA);
}

test('lee la tabla pegada de la TGR: montos con punto de miles, folio, (*) y cuota de ajuste', () => {
  const p = CV.parsearCuotas_(TGR);
  assert.equal(p.folio, '123456789');
  assert.equal(p.cuotas.length, 5);
  assert.deepEqual(p.cuotas[0], { n: 1, vencimiento: '2025-03-31', monto: 77717, tgr: 'SI' });
  assert.equal(p.cuotas[1].monto, 1736315);
  // También una celda por línea (como se copia de algunos navegadores) y sin encabezado.
  const porLinea = CV.parsearCuotas_('1\n31-03-2025\n$77.717\nSi\n2\n30-04-2025\n77.717\nno');
  assert.deepEqual(porLinea.cuotas.map((q) => [q.n, q.monto, q.tgr]), [[1, 77717, 'SI'], [2, 77717, 'NO']]);
  assert.equal(CV.parsearCuotas_('cualquier cosa sin cuotas').cuotas.length, 0);
  // El resumen de cambios agrupa las cuotas nuevas.
  assert.equal(CV.textoCambios_([{ n: 1, que: 'nueva' }, { n: 2, que: 'nueva' }, { n: 3, que: 'nueva' }, { n: 7, que: 'la TGR la da por pagada' }]), '3 cuotas nuevas (1-3); cuota 7 la TGR la da por pagada');
});

test('situación de cada cuota y resumen del convenio', () => {
  const c = { cuotas: CV.parsearCuotas_(TGR).cuotas };
  const r = CV.resumen_(c, '2026-10-01');
  // 1 y 2 pagadas en la TGR; 3 vencida; 4 por vencer; 5 es la de ajuste ($0, la última) y no cuenta.
  assert.equal(r.total, 4);
  assert.equal(r.pagadas, 2);
  assert.equal(r.vencidas, 1);
  assert.deepEqual(r.vencidas_n, [3]);
  assert.equal(r.por_contabilizar, 2);
  assert.equal(r.proxima.n, 4);
  assert.equal(r.termino, '2030-07-31');
  assert.equal(r.todas_pagadas, false);
  // La revisión manual "pagada" manda aunque la TGR aún no la muestre.
  c.cuotas[2].revision = 'PAGADA';
  assert.equal(CV.situacionCuota_(c.cuotas[2], c.cuotas, '2026-10-01'), 'PAGADA');
  // Una cuota no vencida que la encargada marca "vencida" cuenta como vencida.
  assert.equal(CV.situacionCuota_(Object.assign({}, c.cuotas[3], { revision: 'VENCIDA' }), c.cuotas, '2026-10-01'), 'VENCIDA');
  // Vence en 7 días.
  assert.equal(CV.resumen_(c, '2030-06-25').vencen_7_dias, 1);
});

test('crear el convenio: cliente del catálogo, folio único, tipo normalizado y cuotas pegadas', () => {
  const db = crear();
  const r = nuevo(db, { texto: TGR });
  assert.equal(r.ok, true, r.message);
  const c = r.convenio;
  assert.equal(c.cliente_nombre, 'Constructora Andes SpA');
  assert.equal(c.tipo, 'IVA');
  assert.equal(c.pie, 150000);
  assert.equal(c.deuda_total, 2000000);
  assert.equal(c.cuotas.length, 5);
  assert.ok(c.fecha_revision_tgr, 'queda la fecha de la revisión en la TGR');
  assert.match(r.message, /5 cuotas leídas/);
  // El mismo folio no se puede registrar dos veces.
  const rep = nuevo(db, { cliente_id: 'CLI-2' });
  assert.equal(rep.ok, false);
  assert.match(rep.message, /ya está registrado/);
  // Sin folio, no.
  assert.equal(nuevo(db, { folio: '' }).ok, false);
  // Cliente fuera del catálogo: entra con el nombre escrito.
  const fuera = CV.guardar(db, { cliente_nombre: 'Empresa Nueva Ltda', folio: '555' }, FRANCISCA);
  assert.equal(fuera.ok, true, fuera.message);
  assert.equal(fuera.convenio.cliente_id, '');
  assert.equal(fuera.convenio.cliente_nombre, 'Empresa Nueva Ltda');
});

test('volver a pegar conserva la revisión y lo contabilizado; rechaza otro folio', () => {
  const db = crear();
  const id = nuevo(db, { texto: TGR }).convenio.convenio_id;
  assert.equal(CV.marcarCuotas(db, { convenio_id: id, numeros: [1, 2], campo: 'contabilizada', valor: true }, FRANCISCA).ok, true);
  assert.equal(CV.marcarCuotas(db, { convenio_id: id, numeros: [3], campo: 'revision', valor: 'VENCIDA' }, FRANCISCA).ok, true);
  // Un mes después la TGR muestra la 3 pagada.
  const despues = TGR.replace('31-05-2025\t77.717\tNO', '31-05-2025\t77.717\tSI');
  const sim = CV.pegarCuotas(db, { convenio_id: id, texto: despues, simular: true }, FRANCISCA);
  assert.equal(sim.ok, true);
  assert.deepEqual(sim.cambios, [{ n: 3, que: 'la TGR la da por pagada' }]);
  assert.equal(CV.get(db, { convenio_id: id }, FRANCISCA).convenio.cuotas[2].tgr, 'NO', 'simular no guarda');
  const r = CV.pegarCuotas(db, { convenio_id: id, texto: despues }, FRANCISCA);
  assert.equal(r.ok, true);
  const q = r.convenio.cuotas;
  assert.equal(q[0].contabilizada, true, 'lo contabilizado se conserva');
  assert.equal(q[2].revision, 'PAGADA', 'la marca "vencida" pasa a pagada cuando la TGR la da por pagada');
  assert.equal(q[2].situacion, 'PAGADA');
  assert.equal(r.convenio.resumen.vencidas, 0);
  // Lo pegado de otro folio se rechaza.
  const otro = CV.pegarCuotas(db, { convenio_id: id, texto: TGR.replace('123456789', '999999') }, FRANCISCA);
  assert.equal(otro.ok, false);
  assert.match(otro.message, /folio 999999/);
  // Queda en el historial lo que cambió en la TGR.
  const h = CV.get(db, { convenio_id: id }, FRANCISCA).historial;
  assert.ok(h.some((x) => x.accion === 'TGR' && /cuota 3 la TGR la da por pagada/.test(x.detalle)));
});

test('marcar cuotas: validaciones, sin cambios y quitar la revisión', () => {
  const db = crear();
  const id = nuevo(db, { texto: TGR }).convenio.convenio_id;
  assert.equal(CV.marcarCuotas(db, { convenio_id: id, numeros: [], campo: 'revision', valor: 'PAGADA' }, FRANCISCA).ok, false);
  assert.equal(CV.marcarCuotas(db, { convenio_id: id, numeros: [1], campo: 'otro', valor: 'X' }, FRANCISCA).ok, false);
  assert.equal(CV.marcarCuotas(db, { convenio_id: id, numeros: [1], campo: 'revision', valor: 'QUIZAS' }, FRANCISCA).ok, false);
  const r = CV.marcarCuotas(db, { convenio_id: id, numeros: [4], campo: 'revision', valor: 'PAGADA' }, FRANCISCA);
  assert.equal(r.convenio.cuotas[3].situacion, 'PAGADA');
  assert.ok(r.convenio.cuotas[3].fecha_revision);
  assert.match(CV.marcarCuotas(db, { convenio_id: id, numeros: [4], campo: 'revision', valor: 'PAGADA' }, FRANCISCA).message, /Sin cambios/);
  const q = CV.marcarCuotas(db, { convenio_id: id, numeros: [4], campo: 'revision', valor: '' }, FRANCISCA).convenio.cuotas[3];
  assert.equal(q.revision, '');
  assert.equal(q.fecha_revision, '');
  assert.equal(q.situacion, 'POR_VENCER');
});

test('estado: caído pide motivo; terminado y vuelta a vigente quedan en el historial', () => {
  const db = crear();
  const id = nuevo(db).convenio.convenio_id;
  assert.equal(CV.cambiarEstado(db, { convenio_id: id, estado: 'CAIDO' }, FRANCISCA).ok, false);
  assert.equal(CV.cambiarEstado(db, { convenio_id: id, estado: 'RARO' }, FRANCISCA).ok, false);
  const r = CV.cambiarEstado(db, { convenio_id: id, estado: 'CAIDO', motivo: '3 cuotas impagas' }, FRANCISCA);
  assert.equal(r.convenio.estado, 'CAIDO');
  assert.equal(r.convenio.motivo_estado, '3 cuotas impagas');
  assert.ok(r.convenio.fecha_estado);
  assert.equal(CV.cambiarEstado(db, { convenio_id: id, estado: 'VIGENTE' }, FRANCISCA).convenio.estado, 'VIGENTE');
  const h = CV.get(db, { convenio_id: id }, FRANCISCA).historial.filter((x) => x.accion === 'ESTADO');
  assert.equal(h.length, 2);
  // Los KPIs de la lista cuentan solo los vigentes.
  CV.cambiarEstado(db, { convenio_id: id, estado: 'TERMINADO' }, FRANCISCA);
  assert.equal(CV.listar(db, {}, FRANCISCA).kpis.vigentes, 0);
  // Anular lo saca del seguimiento.
  assert.equal(CV.anular(db, { convenio_id: id }, FRANCISCA).ok, true);
  assert.equal(CV.listar(db, {}, FRANCISCA).convenios.length, 0);
});

test('permisos: los de la matriz Convenios (Contabilidad)', () => {
  const db = crear();
  const id = nuevo(db, { texto: TGR }).convenio.convenio_id;
  // Lectura: ve, simula, pero no registra.
  const l = CV.listar(db, {}, LECTORA);
  assert.equal(l.puede_registrar, false);
  assert.equal(l.convenios.length, 1);
  assert.equal(CV.pegarCuotas(db, { convenio_id: id, texto: TGR, simular: true }, LECTORA).ok, true);
  assert.ok(rechazado(CV.pegarCuotas(db, { convenio_id: id, texto: TGR }, LECTORA)));
  assert.ok(rechazado(CV.marcarCuotas(db, { convenio_id: id, numeros: [1], campo: 'contabilizada', valor: true }, LECTORA)));
  assert.ok(rechazado(CV.guardar(db, { cliente_id: 'CLI-2', folio: '77' }, LECTORA)));
  // RR.HH. no ve Contabilidad.
  assert.ok(rechazado(CV.listar(db, {}, VANESSA)));
  // Sin el módulo, nada.
  assert.ok(rechazado(CV.listar(db, {}, { email: FRANCISCA.email, rol: 'DEV', modulos: [] })));
  // ADM, todo.
  assert.equal(CV.listar(db, {}, ADM).puede_registrar, true);
});

test('crear fichas desde la matriz Convenios del mes', () => {
  const db = crear();
  const fila = CI.guardar(db, { matriz: 'CONVENIOS', periodo: '2026-M09', cliente_id: 'CLI-2', datos: {
    folio_convenio_1: '4455667', tipo_convenio_1: 'RENTA', fecha_realizo_convenio_1: '2025-05-10', pie_covenio_1: '50000', monto_total_deuda_1: '900000',
    folio_convenio_2: '8899', situacion_convenio_2: 'CAIDO'
  } }, FRANCISCA);
  assert.equal(fila.ok, true, fila.message);
  const sim = CV.desdeMatriz(db, { periodo: '2026-M09', simular: true }, FRANCISCA);
  assert.equal(sim.nuevos, 2);
  assert.equal(CV.listar(db, {}, FRANCISCA).convenios.length, 0, 'simular no crea');
  const r = CV.desdeMatriz(db, { periodo: '2026-M09' }, FRANCISCA);
  assert.equal(r.ok, true);
  const l = CV.listar(db, {}, FRANCISCA).convenios;
  const a = l.find((c) => c.folio === '4455667');
  assert.equal(a.cliente_nombre, 'Pyme Sur Ltda');
  assert.equal(a.tipo, 'RENTA');
  assert.equal(a.fecha_convenio, '2025-05-10');
  assert.equal(a.pie, 50000);
  assert.equal(l.find((c) => c.folio === '8899').estado, 'CAIDO');
  assert.equal(l.find((c) => c.folio === '4455667').cuotas.length, 0);
  // Repetir no duplica.
  assert.equal(CV.desdeMatriz(db, { periodo: '2026-M09' }, FRANCISCA).nuevos, 0);
});

test('pasar el seguimiento a la matriz Convenios del mes (crea o actualiza la fila del cliente)', () => {
  const db = crear();
  nuevo(db, { texto: TGR });
  CV.guardar(db, { cliente_id: 'CLI-1', folio: '222', tipo: 'renta', fecha_convenio: '2025-06-01' }, FRANCISCA);
  const sim = CV.aMatriz(db, { periodo: '2026-M09', simular: true }, FRANCISCA);
  assert.deepEqual([sim.clientes, sim.nuevas, sim.actualizadas], [1, 1, 0]);
  assert.equal(CI.consultar_(db, 'CI_REGISTROS', { matriz: 'CONVENIOS', periodo: '2026-M09', activa: true }).length, 0, 'simular no escribe');
  const r = CV.aMatriz(db, { periodo: '2026-M09' }, FRANCISCA);
  assert.equal(r.ok, true, r.message);
  let filas = CI.consultar_(db, 'CI_REGISTROS', { matriz: 'CONVENIOS', periodo: '2026-M09', activa: true });
  assert.equal(filas.length, 1);
  const d = filas[0].datos;
  assert.equal(filas[0].cliente_id, 'CLI-1');
  assert.equal(String(d.cantidad_convenios), '2');
  assert.equal(String(d.folio_convenio_1), '123456789', 'en orden de fecha del convenio');
  assert.equal(String(d.cuotas_canceladas_convenio_1), '2');
  assert.equal(String(d.cuotas_vencidas_convenio_1), '1');
  assert.equal(d.situacion_convenio_1, '1 CUOTA VENCIDA');
  assert.equal(d.termino_convenio_1, '2030-07-31');
  assert.equal(d.tipo_convenio_1, 'IVA');
  assert.equal(String(d.folio_convenio_2), '222');
  assert.ok(!d.situacion_convenio_2, 'sin cuotas cargadas no se inventa "AL DIA"');
  assert.equal(d.quien_realiza, 'FRANCISCA');
  assert.equal(filas[0].responsable_email, FRANCISCA.email, 'y se reconoce como su cuenta');
  // Segunda pasada: actualiza la misma fila, no crea otra.
  const id = CV.listar(db, {}, FRANCISCA).convenios.find((c) => c.folio === '123456789').convenio_id;
  CV.marcarCuotas(db, { convenio_id: id, numeros: [3], campo: 'revision', valor: 'PAGADA' }, FRANCISCA);
  const r2 = CV.aMatriz(db, { periodo: '2026-M09' }, FRANCISCA);
  assert.equal(r2.actualizadas, 1);
  filas = CI.consultar_(db, 'CI_REGISTROS', { matriz: 'CONVENIOS', periodo: '2026-M09', activa: true });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].datos.situacion_convenio_1, 'AL DIA');
  // La situación de la fila la calcula la regla de la matriz con esas columnas.
  assert.equal(filas[0].estado, 'AL_DIA');
});

test('pasar a la matriz no pisa lo que la matriz ya sabe: convenios sin cuotas y folios fuera del seguimiento', () => {
  const db = crear();
  const fila = CI.guardar(db, { matriz: 'CONVENIOS', periodo: '2026-M09', cliente_id: 'CLI-2', datos: {
    folio_convenio_1: '4455667', cuotas_canceladas_convenio_1: '5', cuotas_vencidas_convenio_1: '0', situacion_convenio_1: 'AL DIA', termino_convenio_1: '2027-01-31',
    folio_convenio_2: '8899', cuotas_canceladas_convenio_2: '2', situacion_convenio_2: '1 CUOTA VENCIDA'
  } }, FRANCISCA);
  assert.equal(fila.ok, true, fila.message);
  // Solo el primero entra al seguimiento, sin cuotas y con el pie escrito a mano.
  assert.equal(CV.guardar(db, { cliente_id: 'CLI-2', folio: '4455667', pie: '80.000' }, FRANCISCA).ok, true);
  const sim = CV.aMatriz(db, { periodo: '2026-M09', simular: true }, FRANCISCA);
  assert.deepEqual([sim.actualizadas, sim.sin_cuotas, sim.conservados], [1, 1, 1]);
  CV.aMatriz(db, { periodo: '2026-M09' }, FRANCISCA);
  const d = CI.consultar_(db, 'CI_REGISTROS', { matriz: 'CONVENIOS', periodo: '2026-M09', activa: true })[0].datos;
  assert.equal(String(d.pie_covenio_1), '80000');
  assert.equal(String(d.cuotas_canceladas_convenio_1), '5', 'sin cuotas cargadas se mantiene lo de la matriz');
  assert.equal(d.situacion_convenio_1, 'AL DIA');
  assert.equal(d.termino_convenio_1, '2027-01-31');
  assert.equal(String(d.folio_convenio_2), '8899', 'el folio que no está en el seguimiento se conserva');
  assert.equal(d.situacion_convenio_2, '1 CUOTA VENCIDA');
  assert.equal(String(d.cantidad_convenios), '2');
});

// --- Piloto "Enviar a SIGSO" (etapa 3): la página completa de la TGR ------------------------
const PAGINA = [
  'Tesorería General de la República', 'Contribuyente: CONSTRUCTORA ANDES SPA  RUT: 70.111.111-1',
  'Folio N°: 123456789', 'Cuota\tFecha de Vencimiento\tMonto ($)\tPagada',
  '(*) 1\t31-03-2025\t77.717\tSI', '2\t30-04-2025\t1.736.315\tSI', '3\t31-05-2025\t77.717\tSI',
  'Folio N°: 98765', 'Cuota\tFecha de Vencimiento\tMonto ($)\tPagada',
  '1\t10-01-2026\t50.000\tSI', '2\t10-02-2026\t50.000\tNO', 'Volver  Imprimir'
].join('\n');

test('la página de la TGR se separa por folio y trae el RUT del contribuyente', () => {
  const r = CV.bloquesTGR_(PAGINA);
  assert.equal(r.rut, '70.111.111-1');
  assert.deepEqual(r.bloques.map((b) => [b.folio, b.cuotas.length]), [['123456789', 3], ['98765', 2]]);
  // Sin folio en la página: un solo bloque sin folio.
  assert.deepEqual(CV.bloquesTGR_('1\t31-03-2025\t77.717\tSI').bloques.map((b) => b.folio), ['']);
  assert.equal(CV.bloquesTGR_('nada que ver').bloques.length, 0);
});

test('recibir desde la TGR: revisa, actualiza los que están y crea los nuevos con el cliente del RUT', () => {
  const db = crear();
  const id = nuevo(db, { texto: TGR }).convenio.convenio_id;
  CV.marcarCuotas(db, { convenio_id: id, numeros: [1], campo: 'contabilizada', valor: true }, FRANCISCA);
  const sim = CV.recibirTGR(db, { texto: PAGINA, simular: true }, FRANCISCA);
  assert.equal(sim.ok, true, sim.message);
  assert.equal(sim.cliente.cliente_id, 'CLI-1');
  const [a, b] = sim.convenios;
  assert.equal(a.convenio_id, id);
  assert.match(a.texto_cambios, /cuota 3 la TGR la da por pagada/);
  assert.equal(b.nuevo, true);
  assert.equal(CV.listar(db, {}, FRANCISCA).convenios.length, 1, 'simular no cambia nada');
  // Lectura puede revisar, no aplicar.
  assert.equal(CV.recibirTGR(db, { texto: PAGINA, simular: true }, LECTORA).ok, true);
  assert.ok(rechazado(CV.recibirTGR(db, { texto: PAGINA, crear: ['98765'] }, LECTORA)));
  const r = CV.recibirTGR(db, { texto: PAGINA, crear: ['98765'] }, FRANCISCA);
  assert.equal(r.ok, true, r.message);
  assert.deepEqual([r.actualizados, r.creados, r.errores.length], [1, 1, 0]);
  assert.equal(r.convenios[1].creado, true, 'el creado vuelve con su id para abrir la ficha');
  assert.ok(r.convenios[1].convenio_id);
  const l = CV.listar(db, {}, FRANCISCA).convenios;
  const viejo = l.find((c) => c.folio === '123456789'), nuevoC = l.find((c) => c.folio === '98765');
  assert.equal(viejo.cuotas[0].contabilizada, true, 'lo marcado a mano se conserva');
  assert.equal(viejo.cuotas[2].situacion, 'PAGADA');
  assert.equal(nuevoC.cliente_id, 'CLI-1');
  assert.equal(nuevoC.cuotas.length, 2);
  assert.ok(CV.get(db, { convenio_id: id }, FRANCISCA).historial.some((h) => h.accion === 'TGR' && /^Recibido desde la TGR/.test(h.detalle)));
});

test('recibir: un folio nuevo sin cliente reconocible pide elegirlo; con cliente_id se crea', () => {
  const db = crear();
  const pagina = PAGINA.replace('70.111.111-1', '99.999.999-9');
  const sim = CV.recibirTGR(db, { texto: pagina, simular: true }, FRANCISCA);
  assert.equal(sim.cliente, null);
  let r = CV.recibirTGR(db, { texto: pagina, crear: ['98765'] }, FRANCISCA);
  assert.equal(r.creados, 0);
  assert.match(r.errores[0], /elige el cliente/);
  r = CV.recibirTGR(db, { texto: pagina, crear: ['98765'], cliente_id: 'CLI-2' }, FRANCISCA);
  assert.equal(r.creados, 1);
  assert.equal(CV.listar(db, {}, FRANCISCA).convenios[0].cliente_nombre, 'Pyme Sur Ltda');
  assert.equal(CV.recibirTGR(db, { texto: 'Bienvenido a la TGR' }, FRANCISCA).ok, false);
});

test('página real de la TGR sin folio (solo la tabla): se lee y se asigna al convenio elegido', () => {
  const db = crear();
  const id = nuevo(db).convenio.convenio_id;
  // Así viene el texto de "Imprimir Cuotas de Convenios Vigentes" (2-10-2026): sin folio ni RUT.
  const pagina = ['IMPRIMIR CUOTAS', 'Cuota\tFecha de Vencimiento\tMonto ($)\tPagada',
    '(*) 1\t31-12-2025\t97.570\tSI', '(*) 2\t31-01-2026\t190.039\tSI', '(*) 7\t30-06-2026\t190.039\tSI',
    '(*) 8\t31-07-2026\t190.039\tNO', '10\t30-09-2026\t190.039\tNO', '12\t30-11-2026\t0\tNO',
    'La Cuota de Ajuste es la última cuota del convenio'].join('\n');
  const sim = CV.recibirTGR(db, { texto: pagina, simular: true }, FRANCISCA);
  assert.equal(sim.ok, true, sim.message);
  assert.deepEqual([sim.convenios[0].folio, sim.convenios[0].nuevo, sim.convenios[0].leidas], ['', true, 6]);
  // Sin elegir convenio no se aplica nada.
  assert.equal(CV.recibirTGR(db, { texto: pagina }, FRANCISCA).actualizados, 0);
  const con = CV.recibirTGR(db, { texto: pagina, simular: true, asignar: { 0: id } }, FRANCISCA).convenios[0];
  assert.deepEqual([con.convenio_id, con.asignado, con.folio_convenio], [id, true, '123456789']);
  assert.match(con.texto_cambios, /6 cuotas nuevas/);
  const r = CV.recibirTGR(db, { texto: pagina, asignar: { 0: id } }, FRANCISCA);
  assert.equal(r.actualizados, 1);
  const c = CV.get(db, { convenio_id: id }, FRANCISCA).convenio;
  assert.equal(c.cuotas.length, 6);
  assert.equal(c.cuotas.find((q) => q.n === 12).situacion, 'AJUSTE');
});
