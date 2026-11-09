'use strict';

/**
 * finanzasRobotSii.js — «Traer del SII» en Finanzas › Subir archivos (09-11-2026).
 *
 * Le pide al robot del PC de la oficina (controlInternoRobot.js + robotSii.js) el detalle del Registro de Ventas de un
 * mes («Descargar Detalles» del RCV, pestaña VENTA). Lo que vuelve es el mismo CSV que hoy se descarga a mano, y la
 * pantalla lo pasa por el cuadro «Subir un archivo» de siempre: se revisa y se importa con su botón. Nada entra solo.
 *
 * Quién: quien está en la bóveda y puede REGISTRAR (igual que importar las ventas). Queda en la bitácora de Finanzas quién
 * pidió qué mes y cómo terminó; nunca la Clave Tributaria (viaja con el pedido y se borra apenas el PC la toma).
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const RB = require('./controlInternoRobot');
const { errorValidacion } = require('./errores');

const TIPO = 'SII_VENTAS';
const email_ = (contexto) => String((contexto && contexto.email) || '').toLowerCase();

/** ¿Está el robot de la oficina conectado y sabe traer las ventas del SII? */
const general = B.conBoveda('', function (db) {
  return RB.generalBanco_(db, TIPO);
});

/** Pide el detalle de ventas de un mes. data: { periodo: 'AAAA-MM', rut?, clave? } (rut: el de la EMPRESA; sin clave: alguien entra a mano). */
const iniciar = B.conBoveda('', function (db, data, contexto, x) {
  const d = data || {};
  const e_ = Base.exigir_(contexto, 'REGISTRAR');
  if (e_) { d.clave = ''; return e_; }
  const pedido = { tipo: TIPO, email: email_(contexto), periodo: String(d.periodo || ''), rut: d.rut, clave: typeof d.clave === 'string' ? d.clave : '' };
  d.clave = '';
  const asistido = !pedido.clave;
  pedido.alTerminar = (r) => x.registrar('ROBOT_SII', pedido.periodo + ' · ' + r.estado + (r.estado === 'OK' ? ' · ' + r.archivos.map((a) => a.nombre).join(', ') : ' · ' + r.mensaje.slice(0, 120)));
  const r = RB.iniciarBanco_(db, pedido);
  if (!r.ok) return Object.assign(errorValidacion('robot', r.message), { codigo: r.ocupado ? 'OCUPADO' : r.sin_agente ? 'SIN_AGENTE' : undefined });
  x.registrar('ROBOT_SII', 'Pidió las ventas de ' + pedido.periodo + (asistido ? ' (entrada a mano en el PC de la oficina)' : ''));
  return { trabajo_id: r.trabajo_id };
});

/** Avance del pedido; al terminar trae el CSV (solo a quien lo pidió). */
const estado = B.conBoveda('', function (db, data, contexto) {
  const r = RB.estadoBanco_(data && data.trabajo_id, email_(contexto), TIPO);
  if (r._forbidden) return r;
  if (!r.ok) return errorValidacion('trabajo_id', r.message);
  delete r.ok;
  return r;
});

/** El último pedido de esta persona (o { trabajo: null }): para retomarlo al volver a la pantalla. */
const ultimo = B.conBoveda('', function (db, data, contexto) {
  const r = RB.ultimoBanco_(email_(contexto), TIPO);
  if (!r || !r.ok) return { trabajo: null };
  delete r.ok;
  return { trabajo: r };
});

module.exports = { general, iniciar, estado, ultimo };
