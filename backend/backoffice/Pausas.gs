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

// v6.0 Fase P1: maquina de estados de una pausa programada. Mismo espiritu que
// la de solicitudes (Solicitudes.actualizarEstado): un mapa de transiciones
// permitidas, y el servidor rechaza cualquier salto no declarado.
//   Programada           recien creada por el trigger (o a mano por el ADM).
//   Recordatorio_enviado ya salio el aviso (P4).
//   En_curso             la coordinadora la inicio (P3).
//   Realizada            la coordinadora la cerro como hecha (P3).
//   Cerrada              cierre administrativo/final (P3/P5).
//   Suspendida           pausada temporalmente; puede volver a Programada.
//   No_realizada         no se hizo, con motivo (P3).
//   Cancelada            anulada por el ADM (no se contabiliza).
var ESTADOS_PAUSA = {
  PROGRAMADA: 'Programada',
  RECORDATORIO_ENVIADO: 'Recordatorio_enviado',
  EN_CURSO: 'En_curso',
  REALIZADA: 'Realizada',
  CERRADA: 'Cerrada',
  SUSPENDIDA: 'Suspendida',
  NO_REALIZADA: 'No_realizada',
  CANCELADA: 'Cancelada'
};

// Estados terminales: no admiten mas transiciones.
var ESTADOS_PAUSA_TERMINALES = ['Cerrada', 'No_realizada', 'Cancelada'];

var TRANSICIONES_PAUSA = {
  Programada: ['Recordatorio_enviado', 'En_curso', 'Suspendida', 'No_realizada', 'Cancelada'],
  Recordatorio_enviado: ['En_curso', 'Suspendida', 'No_realizada', 'Cancelada'],
  En_curso: ['Realizada', 'No_realizada'],
  Realizada: ['Cerrada'],
  Suspendida: ['Programada', 'Cancelada'],
  Cerrada: [],
  No_realizada: [],
  Cancelada: []
};

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
  },

  // ---- PAUSAS_PROGRAMADAS: programacion + maquina de estados (Fase P1) ------

  // Idempotente: por cada empresa con config activa cuyos dias_semana incluyan
  // el dia de HOY (zona horaria del proyecto), crea la pausa del dia en estado
  // Programada -- salvo que ya exista una para (empresa, fecha). La corre el
  // trigger diario, y el ADM puede dispararla a mano ("Programar hoy").
  // `refFecha` permite fijar el dia (tests / reprocesos); por defecto, ahora.
  programarDelDia: function (refFecha, contexto) {
    // `new Date(refFecha)` en vez de comprobar `instanceof Date`: cuando la
    // llamada viene de otro realm (los tests corren en un vm distinto), el
    // Date recibido no es "instancia" del Date de este contexto y el instanceof
    // daria falso. Re-envolverlo lo normaliza sin romper el caso normal.
    var fecha = refFecha ? new Date(refFecha) : new Date();
    var tz = 'America/Santiago';
    var claveHoy = claveDia_(fecha, tz);
    var diaIso = diaSemanaIsoPausas_(fecha, tz); // 1=Lun .. 7=Dom
    var configs = leerFilasSeguro_(SHEETS.PAUSAS_CONFIG).filter(function (c) {
      return esVerdaderoPausas_(c.activo);
    });
    var yaProgramadas = leerFilasSeguro_(SHEETS.PAUSAS_PROGRAMADAS);
    var creadas = [];

    configs.forEach(function (config) {
      var dias = String(config.dias_semana || '').split(',').map(function (d) { return String(d).trim(); });
      if (dias.indexOf(String(diaIso)) === -1) return; // hoy no aplica a esta empresa
      var existe = yaProgramadas.some(function (p) {
        return String(p.empresa_id) === String(config.empresa_id) &&
          claveFechaPausa_(p.fecha) === claveHoy &&
          ESTADOS_PAUSA_TERMINALES.indexOf(p.estado) === -1;
      });
      if (existe) return; // ya hay una pausa viva para hoy en esa empresa

      var fila = {
        pausa_id: Utilities.getUuid(),
        empresa_id: config.empresa_id,
        fecha: claveHoy,
        hora_programada: config.hora_habitual || '',
        hora_inicio_real: '',
        hora_fin: '',
        coordinador_email: '',
        estado: ESTADOS_PAUSA.PROGRAMADA,
        duracion_min: config.duracion_min || '',
        observaciones: ''
      };
      agregarFila_(SHEETS.PAUSAS_PROGRAMADAS, fila);
      registrarLogPausas_(fila.pausa_id, contexto || { email: 'sistema' }, 'pausa_programada',
        'empresa ' + config.empresa_id + ' ' + claveHoy + ' ' + fila.hora_programada);
      creadas.push(fila);
    });

    return { fecha: claveHoy, dia_semana: diaIso, creadas: creadas, total_creadas: creadas.length };
  },

  // Punto de entrada del trigger diario (envuelto por Triggers.gs). ADM-only
  // cuando lo dispara una accion del router; el trigger lo llama sin contexto.
  programarDelDiaAdmin: function (data, contexto) {
    var g = guardaAdminPausas_(contexto, 'programar las pausas del dia');
    if (g) return g;
    return Pausas.programarDelDia(new Date(), contexto);
  },

  listarProgramadas: function (data, contexto) {
    var g = guardaAdminPausas_(contexto, 'ver las pausas programadas');
    if (g) return g;
    data = data || {};
    var filas = leerFilasSeguro_(SHEETS.PAUSAS_PROGRAMADAS);
    if (data.empresa_id) {
      filas = filas.filter(function (p) { return String(p.empresa_id) === String(data.empresa_id); });
    }
    if (data.estado) {
      filas = filas.filter(function (p) { return p.estado === data.estado; });
    }
    // Mas recientes primero (por fecha; empate por hora).
    filas.sort(function (a, b) {
      var fa = claveFechaPausa_(a.fecha), fb = claveFechaPausa_(b.fecha);
      if (fa !== fb) return fa < fb ? 1 : -1;
      return String(b.hora_programada).localeCompare(String(a.hora_programada));
    });
    return filas;
  },

  gestionarPausaProgramada: function (data, contexto) {
    var g = guardaAdminPausas_(contexto, 'gestionar las pausas programadas');
    if (g) return g;
    switch (data.operacion) {
      case 'crear_manual': return crearPausaManual_(data, contexto);
      case 'reprogramar': return reprogramarPausa_(data, contexto);
      case 'cancelar': return cancelarPausa_(data, contexto);
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

// --- PAUSAS_PROGRAMADAS: operaciones del ADM (Fase P1) ---------------------

function crearPausaManual_(data, contexto) {
  var empresaId = String(data.empresa_id || '').trim();
  if (!empresaId) {
    return errorValidacion_('empresa_id', 'Indica la empresa de la pausa.');
  }
  var fecha = String(data.fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return errorValidacion_('fecha', 'Indica la fecha en formato AAAA-MM-DD.');
  }
  var hora = normalizarHoraPausas_(data.hora_programada);
  if (data.hora_programada && !hora) {
    return errorValidacion_('hora_programada', 'Hora invalida. Usa el formato HH:mm.');
  }
  // No duplica una pausa viva para la misma empresa/fecha.
  var existe = leerFilasSeguro_(SHEETS.PAUSAS_PROGRAMADAS).some(function (p) {
    return String(p.empresa_id) === empresaId && claveFechaPausa_(p.fecha) === fecha &&
      ESTADOS_PAUSA_TERMINALES.indexOf(p.estado) === -1;
  });
  if (existe) {
    return errorValidacion_('fecha', 'Ya hay una pausa viva para esa empresa en esa fecha.');
  }
  var duracion = enteroPositivoPausas_(data.duracion_min);
  var fila = {
    pausa_id: Utilities.getUuid(),
    empresa_id: empresaId,
    fecha: fecha,
    hora_programada: hora || '',
    hora_inicio_real: '',
    hora_fin: '',
    coordinador_email: '',
    estado: ESTADOS_PAUSA.PROGRAMADA,
    duracion_min: duracion === null ? '' : duracion,
    observaciones: String(data.observaciones || '').trim()
  };
  agregarFila_(SHEETS.PAUSAS_PROGRAMADAS, fila);
  registrarLogPausas_(fila.pausa_id, contexto, 'pausa_creada_manual', 'empresa ' + empresaId + ' ' + fecha);
  return fila;
}

function reprogramarPausa_(data, contexto) {
  if (!data.pausa_id) {
    return errorValidacion_('pausa_id', 'Falta indicar la pausa a reprogramar.');
  }
  var pausa = buscarPausaProgramada_(data.pausa_id);
  if (!pausa) {
    return errorValidacion_('pausa_id', 'Pausa no encontrada.');
  }
  // Solo se puede reprogramar una pausa que aun no arranco.
  if ([ESTADOS_PAUSA.PROGRAMADA, ESTADOS_PAUSA.RECORDATORIO_ENVIADO, ESTADOS_PAUSA.SUSPENDIDA].indexOf(pausa.estado) === -1) {
    return errorValidacion_('estado', 'Solo se puede reprogramar una pausa que aun no comenzo (estado actual: ' + pausa.estado + ').');
  }
  var cambios = {};
  if (data.fecha !== undefined && data.fecha !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.fecha).trim())) {
      return errorValidacion_('fecha', 'Indica la fecha en formato AAAA-MM-DD.');
    }
    cambios.fecha = String(data.fecha).trim();
  }
  if (data.hora_programada !== undefined && data.hora_programada !== '') {
    var hora = normalizarHoraPausas_(data.hora_programada);
    if (!hora) return errorValidacion_('hora_programada', 'Hora invalida. Usa el formato HH:mm.');
    cambios.hora_programada = hora;
  }
  if (Object.keys(cambios).length === 0) {
    return errorValidacion_('fecha', 'Indica al menos la nueva fecha o la nueva hora.');
  }
  // Reprogramar reactiva una pausa suspendida (vuelve a Programada).
  if (pausa.estado === ESTADOS_PAUSA.SUSPENDIDA) {
    cambios.estado = ESTADOS_PAUSA.PROGRAMADA;
  }
  actualizarFilaPorId_(SHEETS.PAUSAS_PROGRAMADAS, 'pausa_id', data.pausa_id, cambios);
  registrarLogPausas_(data.pausa_id, contexto, 'pausa_reprogramada',
    (cambios.fecha || pausa.fecha) + ' ' + (cambios.hora_programada || pausa.hora_programada));
  return Object.assign({}, pausa, cambios);
}

function cancelarPausa_(data, contexto) {
  if (!data.pausa_id) {
    return errorValidacion_('pausa_id', 'Falta indicar la pausa a cancelar.');
  }
  var pausa = buscarPausaProgramada_(data.pausa_id);
  if (!pausa) {
    return errorValidacion_('pausa_id', 'Pausa no encontrada.');
  }
  var res = transicionarPausa_(pausa, ESTADOS_PAUSA.CANCELADA, contexto, {
    observaciones: data.motivo ? String(data.motivo).trim() : pausa.observaciones
  });
  return res;
}

// Nucleo de la maquina de estados: valida que la transicion actual->nuevo este
// declarada en TRANSICIONES_PAUSA y, si lo esta, reescribe la fila. Devuelve
// _validationError si el salto no es valido. `campos` son cambios extra (hora
// real, observaciones, etc.) que la fase que la use quiera persistir junto con
// el estado.
function transicionarPausa_(pausa, nuevoEstado, contexto, campos) {
  var permitidas = TRANSICIONES_PAUSA[pausa.estado] || [];
  if (permitidas.indexOf(nuevoEstado) === -1) {
    return errorValidacion_('estado', 'No se puede pasar de "' + pausa.estado + '" a "' + nuevoEstado + '".');
  }
  var cambios = Object.assign({ estado: nuevoEstado }, campos || {});
  actualizarFilaPorId_(SHEETS.PAUSAS_PROGRAMADAS, 'pausa_id', pausa.pausa_id, cambios);
  registrarLogPausas_(pausa.pausa_id, contexto, 'pausa_estado_' + nuevoEstado,
    pausa.estado + ' -> ' + nuevoEstado);
  return Object.assign({}, pausa, cambios);
}

function buscarPausaProgramada_(pausaId) {
  return leerFilasSeguro_(SHEETS.PAUSAS_PROGRAMADAS).filter(function (p) {
    return String(p.pausa_id) === String(pausaId);
  })[0] || null;
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

// Dia de la semana ISO (1=Lun .. 7=Dom) de una fecha en la zona horaria dada.
// Usa Intl (disponible en Apps Script y en el sandbox de Node), igual que
// claveDia_ -- asi el "que dia es hoy" respeta America/Santiago y no la zona
// del servidor.
function diaSemanaIsoPausas_(fecha, tz) {
  if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return 0;
  var nombre = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(fecha);
  var mapa = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return mapa[nombre] || 0;
}

// Normaliza el valor de `fecha` de una fila (puede venir como Date o string)
// a la clave AAAA-MM-DD, para comparar sin sorpresas de formato.
function claveFechaPausa_(valor) {
  if (valor instanceof Date) return claveDia_(valor, 'America/Santiago');
  var s = String(valor || '').trim();
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
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
