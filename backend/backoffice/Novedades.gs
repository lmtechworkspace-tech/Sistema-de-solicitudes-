/**
 * Novedades.gs — modulo Novedades (v6.5).
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
 * restringir quien lo ve.
 *
 * QUIEN PUEDE PUBLICAR: un Administrador (cualquier area, o "general"), o
 * quien figure como responsable_email de un area en CAT_AREAS (solo esa
 * area). Se verifica en el servidor -- el area que llega en `data` nunca se
 * confia por si sola.
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
  // tarea de administracion diaria.
  var TIPOS = {
    LEY: { etiqueta: 'Ley / Normativa', color: 'critico' },
    DICTAMEN: { etiqueta: 'Dictamen', color: 'alerta' },
    PROCEDIMIENTO: { etiqueta: 'Procedimiento interno', color: 'info' },
    AVISO: { etiqueta: 'Aviso', color: 'info' },
    CAPACITACION: { etiqueta: 'Capacitación', color: 'ok' },
    LOGRO: { etiqueta: 'Logro / Reconocimiento', color: 'ok' },
    COMERCIAL: { etiqueta: 'Comercial / Cliente', color: 'alerta' }
  };

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

  function nombreArea_(areaId) {
    if (!areaId) return '';
    var area = leerFilasSeguro_(SHEETS.CAT_AREAS).filter(function (a) { return a.area_id === areaId; })[0];
    return area ? area.nombre : areaId;
  }

  function buscarNovedad_(novedadId) {
    return filasNovedades_().filter(function (n) { return n.novedad_id === novedadId; })[0] || null;
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
          return { tipo: t, etiqueta: TIPOS[t].etiqueta, color: TIPOS[t].color };
        })
      };
    },

    /**
     * Feed de novedades activas, mas reciente primero, con si el lector
     * autenticado ya dio el acuse. `resumen.pendientes` es lo que alimenta
     * el badge de "no leidas" en el nav/Home -- se calcula aqui mismo para
     * no pedirlo en una llamada aparte.
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
     * para no inflar el feed con texto largo de cada novedad).
     */
    getDetalle: function (data, contexto) {
      if (!data || !data.novedad_id) {
        return errorValidacion_('novedad_id', 'Falta indicar la novedad.');
      }
      var n = buscarNovedad_(data.novedad_id);
      if (!n) return errorValidacion_('novedad_id', 'No existe esa novedad.');

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
        fecha_publicacion: n.fecha_publicacion,
        leida: leida,
        puede_gestionar: esAutorONoAutor_(n, contexto)
      };
    },

    /**
     * Publica una novedad. El area SI se valida contra CAT_AREAS.
     * responsable_email en el servidor -- que el formulario solo ofrezca
     * las areas propias no alcanza, porque un cliente manipulado podria
     * mandar cualquier area_id.
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
        fecha_publicacion: new Date().toISOString(),
        activa: true
      };

      agregarFila_(SHEETS.NOVEDADES, novedad);
      return { novedad_id: novedad.novedad_id };
    },

    /**
     * Retira una novedad (no la borra: activa=false). Solo el autor o ADM.
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
    }
  };
})();
