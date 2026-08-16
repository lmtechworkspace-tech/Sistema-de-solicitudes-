/**
 * Proveedores.gs — v10.0 Fase 5a, PRO-04 (§8.4 de la norma: control de los
 * procesos, productos y servicios suministrados externamente).
 *
 * Dos registros del procedimiento, y la relacion entre ellos es lo que le
 * da sentido al modulo:
 *
 *   FO-PRO-04-01  Listado de proveedores aprobados  -> SGC_PROVEEDORES
 *   FO-PRO-04-02  Evaluacion de proveedores         -> SGC_PROVEEDOR_EVALUACIONES
 *
 * El listado no se mantiene a mano: el "Resultado evaluacion" y el "Estatus
 * (aprobado/reprobado)" que pide el formulario los ESCRIBE la evaluacion. Un
 * proveedor no queda reprobado porque alguien lo marque, sino porque sacó 5.0
 * o menos -- que es exactamente lo que PRO-04 §6.2 manda y lo que el auditor
 * va a querer poder reconstruir.
 *
 * La otra decision que vale la pena explicar es el proveedor UNICO. El
 * procedimiento dice "el proveedor se desechara cuando obtenga calificacion
 * promedio inferior o igual a 5.0", pero agrega que "para proveedores unicos,
 * se enviara un correo solicitando una reunion en la cual se solicitara
 * mejorar el servicio". Si el sistema tratara a los dos igual, en la practica
 * estaria pidiendo desechar a un proveedor que no se puede reemplazar. Por eso
 * `es_unico` cambia la consecuencia de reprobar: no lo saca de circulacion,
 * genera la gestion de mejora.
 */

var Proveedores = {

  // --- Listado maestro (FO-PRO-04-01) --------------------------------------
  listar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso al listado de proveedores.' };
    }

    var filtros = data || {};
    var ahora = new Date();
    var todos = leerFilasSeguro_(SHEETS.SGC_PROVEEDORES).filter(esActivoSgc_);
    var visibles = todos;

    if (filtros.estado) {
      visibles = visibles.filter(function (p) { return p.estado === filtros.estado; });
    }
    if (filtros.busqueda) {
      var q = String(filtros.busqueda).trim().toLowerCase();
      visibles = visibles.filter(function (p) {
        return String(p.nombre || '').toLowerCase().indexOf(q) !== -1 ||
          String(p.rut || '').toLowerCase().indexOf(q) !== -1 ||
          String(p.producto_servicio || '').toLowerCase().indexOf(q) !== -1;
      });
    }

    return {
      puede_gestionar: gobierna,
      criterios: CRITERIOS_PROVEEDOR,
      escala: ESCALA_PROVEEDOR,
      corte_aprobacion: CORTE_APROBACION_PROVEEDOR,
      indicadores: indicadoresProveedores_(todos, ahora),
      proveedores: visibles.map(function (p) {
        return resumenProveedor_(p, ahora);
      }).sort(function (a, b) {
        return String(a.nombre || '').localeCompare(String(b.nombre || ''));
      })
    };
  },

  getDetalle: function (data, contexto) {
    var proveedor = buscarProveedor_(data.proveedor_id);
    if (!proveedor) return errorValidacion_('proveedor_id', 'Proveedor no encontrado.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso a este proveedor.' };
    }

    var evaluaciones = leerFilasSeguro_(SHEETS.SGC_PROVEEDOR_EVALUACIONES)
      .filter(function (e) { return e.proveedor_id === proveedor.proveedor_id; })
      .sort(function (a, b) { return new Date(b.fecha || 0) - new Date(a.fecha || 0); })
      .map(function (e) {
        return {
          evaluacion_id: e.evaluacion_id,
          fecha: e.fecha,
          orden_compra: e.orden_compra,
          calificaciones: CRITERIOS_PROVEEDOR.map(function (c) {
            return { criterio: c.campo, etiqueta: c.etiqueta, valor: Number(e[c.campo]) || 0 };
          }),
          promedio: Number(e.promedio) || 0,
          resultado: e.resultado,
          aprobado: esVerdaderoSgc_(e.aprobado),
          observaciones: e.observaciones,
          evaluador_email: e.evaluador_email,
          proxima_evaluacion: e.proxima_evaluacion
        };
      });

    return {
      proveedor: resumenProveedor_(proveedor, new Date()),
      puede_gestionar: gobierna,
      criterios: CRITERIOS_PROVEEDOR,
      escala: ESCALA_PROVEEDOR,
      corte_aprobacion: CORTE_APROBACION_PROVEEDOR,
      evaluaciones: evaluaciones
    };
  },

  // --- Alta / edicion del proveedor ----------------------------------------
  guardar: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden mantener el listado de proveedores.' };
    }
    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre o razón social es obligatorio.');
    var producto = String(data.producto_servicio || '').trim();
    if (!producto) {
      return errorValidacion_('producto_servicio',
        'Indica qué producto o servicio provee: es la primera columna del listado (FO-PRO-04-01).');
    }
    var email = String(data.email || '').trim();
    if (email && !esEmailValidoSgc_(email)) {
      return errorValidacion_('email', 'El correo del proveedor no es válido.');
    }

    var campos = {
      nombre: nombre,
      rut: String(data.rut || '').trim(),
      producto_servicio: producto,
      direccion: String(data.direccion || '').trim(),
      telefono: String(data.telefono || '').trim(),
      email: email,
      nombre_contacto: String(data.nombre_contacto || '').trim(),
      es_unico: data.es_unico === true
    };

    if (data.proveedor_id) {
      var existente = buscarProveedor_(data.proveedor_id);
      if (!existente) return errorValidacion_('proveedor_id', 'Proveedor no encontrado.');
      var actualizado = actualizarFilaPorId_(SHEETS.SGC_PROVEEDORES, 'proveedor_id',
        existente.proveedor_id, campos);
      registrarLogSgc_('SGC_PROVEEDOR_EDITADO', nombre, contexto);
      return actualizado;
    }

    // El RUT identifica al proveedor: repetirlo parte el historial de
    // evaluaciones en dos fichas y arruina el seguimiento de 12 meses.
    if (campos.rut) {
      var duplicado = leerFilasSeguro_(SHEETS.SGC_PROVEEDORES).filter(function (p) {
        return esActivoSgc_(p) && String(p.rut || '').trim() === campos.rut;
      })[0];
      if (duplicado) {
        return errorValidacion_('rut', 'Ya existe un proveedor con el RUT ' + campos.rut + ' (' + duplicado.nombre + ').');
      }
    }

    var proveedor = {
      proveedor_id: Utilities.getUuid(),
      nombre: campos.nombre,
      rut: campos.rut,
      producto_servicio: campos.producto_servicio,
      direccion: campos.direccion,
      telefono: campos.telefono,
      email: campos.email,
      nombre_contacto: campos.nombre_contacto,
      es_unico: campos.es_unico,
      // Nace SIN_EVALUAR y no "aprobado": aprobarlo es el resultado de
      // evaluarlo, no del acto de darlo de alta (PRO-04 §6.2).
      estado: 'SIN_EVALUAR',
      ultima_evaluacion_fecha: '',
      ultima_evaluacion_promedio: '',
      ultima_evaluacion_resultado: '',
      proxima_evaluacion: '',
      creado_por: (contexto && contexto.email) || '',
      fecha_creacion: new Date().toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.SGC_PROVEEDORES, proveedor);
    registrarLogSgc_('SGC_PROVEEDOR_CREADO', nombre, contexto);
    return proveedor;
  },

  // --- Evaluacion anual (FO-PRO-04-02) -------------------------------------
  evaluar: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden evaluar proveedores.' };
    }
    var proveedor = buscarProveedor_(data.proveedor_id);
    if (!proveedor) return errorValidacion_('proveedor_id', 'Proveedor no encontrado.');

    var calificaciones = {};
    for (var i = 0; i < CRITERIOS_PROVEEDOR.length; i++) {
      var criterio = CRITERIOS_PROVEEDOR[i];
      var valor = Number(data[criterio.campo]);
      if (!(valor >= 1 && valor <= 10)) {
        return errorValidacion_(criterio.campo,
          'Califica "' + criterio.etiqueta + '" con una nota de 1 a 10.');
      }
      calificaciones[criterio.campo] = valor;
    }

    var suma = 0;
    CRITERIOS_PROVEEDOR.forEach(function (c) { suma += calificaciones[c.campo]; });
    var promedio = Math.round((suma / CRITERIOS_PROVEEDOR.length) * 100) / 100;
    // "inferior o igual a 5.0" reprueba (PRO-04 §6.2). El corte numerico
    // manda sobre la escala cualitativa: un 5.0 es "Regular" y aun asi
    // reprueba, por eso se calculan por separado.
    var aprobado = promedio > CORTE_APROBACION_PROVEEDOR;
    var fecha = data.fecha || new Date().toISOString();

    var evaluacion = {
      evaluacion_id: Utilities.getUuid(),
      proveedor_id: proveedor.proveedor_id,
      fecha: fecha,
      orden_compra: String(data.orden_compra || '').trim(),
      calidad: calificaciones.calidad,
      plazo_entrega: calificaciones.plazo_entrega,
      costos: calificaciones.costos,
      tiempo_respuesta: calificaciones.tiempo_respuesta,
      precio: calificaciones.precio,
      postventa: calificaciones.postventa,
      promedio: promedio,
      resultado: escalaCualitativaProveedor_(promedio),
      aprobado: aprobado,
      observaciones: String(data.observaciones || '').trim(),
      evaluador_email: normalizarEmailSgc_((contexto && contexto.email) || ''),
      // El seguimiento es cada 12 meses (PRO-04 §6.2), se calcula solo para
      // que nadie tenga que acordarse de agendarlo.
      proxima_evaluacion: sumarMesesSgc_(fecha, MESES_EVALUACION_PROVEEDOR)
    };
    agregarFila_(SHEETS.SGC_PROVEEDOR_EVALUACIONES, evaluacion);

    // El listado maestro se actualiza solo: es la columna "Resultado
    // evaluacion" / "Estatus" del FO-PRO-04-01.
    var actualizado = actualizarFilaPorId_(SHEETS.SGC_PROVEEDORES, 'proveedor_id',
      proveedor.proveedor_id, {
        estado: aprobado ? 'APROBADO' : 'REPROBADO',
        ultima_evaluacion_fecha: fecha,
        ultima_evaluacion_promedio: promedio,
        ultima_evaluacion_resultado: evaluacion.resultado,
        proxima_evaluacion: evaluacion.proxima_evaluacion
      });

    registrarLogSgc_('SGC_PROVEEDOR_EVALUADO',
      proveedor.nombre + ' ' + promedio + ' (' + evaluacion.resultado + ')', contexto);

    if (!aprobado) avisarProveedorReprobado_(proveedor, evaluacion, contexto);

    return {
      evaluacion: evaluacion,
      proveedor: actualizado,
      // El frontend necesita saber QUE hacer con un reprobado, y eso depende
      // de si es unico o no. Se resuelve aca y no en la pantalla para que la
      // regla del procedimiento viva en un solo lugar.
      consecuencia: !aprobado
        ? (esVerdaderoSgc_(proveedor.es_unico) ? 'REUNION_MEJORA' : 'DESECHAR')
        : ''
    };
  },

  // --- Baja del listado -----------------------------------------------------
  desactivar: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden dar de baja un proveedor.' };
    }
    var proveedor = buscarProveedor_(data.proveedor_id);
    if (!proveedor) return errorValidacion_('proveedor_id', 'Proveedor no encontrado.');
    var motivo = String(data.motivo || '').trim();
    if (motivo.length < 10) {
      return errorValidacion_('motivo', 'Explica por qué se da de baja (mínimo 10 caracteres).');
    }
    // Baja logica: las evaluaciones pasadas siguen siendo evidencia de que
    // el control de §8.4 se aplicaba, aunque hoy ya no se le compre.
    var actualizado = actualizarFilaPorId_(SHEETS.SGC_PROVEEDORES, 'proveedor_id',
      proveedor.proveedor_id, { activa: false });
    registrarLogSgc_('SGC_PROVEEDOR_BAJA', proveedor.nombre + ' — ' + motivo, contexto);
    return actualizado;
  }
};

// --- Alertas (se cuelgan de la pasada diaria, sin trigger propio) ------------
Proveedores.recordatorioPendientes = function () {
  var ahora = new Date();
  var hoy = ahora.toISOString().slice(0, 10);
  var encargados = encargadosSgc_();
  if (!encargados.length) return { avisos: 0 };

  var avisos = 0;
  var vencidos = [];
  var reprobados = [];

  leerFilasSeguro_(SHEETS.SGC_PROVEEDORES).filter(esActivoSgc_).forEach(function (p) {
    if (p.proxima_evaluacion) {
      var limite = new Date(p.proxima_evaluacion);
      if (!isNaN(limite.getTime()) && limite < ahora) vencidos.push(p);
    } else if (p.estado === 'SIN_EVALUAR') {
      // Nunca evaluado: tambien es un incumplimiento de §8.4, no un vacio
      // que se pueda dejar pasar.
      vencidos.push(p);
    }
    if (p.estado === 'REPROBADO') reprobados.push(p);
  });

  if (vencidos.length) {
    var cuerpoV = 'Estos proveedores necesitan su evaluación anual (PRO-04 §6.2):\n\n' +
      vencidos.map(function (p) {
        return '· ' + p.nombre + ' — ' + p.producto_servicio +
          (p.proxima_evaluacion ? ' (vencía el ' + String(p.proxima_evaluacion).slice(0, 10) + ')' : ' (nunca evaluado)');
      }).join('\n');
    encargados.forEach(function (email) {
      enviarCorreo_('SGC-PROVEEDORES', email, 'SGC_PROVEEDOR_EVAL_VENCIDA:' + hoy,
        'SIGSO — ' + vencidos.length + ' proveedor(es) por evaluar', cuerpoV);
      encolarNotificacionApp_(email, 'SGC_PROVEEDOR', 'Evaluación de proveedores pendiente',
        vencidos.length + ' proveedor(es) esperan su evaluación anual.', 'calidad', 'Ver proveedores', 72);
      avisos++;
    });
  }

  if (reprobados.length) {
    var cuerpoR = 'Estos proveedores están REPROBADOS (promedio ≤ ' + CORTE_APROBACION_PROVEEDOR + '):\n\n' +
      reprobados.map(function (p) {
        return '· ' + p.nombre + ' — ' + p.ultima_evaluacion_promedio +
          (esVerdaderoSgc_(p.es_unico)
            ? ' — PROVEEDOR ÚNICO: corresponde pedirle una reunión de mejora, no desecharlo.'
            : ' — corresponde dejar de comprarle (PRO-04 §6.2).');
      }).join('\n');
    encargados.forEach(function (email) {
      enviarCorreo_('SGC-PROVEEDORES', email, 'SGC_PROVEEDOR_REPROBADO:' + hoy,
        'SIGSO — ' + reprobados.length + ' proveedor(es) reprobados', cuerpoR);
      avisos++;
    });
  }

  return { avisos: avisos, vencidos: vencidos.length, reprobados: reprobados.length };
};

// --- constantes -------------------------------------------------------------

// Los seis items de PRO-04 §6.2, en el mismo orden en que los enumera el
// procedimiento (a hasta f) y el formulario FO-PRO-04-02.
var CRITERIOS_PROVEEDOR = [
  { campo: 'calidad', etiqueta: 'Calidad en los productos/servicios proporcionados' },
  { campo: 'plazo_entrega', etiqueta: 'Plazo de entrega' },
  { campo: 'costos', etiqueta: 'Costos respecto a los productos/servicios proporcionados' },
  { campo: 'tiempo_respuesta', etiqueta: 'Tiempo de respuesta a consultas' },
  { campo: 'precio', etiqueta: 'Competitividad en el precio' },
  { campo: 'postventa', etiqueta: 'Servicio de postventa' }
];

// Escala cualitativa textual de PRO-04 §6.2. Se muestra junto a la nota
// porque el procedimiento califica con palabras, no solo con el numero.
var ESCALA_PROVEEDOR = [
  { desde: 1, hasta: 3.9, etiqueta: 'Malo' },
  { desde: 4, hasta: 6.5, etiqueta: 'Regular' },
  { desde: 6.6, hasta: 10, etiqueta: 'Bueno' }
];

var CORTE_APROBACION_PROVEEDOR = 5.0;
var MESES_EVALUACION_PROVEEDOR = 12;

// --- helpers ----------------------------------------------------------------

function buscarProveedor_(proveedorId) {
  if (!proveedorId) return null;
  return leerFilasSeguro_(SHEETS.SGC_PROVEEDORES).filter(function (p) {
    return p.proveedor_id === proveedorId && esActivoSgc_(p);
  })[0] || null;
}

function escalaCualitativaProveedor_(promedio) {
  for (var i = 0; i < ESCALA_PROVEEDOR.length; i++) {
    if (promedio >= ESCALA_PROVEEDOR[i].desde && promedio <= ESCALA_PROVEEDOR[i].hasta) {
      return ESCALA_PROVEEDOR[i].etiqueta.toUpperCase();
    }
  }
  return '';
}

function resumenProveedor_(p, ahora) {
  var dias = p.proxima_evaluacion ? diasHastaSgc_(p.proxima_evaluacion, ahora) : null;
  return {
    proveedor_id: p.proveedor_id,
    nombre: p.nombre,
    rut: p.rut,
    producto_servicio: p.producto_servicio,
    direccion: p.direccion,
    telefono: p.telefono,
    email: p.email,
    nombre_contacto: p.nombre_contacto,
    es_unico: esVerdaderoSgc_(p.es_unico),
    estado: p.estado,
    ultima_evaluacion_fecha: p.ultima_evaluacion_fecha,
    ultima_evaluacion_promedio: p.ultima_evaluacion_promedio === '' ? null : Number(p.ultima_evaluacion_promedio),
    ultima_evaluacion_resultado: p.ultima_evaluacion_resultado,
    proxima_evaluacion: p.proxima_evaluacion,
    dias_para_evaluacion: dias,
    // Señal calculada: nunca evaluado tambien cuenta como pendiente, no como
    // "al dia por no tener fecha".
    evaluacion_vencida: p.estado === 'SIN_EVALUAR' || (dias !== null && dias < 0)
  };
}

function indicadoresProveedores_(todos, ahora) {
  var ind = { total: 0, aprobados: 0, reprobados: 0, sin_evaluar: 0, por_evaluar: 0, unicos_reprobados: 0 };
  todos.forEach(function (p) {
    ind.total++;
    if (p.estado === 'APROBADO') ind.aprobados++;
    if (p.estado === 'REPROBADO') {
      ind.reprobados++;
      if (esVerdaderoSgc_(p.es_unico)) ind.unicos_reprobados++;
    }
    if (p.estado === 'SIN_EVALUAR') ind.sin_evaluar++;
    var r = resumenProveedor_(p, ahora);
    if (r.evaluacion_vencida) ind.por_evaluar++;
  });
  return ind;
}

// Aviso inmediato al reprobar: la consecuencia depende de si es unico, y es
// justo el momento en que hay que decidir. Dejarlo solo para el resumen
// diario haria que la decision llegue tarde.
function avisarProveedorReprobado_(proveedor, evaluacion, contexto) {
  var unico = esVerdaderoSgc_(proveedor.es_unico);
  var asunto = 'SIGSO — Proveedor reprobado: ' + proveedor.nombre;
  var cuerpo = proveedor.nombre + ' obtuvo ' + evaluacion.promedio +
    ' en su evaluación (' + evaluacion.resultado + '), bajo el corte de ' +
    CORTE_APROBACION_PROVEEDOR + '.\n\n' +
    (unico
      ? 'Es un PROVEEDOR ÚNICO: según PRO-04 §6.2 no se desecha. Corresponde enviarle un correo ' +
        'solicitando una reunión para pedirle mejorar el servicio.'
      : 'Según PRO-04 §6.2 corresponde dejar de comprarle y buscar un reemplazo.');

  encargadosSgc_().forEach(function (email) {
    enviarCorreo_('SGC-PROVEEDORES', email, 'SGC_PROVEEDOR_REPROBADO_' + evaluacion.evaluacion_id,
      asunto, cuerpo);
    encolarNotificacionApp_(email, 'SGC_PROVEEDOR', 'Proveedor reprobado',
      proveedor.nombre + ' obtuvo ' + evaluacion.promedio + '. ' +
      (unico ? 'Es único: pedir reunión de mejora.' : 'Corresponde reemplazarlo.'),
      'calidad', 'Ver proveedores', 72);
  });
}

// Validacion de correo propia del modulo SGC: Intake tiene la suya
// (esEmailValido_) pero vive en el otro proyecto de Apps Script.
function esEmailValidoSgc_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}
