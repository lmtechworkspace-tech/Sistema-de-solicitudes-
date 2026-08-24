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
 * v14.0: el correo YA NO identifica una UNICA ficha. Una persona puede
 * tener mas de un CARGO en la empresa (ej. Encargada de Prevencion interna
 * Y externa a la vez), cada uno con su propio descriptor, induccion y
 * evaluaciones -- pero ambos deben entrar con la MISMA cuenta, sin pedirle
 * un segundo correo. Por eso SGC_PERSONAS puede tener varias filas con el
 * mismo `usuario_email`; lo que las distingue es el `cargo`. El acceso al
 * modulo (SGC_ROLES) sigue siendo UNA fila por correo -- eso no cambia: es
 * la cuenta, no el cargo, la que entra al sistema.
 *
 * PERMISO CENTRAL DE ESTE ARCHIVO (§3 de la especificacion): el personal
 * operativo ve UNICAMENTE SU(S) PROPIA(S) FICHA(S) -- todas las que
 * compartan su correo, nunca las de sus companeros. Una ficha trae RUT,
 * contrato y evaluaciones: mostrarla de mas no es un detalle de UX, es un
 * problema de datos personales.
 * La jefatura ve la suya y la de su equipo; Encargado SGC / ADM /
 * Direccion / Gerencia ven todas.
 */

var Personas = {

  // --- Listado ---------------------------------------------------------------
  listar: function (data, contexto) {
    var filtros = data || {};
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    // Quien no gobierna nunca ve a alguien fuera de alcance -- ni siquiera
    // pidiendo el filtro a mano: son datos que se estan corrigiendo, no
    // personal vigente del SGC.
    var todas = (filtros.incluir_fuera_alcance && gobierna)
      ? leerFilasSeguro_(SHEETS.SGC_PERSONAS)
      : leerFilasSeguro_(SHEETS.SGC_PERSONAS).filter(esActivoSgc_);

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
          // v14.0: distinto de `estado === 'DESVINCULADO'` -- esto es
          // "nunca debió estar en el alcance", no "trabajó aquí y se fue".
          fuera_de_alcance: !esActivoSgc_(p),
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
      .sort(function (a, b) { return new Date(b.fecha || 0) - new Date(a.fecha || 0); })
      .map(function (d) {
        return Object.assign({}, d, {
          items_responsabilidades: parsearItemsDescriptor_(d.items_responsabilidades),
          items_habilidades: parsearItemsDescriptor_(d.items_habilidades)
        });
      });
    var documentos = leerFilasSeguro_(SHEETS.SGC_PERSONA_DOCUMENTOS)
      .filter(function (d) { return d.persona_id === persona.persona_id && esActivoSgc_(d); });
    var induccion = leerFilasSeguro_(SHEETS.SGC_INDUCCIONES)
      .filter(function (i) { return i.persona_id === persona.persona_id; });

    // v10.0 Fase 2b: historial de evaluaciones, mas reciente primero.
    // v10.0 Tanda A: las respuestas se guardan como JSON; se devuelven ya
    // parseadas (no el string crudo) para que el frontend no tenga que
    // saber el formato de almacenamiento.
    var evaluaciones = leerFilasSeguro_(SHEETS.SGC_EVALUACIONES)
      .filter(function (e) { return e.persona_id === persona.persona_id; })
      .sort(function (a, b) { return new Date(b.fecha || 0) - new Date(a.fecha || 0); })
      .map(function (e) {
        return {
          evaluacion_id: e.evaluacion_id,
          fecha: e.fecha,
          evaluador_email: e.evaluador_email,
          respuestas_responsabilidades: parsearItemsDescriptor_(e.respuestas_responsabilidades),
          respuestas_habilidades: parsearItemsDescriptor_(e.respuestas_habilidades),
          promedio_responsabilidades: Number(e.promedio_responsabilidades) || 0,
          promedio_habilidades: Number(e.promedio_habilidades) || 0,
          requiere_capacitacion: esVerdaderoSgc_(e.requiere_capacitacion),
          observaciones: e.observaciones,
          recomendado_por: e.recomendado_por,
          proxima_evaluacion: e.proxima_evaluacion
        };
      });
    var ultimaEval = evaluaciones[0] || null;

    var descriptorVigente = descriptores.filter(function (d) { return esVerdaderoSgc_(d.vigente); })[0] || null;

    return {
      persona: persona,
      puede_gestionar: gobierna,
      // La jefatura directa puede completar la induccion de su gente aunque
      // no gobierne el SGC (§15 de la especificacion: "Jefatura de area ->
      // monitorear personal a cargo").
      puede_gestionar_induccion: gobierna || esJefaturaDe_(persona, contexto),
      // Evaluar es de la jefatura directa (asi lo pide PRO-02) o del
      // Encargado SGC; y nadie se evalua a si mismo.
      puede_evaluar: (gobierna || esJefaturaDe_(persona, contexto)) &&
        !(normalizarEmailSgc_(persona.usuario_email) === normalizarEmailSgc_(contexto.email) && !gobierna),
      escala_evaluacion: ESCALA_EVALUACION_SGC,
      evaluaciones: evaluaciones,
      ultima_evaluacion: ultimaEval,
      evaluacion_vencida: !ultimaEval || (ultimaEval.proxima_evaluacion &&
        new Date(ultimaEval.proxima_evaluacion) < new Date()),
      // Horas de formacion del ano en curso (Objetivo de Calidad N°4).
      horas_formacion_anio: (horasFormacionPorPersonaSgc_(new Date().getFullYear())
        .filter(function (h) { return h.persona_id === persona.persona_id; })[0] || { horas: 0 }).horas,
      meta_horas_formacion: META_HORAS_FORMACION_SGC,
      descriptores: descriptores,
      descriptor_vigente: descriptorVigente,
      // Los items que la evaluacion va a calificar, ya parseados: asi el
      // formulario de evaluacion no depende de saber leer JSON.
      items_responsabilidades: descriptorVigente ? parsearItemsDescriptor_(descriptorVigente.items_responsabilidades) : [],
      items_habilidades: descriptorVigente ? parsearItemsDescriptor_(descriptorVigente.items_habilidades) : [],
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

    // v14.0: una persona puede tener MAS DE UN CARGO en la empresa (ej.
    // Camila es Encargada de Prevención de Riesgos interna Y externa, cada
    // cargo con su propio descriptor, inducción y evaluaciones) -- por eso
    // el correo YA NO es unico por si solo: lo que identifica cada FICHA es
    // el correo + el cargo. Solo se bloquea el duplicado EXACTO (mismo
    // correo, mismo cargo), que suele ser un doble clic, no un cargo nuevo.
    // Cada fila sigue siendo su propia persona_id, asi que descriptor,
    // documentos, inducción y evaluaciones de un cargo nunca se mezclan con
    // los del otro -- son fichas independientes que solo comparten cuenta.
    var cargoNuevo = String(data.cargo || '').trim().toLowerCase();
    var yaExiste = leerFilasSeguro_(SHEETS.SGC_PERSONAS).filter(function (p) {
      return esActivoSgc_(p) && normalizarEmailSgc_(p.usuario_email) === email &&
        String(p.cargo || '').trim().toLowerCase() === cargoNuevo;
    })[0];
    if (yaExiste) {
      return errorValidacion_('cargo', 'Ya existe una ficha con ese cargo para ' + email +
        '. Si es un cargo distinto (ej. interno/externo), escribe un Cargo que lo diferencie.');
    }

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

  // v14.0: quitar a alguien que NUNCA debió estar en el alcance del SGC --
  // distinto de desvincular (que registra una salida real de la empresa,
  // con su fecha). Suele hacer falta despues de una carga masiva que trajo
  // personal de mas. Usa `activa` (SGC_PERSONAS ya la tenia, es el filtro
  // "duro" que ya respetan listar/buscarPersonaSgc_/getFicha), NO `estado`
  // -- asi no queda una "desvinculacion" falsa en el historial de alguien
  // que sigue trabajando en la empresa, solo que no en el alcance del SGC.
  //
  // buscarPersonaSgc_ filtra por `activa`, asi que aca se busca la fila
  // directo (sin ese filtro): es la unica forma de poder reincluir a
  // alguien despues de haberlo quitado.
  quitarDelAlcance: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden quitar a alguien del alcance del SGC.' };
    }
    var fila = leerFilasSeguro_(SHEETS.SGC_PERSONAS).filter(function (p) {
      return p.persona_id === data.persona_id;
    })[0];
    if (!fila) return errorValidacion_('persona_id', 'Persona no encontrada.');

    if (data.reactivar === true) {
      var vuelta = actualizarFilaPorId_(SHEETS.SGC_PERSONAS, 'persona_id', fila.persona_id, { activa: true });
      registrarLogSgc_('SGC_PERSONA_REINCLUIDA_ALCANCE', fila.nombre, contexto);
      return vuelta;
    }
    var quitada = actualizarFilaPorId_(SHEETS.SGC_PERSONAS, 'persona_id', fila.persona_id, { activa: false });
    registrarLogSgc_('SGC_PERSONA_FUERA_DE_ALCANCE', fila.nombre, contexto);
    return quitada;
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

    // items_responsabilidades / items_habilidades: la lista discreta que
    // despues califica el FO-PRO-02-04 ("segun descriptor de cargo"). Llegan
    // como arreglo de strings (una por linea, en el frontend) o ya como
    // arreglo; se limpia y se descarta lo vacio.
    var itemsResp = normalizarItemsDescriptor_(data.items_responsabilidades);
    var itemsHab = normalizarItemsDescriptor_(data.items_habilidades);

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
      items_responsabilidades: JSON.stringify(itemsResp),
      items_habilidades: JSON.stringify(itemsHab),
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

  // v14.0: corrige el descriptor VIGENTE en el lugar -- mismo criterio que
  // Calidad.actualizarDocumento con SGC_DOCUMENTOS. NO archiva la version
  // actual ni crea una fila nueva (eso sigue siendo guardarDescriptor,
  // "Nueva versión del descriptor"): es para arreglar una redacción o
  // adjuntar/reemplazar el archivo sin fingir que cambió el contenido
  // regido. La version (el numero) no se toca aca a proposito.
  actualizarDescriptor: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden editar descriptores.' };
    }
    var persona = buscarPersonaSgc_(data.persona_id);
    if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
    var desc = leerFilasSeguro_(SHEETS.SGC_DESCRIPTORES).filter(function (d) {
      return d.descriptor_id === data.descriptor_id && d.persona_id === persona.persona_id && esVerdaderoSgc_(d.vigente);
    })[0];
    if (!desc) return errorValidacion_('descriptor_id', 'Descriptor no encontrado o ya no es la versión vigente.');
    if (!String(data.objetivo || '').trim()) {
      return errorValidacion_('objetivo', 'El objetivo general del cargo es obligatorio.');
    }

    var cambios = {
      objetivo: data.objetivo || '',
      funciones: data.funciones || '',
      responsabilidades: data.responsabilidades || '',
      habilidades: data.habilidades || '',
      items_responsabilidades: JSON.stringify(normalizarItemsDescriptor_(data.items_responsabilidades)),
      items_habilidades: JSON.stringify(normalizarItemsDescriptor_(data.items_habilidades)),
      nivel_educacional: data.nivel_educacional || '',
      formacion_tecnica: data.formacion_tecnica || '',
      experiencia: data.experiencia || ''
    };
    if (data.contenido_base64) {
      var subido = subirArchivoSgc_(data, 'DESCRIPTOR-' + (persona.rut || persona.nombre));
      if (subido._validationError) return subido;
      cambios.archivo_id = subido.archivo_id;
      cambios.archivo_nombre = subido.archivo_nombre;
      cambios.archivo_mime = subido.archivo_mime;
    }
    actualizarFilaPorId_(SHEETS.SGC_DESCRIPTORES, 'descriptor_id', desc.descriptor_id, cambios);
    registrarLogSgc_('SGC_DESCRIPTOR_EDITADO', persona.nombre + ' ' + desc.version, contexto);
    return { descriptor_id: desc.descriptor_id };
  },

  // v14.0: descarga el archivo del descriptor -- mismo permiso que ver la
  // ficha (puedeVerPersona_), igual que descargarDocumento de la carpeta
  // digital. El descriptor de cargo no es mas sensible que el resto de la
  // ficha, asi que no exige gobiernaSgc_.
  descargarDescriptor: function (data, contexto) {
    var persona = buscarPersonaSgc_(data.persona_id);
    if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
    var rol = rolSgc_(contexto);
    if (!puedeVerPersona_(persona, contexto, rol, gobiernaSgc_(contexto, rol))) {
      return { _forbidden: true, message: 'No tienes acceso a esta ficha.' };
    }
    var desc = leerFilasSeguro_(SHEETS.SGC_DESCRIPTORES).filter(function (d) {
      return d.descriptor_id === data.descriptor_id && d.persona_id === persona.persona_id;
    })[0];
    if (!desc) return errorValidacion_('descriptor_id', 'Descriptor no encontrado.');
    if (!desc.archivo_id) return errorValidacion_('descriptor_id', 'Este descriptor no tiene archivo adjunto.');

    var archivo = DriveApp.getFileById(desc.archivo_id);
    registrarLogSgc_('SGC_DESCRIPTOR_DESCARGADO', persona.nombre + ' ' + desc.version, contexto);
    return {
      contenido_base64: Utilities.base64Encode(archivo.getBlob().getBytes()),
      nombre_archivo: desc.archivo_nombre || archivo.getName(),
      mime: desc.archivo_mime || 'application/octet-stream'
    };
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
  },

  // --- Monitoreo de competencias (FO-PRO-02-04, Fase 2b) --------------------
  // v10.0 Tanda A: el formulario real califica DOS bloques por separado
  // ("2.- Calificacion de principales responsabilidades" y "3.- ...
  // responsabilidades secundarias/habilidades"), con un promedio cada uno
  // (§4.- Resultados). Los items salen del descriptor VIGENTE de la
  // persona -- no de una lista generica -- porque el formulario evalua
  // "segun descriptor de cargo".
  //
  // Quien evalua: la JEFATURA DIRECTA (asi lo pide la especificacion: "el
  // evaluador es la jefatura directa segun organigrama") o el Encargado
  // SGC / ADM. Nadie se evalua a si mismo -- una autoevaluacion no es
  // evidencia de competencia para un auditor.
  registrarEvaluacion: function (data, contexto) {
    var persona = buscarPersonaSgc_(data.persona_id);
    if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || esJefaturaDe_(persona, contexto))) {
      return { _forbidden: true, message: 'Solo la jefatura directa o el Encargado SGC pueden evaluar.' };
    }
    if (normalizarEmailSgc_(persona.usuario_email) === normalizarEmailSgc_(contexto.email) && !gobierna) {
      return { _forbidden: true, message: 'Nadie puede evaluarse a sí mismo.' };
    }

    var descriptor = descriptorVigenteDe_(persona.persona_id);
    if (!descriptor) {
      return errorValidacion_('persona_id',
        'Esta persona no tiene un descriptor de cargo vigente. Complétalo primero: la evaluación califica según su descriptor.');
    }
    var itemsResp = parsearItemsDescriptor_(descriptor.items_responsabilidades);
    var itemsHab = parsearItemsDescriptor_(descriptor.items_habilidades);
    if (!itemsResp.length || !itemsHab.length) {
      return errorValidacion_('persona_id',
        'El descriptor de cargo vigente no tiene responsabilidades y habilidades cargadas como lista. Complétalo antes de evaluar.');
    }

    var puntuadosResp = puntuarItemsEvaluacion_(itemsResp, data.respuestas_responsabilidades);
    if (puntuadosResp._validationError) return puntuadosResp;
    var puntuadosHab = puntuarItemsEvaluacion_(itemsHab, data.respuestas_habilidades);
    if (puntuadosHab._validationError) return puntuadosHab;

    var promedioResp = promedioItems_(puntuadosResp);
    var promedioHab = promedioItems_(puntuadosHab);
    var fecha = data.fecha || new Date().toISOString();

    var evaluacion = {
      evaluacion_id: Utilities.getUuid(),
      persona_id: persona.persona_id,
      descriptor_id: descriptor.descriptor_id,
      fecha: fecha,
      evaluador_email: normalizarEmailSgc_(contexto.email),
      respuestas_responsabilidades: JSON.stringify(puntuadosResp),
      respuestas_habilidades: JSON.stringify(puntuadosHab),
      promedio_responsabilidades: promedioResp,
      promedio_habilidades: promedioHab,
      // Un area debil ya amerita formacion aunque la otra vaya bien -- no
      // se promedian entre si, porque eso escondería una debilidad puntual
      // detras de un numero general aceptable.
      requiere_capacitacion: promedioResp < UMBRAL_CAPACITACION_SGC || promedioHab < UMBRAL_CAPACITACION_SGC,
      observaciones: data.observaciones || '',
      recomendado_por: String(data.recomendado_por || '').trim(),
      proxima_evaluacion: sumarMesesSgc_(fecha, 12)
    };
    agregarFila_(SHEETS.SGC_EVALUACIONES, evaluacion);
    registrarLogSgc_('SGC_EVALUACION',
      persona.nombre + ' resp ' + promedioResp + ' / hab ' + promedioHab, contexto);

    if (evaluacion.requiere_capacitacion) {
      // El hallazgo no sirve si se queda en la planilla: se avisa al
      // Encargado SGC, que es quien programa la capacitacion.
      leerFilasSeguro_(SHEETS.SGC_ROLES).forEach(function (r) {
        if (esVerdaderoActivoSgc_(r) && r.rol_sgc === 'ENCARGADO_SGC') {
          encolarNotificacionApp_(r.usuario_email, 'SGC_COMPETENCIA',
            'Necesidad de capacitación detectada',
            persona.nombre + ' obtuvo promedio ' + Math.min(promedioResp, promedioHab) +
            ' en su evaluación de competencias.', 'calidad', 'Ver ficha', 72);
        }
      });
    }
    return evaluacion;
  },

  // --- Capacitaciones (FO-PRO-02-03 programa / FO-PRO-02-05 registro) -------
  listarCapacitaciones: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    // v10.0 "Accesos SGC": el programa de capacitaciones (con las horas de
    // TODO el personal) es informacion de gestion. El personal ve SU propia
    // formacion en su ficha (pestana Competencias), no aca -- asi no se
    // filtra quien asistio a que a colegas que no gestionan el SGC.
    if (!veTodoSgc_(contexto, rol, gobierna)) {
      return { _forbidden: true, message: 'El programa de capacitaciones es del Encargado del SGC. Tu formación aparece en tu ficha, en Personas.' };
    }
    var capacitaciones = leerFilasSeguro_(SHEETS.SGC_CAPACITACIONES).filter(esActivoSgc_);
    var asistentes = leerFilasSeguro_(SHEETS.SGC_CAPACITACION_ASISTENTES);
    var personas = leerFilasSeguro_(SHEETS.SGC_PERSONAS).filter(esActivoSgc_);
    var nombrePorId = {};
    personas.forEach(function (p) { nombrePorId[p.persona_id] = p.nombre; });

    var anio = data && data.anio ? Number(data.anio) : new Date().getFullYear();

    return {
      puede_gestionar: gobierna,
      anio: anio,
      capacitaciones: capacitaciones.map(function (c) {
        var suyos = asistentes.filter(function (a) { return a.capacitacion_id === c.capacitacion_id; });
        return {
          capacitacion_id: c.capacitacion_id,
          nombre: c.nombre,
          descripcion: c.descripcion,
          horas: Number(c.horas) || 0,
          fecha_programada: c.fecha_programada,
          fecha_realizada: c.fecha_realizada,
          relator: c.relator,
          estado: c.estado,
          total_convocados: suyos.length,
          total_asistieron: suyos.filter(function (a) { return esVerdaderoSgc_(a.asistio); }).length,
          // v10.0 Tanda A: la eficacia (FO-PRO-02-05 §2) es POR PARTICIPANTE
          // -- dos personas del mismo curso pueden tener resultado distinto.
          // eficacia_pendiente aca es a nivel de curso: al menos un asistente
          // sin evaluar todavia, util para la lista maestra.
          eficacia_pendiente: suyos.some(function (a) {
            return esVerdaderoSgc_(a.asistio) && eficaciaPendienteAsistenteSgc_(c, a);
          }),
          asistentes: suyos.map(function (a) {
            return {
              asistencia_id: a.asistencia_id,
              persona_id: a.persona_id,
              nombre: nombrePorId[a.persona_id] || a.persona_id,
              asistio: esVerdaderoSgc_(a.asistio),
              eficacia_fecha: a.eficacia_fecha,
              eficacia_resultado: a.eficacia_resultado,
              eficacia_observaciones: a.eficacia_observaciones,
              eficacia_pendiente: esVerdaderoSgc_(a.asistio) && eficaciaPendienteAsistenteSgc_(c, a)
            };
          })
        };
      }).sort(function (a, b) {
        return new Date(b.fecha_realizada || b.fecha_programada || 0) - new Date(a.fecha_realizada || a.fecha_programada || 0);
      }),
      // Horas de formacion por persona en el ano: alimenta el Objetivo 4
      // del DOC-07 (>= 5 hrs/colaborador/ano).
      horas_por_persona: horasFormacionPorPersonaSgc_(anio).map(function (h) {
        return {
          persona_id: h.persona_id,
          nombre: nombrePorId[h.persona_id] || h.persona_id,
          horas: h.horas,
          cumple_meta: h.horas >= META_HORAS_FORMACION_SGC
        };
      })
    };
  },

  guardarCapacitacion: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden gestionar capacitaciones.' };
    }
    if (data.accion === 'eliminar') {
      if (!data.capacitacion_id) return errorValidacion_('capacitacion_id', 'Falta indicar la capacitación.');
      return actualizarFilaPorId_(SHEETS.SGC_CAPACITACIONES, 'capacitacion_id', data.capacitacion_id, { activa: false });
    }
    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre del curso es obligatorio.');
    var horas = Number(data.horas);
    if (!(horas > 0)) return errorValidacion_('horas', 'Indica las horas de duración (mayor que cero).');

    if (data.capacitacion_id) {
      var cambios = {};
      ['nombre', 'descripcion', 'relator', 'fecha_programada'].forEach(function (campo) {
        if (data[campo] !== undefined) cambios[campo] = data[campo];
      });
      if (data.horas !== undefined) cambios.horas = horas;
      return actualizarFilaPorId_(SHEETS.SGC_CAPACITACIONES, 'capacitacion_id', data.capacitacion_id, cambios);
    }

    var capacitacion = {
      capacitacion_id: Utilities.getUuid(),
      nombre: nombre,
      descripcion: data.descripcion || '',
      horas: horas,
      fecha_programada: data.fecha_programada || '',
      fecha_realizada: '',
      relator: data.relator || '',
      estado: 'PROGRAMADA',
      creado_por: contexto.email || '',
      fecha_creacion: new Date().toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.SGC_CAPACITACIONES, capacitacion);
    registrarLogSgc_('SGC_CAPACITACION', nombre, contexto);
    return capacitacion;
  },

  // Marcar realizada + registrar quien asistio. Las horas del año solo
  // cuentan a quienes efectivamente asistieron.
  registrarRealizacion: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar la realización.' };
    }
    var c = buscarCapacitacionSgc_(data.capacitacion_id);
    if (!c) return errorValidacion_('capacitacion_id', 'Capacitación no encontrada.');

    var fechaRealizada = data.fecha_realizada || new Date().toISOString();
    var actualizada = actualizarFilaPorId_(SHEETS.SGC_CAPACITACIONES, 'capacitacion_id', c.capacitacion_id, {
      estado: 'REALIZADA',
      fecha_realizada: fechaRealizada,
      relator: data.relator || c.relator
    });

    // Se reescribe la lista de asistentes con lo que llega.
    var previos = leerFilasSeguro_(SHEETS.SGC_CAPACITACION_ASISTENTES)
      .filter(function (a) { return a.capacitacion_id === c.capacitacion_id; });
    var deseados = {};
    (data.asistentes || []).forEach(function (pid) { if (pid) deseados[pid] = true; });

    previos.forEach(function (a) {
      var debeEstar = !!deseados[a.persona_id];
      actualizarFilaPorId_(SHEETS.SGC_CAPACITACION_ASISTENTES, 'asistencia_id', a.asistencia_id, {
        asistio: debeEstar, fecha: fechaRealizada
      });
      delete deseados[a.persona_id];
    });
    Object.keys(deseados).forEach(function (pid) {
      agregarFila_(SHEETS.SGC_CAPACITACION_ASISTENTES, {
        asistencia_id: Utilities.getUuid(),
        capacitacion_id: c.capacitacion_id,
        persona_id: pid,
        asistio: true,
        fecha: fechaRealizada,
        eficacia_fecha: '', eficacia_resultado: '', eficacia_observaciones: ''
      });
    });
    registrarLogSgc_('SGC_CAPACITACION_REALIZADA', c.nombre, contexto);
    return actualizada;
  },

  // Eficacia a 60 dias (FO-PRO-02-05 §2, columna "Eficacia de la
  // capacitacion (60 dias despues)"): es POR PARTICIPANTE, no por curso --
  // el mismo curso puede haberle servido a una persona y no a otra.
  registrarEficaciaAsistente: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar la eficacia.' };
    }
    var c = buscarCapacitacionSgc_(data.capacitacion_id);
    if (!c) return errorValidacion_('capacitacion_id', 'Capacitación no encontrada.');
    if (c.estado !== 'REALIZADA') {
      return errorValidacion_('capacitacion_id', 'Solo se evalúa la eficacia de una capacitación ya realizada.');
    }
    var asistente = leerFilasSeguro_(SHEETS.SGC_CAPACITACION_ASISTENTES).filter(function (a) {
      return a.capacitacion_id === c.capacitacion_id && a.persona_id === data.persona_id;
    })[0];
    if (!asistente || !esVerdaderoSgc_(asistente.asistio)) {
      return errorValidacion_('persona_id', 'Esta persona no asistió a la capacitación.');
    }
    if (['EFICAZ', 'NO_EFICAZ'].indexOf(data.resultado) === -1) {
      return errorValidacion_('resultado', 'Indica si la capacitación fue eficaz o no para esta persona.');
    }
    if (data.resultado === 'NO_EFICAZ' && !String(data.observaciones || '').trim()) {
      return errorValidacion_('observaciones', 'Si no fue eficaz, explica por qué: es lo que justifica la siguiente acción.');
    }
    return actualizarFilaPorId_(SHEETS.SGC_CAPACITACION_ASISTENTES, 'asistencia_id', asistente.asistencia_id, {
      eficacia_fecha: data.fecha || new Date().toISOString(),
      eficacia_resultado: data.resultado,
      eficacia_observaciones: data.observaciones || ''
    });
  }
};

// --- motor de avisos de competencia (Fase 2b) -------------------------------
//
// SIN TRIGGER PROPIO, igual que todo lo demas del SGC: se cuelga de la
// pasada diaria de las 09:00 (ver Triggers.gs y la nota del limite de 20).
//
// CADENCIA POR TIPO DE AVISO. La pasada corre a diario, pero cada aviso usa
// una clave de evento distinta y enviarCorreo_ deduplica por esa clave, asi
// que la cadencia real la decide la clave:
//   - Evaluacion por vencer -> clave SEMANAL. Avisar todos los dias durante
//     30 dias conseguiria que la jefatura filtre el correo, no que evalue.
//   - Horas de formacion    -> clave SEMESTRAL, que es lo que pide la
//     especificacion para ese indicador.
//   - Eficacia pendiente    -> clave SEMANAL, solo al Encargado SGC.
Personas.recordatorioCompetencias = function () {
  var personas = leerFilasSeguro_(SHEETS.SGC_PERSONAS)
    .filter(function (p) { return esActivoSgc_(p) && p.estado !== 'DESVINCULADO'; });
  if (!personas.length) return { evaluaciones: 0, horas: 0, eficacia: 0 };

  var ahora = new Date();
  var claveSemana = inicioSemanaUTC_(ahora).toISOString().slice(0, 10);
  var encargados = leerFilasSeguro_(SHEETS.SGC_ROLES)
    .filter(function (r) { return esVerdaderoActivoSgc_(r) && r.rol_sgc === 'ENCARGADO_SGC'; })
    .map(function (r) { return normalizarEmailSgc_(r.usuario_email); })
    .filter(Boolean);

  // 1) Evaluaciones vencidas o por vencer (12 meses, aviso 30 dias antes).
  var evaluaciones = leerFilasSeguro_(SHEETS.SGC_EVALUACIONES);
  var ultimaPorPersona = {};
  evaluaciones.forEach(function (e) {
    var previa = ultimaPorPersona[e.persona_id];
    if (!previa || new Date(e.fecha) > new Date(previa.fecha)) ultimaPorPersona[e.persona_id] = e;
  });

  var pendientes = personas.filter(function (p) {
    var ultima = ultimaPorPersona[p.persona_id];
    // Quien nunca fue evaluado tambien cuenta: es el caso mas grave, y es
    // justo el que un sistema basado en "fecha de vencimiento" olvidaria.
    if (!ultima) return true;
    if (!ultima.proxima_evaluacion) return false;
    var dias = (new Date(ultima.proxima_evaluacion) - ahora) / 86400000;
    return dias <= 30;
  });

  var enviadosEval = 0;
  if (pendientes.length) {
    // Se agrupa por jefatura: cada jefe recibe UN correo con su equipo.
    var porJefe = {};
    pendientes.forEach(function (p) {
      var jefe = normalizarEmailSgc_(p.jefatura_email);
      if (!jefe) return;
      if (!porJefe[jefe]) porJefe[jefe] = [];
      porJefe[jefe].push(p);
    });
    // El Encargado SGC recibe la lista completa (es quien vela por el ciclo).
    encargados.forEach(function (email) {
      if (!porJefe[email]) porJefe[email] = pendientes;
    });

    Object.keys(porJefe).forEach(function (email) {
      var lista = porJefe[email];
      var items = lista.map(function (p) {
        var ultima = ultimaPorPersona[p.persona_id];
        if (!ultima) return '<li><strong>' + escaparHtmlCorreo_(p.nombre) + '</strong> — sin evaluación registrada</li>';
        var dias = Math.round((new Date(ultima.proxima_evaluacion) - ahora) / 86400000);
        return '<li><strong>' + escaparHtmlCorreo_(p.nombre) + '</strong> — ' +
          (dias < 0 ? 'evaluación VENCIDA hace ' + (-dias) + ' día(s)' : 'a evaluar en ' + dias + ' día(s)') + '</li>';
      }).join('');
      var asunto = 'SIGSO - ' + lista.length + ' evaluación(es) de competencia por hacer';
      var texto = 'Estas personas necesitan su evaluación de competencias (cada 12 meses):\n' +
        lista.map(function (p) { return '- ' + p.nombre; }).join('\n') +
        '\n\nEntra a SIGSO > Calidad > Personas para registrarla.';
      var html = plantillaCorreoHtml_('Evaluaciones de competencia pendientes',
        '<p>Estas personas necesitan su <strong>evaluación de competencias</strong> (cada 12 meses):</p>' +
        '<ul style="margin:0 0 12px 18px;padding:0;">' + items + '</ul>' +
        '<p>Entra a SIGSO &gt; Calidad &gt; Personas para registrarla.</p>');
      var r = enviarCorreo_('SGC_COMPETENCIA', email, 'SGC_EVAL_PENDIENTE:' + claveSemana,
        asunto, texto, null, { htmlBody: html });
      if (r && r.enviado) enviadosEval++;
      encolarNotificacionApp_(email, 'SGC_EVAL_PENDIENTE', 'Evaluaciones de competencia por hacer',
        lista.length + ' persona(s) esperan su evaluación.', 'calidad', 'Ver personas', 72);
    });
  }

  // 2) Horas de formacion bajo la meta del Objetivo 4 (aviso semestral).
  var anio = ahora.getFullYear();
  var semestre = ahora.getMonth() < 6 ? 'S1' : 'S2';
  var claveSemestre = anio + '-' + semestre;
  var bajoMeta = horasFormacionPorPersonaSgc_(anio)
    .filter(function (h) { return h.horas < META_HORAS_FORMACION_SGC; });

  var enviadosHoras = 0;
  if (bajoMeta.length) {
    var itemsHoras = bajoMeta.map(function (h) {
      return '<li><strong>' + escaparHtmlCorreo_(h.nombre) + '</strong> — ' + h.horas + ' de ' +
        META_HORAS_FORMACION_SGC + ' horas</li>';
    }).join('');
    var asuntoH = 'SIGSO - ' + bajoMeta.length + ' persona(s) bajo la meta de formación';
    var textoH = 'Estas personas están bajo la meta de ' + META_HORAS_FORMACION_SGC +
      ' horas de formación al año (Objetivo de Calidad N°4):\n' +
      bajoMeta.map(function (h) { return '- ' + h.nombre + ': ' + h.horas + ' hrs'; }).join('\n') +
      '\n\nEntra a SIGSO > Calidad > Capacitaciones para programar formación.';
    var htmlH = plantillaCorreoHtml_('Horas de formación bajo la meta',
      '<p>Estas personas están bajo la meta de <strong>' + META_HORAS_FORMACION_SGC +
      ' horas de formación al año</strong> (Objetivo de Calidad N°4):</p>' +
      '<ul style="margin:0 0 12px 18px;padding:0;">' + itemsHoras + '</ul>' +
      '<p>Entra a SIGSO &gt; Calidad &gt; Capacitaciones para programar formación.</p>');
    encargados.forEach(function (email) {
      var r = enviarCorreo_('SGC_FORMACION', email, 'SGC_HORAS_BAJO_META:' + claveSemestre,
        asuntoH, textoH, null, { htmlBody: htmlH });
      if (r && r.enviado) enviadosHoras++;
    });
  }

  // 3) Eficacia de capacitaciones pendiente (60 dias post-realizacion).
  // v10.0 Tanda A: es por PERSONA, no por curso -- se listan asistentes,
  // no capacitaciones (dos personas del mismo curso pueden estar en
  // situacion distinta: una ya evaluada, la otra no).
  var capacitacionesPorId = {};
  leerFilasSeguro_(SHEETS.SGC_CAPACITACIONES).filter(esActivoSgc_).forEach(function (c) {
    capacitacionesPorId[c.capacitacion_id] = c;
  });
  var nombrePorPersonaId = {};
  personas.forEach(function (p) { nombrePorPersonaId[p.persona_id] = p.nombre; });
  var sinEficacia = leerFilasSeguro_(SHEETS.SGC_CAPACITACION_ASISTENTES).filter(function (a) {
    var c = capacitacionesPorId[a.capacitacion_id];
    return c && esVerdaderoSgc_(a.asistio) && eficaciaPendienteAsistenteSgc_(c, a);
  }).map(function (a) {
    return { curso: capacitacionesPorId[a.capacitacion_id].nombre, persona: nombrePorPersonaId[a.persona_id] || a.persona_id };
  });
  var enviadosEficacia = 0;
  if (sinEficacia.length) {
    var itemsEf = sinEficacia.map(function (x) {
      return '<li><strong>' + escaparHtmlCorreo_(x.persona) + '</strong> — ' + escaparHtmlCorreo_(x.curso) + '</li>';
    }).join('');
    var asuntoE = 'SIGSO - ' + sinEficacia.length + ' eficacia(s) de capacitación sin evaluar';
    var textoE = 'Estos participantes cumplieron 60 días desde su capacitación y aún no tienen evaluación de eficacia:\n' +
      sinEficacia.map(function (x) { return '- ' + x.persona + ' (' + x.curso + ')'; }).join('\n');
    var htmlE = plantillaCorreoHtml_('Eficacia de capacitación pendiente',
      '<p>Estos participantes cumplieron <strong>60 días</strong> desde su capacitación y aún no tienen evaluación de eficacia:</p>' +
      '<ul style="margin:0 0 12px 18px;padding:0;">' + itemsEf + '</ul>');
    encargados.forEach(function (email) {
      var r = enviarCorreo_('SGC_FORMACION', email, 'SGC_EFICACIA_PENDIENTE:' + claveSemana,
        asuntoE, textoE, null, { htmlBody: htmlE });
      if (r && r.enviado) enviadosEficacia++;
    });
  }

  return { evaluaciones: enviadosEval, horas: enviadosHoras, eficacia: enviadosEficacia };
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

// Escala real del FO-PRO-02-04 (no una generica "1 a 4"): cada numero tiene
// un significado fijo que el formulario imprime como leyenda.
var ESCALA_EVALUACION_SGC = [
  { valor: 1, texto: 'No cumple' },
  { valor: 2, texto: 'Cumple en algunas ocasiones' },
  { valor: 3, texto: 'Cumple en la mayoría de los casos' },
  { valor: 4, texto: 'Cumple en su totalidad' }
];

// Promedio bajo este valor => necesidad de capacitacion (§5.1.E).
var UMBRAL_CAPACITACION_SGC = 3;
// Meta del Objetivo de Calidad N°4 (DOC-07): horas de formacion por
// colaborador al ano.
var META_HORAS_FORMACION_SGC = 5;

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

// --- items del descriptor (Tanda A) -----------------------------------------

// Acepta un arreglo ya armado (frontend) o una unica string con saltos de
// linea (por si llega de otra forma); descarta lineas vacias y recorta
// espacios. Nunca lanza: una entrada rara simplemente da una lista vacia,
// y guardarDescriptor_/registrarEvaluacion ya validan eso explicitamente.
function normalizarItemsDescriptor_(valor) {
  var lista = valor;
  if (typeof lista === 'string') lista = lista.split('\n');
  if (Object.prototype.toString.call(lista) !== '[object Array]') return [];
  return lista.map(function (s) { return String(s || '').trim(); }).filter(Boolean);
}

// El inverso de JSON.stringify(normalizarItemsDescriptor_(...)): nunca
// lanza, una celda corrupta (editada a mano en la hoja) da lista vacia en
// vez de tumbar toda la ficha o la evaluacion.
function parsearItemsDescriptor_(valor) {
  if (!valor) return [];
  if (Object.prototype.toString.call(valor) === '[object Array]') return valor;
  try {
    var parsed = JSON.parse(valor);
    return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
  } catch (err) {
    return [];
  }
}

function descriptorVigenteDe_(personaId) {
  var filas = leerFilasSeguro_(SHEETS.SGC_DESCRIPTORES).filter(function (d) {
    return d.persona_id === personaId && esVerdaderoSgc_(d.vigente);
  });
  return filas[0] || null;
}

// Empareja la lista de items del descriptor con los puntajes que llegaron
// (objeto { "0": valor, "1": valor, ... } o arreglo en el mismo orden).
// Devuelve [{item, valor}] o un _validationError si falta o esta fuera de
// escala alguno -- self-explanatorio: el formulario exige calificar TODOS
// los items del cargo, no una muestra.
function puntuarItemsEvaluacion_(items, respuestas) {
  var resultado = [];
  for (var i = 0; i < items.length; i++) {
    var crudo = respuestas ? respuestas[i] : undefined;
    var valor = Number(crudo);
    if (!(valor >= 1 && valor <= 4)) {
      return errorValidacion_('respuestas', 'Falta calificar "' + items[i] + '" (escala 1 a 4).');
    }
    resultado.push({ item: items[i], valor: valor });
  }
  return resultado;
}

function promedioItems_(puntuados) {
  if (!puntuados.length) return 0;
  var suma = 0;
  puntuados.forEach(function (p) { suma += p.valor; });
  return Math.round((suma / puntuados.length) * 100) / 100;
}

function buscarCapacitacionSgc_(capacitacionId) {
  if (!capacitacionId) return null;
  var filas = leerFilasSeguro_(SHEETS.SGC_CAPACITACIONES);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].capacitacion_id === capacitacionId && esActivoSgc_(filas[i])) return filas[i];
  }
  return null;
}

function sumarMesesSgc_(fecha, meses) {
  var f = new Date(fecha);
  if (isNaN(f.getTime())) return '';
  var r = new Date(f.getTime());
  r.setMonth(r.getMonth() + meses);
  return r.toISOString();
}

// Eficacia pendiente de un asistente: la capacitacion se realizo hace 60+
// dias y esa persona todavia no tiene resultado (v10.0 Tanda A: es por
// participante, ver la nota en SGC_CAPACITACION_ASISTENTES).
function eficaciaPendienteAsistenteSgc_(capacitacion, asistente) {
  if (capacitacion.estado !== 'REALIZADA' || asistente.eficacia_resultado) return false;
  if (!capacitacion.fecha_realizada) return false;
  var dias = (new Date() - new Date(capacitacion.fecha_realizada)) / 86400000;
  return dias >= 60;
}

// Horas de formacion acumuladas por persona en un ano. Solo cuentan las
// capacitaciones REALIZADAS y solo a quienes efectivamente asistieron.
function horasFormacionPorPersonaSgc_(anio) {
  var capacitaciones = leerFilasSeguro_(SHEETS.SGC_CAPACITACIONES).filter(function (c) {
    if (!esActivoSgc_(c) || c.estado !== 'REALIZADA' || !c.fecha_realizada) return false;
    var f = new Date(c.fecha_realizada);
    return !isNaN(f.getTime()) && f.getFullYear() === Number(anio);
  });
  var horasPorId = {};
  capacitaciones.forEach(function (c) { horasPorId[c.capacitacion_id] = Number(c.horas) || 0; });

  var acumulado = {};
  leerFilasSeguro_(SHEETS.SGC_CAPACITACION_ASISTENTES).forEach(function (a) {
    if (!esVerdaderoSgc_(a.asistio)) return;
    if (horasPorId[a.capacitacion_id] === undefined) return;
    acumulado[a.persona_id] = (acumulado[a.persona_id] || 0) + horasPorId[a.capacitacion_id];
  });

  // Toda persona vigente aparece, aunque tenga 0 horas: justamente esas
  // son las que hay que ver (§4 de los objetivos de calidad).
  return leerFilasSeguro_(SHEETS.SGC_PERSONAS)
    .filter(function (p) { return esActivoSgc_(p) && p.estado !== 'DESVINCULADO'; })
    .map(function (p) {
      return { persona_id: p.persona_id, nombre: p.nombre, horas: acumulado[p.persona_id] || 0 };
    })
    .sort(function (a, b) { return a.horas - b.horas; }); // los que menos tienen, primero
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
