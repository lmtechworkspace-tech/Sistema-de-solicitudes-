/**
 * nueva-solicitud-v2.js — Nueva solicitud v2 (SIGSO v2, Módulo 3D).
 *
 * Decisión del dueño (2026-09-24): PIEL v2 sobre la lógica actual. El
 * formulario sigue siendo formulario.js (catálogos, módulos en cascada,
 * clientes, borrador, adjuntos, envío): este archivo solo pone/quita la
 * clase `ns2` (+ `sx2` para los tokens) en la sección, y el CSS
 * css/v2/nueva-solicitud-v2.css hace el resto. Así la creación de
 * solicitudes no cambia y "Volver a la versión clásica" es instantáneo.
 *
 * La pregunta de gravedad en un toque (obligatoria dentro de la plataforma)
 * vive en formulario.js, porque es un dato -- no depende de la versión.
 */
(function () {
  'use strict';


  function seccion() { return document.getElementById('modulo-nueva_solicitud'); }
  function montar() {
    var s = seccion();
    if (s) s.classList.add('sx2', 'ns2');
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('sx2', 'ns2');
  }
  // 2026-09-25: la versión clásica se retiró; la v2 es la única.
  function activo() { return true; }
  function usarVersion() { /* sin versión clásica */ }

  window.SigsoNuevaSolicitudV2 = {
    cargar: montar, refrescar: montar,
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
})();
