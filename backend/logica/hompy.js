'use strict';

/**
 * hompy.js — módulo Hompy, la mascota de HomePymes (Etapa 1, 2026-10-06).
 *
 * Lo llevan Bárbara y Lisseth (y el dueño). Etapa 1: el calendario de las
 * actividades de Hompy y el REPORTE DE SALIDA A TERRENO de cada una, con su
 * PDF. Etapa 2 suma el Estudio TikTok (idea → diálogo → guión → video) y la
 * Etapa 3 las marcas colaboradoras y el reporte mensual.
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
    motivo_cancelacion: e.motivo_cancelacion || '', creado_por: e.creado_por || '', fecha_creacion: e.fecha_creacion || ''
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

// --- todo lo del módulo en una llamada ------------------------------------------------------
function datos(db, data, contexto) {
  if (!puede_(contexto)) return sinAcceso_();
  const salidas = leer_(db, 'HOMPY_SALIDAS').filter((s) => esVerdadero_(s.activo)).map(salidaPublica_);
  return {
    hoy: hoy_(), tipos: tipos_(db), eventos: eventos_(db), salidas, personas: personas_(db), nombres: nombres_(db),
    catalogos: { colores: COLORES, iconos: ICONOS, estados_traje: ESTADOS_TRAJE, material: MATERIAL, max_tipos: MAX_TIPOS }
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
  // para las pruebas
  puede_, limpiarDatosSalida_, faltantesParaCerrar_, cuerpoPdf_, TIPOS_PROPUESTA, MODULO
};
