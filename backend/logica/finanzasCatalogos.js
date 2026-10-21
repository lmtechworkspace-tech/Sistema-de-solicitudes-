'use strict';

/**
 * finanzasCatalogos.js — catálogos únicos de Finanzas (FIN-03, 2026-10-20).
 *
 * Antes la lista de empresas y el plan de cuentas estaban repetidos en el
 * servidor y en dos pantallas. Ahora viven en FIN_CATALOGO, con:
 *  - id estable (no cambia al renombrar), nombre visible y alias (otros
 *    nombres con que aparece: «HomePymes Antiguo», «AYS», razón social);
 *  - vigencia y activo: desactivar NO borra ni rompe la historia (lo que ya
 *    usó un concepto lo sigue mostrando); solo deja de ofrecerse;
 *  - semillas: los valores que ya usaba el sistema (sin datos de personas
 *    ni montos). Canales y vendedores se cargan desde la planilla SIGECO.
 *
 * Tipos: EMPRESA, CONCEPTO (grupo INGRESO | EGRESO | FONDO | PROVISION),
 * MEDIO (caja: si mueve dinero), ESTADO_FACTURA, REPARTO, TIPO_PROYECTO,
 * BANCO, CANAL, VENDEDOR, OBLIGACION (día de la operación, configurable;
 * no es un calendario legal) y PARAMETRO (valores del sistema: días de
 * vencimiento por defecto, umbrales de los comentarios automáticos).
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const { errorValidacion } = require('./errores');

const TIPOS = {
  EMPRESA: 'Empresas del grupo', CONCEPTO: 'Conceptos (plan de cuentas)', MEDIO: 'Medios de pago',
  ESTADO_FACTURA: 'Estados de factura', REPARTO: 'Reglas de reparto', TIPO_PROYECTO: 'Tipos de proyecto',
  BANCO: 'Bancos', CANAL: 'Canales de captación', VENDEDOR: 'Vendedores', OBLIGACION: 'Obligaciones del mes',
  PARAMETRO: 'Parámetros'
};

const c_ = (id, nombre, extra) => Object.assign({ id, nombre }, extra || {});
const SEMILLAS = {
  EMPRESA: [
    c_('HomePymes', 'HomePymes', { alias: ['HomePymes Antiguo', 'AYS', 'Asesorías Integrales AYS SpA', 'HOMEPYMES', 'ASESORIAS INTEGRALES AYS', 'AYS SPA'] }),
    c_('Homeconsulting', 'Homeconsulting', { alias: ['HOMECONSULTING', 'HOME CONSULTING', 'HC'] }),
    c_('HomePrevise', 'HomePrevise', { alias: ['HOMEPREVISE', 'HOME PREVISE'] }),
    c_('GDE', 'GDE', { alias: ['GDE '] }),
    c_('RLD', 'RLD', { alias: ['RLD '] }),
    c_('Virtual Base', 'Virtual Base', { alias: ['VIRTUALBASE', 'VIRTUAL BASE', 'VIRTUAL BAAS'] })
  ],
  CONCEPTO: [].concat(
    ['Servicio Mensual', 'Servicio Renta', 'Devolución Renta', 'Otros Ingresos'].map((n) => c_(n, n, { grupo: 'INGRESO' })),
    ['Arriendo Mensual', 'Arriendo Reajuste', 'Cuentas Básicas', 'Sueldos', 'Anticipos', 'Finiquitos', 'Imposiciones', 'Convenios', 'IVA',
      'IVA Postergado', 'Renta', 'Multas Clientes', 'Caja Chica', 'Patente Comercial', 'Comisión Banco', 'Servidores y Sistemas',
      'Gastos Compartidos (prorrateo)', 'Otros Egresos'].map((n) => c_(n, n, { grupo: 'EGRESO' })),
    ['Imposiciones', 'IVA', 'Sueldos', 'Convenios', 'Renta', 'Otro'].map((n) => c_('FONDO:' + n, n, { grupo: 'FONDO' })),
    ['Vacaciones', 'Años de Servicio'].map((n) => c_('PROV:' + n, n, { grupo: 'PROVISION' }))
  ),
  MEDIO: [
    c_('TRANSFERENCIA', 'Transferencia', { caja: true }), c_('EFECTIVO', 'Efectivo', { caja: true }), c_('CHEQUE', 'Cheque', { caja: true }),
    c_('TARJETA', 'Tarjeta', { caja: true }), c_('PAGO_LINEA', 'Pago en línea', { caja: true }), c_('DEPOSITO', 'Depósito', { caja: true }),
    c_('COMPENSACION', 'Compensación (no mueve dinero)', { caja: false })
  ],
  ESTADO_FACTURA: ['Emitida', 'Pagada', 'Pago parcial', 'Vencida', 'Anulada', 'Incobrable'].map((n) => c_(n, n)),
  REPARTO: [
    c_('sigeco', 'Partes iguales: GDE, HomePymes, HomePrevise y RLD', { modo: 'IGUALES', partes: [{ empresa: 'GDE' }, { empresa: 'HomePymes' }, { empresa: 'HomePrevise' }, { empresa: 'RLD' }] }),
    c_('todas', 'Partes iguales entre las 6 empresas', { modo: 'IGUALES', partes: ['HomePymes', 'Homeconsulting', 'HomePrevise', 'GDE', 'RLD', 'Virtual Base'].map((e) => ({ empresa: e })) })
  ],
  TIPO_PROYECTO: ['Certificación', 'Desarrollo', 'Adquisición', 'Apertura'].map((n) => c_(n, n)),
  BANCO: [c_('BCI', 'BCI'), c_('BancoEstado', 'BancoEstado', { alias: ['BANCO ESTADO'] }), c_('Santander', 'Santander')],
  CANAL: [], VENDEDOR: [],
  OBLIGACION: [
    c_('sueldos', 'Sueldos', { dia: 9, conceptos: ['Sueldos', 'Anticipos'] }),
    c_('imposiciones', 'Imposiciones', { dia: 10, conceptos: ['Imposiciones'] }),
    c_('iva', 'IVA (F29)', { dia: 20, conceptos: ['IVA', 'IVA Postergado'] })
  ],
  PARAMETRO: [
    c_('vencimiento_dias', 'Días de vencimiento de una factura sin fecha propia', { valor: 30 }),
    c_('lectura_mas_60', 'Cartera antigua: días de atraso que se destacan', { valor: 60 }),
    c_('aperturas_dos_personas', 'Saldos iniciales: 1 = quien propone no puede aprobar (dos personas); 0 = una persona puede (queda registrado)', { valor: 0 }),
    // I11.3: política de cierre (por defecto, la de siempre: se puede cerrar sin revisión y la misma persona).
    c_('cierre_exige_revision', 'Cierre: 1 = solo se cierra un mes enviado a revisión (y sin cambios desde entonces); 0 = la revisión es opcional', { valor: 0 }),
    c_('cierre_dos_personas', 'Cierre: 1 = quien envió a revisión no puede cerrar (dos personas); 0 = puede (queda registrado)', { valor: 0 }),
    c_('lectura_ppto_ok', 'Ingresos vs presupuesto: % desde el que está bien', { valor: 100 }),
    c_('lectura_ppto_alerta', 'Ingresos vs presupuesto: % desde el que es alerta', { valor: 90 }),
    c_('lectura_gasto_alerta', 'Gastos vs presupuesto: % desde el que se revisa', { valor: 100 }),
    c_('lectura_gasto_critico', 'Gastos vs presupuesto: % crítico', { valor: 110 }),
    c_('lectura_caja_critico', 'Meses de caja: menos de esto es crítico', { valor: 2 }),
    c_('lectura_caja_alerta', 'Meses de caja: menos de esto es alerta', { valor: 4 }),
    c_('detalle_minimo_pct', 'El mes paso a paso: % de movimientos con detalle del banco para darlo por hecho', { valor: 80 })
  ]
};

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; cache_ = null; });
function db_() {
  const d = Base.db_();
  if (preparada_ === d) return d;
  d.exec(`CREATE TABLE IF NOT EXISTS FIN_CATALOGO (
    tipo TEXT NOT NULL, id TEXT NOT NULL, orden INTEGER NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1,
    vigente_desde TEXT, vigente_hasta TEXT, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT,
    PRIMARY KEY (tipo, id))`);
  // Semillas: solo los tipos que todavía no tienen nada (nunca pisa lo editado).
  Object.keys(SEMILLAS).forEach((tipo) => {
    if (d.prepare('SELECT 1 FROM FIN_CATALOGO WHERE tipo = ? LIMIT 1').get(tipo)) return;
    const ins = d.prepare('INSERT OR IGNORE INTO FIN_CATALOGO (tipo, id, orden, activo, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?)');
    SEMILLAS[tipo].forEach((x, i) => ins.run(tipo, x.id, i, 1, JSON.stringify(x), new Date().toISOString(), 'semilla'));
  });
  // I11: los PARÁMETROS son ajustes del sistema: uno nuevo (p. ej. la política de cierre) se agrega aunque ya existan otros.
  // INSERT OR IGNORE: nunca pisa un valor editado. Los demás catálogos se siembran solo si están vacíos (pueden editarse a propósito).
  const insP = d.prepare('INSERT OR IGNORE INTO FIN_CATALOGO (tipo, id, orden, activo, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?)');
  const maxP = (d.prepare("SELECT COALESCE(MAX(orden), -1) AS n FROM FIN_CATALOGO WHERE tipo = 'PARAMETRO'").get() || { n: -1 }).n;
  (SEMILLAS.PARAMETRO || []).forEach((x, i) => insP.run('PARAMETRO', x.id, maxP + 1 + i, 1, JSON.stringify(x), new Date().toISOString(), 'semilla'));
  // I11.2: versión por elemento (migración aditiva).
  Base.asegurarColumna_(d, 'FIN_CATALOGO', 'version', 'INTEGER NOT NULL DEFAULT 1');
  preparada_ = d;
  return d;
}
// Solo pruebas: la conexión cambia entre pruebas.
function reiniciar_() { preparada_ = null; cache_ = null; }

let cache_ = null; // { firma, porTipo }
require('./finanzasBoveda').registrarLimpieza_(() => { cache_ = null; });
function todo_() {
  const d = db_();
  // I12.2: el catálogo depende solo de FIN_CATALOGO (firma). Se guarda en memoria solo lo armado FUERA de una
  // transacción; dentro, la misma firma significa el mismo contenido, y si una transacción lo cambia y se revierte,
  // la firma vuelve a la de afuera y su contenido sigue siendo el correcto.
  const f = d.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(version), 0) AS v, COALESCE(MAX(actualizado_en), \'\') AS u FROM FIN_CATALOGO').get();
  const firma = f.n + '|' + f.v + '|' + f.u;
  if (cache_ && cache_.d === d && cache_.firma === firma) return cache_.porTipo;
  const porTipo = {};
  d.prepare('SELECT * FROM FIN_CATALOGO ORDER BY tipo, orden, id').all().forEach((r) => {
    const x = Object.assign(JSON.parse(r.datos), { id: r.id, activo: !!r.activo, vigente_desde: r.vigente_desde || '', vigente_hasta: r.vigente_hasta || '', orden: r.orden, version: r.version || 1 });
    (porTipo[r.tipo] = porTipo[r.tipo] || []).push(x);
  });
  if (!d.isTransaction) cache_ = { porTipo, d, firma };
  return porTipo;
}

/** Elementos de un tipo. Por defecto solo activos y vigentes hoy. */
function lista_(tipo, opciones) {
  opciones = opciones || {};
  const hoy = Base.hoy_();
  return (todo_()[tipo] || []).filter((x) => opciones.todos ||
    (x.activo && (!x.vigente_desde || x.vigente_desde <= hoy) && (!x.vigente_hasta || x.vigente_hasta >= hoy)));
}
function ids_(tipo, opciones) { return lista_(tipo, opciones).map((x) => x.id); }
/** Busca por id, nombre o alias (sin tildes ni mayúsculas). Incluye inactivos (para leer historia). */
function buscar_(tipo, texto) {
  const n = Base.normalizar_(texto);
  if (!n) return null;
  return (todo_()[tipo] || []).find((x) => Base.normalizar_(x.id) === n || Base.normalizar_(x.nombre) === n ||
    (x.alias || []).some((a) => Base.normalizar_(a) === n)) || null;
}
function param_(clave, porDefecto) {
  const x = (todo_().PARAMETRO || []).find((p) => p.id === clave);
  const v = x ? Number(x.valor) : NaN;
  return isFinite(v) ? v : porDefecto;
}
/** Conceptos de un grupo, por nombre (lo que se guarda en una clasificación). */
function conceptos_(grupo, opciones) { return lista_('CONCEPTO', opciones).filter((c) => c.grupo === grupo).map((c) => c.nombre); }
function empresas_(opciones) { return ids_('EMPRESA', opciones); }
/** Empresa canónica desde un texto («HomePymes Antiguo» → HomePymes); '' si no se reconoce. */
function empresa_(texto) { const x = buscar_('EMPRESA', texto); return x ? x.id : ''; }
function medioDaCaja_(medio) { const x = buscar_('MEDIO', medio); return x ? x.caja !== false : true; }

// ---------------------------------------------------------------- acciones

const catalogos = B.conBoveda('', function () {
  const t = todo_();
  return { tipos: Object.keys(TIPOS).map((k) => ({ id: k, nombre: TIPOS[k], elementos: t[k] || [] })) };
});

/**
 * Crea o edita un elemento. No borra: para retirarlo, activo = false o
 * vigente_hasta. El id no se cambia (la historia lo referencia).
 */
const guardar = Base.conCapacidad('CONFIGURAR', '', function (db, data, contexto, x) {
  const tipo = Base.txt_(data && data.tipo);
  if (!TIPOS[tipo]) return errorValidacion('tipo', 'Catálogo desconocido.');
  const nombre = Base.txt_(data.nombre).slice(0, 120);
  if (!nombre) return errorValidacion('nombre', 'Escribe el nombre.');
  const d = db_();
  const id = Base.txt_(data.id) || (tipo === 'CONCEPTO' ? (data.grupo === 'FONDO' ? 'FONDO:' : data.grupo === 'PROVISION' ? 'PROV:' : '') + nombre : nombre).slice(0, 80);
  const previo = d.prepare('SELECT * FROM FIN_CATALOGO WHERE tipo = ? AND id = ?').get(tipo, id);
  // I11.2: editar un elemento existente exige la versión que se vio (antes, el último en guardar pisaba).
  if (previo && (data.expected_version === undefined || data.expected_version === null || data.expected_version === '')) return Base.errVersionRequerida_();
  if (previo && Number(data.expected_version) !== Number(previo.version || 1)) return Base.errConflicto(undefined, { actual: { version: previo.version || 1, actualizado_por: previo.actualizado_por } });
  const datos = Object.assign(previo ? JSON.parse(previo.datos) : {}, { id, nombre });
  if (Array.isArray(data.alias)) datos.alias = [...new Set(data.alias.map(Base.txt_).filter(Boolean))].slice(0, 30);
  if (tipo === 'CONCEPTO') {
    const g = Base.txt_(data.grupo || datos.grupo);
    if (['INGRESO', 'EGRESO', 'FONDO', 'PROVISION'].indexOf(g) === -1) return errorValidacion('grupo', 'Elige el grupo del concepto.');
    if (previo && datos.grupo && datos.grupo !== g) return errorValidacion('grupo', 'Un concepto ya usado no cambia de grupo: crea uno nuevo.');
    datos.grupo = g;
  }
  if (tipo === 'PARAMETRO') {
    const v = Number(data.valor);
    if (!isFinite(v)) return errorValidacion('valor', 'El parámetro necesita un número.');
    datos.valor = v;
  }
  if (tipo === 'OBLIGACION') {
    const dia = Number(data.dia);
    if (!(dia >= 1 && dia <= 31)) return errorValidacion('dia', 'Día del mes entre 1 y 31.');
    datos.dia = dia;
    if (Array.isArray(data.conceptos)) datos.conceptos = data.conceptos.map(Base.txt_).filter(Boolean);
  }
  if (tipo === 'MEDIO' && data.caja !== undefined) datos.caja = !!data.caja;
  const desde = Base.fechaCivil_(data.vigente_desde), hasta = Base.fechaCivil_(data.vigente_hasta);
  if (desde && hasta && hasta < desde) return errorValidacion('vigente_hasta', 'La vigencia termina antes de empezar.');
  const activo = data.activo === undefined ? (previo ? previo.activo : 1) : (data.activo ? 1 : 0);
  const orden = previo ? previo.orden : (d.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM FIN_CATALOGO WHERE tipo = ?').get(tipo).n);
  d.prepare('INSERT INTO FIN_CATALOGO (tipo, id, orden, activo, vigente_desde, vigente_hasta, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?) ' +
    'ON CONFLICT(tipo, id) DO UPDATE SET activo = excluded.activo, vigente_desde = excluded.vigente_desde, vigente_hasta = excluded.vigente_hasta, datos = excluded.datos, version = FIN_CATALOGO.version + 1, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por')
    .run(tipo, id, orden, activo, desde || null, hasta || null, JSON.stringify(datos), Base.ahora_(), x.nombre);
  x.registrar('CATALOGO_' + (previo ? 'EDITAR' : 'NUEVO'), TIPOS[tipo] + ': ' + nombre + (activo ? '' : ' (inactivo)'));
  return { tipo, id, nombre, activo: !!activo };
});

/**
 * Para la migración: asegura que exista un elemento (por id, nombre o alias).
 * No crea EMPRESAS (eso es una decisión, no un dato de planilla). Devuelve
 * { id, creado } o { error }.
 */
function asegurar_(tipo, nombre, extra, quien) {
  const n = String(nombre || '').trim();
  if (!n || !TIPOS[tipo]) return { error: 'Sin nombre.' };
  const ya = buscar_(tipo, n);
  if (ya) return { id: ya.id, creado: false };
  if (tipo === 'EMPRESA') return { error: 'Empresa desconocida: «' + n + '». No se crea una empresa desde una planilla; agrégala como alias si es la misma.' };
  const d = db_();
  const id = (tipo === 'CONCEPTO' ? (extra && extra.grupo === 'FONDO' ? 'FONDO:' : extra && extra.grupo === 'PROVISION' ? 'PROV:' : '') : '') + n.slice(0, 80);
  const orden = d.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM FIN_CATALOGO WHERE tipo = ?').get(tipo).n;
  d.prepare('INSERT OR IGNORE INTO FIN_CATALOGO (tipo, id, orden, activo, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?)')
    .run(tipo, id, orden, 1, JSON.stringify(Object.assign({ id, nombre: n.slice(0, 120) }, extra || {})), Base.ahora_(), quien || 'migración');
  return { id, creado: true };
}

module.exports = { asegurar_, catalogos, guardar, lista_, ids_, buscar_, param_, conceptos_, empresas_, empresa_, medioDaCaja_, todo_, reiniciar_, TIPOS, SEMILLAS };
