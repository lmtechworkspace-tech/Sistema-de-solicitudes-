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

  var CLAVE_PREF = 'sigso_nueva_solicitud_v2';

  function seccion() { return document.getElementById('modulo-nueva_solicitud'); }
  function montar() {
    var s = seccion();
    if (s) s.classList.add('sx2', 'ns2');
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('sx2', 'ns2');
  }
  function activo() { try { return localStorage.getItem(CLAVE_PREF) !== '0'; } catch (e) { return true; } }
  function usarVersion(v2) {
    try { localStorage.setItem(CLAVE_PREF, v2 ? '1' : '0'); } catch (e) { /* sin storage: no se recuerda */ }
    document.dispatchEvent(new CustomEvent('sigso:v2-version', { detail: { modulo: 'nueva_solicitud', v2: !!v2 } }));
  }

  window.SigsoNuevaSolicitudV2 = {
    cargar: montar, refrescar: montar,
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
})();
