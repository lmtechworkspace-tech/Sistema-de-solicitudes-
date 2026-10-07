'use strict';

/**
 * finanzasMes.js — Finanzas, Etapa B (2026-10-07): «El mes, paso a paso».
 *
 * Una sola pantalla que dice qué falta para dejar listo un mes, en orden y con
 * fecha: subir las cartolas, agregar el detalle del banco, (mientras se
 * acostumbran) el Excel BANCOS, revisar los movimientos, las ventas del SII y
 * cerrar el mes. Todo se calcula desde lo que ya está guardado: no hay que
 * marcar nada a mano.
 *
 * Fechas de trabajo (acordadas con la operación):
 *   - Cartolas y detalle del mes anterior: hasta el día 3.
 *   - Revisión y cierre del mes anterior: hasta el día 5 (antes de Previred).
 *   - Previred: día 10 (13 si el pago es electrónico).  IVA (F29): día 20.
 */

const B = require('./finanzasBoveda');
const FB = require('./finanzasBancos');
const FC = require('./finanzasCierre');

const I = FB.interno;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function nombreMes_(p) { const [a, m] = p.split('-').map(Number); return MESES[m - 1] + ' ' + a; }
function mesSiguiente_(p) { const [a, m] = p.split('-').map(Number); return m === 12 ? (a + 1) + '-01' : a + '-' + String(m + 1).padStart(2, '0'); }
function mesAnterior_(p) { const [a, m] = p.split('-').map(Number); return m === 1 ? (a - 1) + '-12' : a + '-' + String(m - 1).padStart(2, '0'); }
function dia_(p, d) { return p + '-' + String(d).padStart(2, '0'); }
function diasEntre_(desde, hasta) { return Math.round((Date.parse(hasta + 'T12:00:00Z') - Date.parse(desde + 'T12:00:00Z')) / 864e5); }

/** El mes con que conviene trabajar: el último abierto con movimientos hasta el mes pasado; si no hay, el mes pasado. */
function mesDeTrabajo_(hoy) {
  const d = I.db_();
  const abiertos = d.prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS ORDER BY periodo').all().map((r) => r.periodo).filter((p) => !FC.mesCerrado_(p));
  const pasado = mesAnterior_(hoy.slice(0, 7));
  const candidatos = abiertos.filter((p) => p <= pasado);
  return candidatos[candidatos.length - 1] || pasado;
}

/** Cuántos movimientos del mes tienen detalle, Excel, propuesta, etc. */
function conteos_(periodo) {
  const c = { total: 0, confirmados: 0, con_detalle: 0, con_excel: 0, seguras: 0, con_propuesta: 0, sin_pista: 0 };
  I.db_().prepare('SELECT estado, datos FROM FIN_MOVIMIENTOS WHERE periodo = ?').all(periodo).forEach((r) => {
    const d = I.des_(r.datos);
    c.total++;
    if (d.detalle) c.con_detalle++;
    if (d.planilla) c.con_excel++;
    if (r.estado === 'CONFIRMADO') { c.confirmados++; return; }
    const s = d.sugerencia || {};
    const completa = FB.completa_(s, d.abono > 0 ? 'abono' : 'cargo');
    if (s.certeza === 'alta' && completa) c.seguras++;
    else if (completa) c.con_propuesta++;
    else c.sin_pista++;
  });
  return c;
}

function plazo_(fecha, hoy, hecho) {
  if (hecho) return { fecha, estado: 'ok', texto: '' };
  const n = diasEntre_(hoy, fecha);
  if (n < 0) return { fecha, estado: 'atrasado', texto: 'atrasado ' + (-n) + ' día' + (n === -1 ? '' : 's') };
  if (n === 0) return { fecha, estado: 'hoy', texto: 'vence hoy' };
  return { fecha, estado: n <= 2 ? 'pronto' : 'a_tiempo', texto: (n === 1 ? 'queda 1 día' : 'quedan ' + n + ' días') };
}

/** Los pasos del mes, en orden. */
function pasos_(periodo, hoy) {
  const v = FC.verificar_(periodo);
  const paso = (id) => v.pasos.filter((p) => p.id === id)[0] || {};
  const c = conteos_(periodo);
  const cerrado = FC.mesCerrado_(periodo);
  const sig = mesSiguiente_(periodo);
  const cartolasOk = !!(paso('cartolas').ok && paso('cuadra').ok);
  const pasos = [
    {
      id: 'cartolas', titulo: 'Subir las cartolas del banco', ir: 'bancos', boton: 'Ir a subir cartolas', obligatorio: true,
      que: 'El Excel de la cartola de cada cuenta, del 1 al último día del mes. El sistema revisa que el saldo cuadre antes de guardar.',
      hecho: cartolasOk, avance: null, detalle: [paso('cartolas').detalle, paso('cuadra').detalle].filter(Boolean).join(' · '),
      plazo: plazo_(dia_(sig, 3), hoy, cartolasOk)
    },
    {
      id: 'detalle', titulo: 'Agregar el detalle del banco', ir: 'bancos', boton: 'Ir a subir el detalle', obligatorio: false,
      que: 'El Excel «Mis Movimientos» del BCI. Dice quién transfirió de verdad (muchos clientes pagan desde la cuenta de otra persona) y qué fue a Previred, SII o Tesorería.',
      hecho: c.total > 0 && c.con_detalle >= c.total * 0.8, avance: c.total ? { n: c.con_detalle, total: c.total } : null,
      detalle: c.total ? c.con_detalle + ' de ' + c.total + ' movimientos con nombre completo' + (c.con_detalle && c.con_detalle < c.total ? ' (el detalle no trae los traspasos a otros bancos; es normal que falten algunos)' : '') : 'Primero las cartolas.',
      plazo: plazo_(dia_(sig, 3), hoy, c.total > 0 && c.con_detalle >= c.total * 0.8)
    },
    {
      id: 'excel', titulo: 'Excel BANCOS (solo mientras se acostumbran)', ir: 'bancos', boton: 'Ir a subir el Excel', obligatorio: false, opcional: true,
      que: 'Si ese mes también se llenó el Excel BANCOS a mano, súbelo: lo que anotaron queda como propuesta y el sistema aprende quién paga por quién. Cuando ya no lo llenen, sáltate este paso.',
      hecho: c.con_excel > 0, avance: c.total && c.con_excel ? { n: c.con_excel, total: c.total } : null,
      detalle: c.con_excel ? c.con_excel + ' movimientos con lo que anotaron en el Excel' : 'No se ha subido (opcional).',
      plazo: null
    },
    {
      id: 'revisar', titulo: 'Revisar los movimientos', ir: 'movimientos', boton: 'Ir a revisar', obligatorio: true,
      que: 'Confirmar qué es cada movimiento: ingreso de la empresa, plata de un cliente para sus imposiciones o IVA, gasto, traspaso… Las seguras se confirman de una vez; el resto, de a una, con la propuesta a la vista.',
      hecho: c.total > 0 && c.confirmados === c.total, avance: c.total ? { n: c.confirmados, total: c.total } : null,
      detalle: c.total ? (c.confirmados === c.total ? 'Los ' + c.total + ' movimientos confirmados' :
        c.confirmados + ' de ' + c.total + ' confirmados · por revisar: ' + [c.seguras ? c.seguras + ' seguras' : '', c.con_propuesta ? c.con_propuesta + ' con propuesta' : '', c.sin_pista ? c.sin_pista + ' sin pista' : ''].filter(Boolean).join(', ')) : 'Primero las cartolas.',
      plazo: plazo_(dia_(sig, 5), hoy, c.total > 0 && c.confirmados === c.total),
      conteos: c
    },
    {
      id: 'ventas', titulo: 'Subir las ventas del SII', ir: 'cobranza', boton: 'Ir a Cobranza', obligatorio: false,
      que: 'El Registro de Ventas del mes (RCV) desde el SII. Así se sabe qué facturas quedaron pagadas y cuáles hay que cobrar.',
      hecho: !!paso('ventas').ok, avance: null, detalle: paso('ventas').detalle || '',
      plazo: plazo_(dia_(sig, 5), hoy, !!paso('ventas').ok)
    },
    {
      id: 'cerrar', titulo: 'Cerrar el mes', ir: 'cierre', boton: 'Ir a cerrar', obligatorio: true,
      que: 'Cuando todo lo anterior está listo. Un mes cerrado queda fijo: el tablero y los informes ya no cambian. Se puede reabrir dando el motivo.',
      hecho: cerrado, avance: null, detalle: cerrado ? 'Mes cerrado.' : (v.listo ? 'Todo listo para cerrar.' : 'Faltan pasos obligatorios.'),
      plazo: plazo_(dia_(sig, 5), hoy, cerrado)
    }
  ];
  // El paso que toca: el primero obligatorio (o recomendado) sin hacer; el Excel es opcional.
  const siguiente = pasos.filter((p) => !p.hecho && !p.opcional)[0];
  pasos.forEach((p) => { p.estado = p.hecho ? 'hecho' : p === siguiente ? 'ahora' : 'pendiente'; });
  return { pasos, siguiente: siguiente ? siguiente.id : '', listo_para_cerrar: v.listo, cerrado };
}

/** Las fechas que vienen (de los clientes y del cierre), relativas a hoy. */
function fechas_(hoy) {
  const mes = hoy.slice(0, 7);
  const cand = [];
  [mes, mesSiguiente_(mes)].forEach((p) => {
    cand.push({ fecha: dia_(p, 3), titulo: 'Cartolas y detalle de ' + nombreMes_(mesAnterior_(p)), tipo: 'interno' });
    cand.push({ fecha: dia_(p, 5), titulo: 'Cerrar ' + nombreMes_(mesAnterior_(p)), tipo: 'interno' });
    cand.push({ fecha: dia_(p, 10), titulo: 'Previred (día 13 si es electrónico): la plata de los clientes para imposiciones tiene que haber llegado', tipo: 'clientes' });
    cand.push({ fecha: dia_(p, 20), titulo: 'IVA (F29) de los clientes', tipo: 'clientes' });
  });
  return cand.filter((f) => f.fecha >= hoy).sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).slice(0, 4)
    .map((f) => Object.assign(f, { dias: diasEntre_(hoy, f.fecha) }));
}

const elMes = B.conBoveda('', function (db, data) {
  const hoy = hoy_();
  const periodos = I.db_().prepare('SELECT DISTINCT periodo FROM FIN_MOVIMIENTOS ORDER BY periodo DESC').all().map((r) => r.periodo);
  const pedido = String((data && data.periodo) || '');
  const periodo = /^\d{4}-\d{2}$/.test(pedido) ? pedido : mesDeTrabajo_(hoy);
  const lista = [...new Set([periodo, mesAnterior_(hoy.slice(0, 7))].concat(periodos))].sort().reverse()
    .map((p) => ({ periodo: p, nombre: nombreMes_(p), cerrado: FC.mesCerrado_(p) }));
  // Meses anteriores que quedaron abiertos con algo por revisar (p. ej. el borde de una cartola).
  const atras = I.db_().prepare("SELECT periodo, COUNT(*) AS n FROM FIN_MOVIMIENTOS WHERE estado = 'PENDIENTE' AND periodo < ? GROUP BY periodo ORDER BY periodo").all(periodo)
    .filter((r) => !FC.mesCerrado_(r.periodo)).map((r) => ({ periodo: r.periodo, nombre: nombreMes_(r.periodo), pendientes: r.n }));
  return Object.assign({ periodo, nombre: nombreMes_(periodo), hoy, periodos: lista, fechas: fechas_(hoy), meses_atras: atras }, pasos_(periodo, hoy));
});

module.exports = { elMes, pasos_, fechas_, mesDeTrabajo_ };
