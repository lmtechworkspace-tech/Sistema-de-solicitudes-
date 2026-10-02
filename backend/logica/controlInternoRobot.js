'use strict';

/**
 * controlInternoRobot.js — revisiones del robot TGR semiautomático
 * (2026-10-02, opción 2 del dueño). Ver robotTgr.js.
 *
 * La persona elige el cliente, escribe su RUT y su Clave Tributaria y toca
 * "Revisar en la TGR". La pantalla pregunta por el avance y, al terminar, las
 * cuotas pasan por "Recibir desde la TGR" (revisar, asignar, aplicar): nada
 * se escribe en el seguimiento sin que la persona lo apruebe.
 *
 * DÓNDE CORRE. La TGR rechaza las conexiones del servidor (403 "Access
 * Denied", 2-10-2026), así que el robot corre en un PC de la oficina: un
 * "agente" (backend/herramientas/robot-oficina/agente.js) que le pide trabajo
 * a SIGSO con una consulta que espera hasta 20 s (no se abre ningún puerto en
 * el PC). El agente se identifica con su propia llave; aquí se guarda solo su
 * hash. Sin agente conectado, la revisión no se inicia y se dice por qué.
 * (Para pruebas, revisor inyectado o SIGSO_ROBOT_EN_SERVIDOR=1 corre aquí.)
 *
 * LA CLAVE. Llega en la petición, espera en memoria los segundos que tarda
 * el agente en tomarla y se borra en cuanto la toma (o si nadie la toma). No
 * va a la base, al historial ni a logs. El agente la usa una vez y la suelta.
 *
 * Un robot a la vez para todo SIGSO. Los trabajos viven en memoria 30 min.
 */

const crypto = require('node:crypto');
const CI = require('./controlInterno');
const Robot = require('./robotTgr');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

const VIDA_MS = 30 * 60 * 1000;
const ESPERA_AGENTE_MS = 20 * 1000;      // la consulta del agente queda abierta hasta esto
const CONECTADO_MS = 45 * 1000;          // sin señal en este tiempo = desconectado
const TOMA_MAX_MS = 25 * 1000;           // si nadie toma la revisión, se cancela
const TRABAJO_MAX_MS = 5 * 60 * 1000;    // si el agente no entrega, se da por perdida

const trabajos_ = new Map();
let enCurso_ = null;
let revisor_ = null;                      // inyectado en tests
const pendientes_ = [];                   // trabajos esperando agente
const esperando_ = [];                    // consultas de agentes abiertas
const senales_ = new Map();               // agente_id -> último contacto (ms)

function email_(ctx) { return String((ctx && ctx.email) || '').toLowerCase(); }
function permiso_(db, ctx, que) { return CI.matrizConPermiso_(db, ctx, 'CONVENIOS', que); }
function hash_(t) { return crypto.createHash('sha256').update(String(t || ''), 'utf8').digest('hex'); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function agentes_(db) {
  try { return leerFilas_(db, 'CI_ROBOT_AGENTES', COLUMNAS.CI_ROBOT_AGENTES).filter((a) => esVerdadero_(a.activo)); } catch (e) { return []; }
}
function conectados_(db) {
  const ahora = Date.now();
  return agentes_(db).filter((a) => (senales_.get(a.agente_id) || 0) > ahora - CONECTADO_MS);
}
function enServidor_() { return !!revisor_ || process.env.SIGSO_ROBOT_EN_SERVIDOR === '1'; }

// --- ciclo de un trabajo ------------------------------------------------------------------
function terminar_(db, t, r, contexto) {
  if (t.estado === 'LISTO' || t.estado === 'DETENIDO') return;
  t.clave = '';
  const ok = r && r.estado === 'OK';
  const convenios = ((r && r.convenios) || []).filter((c) => c && Array.isArray(c.cuotas));
  t.resultado = {
    estado: (r && r.estado) || 'ERROR', mensaje: String((r && r.mensaje) || '').slice(0, 400),
    convenios: convenios.map((c) => ({ resolucion: String(c.resolucion || '').slice(0, 20), cuotas: c.cuotas.length, pagadas: c.cuotas.filter((q) => q.tgr === 'SI').length })),
    texto: ok ? Robot.comoTexto(convenios.map((c) => ({ resolucion: String(c.resolucion || '').replace(/\D/g, ''), cuotas: c.cuotas.filter(cuotaValida_) }))) : '',
    diagnostico: diagnosticoSeguro_(r && r.diagnostico)
  };
  t.estado = ok ? 'LISTO' : 'DETENIDO';
  t.fin = new Date().toISOString();
  if (enCurso_ === t.trabajo_id) enCurso_ = null;
  // Constancia de uso: quién revisó a qué cliente, desde dónde y cómo terminó (nunca la clave).
  try {
    CI.historial_(db, 'ROBOT_TGR', 'REVISION', (t.cliente ? t.cliente.nombre + ' · ' : '') + 'RUT ' + t.rut + (t.agente ? ' · ' + t.agente : '') + ' · ' + t.resultado.estado +
      (t.resultado.estado === 'OK' ? ' · ' + t.resultado.convenios.length + ' convenios' : ' · ' + t.resultado.mensaje), contexto || { email: t.email });
  } catch (e) { /* sin historial no se pierde la revisión */ }
  const v = setTimeout(() => trabajos_.delete(t.trabajo_id), VIDA_MS);
  if (v.unref) v.unref();
}
// Lo que entrega el agente se valida: cuotas con forma conocida, diagnóstico acotado.
function cuotaValida_(q) {
  return q && Number.isInteger(q.n) && q.n > 0 && q.n < 100 && /^\d{4}-\d{2}-\d{2}$/.test(String(q.vencimiento || '')) && isFinite(Number(q.monto)) && (q.tgr === 'SI' || q.tgr === 'NO');
}
function diagnosticoSeguro_(d) {
  if (!d || typeof d !== 'object') return null;
  const captura = typeof d.captura === 'string' && /^[A-Za-z0-9+/=]+$/.test(d.captura) && d.captura.length < 3000000 ? d.captura : '';
  return { url: String(d.url || '').slice(0, 300), captura };
}

/** Inicia una revisión. data: { cliente_id?, rut, clave }. */
function revisar(db, data, contexto) {
  const x = permiso_(db, contexto, 'registra');
  if (x.error) return x.error;
  const d = data || {};
  const rut = Robot.rutFormulario_(d.rut);
  if (!rut) return { ok: false, message: 'Escribe el RUT con que el cliente entra al SII (ej.: 76123456-7).' };
  if (typeof d.clave !== 'string' || !d.clave || d.clave.length > 64) return { ok: false, message: 'Escribe la Clave Tributaria del cliente.' };
  let cliente = null;
  if (d.cliente_id) {
    const c = CI.clientes_(db).find((k) => k.cliente_id === String(d.cliente_id));
    if (!c) return { ok: false, message: 'El cliente no está en el catálogo.' };
    cliente = { cliente_id: c.cliente_id, nombre: c.nombre, rut: c.rut };
  }
  if (enCurso_) return { ok: false, ocupado: true, message: 'El robot está revisando otro cliente. Espera que termine (1 a 2 minutos) y vuelve a intentar.' };
  const local = enServidor_();
  if (!local && !conectados_(db).length) {
    d.clave = '';
    return { ok: false, sin_agente: true, message: 'El robot de la oficina no está conectado: enciende el programa en el PC de la oficina, o usa el marcador "Enviar a SIGSO".' };
  }

  const t = { trabajo_id: crypto.randomUUID(), email: email_(contexto), cliente, rut, estado: 'EN_CURSO', paso: local ? 'Preparando' : 'Esperando al robot de la oficina', inicio: new Date().toISOString(), fin: '', resultado: null, agente: '', clave: d.clave };
  d.clave = '';
  trabajos_.set(t.trabajo_id, t);
  enCurso_ = t.trabajo_id;

  if (local) {
    const revisor = revisor_ || Robot.revisarCliente;
    const clave = t.clave;
    t.clave = '';
    t.promesa = Promise.resolve()
      .then(() => revisor({ rut, clave }, { alPaso: (p) => { t.paso = String(p || '').slice(0, 120); } }))
      .then((r) => terminar_(db, t, r, contexto))
      .catch((e) => terminar_(db, t, { estado: 'ERROR', mensaje: 'El robot falló: ' + String((e && e.message) || e).slice(0, 200) }, contexto));
    return { ok: true, trabajo_id: t.trabajo_id };
  }

  // Al agente: si hay una consulta abierta se le entrega ya; si no, queda en cola.
  t.pendiente = true;
  pendientes_.push(t.trabajo_id);
  despachar_(db);
  t.promesa = new Promise((fin) => { t._fin = fin; });
  const v1 = setTimeout(() => { if (t.pendiente) { quitar_(t.trabajo_id); terminar_(db, t, { estado: 'SIN_AGENTE', mensaje: 'El robot de la oficina no tomó la revisión: puede estar apagado o sin internet.' }, contexto); t._fin(); } }, TOMA_MAX_MS);
  const v2 = setTimeout(() => { if (t.estado === 'EN_CURSO') { terminar_(db, t, { estado: 'SIN_RESPUESTA', mensaje: 'El robot de la oficina no terminó la revisión a tiempo.' }, contexto); t._fin(); } }, TRABAJO_MAX_MS);
  [v1, v2].forEach((v) => { if (v.unref) v.unref(); });
  return { ok: true, trabajo_id: t.trabajo_id };
}
function quitar_(id) { const i = pendientes_.indexOf(id); if (i !== -1) pendientes_.splice(i, 1); }
function paraAgente_(t) { return { trabajo_id: t.trabajo_id, rut: t.rut, clave: t.clave }; }
function despachar_(db) {
  while (pendientes_.length && esperando_.length) {
    const t = trabajos_.get(pendientes_.shift());
    if (!t || !t.pendiente) continue; // cancelada: la consulta del agente sigue esperando
    const w = esperando_.shift();
    tomar_(t, w.agente);
    w.responder({ trabajo: paraAgente_(t) });
    t.clave = '';
  }
}
function tomar_(t, agente) {
  t.pendiente = false;
  t.agente = agente.nombre;
  t.agente_id = agente.agente_id;
  t.paso = 'El robot de la oficina tomó la revisión';
}

/** Avance de una revisión (solo quien la inició, o un ADM). */
function estado(db, data, contexto) {
  const x = permiso_(db, contexto, 've');
  if (x.error) return x.error;
  const t = trabajos_.get(String((data && data.trabajo_id) || ''));
  if (!t) return { ok: false, message: 'Esa revisión ya no está disponible (se guarda 30 minutos). Vuelve a revisar.' };
  if (t.email !== email_(contexto) && !(contexto && contexto.rol === 'ADM')) return { _forbidden: true, message: 'Esta revisión la inició otra persona.' };
  return { ok: true, trabajo_id: t.trabajo_id, estado: t.estado, paso: t.paso, cliente: t.cliente, rut: t.rut, agente: t.agente, inicio: t.inicio, fin: t.fin, resultado: t.resultado };
}

/** Para la tarjeta: ¿hay robot de la oficina conectado? */
function general(db, data, contexto) {
  const x = permiso_(db, contexto, 've');
  if (x.error) return x.error;
  const con = conectados_(db);
  return { ok: true, en_servidor: enServidor_(), conectado: con.length > 0, agentes_conectados: con.map((a) => a.nombre), ocupado: !!enCurso_ };
}

// --- agentes (equipos de la oficina) -------------------------------------------------------
function soloAdm_(ctx) { return ctx && ctx.rol === 'ADM' ? null : { _forbidden: true, message: 'Solo un administrador configura el robot de la oficina.' }; }
function publicoAgente_(db, a) {
  const s = senales_.get(a.agente_id) || 0;
  return { agente_id: a.agente_id, nombre: a.nombre, fecha_creacion: a.fecha_creacion, ultimo_contacto: s ? new Date(s).toISOString() : (a.ultimo_contacto || ''), conectado: s > Date.now() - CONECTADO_MS };
}
function listarAgentes(db, data, contexto) {
  const no = soloAdm_(contexto);
  if (no) return no;
  return { ok: true, agentes: agentes_(db).map((a) => publicoAgente_(db, a)) };
}
/** Crea un agente y devuelve su llave UNA vez (se guarda solo su hash). */
function crearAgente(db, data, contexto) {
  const no = soloAdm_(contexto);
  if (no) return no;
  const nombre = String((data && data.nombre) || '').trim().slice(0, 60) || 'PC de la oficina';
  const llave = 'sgr_' + crypto.randomBytes(32).toString('base64url');
  const a = { agente_id: crypto.randomUUID(), nombre, token_hash: hash_(llave), creado_por: email_(contexto), fecha_creacion: new Date().toISOString(), ultimo_contacto: '', activo: true };
  agregarFila_(db, 'CI_ROBOT_AGENTES', a);
  CI.historial_(db, 'ROBOT_TGR', 'AGENTE', 'Equipo autorizado: ' + nombre, contexto);
  return { ok: true, agente: publicoAgente_(db, a), llave };
}
function revocarAgente(db, data, contexto) {
  const no = soloAdm_(contexto);
  if (no) return no;
  const a = agentes_(db).find((k) => k.agente_id === String((data && data.agente_id) || ''));
  if (!a) return { ok: false, message: 'No se encontró ese equipo.' };
  actualizarFilaPorId_(db, 'CI_ROBOT_AGENTES', 'agente_id', a.agente_id, { activo: false });
  senales_.delete(a.agente_id);
  CI.historial_(db, 'ROBOT_TGR', 'AGENTE', 'Equipo dado de baja: ' + a.nombre, contexto);
  return { ok: true, message: 'Listo: ese equipo ya no puede tomar revisiones.' };
}
function agentePorLlave_(db, llave) {
  if (typeof llave !== 'string' || !/^sgr_[A-Za-z0-9_-]{40,}$/.test(llave)) return null;
  const h = hash_(llave);
  return agentes_(db).find((a) => a.token_hash.length === h.length && crypto.timingSafeEqual(Buffer.from(a.token_hash), Buffer.from(h))) || null;
}
function senal_(db, a) {
  const antes = senales_.get(a.agente_id) || 0;
  senales_.set(a.agente_id, Date.now());
  // A la base, como mucho una vez por minuto.
  if (Date.now() - antes > 60 * 1000) { try { actualizarFilaPorId_(db, 'CI_ROBOT_AGENTES', 'agente_id', a.agente_id, { ultimo_contacto: new Date().toISOString() }); } catch (e) { /* */ } }
}

// Acciones del agente (públicas: sin sesión de persona, con la llave del equipo).
const SIN_LLAVE = { _forbidden: true, message: 'Llave del robot no válida (o el equipo fue dado de baja).' };

/** El agente pide trabajo: responde de inmediato si hay, o espera hasta 20 s. */
function agenteTomar(db, data) {
  const a = agentePorLlave_(db, data && data.agente_token);
  if (!a) return SIN_LLAVE;
  senal_(db, a);
  const id = pendientes_.shift();
  const t = id ? trabajos_.get(id) : null;
  if (t && t.pendiente) {
    tomar_(t, a);
    const r = { trabajo: paraAgente_(t) };
    t.clave = '';
    return r;
  }
  return new Promise((responder) => {
    const w = { agente: a, responder };
    esperando_.push(w);
    const v = setTimeout(() => { const i = esperando_.indexOf(w); if (i !== -1) { esperando_.splice(i, 1); senal_(db, a); responder({ trabajo: null }); } }, ESPERA_AGENTE_MS);
    if (v.unref) v.unref();
  });
}
function trabajoDelAgente_(db, data) {
  const a = agentePorLlave_(db, data && data.agente_token);
  if (!a) return { error: SIN_LLAVE };
  senal_(db, a);
  const t = trabajos_.get(String((data && data.trabajo_id) || ''));
  if (!t || t.agente_id !== a.agente_id || t.estado !== 'EN_CURSO') return { error: { ok: false, message: 'Ese trabajo no es de este equipo o ya terminó.' } };
  return { a, t };
}
function agentePaso(db, data) {
  const r = trabajoDelAgente_(db, data);
  if (r.error) return r.error;
  r.t.paso = String((data && data.paso) || '').slice(0, 120);
  return { ok: true };
}
function agenteEntregar(db, data) {
  const r = trabajoDelAgente_(db, data);
  if (r.error) return r.error;
  terminar_(db, r.t, data && data.resultado, { email: r.t.email });
  if (r.t._fin) r.t._fin();
  return { ok: true };
}

// Solo para tests.
function _usar(revisor) { revisor_ = revisor || null; }
function _esperar(id) { const t = trabajos_.get(id); return t ? t.promesa : Promise.resolve(); }
function _reiniciar() { trabajos_.clear(); enCurso_ = null; pendientes_.length = 0; esperando_.length = 0; senales_.clear(); revisor_ = null; }

module.exports = { revisar, estado, general, listarAgentes, crearAgente, revocarAgente, agenteTomar, agentePaso, agenteEntregar, _usar, _esperar, _reiniciar };
