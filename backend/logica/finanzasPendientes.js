'use strict';

/**
 * Finanzas · estación de pendientes (corrección v2, I08.6, 2026-10-20).
 *
 * Reúne en una sola lista las tareas que ya existen sobre otras entidades:
 * movimientos del banco sin clasificar, registros con datos por completar,
 * posibles duplicados, operaciones sin su banco, cobros sin aplicar, fondos
 * de clientes sin gestión y saldos iniciales por aprobar. No crea copias:
 * cada fila se calcula en el momento desde su origen y abre su pantalla.
 *
 * Orden explicable (no es un puntaje de riesgo): primero lo que impide cerrar
 * el mes, después lo más antiguo y, a igual antigüedad, el importe mayor.
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const FB = require('./finanzasBancos');
const Op = require('./finanzasOperaciones');
const I = FB.interno;

const TIPOS = {
  MOVIMIENTO: { nombre: 'Movimiento del banco sin clasificar', bloquea: true, vista: 'movimientos', texto: 'Clasificar' },
  DUPLICADO: { nombre: 'Posible duplicado', bloquea: true, vista: 'conciliacion', texto: 'Comparar' },
  DATOS: { nombre: 'Datos por completar', bloquea: false, vista: 'registro', texto: 'Completar' },
  SIN_BANCO: { nombre: 'Sin su movimiento del banco', bloquea: false, vista: 'conciliacion', texto: 'Conciliar' },
  COBRO: { nombre: 'Cobro sin aplicar', bloquea: false, vista: 'cobranza', texto: 'Aplicar' },
  FONDOS: { nombre: 'Fondos sin gestión', bloquea: false, vista: 'fondos', texto: 'Asignar' },
  APERTURA: { nombre: 'Saldo inicial por aprobar', bloquea: false, vista: 'fondos', texto: 'Revisar' },
  GASTO_COMPARTIDO: { nombre: 'Gasto compartido por resolver', bloquea: false, vista: 'gastos', texto: 'Resolver' }
};

function dias_(fecha, hoy) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(fecha || ''))) return null;
  return Math.max(0, Math.round((Date.parse(hoy + 'T12:00:00Z') - Date.parse(String(fecha).slice(0, 10) + 'T12:00:00Z')) / 86400000));
}
function item_(tipo, o, hoy) {
  const t = TIPOS[tipo];
  return Object.assign({ tipo, tipo_nombre: t.nombre, bloquea_cierre: t.bloquea, antiguedad_dias: dias_(o.fecha, hoy),
    accion: { vista: t.vista, texto: t.texto, contexto: Object.assign({ periodo: o.periodo || '' }, o.contexto || {}) } }, o, { contexto: undefined });
}

// Cada fuente por separado: si una falla, las demás se muestran y se dice cuál no se pudo leer.
const FUENTES = {
  movimientos(db, hoy) {
    const cuentas = I.cuentasMapa_();
    return I.db_().prepare("SELECT * FROM FIN_MOVIMIENTOS WHERE estado != 'CONFIRMADO' ORDER BY fecha").all().map((r) => {
      const m = I.movimientoPublico_(r, cuentas);
      const d = m || { glosa: '', abono: 0, cargo: 0, cuenta: {} };
      return item_('MOVIMIENTO', { id: 'mov:' + r.id, fecha: r.fecha, periodo: r.periodo, empresa: (d.cuenta || {}).empresa || '', cliente: '', importe: (d.abono || 0) - (d.cargo || 0),
        motivo: (d.glosa || 'Sin glosa') + (d.cuenta && d.cuenta.ultimos4 ? ' · ' + d.cuenta.banco + ' ···' + d.cuenta.ultimos4 : ''), contexto: { periodo: r.periodo } }, hoy);
    });
  },
  registro(db, hoy) {
    const ctxN = FB.contextoNormalizar_(db);
    const filas = I.db_().prepare("SELECT * FROM FIN_OPERACIONES WHERE estado = 'BORRADOR' OR (estado = 'CONFIRMADA' AND conciliacion IN ('SIN_BANCO','PARCIAL')) ORDER BY fecha").all();
    const out = [];
    filas.map(Op.publica_).forEach((o) => {
      const cliente = ((o.distribuciones || [])[0] || {}).cliente || '';
      const base = { fecha: o.fecha, periodo: o.periodo, empresa: o.empresa === 'SIN_EMPRESA' ? '' : o.empresa, cliente, importe: (o.sentido === 'SALIDA' ? -1 : 1) * (o.monto || 0) };
      if (o.estado === 'BORRADOR') {
        const f = Op.faltantesPublicos_(o, ctxN);
        if (f.length) out.push(item_('DATOS', Object.assign({ id: 'op:' + o.id, motivo: (o.tercero || 'Registro') + ' · ' + f.map((x) => x.mensaje || x.campo).join('; '), contexto: { periodo: o.periodo, operacion_id: o.id } }, base), hoy));
      } else {
        out.push(item_('SIN_BANCO', Object.assign({ id: 'sb:' + o.id, motivo: (o.tercero || 'Registro') + (o.conciliacion === 'PARCIAL' ? ' · vinculada en parte con el banco' : ' · confirmada sin su movimiento del banco'), contexto: { periodo: o.periodo } }, base), hoy));
      }
    });
    return out;
  },
  duplicados(db, hoy) {
    return require('./finanzasHechos').conflictos_({}).map((c) => item_('DUPLICADO', { id: 'dup:' + c.operacion_id, fecha: c.fecha, periodo: c.periodo, empresa: c.empresa, cliente: '',
      importe: (c.sentido === 'SALIDA' ? -1 : 1) * (c.monto || 0), motivo: 'Podría ser el mismo dinero que ' + c.movimientos.length + ' movimiento(s) del banco ya clasificado(s)', contexto: { periodo: c.periodo } }, hoy));
  },
  cobros(db, hoy) {
    const out = [];
    require('./finanzasCobranza').cartera_(db).forEach((n) => (n.recepciones || []).forEach((r) => {
      const libre = (r.monto || 0) - (r.aplicado || 0);
      if (libre > 0) out.push(item_('COBRO', { id: 'cob:' + r.ref, fecha: r.fecha, periodo: String(r.fecha || '').slice(0, 7), empresa: r.empresa || '', cliente: n.cliente || '', importe: libre,
        motivo: r.aplicado ? 'Abono aplicado en parte: el resto no está en ninguna factura' : 'Abono sin aplicar a facturas', contexto: { cliente_id: n.cliente_id } }, hoy));
    }));
    return out;
  },
  fondos(db, hoy) {
    const F = require('./finanzasFondos');
    const out = [];
    F.custodiaAl_(hoy, '').clientes.forEach((c) => {
      const ficha = F.fichaCliente_(c.cliente_id, hoy);
      const sg = ficha && ficha.sin_gestion;
      if (sg && sg.saldo > 0) out.push(item_('FONDOS', { id: 'fon:' + c.cliente_id, fecha: ((sg.piezas || []).map((p) => p.fecha).filter(Boolean).sort()[0]) || '', periodo: '', empresa: '', cliente: c.cliente || '', importe: sg.saldo,
        motivo: 'Plata del cliente que todavía no se asigna a una gestión (IVA, imposiciones…)', contexto: { cliente_id: c.cliente_id } }, hoy));
    });
    F.aperturas_({}).filter((a) => a.estado === 'PROPUESTA').forEach((a) => out.push(item_('APERTURA', { id: 'ap:' + a.id, fecha: a.fecha_corte, periodo: String(a.fecha_corte || '').slice(0, 7), empresa: a.empresa || '',
      cliente: a.cliente || '', importe: a.monto || 0, motivo: 'Propuesto por ' + (a.creado_por || '—') + ': falta que otra persona lo apruebe o anule', contexto: { cliente_id: a.cliente_id } }, hoy)));
    return out;
  },
  gastos() {
    // I10.2: sin vincular a su pago no se cuenta; la columna PAZ sin decidir queda como pendiente explícito.
    const hoy = Base.hoy_();
    return require('./finanzasPlanificacion').gastosCompartidos_().filter((g) => g.estado !== 'VINCULADO' || (g.paz && g.paz.pendiente)).map((g) => item_('GASTO_COMPARTIDO', { id: 'gc:' + g.id, fecha: g.periodo ? g.periodo + '-01' : '', periodo: g.periodo, empresa: g.pagadora, cliente: '', importe: -(g.monto || 0),
      motivo: g.concepto + (g.estado !== 'VINCULADO' ? ' · falta vincularlo a su pago (no se cuenta hasta entonces)' : '') + (g.paz && g.paz.pendiente ? ' · columna PAZ de la planilla por decidir' : ''), contexto: { periodo: g.periodo } }, hoy));
  }
};

/**
 * finanzasPendientes { tipo?, periodo? } → { items, por_tipo, fuentes_con_error, orden }.
 * Solo lectura: quien consulta ve lo mismo; las acciones abren la pantalla de origen,
 * donde se aplican los permisos de siempre.
 */
const pendientes = B.conBoveda('', function (db, data) {
  const hoy = Base.hoy_();
  let items = [];
  const errores = [];
  Object.keys(FUENTES).forEach((k) => {
    try { items = items.concat(FUENTES[k](db, hoy)); } catch (e) { errores.push(k); }
  });
  const porTipo = {};
  items.forEach((x) => { porTipo[x.tipo] = (porTipo[x.tipo] || 0) + 1; });
  const tipo = TIPOS[data && data.tipo] ? data.tipo : '';
  const periodo = Base.periodo_(data && data.periodo) || '';
  let lista = items.filter((x) => (!tipo || x.tipo === tipo) && (!periodo || !x.periodo || x.periodo === periodo));
  lista.sort((a, b) => (Number(b.bloquea_cierre) - Number(a.bloquea_cierre)) || ((b.antiguedad_dias || 0) - (a.antiguedad_dias || 0)) || (Math.abs(b.importe) - Math.abs(a.importe)));
  return {
    corte: hoy, items: lista.slice(0, 500), total: lista.length, truncado: lista.length > 500, por_tipo: porTipo,
    tipos: Object.keys(TIPOS).map((k) => ({ id: k, nombre: TIPOS[k].nombre, bloquea_cierre: TIPOS[k].bloquea })),
    fuentes_con_error: errores,
    orden: 'Primero lo que impide cerrar el mes; después lo más antiguo y, a igual antigüedad, el importe mayor.'
  };
});

module.exports = { pendientes, TIPOS };
