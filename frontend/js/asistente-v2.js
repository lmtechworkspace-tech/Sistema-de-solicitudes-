/**
 * asistente-v2.js — el Asistente SIGSO (2026-11-11).
 *
 * Un botón flotante en todo SIGSO abre un panel de conversación. Se le
 * pregunta en lenguaje natural ("¿se declararon todos los IVA de octubre?",
 * "¿cómo comprometo una fecha?", "resume este reglamento") y responde con los
 * datos reales que la persona puede ver (el servidor consulta con SU sesión:
 * backend/logica/asistente.js).
 *
 *  - La respuesta llega en vivo (POST /v1/asistente, text/event-stream).
 *  - Adjuntos: PDF, Word, Excel, PowerPoint, imágenes y texto (botón, arrastrar
 *    o pegar una captura). Se suben con la acción asistenteAdjuntar.
 *  - Voz (sin costo, del navegador): dictar con el micrófono, escuchar las
 *    respuestas y "Conversar por voz" (escucha → pregunta → responde hablando
 *    → vuelve a escuchar).
 *  - La conversación queda en ESTE navegador (localStorage, solo texto); el
 *    servidor no guarda las preguntas.
 *
 * Aparece solo si la cuenta tiene el asistente (asistenteEstado responde ok).
 */
(function () {
  'use strict';

  var estado_ = null;          // respuesta de asistenteEstado
  var turnos_ = [];            // [{ rol:'usuario'|'asistente', texto, contexto?, adjuntos?:[{id,nombre}] }]
  var pendientes_ = [];        // adjuntos de la próxima pregunta: [{ id?, nombre, estado:'subiendo'|'listo'|'mal', error? }]
  var enCurso_ = null;         // AbortController de la respuesta en curso
  var panel_, cuerpo_, caja_, fab_, notaUso_, chipsAdj_, btnEnviar_, btnMic_, btnVoz_, btnConversar_;
  var leerEnVoz_ = false;      // leer cada respuesta en voz alta
  var conversando_ = false;    // modo conversación por voz
  var reconocedor_ = null, escuchando_ = false;

  var SUGERENCIAS = [
    ['¿Qué tengo pendiente hoy en SIGSO?', 'tareas'],
    ['¿Se declararon todos los IVA del mes pasado? ¿Cuántos clientes sin movimiento hubo?', 'dinero'],
    ['¿Qué solicitudes están vencidas y quién las tiene?', 'bandeja'],
    ['¿Qué no conformidades siguen abiertas y qué falta para cerrarlas?', 'medalla'],
    ['¿Cómo comprometo una fecha en una solicitud de la Bandeja?', 'libro'],
    ['Adjunta un documento (por ejemplo el reglamento interno) y pregúntame sobre él', 'adjunto']
  ];

  // --- utilidades ------------------------------------------------------------------------
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ico(n, t) { return window.Iconos ? Iconos.svg(n, { tam: t || 18 }) : ''; }
  var SVG = {
    mic: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    voz: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    conversar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M22 12h0"/></svg>',
    enviar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    parar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
  };
  function urlAsistente_() { return String((window.SIGSO_CONFIG || {}).NODE_API_URL || '').replace(/\/v1\/accion\/?$/, '/v1/asistente'); }
  function token_() { try { return localStorage.getItem('sigso_portal_token'); } catch (e) { return null; } }
  function llaveConv_() { return 'sigso_asistente_' + String((estado_ && estado_.yo) || 'yo').toLowerCase(); }
  function guardar_() {
    try { localStorage.setItem(llaveConv_(), JSON.stringify(turnos_.slice(-40))); } catch (e) { /* sin storage: solo esta pestaña */ }
  }
  function cargar_() {
    try { var l = JSON.parse(localStorage.getItem(llaveConv_()) || '[]'); turnos_ = Array.isArray(l) ? l : []; } catch (e) { turnos_ = []; }
  }
  function pantalla_() { return String(location.hash || '').slice(0, 80); }

  // --- Markdown mínimo y seguro (todo se escapa primero) ---------------------------------
  function enLinea_(t) {
    return t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(#\/[a-z0-9_\/-]+)/gi, '$1<a href="$2">$2</a>');
  }
  function markdown_(md) {
    var lineas = esc(md).split('\n');
    var html = [], i = 0;
    while (i < lineas.length) {
      var l = lineas[i];
      if (/^\s*```/.test(l)) {
        var bloque = []; i++;
        while (i < lineas.length && !/^\s*```/.test(lineas[i])) { bloque.push(lineas[i]); i++; }
        i++; html.push('<pre>' + bloque.join('\n') + '</pre>'); continue;
      }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lineas.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lineas[i + 1])) {
        var celdas = function (x) { return x.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return enLinea_(c.trim()); }); };
        var t = '<div class="asis-tabla"><table><thead><tr>' + celdas(l).map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
        i += 2;
        while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) { t += '<tr>' + celdas(lineas[i]).map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; i++; }
        html.push(t + '</tbody></table></div>'); continue;
      }
      var h = /^(#{1,4})\s+(.*)$/.exec(l);
      if (h) { html.push((h[1].length <= 2 ? '<h3>' : '<h4>') + enLinea_(h[2]) + (h[1].length <= 2 ? '</h3>' : '</h4>')); i++; continue; }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        var ordenada = /^\s*\d+[.)]/.test(l), items = [];
        while (i < lineas.length && /^\s*([-*•]|\d+[.)])\s+/.test(lineas[i])) { items.push('<li>' + enLinea_(lineas[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')) + '</li>'); i++; }
        html.push((ordenada ? '<ol>' : '<ul>') + items.join('') + (ordenada ? '</ol>' : '</ul>')); continue;
      }
      if (/^&gt;\s?/.test(l)) { html.push('<blockquote>' + enLinea_(l.replace(/^&gt;\s?/, '')) + '</blockquote>'); i++; continue; }
      if (!l.trim()) { i++; continue; }
      var parrafo = [l]; i++;
      while (i < lineas.length && lineas[i].trim() && !/^\s*([-*•]|\d+[.)])\s+|^#{1,4}\s|^\s*\||^\s*```|^&gt;/.test(lineas[i])) { parrafo.push(lineas[i]); i++; }
      html.push('<p>' + enLinea_(parrafo.join('<br>')) + '</p>');
    }
    return html.join('');
  }
  function textoPlano_(md) { return String(md || '').replace(/\|/g, ' ').replace(/[*_`#>]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/-{3,}/g, ' ').replace(/\s+\n/g, '\n'); }

  // --- voz (del navegador, sin costo) ----------------------------------------------------
  var Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
  function vozEs_() {
    if (!window.speechSynthesis) return null;
    var voces = speechSynthesis.getVoices() || [];
    return voces.filter(function (v) { return /^es[-_]CL/i.test(v.lang); })[0] ||
      voces.filter(function (v) { return /^es[-_](419|MX|US)/i.test(v.lang); })[0] ||
      voces.filter(function (v) { return /^es/i.test(v.lang); })[0] || null;
  }
  function hablar_(texto, alTerminar) {
    if (!window.speechSynthesis) { if (alTerminar) alTerminar(); return; }
    speechSynthesis.cancel();
    var limpio = textoPlano_(texto).slice(0, 4000);
    // Frases cortas: algunos navegadores cortan los textos largos.
    var partes = limpio.match(/[^.!?\n]+[.!?]?/g) || [limpio];
    var voz = vozEs_();
    partes.forEach(function (p, idx) {
      if (!p.trim()) return;
      var u = new SpeechSynthesisUtterance(p.trim());
      u.lang = voz ? voz.lang : 'es-CL';
      if (voz) u.voice = voz;
      u.rate = 1.05;
      if (idx === partes.length - 1 && alTerminar) u.onend = alTerminar;
      speechSynthesis.speak(u);
    });
    if (!partes.some(function (p) { return p.trim(); }) && alTerminar) alTerminar();
  }
  function callar_() { if (window.speechSynthesis) speechSynthesis.cancel(); }

  function escuchar_(alFinal) {
    if (!Reconocimiento) { avisoError_('Tu navegador no permite dictar. Usa Chrome o Edge.'); return; }
    if (escuchando_) { detenerEscucha_(); return; }
    callar_();
    reconocedor_ = new Reconocimiento();
    reconocedor_.lang = 'es-CL';
    reconocedor_.interimResults = true;
    reconocedor_.continuous = false;
    var base = caja_.value ? caja_.value.replace(/\s*$/, ' ') : '';
    var final = '';
    reconocedor_.onresult = function (ev) {
      var provisorio = '';
      for (var k = ev.resultIndex; k < ev.results.length; k++) {
        if (ev.results[k].isFinal) final += ev.results[k][0].transcript; else provisorio += ev.results[k][0].transcript;
      }
      caja_.value = base + final + provisorio;
      ajustarAlto_();
    };
    reconocedor_.onerror = function (ev) {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') avisoError_('El navegador no dio permiso para usar el micrófono.');
      else if (ev.error !== 'no-speech' && ev.error !== 'aborted') avisoError_('No pude escucharte (' + ev.error + ').');
      if (ev.error === 'no-speech' && conversando_) conversando_ = false, pintarBotonesVoz_();
    };
    reconocedor_.onend = function () {
      escuchando_ = false; pintarBotonesVoz_();
      if (alFinal && final.trim()) alFinal();
    };
    escuchando_ = true; pintarBotonesVoz_();
    try { reconocedor_.start(); } catch (e) { escuchando_ = false; pintarBotonesVoz_(); }
  }
  function detenerEscucha_() { if (reconocedor_) try { reconocedor_.stop(); } catch (e) { /* ya paró */ } }

  function pintarBotonesVoz_() {
    if (!btnMic_) return;
    btnMic_.classList.toggle('escuchando', escuchando_);
    btnMic_.setAttribute('aria-label', escuchando_ ? 'Dejar de escuchar' : 'Dictar por voz');
    btnMic_.title = escuchando_ ? 'Escuchando… toca para terminar' : 'Dictar por voz';
    btnVoz_.setAttribute('aria-pressed', leerEnVoz_ ? 'true' : 'false');
    btnConversar_.setAttribute('aria-pressed', conversando_ ? 'true' : 'false');
  }

  // --- pintar ----------------------------------------------------------------------------
  function construir_() {
    fab_ = document.createElement('button');
    fab_.type = 'button';
    fab_.className = 'asis-fab';
    fab_.hidden = true;
    fab_.setAttribute('aria-label', 'Abrir el Asistente SIGSO');
    fab_.title = 'Asistente SIGSO (Ctrl + .)';
    fab_.innerHTML = ico('destello', 20) + '<span class="asis-fab-texto">Pregúntale a SIGSO</span>';
    fab_.addEventListener('click', abrir);

    panel_ = document.createElement('aside');
    panel_.className = 'asis-panel';
    panel_.setAttribute('role', 'dialog');
    panel_.setAttribute('aria-label', 'Asistente SIGSO');
    panel_.hidden = true;
    panel_.innerHTML =
      '<div class="asis-soltar">Suelta aquí tus archivos</div>' +
      '<header class="asis-cabeza">' +
        '<div class="asis-logo">' + ico('destello', 20) + '</div>' +
        '<div class="asis-titulo"><b>Asistente SIGSO</b><span>Pregunta lo que quieras de SIGSO o de un documento</span></div>' +
        '<button type="button" class="asis-btn-icono" data-a="conversar" title="Conversar por voz: escucha, responde hablando y vuelve a escuchar" aria-label="Conversar por voz" aria-pressed="false">' + SVG.conversar + '</button>' +
        '<button type="button" class="asis-btn-icono" data-a="voz" title="Leer las respuestas en voz alta" aria-label="Leer respuestas en voz alta" aria-pressed="false">' + SVG.voz + '</button>' +
        '<button type="button" class="asis-btn-icono" data-a="nueva" title="Nueva conversación" aria-label="Nueva conversación">' + ico('editar', 18) + '</button>' +
        '<button type="button" class="asis-btn-icono" data-a="ancho" title="Agrandar o achicar" aria-label="Agrandar el panel">' + ico('expandir', 18) + '</button>' +
        '<button type="button" class="asis-btn-icono" data-a="cerrar" title="Cerrar (Esc)" aria-label="Cerrar">' + ico('equis', 18) + '</button>' +
      '</header>' +
      '<div class="asis-cuerpo" aria-live="polite"></div>' +
      '<footer class="asis-pie">' +
        '<div class="asis-adjuntos"></div>' +
        '<div class="asis-caja">' +
          '<button type="button" class="asis-btn-icono" data-a="adjuntar" title="Adjuntar PDF, Word, Excel, PowerPoint o imagen" aria-label="Adjuntar archivo">' + ico('adjunto', 18) + '</button>' +
          '<textarea rows="1" placeholder="Escribe tu pregunta…" aria-label="Tu pregunta"></textarea>' +
          '<button type="button" class="asis-btn-icono asis-mic" data-a="mic" aria-label="Dictar por voz" title="Dictar por voz">' + SVG.mic + '</button>' +
          '<button type="button" class="asis-btn-icono asis-enviar" data-a="enviar" aria-label="Enviar" title="Enviar (Enter)">' + SVG.enviar + '</button>' +
        '</div>' +
        '<input type="file" hidden multiple accept=".pdf,.docx,.xlsx,.xlsm,.pptx,.txt,.csv,.md,.json,.png,.jpg,.jpeg,.gif,.webp,application/pdf,image/*,text/*">' +
        '<p class="asis-nota"><span class="asis-uso"></span><span>Puede equivocarse: verifica lo importante.</span></p>' +
      '</footer>';
    var shell = document.getElementById('vista-shell') || document.body;
    shell.appendChild(fab_);
    shell.appendChild(panel_);

    cuerpo_ = panel_.querySelector('.asis-cuerpo');
    caja_ = panel_.querySelector('textarea');
    chipsAdj_ = panel_.querySelector('.asis-adjuntos');
    notaUso_ = panel_.querySelector('.asis-uso');
    btnEnviar_ = panel_.querySelector('[data-a="enviar"]');
    btnMic_ = panel_.querySelector('[data-a="mic"]');
    btnVoz_ = panel_.querySelector('[data-a="voz"]');
    btnConversar_ = panel_.querySelector('[data-a="conversar"]');
    var archivo = panel_.querySelector('input[type="file"]');
    if (!Reconocimiento) { btnMic_.hidden = true; btnConversar_.hidden = true; }
    if (!window.speechSynthesis) btnVoz_.hidden = true;
    try { leerEnVoz_ = localStorage.getItem('sigso_asistente_voz') === '1'; } catch (e) { /* */ }

    panel_.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'cerrar') cerrar();
      else if (a === 'ancho') { panel_.classList.toggle('ancho'); b.innerHTML = ico(panel_.classList.contains('ancho') ? 'reducir' : 'expandir', 18); }
      else if (a === 'nueva') nuevaConversacion_();
      else if (a === 'adjuntar') archivo.click();
      else if (a === 'enviar') { if (enCurso_) enCurso_.abort(); else enviar_(); }
      else if (a === 'mic') escuchar_(null);
      else if (a === 'voz') { leerEnVoz_ = !leerEnVoz_; if (!leerEnVoz_) callar_(); try { localStorage.setItem('sigso_asistente_voz', leerEnVoz_ ? '1' : '0'); } catch (e) { /* */ } pintarBotonesVoz_(); }
      else if (a === 'conversar') {
        conversando_ = !conversando_;
        pintarBotonesVoz_();
        if (conversando_) escuchar_(function () { enviar_(); }); else { detenerEscucha_(); callar_(); }
      }
      else if (a === 'sugerencia') {
        if (b.getAttribute('data-adjuntar')) { archivo.click(); return; }
        caja_.value = b.getAttribute('data-texto'); enviar_();
      }
      else if (a === 'copiar') copiar_(b);
      else if (a === 'escuchar') hablar_(turnos_[Number(b.getAttribute('data-i'))].texto);
    });
    // Rutas internas (#/...) que el asistente menciona: navegar y dejar el panel abierto.
    cuerpo_.addEventListener('click', function (ev) {
      var a = ev.target.closest('a[href^="#/"]');
      if (a && panel_.classList.contains('ancho')) panel_.classList.remove('ancho');
    });
    caja_.addEventListener('input', ajustarAlto_);
    caja_.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); if (!enCurso_) enviar_(); }
    });
    caja_.addEventListener('paste', function (ev) {
      var archivos = Array.prototype.filter.call((ev.clipboardData && ev.clipboardData.files) || [], function (f) { return /^image\//.test(f.type); });
      if (archivos.length) { ev.preventDefault(); subirArchivos_(archivos); }
    });
    archivo.addEventListener('change', function () { subirArchivos_(Array.prototype.slice.call(archivo.files || [])); archivo.value = ''; });
    ['dragenter', 'dragover'].forEach(function (n) { panel_.addEventListener(n, function (ev) { if (ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') !== -1) { ev.preventDefault(); panel_.classList.add('soltando'); } }); });
    ['dragleave', 'drop'].forEach(function (n) { panel_.addEventListener(n, function (ev) { if (n === 'dragleave' && panel_.contains(ev.relatedTarget)) return; panel_.classList.remove('soltando'); }); });
    panel_.addEventListener('drop', function (ev) { ev.preventDefault(); subirArchivos_(Array.prototype.slice.call((ev.dataTransfer && ev.dataTransfer.files) || [])); });
    document.addEventListener('keydown', function (ev) {
      if (fab_.hidden) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key === '.') { ev.preventDefault(); if (panel_.classList.contains('abierto')) cerrar(); else abrir(); }
      else if (ev.key === 'Escape' && panel_.classList.contains('abierto')) { if (enCurso_) return; cerrar(); }
    });
    if (window.speechSynthesis && speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = function () { /* carga las voces */ };
    pintarBotonesVoz_();
  }

  function ajustarAlto_() { caja_.style.height = 'auto'; caja_.style.height = Math.min(caja_.scrollHeight, 160) + 'px'; }
  function alFondo_() { cuerpo_.scrollTop = cuerpo_.scrollHeight; }

  function pintarUso_() {
    if (!estado_) return;
    notaUso_.textContent = estado_.disponible ? (estado_.usadas_hoy + ' de ' + estado_.tope_dia + ' preguntas hoy') : 'Aún no está configurado en el servidor';
  }

  function pintarConversacion_() {
    if (!turnos_.length) {
      cuerpo_.innerHTML = '<div class="asis-bienvenida"><h2>¿En qué te ayudo?</h2>' +
        '<p>Pregúntame por tus pendientes, solicitudes, proyectos, las matrices de tu área, Calidad o cómo hacer algo en SIGSO. También puedes adjuntar un documento y preguntarme sobre él, o hablarme con el micrófono. Veo lo mismo que tú: solo lo que tu cuenta puede ver.</p>' +
        '<div class="asis-sugerencias">' + SUGERENCIAS.map(function (s) {
          return '<button type="button" class="asis-sugerencia" data-a="sugerencia" data-texto="' + esc(s[0]) + '"' + (s[1] === 'adjunto' ? ' data-adjuntar="1"' : '') + '>' + ico(s[1], 16) + '<span>' + esc(s[0]) + '</span></button>';
        }).join('') + '</div></div>';
      return;
    }
    cuerpo_.innerHTML = turnos_.map(htmlTurno_).join('');
    alFondo_();
  }

  function htmlTurno_(t, i) {
    if (t.rol === 'usuario') {
      var adj = (t.adjuntos || []).length ? '<div class="asis-adjuntos-msg">' + t.adjuntos.map(function (a) { return '<span class="asis-chip">' + ico('documento', 13) + '<span>' + esc(a.nombre) + '</span></span>'; }).join('') + '</div>' : '';
      return '<div class="asis-msg usuario">' + adj + esc(t.texto) + '</div>';
    }
    if (t.error) return '<div class="asis-error" role="alert">' + esc(t.error) + '</div>';
    return '<div class="asis-msg asistente">' + markdown_(t.texto) +
      '<div class="asis-acciones-msg">' +
        '<button type="button" class="asis-btn-icono" data-a="copiar" data-i="' + i + '" title="Copiar" aria-label="Copiar la respuesta">' + ico('copiar', 15) + '</button>' +
        (window.speechSynthesis ? '<button type="button" class="asis-btn-icono" data-a="escuchar" data-i="' + i + '" title="Escuchar" aria-label="Escuchar la respuesta">' + SVG.voz.replace(/18/g, '15') + '</button>' : '') +
      '</div></div>';
  }

  function avisoError_(msg) {
    var d = document.createElement('div');
    d.className = 'asis-error'; d.setAttribute('role', 'alert'); d.textContent = msg;
    if (cuerpo_.querySelector('.asis-bienvenida')) cuerpo_.innerHTML = '';
    cuerpo_.appendChild(d); alFondo_();
  }

  function copiar_(b) {
    var t = turnos_[Number(b.getAttribute('data-i'))];
    if (!t || !navigator.clipboard) return;
    navigator.clipboard.writeText(t.texto).then(function () { b.innerHTML = ico('check', 15); setTimeout(function () { b.innerHTML = ico('copiar', 15); }, 1500); });
  }

  function nuevaConversacion_() {
    if (enCurso_) enCurso_.abort();
    callar_();
    turnos_ = []; pendientes_ = [];
    guardar_(); pintarAdjuntos_(); pintarConversacion_();
    caja_.focus();
  }

  // --- adjuntos --------------------------------------------------------------------------
  function pintarAdjuntos_() {
    chipsAdj_.innerHTML = pendientes_.map(function (a, i) {
      return '<span class="asis-chip' + (a.estado === 'subiendo' ? ' subiendo' : '') + (a.estado === 'mal' ? ' mal' : '') + '" title="' + esc(a.error || a.nombre) + '">' +
        ico(a.estado === 'mal' ? 'alerta' : 'documento', 13) + '<span>' + esc(a.estado === 'subiendo' ? 'Subiendo ' + a.nombre + '…' : (a.error || a.nombre)) + '</span>' +
        '<button type="button" data-quitar="' + i + '" aria-label="Quitar ' + esc(a.nombre) + '">' + ico('equis', 12) + '</button></span>';
    }).join('');
    Array.prototype.forEach.call(chipsAdj_.querySelectorAll('[data-quitar]'), function (b) {
      b.addEventListener('click', function () { pendientes_.splice(Number(b.getAttribute('data-quitar')), 1); pintarAdjuntos_(); });
    });
  }

  function leerBase64_(archivo) {
    return new Promise(function (ok, mal) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).replace(/^data:[^,]*,/, '')); };
      r.onerror = function () { mal(new Error('No se pudo leer el archivo.')); };
      r.readAsDataURL(archivo);
    });
  }

  function subirArchivos_(archivos) {
    archivos.slice(0, 5).forEach(function (f) {
      var a = { nombre: f.name || 'captura.png', estado: 'subiendo' };
      pendientes_.push(a); pintarAdjuntos_();
      if (f.size > 24 * 1024 * 1024) { a.estado = 'mal'; a.error = f.name + ': pesa más de 24 MB'; pintarAdjuntos_(); return; }
      leerBase64_(f).then(function (b64) {
        return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'asistenteAdjuntar', { nombre: a.nombre, mime: f.type || '', contenido_base64: b64 });
      }).then(function (r) {
        if (r && r.ok) { a.id = r.data.adjunto_id; a.estado = 'listo'; }
        else { a.estado = 'mal'; a.error = (r && r.message) || 'No se pudo subir'; }
        pintarAdjuntos_();
      }).catch(function (e) { a.estado = 'mal'; a.error = e.message; pintarAdjuntos_(); });
    });
  }

  // --- preguntar -------------------------------------------------------------------------
  function enviar_() {
    var pregunta = caja_.value.trim();
    if (pendientes_.some(function (a) { return a.estado === 'subiendo'; })) { avisoError_('Espera a que terminen de subir los archivos.'); return; }
    var adjuntos = pendientes_.filter(function (a) { return a.estado === 'listo'; });
    if (!pregunta && !adjuntos.length) { caja_.focus(); return; }
    if (!pregunta) pregunta = 'Revisa el archivo adjunto y dime de qué trata, con lo más importante.';
    if (enCurso_) return;
    callar_();
    var historial = turnos_.filter(function (t) { return !t.error; }).map(function (t) {
      return { rol: t.rol, texto: t.texto, contexto: t.contexto, adjuntos: (t.adjuntos || []).map(function (a) { return a.id; }) };
    });
    var turnoU = { rol: 'usuario', texto: pregunta, adjuntos: adjuntos.map(function (a) { return { id: a.id, nombre: a.nombre }; }) };
    var turnoA = { rol: 'asistente', texto: '' };
    turnos_.push(turnoU);
    caja_.value = ''; ajustarAlto_();
    pendientes_ = []; pintarAdjuntos_();
    if (cuerpo_.querySelector('.asis-bienvenida')) cuerpo_.innerHTML = '';
    cuerpo_.insertAdjacentHTML('beforeend', htmlTurno_(turnoU, turnos_.length - 1));
    var nodo = document.createElement('div');
    nodo.className = 'asis-msg asistente';
    nodo.innerHTML = '<div class="asis-estado"><span class="asis-puntos"><i></i><i></i><i></i></span><span>Pensando…</span></div>';
    cuerpo_.appendChild(nodo); alFondo_();

    var control = new AbortController();
    enCurso_ = control;
    btnEnviar_.innerHTML = SVG.parar; btnEnviar_.setAttribute('aria-label', 'Detener'); btnEnviar_.title = 'Detener';
    var estadoTxt = 'Pensando…', huboError = '';
    var pintar = function () {
      nodo.innerHTML = (turnoA.texto ? markdown_(turnoA.texto) : '') +
        (enCurso_ ? '<div class="asis-estado"><span class="asis-puntos"><i></i><i></i><i></i></span><span>' + esc(estadoTxt) + '</span></div>' : '');
      var cerca = cuerpo_.scrollHeight - cuerpo_.scrollTop - cuerpo_.clientHeight < 140;
      if (cerca) alFondo_();
    };
    var cuadro = null;
    var pintarLuego = function () { if (!cuadro) cuadro = requestAnimationFrame(function () { cuadro = null; pintar(); }); };

    fetch(urlAsistente_(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ portal_token: token_(), pregunta: pregunta, adjuntos: turnoU.adjuntos.map(function (a) { return a.id; }), historial: historial, pantalla: pantalla_() }),
      signal: control.signal
    }).then(function (resp) {
      if (!resp.ok || !resp.body) throw new Error('El servidor no respondió (' + resp.status + ').');
      var lector = resp.body.getReader(), dec = new TextDecoder(), resto = '';
      var leer = function () {
        return lector.read().then(function (r) {
          if (r.done) return;
          resto += dec.decode(r.value, { stream: true });
          var trozos = resto.split('\n\n');
          resto = trozos.pop();
          trozos.forEach(function (tz) {
            var linea = tz.replace(/^data:\s?/, '');
            if (!linea) return;
            var ev; try { ev = JSON.parse(linea); } catch (e) { return; }
            if (ev.tipo === 'texto') { turnoA.texto += ev.t; estadoTxt = 'Escribiendo…'; pintarLuego(); }
            else if (ev.tipo === 'estado') { estadoTxt = ev.texto + '…'; pintarLuego(); }
            else if (ev.tipo === 'contexto') turnoU.contexto = ev.texto;
            else if (ev.tipo === 'error') huboError = ev.mensaje;
            else if (ev.tipo === 'fin' && estado_) { estado_.usadas_hoy = ev.usadas_hoy; estado_.tope_dia = ev.tope_dia; pintarUso_(); }
          });
          return leer();
        });
      };
      return leer();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') { if (!turnoA.texto) turnoA.texto = '_(Detenida.)_'; else turnoA.texto += '\n\n_(Detenida.)_'; }
      else huboError = (e && e.message) || 'No se pudo conectar con el servidor.';
    }).then(function () {
      enCurso_ = null;
      btnEnviar_.innerHTML = SVG.enviar; btnEnviar_.setAttribute('aria-label', 'Enviar'); btnEnviar_.title = 'Enviar (Enter)';
      if (huboError && !turnoA.texto) {
        turnos_.pop(); // la pregunta sin respuesta no queda en el historial
        nodo.outerHTML = htmlTurno_({ rol: 'asistente', error: huboError });
        caja_.value = caja_.value || pregunta;
        conversando_ = false; pintarBotonesVoz_();
        return;
      }
      if (huboError) turnoA.texto += '\n\n_(' + huboError + ')_';
      turnos_.push(turnoA);
      guardar_();
      nodo.outerHTML = htmlTurno_(turnoA, turnos_.length - 1);
      alFondo_();
      if (conversando_) hablar_(turnoA.texto, function () { if (conversando_ && panel_.classList.contains('abierto')) escuchar_(function () { enviar_(); }); });
      else if (leerEnVoz_) hablar_(turnoA.texto);
    });
  }

  // --- abrir / cerrar --------------------------------------------------------------------
  function abrir() {
    if (!panel_) return;
    panel_.hidden = false;
    requestAnimationFrame(function () { panel_.classList.add('abierto'); });
    fab_.hidden = true;
    pintarUso_();
    if (!cuerpo_.innerHTML) pintarConversacion_();
    setTimeout(function () { caja_.focus(); }, 200);
    // Refresca el contador del día sin bloquear.
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'asistenteEstado', {}).then(function (r) { if (r && r.ok) { estado_ = r.data; pintarUso_(); } }).catch(function () {});
  }
  function cerrar() {
    if (!panel_) return;
    panel_.classList.remove('abierto');
    conversando_ = false; detenerEscucha_(); callar_(); pintarBotonesVoz_();
    setTimeout(function () { if (!panel_.classList.contains('abierto')) panel_.hidden = true; }, 300);
    fab_.hidden = false;
    fab_.focus();
  }

  function iniciar_() {
    if (typeof llamarApi !== 'function' || !window.SIGSO_CONFIG) return;
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'asistenteEstado', {}).then(function (r) {
      if (!r || !r.ok) {
        if (fab_) { if (panel_) cerrar(); fab_.hidden = true; }
        document.documentElement.classList.remove('asis-con-fab');
        return;
      }
      document.documentElement.classList.add('asis-con-fab');
      var yoAntes = estado_ && estado_.yo;
      estado_ = r.data;
      if (!fab_) construir_();
      if (yoAntes !== estado_.yo || !cuerpo_.innerHTML) { cargar_(); pintarConversacion_(); }
      fab_.hidden = panel_.classList.contains('abierto');
      pintarUso_();
    }).catch(function () { /* sin red: el botón aparece en el próximo ingreso */ });
  }

  document.addEventListener('sigso:shell-listo', iniciar_);
  window.SigsoAsistente = { abrir: abrir, cerrar: cerrar, preguntar: function (t) { abrir(); caja_.value = t; enviar_(); } };
})();
