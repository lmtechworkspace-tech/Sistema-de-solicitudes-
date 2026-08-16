/**
 * NoConformidades.gs — Modulo SGC ISO 9001, Fase 3a (PRO-06).
 * documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md.
 *
 * EL MOTOR DE MEJORA del SGC, y lo que la auditoria de certificacion revisa
 * con mas profundidad (§10.2 de la norma). El ciclo completo es:
 *
 *   detectar -> CORRECCION (apagar el incendio, 10 dias habiles)
 *            -> 5 POR QUE (por que paso, de verdad)
 *            -> ACCION CORRECTIVA (que no vuelva a pasar, 20 dias habiles)
 *            -> EFICACIA (60 dias despues: ¿funciono?)
 *            -> CERRADA, o REABIERTA con un ciclo nuevo si no funciono.
 *
 * ── LA DECISION CENTRAL DE ESTA FASE ──────────────────────────────────────
 * La correccion y la accion correctiva NO son un campo de texto con una
 * fecha: son ACTIVIDADES reales (Actividades.gs, motor v7.0), etiquetadas
 * con sgc_origen_tipo/sgc_origen_id.
 *
 * Es el mismo criterio que v9.0 tomo con las tareas de proyecto, y por el
 * mismo motivo: al responsable le aparecen en "MI TRABAJO", junto a todo lo
 * demas que ya hace, con check-in de un clic, semaforo y alertas. No tiene
 * que entrar a "el modulo ISO" ni aprender un flujo nuevo.
 *
 * Un SGC donde las acciones correctivas viven en una pantalla aparte que
 * nadie abre es un SGC que se abandona a los tres meses. Esta decision es
 * la diferencia.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * PLAZOS EN DIAS HABILES. PRO-06 habla de 10/20/60 dias habiles, no
 * corridos. Se calculan con las mismas primitivas de jornada y feriados que
 * ya usa todo SIGSO (Utils.gs + CONFIG_FERIADOS), no con aritmetica de
 * calendario.
 *
 * NADA SE CIERRA SOLO. El sistema avisa y muestra el estado de la actividad
 * vinculada, pero cerrar una etapa es siempre una decision explicita de una
 * persona: en una auditoria, "el sistema lo cerro automatico" no es una
 * respuesta aceptable.
 */

var NoConformidades = {

  // --- Listado ---------------------------------------------------------------
  listar: function (data, contexto) {
    var filtros = data || {};
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var email = normalizarEmailSgc_(contexto.email);

    var todas = leerFilasSeguro_(SHEETS.SGC_NC).filter(esActivoSgc_);
    // Quien gobierna el SGC (y Direccion/Gerencia) ve todas; el resto ve
    // aquellas de las que es responsable. Una NC no es un documento
    // publico: nombra un problema y a un area.
    var visibles = todas.filter(function (nc) {
      if (veTodoSgc_(contexto, rol, gobierna)) return true;
      return normalizarEmailSgc_(nc.responsable_email) === email ||
        normalizarEmailSgc_(nc.detectada_por) === email;
    });

    if (filtros.estado) {
      visibles = visibles.filter(function (nc) { return nc.estado === filtros.estado; });
    }
    if (filtros.abiertas) {
      visibles = visibles.filter(function (nc) { return ESTADOS_NC_ABIERTOS.indexOf(nc.estado) !== -1; });
    }

    var actividades = leerFilasSeguro_(SHEETS.ACTIVIDADES);
    var porId = {};
    actividades.forEach(function (a) { porId[a.actividad_id] = a; });
    var ahora = new Date();

    return {
      puede_gestionar: gobierna,
      indicadores: indicadoresNc_(todas, ahora),
      no_conformidades: visibles.map(function (nc) {
        return resumenNc_(nc, porId, ahora);
      }).sort(function (a, b) {
        return new Date(b.fecha_deteccion || 0) - new Date(a.fecha_deteccion || 0);
      })
    };
  },

  getDetalle: function (data, contexto) {
    var nc = buscarNc_(data.nc_id);
    if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    var email = normalizarEmailSgc_(contexto.email);
    var esSuya = normalizarEmailSgc_(nc.responsable_email) === email ||
      normalizarEmailSgc_(nc.detectada_por) === email;
    if (!veTodoSgc_(contexto, rol, gobierna) && !esSuya) {
      return { _forbidden: true, message: 'No tienes acceso a esta no conformidad.' };
    }

    var actividades = leerFilasSeguro_(SHEETS.ACTIVIDADES);
    var porId = {};
    actividades.forEach(function (a) { porId[a.actividad_id] = a; });

    return {
      nc: nc,
      puede_gestionar: gobierna,
      resumen: resumenNc_(nc, porId, new Date()),
      // El estado real de la correccion y la accion correctiva lo dice la
      // ACTIVIDAD vinculada, no un campo copiado aca (que se desincronizaria
      // en cuanto la persona haga check-in en "Mi trabajo").
      correccion_actividad: nc.correccion_actividad_id ? tareaResumen_(porId[nc.correccion_actividad_id]) : null,
      accion_actividad: nc.accion_actividad_id ? tareaResumen_(porId[nc.accion_actividad_id]) : null
    };
  },

  // --- 1) Registrar la NC ----------------------------------------------------
  crear: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar no conformidades.' };
    }
    var descripcion = String(data.descripcion || '').trim();
    if (!descripcion) return errorValidacion_('descripcion', 'Describe la no conformidad detectada.');
    if (FUENTES_NC.indexOf(data.fuente) === -1) {
      return errorValidacion_('fuente', 'Indica de dónde salió la no conformidad.');
    }
    var responsable = normalizarEmailSgc_(data.responsable_email);
    if (!responsable) return errorValidacion_('responsable_email', 'Asigna un responsable de la no conformidad.');

    var ahora = new Date();
    var fechaDeteccion = data.fecha_deteccion || ahora.toISOString();
    var nc = {
      nc_id: Utilities.getUuid(),
      correlativo: siguienteCorrelativoNc_(fechaDeteccion),
      fuente: data.fuente,
      origen_ref: data.origen_ref || '',
      // Campo del FO-PRO-06-01 real ("1.- Generalidades") y lo que pide el
      // resumen del informe de auditoria (FO-PRO-03-02, "Punto normativo").
      // Cuando la NC nace de un hallazgo de auditoria llega ya resuelta
      // (Auditorias.convertirHallazgoEnNc pasa la clausula del hallazgo);
      // en una NC manual, opcional.
      referencia_normativa: String(data.referencia_normativa || '').trim(),
      descripcion: descripcion,
      area_id: data.area_id || '',
      detectada_por: normalizarEmailSgc_(contexto.email),
      fecha_deteccion: fechaDeteccion,
      responsable_email: responsable,
      estado: 'ABIERTA',
      ciclo: 1,
      correccion_descripcion: '', correccion_actividad_id: '',
      // El reloj de la correccion parte al DETECTAR (PRO-06: 10 dias
      // habiles desde la deteccion), no cuando alguien se acuerde de
      // registrarla.
      correccion_plazo: sumarDiasHabilesSgc_(fechaDeteccion, DIAS_CORRECCION_NC),
      correccion_fecha_cierre: '',
      porque_1: '', porque_2: '', porque_3: '', porque_4: '', porque_5: '', causa_raiz: '',
      accion_descripcion: '', accion_actividad_id: '', accion_plazo: '', accion_fecha_cierre: '',
      eficacia_plazo: '', eficacia_fecha: '', eficacia_resultado: '', eficacia_observaciones: '',
      fecha_cierre: '', cerrada_por: '',
      fecha_creacion: ahora.toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.SGC_NC, nc);
    registrarLogSgc_('SGC_NC_ABIERTA', nc.correlativo + ': ' + descripcion.slice(0, 80), contexto);
    encolarNotificacionApp_(responsable, 'SGC_NC', 'Te asignaron una no conformidad',
      nc.correlativo + ': ' + descripcion.slice(0, 120), 'calidad', 'Ver no conformidad', 72);
    return nc;
  },

  // --- 2) Correccion: se crea como ACTIVIDAD (aparece en "Mi trabajo") -------
  registrarCorreccion: function (data, contexto) {
    var nc = buscarNc_(data.nc_id);
    if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden definir la corrección.' };
    }
    var descripcion = String(data.descripcion || '').trim();
    if (!descripcion) return errorValidacion_('descripcion', 'Describe la corrección inmediata.');
    if (nc.correccion_actividad_id) {
      return errorValidacion_('nc_id', 'Esta no conformidad ya tiene una corrección asignada.');
    }

    var responsable = normalizarEmailSgc_(data.responsable_email) || normalizarEmailSgc_(nc.responsable_email);
    var plazo = data.fecha_compromiso || nc.correccion_plazo;
    var tarea = crearTareaSgc_({
      titulo: '[NC ' + nc.correlativo + '] Corrección: ' + descripcion.slice(0, 80),
      descripcion: 'Corrección de la no conformidad ' + nc.correlativo + '.\n\n' + descripcion +
        '\n\nNo conformidad: ' + nc.descripcion,
      responsable_email: responsable,
      fecha_compromiso: plazo,
      area_id: nc.area_id,
      origen_tipo: 'NC_CORRECCION',
      origen_id: nc.nc_id
    }, contexto);
    if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;

    var actualizada = actualizarFilaPorId_(SHEETS.SGC_NC, 'nc_id', nc.nc_id, {
      correccion_descripcion: descripcion,
      correccion_actividad_id: tarea.actividad_id,
      correccion_plazo: plazo,
      estado: 'EN_CORRECCION'
    });
    registrarLogSgc_('SGC_NC_CORRECCION', nc.correlativo, contexto);
    return actualizada;
  },

  // --- 3) Analisis de causa: los 5 por que ----------------------------------
  registrarCausa: function (data, contexto) {
    var nc = buscarNc_(data.nc_id);
    if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar el análisis de causa.' };
    }
    // El primer "por que" y la causa raiz son obligatorios: un analisis
    // vacio convierte el formulario en un tramite y es justo lo que un
    // auditor detecta. Del 2 al 5 son opcionales -- no toda NC necesita
    // cinco niveles para llegar a la causa real.
    if (!String(data.porque_1 || '').trim()) {
      return errorValidacion_('porque_1', 'Empieza el análisis: ¿por qué ocurrió?');
    }
    if (!String(data.causa_raiz || '').trim()) {
      return errorValidacion_('causa_raiz', 'Escribe la causa raíz a la que llegaste.');
    }
    var cambios = { causa_raiz: data.causa_raiz };
    for (var i = 1; i <= 5; i++) {
      if (data['porque_' + i] !== undefined) cambios['porque_' + i] = data['porque_' + i];
    }
    // La referencia normativa a veces solo queda clara despues de analizar
    // la causa; se puede completar o corregir aca sin reabrir "1.-
    // Generalidades".
    if (data.referencia_normativa !== undefined) {
      cambios.referencia_normativa = String(data.referencia_normativa || '').trim();
    }
    var actualizada = actualizarFilaPorId_(SHEETS.SGC_NC, 'nc_id', nc.nc_id, cambios);
    registrarLogSgc_('SGC_NC_CAUSA', nc.correlativo, contexto);
    return actualizada;
  },

  // --- 4) Accion correctiva: tambien una ACTIVIDAD --------------------------
  registrarAccion: function (data, contexto) {
    var nc = buscarNc_(data.nc_id);
    if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden definir la acción correctiva.' };
    }
    // Sin causa raiz, la "accion correctiva" es una corrección disfrazada:
    // ataca el sintoma. Este orden es lo que hace que el ciclo sirva.
    if (!String(nc.causa_raiz || '').trim()) {
      return errorValidacion_('causa_raiz', 'Antes de definir la acción correctiva hay que registrar la causa raíz.');
    }
    var descripcion = String(data.descripcion || '').trim();
    if (!descripcion) return errorValidacion_('descripcion', 'Describe la acción correctiva.');
    if (nc.accion_actividad_id) {
      return errorValidacion_('nc_id', 'Esta no conformidad ya tiene una acción correctiva asignada.');
    }

    var responsable = normalizarEmailSgc_(data.responsable_email) || normalizarEmailSgc_(nc.responsable_email);
    // PRO-06: 20 dias habiles desde la CORRECCION (o desde hoy si la
    // correccion todavia no se cerro).
    var base = nc.correccion_fecha_cierre || new Date().toISOString();
    var plazo = data.fecha_compromiso || sumarDiasHabilesSgc_(base, DIAS_ACCION_NC);

    var tarea = crearTareaSgc_({
      titulo: '[NC ' + nc.correlativo + '] Acción correctiva: ' + descripcion.slice(0, 80),
      descripcion: 'Acción correctiva de la no conformidad ' + nc.correlativo + '.\n\n' + descripcion +
        '\n\nCausa raíz: ' + nc.causa_raiz,
      responsable_email: responsable,
      fecha_compromiso: plazo,
      area_id: nc.area_id,
      origen_tipo: 'NC_ACCION',
      origen_id: nc.nc_id
    }, contexto);
    if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;

    var actualizada = actualizarFilaPorId_(SHEETS.SGC_NC, 'nc_id', nc.nc_id, {
      accion_descripcion: descripcion,
      accion_actividad_id: tarea.actividad_id,
      accion_plazo: plazo,
      estado: 'EN_ACCION'
    });
    registrarLogSgc_('SGC_NC_ACCION', nc.correlativo, contexto);
    return actualizada;
  },

  // --- 5) Cerrar una etapa (decision explicita, nunca automatica) -----------
  cerrarEtapa: function (data, contexto) {
    var nc = buscarNc_(data.nc_id);
    if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden cerrar etapas.' };
    }
    var ahora = new Date().toISOString();

    if (data.etapa === 'CORRECCION') {
      if (!nc.correccion_actividad_id) return errorValidacion_('etapa', 'Todavía no hay corrección asignada.');
      return actualizarFilaPorId_(SHEETS.SGC_NC, 'nc_id', nc.nc_id, {
        correccion_fecha_cierre: data.fecha || ahora
      });
    }
    if (data.etapa === 'ACCION') {
      if (!nc.accion_actividad_id) return errorValidacion_('etapa', 'Todavía no hay acción correctiva asignada.');
      var cierre = data.fecha || ahora;
      return actualizarFilaPorId_(SHEETS.SGC_NC, 'nc_id', nc.nc_id, {
        accion_fecha_cierre: cierre,
        estado: 'EN_VERIFICACION',
        // El reloj de la eficacia parte cuando la accion se implementa
        // (PRO-06: 60 dias habiles despues).
        eficacia_plazo: sumarDiasHabilesSgc_(cierre, DIAS_EFICACIA_NC)
      });
    }
    return errorValidacion_('etapa', 'Etapa inválida.');
  },

  // --- 6) Verificacion de eficacia (y reapertura si no funciono) ------------
  verificarEficacia: function (data, contexto) {
    var nc = buscarNc_(data.nc_id);
    if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden verificar la eficacia.' };
    }
    if (nc.estado !== 'EN_VERIFICACION') {
      return errorValidacion_('nc_id', 'La acción correctiva todavía no está implementada.');
    }
    if (['EFICAZ', 'NO_EFICAZ'].indexOf(data.resultado) === -1) {
      return errorValidacion_('resultado', 'Indica si la acción correctiva fue eficaz o no.');
    }
    if (!String(data.observaciones || '').trim()) {
      return errorValidacion_('observaciones', 'Explica cómo verificaste la eficacia: es la evidencia de que se revisó.');
    }
    var ahora = new Date().toISOString();

    if (data.resultado === 'EFICAZ') {
      var cerrada = actualizarFilaPorId_(SHEETS.SGC_NC, 'nc_id', nc.nc_id, {
        eficacia_fecha: ahora, eficacia_resultado: 'EFICAZ',
        eficacia_observaciones: data.observaciones,
        estado: 'CERRADA', fecha_cierre: ahora, cerrada_por: normalizarEmailSgc_(contexto.email)
      });
      registrarLogSgc_('SGC_NC_CERRADA', nc.correlativo, contexto);
      return cerrada;
    }

    // No fue eficaz: se REABRE con un ciclo nuevo. Se limpian los campos de
    // la accion y la eficacia para volver a recorrer el analisis, pero NO
    // se toca lo ya hecho en el ciclo anterior (queda en el log y en las
    // actividades vinculadas, que nunca se borran).
    var reabierta = actualizarFilaPorId_(SHEETS.SGC_NC, 'nc_id', nc.nc_id, {
      eficacia_fecha: ahora, eficacia_resultado: 'NO_EFICAZ',
      eficacia_observaciones: data.observaciones,
      estado: 'EN_ACCION',
      ciclo: (Number(nc.ciclo) || 1) + 1,
      accion_descripcion: '', accion_actividad_id: '', accion_plazo: '', accion_fecha_cierre: '',
      eficacia_plazo: ''
    });
    registrarLogSgc_('SGC_NC_REABIERTA', nc.correlativo + ' (ciclo ' + reabierta.ciclo + ')', contexto);
    encolarNotificacionApp_(nc.responsable_email, 'SGC_NC', 'No conformidad reabierta',
      nc.correlativo + ': la acción correctiva no fue eficaz, hay que replantearla.',
      'calidad', 'Ver no conformidad', 72);
    return reabierta;
  },

  anular: function (data, contexto) {
    var nc = buscarNc_(data.nc_id);
    if (!nc) return errorValidacion_('nc_id', 'No conformidad no encontrada.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden anular.' };
    }
    if (!String(data.motivo || '').trim()) {
      return errorValidacion_('motivo', 'Anular una no conformidad exige un motivo.');
    }
    registrarLogSgc_('SGC_NC_ANULADA', nc.correlativo + ': ' + data.motivo, contexto);
    // No se borra: queda ANULADA con su motivo en el log. Borrar una NC es
    // exactamente lo que un auditor busca que no se pueda hacer.
    return actualizarFilaPorId_(SHEETS.SGC_NC, 'nc_id', nc.nc_id, {
      estado: 'ANULADA', fecha_cierre: new Date().toISOString(),
      cerrada_por: normalizarEmailSgc_(contexto.email),
      eficacia_observaciones: 'ANULADA: ' + data.motivo
    });
  }
};

// --- avisos de NC vencidas (Fase 3a) ---------------------------------------
//
// SIN TRIGGER PROPIO: se cuelga de la pasada diaria de las 09:00, igual que
// el resto del SGC (ver Triggers.gs y la nota del limite de 20).
//
// ESCALADO, que es la mejora #6 de la propuesta. La especificacion avisa al
// responsable "al dia 8"; si esa persona no actua, la alerta muere ahi. Aca
// el aviso sube solo:
//   vencida            -> responsable + Encargado SGC
//   vencida hace 5+ dias -> ademas, Direccion
// Asi ninguna no conformidad se pierde en silencio, que es exactamente lo
// que un auditor busca.
//
// Cadencia diaria mientras siga vencida: a diferencia de una evaluacion de
// competencias, una NC vencida SI amerita insistir todos los dias.
NoConformidades.recordatorioVencidas = function () {
  var abiertas = leerFilasSeguro_(SHEETS.SGC_NC).filter(function (nc) {
    return esActivoSgc_(nc) && ESTADOS_NC_ABIERTOS.indexOf(nc.estado) !== -1;
  });
  if (!abiertas.length) return { avisos: 0, escaladas: 0 };

  var ahora = new Date();
  var hoy = ahora.toISOString().slice(0, 10);
  var vencidas = [];
  abiertas.forEach(function (nc) {
    var venc = vencimientoNc_(nc);
    if (!venc.plazo) return;
    var dias = Math.floor((ahora - new Date(venc.plazo)) / 86400000);
    if (dias >= 0) vencidas.push({ nc: nc, etapa: venc.etapa, diasVencida: dias });
  });
  if (!vencidas.length) return { avisos: 0, escaladas: 0 };

  var encargados = leerFilasSeguro_(SHEETS.SGC_ROLES)
    .filter(function (r) { return esVerdaderoActivoSgc_(r) && r.rol_sgc === 'ENCARGADO_SGC'; })
    .map(function (r) { return normalizarEmailSgc_(r.usuario_email); });
  var direccion = leerFilasSeguro_(SHEETS.SGC_ROLES)
    .filter(function (r) { return esVerdaderoActivoSgc_(r) && r.rol_sgc === 'DIRECCION'; })
    .map(function (r) { return normalizarEmailSgc_(r.usuario_email); });

  // Agrupado por persona: un correo con todo lo suyo, no uno por NC.
  var porPersona = {};
  function sumar_(email, item) {
    var e = normalizarEmailSgc_(email);
    if (!e) return;
    if (!porPersona[e]) porPersona[e] = [];
    if (porPersona[e].indexOf(item) === -1) porPersona[e].push(item);
  }
  var escaladas = 0;
  vencidas.forEach(function (item) {
    sumar_(item.nc.responsable_email, item);
    encargados.forEach(function (e) { sumar_(e, item); });
    if (item.diasVencida >= DIAS_ESCALADO_NC) {
      escaladas++;
      direccion.forEach(function (e) { sumar_(e, item); });
    }
  });

  var avisos = 0;
  Object.keys(porPersona).forEach(function (email) {
    var lista = porPersona[email];
    var items = lista.map(function (x) {
      return '<li><strong>' + escaparHtmlCorreo_(x.nc.correlativo) + '</strong> — ' +
        escaparHtmlCorreo_(x.etapa) + ' vencida hace ' + x.diasVencida + ' día(s): ' +
        escaparHtmlCorreo_(String(x.nc.descripcion || '').slice(0, 90)) + '</li>';
    }).join('');
    var asunto = 'SIGSO - ' + lista.length + ' no conformidad(es) con plazo vencido';
    var texto = 'Estas no conformidades tienen su plazo vencido:\n' +
      lista.map(function (x) {
        return '- ' + x.nc.correlativo + ' (' + x.etapa + ', vencida hace ' + x.diasVencida + ' día(s))';
      }).join('\n') +
      '\n\nEntra a SIGSO > Calidad > No conformidades.';
    var html = plantillaCorreoHtml_('No conformidades con plazo vencido',
      '<p>Estas no conformidades tienen su <strong>plazo vencido</strong>:</p>' +
      '<ul style="margin:0 0 12px 18px;padding:0;">' + items + '</ul>' +
      '<p>Entra a SIGSO &gt; Calidad &gt; No conformidades.</p>');

    var r = enviarCorreo_('SGC_NC', email, 'SGC_NC_VENCIDA:' + hoy, asunto, texto, null, { htmlBody: html });
    if (r && r.enviado) avisos++;
    encolarNotificacionApp_(email, 'SGC_NC_VENCIDA', 'No conformidades vencidas',
      lista.length + ' no conformidad(es) con plazo vencido.', 'calidad', 'Ver no conformidades', 72);
  });

  return { avisos: avisos, escaladas: escaladas };
};

// --- constantes -------------------------------------------------------------

var FUENTES_NC = ['AUDITORIA_INTERNA', 'AUDITORIA_EXTERNA', 'QUEJA', 'REVISION_DIRECCION', 'PROCESO', 'OTRO'];
// Dias vencida a partir de los cuales el aviso escala a Direccion.
var DIAS_ESCALADO_NC = 5;
var ESTADOS_NC_ABIERTOS = ['ABIERTA', 'EN_CORRECCION', 'EN_ACCION', 'EN_VERIFICACION'];

// Plazos de PRO-06, en DIAS HABILES.
var DIAS_CORRECCION_NC = 10;
var DIAS_ACCION_NC = 20;
var DIAS_EFICACIA_NC = 60;

// --- helpers ----------------------------------------------------------------

function buscarNc_(ncId) {
  if (!ncId) return null;
  var filas = leerFilasSeguro_(SHEETS.SGC_NC);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].nc_id === ncId && esActivoSgc_(filas[i])) return filas[i];
  }
  return null;
}

// Correlativo legible NC-2026-001. Se cuenta sobre las del año en vez de
// usar COUNTERS: el volumen de NC es de decenas al año, no de miles, y asi
// no se agrega un contador mas que mantener.
function siguienteCorrelativoNc_(fecha) {
  var anio = new Date(fecha).getFullYear();
  if (isNaN(anio)) anio = new Date().getFullYear();
  var delAnio = leerFilasSeguro_(SHEETS.SGC_NC).filter(function (nc) {
    var f = new Date(nc.fecha_deteccion || nc.fecha_creacion);
    return !isNaN(f.getTime()) && f.getFullYear() === anio;
  }).length;
  return 'NC-' + anio + '-' + ('00' + (delAnio + 1)).slice(-3);
}

// Suma N DIAS HABILES a una fecha, respetando fin de semana y los feriados
// configurados (CONFIG_FERIADOS). Se apoya en las primitivas que ya usa
// todo SIGSO para el SLA (claveDia_/esDiaHabil_/siguienteDiaClave_ de
// Utils.gs) en vez de reimplementar el calendario.
function sumarDiasHabilesSgc_(desde, dias) {
  var inicio = new Date(desde);
  if (isNaN(inicio.getTime())) return '';
  var tz = getConfig_().timezone;
  var feriadosSet = {};
  (obtenerFeriados_() || []).forEach(function (f) {
    var clave = typeof f === 'string' ? f.slice(0, 10) : claveDia_(new Date(f), tz);
    feriadosSet[clave] = true;
  });

  var clave = claveDia_(inicio, tz);
  var restantes = dias;
  var guarda = 0;
  while (restantes > 0 && guarda < 1000) {
    clave = siguienteDiaClave_(clave);
    if (esDiaHabil_(clave, feriadosSet)) restantes--;
    guarda++;
  }
  // Se devuelve el fin de ese dia habil (23:59 UTC) para que "vence hoy" no
  // se lea como vencido a las 00:01.
  var partes = clave.split('-').map(Number);
  return new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], 23, 59, 59)).toISOString();
}

// Crea la ACTIVIDAD de una correccion o accion correctiva. Delega en
// Actividades.crear (el motor v7.0) -- aca no se reimplementa nada del
// ciclo de vida de una tarea.
function crearTareaSgc_(datos, contexto) {
  var tarea = Actividades.crear({
    titulo: datos.titulo,
    descripcion: datos.descripcion,
    responsable_email: datos.responsable_email,
    fecha_compromiso: datos.fecha_compromiso,
    area_id: datos.area_id || '',
    // P2 = alta: una NC abierta no compite de igual a igual con el resto
    // del trabajo del dia.
    prioridad: 'P2',
    origen: 'ASIGNADA',
    // SIN requiere_validacion a proposito. Con esa marca, "listo" dejaria
    // la tarea EN_REVISION esperando al supervisor -- y despues el
    // Encargado SGC tendria que cerrar ADEMAS la etapa de la NC: dos
    // confirmaciones para lo mismo. La validacion real de que la
    // correccion sirvio es el cierre de etapa de la NC (cerrarEtapa) y,
    // mas adelante, la verificacion de eficacia. Aqui basta con que la
    // persona diga "lo hice".
    requiere_validacion: false,
    sgc_origen_tipo: datos.origen_tipo,
    sgc_origen_id: datos.origen_id
  }, contexto);
  return tarea;
}

// Lo que hace falta saber de la actividad vinculada, sin exponer la fila
// entera de ACTIVIDADES.
function tareaResumen_(actividad) {
  if (!actividad) return null;
  var semaforo = semaforoActividad_(actividad);
  return {
    actividad_id: actividad.actividad_id,
    titulo: actividad.titulo,
    responsable_email: actividad.responsable_email,
    estado: actividad.estado,
    avance_pct: actividad.avance_pct,
    fecha_compromiso: actividad.fecha_compromiso,
    semaforo: semaforo.codigo,
    semaforo_etiqueta: semaforo.etiqueta,
    terminada: actividad.estado === 'TERMINADA'
  };
}

// Vencimiento de la etapa en curso. Derivado, nunca persistido: si se
// guardara, quedaria desfasado en cuanto cambie el estado.
function vencimientoNc_(nc) {
  if (nc.estado === 'ABIERTA' || nc.estado === 'EN_CORRECCION') {
    return { etapa: 'Corrección', plazo: nc.correccion_plazo };
  }
  if (nc.estado === 'EN_ACCION') return { etapa: 'Acción correctiva', plazo: nc.accion_plazo };
  if (nc.estado === 'EN_VERIFICACION') return { etapa: 'Verificación de eficacia', plazo: nc.eficacia_plazo };
  return { etapa: '', plazo: '' };
}

function resumenNc_(nc, actividadesPorId, ahora) {
  var venc = vencimientoNc_(nc);
  var dias = venc.plazo ? Math.ceil((new Date(venc.plazo) - ahora) / 86400000) : null;
  var correccion = nc.correccion_actividad_id ? actividadesPorId[nc.correccion_actividad_id] : null;
  var accion = nc.accion_actividad_id ? actividadesPorId[nc.accion_actividad_id] : null;
  return {
    nc_id: nc.nc_id,
    correlativo: nc.correlativo,
    fuente: nc.fuente,
    referencia_normativa: nc.referencia_normativa || '',
    descripcion: nc.descripcion,
    area_id: nc.area_id,
    responsable_email: nc.responsable_email,
    fecha_deteccion: nc.fecha_deteccion,
    estado: nc.estado,
    ciclo: Number(nc.ciclo) || 1,
    tiene_causa: !!String(nc.causa_raiz || '').trim(),
    etapa_actual: venc.etapa,
    plazo_actual: venc.plazo,
    dias_para_plazo: dias,
    vencida: dias !== null && dias < 0 && ESTADOS_NC_ABIERTOS.indexOf(nc.estado) !== -1,
    // Estado operativo real, tomado de la actividad que la persona ve en
    // "Mi trabajo".
    correccion_terminada: !!correccion && correccion.estado === 'TERMINADA',
    accion_terminada: !!accion && accion.estado === 'TERMINADA'
  };
}

// Indicadores que pide §9.1 de la especificacion para el dashboard.
function indicadoresNc_(todas, ahora) {
  var abiertas = todas.filter(function (nc) { return ESTADOS_NC_ABIERTOS.indexOf(nc.estado) !== -1; });
  var cerradas = todas.filter(function (nc) { return nc.estado === 'CERRADA'; });
  var vencidas = abiertas.filter(function (nc) {
    var venc = vencimientoNc_(nc);
    return venc.plazo && new Date(venc.plazo) < ahora;
  });
  var dias = cerradas.map(function (nc) {
    return (new Date(nc.fecha_cierre) - new Date(nc.fecha_deteccion)) / 86400000;
  }).filter(function (d) { return !isNaN(d) && d >= 0; });
  // El % de eficacia cuenta VERIFICACIONES, no no-conformidades: la fila
  // guarda solo el ultimo resultado, asi que una NC cerrada al segundo
  // intento daria 100% si se contara por NC. El ciclo N implica N-1
  // verificaciones fallidas antes de la actual (ver verificarEficacia).
  var verificadas = 0, eficaces = 0;
  todas.forEach(function (nc) {
    if (!nc.eficacia_resultado) return;
    var esEficaz = nc.eficacia_resultado === 'EFICAZ';
    verificadas += (Number(nc.ciclo) || 1) - 1 + (esEficaz ? 1 : 0);
    if (esEficaz) eficaces += 1;
  });

  return {
    abiertas: abiertas.length,
    cerradas: cerradas.length,
    vencidas: vencidas.length,
    dias_promedio_resolucion: dias.length
      ? Math.round((dias.reduce(function (a, b) { return a + b; }, 0) / dias.length) * 10) / 10
      : null,
    pct_eficacia_positiva: verificadas
      ? Math.round((eficaces / verificadas) * 1000) / 10
      : null
  };
}
