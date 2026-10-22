'use strict';

/**
 * finanzasHoja.js — La planilla del banco (Finanzas v4, 22-10-2026).
 *
 * Una sola hoja por cuenta y mes que se llena como el Excel BANCOS (fecha, nombre, OBS, plan de
 * cuenta, monto ±, grupo y N° de factura) y de la que salen solos los reportes que el equipo usa:
 * el resumen de arriba (ABONO, ABONO RENTA, SALDO, PENDIENTE…), el FLUJO por plan de cuenta como
 * en SIGECO, el saldo de fondos por cliente y la cobranza.
 *
 * Reglas (las de la planilla):
 *   - Fila con GRUPO (la letra reemplaza la fórmula de UNITARIO): cuenta solo dentro de su grupo. Lo
 *     que sobra del grupo es honorario (ABONO / ABONO RENTA), queda a favor del cliente (SALDO) o
 *     sigue abierto (PENDIENTE), según lo que se elija para ese grupo.
 *   - Sin grupo: OBS ABONO entra = honorario; ABONO sale = gasto (con su plan de cuenta);
 *     ABONO RENTA = honorario de renta; IVA / IMPOSICIONES / SALDO / PENDIENTE = plata del cliente.
 *   - TOTAL = suma de todo = neto del banco del mes (control).
 * Cada fila es un movimiento de FIN_MOVIMIENTOS con su anotación (`datos.planilla`); lo que trae la
 * cartola sin anotar aparece en la hoja para completarlo. Anotar, corregir, unir con la cartola y
 * borrar usan finanzasRegistro.
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const F = require('./finanzasBancos');
const P = require('./finanzasPagadores');
const Lb = require('./finanzasLibro');
const R = require('./finanzasRegistro');
const { errorValidacion } = require('./errores');

const I = F.interno;
const txt_ = (v) => String(v == null ? '' : v).trim();
const N = (s) => I.normalizar_(s);
const PER_ = /^\d{4}-\d{2}$/;
const DECISIONES = ['PENDIENTE', 'ABONO', 'ABONO RENTA', 'SALDO'];

function asegurar_() { I.db_().exec('CREATE TABLE IF NOT EXISTS FIN_AJUSTES (clave TEXT PRIMARY KEY, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)'); }
function hoyMes_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7); }
function letras_(n) { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function piezas_(c) { return c && c.partes ? c.partes : c ? [c] : []; }
function cerrado_(periodo) { try { return require('./finanzasCierre').mesCerrado_(periodo); } catch (e) { return false; } }

/** Lo que se ve en la hoja de un movimiento confirmado que nadie anotó (clasificado a mano antes): sus columnas, deducidas. */
function deducir_(c) {
  if (!c || !c.tipo) return null;
  if (c.tipo === 'INGRESO') return { nombre: N(c.cliente || ''), obs: c.cuenta === 'Servicio Renta' ? 'ABONO RENTA' : 'ABONO', plan: c.cuenta || '' };
  if (c.tipo === 'EGRESO') return { nombre: N(c.cuenta || ''), obs: 'ABONO', plan: c.cuenta || '' };
  if (c.tipo === 'FONDO_RECIBIDO' || c.tipo === 'FONDO_PAGADO') return { nombre: N(c.cliente || ''), obs: c.cuenta === 'IVA' ? 'IVA' : c.cuenta === 'Imposiciones' ? 'IMPOSICIONES' : 'PENDIENTE', plan: c.cuenta || '' };
  if (c.tipo === 'TRASPASO' || c.tipo === 'PRESTAMO') return { nombre: N(c.empresa || ''), obs: '', plan: c.tipo === 'TRASPASO' ? 'Traspaso' : 'Préstamo' };
  return null;
}

/** Qué es una fila para los totales (sin mirar su grupo). */
function que_(f) {
  if (f.banco === 'falta') return { k: 'falta', t: 'Falta anotar' };
  // La OBS anotada manda (como en el Excel): una fila con empresa del grupo y OBS ABONO suma en ABONO.
  if (/^(TRASPASO|PRESTAMO)$/.test(N(f.plan)) || (!f.obs && (f.tipo_mov === 'TRASPASO' || f.tipo_mov === 'PRESTAMO'))) return { k: 'tra', t: /PRESTAMO/.test(N(f.plan)) || f.tipo_mov === 'PRESTAMO' ? 'Préstamo' : 'Traspaso' };
  if (!f.obs) return { k: 'rev', t: 'Falta OBS' };
  // Como en el Excel, la OBS manda: una fila con OBS cuenta aunque le falte el nombre o el plan (se avisa).
  if (f.obs === 'ABONO' || f.obs === 'ABONO RENTA') {
    if (f.monto > 0) return { k: 'ing', t: (f.obs === 'ABONO RENTA' ? 'Honorario renta' : 'Honorario') + (f.nombre ? '' : ' · sin nombre') };
    return { k: 'gas', t: f.plan ? 'Gasto' : 'Gasto · sin plan' };
  }
  return { k: 'fon', t: 'Fondos cliente' + (f.nombre ? '' : ' · sin nombre') };
}

function contexto_(db) { return { alias: P.aliasMapa_(), clientes: I.clientes_(db), cuentas: I.cuentasMapa_() }; }
function cuentaElegida_(ctx, ref) {
  const l = [...ctx.cuentas.values()].sort((a, b) => (a.empresa + a.banco).localeCompare(b.empresa + b.banco));
  return ctx.cuentas.get(txt_(ref)) || l[0] || null;
}

/**
 * Fecha con la que un movimiento va en la planilla: la de la transacción, no la contable del banco. El BCI contabiliza al
 * día hábil siguiente (lo del 30 de junio sale en la cartola el 1 de julio) y la planilla BANCOS va por la fecha en que
 * pasó. Manda, en orden: el mes elegido a mano en la hoja, la fecha anotada en la planilla, la del registro antes de
 * unirse con la cartola y la fecha de transacción de «Mis Movimientos»; si no hay ninguna, la del banco.
 */
function fechaHoja_(r, m) {
  const p = m.planilla || {};
  const f = p.fecha || (m.unida && m.unida.fecha_anotada) || (m.detalle && m.detalle.fecha_tx) || r.fecha;
  return { fecha: m.mes_hoja && m.mes_hoja !== String(f).slice(0, 7) ? (m.mes_hoja < String(f).slice(0, 7) ? ultimoDia_(m.mes_hoja) : m.mes_hoja + '-01') : f, movida: !!m.mes_hoja };
}
function ultimoDia_(p) { const [a, mm] = p.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10); }
function ventana_(periodo) { return [Base.sumarDias_(periodo + '-01', -20), Base.sumarDias_(ultimoDia_(periodo), 20)]; }

/** La hoja de una cuenta en un mes: filas, grupos, totales y cuadre con la cartola. */
function construir_(db, cuenta, periodo, ctx) {
  asegurar_();
  const d = I.db_();
  const filas = [];
  const [desde, hasta] = ventana_(periodo);
  const todos = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE cuenta_ref = ? AND (periodo = ? OR fecha BETWEEN ? AND ?) ORDER BY fecha, orden').all(cuenta.id, periodo, desde, hasta)
    .map((r) => { const m = I.des_(r.datos); return { r, m, h: fechaHoja_(r, m) }; });
  // Lo que la cartola de este mes trae (para el cuadre con el banco), aunque alguna fila se vea en otro mes.
  const delBanco = todos.filter((x) => x.r.periodo === periodo && !x.m.sin_cartola);
  const movs = todos.filter((x) => x.h.fecha.slice(0, 7) === periodo)
    .sort((a, b) => a.h.fecha.localeCompare(b.h.fecha) || a.r.fecha.localeCompare(b.r.fecha) || (a.r.orden || 0) - (b.r.orden || 0));
  movs.forEach((x) => {
    const r = x.r, m = x.m;
    const c = r.estado === 'CONFIRMADO' ? m.clasif : null;
    const p0 = piezas_(c)[0] || null;
    const p = m.planilla || null;
    const ded = !p ? deducir_(p0) : null;
    const f = {
      id: r.id, version: r.version || 0, fecha: x.h.fecha, fecha_banco: x.h.fecha !== r.fecha && !m.sin_cartola ? r.fecha : '', movida: x.h.movida, monto: (m.abono || 0) - (m.cargo || 0),
      nombre: p ? (p.alias || '') : ded ? ded.nombre : '', obs: p ? (p.obs || '') : ded ? ded.obs : '', plan: p ? (p.plan || '') : ded ? ded.plan : '',
      fact: p ? (p.fact || '') : '', nota: p ? (p.nota || '') : '', grupo: p ? (p.grupo_letra || '') : '',
      glosa: m.sin_cartola ? (p && p.glosa) || '' : m.glosa || '', quien_banco: (m.detalle && m.detalle.pagador) || '',
      banco: m.sin_cartola ? 'esperando' : (p || r.estado === 'CONFIRMADO') ? 'ok' : 'falta', anotada: !!p, deducida: !!ded,
      tipo_mov: p0 ? p0.tipo : '', en_gestion: piezas_(c).some((x) => x.gestion_id), partes: piezas_(c).length,
      cliente_id: p0 && p0.cliente_id ? p0.cliente_id : '', cliente: p0 && p0.cliente ? p0.cliente : '',
      saldo_banco: m.saldo, verificado: !m.sin_cartola, _grupo_viejo: p && p.grupo ? p.grupo : null,
      // Fila que vino del Excel BANCOS: su UNITARIO (lo que la planilla sumaba en el resumen de arriba).
      con_fecha_tx: !!((m.detalle && m.detalle.fecha_tx) || (p && p.fecha) || m.unida),
      de_excel: !!(p && !p.registro && p.fila && p.fila < 100000), unitario: p && typeof p.unitario === 'number' && isFinite(p.unitario) ? p.unitario : null
    };
    if (!f.cliente_id && f.nombre) {
      const q = Lb.interno.resolverAlias_(f.nombre, f.glosa, ctx);
      if (q && q.clase === 'cliente') { f.cliente_id = q.cliente_id; f.cliente = q.cliente; }
    }
    filas.push(f);
  });
  // Grupos que vienen del Excel BANCOS (la fórmula de UNITARIO): se les da una letra que no esté usada.
  const usadas = new Set(filas.map((f) => f.grupo).filter(Boolean));
  const viejos = [...new Set(filas.filter((f) => !f.grupo && f._grupo_viejo).map((f) => f._grupo_viejo.cierre))].sort((a, b) => a - b);
  const letraDe = new Map(); let k = 0;
  // Si una fila del grupo ya se editó en la hoja, su letra vale para todo el grupo.
  filas.forEach((f) => { if (f.grupo && f._grupo_viejo && !letraDe.has(f._grupo_viejo.cierre)) letraDe.set(f._grupo_viejo.cierre, f.grupo); });
  viejos.forEach((cierre) => { if (letraDe.has(cierre)) return; let l; do { l = letras_(k++); } while (usadas.has(l)); letraDe.set(cierre, l); usadas.add(l); });
  const obsCierre = new Map(), excelDe = new Map();
  filas.forEach((f) => {
    if (f._grupo_viejo) {
      const l = f.grupo || letraDe.get(f._grupo_viejo.cierre);
      // Lo que el Excel dice que sobró (su fórmula de UNITARIO) y si el grupo tenía filas de otro mes.
      // También cuenta como de otro mes si alguna fila del grupo no está en el banco de este mes (el banco la puso otro día).
      const presentes = filas.filter((y) => y._grupo_viejo && y._grupo_viejo.cierre === f._grupo_viejo.cierre).length;
      const faltan = Array.isArray(f._grupo_viejo.miembros) && presentes < f._grupo_viejo.miembros.length;
      if (!excelDe.has(l)) excelDe.set(l, { remanente: f._grupo_viejo.remanente, incompleto: !!f._grupo_viejo.incompleto || faltan });
    }
    if (!f.grupo && f._grupo_viejo) { f.grupo = letraDe.get(f._grupo_viejo.cierre); f.grupo_excel = true; obsCierre.set(f.grupo, f._grupo_viejo.obs || ''); }
    delete f._grupo_viejo;
    f.que = que_(f);
  });
  // Decisiones de los grupos (lo que pasa con lo que sobra).
  const dec = {};
  d.prepare('SELECT clave, datos FROM FIN_AJUSTES WHERE clave LIKE ?').all('hoja-grupo|' + cuenta.id + '|' + periodo + '|%').forEach((x) => { dec[x.clave.split('|')[3]] = I.des_(x.datos).decision; });
  const gmap = new Map();
  filas.forEach((f) => {
    if (!f.grupo) return;
    const g = gmap.get(f.grupo) || { letra: f.grupo, filas: 0, entra: 0, sale: 0, suma: 0, clientes: {}, ids: [] };
    g.filas++; g.suma += f.monto; if (f.monto > 0) g.entra += f.monto; else g.sale -= f.monto; g.ids.push(f.id);
    const nom = f.cliente || f.nombre; if (nom) g.clientes[nom] = (g.clientes[nom] || 0) + 1;
    gmap.set(f.grupo, g);
  });
  const grupos = [...gmap.values()].sort((a, b) => a.letra.localeCompare(b.letra)).map((g) => {
    const o = obsCierre.get(g.letra);
    const porDefecto = o === 'ABONO' || o === 'ABONO RENTA' || o === 'SALDO' ? o : 'PENDIENTE';
    const cliente = Object.keys(g.clientes).sort((a, b) => g.clientes[b] - g.clientes[a])[0] || '';
    const fila = filas.find((f) => f.grupo === g.letra && (f.cliente || f.nombre) === cliente) || {};
    const ex = excelDe.get(g.letra) || null;
    return { letra: g.letra, filas: g.filas, entra: g.entra, sale: g.sale, suma: g.suma, cliente, cliente_id: fila.cliente_id || '', decision: dec[g.letra] || porDefecto, excel: !dec[g.letra] && !!o,
      // Grupo del Excel con filas de otro mes (o una fórmula rota): lo que la planilla decía que sobraba, para comparar.
      otro_mes: !!(ex && ex.incompleto), remanente_excel: ex && typeof ex.remanente === 'number' && isFinite(ex.remanente) ? ex.remanente : null };
  });
  // Totales como el resumen de arriba del Excel: ABONO y ABONO RENTA son netos (lo que entra menos los gastos con esa
  // OBS, como el SUMIF de la planilla); HONORARIOS y GASTOS muestran de qué está hecho ese neto.
  const t = { ABONO: 0, 'ABONO RENTA': 0, HONORARIOS: 0, GASTOS: 0, FONDOS: 0, SALDO: 0, PENDIENTE: 0, OTRO_MES: 0, TRASPASOS: 0, SIN_COMPLETAR: 0, TOTAL: 0 };
  filas.forEach((f) => {
    t.TOTAL += f.monto;
    if (f.grupo) return;
    const q = f.que.k;
    if (q === 'ing' || q === 'gas') { t[f.obs] += f.monto; if (q === 'ing') t.HONORARIOS += f.monto; else t.GASTOS += f.monto; }
    else if (q === 'fon') {
      // SALDO y PENDIENTE sin grupo van a su línea, como en el Excel; IVA e IMPOSICIONES quedan como fondos del cliente.
      // Una fila del Excel cuenta por su UNITARIO: sin UNITARIO es parte de un grupo que cierra en otro mes.
      const k = f.obs === 'SALDO' || f.obs === 'PENDIENTE' ? f.obs : 'FONDOS';
      const v = f.de_excel ? (f.unitario === null ? 0 : f.unitario) : f.monto;
      t[k] += v; t.OTRO_MES += f.monto - v;
    } else if (q === 'tra') t.TRASPASOS += f.monto; else t.SIN_COMPLETAR += f.monto;
  });
  grupos.forEach((g) => {
    // Un grupo del Excel con filas de otro mes: vale lo que la planilla dice que sobró; lo demás son filas de un grupo
    // que empezó (o termina) en otro mes, y va aparte para que el TOTAL siga cuadrando con el banco.
    const v = valorGrupo_(g);
    t.OTRO_MES += g.suma - v;
    // Como el SUMIF del Excel: lo que sobra (o falta) de un grupo cerrado con ABONO suma en ABONO, aunque sea negativo.
    if (g.decision === 'ABONO' || g.decision === 'ABONO RENTA') { t[g.decision] += v; t.HONORARIOS += v; }
    else if (g.decision === 'SALDO') t.SALDO += v;
    else t.PENDIENTE += v;
  });
  // Saldo acumulado del mes (la columna SALDO del Excel) y cuadre con la cartola.
  let acc = 0; filas.forEach((f) => { acc += f.monto; f.saldo = acc; });
  const cartola = cuadreBanco_(delBanco, periodo);
  const estado = { ok: 0, esperando: 0, falta: 0, por_completar: 0 };
  filas.forEach((f) => { if (f.banco === 'ok') estado.ok++; else if (f.banco === 'esperando') estado.esperando++; else estado.falta++; if (f.que.k === 'rev') estado.por_completar++; });
  filas.forEach((f) => { delete f.saldo_banco; });
  return { filas, grupos, totales: t, cartola, estado };
}

/**
 * Cuadre con la cartola del mes (por fecha contable, como la trae el banco): saldo inicial, movimientos y saldo final,
 * y la cadena de saldos fila a fila. Si un saldo no sigue del anterior, hay movimientos repetidos o faltantes.
 * También cuenta lo del banco de este mes que se ve en otro mes de la planilla (y lo de otros meses que se ve en este).
 */
function cuadreBanco_(delBanco, periodo) {
  const conSaldo = delBanco.filter((x) => x.m.saldo !== null && x.m.saldo !== undefined && x.m.saldo !== '');
  if (!conSaldo.length) return null;
  const monto = (x) => (x.m.abono || 0) - (x.m.cargo || 0);
  const ini = conSaldo[0].m.saldo - monto(conSaldo[0]), fin = conSaldo[conSaldo.length - 1].m.saldo;
  const movimientos = delBanco.reduce((s, x) => s + monto(x), 0);
  let previo = ini; const cortes = [];
  conSaldo.forEach((x) => { if (previo + monto(x) !== x.m.saldo) cortes.push({ id: x.r.id, fecha: x.r.fecha, monto: monto(x) }); previo = x.m.saldo; });
  // Movimientos con la misma fecha, monto y glosa más de una vez: candidatos a repetidos (se avisan, no se borran).
  const vistos = new Map();
  delBanco.forEach((x) => { const k = [x.r.fecha, monto(x), N(x.m.glosa || '')].join('|'); vistos.set(k, (vistos.get(k) || 0) + 1); });
  const repetidos = [...vistos.entries()].filter((e) => e[1] > 1).map((e) => { const [fecha, mto, glosa] = e[0].split('|'); return { fecha, monto: Number(mto), glosa, veces: e[1] }; });
  const fuera = delBanco.filter((x) => x.h.fecha.slice(0, 7) !== periodo);
  return { saldo_inicial: ini, saldo_final: fin, movimientos, filas: delBanco.length, cuadra: ini + movimientos === fin, cortes: cortes.slice(0, 20), n_cortes: cortes.length,
    repetidos: repetidos.slice(0, 20), en_otro_mes: { filas: fuera.length, monto: fuera.reduce((s, x) => s + monto(x), 0) } };
}

/** Lo que sobra de un grupo: la suma de sus filas, o lo que dice el Excel si el grupo tiene filas de otro mes. */
function valorGrupo_(g) { return g.otro_mes ? (g.remanente_excel !== null ? g.remanente_excel : 0) : g.suma; }

/** Plan de cuenta para el FLUJO de una fila (o de lo que sobró de un grupo). */
function planFlujo_(f) {
  if (f.que.k === 'ing') return Lb.interno.cuentaIngreso_({ plan: f.plan, obs: f.obs });
  if (f.que.k === 'gas') return Lb.cuentaGasto_({ plan: f.plan });
  return '';
}

// ---------------------------------------------------------------- acciones

/** La hoja del mes de una cuenta. data: { periodo, cuenta_ref } */
const hoja = B.conBoveda('', function (db, data) {
  const ctx = contexto_(db);
  const cuenta = cuentaElegida_(ctx, data && data.cuenta_ref);
  const meses = I.db_().prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS ORDER BY periodo').all().map((x) => x.periodo);
  const periodo = PER_.test(txt_(data && data.periodo)) ? data.periodo : (meses[meses.length - 1] || hoyMes_());
  [hoyMes_(), periodo].forEach((p) => { if (meses.indexOf(p) === -1) meses.push(p); });
  meses.sort();
  const nombres = new Map();
  P.aliasMapa_().forEach((a) => { if (a.destino && a.destino.clase !== 'ignorar') nombres.set(N(a.alias), { n: N(a.alias), quien: a.destino.cliente || a.destino.empresa || a.destino.cuenta || '' }); });
  ctx.clientes.forEach((c) => { if (!nombres.has(c.n)) nombres.set(c.n, { n: c.n, quien: c.rut || '' }); });
  // Lo último que se anotó con cada nombre (OBS y plan): la hoja lo propone al escribir el nombre otra vez.
  const memoria = {};
  I.db_().prepare('SELECT fecha, datos FROM FIN_MOVIMIENTOS WHERE fecha >= ? ORDER BY fecha, orden').all(Base.sumarDias_(periodo + '-01', -120)).forEach((r) => {
    const m0 = I.des_(r.datos), p = m0.planilla; if (!p || !p.alias || !p.obs) return;
    const monto = (m0.abono || 0) - (m0.cargo || 0);
    const k = N(p.alias), x = memoria[k] || { veces: 0 };
    // plan_gasto: el último plan con que se anotó un GASTO de ese nombre (para sugerirlo; el plan de sus fondos no sirve).
    const gasto = monto < 0 && /^ABONO/.test(p.obs) && p.plan;
    memoria[k] = { obs: p.obs, plan: p.plan || x.plan || '', plan_gasto: gasto ? p.plan : x.plan_gasto || '', signo: monto < 0 ? -1 : 1, veces: x.veces + 1, fecha: r.fecha };
  });
  const listas = { memoria, obs: R.OBS, planes_ingreso: F.cuentasDe_('INGRESO'), planes_egreso: F.cuentasDe_('EGRESO'), planes_fondos: F.cuentasDe_('FONDO_RECIBIDO'), nombres: [...nombres.values()].sort((a, b) => a.n.localeCompare(b.n, 'es')), decisiones: DECISIONES };
  const cuentas = [...ctx.cuentas.values()].map((c) => ({ id: c.id, nombre: c.banco + ' ···' + c.ultimos4, empresa: c.empresa }));
  if (!cuenta) return { periodo, meses, cuentas, cuenta_ref: '', filas: [], grupos: [], totales: null, cartola: null, estado: { ok: 0, esperando: 0, falta: 0, por_completar: 0 }, listas, cerrado: false };
  const h = construir_(db, cuenta, periodo, ctx);
  return Object.assign({ periodo, meses, cuentas, cuenta_ref: cuenta.id, empresa: cuenta.empresa, listas, cerrado: cerrado_(periodo) }, h);
});

/**
 * Guarda lo escrito en una fila (una celda o varias). Sin id = fila nueva (necesita fecha y monto).
 * data: { cuenta_ref, id, expected_version, campos: { fecha, nombre, obs, plan, monto, grupo, fact, glosa, nota } }
 */
const guardar = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto) {
  const c = (data && data.campos) || {};
  const ctx = contexto_(db);
  const id = txt_(data && data.id);
  const nueva = (base) => ({ fecha: c.fecha !== undefined ? c.fecha : base.fecha, monto: c.monto !== undefined ? c.monto : base.monto, alias: c.nombre !== undefined ? c.nombre : base.nombre,
    obs: c.obs !== undefined ? c.obs : base.obs, plan: c.plan !== undefined ? c.plan : base.plan, grupo: c.grupo !== undefined ? c.grupo : base.grupo, fact: c.fact !== undefined ? c.fact : base.fact,
    glosa: c.glosa !== undefined ? c.glosa : base.glosa, nota: c.nota !== undefined ? c.nota : base.nota });
  if (!id) {
    const cuenta = cuentaElegida_(ctx, data && data.cuenta_ref);
    if (!cuenta) return errorValidacion('cuenta_ref', 'Primero sube una cartola para crear la cuenta del banco.');
    const r = R.registrar(db, Object.assign({}, data, { cuenta_ref: cuenta.id, filas: [nueva({ fecha: '', monto: '', nombre: '', obs: '', plan: '', grupo: '', fact: '', glosa: '', nota: '' })] }), contexto);
    if (r._validationError || r._forbidden) return r;
    const v0 = I.db_().prepare('SELECT version FROM FIN_MOVIMIENTOS WHERE id = ?').get(r.filas[0].id);
    return { id: r.filas[0].id, nueva: true, en_banco: r.filas[0].en_banco, version: v0 ? v0.version || 0 : 0 };
  }
  const d = I.db_();
  const row = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ?').get(id);
  if (!row) return errorValidacion('id', 'Esa fila ya no existe: recarga la hoja.');
  if (data.expected_version !== undefined && Number(data.expected_version) !== Number(row.version || 0)) return Base.errConflicto('Otra persona cambió esta fila mientras la editabas (' + (row.actualizado_por || '') + '). Se recargó la hoja.');
  const m = I.des_(row.datos);
  const cuenta = ctx.cuentas.get(row.cuenta_ref);
  const actual = construir_(db, cuenta, row.periodo, ctx).filas.find((f) => f.id === id);
  const v = nueva(actual);
  // Todo se valida antes de tocar nada: sacar la fila de su grupo o reabrir su clasificación no se deshace si
  // después la anotación no se puede guardar (mes cerrado, OBS o monto que no sirven).
  if (cerrado_(row.periodo)) return errorValidacion('id', 'El mes ' + row.periodo + ' está cerrado. Reábrelo en «Cierre» para corregir.');
  const prueba = R.leerFila_({ fecha: m.sin_cartola && v.fecha ? v.fecha : row.fecha, monto: m.sin_cartola && v.monto !== '' && v.monto !== undefined ? v.monto : actual.monto,
    alias: v.alias, obs: v.obs, plan: v.plan, grupo: v.grupo, fact: v.fact, glosa: v.glosa, nota: v.nota });
  if (prueba.error) return errorValidacion('fila', prueba.error);
  if (cerrado_(prueba.fecha.slice(0, 7))) return errorValidacion('fecha', 'El mes ' + prueba.fecha.slice(0, 7) + ' está cerrado.');
  // Cambiar qué es una fila que estaba en un grupo de fondos del Excel: sale primero de esa gestión.
  const cambiaQue = N(v.alias) !== N(actual.nombre) || v.obs !== actual.obs || N(v.plan) !== N(actual.plan) || (c.monto !== undefined && Number(F.monto_(String(c.monto))) !== actual.monto) || (c.grupo !== undefined && N(c.grupo) !== N(actual.grupo));
  if (cambiaQue && actual.en_gestion) {
    const s = Lb.sacarDeGrupo(db, Object.assign({}, data, { ids: [id] }), contexto);
    if (s._validationError || s._forbidden) return s;
  }
  const versionAhora = () => d.prepare('SELECT version FROM FIN_MOVIMIENTOS WHERE id = ?').get(id).version || 0;
  if (m.planilla) {
    // El grupo del Excel pasa a ser la letra que se ve en la hoja (así no se pierde al editar).
    const r = R.editar(db, Object.assign({}, data, { id, expected_version: versionAhora(), alias: v.alias, obs: v.obs, plan: v.plan, glosa: v.glosa, nota: v.nota, grupo: v.grupo, fact: v.fact,
      fecha: m.sin_cartola ? v.fecha : undefined, monto: m.sin_cartola ? v.monto : undefined }), contexto);
    if (r._validationError || r._forbidden) return r;
    return { id, reclasificada: r.reclasificada, version: versionAhora() };
  }
  // Fila del banco sin anotar (o clasificada a mano antes): se anota; si estaba confirmada y cambia qué es, se vuelve a clasificar.
  if (row.estado === 'CONFIRMADO' && cambiaQue && !(m.clasif && m.clasif.conciliado)) {
    m.clasif = null;
    d.prepare("UPDATE FIN_MOVIMIENTOS SET estado = 'PENDIENTE', datos = ?, version = COALESCE(version, 0) + 1 WHERE id = ?").run(I.cif_(m), id);
  }
  const r = R.registrar(db, Object.assign({}, data, { cuenta_ref: row.cuenta_ref, filas: [Object.assign(nueva(actual), { fecha: row.fecha, monto: actual.monto, mov_id: id })] }), contexto);
  if (r._validationError || r._forbidden) return r;
  return { id, anotada: true, version: versionAhora() };
});

/** Borra una fila (si espera la cartola) o lo anotado (si ya está en el banco). data: { id, expected_version } */
const borrar = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto) {
  const d = I.db_();
  const row = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ?').get(txt_(data && data.id));
  if (!row) return errorValidacion('id', 'Esa fila ya no existe: recarga la hoja.');
  const m = I.des_(row.datos);
  // Lo que impide borrar se revisa antes de sacar la fila de su grupo (eso no se deshace).
  if (!m.planilla) return errorValidacion('id', 'Esta fila viene del banco y no tiene nada anotado.');
  if (data.expected_version !== undefined && Number(data.expected_version) !== Number(row.version || 0)) return Base.errConflicto('Otra persona cambió esta fila mientras la editabas (' + (row.actualizado_por || '') + '). Se recargó la hoja.');
  if (cerrado_(row.periodo)) return errorValidacion('id', 'El mes ' + row.periodo + ' está cerrado.');
  if (m.clasif && m.clasif.conciliado) return errorValidacion('id', 'Está vinculada con operaciones registradas: deshaz el vínculo primero.');
  if (piezas_(m.clasif).some((x) => x.gestion_id)) {
    const s = Lb.sacarDeGrupo(db, Object.assign({}, data, { ids: [row.id] }), contexto);
    if (s._validationError || s._forbidden) return s;
  }
  const v = d.prepare('SELECT version FROM FIN_MOVIMIENTOS WHERE id = ?').get(row.id).version || 0;
  return R.eliminar(db, Object.assign({}, data, { id: row.id, expected_version: v }), contexto);
});

/**
 * Pasa filas del banco a la planilla de otro mes (el mes anterior o el siguiente al de su fecha), sin tocar la cartola:
 * lo del 30 de junio que el BCI contabilizó el 1 de julio se ve en junio, como en la planilla BANCOS.
 * data: { ids: [...], periodo: 'AAAA-MM' (vacío = volver a su mes) }
 */
const moverMes = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  const ids = (Array.isArray(data && data.ids) ? data.ids : []).map(txt_).filter(Boolean).slice(0, 500);
  if (!ids.length) return errorValidacion('ids', 'Elige las filas que se mueven.');
  const destino = txt_(data.periodo);
  if (destino && !PER_.test(destino)) return errorValidacion('periodo', 'Indica el mes (AAAA-MM).');
  const d = I.db_();
  const mesDe = (iso, n) => { const [a, m] = iso.slice(0, 7).split('-').map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); };
  const cambios = [];
  for (const id of ids) {
    const r = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ?').get(id);
    if (!r) return errorValidacion('ids', 'Una de las filas ya no existe: recarga la hoja.');
    const m = I.des_(r.datos);
    const antes = fechaHoja_(r, m).fecha.slice(0, 7);
    const sinMover = fechaHoja_(r, Object.assign({}, m, { mes_hoja: null })).fecha.slice(0, 7);
    if (destino && [mesDe(sinMover, -1), sinMover, mesDe(sinMover, 1)].indexOf(destino) === -1) return errorValidacion('periodo', 'Una fila del ' + r.fecha.split('-').reverse().join('-') + ' solo puede ir al mes anterior o al siguiente.');
    if (cerrado_(antes) || (destino && cerrado_(destino))) return errorValidacion('periodo', 'El mes ' + (cerrado_(antes) ? antes : destino) + ' está cerrado.');
    cambios.push({ r, m, valor: destino && destino !== sinMover ? destino : null });
  }
  d.exec('BEGIN');
  try {
    cambios.forEach((c) => {
      if (c.valor) c.m.mes_hoja = c.valor; else delete c.m.mes_hoja;
      d.prepare('UPDATE FIN_MOVIMIENTOS SET datos = ?, version = COALESCE(version, 0) + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(I.cif_(c.m), new Date().toISOString(), x.nombre, c.r.id);
    });
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  x.registrar('HOJA_MOVER_MES', cambios.length + ' fila(s) → ' + (destino || 'su mes'));
  return { movidas: cambios.length, periodo: destino };
});

/** Qué pasa con lo que sobra de un grupo. data: { cuenta_ref, periodo, letra, decision } */
const decidirGrupo = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  asegurar_();
  const ctx = contexto_(db);
  const cuenta = ctx.cuentas.get(txt_(data && data.cuenta_ref));
  if (!cuenta) return errorValidacion('cuenta_ref', 'Elige la cuenta.');
  const periodo = txt_(data.periodo);
  if (!PER_.test(periodo)) return errorValidacion('periodo', 'Indica el mes.');
  const letra = txt_(data.letra).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  const decision = txt_(data.decision).toUpperCase();
  if (!letra) return errorValidacion('letra', 'Falta el grupo.');
  if (DECISIONES.indexOf(decision) === -1) return errorValidacion('decision', 'Elige: ' + DECISIONES.join(', ') + '.');
  if (cerrado_(periodo)) return errorValidacion('periodo', 'El mes ' + periodo + ' está cerrado.');
  I.db_().prepare('INSERT INTO FIN_AJUSTES (clave, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
    .run('hoja-grupo|' + cuenta.id + '|' + periodo + '|' + letra, I.cif_({ decision }), new Date().toISOString(), x.nombre);
  x.registrar('HOJA_GRUPO', periodo + ' · grupo ' + letra + ' → ' + decision);
  return { letra, decision };
});

/**
 * FLUJO por plan de cuenta, mes a mes (como las hojas FLUJO de SIGECO), de una empresa o del grupo.
 * data: { hasta 'AAAA-MM', meses (1..12), empresa }
 */
const flujo = B.conBoveda('', function (db, data) {
  const ctx = contexto_(db);
  const hasta = PER_.test(txt_(data && data.hasta)) ? data.hasta : hoyMes_();
  const n = Math.min(12, Math.max(1, Number(data && data.meses) || 6));
  const meses = [];
  for (let i = n - 1; i >= 0; i--) { const [a, m] = hasta.split('-').map(Number); meses.push(new Date(Date.UTC(a, m - 1 - i, 1)).toISOString().slice(0, 7)); }
  const empresa = txt_(data && data.empresa);
  const cuentas = [...ctx.cuentas.values()].filter((c) => !empresa || c.empresa === empresa);
  const ing = {}, egr = {}, fon = { recibido: {}, pagado: {}, honorario: {}, a_favor: {} }, otros = { traspasos: {}, sin_completar: {} };
  F.cuentasDe_('INGRESO').forEach((p) => { ing[p] = {}; });
  F.cuentasDe_('EGRESO').forEach((p) => { egr[p] = {}; });
  const sumar = (o, k, mes, v) => { (o[k] = o[k] || {}); o[k][mes] = (o[k][mes] || 0) + v; };
  const resumen = {};
  meses.forEach((mes) => {
    resumen[mes] = { neto: 0, por_completar: 0, falta: 0, esperando: 0 };
    cuentas.forEach((cu) => {
      const h = construir_(db, cu, mes, ctx);
      resumen[mes].neto += h.totales.TOTAL; resumen[mes].por_completar += h.estado.por_completar; resumen[mes].falta += h.estado.falta; resumen[mes].esperando += h.estado.esperando;
      h.filas.forEach((f) => {
        if (f.grupo) { sumar(fon, f.monto > 0 ? 'recibido' : 'pagado', mes, Math.abs(f.monto)); return; }
        const k = f.que.k;
        if (k === 'ing') sumar(ing, planFlujo_(f), mes, f.monto);
        else if (k === 'gas') sumar(egr, planFlujo_(f), mes, -f.monto);
        else if (k === 'fon') sumar(fon, f.monto > 0 ? 'recibido' : 'pagado', mes, Math.abs(f.monto));
        else if (k === 'tra') sumar(otros, 'traspasos', mes, f.monto);
        else sumar(otros, 'sin_completar', mes, f.monto);
      });
      h.grupos.forEach((g) => {
        const v = valorGrupo_(g);
        if (g.decision === 'ABONO' || g.decision === 'ABONO RENTA') { sumar(ing, g.decision === 'ABONO RENTA' ? 'Servicio Renta' : 'Servicio Mensual', mes, v); sumar(fon, 'honorario', mes, v); }
        else if (g.decision === 'SALDO') sumar(fon, 'a_favor', mes, v);
      });
    });
  });
  const filas = (o) => Object.keys(o).map((k) => ({ plan: k, valores: o[k] }));
  return { meses, empresa, empresas: [...new Set([...ctx.cuentas.values()].map((c) => c.empresa))], ingresos: filas(ing), egresos: filas(egr), fondos: fon, otros, resumen };
});

/** Folios anotados en la columna N° factura: «1052», «1052-1053», «1052/1053», «1052 y 1053»… */
function folios_(fact) {
  // normalizar_ deja los separadores (guion, barra, coma) como espacios: cada palabra que no sea «Y» es un folio.
  return [...new Set(N(fact).split(/[^0-9A-Z]+/).filter((x) => x && x !== 'Y'))];
}

/**
 * Facturas con lo pagado según la hoja (columna N° factura) y lo aplicado en Cobranza.
 * Un folio es de la empresa de la cuenta donde entró el abono (el mismo folio en dos empresas son dos facturas); si la
 * empresa no calza pero el folio es de una sola factura, se usa esa (cobro por otra empresa del grupo). Un abono con
 * varios folios paga las facturas en el orden anotado, hasta lo que falta de cada una (descontadas sus notas de crédito).
 */
function facturas_(db, x) {
  let lista = [];
  try { require('./finanzasCobranza').cartera_(db).forEach((n) => n.facturas.forEach((f) => lista.push(Object.assign({}, f, { cliente: n.cliente, cliente_id: n.cliente_id })))); } catch (e) { lista = []; }
  if (x) x.registrar('VER_COBRANZA', '');
  const porClave = new Map(), porFolio = new Map();
  lista.forEach((f) => {
    porClave.set(f.empresa + '|' + N(f.folio), f);
    const l = porFolio.get(N(f.folio)) || []; l.push(f); porFolio.set(N(f.folio), l);
  });
  const buscar = (empresa, folio) => porClave.get(empresa + '|' + folio) || ((porFolio.get(folio) || []).length === 1 ? porFolio.get(folio)[0] : null);
  const cuentas = I.cuentasMapa_();
  const enHoja = new Map();
  I.db_().prepare('SELECT cuenta_ref, datos FROM FIN_MOVIMIENTOS ORDER BY fecha, orden').all().forEach((r) => {
    const m = I.des_(r.datos); const fa = m.planilla && m.planilla.fact;
    if (!fa || !((m.abono || 0) > 0)) return;
    const empresa = (cuentas.get(r.cuenta_ref) || {}).empresa || '';
    const fs = folios_(fa).map((fo) => buscar(empresa, fo)).filter(Boolean);
    let resto = m.abono;
    fs.forEach((f, i) => {
      const ya = enHoja.get(f) || 0;
      const v = i === fs.length - 1 ? resto : Math.min(resto, Math.max(0, f.total - (f.creditos || 0) - ya));
      enHoja.set(f, ya + v); resto -= v;
    });
  });
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  return lista.map((f) => {
    const pagado = Math.min(f.total, Math.max(f.aplicado_confirmado || 0, enHoja.get(f) || 0));
    const saldo = f.estado === 'INCOBRABLE' ? f.total : Math.max(0, f.total - pagado - (f.creditos || 0));
    const estado = f.estado === 'INCOBRABLE' ? 'Incobrable' : saldo === 0 ? 'Pagada' : pagado > 0 ? 'Parcial' : f.vence && f.vence < hoy ? 'Vencida' : 'Pendiente';
    return { folio: f.folio, cliente: f.cliente, cliente_id: f.cliente_id, empresa: f.empresa, fecha: f.fecha, vence: f.vence, total: f.total, pagado, saldo, estado };
  });
}

/**
 * Saldo por cliente hasta un mes: honorarios del mes, fondos recibidos y pagados por él, lo que se le cobró
 * de lo que sobró y su saldo de fondos (acumulado desde el primer mes con datos), más lo que debe en facturas.
 * data: { periodo }
 */
const clientes = B.conBoveda('', function (db, data, contexto, x) {
  const ctx = contexto_(db);
  const periodo = PER_.test(txt_(data && data.periodo)) ? data.periodo : hoyMes_();
  const meses = I.db_().prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS WHERE periodo <= ? ORDER BY periodo').all(periodo).map((x) => x.periodo);
  const c = new Map();
  const cli = (f) => { const k = f.cliente_id || 'n:' + N(f.cliente || f.nombre); let x = c.get(k); if (!x) { x = { cliente_id: f.cliente_id || '', cliente: f.cliente || f.nombre, sin_ficha: !f.cliente_id, honorarios_mes: 0, honorarios: 0, recibido: 0, pagado: 0, cobrado: 0, a_favor: 0, deuda: 0, facturas: 0 }; c.set(k, x); } return x; };
  meses.forEach((mes) => {
    ctx.cuentas.forEach((cu) => {
      const h = construir_(db, cu, mes, ctx);
      h.filas.forEach((f) => {
        if (!f.nombre && !f.cliente) return;
        const k = f.que.k;
        if (f.grupo || k === 'fon') { const x = cli(f); if (f.monto > 0) x.recibido += f.monto; else x.pagado -= f.monto; return; }
        if (k === 'ing') { const x = cli(f); x.honorarios += f.monto; if (mes === periodo) x.honorarios_mes += f.monto; }
      });
      h.grupos.forEach((g) => {
        if (!g.cliente) return;
        const x = cli({ cliente_id: g.cliente_id, cliente: g.cliente, nombre: g.cliente });
        const v = valorGrupo_(g);
        if (g.decision === 'ABONO' || g.decision === 'ABONO RENTA') { x.cobrado += v; x.honorarios += v; if (mes === periodo) x.honorarios_mes += v; }
        if (g.decision === 'SALDO') x.a_favor += v;
      });
    });
  });
  facturas_(db, x).forEach((f) => { if (f.saldo > 0 && f.estado !== 'Incobrable') { const x = cli({ cliente_id: f.cliente_id, cliente: f.cliente, nombre: f.cliente }); x.deuda += f.saldo; x.facturas++; } });
  const lista = [...c.values()].map((x) => Object.assign(x, { saldo: x.recibido - x.pagado - x.cobrado }))
    .filter((x) => x.saldo || x.honorarios_mes || x.deuda || x.recibido)
    .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo) || b.deuda - a.deuda);
  return { periodo, desde: meses[0] || periodo, clientes: lista };
});

/** Cobranza: las facturas con su estado según la hoja. data: { estado: 'abiertas'|'todas' } */
const cobranza = B.conBoveda('', function (db, data, contexto, x) {
  const l = facturas_(db, x);
  const T = { facturado: 0, pagado: 0, por_cobrar: 0, vencido: 0 };
  l.forEach((f) => { if (f.estado === 'Incobrable') return; T.facturado += f.total; T.pagado += f.pagado; T.por_cobrar += f.saldo; if (f.estado === 'Vencida') T.vencido += f.saldo; });
  const ver = txt_(data && data.estado) === 'todas' ? l : l.filter((f) => f.saldo > 0);
  ver.sort((a, b) => (a.estado === 'Vencida' ? 0 : 1) - (b.estado === 'Vencida' ? 0 : 1) || String(a.vence).localeCompare(String(b.vence)));
  return { totales: T, facturas: ver, total_facturas: l.length };
});

module.exports = { hoja, guardar, borrar, decidirGrupo, moverMes, flujo, clientes, cobranza, construir_, contexto_, que_, folios_, fechaHoja_, planFlujo_, valorGrupo_, facturas_, DECISIONES };
