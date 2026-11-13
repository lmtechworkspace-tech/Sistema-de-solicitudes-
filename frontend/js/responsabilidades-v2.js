/**
 * responsabilidades-v2.js — pantallas del MAPA DE RESPONSABILIDADES (Plan de
 * control y certificación, P2; backend responsabilidades.js).
 *
 * Un solo componente que se pinta en:
 *  - Mi trabajo → «Mis responsabilidades» (alcance 'yo'): qué le toca a la
 *    persona, agrupado por frecuencia, y el checklist del período para las que
 *    se comprueban con evidencia («Marcar hecho» con su respaldo).
 *  - Equipo del área / Mi departamento → «Responsabilidades del equipo»
 *    ('equipo') y Calidad → «Responsabilidades» ('empresa'): una tarjeta por
 *    persona; al abrirla, la jefatura genera la propuesta desde el descriptor,
 *    la ajusta (texto, frecuencia, cómo se comprueba) y la aprueba.
 *
 * Uso: SigsoResponsabilidades.montar(el, { alcance }) o un marcador
 * <div data-resp-host data-alcance="…"> + montarPendientes().
 */
(function () {
  'use strict';

  var U = window.UIv2;
  var FREC = { DIARIA: 'Diarias', SEMANAL: 'Semanales', MENSUAL: 'Mensuales', TRIMESTRAL: 'Trimestrales', ANUAL: 'Anuales', EVENTUAL: 'Cuando ocurren' };
  var FREC_UNA = { DIARIA: 'Diaria', SEMANAL: 'Semanal', MENSUAL: 'Mensual', TRIMESTRAL: 'Trimestral', ANUAL: 'Anual', EVENTUAL: 'Cuando ocurre' };
  var PERIODO = { DIARIA: 'hoy', SEMANAL: 'esta semana', MENSUAL: 'este mes', TRIMESTRAL: 'este trimestre', ANUAL: 'este año', EVENTUAL: '' };
  var ICONO_ORIGEN = { DESCRIPTOR: 'documento', PROCESO: 'capas', AGENDA: 'calendario', MANUAL: 'persona' };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function api(accion, datos) {
    return llamarApi((window.SIGSO_CONFIG || {}).BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    }).then(function (r) {
      if (r && r.ok && r.data && r.data._validationError) return { ok: false, message: r.data.message };
      return r;
    });
  }
  var esc = function (s) { return U.esc(s); };
  function aviso(t, tipo) { if (window.Componentes && Componentes.aviso) Componentes.aviso({ texto: t, tipo: tipo || 'info' }); }
  function fecha(d) { return d ? Number(d.slice(8, 10)) + ' ' + MESES[Number(d.slice(5, 7)) - 1] : ''; }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }
  function esEnlace(t) { return /^https?:\/\//i.test(String(t || '').trim()); }

  // --- vista de una persona -------------------------------------------------------------
  function estadoChip(i) {
    var p = i.periodo_actual || {};
    if (i.estado_mapa !== 'APROBADA') return U.badge('Por aprobar', 'neutro');
    if (p.estado === 'AUTOMATICA') return '<span class="re2-auto">' + U.ico('rayo', 13) + 'SIGSO lo mide</span>';
    if (p.estado === 'HECHA') return U.badge('Hecha ' + fecha(p.registro.hecho_en), 'ok');
    if (p.estado === 'EVENTUAL') return U.badge('Cuando ocurra', 'info');
    return U.badge('Pendiente ' + PERIODO[i.frecuencia] + (p.hasta ? ' · hasta el ' + fecha(p.hasta) : ''), 'alerta');
  }
  function filaItem(i, st, d) {
    var p = i.periodo_actual || {};
    var propio = d.es_propio && i.estado_mapa === 'APROBADA' && i.medicion === 'EVIDENCIA';
    var accionPropia = !propio ? '' : (p.estado === 'HECHA'
      ? U.boton({ texto: 'Deshacer', variante: 'fantasma', sm: true, clase: 'js-re2-deshacer', datos: { id: p.registro.registro_id } })
      : U.boton({ texto: i.frecuencia === 'EVENTUAL' ? 'Registrar' : 'Marcar hecha', icono: 'check', variante: 'primario', sm: true, clase: 'js-re2-marcar', datos: { id: i.resp_id } }));
    var edicion = d.puede_editar ? U.boton({ soloIcono: true, icono: 'editar', titulo: 'Editar', variante: 'fantasma', sm: true, clase: 'js-re2-editar', datos: { id: i.resp_id } }) +
      U.boton({ soloIcono: true, icono: 'basura', titulo: 'Quitar', variante: 'fantasma', sm: true, clase: 'js-re2-quitar', datos: { id: i.resp_id } }) : '';
    var evid = p.estado === 'HECHA' && p.registro.evidencia
      ? '<span class="re2-item__evid">' + U.ico('adjunto', 12) + (esEnlace(p.registro.evidencia) ? '<a href="' + esc(p.registro.evidencia) + '" target="_blank" rel="noopener">' + esc(p.registro.evidencia) + '</a>' : esc(p.registro.evidencia)) + '</span>' : '';
    var tono = i.estado_mapa !== 'APROBADA' ? 'neutro' : (p.estado === 'HECHA' ? 'ok' : (p.estado === 'PENDIENTE' ? 'alerta' : 'info'));
    return '<li class="re2-item sx2-tono-' + tono + '">' +
      '<span class="re2-item__ico" title="' + esc(i.origen_txt) + '">' + U.ico(ICONO_ORIGEN[i.origen] || 'lista', 15) + '</span>' +
      '<div class="re2-item__txt"><strong>' + esc(i.texto) + '</strong>' +
        '<span class="re2-item__meta">' + esc(FREC_UNA[i.frecuencia]) + ' · ' + esc(i.medicion === 'AUTOMATICA' ? 'la mide SIGSO (' + (i.fuente_auto || 'datos del sistema') + ')' : 'se comprueba con evidencia') + ' · ' + esc(i.origen_txt) + '</span>' + evid + '</div>' +
      '<div class="re2-item__est">' + estadoChip(i) + accionPropia + edicion + '</div></li>';
  }
  function vistaPersona(st, d) {
    var r = d.resumen;
    var cab = (st.volver ? '<div class="re2-volver">' + U.boton({ texto: 'Volver a la lista', icono: 'izquierda', variante: 'fantasma', sm: true, clase: 'js-re2-volver' }) + '</div>' : '') +
      '<div class="re2-barra">' + (st.alcance !== 'yo' || st.volver ? U.persona({ nombre: d.nombre, email: d.email, cargo: d.cargo }, 'lg') : '<span class="re2-barra__txt">Lo que te toca' + (d.cargo ? ' como ' + esc(d.cargo) : '') + '</span>') +
      (d.puede_editar ? '<span class="re2-acc">' + U.boton({ texto: 'Generar propuesta', icono: 'destello', variante: 'fantasma', sm: true, clase: 'js-re2-proponer', titulo: 'Desde el descriptor de cargo, los procesos a cargo y la Agenda del área' }) +
        U.boton({ texto: 'Agregar', icono: 'nueva', sm: true, clase: 'js-re2-agregar' }) +
        (r.propuestas ? U.boton({ texto: 'Aprobar ' + plural(r.propuestas, 'responsabilidad', 'responsabilidades'), icono: 'check', variante: 'primario', sm: true, clase: 'js-re2-aprobar' }) : '') + '</span>' : '') + '</div>';
    if (!r.total) {
      return cab + U.card({ cuerpo: U.vacio({ icono: 'lista', titulo: d.es_propio ? 'Tu mapa de responsabilidades todavía no está armado' : 'Sin mapa de responsabilidades',
        texto: d.puede_editar ? '«Generar propuesta» arma la lista desde el descriptor de cargo, los procesos a cargo y la Agenda del área. Después se ajusta y se aprueba.' : 'Tu jefatura lo arma desde tu descriptor de cargo y lo aprueba. Cuando esté, aquí verás qué te toca y podrás marcar lo que hiciste.' }) });
    }
    var tarjetas = '<div class="re2-resumen">' +
      '<div class="re2-num"><strong>' + r.aprobadas + '</strong><span>aprobadas</span></div>' +
      (r.propuestas ? '<div class="re2-num sx2-tono-alerta"><strong>' + r.propuestas + '</strong><span>por aprobar</span></div>' : '') +
      '<div class="re2-num sx2-tono-info"><strong>' + r.automaticas + '</strong><span>las mide SIGSO</span></div>' +
      '<div class="re2-num sx2-tono-' + (r.con_evidencia && r.hechas === r.con_evidencia ? 'ok' : 'primario') + '"><strong>' + r.hechas + ' / ' + r.con_evidencia + '</strong><span>con evidencia, hechas en su período</span>' +
        (r.con_evidencia ? U.barra(r.hechas * 100 / r.con_evidencia, r.hechas === r.con_evidencia ? 'ok' : 'primario') : '') + '</div></div>';
    var grupos = {};
    d.items.forEach(function (i) { (grupos[i.frecuencia] = grupos[i.frecuencia] || []).push(i); });
    var html = (d.frecuencias || Object.keys(FREC)).filter(function (f) { return grupos[f]; }).map(function (f, k) {
      return '<section class="sx2-card re2-grupo sx2-entra" style="--i:' + (k + 2) + '"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('calendario', 17) + esc(FREC[f]) +
        ' <span class="sx2-card__sub">' + plural(grupos[f].length, 'responsabilidad', 'responsabilidades') + '</span></h2></div><ul class="re2-items">' + grupos[f].map(function (i) { return filaItem(i, st, d); }).join('') + '</ul></section>';
    }).join('');
    var nota = d.es_propio ? '<p class="re2-nota">' + U.ico('info', 14) + 'Las semanales y mensuales que se comprueban con evidencia suman a tu índice de cumplimiento: márcalas dentro de su período, con el enlace al Drive o lo que hiciste y dónde quedó.</p>' : '';
    return cab + tarjetas + html + nota;
  }

  // --- vista de lista (equipo / empresa) ---------------------------------------------------
  function vistaLista(st, d) {
    var rs = d.resumen;
    var cab = '<div class="re2-barra"><span class="re2-barra__txt">' + esc(st.alcance === 'empresa' ? 'Toda la empresa' : 'Tu equipo') + ' <span class="sx2-tenue">· en orden alfabético</span></span></div>' +
      '<div class="re2-resumen">' +
        '<div class="re2-num"><strong>' + rs.personas + '</strong><span>personas</span></div>' +
        '<div class="re2-num sx2-tono-ok"><strong>' + rs.aprobados + '</strong><span>con el mapa aprobado</span></div>' +
        '<div class="re2-num sx2-tono-alerta"><strong>' + rs.por_aprobar + '</strong><span>con algo por aprobar</span></div>' +
        '<div class="re2-num sx2-tono-' + (rs.sin_mapa ? 'critico' : 'ok') + '"><strong>' + rs.sin_mapa + '</strong><span>sin mapa</span></div></div>';
    if (!d.personas.length) return cab + U.card({ cuerpo: U.vacio({ icono: 'equipo', titulo: 'No hay personas que mostrar', texto: 'El equipo sale de Jefaturas y de las listas de cada departamento; la empresa, de las fichas del SGC.' }) });
    var tarjetas = '<div class="re2-personas">' + d.personas.map(function (p, k) {
      var r = p.resumen;
      var tono = !r.total ? 'critico' : (r.propuestas ? 'alerta' : 'ok');
      var est = !r.total ? 'Sin mapa' : (r.propuestas ? plural(r.propuestas, 'por aprobar', 'por aprobar') : 'Aprobado');
      return '<button type="button" class="sx2-card re2-persona sx2-tono-' + tono + ' sx2-entra js-re2-persona" data-email="' + esc(p.email) + '" style="--i:' + (k + 2) + '">' +
        U.persona({ nombre: p.nombre, email: p.email, cargo: p.cargo }) +
        '<span class="re2-persona__est">' + U.badge(est, tono) + '</span>' +
        '<span class="re2-persona__nums">' + (r.total ? plural(r.aprobadas, 'aprobada', 'aprobadas') + ' · ' + r.hechas + '/' + r.con_evidencia + ' con evidencia hechas' : 'Genera la propuesta desde su descriptor') + '</span>' +
      '</button>';
    }).join('') + '</div>';
    return cab + tarjetas;
  }

  // --- formularios ---------------------------------------------------------------------------
  function opcionesFrec(sel) {
    return Object.keys(FREC_UNA).map(function (f) { return '<option value="' + f + '"' + (f === sel ? ' selected' : '') + '>' + esc(FREC_UNA[f]) + '</option>'; }).join('');
  }
  function formItem(el, item) {
    var st = el._re2, d = st.ultimo, i = item || {};
    U.formulario({ titulo: item ? 'Editar responsabilidad' : 'Nueva responsabilidad', boton: 'Guardar',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + esc(d.nombre) + (item && item.estado_mapa === 'APROBADA' ? ' · si cambias lo que se exige, vuelve a quedar por aprobar' : '') + '</span>',
      campos: U.campo('Qué le toca', '<textarea class="sx2-input" name="texto" rows="3" required>' + esc(i.texto || '') + '</textarea>', 'Escrito como una tarea que se puede comprobar.') +
        U.campo('Frecuencia', '<select class="sx2-select" name="frecuencia">' + opcionesFrec(i.frecuencia || 'MENSUAL') + '</select>') +
        U.campo('Cómo se comprueba', '<select class="sx2-select" name="medicion"><option value="EVIDENCIA"' + (i.medicion !== 'AUTOMATICA' ? ' selected' : '') + '>Con evidencia: la persona la marca hecha y deja el respaldo</option>' +
          '<option value="AUTOMATICA"' + (i.medicion === 'AUTOMATICA' ? ' selected' : '') + '>Automática: SIGSO ya lo ve (Agenda, tareas, SGC)</option></select>') +
        U.campo('Dónde lo ve SIGSO (si es automática)', '<input class="sx2-input" name="fuente_auto" value="' + esc(i.fuente_auto || '') + '" placeholder="Agenda del área, tareas, SGC…">'),
      enviar: function (v) {
        if (item) v.resp_id = item.resp_id; else v.persona_email = d.email;
        return api('guardarResponsabilidad', v);
      },
      aviso: 'Guardado.', listo: function () { pintar(el, true); } });
  }
  function formMarcar(el, item) {
    var esEventual = item.frecuencia === 'EVENTUAL';
    U.formulario({ titulo: esEventual ? 'Registrar' : 'Marcar hecha', boton: esEventual ? 'Registrar' : 'Marcar hecha',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + esc(item.texto) + '</span>',
      campos: U.campo('Respaldo', '<textarea class="sx2-input" name="evidencia" rows="3" required placeholder="Enlace al Drive, o qué hiciste y dónde quedó"></textarea>', 'Es la evidencia que verá el auditor.') +
        U.campo('Nota (opcional)', '<input class="sx2-input" name="nota">'),
      enviar: function (v) { v.resp_id = item.resp_id; return api('registrarResponsabilidad', v); },
      aviso: 'Listo: quedó registrada.', listo: function () { pintar(el, true); } });
  }

  // --- carga y eventos -------------------------------------------------------------------------
  function pintar(el, silencioso) {
    var st = el._re2;
    var t = ++st.turno;
    if (!silencioso || !st.ultimo) el.innerHTML = '<div class="re2">' + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 5) + '</div>';
    var pide = st.persona ? { email: st.persona } : (st.alcance === 'yo' ? {} : { alcance: st.alcance });
    api('listarResponsabilidades', pide).then(function (r) {
      if (t !== st.turno || !el.isConnected) return;
      if (!r || !r.ok) {
        el.innerHTML = '<div class="re2">' + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || 'Inténtalo de nuevo.',
          accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-re2-recargar' }) }) }) + '</div>';
        return;
      }
      st.ultimo = r.data;
      el.innerHTML = '<div class="re2">' + ((st.persona || st.alcance === 'yo') ? vistaPersona(Object.assign({}, st, { volver: !!st.persona }), r.data) : vistaLista(st, r.data)) + '</div>';
      U.animar(el);
      if (silencioso) el.querySelectorAll('.sx2-entra').forEach(function (n) { n.style.animation = 'none'; });
    });
  }
  function item(el, id) { return ((el._re2.ultimo || {}).items || []).filter(function (x) { return x.resp_id === id; })[0]; }

  function montar(el, opciones) {
    if (!el) return;
    var o = opciones || {};
    el._re2 = { alcance: o.alcance || 'yo', persona: '', turno: 0, ultimo: null };
    el.setAttribute('data-resp-montado', '1');
    if (!el._re2Eventos) {
      el._re2Eventos = true;
      el.addEventListener('click', function (ev) {
        var st = el._re2, t = ev.target, b;
        if ((b = t.closest('.js-re2-persona'))) { st.persona = b.getAttribute('data-email'); pintar(el); window.scrollTo(0, 0); return; }
        if (t.closest('.js-re2-volver')) { st.persona = ''; pintar(el); return; }
        if (t.closest('.js-re2-recargar')) { pintar(el); return; }
        if ((b = t.closest('.js-re2-marcar'))) { formMarcar(el, item(el, b.getAttribute('data-id'))); return; }
        if ((b = t.closest('.js-re2-deshacer'))) {
          api('deshacerRegistroResponsabilidad', { registro_id: b.getAttribute('data-id') }).then(function (r) { if (!r || !r.ok) aviso((r && r.message) || 'No se pudo deshacer.', 'error'); pintar(el, true); });
          return;
        }
        if ((b = t.closest('.js-re2-editar'))) { formItem(el, item(el, b.getAttribute('data-id'))); return; }
        if (t.closest('.js-re2-agregar')) { formItem(el, null); return; }
        if ((b = t.closest('.js-re2-quitar'))) {
          var it = item(el, b.getAttribute('data-id'));
          U.confirmar({ titulo: 'Quitar responsabilidad', texto: '«' + (it ? it.texto : '') + '» deja de pedírsele a la persona.', boton: 'Quitar', peligro: true }).then(function (si) {
            if (!si) return;
            api('quitarResponsabilidad', { resp_id: it.resp_id }).then(function (r) { if (!r || !r.ok) aviso((r && r.message) || 'No se pudo quitar.', 'error'); pintar(el, true); });
          });
          return;
        }
        if ((b = t.closest('.js-re2-proponer'))) {
          b.disabled = true;
          api('proponerResponsabilidades', { email: st.ultimo.email }).then(function (r) {
            b.disabled = false;
            if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo generar.', 'error'); return; }
            aviso(r.data.agregadas ? plural(r.data.agregadas, 'responsabilidad propuesta', 'responsabilidades propuestas') + '. Revísalas y apruébalas.' :
              (r.data.sin_fuentes ? 'No hay descriptor de cargo, procesos ni Agenda de donde sacarla: agrégalas a mano.' : 'No hay nada nuevo que proponer.'), r.data.agregadas ? 'exito' : 'info');
            pintar(el, true);
          });
          return;
        }
        if ((b = t.closest('.js-re2-aprobar'))) {
          U.confirmar({ titulo: 'Aprobar el mapa', texto: 'Desde ahora se le piden estas responsabilidades a ' + st.ultimo.nombre + ' y le llega un aviso. Las semanales y mensuales con evidencia entran a su índice de cumplimiento.', boton: 'Aprobar' }).then(function (si) {
            if (!si) return;
            api('aprobarResponsabilidades', { email: st.ultimo.email }).then(function (r) {
              if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo aprobar.', 'error'); return; }
              aviso('Mapa aprobado.', 'exito'); pintar(el, true);
            });
          });
        }
      });
    }
    pintar(el);
  }
  function montarPendientes(raiz) {
    (raiz || document).querySelectorAll('[data-resp-host]:not([data-resp-montado])').forEach(function (el) { montar(el, { alcance: el.getAttribute('data-alcance') || 'yo' }); });
  }
  function recargar(raiz) {
    (raiz || document).querySelectorAll('[data-resp-montado]').forEach(function (el) { if (el._re2) pintar(el); });
  }

  window.SigsoResponsabilidades = { montar: montar, montarPendientes: montarPendientes, recargar: recargar };

  // Calidad › Personas › «Responsabilidades» (toda la empresa, §5.3).
  window.SigsoCalidadResponsabilidadesV2 = {
    vistas: ['responsabilidades'],
    mostrar: function () {
      var C = window.SigsoCalidadV2 && SigsoCalidadV2.util;
      var c = C && C.contenedor('responsabilidades');
      if (!c) return;
      c.innerHTML = '<div class="sx2-pagina"><header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · Personas</span>' +
        '<h1>Responsabilidades</h1><span class="sx2-tenue" style="font-size:.875rem">Qué le toca a cada persona y cómo se comprueba (ISO 9001 §5.3). La jefatura genera la propuesta desde el descriptor de cargo y la aprueba.</span></div></header>' +
        '<div data-resp-host data-alcance="empresa"></div></div>';
      U.animar(c);
      montarPendientes(c);
    }
  };
})();
