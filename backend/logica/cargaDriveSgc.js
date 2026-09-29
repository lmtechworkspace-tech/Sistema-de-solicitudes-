'use strict';

/**
 * cargaDriveSgc.js — vuelca al módulo de Calidad la información del SGC que
 * hasta ahora vivía en Google Drive (carpeta "Homepymes ISO9001").
 *
 * Por qué existe: el SGC se armó en Drive (procedimientos, matrices,
 * auditoría interna, NC, revisión por la dirección) y SIGSO tenía solo la
 * carga de agosto. La idea es que desde ahora la gestión viva en SIGSO, así
 * que hace falta traer todo lo hecho -- ordenado donde corresponde, con el
 * enlace al original de Drive mientras se completa la transición.
 *
 * Reglas de diseño:
 * 1) El PAQUETE (los datos) NO vive en el repo: llega por la API como JSON.
 *    Este archivo es solo el motor, genérico.
 * 2) Idempotente: se puede correr dos veces sin duplicar nada. Cada sección
 *    busca primero su registro por una clave natural (código de documento,
 *    texto del factor, correlativo de la auditoría, nombre de la
 *    capacitación, cliente+proceso+período de la prestación...).
 * 3) Todo o nada: corre dentro de una transacción. Es 100 % síncrono a
 *    propósito (ningún await), así ninguna otra petición se intercala.
 *    Con `simular: true` hace todo, mide la cobertura resultante y
 *    REVIERTE: sirve para ver el efecto en producción sin tocar nada.
 * 4) No inventa: lo que el Drive no dice (una fecha, un responsable) no se
 *    rellena; se informa como pendiente en `avisos`.
 * 5) Los registros históricos (auditoría de agosto, sus NC) se escriben con
 *    sus fechas reales. Pasar por las funciones de cada módulo los fecharía
 *    "hoy" y dispararía avisos de algo que ocurrió hace un mes.
 * 6) El texto escrito de un documento solo se pisa si nadie lo editó en
 *    SIGSO después de la carga (marca `origen: 'DRIVE'` en el contenido; al
 *    guardar desde la pantalla esa marca desaparece).
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Contexto = require('./contextoSgc');
const Riesgos = require('./riesgosSgc');
const Actividades = require('./actividades');
const DocumentosVivos = require('./documentosVivosSgc');
const Matriz = require('./matrizCoberturaSgc');

const ORIGEN_CARGA = 'DRIVE';

function uuid_() { return crypto.randomUUID(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function esActivo_(f) { return esVerdadero_(f.activa); }
function leer_(db, hoja) { try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (e) { return []; } }
function normalizarEmail_(e) { return String(e || '').trim().toLowerCase(); }
function ahoraIso_() { return new Date().toISOString(); }
function norm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function isoDe_(fecha) {
  if (!fecha) return '';
  const s = String(fecha).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T12:00:00.000Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
function sumarMeses_(fechaIso, meses) {
  const d = new Date(fechaIso);
  if (isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
}
function registrarLog_(db, accion, detalle, contexto) {
  try {
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: uuid_(), timestamp: ahoraIso_(), contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle, ref: 'SGC'
    });
  } catch (e) { /* trazabilidad, no el flujo */ }
}

// Un error de validación de un módulo corta la carga completa (y la
// transacción se revierte): mejor nada que media carga.
function exigir_(resultado, que) {
  if (!resultado || resultado._validationError || resultado._forbidden || resultado.ok === false) {
    throw new Error(que + ': ' + ((resultado && resultado.message) || 'sin respuesta'));
  }
  return resultado;
}

// --- personas por nombre -----------------------------------------------------
// El Drive nombra a las personas ("Luis Mendoza", "Bárbara Álvarez"), no
// sus correos. Se resuelve contra SGC_PERSONAS: todas las palabras del
// nombre buscado tienen que estar en el nombre registrado.
function personasQueCoinciden_Fila_(p, nombre) {
  const buscadas = norm_(nombre).split(' ').filter(Boolean);
  const propias = norm_(p.nombre).split(' ');
  return buscadas.length > 0 && buscadas.every((t) => propias.indexOf(t) !== -1);
}
function personasQueCoinciden_(db, nombre, incluirDesvinculadas) {
  return leer_(db, 'SGC_PERSONAS').filter((p) => esActivo_(p) && (incluirDesvinculadas || p.estado !== 'DESVINCULADO'))
    .filter((p) => personasQueCoinciden_Fila_(p, nombre));
}
function resolverPersonas_(db) {
  const cache = {};
  return function (nombre) {
    const clave = norm_(nombre);
    if (!clave) return null;
    if (cache[clave] !== undefined) return cache[clave];
    // Quien tiene dos cargos puede tener dos fichas con el mismo correo:
    // cualquiera sirve para resolver el correo.
    const hit = personasQueCoinciden_(db, nombre, false).find((p) => String(p.usuario_email || '').trim()) || null;
    cache[clave] = hit ? { persona_id: hit.persona_id, email: normalizarEmail_(hit.usuario_email), nombre: hit.nombre } : null;
    return cache[clave];
  };
}

function emailDe_(ctx, nombre, para) {
  const p = ctx.persona(nombre);
  if (p && p.email) return p.email;
  ctx.r.avisos.push('No se encontró a "' + nombre + '" en Personas (' + para + '): se asignó al Encargado del SGC.');
  return normalizarEmail_(ctx.usuario.email);
}

// --- tareas ("Mi trabajo") ---------------------------------------------------
// Mismo motor que usan NC, riesgos y acuerdos (Actividades.crear). Si el
// Drive dice que ya se hizo, la tarea nace y se cierra con la fecha real.
function crearTarea_(ctx, t) {
  const act = exigir_(Actividades.crear(ctx.db, {
    titulo: t.titulo, descripcion: t.descripcion || '', responsable_email: t.responsable_email,
    fecha_compromiso: t.fecha_compromiso, area_id: '', prioridad: 'P2', origen: 'ASIGNADA', requiere_validacion: false,
    sgc_origen_tipo: t.origen_tipo, sgc_origen_id: t.origen_id
  }, ctx.usuario), 'Tarea "' + t.titulo + '"');
  if (t.terminada) {
    actualizarFilaPorId_(ctx.db, 'ACTIVIDADES', 'actividad_id', act.actividad_id, {
      estado: Actividades.ACTIVIDADES_ESTADOS.TERMINADA, fecha_terminada: isoDe_(t.terminada), avance_pct: 100,
      fecha_compromiso: act.fecha_compromiso || act.fecha_propuesta, confirmada_en: act.confirmada_en || ahoraIso_(),
      ultima_actualizacion: ahoraIso_()
    });
    Actividades.registrarEventoActividad_(ctx.db, act.actividad_id, 'COMENTARIO', ctx.usuario,
      'Registrada como terminada el ' + String(t.terminada).slice(0, 10) + ' según el registro del SGC en Drive.' + (t.nota_cierre ? ' ' + t.nota_cierre : ''));
  }
  ctx.r.conteo.tareas++;
  return act.actividad_id;
}

// ============================================================================
// 1) Documentos: enlace a Drive, cláusulas, versión y texto escrito
// ============================================================================
function cargarDocumentos_(ctx, lista) {
  const db = ctx.db;
  (lista || []).forEach((item) => {
    const codigo = String(item.codigo || '').trim().toUpperCase();
    // Los externos se escribieron de más de una forma ("Ley 16744" / "Ley
    // 16.744"): se comparan sin puntuación ni mayúsculas.
    const clave = norm_(codigo).replace(/ /g, '');
    let doc = leer_(db, 'SGC_DOCUMENTOS').find((d) => esActivo_(d) && norm_(d.codigo).replace(/ /g, '') === clave);
    if (!doc) { ctx.r.avisos.push('Documento ' + codigo + ' no existe en SIGSO: se omitió.'); return; }
    const cambios = {};

    if (item.nombre && item.nombre !== doc.nombre) cambios.nombre = item.nombre;
    if (item.enlace_drive !== undefined && item.enlace_drive !== doc.enlace_drive) {
      if (item.enlace_drive && !/^https:\/\/(drive|docs)\.google\.com\/\S+$/i.test(item.enlace_drive)) throw new Error('Enlace inválido en ' + codigo);
      cambios.enlace_drive = item.enlace_drive;
    }
    if (item.emisor && !String(doc.emisor || '').trim()) cambios.emisor = item.emisor;
    if (item.clase_externa && !String(doc.clase_externa || '').trim()) cambios.clase_externa = item.clase_externa;
    if (item.estado && item.estado !== doc.estado) cambios.estado = item.estado;
    if (item.proxima_revision && item.proxima_revision !== doc.proxima_revision) cambios.proxima_revision = item.proxima_revision;

    if (item.clausulas_agregar && item.clausulas_agregar.length) {
      const actuales = Calidad.parsearClausulasIso_(doc.clausulas_iso);
      const union = actuales.slice();
      item.clausulas_agregar.forEach((c) => { if (union.indexOf(c) === -1) union.push(c); });
      if (union.length !== actuales.length) cambios.clausulas_iso = JSON.stringify(union);
    }
    if (Object.keys(cambios).length) {
      actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', doc.documento_id, cambios);
      doc = Object.assign({}, doc, cambios);
      ctx.r.conteo.documentos_actualizados++;
    }

    // Versión: el Drive tiene una edición más nueva que la registrada.
    if (item.version && item.version !== doc.version_vigente) {
      const fecha = isoDe_(item.version_fecha) || ahoraIso_();
      leer_(db, 'SGC_DOC_VERSIONES').forEach((v) => {
        if (v.documento_id === doc.documento_id && esVerdadero_(v.vigente)) actualizarFilaPorId_(db, 'SGC_DOC_VERSIONES', 'version_id', v.version_id, { vigente: false });
      });
      agregarFila_(db, 'SGC_DOC_VERSIONES', {
        version_id: uuid_(), documento_id: doc.documento_id, version: item.version, cambios: item.version_cambios || '',
        archivo_id: '', archivo_nombre: '', archivo_mime: '',
        subido_por: normalizarEmail_(ctx.usuario.email), fecha, vigente: true, contenido: ''
      });
      const verCambios = {
        version_vigente: item.version, fecha_vigencia: fecha.slice(0, 10), proxima_revision: sumarMeses_(fecha, 12),
        estado: 'VIGENTE', archivo_id: '', archivo_nombre: '', archivo_mime: ''
      };
      actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', doc.documento_id, verCambios);
      doc = Object.assign({}, doc, verCambios);
      ctx.r.conteo.versiones++;
      ctx.r.hechos.push(codigo + ': pasa a ' + item.version + ' (' + (item.version_cambios || '') + ').');
    }

    // Texto escrito en SIGSO.
    if (item.contenido) {
      const c = DocumentosVivos.contenidoValido_(item.contenido);
      if (c._validationError) throw new Error(codigo + ': ' + c.message);
      let previo = null;
      try { previo = doc.contenido ? JSON.parse(doc.contenido) : null; } catch (e) { previo = null; }
      if (previo && previo.origen !== ORIGEN_CARGA) {
        ctx.r.omitidos.push(codigo + ': ya tiene texto editado en SIGSO; no se reemplazó.');
      } else {
        const guardado = JSON.stringify(Object.assign({}, c, { origen: ORIGEN_CARGA }));
        if (guardado !== doc.contenido) {
          const cc = { contenido: guardado, contenido_borrador: '' };
          if (item.contenido_fuente !== undefined) cc.contenido_fuente = item.contenido_fuente;
          actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', doc.documento_id, cc);
          const fila = leer_(db, 'SGC_DOC_VERSIONES').find((v) => v.documento_id === doc.documento_id && String(v.version) === String(doc.version_vigente));
          if (fila) actualizarFilaPorId_(db, 'SGC_DOC_VERSIONES', 'version_id', fila.version_id, { contenido: guardado });
          ctx.r.conteo.documentos_escritos++;
        }
      }
    }
  });
}

// ============================================================================
// 2) Contexto (§4.1): factores nuevos del FODA vigente
// ============================================================================
function cargarContexto_(ctx, datos) {
  if (!datos) return;
  const db = ctx.db;
  (datos.factores || []).forEach((f) => {
    const clave = norm_(f.clave || f.descripcion).slice(0, 60);
    const existe = Contexto.factoresContextoActivos_(db).find((x) => x.tipo === f.tipo && norm_(x.descripcion).indexOf(clave) !== -1);
    if (existe) { ctx.r.omitidos.push('Factor de contexto ya existente: ' + f.descripcion.slice(0, 60)); return; }
    const r = exigir_(Contexto.guardarFactor(db, { tipo: f.tipo, descripcion: f.descripcion, observaciones: f.observaciones || '' }, ctx.usuario), 'Factor de contexto');
    if (f.fecha_identificacion) actualizarFilaPorId_(db, 'SGC_CONTEXTO', 'factor_id', r.factor_id, { fecha_identificacion: f.fecha_identificacion });
    ctx.r.conteo.factores++;
    ctx.r.hechos.push('Contexto: nuevo factor ' + f.tipo.toLowerCase() + ' — ' + f.descripcion.slice(0, 70));
  });
  if (datos.revisado) {
    exigir_(Contexto.registrarRevision(db, {}, ctx.usuario), 'Revisión del contexto');
  }
}

// ============================================================================
// 3) Riesgos (§6.1): riesgos nuevos + acciones asignadas como tarea
// ============================================================================
function buscarRiesgo_(db, clase, texto) {
  const clave = norm_(texto);
  return Riesgos.riesgosActivos_(db).find((r) => r.clase === clase && (norm_(r.factor).indexOf(clave) !== -1 || norm_(r.descripcion).indexOf(clave) !== -1)) || null;
}
function cargarRiesgos_(ctx, datos) {
  if (!datos) return;
  const db = ctx.db;
  (datos.nuevos || []).forEach((n) => {
    if (buscarRiesgo_(db, n.clase || 'RIESGO', n.clave)) { ctx.r.omitidos.push('Riesgo ya existente: ' + n.factor); return; }
    let factorId = '';
    if (n.factor_contexto_clave) {
      const clave = norm_(n.factor_contexto_clave);
      const f = Contexto.factoresContextoActivos_(db).find((x) => norm_(x.descripcion).indexOf(clave) !== -1);
      factorId = f ? f.factor_id : '';
    }
    const datosR = Object.assign({}, n, { factor_contexto_id: factorId });
    delete datosR.clave; delete datosR.factor_contexto_clave; delete datosR.responsable; delete datosR.fecha_identificacion;
    const res = exigir_(Riesgos.guardar(db, datosR, ctx.usuario), 'Riesgo ' + n.factor);
    const extra = {};
    if (n.fecha_identificacion) extra.fecha_identificacion = n.fecha_identificacion;
    if (n.responsable) extra.responsable_email = emailDe_(ctx, n.responsable, 'riesgo ' + n.factor);
    if (Object.keys(extra).length) actualizarFilaPorId_(db, 'SGC_RIESGOS', 'riesgo_id', res.riesgo_id, extra);
    ctx.r.conteo.riesgos++;
    ctx.r.hechos.push('Riesgos: nuevo ' + (n.clase || 'RIESGO').toLowerCase() + ' — ' + n.factor);
  });
  (datos.acciones || []).forEach((a) => {
    const r = buscarRiesgo_(db, a.clase || 'RIESGO', a.clave);
    if (!r) { ctx.r.avisos.push('No se encontró el riesgo "' + a.clave + '" para asignar su acción.'); return; }
    if (r.accion_actividad_id) { ctx.r.omitidos.push('El riesgo ' + r.codigo + ' ya tenía su acción asignada.'); return; }
    if (!String(r.accion || '').trim()) { ctx.r.avisos.push('El riesgo ' + r.codigo + ' no tiene acción escrita: no se asignó.'); return; }
    const responsable = emailDe_(ctx, a.responsable, 'acción del riesgo ' + r.codigo);
    const id = crearTarea_(ctx, {
      titulo: (r.clase === 'OPORTUNIDAD' ? 'Oportunidad ' : 'Riesgo ') + r.codigo + ': ' + String(r.factor || '').slice(0, 80),
      descripcion: r.accion + (r.medidas_control ? '\n\nControles: ' + r.medidas_control : ''),
      responsable_email: responsable, fecha_compromiso: isoDe_(a.fecha_compromiso), origen_tipo: 'RIESGO_SGC', origen_id: r.riesgo_id
    });
    actualizarFilaPorId_(db, 'SGC_RIESGOS', 'riesgo_id', r.riesgo_id, { accion_actividad_id: id, responsable_email: responsable, estado: 'TRATADO' });
    ctx.r.hechos.push('Riesgos: acción de ' + r.codigo + ' asignada como tarea.');
  });
  if (datos.revisado) exigir_(Riesgos.registrarRevision(db, {}, ctx.usuario), 'Revisión de la matriz de riesgos');
}

// ============================================================================
// 4) Objetivos (§6.2): cambios del DOC-07 vigente + lecturas informadas
// ============================================================================
function periodoQueContiene_(frecuencia, fecha) {
  const d = new Date(isoDe_(fecha));
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  if (frecuencia === 'MENSUAL') return y + '-M' + ('0' + m).slice(-2);
  if (frecuencia === 'TRIMESTRAL') return y + '-T' + Math.ceil(m / 3);
  if (frecuencia === 'SEMESTRAL') return y + '-S' + (m <= 6 ? 1 : 2);
  return String(y);
}
function cumpleMeta_(valor, o) {
  const meta = Number(o.meta_valor), v = Number(valor);
  if (!isFinite(meta) || !isFinite(v)) return false;
  switch (o.meta_operador) {
    case 'MAYOR_IGUAL': return v >= meta;
    case 'MAYOR': return v > meta;
    case 'MENOR_IGUAL': return v <= meta;
    case 'MENOR': return v < meta;
    default: return false;
  }
}
function cargarObjetivos_(ctx, datos) {
  if (!datos) return;
  const db = ctx.db;
  const delAnio = () => leer_(db, 'SGC_OBJETIVOS').filter((o) => esActivo_(o) && Number(o.anio) === Number(datos.anio));
  (datos.cambios || []).forEach((c) => {
    const o = delAnio().find((x) => Number(x.numero) === Number(c.numero));
    if (!o) { ctx.r.avisos.push('Objetivo ' + c.numero + ' de ' + datos.anio + ' no existe.'); return; }
    const campos = {};
    Object.keys(c).forEach((k) => { if (k !== 'numero' && String(o[k]) !== String(c[k])) campos[k] = c[k]; });
    if (!Object.keys(campos).length) return;
    actualizarFilaPorId_(db, 'SGC_OBJETIVOS', 'objetivo_id', o.objetivo_id, campos);
    ctx.r.hechos.push('Objetivos: objetivo ' + c.numero + ' actualizado a la versión vigente del DOC-07.');
  });
  (datos.lecturas || []).forEach((l) => {
    const o = delAnio().find((x) => Number(x.numero) === Number(l.numero));
    if (!o) { ctx.r.avisos.push('Objetivo ' + l.numero + ' no existe: lectura omitida.'); return; }
    const periodo = l.periodo || periodoQueContiene_(o.frecuencia, l.fecha);
    const previa = leer_(db, 'SGC_INDICADOR_LECTURAS').find((x) => esActivo_(x) && x.objetivo_id === o.objetivo_id && x.periodo === periodo);
    if (previa) { ctx.r.omitidos.push('Objetivo ' + l.numero + ' ya tenía lectura en ' + periodo + '.'); return; }
    agregarFila_(db, 'SGC_INDICADOR_LECTURAS', {
      lectura_id: uuid_(), objetivo_id: o.objetivo_id, indicador_id: '', anio: Number(o.anio), periodo, valor: Number(l.valor),
      numerador: l.numerador === undefined ? '' : l.numerador, denominador: l.denominador === undefined ? '' : l.denominador,
      cumple: cumpleMeta_(l.valor, o), origen: 'MANUAL', detalle: '', observaciones: l.observaciones || '',
      registrado_por: normalizarEmail_(ctx.usuario.email), fecha_registro: isoDe_(l.fecha) || ahoraIso_(), activa: true
    });
    ctx.r.conteo.lecturas++;
    ctx.r.hechos.push('Objetivos: lectura del objetivo ' + l.numero + ' (' + periodo + ') = ' + l.valor + '.');
  });
}

// ============================================================================
// 5) Auditorías internas (§9.2) con sus hallazgos y NC (§10.2)
// ============================================================================
function siguienteCorrelativo_(db, hoja, prefijo, anio, campoFecha) {
  const n = leer_(db, hoja).filter((x) => {
    if (hoja === 'SGC_AUDITORIAS') return Number(x.anio) === Number(anio);
    const f = new Date(x[campoFecha] || x.fecha_creacion);
    return !isNaN(f.getTime()) && f.getFullYear() === Number(anio);
  }).length;
  return prefijo + anio + '-' + ('00' + (n + 1)).slice(-3);
}
function cargarAuditorias_(ctx, lista) {
  const db = ctx.db;
  (lista || []).forEach((a) => {
    const anio = new Date(isoDe_(a.fecha_programada)).getUTCFullYear();
    // Clave natural: el correlativo del propio registro de Drive queda en
    // `criterios`, que la carga escribe y nadie más usa como identificador.
    const marca = '[Registro ' + a.registro + ']';
    let aud = leer_(db, 'SGC_AUDITORIAS').find((x) => esActivo_(x) && String(x.criterios || '').indexOf(marca) !== -1);
    if (aud) { ctx.r.omitidos.push('Auditoría ' + a.registro + ' ya cargada (' + aud.correlativo + ').'); return; }

    const auditados = (a.auditados || []).map((n) => { const p = ctx.persona(n); return p ? p.email : ''; }).filter(Boolean);
    aud = {
      auditoria_id: uuid_(), correlativo: siguienteCorrelativo_(db, 'SGC_AUDITORIAS', 'AI-', anio), anio, area_id: '',
      proceso: a.proceso, clausulas: JSON.stringify(a.clausulas || []), auditor_email: a.auditor,
      auditados: JSON.stringify(auditados), coauditores: JSON.stringify([]),
      objetivo: a.objetivo || '', alcance: a.alcance || '', criterios: ((a.criterios || '') + ' ' + marca).trim(),
      fecha_programada: isoDe_(a.fecha_programada), fecha_plan: isoDe_(a.fecha_plan), fecha_ejecucion: isoDe_(a.fecha_ejecucion),
      estado: a.estado || 'PROGRAMADA',
      informe_plazo: '', informe_fecha: a.informe ? isoDe_(a.informe.fecha) : '', informe_conclusion: a.informe ? a.informe.conclusion : '',
      personas_entrevistadas: JSON.stringify(a.informe ? (a.informe.entrevistados || []) : []),
      fecha_cierre: a.fecha_cierre ? isoDe_(a.fecha_cierre) : '', cerrada_por: a.fecha_cierre ? normalizarEmail_(ctx.usuario.email) : '',
      creada_por: normalizarEmail_(ctx.usuario.email), fecha_creacion: ahoraIso_(), activa: true
    };
    agregarFila_(db, 'SGC_AUDITORIAS', aud);
    ctx.r.conteo.auditorias++;
    ctx.r.hechos.push('Auditoría ' + aud.correlativo + ' (' + a.registro + '): ' + aud.estado.toLowerCase() + '.');

    (a.hallazgos || []).forEach((h) => {
      const hallazgo = {
        hallazgo_id: uuid_(), auditoria_id: aud.auditoria_id, clausula: h.clausula, aspecto_verificado: h.aspecto,
        evidencia: h.evidencia || '', resultado: h.resultado, descripcion: h.descripcion || '', nc_id: '',
        registrado_por: normalizarEmail_(ctx.usuario.email), fecha_registro: aud.fecha_ejecucion || ahoraIso_(), activo: true
      };
      agregarFila_(db, 'SGC_AUD_HALLAZGOS', hallazgo);
      ctx.r.conteo.hallazgos++;
      if (h.nc) {
        const ncId = cargarNc_(ctx, h.nc, { hallazgo, auditoria: aud });
        actualizarFilaPorId_(db, 'SGC_AUD_HALLAZGOS', 'hallazgo_id', hallazgo.hallazgo_id, { nc_id: ncId });
      }
    });
  });
}

function cargarNc_(ctx, n, origen) {
  const db = ctx.db;
  const fechaDet = isoDe_(n.fecha_deteccion);
  const responsable = emailDe_(ctx, n.responsable, 'NC ' + (n.referencia || ''));
  const nc = {
    nc_id: uuid_(), correlativo: siguienteCorrelativo_(db, 'SGC_NC', 'NC-', new Date(fechaDet).getFullYear(), 'fecha_deteccion'),
    fuente: n.fuente || 'AUDITORIA_INTERNA', origen_ref: origen ? origen.hallazgo.hallazgo_id : '',
    referencia_normativa: n.referencia_normativa || '', descripcion: n.descripcion, area_id: '',
    detectada_por: n.detectada_por || '', fecha_deteccion: fechaDet, responsable_email: responsable,
    estado: 'ABIERTA', ciclo: 1,
    correccion_descripcion: '', correccion_actividad_id: '', correccion_plazo: isoDe_(n.correccion.plazo), correccion_fecha_cierre: '',
    porque_1: n.porques[0] || '', porque_2: n.porques[1] || '', porque_3: n.porques[2] || '', porque_4: n.porques[3] || '', porque_5: n.porques[4] || '',
    causa_raiz: n.causa_raiz,
    accion_descripcion: '', accion_actividad_id: '', accion_plazo: '', accion_fecha_cierre: '',
    eficacia_plazo: n.eficacia ? isoDe_(n.eficacia.plazo) : '', eficacia_fecha: '', eficacia_resultado: '',
    eficacia_observaciones: n.eficacia ? 'Criterio de verificación (FO-PRO-06-01): ' + n.eficacia.criterio : '',
    fecha_cierre: '', cerrada_por: '', fecha_creacion: ahoraIso_(), activa: true
  };
  agregarFila_(db, 'SGC_NC', nc);

  const cambios = {};
  const corrResp = n.correccion.responsable ? emailDe_(ctx, n.correccion.responsable, 'corrección ' + nc.correlativo) : responsable;
  cambios.correccion_descripcion = n.correccion.descripcion;
  cambios.correccion_actividad_id = crearTarea_(ctx, {
    titulo: '[NC ' + nc.correlativo + '] Corrección: ' + n.correccion.descripcion.slice(0, 80),
    descripcion: 'Corrección de la no conformidad ' + nc.correlativo + '.\n\n' + n.correccion.descripcion + '\n\nNo conformidad: ' + nc.descripcion,
    responsable_email: corrResp, fecha_compromiso: nc.correccion_plazo, origen_tipo: 'NC_CORRECCION', origen_id: nc.nc_id,
    terminada: n.correccion.cerrada, nota_cierre: n.correccion.evidencia_cierre || ''
  });
  cambios.estado = 'EN_CORRECCION';
  if (n.correccion.cerrada) cambios.correccion_fecha_cierre = isoDe_(n.correccion.cerrada);

  if (n.accion) {
    const accResp = n.accion.responsable ? emailDe_(ctx, n.accion.responsable, 'acción ' + nc.correlativo) : responsable;
    cambios.accion_descripcion = n.accion.descripcion;
    cambios.accion_plazo = isoDe_(n.accion.plazo);
    cambios.accion_actividad_id = crearTarea_(ctx, {
      titulo: '[NC ' + nc.correlativo + '] Acción correctiva: ' + n.accion.descripcion.slice(0, 80),
      descripcion: 'Acción correctiva de la no conformidad ' + nc.correlativo + '.\n\n' + n.accion.descripcion + '\n\nCausa raíz: ' + nc.causa_raiz,
      responsable_email: accResp, fecha_compromiso: cambios.accion_plazo, origen_tipo: 'NC_ACCION', origen_id: nc.nc_id
    });
    // La acción correctiva se trabaja una vez hecha la corrección: si la
    // corrección sigue abierta, la NC sigue "en corrección".
    if (n.correccion.cerrada) cambios.estado = 'EN_ACCION';
  }
  actualizarFilaPorId_(db, 'SGC_NC', 'nc_id', nc.nc_id, cambios);
  ctx.r.conteo.nc++;
  ctx.r.hechos.push('NC ' + nc.correlativo + ' (' + (n.referencia || '') + '): ' + cambios.estado.toLowerCase().replace('_', ' ') + '.');
  return nc.nc_id;
}

// ============================================================================
// 6) Revisión por la dirección (§9.3): acuerdos + cierre
// ============================================================================
function cargarRevision_(ctx, datos) {
  if (!datos) return;
  const db = ctx.db;
  const rev = leer_(db, 'SGC_REVISIONES').find((x) => esActivo_(x) && x.correlativo === datos.correlativo);
  if (!rev) { ctx.r.avisos.push('Revisión ' + datos.correlativo + ' no existe en SIGSO.'); return; }
  const cambios = {};
  if (datos.conclusiones && !String(rev.conclusiones || '').trim()) cambios.conclusiones = datos.conclusiones;
  if (datos.anexos && !String(rev.anexos || '').trim()) cambios.anexos = datos.anexos;
  if (Object.keys(cambios).length) actualizarFilaPorId_(db, 'SGC_REVISIONES', 'revision_id', rev.revision_id, cambios);

  const existentes = leer_(db, 'SGC_REVISION_ACUERDOS').filter((x) => esActivo_(x) && x.revision_id === rev.revision_id);
  (datos.acuerdos || []).forEach((a) => {
    const clave = norm_(a.observaciones).slice(0, 50);
    if (existentes.some((x) => norm_(x.observaciones).indexOf(clave) !== -1)) { ctx.r.omitidos.push('Acuerdo ya registrado: ' + a.observaciones.slice(0, 60)); return; }
    const responsable = emailDe_(ctx, a.responsable, 'acuerdo de ' + rev.correlativo);
    const plazo = isoDe_(a.plazo);
    const etiqueta = { MEJORA: 'Las oportunidades de mejora', CAMBIO_SGC: 'Cualquier necesidad de cambio en el sistema de gestión de la calidad', RECURSOS: 'Las necesidades de recursos' }[a.tipo];
    if (!etiqueta) throw new Error('Tipo de acuerdo inválido: ' + a.tipo);
    const actividadId = crearTarea_(ctx, {
      titulo: 'Acuerdo de revisión por la dirección — ' + etiqueta,
      descripcion: a.observaciones + '\n\n(Acuerdo de la revisión ' + rev.correlativo + ', ISO 9001 §9.3.3.)',
      responsable_email: responsable, fecha_compromiso: plazo, origen_tipo: 'REVISION_ACUERDO', origen_id: rev.revision_id,
      terminada: a.terminado, nota_cierre: a.nota_cierre || ''
    });
    agregarFila_(db, 'SGC_REVISION_ACUERDOS', {
      acuerdo_id: uuid_(), revision_id: rev.revision_id, tipo: a.tipo, observaciones: a.observaciones,
      responsable_email: responsable, plazo, actividad_id: actividadId,
      creado_por: normalizarEmail_(ctx.usuario.email), fecha_creacion: ahoraIso_(), activa: true
    });
    ctx.r.conteo.acuerdos++;
    ctx.r.hechos.push('Revisión ' + rev.correlativo + ': acuerdo "' + a.observaciones.slice(0, 60) + '".');
  });

  const actual = leer_(db, 'SGC_REVISIONES').find((x) => x.revision_id === rev.revision_id);
  if (datos.cerrar && actual.estado === 'REALIZADA') {
    if (!String(actual.conclusiones || '').trim()) { ctx.r.avisos.push('La revisión no tiene conclusiones: no se cerró.'); return; }
    actualizarFilaPorId_(db, 'SGC_REVISIONES', 'revision_id', rev.revision_id, {
      estado: 'CERRADA', fecha_cierre: isoDe_(datos.fecha_cierre) || ahoraIso_(), cerrada_por: normalizarEmail_(ctx.usuario.email)
    });
    ctx.r.hechos.push('Revisión ' + rev.correlativo + ' cerrada.');
  } else if (datos.cerrar && actual.estado !== 'CERRADA') {
    ctx.r.avisos.push('La revisión ' + rev.correlativo + ' está en estado ' + actual.estado + ': primero hay que registrar el acta.');
  }
}

// ============================================================================
// 7) Personas (§7.2/§7.3): inducciones y capacitaciones
// ============================================================================
function desvincularPersonas_(ctx, lista) {
  const db = ctx.db;
  (lista || []).forEach((x) => {
    const filas = personasQueCoinciden_(db, x.persona, true);
    if (!filas.length) {
      // Quien ya se sacó del alcance del SGC (activa = false) no cuenta para
      // §7.2/§7.3: no hace falta desvincularlo, pero se informa distinto.
      const fueraDeAlcance = leer_(db, 'SGC_PERSONAS').some((p) => !esActivo_(p) && personasQueCoinciden_Fila_(p, x.persona));
      ctx.r.omitidos.push('Desvinculación: "' + x.persona + '" ' + (fueraDeAlcance ? 'ya está fuera del alcance del SGC.' : 'no figura en Personas.'));
      return;
    }
    filas.filter((p) => p.estado !== 'DESVINCULADO').forEach((p) => {
      actualizarFilaPorId_(db, 'SGC_PERSONAS', 'persona_id', p.persona_id, { estado: 'DESVINCULADO', fecha_desvinculacion: isoDe_(x.fecha) });
      registrarLog_(db, 'SGC_PERSONA_DESVINCULADA', p.nombre + ' (' + (x.motivo || 'carga Drive') + ')', ctx.usuario);
      ctx.r.conteo.desvinculadas++;
      ctx.r.hechos.push('Personas: ' + p.nombre + ' queda desvinculada (' + (x.motivo || '') + ').');
    });
  });
}

function cargarInducciones_(ctx, lista) {
  const db = ctx.db;
  (lista || []).forEach((ind) => {
    const fichas = personasQueCoinciden_(db, ind.persona, false);
    if (!fichas.length) { ctx.r.avisos.push('Inducción: no se encontró a "' + ind.persona + '" en Personas.'); return; }
    fichas.forEach((p) => cargarInduccionDe_(ctx, p, ind));
  });
}
// Los cinco ítems de la inducción SGC del FO-PRO-02-02 (los mismos que
// siembra personasSgc.js al crear una ficha).
function cargarInduccionDe_(ctx, p, ind) {
  const db = ctx.db;
  const relator = ind.relator ? emailDe_(ctx, ind.relator, 'relator de inducción') : '';
  const suyas = leer_(db, 'SGC_INDUCCIONES').filter((i) => i.persona_id === p.persona_id);
  let n = 0;
  if (!suyas.length) {
    ['Organigrama', 'Política de Calidad', 'Objetivos de Calidad', 'Descriptor de cargo', 'Inducción ISO 9001'].forEach((item) => {
      agregarFila_(db, 'SGC_INDUCCIONES', {
        induccion_id: uuid_(), persona_id: p.persona_id, item, fecha: isoDe_(ind.fecha), relator_email: relator,
        estado: 'COMPLETADA', observaciones: ind.observaciones || ''
      });
      n++;
    });
  } else {
    suyas.filter((i) => i.estado !== 'COMPLETADA').forEach((i) => {
      actualizarFilaPorId_(db, 'SGC_INDUCCIONES', 'induccion_id', i.induccion_id, {
        estado: 'COMPLETADA', fecha: isoDe_(ind.fecha), relator_email: relator, observaciones: ind.observaciones || i.observaciones || ''
      });
      n++;
    });
  }
  if (n) { ctx.r.conteo.inducciones += n; ctx.r.hechos.push('Inducción SGC de ' + p.nombre + ' registrada (' + String(ind.fecha).slice(0, 10) + ').'); }
}

function cargarCapacitaciones_(ctx, lista) {
  const db = ctx.db;
  (lista || []).forEach((c) => {
    const clave = norm_(c.clave || c.nombre);
    let cap = leer_(db, 'SGC_CAPACITACIONES').find((x) => esActivo_(x) && norm_(x.nombre).indexOf(clave) !== -1);
    if (!cap) {
      cap = {
        capacitacion_id: uuid_(), nombre: c.nombre, descripcion: c.descripcion || '', horas: Number(c.horas),
        fecha_programada: c.fecha_programada ? isoDe_(c.fecha_programada) : '', fecha_realizada: '', relator: c.relator || '',
        estado: 'PROGRAMADA', creado_por: normalizarEmail_(ctx.usuario.email), fecha_creacion: ahoraIso_(), activa: true
      };
      if (!(cap.horas > 0)) throw new Error('Capacitación sin horas: ' + c.nombre);
      agregarFila_(db, 'SGC_CAPACITACIONES', cap);
      ctx.r.conteo.capacitaciones++;
      ctx.r.hechos.push('Capacitación programada: ' + c.nombre + ' (' + c.horas + ' h).');
    }
    if (c.realizada && cap.estado !== 'REALIZADA') {
      const fecha = isoDe_(c.realizada.fecha);
      const cambios = { estado: 'REALIZADA', fecha_realizada: fecha };
      if (c.realizada.relator) cambios.relator = c.realizada.relator;
      if (c.realizada.descripcion) cambios.descripcion = c.realizada.descripcion;
      actualizarFilaPorId_(db, 'SGC_CAPACITACIONES', 'capacitacion_id', cap.capacitacion_id, cambios);
      const previos = leer_(db, 'SGC_CAPACITACION_ASISTENTES').filter((x) => x.capacitacion_id === cap.capacitacion_id);
      (c.realizada.asistentes || []).forEach((nombre) => {
        const p = ctx.persona(nombre);
        if (!p) { ctx.r.avisos.push('Capacitación "' + c.nombre + '": no se encontró a ' + nombre + '.'); return; }
        const previo = previos.find((x) => x.persona_id === p.persona_id);
        if (previo) actualizarFilaPorId_(db, 'SGC_CAPACITACION_ASISTENTES', 'asistencia_id', previo.asistencia_id, { asistio: true, fecha });
        else agregarFila_(db, 'SGC_CAPACITACION_ASISTENTES', { asistencia_id: uuid_(), capacitacion_id: cap.capacitacion_id, persona_id: p.persona_id, asistio: true, fecha, eficacia_fecha: '', eficacia_resultado: '', eficacia_observaciones: '' });
      });
      ctx.r.hechos.push('Capacitación realizada: ' + cap.nombre + ' (' + String(c.realizada.fecha).slice(0, 10) + ').');
    }
  });
}

// ============================================================================
// 8) Procesos (§4.4/§8.1): nombres limpios, servicio faltante, responsables
// ============================================================================
function cargarProcesos_(ctx, datos) {
  if (!datos) return;
  const db = ctx.db;
  const procesos = () => leer_(db, 'SGC_PROCESOS').filter(esActivo_);
  (datos.renombrar || []).forEach((x) => {
    const p = procesos().find((y) => y.codigo === x.codigo);
    if (!p) { ctx.r.avisos.push('Proceso ' + x.codigo + ' no existe: no se renombró.'); return; }
    if (p.nombre !== x.nombre) { actualizarFilaPorId_(db, 'SGC_PROCESOS', 'proceso_id', p.proceso_id, { nombre: x.nombre }); ctx.r.conteo.procesos_renombrados++; }
  });
  (datos.nuevos || []).forEach((x) => {
    if (procesos().some((y) => y.codigo === x.codigo || norm_(y.nombre) === norm_(x.nombre))) { ctx.r.omitidos.push('Proceso ya existente: ' + x.codigo); return; }
    const hermano = procesos().find((y) => y.codigo === x.como);
    if (!hermano) throw new Error('Proceso de referencia ' + x.como + ' no existe.');
    const ahora = ahoraIso_();
    const nuevo = {};
    COLUMNAS.SGC_PROCESOS.forEach((k) => { nuevo[k] = hermano[k] === undefined ? '' : hermano[k]; });
    Object.assign(nuevo, {
      proceso_id: x.codigo, codigo: x.codigo, nombre: x.nombre, objetivo: x.objetivo || '', observaciones: x.observaciones || '',
      creado_por: normalizarEmail_(ctx.usuario.email), fecha_creacion: ahora, fecha_ultima_revision: ahora.slice(0, 10), revisado_por: normalizarEmail_(ctx.usuario.email), activa: true
    });
    agregarFila_(db, 'SGC_PROCESOS', nuevo);
    (x.pasos || []).forEach((paso, i) => {
      agregarFila_(db, 'SGC_PROCESO_PASOS', {
        paso_id: x.codigo + '-P' + (i + 1), proceso_id: x.codigo, numero: i + 1, nombre: paso.nombre, responsable: paso.responsable || '',
        input: paso.input || '', actividades: paso.actividades || '', evidencias: paso.evidencias || '', output: paso.output || '',
        observaciones: '', creado_por: normalizarEmail_(ctx.usuario.email), fecha_creacion: ahora, activa: true
      });
    });
    ctx.r.conteo.procesos_nuevos++;
    ctx.r.hechos.push('Procesos: nuevo servicio ' + x.codigo + ' ' + x.nombre + ' (' + (x.pasos || []).length + ' pasos).');
  });
  (datos.responsables || []).forEach((x) => {
    const p = procesos().find((y) => y.codigo === x.codigo);
    if (!p) { ctx.r.avisos.push('Proceso ' + x.codigo + ' no existe.'); return; }
    if (String(p.responsable_email || '').trim()) return;
    const email = emailDe_(ctx, x.responsable, 'responsable del proceso ' + x.codigo);
    actualizarFilaPorId_(db, 'SGC_PROCESOS', 'proceso_id', p.proceso_id, { responsable_email: email });
    ctx.r.conteo.procesos_con_responsable++;
  });
}

// ============================================================================
// 9) Prestaciones (§8.5): casos reales con su cadena de evidencia
// ============================================================================
function buscarCliente_(db, cand) {
  const clientes = leer_(db, 'CAT_CLIENTES');
  const rut = String(cand.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (rut) {
    const porRut = clientes.find((c) => String(c.rut || '').replace(/[^0-9kK]/g, '').toUpperCase() === rut);
    if (porRut) return porRut;
  }
  const nombres = (cand.nombres || []).map(norm_).map((s) => s.replace(/\bspa\b|\bltda\b|\bsa\b/g, '').replace(/\s+/g, ' ').trim());
  return clientes.find((c) => {
    const rs = norm_(c.razon_social).replace(/\bspa\b|\bltda\b|\bsa\b/g, '').replace(/\s+/g, ' ').trim();
    return nombres.some((n) => n && (rs === n || rs.indexOf(n) === 0));
  }) || null;
}
function cargarPrestaciones_(ctx, lista) {
  const db = ctx.db;
  (lista || []).forEach((x) => {
    const cliente = buscarCliente_(db, x.cliente);
    if (!cliente) { ctx.r.avisos.push('Prestación ' + x.registro + ': el cliente "' + x.cliente.nombres[0] + '" no está en el catálogo de clientes: no se registró.'); return; }
    const proceso = leer_(db, 'SGC_PROCESOS').find((p) => esActivo_(p) && p.codigo === x.proceso_codigo && p.nivel === 'SERVICIO');
    if (!proceso) { ctx.r.avisos.push('Prestación ' + x.registro + ': no existe el servicio ' + x.proceso_codigo + '.'); return; }
    const ya = leer_(db, 'SGC_PRESTACIONES').find((p) => esActivo_(p) && p.cliente_id === cliente.cliente_id && p.proceso_id === proceso.proceso_id &&
      String(p.periodo || '') === String(x.periodo || '') && String(p.fecha_prestacion || '') === x.fecha);
    if (ya) { ctx.r.omitidos.push('Prestación ' + x.registro + ' ya registrada.'); return; }
    agregarFila_(db, 'SGC_PRESTACIONES', {
      prestacion_id: uuid_(), cliente_id: cliente.cliente_id, cliente_nombre: cliente.razon_social || '',
      proceso_id: proceso.proceso_id, proceso_codigo: proceso.codigo || '', proceso_nombre: proceso.nombre || '',
      periodo: x.periodo || '', fecha_prestacion: x.fecha, responsable_email: emailDe_(ctx, x.responsable, 'prestación ' + x.registro),
      estado: 'PRESTADO', evidencia: x.evidencia || '', liberado_por: '', fecha_liberacion: '', nc_id: '',
      observaciones: x.observaciones || '', creado_por: normalizarEmail_(ctx.usuario.email), fecha_creacion: ahoraIso_(), activa: true
    });
    ctx.r.conteo.prestaciones++;
    ctx.r.hechos.push('Servicio prestado: ' + proceso.codigo + ' → ' + cliente.razon_social + (x.periodo ? ' (' + x.periodo + ')' : '') + '.');
  });
}

// ============================================================================
// API
// ============================================================================
function resumenCobertura_(db) {
  const m = Matriz.matrizCalculada_(db);
  const porClausula = {};
  m.clausulas.forEach((c) => { porClausula[c.codigo] = c.estado; });
  return {
    pct: m.resumen.pct_listo, completo: m.resumen.completo, parcial: m.resumen.parcial,
    faltante: m.resumen.faltante, no_aplica: m.resumen.no_aplica, por_clausula: porClausula
  };
}

/**
 * data: { paquete: {...}, simular?: boolean }
 * Solo la cuenta super administrador: es una carga masiva que escribe con
 * fechas históricas, no una operación del día a día.
 */
function importar(db, data, contexto) {
  if (!contexto || contexto.super_admin !== true) {
    return { _forbidden: true, message: 'Solo la cuenta de super administrador puede ejecutar la carga del SGC desde Drive.' };
  }
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Hace falta gobernar el SGC para cargar su información.' };
  const paquete = data && data.paquete;
  if (!paquete || typeof paquete !== 'object') return { _validationError: true, campo: 'paquete', message: 'Falta el paquete de datos.' };
  const simular = data.simular === true;

  const r = {
    simulacion: simular, hechos: [], omitidos: [], avisos: [],
    conteo: {
      documentos_actualizados: 0, documentos_escritos: 0, versiones: 0, factores: 0, riesgos: 0, lecturas: 0,
      auditorias: 0, hallazgos: 0, nc: 0, acuerdos: 0, tareas: 0, inducciones: 0, capacitaciones: 0,
      procesos_renombrados: 0, procesos_nuevos: 0, procesos_con_responsable: 0, prestaciones: 0, desvinculadas: 0
    }
  };
  const ctx = { db, usuario: contexto, r, persona: null };

  db.exec('BEGIN');
  try {
    r.cobertura_antes = resumenCobertura_(db);
    desvincularPersonas_(ctx, paquete.desvinculaciones);
    ctx.persona = resolverPersonas_(db);
    cargarDocumentos_(ctx, paquete.documentos);
    cargarContexto_(ctx, paquete.contexto);
    cargarRiesgos_(ctx, paquete.riesgos);
    cargarObjetivos_(ctx, paquete.objetivos);
    cargarProcesos_(ctx, paquete.procesos);
    cargarAuditorias_(ctx, paquete.auditorias);
    cargarRevision_(ctx, paquete.revision);
    cargarInducciones_(ctx, paquete.inducciones);
    cargarCapacitaciones_(ctx, paquete.capacitaciones);
    cargarPrestaciones_(ctx, paquete.prestaciones);
    r.cobertura_despues = resumenCobertura_(db);
    if (simular) {
      db.exec('ROLLBACK');
    } else {
      registrarLog_(db, 'SGC_CARGA_DRIVE', 'Carga desde Drive: ' + JSON.stringify(r.conteo), contexto);
      db.exec('COMMIT');
    }
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (e) { /* ya revertida */ }
    return { _validationError: true, campo: 'paquete', message: 'La carga se detuvo y no se guardó nada: ' + err.message };
  }
  return r;
}

module.exports = { importar, periodoQueContiene_, norm_ };
