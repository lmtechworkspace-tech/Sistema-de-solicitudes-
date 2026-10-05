'use strict';

/**
 * indicadoresDepto.js — el motor de indicadores de la reportabilidad
 * (2026-10-03; propuesta aprobada por el dueño: "que cada reporte sirva para
 * la toma de decisiones", gerencia ve "lo malo primero").
 *
 * Para un departamento y un mes calcula, SOLO con lo que ya está en las
 * matrices:
 *  - indicadores: valor, meta, estado (ok / alerta / critico / info /
 *    sin_dato), serie de 12 meses, comparación (mes anterior, mismo mes del
 *    año anterior, promedio de 12 meses) y una EXPLICACIÓN escrita con reglas
 *    fijas ("bajó porque…", "los atrasos son de clientes que se repiten…");
 *  - alertas: lo que requiere una decisión, con qué pasa, por qué, impacto y
 *    la decisión sugerida, ordenadas de lo más grave a lo menos;
 *  - detalle: las tablas que respaldan cada alerta (clientes reincidentes,
 *    pendientes por cliente…);
 *  - calidad del dato: qué matrices no se actualizan y qué columnas faltan.
 *    Una cifra que sale de un dato no confiable lo dice.
 *
 * Y para gerencia, `ejecutivo`: las cuatro áreas en una página — semáforo,
 * alertas rojas primero, 6 indicadores clave y lo que va bien.
 *
 * Reglas de negocio (Chile): F29 vence el 20 del mes siguiente, o el hábil
 * siguiente; cotizaciones se declaran hasta el 10; el registro de contratos
 * y términos ante la DT tiene plazos de días hábiles (se usa "pendiente con
 * más de un mes" como señal, porque las matrices no traen la fecha exacta).
 */

const CI = require('./controlInterno');
const { DEPARTAMENTOS, MATRICES, matriz_ } = require('./controlInternoMatrices');
const Cumplimiento = require('./cumplimiento');

const FINALES = ['TERMINADO', 'NO_APLICA', 'REGISTRADO', 'RESUELTA', 'AL_DIA', 'SIN_CONVENIO'];
const MESES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// --- utilidades -----------------------------------------------------------------------------
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v == null ? '' : v).replace(/[$\s]/g, '');
  if (!s) return 0;
  if (/^-?\d+(\.\d+)?E[+-]?\d+$/i.test(s)) return Number(s);
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  const n = Number(s.replace(',', '.'));
  return isFinite(n) ? n : 0;
}
function lleno_(v) { return v !== undefined && v !== null && String(v).trim() !== '' && !/^(NA|N\/A|NO APLICA|-)$/i.test(String(v).trim()); }
function esFecha_(v) { return /^\d{4}-\d{2}-\d{2}/.test(String(v || '')); }
function r1_(n) { return Math.round(n * 10) / 10; }
/** Número con coma decimal (82,8). */
function d_(n) { return n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: 1 }); }
function pct_(a, b) { return b ? r1_(100 * a / b) : null; }
function mesTxt_(p) { const m = /^(\d{4})-M(\d{2})$/.exec(p || ''); return m ? MESES_[Number(m[2]) - 1] : ''; }
function mesAnio_(p) { const m = /^(\d{4})-M(\d{2})$/.exec(p || ''); return m ? MESES_[Number(m[2]) - 1] + ' de ' + m[1] : String(p || ''); }
function millones_(n) { return '$' + (Math.round(n / 1e5) / 10).toLocaleString('es-CL') + ' MM'; }
function miles_(n) { return Math.round(n).toLocaleString('es-CL'); }
function cliente_(r) { return r.cliente_id || 'N:' + CI.normalizarTexto_(r.cliente_nombre); }
/** Quién hizo la fila: su cuenta o, si no calzó, el nombre que dice la planilla ("txt:NOELIA"). */
function responsable_(r) {
  if (r.responsable_email) return r.responsable_email;
  const m = matriz_(r.matriz), c = m && m.columnas.find((x) => x.rol === 'responsable');
  const t = c ? String((r.datos || {})[c.clave] || '').trim().toUpperCase() : '';
  return t && !/^(NA|N\/A|-)$/.test(t) ? 'txt:' + t.slice(0, 40) : '';
}
function meses_(periodo, n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(CI.moverPeriodo_(periodo, -i)); return out; }
function promedio_(xs) { const v = xs.filter((x) => x !== null && x !== undefined && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }

/** Vencimiento hábil: el día `dia` del mes siguiente al período, o el hábil siguiente. */
function vencimiento_(periodo, dia, feriados) {
  const a = Number(periodo.slice(0, 4)), m = Number(periodo.slice(6));
  let d = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, dia));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || feriados.has(d.toISOString().slice(0, 10))) d = new Date(d.getTime() + 864e5);
  return d.toISOString().slice(0, 10);
}
/** Días hábiles entre a (exclusive) y b (inclusive); negativo si b es antes. */
function diasHabiles_(a, b, feriados) {
  if (a === b) return 0;
  const signo = a < b ? 1 : -1;
  let d = new Date(a + 'T00:00:00Z'), fin = new Date(b + 'T00:00:00Z'), n = 0;
  while ((signo > 0 && d < fin) || (signo < 0 && d > fin)) {
    d = new Date(d.getTime() + signo * 864e5);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !feriados.has(d.toISOString().slice(0, 10))) n += signo;
  }
  return n;
}

/** Lector con caché por cálculo: una consulta por matriz para todo el rango. */
// Las que se miran por sus pendientes antiguos (y las notificaciones, por su
// fecha) se leen completas: un pendiente de hace dos años también cuenta.
// La Agenda de los departamentos registra recordatorios desde octubre de 2026 (agendaDepto.js):
// antes de eso no hay con qué medir, y no se muestran esos indicadores.
const INICIO_AGENDA = '2026-M10';
function agenda_() { return require('./agendaDepto'); }
const COMPLETAS = ['NOTIFICACIONES_SII', 'RLE_CONTRATOS', 'RLE_FINIQUITOS', 'ANEXOS', 'COBRANZA'];
function lector_(db, desde, hasta) {
  const cache = {};
  return (matriz) => {
    if (!cache[matriz]) {
      const m = matriz_(matriz);
      if (!m) { cache[matriz] = []; } else if (m.tipo === 'lista') {
        cache[matriz] = CI.rango_(db, matriz, CI.PERIODO_LISTA, CI.PERIODO_LISTA);
      } else {
        cache[matriz] = COMPLETAS.includes(matriz) ? CI.rango_(db, matriz, '0001-M01', hasta) : CI.rango_(db, matriz, desde, hasta);
      }
    }
    return cache[matriz];
  };
}
function delMes_(filas, p) { return filas.filter((r) => r.periodo === p); }

// --- indicador: estructura común ------------------------------------------------------------------
/**
 * serie: [{ periodo, valor }] (12 meses, el último es el del reporte).
 * sentido: 'mayor' (más es mejor) o 'menor'. umbrales: { meta, alerta, critico }.
 */
function indicador_(o) {
  const serie = o.serie || [];
  const ult = serie.length ? serie[serie.length - 1].valor : null;
  const valor = o.valor !== undefined ? o.valor : ult;
  const ant = serie.length > 1 ? serie[serie.length - 2].valor : null;
  const prom = promedio_(serie.slice(0, -1).map((x) => x.valor));
  let estado = o.estado || 'info';
  if (!o.estado && valor !== null && valor !== undefined && o.umbrales) {
    const u = o.umbrales, mejor = o.sentido !== 'menor';
    const peor = (x, y) => (mejor ? x < y : x > y);
    if (u.critico !== undefined && peor(valor, u.critico)) estado = 'critico';
    else if (u.alerta !== undefined && peor(valor, u.alerta)) estado = 'alerta';
    else estado = 'ok';
  }
  if (valor === null || valor === undefined) estado = 'sin_dato';
  // Tres meses seguidos empeorando: alerta aunque siga dentro de la meta.
  let racha = 0;
  for (let i = serie.length - 1; i > 0; i--) {
    const a = serie[i].valor, b = serie[i - 1].valor;
    if (a === null || b === null) break;
    if (o.sentido === 'menor' ? a > b : a < b) racha++; else break;
  }
  if (estado === 'ok' && racha >= 3 && o.umbrales) estado = 'alerta';
  return Object.assign({
    valor, anterior: ant, promedio_12: prom === null ? null : r1_(prom), racha_empeora: racha,
    anio_anterior: o.anio_anterior !== undefined ? o.anio_anterior : null, estado
  }, o, { serie, estado, valor });
}
/** Frase de variación contra el mes anterior y el promedio, para cualquier indicador. */
function variacion_(k, fmt) {
  const f = fmt || ((x) => String(x));
  const partes = [];
  if (k.anterior !== null && k.anterior !== undefined && k.valor !== null) {
    const d = k.valor - k.anterior;
    if (Math.abs(d) > 1e-9) partes.push((d > 0 ? 'subió ' : 'bajó ') + f(Math.abs(d)) + ' respecto de ' + mesTxt_(k.serie[k.serie.length - 2].periodo));
    else partes.push('igual que ' + mesTxt_(k.serie[k.serie.length - 2].periodo));
  }
  if (k.promedio_12 && k.valor !== null) {
    const r = Math.round(100 * (k.valor / k.promedio_12 - 1));
    if (Math.abs(r) >= 5) partes.push(Math.abs(r) + ' % ' + (r > 0 ? 'sobre' : 'bajo') + ' el promedio de los últimos 12 meses');
    else partes.push('en línea con el promedio de 12 meses');
  }
  return partes.join('; ');
}

// =========================================================================================
// CONTABILIDAD
// =========================================================================================
function contabilidad_(db, periodo, ctx) {
  const L = ctx.leer, M12 = ctx.meses, fer = ctx.feriados, kpis = [], alertas = [], detalle = {};
  const hoy = ctx.hoy;

  // --- F29: puntualidad, al límite, sin registro y reincidentes --------------------------------
  const iva = L('IVA');
  const tardiasPorCliente = {}, nombre = {};
  const serieF29 = [], serieLimite = [];
  let mesActual = null;
  M12.forEach((p) => {
    const filas = delMes_(iva, p).filter((r) => r.estado !== 'NO_APLICA');
    const venc = vencimiento_(p, 20, fer);
    const decl = filas.filter((r) => esFecha_(r.datos.fecha_declaracion));
    const tarde = decl.filter((r) => r.datos.fecha_declaracion.slice(0, 10) > venc);
    const limite = decl.filter((r) => { const d = r.datos.fecha_declaracion.slice(0, 10); return d <= venc && diasHabiles_(d, venc, fer) <= 2; });
    tarde.forEach((r) => { const c = cliente_(r); tardiasPorCliente[c] = (tardiasPorCliente[c] || 0) + 1; nombre[c] = r.cliente_nombre; });
    const vencido = hoy > venc;
    serieF29.push({ periodo: p, valor: decl.length ? pct_(decl.length - tarde.length, decl.length) : null });
    serieLimite.push({ periodo: p, valor: decl.length ? pct_(limite.length, decl.length) : null });
    if (p === periodo) mesActual = { filas, venc, decl, tarde, vencido, limite };
  });
  const reincidentes = Object.keys(tardiasPorCliente).filter((c) => tardiasPorCliente[c] >= 3).sort((a, b) => tardiasPorCliente[b] - tardiasPorCliente[a])
    .map((c) => ({ cliente: nombre[c], meses_tarde: tardiasPorCliente[c] }));
  detalle.f29_reincidentes = reincidentes;
  if (mesActual) {
    detalle.f29_atrasos_mes = mesActual.tarde.map((r) => ({ cliente: r.cliente_nombre, declarado: r.datos.fecha_declaracion.slice(0, 10), dias_habiles_tarde: diasHabiles_(mesActual.venc, r.datos.fecha_declaracion.slice(0, 10), fer), reincidente: tardiasPorCliente[cliente_(r)] >= 3 }));
    const sinDecl = mesActual.filas.filter((r) => !esFecha_(r.datos.fecha_declaracion));
    detalle.f29_sin_registro = sinDecl.map((r) => ({ cliente: r.cliente_nombre, situacion: (CI.estadoDef_(matriz_('IVA'), r.estado) || {}).etiqueta || r.estado, estado_pago: r.datos.estado_pago || '' }));

    const k = indicador_({ clave: 'f29_a_tiempo', nombre: 'F29 declarados a tiempo', unidad: '%', formato: 'pct', sentido: 'mayor', gerencia: true,
      umbrales: { meta: 95, alerta: 95, critico: 85 }, serie: serieF29, meta_texto: '≥ 95 %',
      definicion: 'Declarados hasta el vencimiento hábil (día 20, o el hábil siguiente) ÷ declarados.' });
    if (!mesActual.vencido && k.valor !== null) { k.estado = 'info'; k.nota = 'El F29 de ' + mesTxt_(periodo) + ' vence el ' + mesActual.venc.split('-').reverse().join('-') + ': el mes todavía está en curso.'; }
    const nT = mesActual.tarde.length, nR = mesActual.tarde.filter((r) => tardiasPorCliente[cliente_(r)] >= 3).length;
    k.explicacion = k.valor === null ? 'Ningún F29 del mes tiene fecha de declaración registrada.'
      : (nT === 0 ? 'Todos los F29 declarados del mes (' + mesActual.decl.length + ') se presentaron a tiempo. ' : nT + ' de ' + mesActual.decl.length + ' F29 se declararon después del vencimiento (' + mesActual.venc.split('-').reverse().join('-') + ')' +
        (nR ? '; ' + (nR === nT ? 'todos' : nR) + ' de clientes que se atrasan 3 meses o más de cada 12: el problema está en esos clientes, no en el proceso. ' : '. ')) + variacion_(k, (x) => d_(x) + ' puntos') + '.';
    // Con la agenda (desde el IVA de septiembre de 2026): ¿al cliente atrasado se le avisó antes del vencimiento?
    if (CI.moverPeriodo_(periodo, 1) >= INICIO_AGENDA && nT) {
      const av = agenda_().avisos_(db, 'IVA_F29', periodo);
      let conAviso = 0;
      detalle.f29_atrasos_mes.forEach((x, i) => {
        const r = mesActual.tarde[i], primer = av[r.cliente_id || 'N:' + r.cliente_nombre];
        x.recordatorio = primer && primer <= mesActual.venc ? 'Sí, desde el ' + primer.split('-').reverse().join('-') : 'No';
        if (primer && primer <= mesActual.venc) conAviso++;
      });
      k.extra = Object.assign({}, k.extra, { atraso_cliente: conAviso, atraso_interno: nT - conAviso });
      k.explicacion += ' Atribución: ' + conAviso + ' con recordatorio antes del vencimiento (atraso del cliente) y ' + (nT - conAviso) + ' sin recordatorio (atraso interno).';
    }
    kpis.push(k);

    const kl = indicador_({ clave: 'f29_al_limite', nombre: 'F29 declarados al límite', unidad: '%', formato: 'pct', sentido: 'menor',
      umbrales: { meta: 30, alerta: 40 }, serie: serieLimite, meta_texto: '≤ 30 %', definicion: '% de los F29 declarados en los 2 últimos días hábiles antes del vencimiento.' });
    kl.explicacion = kl.valor === null ? '' : (kl.valor > 40 ? 'Casi la mitad del IVA se declara en los últimos dos días hábiles: cualquier ausencia o caída del SII en esos días produce atrasos. Conviene adelantar la recolección de información de los clientes. '
      : 'La carga del cierre del IVA está repartida en el mes. ') + variacion_(kl, (x) => d_(x) + ' puntos') + '.';
    kpis.push(kl);

    const nSin = sinDecl.length;
    kpis.push(indicador_({ clave: 'f29_sin_registro', nombre: 'Clientes sin F29 registrado', unidad: 'clientes', formato: 'num', sentido: 'menor', valor: nSin,
      estado: !mesActual.vencido ? 'info' : (nSin ? 'alerta' : 'ok'), serie: [], meta_texto: '0 sin justificar', definicion: 'Clientes del mes sin fecha de declaración del F29.',
      explicacion: !mesActual.vencido ? 'El plazo del F29 del mes todavía no vence.' : (nSin ? nSin + ' clientes no tienen la declaración registrada. Hay que confirmar si no tuvieron movimiento o si quedaron sin declarar.' : 'Todos los clientes del mes tienen su declaración registrada.') }));

    kpis.push(indicador_({ clave: 'f29_reincidentes', nombre: 'Clientes reincidentes en atraso', unidad: 'clientes', formato: 'num', sentido: 'menor', valor: reincidentes.length,
      estado: reincidentes.length ? 'alerta' : 'ok', serie: [], meta_texto: '0', definicion: 'Clientes con el F29 atrasado 3 meses o más de los últimos 12.',
      explicacion: reincidentes.length ? 'Se atrasan casi siempre: ' + reincidentes.slice(0, 3).map((x) => x.cliente + ' (' + x.meses_tarde + ' de 12)').join(', ') + '. Conviene hablar con ellos o ajustar las condiciones del servicio.' : 'Ningún cliente se atrasa de forma repetida.' }));

    if (reincidentes.length) alertas.push({ nivel: 'alerta', area: 'Contabilidad', clave: 'f29_reincidentes', titulo: 'Clientes que se atrasan con el IVA casi todos los meses',
      cifra: reincidentes.length + ' clientes', que_pasa: reincidentes.slice(0, 3).map((x) => x.cliente + ' (' + x.meses_tarde + ' de 12 meses)').join(', ') + '.',
      por_que: 'El atraso se repite en los mismos clientes; en el resto el IVA sale a tiempo.', impacto: 'Multas e intereses del SII al cliente y reclamos hacia HomePymes.',
      decision: 'Reunión con estos clientes para fijar una fecha de entrega de información, o cambiar sus condiciones.' });
    if (k.estado === 'critico' || (k.estado === 'alerta' && nT - nR > 0)) alertas.push({ nivel: k.estado === 'critico' ? 'critico' : 'alerta', area: 'Contabilidad', clave: 'f29_a_tiempo', titulo: 'IVA declarado fuera de plazo',
      cifra: nT + ' de ' + mesActual.decl.length, que_pasa: k.explicacion, por_que: (nT - nR) + ' atrasos son de clientes que normalmente cumplen.', impacto: 'Multas e intereses al cliente.', decision: 'Revisar qué pasó en el cierre del mes y reforzar el calendario.' });
  }

  // --- IVA pagado (contexto) ---------------------------------------------------------------------
  const serieIva = M12.map((p) => ({ periodo: p, valor: delMes_(iva, p).reduce((s, r) => s + num_(r.datos.monto_pago), 0) }));
  const kIva = indicador_({ clave: 'iva_pagado', nombre: 'IVA a pagar de los clientes', unidad: '$', formato: 'monto', serie: serieIva, estado: 'info', definicion: 'Suma del monto a pagar declarado en los F29 del mes.' });
  kIva.explicacion = kIva.valor ? millones_(kIva.valor) + ' declarados a pagar; ' + variacion_(kIva, millones_) + '.' : 'Sin montos registrados.';
  kpis.push(kIva);

  // --- Contabilización: avance y atraso acumulado ------------------------------------------------
  const cont = L('CONTABILIZACION');
  const serieCont = M12.map((p) => { const f = delMes_(cont, p); return { periodo: p, valor: f.length ? pct_(f.filter((r) => FINALES.includes(r.estado)).length, f.length) : null }; });
  const ult6 = M12.slice(-6);
  const pendCli = {};
  cont.filter((r) => ult6.includes(r.periodo) && !FINALES.includes(r.estado)).forEach((r) => { const c = cliente_(r); (pendCli[c] = pendCli[c] || { cliente: r.cliente_nombre, meses: [] }).meses.push(r.periodo); });
  const atrasados = Object.values(pendCli).filter((x) => x.meses.length >= 2).map((x) => ({ cliente: x.cliente, meses_pendientes: x.meses.length, desde: mesAnio_(x.meses.sort()[0]) })).sort((a, b) => b.meses_pendientes - a.meses_pendientes);
  detalle.contabilizacion_atrasada = atrasados;
  const fMes = delMes_(cont, periodo);
  detalle.contabilizacion_pendiente_mes = fMes.filter((r) => !FINALES.includes(r.estado)).map((r) => ({ cliente: r.cliente_nombre, situacion: (CI.estadoDef_(matriz_('CONTABILIZACION'), r.estado) || {}).etiqueta || r.estado }));
  const kc = indicador_({ clave: 'avance_contable', nombre: 'Avance de la contabilización', unidad: '%', formato: 'pct', sentido: 'mayor', gerencia: true,
    umbrales: { meta: 95, alerta: 90, critico: 75 }, serie: serieCont, meta_texto: '≥ 95 %', definicion: 'Clientes con la contabilización del mes terminada ÷ clientes del mes.' });
  kc.explicacion = kc.valor === null ? 'Sin contabilización registrada en el mes.' : detalle.contabilizacion_pendiente_mes.length + ' de ' + fMes.length + ' clientes sin cerrar. ' +
    (kc.racha_empeora >= 3 ? 'Bajó ' + kc.racha_empeora + ' meses seguidos: si sigue así, el atraso se acumula. ' : '') + variacion_(kc, (x) => d_(x) + ' puntos') + '.';
  kpis.push(kc);
  kpis.push(indicador_({ clave: 'atraso_contable', nombre: 'Clientes con contabilidad atrasada', unidad: 'clientes', formato: 'num', sentido: 'menor', valor: atrasados.length,
    estado: atrasados.length ? 'alerta' : 'ok', serie: [], meta_texto: '0', definicion: 'Clientes con 2 meses o más sin cerrar en los últimos 6.',
    explicacion: atrasados.length ? atrasados.length + ' clientes acumulan meses sin cerrar' + (atrasados[0] ? '; el más atrasado es ' + atrasados[0].cliente + ' (' + atrasados[0].meses_pendientes + ' meses).' : '.') : 'Ningún cliente acumula meses sin cerrar.' }));
  if (kc.estado === 'critico' || kc.estado === 'alerta') alertas.push({ nivel: kc.estado, area: 'Contabilidad', clave: 'avance_contable', titulo: 'La contabilización mensual se está atrasando',
    cifra: d_(kc.valor) + ' % · ' + atrasados.length + ' clientes con meses acumulados', que_pasa: kc.explicacion,
    por_que: kc.racha_empeora >= 3 ? 'Empeora ' + kc.racha_empeora + ' meses seguidos: el área no alcanza a cerrar todos los clientes cada mes.' : 'Hay clientes sin cerrar al término del mes.',
    impacto: 'Balances y declaraciones sin respaldo contable al día; riesgo ante el SII y en la Renta.', decision: 'Plan de puesta al día por cliente y revisar la carga del área.' });

  // --- Facturación emitida para clientes y concentración --------------------------------------------
  const fac = L('FACTURACION');
  const serieFac = M12.map((p) => ({ periodo: p, valor: delMes_(fac, p).reduce((s, r) => s + num_(r.datos.monto_total), 0) }));
  const docs = delMes_(fac, periodo).length;
  const kf = indicador_({ clave: 'facturacion', nombre: 'Facturación emitida para clientes', unidad: '$', formato: 'monto', serie: serieFac, gerencia: true,
    definicion: 'Monto total de los documentos emitidos para los clientes en el mes.', extra: { documentos: docs, clientes: new Set(delMes_(fac, periodo).map(cliente_)).size } });
  kf.estado = kf.promedio_12 && kf.valor < 0.7 * kf.promedio_12 ? 'alerta' : 'info';
  kf.explicacion = docs + ' documentos por ' + millones_(kf.valor || 0) + '; ' + variacion_(kf, millones_) + (kf.estado === 'alerta' ? '. Una caída así suele venir de uno o dos clientes grandes que no facturaron: revisar el detalle.' : '.');
  kpis.push(kf);
  const anual = {};
  fac.filter((r) => M12.includes(r.periodo)).forEach((r) => { const c = cliente_(r); anual[c] = anual[c] || { cliente: r.cliente_nombre, monto: 0 }; anual[c].monto += num_(r.datos.monto_total); });
  const ranking = Object.values(anual).sort((a, b) => b.monto - a.monto);
  const total = ranking.reduce((s, x) => s + x.monto, 0);
  detalle.facturacion_top = ranking.slice(0, 10).map((x) => ({ cliente: x.cliente, monto: Math.round(x.monto), participacion: pct_(x.monto, total) }));
  const top5 = pct_(ranking.slice(0, 5).reduce((s, x) => s + x.monto, 0), total);
  kpis.push(indicador_({ clave: 'concentracion', nombre: 'Concentración en 5 clientes', unidad: '%', formato: 'pct', sentido: 'menor', valor: top5, serie: [],
    estado: top5 === null ? 'sin_dato' : (top5 > 40 ? 'alerta' : 'ok'), meta_texto: '≤ 40 %', definicion: '% de lo facturado en 12 meses que corresponde a los 5 clientes mayores.',
    explicacion: top5 === null ? '' : 'Los 5 mayores clientes suman el ' + d_(top5) + ' % de lo facturado en 12 meses (' + ranking.length + ' clientes). ' + (top5 > 40 ? 'Perder uno de ellos se nota de inmediato.' : '') }));

  // --- Convenios TGR con cuotas vencidas -------------------------------------------------------------
  const conv = delMes_(L('CONVENIOS'), periodo);
  const vencidas = conv.filter((r) => r.estado === 'CON_VENCIDAS');
  const deuda = conv.reduce((s, r) => s + [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((t, i) => t + num_(r.datos['monto_total_deuda_' + i]), 0), 0);
  detalle.convenios_vencidos = vencidas.map((r) => ({ cliente: r.cliente_nombre }));
  kpis.push(indicador_({ clave: 'convenios_vencidos', nombre: 'Clientes con cuotas de convenio vencidas', unidad: 'clientes', formato: 'num', sentido: 'menor', valor: conv.length ? vencidas.length : null,
    estado: !conv.length ? 'sin_dato' : (vencidas.length ? 'alerta' : 'ok'), serie: [], meta_texto: '0', definicion: 'Clientes de la matriz Convenios del mes con alguna cuota vencida.',
    explicacion: !conv.length ? 'La matriz de convenios del mes no tiene filas.' : vencidas.length + ' clientes con cuotas vencidas; deuda total en convenios ' + millones_(deuda) + '. Un convenio con cuotas impagas puede caducar y la deuda vuelve completa.' }));

  // --- Notificaciones del SII abiertas ----------------------------------------------------------------
  const notif = L('NOTIFICACIONES_SII');
  const vig = notif.filter((r) => r.estado !== 'RESUELTA');
  const anio = periodo.slice(0, 4);
  // Año de la notificación: su fecha o, si no la tiene, el mes en que se registró.
  const anioDe = (r) => String(r.datos.fecha || r.periodo || '').slice(0, 4);
  const delAnio = vig.filter((r) => anioDe(r) === anio);
  const resueltas = notif.length - vig.length;
  detalle.notificaciones_abiertas = delAnio.map((r) => ({ cliente: r.cliente_nombre, tipo: r.datos.tipo || '', fecha: String(r.datos.fecha || '').slice(0, 10) || mesAnio_(r.periodo) }));
  const confiableNotif = notif.length ? resueltas / notif.length >= 0.2 : true;
  kpis.push(indicador_({ clave: 'notificaciones_sii', nombre: 'Notificaciones del SII abiertas', unidad: 'casos', formato: 'num', sentido: 'menor', valor: vig.length, serie: [],
    estado: delAnio.length ? 'alerta' : 'ok', confiable: confiableNotif, meta_texto: '0 con más de 30 días', definicion: 'Notificaciones y anotaciones sin marcar como resueltas.',
    explicacion: vig.length + ' vigentes (' + delAnio.length + ' de ' + anio + '); solo ' + resueltas + ' de ' + notif.length + ' están marcadas como resueltas.' + (!confiableNotif ? ' La columna «resuelta» casi no se usa: la cifra no es confiable hasta que se revisen.' : '') }));
  if (delAnio.length) alertas.push({ nivel: 'critico', area: 'Contabilidad', clave: 'notificaciones_sii', titulo: 'Notificaciones del SII sin resolver',
    cifra: vig.length + ' vigentes · ' + delAnio.length + ' de ' + anio, que_pasa: 'Hay notificaciones y anotaciones del SII de este año que no figuran como resueltas.',
    por_que: confiableNotif ? 'Siguen abiertas en la matriz.' : 'La columna «resuelta» casi no se usa: no se sabe cuáles siguen abiertas de verdad.',
    impacto: 'Giros, bloqueos de timbraje o multas a los clientes.', decision: 'Revisar las de ' + anio + ' en una sola pasada y marcarlas al cerrarlas.' });

  return { kpis, alertas, detalle };
}

// =========================================================================================
// RECURSOS HUMANOS
// =========================================================================================
function rrhh_(db, periodo, ctx) {
  const L = ctx.leer, M12 = ctx.meses, kpis = [], alertas = [], detalle = {};

  // --- Liquidaciones procesadas ----------------------------------------------------------------------
  const rem = L('REMUNERACIONES');
  const serieLiq = M12.map((p) => ({ periodo: p, valor: delMes_(rem, p).reduce((s, r) => s + num_(r.datos.cantidad), 0) }));
  const remMes = delMes_(rem, periodo);
  const porCli = {};
  remMes.forEach((r) => { const c = cliente_(r); porCli[c] = porCli[c] || { cliente: r.cliente_nombre, liquidaciones: 0 }; porCli[c].liquidaciones += num_(r.datos.cantidad); });
  detalle.liquidaciones_por_cliente = Object.values(porCli).sort((a, b) => b.liquidaciones - a.liquidaciones).slice(0, 10);
  const kl = indicador_({ clave: 'liquidaciones', nombre: 'Liquidaciones procesadas', unidad: 'trabajadores', formato: 'num', serie: serieLiq, gerencia: true, estado: 'info',
    definicion: 'Trabajadores liquidados en el mes, todas las empresas cliente.', extra: { clientes: Object.keys(porCli).length } });
  const top2 = detalle.liquidaciones_por_cliente.slice(0, 2);
  kl.explicacion = miles_(kl.valor || 0) + ' liquidaciones de ' + Object.keys(porCli).length + ' clientes; ' + variacion_(kl, miles_) + '.' +
    (top2.length === 2 && kl.valor ? ' Los dos mayores (' + top2.map((x) => x.cliente).join(' y ') + ') suman ' + d_(pct_(top2[0].liquidaciones + top2[1].liquidaciones, kl.valor)) + ' %.' : '');
  kpis.push(kl);

  // --- Cotizaciones a tiempo e intereses (dependen de columnas que hoy casi no se llenan) ---------------------
  const conFecha = remMes.filter((r) => esFecha_(r.datos.fecha_declaracion));
  const cobertura = remMes.length ? conFecha.length / remMes.length : 0;
  if (cobertura < 0.8) {
    kpis.push(indicador_({ clave: 'cotizaciones_a_tiempo', nombre: 'Cotizaciones declaradas a tiempo', unidad: '%', formato: 'pct', valor: null, estado: 'sin_dato', serie: [], meta_texto: '100 %',
      definicion: 'Declaradas en Previred hasta el día 10 ÷ total.', explicacion: 'No se puede medir: la fecha de declaración está registrada en ' + Math.round(100 * cobertura) + ' % de las filas del mes. Hay que llenarla al cerrar cada empresa.' }));
  } else {
    const venc = vencimiento_(periodo, 10, ctx.feriados);
    const ok = conFecha.filter((r) => r.datos.fecha_declaracion.slice(0, 10) <= venc).length;
    kpis.push(indicador_({ clave: 'cotizaciones_a_tiempo', nombre: 'Cotizaciones declaradas a tiempo', unidad: '%', formato: 'pct', sentido: 'mayor', valor: pct_(ok, conFecha.length), serie: [],
      umbrales: { meta: 100, alerta: 100, critico: 90 }, meta_texto: '100 %', definicion: 'Declaradas en Previred hasta el día 10 ÷ total.', explicacion: ok + ' de ' + conFecha.length + ' empresas declararon a tiempo.' }));
  }
  const conInteres = remMes.filter((r) => lleno_(r.datos.valor_intereses) || lleno_(r.datos.monto_total_interes));
  const intereses = remMes.reduce((s, r) => s + num_(r.datos.valor_intereses) + num_(r.datos.monto_total_interes), 0);
  kpis.push(indicador_({ clave: 'intereses', nombre: 'Intereses por cotizaciones atrasadas', unidad: '$', formato: 'monto', sentido: 'menor', valor: conInteres.length ? intereses : null,
    estado: conInteres.length ? (intereses > 0 ? 'alerta' : 'ok') : 'sin_dato', serie: [], meta_texto: '$0', definicion: 'Intereses pagados por imposiciones fuera de plazo.',
    explicacion: conInteres.length ? (intereses > 0 ? millones_(intereses) + ' en intereses en ' + conInteres.length + ' empresas.' : 'Sin intereses en el mes.') : 'No se registra: las columnas de intereses están vacías.' }));

  // --- Registro Electrónico Laboral (DT): pendientes fuera de plazo -----------------------------------------
  const limite = CI.moverPeriodo_(periodo, -1);
  const rlePend = ['RLE_CONTRATOS', 'RLE_FINIQUITOS'].map((k) => {
    const f = L(k).filter((r) => r.estado === 'PENDIENTE' && r.periodo <= limite);
    return { matriz: k, pendientes: f.length, clientes: new Set(f.map(cliente_)).size, desde: f.length ? mesAnio_(f.map((r) => r.periodo).sort()[0]) : '' };
  });
  detalle.rle_pendiente = rlePend.map((x) => ({ registro: x.matriz === 'RLE_CONTRATOS' ? 'Contratos' : 'Finiquitos', pendientes: x.pendientes, clientes: x.clientes, desde: x.desde }));
  const totRle = rlePend[0].pendientes + rlePend[1].pendientes;
  kpis.push(indicador_({ clave: 'rle_pendiente', nombre: 'Registros ante la DT fuera de plazo', unidad: 'registros', formato: 'num', sentido: 'menor', valor: totRle, serie: [],
    estado: totRle ? 'critico' : 'ok', meta_texto: '0', definicion: 'Contratos y finiquitos del RLE pendientes desde el mes anterior o antes (plazo legal: 3 a 15 días hábiles).',
    explicacion: totRle ? rlePend[1].pendientes + ' finiquitos y ' + rlePend[0].pendientes + ' contratos siguen pendientes de registro' + (rlePend[1].desde ? ' (finiquitos desde ' + rlePend[1].desde + ')' : '') + '. O el registro está atrasado o se hace y no se anota: en los dos casos no se puede demostrar ante una fiscalización.' : 'Sin registros pendientes fuera de plazo.' }));
  if (totRle) alertas.push({ nivel: 'critico', area: 'Recursos Humanos', clave: 'rle_pendiente', titulo: 'Registro Electrónico Laboral (DT) atrasado',
    cifra: rlePend[1].pendientes + ' finiquitos (' + rlePend[1].clientes + ' clientes) · ' + rlePend[0].pendientes + ' contratos (' + rlePend[0].clientes + ' clientes)',
    que_pasa: 'Hay contratos y términos sin registro ante la DT' + (rlePend[0].desde ? ', los más antiguos desde ' + [rlePend[0].desde, rlePend[1].desde].filter(Boolean).sort()[0] : '') + '. La ley da 15 días hábiles para un contrato y de 3 a 10 para un término.',
    por_que: 'Las matrices RLE tienen pendientes de meses anteriores sin cerrar.', impacto: 'Multa de la DT al cliente y reclamo hacia HomePymes.', decision: 'Confirmar con RR.HH. el estado real esta semana y fijar un responsable del RLE.' });

  // --- Movimientos de personal de los clientes: salidas por cada entrada ---------------------------------------
  const con = L('CONTRATOS'), fin = L('FINIQUITOS');
  const entradas = (p) => delMes_(con, p).reduce((s, r) => s + (num_(r.datos.cantidad_trabajadores_contratos) || 1), 0);
  const salidas = (p) => delMes_(fin, p).reduce((s, r) => s + (num_(r.datos.n_trabajadores) || 1), 0);
  const serieRatio = M12.map((p) => { const e = entradas(p), s = salidas(p); return { periodo: p, valor: e ? r1_(s / e) : (s ? s : null) }; });
  const e12 = M12.reduce((s, p) => s + entradas(p), 0), s12 = M12.reduce((s, p) => s + salidas(p), 0);
  const kr = indicador_({ clave: 'salidas_por_entrada', nombre: 'Salidas por cada entrada', unidad: '×', formato: 'ratio', sentido: 'menor', serie: serieRatio, gerencia: true,
    umbrales: { meta: 1, alerta: 1.5 }, meta_texto: '≤ 1,5', definicion: 'Finiquitos ÷ contratos de los trabajadores de las empresas cliente.',
    extra: { contratos: entradas(periodo), finiquitos: salidas(periodo), contratos_12: e12, finiquitos_12: s12 } });
  const mesesMal = serieRatio.filter((x) => x.valor !== null && x.valor > 1).length;
  kr.explicacion = salidas(periodo) + ' finiquitos y ' + entradas(periodo) + ' contratos en el mes. En 12 meses salieron ' + s12 + ' y entraron ' + e12 + ' (' + (e12 ? d_(s12 / e12) : '—') + ' por cada uno); ' +
    mesesMal + ' de 12 meses con más salidas que entradas. Menos trabajadores en los clientes son menos liquidaciones y menos ingresos.';
  if (e12 && s12 / e12 > 1.5) kr.estado = kr.estado === 'ok' ? 'alerta' : kr.estado;
  kpis.push(kr);
  if (e12 && s12 / e12 > 1.5) alertas.push({ nivel: 'alerta', area: 'Recursos Humanos', clave: 'salidas_por_entrada', titulo: 'Los clientes están reduciendo dotación',
    cifra: s12 + ' finiquitos vs ' + e12 + ' contratos en 12 meses', que_pasa: 'Por cada trabajador que entra salen ' + d_(s12 / e12) + '.',
    por_que: 'Es una señal comercial temprana: los clientes se achican, sobre todo en construcción.', impacto: 'Menos liquidaciones y menos ingresos por cliente.', decision: 'Revisar con Ventas los clientes que más bajaron y la estrategia de retención.' });
  const caus = {};
  fin.filter((r) => M12.includes(r.periodo)).forEach((r) => { const c = String(r.datos.causal_finiquito || 'Sin causal').trim().toUpperCase().slice(0, 60); caus[c] = (caus[c] || 0) + 1; });
  const totC = Object.values(caus).reduce((s, x) => s + x, 0);
  detalle.causales = Object.entries(caus).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([causal, n]) => ({ causal, finiquitos: n, participacion: pct_(n, totC) }));

  // --- Anexos pendientes, certificados y licencias ------------------------------------------------------------
  const anx = L('ANEXOS').filter((r) => r.estado === 'PENDIENTE' && r.periodo <= limite);
  kpis.push(indicador_({ clave: 'anexos_pendientes', nombre: 'Anexos pendientes de más de un mes', unidad: 'anexos', formato: 'num', sentido: 'menor', valor: anx.length, serie: [],
    estado: anx.length ? 'alerta' : 'ok', meta_texto: '0', definicion: 'Anexos sin enviar o sin firmar desde el mes anterior o antes.',
    explicacion: anx.length ? anx.length + ' anexos de ' + new Set(anx.map(cliente_)).size + ' clientes siguen pendientes.' : 'Sin anexos atrasados.' }));
  const serieCert = M12.map((p) => ({ periodo: p, valor: delMes_(L('CERTIFICADOS_F30'), p).length + delMes_(L('CERTIFICADOS_F301'), p).length }));
  const kcert = indicador_({ clave: 'certificados', nombre: 'Certificados F30 y F30-1 emitidos', unidad: 'certificados', formato: 'num', serie: serieCert, estado: 'info', definicion: 'Certificados de antecedentes laborales y de cumplimiento emitidos en el mes.' });
  kcert.explicacion = (kcert.valor || 0) + ' certificados; ' + variacion_(kcert, miles_) + '. El tiempo de respuesta no se puede medir: la fecha de recepción se registra igual a la de envío.';
  kpis.push(kcert);
  const lic = delMes_(L('LICENCIAS'), periodo);
  kpis.push(indicador_({ clave: 'licencias', nombre: 'Licencias médicas tramitadas', unidad: 'licencias', formato: 'num', serie: M12.map((p) => ({ periodo: p, valor: delMes_(L('LICENCIAS'), p).length })), estado: 'info',
    definicion: 'Licencias tramitadas en el mes y días de licencia.', explicacion: lic.length + ' licencias por ' + lic.reduce((s, r) => s + num_(r.datos.dias_licencia), 0) + ' días en total.' }));

  return { kpis, alertas, detalle };
}

// =========================================================================================
// FACTURACIÓN Y COBRANZAS: lo que HomePymes cobra a sus clientes
// =========================================================================================
function cobranzas_(db, periodo, ctx) {
  const L = ctx.leer, M12 = ctx.meses, kpis = [], alertas = [], detalle = {};
  const hoy = ctx.hoy;
  const fin = (p) => { const a = Number(p.slice(0, 4)), m = Number(p.slice(6)); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
  // Se mira hasta el cierre del mes informado (o hoy, si el mes está en curso).
  const corte = hoy < fin(periodo) ? hoy : fin(periodo);
  const todas = L('COBRANZA').filter((r) => r.periodo <= periodo && r.estado !== 'ANULADA');
  const saldo = (r) => Math.max(0, num_(r.datos.monto) - num_(r.datos.monto_pagado));
  const abiertas = todas.filter((r) => r.estado !== 'PAGADA' && saldo(r) > 0);
  const vencida = (r) => esFecha_(r.datos.fecha_vencimiento) && r.datos.fecha_vencimiento.slice(0, 10) < corte;
  const dias = (a, b) => Math.round((new Date(b) - new Date(a.slice(0, 10))) / 864e5);
  const porCobrar = abiertas.reduce((t, r) => t + saldo(r), 0);
  const vencidas = abiertas.filter(vencida);
  const montoVencido = vencidas.reduce((t, r) => t + saldo(r), 0);
  const morosos = {};
  vencidas.forEach((r) => { const c = cliente_(r); const d = dias(r.datos.fecha_vencimiento, corte); morosos[c] = morosos[c] || { cliente: r.cliente_nombre, saldo_vencido: 0, facturas: 0, dias_max: 0 }; morosos[c].saldo_vencido += saldo(r); morosos[c].facturas++; morosos[c].dias_max = Math.max(morosos[c].dias_max, d); });
  detalle.morosos = Object.values(morosos).sort((a, b) => b.saldo_vencido - a.saldo_vencido).map((x) => Object.assign(x, { saldo_vencido: Math.round(x.saldo_vencido) }));
  if (!todas.length) {
    kpis.push(indicador_({ clave: 'cartera_vencida', nombre: 'Cartera vencida', unidad: '$', formato: 'monto', valor: null, estado: 'sin_dato', serie: [], definicion: 'Saldo de facturas vencidas sin pagar.',
      explicacion: 'Todavía no hay facturas registradas en la matriz de cobranza.' }));
    return { kpis, alertas, detalle, sin_datos: true };
  }
  const k = indicador_({ clave: 'cartera_vencida', nombre: 'Cartera vencida', unidad: '$', formato: 'monto', sentido: 'menor', valor: montoVencido, serie: [], gerencia: true,
    estado: montoVencido <= 0 ? 'ok' : (detalle.morosos.some((x) => x.dias_max > 90) ? 'critico' : 'alerta'), meta_texto: '$0 con más de 30 días',
    definicion: 'Saldo de las facturas vencidas y sin pagar al cierre del mes.', extra: { por_cobrar: porCobrar, clientes: detalle.morosos.length } });
  k.explicacion = montoVencido <= 0 ? 'Sin facturas vencidas: ' + millones_(porCobrar) + ' por cobrar, todo dentro de plazo.'
    : millones_(montoVencido) + ' vencidos de ' + millones_(porCobrar) + ' por cobrar (' + d_(pct_(montoVencido, porCobrar)) + ' %), en ' + detalle.morosos.length + ' clientes. ' +
      (detalle.morosos[0] ? 'El mayor es ' + detalle.morosos[0].cliente + ' (' + millones_(detalle.morosos[0].saldo_vencido) + ', ' + detalle.morosos[0].dias_max + ' días).' : '');
  kpis.push(k);
  if (k.estado !== 'ok') alertas.push({ nivel: k.estado, area: 'Facturación y Cobranzas', clave: 'cartera_vencida', titulo: 'Clientes con facturas vencidas',
    cifra: millones_(montoVencido) + ' · ' + detalle.morosos.length + ' clientes', que_pasa: k.explicacion,
    por_que: detalle.morosos.some((x) => x.dias_max > 90) ? 'Hay deudas de más de 90 días: la probabilidad de cobrarlas baja con el tiempo.' : 'Facturas que pasaron su fecha de vencimiento sin pago.',
    impacto: 'Menos caja para operar y riesgo de incobrables.', decision: 'Gestión de cobro a los mayores deudores y evaluar suspender servicios a los de más de 90 días.' });

  const serieCobrado = M12.map((p) => ({ periodo: p, valor: todas.filter((r) => esFecha_(r.datos.fecha_pago) && 'M' + r.datos.fecha_pago.slice(5, 7) === p.slice(5) && r.datos.fecha_pago.slice(0, 4) === p.slice(0, 4)).reduce((t, r) => t + num_(r.datos.monto_pagado), 0) }));
  const kc = indicador_({ clave: 'cobrado', nombre: 'Cobrado en el mes', unidad: '$', formato: 'monto', serie: serieCobrado, estado: 'info', definicion: 'Pagos recibidos en el mes.' });
  kc.explicacion = millones_(kc.valor || 0) + ' cobrados; ' + variacion_(kc, millones_) + '.';
  kpis.push(kc);
  const serieFact = M12.map((p) => ({ periodo: p, valor: todas.filter((r) => r.periodo === p).reduce((t, r) => t + num_(r.datos.monto), 0) }));
  const kf = indicador_({ clave: 'facturado_hp', nombre: 'Facturado por HomePymes', unidad: '$', formato: 'monto', serie: serieFact, estado: 'info', definicion: 'Honorarios facturados a los clientes en el mes.' });
  kf.explicacion = millones_(kf.valor || 0) + ' facturados; ' + variacion_(kf, millones_) + '.';
  kpis.push(kf);
  const pagadas3 = todas.filter((r) => esFecha_(r.datos.fecha_pago) && esFecha_(r.datos.fecha_emision) && M12.slice(-3).includes(r.datos.fecha_pago.slice(0, 4) + '-M' + r.datos.fecha_pago.slice(5, 7)));
  const plazos = pagadas3.map((r) => dias(r.datos.fecha_emision, r.datos.fecha_pago.slice(0, 10))).filter((x) => x >= 0).sort((a, b) => a - b);
  const aTiempo = pagadas3.filter((r) => esFecha_(r.datos.fecha_vencimiento) && r.datos.fecha_pago.slice(0, 10) <= r.datos.fecha_vencimiento.slice(0, 10)).length;
  kpis.push(indicador_({ clave: 'dias_cobro', nombre: 'Días que demora el cobro', unidad: 'días', formato: 'num', sentido: 'menor', valor: plazos.length ? plazos[Math.floor(plazos.length / 2)] : null, serie: [],
    umbrales: { meta: 30, alerta: 45, critico: 60 }, meta_texto: '≤ 30 días', definicion: 'Mediana de días entre la emisión y el pago (pagos de los últimos 3 meses).',
    explicacion: plazos.length ? 'La mitad de las facturas se cobra en ' + plazos[Math.floor(plazos.length / 2)] + ' días o menos; ' + d_(pct_(aTiempo, pagadas3.length)) + ' % se pagó dentro del vencimiento.' : 'Sin pagos registrados en los últimos 3 meses.' }));
  return { kpis, alertas, detalle };
}

// =========================================================================================
// Transversal: clientes activos, dependencia de una persona y calidad del dato
// =========================================================================================
function transversal_(db, depto, periodo, ctx) {
  const L = ctx.leer, M12 = ctx.meses, kpis = [], alertas = [], detalle = {};
  const ms = MATRICES.filter((m) => m.depto === depto && m.tipo !== 'lista' && !m.sinUso);
  const filasMes = (p) => ms.reduce((a, m) => a.concat(delMes_(L(m.clave), p)), []);
  // Clientes activos (con algún trabajo del área en el mes).
  const serieCli = M12.map((p) => ({ periodo: p, valor: new Set(filasMes(p).map(cliente_)).size || null }));
  const hace12 = new Set(filasMes(CI.moverPeriodo_(periodo, -12)).map(cliente_)).size;
  const actual = new Set(filasMes(periodo).map(cliente_)), previo = new Set(filasMes(CI.moverPeriodo_(periodo, -1)).map(cliente_));
  const altas = [...actual].filter((c) => !previo.has(c)).length, bajas = [...previo].filter((c) => !actual.has(c)).length;
  const kc = indicador_({ clave: 'clientes_activos', nombre: 'Clientes atendidos', unidad: 'clientes', formato: 'num', serie: serieCli, anio_anterior: hace12 || null, gerencia: true, estado: 'info',
    definicion: 'Clientes con algún trabajo del área en el mes.', extra: { altas, bajas } });
  const caida = hace12 ? Math.round(100 * (actual.size / hace12 - 1)) : null;
  kc.explicacion = actual.size + ' clientes; ' + altas + ' nuevos y ' + bajas + ' que no tuvieron trabajo respecto del mes anterior.' + (caida !== null ? ' Hace un año eran ' + hace12 + ' (' + (caida >= 0 ? '+' : '') + caida + ' %).' : '');
  if (caida !== null && caida <= -5) {
    kc.estado = 'alerta';
    let peorMes = null, peor = 0;
    for (let i = 1; i < serieCli.length; i++) { const d = (serieCli[i].valor || 0) - (serieCli[i - 1].valor || 0); if (d < peor) { peor = d; peorMes = serieCli[i].periodo; } }
    alertas.push({ nivel: 'alerta', area: (DEPARTAMENTOS.find((d) => d.clave === depto) || {}).nombre, clave: 'clientes_activos', titulo: 'Bajan los clientes atendidos',
      cifra: hace12 + ' → ' + actual.size + ' (' + caida + ' %) en 12 meses', que_pasa: 'Hace un año el área atendía ' + hace12 + ' clientes; en ' + mesTxt_(periodo) + ', ' + actual.size + '.',
      por_que: peorMes ? 'La mayor baja fue en ' + mesAnio_(peorMes) + ' (' + peor + ' clientes). Hay que confirmar si son bajas reales o filas que se dejaron de registrar.' : 'Menos clientes con trabajo registrado cada mes.',
      impacto: 'Menos ingresos si son bajas reales.', decision: 'Revisar con Ventas y Administración qué clientes se fueron y por qué.' });
  }
  kpis.push(kc);

  // Dependencia de una persona (12 meses, filas con responsable).
  const carga = {};
  M12.forEach((p) => filasMes(p).forEach((r) => { const q = responsable_(r); if (q) carga[q] = (carga[q] || 0) + 1; }));
  const tot = Object.values(carga).reduce((s, x) => s + x, 0);
  const top = Object.entries(carga).sort((a, b) => b[1] - a[1])[0];
  if (top && tot) {
    const p = pct_(top[1], tot);
    detalle.carga_por_persona = Object.entries(carga).sort((a, b) => b[1] - a[1]).map(([email, n]) => ({ email, registros: n, participacion: pct_(n, tot) }));
    kpis.push(indicador_({ clave: 'dependencia', nombre: 'Trabajo en una sola persona', unidad: '%', formato: 'pct', sentido: 'menor', valor: p, serie: [], estado: p > 60 ? 'alerta' : 'ok',
      meta_texto: '≤ 60 %', definicion: '% de los registros del área (con responsable) hechos por la persona con más carga, en 12 meses.', extra: { email: top[0] },
      explicacion: 'Una persona hizo el ' + d_(p) + ' % de los ' + miles_(tot) + ' registros del área en 12 meses.' + (p > 60 ? ' Si se ausenta, el cierre del mes queda sin respaldo.' : '') }));
    if (p > 60) alertas.push({ nivel: 'alerta', area: (DEPARTAMENTOS.find((d) => d.clave === depto) || {}).nombre, clave: 'dependencia', titulo: 'El área depende de una sola persona',
      cifra: d_(p) + ' % de los registros', que_pasa: 'Una persona hizo ' + miles_(top[1]) + ' de ' + miles_(tot) + ' registros en 12 meses.', persona: top[0],
      por_que: 'No hay una segunda persona que haga el mismo trabajo.', impacto: 'Si se ausenta, los cierres del mes quedan sin respaldo.', decision: 'Designar y capacitar a una persona de respaldo.' });
  }

  // Agenda del área (desde octubre de 2026): recordatorios a tiempo y clientes que no respondieron.
  if (periodo >= INICIO_AGENDA) {
    const ag = agenda_().medirMes_(db, depto, periodo);
    const medidos = ag.a_tiempo + ag.tarde, p = medidos ? pct_(ag.a_tiempo, medidos) : null;
    kpis.push(indicador_({ clave: 'recordatorios_a_tiempo', nombre: 'Recordatorios enviados a tiempo', unidad: '%', formato: 'pct', sentido: 'mayor', valor: p, serie: [],
      estado: p === null ? 'sin_dato' : (p >= 90 ? 'ok' : (p >= 75 ? 'alerta' : 'critico')), meta_texto: '≥ 90 %',
      definicion: 'Recordatorios a clientes registrados en la Agenda el día que tocaba o antes ÷ registrados.',
      explicacion: p === null ? 'No hay recordatorios registrados en la Agenda este mes.' : ag.envios + ' recordatorios a clientes; ' + ag.a_tiempo + ' a tiempo y ' + ag.tarde + ' tarde. ' + ag.respuestas + ' respuestas registradas.' }));
    const nSR = ag.sin_respuesta.length;
    detalle.clientes_sin_respuesta = ag.sin_respuesta.map((c) => ({ cliente: c }));
    kpis.push(indicador_({ clave: 'clientes_sin_respuesta', nombre: 'Clientes que no respondieron', unidad: 'clientes', formato: 'num', sentido: 'menor', valor: ag.envios ? nSR : null, serie: [],
      estado: !ag.envios ? 'sin_dato' : (nSR ? 'alerta' : 'ok'), meta_texto: '0', definicion: 'Clientes con recordatorios este mes y sin respuesta registrada.',
      explicacion: !ag.envios ? '' : (nSR ? nSR + ' clientes no respondieron: ' + ag.sin_respuesta.slice(0, 3).join(', ') + (nSR > 3 ? ' y otros.' : '.') : 'Todos los clientes avisados respondieron.') }));
  }

  // Calidad del dato: matrices sin registros recientes y pendientes antiguos.
  const calidad = [];
  ms.forEach((m) => {
    const f = L(m.clave);
    if (f.length < 6) return; // matrices esporádicas
    const ult = f.map((r) => r.periodo).sort().pop();
    const viejos = f.filter((r) => !FINALES.includes(r.estado) && r.periodo < CI.moverPeriodo_(periodo, -2)).length;
    const sinActualizar = ult < CI.moverPeriodo_(periodo, -2);
    if (sinActualizar || viejos >= 10) calidad.push({ matriz: m.nombre, ultimo_mes: mesAnio_(ult), pendientes_antiguos: viejos,
      problema: sinActualizar ? 'Sin registros desde ' + mesAnio_(ult) + ': sus cifras no se consideran confiables.' : viejos + ' filas sin cerrar de hace más de 2 meses: o están atrasadas o falta marcarlas.' });
  });
  detalle.calidad = calidad;
  return { kpis, alertas, detalle };
}

// =========================================================================================
// API
// =========================================================================================
const ORDEN_NIVEL = { critico: 0, alerta: 1, info: 2 };
const TIENE_INDICADORES = ['CONTABILIDAD', 'RRHH', 'COBRANZAS'];

function contexto_(db, periodo) {
  // 13 meses para el área + 12 hacia atrás para "hace un año" (y reincidencias).
  const desde = CI.moverPeriodo_(periodo, -12), hasta = periodo;
  let fer = [];
  try { fer = Cumplimiento.obtenerFeriados(db).map((f) => String(f).slice(0, 10)); } catch (e) { /* sin feriados */ }
  return { leer: lector_(db, CI.moverPeriodo_(desde, -1), hasta), meses: meses_(periodo, 12), feriados: new Set(fer), hoy: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()) };
}
/** Indicadores, alertas y detalle de un área en un mes (sin permisos: lo usan otras acciones). */
function calcularArea_(db, depto, periodo, ctx) {
  const c = ctx || contexto_(db, periodo);
  const dep = DEPARTAMENTOS.find((d) => d.clave === depto);
  if (!dep || !TIENE_INDICADORES.includes(depto)) return { depto, nombre: dep ? dep.nombre : depto, periodo, con_indicadores: false, kpis: [], alertas: [], detalle: {} };
  if (depto === 'COBRANZAS') {
    const x = cobranzas_(db, periodo, c);
    const nivel = x.sin_datos ? 'sin_datos' : (x.alertas.some((a) => a.nivel === 'critico') ? 'critico' : (x.alertas.length ? 'alerta' : 'ok'));
    return { depto, nombre: dep.nombre, periodo, periodo_texto: mesAnio_(periodo), con_indicadores: !x.sin_datos, semaforo: nivel, kpis: x.kpis, alertas: x.alertas, detalle: x.detalle };
  }
  const partes = [depto === 'CONTABILIDAD' ? contabilidad_(db, periodo, c) : rrhh_(db, periodo, c), transversal_(db, depto, periodo, c)];
  const kpis = [].concat(...partes.map((x) => x.kpis));
  const alertas = [].concat(...partes.map((x) => x.alertas)).sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel]);
  const detalle = Object.assign({}, ...partes.map((x) => x.detalle));
  const nivel = alertas.some((a) => a.nivel === 'critico') ? 'critico' : (alertas.length ? 'alerta' : 'ok');
  return { depto, nombre: dep.nombre, periodo, periodo_texto: mesAnio_(periodo), con_indicadores: true, semaforo: nivel, kpis, alertas, detalle };
}

/** Acción: indicadores de un área (con los permisos del área). */
function area(db, data, contexto) {
  const d = data || {};
  const dep = DEPARTAMENTOS.find((x) => x.clave === d.depto);
  if (!dep) return { ok: false, message: 'Elige un área.' };
  const ac = CI.acceso_(db, contexto);
  const ve = (ac.deptos[dep.clave] || {}).ve || (ac.deptos.ADMINISTRACION || {}).ve;
  if (!ve) return { _forbidden: true, message: 'No tienes acceso a ' + dep.nombre + '.' };
  const periodo = CI.RE_PERIODO.test(String(d.periodo || '')) ? d.periodo : CI.moverPeriodo_(CI.periodoActual_(), -1);
  return calcularArea_(db, dep.clave, periodo);
}

/** Lo que va al Director: las áreas, lo malo primero, 6 indicadores y lo que va bien. */
function ejecutivo_(db, periodo) {
  const c = contexto_(db, periodo);
  // Todas las áreas, incluida Facturación y Cobranzas (sus cifras van en el informe aunque no entregue reporte propio).
  const areas = DEPARTAMENTOS.filter((d) => !d.recibe).map((d) => calcularArea_(db, d.clave, periodo, c));
  const alertas = [].concat(...areas.map((a) => a.alertas)).sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel]);
  const busca = (dep, k) => { const a = areas.find((x) => x.depto === dep); return a ? a.kpis.find((x) => x.clave === k) : null; };
  // Clientes atendidos de la empresa = unión de las áreas: se toma el mayor de los dos como referencia.
  const clave = [busca('CONTABILIDAD', 'f29_a_tiempo'), busca('CONTABILIDAD', 'avance_contable'), busca('CONTABILIDAD', 'clientes_activos'),
    busca('CONTABILIDAD', 'facturacion'), busca('RRHH', 'liquidaciones'), busca('RRHH', 'salidas_por_entrada'), busca('COBRANZAS', 'cartera_vencida')].filter((k) => k && k.valor !== null)
    .map((k, i) => Object.assign({}, k, i === 2 ? { nombre: 'Clientes de Contabilidad' } : {}));
  const bien = [];
  areas.forEach((a) => a.kpis.filter((k) => k.estado === 'ok' && k.gerencia).forEach((k) => bien.push({ area: a.nombre, texto: k.nombre + ': ' + k.explicacion })));
  return {
    periodo, periodo_texto: mesAnio_(periodo),
    semaforo: areas.map((a) => ({ depto: a.depto, nombre: a.nombre, nivel: a.con_indicadores ? a.semaforo : 'sin_datos',
      resumen: a.con_indicadores ? (a.alertas[0] ? a.alertas[0].titulo : 'Sin alertas en el mes.') : (a.depto === 'COBRANZAS' ? 'Todavía sin facturas registradas en la matriz de cobranza.' : 'Todavía sin matrices: entrega su reporte con la plantilla.') })),
    alertas, indicadores: clave, bien, calidad: [].concat(...areas.map((a) => (a.detalle.calidad || []).map((x) => Object.assign({ area: a.nombre }, x))))
  };
}

module.exports = { calcularArea_, ejecutivo_, area, contexto_, vencimiento_, diasHabiles_, num_, TIENE_INDICADORES };
