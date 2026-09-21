'use strict';

/**
 * personasSgc.js — puerto de backend/backoffice/Personas.gs (SGC ISO 9001,
 * Fase 2a + Fase 2b, PRO-02): LA FICHA DEL TRABAJADOR -- datos, descriptor
 * de cargo versionado, carpeta digital de documentos, induccion y monitoreo
 * de competencias (evaluaciones + capacitaciones). Es la evidencia de ISO
 * §7.2 (competencia): "¿como determina la organizacion la competencia
 * necesaria y como demuestra que su gente la tiene?".
 *
 * NO se toca USUARIOS (autenticacion, la usa todo SIGSO; 6 de 13 personas en
 * alcance del SGC son externas y ni siquiera estan ahi). La ficha vive en su
 * propia tabla, enlazada por correo -- mismo criterio que el rol SGC vive en
 * SGC_ROLES y no en el rol global.
 *
 * v14.0: una persona puede tener MAS DE UN CARGO (correo + cargo identifica
 * cada ficha, no solo el correo), cada uno con su propio descriptor/
 * induccion/evaluaciones -- pero ambos entran con la MISMA cuenta.
 *
 * Permiso central del modulo (§3 de la especificacion): el personal
 * operativo ve UNICAMENTE su(s) propia(s) ficha(s); la jefatura ve la suya y
 * la de su equipo; quien gobierna el SGC (o tiene lectura total) ve todas.
 *
 * Archivos (descriptor, documentos de la persona) usan R2 desde
 * 2026-09-18, vía `Calidad.subirArchivoSgc_` -- mismo helper compartido
 * que usa calidadSgc.js (en el `.gs` es una función global del mismo
 * proyecto Apps Script; en Node se importa en vez de duplicarse).
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Jefatura = require('./jefatura');
const Notificaciones = require('./notificaciones');
const NotificacionesApp = require('./notificacionesApp');
const Almacenamiento = require('./almacenamiento');

const ITEMS_INDUCCION_SGC = ['Organigrama', 'Política de Calidad', 'Objetivos de Calidad', 'Descriptor de cargo', 'Inducción ISO 9001'];
const TIPOS_DOC_PERSONA_SGC = ['CV', 'TITULO', 'ISO9001', 'CONTRATO', 'CERTIFICADO', 'OTRO'];
const ESCALA_EVALUACION_SGC = [
  { valor: 1, texto: 'No cumple' }, { valor: 2, texto: 'Cumple en algunas ocasiones' },
  { valor: 3, texto: 'Cumple en la mayoría de los casos' }, { valor: 4, texto: 'Cumple en su totalidad' }
];
const UMBRAL_CAPACITACION_SGC = 3;
const META_HORAS_FORMACION_SGC = 5;

function uuid_() { return crypto.randomUUID(); }
function errorValidacion_(campo, mensaje) { return { _validationError: true, campo, message: mensaje }; }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function esActivo_(fila) { return esVerdadero_(fila.activa); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leerSeguro_(db, hoja) { try { return leer_(db, hoja); } catch (err) { return []; } }
function registrarLogSgc_(db, accion, detalle, contexto) {
  try {
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: uuid_(), timestamp: new Date().toISOString(), contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle, ref: 'SGC'
    });
  } catch (err) { /* trazabilidad, no el flujo principal */ }
}
function inicioSemanaUTC_(fecha) {
  const diaSemana = fecha.getUTCDay();
  const offsetLunes = (diaSemana + 6) % 7;
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() - offsetLunes));
}
// --- permisos ----------------------------------------------------------------
function puedeVerPersona_(db, persona, contexto, rol, gobierna) {
  if (!contexto) return false;
  if (Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return true;
  const email = normalizarEmail_(contexto.email);
  if (normalizarEmail_(persona.usuario_email) === email) return true;
  return esJefaturaDe_(db, persona, contexto);
}
function esJefaturaDe_(db, persona, contexto) {
  const email = normalizarEmail_(contexto && contexto.email);
  if (!email) return false;
  if (normalizarEmail_(persona.jefatura_email) === email) return true;
  const equipo = Jefatura.obtenerEquipoJefe_(db, email) || [];
  return equipo.map(normalizarEmail_).indexOf(normalizarEmail_(persona.usuario_email)) !== -1;
}

// --- helpers -------------------------------------------------------------
function buscarPersonaSgc_(db, personaId) {
  if (!personaId) return null;
  return leerSeguro_(db, 'SGC_PERSONAS').find((p) => p.persona_id === personaId && esActivo_(p)) || null;
}
function normalizarItemsDescriptor_(valor) {
  let lista = valor;
  if (typeof lista === 'string') lista = lista.split('\n');
  if (!Array.isArray(lista)) return [];
  return lista.map((s) => String(s || '').trim()).filter(Boolean);
}
function parsearItemsDescriptor_(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor;
  try { const parsed = JSON.parse(valor); return Array.isArray(parsed) ? parsed : []; } catch (err) { return []; }
}
function descriptorVigenteDe_(db, personaId) {
  return leerSeguro_(db, 'SGC_DESCRIPTORES').find((d) => d.persona_id === personaId && esVerdadero_(d.vigente)) || null;
}
function puntuarItemsEvaluacion_(items, respuestas) {
  const resultado = [];
  for (let i = 0; i < items.length; i++) {
    const crudo = respuestas ? respuestas[i] : undefined;
    const valor = Number(crudo);
    if (!(valor >= 1 && valor <= 4)) return errorValidacion_('respuestas', 'Falta calificar "' + items[i] + '" (escala 1 a 4).');
    resultado.push({ item: items[i], valor });
  }
  return resultado;
}
function promedioItems_(puntuados) {
  if (!puntuados.length) return 0;
  let suma = 0;
  puntuados.forEach((p) => { suma += p.valor; });
  return Math.round((suma / puntuados.length) * 100) / 100;
}
function buscarCapacitacionSgc_(db, capacitacionId) {
  if (!capacitacionId) return null;
  return leerSeguro_(db, 'SGC_CAPACITACIONES').find((c) => c.capacitacion_id === capacitacionId && esActivo_(c)) || null;
}
function sumarMesesSgc_(fecha, meses) {
  const f = new Date(fecha);
  if (isNaN(f.getTime())) return '';
  const r = new Date(f.getTime());
  r.setMonth(r.getMonth() + meses);
  return r.toISOString();
}
function eficaciaPendienteAsistenteSgc_(capacitacion, asistente) {
  if (capacitacion.estado !== 'REALIZADA' || asistente.eficacia_resultado) return false;
  if (!capacitacion.fecha_realizada) return false;
  const dias = (new Date() - new Date(capacitacion.fecha_realizada)) / 86400000;
  return dias >= 60;
}
function horasFormacionPorPersonaSgc_(db, anio) {
  const capacitaciones = leerSeguro_(db, 'SGC_CAPACITACIONES').filter((c) => esActivo_(c) && c.estado === 'REALIZADA' && c.fecha_realizada && !isNaN(new Date(c.fecha_realizada).getTime()) && new Date(c.fecha_realizada).getFullYear() === Number(anio));
  const horasPorId = {};
  capacitaciones.forEach((c) => { horasPorId[c.capacitacion_id] = Number(c.horas) || 0; });
  const acumulado = {};
  leerSeguro_(db, 'SGC_CAPACITACION_ASISTENTES').forEach((a) => {
    if (!esVerdadero_(a.asistio) || horasPorId[a.capacitacion_id] === undefined) return;
    acumulado[a.persona_id] = (acumulado[a.persona_id] || 0) + horasPorId[a.capacitacion_id];
  });
  return leerSeguro_(db, 'SGC_PERSONAS').filter((p) => esActivo_(p) && p.estado !== 'DESVINCULADO')
    .map((p) => ({ persona_id: p.persona_id, nombre: p.nombre, horas: acumulado[p.persona_id] || 0 }))
    .sort((a, b) => a.horas - b.horas);
}

// ===========================================================================
// API publica
// ===========================================================================

function listar(db, data, contexto) {
  const filtros = data || {};
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  const todas = (filtros.incluir_fuera_alcance && gobierna) ? leerSeguro_(db, 'SGC_PERSONAS') : leerSeguro_(db, 'SGC_PERSONAS').filter(esActivo_);
  let visibles = todas.filter((p) => puedeVerPersona_(db, p, contexto, rol, gobierna));
  if (!filtros.incluir_desvinculados) visibles = visibles.filter((p) => p.estado !== 'DESVINCULADO');
  if (filtros.area_id) visibles = visibles.filter((p) => p.area_id === filtros.area_id);
  if (filtros.tipo) visibles = visibles.filter((p) => p.tipo === filtros.tipo);

  const descriptores = leerSeguro_(db, 'SGC_DESCRIPTORES');
  const inducciones = leerSeguro_(db, 'SGC_INDUCCIONES');

  return {
    puede_gestionar: gobierna, rol_sgc: rol || 'OPERATIVO',
    personas: visibles.map((p) => {
      const suyos = descriptores.filter((d) => d.persona_id === p.persona_id);
      const vigente = suyos.find((d) => esVerdadero_(d.vigente));
      const indPersona = inducciones.filter((i) => i.persona_id === p.persona_id);
      const completadas = indPersona.filter((i) => i.estado === 'COMPLETADA').length;
      return {
        persona_id: p.persona_id, usuario_email: p.usuario_email, nombre: p.nombre, cargo: p.cargo,
        tipo: p.tipo, area_id: p.area_id, jefatura_email: p.jefatura_email, fecha_ingreso: p.fecha_ingreso,
        estado: p.estado, fuera_de_alcance: !esActivo_(p),
        tiene_descriptor: !!vigente, descriptor_version: vigente ? vigente.version : '',
        induccion_completadas: completadas, induccion_total: indPersona.length || ITEMS_INDUCCION_SGC.length
      };
    }).sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
  };
}

function getFicha(db, data, contexto) {
  const persona = buscarPersonaSgc_(db, data.persona_id);
  if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!puedeVerPersona_(db, persona, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso a esta ficha.' };

  const descriptores = leerSeguro_(db, 'SGC_DESCRIPTORES').filter((d) => d.persona_id === persona.persona_id)
    .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
    .map((d) => Object.assign({}, d, { items_responsabilidades: parsearItemsDescriptor_(d.items_responsabilidades), items_habilidades: parsearItemsDescriptor_(d.items_habilidades) }));
  const documentos = leerSeguro_(db, 'SGC_PERSONA_DOCUMENTOS').filter((d) => d.persona_id === persona.persona_id && esActivo_(d));
  const induccion = leerSeguro_(db, 'SGC_INDUCCIONES').filter((i) => i.persona_id === persona.persona_id);

  const evaluaciones = leerSeguro_(db, 'SGC_EVALUACIONES').filter((e) => e.persona_id === persona.persona_id)
    .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
    .map((e) => ({
      evaluacion_id: e.evaluacion_id, fecha: e.fecha, evaluador_email: e.evaluador_email,
      respuestas_responsabilidades: parsearItemsDescriptor_(e.respuestas_responsabilidades),
      respuestas_habilidades: parsearItemsDescriptor_(e.respuestas_habilidades),
      promedio_responsabilidades: Number(e.promedio_responsabilidades) || 0,
      promedio_habilidades: Number(e.promedio_habilidades) || 0,
      requiere_capacitacion: esVerdadero_(e.requiere_capacitacion),
      observaciones: e.observaciones, recomendado_por: e.recomendado_por, proxima_evaluacion: e.proxima_evaluacion
    }));
  const ultimaEval = evaluaciones[0] || null;
  const descriptorVigente = descriptores.find((d) => esVerdadero_(d.vigente)) || null;

  return {
    persona, puede_gestionar: gobierna,
    puede_gestionar_induccion: gobierna || esJefaturaDe_(db, persona, contexto),
    puede_evaluar: (gobierna || esJefaturaDe_(db, persona, contexto)) &&
      !(normalizarEmail_(persona.usuario_email) === normalizarEmail_(contexto.email) && !gobierna),
    escala_evaluacion: ESCALA_EVALUACION_SGC,
    evaluaciones, ultima_evaluacion: ultimaEval,
    evaluacion_vencida: !ultimaEval || (ultimaEval.proxima_evaluacion && new Date(ultimaEval.proxima_evaluacion) < new Date()),
    horas_formacion_anio: (horasFormacionPorPersonaSgc_(db, new Date().getFullYear()).find((h) => h.persona_id === persona.persona_id) || { horas: 0 }).horas,
    meta_horas_formacion: META_HORAS_FORMACION_SGC,
    descriptores, descriptor_vigente: descriptorVigente,
    items_responsabilidades: descriptorVigente ? parsearItemsDescriptor_(descriptorVigente.items_responsabilidades) : [],
    items_habilidades: descriptorVigente ? parsearItemsDescriptor_(descriptorVigente.items_habilidades) : [],
    documentos, induccion
  };
}

function guardarPersona(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden gestionar el personal.' };
  const nombre = String(data.nombre || '').trim();
  if (!nombre) return errorValidacion_('nombre', 'El nombre es obligatorio.');
  const email = normalizarEmail_(data.usuario_email);
  if (!email) return errorValidacion_('usuario_email', 'El correo es obligatorio: es lo que enlaza la ficha con su cuenta.');
  if (['INT', 'EXT'].indexOf(data.tipo) === -1) return errorValidacion_('tipo', 'Indica si la persona es interna (INT) o externa (EXT).');

  // v14.0: solo se bloquea el duplicado EXACTO (mismo correo, mismo cargo).
  // node:sqlite es sincrono y Node es de un solo hilo para JS: leer+crear no
  // puede intercalarse entre dos peticiones, misma garantia que el
  // LockService del .gs le daba a Apps Script (ahi si hay paralelismo real)
  // -- ver la misma nota en correlativo.js. Antes este chequeo solo corria
  // al CREAR -- editar una ficha para dejarla con el mismo correo+cargo de
  // OTRA ficha activa no se validaba nunca.
  if (data.persona_id) {
    const existente = buscarPersonaSgc_(db, data.persona_id);
    if (!existente) return errorValidacion_('persona_id', 'Persona no encontrada.');
    const cargoEfectivo = String((data.cargo !== undefined ? data.cargo : existente.cargo) || '').trim().toLowerCase();
    const yaExiste = leerSeguro_(db, 'SGC_PERSONAS').find((p) =>
      esActivo_(p) && p.persona_id !== data.persona_id && normalizarEmail_(p.usuario_email) === email && String(p.cargo || '').trim().toLowerCase() === cargoEfectivo);
    if (yaExiste) return errorValidacion_('cargo', 'Ya existe otra ficha con ese cargo para ' + email + '. Si es un cargo distinto (ej. interno/externo), escribe un Cargo que lo diferencie.');
    const cambios = {};
    ['nombre', 'rut', 'cargo', 'tipo', 'area_id', 'jefatura_email', 'subrogante_email', 'fecha_ingreso'].forEach((campo) => { if (data[campo] !== undefined) cambios[campo] = data[campo]; });
    if (data.usuario_email !== undefined) cambios.usuario_email = email;
    return actualizarFilaPorId_(db, 'SGC_PERSONAS', 'persona_id', existente.persona_id, cambios);
  }

  const cargoNuevo = String(data.cargo || '').trim().toLowerCase();
  const yaExiste = leerSeguro_(db, 'SGC_PERSONAS').find((p) => esActivo_(p) && normalizarEmail_(p.usuario_email) === email && String(p.cargo || '').trim().toLowerCase() === cargoNuevo);
  if (yaExiste) return errorValidacion_('cargo', 'Ya existe una ficha con ese cargo para ' + email + '. Si es un cargo distinto (ej. interno/externo), escribe un Cargo que lo diferencie.');

  const ahora = new Date();
  const persona = {
    persona_id: uuid_(), usuario_email: email, nombre, rut: data.rut || '', cargo: data.cargo || '', tipo: data.tipo,
    area_id: data.area_id || '',
    jefatura_email: normalizarEmail_(data.jefatura_email) || normalizarEmail_(Jefatura.jefeDeSubordinado_(db, email)),
    subrogante_email: normalizarEmail_(data.subrogante_email), fecha_ingreso: data.fecha_ingreso || '',
    estado: 'ACTIVO', fecha_desvinculacion: '', creado_por: contexto.email || '', fecha_creacion: ahora.toISOString(), activa: true
  };
  agregarFila_(db, 'SGC_PERSONAS', persona);

  ITEMS_INDUCCION_SGC.forEach((item) => {
    agregarFila_(db, 'SGC_INDUCCIONES', { induccion_id: uuid_(), persona_id: persona.persona_id, item, fecha: '', relator_email: '', estado: 'PENDIENTE', observaciones: '' });
  });
  registrarLogSgc_(db, 'SGC_PERSONA_CREADA', persona.nombre + ' (' + email + ')', contexto);
  return persona;
}

function desvincular(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden desvincular.' };
  const persona = buscarPersonaSgc_(db, data.persona_id);
  if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
  if (data.reactivar === true) {
    return actualizarFilaPorId_(db, 'SGC_PERSONAS', 'persona_id', persona.persona_id, { estado: 'ACTIVO', fecha_desvinculacion: '' });
  }
  const actualizado = actualizarFilaPorId_(db, 'SGC_PERSONAS', 'persona_id', persona.persona_id, { estado: 'DESVINCULADO', fecha_desvinculacion: data.fecha_desvinculacion || new Date().toISOString() });
  registrarLogSgc_(db, 'SGC_PERSONA_DESVINCULADA', persona.nombre, contexto);
  return actualizado;
}

function quitarDelAlcance(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden quitar a alguien del alcance del SGC.' };
  const fila = leerSeguro_(db, 'SGC_PERSONAS').find((p) => p.persona_id === data.persona_id);
  if (!fila) return errorValidacion_('persona_id', 'Persona no encontrada.');
  if (data.reactivar === true) {
    const vuelta = actualizarFilaPorId_(db, 'SGC_PERSONAS', 'persona_id', fila.persona_id, { activa: true });
    registrarLogSgc_(db, 'SGC_PERSONA_REINCLUIDA_ALCANCE', fila.nombre, contexto);
    return vuelta;
  }
  const quitada = actualizarFilaPorId_(db, 'SGC_PERSONAS', 'persona_id', fila.persona_id, { activa: false });
  registrarLogSgc_(db, 'SGC_PERSONA_FUERA_DE_ALCANCE', fila.nombre, contexto);
  return quitada;
}

async function guardarDescriptor(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden editar descriptores.' };
  const persona = buscarPersonaSgc_(db, data.persona_id);
  if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
  const version = String(data.version || '').trim();
  if (!version) return errorValidacion_('version', 'Indica la versión del descriptor (ej. v01).');
  if (!String(data.objetivo || '').trim()) return errorValidacion_('objetivo', 'El objetivo general del cargo es obligatorio.');

  const itemsResp = normalizarItemsDescriptor_(data.items_responsabilidades);
  const itemsHab = normalizarItemsDescriptor_(data.items_habilidades);

  let archivo = { archivo_id: '', archivo_nombre: '', archivo_mime: '' };
  if (data.contenido_base64) {
    const subido = await Calidad.subirArchivoSgc_(data, 'DESCRIPTOR-' + (persona.rut || persona.nombre));
    if (subido._validationError) return subido;
    archivo = subido;
  }

  leerSeguro_(db, 'SGC_DESCRIPTORES').forEach((d) => {
    if (d.persona_id === persona.persona_id && esVerdadero_(d.vigente)) actualizarFilaPorId_(db, 'SGC_DESCRIPTORES', 'descriptor_id', d.descriptor_id, { vigente: false });
  });

  const descriptor = {
    descriptor_id: uuid_(), persona_id: persona.persona_id, version, objetivo: data.objetivo || '', funciones: data.funciones || '',
    responsabilidades: data.responsabilidades || '', habilidades: data.habilidades || '',
    items_responsabilidades: JSON.stringify(itemsResp), items_habilidades: JSON.stringify(itemsHab),
    nivel_educacional: data.nivel_educacional || '', formacion_tecnica: data.formacion_tecnica || '', experiencia: data.experiencia || '',
    archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre, archivo_mime: archivo.archivo_mime,
    vigente: true, creado_por: contexto.email || '', fecha: new Date().toISOString()
  };
  agregarFila_(db, 'SGC_DESCRIPTORES', descriptor);
  registrarLogSgc_(db, 'SGC_DESCRIPTOR', persona.nombre + ' ' + version, contexto);
  return descriptor;
}

async function actualizarDescriptor(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden editar descriptores.' };
  const persona = buscarPersonaSgc_(db, data.persona_id);
  if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
  const desc = leerSeguro_(db, 'SGC_DESCRIPTORES').find((d) => d.descriptor_id === data.descriptor_id && d.persona_id === persona.persona_id && esVerdadero_(d.vigente));
  if (!desc) return errorValidacion_('descriptor_id', 'Descriptor no encontrado o ya no es la versión vigente.');
  if (!String(data.objetivo || '').trim()) return errorValidacion_('objetivo', 'El objetivo general del cargo es obligatorio.');

  const cambios = {
    objetivo: data.objetivo || '', funciones: data.funciones || '', responsabilidades: data.responsabilidades || '', habilidades: data.habilidades || '',
    items_responsabilidades: JSON.stringify(normalizarItemsDescriptor_(data.items_responsabilidades)),
    items_habilidades: JSON.stringify(normalizarItemsDescriptor_(data.items_habilidades)),
    nivel_educacional: data.nivel_educacional || '', formacion_tecnica: data.formacion_tecnica || '', experiencia: data.experiencia || ''
  };
  if (data.contenido_base64) {
    const subido = await Calidad.subirArchivoSgc_(data, 'DESCRIPTOR-' + (persona.rut || persona.nombre));
    if (subido._validationError) return subido;
    cambios.archivo_id = subido.archivo_id; cambios.archivo_nombre = subido.archivo_nombre; cambios.archivo_mime = subido.archivo_mime;
  }
  actualizarFilaPorId_(db, 'SGC_DESCRIPTORES', 'descriptor_id', desc.descriptor_id, cambios);
  registrarLogSgc_(db, 'SGC_DESCRIPTOR_EDITADO', persona.nombre + ' ' + desc.version, contexto);
  return { descriptor_id: desc.descriptor_id };
}

async function descargarDescriptor(db, data, contexto) {
  const persona = buscarPersonaSgc_(db, data.persona_id);
  if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
  const rol = Calidad.rolSgc_(db, contexto);
  if (!puedeVerPersona_(db, persona, contexto, rol, Calidad.gobiernaSgc_(db, contexto))) return { _forbidden: true, message: 'No tienes acceso a esta ficha.' };
  const desc = leerSeguro_(db, 'SGC_DESCRIPTORES').find((d) => d.descriptor_id === data.descriptor_id && d.persona_id === persona.persona_id);
  if (!desc) return errorValidacion_('descriptor_id', 'Descriptor no encontrado.');
  if (!desc.archivo_id) return errorValidacion_('descriptor_id', 'Este descriptor no tiene archivo adjunto.');

  const descarga = await Almacenamiento.descargarArchivo_(desc.archivo_id);
  if (!descarga.ok) return errorValidacion_('descriptor_id', descarga.message);
  registrarLogSgc_(db, 'SGC_DESCRIPTOR_DESCARGADO', persona.nombre + ' ' + desc.version, contexto);
  return {
    contenido_base64: descarga.contenido_base64,
    nombre_archivo: desc.archivo_nombre || '',
    mime: desc.archivo_mime || 'application/octet-stream'
  };
}

async function guardarDocumento(db, data, contexto) {
  const persona = buscarPersonaSgc_(db, data.persona_id);
  if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden cargar documentos del personal.' };
  if (data.accion === 'eliminar') {
    if (!data.doc_id) return errorValidacion_('doc_id', 'Falta indicar el documento.');
    return actualizarFilaPorId_(db, 'SGC_PERSONA_DOCUMENTOS', 'doc_id', data.doc_id, { activa: false });
  }
  if (TIPOS_DOC_PERSONA_SGC.indexOf(data.tipo) === -1) return errorValidacion_('tipo', 'Tipo de documento inválido.');
  if (!data.contenido_base64) return errorValidacion_('contenido_base64', 'Adjunta el archivo.');
  const archivo = await Calidad.subirArchivoSgc_(data, 'PERSONAL');
  if (archivo._validationError) return archivo;

  const doc = {
    doc_id: uuid_(), persona_id: persona.persona_id, tipo: data.tipo, nombre: String(data.nombre || data.nombre_archivo || '').trim(),
    archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre, archivo_mime: archivo.archivo_mime,
    subido_por: contexto.email || '', fecha: new Date().toISOString(), activa: true
  };
  agregarFila_(db, 'SGC_PERSONA_DOCUMENTOS', doc);
  registrarLogSgc_(db, 'SGC_PERSONA_DOC', persona.nombre + ' ' + data.tipo, contexto);
  return doc;
}

async function descargarDocumento(db, data, contexto) {
  const persona = buscarPersonaSgc_(db, data.persona_id);
  if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
  const rol = Calidad.rolSgc_(db, contexto);
  if (!puedeVerPersona_(db, persona, contexto, rol, Calidad.gobiernaSgc_(db, contexto))) return { _forbidden: true, message: 'No tienes acceso a esta ficha.' };
  const doc = leerSeguro_(db, 'SGC_PERSONA_DOCUMENTOS').find((d) => d.doc_id === data.doc_id && d.persona_id === persona.persona_id && esActivo_(d));
  if (!doc) return errorValidacion_('doc_id', 'Documento no encontrado.');

  const descarga = await Almacenamiento.descargarArchivo_(doc.archivo_id);
  if (!descarga.ok) return errorValidacion_('doc_id', descarga.message);
  registrarLogSgc_(db, 'SGC_PERSONA_DOC_DESCARGADO', persona.nombre + ' ' + doc.tipo, contexto);
  return {
    contenido_base64: descarga.contenido_base64,
    nombre_archivo: doc.archivo_nombre || '',
    mime: doc.archivo_mime || 'application/octet-stream'
  };
}

function registrarInduccion(db, data, contexto) {
  const persona = buscarPersonaSgc_(db, data.persona_id);
  if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
  const rol = Calidad.rolSgc_(db, contexto);
  if (!(Calidad.gobiernaSgc_(db, contexto) || esJefaturaDe_(db, persona, contexto))) {
    return { _forbidden: true, message: 'Solo el Encargado SGC o la jefatura directa pueden registrar la inducción.' };
  }
  if (!data.induccion_id) return errorValidacion_('induccion_id', 'Falta indicar el ítem de inducción.');
  const fila = leerSeguro_(db, 'SGC_INDUCCIONES').find((i) => i.induccion_id === data.induccion_id && i.persona_id === persona.persona_id);
  if (!fila) return errorValidacion_('induccion_id', 'Ítem de inducción no encontrado.');

  const completada = data.estado !== 'PENDIENTE';
  return actualizarFilaPorId_(db, 'SGC_INDUCCIONES', 'induccion_id', data.induccion_id, {
    estado: completada ? 'COMPLETADA' : 'PENDIENTE',
    fecha: completada ? (data.fecha || new Date().toISOString()) : '',
    relator_email: completada ? (normalizarEmail_(data.relator_email) || normalizarEmail_(contexto.email)) : '',
    observaciones: data.observaciones || ''
  });
}

function registrarEvaluacion(db, data, contexto) {
  const persona = buscarPersonaSgc_(db, data.persona_id);
  if (!persona) return errorValidacion_('persona_id', 'Persona no encontrada.');
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!(gobierna || esJefaturaDe_(db, persona, contexto))) return { _forbidden: true, message: 'Solo la jefatura directa o el Encargado SGC pueden evaluar.' };
  if (normalizarEmail_(persona.usuario_email) === normalizarEmail_(contexto.email) && !gobierna) return { _forbidden: true, message: 'Nadie puede evaluarse a sí mismo.' };

  const descriptor = descriptorVigenteDe_(db, persona.persona_id);
  if (!descriptor) return errorValidacion_('persona_id', 'Esta persona no tiene un descriptor de cargo vigente. Complétalo primero: la evaluación califica según su descriptor.');
  const itemsResp = parsearItemsDescriptor_(descriptor.items_responsabilidades);
  const itemsHab = parsearItemsDescriptor_(descriptor.items_habilidades);
  if (!itemsResp.length || !itemsHab.length) return errorValidacion_('persona_id', 'El descriptor de cargo vigente no tiene responsabilidades y habilidades cargadas como lista. Complétalo antes de evaluar.');

  const puntuadosResp = puntuarItemsEvaluacion_(itemsResp, data.respuestas_responsabilidades);
  if (puntuadosResp._validationError) return puntuadosResp;
  const puntuadosHab = puntuarItemsEvaluacion_(itemsHab, data.respuestas_habilidades);
  if (puntuadosHab._validationError) return puntuadosHab;

  const promedioResp = promedioItems_(puntuadosResp);
  const promedioHab = promedioItems_(puntuadosHab);
  const fecha = data.fecha || new Date().toISOString();

  const evaluacion = {
    evaluacion_id: uuid_(), persona_id: persona.persona_id, descriptor_id: descriptor.descriptor_id, fecha,
    evaluador_email: normalizarEmail_(contexto.email),
    respuestas_responsabilidades: JSON.stringify(puntuadosResp), respuestas_habilidades: JSON.stringify(puntuadosHab),
    promedio_responsabilidades: promedioResp, promedio_habilidades: promedioHab,
    requiere_capacitacion: promedioResp < UMBRAL_CAPACITACION_SGC || promedioHab < UMBRAL_CAPACITACION_SGC,
    observaciones: data.observaciones || '', recomendado_por: String(data.recomendado_por || '').trim(),
    proxima_evaluacion: sumarMesesSgc_(fecha, 12)
  };
  agregarFila_(db, 'SGC_EVALUACIONES', evaluacion);
  registrarLogSgc_(db, 'SGC_EVALUACION', persona.nombre + ' resp ' + promedioResp + ' / hab ' + promedioHab, contexto);

  if (evaluacion.requiere_capacitacion) {
    const notifs = leerSeguro_(db, 'SGC_ROLES').filter((r) => esVerdadero_(r.activo) && r.rol_sgc === 'ENCARGADO_SGC')
      .map((r) => ({
        destinatario: r.usuario_email, tipo: 'SGC_COMPETENCIA', titulo: 'Necesidad de capacitación detectada',
        mensaje: persona.nombre + ' obtuvo promedio ' + Math.min(promedioResp, promedioHab) + ' en su evaluación de competencias.',
        modulo_id: 'calidad', texto_accion: 'Ver ficha', vidaHoras: 72
      }));
    NotificacionesApp.encolarLote(db, notifs);
  }
  return evaluacion;
}

function listarCapacitaciones(db, data, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) {
    return { _forbidden: true, message: 'El programa de capacitaciones es del Encargado del SGC. Tu formación aparece en tu ficha, en Personas.' };
  }
  const capacitaciones = leerSeguro_(db, 'SGC_CAPACITACIONES').filter(esActivo_);
  const asistentes = leerSeguro_(db, 'SGC_CAPACITACION_ASISTENTES');
  const personas = leerSeguro_(db, 'SGC_PERSONAS').filter(esActivo_);
  const nombrePorId = {};
  personas.forEach((p) => { nombrePorId[p.persona_id] = p.nombre; });
  const anio = data && data.anio ? Number(data.anio) : new Date().getFullYear();

  return {
    puede_gestionar: gobierna, anio,
    capacitaciones: capacitaciones.map((c) => {
      const suyos = asistentes.filter((a) => a.capacitacion_id === c.capacitacion_id);
      return {
        capacitacion_id: c.capacitacion_id, nombre: c.nombre, descripcion: c.descripcion, horas: Number(c.horas) || 0,
        fecha_programada: c.fecha_programada, fecha_realizada: c.fecha_realizada, relator: c.relator, estado: c.estado,
        total_convocados: suyos.length, total_asistieron: suyos.filter((a) => esVerdadero_(a.asistio)).length,
        eficacia_pendiente: suyos.some((a) => esVerdadero_(a.asistio) && eficaciaPendienteAsistenteSgc_(c, a)),
        asistentes: suyos.map((a) => ({
          asistencia_id: a.asistencia_id, persona_id: a.persona_id, nombre: nombrePorId[a.persona_id] || a.persona_id,
          asistio: esVerdadero_(a.asistio), eficacia_fecha: a.eficacia_fecha, eficacia_resultado: a.eficacia_resultado,
          eficacia_observaciones: a.eficacia_observaciones, eficacia_pendiente: esVerdadero_(a.asistio) && eficaciaPendienteAsistenteSgc_(c, a)
        }))
      };
    }).sort((a, b) => new Date(b.fecha_realizada || b.fecha_programada || 0) - new Date(a.fecha_realizada || a.fecha_programada || 0)),
    horas_por_persona: horasFormacionPorPersonaSgc_(db, anio).map((h) => ({ persona_id: h.persona_id, nombre: nombrePorId[h.persona_id] || h.persona_id, horas: h.horas, cumple_meta: h.horas >= META_HORAS_FORMACION_SGC }))
  };
}

function guardarCapacitacion(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden gestionar capacitaciones.' };
  if (data.accion === 'eliminar') {
    if (!data.capacitacion_id) return errorValidacion_('capacitacion_id', 'Falta indicar la capacitación.');
    return actualizarFilaPorId_(db, 'SGC_CAPACITACIONES', 'capacitacion_id', data.capacitacion_id, { activa: false });
  }
  const nombre = String(data.nombre || '').trim();
  if (!nombre) return errorValidacion_('nombre', 'El nombre del curso es obligatorio.');
  const horas = Number(data.horas);
  if (!(horas > 0)) return errorValidacion_('horas', 'Indica las horas de duración (mayor que cero).');

  if (data.capacitacion_id) {
    const cambios = {};
    ['nombre', 'descripcion', 'relator', 'fecha_programada'].forEach((campo) => { if (data[campo] !== undefined) cambios[campo] = data[campo]; });
    if (data.horas !== undefined) cambios.horas = horas;
    return actualizarFilaPorId_(db, 'SGC_CAPACITACIONES', 'capacitacion_id', data.capacitacion_id, cambios);
  }

  const capacitacion = {
    capacitacion_id: uuid_(), nombre, descripcion: data.descripcion || '', horas, fecha_programada: data.fecha_programada || '',
    fecha_realizada: '', relator: data.relator || '', estado: 'PROGRAMADA', creado_por: contexto.email || '',
    fecha_creacion: new Date().toISOString(), activa: true
  };
  agregarFila_(db, 'SGC_CAPACITACIONES', capacitacion);
  registrarLogSgc_(db, 'SGC_CAPACITACION', nombre, contexto);
  return capacitacion;
}

function registrarRealizacion(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar la realización.' };
  const c = buscarCapacitacionSgc_(db, data.capacitacion_id);
  if (!c) return errorValidacion_('capacitacion_id', 'Capacitación no encontrada.');

  const fechaRealizada = data.fecha_realizada || new Date().toISOString();
  const actualizada = actualizarFilaPorId_(db, 'SGC_CAPACITACIONES', 'capacitacion_id', c.capacitacion_id, { estado: 'REALIZADA', fecha_realizada: fechaRealizada, relator: data.relator || c.relator });

  const previos = leerSeguro_(db, 'SGC_CAPACITACION_ASISTENTES').filter((a) => a.capacitacion_id === c.capacitacion_id);
  const deseados = {};
  (data.asistentes || []).forEach((pid) => { if (pid) deseados[pid] = true; });
  previos.forEach((a) => {
    const debeEstar = !!deseados[a.persona_id];
    actualizarFilaPorId_(db, 'SGC_CAPACITACION_ASISTENTES', 'asistencia_id', a.asistencia_id, { asistio: debeEstar, fecha: fechaRealizada });
    delete deseados[a.persona_id];
  });
  Object.keys(deseados).forEach((pid) => {
    agregarFila_(db, 'SGC_CAPACITACION_ASISTENTES', { asistencia_id: uuid_(), capacitacion_id: c.capacitacion_id, persona_id: pid, asistio: true, fecha: fechaRealizada, eficacia_fecha: '', eficacia_resultado: '', eficacia_observaciones: '' });
  });
  registrarLogSgc_(db, 'SGC_CAPACITACION_REALIZADA', c.nombre, contexto);
  return actualizada;
}

function registrarEficaciaAsistente(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar la eficacia.' };
  const c = buscarCapacitacionSgc_(db, data.capacitacion_id);
  if (!c) return errorValidacion_('capacitacion_id', 'Capacitación no encontrada.');
  if (c.estado !== 'REALIZADA') return errorValidacion_('capacitacion_id', 'Solo se evalúa la eficacia de una capacitación ya realizada.');
  const asistente = leerSeguro_(db, 'SGC_CAPACITACION_ASISTENTES').find((a) => a.capacitacion_id === c.capacitacion_id && a.persona_id === data.persona_id);
  if (!asistente || !esVerdadero_(asistente.asistio)) return errorValidacion_('persona_id', 'Esta persona no asistió a la capacitación.');
  if (['EFICAZ', 'NO_EFICAZ'].indexOf(data.resultado) === -1) return errorValidacion_('resultado', 'Indica si la capacitación fue eficaz o no para esta persona.');
  if (data.resultado === 'NO_EFICAZ' && !String(data.observaciones || '').trim()) return errorValidacion_('observaciones', 'Si no fue eficaz, explica por qué: es lo que justifica la siguiente acción.');
  return actualizarFilaPorId_(db, 'SGC_CAPACITACION_ASISTENTES', 'asistencia_id', asistente.asistencia_id, {
    eficacia_fecha: data.fecha || new Date().toISOString(), eficacia_resultado: data.resultado, eficacia_observaciones: data.observaciones || ''
  });
}

// --- motor de avisos de competencia (Fase 2b) -------------------------------
// Sin trigger propio: se cuelga del pase diario de las 09:00. Cadencia por
// clave de evento: evaluacion por vencer -> semanal; horas de formacion ->
// semestral; eficacia pendiente -> semanal.
async function recordatorioCompetencias(db) {
  const personas = leerSeguro_(db, 'SGC_PERSONAS').filter((p) => esActivo_(p) && p.estado !== 'DESVINCULADO');
  if (!personas.length) return { evaluaciones: 0, horas: 0, eficacia: 0 };

  const ahora = new Date();
  const claveSemana = inicioSemanaUTC_(ahora).toISOString().slice(0, 10);
  const encargados = leerSeguro_(db, 'SGC_ROLES').filter((r) => esVerdadero_(r.activo) && r.rol_sgc === 'ENCARGADO_SGC').map((r) => normalizarEmail_(r.usuario_email)).filter(Boolean);

  const evaluaciones = leerSeguro_(db, 'SGC_EVALUACIONES');
  const ultimaPorPersona = {};
  evaluaciones.forEach((e) => {
    const previa = ultimaPorPersona[e.persona_id];
    if (!previa || new Date(e.fecha) > new Date(previa.fecha)) ultimaPorPersona[e.persona_id] = e;
  });

  const pendientes = personas.filter((p) => {
    const ultima = ultimaPorPersona[p.persona_id];
    if (!ultima) return true;
    if (!ultima.proxima_evaluacion) return false;
    const dias = (new Date(ultima.proxima_evaluacion) - ahora) / 86400000;
    return dias <= 30;
  });

  let enviadosEval = 0;
  if (pendientes.length) {
    const porJefe = {};
    pendientes.forEach((p) => {
      const jefe = normalizarEmail_(p.jefatura_email);
      if (!jefe) return;
      (porJefe[jefe] = porJefe[jefe] || []).push(p);
    });
    encargados.forEach((email) => { if (!porJefe[email]) porJefe[email] = pendientes; });

    for (const email of Object.keys(porJefe)) {
      const lista = porJefe[email];
      const items = lista.map((p) => {
        const ultima = ultimaPorPersona[p.persona_id];
        if (!ultima) return '- ' + p.nombre + ' — sin evaluación registrada';
        const dias = Math.round((new Date(ultima.proxima_evaluacion) - ahora) / 86400000);
        return '- ' + p.nombre + ' — ' + (dias < 0 ? 'evaluación VENCIDA hace ' + (-dias) + ' día(s)' : 'a evaluar en ' + dias + ' día(s)');
      }).join('\n');
      const asunto = 'SIGSO — ' + lista.length + ' evaluación(es) de competencia por hacer';
      const cuerpo = 'Estas personas necesitan su evaluación de competencias (cada 12 meses):\n' + items + '\n\nEntra a SIGSO > Calidad > Personas para registrarla.';
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_EVAL_PENDIENTE:' + email, destinatario: email, evento: 'SGC_COMPETENCIA', asunto, cuerpo, ventanaMinutos: 7 * 24 * 60 });
      if (r && r.enviado) enviadosEval++;
    }
    NotificacionesApp.encolarLote(db, Object.keys(porJefe).map((email) => ({
      destinatario: email, tipo: 'SGC_EVAL_PENDIENTE', titulo: 'Evaluaciones de competencia por hacer',
      mensaje: porJefe[email].length + ' persona(s) esperan su evaluación.', modulo_id: 'calidad', texto_accion: 'Ver personas', vidaHoras: 72
    })));
  }

  const anio = ahora.getFullYear();
  const semestre = ahora.getMonth() < 6 ? 'S1' : 'S2';
  const claveSemestre = anio + '-' + semestre;
  const bajoMeta = horasFormacionPorPersonaSgc_(db, anio).filter((h) => h.horas < META_HORAS_FORMACION_SGC);

  let enviadosHoras = 0;
  if (bajoMeta.length) {
    const itemsHoras = bajoMeta.map((h) => '- ' + h.nombre + ': ' + h.horas + ' hrs').join('\n');
    const asuntoH = 'SIGSO — ' + bajoMeta.length + ' persona(s) bajo la meta de formación';
    const cuerpoH = 'Estas personas están bajo la meta de ' + META_HORAS_FORMACION_SGC + ' horas de formación al año (Objetivo de Calidad N°4):\n' + itemsHoras + '\n\nEntra a SIGSO > Calidad > Capacitaciones para programar formación.';
    for (const email of encargados) {
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_HORAS_BAJO_META:' + claveSemestre, destinatario: email, evento: 'SGC_FORMACION', asunto: asuntoH, cuerpo: cuerpoH, ventanaMinutos: 180 * 24 * 60 });
      if (r && r.enviado) enviadosHoras++;
    }
  }

  const capacitacionesPorId = {};
  leerSeguro_(db, 'SGC_CAPACITACIONES').filter(esActivo_).forEach((c) => { capacitacionesPorId[c.capacitacion_id] = c; });
  const nombrePorPersonaId = {};
  personas.forEach((p) => { nombrePorPersonaId[p.persona_id] = p.nombre; });
  const sinEficacia = leerSeguro_(db, 'SGC_CAPACITACION_ASISTENTES').filter((a) => {
    const c = capacitacionesPorId[a.capacitacion_id];
    return c && esVerdadero_(a.asistio) && eficaciaPendienteAsistenteSgc_(c, a);
  }).map((a) => ({ curso: capacitacionesPorId[a.capacitacion_id].nombre, persona: nombrePorPersonaId[a.persona_id] || a.persona_id }));

  let enviadosEficacia = 0;
  if (sinEficacia.length) {
    const itemsEf = sinEficacia.map((x) => '- ' + x.persona + ' (' + x.curso + ')').join('\n');
    const asuntoE = 'SIGSO — ' + sinEficacia.length + ' eficacia(s) de capacitación sin evaluar';
    const cuerpoE = 'Estos participantes cumplieron 60 días desde su capacitación y aún no tienen evaluación de eficacia:\n' + itemsEf;
    for (const email of encargados) {
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_EFICACIA_PENDIENTE:' + email, destinatario: email, evento: 'SGC_FORMACION', asunto: asuntoE, cuerpo: cuerpoE, ventanaMinutos: 7 * 24 * 60 });
      if (r && r.enviado) enviadosEficacia++;
    }
  }

  return { evaluaciones: enviadosEval, horas: enviadosHoras, eficacia: enviadosEficacia };
}

module.exports = {
  listar, getFicha, guardarPersona, desvincular, quitarDelAlcance,
  guardarDescriptor, actualizarDescriptor, descargarDescriptor,
  guardarDocumento, descargarDocumento, registrarInduccion,
  registrarEvaluacion, listarCapacitaciones, guardarCapacitacion, registrarRealizacion, registrarEficaciaAsistente,
  recordatorioCompetencias,
  // Expuestas para tests / futuros incrementos del SGC. horasFormacionPorPersonaSgc_
  // la reusa Objetivos (Fase 6a, objetivo 4: horas de formación).
  puedeVerPersona_, esJefaturaDe_, horasFormacionPorPersonaSgc_
};
