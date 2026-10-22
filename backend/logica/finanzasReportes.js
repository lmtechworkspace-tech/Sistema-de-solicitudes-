'use strict';

/**
 * finanzasReportes.js — UN servicio de cifras para la pantalla, los
 * comentarios automáticos, el PDF y la exportación (2026-10-20; FIN-34 a
 * FIN-39, anexo D).
 *
 * Contrato (lo mismo para todos los que muestran cifras):
 *   { scope, period, as_of, basis, comparison, quality, data_revision,
 *     metrics, comparisons, series, breakdowns, insights, definiciones, generated_at }
 *
 *  - BASE: CASH_GROSS (cobros y pagos propios clasificados, monto completo,
 *    con su situación de conciliación a la vista) o DOCUMENT_NET (facturas
 *    netas por fecha de emisión). No se mezclan.
 *  - COMPARACIONES (FIN-35): mes anterior, presupuesto aprobado de la misma
 *    base y mismo mes del año anterior (solo con datos). Base cero, cambio de
 *    signo, falta de base y mes en curso tienen su propio resultado: nunca un
 *    porcentaje infinito o engañoso.
 *  - CALIDAD (FIN-37): pendientes, cuentas sin la cartola completa, saldos
 *    iniciales de fondos que faltan, operaciones sin banco, mes en curso,
 *    cartolas que no cuadraron. «Completo» no es solo «sin pendientes».
 *  - COMENTARIOS (FIN-36): primero hechos calculados (regla, versión,
 *    severidad, actual, base, diferencia, contribuciones, calidad, evidencia,
 *    acciones); después el texto. Nunca una causa que los datos no muestran.
 *  - PDF (FIN-39): el servidor arma el informe desde el MISMO contrato (no
 *    imprime HTML enviado por el navegador). Si los datos cambiaron desde que
 *    se abrió la pantalla, pide recargar.
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const Cat = require('./finanzasCatalogos');
const FB = require('./finanzasBancos');
const H = require('./finanzasHechos');
const { errorValidacion } = require('./errores');

const I = FB.interno;
const VERSION_REGLAS = 1;
const BASES = { CASH_GROSS: 'Caja bruta', DOCUMENT_NET: 'Documental neta' };
const COMPARADORES = { PREVIOUS_PERIOD: 'Mes anterior', BUDGET: 'Presupuesto aprobado', SAME_PERIOD_LAST_YEAR: 'Mismo mes del año anterior' };

const DEFINICIONES = {
  ingresos: { nombre: 'Cobros propios', formula: 'Suma de «Ingreso de la empresa» confirmados del mes (banco y registro sin conciliar), sin compensaciones. Lo registrado que podría ser el mismo dinero que un movimiento del banco ya clasificado no se suma: cuenta el banco y lo registrado queda como «pendiente de identidad».', base: 'CASH_GROSS' },
  pendiente_identidad: { nombre: 'Pendiente de identidad', formula: 'Operaciones registradas con el mismo monto, sentido y empresa que un movimiento del banco ya clasificado (±N días). No se suman hasta que una persona las vincule (un solo hecho) o marque que son pagos distintos (cuentan los dos).' },
  egresos: { nombre: 'Pagos propios', formula: 'Suma de «Gasto de la empresa» confirmados del mes; un gasto compartido cuenta solo la parte de la empresa.', base: 'CASH_GROSS' },
  flujo_propio: { nombre: 'Flujo propio', formula: 'Cobros propios − pagos propios. No es utilidad contable: el dinero de clientes, los traspasos y los préstamos van aparte.', base: 'CASH_GROSS' },
  ventas_netas: { nombre: 'Ventas netas facturadas', formula: 'Neto + exento de las facturas emitidas en el mes, menos notas de crédito del mes.', base: 'DOCUMENT_NET' },
  fondos_recibidos: { nombre: 'Fondos de clientes recibidos', formula: 'Dinero que los clientes mandaron para sus obligaciones (no es ingreso).' },
  fondos_pagados: { nombre: 'Pagado por cuenta de clientes', formula: 'Pagos hechos con el dinero de los clientes (no es gasto).' },
  caja: { nombre: 'Saldo bancario al corte', formula: 'Último saldo de cada cuenta bancaria incluida en sus cartolas hasta el corte (fecha del banco), con la cobertura de cada una. Solo cuentas bancarias: no incluye caja chica. No es, por sí solo, dinero propio.' },
  custodia: { nombre: 'Fondos administrados de clientes', formula: 'Por cliente: saldo inicial aprobado + recibido − pagado. Se suman por separado los saldos a favor y los déficit (el déficit de uno no reduce lo de otro).' },
  caja_libre: { nombre: 'Disponibilidad propia', formula: 'Saldo bancario al corte − suma de los saldos A FAVOR de cada cliente. Solo se determina con cartolas completas al corte, saldos iniciales aprobados de todos los clientes con fondos, sin importes por clasificar y sin posibles duplicados. Si falta algo: «no determinable» (la resta se muestra aparte como referencia, no como disponibilidad).' },
  meses_caja: { nombre: 'Meses de caja', formula: 'Disponibilidad propia ÷ pagos propios promedio de los últimos 3 meses con pagos. Solo con disponibilidad propia determinada.' },
  por_cobrar: { nombre: 'Por cobrar (hoy)', formula: 'Lo que falta de cada factura vigente, con las aplicaciones confirmadas y sugeridas. Corte: hoy.' },
  sin_aplicar: { nombre: 'Abonos sin aplicar', formula: 'Cobros propios con cliente que todavía no se aplicaron a una factura (no es dinero en custodia).' }
};

// ---------------------------------------------------------------- comparación (FIN-35)

/**
 * Compara un valor con su base. Devuelve { actual, base, diferencia, pct,
 * estado, texto }. Estados: COMPARABLE, AMBOS_CERO, BASE_CERO, CAMBIO_SIGNO,
 * BASE_NEGATIVA, SIN_BASE.
 */
function comparar_(actual, base, opciones) {
  opciones = opciones || {};
  if (base === null || base === undefined || (typeof base === 'number' && !isFinite(base))) return { actual, base: null, diferencia: null, pct: null, estado: 'SIN_BASE', texto: 'Sin base comparable' };
  if (actual === null || actual === undefined) return { actual: null, base, diferencia: null, pct: null, estado: 'SIN_BASE', texto: 'Sin dato actual' };
  const diferencia = actual - base;
  if (opciones.puntos) return { actual, base, diferencia, pct: null, estado: 'COMPARABLE', texto: (diferencia >= 0 ? '+' : '') + diferencia.toFixed(1).replace('.', ',') + ' pp' };
  if (base === 0 && actual === 0) return { actual, base, diferencia: 0, pct: 0, estado: 'AMBOS_CERO', texto: 'Sin variación' };
  if (base === 0) return { actual, base, diferencia, pct: null, estado: 'BASE_CERO', texto: 'Base cero: ' + Base.plata_(diferencia) };
  if (base < 0 || (actual < 0) !== (base < 0)) return { actual, base, diferencia, pct: null, estado: base < 0 && actual < 0 ? 'BASE_NEGATIVA' : 'CAMBIO_SIGNO', texto: (diferencia >= 0 ? '+' : '') + Base.plata_(diferencia) + (actual < 0 !== base < 0 ? ' (cambió de signo)' : '') };
  const pct = Math.round(diferencia / base * 1000) / 10;
  return { actual, base, diferencia, pct, estado: 'COMPARABLE', texto: (diferencia >= 0 ? '+' : '') + Base.plata_(diferencia) + ' (' + (pct >= 0 ? '+' : '') + String(pct).replace('.', ',') + ' %)' };
}

// ---------------------------------------------------------------- piezas del cálculo

function vacio_() { return { ingresos: 0, egresos: 0, fondos_recibidos: 0, fondos_pagados: 0, traspasos: 0, prestamos_entra: 0, prestamos_sale: 0, pendientes: 0, pendiente_monto: 0, sin_banco: 0, sin_banco_monto: 0, hechos: 0 }; }
function acumular_(o, h, monto) {
  if (!monto) return;
  o.hechos++;
  const c = h.clasif;
  if (!c) { o.pendientes++; o.pendiente_monto += monto; return; }
  if (h.sin_banco) { o.sin_banco++; o.sin_banco_monto += monto; }
  if (h.caja === false) return; // una compensación no es caja
  if (c.tipo === 'INGRESO') o.ingresos += monto;
  else if (c.tipo === 'EGRESO') o.egresos += monto;
  else if (c.tipo === 'FONDO_RECIBIDO') o.fondos_recibidos += monto;
  else if (c.tipo === 'FONDO_PAGADO') o.fondos_pagados += monto;
  else if (c.tipo === 'TRASPASO') o.traspasos += monto;
  else if (c.tipo === 'PRESTAMO') { if (h.abono) o.prestamos_entra += monto; else o.prestamos_sale += monto; }
}
function porPeriodo_(hechos, emp) {
  const m = new Map();
  hechos.forEach((h) => {
    const v = H.parteEmpresa_(h, emp);
    if (!v) return;
    if (!m.has(h.periodo)) m.set(h.periodo, vacio_());
    acumular_(m.get(h.periodo), h, v);
  });
  m.forEach((o) => { o.flujo_propio = o.ingresos - o.egresos; });
  return m;
}
function ventasNetas_(empresa) {
  const m = new Map();
  try {
    require('./finanzasCobranza');
    I.db_().prepare("SELECT empresa, periodo, datos FROM FIN_FACTURAS WHERE estado != 'ANULADA'").all().forEach((r) => {
      if (empresa && r.empresa !== empresa) return;
      const f = I.des_(r.datos);
      const neto = (Number(f.neto) || 0) + (Number(f.exento) || 0);
      m.set(r.periodo, (m.get(r.periodo) || 0) + (Number(f.tipo_doc) === 61 ? -neto : neto));
    });
  } catch (e) { /* sin facturas */ }
  return m;
}
function porConcepto_(hechos, periodo, emp, tipo) {
  const o = {};
  hechos.filter((h) => h.periodo === periodo && h.clasif && h.clasif.tipo === tipo && h.caja !== false).forEach((h) => {
    const v = H.parteEmpresa_(h, emp); if (!v) return;
    o[h.clasif.cuenta || '(sin concepto)'] = (o[h.clasif.cuenta || '(sin concepto)'] || 0) + v;
  });
  return o;
}

// ---------------------------------------------------------------- calidad (FIN-37)

function calidad_(db, periodo, emp, mesDatos, hoy, conflictos) {
  const razones = [];
  const add = (codigo, nivel, texto, extra) => razones.push(Object.assign({ codigo, nivel, texto }, extra || {}));
  if (!mesDatos || !mesDatos.hechos) add('SIN_DATOS', 'INCOMPLETO', 'No hay movimientos de ' + Base.nombreMes_(periodo) + (emp ? ' para ' + emp : '') + '.', { evidencia: { vista: 'bancos' } });
  try {
    const v = require('./finanzasCierre').verificar_(periodo);
    const cartolas = v.pasos.find((p) => p.id === 'cartolas');
    const cobertura = (v.cobertura || []).filter((c) => !emp || c.empresa === emp);
    const faltan = cobertura.filter((c) => !c.completa);
    if (faltan.length) add('COBERTURA', 'INCOMPLETO', 'Faltan cartolas: ' + faltan.map((c) => c.cuenta + (c.hasta ? ' desde el ' + Base.sumarDias_(c.hasta, 1).slice(8) : ' (todo el mes)')).join(' · ') + '.', { evidencia: { vista: 'cargas' } });
    else if (!cobertura.length && cartolas && !cartolas.ok) add('COBERTURA', 'INCOMPLETO', cartolas.detalle, { evidencia: { vista: 'cargas' } });
    const cuadra = v.pasos.find((p) => p.id === 'cuadra');
    if (cuadra && !cuadra.ok && mesDatos && mesDatos.hechos) add('DESCUADRE', 'INCOMPLETO', cuadra.detalle, { evidencia: { vista: 'cargas' } });
  } catch (e) { /* sin cierre */ }
  if (mesDatos && mesDatos.pendientes) add('PENDIENTES', 'PROVISIONAL', mesDatos.pendientes + ' movimiento(s) sin revisar por ' + Base.plata_(mesDatos.pendiente_monto) + '.', { cantidad: mesDatos.pendientes, monto: mesDatos.pendiente_monto, evidencia: { vista: 'movimientos', filtros: { periodo, filtro: 'pendientes' } } });
  // I01: posible duplicado entre lo registrado y un movimiento del banco ya clasificado. Cuenta el banco;
  // lo registrado queda aparte hasta que una persona vincule o marque «son distintas».
  if (conflictos && conflictos.length) {
    const monto = conflictos.reduce((t, c) => t + c.monto, 0);
    add('CONFLICTO_IDENTIDAD', 'PROVISIONAL', conflictos.length + ' operación(es) registrada(s) por ' + Base.plata_(monto) + ' podrían ser el mismo dinero que un movimiento del banco ya clasificado: cuenta el banco y lo registrado queda aparte hasta vincularlos o marcar que son distintos.',
      { cantidad: conflictos.length, monto, evidencia: { vista: 'conciliacion', filtros: { periodo } } });
  }
  if (mesDatos && mesDatos.sin_banco) add('SIN_BANCO', 'PROVISIONAL', mesDatos.sin_banco + ' operación(es) registradas todavía sin su movimiento del banco (' + Base.plata_(mesDatos.sin_banco_monto) + ').', { cantidad: mesDatos.sin_banco, monto: mesDatos.sin_banco_monto, evidencia: { vista: 'conciliacion', filtros: { periodo } } });
  try {
    const c = require('./finanzasFondos').custodiaAl_(Base.ultimoDia_(periodo), emp);
    if (c.sin_apertura) add('APERTURA', 'PROVISIONAL', c.sin_apertura + ' cliente(s) con dinero en custodia sin saldo inicial aprobado: su saldo es parcial.', { cantidad: c.sin_apertura, evidencia: { vista: 'fondos' } });
  } catch (e) { /* sin fondos */ }
  if (periodo === hoy.slice(0, 7)) add('MES_EN_CURSO', 'PROVISIONAL', 'El mes está en curso (corte ' + hoy + '): no se compara como un mes completo.', {});
  let cerrado = false;
  try { cerrado = require('./finanzasCierre').mesCerrado_(periodo); } catch (e) { cerrado = false; }
  const estado = razones.some((r) => r.nivel === 'INCOMPLETO') ? 'INCOMPLETO' : razones.length ? 'PROVISIONAL' : 'COMPLETO';
  return { status: estado, cerrado, pending_count: mesDatos ? mesDatos.pendientes : 0, pending_amount: mesDatos ? mesDatos.pendiente_monto : 0, reasons: razones };
}

// ---------------------------------------------------------------- evaluación por métrica (I03.3)

/**
 * Cada métrica declara qué razones de calidad la vuelven NO determinable
 * (amount null) y cuáles solo provisoria. Un faltante no invalida todas las
 * cifras por igual: una apertura desconocida impide la disponibilidad propia,
 * pero no los cobros del mes. null = desconocido; 0 = importe conocido cero.
 */
const FLUJO_ = { bloquea: ['SIN_DATOS'], provisoria: ['COBERTURA', 'DESCUADRE', 'PENDIENTES', 'CONFLICTO_IDENTIDAD', 'SIN_BANCO', 'MES_EN_CURSO'] };
const DISPONIBLE_ = ['SIN_CUENTAS', 'COBERTURA', 'DESCUADRE', 'APERTURA', 'PENDIENTES', 'CONFLICTO_IDENTIDAD'];
const REQUISITOS = {
  ingresos: FLUJO_, egresos: FLUJO_, flujo_propio: FLUJO_, fondos_recibidos: FLUJO_, fondos_pagados: FLUJO_,
  ventas_netas: { bloquea: [], provisoria: ['MES_EN_CURSO'] },
  caja: { codigo: 'BANK_BALANCE', bloquea: ['SIN_CUENTAS'], provisoria: ['COBERTURA', 'DESCUADRE'] },
  custodia: { codigo: 'CLIENT_FUNDS', bloquea: [], provisoria: ['APERTURA', 'PENDIENTES', 'CONFLICTO_IDENTIDAD'] },
  caja_libre: { codigo: 'OWN_AVAILABLE_CASH', bloquea: DISPONIBLE_, provisoria: [], suficiencia: true },
  meses_caja: { codigo: 'CASH_MONTHS', bloquea: DISPONIBLE_.concat(['SIN_GASTO_BASE']), provisoria: [] }
};
const TEXTO_RAZON_ = {
  SIN_CUENTAS: 'No hay cartolas cargadas para saber el saldo bancario.',
  SIN_GASTO_BASE: 'No hay pagos propios en los últimos meses para el promedio.'
};
/**
 * I09.1 · Ficha de cada métrica: fuentes, exclusiones, fecha que usa, moneda,
 * calidad requerida (de REQUISITOS) y dónde se consulta el detalle. La
 * pantalla, el PDF y la exportación leen la misma ficha.
 */
const FICHA_ = {
  ingresos: { fuentes: 'Movimientos del banco confirmados y operaciones registradas aún sin su banco', excluye: 'Fondos de clientes, traspasos, préstamos, compensaciones y ventas facturadas que no se han cobrado', fecha: 'Fecha efectiva del movimiento', detalle: 'hechos' },
  egresos: { fuentes: 'Movimientos del banco confirmados y operaciones registradas aún sin su banco', excluye: 'Pagos por cuenta de clientes, traspasos, préstamos, la parte de otras empresas en gastos compartidos y gastos devengados aún no pagados', fecha: 'Fecha efectiva del movimiento', detalle: 'hechos' },
  flujo_propio: { fuentes: 'Cobros propios y pagos propios del mismo mes', excluye: 'Todo lo ajeno (fondos de clientes) y lo interno (traspasos, préstamos). No es utilidad contable', fecha: 'Fecha efectiva del movimiento', detalle: 'cascada' },
  ventas_netas: { fuentes: 'Registro de Ventas del SII y facturas de la planilla', excluye: 'Cobros, IVA y documentos anulados. Sin documentos de gastos no se calcula utilidad', fecha: 'Fecha de emisión', detalle: 'facturas' },
  fondos_recibidos: { fuentes: 'Movimientos clasificados como fondo de cliente recibido', excluye: 'Cobros propios', fecha: 'Fecha efectiva del movimiento', detalle: 'hechos' },
  fondos_pagados: { fuentes: 'Movimientos clasificados como pago por cuenta de clientes', excluye: 'Pagos propios', fecha: 'Fecha efectiva del movimiento', detalle: 'hechos' },
  caja: { fuentes: 'Último saldo de cada cartola cargada', excluye: 'Caja chica y efectivo fuera del banco', fecha: 'Fecha del banco (corte)', detalle: 'cuentas' },
  custodia: { fuentes: 'Saldos iniciales aprobados, fondos recibidos y pagados por cuenta de cada cliente', excluye: 'Cobros propios', fecha: 'Corte del informe', detalle: 'fondos' },
  caja_libre: { fuentes: 'Saldo bancario al corte y fondos a favor de clientes', excluye: 'Ninguna resta si faltan datos: queda no determinable', fecha: 'Corte del informe', detalle: 'evaluacion' },
  meses_caja: { fuentes: 'Disponibilidad propia y pagos propios de los últimos 3 meses con pagos', excluye: '—', fecha: 'Corte del informe', detalle: 'evaluacion' },
  por_cobrar: { fuentes: 'Facturas vigentes y aplicaciones de cobros', excluye: 'Facturas anuladas e incobrables', fecha: 'Hoy (no es la cartera histórica del mes)', detalle: 'cobranza' },
  sin_aplicar: { fuentes: 'Cobros propios con cliente sin aplicar a factura', excluye: 'Fondos de clientes', fecha: 'Hoy', detalle: 'cobranza' },
  pendiente_identidad: { fuentes: 'Operaciones registradas y movimientos del banco ya clasificados', excluye: 'No se suma a ninguna cifra hasta resolverse', fecha: 'Fecha efectiva', detalle: 'conciliacion' }
};

function evaluar_(metric, amount, razones, corte, extra) {
  const req = REQUISITOS[metric] || { bloquea: [], provisoria: [] };
  const codigos = razones.map((r) => r.codigo);
  const bloq = req.bloquea.filter((c) => codigos.indexOf(c) !== -1), prov = req.provisoria.filter((c) => codigos.indexOf(c) !== -1);
  const status = bloq.length || amount === null || amount === undefined ? 'NOT_DETERMINABLE' : prov.length ? 'PROVISIONAL' : 'DETERMINED';
  const usadas = bloq.concat(prov);
  return Object.assign({ metric: req.codigo || metric, clave: metric, status, amount: status === 'NOT_DETERMINABLE' ? null : amount, currency: 'CLP', cutoff: corte,
    reasons: usadas, detalle: usadas.map((c) => { const r = razones.find((x) => x.codigo === c); return { codigo: c, texto: (r && r.texto) || TEXTO_RAZON_[c] || c, evidencia: (r && r.evidencia) || null }; }),
    can_assess_sufficiency: !!req.suficiencia && status === 'DETERMINED' }, extra || {});
}

/** Valores de un mes hasta un día (para comparar un mes en curso contra el mismo tramo del otro mes). */
// Une la ficha a la definición; la calidad requerida sale de REQUISITOS (la misma regla que evalúa la cifra).
Object.keys(FICHA_).forEach((k) => {
  const r = REQUISITOS[k];
  Object.assign(DEFINICIONES[k], FICHA_[k], { moneda: 'CLP',
    calidad: r ? (r.bloquea.length ? 'No se determina con: ' + r.bloquea.join(', ') + '. ' : '') + (r.provisoria.length ? 'Provisoria con: ' + r.provisoria.join(', ') + '.' : '') : 'Se informa con la calidad del mes.' });
});

/**
 * I09.4 · Elegibilidad de cada regla de comentario: qué exige para emitirse o
 * para calificar (mejor/peor). Viaja en el contrato y se consulta en detalle.
 */
const ELEGIBILIDAD = [
  { rule_id: 'DATOS_INCOMPLETOS', exige: 'Alguna razón de calidad en el mes', califica: 'No califica: dice qué falta y qué deja sin evaluar' },
  { rule_id: 'FLUJO_PROPIO', exige: 'Base caja bruta y datos del mes', califica: 'Solo califica la mejora o caída si los dos meses son comparables y sin datos provisorios' },
  { rule_id: 'CARTERA_ANTIGUA', exige: 'Facturas con saldo confirmado y atraso mayor al parámetro', califica: 'Crítico por materialidad' },
  { rule_id: 'CUSTODIA_NEGATIVA', exige: 'Cliente con fondos en negativo', califica: 'Crítico solo si el cliente tiene saldo inicial aprobado' },
  { rule_id: 'INGRESOS_VS_PPTO', exige: 'Presupuesto aprobado de la misma base', califica: 'Solo con el mes completo y datos sin provisorios' },
  { rule_id: 'GASTOS_VS_PPTO', exige: 'Presupuesto aprobado, mes evaluable y exceso sobre el parámetro', califica: 'Alerta o crítico por porcentaje' },
  { rule_id: 'MESES_CAJA', exige: 'Disponibilidad propia determinada y pagos de base', califica: 'Por umbrales de meses' },
  { rule_id: 'OBLIGACIONES', exige: 'Compromisos o estimaciones del mes siguiente', califica: 'Solo dice si alcanza con disponibilidad propia determinada y sin obligaciones por determinar' },
  { rule_id: 'ENTRE_EMPRESAS', exige: 'Saldos abiertos entre empresas', califica: 'Descriptivo' },
  { rule_id: 'FONDOS_CLIENTES', exige: 'Fondos a favor de clientes', califica: 'Descriptivo' },
  { rule_id: 'ABONOS_SIN_FACTURA', exige: 'Cobros con cliente sin aplicar', califica: 'Descriptivo' }
];

function hastaDia_(todos, emp, periodo, dia) {
  const tope = Math.min(dia, Base.diasDelMes_(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7))));
  const hasta = periodo + '-' + String(tope).padStart(2, '0');
  const o = porPeriodo_(todos.filter((h) => h.periodo === periodo && h.fecha <= hasta), emp).get(periodo) || null;
  return { o, desde: periodo + '-01', hasta };
}

// ---------------------------------------------------------------- el reporte

/**
 * Arma el contrato para un período y alcance. opciones: { periodo, empresa,
 * base, comparacion }.
 */
// I12.2: el contrato se arma una vez por revisión de datos, período, alcance, base, comparación y día.
const memoReporte_ = new Map();
B.registrarLimpieza_(() => { memoReporte_.clear(); vistos_.clear(); });
function reporte_(db, opciones) {
  const o = opciones || {};
  return Base.memo_(memoReporte_, JSON.stringify([o.periodo || '', o.empresa || '', o.base || '', o.comparacion || '', o.hoy || Base.hoy_()]), () => reporteCalc_(db, o));
}
function reporteCalc_(db, opciones) {
  opciones = opciones || {};
  const hoy = opciones.hoy || Base.hoy_();
  const todos = H.todos_();
  const emp = Cat.empresas_({ todos: true }).indexOf(opciones.empresa) !== -1 ? opciones.empresa : '';
  const basis = BASES[opciones.base] ? opciones.base : 'CASH_GROSS';
  const periodosDatos = [...new Set(todos.map((h) => h.periodo))].sort();
  const periodo = Base.periodo_(opciones.periodo) || periodosDatos[periodosDatos.length - 1] || Base.mesAnterior_(hoy.slice(0, 7));
  const pp = porPeriodo_(todos, emp);
  const ventas = ventasNetas_(emp);
  const mesDatos = pp.get(periodo) || null;
  const metricaDe = (p) => {
    const o = pp.get(p);
    if (basis === 'DOCUMENT_NET') return ventas.has(p) ? { ventas_netas: ventas.get(p) } : null;
    return o || null;
  };
  // Serie de hasta 12 meses que termina en el período: los meses sin datos son huecos (null), no ceros.
  let ini = periodo; for (let i = 0; i < 11; i++) ini = Base.mesAnterior_(ini);
  if (periodosDatos.length && ini < periodosDatos[0]) ini = periodosDatos[0] <= periodo ? periodosDatos[0] : periodo;
  let ppto = null;
  try { ppto = require('./finanzasPresupuesto').porMes_(Base.rangoMeses_(ini, periodo), emp); } catch (e) { ppto = null; }
  const series = Base.rangoMeses_(ini, periodo).map((p) => {
    const m = metricaDe(p);
    const pm = ppto && ppto[p];
    const pptoComparable = pm && (pm.base === basis);
    return Object.assign({ periodo: p, sin_datos: !m }, basis === 'DOCUMENT_NET'
      ? { ventas_netas: m ? m.ventas_netas : null }
      : { ingresos: m ? m.ingresos : null, egresos: m ? m.egresos : null, flujo_propio: m ? m.flujo_propio : null, fondos_recibidos: m ? m.fondos_recibidos : null, fondos_pagados: m ? m.fondos_pagados : null, pendientes: m ? m.pendientes : null },
    { ppto_ingresos: pptoComparable ? pm.ingresos : null, ppto_egresos: pptoComparable && basis === 'CASH_GROSS' ? pm.egresos : null });
  });

  // Caja y custodia al corte.
  const corte = periodo === hoy.slice(0, 7) ? hoy : Base.ultimoDia_(periodo);
  const cuentas = H.saldosAl_({ hasta: corte, empresa: emp }); // por fecha del banco (I02.4)
  const caja = cuentas.length ? cuentas.reduce((s, c) => s + (Number(c.saldo) || 0), 0) : null;
  let cust = { clientes: [], total: 0, positivos: 0, negativos: 0, parcial: false, sin_apertura: 0 };
  try { cust = require('./finanzasFondos').custodiaAl_(corte, emp); } catch (e) { /* */ }
  const conflictosMes = H.conflictos_({ periodo, empresa: emp });
  const quality = calidad_(db, periodo, emp, mesDatos, hoy, conflictosMes);
  // Evaluación común (I03.3): tarjeta, comentario, gráfico, PDF y exportación leen ESTO.
  let coberturaCuentas = [];
  try { coberturaCuentas = require('./finanzasCierre').verificar_(periodo).cobertura || []; } catch (e) { coberturaCuentas = []; }
  cuentas.forEach((c) => { const k = coberturaCuentas.find((x) => x.cuenta_ref === c.cuenta_ref || (x.cuenta && x.cuenta.indexOf(c.ultimos4) !== -1)); c.cubierta_hasta = k ? (k.hasta || '') : ''; c.completa = k ? !!k.completa : null; });
  const razonesEval = quality.reasons.slice();
  if (caja === null) razonesEval.push({ codigo: 'SIN_CUENTAS', texto: TEXTO_RAZON_.SIN_CUENTAS, evidencia: { vista: 'cargas' } });
  const cajaLibre = caja === null ? null : caja - cust.positivos;
  const formulaRef = 'Saldo bancario ' + Base.plata_(caja || 0) + ' − fondos a favor de clientes ' + Base.plata_(cust.positivos) + '.';
  const conGasto = [...pp.entries()].filter(([p, o]) => p <= periodo && o.egresos > 0).sort().slice(-3);
  const gastoProm = conGasto.length ? Math.round(conGasto.reduce((s, [, o]) => s + o.egresos, 0) / conGasto.length) : 0;
  if (!gastoProm) razonesEval.push({ codigo: 'SIN_GASTO_BASE', texto: TEXTO_RAZON_.SIN_GASTO_BASE });
  const evaluacion = {
    caja: evaluar_('caja', caja, razonesEval, corte, { cuentas: cuentas.map((c) => ({ cuenta: c.banco + ' ···' + c.ultimos4, saldo: c.saldo, al: c.al, cubierta_hasta: c.cubierta_hasta, completa: c.completa })) }),
    custodia: evaluar_('custodia', cust.positivos, razonesEval, corte, { deficit: cust.negativos, clientes_sin_apertura: cust.sin_apertura }),
    caja_libre: evaluar_('caja_libre', cajaLibre, razonesEval, corte, { referencial: cajaLibre === null ? null : { monto: cajaLibre, formula: formulaRef, aviso: 'Referencia: no es una disponibilidad acreditada mientras falte lo indicado.' } })
  };
  const cajaLibreValida = evaluacion.caja_libre.status === 'DETERMINED';
  if (cajaLibreValida) evaluacion.caja_libre.referencial = null;
  const mesesCaja = cajaLibreValida && gastoProm > 0 ? Math.round(cajaLibre / gastoProm * 10) / 10 : null;
  evaluacion.meses_caja = evaluar_('meses_caja', mesesCaja, razonesEval, corte, { gasto_promedio: gastoProm || null });
  const mesesCajaMotivo = mesesCaja !== null ? '' : evaluacion.meses_caja.detalle.map((d) => d.texto).join(' ') || 'No se puede determinar.';

  // Cobranza (corte: hoy).
  let cobranza = null;
  try {
    const lista = [...require('./finanzasCobranza').cartera_(db, { empresa: emp }).values()];
    const mas = Cat.param_('lectura_mas_60', 60);
    cobranza = { corte: hoy, por_cobrar: 0, por_cobrar_confirmado: 0, vencido: 0, antiguo: 0, sin_aplicar: 0, sugerido: 0, top_vencidos: [], dias_antiguo: mas };
    lista.forEach((n) => {
      cobranza.por_cobrar += n.por_cobrar; cobranza.por_cobrar_confirmado += n.por_cobrar_confirmado; cobranza.vencido += n.vencido; cobranza.sin_aplicar += n.sin_aplicar; cobranza.sugerido += n.sugerido;
      n.facturas.forEach((f) => { if (f.saldo > 0 && f.dias > mas) cobranza.antiguo += f.saldo; });
    });
    // Antigüedad del saldo CONFIRMADO por tramos (las sugerencias no rebajan deuda).
    const tramos = [['Por vencer', -1e9, 0], ['1–30 días', 1, 30], ['31–60 días', 31, 60], ['61–90 días', 61, 90], ['Más de 90 días', 91, 1e9]];
    cobranza.antiguedad = tramos.map(([nombre, a, b]) => ({ tramo: nombre, monto: 0, facturas: 0, desde: a, hasta: b }));
    lista.forEach((n) => n.facturas.forEach((fx) => {
      if (!(fx.saldo_confirmado > 0) || Number(fx.tipo_doc) === 61) return;
      const d = Number(fx.dias_confirmado || 0), t = cobranza.antiguedad.find((x) => d >= x.desde && d <= x.hasta);
      if (t) { t.monto += fx.saldo_confirmado; t.facturas++; }
    }));
    cobranza.top_vencidos = lista.filter((n) => n.vencido > 0).sort((a, b) => b.vencido - a.vencido).slice(0, 5).map((n) => ({ cliente: n.cliente, clave: n.clave, vencido: n.vencido, dias: n.dias_max }));
  } catch (e) { cobranza = null; }

  // Entre empresas.
  let entre = [];
  try { entre = require('./finanzasTablero').deudasEntreEmpresas_(todos.filter((h) => h.fecha <= corte)); if (emp) entre = entre.filter((d) => d.debe === emp || d.a === emp); } catch (e) { entre = []; }

  // I10.2: préstamos registrados sin desembolso vinculado: no son deuda reconocida, pero se informan aparte.
  let sinDesembolso = [];
  try { sinDesembolso = require('./finanzasPlanificacion').saldosPrestamos_().filter((x) => x.estado_real === 'SIN_DESEMBOLSO' && x.estado !== 'PAGADO' && (!emp || x.origen === emp || x.destino === emp)).map((x) => ({ origen: x.origen, destino: x.destino, monto: x.monto, fecha: x.fecha })); } catch (e) { sinDesembolso = []; }
  // Obligaciones: confirmadas (compromisos) aparte de las estimadas; sin pagos → por determinar.
  const sig = Base.mesSiguiente_(periodo);
  const obligaciones = Cat.lista_('OBLIGACION').map((o) => {
    const conPago = [...pp.keys()].filter((p) => p <= periodo).sort().slice(-3).map((p) => todos.filter((h) => h.periodo === p && h.clasif && h.clasif.tipo === 'EGRESO' && (o.conceptos || []).indexOf(h.clasif.cuenta) !== -1)
      .reduce((s, h) => s + H.parteEmpresa_(h, emp), 0)).filter((v) => v > 0);
    return { nombre: o.nombre, fecha: sig + '-' + String(Math.min(o.dia, Base.diasDelMes_(Number(sig.slice(0, 4)), Number(sig.slice(5, 7))))).padStart(2, '0'),
      estimado: conPago.length ? Math.round(conPago.reduce((s, v) => s + v, 0) / conPago.length) : null, tipo: 'ESTIMADO', por_determinar: !conPago.length };
  });
  let confirmadas = [];
  try {
    confirmadas = require('./finanzasPlanificacion').compromisosPendientes_(sig, emp);
  } catch (e) { confirmadas = []; }

  // Comparaciones.
  const comparisons = {};
  const anterior = Base.mesAnterior_(periodo), anioAnt = (Number(periodo.slice(0, 4)) - 1) + periodo.slice(4);
  const metricasComparables = basis === 'DOCUMENT_NET' ? ['ventas_netas'] : ['ingresos', 'egresos', 'flujo_propio', 'fondos_recibidos', 'fondos_pagados'];
  const valor = (p, k) => { const m = metricaDe(p); return m ? m[k] : null; };
  const enCurso = periodo === hoy.slice(0, 7);
  // I03.4 · Mes en curso: acumulado al día del corte contra el MISMO tramo del otro mes (día comparable =
  // mismo número de día, con tope en el largo de ese mes: 31-oct se compara con 1–30 sep). Mes cerrado: completo contra completo.
  const dia = Number(corte.slice(8, 10));
  const tramo = (p) => {
    if (!enCurso || basis === 'DOCUMENT_NET') return { o: metricaDe(p), desde: p + '-01', hasta: Base.ultimoDia_(p) };
    return pp.has(p) ? hastaDia_(todos, emp, p, dia) : { o: null, desde: p + '-01', hasta: p + '-' + String(dia).padStart(2, '0') };
  };
  const actualT = tramo(periodo);
  // Calidad del mes base: una mejora contra un mes con pendientes o sin cartolas no se pinta como mejora.
  const calidadBase = (p) => { if (!pp.has(p)) return null; try { return calidad_(db, p, emp, pp.get(p), hoy, H.conflictos_({ periodo: p, empresa: emp })); } catch (e) { return null; } };
  const qAnt = calidadBase(anterior), qAnio = calidadBase(anioAnt);
  const sinCurso = (q) => q ? q.reasons.filter((r) => r.codigo !== 'MES_EN_CURSO').length === 0 : false;
  const universo = { alcance: emp || 'Grupo', basis, revision: Base.revision_() };
  const cmpHomogenea = (k, p, q) => {
    const b = tramo(p);
    const r = comparar_(actualT.o ? actualT.o[k] : null, b.o ? b.o[k] : null);
    const evaluable = ['COMPARABLE', 'AMBOS_CERO'].indexOf(r.estado) !== -1 && sinCurso(quality) && sinCurso(q);
    return Object.assign(r, universo, { periodo: p, corte, modalidad: enCurso && basis !== 'DOCUMENT_NET' ? 'ACUMULADO_A_LA_FECHA' : 'PERIODO_COMPLETO',
      fechas: { actual: [actualT.desde, actualT.hasta], base: [b.desde, b.hasta] }, calidad_base: q ? q.status : null, evaluable,
      advertencia: r.estado === 'SIN_BASE' ? 'Sin base comparable.' : enCurso ? 'Mes en curso: ' + actualT.desde.slice(8) + '–' + actualT.hasta.slice(8) + ' contra ' + b.desde.slice(8) + '–' + b.hasta.slice(8) + ' de ' + Base.nombreMes_(p) + '.' : '',
      motivo_no_evaluable: evaluable ? '' : r.estado !== 'COMPARABLE' && r.estado !== 'AMBOS_CERO' ? r.texto : 'Algún mes tiene cifras provisorias o incompletas: se muestra la diferencia sin calificarla.' });
  };
  metricasComparables.forEach((k) => {
    comparisons[k] = { PREVIOUS_PERIOD: cmpHomogenea(k, anterior, qAnt), SAME_PERIOD_LAST_YEAR: cmpHomogenea(k, anioAnt, qAnio) };
    const a = valor(periodo, k);
    const pm = ppto && ppto[periodo];
    const kp = k === 'ingresos' || k === 'ventas_netas' ? 'ingresos' : k === 'egresos' ? 'egresos' : null;
    if (!kp) return;
    if (pm && pm.base === basis && !(basis === 'DOCUMENT_NET' && kp === 'egresos')) {
      // Sin regla de distribución diaria aprobada, un mes en curso NO se evalúa contra el presupuesto mensual completo.
      const ev = !enCurso && sinCurso(quality);
      comparisons[k].BUDGET = Object.assign(comparar_(a, pm[kp]), universo, { periodo, corte, modalidad: 'CONTRA_PRESUPUESTO_MENSUAL', ejecucion_pct: pm[kp] ? Math.round(a / pm[kp] * 1000) / 10 : null, evaluable: ev,
        advertencia: enCurso ? 'Mes en curso: acumulado parcial contra el presupuesto del mes completo; sin regla de distribución aprobada no se evalúa.' : '',
        motivo_no_evaluable: ev ? '' : enCurso ? 'Mes en curso.' : 'Cifras provisorias o incompletas.' });
    } else comparisons[k].BUDGET = Object.assign({ estado: 'SIN_BASE', evaluable: false, texto: !pm ? 'Sin presupuesto aprobado' : 'Base no comparable (el presupuesto es ' + (BASES[pm.base] || pm.base) + ')' }, universo, { periodo, corte });
  });

  // Desgloses y contribuciones al cambio contra el mes anterior.
  const contrib = (tipo) => {
    const a = porConcepto_(todos, periodo, emp, tipo), b = porConcepto_(todos, anterior, emp, tipo);
    return [...new Set(Object.keys(a).concat(Object.keys(b)))].map((k) => ({ concepto: k, actual: a[k] || 0, base: pp.has(anterior) ? (b[k] || 0) : null, diferencia: pp.has(anterior) ? (a[k] || 0) - (b[k] || 0) : null }))
      .sort((x, y) => Math.abs(y.diferencia || y.actual) - Math.abs(x.diferencia || x.actual));
  };
  // Cascada del flujo propio: cobros por concepto (+) y pagos por concepto (−) hasta el flujo; lo ajeno y lo interno, aparte.
  let cascada = null;
  if (basis === 'CASH_GROSS' && mesDatos) {
    const ci = porConcepto_(todos, periodo, emp, 'INGRESO'), ce = porConcepto_(todos, periodo, emp, 'EGRESO');
    const pasos = Object.keys(ci).sort((a, b) => ci[b] - ci[a]).map((k) => ({ concepto: k, signo: 1, monto: ci[k], tipo: 'cobro' }))
      .concat(Object.keys(ce).sort((a, b) => ce[b] - ce[a]).map((k) => ({ concepto: k, signo: -1, monto: ce[k], tipo: 'pago' })));
    const suma = pasos.reduce((t, x) => t + x.signo * x.monto, 0);
    cascada = { pasos, total: suma, flujo_propio: mesDatos.flujo_propio, cuadra: suma === mesDatos.flujo_propio,
      fuera: [['Fondos de clientes recibidos', mesDatos.fondos_recibidos], ['Pagado por cuenta de clientes', mesDatos.fondos_pagados], ['Traspasos entre cuentas', mesDatos.traspasos],
        ['Préstamos recibidos', mesDatos.prestamos_entra], ['Préstamos entregados', mesDatos.prestamos_sale], ['Sin clasificar', mesDatos.pendiente_monto]]
        .filter(([, v]) => v).map(([nombre, monto]) => ({ nombre, monto })) };
  }
  // Cuentas y caja del mes: apertura (saldo al cierre del mes anterior), entradas, salidas, cierre y diferencia.
  const previas = new Map(H.saldosAl_({ hasta: Base.ultimoDia_(anterior), empresa: emp }).map((c) => [c.cuenta_ref, c]));
  const movCta = new Map();
  todos.filter((h) => h.fuente === 'BANCO' && h.periodo_banco === periodo && (!emp || h.empresa === emp)).forEach((h) => {
    if (!movCta.has(h.cuenta_ref)) movCta.set(h.cuenta_ref, { entradas: 0, salidas: 0, banco: h.banco, ultimos4: h.ultimos4, empresa: h.empresa });
    const o = movCta.get(h.cuenta_ref); o.entradas += h.abono || 0; o.salidas += h.cargo || 0;
  });
  const cuentasPeriodo = [...new Set([...movCta.keys()].concat(cuentas.map((c) => c.cuenta_ref)))].map((ref) => {
    const mv = movCta.get(ref) || { entradas: 0, salidas: 0 }, cierre = cuentas.find((c) => c.cuenta_ref === ref), ap = previas.get(ref);
    const apertura = ap ? Number(ap.saldo) : null, fin = cierre ? Number(cierre.saldo) : null;
    return { cuenta_ref: ref, cuenta: ((cierre || mv).banco || '') + ' ···' + ((cierre || mv).ultimos4 || ''), empresa: (cierre || mv).empresa || '', apertura, entradas: mv.entradas, salidas: mv.salidas, cierre: fin, al: cierre ? cierre.al : '',
      completa: cierre ? cierre.completa : null, cubierta_hasta: cierre ? cierre.cubierta_hasta : '',
      diferencia: apertura === null || fin === null ? null : apertura + mv.entradas - mv.salidas - fin,
      nota: apertura === null ? 'Sin cartola del mes anterior: la apertura no se conoce.' : '' };
  });
  // Empresas: la suma por empresa debe dar el grupo (un gasto compartido se reparte, no se duplica).
  const porEmpresa = [...new Set(todos.map((h) => h.empresa).filter(Boolean))].map((e) => { const o = (porPeriodo_(todos.filter((h) => h.periodo === periodo), e).get(periodo)) || vacio_(); return { empresa: e, ingresos: o.ingresos, egresos: o.egresos, flujo_propio: o.ingresos - o.egresos }; });
  const sumaEmp = porEmpresa.reduce((t, x) => t + x.flujo_propio, 0);
  const cuadreEmpresas = emp || !mesDatos ? null : { suma_empresas: sumaEmp, grupo: mesDatos.flujo_propio, diferencia: sumaEmp - mesDatos.flujo_propio };
  // Comercial (servicios, canales, vendedores): cobros propios del mes CON cliente, por la ficha del cliente.
  // Lo que no tiene dato queda «sin dato» con su cantidad; no se inventan categorías.
  let comercial = null;
  try {
    const Cl = require('./finanzasClientes');
    const fichas = Cl.fichas_();
    const conCliente = todos.filter((h) => h.periodo === periodo && h.clasif && h.clasif.tipo === 'INGRESO' && h.caja !== false && H.parteEmpresa_(h, emp));
    const dim = (campo) => {
      const m = new Map();
      conCliente.forEach((h) => {
        const v = H.parteEmpresa_(h, emp), id = h.clasif.cliente_id;
        const k = !id ? '(cobro sin cliente)' : ((fichas.get(id) || {})[campo] || '(sin dato en la ficha)');
        if (!m.has(k)) m.set(k, { valor: k, monto: 0, cobros: 0, clientes: new Set(), desconocido: k.charAt(0) === '(' });
        const o = m.get(k); o.monto += v; o.cobros++; if (id) o.clientes.add(id);
      });
      return [...m.values()].map((o) => Object.assign(o, { clientes: o.clientes.size })).sort((a, b) => a.desconocido - b.desconocido || b.monto - a.monto);
    };
    const clientesCobro = [...new Set(conCliente.map((h) => h.clasif.cliente_id).filter(Boolean))];
    const conDato = (campo) => clientesCobro.filter((id) => (fichas.get(id) || {})[campo]).length;
    const serv = new Map();
    I.clientes_(db).forEach((cl) => Cl.servicios_(cl.id).filter((x) => x.estado === 'VIGENTE' && (!emp || !x.empresa || x.empresa === emp)).forEach((x) => {
      const k = x.servicio || '(sin nombre)';
      if (!serv.has(k)) serv.set(k, { servicio: k, clientes: new Set(), mensual_neto: 0, sin_monto: 0 });
      const o = serv.get(k); o.clientes.add(cl.id);
      if (x.monto_neto === null || x.monto_neto === undefined) o.sin_monto++; else if (x.modalidad !== 'UNICA') o.mensual_neto += Number(x.monto_neto) || 0;
    }));
    comercial = {
      metrica: 'Cobros propios del mes con cliente (caja recibida), repartidos según la ficha del cliente. No es venta facturada ni rentabilidad.',
      por_canal: dim('canal'), por_vendedor: dim('vendedor'),
      servicios: [...serv.values()].map((o) => Object.assign(o, { clientes: o.clientes.size })).sort((a, b) => b.mensual_neto - a.mensual_neto),
      servicios_metrica: 'Valor mensual neto de los servicios vigentes según la ficha (lo contratado, no lo cobrado).',
      cobertura: { cobros: conCliente.length, monto: conCliente.reduce((t, h) => t + H.parteEmpresa_(h, emp), 0), clientes: clientesCobro.length, con_canal: conDato('canal'), con_vendedor: conDato('vendedor') }
    };
  } catch (e) { comercial = null; }

  const breakdowns = {
    egresos_por_concepto: contrib('EGRESO'), ingresos_por_concepto: contrib('INGRESO'),
    por_empresa: porEmpresa,
    cuentas, custodia_clientes: cust.clientes.slice().sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo)).slice(0, 15),
    entre_empresas: entre, obligaciones, compromisos: confirmadas,
    cascada, cuentas_periodo: cuentasPeriodo, cuadre_empresas: cuadreEmpresas, comercial, prestamos_sin_desembolso: sinDesembolso
  };
  const metrics = Object.assign({}, basis === 'DOCUMENT_NET' ? { ventas_netas: valor(periodo, 'ventas_netas') } : (mesDatos ? { ingresos: mesDatos.ingresos, egresos: mesDatos.egresos, flujo_propio: mesDatos.flujo_propio, fondos_recibidos: mesDatos.fondos_recibidos, fondos_pagados: mesDatos.fondos_pagados, traspasos: mesDatos.traspasos, prestamos_entra: mesDatos.prestamos_entra, prestamos_sale: mesDatos.prestamos_sale } : {}), {
    caja, custodia: cust.total, custodia_positiva: cust.positivos, custodia_deficit: cust.negativos, custodia_parcial: cust.parcial,
    caja_libre: cajaLibreValida ? cajaLibre : null, caja_libre_estado: cajaLibreValida ? 'VALIDADA' : 'POR_DETERMINAR', caja_libre_referencial: cajaLibre,
    gasto_promedio: gastoProm || null, meses_caja: mesesCaja, meses_caja_motivo: mesesCajaMotivo, cobranza,
    // I01: lo registrado que podría ser el mismo dinero que el banco; NO está sumado en las cifras de arriba.
    pendiente_identidad: { cantidad: conflictosMes.length, monto: conflictosMes.reduce((t, c) => t + c.monto, 0),
      ingresos: conflictosMes.reduce((t, c) => t + c.hechos.filter((h) => h.clasif && h.clasif.tipo === 'INGRESO').reduce((u, h) => u + h.abono, 0), 0),
      egresos: conflictosMes.reduce((t, c) => t + c.hechos.filter((h) => h.clasif && h.clasif.tipo === 'EGRESO').reduce((u, h) => u + h.cargo, 0), 0) }
  });
  let excepciones = [];
  try { excepciones = require('./finanzasCierre').excepcionesLista_(periodo).filter((e) => e.vigente); } catch (e) { excepciones = []; }
  const contrato = {
    excepciones,
    contract_version: 2, rule_version: VERSION_REGLAS, reglas: ELEGIBILIDAD, currency: 'CLP',
    scope: { empresa: emp, alcance: emp || 'Grupo', empresas: [...new Set(todos.map((h) => h.empresa).filter(Boolean))], cuentas: cuentas.map((c) => c.banco + ' ···' + c.ultimos4), currency: 'CLP' },
    period: periodo, periodos: periodosDatos.slice().reverse(), as_of: corte, basis, bases: BASES, comparadores: COMPARADORES,
    comparison: { type: opciones.comparacion && COMPARADORES[opciones.comparacion] ? opciones.comparacion : 'PREVIOUS_PERIOD', period: anterior },
    quality, evaluacion, data_revision: Base.revision_(), metrics, comparisons, series, breakdowns, definiciones: DEFINICIONES, generated_at: new Date().toISOString()
  };
  contrato.insights = insights_(contrato);
  return contrato;
}

// ---------------------------------------------------------------- comentarios automáticos (FIN-36, anexo D)

const SEV = { critico: 0, alerta: 1, info: 2, ok: 3 };
const PRINCIPALES = 4;
// Cifras cuyo «Ver qué cambió» lista registros reales (el detalle del servidor las arma).
const DETALLABLES_ = ['ingresos', 'egresos', 'fondos_recibidos', 'fondos_pagados'];
const mayus_ = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const unir_ = (l) => l.length <= 1 ? l.join('') : l.slice(0, -1).join(', ') + ' y ' + l[l.length - 1];

/**
 * I09.4 · Comentarios automáticos. Primero hechos estructurados (qué se observa,
 * cuánto representa, qué componentes lo explican, qué falta y qué revisar);
 * después el texto, armado con los importes del momento (nada fijo en el código).
 *  - Lo que cambia la interpretación (datos incompletos) va primero y una sola
 *    vez: las demás reglas no repiten la misma falta de datos.
 *  - Se califica (mejor/peor) solo con períodos comparables y sin provisorios.
 *  - Las acciones se ofrecen solo si tienen contenido para ese hallazgo.
 *  - Los primeros PRINCIPALES van en la lectura; el resto, a un clic.
 */
function insights_(c) {
  const L = [];
  const p = c.period, m = c.metrics, q = c.quality, mes = Base.nombreMes_(p);
  const add = (o) => {
    const acc = [];
    if (o.metric && DEFINICIONES[o.metric]) acc.push('COMO_SE_CALCULO');
    if (o.que_cambio) acc.push('VER_QUE_CAMBIO');
    if (o.evidencia && o.evidencia.vista) acc.push('REVISAR_PENDIENTES');
    L.push(Object.assign({ rule_version: VERSION_REGLAS, quality: q.status, basis: c.basis, period: p, alcance: c.scope.alcance, corte: c.as_of, contribuciones: [], impacto: 0, interpreta: false }, o, { acciones: acc }));
  };
  const ev = c.evaluacion || {};
  const cajaLibreDet = !!(ev.caja_libre && ev.caja_libre.status === 'DETERMINED');
  const codigos = q.reasons.map((r) => r.codigo);

  // 1. Lo que impide interpretar: una sola lectura con los importes del momento.
  if (q.reasons.length) {
    const r = (k) => q.reasons.find((x) => x.codigo === k);
    const faltas = [];
    if (r('SIN_DATOS')) faltas.push('no hay movimientos cargados');
    if (r('PENDIENTES')) faltas.push('hay ' + Base.plata_(r('PENDIENTES').monto) + ' por revisar en ' + r('PENDIENTES').cantidad + ' movimiento(s)');
    if (r('CONFLICTO_IDENTIDAD')) faltas.push(r('CONFLICTO_IDENTIDAD').cantidad === 1 ? 'una coincidencia de ' + Base.plata_(r('CONFLICTO_IDENTIDAD').monto) + ' pendiente de vincular' : r('CONFLICTO_IDENTIDAD').cantidad + ' coincidencias por ' + Base.plata_(r('CONFLICTO_IDENTIDAD').monto) + ' pendientes de vincular');
    if (r('SIN_BANCO')) faltas.push(r('SIN_BANCO').cantidad + ' operación(es) por ' + Base.plata_(r('SIN_BANCO').monto) + ' sin su movimiento del banco');
    if (r('COBERTURA')) faltas.push('faltan cartolas');
    if (r('DESCUADRE')) faltas.push('una cartola no cuadra con su saldo');
    if (r('APERTURA')) faltas.push(r('APERTURA').cantidad + ' cliente(s) sin saldo inicial aprobado');
    const soloEnCurso = codigos.length === 1 && codigos[0] === 'MES_EN_CURSO';
    const efectos = [];
    const sinCalificar = Object.keys(c.comparisons).some((k) => { const x = c.comparisons[k].PREVIOUS_PERIOD; return x && x.estado === 'COMPARABLE' && !x.evaluable; });
    if (sinCalificar) efectos.push('no se califican las comparaciones');
    if (!cajaLibreDet && m.caja !== null) efectos.push('no se calcula la disponibilidad propia');
    if ((c.breakdowns.obligaciones || []).length || (c.breakdowns.compromisos || []).length) { if (!cajaLibreDet) efectos.push('no se puede afirmar si alcanza para ' + Base.nombreMes_(Base.mesSiguiente_(p))); }
    const monto = ['PENDIENTES', 'CONFLICTO_IDENTIDAD', 'SIN_BANCO'].reduce((t, k) => t + ((r(k) || {}).monto || 0), 0);
    const texto = soloEnCurso
      ? mayus_(mes) + ' está en curso (corte ' + c.as_of + '): se compara solo el mismo tramo de días y no se califica como mejora o caída.'
      : mayus_(mes) + ' aún no permite evaluar una mejora: ' + unir_(faltas) + '. Completa esas revisiones antes de comparar el flujo.';
    add({ rule_id: 'DATOS_INCOMPLETOS', severidad: q.status === 'INCOMPLETO' ? 'alerta' : soloEnCurso ? 'info' : 'alerta', metric: 'calidad', interpreta: !soloEnCurso, impacto: monto || 1,
      texto, limites: efectos.length ? 'Mientras tanto ' + unir_(efectos) + '.' : '',
      hechos: { observa: 'Calidad ' + q.status, magnitud: monto || null, componentes: q.reasons.map((x) => ({ codigo: x.codigo, monto: x.monto || null, cantidad: x.cantidad || null })), falta: faltas, revisar: 'Pendientes de Finanzas' },
      evidencia: { vista: 'pendientes', filtros: { periodo: p } } });
  }
  // 2. Cartera antigua.
  if (m.cobranza && m.cobranza.antiguo > 0) add({ rule_id: 'CARTERA_ANTIGUA', severidad: 'critico', metric: 'por_cobrar', actual: m.cobranza.antiguo, impacto: m.cobranza.antiguo,
    texto: Base.plata_(m.cobranza.antiguo) + ' de la cartera tienen más de ' + m.cobranza.dias_antiguo + ' días vencidos' + (m.cobranza.por_cobrar ? ' (' + Math.round(m.cobranza.antiguo / m.cobranza.por_cobrar * 100) + ' % de lo por cobrar)' : '') + '.',
    contribuciones: m.cobranza.top_vencidos.slice(0, 3).map((x) => ({ nombre: x.cliente, monto: x.vencido, dias: x.dias })),
    limites: 'Corte de hoy (' + m.cobranza.corte + '): no es la cartera histórica de ' + mes + '.' + (m.cobranza.sugerido ? ' Las aplicaciones sugeridas (' + Base.plata_(m.cobranza.sugerido) + ') no rebajan esta cifra hasta confirmarse.' : ''),
    hechos: { observa: 'Saldo vencido sobre el parámetro', magnitud: m.cobranza.antiguo, componentes: m.cobranza.top_vencidos.slice(0, 3), falta: [], revisar: 'Cobranza' },
    evidencia: { vista: 'cobranza', filtros: {} } });
  // 3. Custodia negativa por cliente.
  const neg = (c.breakdowns.custodia_clientes || []).filter((x) => x.saldo < 0);
  if (neg.length) add({ rule_id: 'CUSTODIA_NEGATIVA', severidad: neg.some((x) => !x.parcial) ? 'critico' : 'alerta', metric: 'custodia', actual: m.custodia_deficit, impacto: -m.custodia_deficit,
    texto: neg.length + ' cliente(s) con fondos en negativo según lo registrado (' + neg.slice(0, 3).map((x) => x.cliente + ' ' + Base.plata_(x.saldo)).join(', ') + ').',
    contribuciones: neg.slice(0, 5).map((x) => ({ nombre: x.cliente, monto: x.saldo, parcial: x.parcial })),
    limites: neg.some((x) => x.parcial) ? 'Algunos no tienen saldo inicial aprobado: antes de concluir que la empresa puso dinero, revisa si falta lo que mandaron antes del primer mes cargado.' : 'Con saldo inicial aprobado: la empresa pagó por ellos más de lo recibido; hay que cobrarlo o registrar lo que falta.',
    hechos: { observa: 'Fondos de clientes bajo cero', magnitud: m.custodia_deficit, componentes: neg.slice(0, 5), falta: neg.filter((x) => x.parcial).map((x) => 'saldo inicial de ' + x.cliente), revisar: 'Fondos' },
    evidencia: { vista: 'fondos' } });
  // 4. Flujo propio contra el mes anterior: se califica solo si es comparable.
  if (c.basis === 'CASH_GROSS' && m.flujo_propio !== undefined) {
    const cmp = c.comparisons.flujo_propio && c.comparisons.flujo_propio.PREVIOUS_PERIOD;
    const prov = q.status !== 'COMPLETO';
    const negativo = m.flujo_propio < 0;
    const cambios = (c.breakdowns.ingresos_por_concepto || []).filter((x) => x.diferencia).map((x) => ({ nombre: x.concepto, diferencia: x.diferencia, metric: 'ingresos' }))
      .concat((c.breakdowns.egresos_por_concepto || []).filter((x) => x.diferencia).map((x) => ({ nombre: x.concepto, diferencia: -x.diferencia, metric: 'egresos' })))
      .sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
    const conBase = cmp && cmp.estado !== 'SIN_BASE';
    let texto = 'El flujo propio de ' + mes + (c.as_of.slice(0, 7) === p ? ' va en ' : ' fue ') + Base.plata_(m.flujo_propio) + ' (cobros ' + Base.plata_(m.ingresos) + ' − pagos ' + Base.plata_(m.egresos) + ')';
    texto += conBase ? '; contra ' + (cmp.modalidad === 'ACUMULADO_A_LA_FECHA' ? 'el mismo tramo de ' : '') + Base.nombreMes_(cmp.periodo) + ' (' + Base.plata_(cmp.base) + '): ' + cmp.texto + (cmp.evaluable ? '.' : ', sin calificar.') : '. Sin mes anterior para comparar.';
    if (cambios.length && conBase) texto += ' Lo que más movió el flujo: ' + cambios.slice(0, 3).map((x) => x.nombre + ' ' + (x.diferencia >= 0 ? '+' : '') + Base.plata_(x.diferencia)).join(', ') + '.';
    add({ rule_id: 'FLUJO_PROPIO', severidad: negativo ? (prov ? 'alerta' : 'critico') : !conBase || !cmp.evaluable ? 'info' : cmp.diferencia < 0 ? 'alerta' : 'ok', metric: 'flujo_propio',
      actual: m.flujo_propio, base: conBase ? cmp.base : null, diferencia: conBase ? cmp.diferencia : null, impacto: Math.abs(conBase && cmp.diferencia || m.flujo_propio), que_cambio: conBase && cambios.length > 0,
      texto, contribuciones: cambios.slice(0, 6),
      limites: 'Muestra qué conceptos cambiaron; no explica por qué.' + (cmp && cmp.advertencia ? ' ' + cmp.advertencia : ''),
      hechos: { observa: 'Flujo propio', magnitud: m.flujo_propio, componentes: cambios.slice(0, 6), falta: prov ? ['datos completos del mes'] : [], revisar: 'Movimientos del mes' },
      evidencia: { vista: 'movimientos', filtros: { periodo: p, filtro: 'confirmados' } } });
  }
  // 5 y 6. Presupuesto (solo aprobado y en la misma base).
  const pi = c.comparisons.ingresos && c.comparisons.ingresos.BUDGET;
  if (pi && pi.estado !== 'SIN_BASE' && pi.ejecucion_pct !== null) {
    const ok = Cat.param_('lectura_ppto_ok', 100), al = Cat.param_('lectura_ppto_alerta', 90);
    add({ rule_id: 'INGRESOS_VS_PPTO', severidad: !pi.evaluable ? 'info' : pi.ejecucion_pct >= ok ? 'ok' : pi.ejecucion_pct >= al ? 'alerta' : 'critico', metric: 'ingresos', actual: pi.actual, base: pi.base, diferencia: pi.diferencia, impacto: Math.abs(pi.diferencia || 0),
      texto: 'Los cobros propios llegan al ' + String(pi.ejecucion_pct).replace('.', ',') + ' % del presupuesto aprobado de cobros (' + Base.plata_(pi.actual) + ' de ' + Base.plata_(pi.base) + ')' + (pi.evaluable ? '.' : ', sin calificar.'),
      limites: pi.evaluable ? '' : (pi.advertencia || pi.motivo_no_evaluable || ''),
      hechos: { observa: 'Ejecución del presupuesto de cobros', magnitud: pi.diferencia, componentes: [], falta: [], revisar: 'Presupuesto' }, evidencia: { vista: 'presupuesto' } });
  }
  const pg = c.comparisons.egresos && c.comparisons.egresos.BUDGET;
  if (pg && pg.estado !== 'SIN_BASE' && pg.evaluable && pg.ejecucion_pct !== null && pg.ejecucion_pct > Cat.param_('lectura_gasto_alerta', 100)) {
    add({ rule_id: 'GASTOS_VS_PPTO', severidad: pg.ejecucion_pct > Cat.param_('lectura_gasto_critico', 110) ? 'critico' : 'alerta', metric: 'egresos', actual: pg.actual, base: pg.base, diferencia: pg.diferencia, impacto: pg.diferencia,
      texto: 'Los pagos propios superaron el presupuesto aprobado de pagos: ' + String(pg.ejecucion_pct).replace('.', ',') + ' % (' + Base.plata_(pg.diferencia) + ' por sobre lo previsto).',
      limites: 'Revisa qué conceptos aportan al exceso en Presupuesto.', que_cambio: true,
      hechos: { observa: 'Pagos sobre presupuesto', magnitud: pg.diferencia, componentes: [], falta: [], revisar: 'Presupuesto' }, evidencia: { vista: 'presupuesto' } });
  }
  // 7. Meses de caja. Si no se determina por lo mismo que ya dijo «datos incompletos», no se repite.
  if (m.meses_caja !== null && m.meses_caja !== undefined) {
    const prov = q.status !== 'COMPLETO';
    add({ rule_id: 'MESES_CAJA', severidad: m.meses_caja < Cat.param_('lectura_caja_critico', 2) ? 'critico' : m.meses_caja < Cat.param_('lectura_caja_alerta', 4) || prov ? 'alerta' : 'ok', metric: 'meses_caja', actual: m.meses_caja, impacto: m.caja_libre || 0,
      texto: 'La disponibilidad propia (' + Base.plata_(m.caja_libre) + ') cubre ' + String(m.meses_caja).replace('.', ',') + ' meses de pagos propios al ritmo de los últimos meses (' + Base.plata_(m.gasto_promedio) + ' al mes).',
      limites: prov ? 'Provisorio: con pagos por revisar cubre menos.' : '',
      hechos: { observa: 'Meses de caja', magnitud: m.meses_caja, componentes: [], falta: [], revisar: 'Resumen' }, evidencia: null });
  } else if (m.caja !== null && ev.meses_caja) {
    const propias = ev.meses_caja.reasons.filter((k) => codigos.indexOf(k) === -1);
    if (propias.length) add({ rule_id: 'MESES_CAJA', severidad: 'info', metric: 'meses_caja', actual: null, impacto: 0,
      texto: 'Meses de caja: no determinables. ' + ev.meses_caja.detalle.filter((d) => propias.indexOf(d.codigo) !== -1).map((d) => d.texto).join(' '),
      limites: 'Se muestran el saldo bancario y los fondos de clientes por separado.',
      hechos: { observa: 'Meses de caja', magnitud: null, componentes: [], falta: propias, revisar: 'Cargas' }, evidencia: (ev.meses_caja.detalle.find((d) => d.evidencia) || {}).evidencia || null });
  }
  // 8. Obligaciones del mes que viene.
  const ob = c.breakdowns.obligaciones || [];
  const estimadas = ob.filter((o) => o.estimado !== null), porDet = ob.filter((o) => o.por_determinar);
  const conf = (c.breakdowns.compromisos || []).reduce((t, x) => t + x.monto, 0);
  const sig = Base.nombreMes_(Base.mesSiguiente_(p));
  if (estimadas.length || conf) {
    const total = estimadas.reduce((t, o) => t + o.estimado, 0) + conf;
    const evaluable = !!(ev.caja_libre && ev.caja_libre.can_assess_sufficiency) && !porDet.length;
    const alcanza = evaluable && ev.caja_libre.amount >= total;
    // La falta de datos ya la dijo el comentario 1; aquí solo lo propio (obligaciones sin monto).
    const motivo = porDet.length ? 'Obligaciones sin monto conocido: ' + porDet.map((o) => o.nombre).join(', ') + '.' : !cajaLibreDet ? 'La disponibilidad propia no está determinada.' : '';
    add({ rule_id: 'OBLIGACIONES', severidad: !evaluable ? 'info' : alcanza ? 'ok' : 'critico', metric: 'caja_libre', actual: evaluable ? ev.caja_libre.amount : null, base: total, impacto: total, suficiencia_evaluable: evaluable,
      texto: 'Para ' + sig + ': ' + (conf ? Base.plata_(conf) + ' en compromisos registrados' : '') + (conf && estimadas.length ? ' y ' : '') +
        (estimadas.length ? '≈ ' + Base.plata_(estimadas.reduce((t, o) => t + o.estimado, 0)) + ' estimados (' + estimadas.map((o) => o.nombre).join(', ') + ')' : '') +
        (evaluable ? '. La disponibilidad propia (' + Base.plata_(ev.caja_libre.amount) + ') ' + (alcanza ? 'los cubre.' : 'NO los cubre.') : '. No se puede afirmar si alcanza. ' + motivo),
      limites: 'Lo estimado sale del promedio de lo pagado: no es una deuda confirmada.',
      hechos: { observa: 'Obligaciones de ' + sig, magnitud: total, componentes: estimadas.map((o) => ({ nombre: o.nombre, monto: o.estimado })), falta: porDet.map((o) => o.nombre), revisar: 'Compromisos y proyección' },
      evidencia: { vista: 'proyeccion' } });
  } else if (porDet.length) add({ rule_id: 'OBLIGACIONES', severidad: 'info', metric: null, impacto: 0, texto: 'Obligaciones de ' + sig + ': por determinar (no hay pagos de ' + porDet.map((o) => o.nombre).join(', ') + ' registrados).', limites: '',
    hechos: { observa: 'Obligaciones', magnitud: null, componentes: [], falta: porDet.map((o) => o.nombre), revisar: 'Compromisos y proyección' }, evidencia: { vista: 'proyeccion' } });
  // 9. Entre empresas.
  if ((c.breakdowns.entre_empresas || []).length) add({ rule_id: 'ENTRE_EMPRESAS', severidad: 'info', metric: null, impacto: c.breakdowns.entre_empresas[0].monto,
    texto: 'Entre empresas: ' + c.breakdowns.entre_empresas.slice(0, 3).map((d) => d.debe + ' le debe ' + Base.plata_(d.monto) + ' a ' + d.a).join(' · ') + '.',
    limites: 'Préstamos y gastos compartidos; cada préstamo se cuenta una vez aunque se vea en las dos cuentas.' + ((c.breakdowns.prestamos_sin_desembolso || []).length ? ' Aparte, ' + c.breakdowns.prestamos_sin_desembolso.length + ' préstamo(s) registrados por ' + Base.plata_(c.breakdowns.prestamos_sin_desembolso.reduce((t, x) => t + x.monto, 0)) + ' sin desembolso vinculado: no se cuentan como deuda hasta vincularlo.' : ''),
    hechos: { observa: 'Saldos entre empresas', magnitud: c.breakdowns.entre_empresas[0].monto, componentes: c.breakdowns.entre_empresas.slice(0, 3), falta: [], revisar: 'Préstamos' }, evidencia: { vista: 'prestamos' } });
  // 10. Fondos de clientes y abonos sin factura.
  if (m.custodia_positiva > 0) add({ rule_id: 'FONDOS_CLIENTES', severidad: 'info', metric: 'custodia', actual: m.custodia_positiva, impacto: m.custodia_positiva,
    texto: 'Hay ' + Base.plata_(m.custodia_positiva) + ' de clientes en custodia (suma de saldos a favor): es dinero de ellos, no se puede gastar.', limites: m.custodia_parcial ? 'Parcial: faltan saldos iniciales.' : '',
    hechos: { observa: 'Fondos administrados', magnitud: m.custodia_positiva, componentes: [], falta: [], revisar: 'Fondos' }, evidencia: { vista: 'fondos' } });
  if (m.cobranza && m.cobranza.sin_aplicar > 0) add({ rule_id: 'ABONOS_SIN_FACTURA', severidad: 'info', metric: 'sin_aplicar', actual: m.cobranza.sin_aplicar, impacto: m.cobranza.sin_aplicar,
    texto: Base.plata_(m.cobranza.sin_aplicar) + ' cobrados a clientes todavía no se aplican a una factura.', limites: 'No es dinero en custodia: son cobros propios esperando su factura o su aplicación.',
    hechos: { observa: 'Cobros sin aplicar', magnitud: m.cobranza.sin_aplicar, componentes: [], falta: [], revisar: 'Cobranza' }, evidencia: { vista: 'cobranza', filtros: {} } });
  // Prioridad: lo que cambia la interpretación; después severidad; a igual severidad, materialidad.
  L.sort((a, b) => (b.interpreta - a.interpreta) || SEV[a.severidad] - SEV[b.severidad] || (b.impacto || 0) - (a.impacto || 0));
  L.forEach((x, i) => { x.principal = i < PRINCIPALES; });
  return L;
}


// ---------------------------------------------------------------- acciones

// El último contrato por cuenta y clave: el PDF y la exportación usan EXACTAMENTE lo que se vio.
const vistos_ = new Map();
function clave_(o) { return [o.periodo || '', o.empresa || '', o.base || 'CASH_GROSS', o.comparacion || ''].join('|'); }

const reporte = B.conBoveda('VER_TABLERO', function (db, data, contexto) {
  const o = { periodo: Base.txt_(data && data.periodo), empresa: Base.txt_(data && data.empresa), base: Base.txt_(data && data.base).toUpperCase(), comparacion: Base.txt_(data && data.comparacion) };
  const c = reporte_(db, o);
  vistos_.set(contexto.cuenta_id + '|' + clave_(o), { rev: c.data_revision, c, en: Date.now() });
  if (vistos_.size > 200) vistos_.delete(vistos_.keys().next().value);
  return c;
});

/**
 * «Ver qué cambió» / «Cómo se calculó»: los hechos detrás de una cifra (con su
 * referencia) en el período y, si se pide, en el de comparación.
 * data: { periodo, empresa, metric (ingresos|egresos|fondos_recibidos|fondos_pagados|pendientes), concepto?, comparar? }
 */
const detalle = B.conBoveda('VER_DETALLE_REPORTE', function (db, data) {
  const periodo = Base.periodo_(data && data.periodo);
  if (!periodo) return errorValidacion('periodo', 'Falta el mes.');
  const emp = Cat.empresa_(data.empresa) || '';
  // prestamos: las piernas de préstamos del mes (para vincularlas a un préstamo en Planificación).
  const tipo = { ingresos: 'INGRESO', egresos: 'EGRESO', fondos_recibidos: 'FONDO_RECIBIDO', fondos_pagados: 'FONDO_PAGADO', prestamos: 'PRESTAMO' }[data.metric] || '';
  const filtro = (p) => H.hechos_({ periodo: p }).filter((h) => H.parteEmpresa_(h, emp) && (data.metric === 'pendientes' ? !h.clasif : h.clasif && (!tipo || h.clasif.tipo === tipo) && (!data.concepto || h.clasif.cuenta === data.concepto)))
    .map((h) => ({ ref: h.ref, fuente: h.fuente, fecha: h.fecha, monto: H.parteEmpresa_(h, emp), sentido: h.abono ? 'entra' : 'sale', concepto: h.clasif ? h.clasif.cuenta : '', cliente: h.clasif ? h.clasif.cliente || '' : '',
      glosa: h.glosa || '', cuenta: h.banco ? h.banco + ' ···' + h.ultimos4 : (h.medio || ''), empresa: h.empresa, sin_banco: !!h.sin_banco, compartido: !!(h.clasif && h.clasif.reparto),
      contraparte: h.clasif ? h.clasif.empresa || '' : '', prestamo_id: h.clasif ? h.clasif.prestamo_id || '' : '', gasto_compartido_id: h.clasif ? h.clasif.gasto_compartido_id || '' : '', monto_total: h.abono || h.cargo }));
  const actual = filtro(periodo);
  const comp = data.comparar ? filtro(Base.mesAnterior_(periodo)) : null;
  return { periodo, metric: data.metric, concepto: data.concepto || '', definicion: DEFINICIONES[data.metric] || null, hechos: actual, total: actual.reduce((s, h) => s + h.monto, 0),
    comparacion: comp ? { periodo: Base.mesAnterior_(periodo), hechos: comp, total: comp.reduce((s, h) => s + h.monto, 0) } : null };
});

// ---------------------------------------------------------------- informe PDF (FIN-39)

const esc_ = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ESTADO_TXT = { COMPLETO: 'Completo', PROVISIONAL: 'Provisorio', INCOMPLETO: 'Incompleto' };
/** Importe corto para escalas: $2,3 M · $450 mil. */
function corto_(n) { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? '$' + (a / 1e6).toFixed(1).replace('.', ',') + ' M' : a >= 1e3 ? '$' + Math.round(a / 1e3) + ' mil' : '$' + Math.round(a)); }
function barrasSvg_(serie, k1, k2, enCurso) {
  const vals = serie.flatMap((s) => [s[k1], s[k2]]).filter((v) => v !== null && v !== undefined);
  const mx = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const W = 640, Hh = 180, L = 48, bw = (W - L) / Math.max(1, serie.length);
  const y = (v) => 14 + (Hh - 44) * (1 - Math.max(0, v) / mx);
  let s = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Arial" font-size="10">';
  // Escala: el máximo y el cero, con su unidad.
  s += '<text x="' + (L - 6) + '" y="' + (y(mx) + 4) + '" text-anchor="end" fill="#5B6577">' + esc_(corto_(mx)) + '</text><text x="' + (L - 6) + '" y="' + (Hh - 30) + '" text-anchor="end" fill="#5B6577">$0</text>';
  serie.forEach((p, i) => {
    const x0 = L + i * bw, w = Math.max(3, Math.min(16, (bw - 10) / 2));
    if (p.sin_datos) { s += '<text x="' + (x0 + bw / 2) + '" y="' + (Hh - 44) + '" text-anchor="middle" fill="#9aa3b2">sin datos</text>'; }
    else {
      s += '<rect x="' + (x0 + bw / 2 - w - 1) + '" y="' + y(p[k1] || 0) + '" width="' + w + '" height="' + (Hh - 30 - y(p[k1] || 0)) + '" fill="#1C5CAB"' + (enCurso === p.periodo ? ' fill-opacity=".55"' : '') + '/>';
      if (k2) s += '<rect x="' + (x0 + bw / 2 + 1) + '" y="' + y(p[k2] || 0) + '" width="' + w + '" height="' + (Hh - 30 - y(p[k2] || 0)) + '" fill="#C2410C"' + (enCurso === p.periodo ? ' fill-opacity=".55"' : '') + '/>';
    }
    s += '<text x="' + (x0 + bw / 2) + '" y="' + (Hh - 14) + '" text-anchor="middle" fill="#5B6577">' + esc_(p.periodo.slice(5) + '/' + p.periodo.slice(2, 4)) + '</text>';
    if (enCurso === p.periodo) s += '<text x="' + (x0 + bw / 2) + '" y="' + (Hh - 2) + '" text-anchor="middle" fill="#A15C07">en curso</text>';
  });
  return s + '<line x1="' + L + '" x2="' + W + '" y1="' + (Hh - 30) + '" y2="' + (Hh - 30) + '" stroke="#C9D3E6"/></svg>';
}
function informeHtml_(c, quien, cuando) {
  const m = c.metrics, b = c.breakdowns;
  const P = (v) => v === null || v === undefined ? '—' : esc_(Base.plata_(v));
  // Misma evaluación que la pantalla (I03): estado de cada cifra y por qué; la comparación dice si se califica.
  const ev = c.evaluacion || {};
  const EST = { DETERMINED: 'Determinada', PROVISIONAL: 'Provisoria', NOT_DETERMINABLE: 'No determinable' };
  const cmpTxt = (cmp) => !cmp ? '—' : cmp.texto + (cmp.evaluable === false && cmp.estado === 'COMPARABLE' ? ' · sin calificar' : '');
  const tramoCmp = (((c.comparisons.ingresos || c.comparisons.ventas_netas || {}).PREVIOUS_PERIOD) || {});
  const fila = (k, v) => { const e = ev[k]; const nd = e ? e.status === 'NOT_DETERMINABLE' : (v === null || v === undefined);
    const estado = e ? EST[e.status] : c.quality.status === 'COMPLETO' ? 'Determinada' : 'Provisoria';
    const nota = nd && e ? e.detalle.map((d) => d.texto).join(' ') + (e.referencial ? ' Referencia (no acreditada): ' + e.referencial.formula + ' = ' + Base.plata_(e.referencial.monto) + '.' : '') : '';
    return '<tr><td>' + esc_((DEFINICIONES[k] || {}).nombre || k) + '</td><td class="n">' + (nd ? '—' : P(v)) + '</td><td>' + esc_(estado) + '</td><td>' + esc_(nota) + '</td></tr>'; };
  const flujo = c.basis === 'DOCUMENT_NET' ? ['ventas_netas'] : ['ingresos', 'egresos', 'flujo_propio', 'fondos_recibidos', 'fondos_pagados'];
  const ind = flujo.map((k) => fila(k, m[k])).join('') + fila('caja', m.caja) + fila('custodia', m.custodia_positiva) + fila('caja_libre', m.caja_libre) + fila('meses_caja', m.meses_caja === null ? null : m.meses_caja);
  const cmpFilas = flujo.map((k) => { const x = c.comparisons[k] || {}; return '<tr><td>' + esc_((DEFINICIONES[k] || {}).nombre || k) + '</td><td class="n">' + P(m[k]) + '</td>' + ['PREVIOUS_PERIOD', 'SAME_PERIOD_LAST_YEAR', 'BUDGET'].map((t) => '<td>' + esc_(cmpTxt(x[t])) + '</td>').join('') + '</tr>'; }).join('');
  const insLi = (i) => '<li class="' + i.severidad + '"><b>' + esc_(i.texto) + '</b>' + (i.limites ? '<br><span class="lim">' + esc_(i.limites) + '</span>' : '') + '</li>';
  const prin = c.insights.filter((i) => i.principal), otros = c.insights.filter((i) => !i.principal);
  const cas = b.cascada;
  const casHtml = cas ? '<h2>Cascada del flujo propio</h2><table><thead><tr><th>Concepto</th><th>Tipo</th><th class="n">Aporte</th></tr></thead><tbody>' +
    cas.pasos.map((x) => '<tr><td>' + esc_(x.concepto) + '</td><td>' + (x.signo > 0 ? 'Cobro' : 'Pago') + '</td><td class="n">' + P(x.signo * x.monto) + '</td></tr>').join('') +
    '<tr class="tot"><td>Flujo propio</td><td></td><td class="n">' + P(cas.total) + '</td></tr></tbody></table>' +
    '<p class="lim">' + (cas.cuadra ? 'La suma de los conceptos cuadra con el indicador.' : 'ATENCIÓN: la suma no cuadra con el indicador (' + P(cas.flujo_propio) + ').') + (cas.fuera.length ? ' Fuera del flujo propio: ' + cas.fuera.map((x) => esc_(x.nombre) + ' ' + P(x.monto)).join(' · ') + '.' : '') + '</p>' : '';
  const ctas = (b.cuentas_periodo || []).length ? '<h2>Cuentas y caja</h2><table><thead><tr><th>Cuenta</th><th class="n">Apertura</th><th class="n">Entradas</th><th class="n">Salidas</th><th class="n">Cierre</th><th>Cobertura</th><th class="n">Diferencia</th></tr></thead><tbody>' +
    b.cuentas_periodo.map((x) => '<tr><td>' + esc_(x.cuenta + ' · ' + x.empresa) + '</td><td class="n">' + P(x.apertura) + '</td><td class="n">' + P(x.entradas) + '</td><td class="n">' + P(x.salidas) + '</td><td class="n">' + P(x.cierre) + (x.al ? '<br><span class="lim">al ' + esc_(x.al) + '</span>' : '') + '</td><td>' + (x.completa ? 'Completa' : 'Hasta ' + esc_(x.cubierta_hasta || '—')) + '</td><td class="n">' + (x.diferencia === null ? esc_(x.nota || '—') : P(x.diferencia)) + '</td></tr>').join('') + '</tbody></table>' : '';
  const cb = m.cobranza;
  const ant = cb && cb.antiguedad ? '<h2>Cobranza por antigüedad (corte: hoy, ' + esc_(cb.corte) + ')</h2><table><thead><tr><th>Tramo</th><th class="n">Facturas</th><th class="n">Saldo confirmado</th></tr></thead><tbody>' +
    cb.antiguedad.map((x) => '<tr><td>' + esc_(x.tramo) + '</td><td class="n">' + x.facturas + '</td><td class="n">' + P(x.monto) + '</td></tr>').join('') + '</tbody></table><p class="lim">Cobros sin aplicar: ' + P(cb.sin_aplicar) + '. Las aplicaciones sugeridas no rebajan el saldo hasta confirmarse.</p>' : '';
  const egr = (b.egresos_por_concepto || []).slice(0, 10).map((x) => '<tr><td>' + esc_(x.concepto) + '</td><td class="n">' + P(x.actual) + '</td><td class="n">' + P(x.base) + '</td><td class="n">' + P(x.diferencia) + '</td></tr>').join('');
  const pend = c.quality.reasons.map((r) => '<li>' + esc_(r.texto) + '</li>').join('') || '<li>Sin observaciones de calidad.</li>';
  const enCurso = c.as_of.slice(0, 7) === c.period ? c.period : '';
  return '<div class="inf"><header><p class="ceja">Informe financiero · ' + esc_(c.scope.alcance) + ' · Confidencial</p><h1>' + esc_(Base.nombreMes_(c.period)) + '</h1>' +
    '<p class="meta">Corte ' + esc_(c.as_of) + ' · Base: ' + esc_(BASES[c.basis]) + ' · Moneda: CLP · Estado: <b>' + esc_(ESTADO_TXT[c.quality.status] + (c.quality.cerrado ? ' · mes cerrado' : '')) + '</b> · Revisión de datos ' + esc_(c.data_revision) + ' · Reglas v' + esc_(c.rule_version) + '</p>' +
    (c.quality.status !== 'COMPLETO' ? '<p class="aviso">Informe ' + esc_(ESTADO_TXT[c.quality.status].toLowerCase()) + ': las cifras pueden cambiar. Ver «Calidad del dato».</p>' : '') + '</header>' +
    '<h2>Lectura del mes</h2><ul class="ins">' + prin.map(insLi).join('') + '</ul>' + (otros.length ? '<h3>Otros hallazgos</h3><ul class="ins otros">' + otros.map(insLi).join('') + '</ul>' : '') +
    '<h2>Indicadores</h2><table><thead><tr><th>Indicador</th><th class="n">Valor</th><th>Estado</th><th>Por qué</th></tr></thead><tbody>' + ind + '</tbody></table>' +
    '<h2>Comparaciones</h2><table><thead><tr><th>Indicador</th><th class="n">' + esc_(Base.nombreMes_(c.period)) + '</th><th>Mes anterior</th><th>Mismo mes del año anterior</th><th>Presupuesto aprobado</th></tr></thead><tbody>' + cmpFilas + '</tbody></table>' +
    (tramoCmp.modalidad === 'ACUMULADO_A_LA_FECHA' && tramoCmp.fechas ? '<p class="lim">Mes en curso: se compara el mismo tramo de días (' + esc_(tramoCmp.fechas.actual.join(' a ')) + ' contra ' + esc_(tramoCmp.fechas.base.join(' a ')) + ', y lo mismo contra el año anterior). El presupuesto mensual no se evalúa con un mes parcial.</p>' : '') +
    (c.basis === 'CASH_GROSS' ? '<h2>Cobros y pagos propios, últimos meses</h2>' + barrasSvg_(c.series, 'ingresos', 'egresos', enCurso) + '<p class="ley"><span class="a"></span>Cobros propios <span class="b"></span>Pagos propios · meses sin datos: huecos (no ceros)' + (enCurso ? ' · el mes en curso va atenuado' : '') + '.</p>' : '') +
    casHtml +
    (egr ? '<h2>Pagos propios por concepto</h2><table><thead><tr><th>Concepto</th><th class="n">Este mes</th><th class="n">Mes anterior</th><th class="n">Diferencia</th></tr></thead><tbody>' + egr + '</tbody></table>' : '') +
    ctas + ant +
    '<h2>Calidad del dato y pendientes</h2><ul>' + pend + '</ul>' +
    ((c.excepciones || []).length ? '<h2>Excepciones aceptadas</h2><ul>' + c.excepciones.map((e) => '<li><b>' + esc_(e.alcance) + ':</b> ' + esc_(e.motivo) + (e.evidencia ? ' (evidencia: ' + esc_(e.evidencia) + ')' : '') + ' · aprobó ' + esc_(e.aprobado_por || e.por || '—') + '<br><span class="lim">' + esc_(e.limitacion || '') + '</span></li>').join('') + '</ul>' : '') +
    '<h2>Cómo se calcula</h2><ul class="def">' + Object.keys(DEFINICIONES).map((k) => { const d = DEFINICIONES[k]; return '<li><b>' + esc_(d.nombre) + ':</b> ' + esc_(d.formula) + (d.fuentes ? ' <span class="lim">Fuentes: ' + esc_(d.fuentes) + '. Excluye: ' + esc_(d.excluye) + '. Fecha: ' + esc_(d.fecha) + '.</span>' : '') + '</li>'; }).join('') + '</ul>' +
    '<h2>Reglas de los comentarios (v' + esc_(c.rule_version) + ')</h2><table><thead><tr><th>Regla</th><th>Exige</th><th>Cuándo califica</th></tr></thead><tbody>' + (c.reglas || []).map((r) => '<tr><td>' + esc_(r.rule_id) + '</td><td>' + esc_(r.exige) + '</td><td>' + esc_(r.califica) + '</td></tr>').join('') + '</tbody></table>' +
    '<p class="pie">Generado por ' + esc_(quien) + ' el ' + esc_(cuando) + ' desde la bóveda de Finanzas, revisión de datos ' + esc_(c.data_revision) + '. Confidencial: no reenviar fuera de la empresa.</p></div>';
}
const CSS_INFORME = '.inf{font:12px/1.5 Inter,Arial,sans-serif;color:#15233B}.inf h1{font-size:26px;margin:2px 0 4px}.inf h2{font-size:15px;color:#1C5CAB;margin:18px 0 6px;border-bottom:1px solid #D9DCE3;padding-bottom:3px}' +
  '.ceja{color:#1C5CAB;font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:10px;margin:0}.meta{color:#5B6577;margin:0 0 8px}.aviso{background:#FCF0DC;border-left:3px solid #A15C07;padding:6px 10px}' +
  'table{width:100%;border-collapse:collapse;font-size:11px}th,td{border-bottom:1px solid #E3E6EC;padding:4px 6px;text-align:left}th{background:#EEF1F6}.n{text-align:right;font-variant-numeric:tabular-nums}' +
  'h3{font-size:12.5px;margin:10px 0 4px;color:#3B4A63}.otros{font-size:11px}tr.tot td{font-weight:700;border-top:2px solid #C9D3E6}thead{display:table-header-group}tr{page-break-inside:avoid}h2{page-break-after:avoid}.ins li{margin-bottom:6px}.ins .critico b{color:#B42318}.ins .alerta b{color:#A15C07}.lim{color:#5B6577}.def li{margin-bottom:3px}.ley .a,.ley .b{display:inline-block;width:10px;height:10px;margin:0 4px 0 10px}.ley .a{background:#1C5CAB}.ley .b{background:#C2410C}.pie{color:#5B6577;margin-top:18px;font-size:10px}';

/**
 * El informe del mes en PDF, armado en el servidor desde el contrato (no se
 * imprime HTML del navegador). data: { periodo, empresa, base, data_revision }.
 * Si los datos cambiaron desde que la persona los vio, se pide recargar.
 */
const informePdf = Base.conCapacidad('EXPORTAR', '', function (db, data, contexto, x) {
  const o = { periodo: Base.txt_(data && data.periodo), empresa: Base.txt_(data && data.empresa), base: Base.txt_(data && data.base).toUpperCase(), comparacion: Base.txt_(data && data.comparacion) };
  const c = reporte_(db, o);
  if (data.data_revision && data.data_revision !== c.data_revision) return Base.errConflicto('Los datos cambiaron desde que abriste el informe. Recarga la pantalla y vuelve a descargarlo.');
  const ahora = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const marca = 'CONFIDENCIAL · ' + x.nombre + ' · ' + ahora;
  const agua = '<div class="fin2-agua" aria-hidden="true">' + Array.from({ length: 14 }, () => '<span>' + esc_(marca) + '</span>').join('') + '</div>';
  const css = CSS_INFORME + '.fin2-agua{position:fixed;inset:-20% -20%;display:flex;flex-wrap:wrap;align-content:space-around;justify-content:space-around;gap:90px 60px;transform:rotate(-28deg);pointer-events:none;z-index:9999}' +
    '.fin2-agua span{font:600 15px Arial,sans-serif;color:rgba(28,92,171,.08);white-space:nowrap}';
  x.registrar('DESCARGAR_INFORME', Base.nombreMes_(c.period) + ' · ' + c.scope.alcance + ' · ' + c.quality.status + ' · rev ' + c.data_revision);
  const titulo = 'Informe financiero ' + Base.nombreMes_(c.period) + ' · ' + c.scope.alcance;
  return require('./reportePdf').generarPdfReporte(db, { html: agua + informeHtml_(c, x.nombre, ahora), css, titulo, nombre_archivo: 'informe-financiero-' + c.period + (c.scope.empresa ? '-' + c.scope.empresa : '') }, contexto);
});

module.exports = { reporte, detalle, informePdf, reporte_, comparar_, insights_, informeHtml_, DEFINICIONES, BASES };
