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

    // v10.0 Fase 2b: historial de evaluaciones, mas reciente primero.
    var evaluaciones = leerFilasSeguro_(SHEETS.SGC_EVALUACIONES)
      .filter(function (e) { return e.persona_id === persona.persona_id; })
      .sort(function (a, b) { return new Date(b.fecha || 0) - new Date(a.fecha || 0); });
    var ultimaEval = evaluaciones[0] || null;

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
      items_evaluacion: ITEMS_EVALUACION_SGC,
      evaluaciones: evaluaciones,
      ultima_evaluacion: ultimaEval,
      evaluacion_vencida: !ultimaEval || (ultimaEval.proxima_evaluacion &&
        new Date(ultimaEval.proxima_evaluacion) < new Date()),
      // Horas de formacion del ano en curso (Objetivo de Calidad N°4).
      horas_formacion_anio: (horasFormacionPorPersonaSgc_(new Date().getFullYear())
        .filter(function (h) { return h.persona_id === persona.persona_id; })[0] || { horas: 0 }).horas,
      meta_horas_formacion: META_HORAS_FORMACION_SGC,
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
  },

  // --- Monitoreo de competencias (FO-PRO-02-04, Fase 2b) --------------------
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

    var puntajes = {};
    var faltante = null;
    ITEMS_EVALUACION_SGC.forEach(function (item) {
      var valor = Number(data[item.clave]);
      if (!(valor >= 1 && valor <= 4)) faltante = item.clave;
      puntajes[item.clave] = valor;
    });
    if (faltante) {
      return errorValidacion_(faltante, 'Cada ítem se califica de 1 a 4.');
    }

    var suma = 0;
    ITEMS_EVALUACION_SGC.forEach(function (item) { suma += puntajes[item.clave]; });
    var promedio = Math.round((suma / ITEMS_EVALUACION_SGC.length) * 100) / 100;
    var fecha = data.fecha || new Date().toISOString();

    var evaluacion = {
      evaluacion_id: Utilities.getUuid(),
      persona_id: persona.persona_id,
      fecha: fecha,
      evaluador_email: normalizarEmailSgc_(contexto.email),
      r1: puntajes.r1, r2: puntajes.r2, r3: puntajes.r3, r4: puntajes.r4,
      h1: puntajes.h1, h2: puntajes.h2, h3: puntajes.h3, h4: puntajes.h4,
      promedio: promedio,
      // Regla de la especificacion: promedio bajo 3 dispara la necesidad de
      // capacitacion. Se DERIVA del puntaje, no se marca a mano -- asi no
      // puede quedar en desacuerdo con la evaluacion real.
      requiere_capacitacion: promedio < UMBRAL_CAPACITACION_SGC,
      observaciones: data.observaciones || '',
      proxima_evaluacion: sumarMesesSgc_(fecha, 12)
    };
    agregarFila_(SHEETS.SGC_EVALUACIONES, evaluacion);
    registrarLogSgc_('SGC_EVALUACION', persona.nombre + ' promedio ' + promedio, contexto);

    if (evaluacion.requiere_capacitacion) {
      // El hallazgo no sirve si se queda en la planilla: se avisa al
      // Encargado SGC, que es quien programa la capacitacion.
      leerFilasSeguro_(SHEETS.SGC_ROLES).forEach(function (r) {
        if (esVerdaderoActivoSgc_(r) && r.rol_sgc === 'ENCARGADO_SGC') {
          encolarNotificacionApp_(r.usuario_email, 'SGC_COMPETENCIA',
            'Necesidad de capacitación detectada',
            persona.nombre + ' obtuvo promedio ' + promedio + ' en su evaluación de competencias.',
            'calidad', 'Ver ficha', 72);
        }
      });
    }
    return evaluacion;
  },

  // --- Capacitaciones (FO-PRO-02-03 programa / FO-PRO-02-05 registro) -------
  listarCapacitaciones: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
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
          eficacia_fecha: c.eficacia_fecha,
          eficacia_resultado: c.eficacia_resultado,
          // Aviso derivado: la especificacion pide evaluar la eficacia a 60
          // dias de realizada. Se calcula al leer, nunca queda desfasado.
          eficacia_pendiente: eficaciaPendienteSgc_(c),
          total_convocados: suyos.length,
          total_asistieron: suyos.filter(function (a) { return esVerdaderoSgc_(a.asistio); }).length,
          asistentes: suyos.map(function (a) {
            return {
              asistencia_id: a.asistencia_id,
              persona_id: a.persona_id,
              nombre: nombrePorId[a.persona_id] || a.persona_id,
              asistio: esVerdaderoSgc_(a.asistio)
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
      eficacia_fecha: '',
      eficacia_resultado: '',
      eficacia_observaciones: '',
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
        fecha: fechaRealizada
      });
    });
    registrarLogSgc_('SGC_CAPACITACION_REALIZADA', c.nombre, contexto);
    return actualizada;
  },

  // Eficacia a 60 dias (FO-PRO-02-05): ¿sirvió la capacitación?
  registrarEficacia: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar la eficacia.' };
    }
    var c = buscarCapacitacionSgc_(data.capacitacion_id);
    if (!c) return errorValidacion_('capacitacion_id', 'Capacitación no encontrada.');
    if (c.estado !== 'REALIZADA') {
      return errorValidacion_('capacitacion_id', 'Solo se evalúa la eficacia de una capacitación ya realizada.');
    }
    if (['EFICAZ', 'NO_EFICAZ'].indexOf(data.resultado) === -1) {
      return errorValidacion_('resultado', 'Indica si la capacitación fue eficaz o no.');
    }
    if (data.resultado === 'NO_EFICAZ' && !String(data.observaciones || '').trim()) {
      return errorValidacion_('observaciones', 'Si no fue eficaz, explica por qué: es lo que justifica la siguiente acción.');
    }
    return actualizarFilaPorId_(SHEETS.SGC_CAPACITACIONES, 'capacitacion_id', c.capacitacion_id, {
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
  var sinEficacia = leerFilasSeguro_(SHEETS.SGC_CAPACITACIONES)
    .filter(function (c) { return esActivoSgc_(c) && eficaciaPendienteSgc_(c); });
  var enviadosEficacia = 0;
  if (sinEficacia.length) {
    var itemsEf = sinEficacia.map(function (c) {
      return '<li><strong>' + escaparHtmlCorreo_(c.nombre) + '</strong> — realizada el ' +
        String(c.fecha_realizada).slice(0, 10) + '</li>';
    }).join('');
    var asuntoE = 'SIGSO - ' + sinEficacia.length + ' capacitación(es) sin evaluar su eficacia';
    var textoE = 'Estas capacitaciones cumplieron 60 días y aún no tienen evaluación de eficacia:\n' +
      sinEficacia.map(function (c) { return '- ' + c.nombre; }).join('\n');
    var htmlE = plantillaCorreoHtml_('Eficacia de capacitación pendiente',
      '<p>Estas capacitaciones cumplieron <strong>60 días</strong> y aún no tienen evaluación de eficacia:</p>' +
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

// Los 8 items del monitoreo de competencias (FO-PRO-02-04): 4 de
// responsabilidades + 4 de habilidades, escala 1 a 4.
//
// NOTA PARA QUIEN MANTENGA ESTO: los textos de abajo son una redaccion
// razonable de lo que evalua ese formulario. Si el FO-PRO-02-04 real de la
// empresa usa otra redaccion, se cambia AQUI (solo el texto) y la interfaz
// se actualiza sola -- los puntajes se guardan en r1..r4/h1..h4, que no
// dependen del texto.
var ITEMS_EVALUACION_SGC = [
  { clave: 'r1', grupo: 'Responsabilidades', texto: 'Cumple las funciones definidas en su descriptor de cargo' },
  { clave: 'r2', grupo: 'Responsabilidades', texto: 'Cumple los plazos comprometidos' },
  { clave: 'r3', grupo: 'Responsabilidades', texto: 'Aplica los procedimientos del SGC en su trabajo' },
  { clave: 'r4', grupo: 'Responsabilidades', texto: 'Reporta oportunamente problemas y desviaciones' },
  { clave: 'h1', grupo: 'Habilidades', texto: 'Conocimiento técnico requerido por el cargo' },
  { clave: 'h2', grupo: 'Habilidades', texto: 'Comunicación y trabajo en equipo' },
  { clave: 'h3', grupo: 'Habilidades', texto: 'Autonomía y resolución de problemas' },
  { clave: 'h4', grupo: 'Habilidades', texto: 'Orientación al cliente y calidad del servicio' }
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

// Eficacia pendiente: realizada hace 60+ dias y todavia sin evaluar.
function eficaciaPendienteSgc_(capacitacion) {
  if (capacitacion.estado !== 'REALIZADA' || capacitacion.eficacia_resultado) return false;
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
