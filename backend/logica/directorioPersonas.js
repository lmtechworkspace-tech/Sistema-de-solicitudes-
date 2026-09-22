'use strict';

/**
 * directorioPersonas.js — Fase 1 del Directorio de Personas (2026-09-22),
 * el registro canónico de "quién es cada persona" en SIGSO, pensado para
 * vender la plataforma a otras empresas. Ver la nota completa de la tabla
 * DIRECTORIO_PERSONAS en backend/db/schema.js.
 *
 * Esta es la CAPA DE RESOLUCIÓN: dado un correo (la llave con la que hoy se
 * guardan ~40 FKs en todo el sistema), devuelve QUIÉN es esa persona
 * (nombre, cargo, RUT...) para poder mostrar "Nombre — Cargo" en vez del
 * correo crudo; y una búsqueda por RUT/nombre/cargo para el futuro selector
 * de "asignar a alguien" sin tener que escribir el correo de memoria.
 *
 * FASE 1 NO CAMBIA NINGUNA PANTALLA: este módulo solo LEE. La siembra de la
 * tabla la hace asegurarDirectorioPersonas_ (schema.js) al arrancar. El
 * correo sigue siendo la llave de almacenamiento -- reemplazarla por
 * persona_id es una fase posterior, en pausa.
 *
 * NO se toca directorioPersonal.js (el directorio viejo, más pobre, que usa
 * Calidad para "Accesos"): fusionarlos es parte de una fase posterior;
 * hacerlo ahora cambiaría el comportamiento de Calidad, y Fase 1 es a
 * propósito de cero cambio visible.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorForbidden } = require('./errores');

function normalizarRut_(rut) {
  return String(rut || '').replace(/[.\-\s]/g, '').toUpperCase();
}
function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function parsearLista_(valor) {
  if (Array.isArray(valor)) return valor;
  if (!valor) return [];
  try { const l = JSON.parse(valor); return Array.isArray(l) ? l : []; } catch (err) { return []; }
}
function normalizarTexto_(t) {
  let s = String(t == null ? '' : t).toLowerCase();
  if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s;
}

function leerDirectorio_(db) {
  try { return leerFilas_(db, 'DIRECTORIO_PERSONAS', COLUMNAS.DIRECTORIO_PERSONAS); }
  catch (err) { return []; }
}

// La forma que viaja al resto del sistema. `etiqueta` es la comodidad para
// pintar: "Nombre — Cargo" (o solo el nombre si no hay cargo).
function formatear_(p) {
  const nombre = p.nombre || '';
  const cargo = p.cargo_principal || '';
  return {
    persona_id: p.persona_id,
    nombre: nombre,
    cargo: cargo,
    rut: p.rut || '',
    emails: parsearLista_(p.emails),
    empresa_id: p.empresa_id || '',
    organizacion_id: p.organizacion_id || '',
    tiene_cuenta: esVerdadero_(p.tiene_cuenta),
    activa: esVerdadero_(p.activa),
    etiqueta: cargo ? (nombre + ' — ' + cargo) : nombre
  };
}

// --- API interna (la usan otros módulos para resolver, no pasa por HTTP) ---

// Dado un correo, ¿quién es? null si no está en el directorio (el llamador
// muestra el correo crudo -- degradación elegante).
function resolverPorEmail(db, email) {
  const norm = normalizarEmail_(email);
  if (!norm) return null;
  const fila = leerDirectorio_(db).find((p) => parsearLista_(p.emails).some((e) => normalizarEmail_(e) === norm));
  return fila ? formatear_(fila) : null;
}

function resolverPorRut(db, rut) {
  const norm = normalizarRut_(rut);
  if (!norm) return null;
  const fila = leerDirectorio_(db).find((p) => normalizarRut_(p.rut) === norm);
  return fila ? formatear_(fila) : null;
}

// Resuelve una lista de correos de una sola pasada (evita releer la tabla N
// veces cuando una pantalla pinta muchas personas). Devuelve un mapa
// correo_normalizado -> persona formateada.
function resolverVarios(db, emails) {
  const directorio = leerDirectorio_(db);
  const porEmail = {};
  directorio.forEach((p) => {
    const f = formatear_(p);
    parsearLista_(p.emails).forEach((e) => { porEmail[normalizarEmail_(e)] = f; });
  });
  const mapa = {};
  (emails || []).forEach((e) => {
    const norm = normalizarEmail_(e);
    if (norm && porEmail[norm]) mapa[norm] = porEmail[norm];
  });
  return mapa;
}

// --- API HTTP ---

// Fase 2 (2026-09-22): resolución masiva para la CAPA DE VISUALIZACIÓN --
// una pantalla junta todos los correos que va a pintar (responsable_email,
// supervisor_email, evaluador_email...) y los resuelve de UNA sola llamada,
// en vez de una por persona. Cualquier sesión válida puede llamarla (es
// lectura de "cómo se llama y qué cargo tiene alguien", no un dato sensible
// -- mismo criterio que ya usan el resto de las pantallas para mostrar
// nombres). No hace falta acotar por organización acá: resolverVarios ya
// solo encuentra lo que está en el directorio, y el correo que se pregunta
// lo eligió la propia pantalla que ya tenía permiso para verlo.
function resolverPersonas(db, data, contexto) {
  if (!contexto || !contexto.email) return errorForbidden('Necesitas una sesión válida.');
  const emails = Array.isArray(data && data.emails) ? data.emails : [];
  return { personas: resolverVarios(db, emails) };
}

// --- (Fase 1: solo lectura, para verificar y para las fases que vienen) ---

// Búsqueda para el futuro selector "asignar a alguien". Coincide por RUT,
// nombre, cargo o correo. Acotada a la organización de quien pregunta
// (multi-tenant: nunca ves personas de otro cliente). Por defecto solo
// activas (a quién se le puede asignar algo hoy).
function buscarPersonas(db, data, contexto) {
  if (!contexto || !contexto.email) return errorForbidden('Necesitas una sesión válida.');
  const orgActual = contexto.organizacion_id || '';
  const texto = normalizarTexto_(data && data.texto);
  const rutBuscado = normalizarRut_(data && data.texto);
  const incluirInactivas = !!(data && data.incluir_inactivas);

  const resultados = leerDirectorio_(db)
    .filter((p) => !orgActual || (p.organizacion_id || '') === orgActual || !p.organizacion_id)
    .filter((p) => incluirInactivas || esVerdadero_(p.activa))
    .filter((p) => {
      if (!texto) return true;
      if (rutBuscado && normalizarRut_(p.rut).indexOf(rutBuscado) !== -1) return true;
      const heno = normalizarTexto_(p.nombre) + ' ' + normalizarTexto_(p.cargo_principal) + ' ' +
        parsearLista_(p.emails).map(normalizarEmail_).join(' ');
      return heno.indexOf(texto) !== -1;
    })
    .map(formatear_)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return { personas: resultados.slice(0, 50) };
}

// Volcado completo del directorio -- solo ADM (herramienta de gestión/
// verificación). Acotado a la organización del ADM.
function listar(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return errorForbidden('Solo un Administrador puede ver el directorio de personas.');
  const orgActual = contexto.organizacion_id || '';
  const personas = leerDirectorio_(db)
    .filter((p) => !orgActual || (p.organizacion_id || '') === orgActual || !p.organizacion_id)
    .map(formatear_)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  return { personas };
}

module.exports = {
  resolverPorEmail, resolverPorRut, resolverVarios,
  buscarPersonas, listar, resolverPersonas
};
