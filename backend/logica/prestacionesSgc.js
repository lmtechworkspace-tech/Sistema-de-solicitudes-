'use strict';

/**
 * prestacionesSgc.js — puerto de backend/backoffice/Prestaciones.gs (SGC
 * ISO 9001, v11.0 Fase 8: evidencia de servicios prestados, §8.1/§8.5/
 * §8.6/§8.7).
 *
 * La última fase del plan y la única con riesgo de escala. Por eso se dejó
 * para el final: con 50 clientes y 40 procesos de servicio, una matriz
 * completa cliente × proceso × mes serían 24.000 filas al año, casi todas
 * vacías, y cada consulta tendría que leerlas todas.
 *
 * Las tres decisiones que la hacen viable (idénticas al .gs):
 * 1) NO se pre-generan filas. Una fila existe cuando alguien registra que
 *    el servicio se prestó.
 * 2) Las consultas van SIEMPRE acotadas. `listar` sin filtro devuelve solo
 *    las últimas (TOPE_PRESTACIONES_SIN_FILTRO) y lo dice.
 * 3) El módulo MIDE su propio volumen y avisa cuando pasa el umbral.
 *
 * El cliente NO se duplica: sale de CAT_CLIENTES, que existe en SIGSO
 * desde la v1.0.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Procesos = require('./procesosSgc');
const NoConformidades = require('./noConformidadesSgc');

const ESTADOS_PRESTACION = ['PRESTADO', 'LIBERADO', 'NO_CONFORME'];

// Cuántas filas devuelve una consulta sin filtro, y a partir de cuántas se
// avisa que conviene archivar el año anterior.
const TOPE_PRESTACIONES_SIN_FILTRO = 100;
const UMBRAL_VOLUMEN_PRESTACIONES = 5000;

function uuid_() { return crypto.randomUUID(); }
// Etapa A del control interno (auditoría de procesos 30-09-2026): cada área
// registra y libera lo suyo. Hasta aquí solo el Encargado del SGC podía, y la
// auditoría observó justamente que en Contabilidad y RR.HH. no queda rastro de
// quién valida (§8.6). Registra el personal del área; libera la jefatura del
// área, nunca sobre lo que ella misma prestó.
const ROLES_DE_AREA = ['OPERATIVO', 'JEFATURA_AREA', 'ENC_ADMIN'];
// Un mes de IVA son ~80 clientes; el tope deja holgura sin permitir que un
// error de pantalla cree miles de filas de una vez.
const TOPE_LOTE = 300;
const RE_PERIODO = /^\d{4}-M(0[1-9]|1[0-2])$/;
// SGC_ROLES.area_id usa claves cortas (RRHH, CONTABILIDAD) y SGC_PROCESOS.area
// el nombre del mapa ('Recursos Humanos'): ambas se llevan a la misma clave.
const ALIAS_AREA = {
  RECURSOSHUMANOS: 'RRHH', RRHH: 'RRHH',
  PREVENCIONDERIESGOS: 'PREVENCION', PREVENCION: 'PREVENCION',
  MARKETINGCORPORATIVO: 'MARKETING', MARKETING: 'MARKETING',
  CONTA: 'CONTABILIDAD', CONTABILIDAD: 'CONTABILIDAD'
};

function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function esActivo_(fila) { return esVerdadero_(fila.activa); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leerSeguro_(db, hoja) { try { return leer_(db, hoja); } catch (err) { return []; } }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function registrarLogSgc_(db, accion, detalle, contexto) {
  try {
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: uuid_(), timestamp: new Date().toISOString(), contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle, ref: 'SGC'
    });
  } catch (err) { /* trazabilidad, no el flujo principal */ }
}

// --- alcance por área ----------------------------------------------------------

function claveArea_(texto) {
  const k = String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');
  return ALIAS_AREA[k] || k;
}

// Procesos de servicio con la clave de su área: un servicio sin área propia
// hereda la del proceso del mapa del que cuelga (así se cargan los DOC-10 a 13).
function procesosServicio_(db) {
  const todos = Procesos.procesosActivos_(db);
  const porId = {};
  todos.forEach((p) => { porId[p.proceso_id] = p; });
  return todos.filter((p) => p.nivel === 'SERVICIO').map((p) => Object.assign({}, p, {
    clave_area: claveArea_(p.area || (porId[p.proceso_padre_id] || {}).area),
    area_nombre: p.area || (porId[p.proceso_padre_id] || {}).area || ''
  }));
}

/**
 * Qué puede hacer la persona con el registro de servicios. El Encargado del
 * SGC (o ADM) gestiona todo; quien tiene un rol del SGC con área opera solo
 * los servicios de esa área, y si es jefatura además libera.
 */
function alcance_(db, contexto) {
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  const rol = Calidad.rolSgc_(db, contexto);
  const veTodo = Calidad.veTodoSgc_(db, contexto, rol, gobierna);
  const areas = [];
  if (ROLES_DE_AREA.indexOf(rol) !== -1) {
    const id = Calidad.areaSgc_(db, contexto);
    if (id) {
      areas.push(claveArea_(id));
      const cat = leerSeguro_(db, 'CAT_AREAS').find((a) => a.area_id === id);
      // En producción CAT_AREAS nombra un área por persona ('RRHH_LISSETH',
      // 'PREVENCION_AMARLLA'): el área es lo que va antes del guion bajo.
      if (cat) {
        areas.push(claveArea_(cat.nombre));
        areas.push(claveArea_(String(cat.nombre || '').split('_')[0]));
      }
    }
  }
  const email = normalizarEmail_(contexto && contexto.email);
  const areasLibera = liberadores_(db).filter((l) => l.usuario_email === email).map((l) => l.area_clave);
  return { gobierna, veTodo, rol, areas, areasLibera, email };
}
function liberadores_(db) {
  return leerSeguro_(db, 'SGC_LIBERADORES').filter(esActivo_).map((l) => ({
    liberador_id: l.liberador_id, area_clave: l.area_clave, area_nombre: l.area_nombre || '',
    usuario_email: normalizarEmail_(l.usuario_email)
  }));
}
function operaProceso_(al, proceso) {
  return al.gobierna || (!!proceso && al.areas.indexOf(proceso.clave_area) !== -1);
}
// Ve el área quien la opera o quien la libera (Lisseth libera RR.HH. con un
// rol de Administración).
function veProceso_(al, proceso) {
  return al.veTodo || operaProceso_(al, proceso) || (!!proceso && al.areasLibera.indexOf(proceso.clave_area) !== -1);
}
// Libera: el Encargado, la jefatura del área o quien esté designado para
// liberar esa área en SGC_LIBERADORES.
function liberaProceso_(al, proceso) {
  if (al.gobierna) return true;
  if (!proceso) return false;
  return (al.rol === 'JEFATURA_AREA' && operaProceso_(al, proceso)) || al.areasLibera.indexOf(proceso.clave_area) !== -1;
}
function puedeLiberarAlgo_(al) {
  return al.gobierna || (al.rol === 'JEFATURA_AREA' && al.areas.length > 0) || al.areasLibera.length > 0;
}
function procesoDe_(db, prestacion) {
  return procesosServicio_(db).find((p) => p.proceso_id === prestacion.proceso_id) || null;
}

// --- helpers -----------------------------------------------------------------

function buscarPrestacion_(db, id) {
  if (!id) return null;
  return leerSeguro_(db, 'SGC_PRESTACIONES').filter((p) => esActivo_(p) && p.prestacion_id === id)[0] || null;
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
    // prestó el servicio no lo invalida, pero es una debilidad y se ve.
    liberada_por_el_mismo: !!p.liberado_por && normalizarEmail_(p.liberado_por) === normalizarEmail_(p.responsable_email),
    nc_id: p.nc_id || '',
    observaciones: p.observaciones || '',
    creado_por: p.creado_por || ''
  };
}

function resumenPrestaciones_(filas) {
  const r = { total: filas.length, prestado: 0, liberado: 0, no_conforme: 0, sin_evidencia: 0, autoliberadas: 0, nc_abiertas: 0 };
  filas.forEach((p) => {
    if (p.estado === 'LIBERADO') r.liberado++;
    else if (p.estado === 'NO_CONFORME') r.no_conforme++;
    else r.prestado++;
    if (!String(p.evidencia || '').trim()) r.sin_evidencia++;
    if (p.liberado_por && normalizarEmail_(p.liberado_por) === normalizarEmail_(p.responsable_email)) r.autoliberadas++;
    if (p.nc_id) r.nc_abiertas++;
  });
  return r;
}

/**
 * El módulo mide cuánto pesa y avisa antes de que duela. No se puede
 * evitar que una tabla crezca, pero sí se puede decir a tiempo que hay
 * que archivar el año anterior.
 */
function volumenPrestaciones_(todas) {
  const porAnio = {};
  todas.forEach((p) => {
    const a = String(p.periodo || p.fecha_prestacion || '').slice(0, 4);
    if (!a) return;
    porAnio[a] = (porAnio[a] || 0) + 1;
  });
  return {
    filas: todas.length,
    umbral: UMBRAL_VOLUMEN_PRESTACIONES,
    supera_umbral: todas.length >= UMBRAL_VOLUMEN_PRESTACIONES,
    por_anio: Object.keys(porAnio).sort().map((a) => ({ anio: a, total: porAnio[a] })),
    aviso: todas.length >= UMBRAL_VOLUMEN_PRESTACIONES
      ? 'El registro pasó las ' + UMBRAL_VOLUMEN_PRESTACIONES + ' filas. Conviene archivar los años ' +
        'cerrados en otra tabla: cada consulta lee la hoja completa, y a partir de aquí se empieza a notar.'
      : ''
  };
}

function validarPrestacion_(db, data) {
  const d = data || {};
  const clienteId = String(d.cliente_id || '').trim();
  if (!clienteId) return { error: 'Indica para qué cliente se prestó el servicio.' };
  const cliente = leerSeguro_(db, 'CAT_CLIENTES').filter((c) => c.cliente_id === clienteId)[0];
  if (!cliente) return { error: 'El cliente no está en el catálogo de SIGSO.' };

  const procesoId = String(d.proceso_id || '').trim();
  if (!procesoId) return { error: 'Indica qué proceso de servicio se prestó.' };
  const proceso = Procesos.procesosActivos_(db).filter((p) => p.proceso_id === procesoId)[0];
  if (!proceso) return { error: 'El proceso no existe. Carga primero los procesos de servicio (Fase 4).' };
  if (proceso.nivel !== 'SERVICIO') {
    return { error: 'Solo se registran prestaciones de procesos de SERVICIO, no de los del mapa.' };
  }

  const fecha = String(d.fecha_prestacion || '').trim().slice(0, 10);
  if (!fecha) return { error: 'Indica la fecha en que se prestó el servicio.' };

  const responsable = normalizarEmail_(d.responsable_email);
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

// --- acciones ----------------------------------------------------------------

function listar(db, data, contexto) {
  const al = alcance_(db, contexto);
  if (!(al.veTodo || al.areas.length || al.areasLibera.length)) {
    return { _forbidden: true, message: 'No tienes acceso al registro de servicios prestados.' };
  }
  // Quien entra por su área ve solo los servicios de su área.
  const procesos = procesosServicio_(db).filter((p) => veProceso_(al, p));
  const visibles_ = {};
  procesos.forEach((p) => { visibles_[p.proceso_id] = true; });

  const filtros = data || {};
  const periodo = String(filtros.periodo || '').trim();
  const clienteId = String(filtros.cliente_id || '').trim();
  const procesoId = String(filtros.proceso_id || '').trim();
  const estado = String(filtros.estado || '').trim().toUpperCase();

  const todas = leerSeguro_(db, 'SGC_PRESTACIONES').filter((p) => esActivo_(p) && (al.veTodo || visibles_[p.proceso_id]));

  const filtradas = todas.filter((p) => {
    if (periodo && String(p.periodo || '') !== periodo) return false;
    if (clienteId && p.cliente_id !== clienteId) return false;
    if (procesoId && p.proceso_id !== procesoId) return false;
    if (estado && p.estado !== estado) return false;
    return true;
  });

  // Sin filtro no se devuelve todo: en un año de operación serían miles de
  // filas viajando al navegador para nada.
  const acotada = !periodo && !clienteId && !procesoId;
  let visibles = filtradas.slice().sort((a, b) => String(b.fecha_prestacion || '').localeCompare(String(a.fecha_prestacion || '')));
  if (acotada) visibles = visibles.slice(0, TOPE_PRESTACIONES_SIN_FILTRO);

  const clientes = leerSeguro_(db, 'CAT_CLIENTES').filter((c) => esVerdadero_(c.activo));

  // Áreas con servicios y quién libera cada una: se muestra a todos los que
  // ven el área, y lo cambia el administrador.
  const areasServicio = {};
  procesosServicio_(db).forEach((p) => {
    if (p.clave_area && !areasServicio[p.clave_area]) areasServicio[p.clave_area] = p.area_nombre || p.clave_area;
  });
  const todosLiberadores = liberadores_(db);
  const visiblesArea = {};
  procesos.forEach((p) => { visiblesArea[p.clave_area] = true; });
  const esAdmin = Calidad.esAdminSgc_(contexto);

  return {
    puede_gestionar: al.gobierna,
    puede_registrar: procesos.some((p) => operaProceso_(al, p)),
    puede_liberar: puedeLiberarAlgo_(al),
    puede_asignar_liberadores: esAdmin,
    liberadores: Object.keys(areasServicio).filter((k) => esAdmin || visiblesArea[k]).map((k) => ({
      area_clave: k, area_nombre: areasServicio[k],
      emails: todosLiberadores.filter((l) => l.area_clave === k).map((l) => l.usuario_email)
    })),
    yo: al.email,
    tope_lote: TOPE_LOTE,
    // Lo que hay para elegir en los formularios: procesos de servicio de la
    // Fase 4 y clientes del catálogo que ya existía.
    procesos: procesos.map((p) => ({
      proceso_id: p.proceso_id, codigo: p.codigo, nombre: p.nombre, area: p.clave_area || '',
      registra: operaProceso_(al, p), libera: liberaProceso_(al, p)
    })),
    clientes: clientes.map((c) => ({ cliente_id: c.cliente_id, nombre: c.razon_social, rut: c.rut || '' })),
    estados: ESTADOS_PRESTACION,
    filtros: { periodo, cliente_id: clienteId, proceso_id: procesoId, estado },
    acotada,
    tope: TOPE_PRESTACIONES_SIN_FILTRO,
    total_filtrado: filtradas.length,
    prestaciones: visibles.map(formatearPrestacion_),
    resumen: resumenPrestaciones_(filtradas),
    volumen: volumenPrestaciones_(todas)
  };
}

/**
 * Registra que un servicio se prestó. No exige período: los DOC-10 a 13
 * distinguen servicios mensuales de puntuales, y forzar un período a uno
 * puntual obligaría a inventarlo.
 */
function registrar(db, data, contexto) {
  const al = alcance_(db, contexto);
  if (!al.gobierna && !al.areas.length) {
    return { _forbidden: true, message: 'Registran prestaciones el Encargado del SGC y el personal de cada área.' };
  }

  const val = validarPrestacion_(db, data);
  if (val.error) return { ok: false, message: val.error };
  if (!operaProceso_(al, procesosServicio_(db).find((p) => p.proceso_id === val.datos.proceso_id))) {
    return { _forbidden: true, message: 'Ese servicio es de otra área: lo registra el personal de esa área.' };
  }

  // Un proceso MENSUAL no puede tener dos prestaciones del mismo período
  // para el mismo cliente: sería contar dos veces el mismo servicio.
  if (val.datos.periodo) {
    const repetida = leerSeguro_(db, 'SGC_PRESTACIONES').filter((p) =>
      esActivo_(p) && p.cliente_id === val.datos.cliente_id &&
      p.proceso_id === val.datos.proceso_id && String(p.periodo || '') === val.datos.periodo)[0];
    if (repetida) {
      return {
        ok: false,
        message: 'Ya hay una prestación de ' + val.datos.proceso_codigo + ' para ese cliente en ' +
          val.datos.periodo + '. Edítala en vez de registrar otra.'
      };
    }
  }

  const ahora = new Date().toISOString();
  const campos = val.datos;
  campos.prestacion_id = uuid_();
  campos.estado = 'PRESTADO';
  campos.liberado_por = '';
  campos.fecha_liberacion = '';
  campos.nc_id = '';
  campos.creado_por = (contexto && contexto.email) || '';
  campos.fecha_creacion = ahora;
  campos.activa = true;
  agregarFila_(db, 'SGC_PRESTACIONES', campos);

  registrarLogSgc_(db, 'SGC_PRESTACION_REGISTRADA',
    campos.proceso_codigo + ' → ' + campos.cliente_nombre + (campos.periodo ? ' (' + campos.periodo + ')' : ''), contexto);
  return { ok: true, prestacion_id: campos.prestacion_id, message: 'Prestación registrada.' };
}

/**
 * §8.6: la liberación. La cláusula pide trazabilidad A LA PERSONA que
 * autoriza, así que se guarda quién y cuándo, no un simple "liberado".
 *
 * Si quien libera es quien prestó, se permite pero se ANOTA: el DOC-01
 * dice que libera la jefatura del área, y en un equipo de 14 personas eso
 * casi siempre es alguien distinto. No se bloquea porque ningún documento
 * lo prohíbe, pero la matriz de cobertura lo muestra.
 */
// Quién firma la liberación: el Encargado del SGC puede registrar la que
// autorizó otra persona (por ejemplo, una jefatura que la dio por correo); la
// jefatura de área libera siempre a su propio nombre.
function quienLibera_(al, data, contexto) {
  return al.gobierna ? normalizarEmail_((data && data.liberado_por) || (contexto && contexto.email)) : al.email;
}
function fechaLiberacion_(data) {
  const hoy = new Date().toISOString().slice(0, 10);
  const f = String((data && data.fecha_liberacion) || hoy).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return { error: 'La fecha de liberación no es válida.' };
  if (f > hoy) return { error: 'La liberación no puede quedar con fecha futura.' };
  return { fecha: f };
}
// Por qué una prestación no se puede liberar ahora ('' si se puede).
function impedimentoLiberar_(al, p, proceso, quien) {
  if (!liberaProceso_(al, proceso)) return 'Es de otra área.';
  if (p.estado === 'LIBERADO') return 'Ya estaba liberada.';
  if (p.estado === 'NO_CONFORME') return 'Es una salida no conforme: primero hay que tratarla (§8.7).';
  if (!al.gobierna && quien === normalizarEmail_(p.responsable_email)) {
    return 'La prestaste tú: la libera otra jefatura o el Encargado del SGC (§8.6).';
  }
  return '';
}

function liberar(db, data, contexto) {
  const al = alcance_(db, contexto);
  if (!puedeLiberarAlgo_(al)) {
    return { _forbidden: true, message: 'Libera la jefatura del área o el Encargado del SGC.' };
  }
  const p = buscarPrestacion_(db, data && data.prestacion_id);
  if (!p) return { ok: false, message: 'No se encontró la prestación.' };
  const proceso = procesoDe_(db, p);
  if (!liberaProceso_(al, proceso)) {
    return { _forbidden: true, message: 'Ese servicio es de otra área: lo libera su jefatura.' };
  }
  if (p.estado === 'LIBERADO') return { ok: false, message: 'Esta prestación ya está liberada.' };
  if (p.estado === 'NO_CONFORME') {
    return { ok: false, message: 'Una salida no conforme no se libera: primero hay que tratarla (§8.7).' };
  }

  const quien = quienLibera_(al, data, contexto);
  if (!quien) return { ok: false, message: 'Indica quién autoriza la liberación.' };
  const motivo = impedimentoLiberar_(al, p, proceso, quien);
  if (motivo) return { ok: false, message: 'No se puede liberar. ' + motivo };
  const f = fechaLiberacion_(data);
  if (f.error) return { ok: false, message: f.error };

  actualizarFilaPorId_(db, 'SGC_PRESTACIONES', 'prestacion_id', p.prestacion_id, {
    estado: 'LIBERADO',
    liberado_por: quien,
    fecha_liberacion: f.fecha
  });
  registrarLogSgc_(db, 'SGC_PRESTACION_LIBERADA', p.proceso_codigo + ' → ' + p.cliente_nombre + ' liberada por ' + quien, contexto);

  const mismaPersona = quien === normalizarEmail_(p.responsable_email);
  return {
    ok: true,
    message: 'Servicio liberado.' + (mismaPersona
      ? ' Aviso: quien liberó es quien prestó el servicio; el DOC-01 dice que libera la jefatura del área.'
      : '')
  };
}

/**
 * §8.7: salida no conforme. Marcarla es el primer paso; el segundo,
 * opcional, es abrir la NC con el mismo eslabón que ya usan las quejas y
 * los hallazgos de auditoría.
 */
function marcarNoConforme(db, data, contexto) {
  const al = alcance_(db, contexto);
  if (!puedeLiberarAlgo_(al)) {
    return { _forbidden: true, message: 'Marcan una salida no conforme la jefatura del área o el Encargado del SGC.' };
  }
  const p = buscarPrestacion_(db, data && data.prestacion_id);
  if (!p) return { ok: false, message: 'No se encontró la prestación.' };
  if (!liberaProceso_(al, procesoDe_(db, p))) {
    return { _forbidden: true, message: 'Ese servicio es de otra área: lo revisa su jefatura.' };
  }

  const motivo = String((data && data.observaciones) || '').trim();
  if (!motivo) {
    return { ok: false, message: 'Describe en qué no conformó el servicio: sin eso no hay nada que tratar.' };
  }

  actualizarFilaPorId_(db, 'SGC_PRESTACIONES', 'prestacion_id', p.prestacion_id, {
    estado: 'NO_CONFORME',
    observaciones: motivo,
    // Una salida no conforme deja de estar liberada: §8.7 pide que no se
    // entregue hasta corregirla.
    liberado_por: '',
    fecha_liberacion: ''
  });
  registrarLogSgc_(db, 'SGC_SALIDA_NO_CONFORME', p.proceso_codigo + ' → ' + p.cliente_nombre + ': ' + motivo.slice(0, 80), contexto);
  return { ok: true, message: 'Marcada como salida no conforme.' };
}

function abrirNoConformidad(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) {
    return { _forbidden: true, message: 'Solo el Encargado del SGC puede abrir la no conformidad.' };
  }
  const p = buscarPrestacion_(db, data && data.prestacion_id);
  if (!p) return { ok: false, message: 'No se encontró la prestación.' };
  if (p.estado !== 'NO_CONFORME') {
    return { ok: false, message: 'Primero marca la prestación como salida no conforme.' };
  }
  if (p.nc_id) return { ok: false, message: 'Esta salida no conforme ya tiene su no conformidad.' };

  const responsable = normalizarEmail_((data && data.responsable_email) || p.responsable_email);
  if (!responsable) return { ok: false, message: 'Asigna un responsable para la no conformidad.' };

  const nc = NoConformidades.crear(db, {
    descripcion: 'Salida no conforme en ' + p.proceso_codigo + ' — ' + p.proceso_nombre +
      ' para ' + p.cliente_nombre + (p.periodo ? ' (' + p.periodo + ')' : '') + '. ' + (p.observaciones || ''),
    // La fuente PROCESO ya existía en el catálogo de NC: no hizo falta
    // inventar una nueva para las salidas no conformes.
    fuente: 'PROCESO',
    origen_ref: p.prestacion_id,
    referencia_normativa: '8.7',
    responsable_email: responsable,
    fecha_deteccion: p.fecha_prestacion
  }, contexto);
  if (nc && (nc._validationError || nc._forbidden)) return nc;

  actualizarFilaPorId_(db, 'SGC_PRESTACIONES', 'prestacion_id', p.prestacion_id, { nc_id: nc.nc_id });
  registrarLogSgc_(db, 'SGC_SALIDA_NC_ABIERTA', p.proceso_codigo + ' → ' + nc.correlativo, contexto);
  return { ok: true, nc_id: nc.nc_id, correlativo: nc.correlativo, message: 'No conformidad ' + nc.correlativo + ' abierta.' };
}

function anular(db, data, contexto) {
  const al = alcance_(db, contexto);
  const p = buscarPrestacion_(db, data && data.prestacion_id);
  // Quien registró por error puede deshacerlo mientras nadie lo haya liberado;
  // una vez liberado ya es evidencia, y eso solo lo anula el Encargado del SGC.
  const esSuyoSinLiberar = !!p && p.estado === 'PRESTADO' && normalizarEmail_(p.creado_por) === al.email &&
    operaProceso_(al, procesoDe_(db, p));
  if (!al.gobierna && !esSuyoSinLiberar) {
    return { _forbidden: true, message: 'Anula el Encargado del SGC, o quien la registró mientras no esté liberada.' };
  }
  if (!p) return { ok: false, message: 'No se encontró la prestación.' };
  actualizarFilaPorId_(db, 'SGC_PRESTACIONES', 'prestacion_id', p.prestacion_id, { activa: false });
  registrarLogSgc_(db, 'SGC_PRESTACION_ANULADA', p.proceso_codigo + ' → ' + p.cliente_nombre, contexto);
  return { ok: true, message: 'Prestación anulada.' };
}

// --- lotes (Etapa A del control interno) -----------------------------------------

function idsUnicos_(lista) {
  if (!Array.isArray(lista)) return [];
  const vistos = {};
  return lista.map((x) => String(x || '').trim()).filter((x) => {
    if (!x || vistos[x]) return false;
    vistos[x] = true;
    return true;
  });
}
function enTransaccion_(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (err) { db.exec('ROLLBACK'); throw err; }
}

/**
 * Registra de una vez el servicio mensual de un proceso para varios clientes
 * (lo que hoy es una hoja mensual de la matriz: ~80 clientes de IVA, ~90 de
 * contabilización). Solo servicios con período: uno puntual se registra de a
 * uno. Lo ya registrado en el período se informa y no se duplica.
 */
function registrarLote(db, data, contexto) {
  const al = alcance_(db, contexto);
  if (!al.gobierna && !al.areas.length) {
    return { _forbidden: true, message: 'Registran prestaciones el Encargado del SGC y el personal de cada área.' };
  }
  const d = data || {};
  const proceso = procesosServicio_(db).find((p) => p.proceso_id === String(d.proceso_id || '').trim());
  if (!proceso) return { ok: false, message: 'Elige el proceso de servicio.' };
  if (!operaProceso_(al, proceso)) {
    return { _forbidden: true, message: 'Ese servicio es de otra área: lo registra el personal de esa área.' };
  }
  const periodo = String(d.periodo || '').trim();
  if (!RE_PERIODO.test(periodo)) {
    return { ok: false, message: 'El registro por lote es para servicios mensuales: indica el período.' };
  }
  const ids = idsUnicos_(d.cliente_ids);
  if (!ids.length) return { ok: false, message: 'Marca al menos un cliente.' };
  if (ids.length > TOPE_LOTE) {
    return { ok: false, message: 'Son ' + ids.length + ' clientes y el máximo por vez es ' + TOPE_LOTE + '. Divide el registro en dos.' };
  }
  const fecha = String(d.fecha_prestacion || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, message: 'Indica la fecha en que se prestó el servicio.' };
  const responsable = normalizarEmail_(d.responsable_email || (contexto && contexto.email));
  if (!responsable) return { ok: false, message: 'Indica quién prestó el servicio.' };

  const clientes = {};
  leerSeguro_(db, 'CAT_CLIENTES').forEach((c) => { clientes[c.cliente_id] = c; });
  const yaEstan = {};
  leerSeguro_(db, 'SGC_PRESTACIONES').forEach((p) => {
    if (esActivo_(p) && p.proceso_id === proceso.proceso_id && String(p.periodo || '') === periodo) yaEstan[p.cliente_id] = true;
  });

  const ahora = new Date().toISOString();
  const omitidas = [];
  let creadas = 0;
  enTransaccion_(db, () => {
    ids.forEach((id) => {
      const c = clientes[id];
      if (!c) { omitidas.push({ cliente_id: id, cliente_nombre: '', motivo: 'No está en el catálogo de clientes.' }); return; }
      if (yaEstan[id]) { omitidas.push({ cliente_id: id, cliente_nombre: c.razon_social || '', motivo: 'Ya estaba registrado en ese período.' }); return; }
      agregarFila_(db, 'SGC_PRESTACIONES', {
        prestacion_id: uuid_(), cliente_id: id, cliente_nombre: c.razon_social || '',
        proceso_id: proceso.proceso_id, proceso_codigo: proceso.codigo || '', proceso_nombre: proceso.nombre || '',
        periodo, fecha_prestacion: fecha, responsable_email: responsable,
        estado: 'PRESTADO', evidencia: String(d.evidencia || '').trim(),
        liberado_por: '', fecha_liberacion: '', nc_id: '', observaciones: String(d.observaciones || '').trim(),
        creado_por: al.email, fecha_creacion: ahora, activa: true
      });
      yaEstan[id] = true;
      creadas++;
    });
  });

  registrarLogSgc_(db, 'SGC_PRESTACION_LOTE', proceso.codigo + ' ' + periodo + ': ' + creadas + ' registradas, ' + omitidas.length + ' omitidas', contexto);
  return {
    ok: true, creadas, omitidas,
    message: creadas + (creadas === 1 ? ' prestación registrada' : ' prestaciones registradas') +
      (omitidas.length ? '; ' + omitidas.length + (omitidas.length === 1 ? ' omitida.' : ' omitidas.') : '.')
  };
}

/**
 * Libera varias prestaciones de una vez (la revisión mensual de la jefatura).
 * Lo que no se puede liberar no frena al resto: vuelve en "omitidas" con el
 * motivo, para que nada quede sin liberar sin que se sepa por qué.
 */
function liberarLote(db, data, contexto) {
  const al = alcance_(db, contexto);
  if (!puedeLiberarAlgo_(al)) {
    return { _forbidden: true, message: 'Libera la jefatura del área o el Encargado del SGC.' };
  }
  const ids = idsUnicos_(data && data.prestacion_ids);
  if (!ids.length) return { ok: false, message: 'Marca al menos una prestación.' };
  if (ids.length > TOPE_LOTE) return { ok: false, message: 'El máximo por vez es ' + TOPE_LOTE + '.' };
  const quien = quienLibera_(al, data, contexto);
  if (!quien) return { ok: false, message: 'Indica quién autoriza la liberación.' };
  const f = fechaLiberacion_(data);
  if (f.error) return { ok: false, message: f.error };

  const procesos = {};
  procesosServicio_(db).forEach((p) => { procesos[p.proceso_id] = p; });
  const filas = {};
  leerSeguro_(db, 'SGC_PRESTACIONES').forEach((p) => { if (esActivo_(p)) filas[p.prestacion_id] = p; });

  const omitidas = [];
  let liberadas = 0, autoliberadas = 0;
  enTransaccion_(db, () => {
    ids.forEach((id) => {
      const p = filas[id];
      if (!p) { omitidas.push({ prestacion_id: id, cliente_nombre: '', motivo: 'No se encontró.' }); return; }
      const motivo = impedimentoLiberar_(al, p, procesos[p.proceso_id] || null, quien);
      if (motivo) { omitidas.push({ prestacion_id: id, cliente_nombre: p.cliente_nombre || '', motivo }); return; }
      actualizarFilaPorId_(db, 'SGC_PRESTACIONES', 'prestacion_id', id, { estado: 'LIBERADO', liberado_por: quien, fecha_liberacion: f.fecha });
      if (quien === normalizarEmail_(p.responsable_email)) autoliberadas++;
      liberadas++;
    });
  });

  registrarLogSgc_(db, 'SGC_PRESTACION_LIBERADA_LOTE', liberadas + ' liberadas por ' + quien + ', ' + omitidas.length + ' omitidas', contexto);
  return {
    ok: true, liberadas, omitidas, autoliberadas,
    message: liberadas + (liberadas === 1 ? ' prestación liberada' : ' prestaciones liberadas') +
      (omitidas.length ? '; ' + omitidas.length + ' sin liberar (ver el motivo).' : '.') +
      (autoliberadas ? ' Aviso: ' + autoliberadas + ' quedaron liberadas por quien las prestó.' : '')
  };
}

// --- quién libera cada área ------------------------------------------------------

const MAX_LIBERADORES_POR_AREA = 5;

/**
 * Fija quién libera los servicios de cada área. Es un acceso, así que lo
 * reparte solo el administrador (mismo criterio que los roles del SGC).
 * data.areas: [{ area_clave, emails: [...] }]; cada área enviada queda
 * exactamente con esa lista (vacía = nadie más que la jefatura del área).
 */
function guardarLiberadores(db, data, contexto) {
  if (!Calidad.esAdminSgc_(contexto)) {
    return { _forbidden: true, message: 'Solo el administrador asigna quién libera cada área.' };
  }
  const nombres = {};
  procesosServicio_(db).forEach((p) => { if (p.clave_area) nombres[p.clave_area] = p.area_nombre || p.clave_area; });
  const pedidas = Array.isArray(data && data.areas) ? data.areas : [];
  if (!pedidas.length) return { ok: false, message: 'No llegó ninguna área.' };

  const planes = [];
  for (const a of pedidas) {
    const clave = claveArea_(a && a.area_clave);
    if (!nombres[clave]) return { ok: false, message: 'El área "' + ((a && a.area_clave) || '') + '" no tiene servicios en el mapa de procesos.' };
    const emails = idsUnicos_((Array.isArray(a.emails) ? a.emails : []).map(normalizarEmail_));
    if (emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) return { ok: false, message: 'Revisa los correos de ' + nombres[clave] + '.' };
    if (emails.length > MAX_LIBERADORES_POR_AREA) return { ok: false, message: 'Máximo ' + MAX_LIBERADORES_POR_AREA + ' personas por área.' };
    planes.push({ clave, emails });
  }

  const actuales = leerSeguro_(db, 'SGC_LIBERADORES').filter(esActivo_);
  const ahora = new Date().toISOString();
  let altas = 0, bajas = 0;
  enTransaccion_(db, () => {
    planes.forEach((pl) => {
      const deArea = actuales.filter((l) => l.area_clave === pl.clave);
      deArea.forEach((l) => {
        if (pl.emails.indexOf(normalizarEmail_(l.usuario_email)) === -1) {
          actualizarFilaPorId_(db, 'SGC_LIBERADORES', 'liberador_id', l.liberador_id, { activa: false });
          bajas++;
        }
      });
      pl.emails.forEach((e) => {
        if (deArea.some((l) => normalizarEmail_(l.usuario_email) === e)) return;
        agregarFila_(db, 'SGC_LIBERADORES', {
          liberador_id: uuid_(), area_clave: pl.clave, area_nombre: nombres[pl.clave], usuario_email: e,
          creado_por: normalizarEmail_(contexto && contexto.email), fecha_creacion: ahora, activa: true
        });
        altas++;
      });
    });
  });
  registrarLogSgc_(db, 'SGC_LIBERADORES', planes.map((p) => p.clave + ': ' + (p.emails.join(', ') || '—')).join(' · '), contexto);
  return { ok: true, altas, bajas, message: altas || bajas ? 'Quién libera, actualizado.' : 'Sin cambios.' };
}

// Para otros módulos (Control interno): ¿esta persona libera el área? Misma
// regla que aquí: Encargado/ADM, jefatura del área o designada en SGC_LIBERADORES.
function liberaArea_(db, contexto, area) {
  const al = alcance_(db, contexto);
  const clave = claveArea_(area);
  return al.gobierna || (al.rol === 'JEFATURA_AREA' && al.areas.indexOf(clave) !== -1) || al.areasLibera.indexOf(clave) !== -1;
}
function liberadoresDeArea_(db, area) {
  const clave = claveArea_(area);
  return liberadores_(db).filter((l) => l.area_clave === clave).map((l) => l.usuario_email);
}
function gobiernaLiberacion_(db, contexto) { return alcance_(db, contexto).gobierna; }

module.exports = {
  listar, registrar, registrarLote, liberar, liberarLote, marcarNoConforme, abrirNoConformidad, anular, guardarLiberadores,
  claveArea_, liberaArea_, liberadoresDeArea_, gobiernaLiberacion_
};
