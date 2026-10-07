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
const FB = require('./finanzasBancos');
const { errorValidacion, errorForbidden } = require('./errores');

const I = FB.interno;

let preparada_ = null;
function db_() {
  const d = I.db_();
  if (preparada_ === d) return d;
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_CIERRES (
    periodo TEXT PRIMARY KEY, estado TEXT NOT NULL, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)`);
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_AJUSTES (clave TEXT PRIMARY KEY, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)`);
  preparada_ = d;
  return d;
}

function mesCerrado_(periodo) {
  try {
    const r = db_().prepare('SELECT estado FROM FIN_CIERRES WHERE periodo = ?').get(String(periodo));
    return !!(r && r.estado === 'CERRADO');
  } catch (e) { return false; }
}
function ultimoDia_(p) { const [a, m] = p.split('-').map(Number); return p + '-' + String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0'); }
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function nombreMes_(p) { const [a, m] = p.split('-').map(Number); return MESES[m - 1] + ' ' + a; }
const plata_ = (n) => { const v = Math.round(n || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); };

/** La lista de verificación de un mes. */
function verificar_(periodo) {
  const d = db_();
  const inicio = periodo + '-01', fin = ultimoDia_(periodo);
  const cuentas = I.cuentasMapa_();
  const imps = d.prepare('SELECT cuenta_ref, desde, hasta, datos FROM FIN_IMPORTACIONES').all().map((r) => Object.assign(r, I.des_(r.datos)));
  // 1) Cada cuenta conocida tiene cartolas que cubren el mes entero (sin huecos).
  const cobertura = [...cuentas.values()].map((c) => {
    const tramos = imps.filter((x) => x.cuenta_ref === c.id && x.hasta >= inicio && x.desde <= fin).sort((a, b) => (a.desde < b.desde ? -1 : 1));
    let hasta = '';
    let continuo = tramos.length > 0 && tramos[0].desde <= inicio;
    tramos.forEach((t) => {
      if (hasta && t.desde > siguienteDia_(hasta)) continuo = false;
      if (t.hasta > hasta) hasta = t.hasta;
    });
    return { cuenta: c.banco + ' ···' + c.ultimos4 + ' (' + c.empresa + ')', completa: continuo && hasta >= fin, hasta: hasta || '' };
  });
  // 2) Las cartolas del mes cuadraron (saldo a saldo y con el resumen del banco).
  const delMes = imps.filter((x) => x.hasta >= inicio && x.desde <= fin);
  const descuadradas = delMes.filter((x) => x.cuadra === false).length;
  // 3) Nada sin revisar.
  const pend = d.prepare("SELECT COUNT(*) AS n FROM FIN_MOVIMIENTOS WHERE periodo = ? AND estado = 'PENDIENTE'").get(periodo).n;
  const total = d.prepare('SELECT COUNT(*) AS n FROM FIN_MOVIMIENTOS WHERE periodo = ?').get(periodo).n;
  // 4) Ventas del SII del mes cargadas (aviso, no bloquea: puede no haber facturado).
  let ventas = 0;
  try { ventas = d.prepare("SELECT COUNT(*) AS n FROM FIN_FACTURAS WHERE periodo = ? AND origen = 'rcv'").get(periodo).n; } catch (e) { ventas = 0; }
  const pasos = [
    { id: 'cartolas', nombre: 'Cartolas del mes completo', ok: cobertura.length > 0 && cobertura.every((c) => c.completa), obligatorio: true,
      detalle: cobertura.length ? cobertura.map((c) => c.cuenta + (c.completa ? ': completa' : ': falta' + (c.hasta ? ' desde el ' + siguienteDia_(c.hasta).slice(8) : ' todo el mes'))).join(' · ') : 'No hay cuentas cargadas.' },
    { id: 'cuadra', nombre: 'Saldos cuadran con el banco', ok: delMes.length > 0 && !descuadradas, obligatorio: true,
      detalle: delMes.length ? (descuadradas ? descuadradas + ' cartola(s) no cuadraron' : delMes.length + ' cartola(s), todas cuadran') : 'Sin cartolas del mes.' },
    { id: 'revisado', nombre: 'Todo revisado', ok: total > 0 && pend === 0, obligatorio: true,
      detalle: total ? (pend ? 'Faltan ' + pend + ' de ' + total + ' movimientos' : 'Los ' + total + ' movimientos confirmados') : 'Sin movimientos.' },
    { id: 'ventas', nombre: 'Ventas del SII cargadas', ok: ventas > 0, obligatorio: false,
      detalle: ventas ? ventas + ' documento(s) del Registro de Ventas' : 'No hay facturas del SII de este mes (si se facturó, súbelas en Cobranza).' }
  ];
  return { periodo, pasos, listo: pasos.filter((p) => p.obligatorio).every((p) => p.ok) };
}
function siguienteDia_(iso) { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }

// ---------------------------------------------------------------- acciones de cierre

const estado = B.conBoveda('VER_CIERRE', function (db) {
  const d = db_();
  const periodos = d.prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS ORDER BY periodo DESC').all().map((r) => r.periodo);
  const cierres = new Map(d.prepare('SELECT * FROM FIN_CIERRES').all().map((r) => [r.periodo, r]));
  const meses = periodos.map((p) => {
    const c = cierres.get(p);
    const v = verificar_(p);
    const info = c ? I.des_(c.datos) : null;
    return Object.assign(v, { nombre: nombreMes_(p), estado: c ? c.estado : 'ABIERTO', cerrado_por: c && c.estado === 'CERRADO' ? c.actualizado_por : '', cerrado_en: c ? c.actualizado_en : '', foto: info && info.foto, ultimo_motivo: info && info.motivo });
  });
  return { meses, retiro: retiro_(db, meses) };
});

/** Foto del mes al cerrarlo (lo que quedó firme). */
function foto_(db, periodo) {
  try {
    const t = require('./finanzasTablero').calcular_(db, periodo, '');
    return { ingresos: t.mes.ingresos, egresos: t.mes.egresos, resultado: t.mes.resultado, caja: t.caja, custodia: t.custodia };
  } catch (e) { return null; }
}

const cerrar = B.conBoveda('', function (db, data, contexto, x) {
  if (I.soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const periodo = String((data && data.periodo) || '');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return errorValidacion('periodo', 'Mes no válido.');
  const v = verificar_(periodo);
  if (!v.listo) return errorValidacion('periodo', 'Todavía no se puede cerrar ' + nombreMes_(periodo) + ': ' + v.pasos.filter((p) => p.obligatorio && !p.ok).map((p) => p.nombre.toLowerCase()).join(', ') + '.');
  const ahora = new Date().toISOString();
  const foto = foto_(db, periodo);
  db_().prepare("INSERT INTO FIN_CIERRES (periodo, estado, datos, actualizado_en, actualizado_por) VALUES (?, 'CERRADO', ?, ?, ?) " +
    "ON CONFLICT(periodo) DO UPDATE SET estado = 'CERRADO', datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por")
    .run(periodo, I.cif_({ foto }), ahora, x.nombre);
  x.registrar('CERRAR_MES', nombreMes_(periodo) + (foto ? ' · resultado ' + plata_(foto.resultado) : ''));
  return { periodo, estado: 'CERRADO', foto };
});

const reabrir = B.conBoveda('', function (db, data, contexto, x) {
  if (I.soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
  const periodo = String((data && data.periodo) || '');
  const motivo = String((data && data.motivo) || '').trim().slice(0, 300);
  if (motivo.length < 5) return errorValidacion('motivo', 'Escribe por qué se reabre el mes.');
  if (!mesCerrado_(periodo)) return errorValidacion('periodo', 'Ese mes no está cerrado.');
  const r = db_().prepare('SELECT datos FROM FIN_CIERRES WHERE periodo = ?').get(periodo);
  const datos = Object.assign(I.des_(r.datos), { motivo });
  db_().prepare("UPDATE FIN_CIERRES SET estado = 'ABIERTO', datos = ?, actualizado_en = ?, actualizado_por = ? WHERE periodo = ?")
    .run(I.cif_(datos), new Date().toISOString(), x.nombre, periodo);
  x.registrar('REABRIR_MES', nombreMes_(periodo) + ': ' + motivo);
  return { periodo, estado: 'ABIERTO' };
});

// ---------------------------------------------------------------- paralelo con la planilla

/**
 * Compara la planilla SIGECO (hojas CUENTA BANCARIA y FACTURAS, como las
 * entrega lector-xlsx.js) con lo que hay en la bóveda, mes a mes.
 * data: { banco: filas de CUENTA BANCARIA, facturas: filas de FACTURAS }
 */
const paralelo = B.conBoveda('', function (db, data, contexto, x) {
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
  if (I.soloEscritura_(contexto)) return errorForbidden('Tu acceso a Finanzas es de solo lectura.');
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

module.exports = { estado, cerrar, reabrir, paralelo, marcarPasoRetiro, mesCerrado_, verificar_ };
