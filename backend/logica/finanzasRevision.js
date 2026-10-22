'use strict';

/**
 * finanzasRevision.js — Revisar el mes antes de cerrarlo, desde la planilla (Finanzas v5.3, 22-10-2026).
 *
 * Junta en una sola lectura lo que hay que mirar antes de cerrar una cuenta y mes de la planilla:
 *   - los pasos (cartola completa, todo anotado, datos completos, grupos decididos, cuadre con el banco);
 *   - los avisos que no bloquean pero conviene revisar (nombres de un mismo cliente escritos distinto,
 *     montos que parecen mal digitados, grupos con filas de otro mes, filas pasadas de mes a mano);
 *   - el estado del cierre (abierto, en revisión, devuelto con observaciones, cerrado) y lo que la persona
 *     puede hacer según su acceso: quien anota lo envía a revisión, quien revisa lo devuelve o lo cierra.
 * Las acciones de cierre son las de finanzasCierre (las mismas de «Cierre de meses»).
 */

const B = require('./finanzasBoveda');
const Base = require('./finanzasBase');
const F = require('./finanzasBancos');
const H = require('./finanzasHoja');
const { errorValidacion } = require('./errores');

const I = F.interno;
const N = (s) => I.normalizar_(s);
const PER_ = /^\d{4}-\d{2}$/;

// Palabras que no distinguen a un cliente: «CONST ARMANDO Y LAEL» y «ARMANDO LAEL» son el mismo.
const VACIAS_ = new Set(['CONST', 'CONSTRUCTORA', 'CONSTRUCCION', 'CONSTRUCCIONES', 'SPA', 'LTDA', 'LIMITADA', 'SA', 'S', 'A', 'EIRL', 'Y', 'E', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'CIA', 'SOC', 'SOCIEDAD', 'EMPRESA', 'EMPRESAS', 'COMERCIAL', 'SERVICIOS']);
function palabras_(n) { return N(n).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((p) => p && !VACIAS_.has(p)); }

/**
 * Nombres que parecen el mismo cliente escrito de otra forma: mismas palabras (sin CONST, SPA, Y…), unas contenidas
 * en las otras (con al menos dos palabras), o en el mismo grupo compartiendo una palabra. Se propone el más usado.
 */
function parecidos_(filas) {
  const usos = new Map(), grupos = new Map();
  filas.forEach((f) => {
    const n = N(f.nombre); if (!n) return;
    usos.set(n, (usos.get(n) || 0) + 1);
    if (f.grupo) { const g = grupos.get(f.grupo) || new Set(); g.add(n); grupos.set(f.grupo, g); }
  });
  const nombres = [...usos.keys()], pal = new Map(nombres.map((n) => [n, palabras_(n)]));
  const padre = new Map(nombres.map((n) => [n, n])), motivo = new Map();
  const raiz = (n) => { while (padre.get(n) !== n) n = padre.get(n); return n; };
  const unir = (a, b, por) => { const ra = raiz(a), rb = raiz(b); if (ra !== rb) { padre.set(rb, ra); motivo.set(ra, motivo.get(ra) || por); } };
  const contiene = (a, b) => a.length >= 2 && a.every((p) => b.indexOf(p) !== -1);
  for (let i = 0; i < nombres.length; i++) {
    for (let j = i + 1; j < nombres.length; j++) {
      const a = pal.get(nombres[i]), b = pal.get(nombres[j]);
      if (!a.length || !b.length) continue;
      if (a.slice().sort().join(' ') === b.slice().sort().join(' ')) unir(nombres[i], nombres[j], 'Mismas palabras, escritas distinto.');
      else if (contiene(a, b) || contiene(b, a)) unir(nombres[i], nombres[j], 'Un nombre está dentro del otro.');
    }
  }
  grupos.forEach((ns, letra) => {
    const l = [...ns];
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      if (pal.get(l[i]).some((p) => p.length > 2 && pal.get(l[j]).indexOf(p) !== -1)) unir(l[i], l[j], 'Están en el mismo grupo (' + letra + ').');
    }
  });
  const clusters = new Map();
  nombres.forEach((n) => { const r = raiz(n); clusters.set(r, (clusters.get(r) || []).concat([n])); });
  return [...clusters.entries()].filter((e) => e[1].length > 1).map(([r, l]) => {
    const lista = l.map((n) => ({ nombre: n, filas: usos.get(n) })).sort((a, b) => b.filas - a.filas || b.nombre.length - a.nombre.length);
    return { nombres: lista, sugerido: lista[0].nombre, motivo: motivo.get(r) || '' };
  }).sort((a, b) => b.nombres.length - a.nombres.length);
}

const revision = B.conBoveda('', function (db, data, contexto) {
  const periodo = String((data && data.periodo) || '');
  if (!PER_.test(periodo)) return errorValidacion('periodo', 'Mes no válido.');
  const ctx = H.contexto_(db);
  const cuenta = ctx.cuentas.get(String((data && data.cuenta_ref) || ''));
  if (!cuenta) return errorValidacion('cuenta_ref', 'Elige la cuenta del banco.');
  const h = H.construir_(db, cuenta, periodo, ctx);
  const C = require('./finanzasCierre');
  const v = C.verificar_(periodo);
  const cob = (v.cobertura || []).find((c) => c.cuenta_ref === cuenta.id);
  const e = h.estado, c = h.cartola;
  const completar = h.filas.filter((f) => f.que && (f.que.k === 'rev' || / · sin /.test(f.que.t)));
  const abiertos = h.grupos.filter((g) => g.decision === 'PENDIENTE' && g.suma);
  const pasos = [
    { id: 'cartola', titulo: 'La cartola cubre el mes completo', ok: !!(cob && (cob.completa || cob.excepcion)),
      detalle: !cob ? 'No hay cartola de esta cuenta.' : cob.completa ? 'Del 1 al último día, sin huecos.' : cob.excepcion ? 'Fuera de alcance: ' + cob.excepcion.motivo : 'Falta ' + (cob.hasta ? 'desde el ' + Base.sumarDias_(cob.hasta, 1).split('-').reverse().join('-') : 'todo el mes') + '.' },
    { id: 'falta', titulo: 'Todo lo del banco está anotado', ok: !e.falta && !!c, n: e.falta, detalle: e.falta ? e.falta + ' movimiento(s) del banco sin anotar.' : c ? 'Cada movimiento del banco tiene su fila.' : 'Espera la cartola.' },
    { id: 'completar', titulo: 'Las filas tienen todos sus datos', ok: !completar.length && h.filas.length > 0, n: completar.length,
      detalle: completar.length ? completar.length + ' fila(s) por completar (OBS, plan de cuenta o nombre).' : 'OBS, nombre y plan de cuenta en todas las filas.' },
    { id: 'grupos', titulo: 'Los grupos están decididos', ok: !abiertos.length, n: abiertos.length,
      detalle: abiertos.length ? abiertos.length + ' grupo(s) con dinero por decidir: ' + abiertos.slice(0, 4).map((g) => g.letra + ' (' + (g.cliente || 'sin nombre') + ')').join(', ') + '.' : 'Ningún grupo con dinero por decidir.' },
    { id: 'esperando', titulo: 'Cuadra con el banco', ok: !!c && !e.falta && !e.esperando && c.cuadra && !c.n_cortes, n: e.esperando,
      detalle: !c ? 'Sin cartola.' : !c.cuadra ? 'La cartola no cuadra consigo misma: revisa que esté completa.' : c.n_cortes ? 'La cadena de saldos se corta: puede haber movimientos repetidos o faltantes.' : e.esperando ? e.esperando + ' fila(s) anotada(s) que el banco no trae.' : 'Todo lo anotado está en el banco y la cartola está completa.' }
  ];
  const avisos = [];
  const par = parecidos_(h.filas);
  if (par.length) avisos.push({ id: 'nombres', titulo: par.length + ' cliente(s) escrito(s) de más de una forma', detalle: 'Unificarlos deja los saldos por cliente y los informes en un solo nombre.' });
  const dif = require('./finanzasInformes').diferencias_(h.filas, '');
  if (dif.length) avisos.push({ id: 'montos', titulo: dif.length + ' monto(s) que parecen mal digitados', detalle: dif.slice(0, 3).map((x) => x.anotada.nombre + ': anotado ' + Base.plata_(x.anotada.monto) + ', banco ' + Base.plata_(x.banco.monto)).join(' · ') + '.', filas: dif });
  const otroMes = h.grupos.filter((g) => g.otro_mes);
  if (otroMes.length) avisos.push({ id: 'otro_mes', titulo: otroMes.length + ' grupo(s) con filas de otro mes', detalle: 'Revisa que lo que sobra se decida en un solo mes: ' + otroMes.slice(0, 4).map((g) => g.letra).join(', ') + '.' });
  const movidas = h.filas.filter((f) => f.movida);
  if (movidas.length) avisos.push({ id: 'movidas', titulo: movidas.length + ' fila(s) pasadas de mes a mano', detalle: 'Confirma que de verdad son de ' + Base.nombreMes_(periodo) + '.' });
  const obligatorios = pasos.every((p) => p.ok);
  const otrosPasos = v.pasos.filter((p) => p.obligatorio && !p.ok && ['cartolas', 'cuadra', 'revisado'].indexOf(p.id) === -1);
  return {
    periodo, nombre_mes: Base.nombreMes_(periodo), cuenta_ref: cuenta.id, cuenta: cuenta.banco + ' ···' + cuenta.ultimos4 + ' · ' + cuenta.empresa,
    pasos, listo: obligatorios, avisos, parecidos: par,
    // Lo que pide el cierre para todo el mes (todas las cuentas), además de esta planilla.
    cierre_listo: v.listo, cierre_faltan: v.pasos.filter((p) => p.obligatorio && !p.ok).map((p) => ({ id: p.id, nombre: p.nombre, detalle: p.detalle })), otros_pasos: otrosPasos.map((p) => p.nombre),
    cierre: require('./finanzasCierre').estadoMes_(periodo),
    puede: { enviar: Base.puede_(contexto, 'CONFIRMAR'), revisar: Base.puede_(contexto, 'CIERRE'), editar: Base.puede_(contexto, 'REGISTRAR') }
  };
});

module.exports = { revision, parecidos_ };
