/**
 * proyectos-v2/mitrabajo.js — "Mi trabajo": lo que me toca a MÍ en todo
 * SIGSO, en un solo lugar (decisión 2026-09-24: un solo Mi trabajo). Reúne:
 *  - las tareas de todos mis proyectos (responsable o colaborador), y
 *  - mis compromisos personales (actividades sin proyecto: propios, no
 *    planificados, asignados por mi jefatura, recurrentes).
 * Siempre personal, también para ADM/Gerencia: el trabajo del equipo vive en
 * Mi departamento y en Gerencia.
 *
 * Se pinta en dos lugares con la MISMA vista (un "host" le dice dónde):
 *  - el módulo "Mi trabajo" del shell (SigsoMiTrabajoV2, #actividades-contenido);
 *  - Proyectos → Mi trabajo (PY.vistas.mitrabajo), solo para cuentas que no
 *    tienen el módulo; las demás van al módulo.
 *
 * - Mis tareas: agrupadas por urgencia, "Confirmar fecha" cuando una tarea
 *   asignada espera confirmación, y el panel único para actualizar (tarea de
 *   proyecto o compromiso personal, misma acción actualizarTareaProyecto).
 * - Mis horas: mapa de calor de 14 días por proyecto (y "Personales"), solo
 *   lectura; un día lleva al panel de la tarea para corregirlo.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var DIAS = 14;
  var PERSONAL = '__personal';
  var TAMANO = { S: 'Chica (~2 h)', M: 'Mediana (~1 día)', L: 'Grande (~3 días)', XL: 'Muy grande (~1 semana+)' };
  var f = { modo: 'lista', filtro: '', proyecto: '' };
  try { f.modo = localStorage.getItem('sigso_py2_modo_mitrabajo') || 'lista'; } catch (e) { /* sin storage */ }
  var grafico_ = null;

  // Dónde se está pintando la vista (ver cabecera del archivo).
  var hostProyectos = {
    migas: 'Proyectos',
    pintar: function (o) { PY.pintar(o); },
    recargar: function () { PY.recargarVista(); },
    abrirProyecto: function (id, seccion) { PY.abrirProyecto(id, { seccion: seccion || undefined }); }
  };
  var host_ = hostProyectos;

  function clave(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function diffDias(k, hoy) {
    if (!k) return null;
    var a = k.split('-').map(Number), b = hoy.split('-').map(Number);
    return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000);
  }
  function sumarDias(k, n) {
    var p = k.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  var fmtSantiago = (function () {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: (window.SIGSO_CONFIG || {}).TIMEZONE || 'America/Santiago' }); } catch (e) { return null; }
  })();
  function claveLocal(v) { var d = new Date(v); return isNaN(d.getTime()) ? '' : (fmtSantiago ? fmtSantiago.format(d) : clave(v)); }
  function cuando(dd) {
    if (dd === null) return 'Sin fecha';
    if (dd < 0) return 'Venció hace ' + (-dd) + (dd === -1 ? ' día' : ' días');
    if (dd === 0) return 'Vence hoy';
    if (dd === 1) return 'Vence mañana';
    return 'En ' + dd + ' días';
  }
  function abierta(a) { return a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA'; }
  function porConfirmar(a) { return !!a.fecha_propuesta && !a.confirmada_en && abierta(a); }
  function grupoDe(a) { return a.personal ? PERSONAL : a.proyecto_id; }
  function nombreGrupo(a) { return a.personal ? 'Personales' : a.proyecto_nombre; }

  function cargar() {
    return Promise.all([
      PY.api('listarMisTareasProyectos', { incluir_personales: true }),
      PY.api('listarMiBitacoraProyectos', { incluir_personales: true }),
      PY.api('listarProyectos', {}),
      PY.cargarMiPerfil(),
      // Módulo 3B: los ítems de solicitudes a mi cargo (abiertos).
      PY.api('getColaSolicitudes', { solo_mios: true })
    ]).then(function (r) {
      var d = (r[0] && r[0].ok && r[0].data) || { tareas: [], entregables: [] };
      var yo = PY.miEmail();
      // Proyectos donde puedo crearme una tarea: activos y donde participo
      // (ADM puede en cualquiera, igual que en el backend).
      var esAdm = PY.miRol() === 'ADM';
      var proyectos = ((r[2] && r[2].ok && r[2].data) || []).filter(function (p) {
        if (p.estado === 'CERRADO' || p.estado === 'CANCELADO') return false;
        if (esAdm) return true;
        if (String(p.lider_email || '').toLowerCase() === yo) return true;
        return (p.integrantes || []).some(function (i) { return String(i.email || '').toLowerCase() === yo; });
      }).map(function (p) { return { id: p.proyecto_id, nombre: p.nombre }; });
      return {
        tareas: d.tareas || [], entregables: d.entregables || [], proyectos: proyectos,
        bitacora: (r[1] && r[1].ok) ? (r[1].data || []) : [],
        solicitudes: (r[4] && r[4].ok && r[4].data && r[4].data.items) || [],
        errorSolicitudes: !(r[4] && r[4].ok),
        error: !(r[0] && r[0].ok) ? ((r[0] && r[0].message) || 'No se pudo cargar tu trabajo.') : ''
      };
    });
  }

  // --- Lista ------------------------------------------------------------------------
  function grupos(tareas, hoy) {
    // Una fecha por confirmar todavía no es un compromiso: va a su propio
    // grupo y no cuenta como atrasada (mismo criterio que el Inicio).
    var g = { confirmar: [], atrasadas: [], semana: [], despues: [], sinFecha: [] };
    tareas.forEach(function (a) {
      var dd = diffDias(clave(a.fecha_compromiso || a.fecha_propuesta), hoy);
      a._dd = dd;
      if (porConfirmar(a)) g.confirmar.push(a);
      else if (a.semaforo === 'atrasada' || (dd !== null && dd < 0)) g.atrasadas.push(a);
      else if (dd === null) g.sinFecha.push(a);
      else if (dd <= 7) g.semana.push(a);
      else g.despues.push(a);
    });
    return g;
  }

  function chipOrigen(a) {
    if (a.personal) {
      return '<span class="sx2-py-ref sx2-py-ref--personal">' + U.ico('persona', 12) + '<span class="sx2-cortar">' + U.esc(a.proyecto_texto || 'Personal') + '</span></span>';
    }
    return '<button type="button" class="sx2-py-ref" data-py2-proyecto="' + U.esc(a.proyecto_id) + '" title="Abrir el proyecto">' + U.ico('carpeta', 12) + '<span class="sx2-cortar">' + U.esc(a.proyecto_nombre) + '</span></button>';
  }

  function fila(a, i) {
    var tono = PY.tonoTarea(a);
    var av = Number(a.avance_pct) || 0;
    var confirmar = porConfirmar(a);
    return '<li class="sx2-py-mt-fila sx2-tono-' + tono + ' sx2-entra" style="--i:' + Math.min(i, 12) + '" data-py2-mt="' + U.esc(a.actividad_id) + '" tabindex="0">' +
      '<span class="sx2-py-punto"></span>' +
      '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1">' +
        '<strong class="sx2-cortar">' + U.esc(a.titulo) + '</strong>' +
        '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + chipOrigen(a) +
          U.badge(a.semaforo_etiqueta || a.estado, tono) +
          (a.soy_responsable === false ? U.badge('Colaboras', 'info', true) : '') +
          (a.origen === 'EMERGENTE' ? U.badge('No planificado', 'neutro', true) : '') +
          (a.recurrencia && a.recurrencia !== 'NINGUNA' ? U.badge(a.recurrencia === 'SEMANAL' ? '↻ semanal' : '↻ mensual', 'neutro', true) : '') +
          (a.prioridad === 'P1' || a.prioridad === 'P2' ? U.badge(a.prioridad, a.prioridad === 'P1' ? 'critico' : 'alerta', true) : '') +
        '</span>' +
        (a.estado === 'BLOQUEADA' && a.bloqueo_motivo ? '<span class="sx2-py-mt-bloqueo">' + U.ico('candado', 12) + U.esc(a.bloqueo_motivo) + '</span>' : '') +
      '</span>' +
      '<span class="sx2-py-mt-cuando' + (a._dd !== null && a._dd < 0 ? ' sx2-delta--mal' : '') + '">' +
        (confirmar ? 'Te proponen el ' + PY.fecha(a.fecha_propuesta) : U.esc(cuando(a._dd))) +
        (confirmar ? '' : '<span class="sx2-py-mt-avance">' + U.barra(av, tono) + '<small>' + Math.round(av) + '%</small></span>') + '</span>' +
      (confirmar
        ? '<span class="sx2-flex" style="gap:6px;flex:none">' +
            U.boton({ texto: 'Otra fecha', sm: true, clase: 'js-py2m-otra', datos: { id: a.actividad_id } }) +
            U.boton({ texto: 'Confirmar', icono: 'check', sm: true, variante: 'primario', clase: 'js-py2m-confirmar', datos: { id: a.actividad_id } }) +
          '</span>'
        : U.boton({ texto: 'Actualizar', icono: 'tendencia', sm: true, variante: 'primario', clase: 'js-py2m-actualizar', datos: { id: a.actividad_id } })) +
    '</li>';
  }

  function tarjetaGrupo(titulo, icono, tono, lista, i, vacio) {
    if (!lista.length && !vacio) return '';
    return '<section class="sx2-card sx2-entra" style="--i:' + i + '">' +
      '<div class="sx2-card__cab"><h2 class="sx2-card__titulo"><span class="sx2-py-mt-ico sx2-tono-' + tono + '">' + U.ico(icono, 15) + '</span>' + U.esc(titulo) +
        ' <span class="sx2-card__sub">' + lista.length + '</span></h2></div>' +
      (lista.length ? '<ul class="sx2-py-mt-lista">' + lista.map(fila).join('') + '</ul>' : U.vacio({ icono: 'check', texto: vacio })) +
    '</section>';
  }

  var MAX_SOL = 6;
  function tarjetaSolicitudes(d, i, todas) {
    var B = window.SigsoBandejaV2;
    if (!B) return '';
    if (d.errorSolicitudes) {
      return '<section class="sx2-card sx2-py-mt-sol sx2-entra" style="--i:' + i + '">' + U.vacio({ icono: 'alerta', titulo: 'No se pudieron revisar tus solicitudes', texto: 'Tus tareas sí están al día en esta pantalla. Actualiza para reintentar.' }) + '</section>';
    }
    if (!d.solicitudes.length) return '';
    var lista = B.ordenarMios(d.solicitudes);
    var r = B.resumenMios(lista);
    var visibles = todas ? lista : lista.slice(0, MAX_SOL);
    var partes = [];
    if (r.fuera) partes.push(r.fuera + ' fuera de plazo');
    if (r.recibir) partes.push(r.recibir + ' por recibir');
    if (r.respondieron) partes.push(r.respondieron + (r.respondieron === 1 ? ' con respuesta nueva' : ' con respuestas nuevas'));
    if (r.sinFecha) partes.push(r.sinFecha + ' sin fecha comprometida');
    var bandeja = window.SigsoShell && SigsoShell.tieneModulo && SigsoShell.tieneModulo('bandeja');
    return '<section class="sx2-card sx2-py-mt-sol sx2-entra" style="--i:' + i + '">' +
      '<div class="sx2-card__cab"><h2 class="sx2-card__titulo"><span class="sx2-py-mt-ico sx2-tono-hito">' + U.ico('bandeja', 15) + '</span>Solicitudes a tu cargo' +
        ' <span class="sx2-card__sub">' + lista.length + '</span></h2>' +
        (bandeja ? U.boton({ texto: 'Abrir la Bandeja', icono: 'derecha', sm: true, variante: 'fantasma', clase: 'js-py2m-bandeja' }) : '') + '</div>' +
      (partes.length ? '<p class="sx2-tenue" style="margin:0 0 8px;font-size:.8125rem">' + U.esc(partes.join(' · ')) + '</p>' : '') +
      '<ul class="sx2-py-mt-lista">' + visibles.map(B.filaMia).join('') + '</ul>' +
      (lista.length > visibles.length ? '<div style="text-align:center;padding-top:8px">' + U.boton({ texto: 'Ver las ' + lista.length, icono: 'abajo', sm: true, variante: 'fantasma', clase: 'js-py2m-todas-sol' }) + '</div>' : '') +
    '</section>';
  }

  function filtrar(d) {
    return d.tareas.filter(abierta).filter(function (a) {
      if (f.proyecto && grupoDe(a) !== f.proyecto) return false;
      if (f.filtro === 'bloqueadas') return a.estado === 'BLOQUEADA';
      if (f.filtro === 'confirmar') return porConfirmar(a);
      return true;
    });
  }

  function vistaLista(d, hoy) {
    var lista = filtrar(d);
    var g = grupos(lista, hoy);
    var soloGrupo = f.filtro === 'atrasadas' ? 'atrasadas' : (f.filtro === 'semana' ? 'semana' : '');
    var confirmar = f.filtro === 'confirmar';
    var cuerpo;
    if (f.filtro === 'solicitudes') {
      cuerpo = tarjetaSolicitudes(d, 2, true) || U.card({ cuerpo: U.vacio({ icono: 'check', texto: 'No tienes solicitudes a tu cargo.' }) });
    } else if (!d.tareas.filter(abierta).length) {
      cuerpo = U.card({ cuerpo: U.vacio({ icono: 'check', titulo: 'No tienes tareas abiertas',
        texto: 'Cuando te asignen una tarea aparecerá aquí. También puedes anotar un compromiso propio con "Nueva tarea".' }) }) +
        (!f.proyecto && !f.filtro ? tarjetaSolicitudes(d, 3) : '');
    } else if (confirmar) {
      cuerpo = tarjetaGrupo('Esperan que confirmes la fecha', 'calendario', 'primario', lista, 2, 'Nada por confirmar.');
    } else {
      cuerpo = (!soloGrupo ? tarjetaGrupo('Esperan que confirmes la fecha', 'check', 'info', g.confirmar, 2) : '') +
        ((!soloGrupo || soloGrupo === 'atrasadas') ? tarjetaGrupo('Atrasadas', 'alerta', 'critico', g.atrasadas, 2, soloGrupo ? 'Nada atrasado. ¡Bien!' : '') : '') +
        ((!soloGrupo || soloGrupo === 'semana') ? tarjetaGrupo('Esta semana', 'calendario', 'primario', g.semana, 3, soloGrupo ? 'Nada vence en los próximos 7 días.' : '') : '') +
        (!f.filtro && !f.proyecto ? tarjetaSolicitudes(d, 4) : '') +
        (!soloGrupo ? tarjetaGrupo('Más adelante', 'reloj', 'info', g.despues, 4) + tarjetaGrupo('Sin fecha', 'estado', 'neutro', g.sinFecha, 5) : '');
    }

    // Terminadas en los últimos 7 días: se archivan solas, pero se pueden ver.
    var hechas = d.tareas.filter(function (a) {
      if (a.estado !== 'TERMINADA' || !a.fecha_terminada) return false;
      var dd = diffDias(clave(a.fecha_terminada), hoy);
      return dd !== null && dd >= -7 && (!f.proyecto || grupoDe(a) === f.proyecto);
    });
    if (hechas.length && !f.filtro) {
      cuerpo += '<details class="sx2-card sx2-py-mt-hechas sx2-entra" style="--i:6"><summary>' + U.ico('check', 15) + 'Terminadas esta semana <span class="sx2-card__sub">' + hechas.length + '</span></summary>' +
        '<ul class="sx2-py-mt-lista">' + hechas.map(function (a) {
          return '<li class="sx2-py-mt-fila sx2-tono-ok" data-py2-mt="' + U.esc(a.actividad_id) + '" tabindex="0"><span class="sx2-py-punto"></span>' +
            '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(a.titulo) + '</strong><span class="sx2-flex">' + chipOrigen(a) + '</span></span>' +
            '<span class="sx2-py-mt-cuando">Terminada el ' + PY.fecha(a.fecha_terminada) + '</span></li>';
        }).join('') + '</ul></details>';
    }

    var ents = d.entregables.filter(function (e) { return !f.proyecto || e.proyecto_id === f.proyecto; });
    var entHtml = ents.length ? '<ul class="sx2-py-entregables">' + ents.map(function (e) {
      var dd = diffDias(clave(e.fecha_comprometida), hoy);
      var tono = e.estado === 'OBSERVADO' ? 'alerta' : (dd !== null && dd < 0 ? 'critico' : (e.estado === 'ENTREGADO' ? 'primario' : 'neutro'));
      return '<li class="sx2-py-entregable sx2-tono-' + tono + '">' +
        '<strong class="sx2-py-entregable__nombre">' + U.esc(e.nombre) + '</strong>' +
        '<div class="sx2-py-entregable__meta"><button type="button" class="sx2-py-ref" data-py2-proyecto="' + U.esc(e.proyecto_id) + '" data-seccion="archivos">' + U.ico('carpeta', 12) + '<span class="sx2-cortar">' + U.esc(e.proyecto_nombre) + '</span></button>' +
          '<span class="' + (dd !== null && dd < 0 ? 'sx2-delta--mal' : 'sx2-tenue') + '">' + U.esc(cuando(dd)) + '</span></div>' +
        (e.estado === 'OBSERVADO' ? U.badge('Observado: corregir', 'alerta') : (e.estado === 'ENTREGADO' ? U.badge('Esperando revisión', 'primario') : '')) +
      '</li>';
    }).join('') + '</ul>' : U.vacio({ icono: 'bandera', texto: 'Sin entregables pendientes.' });

    // Dónde está mi carga: tareas abiertas por proyecto (y personales).
    var porProy = {};
    d.tareas.filter(abierta).forEach(function (a) {
      var k = grupoDe(a);
      var x = porProy[k] || (porProy[k] = { id: k, nombre: nombreGrupo(a), personal: !!a.personal, n: 0, atr: 0 });
      x.n++; if (a.semaforo === 'atrasada') x.atr++;
    });
    var proys = Object.keys(porProy).map(function (k) { return porProy[k]; }).sort(function (a, b) { return b.n - a.n; });
    var max = Math.max.apply(null, proys.map(function (x) { return x.n; }).concat([1]));
    var carga = proys.length ? '<ul class="sx2-py-mt-proys">' + proys.map(function (x) {
      return '<li><button type="button" class="sx2-py-mt-proy js-py2m-proy" data-id="' + U.esc(x.id) + '">' +
        '<span class="sx2-entre"><span class="sx2-flex" style="gap:6px;min-width:0">' + U.ico(x.personal ? 'persona' : 'carpeta', 13) + '<span class="sx2-cortar">' + U.esc(x.nombre) + '</span></span><strong>' + x.n + (x.atr ? ' <span class="sx2-delta--mal">· ' + x.atr + ' atr.</span>' : '') + '</strong></span>' +
        U.barra(Math.round(x.n / max * 100), x.atr ? 'critico' : 'primario') + '</button></li>';
    }).join('') + '</ul>' : U.vacio({ icono: 'carpeta', texto: 'Sin tareas abiertas.' });

    return '<div class="sx2-grid sx2-grid--estira">' +
      '<div class="sx2-col-8 sx2-apilado">' + cuerpo + '</div>' +
      '<div class="sx2-col-4 sx2-col--apila sx2-apilado">' +
        U.card({ titulo: 'Dónde está mi carga', icono: 'capas', sub: 'tareas abiertas', i: 3, cuerpo: carga }) +
        U.card({ titulo: 'Mis entregables', icono: 'bandera', sub: String(ents.length), i: 4, cuerpo: entHtml }) +
      '</div>' +
    '</div>';
  }

  // --- Mis horas ----------------------------------------------------------------------
  // Por tarea y día manda el REGISTRO_DIA; si no hay, suman las horas de los
  // check-in (mismo criterio que v1 y que la sección Equipo).
  function horas(d, hoy) {
    var dias = [];
    for (var i = DIAS - 1; i >= 0; i--) dias.push(sumarDias(hoy, -i));
    var enV = {};
    dias.forEach(function (x) { enV[x] = true; });
    var tareas = {};
    d.tareas.forEach(function (a) { tareas[a.actividad_id] = a; });
    var reg = {}, chk = {};
    d.bitacora.forEach(function (b) {
      if (!tareas[b.actividad_id]) return;
      if (b.tipo === 'REGISTRO_DIA' && b.dia && enV[b.dia]) (reg[b.actividad_id] = reg[b.actividad_id] || {})[b.dia] = b;
      else if (b.tipo !== 'REGISTRO_DIA' && b.horas) {
        var k = claveLocal(b.timestamp);
        if (!enV[k]) return;
        var m = (chk[b.actividad_id] = chk[b.actividad_id] || {});
        m[k] = (m[k] || 0) + Number(b.horas);
      }
    });
    var porProy = {};
    Object.keys(tareas).forEach(function (id) {
      var a = tareas[id];
      dias.forEach(function (x) {
        var r = reg[id] && reg[id][x];
        var h = r ? (Number(r.horas) || 0) : ((chk[id] && chk[id][x]) || 0);
        if (!r && !h) return;
        var k = grupoDe(a);
        var p = porProy[k] || (porProy[k] = { id: k, nombre: nombreGrupo(a), personal: !!a.personal, total: 0, porDia: {}, detalle: {} });
        p.total += h;
        p.porDia[x] = (p.porDia[x] || 0) + h;
        (p.detalle[x] = p.detalle[x] || []).push({ tarea: a, horas: h, estado: r ? r.estado_dia : '', nota: r ? r.nota : '' });
      });
    });
    return { dias: dias, porProy: porProy };
  }

  var LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  function vistaHoras(d, hoy) {
    var h = horas(d, hoy);
    var proys = Object.keys(h.porProy).map(function (k) { return h.porProy[k]; }).sort(function (a, b) { return b.total - a.total; });
    var total = proys.reduce(function (s, p) { return s + p.total; }, 0);
    var porDia = h.dias.map(function (x) { return proys.reduce(function (s, p) { return s + (p.porDia[x] || 0); }, 0); });
    var semana = porDia.slice(-7).reduce(function (s, v) { return s + v; }, 0);
    var anterior = porDia.slice(0, 7).reduce(function (s, v) { return s + v; }, 0);
    var diasConReg = porDia.filter(function (v) { return v > 0; }).length;
    var r1 = function (v) { return Math.round(v * 10) / 10; };

    var kpis = '<div class="sx2-fila-kpis' + (nSol ? ' sx2-fila-kpis--6' : '') + '">' +
      U.kpi({ i: 0, icono: 'reloj', tono: 'primario', etiqueta: 'Últimos 7 días', valor: r1(semana), sufijo: ' h',
        tendencia: anterior ? { texto: (semana >= anterior ? '+' : '') + r1(semana - anterior) + ' h vs semana anterior', tono: semana >= anterior ? 'ok' : 'alerta', icono: semana >= anterior ? 'tendencia' : 'tendenciaBaja' } : null }) +
      U.kpi({ i: 1, icono: 'calendario', tono: 'info', etiqueta: '14 días', valor: r1(total), sufijo: ' h', unidad: diasConReg + (diasConReg === 1 ? ' día con registro' : ' días con registro') }) +
      U.kpi({ i: 2, icono: 'carpeta', tono: 'hito', etiqueta: 'Frentes', valor: proys.length, unidad: 'proyectos o personales' }) +
      U.kpi({ i: 3, icono: 'rayo', tono: porDia.some(function (v) { return v > 9; }) ? 'alerta' : 'neutro', etiqueta: 'Días de más de 9 h', valor: porDia.filter(function (v) { return v > 9; }).length, unidad: 'en 14 días' }) +
    '</div>';

    if (!proys.length) {
      return kpis + U.card({ cuerpo: U.vacio({ icono: 'reloj', titulo: 'Sin horas en los últimos 14 días', texto: 'Registra horas con "Actualizar" en cualquiera de tus tareas.' }) });
    }
    var cab = h.dias.map(function (x) {
      var dt = new Date(x + 'T12:00:00Z'), w = dt.getUTCDay();
      return '<span class="sx2-py-calor__dia' + (w === 0 || w === 6 ? ' sx2-py-calor__dia--finde' : '') + (x === hoy ? ' sx2-py-calor__dia--hoy' : '') + '"><b>' + LETRA[w] + '</b>' + x.slice(8) + '</span>';
    }).join('');
    var mapa = '<div class="sx2-py-calor" style="--dias:' + h.dias.length + '">' +
      '<div class="sx2-py-calor__fila sx2-py-calor__fila--cab"><span></span>' + cab + '<span class="sx2-py-calor__total">Total</span></div>' +
      proys.map(function (p) {
        return '<div class="sx2-py-calor__fila"><span class="sx2-py-calor__persona"><span class="sx2-py-mt-ico sx2-tono-' + (p.personal ? 'hito' : 'primario') + '">' + U.ico(p.personal ? 'persona' : 'carpeta', 12) + '</span><span class="sx2-cortar">' + U.esc(p.nombre) + '</span></span>' +
          h.dias.map(function (x) {
            var v = p.porDia[x] || 0;
            var nivel = !p.detalle[x] ? 0 : (v > 9 ? 5 : (v > 6 ? 4 : (v > 3 ? 3 : (v > 0 ? 2 : 1))));
            return '<button type="button" class="sx2-py-calor__celda sx2-py-calor__celda--' + nivel + '"' +
              (p.detalle[x] ? ' data-py2m-celda="' + U.esc(p.id) + '|' + x + '"' : ' disabled') + ' title="' + U.esc(p.nombre + ' · ' + PY.fecha(x) + (v ? ' · ' + r1(v) + ' h' : '')) + '">' + (v ? r1(v) : '') + '</button>';
          }).join('') +
          '<span class="sx2-py-calor__total">' + r1(p.total) + ' h</span></div>';
      }).join('') +
      '<div class="sx2-py-calor__fila sx2-py-mt-totales"><span class="sx2-py-calor__persona"><strong>Total del día</strong></span>' +
        porDia.map(function (v) { return '<span class="sx2-py-calor__total' + (v > 9 ? ' sx2-delta--mal' : '') + '" style="text-align:center">' + (v ? r1(v) : '·') + '</span>'; }).join('') +
        '<span class="sx2-py-calor__total"><strong>' + r1(total) + ' h</strong></span></div>' +
    '</div>';

    return kpis + '<div class="sx2-grid sx2-grid--estira">' +
      '<div class="sx2-col-8">' + U.card({ titulo: 'Mi dedicación día a día', icono: 'calendario', sub: 'clic en un día para ver o corregir', i: 2, cuerpo: mapa }) + '</div>' +
      '<div class="sx2-col-4 sx2-col--apila">' + U.card({ titulo: 'Horas por día', icono: 'grafico', i: 3,
        cuerpo: '<div class="sx2-py-grafico sx2-py-grafico--alto"><canvas id="py2-grafico-mishoras" role="img" aria-label="Mis horas por día y proyecto"></canvas></div>' }) + '</div>' +
    '</div>';
  }

  // --- Pintado ---------------------------------------------------------------------
  function pintar(d) {
    var hoy = PY.hoyClave();
    var yo = PY.persona(PY.miEmail(), PY.miNombre());
    var abiertas = d.tareas.filter(abierta);
    var g = grupos(abiertas.slice(), hoy);
    var frentes = {};
    abiertas.forEach(function (a) { frentes[grupoDe(a)] = nombreGrupo(a); });
    var nProy = Object.keys(frentes).filter(function (k) { return k !== PERSONAL; }).length;
    var nPers = abiertas.filter(function (a) { return a.personal; }).length;
    var bloqueadas = abiertas.filter(function (a) { return a.estado === 'BLOQUEADA'; }).length;
    var confirmar = abiertas.filter(porConfirmar).length;
    var hora = Number(new Intl.DateTimeFormat('es-CL', { hour: 'numeric', hour12: false, timeZone: 'America/Santiago' }).format(new Date()));
    var saludo = hora < 12 ? 'Buenos días' : (hora < 20 ? 'Buenas tardes' : 'Buenas noches');
    var resumen = !abiertas.length ? 'No tienes tareas abiertas.'
      : 'Tienes ' + abiertas.length + (abiertas.length === 1 ? ' tarea abierta' : ' tareas abiertas') +
        (nProy ? ' en ' + nProy + (nProy === 1 ? ' proyecto' : ' proyectos') : '') +
        (nPers ? (nProy ? ' y ' : ': ') + nPers + (nPers === 1 ? ' personal' : ' personales') : '') +
        (g.atrasadas.length ? ' · ' + g.atrasadas.length + ' atrasada' + (g.atrasadas.length === 1 ? '' : 's') : '') + '.';
    var nSol = (d.solicitudes || []).length;
    if (nSol) resumen = (abiertas.length ? resumen.replace(/\.$/, '') + ' · ' : 'Sin tareas abiertas · ') + nSol + (nSol === 1 ? ' ítem de solicitud' : ' ítems de solicitudes') + ' a tu cargo.';

    var cabecera = '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-flex" style="gap:16px;align-items:center;min-width:0">' + U.avatar(yo, 'xl') +
        '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">' + U.esc(host_.migas) + '</span>' +
          '<h1>' + saludo + (yo.nombre && yo.nombre !== yo.email ? ', ' + U.esc(String(yo.nombre).split(' ')[0]) : '') + '</h1>' +
          '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc(resumen) + '</span>' +
        '</div></div>' +
      '<div class="sx2-cabecera__acciones">' +
        U.segmento([{ id: 'lista', texto: 'Mis tareas', icono: 'tareas' }, { id: 'horas', texto: 'Mis horas', icono: 'reloj' }], f.modo, 'js-py2m-modo') +
        U.boton({ texto: 'No planificado', icono: 'rayo', clase: 'js-py2m-emergente', titulo: 'Anotar algo que surgió y te tomó tiempo' }) +
        U.boton({ texto: 'Nueva tarea', icono: 'nueva', variante: 'primario', clase: 'js-py2m-nueva' }) +
      '</div>' +
    '</header>';

    if (d.error) return cabecera + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: d.error }) });
    if (f.modo === 'horas') return cabecera + vistaHoras(d, hoy);

    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'tareas', tono: 'primario', etiqueta: 'Abiertas', valor: abiertas.length, unidad: nPers ? nPers + ' personales' : 'de proyectos', filtro: 'todas', activo: !f.filtro }) +
      U.kpi({ i: 1, icono: 'alerta', tono: 'critico', etiqueta: 'Atrasadas', valor: g.atrasadas.length, unidad: 'atender primero', filtro: 'atrasadas', activo: f.filtro === 'atrasadas' }) +
      U.kpi({ i: 2, icono: 'calendario', tono: 'alerta', etiqueta: 'Esta semana', valor: g.semana.length, unidad: 'vencen en 7 días', filtro: 'semana', activo: f.filtro === 'semana' }) +
      U.kpi({ i: 3, icono: 'candado', tono: 'hito', etiqueta: 'Bloqueadas', valor: bloqueadas, unidad: 'esperan algo', filtro: 'bloqueadas', activo: f.filtro === 'bloqueadas' }) +
      (confirmar
        ? U.kpi({ i: 4, icono: 'check', tono: 'info', etiqueta: 'Por confirmar', valor: confirmar, unidad: 'fechas propuestas', filtro: 'confirmar', activo: f.filtro === 'confirmar' })
        : U.kpi({ i: 4, icono: 'bandera', tono: 'ok', etiqueta: 'Entregables', valor: d.entregables.length, unidad: 'pendientes' })) +
      (nSol ? U.kpi({ i: 5, icono: 'bandeja', tono: 'hito', etiqueta: 'Solicitudes', valor: nSol, unidad: 'ítems a tu cargo', filtro: 'solicitudes', activo: f.filtro === 'solicitudes' }) : '') +
    '</div>';
    var ids = Object.keys(frentes);
    var chips = ids.length > 1 ? '<div class="sx2-chips sx2-entra" style="--i:1">' + U.chip({ texto: 'Todo', activo: !f.proyecto, clase: 'js-py2m-proy', datos: { id: '' } }) +
      ids.map(function (id) {
        return U.chip({ texto: frentes[id], icono: id === PERSONAL ? 'persona' : 'carpeta', activo: f.proyecto === id, clase: 'js-py2m-proy', datos: { id: id },
          n: abiertas.filter(function (a) { return grupoDe(a) === id; }).length });
      }).join('') + '</div>' : '';
    return cabecera + kpis + chips + vistaLista(d, hoy);
  }

  function colorVar(raiz, v) {
    var el = document.createElement('span');
    el.style.color = 'var(' + v + ')';
    el.style.display = 'none';
    raiz.appendChild(el);
    var c = getComputedStyle(el).color;
    el.remove();
    return c;
  }
  function dibujar(raiz, d) {
    if (grafico_) { grafico_.destroy(); grafico_ = null; }
    var c = raiz.querySelector('#py2-grafico-mishoras');
    if (!c || !window.Chart) return;
    var h = horas(d, PY.hoyClave());
    var proys = Object.keys(h.porProy).map(function (k) { return h.porProy[k]; }).sort(function (a, b) { return b.total - a.total; });
    var paleta = ['--sx-primario', '--sx-hito', '--sx-ok', '--sx-alerta', '--sx-info', '--sx-critico'].map(function (v) { return colorVar(raiz, v); });
    var t3 = colorVar(raiz, '--sx-texto-3');
    grafico_ = new Chart(c, {
      type: 'bar',
      data: { labels: h.dias.map(function (x) { return x.slice(8) + '/' + x.slice(5, 7); }),
        datasets: proys.slice(0, 6).map(function (p, i) {
          return { label: p.nombre, data: h.dias.map(function (x) { return Math.round((p.porDia[x] || 0) * 10) / 10; }), backgroundColor: paleta[i], borderRadius: 4, maxBarThickness: 18 };
        }) },
      options: {
        maintainAspectRatio: false, animation: U.reducirMovimiento() ? false : { duration: 700 },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { color: t3, font: { size: 10 }, maxRotation: 0 } },
          y: { stacked: true, beginAtZero: true, grid: { color: colorVar(raiz, '--sx-borde-suave') }, ticks: { color: t3, font: { size: 10 } } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: colorVar(raiz, '--sx-texto-2'), font: { size: 11 } } } }
      }
    });
  }

  // --- Acciones ----------------------------------------------------------------------
  function tarea(d, id) { return d.tareas.filter(function (a) { return a.actividad_id === id; })[0]; }

  // Una tarea de proyecto se abre cargando su proyecto por detrás; un
  // compromiso personal, con su propio detalle. Mismo panel en los dos casos.
  function abrir(a, opts) {
    if (!a) return;
    opts = Object.assign({ alGuardar: function () { host_.recargar(); } }, opts || {});
    if (a.personal) PY.abrirTareaPersonal(a.actividad_id, Object.assign({ base: a }, opts));
    else PY.abrirTareaDeProyecto(a.proyecto_id, a.actividad_id, opts);
  }

  function abrirDia(d, grupo, dia) {
    var p = horas(d, PY.hoyClave()).porProy[grupo];
    var items = (p && p.detalle[dia]) || [];
    var dr = U.drawer({
      titulo: PY.fecha(dia, true),
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(p ? p.nombre : '') + '</span>',
      cuerpo: '<ul class="sx2-lista">' + items.map(function (it) {
        return '<li class="sx2-py-dia-item" data-act="' + U.esc(it.tarea.actividad_id) + '" tabindex="0">' +
          '<span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong class="sx2-cortar">' + U.esc(it.tarea.titulo) + '</strong>' +
            (it.nota ? '<span class="sx2-tenue" style="font-size:.78rem">' + U.esc(it.nota) + '</span>' : '') + '</span>' +
          '<span class="sx2-flex">' + (it.estado ? U.badge(it.estado.replace(/_/g, ' '), 'neutro', true) : '') + '<strong>' + (Math.round(it.horas * 10) / 10) + ' h</strong></span>' +
        '</li>';
      }).join('') + '</ul>',
      pie: '<span class="sx2-tenue" style="font-size:.8125rem;flex:1;align-self:center">Clic en una tarea para corregir ese día.</span>'
    });
    dr.el.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-act]');
      if (!t) return;
      dr.cerrar(true);
      abrir(tarea(d, t.getAttribute('data-act')), { actualizar: true, dia: dia });
    });
  }

  // Nueva tarea / no planificado. Con proyecto se crea como tarea de ese
  // proyecto (mía); sin proyecto, como compromiso personal (con tamaño y, si
  // se quiere, repetición). "No planificado" = lo mismo, fechado hoy.
  function abrirNueva(d, emergente) {
    var hoy = PY.hoyClave();
    PY.formulario({
      titulo: emergente ? 'Anotar algo no planificado' : 'Nueva tarea',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + (emergente
        ? 'Algo que surgió hoy y te tomó tiempo: queda en tu registro y en el de tu jefatura.'
        : 'Queda a tu nombre, confirmada con la fecha que elijas.') + '</span>',
      boton: emergente ? 'Anotar' : 'Crear tarea',
      campos: PY.campo('Qué', '<input class="sx2-input" name="titulo" maxlength="140" placeholder="' + (emergente ? 'Ej: Atender urgencia de un cliente' : 'Ej: Editar 3 videos de testimonios') + '">') +
        '<div class="sx2-form__fila">' +
          PY.campo(emergente ? 'Fecha' : 'Vence', '<input class="sx2-input" type="date" name="fecha_compromiso" value="' + (emergente ? hoy : '') + '">') +
          PY.campo('Tamaño', '<select class="sx2-select" name="tamano">' + Object.keys(TAMANO).map(function (t) {
            return '<option value="' + t + '"' + (t === (emergente ? 'S' : 'M') ? ' selected' : '') + '>' + TAMANO[t] + '</option>';
          }).join('') + '</select>') +
        '</div>' +
        PY.campo('¿De un proyecto?', '<select class="sx2-select js-py2m-proyecto" name="proyecto_id"><option value="">No — es un compromiso personal</option>' +
          d.proyectos.map(function (p) { return '<option value="' + U.esc(p.id) + '">' + U.esc(p.nombre) + '</option>'; }).join('') + '</select>',
          d.proyectos.length ? 'Si es de un proyecto, queda como tarea tuya en ese proyecto.' : 'No participas en proyectos activos: quedará como compromiso personal.') +
        (emergente ? '' : '<label class="sx2-campo js-py2m-repetir"><span class="sx2-campo__et">Se repite</span><select class="sx2-select" name="recurrencia">' +
          '<option value="NINGUNA">No</option><option value="SEMANAL">Cada semana</option><option value="MENSUAL">Cada mes</option></select>' +
          '<span class="sx2-campo__ayuda">Al terminarla se crea sola la siguiente.</span></label>'),
      alMontar: function (form) {
        var sel = form.querySelector('.js-py2m-proyecto'), rep = form.querySelector('.js-py2m-repetir');
        if (sel && rep) sel.addEventListener('change', function () { rep.hidden = !!sel.value; });
      },
      preparar: function (x) {
        if (!x.titulo) return 'Escribe qué es la tarea.';
        if (!x.fecha_compromiso) return emergente ? 'Indica la fecha.' : 'Indica cuándo vence.';
        var origen = emergente ? 'EMERGENTE' : 'PROPIA';
        if (x.proyecto_id) {
          return { accion_: 'crearTareaProyecto', proyecto_id: x.proyecto_id, titulo: x.titulo, responsable_email: PY.miEmail(),
            responsable_nombre: PY.miNombre(), fecha_compromiso: x.fecha_compromiso, tamano: x.tamano, prioridad: 'P3', origen: origen };
        }
        return { accion_: 'crearActividad', titulo: x.titulo, fecha_compromiso: x.fecha_compromiso, tamano: x.tamano, origen: origen, recurrencia: x.recurrencia || 'NINGUNA' };
      },
      enviar: function (x) { var accion = x.accion_; delete x.accion_; return PY.api(accion, x); },
      aviso: emergente ? 'Anotado.' : 'Tarea creada.',
      listo: function () { host_.recargar(); }
    });
  }

  function proponerOtraFecha(a) {
    PY.formulario({
      titulo: 'Proponer otra fecha', boton: 'Proponer',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(a.titulo) + ' · te proponen el ' + PY.fecha(a.fecha_propuesta, true) + '</span>',
      campos: PY.campo('Fecha que puedes cumplir', '<input class="sx2-input" type="date" name="fecha_compromiso" value="' + String(a.fecha_propuesta || '').slice(0, 10) + '">') +
        PY.campo('Motivo', '<textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Quien te la asignó lo verá."></textarea>'),
      preparar: function (x) {
        if (!x.fecha_compromiso) return 'Indica la fecha.';
        if (!x.motivo) return 'Cuenta brevemente por qué.';
        return { actividad_id: a.actividad_id, fecha_compromiso: x.fecha_compromiso, motivo: x.motivo };
      },
      accion: 'confirmarActividad', aviso: 'Fecha propuesta.', listo: function () { host_.recargar(); }
    });
  }

  function alMontar(raiz, d, host) {
    host_ = host || hostProyectos;
    dibujar(raiz, d);
    raiz.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if ((b = t.closest('.js-py2m-modo'))) {
        f.modo = b.getAttribute('data-id');
        try { localStorage.setItem('sigso_py2_modo_mitrabajo', f.modo); } catch (e) { /* sin storage */ }
        host_.pintar();
        return;
      }
      if (t.closest('.js-py2m-nueva')) { abrirNueva(d, false); return; }
      if (t.closest('.js-py2m-emergente')) { abrirNueva(d, true); return; }
      if ((b = t.closest('.sx2-kpi[data-filtro]'))) { var k = b.getAttribute('data-filtro'); f.filtro = (k === 'todas' || f.filtro === k) ? '' : k; host_.pintar({ sinAnimacion: true }); return; }
      if (t.closest('.js-py2m-bandeja')) { if (window.SigsoShell) SigsoShell.irAModulo('bandeja'); return; }
      if (t.closest('.js-py2m-todas-sol')) { f.filtro = 'solicitudes'; host_.pintar({ sinAnimacion: true }); window.scrollTo(0, 0); return; }
      if ((b = t.closest('.js-py2m-proy'))) { var id = b.getAttribute('data-id'); f.proyecto = f.proyecto === id ? '' : id; host_.pintar({ sinAnimacion: true }); return; }
      if ((b = t.closest('[data-py2-proyecto]'))) {
        ev.stopPropagation();
        host_.abrirProyecto(b.getAttribute('data-py2-proyecto'), b.getAttribute('data-seccion'));
        return;
      }
      if ((b = t.closest('.js-py2m-confirmar'))) {
        ev.stopPropagation();
        b.disabled = true;
        PY.api('confirmarActividad', { actividad_id: b.getAttribute('data-id') }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo confirmar.', 'error'); return; }
          PY.aviso('Fecha confirmada.', 'exito');
          host_.recargar();
        });
        return;
      }
      if ((b = t.closest('.js-py2m-otra'))) { ev.stopPropagation(); proponerOtraFecha(tarea(d, b.getAttribute('data-id'))); return; }
      if ((b = t.closest('.js-py2m-actualizar'))) { ev.stopPropagation(); abrir(tarea(d, b.getAttribute('data-id')), { actualizar: true }); return; }
      if ((b = t.closest('[data-py2m-celda]'))) { var p = b.getAttribute('data-py2m-celda').split('|'); abrirDia(d, p[0], p[1]); return; }
      if ((b = t.closest('[data-py2-mt]'))) abrir(tarea(d, b.getAttribute('data-py2-mt')));
    });
    raiz.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-py2-mt]')) { ev.preventDefault(); ev.target.click(); }
    });
    var calor = raiz.querySelector('.sx2-py-calor');
    if (calor) calor.scrollLeft = calor.scrollWidth;
  }

  // Módulo 3B: si cambió una solicitud (desde su panel o una fila), se
  // recarga la vista si está mostrando la tarjeta de solicitudes.
  document.addEventListener('sigso:solicitudes-cambio', function () {
    var t = document.querySelector('.sx2-py-mt-sol');
    if (t && t.offsetParent !== null) host_.recargar();
  });

  // El Inicio v2 usa el MISMO cálculo de horas (misma regla, mismos números).
  PY.calcularHoras = horas;
  PY.porConfirmar = porConfirmar;

  PY.vistas.mitrabajo = {
    cargar: cargar, pintar: pintar, alMontar: alMontar,
    correos: function () { return [PY.miEmail()]; }
  };

  // =========================================================================
  // Módulo "Mi trabajo" del shell (SigsoMiTrabajoV2): la misma vista, en
  // #actividades-contenido, con el interruptor "Volver a la versión clásica"
  // (actividades.js queda un ciclo como respaldo).
  // =========================================================================
  var mod = { datos: null, turno: 0 };
  function cont() { return document.getElementById('actividades-contenido'); }
  function montar() {
    var c = cont();
    if (!c) return null;
    c.classList.add('sx2');
    var sec = document.getElementById('modulo-mi_trabajo');
    if (sec) sec.classList.add('sigso-py-sin-cabecera-modulo');
    return c;
  }
  function desmontar() {
    var c = cont();
    if (c) { c.classList.remove('sx2'); c.innerHTML = ''; }
    var sec = document.getElementById('modulo-mi_trabajo');
    if (sec) sec.classList.remove('sigso-py-sin-cabecera-modulo');
  }
  var hostModulo = {
    migas: 'Mi espacio',
    pintar: function (o) { pintarModulo(o); },
    recargar: function () { cargarModulo(true); },
    abrirProyecto: function (id, seccion) {
      if (!window.SigsoShell || !SigsoShell.tieneModulo('proyectos')) { PY.aviso('No tienes acceso al módulo Proyectos.', 'error'); return; }
      SigsoShell.irAModulo('proyectos');
      if (window.SigsoProyectosV2 && SigsoProyectosV2.activo()) PY.abrirProyecto(id, { seccion: seccion || undefined });
    }
  };
  function pintarModulo(o) {
    o = o || {};
    var c = montar();
    if (!c || !mod.datos) return;
    var y = window.scrollY;
    c.innerHTML = '<div class="sx2-pagina">' + pintar(mod.datos) + '</div>';
    alMontar(c.firstChild, mod.datos, hostModulo);
    if (o.sinAnimacion) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }
  function cargarModulo(silencioso) {
    var c = montar();
    if (!c) return;
    var turno = ++mod.turno;
    if (!silencioso || !mod.datos) {
      c.innerHTML = '<div class="sx2-pagina">' + U.esqueleto('kpis', 5) + U.esqueleto('tabla', 6) + '</div>';
    }
    cargar().then(function (datos) {
      if (turno !== mod.turno) return;
      var habia = !!mod.datos;
      mod.datos = datos;
      pintarModulo(silencioso && habia ? { sinAnimacion: true } : undefined);
      var correos = [PY.miEmail()];
      Promise.all([
        window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve(),
        U.precargarFotos(correos)
      ]).then(function () { if (turno === mod.turno) pintarModulo({ sinAnimacion: true }); });
    });
  }
  // 2026-09-25: la versión clásica se retiró; la v2 es la única.
  function activo() { return true; }
  function usarVersion() { /* sin versión clásica */ }

  window.SigsoMiTrabajoV2 = {
    cargar: function () { cargarModulo(false); },
    refrescar: function () { cargarModulo(true); },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
})();
