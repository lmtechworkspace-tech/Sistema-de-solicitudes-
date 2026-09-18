'use strict';

/**
 * matrizCoberturaSgc.js — puerto de backend/backoffice/MatrizCobertura.gs
 * (SGC ISO 9001, Fase 6b + "modo auditoría", mejora propuesta fuera de la
 * especificación original). Responde la pregunta que nadie puede contestar
 * con datos: "¿estamos listos para la auditoría de certificación?". Recorre
 * las 28 cláusulas auditables (mismo catálogo que Auditorías) y por cada
 * una mira si el sistema tiene evidencia real -- no una opinión, un conteo.
 *
 * Tres decisiones de diseño (idénticas al .gs):
 * 1) NO se inventan hojas de "cobertura": el estado de cada cláusula se
 *    CALCULA en el momento a partir de datos que ya existen.
 * 2) Las cláusulas cuya evidencia es un DOCUMENTO específico nunca se
 *    adivinan por palabras clave -- dependen de que el Encargado SGC haya
 *    etiquetado el documento (SGC_DOCUMENTOS.clausulas_iso).
 * 3) Tres estados, no dos: FALTANTE no es lo mismo que "no aplica" ni que
 *    "fuera del alcance de SIGSO hoy". Cada cláusula sin evidencia trae una
 *    nota que dice POR QUÉ.
 *
 * PENDIENTE EXPLÍCITO, NO FINGIDO: cinco evaluadores (4.1, 4.2, 4.4,
 * 6.1, 8.1/8.5/8.6/8.7, 9.1) siguen dependiendo de módulos v11 todavía no
 * portados a Node (Contexto, Riesgos, Procesos, Indicadores, Prestaciones).
 * 4.3 (Alcance) YA es real desde que se portó esa fase (ver alcanceSgc.js).
 * El propio `.gs` resuelve los que faltan con `typeof X === 'function' ?
 * X() : []` para tolerar que el módulo no esté cargado -- acá se replica
 * igual con los stubs de la sección siguiente: mientras esas fases no se
 * porten, estos evaluadores degradan a FALTANTE/PARCIAL según corresponda
 * (nunca inventan datos). Reemplazar cada stub por un require real cuando
 * se porte su fase v11 correspondiente (TODO en cada uno) -- mismo patrón
 * ya aplicado a Alcance en este incremento.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const { CLAUSULAS_ISO9001 } = require('./sgcCatalogo');
const Alcance = require('./alcanceSgc');

const UMBRAL_COBERTURA_COMPLETO = 0.8;
const NORMA_SGC_POR_DEFECTO = { codigo: 'ISO 9001', version: '2015' };
const CAPITULOS_ISO = [
  { numero: '4', titulo: 'Contexto de la organización' },
  { numero: '5', titulo: 'Liderazgo' },
  { numero: '6', titulo: 'Planificación' },
  { numero: '7', titulo: 'Apoyo' },
  { numero: '8', titulo: 'Operación' },
  { numero: '9', titulo: 'Evaluación del desempeño' },
  { numero: '10', titulo: 'Mejora' }
];
// El mismo texto que usa el tablero: es un indicador de gestión, no un
// porcentaje oficial de certificación.
const MENSAJE_INDICADOR_INTERNO = 'Indicador interno de gestión: mide cuánta evidencia hay cargada en SIGSO, no es un porcentaje oficial de certificación. Quien certifica es la casa certificadora, y lo hace con hallazgos.';
const NOTA_FALTANTE_POR_DEFECTO_ISO = {
  '6.3': 'La planificación de cambios no tiene un módulo propio en SIGSO hoy.',
  '7.1': 'La planificación de recursos no tiene un módulo propio en SIGSO hoy.',
  '8.2': 'Los requisitos de productos y servicios no tienen un módulo propio en SIGSO hoy.',
  '8.3': 'Sin evidencia estructurada. Si la organización determinó que esta cláusula no le aplica, tiene que declararlo como exclusión en Alcance, con su justificación (§4.3): mientras no esté declarada, la cláusula se considera aplicable.'
};

function uuid_() { return crypto.randomUUID(); }
function errorValidacion_(campo, mensaje) { return { _validationError: true, campo, message: mensaje }; }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function esActivo_(fila) { return esVerdadero_(fila.activa); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leerSeguro_(db, hoja) { try { return leer_(db, hoja); } catch (err) { return []; } }
function hojaExiste_(db, hoja) { try { leer_(db, hoja); return true; } catch (err) { return false; } }

// --- dependencias de fases v11 aun no portadas (ver nota de cabecera) -------
// 4.3/exclusiones ya NO son stub: Alcance (v11 Fase 1) esta portado.
const alcanceVigente_ = Alcance.alcanceVigente_;
const exclusionesVigentesPorClausula_ = Alcance.exclusionesVigentesPorClausula_;
function factoresContextoActivos_(db) { return []; } // TODO v11 Fase 2 (Contexto)
function partesInteresadasActivas_(db) { return []; } // TODO v11 Fase 2 (Contexto)
function riesgosActivos_(db) { return []; } // TODO v11 Fase 3 (Riesgos)
function procesosActivos_(db) { return []; } // TODO v11 Fase 4 (Procesos)
function pasosActivos_(db) { return []; } // TODO v11 Fase 4 (Procesos)
function indicadoresActivos_(db) { return []; } // TODO v11 Fase 6 (Indicadores)

// --- evaluadores por clausula -------------------------------------------------
// Cada evaluador devuelve {estado, resumen, nota, evidencia:[{tipo,
// descripcion, fecha, responsable}]}.

function evaluarNoConformidades_(db) {
  const ncs = leerSeguro_(db, 'SGC_NC').filter(esActivo_);
  if (!ncs.length) return { estado: 'FALTANTE', resumen: 'No hay no conformidades registradas.', nota: 'Sin NC no hay evidencia de que el ciclo de mejora esté operando.', evidencia: [] };
  const eficaces = ncs.filter((n) => n.eficacia_resultado === 'EFICAZ');
  const ev = ncs.slice(0, 15).map((n) => ({ tipo: 'No conformidad', descripcion: n.descripcion || n.nc_id, fecha: n.fecha_deteccion, responsable: n.responsable_email }));
  return {
    estado: eficaces.length ? 'COMPLETO' : 'PARCIAL',
    resumen: ncs.length + ' no conformidades registradas, ' + eficaces.length + ' con eficacia verificada.',
    nota: '', evidencia: ev
  };
}

function evaluarPorDocumentos_(db, codigo) {
  const docs = leerSeguro_(db, 'SGC_DOCUMENTOS').filter((d) => esActivo_(d) && d.estado === 'VIGENTE' && Calidad.parsearClausulasIso_(d.clausulas_iso).indexOf(codigo) !== -1);
  const ev = docs.map((d) => ({ tipo: 'Documento vigente', descripcion: d.codigo + ' — ' + d.nombre, fecha: d.fecha_vigencia, responsable: d.aprobado_por }));
  return {
    estado: docs.length ? 'COMPLETO' : 'FALTANTE',
    resumen: docs.length ? docs.length + ' documento(s) etiquetado(s) para esta cláusula.' : 'Sin documentos etiquetados para esta cláusula.',
    nota: docs.length ? '' : 'Etiqueta el documento correspondiente (por ejemplo, la política de calidad) en su ficha, sección "Cláusulas ISO".',
    evidencia: ev
  };
}

function evaluarClausulaSinModulo_(db, codigo) {
  const porDocs = evaluarPorDocumentos_(db, codigo);
  if (!porDocs.evidencia.length) {
    return { estado: 'FALTANTE', resumen: 'Sin evidencia estructurada en el sistema.', nota: NOTA_FALTANTE_POR_DEFECTO_ISO[codigo] || 'Sin evidencia estructurada en el sistema todavía.', evidencia: [] };
  }
  return {
    estado: 'PARCIAL', resumen: porDocs.evidencia.length + ' documento(s) etiquetado(s) para esta cláusula.',
    nota: (NOTA_FALTANTE_POR_DEFECTO_ISO[codigo] || '') + ' El documento etiquetado respalda la cláusula, pero SIGSO no tiene dónde registrar que se esté aplicando: para el auditor, la evidencia es el documento.',
    evidencia: porDocs.evidencia
  };
}

// v11.0 Fase 1 (§4.3): la norma pide tres cosas y se revisan por separado,
// para que la nota diga cuál falta y no un genérico "incompleto".
function evaluarAlcanceDeclarado_(db) {
  const vigente = alcanceVigente_(db);
  const porDocs = evaluarPorDocumentos_(db, '4.3');

  if (!vigente) {
    return {
      estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
      resumen: 'El alcance del SGC no está declarado en el sistema.',
      nota: 'Declara el alcance en la sección Alcance: qué servicios cubre, en qué ubicaciones y qué cláusulas se excluyen con su justificación. ' +
        (porDocs.evidencia.length ? 'Hay documentos etiquetados para 4.3, pero un documento adjunto no responde por sí solo qué se excluyó.' : ''),
      evidencia: porDocs.evidencia
    };
  }

  const exclusiones = Alcance.exclusionesDe_(db, vigente.alcance_id);
  const ev = [{ tipo: 'Alcance declarado', descripcion: 'v' + vigente.version + ' — ' + String(vigente.declaracion || '').slice(0, 160), fecha: vigente.vigente_desde || vigente.fecha_creacion, responsable: vigente.creado_por }];
  exclusiones.forEach((e) => ev.push({ tipo: 'Exclusión declarada', descripcion: e.clausula + (e.titulo ? ' — ' + e.titulo : '') + ': ' + e.justificacion, fecha: e.fecha_creacion, responsable: e.creado_por }));
  porDocs.evidencia.forEach((e) => ev.push(e));

  const falta = [];
  if (!Alcance.listaDesdeJson_(vigente.areas).length) falta.push('no hay áreas declaradas');
  if (!String(vigente.declaracion || '').trim()) falta.push('falta la declaración de alcance');
  // Una exclusion sin justificacion no es una exclusion valida para §4.3.
  const sinJustificar = exclusiones.filter((e) => !String(e.justificacion || '').trim());
  if (sinJustificar.length) falta.push(sinJustificar.length + ' exclusión(es) sin justificación');
  if (!porDocs.evidencia.length) falta.push('ningún documento etiquetado como respaldo de 4.3');

  return {
    estado: falta.length ? 'PARCIAL' : 'COMPLETO',
    resumen: 'Alcance v' + vigente.version + ' declarado, con ' + exclusiones.length + ' exclusión(es).',
    nota: falta.length ? 'Para cerrar 4.3: ' + falta.join('; ') + '.' : '',
    evidencia: ev
  };
}
function evaluarContextoOrganizacion_(db) {
  const factores = factoresContextoActivos_(db);
  const porDocs = evaluarPorDocumentos_(db, '4.1');
  return {
    estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
    resumen: 'El análisis de contexto no está cargado en el sistema.',
    nota: 'Carga el análisis FODA en la sección Contexto.' +
      (porDocs.evidencia.length ? ' Hay documentos etiquetados para 4.1, pero un archivo adjunto no permite demostrar el seguimiento periódico que pide la cláusula.' : ''),
    evidencia: porDocs.evidencia
  };
}
function evaluarPartesInteresadas_(db) {
  const partes = partesInteresadasActivas_(db);
  const porDocs = evaluarPorDocumentos_(db, '4.2');
  return {
    estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
    resumen: 'Las partes interesadas no están cargadas en el sistema.',
    nota: 'Carga la matriz de partes interesadas en la sección Contexto.',
    evidencia: porDocs.evidencia
  };
}
function evaluarRiesgosOportunidades_(db) {
  const filas = riesgosActivos_(db);
  const porDocs = evaluarPorDocumentos_(db, '6.1');
  return {
    estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
    resumen: 'La matriz de riesgos y oportunidades no está cargada en el sistema.',
    nota: 'Carga la matriz en la sección Riesgos.' +
      (porDocs.evidencia.length ? ' Hay documentos etiquetados para 6.1, pero un archivo adjunto no demuestra que las acciones se hayan asignado ni revalorado.' : ''),
    evidencia: porDocs.evidencia
  };
}
function evaluarProcesosSgc_(db) {
  const filas = procesosActivos_(db);
  const porDocs = evaluarPorDocumentos_(db, '4.4');
  return {
    estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
    resumen: 'El mapa de procesos no está cargado en el sistema.',
    nota: 'Carga el mapa en la sección Procesos.' +
      (porDocs.evidencia.length ? ' Hay documentos etiquetados para 4.4, pero un diagrama adjunto no permite decir quién responde por cada proceso ni si sigue vigente.' : ''),
    evidencia: porDocs.evidencia
  };
}
function evaluarPrestaciones_(db, codigo) {
  const servicios = procesosActivos_(db).filter((p) => p.nivel === 'SERVICIO');
  const porDocs = evaluarPorDocumentos_(db, codigo);
  return {
    estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
    resumen: 'Los procesos de servicio no están cargados.',
    nota: 'Carga los procesos de servicio (DOC-10 a DOC-13) en la sección Procesos: sin ellos no hay qué registrar.',
    evidencia: porDocs.evidencia
  };
}
// v11.0 Fase 8 (§8.7): §10.2 es "algo salió mal en el sistema", §8.7 es "una
// salida concreta no cumplió y no se entregó así" -- miden cosas distintas.
// Sin SGC_PRESTACIONES (Fase 8, no portada) se apoya en NC mientras tanto.
function evaluarSalidasNoConformes_(db) {
  const prestaciones = leerSeguro_(db, 'SGC_PRESTACIONES').filter(esActivo_);
  const nc = evaluarNoConformidades_(db);
  return {
    estado: nc.estado === 'FALTANTE' ? 'FALTANTE' : 'PARCIAL',
    resumen: 'Sin registro de servicios prestados no hay dónde identificar una salida no conforme.',
    nota: 'Registra las prestaciones en la sección Servicios. Mientras tanto, la evidencia disponible son las no conformidades del sistema (§10.2), que miden algo distinto.',
    evidencia: nc.evidencia
  };
}

// El liderazgo no se declara, se demuestra (§5.1.1): revisión por la
// dirección cerrada + política aprobada + objetivos medidos.
function evaluarLiderazgo_(db) {
  const revisiones = leerSeguro_(db, 'SGC_REVISIONES').filter((r) => esVerdadero_(r.activa) && r.estado === 'CERRADA');
  const politica = evaluarPorDocumentos_(db, '5.2');
  const objetivos = EVALUADORES_CLAUSULA_ISO['6.2'](db);

  const ev = [];
  revisiones.slice(0, 5).forEach((r) => ev.push({ tipo: 'Revisión por la dirección cerrada', descripcion: r.correlativo, fecha: r.fecha_cierre, responsable: r.responsable_calidad_email }));
  politica.evidencia.forEach((e) => ev.push(e));

  const pilares = (revisiones.length ? 1 : 0) + (politica.estado === 'COMPLETO' ? 1 : 0) + (objetivos.estado === 'FALTANTE' ? 0 : 1);
  const faltan = [];
  if (!revisiones.length) faltan.push('no hay revisiones por la dirección cerradas');
  if (politica.estado !== 'COMPLETO') faltan.push('la política de calidad no está etiquetada como documento de 5.2');
  if (objetivos.estado === 'FALTANTE') faltan.push('no hay objetivos de calidad con medición');

  return {
    estado: pilares === 3 ? 'COMPLETO' : (pilares ? 'PARCIAL' : 'FALTANTE'),
    resumen: revisiones.length + ' revisión(es) por la dirección cerradas; política y objetivos como respaldo.',
    nota: faltan.length ? 'La alta dirección demuestra su compromiso con hechos registrados: ' + faltan.join('; ') + '.' : '',
    evidencia: ev
  };
}
// Comunicación interna: Novedades publicadas es evidencia de que la
// organización efectivamente comunica, no solo lo declara.
function evaluarComunicacion_(db) {
  const publicadas = leerSeguro_(db, 'NOVEDADES').filter((n) => esVerdadero_(n.activa) && n.estado === 'PUBLICADA');
  const ev = publicadas.slice(-10).map((n) => ({ tipo: 'Novedad publicada', descripcion: n.titulo, fecha: n.fecha_publicacion, responsable: n.autor_nombre || n.autor_email }));
  return {
    estado: publicadas.length >= 3 ? 'COMPLETO' : (publicadas.length ? 'PARCIAL' : 'FALTANTE'),
    resumen: publicadas.length + ' comunicaciones publicadas (Novedades).',
    nota: publicadas.length ? '' : 'Sin comunicaciones publicadas todavía en Novedades.',
    evidencia: ev
  };
}
// Información documentada: §7.5.3 pide controlar la propia, §7.5.3.2 además
// IDENTIFICAR y controlar la de origen EXTERNO -- se miden por separado.
function evaluarInformacionDocumentada_(db) {
  const docs = leerSeguro_(db, 'SGC_DOCUMENTOS').filter((d) => esActivo_(d) && d.estado === 'VIGENTE');
  const externos = docs.filter((d) => d.tipo === 'EXTERNO');
  const internos = docs.filter((d) => d.tipo !== 'EXTERNO');

  const ev = internos.slice(0, 10).map((d) => ({ tipo: 'Documento interno vigente', descripcion: d.codigo + ' — ' + d.nombre, fecha: d.fecha_vigencia, responsable: d.aprobado_por }));
  externos.forEach((d) => ev.push({ tipo: 'Documento externo identificado', descripcion: d.codigo + ' — ' + d.nombre + (d.emisor ? ' (' + d.emisor + ')' : ''), fecha: d.proxima_revision, responsable: d.emisor || '' }));

  const falta = [];
  if (!internos.length) falta.push('no hay documentos internos vigentes');
  else if (internos.length < 5) falta.push('solo ' + internos.length + ' documento(s) interno(s) vigente(s)');
  if (!externos.length) falta.push('no hay documentos de origen externo identificados (§7.5.3.2): normas, decretos y leyes aplicables');
  const sinEmisor = externos.filter((d) => !String(d.emisor || '').trim());
  if (sinEmisor.length) falta.push(sinEmisor.length + ' documento(s) externo(s) sin emisor identificado');

  return {
    estado: falta.length ? (internos.length ? 'PARCIAL' : 'FALTANTE') : 'COMPLETO',
    resumen: internos.length + ' documentos internos vigentes y ' + externos.length + ' de origen externo identificados.',
    nota: falta.length ? 'Para cerrar 7.5: ' + falta.join('; ') + '.' : '',
    evidencia: ev
  };
}
// Objetivos de calidad: sembrados y con lecturas es la evidencia fuerte. Se
// mira el año MÁS RECIENTE ya abierto, no necesariamente el año en curso.
function evaluarObjetivos_(db) {
  const todos = leerSeguro_(db, 'SGC_OBJETIVOS').filter(esActivo_);
  if (!todos.length) return { estado: 'FALTANTE', resumen: 'No hay ningún año de objetivos abierto.', nota: 'Abrir el año en Objetivos de calidad.', evidencia: [] };
  const anio = todos.reduce((max, o) => Math.max(max, Number(o.anio)), 0);
  const objetivos = todos.filter((o) => Number(o.anio) === anio);
  const lecturas = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').filter((l) => esVerdadero_(l.activa));
  const medidos = objetivos.filter((o) => lecturas.some((l) => l.objetivo_id === o.objetivo_id));
  const ev = objetivos.map((o) => {
    const l = lecturas.filter((x) => x.objetivo_id === o.objetivo_id).sort((a, b) => String(a.periodo).localeCompare(String(b.periodo))).pop();
    return { tipo: 'Objetivo de calidad', descripcion: o.objetivo_general, fecha: l ? l.fecha_registro : '', responsable: o.responsable_texto };
  });
  return {
    estado: medidos.length === objetivos.length ? 'COMPLETO' : (medidos.length ? 'PARCIAL' : 'FALTANTE'),
    resumen: medidos.length + ' de ' + objetivos.length + ' objetivos con al menos una medición en ' + anio + '.',
    nota: '', evidencia: ev
  };
}
// Seguimiento, medición, análisis y evaluación (§9.1.1): mide lo corporativo
// (los 6 objetivos) Y los indicadores por proceso -- sin Indicadores (v11
// Fase 6, no portada) siempre falta esa segunda mitad, declarado explícito.
function evaluarSeguimientoMedicion_(db) {
  const objetivos6 = evaluarObjetivos_(db);
  const indicadores = indicadoresActivos_(db);
  const lecturas = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').filter((l) => esVerdadero_(l.activa) && l.indicador_id);

  const ev = objetivos6.evidencia.slice(0);
  indicadores.slice(0, 12).forEach((i) => {
    const propias = lecturas.filter((l) => l.indicador_id === i.indicador_id);
    const ultima = propias.sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)))[propias.length - 1];
    ev.push({ tipo: 'Indicador de proceso', descripcion: i.codigo + ' — ' + i.nombre + (ultima ? ': ' + ultima.periodo + ' = ' + ultima.valor + ' (' + (ultima.origen || '') + ')' : ' (sin mediciones)'), fecha: ultima ? ultima.fecha_registro : '', responsable: i.responsable_email || '' });
  });

  const falta = [];
  if (objetivos6.estado !== 'COMPLETO') falta.push('los objetivos de calidad no están al día (ver 6.2)');
  if (!indicadores.length) {
    falta.push('no hay indicadores de proceso definidos: §9.1.3 e) pide analizar el desempeño de los procesos, y sin indicadores no hay con qué');
  } else {
    const sinMedir = indicadores.filter((i) => !lecturas.some((l) => l.indicador_id === i.indicador_id));
    if (sinMedir.length) falta.push(sinMedir.length + ' indicador(es) definido(s) pero nunca medido(s)');
  }

  return {
    estado: falta.length ? (indicadores.length || objetivos6.estado !== 'FALTANTE' ? 'PARCIAL' : 'FALTANTE') : 'COMPLETO',
    resumen: objetivos6.resumen + ' ' + indicadores.length + ' indicador(es) de proceso definido(s).',
    nota: falta.length ? 'Para cerrar 9.1: ' + falta.join('; ') + '.' : 'Se comparte evidencia con 6.2 (objetivos de calidad).',
    evidencia: ev
  };
}
function evaluarCompetencia_(db) {
  // 7.2: descriptor vigente + evaluación, por persona activa.
  const personas = leerSeguro_(db, 'SGC_PERSONAS').filter((p) => esVerdadero_(p.activa) && p.estado !== 'DESVINCULADO');
  if (!personas.length) return { estado: 'FALTANTE', resumen: 'No hay personal cargado.', nota: '', evidencia: [] };
  const descriptores = leerSeguro_(db, 'SGC_DESCRIPTORES').filter((d) => esVerdadero_(d.vigente));
  const evaluaciones = leerSeguro_(db, 'SGC_EVALUACIONES');
  const conAmbos = personas.filter((p) => descriptores.some((d) => d.persona_id === p.persona_id) && evaluaciones.some((e) => e.persona_id === p.persona_id));
  const pct = conAmbos.length / personas.length;
  const ev = conAmbos.slice(0, 15).map((p) => {
    const ultima = evaluaciones.filter((e) => e.persona_id === p.persona_id).sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))[0];
    return { tipo: 'Competencia evaluada', descripcion: p.nombre, fecha: ultima ? ultima.fecha : '', responsable: ultima ? ultima.evaluador_email : '' };
  });
  return {
    estado: pct >= UMBRAL_COBERTURA_COMPLETO ? 'COMPLETO' : (conAmbos.length ? 'PARCIAL' : 'FALTANTE'),
    resumen: conAmbos.length + ' de ' + personas.length + ' personas con descriptor vigente y evaluación registrada.',
    nota: '', evidencia: ev
  };
}
function evaluarTomaConciencia_(db) {
  // 7.3: inducción completada por persona activa.
  const personas = leerSeguro_(db, 'SGC_PERSONAS').filter((p) => esVerdadero_(p.activa) && p.estado !== 'DESVINCULADO');
  if (!personas.length) return { estado: 'FALTANTE', resumen: 'No hay personal cargado.', nota: '', evidencia: [] };
  const inducciones = leerSeguro_(db, 'SGC_INDUCCIONES');
  const conInduccionCompleta = personas.filter((p) => {
    const suyas = inducciones.filter((i) => i.persona_id === p.persona_id);
    return suyas.length > 0 && suyas.every((i) => i.estado === 'COMPLETADA');
  });
  const pct = conInduccionCompleta.length / personas.length;
  const ev = conInduccionCompleta.slice(0, 15).map((p) => ({ tipo: 'Inducción completa', descripcion: p.nombre, fecha: '', responsable: '' }));
  return {
    estado: pct >= UMBRAL_COBERTURA_COMPLETO ? 'COMPLETO' : (conInduccionCompleta.length ? 'PARCIAL' : 'FALTANTE'),
    resumen: conInduccionCompleta.length + ' de ' + personas.length + ' personas con inducción completa.',
    nota: '', evidencia: ev
  };
}
function evaluarProveedoresExternos_(db) {
  const proveedores = leerSeguro_(db, 'SGC_PROVEEDORES').filter((p) => esVerdadero_(p.activa));
  if (!proveedores.length) return { estado: 'FALTANTE', resumen: 'No hay proveedores cargados.', nota: '', evidencia: [] };
  const evaluados = proveedores.filter((p) => p.estado !== 'SIN_EVALUAR');
  const ev = evaluados.slice(0, 15).map((p) => ({ tipo: 'Proveedor evaluado', descripcion: p.nombre + ' — ' + p.estado, fecha: p.ultima_evaluacion_fecha, responsable: '' }));
  return {
    estado: evaluados.length === proveedores.length ? 'COMPLETO' : (evaluados.length ? 'PARCIAL' : 'FALTANTE'),
    resumen: evaluados.length + ' de ' + proveedores.length + ' proveedores con evaluación registrada.',
    nota: '', evidencia: ev
  };
}
function evaluarAuditoriaInterna_(db) {
  const auditorias = leerSeguro_(db, 'SGC_AUDITORIAS').filter((a) => esVerdadero_(a.activa));
  if (!auditorias.length) return { estado: 'FALTANTE', resumen: 'No hay auditorías programadas.', nota: '', evidencia: [] };
  const ejecutadas = auditorias.filter((a) => !!a.fecha_ejecucion);
  const ev = ejecutadas.slice(0, 10).map((a) => ({ tipo: 'Auditoría interna', descripcion: 'Auditoría ' + a.anio, fecha: a.fecha_ejecucion, responsable: a.auditor_email }));
  return { estado: ejecutadas.length ? 'COMPLETO' : 'PARCIAL', resumen: ejecutadas.length + ' de ' + auditorias.length + ' auditorías programadas ya ejecutadas.', nota: '', evidencia: ev };
}
function evaluarRevisionDireccion_(db) {
  const revisiones = leerSeguro_(db, 'SGC_REVISIONES').filter((r) => esVerdadero_(r.activa));
  if (!revisiones.length) return { estado: 'FALTANTE', resumen: 'No hay revisiones por la dirección registradas.', nota: '', evidencia: [] };
  const cerradas = revisiones.filter((r) => r.estado === 'CERRADA');
  const ev = cerradas.slice(0, 10).map((r) => ({ tipo: 'Revisión por la dirección', descripcion: r.correlativo, fecha: r.fecha_cierre, responsable: r.responsable_calidad_email }));
  return { estado: cerradas.length ? 'COMPLETO' : 'PARCIAL', resumen: cerradas.length + ' de ' + revisiones.length + ' revisiones cerradas.', nota: '', evidencia: ev };
}
function evaluarMejoraContinua_(db) {
  // Acuerdos de revisión cumplidos (=Actividad TERMINADA): la mejora no se
  // queda en el acta.
  const acuerdos = leerSeguro_(db, 'SGC_REVISION_ACUERDOS').filter((a) => esVerdadero_(a.activa));
  if (!acuerdos.length) return { estado: 'FALTANTE', resumen: 'No hay acuerdos de mejora registrados.', nota: '', evidencia: [] };
  const actividades = leerSeguro_(db, 'ACTIVIDADES');
  const cumplidos = acuerdos.filter((a) => { const act = actividades.find((x) => x.actividad_id === a.actividad_id); return act && act.estado === 'TERMINADA'; });
  const ev = acuerdos.slice(0, 10).map((a) => ({ tipo: 'Acuerdo de mejora', descripcion: a.observaciones, fecha: a.plazo, responsable: a.responsable_email }));
  return {
    estado: cumplidos.length === acuerdos.length ? 'COMPLETO' : (cumplidos.length ? 'PARCIAL' : 'FALTANTE'),
    resumen: cumplidos.length + ' de ' + acuerdos.length + ' acuerdos de mejora cumplidos.', nota: '', evidencia: ev
  };
}

const EVALUADORES_CLAUSULA_ISO = {
  '4.1': evaluarContextoOrganizacion_, '4.2': evaluarPartesInteresadas_, '4.3': evaluarAlcanceDeclarado_,
  '4.4': evaluarProcesosSgc_,
  '5.1': evaluarLiderazgo_, '5.2': (db) => evaluarPorDocumentos_(db, '5.2'), '5.3': (db) => evaluarPorDocumentos_(db, '5.3'),
  '6.1': evaluarRiesgosOportunidades_, '6.2': evaluarObjetivos_,
  '7.2': evaluarCompetencia_, '7.3': evaluarTomaConciencia_, '7.4': evaluarComunicacion_, '7.5': evaluarInformacionDocumentada_,
  '8.1': (db) => evaluarPrestaciones_(db, '8.1'), '8.4': evaluarProveedoresExternos_,
  '8.5': (db) => evaluarPrestaciones_(db, '8.5'), '8.6': (db) => evaluarPrestaciones_(db, '8.6'), '8.7': evaluarSalidasNoConformes_,
  '9.1': evaluarSeguimientoMedicion_, '9.2': evaluarAuditoriaInterna_, '9.3': evaluarRevisionDireccion_,
  '10.1': evaluarNoConformidades_, '10.2': evaluarNoConformidades_, '10.3': evaluarMejoraContinua_
};

function evaluarClausula_(db, codigo, excluidas) {
  const exclusiones = (excluidas || exclusionesVigentesPorClausula_(db))[codigo] || [];
  // Una exclusion de la clausula COMPLETA la saca de la evaluacion. Una de
  // sub-clausula NO: el resto de la clausula sigue aplicando.
  const total = exclusiones.find((e) => e.total);
  if (total) {
    return { estado: 'NO_APLICA', resumen: 'Excluida del alcance del SGC.', nota: 'Exclusión declarada en el alcance (§4.3): ' + (total.justificacion || 'sin justificación registrada.'), evidencia: [] };
  }

  const evaluador = EVALUADORES_CLAUSULA_ISO[codigo];
  const r = evaluador ? evaluador(db) : evaluarClausulaSinModulo_(db, codigo);

  if (exclusiones.length) {
    const listado = exclusiones.map((e) => e.clausula).join(', ');
    r.nota = (r.nota ? r.nota + ' ' : '') + 'Con exclusión parcial declarada en el alcance (' + listado + '): el resto de la cláusula sí aplica.';
  }
  return r;
}

// La edición de norma que declara el alcance vigente. Si todavía no hay
// alcance declarado se responde la del sistema, para que la matriz nunca
// quede sin decir contra qué norma está midiendo.
function normaDeclarada_(db) {
  const vigente = alcanceVigente_(db);
  if (vigente && vigente.norma_codigo) return { codigo: vigente.norma_codigo, version: vigente.norma_version, declarada: true };
  return { codigo: NORMA_SGC_POR_DEFECTO.codigo, version: NORMA_SGC_POR_DEFECTO.version, declarada: false };
}

// Agrupa el estado de las 28 clausulas por capitulo de la norma. Una
// clausula PARCIAL vale medio punto; NO_APLICA sale del denominador.
function saludPorCapitulo_(clausulas) {
  return CAPITULOS_ISO.map((cap) => {
    const propias = clausulas.filter((c) => String(c.codigo).split('.')[0] === cap.numero);
    const completo = propias.filter((c) => c.estado === 'COMPLETO').length;
    const parcial = propias.filter((c) => c.estado === 'PARCIAL').length;
    const noAplica = propias.filter((c) => c.estado === 'NO_APLICA').length;
    const aplicables = propias.length - noAplica;
    return {
      numero: cap.numero, titulo: cap.titulo, total: propias.length, aplicables, completo, parcial,
      faltante: aplicables - completo - parcial, no_aplica: noAplica,
      pct: aplicables ? Math.round(((completo + parcial * 0.5) / aplicables) * 100) : 0
    };
  });
}

// El lunes de la semana a la que pertenece una fecha, en YYYY-MM-DD. En
// UTC a propósito: la clave solo tiene que ser ESTABLE y ordenable.
function lunesDeLaSemana_(fecha) {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const dia = d.getUTCDay(); // domingo es 0
  const haciaAtras = (dia === 0) ? 6 : (dia - 1);
  d.setUTCDate(d.getUTCDate() - haciaAtras);
  return d.toISOString().slice(0, 10);
}

/**
 * El cálculo de la matriz, SIN portón. Se separó de listar() porque tiene
 * dos consumidores sin usuario a quien comprobarle el permiso: el tablero
 * del SGC (que ya lo comprobó) y el refresco automático (trigger).
 */
function matrizCalculada_(db) {
  const excluidas = exclusionesVigentesPorClausula_(db);
  const clausulas = CLAUSULAS_ISO9001.map((c) => {
    const r = evaluarClausula_(db, c.codigo, excluidas);
    return { codigo: c.codigo, titulo: c.titulo, estado: r.estado, resumen: r.resumen, total_evidencia: r.evidencia.length, exclusiones: (excluidas[c.codigo] || []).length };
  });

  // NO_APLICA sale del denominador: contarla como faltante castigaría una
  // exclusión legítima; contarla como completa regalaría un punto no trabajado.
  const resumen = { total: clausulas.length, completo: 0, parcial: 0, faltante: 0, no_aplica: 0 };
  clausulas.forEach((c) => {
    if (c.estado === 'NO_APLICA') resumen.no_aplica++;
    else if (c.estado === 'COMPLETO') resumen.completo++;
    else if (c.estado === 'PARCIAL') resumen.parcial++;
    else resumen.faltante++;
  });
  const aplicables = resumen.total - resumen.no_aplica;
  resumen.aplicables = aplicables;
  resumen.pct_listo = aplicables ? Math.round(((resumen.completo + resumen.parcial * 0.5) / aplicables) * 100) : 0;

  return { resumen, clausulas, norma: normaDeclarada_(db) };
}

// ===========================================================================
// API publica
// ===========================================================================

function listar(db, data, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso a la matriz de cobertura ISO.' };
  const calculada = matrizCalculada_(db);
  return { puede_gestionar: gobierna, resumen: calculada.resumen, clausulas: calculada.clausulas, norma: calculada.norma };
}

function getDetalle(db, data, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso a la matriz de cobertura ISO.' };
  const codigo = String((data && data.codigo) || '').trim();
  const clausula = CLAUSULAS_ISO9001.find((c) => c.codigo === codigo);
  if (!clausula) return errorValidacion_('codigo', 'Cláusula no encontrada.');

  const excluidas = exclusionesVigentesPorClausula_(db);
  const r = evaluarClausula_(db, codigo, excluidas);
  return {
    codigo: clausula.codigo, titulo: clausula.titulo, estado: r.estado, resumen: r.resumen, nota: r.nota,
    evidencia: r.evidencia, exclusiones: excluidas[codigo] || [], norma: normaDeclarada_(db)
  };
}

/**
 * La foto de la cobertura de ESTA semana, si todavía no está guardada.
 * IDEMPOTENTE: si la semana ya tiene su foto, no escribe. NO calcula un
 * número nuevo: archiva el MISMO que muestra el tablero (matrizCalculada_).
 */
function archivarFoto(db) {
  const hoy = new Date();
  const periodo = lunesDeLaSemana_(hoy);
  const yaEsta = leerSeguro_(db, 'SGC_COBERTURA_HISTORICO').some((f) => String(f.periodo).slice(0, 10) === periodo);
  if (yaEsta) return { escrita: false, periodo, motivo: 'ya existe' };

  const m = matrizCalculada_(db);
  const porCapitulo = {};
  saludPorCapitulo_(m.clausulas).forEach((c) => { porCapitulo[c.numero] = c.pct; });

  const fila = {
    cobertura_id: uuid_(), periodo, fecha: hoy.toISOString().slice(0, 10),
    pct_listo: m.resumen.pct_listo, aplicables: m.resumen.aplicables, no_aplica: m.resumen.no_aplica,
    completo: m.resumen.completo, parcial: m.resumen.parcial, faltante: m.resumen.faltante, origen: 'automatico'
  };
  ['4', '5', '6', '7', '8', '9', '10'].forEach((n) => { fila['cap_' + n] = porCapitulo[n] || 0; });

  agregarFila_(db, 'SGC_COBERTURA_HISTORICO', fila);
  return { escrita: true, periodo, pct_listo: fila.pct_listo };
}

/** Las fotos guardadas, de la más antigua a la más nueva. Mismo portón que la matriz. */
function listarHistorico(db, data, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso a la matriz de cobertura ISO.' };

  const fotos = leerSeguro_(db, 'SGC_COBERTURA_HISTORICO')
    .filter((f) => !!String(f.periodo || '').trim())
    .map((f) => ({
      periodo: String(f.periodo).slice(0, 10), fecha: String(f.fecha || '').slice(0, 10),
      pct_listo: Number(f.pct_listo) || 0, aplicables: Number(f.aplicables) || 0, no_aplica: Number(f.no_aplica) || 0,
      completo: Number(f.completo) || 0, parcial: Number(f.parcial) || 0, faltante: Number(f.faltante) || 0,
      capitulos: ['4', '5', '6', '7', '8', '9', '10'].map((n) => ({ numero: n, pct: Number(f['cap_' + n]) || 0 }))
    }))
    .sort((a, b) => a.periodo.localeCompare(b.periodo));

  const m = matrizCalculada_(db);
  return {
    puede_gestionar: gobierna,
    // Sin esto, "la hoja no existe" y "todavía no hay fotos" se ven IGUAL.
    hoja_lista: hojaExiste_(db, 'SGC_COBERTURA_HISTORICO'),
    fotos, actual: { pct_listo: m.resumen.pct_listo, aplicables: m.resumen.aplicables },
    aviso: MENSAJE_INDICADOR_INTERNO
  };
}

module.exports = {
  listar, getDetalle, archivarFoto, listarHistorico,
  // Expuestos para tests y para el futuro refresco de Tablero (v11 Fase 7).
  matrizCalculada_, saludPorCapitulo_, lunesDeLaSemana_
};
