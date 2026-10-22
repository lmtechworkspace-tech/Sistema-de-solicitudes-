'use strict';

/**
 * finanzasCierre.js — Finanzas, Etapa 6: cierre de mes, paralelo con la
 * planilla SIGECO y lista de retiro (2026-10-06).
 *
 *  - CIERRE DE MES: una lista de verificación (cartolas que cubren el mes
 *    completo, saldos que cuadran con el banco, nada sin revisar, ventas del
 *    SII cargadas). Cerrado, el mes queda fijo: no se puede reclasificar ni
 *    importar nada nuevo de ese mes (finanzasBancos.js consulta mesCerrado_).
 *    Reabrir exige escribir el motivo; todo queda en la bitácora.
 *  - PARALELO: se sube la planilla SIGECO y se compara, mes a mes, contra lo
 *    que dice el banco (y las facturas), para saber cuándo se puede dejar.
 *  - RETIRO: lo que tiene que estar listo antes de archivar el Google Sheet,
 *    con los pasos manuales que solo se pueden hacer en Google (marcados por
 *    quien los hace).
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const FB = require('./finanzasBancos');
const { errorValidacion, errorForbidden } = require('./errores');

const I = FB.interno;

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
function db_() {
  const d = I.db_();
  if (preparada_ === d) return d;
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_CIERRES (
    periodo TEXT PRIMARY KEY, estado TEXT NOT NULL, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)`);
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_AJUSTES (clave TEXT PRIMARY KEY, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)`);
  // v2 (FIN-41): cada cierre guarda una versión reproducible (el informe completo, no solo cinco totales).
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_CIERRE_VERSIONES (
    id TEXT PRIMARY KEY, periodo TEXT NOT NULL, version INTEGER NOT NULL, datos TEXT NOT NULL, en TEXT NOT NULL, por TEXT)`);
  preparada_ = d;
  return d;
}

const ESTADOS_ = { ABIERTO: 'Abierto', EN_REVISION: 'En revisión', OBSERVADO: 'Devuelto con observaciones', CERRADO: 'Cerrado' };
function filaCierre_(periodo) { return db_().prepare('SELECT * FROM FIN_CIERRES WHERE periodo = ?').get(String(periodo)); }
function mesCerrado_(periodo) {
  try {
    const r = filaCierre_(periodo);
    return !!(r && r.estado === 'CERRADO');
  } catch (e) { return false; }
}
/** Estado de revisión y cierre de un mes (lo muestra la planilla): quién lo envió, sus observaciones y la política. */
function estadoMes_(periodo) {
  let fila = null;
  try { fila = filaCierre_(periodo); } catch (e) { fila = null; }
  const datos = fila ? I.des_(fila.datos) : {};
  const estado = fila ? fila.estado : 'ABIERTO';
  const rev = datos.revision ? { enviado_por: datos.revision.enviado_por, en: datos.revision.en, nota: datos.revision.nota || '' } : null;
  return { estado, nombre: ESTADOS_[estado] || estado, revision: rev, observaciones: (datos.observaciones || []).map((o, i) => Object.assign({ indice: i }, o)),
    cerrado_por: estado === 'CERRADO' ? fila.actualizado_por : '', en: fila ? fila.actualizado_en : '', politica: politicaCierre_() };
}
function ultimoDia_(p) { return Base.ultimoDia_(p); }
const nombreMes_ = (p) => Base.nombreMes_(p);
const plata_ = (n) => Base.plata_(n);
function ajuste_(clave) { const r = db_().prepare('SELECT datos FROM FIN_AJUSTES WHERE clave = ?').get(clave); return r ? I.des_(r.datos) : null; }
function guardarAjuste_(clave, datos, x) {
  db_().prepare('INSERT INTO FIN_AJUSTES (clave, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
    .run(clave, I.cif_(datos), Base.ahora_(), x.nombre);
}
/** Excepciones autorizadas del mes (cuentas fuera de alcance, aperturas pendientes aceptadas), con motivo y quién. */
function excepciones_(periodo) { return (ajuste_('excepciones|' + periodo) || { cuentas: {}, aperturas: null }); }
/** I11.3 · Política de cierre vigente (parámetros visibles en Configuración y en Revisión del período). */
function politicaCierre_() {
  let rev = 0, dos = 0;
  try { rev = Number(require('./finanzasCatalogos').param_('cierre_exige_revision', 0)) ? 1 : 0; dos = Number(require('./finanzasCatalogos').param_('cierre_dos_personas', 0)) ? 1 : 0; } catch (e) { /* por defecto */ }
  return { exige_revision: !!rev, dos_personas: !!dos,
    texto: (rev ? 'Solo se cierra un mes enviado a revisión y sin cambios desde entonces' : 'La revisión antes de cerrar es opcional') + '; ' + (dos ? 'quien lo envió a revisión no puede cerrarlo.' : 'la misma persona puede enviar y cerrar (queda registrado).') };
}
const LIMITACION_ = {
  CUENTA: (n) => 'Las cifras del mes no incluyen los movimientos de ' + n + ' que falten; su saldo queda a la última cartola cargada.',
  APERTURAS: () => 'Los fondos de clientes sin saldo inicial siguen parciales y la disponibilidad propia sigue no determinable: la excepción solo permite cerrar.'
};
/** I11.4 · Excepciones del mes como lista (vigentes y quitadas), cada una con su limitación. */
function excepcionesLista_(periodo) {
  const e = excepciones_(periodo), cuentas = I.cuentasMapa_();
  const nombre = (id) => { const c = cuentas.get(id); return c ? c.banco + ' ···' + c.ultimos4 : id; };
  const vig = Object.keys(e.cuentas || {}).map((id) => Object.assign({ tipo: 'CUENTA', alcance: nombre(id), cuenta_ref: id, vigente: true, limitacion: LIMITACION_.CUENTA(nombre(id)) }, e.cuentas[id]))
    .concat(e.aperturas ? [Object.assign({ tipo: 'APERTURAS', alcance: 'Saldos iniciales de fondos de clientes', vigente: true, limitacion: LIMITACION_.APERTURAS() }, e.aperturas)] : []);
  return vig.concat((e.historial || []).map((h) => Object.assign({}, h, { vigente: false })));
}

/**
 * La lista de verificación de un mes (v2, FIN-41): cobertura por cuenta (con
 * las excepciones autorizadas a la vista), cuadre, todo revisado, saldos
 * iniciales de fondos (o su excepción), operaciones sin banco (aviso) y
 * ventas del SII (aviso).
 */
function verificar_(periodo) {
  const d = db_();
  const inicio = periodo + '-01', fin = ultimoDia_(periodo);
  const cuentas = I.cuentasMapa_();
  const exc = excepciones_(periodo);
  const imps = d.prepare('SELECT cuenta_ref, desde, hasta, datos FROM FIN_IMPORTACIONES').all().map((r) => Object.assign(r, I.des_(r.datos)));
  // 1) Cada cuenta conocida tiene cartolas que cubren el mes entero (sin huecos), salvo excepción autorizada.
  const cobertura = [...cuentas.values()].map((c) => {
    const tramos = imps.filter((x) => x.cuenta_ref === c.id && x.hasta >= inicio && x.desde <= fin).sort((a, b) => (a.desde < b.desde ? -1 : 1));
    let hasta = '';
    let continuo = tramos.length > 0 && tramos[0].desde <= inicio;
    tramos.forEach((t) => {
      if (hasta && t.desde > siguienteDia_(hasta)) continuo = false;
      if (t.hasta > hasta) hasta = t.hasta;
    });
    const excepcion = exc.cuentas && exc.cuentas[c.id] ? exc.cuentas[c.id] : null;
    return { cuenta_ref: c.id, empresa: c.empresa, cuenta: c.banco + ' ···' + c.ultimos4 + ' (' + c.empresa + ')', completa: continuo && hasta >= fin, hasta: hasta || '', excepcion };
  });
  // 2) Las cartolas del mes cuadraron (saldo a saldo y con el resumen del banco).
  const delMes = imps.filter((x) => x.hasta >= inicio && x.desde <= fin);
  const descuadradas = delMes.filter((x) => x.cuadra === false).length;
  // 3) Nada sin revisar.
  //    v5.3: un movimiento anotado en la planilla (con su OBS) ya está revisado: la planilla es la clasificación.
  const pend = d.prepare("SELECT datos FROM FIN_MOVIMIENTOS WHERE periodo = ? AND estado = 'PENDIENTE'").all(periodo)
    .filter((r) => { const m = I.des_(r.datos); return !(m.planilla && m.planilla.obs); }).length;
  const total = d.prepare('SELECT COUNT(*) AS n FROM FIN_MOVIMIENTOS WHERE periodo = ?').get(periodo).n;
  // 4) Saldos iniciales de fondos de clientes (o la excepción aceptada con su motivo).
  let sinApertura = 0;
  try { sinApertura = require('./finanzasFondos').custodiaAl_(fin, '').sin_apertura; } catch (e) { sinApertura = 0; }
  // 5) Operaciones registradas sin su movimiento del banco (aviso).
  let sinBanco = 0;
  try { sinBanco = require('./finanzasOperaciones').hechosRegistro_().filter((h) => h.sin_banco && h.periodo === periodo).length; } catch (e) { sinBanco = 0; }
  // 5b) Corrección v2 (I01/I11.3): ningún posible duplicado sin resolver (registro ↔ banco ya clasificado).
  let conflictos = [];
  try { conflictos = require('./finanzasHechos').conflictos_({ periodo }); } catch (e) { conflictos = []; }
  // 6) Ventas del SII del mes cargadas (aviso, no bloquea: puede no haber facturado).
  let ventas = 0;
  try { ventas = d.prepare("SELECT COUNT(*) AS n FROM FIN_FACTURAS WHERE periodo = ? AND origen = 'rcv'").get(periodo).n; } catch (e) { ventas = 0; }
  const cubiertas = cobertura.filter((c) => c.completa || c.excepcion);
  const pasos = [
    { id: 'cartolas', nombre: 'Cartolas del mes completo', ok: cobertura.length > 0 && cubiertas.length === cobertura.length, obligatorio: true,
      detalle: cobertura.length ? cobertura.map((c) => c.cuenta + (c.completa ? ': completa' : c.excepcion ? ': fuera de alcance (' + c.excepcion.motivo + ')' : ': falta' + (c.hasta ? ' desde el ' + siguienteDia_(c.hasta).slice(8) : ' todo el mes'))).join(' · ') : 'No hay cuentas cargadas.' },
    { id: 'cuadra', nombre: 'Saldos cuadran con el banco', ok: delMes.length > 0 && !descuadradas, obligatorio: true,
      detalle: delMes.length ? (descuadradas ? descuadradas + ' cartola(s) no cuadraron' : delMes.length + ' cartola(s), todas cuadran') : 'Sin cartolas del mes.' },
    { id: 'revisado', nombre: 'Todas las filas con su OBS (o revisadas)', ok: total > 0 && pend === 0, obligatorio: true,
      detalle: total ? (pend ? 'Faltan ' + pend + ' de ' + total + ' movimientos' : 'Los ' + total + ' movimientos anotados en la planilla o confirmados') : 'Sin movimientos.' },
    { id: 'aperturas', nombre: 'Saldos iniciales de fondos de clientes', ok: !sinApertura || !!exc.aperturas, obligatorio: true,
      detalle: !sinApertura ? 'Todos los clientes con fondos tienen saldo inicial aprobado.' : exc.aperturas ? sinApertura + ' sin saldo inicial; excepción aceptada por ' + exc.aperturas.por + ': ' + exc.aperturas.motivo : sinApertura + ' cliente(s) sin saldo inicial aprobado: cárgalos en Fondos o acepta la excepción con su motivo.' },
    { id: 'identidad', nombre: 'Sin posibles duplicados por resolver', ok: !conflictos.length, obligatorio: true,
      detalle: conflictos.length ? conflictos.length + ' operación(es) registrada(s) podrían ser el mismo dinero que un movimiento del banco ya clasificado: vincúlalas o marca que son distintas en Conciliación.' : 'Nada registrado se confunde con un movimiento del banco.' },
    { id: 'sin_banco', nombre: 'Operaciones conciliadas con el banco', ok: !sinBanco, obligatorio: false,
      detalle: sinBanco ? sinBanco + ' operación(es) registradas sin su movimiento del banco: concílialas o revisa si son de otro mes.' : 'Todas las operaciones con medio bancario están conciliadas.' },
    { id: 'ventas', nombre: 'Ventas del SII cargadas', ok: ventas > 0, obligatorio: false,
      detalle: ventas ? ventas + ' documento(s) del Registro de Ventas' : 'No hay facturas del SII de este mes (si se facturó, súbelas en Cobranza).' }
  ];
  return { periodo, pasos, cobertura, listo: pasos.filter((p) => p.obligatorio).every((p) => p.ok) };
}
function siguienteDia_(iso) { return Base.sumarDias_(iso, 1); }

/**
 * Aviso en la campana de SIGSO (sin montos ni datos de la bóveda: solo que hay algo que mirar) para las personas con
 * acceso a Finanzas que cumplen `quien(cuenta_id)`. Nunca rompe la acción si no se puede avisar.
 */
function avisar_(db, quien, titulo, mensaje) {
  try {
    const { leerFilas_ } = require('../db/sqliteRepo');
    const { COLUMNAS } = require('../db/schema');
    const correos = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL)
      .filter((c) => c && c.cuenta_id && B.tieneAcceso(db, { cuenta_id: c.cuenta_id }) && quien(String(c.cuenta_id)))
      .map((c) => { let l = []; try { l = JSON.parse(c.emails || '[]'); } catch (e) { l = String(c.emails || '').split(/[,;\s]+/); } return (Array.isArray(l) ? l : [l]).filter(Boolean)[0]; })
      .filter(Boolean);
    if (!correos.length) return 0;
    return require('./notificacionesApp').encolarLote(db, correos.map((e) => ({ destinatario: e, tipo: 'FIN_CIERRE', titulo, mensaje, modulo_id: 'finanzas', texto_accion: 'Abrir Finanzas', vidaHoras: 24 * 7 }))).encolado;
  } catch (e) { return 0; }
}

// ---------------------------------------------------------------- acciones de cierre

const estado = B.conBoveda('VER_CIERRE', function (db) {
  const d = db_();
  const periodos = d.prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS ORDER BY periodo DESC').all().map((r) => r.periodo);
  const cierres = new Map(d.prepare('SELECT * FROM FIN_CIERRES').all().map((r) => [r.periodo, r]));
  const meses = periodos.map((p) => {
    const c = cierres.get(p);
    const v = verificar_(p);
    const info = c ? I.des_(c.datos) : null;
    const versiones = d.prepare('SELECT version, en, por FROM FIN_CIERRE_VERSIONES WHERE periodo = ? ORDER BY version DESC').all(p);
    return Object.assign(v, { nombre: nombreMes_(p), estado: c ? c.estado : 'ABIERTO', estado_nombre: ESTADOS_[c ? c.estado : 'ABIERTO'], cerrado_por: c && c.estado === 'CERRADO' ? c.actualizado_por : '', cerrado_en: c ? c.actualizado_en : '',
      foto: info && info.foto, ultimo_motivo: info && info.motivo, revision: info && info.revision || null, observaciones: (info && info.observaciones) || [], versiones,
      // I08.9: «cerrado» y «cerrado con excepciones» se distinguen.
      con_excepciones: !!(c && c.estado === 'CERRADO' && info && info.excepciones && (Object.keys(info.excepciones.cuentas || {}).length || info.excepciones.aperturas)) });
  });
  return { meses: meses.map((m) => Object.assign(m, { excepciones: excepcionesLista_(m.periodo) })), estados: ESTADOS_, retiro: retiro_(db, meses), politica: politicaCierre_() };
});

/**
 * Foto del mes al cerrarlo (lo que quedó firme). I10.4: sale del MISMO
 * contrato del informe (no del cálculo del tablero anterior), para que el
 * cierre, la pantalla y el PDF digan lo mismo. «resultado» es el flujo propio.
 */
function foto_(db, periodo) {
  try {
    const c = require('./finanzasReportes').reporte_(db, { periodo });
    const m = c.metrics;
    return { ingresos: m.ingresos, egresos: m.egresos, resultado: m.flujo_propio, caja: m.caja, custodia: m.custodia_positiva, custodia_deficit: m.custodia_deficit,
      caja_libre: m.caja_libre, calidad: c.quality.status, revision: c.data_revision };
  } catch (e) { return null; }
}
/** Versión reproducible: el informe completo del grupo y de cada empresa, con los catálogos que se usaron. */
function version_(db, periodo, aprobacion) {
  const R = require('./finanzasReportes');
  const Cat = require('./finanzasCatalogos');
  const grupo = R.reporte_(db, { periodo });
  const empresas = {};
  grupo.scope.empresas.forEach((e) => { empresas[e] = R.reporte_(db, { periodo, empresa: e }); });
  return { grupo, empresas, catalogos: { conceptos: Cat.lista_('CONCEPTO', { todos: true }).map((c) => ({ id: c.id, grupo: c.grupo, activo: c.activo })), parametros: Cat.lista_('PARAMETRO', { todos: true }) },
    reglas_version: grupo.rule_version, revision: grupo.data_revision,
    // I11.5: quién preparó, quién revisó y quién cerró; observaciones y excepciones aceptadas, tal como estaban al cerrar.
    aprobacion: aprobacion || null };
}
function guardarCierre_(periodo, estado, datos, x) {
  db_().prepare('INSERT INTO FIN_CIERRES (periodo, estado, datos, actualizado_en, actualizado_por) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(periodo) DO UPDATE SET estado = excluded.estado, datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
    .run(periodo, estado, I.cif_(datos), Base.ahora_(), x.nombre);
}

/** Quien prepara el mes lo envía a revisión (con su nota). No bloquea nada: avisa que está listo para revisar. */
const enviarRevision = Base.conCapacidad('CONFIRMAR', '', function (db, data, contexto, x) {
  const periodo = Base.periodo_(data && data.periodo);
  if (!periodo) return errorValidacion('periodo', 'Mes no válido.');
  if (mesCerrado_(periodo)) return errorValidacion('periodo', 'Ese mes ya está cerrado.');
  const v = verificar_(periodo);
  if (!v.listo) return errorValidacion('periodo', 'Antes de enviarlo a revisión falta: ' + v.pasos.filter((p) => p.obligatorio && !p.ok).map((p) => p.nombre.toLowerCase()).join(', ') + '.');
  const r = filaCierre_(periodo);
  const datos = r ? I.des_(r.datos) : {};
  datos.revision = { enviado_por: x.nombre, enviado_id: String((contexto && contexto.cuenta_id) || ''), en: Base.ahora_(), nota: Base.txt_(data.nota).slice(0, 500), revision_datos: Base.revision_() };
  guardarCierre_(periodo, 'EN_REVISION', datos, x);
  x.registrar('CIERRE_A_REVISION', nombreMes_(periodo));
  avisar_(db, (c) => c !== datos.revision.enviado_id && Base.puede_({ cuenta_id: c }, 'CIERRE'), nombreMes_(periodo) + ' está listo para revisión',
    x.nombre + ' terminó la planilla de ' + nombreMes_(periodo) + ' y la envió a revisión.' + (datos.revision.nota ? ' Nota: ' + datos.revision.nota : ''));
  return { periodo, estado: 'EN_REVISION' };
});

/** Quien revisa lo devuelve con observaciones (quedan en la historia del mes). */
const observar = Base.conCapacidad('CIERRE', '', function (db, data, contexto, x) {
  const periodo = Base.periodo_(data && data.periodo);
  const obs = Base.txt_(data && data.observacion);
  if (!periodo) return errorValidacion('periodo', 'Mes no válido.');
  if (obs.length < 5) return errorValidacion('observacion', 'Escribe qué hay que corregir.');
  if (mesCerrado_(periodo)) return errorValidacion('periodo', 'Ese mes está cerrado: reábrelo con motivo.');
  const r = filaCierre_(periodo);
  const datos = r ? I.des_(r.datos) : {};
  datos.observaciones = (datos.observaciones || []).concat([{ por: x.nombre, en: Base.ahora_(), texto: obs.slice(0, 1000), resuelta: false }]).slice(-50);
  guardarCierre_(periodo, 'OBSERVADO', datos, x);
  x.registrar('CIERRE_OBSERVADO', nombreMes_(periodo) + ': ' + obs.slice(0, 80));
  const quien = datos.revision && datos.revision.enviado_id;
  if (quien) avisar_(db, (c) => c === quien, nombreMes_(periodo) + ' volvió con observaciones', x.nombre + ' pide corregir: ' + obs.slice(0, 200));
  return { periodo, estado: 'OBSERVADO' };
});

/** Marca resuelta una observación (quien prepara, al corregir). */
const resolverObservacion = Base.conCapacidad('CONFIRMAR', '', function (db, data, contexto, x) {
  const periodo = Base.periodo_(data && data.periodo);
  const r = filaCierre_(periodo);
  if (!r) return errorValidacion('periodo', 'Ese mes no tiene observaciones.');
  const datos = I.des_(r.datos);
  const i = Number(data.indice);
  if (!datos.observaciones || !datos.observaciones[i]) return errorValidacion('indice', 'Esa observación no existe.');
  datos.observaciones[i].resuelta = true; datos.observaciones[i].resuelta_por = x.nombre; datos.observaciones[i].respuesta = Base.txt_(data.respuesta).slice(0, 500);
  guardarCierre_(periodo, r.estado, datos, x);
  x.registrar('CIERRE_OBSERVACION_RESUELTA', nombreMes_(periodo));
  return { ok: true };
});

/**
 * Excepción autorizada (FIN-41): una cuenta queda fuera del alcance del mes
 * (p. ej. no tuvo movimientos y el banco no emite cartola), o se aceptan
 * saldos iniciales pendientes. Siempre con motivo; queda en la bitácora y en
 * el informe.
 */
const excepcion = Base.conCapacidad('CIERRE', '', function (db, data, contexto, x) {
  const periodo = Base.periodo_(data && data.periodo);
  const motivo = Base.txt_(data && data.motivo).slice(0, 300);
  if (!periodo) return errorValidacion('periodo', 'Mes no válido.');
  if (mesCerrado_(periodo)) return errorValidacion('periodo', 'Ese mes está cerrado.');
  const exc = excepciones_(periodo);
  exc.cuentas = exc.cuentas || {};
  const tipo = Base.txt_(data.tipo).toUpperCase();
  // I11.4: solo dos tipos de excepción (cuenta fuera de alcance, saldos iniciales pendientes). Nada que permita sobregirar,
  // duplicar un hecho, romper una suma o confirmar una identidad ambigua: esos son invariantes, no se exceptúan.
  if (['CUENTA', 'APERTURAS'].indexOf(tipo) === -1) return errorValidacion('tipo', 'Tipo de excepción no válido: solo una cuenta fuera de alcance o saldos iniciales pendientes.');
  exc.historial = exc.historial || [];
  if (data.quitar) {
    // Quitar no borra: queda en la historia con quién y cuándo.
    const previa = tipo === 'CUENTA' ? exc.cuentas[Base.txt_(data.cuenta_ref)] : exc.aperturas;
    if (previa) exc.historial.push(Object.assign({ tipo, cuenta_ref: tipo === 'CUENTA' ? Base.txt_(data.cuenta_ref) : '', quitada_por: x.nombre, quitada_en: Base.ahora_(), motivo_quitar: motivo }, previa));
    if (tipo === 'CUENTA') delete exc.cuentas[Base.txt_(data.cuenta_ref)]; else exc.aperturas = null;
  } else {
    if (motivo.length < 5) return errorValidacion('motivo', 'Escribe el motivo de la excepción.');
    const evidencia = Base.txt_(data.evidencia).slice(0, 300);
    // Quien la registra tiene la capacidad de cierre: solicita y aprueba en el mismo acto (queda dicho así).
    const reg = { motivo, evidencia, solicitado_por: Base.txt_(data.solicitado_por).slice(0, 120) || x.nombre, aprobado_por: x.nombre, por: x.nombre, en: Base.ahora_() };
    if (tipo === 'CUENTA') {
      const c = I.cuentasMapa_().get(Base.txt_(data.cuenta_ref));
      if (!c) return errorValidacion('cuenta_ref', 'Esa cuenta no existe.');
      exc.cuentas[c.id] = Object.assign(reg, { limitacion: LIMITACION_.CUENTA(c.banco + ' ···' + c.ultimos4) });
    } else exc.aperturas = Object.assign(reg, { limitacion: LIMITACION_.APERTURAS() });
  }
  guardarAjuste_('excepciones|' + periodo, exc, x);
  x.registrar('CIERRE_EXCEPCION', nombreMes_(periodo) + ' · ' + tipo + (data.quitar ? ' (quitada)' : ': ' + motivo.slice(0, 80)));
  return { ok: true };
});

/**
 * Cierra el mes. Exige la lista obligatoria completa y que no queden
 * observaciones sin resolver. Guarda una VERSIÓN reproducible del informe
 * (grupo y cada empresa) además de la foto de siempre.
 */
const cerrar = B.conBoveda('', function (db, data, contexto, x) {
  { const e_ = Base.exigir_(contexto, 'CIERRE'); if (e_) return e_; }
  const periodo = String((data && data.periodo) || '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return errorValidacion('periodo', 'Mes no válido.');
  const v = verificar_(periodo);
  if (!v.listo) return errorValidacion('periodo', 'Todavía no se puede cerrar ' + nombreMes_(periodo) + ': ' + v.pasos.filter((p) => p.obligatorio && !p.ok).map((p) => p.nombre.toLowerCase()).join(', ') + '.');
  const r = filaCierre_(periodo);
  const previo = r ? I.des_(r.datos) : {};
  const abiertas = (previo.observaciones || []).filter((o) => !o.resuelta);
  if (abiertas.length) return errorValidacion('periodo', 'Hay ' + abiertas.length + ' observación(es) sin resolver.');
  // I11.3 · Política de cierre.
  const pol = politicaCierre_();
  const enRevision = !!(r && r.estado === 'EN_REVISION' && previo.revision);
  if (pol.exige_revision && !enRevision) return errorValidacion('periodo', 'La política exige enviar ' + nombreMes_(periodo) + ' a revisión antes de cerrarlo.');
  if (pol.dos_personas && previo.revision && previo.revision.enviado_por === x.nombre) return Base.errPermiso('La política exige que cierre otra persona que la que envió el mes a revisión.');
  const revisionVencida = !!(previo.revision && previo.revision.revision_datos && previo.revision.revision_datos !== Base.revision_());
  if (revisionVencida && (pol.exige_revision || data.exigir_revision)) return Base.errConflicto('Los datos cambiaron desde que se envió a revisión: revísalo de nuevo.');
  const ahora = new Date().toISOString();
  const foto = foto_(db, periodo);
  const version = (db_().prepare('SELECT COALESCE(MAX(version), 0) AS n FROM FIN_CIERRE_VERSIONES WHERE periodo = ?').get(periodo).n) + 1;
  db_().prepare('INSERT INTO FIN_CIERRE_VERSIONES (id, periodo, version, datos, en, por) VALUES (?,?,?,?,?,?)').run(Base.id_(), periodo, version, I.cif_(version_(db, periodo, { revision: previo.revision || null, revision_vencida: revisionVencida, observaciones: previo.observaciones || [], excepciones: excepcionesLista_(periodo), politica: pol, cerrado_por: x.nombre, cerrado_en: ahora })), ahora, x.nombre);
  guardarCierre_(periodo, 'CERRADO', Object.assign(previo, { foto, version, excepciones: excepciones_(periodo), revision_vencida: revisionVencida }), x);
  x.registrar('CERRAR_MES', nombreMes_(periodo) + ' v' + version + (foto ? ' · resultado ' + plata_(foto.resultado) : ''));
  return { periodo, estado: 'CERRADO', foto, version };
});

const reabrir = B.conBoveda('', function (db, data, contexto, x) {
  { const e_ = Base.exigir_(contexto, 'CIERRE'); if (e_) return e_; }
  const periodo = String((data && data.periodo) || '');
  const motivo = String((data && data.motivo) || '').trim().slice(0, 300);
  if (motivo.length < 5) return errorValidacion('motivo', 'Escribe por qué se reabre el mes.');
  if (!mesCerrado_(periodo)) return errorValidacion('periodo', 'Ese mes no está cerrado.');
  const r = filaCierre_(periodo);
  const datos = Object.assign(I.des_(r.datos), { motivo, reaperturas: (I.des_(r.datos).reaperturas || []).concat([{ por: x.nombre, en: Base.ahora_(), motivo }]) });
  db_().prepare("UPDATE FIN_CIERRES SET estado = 'ABIERTO', datos = ?, actualizado_en = ?, actualizado_por = ? WHERE periodo = ?")
    .run(I.cif_(datos), new Date().toISOString(), x.nombre, periodo);
  x.registrar('REABRIR_MES', nombreMes_(periodo) + ': ' + motivo);
  return { periodo, estado: 'ABIERTO' };
});

/** Una versión guardada de un cierre: el informe tal como quedó al cerrar (reproducible). */
const versionCierre = B.conBoveda('VER_CIERRE_VERSION', function (db, data) {
  const periodo = Base.periodo_(data && data.periodo);
  const r = db_().prepare('SELECT * FROM FIN_CIERRE_VERSIONES WHERE periodo = ? AND version = ?').get(periodo, Number(data && data.version));
  if (!r) return errorValidacion('version', 'Esa versión no existe.');
  return Object.assign({ periodo, version: r.version, en: r.en, por: r.por }, I.des_(r.datos));
});

// ---------------------------------------------------------------- paralelo con la planilla

/**
 * Compara la planilla SIGECO (hojas CUENTA BANCARIA y FACTURAS, como las
 * entrega lector-xlsx.js) con lo que hay en la bóveda, mes a mes.
 * data: { banco: filas de CUENTA BANCARIA, facturas: filas de FACTURAS }
 */
const paralelo = B.conBoveda('', function (db, data, contexto, x) {
  // v2: el paralelo guarda su resumen (FIN_AJUSTES): es una escritura, exige la capacidad de cierre.
  { const e_ = Base.exigir_(contexto, 'CIERRE'); if (e_) return e_; }
  const filasB = Array.isArray(data && data.banco) ? data.banco : [];
  const filasF = Array.isArray(data && data.facturas) ? data.facturas : [];
  const cab = (f) => Array.from(f || [], (c) => I.normalizar_(c));
  const cb = cab(filasB[0]);
  const ixB = (n) => cb.indexOf(n);
  const CB = { fecha: ixB('FECHA'), banco: ixB('BANCO'), empresa: ixB('EMPRESA'), ingreso: ixB('INGRESO'), egreso: ixB('EGRESO') };
  if (CB.fecha === -1 || CB.ingreso === -1 || CB.egreso === -1) return errorValidacion('archivo', 'No encuentro la hoja CUENTA BANCARIA de la planilla SIGECO.');

  // Movimientos de la planilla.
  const plan = [];
  filasB.slice(1).forEach((f) => {
    const c = Array.from(f || [], (v) => String(v == null ? '' : v).trim());
    const fecha = I.fechaIso_(c[CB.fecha]);
    const ing = FB.monto_(c[CB.ingreso]) || 0, egr = FB.monto_(c[CB.egreso]) || 0;
    if (!fecha || !(ing > 0 || egr > 0)) return;
    let emp = c[CB.empresa] || ''; if (/^HomePymes/i.test(emp)) emp = 'HomePymes';
    plan.push({ fecha, periodo: fecha.slice(0, 7), banco: I.normalizar_(c[CB.banco]), empresa: emp, abono: ing, cargo: egr, usado: false });
  });
  // Movimientos de la bóveda (de las cuentas del mismo banco y empresa).
  const cuentas = I.cuentasMapa_();
  const boveda = db_().prepare('SELECT cuenta_ref, fecha, periodo, datos FROM FIN_MOVIMIENTOS').all().map((r) => {
    const m = I.des_(r.datos); const cu = cuentas.get(r.cuenta_ref) || {};
    return { fecha: r.fecha, periodo: r.periodo, banco: I.normalizar_(cu.banco), empresa: cu.empresa, abono: m.abono, cargo: m.cargo, glosa: m.glosa, usado: false };
  });
  const clave = (m) => m.empresa + '|' + m.banco;
  const conCuenta = new Set(boveda.map(clave));
  // Emparejar: mismo banco/empresa, mismo monto y sentido, ±3 días.
  plan.forEach((p) => {
    const b = boveda.find((m) => !m.usado && clave(m) === clave(p) && (p.abono ? m.abono === p.abono : m.cargo === p.cargo) && Math.abs(Date.parse(m.fecha) - Date.parse(p.fecha)) <= 3 * 864e5);
    if (b) { b.usado = true; p.usado = true; }
  });
  const periodos = [...new Set(plan.map((p) => p.periodo).concat(boveda.map((m) => m.periodo)))].sort();
  const meses = periodos.map((per) => {
    const P = plan.filter((p) => p.periodo === per && conCuenta.has(clave(p)));
    const Bv = boveda.filter((m) => m.periodo === per);
    const s = (l, k) => l.reduce((a, m) => a + (m[k] || 0), 0);
    const soloBanco = Bv.filter((m) => !m.usado), soloPlan = P.filter((p) => !p.usado);
    return {
      periodo: per, nombre: nombreMes_(per),
      planilla: { movimientos: P.length, ingresos: s(P, 'abono'), egresos: s(P, 'cargo') },
      banco: { movimientos: Bv.length, ingresos: s(Bv, 'abono'), egresos: s(Bv, 'cargo') },
      en_ambos: P.length - soloPlan.length,
      solo_banco: { n: soloBanco.length, ingresos: s(soloBanco, 'abono'), egresos: s(soloBanco, 'cargo') },
      solo_planilla: { n: soloPlan.length, ingresos: s(soloPlan, 'abono'), egresos: s(soloPlan, 'cargo') },
      ok: soloBanco.length === 0 && soloPlan.length === 0 && Bv.length > 0
    };
  });
  const sinCuenta = plan.filter((p) => !conCuenta.has(clave(p)));
  const cuentasSin = [...new Set(sinCuenta.map((p) => p.empresa + ' · ' + (p.banco || 'sin banco')))];

  // Facturas: folios de la planilla que no están en la bóveda y al revés.
  let facturas = null;
  if (filasF.length > 1) {
    const cf = cab(filasF[0]);
    const iF = cf.findIndex((h) => h.indexOf('N FACTURA') === 0), iT = cf.indexOf('TOTAL'), iE = cf.indexOf('ESTADO');
    const folios = filasF.slice(1).map((f) => Array.from(f || [], (v) => String(v == null ? '' : v).trim()))
      .filter((c) => /^\d+(\.0+)?$/.test(c[iF] || '') && !/anulad/i.test(c[iE] || '')).map((c) => ({ folio: c[iF].replace(/\.0+$/, ''), total: FB.monto_(c[iT]) || 0, estado: c[iE] || '' }));
    let enBoveda = new Set();
    try { enBoveda = new Set(db_().prepare('SELECT datos FROM FIN_FACTURAS').all().map((r) => String(I.des_(r.datos).folio))); } catch (e) { /* sin facturas */ }
    const faltan = folios.filter((f) => !enBoveda.has(f.folio));
    const moraPlanilla = folios.filter((f) => /vencida|parcial/i.test(f.estado)).reduce((a, f) => a + f.total, 0);
    let moraBoveda = 0;
    try { [...require('./finanzasCobranza').cartera_(db).values()].forEach((n) => { moraBoveda += n.vencido; }); } catch (e) { /* */ }
    facturas = { planilla: folios.length, faltan_en_boveda: faltan.length, ejemplos: faltan.slice(0, 8).map((f) => f.folio), mora_planilla: moraPlanilla, mora_boveda: moraBoveda };
  }
  x.registrar('PARALELO_PLANILLA', meses.map((m) => m.periodo + (m.ok ? ' igual' : ' con diferencias')).join(', '));
  const res = { meses, cuentas_sin_cartola: cuentasSin, movimientos_sin_cartola: sinCuenta.length, facturas, hecho_en: new Date().toISOString(), hecho_por: x.nombre };
  // Se guarda el último paralelo (solo el resumen) para la lista de retiro.
  db_().prepare('INSERT INTO FIN_AJUSTES (clave, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
    .run('paralelo', I.cif_({ meses: meses.map((m) => ({ periodo: m.periodo, ok: m.ok })), hecho_en: res.hecho_en }), res.hecho_en, x.nombre);
  return res;
});

// ---------------------------------------------------------------- retiro de la planilla

const PASOS_MANUALES = [
  { id: 'solo_lectura', nombre: 'Dejar el Google Sheet en solo lectura', ayuda: 'En Google Sheets › Compartir: cambia a todas las personas a «Lector» y desactiva «Los lectores pueden descargar, imprimir y copiar».' },
  { id: 'activadores', nombre: 'Borrar los activadores de Apps Script', ayuda: 'Extensiones › Apps Script › Activadores (reloj): borra «tareaDiaria». Así la planilla deja de recalcular y de enviar correos con cifras.' },
  { id: 'enlaces', nombre: 'Quitar el acceso por enlace', ayuda: 'Compartir › Acceso general: «Restringido». Nadie que tenga el enlace puede abrirla.' },
  { id: 'archivar', nombre: 'Archivar la planilla', ayuda: 'Muévela a una carpeta «Archivo SIGECO» de acceso restringido y avisa al equipo que desde ahora todo se registra en Finanzas.' }
];

function retiro_(db, meses) {
  const d = db_();
  const marcados = (() => { const r = d.prepare("SELECT datos FROM FIN_AJUSTES WHERE clave = 'retiro'").get(); return r ? I.des_(r.datos).pasos || {} : {}; })();
  const par = (() => { const r = d.prepare("SELECT datos FROM FIN_AJUSTES WHERE clave = 'paralelo'").get(); return r ? I.des_(r.datos) : null; })();
  const activos = B.dbFin().prepare('SELECT COUNT(*) AS n FROM FIN_AUTENTICADOR WHERE activo = 1').get().n;
  const lista = String(process.env.SIGSO_FINANZAS_ACCESO || '').split(',').filter((s) => s.trim()).length;
  const soloLectura = String(process.env.SIGSO_FINANZAS_SOLO_LECTURA || '').split(',').filter((s) => s.trim()).length;
  const cerrados = meses.filter((m) => m.estado === 'CERRADO');
  const parOk = par && par.meses.some((m) => m.ok);
  const auto = [
    { id: 'autenticadores', nombre: 'Las ' + lista + ' personas con su Authenticator', ok: lista > 0 && activos >= lista, detalle: activos + ' de ' + lista + ' activos' },
    { id: 'solo_lectura_rogelio', nombre: 'Gerencia en solo lectura', ok: soloLectura > 0, detalle: soloLectura ? soloLectura + ' cuenta(s) de solo lectura' : 'Falta SIGSO_FINANZAS_SOLO_LECTURA en el servidor' },
    { id: 'mes_cerrado', nombre: 'Al menos un mes cerrado en Finanzas', ok: cerrados.length > 0, detalle: cerrados.length ? cerrados.map((m) => m.nombre).join(', ') : 'Ningún mes cerrado todavía' },
    { id: 'paralelo', nombre: 'Un mes igual en la planilla y en el banco', ok: !!parOk, detalle: par ? par.meses.map((m) => nombreMes_(m.periodo) + (m.ok ? ' ✓' : ' con diferencias')).join(' · ') : 'Todavía no se hace el paralelo' }
  ];
  const manuales = PASOS_MANUALES.map((p) => Object.assign({}, p, { ok: !!marcados[p.id], por: marcados[p.id] ? marcados[p.id].por : '', en: marcados[p.id] ? marcados[p.id].en : '' }));
  return { automaticos: auto, manuales, listo_para_archivar: auto.every((a) => a.ok), retirada: manuales.every((m) => m.ok) && auto.every((a) => a.ok) };
}

const marcarPasoRetiro = B.conBoveda('', function (db, data, contexto, x) {
  { const e_ = Base.exigir_(contexto, 'CIERRE'); if (e_) return e_; }
  const id = String((data && data.id) || '');
  if (!PASOS_MANUALES.some((p) => p.id === id)) return errorValidacion('id', 'Paso desconocido.');
  const d = db_();
  const r = d.prepare("SELECT datos FROM FIN_AJUSTES WHERE clave = 'retiro'").get();
  const datos = r ? I.des_(r.datos) : { pasos: {} };
  if (data.hecho) datos.pasos[id] = { por: x.nombre, en: new Date().toISOString() }; else delete datos.pasos[id];
  d.prepare("INSERT INTO FIN_AJUSTES (clave, datos, actualizado_en, actualizado_por) VALUES ('retiro', ?, ?, ?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por")
    .run(I.cif_(datos), new Date().toISOString(), x.nombre);
  x.registrar('RETIRO_PASO', id + (data.hecho ? ' hecho' : ' desmarcado'));
  return { ok: true };
});

module.exports = { estadoMes_, estado, cerrar, reabrir, paralelo, marcarPasoRetiro, enviarRevision, observar, resolverObservacion, excepcion, versionCierre, mesCerrado_, verificar_, foto_, politicaCierre_, excepcionesLista_ };
