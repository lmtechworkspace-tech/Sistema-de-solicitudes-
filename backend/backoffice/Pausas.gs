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

// Estados en los que un TRABAJADOR aun puede registrar su participacion
// (Fase P2). Una vez Realizada/Cerrada/No_realizada/Cancelada, ya no.
var PAUSAS_ESTADOS_REGISTRABLES = ['Programada', 'Recordatorio_enviado', 'En_curso'];

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
    return leerConfigPausas_();
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

  // Siembra el roster de una empresa desde las cuentas del portal ya
  // existentes (CUENTAS_PORTAL): en vez de cargar trabajador por trabajador,
  // toma cada correo de cada cuenta activa de esa empresa y crea la fila en
  // PAUSAS_TRABAJADORES que falte (nunca duplica por correo). Deja area/cargo
  // vacios o con el cargo de la cuenta -- el admin los ajusta despues fila por
  // fila si hace falta. No toca CUENTAS_PORTAL ni modulos (eso es la otra
  // accion, asignarModuloPausasRoster).
  sembrarRosterDesdeCuentas: function (data, contexto) {
    var g = guardaAdminPausas_(contexto, 'sembrar el roster de pausas');
    if (g) return g;
    var empresaId = String(data.empresa_id || '').trim();
    if (!empresaId) {
      return errorValidacion_('empresa_id', 'Indica la empresa a sembrar.');
    }

    var yaEnRoster = {};
    leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES).forEach(function (t) {
      if (String(t.empresa_id) === empresaId) yaEnRoster[String(t.email).toLowerCase()] = true;
    });

    var creados = [];
    var vistos = {};
    leerFilasSeguro_(SHEETS.CUENTAS_PORTAL).forEach(function (cuenta) {
      var activa = esVerdaderoPausas_(cuenta.activo);
      if (!activa || String(cuenta.empresa_id) !== empresaId) return;
      parsearListaPortal_(cuenta.emails).forEach(function (email) {
        var correo = String(email || '').trim().toLowerCase();
        if (!correo || yaEnRoster[correo] || vistos[correo]) return;
        vistos[correo] = true;
        var fila = {
          trabajador_id: Utilities.getUuid(),
          empresa_id: empresaId,
          nombre: cuenta.nombre || email,
          email: email,
          area: '',
          cargo: cuenta.cargo || '',
          activo: true,
          fecha_ingreso: new Date().toISOString()
        };
        agregarFila_(SHEETS.PAUSAS_TRABAJADORES, fila);
        creados.push(fila);
      });
    });

    registrarLogPausas_('', contexto, 'roster_sembrado', empresaId + ': ' + creados.length + ' nuevos desde cuentas');
    return { empresa_id: empresaId, creados: creados.length };
  },

  // Da el modulo 'pausas' (registro) a la cuenta del portal de CADA trabajador
  // ACTIVO del roster de una empresa cuya cuenta aun no lo tenga. No crea
  // cuentas nuevas -- solo agrega el modulo a las que ya existen y coinciden
  // por correo con el roster. Devuelve cuantas cuentas se actualizaron y
  // cuantos correos del roster no tienen cuenta (para que el admin sepa a
  // quien le falta crearsela).
  asignarModuloPausasRoster: function (data, contexto) {
    var g = guardaAdminPausas_(contexto, 'asignar el modulo de pausas');
    if (g) return g;
    var empresaId = String(data.empresa_id || '').trim();
    if (!empresaId) {
      return errorValidacion_('empresa_id', 'Indica la empresa.');
    }

    var correosRoster = {};
    leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES).forEach(function (t) {
      if (esVerdaderoPausas_(t.activo) && String(t.empresa_id) === empresaId && t.email) {
        correosRoster[String(t.email).toLowerCase()] = true;
      }
    });

    var actualizadas = 0;
    var correosConCuenta = {};
    leerFilasSeguro_(SHEETS.CUENTAS_PORTAL).forEach(function (cuenta) {
      if (!esVerdaderoPausas_(cuenta.activo)) return;
      var emails = parsearListaPortal_(cuenta.emails);
      var coincide = emails.some(function (e) {
        var correo = String(e).toLowerCase();
        if (correosRoster[correo]) correosConCuenta[correo] = true;
        return correosRoster[correo];
      });
      if (!coincide) return;
      var modulos = parsearListaPortal_(cuenta.modulos);
      if (modulos.indexOf('pausas') === -1) {
        modulos.push('pausas');
        actualizarFilaPorId_(SHEETS.CUENTAS_PORTAL, 'cuenta_id', cuenta.cuenta_id, { modulos: JSON.stringify(modulos) });
        actualizadas++;
      }
    });

    var sinCuenta = Object.keys(correosRoster).filter(function (c) { return !correosConCuenta[c]; });
    registrarLogPausas_('', contexto, 'modulo_pausas_masivo', empresaId + ': ' + actualizadas + ' cuentas actualizadas');
    return { empresa_id: empresaId, cuentas_actualizadas: actualizadas, sin_cuenta: sinCuenta };
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
    var configs = leerConfigPausas_().filter(function (c) {
      return esVerdaderoPausas_(c.activo);
    });
    var yaProgramadas = leerProgramadasPausas_();
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
    var filas = leerProgramadasPausas_();
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
  },

  // ---- Registro del trabajador (Fase P2) -----------------------------------
  // El gate de modulo ('pausas') lo aplica el router (MODULO_POR_ACCION) para
  // las sesiones de portal; aqui la identidad ya viene resuelta en contexto.

  // Devuelve la pausa de HOY que este trabajador puede registrar (segun su
  // empresa) y su registro previo si ya lo hizo. Si no hay pausa hoy, o no se
  // puede resolver su empresa, lo informa sin romper.
  getPausaHoyTrabajador: function (data, contexto) {
    var email = contexto && contexto.email;
    if (!email) {
      return { _forbidden: true, message: 'No fue posible identificar tu cuenta.' };
    }
    var trab = resolverTrabajadorPausas_(email);
    if (!trab.empresa_id) {
      return { sin_empresa: true, email: email };
    }
    var pausa = pausaDeHoyEmpresa_(trab.empresa_id);
    if (!pausa) {
      return { empresa_id: trab.empresa_id, pausa: null, registrable: false };
    }
    var registrable = PAUSAS_ESTADOS_REGISTRABLES.indexOf(pausa.estado) !== -1;
    var miRegistro = buscarRegistroAsistencia_(pausa.pausa_id, email);
    return {
      empresa_id: trab.empresa_id,
      nombre: trab.nombre || '',
      pausa: {
        pausa_id: pausa.pausa_id,
        fecha: claveFechaPausa_(pausa.fecha),
        hora_programada: pausa.hora_programada || '',
        duracion_min: pausa.duracion_min || '',
        estado: pausa.estado
      },
      registrable: registrable,
      mi_registro: miRegistro ? {
        estado: miRegistro.estado, motivo: miRegistro.motivo || '',
        comentario: miRegistro.comentario || '', fecha_hora_registro: miRegistro.fecha_hora_registro
      } : null
    };
  },

  // Registra (o corrige) la participacion del trabajador en la pausa de hoy.
  // El "trio probatorio" (§4 de la propuesta): identidad autenticada (email
  // del contexto) + timestamp del servidor + declaracion (confirmacion). No
  // hay firma dibujada.
  registrarAsistencia: function (data, contexto) {
    var email = contexto && contexto.email;
    if (!email) {
      return { _forbidden: true, message: 'No fue posible identificar tu cuenta.' };
    }
    var estado = String(data.estado || '').trim();
    if (['participo', 'no_participo'].indexOf(estado) === -1) {
      return errorValidacion_('estado', 'Indica si participaste o no en la pausa.');
    }
    var trab = resolverTrabajadorPausas_(email);
    if (!trab.empresa_id) {
      return errorValidacion_('empresa_id', 'No pudimos determinar tu empresa. Avisa al administrador.');
    }
    var pausa = pausaDeHoyEmpresa_(trab.empresa_id);
    if (!pausa) {
      return errorValidacion_('pausa', 'No hay una pausa activa programada para hoy.');
    }
    if (PAUSAS_ESTADOS_REGISTRABLES.indexOf(pausa.estado) === -1) {
      return errorValidacion_('pausa', 'La pausa de hoy ya no admite registros (estado: ' + pausa.estado + ').');
    }
    if (estado === 'participo' && data.confirmacion !== true && data.confirmacion !== 'true') {
      return errorValidacion_('confirmacion', 'Debes marcar la declaración de participación.');
    }
    var motivo = String(data.motivo || '').trim();
    if (estado === 'no_participo' && !motivo) {
      return errorValidacion_('motivo', 'Indica el motivo por el que no pudiste participar.');
    }

    // v7.2 (Bloque A, mejora A6): micro-encuesta de bienestar, OPCIONAL --
    // 1..5, nunca obligatoria (no debe ser una barrera para registrar la
    // participacion). Solo se guarda si viene un numero valido en ese rango;
    // si no, queda vacia. Nunca se muestra por persona (RN-708) -- solo
    // promedio agregado en calcularReportePausas_.
    var animo = enteroPositivoPausas_(data.animo);
    if (animo !== null && (animo < 1 || animo > 5)) animo = null;

    var fila = {
      pausa_id: pausa.pausa_id,
      trabajador_id: trab.trabajador_id || '',
      email: email,
      fecha_hora_registro: new Date().toISOString(),
      estado: estado,
      motivo: estado === 'no_participo' ? motivo : '',
      comentario: String(data.comentario || '').trim(),
      confirmacion: estado === 'participo',
      origen: 'autoservicio',
      animo: animo === null ? '' : animo
    };

    // Un registro por (pausa, correo): si ya existe, se actualiza (el
    // trabajador puede corregir "no pude" -> "participé" antes del cierre).
    var previo = buscarRegistroAsistencia_(pausa.pausa_id, email);
    if (previo) {
      actualizarFilaPorId_(SHEETS.PAUSAS_ASISTENCIA, 'registro_id', previo.registro_id, fila);
      registrarLogPausas_(pausa.pausa_id, contexto, 'asistencia_actualizada', email + ' -> ' + estado);
      return Object.assign({ registro_id: previo.registro_id }, fila);
    }
    fila.registro_id = Utilities.getUuid();
    agregarFila_(SHEETS.PAUSAS_ASISTENCIA, fila);
    registrarLogPausas_(pausa.pausa_id, contexto, 'asistencia_registrada', email + ' -> ' + estado);
    return fila;
  },

  // v7.2 (Bloque A, mejora A1 "pasar lista grupal"): el coordinador registra
  // en UN solo envio la participacion de varios trabajadores del roster --
  // pensado para el taller presencial donde nadie tiene el celular a mano
  // para autoregistrarse. `data.registros` es un arreglo de
  // { trabajador_id, estado: 'participo'|'no_participo', motivo? }. No pisa
  // un registro que el propio trabajador ya se auto-registro (origen
  // 'autoservicio') salvo que `data.sobrescribir` sea true -- por defecto el
  // autorregistro de la persona manda sobre lo que marque el coordinador.
  registrarAsistenciaGrupal: function (data, contexto) {
    var pausa = buscarPausaProgramada_(data.pausa_id);
    if (!pausa) {
      return errorValidacion_('pausa_id', 'Pausa no encontrada.');
    }
    var g = guardaCoordinadorPausa_(contexto, pausa);
    if (g) return g;
    if (PAUSAS_ESTADOS_REGISTRABLES.indexOf(pausa.estado) === -1) {
      return errorValidacion_('pausa', 'La pausa de hoy ya no admite registros (estado: ' + pausa.estado + ').');
    }
    var registros = Array.isArray(data.registros) ? data.registros : [];
    if (!registros.length) {
      return errorValidacion_('registros', 'Indica al menos un trabajador a marcar.');
    }
    var roster = leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES).filter(function (t) {
      return esVerdaderoPausas_(t.activo) && String(t.empresa_id) === String(pausa.empresa_id);
    });
    var porId = {};
    roster.forEach(function (t) { porId[String(t.trabajador_id)] = t; });

    var actualizados = 0, omitidos = 0, invalidos = 0;
    registros.forEach(function (r) {
      var trab = porId[String(r && r.trabajador_id)];
      if (!trab) { invalidos++; return; }
      var estado = String((r && r.estado) || '').trim();
      if (['participo', 'no_participo'].indexOf(estado) === -1) { invalidos++; return; }

      var previo = buscarRegistroAsistencia_(pausa.pausa_id, trab.email);
      if (previo && previo.origen === 'autoservicio' && data.sobrescribir !== true) {
        omitidos++; return; // el trabajador ya se autoregistro -- manda su version
      }

      var fila = {
        pausa_id: pausa.pausa_id,
        trabajador_id: trab.trabajador_id,
        email: trab.email,
        fecha_hora_registro: new Date().toISOString(),
        estado: estado,
        motivo: estado === 'no_participo' ? String((r && r.motivo) || '').trim() : '',
        comentario: '',
        confirmacion: estado === 'participo',
        origen: 'pasada_lista',
        animo: ''
      };
      if (previo) {
        actualizarFilaPorId_(SHEETS.PAUSAS_ASISTENCIA, 'registro_id', previo.registro_id, fila);
      } else {
        fila.registro_id = Utilities.getUuid();
        agregarFila_(SHEETS.PAUSAS_ASISTENCIA, fila);
      }
      actualizados++;
    });

    registrarLogPausas_(pausa.pausa_id, contexto, 'asistencia_grupal',
      actualizados + ' marcados, ' + omitidos + ' omitidos (autoservicio), ' + invalidos + ' invalidos');
    return { pausa_id: pausa.pausa_id, actualizados: actualizados, omitidos: omitidos, invalidos: invalidos };
  },

  // ---- Coordinador: operar la pausa + reportes (Fase P3) -------------------
  // El gate de modulo ('pausas_coordinacion') lo aplica el router. Ademas,
  // cada operacion verifica que quien la ejecuta sea coordinador ACTIVO de la
  // empresa de esa pausa (o ADM) -- esconder el boton no es seguridad.

  // Panel "Hoy": la(s) pausa(s) de hoy de la(s) empresa(s) que coordina, cada
  // una con su participacion en vivo (participaron / no pudieron / pendientes).
  getPanelCoordinador: function (data, contexto) {
    var email = contexto && contexto.email;
    if (!email) {
      return { _forbidden: true, message: 'No fue posible identificar tu cuenta.' };
    }
    var empresas = empresasQueCoordina_(contexto);
    if (empresas.length === 0) {
      return { sin_empresa: true, pausas: [] };
    }
    var hoy = claveDia_(new Date(), 'America/Santiago');
    var todas = leerProgramadasPausas_();
    var pausas = todas
      .filter(function (p) {
        return empresas.indexOf(String(p.empresa_id)) !== -1 && claveFechaPausa_(p.fecha) === hoy;
      })
      .map(function (p) {
        return {
          pausa_id: p.pausa_id,
          empresa_id: p.empresa_id,
          fecha: claveFechaPausa_(p.fecha),
          hora_programada: p.hora_programada || '',
          hora_inicio_real: p.hora_inicio_real || '',
          hora_fin: p.hora_fin || '',
          estado: p.estado,
          duracion_min: p.duracion_min || '',
          observaciones: p.observaciones || '',
          evidencia_url: p.evidencia_url || '',
          participacion: participacionDePausa_(p.pausa_id, p.empresa_id)
        };
      });
    return { empresas: empresas, pausas: pausas };
  },

  gestionarPausaCoordinador: function (data, contexto) {
    var pausa = buscarPausaProgramada_(data.pausa_id);
    if (!pausa) {
      return errorValidacion_('pausa_id', 'Pausa no encontrada.');
    }
    var g = guardaCoordinadorPausa_(contexto, pausa);
    if (g) return g;

    switch (data.operacion) {
      case 'iniciar':
        return transicionarPausa_(pausa, ESTADOS_PAUSA.EN_CURSO, contexto, {
          hora_inicio_real: new Date().toISOString(),
          coordinador_email: contexto.email
        });
      case 'finalizar':
        var cambiosFinalizar = {
          hora_fin: new Date().toISOString(),
          coordinador_email: pausa.coordinador_email || contexto.email,
          observaciones: data.observaciones ? String(data.observaciones).trim() : pausa.observaciones
        };
        // v6.0 (mejora #4): evidencia de la charla, OPCIONAL -- una foto que
        // respalda que la pausa se realizo (util ante fiscalizacion). Si el
        // upload falla, no se bloquea el finalizar (la pausa igual se cierra;
        // el error queda en LOG_SISTEMA para diagnostico).
        if (data.evidencia_base64) {
          var evidencia = subirEvidenciaPausa_(pausa, String(data.evidencia_nombre || 'evidencia.jpg'), data.evidencia_base64);
          if (evidencia && evidencia._validationError) return evidencia;
          if (evidencia) cambiosFinalizar.evidencia_url = evidencia.url;
        }
        return transicionarPausa_(pausa, ESTADOS_PAUSA.REALIZADA, contexto, cambiosFinalizar);
      case 'no_realizada':
        var motivo = String(data.motivo || '').trim();
        if (!motivo) {
          return errorValidacion_('motivo', 'Indica el motivo por el que no se realizo la pausa.');
        }
        return transicionarPausa_(pausa, ESTADOS_PAUSA.NO_REALIZADA, contexto, {
          coordinador_email: contexto.email, observaciones: motivo
        });
      default:
        return errorValidacion_('operacion', 'Operacion invalida: ' + data.operacion);
    }
  },

  // Reporte de cumplimiento para el coordinador (su propio apartado, §7.6).
  // Acotado a la(s) empresa(s) que coordina. Periodo por defecto: 30 dias.
  getReporteCumplimiento: function (data, contexto) {
    var empresas = empresasQueCoordina_(contexto);
    if (empresas.length === 0) {
      return { sin_empresa: true };
    }
    return calcularReportePausas_(empresas, data && data.desde, data && data.hasta);
  },

  // v6.0 (mejora #7): roster de las empresas que coordina (o TODAS, si es
  // ADM) -- para el selector del historial por trabajador. Solo activos.
  listarRosterCoordinador: function (data, contexto) {
    var empresas = empresasQueCoordina_(contexto);
    if (empresas.length === 0) return { sin_empresa: true, roster: [] };
    var roster = leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES).filter(function (t) {
      return esVerdaderoPausas_(t.activo) && empresas.indexOf(String(t.empresa_id)) !== -1;
    }).map(function (t) {
      return { trabajador_id: t.trabajador_id, nombre: t.nombre || t.email, email: t.email, area: t.area || '', empresa_id: t.empresa_id };
    }).sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre)); });
    return { roster: roster };
  },

  // v6.0 (mejora #7): historial de un trabajador -- racha de participacion
  // (para RRHH/prevencion: "¿quien participa siempre y quien nunca?"). Solo
  // sobre pausas YA RESUELTAS (Realizada/Cerrada/No_realizada): las
  // Programadas de hoy/futuro no cuentan como "falta" todavia. Acotado a la
  // empresa que el coordinador coordina (o cualquiera, si es ADM).
  getHistorialTrabajador: function (data, contexto) {
    var trabajadorId = String(data.trabajador_id || '').trim();
    if (!trabajadorId) {
      return errorValidacion_('trabajador_id', 'Indica el trabajador.');
    }
    var trabajador = leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES).filter(function (t) {
      return String(t.trabajador_id) === trabajadorId;
    })[0];
    if (!trabajador) {
      return errorValidacion_('trabajador_id', 'Trabajador no encontrado.');
    }
    var empresas = empresasQueCoordina_(contexto);
    if (empresas.indexOf(String(trabajador.empresa_id)) === -1) {
      return { _forbidden: true, message: 'No coordinas la empresa de este trabajador.' };
    }

    var hoy = claveDia_(new Date(), 'America/Santiago');
    var hastaC = /^\d{4}-\d{2}-\d{2}$/.test(String(data.hasta || '')) ? data.hasta : hoy;
    var desdeC = /^\d{4}-\d{2}-\d{2}$/.test(String(data.desde || '')) ? data.desde
      : claveDia_(new Date(Date.now() - 90 * 24 * 3600 * 1000), 'America/Santiago');

    var RESUELTOS = [ESTADOS_PAUSA.REALIZADA, ESTADOS_PAUSA.CERRADA, ESTADOS_PAUSA.NO_REALIZADA];
    var pausas = leerProgramadasPausas_().filter(function (p) {
      var f = claveFechaPausa_(p.fecha);
      return String(p.empresa_id) === String(trabajador.empresa_id) && f >= desdeC && f <= hastaC &&
        RESUELTOS.indexOf(p.estado) !== -1;
    }).sort(function (a, b) { return claveFechaPausa_(a.fecha) < claveFechaPausa_(b.fecha) ? -1 : 1; });

    var registrosPorPausa = {};
    leerFilasSeguro_(SHEETS.PAUSAS_ASISTENCIA).forEach(function (r) {
      if (String(r.email).toLowerCase() === String(trabajador.email).toLowerCase()) {
        registrosPorPausa[String(r.pausa_id)] = r;
      }
    });

    // v7.2 (Bloque A, mejora A7): "no se hizo la pausa" (decision de la
    // empresa/coordinador, pausa.estado === No_realizada) es un hecho
    // DISTINTO de "el trabajador no registro su participacion" (la pausa SI
    // se hizo, pero esta persona no dejo constancia). Antes ambos casos caian
    // en el mismo cubo "pendiente", lo que hacia ver como "falto" a alguien
    // cuando en realidad la empresa entera no tuvo pausa ese dia.
    var detalle = pausas.map(function (p) {
      var reg = registrosPorPausa[String(p.pausa_id)];
      var miEstado;
      if (p.estado === ESTADOS_PAUSA.NO_REALIZADA) {
        miEstado = 'no_aplica'; // la empresa no hizo la pausa -- no es una falta individual.
      } else {
        miEstado = reg ? reg.estado : 'sin_registro'; // la pausa SI se hizo; esta persona no registro.
      }
      return {
        fecha: claveFechaPausa_(p.fecha), estado_pausa: p.estado,
        mi_estado: miEstado, motivo: (reg && reg.motivo) || ''
      };
    });

    var participaciones = detalle.filter(function (d) { return d.mi_estado === 'participo'; }).length;
    var justificaciones = detalle.filter(function (d) { return d.mi_estado === 'no_participo'; }).length;
    var sinRegistro = detalle.filter(function (d) { return d.mi_estado === 'sin_registro'; }).length;
    var noAplica = detalle.filter(function (d) { return d.mi_estado === 'no_aplica'; }).length;

    // Racha actual: consecutivos 'participo' contando desde el mas reciente
    // hacia atras -- 'no_aplica' (la empresa no hizo la pausa) NO corta la
    // racha, simplemente se salta (no es un dia donde la persona pudiera
    // haber participado). Racha maxima: la mas larga en toda la ventana.
    var rachaActual = 0;
    for (var i = detalle.length - 1; i >= 0; i--) {
      if (detalle[i].mi_estado === 'no_aplica') continue;
      if (detalle[i].mi_estado === 'participo') rachaActual++; else break;
    }
    var rachaMaxima = 0, corrida = 0;
    detalle.forEach(function (d) {
      if (d.mi_estado === 'no_aplica') return;
      corrida = d.mi_estado === 'participo' ? corrida + 1 : 0;
      if (corrida > rachaMaxima) rachaMaxima = corrida;
    });

    // El denominador de "% participacion" son los dias que SI contaban para
    // la persona (se excluye no_aplica -- la empresa no hizo esa pausa).
    var diasQueContaban = detalle.length - noAplica;

    return {
      trabajador: { trabajador_id: trabajador.trabajador_id, nombre: trabajador.nombre || trabajador.email, email: trabajador.email, area: trabajador.area || '', empresa_id: trabajador.empresa_id },
      periodo: { desde: desdeC, hasta: hastaC },
      resumen: {
        total_pausas: detalle.length, participaciones: participaciones, justificaciones: justificaciones,
        sin_registro: sinRegistro, no_aplica: noAplica,
        pct_participacion: diasQueContaban === 0 ? null : Math.round((participaciones / diasQueContaban) * 1000) / 10,
        racha_actual: rachaActual, racha_maxima: rachaMaxima
      },
      detalle: detalle.slice().reverse() // mas reciente primero, para la UI
    };
  },

  // ---- Alertas (Fase P4): recordatorio + resumen diario --------------------
  // Las disparan triggers; devuelven un resumen de lo enviado. Idempotentes:
  // el recordatorio pasa la pausa a Recordatorio_enviado (no reenvia) y el
  // resumen se deduplica por (pausa, destinatario) en LOG_NOTIFICACIONES.

  // Recordatorio a los trabajadores (y coordinadoras) de que la pausa de hoy
  // se acerca. Se envia cuando faltan <= min_anticipacion minutos para la hora
  // programada. `opts.ahoraMin` (minutos del dia) permite fijarlo en tests.
  enviarRecordatoriosPausas: function (opts) {
    opts = opts || {};
    var ahoraMin = (opts.ahoraMin === undefined || opts.ahoraMin === null)
      ? minutosDelDiaSantiago_() : opts.ahoraMin;
    var hoy = claveDia_(new Date(), 'America/Santiago');
    var configs = leerConfigPausas_().filter(function (c) { return esVerdaderoPausas_(c.activo); });
    var pausas = leerProgramadasPausas_();
    var enviados = 0, avisadas = 0;

    configs.forEach(function (config) {
      var pausa = pausas.filter(function (p) {
        return String(p.empresa_id) === String(config.empresa_id) &&
          claveFechaPausa_(p.fecha) === hoy && p.estado === ESTADOS_PAUSA.PROGRAMADA;
      })[0];
      if (!pausa) return;
      var horaMin = horaAMinutosPausas_(pausa.hora_programada);
      if (horaMin === null) return; // sin hora, no se puede agendar el aviso
      var anticip = enteroNoNegativoPausas_(config.min_anticipacion);
      if (anticip === null) anticip = 15;
      if (ahoraMin < horaMin - anticip) return; // todavia no toca

      var destinatarios = destinatariosRecordatorio_(config.empresa_id);
      var asunto = 'SIGSO — Recordatorio de pausa activa (' + (pausa.hora_programada || '') + ')';
      // v6.0 (Pausas P4.1): enlace magico PERSONAL por destinatario -- entra
      // directo al modulo "Pausas activas" sin pedir clave, en vez de "entra a
      // la plataforma" a secas. Si el correo no tiene cuenta del portal, o el
      // sitio publico no esta configurado (Script Properties), se omite el
      // boton sin romper el envio -- el correo sigue saliendo igual.
      destinatarios.forEach(function (correo) {
        var enlace = enlaceMagicoPausas_(correo, 'pausas');
        var cuerpoHtml = plantillaCorreoHtml_('Pausa activa de hoy',
          '<p style="margin:0 0 10px;">Hoy tienes tu <strong>pausa activa</strong> a las ' +
          escaparHtmlCorreo_(pausa.hora_programada || '') + ' (' + escaparHtmlCorreo_(String(pausa.duracion_min || '')) + ' min).</p>' +
          '<p style="margin:0 0 ' + (enlace ? '16px' : '0') + ';">Al terminar, entra a la plataforma y registra tu participación en el módulo <strong>Pausas activas</strong>.</p>' +
          (enlace ? botonCorreoPausas_(enlace, 'Registrar mi participación') : ''),
          { pie: 'Participar toma unos segundos: ✅ Participé o ✋ No pude participar.' });
        var texto = 'Hoy tienes tu pausa activa a las ' + (pausa.hora_programada || '') + '. ' +
          (enlace ? 'Registra tu participación aquí: ' + enlace
                  : 'Registra tu participación en la plataforma (módulo Pausas activas).');
        var r = enviarCorreo_(pausa.pausa_id, correo, 'PAUSA_RECORDATORIO', asunto, texto, 720, { htmlBody: cuerpoHtml });
        if (r.enviado) enviados++;
      });
      // v7.1 (notificaciones vivas): espejo del correo -- toast/modal en
      // pantalla para quien tenga SIGSO abierto y no revise el correo. Se
      // encola en LOTE (una sola escritura para todo el roster).
      encolarNotificacionAppLote_(destinatarios.map(function (correo) {
        return {
          destinatario: correo, tipo: 'PAUSA_RECORDATORIO',
          titulo: 'Pausa activa de hoy',
          mensaje: 'Tu pausa activa es a las ' + (pausa.hora_programada || '') + '.',
          modulo_id: 'pausas', texto_accion: 'Ver pausas activas', vidaHoras: 6
        };
      }));
      // Marca la pausa como recordada -> no se reenvia (y sigue registrable).
      transicionarPausa_(pausa, ESTADOS_PAUSA.RECORDATORIO_ENVIADO, { email: 'sistema' }, {});
      avisadas++;
    });
    return { pausas_avisadas: avisadas, correos_enviados: enviados };
  },

  // v6.0 (mejora): SEGUNDO aviso, mas urgente, en el momento exacto en que
  // llega la hora programada -- distinto del recordatorio de arriba (que sale
  // min_anticipacion antes). Dos avisos separados porque van a publicos
  // distintos:
  //   - "Ultima llamada" a los trabajadores: la pausa de hoy YA es ahora.
  //   - Aviso a la coordinadora: "es hora de iniciar la pausa" -- reduce el
  //     olvido que hoy solo se resuelve al final del dia con el auto-cierre.
  // Cada aviso se manda UNA vez por pausa (flags ultima_llamada_enviada /
  // aviso_coordinador_enviado en PAUSAS_PROGRAMADAS). Solo aplica a pausas
  // que todavia no arrancaron (Programada/Recordatorio_enviado) -- si ya esta
  // En_curso, la coordinadora ya la inicio y no hace falta avisarle.
  enviarSegundosAvisosPausas: function (opts) {
    opts = opts || {};
    var ahoraMin = (opts.ahoraMin === undefined || opts.ahoraMin === null)
      ? minutosDelDiaSantiago_() : opts.ahoraMin;
    var hoy = claveDia_(new Date(), 'America/Santiago');
    var pausas = leerProgramadasPausas_().filter(function (p) {
      return claveFechaPausa_(p.fecha) === hoy &&
        (p.estado === ESTADOS_PAUSA.PROGRAMADA || p.estado === ESTADOS_PAUSA.RECORDATORIO_ENVIADO);
    });
    var ultimaLlamada = 0, avisoCoordinadora = 0;

    pausas.forEach(function (pausa) {
      var horaMin = horaAMinutosPausas_(pausa.hora_programada);
      if (horaMin === null || ahoraMin < horaMin) return; // todavia no llega la hora

      if (!esVerdaderoPausas_(pausa.ultima_llamada_enviada)) {
        var asunto = 'SIGSO — ¡Es ahora! Tu pausa activa (' + (pausa.hora_programada || '') + ')';
        var destUltima = destinatariosRecordatorio_(pausa.empresa_id);
        destUltima.forEach(function (correo) {
          var enlace = enlaceMagicoPausas_(correo, 'pausas');
          var cuerpoHtml = plantillaCorreoHtml_('¡Es ahora tu pausa activa!',
            '<p style="margin:0 0 ' + (enlace ? '16px' : '0') + ';">Tu pausa activa de hoy es <strong>ahora mismo</strong>. Cuando termines, registra tu participación.</p>' +
            (enlace ? botonCorreoPausas_(enlace, 'Registrar mi participación') : ''));
          var texto = 'Tu pausa activa de hoy es ahora mismo.' +
            (enlace ? ' Registra tu participación aquí: ' + enlace : ' Registra tu participación en la plataforma.');
          var r = enviarCorreo_(pausa.pausa_id + ':ultima_llamada', correo, 'PAUSA_ULTIMA_LLAMADA', asunto, texto, 720, { htmlBody: cuerpoHtml });
          if (r.enviado) ultimaLlamada++;
        });
        // v7.1 (notificaciones vivas): esta es la mas critica de las tres
        // (arranca YA) -- vida corta (2h) porque pasado ese rato ya no tiene
        // sentido mostrarla como "ahora". Encolado en LOTE.
        encolarNotificacionAppLote_(destUltima.map(function (correo) {
          return {
            destinatario: correo, tipo: 'PAUSA_ULTIMA_LLAMADA',
            titulo: '¡Es ahora tu pausa activa!',
            mensaje: 'Tu pausa activa de hoy es ahora mismo. Registra tu participación al terminar.',
            modulo_id: 'pausas', texto_accion: 'Registrar participación', vidaHoras: 2
          };
        }));
        actualizarFilaPorId_(SHEETS.PAUSAS_PROGRAMADAS, 'pausa_id', pausa.pausa_id, { ultima_llamada_enviada: true });
      }

      if (!esVerdaderoPausas_(pausa.aviso_coordinador_enviado)) {
        var asuntoCoord = 'SIGSO — Inicia la pausa activa de ' + pausa.empresa_id;
        var destCoord = coordinadorasDeEmpresa_(pausa.empresa_id);
        destCoord.forEach(function (correo) {
          var enlace = enlaceMagicoPausas_(correo, 'pausas_coordinacion');
          var cuerpoHtml = plantillaCorreoHtml_('Es hora de iniciar la pausa',
            '<p style="margin:0 0 ' + (enlace ? '16px' : '0') + ';">Ya llegó la hora programada (' +
            escaparHtmlCorreo_(pausa.hora_programada || '') + ') de la pausa activa de <strong>' +
            escaparHtmlCorreo_(pausa.empresa_id) + '</strong>. Entra a Coordinación de pausas para iniciarla.</p>' +
            (enlace ? botonCorreoPausas_(enlace, 'Iniciar la pausa') : ''));
          var texto = 'Ya llegó la hora de la pausa activa de ' + pausa.empresa_id + '. ' +
            (enlace ? 'Inícala aquí: ' + enlace : 'Inícala desde Coordinación de pausas.');
          var r = enviarCorreo_(pausa.pausa_id + ':aviso_coordinador', correo, 'PAUSA_AVISO_COORDINADOR', asuntoCoord, texto, 720, { htmlBody: cuerpoHtml });
          if (r.enviado) avisoCoordinadora++;
        });
        encolarNotificacionAppLote_(destCoord.map(function (correo) {
          return {
            destinatario: correo, tipo: 'PAUSA_AVISO_COORDINADOR',
            titulo: 'Es hora de iniciar la pausa',
            mensaje: 'La pausa activa de ' + pausa.empresa_id + ' ya debería iniciar.',
            modulo_id: 'pausas_coordinacion', texto_accion: 'Iniciar la pausa', vidaHoras: 2
          };
        }));
        actualizarFilaPorId_(SHEETS.PAUSAS_PROGRAMADAS, 'pausa_id', pausa.pausa_id, { aviso_coordinador_enviado: true });
      }
    });

    return { ultima_llamada: ultimaLlamada, aviso_coordinadora: avisoCoordinadora };
  },

  // v7.2 (Bloque A, mejora A8 "resiliencia del coordinador"): si NINGUN
  // coordinador (titular ni reemplazo, que ya reciben el aviso juntos --
  // enviarSegundosAvisosPausas) inicio la pausa pasado un margen de la hora
  // programada, escala a Administracion -- para que alguien pueda reaccionar
  // (contactar a la coordinadora por otro medio, o iniciarla igual desde
  // Administracion) antes de que el cierre automatico nocturno la de por
  // No_realizada sin que nadie se haya enterado a tiempo. Se manda UNA vez
  // por pausa (escalada_admin_enviada). `opts.margenMin` (default 30) y
  // `opts.ahoraMin` permiten fijarlo en tests.
  escalarPausasSinIniciar: function (opts) {
    opts = opts || {};
    var margenMin = opts.margenMin === undefined ? 30 : opts.margenMin;
    var ahoraMin = (opts.ahoraMin === undefined || opts.ahoraMin === null)
      ? minutosDelDiaSantiago_() : opts.ahoraMin;
    var hoy = claveDia_(new Date(), 'America/Santiago');
    var pausas = leerProgramadasPausas_().filter(function (p) {
      return claveFechaPausa_(p.fecha) === hoy &&
        (p.estado === ESTADOS_PAUSA.PROGRAMADA || p.estado === ESTADOS_PAUSA.RECORDATORIO_ENVIADO) &&
        !esVerdaderoPausas_(p.escalada_admin_enviada);
    });
    var escaladas = 0, correosEnviados = 0;

    pausas.forEach(function (pausa) {
      var horaMin = horaAMinutosPausas_(pausa.hora_programada);
      if (horaMin === null || ahoraMin < horaMin + margenMin) return; // aun dentro del margen

      var destinatarios = [];
      try { destinatarios = obtenerEmailsPorRol_(pausa.empresa_id, ['ADM']); } catch (err) { /* USUARIOS puede no existir */ }
      if (!destinatarios.length) { // sin ADM identificable: no hay a quien escalar, igual se marca para no reintentar cada ciclo
        actualizarFilaPorId_(SHEETS.PAUSAS_PROGRAMADAS, 'pausa_id', pausa.pausa_id, { escalada_admin_enviada: true });
        return;
      }

      var asunto = 'SIGSO — Nadie inició la pausa activa de ' + pausa.empresa_id;
      var cuerpoHtml = plantillaCorreoHtml_('Pausa activa sin iniciar',
        '<p style="margin:0 0 10px;">La pausa activa de <strong>' + escaparHtmlCorreo_(pausa.empresa_id) +
        '</strong> programada para las ' + escaparHtmlCorreo_(pausa.hora_programada || '') +
        ' sigue sin iniciarse, ' + margenMin + ' minutos después. Ni la coordinadora titular ni el reemplazo la han abierto.</p>' +
        '<p style="margin:0;">Puedes contactarlas por otro medio, o iniciarla tú desde Coordinación de pausas.</p>');
      var texto = 'La pausa activa de ' + pausa.empresa_id + ' (' + (pausa.hora_programada || '') +
        ') sigue sin iniciarse ' + margenMin + ' minutos después.';
      destinatarios.forEach(function (correo) {
        var r = enviarCorreo_(pausa.pausa_id + ':escalada_admin', correo, 'PAUSA_ESCALADA_ADMIN', asunto, texto, 720, { htmlBody: cuerpoHtml });
        if (r.enviado) correosEnviados++;
      });
      encolarNotificacionAppLote_(destinatarios.map(function (correo) {
        return {
          destinatario: correo, tipo: 'PAUSA_ESCALADA_ADMIN',
          titulo: 'Nadie inició la pausa de ' + pausa.empresa_id,
          mensaje: 'Han pasado ' + margenMin + ' min desde la hora programada sin que la coordinadora la inicie.',
          modulo_id: 'pausas_coordinacion', texto_accion: 'Ver pausas', vidaHoras: 4
        };
      }));
      actualizarFilaPorId_(SHEETS.PAUSAS_PROGRAMADAS, 'pausa_id', pausa.pausa_id, { escalada_admin_enviada: true });
      escaladas++;
    });

    return { pausas_escaladas: escaladas, correos_enviados: correosEnviados };
  },

  // ---- Reportes de Gerencia + programados (Fase P5) ------------------------

  // Reporte de cumplimiento para GERENCIA/ADM: TODAS las empresas (o una, con
  // data.empresa_id). Mismo calculo que el del coordinador, pero sin acotar a
  // las empresas que uno coordina. Gate 'gerencia' via el router.
  getReporteGerencia: function (data, contexto) {
    var empresas = empresasVisiblesGerencia_(contexto);
    if (empresas.length === 0) {
      return { sin_datos: true, kpis: {}, motivos: [], por_area: [], pausas: [] };
    }
    if (data && data.empresa_id) {
      empresas = empresas.filter(function (e) { return String(e) === String(data.empresa_id); });
    }
    return calcularReportePausas_(empresas, data && data.desde, data && data.hasta);
  },

  // PDF descargable del reporte de cumplimiento del COORDINADOR (mismo dato
  // que getReporteCumplimiento) -- boton "Descargar PDF" del apartado
  // Reportes de Coordinación de pausas. Mismo patron que
  // OrdenTrabajo.descargar / ReporteActividades.descargarReporte.
  descargarReporteCumplimientoPdf: function (data, contexto) {
    var empresas = empresasQueCoordina_(contexto);
    if (empresas.length === 0) {
      return errorValidacion_('empresa_id', 'No coordinas ninguna empresa con pausas activas.');
    }
    var reporte = calcularReportePausas_(empresas, data && data.desde, data && data.hasta);
    return armarDescargaReportePausas_(reporte);
  },

  // PDF descargable del reporte de GERENCIA (todas las empresas, o una con
  // data.empresa_id) -- mismo dato que getReporteGerencia.
  descargarReporteGerenciaPdf: function (data, contexto) {
    var empresas = empresasVisiblesGerencia_(contexto);
    if (data && data.empresa_id) {
      empresas = empresas.filter(function (e) { return String(e) === String(data.empresa_id); });
    }
    if (empresas.length === 0) {
      return errorValidacion_('empresa_id', 'No hay pausas activas configuradas.');
    }
    var reporte = calcularReportePausas_(empresas, data && data.desde, data && data.hasta);
    return armarDescargaReportePausas_(reporte);
  },

  // Reporte periodico por correo (a Gerencia + prevencionistas) con el PDF
  // adjunto. `periodo` = 'semanal' | 'mensual'.
  enviarReporteSemanalPausas: function () { return enviarReportePeriodicoPausas_('semanal'); },
  enviarReporteMensualPausas: function () { return enviarReportePeriodicoPausas_('mensual'); },

  // Resumen de fin de dia (a coordinadoras + admin): que paso con la pausa de
  // hoy (estado + participacion + justificaciones). Se deduplica por pausa.
  enviarResumenDiarioPausas: function () {
    var hoy = claveDia_(new Date(), 'America/Santiago');
    var pausas = leerProgramadasPausas_().filter(function (p) {
      return claveFechaPausa_(p.fecha) === hoy && p.estado !== ESTADOS_PAUSA.CANCELADA;
    });
    var enviados = 0;
    pausas.forEach(function (pausa) {
      var part = participacionDePausa_(pausa.pausa_id, pausa.empresa_id);
      var destinatarios = destinatariosResumenPausa_(pausa.empresa_id);
      var asunto = 'SIGSO — Resumen de la pausa activa de hoy (' + pausa.empresa_id + ')';
      var cuerpoHtml = plantillaCorreoHtml_('Resumen de pausa activa',
        '<table cellpadding="0" cellspacing="0" style="font-size:14px;">' +
        filaDetalleCorreo_('Empresa', pausa.empresa_id) +
        filaDetalleCorreo_('Estado', String(pausa.estado).replace(/_/g, ' ')) +
        filaDetalleCorreo_('Hora', pausa.hora_programada || '—') +
        filaDetalleCorreo_('Participaron', part.n_participaron + ' de ' + part.total_roster +
          (part.pct_participacion == null ? '' : ' (' + part.pct_participacion + '%)')) +
        filaDetalleCorreo_('Justificaron', String(part.n_justificaron)) +
        filaDetalleCorreo_('Pendientes', String(part.n_pendientes)) +
        '</table>');
      var texto = 'Pausa de hoy (' + pausa.empresa_id + '): estado ' + pausa.estado +
        ', participaron ' + part.n_participaron + ' de ' + part.total_roster + '.';
      destinatarios.forEach(function (correo) {
        var r = enviarCorreo_(pausa.pausa_id, correo, 'PAUSA_RESUMEN_DIARIO', asunto, texto, 720, { htmlBody: cuerpoHtml });
        if (r.enviado) enviados++;
      });
    });
    return { pausas: pausas.length, correos_enviados: enviados };
  },

  // Cierre automatico de fin de dia: si la pausa de hoy quedo sin cerrar (la
  // coordinadora nunca la abrio, o la abrio pero olvido finalizarla), el
  // sistema la resuelve solo para que el cumplimiento no quede "colgado".
  //   - En_curso (se abrio pero nadie la finalizo) -> Realizada, con nota.
  //   - Programada / Recordatorio_enviado (nunca se abrio) -> No_realizada,
  //     con motivo de sistema.
  // Corre por trigger nocturno (23:00); tambien puede llamarse a mano. No
  // toca pausas Suspendida (esas las deja el ADM a proposito) ni las ya
  // terminales.
  cerrarPausasAbiertasDelDia: function () {
    var hoy = claveDia_(new Date(), 'America/Santiago');
    var pausas = leerProgramadasPausas_().filter(function (p) {
      return claveFechaPausa_(p.fecha) === hoy &&
        (p.estado === ESTADOS_PAUSA.EN_CURSO || p.estado === ESTADOS_PAUSA.PROGRAMADA ||
          p.estado === ESTADOS_PAUSA.RECORDATORIO_ENVIADO);
    });
    var sistema = { email: 'sistema' };
    var cerradas = 0;
    pausas.forEach(function (p) {
      if (p.estado === ESTADOS_PAUSA.EN_CURSO) {
        transicionarPausa_(p, ESTADOS_PAUSA.REALIZADA, sistema, {
          hora_fin: new Date().toISOString(),
          observaciones: (p.observaciones ? p.observaciones + ' — ' : '') +
            'Cerrada automáticamente al final del día (la coordinadora no la finalizó).'
        });
      } else {
        transicionarPausa_(p, ESTADOS_PAUSA.NO_REALIZADA, sistema, {
          observaciones: 'Cierre automático: la coordinadora no inició la pausa.'
        });
      }
      cerradas++;
    });
    return { cerradas: cerradas };
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
  var existe = leerProgramadasPausas_().some(function (p) {
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
  return leerProgramadasPausas_().filter(function (p) {
    return String(p.pausa_id) === String(pausaId);
  })[0] || null;
}

// --- registro del trabajador (Fase P2) -------------------------------------

// La pausa VIVA de hoy para una empresa (la que el trabajador puede registrar).
// "Viva" = no terminal (no Cancelada/No_realizada/Cerrada). Si hubiera varias
// el mismo dia (no deberia, la programacion es idempotente), toma la primera.
function pausaDeHoyEmpresa_(empresaId) {
  var hoy = claveDia_(new Date(), 'America/Santiago');
  return leerProgramadasPausas_().filter(function (p) {
    return String(p.empresa_id) === String(empresaId) &&
      claveFechaPausa_(p.fecha) === hoy &&
      ESTADOS_PAUSA_TERMINALES.indexOf(p.estado) === -1;
  })[0] || null;
}

function buscarRegistroAsistencia_(pausaId, email) {
  var correo = String(email || '').toLowerCase();
  return leerFilasSeguro_(SHEETS.PAUSAS_ASISTENCIA).filter(function (r) {
    return String(r.pausa_id) === String(pausaId) && String(r.email).toLowerCase() === correo;
  })[0] || null;
}

// Resuelve empresa/trabajador de un correo, en orden: (1) roster de pausas
// (PAUSAS_TRABAJADORES, la fuente propia del modulo, con area/cargo), (2)
// cuenta del portal (CUENTAS_PORTAL, cuyo `emails` puede traer varios), (3)
// USUARIOS (staff). Devuelve { empresa_id, trabajador_id, nombre }.
function resolverTrabajadorPausas_(email) {
  var correo = String(email || '').trim().toLowerCase();
  if (!correo) return { empresa_id: '', trabajador_id: '', nombre: '' };

  var enRoster = leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES).filter(function (t) {
    return esVerdaderoPausas_(t.activo) && String(t.email).toLowerCase() === correo;
  })[0];
  if (enRoster) {
    return { empresa_id: enRoster.empresa_id, trabajador_id: enRoster.trabajador_id, nombre: enRoster.nombre || '' };
  }

  var cuenta = leerFilasSeguro_(SHEETS.CUENTAS_PORTAL).filter(function (c) {
    var correos = parsearListaPortal_(c.emails).map(function (e) { return String(e).toLowerCase(); });
    return correos.indexOf(correo) !== -1;
  })[0];
  if (cuenta && cuenta.empresa_id) {
    return { empresa_id: cuenta.empresa_id, trabajador_id: '', nombre: cuenta.nombre || '' };
  }

  var usuario = leerFilasSeguro_(SHEETS.USUARIOS).filter(function (u) {
    return String(u.email).toLowerCase() === correo;
  })[0];
  if (usuario && usuario.empresa_id) {
    return { empresa_id: usuario.empresa_id, trabajador_id: '', nombre: usuario.nombre || '' };
  }

  return { empresa_id: '', trabajador_id: '', nombre: '' };
}

// --- coordinador (Fase P3) -------------------------------------------------

// Empresas que coordina quien hace la llamada: un ADM las coordina TODAS (ve y
// opera cualquiera); un coordinador, solo aquellas donde esta activo en
// PAUSAS_COORDINADORES (titular o reemplazo). Devuelve lista de empresa_id.
function empresasQueCoordina_(contexto) {
  if (contexto && contexto.rol === 'ADM') {
    return leerConfigPausas_().map(function (c) { return String(c.empresa_id); });
  }
  var correo = String((contexto && contexto.email) || '').toLowerCase();
  if (!correo) return [];
  var vistas = {};
  leerFilasSeguro_(SHEETS.PAUSAS_COORDINADORES).forEach(function (co) {
    if (esVerdaderoPausas_(co.activo) && String(co.email).toLowerCase() === correo) {
      vistas[String(co.empresa_id)] = true;
    }
  });
  return Object.keys(vistas);
}

// Guard de una operacion del coordinador sobre una pausa puntual: ADM siempre;
// si no, debe ser coordinador ACTIVO de la empresa de esa pausa. Devuelve
// _forbidden o null.
function guardaCoordinadorPausa_(contexto, pausa) {
  if (contexto && contexto.rol === 'ADM') return null;
  var empresas = empresasQueCoordina_(contexto);
  if (empresas.indexOf(String(pausa.empresa_id)) === -1) {
    return { _forbidden: true, message: 'No eres coordinador(a) de la empresa de esta pausa.' };
  }
  return null;
}

// Participacion "en vivo" de una pausa: quienes participaron, quienes
// justificaron (no pudieron) y quienes siguen pendientes (roster activo que
// aun no registra). Cuenta sobre el roster ACTIVO de la empresa.
function participacionDePausa_(pausaId, empresaId) {
  var roster = leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES).filter(function (t) {
    return esVerdaderoPausas_(t.activo) && String(t.empresa_id) === String(empresaId);
  });
  var registros = leerFilasSeguro_(SHEETS.PAUSAS_ASISTENCIA).filter(function (r) {
    return String(r.pausa_id) === String(pausaId);
  });
  var porCorreo = {};
  registros.forEach(function (r) { porCorreo[String(r.email).toLowerCase()] = r; });

  var participaron = [], justificaron = [], pendientes = [];
  roster.forEach(function (t) {
    var reg = porCorreo[String(t.email).toLowerCase()];
    // v7.2 (Bloque A, mejora A1 "pasar lista grupal"): trabajador_id viaja
    // en los 3 grupos -- lo necesita el coordinador para armar el envio a
    // registrarAsistenciaGrupal (marcar por trabajador_id, no por email).
    var item = { trabajador_id: t.trabajador_id, nombre: t.nombre || t.email, email: t.email, area: t.area || '' };
    if (reg && reg.estado === 'participo') { participaron.push(item); }
    else if (reg && reg.estado === 'no_participo') { justificaron.push(Object.assign({ motivo: reg.motivo || '' }, item)); }
    else { pendientes.push(item); }
  });
  // Registros de correos que NO estan en el roster (ej. cuenta de portal sin
  // fila de roster) igual cuentan como participacion/justificacion.
  var correosRoster = {};
  roster.forEach(function (t) { correosRoster[String(t.email).toLowerCase()] = true; });
  registros.forEach(function (r) {
    if (correosRoster[String(r.email).toLowerCase()]) return;
    var item = { nombre: r.email, email: r.email, area: '' };
    if (r.estado === 'participo') participaron.push(item);
    else if (r.estado === 'no_participo') justificaron.push(Object.assign({ motivo: r.motivo || '' }, item));
  });

  var totalRoster = roster.length;
  return {
    total_roster: totalRoster,
    participaron: participaron,
    justificaron: justificaron,
    pendientes: pendientes,
    n_participaron: participaron.length,
    n_justificaron: justificaron.length,
    n_pendientes: pendientes.length,
    pct_participacion: totalRoster === 0 ? null : Math.round((participaron.length / totalRoster) * 1000) / 10
  };
}

// Reporte de cumplimiento de un conjunto de empresas en un periodo. Reusable
// por el coordinador (P3) y luego por Gerencia (P5). desde/hasta son
// AAAA-MM-DD; por defecto, ultimos 30 dias.
function calcularReportePausas_(empresaIds, desde, hasta) {
  var setEmp = {};
  empresaIds.forEach(function (e) { setEmp[String(e)] = true; });
  var hoy = claveDia_(new Date(), 'America/Santiago');
  var hastaC = /^\d{4}-\d{2}-\d{2}$/.test(String(hasta || '')) ? hasta : hoy;
  var desdeC = /^\d{4}-\d{2}-\d{2}$/.test(String(desde || '')) ? desde
    : claveDia_(new Date(Date.now() - 30 * 24 * 3600 * 1000), 'America/Santiago');

  var pausas = leerProgramadasPausas_().filter(function (p) {
    var f = claveFechaPausa_(p.fecha);
    return setEmp[String(p.empresa_id)] && f >= desdeC && f <= hastaC;
  });
  var idsPausa = {};
  pausas.forEach(function (p) { idsPausa[p.pausa_id] = p; });

  var registros = leerFilasSeguro_(SHEETS.PAUSAS_ASISTENCIA).filter(function (r) {
    return idsPausa[r.pausa_id];
  });

  // Cancelada no cuenta en cumplimiento (anulada). El denominador son las
  // "resueltas" (realizadas + no realizadas).
  var realizadas = pausas.filter(function (p) { return p.estado === 'Realizada' || p.estado === 'Cerrada'; });
  var noRealizadas = pausas.filter(function (p) { return p.estado === 'No_realizada'; });
  var canceladas = pausas.filter(function (p) { return p.estado === 'Cancelada'; });
  var resueltas = realizadas.length + noRealizadas.length;

  var participaciones = registros.filter(function (r) { return r.estado === 'participo'; });
  var justificaciones = registros.filter(function (r) { return r.estado === 'no_participo'; });

  // v7.2 (Bloque A, mejora A6): bienestar -- SOLO promedio agregado, nunca
  // por persona (RN-708: nunca rankear individuos). null si nadie dejo animo.
  var animos = registros.map(function (r) { return Number(r.animo); }).filter(function (n) { return n >= 1 && n <= 5; });
  var animoPromedio = animos.length === 0 ? null
    : Math.round((animos.reduce(function (a, b) { return a + b; }, 0) / animos.length) * 10) / 10;
  // v-next ("reporte de las caras"): la DISTRIBUCION agregada (cuantas
  // respuestas cayeron en cada una de las 5 caras), no solo el promedio --
  // sigue siendo un agregado del periodo completo, jamas por persona
  // (RN-708, mismo criterio que animoPromedio arriba).
  var animoDistribucion = [1, 2, 3, 4, 5].map(function (valor) {
    var cantidad = animos.filter(function (a) { return a === valor; }).length;
    return { valor: valor, cantidad: cantidad, pct: animos.length === 0 ? 0 : Math.round((cantidad / animos.length) * 1000) / 10 };
  });

  // Motivos de inasistencia (top).
  var motivos = {};
  justificaciones.forEach(function (r) {
    var m = String(r.motivo || '(sin motivo)').trim() || '(sin motivo)';
    motivos[m] = (motivos[m] || 0) + 1;
  });
  var motivosLista = Object.keys(motivos).map(function (m) { return { motivo: m, cantidad: motivos[m] }; })
    .sort(function (a, b) { return b.cantidad - a.cantidad; });

  // Participacion por area (usa el area del roster; si el registro no matchea
  // el roster, cae en "(sin area)").
  var areaPorCorreo = {};
  leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES).forEach(function (t) {
    if (setEmp[String(t.empresa_id)]) areaPorCorreo[String(t.email).toLowerCase()] = t.area || '(sin área)';
  });
  var porArea = {};
  participaciones.forEach(function (r) {
    var area = areaPorCorreo[String(r.email).toLowerCase()] || '(sin área)';
    porArea[area] = (porArea[area] || 0) + 1;
  });
  var porAreaLista = Object.keys(porArea).map(function (a) { return { area: a, participaciones: porArea[a] }; })
    .sort(function (a, b) { return b.participaciones - a.participaciones; });

  return {
    periodo: { desde: desdeC, hasta: hastaC },
    kpis: {
      programadas: pausas.length,
      realizadas: realizadas.length,
      no_realizadas: noRealizadas.length,
      canceladas: canceladas.length,
      pct_cumplimiento: resueltas === 0 ? null : Math.round((realizadas.length / resueltas) * 1000) / 10,
      participaciones: participaciones.length,
      justificaciones: justificaciones.length,
      animo_promedio: animoPromedio
    },
    motivos: motivosLista,
    por_area: porAreaLista,
    // v7.2 (Bloque A, mejora A4): rachas de EQUIPO por area -- nunca por
    // persona (RN-708). "Racha" = pausas Realizadas consecutivas donde el
    // area alcanzo el umbral_verde configurado de participacion.
    rachas_area: calcularRachasPorArea_(empresaIds, desdeC, hastaC),
    // v6.0 (mejora #6): tendencia semanal, ventana FIJA (ultimas 8 semanas)
    // independiente del filtro desde/hasta -- mismo criterio que la tendencia
    // mensual de Gerencia (calcularTendenciaTemporal_ en Gerencia.gs).
    tendencia: calcularTendenciaPausas_(empresaIds),
    // "reporte de las caras": distribucion agregada de la micro-encuesta de
    // bienestar. `respuestas` es el total de registros con animo valido (el
    // denominador de los `pct` de arriba) -- se muestra para dejar claro que
    // es opcional y no todos responden.
    clima_emocional: { respuestas: animos.length, distribucion: animoDistribucion },
    pausas: pausas.map(function (p) {
      return {
        pausa_id: p.pausa_id, empresa_id: p.empresa_id, fecha: claveFechaPausa_(p.fecha),
        estado: p.estado, hora_programada: p.hora_programada || ''
      };
    }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; })
  };
}

// v7.2 (Bloque A, mejora A4 "rachas por area"): a proposito NO es una racha
// individual (RN-708: nunca rankear personas) -- es una racha de EQUIPO, que
// premia la cultura del area en vez de senalar a alguien. Por cada area
// (dentro de las empresas dadas), recorre las pausas Realizadas/No_realizada
// del periodo en orden cronologico y cuenta consecutivos donde la
// participacion del area alcanzo el umbral_verde configurado para esa
// empresa (80% si no hay config). No_realizada (la empresa no hizo la pausa)
// no corta la racha -- mismo criterio que getHistorialTrabajador.
function calcularRachasPorArea_(empresaIds, desde, hasta) {
  var umbralPorEmpresa = {};
  leerConfigPausas_().forEach(function (c) {
    var u = porcentajePausas_(c.umbral_verde);
    umbralPorEmpresa[String(c.empresa_id)] = u === null ? 80 : u;
  });

  var rosterPorAreaEmpresa = {}; // clave "empresa|area" -> [emails]
  leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES).forEach(function (t) {
    if (!esVerdaderoPausas_(t.activo) || empresaIds.indexOf(String(t.empresa_id)) === -1) return;
    var area = String(t.area || '').trim() || '(sin área)';
    var clave = t.empresa_id + '|' + area;
    (rosterPorAreaEmpresa[clave] = rosterPorAreaEmpresa[clave] || []).push(String(t.email).toLowerCase());
  });

  var pausas = leerProgramadasPausas_().filter(function (p) {
    var f = claveFechaPausa_(p.fecha);
    return empresaIds.indexOf(String(p.empresa_id)) !== -1 && f >= desde && f <= hasta &&
      (p.estado === ESTADOS_PAUSA.REALIZADA || p.estado === ESTADOS_PAUSA.CERRADA || p.estado === ESTADOS_PAUSA.NO_REALIZADA);
  }).sort(function (a, b) { return claveFechaPausa_(a.fecha) < claveFechaPausa_(b.fecha) ? -1 : 1; });

  var registrosPorPausa = {};
  leerFilasSeguro_(SHEETS.PAUSAS_ASISTENCIA).forEach(function (r) {
    (registrosPorPausa[String(r.pausa_id)] = registrosPorPausa[String(r.pausa_id)] || []).push(r);
  });

  var resultado = [];
  Object.keys(rosterPorAreaEmpresa).forEach(function (clave) {
    var partes = clave.split('|');
    var empresaId = partes[0], area = partes.slice(1).join('|');
    var emails = rosterPorAreaEmpresa[clave];
    if (!emails.length) return;
    var setEmails = {};
    emails.forEach(function (e) { setEmails[e] = true; });
    var umbral = umbralPorEmpresa[empresaId] === undefined ? 80 : umbralPorEmpresa[empresaId];

    var cumpleSerie = []; // true/false/null(no_aplica) por pausa de ESTA empresa
    pausas.filter(function (p) { return String(p.empresa_id) === empresaId; }).forEach(function (p) {
      if (p.estado === ESTADOS_PAUSA.NO_REALIZADA) { cumpleSerie.push(null); return; }
      var regs = registrosPorPausa[String(p.pausa_id)] || [];
      var participaronArea = regs.filter(function (r) {
        return setEmails[String(r.email).toLowerCase()] && r.estado === 'participo';
      }).length;
      var pct = Math.round((participaronArea / emails.length) * 1000) / 10;
      cumpleSerie.push(pct >= umbral);
    });

    var rachaActual = 0;
    for (var i = cumpleSerie.length - 1; i >= 0; i--) {
      if (cumpleSerie[i] === null) continue;
      if (cumpleSerie[i]) rachaActual++; else break;
    }
    var rachaMaxima = 0, corrida = 0;
    cumpleSerie.forEach(function (c) {
      if (c === null) return;
      corrida = c ? corrida + 1 : 0;
      if (corrida > rachaMaxima) rachaMaxima = corrida;
    });

    resultado.push({
      empresa_id: empresaId, area: area, roster: emails.length,
      racha_actual: rachaActual, racha_maxima: rachaMaxima, umbral_pct: umbral
    });
  });

  return resultado.sort(function (a, b) { return b.racha_actual - a.racha_actual; });
}

// v6.0 (mejora #6): cumplimiento por semana (ultimas 8 semanas ISO, lunes a
// domingo, America/Santiago) de las empresas dadas. Igual espiritu que
// calcularTendenciaTemporal_ (Gerencia.gs) pero semanal en vez de mensual --
// las pausas son diarias, un panorama mensual diluiria demasiado la senal.
function calcularTendenciaPausas_(empresaIds) {
  var SEMANAS_VENTANA = 8;
  var setEmp = {};
  empresaIds.forEach(function (e) { setEmp[String(e)] = true; });

  var hoy = new Date();
  var buckets = [];
  for (var i = SEMANAS_VENTANA - 1; i >= 0; i--) {
    var inicio = inicioSemanaIsoPausas_(new Date(hoy.getTime() - i * 7 * 24 * 3600 * 1000));
    var fin = new Date(inicio.getTime() + 6 * 24 * 3600 * 1000);
    buckets.push({
      desde: claveDia_(inicio, 'America/Santiago'), hasta: claveDia_(fin, 'America/Santiago'),
      etiqueta: 'sem. ' + claveDia_(inicio, 'America/Santiago').slice(5).replace('-', '/'),
      realizadas: 0, no_realizadas: 0, resueltas: 0
    });
  }

  var pausas = leerProgramadasPausas_().filter(function (p) { return setEmp[String(p.empresa_id)]; });
  pausas.forEach(function (p) {
    var f = claveFechaPausa_(p.fecha);
    var bucket = buckets.filter(function (b) { return f >= b.desde && f <= b.hasta; })[0];
    if (!bucket) return;
    if (p.estado === ESTADOS_PAUSA.REALIZADA || p.estado === ESTADOS_PAUSA.CERRADA) {
      bucket.realizadas++; bucket.resueltas++;
    } else if (p.estado === ESTADOS_PAUSA.NO_REALIZADA) {
      bucket.no_realizadas++; bucket.resueltas++;
    }
  });

  return buckets.map(function (b) {
    return {
      etiqueta: b.etiqueta, realizadas: b.realizadas, no_realizadas: b.no_realizadas,
      pct_cumplimiento: b.resueltas === 0 ? null : Math.round((b.realizadas / b.resueltas) * 1000) / 10
    };
  });
}

// Lunes (00:00) de la semana ISO de `fecha`, en America/Santiago.
function inicioSemanaIsoPausas_(fecha) {
  var dow = diaSemanaIsoPausas_(fecha, 'America/Santiago'); // 1=lunes..7=domingo
  return new Date(fecha.getTime() - (dow - 1) * 24 * 3600 * 1000);
}

// --- alertas (Fase P4) -----------------------------------------------------

// v6.0 (Pausas P4.1): enlace magico personal para el modulo de pausas. Busca
// la cuenta del portal por correo (buscarCuentaPortalPorEmail_, en
// CuentasPortal.gs) y, si existe y el sitio publico esta configurado
// (Script Properties, ver Config.gs), crea una sesion de enlace magico
// (crearTokenSesionPortal_) y arma la URL directo al modulo indicado. Si falta
// cualquiera de las dos cosas, devuelve '' -- el correo sigue saliendo sin el
// boton, nunca falla por esto.
function enlaceMagicoPausas_(email, modulo) {
  var sitio = getConfig_().sitioPublico;
  if (!sitio) return '';
  var cuenta = buscarCuentaPortalPorEmail_(email);
  if (!cuenta) return '';
  var token = crearTokenSesionPortal_(cuenta.cuenta_id);
  var separador = sitio.slice(-1) === '/' ? '' : '/';
  return sitio + separador + 'plataforma.html?token=' + token + '&modulo=' + (modulo || 'pausas');
}

// Boton de llamado a la accion para los correos de pausas -- mismo navy
// institucional que plantillaCorreoHtml_ (v7.6, corporativo sobrio), con
// estilos inline (los clientes de correo ignoran CSS externo).
function botonCorreoPausas_(url, texto) {
  return '<p style="margin:0;"><a href="' + escaparHtmlCorreo_(url) + '" ' +
    'style="display:inline-block;background:#14213D;color:#ffffff;text-decoration:none;' +
    'font-weight:bold;font-size:14px;padding:10px 18px;">' +
    escaparHtmlCorreo_(texto) + '</a></p>';
}

// Correos a avisar en el recordatorio de una empresa: roster ACTIVO + las
// coordinadoras ACTIVAS. Sin duplicados.
function destinatariosRecordatorio_(empresaId) {
  var set = {};
  leerFilasSeguro_(SHEETS.PAUSAS_TRABAJADORES).forEach(function (t) {
    if (esVerdaderoPausas_(t.activo) && String(t.empresa_id) === String(empresaId) && t.email) {
      set[String(t.email).toLowerCase()] = t.email;
    }
  });
  coordinadorasDeEmpresa_(empresaId).forEach(function (c) { set[c.toLowerCase()] = c; });
  return Object.keys(set).map(function (k) { return set[k]; });
}

// Correos del resumen de fin de dia: coordinadoras ACTIVAS + admins de la
// empresa (USUARIOS rol ADM). Sin duplicados.
function destinatariosResumenPausa_(empresaId) {
  var set = {};
  coordinadorasDeEmpresa_(empresaId).forEach(function (c) { set[c.toLowerCase()] = c; });
  try {
    obtenerEmailsPorRol_(empresaId, ['ADM']).forEach(function (e) { if (e) set[String(e).toLowerCase()] = e; });
  } catch (err) { /* USUARIOS puede no existir en algunas instalaciones */ }
  return Object.keys(set).map(function (k) { return set[k]; });
}

function coordinadorasDeEmpresa_(empresaId) {
  return leerFilasSeguro_(SHEETS.PAUSAS_COORDINADORES)
    .filter(function (c) { return esVerdaderoPausas_(c.activo) && String(c.empresa_id) === String(empresaId) && c.email; })
    .map(function (c) { return c.email; });
}

// Empresas que un GERENCIA/ADM puede ver en el reporte: todas las que tienen
// config de pausas. Otros roles: ninguna.
function empresasVisiblesGerencia_(contexto) {
  var rol = contexto && contexto.rol;
  if (rol !== 'GERENCIA' && rol !== 'ADM') return [];
  return leerConfigPausas_().map(function (c) { return String(c.empresa_id); });
}

// Envia el reporte periodico (semanal/mensual) por correo con el PDF adjunto.
// Destinatarios: Gerencia+Admin (USUARIOS) + TODAS las coordinadoras activas.
function enviarReportePeriodicoPausas_(periodo) {
  var dias = periodo === 'mensual' ? 30 : 7;
  var hoy = claveDia_(new Date(), 'America/Santiago');
  var desde = claveDia_(new Date(Date.now() - dias * 24 * 3600 * 1000), 'America/Santiago');
  var empresas = leerConfigPausas_().map(function (c) { return String(c.empresa_id); });
  if (empresas.length === 0) return { enviado: false, motivo: 'sin_config' };

  var reporte = calcularReportePausas_(empresas, desde, hoy);
  var etiqueta = periodo === 'mensual' ? 'mensual' : 'semanal';
  var titulo = 'Reporte ' + etiqueta + ' de pausas activas';
  var k = reporte.kpis;

  var cuerpoHtml = plantillaCorreoHtml_(titulo,
    '<p style="margin:0 0 12px;">Cumplimiento de pausas activas del periodo <strong>' +
    escaparHtmlCorreo_(reporte.periodo.desde) + '</strong> a <strong>' + escaparHtmlCorreo_(reporte.periodo.hasta) + '</strong>.</p>' +
    '<table cellpadding="0" cellspacing="0" style="font-size:14px;">' +
    filaDetalleCorreo_('Cumplimiento', (k.pct_cumplimiento == null ? '—' : k.pct_cumplimiento + '%')) +
    filaDetalleCorreo_('Programadas', String(k.programadas)) +
    filaDetalleCorreo_('Realizadas', String(k.realizadas)) +
    filaDetalleCorreo_('No realizadas', String(k.no_realizadas)) +
    filaDetalleCorreo_('Participaciones', String(k.participaciones)) +
    filaDetalleCorreo_('Justificaciones', String(k.justificaciones)) +
    '</table>',
    { pie: 'El detalle completo (motivos y participación por área) va en el PDF adjunto.' });
  var texto = titulo + ' (' + reporte.periodo.desde + ' a ' + reporte.periodo.hasta + '): cumplimiento ' +
    (k.pct_cumplimiento == null ? '—' : k.pct_cumplimiento + '%') + ', ' + k.realizadas + ' realizadas.';

  var opciones = { htmlBody: cuerpoHtml };
  var pdf = generarPdfReportePausas_(titulo, reporte);
  if (pdf) opciones.attachments = [pdf];

  var destinatarios = destinatariosReporteGerencia_();
  var enviados = 0;
  var claveDedup = 'PAUSAS_REPORTE_' + etiqueta.toUpperCase() + ':' + hoy;
  destinatarios.forEach(function (correo) {
    var r = enviarCorreo_(claveDedup, correo, 'PAUSA_REPORTE_' + etiqueta.toUpperCase(),
      'SIGSO — ' + titulo, texto, 60 * 24, opciones);
    if (r.enviado) enviados++;
  });
  return { periodo: etiqueta, correos_enviados: enviados, kpis: k };
}

// Gerencia+Admin (USUARIOS, de CUALQUIER empresa: el reporte es global) +
// todas las coordinadoras activas. Sin duplicados.
function destinatariosReporteGerencia_() {
  var set = {};
  leerFilasSeguro_(SHEETS.USUARIOS).forEach(function (u) {
    var activo = u.activo === true || u.activo === 'TRUE' || u.activo === 1;
    if (activo && (u.rol === 'GERENCIA' || u.rol === 'ADM') && u.email) {
      set[String(u.email).toLowerCase()] = u.email;
    }
  });
  leerFilasSeguro_(SHEETS.PAUSAS_COORDINADORES).forEach(function (c) {
    if (esVerdaderoPausas_(c.activo) && c.email) set[String(c.email).toLowerCase()] = c.email;
  });
  return Object.keys(set).map(function (k) { return set[k]; });
}

// PDF del reporte (mismo motor HTML->PDF que la OT). Tolerante: si falla, se
// envia el correo sin adjunto (el resumen igual va en el cuerpo).
function generarPdfReportePausas_(titulo, reporte) {
  try {
    var html = construirHtmlReportePausas_(titulo, reporte);
    return Utilities.newBlob(html, 'text/html', 'reporte-pausas.html').getAs('application/pdf')
      .setName('Reporte-pausas-' + reporte.periodo.hasta + '.pdf');
  } catch (err) {
    logError_(err, 'Pausas.generarPdfReportePausas');
    return null;
  }
}

// Empaqueta un reporte ya calculado (calcularReportePausas_) como la
// respuesta { pdf_base64, filename } que esperan los botones "Descargar PDF"
// del frontend (mismo contrato que OrdenTrabajo.descargar).
function armarDescargaReportePausas_(reporte) {
  var html = construirHtmlReportePausas_('Reporte de pausas activas', reporte);
  var pdf = Utilities.newBlob(html, 'text/html', 'reporte-pausas.html').getAs('application/pdf');
  pdf.setName('SIGSO-reporte-pausas-' + reporte.periodo.desde + '_a_' + reporte.periodo.hasta + '.pdf');
  return { pdf_base64: Utilities.base64Encode(pdf.getBytes()), filename: pdf.getName() };
}

// v-next (reporte "bastante profesional", a la altura de la Orden de
// Trabajo): antes era HTML plano (dos tablas sueltas). Ahora reusa el mismo
// chrome/ficha/hairlines que OrdenTrabajo.gs (DOC, docChromeOt_,
// docSeccionOt_, celdaLabelFicha_/celdaValorFicha_) -- "misma casa" de
// papeleria que la Orden de Trabajo que se descarga de una solicitud, mismo
// pedido explicito del usuario.
function construirHtmlReportePausas_(titulo, reporte) {
  var k = reporte.kpis;
  var empresasLabel = nombresEmpresasPausas_(reporte.pausas);
  var referencia = reporte.periodo.desde + ' a ' + reporte.periodo.hasta;

  var cuerpo =
    docSeccionOt_('Resumen del período') +
    fichaResumenPausas_(k, reporte.pausas.length, empresasLabel) +
    docSeccionOt_('Clima emocional (autorreportado, opcional)') +
    bloqueClimaEmocionalPausas_(reporte) +
    docSeccionOt_('Motivos de inasistencia') +
    tablaReportePausas_(reporte.motivos, 'motivo', 'cantidad', 'Motivo', 'Cantidad', 'Sin justificaciones registradas en el período.') +
    docSeccionOt_('Participación por área') +
    tablaReportePausas_(reporte.por_area, 'area', 'participaciones', 'Área', 'Participaciones', 'Sin participaciones registradas en el período.') +
    docSeccionOt_('Racha de equipo por área') +
    '<p style="margin:0 0 8px;color:' + DOC.MUTED + ';font-size:11px;">Pausas consecutivas donde el área alcanzó su umbral de participación configurado. Es una racha de EQUIPO: nunca identifica ni ordena personas.</p>' +
    tablaRachasPausas_(reporte.rachas_area);

  return docChromeOt_({ tipoDoc: titulo, referencia: referencia, etiquetaReferencia: 'Periodo: ' }, cuerpo);
}

// Ficha resumen del periodo -- mismo formato (4 columnas, label/valor) que
// fichaSolicitudOt_ usa para la Orden de Trabajo.
function fichaResumenPausas_(k, totalPausas, empresasLabel) {
  var filas = [
    ['Empresa(s)', escaparHtml_(empresasLabel || '—'), 'Pausas en el período', String(totalPausas)],
    ['Cumplimiento', (k.pct_cumplimiento == null ? '—' : k.pct_cumplimiento + '%'), 'Realizadas', String(k.realizadas)],
    ['No realizadas', String(k.no_realizadas), 'Canceladas', String(k.canceladas)],
    ['Participaciones', String(k.participaciones), 'Justificaciones', String(k.justificaciones)]
  ];
  var cuerpo = filas.map(function (f) {
    return '<tr>' +
      '<td style="' + celdaLabelFicha_() + '">' + f[0] + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + f[1] + '</td>' +
      '<td style="' + celdaLabelFicha_() + '">' + f[2] + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + f[3] + '</td>' +
      '</tr>';
  }).join('');
  return '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 18px;font-size:12px;">' + cuerpo + '</table>';
}

// "Reporte de las caras": distribucion agregada de la micro-encuesta de
// bienestar (1..5), con una barra por nivel. RN-708: SOLO agregado del
// periodo completo -- nunca una fila ni un dato que identifique a una
// persona. El emoji va acompañado de una etiqueta de texto porque el
// conversor HTML->PDF de Apps Script no garantiza fuentes de emoji a color.
var ANIMO_EMOJI_PAUSAS_ = ['😞', '🙁', '😐', '🙂', '😄']; // 😞 🙁 😐 🙂 😄
var ANIMO_ETIQUETA_PAUSAS_ = ['Muy mal', 'Mal', 'Regular', 'Bien', 'Muy bien'];
var BARRA_CLIMA_PAUSAS_PX = 220;
function bloqueClimaEmocionalPausas_(reporte) {
  var clima = reporte.clima_emocional || { respuestas: 0, distribucion: [] };
  if (!clima.respuestas) {
    return '<p style="margin:0 0 18px;color:' + DOC.MUTED + ';">Nadie dejó esta respuesta opcional en el período.</p>';
  }
  var filas = clima.distribucion.map(function (d, i) {
    var anchoPx = d.pct <= 0 ? 0 : Math.max(4, Math.round(BARRA_CLIMA_PAUSAS_PX * d.pct / 100));
    return '<tr>' +
      '<td style="padding:4px 10px 4px 0;white-space:nowrap;font-size:13px;vertical-align:middle;">' +
      ANIMO_EMOJI_PAUSAS_[i] + ' ' + ANIMO_ETIQUETA_PAUSAS_[i] + '</td>' +
      '<td style="padding:4px 0;vertical-align:middle;">' +
      '<div style="background:' + DOC.PANEL + ';border:1px solid ' + DOC.HAIRLINE + ';border-radius:3px;width:' + BARRA_CLIMA_PAUSAS_PX + 'px;">' +
      '<div style="background:' + DOC.NAVY + ';height:11px;border-radius:3px;width:' + anchoPx + 'px;"></div>' +
      '</div></td>' +
      '<td style="padding:4px 0 4px 12px;text-align:right;white-space:nowrap;font-size:12px;color:' + DOC.INK_SOFT + ';vertical-align:middle;">' +
      d.cantidad + ' · ' + d.pct + '%</td>' +
      '</tr>';
  }).join('');
  return '<table style="border-collapse:collapse;margin:0 0 6px;">' + filas + '</table>' +
    '<p style="margin:0 0 18px;font-size:11px;color:' + DOC.FAINT + ';">Autorreportado y opcional — ' + clima.respuestas +
    (clima.respuestas === 1 ? ' participación incluyó' : ' participaciones incluyeron') + ' esta respuesta' +
    (reporte.kpis.animo_promedio == null ? '' : ' · promedio ' + reporte.kpis.animo_promedio + '/5') +
    '. Nunca se muestra por persona.</p>';
}

// Tabla generica de 2 columnas con encabezado (motivos, participacion por
// area) -- mismo lenguaje visual (hairlines, versalitas grises) que el resto
// del documento.
function tablaReportePausas_(filas, campoA, campoB, encA, encB, vacio) {
  if (!filas || filas.length === 0) {
    return '<p style="margin:0 0 18px;color:' + DOC.MUTED + ';">' + escaparHtml_(vacio) + '</p>';
  }
  var cuerpo = filas.map(function (f) {
    return '<tr>' +
      '<td style="padding:6px 10px;border-bottom:1px solid ' + DOC.HAIRLINE + ';color:' + DOC.INK + ';">' + escaparHtml_(String(f[campoA])) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid ' + DOC.HAIRLINE + ';color:' + DOC.INK + ';text-align:right;">' + escaparHtml_(String(f[campoB])) + '</td>' +
      '</tr>';
  }).join('');
  return '<table width="100%" style="border-collapse:collapse;font-size:12px;margin:0 0 18px;">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:0 10px 6px;font-size:10px;letter-spacing:0.5px;text-transform:uppercase;color:' + DOC.MUTED + ';border-bottom:2px solid ' + DOC.NAVY + ';">' + escaparHtml_(encA) + '</th>' +
    '<th style="text-align:right;padding:0 10px 6px;font-size:10px;letter-spacing:0.5px;text-transform:uppercase;color:' + DOC.MUTED + ';border-bottom:2px solid ' + DOC.NAVY + ';">' + escaparHtml_(encB) + '</th>' +
    '</tr></thead><tbody>' + cuerpo + '</tbody></table>';
}

// Tabla de rachas de EQUIPO por area (nunca de personas, RN-708).
function tablaRachasPausas_(rachas) {
  if (!rachas || rachas.length === 0) {
    return '<p style="margin:0 0 18px;color:' + DOC.MUTED + ';">Sin datos suficientes en el período.</p>';
  }
  var encabezados = ['Área', 'Personas', 'Racha actual', 'Racha máxima', 'Umbral'];
  var filas = rachas.map(function (r) {
    return '<tr>' +
      '<td style="padding:6px 10px;border-bottom:1px solid ' + DOC.HAIRLINE + ';color:' + DOC.INK + ';">' + escaparHtml_(r.area) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid ' + DOC.HAIRLINE + ';text-align:right;">' + r.roster + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid ' + DOC.HAIRLINE + ';text-align:right;">' + r.racha_actual + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid ' + DOC.HAIRLINE + ';text-align:right;">' + r.racha_maxima + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid ' + DOC.HAIRLINE + ';text-align:right;">≥' + r.umbral_pct + '%</td>' +
      '</tr>';
  }).join('');
  return '<table width="100%" style="border-collapse:collapse;font-size:12px;margin:0 0 18px;"><thead><tr>' +
    encabezados.map(function (e, i) {
      return '<th style="text-align:' + (i === 0 ? 'left' : 'right') + ';padding:0 10px 6px;font-size:10px;letter-spacing:0.5px;text-transform:uppercase;color:' + DOC.MUTED + ';border-bottom:2px solid ' + DOC.NAVY + ';">' + e + '</th>';
    }).join('') +
    '</tr></thead><tbody>' + filas + '</tbody></table>';
}

// Nombre(s) de la(s) empresa(s) cubiertas por el reporte, para la ficha
// resumen -- a partir de los empresa_id que de verdad aparecen en
// reporte.pausas (no de la lista de empresas visibles, que puede incluir
// alguna sin pausas en el periodo elegido).
function nombresEmpresasPausas_(pausas) {
  var ids = {};
  (pausas || []).forEach(function (p) { ids[String(p.empresa_id)] = true; });
  var lista = Object.keys(ids);
  if (lista.length === 0) return '';
  var mapa = {};
  leerFilasSeguro_(SHEETS.CAT_EMPRESAS).forEach(function (e) { mapa[String(e.empresa_id)] = e.nombre || e.empresa_id; });
  return lista.map(function (id) { return mapa[id] || id; }).join(', ');
}

// v6.0 (mejora #4): evidencia de la charla -- una foto opcional que la
// coordinadora adjunta al finalizar. Solo imagenes (JPEG/PNG/GIF), 5 MB,
// detectadas por firma de bytes (mismo criterio que Drive.subirArchivo del
// Intake, pero simplificado: aqui solo hace falta la categoria "imagen").
// Sube a Drive bajo SIGSO_Pausas/{empresa}/{fecha} y devuelve {url}, o un
// error de validacion si el archivo no es una imagen valida.
var FIRMAS_IMAGEN_PAUSAS = [
  { mime: 'image/jpeg', firma: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', firma: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'image/gif', firma: [0x47, 0x49, 0x46, 0x38] }
];
var LIMITE_EVIDENCIA_PAUSA_BYTES = 5 * 1024 * 1024;

function subirEvidenciaPausa_(pausa, nombreArchivo, base64) {
  var bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (err) {
    return errorValidacion_('evidencia_base64', 'El contenido de la evidencia no es base64 valido.');
  }
  if (bytes.length > LIMITE_EVIDENCIA_PAUSA_BYTES) {
    return errorValidacion_('evidencia_base64', 'La evidencia supera el tamaño máximo permitido (5 MB).');
  }
  var mime = FIRMAS_IMAGEN_PAUSAS.filter(function (f) {
    return f.firma.every(function (byte, idx) { return (bytes[idx] & 0xFF) === byte; });
  })[0];
  if (!mime) {
    return errorValidacion_('evidencia_base64', 'La evidencia debe ser una imagen (JPG, PNG o GIF).');
  }
  try {
    var raiz = obtenerCarpetaRaiz_();
    var carpetaPausas = obtenerOCrearSubcarpeta_(raiz, 'SIGSO_Pausas');
    var carpetaEmpresa = obtenerOCrearSubcarpeta_(carpetaPausas, pausa.empresa_id);
    var carpetaFecha = obtenerOCrearSubcarpeta_(carpetaEmpresa, claveFechaPausa_(pausa.fecha));
    var blob = Utilities.newBlob(bytes, mime.mime, nombreArchivo);
    var archivo = carpetaFecha.createFile(blob);
    return { url: archivo.getUrl() };
  } catch (err) {
    logError_(err, 'Pausas.subirEvidenciaPausa');
    return null; // no bloquea el finalizar: la pausa se cierra igual, sin evidencia.
  }
}

// 'HH:mm' -> minutos del dia (0..1439), o null si no es valida.
function horaAMinutosPausas_(hhmm) {
  var m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// Minutos del dia actuales en la zona del proyecto (America/Santiago).
function minutosDelDiaSantiago_() {
  var hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date());
  var min = horaAMinutosPausas_(hhmm);
  return min === null ? 0 : min;
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

// Google Sheets a veces interpreta "09:30" como una celda de HORA; al leerla
// con getValues() devuelve un Date (epoca 1899-12-30) que, al serializarse a
// JSON, sale como "1899-12-30T..Z" (en UTC). Este helper recupera el HH:mm
// real: de un Date usa la hora LOCAL del script (zona del proyecto), no UTC;
// de un string HH:mm (o un ISO con hora) toma la parte de la hora. Asi la hora
// llega bien al front aunque la celda se haya guardado como hora.
function horaCelda_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    if (isNaN(valor.getTime())) return '';
    var hh = valor.getHours(), mm = valor.getMinutes();
    return (hh < 10 ? '0' + hh : '' + hh) + ':' + (mm < 10 ? '0' + mm : '' + mm);
  }
  var s = String(valor).trim();
  // "09:30" o "9:30" al inicio -> normalizado.
  var directo = s.match(/^(\d{1,2}):(\d{2})/);
  if (directo) return normalizarHoraPausas_(directo[1] + ':' + directo[2]) || (directo[1] + ':' + directo[2]);
  // "AAAA-MM-DDTHH:MM.." -> toma la hora (fallback; no deberia llegar aca en
  // produccion, donde getValues devuelve un Date, ver arriba).
  var iso = s.match(/T(\d{2}):(\d{2})/);
  if (iso) return iso[1] + ':' + iso[2];
  return '';
}

// Lecturas que normalizan la hora "de celda" a HH:mm en un solo punto, para
// que ninguna vista tenga que preocuparse del formato con que Sheets guardo la
// hora. Solo tocan hora_habitual / hora_programada (hora_inicio_real y hora_fin
// son timestamps ISO completos, no celdas de hora).
function leerConfigPausas_() {
  return leerFilasSeguro_(SHEETS.PAUSAS_CONFIG).map(function (c) {
    c.hora_habitual = horaCelda_(c.hora_habitual);
    return c;
  });
}

function leerProgramadasPausas_() {
  return leerFilasSeguro_(SHEETS.PAUSAS_PROGRAMADAS).map(function (p) {
    p.hora_programada = horaCelda_(p.hora_programada);
    return p;
  });
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
