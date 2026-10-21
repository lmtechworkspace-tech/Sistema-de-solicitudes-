'use strict';

/**
 * finanzasReglas.js — ver y corregir lo que el sistema aprendió (2026-10-20;
 * FIN-20, T40).
 *
 * El motor de sugerencias aprende de tres maneras: reglas por glosa exacta
 * (FIN_REGLAS), pagadores que pagan por uno o varios clientes (FIN_PAGADORES)
 * y nombres cortos del Excel BANCOS (FIN_ALIAS). Un error enseñado se repetía
 * en cada sugerencia sin forma de corregirlo. Aquí:
 *  - se listan con su origen, usos, versión y quién los cambió;
 *  - antes de guardar un cambio se ve su IMPACTO: qué movimientos PENDIENTES
 *    cambiarían de propuesta (los confirmados no se tocan nunca);
 *  - se editan o desactivan (no se borran): queda la versión anterior;
 *  - un pagador puede tener varios clientes; se quita o agrega uno a la vez.
 *  Las reglas son por glosa EXACTA: no se admiten patrones (decisión: evita
 *  reglas que calcen con más de lo que se quiso).
 */

const crypto = require('node:crypto');
const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const FB = require('./finanzasBancos');
const { errorValidacion } = require('./errores');

const I = FB.interno;

function reglas_() {
  return I.db_().prepare('SELECT * FROM FIN_REGLAS ORDER BY actualizada_en DESC').all().map((r) => {
    const d = I.des_(r.datos);
    return { id: r.id, glosa: d.glosa, clasif: d.clasif, origen: r.origen, usos: r.usos, activa: r.activa === undefined ? true : !!r.activa, version: r.version || 0, actualizada_en: r.actualizada_en, historial: d.historial || [], actualizada_por: d.actualizada_por || '',
      alcance: d.alcance || null, vigencia: d.vigencia || null, evidencia: d.evidencia || '', creada_por: d.creada_por || (r.origen === 'planilla' ? 'Planilla SIGECO' : 'Aprendida al clasificar') };
  });
}
function pagadores_() {
  require('./finanzasPagadores').asegurarTablas_();
  return I.db_().prepare('SELECT * FROM FIN_PAGADORES').all().map((r) => {
    const d = I.des_(r.datos);
    return { huella: r.huella, nombre: d.nombre, activo: d.activo !== false, clientes: Object.keys(d.clientes || {}).map((id) => Object.assign({ cliente_id: id }, d.clientes[id])), actualizado_en: r.actualizado_en, historial: d.historial || [] };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
function alias_() {
  require('./finanzasPagadores').asegurarTablas_();
  return I.db_().prepare('SELECT * FROM FIN_ALIAS').all().map((r) => { const d = I.des_(r.datos); return { huella: r.huella, alias: d.alias, destino: d.destino, activo: d.activo !== false, actualizado_por: r.actualizado_por, actualizado_en: r.actualizado_en }; })
    .sort((a, b) => a.alias.localeCompare(b.alias, 'es'));
}

/** Alcance y vigencia válidos (o error). */
function alcanceDe_(data) {
  const a = data.alcance || {}, v = data.vigencia || {};
  const out = { alcance: {}, vigencia: {} };
  if (Base.txt_(a.empresa)) { const e = require('./finanzasCatalogos').empresa_(a.empresa); if (!e) return { error: 'Empresa no válida.' }; out.alcance.empresa = e; }
  if (Base.txt_(a.cuenta_ref)) { const c = I.cuentasMapa_().get(Base.txt_(a.cuenta_ref)); if (!c) return { error: 'Cuenta no válida.' }; if (out.alcance.empresa && c.empresa !== out.alcance.empresa) return { error: 'La cuenta es de otra empresa.' }; out.alcance.cuenta_ref = c.id; }
  if (a.sentido === 'abono' || a.sentido === 'cargo') out.alcance.sentido = a.sentido;
  const desde = Base.txt_(v.desde) ? Base.fechaCivil_(v.desde) : '', hasta = Base.txt_(v.hasta) ? Base.fechaCivil_(v.hasta) : '';
  if ((Base.txt_(v.desde) && !desde) || (Base.txt_(v.hasta) && !hasta) || (desde && hasta && hasta < desde)) return { error: 'Revisa la vigencia (desde ≤ hasta).' };
  if (desde) out.vigencia.desde = desde; if (hasta) out.vigencia.hasta = hasta;
  return out;
}
const listar = B.conBoveda('VER_REGLAS', function () {
  return { reglas: reglas_(), pagadores: pagadores_(), alias: alias_(), nota: 'Las reglas son por glosa exacta. Cambiar o desactivar una regla solo cambia las propuestas de lo pendiente; lo confirmado no se reescribe.' };
});

/** Pendientes con esta glosa (o este pagador): su propuesta actual y la que tendrían. */
function impacto_(db, filtro, simular) {
  const d = I.db_();
  const filas = d.prepare("SELECT id, cuenta_ref, fecha, periodo, datos FROM FIN_MOVIMIENTOS WHERE estado = 'PENDIENTE'").all().map((r) => Object.assign(r, { d: I.des_(r.datos) }))
    .filter((r) => (filtro.glosa ? I.normalizar_(r.d.glosa) === I.normalizar_(filtro.glosa) : true) && (filtro.pagador ? I.normalizar_((r.d.detalle || {}).pagador) === I.normalizar_(filtro.pagador) : true));
  if (!filas.length) return { pendientes: 0, cambian: [] };
  const cuentas = I.cuentasMapa_();
  const ctx = FB.contextoSugerencias_(db, 'HomePymes');
  simular(ctx);
  const cambian = filas.map((r) => {
    const nueva = FB.sugerir_(Object.assign({ fecha: r.fecha, cuenta_ref: r.cuenta_ref }, r.d), Object.assign({}, ctx, { empresa: (cuentas.get(r.cuenta_ref) || {}).empresa || 'HomePymes' }));
    const resumen = (s) => [s && s.tipo, s && s.cuenta, s && s.cliente, s && s.certeza].filter(Boolean).join(' · ');
    // Conflicto: hoy lo propone algo más fuerte que una regla (operación registrada, pagador conocido) y la regla diría otra cosa.
    const fuerte = r.d.sugerencia && (r.d.sugerencia.operacion_candidata || /pagador|registrad/i.test(r.d.sugerencia.motivo || ''));
    return { id: r.id, fecha: r.fecha, glosa: r.d.glosa, monto: r.d.abono || -r.d.cargo, antes: resumen(r.d.sugerencia), despues: resumen(nueva), conflicto: !!fuerte && resumen(nueva) !== resumen(r.d.sugerencia) };
  }).filter((x) => x.antes !== x.despues || x.conflicto);
  return { pendientes: filas.length, cambian, conflictos: cambian.filter((c) => c.conflicto).length };
}

/**
 * Vista previa o guardado de un cambio en una regla.
 * data: { id, clasif?, activa?, previsualizar: true|false, expected_version }
 */
const guardarRegla = Base.conCapacidad('REGLAS', '', function (db, data, contexto, x) {
  const d = I.db_();
  const r = d.prepare('SELECT * FROM FIN_REGLAS WHERE id = ?').get(Base.txt_(data && data.id));
  if (!r) return errorValidacion('id', 'Esa regla no existe.');
  if (!data.previsualizar && (data.expected_version === undefined || data.expected_version === null || data.expected_version === '')) return Base.errVersionRequerida_();
  if (data.expected_version !== undefined && data.expected_version !== null && data.expected_version !== '' && Number(data.expected_version) !== Number(r.version || 0)) return Base.errConflicto();
  const datos = I.des_(r.datos);
  let nueva = datos.clasif;
  if (data.clasif) {
    const sentido = FB.TIPOS[data.clasif.tipo] && FB.TIPOS[data.clasif.tipo].sentido === 'cargo' ? { abono: 0, cargo: 1 } : { abono: 1, cargo: 0 };
    const n = FB.normalizarClasif_(data.clasif, sentido, FB.contextoNormalizar_(db));
    if (n.error) return errorValidacion('clasif', n.error);
    nueva = { tipo: n.clasif.tipo, subtipo: n.clasif.subtipo, cuenta: n.clasif.cuenta, cliente_id: n.clasif.cliente_id, cliente: n.clasif.cliente, empresa: n.clasif.empresa, reparto: n.clasif.reparto,
      ambigua: FB.ambigua_(datos.glosa, I.clientes_(db)) };
  }
  const activa = data.activa === undefined ? (r.activa === undefined ? 1 : r.activa) : (data.activa ? 1 : 0);
  let alc = { alcance: datos.alcance || {}, vigencia: datos.vigencia || {} };
  if (data.alcance !== undefined || data.vigencia !== undefined) { alc = alcanceDe_(Object.assign({ alcance: datos.alcance, vigencia: datos.vigencia }, data)); if (alc.error) return errorValidacion('alcance', alc.error); }
  const huella = FB.huellaGlosa_(datos.glosa);
  const imp = impacto_(db, { glosa: datos.glosa }, (ctx) => { if (activa) ctx.reglas.set(huella, Object.assign({}, nueva, { origen: 'persona', alcance: alc.alcance, vigencia: alc.vigencia })); else ctx.reglas.delete(huella); });
  if (data.previsualizar) return { regla: { id: r.id, glosa: datos.glosa }, impacto: imp };
  datos.historial = (datos.historial || []).concat([{ en: Base.ahora_(), por: x.nombre, version: r.version || 0, antes: datos.clasif, activa_antes: r.activa === undefined ? 1 : r.activa }]).slice(-30);
  datos.clasif = nueva; datos.actualizada_por = x.nombre; datos.alcance = alc.alcance; datos.vigencia = alc.vigencia;
  if (data.evidencia !== undefined) datos.evidencia = Base.txt_(data.evidencia).slice(0, 300);
  d.prepare("UPDATE FIN_REGLAS SET datos = ?, origen = 'persona', activa = ?, version = COALESCE(version, 0) + 1, actualizada_en = ? WHERE id = ?").run(I.cif_(datos), activa, Base.ahora_(), r.id);
  const cambiadas = FB.resugerirPendientes_(db, { glosas: new Set([I.normalizar_(datos.glosa)]), pagadores: new Set(), cuentas: new Set() });
  x.registrar('REGLA_' + (activa ? 'EDITAR' : 'DESACTIVAR'), datos.glosa.slice(0, 40) + ' · ' + cambiadas + ' propuesta(s) cambiaron');
  return { ok: true, version: (r.version || 0) + 1, cambiadas };
});

/**
 * Crea una regla por glosa EXACTA (I07.6). data: { glosa, clasif, alcance?, vigencia?, evidencia, previsualizar }
 * No se aceptan glosas genéricas (que no dicen quién es) ni glosas que ya tienen regla (se editan).
 * La vista previa dice cuántos pendientes calzan, cuáles cambian y cuáles chocan con algo más fuerte.
 */
const crearRegla = Base.conCapacidad('REGLAS', '', function (db, data, contexto, x) {
  const glosa = Base.txt_(data && data.glosa).slice(0, 160);
  if (glosa.length < 4) return errorValidacion('glosa', 'Escribe la glosa exacta del banco.');
  if (FB.esGenerica_(glosa)) return errorValidacion('glosa', 'Esa glosa es genérica (no dice quién es): una regla así clasificaría mal muchos movimientos distintos.');
  const d = I.db_();
  const huella = FB.huellaGlosa_(glosa);
  if (d.prepare('SELECT 1 FROM FIN_REGLAS WHERE huella = ?').get(huella)) return errorValidacion('glosa', 'Ya hay una regla para esa glosa: edítala.');
  const c = data.clasif || {};
  const sentido = FB.TIPOS[c.tipo] && FB.TIPOS[c.tipo].sentido === 'cargo' ? { abono: 0, cargo: 1 } : { abono: 1, cargo: 0 };
  const n = FB.normalizarClasif_(c, sentido, FB.contextoNormalizar_(db));
  if (n.error) return errorValidacion('clasif', n.error);
  const alc = alcanceDe_(data); if (alc.error) return errorValidacion('alcance', alc.error);
  const evidencia = Base.txt_(data.evidencia).slice(0, 300);
  if (!data.previsualizar && evidencia.length < 3) return errorValidacion('evidencia', 'Escribe en qué te basas (p. ej. «contrato de arriendo», «así lo indicó contabilidad»).');
  const clasif = { tipo: n.clasif.tipo, subtipo: n.clasif.subtipo, cuenta: n.clasif.cuenta, cliente_id: n.clasif.cliente_id, cliente: n.clasif.cliente, empresa: n.clasif.empresa, reparto: n.clasif.reparto, ambigua: FB.ambigua_(glosa, I.clientes_(db)) };
  const imp = impacto_(db, { glosa }, (ctx) => { ctx.reglas.set(huella, Object.assign({}, clasif, { origen: 'persona', alcance: alc.alcance, vigencia: alc.vigencia })); });
  if (data.previsualizar) return { regla: { glosa }, impacto: imp, ambigua: clasif.ambigua };
  d.prepare("INSERT INTO FIN_REGLAS (id, huella, datos, origen, usos, activa, version, actualizada_en) VALUES (?,?,?,'persona',0,1,1,?)")
    .run(Base.id_(), huella, I.cif_({ glosa, clasif, alcance: alc.alcance, vigencia: alc.vigencia, evidencia, creada_por: x.nombre, actualizada_por: x.nombre, historial: [] }), Base.ahora_());
  const cambiadas = FB.resugerirPendientes_(db, { glosas: new Set([I.normalizar_(glosa)]), pagadores: new Set(), cuentas: new Set() });
  x.registrar('REGLA_CREAR', glosa.slice(0, 40) + ' · ' + cambiadas + ' propuesta(s) cambiaron');
  return { ok: true, cambiadas };
});

/**
 * Pagador: quitar o agregar un cliente, o desactivarlo (sus pagos dejan de
 * proponer clientes). data: { huella, quitar_cliente?, agregar_cliente?, activo?, previsualizar }
 */
const guardarPagador = Base.conCapacidad('REGLAS', '', function (db, data, contexto, x) {
  const P = require('./finanzasPagadores');
  require('./finanzasPagadores').asegurarTablas_();
  const d = I.db_();
  const r = d.prepare('SELECT * FROM FIN_PAGADORES WHERE huella = ?').get(Base.txt_(data && data.huella));
  if (!r) return errorValidacion('huella', 'Ese pagador no existe.');
  const datos = I.des_(r.datos);
  const nuevo = JSON.parse(JSON.stringify(datos));
  if (data.quitar_cliente) delete nuevo.clientes[Base.txt_(data.quitar_cliente)];
  if (data.agregar_cliente) {
    const c = I.clientes_(db).find((y) => y.id === Base.txt_(data.agregar_cliente));
    if (!c) return errorValidacion('agregar_cliente', 'Ese cliente no existe.');
    nuevo.clientes[c.id] = nuevo.clientes[c.id] || { cliente: c.nombre, veces: 0, origen: 'persona' };
  }
  if (data.activo !== undefined) nuevo.activo = !!data.activo;
  const imp = impacto_(db, { pagador: datos.nombre }, (ctx) => { if (nuevo.activo === false) ctx.pagadores.delete(r.huella); else ctx.pagadores.set(r.huella, nuevo); });
  if (data.previsualizar) return { pagador: datos.nombre, impacto: imp };
  nuevo.historial = (datos.historial || []).concat([{ en: Base.ahora_(), por: x.nombre, antes: Object.keys(datos.clientes || {}), activo_antes: datos.activo !== false }]).slice(-30);
  d.prepare('UPDATE FIN_PAGADORES SET datos = ?, actualizado_en = ? WHERE huella = ?').run(I.cif_(nuevo), Base.ahora_(), r.huella);
  void P;
  const cambiadas = FB.resugerirPendientes_(db, { glosas: new Set(), pagadores: new Set([I.normalizar_(datos.nombre)]), cuentas: new Set() });
  x.registrar('PAGADOR_EDITAR', datos.nombre.slice(0, 40) + ' · ' + cambiadas + ' propuesta(s) cambiaron');
  return { ok: true, cambiadas };
});

/** Nombre corto del Excel BANCOS: cambiar su destino o desactivarlo. */
const guardarAlias = Base.conCapacidad('REGLAS', '', function (db, data, contexto, x) {
  require('./finanzasPagadores').asegurarTablas_();
  const d = I.db_();
  const r = d.prepare('SELECT * FROM FIN_ALIAS WHERE huella = ?').get(Base.txt_(data && data.huella));
  if (!r) return errorValidacion('huella', 'Ese nombre corto no existe.');
  const datos = I.des_(r.datos);
  datos.historial = (datos.historial || []).concat([{ en: Base.ahora_(), por: x.nombre, antes: datos.destino, activo_antes: datos.activo !== false }]).slice(-30);
  if (data.activo !== undefined) datos.activo = !!data.activo;
  if (data.destino) {
    const de = data.destino;
    if (de.clase === 'cliente') { const c = I.clientes_(db).find((y) => y.id === Base.txt_(de.cliente_id)); if (!c) return errorValidacion('destino', 'Elige el cliente.'); datos.destino = { clase: 'cliente', cliente_id: c.id, cliente: c.nombre }; }
    else if (de.clase === 'empresa') { const e = require('./finanzasCatalogos').empresa_(de.empresa); if (!e) return errorValidacion('destino', 'Elige la empresa.'); datos.destino = { clase: 'empresa', empresa: e }; }
    else if (de.clase === 'gasto') { if (FB.cuentasDe_('EGRESO').indexOf(de.cuenta) === -1) return errorValidacion('destino', 'Elige la cuenta del gasto.'); datos.destino = { clase: 'gasto', cuenta: de.cuenta }; }
    else if (de.clase === 'ignorar') datos.destino = { clase: 'ignorar' };
    else return errorValidacion('destino', 'Destino no válido.');
  }
  d.prepare('UPDATE FIN_ALIAS SET datos = ?, actualizado_en = ?, actualizado_por = ? WHERE huella = ?').run(I.cif_(datos), Base.ahora_(), x.nombre, r.huella);
  x.registrar('ALIAS_EDITAR', datos.alias.slice(0, 40));
  return { ok: true, nota: 'El cambio se aplica la próxima vez que se suba el Excel BANCOS; lo ya sugerido no cambia solo.' };
});

void crypto;
module.exports = { crearRegla, listar, guardarRegla, guardarPagador, guardarAlias, reglas_, pagadores_, alias_, impacto_ };
