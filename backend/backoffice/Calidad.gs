/**
 * Calidad.gs — Modulo SGC ISO 9001:2015, Fase 1.
 * documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md.
 *
 * REPOSITORIO DOCUMENTAL CONTROLADO. El punto de partida real del cliente
 * es que los documentos del SGC YA EXISTEN (PDF/Word/Excel, ya elaborados,
 * revisados y aprobados en papel): lo que faltaba no era redactarlos en el
 * sistema, sino SUBIRLOS con su metadata de control y que cada persona vea
 * solo los que le corresponden. Por eso esta fase es un repositorio con
 * control de acceso y versionado, no un flujo de redaccion.
 *
 * Patron de permisos (igual que Proyectos/Actividades/Novedades): el modulo
 * 'calidad' es el gate GRUESO (MODULO_POR_ACCION, Code.gs); el rol dentro
 * del SGC (SGC_ROLES) es el gate FINO. NO se crean roles globales nuevos:
 * los roles de SIGSO (ADM/GERENCIA/JEFATURA/...) no se tocan, igual que el
 * rol de proyecto vive dentro del proyecto (v9.0).
 *
 * Regla ISO que se refleja en el codigo: un documento OBSOLETO no se borra
 * (trazabilidad) pero SI se retira de circulacion -- solo lo ven quienes
 * gobiernan el SGC. Nadie del personal puede toparse por accidente con una
 * version que ya no rige (PRO-01 §4.3).
 *
 * Archivos: la carpeta de Drive NUNCA se hace publica. La descarga pasa
 * por descargarDocumento(), que valida permisos y sirve el base64 -- mismo
 * criterio que Novedades.descargarAdjunto (ver nota en DriveRepo.gs).
 */

var Calidad = {

  // --- Listado maestro (FO-PRO-01-01) -------------------------------------
  // Devuelve SOLO lo que quien pregunta puede ver. El filtrado de
  // visibilidad se hace aca, en el servidor: esconder en el frontend no
  // protege nada.
  listarDocumentos: function (data, contexto) {
    var filtros = data || {};
    var todos = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(esActivoSgc_);
    var destinatarios = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS);
    var rol = rolSgc_(contexto);
    var area = areaSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);

    var visibles = todos.filter(function (d) {
      return puedeVerDocumento_(d, contexto, rol, area, gobierna, destinatarios);
    });

    if (filtros.tipo) {
      visibles = visibles.filter(function (d) { return d.tipo === filtros.tipo; });
    }
    if (filtros.area_id) {
      visibles = visibles.filter(function (d) { return d.area_id === filtros.area_id; });
    }
    if (filtros.estado) {
      visibles = visibles.filter(function (d) { return d.estado === filtros.estado; });
    }
    if (filtros.busqueda) {
      var q = String(filtros.busqueda).trim().toLowerCase();
      visibles = visibles.filter(function (d) {
        return String(d.codigo || '').toLowerCase().indexOf(q) !== -1 ||
          String(d.nombre || '').toLowerCase().indexOf(q) !== -1;
      });
    }

    var ahora = new Date();
    return {
      puede_gestionar: gobierna,
      rol_sgc: rol || 'OPERATIVO',
      documentos: visibles.map(function (d) {
        return {
          documento_id: d.documento_id,
          codigo: d.codigo,
          nombre: d.nombre,
          descripcion: d.descripcion,
          tipo: d.tipo,
          area_id: d.area_id,
          version_vigente: d.version_vigente,
          estado: d.estado,
          visibilidad: d.visibilidad,
          fecha_vigencia: d.fecha_vigencia,
          proxima_revision: d.proxima_revision,
          elaborado_por: d.elaborado_por,
          revisado_por: d.revisado_por,
          aprobado_por: d.aprobado_por,
          archivo_nombre: d.archivo_nombre,
          archivo_mime: d.archivo_mime,
          tiene_archivo: !!d.archivo_id,
          // Señal calculada, no persistida: PRO-01 exige revision cada 12
          // meses. Se recalcula al leer para que nunca quede desfasada.
          revision_vencida: esRevisionVencida_(d.proxima_revision, ahora),
          dias_para_revision: diasHastaSgc_(d.proxima_revision, ahora)
        };
      }).sort(function (a, b) {
        return String(a.codigo || '').localeCompare(String(b.codigo || ''));
      })
    };
  },

  // --- Detalle + historial de versiones ------------------------------------
  getDocumento: function (data, contexto) {
    var doc = buscarDocumentoSgc_(data.documento_id);
    if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var destinatarios = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS);
    if (!puedeVerDocumento_(doc, contexto, rol, areaSgc_(contexto), gobierna, destinatarios)) {
      return { _forbidden: true, message: 'No tienes acceso a este documento.' };
    }

    var versiones = leerFilasSeguro_(SHEETS.SGC_DOC_VERSIONES)
      .filter(function (v) { return v.documento_id === doc.documento_id; })
      .sort(function (a, b) { return new Date(b.fecha || 0) - new Date(a.fecha || 0); });

    return {
      documento: doc,
      puede_gestionar: gobierna,
      versiones: versiones,
      destinatarios: doc.visibilidad === 'SELECCION'
        ? destinatarios.filter(function (x) { return x.documento_id === doc.documento_id; })
            .map(function (x) { return x.usuario_email; })
        : []
    };
  },

  // --- Crear documento (subir el archivo que ya existe) --------------------
  crearDocumento: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden cargar documentos.' };
    }
    var codigo = String(data.codigo || '').trim().toUpperCase();
    if (!codigo) return errorValidacion_('codigo', 'El código del documento es obligatorio.');
    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre del documento es obligatorio.');
    if (TIPOS_DOC_SGC.indexOf(data.tipo) === -1) {
      return errorValidacion_('tipo', 'Tipo de documento inválido.');
    }
    if (VISIBILIDAD_SGC.indexOf(data.visibilidad) === -1) {
      return errorValidacion_('visibilidad', 'Visibilidad inválida.');
    }
    // El codigo es la identidad del documento en el SGC (DOC-01, PRO-07...):
    // duplicarlo rompe el listado maestro y confunde al auditor.
    var yaExiste = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(function (d) {
      return esActivoSgc_(d) && String(d.codigo || '').toUpperCase() === codigo;
    })[0];
    if (yaExiste) return errorValidacion_('codigo', 'Ya existe un documento con el código ' + codigo + '.');

    var archivo = { archivo_id: '', archivo_nombre: '', archivo_mime: '' };
    if (data.contenido_base64) {
      var subido = subirArchivoSgc_(data, codigo);
      if (subido._validationError) return subido;
      archivo = subido;
    }

    var ahora = new Date();
    var version = String(data.version_vigente || 'v01').trim();
    var documento = {
      documento_id: Utilities.getUuid(),
      codigo: codigo,
      nombre: nombre,
      descripcion: data.descripcion || '',
      tipo: data.tipo,
      area_id: data.area_id || '',
      version_vigente: version,
      estado: 'VIGENTE',
      visibilidad: data.visibilidad,
      fecha_vigencia: data.fecha_vigencia || ahora.toISOString(),
      proxima_revision: proximaRevisionSgc_(data.fecha_vigencia || ahora.toISOString()),
      elaborado_por: data.elaborado_por || '',
      revisado_por: data.revisado_por || '',
      aprobado_por: data.aprobado_por || '',
      archivo_id: archivo.archivo_id,
      archivo_nombre: archivo.archivo_nombre,
      archivo_mime: archivo.archivo_mime,
      creado_por: contexto.email || '',
      fecha_creacion: ahora.toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.SGC_DOCUMENTOS, documento);

    if (archivo.archivo_id) {
      registrarVersionSgc_(documento.documento_id, version, data.cambios || 'Carga inicial', archivo, contexto, true);
    }
    guardarDestinatariosSgc_(documento.documento_id, data.visibilidad, data.destinatarios);
    registrarLogSgc_('SGC_DOC_CREADO', documento.codigo + ' ' + documento.nombre, contexto);
    return documento;
  },

  // --- Nueva version (la anterior queda archivada, nunca se borra) ---------
  nuevaVersion: function (data, contexto) {
    var doc = buscarDocumentoSgc_(data.documento_id);
    if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden subir una nueva versión.' };
    }
    var version = String(data.version || '').trim();
    if (!version) return errorValidacion_('version', 'Indica el número de la nueva versión (ej. v02).');
    if (version === doc.version_vigente) {
      return errorValidacion_('version', 'Esa ya es la versión vigente.');
    }
    if (!data.contenido_base64) {
      return errorValidacion_('contenido_base64', 'Adjunta el archivo de la nueva versión.');
    }
    var archivo = subirArchivoSgc_(data, doc.codigo);
    if (archivo._validationError) return archivo;

    // La version anterior deja de ser la vigente pero se conserva (ISO
    // exige poder demostrar que version regia en que fecha).
    leerFilasSeguro_(SHEETS.SGC_DOC_VERSIONES).forEach(function (v) {
      if (v.documento_id === doc.documento_id && esVerdaderoSgc_(v.vigente)) {
        actualizarFilaPorId_(SHEETS.SGC_DOC_VERSIONES, 'version_id', v.version_id, { vigente: false });
      }
    });
    registrarVersionSgc_(doc.documento_id, version, data.cambios || '', archivo, contexto, true);

    var fechaVigencia = data.fecha_vigencia || new Date().toISOString();
    var actualizado = actualizarFilaPorId_(SHEETS.SGC_DOCUMENTOS, 'documento_id', doc.documento_id, {
      version_vigente: version,
      fecha_vigencia: fechaVigencia,
      proxima_revision: proximaRevisionSgc_(fechaVigencia),
      archivo_id: archivo.archivo_id,
      archivo_nombre: archivo.archivo_nombre,
      archivo_mime: archivo.archivo_mime,
      estado: 'VIGENTE'
    });
    registrarLogSgc_('SGC_DOC_NUEVA_VERSION', doc.codigo + ' → ' + version, contexto);
    return actualizado;
  },

  // --- Editar metadata / visibilidad / obsolescencia -----------------------
  actualizarDocumento: function (data, contexto) {
    var doc = buscarDocumentoSgc_(data.documento_id);
    if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden editar documentos.' };
    }
    var cambios = {};
    ['nombre', 'descripcion', 'area_id', 'elaborado_por', 'revisado_por', 'aprobado_por'].forEach(function (campo) {
      if (data[campo] !== undefined) cambios[campo] = data[campo];
    });
    if (data.tipo !== undefined) {
      if (TIPOS_DOC_SGC.indexOf(data.tipo) === -1) return errorValidacion_('tipo', 'Tipo de documento inválido.');
      cambios.tipo = data.tipo;
    }
    if (data.visibilidad !== undefined) {
      if (VISIBILIDAD_SGC.indexOf(data.visibilidad) === -1) return errorValidacion_('visibilidad', 'Visibilidad inválida.');
      cambios.visibilidad = data.visibilidad;
      guardarDestinatariosSgc_(doc.documento_id, data.visibilidad, data.destinatarios);
    }
    if (data.fecha_vigencia !== undefined && data.fecha_vigencia) {
      cambios.fecha_vigencia = data.fecha_vigencia;
      cambios.proxima_revision = proximaRevisionSgc_(data.fecha_vigencia);
    }
    if (data.estado !== undefined) {
      if (['VIGENTE', 'OBSOLETO'].indexOf(data.estado) === -1) {
        return errorValidacion_('estado', 'Estado inválido.');
      }
      // Marcar obsoleto lo RETIRA de circulacion (deja de verlo el
      // personal) pero no lo borra: sigue disponible para el auditor.
      cambios.estado = data.estado;
    }
    var actualizado = actualizarFilaPorId_(SHEETS.SGC_DOCUMENTOS, 'documento_id', doc.documento_id, cambios);
    registrarLogSgc_('SGC_DOC_EDITADO', doc.codigo, contexto);
    return actualizado;
  },

  // --- Descarga (valida permisos y sirve el base64) ------------------------
  descargarDocumento: function (data, contexto) {
    var doc = buscarDocumentoSgc_(data.documento_id);
    if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var destinatarios = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS);
    if (!puedeVerDocumento_(doc, contexto, rol, areaSgc_(contexto), gobierna, destinatarios)) {
      return { _forbidden: true, message: 'No tienes acceso a este documento.' };
    }

    // Se puede pedir una version historica concreta (solo quien gobierna el
    // SGC: para el personal, la version anterior ya no rige).
    var archivoId = doc.archivo_id, nombre = doc.archivo_nombre, mime = doc.archivo_mime;
    if (data.version_id) {
      if (!gobierna) {
        return { _forbidden: true, message: 'Solo el Encargado SGC puede descargar versiones anteriores.' };
      }
      var v = leerFilasSeguro_(SHEETS.SGC_DOC_VERSIONES).filter(function (x) {
        return x.version_id === data.version_id && x.documento_id === doc.documento_id;
      })[0];
      if (!v) return errorValidacion_('version_id', 'Versión no encontrada.');
      archivoId = v.archivo_id; nombre = v.archivo_nombre; mime = v.archivo_mime;
    }
    if (!archivoId) return errorValidacion_('documento_id', 'Este documento no tiene archivo cargado.');

    var archivo = DriveApp.getFileById(archivoId);
    // §15.2 de la especificacion pide log de descargas. Se registra la
    // DESCARGA (no cada visualizacion): es lo que el auditor pregunta, y
    // loguear cada lectura haria explotar LOG_SISTEMA.
    registrarLogSgc_('SGC_DOC_DESCARGADO', doc.codigo + ' ' + (nombre || ''), contexto);
    return {
      contenido_base64: Utilities.base64Encode(archivo.getBlob().getBytes()),
      nombre_archivo: nombre || archivo.getName(),
      mime: mime || 'application/octet-stream'
    };
  },

  // --- Roles del SGC --------------------------------------------------------
  listarRoles: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden ver los roles del SGC.' };
    }
    return leerFilasSeguro_(SHEETS.SGC_ROLES).filter(esVerdaderoActivoSgc_);
  },

  gestionarRol: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden gestionar los roles del SGC.' };
    }
    if (data.accion === 'quitar') {
      if (!data.rol_id) return errorValidacion_('rol_id', 'Falta indicar el rol.');
      return actualizarFilaPorId_(SHEETS.SGC_ROLES, 'rol_id', data.rol_id, { activo: false });
    }
    var email = normalizarEmailSgc_(data.usuario_email);
    if (!email) return errorValidacion_('usuario_email', 'Falta el correo de la persona.');
    if (ROLES_SGC.indexOf(data.rol_sgc) === -1) return errorValidacion_('rol_sgc', 'Rol del SGC inválido.');

    var existente = leerFilasSeguro_(SHEETS.SGC_ROLES).filter(function (r) {
      return normalizarEmailSgc_(r.usuario_email) === email;
    })[0];
    if (existente) {
      return actualizarFilaPorId_(SHEETS.SGC_ROLES, 'rol_id', existente.rol_id, {
        rol_sgc: data.rol_sgc,
        area_id: data.area_id || '',
        vigencia_hasta: data.vigencia_hasta || '',
        activo: true
      });
    }
    var fila = {
      rol_id: Utilities.getUuid(),
      usuario_email: email,
      rol_sgc: data.rol_sgc,
      area_id: data.area_id || '',
      vigencia_hasta: data.vigencia_hasta || '',
      activo: true,
      fecha_creacion: new Date().toISOString()
    };
    agregarFila_(SHEETS.SGC_ROLES, fila);
    return fila;
  }
};

// --- constantes del modulo -------------------------------------------------

var TIPOS_DOC_SGC = ['DOC', 'PRO', 'INS', 'FO', 'EXTERNO'];
var VISIBILIDAD_SGC = ['TODOS', 'AREA', 'SELECCION'];
var ROLES_SGC = [
  'ENCARGADO_SGC', 'DIRECCION', 'GERENCIA_ADM', 'JEFATURA_AREA',
  'ENC_ADMIN', 'OPERATIVO', 'AUDITOR_EXTERNO'
];
// Quienes ven TODO el SGC, incluidos los documentos obsoletos.
var ROLES_SGC_LECTURA_TOTAL = ['ENCARGADO_SGC', 'DIRECCION', 'GERENCIA_ADM', 'AUDITOR_EXTERNO'];
// Quienes ademas pueden cargar/editar documentos.
var ROLES_SGC_GESTION = ['ENCARGADO_SGC'];

var MAX_ARCHIVO_SGC_BYTES = 10 * 1024 * 1024;

// Firmas de archivo aceptadas. La especificacion pide PDF, DOCX y XLSX
// (mas los legados DOC/XLS que siguen circulando en la empresa). Se valida
// por BYTES, no por la extension del nombre: la extension la escribe el
// usuario y se puede equivocar (o mentir).
var FIRMA_PDF_SGC = [0x25, 0x50, 0x44, 0x46];              // %PDF
var FIRMA_ZIP_SGC = [0x50, 0x4B, 0x03, 0x04];              // PK.. (docx/xlsx)
var FIRMA_OLE_SGC = [0xD0, 0xCF, 0x11, 0xE0];              // doc/xls legado

// --- permisos --------------------------------------------------------------

function normalizarEmailSgc_(email) {
  return String(email || '').trim().toLowerCase();
}

function esVerdaderoSgc_(valor) {
  return valor === true || valor === 'TRUE' || valor === 1;
}

function esActivoSgc_(fila) {
  return esVerdaderoSgc_(fila.activa);
}

function esVerdaderoActivoSgc_(fila) {
  return esVerdaderoSgc_(fila.activo);
}

// Rol dentro del SGC. Sin fila en SGC_ROLES la persona es OPERATIVO: ve los
// documentos de acceso general y los de su area, nada mas. Un AUDITOR_EXTERNO
// con vigencia_hasta pasada deja de tener rol automaticamente -- acceso
// temporal que expira solo, sin depender de acordarse de desactivarlo.
function rolSgc_(contexto) {
  var email = normalizarEmailSgc_(contexto && contexto.email);
  if (!email) return '';
  var fila = leerFilasSeguro_(SHEETS.SGC_ROLES).filter(function (r) {
    return normalizarEmailSgc_(r.usuario_email) === email && esVerdaderoActivoSgc_(r);
  })[0];
  if (!fila) return '';
  if (fila.vigencia_hasta) {
    var hasta = new Date(fila.vigencia_hasta);
    if (!isNaN(hasta.getTime()) && hasta < new Date()) return '';
  }
  return fila.rol_sgc || '';
}

function areaSgc_(contexto) {
  var email = normalizarEmailSgc_(contexto && contexto.email);
  if (!email) return '';
  var fila = leerFilasSeguro_(SHEETS.SGC_ROLES).filter(function (r) {
    return normalizarEmailSgc_(r.usuario_email) === email && esVerdaderoActivoSgc_(r);
  })[0];
  return fila ? (fila.area_id || '') : '';
}

// Gestion (cargar, editar, versionar): ENCARGADO_SGC o ADM de SIGSO.
function gobiernaSgc_(contexto, rol) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM') return true;
  return ROLES_SGC_GESTION.indexOf(rol) !== -1;
}

// Lectura total (incluye obsoletos): quien gobierna, mas Direccion,
// Gerencia y el auditor externo vigente. GERENCIA de SIGSO tambien, por el
// mismo criterio de solo-lectura transversal que el resto del sistema.
function veTodoSgc_(contexto, rol, gobierna) {
  if (gobierna) return true;
  if (contexto && contexto.rol === 'GERENCIA') return true;
  return ROLES_SGC_LECTURA_TOTAL.indexOf(rol) !== -1;
}

function puedeVerDocumento_(doc, contexto, rol, area, gobierna, destinatarios) {
  if (veTodoSgc_(contexto, rol, gobierna)) return true;
  // Retirado de circulacion: el personal no debe poder toparse con una
  // version que ya no rige (PRO-01 §4.3).
  if (doc.estado === 'OBSOLETO') return false;

  if (doc.visibilidad === 'TODOS') return true;
  if (doc.visibilidad === 'AREA') {
    return !!area && String(doc.area_id || '') === String(area);
  }
  if (doc.visibilidad === 'SELECCION') {
    var email = normalizarEmailSgc_(contexto && contexto.email);
    return (destinatarios || []).some(function (d) {
      return d.documento_id === doc.documento_id && normalizarEmailSgc_(d.usuario_email) === email;
    });
  }
  return false;
}

// --- helpers ---------------------------------------------------------------

function buscarDocumentoSgc_(documentoId) {
  if (!documentoId) return null;
  var filas = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].documento_id === documentoId && esActivoSgc_(filas[i])) return filas[i];
  }
  return null;
}

// PRO-01: revision periodica cada 12 meses.
function proximaRevisionSgc_(fechaVigencia) {
  var f = new Date(fechaVigencia);
  if (isNaN(f.getTime())) return '';
  var proxima = new Date(f.getTime());
  proxima.setFullYear(proxima.getFullYear() + 1);
  return proxima.toISOString();
}

function esRevisionVencida_(proximaRevision, ahora) {
  if (!proximaRevision) return false;
  var f = new Date(proximaRevision);
  if (isNaN(f.getTime())) return false;
  return f < (ahora || new Date());
}

function diasHastaSgc_(fecha, ahora) {
  if (!fecha) return null;
  var f = new Date(fecha);
  if (isNaN(f.getTime())) return null;
  return Math.round((f - (ahora || new Date())) / 86400000);
}

// Valida por bytes y sube a la carpeta privada del SGC en Drive.
function subirArchivoSgc_(data, codigo) {
  if (!data.nombre_archivo) {
    return errorValidacion_('nombre_archivo', 'Falta el nombre del archivo.');
  }
  var bytes;
  try {
    bytes = Utilities.base64Decode(data.contenido_base64);
  } catch (err) {
    return errorValidacion_('contenido_base64', 'El archivo no es base64 válido.');
  }
  if (!bytes.length) return errorValidacion_('contenido_base64', 'El archivo está vacío.');
  if (bytes.length > MAX_ARCHIVO_SGC_BYTES) {
    return errorValidacion_('contenido_base64',
      'El archivo supera el tamaño máximo (' + Math.round(MAX_ARCHIVO_SGC_BYTES / (1024 * 1024)) + ' MB).');
  }
  var mime = mimeArchivoSgc_(bytes, data.nombre_archivo);
  if (!mime) {
    return errorValidacion_('contenido_base64', 'Formato no admitido. Se aceptan PDF, Word (.docx/.doc) y Excel (.xlsx/.xls).');
  }
  var carpeta = obtenerCarpetaCalidad_();
  var nombreFinal = codigo ? (codigo + ' - ' + data.nombre_archivo) : data.nombre_archivo;
  var archivoDrive = carpeta.createFile(Utilities.newBlob(bytes, mime, nombreFinal));
  return {
    archivo_id: archivoDrive.getId(),
    archivo_nombre: data.nombre_archivo,
    archivo_mime: mime
  };
}

function coincideFirmaSgc_(bytes, firma) {
  if (!bytes || bytes.length < firma.length) return false;
  for (var i = 0; i < firma.length; i++) {
    // base64Decode devuelve bytes con signo (-128..127); se normaliza.
    if ((bytes[i] & 0xFF) !== firma[i]) return false;
  }
  return true;
}

// El tipo real lo decide la FIRMA del archivo; la extension solo desempata
// entre docx y xlsx, que comparten firma ZIP.
function mimeArchivoSgc_(bytes, nombre) {
  var ext = String(nombre || '').toLowerCase().split('.').pop();
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

function registrarVersionSgc_(documentoId, version, cambios, archivo, contexto, vigente) {
  var fila = {
    version_id: Utilities.getUuid(),
    documento_id: documentoId,
    version: version,
    cambios: cambios || '',
    archivo_id: archivo.archivo_id,
    archivo_nombre: archivo.archivo_nombre,
    archivo_mime: archivo.archivo_mime,
    subido_por: (contexto && contexto.email) || '',
    fecha: new Date().toISOString(),
    vigente: !!vigente
  };
  agregarFila_(SHEETS.SGC_DOC_VERSIONES, fila);
  return fila;
}

// Reescribe la lista de destinatarios explicitos. Solo aplica a
// visibilidad SELECCION; en TODOS/AREA se limpia para que no queden filas
// huerfanas que confundan despues.
function guardarDestinatariosSgc_(documentoId, visibilidad, destinatarios) {
  var actuales = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS)
    .filter(function (d) { return d.documento_id === documentoId; });
  var deseados = {};
  if (visibilidad === 'SELECCION') {
    (destinatarios || []).forEach(function (email) {
      var normalizado = normalizarEmailSgc_(email);
      if (normalizado) deseados[normalizado] = true;
    });
  }
  actuales.forEach(function (d) {
    var email = normalizarEmailSgc_(d.usuario_email);
    if (deseados[email]) {
      delete deseados[email]; // ya estaba, no duplicar
    } else {
      // No hay borrado fisico en SheetsRepo: se vacia el vinculo.
      actualizarFilaPorId_(SHEETS.SGC_DOC_DESTINATARIOS, 'destinatario_id', d.destinatario_id, { documento_id: '' });
    }
  });
  Object.keys(deseados).forEach(function (email) {
    agregarFila_(SHEETS.SGC_DOC_DESTINATARIOS, {
      destinatario_id: Utilities.getUuid(),
      documento_id: documentoId,
      usuario_email: email
    });
  });
}

// §15.2 de la especificacion: log de auditoria del SGC. Mismo patron de
// escritura directa a LOG_SISTEMA que usa el resto de SIGSO.
function registrarLogSgc_(accion, detalle, contexto) {
  try {
    agregarFila_(SHEETS.LOG_SISTEMA, {
      log_id: Utilities.getUuid(),
      timestamp: new Date().toISOString(),
      contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle,
      ref: 'SGC'
    });
  } catch (err) {
    // El log es trazabilidad, no el flujo principal: si falla, la accion
    // del usuario no debe caerse (mismo criterio que el resto de SIGSO).
  }
}
