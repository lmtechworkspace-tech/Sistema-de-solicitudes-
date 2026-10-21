'use strict';

/**
 * finanzasOperaciones.js — el registro operativo (2026-10-20; FIN-05, FIN-06,
 * FIN-08, FIN-09 a FIN-12, FIN-16).
 *
 * La cartola dice que entró o salió plata, pero no de qué cliente, obligación
 * o período. Quien hace la gestión sí lo sabe en ese momento. Aquí lo anota
 * UNA vez, y el banco después lo confirma (conciliación):
 *
 *  - OPERACIÓN: un hecho de dinero conocido por la operación (cobré
 *    honorarios, recibí fondos de un cliente, pagué su Previred, pagué un
 *    gasto, traspasé, presté). Tiene empresa, fecha efectiva, sentido, medio,
 *    monto, tercero (quien paga o recibe) y sus DISTRIBUCIONES: cómo se reparte
 *    el monto entre naturaleza, concepto, cliente, gestión de fondos, proyecto,
 *    período de la obligación y destino. Las distribuciones suman EXACTO el
 *    monto (FIN-16).
 *  - Estados independientes (FIN-05): registro (BORRADOR → CONFIRMADA →
 *    ANULADA) y banco (SIN_BANCO → CONCILIADA; NO_APLICA si el medio no pasa
 *    por el banco: efectivo de caja, compensación). Una operación puede estar
 *    confirmada y sin banco todavía; nunca se inventa un movimiento del banco
 *    para ella.
 *  - Un BORRADOR se guarda aunque esté incompleto (dice qué le falta) y no
 *    cuenta en ninguna cifra. Vive en el servidor, cifrado: nada sensible
 *    queda en el navegador (FIN-12).
 *  - Correcciones por versión o anulación con motivo; un borrador nunca
 *    confirmado se puede descartar (FIN-08).
 *  - Idempotencia por comando y control de versión en cada edición (FIN-06).
 *  - Pegado desde Excel: vista previa con error por celda, totales,
 *    duplicados y un token del contenido revisado; publicar exige el mismo
 *    token (si cambió algo, hay que revisar de nuevo) (FIN-11).
 *  - Plantillas recurrentes: crean BORRADORES del mes, nunca pagos (FIN-12).
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const Cat = require('./finanzasCatalogos');
const FB = require('./finanzasBancos');
const { errorValidacion } = require('./errores');

const I = FB.interno;
const ESTADOS = { BORRADOR: 'Borrador', CONFIRMADA: 'Confirmada', ANULADA: 'Anulada' };
const CONCILIACION = { SIN_BANCO: 'Falta el banco', PARCIAL: 'Vinculada en parte con el banco', CONCILIADA: 'Conciliada con el banco', NO_APLICA: 'No pasa por el banco' };
// Medios que no pasan por una cuenta del banco (no esperan cartola).
const SIN_BANCO_ = ['EFECTIVO', 'COMPENSACION'];

// Acciones guiadas del formulario (FIN-10): qué naturaleza y sentido propone cada una.
const ACCIONES = {
  COBRAR_HONORARIOS: { nombre: 'Cobrar honorarios', sentido: 'ENTRADA', tipo: 'INGRESO', cuenta: 'Servicio Mensual', ayuda: 'Lo que el cliente paga por nuestro servicio. El pagador puede ser distinto del cliente.' },
  RECIBIR_FONDOS: { nombre: 'Recibir fondos de un cliente', sentido: 'ENTRADA', tipo: 'FONDO_RECIBIDO', subtipo: 'RECEPCION', ayuda: 'Este dinero se administra por cuenta del cliente: no es ingreso de la empresa.' },
  PAGAR_OBLIGACION: { nombre: 'Pagar una obligación del cliente', sentido: 'SALIDA', tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION', ayuda: 'Previred, IVA, Tesorería, sueldos… con la plata del cliente. La obligación puede ser de un mes anterior.' },
  DEVOLVER_FONDOS: { nombre: 'Devolver fondos al cliente', sentido: 'SALIDA', tipo: 'FONDO_PAGADO', subtipo: 'DEVOLUCION', ayuda: 'Sale de los fondos del cliente sin pagar una obligación.' },
  REINTEGRO: { nombre: 'Registrar un reintegro', sentido: 'ENTRADA', tipo: 'FONDO_RECIBIDO', subtipo: 'REINTEGRO', ayuda: 'Vuelve dinero de un pago hecho por el cliente (p. ej. un pago rechazado).' },
  GASTO_PROPIO: { nombre: 'Registrar un gasto de la empresa', sentido: 'SALIDA', tipo: 'EGRESO', ayuda: 'Un gasto para funcionar. No pide cliente.' },
  INGRESO_OTRO: { nombre: 'Otro ingreso de la empresa', sentido: 'ENTRADA', tipo: 'INGRESO', cuenta: 'Otros Ingresos', ayuda: 'Un ingreso propio que no es un honorario.' },
  TRASPASAR: { nombre: 'Traspasar entre cuentas propias', sentido: 'SALIDA', tipo: 'TRASPASO', ayuda: 'Entre dos cuentas de la MISMA empresa: no es ingreso ni gasto.' },
  PRESTAR: { nombre: 'Préstamo entre empresas', sentido: 'SALIDA', tipo: 'PRESTAMO', ayuda: 'Con otra empresa del grupo. Se lleva la cuenta de lo que se deben.' }
};

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
function db_() {
  const d = Base.db_();
  if (preparada_ === d) return d;
  [
    `CREATE TABLE IF NOT EXISTS FIN_OPERACIONES (
       id TEXT PRIMARY KEY, empresa TEXT NOT NULL, cuenta_ref TEXT, fecha TEXT, periodo TEXT, sentido TEXT NOT NULL, medio TEXT,
       estado TEXT NOT NULL, conciliacion TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, fuente TEXT NOT NULL, lote_id TEXT, clave_origen TEXT,
       datos TEXT NOT NULL, creado_en TEXT, creado_por TEXT, actualizado_en TEXT, actualizado_por TEXT)`,
    'CREATE INDEX IF NOT EXISTS ix_fin_op_periodo ON FIN_OPERACIONES (periodo, empresa, estado)',
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_op_origen ON FIN_OPERACIONES (clave_origen) WHERE clave_origen IS NOT NULL',
    `CREATE TABLE IF NOT EXISTS FIN_PERFILES (
       id TEXT PRIMARY KEY, tipo TEXT NOT NULL, cuenta_id TEXT, nombre TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1,
       datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)`
  ].forEach((sql) => d.exec(sql));
  preparada_ = d;
  return d;
}

// ---------------------------------------------------------------- lectura

function publica_(r) {
  const d = Base.des_(r.datos);
  return Object.assign({
    id: r.id, empresa: r.empresa, cuenta_ref: r.cuenta_ref || '', fecha: r.fecha || '', periodo: r.periodo || '', sentido: r.sentido, medio: r.medio || '',
    estado: r.estado, conciliacion: r.conciliacion, version: r.version, fuente: r.fuente, lote_id: r.lote_id || '',
    creado_en: r.creado_en, creado_por: r.creado_por, actualizado_en: r.actualizado_en, actualizado_por: r.actualizado_por
  }, d);
}
function porId_(id) { const r = db_().prepare('SELECT * FROM FIN_OPERACIONES WHERE id = ?').get(String(id)); return r ? Object.assign(publica_(r), { _fila: r }) : null; }

/**
 * Para finanzasHechos.js: las distribuciones de operaciones CONFIRMADAS que
 * todavía no están conciliadas. Una vez conciliadas, cuentan por el banco.
 */
/** Importe ya vinculado con el banco por operación (vínculos activos de conciliación). */
function vinculadoPorOp_() {
  const m = new Map();
  try {
    db_().prepare("SELECT operacion_id, datos FROM FIN_CONCILIACIONES WHERE estado = 'ACTIVA'").all().forEach((r) => { m.set(r.operacion_id, (m.get(r.operacion_id) || 0) + (Base.des_(r.datos).monto || 0)); });
  } catch (e) { /* la tabla aún no existe */ }
  return m;
}
function hechosRegistro_() {
  const d = db_();
  const cuentas = I.cuentasMapa_();
  const out = [];
  let vinculado = null;
  d.prepare("SELECT * FROM FIN_OPERACIONES WHERE estado = 'CONFIRMADA' AND conciliacion != 'CONCILIADA'").all().forEach((r) => {
    const o = publica_(r);
    const cu = cuentas.get(o.cuenta_ref) || {};
    const caja = Cat.medioDaCaja_(o.medio);
    // Vinculada en parte (I02): cuenta solo lo que todavía no llegó al banco, repartido en sus partes al peso.
    let dists = o.distribuciones || [];
    if (r.conciliacion === 'PARCIAL') {
      if (!vinculado) vinculado = vinculadoPorOp_();
      const resto = o.monto - (vinculado.get(o.id) || 0) - ((o.remanente_explicado && o.remanente_explicado.monto) || 0);
      if (!(resto > 0)) return;
      const montos = Base.repartir_(resto, dists.map((p) => p.monto));
      dists = dists.map((p, i) => Object.assign({}, p, { monto: montos[i] }));
      o.monto = resto;
    }
    dists.forEach((dist, i) => {
      if (!(dist.monto > 0)) return;
      out.push({
        ref: 'op:' + o.id + ':' + i, fuente: 'REGISTRO', operacion_id: o.id, parte: i, cuenta_ref: o.cuenta_ref, empresa: o.empresa,
        banco: cu.banco, ultimos4: cu.ultimos4, fecha: o.fecha, periodo: o.periodo, orden: 0, estado: 'CONFIRMADO',
        abono: o.sentido === 'ENTRADA' ? dist.monto : 0, cargo: o.sentido === 'SALIDA' ? dist.monto : 0, saldo: null,
        clasif: Object.assign({}, dist), glosa: o.tercero || '', pagador: o.tercero || '', medio: o.medio, caja,
        sin_banco: r.conciliacion === 'SIN_BANCO' || r.conciliacion === 'PARCIAL', parcial: r.conciliacion === 'PARCIAL',
        // Para la identidad económica (finanzasHechos): el total de la operación y los movimientos
        // del banco que una persona dijo que NO son esta operación (dos pagos iguales legítimos).
        operacion_monto: o.monto, sentido: o.sentido, distintas: (o.distintas || []).map((x) => x.movimiento_id)
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------- normalización

function sentidoMov_(sentido, monto) { return sentido === 'ENTRADA' ? { abono: monto, cargo: 0 } : { abono: 0, cargo: monto }; }

/** Texto libre → tipo de movimiento (para el pegado). '' si no se reconoce. */
function tipoDesdeTexto_(t, sentido) {
  const n = Base.normalizar_(t);
  if (!n) return '';
  if (FB.TIPOS[n.replace(/ /g, '_')]) return n.replace(/ /g, '_');
  if (/^(INGRESO|HONORARIO|COBRO|SERVICIO|ABONO RENTA)/.test(n)) return 'INGRESO';
  if (/^(GASTO|EGRESO)/.test(n)) return 'EGRESO';
  if (/FONDO.*RECIB|RECEPCION|RECIBO DE FONDOS/.test(n)) return 'FONDO_RECIBIDO';
  if (/PAGO POR CUENTA|FONDO.*PAGAD|PAGO DE CLIENTE|PAGO OBLIGACION/.test(n)) return 'FONDO_PAGADO';
  if (/^TRASPASO/.test(n)) return 'TRASPASO';
  if (/^PRESTAMO/.test(n)) return 'PRESTAMO';
  if (/^FONDO/.test(n)) return sentido === 'ENTRADA' ? 'FONDO_RECIBIDO' : 'FONDO_PAGADO';
  return '';
}

/**
 * Normaliza una operación (borrador o para confirmar). Devuelve
 * { op, faltantes:[{campo, mensaje}] }. Con estricto=true, cualquier
 * faltante es un error de validación.
 */
function normalizar_(db, data, ctxN) {
  const faltan = [];
  const falta = (campo, mensaje) => faltan.push({ campo, mensaje });
  const op = {};
  op.empresa = Cat.empresa_(data.empresa) || '';
  if (!op.empresa || Cat.empresas_().indexOf(op.empresa) === -1) falta('empresa', 'Elige la empresa.');
  op.fecha = Base.fechaCivil_(data.fecha);
  if (!op.fecha) falta('fecha', Base.txt_(data.fecha) ? 'La fecha no existe o no se entiende.' : 'Falta la fecha.');
  op.periodo = op.fecha ? op.fecha.slice(0, 7) : '';
  op.sentido = Base.txt_(data.sentido).toUpperCase() === 'SALIDA' ? 'SALIDA' : Base.txt_(data.sentido).toUpperCase() === 'ENTRADA' ? 'ENTRADA' : '';
  if (!op.sentido) falta('sentido', 'Indica si entra o sale plata.');
  const medio = Cat.buscar_('MEDIO', data.medio || 'TRANSFERENCIA');
  op.medio = medio ? medio.id : '';
  if (!op.medio) falta('medio', 'Medio de pago desconocido.');
  op.cuenta_ref = Base.txt_(data.cuenta_ref);
  if (op.cuenta_ref) {
    const cu = I.cuentasMapa_().get(op.cuenta_ref);
    if (!cu) falta('cuenta_ref', 'Esa cuenta bancaria no existe.');
    else if (op.empresa && cu.empresa !== op.empresa) falta('cuenta_ref', 'La cuenta es de ' + cu.empresa + ', no de ' + op.empresa + '.');
  }
  const m = Base.montoClp_(data.monto);
  op.monto = m.ok ? m.valor : 0;
  if (!m.ok) falta('monto', m.error);
  else if (!(m.valor > 0)) falta('monto', 'El monto debe ser mayor que cero (el sentido dice si entra o sale).');
  op.tercero = Base.txt_(data.tercero).slice(0, 160);
  op.referencia = Base.txt_(data.referencia).slice(0, 120);
  op.nota = Base.txt_(data.nota).slice(0, 500);
  if (data.accion && ACCIONES[data.accion]) op.accion = data.accion;
  // Distribuciones: arreglo, o los campos sueltos de una sola.
  const fuentes = Array.isArray(data.distribuciones) && data.distribuciones.length ? data.distribuciones
    : [{ monto: op.monto, tipo: data.tipo, subtipo: data.subtipo, cuenta: data.cuenta, cliente_id: data.cliente_id, empresa: data.empresa_contraparte,
      gestion_id: data.gestion_id, proyecto_id: data.proyecto_id, periodo_obligacion: data.periodo_obligacion, destino: data.destino, reparto: data.reparto, nota: '' }];
  const mov = sentidoMov_(op.sentido || 'ENTRADA', op.monto);
  op.distribuciones = [];
  fuentes.slice(0, 20).forEach((f, i) => {
    const mm = Array.isArray(data.distribuciones) && data.distribuciones.length ? Base.montoClp_(f.monto) : { ok: true, valor: op.monto };
    const etiqueta = fuentes.length > 1 ? 'Parte ' + (i + 1) + ': ' : '';
    if (!mm.ok || !(mm.valor > 0)) { falta('distribuciones', etiqueta + 'falta el monto.'); }
    const it = Object.assign({}, f, { empresa: f.empresa || f.empresa_contraparte });
    const r = op.sentido ? FB.normalizarClasif_(it, sentidoMov_(op.sentido, mm.valor || 1), ctxN) : { error: 'Indica si entra o sale.' };
    if (r.error) {
      falta('distribuciones', etiqueta + r.error);
      // El borrador guarda lo escrito aunque esté incompleto.
      op.distribuciones.push({ monto: mm.ok ? mm.valor : 0, tipo: Base.txt_(f.tipo), subtipo: Base.txt_(f.subtipo), cuenta: Base.txt_(f.cuenta), cliente_id: Base.txt_(f.cliente_id),
        cliente: ctxN.clientes.get(Base.txt_(f.cliente_id)) || '', empresa: Base.txt_(it.empresa), gestion_id: Base.txt_(f.gestion_id), proyecto_id: Base.txt_(f.proyecto_id),
        periodo_obligacion: Base.periodo_(f.periodo_obligacion) || '', destino: Base.txt_(f.destino).slice(0, 160), nota: Base.txt_(f.nota).slice(0, 300) });
    } else op.distribuciones.push(Object.assign({ monto: mm.ok ? mm.valor : 0 }, r.clasif));
  });
  const suma = op.distribuciones.reduce((s, x) => s + (x.monto || 0), 0);
  if (op.monto > 0 && suma !== op.monto) falta('distribuciones', 'Las partes suman ' + Base.plata_(suma) + ' y la operación es de ' + Base.plata_(op.monto) + '.');
  return { op, faltantes: faltan };
}

/** Posibles duplicados (FIN-06): misma empresa, sentido, monto y fecha (±1 día), y mismo tercero si hay. Solo avisa. */
function posiblesDuplicados_(op, excluirId) {
  if (!op.monto || !op.fecha) return [];
  const d = db_();
  const cerca = d.prepare("SELECT * FROM FIN_OPERACIONES WHERE empresa = ? AND sentido = ? AND estado != 'ANULADA' AND fecha BETWEEN ? AND ?")
    .all(op.empresa, op.sentido, Base.sumarDias_(op.fecha, -1), Base.sumarDias_(op.fecha, 1)).filter((r) => r.id !== excluirId);
  return cerca.map(publica_).filter((o) => o.monto === op.monto && (!op.tercero || !o.tercero || Base.normalizar_(o.tercero) === Base.normalizar_(op.tercero)))
    .slice(0, 5).map((o) => ({ id: o.id, fecha: o.fecha, monto: o.monto, tercero: o.tercero, estado: o.estado, creado_por: o.creado_por }));
}

function faltantesPublicos_(o, ctxN) {
  const r = normalizar_(null, Object.assign({}, o, { distribuciones: o.distribuciones }), ctxN);
  return r.faltantes;
}

// ---------------------------------------------------------------- guardar

function exigirVersion_(fila, esperada) {
  // I11.2: actualizar sin la versión vista no se permite (antes se aceptaba y podía sobrescribir).
  if (esperada === undefined || esperada === null || esperada === '') return Base.errVersionRequerida_();
  return Number(esperada) === Number(fila.version) ? null : Base.errConflicto(undefined, { actual: { version: fila.version, actualizado_por: fila.actualizado_por, actualizado_en: fila.actualizado_en } });
}
function cerrado_(periodo) { try { return !!periodo && require('./finanzasCierre').mesCerrado_(periodo); } catch (e) { return false; } }
function conciliacionInicial_(medio) { return SIN_BANCO_.indexOf(medio) !== -1 ? 'NO_APLICA' : 'SIN_BANCO'; }

/**
 * Guarda una operación (nueva o existente). confirmar=true exige todo
 * completo y la capacidad CONFIRMAR; si no, queda o sigue como BORRADOR
 * (que puede estar incompleto). Una operación ya confirmada solo se corrige
 * con una nueva versión completa, o se anula.
 */
function guardarUna_(db, data, contexto, x, ctxN, opciones) {
  opciones = opciones || {};
  const confirmar = !!data.confirmar;
  if (confirmar) { const e = Base.exigir_(contexto, 'CONFIRMAR'); if (e) return e; }
  const n = normalizar_(db, data, ctxN);
  if (confirmar && n.faltantes.length) {
    const e = errorValidacion(n.faltantes[0].campo, n.faltantes[0].mensaje);
    e.fields = n.faltantes.map((f) => ({ campo: f.campo, mensaje: f.mensaje }));
    return e;
  }
  const op = n.op;
  if (cerrado_(op.periodo)) return Base.errPeriodoCerrado(op.periodo);
  // I05.5: el origen «Control interno» se valida contra la fila real y guarda su id + versión.
  if (data.origen && data.origen.tipo === 'CONTROL_INTERNO') { const oc = origenCi_(db, data.origen); if (oc.error) return errorValidacion('origen', oc.error); data = Object.assign({}, data, { origen: oc.origen }); }
  const d = db_();
  const ahora = Base.ahora_();
  const datos = {
    monto: op.monto, tercero: op.tercero, referencia: op.referencia, nota: op.nota, accion: op.accion || '', distribuciones: op.distribuciones,
    origen: data.origen || (opciones.origen || null)
  };
  if (data.id) {
    const actual = porId_(data.id);
    if (!actual) return errorValidacion('id', 'Esa operación no existe.');
    const e = exigirVersion_(actual._fila, data.expected_version); if (e) return e;
    if (actual.estado === 'ANULADA') return errorValidacion('estado', 'La operación está anulada: crea otra.');
    if (actual.conciliacion === 'CONCILIADA' || actual.conciliacion === 'PARCIAL') return errorValidacion('estado', 'Está vinculada con el banco: deshaz la conciliación antes de corregirla (así se revalidan los importes).');
    if (cerrado_(actual.periodo)) return Base.errPeriodoCerrado(actual.periodo);
    if (actual.estado === 'CONFIRMADA' && !confirmar) return errorValidacion('estado', 'Una operación confirmada se corrige completa (confirmando de nuevo) o se anula.');
    datos.origen = actual.origen || datos.origen;
    // La acción guiada con que nació se conserva aunque la edición no la mande.
    if (!datos.accion) datos.accion = actual.accion || '';
    datos.historial = (actual.historial || []).concat([{ en: ahora, por: x.nombre, accion: actual.estado === 'CONFIRMADA' ? 'CORREGIR' : confirmar ? 'CONFIRMAR' : 'EDITAR', version: actual.version + 1 }]).slice(-50);
    const estado = confirmar ? 'CONFIRMADA' : 'BORRADOR';
    d.prepare('UPDATE FIN_OPERACIONES SET empresa = ?, cuenta_ref = ?, fecha = ?, periodo = ?, sentido = ?, medio = ?, estado = ?, conciliacion = ?, version = version + 1, datos = ?, actualizado_en = ?, actualizado_por = ? WHERE id = ?')
      .run(op.empresa || actual.empresa, op.cuenta_ref || null, op.fecha || null, op.periodo || null, op.sentido || actual.sentido, op.medio || null, estado,
        actual.conciliacion === 'CONCILIADA' ? 'CONCILIADA' : conciliacionInicial_(op.medio), Base.cif_(datos), ahora, x.nombre, actual.id);
    if (confirmar) x.registrar(actual.estado === 'CONFIRMADA' ? 'OPERACION_CORREGIR' : 'OPERACION_CONFIRMAR', op.periodo + ' · ' + ((ACCIONES[datos.accion] || {}).nombre || op.sentido));
    return { id: actual.id, estado, version: actual.version + 1, faltantes: n.faltantes, duplicados: posiblesDuplicados_(op, actual.id) };
  }
  const id = Base.id_();
  datos.historial = [{ en: ahora, por: x.nombre, accion: confirmar ? 'CREAR_CONFIRMADA' : 'CREAR_BORRADOR', version: 1 }];
  const estado = confirmar ? 'CONFIRMADA' : 'BORRADOR';
  try {
    d.prepare('INSERT INTO FIN_OPERACIONES (id, empresa, cuenta_ref, fecha, periodo, sentido, medio, estado, conciliacion, version, fuente, lote_id, clave_origen, datos, creado_en, creado_por, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, op.empresa || 'SIN_EMPRESA', op.cuenta_ref || null, op.fecha || null, op.periodo || null, op.sentido || 'ENTRADA', op.medio || null, estado, conciliacionInicial_(op.medio), 1,
        opciones.fuente || Base.txt_(data.fuente) || 'MANUAL', opciones.lote_id || null, opciones.clave_origen || null, Base.cif_(datos), ahora, x.nombre, ahora, x.nombre);
  } catch (e) {
    if (/UNIQUE/.test(String(e.message)) && opciones.clave_origen) return { id: '', estado: 'REPETIDA', version: 0, repetida: true };
    throw e;
  }
  if (confirmar) x.registrar('OPERACION_CONFIRMAR', op.periodo + ' · ' + ((ACCIONES[op.accion] || {}).nombre || op.sentido));
  return { id, estado, version: 1, faltantes: n.faltantes, duplicados: posiblesDuplicados_(op, id) };
}

const guardar = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  const r = Base.idempotente_(contexto, 'guardarOperacion', data.idempotency_key, Object.assign({}, data, { idempotency_key: undefined, boveda_token: undefined, equipo: undefined, portal_token: undefined }), () =>
    Base.transaccion_(() => guardarUna_(db, data, contexto, x, FB.contextoNormalizar_(db))));
  // I01 · QA-R02: si ya hay un movimiento del banco clasificado igual, se avisa (posible duplicado). No se bloquea:
  // dos pagos iguales pueden ser legítimos; la persona vincula o marca «son distintas».
  // I12.2: un borrador o una operación que no pasa por el banco nunca tiene coincidencias: no se recalcula el histórico.
  if (r && r.id && !r._validationError) r.coincidencias_banco = r.estado === 'CONFIRMADA' ? coincidenciasBanco_(r.id) : [];
  return r;
});
/** Movimientos del banco ya clasificados que podrían ser esta misma operación (I01). */
function coincidenciasBanco_(id) {
  try {
    const c = require('./finanzasHechos').conflictos_({}).find((y) => y.operacion_id === id);
    return c ? c.movimientos.map((m) => ({ movimiento_id: m.id, fecha: m.fecha, monto: m.monto, glosa: m.glosa, cuenta: m.cuenta, clasificado_como: m.clasif, version: m.version })) : [];
  } catch (e) { return []; }
}

/**
 * Acciones por lote (FIN-08/FIN-11), cada operación es su propio grupo: el
 * resultado dice qué salió y qué no, sin dejar ninguna a medias.
 *   CONFIRMAR · ANULAR (motivo) · DESCARTAR (solo borradores nunca confirmados) · CAMBIAR (cambios en campos)
 */
const accionLote = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  const accion = Base.txt_(data && data.accion).toUpperCase();
  const ids = (Array.isArray(data.ids) ? data.ids : []).map(Base.txt_).filter(Boolean).slice(0, 300);
  if (!ids.length) return errorValidacion('ids', 'Elige las operaciones.');
  if (['CONFIRMAR', 'ANULAR', 'DESCARTAR', 'CAMBIAR'].indexOf(accion) === -1) return errorValidacion('accion', 'Acción no válida.');
  if (accion === 'CONFIRMAR' || accion === 'ANULAR') { const e = Base.exigir_(contexto, 'CONFIRMAR'); if (e) return e; }
  const motivo = Base.txt_(data.motivo).slice(0, 300);
  if (accion === 'ANULAR' && motivo.length < 3) return errorValidacion('motivo', 'Escribe por qué se anulan.');
  const versiones = data.versiones || {};
  const ctxN = FB.contextoNormalizar_(db);
  const resultados = [];
  ids.forEach((id) => {
    try {
      const r = Base.transaccion_(() => {
        const o = porId_(id);
        if (!o) return errorValidacion('id', 'No existe.');
        const ev = exigirVersion_(o._fila, versiones[id]); if (ev) return ev;
        if (cerrado_(o.periodo)) return Base.errPeriodoCerrado(o.periodo);
        const d = db_();
        if (accion === 'DESCARTAR') {
          if (o.estado !== 'BORRADOR' || (o.historial || []).some((h) => /CONFIRM/.test(h.accion))) return errorValidacion('estado', 'Solo se descarta un borrador que nunca se confirmó.');
          d.prepare('DELETE FROM FIN_OPERACIONES WHERE id = ?').run(id);
          return { id, estado: 'DESCARTADA' };
        }
        if (accion === 'ANULAR') {
          if (o.estado === 'ANULADA') return errorValidacion('estado', 'Ya está anulada.');
          if (o.conciliacion === 'CONCILIADA' || o.conciliacion === 'PARCIAL') return errorValidacion('estado', 'Está vinculada con el banco: deshaz la conciliación primero.');
          if (aplicadaEnFacturas_(id)) return errorValidacion('estado', 'Tiene abonos aplicados a facturas: desaplícalos primero.');
          const datos = Base.des_(o._fila.datos);
          datos.historial = (datos.historial || []).concat([{ en: Base.ahora_(), por: x.nombre, accion: 'ANULAR', motivo, version: o.version + 1 }]);
          d.prepare("UPDATE FIN_OPERACIONES SET estado = 'ANULADA', version = version + 1, datos = ?, actualizado_en = ?, actualizado_por = ? WHERE id = ?").run(Base.cif_(datos), Base.ahora_(), x.nombre, id);
          x.registrar('OPERACION_ANULAR', o.periodo + ': ' + motivo.slice(0, 80));
          return { id, estado: 'ANULADA', version: o.version + 1 };
        }
        const base = { id, expected_version: o.version, empresa: o.empresa, cuenta_ref: o.cuenta_ref, fecha: o.fecha, sentido: o.sentido, medio: o.medio, monto: o.monto,
          tercero: o.tercero, referencia: o.referencia, nota: o.nota, accion: o.accion, distribuciones: o.distribuciones };
        if (accion === 'CAMBIAR') {
          // Solo los campos pedidos; a las distribuciones únicas se les aplican cliente/concepto/tipo.
          const c = data.cambios || {};
          ['empresa', 'cuenta_ref', 'fecha', 'medio', 'tercero', 'referencia', 'nota'].forEach((k) => { if (c[k] !== undefined) base[k] = c[k]; });
          if (['tipo', 'subtipo', 'cuenta', 'cliente_id', 'periodo_obligacion', 'proyecto_id', 'destino', 'gestion_id'].some((k) => c[k] !== undefined)) {
            if ((base.distribuciones || []).length !== 1) return errorValidacion('cambios', 'Tiene varias partes: cámbialas en su detalle.');
            base.distribuciones = [Object.assign({}, base.distribuciones[0], Object.fromEntries(Object.entries(c).filter(([k]) => ['tipo', 'subtipo', 'cuenta', 'cliente_id', 'periodo_obligacion', 'proyecto_id', 'destino', 'gestion_id'].indexOf(k) !== -1)))];
          }
          base.confirmar = o.estado === 'CONFIRMADA';
        } else base.confirmar = true;
        if (o.estado === 'ANULADA') return errorValidacion('estado', 'Está anulada.');
        return guardarUna_(db, base, contexto, x, ctxN);
      });
      resultados.push(r && (r._validationError || r._forbidden) ? { id, ok: false, codigo: r.codigo || '', mensaje: r.message, campos: r.fields } : Object.assign({ ok: true }, r));
    } catch (e) { resultados.push({ id, ok: false, mensaje: 'Error inesperado: ' + e.message }); }
  });
  const ok = resultados.filter((r) => r.ok).length;
  if (ok) x.registrar('OPERACIONES_' + accion, ok + ' de ' + ids.length);
  return { resultados, hechos: ok, errores: resultados.length - ok };
});
function aplicadaEnFacturas_(opId) { try { return require('./finanzasCobranza').recepcionAplicada_('op:' + opId); } catch (e) { return false; } }

// ---------------------------------------------------------------- listado

/**
 * Operaciones de un contexto (empresa, cuenta, período) con filtros y página.
 * Devuelve también qué le falta a cada borrador y los totales del filtro.
 */
const SIN_CUENTA = '__SIN_CUENTA__';
const listar = B.conBoveda('', function (db, data, contexto, x) {
  const d = db_();
  const periodo = Base.periodo_(data && data.periodo) || '';
  const empresa = Cat.empresa_(data && data.empresa) || '';
  const where = [], args = [];
  if (periodo) { where.push('(periodo = ? OR (periodo IS NULL AND estado = \'BORRADOR\'))'); args.push(periodo); }
  if (empresa) { where.push('empresa = ?'); args.push(empresa); }
  // I08.3: «Sin cuenta asignada» es un filtro propio, distinto de «Todas las cuentas».
  if (data && data.cuenta_ref === SIN_CUENTA) where.push("(cuenta_ref IS NULL OR cuenta_ref = '')");
  else if (data && data.cuenta_ref) { where.push('cuenta_ref = ?'); args.push(Base.txt_(data.cuenta_ref)); }
  if (data && data.estado && ESTADOS[data.estado]) { where.push('estado = ?'); args.push(data.estado); }
  else if (!(data && data.incluir_anuladas)) where.push("estado != 'ANULADA'");
  if (data && data.conciliacion && CONCILIACION[data.conciliacion]) { where.push('conciliacion = ?'); args.push(data.conciliacion); }
  const filas = d.prepare('SELECT * FROM FIN_OPERACIONES' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY COALESCE(fecha, \'9999\'), creado_en').all(...args);
  const ctxN = FB.contextoNormalizar_(db);
  const q = Base.normalizar_(data && data.busca);
  let lista = filas.map(publica_).map((o) => {
    const faltantes = o.estado === 'BORRADOR' ? faltantesPublicos_(o, ctxN) : [];
    const coincidencias = o.estado === 'CONFIRMADA' && o.conciliacion === 'SIN_BANCO' ? coincidenciasBanco_(o.id) : [];
    return Object.assign(o, { faltantes, completa: !faltantes.length, coincidencias_banco: coincidencias });
  });
  if (q) lista = lista.filter((o) => Base.normalizar_([o.tercero, o.referencia, o.nota, o.monto, (o.distribuciones || []).map((p) => [p.cliente, p.cuenta, p.destino].join(' ')).join(' ')].join(' ')).indexOf(q) !== -1);
  // I05.2: el orden se aplica al conjunto completo autorizado, antes de paginar.
  const ORDEN = { fecha: (o) => o.fecha || '9999', monto: (o) => o.monto || 0, tercero: (o) => Base.normalizar_(o.tercero || ''), estado: (o) => o.estado + o.conciliacion,
    cliente: (o) => Base.normalizar_(((o.distribuciones || [])[0] || {}).cliente || '') };
  const campoOrden = ORDEN[data && data.orden] ? data.orden : 'fecha', dir = data && data.dir === 'desc' ? -1 : 1;
  if (campoOrden !== 'fecha' || dir === -1) lista.sort((a, b) => { const x = ORDEN[campoOrden](a), y = ORDEN[campoOrden](b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  // QA-R12: lo confirmado y lo que está en borrador se suman por separado (un borrador no es un hecho).
  const totales = { entradas: 0, salidas: 0, entradas_borrador: 0, salidas_borrador: 0, borradores: 0, confirmadas: 0, sin_banco: 0, incompletas: 0, posibles_duplicados: 0, posibles_duplicados_monto: 0 };
  lista.forEach((o) => {
    if (o.estado === 'BORRADOR') totales.borradores++; else if (o.estado === 'CONFIRMADA') totales.confirmadas++;
    if (!o.completa) totales.incompletas++;
    if (o.estado === 'CONFIRMADA' && o.conciliacion === 'SIN_BANCO') totales.sin_banco++;
    if (o.coincidencias_banco.length) { totales.posibles_duplicados++; totales.posibles_duplicados_monto += o.monto || 0; }
    if (o.estado === 'CONFIRMADA') { if (o.sentido === 'ENTRADA') totales.entradas += o.monto || 0; else totales.salidas += o.monto || 0; }
    else if (o.estado === 'BORRADOR') { if (o.sentido === 'ENTRADA') totales.entradas_borrador += o.monto || 0; else totales.salidas_borrador += o.monto || 0; }
  });
  const pagina = Math.max(1, Number(data && data.pagina) || 1), por = Math.min(Math.max(Number(data && data.por_pagina) || 200, 10), 500);
  x.registrar('VER_OPERACIONES', periodo || 'todas');
  return {
    periodo, empresa, total: lista.length, pagina, por_pagina: por, totales, acciones: ACCIONES, estados: ESTADOS, conciliaciones: CONCILIACION,
    operaciones: lista.slice((pagina - 1) * por, pagina * por)
  };
});

const detalle = B.conBoveda('', function (db, data) {
  const o = porId_(Base.txt_(data && data.id));
  if (!o) return errorValidacion('id', 'Esa operación no existe.');
  delete o._fila;
  let vinculos = [], disponible = o.monto;
  try {
    const C = require('./finanzasConciliacion');
    // Cada vínculo con su movimiento a la vista (fecha, glosa, monto) para leerlo sin ir a Bancos.
    vinculos = C.vinculosDe_({ operacion_id: o.id }).map((v) => { const m = I.db_().prepare('SELECT fecha, datos FROM FIN_MOVIMIENTOS WHERE id = ?').get(v.movimiento_id); const md = m ? I.des_(m.datos) : {}; return Object.assign(v, { mov_fecha: m ? m.fecha : '', mov_glosa: md.glosa || '', mov_monto: md.abono || md.cargo || 0 }); });
    disponible = C.disponibleOp_(o);
  } catch (e) { vinculos = []; }
  let fuenteCambio = null;
  if (o.origen && o.origen.tipo === 'CONTROL_INTERNO') {
    const r = filaCi_(db, o.origen.registro_id);
    const act = r && FUENTES_CI[r.matriz] ? fuentePublica_(r) : null;
    if (!act) fuenteCambio = { texto: 'La obligación de Control interno ya no existe.' };
    else if (act.version !== o.origen.version) fuenteCambio = { texto: 'La obligación cambió en Control interno después de registrar esto' + (act.monto_esperado !== o.origen.monto_esperado ? ' (monto esperado ' + Base.plata_(o.origen.monto_esperado || 0) + ' → ' + Base.plata_(act.monto_esperado || 0) + ')' : '') + '. Lo registrado no se modificó: revísalo.', actual: act };
  }
  return Object.assign(o, { fuente_cambio: fuenteCambio, disponible, faltantes: o.estado === 'BORRADOR' ? faltantesPublicos_(o, FB.contextoNormalizar_(db)) : [], vinculos, duplicados: posiblesDuplicados_(o, o.id),
    coincidencias_banco: o.estado === 'CONFIRMADA' && o.conciliacion === 'SIN_BANCO' ? coincidenciasBanco_(o.id) : [] });
});

// ---------------------------------------------------------------- pegado desde Excel (FIN-11)

const CAMPOS_PEGADO = {
  fecha: 'Fecha', tercero: 'Quién paga / recibe', cliente: 'Cliente (nombre, RUT o alias)', tipo: 'Naturaleza', concepto: 'Concepto',
  entrada: 'Entrada', salida: 'Salida', monto: 'Monto con signo', referencia: 'Referencia / N° doc.', nota: 'Nota',
  periodo_obligacion: 'Período de la obligación', destino: 'Destino', empresa: 'Empresa', medio: 'Medio', ignorar: '(no usar)'
};

/** Cliente desde un texto: RUT exacto, razón social exacta o alias exacto. Nunca por parecido (FIN-03). */
function resolverCliente_(texto, ctxN, alias) {
  const t = Base.txt_(texto);
  if (!t) return { id: '' };
  const rut = Base.rut_(t);
  if (rut.normal && /\d{6,}/.test(t.replace(/\./g, ''))) {
    const c = ctxN.listaClientes.find((x) => Base.rut_(x.rut).normal === rut.normal);
    if (c) return { id: c.id, nombre: c.nombre };
  }
  const n = Base.normalizar_(t);
  const exactos = ctxN.listaClientes.filter((x) => x.n === n);
  if (exactos.length === 1) return { id: exactos[0].id, nombre: exactos[0].nombre };
  const porAlias = [];
  alias.forEach((lista, id) => { if (lista.some((a) => Base.normalizar_(a) === n)) porAlias.push(id); });
  if (porAlias.length === 1) return { id: porAlias[0], nombre: ctxN.clientes.get(porAlias[0]) };
  const parecidos = ctxN.listaClientes.filter((x) => n.length >= 4 && x.n.indexOf(n) !== -1).slice(0, 3).map((x) => x.nombre);
  return { id: '', error: (exactos.length > 1 || porAlias.length > 1 ? 'Hay varios clientes con ese nombre' : 'No encuentro el cliente «' + t.slice(0, 40) + '»') + (parecidos.length ? ' (¿' + parecidos.join(', ') + '?)' : '') + '. Elígelo de la lista.' };
}

/** Normaliza las filas pegadas con su mapeo → [{ fila, datos (para guardar), errores:{campo:mensaje}, monto, sentido }]. */
function revisarFilas_(db, filas, mapeo, contextoPegado) {
  const ctxN = FB.contextoNormalizar_(db);
  let alias = new Map();
  try { alias = require('./finanzasClientes').aliasPorCliente_(); } catch (e) { alias = new Map(); }
  const col = (fila, campo) => { const i = Object.keys(mapeo).find((k) => mapeo[k] === campo); return i === undefined ? '' : Base.txt_(fila[Number(i)]); };
  return filas.map((fila, i) => {
    const err = {};
    const e = (campo, m) => { if (!err[campo]) err[campo] = m; };
    let monto = 0, sentido = '';
    const ent = col(fila, 'entrada'), sal = col(fila, 'salida'), con = col(fila, 'monto');
    if (ent || sal) {
      const a = ent ? Base.montoClp_(ent) : { ok: true, valor: 0 }, b = sal ? Base.montoClp_(sal) : { ok: true, valor: 0 };
      if (!a.ok) e('entrada', a.error); if (!b.ok) e('salida', b.error);
      if (a.ok && b.ok) {
        if (a.valor && b.valor) e('entrada', 'La fila tiene entrada y salida a la vez.');
        else { monto = Math.abs(a.valor || b.valor); sentido = a.valor ? (a.valor > 0 ? 'ENTRADA' : 'SALIDA') : (b.valor > 0 ? 'SALIDA' : 'ENTRADA'); }
      }
    } else if (con) {
      const m = Base.montoClp_(con);
      if (!m.ok) e('monto', m.error); else { monto = Math.abs(m.valor); sentido = m.valor < 0 ? 'SALIDA' : 'ENTRADA'; }
    } else e('monto', 'Falta el monto.');
    if (monto === 0 && !err.monto && !err.entrada) e('monto', 'El monto es cero.');
    const fecha = Base.fechaCivil_(col(fila, 'fecha'));
    if (!fecha) e('fecha', col(fila, 'fecha') ? 'Fecha no válida.' : 'Falta la fecha.');
    const empresa = Cat.empresa_(col(fila, 'empresa') || contextoPegado.empresa);
    if (!empresa) e('empresa', 'Falta la empresa (elígela arriba o en una columna).');
    const tipo = tipoDesdeTexto_(col(fila, 'tipo'), sentido) || '';
    if (!tipo) e('tipo', col(fila, 'tipo') ? 'No reconozco «' + col(fila, 'tipo') + '»: usa ingreso, gasto, fondo recibido, pago por cuenta, traspaso o préstamo.' : 'Falta la naturaleza.');
    const cli = resolverCliente_(col(fila, 'cliente'), ctxN, alias);
    if (cli.error) e('cliente', cli.error);
    const conceptoTxt = col(fila, 'concepto');
    const cuentas = FB.cuentasDe_(tipo);
    const cuenta = cuentas.find((c) => Base.normalizar_(c) === Base.normalizar_(conceptoTxt)) || (cuentas.length === 1 ? cuentas[0] : '');
    if (cuentas.length && !cuenta) e('concepto', conceptoTxt ? '«' + conceptoTxt + '» no es un concepto de ' + ((FB.TIPOS[tipo] || {}).nombre || tipo) + '.' : 'Falta el concepto.');
    const po = col(fila, 'periodo_obligacion');
    const periodo_obligacion = po ? Base.periodo_(po) : '';
    if (po && !periodo_obligacion) e('periodo_obligacion', 'Período no válido.');
    const datos = {
      empresa, cuenta_ref: contextoPegado.cuenta_ref || '', fecha, sentido, medio: col(fila, 'medio') || contextoPegado.medio || 'TRANSFERENCIA', monto,
      tercero: col(fila, 'tercero'), referencia: col(fila, 'referencia'), nota: col(fila, 'nota'),
      tipo, cuenta, cliente_id: cli.id || '', periodo_obligacion, destino: col(fila, 'destino')
    };
    if (!Object.keys(err).length && tipo) {
      const n = normalizar_(db, datos, ctxN);
      n.faltantes.forEach((f) => e(f.campo === 'distribuciones' ? 'tipo' : f.campo, f.mensaje));
    }
    return { fila: i, datos, errores: err, monto, sentido, cliente: cli.nombre || '' };
  });
}

/** Paso 1: revisar lo pegado. No guarda nada; devuelve un token del contenido revisado. */
const revisarPegado = Base.conCapacidad('REGISTRAR', '', function (db, data) {
  const filas = (Array.isArray(data && data.filas) ? data.filas : []).slice(0, 2000).map((f) => (Array.isArray(f) ? f.map(Base.txt_) : []));
  const mapeo = (data && data.mapeo) || {};
  if (!filas.length) return errorValidacion('filas', 'No hay filas para revisar.');
  if (!Object.values(mapeo).some((c) => c === 'monto' || c === 'entrada' || c === 'salida')) return errorValidacion('mapeo', 'Indica qué columna trae el monto (o entrada y salida).');
  const ctxPeg = { empresa: Base.txt_(data.empresa), cuenta_ref: Base.txt_(data.cuenta_ref), medio: Base.txt_(data.medio) };
  const rev = revisarFilas_(db, filas, mapeo, ctxPeg);
  // Repetidos: dentro de lo pegado y contra lo ya registrado (solo aviso: dos operaciones iguales pueden ser legítimas).
  const vistos = new Map();
  rev.forEach((r) => {
    const k = [r.datos.fecha, r.monto, r.sentido, Base.normalizar_(r.datos.tercero), r.datos.cliente_id].join('|');
    r.repetida_en_pegado = vistos.has(k) ? vistos.get(k) : null;
    if (!vistos.has(k)) vistos.set(k, r.fila);
    r.posibles_duplicados = r.datos.fecha && r.monto ? posiblesDuplicados_({ empresa: Cat.empresa_(r.datos.empresa), sentido: r.sentido, monto: r.monto, fecha: r.datos.fecha, tercero: r.datos.tercero }) : [];
  });
  const validas = rev.filter((r) => !Object.keys(r.errores).length);
  const token = Base.digest_({ filas, mapeo, ctxPeg });
  return {
    token, filas: rev.length, validas: validas.length, con_errores: rev.length - validas.length, campos: CAMPOS_PEGADO,
    totales: { entradas: validas.filter((r) => r.sentido === 'ENTRADA').reduce((s, r) => s + r.monto, 0), salidas: validas.filter((r) => r.sentido === 'SALIDA').reduce((s, r) => s + r.monto, 0) },
    revision: rev
  };
});

/**
 * Paso 2: publicar lo revisado. Exige el MISMO token (si cambió el contenido,
 * se revisa de nuevo). Solo las filas elegidas y sin errores; cada una es su
 * propio grupo. Repetir la publicación del mismo contenido no duplica: la
 * clave de origen de cada fila es única (lote + fila).
 */
const publicarPegado = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  const filas = (Array.isArray(data && data.filas) ? data.filas : []).slice(0, 2000).map((f) => (Array.isArray(f) ? f.map(Base.txt_) : []));
  const mapeo = (data && data.mapeo) || {};
  const ctxPeg = { empresa: Base.txt_(data.empresa), cuenta_ref: Base.txt_(data.cuenta_ref), medio: Base.txt_(data.medio) };
  const token = Base.digest_({ filas, mapeo, ctxPeg });
  if (token !== Base.txt_(data.token)) return Base.errConflicto('Lo pegado cambió desde que lo revisaste. Revísalo de nuevo antes de publicar.');
  const como = Base.txt_(data.como).toUpperCase() === 'CONFIRMAR' ? 'CONFIRMAR' : 'BORRADOR';
  if (como === 'CONFIRMAR') { const e = Base.exigir_(contexto, 'CONFIRMAR'); if (e) return e; }
  const elegidas = new Set((Array.isArray(data.seleccion) ? data.seleccion : rev_indices_(filas)).map(Number));
  const rev = revisarFilas_(db, filas, mapeo, ctxPeg);
  const ctxN = FB.contextoNormalizar_(db);
  const lote = token.slice(0, 16);
  const resultados = [];
  rev.forEach((r) => {
    if (!elegidas.has(r.fila)) return;
    if (Object.keys(r.errores).length) { resultados.push({ fila: r.fila, ok: false, mensaje: Object.values(r.errores)[0] }); return; }
    const out = Base.transaccion_(() => guardarUna_(db, Object.assign({}, r.datos, { confirmar: como === 'CONFIRMAR', origen: { tipo: 'PEGADO', lote, fila: r.fila + 1, valores: filas[r.fila] } }), contexto, x, ctxN,
      { fuente: 'PEGADO', lote_id: lote, clave_origen: 'pegado|' + lote + '|' + r.fila }));
    resultados.push(out && (out._validationError || out._forbidden) ? { fila: r.fila, ok: false, mensaje: out.message } : Object.assign({ fila: r.fila, ok: !out.repetida }, out));
  });
  const ok = resultados.filter((r) => r.ok).length;
  x.registrar('PEGADO_PUBLICAR', ok + ' operación(es) ' + (como === 'CONFIRMAR' ? 'confirmadas' : 'como borrador') + ' de ' + resultados.length);
  return { lote, publicadas: ok, repetidas: resultados.filter((r) => r.repetida).length, errores: resultados.filter((r) => !r.ok && !r.repetida).length, resultados };
});
function rev_indices_(filas) { return filas.map((f, i) => i); }

// ---------------------------------------------------------------- perfiles: mapeos y plantillas (FIN-11/12)

function perfiles_(tipo, cuentaId) {
  return db_().prepare('SELECT * FROM FIN_PERFILES WHERE tipo = ? AND activo = 1 AND (cuenta_id IS NULL OR cuenta_id = ?) ORDER BY nombre').all(tipo, String(cuentaId || ''))
    .map((r) => Object.assign({ id: r.id, nombre: r.nombre, compartido: !r.cuenta_id, actualizado_por: r.actualizado_por }, Base.des_(r.datos)));
}
const perfiles = B.conBoveda('', function (db, data, contexto) {
  return { mapeos: perfiles_('MAPEO', contexto.cuenta_id), plantillas: perfiles_('PLANTILLA', contexto.cuenta_id), campos: CAMPOS_PEGADO, acciones: ACCIONES };
});
/** Guarda (o desactiva con activo:false) un mapeo de columnas o una plantilla recurrente. */
const guardarPerfil = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  const tipo = Base.txt_(data && data.tipo).toUpperCase();
  if (tipo !== 'MAPEO' && tipo !== 'PLANTILLA') return errorValidacion('tipo', 'Tipo no válido.');
  const nombre = Base.txt_(data.nombre).slice(0, 80);
  if (!nombre) return errorValidacion('nombre', 'Ponle un nombre.');
  let datos;
  if (tipo === 'MAPEO') {
    // I07.2: el perfil recuerda la estructura que reconoce (encabezado y un ejemplo) y su versión; si el
    // encabezado del archivo cambia, la pantalla avisa en vez de aplicar posiciones viejas a otro formato.
    const previo = Base.txt_(data.id) ? db_().prepare('SELECT datos FROM FIN_PERFILES WHERE id = ?').get(Base.txt_(data.id)) : null;
    const ver = previo ? (Base.des_(previo.datos).version || 1) + 1 : 1;
    datos = { mapeo: data.mapeo || {}, primera_fila_titulos: !!data.primera_fila_titulos, version: ver,
      encabezado: (Array.isArray(data.encabezado) ? data.encabezado : []).slice(0, 40).map((c) => Base.txt_(c).slice(0, 60)),
      ejemplo: (Array.isArray(data.ejemplo) ? data.ejemplo : []).slice(0, 40).map((c) => Base.txt_(c).slice(0, 40)) };
  }
  else {
    const dia = Number(data.dia);
    if (!(dia >= 1 && dia <= 31)) return errorValidacion('dia', 'Día del mes entre 1 y 31.');
    const n = normalizar_(db, Object.assign({}, data.operacion || {}, { fecha: '2026-01-' + String(Math.min(dia, 28)).padStart(2, '0') }), FB.contextoNormalizar_(db));
    const graves = n.faltantes.filter((f) => f.campo !== 'monto');
    if (graves.length) return errorValidacion(graves[0].campo, 'Plantilla: ' + graves[0].mensaje);
    datos = { dia, operacion: Object.assign({}, data.operacion, { fecha: undefined }), monto_fijo: !!(data.operacion && Base.montoClp_(data.operacion.monto).ok) };
  }
  const d = db_();
  const id = Base.txt_(data.id) || Base.id_();
  const activo = data.activo === false ? 0 : 1;
  d.prepare('INSERT INTO FIN_PERFILES (id, tipo, cuenta_id, nombre, activo, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?) ' +
    'ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, activo = excluded.activo, datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
    .run(id, tipo, data.compartido === false ? String(contexto.cuenta_id) : null, nombre, activo, Base.cif_(datos), Base.ahora_(), x.nombre);
  x.registrar('PERFIL_' + tipo, nombre + (activo ? '' : ' (desactivado)'));
  return { id };
});

/**
 * Crea los BORRADORES del mes desde las plantillas elegidas (una vez por
 * plantilla y mes: repetir no duplica). Nunca confirma: alguien revisa el
 * monto real y confirma.
 */
const generarDePlantillas = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  const periodo = Base.periodo_(data && data.periodo);
  if (!periodo) return errorValidacion('periodo', 'Elige el mes.');
  const elegidas = new Set((Array.isArray(data.ids) ? data.ids : []).map(Base.txt_));
  const ctxN = FB.contextoNormalizar_(db);
  const resultados = [];
  perfiles_('PLANTILLA', contexto.cuenta_id).filter((p) => !elegidas.size || elegidas.has(p.id)).forEach((p) => {
    const dia = Math.min(p.dia, Base.diasDelMes_(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7))));
    const r = Base.transaccion_(() => guardarUna_(db, Object.assign({}, p.operacion, { fecha: periodo + '-' + String(dia).padStart(2, '0'), confirmar: false, origen: { tipo: 'PLANTILLA', plantilla_id: p.id, nombre: p.nombre } }),
      contexto, x, ctxN, { fuente: 'PLANTILLA', clave_origen: 'plantilla|' + p.id + '|' + periodo }));
    resultados.push({ plantilla: p.nombre, id: r.id || '', repetida: !!r.repetida, error: r.message || '' });
  });
  x.registrar('PLANTILLAS_GENERAR', periodo + ': ' + resultados.filter((r) => r.id).length + ' borrador(es)');
  return { periodo, resultados };
});

// ---------------------------------------------------------------- fuentes operativas: Control interno (I05.5)

/**
 * Obligaciones de clientes que Contabilidad / RR.HH. ya llevan en Control
 * interno (CI_REGISTROS) y que Finanzas reutiliza para registrar el pago SIN
 * volver a escribir cliente, concepto, período, destino ni monto esperado.
 * Mapeo campo a campo (documentado en I05-registro.md):
 *   IVA               → concepto «IVA», destino «SII (F29)», monto = datos.monto_pago
 *   PAGO_IMPOSICIONES → concepto «Imposiciones», destino «Previred», monto = datos.total_pago_intereses
 *                       (o total_pagar_sin_intereses), texto libre convertido a CLP
 *   comunes           → cliente_id/cliente_nombre, periodo «AAAA-MNN» → «AAAA-MM», version = fecha_actualizacion
 * La relación guarda id + versión de la fila: si la obligación cambia después, el
 * pago confirmado NO se toca; el detalle avisa para revisar. Una obligación puede
 * pagarse en varias partes: no hay «una operación por obligación».
 */
const FUENTES_CI = {
  IVA: { nombre: 'IVA (F29)', concepto: 'IVA', destino: 'SII (F29)', monto: ['monto_pago'] },
  PAGO_IMPOSICIONES: { nombre: 'Pago de imposiciones', concepto: 'Imposiciones', destino: 'Previred', monto: ['total_pago_intereses', 'total_pagar_sin_intereses'] }
};
function periodoCi_(p) { const m = /^(\d{4})-M(\d{2})$/.exec(String(p || '')); return m ? m[1] + '-' + m[2] : ''; }
function filaCi_(db, id) {
  try { return require('./controlInterno').consultar_(db, 'CI_REGISTROS', { registro_id: String(id) }).find((r) => r.activa === true || r.activa === 'TRUE') || null; } catch (e) { return null; }
}
function montoCi_(datos, claves) {
  for (const k of claves) {
    const v = datos && datos[k];
    if (v === '' || v === null || v === undefined) continue;
    const m = Base.montoClp_(typeof v === 'number' ? Math.round(v) : v);
    if (m.ok && m.valor > 0) return m.valor;
  }
  return null;
}
/** Operaciones (no anuladas) que ya se registraron desde una fila de Control interno. */
function opsDeFuente_(registroId) {
  return db_().prepare("SELECT * FROM FIN_OPERACIONES WHERE estado != 'ANULADA'").all().map(publica_)
    .filter((o) => o.origen && o.origen.tipo === 'CONTROL_INTERNO' && o.origen.registro_id === registroId);
}
function fuentePublica_(r) {
  const def = FUENTES_CI[r.matriz];
  const ops = opsDeFuente_(r.registro_id);
  const esperado = montoCi_(r.datos, def.monto);
  const registrado = ops.filter((o) => o.estado === 'CONFIRMADA').reduce((s, o) => s + o.monto, 0);
  return { fuente_id: r.registro_id, matriz: r.matriz, matriz_nombre: def.nombre, version: r.fecha_actualizacion || r.fecha_creacion || '',
    cliente_id: r.cliente_id || '', cliente: r.cliente_nombre || '', periodo_obligacion: periodoCi_(r.periodo), concepto: def.concepto, destino: def.destino,
    monto_esperado: esperado, registrado, borradores: ops.filter((o) => o.estado === 'BORRADOR').length,
    pendiente: esperado === null ? null : Math.max(esperado - registrado, 0), operaciones: ops.map((o) => ({ id: o.id, estado: o.estado, monto: o.monto, fecha: o.fecha })),
    estado_ci: r.estado || '' };
}
const fuentesObligacion = B.conBoveda('', function (db, data) {
  const periodo = Base.periodo_(data && data.periodo);
  if (!periodo) return errorValidacion('periodo', 'Elige el mes de la obligación.');
  const perCi = periodo.slice(0, 4) + '-M' + periodo.slice(5, 7);
  const cli = Base.txt_(data && data.cliente_id);
  let filas = [], bloqueo = '';
  try {
    const CI = require('./controlInterno');
    Object.keys(FUENTES_CI).forEach((m) => { filas = filas.concat(CI.consultar_(db, 'CI_REGISTROS', { matriz: m, periodo: perCi, activa: true })); });
  } catch (e) { bloqueo = 'No se pudo leer Control interno: ' + e.message; }
  const lista = filas.filter((r) => !cli || r.cliente_id === cli).map(fuentePublica_)
    .sort((a, b) => (a.pendiente === 0) - (b.pendiente === 0) || a.cliente.localeCompare(b.cliente, 'es'));
  return { periodo, fuentes: lista, matrices: Object.keys(FUENTES_CI).map((k) => ({ id: k, nombre: FUENTES_CI[k].nombre })), bloqueo,
    sin_monto: lista.filter((f) => f.monto_esperado === null).length };
});
function fuente_(db, id) { const r = filaCi_(db, id); return r && FUENTES_CI[r.matriz] ? fuentePublica_(r) : null; }
/** Una fuente por su id (para abrir el formulario desde la obligación). */
const fuenteObligacion = B.conBoveda('', function (db, data) {
  const r = filaCi_(db, Base.txt_(data && data.id));
  if (!r || !FUENTES_CI[r.matriz]) return errorValidacion('id', 'Esa obligación no existe en Control interno o no es de pago (IVA, imposiciones).');
  return fuentePublica_(r);
});
/** Valida y normaliza el origen «Control interno» que manda el formulario. */
function origenCi_(db, origen) {
  if (!origen || origen.tipo !== 'CONTROL_INTERNO') return { origen: null };
  const r = filaCi_(db, origen.registro_id);
  if (!r || !FUENTES_CI[r.matriz]) return { error: 'La obligación de Control interno ya no existe.' };
  const f = fuentePublica_(r);
  return { origen: { tipo: 'CONTROL_INTERNO', registro_id: f.fuente_id, matriz: f.matriz, version: f.version, periodo_obligacion: f.periodo_obligacion, monto_esperado: f.monto_esperado, cliente_id: f.cliente_id } };
}

// ---------------------------------------------------------------- duplicar (I05.2)

/**
 * Duplica como BORRADOR: copia lo reutilizable del negocio (empresa, cuenta,
 * medio, sentido, monto, tercero, partes) con la fecha a revisar; NO copia la
 * referencia (suele ser única), vínculos bancarios, aplicaciones, aprobaciones
 * ni el origen. Queda la huella de qué se duplicó.
 */
const duplicar = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  const o = porId_(Base.txt_(data && data.id));
  if (!o) return errorValidacion('id', 'Esa operación no existe.');
  const fecha = Base.fechaCivil_(data.fecha) || o.fecha;
  return Base.idempotente_(contexto, 'duplicarOperacion', data.idempotency_key, { id: o.id, fecha }, () => Base.transaccion_(() => {
    const r = guardarUna_(db, { empresa: o.empresa, cuenta_ref: o.cuenta_ref, fecha, sentido: o.sentido, medio: o.medio, monto: o.monto, tercero: o.tercero, referencia: '',
      nota: o.nota, accion: o.accion, distribuciones: (o.distribuciones || []).map((p) => Object.assign({}, p)), confirmar: false,
      origen: { tipo: 'DUPLICADO', de: o.id, fecha_original: o.fecha } }, contexto, x, FB.contextoNormalizar_(db));
    if (!r._validationError) x.registrar('OPERACION_DUPLICAR', o.periodo + ' → ' + String(fecha || '').slice(0, 7));
    return r;
  }));
});

// ---------------------------------------------------------------- plantillas: vista previa (I05.5)

/**
 * Qué crearía «Crear borradores» para un mes, sin crear nada: una instancia por
 * plantilla (clave plantilla + mes). Si ya existe, dice su estado y en qué
 * difiere de la plantilla actual (no se sobrescribe ni se duplica).
 */
const previsualizarPlantillas = B.conBoveda('', function (db, data, contexto) {
  const periodo = Base.periodo_(data && data.periodo);
  if (!periodo) return errorValidacion('periodo', 'Elige el mes.');
  const elegidas = new Set((Array.isArray(data.ids) ? data.ids : []).map(Base.txt_));
  const d = db_();
  const instancias = perfiles_('PLANTILLA', contexto.cuenta_id).filter((p) => !elegidas.size || elegidas.has(p.id)).map((p) => {
    const dia = Math.min(p.dia, Base.diasDelMes_(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7))));
    const op = p.operacion || {};
    const mp = Base.montoClp_(op.monto);
    const fila = d.prepare('SELECT * FROM FIN_OPERACIONES WHERE clave_origen = ?').get('plantilla|' + p.id + '|' + periodo);
    let existe = null;
    if (fila) {
      const e = publica_(fila), dist = (e.distribuciones || [])[0] || {};
      const dif = [];
      if (mp.ok && mp.valor !== e.monto) dif.push('monto ' + Base.plata_(e.monto) + ' → ' + Base.plata_(mp.valor));
      if ((op.cuenta || '') !== (dist.cuenta || '')) dif.push('concepto «' + (dist.cuenta || '—') + '» → «' + (op.cuenta || '—') + '»');
      if ((op.cliente_id || '') !== (dist.cliente_id || '')) dif.push('cliente');
      existe = { id: e.id, estado: e.estado, monto: e.monto, fecha: e.fecha, diferencias: dif };
    }
    return { plantilla_id: p.id, nombre: p.nombre, fecha: periodo + '-' + String(dia).padStart(2, '0'), monto: mp.ok ? mp.valor : null, sentido: op.sentido, tipo: op.tipo, cuenta: op.cuenta || '',
      cliente_id: op.cliente_id || '', empresa: op.empresa || '', existe, accion: existe ? 'YA_EXISTE' : 'CREAR' };
  });
  return { periodo, instancias, crear: instancias.filter((i) => i.accion === 'CREAR').length, existen: instancias.filter((i) => i.existe).length };
});

// ---------------------------------------------------------------- para otros módulos

/** Edita una distribución en su lugar (gestión de fondos, destino). Respeta estado y mes cerrado. */
function actualizarDistribucion_(id, parte, editar, x) {
  const o = porId_(id);
  if (!o) return 'La operación no existe.';
  if (o.estado === 'ANULADA') return 'La operación está anulada.';
  if (cerrado_(o.periodo)) return 'El mes ' + o.periodo + ' está cerrado.';
  const datos = Base.des_(o._fila.datos);
  const c = (datos.distribuciones || [])[parte];
  if (!c) return 'Esa parte no existe.';
  const err = editar(c);
  if (err) return err;
  db_().prepare('UPDATE FIN_OPERACIONES SET datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(Base.cif_(datos), Base.ahora_(), x.nombre, id);
  return '';
}
/** Marca la conciliación de una operación (lo usa finanzasConciliacion.js dentro de su transacción). */
function marcarConciliacion_(id, estado, x) {
  db_().prepare('UPDATE FIN_OPERACIONES SET conciliacion = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(estado, Base.ahora_(), x.nombre, id);
}
/**
 * «Son distintas» (corrección v2, I01): una persona decide que esta operación y
 * ese movimiento del banco son pagos diferentes (dos cobros iguales legítimos).
 * Se guarda en la operación con quién, cuándo y por qué; quitar la marca
 * también queda en la historia. Lo usa finanzasConciliacion.marcarDistintas.
 */
function marcarDistinta_(id, movimientoId, motivo, quitar, x) {
  const o = porId_(id);
  const datos = Base.des_(o._fila.datos);
  const lista = (datos.distintas || []).filter((d) => d.movimiento_id !== movimientoId);
  if (!quitar) lista.push({ movimiento_id: movimientoId, por: x.nombre, en: Base.ahora_(), motivo });
  datos.distintas = lista;
  datos.historial = (datos.historial || []).concat([{ en: Base.ahora_(), por: x.nombre, accion: quitar ? 'QUITAR_DISTINTA' : 'MARCAR_DISTINTA', motivo, version: o.version + 1 }]).slice(-50);
  db_().prepare('UPDATE FIN_OPERACIONES SET datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(Base.cif_(datos), Base.ahora_(), x.nombre, id);
  return o.version + 1;
}
/** Deja escrito qué explica el resto no vinculado (lo usa finanzasConciliacion.explicarRemanente). */
function explicarRemanente_(id, info, x) {
  const o = porId_(id);
  const datos = Base.des_(o._fila.datos);
  datos.remanente_explicado = info;
  datos.historial = (datos.historial || []).concat([{ en: Base.ahora_(), por: x.nombre, accion: 'EXPLICAR_RESTO', motivo: info.motivo, version: o.version + 1 }]).slice(-50);
  db_().prepare('UPDATE FIN_OPERACIONES SET datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(Base.cif_(datos), Base.ahora_(), x.nombre, id);
}
function reiniciar_() { preparada_ = null; }

module.exports = {
  fuentesObligacion, fuenteObligacion, duplicar, previsualizarPlantillas, FUENTES_CI, fuente_, faltantesPublicos_,
  guardar, accionLote, listar, detalle, revisarPegado, publicarPegado, perfiles, guardarPerfil, generarDePlantillas,
  guardarInterno_: guardarUna_, hechosRegistro_, porId_, publica_, normalizar_, actualizarDistribucion_, marcarConciliacion_, marcarDistinta_, explicarRemanente_, tipoDesdeTexto_, resolverCliente_, ACCIONES, ESTADOS, CONCILIACION, reiniciar_
};
