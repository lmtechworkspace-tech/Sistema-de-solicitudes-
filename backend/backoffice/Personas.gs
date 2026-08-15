/**
 * Personas.gs — Modulo SGC ISO 9001, Fase 2a (PRO-02).
 * documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md.
 *
 * LA FICHA DEL TRABAJADOR: datos, descriptor de cargo versionado, carpeta
 * digital de documentos e induccion. Es la evidencia de ISO 9001 §7.2
 * (competencia): el auditor pregunta "¿como determina la competencia
 * necesaria y como demuestra que su gente la tiene?".
 *
 * NO se toca USUARIOS. Esa hoja es de autenticacion y la usa todo SIGSO;
 * ademas 6 de las 13 personas en alcance del SGC son externas y ni siquiera
 * estan ahi. La ficha del SGC vive en su propia hoja y se enlaza por correo
 * -- mismo criterio que el rol SGC vive en SGC_ROLES y no en el rol global.
 *
 * PERMISO CENTRAL DE ESTE ARCHIVO (§3 de la especificacion): el personal
 * operativo ve UNICAMENTE SU PROPIA FICHA. No la de sus companeros. Una
 * ficha trae RUT, contrato y evaluaciones: mostrarla de mas no es un
 * detalle de UX, es un problema de datos personales.
 * La jefatura ve la suya y la de su equipo; Encargado SGC / ADM /
 * Direccion / Gerencia ven todas.
 */

var Personas = {

  // --- Listado ---------------------------------------------------------------
  listar: function (data, contexto) {
    var filtros = data || {};
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var todas = leerFilasSeguro_(SHEETS.SGC_PERSONAS).filter(esActivoSgc_);

    var visibles = todas.filter(function (p) {
      return puedeVerPersona_(p, contexto, rol, gobierna);
    });

    // Por defecto solo el personal vigente: quien se desvinculo sigue en el
    // sistema (su historial es evidencia) pero no ensucia la vista diaria.
    if (!filtros.incluir_desvinculados) {
      visibles = visibles.filter(function (p) { return p.estado !== 'DESVINCULADO'; });
    }
    if (filtros.area_id) {
      visibles = visibles.filter(function (p) { return p.area_id === filtros.area_id; });
    }
    if (filtros.tipo) {
      visibles = visibles.filter(function (p) { return p.tipo === filtros.tipo; });
    }

    var descriptores = leerFilasSeguro_(SHEETS.SGC_DESCRIPTORES);
    var inducciones = leerFilasSeguro_(SHEETS.SGC_INDUCCIONES);

    return {
      puede_gestionar: gobierna,
      rol_sgc: rol || 'OPERATIVO',
      personas: visibles.map(function (p) {
        var suyos = descriptores.filter(function (d) { return d.persona_id === p.persona_id; });
        var vigente = suyos.filter(function (d) { return esVerdaderoSgc_(d.vigente); })[0];
        var indPersona = inducciones.filter(function (i) { return i.persona_id === p.persona_id; });
        var completadas = indPersona.filter(function (i) { return i.estado === 'COMPLETADA'; }).length;
        return {
          persona_id: p.persona_id,
          usuario_email: p.usuario_email,
          nombre: p.nombre,
          cargo: p.cargo,
          tipo: p.tipo,
          area_id: p.area_id,
          jefatura_email: p.jefatura_email,
          fecha_ingreso: p.fecha_ingreso,
          estado: p.estado,
          // Señales que el Encargado SGC necesita ver de un vistazo: quien
          // no tiene descriptor y quien tiene la induccion a medias.
          tiene_descriptor: !!vigente,
          descriptor_version: vigente ? vigente.version : '',
          induccion_completadas: completadas,
          induccion_total: indPersona.length || ITEMS_INDUCCION_SGC.length
        };
      }).sort(function (a, b) { return String(a.nombre || '').localeCompare(String(b.nombre || '')); })
    };
  },

  // --- Ficha completa --------------------------------------------------------
  getFicha: function (data, contexto) {
    var persona = buscarPersonaSgc_(data.persona_id);
    if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!puedeVerPersona_(persona, contexto, rol, gobierna)) {
      return { _forbidden: true, message: 'No tienes acceso a esta ficha.' };
    }

    var descriptores = leerFilasSeguro_(SHEETS.SGC_DESCRIPTORES)
      .filter(function (d) { return d.persona_id === persona.persona_id; })
      .sort(function (a, b) { return new Date(b.fecha || 0) - new Date(a.fecha || 0); });
    var documentos = leerFilasSeguro_(SHEETS.SGC_PERSONA_DOCUMENTOS)
      .filter(function (d) { return d.persona_id === persona.persona_id && esActivoSgc_(d); });
    var induccion = leerFilasSeguro_(SHEETS.SGC_INDUCCIONES)
      .filter(function (i) { return i.persona_id === persona.persona_id; });

    return {
      persona: persona,
      puede_gestionar: gobierna,
      // La jefatura directa puede completar la induccion de su gente aunque
      // no gobierne el SGC (§15 de la especificacion: "Jefatura de area ->
      // monitorear personal a cargo").
      puede_gestionar_induccion: gobierna || esJefaturaDe_(persona, contexto),
      descriptores: descriptores,
      descriptor_vigente: descriptores.filter(function (d) { return esVerdaderoSgc_(d.vigente); })[0] || null,
      documentos: documentos,
      induccion: induccion
    };
  },

  // --- CRUD de la persona ----------------------------------------------------
  guardarPersona: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden gestionar el personal.' };
    }
    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre es obligatorio.');
    var email = normalizarEmailSgc_(data.usuario_email);
    if (!email) return errorValidacion_('usuario_email', 'El correo es obligatorio: es lo que enlaza la ficha con su cuenta.');
    if (['INT', 'EXT'].indexOf(data.tipo) === -1) {
      return errorValidacion_('tipo', 'Indica si la persona es interna (INT) o externa (EXT).');
    }

    if (data.persona_id) {
      var existente = buscarPersonaSgc_(data.persona_id);
      if (!existente) return errorValidacion_('persona_id', 'Persona no encontrada.');
      var cambios = {};
      ['nombre', 'rut', 'cargo', 'tipo', 'area_id', 'jefatura_email', 'subrogante_email', 'fecha_ingreso']
        .forEach(function (campo) { if (data[campo] !== undefined) cambios[campo] = data[campo]; });
      if (data.usuario_email !== undefined) cambios.usuario_email = email;
      return actualizarFilaPorId_(SHEETS.SGC_PERSONAS, 'persona_id', existente.persona_id, cambios);
    }

    // El correo identifica a la persona dentro del SGC: duplicarlo partiria
    // su historial (inducciones aca, evaluaciones alla).
    var yaExiste = leerFilasSeguro_(SHEETS.SGC_PERSONAS).filter(function (p) {
      return esActivoSgc_(p) && normalizarEmailSgc_(p.usuario_email) === email;
    })[0];
    if (yaExiste) return errorValidacion_('usuario_email', 'Ya existe una ficha para ' + email + '.');

    var ahora = new Date();
    var persona = {
      persona_id: Utilities.getUuid(),
      usuario_email: email,
      nombre: nombre,
      rut: data.rut || '',
      cargo: data.cargo || '',
      tipo: data.tipo,
      area_id: data.area_id || '',
      // Si no se indica jefatura, se toma la jerarquia operativa que ya
      // existe en JEFATURAS -- no se pide dos veces el mismo dato.
      jefatura_email: normalizarEmailSgc_(data.jefatura_email) || normalizarEmailSgc_(jefeDeSubordinado_(email)),
      subrogante_email: normalizarEmailSgc_(data.subrogante_email),
      fecha_ingreso: data.fecha_ingreso || '',
      estado: 'ACTIVO',
      fecha_desvinculacion: '',
      creado_por: contexto.email || '',
      fecha_creacion: ahora.toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.SGC_PERSONAS, persona);

    // Se siembra la induccion con los 5 items del SGC en PENDIENTE: asi el
    // formulario FO-PRO-02-02 existe desde el dia uno y se ve que falta.
    ITEMS_INDUCCION_SGC.forEach(function (item) {
      agregarFila_(SHEETS.SGC_INDUCCIONES, {
        induccion_id: Utilities.getUuid(),
        persona_id: persona.persona_id,
        item: item,
        fecha: '',
        relator_email: '',
        estado: 'PENDIENTE',
        observaciones: ''
      });
    });
    registrarLogSgc_('SGC_PERSONA_CREADA', persona.nombre + ' (' + email + ')', contexto);
    return persona;
  },

  // Desvincular NO borra: la especificacion lo pide explicitamente y la
  // norma lo necesita (las inducciones, evaluaciones y capacitaciones de esa
  // persona son evidencia historica).
  desvincular: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden desvincular.' };
    }
    var persona = buscarPersonaSgc_(data.persona_id);
    if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
    if (data.reactivar === true) {
      return actualizarFilaPorId_(SHEETS.SGC_PERSONAS, 'persona_id', persona.persona_id, {
        estado: 'ACTIVO', fecha_desvinculacion: ''
      });
    }
    var actualizado = actualizarFilaPorId_(SHEETS.SGC_PERSONAS, 'persona_id', persona.persona_id, {
      estado: 'DESVINCULADO',
      fecha_desvinculacion: data.fecha_desvinculacion || new Date().toISOString()
    });
    registrarLogSgc_('SGC_PERSONA_DESVINCULADA', persona.nombre, contexto);
    return actualizado;
  },

  // --- Descriptor de cargo (FO-PRO-02-01), versionado ------------------------
  guardarDescriptor: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden editar descriptores.' };
    }
    var persona = buscarPersonaSgc_(data.persona_id);
    if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
    var version = String(data.version || '').trim();
    if (!version) return errorValidacion_('version', 'Indica la versión del descriptor (ej. v01).');
    if (!String(data.objetivo || '').trim()) {
      return errorValidacion_('objetivo', 'El objetivo general del cargo es obligatorio.');
    }

    var archivo = { archivo_id: '', archivo_nombre: '', archivo_mime: '' };
    if (data.contenido_base64) {
      var subido = subirArchivoSgc_(data, 'DESCRIPTOR-' + (persona.rut || persona.nombre));
      if (subido._validationError) return subido;
      archivo = subido;
    }

    // La version anterior deja de ser la vigente pero se conserva: hay que
    // poder demostrar que descriptor regia cuando se evaluo a la persona.
    leerFilasSeguro_(SHEETS.SGC_DESCRIPTORES).forEach(function (d) {
      if (d.persona_id === persona.persona_id && esVerdaderoSgc_(d.vigente)) {
        actualizarFilaPorId_(SHEETS.SGC_DESCRIPTORES, 'descriptor_id', d.descriptor_id, { vigente: false });
      }
    });

    var descriptor = {
      descriptor_id: Utilities.getUuid(),
      persona_id: persona.persona_id,
      version: version,
      objetivo: data.objetivo || '',
      funciones: data.funciones || '',
      responsabilidades: data.responsabilidades || '',
      habilidades: data.habilidades || '',
      nivel_educacional: data.nivel_educacional || '',
      formacion_tecnica: data.formacion_tecnica || '',
      experiencia: data.experiencia || '',
      archivo_id: archivo.archivo_id,
      archivo_nombre: archivo.archivo_nombre,
      archivo_mime: archivo.archivo_mime,
      vigente: true,
      creado_por: contexto.email || '',
      fecha: new Date().toISOString()
    };
    agregarFila_(SHEETS.SGC_DESCRIPTORES, descriptor);
    registrarLogSgc_('SGC_DESCRIPTOR', persona.nombre + ' ' + version, contexto);
    return descriptor;
  },

  // --- Carpeta digital de documentos de la persona ---------------------------
  guardarDocumento: function (data, contexto) {
    var persona = buscarPersonaSgc_(data.persona_id);
    if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden cargar documentos del personal.' };
    }
    if (data.accion === 'eliminar') {
      if (!data.doc_id) return errorValidacion_('doc_id', 'Falta indicar el documento.');
      return actualizarFilaPorId_(SHEETS.SGC_PERSONA_DOCUMENTOS, 'doc_id', data.doc_id, { activa: false });
    }
    if (TIPOS_DOC_PERSONA_SGC.indexOf(data.tipo) === -1) {
      return errorValidacion_('tipo', 'Tipo de documento inválido.');
    }
    if (!data.contenido_base64) return errorValidacion_('contenido_base64', 'Adjunta el archivo.');
    var archivo = subirArchivoSgc_(data, 'PERSONAL');
    if (archivo._validationError) return archivo;

    var doc = {
      doc_id: Utilities.getUuid(),
      persona_id: persona.persona_id,
      tipo: data.tipo,
      nombre: String(data.nombre || data.nombre_archivo || '').trim(),
      archivo_id: archivo.archivo_id,
      archivo_nombre: archivo.archivo_nombre,
      archivo_mime: archivo.archivo_mime,
      subido_por: contexto.email || '',
      fecha: new Date().toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.SGC_PERSONA_DOCUMENTOS, doc);
    registrarLogSgc_('SGC_PERSONA_DOC', persona.nombre + ' ' + data.tipo, contexto);
    return doc;
  },

  descargarDocumento: function (data, contexto) {
    var persona = buscarPersonaSgc_(data.persona_id);
    if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
    var rol = rolSgc_(contexto);
    if (!puedeVerPersona_(persona, contexto, rol, gobiernaSgc_(contexto, rol))) {
      return { _forbidden: true, message: 'No tienes acceso a esta ficha.' };
    }
    var doc = leerFilasSeguro_(SHEETS.SGC_PERSONA_DOCUMENTOS).filter(function (d) {
      return d.doc_id === data.doc_id && d.persona_id === persona.persona_id && esActivoSgc_(d);
    })[0];
    if (!doc) return errorValidacion_('doc_id', 'Documento no encontrado.');

    var archivo = DriveApp.getFileById(doc.archivo_id);
    registrarLogSgc_('SGC_PERSONA_DOC_DESCARGADO', persona.nombre + ' ' + doc.tipo, contexto);
    return {
      contenido_base64: Utilities.base64Encode(archivo.getBlob().getBytes()),
      nombre_archivo: doc.archivo_nombre || archivo.getName(),
      mime: doc.archivo_mime || 'application/octet-stream'
    };
  },

  // --- Induccion (FO-PRO-02-02) ----------------------------------------------
  registrarInduccion: function (data, contexto) {
    var persona = buscarPersonaSgc_(data.persona_id);
    if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
    var rol = rolSgc_(contexto);
    // La jefatura directa tambien puede completarla (es quien la hace).
    if (!(gobiernaSgc_(contexto, rol) || esJefaturaDe_(persona, contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o la jefatura directa pueden registrar la inducción.' };
    }
    if (!data.induccion_id) return errorValidacion_('induccion_id', 'Falta indicar el ítem de inducción.');
    var fila = leerFilasSeguro_(SHEETS.SGC_INDUCCIONES).filter(function (i) {
      return i.induccion_id === data.induccion_id && i.persona_id === persona.persona_id;
    })[0];
    if (!fila) return errorValidacion_('induccion_id', 'Ítem de inducción no encontrado.');

    var completada = data.estado !== 'PENDIENTE';
    return actualizarFilaPorId_(SHEETS.SGC_INDUCCIONES, 'induccion_id', data.induccion_id, {
      estado: completada ? 'COMPLETADA' : 'PENDIENTE',
      // Se registra la fecha real de la actividad; si no la indican, hoy.
      fecha: completada ? (data.fecha || new Date().toISOString()) : '',
      // Relator por defecto: quien registra (tipicamente el Encargado SGC).
      relator_email: completada ? (normalizarEmailSgc_(data.relator_email) || normalizarEmailSgc_(contexto.email)) : '',
      observaciones: data.observaciones || ''
    });
  }
};

// --- constantes -------------------------------------------------------------

// Los 5 items de induccion al SGC (§5.1.D de la especificacion).
var ITEMS_INDUCCION_SGC = [
  'Organigrama',
  'Política de Calidad',
  'Objetivos de Calidad',
  'Descriptor de cargo',
  'Inducción ISO 9001'
];

var TIPOS_DOC_PERSONA_SGC = ['CV', 'TITULO', 'ISO9001', 'CONTRATO', 'CERTIFICADO', 'OTRO'];

// --- permisos ---------------------------------------------------------------

// Quien ve la ficha de quien. Este es el permiso mas delicado del modulo:
// una ficha trae RUT, contrato y evaluaciones.
//  - Encargado SGC / ADM / Direccion / Gerencia / auditor vigente: todas.
//  - Jefatura de area: la suya y la de su equipo.
//  - Cualquier otra persona: UNICAMENTE la suya.
function puedeVerPersona_(persona, contexto, rol, gobierna) {
  if (!contexto) return false;
  if (veTodoSgc_(contexto, rol, gobierna)) return true;
  var email = normalizarEmailSgc_(contexto.email);
  if (normalizarEmailSgc_(persona.usuario_email) === email) return true; // la propia
  return esJefaturaDe_(persona, contexto);
}

// Jefatura directa: la declarada en la ficha del SGC o, si no hay, la
// jerarquia operativa de JEFATURAS (obtenerEquipoJefe_, Jefatura.gs).
function esJefaturaDe_(persona, contexto) {
  var email = normalizarEmailSgc_(contexto && contexto.email);
  if (!email) return false;
  if (normalizarEmailSgc_(persona.jefatura_email) === email) return true;
  var equipo = obtenerEquipoJefe_(email) || [];
  return equipo.map(normalizarEmailSgc_).indexOf(normalizarEmailSgc_(persona.usuario_email)) !== -1;
}

// --- helpers ----------------------------------------------------------------

function buscarPersonaSgc_(personaId) {
  if (!personaId) return null;
  var filas = leerFilasSeguro_(SHEETS.SGC_PERSONAS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].persona_id === personaId && esActivoSgc_(filas[i])) return filas[i];
  }
  return null;
}

// La ficha de quien esta preguntando (para que el personal operativo entre
// directo a lo suyo, sin pasar por un listado donde no veria a nadie mas).
function miPersonaSgc_(contexto) {
  var email = normalizarEmailSgc_(contexto && contexto.email);
  if (!email) return null;
  return leerFilasSeguro_(SHEETS.SGC_PERSONAS).filter(function (p) {
    return esActivoSgc_(p) && normalizarEmailSgc_(p.usuario_email) === email;
  })[0] || null;
}
