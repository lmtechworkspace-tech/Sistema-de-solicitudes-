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

    var fila = {
      pausa_id: pausa.pausa_id,
      trabajador_id: trab.trabajador_id || '',
      email: email,
      fecha_hora_registro: new Date().toISOString(),
      estado: estado,
      motivo: estado === 'no_participo' ? motivo : '',
      comentario: String(data.comentario || '').trim(),
      confirmacion: estado === 'participo',
      origen: 'autoservicio'
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
    var todas = leerFilasSeguro_(SHEETS.PAUSAS_PROGRAMADAS);
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
        return transicionarPausa_(pausa, ESTADOS_PAUSA.REALIZADA, contexto, {
          hora_fin: new Date().toISOString(),
          coordinador_email: pausa.coordinador_email || contexto.email,
          observaciones: data.observaciones ? String(data.observaciones).trim() : pausa.observaciones
        });
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
    var configs = leerFilasSeguro_(SHEETS.PAUSAS_CONFIG).filter(function (c) { return esVerdaderoPausas_(c.activo); });
    var pausas = leerFilasSeguro_(SHEETS.PAUSAS_PROGRAMADAS);
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
      var cuerpoHtml = plantillaCorreoHtml_('Pausa activa de hoy',
        '<p style="margin:0 0 10px;">Hoy tienes tu <strong>pausa activa</strong> a las ' +
        escaparHtmlCorreo_(pausa.hora_programada || '') + ' (' + escaparHtmlCorreo_(String(pausa.duracion_min || '')) + ' min).</p>' +
        '<p style="margin:0;">Al terminar, entra a la plataforma y registra tu participación en el módulo <strong>Pausas activas</strong>.</p>',
        { pie: 'Participar toma unos segundos: ✅ Participé o ✋ No pude participar.' });
      var texto = 'Hoy tienes tu pausa activa a las ' + (pausa.hora_programada || '') + '. Registra tu participación en la plataforma (módulo Pausas activas).';
      destinatarios.forEach(function (correo) {
        var r = enviarCorreo_(pausa.pausa_id, correo, 'PAUSA_RECORDATORIO', asunto, texto, 720, { htmlBody: cuerpoHtml });
        if (r.enviado) enviados++;
      });
      // Marca la pausa como recordada -> no se reenvia (y sigue registrable).
      transicionarPausa_(pausa, ESTADOS_PAUSA.RECORDATORIO_ENVIADO, { email: 'sistema' }, {});
      avisadas++;
    });
    return { pausas_avisadas: avisadas, correos_enviados: enviados };
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

  // Reporte periodico por correo (a Gerencia + prevencionistas) con el PDF
  // adjunto. `periodo` = 'semanal' | 'mensual'.
  enviarReporteSemanalPausas: function () { return enviarReportePeriodicoPausas_('semanal'); },
  enviarReporteMensualPausas: function () { return enviarReportePeriodicoPausas_('mensual'); },

  // Resumen de fin de dia (a coordinadoras + admin): que paso con la pausa de
  // hoy (estado + participacion + justificaciones). Se deduplica por pausa.
  enviarResumenDiarioPausas: function () {
    var hoy = claveDia_(new Date(), 'America/Santiago');
    var pausas = leerFilasSeguro_(SHEETS.PAUSAS_PROGRAMADAS).filter(function (p) {
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

// --- registro del trabajador (Fase P2) -------------------------------------

// La pausa VIVA de hoy para una empresa (la que el trabajador puede registrar).
// "Viva" = no terminal (no Cancelada/No_realizada/Cerrada). Si hubiera varias
// el mismo dia (no deberia, la programacion es idempotente), toma la primera.
function pausaDeHoyEmpresa_(empresaId) {
  var hoy = claveDia_(new Date(), 'America/Santiago');
  return leerFilasSeguro_(SHEETS.PAUSAS_PROGRAMADAS).filter(function (p) {
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
    return leerFilasSeguro_(SHEETS.PAUSAS_CONFIG).map(function (c) { return String(c.empresa_id); });
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
    var item = { nombre: t.nombre || t.email, email: t.email, area: t.area || '' };
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

  var pausas = leerFilasSeguro_(SHEETS.PAUSAS_PROGRAMADAS).filter(function (p) {
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
      justificaciones: justificaciones.length
    },
    motivos: motivosLista,
    por_area: porAreaLista,
    pausas: pausas.map(function (p) {
      return {
        pausa_id: p.pausa_id, empresa_id: p.empresa_id, fecha: claveFechaPausa_(p.fecha),
        estado: p.estado, hora_programada: p.hora_programada || ''
      };
    }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; })
  };
}

// --- alertas (Fase P4) -----------------------------------------------------

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
  return leerFilasSeguro_(SHEETS.PAUSAS_CONFIG).map(function (c) { return String(c.empresa_id); });
}

// Envia el reporte periodico (semanal/mensual) por correo con el PDF adjunto.
// Destinatarios: Gerencia+Admin (USUARIOS) + TODAS las coordinadoras activas.
function enviarReportePeriodicoPausas_(periodo) {
  var dias = periodo === 'mensual' ? 30 : 7;
  var hoy = claveDia_(new Date(), 'America/Santiago');
  var desde = claveDia_(new Date(Date.now() - dias * 24 * 3600 * 1000), 'America/Santiago');
  var empresas = leerFilasSeguro_(SHEETS.PAUSAS_CONFIG).map(function (c) { return String(c.empresa_id); });
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

function construirHtmlReportePausas_(titulo, reporte) {
  var k = reporte.kpis;
  function tabla_(filas, campoA, campoB, encA, encB) {
    if (!filas || filas.length === 0) return '<p style="color:#8A93A5;">— sin datos —</p>';
    var cuerpo = filas.map(function (f) {
      return '<tr><td style="padding:4px 12px 4px 0;border-bottom:1px solid #eee;">' + escaparHtmlCorreo_(String(f[campoA])) +
        '</td><td style="padding:4px 0;border-bottom:1px solid #eee;text-align:right;">' + escaparHtmlCorreo_(String(f[campoB])) + '</td></tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr>' +
      '<th style="text-align:left;color:#8A93A5;border-bottom:2px solid #ddd;padding:4px 0;">' + encA + '</th>' +
      '<th style="text-align:right;color:#8A93A5;border-bottom:2px solid #ddd;padding:4px 0;">' + encB + '</th></tr></thead><tbody>' + cuerpo + '</tbody></table>';
  }
  return '<html><body style="font-family:Arial,Helvetica,sans-serif;color:#0F172A;padding:24px;">' +
    '<div style="background:#6D5DF6;color:#fff;padding:14px 18px;border-radius:8px;margin-bottom:18px;">' +
    '<span style="font-size:20px;font-weight:bold;">SIGSO</span> · ' + escaparHtmlCorreo_(titulo) + '</div>' +
    '<p>Periodo: <strong>' + escaparHtmlCorreo_(reporte.periodo.desde) + '</strong> a <strong>' + escaparHtmlCorreo_(reporte.periodo.hasta) + '</strong></p>' +
    '<table style="width:100%;border-collapse:collapse;margin:12px 0 20px;font-size:14px;"><tbody>' +
    '<tr><td style="padding:6px 0;">Cumplimiento</td><td style="text-align:right;font-weight:bold;">' + (k.pct_cumplimiento == null ? '—' : k.pct_cumplimiento + '%') + '</td></tr>' +
    '<tr><td style="padding:6px 0;">Programadas</td><td style="text-align:right;">' + k.programadas + '</td></tr>' +
    '<tr><td style="padding:6px 0;">Realizadas</td><td style="text-align:right;">' + k.realizadas + '</td></tr>' +
    '<tr><td style="padding:6px 0;">No realizadas</td><td style="text-align:right;">' + k.no_realizadas + '</td></tr>' +
    '<tr><td style="padding:6px 0;">Participaciones</td><td style="text-align:right;">' + k.participaciones + '</td></tr>' +
    '<tr><td style="padding:6px 0;">Justificaciones</td><td style="text-align:right;">' + k.justificaciones + '</td></tr>' +
    '</tbody></table>' +
    '<h3 style="margin:16px 0 6px;">Motivos de inasistencia</h3>' + tabla_(reporte.motivos, 'motivo', 'cantidad', 'Motivo', 'Cantidad') +
    '<h3 style="margin:20px 0 6px;">Participación por área</h3>' + tabla_(reporte.por_area, 'area', 'participaciones', 'Área', 'Participaciones') +
    '</body></html>';
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
