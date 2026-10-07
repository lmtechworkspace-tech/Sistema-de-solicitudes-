'use strict';

/**
 * finanzasTablero.js — Finanzas, Etapa 4: tablero de gerencia e informe
 * mensual (2026-10-06).
 *
 * Arma, para un mes y una empresa (o el grupo), lo que gerencia necesita leer
 * en 30 segundos, solo con lo que ya está en la bóveda:
 *  - Resultado del mes = ingresos de la empresa − gastos de la empresa. La
 *    plata de los clientes (fondos recibidos y pagados por su cuenta) va
 *    APARTE: no es ingreso ni gasto (decisión del dueño 2026-10-06).
 *  - Caja al cierre del mes (último saldo de cada cuenta en sus cartolas).
 *  - Fondos de clientes en custodia (recibido − pagado, acumulado).
 *  - Cobranza de hoy (la cartera de finanzasCobranza.js).
 *  - Serie de los últimos 12 meses, gastos por cuenta (cascada), ingresos
 *    por cuenta, comparación entre empresas y las obligaciones del mes que
 *    viene (sueldos 9, imposiciones 10, IVA 20, como en SIGECO).
 *  - Una lectura automática que pone lo malo primero.
 *  - Calidad del dato: si el mes tiene movimientos sin revisar, las cifras
 *    son PROVISORIAS y se dice cuánto falta (nunca se esconde).
 *
 * El informe en PDF lo imprime el mismo motor de reportes de SIGSO, con una
 * marca de agua con el nombre de quien lo descarga y queda en la bitácora.
 */

const B = require('./finanzasBoveda');
const FB = require('./finanzasBancos');
const FC = require('./finanzasCobranza');
const { errorValidacion } = require('./errores');

const I = FB.interno;
const OBLIGACIONES = [
  { id: 'sueldos', nombre: 'Sueldos', dia: 9, cuentas: ['Sueldos', 'Anticipos'] },
  { id: 'imposiciones', nombre: 'Imposiciones', dia: 10, cuentas: ['Imposiciones'] },
  { id: 'iva', nombre: 'IVA (F29)', dia: 20, cuentas: ['IVA', 'IVA Postergado'] }
];

function mesSiguiente_(p) { const [a, m] = p.split('-').map(Number); return m === 12 ? (a + 1) + '-01' : a + '-' + String(m + 1).padStart(2, '0'); }
function vacio_() { return { ingresos: 0, egresos: 0, resultado: 0, fondos_recibidos: 0, fondos_pagados: 0, traspasos: 0, prestamos_entra: 0, prestamos_sale: 0, pendientes: 0, pendiente_monto: 0, total: 0 }; }

/** Todos los movimientos descifrados con su empresa (de la cuenta). */
function movimientos_() {
  const d = I.db_();
  const cuentas = I.cuentasMapa_();
  const P = require('./finanzasPagadores');
  const out = [];
  d.prepare('SELECT cuenta_ref, fecha, periodo, orden, estado, datos FROM FIN_MOVIMIENTOS ORDER BY fecha, orden').all().forEach((r) => {
    const m = I.des_(r.datos);
    const cu = cuentas.get(r.cuenta_ref) || {};
    // Etapa A: una transferencia dividida entre clientes cuenta como sus partes (el saldo es el del movimiento).
    P.piezas_(m, r.estado === 'CONFIRMADO' ? m.clasif : null).forEach((p) => out.push({ cuenta_ref: r.cuenta_ref, empresa: cu.empresa || '', banco: cu.banco, ultimos4: cu.ultimos4, fecha: r.fecha, periodo: r.periodo, estado: r.estado, abono: p.abono, cargo: p.cargo, saldo: m.saldo, clasif: p.clasif || null }));
  });
  return out;
}

/**
 * Qué parte de un movimiento le toca a una empresa ('' = el grupo entero).
 * Un gasto compartido (clasif.reparto) se reparte en partes iguales entre las
 * empresas de la lista, aunque lo haya pagado otra (Etapa 5; GASTOS
 * COMPARTIDOS de SIGECO). Todo lo demás es 100 % de la empresa de la cuenta.
 */
function factor_(m, emp) {
  if (!emp) return 1;
  const rep = m.clasif && m.clasif.tipo === 'EGRESO' && Array.isArray(m.clasif.reparto) && m.clasif.reparto.length >= 2 ? m.clasif.reparto : null;
  if (rep) return rep.indexOf(emp) !== -1 ? 1 / rep.length : 0;
  return m.empresa === emp ? 1 : 0;
}

function acumular_(o, m, f) {
  f = f === undefined ? 1 : f;
  if (!f) return;
  const c = m.clasif;
  o.total++;
  if (!c) { o.pendientes++; o.pendiente_monto += m.abono || m.cargo; return; }
  const monto = Math.round((m.abono || m.cargo) * f);
  if (c.tipo === 'INGRESO') o.ingresos += Math.round(m.abono * f);
  else if (c.tipo === 'EGRESO') o.egresos += Math.round(m.cargo * f);
  else if (c.tipo === 'FONDO_RECIBIDO') o.fondos_recibidos += m.abono;
  else if (c.tipo === 'FONDO_PAGADO') o.fondos_pagados += m.cargo;
  else if (c.tipo === 'TRASPASO') o.traspasos += monto;
  else if (c.tipo === 'PRESTAMO') { if (m.abono) o.prestamos_entra += m.abono; else o.prestamos_sale += m.cargo; }
  o.resultado = o.ingresos - o.egresos;
}

/**
 * Quién le debe a quién dentro del grupo (neteado por par), como la sección
 * "Préstamos entre empresas" de SIGECO:
 *  - PRESTAMO que SALE de la cuenta de A hacia B → B le debe a A; si ENTRA → A le debe a B.
 *  - Gasto compartido pagado por A → cada otra empresa del reparto le debe su parte a A.
 */
function deudasEntreEmpresas_(movs) {
  const saldo = {}; // "A|B" con A < B: positivo = B le debe a A
  const sumar = (acreedor, deudor, monto) => {
    if (!acreedor || !deudor || acreedor === deudor || !monto) return;
    const [x, y] = [acreedor, deudor].sort();
    const k = x + '|' + y;
    saldo[k] = (saldo[k] || 0) + (acreedor === x ? monto : -monto);
  };
  movs.forEach((m) => {
    const c = m.clasif;
    if (!c) return;
    if (c.tipo === 'PRESTAMO' && c.empresa) {
      if (m.cargo > 0) sumar(m.empresa, c.empresa, m.cargo); else sumar(c.empresa, m.empresa, m.abono);
    }
    if (c.tipo === 'EGRESO' && Array.isArray(c.reparto) && c.reparto.length >= 2) {
      const parte = m.cargo / c.reparto.length;
      c.reparto.forEach((e) => sumar(m.empresa, e, parte));
    }
  });
  return Object.keys(saldo).map((k) => {
    const [x, y] = k.split('|'), v = Math.round(saldo[k]);
    return v > 0 ? { debe: y, a: x, monto: v } : { debe: x, a: y, monto: -v };
  }).filter((d) => d.monto > 0).sort((a, b) => b.monto - a.monto);
}

function calcular_(db, periodo, empresa) {
  const todos = movimientos_();
  const periodos = [...new Set(todos.map((m) => m.periodo))].sort();
  if (!periodos.length) return { sin_datos: true, empresas: [], periodos: [] };
  const p = periodos.indexOf(periodo) !== -1 ? periodo : periodos[periodos.length - 1];
  const empresasConDatos = [...new Set(todos.map((m) => m.empresa).filter(Boolean))];
  const emp = empresasConDatos.indexOf(empresa) !== -1 ? empresa : '';
  // Cuentas propias (caja, fondos) y lo que le toca de cada movimiento (con gastos compartidos).
  const delAlcance = todos.filter((m) => !emp || m.empresa === emp);
  const conParte = todos.map((m) => ({ m, f: factor_(m, emp) })).filter((x) => x.f > 0);

  // Serie: hasta 12 meses que terminan en el elegido.
  const iFin = periodos.indexOf(p);
  const serieP = periodos.slice(Math.max(0, iFin - 11), iFin + 1);
  const serie = serieP.map((per) => { const o = vacio_(); conParte.filter((x) => x.m.periodo === per).forEach((x) => acumular_(o, x.m, x.f)); return Object.assign({ periodo: per }, o); });
  const mes = serie[serie.length - 1];
  const anterior = serie.length > 1 ? serie[serie.length - 2] : null;

  // Gastos e ingresos del mes por cuenta.
  const gastos = {}, ingresos = {};
  conParte.filter((x) => x.m.periodo === p && x.m.clasif).forEach((x) => {
    const m = x.m;
    const cta = m.clasif.cuenta + (m.clasif.reparto && emp ? ' (compartido)' : '');
    if (m.clasif.tipo === 'EGRESO') gastos[cta] = (gastos[cta] || 0) + Math.round(m.cargo * x.f);
    if (m.clasif.tipo === 'INGRESO') ingresos[cta] = (ingresos[cta] || 0) + Math.round(m.abono * x.f);
  });
  const ordenar = (o) => Object.keys(o).map((k) => ({ cuenta: k, monto: o[k] })).sort((a, b) => b.monto - a.monto);

  // Caja al cierre del mes: último saldo de cada cuenta con fecha <= fin del mes.
  const finMes = p + '-31';
  const ultimo = new Map();
  delAlcance.forEach((m) => { if (m.fecha <= finMes) ultimo.set(m.cuenta_ref, m); });
  const cuentas = [...ultimo.values()].map((m) => ({ banco: m.banco, ultimos4: m.ultimos4, empresa: m.empresa, saldo: m.saldo, al: m.fecha }));
  const caja = cuentas.reduce((s, c) => s + (Number(c.saldo) || 0), 0);

  // Fondos de clientes en custodia, acumulado al cierre del mes.
  const fondos = new Map();
  delAlcance.filter((m) => m.fecha <= finMes && m.clasif && (m.clasif.tipo === 'FONDO_RECIBIDO' || m.clasif.tipo === 'FONDO_PAGADO')).forEach((m) => {
    const f = fondos.get(m.clasif.cliente_id) || { cliente: m.clasif.cliente, saldo: 0 };
    f.saldo += m.clasif.tipo === 'FONDO_RECIBIDO' ? m.abono : -m.cargo;
    fondos.set(m.clasif.cliente_id, f);
  });
  const fondosLista = [...fondos.values()];
  const custodia = fondosLista.reduce((s, f) => s + f.saldo, 0);
  const negativos = fondosLista.filter((f) => f.saldo < 0).sort((a, b) => a.saldo - b.saldo);

  // Cobranza de hoy.
  let cob = { por_cobrar: 0, vencido: 0, mas_60: 0, saldo_a_favor: 0, top: [] };
  try {
    const lista = [...FC.cartera_(db, { empresa: emp }).values()];
    cob = {
      por_cobrar: lista.reduce((s, n) => s + n.por_cobrar, 0), vencido: lista.reduce((s, n) => s + n.vencido, 0),
      mas_60: lista.reduce((s, n) => s + n.tramos.d61_90 + n.tramos.d90, 0), saldo_a_favor: lista.reduce((s, n) => s + n.saldo_a_favor, 0),
      top: lista.filter((n) => n.vencido > 0).sort((a, b) => b.vencido - a.vencido).slice(0, 5).map((n) => ({ cliente: n.cliente, vencido: n.vencido, dias: n.dias_max }))
    };
  } catch (e) { /* sin facturas todavía */ }

  // Comparación entre empresas (siempre todas, para el gráfico).
  const porEmpresa = empresasConDatos.map((e) => ({
    empresa: e,
    serie: serieP.map((per) => { const o = vacio_(); todos.filter((m) => m.periodo === per).forEach((m) => acumular_(o, m, factor_(m, e))); return { periodo: per, resultado: o.resultado, ingresos: o.ingresos, egresos: o.egresos }; })
  }));

  // Obligaciones del mes siguiente, estimadas con lo pagado en el mes elegido.
  const sig = mesSiguiente_(p);
  const obligaciones = OBLIGACIONES.map((o) => ({
    nombre: o.nombre, fecha: sig + '-' + String(o.dia).padStart(2, '0'),
    estimado: conParte.filter((x) => x.m.periodo === p && x.m.clasif && x.m.clasif.tipo === 'EGRESO' && o.cuentas.indexOf(x.m.clasif.cuenta) !== -1).reduce((s, x) => s + Math.round(x.m.cargo * x.f), 0)
  }));
  const totalOblig = obligaciones.reduce((s, o) => s + o.estimado, 0);

  // Etapa 5 · Presupuesto de cada mes de la serie (grupo = suma de las empresas).
  let presupuesto = null;
  try { presupuesto = require('./finanzasPresupuesto').porMes_(serieP, emp); } catch (e) { presupuesto = null; }
  if (presupuesto) serie.forEach((s) => { const pm = presupuesto[s.periodo]; s.ppto_ingresos = pm ? pm.ingresos : null; s.ppto_egresos = pm ? pm.egresos : null; });

  // Etapa 5 · Cuántos meses cubre la caja: caja libre (sin la plata de clientes)
  // / gasto promedio de la empresa en los últimos 3 meses con gastos.
  const conGasto = serie.filter((s) => s.egresos > 0).slice(-3);
  const gastoPromedio = conGasto.length ? Math.round(conGasto.reduce((a, s) => a + s.egresos, 0) / conGasto.length) : 0;
  const cajaLibre = caja - Math.max(custodia, 0);
  const mesesCaja = gastoPromedio ? Math.round(cajaLibre / gastoPromedio * 10) / 10 : null;

  // Etapa 5 · Entre empresas: préstamos + la parte de los gastos compartidos que pagó otra.
  const interco = deudasEntreEmpresas_(todos.filter((m) => m.fecha <= finMes));

  return {
    periodo: p, periodos: periodos.slice().reverse(), empresa: emp, empresas: empresasConDatos, anterior: anterior ? anterior.periodo : '',
    mes, mes_anterior: anterior, serie, gastos: ordenar(gastos), ingresos: ordenar(ingresos),
    caja, cuentas, custodia, fondos_negativos: negativos.slice(0, 5), clientes_con_fondos: fondosLista.length,
    cobranza: cob, por_empresa: porEmpresa, obligaciones, total_obligaciones: totalOblig,
    presupuesto_cargado: !!(presupuesto && Object.keys(presupuesto).length),
    caja_libre: cajaLibre, gasto_promedio: gastoPromedio, meses_caja: mesesCaja,
    entre_empresas: emp ? interco.filter((d) => d.debe === emp || d.a === emp) : interco,
    calidad: { total: mes.total, pendientes: mes.pendientes, pendiente_monto: mes.pendiente_monto, completo: mes.pendientes === 0 }
  };
}

// Negativos como "−$1.234" (no "$-1.234").
function plata_(n) {
  const v = Math.round(n || 0);
  return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL');
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function nombreMes_(p) { const [a, m] = p.split('-').map(Number); return MESES[m - 1] + ' ' + a; }

/** Lectura automática: lo malo primero. Cada frase con su tono (critico/alerta/ok/info). */
function lectura_(t) {
  const L = [];
  if (!t.calidad.completo) L.push({ tono: 'alerta', texto: 'Cifras provisorias: faltan ' + t.calidad.pendientes + ' de ' + t.calidad.total + ' movimientos por revisar (' + plata_(t.calidad.pendiente_monto) + '). El resultado puede cambiar.' });
  if (t.cobranza.mas_60 > 0) L.push({ tono: 'critico', texto: plata_(t.cobranza.mas_60) + ' de la cartera llevan más de 60 días vencidos' + (t.cobranza.top.length ? '; lo más grande: ' + t.cobranza.top.slice(0, 3).map((c) => c.cliente + ' (' + plata_(c.vencido) + ')').join(', ') : '') + '.' });
  if (t.fondos_negativos.length) {
    L.push({ tono: 'critico', texto: t.fondos_negativos.length + ' cliente(s) con fondos en negativo: según lo registrado, se pagó por ellos más de lo que mandaron (' +
      t.fondos_negativos.slice(0, 3).map((f) => f.cliente + ' ' + plata_(f.saldo)).join(', ') + '). Revisa si falta un fondo que mandaron antes del primer mes cargado; si no, hay que cobrárselo.' });
  }
  const r = t.mes.resultado;
  if (t.mes_anterior) {
    const dif = r - t.mes_anterior.resultado;
    L.push({ tono: r < 0 ? 'critico' : dif >= 0 ? 'ok' : 'alerta', texto: 'El resultado de ' + nombreMes_(t.periodo) + ' fue ' + plata_(r) + ', ' + (dif >= 0 ? plata_(dif) + ' mejor' : plata_(-dif) + ' peor') + ' que ' + nombreMes_(t.anterior) + '.' });
  } else {
    L.push({ tono: r < 0 ? 'critico' : 'info', texto: 'El resultado de ' + nombreMes_(t.periodo) + ' fue ' + plata_(r) + ' (ingresos ' + plata_(t.mes.ingresos) + ' menos gastos ' + plata_(t.mes.egresos) + ').' });
  }
  // Presupuesto del mes (si está cargado).
  const pm = t.serie[t.serie.length - 1];
  if (pm && pm.ppto_ingresos) {
    const pi = Math.round(t.mes.ingresos / pm.ppto_ingresos * 100);
    L.push({ tono: pi >= 100 ? 'ok' : pi >= 90 ? 'alerta' : 'critico', texto: 'Los ingresos llegaron al ' + pi + ' % de lo presupuestado (' + plata_(t.mes.ingresos) + ' de ' + plata_(pm.ppto_ingresos) + ').' });
  }
  if (pm && pm.ppto_egresos) {
    const pg = Math.round(t.mes.egresos / pm.ppto_egresos * 100);
    if (pg > 100) L.push({ tono: pg > 110 ? 'critico' : 'alerta', texto: 'Los gastos superaron el presupuesto: ' + pg + ' % (' + plata_(t.mes.egresos - pm.ppto_egresos) + ' por sobre lo previsto).' });
  }
  if (t.meses_caja !== null && t.meses_caja !== undefined) {
    // Con el mes sin revisar completo, los gastos están incompletos: la cifra es provisoria, nunca "verde".
    const prov = !t.calidad.completo;
    L.push({ tono: t.meses_caja < 2 ? 'critico' : (t.meses_caja < 4 || prov) ? 'alerta' : 'ok', texto: 'La caja libre (sin la plata de clientes) cubre ' + String(t.meses_caja).replace('.', ',') + ' meses de gastos al ritmo de los últimos meses (' + plata_(t.gasto_promedio) + ' al mes)' + (prov ? '. Provisorio: faltan gastos por revisar, así que en realidad cubre menos.' : '.') });
  }
  if (t.entre_empresas && t.entre_empresas.length) {
    L.push({ tono: 'info', texto: 'Entre empresas: ' + t.entre_empresas.slice(0, 3).map((d) => d.debe + ' le debe ' + plata_(d.monto) + ' a ' + d.a).join(' · ') + '.' });
  }
  if (!t.total_obligaciones) {
    L.push({ tono: 'alerta', texto: 'No hay pagos de sueldos, imposiciones ni IVA de la empresa confirmados en ' + nombreMes_(t.periodo) + ': no se puede estimar si la caja alcanza para el mes que viene.' });
  } else {
    const alcanza = t.caja >= t.total_obligaciones;
    L.push({ tono: alcanza ? 'ok' : 'critico', texto: 'La caja (' + plata_(t.caja) + (alcanza ? ') alcanza' : ') NO alcanza') + ' para sueldos, imposiciones e IVA del mes que viene (≈ ' + plata_(t.total_obligaciones) + ', estimado con lo pagado este mes).' });
  }
  if (t.custodia > 0) L.push({ tono: 'info', texto: 'Hay ' + plata_(t.custodia) + ' de clientes en custodia: es plata de ellos para sus imposiciones e IVA, no se puede gastar.' });
  else if (t.custodia < 0) L.push({ tono: 'alerta', texto: 'En total, lo pagado por cuenta de clientes supera en ' + plata_(-t.custodia) + ' lo que mandaron. Suele faltar la plata que llegó antes del primer mes cargado.' });
  if (t.cobranza.saldo_a_favor > 0) L.push({ tono: 'info', texto: plata_(t.cobranza.saldo_a_favor) + ' pagados por clientes que todavía no tienen factura.' });
  return L;
}

const tablero = B.conBoveda('VER_TABLERO', function (db, data) {
  const periodo = /^\d{4}-\d{2}$/.test(String((data && data.periodo) || '')) ? data.periodo : '';
  const t = calcular_(db, periodo, String((data && data.empresa) || ''));
  if (t.sin_datos) return t;
  t.lectura = lectura_(t);
  return t;
});

/**
 * Informe mensual en PDF: el mismo HTML que se ve en pantalla, impreso por el
 * motor de reportes de SIGSO, con una marca de agua con el nombre de quien lo
 * descarga y la hora (si aparece donde no debe, se sabe de dónde salió).
 */
const informePdf = B.conBoveda('', function (db, data, contexto, x) {
  const html = String((data && data.html) || '');
  if (!html.trim()) return errorValidacion('html', 'No llegó el contenido del informe.');
  const ahora = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const marca = 'CONFIDENCIAL · ' + x.nombre + ' · ' + ahora;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const agua = '<div class="fin2-agua" aria-hidden="true">' + Array.from({ length: 14 }, () => '<span>' + esc(marca) + '</span>').join('') + '</div>';
  const css = String((data && data.css) || '') +
    '\n.fin2-agua{position:fixed;inset:-20% -20%;display:flex;flex-wrap:wrap;align-content:space-around;justify-content:space-around;gap:90px 60px;transform:rotate(-28deg);pointer-events:none;z-index:9999}' +
    '.fin2-agua span{font:600 15px Arial,sans-serif;color:rgba(28,92,171,.10);white-space:nowrap}';
  x.registrar('DESCARGAR_INFORME', String((data && data.titulo) || '').slice(0, 120));
  return require('./reportePdf').generarPdfReporte(db, Object.assign({}, data, { html: agua + html, css, titulo: String((data && data.titulo) || 'Informe financiero') }), contexto);
});

module.exports = { tablero, informePdf, calcular_, lectura_, deudasEntreEmpresas_, factor_, movimientos_, acumular_, vacio_ };
