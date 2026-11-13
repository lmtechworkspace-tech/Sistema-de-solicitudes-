/**
 * cumplimiento-v2.js — pantallas del ÍNDICE DE CUMPLIMIENTO por responsable
 * (Plan de control y certificación, P3; backend getCumplimientoResponsables).
 *
 * Un solo componente que se pinta en tres lugares:
 *  - Mi trabajo → «Mi cumplimiento» (alcance 'yo'): cada persona ve su número
 *    antes que nadie, con el detalle de qué lo sube y qué lo baja.
 *  - Mi departamento → «Cumplimiento del equipo» (alcance 'equipo').
 *  - Panel de gerencia → «Cumplimiento por responsable» (alcance 'empresa').
 * En las listas, un clic en una persona abre su detalle (con «Volver»).
 *
 * Reglas que la pantalla tiene que dejar a la vista (decisiones del dueño):
 * cada número se puede abrir hasta la tarea; las señales (sin fecha,
 * dormidas, reprogramaciones) se muestran siempre; la lista va en orden
 * alfabético, nunca como ranking.
 *
 * Uso: SigsoCumplimiento.montar(elemento, { alcance: 'yo'|'equipo'|'empresa' })
 * o un marcador <div data-cumpl-host data-alcance="…"> + montarPendientes().
 */
(function () {
  'use strict';

  var U = window.UIv2;
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var TONO = { ok: 'ok', alerta: 'alerta', critico: 'critico', sin_dato: 'neutro' };
  var ESTADO_TXT = { ok: 'Cumple', alerta: 'En observación', critico: 'Bajo lo esperado', sin_dato: 'Sin datos suficientes' };
  var TONO_CASO = { 'A tiempo': 'ok', 'Al día': 'ok', 'Tarde': 'alerta', 'Atrasada': 'critico', 'Sin hacer': 'critico', 'Dormida': 'alerta' };

  function api(accion, datos) {
    return llamarApi((window.SIGSO_CONFIG || {}).BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function esc(s) { return U.esc(s); }
  function hoyPeriodo() {
    var d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
    return d.slice(0, 7);
  }
  function moverPeriodo(p, k) {
    var a = Number(p.slice(0, 4)), m = Number(p.slice(5, 7)) - 1 + k;
    a += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return a + '-' + String(m + 1).padStart(2, '0');
  }
  function nombrePeriodo(p) { return MESES[Number(p.slice(5, 7)) - 1] + ' ' + p.slice(0, 4); }
  function fecha(d) { return d ? d.slice(8, 10) + '-' + d.slice(5, 7) + '-' + d.slice(0, 4) : '—'; }
  function pctTxt(p) { return p === null || p === undefined ? '—' : String(p).replace('.', ',') + ' %'; }

  // --- piezas -------------------------------------------------------------------------
  function selectorPeriodo(st) {
    var esActual = st.periodo >= hoyPeriodo();
    return '<div class="cu2-periodo" role="group" aria-label="Mes">' +
      U.boton({ soloIcono: true, icono: 'izquierda', titulo: 'Mes anterior', clase: 'js-cu2-mes', datos: { k: -1 }, sm: true }) +
      '<strong class="cu2-periodo__txt">' + esc(nombrePeriodo(st.periodo)) + '</strong>' +
      U.boton({ soloIcono: true, icono: 'derecha', titulo: 'Mes siguiente', clase: 'js-cu2-mes', datos: { k: 1 }, sm: true, deshabilitado: esActual }) +
    '</div>';
  }

  function senales(s) {
    function item(n, texto, tono, ayuda) {
      return '<li class="cu2-senal sx2-tono-' + (n ? tono : 'neutro') + '" title="' + esc(ayuda) + '"><strong>' + n + '</strong><span>' + esc(texto) + '</span></li>';
    }
    return '<ul class="cu2-senales" aria-label="Señales que no entran a la fórmula">' +
      item(s.sin_fecha, s.sin_fecha === 1 ? 'tarea sin fecha' : 'tareas sin fecha', 'alerta', 'Tareas abiertas sin fecha comprometida: nunca se atrasan, por eso se muestran aparte.') +
      item(s.dormidas, s.dormidas === 1 ? 'tarea dormida' : 'tareas dormidas', 'alerta', 'Tareas abiertas sin ningún movimiento en 14 días.') +
      item(s.reprogramaciones, s.reprogramaciones === 1 ? 'reprogramación' : 'reprogramaciones', 'info', 'Cambios de fecha registrados en el mes.') +
      (s.reprogramaciones_que_no_cuentan ? item(s.reprogramaciones_que_no_cuentan, 'no movieron la meta', 'critico', 'Reprogramaciones hechas por la misma persona o después de vencer: el atraso se mide contra la fecha original.') : '') +
    '</ul>';
  }

  function tarjetaComponente(c, i) {
    var tono = !c.aplica ? 'neutro' : TONO[c.pct >= 90 ? 'ok' : (c.pct >= 75 ? 'alerta' : 'critico')];
    return '<button type="button" class="cu2-comp sx2-tono-' + tono + ' sx2-entra js-cu2-comp" data-clave="' + esc(c.clave) + '" style="--i:' + (i + 2) + '">' +
      '<span class="cu2-comp__cab"><span class="cu2-comp__nombre">' + esc(c.nombre) + '</span><span class="cu2-comp__peso">' + c.peso + ' %</span></span>' +
      '<span class="cu2-comp__valor">' + (c.casos ? esc(pctTxt(c.pct)) : '—') + '</span>' +
      U.barra(c.pct || 0, tono) +
      '<span class="cu2-comp__pie">' + (c.casos ? c.cumplidos + ' de ' + c.casos + ' a tiempo' : 'Sin casos este mes') +
        (c.casos && !c.aplica ? ' · no cuenta (menos de 3)' : '') + '</span>' +
    '</button>';
  }

  function tablaCasos(c) {
    if (!c.detalle.length && !(c.neutras || []).length) return '<p class="sx2-tenue cu2-nada">Nada que medir este mes en este componente.</p>';
    var orden = c.detalle.slice().sort(function (a, b) { return (a.ok === b.ok) ? 0 : (a.ok ? 1 : -1); });
    var filas = orden.map(function (x) {
      var que = x.titulo || x.tarea || x.tipo || '';
      var ref = x.referencia && x.referencia !== que ? '<span class="cu2-ref">' + esc(x.referencia) + '</span>' : '';
      var area = x.area ? '<span class="cu2-ref">' + esc(x.area) + '</span>' : '';
      var meta = x.meta || x.plazo || x.fecha || '';
      var orig = x.fecha_original && x.fecha_original !== x.meta ? '<span class="cu2-ref">original ' + esc(fecha(x.fecha_original)) + '</span>' : '';
      // Por qué la meta no se movió: la reprogramación que no cuenta, dicha.
      (x.reprogramaciones || []).filter(function (rp) { return !rp.cuenta && rp.a; }).forEach(function (rp) {
        ref += '<span class="cu2-ref cu2-ref--aviso">Reprogramada al ' + esc(fecha(rp.a)) + ': no cuenta, ' + esc(rp.motivo_no_cuenta) + '</span>';
      });
      var hecho = x.entregada || x.hecho || '';
      return '<tr><td>' + U.badge(x.estado, TONO_CASO[x.estado] || 'neutro') + '</td>' +
        '<td class="cu2-que"><span>' + esc(que) + '</span>' + ref + area + '</td>' +
        '<td class="sx2-num">' + esc(meta ? fecha(meta) : '—') + orig + '</td>' +
        '<td class="sx2-num">' + esc(hecho ? fecha(hecho) : '—') + '</td></tr>';
    }).join('');
    var neutras = (c.neutras || []).map(function (x) {
      return '<tr class="cu2-neutra"><td>' + U.badge('Neutra', 'neutro') + '</td><td class="cu2-que"><span>' + esc(x.titulo) + '</span><span class="cu2-ref">' + esc(x.motivo) + '</span></td>' +
        '<td class="sx2-num">' + esc(fecha(x.meta)) + '</td><td class="sx2-num">—</td></tr>';
    }).join('');
    return '<div class="sx2-tabla-wrap"><table class="sx2-tabla cu2-tabla"><thead><tr><th>Estado</th><th>Qué</th><th class="sx2-num">Meta</th><th class="sx2-num">Hecho</th></tr></thead>' +
      '<tbody>' + filas + neutras + '</tbody></table></div>';
  }

  function listaSimple(items, campoExtra, etiquetaExtra) {
    if (!items.length) return '<p class="sx2-tenue cu2-nada">Ninguna.</p>';
    return '<ul class="cu2-lista">' + items.map(function (x) {
      return '<li><span>' + esc(x.titulo) + '</span>' + (campoExtra && x[campoExtra] ? '<span class="cu2-ref">' + esc(etiquetaExtra) + ' ' + esc(fecha(x[campoExtra])) + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function vistaPersona(st, r) {
    var tono = TONO[r.estado] || 'neutro';
    var corteTxt = r.corte && r.corte.slice(0, 7) === r.periodo && r.corte < (r.periodo + '-31') ? ' · medido al ' + fecha(r.corte) : '';
    var cab = (st.volver ? '<div class="cu2-volver">' + U.boton({ texto: 'Volver a la lista', icono: 'izquierda', variante: 'fantasma', sm: true, clase: 'js-cu2-volver' }) + '</div>' : '') +
      '<div class="cu2-barra sx2-entra">' +
        (st.alcance !== 'yo' || st.volver ? U.persona({ nombre: r.nombre, email: r.email }, 'lg') : '<span class="sx2-tenue">Tu índice del mes</span>') +
        selectorPeriodo(st) +
      '</div>';
    var titular = '<section class="sx2-card cu2-titular sx2-entra sx2-tono-' + tono + '" style="--i:1">' +
      '<div class="cu2-titular__anillo">' + U.anillo(r.indice || 0, { tam: 112, grosor: 10, tono: tono, texto: r.indice === null ? '—' : pctTxt(r.indice) }) + '</div>' +
      '<div class="cu2-titular__txt">' +
        '<span class="cu2-titular__eti">Índice de ' + esc(nombrePeriodo(r.periodo)) + esc(corteTxt) + '</span>' +
        '<strong class="cu2-titular__estado">' + esc(ESTADO_TXT[r.estado] || '') + '</strong>' +
        '<p>' + esc(r.indice === null ? r.explicacion :
          'Verde desde ' + r.cortes.ok + ' %, amarillo desde ' + r.cortes.alerta + ' %. Cada componente cuenta con ' + r.min_casos + ' casos o más; abre uno para ver qué lo forma.') + '</p>' +
        senales(r.senales) +
      '</div>' +
    '</section>';
    var comps = '<div class="cu2-comps">' + r.componentes.map(tarjetaComponente).join('') + '</div>';
    var abierto = r.componentes.find(function (c) { return c.clave === st.componente; });
    var detalle = abierto ? U.card({ titulo: abierto.nombre, icono: 'lista', i: 6,
      sub: abierto.casos ? abierto.cumplidos + ' de ' + abierto.casos + ' a tiempo · pesa ' + abierto.peso + ' %' : 'sin casos este mes',
      cuerpo: tablaCasos(abierto) }) : '';
    var extras = '<div class="sx2-grid">' +
      '<div class="sx2-col-6">' + U.card({ titulo: 'Tareas dormidas', icono: 'reloj', sub: 'sin movimiento en ' + r.dias_dormida + ' días', i: 7,
        cuerpo: listaSimple(r.senales.detalle_dormidas, 'sin_movimiento_desde', 'último movimiento') }) + '</div>' +
      '<div class="sx2-col-6">' + U.card({ titulo: 'Tareas sin fecha', icono: 'calendario', sub: 'ponles fecha para que se puedan cumplir', i: 8,
        cuerpo: listaSimple(r.senales.detalle_sin_fecha) }) + '</div>' +
    '</div>';
    var como = '<details class="cu2-como sx2-entra" style="--i:9"><summary>Cómo se calcula</summary><ul>' +
      '<li><b>Compromisos con fecha (35 %)</b>: tareas que vencieron en el mes y se entregaron a tiempo. Se mide contra la fecha original: una reprogramación solo mueve la meta si la hizo tu jefatura o supervisor antes de que venciera.</li>' +
      '<li><b>Obligaciones del área (25 %)</b>: tareas internas de la Agenda de tu área marcadas hechas a tiempo.</li>' +
      '<li><b>Responsabilidades del SGC (20 %)</b>: acuses de documentos y etapas de no conformidades dentro de su plazo.</li>' +
      '<li><b>Reportabilidad (20 %)</b>: el reporte mensual del área a tiempo y tus tareas abiertas con movimiento en los últimos ' + r.dias_dormida + ' días.</li>' +
      '<li>Lo que vence hoy todavía no es atraso. Una tarea bloqueada por otra persona queda neutra.</li>' +
    '</ul></details>';
    return cab + titular + comps + detalle + extras + como;
  }

  function vistaLista(st, r) {
    var rs = r.resumen || {};
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ icono: 'grafico', tono: TONO[rs.estado] || 'neutro', etiqueta: 'Índice promedio', valor: rs.indice_promedio === null ? '—' : pctTxt(rs.indice_promedio), i: 1,
        titulo: 'Promedio de las personas con índice este mes' }) +
      U.kpi({ icono: 'equipo', tono: 'primario', etiqueta: 'Personas con índice', valor: (rs.con_indice || 0) + ' de ' + (rs.personas || 0), i: 2 }) +
      U.kpi({ icono: 'alerta', tono: rs.en_rojo ? 'critico' : 'ok', etiqueta: 'Bajo 75 %', valor: rs.en_rojo || 0, i: 3 }) +
      U.kpi({ icono: 'reloj', tono: (rs.dormidas || rs.sin_fecha) ? 'alerta' : 'ok', etiqueta: 'Dormidas / sin fecha', valor: (rs.dormidas || 0) + ' / ' + (rs.sin_fecha || 0), i: 4 }) +
    '</div>';
    var barra = '<div class="cu2-barra sx2-entra"><span class="sx2-tenue">' +
      esc(st.alcance === 'empresa' ? 'Toda la empresa, en orden alfabético.' : 'Tu equipo, en orden alfabético.') + '</span>' + selectorPeriodo(st) + '</div>';
    if (!r.personas.length) {
      return barra + U.card({ cuerpo: U.vacio({ icono: 'equipo', titulo: st.alcance === 'equipo' ? 'No tienes un equipo asignado' : 'Nadie con trabajo medible este mes',
        texto: st.alcance === 'equipo' ? 'El equipo sale de Jefaturas y de las listas de cada departamento.' : 'Aparecerá quien tenga tareas, obligaciones o plazos en el mes.' }) });
    }
    var cols = (r.personas[0].componentes || []).map(function (c) { return '<th class="sx2-num" title="' + esc(c.nombre) + '">' + esc(c.clave) + '</th>'; }).join('');
    var filas = r.personas.map(function (p) {
      var tono = TONO[p.estado] || 'neutro';
      return '<tr class="sx2-fila--clic js-cu2-persona" tabindex="0" data-email="' + esc(p.email) + '">' +
        '<td>' + U.persona({ nombre: p.nombre, email: p.email }) + '</td>' +
        '<td class="cu2-indice"><span class="cu2-indice__n sx2-tono-' + tono + '">' + esc(p.indice === null ? '—' : pctTxt(p.indice)) + '</span>' + U.barra(p.indice || 0, tono) + '</td>' +
        p.componentes.map(function (c) {
          return '<td class="sx2-num' + (c.aplica ? '' : ' cu2-no-aplica') + '" title="' + esc(c.nombre + (c.casos ? ': ' + c.casos + ' casos' : ': sin casos') + (c.casos && !c.aplica ? ' (no cuenta)' : '')) + '">' + esc(c.casos ? pctTxt(c.pct) : '—') + '</td>';
        }).join('') +
        '<td class="sx2-num">' + (p.senales.dormidas ? U.badge(String(p.senales.dormidas), 'alerta', true) : '0') + '</td>' +
        '<td class="sx2-num">' + (p.senales.sin_fecha ? U.badge(String(p.senales.sin_fecha), 'alerta', true) : '0') + '</td>' +
        '<td class="sx2-num">' + (p.senales.reprogramaciones || 0) + '</td>' +
      '</tr>';
    }).join('');
    var tabla = U.card({ titulo: 'Por persona', icono: 'lista', sub: 'abre una fila para ver el detalle', sinRelleno: true, i: 5,
      cuerpo: '<div class="sx2-tabla-wrap"><table class="sx2-tabla cu2-tabla"><thead><tr><th>Persona</th><th>Índice</th>' + cols +
        '<th class="sx2-num" title="Tareas sin movimiento en 14 días">Dormidas</th><th class="sx2-num">Sin fecha</th><th class="sx2-num">Reprog.</th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
        '<p class="cu2-leyenda sx2-tenue">A compromisos con fecha · B obligaciones del área · C responsabilidades del SGC · D reportabilidad. En gris, componentes con menos de 3 casos (no cuentan).</p>' });
    return barra + kpis + tabla;
  }

  // --- carga y eventos ------------------------------------------------------------------
  function pintar(el) {
    var st = el._cu2;
    var t = ++st.turno;
    el.innerHTML = '<div class="cu2">' + U.esqueleto('kpis', 4) + U.esqueleto('tarjetas', 2) + '</div>';
    var pide = st.persona ? { email: st.persona, periodo: st.periodo }
      : (st.alcance === 'yo' ? { periodo: st.periodo } : { alcance: st.alcance, periodo: st.periodo });
    api('getCumplimientoResponsables', pide).then(function (r) {
      if (t !== st.turno || !el.isConnected) return;
      if (!r || !r.ok) {
        el.innerHTML = '<div class="cu2">' + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar el cumplimiento',
          texto: (r && r.message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-cu2-recargar' }) }) }) + '</div>';
        return;
      }
      var d = r.data;
      st.ultimo = d;
      var html = (st.persona || st.alcance === 'yo') ? vistaPersona(Object.assign({}, st, { volver: !!st.persona }), d) : vistaLista(st, d);
      el.innerHTML = '<div class="cu2">' + html + '</div>';
      U.animar(el);
      var correos = d.personas ? d.personas.map(function (p) { return p.email; }) : [d.email];
      U.precargarFotos(correos).then(function () {
        if (t !== st.turno || !el.isConnected) return;
        el.querySelectorAll('.sx2-avatar').forEach(function (a) {
          var p = a.closest('[data-email]');
          if (p && window.SigsoPerfil && SigsoPerfil.fotoDe && !a.querySelector('img')) {
            var f = SigsoPerfil.fotoDe(p.getAttribute('data-email'));
            if (f) a.insertAdjacentHTML('beforeend', '<img src="' + esc(f) + '" alt="" loading="lazy" onerror="this.remove()">');
          }
        });
      });
    });
  }
  function repintarDetalle(el) {
    var st = el._cu2;
    if (!st.ultimo || (!st.persona && st.alcance !== 'yo')) return pintar(el);
    el.innerHTML = '<div class="cu2">' + vistaPersona(Object.assign({}, st, { volver: !!st.persona }), st.ultimo) + '</div>';
    U.animar(el);
    el.querySelectorAll('.sx2-entra').forEach(function (n) { n.style.animation = 'none'; });
    var d = el.querySelector('.sx2-card:not(.cu2-titular)');
    if (d && st.componente) d.scrollIntoView({ block: 'nearest', behavior: U.reducirMovimiento() ? 'auto' : 'smooth' });
  }

  function montar(el, opciones) {
    if (!el) return;
    var o = opciones || {};
    el._cu2 = { alcance: o.alcance || 'yo', periodo: o.periodo || hoyPeriodo(), persona: '', componente: '', turno: 0, ultimo: null };
    el.setAttribute('data-cumpl-montado', '1');
    if (!el._cu2Eventos) {
      el._cu2Eventos = true;
      el.addEventListener('click', function (ev) {
        var st = el._cu2, t = ev.target, b;
        if ((b = t.closest('.js-cu2-mes'))) { if (b.disabled) return; st.periodo = moverPeriodo(st.periodo, Number(b.getAttribute('data-k'))); st.componente = ''; pintar(el); return; }
        if ((b = t.closest('.js-cu2-comp'))) { var k = b.getAttribute('data-clave'); st.componente = st.componente === k ? '' : k; repintarDetalle(el); return; }
        if ((b = t.closest('.js-cu2-persona'))) { st.persona = b.getAttribute('data-email'); st.componente = ''; pintar(el); window.scrollTo(0, 0); return; }
        if (t.closest('.js-cu2-volver')) { st.persona = ''; st.componente = ''; pintar(el); return; }
        if (t.closest('.js-cu2-recargar')) { pintar(el); }
      });
      el.addEventListener('keydown', function (ev) {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('tr.js-cu2-persona')) { ev.preventDefault(); ev.target.click(); }
      });
    }
    pintar(el);
  }
  function montarPendientes(raiz) {
    (raiz || document).querySelectorAll('[data-cumpl-host]:not([data-cumpl-montado])').forEach(function (el) {
      montar(el, { alcance: el.getAttribute('data-alcance') || 'yo' });
    });
  }
  function recargar(raiz) {
    (raiz || document).querySelectorAll('[data-cumpl-montado]').forEach(function (el) { if (el._cu2) pintar(el); });
  }

  window.SigsoCumplimiento = { montar: montar, montarPendientes: montarPendientes, recargar: recargar };
})();
