'use strict';

/**
 * caminoSgc.js — SIGSO v2, Módulo 8A: "Camino a la certificación" (Inicio
 * de Calidad). Análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md.
 *
 * Sobre la matriz de cobertura que ya existe (matrizCoberturaSgc), agrega:
 *  - por cláusula, el PRÓXIMO PASO concreto y la sección de Calidad que lo
 *    resuelve (decisión del dueño: guía, no solo porcentaje);
 *  - SUGERENCIAS DE ETIQUETAS: ninguno de los 38 documentos vigentes tenía
 *    cláusulas ISO etiquetadas, así que la cobertura marcaba como faltante lo
 *    que existe (p. ej. la Política de Calidad → 5.2). Se sugieren por el
 *    nombre del documento y el encargado las confirma; aplicarlas pasa por
 *    Calidad.actualizarDocumento (mismas reglas y permisos).
 *
 * Lo ve quien supervisa el SGC (la misma llave que el tablero clásico:
 * Encargado, ADM, Dirección, Gerencia); etiquetar es solo de quien lo gobierna.
 */

const { leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const MatrizCobertura = require('./matrizCoberturaSgc');
const { parsearListaPortal } = require('./portal');

function leer_(db, hoja) { try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (e) { return []; } }
function v_(x) { return x === true || x === 'TRUE' || x === 1; }
function sinTildes_(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

const CAPITULOS = {
  4: 'Contexto de la organización', 5: 'Liderazgo', 6: 'Planificación', 7: 'Apoyo',
  8: 'Operación', 9: 'Evaluación del desempeño', 10: 'Mejora'
};

// Próximo paso por cláusula: qué hacer y en qué sección de Calidad.
const PASOS = {
  '4.1': ['Completa el análisis de contexto (cuestiones internas y externas).', 'contexto'],
  '4.2': ['Registra las partes interesadas y sus requisitos.', 'contexto'],
  '4.3': ['Declara el alcance del SGC y justifica lo que no aplica.', 'alcance'],
  '4.4': ['Completa el mapa de procesos con sus entradas, salidas y responsables.', 'procesos'],
  '5.1': ['Deja evidencia del compromiso de la dirección: etiqueta el Manual o la Misión/Visión con 5.1 y registra la revisión por la dirección.', 'documentos'],
  '5.2': ['Etiqueta la Política de Calidad con la cláusula 5.2 y pide su acuse a todo el personal.', 'documentos'],
  '5.3': ['Etiqueta los organigramas y descriptores de cargo con la cláusula 5.3.', 'documentos'],
  '6.1': ['Completa la matriz de riesgos y oportunidades con sus acciones.', 'riesgos'],
  '6.2': ['Registra al menos una medición de cada objetivo de calidad este año.', 'objetivos'],
  '6.3': ['Documenta cómo se planifican los cambios del SGC (p. ej. en el Manual) y etiquétalo con 6.3.', 'documentos'],
  '7.1': ['Deja evidencia de los recursos (personas, infraestructura, ambiente): etiqueta los documentos que lo respalden con 7.1.', 'documentos'],
  '7.2': ['Mantén al día descriptores de cargo, evaluaciones y capacitaciones.', 'personas'],
  '7.3': ['Registra las inducciones que ya se hicieron (Personas).', 'personas'],
  '7.4': ['Etiqueta el plan o matriz de comunicaciones con 7.4.', 'documentos'],
  '7.5': ['Controla la información documentada: versiones vigentes, acuses y documentos externos.', 'documentos'],
  '8.1': ['Relaciona los procesos operativos con los servicios que se prestan.', 'procesos'],
  '8.2': ['Registra los requisitos de los servicios (fichas por cliente/servicio).', 'servicios'],
  '8.3': ['Si no diseñan servicios nuevos, declárala "no aplica" en el Alcance con su justificación.', 'alcance'],
  '8.4': ['Mantén la lista de proveedores aprobados y sus evaluaciones.', 'proveedores'],
  '8.5': ['Registra los servicios prestados y su control.', 'servicios'],
  '8.6': ['Registra la liberación/conformidad de los servicios prestados.', 'servicios'],
  '8.7': ['Registra servicios prestados y marca las salidas no conformes cuando ocurran.', 'servicios'],
  '9.1': ['Define indicadores de proceso y registra sus lecturas; mide los objetivos.', 'indicadores'],
  '9.2': ['Registra la auditoría interna: programa, plan, hallazgos e informe.', 'auditorias'],
  '9.3': ['Registra la revisión por la dirección con sus acuerdos.', 'revision'],
  '10.1': ['Registra las no conformidades y oportunidades de mejora detectadas.', 'nc'],
  '10.2': ['Registra las no conformidades (p. ej. hallazgos de auditoría) y su acción correctiva.', 'nc'],
  '10.3': ['Registra acuerdos de mejora en la revisión por la dirección.', 'revision']
};

// Sugerencias por nombre del documento (ISO 9001:2015). Se proponen, no se aplican solas.
const REGLAS_ETIQUETAS = [
  [/politica de (la )?calidad/, ['5.2']],
  [/objetivos de (la )?calidad/, ['6.2']],
  [/organigrama/, ['5.3']],
  [/manual de (la )?calidad/, ['4.3', '4.4']],
  [/mapa de procesos/, ['4.4']],
  [/foda|analisis de contexto/, ['4.1']],
  [/partes interesadas/, ['4.2']],
  [/matriz de riesgos|riesgos y oportunidades/, ['6.1']],
  [/\bmision\b|\bvision\b/, ['5.1']],
  [/control de documentos|listado maestro/, ['7.5']],
  [/induccion/, ['7.3']],
  [/recursos humanos|descriptor de cargo|capacitacion|monitoreo del personal/, ['7.2']],
  [/auditoria interna|lista de verificacion/, ['9.2']],
  [/revision por la direccion/, ['9.3']],
  [/no conformidad/, ['10.2']],
  [/quejas/, ['9.1']],
  [/proveedores|adquisiciones|solicitud de material/, ['8.4']],
  [/^documentos (de )?servicios a clientes?/, ['8.2']],
  [/comunicacion/, ['7.4']]
];

function sugerencias_(db) {
  return leer_(db, 'SGC_DOCUMENTOS')
    .filter((d) => v_(d.activa) && d.estado === 'VIGENTE')
    .map((d) => {
      const actuales = Calidad.parsearClausulasIso_(d.clausulas_iso);
      const nombre = sinTildes_(d.nombre);
      const sugeridas = [];
      REGLAS_ETIQUETAS.forEach((r) => { if (r[0].test(nombre)) r[1].forEach((c) => { if (sugeridas.indexOf(c) === -1) sugeridas.push(c); }); });
      const nuevas = sugeridas.filter((c) => actuales.indexOf(c) === -1);
      return { documento_id: d.documento_id, codigo: d.codigo, nombre: d.nombre, actuales: actuales, sugeridas: nuevas };
    })
    .filter((s) => s.sugeridas.length);
}

// Cumplimiento de acuse de cada documento vigente que lo exige, en un solo
// viaje (getCumplimientoDocumentoSgc es por documento). Quien no tiene cuenta
// activa en SIGSO no puede confirmar: se separa y no cuenta como pendiente.
function cuentasActivas_(db) {
  const m = {};
  leer_(db, 'CUENTAS_PORTAL').forEach((c) => {
    if (!v_(c.activo)) return;
    parsearListaPortal(c.emails).forEach((e) => { const n = String(e || '').trim().toLowerCase(); if (n) m[n] = { nunca_entro: !c.ultimo_acceso }; });
  });
  return m;
}
function acuses_(db) {
  const cuentas = cuentasActivas_(db);
  const hechos = leer_(db, 'SGC_DOC_ACUSES');
  return leer_(db, 'SGC_DOCUMENTOS')
    .filter((d) => v_(d.activa) && d.estado === 'VIGENTE' && v_(d.requiere_acuse))
    .map((d) => {
      const ya = {};
      hechos.forEach((a) => { if (a.documento_id === d.documento_id && a.version === d.version_vigente) ya[String(a.usuario_email || '').trim().toLowerCase()] = true; });
      const obligados = Calidad.audienciaDocumentoSgc_(db, d);
      const faltan = obligados.filter((e) => !ya[e]);
      return {
        documento_id: d.documento_id, codigo: d.codigo, nombre: d.nombre, version: d.version_vigente,
        fecha_limite_acuse: d.fecha_limite_acuse || '',
        confirmados: obligados.length - faltan.length,
        pendientes: faltan.filter((e) => cuentas[e]).map((e) => ({ email: e, nunca_entro: cuentas[e].nunca_entro })),
        sin_cuenta: faltan.filter((e) => !cuentas[e])
      };
    })
    .sort((a, b) => b.pendientes.length - a.pendientes.length || String(a.codigo).localeCompare(String(b.codigo)));
}

// Qué pasaría si se confirman TODAS las sugerencias: se aplican dentro de
// una transacción que se revierte siempre (node:sqlite es síncrono, nadie
// alcanza a leer el estado intermedio). Así el Inicio promete el efecto
// real ("32% → 45%") y no una cuenta de cláusulas que quizá ya estaban listas.
function efectoSugerencias_(db, sug, antes) {
  if (!sug.length) return null;
  const previo = {};
  antes.clausulas.forEach((c) => { previo[c.codigo] = c.estado; });
  db.exec('BEGIN');
  try {
    sug.forEach((x) => actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', x.documento_id, { clausulas_iso: JSON.stringify(x.actuales.concat(x.sugeridas)) }));
    const m = MatrizCobertura.matrizCalculada_(db);
    return {
      pct_listo: m.resumen.pct_listo,
      mejoran: m.clausulas.filter((c) => c.estado !== previo[c.codigo]).map((c) => ({ codigo: c.codigo, antes: previo[c.codigo], despues: c.estado }))
    };
  } finally {
    db.exec('ROLLBACK');
  }
}

function getCamino(db, data, contexto) {
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, Calidad.rolSgc_(db, contexto), gobierna)) {
    return { _forbidden: true, message: 'El camino a la certificación es para quien supervisa el SGC.' };
  }
  const m = MatrizCobertura.matrizCalculada_(db);
  const capitulos = {};
  const clausulas = m.clausulas.map((c) => {
    const cap = Number(String(c.codigo).split('.')[0]);
    const k = capitulos[cap] || (capitulos[cap] = { capitulo: cap, nombre: CAPITULOS[cap] || '', completo: 0, parcial: 0, faltante: 0, no_aplica: 0 });
    const e = String(c.estado || '').toLowerCase();
    if (k[e] !== undefined) k[e]++;
    const paso = PASOS[c.codigo] || ['', ''];
    return { codigo: c.codigo, titulo: c.titulo, estado: c.estado, resumen: c.resumen || '', nota: c.nota || '', paso: paso[0], seccion: paso[1] };
  });
  // Las sugerencias solo sirven a quien puede aplicarlas.
  const sug = gobierna ? sugerencias_(db) : [];
  return {
    resumen: m.resumen,
    capitulos: Object.keys(capitulos).map((k) => capitulos[k]).sort((a, b) => a.capitulo - b.capitulo),
    clausulas: clausulas,
    puede_etiquetar: gobierna,
    sugerencias: sug,
    acuses: acuses_(db),
    efecto_sugerencias: efectoSugerencias_(db, sug, m)
  };
}

async function aplicarEtiquetas(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden etiquetar documentos.' };
  const items = Array.isArray(data && data.items) ? data.items : [];
  if (!items.length) return { _validationError: true, message: 'No hay etiquetas que aplicar.' };
  const docs = {};
  leer_(db, 'SGC_DOCUMENTOS').forEach((d) => { docs[d.documento_id] = d; });
  let aplicados = 0;
  const fallas = [];
  for (const it of items) {
    const d = docs[it && it.documento_id];
    if (!d) { fallas.push('Documento no encontrado'); continue; }
    const union = Calidad.parsearClausulasIso_(d.clausulas_iso);
    (Array.isArray(it.clausulas) ? it.clausulas : []).forEach((c) => { if (union.indexOf(c) === -1) union.push(c); });
    const r = await Calidad.actualizarDocumento(db, { documento_id: d.documento_id, clausulas_iso: union }, contexto);
    if (r && (r._validationError || r._forbidden)) fallas.push(d.codigo + ': ' + r.message); else aplicados++;
  }
  return { aplicados: aplicados, fallas: fallas, resumen: MatrizCobertura.matrizCalculada_(db).resumen };
}

module.exports = { getCamino, aplicarEtiquetas, sugerencias_ };
