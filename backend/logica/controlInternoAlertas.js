'use strict';

/**
 * controlInternoAlertas.js — avisos que salen de cruzar las columnas (y las
 * matrices entre sí), pedidos en la reunión con Francisca (2026-10-01).
 *
 * IVA (período P, se declara en P+1):
 *  - Recordatorio: los clientes con impuesto único se hacen al final; si
 *    pasado el 15 de P+1 no hay recordatorio, declaración ni F29 enviado, hay
 *    que mandarles recordatorio.
 *  - Postergaciones que vencen en 10 días (o ya vencieron) sin pago.
 *  - Impuesto único: lo informa RR.HH. (matriz 3 % e IUSC). Si allá hay
 *    monto y aquí no, se avisa y se puede traer con un clic. Si esa matriz no
 *    tiene el mes (dejó de llenarse en julio de 2026), se suma el monto IUSC de
 *    cada obra en Remuneraciones, por el mes de la remuneración.
 *
 * Cada alerta: { clave, tono, titulo, texto, items: [{ registro_id, cliente,
 * texto, usar?: { columna: valor } }] }.
 */

const { matriz_, hecho_, periodoRemuneracion_ } = require('./controlInternoMatrices');

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
function num_(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[$\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  const n = Number(s.replace(',', '.'));
  return s && isFinite(n) ? n : 0;
}
function t_(v) { return String(v == null ? '' : v).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
function sumarDias_(f, n) { return new Date(Date.parse(f + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function corta_(f) { return f.slice(8, 10) + '-' + f.slice(5, 7) + '-' + f.slice(0, 4); }
function pesos_(n) { return '$ ' + Math.round(n).toLocaleString('es-CL'); }

function iva(db, m, periodo, filas, h) {
  const out = [];
  const vivas = filas.filter((f) => !/^ANULAD/.test(String(f.estado || '')));
  const sig = h.moverPeriodo_(periodo, 1);
  const dia15 = sig.slice(0, 4) + '-' + sig.slice(6, 8) + '-15';

  // 1. Recordatorio de impuesto único después del 15.
  if (h.hoy > dia15) {
    const items = vivas.filter((f) => {
      const d = f.datos || {};
      return num_(d.monto_impuesto_unico) > 0 && !hecho_(d.envio_correo_recordatorio) && !hecho_(d.fecha_declaracion) && !hecho_(d.fecha_envio_f_29) && !/ENVIAD|^SI/.test(t_(d.enviado_f29));
    }).map((f) => ({ registro_id: f.registro_id, cliente: f.cliente_nombre, texto: 'Impuesto único ' + pesos_(num_(f.datos.monto_impuesto_unico)) + ', sin recordatorio ni declaración.' }));
    if (items.length) out.push({ clave: 'recordatorio', tono: 'alerta', titulo: items.length + (items.length === 1 ? ' cliente con impuesto único espera recordatorio' : ' clientes con impuesto único esperan recordatorio'), texto: 'Ya pasó el 15: hay que mandarles el recordatorio.', items });
  }

  // 2. Postergaciones por vencer o vencidas sin pago (de este mes y los 4 anteriores).
  const desde = h.moverPeriodo_(periodo, -4);
  const limite = sumarDias_(h.hoy, 10), piso = sumarDias_(h.hoy, -60);
  const post = h.rango_(db, m.clave, desde, periodo).filter((f) => {
    const d = f.datos || {}, v = String(d.fecha_vencimiento_postergacion || '');
    return /^SI/.test(t_(d.posterga_si_no)) && RE_FECHA.test(v) && v <= limite && v >= piso && !hecho_(d.fecha_pago) && !/PAGAD/.test(t_(d.estado_pago));
  }).sort((a, b) => String(a.datos.fecha_vencimiento_postergacion).localeCompare(String(b.datos.fecha_vencimiento_postergacion)));
  if (post.length) {
    out.push({
      clave: 'postergacion', tono: post.some((f) => f.datos.fecha_vencimiento_postergacion < h.hoy) ? 'critico' : 'alerta',
      titulo: post.length + (post.length === 1 ? ' postergación de IVA vence pronto' : ' postergaciones de IVA vencen pronto'), texto: 'Sin fecha de pago.',
      items: post.map((f) => {
        const v = f.datos.fecha_vencimiento_postergacion;
        return { registro_id: f.periodo === periodo ? f.registro_id : '', cliente: f.cliente_nombre, texto: 'IVA de ' + f.periodo.slice(6, 8) + '/' + f.periodo.slice(0, 4) + ': ' + (v < h.hoy ? 'venció el ' : 'vence el ') + corta_(v) + '.' };
      })
    });
  }

  // 3. Impuesto único que RR.HH. informó y aquí no está.
  const mi = matriz_('IUSC');
  if (mi) {
    let rrhh = h.consultar_(db, 'CI_REGISTROS', { matriz: 'IUSC', periodo, activa: true }).filter((r) => num_((r.datos || {}).monto_iusc) > 0);
    let fuente = 'Según la matriz 3 % e impuesto único de RR.HH. del mismo mes.';
    if (!rrhh.length) {
      const porCli = {};
      [periodo, h.moverPeriodo_(periodo, 1)].forEach((p) => h.consultar_(db, 'CI_REGISTROS', { matriz: 'REMUNERACIONES', periodo: p, activa: true }).forEach((r) => {
        if (periodoRemuneracion_(r) !== periodo || !(num_((r.datos || {}).monto_iusc) > 0)) return;
        const k = r.cliente_id || 'N:' + r.cliente_nombre;
        if (!porCli[k]) porCli[k] = { cliente_id: r.cliente_id, cliente_nombre: r.cliente_nombre, cliente_rut: r.cliente_rut, datos: { monto_iusc: 0 } };
        porCli[k].datos.monto_iusc += num_(r.datos.monto_iusc);
      }));
      rrhh = Object.values(porCli);
      fuente = 'Según Remuneraciones de RR.HH. (impuesto único de cada obra, sumado por cliente).';
    }
    const items = [];
    rrhh.forEach((r) => {
      const monto = num_(r.datos.monto_iusc);
      const f = vivas.find((x) => h.mismoCliente_(x, r));
      if (f && num_((f.datos || {}).monto_impuesto_unico) > 0) return;
      items.push({
        registro_id: f ? f.registro_id : '', cliente: r.cliente_nombre,
        texto: 'RR.HH. informó ' + pesos_(monto) + (f ? '; aquí dice ' + (f.datos && f.datos.monto_impuesto_unico !== undefined && f.datos.monto_impuesto_unico !== '' ? String(f.datos.monto_impuesto_unico) : 'vacío') + '.' : '; el cliente no tiene fila en este mes.'),
        usar: f ? { monto_impuesto_unico: monto } : null
      });
    });
    if (items.length) out.push({ clave: 'iusc', tono: 'info', titulo: items.length + (items.length === 1 ? ' impuesto único informado por RR.HH. no está aquí' : ' impuestos únicos informados por RR.HH. no están aquí'), texto: fuente, items });
  }
  return out;
}

module.exports = { iva };
