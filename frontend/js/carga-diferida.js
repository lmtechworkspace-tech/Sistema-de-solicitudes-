/**
 * carga-diferida.js — sacar del camino crítico los módulos que casi nadie
 * abre en el primer minuto.
 *
 * POR QUÉ EXISTE
 * Medido en producción (2026-09-06, plataforma.html):
 *
 *   438 KB de JavaScript, 2.852 ms hasta que la página responde
 *   calidad.js    102 KB   el archivo más grande del frontend, con diferencia
 *   proyectos.js   87 KB
 *
 * Son <script> clásicos: el navegador no da la página por interactiva hasta
 * haberlos bajado y ejecutado TODOS. Se paga entero aunque entres a Inicio y
 * te quedes ahí.
 *
 * POR QUÉ SOLO CALIDAD, Y NO TAMBIÉN PROYECTOS
 * Se revisó quién usa cada módulo desde fuera, y no son simétricos:
 *
 *   · calidad.js    todas sus referencias externas viven dentro de rutas
 *                   `id === 'calidad'`. Nadie lo toca sin abrirlo.
 *   · proyectos.js  detalle.js engancha el botón "Convertir en proyecto"
 *                   sólo si `window.SigsoProyectos` existe EN ESE MOMENTO, y
 *                   eso ocurre dentro de la Bandeja, que no abre Proyectos.
 *                   Diferirlo haría desaparecer ese botón sin ningún error:
 *                   el fallo más caro de todos, el que no se ve.
 *
 * Así que Proyectos se queda donde está. Bajar de 438 a 336 KB (-23%) sin
 * romper nada vale más que bajar a 249 KB rompiendo un botón.
 *
 * POR QUÉ ADEMÁS SE PRECARGA
 * Diferir a secas tiene un coste: quien entra a Calidad espera la descarga
 * que antes ya estaba hecha. Por eso, en cuanto la aplicación termina de
 * arrancar y el navegador queda ocioso, se pide igual. El archivo sale del
 * camino crítico pero llega antes de que a nadie le haga falta.
 *
 * Y hay un segundo motivo, visual: el árbol del sidebar dibuja la flechita de
 * "esto se despliega" mirando los submódulos REGISTRADOS, y Calidad los
 * registra al cargar. Sin precarga, Calidad se vería como una hoja sin
 * flechita hasta que alguien la abriera una vez.
 *
 * app.html (la copia que sirve Apps Script) NO usa este archivo: sigue
 * cargando calidad.js de forma directa. Es una página distinta, con otro
 * despliegue —manual— y no vale la pena arrastrarla a esto.
 */
(function () {
  'use strict';

  // id de módulo -> archivo. Deliberadamente corto: cada entrada aquí es un
  // módulo que hay que auditar como se auditó Calidad (¿lo usa alguien sin
  // abrirlo?), no una lista que se amplía por costumbre.
  var ARCHIVOS = {
    calidad: 'js/calidad.js'
  };

  // id -> Promise. Sirve de candado: dos peticiones simultáneas (la precarga
  // ociosa y un clic impaciente) comparten la MISMA descarga en vez de
  // inyectar el <script> dos veces, que ejecutaría el módulo dos veces.
  var enCurso_ = {};

  function inyectar_(src) {
    return new Promise(function (resolver, rechazar) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false; // conserva el orden si algún día hay más de uno
      s.onload = function () { resolver(true); };
      s.onerror = function () { rechazar(new Error('No se pudo cargar ' + src)); };
      document.body.appendChild(s);
    });
  }

  var SigsoCarga = {
    /**
     * ¿Este módulo se carga aparte? Los que no, ya están en la página.
     */
    esDiferido: function (id) {
      return Object.prototype.hasOwnProperty.call(ARCHIVOS, id);
    },

    /**
     * Deja el módulo disponible y resuelve. Para un módulo que no se difiere
     * resuelve de inmediato, así quien llama no tiene que preguntar antes.
     *
     * Si la descarga falla resuelve `false` en vez de rechazar: quien llama
     * ya sabe mostrar su propio aviso, y un rechazo suelto acabaría en la
     * consola sin que el usuario se entere de nada.
     */
    pedir: function (id) {
      if (!SigsoCarga.esDiferido(id)) return Promise.resolve(true);
      if (!enCurso_[id]) {
        enCurso_[id] = inyectar_(ARCHIVOS[id]).catch(function (err) {
          // Se olvida el intento fallido para que un segundo clic reintente:
          // la causa típica es una red que se cayó un momento.
          delete enCurso_[id];
          if (window.console && console.warn) console.warn(err.message);
          return false;
        });
      }
      return enCurso_[id];
    },

    /**
     * Pide todo lo diferido cuando el navegador esté ocioso. Se llama una vez,
     * al terminar de arrancar la aplicación.
     */
    precargar: function () {
      return new Promise(function (resolver) {
        var lanzar = function () {
          resolver(Promise.all(Object.keys(ARCHIVOS).map(function (id) {
            return SigsoCarga.pedir(id);
          })));
        };
        // requestIdleCallback no existe en Safari; el timeout es el respaldo.
        // 1500 ms: lo bastante tarde para no competir con las llamadas que la
        // pantalla de Inicio dispara al montarse.
        if (window.requestIdleCallback) window.requestIdleCallback(lanzar, { timeout: 3000 });
        else setTimeout(lanzar, 1500);
      });
    }
  };

  window.SigsoCarga = SigsoCarga;
})();
