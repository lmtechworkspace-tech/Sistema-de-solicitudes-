'use strict';

/**
 * notificacionesApp.js — notificaciones "vivas" (v7.1): el espejo en pantalla
 * de lo que ya se manda por correo (un toast/badge mientras la persona
 * trabaja). Puerto PARCIAL a proposito: solo el lado de ENCOLADO
 * (encolarLote), que es lo que necesitan los modulos que publican avisos
 * (Novedades, y mas adelante Actividades/Pausas). El lado de lectura
 * (sincronizar, marcar leida, marcar todas) es su propio modulo y queda
 * pendiente -- no hace falta para que la publicacion funcione.
 *
 * NOTIFICACIONES_APP guarda el destinatario SIEMPRE normalizado (bug real
 * v9.0e: "marcar todas" no persistia porque el correo encolado no calzaba,
 * por mayusculas/espacios, con el de la sesion) -- el lector, cuando se
 * porte, debe normalizar igual.
 */

const crypto = require('node:crypto');
const { agregarFilas_ } = require('../db/sqliteRepo');

function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
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

module.exports = { encolarLote };
