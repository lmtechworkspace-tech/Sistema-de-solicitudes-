/**
 * Prestaciones.gs — v11.0 Fase 8: evidencia de servicios prestados
 * (§8.1, §8.5, §8.6 y §8.7).
 *
 * La ultima fase del plan y la unica con riesgo de escala. Por eso se dejo
 * para el final: con 50 clientes y 40 procesos de servicio, una matriz
 * completa cliente x proceso x mes serian 24.000 filas al año, casi todas
 * vacias, y cada consulta tendria que leerlas todas.
 *
 * LAS TRES DECISIONES QUE LA HACEN VIABLE
 *
 * 1. NO se pre-generan filas. Una fila existe cuando alguien registra que el
 *    servicio se presto. Lo que no ocurrio, no ocupa lugar. Esto es lo unico
 *    que separa un modulo usable de uno que se cae solo al segundo año.
 *
 * 2. Las consultas van SIEMPRE acotadas. `listar` exige un periodo o un
 *    cliente; sin filtro devuelve solo las ultimas y lo dice. Apps Script
 *    lee la hoja entera en cada llamada: lo que se puede controlar no es la
 *    lectura, es cuanto se devuelve y cuanto crece la hoja.
 *
 * 3. El modulo MIDE su propio volumen y avisa. Cuando la hoja pasa el
 *    umbral, el Encargado ve una advertencia con que hacer. No se puede
 *    resolver el crecimiento indefinido dentro de una planilla, pero si se
 *    puede avisar antes de que duela en vez de fingir que no pasa.
 *
 * QUE CIERRA DE LA NORMA
 *
 *   §8.1 / §8.5  el servicio se presto, cuando y quien
 *   §8.6         quien AUTORIZO la liberacion y cuando -- la trazabilidad a
 *                la persona que libera es literal en la clausula
 *   §8.7         una salida no conforme se marca como tal y puede derivar en
 *                una NC con el mismo eslabon que ya usan las quejas
 *
 * El cliente NO se duplica: sale de CAT_CLIENTES, que existe en SIGSO desde
 * la v1.0.
 */

var ESTADOS_PRESTACION = ['PRESTADO', 'LIBERADO', 'NO_CONFORME'];

// Cuantas filas devuelve una consulta sin filtro, y a partir de cuantas se
// avisa que conviene archivar el año anterior.
var TOPE_PRESTACIONES_SIN_FILTRO = 100;
var UMBRAL_VOLUMEN_PRESTACIONES = 5000;

var Prestaciones = {

  listar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso al registro de servicios prestados.' };
    }

    var filtros = data || {};
    var periodo = String(filtros.periodo || '').trim();
    var clienteId = String(filtros.cliente_id || '').trim();
    var procesoId = String(filtros.proceso_id || '').trim();
    var estado = String(filtros.estado || '').trim().toUpperCase();

    var todas = leerFilasSeguro_(SHEETS.SGC_PRESTACIONES).filter(esActivoSgc_);

    var filtradas = todas.filter(function (p) {
      if (periodo && String(p.periodo || '') !== periodo) return false;
      if (clienteId && p.cliente_id !== clienteId) return false;
      if (procesoId && p.proceso_id !== procesoId) return false;
      if (estado && p.estado !== estado) return false;
      return true;
    });

    // Sin filtro no se devuelve todo: en un año de operacion serian miles de
    // filas viajando al navegador para nada.
    var acotada = !periodo && !clienteId && !procesoId;
    var visibles = filtradas.sort(function (a, b) {
      return String(b.fecha_prestacion || '').localeCompare(String(a.fecha_prestacion || ''));
    });
    if (acotada) visibles = visibles.slice(0, TOPE_PRESTACIONES_SIN_FILTRO);

    var procesos = (typeof procesosActivos_ === 'function')
      ? procesosActivos_().filter(function (p) { return p.nivel === 'SERVICIO'; }) : [];
    var clientes = leerFilasSeguro_(SHEETS.CAT_CLIENTES).filter(function (c) {
      return esVerdaderoSgc_(c.activo);
    });

    return {
      puede_gestionar: gobierna,
      // Lo que hay para elegir en los formularios: procesos de servicio de la
      // Fase 4 y clientes del catalogo que ya existia.
      procesos: procesos.map(function (p) {
        return { proceso_id: p.proceso_id, codigo: p.codigo, nombre: p.nombre, area: p.area || '' };
      }),
      clientes: clientes.map(function (c) {
        return { cliente_id: c.cliente_id, nombre: c.razon_social, rut: c.rut || '' };
      }),
      estados: ESTADOS_PRESTACION,
      filtros: { periodo: periodo, cliente_id: clienteId, proceso_id: procesoId, estado: estado },
      acotada: acotada,
      tope: TOPE_PRESTACIONES_SIN_FILTRO,
      total_filtrado: filtradas.length,
      prestaciones: visibles.map(formatearPrestacion_),
      resumen: resumenPrestaciones_(filtradas),
      volumen: volumenPrestaciones_(todas)
    };
  },

  /**
   * Registra que un servicio se presto. No exige periodo: los DOC-10 a 13
   * distinguen servicios mensuales de puntuales, y forzar un periodo a uno
   * puntual obligaria a inventarlo.
   */
  registrar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede registrar prestaciones.' };
    }

    var val = validarPrestacion_(data);
    if (val.error) return { ok: false, message: val.error };

    // Un proceso MENSUAL no puede tener dos prestaciones del mismo periodo
    // para el mismo cliente: seria contar dos veces el mismo servicio.
    if (val.datos.periodo) {
      var repetida = leerFilasSeguro_(SHEETS.SGC_PRESTACIONES).filter(function (p) {
        return esActivoSgc_(p) && p.cliente_id === val.datos.cliente_id &&
          p.proceso_id === val.datos.proceso_id && String(p.periodo || '') === val.datos.periodo;
      })[0];
      if (repetida) {
        return {
          ok: false,
          message: 'Ya hay una prestación de ' + val.datos.proceso_codigo + ' para ese cliente en ' +
            val.datos.periodo + '. Edítala en vez de registrar otra.'
        };
      }
    }

    var ahora = new Date().toISOString();
    var campos = val.datos;
    campos.prestacion_id = Utilities.getUuid();
    campos.estado = 'PRESTADO';
    campos.liberado_por = '';
    campos.fecha_liberacion = '';
    campos.nc_id = '';
    campos.creado_por = (contexto && contexto.email) || '';
    campos.fecha_creacion = ahora;
    campos.activa = true;
    agregarFila_(SHEETS.SGC_PRESTACIONES, campos);

    registrarLogSgc_('SGC_PRESTACION_REGISTRADA',
      campos.proceso_codigo + ' → ' + campos.cliente_nombre +
      (campos.periodo ? ' (' + campos.periodo + ')' : ''), contexto);
    return { ok: true, prestacion_id: campos.prestacion_id, message: 'Prestación registrada.' };
  },

  /**
   * §8.6: la liberacion. La clausula pide trazabilidad A LA PERSONA que
   * autoriza, asi que se guarda quien y cuando, no un simple "liberado".
   *
   * Si quien libera es quien presto, se permite pero se ANOTA: el DOC-01
   * dice que libera la jefatura del area, y en un equipo de 14 personas eso
   * casi siempre es alguien distinto. No se bloquea porque ningun documento
   * lo prohibe, pero la matriz de cobertura lo muestra.
   */
  liberar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede liberar un servicio.' };
    }
    var p = buscarPrestacion_(data && data.prestacion_id);
    if (!p) return { ok: false, message: 'No se encontró la prestación.' };
    if (p.estado === 'LIBERADO') return { ok: false, message: 'Esta prestación ya está liberada.' };
    if (p.estado === 'NO_CONFORME') {
      return { ok: false, message: 'Una salida no conforme no se libera: primero hay que tratarla (§8.7).' };
    }

    var quien = normalizarEmailSgc_((data && data.liberado_por) || (contexto && contexto.email));
    if (!quien) return { ok: false, message: 'Indica quién autoriza la liberación.' };

    var hoy = new Date().toISOString().slice(0, 10);
    actualizarFilaPorId_(SHEETS.SGC_PRESTACIONES, 'prestacion_id', p.prestacion_id, {
      estado: 'LIBERADO',
      liberado_por: quien,
      fecha_liberacion: String((data && data.fecha_liberacion) || hoy).slice(0, 10)
    });
    registrarLogSgc_('SGC_PRESTACION_LIBERADA',
      p.proceso_codigo + ' → ' + p.cliente_nombre + ' liberada por ' + quien, contexto);

    var mismaPersona = quien === normalizarEmailSgc_(p.responsable_email);
    return {
      ok: true,
      message: 'Servicio liberado.' + (mismaPersona
        ? ' Aviso: quien liberó es quien prestó el servicio; el DOC-01 dice que libera la jefatura del área.'
        : '')
    };
  },

  /**
   * §8.7: salida no conforme. Marcarla es el primer paso; el segundo,
   * opcional, es abrir la NC con el mismo eslabon que ya usan las quejas y
   * los hallazgos de auditoria.
   */
  marcarNoConforme: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede marcar una salida no conforme.' };
    }
    var p = buscarPrestacion_(data && data.prestacion_id);
    if (!p) return { ok: false, message: 'No se encontró la prestación.' };

    var motivo = String((data && data.observaciones) || '').trim();
    if (!motivo) {
      return { ok: false, message: 'Describe en qué no conformó el servicio: sin eso no hay nada que tratar.' };
    }

    actualizarFilaPorId_(SHEETS.SGC_PRESTACIONES, 'prestacion_id', p.prestacion_id, {
      estado: 'NO_CONFORME',
      observaciones: motivo,
      // Una salida no conforme deja de estar liberada: §8.7 pide que no se
      // entregue hasta corregirla.
      liberado_por: '',
      fecha_liberacion: ''
    });
    registrarLogSgc_('SGC_SALIDA_NO_CONFORME',
      p.proceso_codigo + ' → ' + p.cliente_nombre + ': ' + motivo.slice(0, 80), contexto);
    return { ok: true, message: 'Marcada como salida no conforme.' };
  },

  abrirNoConformidad: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede abrir la no conformidad.' };
    }
    var p = buscarPrestacion_(data && data.prestacion_id);
    if (!p) return { ok: false, message: 'No se encontró la prestación.' };
    if (p.estado !== 'NO_CONFORME') {
      return { ok: false, message: 'Primero marca la prestación como salida no conforme.' };
    }
    if (p.nc_id) return { ok: false, message: 'Esta salida no conforme ya tiene su no conformidad.' };

    var responsable = normalizarEmailSgc_((data && data.responsable_email) || p.responsable_email);
    if (!responsable) return { ok: false, message: 'Asigna un responsable para la no conformidad.' };

    var nc = NoConformidades.crear({
      descripcion: 'Salida no conforme en ' + p.proceso_codigo + ' — ' + p.proceso_nombre +
        ' para ' + p.cliente_nombre + (p.periodo ? ' (' + p.periodo + ')' : '') + '. ' + (p.observaciones || ''),
      // La fuente PROCESO ya existia en el catalogo de NC: no hizo falta
      // inventar una nueva para las salidas no conformes.
      fuente: 'PROCESO',
      origen_ref: p.prestacion_id,
      referencia_normativa: '8.7',
      responsable_email: responsable,
      fecha_deteccion: p.fecha_prestacion
    }, contexto);
    if (nc && (nc._validationError || nc._forbidden)) return nc;

    actualizarFilaPorId_(SHEETS.SGC_PRESTACIONES, 'prestacion_id', p.prestacion_id, { nc_id: nc.nc_id });
    registrarLogSgc_('SGC_SALIDA_NC_ABIERTA', p.proceso_codigo + ' → ' + nc.correlativo, contexto);
    return { ok: true, nc_id: nc.nc_id, correlativo: nc.correlativo, message: 'No conformidad ' + nc.correlativo + ' abierta.' };
  },

  anular: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede anular una prestación.' };
    }
    var p = buscarPrestacion_(data && data.prestacion_id);
    if (!p) return { ok: false, message: 'No se encontró la prestación.' };
    actualizarFilaPorId_(SHEETS.SGC_PRESTACIONES, 'prestacion_id', p.prestacion_id, { activa: false });
    registrarLogSgc_('SGC_PRESTACION_ANULADA', p.proceso_codigo + ' → ' + p.cliente_nombre, contexto);
    return { ok: true, message: 'Prestación anulada.' };
  }
};

// --- helpers -----------------------------------------------------------------

function buscarPrestacion_(id) {
  if (!id) return null;
  return leerFilasSeguro_(SHEETS.SGC_PRESTACIONES).filter(function (p) {
    return esActivoSgc_(p) && p.prestacion_id === id;
  })[0] || null;
}

function formatearPrestacion_(p) {
  return {
    prestacion_id: p.prestacion_id,
    cliente_id: p.cliente_id,
    cliente_nombre: p.cliente_nombre || '',
    proceso_id: p.proceso_id,
    proceso_codigo: p.proceso_codigo || '',
    proceso_nombre: p.proceso_nombre || '',
    periodo: p.periodo || '',
    fecha_prestacion: p.fecha_prestacion || '',
    responsable_email: p.responsable_email || '',
    estado: p.estado || 'PRESTADO',
    evidencia: p.evidencia || '',
    liberado_por: p.liberado_por || '',
    fecha_liberacion: p.fecha_liberacion || '',
    // §8.6 pide trazabilidad a quien autoriza. Que sea la misma persona que
    // presto el servicio no lo invalida, pero es una debilidad y se ve.
    liberada_por_el_mismo: !!p.liberado_por &&
      normalizarEmailSgc_(p.liberado_por) === normalizarEmailSgc_(p.responsable_email),
    nc_id: p.nc_id || '',
    observaciones: p.observaciones || ''
  };
}

function resumenPrestaciones_(filas) {
  var r = { total: filas.length, prestado: 0, liberado: 0, no_conforme: 0, sin_evidencia: 0, autoliberadas: 0, nc_abiertas: 0 };
  filas.forEach(function (p) {
    if (p.estado === 'LIBERADO') r.liberado++;
    else if (p.estado === 'NO_CONFORME') r.no_conforme++;
    else r.prestado++;
    if (!String(p.evidencia || '').trim()) r.sin_evidencia++;
    if (p.liberado_por && normalizarEmailSgc_(p.liberado_por) === normalizarEmailSgc_(p.responsable_email)) r.autoliberadas++;
    if (p.nc_id) r.nc_abiertas++;
  });
  return r;
}

/**
 * El modulo mide cuanto pesa y avisa antes de que duela. No se puede evitar
 * que una planilla crezca, pero si se puede decir a tiempo que hay que
 * archivar el año anterior.
 */
function volumenPrestaciones_(todas) {
  var porAnio = {};
  todas.forEach(function (p) {
    var a = String(p.periodo || p.fecha_prestacion || '').slice(0, 4);
    if (!a) return;
    porAnio[a] = (porAnio[a] || 0) + 1;
  });
  return {
    filas: todas.length,
    umbral: UMBRAL_VOLUMEN_PRESTACIONES,
    supera_umbral: todas.length >= UMBRAL_VOLUMEN_PRESTACIONES,
    por_anio: Object.keys(porAnio).sort().map(function (a) {
      return { anio: a, total: porAnio[a] };
    }),
    aviso: todas.length >= UMBRAL_VOLUMEN_PRESTACIONES
      ? 'El registro pasó las ' + UMBRAL_VOLUMEN_PRESTACIONES + ' filas. Conviene archivar los años ' +
        'cerrados en otra planilla: cada consulta lee la hoja completa, y a partir de aquí se empieza a notar.'
      : ''
  };
}

function validarPrestacion_(data) {
  var d = data || {};
  var clienteId = String(d.cliente_id || '').trim();
  if (!clienteId) return { error: 'Indica para qué cliente se prestó el servicio.' };
  var cliente = leerFilasSeguro_(SHEETS.CAT_CLIENTES).filter(function (c) {
    return c.cliente_id === clienteId;
  })[0];
  if (!cliente) return { error: 'El cliente no está en el catálogo de SIGSO.' };

  var procesoId = String(d.proceso_id || '').trim();
  if (!procesoId) return { error: 'Indica qué proceso de servicio se prestó.' };
  var proceso = (typeof procesosActivos_ === 'function')
    ? procesosActivos_().filter(function (p) { return p.proceso_id === procesoId; })[0] : null;
  if (!proceso) return { error: 'El proceso no existe. Carga primero los procesos de servicio (Fase 4).' };
  if (proceso.nivel !== 'SERVICIO') {
    return { error: 'Solo se registran prestaciones de procesos de SERVICIO, no de los del mapa.' };
  }

  var fecha = String(d.fecha_prestacion || '').trim().slice(0, 10);
  if (!fecha) return { error: 'Indica la fecha en que se prestó el servicio.' };

  var responsable = normalizarEmailSgc_(d.responsable_email);
  if (!responsable) return { error: 'Indica quién prestó el servicio.' };

  return {
    datos: {
      cliente_id: clienteId,
      cliente_nombre: cliente.razon_social || '',
      proceso_id: procesoId,
      proceso_codigo: proceso.codigo || '',
      proceso_nombre: proceso.nombre || '',
      periodo: String(d.periodo || '').trim(),
      fecha_prestacion: fecha,
      responsable_email: responsable,
      evidencia: String(d.evidencia || '').trim(),
      observaciones: String(d.observaciones || '').trim()
    }
  };
}
