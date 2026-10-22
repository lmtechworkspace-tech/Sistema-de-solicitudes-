'use strict';

/**
 * finanzasInformes.js — Los informes de Finanzas, construidos sobre la planilla del banco (v5, 22-10-2026).
 *
 * La planilla BANCOS y la de SIGECO tenían el mismo problema: se llenaban, pero no decían qué significaban los datos.
 * Este módulo convierte la planilla en información, con las MISMAS reglas que ya usa la hoja (finanzasHoja), de modo
 * que cada cifra del informe se puede rastrear hasta sus filas:
 *
 *   - Honorarios = filas con OBS ABONO / ABONO RENTA que entran + lo que sobró de un grupo y se cobró como honorario.
 *   - Gastos     = filas con OBS ABONO que salen (por plan de cuenta).
 *   - Resultado  = honorarios − gastos  (= ABONO + ABONO RENTA del resumen de la planilla).
 *   - Fondos de clientes, traspasos y lo sin completar van aparte: no son de la empresa.
 *   - Custodia   = por cliente, lo recibido − lo pagado por él − lo cobrado de lo que sobró (acumulado); se suman los
 *                  saldos a favor. Caja libre = saldo del banco − custodia.
 *   - Verificación con la cartola: lo anotado a mano que el banco confirma, lo que espera, lo que el banco trae sin
 *                  anotar, posibles montos mal digitados y la cadena de saldos.
 *
 * Cada informe trae, además de las cifras, las filas que las componen (para «¿cómo se calculó?»), comentarios
 * automáticos con su explicación y la calidad de los datos (completo o provisorio, y por qué).
 */

const B = require('./finanzasBoveda');
const F = require('./finanzasBancos');
const H = require('./finanzasHoja');
const { errorValidacion } = require('./errores');

const I = F.interno;
const txt_ = (v) => String(v == null ? '' : v).trim();
const N = (s) => I.normalizar_(s);
const PER_ = /^\d{4}-\d{2}$/;
const MESES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MAX_RANGO = 24, MAX_HISTORIA = 36;

// Gastos que se repiten todos los meses (por contrato): una estimación por el plan de cuenta, se explica como tal.
const FIJOS_ = /SUELDO|REMUNERAC|ARRIENDO|SERVIDOR|SISTEMA|INTERNET|TELEFON|CUENTAS BASICAS|PATENTE|LEASING|SEGURO|CONTADOR/;
// Honorarios que se cobran todos los meses (igualas): el resto es puntual (renta, asesorías, otros).
const RECURRENTES_ = /MENSUAL/;

function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function mesMas_(p, n) { const [a, m] = p.split('-').map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); }
function rango_(desde, hasta) { const out = []; for (let p = desde; p <= hasta && out.length < 600; p = mesMas_(p, 1)) out.push(p); return out; }
function nombreMes_(p) { return MESES_[Number(p.slice(5, 7)) - 1] + ' ' + p.slice(0, 4); }
function plata_(n) { const v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
function pct_(a, b) { return b ? Math.round((a / b) * 1000) / 10 : null; }
function sumar_(o, k, v) { o[k] = (o[k] || 0) + v; }
function dias_(a, b) { return Math.abs(Date.parse(a) - Date.parse(b)) / 864e5; }

// ---------------------------------------------------------------- un mes

/**
 * Las cifras de un mes (de las cuentas elegidas), con cada fila de la planilla clasificada en una categoría:
 *   hon (honorario), hon_grupo (sobrante de un grupo cobrado), gas (gasto), fon_rec / fon_pag (fondos de clientes),
 *   favor (sobrante que queda a favor del cliente), pend (grupo abierto), tra (traspaso o préstamo), sin (sin completar).
 */
function mes_(db, ctx, cuentas, periodo) {
  const filas = [];
  const m = {
    periodo, honorarios: 0, gastos: 0, resultado: 0, fondos_recibidos: 0, fondos_pagados: 0, traspasos: 0, sin_completar: 0, n_sin_completar: 0,
    a_favor: 0, pendiente: 0, neto: 0, hon_plan: {}, hon_cliente: {}, gas_plan: {}, recurrentes: 0, gastos_fijos: 0, n_filas: 0,
    banco: { saldo_inicial: 0, saldo_final: 0, movimientos: 0, cuadra: true, cortes: 0, repetidos: 0, cuentas_sin_cartola: [], cuentas: 0 },
    verif: { ok: 0, esperando: 0, falta: 0, por_completar: 0, m_ok: 0, m_esperando: 0, m_falta: 0, diferencias: [] }
  };
  cuentas.forEach((cu) => {
    const h = H.construir_(db, cu, periodo, ctx);
    const cuenta = cu.banco + ' ···' + cu.ultimos4;
    h.filas.forEach((f) => {
      const fila = { p: periodo, id: f.id, f: f.fecha, fb: f.fecha_banco || '', n: f.cliente || f.nombre || '', nom: f.nombre || '', o: f.obs || '', pl: f.plan || '', m: f.monto, c: 'sin', b: f.banco, g: f.grupo || '', cu: cuenta, gl: f.glosa || '' };
      if (f.grupo) fila.c = f.monto > 0 ? 'fon_rec' : 'fon_pag';
      else if (f.que.k === 'ing') { fila.c = 'hon'; fila.pl = H.planFlujo_(f) || 'Otros Ingresos'; }
      else if (f.que.k === 'gas') { fila.c = 'gas'; fila.pl = H.planFlujo_(f) || 'Sin plan de cuenta'; }
      else if (f.que.k === 'fon') { fila.c = f.monto > 0 ? 'fon_rec' : 'fon_pag'; fila.pl = f.plan || f.obs; }
      else if (f.que.k === 'tra') { fila.c = 'tra'; fila.pl = f.que.t; }
      filas.push(fila);
      m.n_filas++;
      m.verif[f.banco === 'ok' ? 'ok' : f.banco === 'esperando' ? 'esperando' : 'falta']++;
      m.verif[f.banco === 'ok' ? 'm_ok' : f.banco === 'esperando' ? 'm_esperando' : 'm_falta'] += f.monto;
    });
    h.grupos.forEach((g) => {
      const v = H.valorGrupo_(g);
      const base = { p: periodo, id: 'g:' + cu.id + ':' + g.letra, f: '', n: g.cliente || 'sin nombre', o: g.decision, m: v, b: 'grupo', g: g.letra, cu: cuenta, gl: 'Grupo ' + g.letra + ': entró ' + plata_(g.entra) + ', salió ' + plata_(g.sale) };
      if (g.decision === 'ABONO' || g.decision === 'ABONO RENTA') filas.push(Object.assign(base, { c: 'hon_grupo', pl: g.decision === 'ABONO RENTA' ? 'Servicio Renta' : 'Servicio Mensual' }));
      else if (g.decision === 'SALDO') filas.push(Object.assign(base, { c: 'favor', pl: 'A favor del cliente' }));
      else filas.push(Object.assign(base, { c: 'pend', pl: 'Grupo abierto' }));
    });
    m.verif.por_completar += h.estado.por_completar;
    m.neto += h.totales.TOTAL;
    m.banco.cuentas++;
    if (h.cartola) {
      m.banco.saldo_inicial += h.cartola.saldo_inicial; m.banco.saldo_final += h.cartola.saldo_final; m.banco.movimientos += h.cartola.movimientos;
      if (!h.cartola.cuadra) m.banco.cuadra = false;
      m.banco.cortes += h.cartola.n_cortes || 0; m.banco.repetidos += (h.cartola.repetidos || []).length;
    } else if (h.filas.length) m.banco.cuentas_sin_cartola.push(cuenta);
    m.verif.diferencias = m.verif.diferencias.concat(diferencias_(h.filas, cuenta));
  });
  filas.forEach((x) => {
    if (x.c === 'hon' || x.c === 'hon_grupo') {
      m.honorarios += x.m; sumar_(m.hon_plan, x.pl, x.m); sumar_(m.hon_cliente, x.n || 'Sin nombre', x.m);
      if (RECURRENTES_.test(N(x.pl))) m.recurrentes += x.m;
    } else if (x.c === 'gas') { m.gastos -= x.m; sumar_(m.gas_plan, x.pl, -x.m); if (FIJOS_.test(N(x.pl))) m.gastos_fijos -= x.m; }
    else if (x.c === 'fon_rec') m.fondos_recibidos += x.m;
    else if (x.c === 'fon_pag') m.fondos_pagados -= x.m;
    else if (x.c === 'tra') m.traspasos += x.m;
    else if (x.c === 'favor') m.a_favor += x.m;
    else if (x.c === 'pend') m.pendiente += x.m;
    else if (x.c === 'sin') { m.sin_completar += x.m; m.n_sin_completar++; }
  });
  m.resultado = m.honorarios - m.gastos;
  m.margen = m.honorarios ? Math.round((m.resultado / m.honorarios) * 1000) / 10 : null;
  if (m.banco.cuentas_sin_cartola.length || !m.n_filas) { m.banco.saldo_final_conocido = false; }
  else m.banco.saldo_final_conocido = true;
  m.verificado = m.n_filas ? Math.round((m.verif.ok / m.n_filas) * 1000) / 10 : null;
  return { m, filas };
}

/**
 * Posibles montos mal digitados: una fila anotada que el banco no trae y un movimiento del banco sin anotar, del mismo
 * sentido, con fechas cercanas y montos parecidos (diferencia de hasta 10 %). No se cambia nada: se avisa.
 */
function diferencias_(filas, cuenta) {
  const esp = filas.filter((f) => f.banco === 'esperando'), fal = filas.filter((f) => f.banco === 'falta');
  const usados = new Set(), out = [];
  esp.forEach((e) => {
    let mejor = null;
    fal.forEach((b) => {
      if (usados.has(b.id) || Math.sign(b.monto) !== Math.sign(e.monto) || b.monto === e.monto || dias_(b.fecha, e.fecha) > 5) return;
      const r = Math.abs(b.monto - e.monto) / Math.max(Math.abs(b.monto), Math.abs(e.monto));
      if (r <= 0.1 && (!mejor || r < mejor.r)) mejor = { b, r };
    });
    if (mejor) { usados.add(mejor.b.id); out.push({ cuenta, anotada: { id: e.id, fecha: e.fecha, nombre: e.nombre, monto: e.monto }, banco: { id: mejor.b.id, fecha: mejor.b.fecha, glosa: mejor.b.glosa, monto: mejor.b.monto }, diferencia: mejor.b.monto - e.monto }); }
  });
  return out;
}

// ---------------------------------------------------------------- comentarios automáticos

/** Un comentario: qué pasa (titulo), por qué importa (texto), cómo se calculó (como) y qué filas mirar (filtro). */
function c_(nivel, id, titulo, texto, como, filtro) { return { id, nivel, titulo, texto, como, filtro: filtro || null }; }
const ORDEN_ = { critico: 0, alerta: 1, ok: 2, info: 3 };

function variacion_(actual, base) {
  if (base === null || base === undefined) return null;
  if (!base) return actual ? { dif: actual, pct: null } : { dif: 0, pct: 0 };
  return { dif: actual - base, pct: Math.round(((actual - base) / Math.abs(base)) * 1000) / 10 };
}
function mayorCambio_(a, b) {
  const ks = new Set(Object.keys(a || {}).concat(Object.keys(b || {})));
  let top = null;
  ks.forEach((k) => { const d = (a[k] || 0) - ((b || {})[k] || 0); if (!top || Math.abs(d) > Math.abs(top.d)) top = { k, d, actual: a[k] || 0, antes: (b || {})[k] || 0 }; });
  return top && top.d ? top : null;
}
function top_(o, n) { return Object.keys(o).map((k) => ({ k, v: o[k] })).filter((x) => x.v).sort((a, b) => b.v - a.v).slice(0, n); }

function comentariosMes_(m, ant, prom3, extra) {
  const out = [], P = nombreMes_(m.periodo);
  // Resultado del mes
  if (m.honorarios || m.gastos) {
    if (m.resultado < 0) out.push(c_('critico', 'resultado', 'El mes cerró con pérdida de ' + plata_(-m.resultado), 'Los gastos (' + plata_(m.gastos) + ') superaron a los honorarios (' + plata_(m.honorarios) + '). Para cubrirlos faltaron ' + plata_(-m.resultado) + '.',
      'Honorarios ' + plata_(m.honorarios) + ' − gastos ' + plata_(m.gastos) + ' = ' + plata_(m.resultado) + '. Es el ABONO + ABONO RENTA del resumen de la planilla.', { c: ['hon', 'hon_grupo', 'gas'] }));
    else out.push(c_('ok', 'resultado', 'El mes dejó ' + plata_(m.resultado) + ' a favor', 'De cada $100 de honorarios quedaron $' + Math.round(m.margen || 0) + ' después de pagar los gastos (margen ' + (m.margen || 0) + ' %).',
      'Honorarios ' + plata_(m.honorarios) + ' − gastos ' + plata_(m.gastos) + ' = ' + plata_(m.resultado) + '; margen = resultado ÷ honorarios.', { c: ['hon', 'hon_grupo', 'gas'] }));
  }
  // Honorarios vs mes anterior
  const vh = ant ? variacion_(m.honorarios, ant.honorarios) : null;
  if (vh && vh.pct !== null && Math.abs(vh.pct) >= 15) {
    const t = mayorCambio_(m.hon_cliente, ant.hon_cliente);
    out.push(c_(vh.pct < 0 ? 'alerta' : 'ok', 'honorarios_var', 'Los honorarios ' + (vh.pct < 0 ? 'bajaron ' : 'subieron ') + Math.abs(vh.pct) + ' % respecto de ' + nombreMes_(ant.periodo),
      'Pasaron de ' + plata_(ant.honorarios) + ' a ' + plata_(m.honorarios) + ' (' + (vh.dif < 0 ? '' : '+') + plata_(vh.dif) + ').' + (t ? ' El cliente que más explica el cambio es ' + t.k + ' (' + plata_(t.antes) + ' → ' + plata_(t.actual) + ').' : ''),
      'Variación = (honorarios del mes − honorarios del mes anterior) ÷ honorarios del mes anterior. El cliente que más explica el cambio es el de mayor diferencia entre los dos meses.', { c: ['hon', 'hon_grupo'] }));
  }
  // Gastos vs mes anterior y gastos inusuales
  const vg = ant ? variacion_(m.gastos, ant.gastos) : null;
  if (vg && vg.pct !== null && vg.pct >= 15 && vg.dif > 100000) {
    const t = mayorCambio_(m.gas_plan, ant.gas_plan);
    out.push(c_('alerta', 'gastos_var', 'Los gastos subieron ' + vg.pct + ' % respecto de ' + nombreMes_(ant.periodo),
      'Pasaron de ' + plata_(ant.gastos) + ' a ' + plata_(m.gastos) + ' (+' + plata_(vg.dif) + ').' + (t && t.d > 0 ? ' El mayor aumento está en «' + t.k + '»: ' + plata_(t.antes) + ' → ' + plata_(t.actual) + '.' : ''),
      'Variación = (gastos del mes − gastos del mes anterior) ÷ gastos del mes anterior; el plan de cuenta que más subió es el de mayor diferencia.', { c: ['gas'], pl: t ? t.k : '' }));
  } else if (vg && vg.pct !== null && vg.pct <= -15 && ant.gastos) {
    out.push(c_('ok', 'gastos_var', 'Los gastos bajaron ' + Math.abs(vg.pct) + ' % respecto de ' + nombreMes_(ant.periodo), 'Pasaron de ' + plata_(ant.gastos) + ' a ' + plata_(m.gastos) + '.', 'Variación = (gastos del mes − gastos del mes anterior) ÷ gastos del mes anterior.', { c: ['gas'] }));
  }
  if (prom3) {
    Object.keys(m.gas_plan).forEach((k) => {
      const v = m.gas_plan[k], base = prom3.gas_plan[k] || 0;
      if (v > 150000 && v > base * 2) out.push(c_('alerta', 'gasto_inusual:' + k, base ? '«' + k + '» fue más alto de lo habitual' : '«' + k + '» es un gasto nuevo', plata_(v) + ' este mes; ' + (base ? 'el promedio de los meses anteriores fue ' + plata_(base) : 'no aparecía en los meses anteriores') + '.',
        'Se avisa cuando un plan de cuenta supera el doble de su promedio de los meses anteriores con gastos (al menos 2 de los últimos 3) y pasa de $150.000.', { c: ['gas'], pl: k }));
    });
  }
  // Concentración de clientes
  const tops = top_(m.hon_cliente, 3);
  if (m.honorarios > 0 && tops.length) {
    const p1 = pct_(tops[0].v, m.honorarios), p3 = pct_(tops.reduce((s, x) => s + x.v, 0), m.honorarios);
    if (p1 >= 30) out.push(c_('alerta', 'concentracion', tops[0].k + ' explica el ' + p1 + ' % de los honorarios', 'Depender tanto de un cliente es un riesgo: si se atrasa o se va, el mes cambia mucho. Los tres mayores suman el ' + p3 + ' %.',
      'Participación = honorarios del cliente ÷ honorarios del mes. Se avisa desde el 30 %.', { c: ['hon', 'hon_grupo'], n: tops[0].k }));
  }
  // Fondos de clientes y caja libre
  if (extra.deudores && extra.deudores.n) out.push(c_('critico', 'deudores', extra.deudores.n + ' cliente(s) deben ' + plata_(extra.deudores.monto) + ' de fondos', 'Se pagó por ellos más de lo que mandaron: esa plata salió de la empresa (o de otros clientes) y hay que pedírsela. El mayor: ' + extra.deudores.top + '.',
    'Por cliente, acumulado desde ' + nombreMes_(extra.deudores.desde) + ': recibido − pagado por él − lo que sobró y se cobró. Un saldo negativo es una deuda del cliente. Ojo: si el cliente mandó la plata antes de ' + nombreMes_(extra.deudores.desde) + ' (meses no cargados en SIGSO), aparece como deuda sin serlo: carga esos meses o revisa su grupo.', { vista: 'clientes' }));
  if (extra.caja_libre !== null && extra.caja_libre !== undefined) {
    if (extra.caja_libre < 0) out.push(c_('critico', 'caja_libre', 'La cuenta tiene menos plata que la que es de los clientes', 'Al cierre, el banco tenía ' + plata_(extra.saldo) + ' y los clientes tienen ' + plata_(extra.custodia) + ' a su favor: faltan ' + plata_(-extra.caja_libre) + ' para cubrirlos.',
      'Caja libre = saldo final de la cartola − suma de los saldos a favor de los clientes.', { vista: 'clientes' }));
    else if (extra.meses_caja !== null && extra.meses_caja < 1) out.push(c_('alerta', 'meses_caja', 'La plata propia alcanza para menos de un mes de gastos', 'Caja libre ' + plata_(extra.caja_libre) + ' frente a gastos promedio de ' + plata_(extra.gasto_prom) + ' al mes.',
      'Meses de caja = caja libre ÷ gastos promedio de los últimos 3 meses.', null));
  }
  // Cobranza
  if (extra.cobranza && extra.cobranza.vencido > 0) {
    const cb = extra.cobranza, p = pct_(cb.vencido, cb.por_cobrar);
    out.push(c_(p >= 30 ? 'critico' : 'alerta', 'vencido', plata_(cb.vencido) + ' en facturas vencidas', 'Es el ' + p + ' % de lo por cobrar (' + plata_(cb.por_cobrar) + ').' + (cb.top ? ' El mayor deudor: ' + cb.top + '.' : ''),
      'Facturas con saldo cuya fecha de vencimiento ya pasó (corte: hoy). Una factura queda pagada cuando la fila del abono lleva su N° en la planilla.', { vista: 'cobranza' }));
  }
  // Verificación con la cartola
  const v = m.verif;
  if (!m.banco.cuadra || m.banco.cortes) out.push(c_('critico', 'cartola', 'La cartola de ' + P + ' no cuadra', m.banco.cortes ? 'La cadena de saldos se corta en ' + m.banco.cortes + ' fila(s): puede haber movimientos repetidos o faltantes.' : 'Saldo inicial + movimientos no da el saldo final.',
    'Cada saldo de la cartola debe ser el anterior más el movimiento; y saldo inicial + suma de movimientos = saldo final.', { b: ['ok', 'falta'] }));
  if (v.falta || v.esperando) out.push(c_('alerta', 'verificacion', 'Hay ' + (v.falta + v.esperando) + ' fila(s) sin verificar contra la cartola', (v.falta ? v.falta + ' movimiento(s) del banco sin anotar (' + plata_(v.m_falta) + ')' : '') + (v.falta && v.esperando ? ' y ' : '') + (v.esperando ? v.esperando + ' anotada(s) que el banco no trae (' + plata_(v.m_esperando) + ')' : '') + '. Mientras existan, las cifras del mes son provisorias.',
    'Una fila está verificada cuando lo anotado coincide con un movimiento de la cartola (mismo monto, hasta 3 días de diferencia).', { b: ['falta', 'esperando'] }));
  else if (m.n_filas && m.banco.saldo_final_conocido) out.push(c_('ok', 'verificacion', 'Todo lo anotado está en la cartola', 'Las ' + m.n_filas + ' filas del mes coinciden con el banco.', 'Una fila está verificada cuando coincide con un movimiento de la cartola.', null));
  if (v.diferencias.length) out.push(c_('alerta', 'digitacion', v.diferencias.length + ' posible(s) monto(s) mal digitado(s)', v.diferencias.slice(0, 3).map((d) => 'anotado ' + plata_(d.anotada.monto) + ' (' + (d.anotada.nombre || 'sin nombre') + ') y el banco trae ' + plata_(d.banco.monto)).join('; ') + '.',
    'Una fila anotada que el banco no trae y un movimiento del banco sin anotar, del mismo sentido, con fechas a 5 días o menos y montos que difieren en 10 % o menos.', { b: ['falta', 'esperando'] }));
  if (m.n_sin_completar) out.push(c_('info', 'sin_completar', m.n_sin_completar + ' fila(s) sin completar (' + plata_(m.sin_completar) + ')', 'Les falta la OBS o el nombre: no entran a honorarios ni a gastos hasta completarlas.', 'Filas sin OBS (o del banco sin anotar). Se completan en la planilla.', { c: ['sin'] }));
  if (m.pendiente) out.push(c_('info', 'pendiente', plata_(m.pendiente) + ' en grupos abiertos', 'Lo que sobró de esos grupos todavía no se decide (honorario, a favor del cliente o pendiente).', 'Suma de lo que sobra de los grupos marcados PENDIENTE.', { c: ['pend'] }));
  if (m.honorarios > 0) {
    const pr = pct_(m.recurrentes, m.honorarios);
    out.push(c_('info', 'recurrentes', pr + ' % de los honorarios son mensuales (recurrentes)', 'Los honorarios mensuales dan estabilidad; el resto (renta, asesorías puntuales) varía de un mes a otro.', 'Honorarios con plan «Servicio Mensual» (incluye lo cobrado de los grupos) ÷ honorarios del mes.', { c: ['hon', 'hon_grupo'] }));
  }
  return out.sort((a, b) => ORDEN_[a.nivel] - ORDEN_[b.nivel]);
}

/** Tendencia simple (mínimos cuadrados): cuánto cambia por mes. */
function tendencia_(vals) {
  const n = vals.length; if (n < 3) return null;
  const xm = (n - 1) / 2, ym = vals.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0; vals.forEach((v, i) => { num += (i - xm) * (v - ym); den += (i - xm) * (i - xm); });
  const pend = den ? num / den : 0;
  return { por_mes: Math.round(pend), pct: ym ? Math.round((pend / Math.abs(ym)) * 1000) / 10 : null, promedio: Math.round(ym) };
}

function comentariosRango_(todos) {
  const out = [];
  // Solo cuentan los meses con honorarios o gastos anotados: un mes vacío no es un mes en $0 (daría tendencias falsas).
  const ms = todos.filter((m) => m.honorarios || m.gastos);
  const vacios = todos.filter((m) => !(m.honorarios || m.gastos));
  if (vacios.length) out.push(c_('info', 'meses_sin_datos', vacios.length + ' mes(es) del período sin honorarios ni gastos anotados', vacios.map((m) => nombreMes_(m.periodo)).join(', ') + ': no se usan para promedios, tendencias ni comparaciones.', 'Un mes sin filas de honorarios ni de gastos se deja fuera de los cálculos del período para no confundir «sin datos» con «$0».', null));
  if (!ms.length) return out;
  const P0 = nombreMes_(ms[0].periodo), P1 = nombreMes_(ms[ms.length - 1].periodo);
  const tot = (k) => ms.reduce((s, m) => s + m[k], 0);
  const res = tot('resultado'), hon = tot('honorarios'), gas = tot('gastos');
  out.push(c_(res < 0 ? 'critico' : 'ok', 'resultado_rango', 'Entre ' + P0 + ' y ' + P1 + ' el resultado acumulado fue ' + plata_(res), 'Honorarios ' + plata_(hon) + ' y gastos ' + plata_(gas) + ' en ' + ms.length + ' mes(es) con datos (promedio de ' + plata_(res / ms.length) + ' al mes).',
    'Suma de (honorarios − gastos) de cada mes del período.', { c: ['hon', 'hon_grupo', 'gas'] }));
  const neg = ms.filter((m) => m.resultado < 0);
  if (neg.length) out.push(c_(neg.length > ms.length / 2 ? 'critico' : 'alerta', 'meses_negativos', neg.length + ' de ' + ms.length + ' meses cerraron con pérdida', neg.map((m) => nombreMes_(m.periodo) + ' (' + plata_(m.resultado) + ')').join(', ') + '.', 'Meses en que los gastos superaron a los honorarios.', null));
  const th = tendencia_(ms.map((m) => m.honorarios)), tg = tendencia_(ms.map((m) => m.gastos));
  if (th && th.pct !== null && Math.abs(th.pct) >= 3) out.push(c_(th.pct < 0 ? 'alerta' : 'ok', 'tendencia_hon', 'Los honorarios van ' + (th.pct < 0 ? 'a la baja' : 'al alza') + ': ' + (th.por_mes < 0 ? '' : '+') + plata_(th.por_mes) + ' por mes', 'Equivale a ' + (th.pct < 0 ? '' : '+') + th.pct + ' % del promedio mensual (' + plata_(th.promedio) + ').',
    'Tendencia lineal (mínimos cuadrados) de los honorarios mes a mes: la recta que mejor sigue los puntos y su pendiente.', { c: ['hon', 'hon_grupo'] }));
  if (tg && tg.pct !== null && tg.pct >= 3) out.push(c_('alerta', 'tendencia_gas', 'Los gastos van al alza: +' + plata_(tg.por_mes) + ' por mes', 'Equivale a +' + tg.pct + ' % del promedio mensual de gastos (' + plata_(tg.promedio) + ').', 'Tendencia lineal de los gastos mes a mes.', { c: ['gas'] }));
  const mejor = ms.reduce((a, b) => (b.resultado > a.resultado ? b : a)), peor = ms.reduce((a, b) => (b.resultado < a.resultado ? b : a));
  if (ms.length > 2) out.push(c_('info', 'mejor_peor', 'Mejor mes: ' + nombreMes_(mejor.periodo) + ' · peor mes: ' + nombreMes_(peor.periodo), 'Resultado de ' + plata_(mejor.resultado) + ' frente a ' + plata_(peor.resultado) + '.', 'Se comparan los resultados (honorarios − gastos) de cada mes.', null));
  if (ms.length >= 4) {
    const mitad = Math.floor(ms.length / 2), a = {}, b = {};
    ms.slice(0, mitad).forEach((m) => Object.keys(m.gas_plan).forEach((k) => sumar_(a, k, m.gas_plan[k] / mitad)));
    ms.slice(mitad).forEach((m) => Object.keys(m.gas_plan).forEach((k) => sumar_(b, k, m.gas_plan[k] / (ms.length - mitad))));
    const t = mayorCambio_(b, a);
    if (t && t.d > 100000) out.push(c_('alerta', 'gasto_crece', '«' + t.k + '» es el gasto que más creció', 'Promedio mensual de ' + plata_(t.antes) + ' en la primera mitad del período y de ' + plata_(t.actual) + ' en la segunda.', 'Se compara el promedio mensual de cada plan de cuenta entre la primera y la segunda mitad del período.', { c: ['gas'], pl: t.k }));
    const ca = {}, cb = {};
    ms.slice(0, mitad).forEach((m) => Object.keys(m.hon_cliente).forEach((k) => sumar_(ca, k, m.hon_cliente[k] / mitad)));
    ms.slice(mitad).forEach((m) => Object.keys(m.hon_cliente).forEach((k) => sumar_(cb, k, m.hon_cliente[k] / (ms.length - mitad))));
    const tc = mayorCambio_(cb, ca);
    if (tc && Math.abs(tc.d) > 100000) out.push(c_(tc.d < 0 ? 'alerta' : 'ok', 'cliente_cambia', tc.k + ' es el cliente que más ' + (tc.d < 0 ? 'bajó' : 'creció'), 'Promedio mensual de ' + plata_(tc.antes) + ' en la primera mitad y ' + plata_(tc.actual) + ' en la segunda.', 'Se compara el promedio mensual de honorarios de cada cliente entre la primera y la segunda mitad del período.', { c: ['hon', 'hon_grupo'], n: tc.k }));
  }
  const sinVerif = ms.filter((m) => m.verif.falta || m.verif.esperando);
  if (sinVerif.length) out.push(c_('alerta', 'verificacion_rango', sinVerif.length + ' mes(es) con filas sin verificar contra la cartola', sinVerif.map((m) => nombreMes_(m.periodo) + ': ' + (m.verif.falta + m.verif.esperando)).join(' · ') + '. Esas cifras son provisorias.', 'Filas del banco sin anotar o anotadas que el banco no trae, por mes.', { b: ['falta', 'esperando'] }));
  return out.sort((a, b) => ORDEN_[a.nivel] - ORDEN_[b.nivel]);
}

// ---------------------------------------------------------------- el informe

/**
 * data: { desde 'AAAA-MM', hasta 'AAAA-MM', empresa ('' = todo el grupo) }
 * Un solo mes: desde = hasta. Las series traen además los 5 meses anteriores (para comparar y ver la tendencia).
 */
const informe = B.conBoveda('VER_INFORME', function (db, data, contexto) {
  const ctx = H.contexto_(db);
  const todas = [...ctx.cuentas.values()];
  const empresas = [...new Set(todas.map((c) => c.empresa))].sort();
  const empresa = empresas.indexOf(txt_(data && data.empresa)) !== -1 ? data.empresa : '';
  const cuentas = todas.filter((c) => !empresa || c.empresa === empresa);
  const disponibles = I.db_().prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS ORDER BY periodo').all().map((r) => r.periodo);
  const ultimo = disponibles[disponibles.length - 1] || hoy_().slice(0, 7);
  const hasta = PER_.test(txt_(data && data.hasta)) ? data.hasta : ultimo;
  const desde = PER_.test(txt_(data && data.desde)) ? data.desde : hasta;
  if (desde > hasta) return errorValidacion('desde', 'El mes «desde» va antes que el mes «hasta».');
  const sel = rango_(desde, hasta);
  if (sel.length > MAX_RANGO) return errorValidacion('desde', 'Elige como máximo ' + MAX_RANGO + ' meses.');
  // Historia: desde el primer mes con datos (para el saldo acumulado de cada cliente), con un tope.
  let inicio = disponibles[0] && disponibles[0] < mesMas_(desde, -5) ? disponibles[0] : mesMas_(desde, -5);
  if (inicio < mesMas_(hasta, -(MAX_HISTORIA - 1))) inicio = mesMas_(hasta, -(MAX_HISTORIA - 1));
  const meses = rango_(inicio, hasta);
  // Desde cuándo se acumulan los saldos de los clientes: lo recibido antes de ese mes no está en SIGSO.
  const primerDato = disponibles.find((p) => p >= inicio) || inicio;
  const porMes = {}, filasSel = [];
  const saldos = new Map(); // cliente → { recibido, pagado, cobrado }
  const custodia = {};
  meses.forEach((p) => {
    const r = mes_(db, ctx, cuentas, p);
    porMes[p] = r.m;
    if (sel.indexOf(p) !== -1) r.filas.forEach((f) => filasSel.push(f));
    r.filas.forEach((f) => {
      if (!f.n) return;
      const k = N(f.n);
      let s = saldos.get(k); if (!s) { s = { cliente: f.n, recibido: 0, pagado: 0, cobrado: 0 }; saldos.set(k, s); }
      if (f.c === 'fon_rec') s.recibido += f.m; else if (f.c === 'fon_pag') s.pagado -= f.m; else if (f.c === 'hon_grupo') s.cobrado += f.m;
    });
    const lista = [...saldos.values()].map((s) => s.recibido - s.pagado - s.cobrado);
    // Diferencias de menos de $1.000 (redondeos de la planilla) no cuentan como deuda.
    custodia[p] = { a_favor: lista.filter((v) => v > 0).reduce((a, v) => a + v, 0), deben: -lista.filter((v) => v <= -1000).reduce((a, v) => a + v, 0), n_deben: lista.filter((v) => v <= -1000).length };
  });
  // Caja libre y meses de caja por mes (solo con la cartola de todas las cuentas).
  meses.forEach((p, i) => {
    const m = porMes[p], c = custodia[p];
    m.custodia = c.a_favor; m.clientes_deben = c.deben; m.n_clientes_deben = c.n_deben;
    m.caja_libre = m.banco.saldo_final_conocido ? m.banco.saldo_final - c.a_favor : null;
    const prev = meses.slice(Math.max(0, i - 2), i + 1).map((q) => porMes[q].gastos).filter((g) => g > 0);
    m.gasto_prom = prev.length ? Math.round(prev.reduce((a, g) => a + g, 0) / prev.length) : 0;
    m.meses_caja = m.caja_libre !== null && m.gasto_prom ? Math.round((m.caja_libre / m.gasto_prom) * 10) / 10 : null;
  });
  // Clientes al cierre del período: los que deben (negativo) y los de mayor saldo a favor.
  const clientes = [...saldos.values()].map((s) => Object.assign({}, s, { saldo: s.recibido - s.pagado - s.cobrado })).filter((s) => s.saldo >= 1000 || s.saldo <= -1000).sort((a, b) => a.saldo - b.saldo);
  // Cobranza a hoy (de la empresa elegida).
  let facturas = [];
  try { facturas = H.facturas_(db, null).filter((f) => !empresa || f.empresa === empresa); } catch (e) { facturas = []; }
  const hoy = hoy_();
  const aging = { por_vencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
  const deudor = {};
  const cob = { facturado: 0, pagado: 0, por_cobrar: 0, vencido: 0, n_abiertas: 0 };
  facturas.forEach((f) => {
    if (f.estado === 'Incobrable') return;
    cob.facturado += f.total; cob.pagado += f.pagado; cob.por_cobrar += f.saldo;
    if (f.saldo <= 0) return;
    cob.n_abiertas++;
    const d = f.vence && f.vence < hoy ? Math.round((Date.parse(hoy) - Date.parse(f.vence)) / 864e5) : 0;
    if (!d) aging.por_vencer += f.saldo; else { cob.vencido += f.saldo; aging[d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90'] += f.saldo; }
    sumar_(deudor, f.cliente || 'Sin cliente', f.saldo);
  });
  const topDeudores = top_(deudor, 8).map((x) => ({ cliente: x.k, saldo: x.v }));
  const ult3 = meses.slice(-3).map((p) => porMes[p].honorarios).reduce((a, v) => a + v, 0);
  cob.dso = ult3 > 0 ? Math.round(cob.por_cobrar / (ult3 / 90)) : null;
  cob.aging = aging; cob.top_deudores = topDeudores;
  // Comentarios
  const ms = sel.map((p) => porMes[p]);
  const fin = porMes[hasta];
  const extra = {
    deudores: fin.n_clientes_deben ? { n: fin.n_clientes_deben, monto: fin.clientes_deben, top: clientes[0] ? clientes[0].cliente + ' (' + plata_(clientes[0].saldo) + ')' : '', desde: primerDato } : null,
    caja_libre: fin.caja_libre, saldo: fin.banco.saldo_final, custodia: fin.custodia, meses_caja: fin.meses_caja, gasto_prom: fin.gasto_prom,
    cobranza: { vencido: cob.vencido, por_cobrar: cob.por_cobrar, top: topDeudores[0] ? topDeudores[0].cliente + ' (' + plata_(topDeudores[0].saldo) + ')' : '' }
  };
  let comentarios;
  if (sel.length === 1) {
    const ant = porMes[mesMas_(hasta, -1)] || null;
    // Lo habitual se mide con al menos 2 de los 3 meses anteriores con gastos anotados; si no, no hay con qué comparar.
    const prev3 = [1, 2, 3].map((k) => porMes[mesMas_(hasta, -k)]).filter((m) => m && m.gastos > 0);
    const prom3 = prev3.length >= 2 ? { gas_plan: prev3.reduce((o, m) => { Object.keys(m.gas_plan).forEach((k) => sumar_(o, k, m.gas_plan[k] / prev3.length)); return o; }, {}) } : null;
    comentarios = comentariosMes_(fin, ant && ant.n_filas ? ant : null, prom3, extra);
  } else {
    comentarios = comentariosRango_(ms).concat(comentariosMes_(fin, null, null, extra).filter((c) => /deudores|caja_libre|meses_caja|vencido|cartola|digitacion/.test(c.id)));
  }
  // Calidad: completo solo si en todos los meses elegidos todo está anotado, verificado y la cartola cuadra.
  const razones = [];
  ms.forEach((m) => {
    const P = nombreMes_(m.periodo);
    if (!m.n_filas) razones.push(P + ': sin movimientos');
    if (m.banco.cuentas_sin_cartola.length) razones.push(P + ': sin cartola de ' + m.banco.cuentas_sin_cartola.join(', '));
    if (m.verif.falta) razones.push(P + ': ' + m.verif.falta + ' movimiento(s) del banco sin anotar');
    if (m.verif.esperando) razones.push(P + ': ' + m.verif.esperando + ' fila(s) anotadas que el banco no trae');
    if (m.n_sin_completar) razones.push(P + ': ' + m.n_sin_completar + ' fila(s) sin completar');
    if (!m.banco.cuadra || m.banco.cortes) razones.push(P + ': la cartola no cuadra');
  });
  if (hasta >= hoy.slice(0, 7)) razones.push(nombreMes_(hasta) + ' todavía no termina');
  if (primerDato >= desde && ms.some((m) => m.n_clientes_deben || m.custodia)) razones.push('Los saldos de fondos de los clientes parten en ' + nombreMes_(primerDato) + ' (no hay meses anteriores cargados)');
  const serie = meses.filter((p) => p >= mesMas_(desde, -5)).map((p) => porMes[p]);
  return {
    desde, hasta, empresa, empresas, disponibles, hoy, rango: sel,
    meses: serie, filas: filasSel.slice(0, 8000), filas_truncadas: filasSel.length > 8000,
    clientes: { deben: clientes.filter((c) => c.saldo < 0).slice(0, 15), a_favor: clientes.filter((c) => c.saldo > 0).sort((a, b) => b.saldo - a.saldo).slice(0, 15), desde: primerDato },
    cobranza: cob, comentarios,
    calidad: { estado: razones.length ? 'PROVISORIO' : 'COMPLETO', razones: razones.slice(0, 30) }
  };
});

module.exports = { informe, mes_, diferencias_, tendencia_, comentariosMes_, comentariosRango_ };
