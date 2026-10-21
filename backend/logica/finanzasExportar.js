'use strict';

/**
 * finanzasExportar.js — descargar datos de la bóveda en Excel o CSV
 * (2026-10-20; FIN-40, T35).
 *
 *  - Lo que se puede bajar: movimientos del banco, operaciones registradas,
 *    aplicaciones a facturas, cartera (corte: hoy), fondos por gestión,
 *    presupuesto y el informe del mes (mismo contrato que la pantalla).
 *  - Cada archivo dice su corte, base, estado de los datos, revisión, filtros
 *    y quién lo generó; trae los ID y referencias para rastrear cada fila.
 *  - CSV: separado por «;», UTF-8 con BOM, líneas CRLF. Un texto que empiece
 *    con = + − @ (o tab) se neutraliza con un apóstrofo para que la planilla
 *    no lo ejecute como fórmula; los números (también los negativos) siguen
 *    siendo números. XLSX: los textos van como texto (nunca como fórmula).
 *  - Exige la capacidad EXPORTAR y queda en la bitácora (sin cifras).
 *  - I09.5: movimientos, operaciones y aplicaciones exigen el mes (o pedir
 *    «todo el historial» a propósito): no se exporta toda la base por omisión.
 *    El informe se exporta completo desde el contrato (indicadores con su
 *    estado, comparaciones, calidad, comentarios, cascada y cuentas) y sus
 *    metadatos salen del mismo contrato (corte, base, estado, revisión).
 */

const Base = require('./finanzasBase');
const Cat = require('./finanzasCatalogos');
const FB = require('./finanzasBancos');
const H = require('./finanzasHechos');
const { errorValidacion } = require('./errores');

const I = FB.interno;
const TIPOS = {
  movimientos: 'Movimientos del banco', operaciones: 'Operaciones registradas', aplicaciones: 'Aplicaciones a facturas',
  cartera: 'Cartera por factura', fondos: 'Fondos por gestión', presupuesto: 'Presupuesto y real', informe: 'Informe del mes'
};

/** Neutraliza un texto que una planilla tomaría como fórmula. Los números no se tocan. */
function celdaSegura_(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function csv_(columnas, filas, meta) {
  const q = (v) => {
    if (typeof v === 'number' && isFinite(v)) return String(v);
    const s = celdaSegura_(v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = meta.map(([k, v]) => q(k) + ';' + q(v)).concat(['', columnas.map(q).join(';')]).concat(filas.map((f) => f.map(q).join(';')));
  return '﻿' + lineas.join('\r\n') + '\r\n';
}

function clasifTxt_(c) {
  if (!c) return { tipo: '', subtipo: '', concepto: '', cliente: '', empresa_contraparte: '', gestion: '', proyecto: '', periodo_obligacion: '', destino: '', reparto: '' };
  return { tipo: (FB.TIPOS[c.tipo] || {}).nombre || c.tipo || '', subtipo: c.subtipo || '', concepto: c.cuenta || '', cliente: c.cliente || '', empresa_contraparte: c.empresa || '', gestion: c.gestion_id || '',
    proyecto: c.proyecto_id || '', periodo_obligacion: c.periodo_obligacion || '', destino: c.destino || '',
    reparto: c.reparto ? (FB.partesReparto_(c.reparto, 1) ? (c.reparto.modo || 'IGUALES') + ': ' + (c.reparto.partes || c.reparto).map((p) => p.empresa || p).join(', ') : '') : '' };
}

const POR_MES_ = ['movimientos', 'operaciones', 'aplicaciones'];
function datos_(db, tipo, f) {
  const periodo = Base.periodo_(f.periodo) || '';
  const emp = Cat.empresa_(f.empresa) || '';
  if (POR_MES_.indexOf(tipo) !== -1 && !periodo && !f.todo) return { error: errorValidacion('periodo', 'Elige el mes, o marca «Todo el historial» si de verdad lo necesitas.') };
  if (tipo === 'movimientos') {
    const cuentas = I.cuentasMapa_();
    const filas = I.db_().prepare('SELECT * FROM FIN_MOVIMIENTOS' + (periodo ? ' WHERE periodo = ?' : '') + ' ORDER BY fecha, orden').all(...(periodo ? [periodo] : [])).filter((r) => !emp || (cuentas.get(r.cuenta_ref) || {}).empresa === emp);
    const out = [];
    filas.forEach((r) => {
      const d = I.des_(r.datos), cu = cuentas.get(r.cuenta_ref) || {};
      require('./finanzasPagadores').piezas_(d, r.estado === 'CONFIRMADO' ? d.clasif : null).forEach((p, i) => {
        const c = clasifTxt_(p.clasif);
        out.push([r.id + (i ? '#' + i : ''), r.fecha, cu.empresa || '', (cu.banco || '') + ' ···' + (cu.ultimos4 || ''), d.glosa, d.doc, p.cargo ? -p.cargo : p.abono, i ? '' : d.saldo, r.estado,
          c.tipo, c.subtipo, c.concepto, c.cliente, c.empresa_contraparte, c.gestion, c.proyecto, c.periodo_obligacion, c.destino, c.reparto, (p.clasif && p.clasif.nota) || '',
          (d.detalle && d.detalle.descripcion) || '', d.clasif && d.clasif.operaciones ? d.clasif.operaciones.join(' ') : '', r.actualizado_por || '']);
      });
    });
    return { columnas: ['ID', 'Fecha', 'Empresa', 'Cuenta', 'Glosa del banco', 'N° doc.', 'Monto (+ entra / − sale)', 'Saldo', 'Estado', 'Tipo', 'Subtipo', 'Concepto', 'Cliente', 'Empresa contraparte',
      'Gestión de fondos', 'Proyecto', 'Período obligación', 'Destino', 'Reparto', 'Nota', 'Detalle del banco', 'Operaciones conciliadas', 'Confirmado por'], filas: out };
  }
  if (tipo === 'operaciones') {
    const Op = require('./finanzasOperaciones');
    const out = [];
    Op.hechosRegistro_; // asegura el módulo
    I.db_().prepare('SELECT * FROM FIN_OPERACIONES' + (periodo ? ' WHERE periodo = ?' : '') + ' ORDER BY fecha').all(...(periodo ? [periodo] : [])).map(Op.publica_).filter((o) => !emp || o.empresa === emp).forEach((o) => {
      (o.distribuciones || []).forEach((p, i) => {
        const c = clasifTxt_(p);
        out.push([o.id + (i ? '#' + i : ''), o.fecha, o.empresa, o.sentido === 'ENTRADA' ? p.monto : -p.monto, i ? '' : o.monto, o.medio, o.tercero, o.referencia, o.estado, o.conciliacion,
          c.tipo, c.subtipo, c.concepto, c.cliente, c.gestion, c.proyecto, c.periodo_obligacion, c.destino, o.nota, o.fuente, o.origen ? JSON.stringify(o.origen).slice(0, 200) : '', o.creado_por]);
      });
    });
    return { columnas: ['ID', 'Fecha', 'Empresa', 'Parte (+/−)', 'Total operación', 'Medio', 'Tercero', 'Referencia', 'Estado', 'Banco', 'Tipo', 'Subtipo', 'Concepto', 'Cliente', 'Gestión', 'Proyecto', 'Período obligación', 'Destino', 'Nota', 'Fuente', 'Origen', 'Creado por'], filas: out };
  }
  if (tipo === 'aplicaciones') {
    const C = require('./finanzasCobranza');
    const facturas = new Map();
    I.db_().prepare('SELECT id, empresa, datos FROM FIN_FACTURAS').all().forEach((r) => facturas.set(r.id, Object.assign({ empresa: r.empresa }, I.des_(r.datos))));
    const out = C.aplicaciones_({ todas: true }).filter((a) => (!emp || (facturas.get(a.factura_id) || {}).empresa === emp) && (!periodo || String(a.fecha_aplicacion || '').slice(0, 7) === periodo)).map((a) => {
      const f = facturas.get(a.factura_id) || {};
      return [a.id, f.empresa || '', f.folio || a.folio || '', a.recepcion_ref, a.fecha_recepcion || '', a.fecha_aplicacion, a.monto, a.estado, a.creado_por, a.deshecho_por || '', a.motivo_deshacer || ''];
    });
    return { columnas: ['ID', 'Empresa emisora', 'Factura', 'Abono (referencia)', 'Fecha del abono', 'Fecha de aplicación', 'Monto', 'Estado', 'Aplicó', 'Deshizo', 'Motivo'], filas: out };
  }
  if (tipo === 'cartera') {
    const C = require('./finanzasCobranza');
    const out = [];
    C.cartera_(db, { empresa: emp }).forEach((n) => n.facturas.forEach((f) => out.push([n.cliente, n.rut, f.empresa, f.tipo_doc, f.folio, f.fecha, f.vence, f.total, f.aplicado_confirmado || 0, f.aplicado_sugerido || 0, (f.nc || 0) + (f.nc_cliente || 0), f.saldo, f.saldo_confirmado, f.dias, f.situacion, f.estado_legado || '', f.origen])));
    return { columnas: ['Cliente', 'RUT', 'Empresa emisora', 'Tipo doc.', 'Folio', 'Emisión', 'Vence', 'Total', 'Aplicado (confirmado)', 'Aplicado (sugerido)', 'Notas de crédito', 'Saldo', 'Saldo confirmado', 'Días de atraso', 'Situación', 'Estado en la planilla', 'Origen'], filas: out };
  }
  if (tipo === 'fondos') {
    const Fo = require('./finanzasFondos');
    const out = [];
    const clientes = new Set(Fo.hechosFondos_({}).map((h) => h.clasif.cliente_id).concat(Fo.aperturas_().map((a) => a.cliente_id)).concat([...Fo.gestionesMapa_().values()].map((g) => g.cliente_id)));
    const nombres = new Map(I.clientes_(db).map((c) => [c.id, c.nombre]));
    clientes.forEach((id) => {
      const f = Fo.fichaCliente_(id, '');
      f.gestiones.concat([Object.assign({ id: '', obligacion: '(sin gestión)', periodo_obligacion: '', estado: '' }, f.sin_gestion)]).forEach((g) => {
        if (!g.id && !g.saldo && !g.recibido && !g.pagado) return;
        out.push([nombres.get(id) || id, g.id, g.obligacion, g.periodo_obligacion, g.estado, g.apertura, g.recibido, g.reintegros, g.pagado, g.devuelto, g.reasignado_entra - g.reasignado_sale, g.saldo, f.parcial ? 'Parcial (sin saldo inicial)' : 'Con saldo inicial']);
      });
    });
    return { columnas: ['Cliente', 'Gestión', 'Obligación', 'Período', 'Estado', 'Saldo inicial', 'Recibido', 'Reintegros', 'Pagado', 'Devuelto', 'Reasignado (neto)', 'Saldo', 'Calidad'], filas: out };
  }
  if (tipo === 'presupuesto') {
    const P = require('./finanzasPresupuesto');
    const anio = Number(f.anio) || Number((periodo || Base.hoy_()).slice(0, 4));
    const ap = P.lineas_(anio, emp), bo = P.lineas_(anio, emp, { borrador: true }), re = P.real_(anio, emp, 'CASH_GROSS');
    const out = [];
    [...new Set(Object.keys(ap).concat(Object.keys(bo)).concat(Object.keys(re)))].sort().forEach((k) => {
      const [t, cuenta] = k.split('|');
      [['Aprobado', ap[k]], ['Borrador', bo[k]], ['Real (caja bruta)', re[k]]].forEach(([nombre, v]) => { if (v) out.push([anio, emp || 'Grupo', t, cuenta, nombre].concat(v)); });
    });
    return { columnas: ['Año', 'Empresa', 'Tipo', 'Concepto', 'Versión'].concat(['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']), filas: out };
  }
  if (tipo === 'informe') {
    const R = require('./finanzasReportes');
    const c = R.reporte_(db, { periodo, empresa: emp, base: Base.txt_(f.base).toUpperCase(), comparacion: Base.txt_(f.comparacion) });
    const ev = c.evaluacion || {};
    const EST = { DETERMINED: 'Determinada', PROVISIONAL: 'Provisoria', NOT_DETERMINABLE: 'No determinable' };
    const filas = [];
    const metricas = c.basis === 'DOCUMENT_NET' ? ['ventas_netas'] : ['ingresos', 'egresos', 'flujo_propio', 'fondos_recibidos', 'fondos_pagados'];
    metricas.concat(['caja', 'custodia', 'caja_libre', 'meses_caja']).forEach((k) => {
      const d = R.DEFINICIONES[k] || {}, e = ev[k];
      const v = k === 'custodia' ? c.metrics.custodia_positiva : c.metrics[k];
      const cmp = c.comparisons[k] || {};
      filas.push(['Indicador', d.nombre || k, v === undefined ? null : v, e ? EST[e.status] : (c.quality.status === 'COMPLETO' ? 'Determinada' : 'Provisoria'),
        ['PREVIOUS_PERIOD', 'SAME_PERIOD_LAST_YEAR', 'BUDGET'].map((t) => cmp[t] ? R_TXT_[t] + ': ' + cmp[t].texto + (cmp[t].evaluable === false && cmp[t].estado === 'COMPARABLE' ? ' (sin calificar)' : '') : '').filter(Boolean).join(' · '),
        [d.formula, d.fuentes ? 'Fuentes: ' + d.fuentes : '', d.excluye ? 'Excluye: ' + d.excluye : '', d.fecha ? 'Fecha: ' + d.fecha : ''].filter(Boolean).join(' ')]);
    });
    c.quality.reasons.forEach((r) => filas.push(['Calidad', r.codigo, r.monto === undefined ? null : r.monto, c.quality.status, r.texto, '']));
    c.insights.forEach((i) => filas.push(['Comentario' + (i.principal ? ' principal' : ''), i.rule_id + ' v' + i.rule_version, i.actual === undefined ? null : i.actual, i.severidad, i.texto, i.limites || '']));
    ((c.breakdowns.cascada || {}).pasos || []).forEach((x) => filas.push(['Cascada', x.concepto, x.signo * x.monto, x.tipo, '', '']));
    if (c.breakdowns.cascada) filas.push(['Cascada', 'Flujo propio (suma)', c.breakdowns.cascada.total, c.breakdowns.cascada.cuadra ? 'Cuadra con el indicador' : 'NO CUADRA', '', '']);
    (c.breakdowns.cuentas_periodo || []).forEach((x) => filas.push(['Cuenta', x.cuenta + ' · ' + x.empresa, x.cierre, x.completa ? 'Completa' : 'Cobertura hasta ' + (x.cubierta_hasta || '—'),
      'Apertura ' + (x.apertura === null ? '—' : x.apertura) + ' · entradas ' + x.entradas + ' · salidas ' + x.salidas, x.diferencia === null ? x.nota : 'Diferencia ' + x.diferencia]));
    c.series.forEach((x) => filas.push(['Serie', x.periodo, x.sin_datos ? null : (x.flujo_propio !== undefined ? x.flujo_propio : x.ventas_netas), x.sin_datos ? 'Sin datos (no es cero)' : '', c.basis === 'DOCUMENT_NET' ? 'ventas netas' : 'flujo propio', '']));
    return { columnas: ['Sección', 'Concepto', 'Valor (CLP)', 'Estado', 'Comparación o detalle', 'Definición o nota'], filas, contrato: c };
  }
  return null;
}

const R_TXT_ = { PREVIOUS_PERIOD: 'Mes anterior', SAME_PERIOD_LAST_YEAR: 'Año anterior', BUDGET: 'Presupuesto' };
const exportar = Base.conCapacidad('EXPORTAR', '', function (db, data, contexto, x) {
  const tipo = Base.txt_(data && data.tipo);
  if (!TIPOS[tipo]) return errorValidacion('tipo', 'Elige qué exportar.');
  const formato = Base.txt_(data.formato).toLowerCase() === 'csv' ? 'csv' : 'xlsx';
  const f = data.filtros || {};
  const r = datos_(db, tipo, f);
  if (r.error) return r.error;
  if (data.data_revision && data.data_revision !== Base.revision_()) return Base.errConflicto('Los datos cambiaron desde que abriste la pantalla. Recarga y vuelve a exportar.');
  let estado = '';
  try { if (r.contrato) estado = r.contrato.quality.status; else if (f.periodo) estado = require('./finanzasReportes').reporte_(db, { periodo: f.periodo, empresa: f.empresa }).quality.status; } catch (e) { estado = ''; }
  // El informe lleva los metadatos de su contrato (los mismos de la pantalla y el PDF).
  const k = r.contrato;
  const meta = [['Exportación', TIPOS[tipo]], ['Filtros', [k ? k.period : f.periodo || (f.todo ? 'todo el historial' : 'hoy'), f.empresa || 'grupo', tipo === 'presupuesto' ? f.anio || '' : ''].filter(Boolean).join(' · ')],
    ['Corte', k ? k.as_of : Base.hoy_()], ['Base', k ? (require('./finanzasReportes').BASES[k.basis] || k.basis) : tipo === 'cartera' ? 'Cartera de hoy' : 'Caja bruta / registros'], ['Moneda', 'CLP (pesos chilenos)'],
    ['Estado de los datos', estado || '—'], ['Revisión de datos', k ? k.data_revision : Base.revision_()], ['Versión de reglas', k ? 'v' + k.rule_version : '—'],
    ['Generado por', x.nombre], ['Confidencial', 'Datos de la bóveda de Finanzas']];
  const nombre = 'finanzas-' + tipo + (f.periodo ? '-' + f.periodo : '') + (f.empresa ? '-' + f.empresa : '');
  x.registrar('EXPORTAR_' + tipo.toUpperCase(), formato + ' · ' + r.filas.length + ' fila(s)');
  if (formato === 'csv') return { nombre: nombre + '.csv', mime: 'text/csv;charset=utf-8', base64: Buffer.from(csv_(r.columnas, r.filas, meta), 'utf8').toString('base64'), filas: r.filas.length };
  const L = require('./libroExcel');
  const buf = L.construirLibro({ titulo: TIPOS[tipo], subtitulo: meta.map((m) => m.join(': ')).join(' · '), meta,
    // En XLSX los textos van como texto en línea (inlineStr): Excel no los ejecuta, no hace falta el apóstrofo.
    hojas: [{ nombre: TIPOS[tipo].slice(0, 30), columnas: r.columnas, filas: r.filas.map((fila) => fila.map((v) => (v === null ? '' : v))) }] });
  return { nombre: nombre + '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: buf.toString('base64'), filas: r.filas.length };
});

module.exports = { exportar, csv_, celdaSegura_, datos_, TIPOS };
