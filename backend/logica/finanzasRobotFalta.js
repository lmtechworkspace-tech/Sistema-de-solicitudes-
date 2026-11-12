'use strict';

/**
 * finanzasRobotFalta.js — «Traer lo que falta» (12-11-2026).
 *
 * Para los robots de Finanzas (cartolas del BCI y ventas del SII): desde qué mes falta traer, mirando lo que ya se importó.
 *  - BCI: la cartola importada más reciente (FIN_IMPORTACIONES.hasta) de las cuentas del BCI —de la empresa pedida si se
 *    reconoce su RUT—. Falta desde el mes de esa fecha (si no cae en el último día del mes: los días que quedan vienen en la
 *    cartola siguiente) o desde el mes siguiente.
 *  - SII: el último mes con ventas del Registro de Ventas importadas (FIN_FACTURAS origen «rcv») de la empresa del RUT pedido.
 *    Falta desde el mes siguiente.
 * Hasta: el mes pasado (el mes en curso aún no cierra). Como mucho 12 meses por pedido: si falta más, se proponen los 12
 * más antiguos y se dice que después hay que pedir el resto. Solo lee; quien puede ver Finanzas puede preguntar.
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const I = require('./finanzasBancos').interno;
const Bci = require('./robotBci');

const MAX = Bci.MAX_MESES;
function mesMas_(p, n) { let [a, m] = p.split('-').map(Number); m += n - 1; a += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return a + '-' + String(m + 1).padStart(2, '0'); }
function ultimoDia_(f) { const [a, m] = f.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate() === Number(f.slice(8, 10)); }
function rutNorm_(r) { const s = String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); return s.length >= 2 ? s.slice(0, -1).replace(/^0+/, '') + '-' + s.slice(-1) : ''; }
/** La empresa de un RUT, si ya se importaron ventas emitidas con él (FIN_EMISORES). */
function empresaDeRut_(d, rut) {
  if (!rutNorm_(rut)) return '';
  try { const r = d.prepare('SELECT empresa FROM FIN_EMISORES WHERE huella_rut = ?').get(I.hmac_('emisor|' + rutNorm_(rut))); return r ? r.empresa : ''; } catch (e) { return ''; }
}
function todas_(d, sql, ...a) { try { return d.prepare(sql).all(...a); } catch (e) { return []; } }

/** Arma la respuesta a partir del primer mes que falta. */
function rango_(desde, ultimo, extra) {
  const hasta = mesMas_(Base.hoy_().slice(0, 7), -1);
  if (!desde) return Object.assign({ al_dia: false, sin_historial: true, desde: '', hasta, ultimo: '' }, extra);
  if (desde > hasta) return Object.assign({ al_dia: true, desde: '', hasta, ultimo }, extra);
  const meses = Bci.meses_(desde, hasta).length;
  const tope = meses > MAX ? mesMas_(desde, MAX - 1) : hasta;
  return Object.assign({ al_dia: false, desde, hasta: tope, ultimo, faltan_meses: meses, recortado: meses > MAX }, extra);
}

/** data: { tipo: 'BCI' | 'SII', rut? } (rut: el de la empresa que se pide). */
const falta = B.conBoveda('', function (db, data) {
  const d = I.db_ ? I.db_() : B.dbFin();
  const tipo = data && data.tipo === 'SII' ? 'SII' : 'BCI';
  const empresa = empresaDeRut_(d, data && data.rut);
  if (tipo === 'SII') {
    if (!empresa) return rango_('', '', { empresa: '', motivo: 'Todavía no hay ventas del SII importadas de esa empresa: elige el rango a mano (después SIGSO lo sabrá solo).' });
    const r = todas_(d, "SELECT MAX(periodo) AS p FROM FIN_FACTURAS WHERE origen = 'rcv' AND empresa = ?", empresa)[0];
    const p = r && r.p;
    return rango_(p ? mesMas_(p, 1) : '', p || '', { empresa, motivo: p ? '' : 'Todavía no hay ventas del SII importadas de ' + empresa + ': elige el rango a mano.' });
  }
  // BCI: las cuentas del BCI (de la empresa del RUT, si se reconoce y tiene cuentas).
  let cuentas = todas_(d, "SELECT id, empresa, ultimos4 FROM FIN_CUENTAS WHERE UPPER(banco) LIKE 'BCI%'");
  if (empresa && cuentas.some((c) => c.empresa === empresa)) cuentas = cuentas.filter((c) => c.empresa === empresa);
  const ultimas = cuentas.map((c) => {
    const r = todas_(d, 'SELECT MAX(hasta) AS h FROM FIN_IMPORTACIONES WHERE cuenta_ref = ?', c.id)[0];
    return { empresa: c.empresa, ultimos4: c.ultimos4, hasta: (r && r.h) || '' };
  }).filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.hasta));
  if (!ultimas.length) return rango_('', '', { cuentas: [], motivo: 'Todavía no hay cartolas del BCI importadas: elige el rango a mano (después SIGSO lo sabrá solo).' });
  // La cuenta más atrasada manda (así ninguna queda con huecos).
  const h = ultimas.map((c) => c.hasta).sort()[0];
  return rango_(ultimoDia_(h) ? mesMas_(h.slice(0, 7), 1) : h.slice(0, 7), h, { cuentas: ultimas });
});

module.exports = { falta, mesMas_, ultimoDia_ };
