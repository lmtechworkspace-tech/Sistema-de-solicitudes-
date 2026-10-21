'use strict';

/**
 * finanzasClientes.js — la ficha de cada cliente en Finanzas (2026-10-20;
 * FIN-03, FIN-04, FIN-21, FIN-27; hoja CLIENTES de SIGECO; MEJORAS del 4/5
 * de agosto y del 25 de septiembre).
 *
 * El maestro de clientes es el de SIGSO (CAT_CLIENTES: razón social y RUT).
 * Finanzas le agrega lo comercial, sin tocar ese maestro:
 *  - FICHA: empresa que le factura, canal de captación, vendedor, fecha de
 *    ingreso, estado, observaciones, ALIAS (cómo lo llaman en las planillas y
 *    el banco: «OSSES», «ANDES») y el código de la planilla (C001…). El RUT
 *    original se conserva y se marca si no es válido.
 *  - SERVICIOS (contratos): qué se le presta, mensual o único, monto neto,
 *    día de facturación, empresa que presta, vigencia desde/hasta. Puede
 *    tener varios. Cambiar uno no reescribe el pasado: se termina y se crea
 *    otro.
 *  - DOCUMENTOS: nota de venta → contrato → factura → cobro, con número,
 *    fechas, responsable, estado, adjuntos (cifrados) y enlaces a servicios,
 *    facturas y operaciones. Un documento interno NO es una factura emitida:
 *    «emitido externamente» se marca a mano con su referencia; crear una fila
 *    o asignar un folio no simula una emisión tributaria.
 *  - ASIGNACIÓN A PROYECTOS con porcentaje y vigencia (0 % se queda en 0 %).
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const Cat = require('./finanzasCatalogos');
const FB = require('./finanzasBancos');
const { errorValidacion } = require('./errores');

const I = FB.interno;
const ESTADOS_CLIENTE = ['Activo', 'Suspendido', 'Terminado', 'Prospecto'];
const TIPOS_DOC = { NOTA_VENTA: 'Nota de venta', CONTRATO: 'Contrato', ANEXO: 'Anexo de contrato', COTIZACION: 'Cotización', OTRO: 'Otro documento' };
const ESTADOS_DOC = { BORRADOR: 'Borrador', VIGENTE: 'Vigente', TERMINADO: 'Terminado', ANULADO: 'Anulado' };
const MAX_ADJUNTO = 5 * 1024 * 1024;

let preparada_ = null;
Base.registrarEsquema_(() => { preparada_ = null; });
function db_() {
  const d = Base.db_();
  if (preparada_ === d) return d;
  [
    `CREATE TABLE IF NOT EXISTS FIN_FICHAS (
       cliente_h TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, datos TEXT NOT NULL, actualizado_en TEXT, actualizado_por TEXT)`,
    `CREATE TABLE IF NOT EXISTS FIN_SERVICIOS (
       id TEXT PRIMARY KEY, cliente_h TEXT NOT NULL, estado TEXT NOT NULL, desde TEXT, hasta TEXT, version INTEGER NOT NULL DEFAULT 1,
       datos TEXT NOT NULL, clave_origen TEXT, creado_en TEXT, creado_por TEXT, actualizado_en TEXT, actualizado_por TEXT)`,
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_serv_origen ON FIN_SERVICIOS (clave_origen) WHERE clave_origen IS NOT NULL',
    `CREATE TABLE IF NOT EXISTS FIN_DOCUMENTOS (
       id TEXT PRIMARY KEY, cliente_h TEXT NOT NULL, tipo TEXT NOT NULL, estado TEXT NOT NULL, fecha TEXT, version INTEGER NOT NULL DEFAULT 1,
       datos TEXT NOT NULL, creado_en TEXT, creado_por TEXT, actualizado_en TEXT, actualizado_por TEXT)`,
    `CREATE TABLE IF NOT EXISTS FIN_ADJUNTOS (
       id TEXT PRIMARY KEY, documento_id TEXT NOT NULL, datos TEXT NOT NULL, creado_en TEXT, creado_por TEXT)`,
    `CREATE TABLE IF NOT EXISTS FIN_ASIGNACIONES_PROYECTO (
       id TEXT PRIMARY KEY, cliente_h TEXT NOT NULL, proyecto_id TEXT NOT NULL, desde TEXT, hasta TEXT, estado TEXT NOT NULL,
       datos TEXT NOT NULL, clave_origen TEXT, creado_en TEXT, creado_por TEXT)`,
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_asig_origen ON FIN_ASIGNACIONES_PROYECTO (clave_origen) WHERE clave_origen IS NOT NULL'
  ].forEach((sql) => d.exec(sql));
  preparada_ = d;
  return d;
}
const hCli_ = (id) => I.hmac_('cliente|' + String(id));

// ---------------------------------------------------------------- lectura

function fichas_() {
  const m = new Map();
  db_().prepare('SELECT * FROM FIN_FICHAS').all().forEach((r) => { const x = Base.des_(r.datos); m.set(x.cliente_id, Object.assign({ version: r.version, actualizado_por: r.actualizado_por, actualizado_en: r.actualizado_en }, x)); });
  return m;
}
/** cliente_id → [alias] (para buscar por cómo lo llaman). */
function aliasPorCliente_() {
  const m = new Map();
  fichas_().forEach((f, id) => { if ((f.alias || []).length || f.codigo_legado) m.set(id, (f.alias || []).concat(f.codigo_legado ? [f.codigo_legado] : [])); });
  return m;
}
function servicios_(clienteId) {
  return db_().prepare('SELECT * FROM FIN_SERVICIOS WHERE cliente_h = ? ORDER BY COALESCE(desde, \'\') DESC').all(hCli_(clienteId))
    .map((r) => Object.assign({ id: r.id, estado: r.estado, desde: r.desde || '', hasta: r.hasta || '', version: r.version, actualizado_por: r.actualizado_por }, Base.des_(r.datos)));
}
function documentos_(clienteId) {
  return db_().prepare('SELECT * FROM FIN_DOCUMENTOS WHERE cliente_h = ? ORDER BY COALESCE(fecha, \'\') DESC').all(hCli_(clienteId))
    .map((r) => Object.assign({ id: r.id, tipo: r.tipo, estado: r.estado, fecha: r.fecha || '', version: r.version, actualizado_por: r.actualizado_por }, Base.des_(r.datos)));
}
function asignaciones_(clienteId) {
  const q = clienteId ? db_().prepare('SELECT * FROM FIN_ASIGNACIONES_PROYECTO WHERE cliente_h = ? ORDER BY COALESCE(desde, \'\')').all(hCli_(clienteId))
    : db_().prepare('SELECT * FROM FIN_ASIGNACIONES_PROYECTO').all();
  return q.map((r) => Object.assign({ id: r.id, proyecto_id: r.proyecto_id, desde: r.desde || '', hasta: r.hasta || '', estado: r.estado, creado_por: r.creado_por }, Base.des_(r.datos)));
}

/** Lista de clientes con lo comercial (filtros por canal, vendedor, estado, empresa y búsqueda por nombre/RUT/alias). */
const clientes = B.conBoveda('', function (db, data) {
  const fichas = fichas_();
  const q = Base.normalizar_(data && data.busca);
  const f = data || {};
  const servPorCliente = new Map();
  db_().prepare("SELECT cliente_h, datos FROM FIN_SERVICIOS WHERE estado = 'VIGENTE'").all().forEach((r) => {
    const x = Base.des_(r.datos); const l = servPorCliente.get(x.cliente_id) || []; l.push(x); servPorCliente.set(x.cliente_id, l);
  });
  const lista = I.clientes_(db).map((c) => {
    const fi = fichas.get(c.id) || {};
    const serv = servPorCliente.get(c.id) || [];
    return {
      cliente_id: c.id, cliente: c.nombre, rut: c.rut, rut_valido: Base.rut_(c.rut).valido, alias: fi.alias || [], codigo_legado: fi.codigo_legado || '',
      empresa_facturadora: fi.empresa_facturadora || '', canal: fi.canal || '', vendedor: fi.vendedor || '', estado: fi.estado || '', fecha_ingreso: fi.fecha_ingreso || '',
      servicios_vigentes: serv.length, mensual_neto: serv.filter((s) => s.modalidad === 'MENSUAL').reduce((t, s) => t + (s.monto_neto || 0), 0), con_ficha: fichas.has(c.id)
    };
  }).filter((c) => (!q || Base.normalizar_([c.cliente, c.rut, c.alias.join(' '), c.codigo_legado].join(' ')).indexOf(q) !== -1 || Base.normalizar_(c.rut).replace(/ /g, '') === q.replace(/ /g, '')) &&
    (!f.canal || c.canal === f.canal) && (!f.vendedor || c.vendedor === f.vendedor) && (!f.estado || c.estado === f.estado) && (!f.empresa || c.empresa_facturadora === f.empresa))
    .sort((a, b) => a.cliente.localeCompare(b.cliente, 'es'));
  return { total: lista.length, clientes: lista.slice(0, Math.min(Number(f.limite) || 500, 2000)), estados: ESTADOS_CLIENTE };
});

/** Todo de un cliente en una ficha: comercial, servicios, documentos, cobranza y fondos (cada saldo por separado). */
const ficha = B.conBoveda('VER_CLIENTE', function (db, data) {
  const id = Base.txt_(data && data.cliente_id);
  const cli = I.clientes_(db).find((c) => c.id === id);
  if (!cli) return errorValidacion('cliente_id', 'Ese cliente no existe en SIGSO.');
  const fi = fichas_().get(id) || null;
  let cobranza = null, fondos = null, operaciones = [];
  try {
    const n = require('./finanzasCobranza').cartera_(db).get(id);
    // I04: lo confirmado manda; lo propuesto (FIFO) va aparte. Las facturas se listan para relacionarlas con sus documentos.
    if (n) cobranza = { por_cobrar: n.por_cobrar_confirmado, propuesto: n.sugerido || 0, vencido: n.vencido_confirmado, saldo_a_favor: n.saldo_a_favor, facturado: n.facturado,
      facturas_abiertas: n.facturas.filter((f) => f.saldo_confirmado > 0 && f.estado !== 'INCOBRABLE').length, sin_aplicar: n.sin_aplicar || 0,
      facturas: n.facturas.map((f) => ({ id: f.id, empresa: f.empresa, folio: f.folio, fecha: f.fecha, total: f.total, saldo_confirmado: f.saldo_confirmado, situacion: f.situacion })) };
  } catch (e) { cobranza = null; }
  try { const fo = require('./finanzasFondos').fichaCliente_(id, ''); fondos = { saldo: fo.saldo, parcial: fo.parcial, gestiones: fo.gestiones.length, abiertas: fo.gestiones.filter((g) => g.estado === 'ABIERTA').length }; } catch (e) { fondos = null; }
  try {
    operaciones = require('./finanzasHechos').todos_().filter((h) => h.clasif && h.clasif.cliente_id === id).slice(-25).reverse()
      .map((h) => ({ ref: h.ref, fuente: h.fuente, fecha: h.fecha, monto: h.abono || -h.cargo, tipo: h.clasif.tipo, cuenta: h.clasif.cuenta, glosa: h.glosa, empresa: h.empresa }));
  } catch (e) { operaciones = []; }
  return {
    cliente_id: id, cliente: cli.nombre, rut: cli.rut, rut_valido: Base.rut_(cli.rut).valido, ficha: fi, servicios: servicios_(id), documentos: documentos_(id),
    asignaciones: asignaciones_(id), cobranza, fondos, operaciones, tipos_documento: TIPOS_DOC, estados_documento: ESTADOS_DOC, estados_cliente: ESTADOS_CLIENTE
  };
});

// ---------------------------------------------------------------- escritura

function exigirVersion_(version, actualizadoPor, esperada) {
  // I11.2: actualizar sin la versión vista no se permite (antes se aceptaba y podía sobrescribir).
  if (esperada === undefined || esperada === null || esperada === '') return Base.errVersionRequerida_();
  return Number(esperada) === Number(version) ? null : Base.errConflicto(undefined, { actual: { version, actualizado_por: actualizadoPor } });
}
function cliente_(db, id) { return I.clientes_(db).find((c) => c.id === Base.txt_(id)) || null; }

/** Guarda la ficha comercial (no cambia el maestro de SIGSO). */
function guardarFicha_(db, data, x) {
  const cli = cliente_(db, data.cliente_id);
  if (!cli) return errorValidacion('cliente_id', 'Ese cliente no existe en SIGSO.');
  const d = db_();
  const r = d.prepare('SELECT * FROM FIN_FICHAS WHERE cliente_h = ?').get(hCli_(cli.id));
  const e = r ? exigirVersion_(r.version, r.actualizado_por, data.expected_version) : null; if (e) return e;
  const previa = r ? Base.des_(r.datos) : {};
  const emp = data.empresa_facturadora !== undefined ? (Base.txt_(data.empresa_facturadora) ? Cat.empresa_(data.empresa_facturadora) : '') : previa.empresa_facturadora || '';
  if (data.empresa_facturadora && !emp) return errorValidacion('empresa_facturadora', 'Empresa desconocida.');
  const estado = data.estado !== undefined ? Base.txt_(data.estado) : previa.estado || '';
  if (estado && ESTADOS_CLIENTE.indexOf(estado) === -1) return errorValidacion('estado', 'Estado no válido.');
  const fecha = data.fecha_ingreso !== undefined ? Base.fechaCivil_(data.fecha_ingreso) : previa.fecha_ingreso || '';
  if (data.fecha_ingreso && !fecha) return errorValidacion('fecha_ingreso', 'Fecha no válida.');
  const alias = data.alias !== undefined ? [...new Set((Array.isArray(data.alias) ? data.alias : String(data.alias).split(/[,;\n]/)).map((a) => Base.txt_(a).slice(0, 60)).filter(Boolean))].slice(0, 30) : previa.alias || [];
  // Un alias no puede ser de otro cliente (FIN-03: no se fusionan clientes por un nombre).
  const otro = [...aliasPorCliente_().entries()].find(([cid, l]) => cid !== cli.id && l.some((a) => alias.some((b) => Base.normalizar_(a) === Base.normalizar_(b))));
  if (otro) return errorValidacion('alias', 'Un alias ya es de otro cliente (' + (cliente_(db, otro[0]) || {}).nombre + '): no se pueden repetir.');
  const datos = Object.assign({}, previa, {
    cliente_id: cli.id, empresa_facturadora: emp, estado, fecha_ingreso: fecha, alias,
    canal: data.canal !== undefined ? Base.txt_(data.canal).slice(0, 80) : previa.canal || '',
    vendedor: data.vendedor !== undefined ? Base.txt_(data.vendedor).slice(0, 80) : previa.vendedor || '',
    obs: data.obs !== undefined ? Base.txt_(data.obs).slice(0, 1000) : previa.obs || '',
    codigo_legado: data.codigo_legado !== undefined ? Base.txt_(data.codigo_legado).slice(0, 20) : previa.codigo_legado || '',
    rut_original: previa.rut_original || cli.rut
  });
  const ahora = Base.ahora_();
  if (r) d.prepare('UPDATE FIN_FICHAS SET datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE cliente_h = ?').run(Base.cif_(datos), ahora, x.nombre, r.cliente_h);
  else d.prepare('INSERT INTO FIN_FICHAS (cliente_h, version, datos, actualizado_en, actualizado_por) VALUES (?,?,?,?,?)').run(hCli_(cli.id), 1, Base.cif_(datos), ahora, x.nombre);
  return { cliente_id: cli.id, version: r ? r.version + 1 : 1 };
}
const guardarFicha = Base.conCapacidad('CLIENTES', '', function (db, data, contexto, x) {
  const r = guardarFicha_(db, data, x);
  if (!r._validationError) x.registrar('CLIENTE_FICHA', (cliente_(db, data.cliente_id) || {}).nombre || '');
  return r;
});

/** Crea o edita un servicio (contrato). Para cambiar el monto de uno con historia: terminarlo y crear otro. */
function guardarServicio_(db, data, x, opciones) {
  opciones = opciones || {};
  const cli = cliente_(db, data.cliente_id);
  if (!cli) return errorValidacion('cliente_id', 'Ese cliente no existe en SIGSO.');
  const servicio = Base.txt_(data.servicio).slice(0, 120);
  if (!servicio) return errorValidacion('servicio', 'Escribe el servicio.');
  const modalidad = Base.txt_(data.modalidad).toUpperCase() === 'UNICA' ? 'UNICA' : 'MENSUAL';
  let monto = null;
  if (Base.txt_(data.monto_neto) !== '') { const m = Base.montoClp_(data.monto_neto); if (!m.ok || m.valor < 0) return errorValidacion('monto_neto', m.error || 'Monto no válido.'); monto = m.valor; }
  let dia = null;
  if (Base.txt_(data.dia_facturacion) !== '') { dia = Number(data.dia_facturacion); if (!(dia >= 1 && dia <= 31)) return errorValidacion('dia_facturacion', 'Día entre 1 y 31.'); }
  const empresa = Base.txt_(data.empresa) ? Cat.empresa_(data.empresa) : '';
  if (Base.txt_(data.empresa) && !empresa) return errorValidacion('empresa', 'Empresa desconocida.');
  const desde = Base.fechaCivil_(data.desde), hasta = Base.fechaCivil_(data.hasta);
  if (Base.txt_(data.desde) && !desde) return errorValidacion('desde', 'Fecha no válida.');
  if (desde && hasta && hasta < desde) return errorValidacion('hasta', 'La vigencia termina antes de empezar.');
  const estado = Base.txt_(data.estado).toUpperCase() || (hasta && hasta < Base.hoy_() ? 'TERMINADO' : 'VIGENTE');
  if (['VIGENTE', 'TERMINADO', 'ANULADO'].indexOf(estado) === -1) return errorValidacion('estado', 'Estado no válido.');
  const datos = { cliente_id: cli.id, servicio, modalidad, monto_neto: monto, dia_facturacion: dia, empresa, nota: Base.txt_(data.nota).slice(0, 500), origen: data.origen || null };
  const d = db_(), ahora = Base.ahora_();
  if (data.id) {
    const r = d.prepare('SELECT * FROM FIN_SERVICIOS WHERE id = ?').get(Base.txt_(data.id));
    if (!r) return errorValidacion('id', 'Ese servicio no existe.');
    const e = exigirVersion_(r.version, r.actualizado_por, data.expected_version); if (e) return e;
    const previo = Base.des_(r.datos);
    datos.historial = (previo.historial || []).concat([{ en: ahora, por: x.nombre, antes: { servicio: previo.servicio, modalidad: previo.modalidad, monto_neto: previo.monto_neto, dia_facturacion: previo.dia_facturacion, desde: r.desde, hasta: r.hasta, estado: r.estado } }]).slice(-30);
    datos.origen = previo.origen || datos.origen;
    d.prepare('UPDATE FIN_SERVICIOS SET estado = ?, desde = ?, hasta = ?, datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(estado, desde || null, hasta || null, Base.cif_(datos), ahora, x.nombre, r.id);
    return { id: r.id, version: r.version + 1 };
  }
  const id = Base.id_();
  try {
    d.prepare('INSERT INTO FIN_SERVICIOS (id, cliente_h, estado, desde, hasta, version, datos, clave_origen, creado_en, creado_por, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, hCli_(cli.id), estado, desde || null, hasta || null, 1, Base.cif_(datos), opciones.clave_origen || null, ahora, x.nombre, ahora, x.nombre);
  } catch (e) { if (/UNIQUE/.test(e.message)) return { id: '', repetido: true }; throw e; }
  return { id, version: 1 };
}
const guardarServicio = Base.conCapacidad('CLIENTES', '', function (db, data, contexto, x) {
  const r = guardarServicio_(db, data, x);
  if (!r._validationError) x.registrar('CLIENTE_SERVICIO', (cliente_(db, data.cliente_id) || {}).nombre + ': ' + Base.txt_(data.servicio).slice(0, 60));
  return r;
});

/** Crea o edita un documento comercial (nota de venta, contrato…) con sus vínculos. */
const guardarDocumento = Base.conCapacidad('CLIENTES', '', function (db, data, contexto, x) {
  const cli = cliente_(db, data.cliente_id);
  if (!cli) return errorValidacion('cliente_id', 'Ese cliente no existe en SIGSO.');
  const tipo = Base.txt_(data.tipo).toUpperCase();
  if (!TIPOS_DOC[tipo]) return errorValidacion('tipo', 'Tipo de documento no válido.');
  const estado = Base.txt_(data.estado).toUpperCase() || 'BORRADOR';
  if (!ESTADOS_DOC[estado]) return errorValidacion('estado', 'Estado no válido.');
  const fecha = Base.fechaCivil_(data.fecha);
  if (Base.txt_(data.fecha) && !fecha) return errorValidacion('fecha', 'Fecha no válida.');
  const externo = !!data.emitido_externamente;
  const refExt = Base.txt_(data.referencia_externa).slice(0, 120);
  if (externo && refExt.length < 2) return errorValidacion('referencia_externa', 'Si se emitió fuera de SIGSO, indica su referencia (folio, sistema, fecha).');
  const servicios = new Set(servicios_(cli.id).map((s) => s.id));
  const servIds = (Array.isArray(data.servicio_ids) ? data.servicio_ids : []).map(Base.txt_).filter(Boolean);
  if (servIds.some((s) => !servicios.has(s))) return errorValidacion('servicio_ids', 'Un servicio no es de este cliente.');
  const facturas = new Set();
  try { require('./finanzasCobranza').facturasDeCliente_(db, cli.id).forEach((f) => facturas.add(f.id)); } catch (e) { /* sin cobranza */ }
  const facIds = (Array.isArray(data.factura_ids) ? data.factura_ids : []).map(Base.txt_).filter(Boolean);
  if (facIds.some((f) => !facturas.has(f))) return errorValidacion('factura_ids', 'Una factura no es de este cliente.');
  const datos = {
    cliente_id: cli.id, numero: Base.txt_(data.numero).slice(0, 40), titulo: Base.txt_(data.titulo).slice(0, 160), responsable: Base.txt_(data.responsable).slice(0, 120) || x.nombre,
    vigencia_desde: Base.fechaCivil_(data.vigencia_desde), vigencia_hasta: Base.fechaCivil_(data.vigencia_hasta), servicio_ids: servIds, factura_ids: facIds,
    operacion_ids: (Array.isArray(data.operacion_ids) ? data.operacion_ids : []).map(Base.txt_).filter(Boolean).slice(0, 50),
    emitido_externamente: externo, referencia_externa: refExt, nota: Base.txt_(data.nota).slice(0, 1000)
  };
  const d = db_(), ahora = Base.ahora_();
  if (data.id) {
    const r = d.prepare('SELECT * FROM FIN_DOCUMENTOS WHERE id = ?').get(Base.txt_(data.id));
    if (!r) return errorValidacion('id', 'Ese documento no existe.');
    const e = exigirVersion_(r.version, r.actualizado_por, data.expected_version); if (e) return e;
    const previo = Base.des_(r.datos);
    datos.adjuntos = previo.adjuntos || [];
    datos.historial = (previo.historial || []).concat([{ en: ahora, por: x.nombre, estado_antes: r.estado, version: r.version }]).slice(-30);
    d.prepare('UPDATE FIN_DOCUMENTOS SET tipo = ?, estado = ?, fecha = ?, datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(tipo, estado, fecha || null, Base.cif_(datos), ahora, x.nombre, r.id);
    x.registrar('DOCUMENTO_EDITAR', TIPOS_DOC[tipo] + ' ' + datos.numero + ' · ' + cli.nombre);
    return { id: r.id, version: r.version + 1 };
  }
  datos.adjuntos = [];
  const id = Base.id_();
  d.prepare('INSERT INTO FIN_DOCUMENTOS (id, cliente_h, tipo, estado, fecha, version, datos, creado_en, creado_por, actualizado_en, actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, hCli_(cli.id), tipo, estado, fecha || null, 1, Base.cif_(datos), ahora, x.nombre, ahora, x.nombre);
  x.registrar('DOCUMENTO_NUEVO', TIPOS_DOC[tipo] + ' ' + datos.numero + ' · ' + cli.nombre);
  return { id, version: 1 };
});

/** Adjunta un archivo (base64) a un documento. Se guarda cifrado en la bóveda (máx. 5 MB). */
const subirAdjunto = Base.conCapacidad('CLIENTES', '', function (db, data, contexto, x) {
  const d = db_();
  const r = d.prepare('SELECT * FROM FIN_DOCUMENTOS WHERE id = ?').get(Base.txt_(data && data.documento_id));
  if (!r) return errorValidacion('documento_id', 'Ese documento no existe.');
  const nombre = Base.txt_(data.nombre).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  if (!nombre) return errorValidacion('nombre', 'Falta el nombre del archivo.');
  const b64 = String(data.base64 || '').replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return errorValidacion('base64', 'El archivo no llegó bien.');
  const tamano = Math.floor(b64.replace(/\s/g, '').length * 3 / 4);
  if (tamano > MAX_ADJUNTO) return errorValidacion('base64', 'El archivo pesa más de 5 MB.');
  const tipo = Base.txt_(data.tipo).slice(0, 80) || 'application/octet-stream';
  const id = Base.id_();
  d.prepare('INSERT INTO FIN_ADJUNTOS (id, documento_id, datos, creado_en, creado_por) VALUES (?,?,?,?,?)').run(id, r.id, Base.cif_({ nombre, tipo, tamano, base64: b64.replace(/\s/g, '') }), Base.ahora_(), x.nombre);
  const datos = Base.des_(r.datos);
  datos.adjuntos = (datos.adjuntos || []).concat([{ id, nombre, tipo, tamano, por: x.nombre, en: Base.ahora_() }]);
  d.prepare('UPDATE FIN_DOCUMENTOS SET datos = ?, version = version + 1, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(Base.cif_(datos), Base.ahora_(), x.nombre, r.id);
  x.registrar('DOCUMENTO_ADJUNTO', nombre);
  return { id, nombre, tamano };
});
const descargarAdjunto = Base.conCapacidad('CONSULTAR', '', function (db, data, contexto, x) {
  const r = db_().prepare('SELECT * FROM FIN_ADJUNTOS WHERE id = ?').get(Base.txt_(data && data.id));
  if (!r) return errorValidacion('id', 'Ese adjunto no existe.');
  const a = Base.des_(r.datos);
  x.registrar('DOCUMENTO_DESCARGAR', a.nombre);
  return { nombre: a.nombre, tipo: a.tipo, base64: a.base64 };
});

/**
 * Asignación de un cliente a un proyecto con porcentaje y vigencia (FIN-27).
 * 0 % es 0 % (nunca se toma como «sin dato»). Cambiar el porcentaje cierra la
 * asignación vigente (hasta = día anterior) y crea otra: la historia no cambia.
 */
function guardarAsignacion_(db, data, x, opciones) {
  opciones = opciones || {};
  const cli = cliente_(db, data.cliente_id);
  if (!cli) return errorValidacion('cliente_id', 'Ese cliente no existe en SIGSO.');
  const proyecto = Base.txt_(data.proyecto_id);
  if (!proyecto) return errorValidacion('proyecto_id', 'Elige el proyecto.');
  const pctTxt = Base.txt_(data.porcentaje).replace('%', '').replace(',', '.');
  if (pctTxt === '') return errorValidacion('porcentaje', 'Indica el porcentaje (0 también vale).');
  const pct = Number(pctTxt);
  if (!isFinite(pct) || pct < 0 || pct > 100) return errorValidacion('porcentaje', 'El porcentaje va de 0 a 100.');
  const desde = Base.fechaCivil_(data.desde) || '';
  const d = db_();
  const vigente = asignaciones_(cli.id).find((a) => a.proyecto_id === proyecto && a.estado === 'VIGENTE' && !a.hasta);
  if (vigente && !opciones.clave_origen) {
    if (!desde) return errorValidacion('desde', 'Indica desde cuándo rige el nuevo porcentaje.');
    if (vigente.desde && desde <= vigente.desde) return errorValidacion('desde', 'El nuevo porcentaje debe regir después del ' + vigente.desde + '.');
    d.prepare('UPDATE FIN_ASIGNACIONES_PROYECTO SET hasta = ? WHERE id = ?').run(Base.sumarDias_(desde, -1), vigente.id);
  }
  const id = Base.id_();
  try {
    d.prepare("INSERT INTO FIN_ASIGNACIONES_PROYECTO (id, cliente_h, proyecto_id, desde, hasta, estado, datos, clave_origen, creado_en, creado_por) VALUES (?,?,?,?,?,'VIGENTE',?,?,?,?)")
      .run(id, hCli_(cli.id), proyecto, desde || null, null, Base.cif_({ cliente_id: cli.id, porcentaje: pct, porcentaje_original: Base.txt_(data.porcentaje), nota: Base.txt_(data.nota).slice(0, 300) }), opciones.clave_origen || null, Base.ahora_(), x.nombre);
  } catch (e) { if (/UNIQUE/.test(e.message)) return { id: '', repetido: true }; throw e; }
  return { id };
}
const guardarAsignacion = Base.conCapacidad('CLIENTES', '', function (db, data, contexto, x) {
  const r = guardarAsignacion_(db, data, x);
  if (!r._validationError) x.registrar('CLIENTE_PROYECTO', (cliente_(db, data.cliente_id) || {}).nombre + ' → ' + Base.txt_(data.proyecto_id) + ' ' + Base.txt_(data.porcentaje) + ' %');
  return r;
});

function reiniciar_() { preparada_ = null; }

module.exports = {
  clientes, ficha, guardarFicha, guardarServicio, guardarDocumento, subirAdjunto, descargarAdjunto, guardarAsignacion,
  aliasPorCliente_, fichas_, servicios_, documentos_, asignaciones_, guardarFicha_, guardarServicio_, guardarAsignacion_, TIPOS_DOC, ESTADOS_DOC, ESTADOS_CLIENTE, reiniciar_
};
