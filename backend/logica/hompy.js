'use strict';

/**
 * hompy.js — módulo Hompy, la mascota de HomePymes (Etapa 1, 2026-10-06).
 *
 * Lo llevan Bárbara y Lisseth (y el dueño). Etapa 1: el calendario de las
 * actividades de Hompy y el REPORTE DE SALIDA A TERRENO de cada una, con su
 * PDF. Etapa 2: el Estudio TikTok (idea → diálogo → guión → producción →
 * publicado, con métricas). Etapa 3: las marcas colaboradoras y el reporte mensual.
 *
 * Acceso: el módulo `hompy` de la cuenta (Administración → Cuentas). A
 * diferencia del resto de `modulos` (que solo pinta el menú), aquí cada acción
 * lo vuelve a verificar: sin `hompy`, ni un ADM entra (pedido del dueño: «de
 * momento solo ellas y yo»).
 *
 * Los tipos de evento: son 5 y los definen ellas. Parten con una propuesta
 * (origen PROPUESTA) que pueden renombrar, recolorear o apagar.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');

const MODULO = 'hompy';
const MAX_TIPOS = 8;
const ESTADOS_EVENTO = ['PLANIFICADO', 'CONFIRMADO', 'REALIZADO', 'CANCELADO'];
const COLORES = ['naranja', 'azul', 'rosa', 'verde', 'ambar', 'violeta', 'turquesa', 'gris'];
const ICONOS = ['ubicacion', 'megafono', 'camara', 'maletin', 'estrella', 'equipo', 'calendario', 'casco', 'bombilla', 'actividad'];
const ESTADOS_TRAJE = ['BUENO', 'LIMPIEZA', 'REPARACION'];
const MATERIAL = ['Traje de Hompy', 'Pendón', 'Regalos / merch', 'Volantes', 'Parlante', 'Mesa / toldo'];

// La propuesta inicial de los 5 tipos: ellas la cambian cuando los definan.
const TIPOS_PROPUESTA = [
  { nombre: 'Salida a terreno', color: 'naranja', icono: 'ubicacion' },
  { nombre: 'Evento con marca', color: 'azul', icono: 'megafono' },
  { nombre: 'Grabación de contenido', color: 'rosa', icono: 'camara' },
  { nombre: 'Visita a empresa cliente', color: 'verde', icono: 'maletin' },
  { nombre: 'Actividad con la comunidad', color: 'ambar', icono: 'estrella' }
];

// --- utilidades ---------------------------------------------------------------------------
function ahora_() { return new Date().toISOString(); }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function id_(pref) { return pref + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function texto_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max || 200); }
function linea_(v, max) { return texto_(v, max).replace(/[\r\n\t]+/g, ' '); }
// Rechaza también las que el calendario «corre» (30 de febrero → 2 de marzo).
function fecha_(v) {
  const s = String(v || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : '';
}
function hora_(v) { const s = String(v || '').trim(); return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : ''; }
function entero_(v, max) {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(String(v).replace(/\./g, '').replace(',', '.')));
  return isFinite(n) && n >= 0 ? Math.min(n, max || 1e9) : null;
}
function lista_(v, maxItems, maxLargo) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[,;\n]/);
  const vistos = new Set();
  return arr.map((x) => linea_(x, maxLargo || 80)).filter((x) => { const k = x.toLowerCase(); if (!x || vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, maxItems || 20);
}
function url_(v) { const s = linea_(v, 500); return /^https?:\/\/[^\s]+$/i.test(s) ? s : ''; }
function json_(v, d) { if (v && typeof v === 'object') return v; try { return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function leer_(db, t) { try { return leerFilas_(db, t, COLUMNAS[t]); } catch (e) { return []; } }
function minutos_(h) { if (!h) return null; const [a, b] = h.split(':').map(Number); return a * 60 + b; }

function puede_(contexto) {
  return !!(contexto && Array.isArray(contexto.modulos) && contexto.modulos.indexOf(MODULO) !== -1);
}
function sinAcceso_() { return errorForbidden('Hompy es solo para el equipo que lleva a la mascota.'); }

// Nombre visible de quien registra (para no mostrar correos).
function nombres_(db) {
  const mapa = {};
  leer_(db, 'CUENTAS_PORTAL').forEach((c) => {
    const n = String(c.nombre || '').trim();
    json_(c.emails, String(c.emails || '').split(/[,;\s]+/)).forEach((e) => { if (n && e) mapa[String(e).trim().toLowerCase()] = n; });
  });
  return mapa;
}
function personas_(db) {
  return leer_(db, 'CUENTAS_PORTAL').filter((c) => esVerdadero_(c.activo) && String(c.nombre || '').trim())
    .map((c) => String(c.nombre).trim()).sort((a, b) => a.localeCompare(b, 'es'));
}

// --- tipos ----------------------------------------------------------------------------------
function asegurarTipos_(db) {
  if (leer_(db, 'HOMPY_TIPOS').length) return;
  TIPOS_PROPUESTA.forEach((t, i) => agregarFila_(db, 'HOMPY_TIPOS', {
    tipo_id: 'HT-' + (i + 1), nombre: t.nombre, color: t.color, icono: t.icono, orden: i + 1, origen: 'PROPUESTA',
    creado_por: 'sistema', fecha_creacion: ahora_(), actualizado_por: '', fecha_actualizacion: '', activo: true
  }));
}
function tipos_(db) {
  asegurarTipos_(db);
  return leer_(db, 'HOMPY_TIPOS').map((t) => ({
    tipo_id: t.tipo_id, nombre: t.nombre, color: COLORES.indexOf(t.color) !== -1 ? t.color : 'gris',
    icono: ICONOS.indexOf(t.icono) !== -1 ? t.icono : 'calendario', orden: Number(t.orden) || 99,
    origen: t.origen || 'PROPUESTA', activo: esVerdadero_(t.activo)
  })).sort((a, b) => a.orden - b.orden);
}

function guardarTipo(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  data = data || {};
  const nombre = linea_(data.nombre, 50);
  if (!nombre) return errorValidacion('nombre', 'Ponle un nombre al tipo de evento.');
  const color = COLORES.indexOf(data.color) !== -1 ? data.color : 'gris';
  const icono = ICONOS.indexOf(data.icono) !== -1 ? data.icono : 'calendario';
  const lista = tipos_(db);
  if (lista.some((t) => t.tipo_id !== data.tipo_id && t.activo && t.nombre.toLowerCase() === nombre.toLowerCase())) {
    return errorValidacion('nombre', 'Ya hay un tipo con ese nombre.');
  }
  const cambios = { nombre, color, icono, origen: 'EDITADA', actualizado_por: contexto.email, fecha_actualizacion: ahora_() };
  if (data.activo !== undefined) cambios.activo = esVerdadero_(data.activo);
  if (data.tipo_id) {
    if (!lista.some((t) => t.tipo_id === data.tipo_id)) return errorValidacion('tipo_id', 'Ese tipo de evento ya no existe.');
    if (cambios.activo === false && lista.filter((t) => t.activo).length <= 1) return errorValidacion('activo', 'Debe quedar al menos un tipo activo.');
    actualizarFilaPorId_(db, 'HOMPY_TIPOS', 'tipo_id', data.tipo_id, cambios);
    return { tipo: tipos_(db).find((t) => t.tipo_id === data.tipo_id) };
  }
  if (lista.length >= MAX_TIPOS) return errorValidacion('nombre', 'Hasta ' + MAX_TIPOS + ' tipos de evento: reutiliza uno que esté apagado.');
  const nuevo = Object.assign({ tipo_id: id_('HT'), orden: lista.length + 1, creado_por: contexto.email, fecha_creacion: ahora_(), activo: true }, cambios);
  agregarFila_(db, 'HOMPY_TIPOS', nuevo);
  return { tipo: tipos_(db).find((t) => t.tipo_id === nuevo.tipo_id) };
}

// --- eventos --------------------------------------------------------------------------------
function eventoPublico_(e) {
  return {
    evento_id: e.evento_id, tipo_id: e.tipo_id, titulo: e.titulo, fecha: fecha_(e.fecha), hora_inicio: e.hora_inicio || '', hora_fin: e.hora_fin || '',
    lugar: e.lugar || '', direccion: e.direccion || '', comuna: e.comuna || '', participantes: json_(e.participantes, []),
    descripcion: e.descripcion || '', estado: ESTADOS_EVENTO.indexOf(e.estado) !== -1 ? e.estado : 'PLANIFICADO',
    motivo_cancelacion: e.motivo_cancelacion || '', idea_id: e.idea_id || '', creado_por: e.creado_por || '', fecha_creacion: e.fecha_creacion || ''
  };
}
function eventos_(db) { return leer_(db, 'HOMPY_EVENTOS').filter((e) => esVerdadero_(e.activo)).map(eventoPublico_); }
function eventoFila_(db, id) { return leer_(db, 'HOMPY_EVENTOS').find((e) => e.evento_id === id && esVerdadero_(e.activo)) || null; }

function guardarEvento(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  data = data || {};
  const titulo = linea_(data.titulo, 120);
  if (!titulo) return errorValidacion('titulo', 'Escribe de qué se trata la actividad.');
  const fecha = fecha_(data.fecha);
  if (!fecha) return errorValidacion('fecha', 'Elige la fecha.');
  const tipo = tipos_(db).find((t) => t.tipo_id === data.tipo_id);
  if (!tipo) return errorValidacion('tipo_id', 'Elige el tipo de evento.');
  const horaInicio = hora_(data.hora_inicio), horaFin = hora_(data.hora_fin);
  if (data.hora_inicio && !horaInicio) return errorValidacion('hora_inicio', 'La hora de inicio no es válida.');
  if (data.hora_fin && !horaFin) return errorValidacion('hora_fin', 'La hora de término no es válida.');
  if (horaInicio && horaFin && minutos_(horaFin) <= minutos_(horaInicio)) return errorValidacion('hora_fin', 'El término tiene que ser después del inicio.');
  const fila = {
    tipo_id: tipo.tipo_id, titulo, fecha, hora_inicio: horaInicio, hora_fin: horaFin,
    lugar: linea_(data.lugar, 120), direccion: linea_(data.direccion, 160), comuna: linea_(data.comuna, 60),
    participantes: JSON.stringify(lista_(data.participantes, 15, 60)), descripcion: texto_(data.descripcion, 1500),
    actualizado_por: contexto.email, fecha_actualizacion: ahora_()
  };
  if (data.evento_id) {
    const previo = eventoFila_(db, data.evento_id);
    if (!previo) return errorValidacion('evento_id', 'Esa actividad ya no existe.');
    actualizarFilaPorId_(db, 'HOMPY_EVENTOS', 'evento_id', data.evento_id, fila);
    return { evento: eventoPublico_(eventoFila_(db, data.evento_id)) };
  }
  const nuevo = Object.assign({ evento_id: id_('HE'), estado: 'PLANIFICADO', motivo_cancelacion: '', creado_por: contexto.email, fecha_creacion: ahora_(), activo: true }, fila);
  agregarFila_(db, 'HOMPY_EVENTOS', nuevo);
  return { evento: eventoPublico_(nuevo) };
}

function cambiarEstadoEvento(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  data = data || {};
  const e = eventoFila_(db, data.evento_id);
  if (!e) return errorValidacion('evento_id', 'Esa actividad ya no existe.');
  const estado = String(data.estado || '');
  if (ESTADOS_EVENTO.indexOf(estado) === -1) return errorValidacion('estado', 'Estado no válido.');
  const salida = salidaDe_(db, e.evento_id);
  if (salida && salida.estado === 'CERRADO' && estado !== 'REALIZADO') {
    return errorValidacion('estado', 'El reporte de salida ya está cerrado: reábrelo antes de cambiar la actividad.');
  }
  if (estado === 'REALIZADO' && fecha_(e.fecha) > hoy_()) return errorValidacion('estado', 'Todavía no llega la fecha: se marca como realizada el mismo día o después.');
  const motivo = linea_(data.motivo, 300);
  if (estado === 'CANCELADO' && !motivo) return errorValidacion('motivo', 'Cuenta brevemente por qué se canceló.');
  actualizarFilaPorId_(db, 'HOMPY_EVENTOS', 'evento_id', e.evento_id, {
    estado, motivo_cancelacion: estado === 'CANCELADO' ? motivo : '', actualizado_por: contexto.email, fecha_actualizacion: ahora_()
  });
  return { evento: eventoPublico_(eventoFila_(db, e.evento_id)) };
}

function eliminarEvento(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  const e = eventoFila_(db, data && data.evento_id);
  if (!e) return errorValidacion('evento_id', 'Esa actividad ya no existe.');
  const salida = salidaDe_(db, e.evento_id);
  if (salida && salida.estado === 'CERRADO') return errorValidacion('evento_id', 'Tiene un reporte de salida cerrado: no se puede eliminar (cancélala si no corresponde).');
  actualizarFilaPorId_(db, 'HOMPY_EVENTOS', 'evento_id', e.evento_id, { activo: false, actualizado_por: contexto.email, fecha_actualizacion: ahora_() });
  return { eliminado: e.evento_id };
}

// --- reporte de salida a terreno ----------------------------------------------------------------
function salidaDe_(db, eventoId) {
  const f = leer_(db, 'HOMPY_SALIDAS').find((s) => s.evento_id === eventoId && esVerdadero_(s.activo));
  return f ? salidaPublica_(f) : null;
}
function salidaPublica_(s) {
  return {
    salida_id: s.salida_id, evento_id: s.evento_id, estado: s.estado === 'CERRADO' ? 'CERRADO' : 'BORRADOR', datos: json_(s.datos, {}),
    cerrado_por: s.cerrado_por || '', fecha_cierre: s.fecha_cierre || '', actualizado_por: s.actualizado_por || '', fecha_actualizacion: s.fecha_actualizacion || ''
  };
}

/** Solo los campos conocidos, cada uno con su tipo. Lo demás se descarta. */
function limpiarDatosSalida_(d) {
  d = d || {};
  const calif = entero_(d.calificacion, 5);
  return {
    hora_salida: hora_(d.hora_salida), hora_llegada: hora_(d.hora_llegada), hora_inicio: hora_(d.hora_inicio),
    hora_fin: hora_(d.hora_fin), hora_regreso: hora_(d.hora_regreso),
    lugar_real: linea_(d.lugar_real, 160),
    traje: linea_(d.traje, 60), apoyo: lista_(d.apoyo, 10, 60), conductor: linea_(d.conductor, 60),
    contacto_lugar: linea_(d.contacto_lugar, 80), contacto_telefono: linea_(d.contacto_telefono, 30),
    minutos_traje: entero_(d.minutos_traje, 720), pausas: entero_(d.pausas, 50), hidratacion: esVerdadero_(d.hidratacion),
    estado_traje: ESTADOS_TRAJE.indexOf(d.estado_traje) !== -1 ? d.estado_traje : '', nota_traje: texto_(d.nota_traje, 400),
    publico: entero_(d.publico, 1e6), material: lista_(d.material, 12, 40).filter((m) => MATERIAL.indexOf(m) !== -1),
    material_completo: d.material_completo === undefined ? null : esVerdadero_(d.material_completo), nota_material: texto_(d.nota_material, 400),
    fotos: entero_(d.fotos, 10000), videos: entero_(d.videos, 10000), tiktok: esVerdadero_(d.tiktok), enlace_fotos: url_(d.enlace_fotos),
    calificacion: calif && calif >= 1 ? calif : null, bien: texto_(d.bien, 1500), mejorar: texto_(d.mejorar, 1500), incidentes: texto_(d.incidentes, 1500),
    gasto_transporte: entero_(d.gasto_transporte), gasto_estacionamiento: entero_(d.gasto_estacionamiento),
    gasto_colacion: entero_(d.gasto_colacion), gasto_otros: entero_(d.gasto_otros),
    comentarios: texto_(d.comentarios, 2500)
  };
}

/** Lo mínimo para cerrar el reporte: { campo: mensaje } de lo que falta. */
function faltantesParaCerrar_(d) {
  const f = {};
  if (!d.hora_inicio) f.hora_inicio = 'Falta la hora de inicio de la actividad.';
  if (!d.hora_fin) f.hora_fin = 'Falta la hora de término.';
  if (d.hora_inicio && d.hora_fin && minutos_(d.hora_fin) <= minutos_(d.hora_inicio)) f.hora_fin = 'El término tiene que ser después del inicio.';
  if (!d.traje) f.traje = 'Indica quién usó el traje de Hompy.';
  if (d.publico == null) f.publico = 'Anota el público estimado (aunque sea aproximado).';
  if (!d.estado_traje) f.estado_traje = 'Indica cómo quedó el traje.';
  if (!d.calificacion) f.calificacion = 'Califica la salida de 1 a 5.';
  return f;
}

function guardarSalida(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  data = data || {};
  const e = eventoFila_(db, data.evento_id);
  if (!e) return errorValidacion('evento_id', 'Esa actividad ya no existe.');
  if (e.estado === 'CANCELADO') return errorValidacion('evento_id', 'La actividad está cancelada: no lleva reporte de salida.');
  if (fecha_(e.fecha) > hoy_()) return errorValidacion('evento_id', 'El reporte se llena el día de la salida o después.');
  const previa = salidaDe_(db, e.evento_id);
  if (previa && previa.estado === 'CERRADO') return errorValidacion('estado', 'El reporte ya está cerrado. Reábrelo para corregirlo.');
  const datos = limpiarDatosSalida_(data.datos);
  const cerrar = esVerdadero_(data.cerrar);
  if (cerrar) {
    const faltan = faltantesParaCerrar_(datos);
    const campos = Object.keys(faltan);
    if (campos.length) {
      return { _validationError: true, message: 'Para cerrar el reporte falta: ' + campos.map((c) => faltan[c].replace(/^Falta(n)? /, '').replace(/\.$/, '')).join('; ') + '.',
        fields: campos.map((c) => ({ campo: c, mensaje: faltan[c] })) };
    }
  }
  const cambios = {
    datos: JSON.stringify(datos), estado: cerrar ? 'CERRADO' : 'BORRADOR',
    cerrado_por: cerrar ? contexto.email : '', fecha_cierre: cerrar ? ahora_() : '',
    actualizado_por: contexto.email, fecha_actualizacion: ahora_()
  };
  if (previa) actualizarFilaPorId_(db, 'HOMPY_SALIDAS', 'salida_id', previa.salida_id, cambios);
  else agregarFila_(db, 'HOMPY_SALIDAS', Object.assign({ salida_id: id_('HS'), evento_id: e.evento_id, creado_por: contexto.email, fecha_creacion: ahora_(), activo: true }, cambios));
  // Llenar el reporte = la salida se hizo.
  if (e.estado !== 'REALIZADO') {
    actualizarFilaPorId_(db, 'HOMPY_EVENTOS', 'evento_id', e.evento_id, { estado: 'REALIZADO', motivo_cancelacion: '', actualizado_por: contexto.email, fecha_actualizacion: ahora_() });
  }
  return { salida: salidaDe_(db, e.evento_id), evento: eventoPublico_(eventoFila_(db, e.evento_id)) };
}

function reabrirSalida(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  const s = salidaDe_(db, data && data.evento_id);
  if (!s) return errorValidacion('evento_id', 'Esa actividad no tiene reporte de salida.');
  if (s.estado !== 'CERRADO') return { salida: s };
  actualizarFilaPorId_(db, 'HOMPY_SALIDAS', 'salida_id', s.salida_id, { estado: 'BORRADOR', cerrado_por: '', fecha_cierre: '', actualizado_por: contexto.email, fecha_actualizacion: ahora_() });
  return { salida: salidaDe_(db, data.evento_id) };
}

// --- Estudio TikTok (Etapa 2) -------------------------------------------------------------------
// Una idea avanza por 5 etapas: IDEA → DIALOGO → GUION → PRODUCCION → PUBLICADO (o DESCARTADA).
// Hacia adelante, de a una y con lo mínimo de la etapa que deja; hacia atrás, libre.
const ETAPAS = ['IDEA', 'DIALOGO', 'GUION', 'PRODUCCION', 'PUBLICADO'];
const NOMBRE_ETAPA = { IDEA: 'Idea', DIALOGO: 'Diálogo', GUION: 'Guión', PRODUCCION: 'Producción', PUBLICADO: 'Publicado', DESCARTADA: 'Descartada' };
const OBJETIVOS = ['EDUCAR', 'ENTRETENER', 'MARCA', 'TENDENCIA'];
const FORMATOS = ['Sketch / actuado', 'Tutorial / consejo', 'Detrás de cámaras', 'Tendencia / baile', 'Pregunta y respuesta', 'Colaboración con marca'];
const DURACIONES = [15, 30, 60, 90];
const PLANOS = ['General', 'Medio', 'Primer plano', 'Detalle', 'POV', 'Pantalla / texto'];
const CHECKLIST = [
  ['traje', 'Traje listo y limpio'], ['locacion', 'Lugar confirmado'], ['permisos', 'Autorización de quienes aparecen'],
  ['grabado', 'Grabado'], ['editado', 'Editado'], ['subtitulos', 'Subtítulos'], ['audio', 'Música o audio con derechos'],
  ['portada', 'Portada'], ['aprobado', 'Revisado y aprobado']
];
const METRICAS = ['vistas', 'me_gusta', 'comentarios', 'compartidos', 'guardados'];

function limpiarIdea_(d) {
  d = d || {};
  return {
    gancho: texto_(d.gancho, 200), objetivo: OBJETIVOS.indexOf(d.objetivo) !== -1 ? d.objetivo : '',
    formato: FORMATOS.indexOf(d.formato) !== -1 ? d.formato : '', duracion: DURACIONES.indexOf(Number(d.duracion)) !== -1 ? Number(d.duracion) : 30,
    referencia: url_(d.referencia), audio: linea_(d.audio, 120),
    hashtags: lista_(d.hashtags, 12, 40).map((h) => '#' + h.replace(/^#+/, '').replace(/\s+/g, '')).filter((h) => h.length > 1),
    notas: texto_(d.notas, 2000)
  };
}
function limpiarDialogo_(d) {
  d = d || {};
  const personajes = lista_(d.personajes, 8, 30);
  if (!personajes.some((p) => p.toLowerCase() === 'hompy')) personajes.unshift('Hompy');
  const lineas = (Array.isArray(d.lineas) ? d.lineas : []).slice(0, 80).map((l) => ({
    personaje: linea_(l && l.personaje, 30) || 'Hompy', tipo: l && l.tipo === 'accion' ? 'accion' : 'dice', texto: texto_(l && l.texto, 400)
  })).filter((l) => l.texto);
  lineas.forEach((l) => { if (!personajes.some((p) => p.toLowerCase() === l.personaje.toLowerCase()) && personajes.length < 8) personajes.push(l.personaje); });
  return { personajes: personajes.slice(0, 8), lineas };
}
function limpiarGuion_(d) {
  d = d || {};
  const escenas = (Array.isArray(d.escenas) ? d.escenas : []).slice(0, 40).map((e) => ({
    plano: PLANOS.indexOf(e && e.plano) !== -1 ? e.plano : 'Medio', accion: texto_(e && e.accion, 400), pantalla: texto_(e && e.pantalla, 200),
    audio: texto_(e && e.audio, 400), segundos: entero_(e && e.segundos, 600) || 0
  })).filter((e) => e.accion || e.pantalla || e.audio);
  return { escenas };
}
function limpiarProduccion_(d, previa) {
  d = d || {};
  const check = {};
  CHECKLIST.forEach(([k]) => { check[k] = esVerdadero_(d.checklist && d.checklist[k]); });
  return {
    checklist: check, fecha_grabacion: fecha_(d.fecha_grabacion), hora_grabacion: hora_(d.hora_grabacion), lugar: linea_(d.lugar, 120),
    responsable: linea_(d.responsable, 60), enlace_borrador: url_(d.enlace_borrador), notas: texto_(d.notas, 1500),
    // El enlace al calendario solo lo pone agendarGrabacion: nunca llega del navegador.
    evento_id: (previa && previa.evento_id) || ''
  };
}
function limpiarPublicacion_(d) {
  d = d || {};
  const m = (x) => { const o = {}; METRICAS.forEach((k) => { o[k] = entero_(x && x[k]); }); return o; };
  return { url: url_(d.url), fecha: fecha_(d.fecha), h24: m(d.h24), d7: m(d.d7), aprendizajes: texto_(d.aprendizajes, 1500) };
}
function ideaPublica_(f) {
  const prod = json_(f.produccion, {});
  return {
    idea_id: f.idea_id, titulo: f.titulo, etapa: ETAPAS.concat(['DESCARTADA']).indexOf(f.etapa) !== -1 ? f.etapa : 'IDEA',
    idea: limpiarIdea_(json_(f.idea, {})), dialogo: limpiarDialogo_(json_(f.dialogo, {})), guion: limpiarGuion_(json_(f.guion, {})),
    produccion: limpiarProduccion_(prod, prod), publicacion: limpiarPublicacion_(json_(f.publicacion, {})),
    votos: json_(f.votos, []), motivo_descarte: f.motivo_descarte || '',
    creado_por: f.creado_por || '', fecha_creacion: f.fecha_creacion || '', actualizado_por: f.actualizado_por || '', fecha_actualizacion: f.fecha_actualizacion || ''
  };
}
function ideaFila_(db, id) { return leer_(db, 'HOMPY_IDEAS').find((f) => f.idea_id === id && esVerdadero_(f.activo)) || null; }
function ideas_(db) { return leer_(db, 'HOMPY_IDEAS').filter((f) => esVerdadero_(f.activo)).map(ideaPublica_); }

/** Lo que falta para dejar la etapa actual: [{ campo, mensaje }]. */
function faltaParaAvanzar_(idea) {
  const f = [];
  if (idea.etapa === 'IDEA') {
    if (!idea.titulo) f.push({ campo: 'titulo', mensaje: 'Ponle un título a la idea.' });
    if (!idea.idea.gancho) f.push({ campo: 'gancho', mensaje: 'Escribe el gancho: lo que pasa en los primeros 3 segundos.' });
  } else if (idea.etapa === 'DIALOGO') {
    if (!idea.dialogo.lineas.length) f.push({ campo: 'lineas', mensaje: 'Escribe al menos una línea del diálogo.' });
  } else if (idea.etapa === 'GUION') {
    if (!idea.guion.escenas.length) f.push({ campo: 'escenas', mensaje: 'Arma al menos una escena del guión.' });
    else if (!idea.guion.escenas.some((e) => e.segundos > 0)) f.push({ campo: 'segundos', mensaje: 'Indica cuántos segundos dura cada escena.' });
  } else if (idea.etapa === 'PRODUCCION') {
    if (!idea.produccion.checklist.grabado) f.push({ campo: 'grabado', mensaje: 'Marca el video como grabado.' });
    if (!idea.produccion.checklist.aprobado) f.push({ campo: 'aprobado', mensaje: 'Falta que alguien lo revise y apruebe.' });
  }
  return f;
}

function guardarIdea(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  data = data || {};
  const titulo = linea_(data.titulo, 120);
  if (!data.idea_id) {
    if (!titulo) return errorValidacion('titulo', 'Anota la idea en una frase.');
    const nueva = {
      idea_id: id_('HI'), titulo, etapa: 'IDEA', idea: JSON.stringify(limpiarIdea_(data.idea)), dialogo: JSON.stringify(limpiarDialogo_({})),
      guion: JSON.stringify({ escenas: [] }), produccion: JSON.stringify(limpiarProduccion_({})), publicacion: JSON.stringify(limpiarPublicacion_({})),
      votos: '[]', motivo_descarte: '', creado_por: contexto.email, fecha_creacion: ahora_(), actualizado_por: contexto.email, fecha_actualizacion: ahora_(), activo: true
    };
    agregarFila_(db, 'HOMPY_IDEAS', nueva);
    return { idea: ideaPublica_(nueva) };
  }
  const f = ideaFila_(db, data.idea_id);
  if (!f) return errorValidacion('idea_id', 'Esa idea ya no existe.');
  const cambios = { actualizado_por: contexto.email, fecha_actualizacion: ahora_() };
  if (data.titulo !== undefined) { if (!titulo) return errorValidacion('titulo', 'La idea necesita un título.'); cambios.titulo = titulo; }
  if (data.idea) cambios.idea = JSON.stringify(limpiarIdea_(data.idea));
  if (data.dialogo) cambios.dialogo = JSON.stringify(limpiarDialogo_(data.dialogo));
  if (data.guion) cambios.guion = JSON.stringify(limpiarGuion_(data.guion));
  if (data.produccion) cambios.produccion = JSON.stringify(limpiarProduccion_(data.produccion, json_(f.produccion, {})));
  if (data.publicacion) cambios.publicacion = JSON.stringify(limpiarPublicacion_(data.publicacion));
  actualizarFilaPorId_(db, 'HOMPY_IDEAS', 'idea_id', f.idea_id, cambios);
  return { idea: ideaPublica_(ideaFila_(db, f.idea_id)) };
}

function moverIdea(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  data = data || {};
  const f = ideaFila_(db, data.idea_id);
  if (!f) return errorValidacion('idea_id', 'Esa idea ya no existe.');
  const idea = ideaPublica_(f);
  const destino = String(data.etapa || '');
  const cambios = { actualizado_por: contexto.email, fecha_actualizacion: ahora_() };
  if (destino === 'DESCARTADA') {
    const motivo = linea_(data.motivo, 300);
    if (!motivo) return errorValidacion('motivo', 'Cuenta brevemente por qué se descarta (sirve para no repetirla).');
    if (idea.etapa === 'PUBLICADO') return errorValidacion('etapa', 'Un video publicado no se descarta.');
    Object.assign(cambios, { etapa: 'DESCARTADA', motivo_descarte: motivo });
  } else {
    const iDest = ETAPAS.indexOf(destino);
    if (iDest === -1) return errorValidacion('etapa', 'Etapa no válida.');
    if (idea.etapa === 'DESCARTADA') {
      if (iDest !== 0) return errorValidacion('etapa', 'Una idea descartada vuelve primero a «Idea».');
    } else {
      const iAct = ETAPAS.indexOf(idea.etapa);
      if (iDest > iAct + 1) return errorValidacion('etapa', 'Se avanza de a una etapa: primero «' + NOMBRE_ETAPA[ETAPAS[iAct + 1]] + '».');
      if (iDest === iAct + 1) {
        const falta = faltaParaAvanzar_(idea);
        if (falta.length) {
          return { _validationError: true, message: 'Para pasar a «' + NOMBRE_ETAPA[destino] + '» falta: ' + falta.map((x) => x.mensaje.replace(/\.$/, '')).join('; ') + '.', fields: falta };
        }
        if (destino === 'PUBLICADO' && !idea.publicacion.url) {
          const url = url_(data.url);
          if (!url) return errorValidacion('url', 'Pega el enlace del video publicado en TikTok.');
          cambios.publicacion = JSON.stringify(Object.assign({}, idea.publicacion, { url, fecha: idea.publicacion.fecha || hoy_() }));
        }
      }
    }
    Object.assign(cambios, { etapa: destino, motivo_descarte: '' });
  }
  actualizarFilaPorId_(db, 'HOMPY_IDEAS', 'idea_id', f.idea_id, cambios);
  return { idea: ideaPublica_(ideaFila_(db, f.idea_id)) };
}

function votarIdea(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  const f = ideaFila_(db, data && data.idea_id);
  if (!f) return errorValidacion('idea_id', 'Esa idea ya no existe.');
  const yo = String(contexto.email || '').toLowerCase();
  const votos = json_(f.votos, []).filter(Boolean);
  const i = votos.indexOf(yo);
  if (i === -1) votos.push(yo); else votos.splice(i, 1);
  actualizarFilaPorId_(db, 'HOMPY_IDEAS', 'idea_id', f.idea_id, { votos: JSON.stringify(votos) });
  return { idea: ideaPublica_(ideaFila_(db, f.idea_id)) };
}

function eliminarIdea(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  const f = ideaFila_(db, data && data.idea_id);
  if (!f) return errorValidacion('idea_id', 'Esa idea ya no existe.');
  if (f.etapa === 'PUBLICADO') return errorValidacion('idea_id', 'Un video publicado no se elimina: queda como registro.');
  actualizarFilaPorId_(db, 'HOMPY_IDEAS', 'idea_id', f.idea_id, { activo: false, actualizado_por: contexto.email, fecha_actualizacion: ahora_() });
  return { eliminado: f.idea_id };
}

/** Agenda (o mueve) la grabación en el calendario de Hompy y la deja enlazada a la idea. */
function agendarGrabacion(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  data = data || {};
  const f = ideaFila_(db, data.idea_id);
  if (!f) return errorValidacion('idea_id', 'Esa idea ya no existe.');
  const fecha = fecha_(data.fecha);
  if (!fecha) return errorValidacion('fecha', 'Elige el día de la grabación.');
  const lista = tipos_(db).filter((t) => t.activo);
  const tipo = lista.find((t) => t.tipo_id === data.tipo_id) || lista.find((t) => /grab/i.test(t.nombre)) || lista.find((t) => t.icono === 'camara') || lista[0];
  const idea = ideaPublica_(f);
  const datosEv = {
    tipo_id: tipo.tipo_id, titulo: 'Grabación TikTok: ' + idea.titulo, fecha, hora_inicio: data.hora || '', lugar: data.lugar || '',
    descripcion: (idea.idea.gancho ? 'Gancho: ' + idea.idea.gancho + '\n' : '') + 'Agendada desde el Estudio TikTok.'
  };
  const previo = idea.produccion.evento_id && eventoFila_(db, idea.produccion.evento_id);
  const r = previo
    ? guardarEvento(db, Object.assign({ evento_id: previo.evento_id, participantes: json_(previo.participantes, []) }, datosEv), contexto)
    : guardarEvento(db, datosEv, contexto);
  if (!r.evento) return r;
  actualizarFilaPorId_(db, 'HOMPY_EVENTOS', 'evento_id', r.evento.evento_id, { idea_id: idea.idea_id });
  const prod = Object.assign({}, idea.produccion, {
    fecha_grabacion: fecha, hora_grabacion: hora_(data.hora), lugar: linea_(data.lugar, 120) || idea.produccion.lugar, evento_id: r.evento.evento_id
  });
  actualizarFilaPorId_(db, 'HOMPY_IDEAS', 'idea_id', idea.idea_id, { produccion: JSON.stringify(prod), actualizado_por: contexto.email, fecha_actualizacion: ahora_() });
  return { idea: ideaPublica_(ideaFila_(db, idea.idea_id)), evento: eventoPublico_(eventoFila_(db, r.evento.evento_id)) };
}

// --- todo lo del módulo en una llamada ------------------------------------------------------
function datos(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  const salidas = leer_(db, 'HOMPY_SALIDAS').filter((s) => esVerdadero_(s.activo)).map(salidaPublica_);
  return {
    hoy: hoy_(), tipos: tipos_(db), eventos: eventos_(db), salidas, ideas: ideas_(db), personas: personas_(db), nombres: nombres_(db),
    catalogos: { colores: COLORES, iconos: ICONOS, estados_traje: ESTADOS_TRAJE, material: MATERIAL, max_tipos: MAX_TIPOS,
      etapas: ETAPAS, nombres_etapa: NOMBRE_ETAPA, objetivos: OBJETIVOS, formatos: FORMATOS, duraciones: DURACIONES, planos: PLANOS, checklist: CHECKLIST, metricas: METRICAS }
  };
}

// --- PDF del reporte de salida ----------------------------------------------------------------
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function fechaLarga_(f) { const d = new Date(f + 'T12:00:00Z'); return isNaN(d) ? f : DIAS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' de ' + MESES[d.getUTCMonth()] + ' de ' + d.getUTCFullYear(); }
function duracion_(a, b) {
  const m = minutos_(b) - minutos_(a);
  if (!a || !b || !(m > 0)) return '';
  return (m >= 60 ? Math.floor(m / 60) + ' h ' : '') + (m % 60 ? (m % 60) + ' min' : '').trim();
}
function pesos_(n) { return '$' + Math.round(n || 0).toLocaleString('es-CL'); }
const TRAJE_TXT = { BUENO: 'En buen estado', LIMPIEZA: 'Necesita limpieza', REPARACION: 'Necesita reparación' };

let caraCache_ = null;
function caraHompy_() {
  if (caraCache_ !== null) return caraCache_;
  try { caraCache_ = 'data:image/webp;base64,' + fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'assets', 'hompy', 'hompy-cara.webp')).toString('base64'); }
  catch (e) { caraCache_ = ''; }
  return caraCache_;
}

/** Cuerpo del PDF (HTML con las clases hp2-pdf-* de hompy-v2.css). Exportado para la prueba. */
function cuerpoPdf_(evento, tipo, salida, nombres, U) {
  const esc = U.esc;
  const d = salida.datos || {};
  const nada = '<span class="hp2-pdf-nada">—</span>';
  const v = (x) => (x === null || x === undefined || x === '' ? nada : esc(x));
  const dato = (et, val) => '<div><dt>' + esc(et) + '</dt><dd>' + val + '</dd></div>';
  const bloque = (titulo, ico, html) => '<section class="hp2-pdf-bloque"><h2>' + U.ico(ico, 16) + esc(titulo) + '</h2>' + html + '</section>';
  const parrafo = (et, t) => (t ? '<div class="hp2-pdf-texto"><h3>' + esc(et) + '</h3><p>' + esc(t) + '</p></div>' : '');
  const estrellas = (n) => '<span class="hp2-pdf-estrellas" aria-label="' + (n || 0) + ' de 5">' + [1, 2, 3, 4, 5].map((i) => '<i class="' + (i <= (n || 0) ? 'on' : '') + '">★</i>').join('') + '</span>';
  const gastos = ['gasto_transporte', 'gasto_estacionamiento', 'gasto_colacion', 'gasto_otros'].reduce((s, k) => s + (Number(d[k]) || 0), 0);
  const cara = caraHompy_();

  const portada = '<div class="hp2-pdf-portada hp2-color-' + esc(tipo.color) + '">' +
    (cara ? '<img class="hp2-pdf-cara" src="' + cara + '" alt="">' : '') +
    '<div><span class="hp2-pdf-tipo">' + U.ico(tipo.icono, 14) + esc(tipo.nombre) + '</span>' +
    '<h1>' + esc(evento.titulo) + '</h1>' +
    '<p>' + esc(fechaLarga_(evento.fecha)) + (evento.lugar ? ' · ' + esc(evento.lugar) : '') + (evento.comuna ? ', ' + esc(evento.comuna) : '') + '</p></div>' +
    '<div class="hp2-pdf-nota">' + estrellas(d.calificacion) + '<span>' + (d.publico != null ? esc(Number(d.publico).toLocaleString('es-CL')) + ' personas' : 'Público sin registrar') + '</span></div>' +
    '</div>';

  const cifras = '<div class="hp2-pdf-cifras">' +
    [['Duración', duracion_(d.hora_inicio, d.hora_fin) || '—'], ['Público estimado', d.publico != null ? Number(d.publico).toLocaleString('es-CL') : '—'],
      ['Fotos / videos', (d.fotos != null ? d.fotos : 0) + ' / ' + (d.videos != null ? d.videos : 0)], ['En el traje', d.minutos_traje != null ? d.minutos_traje + ' min' : '—']]
      .map((c) => '<div><span>' + esc(c[0]) + '</span><b>' + esc(c[1]) + '</b></div>').join('') + '</div>';

  const lugar = bloque('Lugar y horarios', 'ubicacion', '<dl class="hp2-pdf-datos">' +
    dato('Lugar', v(d.lugar_real || evento.lugar)) + dato('Dirección', v([evento.direccion, evento.comuna].filter(Boolean).join(', '))) +
    dato('Salida de la oficina', v(d.hora_salida)) + dato('Llegada al lugar', v(d.hora_llegada)) +
    dato('Inicio de la actividad', v(d.hora_inicio)) + dato('Término', v(d.hora_fin)) + dato('Regreso', v(d.hora_regreso)) + '</dl>');

  const equipo = bloque('Quiénes fueron', 'equipo', '<dl class="hp2-pdf-datos">' +
    dato('Usó el traje de Hompy', v(d.traje)) + dato('Apoyo', v((d.apoyo || []).join(', '))) + dato('Conductor', v(d.conductor)) +
    dato('Contacto en el lugar', v([d.contacto_lugar, d.contacto_telefono].filter(Boolean).join(' · '))) + '</dl>');

  const traje = bloque('El traje y quien lo usó', 'casco', '<dl class="hp2-pdf-datos">' +
    dato('Tiempo dentro del traje', v(d.minutos_traje != null ? d.minutos_traje + ' min' : '')) + dato('Pausas', v(d.pausas)) +
    dato('Hidratación', d.hidratacion ? 'Sí' : 'No registrada') + dato('Estado del traje', v(TRAJE_TXT[d.estado_traje] || '')) + '</dl>' +
    parrafo('Detalle del traje', d.nota_traje));

  const alcance = bloque('Material y contenido', 'camara', '<dl class="hp2-pdf-datos">' +
    dato('Material llevado', v((d.material || []).join(', '))) +
    dato('¿Volvió completo?', d.material_completo === null || d.material_completo === undefined ? nada : (d.material_completo ? 'Sí' : 'No')) +
    dato('Fotos', v(d.fotos)) + dato('Videos', v(d.videos)) + dato('Se grabó un TikTok', d.tiktok ? 'Sí' : 'No') +
    dato('Carpeta de fotos', d.enlace_fotos ? '<a href="' + esc(d.enlace_fotos) + '">' + esc(d.enlace_fotos) + '</a>' : nada) + '</dl>' +
    parrafo('Sobre el material', d.nota_material));

  const evaluacion = bloque('Cómo nos fue', 'estrella',
    '<div class="hp2-pdf-eval">' + estrellas(d.calificacion) + '</div>' +
    parrafo('Lo que salió bien', d.bien) + parrafo('Qué mejorar', d.mejorar) + parrafo('Incidentes', d.incidentes) + parrafo('Comentarios', d.comentarios) +
    (!d.bien && !d.mejorar && !d.incidentes && !d.comentarios ? '<p class="hp2-pdf-nada">Sin comentarios registrados.</p>' : ''));

  const gastosHtml = gastos > 0 ? bloque('Gastos', 'dinero', '<dl class="hp2-pdf-datos">' +
    dato('Transporte', v(d.gasto_transporte ? pesos_(d.gasto_transporte) : '')) + dato('Estacionamiento', v(d.gasto_estacionamiento ? pesos_(d.gasto_estacionamiento) : '')) +
    dato('Colación', v(d.gasto_colacion ? pesos_(d.gasto_colacion) : '')) + dato('Otros', v(d.gasto_otros ? pesos_(d.gasto_otros) : '')) +
    dato('Total', '<b>' + esc(pesos_(gastos)) + '</b>') + '</dl>') : '';

  const firma = '<p class="hp2-pdf-firma">' + (salida.estado === 'CERRADO'
    ? 'Reporte cerrado por ' + esc(nombres[String(salida.cerrado_por).toLowerCase()] || salida.cerrado_por) + ' el ' + esc(new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'long', timeStyle: 'short' }).format(new Date(salida.fecha_cierre)))
    : 'Borrador: el reporte todavía no se cierra.') + '</p>';

  return '<div class="hp2-pdf">' + portada + cifras + '<div class="hp2-pdf-grilla">' + lugar + equipo + traje + alcance + '</div>' + evaluacion + gastosHtml + firma + '</div>';
}

async function pdfSalida(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  const e = eventoFila_(db, data && data.evento_id);
  if (!e) return errorValidacion('evento_id', 'Esa actividad ya no existe.');
  const salida = salidaDe_(db, e.evento_id);
  if (!salida) return errorValidacion('evento_id', 'Esta actividad todavía no tiene reporte de salida.');
  const DocV2 = require('./documentoV2');
  if (!DocV2.disponible()) return errorValidacion('pdf', 'El generador de PDF no está disponible en este servidor.');
  const evento = eventoPublico_(e);
  const tipo = tipos_(db).find((t) => t.tipo_id === evento.tipo_id) || { nombre: 'Actividad', color: 'gris', icono: 'calendario' };
  const { U } = DocV2.piezas();
  return DocV2.aPdf(db, contexto, {
    titulo: 'Reporte de salida a terreno', subtitulo: evento.titulo, modulo: 'Hompy', codigo: evento.evento_id,
    filtros: [{ etiqueta: 'Tipo', valor: tipo.nombre }, { etiqueta: 'Fecha', valor: fechaLarga_(evento.fecha) }].concat(evento.lugar ? [{ etiqueta: 'Lugar', valor: evento.lugar }] : []),
    cuerpo: cuerpoPdf_(evento, tipo, salida, nombres_(db), U), nombreArchivo: 'Salida-Hompy-' + evento.fecha + '-' + evento.titulo.slice(0, 40), enlaces: true
  });
}

module.exports = {
  datos, guardarTipo, guardarEvento, cambiarEstadoEvento, eliminarEvento, guardarSalida, reabrirSalida, pdfSalida,
  guardarIdea, moverIdea, votarIdea, eliminarIdea, agendarGrabacion,
  // para las pruebas
  puede_, limpiarDatosSalida_, faltaParaAvanzar_, limpiarDialogo_, limpiarGuion_, faltantesParaCerrar_, cuerpoPdf_, TIPOS_PROPUESTA, MODULO
};
