/**
 * Pausas.gs — v6.0, modulo de Control de Pausas Activas (FASE P0).
 * Ver documentacion/SIGSO-v6.0-propuesta-modulo-pausas-activas.md.
 *
 * ALCANCE DE ESTA FASE (P0): SOLO la configuracion administrable por el Admin,
 * que es lo que el usuario pidio primero -- "que ese apartado sea editable" y
 * "lo mismo con las horas, dias". Tres cosas, todas ADM-only:
 *   1. PAUSAS_CONFIG  -- parametros por empresa (hora/dias/duracion/umbrales).
 *   2. PAUSAS_COORDINADORES -- prevencionistas titulares y reemplazos.
 *   3. PAUSAS_TRABAJADORES  -- roster de trabajadores del modulo.
 *
 * TODO es aditivo: escribe SOLO en las hojas PAUSAS_* (nuevas). No toca ni una
 * columna ni una accion del sistema de solicitudes, que ya funciona en
 * produccion. Mismo patron de CRUD que Jefatura.gs / Catalogos.gs (crear si no
 * existe, "eliminar" es baja logica salvo el borrado explicito).
 *
 * La programacion de pausas, el registro del trabajador, la vista de la
 * coordinadora, las alertas y los reportes llegan en fases posteriores (P1-P5).
 */

var PAUSAS_TIPOS_COORDINADOR = ['titular', 'reemplazo'];

var Pausas = {
  // ---- PAUSAS_CONFIG: parametros por empresa (upsert por empresa_id) --------
  listarConfig: function (data, contexto) {
    var g = guardaAdminPausas_(contexto, 'ver la configuracion de pausas');
    if (g) return g;
    return leerFilasSeguro_(SHEETS.PAUSAS_CONFIG);
  },

  guardarConfig: function (data, contexto) {
    var g = guardaAdminPausas_(contexto, 'configurar las pausas');
    if (g) return g;

    var empresaId = String(data.empresa_id || '').trim();
    if (!empresaId) {
      return errorValidacion_('empresa_id', 'Indica la empresa a configurar.');
    }

    var hora = normalizarHoraPausas_(data.hora_habitual);
    if (data.hora_habitual && !hora) {
      return errorValidacion_('hora_habitual', 'Hora invalida. Usa el formato HH:mm (00:00 a 23:59).');
    }

    var dias = normalizarDiasPausas_(data.dias_semana);
    if (dias === null) {
      return errorValidacion_('dias_semana', 'Dias invalidos. Usa numeros 1..7 separados por coma (1=lunes).');
    }

    var duracion = enteroPositivoPausas_(data.duracion_min);
    if (data.duracion_min !== undefined && data.duracion_min !== '' && duracion === null) {
      return errorValidacion_('duracion_min', 'La duracion debe ser un numero de minutos mayor a 0.');
    }

    var anticipacion = enteroNoNegativoPausas_(data.min_anticipacion);
    if (data.min_anticipacion !== undefined && data.min_anticipacion !== '' && anticipacion === null) {
      return errorValidacion_('min_anticipacion', 'La anticipacion debe ser un numero de minutos (0 o mas).');
    }

    var verde = porcentajePausas_(data.umbral_verde);
    if (data.umbral_verde !== undefined && data.umbral_verde !== '' && verde === null) {
      return errorValidacion_('umbral_verde', 'El umbral verde debe ser un porcentaje entre 0 y 100.');
    }
    var amarillo = porcentajePausas_(data.umbral_amarillo);
    if (data.umbral_amarillo !== undefined && data.umbral_amarillo !== '' && amarillo === null) {
      return errorValidacion_('umbral_amarillo', 'El umbral amarillo debe ser un porcentaje entre 0 y 100.');
    }
    if (verde !== null && amarillo !== null && amarillo > verde) {
      return errorValidacion_('umbral_amarillo', 'El umbral amarillo no puede ser mayor que el verde.');
    }

    var registro = {
      empresa_id: empresaId,
      hora_habitual: hora || '',
      dias_semana: dias,
      duracion_min: duracion === null ? '' : duracion,
      min_anticipacion: anticipacion === null ? '' : anticipacion,
      umbral_verde: verde === null ? '' : verde,
      umbral_amarillo: amarillo === null ? '' : amarillo,
      activo: data.activo === false ? false : true
    };

    var actualizado = actualizarFilaPorId_(SHEETS.PAUSAS_CONFIG, 'empresa_id', empresaId, registro);
    if (actualizado) {
      registrarLogPausas_('', contexto, 'config_actualizada', 'empresa ' + empresaId);
      return actualizado;
    }
    agregarFila_(SHEETS.PAUSAS_CONFIG, registro);
    registrarLogPausas_('', contexto, 'config_creada', 'empresa ' + empresaId);
    return registro;
  },

  // ---- PAUSAS_COORDINADORES: titulares y reemplazos ------------------------
  listarCoordinadores: function (data, contexto) {
    var g = guardaAdminPausas_(contexto, 'ver las coordinadoras de pausas');
    if (g) return g;
    return leerFilasSeguro_(SHEETS.PAUSAS_COORDINADORES);
  },

  gestionarCoordinador: function (data, contexto) {
    var g = guardaAdminPausas_(contexto, 'gestionar las coordinadoras de pausas');
    if (g) return g;
    switch (data.operacion) {
      case 'crear': return crearCoordinadorPausas_(data, contexto);
      case 'activar': return activarCoordinadorPausas_(data, contexto);
      case 'eliminar': return eliminarCoordinadorPausas_(data, contexto);
      default:
        return errorValidacion_('operacion', 'Operacion invalida: ' + data.operacion);
    }
  },

  // ---- PAUSAS_TRABAJADORES: roster -----------------------------------------
  listarTrabajadores: function (data, contexto) {
    var g = guardaAdminPausas_(contexto, 'ver el roster de pausas');
    if (g) return g;
    return leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES);
  },

  gestionarTrabajador: function (data, contexto) {
    var g = guardaAdminPausas_(contexto, 'gestionar el roster de pausas');
    if (g) return g;
    switch (data.operacion) {
      case 'crear': return crearTrabajadorPausas_(data, contexto);
      case 'activar': return activarTrabajadorPausas_(data, contexto);
      case 'eliminar': return eliminarTrabajadorPausas_(data, contexto);
      default:
        return errorValidacion_('operacion', 'Operacion invalida: ' + data.operacion);
    }
  }
};

// --- CRUD de PAUSAS_COORDINADORES ------------------------------------------

function crearCoordinadorPausas_(data, contexto) {
  var empresaId = String(data.empresa_id || '').trim();
  if (!empresaId) {
    return errorValidacion_('empresa_id', 'Indica la empresa de la coordinadora.');
  }
  var nombre = String(data.nombre || '').trim();
  if (!nombre) {
    return errorValidacion_('nombre', 'Indica el nombre de la coordinadora.');
  }
  var email = String(data.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return errorValidacion_('email', 'Correo de la coordinadora invalido.');
  }
  var tipo = String(data.tipo || 'titular').trim().toLowerCase();
  if (PAUSAS_TIPOS_COORDINADOR.indexOf(tipo) === -1) {
    return errorValidacion_('tipo', 'Tipo invalido. Usa "titular" o "reemplazo".');
  }
  var duplicada = leerFilasSeguro_(SHEETS.PAUSAS_COORDINADORES).filter(function (c) {
    var activa = esVerdaderoPausas_(c.activo);
    return activa && c.empresa_id === empresaId && String(c.email).toLowerCase() === email;
  })[0];
  if (duplicada) {
    return errorValidacion_('email', 'Esa coordinadora ya esta registrada en la empresa.');
  }
  var fila = {
    coord_id: Utilities.getUuid(),
    empresa_id: empresaId,
    nombre: nombre,
    email: email,
    tipo: tipo,
    activo: true
  };
  agregarFila_(SHEETS.PAUSAS_COORDINADORES, fila);
  registrarLogPausas_('', contexto, 'coordinador_creado', nombre + ' (' + tipo + ') en ' + empresaId);
  return fila;
}

function activarCoordinadorPausas_(data, contexto) {
  if (!data.coord_id) {
    return errorValidacion_('coord_id', 'Falta indicar la coordinadora a modificar.');
  }
  var activo = data.activo !== false;
  actualizarFilaPorId_(SHEETS.PAUSAS_COORDINADORES, 'coord_id', data.coord_id, { activo: activo });
  registrarLogPausas_('', contexto, activo ? 'coordinador_activado' : 'coordinador_desactivado', data.coord_id);
  return { coord_id: data.coord_id, activo: activo };
}

function eliminarCoordinadorPausas_(data, contexto) {
  if (!data.coord_id) {
    return errorValidacion_('coord_id', 'Falta indicar la coordinadora a eliminar.');
  }
  eliminarFilasPorId_(SHEETS.PAUSAS_COORDINADORES, 'coord_id', data.coord_id);
  registrarLogPausas_('', contexto, 'coordinador_eliminado', data.coord_id);
  return { coord_id: data.coord_id, eliminada: true };
}

// --- CRUD de PAUSAS_TRABAJADORES -------------------------------------------

function crearTrabajadorPausas_(data, contexto) {
  var empresaId = String(data.empresa_id || '').trim();
  if (!empresaId) {
    return errorValidacion_('empresa_id', 'Indica la empresa del trabajador.');
  }
  var nombre = String(data.nombre || '').trim();
  if (!nombre) {
    return errorValidacion_('nombre', 'Indica el nombre del trabajador.');
  }
  var email = String(data.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return errorValidacion_('email', 'Correo del trabajador invalido.');
  }
  var duplicado = leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES).filter(function (t) {
    var activo = esVerdaderoPausas_(t.activo);
    return activo && t.empresa_id === empresaId && String(t.email).toLowerCase() === email;
  })[0];
  if (duplicado) {
    return errorValidacion_('email', 'Ese trabajador ya esta en el roster de la empresa.');
  }
  var fila = {
    trabajador_id: Utilities.getUuid(),
    empresa_id: empresaId,
    nombre: nombre,
    email: email,
    area: String(data.area || '').trim(),
    cargo: String(data.cargo || '').trim(),
    activo: true,
    fecha_ingreso: data.fecha_ingreso ? String(data.fecha_ingreso) : new Date().toISOString()
  };
  agregarFila_(SHEETS.PAUSAS_TRABAJADORES, fila);
  registrarLogPausas_('', contexto, 'trabajador_creado', nombre + ' en ' + empresaId);
  return fila;
}

function activarTrabajadorPausas_(data, contexto) {
  if (!data.trabajador_id) {
    return errorValidacion_('trabajador_id', 'Falta indicar el trabajador a modificar.');
  }
  var activo = data.activo !== false;
  actualizarFilaPorId_(SHEETS.PAUSAS_TRABAJADORES, 'trabajador_id', data.trabajador_id, { activo: activo });
  registrarLogPausas_('', contexto, activo ? 'trabajador_activado' : 'trabajador_desactivado', data.trabajador_id);
  return { trabajador_id: data.trabajador_id, activo: activo };
}

function eliminarTrabajadorPausas_(data, contexto) {
  if (!data.trabajador_id) {
    return errorValidacion_('trabajador_id', 'Falta indicar el trabajador a eliminar.');
  }
  eliminarFilasPorId_(SHEETS.PAUSAS_TRABAJADORES, 'trabajador_id', data.trabajador_id);
  registrarLogPausas_('', contexto, 'trabajador_eliminado', data.trabajador_id);
  return { trabajador_id: data.trabajador_id, eliminado: true };
}

// --- helpers ---------------------------------------------------------------

// Toda la administracion del modulo de pausas es ADM-only en P0 (el resto de
// modulos/roles del modulo llegan en fases posteriores). Devuelve un objeto
// _forbidden si el rol no corresponde, o null si puede pasar.
function guardaAdminPausas_(contexto, accion) {
  if (!contexto || contexto.rol !== 'ADM') {
    return { _forbidden: true, message: 'Solo un Administrador puede ' + accion + '.' };
  }
  return null;
}

function esVerdaderoPausas_(v) {
  return v === true || v === 'TRUE' || v === 1 || v === '1';
}

// 'HH:mm' valido -> lo devuelve normalizado con cero a la izquierda; si no es
// una hora valida, devuelve '' (el llamador decide si eso es un error).
function normalizarHoraPausas_(valor) {
  if (valor === undefined || valor === null || valor === '') return '';
  var m = String(valor).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  var h = parseInt(m[1], 10);
  var min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return '';
  return (h < 10 ? '0' + h : '' + h) + ':' + m[2];
}

// CSV de dias 1..7 (1=lunes). Acepta string o array. Devuelve el CSV
// normalizado (unico, ordenado) o null si algun valor es invalido. '' es
// valido (sin dias configurados todavia).
function normalizarDiasPausas_(valor) {
  if (valor === undefined || valor === null || valor === '') return '';
  var partes = Array.isArray(valor) ? valor : String(valor).split(',');
  var vistos = {};
  var dias = [];
  for (var i = 0; i < partes.length; i++) {
    var s = String(partes[i]).trim();
    if (s === '') continue;
    if (!/^\d+$/.test(s)) return null;
    var d = parseInt(s, 10);
    if (d < 1 || d > 7) return null;
    if (!vistos[d]) { vistos[d] = true; dias.push(d); }
  }
  dias.sort(function (a, b) { return a - b; });
  return dias.join(',');
}

function enteroPositivoPausas_(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  var n = Number(valor);
  if (!isFinite(n) || Math.floor(n) !== n || n <= 0) return null;
  return n;
}

function enteroNoNegativoPausas_(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  var n = Number(valor);
  if (!isFinite(n) || Math.floor(n) !== n || n < 0) return null;
  return n;
}

function porcentajePausas_(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  var n = Number(valor);
  if (!isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

// Auditoria del modulo (PAUSAS_LOG). Tolerante a instalaciones sin la hoja: si
// falla el append, no rompe la operacion principal (el log es secundario).
function registrarLogPausas_(pausaId, contexto, accion, detalle) {
  try {
    agregarFila_(SHEETS.PAUSAS_LOG, {
      log_id: Utilities.getUuid(),
      timestamp: new Date().toISOString(),
      pausa_id: pausaId || '',
      usuario: (contexto && contexto.email) || '',
      accion: accion,
      detalle: detalle || ''
    });
  } catch (err) {
    // no-op: la hoja de log puede no existir aun; no debe frenar el CRUD.
  }
}
