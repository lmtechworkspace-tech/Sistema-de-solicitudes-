'use strict';

/**
 * notificacionesApp.js — notificaciones "vivas" (v7.1): el espejo en pantalla
 * de lo que ya se manda por correo (un toast/badge mientras la persona
 * trabaja). Puerto de Notificaciones.gs: encolado (usado por los modulos que
 * publican avisos -- Novedades, Actividades, Pausas) MAS el lado de lectura
 * del polling del cliente (Fase 3b, 2026-09-19) -- sincronizar, marcar
 * leida, marcar todas leidas.
 *
 * NOTIFICACIONES_APP guarda el destinatario SIEMPRE normalizado (bug real
 * v9.0e: "marcar todas" no persistia porque el correo encolado no calzaba,
 * por mayusculas/espacios, con el de la sesion) -- el lado de lectura
 * normaliza igual antes de comparar, en ambos sentidos.
 *
 * v9.0g (bug real): una columna `leida` que Sheets guarda como checkbox
 * puede volver como booleano `true`, no el string 'TRUE' -- esNotifLeida_
 * acepta las dos formas (mismo criterio que esVerdaderoProyecto_ etc. en el
 * resto de SIGSO). SQLite guarda lo que se le escribe tal cual, pero se
 * mantiene la misma tolerancia por si una fila vieja (migrada desde
 * Sheets) llegó con el booleano real.
 *
 * Gate de MODULO: sincronizarNotificacionesApp/marcarNotificacionAppLeida/
 * marcarTodasNotificacionesAppLeidas NO tienen entrada en MODULO_POR_ACCION
 * en el .gs tampoco (verificado en notificaciones-vivas.test.js) -- no hay
 * nada que fingir portar acá.
 */

const crypto = require('node:crypto');
const { agregarFilas_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}
function esNotifLeida_(valor) {
  return valor === true || valor === 'TRUE' || valor === 1;
}
function leerSeguro_(db) {
  try { return leerFilas_(db, 'NOTIFICACIONES_APP', COLUMNAS.NOTIFICACIONES_APP); }
  catch (err) { return []; }
}

// Tolerante a que la tabla no exista: encolar un aviso en pantalla nunca
// debe romper la accion principal (publicar una novedad, cerrar una
// actividad, etc.), igual que en el .gs.
function encolarLote(db, items) {
  if (!items || !items.length) return { encolado: 0 };
  try {
    const ahora = new Date();
    const filas = items
      .filter((it) => it && it.destinatario)
      .map((it) => {
        const expira = new Date(ahora.getTime() + (it.vidaHoras || 72) * 60 * 60 * 1000);
        return {
          notif_id: crypto.randomUUID(),
          destinatario_email: normalizarEmail_(it.destinatario),
          tipo: it.tipo,
          titulo: it.titulo,
          mensaje: it.mensaje || '',
          modulo_id: it.modulo_id || '',
          texto_accion: it.texto_accion || '',
          leida: 'FALSE',
          creada_en: ahora.toISOString(),
          expira_en: expira.toISOString()
        };
      });
    if (!filas.length) return { encolado: 0 };
    agregarFilas_(db, 'NOTIFICACIONES_APP', filas);
    return { encolado: filas.length };
  } catch (err) {
    return { encolado: 0 };
  }
}

// v7.1: polling del cliente (cada 2-3 min). Solo las no leidas y no vencidas
// del usuario de la sesion -- nunca recibe un email como parametro, sale de
// contexto.email (misma identidad ya resuelta por el router).
function sincronizar(db, data, contexto) {
  const ahora = Date.now();
  const emailSesion = normalizarEmail_(contexto && contexto.email);
  const pendientes = leerSeguro_(db).filter((n) =>
    normalizarEmail_(n.destinatario_email) === emailSesion &&
    !esNotifLeida_(n.leida) &&
    (!n.expira_en || new Date(n.expira_en).getTime() > ahora)
  );
  pendientes.sort((a, b) => new Date(b.creada_en) - new Date(a.creada_en));
  return {
    notificaciones: pendientes.map((n) => ({
      notif_id: n.notif_id, tipo: n.tipo, titulo: n.titulo, mensaje: n.mensaje,
      modulo_id: n.modulo_id, texto_accion: n.texto_accion, creada_en: n.creada_en
    }))
  };
}

// v7.1: marcar como leida/descartada. Solo el propio destinatario puede
// marcarla (evita que un notif_id adivinado silencie la alerta de otra
// persona) -- si no matchea, no hace nada (silencioso, es un "dismiss", no
// una operacion que deba fallar ruidosamente en el cliente).
function marcarLeida(db, data, contexto) {
  const notifId = data && data.notif_id;
  if (!notifId) return { actualizado: false };
  const fila = leerSeguro_(db).find((n) => n.notif_id === notifId);
  if (!fila || normalizarEmail_(fila.destinatario_email) !== normalizarEmail_(contexto && contexto.email)) {
    return { actualizado: false };
  }
  actualizarFilaPorId_(db, 'NOTIFICACIONES_APP', 'notif_id', notifId, { leida: 'TRUE' });
  return { actualizado: true };
}

// v7.1 (B6): pasa a leida=TRUE todas las no-leidas del usuario de la sesion,
// en una sola pasada (evita N requests desde el cliente).
function marcarTodasLeidas(db, data, contexto) {
  const emailSesion = normalizarEmail_(contexto && contexto.email);
  const pendientes = leerSeguro_(db).filter((n) =>
    normalizarEmail_(n.destinatario_email) === emailSesion && !esNotifLeida_(n.leida)
  );
  pendientes.forEach((n) => actualizarFilaPorId_(db, 'NOTIFICACIONES_APP', 'notif_id', n.notif_id, { leida: 'TRUE' }));
  return { actualizadas: pendientes.length };
}

module.exports = { encolarLote, sincronizar, marcarLeida, marcarTodasLeidas };
