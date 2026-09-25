/**
 * calidad-nucleo-v2.js — Núcleo del módulo Calidad en v2 (SIGSO v2, R10 del
 * retiro de la versión clásica; ver documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * Reemplaza a calidad.js en la plataforma: define window.SigsoCalidad (la
 * misma API que usaban el shell y las pantallas v2), el árbol del sidebar
 * con sus permisos y el ruteo de cada sección a su archivo v2:
 *   inicio/documentos/personas ...... calidad-v2.js y sus hermanos (8A-8C)
 *   ficha y capacitaciones .......... calidad-ficha-v2.js
 *   nc/quejas/auditorías/revisión ... calidad-mejora-v2.js
 *   indicadores/objetivos ........... calidad-medicion-v2.js
 *   alcance/contexto/procesos/
 *   riesgos/cobertura ............... calidad-sistema-v2.js
 *   servicios/proveedores ........... calidad-operacion-v2.js
 *   reportes/accesos/forms de docs .. calidad-admin-v2.js
 *
 * REGLA QUE NO CAMBIA: aquí nunca se decide qué documento o ficha ve una
 * persona. El backend devuelve lo filtrado y revalida en cada acción; el
 * mapa secciones_visibles solo decide qué se pinta en el árbol.
 * calidad.js queda solo para app.html (acceso Google/Apps Script).
 */
(function () {
  'use strict';

  var ARQUITECTURA = [
    { id: 'inicio', nombre: 'Inicio', icono: 'estado', plano: true, items: [{ id: 'inicio', nombre: 'Inicio', permiso: 'inicio' }] },
    { id: 'documentos', nombre: 'Documentos', icono: 'documento', plano: true, items: [{ id: 'documentos', nombre: 'Documentos', permiso: 'documentos' }] },
    { id: 'personas', nombre: 'Personas', icono: 'persona', items: [
      { id: 'personas', nombre: 'Personal', permiso: 'personas' }, { id: 'capacitaciones', nombre: 'Capacitaciones' }
    ] },
    { id: 'seguimiento', nombre: 'Seguimiento y mejora', icono: 'alerta', descripcion: 'Lo que hay que corregir', items: [
      { id: 'nc', nombre: 'No conformidades' }, { id: 'quejas', nombre: 'Quejas' },
      { id: 'auditorias', nombre: 'Auditorías internas' }, { id: 'revision', nombre: 'Revisión por la dirección' }
    ] },
    { id: 'medicion', nombre: 'Medición', icono: 'grafico', descripcion: 'Cómo vamos', items: [
      { id: 'indicadores', nombre: 'Indicadores' }, { id: 'objetivos', nombre: 'Objetivos de calidad' }
    ] },
    { id: 'sistema', nombre: 'El sistema', icono: 'escudo', descripcion: 'Cómo está definido el SGC', items: [
      { id: 'alcance', nombre: 'Alcance' }, { id: 'contexto', nombre: 'Contexto y partes interesadas' }, { id: 'procesos', nombre: 'Mapa de procesos' },
      { id: 'riesgos', nombre: 'Riesgos y oportunidades' }, { id: 'cobertura', nombre: 'Cobertura ISO' }
    ] },
    { id: 'operacion', nombre: 'Operación', icono: 'caja', items: [
      { id: 'servicios', nombre: 'Servicios prestados' }, { id: 'proveedores', nombre: 'Proveedores' }
    ] },
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', plano: true, items: [{ id: 'reportes', nombre: 'Reportes', permiso: 'cobertura' }] },
    { id: 'administracion', nombre: 'Administración', icono: 'llave', items: [{ id: 'accesos', nombre: 'Accesos' }] }
  ];
  var SECCIONES = {};
  ARQUITECTURA.forEach(function (g) { g.items.forEach(function (it) { SECCIONES[it.id] = true; }); });

  var secciones_ = null;           // mapa secciones_visibles que manda el backend
  var seccion_ = 'inicio', tipo_ = '', reporte_ = null;
  var persona_ = null, fichaSinListado_ = false;

  function partes(id) { return window.SigsoNav && SigsoNav.partes ? SigsoNav.partes(id) : { seccion: String(id || '').split(':')[0], argumento: String(id || '').split(':')[1] || '' }; }
  // ¿Puede abrir la sección? Única fuente: el mapa del backend. Sin mapa, todo
  // menos Accesos. Inicio, Documentos y Personas son de todos (adentro deciden).
  function puedeVer(llave) {
    if (llave === 'documentos' || llave === 'personas' || llave === 'inicio') return true;
    if (!secciones_) return llave !== 'accesos';
    return secciones_[llave] === true;
  }
  function supervisa() { return !!(secciones_ && secciones_.tablero === true); }
  function arquitectura() {
    var propia = !supervisa();
    return ARQUITECTURA.map(function (g) {
      var visibles = g.items.filter(function (it) { return puedeVer(it.permiso || partes(it.id).seccion); });
      if (g.id === 'personas' && propia) return { id: 'personas', nombre: 'Mi ficha', icono: g.icono, plano: true, items: [{ id: 'personas', nombre: 'Mi ficha', permiso: 'personas' }] };
      if (visibles.length === 1 && !g.plano) return { id: g.id, nombre: visibles[0].nombre, icono: g.icono, plano: true, items: [{ id: visibles[0].id, nombre: visibles[0].nombre, permiso: visibles[0].permiso }] };
      return g;
    });
  }
  function registrarArbol() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('calidad', { nombre: 'Calidad', submodulos: arquitectura(), visible: puedeVer });
  }
  function pintarNav() {
    registrarArbol();
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
  }
  function ruta() {
    if (seccion_ === 'documentos' && tipo_) return 'documentos:' + tipo_;
    if (seccion_ === 'reportes' && reporte_) return 'reportes:' + reporte_;
    return seccion_;
  }
  function publicar() { if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(ruta()); }

  var MODULOS = [
    [function () { return window.SigsoCalidadMejoraV2; }, 'mostrar'],
    [function () { return window.SigsoCalidadMedicionV2; }, 'mostrar'],
    [function () { return window.SigsoCalidadSistemaV2; }, 'mostrar'],
    [function () { return window.SigsoCalidadOperacionV2; }, 'mostrar']
  ];
  function render() {
    pintarNav();
    var v2 = window.SigsoCalidadV2;
    if (!v2) return;
    var s = seccion_;
    if (s === 'inicio' || s === 'tablero') { v2.mostrarInicio(); return; }
    if (s === 'documentos') { v2.mostrarDocumentos({ tipo: tipo_ }); return; }
    if (s === 'personas') {
      if (persona_ && window.SigsoCalidadFichaV2) SigsoCalidadFichaV2.abrir(persona_, fichaSinListado_);
      else v2.mostrarPersonas();
      return;
    }
    if (s === 'capacitaciones' && window.SigsoCalidadFichaV2) { SigsoCalidadFichaV2.mostrarCapacitaciones(); return; }
    if (s === 'reportes' && window.SigsoCalidadAdminV2) { SigsoCalidadAdminV2.mostrarReportes(reporte_); return; }
    if (s === 'accesos' && window.SigsoCalidadAdminV2) { SigsoCalidadAdminV2.mostrarAccesos(); return; }
    for (var i = 0; i < MODULOS.length; i++) {
      var m = MODULOS[i][0]();
      if (m && m.vistas.indexOf(s) !== -1) { m.mostrar(s); return; }
    }
    v2.mostrarInicio();
  }
  function irA(seccion, argumento) {
    var sec = seccion === 'tablero' ? 'inicio' : seccion;
    seccion_ = SECCIONES[sec] ? sec : 'inicio';
    tipo_ = seccion_ === 'documentos' ? (argumento || '') : '';
    reporte_ = seccion_ === 'reportes' ? (argumento || null) : null;
    persona_ = null;
    fichaSinListado_ = false;
    publicar();
    render();
  }

  window.SigsoCalidad = {
    cargar: function () {
      var pedida = window.SigsoShell && SigsoShell.tomarItemDeRuta ? SigsoShell.tomarItemDeRuta() : '';
      var p = pedida ? partes(pedida) : null;
      if (p && p.seccion) { irA(p.seccion, p.argumento); return; }
      publicar();
      render();
    },
    refrescar: function () { render(); },
    irAItem: function (id) { var p = partes(id); irA(p.seccion, p.argumento); },
    // Las pantallas v2 guardan su propio estado; al cambiar datos cada una se recarga sola.
    invalidar: function () {},
    usarSecciones: function (sv) { if (sv) { secciones_ = sv; pintarNav(); } },
    formulario: function (nombre, d, extra) { if (window.SigsoCalidadAdminV2) SigsoCalidadAdminV2.formulario(nombre, d, extra); },
    ver: function (documentoId, versionId) {
      var datos = { documento_id: documentoId };
      if (versionId) datos.version_id = versionId;
      window.SigsoCalidadV2.util.verArchivo('descargarDocumentoSgc', datos);
    },
    recargar: function () { render(); },
    abrirFicha: function (personaId, sinListado) {
      seccion_ = 'personas';
      persona_ = personaId;
      fichaSinListado_ = !!sinListado;
      if (window.SigsoCalidadFichaV2) SigsoCalidadFichaV2.abrir(personaId, !!sinListado);
    },
    formularioPersona: function () { if (window.SigsoCalidadFichaV2) SigsoCalidadFichaV2.nueva(); }
  };
  // Registro temprano del árbol: el sidebar dibuja la rama antes de entrar.
  registrarArbol();
})();
