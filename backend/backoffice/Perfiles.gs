/**
 * Perfiles.gs — foto de perfil del usuario (v6.4).
 *
 * REGLA CENTRAL DE SEGURIDAD: ninguna accion de escritura recibe un
 * identificador de usuario. La fila de PERFILES sobre la que se escribe se
 * deriva SIEMPRE de `contexto`, que Code.gs construyo desde la sesion de
 * Google (Session.getActiveUser) o desde el token del portal
 * (SESIONES_PORTAL -> CUENTAS_PORTAL). Aunque el navegador mienta, no hay
 * parametro que falsificar: no existe.
 *
 * POR QUE HAY DOS REPRESENTACIONES DE LA FOTO:
 *   - foto_file_id -> el ORIGINAL en Drive, privado. Referencia estable.
 *   - foto_thumb   -> miniatura cuadrada como data URI, en la hoja. Es lo
 *     que se pinta en pantalla.
 * La URL de vista de Drive (getUrl) apunta a una pagina, no a los bytes: no
 * sirve en un <img>. La alternativa seria publicar el archivo, y las fotos
 * de personas no deben quedar accesibles para cualquiera con el enlace. La
 * miniatura resuelve el render sin exponer nada y sin una lectura de Drive
 * por cada avatar.
 *
 * QUIEN GENERA LA MINIATURA: el navegador (Canvas), porque Apps Script no
 * tiene ninguna API de redimensionado de imagenes. Eso significa que la
 * miniatura llega desde el cliente y por lo tanto NO se confia en ella: se
 * valida por firma binaria igual que el original, y el data URI que se
 * guarda se reconstruye aqui con el mime DETECTADO, nunca con el declarado.
 * Asi un SVG con script (que es texto y falla la firma) no puede colarse.
 */

var Perfiles = (function () {
  // 5 MB para el original, como el resto de adjuntos del sistema.
  var MAX_ORIGINAL_BYTES = 5 * 1024 * 1024;
  // La celda de Sheets admite 50.000 caracteres. Se corta bastante antes
  // para dejar margen y para que una miniatura "gorda" no pase inadvertida:
  // 160px de lado en JPEG ronda los 8-14k caracteres.
  var MAX_THUMB_CHARS = 35000;
  var CACHE_TTL_SEGUNDOS = 300;

  // Firmas binarias (magic numbers). El mime que declara el navegador se
  // ignora por completo: mandan estos bytes.
  var FIRMAS_IMAGEN = [
    { mime: 'image/jpeg', firma: [0xFF, 0xD8, 0xFF] },
    { mime: 'image/png', firma: [0x89, 0x50, 0x4E, 0x47] }
  ];

  // WebP no se puede expresar como prefijo simple: son "RIFF" en 0..3 y
  // "WEBP" en 8..11, con el tamano del archivo en medio.
  function esWebp_(bytes) {
    if (!bytes || bytes.length < 12) return false;
    var riff = [0x52, 0x49, 0x46, 0x46];
    var webp = [0x57, 0x45, 0x42, 0x50];
    for (var i = 0; i < 4; i++) {
      if ((bytes[i] & 0xFF) !== riff[i]) return false;
      if ((bytes[8 + i] & 0xFF) !== webp[i]) return false;
    }
    return true;
  }

  function detectarMimeImagen_(bytes) {
    if (!bytes || !bytes.length) return null;
    for (var i = 0; i < FIRMAS_IMAGEN.length; i++) {
      var candidato = FIRMAS_IMAGEN[i];
      var coincide = true;
      for (var j = 0; j < candidato.firma.length; j++) {
        // Apps Script entrega bytes con signo; & 0xFF los normaliza.
        if ((bytes[j] & 0xFF) !== candidato.firma[j]) { coincide = false; break; }
      }
      if (coincide) return candidato.mime;
    }
    return esWebp_(bytes) ? 'image/webp' : null;
  }

  function extensionDeMime_(mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    return 'jpg';
  }

  // --- Identidad: el corazon del modelo de permisos -----------------------

  // contexto -> {tipo, clave}. GOOGLE se identifica por email normalizado
  // (asi se busca en USUARIOS); PORTAL por cuenta_id (una cuenta puede tener
  // varios correos, el email no seria una llave estable).
  function identidadDe_(contexto) {
    if (!contexto) return null;
    if (contexto.via_portal) {
      return contexto.cuenta_id
        ? { tipo: 'PORTAL', clave: String(contexto.cuenta_id) }
        : null;
    }
    return contexto.email
      ? { tipo: 'GOOGLE', clave: normalizarEmail_(contexto.email) }
      : null;
  }

  function normalizarEmail_(email) {
    return String(email || '').trim().toLowerCase();
  }

  function filasPerfiles_() {
    try {
      return leerFilas_(SHEETS.PERFILES);
    } catch (err) {
      return []; // instalacion que todavia no corrio el Instalador
    }
  }

  function buscarPerfil_(identidad) {
    if (!identidad) return null;
    var filas = filasPerfiles_();
    for (var i = 0; i < filas.length; i++) {
      if (filas[i].identidad_tipo === identidad.tipo &&
          String(filas[i].identidad_clave) === identidad.clave) {
        return filas[i];
      }
    }
    return null;
  }

  function claveCache_(identidad) {
    return 'perfil_thumb::' + identidad.tipo + '::' + identidad.clave;
  }

  function invalidarCache_(identidad) {
    try {
      CacheService.getScriptCache().remove(claveCache_(identidad));
    } catch (err) {
      // El cache es un acelerador, no una fuente de verdad: si falla, se
      // sigue leyendo de la hoja.
    }
  }

  // --- Datos de solo lectura, cada uno de su fuente de verdad -------------

  // No se copian nombre/rol/empresa a PERFILES: se leen de donde ya viven,
  // para que no haya dos versiones del mismo dato.
  function datosIdentidad_(contexto, identidad) {
    if (identidad.tipo === 'PORTAL') {
      var cuenta = leerFilasSeguro_(SHEETS.CUENTAS_PORTAL).filter(function (c) {
        return String(c.cuenta_id) === identidad.clave;
      })[0] || {};
      return {
        nombre: cuenta.nombre || contexto.email || '',
        email: contexto.email || '',
        cargo: cuenta.cargo || '',
        rol: cuenta.rol || contexto.rol || '',
        empresa_id: cuenta.empresa_id || ''
      };
    }
    var usuario = leerFilasSeguro_(SHEETS.USUARIOS).filter(function (u) {
      return normalizarEmail_(u.email) === identidad.clave;
    })[0] || {};
    return {
      nombre: usuario.nombre || contexto.email || '',
      email: usuario.email || contexto.email || '',
      cargo: '',
      rol: usuario.rol || contexto.rol || '',
      empresa_id: usuario.empresa_id || ''
    };
  }

  function nombreEmpresa_(empresaId) {
    if (!empresaId) return '';
    var fila = leerFilasSeguro_(SHEETS.CAT_EMPRESAS).filter(function (e) {
      return e.empresa_id === empresaId;
    })[0];
    return fila ? (fila.nombre || empresaId) : empresaId;
  }

  // --- Resolucion email -> foto, para los avatares en lote ---------------

  // Los comentarios y el historial guardan al autor como CORREO, no como
  // identidad. Para pintar su avatar hay que buscar en las dos poblaciones:
  // primero GOOGLE (la clave ES el correo) y si no, PORTAL (el correo esta
  // dentro de la lista `emails` de alguna cuenta).
  function indiceThumbsPorEmail_() {
    var porClave = {};
    filasPerfiles_().forEach(function (p) {
      if (p.foto_thumb) {
        porClave[p.identidad_tipo + '::' + String(p.identidad_clave)] = p.foto_thumb;
      }
    });

    var indice = {};
    Object.keys(porClave).forEach(function (k) {
      if (k.indexOf('GOOGLE::') === 0) {
        indice[k.slice('GOOGLE::'.length)] = porClave[k];
      }
    });

    // Las cuentas de portal se resuelven por su lista de correos. Se hace
    // despues para que, si una persona existe en ambas poblaciones, gane su
    // perfil de Google (el correo es suyo de forma inequivoca).
    leerFilasSeguro_(SHEETS.CUENTAS_PORTAL).forEach(function (cuenta) {
      var thumb = porClave['PORTAL::' + String(cuenta.cuenta_id)];
      if (!thumb) return;
      parsearListaPortal_(cuenta.emails).forEach(function (correo) {
        var clave = normalizarEmail_(correo);
        if (clave && !indice[clave]) indice[clave] = thumb;
      });
    });
    return indice;
  }

  return {
    /**
     * Perfil del usuario autenticado. Los datos de identidad son de solo
     * lectura y salen de su fuente de verdad (USUARIOS o CUENTAS_PORTAL).
     */
    getMiPerfil: function (data, contexto) {
      var identidad = identidadDe_(contexto);
      if (!identidad) {
        return { _forbidden: true, message: 'No fue posible resolver tu identidad.' };
      }
      var perfil = buscarPerfil_(identidad);
      var base = datosIdentidad_(contexto, identidad);

      return {
        nombre: base.nombre,
        email: base.email,
        cargo: base.cargo,
        rol: base.rol,
        empresa_id: base.empresa_id,
        empresa_nombre: nombreEmpresa_(base.empresa_id),
        // El origen sirve al frontend para rotular de donde viene la cuenta;
        // no es un identificador utilizable para escribir.
        origen: identidad.tipo,
        tiene_foto: !!(perfil && perfil.foto_thumb),
        foto_thumb: (perfil && perfil.foto_thumb) || ''
      };
    },

    /**
     * Guarda (o reemplaza) la foto del usuario autenticado.
     * data: { contenido_base64, nombre_archivo, thumb_base64 }
     * Ningun campo identifica al usuario: eso sale de `contexto`.
     */
    guardarFoto: function (data, contexto) {
      var identidad = identidadDe_(contexto);
      if (!identidad) {
        return { _forbidden: true, message: 'No fue posible resolver tu identidad.' };
      }
      if (!data || !data.contenido_base64 || !data.thumb_base64) {
        return errorValidacion_('foto', 'Falta la imagen (original y miniatura).');
      }

      var bytes;
      var bytesThumb;
      try {
        bytes = Utilities.base64Decode(data.contenido_base64);
        bytesThumb = Utilities.base64Decode(data.thumb_base64);
      } catch (err) {
        return errorValidacion_('foto', 'El contenido de la imagen no es base64 valido.');
      }

      if (bytes.length > MAX_ORIGINAL_BYTES) {
        return errorValidacion_(
          'foto',
          'La imagen supera el tamano maximo permitido (' +
            Math.round(MAX_ORIGINAL_BYTES / (1024 * 1024)) + ' MB).'
        );
      }

      // Firma binaria en AMBAS: la extension y el mime del navegador no se
      // toman en cuenta, asi un ejecutable renombrado a .jpg no pasa.
      var mime = detectarMimeImagen_(bytes);
      if (!mime) {
        return errorValidacion_('foto', 'Formato no permitido. Usa JPG, PNG o WebP.');
      }
      var mimeThumb = detectarMimeImagen_(bytesThumb);
      if (!mimeThumb) {
        return errorValidacion_('foto', 'La miniatura generada no es una imagen valida.');
      }
      if (data.thumb_base64.length > MAX_THUMB_CHARS) {
        return errorValidacion_('foto', 'La miniatura generada es demasiado grande.');
      }

      var perfilPrevio = buscarPerfil_(identidad);

      // El original va a Drive SIN setSharing: hereda los permisos de la
      // carpeta raiz, que es privada.
      var carpeta = obtenerCarpetaPerfiles_();
      var nombre = 'perfil-' + identidad.tipo + '-' + identidad.clave + '.' + extensionDeMime_(mime);
      var archivo = carpeta.createFile(Utilities.newBlob(bytes, mime, nombre));

      // El data URI se arma con el mime DETECTADO, no con el que mando el
      // cliente: es lo que evita que un `data:image/svg+xml,<script>` acabe
      // dentro de un <img> de la pagina.
      var thumbUri = 'data:' + mimeThumb + ';base64,' + data.thumb_base64;
      var ahora = new Date().toISOString();

      if (perfilPrevio) {
        actualizarFilaPorId_(SHEETS.PERFILES, 'perfil_id', perfilPrevio.perfil_id, {
          foto_file_id: archivo.getId(),
          foto_thumb: thumbUri,
          foto_mime: mimeThumb,
          actualizado_en: ahora
        });
        // La foto anterior queda huerfana en Drive si no se retira.
        descartarArchivoDrive_(perfilPrevio.foto_file_id);
      } else {
        agregarFila_(SHEETS.PERFILES, {
          perfil_id: Utilities.getUuid(),
          identidad_tipo: identidad.tipo,
          identidad_clave: identidad.clave,
          foto_file_id: archivo.getId(),
          foto_thumb: thumbUri,
          foto_mime: mimeThumb,
          actualizado_en: ahora
        });
      }

      invalidarCache_(identidad);
      return { tiene_foto: true, foto_thumb: thumbUri };
    },

    /**
     * Quita la foto del usuario autenticado. La fila de PERFILES se conserva
     * (la identidad no se borra): solo se vacian los campos de la foto, y el
     * avatar vuelve a las iniciales.
     */
    eliminarFoto: function (data, contexto) {
      var identidad = identidadDe_(contexto);
      if (!identidad) {
        return { _forbidden: true, message: 'No fue posible resolver tu identidad.' };
      }
      var perfil = buscarPerfil_(identidad);
      if (!perfil || !perfil.foto_thumb) {
        return { tiene_foto: false, foto_thumb: '' };
      }

      actualizarFilaPorId_(SHEETS.PERFILES, 'perfil_id', perfil.perfil_id, {
        foto_file_id: '',
        foto_thumb: '',
        foto_mime: '',
        actualizado_en: new Date().toISOString()
      });
      descartarArchivoDrive_(perfil.foto_file_id);

      invalidarCache_(identidad);
      return { tiene_foto: false, foto_thumb: '' };
    },

    /**
     * Avatares en lote: una sola llamada para toda una lista de comentarios
     * o de historial, en vez de una por autor.
     * data: { emails: [...] } -> { fotos: { correo: dataUri } }
     *
     * Devuelve UNICAMENTE la miniatura. Nada de perfil_id, file_id, nombres
     * ni roles: para pintar un avatar no hace falta mas, y todo lo demas
     * seria informacion regalada.
     */
    getFotosDe: function (data, contexto) {
      if (!identidadDe_(contexto)) {
        return { _forbidden: true, message: 'No fue posible resolver tu identidad.' };
      }
      var pedidos = (data && data.emails) || [];
      if (!Array.isArray(pedidos) || !pedidos.length) {
        return { fotos: {} };
      }

      // Tope defensivo: evita que una peticion manipulada pida un volcado
      // completo de miniaturas.
      var unicos = [];
      pedidos.forEach(function (correo) {
        var clave = normalizarEmail_(correo);
        if (clave && unicos.indexOf(clave) === -1 && unicos.length < 100) {
          unicos.push(clave);
        }
      });

      var indice = indiceThumbsPorEmail_();
      var fotos = {};
      unicos.forEach(function (clave) {
        if (indice[clave]) fotos[clave] = indice[clave];
      });
      return { fotos: fotos };
    }
  };
})();

// Mueve a la papelera un archivo de Drive sin romper la operacion si ya no
// existe (una foto borrada a mano no debe impedir subir la nueva).
function descartarArchivoDrive_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (err) {
    // Ya no esta: nada que hacer.
  }
}
