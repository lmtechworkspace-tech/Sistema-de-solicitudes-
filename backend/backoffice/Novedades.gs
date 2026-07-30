/**
 * Novedades.gs — modulo Novedades (v6.5) + Fase 4 (v6.6, gobierno de la
 * informacion: aprobacion por jefatura).
 *
 * Nace de un problema concreto: "hoy dia estan saliendo 4 o 5 leyes y no le
 * hemos avisado a nadie" -- informacion que cada area produce (leyes,
 * dictamenes, procedimientos, avisos, capacitaciones, logros, novedades
 * comerciales) pero que no quedaba en ningun lugar visible ni con
 * responsable claro de publicarla.
 *
 * DECISION DE DISEÑO IMPORTANTE: el area de una novedad es ETIQUETA, no
 * audiencia. SIGSO no modela "a que area pertenece cada persona" -- CAT_AREAS
 * solo guarda quien es el RESPONSABLE de publicar por esa area, no quienes
 * son sus miembros. Por eso no existe (ni se inventa aqui) un calculo de
 * "esto te afecta a ti": todo lo publicado es visible para cualquier
 * identidad autenticada, y el area sirve para filtrar/mostrar, nunca para
 * restringir quien lo ve. (Fase 5 traera audiencia dirigida -- esta fase
 * sigue publicando "a todos" una vez aprobada, igual que antes.)
 *
 * QUIEN PUEDE PUBLICAR: un Administrador (cualquier area, o "general"), o
 * quien figure como responsable_email de un area en CAT_AREAS (solo esa
 * area). Se verifica en el servidor -- el area que llega en `data` nunca se
 * confia por si sola.
 *
 * FASE 4 (gobierno): dos carriles segun el tipo. LIBRE (Aviso, Logro) se
 * publica directo, igual que antes. CONTROLADO (Ley, Dictamen,
 * Procedimiento, Capacitacion, Comercial) entra en EN_REVISION y necesita
 * que la JEFATURA del redactor (o ADM) la apruebe antes de publicarse --
 * puede tambien devolverla con un motivo (el autor corrige y reenvia) o
 * rechazarla (terminal). La jefatura se resuelve con la MISMA hoja
 * JEFATURAS que usa "Mi Departamento" (jefeDeSubordinado_, en Jefatura.gs):
 * no hay configuracion nueva que mantener. Cada transicion queda en
 * NOVEDADES_HISTORIAL -- el "hilo" de correccion de una novedad.
 *
 * ACUSE DE LECTURA: NOVEDADES_LECTURAS vive aparte del contenido (una fila
 * por lector, no una columna que crezca). El lector se deriva SIEMPRE de
 * `contexto.email` -- el mismo patron de seguridad que Perfiles.gs: nadie
 * puede marcar como leido algo a nombre de otra persona, porque no hay
 * ningun parametro para indicar de quien es la lectura.
 */

var Novedades = (function () {
  // Enum fijo (no un catalogo editable): son 7 categorias conocidas de
  // antemano, y agregar una nueva es un cambio de codigo deliberado, no una
  // tarea de administracion diaria. carril decide si pasa por aprobacion:
  // LIBRE = bajo riesgo (avisos, reconocimientos), CONTROLADO = alto
  // impacto/normativo, exige el visto bueno de una jefatura.
  var TIPOS = {
    LEY: { etiqueta: 'Ley / Normativa', color: 'critico', carril: 'CONTROLADO' },
    DICTAMEN: { etiqueta: 'Dictamen', color: 'alerta', carril: 'CONTROLADO' },
    PROCEDIMIENTO: { etiqueta: 'Procedimiento interno', color: 'info', carril: 'CONTROLADO' },
    AVISO: { etiqueta: 'Aviso', color: 'info', carril: 'LIBRE' },
    CAPACITACION: { etiqueta: 'Capacitación', color: 'ok', carril: 'CONTROLADO' },
    LOGRO: { etiqueta: 'Logro / Reconocimiento', color: 'ok', carril: 'LIBRE' },
    COMERCIAL: { etiqueta: 'Comercial / Cliente', color: 'alerta', carril: 'CONTROLADO' }
  };

  // v6.6: no existe un estado "borrador" separado -- para un tipo
  // CONTROLADO, redactar y enviar a revision es un solo paso (igual que
  // crear una solicitud). DEVUELTA es lo mas parecido a un borrador
  // editable: el autor corrige y reenvia, lo que la vuelve a EN_REVISION.
  var ESTADOS = {
    EN_REVISION: 'EN_REVISION',
    DEVUELTA: 'DEVUELTA',
    RECHAZADA: 'RECHAZADA',
    PUBLICADA: 'PUBLICADA'
  };

  var MOTIVO_MIN_CARACTERES = 10;

  var MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;
  // Firma PDF (%PDF): unico formato soportado para el adjunto en esta
  // primera fase -- es lo que cubre el caso real (ley/dictamen en PDF).
  var FIRMA_PDF = [0x25, 0x50, 0x44, 0x46];

  function esPdf_(bytes) {
    if (!bytes || bytes.length < FIRMA_PDF.length) return false;
    for (var i = 0; i < FIRMA_PDF.length; i++) {
      if ((bytes[i] & 0xFF) !== FIRMA_PDF[i]) return false;
    }
    return true;
  }

  function normalizarEmail_(email) {
    return String(email || '').trim().toLowerCase();
  }

  function filasNovedades_() {
    try {
      return leerFilas_(SHEETS.NOVEDADES);
    } catch (err) {
      return []; // instalacion sin la hoja todavia
    }
  }

  function filasLecturas_() {
    try {
      return leerFilas_(SHEETS.NOVEDADES_LECTURAS);
    } catch (err) {
      return [];
    }
  }

  function filasHistorial_(novedadId) {
    var todas;
    try {
      todas = leerFilas_(SHEETS.NOVEDADES_HISTORIAL);
    } catch (err) {
      return [];
    }
    return todas
      .filter(function (h) { return h.novedad_id === novedadId; })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
  }

  function registrarHistorial_(novedadId, evento, contexto, comentario) {
    agregarFila_(SHEETS.NOVEDADES_HISTORIAL, {
      historial_id: Utilities.getUuid(),
      novedad_id: novedadId,
      evento: evento,
      autor_email: contexto.email,
      // contexto solo trae {email, rol} -- no hay nombre resuelto en el
      // circuito de identidad, ni para Google ni para portal.
      autor_nombre: contexto.email,
      comentario: comentario || '',
      timestamp: new Date().toISOString()
    });
  }

  // areas donde esta persona puede publicar: todas si es ADM, o solo
  // aquella(s) donde figura como responsable_email en CAT_AREAS.
  function areasPublicables_(contexto) {
    var areas = leerFilasSeguro_(SHEETS.CAT_AREAS).filter(function (a) {
      return a.activo === true || a.activo === 'TRUE' || a.activo === 1;
    });
    if (contexto.rol === 'ADM') return areas;
    var correo = normalizarEmail_(contexto.email);
    return areas.filter(function (a) { return normalizarEmail_(a.responsable_email) === correo; });
  }

  // Puede publicar EN ESA area especifica (o "general", solo ADM).
  function puedePublicarEnArea_(contexto, areaId) {
    if (contexto.rol === 'ADM') return true;
    if (!areaId) return false; // "general" (sin area) es exclusivo de ADM
    return areasPublicables_(contexto).some(function (a) { return a.area_id === areaId; });
  }

  function esAutorONoAutor_(novedad, contexto) {
    return contexto.rol === 'ADM' || normalizarEmail_(novedad.autor_email) === normalizarEmail_(contexto.email);
  }

  // v6.6: quien puede aprobar/devolver/rechazar una novedad de este autor --
  // ADM (siempre) o su jefatura directa (JEFATURAS, la misma relacion que
  // usa "Mi Departamento"). jefeDeSubordinado_ vive en Jefatura.gs.
  function puedeAprobar_(contexto, autorEmail) {
    if (contexto.rol === 'ADM') return true;
    var jefe = jefeDeSubordinado_(autorEmail);
    return !!jefe && normalizarEmail_(jefe) === normalizarEmail_(contexto.email);
  }

  // Visible en el detalle: publicada (para cualquiera, como siempre), o
  // sigue en el circuito de aprobacion y el que consulta es el autor o su
  // jefatura/ADM -- una novedad EN_REVISION/DEVUELTA/RECHAZADA no es
  // publica todavia.
  function puedeVerDetalle_(novedad, contexto) {
    if (novedad.estado === ESTADOS.PUBLICADA) return true;
    return esAutorONoAutor_(novedad, contexto) || puedeAprobar_(contexto, novedad.autor_email);
  }

  function nombreArea_(areaId) {
    if (!areaId) return '';
    var area = leerFilasSeguro_(SHEETS.CAT_AREAS).filter(function (a) { return a.area_id === areaId; })[0];
    return area ? area.nombre : areaId;
  }

  function buscarNovedad_(novedadId) {
    return filasNovedades_().filter(function (n) { return n.novedad_id === novedadId; })[0] || null;
  }

  // "Audiencia" = cualquiera con credenciales de la plataforma (§ misma
  // idea del acuse: obligatorio, pero solo tiene sentido si se puede
  // verificar QUIEN falta). Union de USUARIOS activos (login Google) y los
  // correos de CUENTAS_PORTAL activas (portal). Sin duplicados.
  function audienciaNovedades_() {
    var vistos = {};
    var lista = [];
    leerFilasSeguro_(SHEETS.USUARIOS).forEach(function (u) {
      var activo = u.activo === true || u.activo === 'TRUE' || u.activo === 1;
      var email = normalizarEmail_(u.email);
      if (activo && email && !vistos[email]) {
        vistos[email] = true;
        lista.push({ email: email, nombre: u.nombre || email });
      }
    });
    leerCuentasPortal_().forEach(function (c) {
      var activa = c.activo === true || c.activo === 'TRUE' || c.activo === 1;
      if (!activa) return;
      parsearListaPortal_(c.emails).forEach(function (email) {
        email = normalizarEmail_(email);
        if (email && !vistos[email]) {
          vistos[email] = true;
          lista.push({ email: email, nombre: c.nombre || email });
        }
      });
    });
    return lista;
  }

  // v6.6: destinatarios de "tienes algo para revisar" -- la jefatura del
  // autor. Si no tiene jefatura asignada en JEFATURAS (dato de
  // configuracion, no deberia faltar para quien publica controlado, pero no
  // se asume), cae a todo ADM activo para que igual alguien la vea.
  function destinatariosRevision_(autorEmail) {
    var jefe = jefeDeSubordinado_(autorEmail);
    if (jefe) return [normalizarEmail_(jefe)];
    return leerFilasSeguro_(SHEETS.USUARIOS)
      .filter(function (u) {
        var activo = u.activo === true || u.activo === 'TRUE' || u.activo === 1;
        return activo && u.rol === 'ADM';
      })
      .map(function (u) { return normalizarEmail_(u.email); });
  }

  function notificarNuevaRevision_(novedad) {
    var tipoInfo = TIPOS[novedad.tipo] || { etiqueta: novedad.tipo };
    var asunto = 'SIGSO - Novedad por aprobar: ' + novedad.titulo;
    var cuerpoTexto = tipoInfo.etiqueta + ' de ' + novedad.autor_nombre + ': ' + novedad.titulo +
      '\n\n' + novedad.resumen + '\n\nEntra a SIGSO > Novedades > Por aprobar para revisarla.';
    var cuerpoHtml = plantillaCorreoHtml_('Novedad por aprobar',
      '<p><span style="display:inline-block;background:#FAEED6;color:#B5760E;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:bold;">' +
        escaparHtmlCorreo_(tipoInfo.etiqueta) + '</span></p>' +
      '<h3 style="margin:8px 0;">' + escaparHtmlCorreo_(novedad.titulo) + '</h3>' +
      '<p>Redactada por <strong>' + escaparHtmlCorreo_(novedad.autor_nombre) + '</strong>.</p>' +
      '<p>' + escaparHtmlCorreo_(novedad.resumen) + '</p>' +
      '<p>Entra a SIGSO &gt; Novedades &gt; Por aprobar para revisarla.</p>');
    // v6.6: el evento incluye un id unico por llamada -- una novedad puede
    // entrar a revision varias veces (devuelta -> corregida -> reenviada) y
    // CADA reenvio debe avisar de nuevo a la jefatura. Si el evento fuera
    // fijo, el dedup de enviarCorreo_ (30 min) silenciaria el aviso del
    // reenvio si ocurre poco despues del primero.
    var evento = 'NOVEDAD_EN_REVISION:' + Utilities.getUuid();
    destinatariosRevision_(novedad.autor_email).forEach(function (email) {
      enviarCorreo_(novedad.novedad_id, email, evento, asunto, cuerpoTexto, null, { htmlBody: cuerpoHtml });
    });
  }

  function notificarDecisionAutor_(novedad, evento, asunto, encabezadoHtml, motivo) {
    var cuerpoTexto = novedad.titulo + '\n\n' + (motivo ? 'Motivo: ' + motivo + '\n\n' : '') +
      'Entra a SIGSO > Novedades > Mis envíos para revisarla.';
    var cuerpoHtml = plantillaCorreoHtml_(encabezadoHtml,
      '<h3 style="margin:8px 0;">' + escaparHtmlCorreo_(novedad.titulo) + '</h3>' +
      (motivo ? '<p><strong>Motivo:</strong> ' + escaparHtmlCorreo_(motivo) + '</p>' : '') +
      '<p>Entra a SIGSO &gt; Novedades &gt; Mis envíos para revisarla.</p>');
    enviarCorreo_(novedad.novedad_id, novedad.autor_email, evento, asunto, cuerpoTexto, null, { htmlBody: cuerpoHtml });
  }

  // Aviso inmediato SOLO para tipo LEY (lo urgente: rige en X dias, no puede
  // esperar al recordatorio diario). El resto de tipos se descubren por el
  // badge del feed y, si siguen sin leerse, por recordatorioPendientes().
  // v6.6: se dispara al APROBAR (antes se disparaba al publicar, pero LEY
  // ahora siempre pasa por revision primero).
  function notificarPublicacionLey_(novedad) {
    var autor = normalizarEmail_(novedad.autor_email);
    var asunto = 'SIGSO - Nueva novedad: ' + novedad.titulo;
    var cuerpoTexto = TIPOS.LEY.etiqueta + ': ' + novedad.titulo + '\n\n' + novedad.resumen +
      '\n\nEntra a SIGSO > Novedades para verla completa y confirmar "Enterado".';
    var cuerpoHtml = plantillaCorreoHtml_('Nueva novedad publicada',
      '<p><span style="display:inline-block;background:#FDECEC;color:#B42318;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:bold;">' +
        escaparHtmlCorreo_(TIPOS.LEY.etiqueta) + '</span></p>' +
      '<h3 style="margin:8px 0;">' + escaparHtmlCorreo_(novedad.titulo) + '</h3>' +
      '<p>' + escaparHtmlCorreo_(novedad.resumen) + '</p>' +
      '<p>Entra a SIGSO &gt; Novedades para verla completa y confirmar "Enterado".</p>');
    audienciaNovedades_().forEach(function (persona) {
      if (persona.email === autor) return;
      enviarCorreo_(novedad.novedad_id, persona.email, 'NOVEDAD_PUBLICADA', asunto, cuerpoTexto, null, { htmlBody: cuerpoHtml });
    });
  }

  // Datos livianos para las listas de aprobacion/mis envios -- sin cuerpo,
  // igual criterio que getFeed (no inflar la lista con texto largo).
  function resumenNovedad_(n) {
    var tipoInfo = TIPOS[n.tipo] || { etiqueta: n.tipo, color: 'info' };
    return {
      novedad_id: n.novedad_id,
      tipo: n.tipo,
      tipo_etiqueta: tipoInfo.etiqueta,
      tipo_color: tipoInfo.color,
      titulo: n.titulo,
      resumen: n.resumen,
      area_nombre: n.area_nombre,
      autor_email: n.autor_email,
      autor_nombre: n.autor_nombre,
      estado: n.estado,
      motivo_devolucion: n.motivo_devolucion || '',
      fecha_creacion: n.fecha_creacion
    };
  }

  return {
    /**
     * Areas donde el usuario autenticado puede publicar (para el selector
     * del formulario). ADM ve todas; el resto ve solo las suyas.
     */
    listarAreasPublicables: function (data, contexto) {
      return {
        areas: areasPublicables_(contexto).map(function (a) {
          return { area_id: a.area_id, nombre: a.nombre };
        }),
        puede_general: contexto.rol === 'ADM',
        tipos: Object.keys(TIPOS).map(function (t) {
          return { tipo: t, etiqueta: TIPOS[t].etiqueta, color: TIPOS[t].color, carril: TIPOS[t].carril };
        })
      };
    },

    /**
     * Feed de novedades PUBLICADAS, mas reciente primero, con si el lector
     * autenticado ya dio el acuse. `resumen.pendientes` es lo que alimenta
     * el badge de "no leidas" en el nav/Home -- se calcula aqui mismo para
     * no pedirlo en una llamada aparte. Lo que sigue en revision/devuelto/
     * rechazado NO aparece aqui (ver misPendientes/listarPendientesAprobacion).
     */
    getFeed: function (data, contexto) {
      var correo = normalizarEmail_(contexto.email);
      var leidasPorMi = {};
      filasLecturas_().forEach(function (l) {
        if (normalizarEmail_(l.usuario_email) === correo) leidasPorMi[l.novedad_id] = l.leido_en;
      });

      var filtroTipo = data && data.tipo;
      var filtroArea = data && data.area_id;

      var activas = filasNovedades_().filter(function (n) {
        return n.activa === true || n.activa === 'TRUE' || n.activa === 1;
      });

      var recientes = activas
        .filter(function (n) { return !filtroTipo || n.tipo === filtroTipo; })
        .filter(function (n) { return !filtroArea || n.area_id === filtroArea; })
        .map(function (n) {
          var tipoInfo = TIPOS[n.tipo] || { etiqueta: n.tipo, color: 'info' };
          return {
            novedad_id: n.novedad_id,
            tipo: n.tipo,
            tipo_etiqueta: tipoInfo.etiqueta,
            tipo_color: tipoInfo.color,
            titulo: n.titulo,
            resumen: n.resumen,
            area_id: n.area_id,
            area_nombre: n.area_nombre,
            autor_email: n.autor_email,
            autor_nombre: n.autor_nombre,
            requiere_acuse: !!(n.requiere_acuse === true || n.requiere_acuse === 'TRUE' || n.requiere_acuse === 1),
            fecha_vigencia: n.fecha_vigencia || '',
            tiene_adjunto: !!n.archivo_id,
            fecha_publicacion: n.fecha_publicacion,
            leida: !!leidasPorMi[n.novedad_id],
            puede_gestionar: esAutorONoAutor_(n, contexto)
          };
        })
        .sort(function (a, b) { return new Date(b.fecha_publicacion) - new Date(a.fecha_publicacion); });

      var pendientes = recientes.filter(function (n) { return n.requiere_acuse && !n.leida; }).length;

      return { recientes: recientes, resumen: { pendientes: pendientes, total: recientes.length } };
    },

    /**
     * Detalle completo (incluye el cuerpo, que getFeed omite a proposito
     * para no inflar el feed con texto largo de cada novedad). v6.6: si NO
     * esta publicada, solo la ve el autor o quien puede aprobarla.
     */
    getDetalle: function (data, contexto) {
      if (!data || !data.novedad_id) {
        return errorValidacion_('novedad_id', 'Falta indicar la novedad.');
      }
      var n = buscarNovedad_(data.novedad_id);
      if (!n) return errorValidacion_('novedad_id', 'No existe esa novedad.');
      if (!puedeVerDetalle_(n, contexto)) {
        return { _forbidden: true, message: 'Esta novedad todavía no está publicada.' };
      }

      var correo = normalizarEmail_(contexto.email);
      var leida = filasLecturas_().some(function (l) {
        return l.novedad_id === n.novedad_id && normalizarEmail_(l.usuario_email) === correo;
      });
      var tipoInfo = TIPOS[n.tipo] || { etiqueta: n.tipo, color: 'info' };

      return {
        novedad_id: n.novedad_id,
        tipo: n.tipo,
        tipo_etiqueta: tipoInfo.etiqueta,
        tipo_color: tipoInfo.color,
        carril: tipoInfo.carril,
        titulo: n.titulo,
        resumen: n.resumen,
        cuerpo: n.cuerpo,
        area_id: n.area_id,
        area_nombre: n.area_nombre,
        autor_email: n.autor_email,
        autor_nombre: n.autor_nombre,
        requiere_acuse: !!(n.requiere_acuse === true || n.requiere_acuse === 'TRUE' || n.requiere_acuse === 1),
        fecha_vigencia: n.fecha_vigencia || '',
        tiene_adjunto: !!n.archivo_id,
        archivo_nombre: n.archivo_nombre || '',
        estado: n.estado || ESTADOS.PUBLICADA,
        motivo_devolucion: n.motivo_devolucion || '',
        fecha_creacion: n.fecha_creacion || n.fecha_publicacion,
        fecha_publicacion: n.fecha_publicacion,
        leida: leida,
        puede_gestionar: esAutorONoAutor_(n, contexto),
        puede_aprobar: puedeAprobar_(contexto, n.autor_email),
        es_autor: normalizarEmail_(n.autor_email) === correo
      };
    },

    /**
     * Historial de una novedad (el hilo de correccion). Misma visibilidad
     * que getDetalle.
     */
    getHistorial: function (data, contexto) {
      if (!data || !data.novedad_id) {
        return errorValidacion_('novedad_id', 'Falta indicar la novedad.');
      }
      var n = buscarNovedad_(data.novedad_id);
      if (!n) return errorValidacion_('novedad_id', 'No existe esa novedad.');
      if (!puedeVerDetalle_(n, contexto)) {
        return { _forbidden: true, message: 'Esta novedad todavía no está publicada.' };
      }
      return { eventos: filasHistorial_(n.novedad_id) };
    },

    /**
     * Crea una novedad. El area SI se valida contra CAT_AREAS.responsable_email
     * en el servidor -- que el formulario solo ofrezca las areas propias no
     * alcanza, porque un cliente manipulado podria mandar cualquier area_id.
     *
     * v6.6: bifurca por carril. LIBRE (Aviso, Logro) se publica de
     * inmediato, igual que siempre. CONTROLADO entra en EN_REVISION y
     * notifica a la jefatura del autor -- no queda visible en el feed
     * publico hasta que se aprueba.
     */
    publicar: function (data, contexto) {
      data = data || {};
      if (!TIPOS[data.tipo]) {
        return errorValidacion_('tipo', 'Tipo de novedad invalido.');
      }
      if (!data.titulo || !String(data.titulo).trim()) {
        return errorValidacion_('titulo', 'Falta el titulo.');
      }
      if (!data.resumen || !String(data.resumen).trim()) {
        return errorValidacion_('resumen', 'Falta el resumen.');
      }
      var areaId = data.area_id || '';
      if (!puedePublicarEnArea_(contexto, areaId)) {
        return {
          _forbidden: true,
          message: areaId
            ? 'No eres responsable de esa area: no puedes publicar en ella.'
            : 'Solo un Administrador puede publicar sin area (general).'
        };
      }

      var archivo = { archivo_id: '', archivo_nombre: '', archivo_mime: '' };
      if (data.contenido_base64) {
        if (!data.nombre_archivo) {
          return errorValidacion_('nombre_archivo', 'Falta el nombre del archivo adjunto.');
        }
        var bytes;
        try {
          bytes = Utilities.base64Decode(data.contenido_base64);
        } catch (err) {
          return errorValidacion_('contenido_base64', 'El adjunto no es base64 valido.');
        }
        if (bytes.length > MAX_ADJUNTO_BYTES) {
          return errorValidacion_(
            'contenido_base64',
            'El adjunto supera el tamano maximo (' + Math.round(MAX_ADJUNTO_BYTES / (1024 * 1024)) + ' MB).'
          );
        }
        if (!esPdf_(bytes)) {
          return errorValidacion_('contenido_base64', 'El adjunto debe ser un PDF.');
        }
        var carpeta = obtenerCarpetaNovedades_();
        var blob = Utilities.newBlob(bytes, 'application/pdf', data.nombre_archivo);
        var archivoDrive = carpeta.createFile(blob);
        archivo = {
          archivo_id: archivoDrive.getId(),
          archivo_nombre: data.nombre_archivo,
          archivo_mime: 'application/pdf'
        };
      }

      var carril = TIPOS[data.tipo].carril;
      var ahora = new Date().toISOString();
      var esLibre = carril === 'LIBRE';

      var novedad = {
        novedad_id: Utilities.getUuid(),
        tipo: data.tipo,
        titulo: String(data.titulo).trim(),
        resumen: String(data.resumen).trim(),
        cuerpo: data.cuerpo || '',
        area_id: areaId,
        area_nombre: nombreArea_(areaId),
        autor_email: contexto.email,
        autor_nombre: data.autor_nombre || contexto.email,
        // Por defecto exige acuse: el punto de partida de este modulo es
        // que "alguien se haga responsable" de que la info llegue, y eso se
        // demuestra con el acuse -- no al reves.
        requiere_acuse: data.requiere_acuse === false ? false : true,
        fecha_vigencia: data.fecha_vigencia || '',
        archivo_id: archivo.archivo_id,
        archivo_nombre: archivo.archivo_nombre,
        archivo_mime: archivo.archivo_mime,
        estado: esLibre ? ESTADOS.PUBLICADA : ESTADOS.EN_REVISION,
        fecha_creacion: ahora,
        aprobador_email: '',
        aprobador_nombre: '',
        fecha_aprobacion: '',
        motivo_devolucion: '',
        fecha_publicacion: esLibre ? ahora : '',
        activa: esLibre
      };

      agregarFila_(SHEETS.NOVEDADES, novedad);

      if (esLibre) {
        // Sin revision: nada que registrar en el historial (nunca cambio de
        // estado) ni que avisar mas alla del feed normal.
        return { novedad_id: novedad.novedad_id, estado: novedad.estado };
      }

      registrarHistorial_(novedad.novedad_id, 'ENVIADA_REVISION', contexto, '');
      notificarNuevaRevision_(novedad);
      return { novedad_id: novedad.novedad_id, estado: novedad.estado };
    },

    /**
     * v6.6: la jefatura del autor (o ADM) aprueba -- publica de inmediato
     * (audiencia = todos, igual que el resto del modulo por ahora; Fase 5
     * traera la eleccion de audiencia). Solo desde EN_REVISION.
     */
    aprobar: function (data, contexto) {
      if (!data || !data.novedad_id) {
        return errorValidacion_('novedad_id', 'Falta indicar la novedad.');
      }
      var n = buscarNovedad_(data.novedad_id);
      if (!n) return errorValidacion_('novedad_id', 'No existe esa novedad.');
      if (n.estado !== ESTADOS.EN_REVISION) {
        return errorValidacion_('novedad_id', 'Esta novedad no está esperando aprobación.');
      }
      if (!puedeAprobar_(contexto, n.autor_email)) {
        return { _forbidden: true, message: 'Solo la jefatura de quien la redactó, o un Administrador, puede aprobarla.' };
      }

      var ahora = new Date().toISOString();
      var cambios = {
        estado: ESTADOS.PUBLICADA,
        activa: true,
        fecha_publicacion: ahora,
        aprobador_email: contexto.email,
        aprobador_nombre: data.aprobador_nombre || contexto.email,
        fecha_aprobacion: ahora
      };
      actualizarFilaPorId_(SHEETS.NOVEDADES, 'novedad_id', n.novedad_id, cambios);
      registrarHistorial_(n.novedad_id, 'APROBADA', contexto, data.comentario || '');

      if (n.tipo === 'LEY') {
        notificarPublicacionLey_(Object.assign({}, n, cambios));
      }
      return { estado: ESTADOS.PUBLICADA };
    },

    /**
     * v6.6: devuelve para corregir -- vuelve a manos del autor con un
     * motivo obligatorio (mismo umbral de 10 caracteres que usa Derivación
     * en Solicitudes.gs). El autor la edita y la reenvia con
     * Novedades.reenviar.
     */
    devolver: function (data, contexto) {
      if (!data || !data.novedad_id) {
        return errorValidacion_('novedad_id', 'Falta indicar la novedad.');
      }
      var motivo = String((data && data.motivo) || '').trim();
      if (motivo.length < MOTIVO_MIN_CARACTERES) {
        return errorValidacion_('motivo', 'El motivo debe tener al menos ' + MOTIVO_MIN_CARACTERES + ' caracteres.');
      }
      var n = buscarNovedad_(data.novedad_id);
      if (!n) return errorValidacion_('novedad_id', 'No existe esa novedad.');
      if (n.estado !== ESTADOS.EN_REVISION) {
        return errorValidacion_('novedad_id', 'Esta novedad no está esperando aprobación.');
      }
      if (!puedeAprobar_(contexto, n.autor_email)) {
        return { _forbidden: true, message: 'Solo la jefatura de quien la redactó, o un Administrador, puede devolverla.' };
      }

      actualizarFilaPorId_(SHEETS.NOVEDADES, 'novedad_id', n.novedad_id, {
        estado: ESTADOS.DEVUELTA,
        motivo_devolucion: motivo
      });
      registrarHistorial_(n.novedad_id, 'DEVUELTA', contexto, motivo);
      notificarDecisionAutor_(n, 'NOVEDAD_DEVUELTA', 'SIGSO - Tu novedad fue devuelta para corregir: ' + n.titulo,
        'Novedad devuelta para corregir', motivo);
      return { estado: ESTADOS.DEVUELTA };
    },

    /**
     * v6.6: rechaza -- terminal, no vuelve a manos del autor (a diferencia
     * de devolver). Motivo obligatorio, mismo umbral.
     */
    rechazar: function (data, contexto) {
      if (!data || !data.novedad_id) {
        return errorValidacion_('novedad_id', 'Falta indicar la novedad.');
      }
      var motivo = String((data && data.motivo) || '').trim();
      if (motivo.length < MOTIVO_MIN_CARACTERES) {
        return errorValidacion_('motivo', 'El motivo debe tener al menos ' + MOTIVO_MIN_CARACTERES + ' caracteres.');
      }
      var n = buscarNovedad_(data.novedad_id);
      if (!n) return errorValidacion_('novedad_id', 'No existe esa novedad.');
      if (n.estado !== ESTADOS.EN_REVISION) {
        return errorValidacion_('novedad_id', 'Esta novedad no está esperando aprobación.');
      }
      if (!puedeAprobar_(contexto, n.autor_email)) {
        return { _forbidden: true, message: 'Solo la jefatura de quien la redactó, o un Administrador, puede rechazarla.' };
      }

      actualizarFilaPorId_(SHEETS.NOVEDADES, 'novedad_id', n.novedad_id, {
        estado: ESTADOS.RECHAZADA,
        motivo_devolucion: motivo
      });
      registrarHistorial_(n.novedad_id, 'RECHAZADA', contexto, motivo);
      notificarDecisionAutor_(n, 'NOVEDAD_RECHAZADA', 'SIGSO - Tu novedad fue rechazada: ' + n.titulo,
        'Novedad rechazada', motivo);
      return { estado: ESTADOS.RECHAZADA };
    },

    /**
     * v6.6: el autor corrige una novedad DEVUELTA y la reenvia a revision.
     * Solo el autor (no ADM en su nombre: es su texto). Los campos son
     * opcionales -- lo que no venga en `data` se mantiene igual.
     */
    reenviar: function (data, contexto) {
      if (!data || !data.novedad_id) {
        return errorValidacion_('novedad_id', 'Falta indicar la novedad.');
      }
      var n = buscarNovedad_(data.novedad_id);
      if (!n) return errorValidacion_('novedad_id', 'No existe esa novedad.');
      if (normalizarEmail_(n.autor_email) !== normalizarEmail_(contexto.email)) {
        return { _forbidden: true, message: 'Solo quien la redactó puede corregirla y reenviarla.' };
      }
      if (n.estado !== ESTADOS.DEVUELTA) {
        return errorValidacion_('novedad_id', 'Esta novedad no está devuelta para corrección.');
      }

      var cambios = { estado: ESTADOS.EN_REVISION, motivo_devolucion: '' };
      if (data.titulo && String(data.titulo).trim()) cambios.titulo = String(data.titulo).trim();
      if (data.resumen && String(data.resumen).trim()) cambios.resumen = String(data.resumen).trim();
      if (data.cuerpo !== undefined) cambios.cuerpo = data.cuerpo || '';
      if (data.fecha_vigencia !== undefined) cambios.fecha_vigencia = data.fecha_vigencia || '';

      actualizarFilaPorId_(SHEETS.NOVEDADES, 'novedad_id', n.novedad_id, cambios);
      registrarHistorial_(n.novedad_id, 'ENVIADA_REVISION', contexto, 'Reenviada tras corrección.');
      notificarNuevaRevision_(Object.assign({}, n, cambios));
      return { estado: ESTADOS.EN_REVISION };
    },

    /**
     * v6.6: novedades EN_REVISION de mi equipo (o de cualquiera si soy ADM)
     * -- la bandeja de "Por aprobar". Vacia si no soy jefatura de nadie ni
     * ADM (no es un error: simplemente nada que aprobar).
     */
    listarPendientesAprobacion: function (data, contexto) {
      var enRevision = filasNovedades_().filter(function (n) { return n.estado === ESTADOS.EN_REVISION; });
      var propias;
      if (contexto.rol === 'ADM') {
        propias = enRevision;
      } else {
        var equipoSet = {};
        obtenerEquipoJefe_(contexto.email).forEach(function (email) { equipoSet[normalizarEmail_(email)] = true; });
        propias = enRevision.filter(function (n) { return equipoSet[normalizarEmail_(n.autor_email)]; });
      }
      return {
        pendientes: propias
          .map(resumenNovedad_)
          .sort(function (a, b) { return new Date(a.fecha_creacion) - new Date(b.fecha_creacion); })
      };
    },

    /**
     * v6.6: mis novedades que todavia no estan publicadas (en revision,
     * devueltas para corregir, o rechazadas) -- "Mis envíos".
     */
    misPendientes: function (data, contexto) {
      var correo = normalizarEmail_(contexto.email);
      var propias = filasNovedades_().filter(function (n) {
        return normalizarEmail_(n.autor_email) === correo && n.estado !== ESTADOS.PUBLICADA;
      });
      return {
        envios: propias
          .map(resumenNovedad_)
          .sort(function (a, b) { return new Date(b.fecha_creacion) - new Date(a.fecha_creacion); })
      };
    },

    /**
     * Retira una novedad PUBLICADA (no la borra: activa=false). Solo el
     * autor o ADM.
     */
    despublicar: function (data, contexto) {
      if (!data || !data.novedad_id) {
        return errorValidacion_('novedad_id', 'Falta indicar la novedad.');
      }
      var n = buscarNovedad_(data.novedad_id);
      if (!n) return errorValidacion_('novedad_id', 'No existe esa novedad.');
      if (!esAutorONoAutor_(n, contexto)) {
        return { _forbidden: true, message: 'Solo quien la publico o un Administrador puede retirarla.' };
      }
      actualizarFilaPorId_(SHEETS.NOVEDADES, 'novedad_id', n.novedad_id, { activa: false });
      return { activa: false };
    },

    /**
     * Acuse de lectura. La identidad de quien lee sale SIEMPRE de
     * `contexto.email`: no hay ningun campo en `data` que identifique al
     * lector, asi que no existe forma de marcar "leido" a nombre de otro.
     * Idempotente: si ya habia acuse, no crea uno nuevo.
     */
    marcarLeida: function (data, contexto) {
      if (!data || !data.novedad_id) {
        return errorValidacion_('novedad_id', 'Falta indicar la novedad.');
      }
      if (!buscarNovedad_(data.novedad_id)) {
        return errorValidacion_('novedad_id', 'No existe esa novedad.');
      }
      var correo = normalizarEmail_(contexto.email);
      var yaLeida = filasLecturas_().some(function (l) {
        return l.novedad_id === data.novedad_id && normalizarEmail_(l.usuario_email) === correo;
      });
      if (!yaLeida) {
        agregarFila_(SHEETS.NOVEDADES_LECTURAS, {
          lectura_id: Utilities.getUuid(),
          novedad_id: data.novedad_id,
          usuario_email: contexto.email,
          leido_en: new Date().toISOString()
        });
      }
      return { leida: true };
    },

    /**
     * Adjunto en base64 para descargar (patron identico a
     * OrdenTrabajo.descargar): el original en Drive es privado, asi que se
     * sirve por esta accion en vez de exponer una URL publica.
     */
    descargarAdjunto: function (data, contexto) {
      if (!data || !data.novedad_id) {
        return errorValidacion_('novedad_id', 'Falta indicar la novedad.');
      }
      var n = buscarNovedad_(data.novedad_id);
      if (!n) return errorValidacion_('novedad_id', 'No existe esa novedad.');
      if (!n.archivo_id) return errorValidacion_('novedad_id', 'Esta novedad no tiene adjunto.');

      var archivo = DriveApp.getFileById(n.archivo_id);
      return {
        contenido_base64: Utilities.base64Encode(archivo.getBlob().getBytes()),
        nombre_archivo: n.archivo_nombre || archivo.getName(),
        mime: n.archivo_mime || 'application/pdf'
      };
    },

    /**
     * Fase 2: quien ya dio el acuse y quien falta, para que "obligatorio" se
     * pueda verificar. Solo el autor o ADM -- el mismo criterio de
     * esAutorONoAutor_ que usa despublicar, no una lista nueva de permisos.
     */
    getLectores: function (data, contexto) {
      if (!data || !data.novedad_id) {
        return errorValidacion_('novedad_id', 'Falta indicar la novedad.');
      }
      var n = buscarNovedad_(data.novedad_id);
      if (!n) return errorValidacion_('novedad_id', 'No existe esa novedad.');
      if (!esAutorONoAutor_(n, contexto)) {
        return { _forbidden: true, message: 'Solo quien publico la novedad o un Administrador puede ver quien la leyo.' };
      }

      var leidoPorEmail = {};
      filasLecturas_().forEach(function (l) {
        if (l.novedad_id === n.novedad_id) leidoPorEmail[normalizarEmail_(l.usuario_email)] = l.leido_en;
      });

      var leyeron = [];
      var pendientes = [];
      audienciaNovedades_().forEach(function (persona) {
        if (leidoPorEmail[persona.email]) {
          leyeron.push({ email: persona.email, nombre: persona.nombre, leido_en: leidoPorEmail[persona.email] });
        } else {
          pendientes.push({ email: persona.email, nombre: persona.nombre });
        }
      });
      leyeron.sort(function (a, b) { return new Date(a.leido_en) - new Date(b.leido_en); });
      pendientes.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre)); });

      return { leyeron: leyeron, pendientes: pendientes, total_audiencia: leyeron.length + pendientes.length };
    },

    /**
     * Fase 2: recordatorio diario a quien tiene novedades sin confirmar. UN
     * correo por persona con TODAS sus pendientes (no uno por novedad, para
     * no saturar). El evento incluye la fecha del dia -- mismo patron que
     * detectarPatrones (Triggers.gs): no reenvia el mismo dia, pero si al
     * siguiente si sigue pendiente.
     */
    recordatorioPendientes: function () {
      var activasConAcuse = filasNovedades_().filter(function (n) {
        var activa = n.activa === true || n.activa === 'TRUE' || n.activa === 1;
        var requiereAcuse = n.requiere_acuse === true || n.requiere_acuse === 'TRUE' || n.requiere_acuse === 1;
        return activa && requiereAcuse;
      });
      if (!activasConAcuse.length) return { enviados: 0 };

      var leidoPor = {}; // novedad_id -> { email: true }
      filasLecturas_().forEach(function (l) {
        var id = l.novedad_id;
        if (!leidoPor[id]) leidoPor[id] = {};
        leidoPor[id][normalizarEmail_(l.usuario_email)] = true;
      });

      var hoy = new Date().toISOString().slice(0, 10);
      var enviados = 0;

      audienciaNovedades_().forEach(function (persona) {
        var pendientes = activasConAcuse.filter(function (n) {
          return normalizarEmail_(n.autor_email) !== persona.email &&
            !(leidoPor[n.novedad_id] && leidoPor[n.novedad_id][persona.email]);
        });
        if (!pendientes.length) return;

        var items = pendientes.map(function (n) {
          var tipoInfo = TIPOS[n.tipo] || { etiqueta: n.tipo };
          return '<li><strong>' + escaparHtmlCorreo_(tipoInfo.etiqueta) + '</strong> — ' + escaparHtmlCorreo_(n.titulo) + '</li>';
        }).join('');
        var asunto = 'SIGSO - Tienes ' + pendientes.length + ' novedad(es) pendiente(s) de confirmar';
        var cuerpoTexto = 'Tienes ' + pendientes.length + ' novedad(es) publicadas en SIGSO que aun no confirmas como leidas:\n' +
          pendientes.map(function (n) { return '- ' + n.titulo; }).join('\n') +
          '\n\nEntra a SIGSO > Novedades para revisarlas y marcar "Enterado".';
        var cuerpoHtml = plantillaCorreoHtml_('Novedades pendientes',
          '<p>Tienes <strong>' + pendientes.length + '</strong> novedad(es) publicadas en SIGSO que aun no confirmas como leidas:</p>' +
          '<ul style="margin:0 0 12px 18px;padding:0;">' + items + '</ul>' +
          '<p>Entra a SIGSO &gt; Novedades para revisarlas y marcar "Enterado".</p>');

        var resultado = enviarCorreo_(
          'NOVEDADES_DIGEST', persona.email, 'NOVEDAD_RECORDATORIO:' + hoy,
          asunto, cuerpoTexto, null, { htmlBody: cuerpoHtml }
        );
        if (resultado.enviado) enviados++;
      });

      return { enviados: enviados };
    }
  };
})();
