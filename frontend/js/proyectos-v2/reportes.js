/**
 * proyectos-v2/reportes.js — Proyectos · Centro de reportes (v2).
 *
 * Reemplaza la vista de Reportes de proyectos.js (v1): mismos cinco reportes,
 * misma fuente (listarProyectos, ya filtrado por permisos en el backend) y el
 * mismo motor compartido (SigsoReportes, que en la plataforma es reportes-v2).
 *
 * EL PERIODO NO CORTA POR LO MISMO EN TODOS. La unidad es el PROYECTO, así que
 * la fecha depende de la pregunta: casi todos miran cuándo EMPEZÓ, pero
 * "Plazos" habla de la fecha OBJETIVO. Cada reporte declara su campo y la
 * etiqueta lo dice en pantalla. No hay filtro de estado ni de salud: la barra
 * del portafolio ya los tiene, y dos filtros de lo mismo se contradicen.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = window.UIv2;

  var CAMPOS = { responsable: 'lider_email' };
  var REPORTES = [
    { grupo: 'Estado del portafolio', icono: 'escudo', reportes: [
      { id: 'py-salud', nombre: 'Salud del portafolio', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Cuántos proyectos están normales, en riesgo o críticos, y por qué.',
        fuente: 'listarProyectos', filtros: ['periodo', 'responsable'],
        etiquetaPeriodo: 'Proyectos iniciados en', campoFecha: 'fecha_inicio', campos: CAMPOS },
      { id: 'py-avance', nombre: 'Avance por proyecto', tipo: 'RANKING', estado: 'LISTO',
        desc: 'Porcentaje de avance de cada proyecto, del más adelantado al más atrasado.',
        fuente: 'listarProyectos', filtros: ['periodo', 'responsable'],
        etiquetaPeriodo: 'Proyectos iniciados en', campoFecha: 'fecha_inicio', campos: CAMPOS },
      { id: 'py-plazos', nombre: 'Plazos', tipo: 'DETALLE', estado: 'LISTO',
        desc: 'Proyectos con fecha objetivo vencida o próxima a vencer.',
        fuente: 'listarProyectos', filtros: ['periodo', 'responsable'],
        etiquetaPeriodo: 'Con fecha objetivo en', campoFecha: 'fecha_objetivo', campos: CAMPOS }
    ] },
    { grupo: 'Personas', icono: 'persona', reportes: [
      // Sin 'responsable': el reporte YA desagrega por líder.
      { id: 'py-lider', nombre: 'Carga por líder', tipo: 'RANKING', estado: 'LISTO',
        desc: 'Cuántos proyectos lidera cada persona y cuántos de ellos no están sanos.',
        fuente: 'listarProyectos', filtros: ['periodo'],
        etiquetaPeriodo: 'Proyectos iniciados en', campoFecha: 'fecha_inicio', campos: CAMPOS },
      { id: 'py-cumplimiento', nombre: 'Cumplimiento de tareas', tipo: 'CUMPLIMIENTO', estado: 'LISTO',
        desc: 'Tareas entregadas dentro de su fecha comprometida, proyecto por proyecto.',
        fuente: 'listarProyectos', filtros: ['periodo', 'responsable'],
        etiquetaPeriodo: 'Proyectos iniciados en', campoFecha: 'fecha_inicio', campos: CAMPOS }
    ] }
  ];

  var abierto_ = null;
  var filtros_ = {};

  function registrar() {
    if (!window.SigsoReportes || registrar.hecho) return;
    SigsoReportes.registrar('proyectos', {
      titulo: 'Reportes del portafolio',
      nota: 'Se arman con los proyectos que ya puedes ver: el filtrado por permisos ' +
        'lo hace el backend, y estos reportes trabajan sobre ese mismo conjunto.',
      grupos: REPORTES
    });
    registrar.hecho = true;
  }

  function vacio(texto) { return U.vacio({ icono: 'grafico', texto: texto }); }
  function etiquetaEstado(e) { return (PY.ETIQUETA_ESTADO_PROYECTO || {})[e] || e; }
  function nombrePersona(email) {
    var p = email && PY.persona ? PY.persona(email) : null;
    return (p && p.nombre) || email;
  }

  // --- Cuerpos (misma lógica que v1) ---------------------------------------------
  function cuerpoSalud(ps) {
    if (!ps.length) return vacio('No hay proyectos que mostrar.');
    var porSalud = { normal: 0, riesgo: 0, critico: 0 };
    ps.forEach(function (p) { if (porSalud[p.salud] !== undefined) porSalud[p.salud]++; });
    return SigsoReportes.kpis([
      { etiqueta: 'Proyectos', valor: ps.length },
      { etiqueta: 'Normales', valor: porSalud.normal },
      { etiqueta: 'En riesgo', valor: porSalud.riesgo, alerta: porSalud.riesgo > 0 },
      { etiqueta: 'Críticos', valor: porSalud.critico, alerta: porSalud.critico > 0 }
    ]) +
    '<h3>Los que no están sanos</h3>' +
    SigsoReportes.tabla([
      { campo: 'codigo', titulo: 'Código' },
      { campo: 'nombre', titulo: 'Proyecto' },
      { campo: 'salud_etiqueta', titulo: 'Salud' },
      { campo: 'motivos', titulo: 'Por qué' }
    ], ps.filter(function (p) { return p.salud !== 'normal'; }).map(function (p) {
      return { codigo: p.codigo, nombre: p.nombre, salud_etiqueta: p.salud_etiqueta,
        motivos: (p.salud_motivos || []).join(' · ') };
    }), { vacio: 'Todos los proyectos están sanos.' });
  }

  function cuerpoAvance(ps) {
    if (!ps.length) return vacio('No hay proyectos que mostrar.');
    var ordenados = ps.slice().sort(function (a, b) { return (b.avance_pct || 0) - (a.avance_pct || 0); });
    return SigsoReportes.ranking(ordenados.map(function (p) {
      return { etiqueta: p.codigo + ' — ' + p.nombre, valor: p.avance_pct || 0, texto: (p.avance_pct || 0) + '%' };
    })) +
    '<h3>Detalle</h3>' +
    SigsoReportes.tabla([
      { campo: 'codigo', titulo: 'Código' },
      { campo: 'nombre', titulo: 'Proyecto' },
      { campo: 'estado', titulo: 'Estado' },
      { campo: 'avance', titulo: 'Avance', alinear: 'derecha' },
      { campo: 'total_tareas', titulo: 'Tareas', alinear: 'derecha' }
    ], ordenados.map(function (p) {
      return { codigo: p.codigo, nombre: p.nombre, estado: etiquetaEstado(p.estado),
        avance: (p.avance_pct || 0) + '%', total_tareas: p.total_tareas };
    }));
  }

  function cuerpoPlazos(ps) {
    var hoy = new Date();
    var en30 = new Date(hoy.getTime() + 30 * 86400000);
    // Solo proyectos VIVOS: uno cerrado con fecha pasada no es un atraso.
    var vivos = ps.filter(function (p) { return p.estado !== 'CERRADO' && p.estado !== 'CANCELADO' && p.fecha_objetivo; });
    var conPlazo = vivos.map(function (p) {
      var f = new Date(p.fecha_objetivo);
      var dias = Math.round((f - hoy) / 86400000);
      var invalida = isNaN(f.getTime());
      return {
        codigo: p.codigo, nombre: p.nombre, estado: etiquetaEstado(p.estado), fecha_objetivo: p.fecha_objetivo,
        situacion: invalida ? 'fecha inválida'
          : (dias < 0 ? 'vencido hace ' + Math.abs(dias) + ' días' : (f <= en30 ? 'vence en ' + dias + ' días' : 'a tiempo')),
        dias: invalida ? 9999 : dias
      };
    }).sort(function (a, b) { return a.dias - b.dias; });
    var vencidos = conPlazo.filter(function (p) { return p.dias < 0; });
    var porVencer = conPlazo.filter(function (p) { return p.dias >= 0 && p.dias <= 30; });
    return SigsoReportes.kpis([
      { etiqueta: 'Con fecha objetivo', valor: conPlazo.length },
      { etiqueta: 'Vencidos', valor: vencidos.length, alerta: vencidos.length > 0 },
      { etiqueta: 'Vencen en 30 días', valor: porVencer.length, alerta: porVencer.length > 0 },
      { etiqueta: 'Sin fecha objetivo', valor: ps.length - vivos.length,
        titulo: 'Incluye los cerrados y cancelados, que no cuentan como atraso.' }
    ]) +
    SigsoReportes.tabla([
      { campo: 'codigo', titulo: 'Código' },
      { campo: 'nombre', titulo: 'Proyecto' },
      { campo: 'estado', titulo: 'Estado' },
      { campo: 'fecha_objetivo', titulo: 'Fecha objetivo' },
      { campo: 'situacion', titulo: 'Situación' }
    ], conPlazo, { vacio: 'Ningún proyecto activo tiene fecha objetivo definida.' });
  }

  // El cumplimiento lo calcula el backend (calcularCumplimientoTareasProyecto_):
  // solo tareas ENTREGADAS con fecha de compromiso. pct null = sin entregas
  // medibles, que NO es 0 %.
  function cuerpoCumplimiento(ps) {
    if (!ps.length) return vacio('No hay proyectos que mostrar.');
    var conDato = ps.filter(function (p) { return p.cumplimiento_tareas; });
    if (!conDato.length) return vacio('Ningún proyecto tiene todavía tareas para medir.');
    var medibles = conDato.filter(function (p) { return p.cumplimiento_tareas.pct !== null; });
    var ordenados = medibles.slice().sort(function (a, b) { return b.cumplimiento_tareas.pct - a.cumplimiento_tareas.pct; });
    return SigsoReportes.kpis([
      { etiqueta: 'Proyectos', valor: conDato.length },
      { etiqueta: 'Ya medibles', valor: medibles.length,
        titulo: 'Solo se puede medir donde hay tareas entregadas con fecha de compromiso.' },
      { etiqueta: 'Tareas sin comprometer',
        valor: conDato.reduce(function (s, p) { return s + p.cumplimiento_tareas.sin_comprometer; }, 0) }
    ]) +
    SigsoReportes.ranking(ordenados.map(function (p) {
      return { etiqueta: p.codigo + ' — ' + p.nombre, valor: p.cumplimiento_tareas.pct, texto: p.cumplimiento_tareas.pct + '%' };
    }), { vacio: 'Ningún proyecto tiene todavía tareas entregadas con fecha de compromiso.' }) +
    '<h3>Detalle</h3>' +
    SigsoReportes.tabla([
      { campo: 'codigo', titulo: 'Código' },
      { campo: 'nombre', titulo: 'Proyecto' },
      { campo: 'total', titulo: 'Tareas', alinear: 'derecha' },
      { campo: 'entregadas', titulo: 'Entregadas', alinear: 'derecha' },
      { campo: 'aTiempo', titulo: 'A tiempo', alinear: 'derecha' },
      { campo: 'pct', titulo: 'Cumplimiento', alinear: 'derecha' }
    ], conDato.map(function (p) {
      var c = p.cumplimiento_tareas;
      return { codigo: p.codigo, nombre: p.nombre, total: c.total, entregadas: c.entregadas,
        aTiempo: c.a_tiempo, pct: c.pct === null ? 'sin entregas' : c.pct + '%' };
    }));
  }

  function cuerpoPorLider(ps) {
    if (!ps.length) return vacio('No hay proyectos que mostrar.');
    var porLider = {};
    ps.forEach(function (p) {
      var k = p.lider_email || '';
      if (!porLider[k]) porLider[k] = { total: 0, noSanos: 0 };
      porLider[k].total++;
      if (p.salud !== 'normal') porLider[k].noSanos++;
    });
    var filas = Object.keys(porLider).map(function (k) {
      return { etiqueta: k ? nombrePersona(k) : '(sin líder)', total: porLider[k].total, noSanos: porLider[k].noSanos };
    }).sort(function (a, b) { return b.total - a.total; });
    return SigsoReportes.kpis([
      { etiqueta: 'Líderes', valor: filas.length },
      { etiqueta: 'Proyectos', valor: ps.length }
    ]) +
    SigsoReportes.ranking(filas.map(function (f) { return { etiqueta: f.etiqueta, valor: f.total, texto: f.total }; })) +
    '<h3>Detalle</h3>' +
    SigsoReportes.tabla([
      { campo: 'etiqueta', titulo: 'Líder' },
      { campo: 'total', titulo: 'Proyectos', alinear: 'derecha' },
      { campo: 'noSanos', titulo: 'En riesgo o críticos', alinear: 'derecha' }
    ], filas);
  }

  var CUERPOS = {
    'py-salud': cuerpoSalud, 'py-avance': cuerpoAvance, 'py-plazos': cuerpoPlazos,
    'py-lider': cuerpoPorLider, 'py-cumplimiento': cuerpoCumplimiento
  };

  // --- Vista -----------------------------------------------------------------------
  function cargar() {
    registrar();
    return PY.api('listarProyectos', {}).then(function (r) {
      if (!r || !r.ok) return { error: (r && r.message) || 'No se pudo cargar el portafolio.', proyectos: [] };
      return { proyectos: r.data || [] };
    });
  }

  function pintar(d) {
    return '<header class="sx2-cabecera sx2-entra">' +
        '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Proyectos</span>' +
        '<h1>Reportes</h1><span class="sx2-tenue" style="font-size:.875rem">Estado y avance del portafolio, listos para imprimir o descargar.</span></div>' +
      '</header>' +
      (d.error ? U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: d.error })
        : '<div class="js-py2-reportes sx2-entra"></div>');
  }

  function pintarEn(cont, proyectos) {
    if (!window.SigsoReportes) { cont.innerHTML = vacio('El motor de reportes no está disponible.'); return; }
    if (!abierto_) {
      SigsoReportes.pintarCatalogo({
        contenedor: cont,
        modulo: 'proyectos',
        onAbrir: function (id) { abierto_ = id; filtros_ = {}; pintarEn(cont, proyectos); window.scrollTo(0, 0); },
        onIrASeccion: function (vista) { if (window.SigsoProyectosV2) SigsoProyectosV2.irAItem(vista); }
      });
      return;
    }
    var r = SigsoReportes.buscarReporte('proyectos', abierto_);
    if (!r) { abierto_ = null; pintarEn(cont, proyectos); return; }
    // Las opciones salen de TODOS los proyectos: si salieran de los ya
    // filtrados, elegir un líder borraría a los demás del desplegable.
    var opciones = SigsoReportes.opcionesDeItems(proyectos, r.campos || {});
    var ps = SigsoReportes.filtrarItems(proyectos, filtros_, { campoFecha: r.campoFecha, campos: r.campos });
    cont.innerHTML =
      SigsoReportes.barraAcciones({}) +
      SigsoReportes.cabeceraDocumento({
        titulo: r.nombre,
        subtitulo: r.desc,
        modulo: 'Proyectos — Portafolio',
        codigo: 'SIGSO-REP-PY-' + String(r.id).replace(/^[a-z]+-/, '').toUpperCase(),
        generadoPor: (PY.miNombre && PY.miNombre()) || '',
        filtros: SigsoReportes.filtrosParaCabecera(r, opciones, filtros_)
      }) +
      SigsoReportes.pintarFiltros(r, opciones, filtros_) +
      (CUERPOS[r.id] ? CUERPOS[r.id](ps) : '') +
      SigsoReportes.pieDocumento();
    SigsoReportes.wireAcciones(cont, {
      nombreArchivo: 'sigso-proyectos-' + r.id,
      onVolver: function () { abierto_ = null; filtros_ = {}; pintarEn(cont, proyectos); }
    });
    SigsoReportes.alAplicarFiltros(cont, function (valores) { filtros_ = valores; pintarEn(cont, proyectos); });
  }

  function alMontar(raiz, d) {
    var cont = raiz.querySelector('.js-py2-reportes');
    if (cont) pintarEn(cont, d.proyectos);
  }

  PY.vistas.reportes = {
    cargar: cargar, pintar: pintar, alMontar: alMontar,
    correos: function (d) { return (d.proyectos || []).map(function (p) { return p.lider_email; }); },
    // Entrar desde el árbol o la URL abre el catálogo; un refresco de fondo
    // (recargarVista) conserva el reporte que se está leyendo.
    reiniciar: function () { abierto_ = null; filtros_ = {}; }
  };
})();
