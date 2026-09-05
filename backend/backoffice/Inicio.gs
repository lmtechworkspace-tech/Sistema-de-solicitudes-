/**
 * Inicio.gs — una sola llamada para toda la pantalla de Inicio (M-02).
 *
 * EL PROBLEMA. Inicio pedía hasta SIETE cosas a la vez, una por bloque:
 * actividades, documentos del SGC, mis solicitudes, tablero, panel de
 * jefatura, pausa del día y novedades. En local terminan en 435 ms y no se
 * nota; en Apps Script cada llamada es un viaje de 300 ms a 2 s, así que la
 * primera pantalla que ve todo el mundo tardaba segundos en asentarse.
 *
 * Aquí se hace el mismo trabajo en UN viaje.
 *
 * ── POR QUÉ LOS BLOQUES LOS PIDE EL CLIENTE ───────────────────────────────
 * La tentación era decidir aquí qué bloques corresponden, leyendo
 * `contexto.modulos`. No se puede: ese campo SOLO existe cuando la identidad
 * viene del portal. Quien entra por el enlace de Google recibe un contexto
 * con email y rol, sin módulos — y se quedaría con un Inicio vacío.
 *
 * Así que la lista la manda el cliente, que ya la conoce. Y no abre ninguna
 * puerta: cada bloque delega en la MISMA función que atendía su acción
 * suelta, con su propio control de permisos intacto. Pedir un bloque al que
 * no se tiene acceso devuelve exactamente lo que devolvía antes — un
 * rechazo — solo que dentro de esta respuesta.
 *
 * ── UNA FUENTE QUE FALLA NO PUEDE TUMBAR LA PANTALLA ──────────────────────
 * El frontend envolvía cada llamada en su propio .catch justamente para eso.
 * Al juntarlas en una, esa garantía se movería al servidor o se perdería: un
 * error en las pausas dejaría a la persona sin novedades, sin tareas y sin
 * tablero. Por eso cada bloque va en su try/catch y devuelve {ok:false} en
 * vez de propagar.
 *
 * ── QUÉ NO ESTÁ AQUÍ ──────────────────────────────────────────────────────
 * "Mis solicitudes" vive en el proyecto INTAKE, que es otra implementación
 * de Apps Script. Traerla aquí obligaría a duplicar cómo se resuelven los
 * correos de una cuenta desde su token — la misma duplicación que ya hizo
 * divergir los permisos y el filtro del CSV. Se queda fuera: siete llamadas
 * pasan a dos, y las dos van en paralelo.
 *
 * NOVEDADES tampoco. Su feed ya lo pide el badge del menú lateral al
 * arrancar, y el cliente lo memoiza con un TTL para compartirlo. Traerlo
 * aquí haría que el servidor calculara lo mismo DOS veces: una para este
 * bloque y otra para el badge.
 */

var Inicio = {

  /**
   * data.bloques: lista de bloques a traer. Sin ella no se trae ninguno --
   * un Inicio que adivina qué mostrar es un Inicio que se equivoca.
   */
  getResumen: function (data, contexto) {
    var pedidos = (data && Array.isArray(data.bloques)) ? data.bloques : [];
    var salida = { bloques: {} };

    // Cada bloque, aislado. Se devuelve la MISMA forma que tenía la acción
    // suelta ({ok, data}) para que los pintores del frontend no cambien:
    // menos superficie de cambio, menos que pueda romperse.
    function bloque(nombre, fn) {
      if (pedidos.indexOf(nombre) === -1) return;
      try {
        var r = fn();
        // Los módulos devuelven {_forbidden} o {_validationError} en vez de
        // lanzar. Se traduce igual que lo hacía responderResultado_.
        if (r && (r._forbidden || r._validationError)) {
          salida.bloques[nombre] = { ok: false, message: r.message || '' };
          return;
        }
        salida.bloques[nombre] = { ok: true, data: r };
      } catch (err) {
        // Se registra pero NO se propaga: el resto de la pantalla tiene que
        // llegar igual.
        try { logError_(err, 'Inicio.getResumen:' + nombre); } catch (e) { /* ni el log puede tumbarla */ }
        salida.bloques[nombre] = { ok: false, message: 'No se pudo cargar esta parte.' };
      }
    }

    bloque('mi_trabajo', function () {
      return Actividades.listar({ responsable_email: (contexto && contexto.email) || '' }, contexto);
    });
    bloque('calidad', function () {
      return Calidad.listarDocumentos({}, contexto);
    });
    bloque('bandeja', function () {
      return Dashboard.getData({}, contexto);
    });
    bloque('jefatura', function () {
      return Jefatura.getPanel({}, contexto);
    });
    bloque('pausas', function () {
      return Pausas.getPausaHoyTrabajador({}, contexto);
    });

    return salida;
  }
};
