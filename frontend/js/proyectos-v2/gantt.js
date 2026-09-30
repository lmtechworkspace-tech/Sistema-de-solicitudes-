/**
 * proyectos-v2/gantt.js — Carta Gantt de Proyectos v2: la parte INTERACTIVA.
 *
 * El dibujo (barras, hitos, lo real, cabecera de meses/semanas, "Hoy") vive en
 * gantt-dibujo.js (SigsoGantt), que también usa el servidor para el PDF: una
 * sola Carta Gantt en pantalla y en papel (auditoría 2026-09-29, etapa 2).
 * Aquí queda lo que necesita el navegador: flechas de dependencias (SVG medido
 * sobre el DOM), ficha emergente, arrastre para desplazarse y "ir a hoy".
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var G = window.SigsoGantt;
  var DIA = 86400000;
  var dia = G.dia, tramo = G.tramo, tramoReal = G.tramoReal;

  // --- Después de pintar: dependencias, ficha emergente, arrastre --------------------
  function dibujarDependencias(g) {
    var viejo = g.querySelector('.sx2-py-gantt__deps');
    if (viejo) viejo.remove();
    if (!g.hasAttribute('data-deps')) return;
    var base = g.getBoundingClientRect();
    var barras = {};
    g.querySelectorAll('.sx2-py-gantt__fila[data-py2-tarea]').forEach(function (fila) {
      var b = fila.querySelector('.sx2-py-gantt__barra');
      if (b) barras[fila.getAttribute('data-py2-tarea')] = b.getBoundingClientRect();
    });
    var paths = '';
    g.querySelectorAll('.sx2-py-gantt__fila[data-dep]').forEach(function (fila) {
      var a = fila.getAttribute('data-py2-tarea');
      // Una tarea puede depender de varias: una flecha por cada una.
      fila.getAttribute('data-dep').split(/[\s,;]+/).filter(Boolean).forEach(function (de) {
      var r1 = barras[de], r2 = barras[a];
      if (!r1 || !r2) return;
      var x1 = r1.right - base.left, y1 = r1.top + r1.height / 2 - base.top;
      var x2 = r2.left - base.left, y2 = r2.top + r2.height / 2 - base.top;
      var d;
      if (x2 - x1 >= 14) d = 'M' + x1 + ' ' + y1 + ' H' + (x1 + 7) + ' V' + y2 + ' H' + (x2 - 1);
      else {
        var yMedio = y2 + (y2 > y1 ? -1 : 1) * (r2.height / 2 + 5);
        d = 'M' + x1 + ' ' + y1 + ' H' + (x1 + 7) + ' V' + yMedio + ' H' + (x2 - 9) + ' V' + y2 + ' H' + (x2 - 1);
      }
      paths += '<path d="' + d + '" data-de="' + U.esc(de) + '" data-a="' + U.esc(a) + '" marker-end="url(#py2-flecha)"/>';
      });
    });
    if (!paths) return;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sx2-py-gantt__deps');
    svg.setAttribute('width', g.scrollWidth);
    svg.setAttribute('height', g.offsetHeight);
    svg.innerHTML = '<defs><marker id="py2-flecha" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z"/></marker></defs>' + paths;
    g.appendChild(svg);
  }

  var tip_ = null;
  function ficha(ctx, id) {
    var a = ctx.tareas.filter(function (x) { return x.actividad_id === id; })[0];
    if (!a) return '';
    var p = PY.planPorId(ctx)[id] || {};
    var t = tramo(a, p), r = tramoReal(a, p, dia(PY.hoyClave()));
    var desfase = '';
    if (t && r && !r.abierta) {
      var dd = Math.round((r.fin - t.fin) / DIA);
      desfase = dd === 0 ? 'en fecha' : (dd > 0 ? '+' + dd + ' d de atraso' : (-dd) + ' d antes');
    }
    var f = function (d) { return d ? PY.fecha(d.toISOString(), true) : '—'; };
    var avance = p.avance_real_pct !== undefined && p.avance_real_pct !== null ? Math.round(p.avance_real_pct) : (a.estado === 'TERMINADA' ? 100 : Math.round(Number(a.avance_pct) || 0));
    return '<strong>' + U.esc(a.titulo) + '</strong>' +
      '<span class="sx2-py-gantt-tip__fila">' + U.badge(a.semaforo_etiqueta || a.estado, PY.tonoTarea(a)) + '<span>' + U.esc(PY.persona(a.responsable_email, a.responsable_nombre).nombre) + '</span></span>' +
      '<dl><dt>Plan</dt><dd>' + (t ? f(t.ini) + ' → ' + f(t.fin) : '—') + '</dd>' +
      '<dt>Real</dt><dd>' + (r ? f(r.ini) + ' → ' + (r.abierta ? 'en curso' : f(r.fin)) : 'sin iniciar') + '</dd>' +
      (desfase ? '<dt>Desfase</dt><dd>' + desfase + '</dd>' : '') +
      '<dt>Avance</dt><dd>' + avance + '%</dd></dl>';
  }
  function montar(raiz) {
    if (tip_) tip_.hidden = true;
    var g = raiz && raiz.querySelector('.sx2-py-gantt[data-completa]');
    if (!g) return;
    dibujarDependencias(g);
    var sc = g.closest('.sx2-py-gantt-scroll');
    if (!tip_) {
      tip_ = document.createElement('div');
      tip_.className = 'sx2-py-gantt-tip';
      tip_.setAttribute('role', 'tooltip');
      tip_.hidden = true;
      document.body.appendChild(tip_);
    }
    var sobre = null;
    function ocultar() { tip_.hidden = true; sobre = null; g.querySelectorAll('.sx2-py-gantt__deps path.activa').forEach(function (p) { p.classList.remove('activa'); }); }
    g.addEventListener('mousemove', function (ev) {
      if (arrastre_) return;
      var fila = ev.target.closest('.sx2-py-gantt__fila[data-py2-tarea]');
      var enBarra = ev.target.closest('.sx2-py-gantt__barra, .sx2-py-gantt__real, .sx2-py-gantt__et');
      if (!fila || !enBarra) { if (sobre) ocultar(); return; }
      var id = fila.getAttribute('data-py2-tarea');
      if (sobre !== id) {
        sobre = id;
        tip_.innerHTML = ficha(PY.ctx(), id);
        tip_.hidden = false;
        g.querySelectorAll('.sx2-py-gantt__deps path').forEach(function (p) {
          p.classList.toggle('activa', p.getAttribute('data-de') === id || p.getAttribute('data-a') === id);
        });
      }
      var x = ev.clientX + 14, y = ev.clientY + 16;
      var w = tip_.offsetWidth, h = tip_.offsetHeight;
      if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
      if (y + h > window.innerHeight - 8) y = ev.clientY - h - 12;
      tip_.style.left = x + 'px';
      tip_.style.top = y + 'px';
    });
    g.addEventListener('mouseleave', ocultar);
    sc.addEventListener('scroll', function () { if (sobre) ocultar(); }, { passive: true });

    // El asa de una barra reprograma; el fondo desplaza (sin robar el clic de una barra).
    g.addEventListener('mousedown', function (ev) { iniciarAsa(ev, g); });
    sc.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0 || asa_ || ev.target.closest('button, a, input, .sx2-py-gantt__nombre, .sx2-py-gantt__barra')) return;
      arrastre_ = { sc: sc, movio: false, x0: ev.clientX, y0: ev.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
      sc.classList.add('sx2-py-gantt-scroll--arrastre');
      if (sobre) ocultar();
    });
    sc.addEventListener('click', function (ev) {
      if (sc.__movio) { ev.stopPropagation(); ev.preventDefault(); sc.__movio = false; }
    }, true);
  }
  // --- Reprogramar arrastrando el término (auditoría G3) ---------------------------
  // Se arrastra el asa del extremo derecho de la barra; al soltar se abre el
  // formulario de reprogramar con la fecha nueva y el motivo obligatorio (RN-703).
  // La barra solo se estira como vista previa: nada cambia hasta confirmar.
  var asa_ = null;
  function iniciarAsa(ev, g) {
    var asa = ev.target.closest('[data-asa]');
    if (!asa || ev.button !== 0) return false;
    var fila = asa.closest('[data-py2-tarea]');
    var barra = asa.closest('.sx2-py-gantt__barra');
    var pista = barra.parentNode;
    var semanas = Number(g.getAttribute('data-semanas')) || 1;
    var a = PY.ctx().tareas.filter(function (x) { return x.actividad_id === fila.getAttribute('data-py2-tarea'); })[0];
    if (!a || !a.fecha_compromiso) return false;
    ev.preventDefault();
    ev.stopPropagation();
    asa_ = { g: g, a: a, barra: barra, x0: ev.clientX, ancho0: barra.getBoundingClientRect().width,
      pxDia: pista.getBoundingClientRect().width / (semanas * 7), fin: dia(a.fecha_compromiso), dias: 0 };
    g.classList.add('sx2-py-gantt--arrastrando');
    if (tip_) tip_.hidden = true;
    return true;
  }
  function fechaClave(d) { return d.toISOString().slice(0, 10); }
  window.addEventListener('mousemove', function (ev) {
    if (!asa_) return;
    var dias = Math.round((ev.clientX - asa_.x0) / asa_.pxDia);
    asa_.dias = dias;
    asa_.barra.style.width = Math.max(6, asa_.ancho0 + dias * asa_.pxDia) + 'px';
    var nueva = new Date(asa_.fin.getTime() + dias * DIA);
    if (tip_) {
      tip_.innerHTML = '<strong>' + U.esc(asa_.a.titulo) + '</strong><span class="sx2-py-gantt-tip__fila">Nuevo término: <b>' + PY.fecha(fechaClave(nueva), true) + '</b> (' + (dias > 0 ? '+' : '') + dias + ' d)</span>';
      tip_.hidden = false;
      tip_.style.left = (ev.clientX + 14) + 'px';
      tip_.style.top = (ev.clientY + 16) + 'px';
    }
  });
  window.addEventListener('mouseup', function () {
    if (!asa_) return;
    var s = asa_;
    asa_ = null;
    s.g.classList.remove('sx2-py-gantt--arrastrando');
    if (tip_) tip_.hidden = true;
    var sc = s.g.closest('.sx2-py-gantt-scroll');
    if (sc) sc.__movio = true; // que el clic de soltar no abra el panel de la tarea
    PY.pintar({ sinAnimacion: true }); // deshace la vista previa
    if (s.dias !== 0 && PY.abrirReprogramarProyecto) {
      PY.abrirReprogramarProyecto(PY.ctx(), s.a, fechaClave(new Date(s.fin.getTime() + s.dias * DIA)));
    }
  });

  // Un solo par de escuchas globales para el arrastre (no se acumulan al repintar).
  var arrastre_ = null;
  window.addEventListener('mousemove', function (ev) {
    if (!arrastre_) return;
    var dx = ev.clientX - arrastre_.x0, dy = ev.clientY - arrastre_.y0;
    if (Math.abs(dx) + Math.abs(dy) > 4) arrastre_.movio = true;
    arrastre_.sc.scrollLeft = arrastre_.sl - dx;
    arrastre_.sc.scrollTop = arrastre_.st - dy;
  });
  window.addEventListener('mouseup', function () {
    if (!arrastre_) return;
    arrastre_.sc.classList.remove('sx2-py-gantt-scroll--arrastre');
    arrastre_.sc.__movio = arrastre_.movio;
    arrastre_ = null;
  });

  // Lleva el scroll horizontal a "hoy" (Gantt con zoom).
  function centrarEnHoy(raiz) {
    var sc = raiz.querySelector('.sx2-py-gantt-scroll--zoom');
    var hoy = sc && sc.querySelector('.sx2-py-gantt__hoy');
    if (!sc || !hoy) return;
    sc.scrollLeft = Math.max(0, hoy.offsetLeft - sc.clientWidth * 0.45);
  }
  // Lleva el scroll al inicio del proyecto (lo primero planificado).
  function irAlInicio(raiz) {
    var sc = raiz.querySelector('.sx2-py-gantt-scroll--zoom');
    if (sc) sc.scrollLeft = 0;
  }

  window.addEventListener('resize', function () {
    var g = document.querySelector('.sx2-py-gantt[data-completa]');
    if (g) dibujarDependencias(g);
  });

  PY.gruposCerrados = PY.gruposCerrados || {};
  PY.gantt = G.html;
  PY.ganttRangoProyecto = G.rango;
  PY.ganttCentrarEnHoy = centrarEnHoy;
  PY.ganttIrAlInicio = irAlInicio;
  PY.ganttMontar = montar;
  PY.lunes = G.lunes;
})();
