'use strict';

/**
 * controlInternoRobot.js — revisiones del robot TGR semiautomático
 * (2026-10-02, opción 2 del dueño). Ver robotTgr.js.
 *
 * La persona elige el cliente, escribe su RUT y su Clave Tributaria y toca
 * "Revisar en la TGR". El robot corre en segundo plano (1 a 2 minutos) y la
 * pantalla pregunta por su avance. Al terminar devuelve las cuotas como texto
 * de la TGR, que pasa por el mismo "Recibir desde la TGR" (revisar, asignar,
 * aplicar): nada se escribe en el seguimiento sin que la persona lo apruebe.
 *
 * La clave: llega en la petición, se usa una vez y se suelta. No se guarda en
 * la base, en el trabajo ni en el historial (que registra quién revisó a qué
 * cliente y cómo terminó). Los trabajos viven en memoria 30 minutos.
 *
 * Un robot a la vez para todo SIGSO (un navegador en un servidor de 4 GB).
 */

const crypto = require('node:crypto');
const CI = require('./controlInterno');
const Robot = require('./robotTgr');

const VIDA_MS = 30 * 60 * 1000;
const trabajos_ = new Map();
let enCurso_ = null;
let revisor_ = Robot.revisarCliente;
let disponible_ = Robot.disponible;

function email_(ctx) { return String((ctx && ctx.email) || '').toLowerCase(); }
function permiso_(db, ctx, que) { return CI.matrizConPermiso_(db, ctx, 'CONVENIOS', que); }

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
  if (!disponible_()) return { ok: false, message: 'El servidor no tiene el navegador del robot instalado.' };

  const t = { trabajo_id: crypto.randomUUID(), email: email_(contexto), cliente, rut, estado: 'EN_CURSO', paso: 'Preparando', inicio: new Date().toISOString(), fin: '', resultado: null };
  trabajos_.set(t.trabajo_id, t);
  enCurso_ = t.trabajo_id;
  let clave = d.clave;
  d.clave = '';
  t.promesa = Promise.resolve()
    .then(() => revisor_({ rut, clave }, { alPaso: (p) => { t.paso = String(p || '').slice(0, 120); } }))
    .then((r) => {
      const ok = r && r.estado === 'OK';
      t.resultado = {
        estado: (r && r.estado) || 'ERROR', mensaje: (r && r.mensaje) || '',
        convenios: ((r && r.convenios) || []).map((c) => ({ resolucion: c.resolucion || '', cuotas: c.cuotas.length, pagadas: c.cuotas.filter((q) => q.tgr === 'SI').length })),
        texto: ok ? Robot.comoTexto(r.convenios) : '',
        diagnostico: (r && r.diagnostico) || null
      };
      t.estado = ok ? 'LISTO' : 'DETENIDO';
    })
    .catch((e) => {
      t.resultado = { estado: 'ERROR', mensaje: 'El robot falló: ' + String((e && e.message) || e).slice(0, 200), convenios: [], texto: '', diagnostico: null };
      t.estado = 'DETENIDO';
    })
    .finally(() => {
      clave = '';
      t.fin = new Date().toISOString();
      if (enCurso_ === t.trabajo_id) enCurso_ = null;
      // Constancia de uso: quién revisó a qué cliente y cómo terminó (nunca la clave).
      try {
        CI.historial_(db, 'ROBOT_TGR', 'REVISION', (t.cliente ? t.cliente.nombre + ' · ' : '') + 'RUT ' + t.rut + ' · ' + t.resultado.estado +
          (t.resultado.estado === 'OK' ? ' · ' + t.resultado.convenios.length + ' convenios' : ' · ' + t.resultado.mensaje), contexto);
      } catch (e) { /* sin historial no se pierde la revisión */ }
      const v = setTimeout(() => trabajos_.delete(t.trabajo_id), VIDA_MS);
      if (v.unref) v.unref();
    });
  return { ok: true, trabajo_id: t.trabajo_id };
}

/** Avance de una revisión (solo quien la inició, o un ADM). */
function estado(db, data, contexto) {
  const x = permiso_(db, contexto, 've');
  if (x.error) return x.error;
  const t = trabajos_.get(String((data && data.trabajo_id) || ''));
  if (!t) return { ok: false, message: 'Esa revisión ya no está disponible (se guarda 30 minutos). Vuelve a revisar.' };
  if (t.email !== email_(contexto) && !(contexto && contexto.rol === 'ADM')) return { _forbidden: true, message: 'Esta revisión la inició otra persona.' };
  return { ok: true, trabajo_id: t.trabajo_id, estado: t.estado, paso: t.paso, cliente: t.cliente, rut: t.rut, inicio: t.inicio, fin: t.fin, resultado: t.resultado };
}

// Solo para tests.
function _usar(revisor, disponible) { revisor_ = revisor || Robot.revisarCliente; disponible_ = disponible || Robot.disponible; }
function _esperar(id) { const t = trabajos_.get(id); return t ? t.promesa : Promise.resolve(); }

module.exports = { revisar, estado, _usar, _esperar };
