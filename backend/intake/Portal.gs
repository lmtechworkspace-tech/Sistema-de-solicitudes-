/**
 * Portal.gs — identidad de la plataforma (v3.3, documentacion/
 * SIGSO-v3.3-propuesta-plataforma-modular.md).
 *
 * La cuenta es la persona; sus correos son un atributo (puede haber varios).
 * Esto existe porque la identidad por correo fallaba en la practica: cada
 * persona maneja varios correos, y para el sistema eso eran varias personas.
 *
 * Seguridad (§3 de la propuesta, evaluacion honesta):
 *  - hash_password = SHA-256 iterado con sal. Apps Script no tiene
 *    bcrypt/argon2; esto es lo mejor disponible en la plataforma y es
 *    adecuado al riesgo (el portal protege solicitudes internas, no dinero
 *    ni credenciales de terceros). Nunca se guarda la contrasena en claro.
 *  - Bloqueo anti fuerza bruta: 5 intentos fallidos -> 10 minutos.
 *  - Sesiones: token UUID, 12 horas, revocables (la hoja es la verdad;
 *    CacheService solo acelera).
 *
 * Las cuentas las CREA el Admin desde el Backoffice (CuentasPortal.gs) --
 * aqui no hay auto-registro a proposito: los usuarios del portal son un
 * grupo chico y conocido, y el auto-registro abriria cuentas basura.
 */

var ITERACIONES_HASH = 1000;
var SESION_HORAS = 12;
var MAX_INTENTOS_LOGIN = 5;
var BLOQUEO_LOGIN_SEGUNDOS = 600;

var Portal = {
  /**
   * login({ usuario, password }) -> { token, cuenta } o error.
   * La respuesta de usuario inexistente y de clave mala es LA MISMA a
   * proposito: no se le confirma a un atacante que usuarios existen.
   */
  login: function (data) {
    var usuario = String(data.usuario || '').trim().toLowerCase();
    var password = String(data.password || '');
    if (!usuario || !password) {
      return errorValidacion_('usuario', 'Indica tu usuario y contrasena.');
    }

    var cache = CacheService.getScriptCache();
    var claveIntentos = 'PORTAL_INTENTOS:' + usuario;
    var intentos = Number(cache.get(claveIntentos) || 0);
    if (intentos >= MAX_INTENTOS_LOGIN) {
      return {
        _forbidden: true,
        message: 'Demasiados intentos fallidos. Espera 10 minutos e intenta de nuevo.'
      };
    }

    var cuenta = buscarCuentaPorUsuario_(usuario);
    var hashCorrecto = cuenta && esCuentaActiva_(cuenta) &&
      hashPassword_(password, cuenta.salt) === cuenta.hash_password;

    if (!hashCorrecto) {
      // El contador tambien corre para usuarios inexistentes: si no, probar
      // nombres de usuario seria gratis e ilimitado.
      cache.put(claveIntentos, String(intentos + 1), BLOQUEO_LOGIN_SEGUNDOS);
      return { _forbidden: true, message: 'Usuario o contrasena incorrectos.' };
    }

    cache.remove(claveIntentos);
    var token = crearSesion_(cuenta.cuenta_id);
    actualizarFilaPorId_(SHEETS.CUENTAS_PORTAL, 'cuenta_id', cuenta.cuenta_id, {
      ultimo_acceso: new Date().toISOString()
    });

    return { token: token, cuenta: perfilPublico_(cuenta) };
  },

  logout: function (data) {
    if (data.token) {
      CacheService.getScriptCache().remove('PORTAL_SESION:' + data.token);
      actualizarFilaPorId_(SHEETS.SESIONES_PORTAL, 'token', data.token, {
        expira: new Date(0).toISOString()
      });
    }
    return { ok: true };
  },

  /**
   * sesion({ token }) -> { cuenta } o forbidden. Lo usa el shell al cargar
   * la pagina para restaurar la sesion guardada sin re-loguear.
   */
  sesion: function (data) {
    var cuenta = resolverCuentaPorToken_(data.token);
    if (!cuenta) {
      return { _forbidden: true, message: 'Sesion invalida o expirada. Ingresa de nuevo.' };
    }
    return { cuenta: perfilPublico_(cuenta) };
  },

  /**
   * cambiarPassword({ token, password_actual, password_nueva }). Cuando la
   * cuenta tiene debe_cambiar_password (clave temporal recien entregada por
   * el Admin), password_actual sigue siendo obligatoria: la temporal.
   */
  cambiarPassword: function (data) {
    var cuenta = resolverCuentaPorToken_(data.token);
    if (!cuenta) {
      return { _forbidden: true, message: 'Sesion invalida o expirada. Ingresa de nuevo.' };
    }
    if (hashPassword_(String(data.password_actual || ''), cuenta.salt) !== cuenta.hash_password) {
      return { _forbidden: true, message: 'La contrasena actual no es correcta.' };
    }
    var nueva = String(data.password_nueva || '');
    if (nueva.length < 8) {
      return errorValidacion_('password_nueva', 'La contrasena nueva debe tener al menos 8 caracteres.');
    }
    if (nueva === String(data.password_actual)) {
      return errorValidacion_('password_nueva', 'La contrasena nueva debe ser distinta de la actual.');
    }

    var salt = Utilities.getUuid();
    actualizarFilaPorId_(SHEETS.CUENTAS_PORTAL, 'cuenta_id', cuenta.cuenta_id, {
      salt: salt,
      hash_password: hashPassword_(nueva, salt),
      debe_cambiar_password: false
    });
    return { ok: true };
  }
};

// --- helpers compartidos (los usa tambien misSolicitudes) ----------------

// Perfil que viaja al navegador: SOLO lo que el shell necesita. Nunca el
// hash ni la sal.
function perfilPublico_(cuenta) {
  return {
    cuenta_id: cuenta.cuenta_id,
    usuario: cuenta.usuario,
    nombre: cuenta.nombre,
    cargo: cuenta.cargo,
    emails: parsearJsonLista_(cuenta.emails),
    rol: cuenta.rol,
    modulos: parsearJsonLista_(cuenta.modulos),
    empresa_id: cuenta.empresa_id,
    debe_cambiar_password: esVerdadero_(cuenta.debe_cambiar_password)
  };
}

function resolverCuentaPorToken_(token) {
  if (!token) {
    return null;
  }
  var cache = CacheService.getScriptCache();
  var cuentaId = cache.get('PORTAL_SESION:' + token);
  if (!cuentaId) {
    var sesion = null;
    try {
      sesion = leerFilas_(SHEETS.SESIONES_PORTAL).filter(function (s) {
        return s.token === token;
      })[0];
    } catch (err) {
      return null; // instalacion sin la hoja: no hay portal todavia
    }
    if (!sesion || new Date(sesion.expira).getTime() <= Date.now()) {
      return null;
    }
    cuentaId = sesion.cuenta_id;
    intentarCachear_(cache, 'PORTAL_SESION:' + token, cuentaId, segundosHastaExpirar_(sesion.expira));
  }
  var cuenta = buscarCuentaPorId_(cuentaId);
  // La hoja manda: desactivar la cuenta corta la sesion aunque el token
  // siga cacheado.
  return cuenta && esCuentaActiva_(cuenta) ? cuenta : null;
}

function crearSesion_(cuentaId) {
  var token = Utilities.getUuid();
  var expira = new Date(Date.now() + SESION_HORAS * 3600 * 1000).toISOString();
  agregarFila_(SHEETS.SESIONES_PORTAL, {
    token: token,
    cuenta_id: cuentaId,
    expira: expira,
    creada: new Date().toISOString()
  });
  intentarCachear_(CacheService.getScriptCache(), 'PORTAL_SESION:' + token, cuentaId, SESION_HORAS * 3600);
  return token;
}

// CacheService acepta TTL maximo 21600s (6h); una sesion de 12h se cachea
// por el maximo permitido y despues cae a la hoja (que es la verdad).
function intentarCachear_(cache, clave, valor, segundos) {
  try {
    cache.put(clave, valor, Math.max(60, Math.min(21600, Math.floor(segundos))));
  } catch (err) {
    // sin cache no pasa nada: la hoja resuelve
  }
}

function segundosHastaExpirar_(expiraIso) {
  return (new Date(expiraIso).getTime() - Date.now()) / 1000;
}

function buscarCuentaPorUsuario_(usuario) {
  return leerCuentas_().filter(function (c) {
    return String(c.usuario).trim().toLowerCase() === usuario;
  })[0] || null;
}

function buscarCuentaPorId_(cuentaId) {
  return leerCuentas_().filter(function (c) { return c.cuenta_id === cuentaId; })[0] || null;
}

// Tolerante a instalaciones que aun no tienen la hoja (portal no instalado):
// todo el portal responde "sesion invalida" en vez de reventar.
function leerCuentas_() {
  try {
    return leerFilas_(SHEETS.CUENTAS_PORTAL);
  } catch (err) {
    return [];
  }
}

function esCuentaActiva_(cuenta) {
  return cuenta.activo === true || cuenta.activo === 'TRUE' || cuenta.activo === 1;
}

function esVerdadero_(valor) {
  return valor === true || valor === 'TRUE' || valor === 1;
}

function parsearJsonLista_(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor;
  try {
    var lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista : [];
  } catch (err) {
    return [];
  }
}

/**
 * SHA-256 iterado con sal. Identica en backend/backoffice/CuentasPortal.gs
 * (duplicacion deliberada entre proyectos, ver Config.gs): el Backoffice
 * fija claves temporales y este proyecto las verifica -- si divergen, nadie
 * puede entrar. Cubierto por test de consistencia (portal.test.js).
 */
function hashPassword_(password, salt) {
  var valor = String(salt) + ':' + String(password);
  for (var i = 0; i < ITERACIONES_HASH; i++) {
    valor = bytesAHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, valor));
  }
  return valor;
}

function bytesAHex_(bytes) {
  return bytes.map(function (b) {
    var hex = (b < 0 ? b + 256 : b).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}
