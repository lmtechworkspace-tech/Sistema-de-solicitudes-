'use strict';

/**
 * finanzasFondos.js — la plata de los clientes, por cliente y por gestión
 * (2026-10-20; FIN-13, FIN-14, FIN-15).
 *
 * Un cliente manda dinero para pagar SUS obligaciones (imposiciones, IVA,
 * sueldos de su obra…). Ese dinero no es de la empresa. Aquí se administra:
 *
 *  - GESTIÓN: una obligación de un cliente en un período (p. ej. «imposiciones
 *    de junio de Arma Hierro»), con lo solicitado si se pidió, los destinos
 *    (obras, trabajadores…), las recepciones, los pagos, las devoluciones y
 *    los reintegros. Varias recepciones pueden pagar una gestión y una
 *    recepción puede repartirse (dividiéndola) entre gestiones.
 *  - APERTURA: el saldo que el cliente ya tenía antes de cargar cartolas en el
 *    sistema. Se registra con fuente y responsable y se APRUEBA. Sin apertura
 *    aprobada, el saldo del cliente es PARCIAL: no se saca conclusión
 *    definitiva (FIN-14). Una apertura de $0 aprobada también vale: declara
 *    que no había saldo previo.
 *  - REASIGNACIÓN: mover saldo de una gestión a otra del MISMO cliente. No
 *    crea dinero: lo que sale de una entra a la otra.
 *  - REMANENTE: lo que sobra de una gestión. Se decide qué hacer y se deja
 *    escrito; nunca se convierte solo en honorario (FIN-15).
 *
 * Saldo de una gestión = aperturas aprobadas + recibido + reintegros
 *   − pagado − devuelto ± reasignaciones.
 * La custodia de cada cliente se suma por separado: el déficit de un cliente
 * nunca libera la plata de otro.
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const Cat = require('./finanzasCatalogos');
const FB = require('./finanzasBancos');
const H = require('./finanzasHechos');
const { errorValidacion } = require('./errores');

const I = FB.interno;
const ESTADOS_GESTION = { ABIERTA: 'Abierta', CERRADA: 'Cerrada', ANULADA: 'Anulada' };
const DECISIONES = {
  MANTENER: 'Queda como saldo del cliente para la próxima gestión',
  DEVOLVER: 'Se devuelve al cliente (registrar la devolución como pago)',
  REASIGNAR: 'Se pasa a otra gestión del mismo cliente',
  HONORARIO: 'Se cobra como honorario (requiere instrucción y documento)'
};

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
function db_() {
  const d = Base.db_();
  if (preparada_ === d) return d;
  [
    `CREATE TABLE IF NOT EXISTS FIN_GESTIONES (
       id TEXT PRIMARY KEY, cliente_h TEXT NOT NULL, empresa TEXT NOT NULL, periodo_obligacion TEXT, estado TEXT NOT NULL,
       version INTEGER NOT NULL DEFAULT 0, datos TEXT NOT NULL, creado_en TEXT, creado_por TEXT, actualizado_en TEXT, actualizado_por TEXT)`,
    'CREATE INDEX IF NOT EXISTS ix_fin_gest_cliente ON FIN_GESTIONES (cliente_h, periodo_obligacion)',
    `CREATE TABLE IF NOT EXISTS FIN_APERTURAS (
       id TEXT PRIMARY KEY, cliente_h TEXT NOT NULL, empresa TEXT NOT NULL, gestion_id TEXT, fecha_corte TEXT NOT NULL, estado TEXT NOT NULL,
       version INTEGER NOT NULL DEFAULT 0, datos TEXT NOT NULL, creado_en TEXT, creado_por TEXT, actualizado_en TEXT, actualizado_por TEXT)`,
    `CREATE TABLE IF NOT EXISTS FIN_REASIGNACIONES (
       id TEXT PRIMARY KEY, cliente_h TEXT NOT NULL, desde_gestion TEXT NOT NULL, hacia_gestion TEXT NOT NULL, fecha TEXT NOT NULL,
       estado TEXT NOT NULL, datos TEXT NOT NULL, creado_en TEXT, creado_por TEXT)`
  ].forEach((sql) => d.exec(sql));
  preparada_ = d;
  return d;
}
const hCli_ = (id) => I.hmac_('cliente|' + String(id));

// ---------------------------------------------------------------- lectura

function gestionPublica_(r) {
  const d = Base.des_(r.datos);
  return Object.assign({ id: r.id, empresa: r.empresa, periodo_obligacion: r.periodo_obligacion || '', estado: r.estado, version: r.version, creado_por: r.creado_por, actualizado_por: r.actualizado_por, actualizado_en: r.actualizado_en }, d);
}
/** id → { id, cliente_id, cliente, empresa, periodo_obligacion, estado… } (todas). */
function gestionesMapa_() {
  const m = new Map();
  db_().prepare('SELECT * FROM FIN_GESTIONES').all().forEach((r) => m.set(r.id, gestionPublica_(r)));
  return m;
}
function aperturas_(filtro) {
  filtro = filtro || {};
  return db_().prepare('SELECT * FROM FIN_APERTURAS').all().map((r) => Object.assign({ id: r.id, empresa: r.empresa, gestion_id: r.gestion_id || '', fecha_corte: r.fecha_corte, estado: r.estado, version: r.version, creado_por: r.creado_por }, Base.des_(r.datos)))
    .filter((a) => (!filtro.cliente_id || a.cliente_id === filtro.cliente_id) && (!filtro.hasta || a.fecha_corte <= filtro.hasta));
}
function reasignaciones_(filtro) {
  filtro = filtro || {};
  return db_().prepare("SELECT * FROM FIN_REASIGNACIONES WHERE estado = 'ACTIVA'").all().map((r) => Object.assign({ id: r.id, desde_gestion: r.desde_gestion, hacia_gestion: r.hacia_gestion, fecha: r.fecha, creado_por: r.creado_por }, Base.des_(r.datos)))
    .filter((x) => (!filtro.cliente_id || x.cliente_id === filtro.cliente_id) && (!filtro.hasta || x.fecha <= filtro.hasta));
}

/** Hechos de fondos (confirmados) de un cliente o de todos, hasta una fecha. */
function hechosFondos_(filtro) {
  filtro = filtro || {};
  return H.hechos_({ hasta: filtro.hasta, soloConfirmados: true }).filter((h) => h.clasif &&
    (h.clasif.tipo === 'FONDO_RECIBIDO' || h.clasif.tipo === 'FONDO_PAGADO') && h.clasif.cliente_id &&
    (!filtro.cliente_id || h.clasif.cliente_id === filtro.cliente_id) && (!filtro.empresa || h.empresa === filtro.empresa));
}
function clase_(h) {
  const c = h.clasif;
  if (c.tipo === 'FONDO_RECIBIDO') return c.subtipo === 'REINTEGRO' ? 'reintegros' : 'recibido';
  return c.subtipo === 'DEVOLUCION' ? 'devuelto' : 'pagado';
}
function vacioSaldo_() { return { apertura: 0, recibido: 0, reintegros: 0, pagado: 0, devuelto: 0, reasignado_entra: 0, reasignado_sale: 0, saldo: 0 }; }
function cerrarSaldo_(s) { s.saldo = s.apertura + s.recibido + s.reintegros - s.pagado - s.devuelto + s.reasignado_entra - s.reasignado_sale; return s; }

/**
 * Custodia al corte (una fecha) por cliente, para el tablero y los reportes.
 * { clientes:[{cliente_id, cliente, saldo, parcial}], total, positivos (suma
 *   de los saldos a favor), negativos (suma de los déficit, ≤ 0), parcial,
 *   sin_apertura (cuántos clientes no tienen apertura aprobada) }
 */
function custodiaAl_(hasta, empresa) {
  const porCli = new Map();
  const nodo = (id, nombre) => { if (!porCli.has(id)) porCli.set(id, { cliente_id: id, cliente: nombre || '', saldo: 0, con_apertura: false }); return porCli.get(id); };
  hechosFondos_({ hasta, empresa }).forEach((h) => {
    const n = nodo(h.clasif.cliente_id, h.clasif.cliente);
    n.saldo += h.clasif.tipo === 'FONDO_RECIBIDO' ? h.abono : -h.cargo;
  });
  aperturas_({ hasta }).filter((a) => a.estado === 'APROBADA' && (!empresa || a.empresa === empresa)).forEach((a) => {
    const n = nodo(a.cliente_id, a.cliente);
    n.saldo += a.monto; n.con_apertura = true;
  });
  const clientes = [...porCli.values()].map((n) => ({ cliente_id: n.cliente_id, cliente: n.cliente, saldo: n.saldo, parcial: !n.con_apertura }));
  return {
    clientes, total: clientes.reduce((s, c) => s + c.saldo, 0),
    positivos: clientes.reduce((s, c) => s + Math.max(c.saldo, 0), 0), negativos: clientes.reduce((s, c) => s + Math.min(c.saldo, 0), 0),
    parcial: clientes.some((c) => c.parcial), sin_apertura: clientes.filter((c) => c.parcial).length
  };
}

/** Todo lo de los fondos de UN cliente: gestiones con su saldo, lo que no tiene gestión, aperturas y reasignaciones. */
function fichaCliente_(clienteId, hasta) {
  const gestiones = [...gestionesMapa_().values()].filter((g) => g.cliente_id === clienteId && g.estado !== 'ANULADA');
  const porG = new Map(gestiones.map((g) => [g.id, Object.assign(vacioSaldo_(), { piezas: [] })]));
  const sinG = Object.assign(vacioSaldo_(), { piezas: [] });
  hechosFondos_({ cliente_id: clienteId, hasta }).forEach((h) => {
    const s = (h.clasif.gestion_id && porG.get(h.clasif.gestion_id)) || sinG;
    s[clase_(h)] += h.abono || h.cargo;
    s.piezas.push({ ref: h.ref, fuente: h.fuente, fecha: h.fecha, monto: h.abono || -h.cargo, clase: clase_(h), concepto: h.clasif.cuenta, destino: h.clasif.destino || '',
      periodo_obligacion: h.clasif.periodo_obligacion || '', glosa: h.glosa || '', pagador: h.pagador || '', empresa: h.empresa, cuenta: h.banco ? h.banco + ' ···' + h.ultimos4 : (h.medio || '') });
  });
  const aps = aperturas_({ cliente_id: clienteId, hasta });
  aps.filter((a) => a.estado === 'APROBADA').forEach((a) => { const s = (a.gestion_id && porG.get(a.gestion_id)) || sinG; s.apertura += a.monto; });
  const reas = reasignaciones_({ cliente_id: clienteId, hasta });
  reas.forEach((r) => {
    const de = porG.get(r.desde_gestion) || (r.desde_gestion === 'SIN_GESTION' ? sinG : null);
    const a = porG.get(r.hacia_gestion) || (r.hacia_gestion === 'SIN_GESTION' ? sinG : null);
    if (de) de.reasignado_sale += r.monto;
    if (a) a.reasignado_entra += r.monto;
  });
  const lista = gestiones.map((g) => {
    const s = cerrarSaldo_(porG.get(g.id));
    const pagadoPorDestino = {};
    s.piezas.filter((p) => p.clase === 'pagado' && p.destino).forEach((p) => { pagadoPorDestino[p.destino] = (pagadoPorDestino[p.destino] || 0) - p.monto; });
    return Object.assign({}, g, s, {
      // Disponible en la gestión vs. lo que falta ejecutar (si se pidió un monto): se muestran por separado.
      pendiente_ejecutar: g.solicitado ? Math.max(0, g.solicitado - s.pagado) : null,
      destinos: (g.destinos || []).map((x) => Object.assign({}, x, { pagado: pagadoPorDestino[x.nombre] || 0 })),
      piezas: s.piezas.sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
    });
  }).sort((a, b) => (b.periodo_obligacion || '').localeCompare(a.periodo_obligacion || ''));
  cerrarSaldo_(sinG);
  const conApertura = aps.some((a) => a.estado === 'APROBADA');
  sinG.piezas.forEach((p) => { p.sugerencias = sugerirGestiones_(p, lista); });
  lista.forEach((g) => {
    g.banderas = banderas_(g, conApertura);
    // Una decisión sobre el remanente es una intención: se ejecuta con su registro (devolución, reasignación o conversión).
    if (g.remanente) {
      const desde = g.remanente.en || '';
      const hecho = g.remanente.decision === 'MANTENER' ? true : g.remanente.decision === 'DEVOLVER' ? g.piezas.some((p) => p.clase === 'devuelto' && p.fecha >= desde.slice(0, 10))
        : g.remanente.decision === 'REASIGNAR' ? reas.some((x) => x.desde_gestion === g.id) : !!g.remanente.ejecutado;
      g.remanente_estado = hecho ? 'EJECUTADA' : 'PENDIENTE_DE_REGISTRO';
    }
  });
  const total = lista.reduce((t, g) => t + g.saldo, 0) + sinG.saldo;
  return {
    cliente_id: clienteId, gestiones: lista, sin_gestion: sinG, aperturas: aps, reasignaciones: reas,
    saldo: total, parcial: !aps.some((a) => a.estado === 'APROBADA'),
    apertura: conApertura ? 'CONOCIDA' : aps.some((a) => a.estado === 'PROPUESTA') ? 'PROPUESTA' : 'DESCONOCIDA',
    filtros: { pendiente_ejecutar: lista.filter((g) => g.banderas.pendiente_ejecutar).length, deficit: lista.filter((g) => g.banderas.deficit).length,
      sin_asignacion: sinG.piezas.length, remanente_sin_decidir: lista.filter((g) => g.banderas.remanente_sin_decidir).length },
    nota_parcial: aps.some((a) => a.estado === 'APROBADA') ? '' : 'Falta el saldo inicial aprobado de este cliente: el saldo es parcial y puede faltar plata que mandó antes de cargar las cartolas.'
  };
}

// ---------------------------------------------------------------- acciones de lectura

/** Lista de clientes con plata en custodia (o con gestiones), con su saldo y si es parcial. */
const fondos = B.conBoveda('VER_FONDOS', function (db, data) {
  const hasta = Base.fechaCivil_(data && data.hasta) || '';
  const empresa = Cat.empresas_({ todos: true }).indexOf(Base.txt_(data && data.empresa)) !== -1 ? data.empresa : '';
  const cust = custodiaAl_(hasta || '9999-12-31', empresa);
  const gest = [...gestionesMapa_().values()].filter((g) => g.estado === 'ABIERTA');
  const nombres = new Map(I.clientes_(db).map((c) => [c.id, c]));
  const porCli = new Map(cust.clientes.map((c) => [c.cliente_id, Object.assign({ gestiones_abiertas: 0 }, c)]));
  gest.forEach((g) => { const n = porCli.get(g.cliente_id) || { cliente_id: g.cliente_id, cliente: g.cliente, saldo: 0, parcial: true, gestiones_abiertas: 0 }; n.gestiones_abiertas++; porCli.set(g.cliente_id, n); });
  const lista = [...porCli.values()].map((c) => Object.assign(c, { rut: (nombres.get(c.cliente_id) || {}).rut || '', cliente: c.cliente || (nombres.get(c.cliente_id) || {}).nombre || '' }))
    .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));
  return { hasta: hasta || Base.hoy_(), empresa, total: cust.total, positivos: cust.positivos, negativos: cust.negativos, parcial: cust.parcial, sin_apertura: cust.sin_apertura, clientes: lista,
    politica: politicaAperturas_(db), aperturas_propuestas: aperturas_({}).filter((a) => a.estado === 'PROPUESTA').length,
    aperturas_pendientes: aperturas_({}).filter((a) => a.estado === 'PROPUESTA').map((a) => ({ id: a.id, version: a.version, cliente_id: a.cliente_id, cliente: a.cliente, empresa: a.empresa, fecha_corte: a.fecha_corte, monto: a.monto, fuente: a.fuente, creado_por: a.creado_por, reemplaza: a.reemplaza || '' })) };
});

const fichaFondos = B.conBoveda('VER_FONDOS_CLIENTE', function (db, data) {
  const id = Base.txt_(data && data.cliente_id);
  const cli = I.clientes_(db).find((c) => c.id === id);
  if (!cli) return errorValidacion('cliente_id', 'Ese cliente no existe en SIGSO.');
  return Object.assign({ cliente: cli.nombre, rut: cli.rut, decisiones: DECISIONES, politica: politicaAperturas_(db) }, fichaCliente_(id, Base.fechaCivil_(data.hasta) || ''));
});

// ---------------------------------------------------------------- acciones de escritura

function exigirVersion_(fila, esperada) {
  // I11.2: actualizar sin la versión vista no se permite (antes se aceptaba y podía sobrescribir).
  if (esperada === undefined || esperada === null || esperada === '') return Base.errVersionRequerida_();
  return Number(esperada) === Number(fila.version) ? null : Base.errConflicto(undefined, { actual: { version: fila.version, actualizado_por: fila.actualizado_por } });
}

/** Crea o edita una gestión (obligación de un cliente en un período). */
const guardarGestion = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  return Base.idempotente_(contexto, 'guardarGestion', data.idempotency_key, data, () => {
    const cli = I.clientes_(db).find((c) => c.id === Base.txt_(data.cliente_id));
    if (!cli) return errorValidacion('cliente_id', 'Elige el cliente.');
    const empresa = Base.txt_(data.empresa);
    if (Cat.empresas_().indexOf(empresa) === -1) return errorValidacion('empresa', 'Elige la empresa que administra estos fondos.');
    const obligacion = Base.txt_(data.obligacion);
    if (Cat.conceptos_('FONDO').indexOf(obligacion) === -1) return errorValidacion('obligacion', 'Elige qué obligación es (imposiciones, IVA…).');
    const periodo = data.periodo_obligacion ? Base.periodo_(data.periodo_obligacion) : '';
    if (data.periodo_obligacion && !periodo) return errorValidacion('periodo_obligacion', 'El período no se entiende (AAAA-MM).');
    let solicitado = null;
    if (Base.txt_(data.solicitado)) { const m = Base.montoClp_(data.solicitado); if (!m.ok || m.valor < 0) return errorValidacion('solicitado', m.error || 'Monto no válido.'); solicitado = m.valor; }
    const destinos = [];
    for (const dd of (Array.isArray(data.destinos) ? data.destinos : []).slice(0, 30)) {
      const nombre = Base.txt_(dd.nombre).slice(0, 120);
      if (!nombre) continue;
      let monto = null;
      if (Base.txt_(dd.monto)) { const m = Base.montoClp_(dd.monto); if (!m.ok) return errorValidacion('destinos', 'Destino «' + nombre + '»: ' + m.error); monto = m.valor; }
      destinos.push({ nombre, monto });
    }
    const datos = { cliente_id: cli.id, cliente: cli.nombre, obligacion, solicitado, destinos, responsable: Base.txt_(data.responsable).slice(0, 120) || x.nombre, nota: Base.txt_(data.nota).slice(0, 500) };
    const d = db_();
    const ahora = Base.ahora_();
    if (data.id) {
      const r = d.prepare('SELECT * FROM FIN_GESTIONES WHERE id = ?').get(Base.txt_(data.id));
      if (!r) return errorValidacion('id', 'Esa gestión no existe.');
      const e = exigirVersion_(r, data.expected_version); if (e) return e;
      const previo = Base.des_(r.datos);
      if (previo.cliente_id !== cli.id && hechosFondos_({ cliente_id: previo.cliente_id }).some((h) => h.clasif.gestion_id === r.id)) return errorValidacion('cliente_id', 'Esta gestión ya tiene movimientos: no se puede cambiar de cliente.');
      datos.remanente = previo.remanente;
      d.prepare('UPDATE FIN_GESTIONES SET cliente_h = ?, empresa = ?, periodo_obligacion = ?, datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?')
        .run(hCli_(cli.id), empresa, periodo || null, Base.cif_(datos), ahora, x.nombre, r.id);
      x.registrar('GESTION_EDITAR', obligacion + ' ' + (periodo || '') + ' · ' + cli.nombre);
      return { id: r.id, version: r.version + 1 };
    }
    const id = Base.id_();
    d.prepare('INSERT INTO FIN_GESTIONES (id, cliente_h, empresa, periodo_obligacion, estado, version, datos, creado_en, creado_por, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, hCli_(cli.id), empresa, periodo || null, 'ABIERTA', 1, Base.cif_(datos), ahora, x.nombre, ahora, x.nombre);
    x.registrar('GESTION_NUEVA', obligacion + ' ' + (periodo || '') + ' · ' + cli.nombre);
    return { id, version: 1 };
  });
});

/** Abrir, cerrar o anular una gestión (anular solo si no tiene movimientos). */
const estadoGestion = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  const estado = Base.txt_(data && data.estado).toUpperCase();
  if (!ESTADOS_GESTION[estado]) return errorValidacion('estado', 'Estado no válido.');
  const d = db_();
  const r = d.prepare('SELECT * FROM FIN_GESTIONES WHERE id = ?').get(Base.txt_(data.id));
  if (!r) return errorValidacion('id', 'Esa gestión no existe.');
  const e = exigirVersion_(r, data.expected_version); if (e) return e;
  const g = gestionPublica_(r);
  if (estado === 'ANULADA' && hechosFondos_({ cliente_id: g.cliente_id }).some((h) => h.clasif.gestion_id === r.id)) return errorValidacion('estado', 'La gestión tiene movimientos: quítaselos antes de anularla, o ciérrala.');
  if (estado !== 'ABIERTA' && Base.txt_(data.motivo).length < 3 && estado === 'ANULADA') return errorValidacion('motivo', 'Escribe por qué se anula.');
  d.prepare('UPDATE FIN_GESTIONES SET estado = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(estado, Base.ahora_(), x.nombre, r.id);
  x.registrar('GESTION_' + estado, g.obligacion + ' ' + (g.periodo_obligacion || '') + ' · ' + g.cliente + (data.motivo ? ': ' + Base.txt_(data.motivo).slice(0, 120) : ''));
  return { id: r.id, estado, version: r.version + 1 };
});

/**
 * Asigna piezas (de un movimiento del banco o de una operación) a una gestión,
 * o se las quita (gestion_id vacío). No cambia montos ni la clasificación:
 * solo dice a qué obligación corresponde esa plata. refs: ['mov:<id>:<parte>' | 'op:<id>:<parte>'].
 */
const asignarGestion = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  const refs = (Array.isArray(data && data.refs) ? data.refs : []).map(Base.txt_).filter(Boolean).slice(0, 200);
  if (!refs.length) return errorValidacion('refs', 'Elige qué movimientos asignar.');
  const gid = Base.txt_(data.gestion_id);
  const g = gid ? gestionesMapa_().get(gid) : null;
  if (gid && !g) return errorValidacion('gestion_id', 'Esa gestión no existe.');
  if (g && g.estado === 'ANULADA') return errorValidacion('gestion_id', 'Esa gestión está anulada.');
  const destino = Base.txt_(data.destino).slice(0, 160);
  const errores = [];
  let hechos = 0;
  Base.transaccion_(() => {
    refs.forEach((ref) => {
      const r = actualizarPieza_(ref, (c) => {
        if (!c || (c.tipo !== 'FONDO_RECIBIDO' && c.tipo !== 'FONDO_PAGADO')) return 'Solo la plata de un cliente se asigna a una gestión.';
        if (g && c.cliente_id !== g.cliente_id) return 'La gestión es de otro cliente.';
        if (gid) c.gestion_id = gid; else delete c.gestion_id;
        if (data.destino !== undefined) { if (destino) c.destino = destino; else delete c.destino; }
        return '';
      }, x);
      if (r) errores.push({ ref, mensaje: r }); else hechos++;
    });
  });
  if (hechos) x.registrar('GESTION_ASIGNAR', hechos + ' pieza(s) ' + (g ? '→ ' + g.obligacion + ' ' + (g.periodo_obligacion || '') + ' · ' + g.cliente : 'sin gestión'));
  return { hechos, errores };
});

/**
 * Cambia la clasificación de UNA pieza (ref) con una función que la edita en
 * su lugar y devuelve '' o un mensaje de error. Respeta el mes cerrado.
 */
function actualizarPieza_(ref, editar, x) {
  const m = /^(mov|op):([^:]+):(\d+)$/.exec(String(ref));
  if (!m) return 'Referencia no válida.';
  if (m[1] === 'op') return require('./finanzasOperaciones').actualizarDistribucion_(m[2], Number(m[3]), editar, x);
  const d = I.db_();
  const r = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ?').get(m[2]);
  if (!r) return 'El movimiento no existe.';
  if (r.estado !== 'CONFIRMADO') return 'Primero confirma qué es el movimiento.';
  if (require('./finanzasCierre').mesCerrado_(r.periodo)) return 'El mes ' + r.periodo + ' está cerrado.';
  const datos = I.des_(r.datos);
  const parte = Number(m[3]);
  let c;
  if (datos.clasif && Array.isArray(datos.clasif.partes)) c = datos.clasif.partes[parte];
  else if (parte === 0) c = datos.clasif;
  if (!c) return 'Esa parte no existe.';
  const err = editar(c);
  if (err) return err;
  d.prepare('UPDATE FIN_MOVIMIENTOS SET datos = ?, version = COALESCE(version, 0) + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(I.cif_(datos), Base.ahora_(), x.nombre, r.id);
  return '';
}

/** Registra un saldo inicial (queda PROPUESTO hasta que alguien con la capacidad APERTURA lo apruebe). */
const guardarApertura = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  return Base.idempotente_(contexto, 'guardarApertura', data.idempotency_key, data, () => {
    const cli = I.clientes_(db).find((c) => c.id === Base.txt_(data.cliente_id));
    if (!cli) return errorValidacion('cliente_id', 'Elige el cliente.');
    const empresa = Base.txt_(data.empresa);
    if (Cat.empresas_().indexOf(empresa) === -1) return errorValidacion('empresa', 'Elige la empresa que administra estos fondos.');
    const corte = Base.fechaCivil_(data.fecha_corte);
    if (!corte) return errorValidacion('fecha_corte', 'Escribe la fecha de corte (el día antes de la primera cartola cargada).');
    const m = Base.montoClp_(data.monto);
    if (!m.ok) return errorValidacion('monto', m.error);
    const fuente = Base.txt_(data.fuente).slice(0, 200);
    if (fuente.length < 3) return errorValidacion('fuente', 'Escribe de dónde sale el saldo (cartola de junio, planilla, confirmación del cliente…).');
    const gid = Base.txt_(data.gestion_id);
    if (gid) { const g = gestionesMapa_().get(gid); if (!g || g.cliente_id !== cli.id) return errorValidacion('gestion_id', 'Esa gestión no es de este cliente.'); }
    const id = Base.id_(), ahora = Base.ahora_();
    db_().prepare('INSERT INTO FIN_APERTURAS (id, cliente_h, empresa, gestion_id, fecha_corte, estado, version, datos, creado_en, creado_por, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, hCli_(cli.id), empresa, gid || null, corte, 'PROPUESTA', 1, Base.cif_({ cliente_id: cli.id, cliente: cli.nombre, monto: m.valor, fuente, responsable: Base.txt_(data.responsable).slice(0, 120) || x.nombre, nota: Base.txt_(data.nota).slice(0, 500) }), ahora, x.nombre, ahora, x.nombre);
    x.registrar('APERTURA_PROPUESTA', cli.nombre + ' al ' + corte);
    return { id, estado: 'PROPUESTA', version: 1 };
  });
});

/** Aprobar o anular una apertura. Aprobar exige la capacidad APERTURA; anular, un motivo. */
const decidirApertura = B.conBoveda('', function (db, data, contexto, x) {
  const accion = Base.txt_(data && data.accion).toUpperCase();
  if (accion !== 'APROBAR' && accion !== 'ANULAR') return errorValidacion('accion', 'Acción no válida.');
  { const e_ = Base.exigir_(contexto, accion === 'APROBAR' ? 'APERTURA' : 'FONDOS'); if (e_) return e_; }
  const d = db_();
  const r = d.prepare('SELECT * FROM FIN_APERTURAS WHERE id = ?').get(Base.txt_(data.id));
  if (!r) return errorValidacion('id', 'Esa apertura no existe.');
  const e = exigirVersion_(r, data.expected_version); if (e) return e;
  const datos = Base.des_(r.datos);
  if (accion === 'ANULAR') {
    const motivo = Base.txt_(data.motivo);
    if (motivo.length < 3) return errorValidacion('motivo', 'Escribe por qué se anula.');
    datos.anulada_motivo = motivo.slice(0, 300); datos.anulada_por = x.nombre;
  } else {
    if (r.estado !== 'PROPUESTA') return errorValidacion('estado', 'Solo se aprueba una apertura propuesta.');
    // I06.4: la política activa manda. Con «dos personas», quien propuso no aprueba; si no, queda dicho que fue la misma persona.
    const pol = politicaAperturas_(db);
    if (pol.dos_personas && r.creado_por === x.nombre) return Base.errPermiso('La política activa exige dos personas: quien propuso este saldo inicial no puede aprobarlo.');
    datos.aprobado_por = x.nombre; datos.aprobado_en = Base.ahora_(); datos.misma_persona = r.creado_por === x.nombre; datos.politica = pol.dos_personas ? 'DOS_PERSONAS' : 'UNA_PERSONA';
    if (datos.reemplaza) d.prepare("UPDATE FIN_APERTURAS SET estado = 'REEMPLAZADA', version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ? AND estado = 'APROBADA'").run(Base.ahora_(), x.nombre, datos.reemplaza);
  }
  const estado = accion === 'APROBAR' ? 'APROBADA' : 'ANULADA';
  d.prepare('UPDATE FIN_APERTURAS SET estado = ?, datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(estado, Base.cif_(datos), Base.ahora_(), x.nombre, r.id);
  x.registrar('APERTURA_' + estado, datos.cliente + ' al ' + r.fecha_corte + (datos.misma_persona && estado === 'APROBADA' ? ' (propuesta y aprobada por la misma persona)' : ''));
  return { id: r.id, estado, version: r.version + 1 };
});

/** Pasa saldo de una gestión a otra del mismo cliente (no crea dinero). 'SIN_GESTION' = lo no asignado. */
const reasignar = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  return Base.idempotente_(contexto, 'reasignar', data.idempotency_key, data, () => {
    const desde = Base.txt_(data.desde), hacia = Base.txt_(data.hacia);
    if (!desde || !hacia || desde === hacia) return errorValidacion('hacia', 'Elige dos gestiones distintas.');
    const mapa = gestionesMapa_();
    const gd = desde === 'SIN_GESTION' ? null : mapa.get(desde), gh = hacia === 'SIN_GESTION' ? null : mapa.get(hacia);
    if ((desde !== 'SIN_GESTION' && !gd) || (hacia !== 'SIN_GESTION' && !gh)) return errorValidacion('desde', 'Una de las gestiones no existe.');
    const cliente = (gd || gh).cliente_id;
    if ((gd && gd.cliente_id !== cliente) || (gh && gh.cliente_id !== cliente)) return errorValidacion('hacia', 'Solo se reasigna entre gestiones del MISMO cliente. Pasar plata de un cliente a otro no está habilitado: requiere un procedimiento y respaldo que aún no se definen (y nunca para tapar el déficit de otro).');
    const m = Base.montoClp_(data.monto);
    if (!m.ok || !(m.valor > 0)) return errorValidacion('monto', m.error || 'El monto debe ser mayor que cero.');
    const motivo = Base.txt_(data.motivo);
    if (motivo.length < 3) return errorValidacion('motivo', 'Escribe por qué se reasigna.');
    const ficha = fichaCliente_(cliente, '');
    const disponible = desde === 'SIN_GESTION' ? ficha.sin_gestion.saldo : (ficha.gestiones.find((g) => g.id === desde) || {}).saldo || 0;
    if (m.valor > disponible) return errorValidacion('monto', 'La gestión de origen tiene ' + Base.plata_(disponible) + ': no alcanza para reasignar ' + Base.plata_(m.valor) + '.');
    const id = Base.id_(), ahora = Base.ahora_();
    db_().prepare('INSERT INTO FIN_REASIGNACIONES (id, cliente_h, desde_gestion, hacia_gestion, fecha, estado, datos, creado_en, creado_por) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, hCli_(cliente), desde, hacia, Base.fechaCivil_(data.fecha) || Base.hoy_(), 'ACTIVA', Base.cif_({ cliente_id: cliente, monto: m.valor, motivo: motivo.slice(0, 300) }), ahora, x.nombre);
    x.registrar('FONDOS_REASIGNAR', Base.plata_(m.valor) + ': ' + motivo.slice(0, 80));
    return { id };
  });
});

/** Deshace una reasignación (queda anulada en la historia, no se borra). */
const anularReasignacion = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  const r = db_().prepare("SELECT * FROM FIN_REASIGNACIONES WHERE id = ? AND estado = 'ACTIVA'").get(Base.txt_(data && data.id));
  if (!r) return errorValidacion('id', 'Esa reasignación no existe o ya está anulada.');
  if (Base.txt_(data.motivo).length < 3) return errorValidacion('motivo', 'Escribe por qué se deshace.');
  const datos = Object.assign(Base.des_(r.datos), { anulada_motivo: Base.txt_(data.motivo).slice(0, 300), anulada_por: x.nombre });
  db_().prepare("UPDATE FIN_REASIGNACIONES SET estado = 'ANULADA', datos = ? WHERE id = ?").run(Base.cif_(datos), r.id);
  x.registrar('FONDOS_REASIGNAR_ANULAR', Base.plata_(datos.monto));
  return { ok: true };
});

/**
 * Deja escrito qué se hace con el remanente de una gestión. No mueve dinero:
 * devolver o cobrar exigen su propio registro. HONORARIO exige la
 * referencia del documento o instrucción que lo respalda.
 */
const decidirRemanente = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  const dec = Base.txt_(data && data.decision).toUpperCase();
  if (!DECISIONES[dec]) return errorValidacion('decision', 'Elige qué se hace con el remanente.');
  const nota = Base.txt_(data.nota).slice(0, 500);
  const respaldo = Base.txt_(data.respaldo).slice(0, 200);
  if (dec === 'HONORARIO' && respaldo.length < 3) return errorValidacion('respaldo', 'Para cobrarlo como honorario indica la instrucción o el documento que lo respalda.');
  const d = db_();
  const r = d.prepare('SELECT * FROM FIN_GESTIONES WHERE id = ?').get(Base.txt_(data.gestion_id));
  if (!r) return errorValidacion('gestion_id', 'Esa gestión no existe.');
  const e = exigirVersion_(r, data.expected_version); if (e) return e;
  const datos = Base.des_(r.datos);
  const saldo = (fichaCliente_(datos.cliente_id, '').gestiones.find((g) => g.id === r.id) || {}).saldo || 0;
  datos.remanente = { decision: dec, nota, respaldo, monto_al_decidir: saldo, por: x.nombre, en: Base.ahora_() };
  d.prepare('UPDATE FIN_GESTIONES SET datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(Base.cif_(datos), Base.ahora_(), x.nombre, r.id);
  x.registrar('GESTION_REMANENTE', DECISIONES[dec] + ' · ' + Base.plata_(saldo));
  return { ok: true, version: r.version + 1 };
});

// ---------------------------------------------------------------- política de aperturas (I06.4)

/**
 * Política activa para aprobar saldos iniciales. Configurable (parámetro
 * «aperturas_dos_personas» del catálogo): 1 = quien propone NO puede aprobar
 * su propia apertura; 0 = puede, queda auditado y se dice que NO es un control
 * de dos personas. Quién puede aprobar sale de las capacidades reales
 * (APERTURA), no de una lista de nombres.
 */
function politicaAperturas_(db) {
  let dos = 0;
  try { dos = Number(Cat.param_('aperturas_dos_personas', 0)) ? 1 : 0; } catch (e) { dos = 0; }
  const acceso = String(process.env.SIGSO_FINANZAS_ACCESO || '').split(',').map((s) => s.trim()).filter(Boolean);
  let nombres = new Map();
  try { nombres = new Map(require('../db/sqliteRepo').leerFilas_(db, 'CUENTAS_PORTAL', require('../db/schema').COLUMNAS.CUENTAS_PORTAL).map((c) => [String(c.cuenta_id).toLowerCase(), c.nombre])); } catch (e) { nombres = new Map(); }
  const aprobadores = acceso.filter((id) => Base.capacidades_({ cuenta_id: id }).indexOf('APERTURA') !== -1).map((id) => nombres.get(id.toLowerCase()) || id);
  return { dos_personas: !!dos, aprobadores,
    texto: dos ? 'Dos personas: quien propone un saldo inicial no puede aprobarlo.' : 'Una misma persona puede proponer y aprobar un saldo inicial. Queda registrado quién hizo cada paso; NO es un control de dos personas.' };
}

// ---------------------------------------------------------------- ficha por obligación (I06.1/I06.2)

/** Gestiones abiertas del cliente que calzan con una pieza sin gestión: obligación (concepto), período y empresa. */
function sugerirGestiones_(pieza, gestiones) {
  return gestiones.filter((g) => g.estado === 'ABIERTA').map((g) => {
    let p = 0; const por = [];
    if (g.obligacion === pieza.concepto) { p += 3; por.push('misma obligación'); }
    if (pieza.periodo_obligacion && g.periodo_obligacion === pieza.periodo_obligacion) { p += 2; por.push('mismo período'); }
    if (g.empresa === pieza.empresa) { p += 1; por.push('misma empresa'); }
    return { gestion_id: g.id, nombre: g.obligacion + (g.periodo_obligacion ? ' ' + g.periodo_obligacion : ''), puntos: p, motivos: por };
  }).filter((s) => s.puntos >= 3).sort((a, b) => b.puntos - a.puntos).slice(0, 3);
}
/** Banderas de una gestión para filtrar la ficha. */
function banderas_(g, conApertura) {
  return { pendiente_ejecutar: g.pendiente_ejecutar !== null && g.pendiente_ejecutar > 0, deficit: g.saldo < 0, sin_apertura: !conApertura,
    remanente: g.saldo > 0 && g.estado === 'CERRADA', remanente_sin_decidir: g.saldo > 0 && !g.remanente };
}

/**
 * Crea una gestión desde una pieza sin gestión (I06.2): toma cliente, empresa,
 * obligación (concepto) y período de la pieza, y la asigna. No cambia montos
 * ni la evidencia bancaria.
 */
const gestionDesdePieza = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  const ref = Base.txt_(data && data.ref);
  const cli = Base.txt_(data && data.cliente_id);
  const pieza = hechosFondos_({ cliente_id: cli }).find((h) => h.ref === ref);
  if (!pieza) return errorValidacion('ref', 'Ese movimiento no es plata de este cliente o ya no existe.');
  if (pieza.clasif.gestion_id) return errorValidacion('ref', 'Ese movimiento ya tiene gestión.');
  const obligacion = Cat.conceptos_('FONDO').indexOf(pieza.clasif.cuenta) !== -1 ? pieza.clasif.cuenta : 'Otro';
  return Base.idempotente_(contexto, 'gestionDesdePieza', data.idempotency_key, { ref }, () => Base.transaccion_(() => {
    const g = guardarGestion(db, Object.assign({}, data, { cliente_id: cli, empresa: pieza.empresa, obligacion, periodo_obligacion: pieza.clasif.periodo_obligacion || '',
      destinos: pieza.clasif.destino ? [{ nombre: pieza.clasif.destino }] : [], nota: 'Creada desde el movimiento del ' + pieza.fecha, idempotency_key: undefined }), contexto);
    if (g._validationError) return g;
    const err = actualizarPieza_(ref, (c) => { c.gestion_id = g.id; return ''; }, x);
    if (err) return errorValidacion('ref', err);
    return { gestion_id: g.id };
  }));
});

// ---------------------------------------------------------------- aperturas en lote (I06.3)

const COLS_APERTURA = { cliente: /CLIENTE|RUT|RAZON/, empresa: /EMPRESA/, gestion: /GESTION|OBLIGACION/, fecha_corte: /FECHA|CORTE/, monto: /MONTO|SALDO|IMPORTE/, moneda: /MONEDA/, fuente: /FUENTE|RESPALDO|ORIGEN/ };
function leerFilasApertura_(db, filas) {
  const cab = (filas[0] || []).map((c) => Base.normalizar_(c));
  const col = {};
  Object.keys(COLS_APERTURA).forEach((k) => { col[k] = cab.findIndex((h) => COLS_APERTURA[k].test(h)); });
  if (col.cliente === -1 || col.monto === -1 || col.fecha_corte === -1) return { error: 'La primera fila debe traer los títulos: cliente (o RUT), empresa, fecha de corte, monto, moneda y fuente.' };
  const clientes = I.clientes_(db);
  const porRut = new Map(clientes.map((c) => [String(c.rut || '').replace(/[^0-9kK]/g, '').toUpperCase(), c]).filter((e) => e[0]));
  const porNombre = new Map(clientes.map((c) => [Base.normalizar_(c.nombre), c]));
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const gest = [...gestionesMapa_().values()];
  const aprobadas = aperturas_({}).filter((a) => a.estado === 'APROBADA' || a.estado === 'PROPUESTA');
  const vistos = new Map();
  const revision = filas.slice(1).filter((f) => (f || []).some((c) => Base.txt_(c))).map((f, i) => {
    const v = (k) => (col[k] === -1 ? '' : Base.txt_(f[col[k]]));
    const errores = [], avisos = [];
    const t = v('cliente');
    const cli = porId.get(t) || porRut.get(t.replace(/[^0-9kK]/g, '').toUpperCase()) || porNombre.get(Base.normalizar_(t));
    if (!cli) errores.push('Cliente no encontrado en SIGSO (usa el RUT o el nombre exacto).');
    const empresa = Cat.empresa_(v('empresa'));
    if (!empresa) errores.push('Empresa administradora no reconocida.');
    const fecha = Base.fechaCivil_(v('fecha_corte')) || (/^\d+(\.\d+)?$/.test(v('fecha_corte')) ? I.fechaIso_(Number(v('fecha_corte'))) : '');
    if (!fecha) errores.push('Fecha de corte no válida.');
    const m = Base.montoClp_(v('monto'));
    if (!m.ok) errores.push('Monto: ' + m.error);
    const moneda = (v('moneda') || 'CLP').toUpperCase();
    if (moneda !== 'CLP') errores.push('Solo pesos chilenos (CLP).');
    const fuente = v('fuente');
    if (fuente.length < 3) errores.push('Falta la fuente o el respaldo.');
    let gestion_id = '';
    if (v('gestion') && cli) {
      const g = gest.find((x) => x.cliente_id === cli.id && x.estado !== 'ANULADA' && (Base.normalizar_(x.obligacion + ' ' + (x.periodo_obligacion || '')) === Base.normalizar_(v('gestion')) || x.id === v('gestion')));
      if (!g) errores.push('Gestión «' + v('gestion') + '» no existe para este cliente.'); else gestion_id = g.id;
    }
    const clave = cli && empresa ? cli.id + '|' + empresa + '|' + gestion_id : '';
    if (clave && vistos.has(clave)) errores.push('Repetida: igual a la fila ' + (vistos.get(clave) + 2) + ' (mismo cliente, empresa y gestión).');
    else if (clave) vistos.set(clave, i);
    if (cli && empresa) {
      const otra = aprobadas.find((a) => a.cliente_id === cli.id && a.empresa === empresa && (a.gestion_id || '') === gestion_id);
      if (otra) errores.push('Ya hay una apertura ' + (otra.estado === 'APROBADA' ? 'aprobada' : 'propuesta') + ' de ' + Base.plata_(otra.monto) + ' al ' + otra.fecha_corte + ': corrígela (nueva versión) en vez de cargar otra.');
    }
    if (m.ok && m.valor === 0) avisos.push('Saldo inicial cero conocido (no es lo mismo que no saberlo).');
    return { fila: i + 2, cliente_id: cli ? cli.id : '', cliente: cli ? cli.nombre : t, empresa: empresa || v('empresa'), gestion_id, fecha_corte: fecha, monto: m.ok ? m.valor : null, fuente, errores, avisos, ok: !errores.length };
  });
  const porEmpresa = {};
  revision.filter((r) => r.ok).forEach((r) => { porEmpresa[r.empresa] = (porEmpresa[r.empresa] || 0) + r.monto; });
  return { revision, aceptadas: revision.filter((r) => r.ok).length, incidentes: revision.filter((r) => !r.ok).length, totales_por_empresa: porEmpresa,
    token: Base.digest_(revision.map((r) => [r.cliente_id, r.empresa, r.gestion_id, r.fecha_corte, r.monto, r.fuente, r.ok])) };
}
const revisarAperturas = Base.conCapacidad('FONDOS', '', function (db, data) {
  const filas = Array.isArray(data && data.filas) ? data.filas.slice(0, 1001) : [];
  if (filas.length < 2) return errorValidacion('filas', 'Pega o sube la tabla con su fila de títulos y al menos una apertura.');
  const r = leerFilasApertura_(db, filas);
  return r.error ? Base.errFuente(r.error) : r;
});
/** Propone en lote las filas aceptadas de una revisión (mismo token = mismo contenido revisado). */
const proponerAperturas = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  const filas = Array.isArray(data && data.filas) ? data.filas.slice(0, 1001) : [];
  const r = leerFilasApertura_(db, filas);
  if (r.error) return Base.errFuente(r.error);
  if (r.token !== data.token) return Base.errConflicto('El contenido cambió desde que lo revisaste: revisa de nuevo.');
  return Base.idempotente_(contexto, 'proponerAperturas', data.idempotency_key, { t: r.token }, () => Base.transaccion_(() => {
    const ids = [];
    r.revision.filter((f) => f.ok).forEach((f) => {
      const g = guardarApertura(db, { boveda_token: data.boveda_token, equipo: data.equipo, cliente_id: f.cliente_id, empresa: f.empresa, gestion_id: f.gestion_id, fecha_corte: f.fecha_corte, monto: f.monto, fuente: f.fuente, nota: 'Carga en lote (fila ' + f.fila + ')' }, contexto);
      if (g && g.id) ids.push(g.id);
    });
    x.registrar('APERTURAS_LOTE', ids.length + ' propuesta(s)');
    return { propuestas: ids.length, ids, incidentes: r.incidentes };
  }));
});

/**
 * Corrige una apertura APROBADA sin sobrescribirla (I06.3): crea una nueva
 * versión PROPUESTA que la reemplaza al aprobarse. Mientras tanto la anterior
 * sigue vigente; al aprobar la nueva, la anterior queda REEMPLAZADA (historia).
 */
const corregirApertura = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  const r = db_().prepare('SELECT * FROM FIN_APERTURAS WHERE id = ?').get(Base.txt_(data && data.id));
  if (!r) return errorValidacion('id', 'Esa apertura no existe.');
  if (r.estado !== 'APROBADA') return errorValidacion('estado', 'Solo se corrige con una nueva versión una apertura aprobada; una propuesta se anula y se propone de nuevo.');
  const e = exigirVersion_(r, data.expected_version); if (e) return e;
  const motivo = Base.txt_(data.motivo);
  if (motivo.length < 3) return errorValidacion('motivo', 'Escribe por qué se corrige.');
  const ant = Base.des_(r.datos);
  const g = guardarApertura(db, { boveda_token: data.boveda_token, equipo: data.equipo, cliente_id: ant.cliente_id, empresa: r.empresa, gestion_id: r.gestion_id || '', fecha_corte: data.fecha_corte || r.fecha_corte, monto: data.monto, fuente: data.fuente || ant.fuente, nota: 'Corrige la apertura de ' + Base.plata_(ant.monto) + ': ' + motivo.slice(0, 200) }, contexto);
  if (g._validationError) return g;
  const nueva = db_().prepare('SELECT * FROM FIN_APERTURAS WHERE id = ?').get(g.id);
  const dn = Object.assign(Base.des_(nueva.datos), { reemplaza: r.id, motivo_correccion: motivo.slice(0, 300) });
  db_().prepare('UPDATE FIN_APERTURAS SET datos = ? WHERE id = ?').run(Base.cif_(dn), g.id);
  x.registrar('APERTURA_CORREGIR', ant.cliente + ': ' + motivo.slice(0, 80));
  return { id: g.id, estado: 'PROPUESTA', reemplaza: r.id };
});

// ---------------------------------------------------------------- remanente: convertir en honorario (I06.4)

/**
 * Ejecuta la decisión HONORARIO de una gestión: dos operaciones de
 * COMPENSACIÓN (no pasan por el banco, no crean otro abono): la salida del
 * circuito de custodia (FONDO_PAGADO del cliente, en esa gestión) y el cobro
 * propio (INGRESO del mismo cliente), enlazadas entre sí y con el respaldo. El
 * cobro queda disponible para aplicarse a una factura en Cobranza.
 */
const convertirRemanente = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  // El reintento con la misma clave devuelve lo ya hecho (aunque ahora el saldo sea cero).
  return Base.idempotente_(contexto, 'convertirRemanente', data.idempotency_key, { g: Base.txt_(data.gestion_id), m: data.monto || null, f: data.fecha || null, c: data.cuenta || null }, () => convertir_(db, data, contexto, x));
});
function convertir_(db, data, contexto, x) {
  const Op = require('./finanzasOperaciones');
  const r = db_().prepare('SELECT * FROM FIN_GESTIONES WHERE id = ?').get(Base.txt_(data && data.gestion_id));
  if (!r) return errorValidacion('gestion_id', 'Esa gestión no existe.');
  const e = exigirVersion_(r, data.expected_version); if (e) return e;
  const g = gestionPublica_(r);
  if (!g.remanente || g.remanente.decision !== 'HONORARIO') return errorValidacion('decision', 'Primero decide «cobrar como honorario» con su respaldo.');
  const saldo = (fichaCliente_(g.cliente_id, '').gestiones.find((y) => y.id === r.id) || {}).saldo || 0;
  const m = Base.montoClp_(data.monto || saldo);
  if (!m.ok || !(m.valor > 0)) return errorValidacion('monto', 'Monto no válido.');
  if (m.valor > saldo) return errorValidacion('monto', 'La gestión tiene ' + Base.plata_(saldo) + ': no se puede convertir ' + Base.plata_(m.valor) + '.');
  const fecha = Base.fechaCivil_(data.fecha) || Base.hoy_();
  const cuenta = Base.txt_(data.cuenta) || 'Servicio Mensual';
  return Base.transaccion_(() => {
    const ctxN = FB.contextoNormalizar_(db);
    const comun = { empresa: g.empresa, fecha, medio: 'COMPENSACION', monto: m.valor, tercero: g.cliente, referencia: g.remanente.respaldo, confirmar: true };
    const sale = Op.guardarInterno_(db, Object.assign({}, comun, { sentido: 'SALIDA', tipo: 'FONDO_PAGADO', subtipo: 'DEVOLUCION', cuenta: g.obligacion, cliente_id: g.cliente_id, gestion_id: g.id,
      nota: 'Remanente convertido en honorario (sale de los fondos del cliente)', origen: { tipo: 'REMANENTE_HONORARIO', gestion_id: g.id, respaldo: g.remanente.respaldo } }), contexto, x, ctxN);
    if (sale._validationError) return sale;
    const entra = Op.guardarInterno_(db, Object.assign({}, comun, { sentido: 'ENTRADA', tipo: 'INGRESO', cuenta, cliente_id: g.cliente_id,
      nota: 'Honorario cobrado con el remanente de ' + g.obligacion + ' ' + (g.periodo_obligacion || ''), origen: { tipo: 'REMANENTE_HONORARIO', gestion_id: g.id, par: sale.id, respaldo: g.remanente.respaldo } }), contexto, x, ctxN);
    if (entra._validationError) return entra;
    const datos = Base.des_(r.datos);
    datos.remanente = Object.assign({}, datos.remanente, { ejecutado: { operaciones: [sale.id, entra.id], monto: m.valor, por: x.nombre, en: Base.ahora_() } });
    db_().prepare('UPDATE FIN_GESTIONES SET datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(Base.cif_(datos), Base.ahora_(), x.nombre, r.id);
    x.registrar('REMANENTE_HONORARIO', g.cliente + ' · ' + Base.plata_(m.valor));
    return { salida_id: sale.id, ingreso_id: entra.id, monto: m.valor };
  });
}

function reiniciar_() { preparada_ = null; }

module.exports = {
  fondos, fichaFondos, guardarGestion, estadoGestion, asignarGestion, guardarApertura, decidirApertura, reasignar, anularReasignacion, decidirRemanente,
  gestionDesdePieza, revisarAperturas, proponerAperturas, corregirApertura, convertirRemanente, politicaAperturas_,
  custodiaAl_, fichaCliente_, gestionesMapa_, aperturas_, actualizarPieza_, hechosFondos_, DECISIONES, reiniciar_
};
