'use strict';

/**
 * finanzasPlanificacion.js — lo que en SIGECO eran hojas propias y no es un
 * movimiento del banco (2026-10-20; FIN-25 a FIN-30; hojas GASTOS
 * COMPARTIDOS, PRÉSTAMOS INTERCO y PROYECTOS).
 *
 *  - GASTOS COMPARTIDOS: un gasto que paga una empresa y se reparte entre
 *    varias (partes iguales, porcentaje o monto fijo; los pesos del redondeo
 *    se entregan con un criterio fijo y visible). Un registro NO es otra
 *    salida de dinero: se VINCULA al pago del banco (o del registro
 *    operativo) y el reparto queda en ese pago. Sin vínculo, se ve como
 *    «falta vincular» y no se suma a nada. La columna PAZ de la planilla se
 *    conserva como destinatario pendiente de identificar: no se crea una
 *    empresa por suposición.
 *  - PRÉSTAMOS: ficha con origen, destino, monto, fecha, devoluciones y saldo.
 *    I10.2: se distingue lo PLANIFICADO (la ficha), lo DESEMBOLSADO y lo
 *    DEVUELTO con su evidencia (banco o registro), y el SALDO RECONOCIDO
 *    (desembolsado − devuelto). Sin desembolso vinculado no se reconoce deuda,
 *    pero tampoco se da por ficticio: queda «sin desembolso vinculado».
 *    Los movimientos (las dos piernas, si están las dos cuentas) se vinculan a
 *    la ficha; el saldo sale de la ficha y de las devoluciones, contadas una
 *    vez aunque se vean en las dos cuentas.
 *  - PROYECTOS: los de SIGSO (módulo Proyectos) y los de la planilla que no
 *    existan allí. Inversión prevista ≠ real; ingresos atribuidos (por la
 *    dimensión proyecto de cada movimiento) ≠ recuperación (fórmula visible).
 *  - PROVISIONES (Vacaciones, Años de Servicio): registro sin caja, con
 *    método/fuente y aprobación; un pago posterior se relaciona sin duplicar.
 *  - COMPROMISOS y PROYECCIÓN: lo conocido (confirmado), lo recurrente y lo
 *    estimado, separados; la proyección muestra sus supuestos y no se mezcla
 *    con lo realizado.
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const Cat = require('./finanzasCatalogos');
const FB = require('./finanzasBancos');
const { errorValidacion } = require('./errores');

const I = FB.interno;

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
function db_() {
  const d = Base.db_();
  if (preparada_ === d) return d;
  const t = (nombre, extra) => `CREATE TABLE IF NOT EXISTS ${nombre} (id TEXT PRIMARY KEY, ${extra}, version INTEGER NOT NULL DEFAULT 1, datos TEXT NOT NULL, clave_origen TEXT,
    creado_en TEXT, creado_por TEXT, actualizado_en TEXT, actualizado_por TEXT)`;
  [
    t('FIN_GASTOS_COMPARTIDOS', 'periodo TEXT, estado TEXT NOT NULL, pagadora TEXT'),
    t('FIN_PRESTAMOS', 'origen TEXT NOT NULL, destino TEXT NOT NULL, fecha TEXT, estado TEXT NOT NULL'),
    t('FIN_PROYECTOS_LEGADO', 'codigo TEXT NOT NULL, estado TEXT'),
    t('FIN_PROVISIONES', 'periodo TEXT NOT NULL, empresa TEXT NOT NULL, concepto TEXT NOT NULL, estado TEXT NOT NULL'),
    t('FIN_COMPROMISOS', 'fecha TEXT NOT NULL, empresa TEXT NOT NULL, estado TEXT NOT NULL, tipo TEXT NOT NULL, sentido TEXT NOT NULL, recurrencia TEXT NOT NULL')
  ].forEach((sql) => d.exec(sql));
  ['FIN_GASTOS_COMPARTIDOS', 'FIN_PRESTAMOS', 'FIN_PROYECTOS_LEGADO', 'FIN_PROVISIONES', 'FIN_COMPROMISOS'].forEach((tb) =>
    d.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_' + tb.toLowerCase() + '_origen ON ' + tb + ' (clave_origen) WHERE clave_origen IS NOT NULL'));
  preparada_ = d;
  return d;
}
function filas_(tabla, donde, args) {
  return db_().prepare('SELECT * FROM ' + tabla + (donde ? ' WHERE ' + donde : '') + ' ORDER BY creado_en').all(...(args || []))
    .map((r) => Object.assign({}, r, Base.des_(r.datos), { datos: undefined }));
}
function exigirVersion_(fila, esperada) {
  // I11.2: actualizar sin la versión vista no se permite (antes se aceptaba y podía sobrescribir).
  if (esperada === undefined || esperada === null || esperada === '') return Base.errVersionRequerida_();
  return Number(esperada) === Number(fila.version) ? null : Base.errConflicto(undefined, { actual: { version: fila.version, actualizado_por: fila.actualizado_por } });
}
/** Inserta o actualiza (con versión) una fila de estas tablas. */
function upsert_(tabla, data, columnas, datos, x, opciones) {
  opciones = opciones || {};
  const d = db_(), ahora = Base.ahora_();
  if (data.id) {
    const r = d.prepare('SELECT * FROM ' + tabla + ' WHERE id = ?').get(Base.txt_(data.id));
    if (!r) return errorValidacion('id', 'No existe.');
    const e = exigirVersion_(r, data.expected_version); if (e) return e;
    const previo = Base.des_(r.datos);
    datos.historial = (previo.historial || []).concat([{ en: ahora, por: x.nombre, version: r.version }]).slice(-30);
    datos.origen = previo.origen || datos.origen;
    const sets = Object.keys(columnas).map((k) => k + ' = ?').join(', ');
    d.prepare('UPDATE ' + tabla + ' SET ' + (sets ? sets + ', ' : '') + 'datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?')
      .run(...Object.values(columnas), Base.cif_(datos), ahora, x.nombre, r.id);
    return { id: r.id, version: r.version + 1 };
  }
  const id = Base.id_();
  const cols = Object.keys(columnas);
  try {
    d.prepare('INSERT INTO ' + tabla + ' (id, ' + cols.join(', ') + (cols.length ? ', ' : '') + 'version, datos, clave_origen, creado_en, creado_por, actualizado_en, actualizado_por) VALUES (' +
      ['?'].concat(cols.map(() => '?')).join(', ') + ', 1, ?, ?, ?, ?, ?, ?)')
      .run(id, ...Object.values(columnas), Base.cif_(datos), opciones.clave_origen || null, ahora, x.nombre, ahora, x.nombre);
  } catch (e) { if (/UNIQUE/.test(e.message) && opciones.clave_origen) return { id: '', repetido: true }; throw e; }
  return { id, version: 1 };
}

// ================================================================ GASTOS COMPARTIDOS (FIN-25)

/** Vista previa de un reparto: cuánto le toca a cada empresa, con el criterio del redondeo. */
const previsualizarReparto = B.conBoveda('', function (db, data) {
  const m = Base.montoClp_(data && data.monto);
  if (!m.ok || !(m.valor > 0)) return errorValidacion('monto', m.error || 'Monto no válido.');
  const n = FB.normalizarReparto_(data.reparto, m.valor);
  if (n.error) return errorValidacion('reparto', n.error);
  if (!n.reparto) return errorValidacion('reparto', 'Elige al menos dos empresas.');
  const partes = FB.partesReparto_(n.reparto, m.valor);
  return { monto: m.valor, modo: n.reparto.modo, partes, suma: partes.reduce((s, p) => s + p.monto, 0),
    criterio: n.reparto.modo === 'FIJO' ? 'Montos fijos escritos.' : 'Se reparte hacia abajo y cada peso que sobra va a la parte con mayor resto (en empate, en el orden de la lista).' };
});

function gastoPublico_(g) {
  return { id: g.id, periodo: g.periodo || '', estado: g.estado, pagadora: g.pagadora || '', version: g.version, concepto: g.concepto, monto: g.monto, reparto: g.reparto,
    partes: g.reparto ? FB.partesReparto_(g.reparto, g.monto) : [], paz: g.paz || null, obs: g.obs || '', vinculo: g.vinculo || null, origen: g.origen || null,
    actualizado_por: g.actualizado_por };
}
/** Gastos compartidos vigentes (para la estación de pendientes). */
function gastosCompartidos_() { return filas_('FIN_GASTOS_COMPARTIDOS', "estado != 'ANULADO'").map(gastoPublico_); }
const gastosCompartidos = B.conBoveda('VER_PLANIFICACION', function (db, data) {
  const periodo = Base.periodo_(data && data.periodo) || '';
  const lista = filas_('FIN_GASTOS_COMPARTIDOS', periodo ? "periodo = ? AND estado != 'ANULADO'" : "estado != 'ANULADO'", periodo ? [periodo] : []).map(gastoPublico_);
  return { periodo, gastos: lista, repartos: Cat.lista_('REPARTO') };
});
function guardarGasto_(db, data, x, opciones) {
  const periodo = Base.periodo_(data.periodo);
  if (!periodo) return errorValidacion('periodo', 'Indica el mes (AAAA-MM).');
  const pagadora = Cat.empresa_(data.pagadora);
  if (!pagadora) return errorValidacion('pagadora', 'Indica qué empresa paga.');
  const m = Base.montoClp_(data.monto);
  if (!m.ok || !(m.valor > 0)) return errorValidacion('monto', m.error || 'Monto no válido.');
  const n = FB.normalizarReparto_(data.reparto, m.valor);
  if (n.error) return errorValidacion('reparto', n.error);
  if (!n.reparto) return errorValidacion('reparto', 'Un gasto compartido se reparte entre 2 o más empresas.');
  const concepto = Base.txt_(data.concepto).slice(0, 160);
  if (!concepto) return errorValidacion('concepto', 'Escribe el concepto.');
  const datos = { concepto, monto: m.valor, reparto: n.reparto, obs: Base.txt_(data.obs).slice(0, 500), paz: data.paz || null, origen: data.origen || null };
  return upsert_('FIN_GASTOS_COMPARTIDOS', data, { periodo, estado: Base.txt_(data.estado) || 'REGISTRADO', pagadora }, datos, x, opciones);
}
const guardarGastoCompartido = Base.conCapacidad('PLANIFICAR', '', function (db, data, contexto, x) {
  const r = guardarGasto_(db, data, x);
  if (!r._validationError) x.registrar('GASTO_COMPARTIDO', Base.txt_(data.concepto).slice(0, 60));
  return r;
});
/**
 * Vincula un gasto compartido con su pago (pieza de un EGRESO del banco u
 * operación): el reparto pasa a esa pieza y el registro queda VINCULADO. El
 * gasto se cuenta UNA vez: por el pago, ya repartido.
 */
const vincularGasto = Base.conCapacidad('PLANIFICAR', '', function (db, data, contexto, x) {
  return Base.transaccion_(() => {
    const r = db_().prepare('SELECT * FROM FIN_GASTOS_COMPARTIDOS WHERE id = ?').get(Base.txt_(data && data.id));
    if (!r) return errorValidacion('id', 'Ese gasto no existe.');
    const g = Object.assign({}, r, Base.des_(r.datos));
    const ref = Base.txt_(data.ref);
    const h = require('./finanzasHechos').todos_().find((y) => y.ref === ref);
    if (!h || !h.clasif) return errorValidacion('ref', 'Ese pago no existe o no está confirmado.');
    if (h.clasif.tipo !== 'EGRESO') return errorValidacion('ref', 'Solo se vincula a un gasto de la empresa.');
    if (h.cargo !== g.monto) return errorValidacion('ref', 'El pago es de ' + Base.plata_(h.cargo) + ' y el gasto de ' + Base.plata_(g.monto) + '.');
    if (h.empresa !== r.pagadora) return errorValidacion('ref', 'El pago es de ' + h.empresa + ' y el gasto dice que paga ' + r.pagadora + '.');
    const err = require('./finanzasFondos').actualizarPieza_(ref, (c) => { c.reparto = g.reparto; c.gasto_compartido_id = r.id; return ''; }, x);
    if (err) return errorValidacion('ref', err);
    const datos = Base.des_(r.datos); datos.vinculo = { ref, en: Base.ahora_(), por: x.nombre };
    db_().prepare("UPDATE FIN_GASTOS_COMPARTIDOS SET estado = 'VINCULADO', datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?").run(Base.cif_(datos), Base.ahora_(), x.nombre, r.id);
    x.registrar('GASTO_COMPARTIDO_VINCULAR', g.concepto.slice(0, 60));
    return { ok: true };
  });
});

// ================================================================ PRÉSTAMOS (FIN-26)

/** Saldo de cada préstamo: monto − devoluciones (cada devolución se cuenta una vez aunque esté en las dos cuentas). */
function saldosPrestamos_() {
  const piezas = (() => { try { return require('./finanzasHechos').hechos_({ soloConfirmados: true }).filter((h) => h.clasif && h.clasif.prestamo_id); } catch (e) { return []; } })();
  return filas_('FIN_PRESTAMOS', "estado != 'ANULADO'").map((p) => {
    const mias = piezas.filter((h) => h.clasif.prestamo_id === p.id);
    const lado = (rol, empresa, campo) => mias.filter((h) => (h.clasif.rol_prestamo || 'DESEMBOLSO') === rol && h.empresa === empresa).reduce((s, h) => s + h[campo], 0);
    // Desembolso: sale de origen (cargo) y entra a destino (abono). Devolución: sale de destino y entra a origen.
    const desembolsoBanco = Math.max(lado('DESEMBOLSO', p.origen, 'cargo'), lado('DESEMBOLSO', p.destino, 'abono'));
    const devuelto = Math.max(lado('DEVOLUCION', p.destino, 'cargo'), lado('DEVOLUCION', p.origen, 'abono'));
    const evidencias = mias.map((h) => ({ ref: h.ref, fuente: h.fuente === 'BANCO' ? 'Banco' : 'Registro', rol: h.clasif.rol_prestamo || 'DESEMBOLSO', empresa: h.empresa, fecha: h.fecha, monto: h.cargo || h.abono }));
    const estadoReal = p.estado === 'ANULADO' ? 'ANULADO' : !desembolsoBanco ? 'SIN_DESEMBOLSO' : devuelto >= desembolsoBanco ? 'DEVUELTO' : devuelto > 0 ? 'DEVUELTO_EN_PARTE' : 'DESEMBOLSADO';
    return { id: p.id, origen: p.origen, destino: p.destino, fecha: p.fecha || '', estado: p.estado, monto: p.monto, concepto: p.concepto, devuelto, saldo: p.monto - devuelto,
      planificado: p.monto, desembolsado: desembolsoBanco, saldo_reconocido: desembolsoBanco ? desembolsoBanco - devuelto : null, estado_real: estadoReal, evidencias,
      desembolso_banco: desembolsoBanco, diferencia_banco: desembolsoBanco ? p.monto - desembolsoBanco : null, piernas: mias.length, version: p.version,
      fecha_devolucion: p.fecha_devolucion || '', obs: p.obs || '', origen_dato: p.origen_dato || null };
  });
}
const prestamos = B.conBoveda('VER_PLANIFICACION', function () {
  const lista = saldosPrestamos_();
  const vivos = lista.filter((p) => p.estado !== 'PAGADO' && p.estado !== 'ANULADO');
  return { prestamos: lista, total_saldo: lista.filter((p) => p.estado !== 'PAGADO').reduce((s, p) => s + p.saldo, 0),
    // I10.2: la deuda reconocida (con desembolso vinculado) y lo planificado sin desembolso, por separado.
    total_reconocido: vivos.reduce((s, p) => s + (p.saldo_reconocido || 0), 0), total_sin_desembolso: vivos.filter((p) => p.estado_real === 'SIN_DESEMBOLSO').reduce((s, p) => s + p.monto, 0) };
});
function guardarPrestamo_(db, data, x, opciones) {
  const origen = Cat.empresa_(data.origen), destino = Cat.empresa_(data.destino);
  if (!origen || !destino || origen === destino) return errorValidacion('destino', 'Elige dos empresas distintas del grupo.');
  const m = Base.montoClp_(data.monto);
  if (!m.ok || !(m.valor > 0)) return errorValidacion('monto', m.error || 'Monto no válido.');
  const fecha = Base.fechaCivil_(data.fecha);
  if (Base.txt_(data.fecha) && !fecha) return errorValidacion('fecha', 'Fecha no válida.');
  const estado = ['VIGENTE', 'PAGADO', 'ANULADO'].indexOf(Base.txt_(data.estado).toUpperCase()) !== -1 ? Base.txt_(data.estado).toUpperCase() : 'VIGENTE';
  const datos = { monto: m.valor, concepto: Base.txt_(data.concepto).slice(0, 160), fecha_devolucion: Base.fechaCivil_(data.fecha_devolucion), obs: Base.txt_(data.obs).slice(0, 500), origen_dato: data.origen_dato || null, estado_legado: Base.txt_(data.estado_legado) };
  return upsert_('FIN_PRESTAMOS', data, { origen, destino, fecha: fecha || null, estado }, datos, x, opciones);
}
const guardarPrestamo = Base.conCapacidad('PLANIFICAR', '', function (db, data, contexto, x) {
  const r = guardarPrestamo_(db, data, x);
  if (!r._validationError) x.registrar('PRESTAMO', Cat.empresa_(data.origen) + ' → ' + Cat.empresa_(data.destino));
  return r;
});
/** Vincula una pierna (pieza PRESTAMO del banco o registro) a un préstamo, como desembolso o devolución. */
const vincularPrestamo = Base.conCapacidad('PLANIFICAR', '', function (db, data, contexto, x) {
  const p = filas_('FIN_PRESTAMOS', 'id = ?', [Base.txt_(data && data.prestamo_id)])[0];
  if (!p) return errorValidacion('prestamo_id', 'Ese préstamo no existe.');
  const rol = Base.txt_(data.rol).toUpperCase() === 'DEVOLUCION' ? 'DEVOLUCION' : 'DESEMBOLSO';
  const ref = Base.txt_(data.ref);
  const h = require('./finanzasHechos').todos_().find((y) => y.ref === ref);
  if (!h || !h.clasif || h.clasif.tipo !== 'PRESTAMO') return errorValidacion('ref', 'Solo se vincula un movimiento clasificado como préstamo.');
  if ([p.origen, p.destino].indexOf(h.empresa) === -1 || [p.origen, p.destino].indexOf(h.clasif.empresa) === -1) return errorValidacion('ref', 'Ese movimiento es entre otras empresas.');
  // I10.2: una devolución no puede dejar el préstamo devolviendo más de lo desembolsado (si ya hay desembolso vinculado).
  if (!data.quitar && rol === 'DEVOLUCION') {
    const s = saldosPrestamos_().find((y) => y.id === p.id) || {};
    const monto = h.cargo || h.abono;
    const yaEsta = (s.evidencias || []).some((e) => e.ref === ref);
    // Las dos piernas de una misma devolución se cuentan una vez: solo se valida si esta pierna sube lo devuelto.
    const otraPierna = (s.evidencias || []).some((e) => e.rol === 'DEVOLUCION' && e.monto === monto && e.empresa !== h.empresa);
    if (!yaEsta && !otraPierna && s.desembolsado && s.devuelto + monto > s.desembolsado) return errorValidacion('ref', 'Esa devolución (' + Base.plata_(monto) + ') supera lo que queda por devolver (' + Base.plata_(s.desembolsado - s.devuelto) + ').');
  }
  const err = require('./finanzasFondos').actualizarPieza_(ref, (c) => { if (data.quitar) { delete c.prestamo_id; delete c.rol_prestamo; } else { c.prestamo_id = p.id; c.rol_prestamo = rol; } return ''; }, x);
  if (err) return errorValidacion('ref', err);
  x.registrar('PRESTAMO_VINCULAR', p.origen + ' → ' + p.destino + ' · ' + rol);
  return { ok: true };
});

// ================================================================ PROYECTOS (FIN-27)

/** Proyectos de la planilla que no están en SIGSO (id 'leg:<código>'), para usarlos como dimensión. */
function proyectosLegado_() {
  try { return filas_('FIN_PROYECTOS_LEGADO').filter((p) => !p.sigso_id).map((p) => ({ id: 'leg:' + p.codigo, codigo: p.codigo, nombre: p.nombre, estado: p.estado || '' })); } catch (e) { return []; }
}
function guardarProyectoLegado_(db, data, x, opciones) {
  const codigo = Base.txt_(data.codigo).slice(0, 20);
  if (!codigo) return errorValidacion('codigo', 'Falta el ID del proyecto.');
  const nombre = Base.txt_(data.nombre).slice(0, 160);
  if (!nombre) return errorValidacion('nombre', 'Falta el nombre.');
  let inv = null;
  if (Base.txt_(data.inversion_presupuestada) !== '') {
    const v = Base.montoExcel_(data.inversion_presupuestada); const m = v !== null ? { ok: true, valor: v } : Base.montoClp_(data.inversion_presupuestada);
    if (!m.ok) return errorValidacion('inversion_presupuestada', m.error);
    inv = m.valor;
  }
  const datos = { codigo, nombre, tipo: Base.txt_(data.tipo).slice(0, 60), empresa: Cat.empresa_(data.empresa) || Base.txt_(data.empresa), inversion_presupuestada: inv,
    fecha_inicio: Base.fechaCivil_(data.fecha_inicio), obs: Base.txt_(data.obs).slice(0, 500), sigso_id: Base.txt_(data.sigso_id), origen: data.origen || null };
  return upsert_('FIN_PROYECTOS_LEGADO', data, { codigo, estado: Base.txt_(data.estado).slice(0, 40) }, datos, x, opciones);
}
const guardarProyecto = Base.conCapacidad('PLANIFICAR', '', function (db, data, contexto, x) {
  const r = guardarProyectoLegado_(db, data, x);
  if (!r._validationError) x.registrar('PROYECTO_FINANZAS', Base.txt_(data.codigo) + ' ' + Base.txt_(data.nombre).slice(0, 60));
  return r;
});
/**
 * Cada proyecto con: inversión prevista (planilla o presupuesto del módulo
 * Proyectos), inversión real (gastos con ese proyecto), ingresos atribuidos
 * (ingresos con ese proyecto) y recuperación = atribuidos / real, SOLO si hay
 * inversión real (si no, «sin base»). Fórmulas a la vista.
 */
const proyectos = B.conBoveda('VER_PLANIFICACION', function (db) {
  const H = require('./finanzasHechos');
  const piezas = H.hechos_({ soloConfirmados: true }).filter((h) => h.clasif && h.clasif.proyecto_id);
  const sigso = FB.proyectosSigso_(db);
  const legado = filas_('FIN_PROYECTOS_LEGADO');
  let asign = [];
  try { asign = require('./finanzasClientes').asignaciones_(); } catch (e) { asign = []; }
  const lista = sigso.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, estado: p.estado, fuente: 'SIGSO', inversion_prevista: p.presupuesto || null }))
    .concat(legado.map((p) => ({ id: p.sigso_id || 'leg:' + p.codigo, codigo: p.codigo, nombre: p.nombre, estado: p.estado || '', fuente: p.sigso_id ? 'SIGSO + planilla' : 'Planilla SIGECO', inversion_prevista: p.inversion_presupuestada, tipo: p.tipo, empresa: p.empresa, fecha_inicio: p.fecha_inicio, obs: p.obs, legado_id: p.id, legado_version: p.version })));
  const unicos = new Map();
  lista.forEach((p) => { const prev = unicos.get(p.id); unicos.set(p.id, prev ? Object.assign(prev, p, { inversion_prevista: p.inversion_prevista != null ? p.inversion_prevista : prev.inversion_prevista }) : p); });
  return {
    formulas: { inversion_real: 'Suma de gastos de la empresa con ese proyecto', ingresos_atribuidos: 'Suma de ingresos de la empresa con ese proyecto', recuperacion: 'Ingresos atribuidos ÷ inversión real (sin inversión real: sin base)' },
    proyectos: [...unicos.values()].map((p) => {
      const mias = piezas.filter((h) => h.clasif.proyecto_id === p.id);
      const real = mias.filter((h) => h.clasif.tipo === 'EGRESO').reduce((s, h) => s + h.cargo, 0);
      const atrib = mias.filter((h) => h.clasif.tipo === 'INGRESO').reduce((s, h) => s + h.abono, 0);
      return Object.assign(p, { inversion_real: real, ingresos_atribuidos: atrib, recuperacion_pct: real > 0 ? Math.round(atrib / real * 1000) / 10 : null,
        avance_inversion_pct: p.inversion_prevista ? Math.round(real / p.inversion_prevista * 1000) / 10 : null,
        clientes_asignados: asign.filter((a) => a.proyecto_id === p.id && a.estado === 'VIGENTE').map((a) => ({ cliente_id: a.cliente_id, porcentaje: a.porcentaje, desde: a.desde, hasta: a.hasta })) });
    })
  };
});

// ================================================================ PROVISIONES (FIN-29)

const provisiones = B.conBoveda('VER_PLANIFICACION', function (db, data) {
  const anio = Base.txt_(data && data.anio);
  const lista = filas_('FIN_PROVISIONES', anio ? "periodo LIKE ? AND estado != 'ANULADA'" : "estado != 'ANULADA'", anio ? [anio + '-%'] : [])
    .map((p) => ({ id: p.id, periodo: p.periodo, empresa: p.empresa, concepto: p.concepto, estado: p.estado, monto: p.monto, metodo: p.metodo, fuente: p.fuente, obs: p.obs, pago_ref: p.pago_ref || '', aprobado_por: p.aprobado_por || '', registrado_por: p.creado_por || '', version: p.version }));
  return { provisiones: lista, conceptos: Cat.conceptos_('PROVISION'), nota: 'Una provisión no mueve dinero: no está en caja ni en el resultado de caja. El método de cálculo lo define quien corresponda.' };
});
function guardarProvision_(db, data, x, opciones) {
  const periodo = Base.periodo_(data.periodo);
  if (!periodo) return errorValidacion('periodo', 'Indica el mes.');
  const empresa = Cat.empresa_(data.empresa);
  if (!empresa) return errorValidacion('empresa', 'Elige la empresa.');
  const concepto = Base.txt_(data.concepto);
  if (Cat.conceptos_('PROVISION').indexOf(concepto) === -1) return errorValidacion('concepto', 'Elige Vacaciones o Años de Servicio.');
  const m = Base.montoClp_(data.monto);
  if (!m.ok || m.valor < 0) return errorValidacion('monto', m.error || 'Monto no válido.');
  const metodo = Base.txt_(data.metodo).slice(0, 300);
  if (metodo.length < 3) return errorValidacion('metodo', 'Escribe el método o la fuente del cálculo (no se calcula solo).');
  const estado = ['PROPUESTA', 'APROBADA', 'PAGADA', 'ANULADA'].indexOf(Base.txt_(data.estado).toUpperCase()) !== -1 ? Base.txt_(data.estado).toUpperCase() : 'PROPUESTA';
  const datos = { monto: m.valor, metodo, fuente: Base.txt_(data.fuente).slice(0, 200), obs: Base.txt_(data.obs).slice(0, 500), pago_ref: Base.txt_(data.pago_ref), aprobado_por: estado === 'APROBADA' ? x.nombre : Base.txt_(data.aprobado_por) };
  if (datos.pago_ref) {
    const h = require('./finanzasHechos').todos_().find((y) => y.ref === datos.pago_ref);
    if (!h || !h.clasif || h.clasif.tipo !== 'EGRESO') return errorValidacion('pago_ref', 'El pago vinculado debe ser un gasto confirmado.');
  }
  return upsert_('FIN_PROVISIONES', data, { periodo, empresa, concepto, estado: datos.pago_ref ? 'PAGADA' : estado }, datos, x, opciones);
}
const guardarProvision = Base.conCapacidad('PLANIFICAR', '', function (db, data, contexto, x) {
  const r = guardarProvision_(db, data, x);
  if (!r._validationError) x.registrar('PROVISION', Base.txt_(data.concepto) + ' ' + Base.txt_(data.periodo));
  return r;
});

// ================================================================ COMPROMISOS Y PROYECCIÓN (FIN-30)

const compromisos = B.conBoveda('VER_PLANIFICACION', function (db, data) {
  const lista = filas_('FIN_COMPROMISOS', "estado != 'ANULADO'").map((c) => ({ id: c.id, fecha: c.fecha, empresa: c.empresa, estado: c.estado, tipo: c.tipo, sentido: c.sentido, recurrencia: c.recurrencia,
    concepto: c.concepto, monto: c.monto, cliente_id: c.cliente_id || '', nota: c.nota, pago_ref: c.pago_ref || '', version: c.version }));
  return { compromisos: lista };
});
function guardarCompromiso_(db, data, x, opciones) {
  const fecha = Base.fechaCivil_(data.fecha);
  if (!fecha) return errorValidacion('fecha', 'Indica la fecha esperada.');
  const empresa = Cat.empresa_(data.empresa);
  if (!empresa) return errorValidacion('empresa', 'Elige la empresa.');
  const m = Base.montoClp_(data.monto);
  if (!m.ok || !(m.valor > 0)) return errorValidacion('monto', m.error || 'Monto no válido.');
  const tipo = Base.txt_(data.tipo).toUpperCase() === 'ESTIMADO' ? 'ESTIMADO' : 'CONFIRMADO';
  const sentido = Base.txt_(data.sentido).toUpperCase() === 'ENTRADA' ? 'ENTRADA' : 'SALIDA';
  const recurrencia = Base.txt_(data.recurrencia).toUpperCase() === 'MENSUAL' ? 'MENSUAL' : 'NINGUNA';
  const concepto = Base.txt_(data.concepto).slice(0, 160);
  if (!concepto) return errorValidacion('concepto', 'Escribe el concepto.');
  const estado = ['PENDIENTE', 'PAGADO', 'ANULADO'].indexOf(Base.txt_(data.estado).toUpperCase()) !== -1 ? Base.txt_(data.estado).toUpperCase() : 'PENDIENTE';
  const datos = { concepto, monto: m.valor, cliente_id: Base.txt_(data.cliente_id), nota: Base.txt_(data.nota).slice(0, 500), pago_ref: Base.txt_(data.pago_ref), hasta: Base.fechaCivil_(data.hasta) };
  return upsert_('FIN_COMPROMISOS', data, { fecha, empresa, estado: datos.pago_ref ? 'PAGADO' : estado, tipo, sentido, recurrencia }, datos, x, opciones);
}
const guardarCompromiso = Base.conCapacidad('PLANIFICAR', '', function (db, data, contexto, x) {
  const r = guardarCompromiso_(db, data, x);
  if (!r._validationError) x.registrar('COMPROMISO', Base.txt_(data.concepto).slice(0, 60));
  return r;
});

/**
 * Proyección de recursos propios (FIN-30; corrección v2 I03.5).
 *
 *  1. Parte de la DISPONIBILIDAD PROPIA al corte (la misma evaluación del
 *     informe). Si no es determinable, el escenario es PARCIAL: se muestra
 *     desde la referencia (saldo bancario − fondos a favor de clientes), con
 *     la razón a la vista, y no se evalúa si alcanza.
 *  2. El horizonte empieza en el MES DEL CORTE: el resto de ese mes (lo que
 *     vence o se debe pagar después del corte) también cuenta.
 *  3. Cobranza esperada, compromisos confirmados y estimaciones van aparte.
 *     La plata de clientes para sus obligaciones va en su propio circuito.
 *  4. Un compromiso registrado del mismo concepto REEMPLAZA a la estimación de
 *     ese mes (se muestra la sustitución; no se suman los dos).
 *  5. La cobranza es un escenario editable (% elegido) con las facturas que lo
 *     componen; el 100 % no es certeza.
 *  6. Sin pagos de una obligación: «por determinar», nunca un monto inventado.
 *  7. «Alcanza» solo con disponibilidad determinada y sin montos por determinar.
 */
const proyeccion = B.conBoveda('VER_PROYECCION', function (db, data) {
  const H = require('./finanzasHechos');
  const empresa = Cat.empresa_(data && data.empresa) || '';
  const meses = Math.min(Math.max(Number(data && data.meses) || 3, 1), 12);
  // 0 % es 0 % (también si llega como texto «0»); solo sin dato se toma 100 %.
  const pctTxt = String(data && data.pct_cobranza !== undefined && data.pct_cobranza !== null ? data.pct_cobranza : '').replace('%', '').replace(',', '.').trim();
  const pctCobranza = pctTxt === '' || !isFinite(Number(pctTxt)) ? 100 : Math.min(Math.max(Number(pctTxt), 0), 100);
  const hoy = Base.hoy_();
  const hechos = H.todos_().filter((h) => !empresa || h.empresa === empresa);
  // 1. Punto de partida: disponibilidad propia al corte de la última cartola.
  const ultimo = H.saldosAl_({ empresa }); // por fecha del banco (I02.4)
  const caja = ultimo.length ? ultimo.reduce((s, h) => s + (Number(h.saldo) || 0), 0) : null;
  const corte = ultimo.reduce((a, h) => (h.al > a ? h.al : a), '') || hoy;
  let ev = null;
  try { ev = require('./finanzasReportes').reporte_(db, { periodo: corte.slice(0, 7), empresa, hoy: corte > hoy ? corte : hoy }).evaluacion.caja_libre; } catch (e) { ev = null; }
  const determinada = !!(ev && ev.status === 'DETERMINED');
  const inicial = determinada ? ev.amount : ev && ev.referencial ? ev.referencial.monto : caja;
  // 2. Horizonte desde el mes del corte (resto del mes incluido).
  const inicio = corte.slice(0, 7);
  const periodos = Base.rangoMeses_(inicio, (() => { let p = inicio; for (let i = 1; i < meses; i++) p = Base.mesSiguiente_(p); return p; })());
  const fila = () => ({ cobranza: 0, compromisos_entrada: 0, compromisos_salida: 0, estimado_salida: 0, por_determinar: [], facturas: [], sustituciones: [], atrasados: [] });
  const porMes = new Map(periodos.map((p) => [p, fila()]));
  // 5. Cobranza por vencer: lo vencido y lo que vence en el resto del mes del corte, en el primer mes.
  try {
    require('./finanzasCobranza').cartera_(db, { empresa }).forEach((n) => n.facturas.forEach((f) => {
      if (!(f.saldo > 0) || f.estado === 'INCOBRABLE') return;
      const p = f.vence.slice(0, 7) < periodos[0] ? periodos[0] : f.vence.slice(0, 7);
      if (!porMes.has(p)) return;
      const esperado = Math.round(f.saldo * pctCobranza / 100);
      porMes.get(p).cobranza += esperado;
      porMes.get(p).facturas.push({ cliente: n.cliente, folio: f.folio || '', vence: f.vence, saldo: f.saldo, esperado, vencida: f.vence < corte });
    }));
  } catch (e) { /* sin cobranza */ }
  // Compromisos y su recurrencia. En el mes del corte solo lo que cae DESPUÉS del corte; lo pendiente con fecha pasada, como atrasado.
  const diaDe = (fecha, p) => p + '-' + String(Math.min(Number(fecha.slice(8, 10)), Base.diasDelMes_(Number(p.slice(0, 4)), Number(p.slice(5, 7))))).padStart(2, '0');
  const comps = filas_('FIN_COMPROMISOS', "estado = 'PENDIENTE'").filter((c) => !empresa || c.empresa === empresa);
  const usados = []; // { periodo, concepto, compromiso } para las sustituciones
  comps.forEach((c) => {
    periodos.forEach((p, i) => {
      let aplica, atrasado = false;
      if (c.recurrencia === 'MENSUAL') {
        aplica = c.fecha.slice(0, 7) <= p && (!c.hasta || c.hasta.slice(0, 7) >= p);
        if (aplica && i === 0 && diaDe(c.fecha, p) <= corte) aplica = false; // la cuota de este mes ya pasó: debería estar en el banco
      } else {
        aplica = c.fecha.slice(0, 7) === p && !(i === 0 && c.fecha <= corte);
        if (i === 0 && c.fecha <= corte) { aplica = true; atrasado = true; }
      }
      if (!aplica) return;
      const f = porMes.get(p);
      if (atrasado) f.atrasados.push({ concepto: c.concepto, fecha: c.fecha, monto: c.monto });
      if (c.sentido === 'ENTRADA') f.compromisos_entrada += c.monto; else if (c.tipo === 'ESTIMADO') f.estimado_salida += c.monto; else f.compromisos_salida += c.monto;
      if (c.sentido === 'SALIDA') usados.push({ periodo: p, concepto: String(c.concepto || '').toLowerCase(), monto: c.monto, tipo: c.tipo });
    });
  });
  const supuestos = [
    determinada ? 'Punto de partida: disponibilidad propia al ' + corte + ' (' + Base.plata_(inicial) + ').'
      : 'Punto de partida PARCIAL: la disponibilidad propia al ' + corte + ' no es determinable (' + (ev ? ev.detalle.map((d) => d.texto).join(' ') : 'sin evaluación') + '). Se usa como referencia ' + (ev && ev.referencial ? ev.referencial.formula : 'el saldo bancario') + ' = ' + Base.plata_(inicial || 0) + '.',
    'El horizonte empieza en ' + Base.nombreMes_(inicio) + ': incluye lo que vence o se paga después del corte (' + corte + ').',
    'Cobranza: facturas por cobrar de hoy, en el mes de su vencimiento (lo vencido, en el primer mes), al ' + pctCobranza + ' %. Es un escenario: el ' + pctCobranza + ' % no es certeza.',
    'Compromisos: los registrados como pendientes; los mensuales se repiten hasta su fecha final. Los de fecha pasada sin pagar van al primer mes como atrasados.',
    'Fondos de clientes: van en su propio circuito; no entran ni salen aquí.'];
  // 4 y 6. Obligaciones propias estimadas, salvo que un compromiso del mismo concepto las reemplace.
  Cat.lista_('OBLIGACION').forEach((o) => {
    const porPer = {};
    hechos.filter((h) => h.clasif && h.clasif.tipo === 'EGRESO' && (o.conceptos || []).indexOf(h.clasif.cuenta) !== -1).forEach((h) => { porPer[h.periodo] = (porPer[h.periodo] || 0) + h.cargo; });
    const ult = Object.keys(porPer).filter((p) => p < inicio).sort().slice(-3);
    const claves = [o.nombre].concat(o.conceptos || []).map((k) => String(k).toLowerCase());
    const prom = ult.length ? Math.round(ult.reduce((s, p) => s + porPer[p], 0) / ult.length) : null;
    periodos.forEach((p, i) => {
      const f = porMes.get(p);
      const reemplazo = usados.filter((u) => u.periodo === p && claves.some((k) => u.concepto.indexOf(k) !== -1));
      if (reemplazo.length) { f.sustituciones.push({ obligacion: o.nombre, estimado: prom, compromiso: reemplazo.reduce((s, u) => s + u.monto, 0) }); return; }
      if (prom === null) { f.por_determinar.push(o.nombre); return; }
      // En el mes del corte se descuenta lo ya pagado de esa obligación (no se cuenta dos veces).
      const ya = i === 0 ? (porPer[p] || 0) : 0;
      f.estimado_salida += Math.max(prom - ya, 0);
    });
    supuestos.push(prom === null ? o.nombre + ': por determinar (no hay pagos registrados antes de ' + Base.nombreMes_(inicio) + ').'
      : o.nombre + ': estimado con el promedio de ' + ult.join(', ') + ' (' + Base.plata_(prom) + ' al mes); en ' + Base.nombreMes_(inicio) + ' se descuenta lo ya pagado. Si hay un compromiso registrado del mismo concepto, lo reemplaza.');
  });
  let saldo = inicial === null || inicial === undefined ? null : inicial;
  const serie = periodos.map((p) => {
    const f = porMes.get(p);
    const entradas = f.cobranza + f.compromisos_entrada, salidas = f.compromisos_salida + f.estimado_salida;
    if (saldo !== null) saldo += entradas - salidas;
    f.facturas.sort((a, b) => b.esperado - a.esperado);
    return Object.assign({ periodo: p, entradas, salidas, saldo_proyectado: saldo }, f, { facturas: f.facturas.slice(0, 12), facturas_total: f.facturas.length });
  });
  // 7. Suficiencia.
  const porDet = [...new Set(serie.flatMap((s) => s.por_determinar))];
  const evaluable = determinada && !porDet.length && saldo !== null;
  const minimo = serie.reduce((a, s) => (s.saldo_proyectado !== null && (a === null || s.saldo_proyectado < a.saldo) ? { periodo: s.periodo, saldo: s.saldo_proyectado } : a), null);
  const suficiencia = evaluable
    ? { evaluable: true, alcanza: minimo.saldo >= 0, texto: minimo.saldo >= 0 ? 'Con estos supuestos, el saldo propio no baja de cero en el horizonte (mínimo ' + Base.plata_(minimo.saldo) + ' en ' + Base.nombreMes_(minimo.periodo) + ').' : 'Con estos supuestos, el saldo propio baja de cero en ' + Base.nombreMes_(minimo.periodo) + ' (' + Base.plata_(minimo.saldo) + ').' }
    : { evaluable: false, alcanza: null, texto: 'No se evalúa si alcanza: ' + [!determinada ? 'la disponibilidad propia al corte no es determinable' : '', porDet.length ? 'faltan montos de ' + porDet.join(', ') : ''].filter(Boolean).join('; ') + '.' };
  return { empresa, caja_inicial: caja, corte, inicio: { monto: inicial === undefined ? null : inicial, determinada, estado: ev ? ev.status : 'NOT_DETERMINABLE', razones: ev ? ev.detalle : [], referencial: ev ? ev.referencial : null },
    escenario: determinada ? 'COMPLETO' : 'PARCIAL', pct_cobranza: pctCobranza, supuestos, serie, suficiencia,
    advertencia: 'Escenario con supuestos: no es dinero disponible ni reemplaza lo realizado.' + (determinada ? '' : ' Parte de una referencia, no de una disponibilidad acreditada.') };
});

/** Compromisos de SALIDA confirmados y pendientes de un mes (para las obligaciones del informe). */
function compromisosPendientes_(periodo, empresa) {
  return filas_('FIN_COMPROMISOS', "estado = 'PENDIENTE' AND tipo = 'CONFIRMADO' AND sentido = 'SALIDA'").filter((c) => (!empresa || c.empresa === empresa) &&
    (c.recurrencia === 'MENSUAL' ? c.fecha.slice(0, 7) <= periodo && (!c.hasta || c.hasta.slice(0, 7) >= periodo) : c.fecha.slice(0, 7) === periodo))
    .map((c) => ({ id: c.id, concepto: c.concepto, monto: c.monto, fecha: c.fecha, empresa: c.empresa }));
}

function reiniciar_() { preparada_ = null; }

module.exports = {
  compromisosPendientes_,
  previsualizarReparto, gastosCompartidos, guardarGastoCompartido, vincularGasto,
  prestamos, guardarPrestamo, vincularPrestamo, saldosPrestamos_, gastosCompartidos_,
  proyectos, guardarProyecto, proyectosLegado_,
  provisiones, guardarProvision, compromisos, guardarCompromiso, proyeccion,
  guardarGasto_, guardarPrestamo_, guardarProyectoLegado_, guardarProvision_, guardarCompromiso_, reiniciar_
};
