/**
 * CuentasPortal.gs — administracion de cuentas de la plataforma (v3.3 §2.3).
 *
 * Las cuentas las crea SOLO el Admin (sin auto-registro: los usuarios del
 * portal son un grupo chico y conocido). El rol es la PLANTILLA de modulos
 * al crear; lo que manda despues es la lista `modulos` de cada cuenta, que
 * el Admin puede ajustar persona a persona ("darle gerencia a Felipe sin
 * hacerlo ADM").
 *
 * La verificacion del login vive en el otro proyecto
 * (backend/intake/Portal.gs); hashPasswordPortal_ debe producir EXACTAMENTE
 * el mismo hash (duplicacion deliberada entre proyectos, ver Config.gs) --
 * si divergen, nadie puede entrar. Cubierto por test de consistencia.
 */

var ITERACIONES_HASH_PORTAL = 1000;

// Plantilla de modulos por rol (§2.3 de la propuesta). Solo aplica al CREAR
// la cuenta (o al resetear modulos): despues manda la lista por cuenta.
var MODULOS_POR_ROL = {
  SOLICITANTE: ['nueva_solicitud', 'mis_solicitudes'],
  DEV: ['nueva_solicitud', 'mis_solicitudes', 'bandeja'],
  GERENCIA: ['nueva_solicitud', 'mis_solicitudes', 'gerencia'],
  ADM: ['nueva_solicitud', 'mis_solicitudes', 'bandeja', 'gerencia', 'administracion']
};

var MODULOS_VALIDOS = ['nueva_solicitud', 'mis_solicitudes', 'bandeja', 'gerencia', 'administracion'];

var CuentasPortal = {
  listar: function (data, contexto) {
    if (contexto.rol !== 'ADM') {
      return { _forbidden: true, message: 'Solo Admin puede gestionar cuentas de la plataforma.' };
    }
    var cuentas;
    try {
      cuentas = leerFilas_(SHEETS.CUENTAS_PORTAL);
    } catch (err) {
      return { cuentas: [] }; // hoja aun no creada
    }
    return {
      cuentas: cuentas.map(function (c) {
        // Nunca viajan hash ni sal, ni siquiera al Admin: no los necesita
        // (resetear genera una clave nueva) y no exponerlos es gratis.
        return {
          cuenta_id: c.cuenta_id,
          usuario: c.usuario,
          nombre: c.nombre,
          cargo: c.cargo,
          emails: parsearListaPortal_(c.emails),
          rol: c.rol,
          modulos: parsearListaPortal_(c.modulos),
          empresa_id: c.empresa_id,
          activo: c.activo === true || c.activo === 'TRUE' || c.activo === 1,
          debe_cambiar_password: c.debe_cambiar_password === true || c.debe_cambiar_password === 'TRUE' || c.debe_cambiar_password === 1,
          ultimo_acceso: c.ultimo_acceso
        };
      })
    };
  },

  /**
   * gestionar({ operacion: 'crear'|'actualizar'|'resetear_password'|'activar', ... })
   * Una sola accion con operaciones, mismo patron que gestionarUsuario
   * (Auth.gs).
   */
  gestionar: function (data, contexto) {
    if (contexto.rol !== 'ADM') {
      return { _forbidden: true, message: 'Solo Admin puede gestionar cuentas de la plataforma.' };
    }
    switch (data.operacion) {
      case 'crear': return crearCuenta_(data, contexto);
      case 'actualizar': return actualizarCuenta_(data);
      case 'resetear_password': return resetearPassword_(data);
      case 'activar': return activarCuenta_(data);
      default:
        return errorValidacion_('operacion', 'Operacion invalida: ' + data.operacion);
    }
  }
};

function crearCuenta_(data, contexto) {
  var usuario = String(data.usuario || '').trim().toLowerCase();
  if (!usuario || !/^[a-z0-9._-]{3,30}$/.test(usuario)) {
    return errorValidacion_('usuario', 'Usuario invalido: 3-30 caracteres, letras/numeros/punto/guion.');
  }
  if (!data.nombre || !String(data.nombre).trim()) {
    return errorValidacion_('nombre', 'Indica el nombre de la persona.');
  }
  var emails = normalizarEmailsPortal_(data.emails);
  if (emails.length === 0) {
    return errorValidacion_('emails', 'Indica al menos un correo asociado.');
  }
  var rol = data.rol || 'SOLICITANTE';
  if (!MODULOS_POR_ROL[rol]) {
    return errorValidacion_('rol', 'Rol invalido: ' + rol);
  }
  var existente = leerCuentasPortal_().filter(function (c) {
    return String(c.usuario).trim().toLowerCase() === usuario;
  })[0];
  if (existente) {
    return errorValidacion_('usuario', 'Ya existe una cuenta con el usuario "' + usuario + '".');
  }

  var claveTemporal = data.password_temporal
    ? String(data.password_temporal)
    : generarClaveTemporal_();
  if (claveTemporal.length < 8) {
    return errorValidacion_('password_temporal', 'La clave temporal debe tener al menos 8 caracteres.');
  }

  var salt = Utilities.getUuid();
  var cuentaId = Utilities.getUuid();
  agregarFila_(SHEETS.CUENTAS_PORTAL, {
    cuenta_id: cuentaId,
    usuario: usuario,
    nombre: String(data.nombre).trim(),
    cargo: String(data.cargo || '').trim(),
    hash_password: hashPasswordPortal_(claveTemporal, salt),
    salt: salt,
    emails: JSON.stringify(emails),
    rol: rol,
    modulos: JSON.stringify(validarModulos_(data.modulos) || MODULOS_POR_ROL[rol]),
    empresa_id: data.empresa_id || '',
    activo: true,
    debe_cambiar_password: true,
    ultimo_acceso: '',
    creado_por: contexto.email
  });

  // La clave temporal se devuelve UNA sola vez, para que el Admin la
  // entregue en persona/WhatsApp. No queda guardada en ninguna parte (solo
  // su hash) -- si se pierde, se resetea.
  return { cuenta_id: cuentaId, usuario: usuario, password_temporal: claveTemporal };
}

function actualizarCuenta_(data) {
  var cuenta = buscarCuentaPortal_(data.cuenta_id);
  if (!cuenta) {
    return errorValidacion_('cuenta_id', 'Cuenta no encontrada.');
  }
  var cambios = {};
  if (data.nombre !== undefined) cambios.nombre = String(data.nombre).trim();
  if (data.cargo !== undefined) cambios.cargo = String(data.cargo).trim();
  if (data.empresa_id !== undefined) cambios.empresa_id = data.empresa_id;
  if (data.rol !== undefined) {
    if (!MODULOS_POR_ROL[data.rol]) {
      return errorValidacion_('rol', 'Rol invalido: ' + data.rol);
    }
    cambios.rol = data.rol;
  }
  if (data.emails !== undefined) {
    var emails = normalizarEmailsPortal_(data.emails);
    if (emails.length === 0) {
      return errorValidacion_('emails', 'La cuenta debe conservar al menos un correo.');
    }
    cambios.emails = JSON.stringify(emails);
  }
  if (data.modulos !== undefined) {
    var modulos = validarModulos_(data.modulos);
    if (!modulos) {
      return errorValidacion_('modulos', 'Lista de modulos invalida. Validos: ' + MODULOS_VALIDOS.join(', '));
    }
    cambios.modulos = JSON.stringify(modulos);
  }
  actualizarFilaPorId_(SHEETS.CUENTAS_PORTAL, 'cuenta_id', data.cuenta_id, cambios);
  return { cuenta_id: data.cuenta_id, actualizado: Object.keys(cambios) };
}

function resetearPassword_(data) {
  var cuenta = buscarCuentaPortal_(data.cuenta_id);
  if (!cuenta) {
    return errorValidacion_('cuenta_id', 'Cuenta no encontrada.');
  }
  var claveTemporal = generarClaveTemporal_();
  var salt = Utilities.getUuid();
  actualizarFilaPorId_(SHEETS.CUENTAS_PORTAL, 'cuenta_id', data.cuenta_id, {
    salt: salt,
    hash_password: hashPasswordPortal_(claveTemporal, salt),
    debe_cambiar_password: true
  });
  return { cuenta_id: data.cuenta_id, usuario: cuenta.usuario, password_temporal: claveTemporal };
}

function activarCuenta_(data) {
  var cuenta = buscarCuentaPortal_(data.cuenta_id);
  if (!cuenta) {
    return errorValidacion_('cuenta_id', 'Cuenta no encontrada.');
  }
  actualizarFilaPorId_(SHEETS.CUENTAS_PORTAL, 'cuenta_id', data.cuenta_id, {
    activo: data.activo !== false
  });
  return { cuenta_id: data.cuenta_id, activo: data.activo !== false };
}

// --- helpers -------------------------------------------------------------

function leerCuentasPortal_() {
  try {
    return leerFilas_(SHEETS.CUENTAS_PORTAL);
  } catch (err) {
    return [];
  }
}

function buscarCuentaPortal_(cuentaId) {
  return leerCuentasPortal_().filter(function (c) { return c.cuenta_id === cuentaId; })[0] || null;
}

function normalizarEmailsPortal_(emails) {
  var lista = Array.isArray(emails)
    ? emails
    : String(emails || '').split(/[,;\n]/);
  var vistos = {};
  return lista
    .map(function (e) { return String(e).trim().toLowerCase(); })
    .filter(function (e) {
      if (!e || vistos[e] || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
      vistos[e] = true;
      return true;
    });
}

function validarModulos_(modulos) {
  if (modulos === undefined || modulos === null || modulos === '') return null;
  var lista = Array.isArray(modulos) ? modulos : parsearListaPortal_(modulos);
  var validos = lista.filter(function (m) { return MODULOS_VALIDOS.indexOf(m) !== -1; });
  return validos.length === lista.length && validos.length > 0 ? validos : null;
}

function parsearListaPortal_(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor;
  try {
    var lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista : [];
  } catch (err) {
    return [];
  }
}

// 10 caracteres legibles (sin 0/O/1/l/I que se confunden al dictarla por
// telefono o WhatsApp).
function generarClaveTemporal_() {
  var abecedario = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var clave = '';
  for (var i = 0; i < 10; i++) {
    clave += abecedario.charAt(Math.floor(Math.random() * abecedario.length));
  }
  return clave;
}

// Ver la nota en backend/intake/Portal.gs (hashPassword_): DEBE producir el
// mismo resultado. Test de consistencia en backend/test/portal.test.js.
function hashPasswordPortal_(password, salt) {
  var valor = String(salt) + ':' + String(password);
  for (var i = 0; i < ITERACIONES_HASH_PORTAL; i++) {
    valor = bytesAHexPortal_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, valor));
  }
  return valor;
}

function bytesAHexPortal_(bytes) {
  return bytes.map(function (b) {
    var hex = (b < 0 ? b + 256 : b).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}
