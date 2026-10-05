'use strict';

/**
 * agendaDepto.js — la AGENDA de cada departamento (2026-10-04): fechas clave,
 * recordatorios a clientes y su registro.
 *
 *  - Obligaciones (DEP_OBLIGACIONES): qué vence, cuándo (regla), la escalera
 *    de recordatorios (escalones, en días hábiles desde la fecha límite) con
 *    su canal y su mensaje, y qué pasa si no se recuerda o el cliente no
 *    responde. Parten de agendaPropuesta.js y las editan las jefaturas o el
 *    superusuario (con historial en CI_HISTORIAL).
 *  - A quién recordar sale de las matrices («fuentes»): IVA por pagar, cuotas
 *    de convenio, asistencia sin recibir, Previred, facturas por cobrar… Un
 *    cliente sale de la lista cuando la matriz lo da por cumplido o cuando se
 *    registra su respuesta «Ya cumplió» / «No corresponde».
 *  - Registro (DEP_RECORDATORIOS): cada envío (canal, mensaje, quién, cuándo)
 *    y cada respuesta. SIGSO no envía nada (decisión del dueño, costo cero):
 *    prepara el mensaje; WhatsApp se abre con el texto listo y el correo se
 *    copia y sale desde el correo corporativo del área.
 *  - «Hoy»: lo que toca enviar hoy, lo atrasado y lo que quedó sin respuesta.
 *    Calendario: el mes con vencimientos, escalones, feriados y fechas propias.
 *  - Alertas (alertasDiarias, 8:00): a cada persona, cuántos recordatorios
 *    tiene hoy; a la jefatura, los escalones que no se enviaron y los clientes
 *    que no respondieron.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { DEPARTAMENTOS, periodoRemuneracion_ } = require('./controlInternoMatrices');
const CI = require('./controlInterno');
const Cumplimiento = require('./cumplimiento');
const NotificacionesApp = require('./notificacionesApp');
const { PROPUESTA, FUENTES, CANALES } = require('./agendaPropuesta');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const RESPUESTAS = { CONFIRMO: 'Confirmó', CUMPLIO: 'Ya cumplió', PIDIO_PLAZO: 'Pidió plazo', NO_CONTESTA: 'No contesta', NO_CORRESPONDE: 'No corresponde' };
const CIERRAN = ['CUMPLIO', 'NO_CORRESPONDE'];
const DIAS_SIN_RESPUESTA = 7; // cuántos días se muestra un cliente que no respondió tras el último escalón
const ORDEN_ESTADO = { ATRASADO: 0, HOY: 1, SIN_RESPUESTA: 2, EN_SEGUIMIENTO: 3 };

// --- utilidades ---------------------------------------------------------------------------------
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function ahora_() { return new Date().toISOString(); }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
/** El día en Chile de una marca de tiempo ISO (de noche, en UTC ya es el día siguiente). */
function diaChile_(iso) { const d = new Date(iso); return isNaN(d) ? String(iso || '').slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(d); }
function leer_(db, t) { try { return leerFilas_(db, t, COLUMNAS[t]); } catch (e) { return []; } }
function json_(v, d) { if (v && typeof v === 'object') return v; try { return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v == null ? '' : v).replace(/[$\s]/g, '');
  if (/^-?\d+(\.\d+)?E[+-]?\d+$/i.test(s)) return Number(s);
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  const n = Number(s.replace(',', '.'));
  return isFinite(n) ? n : 0;
}
function esFecha_(v) { return /^\d{4}-\d{2}-\d{2}/.test(String(v || '')); }
function pesos_(n) { return '$' + Math.round(n || 0).toLocaleString('es-CL'); }
function periodoTexto_(p) { const m = /^(\d{4})-M(\d{2})$/.exec(p || ''); return m ? MESES[Number(m[2]) - 1] + ' de ' + m[1] : String(p || ''); }
function fechaLarga_(f) { const d = new Date(f + 'T12:00:00Z'); return DIAS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' de ' + MESES[d.getUTCMonth()]; }
function periodoDe_(f) { return f.slice(0, 4) + '-M' + f.slice(5, 7); }
function iso_(d) { return d.toISOString().slice(0, 10); }
function dia_(f) { return new Date(f + 'T12:00:00Z'); }

// --- calendario hábil ----------------------------------------------------------------------------
function feriados_(db) { try { return new Set(Cumplimiento.obtenerFeriados(db).map((f) => String(f).slice(0, 10))); } catch (e) { return new Set(); } }
function esHabil_(f, fer) { const d = dia_(f).getUTCDay(); return d !== 0 && d !== 6 && !fer.has(f); }
function mover_(f, dias) { return iso_(new Date(dia_(f).getTime() + dias * 864e5)); }
/** n días hábiles desde f (negativo = hacia atrás). Si f no es hábil, se parte del hábil anterior (n ≤ 0) o siguiente. */
function sumarHabiles_(f, n, fer) {
  let d = f;
  if (!esHabil_(d, fer)) { const paso = n > 0 ? 1 : -1; while (!esHabil_(d, fer)) d = mover_(d, paso); if (n > 0) n--; else if (n < 0) n++; }
  const paso = n >= 0 ? 1 : -1;
  let k = Math.abs(n);
  while (k > 0) { d = mover_(d, paso); if (esHabil_(d, fer)) k--; }
  return d;
}
function habilesEntre_(a, b, fer) {
  if (a === b) return 0;
  const signo = a < b ? 1 : -1;
  let d = a, n = 0;
  while (d !== b) { d = mover_(d, signo); if (esHabil_(d, fer)) n += signo; }
  return n;
}
function ultimoDia_(a, m) { return iso_(new Date(Date.UTC(a, m, 0))); }
/** Fecha límite de una obligación para un período 'AAAA-MNN' (mensual) o un año (anual). */
function fechaLimite_(regla, periodo, fer) {
  const r = regla || {};
  let a = Number(periodo.slice(0, 4)), m = Number(periodo.slice(6));
  if (r.tipo === 'anual') m = Number(r.mes) || 1;
  else { m += Number(r.mes) || 0; while (m > 12) { m -= 12; a++; } }
  let f;
  if (r.dia === 'ultimo') {
    f = ultimoDia_(a, m);
    if (r.habil !== false) while (!esHabil_(f, fer)) f = mover_(f, -1);
    return f;
  }
  const dia = Math.min(Number(r.dia) || 1, Number(ultimoDia_(a, m).slice(8)));
  f = a + '-' + String(m).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
  if (r.habil !== false) while (!esHabil_(f, fer)) f = mover_(f, 1);
  return f;
}

// --- obligaciones -----------------------------------------------------------------------------------
const listas_ = new WeakSet();
/**
 * Carga la propuesta inicial de las obligaciones que falten (por clave). Nunca pisa lo editado:
 * si una obligación sigue tal como la dejó la propuesta (nadie la editó) y la propuesta cambió
 * —por ejemplo, las fechas que dictó RR.HH. el 2026-10-05—, se actualiza sola.
 */
function asegurarPropuesta_(db) {
  if (listas_.has(db)) return;
  const filas = leer_(db, 'DEP_OBLIGACIONES');
  const ya = new Set(filas.map((o) => o.clave));
  const CAMPOS = ['nombre', 'descripcion', 'tipo', 'fuente', 'regla', 'escalones', 'sin_recordatorio', 'sin_respuesta', 'proceso', 'orden'];
  filas.filter((o) => o.origen === 'PROPUESTA' && !String(o.actualizado_por || '').trim()).forEach((o) => {
    const p = PROPUESTA.find((x) => x.clave === o.clave);
    if (!p) return;
    const nueva = filaDe_(p);
    if (CAMPOS.every((k) => String(o[k] == null ? '' : o[k]) === String(nueva[k] == null ? '' : nueva[k]))) return;
    actualizarFilaPorId_(db, 'DEP_OBLIGACIONES', 'obligacion_id', o.obligacion_id, nueva);
  });
  PROPUESTA.forEach((p) => {
    if (ya.has(p.clave)) return;
    agregarFila_(db, 'DEP_OBLIGACIONES', Object.assign(filaDe_(p), { obligacion_id: crypto.randomUUID(), origen: 'PROPUESTA', creado_por: 'sistema', fecha_creacion: ahora_(), actualizado_por: '', fecha_actualizacion: '', activa: true }));
  });
  listas_.add(db);
}
function filaDe_(p) {
  return { clave: p.clave, depto: p.depto, nombre: p.nombre, descripcion: p.descripcion || '', tipo: p.tipo, fuente: p.fuente, regla: JSON.stringify(p.regla || {}),
    escalones: JSON.stringify(p.escalones || []), sin_recordatorio: p.sin_recordatorio || '', sin_respuesta: p.sin_respuesta || '', proceso: p.proceso || '', orden: p.orden || 99 };
}
function obligaciones_(db, depto, todas) {
  asegurarPropuesta_(db);
  return leer_(db, 'DEP_OBLIGACIONES').filter((o) => (!depto || o.depto === depto) && (todas || esVerdadero_(o.activa)))
    .map((o) => Object.assign({}, o, { regla: json_(o.regla, {}), escalones: json_(o.escalones, []), activa: esVerdadero_(o.activa) }))
    .sort((a, b) => (Number(a.orden) || 99) - (Number(b.orden) || 99));
}

// --- clientes y contacto -------------------------------------------------------------------------------
function telefono_(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 9 && d[0] === '9') d = '56' + d;
  else if (d.length === 8) d = '569' + d;
  return d.length === 11 && d.startsWith('569') ? d : (d.length >= 10 ? d : '');
}
function catalogo_(db) {
  const m = {};
  leer_(db, 'CAT_CLIENTES').forEach((c) => { m[c.cliente_id] = c; });
  return m;
}
function contactoDe_(cat, item) {
  const c = (item.cliente_id && cat[item.cliente_id]) || null;
  const nombre = c && String(c.contacto || '').trim() ? String(c.contacto).trim().split(/\s+/)[0] : '';
  return { contacto: nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase() : 'equipo de ' + (item.cliente_nombre || 'la empresa'),
    telefono: c ? telefono_(c.telefono) : '', correo: c ? String(c.correo || '').trim() : '' };
}

// --- fuentes: a quién recordar ------------------------------------------------------------------------
// Cada fuente devuelve [{ clave, cliente_id, cliente_nombre, vars, fecha_limite?, periodo? }] PENDIENTES
// (lo que la matriz ya da por cumplido no se devuelve).
function filasMes_(db, matriz, p) { try { return CI.rango_(db, matriz, p, p); } catch (e) { return []; } }
/** Filas de Remuneraciones cuyo MES DE LA REMUNERACIÓN es p (llegan en p o en p+1). */
function remuneracionesDe_(db, p) {
  let filas = [];
  try { filas = CI.rango_(db, 'REMUNERACIONES', p, CI.moverPeriodo_(p, 1)); } catch (e) { return []; }
  return filas.filter((r) => periodoRemuneracion_(r) === p);
}
const FUENTE = {
  iva_por_pagar(db, p) {
    const porCli = {};
    filasMes_(db, 'IVA', p).forEach((r) => {
      const d = r.datos || {};
      const monto = num_(d.monto_pago);
      if (r.estado === 'NO_APLICA' || monto <= 0) return;
      if (esFecha_(d.fecha_pago) || /PAGAD|DECLARAD|GIRAD/i.test(String(d.estado_pago || ''))) return;
      const k = r.cliente_id || 'N:' + r.cliente_nombre;
      porCli[k] = { clave: k, cliente_id: r.cliente_id, cliente_nombre: r.cliente_nombre, vars: { monto: pesos_(monto) } };
    });
    return Object.values(porCli);
  },
  previred(db, p) {
    // Las imposiciones de los sueldos de p (vencen el 13 de p+1): por el mes de la remuneración.
    const porCli = {};
    remuneracionesDe_(db, p).forEach((r) => {
      const d = r.datos || {};
      if (r.estado === 'NO_APLICA') return;
      const k = r.cliente_id || 'N:' + r.cliente_nombre;
      porCli[k] = porCli[k] || { clave: k, cliente_id: r.cliente_id, cliente_nombre: r.cliente_nombre, monto: 0, pagado: false };
      porCli[k].monto += num_(d.valor_imposiciones);
      if (esFecha_(d.f_pago_imposiciones) || esFecha_(d.fecha_declaracion) || esFecha_(d.fecha_envio_imposiciones_planillas_declaradas)) porCli[k].pagado = true;
    });
    return Object.values(porCli).filter((x) => !x.pagado && x.monto > 0).map((x) => ({ clave: x.clave, cliente_id: x.cliente_id, cliente_nombre: x.cliente_nombre, vars: { monto: pesos_(x.monto) } }));
  },
  asistencia(db, p) {
    // Clientes con remuneraciones el mes anterior que todavía no envían la información de este mes
    // (por el mes de la remuneración: la de septiembre llega entre el 20 de septiembre y el 10 de octubre).
    const ant = remuneracionesDe_(db, CI.moverPeriodo_(p, -1)), act = remuneracionesDe_(db, p);
    const recibido = new Set(act.filter((r) => esFecha_((r.datos || {}).fecha_recepcion_informacion)).map((r) => r.cliente_id || 'N:' + r.cliente_nombre));
    const porCli = {};
    ant.forEach((r) => { const k = r.cliente_id || 'N:' + r.cliente_nombre; if (!recibido.has(k)) porCli[k] = { clave: k, cliente_id: r.cliente_id, cliente_nombre: r.cliente_nombre, vars: {} }; });
    return Object.values(porCli);
  },
  clientes_contabilidad(db, p) {
    // Clientes con contabilización en los últimos 3 meses antes del período.
    const porCli = {};
    [0, 1, 2].forEach((i) => filasMes_(db, 'CONTABILIZACION', CI.moverPeriodo_(p, -1 - i)).forEach((r) => { const k = r.cliente_id || 'N:' + r.cliente_nombre; porCli[k] = { clave: k, cliente_id: r.cliente_id, cliente_nombre: r.cliente_nombre, vars: {} }; }));
    return Object.values(porCli);
  },
  convenio_cuotas(db, desde, hasta) {
    const out = [];
    leer_(db, 'CI_CONVENIOS').filter((c) => esVerdadero_(c.activa)).forEach((c) => {
      json_(c.cuotas, []).forEach((q) => {
        if (!esFecha_(q.vencimiento) || q.vencimiento < desde || q.vencimiento > hasta) return;
        const pagada = q.revision === 'PAGADA' || (q.revision !== 'VENCIDA' && q.tgr === 'SI');
        if (pagada) return;
        out.push({ clave: c.convenio_id + ':' + q.n, cliente_id: c.cliente_id, cliente_nombre: c.cliente_nombre, fecha_limite: q.vencimiento, periodo: periodoDe_(q.vencimiento),
          vars: { monto: pesos_(q.monto), n_cuota: q.n } });
      });
    });
    return out;
  },
  cobranza_facturas(db, desde, hasta) {
    let filas = [];
    try { filas = CI.rango_(db, 'COBRANZA', '0001-M01', '9999-M12'); } catch (e) { /* */ }
    return filas.filter((r) => r.estado !== 'PAGADA' && r.estado !== 'ANULADA' && esFecha_((r.datos || {}).fecha_vencimiento))
      .filter((r) => r.datos.fecha_vencimiento.slice(0, 10) >= desde && r.datos.fecha_vencimiento.slice(0, 10) <= hasta)
      .map((r) => ({ clave: r.registro_id, cliente_id: r.cliente_id, cliente_nombre: r.cliente_nombre, fecha_limite: r.datos.fecha_vencimiento.slice(0, 10), periodo: r.periodo,
        vars: { monto: pesos_(Math.max(0, num_(r.datos.monto) - num_(r.datos.monto_pagado))), n_factura: r.datos.n_factura || '—' } }));
  },
  manual(db, desde, hasta, o) {
    return leer_(db, 'DEP_EVENTOS').filter((e) => esVerdadero_(e.activa) && e.obligacion_id === o.obligacion_id && e.fecha >= desde && e.fecha <= hasta)
      .map((e) => { const d = json_(e.datos, {}); return { clave: e.evento_id, cliente_id: e.cliente_id, cliente_nombre: e.cliente_nombre, fecha_limite: e.fecha, periodo: periodoDe_(e.fecha),
        vars: Object.assign({ hora: e.hora || '', trabajador: d.trabajador || '', lugar: d.lugar || '' }, d) }; });
  }
};
const ES_EVENTO = (o) => (o.regla || {}).tipo === 'evento';

/** Variables de los mensajes que no dependen del cliente. */
function variablesInternas_(db, o, periodo) {
  if (o.clave === 'RLE') {
    let n = 0;
    ['RLE_CONTRATOS', 'RLE_FINIQUITOS'].forEach((m) => { try { n += CI.rango_(db, m, CI.moverPeriodo_(periodo, -24), periodo).filter((r) => r.estado === 'PENDIENTE').length; } catch (e) { /* */ } });
    return { pendientes: n + (n === 1 ? ' pendiente' : ' pendientes') };
  }
  return {};
}
/** El mensaje con sus datos puestos ({firma} lo completa la pantalla con el nombre de quien envía). */
function mensaje_(esc, vars) {
  const r = (t) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== '' ? String(vars[k]) : (k === 'firma' ? '{firma}' : m)));
  return { asunto: r(esc.asunto), texto: r(esc.texto) };
}

// --- instancias de una obligación en un rango de fechas ------------------------------------------------
/**
 * Cada instancia = una obligación en un período: fecha límite, escalones con
 * su fecha, y sus ítems (clientes) pendientes. Se devuelven las que tienen
 * alguna fecha (límite o escalón) entre `desde` y `hasta`.
 */
function instancias_(db, o, desde, hasta, ctx) {
  const fer = ctx.fer, out = [];
  const conFechas = (periodo, limite) => ({ periodo, fecha_limite: limite, escalones: (o.escalones || []).map((e) => Object.assign({}, e, { fecha: sumarHabiles_(limite, Number(e.offset) || 0, fer) })) });
  const enRango = (ins) => [ins.fecha_limite].concat(ins.escalones.map((e) => e.fecha)).some((f) => f >= desde && f <= hasta);
  if (ES_EVENTO(o)) {
    // Los ítems traen su propia fecha: se buscan los que vencen dentro del rango ampliado por los escalones.
    const offs = (o.escalones || []).map((e) => Number(e.offset) || 0).concat([0]);
    const a = mover_(desde, -Math.max(0, Math.max(...offs)) * 2 - 4), b = mover_(hasta, Math.max(0, -Math.min(...offs)) * 2 + 4);
    const fuente = FUENTE[o.fuente];
    const items = fuente ? fuente(db, a, b, o) : [];
    const porFecha = {};
    items.forEach((it) => { (porFecha[it.fecha_limite] = porFecha[it.fecha_limite] || []).push(it); });
    Object.keys(porFecha).forEach((f) => { const ins = conFechas(periodoDe_(f), f); ins.items = porFecha[f]; if (enRango(ins)) out.push(ins); });
    return out;
  }
  // Mensuales y anuales: los períodos cuyas fechas pueden caer en el rango.
  const per = [];
  if ((o.regla || {}).tipo === 'anual') {
    for (let a = Number(desde.slice(0, 4)) - 1; a <= Number(hasta.slice(0, 4)) + 1; a++) per.push(a + '-M' + String(Number(o.regla.mes) || 1).padStart(2, '0'));
  } else {
    const mes = Number((o.regla || {}).mes) || 0;
    let p = CI.moverPeriodo_(periodoDe_(desde), -mes - 2);
    const fin = CI.moverPeriodo_(periodoDe_(hasta), -mes + 1);
    for (; p <= fin; p = CI.moverPeriodo_(p, 1)) per.push(p);
  }
  per.forEach((p) => {
    // Para anuales el "período" del mensaje es el año anterior (la Renta 2027 es del año 2026).
    const limite = fechaLimite_(o.regla, p, fer);
    const ins = conFechas(p, limite);
    if (!enRango(ins)) return;
    if (o.fuente === 'interno' || o.tipo === 'INTERNO') ins.items = [{ clave: 'interno', cliente_id: '', cliente_nombre: o.nombre, vars: variablesInternas_(db, o, p), interno: true }];
    else ins.items = (FUENTE[o.fuente] ? FUENTE[o.fuente](db, (o.regla || {}).tipo === 'anual' ? CI.moverPeriodo_(p, -1) : p, null, o) : []);
    out.push(ins);
  });
  return out;
}

/** Envíos y respuestas registrados, por obligación + período + ítem. */
function registro_(db, depto) {
  const m = {};
  leer_(db, 'DEP_RECORDATORIOS').filter((r) => esVerdadero_(r.activa) && (!depto || r.depto === depto)).forEach((r) => {
    const k = r.obligacion_id + '|' + r.periodo + '|' + r.item_clave;
    const x = m[k] = m[k] || { enviados: {}, respuestas: [], filas: [] };
    x.filas.push(r);
    if (r.escalon_id === 'RESPUESTA') x.respuestas.push(r); else x.enviados[r.escalon_id] = r;
  });
  Object.values(m).forEach((x) => { x.respuestas.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))); x.ultima = x.respuestas[x.respuestas.length - 1] || null; x.cerrado = !!(x.ultima && CIERRAN.includes(x.ultima.respuesta)); });
  return m;
}

// --- permisos ---------------------------------------------------------------------------------------------
function permisos_(db, contexto, depto) {
  const ac = CI.acceso_(db, contexto);
  const p = ac.deptos[depto] || {};
  const superU = !!(contexto && contexto.super_admin);
  const adm = (ac.deptos.ADMINISTRACION || {}).ve;
  return { ve: !!p.ve || !!adm || superU, registra: !!p.registra || superU, edita: ac.esAdmin || superU || p.rol === 'JEFATURA', email: ac.email, esAdmin: ac.esAdmin || superU };
}
function depto_(clave) { return DEPARTAMENTOS.find((d) => d.clave === clave) || null; }

// =========================================================================================
// HOY: lo que toca enviar hoy, lo atrasado y lo que quedó sin respuesta
// =========================================================================================
function calcularHoy_(db, depto, fecha) {
  const fer = feriados_(db), ctx = { fer }, cat = catalogo_(db), reg = registro_(db, depto);
  const obls = obligaciones_(db, depto);
  const desde = mover_(fecha, -DIAS_SIN_RESPUESTA - 10), hasta = mover_(fecha, 45);
  const grupos = [], proximos = [];
  let porEnviar = 0, atrasados = 0, sinRespuesta = 0, enviadosHoy = 0;
  let proximo = null;
  obls.forEach((o) => {
    instancias_(db, o, desde, hasta, ctx).forEach((ins) => {
      const filas = [];
      let cumplidos = 0, total = 0;
      const ultimoEsc = ins.escalones.reduce((a, e) => (!a || e.fecha > a.fecha ? e : a), null);
      ins.items.forEach((it) => {
        total++;
        const r = reg[o.obligacion_id + '|' + ins.periodo + '|' + it.clave] || { enviados: {}, respuestas: [], ultima: null, cerrado: false };
        if (r.cerrado) { cumplidos++; return; }
        Object.values(r.enviados).forEach((e) => { if (diaChile_(e.fecha) === fecha) enviadosHoy++; });
        // El escalón que corresponde: el último con fecha ≤ hoy, si todavía no se envía (los anteriores
        // que se saltaron ya no se piden: manda el mensaje más reciente de la escalera).
        const vencidos = ins.escalones.filter((e) => e.fecha <= fecha);
        const ultimoVencido = vencidos[vencidos.length - 1] || null;
        const pendiente = ultimoVencido && !r.enviados[ultimoVencido.id] ? ultimoVencido : null;
        const conRespuesta = r.ultima && !CIERRAN.includes(r.ultima.respuesta) ? r.ultima : null;
        const contesto = conRespuesta && conRespuesta.respuesta !== 'NO_CONTESTA';
        let estado = null;
        if (pendiente && pendiente.fecha === fecha) estado = 'HOY';
        else if (pendiente && ultimoEsc && fecha <= mover_(ultimoEsc.fecha, DIAS_SIN_RESPUESTA)) estado = 'ATRASADO';
        else if (!pendiente && ultimoEsc && ultimoEsc.fecha < fecha && fecha <= mover_(ultimoEsc.fecha, DIAS_SIN_RESPUESTA) && !it.interno) estado = contesto ? 'EN_SEGUIMIENTO' : 'SIN_RESPUESTA';
        if (!estado) return;
        const esc = pendiente || ultimoEsc;
        const contacto = it.interno ? { contacto: '', telefono: '', correo: '' } : contactoDe_(cat, it);
        const vars = Object.assign({ empresa: it.cliente_nombre, periodo: periodoTexto_(ins.periodo), fecha_limite: fechaLarga_(ins.fecha_limite),
          dias: Math.max(0, habilesEntre_(fecha, ins.fecha_limite, fer)), contacto: contacto.contacto }, it.vars || {});
        if (estado === 'HOY') porEnviar++; else if (estado === 'ATRASADO') atrasados++; else if (estado === 'SIN_RESPUESTA') sinRespuesta++;
        filas.push({
          item_clave: it.clave, cliente_id: it.cliente_id || '', cliente_nombre: it.cliente_nombre, interno: !!it.interno, estado,
          escalon: { id: esc.id, nombre: esc.nombre, canal: esc.canal, a_quien: esc.a_quien, fecha: esc.fecha, offset: esc.offset },
          mensaje: mensaje_(esc, vars), vars: it.vars || {}, telefono: contacto.telefono, correo: contacto.correo,
          enviados: Object.values(r.enviados).map((e) => ({ escalon_id: e.escalon_id, canal: e.canal, fecha: e.fecha, usuario_email: e.usuario_email })),
          respuesta: conRespuesta ? { respuesta: conRespuesta.respuesta, texto: RESPUESTAS[conRespuesta.respuesta] || conRespuesta.respuesta, nota: conRespuesta.nota, fecha: conRespuesta.fecha } : null
        });
      });
      if (filas.length) grupos.push({ obligacion_id: o.obligacion_id, clave: o.clave, nombre: o.nombre, tipo: o.tipo, periodo: ins.periodo, periodo_texto: periodoTexto_(ins.periodo),
        fecha_limite: ins.fecha_limite, dias_habiles: habilesEntre_(fecha, ins.fecha_limite, fer), sin_respuesta: o.sin_respuesta, sin_recordatorio: o.sin_recordatorio, total, cumplidos,
        filas: filas.sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || String(a.cliente_nombre).localeCompare(String(b.cliente_nombre))) });
      // Próximos vencimientos (14 días) y el más cercano para la cuenta regresiva.
      if (ins.fecha_limite >= fecha && ins.fecha_limite <= mover_(fecha, 14)) {
        const pend = ins.items.filter((it) => !(reg[o.obligacion_id + '|' + ins.periodo + '|' + it.clave] || {}).cerrado).length;
        const x = { fecha: ins.fecha_limite, titulo: o.nombre, tipo: o.tipo, periodo_texto: periodoTexto_(ins.periodo), pendientes: pend, total: ins.items.length,
          dias_habiles: habilesEntre_(fecha, ins.fecha_limite, fer), obligacion_id: o.obligacion_id, es_limite: true };
        proximos.push(x);
        if (o.tipo === 'CLIENTE' && x.total && (!proximo || x.fecha < proximo.fecha || (x.fecha === proximo.fecha && x.total > proximo.total))) proximo = x;
      }
      ins.escalones.forEach((e) => {
        if (e.fecha > fecha && e.fecha <= mover_(fecha, 14) && e.fecha !== ins.fecha_limite) {
          const pend = ins.items.filter((it) => { const r = reg[o.obligacion_id + '|' + ins.periodo + '|' + it.clave]; return !(r && (r.cerrado || r.enviados[e.id])); }).length;
          if (pend) proximos.push({ fecha: e.fecha, titulo: e.nombre + ' · ' + o.nombre, tipo: e.canal === 'INTERNO' ? 'INTERNO' : 'RECORDATORIO', pendientes: pend, obligacion_id: o.obligacion_id, canal: e.canal, dias_habiles: habilesEntre_(fecha, e.fecha, fer) });
        }
      });
    });
  });
  // Fechas propias del área en los próximos 14 días.
  leer_(db, 'DEP_EVENTOS').filter((e) => esVerdadero_(e.activa) && e.depto === depto && !e.obligacion_id && e.fecha >= fecha && e.fecha <= mover_(fecha, 14))
    .forEach((e) => proximos.push({ fecha: e.fecha, titulo: e.titulo, tipo: 'EVENTO', hora: e.hora || '', dias_habiles: habilesEntre_(fecha, e.fecha, fer) }));
  proximos.sort((a, b) => a.fecha.localeCompare(b.fecha) || (b.es_limite ? 1 : 0) - (a.es_limite ? 1 : 0));
  return { fecha, fecha_texto: fechaLarga_(fecha), habil: esHabil_(fecha, fer), resumen: { por_enviar: porEnviar, atrasados, sin_respuesta: sinRespuesta, enviados_hoy: enviadosHoy },
    proximo, proximos: proximos.slice(0, 12), grupos };
}
function hoy(db, data, contexto) {
  const d = data || {};
  const dep = depto_(d.depto);
  if (!dep) return { ok: false, message: 'Elige un área.' };
  const pm = permisos_(db, contexto, dep.clave);
  if (!pm.ve) return { _forbidden: true, message: 'No tienes acceso a ' + dep.nombre + '.' };
  const fecha = esFecha_(d.fecha) ? String(d.fecha).slice(0, 10) : hoy_();
  return Object.assign(calcularHoy_(db, dep.clave, fecha), { depto: dep.clave, puede_registrar: pm.registra, puede_editar: pm.edita, respuestas: RESPUESTAS });
}

// =========================================================================================
// CALENDARIO del mes
// =========================================================================================
function calendarioDe_(db, depto, mes) {
  const fer = feriados_(db), ctx = { fer }, reg = registro_(db, depto);
  const a = Number(mes.slice(0, 4)), m = Number(mes.slice(6));
  const desde = a + '-' + String(m).padStart(2, '0') + '-01', hasta = ultimoDia_(a, m);
  const ev = [];
  obligaciones_(db, depto).forEach((o) => {
    instancias_(db, o, desde, hasta, ctx).forEach((ins) => {
      const pend = (escId) => ins.items.filter((it) => { const r = reg[o.obligacion_id + '|' + ins.periodo + '|' + it.clave]; return !(r && (r.cerrado || (escId && r.enviados[escId]))); }).length;
      // En una tarea interna de un solo paso la «fecha límite» es solo el ancla (fin de mes): se muestra la tarea.
      // Las fechas agregadas a mano (examen, pacto) ya se ven como cita del cliente.
      const limiteVisible = o.fuente !== 'manual' && (o.tipo !== 'INTERNO' || (o.escalones || []).length > 1);
      if (limiteVisible && ins.fecha_limite >= desde && ins.fecha_limite <= hasta) ev.push({ fecha: ins.fecha_limite, tipo: o.tipo === 'INTERNO' ? 'INTERNO' : 'LIMITE', titulo: (o.tipo === 'INTERNO' ? '' : 'Vence: ') + o.nombre,
        obligacion_id: o.obligacion_id, clave: o.clave, depto: o.depto, periodo_texto: periodoTexto_(ins.periodo), pendientes: pend(null), total: ins.items.length });
      ins.escalones.forEach((e) => {
        if (e.fecha < desde || e.fecha > hasta) return;
        // El aviso del mismo día del vencimiento ya está en el vencimiento: no se repite.
        if (limiteVisible && e.fecha === ins.fecha_limite) return;
        ev.push({ fecha: e.fecha, tipo: e.canal === 'INTERNO' ? 'INTERNO' : (Number(e.offset) > 0 ? 'ESCALAMIENTO' : 'RECORDATORIO'), titulo: e.nombre + ' · ' + o.nombre,
          canal: e.canal, obligacion_id: o.obligacion_id, clave: o.clave, depto: o.depto, escalon_id: e.id, pendientes: pend(e.id), total: ins.items.length, periodo_texto: periodoTexto_(ins.periodo) });
      });
    });
  });
  leer_(db, 'DEP_EVENTOS').filter((e) => esVerdadero_(e.activa) && e.depto === depto && !e.obligacion_id && e.fecha >= desde && e.fecha <= hasta)
    .forEach((e) => ev.push({ fecha: e.fecha, tipo: 'EVENTO', titulo: e.titulo, hora: e.hora || '', evento_id: e.evento_id, nota: e.nota || '', alcance: e.alcance, usuario_email: e.usuario_email }));
  // Los recordatorios con fecha manual (examen, pacto) también se ven como evento del cliente.
  leer_(db, 'DEP_EVENTOS').filter((e) => esVerdadero_(e.activa) && e.depto === depto && e.obligacion_id && e.fecha >= desde && e.fecha <= hasta)
    .forEach((e) => ev.push({ fecha: e.fecha, tipo: 'CLIENTE', titulo: e.titulo, hora: e.hora || '', evento_id: e.evento_id, cliente_nombre: e.cliente_nombre }));
  const feriados = [...fer].filter((f) => f >= desde && f <= hasta).map((f) => ({ fecha: f, tipo: 'FERIADO', titulo: 'Feriado' }));
  return ev.concat(feriados).sort((x, y) => x.fecha.localeCompare(y.fecha));
}
function calendario(db, data, contexto) {
  const d = data || {};
  const mes = CI.RE_PERIODO.test(String(d.mes || '')) ? d.mes : CI.periodoActual_();
  const deptos = d.depto ? [d.depto] : DEPARTAMENTOS.filter((x) => !x.recibe).map((x) => x.clave);
  const out = [];
  for (const k of deptos) {
    const dep = depto_(k);
    if (!dep) return { ok: false, message: 'Área no válida.' };
    const pm = permisos_(db, contexto, k);
    if (!pm.ve) { if (d.depto) return { _forbidden: true, message: 'No tienes acceso a ' + dep.nombre + '.' }; continue; }
    calendarioDe_(db, k, mes).forEach((e) => out.push(Object.assign({ depto: k, depto_nombre: dep.nombre }, e)));
  }
  // Feriados una sola vez cuando se juntan varias áreas.
  const vistos = new Set();
  const eventos = out.filter((e) => { if (e.tipo !== 'FERIADO') return true; if (vistos.has(e.fecha)) return false; vistos.add(e.fecha); return true; });
  return { mes, mes_texto: periodoTexto_(mes), hoy: hoy_(), eventos };
}

// =========================================================================================
// REGISTRO: enviar, deshacer, responder, eventos propios
// =========================================================================================
function obligacion_(db, id) { return obligaciones_(db, null, true).find((o) => o.obligacion_id === id) || null; }
function registrarEnvio(db, data, contexto) {
  const d = data || {};
  const o = obligacion_(db, d.obligacion_id);
  if (!o) return { ok: false, message: 'Esa obligación no existe.' };
  const pm = permisos_(db, contexto, o.depto);
  if (!pm.registra) return { _forbidden: true, message: 'Tienes acceso de solo lectura en esta área.' };
  const esc = (o.escalones || []).find((e) => e.id === d.escalon_id);
  if (!esc) return { ok: false, message: 'Ese recordatorio no existe.' };
  if (!CI.RE_PERIODO.test(String(d.periodo || '')) || !d.item_clave) return { ok: false, message: 'Faltan datos del recordatorio.' };
  const canal = CANALES.includes(d.canal) ? d.canal : esc.canal;
  const fila = { recordatorio_id: crypto.randomUUID(), depto: o.depto, obligacion_id: o.obligacion_id, periodo: d.periodo, fecha_limite: esFecha_(d.fecha_limite) ? d.fecha_limite : '',
    item_clave: String(d.item_clave).slice(0, 120), cliente_id: String(d.cliente_id || '').slice(0, 60), cliente_nombre: String(d.cliente_nombre || '').slice(0, 200),
    escalon_id: esc.id, canal, destino: String(d.destino || '').slice(0, 200), mensaje: String(d.mensaje || '').slice(0, 4000), respuesta: '', nota: String(d.nota || '').slice(0, 500),
    usuario_email: pm.email, fecha: ahora_(), activa: true };
  agregarFila_(db, 'DEP_RECORDATORIOS', fila);
  // Una tarea interna o una llamada contestada se da por cumplida al registrarla.
  if (o.tipo === 'INTERNO' || d.cumplido) responder(db, { obligacion_id: o.obligacion_id, periodo: d.periodo, item_clave: d.item_clave, cliente_id: d.cliente_id, cliente_nombre: d.cliente_nombre, respuesta: 'CUMPLIO', nota: d.nota_cumplido || '' }, contexto);
  return { ok: true, recordatorio_id: fila.recordatorio_id, message: o.tipo === 'INTERNO' ? 'Marcado como hecho.' : 'Registrado: ' + esc.nombre + ' por ' + ({ WHATSAPP: 'WhatsApp', CORREO: 'correo', LLAMADA: 'llamada', INTERNO: 'tarea' })[canal] + '.' };
}
function deshacer(db, data, contexto) {
  const d = data || {};
  const r = leer_(db, 'DEP_RECORDATORIOS').find((x) => x.recordatorio_id === d.recordatorio_id && esVerdadero_(x.activa));
  if (!r) return { ok: false, message: 'Ese registro no existe.' };
  const pm = permisos_(db, contexto, r.depto);
  if (r.usuario_email !== pm.email && !pm.edita) return { _forbidden: true, message: 'Solo quien lo registró (o la jefatura) lo puede deshacer.' };
  actualizarFilaPorId_(db, 'DEP_RECORDATORIOS', 'recordatorio_id', r.recordatorio_id, { activa: false });
  return { ok: true, message: 'Deshecho.' };
}
function responder(db, data, contexto) {
  const d = data || {};
  const o = obligacion_(db, d.obligacion_id);
  if (!o) return { ok: false, message: 'Esa obligación no existe.' };
  const pm = permisos_(db, contexto, o.depto);
  if (!pm.registra) return { _forbidden: true, message: 'Tienes acceso de solo lectura en esta área.' };
  if (!RESPUESTAS[d.respuesta]) return { ok: false, message: 'Elige la respuesta del cliente.' };
  if (!CI.RE_PERIODO.test(String(d.periodo || '')) || !d.item_clave) return { ok: false, message: 'Faltan datos.' };
  agregarFila_(db, 'DEP_RECORDATORIOS', { recordatorio_id: crypto.randomUUID(), depto: o.depto, obligacion_id: o.obligacion_id, periodo: d.periodo, fecha_limite: '',
    item_clave: String(d.item_clave).slice(0, 120), cliente_id: String(d.cliente_id || '').slice(0, 60), cliente_nombre: String(d.cliente_nombre || '').slice(0, 200),
    escalon_id: 'RESPUESTA', canal: '', destino: '', mensaje: '', respuesta: d.respuesta, nota: String(d.nota || '').slice(0, 500), usuario_email: pm.email, fecha: ahora_(), activa: true });
  return { ok: true, message: 'Respuesta registrada: ' + RESPUESTAS[d.respuesta] + '.' };
}
/** Historial de recordatorios: por área, mes, obligación, cliente o respuesta. */
function listarRegistro(db, data, contexto) {
  const d = data || {};
  const dep = depto_(d.depto);
  if (!dep) return { ok: false, message: 'Elige un área.' };
  const pm = permisos_(db, contexto, dep.clave);
  if (!pm.ve) return { _forbidden: true, message: 'No tienes acceso a ' + dep.nombre + '.' };
  const obls = {};
  obligaciones_(db, dep.clave, true).forEach((o) => { obls[o.obligacion_id] = o; });
  const q = String(d.q || '').toLowerCase();
  const filas = leer_(db, 'DEP_RECORDATORIOS').filter((r) => esVerdadero_(r.activa) && r.depto === dep.clave)
    .filter((r) => !d.mes || diaChile_(r.fecha).slice(0, 7) === String(d.mes).slice(0, 4) + '-' + String(d.mes).slice(6))
    .filter((r) => !d.obligacion_id || r.obligacion_id === d.obligacion_id)
    .filter((r) => !d.cliente_id || r.cliente_id === d.cliente_id)
    .filter((r) => !q || String(r.cliente_nombre).toLowerCase().includes(q))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 500)
    .map((r) => { const o = obls[r.obligacion_id] || {}; const e = (o.escalones || []).find((x) => x.id === r.escalon_id);
      return { recordatorio_id: r.recordatorio_id, fecha: r.fecha, obligacion: o.nombre || '—', obligacion_id: r.obligacion_id, periodo_texto: periodoTexto_(r.periodo), cliente_id: r.cliente_id, cliente_nombre: r.cliente_nombre,
        tipo: r.escalon_id === 'RESPUESTA' ? 'RESPUESTA' : 'ENVIO', escalon: e ? e.nombre : r.escalon_id, canal: r.canal, destino: r.destino, mensaje: r.mensaje,
        respuesta: r.respuesta, respuesta_texto: RESPUESTAS[r.respuesta] || '', nota: r.nota, usuario_email: r.usuario_email }; });
  const envios = filas.filter((f) => f.tipo === 'ENVIO');
  return { filas, resumen: { envios: envios.length, whatsapp: envios.filter((f) => f.canal === 'WHATSAPP').length, correo: envios.filter((f) => f.canal === 'CORREO').length,
    llamada: envios.filter((f) => f.canal === 'LLAMADA').length, respuestas: filas.length - envios.length }, obligaciones: Object.values(obls).map((o) => ({ obligacion_id: o.obligacion_id, nombre: o.nombre })) };
}
/** Fechas propias (reuniones, cierres) o vencimientos manuales (examen, pacto de horas extra). */
function guardarEvento(db, data, contexto) {
  const d = data || {};
  const dep = depto_(d.depto);
  if (!dep) return { ok: false, message: 'Elige un área.' };
  const pm = permisos_(db, contexto, dep.clave);
  if (!pm.registra) return { _forbidden: true, message: 'Tienes acceso de solo lectura en esta área.' };
  if (!esFecha_(d.fecha)) return { ok: false, message: 'Elige la fecha.' };
  let o = null;
  if (d.obligacion_id) { o = obligacion_(db, d.obligacion_id); if (!o || o.depto !== dep.clave || o.fuente !== 'manual') return { ok: false, message: 'Esa obligación no se agrega a mano.' }; }
  const titulo = String(d.titulo || (o ? o.nombre + (d.cliente_nombre ? ' · ' + d.cliente_nombre : '') : '')).trim().slice(0, 160);
  if (!titulo) return { ok: false, message: 'Ponle un título.' };
  if (o && !d.cliente_nombre) return { ok: false, message: 'Elige el cliente.' };
  const alcance = d.alcance === 'PERSONAL' ? 'PERSONAL' : 'AREA';
  if (!o && alcance === 'AREA' && !pm.edita) return { ok: false, message: 'Las fechas para toda el área las agrega la jefatura; tú puedes agregar fechas personales.' };
  const datos = {};
  ['trabajador', 'lugar'].forEach((k) => { if (d[k]) datos[k] = String(d[k]).slice(0, 160); });
  const fila = { evento_id: crypto.randomUUID(), depto: dep.clave, obligacion_id: o ? o.obligacion_id : '', titulo, fecha: String(d.fecha).slice(0, 10), hora: /^\d{1,2}:\d{2}$/.test(String(d.hora || '')) ? d.hora : '',
    cliente_id: String(d.cliente_id || '').slice(0, 60), cliente_nombre: String(d.cliente_nombre || '').slice(0, 200), datos: JSON.stringify(datos), alcance: o ? 'AREA' : alcance,
    usuario_email: pm.email, nota: String(d.nota || '').slice(0, 500), creado_por: pm.email, fecha_creacion: ahora_(), activa: true };
  agregarFila_(db, 'DEP_EVENTOS', fila);
  return { ok: true, evento_id: fila.evento_id, message: o ? 'Agregado: los recordatorios saldrán solos en «Hoy».' : 'Fecha agregada al calendario.' };
}
function eliminarEvento(db, data, contexto) {
  const e = leer_(db, 'DEP_EVENTOS').find((x) => x.evento_id === (data || {}).evento_id && esVerdadero_(x.activa));
  if (!e) return { ok: false, message: 'Esa fecha no existe.' };
  const pm = permisos_(db, contexto, e.depto);
  if (e.creado_por !== pm.email && !pm.edita) return { _forbidden: true, message: 'Solo quien la agregó (o la jefatura) la puede quitar.' };
  actualizarFilaPorId_(db, 'DEP_EVENTOS', 'evento_id', e.evento_id, { activa: false });
  return { ok: true, message: 'Fecha quitada del calendario.' };
}
/** Todo lo de un cliente en el área: lo enviado, sus respuestas y lo que tiene pendiente hoy. */
function porCliente(db, data, contexto) {
  const d = data || {};
  const dep = depto_(d.depto);
  if (!dep) return { ok: false, message: 'Elige un área.' };
  const pm = permisos_(db, contexto, dep.clave);
  if (!pm.ve) return { _forbidden: true, message: 'No tienes acceso a ' + dep.nombre + '.' };
  if (!d.cliente_id && !d.cliente_nombre) return { ok: false, message: 'Elige un cliente.' };
  const coincide = (x) => (d.cliente_id ? x.cliente_id === d.cliente_id : String(x.cliente_nombre).toLowerCase() === String(d.cliente_nombre).toLowerCase());
  const h = calcularHoy_(db, dep.clave, hoy_());
  const pendientes = [];
  h.grupos.forEach((g) => g.filas.filter(coincide).forEach((f) => pendientes.push({ obligacion: g.nombre, periodo_texto: g.periodo_texto, fecha_limite: g.fecha_limite, estado: f.estado, escalon: f.escalon.nombre })));
  const reg = listarRegistro(db, { depto: dep.clave, cliente_id: d.cliente_id || '', q: d.cliente_id ? '' : d.cliente_nombre }, contexto);
  const cat = catalogo_(db);
  const c = d.cliente_id && cat[d.cliente_id];
  return { cliente: { cliente_id: d.cliente_id || '', nombre: c ? c.razon_social : d.cliente_nombre, contacto: c ? c.contacto : '', telefono: c ? c.telefono : '', correo: c ? c.correo : '' },
    pendientes, historial: reg.filas || [], resumen: reg.resumen };
}

// =========================================================================================
// AJUSTES: editar obligaciones, escalones y mensajes (jefatura del área o superusuario)
// =========================================================================================
function ajustes(db, data, contexto) {
  const d = data || {};
  const dep = depto_(d.depto);
  if (!dep) return { ok: false, message: 'Elige un área.' };
  const pm = permisos_(db, contexto, dep.clave);
  if (!pm.ve) return { _forbidden: true, message: 'No tienes acceso a ' + dep.nombre + '.' };
  const fer = feriados_(db);
  // El vencimiento que cae ESTE mes (el IVA de septiembre vence en octubre).
  const ejemploDe = (o) => ((o.regla || {}).tipo === 'anual' ? CI.periodoActual_().slice(0, 4) + '-M' + String(Number(o.regla.mes) || 1).padStart(2, '0') : CI.moverPeriodo_(CI.periodoActual_(), -(Number((o.regla || {}).mes) || 0)));
  return { puede_editar: pm.edita, fuentes: FUENTES, canales: CANALES,
    obligaciones: obligaciones_(db, dep.clave, true).map((o) => ({ obligacion_id: o.obligacion_id, clave: o.clave, nombre: o.nombre, descripcion: o.descripcion, tipo: o.tipo, fuente: o.fuente,
      regla: o.regla, escalones: o.escalones, sin_recordatorio: o.sin_recordatorio, sin_respuesta: o.sin_respuesta, proceso: o.proceso, origen: o.origen, activa: o.activa,
      propuesta: PROPUESTA.some((p) => p.clave === o.clave), actualizado_por: o.actualizado_por, fecha_actualizacion: o.fecha_actualizacion,
      ejemplo: ES_EVENTO(o) ? null : { periodo_texto: periodoTexto_(ejemploDe(o)), fecha_limite: fechaLimite_(o.regla, ejemploDe(o), fer), anual: o.regla.tipo === 'anual' } })) };
}
function limpiarEscalones_(lista) {
  const vistos = new Set();
  return (Array.isArray(lista) ? lista : []).map((e, i) => {
    let id = String((e && e.id) || 'E' + (i + 1)).replace(/[^\w-]/g, '').slice(0, 12) || 'E' + (i + 1);
    while (vistos.has(id)) id += 'b';
    vistos.add(id);
    return { id, nombre: String((e && e.nombre) || 'Recordatorio').slice(0, 80), offset: Math.max(-60, Math.min(60, Math.round(Number(e && e.offset) || 0))),
      canal: CANALES.includes(e && e.canal) ? e.canal : 'WHATSAPP', a_quien: ['CLIENTE', 'RESPONSABLE', 'JEFATURA'].includes(e && e.a_quien) ? e.a_quien : 'CLIENTE',
      asunto: String((e && e.asunto) || '').slice(0, 200), texto: String((e && e.texto) || '').slice(0, 2000) };
  }).filter((e) => e.texto).sort((a, b) => a.offset - b.offset).slice(0, 10);
}
function limpiarRegla_(r) {
  r = r || {};
  const tipo = ['mensual', 'anual', 'evento'].includes(r.tipo) ? r.tipo : 'mensual';
  if (tipo === 'evento') return { tipo };
  const dia = r.dia === 'ultimo' ? 'ultimo' : Math.max(1, Math.min(31, Math.round(Number(r.dia) || 1)));
  return tipo === 'anual' ? { tipo, mes: Math.max(1, Math.min(12, Math.round(Number(r.mes) || 1))), dia, habil: r.habil !== false }
    : { tipo, mes: Math.max(0, Math.min(3, Math.round(Number(r.mes) || 0))), dia, habil: r.habil !== false };
}
function guardarObligacion(db, data, contexto) {
  const d = data || {};
  let o = d.obligacion_id ? obligacion_(db, d.obligacion_id) : null;
  const depto = o ? o.depto : d.depto;
  const dep = depto_(depto);
  if (!dep) return { ok: false, message: 'Elige un área.' };
  const pm = permisos_(db, contexto, dep.clave);
  if (!pm.edita) return { _forbidden: true, message: 'Las fechas y recordatorios los ajusta la jefatura del área o el superusuario.' };
  const nombre = String(d.nombre || '').trim().slice(0, 120);
  if (!nombre) return { ok: false, message: 'Ponle un nombre.' };
  const escalones = limpiarEscalones_(d.escalones);
  if (!escalones.length) return { ok: false, message: 'Agrega al menos un recordatorio con su mensaje.' };
  // Una obligación nueva solo puede ser interna o manual: las fuentes de las matrices son las de la propuesta.
  const fuente = o ? o.fuente : (d.fuente === 'manual' ? 'manual' : 'interno');
  const tipo = fuente === 'interno' ? 'INTERNO' : (o ? (d.tipo === 'INTERNO' || d.tipo === 'CLIENTE' ? d.tipo : o.tipo) : 'CLIENTE');
  const regla = fuente === 'manual' || (o && (o.regla || {}).tipo === 'evento') ? { tipo: 'evento' } : limpiarRegla_(d.regla);
  const cambios = { nombre, descripcion: String(d.descripcion || '').slice(0, 600), tipo, fuente, regla: JSON.stringify(regla), escalones: JSON.stringify(escalones),
    sin_recordatorio: String(d.sin_recordatorio || '').slice(0, 600), sin_respuesta: String(d.sin_respuesta || '').slice(0, 600),
    activa: d.activa !== false, actualizado_por: pm.email, fecha_actualizacion: ahora_() };
  if (!o) {
    const fila = Object.assign({ obligacion_id: crypto.randomUUID(), clave: 'PROPIA_' + crypto.randomUUID().slice(0, 8).toUpperCase(), depto: dep.clave, proceso: '', origen: 'PROPIA', orden: 50,
      creado_por: pm.email, fecha_creacion: ahora_() }, cambios);
    agregarFila_(db, 'DEP_OBLIGACIONES', fila);
    CI.historial_(db, fila.obligacion_id, 'AGENDA_CREADA', 'Creó «' + nombre + '».', contexto);
    return { ok: true, obligacion_id: fila.obligacion_id, message: 'Agregada a la agenda del área.' };
  }
  const antes = { nombre: o.nombre, regla: o.regla, escalones: o.escalones, activa: o.activa };
  actualizarFilaPorId_(db, 'DEP_OBLIGACIONES', 'obligacion_id', o.obligacion_id, Object.assign({ origen: o.origen === 'PROPIA' ? 'PROPIA' : 'EDITADA' }, cambios));
  CI.historial_(db, o.obligacion_id, 'AGENDA_EDITADA', JSON.stringify({ antes }).slice(0, 600), contexto);
  return { ok: true, message: 'Guardado. Los recordatorios usan la nueva versión desde ahora.' };
}
function restaurarPropuesta(db, data, contexto) {
  const o = obligacion_(db, (data || {}).obligacion_id);
  if (!o) return { ok: false, message: 'Esa obligación no existe.' };
  const pm = permisos_(db, contexto, o.depto);
  if (!pm.edita) return { _forbidden: true, message: 'Solo la jefatura del área o el superusuario.' };
  const p = PROPUESTA.find((x) => x.clave === o.clave);
  if (!p) return { ok: false, message: 'Esta obligación la creó el área: no tiene propuesta original.' };
  actualizarFilaPorId_(db, 'DEP_OBLIGACIONES', 'obligacion_id', o.obligacion_id, Object.assign(filaDe_(p), { origen: 'PROPUESTA', activa: true, actualizado_por: pm.email, fecha_actualizacion: ahora_() }));
  CI.historial_(db, o.obligacion_id, 'AGENDA_RESTAURADA', 'Volvió a la propuesta inicial.', contexto);
  return { ok: true, message: 'Volvió a la propuesta inicial.' };
}
function historialObligacion(db, data, contexto) {
  const o = obligacion_(db, (data || {}).obligacion_id);
  if (!o) return { ok: false, message: 'Esa obligación no existe.' };
  if (!permisos_(db, contexto, o.depto).ve) return { _forbidden: true, message: 'Sin acceso.' };
  return { historial: leer_(db, 'CI_HISTORIAL').filter((h) => h.registro_id === o.obligacion_id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .map((h) => ({ accion: h.accion, detalle: h.accion === 'AGENDA_EDITADA' ? 'Editó la obligación.' : h.detalle, usuario_email: h.usuario_email, fecha: h.fecha })) };
}

// =========================================================================================
// MEDICIÓN (para los indicadores del área y del informe de gestión)
// =========================================================================================
/**
 * Los recordatorios a clientes de un mes: cuántos se enviaron, cuántos a
 * tiempo (el día de su escalón o antes) y qué clientes no respondieron.
 */
function medirMes_(db, depto, periodo) {
  const fer = feriados_(db);
  const obls = {};
  obligaciones_(db, depto, true).forEach((o) => { obls[o.obligacion_id] = o; });
  const mes = periodo.slice(0, 4) + '-' + periodo.slice(6);
  const filas = leer_(db, 'DEP_RECORDATORIOS').filter((r) => esVerdadero_(r.activa) && r.depto === depto);
  const delMes = filas.filter((r) => diaChile_(r.fecha).slice(0, 7) === mes);
  const envios = delMes.filter((r) => r.escalon_id !== 'RESPUESTA' && r.canal !== 'INTERNO' && (obls[r.obligacion_id] || {}).tipo === 'CLIENTE');
  let aTiempo = 0, tarde = 0;
  envios.forEach((r) => {
    const o = obls[r.obligacion_id], e = o && o.escalones.find((x) => x.id === r.escalon_id);
    if (!e || !esFecha_(r.fecha_limite)) return;
    if (diaChile_(r.fecha) <= sumarHabiles_(String(r.fecha_limite).slice(0, 10), Number(e.offset) || 0, fer)) aTiempo++; else tarde++;
  });
  const clave = (r) => r.obligacion_id + '|' + r.periodo + '|' + r.item_clave;
  const respondieron = new Set(filas.filter((r) => r.escalon_id === 'RESPUESTA').map(clave));
  const sinResp = {};
  envios.forEach((r) => { if (!respondieron.has(clave(r))) sinResp[clave(r)] = r.cliente_nombre; });
  return { envios: envios.length, a_tiempo: aTiempo, tarde, respuestas: delMes.filter((r) => r.escalon_id === 'RESPUESTA').length,
    sin_respuesta: [...new Set(Object.values(sinResp))].sort() };
}
/**
 * Las fechas del área que vencieron en el mes (tareas internas: comité, visitas,
 * plan de contenidos…): cuáles se cumplieron a tiempo, tarde o no se hicieron; y
 * las citas de clientes (examen, pacto) con su aviso. Hasta `hoyF` si el mes sigue en curso.
 */
function cumplimientoMes_(db, depto, periodo, hoyF) {
  const fer = feriados_(db), ctx = { fer }, reg = registro_(db, depto);
  const a = Number(periodo.slice(0, 4)), m = Number(periodo.slice(6));
  const desde = a + '-' + String(m).padStart(2, '0') + '-01', hasta = ultimoDia_(a, m);
  const corte = (hoyF || hoy_()) < hasta ? (hoyF || hoy_()) : hasta;
  const internas = [], citas = { total: 0, avisadas: 0, lista: [] };
  obligaciones_(db, depto).forEach((o) => {
    instancias_(db, o, desde, hasta, ctx).forEach((ins) => {
      if (o.tipo === 'INTERNO') {
        ins.escalones.filter((e) => e.fecha >= desde && e.fecha <= corte).forEach((e) => {
          const r = reg[o.obligacion_id + '|' + ins.periodo + '|interno'] || { enviados: {}, ultima: null, cerrado: false };
          const env = r.enviados[e.id];
          const hecho = env ? diaChile_(env.fecha) : (r.cerrado && r.ultima ? diaChile_(r.ultima.fecha) : null);
          internas.push({ tarea: e.nombre, obligacion: o.nombre, fecha: e.fecha, hecho: hecho || '', estado: !hecho ? 'SIN_HACER' : (hecho <= e.fecha ? 'A_TIEMPO' : 'TARDE') });
        });
      } else if (o.fuente === 'manual' && ins.fecha_limite >= desde && ins.fecha_limite <= hasta) {
        ins.items.forEach((it) => {
          const r = reg[o.obligacion_id + '|' + ins.periodo + '|' + it.clave];
          const avisada = !!(r && Object.keys(r.enviados).length);
          citas.total++; if (avisada) citas.avisadas++;
          citas.lista.push({ cita: o.nombre, cliente: it.cliente_nombre, fecha: ins.fecha_limite, avisada: avisada ? 'Sí' : 'No' });
        });
      }
    });
  });
  internas.sort((x, y) => x.fecha.localeCompare(y.fecha));
  return { internas, citas, clientes: medirMes_(db, depto, periodo) };
}

// =========================================================================================
// METAS PROPIAS del área: las define la jefatura; el valor de cada mes va en el reporte
// =========================================================================================
function metas_(db, depto) {
  return leer_(db, 'DEP_METAS').filter((x) => esVerdadero_(x.activa) && (!depto || x.depto === depto))
    .map((x) => ({ meta_id: x.meta_id, depto: x.depto, nombre: x.nombre, descripcion: x.descripcion || '', unidad: x.unidad || '', meta: Number(x.meta), sentido: x.sentido === 'menor' ? 'menor' : 'mayor', orden: Number(x.orden) || 99 }))
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
}
function listarMetas(db, data, contexto) {
  const dep = depto_((data || {}).depto);
  if (!dep) return { ok: false, message: 'Elige un área.' };
  const pm = permisos_(db, contexto, dep.clave);
  if (!pm.ve) return { _forbidden: true, message: 'No tienes acceso a ' + dep.nombre + '.' };
  return { metas: metas_(db, dep.clave), puede_editar: pm.edita };
}
function guardarMeta(db, data, contexto) {
  const d = data || {};
  const actual = d.meta_id ? leer_(db, 'DEP_METAS').find((x) => x.meta_id === d.meta_id && esVerdadero_(x.activa)) : null;
  if (d.meta_id && !actual) return { ok: false, message: 'Esa meta no existe.' };
  const dep = depto_(actual ? actual.depto : d.depto);
  if (!dep) return { ok: false, message: 'Elige un área.' };
  const pm = permisos_(db, contexto, dep.clave);
  if (!pm.edita) return { _forbidden: true, message: 'Las metas las define la jefatura del área o el superusuario.' };
  if (d.quitar && actual) {
    actualizarFilaPorId_(db, 'DEP_METAS', 'meta_id', actual.meta_id, { activa: false, actualizado_por: pm.email, fecha_actualizacion: ahora_() });
    return { ok: true, message: 'Meta quitada. Los valores ya registrados quedan en los reportes anteriores.' };
  }
  const nombre = String(d.nombre || '').trim().slice(0, 100);
  if (!nombre) return { ok: false, message: 'Ponle un nombre a la meta.' };
  const meta = Number(String(d.meta).replace(',', '.'));
  if (!isFinite(meta)) return { ok: false, message: 'La meta debe ser un número.' };
  const fila = { nombre, descripcion: String(d.descripcion || '').slice(0, 300), unidad: String(d.unidad || '').slice(0, 20), meta, sentido: d.sentido === 'menor' ? 'menor' : 'mayor', actualizado_por: pm.email, fecha_actualizacion: ahora_() };
  if (actual) { actualizarFilaPorId_(db, 'DEP_METAS', 'meta_id', actual.meta_id, fila); return { ok: true, message: 'Meta actualizada.' }; }
  if (metas_(db, dep.clave).length >= 8) return { ok: false, message: 'Hasta 8 metas por área: mejor pocas y claras.' };
  agregarFila_(db, 'DEP_METAS', Object.assign({ meta_id: crypto.randomUUID(), depto: dep.clave, orden: metas_(db, dep.clave).length + 1, creado_por: pm.email, fecha_creacion: ahora_(), activa: true }, fila));
  return { ok: true, message: 'Meta agregada: el área anota su valor en el reporte mensual.' };
}

/** ¿Se le recordó al cliente (obligación `clave`, período, cliente) hasta la fecha `hasta`? Para separar atraso del cliente de atraso interno. */
function avisos_(db, clave, periodo) {
  const o = obligaciones_(db, null, true).find((x) => x.clave === clave);
  const out = {};
  if (!o) return out;
  leer_(db, 'DEP_RECORDATORIOS').filter((r) => esVerdadero_(r.activa) && r.obligacion_id === o.obligacion_id && r.periodo === periodo && r.escalon_id !== 'RESPUESTA')
    .forEach((r) => { const d = diaChile_(r.fecha); if (!out[r.item_clave] || d < out[r.item_clave]) out[r.item_clave] = d; });
  return out; // item_clave → primer aviso
}

// =========================================================================================
// CONTADORES Y ALERTAS
// =========================================================================================
/** Por módulo de área: recordatorios de hoy + atrasados (para el número del menú y el aviso al entrar). */
function pendientes_(db, contexto) {
  const ac = CI.acceso_(db, contexto);
  const out = {}, detalle = {};
  const fecha = hoy_();
  DEPARTAMENTOS.filter((d) => !d.recibe && (ac.deptos[d.clave] || {}).registra).forEach((d) => {
    try {
      const h = calcularHoy_(db, d.clave, fecha);
      out[d.modulo] = h.resumen.por_enviar + h.resumen.atrasados;
      detalle[d.modulo] = { nombre: d.nombre, por_enviar: h.resumen.por_enviar, atrasados: h.resumen.atrasados, sin_respuesta: h.resumen.sin_respuesta, proximo: h.proximo };
    } catch (e) { /* un área con datos raros no bota el contador de las otras */ }
  });
  return { pendientes: out, detalle };
}
function resumen(db, data, contexto) { return pendientes_(db, contexto); }

/**
 * Alertas de cada mañana (8:00): a quien registra en el área, cuántos
 * recordatorios tiene hoy; a la jefatura, los atrasados (escalones que no se
 * enviaron) y los clientes que no respondieron.
 */
const alertadas_ = new WeakMap();
function alertasDiarias(db) {
  const fecha = hoy_();
  const fer = feriados_(db);
  if (!esHabil_(fecha, fer)) return { enviadas: 0, motivo: 'no hábil' };
  if (alertadas_.get(db) === fecha) return { enviadas: 0, motivo: 'ya enviadas hoy' };
  alertadas_.set(db, fecha);
  const miembros = CI.miembros_(db);
  const avisos = [];
  DEPARTAMENTOS.filter((d) => !d.recibe).forEach((d) => {
    let h;
    try { h = calcularHoy_(db, d.clave, fecha); } catch (e) { return; }
    const r = h.resumen;
    const equipo = miembros.filter((m) => m.depto === d.clave && m.rol !== 'LECTURA');
    if (r.por_enviar + r.atrasados > 0) {
      const venc = h.proximo ? ' · ' + h.proximo.titulo + ' vence en ' + h.proximo.dias_habiles + (h.proximo.dias_habiles === 1 ? ' día hábil' : ' días hábiles') : '';
      equipo.forEach((m) => avisos.push({ destinatario: m.usuario_email, tipo: 'AGENDA_HOY', titulo: 'Hoy tienes ' + (r.por_enviar + r.atrasados) + ' recordatorios en ' + d.nombre,
        mensaje: r.por_enviar + ' para hoy' + (r.atrasados ? ' y ' + r.atrasados + ' atrasados' : '') + venc + '.', modulo_id: d.modulo, texto_accion: 'Abrir Hoy', vidaHoras: 14 }));
    }
    if (r.atrasados + r.sin_respuesta > 0) {
      equipo.filter((m) => m.rol === 'JEFATURA').forEach((m) => avisos.push({ destinatario: m.usuario_email, tipo: 'AGENDA_ESCALAMIENTO',
        titulo: d.nombre + ': ' + (r.atrasados ? r.atrasados + ' recordatorios sin enviar' : '') + (r.atrasados && r.sin_respuesta ? ' y ' : '') + (r.sin_respuesta ? r.sin_respuesta + ' clientes sin respuesta' : ''),
        mensaje: 'Revisa «Hoy» del área: hay recordatorios atrasados o clientes que no respondieron al último aviso.', modulo_id: d.modulo, texto_accion: 'Revisar', vidaHoras: 24 }));
    }
  });
  if (avisos.length) NotificacionesApp.encolarLote(db, avisos);
  return { enviadas: avisos.length };
}

module.exports = {
  hoy, calendario, registrarEnvio, deshacer, responder, listarRegistro, guardarEvento, eliminarEvento, porCliente,
  ajustes, guardarObligacion, restaurarPropuesta, historialObligacion, resumen, pendientes_, alertasDiarias, medirMes_, avisos_, cumplimientoMes_, metas_, listarMetas, guardarMeta,
  calcularHoy_, fechaLimite_, sumarHabiles_, habilesEntre_, telefono_, asegurarPropuesta_, registro_, obligaciones_, RESPUESTAS
};
