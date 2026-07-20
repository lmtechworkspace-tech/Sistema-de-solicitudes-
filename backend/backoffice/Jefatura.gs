/**
 * Jefatura.gs — v4.2 (documentacion/SIGSO-v4.2-propuestas-modulo-jefatura.md).
 * Rol JEFATURA: un "Gerencia acotado" -- misma clase de informacion que el
 * Panel de Gerencia, pero recortada SIEMPRE a las personas a cargo (nunca al
 * sistema completo), en solo lectura. Lisseth ve lo de Vanessa, Hernan lo de
 * Juan, nunca lo de equipos ajenos.
 *
 * La relacion jefe -> persona a cargo vive en la hoja JEFATURAS (§1), por
 * correo (no por cuenta): funciona aunque el subordinado nunca haya entrado
 * a la plataforma, solo mandado solicitudes por el formulario publico.
 *
 * §0 (alcance, aprobado): una persona a cargo puede aparecer en SIGSO como
 * SOLICITANTE (reporta) o como RESOLUTOR (tiene trabajo asignado, si es
 * DEV/ANA) -- se disena para ambas. Un item entra al panel del jefe si el
 * SOLICITANTE o el RESOLUTOR (a nivel solicitud o subsolicitud) esta en su
 * equipo.
 *
 * El aislamiento se impone SIEMPRE en el servidor (nunca confia en filtros
 * de UI): getPanel usa el correo del CONTEXTO autenticado, no uno que venga
 * en los filtros. getDetalle (Solicitudes.gs) reusa esDelEquipoJefatura_
 * para rechazar el detalle de una solicitud fuera del equipo del jefe.
 */

var Jefatura = {
  // --- administracion de la relacion jefe->subordinado (solo ADM) --------
  listar: function (data, contexto) {
    if (contexto.rol !== 'ADM') {
      return { _forbidden: true, message: 'Solo un Administrador puede ver las jefaturas.' };
    }
    return leerFilasSeguro_(SHEETS.JEFATURAS);
  },

  gestionar: function (data, contexto) {
    if (contexto.rol !== 'ADM') {
      return { _forbidden: true, message: 'Solo un Administrador puede gestionar jefaturas.' };
    }
    switch (data.operacion) {
      case 'crear': return crearJefatura_(data);
      case 'activar': return activarJefatura_(data);
      case 'eliminar': return eliminarJefatura_(data);
      default:
        return errorValidacion_('operacion', 'Operacion invalida: ' + data.operacion);
    }
  },

  // --- el panel del jefe: "Mi departamento" -------------------------------
  getPanel: function (filtros, contexto) {
    var jefeEmail = contexto && contexto.email;
    var equipo = obtenerEquipoJefe_(jefeEmail);
    var equipoSet = {};
    equipo.forEach(function (email) { equipoSet[email] = true; });

    if (equipo.length === 0) {
      return {
        equipo: [],
        items: [],
        kpis: calcularKpisJefatura_([]),
        hoy: calcularHoyJefatura_([], [], equipoSet),
        por_persona: [],
        carga: { por_modulo: [], por_tipo: [] },
        tendencia: calcularTendenciaJefatura_([])
      };
    }

    var nombrePorEmail = mapaNombresUsuarios_();
    var historialEstados = leerFilasSeguro_(SHEETS.HISTORIAL_ESTADOS);

    var solicitudes = leerFilas_(SHEETS.SOLICITUDES).filter(function (s) {
      return !esAtencionDirecta_(s);
    });
    var solicitudPorId = {};
    solicitudes.forEach(function (s) { solicitudPorId[s.solicitud_id] = s; });

    var todasSubsolicitudes = leerFilas_(SHEETS.SUBSOLICITUDES);
    var ahora = new Date();

    var items = todasSubsolicitudes
      .filter(function (sub) {
        var solicitud = solicitudPorId[sub.solicitud_id];
        return solicitud && esDelEquipoJefatura_(solicitud, sub, equipoSet);
      })
      .map(function (sub) {
        var solicitud = solicitudPorId[sub.solicitud_id];
        var cumplimiento = Cumplimiento.clasificar(sub, ahora);
        var personaSolicitante = equipoSet[solicitud.solicitante_email] ? solicitud.solicitante_email : '';
        var responsable = sub.desarrollador_asignado || solicitud.desarrollador_asignado || '';
        var personaResolutor = equipoSet[responsable] ? responsable : '';
        return {
          subsolicitud_id: sub.subsolicitud_id,
          solicitud_id: sub.solicitud_id,
          numero_item: sub.numero_item,
          titulo: sub.titulo,
          descripcion: sub.descripcion || '',
          resultado_esperado: sub.resultado_esperado || '',
          tipo_nombre: sub.tipo_nombre || sub.tipo || '',
          modulo_nombre: sub.modulo_nombre || sub.modulo || '',
          empresa_id: solicitud.empresa_id,
          plataforma_nombre: solicitud.plataforma_nombre || solicitud.plataforma || '',
          estado: sub.estado,
          prioridad: sub.prioridad,
          solicitante_nombre: solicitud.solicitante_nombre,
          solicitante_email: solicitud.solicitante_email,
          desarrollador_asignado: responsable,
          desarrollador_nombre: nombrePorEmail[responsable] || '',
          // v4.2 (§0): de que lado de mi equipo aparece este item -- puede
          // ser de ambos si un subordinado reporto y otro lo resuelve.
          persona_solicitante: personaSolicitante,
          persona_resolutor: personaResolutor,
          fecha_creacion: sub.fecha_creacion,
          fecha_comprometida: sub.fecha_comprometida || '',
          fecha_terminada: sub.fecha_terminada || '',
          cumplimiento: cumplimiento,
          dias_abierta: diasHabilesRedondeado_(
            sub.fecha_creacion,
            ESTADOS_CERRADOS.indexOf(sub.estado) !== -1 ? (sub.fecha_terminada || sub.fecha_creacion) : ahora
          )
        };
      });

    var kpis = calcularKpisJefatura_(items);

    return {
      equipo: equipo,
      items: items,
      kpis: kpis,
      // v4.2 (§4): "al finalizar el dia, poder ver que ocurrio en su
      // departamento" -- lo que mas se pidio explicitamente.
      hoy: calcularHoyJefatura_(items, historialEstados, equipoSet),
      // v4.2 (§5): desglose por persona -- Lisseth ve a Vanessa individual.
      por_persona: calcularPorPersonaJefatura_(items, equipo, nombrePorEmail),
      // v4.2 (§6): que se repite en mi equipo.
      carga: calcularCargaJefatura_(items),
      // v4.2 (§7): tendencia de 6 meses del equipo.
      tendencia: calcularTendenciaJefatura_(items)
    };
  }
};

// v4.2 (§1): equipo ACTIVO de un jefe -- lista de correos (sin el propio).
// Devuelve [] si el jefe no tiene a nadie a cargo (hoja vacia o sin filas
// para el, tolerante a instalaciones sin la hoja todavia).
function obtenerEquipoJefe_(jefeEmail) {
  if (!jefeEmail) return [];
  return leerFilasSeguro_(SHEETS.JEFATURAS)
    .filter(function (j) {
      var activo = j.activo === true || j.activo === 'TRUE' || j.activo === 1;
      return activo && j.jefe_email === jefeEmail;
    })
    .map(function (j) { return j.subordinado_email; })
    .filter(function (email, i, todos) { return email && todos.indexOf(email) === i; });
}

// v4.2 (§0): una solicitud/subsolicitud es "de mi equipo" si el SOLICITANTE
// o el RESOLUTOR (a nivel solicitud o del item puntual) esta en el equipo.
// Reusada por Jefatura.getPanel Y por Solicitudes.getDetalle (el guardia de
// acceso al detalle individual) para que el criterio de "es de mi equipo"
// sea uno solo, nunca dos implementaciones que puedan divergir.
function esDelEquipoJefatura_(solicitud, subsolicitud, equipoSet) {
  if (equipoSet[solicitud.solicitante_email]) return true;
  if (equipoSet[solicitud.desarrollador_asignado]) return true;
  if (subsolicitud && equipoSet[subsolicitud.desarrollador_asignado]) return true;
  return false;
}

// Igual que esDelEquipoJefatura_ pero evaluando TODAS las subsolicitudes de
// la solicitud (para el guardia de getDetalle, que no recibe una
// subsolicitud puntual sino el id de la solicitud completa).
function esDelEquipoJefaturaSolicitud_(solicitud, subsolicitudes, equipoSet) {
  if (esDelEquipoJefatura_(solicitud, null, equipoSet)) return true;
  return (subsolicitudes || []).some(function (sub) {
    return equipoSet[sub.desarrollador_asignado];
  });
}

// §2: banda de KPIs del equipo -- mismo espiritu que Gerencia.calcularKpisGerencia_
// pero sin el comparativo de periodo (no forma parte de lo aprobado para
// Jefatura, que prioriza "hoy" sobre "tendencia de 30 dias").
function calcularKpisJefatura_(items) {
  var abiertas = items.filter(function (i) { return ESTADOS_CERRADOS.indexOf(i.estado) === -1; });
  var enRiesgoOAtrasadas = items.filter(function (i) {
    return i.cumplimiento.codigo === 'EN_RIESGO' || i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR';
  });
  var esperandoValidacion = items.filter(function (i) { return i.cumplimiento.codigo === 'ESPERANDO_VALIDACION'; });
  var entregados = items.filter(function (i) { return !!i.fecha_terminada && !!i.fecha_comprometida; });
  var entregadosATiempo = entregados.filter(function (i) {
    return new Date(i.fecha_terminada) <= new Date(i.fecha_comprometida);
  });
  var diasResolucion = items
    .filter(function (i) { return ESTADOS_CERRADOS.indexOf(i.estado) !== -1 && i.fecha_terminada; })
    .map(function (i) { return i.dias_abierta; });

  return {
    total_equipo: items.length,
    abiertas: abiertas.length,
    en_riesgo_o_atrasadas: enRiesgoOAtrasadas.length,
    esperando_validacion: esperandoValidacion.length,
    pct_cumplimiento: entregados.length === 0 ? null : Math.round((entregadosATiempo.length / entregados.length) * 1000) / 10,
    dias_promedio_resolucion: promedio_(diasResolucion)
  };
}

// v4.2 (§4): "hoy en mi departamento" -- el cierre del dia que la jefatura
// pidio explicitamente. "Hoy" se calcula en la zona horaria del proyecto
// (America/Santiago, Config.gs) via claveDia_ (ya usada por
// Triggers.detectarPatrones para el mismo tipo de corte diario).
function calcularHoyJefatura_(items, historialEstados, equipoSet) {
  var hoy = claveDia_(new Date(), 'America/Santiago');
  var idsEquipo = {};
  items.forEach(function (i) { idsEquipo[i.subsolicitud_id] = true; });

  var nuevas = items.filter(function (i) { return claveDia_(new Date(i.fecha_creacion), 'America/Santiago') === hoy; });

  var transicionesHoy = historialEstados.filter(function (h) {
    return idsEquipo[h.subsolicitud_id] && h.estado_nuevo !== ESTADOS.S01 &&
      claveDia_(new Date(h.timestamp), 'America/Santiago') === hoy;
  });
  // Un item puede tener varias transiciones el mismo dia -- se cuenta UNA
  // vez como "avanzo", no una por transicion.
  var avanzaronIds = {};
  transicionesHoy.forEach(function (h) { avanzaronIds[h.subsolicitud_id] = true; });
  var cerradasHoy = transicionesHoy.filter(function (h) { return ESTADOS_CERRADOS.indexOf(h.estado_nuevo) !== -1; });
  var cerradasIds = {};
  cerradasHoy.forEach(function (h) { cerradasIds[h.subsolicitud_id] = true; });

  var enRiesgoOVencidas = items.filter(function (i) {
    return i.cumplimiento.codigo === 'EN_RIESGO' || i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR';
  });
  // "Requieren accion de mi gente": alguien de mi equipo (como solicitante)
  // tiene algo entregado esperando que lo valide.
  var requierenAccion = items.filter(function (i) {
    return i.cumplimiento.codigo === 'ESPERANDO_VALIDACION' && i.persona_solicitante;
  });

  return {
    nuevas: nuevas.map(resumirItem_),
    avanzaron: items.filter(function (i) { return avanzaronIds[i.subsolicitud_id]; }).map(resumirItem_),
    cerradas: items.filter(function (i) { return cerradasIds[i.subsolicitud_id]; }).map(resumirItem_),
    en_riesgo_o_vencidas: enRiesgoOVencidas.map(resumirItem_),
    requieren_accion: requierenAccion.map(resumirItem_),
    resumen: {
      nuevas: nuevas.length,
      avanzaron: Object.keys(avanzaronIds).length,
      cerradas: Object.keys(cerradasIds).length,
      en_riesgo: enRiesgoOVencidas.length,
      requieren_accion: requierenAccion.length
    }
  };
}

// Version compacta de un item para las listas de "hoy" -- el frontend no
// necesita todo el objeto completo, solo lo identificable de un vistazo.
function resumirItem_(i) {
  return {
    subsolicitud_id: i.subsolicitud_id,
    solicitud_id: i.solicitud_id,
    numero_item: i.numero_item,
    titulo: i.titulo,
    estado: i.estado,
    prioridad: i.prioridad,
    solicitante_nombre: i.solicitante_nombre,
    desarrollador_nombre: i.desarrollador_nombre,
    semaforo: i.cumplimiento.emoji + ' ' + i.cumplimiento.etiqueta
  };
}

// v4.2 (§5): desglose por persona -- para cada miembro del equipo, cuanto
// tiene abierto, en riesgo, y si algo espera su validacion. Una persona
// puede aparecer como solicitante y como resolutor a la vez (dos filas
// distintas de "que tiene pendiente"), asi que se cuenta cada dimension por
// separado en vez de mezclar "sus solicitudes" con "su trabajo asignado".
function calcularPorPersonaJefatura_(items, equipo, nombrePorEmail) {
  return equipo.map(function (email) {
    var comoSolicitante = items.filter(function (i) { return i.persona_solicitante === email; });
    var comoResolutor = items.filter(function (i) { return i.persona_resolutor === email; });
    function abiertas_(lista) { return lista.filter(function (i) { return ESTADOS_CERRADOS.indexOf(i.estado) === -1; }); }
    function enRiesgo_(lista) {
      return lista.filter(function (i) { return i.cumplimiento.codigo === 'EN_RIESGO' || i.cumplimiento.codigo === 'ATRASADA_DESARROLLADOR'; });
    }
    return {
      email: email,
      nombre: nombrePorEmail[email] || email,
      solicitadas_total: comoSolicitante.length,
      solicitadas_abiertas: abiertas_(comoSolicitante).length,
      solicitadas_esperando_validacion: comoSolicitante.filter(function (i) { return i.cumplimiento.codigo === 'ESPERANDO_VALIDACION'; }).length,
      asignadas_total: comoResolutor.length,
      asignadas_abiertas: abiertas_(comoResolutor).length,
      asignadas_en_riesgo: enRiesgo_(comoResolutor).length
    };
  });
}

// v4.2 (§6): que modulo/tipo se repite en mi equipo -- version acotada de
// Gerencia.calcularRecurrencia_ (sin tendencia vs periodo anterior: para un
// equipo chico esa comparacion es ruidosa; alcanza con el ranking del
// conjunto actual).
function calcularCargaJefatura_(items) {
  function agrupar_(campo, etiquetaVacia) {
    var conteo = {};
    items.forEach(function (i) {
      var clave = i[campo] || etiquetaVacia;
      conteo[clave] = (conteo[clave] || 0) + 1;
    });
    return Object.keys(conteo)
      .map(function (clave) { return { etiqueta: clave, cantidad: conteo[clave] }; })
      .sort(function (a, b) { return b.cantidad - a.cantidad; });
  }
  return {
    por_modulo: agrupar_('modulo_nombre', '(sin módulo)'),
    por_tipo: agrupar_('tipo_nombre', '(sin tipo)')
  };
}

// v4.2 (§7): tendencia de 6 meses del equipo -- mismo bucket mensual que
// Gerencia.calcularTendenciaTemporal_, sin el % de cumplimiento (ya vive en
// los KPIs de arriba; aca solo interesa el volumen creadas/cerradas).
function calcularTendenciaJefatura_(items) {
  var MESES_VENTANA = 6;
  var ahora = new Date();
  var buckets = [];
  for (var i = MESES_VENTANA - 1; i >= 0; i--) {
    var fechaBucket = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    buckets.push({
      anio: fechaBucket.getFullYear(), mes: fechaBucket.getMonth(),
      etiqueta: fechaBucket.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' }),
      creadas: 0, cerradas: 0
    });
  }
  function bucketDe_(fechaIso) {
    var f = new Date(fechaIso);
    for (var j = 0; j < buckets.length; j++) {
      if (buckets[j].anio === f.getFullYear() && buckets[j].mes === f.getMonth()) return buckets[j];
    }
    return null;
  }
  items.forEach(function (i) {
    var bCreacion = bucketDe_(i.fecha_creacion);
    if (bCreacion) bCreacion.creadas++;
    if (i.fecha_terminada) {
      var bCierre = bucketDe_(i.fecha_terminada);
      if (bCierre) bCierre.cerradas++;
    }
  });
  return buckets.map(function (b) { return { etiqueta: b.etiqueta, creadas: b.creadas, cerradas: b.cerradas }; });
}

// --- CRUD de JEFATURAS (solo ADM) -----------------------------------------

function crearJefatura_(data) {
  var jefeEmail = String(data.jefe_email || '').trim().toLowerCase();
  var subordinadoEmail = String(data.subordinado_email || '').trim().toLowerCase();
  if (!jefeEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(jefeEmail)) {
    return errorValidacion_('jefe_email', 'Correo del jefe invalido.');
  }
  if (!subordinadoEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(subordinadoEmail)) {
    return errorValidacion_('subordinado_email', 'Correo de la persona a cargo invalido.');
  }
  if (jefeEmail === subordinadoEmail) {
    return errorValidacion_('subordinado_email', 'Una persona no puede ser su propio jefe.');
  }
  var existente = leerFilasSeguro_(SHEETS.JEFATURAS).filter(function (j) {
    var activo = j.activo === true || j.activo === 'TRUE' || j.activo === 1;
    return activo && j.jefe_email === jefeEmail && j.subordinado_email === subordinadoEmail;
  })[0];
  if (existente) {
    return errorValidacion_('subordinado_email', 'Esa persona ya esta a cargo de ese jefe.');
  }
  var fila = {
    jefatura_id: Utilities.getUuid(),
    jefe_email: jefeEmail,
    subordinado_email: subordinadoEmail,
    activo: true
  };
  agregarFila_(SHEETS.JEFATURAS, fila);
  return fila;
}

function activarJefatura_(data) {
  if (!data.jefatura_id) {
    return errorValidacion_('jefatura_id', 'Falta indicar la relacion a modificar.');
  }
  actualizarFilaPorId_(SHEETS.JEFATURAS, 'jefatura_id', data.jefatura_id, {
    activo: data.activo !== false
  });
  return { jefatura_id: data.jefatura_id, activo: data.activo !== false };
}

function eliminarJefatura_(data) {
  if (!data.jefatura_id) {
    return errorValidacion_('jefatura_id', 'Falta indicar la relacion a eliminar.');
  }
  eliminarFilasPorId_(SHEETS.JEFATURAS, 'jefatura_id', data.jefatura_id);
  return { jefatura_id: data.jefatura_id, eliminada: true };
}
