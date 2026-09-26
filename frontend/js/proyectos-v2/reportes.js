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
    { grupo: 'Resumen', icono: 'diana', reportes: [
      { id: 'py-estado', nombre: 'Estado del portafolio', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'La conclusión, los proyectos que requieren decisión, el panorama y el detalle, en una sola lectura.',
        fuente: 'listarProyectos', filtros: ['responsable'], campos: CAMPOS }
    ] },
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

  // --- Estado del portafolio (anatomía en 4 niveles) --------------------------------
  var CERRADO = { CERRADO: true, CANCELADO: true };
  var SALUD = { critico: { t: 'Crítico', tono: 'critico', o: 0 }, riesgo: { t: 'En riesgo', tono: 'alerta', o: 1 }, normal: { t: 'Normal', tono: 'ok', o: 2 } };
  // "1 hito(s) vencido(s)" -> "1 hito vencido"; "5 tarea(s)" -> "5 tareas".
  function motivo(m) {
    var n = Number(String(m).match(/^\d+/));
    return String(m).replace(/\(s\)/g, n === 1 ? '' : 's').replace(/\(es\)/g, n === 1 ? '' : 'es');
  }
  function hoyISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function diasEntre(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

  function cuerpoEstado(todos) {
    var R = SigsoReportes, hoy = hoyISO();
    var ps = todos.filter(function (p) { return !CERRADO[p.estado]; });
    if (!ps.length) return R.nivel('En una línea', R.enUnaLinea({ estado: 'neutro', frase: 'No hay proyectos abiertos en este corte.' }));
    var criticos = ps.filter(function (p) { return p.salud === 'critico'; });
    var riesgo = ps.filter(function (p) { return p.salud === 'riesgo'; });
    var vencidos = ps.filter(function (p) { return p.fecha_objetivo && String(p.fecha_objetivo).slice(0, 10) < hoy; });
    var avMedio = Math.round(ps.reduce(function (s, p) { return s + (Number(p.avance_pct) || 0); }, 0) / ps.length);
    var ent = 0, aT = 0;
    ps.forEach(function (p) { var c = p.cumplimiento_tareas || {}; ent += c.entregadas || 0; aT += c.a_tiempo || 0; });
    var pctT = ent ? Math.round(aT / ent * 100) : null;

    // 1 · En una línea
    var estado = criticos.length || vencidos.length ? 'critico' : (riesgo.length ? 'alerta' : 'ok');
    var frase = 'De ' + plural(ps.length, 'proyecto abierto', 'proyectos abiertos') + ', ' +
      (criticos.length || riesgo.length
        ? [criticos.length ? plural(criticos.length, 'está crítico', 'están críticos') : '', riesgo.length ? plural(riesgo.length, 'en riesgo', 'en riesgo') : ''].filter(Boolean).join(' y ')
        : 'todos están sanos') +
      (vencidos.length ? '; ' + plural(vencidos.length, 'ya pasó su fecha objetivo', 'ya pasaron su fecha objetivo') : '') +
      '; el avance medio es ' + avMedio + ' %' + (pctT !== null ? ' y se entregó a tiempo el ' + pctT + ' % de las tareas' : '') + '.';
    var linea = R.enUnaLinea({ estado: estado, frase: frase, kpis: [
      { etiqueta: 'Críticos', valor: criticos.length, icono: 'alerta', tono: criticos.length ? 'critico' : 'ok', nota: 'de ' + ps.length + ' abiertos' },
      { etiqueta: 'En riesgo', valor: riesgo.length, icono: 'reloj', tono: riesgo.length ? 'alerta' : 'ok', nota: plural(ps.length - criticos.length - riesgo.length, 'sano', 'sanos') },
      { etiqueta: 'Avance medio', valor: avMedio, sufijo: '%', icono: 'tendencia', tono: 'primario', progreso: avMedio, nota: 'de los abiertos' },
      { etiqueta: 'Tareas a tiempo', valor: pctT === null ? '—' : pctT, sufijo: pctT === null ? '' : '%', icono: 'diana',
        tono: pctT === null ? 'neutro' : (pctT >= 90 ? 'ok' : (pctT >= 70 ? 'alerta' : 'critico')), progreso: pctT,
        nota: ent ? aT + ' de ' + ent + ' entregadas' : 'sin entregas medibles' }
    ] });

    // Del más grave al menos grave: salud del backend y, a igual salud, menor puntaje.
    function gravedad(a, b) {
      return ((SALUD[a.salud] || SALUD.normal).o - (SALUD[b.salud] || SALUD.normal).o) || ((a.salud_score || 0) - (b.salud_score || 0));
    }
    function diasVencido(p) { return vencidos.indexOf(p) === -1 ? 0 : diasEntre(String(p.fecha_objetivo).slice(0, 10), hoy); }

    // 2 · Lo que requiere decisión: un renglón por proyecto no sano o vencido. Sin
    // cifra propia (el puntaje de salud se leería como cantidad): el orden ya dice
    // cuál es más grave, y el motor ordena de forma estable.
    var alertas = ps.filter(function (p) { return p.salud !== 'normal' || diasVencido(p); }).sort(gravedad).map(function (p) {
      var d = diasVencido(p);
      return {
        severidad: p.salud === 'critico' || d ? 'critico' : 'alerta',
        titulo: p.nombre,
        detalle: [d ? 'venció hace ' + plural(d, 'día', 'días') : ''].concat((p.salud_motivos || []).slice(0, 3).map(motivo)).filter(Boolean).join(' · '),
        dueno: nombrePersona(p.lider_email)
      };
    });
    var decision = R.requiereDecision(alertas, { vacio: 'Todos los proyectos abiertos están sanos y dentro de plazo.' });

    // 3 · Panorama: composición del portafolio, no un renglón por proyecto (eso es
    // el detalle). Salud, plazo y avance en tramos.
    var en30 = new Date(); en30.setDate(en30.getDate() + 30);
    var lim30 = en30.getFullYear() + '-' + ('0' + (en30.getMonth() + 1)).slice(-2) + '-' + ('0' + en30.getDate()).slice(-2);
    function cuenta(fn) { return ps.filter(fn).length; }
    function fo(p) { return p.fecha_objetivo ? String(p.fecha_objetivo).slice(0, 10) : ''; }
    function barras(filas) {
      return R.ranking(filas.map(function (f) {
        return { etiqueta: f[0], valor: f[1], texto: f[1] + ' · ' + Math.round(f[1] / ps.length * 100) + '%', tono: f[2] };
      }), { max: ps.length, sinPosicion: true });
    }
    var sanos = ps.length - criticos.length - riesgo.length;
    var av = function (p) { return Number(p.avance_pct) || 0; };
    var panorama = '<div class="rp2-dos">' +
      '<div><h3 class="rp2-sub">Salud</h3>' + barras([
        ['Crítico', criticos.length, 'critico'], ['En riesgo', riesgo.length, 'alerta'], ['Sano', sanos, 'ok']]) +
      '<h3 class="rp2-sub">Plazo</h3>' + barras([
        ['Vencido', vencidos.length, 'critico'],
        ['Vence en 30 días', cuenta(function (p) { return fo(p) && fo(p) >= hoy && fo(p) <= lim30; }), 'alerta'],
        ['Con holgura', cuenta(function (p) { return fo(p) > lim30; }), 'ok'],
        ['Sin fecha objetivo', cuenta(function (p) { return !fo(p); }), 'neutro']]) + '</div>' +
      '<div><h3 class="rp2-sub">Avance</h3>' + barras([
        ['Sin empezar (0 %)', cuenta(function (p) { return av(p) === 0; }), 'neutro'],
        ['Hasta la mitad', cuenta(function (p) { return av(p) > 0 && av(p) < 50; }), 'primario'],
        ['Pasada la mitad', cuenta(function (p) { return av(p) >= 50 && av(p) < 100; }), 'primario'],
        ['Terminado (100 %)', cuenta(function (p) { return av(p) >= 100; }), 'ok']]) + '</div>' +
    '</div>';
    var bien = [];
    if (sanos) bien.push(plural(sanos, 'proyecto está sano', 'proyectos están sanos') + '.');
    var mejor = ps.filter(function (p) { return p.cumplimiento_tareas && p.cumplimiento_tareas.entregadas >= 3 && p.cumplimiento_tareas.pct === 100; })[0];
    if (mejor) bien.push(mejor.nombre + ' entregó a tiempo todas sus tareas (' + mejor.cumplimiento_tareas.entregadas + ').');
    panorama += R.loQueVaBien(bien);

    // 4 · Detalle. El motivo va bajo el nombre para que la tabla quepa sin
    // desplazamiento lateral.
    var filas = ps.slice().sort(gravedad).map(function (p) {
      var s = SALUD[p.salud] || SALUD.normal, c = p.cumplimiento_tareas || {}, f = fo(p);
      var sub = [p.codigo].concat((p.salud_motivos || []).slice(0, 1).map(motivo)).filter(Boolean).join(' · ');
      return {
        proyecto: '<span class="rp2-item"><strong>' + U.esc(p.nombre) + '</strong><small>' + U.esc(sub) + '</small></span>',
        lider: U.esc(nombrePersona(p.lider_email) || '—'),
        salud: U.badge(s.t, s.tono, true),
        avance: Math.round(av(p)) + '%',
        tareas: c.pct === null || c.pct === undefined ? '—' : c.pct + '%',
        objetivo: f ? (f < hoy ? U.badge('Venció ' + PY.fecha(f, true), 'critico', true) : U.esc(PY.fecha(f, true))) : '—'
      };
    });
    var detalle = '<div class="rp2-detalle">' + R.tabla([
      { campo: 'proyecto', titulo: 'Proyecto', html: true }, { campo: 'lider', titulo: 'Líder', html: true },
      { campo: 'salud', titulo: 'Salud', html: true }, { campo: 'avance', titulo: 'Avance', alinear: 'derecha' },
      { campo: 'tareas', titulo: 'A tiempo', alinear: 'derecha' }, { campo: 'objetivo', titulo: 'Fecha objetivo', html: true }
    ], filas) + '</div>';

    return R.nivel('En una línea', linea) +
      R.nivel('Lo que requiere decisión', decision, { nota: alertas.length ? plural(alertas.length, 'proyecto', 'proyectos') + ' · del más grave al menos grave' : '' }) +
      R.nivel('Panorama', panorama) +
      R.nivel('Detalle · del más grave al menos grave', detalle, { clase: 'rp2-nivel--detalle', nota: plural(ps.length, 'proyecto abierto', 'proyectos abiertos') });
  }

  var CUERPOS = {
    'py-estado': cuerpoEstado,
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
