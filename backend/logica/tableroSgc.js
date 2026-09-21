'use strict';

/**
 * tableroSgc.js — puerto de backend/backoffice/Tablero.gs (SGC ISO 9001,
 * v11.0 Fase 7: el centro de control del SGC).
 *
 * Va al final del plan a propósito: un tablero solo puede mostrar lo que
 * las fases anteriores producen. Con las seis primeras hechas, ya hay de
 * qué hablar -- alcance, contexto, riesgos, procesos, documentos,
 * indicadores, NC, auditorías, quejas, proveedores y revisión por la
 * dirección.
 *
 * Cuatro decisiones (idénticas al .gs):
 * 1) NO hay un porcentaje nuevo. El % de salud es el MISMO que calcula la
 *    matriz de cobertura, reusado (`MatrizCobertura.matrizCalculada_`).
 *    Dos números distintos llamados "avance del SGC" en el mismo producto
 *    es exactamente lo que hace que nadie confíe en ninguno.
 * 2) La salud se agrupa POR CAPÍTULO DE LA NORMA (4 a 10), reusando
 *    `MatrizCobertura.saludPorCapitulo_` -- nunca duplicado.
 * 3) Se declara explícito que es un INDICADOR INTERNO DE GESTIÓN, no un
 *    porcentaje oficial de certificación.
 * 4) Las alertas son ACCIONABLES: cada una sabe a qué sección lleva.
 *
 * NO se porta la capa de CacheService (TTL 6h + invalidación al escribir
 * cualquier hoja del SGC) -- mismo criterio que Dashboard/Sesiones: esa
 * caché existía para evitar ~23 viajes de red a Sheets; en SQLite local
 * recalcular todo en cada visita es barato (medido en los demás módulos:
 * microsegundos, no cientos de milisegundos). `resumen` calcula fresco
 * cada vez; no hay `refrescarCache` porque no hay nada que refrescar.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Alcance = require('./alcanceSgc');
const { valorarRiesgo_ } = require('./riesgosSgc');
const MatrizCobertura = require('./matrizCoberturaSgc');

const SEVERIDAD_ALERTA = { CRITICA: 'CRITICA', ALTA: 'ALTA', MEDIA: 'MEDIA' };
// Días de anticipación con que se avisa de algo que vence.
const DIAS_AVISO_TABLERO = 60;

function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function esActivo_(fila) { return esVerdadero_(fila.activa); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leerSeguro_(db, hoja) { try { return leer_(db, hoja); } catch (err) { return []; } }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function mesesDesde_(claveFecha) {
  if (!claveFecha) return null;
  const partes = String(claveFecha).slice(0, 10).split('-');
  if (partes.length !== 3) return null;
  const desde = Date.UTC(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
  if (!isFinite(desde)) return null;
  const dias = Math.floor((Date.now() - desde) / 86400000);
  return Math.floor(dias / 30.4375);
}
// El día, en el MISMO formato con el que el tablero compara los plazos.
function hoyClaveTablero_() { return new Date().toISOString().slice(0, 10); }

/**
 * El cuerpo del tablero: todo lo que es igual para todo el mundo (ningún
 * campo que dependa de quién mira -- eso lo pega encima `resumen`).
 */
function cuerpoTablero_(db) {
  const hoy = new Date();
  const hoyClave = hoyClaveTablero_();
  const limiteAviso = new Date(hoy.getTime() + DIAS_AVISO_TABLERO * 86400000).toISOString().slice(0, 10);

  const docs = leerSeguro_(db, 'SGC_DOCUMENTOS').filter(esActivo_);
  const acuses = leerSeguro_(db, 'SGC_DOC_ACUSES');
  const destinatarios = leerSeguro_(db, 'SGC_DOC_DESTINATARIOS');
  const ncs = leerSeguro_(db, 'SGC_NC').filter(esActivo_);
  const auditorias = leerSeguro_(db, 'SGC_AUDITORIAS').filter(esActivo_);
  const revisiones = leerSeguro_(db, 'SGC_REVISIONES').filter(esActivo_);
  const quejas = leerSeguro_(db, 'SGC_QUEJAS').filter(esActivo_);
  const riesgos = leerSeguro_(db, 'SGC_RIESGOS').filter(esActivo_);
  const procesos = leerSeguro_(db, 'SGC_PROCESOS').filter(esActivo_);
  const contextoFilas = leerSeguro_(db, 'SGC_CONTEXTO').filter(esActivo_);
  const partes = leerSeguro_(db, 'SGC_PARTES_INTERESADAS').filter(esActivo_);
  const indicadores = leerSeguro_(db, 'SGC_INDICADORES').filter(esActivo_);
  const lecturas = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').filter(esActivo_);
  const evaluaciones = leerSeguro_(db, 'SGC_EVALUACIONES');
  const personas = leerSeguro_(db, 'SGC_PERSONAS').filter(esActivo_);
  const descriptores = leerSeguro_(db, 'SGC_DESCRIPTORES');
  const inducciones = leerSeguro_(db, 'SGC_INDUCCIONES');
  const provEval = leerSeguro_(db, 'SGC_PROVEEDOR_EVALUACIONES');
  const proveedores = leerSeguro_(db, 'SGC_PROVEEDORES').filter(esActivo_);
  const alcance = Alcance.alcanceVigente_(db);

  const alertas = [];
  const hitos = [];

  function alerta(sev, titulo, detalle, seccion, total) {
    if (!total) return;
    alertas.push({ severidad: sev, titulo, detalle, seccion, total });
  }
  function hito(fecha, titulo, seccion) {
    const f = String(fecha || '').slice(0, 10);
    if (!f || f < hoyClave) return;
    hitos.push({ fecha: f, titulo, seccion });
  }

  // --- documentos ------------------------------------------------------
  const vigentes = docs.filter((d) => d.estado === 'VIGENTE');
  const docsVencidos = vigentes.filter((d) => {
    const p = String(d.proxima_revision || '').slice(0, 10);
    return p && p < hoyClave;
  });
  const docsPorVencer = vigentes.filter((d) => {
    const p = String(d.proxima_revision || '').slice(0, 10);
    return p && p >= hoyClave && p <= limiteAviso;
  });
  alerta(SEVERIDAD_ALERTA.CRITICA, 'Documentos con la revisión vencida',
    'Su fecha de próxima revisión ya pasó: para el auditor, un documento sin revisar en plazo es información documentada fuera de control.',
    'documentos', docsVencidos.length);
  alerta(SEVERIDAD_ALERTA.MEDIA, 'Documentos por revisar',
    'Vencen dentro de los próximos ' + DIAS_AVISO_TABLERO + ' días.',
    'documentos', docsPorVencer.length);
  docsPorVencer.slice(0, 10).forEach((d) => {
    hito(d.proxima_revision, 'Revisar ' + d.codigo + ' — ' + d.nombre, 'documentos');
  });

  // Acuses pendientes con el plazo pasado.
  const acusadoPor = {};
  acuses.forEach((a) => { acusadoPor[a.documento_id + '|' + a.version + '|' + normalizarEmail_(a.usuario_email)] = true; });
  let acusesVencidos = 0;
  vigentes.forEach((d) => {
    if (!esVerdadero_(d.requiere_acuse)) return;
    const limite = String(d.fecha_limite_acuse || '').slice(0, 10);
    if (!limite || limite >= hoyClave) return;
    destinatarios.filter((x) => x.documento_id === d.documento_id).forEach((x) => {
      // SGC_DOC_DESTINATARIOS.usuario_email, no .email (typo confirmado por
      // la auditoria de modulos): con .email siempre undefined, la clave
      // nunca coincidia con acusadoPor y TODO destinatario de un documento
      // vencido contaba como "no confirmo", aunque si lo hubiera hecho.
      if (!acusadoPor[d.documento_id + '|' + d.version_vigente + '|' + normalizarEmail_(x.usuario_email)]) acusesVencidos++;
    });
  });
  alerta(SEVERIDAD_ALERTA.ALTA, 'Confirmaciones de lectura fuera de plazo',
    'Personas que no confirmaron haber leído un documento que ya venció su plazo (§7.5.3).',
    'documentos', acusesVencidos);

  // --- no conformidades ------------------------------------------------
  const ncAbiertas = ncs.filter((n) => n.estado !== 'CERRADA');
  const ncVencidas = ncAbiertas.filter((n) =>
    [n.correccion_plazo, n.accion_plazo, n.eficacia_plazo].some((p) => {
      const f = String(p || '').slice(0, 10);
      return f && f < hoyClave;
    }));
  alerta(SEVERIDAD_ALERTA.CRITICA, 'No conformidades con plazo vencido',
    'Alguna de sus etapas (corrección, acción correctiva o verificación de eficacia) pasó su fecha.',
    'nc', ncVencidas.length);
  alerta(SEVERIDAD_ALERTA.ALTA, 'No conformidades abiertas',
    'En curso, dentro de plazo.', 'nc', ncAbiertas.length - ncVencidas.length);
  ncAbiertas.forEach((n) => {
    [[n.correccion_plazo, 'corrección'], [n.accion_plazo, 'acción correctiva'], [n.eficacia_plazo, 'verificación de eficacia']]
      .forEach((par) => { hito(par[0], n.correlativo + ': ' + par[1], 'nc'); });
  });

  // --- quejas -----------------------------------------------------------
  const quejasAbiertas = quejas.filter((q) => q.estado !== 'CERRADA');
  const quejasVencidas = quejasAbiertas.filter((q) =>
    [q.resolucion_plazo, q.seguimiento_plazo].some((p) => {
      const f = String(p || '').slice(0, 10);
      return f && f < hoyClave;
    }));
  alerta(SEVERIDAD_ALERTA.CRITICA, 'Quejas fuera de plazo',
    'El PRO-07 compromete responder en 30 días corridos.', 'quejas', quejasVencidas.length);
  alerta(SEVERIDAD_ALERTA.ALTA, 'Quejas en curso',
    'Dentro de plazo.', 'quejas', quejasAbiertas.length - quejasVencidas.length);
  quejasAbiertas.forEach((q) => { hito(q.resolucion_plazo, q.correlativo + ': responder al cliente', 'quejas'); });

  // --- riesgos ----------------------------------------------------------
  const riesgosAltos = riesgos.filter((r) => {
    if (r.clase === 'OPORTUNIDAD') return false;
    const v = valorarRiesgo_(r.probabilidad, r.impacto);
    return v && (v.banda === 'Alto' || v.banda === 'Crítico');
  });
  const riesgosSinTratar = riesgosAltos.filter((r) => !valorarRiesgo_(r.probabilidad_residual, r.impacto_residual));
  // Un riesgo revalorado EXACTAMENTE igual que antes de los controles dice,
  // en sus propios términos, que las medidas no reducen nada. El aviso de
  // abajo no lo ve: para él ya está revalorado. Es un caso distinto y se
  // cuenta aparte.
  const sinReduccion = riesgos.filter((r) => {
    if (r.clase === 'OPORTUNIDAD') return false;
    if (String(r.probabilidad_residual) === '' || String(r.impacto_residual) === '') return false;
    return String(r.probabilidad) === String(r.probabilidad_residual) && String(r.impacto) === String(r.impacto_residual);
  });
  // §6.1: las acciones para abordar riesgos tienen que integrarse y
  // evaluarse, y eso no se puede pedir a nadie si el riesgo no tiene dueño.
  const riesgosSinDueno = riesgos.filter((r) => r.estado !== 'CERRADO' && !String(r.responsable_email || '').trim());
  alerta(SEVERIDAD_ALERTA.ALTA, 'Riesgos sin responsable asignado',
    '§6.1 pide integrar y evaluar las acciones. Sin un correo responsable no hay a quién asignarlas ni a quién preguntarle.',
    'riesgos', riesgosSinDueno.length);
  alerta(SEVERIDAD_ALERTA.ALTA, 'Riesgos cuyos controles no reducen nada',
    'Su valoración es idéntica antes y después de las medidas: según el propio registro, los controles no cambian el riesgo. O la medida no sirve, o falta revalorar de verdad.',
    'riesgos', sinReduccion.length);
  alerta(SEVERIDAD_ALERTA.CRITICA, 'Riesgos altos o críticos sin revalorar',
    'Tienen acción definida pero nadie ha vuelto a valorarlos tras los controles: no hay evidencia de que se hayan abordado.',
    'riesgos', riesgosSinTratar.length);

  // --- auditorías --------------------------------------------------------
  const auditoriasPendientes = auditorias.filter((a) => !a.fecha_ejecucion);
  const auditoriasAtrasadas = auditoriasPendientes.filter((a) => {
    const f = String(a.fecha_programada || '').slice(0, 10);
    return f && f < hoyClave;
  });
  alerta(SEVERIDAD_ALERTA.ALTA, 'Auditorías programadas y no ejecutadas',
    'Su fecha programada ya pasó.', 'auditorias', auditoriasAtrasadas.length);
  auditoriasPendientes.forEach((a) => { hito(a.fecha_programada, 'Auditoría ' + (a.correlativo || a.anio), 'auditorias'); });
  // Informes de auditoría fuera de plazo (PRO-03: 10 días hábiles).
  const informesAtrasados = auditorias.filter((a) => {
    if (!a.fecha_ejecucion || a.informe_fecha) return false;
    const f = String(a.informe_plazo || '').slice(0, 10);
    return f && f < hoyClave;
  });
  alerta(SEVERIDAD_ALERTA.ALTA, 'Informes de auditoría fuera de plazo',
    'La auditoría se ejecutó pero su informe no se emitió dentro del plazo del PRO-03.',
    'auditorias', informesAtrasados.length);

  // --- revisión por la dirección ----------------------------------------
  const revisionesAbiertas = revisiones.filter((r) => r.estado !== 'CERRADA');
  revisionesAbiertas.forEach((r) => { hito(r.fecha_programada, 'Revisión por la dirección ' + (r.correlativo || r.anio), 'revision'); });
  const ultimaRevision = revisiones.filter((r) => r.estado === 'CERRADA' && r.fecha_cierre)
    .map((r) => String(r.fecha_cierre).slice(0, 10)).sort().pop() || '';
  const mesesRevision = mesesDesde_(ultimaRevision);
  if (!revisiones.length) {
    alerta(SEVERIDAD_ALERTA.ALTA, 'Sin revisión por la dirección registrada', '§9.3 la exige a intervalos planificados.', 'revision', 1);
  } else if (mesesRevision !== null && mesesRevision >= 12) {
    alerta(SEVERIDAD_ALERTA.ALTA, 'La revisión por la dirección lleva ' + mesesRevision + ' meses', 'La frecuencia definida es anual.', 'revision', 1);
  }

  // --- personas ----------------------------------------------------------
  const evalVencidas = evaluaciones.filter((e) => {
    const f = String(e.proxima_evaluacion || '').slice(0, 10);
    return f && f < hoyClave;
  });
  // §7.2: la competencia se sustenta en el descriptor del cargo. Una
  // persona sin descriptor no tiene contra qué evaluarse.
  const sinDescriptor = personas.filter((p) =>
    !descriptores.some((d) => String(d.vigente).toUpperCase() === 'TRUE' && String(d.persona_id || '') === String(p.persona_id || '')));
  alerta(SEVERIDAD_ALERTA.MEDIA, 'Personas sin descriptor de cargo',
    '§7.2 pide determinar la competencia necesaria. Sin descriptor no hay contra qué evaluar a esa persona.',
    'personas', sinDescriptor.length);

  // §7.3: la inducción es la evidencia de que la persona conoce la política
  // y su aporte al sistema. Mientras siga abierta, la cláusula queda en
  // falta aunque el registro exista.
  const induccionesAbiertas = inducciones.filter((i) => String(i.estado || '').toUpperCase() !== 'COMPLETADA');
  alerta(SEVERIDAD_ALERTA.MEDIA, 'Inducciones sin cerrar',
    'Registradas pero no completadas. §7.3 se sustenta en la inducción cerrada, no en la agendada.',
    'personas', induccionesAbiertas.length);

  // Una evaluación sin fecha o sin quién evaluó no sirve como evidencia.
  const evalIncompletas = evaluaciones.filter((e) => !String(e.fecha || '').trim() || !String(e.evaluador_email || '').trim());
  alerta(SEVERIDAD_ALERTA.MEDIA, 'Evaluaciones sin fecha o sin evaluador',
    'Un registro que no dice cuándo se hizo ni quién evaluó no sustenta la competencia (§7.2).',
    'personas', evalIncompletas.length);
  alerta(SEVERIDAD_ALERTA.MEDIA, 'Evaluaciones de competencia vencidas',
    'Su próxima evaluación ya debía haberse hecho (§7.2).', 'personas', evalVencidas.length);
  evaluaciones.forEach((e) => { hito(e.proxima_evaluacion, 'Reevaluar competencias', 'personas'); });

  // --- proveedores -------------------------------------------------------
  const evaluadoHasta = {};
  provEval.forEach((e) => {
    const f = String(e.proxima_evaluacion || '').slice(0, 10);
    if (!evaluadoHasta[e.proveedor_id] || f > evaluadoHasta[e.proveedor_id]) evaluadoHasta[e.proveedor_id] = f;
  });
  const provVencidos = proveedores.filter((p) => {
    const f = evaluadoHasta[p.proveedor_id];
    // Nunca evaluado también cuenta como vencido: es el criterio que ya
    // usa el módulo de proveedores desde la Fase 5a.
    return !f || f < hoyClave;
  });
  alerta(SEVERIDAD_ALERTA.MEDIA, 'Proveedores sin evaluación vigente',
    'Nunca evaluados o con la reevaluación vencida (§8.4).', 'proveedores', provVencidos.length);

  // --- medición ----------------------------------------------------------
  const indSinMedir = indicadores.filter((i) => !lecturas.some((l) => l.indicador_id === i.indicador_id));
  alerta(SEVERIDAD_ALERTA.MEDIA, 'Indicadores definidos y nunca medidos',
    'Definir el indicador no es medirlo (§9.1.1).', 'indicadores', indSinMedir.length);

  // El aviso de arriba cuenta indicadores SIN medir; con CERO indicadores
  // da cero y no dice nada. Y no tener ninguno es peor que tenerlos sin
  // medir.
  if (!indicadores.length) {
    alerta(SEVERIDAD_ALERTA.CRITICA, 'No hay ningún indicador definido',
      '§9.1.1 pide determinar qué necesita medirse y cuándo. Sin indicadores no hay con qué demostrar que el sistema se evalúa.',
      'indicadores', 1);
  }
  const indNoCumplen = indicadores.filter((i) => {
    const propias = lecturas.filter((l) => l.indicador_id === i.indicador_id)
      .sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)));
    const ultima = propias[propias.length - 1];
    return ultima && ultima.origen === 'NO_CUMPLE';
  });
  alerta(SEVERIDAD_ALERTA.ALTA, 'Indicadores bajo meta',
    'Su última medición quedó fuera incluso de la tolerancia.', 'indicadores', indNoCumplen.length);

  // --- planificación al día ---------------------------------------------
  if (!alcance) {
    alerta(SEVERIDAD_ALERTA.CRITICA, 'El alcance del SGC no está declarado',
      'Es lo primero que pide una auditoría de certificación (§4.3).', 'alcance', 1);
  }
  if (!contextoFilas.length) {
    alerta(SEVERIDAD_ALERTA.ALTA, 'El análisis de contexto no está cargado', '§4.1 exige determinar las cuestiones internas y externas.', 'contexto', 1);
  }
  if (!partes.length) {
    alerta(SEVERIDAD_ALERTA.ALTA, 'Las partes interesadas no están determinadas', '§4.2.', 'contexto', 1);
  }
  if (!riesgos.length) {
    alerta(SEVERIDAD_ALERTA.ALTA, 'La matriz de riesgos no está cargada', '§6.1.', 'riesgos', 1);
  }
  if (!procesos.length) {
    alerta(SEVERIDAD_ALERTA.ALTA, 'El mapa de procesos no está cargado', '§4.4.', 'procesos', 1);
  }
  const procesosMapa = procesos.filter((p) => p.nivel === 'MAPA');
  const procesosSinResponsable = procesosMapa.filter((p) => !String(p.responsable_email || '').trim());
  alerta(SEVERIDAD_ALERTA.MEDIA, 'Procesos sin responsable asignado',
    '§4.4.2 e) pide asignar la responsabilidad y autoridad de cada proceso.', 'procesos', procesosSinResponsable.length);

  // §4.4.1 c): hay que determinar los criterios y métodos de cada proceso.
  const procesosSinObjetivo = procesosMapa.filter((p) => !String(p.objetivo || '').trim());
  alerta(SEVERIDAD_ALERTA.MEDIA, 'Procesos sin objetivo declarado',
    '§4.4.1 pide determinar los criterios de cada proceso. Sin objetivo no hay contra qué medirlo.',
    'procesos', procesosSinObjetivo.length);

  // §4.2: no basta con determinar las partes interesadas; hay que hacer el
  // seguimiento y la revisión de su información.
  const partesSinSeguimiento = partes.filter((p) =>
    !String(p.metodo_seguimiento || '').trim() || !String(p.frecuencia_seguimiento || '').trim());
  alerta(SEVERIDAD_ALERTA.MEDIA, 'Partes interesadas sin seguimiento definido',
    '§4.2 pide hacer seguimiento y revisión de su información. Sin método ni frecuencia, no hay seguimiento que mostrar.',
    'contexto', partesSinSeguimiento.length);

  // --- salud por capítulo, reusando la matriz de cobertura ---------------
  // matrizCalculada_ y no MatrizCobertura.listar: el portón ya se
  // comprobó en `resumen`, y aquí no hay contexto que pasarle.
  const matriz = MatrizCobertura.matrizCalculada_(db);
  const salud = MatrizCobertura.saludPorCapitulo_(matriz.clausulas || []);

  const orden = { CRITICA: 0, ALTA: 1, MEDIA: 2 };
  alertas.sort((a, b) => orden[a.severidad] - orden[b.severidad]);
  hitos.sort((a, b) => a.fecha.localeCompare(b.fecha));

  return {
    fecha: hoyClave,
    alcance: alcance ? {
      version: alcance.version,
      razon_social: alcance.razon_social,
      nombre_fantasia: alcance.nombre_fantasia,
      norma: (alcance.norma_codigo || '') + ':' + (alcance.norma_version || ''),
      declaracion: alcance.declaracion
    } : null,
    salud: {
      // El MISMO número de la matriz de cobertura, no uno nuevo.
      pct: (matriz.resumen && matriz.resumen.pct_listo) || 0,
      aplicables: (matriz.resumen && matriz.resumen.aplicables) || 0,
      no_aplica: (matriz.resumen && matriz.resumen.no_aplica) || 0,
      capitulos: salud,
      // Se manda para que la pantalla no pueda "olvidarse" de decirlo.
      aviso: 'Indicador interno de gestión: mide cuánta evidencia hay cargada en SIGSO, ' +
        'no es un porcentaje oficial de certificación. Quien certifica es la casa certificadora, ' +
        'y lo hace con hallazgos.'
    },
    alertas,
    hitos: hitos.slice(0, 15),
    conteos: {
      documentos_vigentes: vigentes.length,
      documentos_externos: vigentes.filter((d) => d.tipo === 'EXTERNO').length,
      nc_abiertas: ncAbiertas.length,
      quejas_abiertas: quejasAbiertas.length,
      riesgos: riesgos.filter((r) => r.clase !== 'OPORTUNIDAD').length,
      riesgos_altos: riesgosAltos.length,
      procesos_mapa: procesosMapa.length,
      procesos_servicio: procesos.length - procesosMapa.length,
      indicadores: indicadores.length,
      auditorias_ejecutadas: auditorias.filter((a) => !!a.fecha_ejecucion).length,
      ultima_revision_direccion: ultimaRevision
    }
  };
}

/**
 * Una sola llamada devuelve todo lo que la portada necesita.
 */
function resumen(db, data, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!(gobierna || Calidad.veTodoSgc_(db, contexto, rol, gobierna))) {
    return { _forbidden: true, message: 'El tablero del SGC es para quien gobierna o supervisa el sistema.' };
  }

  const salida = cuerpoTablero_(db);
  // Lo único que depende de quién mira. Se calcula siempre.
  salida.puede_gestionar = gobierna;
  // El tablero es la primera pantalla del módulo: tiene que traer el mapa
  // de secciones para que la barra se pinte sabiendo qué puede abrir cada
  // quien.
  salida.secciones_visibles = Calidad.seccionesVisiblesSgc_(db, contexto);
  return salida;
}

module.exports = { resumen };
