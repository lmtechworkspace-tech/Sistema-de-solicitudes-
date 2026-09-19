'use strict';

/**
 * inicio.js — puerto de Inicio.gs (M-02): un solo viaje para la pantalla de
 * Inicio en vez de 5 llamadas sueltas (mi_trabajo, calidad, bandeja,
 * jefatura, pausas). Cada bloque delega en la MISMA funcion Node que ya
 * atiende su accion suelta, con su propio control de permisos intacto --
 * ver la cabecera del .gs para el porque completo (por qué los bloques los
 * manda el cliente, por qué una fuente que falla no tumba la pantalla).
 *
 * Gate de MODULO por bloque (cuentaTieneElModuloDelBloque_/
 * MODULO_POR_ACCION en el .gs): NO SE PORTA, decisión consciente (preguntada
 * al usuario, no asumida -- 2026-09-19). Contexto importante para quien siga
 * esto: en el .gs, esta comprobación arregló un agujero REAL, documentado en
 * `backend/test/inicio-modulos.test.js` y `acciones-con-porton.test.js` --
 * antes de que existiera, pedir un bloque por `getInicio` devolvía datos que
 * la acción suelta (ej. `getDashboardData`) le negaba a una cuenta de portal
 * sin ese módulo. No es un caso hipotético, fue un hallazgo real.
 *
 * Por qué NO se reproduce ese fix acá todavía: `MODULO_POR_ACCION` (la
 * tabla que dice qué módulo de portal exige cada acción) no existe en Node
 * en ningún lado -- ver la nota ya escrita en router.js. HOY, en Node,
 * pedir `getDashboardData`/`getPanelJefatura`/`getPausaHoyTrabajador`/
 * `listarActividades`/`listarDocumentosSgc` SUELTAS tampoco filtra por
 * `contexto.modulos` (solo por rol). Osea que un bloque de `getInicio` no
 * obtiene HOY nada que su acción suelta no entregara ya en Node -- no hay
 * asimetría que introducir, la invariante que el .gs protege ("un bloque no
 * puede dar más que su acción suelta") se sigue cumpliendo, aunque al nivel
 * más permisivo que tiene Node hoy, no al de Apps Script.
 *
 * ESTO ES UN HUECO CONOCIDO Y RASTREADO, NO UNO NUEVO NI UNO OLVIDADO: en
 * cuanto se porte `MODULO_POR_ACCION` de verdad (para estas u otras
 * acciones), este archivo tiene que actualizarse junto con el resto -- y
 * ese día vale la pena traer `inicio-modulos.test.js` como prueba de no
 * regresión, tal cual está en el .gs.
 *
 * "Mis solicitudes" (proyecto INTAKE aparte) y Novedades (badge del menú,
 * memoizado en el cliente) quedan fuera, igual que en el .gs.
 */

const Actividades = require('./actividades');
const Calidad = require('./calidadSgc');
const Dashboard = require('./dashboard');
const Jefatura = require('./jefatura');
const Pausas = require('./pausas');

function getResumen(db, data, contexto) {
  const pedidos = (data && Array.isArray(data.bloques)) ? data.bloques : [];
  const salida = { bloques: {} };

  function bloque(nombre, fn) {
    if (pedidos.indexOf(nombre) === -1) return;
    try {
      const r = fn();
      if (r && (r._forbidden || r._validationError)) {
        salida.bloques[nombre] = { ok: false, message: r.message || '' };
        return;
      }
      salida.bloques[nombre] = { ok: true, data: r };
    } catch (err) {
      salida.bloques[nombre] = { ok: false, message: 'No se pudo cargar esta parte.' };
    }
  }

  bloque('mi_trabajo', () => Actividades.listar(db, { responsable_email: (contexto && contexto.email) || '' }, contexto));
  bloque('calidad', () => Calidad.listarDocumentos(db, {}, contexto));
  bloque('bandeja', () => Dashboard.getData(db, {}, contexto));
  bloque('jefatura', () => Jefatura.getPanel(db, {}, contexto));
  bloque('pausas', () => Pausas.getPausaHoyTrabajador(db, {}, contexto));

  return salida;
}

module.exports = { getResumen };
