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
 *
 * Fantasmas (2026-11-26, pedido del dueño): personas sin puesto fijo que se ven
 * translúcidas recorriendo la oficina. Por ficha o, si no tienen ficha, por su
 * cuenta de SIGSO (solo nombre y cargo de la cuenta). Los marca quien ordena.
 * «yo»: la ficha (o el fantasma) de quien mira, por sus correos, para que pueda
 * tomar el control de su mono. Nunca sale un correo en la respuesta.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');

// Las salas del plano donde se puede sentar alguien (ids de oficina/datos.js).
const SALAS_OFICINA = ['recepcion', 'reuniones', 'operativo', 'jefaturas', 'plataformas', 'almacen', 'podcast', 'bano', 'prevencion', 'comedor'];

// Sugerencia por cargo, en orden: la primera que calza gana.
const REGLAS_CARGO = [
  [/prevenci|riesgo/i, 'prevencion'], // antes que «practicante»: la practicante de Prevención va a Prevención
  [/practicante|plataforma/i, 'plataformas'],
  [/podcast|entrevist/i, 'podcast'],
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

  const formato = (d) => (d ? {
    version: d.version || '', objetivo: d.objetivo || '',
    funciones: lista_(null, d.funciones),
    responsabilidades: lista_(d.items_responsabilidades, d.responsabilidades),
    habilidades: lista_(d.items_habilidades, d.habilidades),
    nivel_educacional: d.nivel_educacional || '', formacion_tecnica: d.formacion_tecnica || '', experiencia: d.experiencia || ''
  } : null);

  // Una persona con dos cargos tiene DOS fichas con el mismo correo (v14.0): en
  // la oficina es UNA sola persona, con todos sus cargos y descriptores.
  const grupos = new Map();
  for (const p of fichas) {
    const clave = normalizarEmail_(p.usuario_email) || ('id:' + p.persona_id);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(p);
  }
  // Fantasmas: por ficha o por cuenta. Una cuenta cuyo correo ya tiene ficha se
  // trata como esa ficha (nunca dos personajes para la misma persona).
  const cuentas = leerSeguro_(db, 'CUENTAS_PORTAL').filter((c) => esVerdadero_(c.activo));
  const correosDe = (c) => listaCorreos_(c.emails);
  const fantasmas = leerSeguro_(db, 'OFICINA_FANTASMAS').filter((f) => esVerdadero_(f.activa));
  const fichaFantasma = new Set(fantasmas.filter((f) => f.persona_id).map((f) => f.persona_id));
  const cuentasFantasma = [];
  fantasmas.filter((f) => f.cuenta_id).forEach((f) => {
    const c = cuentas.find((x) => x.cuenta_id === f.cuenta_id); if (!c) return;
    const conFicha = correosDe(c).map((e) => grupos.get(e)).find(Boolean);
    if (conFicha) conFicha.forEach((p) => fichaFantasma.add(p.persona_id));
    else cuentasFantasma.push(c);
  });
  const misCorreos = [].concat(contexto.emails || [], contexto.email || []).map(normalizarEmail_).filter(Boolean);
  let yoId = '';

  const personas = [];
  const sinOficina = [];
  const idPrincipal = new Map();
  for (const grupo of grupos.values()) {
    const conPuesto = grupo.find((p) => SALAS_OFICINA.indexOf(puestoDe.get(p.persona_id)) !== -1);
    const conSugerida = grupo.find((p) => p.tipo !== 'EXT' && salaSugerida_(p.cargo));
    const principal = conPuesto || conSugerida || grupo[0];
    const asignada = conPuesto ? puestoDe.get(conPuesto.persona_id) : '';
    const sala = asignada || (conSugerida ? salaSugerida_(conSugerida.cargo) : '');
    // primero el cargo de la ficha principal, después los demás
    const orden = [principal].concat(grupo.filter((p) => p !== principal));
    const cargos = orden.map((p) => String(p.cargo || '').trim()).filter((c, i, a) => c && a.indexOf(c) === i);
    const descs = orden.map((p) => ({ cargo: p.cargo || '', d: formato(descriptores.find((x) => x.persona_id === p.persona_id)) })).filter((x) => x.d);
    const fila = {
      persona_id: principal.persona_id, nombre: principal.nombre || '', cargo: cargos.join(' · '),
      sala_id: sala, sala_asignada: !!asignada,
      jefatura_persona_id: fichaPorEmail.get(normalizarEmail_(principal.jefatura_email)) || '',
      descriptor: descs.length ? descs[0].d : null,
      descriptores: descs.map((x) => Object.assign({ cargo: x.cargo }, x.d))
    };
    grupo.forEach((p) => idPrincipal.set(p.persona_id, principal.persona_id));
    if (grupo.some((p) => misCorreos.indexOf(normalizarEmail_(p.usuario_email)) !== -1)) yoId = principal.persona_id;
    if (grupo.some((p) => fichaFantasma.has(p.persona_id))) { fila.fantasma = true; personas.push(fila); continue; }
    if (sala) personas.push(fila); else sinOficina.push({ persona_id: principal.persona_id, nombre: fila.nombre, cargo: fila.cargo });
  }
  for (const c of cuentasFantasma) {
    const id = 'cuenta:' + c.cuenta_id;
    if (String(contexto.cuenta_id || '') === String(c.cuenta_id)) yoId = id;
    personas.push({ persona_id: id, nombre: c.nombre || 'Sin nombre', cargo: c.cargo || '', sala_id: '', sala_asignada: false,
      jefatura_persona_id: '', descriptor: null, descriptores: [], fantasma: true });
  }
  // la jefatura apunta a la persona (su ficha principal), y nadie se reporta a sí mismo
  personas.forEach((f) => {
    const jefe = idPrincipal.get(f.jefatura_persona_id) || '';
    f.jefatura_persona_id = jefe === f.persona_id ? '' : jefe;
  });
  personas.sort((a, b) => a.nombre.localeCompare(b.nombre));
  const ordenar = puedeOrdenar_(db, contexto);
  const miCuenta = cuentas.find((c) => String(c.cuenta_id) === String(contexto.cuenta_id || ''));
  // Para marcar fantasmas: las cuentas sin ficha que aún no lo son (solo nombre y cargo).
  const candidatos = ordenar ? cuentas
    .filter((c) => !correosDe(c).some((e) => grupos.has(e)) && !cuentasFantasma.includes(c))
    .map((c) => ({ persona_id: 'cuenta:' + c.cuenta_id, nombre: c.nombre || '', cargo: c.cargo || '' }))
    .filter((c) => c.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre)) : [];
  return {
    personas, puede_ordenar: ordenar, sin_oficina: ordenar ? sinOficina : [], salas: SALAS_OFICINA,
    yo: { persona_id: yoId, nombre: (miCuenta && miCuenta.nombre) || '' },
    candidatos_fantasma: candidatos
  };
}
function listaCorreos_(valor) {
  let l = valor;
  if (typeof l === 'string') { try { l = JSON.parse(l); } catch (err) { l = l.split(/[,;\s]+/); } }
  return (Array.isArray(l) ? l : []).map(normalizarEmail_).filter(Boolean);
}

/** Marca o desmarca a alguien como fantasma: una ficha (persona_id) o una cuenta sin ficha ('cuenta:<id>'). */
function marcarFantasma(db, data, contexto) {
  if (!puedeOrdenar_(db, contexto)) return { _validationError: true, message: 'Solo quien administra Calidad puede ordenar la oficina.' };
  const id = String((data && data.persona_id) || '');
  const fantasma = !!(data && data.fantasma);
  const activos = leerSeguro_(db, 'OFICINA_FANTASMAS').filter((f) => esVerdadero_(f.activa));
  const apagar = (filtro) => activos.filter(filtro).forEach((f) => actualizarFilaPorId_(db, 'OFICINA_FANTASMAS', 'fantasma_id', f.fantasma_id, { activa: false }));
  const nueva = (campos) => agregarFila_(db, 'OFICINA_FANTASMAS', Object.assign({
    fantasma_id: crypto.randomUUID(), persona_id: '', cuenta_id: '', creado_por: contexto.email || '', fecha: new Date().toISOString(), activa: true
  }, campos));
  const cuentas = leerSeguro_(db, 'CUENTAS_PORTAL').filter((c) => esVerdadero_(c.activo));

  if (id.indexOf('cuenta:') === 0) {
    const cuentaId = id.slice(7);
    if (!cuentas.some((c) => String(c.cuenta_id) === cuentaId)) return { _validationError: true, campo: 'persona_id', message: 'No encontré esa cuenta.' };
    apagar((f) => String(f.cuenta_id) === cuentaId);
    if (fantasma) nueva({ cuenta_id: cuentaId });
    return { persona_id: id, fantasma };
  }
  const ficha = leerSeguro_(db, 'SGC_PERSONAS').find((p) => p.persona_id === id && esVerdadero_(p.activa));
  if (!ficha) return { _validationError: true, campo: 'persona_id', message: 'No encontré a esa persona en Calidad → Personas.' };
  const email = normalizarEmail_(ficha.usuario_email);
  const suyas = new Set(leerSeguro_(db, 'SGC_PERSONAS').filter((p) => p.persona_id === id || (email && normalizarEmail_(p.usuario_email) === email)).map((p) => p.persona_id));
  const cuentasSuyas = new Set(cuentas.filter((c) => email && listaCorreos_(c.emails).indexOf(email) !== -1).map((c) => String(c.cuenta_id)));
  apagar((f) => suyas.has(f.persona_id) || cuentasSuyas.has(String(f.cuenta_id)));
  if (fantasma) nueva({ persona_id: id });
  return { persona_id: id, fantasma };
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
  // la persona puede tener más de una ficha (dos cargos): se limpia el puesto de todas
  const email = normalizarEmail_(ficha.usuario_email);
  const suyas = new Set(leerSeguro_(db, 'SGC_PERSONAS').filter((p) => p.persona_id === personaId || (email && normalizarEmail_(p.usuario_email) === email)).map((p) => p.persona_id));
  leerSeguro_(db, 'OFICINA_PUESTOS').filter((p) => suyas.has(p.persona_id) && esVerdadero_(p.activa))
    .forEach((p) => actualizarFilaPorId_(db, 'OFICINA_PUESTOS', 'puesto_id', p.puesto_id, { activa: false }));
  if (salaId) {
    agregarFila_(db, 'OFICINA_PUESTOS', {
      puesto_id: crypto.randomUUID(), persona_id: personaId, sala_id: salaId,
      actualizado_por: contexto.email || '', fecha: ahora, activa: true
    });
  }
  return { persona_id: personaId, sala_id: salaId || salaSugerida_(ficha.cargo), sala_asignada: !!salaId };
}

/**
 * Una sola vez (al arrancar el servidor): pone el módulo «oficina» en TODAS las
 * cuentas, para que la Oficina virtual quede activa en todas. Después manda el
 * Admin: si se la quita a alguien, no se la vuelve a poner. La marca de «ya se
 * hizo» queda en LOG_SISTEMA. Corre desde server/index.js en cada arranque
 * (la marca hace que solo actúe la primera vez).
 */
const MARCA_MIGRACION = 'MIGRACION_MODULO_OFICINA';
function activarModuloEnCuentas_(db) {
  const log = leerSeguro_(db, 'LOG_SISTEMA');
  if (log.some((l) => l.contexto === MARCA_MIGRACION)) return { ya_hecha: true, cuentas: 0 };
  let cuentas = 0;
  for (const c of leerSeguro_(db, 'CUENTAS_PORTAL')) {
    let lista;
    try { lista = JSON.parse(c.modulos || '[]'); } catch (err) { lista = String(c.modulos || '').split(/[,;\s]+/).filter(Boolean); }
    if (!Array.isArray(lista) || lista.indexOf('oficina') !== -1) continue;
    actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', c.cuenta_id, { modulos: JSON.stringify(lista.concat('oficina')) });
    cuentas++;
  }
  agregarFila_(db, 'LOG_SISTEMA', {
    log_id: crypto.randomUUID(), timestamp: new Date().toISOString(), contexto: MARCA_MIGRACION,
    mensaje: 'Módulo Oficina virtual activado en ' + cuentas + ' cuentas', ref: 'OFICINA'
  });
  return { ya_hecha: false, cuentas };
}

// ===========================================================================
// Presencia en vivo (2026-11-26): quienes están moviendo su mono se ven entre
// todos. Vive SOLO en memoria del proceso (nada se escribe en la base): cada
// oficina abierta manda su posición cada ~0,7 s y recibe la de los demás. Quien
// deja de reportar 8 s desaparece. La clave es un hash de la cuenta (no su id).
// ===========================================================================
const PRESENCIA = new Map();   // clave -> { clave, persona_id, nombre, x, z, ry, mov, ts }
const BUZON = new Map();       // clave -> [{ de, nombre, ts }]   saludos por entregar
const YO_CACHE = new Map();    // cuenta -> { v: {persona_id, nombre}, ts }
const VIDA_MS = 8000, MAX_PRESENTES = 200;
const recortar = (n, a, b) => Math.max(a, Math.min(b, Number(n) || 0));
function claveDe_(contexto) {
  return crypto.createHash('sha1').update('oficina:' + String(contexto.cuenta_id || contexto.email || '')).digest('hex').slice(0, 12);
}
function yoCacheado_(db, contexto) { // quién es (su ficha o su fantasma), recordado 5 min
  const k = String(contexto.cuenta_id || contexto.email || '');
  const c = YO_CACHE.get(k);
  if (c && Date.now() - c.ts < 5 * 60 * 1000) return c.v;
  const r = getOficina(db, {}, contexto);
  const pid = (r.yo && r.yo.persona_id) || '';
  const ficha = pid && (r.personas || []).find((p) => p.persona_id === pid);
  const v = { persona_id: pid, nombre: (ficha && ficha.nombre) || (r.yo && r.yo.nombre) || '' };
  YO_CACHE.set(k, { v, ts: Date.now() });
  return v;
}
// Canal en vivo (2026-11-26, v2): cada oficina abierta mantiene una conexión
// (POST /v1/oficina/vivo, text/event-stream) y el servidor le EMPUJA cada
// posición apenas llega, en vez de que cada uno pregunte cada tantos segundos.
const SUSCRIPTORES = new Set();   // { clave, emitir }
const publico_ = (v, ahora) => ({ clave: v.clave, persona_id: v.persona_id, nombre: v.nombre, x: v.x, z: v.z, ry: v.ry, mov: v.mov, edad: ahora - v.ts });
function difundir_(ev, excepto) {
  for (const s of SUSCRIPTORES) if (s.clave !== excepto) { try { s.emitir(ev); } catch (err) { SUSCRIPTORES.delete(s); } }
}
function barrer_(ahora) { // quien no reporta en 8 s se va, y se avisa a todos
  for (const [k, v] of PRESENCIA) if (ahora - v.ts > VIDA_MS) { PRESENCIA.delete(k); difundir_({ tipo: 'sale', clave: k }); }
}
const barrendero = setInterval(() => barrer_(Date.now()), 2000);
if (barrendero.unref) barrendero.unref(); // no impide que el proceso (o las pruebas) terminen
function otrosDe_(clave, ahora) { return [...PRESENCIA.values()].filter((v) => v.clave !== clave).map((v) => publico_(v, ahora)); }
/** Abre el canal en vivo de una oficina: le manda quiénes están y luego cada cambio. Devuelve cómo cerrarlo. */
function suscribir(db, contexto, emitir, ahora = Date.now()) {
  const clave = claveDe_(contexto);
  const s = { clave, emitir };
  SUSCRIPTORES.add(s);
  barrer_(ahora);
  emitir({ tipo: 'estado', yo: clave, otros: otrosDe_(clave, ahora) });
  const pendientes = (BUZON.get(clave) || []).filter((x) => ahora - x.ts < 30000);
  BUZON.delete(clave);
  pendientes.forEach((x) => emitir({ tipo: 'saludo', de: x.de, nombre: x.nombre }));
  return () => SUSCRIPTORES.delete(s);
}

function presencia(db, data, contexto, ahora = Date.now()) {
  if (!contexto) return { _validationError: true, message: 'Ingresa a SIGSO para ver la oficina.' };
  data = data || {};
  const clave = claveDe_(contexto);
  const e = data.estado;
  if (e && Number.isFinite(Number(e.x)) && Number.isFinite(Number(e.z)) && (PRESENCIA.has(clave) || PRESENCIA.size < MAX_PRESENTES)) {
    const yo = yoCacheado_(db, contexto);
    const v = {
      clave, persona_id: yo.persona_id, nombre: String(yo.nombre || 'Visita').trim().split(/\s+/)[0],
      x: recortar(e.x, -12, 12), z: recortar(e.z, -25, 12), ry: recortar(e.ry, -100, 100), mov: !!e.mov, ts: ahora
    };
    PRESENCIA.set(clave, v);
    difundir_(Object.assign({ tipo: 'pos' }, publico_(v, ahora)), clave);
  } else if (data.fin) { if (PRESENCIA.delete(clave)) difundir_({ tipo: 'sale', clave }, clave); }
  const destino = String(data.saludar_a || '');
  if (destino && destino !== clave && PRESENCIA.has(destino)) {
    const yo = yoCacheado_(db, contexto);
    const saludo = { de: clave, nombre: String(yo.nombre || 'Alguien').trim().split(/\s+/)[0], ts: ahora };
    const conectados = [...SUSCRIPTORES].filter((s) => s.clave === destino);
    if (conectados.length) conectados.forEach((s) => { try { s.emitir({ tipo: 'saludo', de: saludo.de, nombre: saludo.nombre }); } catch (err) { SUSCRIPTORES.delete(s); } });
    else BUZON.set(destino, (BUZON.get(destino) || []).concat(saludo).slice(-5));
  }
  barrer_(ahora);
  if (data.ligero) return { yo: clave }; // con el canal en vivo abierto, no hace falta devolver la lista
  const otros = otrosDe_(clave, ahora);
  const saludos = (BUZON.get(clave) || []).filter((s) => ahora - s.ts < 30000).map((s) => ({ de: s.de, nombre: s.nombre }));
  BUZON.delete(clave);
  return { yo: clave, otros, saludos };
}
function reiniciarPresencia_() { PRESENCIA.clear(); BUZON.clear(); YO_CACHE.clear(); SUSCRIPTORES.clear(); } // pruebas

module.exports = { getOficina, asignarPuesto, marcarFantasma, presencia, suscribir, reiniciarPresencia_, activarModuloEnCuentas_, salaSugerida_, SALAS_OFICINA };
