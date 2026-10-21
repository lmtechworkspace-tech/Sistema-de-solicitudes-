'use strict';

/**
 * finanzasCargas.js — centro de cargas y migración de las planillas
 * anteriores (2026-10-20; FIN-17, FIN-18, FIN-42, FIN-45; anexos A y C).
 *
 * Las cartolas, el detalle del banco y el Registro de Ventas tienen sus
 * propios lectores (Bancos y Cobranza). Aquí entran los LIBROS de trabajo
 * anteriores — la planilla SIGECO (18 hojas) y el Excel BANCOS (con sus hojas
 * ocultas de Santander) — en dos pasos, sin publicar nada a ciegas:
 *
 *  1. STAGING: se guarda cada fila de cada hoja (también las ocultas) con
 *     sus valores originales, sus fórmulas (como texto, nunca se ejecutan), el
 *     archivo, la hoja y el número de fila. El mismo archivo (hash) no entra
 *     dos veces; una fila idéntica de otro archivo (p. ej. la historia de
 *     Santander repetida en cada libro mensual) queda como REPETIDA.
 *  2. PUBLICAR por hoja: cada hoja tiene su destino en SIGSO (anexo A). Cada
 *     fila termina PUBLICADA (con dónde quedó), PARCIAL (publicada con una
 *     observación), INCIDENCIA (con el motivo: nunca se convierte en cero),
 *     HISTÓRICA (solo consulta: FLUJO, RESUMEN) o REPETIDA. Volver a publicar
 *     no duplica (claves de origen únicas).
 *
 * Nada de lo migrado se confirma solo como dinero: los movimientos de las
 * planillas quedan como SUGERENCIAS sobre la cartola; los pagos de SIGECO se
 * aplican a facturas solo si se encuentra el abono en el banco; la historia de
 * Santander (sin cartola) entra como BORRADORES. Los grupos de la columna
 * UNITARIO del Excel BANCOS quedan como gestiones de fondos CANDIDATAS que
 * una persona confirma (cliente, obligación y período).
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const Cat = require('./finanzasCatalogos');
const FB = require('./finanzasBancos');
const { errorValidacion } = require('./errores');

const I = FB.interno;
const ESTADOS = { PENDIENTE: 'Por publicar', PUBLICADA: 'Publicada', PARCIAL: 'Publicada con observación', INCIDENCIA: 'Incidencia', HISTORICA: 'Histórica (consulta)', REPETIDA: 'Repetida de otro archivo', APARTADA: 'Apartada (recuperable)' };

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
function db_() {
  const d = Base.db_();
  if (preparada_ === d) return d;
  [
    `CREATE TABLE IF NOT EXISTS FIN_FUENTES (
       id TEXT PRIMARY KEY, tipo TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, estado TEXT NOT NULL, datos TEXT NOT NULL, creado_en TEXT, creado_por TEXT, actualizado_en TEXT)`,
    `CREATE TABLE IF NOT EXISTS FIN_FUENTE_FILAS (
       id TEXT PRIMARY KEY, lote_id TEXT NOT NULL, hoja TEXT NOT NULL, fila INTEGER NOT NULL, estado TEXT NOT NULL, huella TEXT NOT NULL,
       destino TEXT, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)`,
    'CREATE INDEX IF NOT EXISTS ix_fin_ff_lote ON FIN_FUENTE_FILAS (lote_id, hoja, fila)',
    'CREATE INDEX IF NOT EXISTS ix_fin_ff_huella ON FIN_FUENTE_FILAS (huella)',
    // La misma tabla de ajustes del cierre (grupos candidatos, historial de mejoras).
    'CREATE TABLE IF NOT EXISTS FIN_AJUSTES (clave TEXT PRIMARY KEY, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)'
  ].forEach((sql) => d.exec(sql));
  preparada_ = d;
  return d;
}
const N = (s) => Base.normalizar_(s);
// Columnas que la planilla calcula sola (correlativo, separador, saldo acumulado): una fila con datos solo ahí es plantilla.
const DERIVADAS_ = ['AB', '.', 'SALDO'].map(N);

// ---------------------------------------------------------------- reconocer el libro

const HOJAS_SIGECO = ['CATALOGOS', 'CLIENTES', 'FACTURAS', 'PAGOS', 'MOVIMIENTOS', 'GASTOS COMPARTIDOS', 'PRESTAMOS INTERCO', 'PROYECTOS', 'PRESUPUESTO', 'RESUMEN AUTO', 'MEJORAS', 'CUENTA BANCARIA', 'HISTORIAL ABONOS'];
/** Fila de encabezados: la primera (de las 30 primeras) con al menos 2 títulos conocidos. */
const TITULOS = ['FECHA', 'DETALLE', 'TOTAL', 'ID', 'RUT', 'CLIENTE', 'EMPRESA', 'MONTO', 'TIPO', 'CUENTA', 'CONCEPTO', 'MES AAAA MM', 'ANO', 'ENE', 'EMPRESAS', 'PLAN DE CUENTAS', 'N FACTURA', 'FECHA PAGO', 'PROYECTO', 'IDEA MEJORA PROPUESTA', 'OBS', 'OBSERVACION', 'SALDO', 'UNITARIO'];
function encabezado_(filas) {
  for (let i = 0; i < Math.min(filas.length, 30); i++) {
    const c = Array.from(filas[i] || [], (x) => N(x));
    if (c.filter((x) => TITULOS.indexOf(x) !== -1 || x.indexOf('FECHA') === 0).length >= 2) return i;
  }
  return -1;
}
function tipoLibro_(hojas) {
  const nombres = hojas.map((h) => N(h.nombre));
  if (HOJAS_SIGECO.filter((n) => nombres.indexOf(n) !== -1).length >= 4) return 'SIGECO';
  const bancos = hojas.some((h) => { const e = encabezado_(h.filas || []); if (e === -1) return false; const c = Array.from(h.filas[e] || [], N); return c.indexOf('FECHA') !== -1 && c.indexOf('DETALLE') !== -1 && c.indexOf('TOTAL') !== -1; });
  return bancos ? 'BANCOS' : '';
}

// ---------------------------------------------------------------- 1. staging

/**
 * data: { nombre, hash (SHA-256 del archivo, calculado en el navegador),
 *         hojas: [{ nombre, oculta, filas, formulas }] }
 */
const cargar = Base.conCapacidad('MIGRAR', '', function (db, data, contexto, x) {
  const hash = Base.txt_(data && data.hash).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return errorValidacion('hash', 'Falta la huella del archivo.');
  const hojas = (Array.isArray(data.hojas) ? data.hojas : []).slice(0, 40).map((h) => ({ nombre: Base.txt_(h.nombre).slice(0, 80), oculta: !!h.oculta, filas: Array.isArray(h.filas) ? h.filas.slice(0, 5000) : [], formulas: Array.isArray(h.formulas) ? h.formulas : [] }));
  const tipo = tipoLibro_(hojas);
  if (!tipo) return Base.errFuente('No reconozco este libro. Aquí se cargan la planilla SIGECO o el Excel BANCOS. La cartola y el detalle del banco se suben en Bancos; el Registro de Ventas, en Cobranza.');
  const d = db_();
  const ya = d.prepare('SELECT id, estado FROM FIN_FUENTES WHERE hash = ?').get(hash);
  if (ya) return { lote_id: ya.id, repetido: true, mensaje: 'Este mismo archivo ya se cargó: no se vuelve a importar.' };
  const lote = Base.id_(), ahora = Base.ahora_();
  const resumen = [];
  Base.transaccion_(() => {
    const ins = d.prepare('INSERT INTO FIN_FUENTE_FILAS (id, lote_id, hoja, fila, estado, huella, destino, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?)');
    hojas.forEach((h) => {
      const e = encabezado_(h.filas);
      const cab = e === -1 ? [] : Array.from(h.filas[e] || [], (c) => Base.txt_(c));
      let n = 0, rep = 0, plantilla = 0;
      // I13 (datos reales): el Excel BANCOS arrastra cientos de filas de plantilla con solo el correlativo y el
      // saldo calculado. No son datos: no se cargan como filas, pero se cuentan para que el cuadro las explique.
      const derivadas = cab.map((c) => DERIVADAS_.indexOf(N(c)) !== -1);
      h.filas.forEach((f, i) => {
        if (i <= e) return; // encabezado y lo de arriba (resúmenes) se guardan aparte
        const vals = Array.from(f || [], (c) => (c == null ? '' : String(c)));
        if (!vals.some((v) => String(v).trim())) return;
        if (derivadas.some(Boolean) && !vals.some((v, j) => String(v).trim() && !derivadas[j])) { plantilla++; return; }
        const huella = I.hmac_('fila|' + N(h.nombre) + '|' + JSON.stringify(vals));
        const otra = d.prepare("SELECT lote_id FROM FIN_FUENTE_FILAS WHERE huella = ? AND lote_id != ? AND estado != 'REPETIDA' LIMIT 1").get(huella, lote);
        const estado = otra ? 'REPETIDA' : 'PENDIENTE';
        if (otra) rep++;
        ins.run(Base.id_(), lote, h.nombre, i + 1, estado, huella, otra ? 'Igual que en otro archivo ya cargado' : null,
          Base.cif_({ valores: vals, formulas: Array.from((h.formulas || [])[i] || [], (c) => c || ''), repetida_de: otra ? otra.lote_id : '' }), ahora, x.nombre);
        n++;
      });
      // Lo de arriba del encabezado (resúmenes, celdas sueltas) se conserva como evidencia del archivo.
      const arriba = e > 0 ? h.filas.slice(0, e).map((f, i) => ({ fila: i + 1, valores: Array.from(f || [], (c) => (c == null ? '' : String(c))), formulas: Array.from((h.formulas || [])[i] || [], (c) => c || '') })).filter((r) => r.valores.some((v) => v.trim())) : [];
      resumen.push({ nombre: h.nombre, oculta: h.oculta, encabezado_fila: e + 1, columnas: cab, filas: n, repetidas: rep, plantilla, arriba });
    });
    d.prepare('INSERT INTO FIN_FUENTES (id, tipo, hash, estado, datos, creado_en, creado_por, actualizado_en) VALUES (?,?,?,?,?,?,?,?)')
      .run(lote, tipo, hash, 'STAGED', Base.cif_({ nombre: Base.txt_(data.nombre).slice(0, 160), hojas: resumen, publicaciones: [] }), ahora, x.nombre, ahora);
  });
  x.registrar('CARGA_LIBRO', tipo + ': ' + resumen.length + ' hoja(s), ' + resumen.reduce((s, h) => s + h.filas, 0) + ' fila(s)');
  return { lote_id: lote, tipo, hojas: resumen.map((h) => ({ nombre: h.nombre, oculta: h.oculta, filas: h.filas, repetidas: h.repetidas, plantilla: h.plantilla, destino: destinoHoja_(tipo, h.nombre) })) };
});

/** Destino de cada hoja (anexo A), para mostrarlo antes de publicar. */
function destinoHoja_(tipo, hoja) {
  const n = N(hoja);
  if (tipo === 'BANCOS') return /BCI/.test(n) ? 'Sugerencias sobre la cartola del BCI + grupos de fondos candidatos (UNITARIO)' : /SANTANDER/.test(n) ? 'Borradores en el registro (sin cartola Santander: no se confirman solos)' : 'Solo consulta';
  const m = {
    CATALOGOS: 'Catálogos (canales, vendedores, medios, conceptos…)', CLIENTES: 'Ficha comercial, servicios y asignación a proyectos', FACTURAS: 'Facturas (el SII manda si después llega el mismo folio)',
    PAGOS: 'Aplicaciones a facturas (solo si el abono está en el banco)', 'HISTORIAL ABONOS': 'Abonos del banco y sus aplicaciones', MOVIMIENTOS: 'Evidencia sobre los movimientos del banco (no se cuenta de nuevo)',
    'CUENTA BANCARIA': 'Sugerencias sobre la cartola (no se confirman solas)', 'GASTOS COMPARTIDOS': 'Gastos compartidos (vincular a su pago)', 'PRESTAMOS INTERCO': 'Préstamos entre empresas',
    PROYECTOS: 'Proyectos', PRESUPUESTO: 'Presupuesto en BORRADOR (hay que revisarlo y aprobarlo)', MEJORAS: 'Historial de pedidos de mejora', 'RESUMEN AUTO': 'Solo consulta (se recalcula desde los datos)'
  };
  if (/^FLUJO/.test(n)) return 'Solo consulta (el flujo se recalcula desde los datos)';
  return m[n] || 'Solo consulta';
}

// ---------------------------------------------------------------- lectura

function lote_(id) { const r = db_().prepare('SELECT * FROM FIN_FUENTES WHERE id = ?').get(String(id)); return r ? Object.assign({ id: r.id, tipo: r.tipo, estado: r.estado, creado_en: r.creado_en, creado_por: r.creado_por }, Base.des_(r.datos)) : null; }
function filasHoja_(lote, hoja) {
  return db_().prepare('SELECT * FROM FIN_FUENTE_FILAS WHERE lote_id = ? AND hoja = ? ORDER BY fila').all(lote, hoja)
    .map((r) => Object.assign({ id: r.id, fila: r.fila, estado: r.estado, destino: r.destino || '' }, Base.des_(r.datos)));
// (cada fila trae valores, fórmulas, correcciones, historial, incidencia y «dónde quedó»)
}

const fuentes = B.conBoveda('', function () {
  const d = db_();
  return {
    estados: ESTADOS,
    lotes: d.prepare('SELECT * FROM FIN_FUENTES ORDER BY creado_en DESC').all().map((r) => {
      const l = lote_(r.id);
      const cuenta = d.prepare('SELECT hoja, estado, COUNT(*) AS n FROM FIN_FUENTE_FILAS WHERE lote_id = ? GROUP BY hoja, estado').all(r.id);
      return { id: r.id, tipo: r.tipo, estado: r.estado, nombre: l.nombre, creado_en: r.creado_en, creado_por: r.creado_por, publicaciones: l.publicaciones || [],
        hojas: l.hojas.map((h) => { const c = {}; cuenta.filter((x) => x.hoja === h.nombre).forEach((x) => { c[x.estado] = x.n; }); return { nombre: h.nombre, oculta: h.oculta, filas: h.filas, columnas: h.columnas, destino: destinoHoja_(r.tipo, h.nombre), por_estado: c }; }) };
    })
  };
});

/** Filas de una hoja cargada, con su estado, «dónde quedó» y su valor original (y fórmula). */
const fuente = B.conBoveda('', function (db, data) {
  const l = lote_(Base.txt_(data && data.lote_id));
  if (!l) return errorValidacion('lote_id', 'Esa carga no existe.');
  const hoja = l.hojas.find((h) => h.nombre === Base.txt_(data.hoja)) || l.hojas[0];
  let filas = filasHoja_(l.id, hoja.nombre);
  if (data.estado) filas = filas.filter((f) => f.estado === data.estado);
  const pagina = Math.max(1, Number(data.pagina) || 1), por = 200;
  return { lote: { id: l.id, tipo: l.tipo, nombre: l.nombre }, hoja: { nombre: hoja.nombre, oculta: hoja.oculta, columnas: hoja.columnas, encabezado_fila: hoja.encabezado_fila, arriba: hoja.arriba, destino: destinoHoja_(l.tipo, hoja.nombre) },
    total: filas.length, pagina, filas: filas.slice((pagina - 1) * por, pagina * por), estados: ESTADOS };
});

// ---------------------------------------------------------------- 2. publicar

function marcar_(id, estado, destino, extra, x) {
  const d = db_();
  const r = d.prepare('SELECT datos FROM FIN_FUENTE_FILAS WHERE id = ?').get(id);
  const datos = Object.assign(Base.des_(r.datos), extra || {});
  d.prepare('UPDATE FIN_FUENTE_FILAS SET estado = ?, destino = ?, datos = ?, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(estado, destino || null, Base.cif_(datos), Base.ahora_(), x.nombre, id);
}
/** Objeto { TITULO_NORMALIZADO: valor } de una fila, con los títulos de su hoja. */
function porTitulo_(cab, vals) { const o = {}; cab.forEach((t, i) => { const k = N(t); if (k && o[k] === undefined) o[k] = Base.txt_(vals[i]); }); return o; }
function fecha_(v) { return I.fechaIso_(v); }
/**
 * Monto de una celda (I07.3). Nunca convierte un error en cero ni supone CLP:
 *  - error de fórmula (#REF!, #DIV/0!…) → incidencia;
 *  - otra moneda (US$, USD, €, UF) → incidencia que conserva código e importe (fuera del consolidado);
 *  - «1.500» escrito como texto son mil quinientos (miles chilenos), no 1,5.
 */
const ERROR_FORMULA_ = /^#(REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|NULL!|SPILL!|CALC!)/i;
const OTRA_MONEDA_ = /^(US\$|USD|U\$S|EUR|€|UF|CLF)\s*|\s*(USD|EUR|UF)$/i;
function monto_(v) {
  if (v === '' || v === null || v === undefined) return { ok: true, valor: 0, vacio: true };
  const t = String(v).trim();
  if (ERROR_FORMULA_.test(t)) return { ok: false, error: 'La celda trae un error de fórmula (' + t + '): no se convierte en cero; corrige la planilla o escribe el valor.' };
  const mon = OTRA_MONEDA_.exec(t);
  if (mon) return { ok: false, moneda: (mon[1] || mon[2]).toUpperCase().replace('U$S', 'USD').replace('US$', 'USD').replace('€', 'EUR'), error: 'Monto en otra moneda (' + t + '): se conserva tal cual y queda fuera del consolidado hasta definir la conversión.' };
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return Base.montoClp_(t);
  const c = Base.montoExcel_(v);
  return c !== null ? { ok: true, valor: c } : Base.montoClp_(v);
}

/** Cliente por el ID de la planilla (C001), por RUT o por razón social exacta. Nunca por parecido. */
function clienteDe_(db, ctx, o) {
  const cod = Base.txt_(o['ID CLIENTE'] || o.ID).toUpperCase();
  if (cod && ctx.porCodigo.has(cod)) return ctx.porCodigo.get(cod);
  const rut = Base.rut_(o.RUT);
  if (rut.normal) { const c = ctx.clientes.find((x) => Base.rut_(x.rut).normal === rut.normal); if (c) return c; }
  const nom = N(o.CLIENTE || o['RAZON SOCIAL'] || o['CLIENTE GLOSA'] || '');
  const ex = ctx.clientes.filter((x) => x.n === nom);
  return ex.length === 1 ? ex[0] : null;
}
function contextoPub_(db) {
  const clientes = I.clientes_(db);
  const porCodigo = new Map();
  try { require('./finanzasClientes').fichas_().forEach((f, id) => { if (f.codigo_legado) { const c = clientes.find((x) => x.id === id); if (c) porCodigo.set(f.codigo_legado.toUpperCase(), c); } }); } catch (e) { /* sin fichas */ }
  return { clientes, porCodigo };
}

const MAPEADORES = {};

// CATÁLOGOS: cada columna es un catálogo; los valores se agregan si no existen (las empresas no se crean).
MAPEADORES.CATALOGOS = function (db, filas, cab, x) {
  const col = (n) => cab.findIndex((t) => N(t) === n);
  const pares = [['CANALES', 'CANAL'], ['VENDEDORES', 'VENDEDOR'], ['ESTADOS FACTURA', 'ESTADO_FACTURA'], ['MEDIOS DE PAGO', 'MEDIO'], ['TIPOS PROYECTO', 'TIPO_PROYECTO'], ['BANCOS', 'BANCO']];
  return filas.map((f) => {
    const hechos = [], obs = [];
    pares.forEach(([titulo, tipo]) => { const i = col(titulo); const v = i === -1 ? '' : Base.txt_(f.valores[i]); if (v) { const r = Cat.asegurar_(tipo, v, tipo === 'MEDIO' ? { caja: true } : null, x.nombre); if (r.error) obs.push(r.error); else hechos.push(Cat.TIPOS[tipo] + ': ' + v + (r.creado ? ' (nuevo)' : '')); } });
    const ie = col('EMPRESAS'); const emp = ie === -1 ? '' : Base.txt_(f.valores[ie]);
    if (emp) { if (Cat.empresa_(emp)) hechos.push('Empresa: ' + emp + ' = ' + Cat.empresa_(emp)); else obs.push('Empresa «' + emp + '» no reconocida: no se crea; agrégala como alias si corresponde.'); }
    const ic = col('PLAN DE CUENTAS'), it = col('TIPO');
    const cuenta = ic === -1 ? '' : Base.txt_(f.valores[ic]), tipoC = it === -1 ? '' : N(f.valores[it]);
    if (cuenta) {
      const grupo = /^INGRESO/.test(tipoC) ? 'INGRESO' : /^EGRESO|^GASTO/.test(tipoC) ? 'EGRESO' : /PROVISION/.test(tipoC) ? 'PROVISION' : '';
      if (!grupo) obs.push('Concepto «' + cuenta + '» sin tipo reconocible (' + (f.valores[it] || 'vacío') + ').');
      else { const ya = Cat.lista_('CONCEPTO', { todos: true }).find((c) => N(c.nombre) === N(cuenta) && c.grupo === grupo); if (!ya) { Cat.asegurar_('CONCEPTO', cuenta, { grupo }, x.nombre); hechos.push('Concepto nuevo: ' + cuenta); } else hechos.push('Concepto: ' + cuenta); }
    }
    const ir = col('REGLAS PRORRATEO'); if (ir !== -1 && Base.txt_(f.valores[ir])) hechos.push('Modo de reparto: ' + f.valores[ir] + ' (disponible en gastos compartidos)');
    if (!hechos.length && !obs.length) return { estado: 'HISTORICA', destino: 'Fila sin valores de catálogo' };
    return { estado: obs.length ? (hechos.length ? 'PARCIAL' : 'INCIDENCIA') : 'PUBLICADA', destino: hechos.join(' · '), incidencia: obs.join(' ') };
  });
};

// CLIENTES: ficha comercial, servicio (si tiene) y asignación a proyecto (si se identifica).
MAPEADORES.CLIENTES = function (db, filas, cab, x, ctx, lote) {
  const Cl = require('./finanzasClientes');
  return filas.map((f) => {
    const o = porTitulo_(cab, f.valores);
    const cli = clienteDe_(db, Object.assign({}, ctx, { porCodigo: new Map() }), { RUT: o.RUT, CLIENTE: o['RAZON SOCIAL'] });
    if (!cli) return { estado: 'INCIDENCIA', incidencia: 'El cliente (RUT ' + (o.RUT || '—') + ') no está en el maestro de SIGSO: créalo en Administración › Clientes y vuelve a publicar esta fila.' };
    const obs = [];
    const r = Cl.guardarFicha_(db, { cliente_id: cli.id, codigo_legado: o.ID, empresa_facturadora: o['EMPRESA FACTURADORA'], canal: o['CANAL DE CAPTACION'], vendedor: o.VENDEDOR,
      fecha_ingreso: fecha_(o['FECHA INGRESO']), estado: ['Activo', 'Suspendido', 'Terminado', 'Prospecto'].find((e) => N(e) === N(o.ESTADO)) || '', obs: o.OBSERVACIONES,
      // I11.2: la publicación declara la versión que lee dentro de su transacción (no actualiza «a ciegas»).
      expected_version: (Cl.fichas_().get(cli.id) || {}).version }, x);
    if (r._validationError) return { estado: 'INCIDENCIA', incidencia: 'Ficha: ' + r.message };
    if (o['CANAL DE CAPTACION']) Cat.asegurar_('CANAL', o['CANAL DE CAPTACION'], null, x.nombre);
    if (o.VENDEDOR) Cat.asegurar_('VENDEDOR', o.VENDEDOR, null, x.nombre);
    const destino = ['ficha de ' + cli.nombre];
    if (o['SERVICIO CONTRATADO']) {
      const s = Cl.guardarServicio_(db, { cliente_id: cli.id, servicio: o['SERVICIO CONTRATADO'], modalidad: 'MENSUAL', monto_neto: o['MONTO MENSUAL NETO'], dia_facturacion: o['DIA FACTURACION'],
        empresa: o['EMPRESA FACTURADORA'], origen: { lote, fila: f.fila } }, x, { clave_origen: 'mig|cli|' + cli.id + '|' + N(o['SERVICIO CONTRATADO']) });
      if (s._validationError) obs.push('Servicio: ' + s.message); else destino.push('servicio ' + o['SERVICIO CONTRATADO']);
    }
    if (o['PROYECTO ASIGNADO']) {
      const pid = proyectoDe_(db, o['PROYECTO ASIGNADO']);
      if (!pid) obs.push('Proyecto «' + o['PROYECTO ASIGNADO'] + '» no identificado (publica primero la hoja PROYECTOS o créalo).');
      else {
        const a = Cl.guardarAsignacion_(db, { cliente_id: cli.id, proyecto_id: pid, porcentaje: o['ASIGNACION'] !== undefined ? o['ASIGNACION'] : o['% ASIGNACION'] }, x, { clave_origen: 'mig|asig|' + cli.id + '|' + pid });
        if (a._validationError) obs.push('Asignación: ' + a.message); else destino.push('proyecto ' + o['PROYECTO ASIGNADO']);
      }
    }
    return { estado: obs.length ? 'PARCIAL' : 'PUBLICADA', destino: destino.join(' · '), incidencia: obs.join(' '), ref: 'cliente:' + cli.id };
  });
};
function proyectoDe_(db, texto) {
  const n = N(texto);
  const leg = require('./finanzasPlanificacion').proyectosLegado_().find((p) => N(p.codigo) === n || N(p.nombre) === n);
  if (leg) return leg.id;
  const sig = FB.proyectosSigso_(db).find((p) => N(p.codigo) === n || N(p.nombre) === n);
  return sig ? sig.id : '';
}

// FACTURAS: todo el bloque por el importador de la planilla (huella por empresa+tipo+folio).
MAPEADORES.FACTURAS = function (db, filas, cab, x, ctx, lote, nombreArchivo) {
  const C = require('./finanzasCobranza');
  const r = C.importarFacturasPlanilla_(db, [cab].concat(filas.map((f) => f.valores)), x, nombreArchivo);
  if (r._validationError) return filas.map(() => ({ estado: 'INCIDENCIA', incidencia: r.message }));
  return filas.map((f) => {
    const o = porTitulo_(cab, f.valores);
    const folio = String(o['N FACTURA'] || '').replace(/\.0+$/, '');
    if (!/^\d+$/.test(folio)) return { estado: 'INCIDENCIA', incidencia: 'Sin número de factura válido.' };
    if (/anulad/i.test(o.ESTADO || '')) return { estado: 'HISTORICA', destino: 'Anulada en la planilla: no se carga' };
    const emp = Cat.empresa_(o['EMPRESA EMISORA'] || 'HomePymes');
    if (!emp) return { estado: 'INCIDENCIA', incidencia: 'Empresa emisora «' + o['EMPRESA EMISORA'] + '» no reconocida.' };
    const rech = (r.rechazadas || []).find((y) => y.folio === folio);
    if (rech) return { estado: 'INCIDENCIA', incidencia: rech.motivo };
    const cli = clienteDe_(db, ctx, { 'ID CLIENTE': o['ID CLIENTE'], CLIENTE: o.CLIENTE });
    return { estado: cli ? 'PUBLICADA' : 'PARCIAL', destino: 'Factura ' + emp + ' N° ' + folio + (o.ESTADO ? ' (estado en la planilla: ' + o.ESTADO + ', no se toma como pago)' : ''), incidencia: cli ? '' : 'Cliente no identificado: la factura queda sin cliente hasta corregirlo.' };
  });
};

/** Busca el abono del banco (o registro) de un cliente: mismo monto, ±5 días, todavía con saldo sin aplicar. Único. */
function abonoDe_(db, cli, monto, fecha, empresa) {
  const C = require('./finanzasCobranza');
  const usados = new Map();
  C.aplicaciones_().forEach((a) => usados.set(a.recepcion_ref, (usados.get(a.recepcion_ref) || 0) + a.monto));
  const cand = C.recepciones_({ cliente_id: cli.id }).filter((r) => r.monto === monto && (!empresa || r.empresa === empresa) && fecha && Math.abs(Date.parse(r.fecha) - Date.parse(fecha)) <= 5 * 864e5);
  if (cand.length > 1) return { error: 'Hay ' + cand.length + ' abonos iguales de ese cliente en esas fechas: aplícalo a mano.' };
  return cand.length ? { rec: cand[0], libre: cand[0].monto - (usados.get(cand[0].ref) || 0) } : { error: 'No está el abono en el banco (¿efectivo, otra cuenta sin cartola, o todavía sin clasificar como ingreso con su cliente?). Regístralo y vuelve a publicar.' };
}
/** Aplica un abono a los folios indicados, en orden, hasta donde alcance (solo facturas del cliente y la empresa). */
function aplicarFolios_(db, rec, libre, folios, empresa, x, clave) {
  const C = require('./finanzasCobranza');
  const n = C.cartera_(db).get(rec.cliente_id);
  const facturas = (n ? n.facturas : []).filter((f) => folios.indexOf(String(f.folio)) !== -1 && (!empresa || f.empresa === empresa));
  const faltan = folios.filter((fo) => !facturas.some((f) => String(f.folio) === fo));
  if (faltan.length) return { error: 'Factura(s) N° ' + faltan.join(', ') + ' no existen en Finanzas para este cliente: «Facturado» en la planilla no prueba el pago de una factura que no está.' };
  const apl = [];
  let resto = libre;
  facturas.forEach((f) => { const m = Math.min(resto, f.saldo_confirmado); if (m > 0) { apl.push({ factura_id: f.id, monto: m }); resto -= m; } });
  if (!apl.length) return { ok: true, nada: true };
  const r = C.aplicar_(db, { recepcion_ref: rec.ref, aplicaciones: apl, fecha_aplicacion: Base.hoy_() }, x, { clave_origen: clave, origen: 'migración' });
  if (r._validationError) return { error: r.message };
  return { ok: true, aplicado: r.aplicado || 0, repetida: !!r.repetida };
}
function folios_(t) { return String(t || '').split(/[^0-9.]+/).map((s) => s.replace(/\.0+$/, '')).filter((s) => /^\d+$/.test(s)); }

// PAGOS (SIGECO): aplicar a facturas solo si el abono está en el banco. Fecha real del pago = la del abono.
MAPEADORES.PAGOS = function (db, filas, cab, x, ctx) {
  return filas.map((f) => {
    const o = porTitulo_(cab, f.valores);
    const cli = clienteDe_(db, ctx, o);
    if (!cli) return { estado: 'INCIDENCIA', incidencia: 'Cliente no identificado.' };
    const m = monto_(o['MONTO PAGADO']);
    if (!m.ok || !(m.valor > 0)) return { estado: 'INCIDENCIA', incidencia: 'Monto no válido.' };
    const ab = abonoDe_(db, cli, m.valor, fecha_(o['FECHA PAGO']), '');
    if (ab.error) return { estado: 'INCIDENCIA', incidencia: ab.error };
    const folios = folios_(o['N FACTURA S']);
    const r = aplicarFolios_(db, ab.rec, Math.min(ab.libre, m.valor), folios, '', x, 'mig|pago|' + ab.rec.ref + '|' + folios.join('-'));
    if (r.error) return { estado: 'INCIDENCIA', incidencia: r.error };
    return { estado: 'PUBLICADA', destino: 'Abono ' + ab.rec.ref + ' → factura(s) ' + folios.join(', ') + (r.nada ? ' (ya estaba aplicado)' : ''), ref: ab.rec.ref };
  });
};

// HISTORIAL ABONOS: el abono existe en el banco; si dice «Facturado», se aplica a sus facturas.
MAPEADORES['HISTORIAL ABONOS'] = function (db, filas, cab, x, ctx) {
  return filas.map((f) => {
    const o = porTitulo_(cab, f.valores);
    const cli = clienteDe_(db, ctx, o);
    if (!cli) return { estado: 'INCIDENCIA', incidencia: 'Cliente no identificado.' };
    const m = monto_(o['MONTO ABONO']);
    if (!m.ok || !(m.valor > 0)) return { estado: 'INCIDENCIA', incidencia: 'Monto no válido.' };
    const emp = Cat.empresa_(o.EMPRESA);
    const ab = abonoDe_(db, cli, m.valor, fecha_(o.FECHA), emp);
    if (ab.error) return { estado: 'INCIDENCIA', incidencia: ab.error };
    const folios = folios_(o['N FACTURA AL FACTURAR']);
    if (/facturad/i.test(o.ESTADO || '') && folios.length) {
      const r = aplicarFolios_(db, ab.rec, ab.libre, folios, emp, x, 'mig|pago|' + ab.rec.ref + '|' + folios.join('-'));
      if (r.error) return { estado: 'INCIDENCIA', incidencia: r.error, ref: ab.rec.ref };
      return { estado: 'PUBLICADA', destino: 'Abono ' + ab.rec.ref + ' aplicado a ' + folios.join(', '), ref: ab.rec.ref };
    }
    return { estado: 'PUBLICADA', destino: 'Abono ' + ab.rec.ref + ' sin aplicar (estado en la planilla: ' + (o.ESTADO || '—') + ')', ref: ab.rec.ref };
  });
};

/** Busca el movimiento del banco de una fila de planilla: empresa, monto y sentido, ±3 días. Único y no usado. */
function movimientoDe_(empresa, abono, cargo, fecha, usados, banco, preferido) {
  const cuentas = I.cuentasMapa_();
  const d = I.db_();
  if (!fecha) return null;
  const filas = d.prepare('SELECT id, cuenta_ref, fecha, datos FROM FIN_MOVIMIENTOS WHERE fecha BETWEEN ? AND ?').all(Base.sumarDias_(fecha, -3), Base.sumarDias_(fecha, 3))
    .filter((r) => !usados.has(r.id) && (cuentas.get(r.cuenta_ref) || {}).empresa === empresa && (!banco || N((cuentas.get(r.cuenta_ref) || {}).banco) === N(banco)))
    .map((r) => Object.assign(r, { d: I.des_(r.datos) })).filter((r) => (abono ? r.d.abono === abono : r.d.cargo === cargo))
    // I13 (ELOHIM real): con dos movimientos del mismo monto a igual distancia, primero el que ya cumple lo pedido.
    .sort((a, b) => (preferido ? (preferido(a) ? 0 : 1) - (preferido(b) ? 0 : 1) : 0) || Math.abs(Date.parse(a.fecha) - Date.parse(fecha)) - Math.abs(Date.parse(b.fecha) - Date.parse(fecha)));
  return filas[0] || null;
}

// MOVIMIENTOS (SIGECO): son copias del banco: se guardan como evidencia en su movimiento, no se cuentan de nuevo.
MAPEADORES.MOVIMIENTOS = function (db, filas, cab, x, ctx, lote) {
  const usados = new Set();
  return filas.map((f) => {
    const o = porTitulo_(cab, f.valores);
    const emp = Cat.empresa_(o.EMPRESA);
    if (!emp) return { estado: 'INCIDENCIA', incidencia: 'Empresa «' + (o.EMPRESA || '') + '» no reconocida.' };
    const fecha = fecha_(o.FECHA);
    const mesOriginal = o['MES AAAA MM'] || '';
    const periodo = Base.periodo_(mesOriginal);
    const m = monto_(o.MONTO);
    if (!m.ok || !m.valor) return { estado: 'INCIDENCIA', incidencia: 'Monto no válido.' };
    const egreso = /^EGRESO|^GASTO/.test(N(o.TIPO));
    const mov = movimientoDe_(emp, egreso ? 0 : Math.abs(m.valor), egreso ? Math.abs(m.valor) : 0, fecha, usados);
    const nota = periodo && fecha && periodo !== fecha.slice(0, 7) ? ' El MES de la planilla (' + periodo + ') no coincide con la fecha: confirmar.' : '';
    if (!mov) return { estado: 'INCIDENCIA', incidencia: 'Sin movimiento del banco que calce (¿efectivo, otra cuenta sin cartola?).' + nota, normalizado: { fecha, periodo, mes_original: mesOriginal } };
    usados.add(mov.id);
    mov.d.sigeco = { tipo: o.TIPO, cuenta: o.CUENTA, detalle: o.DETALLE, cliente: o['CLIENTE SI APLICA'], proyecto: o['PROYECTO SI APLICA'], obs: o.OBSERVACIONES, mes: mesOriginal, lote, fila: f.fila };
    I.db_().prepare('UPDATE FIN_MOVIMIENTOS SET datos = ? WHERE id = ?').run(I.cif_(mov.d), mov.id);
    return { estado: nota ? 'PARCIAL' : 'PUBLICADA', destino: 'Evidencia en el movimiento ' + mov.fecha + ' (mov:' + mov.id + ')', incidencia: nota.trim(), ref: 'mov:' + mov.id, normalizado: { fecha, periodo, mes_original: mesOriginal } };
  });
};

// CUENTA BANCARIA (SIGECO): el aprendizaje de siempre (sugerencias, nunca confirma).
MAPEADORES['CUENTA BANCARIA'] = function (db, filas, cab, x, ctx, lote, nombre, data, contexto) {
  const r = FB.aprenderPlanilla(db, Object.assign({}, data, { filas: [cab].concat(filas.map((f) => f.valores)) }), contexto);
  if (r._validationError) return filas.map(() => ({ estado: 'INCIDENCIA', incidencia: r.message }));
  return filas.map(() => ({ estado: 'PUBLICADA', destino: 'Aprendizaje de sugerencias (' + r.emparejados + ' movimientos emparejados, ' + r.reglas + ' reglas)' }));
};

// GASTOS COMPARTIDOS: el registro del gasto con su reparto (montos de cada empresa, o la regla). PAZ queda pendiente.
MAPEADORES['GASTOS COMPARTIDOS'] = function (db, filas, cab, x, ctx, lote) {
  const Pl = require('./finanzasPlanificacion');
  return filas.map((f) => {
    const o = porTitulo_(cab, f.valores);
    const total = monto_(o['MONTO TOTAL']);
    if (!total.ok || !total.valor) return { estado: 'INCIDENCIA', incidencia: 'Monto total no válido.' };
    const cols = [['GDE', 'GDE'], ['HOMEPYMES', 'HomePymes'], ['HOMEPREVISE', 'HomePrevise'], ['RLD', 'RLD'], ['VIRTUAL BASE', 'Virtual Base']];
    const partes = cols.map(([k, e]) => ({ empresa: e, valor: monto_(o[k]) })).filter((p) => p.valor.ok && p.valor.valor);
    const paz = monto_(o.PAZ);
    const pazInfo = paz.ok && paz.valor ? { valor: paz.valor, pendiente: true, nota: 'Columna PAZ: destinatario por identificar (no se crea una empresa).' } : null;
    const regla = N(o.REGLA);
    const reparto = partes.length >= 2 && !/IGUALES/.test(regla) ? { modo: 'FIJO', partes: partes.map((p) => ({ empresa: p.empresa, valor: p.valor.valor })) } : { modo: 'IGUALES', partes: (partes.length >= 2 ? partes : cols.slice(0, 4).map(([, e]) => ({ empresa: e }))).map((p) => ({ empresa: p.empresa })) };
    if (pazInfo && reparto.modo === 'FIJO') return { estado: 'INCIDENCIA', incidencia: 'Tiene un monto en PAZ (' + Base.plata_(paz.valor) + '): hay que identificar a quién corresponde antes de repartir.' };
    const r = Pl.guardarGasto_(db, { periodo: o['MES AAAA MM'], concepto: o.CONCEPTO, pagadora: o['EMPRESA PAGADORA'], monto: total.valor, reparto, obs: o.OBSERVACIONES, paz: pazInfo, origen: { lote, fila: f.fila } }, x, { clave_origen: 'mig|gc|' + lote + '|' + f.fila });
    if (r._validationError) return { estado: 'INCIDENCIA', incidencia: r.message };
    return { estado: pazInfo ? 'PARCIAL' : 'PUBLICADA', destino: 'Gasto compartido ' + (o.CONCEPTO || '') + ' (falta vincularlo a su pago)', incidencia: pazInfo ? pazInfo.nota : '', ref: 'gasto:' + r.id };
  });
};
MAPEADORES['PRESTAMOS INTERCO'] = function (db, filas, cab, x, ctx, lote) {
  const Pl = require('./finanzasPlanificacion');
  return filas.map((f) => {
    const o = porTitulo_(cab, f.valores);
    const r = Pl.guardarPrestamo_(db, { origen: o.ORIGEN, destino: o.DESTINO, monto: o.MONTO !== undefined && Base.montoExcel_(o.MONTO) !== null ? Base.montoExcel_(o.MONTO) : o.MONTO, fecha: fecha_(o.FECHA), concepto: o.CONCEPTO,
      fecha_devolucion: fecha_(o['FECHA DEVOLUCION']), obs: o.OBS || o.OBSERVACIONES, estado_legado: o.ESTADO, origen_dato: { lote, fila: f.fila } }, x, { clave_origen: 'mig|pr|' + lote + '|' + f.fila });
    if (r._validationError) return { estado: 'INCIDENCIA', incidencia: r.message };
    return { estado: 'PUBLICADA', destino: 'Préstamo ' + o.ORIGEN + ' → ' + o.DESTINO + ' (vincular sus movimientos)', ref: 'prestamo:' + r.id };
  });
};
MAPEADORES.PROYECTOS = function (db, filas, cab, x, ctx, lote) {
  const Pl = require('./finanzasPlanificacion');
  return filas.map((f) => {
    const o = porTitulo_(cab, f.valores);
    const sig = FB.proyectosSigso_(db).find((p) => N(p.nombre) === N(o.PROYECTO));
    const r = Pl.guardarProyectoLegado_(db, { codigo: o.ID, nombre: o.PROYECTO, tipo: o.TIPO, empresa: o['EMPRESA PATROCINADORA'], inversion_presupuestada: o['INVERSION PRESUPUESTADA'], fecha_inicio: fecha_(o['FECHA INICIO']),
      estado: o.ESTADO, obs: o.OBSERVACIONES, sigso_id: sig ? sig.id : '', origen: { lote, fila: f.fila } }, x, { clave_origen: 'mig|py|' + N(o.ID) });
    if (r._validationError) return { estado: 'INCIDENCIA', incidencia: r.message };
    if (o.TIPO) Cat.asegurar_('TIPO_PROYECTO', o.TIPO, null, x.nombre);
    const ejemplo = /EJEMPLO/i.test(o.OBSERVACIONES || '');
    return { estado: ejemplo ? 'PARCIAL' : 'PUBLICADA', destino: 'Proyecto ' + o.ID + ' ' + o.PROYECTO + (sig ? ' (ligado al de SIGSO)' : ''), incidencia: ejemplo ? 'La planilla dice que es un EJEMPLO: revisa si corresponde dejarlo.' : '', ref: 'proyecto:' + (sig ? sig.id : 'leg:' + o.ID) };
  });
};
// PRESUPUESTO: un BORRADOR por año y empresa. Valores uniformes o en texto se marcan para revisar antes de aprobar.
MAPEADORES.PRESUPUESTO = function (db, filas, cab, x, ctx, lote) {
  const P = require('./finanzasPresupuesto');
  const MES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const grupos = new Map(), resultado = new Map();
  filas.forEach((f) => {
    const o = porTitulo_(cab, f.valores);
    const anio = Number(String(o.ANO || '').replace(/\.0+$/, ''));
    const emp = Cat.empresa_(o.EMPRESA);
    const tipo = /^INGRESO/.test(N(o.TIPO)) ? 'INGRESO' : /^EGRESO|^GASTO/.test(N(o.TIPO)) ? 'EGRESO' : '';
    const cuenta = FB.cuentasDe_(tipo).find((c) => N(c) === N(o.CUENTA));
    if (!anio || !emp || !tipo || !cuenta) { resultado.set(f.id, { estado: 'INCIDENCIA', incidencia: !emp ? 'Empresa no reconocida.' : !tipo ? 'Tipo no reconocido.' : !cuenta ? 'Concepto «' + o.CUENTA + '» no está en el plan de cuentas.' : 'Año no válido.' }); return; }
    const meses = [], malos = [];
    MES.forEach((m) => { const v = monto_(o[m]); if (!v.ok) malos.push(m.toLowerCase() + ' (' + o[m] + ')'); meses.push(v.ok ? v.valor : 0); });
    if (malos.length) { resultado.set(f.id, { estado: 'INCIDENCIA', incidencia: 'Montos que no se entienden: ' + malos.join(', ') + '. No se convierten en cero.' }); return; }
    const k = anio + '|' + emp;
    if (!grupos.has(k)) grupos.set(k, { anio, empresa: emp, lineas: [], filas: [] });
    grupos.get(k).lineas.push({ tipo, cuenta, meses }); grupos.get(k).filas.push(f.id);
  });
  grupos.forEach((g) => {
    const valores = g.lineas.flatMap((l) => l.meses);
    const distintos = new Set(valores.filter((v) => v)).size;
    const uniforme = valores.length >= 24 && distintos <= 1;
    const r = P.guardar_(db, { anio: g.anio, empresa: g.empresa, base: 'CASH_GROSS', lineas: g.lineas, nota: 'Desde la planilla SIGECO' }, x,
      { interno: true, origen: { lote }, requiere_validacion: uniforme ? 'Todas las celdas tienen el mismo valor (' + Base.plata_([...new Set(valores.filter((v) => v))][0] || 0) + '): parece un valor de relleno, no un presupuesto.' : '' });
    g.filas.forEach((id) => resultado.set(id, r._validationError ? { estado: 'INCIDENCIA', incidencia: r.message } : { estado: uniforme ? 'PARCIAL' : 'PUBLICADA', destino: 'Presupuesto ' + g.anio + ' ' + g.empresa + ' (borrador v' + r.version + ', falta aprobar)', incidencia: uniforme ? 'Valores uniformes: revisar antes de aprobar.' : '' }));
  });
  return filas.map((f) => resultado.get(f.id) || { estado: 'INCIDENCIA', incidencia: 'Sin datos.' });
};
// MEJORAS: historial de pedidos, cada uno con la funcionalidad que lo atiende (anexo A.4).
MAPEADORES.MEJORAS = function (db, filas, cab, x) {
  const RESPUESTA = [[/CUENTA BANCARIA.*EMPRESA|INGRESOS Y EGRESOS/, 'Registro diario con contexto de empresa y cuenta (Trabajo diario › Registro)'], [/HISTORIAL DE ABONO/, 'Ficha del cliente: abonos y aplicaciones (Clientes)'],
    [/EMPRESA PERTENECE EL ABONO|A QUE EMPRESA/, 'Empresa obligatoria (o heredada del contexto) en cada abono'], [/LISTADO DE (LOS )?CLIENTES/, 'Búsqueda de clientes por RUT, nombre o alias en el registro'],
    [/NOTA DE VENTA|CONTRATO/, 'Documentos comerciales del cliente (nota de venta, contrato, factura)']];
  const lista = [];
  const res = filas.map((f) => {
    const o = porTitulo_(cab, f.valores);
    const idea = N(o['IDEA MEJORA PROPUESTA']);
    const r = RESPUESTA.find(([re]) => re.test(idea));
    lista.push({ fecha: fecha_(o.FECHA), quien: o.QUIEN, hoja: o.HOJA, idea: o['IDEA MEJORA PROPUESTA'], estado: o.ESTADO, comentario: o.COMENTARIO, funcionalidad: r ? r[1] : '' });
    return r ? { estado: 'PUBLICADA', destino: r[1] } : { estado: 'PARCIAL', destino: 'Historial de mejoras', incidencia: 'Sin funcionalidad asociada todavía.' };
  });
  const d = db_();
  const prev = (() => { const r = d.prepare("SELECT datos FROM FIN_AJUSTES WHERE clave = 'mejoras'").get(); return r ? I.des_(r.datos) : []; })();
  const claves = new Set(prev.map((m) => m.fecha + '|' + m.idea));
  const todas = prev.concat(lista.filter((m) => !claves.has(m.fecha + '|' + m.idea)));
  d.prepare("INSERT INTO FIN_AJUSTES (clave, datos, actualizado_en, actualizado_por) VALUES ('mejoras', ?, ?, ?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por")
    .run(I.cif_(todas), Base.ahora_(), x.nombre);
  return res;
};

// ---------------------------------------------------------------- BANCOS

/** Grupos de la columna UNITARIO: «=+C27+C71+C72+C73» une la recepción de la fila 27 con los pagos de 71, 72 y 73. */
function gruposUnitario_(filas, cab, todasFilas) {
  const iU = cab.findIndex((t) => N(t) === 'UNITARIO'), iT = cab.findIndex((t) => N(t) === 'TOTAL');
  if (iU === -1 || iT === -1) return [];
  const letra = String.fromCharCode(65 + iT);
  const porFila = new Map(todasFilas.map((f) => [f.fila, f]));
  const re = new RegExp('\\$?' + letra + '\\$?(\\d+)', 'g');
  const grupos = [];
  filas.forEach((f) => {
    const fx = (f.formulas || [])[iU];
    if (!fx) return;
    const refs = []; let m;
    while ((m = re.exec(fx))) refs.push(Number(m[1]));
    if (refs.length < 2 && refs.indexOf(f.fila) !== -1) return; // =+C210: la fila consigo misma no es un grupo
    if (!refs.length) return;
    const miembros = [...new Set(refs.concat([f.fila]))].sort((a, b) => a - b).map((n) => porFila.get(n)).filter(Boolean);
    grupos.push({ fila_formula: f.fila, formula: fx, remanente_planilla: Base.montoExcel_(f.valores[iU]), miembros: miembros.map((x) => x.fila) });
  });
  return grupos;
}

MAPEADORES.BANCOS_BCI = function (db, filas, cab, x, ctx, lote, nombre, data, contexto, hoja) {
  const cuenta = Base.txt_(data.cuenta_ref);
  if (!cuenta || !I.cuentasMapa_().get(cuenta)) return filas.map(() => ({ estado: 'INCIDENCIA', incidencia: 'Elige a qué cuenta del banco corresponde esta hoja y vuelve a publicar.' }));
  const P = require('./finanzasPagadores');
  const r = P.aprenderExcelBancos(db, Object.assign({}, data, { filas: [cab].concat(filas.map((f) => f.valores)), cuenta }), contexto);
  if (r._validationError) return filas.map(() => ({ estado: 'INCIDENCIA', incidencia: r.message }));
  // Grupos de fondos candidatos (UNITARIO), con las filas, la fórmula y el remanente que calculaba la planilla.
  const todas = filasHoja_(lote, hoja);
  // Los grupos se arman con TODA la hoja: publicar un subconjunto de filas no debe borrar los demás grupos.
  const grupos = gruposUnitario_(todas, cab, todas).map((g) => {
    const iT = cab.findIndex((t) => N(t) === 'TOTAL'), iF = cab.findIndex((t) => N(t) === 'FECHA'), iD = cab.findIndex((t) => N(t) === 'DETALLE'), iP = cab.findIndex((t) => N(t) === 'PLAN DE CUENTA'), iO = cab.findIndex((t) => N(t) === 'OBS');
    const miembros = g.miembros.map((n) => todas.find((t) => t.fila === n)).filter(Boolean).map((t) => ({ fila: t.fila, monto: Base.montoExcel_(t.valores[iT]), fecha: fecha_(t.valores[iF]), alias: t.valores[iD], plan: t.valores[iP], obs: t.valores[iO] }));
    return Object.assign(g, { alias: (miembros.find((mm) => mm.monto > 0) || miembros[0] || {}).alias || '', miembros, suma: miembros.reduce((s, mm) => s + (mm.monto || 0), 0) });
  });
  const d = db_();
  d.prepare('INSERT INTO FIN_AJUSTES (clave, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
    .run('candidatas|' + lote, I.cif_({ cuenta, grupos }), Base.ahora_(), x.nombre);
  const enGrupo = new Set(grupos.flatMap((g) => g.miembros.map((mm) => mm.fila)));
  return filas.map((f) => ({ estado: 'PUBLICADA', destino: 'Sugerencia sobre la cartola' + (enGrupo.has(f.fila) ? ' · parte de un grupo de fondos candidato (UNITARIO)' : '') }));
};
MAPEADORES.BANCOS_SANTANDER = function (db, filas, cab, x, ctx, lote, nombre, data, contexto, hoja) {
  const Op = require('./finanzasOperaciones');
  const empresa = /^HC/.test(N(hoja)) ? 'Homeconsulting' : 'HomePymes';
  const ctxN = FB.contextoNormalizar_(db);
  return filas.map((f) => {
    const o = porTitulo_(cab, f.valores);
    const m = monto_(o.TOTAL);
    const fecha = fecha_(o.FECHA);
    if (!m.ok || !m.valor || !fecha) return { estado: 'INCIDENCIA', incidencia: !fecha ? 'Sin fecha válida.' : 'Monto no válido.' };
    const huella = (db_().prepare('SELECT huella FROM FIN_FUENTE_FILAS WHERE id = ?').get(f.id) || {}).huella;
    void Op;
    const r = Base.transaccion_(() => guardarBorrador_(db, { empresa, fecha, sentido: m.valor > 0 ? 'ENTRADA' : 'SALIDA', monto: Math.abs(m.valor), medio: 'TRANSFERENCIA',
      tercero: o.DETALLE, nota: [o['PLAN DE CUENTA'], o.OBSERVACION, o.OBS].filter(Boolean).join(' · '), origen: { tipo: 'BANCOS', lote, hoja, fila: f.fila, valores: f.valores } }, contexto, x, ctxN, 'mig|santander|' + huella));
    if (!r || r._validationError) return { estado: 'INCIDENCIA', incidencia: (r && r.message) || 'No se pudo registrar.' };
    return { estado: r.repetida ? 'REPETIDA' : 'PUBLICADA', destino: r.repetida ? 'Ya estaba en el registro (otro libro)' : 'Borrador en el registro (Santander, sin cartola)', ref: r.id ? 'op:' + r.id : '' };
  });
};
function guardarBorrador_(db, datos, contexto, x, ctxN, clave) {
  const Op = require('./finanzasOperaciones');
  return Op.guardarInterno_(db, Object.assign({ confirmar: false }, datos), contexto, x, ctxN, { fuente: 'MIGRACION', clave_origen: clave });
}

/** Mapeador para una hoja de un libro. */
function mapeador_(tipo, hoja) {
  const n = N(hoja);
  if (tipo === 'BANCOS') return /BCI/.test(n) ? MAPEADORES.BANCOS_BCI : /SANTANDER/.test(n) ? MAPEADORES.BANCOS_SANTANDER : null;
  if (/^FLUJO/.test(n) || n === 'RESUMEN AUTO') return null;
  return MAPEADORES[n] || null;
}

/**
 * Publica una hoja (o las filas elegidas). data: { lote_id, hoja, filas?: [números], cuenta_ref? (BANCOS BCI) }
 * Cada fila queda con su estado y «dónde quedó»; volver a publicar no duplica.
 */
const publicar = Base.conCapacidad('MIGRAR', '', function (db, data, contexto, x) {
  const l = lote_(Base.txt_(data && data.lote_id));
  if (!l) return errorValidacion('lote_id', 'Esa carga no existe.');
  const hoja = l.hojas.find((h) => h.nombre === Base.txt_(data.hoja));
  if (!hoja) return errorValidacion('hoja', 'Esa hoja no está en la carga.');
  const elegidas = Array.isArray(data.filas) && data.filas.length ? new Set(data.filas.map(Number)) : null;
  const filas = filasHoja_(l.id, hoja.nombre).filter((f) => (!elegidas || elegidas.has(f.fila)) && ['PENDIENTE', 'INCIDENCIA', 'PARCIAL'].indexOf(f.estado) !== -1 &&
    !(f.estado === 'PARCIAL' && !elegidas))
    // I07.2: lo corregido en SIGSO se superpone a la fila original (que se conserva intacta).
    .map((f) => (f.correcciones ? Object.assign({}, f, { valores: f.valores.map((v, i) => (f.correcciones[i] !== undefined ? f.correcciones[i] : v)) }) : f));
  // I13 (QA-R16): volver a publicar una hoja ya resuelta no hace nada (antes vaciaba los grupos candidatos de BANCOS).
  if (!filas.length) return { hoja: hoja.nombre, filas: 0, resultado: {}, dependencias_pendientes: [], aviso: '' };
  const m = mapeador_(l.tipo, hoja.nombre);
  const ctx = contextoPub_(db);
  let res;
  if (!m) res = filas.map(() => ({ estado: 'HISTORICA', destino: destinoHoja_(l.tipo, hoja.nombre) }));
  else res = m(db, filas, hoja.columnas, x, ctx, l.id, l.nombre, data, contexto, hoja.nombre);
  const cuenta = {};
  filas.forEach((f, i) => {
    const r = res[i] || { estado: 'INCIDENCIA', incidencia: 'Sin resultado.' };
    marcar_(f.id, r.estado, r.destino || '', { incidencia: r.incidencia || '', ref: r.ref || '', normalizado: r.normalizado || null, regla: 'SIGSO v2 · ' + hoja.nombre }, x);
    cuenta[r.estado] = (cuenta[r.estado] || 0) + 1;
  });
  const d = db_();
  const pubs = (l.publicaciones || []).concat([{ hoja: hoja.nombre, en: Base.ahora_(), por: x.nombre, resultado: cuenta }]).slice(-100);
  const datosLote = Base.des_(d.prepare('SELECT datos FROM FIN_FUENTES WHERE id = ?').get(l.id).datos);
  datosLote.publicaciones = pubs;
  d.prepare("UPDATE FIN_FUENTES SET estado = 'PUBLICADO_PARCIAL', datos = ?, actualizado_en = ? WHERE id = ?").run(Base.cif_(datosLote), Base.ahora_(), l.id);
  x.registrar('MIGRAR_HOJA', l.tipo + ' · ' + hoja.nombre + ': ' + Object.keys(cuenta).map((k) => k + ' ' + cuenta[k]).join(', '));
  // I07.4: orden por dependencias (identidades → documentos → operaciones → aplicaciones). Publicar antes no se
  // bloquea, pero se dice: sus relaciones quedarán como incidencia hasta publicar lo anterior y reintentar.
  const DEP = { CLIENTES: ['CATALOGOS'], FACTURAS: ['CLIENTES'], PAGOS: ['FACTURAS', 'CLIENTES'], 'HISTORIAL ABONOS': ['FACTURAS', 'CLIENTES'], MOVIMIENTOS: ['CATALOGOS', 'CLIENTES'],
    'CUENTA BANCARIA': ['CATALOGOS', 'CLIENTES'], 'GASTOS COMPARTIDOS': ['CATALOGOS'], 'PRESTAMOS INTERCO': ['CATALOGOS'], PRESUPUESTO: ['CATALOGOS'] };
  const pend = (DEP[N(hoja.nombre)] || []).map((n) => l.hojas.find((h) => N(h.nombre) === n)).filter(Boolean)
    .filter((h) => d.prepare("SELECT 1 FROM FIN_FUENTE_FILAS WHERE lote_id = ? AND hoja = ? AND estado = 'PENDIENTE' LIMIT 1").get(l.id, h.nombre)).map((h) => h.nombre);
  return { hoja: hoja.nombre, filas: filas.length, resultado: cuenta, dependencias_pendientes: pend,
    aviso: pend.length ? 'Antes conviene publicar ' + pend.join(' y ') + ': lo que dependa de ahí quedó como incidencia; publícalo y vuelve a publicar esta hoja.' : '' };
});

// ---------------------------------------------------------------- 3. revisar y corregir dentro de SIGSO (I07.2)

/**
 * Corrige celdas de una fila cargada (sin tocar el original) o la aparta / la
 * recupera. data: { lote_id, hoja, fila, cambios: { indiceColumna: valor }, accion: CORREGIR|APARTAR|RECUPERAR, motivo }
 * Una fila corregida vuelve a «Por publicar» (su vista previa anterior ya no vale).
 */
const corregirFila = Base.conCapacidad('MIGRAR', '', function (db, data, contexto, x) {
  const d = db_();
  const r = d.prepare('SELECT * FROM FIN_FUENTE_FILAS WHERE lote_id = ? AND hoja = ? AND fila = ?').get(Base.txt_(data && data.lote_id), Base.txt_(data.hoja), Number(data.fila));
  if (!r) return errorValidacion('fila', 'Esa fila no existe.');
  const accion = Base.txt_(data.accion).toUpperCase() || 'CORREGIR';
  const datos = Base.des_(r.datos);
  if (['PUBLICADA', 'REPETIDA', 'HISTORICA'].indexOf(r.estado) !== -1 && accion !== 'RECUPERAR') return errorValidacion('fila', 'Esa fila ya está ' + ESTADOS[r.estado].toLowerCase() + ': no se corrige aquí (se corrige el dato publicado en su pantalla).');
  const motivo = Base.txt_(data.motivo).slice(0, 300);
  datos.historial = (datos.historial || []).concat([{ en: Base.ahora_(), por: x.nombre, accion, motivo, cambios: data.cambios || null }]).slice(-30);
  let estado = r.estado;
  if (accion === 'APARTAR') {
    if (motivo.length < 3) return errorValidacion('motivo', 'Escribe por qué se aparta (queda recuperable).');
    datos.estado_previo = r.estado; estado = 'APARTADA';
  } else if (accion === 'RECUPERAR') {
    if (r.estado !== 'APARTADA') return errorValidacion('fila', 'Solo se recupera una fila apartada.');
    estado = datos.estado_previo || 'PENDIENTE';
  } else {
    const cambios = data.cambios || {};
    const cols = Object.keys(cambios).map(Number).filter((i) => i >= 0 && i < 200);
    if (!cols.length) return errorValidacion('cambios', 'No hay cambios.');
    datos.correcciones = Object.assign({}, datos.correcciones || {});
    cols.forEach((i) => { datos.correcciones[i] = Base.txt_(cambios[i]).slice(0, 300); });
    estado = 'PENDIENTE';
  }
  d.prepare('UPDATE FIN_FUENTE_FILAS SET estado = ?, datos = ?, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(estado, Base.cif_(datos), Base.ahora_(), x.nombre, r.id);
  x.registrar('CARGA_FILA_' + accion, r.hoja + ' fila ' + r.fila + (motivo ? ': ' + motivo.slice(0, 60) : ''));
  return { fila: r.fila, estado, correcciones: datos.correcciones || null };
});

// ---------------------------------------------------------------- 4. cuadro de control (I07.5)

// Columna de monto de una hoja, en orden de preferencia (TOTAL antes que NETO; el saldo no es un importe).
const COLS_MONTO_ = [/^TOTAL( |$)/, /^MONTO( |$)/, /^IMPORTE( |$)/, /^(ABONO|ABONOS|INGRESO)( |$)/, /^(CARGO|CARGOS|EGRESO)( |$)/, /^NETO( |$)/];
/**
 * Por hoja: filas leídas, publicadas, con observación, repetidas, históricas,
 * apartadas, incidentes y por publicar; motivos de incidencia agrupados; e
 * importes de la columna de monto (original) contra lo publicado. Compara
 * cantidades e importes, no solo «respondió bien».
 */
const cuadroControl = B.conBoveda('', function (db, data) {
  const l = lote_(Base.txt_(data && data.lote_id));
  if (!l) return errorValidacion('lote_id', 'Esa carga no existe.');
  const hojas = l.hojas.map((h) => {
    const filas = filasHoja_(l.id, h.nombre);
    let iMonto = -1;
    COLS_MONTO_.some((re) => { iMonto = (h.columnas || []).findIndex((c) => re.test(N(c))); return iMonto !== -1; });
    const cuenta = {}, importe = {}, motivos = {};
    let noLeibles = 0;
    filas.forEach((f) => {
      cuenta[f.estado] = (cuenta[f.estado] || 0) + 1;
      if (iMonto !== -1) {
        const m = monto_(f.valores[iMonto]);
        if (m.ok) importe[f.estado] = (importe[f.estado] || 0) + Math.abs(m.valor); else noLeibles++;
      }
      if (f.estado === 'INCIDENCIA' || f.estado === 'PARCIAL' || f.estado === 'APARTADA') {
        const k = String(f.incidencia || (f.historial || []).slice(-1).map((y) => y.motivo).join('') || 'Sin motivo').replace(/\d[\d.,]*/g, 'N').slice(0, 120);
        motivos[k] = (motivos[k] || 0) + 1;
      }
    });
    const leido = iMonto === -1 ? null : Object.keys(importe).reduce((t, k) => t + importe[k], 0);
    const explicado = iMonto === -1 ? null : Object.keys(importe).filter((k) => k !== 'PENDIENTE').reduce((t, k) => t + importe[k], 0);
    return { hoja: h.nombre, oculta: !!h.oculta, destino: destinoHoja_(l.tipo, h.nombre), leidas: filas.length, por_estado: cuenta,
      columna_monto: iMonto === -1 ? '' : h.columnas[iMonto], importe_por_estado: importe, importe_leido: leido, importe_sin_resolver: leido === null ? null : leido - explicado,
      plantilla: h.plantilla || 0, montos_no_leibles: noLeibles, motivos: Object.keys(motivos).map((k) => ({ motivo: k, filas: motivos[k] })).sort((a, b) => b.filas - a.filas).slice(0, 12) };
  });
  const tot = (k) => hojas.reduce((t, h) => t + (h.por_estado[k] || 0), 0);
  return { lote: { id: l.id, tipo: l.tipo, nombre: l.nombre, creado_en: l.creado_en, creado_por: l.creado_por }, hojas, estados: ESTADOS,
    totales: { leidas: hojas.reduce((t, h) => t + h.leidas, 0), publicadas: tot('PUBLICADA'), con_observacion: tot('PARCIAL'), repetidas: tot('REPETIDA'), historicas: tot('HISTORICA'), apartadas: tot('APARTADA'), incidencias: tot('INCIDENCIA'), por_publicar: tot('PENDIENTE') },
    publicaciones: l.publicaciones || [] };
});

/** Grupos de fondos candidatos de una carga de BANCOS (UNITARIO), con lo que la planilla calculaba. */
const candidatas = B.conBoveda('', function (db, data) {
  const r = db_().prepare('SELECT datos FROM FIN_AJUSTES WHERE clave = ?').get('candidatas|' + Base.txt_(data && data.lote_id));
  return r ? I.des_(r.datos) : { grupos: [] };
});

/**
 * Convierte un grupo candidato en una gestión de fondos: la persona dice el
 * cliente, la obligación y el período. Se asignan los movimientos de la
 * cartola que calzan con las filas del grupo y que ya estén confirmados como
 * fondos de ESE cliente; los demás quedan listados para revisar.
 */
const crearGestionDeCandidata = Base.conCapacidad('FONDOS', '', function (db, data, contexto, x) {
  const r = db_().prepare('SELECT datos FROM FIN_AJUSTES WHERE clave = ?').get('candidatas|' + Base.txt_(data && data.lote_id));
  if (!r) return errorValidacion('lote_id', 'Esa carga no tiene grupos candidatos.');
  const cand = I.des_(r.datos);
  const g = cand.grupos[Number(data.indice)];
  if (!g) return errorValidacion('indice', 'Ese grupo no existe.');
  const Fo = require('./finanzasFondos');
  const cuenta = I.cuentasMapa_().get(cand.cuenta);
  const gest = Fo.guardarGestion(db, Object.assign({}, data, { cliente_id: data.cliente_id, empresa: cuenta ? cuenta.empresa : data.empresa, obligacion: data.obligacion, periodo_obligacion: data.periodo_obligacion,
    destinos: g.miembros.filter((mm) => mm.monto < 0 && mm.plan).map((mm) => ({ nombre: mm.plan })), nota: 'Desde el Excel BANCOS (UNITARIO ' + g.formula + ')' }), contexto);
  if (gest._validationError || gest._forbidden) return gest;
  const usados = new Set();
  const asignar = [], revisar = [];
  g.miembros.forEach((mm) => {
    const esDelCliente = (r) => { const c = r.d.clasif; return (c && c.partes ? c.partes : c ? [c] : []).some((p) => (p.tipo === 'FONDO_RECIBIDO' || p.tipo === 'FONDO_PAGADO') && p.cliente_id === data.cliente_id); };
    const mov = movimientoDe_(cuenta ? cuenta.empresa : '', mm.monto > 0 ? mm.monto : 0, mm.monto < 0 ? -mm.monto : 0, mm.fecha, usados, '', esDelCliente);
    if (!mov) { revisar.push({ fila: mm.fila, motivo: 'Sin movimiento del banco que calce.' }); return; }
    usados.add(mov.id);
    const c = mov.d.clasif;
    const piezas = c && c.partes ? c.partes : c ? [c] : [];
    const i = piezas.findIndex((p) => (p.tipo === 'FONDO_RECIBIDO' || p.tipo === 'FONDO_PAGADO') && p.cliente_id === data.cliente_id);
    if (i === -1) { revisar.push({ fila: mm.fila, mov: mov.id, motivo: 'El movimiento no está confirmado como fondo de este cliente: clasifícalo y asígnalo a la gestión.' }); return; }
    asignar.push('mov:' + mov.id + ':' + i);
  });
  let asignadas = 0;
  if (asignar.length) { const a = Fo.asignarGestion(db, Object.assign({}, data, { refs: asignar, gestion_id: gest.id }), contexto); asignadas = a.hechos || 0; }
  const ficha = Fo.fichaCliente_(data.cliente_id, '');
  const saldo = (ficha.gestiones.find((y) => y.id === gest.id) || {}).saldo;
  x.registrar('GESTION_DESDE_PLANILLA', g.formula);
  return { gestion_id: gest.id, asignadas, revisar, saldo_sistema: saldo, remanente_planilla: g.remanente_planilla, diferencia: saldo !== undefined && g.remanente_planilla !== null ? saldo - g.remanente_planilla : null };
});

/** «Dónde quedó este dato»: una fila original con su destino, su regla y su estado. */
const dondeQuedo = B.conBoveda('', function (db, data) {
  const r = db_().prepare('SELECT * FROM FIN_FUENTE_FILAS WHERE lote_id = ? AND hoja = ? AND fila = ?').get(Base.txt_(data && data.lote_id), Base.txt_(data.hoja), Number(data.fila));
  if (!r) return errorValidacion('fila', 'Esa fila no existe.');
  const l = lote_(r.lote_id);
  const h = l.hojas.find((y) => y.nombre === r.hoja) || {};
  const d = Base.des_(r.datos);
  return { archivo: l.nombre, tipo: l.tipo, hoja: r.hoja, fila: r.fila, estado: r.estado, estado_nombre: ESTADOS[r.estado], destino: r.destino || '', columnas: h.columnas || [], valores: d.valores, formulas: d.formulas,
    incidencia: d.incidencia || '', regla: d.regla || '', ref: d.ref || '', normalizado: d.normalizado || null };
});

/** Historial de pedidos de mejora (hoja MEJORAS), cada uno con la funcionalidad que lo atiende. */
const mejoras = B.conBoveda('', function () {
  db_();
  const r = db_().prepare("SELECT datos FROM FIN_AJUSTES WHERE clave = 'mejoras'").get();
  return { mejoras: r ? I.des_(r.datos) : [] };
});

function reiniciar_() { preparada_ = null; }

module.exports = { corregirFila, cuadroControl, monto_, mejoras, cargar, fuentes, fuente, publicar, candidatas, crearGestionDeCandidata, dondeQuedo, tipoLibro_, encabezado_, gruposUnitario_, destinoHoja_, ESTADOS, reiniciar_ };
