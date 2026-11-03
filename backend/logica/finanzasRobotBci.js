'use strict';

/**
 * finanzasRobotBci.js — «Traer del BCI» en Finanzas › Subir archivos (03-11-2026).
 *
 * Le pide al robot del PC de la oficina (controlInternoRobot.js + robotBci.js) las cartolas de un mes del BCI Pyme.
 * Lo que vuelve son los mismos Excel que hoy se descargan a mano, y la pantalla los pasa por el cuadro «Subir un
 * archivo» de siempre: se revisa cada cartola y se importa con su botón. Nada entra solo.
 *
 * Quién: quien está en la bóveda y puede REGISTRAR (igual que importar una cartola). Queda en la bitácora de Finanzas
 * quién pidió qué mes y cómo terminó; nunca la clave del banco (si la escribieron, se trata como la Clave Tributaria
 * del robot TGR: viaja con el pedido y se borra apenas el PC la toma).
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const RB = require('./controlInternoRobot');
const { errorValidacion } = require('./errores');

const email_ = (contexto) => String((contexto && contexto.email) || '').toLowerCase();

/** ¿Está el robot de la oficina conectado y sabe traer cartolas? */
const general = B.conBoveda('', function (db) {
  return RB.generalBanco_(db);
});

/** Pide las cartolas de un mes. data: { periodo: 'AAAA-MM', rut?, clave? } (sin clave: alguien entra a mano en el PC). */
const iniciar = B.conBoveda('', function (db, data, contexto, x) {
  const d = data || {};
  const e_ = Base.exigir_(contexto, 'REGISTRAR');
  if (e_) { d.clave = ''; return e_; }
  const pedido = { email: email_(contexto), periodo: String(d.periodo || ''), rut: d.rut, clave: typeof d.clave === 'string' ? d.clave : '' };
  d.clave = '';
  const asistido = !pedido.clave;
  pedido.alTerminar = (r) => x.registrar('ROBOT_BCI', pedido.periodo + ' · ' + r.estado + (r.estado === 'OK' ? ' · ' + r.archivos.map((a) => 'N° ' + a.numero).join(', ') : ' · ' + r.mensaje.slice(0, 120)));
  const r = RB.iniciarBanco_(db, pedido);
  if (!r.ok) return Object.assign(errorValidacion('robot', r.message), { codigo: r.ocupado ? 'OCUPADO' : r.sin_agente ? 'SIN_AGENTE' : undefined });
  x.registrar('ROBOT_BCI', 'Pidió las cartolas de ' + pedido.periodo + (asistido ? ' (entrada a mano en el PC de la oficina)' : ''));
  return { trabajo_id: r.trabajo_id };
});

/** Avance del pedido; al terminar trae los Excel (solo a quien lo pidió). */
const estado = B.conBoveda('', function (db, data, contexto) {
  const r = RB.estadoBanco_(data && data.trabajo_id, email_(contexto));
  if (r._forbidden) return r;
  if (!r.ok) return errorValidacion('trabajo_id', r.message);
  delete r.ok;
  return r;
});

module.exports = { general, iniciar, estado };
