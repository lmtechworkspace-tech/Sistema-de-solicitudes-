'use strict';

/**
 * finanzasRegistro.js — Registro diario del banco (Finanzas v3, 21-10-2026).
 *
 * Lo que hoy se anota en el Excel BANCOS, ahora directo en SIGSO: cada fila con
 * su fecha, el monto (+ entra / − sale), el nombre corto, el plan de cuenta, la
 * OBS y lo que dice el banco. Con eso SIGSO clasifica igual que con la planilla
 * (ABONO = honorario, IMPOSICIONES/IVA/SALDO/PENDIENTE = plata del cliente…).
 *
 * El banco es la verdad, pero llega después (la cartola) y sin todo el detalle
 * («pago en internet» no dice de quién). Por eso:
 *   - Si el movimiento ya está en la cartola, la anotación queda EN ese movimiento.
 *   - Si todavía no, queda como fila «esperando cartola»; al subir la cartola se
 *     une sola con su movimiento del banco (mismo monto, fecha ±3 días, primero
 *     por el nombre) y pasa a verificada, sin perder lo anotado ni su grupo.
 *   - Lo que la cartola trae y nadie anotó queda «falta anotar» en el libro.
 */

const crypto = require('node:crypto');
const Base = require('./finanzasBase');
const F = require('./finanzasBancos');
const Lb = require('./finanzasLibro');
const { errorValidacion } = require('./errores');

const I = F.interno;
const txt_ = (v) => String(v == null ? '' : v).trim();
const N = (s) => I.normalizar_(s);

/** Las marcas de la columna OBS del Excel BANCOS (vacía = la decide quien revisa). */
const OBS = ['ABONO', 'ABONO RENTA', 'IMPOSICIONES', 'IVA', 'SALDO', 'PENDIENTE'];
// Las filas anotadas en SIGSO se numeran desde aquí para no chocar con las filas del Excel del mismo mes.
const FILA_BASE_ = 100000;

const cerrado_ = (periodo) => { try { return require('./finanzasCierre').mesCerrado_(periodo); } catch (e) { return false; } };
const enGrupo_ = (d) => { const c = d.clasif; const ps = c && c.partes ? c.partes : c ? [c] : []; return ps.some((p) => p.gestion_id); };
const dias_ = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

/** Una fila escrita por la persona → { fecha, monto, alias, plan, obs, glosa, nota } o { error }. */
function leerFila_(f) {
  f = f || {};
  const fecha = I.fechaIso_(txt_(f.fecha));
  if (!fecha) return { error: 'Falta la fecha (día-mes-año).' };
  const m = Base.montoClp_(f.monto);
  if (!m.ok || !m.valor) return { error: 'Falta el monto: positivo si entró, negativo si salió.' };
  const obs = N(f.obs);
  if (obs && OBS.indexOf(obs) === -1) return { error: 'OBS no válida: usa ' + OBS.join(', ') + ' o déjala vacía.' };
  const alias = txt_(f.alias).slice(0, 80);
  if (!alias) return { error: 'Falta el nombre (como lo anotan en la planilla: el cliente, «ARRIENDO», «SUELDO»…).' };
  return { fecha, monto: m.valor, alias, plan: txt_(f.plan).slice(0, 80).toUpperCase(), obs, glosa: txt_(f.glosa).slice(0, 200), nota: txt_(f.nota).slice(0, 300) };
}

/** Movimientos de la cuenta alrededor de unas fechas, descifrados. */
function movsRango_(cuentaId, desde, hasta) {
  return I.db_().prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE cuenta_ref = ? AND fecha BETWEEN ? AND ? ORDER BY fecha, orden').all(cuentaId, Base.sumarDias_(desde, -4), Base.sumarDias_(hasta, 4))
    .map((r) => ({ r, d: I.des_(r.datos) }));
}
const mismoMonto_ = (monto, d) => (monto > 0 ? d.abono === monto : d.cargo === -monto);

/** El movimiento del banco (sin anotar) que corresponde a una fila: primero el que calza por nombre, luego el más cercano en fecha. */
function buscarEnBanco_(fila, movs, usados) {
  const libres = movs.filter((m) => !m.d.sin_cartola && !m.d.planilla && !usados.has(m.r.id) && mismoMonto_(fila.monto, m.d) && dias_(m.r.fecha, fila.fecha) <= 3);
  if (!libres.length) return null;
  const pend = libres.filter((m) => m.r.estado === 'PENDIENTE');
  const lista = pend.length ? pend : libres;
  const porNombre = lista.filter((m) => Lb.interno.nombreCalza_({ alias: fila.alias, banco: fila.glosa }, m));
  const elegir = (l) => l.slice().sort((a, b) => dias_(a.r.fecha, fila.fecha) - dias_(b.r.fecha, fila.fecha))[0];
  return porNombre.length ? elegir(porNombre) : elegir(lista);
}

function siguienteFila_(cuentaId, periodo) {
  let max = FILA_BASE_;
  I.db_().prepare('SELECT datos FROM FIN_MOVIMIENTOS WHERE cuenta_ref = ? AND periodo = ?').all(cuentaId, periodo).forEach((r) => {
    const p = I.des_(r.datos).planilla; if (p && p.fila > max) max = p.fila;
  });
  return max + 1;
}

/** Deja lo anotado en los movimientos y clasifica lo que alcance (misma lógica que el Excel BANCOS). */
function clasificar_(db, data, contexto, cuenta, items) {
  const filas = [], par = new Map();
  items.forEach((it) => {
    const r = I.db_().prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ?').get(it.id);
    if (!r) return;
    const d = I.des_(r.datos);
    filas.push({ fila: d.planilla.fila, fecha: r.fecha, monto: (d.abono || 0) - (d.cargo || 0), alias: d.planilla.alias, plan: d.planilla.plan || '', obs: d.planilla.obs || '', banco: d.planilla.glosa || '', unitario: null });
    par.set(d.planilla.fila, { r, d });
  });
  if (!filas.length) return { clasificadas: 0, por_revisar: [] };
  return Lb.interno.clasificarYAgrupar_(db, data, contexto, { filas, par, gr: [], cuenta, periodo: filas[0].fecha.slice(0, 7), lote: 'registro', archivo: 'Registro en SIGSO' });
}

/**
 * Anota una o varias filas (formulario o pegado desde el Excel).
 * data: { cuenta_ref, filas: [{ fecha, monto, alias, plan, obs, glosa, nota, mov_id? }] }
 * mov_id = anotar ESE movimiento del banco (el que figura «falta anotar»).
 */
const registrar = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  const cuenta = I.cuentasMapa_().get(txt_(data && data.cuenta_ref));
  if (!cuenta) return errorValidacion('cuenta_ref', 'Elige la cuenta del banco.');
  const entrada = Array.isArray(data.filas) ? data.filas.slice(0, 400) : [];
  if (!entrada.length) return errorValidacion('filas', 'No hay filas para anotar.');
  const leidas = [];
  for (let i = 0; i < entrada.length; i++) {
    const f = leerFila_(entrada[i]);
    if (f.error) return errorValidacion('filas', (entrada.length > 1 ? 'Fila ' + (i + 1) + ': ' : '') + f.error);
    if (cerrado_(f.fecha.slice(0, 7))) return errorValidacion('filas', 'El mes ' + f.fecha.slice(0, 7) + ' está cerrado. Reábrelo en «Cierre» si de verdad falta algo.');
    f.mov_id = txt_(entrada[i].mov_id);
    leidas.push(f);
  }
  const d = I.db_();
  const fechas = leidas.map((f) => f.fecha).sort();
  const movs = movsRango_(cuenta.id, fechas[0], fechas[fechas.length - 1]);
  const usados = new Set();
  const ahora = new Date().toISOString();
  const resultado = [];
  const numeros = new Map();
  const ins = d.prepare('INSERT INTO FIN_MOVIMIENTOS (id, cuenta_ref, fecha, periodo, orden, huella, estado, datos, importacion_id, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const upd = d.prepare('UPDATE FIN_MOVIMIENTOS SET datos = ?, actualizado_en = ?, actualizado_por = ? WHERE id = ?');
  let orden = d.prepare('SELECT COALESCE(MAX(orden), 0) AS n FROM FIN_MOVIMIENTOS').get().n;
  d.exec('BEGIN');
  try {
    leidas.forEach((f) => {
      const periodo = f.fecha.slice(0, 7);
      const n = numeros.has(periodo) ? numeros.get(periodo) : siguienteFila_(cuenta.id, periodo);
      numeros.set(periodo, n + 1);
      const anot = { alias: f.alias, obs: f.obs, plan: f.plan, glosa: f.glosa, nota: f.nota, fila: n, archivo: 'Registro en SIGSO', unitario: null, grupo: null, registro: { por: x.nombre, en: ahora } };
      let m = null;
      if (f.mov_id) {
        m = movs.find((y) => y.r.id === f.mov_id) || null;
        if (!m) { const r0 = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ? AND cuenta_ref = ?').get(f.mov_id, cuenta.id); m = r0 ? { r: r0, d: I.des_(r0.datos) } : null; }
        if (!m) throw Object.assign(new Error('mov'), { validacion: 'Ese movimiento ya no existe: recarga el libro.' });
        if (!mismoMonto_(f.monto, m.d)) throw Object.assign(new Error('mov'), { validacion: 'El monto anotado no es el del movimiento del banco (' + Base.plata_((m.d.abono || 0) - (m.d.cargo || 0)) + ').' });
        if (m.d.planilla) throw Object.assign(new Error('mov'), { validacion: 'Ese movimiento ya está anotado: ábrelo para corregirlo.' });
      } else m = buscarEnBanco_(f, movs, usados);
      if (m) {
        usados.add(m.r.id);
        m.d.planilla = anot;
        upd.run(I.cif_(m.d), ahora, x.nombre, m.r.id);
        resultado.push({ id: m.r.id, en_banco: true });
      } else {
        const id = crypto.randomUUID();
        ins.run(id, cuenta.id, f.fecha, periodo, ++orden, I.hmac_(['registro', cuenta.id, id].join('|')), 'PENDIENTE',
          I.cif_({ glosa: f.glosa || f.alias, doc: '', cargo: f.monto < 0 ? -f.monto : 0, abono: f.monto > 0 ? f.monto : 0, saldo: null, sin_cartola: true,
            fuente: { tipo: 'REGISTRO' }, sugerencia: null, clasif: null, planilla: anot }), 'registro', ahora, x.nombre);
        resultado.push({ id, en_banco: false });
      }
    });
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    if (e.validacion) return errorValidacion('filas', e.validacion);
    throw e;
  }
  const c = clasificar_(db, data, contexto, cuenta, resultado);
  const revisar = new Set((c.por_revisar || []).map((p) => p.mov));
  x.registrar('REGISTRO_ANOTAR', leidas.length + ' fila(s) · ' + resultado.filter((r) => r.en_banco).length + ' ya en el banco · ' + (c.clasificadas || 0) + ' clasificadas');
  return {
    anotadas: resultado.length, en_banco: resultado.filter((r) => r.en_banco).length, esperando_cartola: resultado.filter((r) => !r.en_banco).length,
    clasificadas: c.clasificadas || 0,
    filas: resultado.map((r) => Object.assign(r, { por_revisar: revisar.has(r.id), motivo: ((c.por_revisar || []).find((p) => p.mov === r.id) || {}).motivo || '' }))
  };
});

/**
 * Corrige una fila anotada: nombre, plan, OBS, detalle y nota; y la fecha o el monto si todavía no está en la cartola.
 * data: { id, expected_version, alias, plan, obs, glosa, nota, fecha, monto }
 */
const editar = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  const d = I.db_();
  const r = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ?').get(txt_(data && data.id));
  if (!r) return errorValidacion('id', 'Esa fila ya no existe: recarga el libro.');
  if (Number(data.expected_version) !== Number(r.version || 0)) return Base.errConflicto('Otra persona cambió esta fila mientras la revisabas (' + (r.actualizado_por || '') + '). Ábrela de nuevo.');
  if (cerrado_(r.periodo)) return errorValidacion('id', 'El mes ' + r.periodo + ' está cerrado. Reábrelo en «Cierre» para corregir.');
  const m = I.des_(r.datos);
  if (!m.planilla) return errorValidacion('id', 'Esta fila no está anotada todavía.');
  const montoAntes = (m.abono || 0) - (m.cargo || 0);
  const f = leerFila_({ fecha: m.sin_cartola && data.fecha ? data.fecha : r.fecha, monto: m.sin_cartola && data.monto !== undefined && data.monto !== '' ? data.monto : montoAntes,
    alias: data.alias, plan: data.plan, obs: data.obs, glosa: data.glosa, nota: data.nota });
  if (f.error) return errorValidacion('fila', f.error);
  if (cerrado_(f.fecha.slice(0, 7))) return errorValidacion('fecha', 'El mes ' + f.fecha.slice(0, 7) + ' está cerrado.');
  const cambiaQue = N(f.alias) !== N(m.planilla.alias) || f.obs !== (m.planilla.obs || '') || N(f.plan) !== N(m.planilla.plan || '') || f.monto !== montoAntes;
  if (cambiaQue && enGrupo_(m)) return errorValidacion('fila', 'Esta fila está en un grupo de fondos: sácala del grupo antes de cambiar el nombre, la OBS, el plan o el monto.');
  if (f.monto !== montoAntes && m.clasif && m.clasif.partes) return errorValidacion('monto', 'Está repartida en partes: quita el reparto antes de cambiar el monto.');
  Object.assign(m.planilla, { alias: f.alias, obs: f.obs, plan: f.plan, glosa: f.glosa, nota: f.nota });
  if (m.sin_cartola) { m.abono = f.monto > 0 ? f.monto : 0; m.cargo = f.monto < 0 ? -f.monto : 0; if (!m.fuente || m.fuente.tipo === 'REGISTRO') m.glosa = f.glosa || f.alias; }
  let estado = r.estado;
  if (cambiaQue) { estado = 'PENDIENTE'; m.clasif = null; }
  d.prepare('UPDATE FIN_MOVIMIENTOS SET fecha = ?, periodo = ?, estado = ?, datos = ?, actualizado_en = ?, actualizado_por = ?, version = COALESCE(version, 0) + 1 WHERE id = ?')
    .run(f.fecha, f.fecha.slice(0, 7), estado, I.cif_(m), new Date().toISOString(), x.nombre, r.id);
  const c = cambiaQue ? clasificar_(db, data, contexto, I.cuentasMapa_().get(r.cuenta_ref), [{ id: r.id }]) : { clasificadas: 0, por_revisar: [] };
  x.registrar('REGISTRO_CORREGIR', f.fecha + ' · ' + Base.plata_(f.monto) + ' · ' + f.alias);
  return { id: r.id, reclasificada: cambiaQue, clasificada: !!c.clasificadas, motivo: ((c.por_revisar || [])[0] || {}).motivo || '' };
});

/**
 * Borra una fila anotada. Si todavía espera la cartola, la fila desaparece; si ya está en el banco, solo se borra la
 * anotación (el movimiento del banco queda «falta anotar»). Una fila en un grupo de fondos se saca del grupo antes.
 */
const eliminar = Base.conCapacidad('REGISTRAR', '', function (db, data, contexto, x) {
  const d = I.db_();
  const r = d.prepare('SELECT * FROM FIN_MOVIMIENTOS WHERE id = ?').get(txt_(data && data.id));
  if (!r) return errorValidacion('id', 'Esa fila ya no existe: recarga el libro.');
  if (Number(data.expected_version) !== Number(r.version || 0)) return Base.errConflicto('Otra persona cambió esta fila mientras la revisabas. Ábrela de nuevo.');
  if (cerrado_(r.periodo)) return errorValidacion('id', 'El mes ' + r.periodo + ' está cerrado.');
  const m = I.des_(r.datos);
  if (!m.planilla) return errorValidacion('id', 'Esta fila no tiene nada anotado.');
  if (enGrupo_(m)) return errorValidacion('id', 'Esta fila está en un grupo de fondos: sácala del grupo primero.');
  if (m.clasif && m.clasif.conciliado) return errorValidacion('id', 'Está vinculada con operaciones registradas: deshaz el vínculo primero.');
  const ahora = new Date().toISOString();
  const resumen = r.fecha + ' · ' + Base.plata_((m.abono || 0) - (m.cargo || 0)) + ' · ' + m.planilla.alias;
  if (m.sin_cartola) d.prepare('DELETE FROM FIN_MOVIMIENTOS WHERE id = ?').run(r.id);
  else {
    delete m.planilla; m.clasif = null;
    d.prepare("UPDATE FIN_MOVIMIENTOS SET estado = 'PENDIENTE', datos = ?, actualizado_en = ?, actualizado_por = ?, version = COALESCE(version, 0) + 1 WHERE id = ?").run(I.cif_(m), ahora, x.nombre, r.id);
  }
  x.registrar('REGISTRO_BORRAR', (m.sin_cartola ? 'fila ' : 'anotación de ') + resumen);
  return { borrada: !!m.sin_cartola, anotacion_borrada: !m.sin_cartola };
});

/**
 * Une las filas «esperando cartola» de una cuenta con los movimientos recién llegados del banco: mismo monto y
 * sentido, fecha ±3 días, primero los que calzan por nombre. La fila anotada conserva su id (y con eso su
 * clasificación, su grupo y su historia) y toma del banco la fecha, la glosa, el documento y el saldo; el
 * movimiento duplicado del banco se borra. Devuelve cuántas se unieron.
 */
function unirConCartola_(cuentaId, desde, hasta) {
  const d = I.db_();
  const movs = movsRango_(cuentaId, desde, hasta);
  const esperando = movs.filter((m) => m.d.sin_cartola);
  const banco = movs.filter((m) => !m.d.sin_cartola && !m.d.planilla && m.r.estado === 'PENDIENTE' && !m.d.clasif);
  if (!esperando.length || !banco.length) return 0;
  const usados = new Set(), par = new Map();
  const fila = (m) => ({ alias: (m.d.planilla && m.d.planilla.alias) || '', banco: (m.d.planilla && m.d.planilla.glosa) || '' });
  const monto = (m) => (m.d.abono || 0) - (m.d.cargo || 0);
  const fases = [{ tol: 3, ok: (e, b) => Lb.interno.nombreCalza_(fila(e), b) }, { tol: 0, ok: () => true }, { tol: 1, ok: () => true }, { tol: 2, ok: () => true }, { tol: 3, ok: () => true }];
  fases.forEach((fase) => esperando.forEach((e) => {
    if (par.has(e.r.id)) return;
    let mejor = null;
    banco.forEach((b) => {
      if (usados.has(b.r.id) || !mismoMonto_(monto(e), b.d) || dias_(b.r.fecha, e.r.fecha) > fase.tol || !fase.ok(e, b)) return;
      if (b.r.periodo !== e.r.periodo && (cerrado_(b.r.periodo) || cerrado_(e.r.periodo))) return;
      if (!mejor || dias_(b.r.fecha, e.r.fecha) < dias_(mejor.r.fecha, e.r.fecha)) mejor = b;
    });
    if (mejor) { usados.add(mejor.r.id); par.set(e.r.id, mejor); }
  }));
  if (!par.size) return 0;
  const ahora = new Date().toISOString();
  d.exec('BEGIN');
  try {
    esperando.forEach((e) => {
      const b = par.get(e.r.id); if (!b) return;
      const datos = Object.assign({}, e.d, { glosa: b.d.glosa, doc: b.d.doc, saldo: b.d.saldo, detalle: b.d.detalle || e.d.detalle || null, sin_cartola: false,
        unida: { en: ahora, fecha_anotada: e.r.fecha, fuente: e.d.fuente || null } });
      if (e.r.estado === 'PENDIENTE' && b.d.sugerencia) datos.sugerencia = b.d.sugerencia;
      d.prepare('DELETE FROM FIN_MOVIMIENTOS WHERE id = ?').run(b.r.id);
      d.prepare('UPDATE FIN_MOVIMIENTOS SET fecha = ?, periodo = ?, orden = ?, huella = ?, importacion_id = ?, datos = ?, version = COALESCE(version, 0) + 1 WHERE id = ?')
        .run(b.r.fecha, b.r.periodo, b.r.orden, b.r.huella, b.r.importacion_id, I.cif_(datos), e.r.id);
    });
    d.exec('COMMIT');
  } catch (err) { d.exec('ROLLBACK'); throw err; }
  return par.size;
}

module.exports = { registrar, editar, eliminar, unirConCartola_, OBS, leerFila_ };
