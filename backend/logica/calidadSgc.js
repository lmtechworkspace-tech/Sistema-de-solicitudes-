'use strict';

/**
 * calidadSgc.js — puerto de backend/backoffice/Calidad.gs (SGC ISO 9001,
 * Fase 1 + Fase 1b): repositorio documental controlado + roles/accesos del
 * SGC + acuse de recibo. Primer incremento del "monstruo" de la migración
 * (~123 acciones / 32 hojas, portado por fases igual que el propio .gs).
 *
 * Patron de permisos (igual que Proyectos/Actividades/Novedades): el modulo
 * 'calidad' es el gate GRUESO (a nivel de router); el rol DENTRO del SGC
 * (SGC_ROLES) es el gate FINO. No se crean roles globales nuevos.
 *
 * Regla ISO reflejada en el codigo: un documento OBSOLETO no se borra
 * (trazabilidad) pero se retira de circulacion -- solo lo ve quien gobierna
 * el SGC. Nadie del personal debe toparse por accidente con una version que
 * ya no rige (PRO-01 §4.3).
 *
 * Archivos: desde 2026-09-18 usan almacenamiento.js (Cloudflare R2), mismo
 * criterio que Novedades (primer módulo desgateado). subirArchivoSgc_ sube
 * el archivo bajo una clave única por subida (codigo + uuid, nunca
 * reutilizada -- una versión anterior no se puede pisar sin querer, ISO
 * exige poder demostrar qué versión regía en qué fecha) y descargarDocumento
 * lo sirve real. Toda la lógica de negocio (permisos, versionado, acuse,
 * roles) ya estaba completa y probada, solo esperaba almacenamiento real.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { CLAUSULAS_ISO9001 } = require('./sgcCatalogo');
const { directorioPersonalActivo_ } = require('./directorioPersonal');
const Portal = require('./portal');
const Jefatura = require('./jefatura');
const Notificaciones = require('./notificaciones');
const NotificacionesApp = require('./notificacionesApp');
const Almacenamiento = require('./almacenamiento');

const TIPOS_DOC_SGC = ['DOC', 'PRO', 'INS', 'FO', 'EXTERNO'];
const VISIBILIDAD_SGC = ['TODOS', 'AREA', 'SELECCION'];
const TIPO_DOC_SGC_TEXTO = {
  DOC: 'documento maestro manual', PRO: 'procedimiento', INS: 'instructivo',
  FO: 'formulario registro', EXTERNO: 'documento externo norma ley reglamento decreto'
};
const ROLES_SGC = ['ENCARGADO_SGC', 'DIRECCION', 'GERENCIA_ADM', 'JEFATURA_AREA', 'ENC_ADMIN', 'OPERATIVO', 'AUDITOR_EXTERNO'];
const ROLES_SGC_LECTURA_TOTAL = ['ENCARGADO_SGC', 'DIRECCION', 'GERENCIA_ADM', 'AUDITOR_EXTERNO'];
const ROLES_SGC_GESTION = ['ENCARGADO_SGC'];

function uuid_() { return crypto.randomUUID(); }
function errorValidacion_(campo, mensaje) { return { _validationError: true, campo, message: mensaje }; }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function esActivo_(fila) { return esVerdadero_(fila.activa); }
function esVerdaderoActivo_(fila) { return esVerdadero_(fila.activo); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leerSeguro_(db, hoja) { try { return leer_(db, hoja); } catch (err) { return []; } }

const DIACRITICOS_SGC = /[̀-ͯ]/g;
function normalizarTexto_(texto) {
  let s = String(texto == null ? '' : texto).toLowerCase();
  if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(DIACRITICOS_SGC, '');
  return s;
}

function clausulasIsoValidas_(valor) {
  const lista = Array.isArray(valor) ? valor : [];
  const codigos = CLAUSULAS_ISO9001.map((c) => c.codigo);
  const vistos = {};
  return lista.map((c) => String(c || '').trim())
    .filter((c) => c && codigos.indexOf(c) !== -1 && !vistos[c] && (vistos[c] = true));
}
function parsearClausulasIso_(valor) {
  if (!valor) return [];
  try { const lista = JSON.parse(valor); return Array.isArray(lista) ? lista : []; } catch (err) { return []; }
}
function enlacesValidos_(valor) {
  const lista = Array.isArray(valor) ? valor : [];
  const vistos = {};
  const limpios = [];
  lista.forEach((e) => {
    if (!e) return;
    const url = String((typeof e === 'string' ? e : e.url) || '').trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return;
    if (vistos[url]) return;
    vistos[url] = true;
    const titulo = String((typeof e === 'string' ? '' : e.titulo) || '').trim();
    limpios.push({ titulo: titulo.slice(0, 120), url: url.slice(0, 2000) });
  });
  return limpios.slice(0, 20);
}
function parsearEnlaces_(valor) {
  if (!valor) return [];
  try { return enlacesValidos_(JSON.parse(valor)); } catch (err) { return []; }
}

// --- permisos ---------------------------------------------------------------

// Rol dentro del SGC. Sin fila en SGC_ROLES la persona es OPERATIVO. Un
// AUDITOR_EXTERNO con vigencia_hasta pasada deja de tener rol solo.
function rolSgc_(db, contexto) {
  const email = normalizarEmail_(contexto && contexto.email);
  if (!email) return '';
  const fila = leerSeguro_(db, 'SGC_ROLES').find((r) => normalizarEmail_(r.usuario_email) === email && esVerdaderoActivo_(r));
  if (!fila) return '';
  if (fila.vigencia_hasta) {
    const hasta = new Date(fila.vigencia_hasta);
    if (!isNaN(hasta.getTime()) && hasta < new Date()) return '';
  }
  return fila.rol_sgc || '';
}
function areaSgc_(db, contexto) {
  const email = normalizarEmail_(contexto && contexto.email);
  if (!email) return '';
  const fila = leerSeguro_(db, 'SGC_ROLES').find((r) => normalizarEmail_(r.usuario_email) === email && esVerdaderoActivo_(r));
  return fila ? (fila.area_id || '') : '';
}
// Gestion (cargar/editar/versionar documentos): ENCARGADO_SGC o ADM de SIGSO.
function gobiernaSgc_(db, contexto) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM') return true;
  return ROLES_SGC_GESTION.indexOf(rolSgc_(db, contexto)) !== -1;
}
// Gate ESTRICTO: solo el administrador de SIGSO. Repartir accesos es mas
// sensible que gestionar contenido -- ni un ENCARGADO_SGC puede hacerlo.
function esAdminSgc_(contexto) { return !!contexto && contexto.rol === 'ADM'; }
// Lectura total (incluye obsoletos): quien gobierna, mas Direccion, Gerencia
// y el auditor externo vigente. GERENCIA de SIGSO igual, mismo criterio de
// solo-lectura transversal que el resto del sistema.
function veTodoSgc_(db, contexto, rol, gobierna) {
  if (gobierna) return true;
  if (contexto && contexto.rol === 'GERENCIA') return true;
  return ROLES_SGC_LECTURA_TOTAL.indexOf(rol) !== -1;
}

function seccionesVisiblesSgc_(db, contexto) {
  const rol = rolSgc_(db, contexto);
  const gobierna = gobiernaSgc_(db, contexto);
  const veTodo = veTodoSgc_(db, contexto, rol, gobierna);
  const esAdmin = esAdminSgc_(contexto);
  const email = normalizarEmail_(contexto && contexto.email);
  function tieneAlgunaAsignada_(hoja, campos) {
    if (veTodo) return true;
    if (!email) return false;
    return leerSeguro_(db, hoja).some((fila) => esVerdadero_(fila.activa) && campos.some((c) => normalizarEmail_(fila[c]) === email));
  }
  return {
    documentos: true, personas: true, alcance: true, contexto: true,
    riesgos: veTodo, procesos: true, tablero: veTodo, indicadores: veTodo, servicios: veTodo,
    nc: tieneAlgunaAsignada_('SGC_NC', ['responsable_email', 'detectada_por']),
    auditorias: tieneAlgunaAsignada_('SGC_AUDITORIAS', ['auditor_email']),
    quejas: veTodo, capacitaciones: veTodo, proveedores: veTodo, revision: veTodo,
    objetivos: veTodo, cobertura: veTodo, accesos: esAdmin
  };
}

function catalogoRolesSgc_() {
  return [
    { clave: 'OPERATIVO', etiqueta: 'Personal operativo', descripcion: 'Los documentos de acceso general y los de su área, su propia ficha, y solo las NC/auditorías donde figura. Nada más.' },
    { clave: 'JEFATURA_AREA', etiqueta: 'Jefatura de área', descripcion: 'Lo del personal operativo y, además, las fichas de su equipo.' },
    { clave: 'ENC_ADMIN', etiqueta: 'Encargada de Administración', descripcion: 'Personal operativo con foco administrativo (sin lectura total del SGC).' },
    { clave: 'ENCARGADO_SGC', etiqueta: 'Encargado del SGC', descripcion: 'Gestiona todo el contenido del SGC (documentos, personas, NC, auditorías…). NO reparte accesos: eso es exclusivo del administrador.' },
    { clave: 'DIRECCION', etiqueta: 'Dirección', descripcion: 'Lectura total del SGC, incluidos documentos obsoletos. No gestiona.' },
    { clave: 'GERENCIA_ADM', etiqueta: 'Gerencia / Administración', descripcion: 'Lectura total del SGC. No gestiona.' },
    { clave: 'AUDITOR_EXTERNO', etiqueta: 'Auditor externo', descripcion: 'Lectura total temporal (con fecha de vencimiento). No forma parte del personal ni acusa documentos.' }
  ];
}

// Rol REAL de la cuenta SIGSO (no el rol del SGC) -- para advertir cuando una
// cuenta ademas tiene ADM/GERENCIA, que ya le da lectura total por su cuenta.
function rolCuentaSigsoPorEmail_(db, email) {
  const norm = normalizarEmail_(email);
  if (!norm) return '';
  const usuario = leerSeguro_(db, 'USUARIOS').find((r) => normalizarEmail_(r.email) === norm && esVerdaderoActivo_(r));
  if (usuario) return usuario.rol || '';
  const cuenta = leerSeguro_(db, 'CUENTAS_PORTAL').find((c) =>
    esVerdaderoActivo_(c) && Portal.parsearListaPortal(c.emails).map(normalizarEmail_).indexOf(norm) !== -1);
  return cuenta ? (cuenta.rol || '') : '';
}

function puedeVerDocumento_(db, doc, contexto, rol, area, gobierna, destinatarios) {
  if (veTodoSgc_(db, contexto, rol, gobierna)) return true;
  if (doc.estado === 'OBSOLETO') return false;
  if (doc.visibilidad === 'TODOS') return true;
  if (doc.visibilidad === 'AREA') return !!area && String(doc.area_id || '') === String(area);
  if (doc.visibilidad === 'SELECCION') {
    const email = normalizarEmail_(contexto && contexto.email);
    return (destinatarios || []).some((d) => d.documento_id === doc.documento_id && normalizarEmail_(d.usuario_email) === email);
  }
  return false;
}

// --- audiencia obligada a acusar (Fase 1b) ----------------------------------
function audienciaDocumentoSgc_(db, doc) {
  const creador = normalizarEmail_(doc.creado_por);
  if (doc.visibilidad === 'SELECCION') {
    return leerSeguro_(db, 'SGC_DOC_DESTINATARIOS')
      .filter((d) => d.documento_id === doc.documento_id)
      .map((d) => normalizarEmail_(d.usuario_email))
      .filter((e) => e && e !== creador);
  }
  const vistos = {};
  return leerSeguro_(db, 'SGC_ROLES')
    .filter((r) => esVerdaderoActivo_(r) && r.rol_sgc !== 'AUDITOR_EXTERNO' &&
      (doc.visibilidad === 'AREA' ? String(r.area_id || '') === String(doc.area_id || '') : true))
    .map((r) => normalizarEmail_(r.usuario_email))
    .filter((e) => { if (!e || e === creador || vistos[e]) return false; vistos[e] = true; return true; });
}
function documentosPendientesDeAcuse_(db, email, docs, acuses) {
  const normalizado = normalizarEmail_(email);
  const yaAcuso = {};
  (acuses || []).forEach((a) => { if (normalizarEmail_(a.usuario_email) === normalizado) yaAcuso[a.documento_id + '|' + a.version] = true; });
  return (docs || []).filter((d) => {
    if (!esActivo_(d) || d.estado !== 'VIGENTE' || !esVerdadero_(d.requiere_acuse)) return false;
    if (yaAcuso[d.documento_id + '|' + d.version_vigente]) return false;
    return audienciaDocumentoSgc_(db, d).indexOf(normalizado) !== -1;
  });
}

// --- helpers -----------------------------------------------------------------
function buscarDocumentoSgc_(db, documentoId) {
  if (!documentoId) return null;
  return leerSeguro_(db, 'SGC_DOCUMENTOS').find((d) => d.documento_id === documentoId && esActivo_(d)) || null;
}
function proximaRevision_(fechaVigencia) {
  const f = new Date(fechaVigencia);
  if (isNaN(f.getTime())) return '';
  const proxima = new Date(f.getTime());
  proxima.setFullYear(proxima.getFullYear() + 1);
  return proxima.toISOString();
}
function esRevisionVencida_(proximaRevision, ahora) {
  if (!proximaRevision) return false;
  const f = new Date(proximaRevision);
  return !isNaN(f.getTime()) && f < (ahora || new Date());
}
function diasHasta_(fecha, ahora) {
  if (!fecha) return null;
  const f = new Date(fecha);
  if (isNaN(f.getTime())) return null;
  return Math.round((f - (ahora || new Date())) / 86400000);
}

// Firmas de archivo aceptadas: PDF, DOCX/XLSX/PPTX (ZIP) y DOC/XLS legado
// (OLE). Se valida por BYTES, no por la extensión del nombre -- la escribe
// el usuario y se puede equivocar (o mentir).
const MAX_ARCHIVO_SGC_BYTES = 10 * 1024 * 1024;
const FIRMA_PDF_SGC = Buffer.from([0x25, 0x50, 0x44, 0x46]);
const FIRMA_ZIP_SGC = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
const FIRMA_OLE_SGC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0]);
function coincideFirmaSgc_(bytes, firma) {
  return bytes.length >= firma.length && bytes.subarray(0, firma.length).equals(firma);
}
// El tipo real lo decide la FIRMA del archivo; la extensión solo desempata
// entre docx/xlsx/pptx (y doc/xls legado), que comparten firma contenedora.
function mimeArchivoSgc_(bytes, nombre) {
  const ext = String(nombre || '').toLowerCase().split('.').pop();
  if (coincideFirmaSgc_(bytes, FIRMA_PDF_SGC)) return 'application/pdf';
  if (coincideFirmaSgc_(bytes, FIRMA_ZIP_SGC)) {
    if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    return '';
  }
  if (coincideFirmaSgc_(bytes, FIRMA_OLE_SGC)) {
    if (ext === 'doc') return 'application/msword';
    if (ext === 'xls') return 'application/vnd.ms-excel';
    return '';
  }
  return '';
}

async function subirArchivoSgc_(data, codigo) {
  if (!data.nombre_archivo) return errorValidacion_('nombre_archivo', 'Falta el nombre del archivo.');
  let bytes;
  try {
    bytes = Buffer.from(data.contenido_base64, 'base64');
  } catch (err) {
    return errorValidacion_('contenido_base64', 'El archivo no es base64 válido.');
  }
  if (!bytes.length) return errorValidacion_('contenido_base64', 'El archivo está vacío.');
  if (bytes.length > MAX_ARCHIVO_SGC_BYTES) {
    return errorValidacion_('contenido_base64', 'El archivo supera el tamaño máximo (' + Math.round(MAX_ARCHIVO_SGC_BYTES / (1024 * 1024)) + ' MB).');
  }
  const mime = mimeArchivoSgc_(bytes, data.nombre_archivo);
  if (!mime) return errorValidacion_('contenido_base64', 'Formato no admitido. Se aceptan PDF, Word (.docx/.doc) y Excel (.xlsx/.xls).');

  // Clave única por subida (nunca el mismo código+nombre dos veces): una
  // versión anterior sigue siendo recuperable por su propio archivo_id
  // aunque se suba una nueva con el mismo nombre de archivo.
  const clave = 'sgc/documentos/' + (codigo || 'sin-codigo') + '/' + uuid_() + '/' + data.nombre_archivo;
  const subida = await Almacenamiento.subirArchivo_(clave, data.contenido_base64, mime);
  if (!subida.ok) return errorValidacion_('contenido_base64', subida.message);
  return { archivo_id: clave, archivo_nombre: data.nombre_archivo, archivo_mime: mime };
}

function registrarVersionSgc_(db, documentoId, version, cambios, archivo, contexto, vigente) {
  const fila = {
    version_id: uuid_(), documento_id: documentoId, version, cambios: cambios || '',
    archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre, archivo_mime: archivo.archivo_mime,
    subido_por: (contexto && contexto.email) || '', fecha: new Date().toISOString(), vigente: !!vigente
  };
  agregarFila_(db, 'SGC_DOC_VERSIONES', fila);
  return fila;
}
function guardarDestinatariosSgc_(db, documentoId, visibilidad, destinatarios) {
  const actuales = leerSeguro_(db, 'SGC_DOC_DESTINATARIOS').filter((d) => d.documento_id === documentoId);
  const deseados = {};
  if (visibilidad === 'SELECCION') {
    (destinatarios || []).forEach((email) => { const n = normalizarEmail_(email); if (n) deseados[n] = true; });
  }
  actuales.forEach((d) => {
    const email = normalizarEmail_(d.usuario_email);
    if (deseados[email]) delete deseados[email];
    else actualizarFilaPorId_(db, 'SGC_DOC_DESTINATARIOS', 'destinatario_id', d.destinatario_id, { documento_id: '' });
  });
  Object.keys(deseados).forEach((email) => {
    agregarFila_(db, 'SGC_DOC_DESTINATARIOS', { destinatario_id: uuid_(), documento_id: documentoId, usuario_email: email });
  });
}
function registrarLogSgc_(db, accion, detalle, contexto) {
  try {
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: uuid_(), timestamp: new Date().toISOString(), contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle, ref: 'SGC'
    });
  } catch (err) { /* trazabilidad, no el flujo principal */ }
}

// ===========================================================================
// API publica
// ===========================================================================

function listarDocumentos(db, data, contexto) {
  const filtros = data || {};
  let visibles0 = leerSeguro_(db, 'SGC_DOCUMENTOS').filter(esActivo_);
  const destinatarios = leerSeguro_(db, 'SGC_DOC_DESTINATARIOS');
  const rol = rolSgc_(db, contexto);
  const area = areaSgc_(db, contexto);
  const gobierna = gobiernaSgc_(db, contexto);

  let visibles = visibles0.filter((d) => puedeVerDocumento_(db, d, contexto, rol, area, gobierna, destinatarios));

  const resumen = {
    total: visibles.length,
    vigentes: visibles.filter((d) => d.estado === 'VIGENTE').length,
    obsoletos: visibles.filter((d) => d.estado === 'OBSOLETO').length
  };

  if (filtros.tipo) visibles = visibles.filter((d) => d.tipo === filtros.tipo);
  if (filtros.area_id) visibles = visibles.filter((d) => d.area_id === filtros.area_id);
  if (filtros.estado) visibles = visibles.filter((d) => d.estado === filtros.estado);
  if (filtros.busqueda) {
    const palabras = normalizarTexto_(filtros.busqueda).split(/\s+/).filter(Boolean);
    if (palabras.length) {
      visibles = visibles.filter((d) => {
        const heno = normalizarTexto_([d.codigo, d.nombre, d.descripcion, d.area_id, TIPO_DOC_SGC_TEXTO[d.tipo] || d.tipo].join(' '));
        return palabras.every((p) => heno.indexOf(p) !== -1);
      });
    }
  }

  const ahora = new Date();
  const acuses = leerSeguro_(db, 'SGC_DOC_ACUSES');
  const pendientesMios = {};
  documentosPendientesDeAcuse_(db, contexto.email, visibles, acuses).forEach((d) => { pendientesMios[d.documento_id] = true; });

  return {
    puede_gestionar: gobierna, rol_sgc: rol || 'OPERATIVO',
    secciones_visibles: seccionesVisiblesSgc_(db, contexto),
    pendientes_de_acuse: Object.keys(pendientesMios).length,
    resumen, catalogo_clausulas: CLAUSULAS_ISO9001,
    documentos: visibles.map((d) => ({
      documento_id: d.documento_id, codigo: d.codigo, nombre: d.nombre, descripcion: d.descripcion,
      tipo: d.tipo, area_id: d.area_id, version_vigente: d.version_vigente, estado: d.estado,
      visibilidad: d.visibilidad, fecha_vigencia: d.fecha_vigencia, proxima_revision: d.proxima_revision,
      elaborado_por: d.elaborado_por, revisado_por: d.revisado_por, aprobado_por: d.aprobado_por,
      archivo_nombre: d.archivo_nombre, archivo_mime: d.archivo_mime, tiene_archivo: !!d.archivo_id,
      revision_vencida: esRevisionVencida_(d.proxima_revision, ahora),
      dias_para_revision: diasHasta_(d.proxima_revision, ahora),
      requiere_acuse: esVerdadero_(d.requiere_acuse), fecha_limite_acuse: d.fecha_limite_acuse || '',
      debo_acusar: !!pendientesMios[d.documento_id],
      dias_para_acuse: d.fecha_limite_acuse ? diasHasta_(d.fecha_limite_acuse, ahora) : null,
      clausulas_iso: parsearClausulasIso_(d.clausulas_iso), enlaces_n: parsearEnlaces_(d.enlaces).length
    })).sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || '')))
  };
}

function getDocumento(db, data, contexto) {
  const doc = buscarDocumentoSgc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  const rol = rolSgc_(db, contexto);
  const gobierna = gobiernaSgc_(db, contexto);
  const destinatarios = leerSeguro_(db, 'SGC_DOC_DESTINATARIOS');
  if (!puedeVerDocumento_(db, doc, contexto, rol, areaSgc_(db, contexto), gobierna, destinatarios)) {
    return { _forbidden: true, message: 'No tienes acceso a este documento.' };
  }
  const versiones = leerSeguro_(db, 'SGC_DOC_VERSIONES').filter((v) => v.documento_id === doc.documento_id)
    .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  const acuses = leerSeguro_(db, 'SGC_DOC_ACUSES');
  const debeAcusar = documentosPendientesDeAcuse_(db, contexto.email, [doc], acuses).length > 0;
  const miAcuse = acuses.find((a) => a.documento_id === doc.documento_id && a.version === doc.version_vigente && normalizarEmail_(a.usuario_email) === normalizarEmail_(contexto.email));

  return {
    documento: Object.assign({}, doc, { clausulas_iso: parsearClausulasIso_(doc.clausulas_iso), enlaces: parsearEnlaces_(doc.enlaces) }),
    puede_gestionar: gobierna, puede_reemplazar_archivo: contexto.super_admin === true, catalogo_clausulas: CLAUSULAS_ISO9001,
    debo_acusar: debeAcusar, mi_acuse: miAcuse ? miAcuse.acusado_en : '',
    versiones,
    destinatarios: doc.visibilidad === 'SELECCION'
      ? destinatarios.filter((x) => x.documento_id === doc.documento_id).map((x) => x.usuario_email)
      : []
  };
}

const FECHA_REVISION_EXTERNOS_FO0101 = '2027-03-01';
const DOCUMENTOS_EXTERNOS_FO0101 = [
  { codigo: 'ISO 9001:2015', nombre: 'Sistemas de gestión de la calidad — Requisitos', clase_externa: 'Norma', emisor: 'ISO (Organización Internacional de Normalización)', area_id: 'CALIDAD', descripcion: 'Norma sobre la que se certifica el SGC. Edición 2015.' },
  { codigo: 'ISO 19011:2018', nombre: 'Directrices para la auditoría de los sistemas de gestión', clase_externa: 'Norma', emisor: 'ISO (Organización Internacional de Normalización)', area_id: 'CALIDAD', descripcion: 'Referencia metodológica para el programa de auditorías internas (PRO-03).' },
  { codigo: 'DS 44', nombre: 'Aprueba nuevo reglamento sobre gestión preventiva de los riesgos laborales para un entorno de trabajo seguro y saludable', clase_externa: 'Decreto', emisor: 'Ministerio del Trabajo y Previsión Social (Chile)', area_id: 'PREVENCION', descripcion: 'Vigente desde 2025.' },
  { codigo: 'Ley 16.744', nombre: 'Establece normas sobre accidentes del trabajo y enfermedades profesionales', clase_externa: 'Ley', emisor: 'Congreso Nacional de Chile', area_id: 'PREVENCION', descripcion: 'Vigente desde 1968.' },
  { codigo: 'DS 594', nombre: 'Aprueba reglamento sobre condiciones sanitarias y ambientales básicas en los lugares de trabajo', clase_externa: 'Decreto', emisor: 'Ministerio de Salud (Chile)', area_id: 'PREVENCION', descripcion: 'Vigente desde 2000.' },
  { codigo: 'Código del Trabajo', nombre: 'Derechos y obligaciones de los trabajadores', clase_externa: 'Código', emisor: 'Ministerio del Trabajo y Previsión Social (Chile)', area_id: 'RRHH', descripcion: 'Texto refundido vigente.' }
];

function sembrarDocumentosExternos(db, data, contexto) {
  if (!gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado del SGC puede cargar el listado de documentos externos.' };
  const existentes = leerSeguro_(db, 'SGC_DOCUMENTOS').filter(esActivo_);
  const porCodigo = {};
  existentes.forEach((d) => { porCodigo[String(d.codigo || '').toUpperCase()] = true; });
  const ahora = new Date().toISOString();
  let creados = 0;
  const omitidos = [];
  DOCUMENTOS_EXTERNOS_FO0101.forEach((e) => {
    if (porCodigo[e.codigo.toUpperCase()]) { omitidos.push(e.codigo); return; }
    agregarFila_(db, 'SGC_DOCUMENTOS', {
      documento_id: uuid_(), codigo: e.codigo, nombre: e.nombre, descripcion: e.descripcion || '',
      tipo: 'EXTERNO', area_id: e.area_id || '', version_vigente: '', estado: 'VIGENTE', visibilidad: 'SELECCION',
      fecha_vigencia: '', proxima_revision: FECHA_REVISION_EXTERNOS_FO0101,
      elaborado_por: '', revisado_por: '', aprobado_por: '', archivo_id: '', archivo_nombre: '', archivo_mime: '',
      creado_por: (contexto && contexto.email) || '', fecha_creacion: ahora, activa: true,
      requiere_acuse: false, fecha_limite_acuse: '', clausulas_iso: JSON.stringify([]),
      emisor: e.emisor || '', clase_externa: e.clase_externa || '', enlaces: JSON.stringify([])
    });
    creados++;
  });
  registrarLogSgc_(db, 'SGC_DOC_EXTERNOS_SEMBRADOS', creados + ' documentos externos del FO-PRO-01-01 cargados', contexto);
  return {
    ok: true, total: creados, omitidos,
    message: creados ? creados + ' documento(s) externo(s) cargado(s).' + (omitidos.length ? ' Ya existían: ' + omitidos.join(', ') + '.' : '') : 'Ya estaban todos cargados.'
  };
}

async function crearDocumento(db, data, contexto) {
  if (!gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden cargar documentos.' };
  const codigo = String(data.codigo || '').trim().toUpperCase();
  if (!codigo) return errorValidacion_('codigo', 'El código del documento es obligatorio.');
  const nombre = String(data.nombre || '').trim();
  if (!nombre) return errorValidacion_('nombre', 'El nombre del documento es obligatorio.');
  if (TIPOS_DOC_SGC.indexOf(data.tipo) === -1) return errorValidacion_('tipo', 'Tipo de documento inválido.');
  if (VISIBILIDAD_SGC.indexOf(data.visibilidad) === -1) return errorValidacion_('visibilidad', 'Visibilidad inválida.');
  const yaExiste = leerSeguro_(db, 'SGC_DOCUMENTOS').find((d) => esActivo_(d) && String(d.codigo || '').toUpperCase() === codigo);
  if (yaExiste) return errorValidacion_('codigo', 'Ya existe un documento con el código ' + codigo + '.');

  let archivo = { archivo_id: '', archivo_nombre: '', archivo_mime: '' };
  if (data.contenido_base64) {
    const subido = await subirArchivoSgc_(data, codigo);
    if (subido._validationError) return subido;
    archivo = subido;
    // Releer justo antes de escribir: el await de arriba (subida real a
    // R2) le dio tiempo a otra peticion con el MISMO codigo de correr
    // completa y ganar. Sin este chequeo, dos documentos podian quedar con
    // el mismo codigo -- la unicidad que este mismo chequeo intenta
    // garantizar, pero solo si se valida DESPUES del await tambien.
    const yaExisteFresco = leerSeguro_(db, 'SGC_DOCUMENTOS').find((d) => esActivo_(d) && String(d.codigo || '').toUpperCase() === codigo);
    if (yaExisteFresco) return errorValidacion_('codigo', 'Ya existe un documento con el código ' + codigo + '.');
  }

  const ahora = new Date();
  const version = String(data.version_vigente || 'v01').trim();
  const documento = {
    documento_id: uuid_(), codigo, nombre, descripcion: data.descripcion || '', tipo: data.tipo,
    area_id: data.area_id || '', version_vigente: version, estado: 'VIGENTE', visibilidad: data.visibilidad,
    fecha_vigencia: data.fecha_vigencia || ahora.toISOString(),
    proxima_revision: proximaRevision_(data.fecha_vigencia || ahora.toISOString()),
    elaborado_por: data.elaborado_por || '', revisado_por: data.revisado_por || '', aprobado_por: data.aprobado_por || '',
    archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre, archivo_mime: archivo.archivo_mime,
    creado_por: contexto.email || '', fecha_creacion: ahora.toISOString(), activa: true,
    requiere_acuse: data.requiere_acuse === false ? false : true, fecha_limite_acuse: data.fecha_limite_acuse || '',
    clausulas_iso: JSON.stringify(clausulasIsoValidas_(data.clausulas_iso)),
    emisor: String(data.emisor || '').trim(), clase_externa: String(data.clase_externa || '').trim(),
    enlaces: JSON.stringify(enlacesValidos_(data.enlaces))
  };
  agregarFila_(db, 'SGC_DOCUMENTOS', documento);
  if (archivo.archivo_id) registrarVersionSgc_(db, documento.documento_id, version, data.cambios || 'Carga inicial', archivo, contexto, true);
  guardarDestinatariosSgc_(db, documento.documento_id, data.visibilidad, data.destinatarios);
  registrarLogSgc_(db, 'SGC_DOC_CREADO', documento.codigo + ' ' + documento.nombre, contexto);
  return documento;
}

async function nuevaVersion(db, data, contexto) {
  const doc = buscarDocumentoSgc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  if (!gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden subir una nueva versión.' };
  const version = String(data.version || '').trim();
  if (!version) return errorValidacion_('version', 'Indica el número de la nueva versión (ej. v02).');
  if (version === doc.version_vigente) return errorValidacion_('version', 'Esa ya es la versión vigente.');
  if (!data.contenido_base64) return errorValidacion_('contenido_base64', 'Adjunta el archivo de la nueva versión.');
  const archivo = await subirArchivoSgc_(data, doc.codigo);
  if (archivo._validationError) return archivo;

  // Releer justo antes de escribir: el await de arriba (subida real a R2)
  // le dio tiempo a otra peticion de nuevaVersion sobre el MISMO documento
  // de correr completa y ganar. Sin este chequeo, dos versiones podian
  // quedar marcadas vigente:true a la vez.
  const docFresco = buscarDocumentoSgc_(db, doc.documento_id);
  if (!docFresco) return errorValidacion_('documento_id', 'Documento no encontrado.');
  if (version === docFresco.version_vigente) return errorValidacion_('version', 'Esa ya es la versión vigente (se publicó otra versión mientras se procesaba tu solicitud).');

  leerSeguro_(db, 'SGC_DOC_VERSIONES').forEach((v) => {
    if (v.documento_id === doc.documento_id && esVerdadero_(v.vigente)) actualizarFilaPorId_(db, 'SGC_DOC_VERSIONES', 'version_id', v.version_id, { vigente: false });
  });
  registrarVersionSgc_(db, doc.documento_id, version, data.cambios || '', archivo, contexto, true);
  const fechaVigencia = data.fecha_vigencia || new Date().toISOString();
  const actualizado = actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', doc.documento_id, {
    version_vigente: version, fecha_vigencia: fechaVigencia, proxima_revision: proximaRevision_(fechaVigencia),
    archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre, archivo_mime: archivo.archivo_mime, estado: 'VIGENTE'
  });
  registrarLogSgc_(db, 'SGC_DOC_NUEVA_VERSION', doc.codigo + ' → ' + version, contexto);
  return actualizado;
}

// Reemplazar el ARCHIVO de la version vigente sin crear una version nueva
// (pedido directo del super admin, 2026-09-21): la migracion del Sheets
// viejo cargo toda la info de SGC_DOCUMENTOS/SGC_DOC_VERSIONES pero nunca
// los PDF/Word reales (no estaban en el export). Subir esos archivos ahora
// via nuevaVersion() crearia versiones falsas (v02, v03...) para documentos
// que en realidad siguen siendo v01 -- exactamente lo que el usuario pidio
// evitar. Por eso este gate es MAS estricto que gobiernaSgc_ (que permite
// ENCARGADO_SGC ademas de ADM): solo la cuenta super_admin puede pisar el
// archivo de una version ya publicada, porque es la unica operacion del
// modulo que reescribe evidencia historica en vez de agregarla.
async function reemplazarArchivoVersionVigente(db, data, contexto) {
  if (!contexto || contexto.super_admin !== true) {
    return { _forbidden: true, message: 'Solo la cuenta de super administrador puede reemplazar el archivo de la versión vigente sin crear una versión nueva.' };
  }
  const doc = buscarDocumentoSgc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  if (!data.contenido_base64) return errorValidacion_('contenido_base64', 'Adjunta el archivo a cargar.');
  const versionVigente = leerSeguro_(db, 'SGC_DOC_VERSIONES')
    .find((v) => v.documento_id === doc.documento_id && esVerdadero_(v.vigente));
  if (!versionVigente) return errorValidacion_('documento_id', 'Este documento no tiene una versión vigente registrada en SGC_DOC_VERSIONES.');

  const archivo = await subirArchivoSgc_(data, doc.codigo);
  if (archivo._validationError) return archivo;

  actualizarFilaPorId_(db, 'SGC_DOC_VERSIONES', 'version_id', versionVigente.version_id, {
    archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre, archivo_mime: archivo.archivo_mime,
    subido_por: contexto.email || '', fecha: new Date().toISOString()
  });
  const actualizado = actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', doc.documento_id, {
    archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre, archivo_mime: archivo.archivo_mime
  });
  registrarLogSgc_(db, 'SGC_DOC_ARCHIVO_REEMPLAZADO', doc.codigo + ' — archivo de la versión ' + versionVigente.version + ' reemplazado (misma versión, no se creó una nueva)', contexto);
  return actualizado;
}

async function actualizarDocumento(db, data, contexto) {
  const doc = buscarDocumentoSgc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  if (!gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden editar documentos.' };
  const cambios = {};
  ['nombre', 'descripcion', 'area_id', 'elaborado_por', 'revisado_por', 'aprobado_por'].forEach((campo) => { if (data[campo] !== undefined) cambios[campo] = data[campo]; });
  if (data.tipo !== undefined) {
    if (TIPOS_DOC_SGC.indexOf(data.tipo) === -1) return errorValidacion_('tipo', 'Tipo de documento inválido.');
    cambios.tipo = data.tipo;
  }
  if (data.visibilidad !== undefined) {
    if (VISIBILIDAD_SGC.indexOf(data.visibilidad) === -1) return errorValidacion_('visibilidad', 'Visibilidad inválida.');
    cambios.visibilidad = data.visibilidad;
    guardarDestinatariosSgc_(db, doc.documento_id, data.visibilidad, data.destinatarios);
  }
  if (data.fecha_vigencia !== undefined && data.fecha_vigencia) {
    cambios.fecha_vigencia = data.fecha_vigencia;
    cambios.proxima_revision = proximaRevision_(data.fecha_vigencia);
  }
  if (data.requiere_acuse !== undefined) cambios.requiere_acuse = data.requiere_acuse === true;
  if (data.fecha_limite_acuse !== undefined) cambios.fecha_limite_acuse = data.fecha_limite_acuse || '';
  if (data.clausulas_iso !== undefined) cambios.clausulas_iso = JSON.stringify(clausulasIsoValidas_(data.clausulas_iso));
  if (data.enlaces !== undefined) cambios.enlaces = JSON.stringify(enlacesValidos_(data.enlaces));

  if (data.contenido_base64) {
    const yaConfirmada = leerSeguro_(db, 'SGC_DOC_ACUSES').find((a) => a.documento_id === doc.documento_id && String(a.version) === String(doc.version_vigente));
    if (yaConfirmada) {
      return errorValidacion_('contenido_base64', 'Alguien ya confirmó la versión ' + doc.version_vigente + ': su archivo es evidencia y no se reemplaza. Sube una versión nueva para dejar el cambio trazado.');
    }
    const archivoNuevo = await subirArchivoSgc_(data, doc.codigo);
    if (archivoNuevo._validationError) return archivoNuevo;
    cambios.archivo_id = archivoNuevo.archivo_id;
    cambios.archivo_nombre = archivoNuevo.archivo_nombre;
    cambios.archivo_mime = archivoNuevo.archivo_mime;
    sincronizarArchivoVersionSgc_(db, doc, archivoNuevo, contexto);
  }

  if (data.estado !== undefined) {
    if (['VIGENTE', 'OBSOLETO'].indexOf(data.estado) === -1) return errorValidacion_('estado', 'Estado inválido.');
    cambios.estado = data.estado;
  }
  const actualizado = actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', doc.documento_id, cambios);
  registrarLogSgc_(db, cambios.archivo_id ? 'SGC_DOC_ARCHIVO_ADJUNTADO' : 'SGC_DOC_EDITADO', doc.codigo + (cambios.archivo_id ? ' ' + doc.version_vigente : ''), contexto);
  return actualizado;
}
function sincronizarArchivoVersionSgc_(db, doc, archivo, contexto) {
  const fila = leerSeguro_(db, 'SGC_DOC_VERSIONES').find((v) => v.documento_id === doc.documento_id && String(v.version) === String(doc.version_vigente));
  if (!fila) return registrarVersionSgc_(db, doc.documento_id, doc.version_vigente, 'Archivo adjuntado a la versión vigente.', archivo, contexto, true);
  return actualizarFilaPorId_(db, 'SGC_DOC_VERSIONES', 'version_id', fila.version_id, {
    archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre, archivo_mime: archivo.archivo_mime,
    subido_por: (contexto && contexto.email) || '', fecha: new Date().toISOString(), vigente: true
  });
}

async function descargarDocumento(db, data, contexto) {
  const doc = buscarDocumentoSgc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  const rol = rolSgc_(db, contexto);
  const gobierna = gobiernaSgc_(db, contexto);
  const destinatarios = leerSeguro_(db, 'SGC_DOC_DESTINATARIOS');
  if (!puedeVerDocumento_(db, doc, contexto, rol, areaSgc_(db, contexto), gobierna, destinatarios)) {
    return { _forbidden: true, message: 'No tienes acceso a este documento.' };
  }
  // Se puede pedir una versión histórica concreta (solo quien gobierna el
  // SGC: para el personal, la versión anterior ya no rige).
  let archivoId = doc.archivo_id, nombre = doc.archivo_nombre, mime = doc.archivo_mime;
  if (data.version_id) {
    if (!gobierna) return { _forbidden: true, message: 'Solo el Encargado SGC puede descargar versiones anteriores.' };
    const v = leerSeguro_(db, 'SGC_DOC_VERSIONES').find((x) => x.version_id === data.version_id && x.documento_id === doc.documento_id);
    if (!v) return errorValidacion_('version_id', 'Versión no encontrada.');
    archivoId = v.archivo_id; nombre = v.archivo_nombre; mime = v.archivo_mime;
  }
  if (!archivoId) return errorValidacion_('documento_id', 'Este documento no tiene archivo cargado.');

  const descarga = await Almacenamiento.descargarArchivo_(archivoId);
  if (!descarga.ok) return errorValidacion_('documento_id', descarga.message);
  // §15.2 de la especificación pide log de descargas. Se registra la
  // DESCARGA (no cada visualización): es lo que el auditor pregunta, y
  // loguear cada lectura haría explotar LOG_SISTEMA.
  registrarLogSgc_(db, 'SGC_DOC_DESCARGADO', doc.codigo + ' ' + (nombre || ''), contexto);
  return {
    contenido_base64: descarga.contenido_base64,
    nombre_archivo: nombre || '',
    mime: mime || 'application/octet-stream'
  };
}

async function acusarDocumento(db, data, contexto) {
  const doc = buscarDocumentoSgc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  const rol = rolSgc_(db, contexto);
  const gobierna = gobiernaSgc_(db, contexto);
  const destinatarios = leerSeguro_(db, 'SGC_DOC_DESTINATARIOS');
  if (!puedeVerDocumento_(db, doc, contexto, rol, areaSgc_(db, contexto), gobierna, destinatarios)) {
    return { _forbidden: true, message: 'No tienes acceso a este documento.' };
  }
  if (!esVerdadero_(doc.requiere_acuse)) return errorValidacion_('documento_id', 'Este documento no exige confirmación de lectura.');
  const email = normalizarEmail_(contexto.email);
  const yaAcuso = leerSeguro_(db, 'SGC_DOC_ACUSES').find((a) => a.documento_id === doc.documento_id && a.version === doc.version_vigente && normalizarEmail_(a.usuario_email) === email);
  if (yaAcuso) return yaAcuso;
  const acuse = { acuse_id: uuid_(), documento_id: doc.documento_id, version: doc.version_vigente, usuario_email: email, acusado_en: new Date().toISOString() };
  agregarFila_(db, 'SGC_DOC_ACUSES', acuse);
  registrarLogSgc_(db, 'SGC_DOC_ACUSE', doc.codigo + ' ' + doc.version_vigente, contexto);
  return acuse;
}

function getCumplimiento(db, data, contexto) {
  const doc = buscarDocumentoSgc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  if (!gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden ver el cumplimiento.' };
  const obligados = audienciaDocumentoSgc_(db, doc);
  const acusaron = {};
  leerSeguro_(db, 'SGC_DOC_ACUSES').forEach((a) => { if (a.documento_id === doc.documento_id && a.version === doc.version_vigente) acusaron[normalizarEmail_(a.usuario_email)] = a.acusado_en; });
  return {
    documento_id: doc.documento_id, codigo: doc.codigo, version: doc.version_vigente,
    requiere_acuse: esVerdadero_(doc.requiere_acuse), fecha_limite_acuse: doc.fecha_limite_acuse || '',
    confirmados: obligados.filter((e) => !!acusaron[e]).map((e) => ({ usuario_email: e, acusado_en: acusaron[e] })),
    pendientes: obligados.filter((e) => !acusaron[e])
  };
}

// --- roles del SGC ------------------------------------------------------
function listarRoles(db, data, contexto) {
  if (!esAdminSgc_(contexto)) return { _forbidden: true, message: 'Solo el administrador del sistema puede ver los accesos del SGC.' };
  return leerSeguro_(db, 'SGC_ROLES').filter(esVerdaderoActivo_);
}
function gestionarRol(db, data, contexto) {
  if (!esAdminSgc_(contexto)) return { _forbidden: true, message: 'Solo el administrador del sistema puede asignar accesos del SGC.' };
  if (data.accion === 'quitar') {
    if (!data.rol_id) return errorValidacion_('rol_id', 'Falta indicar el rol.');
    return actualizarFilaPorId_(db, 'SGC_ROLES', 'rol_id', data.rol_id, { activo: false });
  }
  const email = normalizarEmail_(data.usuario_email);
  if (!email) return errorValidacion_('usuario_email', 'Falta el correo de la persona.');
  if (ROLES_SGC.indexOf(data.rol_sgc) === -1) return errorValidacion_('rol_sgc', 'Rol del SGC inválido.');
  const existente = leerSeguro_(db, 'SGC_ROLES').find((r) => normalizarEmail_(r.usuario_email) === email);
  if (existente) {
    return actualizarFilaPorId_(db, 'SGC_ROLES', 'rol_id', existente.rol_id, { rol_sgc: data.rol_sgc, area_id: data.area_id || '', vigencia_hasta: data.vigencia_hasta || '', activo: true });
  }
  const fila = { rol_id: uuid_(), usuario_email: email, rol_sgc: data.rol_sgc, area_id: data.area_id || '', vigencia_hasta: data.vigencia_hasta || '', activo: true, fecha_creacion: new Date().toISOString() };
  agregarFila_(db, 'SGC_ROLES', fila);
  registrarLogSgc_(db, 'SGC_ACCESO_ASIGNADO', data.rol_sgc + ' -> ' + email, contexto);
  return fila;
}

function listarAccesos(db, data, contexto) {
  if (!esAdminSgc_(contexto)) return { _forbidden: true, message: 'Solo el administrador del sistema puede administrar los accesos del SGC.' };
  const rolesPorEmail = {};
  leerSeguro_(db, 'SGC_ROLES').filter(esVerdaderoActivo_).forEach((r) => { rolesPorEmail[normalizarEmail_(r.usuario_email)] = r; });
  const cuentas = directorioPersonalActivo_(db).map((p) => {
    const r = rolesPorEmail[normalizarEmail_(p.email)];
    return { email: p.email, nombre: p.nombre, rol_sgc: r ? r.rol_sgc : '', area_id: r ? (r.area_id || '') : '', vigencia_hasta: r ? (r.vigencia_hasta || '') : '', rol_id: r ? r.rol_id : '' };
  }).sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));

  const emailsCuenta = {};
  cuentas.forEach((c) => { emailsCuenta[normalizarEmail_(c.email)] = true; });
  const personasSinCuenta = leerSeguro_(db, 'SGC_PERSONAS')
    .filter((p) => esActivo_(p) && p.estado !== 'DESVINCULADO' && p.usuario_email)
    .filter((p) => !emailsCuenta[normalizarEmail_(p.usuario_email)])
    .map((p) => ({ nombre: p.nombre, email: p.usuario_email }));
  const rolesSinCuenta = leerSeguro_(db, 'SGC_ROLES').filter(esVerdaderoActivo_)
    .filter((r) => !emailsCuenta[normalizarEmail_(r.usuario_email)])
    .map((r) => ({ email: r.usuario_email, rol_sgc: r.rol_sgc }));

  return {
    cuentas,
    areas: leerSeguro_(db, 'CAT_AREAS').filter(esVerdaderoActivo_).map((a) => ({ area_id: a.area_id, nombre: a.nombre })),
    roles: catalogoRolesSgc_(),
    enrolamiento: { personas_sin_cuenta: personasSinCuenta, roles_sin_cuenta: rolesSinCuenta }
  };
}

function previsualizarAcceso(db, data, contexto) {
  if (!esAdminSgc_(contexto)) return { _forbidden: true, message: 'Solo el administrador del sistema puede previsualizar accesos.' };
  const email = normalizarEmail_(data && data.email);
  if (!email) return errorValidacion_('email', 'Indica la cuenta a previsualizar.');

  const ctx = { email, rol: '' };
  const rol = rolSgc_(db, ctx);
  const area = areaSgc_(db, ctx);
  const gobierna = gobiernaSgc_(db, ctx);
  const veTodo = veTodoSgc_(db, ctx, rol, gobierna);
  const destinatarios = leerSeguro_(db, 'SGC_DOC_DESTINATARIOS');
  const acuses = leerSeguro_(db, 'SGC_DOC_ACUSES').filter((a) => normalizarEmail_(a.usuario_email) === email);
  const acusoVersion = {};
  acuses.forEach((a) => { acusoVersion[a.documento_id + '::' + a.version] = a.acusado_en; });

  const docs = leerSeguro_(db, 'SGC_DOCUMENTOS').filter(esActivo_)
    .filter((d) => puedeVerDocumento_(db, d, ctx, rol, area, gobierna, destinatarios))
    .map((d) => {
      const requiereAcuse = esVerdadero_(d.requiere_acuse);
      return {
        codigo: d.codigo, nombre: d.nombre, visibilidad: d.visibilidad, confidencial: d.visibilidad === 'SELECCION',
        requiere_acuse: requiereAcuse, confirmado: requiereAcuse ? !!acusoVersion[d.documento_id + '::' + d.version_vigente] : null
      };
    }).sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || '')));
  const pendientesAcuse = docs.filter((d) => d.requiere_acuse && !d.confirmado).length;

  let personasScope;
  if (veTodo) {
    personasScope = 'todas las fichas';
  } else {
    const equipo = Jefatura.obtenerEquipoJefe_(db, email) || [];
    personasScope = equipo.length ? ('su propia ficha + su equipo (' + equipo.length + ')') : 'solo su propia ficha';
  }
  const rolSistema = rolCuentaSigsoPorEmail_(db, email);

  const descargas = leerSeguro_(db, 'LOG_SISTEMA').filter((l) => l.contexto === 'SGC_DOC_DESCARGADO' && normalizarEmail_(String(l.mensaje || '').split(' → ')[0]) === email)
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, 15)
    .map((l) => ({ timestamp: l.timestamp, detalle: String(l.mensaje || '').split(' → ')[1] || '' }));

  return {
    email, rol_sgc: rol || '', area_id: area || '', rol_sistema: rolSistema || '',
    acceso_amplio_sistema: rolSistema === 'ADM' || rolSistema === 'GERENCIA',
    documentos: docs, total_documentos: docs.length, pendientes_acuse: pendientesAcuse,
    personas_scope: personasScope, secciones: seccionesVisiblesSgc_(db, ctx), descargas_recientes: descargas
  };
}

function getMatrizDistribucion(db, data, contexto) {
  if (!esAdminSgc_(contexto)) return { _forbidden: true, message: 'Solo el administrador del sistema puede ver la matriz de distribución.' };
  const destinatarios = leerSeguro_(db, 'SGC_DOC_DESTINATARIOS');
  const acuses = leerSeguro_(db, 'SGC_DOC_ACUSES');
  const docs = leerSeguro_(db, 'SGC_DOCUMENTOS').filter(esActivo_).filter((d) => d.estado === 'VIGENTE')
    .sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || '')));

  const filas = directorioPersonalActivo_(db).map((p) => {
    const email = normalizarEmail_(p.email);
    const ctx = { email: p.email, rol: '' };
    const rol = rolSgc_(db, ctx);
    const area = areaSgc_(db, ctx);
    const gobierna = gobiernaSgc_(db, ctx);
    const celdas = docs.map((d) => {
      if (!puedeVerDocumento_(db, d, ctx, rol, area, gobierna, destinatarios)) return { estado: 'no' };
      if (!esVerdadero_(d.requiere_acuse)) return { estado: 'na' };
      const confirmado = acuses.some((a) => a.documento_id === d.documento_id && a.version === d.version_vigente && normalizarEmail_(a.usuario_email) === email);
      return { estado: confirmado ? 'confirmado' : 'pendiente' };
    });
    return { email: p.email, nombre: p.nombre, celdas };
  }).sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));

  return { documentos: docs.map((d) => ({ codigo: d.codigo, nombre: d.nombre })), personas: filas };
}

function getDocumentosConfidenciales(db, data, contexto) {
  if (!esAdminSgc_(contexto)) return { _forbidden: true, message: 'Solo el administrador del sistema puede ver esto.' };
  const destinatarios = leerSeguro_(db, 'SGC_DOC_DESTINATARIOS');
  const nombrePorEmail = {};
  directorioPersonalActivo_(db).forEach((p) => { nombrePorEmail[normalizarEmail_(p.email)] = p.nombre; });
  return leerSeguro_(db, 'SGC_DOCUMENTOS').filter(esActivo_).filter((d) => d.visibilidad === 'SELECCION')
    .sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || '')))
    .map((d) => {
      const lista = destinatarios.filter((x) => x.documento_id === d.documento_id)
        .map((x) => ({ email: x.usuario_email, nombre: nombrePorEmail[normalizarEmail_(x.usuario_email)] || x.usuario_email }));
      return { documento_id: d.documento_id, codigo: d.codigo, nombre: d.nombre, estado: d.estado, destinatarios: lista };
    });
}

// --- motor diario de vencimientos (Fase 1b) ---------------------------------
// Sin trigger propio: se cuelga del pase diario de las 09:00 (index.js), mismo
// criterio que Novedades/Actividades. Un solo correo por persona con todo lo
// suyo (acuses + revisiones), nunca uno por documento.
async function recordatorioPendientes(db) {
  const docs = leerSeguro_(db, 'SGC_DOCUMENTOS').filter(esActivo_);
  if (!docs.length) return { acuses: 0, revisiones: 0 };
  const acuses = leerSeguro_(db, 'SGC_DOC_ACUSES');
  const ahora = new Date();

  const pendientesPorPersona = {};
  docs.forEach((d) => {
    if (d.estado !== 'VIGENTE' || !esVerdadero_(d.requiere_acuse)) return;
    const yaAcuso = {};
    acuses.forEach((a) => { if (a.documento_id === d.documento_id && a.version === d.version_vigente) yaAcuso[normalizarEmail_(a.usuario_email)] = true; });
    audienciaDocumentoSgc_(db, d).forEach((email) => {
      if (yaAcuso[email]) return;
      (pendientesPorPersona[email] = pendientesPorPersona[email] || []).push(d);
    });
  });

  let enviadosAcuse = 0;
  const notifsAcuse = [];
  for (const email of Object.keys(pendientesPorPersona)) {
    const lista = pendientesPorPersona[email];
    function plazo_(d) {
      if (!d.fecha_limite_acuse) return '';
      const dias = diasHasta_(d.fecha_limite_acuse, ahora);
      if (dias === null) return '';
      return dias < 0 ? ' (VENCIDO hace ' + (-dias) + ' día(s))' : ' (vence en ' + dias + ' día(s))';
    }
    const asunto = 'SIGSO — Tienes ' + lista.length + ' documento(s) del SGC por confirmar';
    const cuerpo = 'Tienes ' + lista.length + ' documento(s) del Sistema de Gestión de Calidad que aún no confirmas como leídos:\n' +
      lista.map((d) => '- ' + d.codigo + ' ' + d.nombre + ' (' + d.version_vigente + ')' + plazo_(d)).join('\n') +
      '\n\nEntra a SIGSO > Calidad para revisarlos y marcar "Enterado".';
    const r = await Notificaciones.enviarCorreoModulo(db, {
      solicitudId: 'SGC_ACUSE_RECORDATORIO', destinatario: email, evento: 'SGC_DIGEST', asunto, cuerpo, ventanaMinutos: 24 * 60
    });
    if (r && r.enviado) enviadosAcuse++;
    notifsAcuse.push({ destinatario: email, tipo: 'SGC_ACUSE_PENDIENTE', titulo: 'Documentos del SGC por confirmar', mensaje: lista.length + ' documento(s) esperan tu confirmación.', modulo_id: 'calidad', texto_accion: 'Ver documentos', vidaHoras: 72 });
  }
  NotificacionesApp.encolarLote(db, notifsAcuse);

  const porRevisar = docs.filter((d) => {
    if (d.estado !== 'VIGENTE' || !d.proxima_revision) return false;
    const dias = diasHasta_(d.proxima_revision, ahora);
    return dias !== null && dias <= 30;
  });
  let enviadosRevision = 0;
  if (porRevisar.length) {
    const encargados = leerSeguro_(db, 'SGC_ROLES').filter((r) => esVerdaderoActivo_(r) && r.rol_sgc === 'ENCARGADO_SGC').map((r) => normalizarEmail_(r.usuario_email));
    porRevisar.forEach((d) => {
      const elaborador = normalizarEmail_(d.elaborado_por);
      if (elaborador.indexOf('@') !== -1 && encargados.indexOf(elaborador) === -1) encargados.push(elaborador);
    });
    const itemsTexto = porRevisar.map((d) => {
      const dias = diasHasta_(d.proxima_revision, ahora);
      return '- ' + d.codigo + ' ' + d.nombre + (dias < 0 ? ' (revisión VENCIDA hace ' + (-dias) + ' día(s))' : ' (a revisar en ' + dias + ' día(s))');
    }).join('\n');
    const asuntoRev = 'SIGSO — ' + porRevisar.length + ' documento(s) del SGC por revisar';
    const textoRev = 'Estos documentos del SGC cumplen su revisión periódica (PRO-01, cada 12 meses):\n' + itemsTexto + '\n\nEntra a SIGSO > Calidad para revisarlos y, si corresponde, subir una nueva versión.';
    const notifsRev = [];
    for (const email of encargados) {
      if (!email) continue;
      const r = await Notificaciones.enviarCorreoModulo(db, {
        solicitudId: 'SGC_REVISION_RECORDATORIO', destinatario: email, evento: 'SGC_REVISION', asunto: asuntoRev, cuerpo: textoRev, ventanaMinutos: 24 * 60
      });
      if (r && r.enviado) enviadosRevision++;
      notifsRev.push({ destinatario: email, tipo: 'SGC_REVISION_PENDIENTE', titulo: 'Documentos del SGC por revisar', mensaje: porRevisar.length + ' documento(s) cumplen su revisión de 12 meses.', modulo_id: 'calidad', texto_accion: 'Ver documentos', vidaHoras: 72 });
    }
    NotificacionesApp.encolarLote(db, notifsRev);
  }

  return { acuses: enviadosAcuse, revisiones: enviadosRevision };
}

module.exports = {
  listarDocumentos, getDocumento, sembrarDocumentosExternos, crearDocumento, nuevaVersion,
  reemplazarArchivoVersionVigente,
  actualizarDocumento, descargarDocumento, acusarDocumento, getCumplimiento,
  listarRoles, gestionarRol, listarAccesos, previsualizarAcceso, getMatrizDistribucion, getDocumentosConfidenciales,
  recordatorioPendientes,
  // Exportadas: gobiernaSgc_ es lo que actividades.js consulta para el
  // acoplamiento con el SGC (RN-709, sgc_origen_tipo); el resto queda
  // disponible para los proximos incrementos del SGC (Personas, NC,
  // Auditorias...) y para tests, nunca duplicadas.
  gobiernaSgc_, rolSgc_, esAdminSgc_, veTodoSgc_, areaSgc_, CLAUSULAS_ISO9001,
  // parsearClausulasIso_: la usa MatrizCobertura (Fase 6b) para leer qué
  // documentos respaldan cada cláusula ISO.
  parsearClausulasIso_,
  // seccionesVisiblesSgc_: la usa Tablero (Fase 7), primera pantalla del
  // módulo, para pintar la barra de navegación sin adivinar qué puede
  // abrir cada quien.
  seccionesVisiblesSgc_,
  // subirArchivoSgc_: en el .gs es una función GLOBAL compartida por todo
  // el proyecto Apps Script (Calidad.gs y Personas.gs viven en el mismo
  // scope); en Node, personasSgc.js la importa de acá en vez de
  // duplicarla -- mismos límites/firmas/errores para cualquier archivo
  // del SGC, sin importar qué módulo lo sube.
  subirArchivoSgc_,
  // mimeArchivoSgc_: el detector de firma binaria (PDF/Office) que
  // proyectos.js reusa para su propio subirArchivoDocumentoProyecto_
  // (que ADEMÁS acepta imágenes, algo que subirArchivoSgc_ no cubre --
  // por eso Proyectos no puede reusar la función completa, solo el
  // detector).
  mimeArchivoSgc_
};
