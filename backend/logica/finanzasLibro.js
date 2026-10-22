'use strict';

/**
 * finanzasLibro.js — Finanzas v3 «banco primero» (21-10-2026).
 *
 * El libro del banco es la tabla principal de Finanzas: una fila por movimiento
 * de la cuenta, como en el Excel BANCOS, con a quién corresponde, su categoría y
 * su grupo de fondos. Este módulo:
 *
 *   1. Lleva un mes del Excel BANCOS al libro (migración de julio y agosto):
 *      empareja cada fila con su movimiento de la cartola (monto exacto, fecha
 *      ±3 días); si el mes no tiene cartola, crea el movimiento desde la planilla
 *      marcado «sin cartola» (no verificado). Clasifica según la columna OBS y el
 *      plan de cuenta, resuelve el cliente por el nombre corto y arma los grupos
 *      de fondos de la columna UNITARIO (las fórmulas =C19+C20+…).
 *   2. Calcula el resumen del mes con las MISMAS categorías del Excel BANCOS
 *      (ABONO, ABONO RENTA, SALDO de grupos, PENDIENTE) desde lo que hay en SIGSO,
 *      y el cuadre contra la cartola y contra la planilla.
 *
 * Reglas de la planilla (columna OBS) → clasificación de SIGSO:
 *   ABONO / ABONO RENTA, entra  → Ingreso de la empresa (Servicio Mensual / Servicio Renta)
 *   ABONO / ABONO RENTA, sale   → Gasto de la empresa (cuenta según el plan: sueldo, arriendo…)
 *   IMPOSICIONES, IVA, SALDO, PENDIENTE (y plan CONVENIO, PAGO DIFERIDO…)
 *                               → dinero del cliente: Fondo recibido / Pago por cuenta del cliente
 *   nombre corto de una empresa del grupo → Traspaso o Préstamo
 *   sin OBS                     → queda por revisar (con lo que dice la planilla a la vista)
 */

const crypto = require('node:crypto');
const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const F = require('./finanzasBancos');
const P = require('./finanzasPagadores');
const { errorValidacion } = require('./errores');

const I = F.interno;
const txt_ = (v) => String(v == null ? '' : v).trim();
const N = (s) => I.normalizar_(s);

// ---------------------------------------------------------------- lectura de la hoja

const COL_ = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** Filas de la hoja AYS - BCI (valores y fórmulas, como las entrega lector-xlsx) → filas con su grupo UNITARIO. */
function leerHoja_(filas, formulas) {
  filas = Array.isArray(filas) ? filas : []; formulas = Array.isArray(formulas) ? formulas : [];
  const iH = filas.findIndex((f) => Array.isArray(f) && f.some((c) => txt_(c) === 'FECHA') && f.some((c) => txt_(c) === 'TOTAL'));
  if (iH === -1) return { error: 'No reconozco la hoja: debe tener FECHA, TOTAL, DETALLE y OBS (Excel BANCOS).' };
  const cab = Array.from(filas[iH], txt_);
  const ix = (n) => cab.indexOf(n);
  const C = { total: ix('TOTAL'), fecha: ix('FECHA'), det: ix('DETALLE'), plan: ix('PLAN DE CUENTA'), unit: ix('UNITARIO'), obs: ix('OBS'), banco: ix('DETALLE BANCO') };
  if (C.total === -1 || C.fecha === -1) return { error: 'Faltan las columnas TOTAL o FECHA.' };
  const letra = COL_(C.total);
  const re = new RegExp('\\$?' + letra + '\\$?(\\d+)', 'g');
  // Resumen de arriba (SUMIF por OBS): etiqueta en la columna DETALLE, valor en la siguiente.
  const resumen = {};
  filas.slice(0, iH).forEach((f) => { const k = txt_((f || [])[C.det]); const v = Number((f || [])[C.det + 1]); if (k && isFinite(v)) resumen[N(k)] = v; });
  const out = [];
  filas.forEach((f, i) => {
    if (i <= iH || !f) return;
    const fecha = I.fechaIso_(f[C.fecha]);
    const monto = F.monto_(txt_(f[C.total]));
    if (!fecha || !monto || isNaN(monto)) return;
    const fx = txt_((formulas[i] || [])[C.unit]);
    const refs = []; let m; re.lastIndex = 0;
    while ((m = re.exec(fx))) refs.push(Number(m[1]));
    const unitV = txt_(f[C.unit]);
    out.push({ fila: i + 1, fecha, monto, alias: txt_(f[C.det]), plan: txt_(f[C.plan]), obs: N(f[C.obs]), banco: txt_(f[C.banco]),
      unitario: unitV === '' ? null : (unitV.charAt(0) === '#' ? NaN : Number(unitV)), formula: fx, refs, refRota: /#REF!/i.test(fx) });
  });
  return { filas: out, resumen, encabezado: iH + 1 };
}

/** Grupos de fondos: la fila con una fórmula que suma otras filas (=C19+C20+C22) y esas filas. */
function grupos_(filas) {
  const porFila = new Map(filas.map((r) => [r.fila, r]));
  const grupos = [];
  filas.forEach((r) => {
    if (r.refs.length < 2 && !(r.refs.length === 1 && r.refs[0] !== r.fila)) return;
    const miembros = [...new Set(r.refs.concat([r.fila]))].map((n) => porFila.get(n)).filter(Boolean);
    grupos.push({ cierre: r.fila, miembros: miembros.map((x) => x.fila), incompleto: r.refRota || miembros.length < new Set(r.refs.concat([r.fila])).size, remanente_planilla: isFinite(r.unitario) ? r.unitario : null, obs: r.obs });
  });
  return grupos;
}

// ---------------------------------------------------------------- clasificación según la planilla

const FONDO_OBS_ = ['IMPOSICIONES', 'IVA', 'SALDO', 'PENDIENTE'];
/** Concepto del fondo: el plan de cuenta manda; si no, la OBS; si no, a quién se pagó (Previred, SII, Tesorería). */
function conceptoFondo_(r) {
  const p = N(r.plan), o = r.obs, b = N(r.banco);
  if (/RENTA/.test(p)) return 'Renta';
  if (/CONVENIO/.test(p) || /TESORERIA/.test(b)) return 'Convenios';
  if (/IMPOSIC|PREVIRED/.test(p + ' ' + o) || /PREVIRED/.test(b)) return 'Imposiciones';
  if (/IVA|PAGO DIFERIDO|RECTIFICACION|F29/.test(p + ' ' + o) || /\bSII\b/.test(b)) return 'IVA';
  if (/SUELDO/.test(p)) return 'Sueldos';
  return 'Otro';
}
/** Cuenta de gasto de la empresa según el plan de cuenta de la planilla. */
function cuentaGasto_(r) {
  const p = N(r.plan);
  // El plan escrito tal cual es una cuenta del catálogo (como en la hoja FLUJO): se usa esa.
  const exacta = F.cuentasDe_('EGRESO').find((c) => N(c) === p);
  if (exacta) return exacta;
  const mapa = [[/SUELDO|ANTICIPO/, 'Sueldos'], [/FINIQUITO/, 'Finiquitos'], [/ARRIENDO/, 'Arriendo Mensual'], [/CUENTAS BASICAS|LUZ|AGUA|INTERNET|TELEF/, 'Cuentas Básicas'],
    [/HOSTING|SERVIDOR|SISTEMA|SOFTWARE/, 'Servidores y Sistemas'], [/COMISION/, 'Comisión Banco'], [/PATENTE/, 'Patente Comercial'], [/CAJA CHICA/, 'Caja Chica'],
    [/IMPOSIC/, 'Imposiciones'], [/IVA/, 'IVA'], [/RENTA/, 'Renta'], [/MULTA/, 'Multas Clientes']];
  const m = mapa.find((x) => x[0].test(p));
  const cuentas = F.cuentasDe_('EGRESO');
  return m && cuentas.indexOf(m[1]) !== -1 ? m[1] : (cuentas.indexOf('Otros Egresos') !== -1 ? 'Otros Egresos' : cuentas[cuentas.length - 1]);
}

/** Cuenta de ingreso: el plan si es una cuenta de ingreso del catálogo; si no, según la OBS. */
function cuentaIngreso_(r) {
  const exacta = F.cuentasDe_('INGRESO').find((c) => N(c) === N(r.plan));
  return exacta || (r.obs === 'ABONO RENTA' ? 'Servicio Renta' : 'Servicio Mensual');
}

/** Quién es un nombre corto: lo enseñado (FIN_ALIAS), una empresa del grupo, o el cliente por nombre (único). */
function resolverAlias_(alias, banco, ctx) {
  const ens = ctx.alias.get(P.huellaAlias_(alias));
  if (ens && ens.destino) return Object.assign({ fuente: 'enseñado' }, ens.destino);
  const prop = P.proponerAlias_(alias, ctx.clientes);
  if (prop) return Object.assign({ fuente: 'propuesta' }, prop);
  const pag = P.analizarDescripcion_(banco).pagador;
  const c = pag ? P.clientePorNombre_(pag, ctx.clientes) : null;
  if (c) return { clase: 'cliente', cliente_id: c.id, cliente: c.nombre, fuente: 'detalle del banco' };
  return null;
}

/** La clasificación que dice la planilla para una fila (o null si no alcanza para decidir). */
function clasifDeFila_(r, quien, empresaCuenta) {
  const entra = r.monto > 0;
  if (quien && quien.clase === 'empresa') {
    // La planilla cuenta lo marcado ABONO con otra empresa del grupo (arriendo, imposiciones o sueldos pagados por
    // ella o a ella) dentro del flujo propio; se respeta y queda anotada la empresa para revisarlo.
    if ((r.obs === 'ABONO' || r.obs === 'ABONO RENTA') && quien.empresa !== empresaCuenta) {
      return entra ? { tipo: 'INGRESO', cuenta: 'Otros Ingresos', nota: 'Con ' + quien.empresa + ' (empresa del grupo)' } : { tipo: 'EGRESO', cuenta: cuentaGasto_(r), nota: 'Con ' + quien.empresa + ' (empresa del grupo)' };
    }
    return quien.empresa === empresaCuenta ? { tipo: 'TRASPASO' } : { tipo: 'PRESTAMO', empresa: quien.empresa };
  }
  if (r.obs === 'ABONO' || r.obs === 'ABONO RENTA') {
    if (entra) {
      const cuentaIng = cuentaIngreso_(r);
      if (!quien || quien.clase !== 'cliente') return { tipo: 'INGRESO', cuenta: cuentaIng, falta: 'cliente' };
      return { tipo: 'INGRESO', cuenta: cuentaIng, cliente_id: quien.cliente_id };
    }
    return { tipo: 'EGRESO', cuenta: cuentaGasto_(r) };
  }
  if (FONDO_OBS_.indexOf(r.obs) !== -1 || /CONVENIO|PAGO DIFERIDO|RECTIFICACION|IMPOSIC/.test(N(r.plan))) {
    const base = entra ? { tipo: 'FONDO_RECIBIDO', subtipo: 'RECEPCION' } : { tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION' };
    if (!quien || quien.clase !== 'cliente') return Object.assign(base, { cuenta: conceptoFondo_(r), falta: 'cliente' });
    return Object.assign(base, { cuenta: conceptoFondo_(r), cliente_id: quien.cliente_id });
  }
  return null;
}

// ---------------------------------------------------------------- llevar un mes al libro

// Palabras que no distinguen a nadie (todas las constructoras se llaman «Construcciones…»).
const COMUNES_ = new Set(['SPA', 'LTDA', 'LIMITADA', 'EIRL', 'TRANSFER', 'TRANSFERENCIA', 'RECIBIDA', 'CONSTRUCCION', 'CONSTRUCCIONES', 'CONSTRUCTORA', 'CONSTRUCC', 'CONSTRUCCIONE',
  'INGENIERIA', 'SERVICIOS', 'SOCIEDAD', 'COMERCIAL', 'EMPRESA', 'PAGO', 'CUENTAS', 'VIA', 'INTERNET', 'ABONO', 'POR', 'DESDE', 'OTRO', 'BANCO', 'LINEA']);
/** ¿El nombre corto o la descripción de la planilla aparecen en lo que dice el banco del movimiento? */
function nombreCalza_(r, m) {
  const banco = N([m.d.glosa, m.d.detalle && m.d.detalle.pagador, m.d.detalle && m.d.detalle.descripcion].filter(Boolean).join(' ')).replace(/[^A-Z0-9 ]/g, ' ');
  const pag = P.analizarDescripcion_(r.banco).pagador || '';
  const palabras = N(r.alias + ' ' + pag).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter((p) => p.length >= 3 && !COMUNES_.has(p));
  if (!palabras.length) return false;
  const vb = banco.split(' ').filter(Boolean);
  return palabras.some((p) => vb.some((w) => w.length >= 3 && (w.indexOf(p.slice(0, 5)) === 0 || p.indexOf(w) === 0)));
}

function hmacFila_(lote, cuenta, r) { return I.hmac_(['planilla', cuenta, lote, r.fila, r.fecha, r.monto].join('|')); }

/**
 * Lleva un mes del Excel BANCOS al libro del banco.
 * data: { filas, formulas (de la hoja AYS - BCI), periodo 'AAAA-MM', cuenta_ref, archivo, crear_sin_cartola }
 * Devuelve el cuadre: filas emparejadas, creadas sin cartola, sin banco, clasificadas, por revisar y grupos.
 */
const llevarMes = Base.conCapacidad('MIGRAR', '', function (db, data, contexto, x) {
  const hoja = leerHoja_(data && data.filas, data && data.formulas);
  if (hoja.error) return errorValidacion('archivo', hoja.error);
  const periodo = txt_(data.periodo);
  if (!/^\d{4}-\d{2}$/.test(periodo)) return errorValidacion('periodo', 'Indica el mes (AAAA-MM).');
  const cuenta = I.cuentasMapa_().get(txt_(data.cuenta_ref));
  if (!cuenta) return errorValidacion('cuenta_ref', 'Elige la cuenta del banco de esta hoja.');
  const filas = hoja.filas.filter((r) => r.fecha.slice(0, 7) === periodo);
  if (!filas.length) return errorValidacion('periodo', 'La hoja no tiene filas de ' + periodo + '.');
  const d = I.db_();
  const lote = crypto.createHash('sha256').update(txt_(data.archivo) + '|' + periodo).digest('hex').slice(0, 16);

  // 1) Emparejar con la cartola del mes (monto exacto; fecha exacta y luego ±1..3 días).
  const desde = Base.sumarDias_(periodo + '-01', -4), hasta = Base.sumarDias_(periodo + '-31', 4);
  const movs = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE cuenta_ref = ? AND fecha BETWEEN ? AND ? ORDER BY fecha, orden').all(cuenta.id, desde, hasta)
    .map((r) => ({ r, d: I.des_(r.datos) }));
  const deCartola = movs.filter((m) => !m.d.sin_cartola && m.r.periodo === periodo).length;
  // Hay montos que se repiten el mismo día (varios abonos de $5.000.000): primero se empareja por la descripción del
  // banco (la columna DETALLE BANCO viene del mismo «Mis Movimientos»), después por el nombre, y solo al final por fecha.
  const usados = new Set();
  const par = new Map();
  const mismoMonto = (r, m) => (r.monto > 0 ? m.d.abono === r.monto : m.d.cargo === -r.monto);
  const dias = (r, m) => Base.diasHabiles_(m.r.fecha, r.fecha); // hábiles: el fin de semana no aleja al banco
  const fases = [
    { tol: 5, ok: (r, m) => r.banco && m.d.detalle && N(m.d.detalle.descripcion) === N(r.banco) },
    { tol: 3, ok: (r, m) => nombreCalza_(r, m) },
    { tol: 0, ok: () => true }, { tol: 1, ok: () => true }, { tol: 2, ok: () => true }, { tol: 3, ok: () => true }
  ];
  fases.forEach((fase) => filas.forEach((r) => {
    if (par.has(r.fila)) return;
    let mejor = -1;
    movs.forEach((m, k) => { if (!usados.has(k) && mismoMonto(r, m) && dias(r, m) <= fase.tol && fase.ok(r, m) && (mejor === -1 || dias(r, m) < dias(r, movs[mejor]))) mejor = k; });
    if (mejor >= 0) { usados.add(mejor); par.set(r.fila, movs[mejor]); }
  }));

  // 2) Lo que la cartola no trae se crea desde la planilla, marcado «sin cartola» (espera la cartola). Antes, con
  //    cartola del mes, esas filas se perdían en silencio y la planilla de SIGSO dejaba de cuadrar con el Excel
  //    (p. ej. transferencias del 31 que el banco pasa el mes siguiente). Se unen solas cuando llegue esa cartola.
  const sinCartola = data.crear_sin_cartola !== false;
  let creados = 0;
  const sinBanco = [];
  if (sinCartola) {
    const ins = d.prepare('INSERT OR IGNORE INTO FIN_MOVIMIENTOS (id, cuenta_ref, fecha, periodo, orden, huella, estado, datos, importacion_id, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const base = d.prepare('SELECT COALESCE(MAX(orden), 0) AS n FROM FIN_MOVIMIENTOS').get().n;
    const ahora = new Date().toISOString();
    d.exec('BEGIN');
    try {
      filas.forEach((r, i) => {
        if (par.has(r.fila)) return;
        const id = crypto.randomUUID();
        const res = ins.run(id, cuenta.id, r.fecha, periodo, base + i + 1, hmacFila_(lote, cuenta.id, r), 'PENDIENTE',
          I.cif_({ glosa: r.banco || r.alias, doc: '', cargo: r.monto < 0 ? -r.monto : 0, abono: r.monto > 0 ? r.monto : 0, saldo: null, sin_cartola: true,
            fuente: { tipo: 'BANCOS', archivo: txt_(data.archivo).slice(0, 120), fila: r.fila }, sugerencia: null, clasif: null }), 'planilla-' + lote, ahora, x.nombre);
        const m = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE huella = ?').get(hmacFila_(lote, cuenta.id, r));
        if (res.changes) creados++;
        if (m) par.set(r.fila, { r: m, d: I.des_(m.datos) });
      });
      d.exec('COMMIT');
    } catch (e) { d.exec('ROLLBACK'); throw e; }
  } else filas.forEach((r) => { if (!par.has(r.fila)) sinBanco.push({ fila: r.fila, fecha: r.fecha, monto: r.monto, alias: r.alias, obs: r.obs }); });

  const archivo = txt_(data.archivo).slice(0, 120);
  const gr = grupos_(hoja.filas.filter((r) => r.fecha.slice(0, 7) === periodo));
  const res = clasificarYAgrupar_(db, data, contexto, { filas, par, gr, cuenta, periodo, lote, archivo });
  x.registrar('LIBRO_DESDE_BANCOS', periodo + ' · ' + filas.length + ' filas · ' + res.clasificadas + ' clasificadas · ' + creados + ' sin cartola');
  const unidas = sinCartola && creados && deCartola ? require('./finanzasRegistro').unirConCartola_(cuenta.id, desde, Base.sumarDias_(periodo + '-01', 45)) : 0;
  return Object.assign({ periodo, filas: filas.length, emparejadas: filas.length - sinBanco.length - creados, creadas_sin_cartola: creados, unidas_despues: unidas, sin_banco: sinBanco, cartola_del_mes: deCartola, resumen_planilla: hoja.resumen }, res);
});

/**
 * Pasos 3 y 4 (compartidos con «volver a aplicar»): deja lo que dice la planilla en cada movimiento, clasifica lo
 * que alcanza y arma las gestiones de los grupos que aún no la tienen.
 */
function clasificarYAgrupar_(db, data, contexto, P0) {
  const { filas, par, gr, cuenta, periodo, lote, archivo } = P0;
  const d = I.db_();
  // Grupos de fondos (columna UNITARIO): una fila que pertenece a un grupo es dinero del cliente aunque su OBS esté vacía.
  const grupoDe = new Map();
  gr.forEach((g) => g.miembros.forEach((n) => grupoDe.set(n, g)));
  const conceptoGrupo = (g, r0) => { const ms = (g.miembros || []).map((n) => filas.find((r) => r.fila === n)).filter(Boolean); if (!ms.length && r0) ms.push(r0); return conceptoFondo_(ms.find((r) => r.plan) || ms.find((r) => r.obs && r.obs !== 'SALDO') || ms[ms.length - 1]); };

  // 3) Lo que dice la planilla queda en cada movimiento, y la clasificación se confirma si alcanza.
  const ctx = { alias: P.aliasMapa_(), clientes: I.clientes_(db) };
  const quien = new Map();
  [...new Set(filas.map((r) => r.alias))].forEach((a) => { const r0 = filas.find((r) => r.alias === a); quien.set(a, resolverAlias_(a, r0.banco, ctx)); });
  const clienteGrupo = (g) => g.miembros.map((n) => filas.find((r) => r.fila === n)).filter(Boolean).map((r) => quien.get(r.alias)).find((z) => z && z.clase === 'cliente') || null;
  const items = [], porRevisar = [];
  d.exec('BEGIN');
  try {
    filas.forEach((r) => {
      const m = par.get(r.fila); if (!m) return;
      const antes = m.d.planilla || {};
      // Al corregir una fila en la hoja (registro) no se lee la columna UNITARIO: su grupo del Excel se conserva.
      // Antes se perdía, y el grupo quedaba partido en dos letras (y las demás letras se corrían).
      const previo = !grupoDe.get(r.fila) && lote === 'registro' && antes.grupo && antes.grupo.cierre != null ? antes.grupo : null;
      const gg = grupoDe.get(r.fila) || (previo ? Object.assign({}, previo, { miembros: previo.miembros || [r.fila] }) : null);
      // fecha: la de la planilla (fecha de la transacción); el banco puede contabilizarla otro día u otro mes.
      m.d.planilla = { alias: r.alias, obs: r.obs, plan: r.plan, glosa: r.banco, fila: r.fila, fecha: r.fecha, archivo: antes.registro || (lote === 'registro' && antes.archivo) ? antes.archivo : archivo, unitario: isFinite(r.unitario) ? r.unitario : null,
        grupo: previo || (gg ? { cierre: gg.cierre, miembros: gg.miembros, incompleto: gg.incompleto, remanente: gg.remanente_planilla, obs: gg.obs } : null) };
      // Lo anotado a mano en SIGSO (registro diario) conserva quién lo anotó y su nota.
      if (antes.registro) { m.d.planilla.registro = antes.registro; m.d.planilla.nota = antes.nota || ''; }
      // La letra del grupo y el N° de factura de la hoja se conservan.
      if (antes.grupo_letra) m.d.planilla.grupo_letra = antes.grupo_letra;
      if (antes.fact) m.d.planilla.fact = antes.fact;
      d.prepare('UPDATE FIN_MOVIMIENTOS SET datos = ? WHERE id = ?').run(I.cif_(m.d), m.r.id);
      if (m.r.estado !== 'PENDIENTE') return; // lo ya confirmado no se toca
      let c = clasifDeFila_(r, quien.get(r.alias), cuenta.empresa);
      const g = gg;
      // En un grupo, todas sus filas son del cliente del grupo (aunque alguna use otro nombre corto o ninguno).
      const qg = g ? clienteGrupo(g) : null;
      if (g && qg && c && (c.tipo === 'FONDO_RECIBIDO' || c.tipo === 'FONDO_PAGADO')) { delete c.falta; c.cliente_id = qg.cliente_id; }
      // Toda fila de un grupo es dinero del cliente, también la que cierra el grupo con OBS «ABONO»: esa marca dice
      // que lo que sobra del grupo se cobra como honorario (se decide en el paso 4), no que el pago sea un gasto.
      if (g && (!c || (c.tipo !== 'FONDO_RECIBIDO' && c.tipo !== 'FONDO_PAGADO'))) {
        const q = qg || quien.get(r.alias);
        c = Object.assign(r.monto > 0 ? { tipo: 'FONDO_RECIBIDO', subtipo: 'RECEPCION' } : { tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION' }, { cuenta: conceptoGrupo(g, r) },
          q && q.clase === 'cliente' ? { cliente_id: q.cliente_id } : { falta: 'cliente' });
      }
      if (!c || c.falta) { porRevisar.push({ fila: r.fila, mov: m.r.id, motivo: !c ? 'La planilla no dice qué es (OBS vacía).' : 'Falta saber de qué cliente es «' + r.alias + '».', propuesta: c || null }); return; }
      items.push(Object.assign({ id: m.r.id, expected_version: m.r.version || 0, recordar: false }, c));
    });
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  let clasificados = 0; const errores = [];
  for (let i = 0; i < items.length; i += 400) {
    const r = F.clasificar(db, Object.assign({}, data, { items: items.slice(i, i + 400) }), contexto);
    if (r._validationError || r._forbidden) { errores.push(r.message); break; }
    clasificados += r.hechos || 0; (r.errores || []).forEach((e) => errores.push(e.mensaje || String(e)));
  }

  // 4) Grupos de fondos (UNITARIO) → gestiones del cliente, con sus movimientos asignados.
  const Fo = require('./finanzasFondos');
  const resGrupos = [];
  gr.forEach((g) => {
    const miembros = g.miembros.map((n) => filas.find((r) => r.fila === n)).filter(Boolean);
    const q = miembros.map((r) => quien.get(r.alias)).find((z) => z && z.clase === 'cliente');
    const refs = [];
    let yaAsignadas = 0, gid = '';
    miembros.forEach((r) => {
      const m = par.get(r.fila); if (!m) return;
      const fresco = I.des_(d.prepare('SELECT datos FROM FIN_MOVIMIENTOS WHERE id = ?').get(m.r.id).datos);
      const c = fresco.clasif;
      const piezas = c && c.partes ? c.partes : c ? [c] : [];
      const k = piezas.findIndex((p) => (p.tipo === 'FONDO_RECIBIDO' || p.tipo === 'FONDO_PAGADO') && q && p.cliente_id === q.cliente_id);
      if (k !== -1) { if (piezas[k].gestion_id) { yaAsignadas++; gid = piezas[k].gestion_id; } else refs.push('mov:' + m.r.id + ':' + k); }
    });
    const suma = miembros.reduce((s, r) => s + r.monto, 0);
    const item = { cierre: g.cierre, filas: miembros.length, cliente: q ? q.cliente : '', remanente_planilla: g.remanente_planilla, suma_filas: suma, incompleto: g.incompleto, asignadas: 0 };
    // Volver a aplicar no duplica la gestión: lo nuevo del grupo se suma a la que ya tiene.
    if (yaAsignadas) { item.ya_estaba = true; item.gestion_id = gid; if (refs.length) item.asignadas = (Fo.asignarGestion(db, Object.assign({}, data, { refs, gestion_id: gid }), contexto).hechos || 0); }
    if (q && refs.length && !yaAsignadas) {
      const concepto = conceptoGrupo(g);
      const gest = Fo.guardarGestion(db, Object.assign({}, data, { cliente_id: q.cliente_id, empresa: cuenta.empresa, obligacion: concepto,
        periodo_obligacion: Base.sumarDias_(periodo + '-01', -1).slice(0, 7), nota: 'Desde el Excel BANCOS (fila ' + g.cierre + (g.incompleto ? ', grupo con filas de otro mes' : '') + ')' }), contexto);
      if (!gest._validationError) {
        const a = Fo.asignarGestion(db, Object.assign({}, data, { refs, gestion_id: gest.id }), contexto);
        item.asignadas = a.hechos || 0; item.gestion_id = gest.id;
        const ge = (Fo.fichaCliente_(q.cliente_id, '').gestiones || []).find((y) => y.id === gest.id);
        item.saldo_sigso = ge ? ge.saldo : null;
        // Lo que dice la fila que cierra el grupo sobre el remanente: ABONO / ABONO RENTA = se cobra como honorario;
        // SALDO = queda como saldo del cliente; PENDIENTE = la gestión sigue abierta.
        const cierre = filas.find((r) => r.fila === g.cierre);
        const ver = () => (d.prepare('SELECT version FROM FIN_GESTIONES WHERE id = ?').get(gest.id) || {}).version;
        if (cierre && (cierre.obs === 'ABONO' || cierre.obs === 'ABONO RENTA') && item.saldo_sigso > 0) {
          const dec = Fo.decidirRemanente(db, Object.assign({}, data, { gestion_id: gest.id, decision: 'HONORARIO', respaldo: 'Excel BANCOS, fila ' + g.cierre + ' (OBS ' + cierre.obs + ')', expected_version: ver() }), contexto);
          if (!dec._validationError) {
            const cv = Fo.convertirRemanente(db, Object.assign({}, data, { gestion_id: gest.id, monto: item.saldo_sigso, fecha: cierre.fecha, cuenta: cierre.obs === 'ABONO RENTA' ? 'Servicio Renta' : 'Servicio Mensual',
              idempotency_key: 'libro|' + lote + '|' + g.cierre, expected_version: ver() }), contexto);
            if (cv._validationError) item.error = cv.message; else { item.honorario = item.saldo_sigso; item.saldo_sigso = 0; }
          } else item.error = dec.message;
        } else if (cierre && cierre.obs === 'SALDO' && item.saldo_sigso) {
          Fo.decidirRemanente(db, Object.assign({}, data, { gestion_id: gest.id, decision: 'MANTENER', nota: 'Excel BANCOS, fila ' + g.cierre + ' (OBS SALDO)', expected_version: ver() }), contexto);
        }
      } else item.error = gest.message;
    }
    resGrupos.push(item);
  });

  return { clasificadas: clasificados, por_revisar: porRevisar, errores, grupos: resGrupos,
    nombres: [...quien.entries()].map(([a, q]) => ({ alias: a, quien: q ? (q.cliente || q.empresa || q.cuenta || q.clase) : null, fuente: q ? q.fuente : null })) };
}

/**
 * Vuelve a aplicar lo que dijo la planilla a las filas del mes que siguen por revisar (por ejemplo, después de
 * enseñar a SIGSO de quién es un nombre corto). No hace falta volver a subir el Excel: cada movimiento guardó su fila.
 */
const reaplicar = Base.conCapacidad('CONFIRMAR', '', function (db, data, contexto, x) {
  const periodo = txt_(data && data.periodo);
  if (!/^\d{4}-\d{2}$/.test(periodo)) return errorValidacion('periodo', 'Indica el mes (AAAA-MM).');
  const d = I.db_();
  const cuentas = I.cuentasMapa_();
  const porCuenta = new Map();
  d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE periodo = ?').all(periodo).forEach((r) => {
    const m = I.des_(r.datos);
    if (!m.planilla || !m.planilla.fila) return;
    const l = porCuenta.get(r.cuenta_ref) || []; l.push({ r, d: m }); porCuenta.set(r.cuenta_ref, l);
  });
  let clasificadas = 0, grupos = 0; const por_revisar = [];
  porCuenta.forEach((lista, cuentaRef) => {
    const par = new Map(); const filas = []; const gs = new Map();
    lista.forEach((m) => {
      const p = m.d.planilla;
      filas.push({ fila: p.fila, fecha: p.fecha || m.r.fecha, monto: (m.d.abono || 0) - (m.d.cargo || 0), alias: p.alias || '', plan: p.plan || '', obs: p.obs || '', banco: p.glosa || '', unitario: p.unitario });
      par.set(p.fila, m);
      if (p.grupo) gs.set(p.grupo.cierre, { cierre: p.grupo.cierre, miembros: p.grupo.miembros, incompleto: p.grupo.incompleto, remanente_planilla: p.grupo.remanente, obs: p.grupo.obs });
    });
    const res = clasificarYAgrupar_(db, data, contexto, { filas, par, gr: [...gs.values()], cuenta: cuentas.get(cuentaRef), periodo, lote: 'reaplicar-' + periodo, archivo: (lista[0].d.planilla || {}).archivo || '' });
    clasificadas += res.clasificadas; grupos += res.grupos.filter((g) => g.gestion_id).length; res.por_revisar.forEach((p) => por_revisar.push(p));
  });
  x.registrar('LIBRO_REAPLICAR', periodo + ' · ' + clasificadas + ' clasificadas · ' + grupos + ' grupos');
  return { periodo, clasificadas, grupos_nuevos: grupos, por_revisar };
});

// ---------------------------------------------------------------- el libro y su resumen

/** Categoría con las palabras del Excel BANCOS para una pieza clasificada. */
function categoria_(c) {
  if (!c || !c.tipo) return 'SIN CLASIFICAR';
  if (c.tipo === 'INGRESO') return c.cuenta === 'Servicio Renta' ? 'ABONO RENTA' : 'ABONO';
  if (c.tipo === 'EGRESO') return 'GASTO';
  if (c.tipo === 'FONDO_RECIBIDO' || c.tipo === 'FONDO_PAGADO') return 'FONDOS';
  return c.tipo; // TRASPASO, PRESTAMO
}

/**
 * El libro del banco de un mes: cada movimiento con su categoría, su saldo
 * acumulado (como la columna SALDO del Excel BANCOS) y el resumen por categoría.
 */
const libro = B.conBoveda('', function (db, data, contexto) {
  const periodo = /^\d{4}-\d{2}$/.test(txt_(data && data.periodo)) ? data.periodo : '';
  if (!periodo) return errorValidacion('periodo', 'Indica el mes (AAAA-MM).');
  const cuentas = I.cuentasMapa_();
  const cuentaRef = txt_(data.cuenta_ref);
  const d = I.db_();
  const filas = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE periodo = ? ' + (cuentaRef ? 'AND cuenta_ref = ? ' : '') + 'ORDER BY cuenta_ref, fecha, orden').all(...[periodo].concat(cuentaRef ? [cuentaRef] : []));
  const Fo = require('./finanzasFondos');
  const gestiones = Fo.gestionesMapa_();
  const res = { ABONO: 0, 'ABONO RENTA': 0, GASTO: 0, FONDOS: 0, TRASPASO: 0, PRESTAMO: 0, 'SIN CLASIFICAR': 0 };
  // Por concepto (para el resumen tipo FLUJO) y por cliente (para Clientes): pieza a pieza, con y sin banco.
  const conceptos = {}, porCliente = {};
  const sumar = (p, monto, fueraBanco) => {
    const cat = categoria_(p);
    const k = cat + '|' + (p.tipo || '') + '|' + (p.cuenta || '');
    const c = conceptos[k] || (conceptos[k] = { categoria: cat, tipo: p.tipo || '', cuenta: p.cuenta || '', monto: 0, fuera_banco: 0 });
    c.monto += monto; if (fueraBanco) c.fuera_banco += monto;
    if (p.cliente_id) {
      const q = porCliente[p.cliente_id] || (porCliente[p.cliente_id] = { cliente_id: p.cliente_id, cliente: p.cliente || '', honorarios: 0, fondos_recibidos: 0, fondos_pagados: 0, filas: 0 });
      q.filas++;
      if (p.tipo === 'INGRESO') q.honorarios += monto;
      if (p.tipo === 'FONDO_RECIBIDO') q.fondos_recibidos += monto;
      if (p.tipo === 'FONDO_PAGADO') q.fondos_pagados += monto;
    }
  };
  let acumulado = 0, sinCartola = 0, verificados = 0;
  const lineas = filas.map((r) => {
    const m = I.des_(r.datos);
    const monto = (m.abono || 0) - (m.cargo || 0);
    acumulado += monto;
    if (m.sin_cartola) sinCartola++; else verificados++;
    const c = r.estado === 'CONFIRMADO' ? m.clasif : null;
    const piezas = c && c.partes ? c.partes : c ? [Object.assign({ monto: Math.abs(monto) }, c)] : [];
    if (!piezas.length) res['SIN CLASIFICAR'] += monto;
    piezas.forEach((p) => { const v = (monto < 0 ? -1 : 1) * (p.monto || Math.abs(monto)); res[categoria_(p)] += v; sumar(p, v, false); });
    const p0 = piezas[0] || null;
    const g = p0 && p0.gestion_id ? gestiones.get(p0.gestion_id) : null;
    const cu = cuentas.get(r.cuenta_ref) || {};
    return { id: r.id, version: r.version || 0, fecha: r.fecha, cuenta_ref: r.cuenta_ref, cuenta: (cu.banco || '') + ' ···' + (cu.ultimos4 || ''), empresa: cu.empresa, glosa: m.glosa,
      quien: (m.detalle && m.detalle.pagador) || (m.planilla && m.planilla.alias) || '', monto, saldo_mes: acumulado, saldo_banco: m.saldo,
      estado: r.estado, verificado: !m.sin_cartola, categoria: categoria_(p0), partes: piezas.length,
      cliente: p0 ? (p0.cliente || '') : '', cuenta_concepto: p0 ? (p0.cuenta || '') : '', grupo: g ? { id: g.id, obligacion: g.obligacion, periodo: g.periodo_obligacion } : null,
      planilla: m.planilla ? { alias: m.planilla.alias, obs: m.planilla.obs, plan: m.planilla.plan, glosa: m.planilla.glosa || '', nota: m.planilla.nota || '', registro: !!m.planilla.registro,
        por: m.planilla.registro ? m.planilla.registro.por : '', archivo: m.planilla.archivo || '' } : null,
      // Dónde está la fila: en la cartola (y anotada), anotada esperando la cartola, o en la cartola sin anotar.
      banco: m.sin_cartola ? 'esperando' : (m.planilla || r.estado === 'CONFIRMADO') ? 'ok' : 'falta_anotar',
      en_grupo: piezas.some((p) => p.gestion_id), unida: !!m.unida, sugerencia: m.sugerencia || null };
  });
  // Lo que no pasa por el banco (efectivo, compensaciones, remanentes cobrados como honorario): va en el libro con su
  // categoría, pero no mueve el saldo del banco.
  const Op = require('./finanzasOperaciones');
  const fueraBanco = { ABONO: 0, 'ABONO RENTA': 0, GASTO: 0, FONDOS: 0, TRASPASO: 0, PRESTAMO: 0, 'SIN CLASIFICAR': 0 };
  const lineasSinBanco = (Op.listar(db, Object.assign({}, data, { periodo, filtro: 'todas' }), contexto).operaciones || [])
    .filter((o) => o.estado === 'CONFIRMADA' && ['EFECTIVO', 'COMPENSACION'].indexOf(o.medio) !== -1)
    .map((o) => {
      const signo = o.sentido === 'SALIDA' ? -1 : 1;
      (o.distribuciones || []).forEach((p) => { const v = signo * (p.monto || o.monto); fueraBanco[categoria_(p)] += v; sumar(p, v, true); });
      const p0 = (o.distribuciones || [])[0] || {};
      return { id: 'op:' + o.id, fecha: o.fecha, fuera_banco: true, medio: o.medio, glosa: o.nota || o.tercero || '', quien: o.tercero || '', monto: signo * o.monto,
        estado: 'CONFIRMADO', verificado: null, categoria: categoria_(p0), cliente: p0.cliente || '', cuenta_concepto: p0.cuenta || '' };
    });
  // Cuadre con la cartola: saldo inicial (saldo del primer movimiento menos su monto) y final.
  const conSaldo = lineas.filter((l) => l.verificado && l.saldo_banco !== null && l.saldo_banco !== undefined);
  const cartola = conSaldo.length ? { saldo_inicial: conSaldo[0].saldo_banco - conSaldo[0].monto, saldo_final: conSaldo[conSaldo.length - 1].saldo_banco } : null;
  const meses = d.prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS ORDER BY periodo DESC').all().map((x) => x.periodo);
  const listaCuentas = [...cuentas.values()].map((c) => ({ id: c.id, nombre: (c.banco || '') + ' ···' + (c.ultimos4 || ''), empresa: c.empresa }));
  // Para anotar rápido: los planes de cuenta ya usados y los nombres cortos que SIGSO ya sabe de quién son.
  const planes = new Set(['ABONO', 'ARRIENDO', 'SUELDO', 'ANTICIPO SUELDO', 'IMPOSICIONES', 'IVA', 'CONVENIO', 'RENTA', 'CUENTAS BASICAS', 'COMISION', 'CAJA CHICA', 'FINIQUITO']);
  d.prepare('SELECT datos FROM FIN_MOVIMIENTOS WHERE periodo >= ?').all(Base.sumarDias_(periodo + '-01', -100).slice(0, 7)).forEach((r) => { const p = I.des_(r.datos).planilla; if (p && p.plan) planes.add(N(p.plan)); });
  const alias = [...P.aliasMapa_().values()].map((a) => ({ alias: a.alias, quien: a.destino ? (a.destino.cliente || a.destino.empresa || a.destino.cuenta || '') : '', clase: a.destino ? a.destino.clase : '' }))
    .filter((a) => a.clase !== 'ignorar').sort((a, b) => a.alias.localeCompare(b.alias, 'es'));
  const cuenta_ = (k) => lineas.filter((l) => l.banco === k).length;
  return { periodo, meses, cuentas: listaCuentas, conceptos: Object.values(conceptos), por_cliente: Object.values(porCliente), lineas, resumen: res, neto: acumulado, sin_cartola: sinCartola, verificados, cartola, fuera_banco: { lineas: lineasSinBanco, resumen: fueraBanco },
    por_revisar: lineas.filter((l) => l.estado !== 'CONFIRMADO').length,
    estado_banco: { ok: cuenta_('ok'), esperando: cuenta_('esperando'), falta_anotar: cuenta_('falta_anotar') },
    obs: require('./finanzasRegistro').OBS, planes: [...planes].sort(), alias };
});

/**
 * Forma un grupo de fondos desde el libro (lo que en el Excel BANCOS es la fórmula de UNITARIO): marca varias filas,
 * dice de qué cliente y obligación son, y SIGSO las clasifica como dinero del cliente, crea la gestión y las asigna.
 * data: { ids: [movimiento], versiones: {id: version}, cliente_id, obligacion, periodo_obligacion }
 */
const agrupar = Base.conCapacidad('FONDOS', '', function (db, data, contexto) {
  const ids = (Array.isArray(data && data.ids) ? data.ids : []).map(txt_).filter(Boolean).slice(0, 60);
  if (ids.length < 1) return errorValidacion('ids', 'Marca las filas del grupo.');
  const cli = I.clientes_(db).find((c) => c.id === txt_(data.cliente_id));
  if (!cli) return errorValidacion('cliente_id', 'Elige el cliente del grupo.');
  const previa = txt_(data.gestion_id) ? require('./finanzasFondos').gestionesMapa_().get(txt_(data.gestion_id)) : null;
  const obligacion = previa ? previa.obligacion : txt_(data.obligacion);
  if (F.cuentasDe_('FONDO_RECIBIDO').indexOf(obligacion) === -1) return errorValidacion('obligacion', 'Elige qué obligación es (imposiciones, IVA, convenio…).');
  const d = I.db_();
  const versiones = data.versiones || {};
  const movs = ids.map((id) => d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ?').get(id)).filter(Boolean);
  if (movs.length !== ids.length) return errorValidacion('ids', 'Alguna fila ya no existe: recarga el libro.');
  const cuentas = I.cuentasMapa_();
  const empresa = (cuentas.get(movs[0].cuenta_ref) || {}).empresa;
  // 1) Las filas que no estén ya como dinero de ESTE cliente se clasifican así (entra = recibido, sale = pago).
  const items = [];
  movs.forEach((r) => {
    const m = I.des_(r.datos);
    const c = r.estado === 'CONFIRMADO' ? m.clasif : null;
    const ya = c && !c.partes && (c.tipo === 'FONDO_RECIBIDO' || c.tipo === 'FONDO_PAGADO') && c.cliente_id === cli.id;
    if (ya) return;
    const entra = (m.abono || 0) > 0;
    // Una fila ya confirmada exige la versión que la persona tenía a la vista (I11.2); una pendiente, no.
    items.push({ id: r.id, expected_version: r.estado === 'PENDIENTE' ? undefined : versiones[r.id], recordar: false, tipo: entra ? 'FONDO_RECIBIDO' : 'FONDO_PAGADO', subtipo: entra ? 'RECEPCION' : 'PAGO_OBLIGACION', cuenta: obligacion, cliente_id: cli.id });
  });
  if (items.length) {
    const r = F.clasificar(db, Object.assign({}, data, { items }), contexto);
    if (r._validationError || r._forbidden) return r;
    if (r.errores && r.errores.length) return errorValidacion('ids', r.errores[0].mensaje || 'No se pudo clasificar una fila.');
  }
  // 2) La gestión del grupo (nueva, o una que ya existe: el cliente mandó más dinero después) y sus filas.
  const Fo = require('./finanzasFondos');
  let gest;
  if (txt_(data.gestion_id)) {
    gest = Fo.gestionesMapa_().get(txt_(data.gestion_id));
    if (!gest || gest.cliente_id !== cli.id) return errorValidacion('gestion_id', 'Ese grupo no es de este cliente.');
  } else {
    gest = Fo.guardarGestion(db, Object.assign({}, data, { cliente_id: cli.id, empresa, obligacion, periodo_obligacion: txt_(data.periodo_obligacion) || '', nota: 'Grupo formado en el libro del banco' }), contexto);
    if (gest._validationError || gest._forbidden) return gest;
  }
  const a = Fo.asignarGestion(db, Object.assign({}, data, { refs: ids.map((id) => 'mov:' + id + ':0'), gestion_id: gest.id }), contexto);
  let ge = (Fo.fichaCliente_(cli.id, '').gestiones || []).find((y) => y.id === gest.id);
  // 3) Lo que sobra, como dice la OBS de la fila que cierra el grupo en el Excel: ABONO = se cobra como honorario,
  //    SALDO = queda a favor del cliente, PENDIENTE (o nada) = el grupo sigue abierto.
  const remanente = txt_(data.remanente).toUpperCase();
  const saldo = ge ? ge.saldo : 0;
  const ver = () => (I.db_().prepare('SELECT version FROM FIN_GESTIONES WHERE id = ?').get(gest.id) || {}).version;
  let honorario = 0;
  if ((remanente === 'ABONO' || remanente === 'ABONO RENTA') && saldo > 0) {
    const fecha = movs.map((r) => r.fecha).sort().pop();
    const dec = Fo.decidirRemanente(db, Object.assign({}, data, { gestion_id: gest.id, decision: 'HONORARIO', respaldo: 'Grupo del libro del banco (OBS ' + remanente + ')', expected_version: ver() }), contexto);
    if (dec._validationError) return dec;
    const cv = Fo.convertirRemanente(db, Object.assign({}, data, { gestion_id: gest.id, monto: saldo, fecha, cuenta: remanente === 'ABONO RENTA' ? 'Servicio Renta' : 'Servicio Mensual',
      idempotency_key: 'grupo|' + gest.id + '|' + saldo + '|' + fecha, expected_version: ver() }), contexto);
    if (cv._validationError) return cv;
    honorario = saldo;
  } else if (remanente === 'SALDO' && saldo) {
    Fo.decidirRemanente(db, Object.assign({}, data, { gestion_id: gest.id, decision: 'MANTENER', nota: 'Grupo del libro del banco (OBS SALDO)', expected_version: ver() }), contexto);
  }
  if (honorario) ge = (Fo.fichaCliente_(cli.id, '').gestiones || []).find((y) => y.id === gest.id);
  return { gestion_id: gest.id, asignadas: a.hechos || 0, errores: a.errores || [], saldo: ge ? ge.saldo : null, honorario, cliente: cli.nombre };
});

/** Saca filas de su grupo de fondos (siguen siendo dinero del cliente, sin grupo). data: { ids } */
const sacarDeGrupo = Base.conCapacidad('FONDOS', '', function (db, data, contexto) {
  const ids = (Array.isArray(data && data.ids) ? data.ids : []).map(txt_).filter(Boolean).slice(0, 60);
  if (!ids.length) return errorValidacion('ids', 'Marca las filas que salen del grupo.');
  const d = I.db_();
  const refs = [];
  ids.forEach((id) => {
    const r = d.prepare('SELECT datos FROM FIN_MOVIMIENTOS WHERE id = ?').get(id); if (!r) return;
    const c = I.des_(r.datos).clasif;
    (c && c.partes ? c.partes : c ? [c] : []).forEach((p, k) => { if (p.gestion_id) refs.push('mov:' + id + ':' + k); });
  });
  if (!refs.length) return errorValidacion('ids', 'Ninguna de esas filas está en un grupo.');
  const r = require('./finanzasFondos').asignarGestion(db, Object.assign({}, data, { refs, gestion_id: '' }), contexto);
  return { sacadas: r.hechos || 0, errores: r.errores || [] };
});

/**
 * Nombres cortos de la planilla que SIGSO aún no sabe de quién son (en las filas por revisar de un mes), con cuántas
 * filas y cuánto suman, lo que dice el banco y hasta 3 clientes candidatos por parecido de nombre (para elegir, nunca
 * se elige solo).
 */
const nombres = B.conBoveda('', function (db, data) {
  const periodo = /^\d{4}-\d{2}$/.test(txt_(data && data.periodo)) ? data.periodo : '';
  const d = I.db_();
  const clientes = I.clientes_(db);
  const alias = P.aliasMapa_();
  const grupos = new Map();
  d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE estado = ? ' + (periodo ? 'AND periodo = ?' : '')).all(...['PENDIENTE'].concat(periodo ? [periodo] : [])).forEach((r) => {
    const m = I.des_(r.datos);
    const a = m.planilla && m.planilla.alias; if (!a) return;
    if (alias.get(P.huellaAlias_(a))) return; // ya enseñado: no es un nombre pendiente
    const g = grupos.get(N(a)) || { alias: a, filas: 0, entra: 0, sale: 0, banco: new Set(), obs: new Set() };
    g.filas++; if (m.abono) g.entra += m.abono; if (m.cargo) g.sale += m.cargo;
    const pag = (m.detalle && m.detalle.pagador) || P.analizarDescripcion_(m.planilla.glosa).pagador; if (pag) g.banco.add(pag);
    if (m.planilla.obs) g.obs.add(m.planilla.obs);
    grupos.set(N(a), g);
  });
  const palabras = (t) => N(t).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter((p) => p.length >= 3 && !COMUNES_.has(p));
  const lista = [...grupos.values()].map((g) => {
    const pw = palabras(g.alias + ' ' + [...g.banco].join(' '));
    const cand = clientes.map((c) => { const cw = palabras(c.nombre); const n = pw.filter((p) => cw.some((w) => w.indexOf(p.slice(0, 5)) === 0 || p.indexOf(w) === 0)).length; return { id: c.id, nombre: c.nombre, rut: c.rut, n }; })
      .filter((c) => c.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
    const empresa = F.empresaEnTexto_(g.alias);
    // Solo se propone de entrada si el parecido es claro: dos palabras en común, o una sola y sin otro candidato.
    const clara = cand.length && (cand[0].n >= 2 || (cand.length === 1 && pw.length === 1 && pw[0].length >= 5));
    return { alias: g.alias, filas: g.filas, entra: g.entra, sale: g.sale, quien_paga: [...g.banco].slice(0, 3), obs: [...g.obs], candidatos: cand, propuesta_clara: !!clara, empresa: empresa || '' };
  }).sort((a, b) => b.filas - a.filas);
  return { periodo, nombres: lista };
});

/**
 * Resumen tipo «FLUJO» (como las hojas FLUJO de la planilla): por concepto, mes a mes, para los últimos N meses
 * hasta el pedido. data: { hasta 'AAAA-MM', meses (1..12), cuenta_ref }
 */
const flujo = B.conBoveda('', function (db, data, contexto) {
  const hasta = /^\d{4}-\d{2}$/.test(txt_(data && data.hasta)) ? data.hasta : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7);
  const n = Math.min(12, Math.max(1, Number(data && data.meses) || 6));
  const meses = [];
  for (let i = n - 1; i >= 0; i--) { const [a, m] = hasta.split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 - i, 1)); meses.push(d.toISOString().slice(0, 7)); }
  const filas = {};
  const totales = {};
  meses.forEach((p) => {
    const l = libro(db, Object.assign({}, data, { periodo: p }), contexto);
    if (l._validationError) return;
    totales[p] = { neto: l.neto, sin_cartola: l.sin_cartola, verificados: l.verificados, por_revisar: l.por_revisar, cartola: l.cartola };
    l.conceptos.forEach((c) => {
      const k = c.categoria + '|' + c.tipo + '|' + c.cuenta;
      const f = filas[k] || (filas[k] = { categoria: c.categoria, tipo: c.tipo, cuenta: c.cuenta, valores: {} });
      f.valores[p] = (f.valores[p] || 0) + c.monto;
    });
    if (l.resumen['SIN CLASIFICAR']) { const f = filas['SIN CLASIFICAR||'] || (filas['SIN CLASIFICAR||'] = { categoria: 'SIN CLASIFICAR', tipo: '', cuenta: '', valores: {} }); f.valores[p] = l.resumen['SIN CLASIFICAR']; }
  });
  return { meses, filas: Object.values(filas), totales };
});

/** Los clientes con movimiento en el mes: honorarios, fondos recibidos y pagados, su saldo de fondos y lo que deben en facturas. */
const clientesMes = B.conBoveda('', function (db, data, contexto) {
  const l = libro(db, data, contexto);
  if (l._validationError) return l;
  const Fo = require('./finanzasFondos');
  const fondos = Fo.fondos(db, Object.assign({}, data), contexto);
  const saldoFondos = new Map(((fondos && fondos.clientes) || []).map((c) => [c.cliente_id, c]));
  let facturas = [];
  try { facturas = (require('./finanzasCobranza').facturas(db, Object.assign({}, data, { estado: 'abiertas' }), contexto).facturas || []); } catch (e) { facturas = []; }
  const deuda = new Map();
  facturas.forEach((f) => { const q = deuda.get(f.cliente_id) || { n: 0, saldo: 0 }; q.n++; q.saldo += f.saldo_confirmado || 0; deuda.set(f.cliente_id, q); });
  const ids = new Set(l.por_cliente.map((c) => c.cliente_id));
  saldoFondos.forEach((v, k) => { if (v.saldo) ids.add(k); });
  deuda.forEach((v, k) => ids.add(k));
  const nombres = new Map(I.clientes_(db).map((c) => [c.id, c]));
  const lista = [...ids].map((id) => {
    const c = l.por_cliente.find((x) => x.cliente_id === id) || { honorarios: 0, fondos_recibidos: 0, fondos_pagados: 0, filas: 0 };
    const f = saldoFondos.get(id) || {}, dd = deuda.get(id) || { n: 0, saldo: 0 };
    const k = nombres.get(id) || {};
    return { cliente_id: id, cliente: k.nombre || c.cliente || f.cliente || id, rut: k.rut || '', filas: c.filas, honorarios: c.honorarios, fondos_recibidos: c.fondos_recibidos, fondos_pagados: c.fondos_pagados,
      fondos_saldo: f.saldo || 0, fondos_parcial: !!f.parcial, facturas_abiertas: dd.n, deuda: dd.saldo };
  }).sort((a, b) => (b.filas - a.filas) || (Math.abs(b.fondos_saldo) - Math.abs(a.fondos_saldo)));
  return { periodo: l.periodo, meses: l.meses, clientes: lista };
});

module.exports = { llevarMes, libro, agrupar, sacarDeGrupo, reaplicar, nombres, flujo, clientesMes, leerHoja_, grupos_, clasifDeFila_, conceptoFondo_, cuentaGasto_, categoria_,
  interno: { clasificarYAgrupar_, nombreCalza_, resolverAlias_, cuentaIngreso_, COMUNES_ } };
