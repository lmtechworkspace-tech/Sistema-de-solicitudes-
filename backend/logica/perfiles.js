'use strict';

/**
 * perfiles.js — puerto PARCIAL de Perfiles.gs (v6.4), a propósito: solo
 * `getMiPerfil` (perfil propio, SOLO lectura: nombre/email/cargo/rol/
 * empresa). `guardarFoto`/`eliminarFoto`/`getFotosDe` (foto de perfil, con
 * validación por firma binaria + cache) quedan fuera -- decisión
 * consciente, preguntada al usuario (Fase 3c, 2026-09-19): es un módulo
 * aparte (cache, validación binaria, storage, tabla PERFILES nueva), más
 * grande que el resto de Fase 3c junto. R2 ya está disponible para cuando
 * se porte (Fase 2 resuelta), pero eso no estaba en el alcance de este
 * incremento.
 *
 * Como en el .gs, la identidad sale SIEMPRE de `contexto`, nunca de un
 * identificador que mande el cliente en `data` -- no hay parámetro que
 * falsificar porque no existe. GOOGLE (por email normalizado) y PORTAL
 * (por cuenta_id) son las dos poblaciones; hoy en Node solo la rama PORTAL
 * es alcanzable (`contexto.via_portal` siempre viene `true`, ver la
 * cabecera de router.js), pero se porta la rama GOOGLE igual, fiel al
 * .gs, para el día en que haya sesión de Google en Node.
 *
 * `tiene_foto` siempre `false` y `foto_thumb` siempre `''`: la tabla
 * PERFILES no existe en Node todavía. Es honesto, no fingido -- nadie subió
 * una foto porque la acción para subirla no existe.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}
function leerSeguro_(db, hoja) {
  try { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
  catch (err) { return []; }
}

function identidadDe_(contexto) {
  if (!contexto) return null;
  if (contexto.via_portal) {
    return contexto.cuenta_id ? { tipo: 'PORTAL', clave: String(contexto.cuenta_id) } : null;
  }
  return contexto.email ? { tipo: 'GOOGLE', clave: normalizarEmail_(contexto.email) } : null;
}

// No se copian nombre/rol/empresa a un perfil propio: se leen de donde ya
// viven (USUARIOS o CUENTAS_PORTAL), para que no haya dos versiones del
// mismo dato.
function datosIdentidad_(db, contexto, identidad) {
  if (identidad.tipo === 'PORTAL') {
    const cuenta = leerSeguro_(db, 'CUENTAS_PORTAL').find((c) => String(c.cuenta_id) === identidad.clave) || {};
    return {
      nombre: cuenta.nombre || contexto.email || '',
      email: contexto.email || '',
      cargo: cuenta.cargo || '',
      rol: cuenta.rol || contexto.rol || '',
      empresa_id: cuenta.empresa_id || ''
    };
  }
  const usuario = leerSeguro_(db, 'USUARIOS').find((u) => normalizarEmail_(u.email) === identidad.clave) || {};
  return {
    nombre: usuario.nombre || contexto.email || '',
    email: usuario.email || contexto.email || '',
    cargo: '',
    rol: usuario.rol || contexto.rol || '',
    empresa_id: usuario.empresa_id || ''
  };
}

function nombreEmpresa_(db, empresaId) {
  if (!empresaId) return '';
  const fila = leerSeguro_(db, 'CAT_EMPRESAS').find((e) => e.empresa_id === empresaId);
  return fila ? (fila.nombre || empresaId) : empresaId;
}

function getMiPerfil(db, data, contexto) {
  const identidad = identidadDe_(contexto);
  if (!identidad) {
    return { _forbidden: true, message: 'No fue posible resolver tu identidad.' };
  }
  const base = datosIdentidad_(db, contexto, identidad);
  return {
    nombre: base.nombre,
    email: base.email,
    cargo: base.cargo,
    rol: base.rol,
    empresa_id: base.empresa_id,
    empresa_nombre: nombreEmpresa_(db, base.empresa_id),
    // El origen sirve al frontend para rotular de donde viene la cuenta; no
    // es un identificador utilizable para escribir.
    origen: identidad.tipo,
    tiene_foto: false,
    foto_thumb: ''
  };
}

module.exports = { getMiPerfil };
