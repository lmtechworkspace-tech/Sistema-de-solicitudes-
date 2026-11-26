'use strict';

/**
 * oficinaVirtual.js — datos de la Oficina virtual (recorrido 3D de la oficina
 * de HomePymes, frontend/oficina.html).
 *
 * Quién se sienta dónde sale de Calidad → Personas (SGC_PERSONAS) y lo que hace
 * cada cargo, de su descriptor vigente (SGC_DESCRIPTORES). Las salas, lo que
 * hace cada una y cómo se comunican viven en el frontend (oficina/datos.js):
 * son el plano, no datos de personas.
 *
 * Qué se muestra y a quién (decisión 2026-11-26): cualquier persona con sesión
 * ve el recorrido completo -- nombre, cargo, oficina, jefatura y el CONTENIDO
 * del descriptor (objetivo, funciones, responsabilidades, habilidades y
 * requisitos), que es información del cargo, no de la persona. NUNCA salen de
 * aquí RUT, correos, documentos, inducciones ni evaluaciones: eso sigue con el
 * permiso de siempre en Calidad → Personas.
 *
 * Oficina de cada persona: la que se asignó a mano (OFICINA_PUESTOS) o, si no
 * hay, una sugerida por el cargo. Las externas (tipo EXT) solo aparecen si se
 * les asigna oficina. Asignar lo puede quien gobierna el SGC o un super admin.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');

// Las salas del plano donde se puede sentar alguien (ids de oficina/datos.js).
const SALAS_OFICINA = ['recepcion', 'reuniones', 'operativo', 'jefaturas', 'plataformas', 'almacen', 'podcast', 'bano', 'prevencion', 'comedor'];

// Sugerencia por cargo, en orden: la primera que calza gana.
const REGLAS_CARGO = [
  [/practicante|plataforma/i, 'plataformas'],
  [/podcast|entrevist/i, 'podcast'],
  [/prevenci/i, 'prevencion'],
  [/gerent[ea].*(administraci|finanz)|encargad[ao]\s+de\s+administraci|jef[ea]\s+de\s+administraci/i, 'jefaturas'],
  [/factura|cobranza|recepci/i, 'recepcion'],
  [/contab|contador|rr\.?\s*hh|recursos\s+humanos|remuneraci|personal/i, 'operativo']
];

function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function leerSeguro_(db, hoja) { try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (err) { return []; } }
function normalizarEmail_(e) { return String(e || '').trim().toLowerCase(); }

function salaSugerida_(cargo) {
  const texto = String(cargo || '');
  const regla = REGLAS_CARGO.find(([re]) => re.test(texto));
  return regla ? regla[1] : '';
}
// Un descriptor guarda las listas como texto (una por línea) o como JSON.
function lista_(valorItems, valorTexto) {
  let items = [];
  if (Array.isArray(valorItems)) items = valorItems;
  else if (valorItems) { try { const p = JSON.parse(valorItems); if (Array.isArray(p)) items = p; } catch (err) { /* texto */ } }
  items = items.map((x) => (typeof x === 'string' ? x : (x && (x.texto || x.descripcion || x.nombre)) || '')).map((s) => String(s).trim()).filter(Boolean);
  if (items.length) return items;
  return String(valorTexto || '').split(/\r?\n/).map((s) => s.replace(/^\s*[-•*·]\s*/, '').trim()).filter(Boolean);
}
function puedeOrdenar_(db, contexto) {
  return !!contexto && (contexto.super_admin === true || Calidad.gobiernaSgc_(db, contexto));
}

/** Todo lo que la oficina necesita: personas con su oficina, jefatura y descriptor. */
function getOficina(db, data, contexto) {
  if (!contexto) return { _validationError: true, message: 'Ingresa a SIGSO para ver la oficina.' };
  const fichas = leerSeguro_(db, 'SGC_PERSONAS').filter((p) => esVerdadero_(p.activa) && p.estado !== 'DESVINCULADO');
  const descriptores = leerSeguro_(db, 'SGC_DESCRIPTORES').filter((d) => esVerdadero_(d.vigente));
  const puestos = leerSeguro_(db, 'OFICINA_PUESTOS').filter((p) => esVerdadero_(p.activa));
  const puestoDe = new Map(puestos.map((p) => [p.persona_id, p.sala_id]));
  // jefatura: viene como correo; se traduce a la ficha de esa persona (el correo no sale).
  const fichaPorEmail = new Map();
  fichas.forEach((p) => { const e = normalizarEmail_(p.usuario_email); if (e && !fichaPorEmail.has(e)) fichaPorEmail.set(e, p.persona_id); });

  const personas = [];
  const sinOficina = [];
  for (const p of fichas) {
    const asignada = puestoDe.get(p.persona_id) || '';
    const sugerida = p.tipo === 'EXT' ? '' : salaSugerida_(p.cargo);
    const sala = SALAS_OFICINA.indexOf(asignada) !== -1 ? asignada : sugerida;
    const d = descriptores.find((x) => x.persona_id === p.persona_id);
    const fila = {
      persona_id: p.persona_id, nombre: p.nombre || '', cargo: p.cargo || '',
      sala_id: sala, sala_asignada: !!asignada,
      jefatura_persona_id: fichaPorEmail.get(normalizarEmail_(p.jefatura_email)) || '',
      descriptor: d ? {
        version: d.version || '', objetivo: d.objetivo || '',
        funciones: lista_(null, d.funciones),
        responsabilidades: lista_(d.items_responsabilidades, d.responsabilidades),
        habilidades: lista_(d.items_habilidades, d.habilidades),
        nivel_educacional: d.nivel_educacional || '', formacion_tecnica: d.formacion_tecnica || '', experiencia: d.experiencia || ''
      } : null
    };
    if (sala) personas.push(fila); else sinOficina.push({ persona_id: p.persona_id, nombre: fila.nombre, cargo: fila.cargo });
  }
  personas.sort((a, b) => a.nombre.localeCompare(b.nombre));
  const ordenar = puedeOrdenar_(db, contexto);
  return { personas, puede_ordenar: ordenar, sin_oficina: ordenar ? sinOficina : [], salas: SALAS_OFICINA };
}

/** Sienta a una persona en una oficina (sala_id vacío = volver a la sugerida por el cargo). */
function asignarPuesto(db, data, contexto) {
  if (!puedeOrdenar_(db, contexto)) return { _validationError: true, message: 'Solo quien administra Calidad puede ordenar la oficina.' };
  const personaId = String((data && data.persona_id) || '');
  const salaId = String((data && data.sala_id) || '');
  const ficha = leerSeguro_(db, 'SGC_PERSONAS').find((p) => p.persona_id === personaId && esVerdadero_(p.activa));
  if (!ficha) return { _validationError: true, campo: 'persona_id', message: 'No encontré a esa persona en Calidad → Personas.' };
  if (salaId && SALAS_OFICINA.indexOf(salaId) === -1) return { _validationError: true, campo: 'sala_id', message: 'Esa oficina no está en el plano.' };
  const ahora = new Date().toISOString();
  leerSeguro_(db, 'OFICINA_PUESTOS').filter((p) => p.persona_id === personaId && esVerdadero_(p.activa))
    .forEach((p) => actualizarFilaPorId_(db, 'OFICINA_PUESTOS', 'puesto_id', p.puesto_id, { activa: false }));
  if (salaId) {
    agregarFila_(db, 'OFICINA_PUESTOS', {
      puesto_id: crypto.randomUUID(), persona_id: personaId, sala_id: salaId,
      actualizado_por: contexto.email || '', fecha: ahora, activa: true
    });
  }
  return { persona_id: personaId, sala_id: salaId || salaSugerida_(ficha.cargo), sala_asignada: !!salaId };
}

module.exports = { getOficina, asignarPuesto, salaSugerida_, SALAS_OFICINA };
