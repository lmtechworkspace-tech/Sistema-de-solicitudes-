'use strict';

/**
 * finanzasConciliacion.js — vincular el banco con el registro operativo
 * (2026-10-20; FIN-19, FIN-28/T28).
 *
 * Un movimiento de la cartola es la EVIDENCIA de que la plata entró o salió.
 * Una operación registrada es lo que la operación SABE de esa plata (de qué
 * cliente, obligación, período, destino). Conciliar los une:
 *
 *  - Uno a uno, uno a varios (una transferencia que paga dos operaciones) y
 *    varios a uno (una operación pagada en dos cargos), siempre con montos
 *    EXACTOS: lo del banco suma lo mismo que las operaciones.
 *  - La clasificación de las operaciones pasa al movimiento (sus partes) y la
 *    operación deja de contarse sola: el hecho se cuenta una vez.
 *  - Varias operaciones con varias partes contra varios movimientos: hay que
 *    conciliar por grupos más chicos (no se combinan sumas a ciegas).
 *  - Los candidatos se proponen con su motivo; si hay empate, nadie elige solo.
 *  - Deshacer deja el movimiento como estaba, la operación vuelve a «falta el
 *    banco» y el vínculo queda en la historia como deshecho.
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const FB = require('./finanzasBancos');
const Op = require('./finanzasOperaciones');
const { errorValidacion } = require('./errores');

const I = FB.interno;
const TOLERANCIA_DIAS = 10;

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
function db_() {
  const d = Base.db_();
  if (preparada_ === d) return d;
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_CONCILIACIONES (
    id TEXT PRIMARY KEY, grupo_id TEXT NOT NULL, movimiento_id TEXT NOT NULL, operacion_id TEXT NOT NULL, estado TEXT NOT NULL,
    datos TEXT NOT NULL, creado_en TEXT, creado_por TEXT, deshecho_en TEXT, deshecho_por TEXT)`);
  d.exec('CREATE INDEX IF NOT EXISTS ix_fin_conc_mov ON FIN_CONCILIACIONES (movimiento_id, estado)');
  d.exec('CREATE INDEX IF NOT EXISTS ix_fin_conc_op ON FIN_CONCILIACIONES (operacion_id, estado)');
  preparada_ = d;
  return d;
}

function vinculosDe_(f) {
  const d = db_();
  const filas = f.operacion_id ? d.prepare('SELECT * FROM FIN_CONCILIACIONES WHERE operacion_id = ? ORDER BY creado_en').all(f.operacion_id)
    : f.movimiento_id ? d.prepare('SELECT * FROM FIN_CONCILIACIONES WHERE movimiento_id = ? ORDER BY creado_en').all(f.movimiento_id)
      : d.prepare('SELECT * FROM FIN_CONCILIACIONES WHERE grupo_id = ?').all(f.grupo_id);
  return filas.map((r) => Object.assign({ id: r.id, grupo_id: r.grupo_id, movimiento_id: r.movimiento_id, operacion_id: r.operacion_id, estado: r.estado, creado_en: r.creado_en, creado_por: r.creado_por, deshecho_por: r.deshecho_por || '' },
    (() => { const x = Base.des_(r.datos); return { monto: x.monto, motivo: x.motivo || '' }; })()));
}
function movVinculado_(movId) { return !!db_().prepare("SELECT 1 FROM FIN_CONCILIACIONES WHERE movimiento_id = ? AND estado = 'ACTIVA' LIMIT 1").get(movId); }

function movLeer_(id) {
  const r = I.db_().prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ?').get(String(id));
  return r ? { r, d: I.des_(r.datos) } : null;
}
function cerrado_(p) { try { return require('./finanzasCierre').mesCerrado_(p); } catch (e) { return false; } }

// ---------------------------------------------------------------- candidatos

function puntaje_(op, mov, cuenta) {
  const motivos = [];
  let p = 0;
  const dias = Math.abs(Math.round((Date.parse(mov.r.fecha) - Date.parse(op.fecha)) / 864e5));
  p += Math.max(0, 10 - dias); motivos.push(dias === 0 ? 'misma fecha' : dias + ' día(s) de diferencia');
  if (op.cuenta_ref && op.cuenta_ref === mov.r.cuenta_ref) { p += 5; motivos.push('misma cuenta'); }
  const ref = Base.normalizar_(op.referencia);
  if (ref && (Base.normalizar_(mov.d.doc) === ref || Base.normalizar_(mov.d.glosa).indexOf(ref) !== -1)) { p += 8; motivos.push('referencia ' + op.referencia); }
  const ter = Base.normalizar_(op.tercero);
  const quien = Base.normalizar_([(mov.d.detalle || {}).pagador, (mov.d.detalle || {}).destinatario, mov.d.glosa].join(' '));
  if (ter && ter.length >= 4 && quien.indexOf(ter.slice(0, 13)) !== -1) { p += 6; motivos.push('mismo nombre (' + op.tercero + ')'); }
  if (cuenta && cuenta.empresa === op.empresa) motivos.push('empresa ' + op.empresa);
  return { puntaje: p, motivos, dias };
}

/**
 * Candidatos para un movimiento (operaciones confirmadas sin banco) o para
 * una operación (movimientos no vinculados). Mismo monto exacto, sentido y
 * empresa, a ±N días (parámetro conciliacion_dias, 10; se puede ampliar con
 * f.dias para una demora justificada, hasta 120). `empate` = los dos mejores
 * igualados: la persona elige. Los pares marcados «son distintas» no se proponen.
 */
function diasVentana_(pedido) {
  let base = TOLERANCIA_DIAS;
  try { base = require('./finanzasCatalogos').param_('conciliacion_dias', TOLERANCIA_DIAS); } catch (e) { /* por defecto */ }
  const n = Number(pedido);
  return n > 0 ? Math.min(Math.round(n), 120) : base;
}
function candidatos_(f) {
  const cuentas = I.cuentasMapa_();
  const dias = diasVentana_(f.dias);
  if (f.movimiento_id) {
    const mov = movLeer_(f.movimiento_id);
    if (!mov) return { error: 'El movimiento no existe.' };
    const cu = cuentas.get(mov.r.cuenta_ref) || {};
    // I02: se compara lo DISPONIBLE de cada lado (un vínculo parcial deja el resto por vincular).
    const monto = disponibleMov_(mov), sentido = mov.d.abono > 0 ? 'ENTRADA' : 'SALIDA';
    const ops = Op.publica_ ? Op.hechosRegistro_().filter((h) => h.sin_banco).map((h) => h.operacion_id) : [];
    const lista = [...new Set(ops)].map((id) => Op.porId_(id)).filter((o) => o && o.sentido === sentido && disponibleOp_(o) === monto && o.empresa === cu.empresa &&
      (!o.cuenta_ref || o.cuenta_ref === mov.r.cuenta_ref) && Math.abs(Date.parse(o.fecha) - Date.parse(mov.r.fecha)) <= dias * 864e5 &&
      !(o.distintas || []).some((x) => x.movimiento_id === mov.r.id))
      .map((o) => Object.assign({ operacion_id: o.id, fecha: o.fecha, monto: disponibleOp_(o), monto_total: o.monto, tercero: o.tercero, referencia: o.referencia, version: o.version,
        resumen: (o.distribuciones || []).map((x) => [FB.TIPOS[x.tipo] ? FB.TIPOS[x.tipo].nombre : x.tipo, x.cuenta, x.cliente].filter(Boolean).join(' · ')).join(' + ') }, puntaje_(o, mov, cu)))
      .sort((a, b) => b.puntaje - a.puntaje);
    return { candidatos: lista, empate: lista.length > 1 && lista[0].puntaje === lista[1].puntaje, dias };
  }
  const o = Op.porId_(f.operacion_id);
  if (!o) return { error: 'La operación no existe.' };
  const filas = I.db_().prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE fecha BETWEEN ? AND ?').all(Base.sumarDias_(o.fecha, -dias), Base.sumarDias_(o.fecha, dias));
  const dispO = disponibleOp_(o);
  const lista = filas.map((r) => ({ r, d: I.des_(r.datos) })).filter((m) => {
    const cu = cuentas.get(m.r.cuenta_ref) || {};
    const sentido = m.d.abono > 0 ? 'ENTRADA' : 'SALIDA';
    m.disp = disponibleMov_(m);
    return m.disp === dispO && sentido === o.sentido && cu.empresa === o.empresa && (!o.cuenta_ref || o.cuenta_ref === m.r.cuenta_ref) && m.disp > 0 &&
      !(o.distintas || []).some((x) => x.movimiento_id === m.r.id);
  }).map((m) => Object.assign({ movimiento_id: m.r.id, fecha: m.r.fecha, monto: m.disp, monto_total: m.d.abono || m.d.cargo, glosa: m.d.glosa, estado: m.r.estado, version: m.r.version || 0,
    ya_clasificado: m.r.estado === 'CONFIRMADO' }, puntaje_(o, m, cuentas.get(m.r.cuenta_ref)))).sort((a, b) => b.puntaje - a.puntaje);
  return { candidatos: lista, empate: lista.length > 1 && lista[0].puntaje === lista[1].puntaje, dias };
}

const candidatos = B.conBoveda('', function (db, data) {
  const r = candidatos_({ movimiento_id: Base.txt_(data && data.movimiento_id), operacion_id: Base.txt_(data && data.operacion_id), dias: data && data.dias });
  if (r.error) return errorValidacion('id', r.error);
  return r;
});

// ---------------------------------------------------------------- conciliar

/*
 * Modelo (corrección v2, I02): cada vínculo une UN movimiento con UNA operación
 * por un IMPORTE. Se pueden acumular vínculos (parcial) hasta cubrir el monto
 * de cada lado; nunca más. Cada lado tiene:
 *    disponible = monto − vínculos activos (− remanente explicado, en la operación)
 * Estado de la operación: SIN_BANCO (nada vinculado) · PARCIAL · CONCILIADA.
 * El movimiento se RECONSTRUYE desde sus vínculos activos: una parte por cada
 * (operación, parte de la operación) con su origen_ref y su fecha efectiva; si
 * lo vinculado no cubre todo el movimiento, el resto queda como una parte
 * PENDIENTE (no cuenta, se ve en Por revisar). Sin vínculos, vuelve a como
 * estaba antes del primero (previo).
 */
function linksActivos_(f) {
  const d = db_();
  const filas = f.movimiento_id ? d.prepare("SELECT * FROM FIN_CONCILIACIONES WHERE movimiento_id = ? AND estado = 'ACTIVA' ORDER BY creado_en").all(f.movimiento_id)
    : d.prepare("SELECT * FROM FIN_CONCILIACIONES WHERE operacion_id = ? AND estado = 'ACTIVA' ORDER BY creado_en").all(f.operacion_id);
  return filas.map((r) => Object.assign({ id: r.id, grupo_id: r.grupo_id, movimiento_id: r.movimiento_id, operacion_id: r.operacion_id }, Base.des_(r.datos)));
}
function montoMov_(m) { return m.d.abono || m.d.cargo; }
function disponibleMov_(m) { return montoMov_(m) - linksActivos_({ movimiento_id: m.r.id }).reduce((s, l) => s + l.monto, 0); }
function disponibleOp_(o) { return o.monto - linksActivos_({ operacion_id: o.id }).reduce((s, l) => s + l.monto, 0) - ((o.remanente_explicado && o.remanente_explicado.monto) || 0); }

/** Partes de la operación por un importe (proporcional a sus partes, exacto al peso). */
function partesOp_(o, monto) {
  const dist = o.distribuciones || [];
  const montos = monto === o.monto ? dist.map((p) => p.monto) : Base.repartir_(monto, dist.map((p) => p.monto));
  return dist.map((p, i) => Object.assign({}, p, { monto: montos[i], origen_ref: 'op:' + o.id + ':' + i, fecha_efectiva: o.fecha, operacion_id: o.id })).filter((p) => p.monto > 0);
}
/** Rehace la clasificación del movimiento desde sus vínculos activos. */
function reconstruirMov_(movId, x) {
  const m = movLeer_(movId);
  const links = linksActivos_({ movimiento_id: movId });
  const ahora = Base.ahora_();
  if (!links.length) {
    // Sin vínculos: vuelve a como estaba antes del primero (el previo más antiguo de su historia).
    const primero = db_().prepare('SELECT datos FROM FIN_CONCILIACIONES WHERE movimiento_id = ? ORDER BY creado_en LIMIT 1').get(movId);
    const previo = (primero && Base.des_(primero.datos).previo) || { estado: 'PENDIENTE', clasif: null };
    m.d.clasif = previo.clasif;
    I.db_().prepare('UPDATE FIN_MOVIMIENTOS SET estado = ?, datos = ?, version = COALESCE(version, 0) + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?')
      .run(previo.estado || 'PENDIENTE', I.cif_(m.d), ahora, x.nombre, movId);
    return;
  }
  const partes = [];
  const opsIds = [];
  links.forEach((l) => {
    const o = Op.porId_(l.operacion_id);
    if (!o) return;
    if (opsIds.indexOf(o.id) === -1) opsIds.push(o.id);
    partesOp_(o, l.monto).forEach((p) => { delete p.operacion_id; partes.push(p); });
  });
  const total = montoMov_(m), cubierto = partes.reduce((s, p) => s + p.monto, 0);
  if (cubierto < total) partes.push({ monto: total - cubierto, pendiente: true, nota: 'Resto del movimiento sin vincular' });
  let clasif;
  if (partes.length === 1) { clasif = Object.assign({}, partes[0]); delete clasif.monto; }
  else clasif = { partes, nota: opsIds.map((id) => (Op.porId_(id) || {}).nota).filter(Boolean).join(' · ').slice(0, 300) };
  clasif.operaciones = opsIds; clasif.confirmado_por = x.nombre; clasif.conciliado = true; clasif.parcial = cubierto < total;
  m.d.clasif = clasif;
  const pagador = m.d.detalle && m.d.detalle.pagador;
  if (pagador && m.d.abono > 0 && !m.d.pagador_aprendido) {
    const P = require('./finanzasPagadores');
    P.piezas_(m.d).forEach((p) => { if (p.clasif && p.clasif.cliente_id) P.registrarPagador_(pagador, p.clasif.cliente_id, p.clasif.cliente, 'persona'); });
    m.d.pagador_aprendido = true;
  }
  I.db_().prepare("UPDATE FIN_MOVIMIENTOS SET estado = 'CONFIRMADO', datos = ?, version = COALESCE(version, 0) + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?")
    .run(I.cif_(m.d), ahora, x.nombre, movId);
}
/** Estado de conciliación de la operación según lo vinculado y lo explicado. */
function recalcularOp_(opId, x) {
  const o = Op.porId_(opId);
  if (!o) return;
  const vinc = linksActivos_({ operacion_id: opId }).reduce((s, l) => s + l.monto, 0) + ((o.remanente_explicado && o.remanente_explicado.monto) || 0);
  const estado = vinc >= o.monto ? 'CONCILIADA' : vinc > 0 ? 'PARCIAL' : (['EFECTIVO', 'COMPENSACION'].indexOf(o.medio) !== -1 ? 'NO_APLICA' : 'SIN_BANCO');
  if (estado !== o.conciliacion) Op.marcarConciliacion_(opId, estado, x);
}

/**
 * data: { asignaciones:[{movimiento_id, operacion_id, monto}] }  ← importes explícitos (parcial, varios contra varios)
 *    o  { movimientos:[{id, expected_version}], operaciones:[{id, expected_version}] } ← exacto (1:1, 1:N, N:1)
 * + versiones esperadas (movimientos / operaciones), idempotency_key, motivo.
 * Todo o nada: si una asignación no calza, no se vincula nada.
 */
const conciliar = Base.conCapacidad('CONCILIAR', '', function (db, data, contexto, x) {
  return Base.idempotente_(contexto, 'conciliar', data.idempotency_key, { m: data.movimientos, o: data.operaciones, a: data.asignaciones }, () => Base.transaccion_(() => {
    const cuentas = I.cuentasMapa_();
    const movs = new Map(), ops = new Map();
    const versiones = {};
    (Array.isArray(data.movimientos) ? data.movimientos : []).forEach((it) => { if (it && it.expected_version !== undefined) versiones['m:' + Base.txt_(it.id || it)] = it.expected_version; });
    (Array.isArray(data.operaciones) ? data.operaciones : []).forEach((it) => { if (it && it.expected_version !== undefined) versiones['o:' + Base.txt_(it.id || it)] = it.expected_version; });
    const leerMov = (id) => {
      if (movs.has(id)) return movs.get(id);
      const m = movLeer_(id);
      if (!m) return { error: errorValidacion('movimientos', 'Un movimiento no existe.') };
      // I11.2: vincular AGREGA un vínculo (no reemplaza): lo protegen los importes disponibles, verificados en la misma
      // transacción. La versión, si viene, se compara.
      if (versiones['m:' + id] !== undefined && Number(versiones['m:' + id]) !== Number(m.r.version || 0)) return { error: Base.errConflicto('Un movimiento cambió mientras lo revisabas. Vuelve a abrir la conciliación.') };
      if (cerrado_(m.r.periodo)) return { error: Base.errPeriodoCerrado(m.r.periodo) };
      m.disponible = disponibleMov_(m);
      m.yaClasificado = m.r.estado === 'CONFIRMADO' && !(m.d.clasif && m.d.clasif.conciliado);
      movs.set(id, m);
      return m;
    };
    const leerOp = (id) => {
      if (ops.has(id)) return ops.get(id);
      const o = Op.porId_(id);
      if (!o) return { error: errorValidacion('operaciones', 'Una operación no existe.') };
      if (versiones['o:' + id] !== undefined && Number(versiones['o:' + id]) !== Number(o.version)) return { error: Base.errConflicto('Una operación cambió mientras la revisabas.') };
      if (o.estado !== 'CONFIRMADA') return { error: errorValidacion('operaciones', 'Solo se concilian operaciones confirmadas.') };
      if (o.conciliacion === 'NO_APLICA') return { error: errorValidacion('operaciones', 'Esa operación no pasa por el banco (efectivo o compensación).') };
      if (o.conciliacion === 'CONCILIADA') return { error: errorValidacion('operaciones', 'Esa operación ya está conciliada completa.') };
      // Una operación de un mes cerrado SÍ se puede vincular: su hecho se sigue contando en su fecha efectiva (no cambia el mes cerrado).
      o.disponible = disponibleOp_(o);
      ops.set(id, o);
      return o;
    };
    // Normalizar a asignaciones.
    let asig;
    if (Array.isArray(data.asignaciones) && data.asignaciones.length) {
      asig = data.asignaciones.slice(0, 60).map((a) => ({ movimiento_id: Base.txt_(a.movimiento_id), operacion_id: Base.txt_(a.operacion_id), monto: Base.montoClp_(a.monto) }));
      for (const a of asig) if (!a.monto.ok || !(a.monto.valor > 0)) return errorValidacion('asignaciones', 'Cada asignación necesita un monto mayor que cero.');
      asig.forEach((a) => { a.monto = a.monto.valor; });
    } else {
      const movsIn = (Array.isArray(data.movimientos) ? data.movimientos : []).slice(0, 20).map((it) => Base.txt_(it.id || it));
      const opsIn = (Array.isArray(data.operaciones) ? data.operaciones : []).slice(0, 20).map((it) => Base.txt_(it.id || it));
      if (!movsIn.length || !opsIn.length) return errorValidacion('movimientos', 'Elige al menos un movimiento del banco y una operación.');
      if (movsIn.length > 1 && opsIn.length > 1) return errorValidacion('movimientos', 'Varios movimientos contra varias operaciones: indica cuánto va de cada movimiento a cada operación (asignación explícita).');
      for (const id of movsIn) { const m = leerMov(id); if (m.error) return m.error; }
      for (const id of opsIn) { const o = leerOp(id); if (o.error) return o.error; }
      const totalB = movsIn.reduce((s, id) => s + movs.get(id).disponible, 0), totalO = opsIn.reduce((s, id) => s + ops.get(id).disponible, 0);
      if (totalB !== totalO) return errorValidacion('operaciones', 'El banco suma ' + Base.plata_(totalB) + ' y las operaciones ' + Base.plata_(totalO) + ': diferencia ' + Base.plata_(totalB - totalO) + '. Si es un pago parcial, indica el importe de cada vínculo.');
      asig = movsIn.length === 1 ? opsIn.map((oid) => ({ movimiento_id: movsIn[0], operacion_id: oid, monto: ops.get(oid).disponible }))
        : movsIn.map((mid) => ({ movimiento_id: mid, operacion_id: opsIn[0], monto: movs.get(mid).disponible }));
    }
    // Validar cada asignación y los totales por extremo (en la misma transacción).
    const porMov = new Map(), porOp = new Map();
    for (const a of asig) {
      const m = leerMov(a.movimiento_id); if (m.error) return m.error;
      const o = leerOp(a.operacion_id); if (o.error) return o.error;
      const cu = cuentas.get(m.r.cuenta_ref) || {};
      const sentido = m.d.abono > 0 ? 'ENTRADA' : 'SALIDA';
      if (o.sentido !== sentido) return errorValidacion('operaciones', 'Una operación es ' + (o.sentido === 'ENTRADA' ? 'de entrada' : 'de salida') + ' y el movimiento no.');
      if (o.empresa !== cu.empresa) return errorValidacion('operaciones', 'La operación es de ' + o.empresa + ' y la cuenta del banco es de ' + cu.empresa + '.');
      if (o.cuenta_ref && o.cuenta_ref !== m.r.cuenta_ref) return errorValidacion('operaciones', 'La operación dice otra cuenta bancaria.');
      if ((o.distintas || []).some((y) => y.movimiento_id === m.r.id)) return errorValidacion('operaciones', 'Alguien marcó que esta operación y ese movimiento son pagos DISTINTOS. Quita esa marca antes de conciliarlos.');
      porMov.set(m.r.id, (porMov.get(m.r.id) || 0) + a.monto);
      porOp.set(o.id, (porOp.get(o.id) || 0) + a.monto);
    }
    for (const [id, s] of porMov) {
      const m = movs.get(id);
      if (s > m.disponible) return errorValidacion('asignaciones', 'Al movimiento del ' + m.r.fecha + ' le quedan ' + Base.plata_(m.disponible) + ' por vincular: no alcanza para ' + Base.plata_(s) + '.');
      // Un movimiento que alguien clasificó directo se vincula completo (o se desclasifica antes): no se mezcla su clasificación con la del registro.
      if (m.yaClasificado && s !== montoMov_(m)) return errorValidacion('asignaciones', 'El movimiento del ' + m.r.fecha + ' ya está clasificado por su cuenta: vincúlalo completo o devuélvelo a «por revisar» antes de un vínculo parcial.');
    }
    for (const [id, s] of porOp) {
      const o = ops.get(id);
      if (s > o.disponible) return errorValidacion('asignaciones', 'A la operación de ' + Base.plata_(o.monto) + ' le quedan ' + Base.plata_(o.disponible) + ' por vincular: no alcanza para ' + Base.plata_(s) + '.');
      // Con abonos aplicados a facturas, la operación se vincula completa a un solo movimiento (si no, la aplicación no sabría a qué parte va).
      const aplicada = (() => { try { return require('./finanzasCobranza').recepcionAplicada_('op:' + id); } catch (e) { return false; } })();
      const movsDeOp = new Set(asig.filter((a) => a.operacion_id === id).map((a) => a.movimiento_id));
      if (aplicada && (movsDeOp.size > 1 || s !== o.disponible || o.disponible !== o.monto)) return errorValidacion('operaciones', 'La operación tiene abonos aplicados a facturas y quedaría repartida o parcial: desaplícalos en Cobranza, concilia y vuelve a aplicarlos.');
    }
    const grupo = Base.id_(), ahora = Base.ahora_();
    const ins = db_().prepare('INSERT INTO FIN_CONCILIACIONES (id, grupo_id, movimiento_id, operacion_id, estado, datos, creado_en, creado_por) VALUES (?,?,?,?,?,?,?,?)');
    asig.forEach((a) => {
      const m = movs.get(a.movimiento_id);
      ins.run(Base.id_(), grupo, a.movimiento_id, a.operacion_id, 'ACTIVA', Base.cif_({ monto: a.monto, previo: { estado: m.r.estado, clasif: m.d.clasif || null }, motivo: Base.txt_(data.motivo).slice(0, 300) }), ahora, x.nombre);
    });
    [...porMov.keys()].forEach((id) => reconstruirMov_(id, x));
    [...porOp.keys()].forEach((id) => recalcularOp_(id, x));
    const total = asig.reduce((s, a) => s + a.monto, 0);
    const estados = [...porOp.keys()].map((id) => ({ operacion_id: id, conciliacion: Op.porId_(id).conciliacion, pendiente: disponibleOp_(Op.porId_(id)) }));
    x.registrar('CONCILIAR', porMov.size + ' movimiento(s) ↔ ' + porOp.size + ' operación(es) · ' + Base.plata_(total) + (estados.some((e) => e.conciliacion === 'PARCIAL') ? ' (parcial)' : ''));
    return { grupo_id: grupo, movimientos: porMov.size, operaciones: porOp.size, monto: total, estados,
      remanente_movimientos: [...porMov.keys()].map((id) => ({ movimiento_id: id, pendiente: disponibleMov_(movLeer_(id)) })) };
  }));
});

/**
 * Deshace una conciliación (todo el grupo). Queda en la historia; nada se borra.
 * Antes revisa lo que depende del vínculo: abonos aplicados sobre la parte del
 * banco, y gestión de fondos, préstamo o gasto compartido puestos sobre esa
 * parte DESPUÉS de vincular (si no, se perderían al reconstruir).
 */
const desconciliar = Base.conCapacidad('CONCILIAR', '', function (db, data, contexto, x) {
  const motivo = Base.txt_(data && data.motivo);
  if (motivo.length < 3) return errorValidacion('motivo', 'Escribe por qué se deshace.');
  return Base.transaccion_(() => {
    let grupo = Base.txt_(data.grupo_id);
    if (!grupo && data.movimiento_id) { const v = vinculosDe_({ movimiento_id: Base.txt_(data.movimiento_id) }).find((y) => y.estado === 'ACTIVA'); grupo = v ? v.grupo_id : ''; }
    if (!grupo && data.operacion_id) { const v = vinculosDe_({ operacion_id: Base.txt_(data.operacion_id) }).find((y) => y.estado === 'ACTIVA'); grupo = v ? v.grupo_id : ''; }
    const filas = db_().prepare("SELECT * FROM FIN_CONCILIACIONES WHERE grupo_id = ? AND estado = 'ACTIVA'").all(grupo);
    if (!filas.length) return errorValidacion('grupo_id', 'No hay una conciliación activa para deshacer.');
    const movIds = [...new Set(filas.map((f) => f.movimiento_id))], opIds = [...new Set(filas.map((f) => f.operacion_id))];
    for (const id of movIds) {
      const m = movLeer_(id);
      if (m && cerrado_(m.r.periodo)) return Base.errPeriodoCerrado(m.r.periodo);
      try { if (require('./finanzasCobranza').recepcionAplicada_('mov:' + id)) return errorValidacion('grupo_id', 'El movimiento tiene abonos aplicados a facturas sobre su parte del banco: desaplícalos primero en Cobranza.'); } catch (e) { /* sin cobranza */ }
      // Dependencias puestas sobre la parte del banco después de vincular.
      const partes = m ? require('./finanzasPagadores').piezas_(m.d).map((p) => p.clasif || {}) : [];
      for (const p of partes) {
        if (!p.origen_ref) continue;
        const mm = /^op:([^:]+):(\d+)$/.exec(p.origen_ref);
        const o = mm && Op.porId_(mm[1]);
        const dist = o && (o.distribuciones || [])[Number(mm[2])];
        if (!dist) continue;
        for (const [campo, nombre] of [['gestion_id', 'una gestión de fondos'], ['prestamo_id', 'un préstamo'], ['gasto_compartido_id', 'un gasto compartido']]) {
          if (p[campo] && p[campo] !== dist[campo]) return errorValidacion('grupo_id', 'Después de vincular, la parte del banco se asignó a ' + nombre + '. Quita esa asignación (o pásala a la operación) antes de deshacer.');
        }
      }
    }
    const ahora = Base.ahora_();
    filas.forEach((f) => {
      const datos = Object.assign(Base.des_(f.datos), { motivo_deshacer: motivo.slice(0, 300) });
      db_().prepare("UPDATE FIN_CONCILIACIONES SET estado = 'DESHECHA', datos = ?, deshecho_en = ?, deshecho_por = ? WHERE id = ?").run(Base.cif_(datos), ahora, x.nombre, f.id);
    });
    movIds.forEach((id) => reconstruirMov_(id, x));
    opIds.forEach((id) => recalcularOp_(id, x));
    x.registrar('DESCONCILIAR', movIds.length + ' movimiento(s) ↔ ' + opIds.length + ' operación(es): ' + motivo.slice(0, 80));
    return { grupo_id: grupo, movimientos: movIds.length, operaciones: opIds.length };
  });
});

/**
 * Explicar el remanente de una operación parcialmente vinculada (I02.1): la
 * diferencia NO llegó al banco por un componente comprobado (comisión,
 * retención…). Se registra ese componente como su propia operación (medio
 * COMPENSACIÓN: no es caja) con fuente, y la operación queda conciliada.
 * Nunca es un redondeo automático. data: { operacion_id, expected_version,
 * cuenta (concepto de gasto), motivo, respaldo }
 */
const explicarRemanente = Base.conCapacidad('CONCILIAR', '', function (db, data, contexto, x) {
  return Base.transaccion_(() => {
    const o = Op.porId_(Base.txt_(data && data.operacion_id));
    if (!o) return errorValidacion('operacion_id', 'Esa operación no existe.');
    if (data.expected_version === undefined || Number(data.expected_version) !== Number(o.version)) return Base.errConflicto('La operación cambió mientras la revisabas.');
    if (o.conciliacion !== 'PARCIAL') return errorValidacion('operacion_id', 'Solo se explica el resto de una operación vinculada en parte con el banco.');
    const resto = disponibleOp_(o);
    if (!(resto > 0)) return errorValidacion('operacion_id', 'No queda resto por explicar.');
    const motivo = Base.txt_(data.motivo).slice(0, 300), respaldo = Base.txt_(data.respaldo).slice(0, 200);
    if (motivo.length < 3 || respaldo.length < 3) return errorValidacion(motivo.length < 3 ? 'motivo' : 'respaldo', 'Escribe qué es la diferencia y su respaldo (liquidación del banco, comprobante de retención…).');
    const comp = Op.guardarInterno_(db, { empresa: o.empresa, fecha: o.fecha, sentido: 'SALIDA', medio: 'COMPENSACION', monto: resto, tercero: o.tercero, referencia: o.referencia,
      nota: 'Diferencia de la operación de ' + Base.plata_(o.monto) + ' del ' + o.fecha + ': ' + motivo, tipo: 'EGRESO', cuenta: Base.txt_(data.cuenta), confirmar: true,
      origen: { tipo: 'REMANENTE', operacion_id: o.id, respaldo } }, contexto, x, require('./finanzasBancos').contextoNormalizar_(db));
    if (comp && comp._validationError) return comp;
    Op.explicarRemanente_(o.id, { monto: resto, componente_id: comp.id, motivo, respaldo, por: x.nombre, en: Base.ahora_() }, x);
    recalcularOp_(o.id, x);
    x.registrar('CONCILIAR_REMANENTE', Base.plata_(resto) + ' · ' + motivo.slice(0, 80));
    return { operacion_id: o.id, componente_id: comp.id, monto: resto, conciliacion: Op.porId_(o.id).conciliacion };
  });
});

/**
 * La bandeja de conciliación de un período: movimientos del banco sin vínculo
 * (pendientes o clasificados directo) y operaciones confirmadas sin banco,
 * con la pareja sugerida cuando es ÚNICA y sin empate.
 */
const bandeja = B.conBoveda('VER_CONCILIACION', function (db, data) {
  const periodo = Base.periodo_(data && data.periodo) || Base.mesAnterior_(Base.hoy_().slice(0, 7));
  const cuentas = I.cuentasMapa_();
  const dias = diasVentana_(data && data.dias);
  const desde = Base.sumarDias_(periodo + '-01', -dias), hasta = Base.sumarDias_(Base.ultimoDia_(periodo), dias);
  const ops = Op.hechosRegistro_().filter((h) => h.sin_banco && h.fecha >= desde && h.fecha <= hasta).map((h) => h.operacion_id);
  const opsLista = [...new Set(ops)].map((id) => Op.porId_(id)).filter(Boolean).map((o) => { delete o._fila; return Object.assign(o, { disponible: disponibleOp_(o) }); });
  const movs = I.db_().prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE periodo = ? ORDER BY fecha, orden').all(periodo)
    .map((r) => { const disp = disponibleMov_({ r, d: I.des_(r.datos) }); return disp > 0 ? Object.assign(FB.movimientoPublico_(r, cuentas), { disponible: disp, parcial: disp < (I.des_(r.datos).abono || I.des_(r.datos).cargo) }) : null; })
    .filter(Boolean);
  const sugeridas = [];
  const usadas = new Set();
  movs.forEach((m) => {
    const c = candidatos_({ movimiento_id: m.id, dias });
    if (c.candidatos && c.candidatos.length && !c.empate && !usadas.has(c.candidatos[0].operacion_id)) {
      sugeridas.push({ movimiento_id: m.id, operacion_id: c.candidatos[0].operacion_id, motivos: c.candidatos[0].motivos });
      usadas.add(c.candidatos[0].operacion_id);
    }
  });
  const conciliados = db_().prepare("SELECT COUNT(DISTINCT movimiento_id) AS n FROM FIN_CONCILIACIONES WHERE estado = 'ACTIVA'").get().n;
  const conflictos = require('./finanzasHechos').conflictos_({}).filter((c) => c.fecha >= desde && c.fecha <= hasta)
    .map((c) => ({ operacion_id: c.operacion_id, fecha: c.fecha, monto: c.monto, sentido: c.sentido, empresa: c.empresa, movimientos: c.movimientos.map((mm) => mm.id) }));
  return { periodo, dias, movimientos: movs, operaciones: opsLista, sugeridas, conflictos, conciliados_total: conciliados };
});

/**
 * «Son distintas» / quitar esa marca (corrección v2, I01). data: { operacion_id,
 * movimiento_id, motivo, expected_version, quitar }. Con la marca, el par deja
 * de ser «posible duplicado» y cuentan los dos; no se puede conciliar ese par.
 */
const marcarDistintas = Base.conCapacidad('CONCILIAR', '', function (db, data, contexto, x) {
  return Base.transaccion_(() => {
    const o = Op.porId_(Base.txt_(data && data.operacion_id));
    if (!o) return errorValidacion('operacion_id', 'Esa operación no existe.');
    const m = movLeer_(Base.txt_(data.movimiento_id));
    if (!m) return errorValidacion('movimiento_id', 'Ese movimiento no existe.');
    if (data.expected_version === undefined || data.expected_version === null || data.expected_version === '') return errorValidacion('expected_version', 'Falta la versión de la operación que revisaste.');
    if (Number(data.expected_version) !== Number(o.version)) return Base.errConflicto('La operación cambió mientras la revisabas.');
    if (cerrado_(o.periodo)) return Base.errPeriodoCerrado(o.periodo);
    const motivo = Base.txt_(data.motivo).slice(0, 300);
    if (!data.quitar && motivo.length < 3) return errorValidacion('motivo', 'Escribe por qué son pagos distintos (p. ej. dos cuotas del mismo mes).');
    if (!data.quitar && movVinculado_(m.r.id)) return errorValidacion('movimiento_id', 'Ese movimiento ya está conciliado con otra operación.');
    const version = Op.marcarDistinta_(o.id, m.r.id, motivo, !!data.quitar, x);
    x.registrar(data.quitar ? 'IDENTIDAD_QUITAR_DISTINTA' : 'IDENTIDAD_DISTINTAS', Base.plata_(o.monto) + ' · ' + o.fecha + (motivo ? ': ' + motivo.slice(0, 80) : ''));
    return { operacion_id: o.id, movimiento_id: m.r.id, version, distintas: !data.quitar };
  });
});

/** Para el motor de sugerencias: operaciones sin banco por empresa (se arma una vez). */
function opsSinBanco_() {
  const out = [];
  try { new Set(Op.hechosRegistro_().filter((h) => h.sin_banco).map((h) => h.operacion_id)).forEach((id) => { const o = Op.porId_(id); if (o) out.push(o); }); } catch (e) { /* sin operaciones */ }
  return out;
}
function reiniciar_() { preparada_ = null; }

module.exports = { candidatos, conciliar, desconciliar, bandeja, marcarDistintas, explicarRemanente, linksActivos_, disponibleOp_, vinculosDe_, candidatos_, opsSinBanco_, movVinculado_, reiniciar_ };
