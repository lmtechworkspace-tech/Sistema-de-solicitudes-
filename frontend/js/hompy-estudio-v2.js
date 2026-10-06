/**
 * hompy-estudio-v2.js — Estudio TikTok de Hompy (Etapa 2, 2026-10-06;
 * backend/logica/hompy.js, sección «Estudio TikTok»).
 *
 * De la idea al video, en 5 etapas:
 *   Idea (título + GANCHO: lo que pasa en los primeros 3 segundos, objetivo,
 *   formato, duración, referencia, hashtags) → Diálogo (editor tipo chat por
 *   personaje, con acciones y «ensayo» en voz alta) → Guión (escenas armadas
 *   desde el diálogo, con plano, texto en pantalla y segundos contra la
 *   duración objetivo) → Producción (lista de chequeo y grabación agendada en
 *   el calendario) → Publicado (enlace y métricas a 24 h y 7 días).
 *
 * Tablero con columnas por etapa (arrastrar y soltar en escritorio) y un
 * «taller» por idea que se guarda solo. Hacia adelante se avanza de a una
 * etapa y con lo mínimo; el servidor lo vuelve a verificar.
 *
 * Usa lo que comparte el módulo principal (SigsoHompy._interno).
 */
(function () {
  'use strict';

  var U = UIv2;
  function H() { return window.SigsoHompy._interno; }
  var ETAPAS = ['IDEA', 'DIALOGO', 'GUION', 'PRODUCCION', 'PUBLICADO'];
  var INFO = {
    IDEA: { n: 'Idea', ico: 'bombilla', hint: 'Anótala en una frase', color: 'ambar' },
    DIALOGO: { n: 'Diálogo', ico: 'comentario', hint: 'Quién dice qué', color: 'azul' },
    GUION: { n: 'Guión', ico: 'documento', hint: 'Escena por escena', color: 'violeta' },
    PRODUCCION: { n: 'Producción', ico: 'camara', hint: 'Grabar y editar', color: 'rosa' },
    PUBLICADO: { n: 'Publicado', ico: 'estrella', hint: 'Y cómo le fue', color: 'verde' },
    DESCARTADA: { n: 'Descartadas', ico: 'caja', hint: 'Con su motivo', color: 'gris' }
  };
  var OBJ = { EDUCAR: ['Educar', 'libro'], ENTRETENER: ['Entretener', 'estrella'], MARCA: ['Marca', 'megafono'], TENDENCIA: ['Tendencia', 'tendencia'] };
  var GANCHOS = ['¿Sabías que…?', 'El error que todos cometen con…', 'POV: eres…', '3 cosas que nadie te dice de…', 'No hagas esto en tu trabajo:', 'Hompy responde:'];
  var TIPS = {
    IDEA: 'El gancho es lo más importante: si en 3 segundos no engancha, la gente sigue de largo. Una pregunta, un dato que sorprenda o un error común funcionan muy bien.',
    DIALOGO: 'Escríbanlo como se habla, en frases cortas. Yo no hablo con el traje… ¡pero actúo! Usen «acción» para lo que hago yo: un pulgar arriba, un baile, una cara de sorpresa.',
    GUION: '«Armar desde el diálogo» convierte cada línea en una escena. Después ajusten el plano y los segundos: el texto en pantalla ayuda, porque muchos ven TikTok sin sonido.',
    PRODUCCION: 'Antes de grabar: el traje limpio y la autorización de quienes aparecen. Agenden la grabación y queda en mi calendario.',
    PUBLICADO: 'Anoten las métricas a las 24 horas y a los 7 días. Con eso sabremos qué tipo de video me resulta mejor.'
  };
  var COLORES_PERSONAJE = ['#2563EB', '#DB2777', '#16A34A', '#7C3AED', '#0D9488', '#CA8A04', '#64748B'];
  var NOMBRES_METRICA = { vistas: 'Vistas', me_gusta: 'Me gusta', comentarios: 'Comentarios', compartidos: 'Compartidos', guardados: 'Guardados' };

  var ideaId_ = '', tab_ = '', verDescartadas_ = false, nuevaId_ = '';
  var pendiente_ = false, timer_ = null, guardando_ = null, dlg_ = null, esc_ = null, hablando_ = false;

  // --- utilidades ---------------------------------------------------------------------------
  function txt(v) { return H().txt(v); }
  function D() { return H().datos(); }
  function ideas() { return (D() && D().ideas) || []; }
  function idea(id) { return ideas().find(function (x) { return x.idea_id === id; }) || null; }
  function ponerIdea(nueva) {
    var l = ideas(), i = l.findIndex(function (x) { return x.idea_id === nueva.idea_id; });
    if (i === -1) l.unshift(nueva); else l[i] = nueva;
  }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }
  function palabras(t) { return String(t || '').trim().split(/\s+/).filter(Boolean).length; }
  function segundosLinea(l) { return l.tipo === 'accion' ? 2 : Math.max(2, Math.round(palabras(l.texto) / 2.5)); }
  function duracionDialogo(d) { return (d.lineas || []).reduce(function (a, l) { return a + segundosLinea(l); }, 0); }
  function duracionGuion(g) { return (g.escenas || []).reduce(function (a, e) { return a + (Number(e.segundos) || 0); }, 0); }
  function siguiente(et) { var i = ETAPAS.indexOf(et); return i >= 0 && i < ETAPAS.length - 1 ? ETAPAS[i + 1] : ''; }
  function anterior(et) { var i = ETAPAS.indexOf(et); return i > 0 ? ETAPAS[i - 1] : ''; }
  function checklist() { return D().catalogos.checklist || []; }
  function listos(i) { return checklist().filter(function (c) { return i.produccion.checklist[c[0]]; }).length; }
  function miCorreo() { try { var c = JSON.parse(localStorage.getItem('sigso_portal_cuenta') || '{}'); return String((c.emails || [])[0] || c.email || '').toLowerCase(); } catch (e) { return ''; } }
  function voteMio(i) { var yo = miCorreo(); return !!yo && i.votos.indexOf(yo) !== -1; }
  function num(n) { return n == null ? '—' : Number(n).toLocaleString('es-CL'); }
  // Mismo criterio que faltaParaAvanzar_ del servidor (que es quien manda).
  function faltan(i) {
    var f = [];
    if (i.etapa === 'IDEA') { if (!i.titulo) f.push('Un título'); if (!i.idea.gancho) f.push('El gancho (primeros 3 segundos)'); }
    else if (i.etapa === 'DIALOGO') { if (!i.dialogo.lineas.length) f.push('Al menos una línea de diálogo'); }
    else if (i.etapa === 'GUION') { if (!i.guion.escenas.length) f.push('Al menos una escena'); else if (!i.guion.escenas.some(function (e) { return e.segundos > 0; })) f.push('Los segundos de cada escena'); }
    else if (i.etapa === 'PRODUCCION') { if (!i.produccion.checklist.grabado) f.push('Marcar «Grabado»'); if (!i.produccion.checklist.aprobado) f.push('Marcar «Revisado y aprobado»'); }
    return f;
  }
  function resumenEtapa(i, et) {
    if (et === 'IDEA') return i.idea.gancho ? 'Con gancho' : 'Sin gancho';
    if (et === 'DIALOGO') return i.dialogo.lineas.length + ' línea' + (i.dialogo.lineas.length === 1 ? '' : 's');
    if (et === 'GUION') return i.guion.escenas.length + ' escena' + (i.guion.escenas.length === 1 ? '' : 's') + (i.guion.escenas.length ? ' · ' + duracionGuion(i.guion) + ' s' : '');
    if (et === 'PRODUCCION') return listos(i) + ' de ' + checklist().length;
    if (et === 'PUBLICADO') return i.publicacion.h24.vistas != null ? num(i.publicacion.h24.vistas) + ' vistas' : (i.publicacion.url ? 'Publicado' : '—');
    return '';
  }

  // --- tablero ------------------------------------------------------------------------------
  function ordenadas(et) {
    return ideas().filter(function (i) { return i.etapa === et; }).sort(function (a, b) {
      return (b.votos.length - a.votos.length) || (a.fecha_actualizacion < b.fecha_actualizacion ? 1 : -1);
    });
  }
  function tarjeta(i, n) {
    var info = INFO[i.etapa] || INFO.IDEA, obj = OBJ[i.idea.objetivo];
    var prog = '';
    if (i.etapa === 'PRODUCCION') prog = '<span class="hp2e-tarjeta__barra"><i style="width:' + Math.round(listos(i) / Math.max(1, checklist().length) * 100) + '%"></i></span>';
    var meta = [];
    if (i.etapa !== 'IDEA' && i.etapa !== 'DESCARTADA') meta.push('<span>' + U.ico(info.ico, 12) + txt(resumenEtapa(i, i.etapa)) + '</span>');
    if (i.produccion.fecha_grabacion && i.etapa === 'PRODUCCION') meta.push('<span>' + U.ico('calendario', 12) + txt(H().fechaCorta(i.produccion.fecha_grabacion)) + '</span>');
    return '<article class="hp2e-tarjeta sx2-entra' + (i.idea_id === nuevaId_ ? ' hp2e-tarjeta--nueva' : '') + '" draggable="true" tabindex="0" data-id="' + txt(i.idea_id) + '" style="--i:' + (n || 0) + '" aria-label="' + txt(i.titulo + ', ' + info.n) + '">' +
      ((obj || i.idea.duracion) && i.etapa !== 'DESCARTADA' ? '<span class="hp2e-tarjeta__chips">' + (obj ? '<span class="hp2e-chip">' + U.ico(obj[1], 11) + txt(obj[0]) + '</span>' : '') +
        '<span class="hp2e-chip">' + U.ico('reloj', 11) + i.idea.duracion + ' s</span></span>' : '') +
      '<b class="hp2e-tarjeta__t">' + txt(i.titulo) + '</b>' +
      (i.etapa === 'DESCARTADA' ? '<p class="hp2e-tarjeta__g">' + U.ico('info', 12) + txt(i.motivo_descarte) + '</p>'
        : (i.idea.gancho ? '<p class="hp2e-tarjeta__g">«' + txt(i.idea.gancho) + '»</p>' : '<p class="hp2e-tarjeta__g hp2e-tarjeta__g--falta">Falta el gancho</p>')) +
      prog +
      '<footer class="hp2e-tarjeta__pie">' + (meta.length ? '<span class="hp2e-tarjeta__meta">' + meta.join('') + '</span>' : '<span></span>') +
        (i.etapa === 'DESCARTADA' ? U.boton({ texto: 'Recuperar', icono: 'derivar', sm: true, variante: 'fantasma', clase: 'js-hp2e-recuperar', datos: { id: i.idea_id } })
          : '<button type="button" class="hp2e-voto js-hp2e-votar" data-id="' + txt(i.idea_id) + '" aria-pressed="' + voteMio(i) + '" title="' + (voteMio(i) ? 'Quitar mi voto' : 'Me gusta esta idea') + '">' +
            '<span class="hp2e-voto__fuego" aria-hidden="true">🔥</span>' + i.votos.length + '</button>') +
      '</footer></article>';
  }
  function tablero() {
    var lista = ideas(), etapas = ETAPAS.concat(verDescartadas_ ? ['DESCARTADA'] : []);
    var nDesc = lista.filter(function (i) { return i.etapa === 'DESCARTADA'; }).length;
    var embudo = '<ol class="hp2e-embudo sx2-entra" style="--i:1">' + ETAPAS.map(function (et, k) {
      var n = lista.filter(function (i) { return i.etapa === et; }).length;
      return '<li class="hp2-color-' + INFO[et].color + '"><span class="hp2e-embudo__ico">' + U.ico(INFO[et].ico, 16) + '</span><span><b>' + n + '</b>' + txt(INFO[et].n) + '</span></li>';
    }).join('') + '</ol>';
    var captura = '<form class="hp2e-captura sx2-entra js-hp2e-captura" autocomplete="off">' +
      '<span class="hp2e-captura__ico">' + U.ico('bombilla', 22) + '</span>' +
      '<input class="hp2e-captura__input" name="titulo" maxlength="120" placeholder="¿Qué se te ocurrió? Anótalo en una frase y presiona Enter" aria-label="Nueva idea para TikTok">' +
      U.boton({ texto: 'Anotar', icono: 'nueva', variante: 'primario', tipo: 'submit', clase: 'hp2-boton-hompy' }) + '</form>';
    var cols = etapas.map(function (et) {
      var l = ordenadas(et), info = INFO[et];
      return '<section class="hp2e-col hp2-color-' + info.color + '" data-etapa="' + et + '">' +
        '<header class="hp2e-col__cab"><span class="hp2e-col__ico">' + U.ico(info.ico, 16) + '</span><div><b>' + txt(info.n) + '</b><small>' + txt(info.hint) + '</small></div><span class="hp2e-col__n">' + l.length + '</span></header>' +
        '<div class="hp2e-col__cuerpo js-hp2e-zona" data-etapa="' + et + '">' +
          (l.length ? l.map(tarjeta).join('') : '<p class="hp2e-col__vacia">' + (et === 'IDEA' ? 'Anoten aquí todo lo que se les ocurra.' : 'Arrastra una idea aquí cuando esté lista.') + '</p>') +
        '</div></section>';
    }).join('');
    H().pagina(H().cabecera('Estudio TikTok', 'De la idea al video. Anoten todo: las mejores ideas salen de muchas.',
      (nDesc ? U.boton({ texto: (verDescartadas_ ? 'Ocultar' : 'Ver') + ' descartadas (' + nDesc + ')', icono: 'caja', variante: 'fantasma', clase: 'js-hp2e-descartadas' }) : '')) +
      captura + embudo + '<div class="hp2e-tablero' + (verDescartadas_ ? ' hp2e-tablero--6' : '') + '">' + cols + '</div>' +
      (lista.length ? '' : '<div class="hp2e-bienvenida sx2-entra"><img src="assets/hompy/hompy-cara.webp" alt="" width="64" height="64"><div><b>¡Mi Estudio está listo!</b><p>Anoten la primera idea arriba. Después la convertimos en diálogo, guión y video, paso a paso.</p></div></div>'));
    var el = H().raiz().querySelector('.hp2e-captura__input');
    if (el && nuevaId_) el.focus();
    nuevaId_ = '';
  }

  // --- taller de una idea --------------------------------------------------------------------
  function taller(id, tab) {
    var i = idea(id);
    if (!i) { H().ir('estudio'); return; }
    if (ideaId_ !== id) { tab_ = ''; dlg_ = null; esc_ = null; }
    ideaId_ = id;
    tab_ = tab || tab_ || (i.etapa === 'DESCARTADA' ? 'IDEA' : i.etapa);
    dlg_ = copia(i.dialogo); esc_ = copia(i.guion.escenas);
    callar();
    var iAct = ETAPAS.indexOf(i.etapa);
    var pasos = '<nav class="hp2e-pasos sx2-entra" aria-label="Etapas del video">' + ETAPAS.map(function (et, k) {
      var est = i.etapa === 'DESCARTADA' ? 'futuro' : k < iAct ? 'hecho' : k === iAct ? 'actual' : 'futuro';
      return '<button type="button" class="hp2e-paso hp2e-paso--' + est + (tab_ === et ? ' hp2e-paso--sel' : '') + ' js-hp2e-tab" data-tab="' + et + '"' + (tab_ === et ? ' aria-current="step"' : '') + '>' +
        '<span class="hp2e-paso__n">' + (est === 'hecho' ? U.ico('check', 14) : U.ico(INFO[et].ico, 14)) + '</span>' +
        '<span class="hp2e-paso__t"><b>' + txt(INFO[et].n) + '</b><small class="js-hp2e-res" data-et="' + et + '">' + txt(resumenEtapa(i, et)) + '</small></span></button>';
    }).join('<span class="hp2e-paso__linea" aria-hidden="true"></span>') + '</nav>';

    var cab = '<header class="sx2-cabecera sx2-entra hp2-cab hp2e-cab"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Hompy · Estudio TikTok</span>' +
      '<h1><textarea class="hp2e-titulo js-hp2e-titulo" rows="1" maxlength="120" aria-label="Título de la idea">' + txt(i.titulo) + '</textarea></h1>' +
      '<p class="hp2e-guardado js-hp2e-guardado" aria-live="polite">' + (i.fecha_actualizacion ? 'Guardado ' + txt(H().horaDe(i.fecha_actualizacion)) : '') + '</p></div>' +
      '<div class="sx2-cabecera__acciones">' + U.boton({ texto: 'Estudio', icono: 'izquierda', variante: 'fantasma', clase: 'js-hp2e-volver' }) + '</div></header>';

    var descartada = i.etapa === 'DESCARTADA' ? '<div class="hp2e-descartada sx2-entra">' + U.ico('caja', 18) + '<div><b>Idea descartada</b><p>' + txt(i.motivo_descarte) + '</p></div>' +
      U.boton({ texto: 'Recuperar', icono: 'derivar', clase: 'js-hp2e-recuperar', datos: { id: i.idea_id } }) + '</div>' : '';

    H().pagina(cab + pasos + descartada +
      '<div class="hp2e-taller"><div class="hp2e-taller__main">' + U.card({ clase: 'hp2e-seccion hp2-color-' + INFO[tab_].color, cuerpo: seccion(i) }) + '</div>' +
      '<aside class="hp2e-taller__lado">' + lado(i) + '</aside></div>');
    enlazarSeccion();
  }
  function lado(i) {
    var sig = siguiente(i.etapa), f = faltan(i), ant = anterior(i.etapa);
    var avance = '';
    if (i.etapa !== 'DESCARTADA' && sig) {
      avance = '<div class="hp2e-sig sx2-card"><span class="hp2e-sig__et">Siguiente paso</span><b>' + txt(INFO[sig].n) + '</b>' +
        (f.length ? '<ul class="hp2e-sig__falta">' + f.map(function (x) { return '<li>' + U.ico('info', 12) + txt(x) + '</li>'; }).join('') + '</ul>' : '<p class="hp2e-sig__ok">' + U.ico('check', 13) + '¡Todo listo para avanzar!</p>') +
        U.boton({ texto: 'Pasar a «' + INFO[sig].n + '»', icono: 'derecha', variante: 'primario', clase: 'js-hp2e-avanzar hp2-boton-hompy', deshabilitado: !!f.length }) +
        (ant ? '<button type="button" class="sx2-enlace hp2e-sig__atras js-hp2e-atras">' + U.ico('izquierda', 12) + 'Devolver a «' + txt(INFO[ant].n) + '»</button>' : '') + '</div>';
    } else if (i.etapa === 'PUBLICADO') {
      avance = '<div class="hp2e-sig hp2e-sig--fin sx2-card"><span class="hp2e-sig__et">¡Publicado!</span><b>' + (i.publicacion.url ? '<a href="' + txt(i.publicacion.url) + '" target="_blank" rel="noopener">Ver en TikTok ' + U.ico('enlace', 13) + '</a>' : 'Agrega el enlace') + '</b>' +
        '<p>Recuerden anotar las métricas a las 24 h y a los 7 días.</p>' + (ant ? '<button type="button" class="sx2-enlace hp2e-sig__atras js-hp2e-atras">' + U.ico('izquierda', 12) + 'Devolver a «' + txt(INFO[ant].n) + '»</button>' : '') + '</div>';
    }
    return avance +
      '<div class="hp2e-tip"><img class="js-hp2e-tip-cara" src="assets/hompy/hompy-cara.webp" alt="" width="56" height="56"><p>' + txt(TIPS[tab_]) + '</p></div>' +
      '<div class="hp2e-meta sx2-card">' +
        '<button type="button" class="hp2e-voto hp2e-voto--grande js-hp2e-votar" data-id="' + txt(i.idea_id) + '" aria-pressed="' + voteMio(i) + '"><span class="hp2e-voto__fuego" aria-hidden="true">🔥</span>' + i.votos.length + ' voto' + (i.votos.length === 1 ? '' : 's') + '</button>' +
        '<p>Anotada por ' + txt(H().nombreDe(i.creado_por)) + '<br>' + txt(H().horaDe(i.fecha_creacion)) + '</p>' +
        '<div class="hp2e-meta__acc">' + (i.etapa !== 'DESCARTADA' && i.etapa !== 'PUBLICADO' ? U.boton({ texto: 'Descartar', icono: 'caja', sm: true, variante: 'fantasma', clase: 'js-hp2e-descartar' }) : '') +
          (i.etapa !== 'PUBLICADO' ? U.boton({ soloIcono: true, icono: 'basura', titulo: 'Eliminar', sm: true, variante: 'fantasma', clase: 'js-hp2e-eliminar' }) : '') + '</div>' +
      '</div>';
  }
  function repintarLado() {
    var i = idea(ideaId_), a = H().raiz().querySelector('.hp2e-taller__lado');
    if (!i || !a) return;
    a.innerHTML = lado(i);
    H().raiz().querySelectorAll('.js-hp2e-res').forEach(function (s) { s.textContent = resumenEtapa(i, s.getAttribute('data-et')); });
  }

  // --- secciones ----------------------------------------------------------------------------
  function seccion(i) {
    var cab = function (titulo, sub) { return '<header class="hp2e-sec__cab"><span class="hp2e-sec__ico">' + U.ico(INFO[tab_].ico, 20) + '</span><div><h2>' + txt(titulo) + '</h2><p>' + txt(sub) + '</p></div></header>'; };
    if (tab_ === 'IDEA') return cab('La idea', 'Qué vamos a contar y cómo vamos a enganchar desde el primer segundo.') + secIdea(i);
    if (tab_ === 'DIALOGO') return cab('El diálogo', 'Quién dice qué, línea por línea. Las acciones son lo que se ve.') + secDialogo(i);
    if (tab_ === 'GUION') return cab('El guión', 'Escena por escena: qué se ve, qué se lee y qué se escucha.') + secGuion(i);
    if (tab_ === 'PRODUCCION') return cab('La producción', 'Todo lo necesario para grabar, editar y aprobar el video.') + secProduccion(i);
    return cab('Publicado', 'El enlace del video y cómo le fue.') + secPublicado(i);
  }
  function radios(nombre, ops, actual, clase) {
    return '<div class="hp2e-radios ' + (clase || '') + '" role="radiogroup">' + ops.map(function (o) {
      return '<label class="hp2e-radio"><input type="radio" name="' + nombre + '" value="' + txt(o[0]) + '"' + (String(actual) === String(o[0]) ? ' checked' : '') + '>' +
        '<span>' + (o[2] ? U.ico(o[2], 15) : '') + txt(o[1]) + '</span></label>';
    }).join('') + '</div>';
  }
  function secIdea(i) {
    var d = i.idea;
    return '<div class="js-hp2e-form" data-sec="idea">' +
      '<div class="hp2e-gancho"><label class="sx2-campo"><span class="sx2-campo__et">El gancho: lo que pasa en los primeros 3 segundos *</span>' +
        '<textarea class="sx2-input hp2-area hp2e-gancho__txt" name="gancho" rows="2" maxlength="200" placeholder="Ej.: ¿Sabías que tu casco tiene fecha de vencimiento?">' + txt(d.gancho) + '</textarea></label>' +
        '<div class="hp2e-gancho__pie"><span class="hp2e-plantillas">' + GANCHOS.map(function (g) { return '<button type="button" class="hp2e-plantilla js-hp2e-plantilla" data-t="' + txt(g) + '">' + txt(g) + '</button>'; }).join('') + '</span>' +
        '<span class="hp2e-contador js-hp2e-contador">' + d.gancho.length + '/200</span></div></div>' +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">¿Para qué es el video?</span>' + radios('objetivo', Object.keys(OBJ).map(function (k) { return [k, OBJ[k][0], OBJ[k][1]]; }), d.objetivo, 'hp2e-radios--grandes') + '</div>' +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">Formato</span>' + radios('formato', D().catalogos.formatos.map(function (f) { return [f, f]; }), d.formato) + '</div>' +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">Duración objetivo</span>' + radios('duracion', D().catalogos.duraciones.map(function (s) { return [s, s + ' s']; }), d.duracion, 'hp2e-radios--seg') + '</div>' +
      '<div class="hp2-form-fila">' +
        U.campo('Video o tendencia de referencia', '<input class="sx2-input" type="url" name="referencia" maxlength="500" value="' + txt(d.referencia) + '" placeholder="https://www.tiktok.com/…">') +
        U.campo('Audio o canción', '<input class="sx2-input" name="audio" maxlength="120" value="' + txt(d.audio) + '" placeholder="Nombre del audio en tendencia">') +
      '</div>' +
      U.campo('Hashtags', H().chipsInput('hashtags', d.hashtags, '#seguridad, Enter para agregar', false)) +
      U.campo('Notas', '<textarea class="sx2-input hp2-area" name="notas" rows="3" maxlength="2000" placeholder="Lo que se les ocurra: chistes, lugares, con quién grabar…">' + txt(d.notas) + '</textarea>') +
    '</div>';
  }

  // Diálogo: editor tipo chat. dlg_ es la copia local que se edita y se guarda entera.
  function colorPersonaje(p) {
    if (String(p).toLowerCase() === 'hompy') return 'var(--hp-naranja)';
    var i = dlg_.personajes.filter(function (x) { return x.toLowerCase() !== 'hompy'; }).indexOf(p);
    return COLORES_PERSONAJE[(i < 0 ? 0 : i) % COLORES_PERSONAJE.length];
  }
  function avatarPersonaje(p) {
    return String(p).toLowerCase() === 'hompy'
      ? '<img class="hp2e-av" src="assets/hompy/hompy-cara.webp" alt="" width="30" height="30">'
      : '<span class="hp2e-av" style="--pc:' + colorPersonaje(p) + '">' + txt(U.iniciales(p)) + '</span>';
  }
  function secDialogo(i) {
    return '<div class="js-hp2e-form" data-sec="dialogo">' +
      '<div class="hp2e-reparto"><span class="sx2-campo__et">Reparto</span><div class="hp2e-reparto__lista js-hp2e-reparto">' + repartoHtml() + '</div></div>' +
      '<div class="hp2e-chat js-hp2e-chat" aria-live="polite">' + chatHtml() + '</div>' +
      '<div class="hp2e-composer">' +
        '<div class="hp2e-composer__quien js-hp2e-quien" role="radiogroup" aria-label="Quién">' + quienHtml() + '</div>' +
        '<div class="hp2e-composer__fila">' +
          '<label class="hp2e-tipo-linea" title="Una acción es lo que se ve, no lo que se dice"><input type="checkbox" class="js-hp2e-es-accion"><span>' + U.ico('actividad', 14) + 'Acción</span></label>' +
          '<textarea class="sx2-input hp2e-composer__txt js-hp2e-nueva" rows="1" maxlength="400" placeholder="Escribe lo que dice… (Enter agrega, Shift+Enter salto de línea)" aria-label="Nueva línea del diálogo"></textarea>' +
          U.boton({ soloIcono: true, icono: 'nueva', titulo: 'Agregar línea', variante: 'primario', clase: 'js-hp2e-agregar hp2-boton-hompy' }) +
        '</div></div>' +
      '<div class="hp2e-dlg-pie"><span class="js-hp2e-dur-dlg">' + duracionTxt(duracionDialogo(dlg_), i.idea.duracion) + '</span>' +
        (window.speechSynthesis ? U.boton({ texto: 'Ensayar en voz alta', icono: 'megafono', sm: true, variante: 'fantasma', clase: 'js-hp2e-ensayar' }) : '') + '</div>' +
    '</div>';
  }
  function duracionTxt(seg, obj) {
    var tono = seg > obj * 1.2 ? 'critico' : seg > obj ? 'alerta' : 'ok';
    return '<span class="hp2e-dur sx2-tono-' + tono + '">' + U.ico('reloj', 13) + 'Unos ' + seg + ' s de ' + obj + ' s' + (tono === 'critico' ? ' · muy largo: recorten' : tono === 'alerta' ? ' · un poco largo' : '') + '</span>';
  }
  function repartoHtml() {
    return dlg_.personajes.map(function (p) {
      var usado = dlg_.lineas.some(function (l) { return l.personaje === p; });
      return '<span class="hp2e-actor">' + avatarPersonaje(p) + txt(p) + (p.toLowerCase() !== 'hompy' && !usado ? '<button type="button" class="hp2-chip__x js-hp2e-quitar-actor" data-p="' + txt(p) + '" aria-label="Quitar ' + txt(p) + '">' + U.ico('equis', 11) + '</button>' : '') + '</span>';
    }).join('') + (dlg_.personajes.length < 8 ? '<input class="hp2e-actor-nuevo js-hp2e-actor-nuevo" maxlength="30" placeholder="+ Personaje (Enter)" aria-label="Agregar personaje">' : '');
  }
  function quienHtml(sel) {
    sel = sel || (dlg_.lineas.length ? dlg_.lineas[dlg_.lineas.length - 1].personaje : 'Hompy');
    // Por defecto, quien NO habló último (los diálogos se alternan).
    if (dlg_.lineas.length && dlg_.personajes.length > 1) { var otro = dlg_.personajes.find(function (p) { return p !== sel; }); sel = otro || sel; }
    return dlg_.personajes.map(function (p) {
      return '<label class="hp2e-quien" style="--pc:' + colorPersonaje(p) + '"><input type="radio" name="quien" value="' + txt(p) + '"' + (p === sel ? ' checked' : '') + '><span>' + txt(p) + '</span></label>';
    }).join('');
  }
  function chatHtml() {
    if (!dlg_.lineas.length) return '<div class="hp2e-chat__vacio">' + U.ico('comentario', 26) + '<p>Todavía no hay diálogo. Elige quién habla abajo y escribe la primera línea.</p></div>';
    return dlg_.lineas.map(function (l, k) {
      var hompy = l.personaje.toLowerCase() === 'hompy', accion = l.tipo === 'accion';
      return '<div class="hp2e-linea' + (accion ? ' hp2e-linea--accion' : hompy ? ' hp2e-linea--der' : '') + '" data-i="' + k + '" style="--pc:' + colorPersonaje(l.personaje) + '">' +
        (accion ? '' : avatarPersonaje(l.personaje)) +
        '<div class="hp2e-linea__caja">' +
          '<div class="hp2e-linea__quien"><select class="js-hp2e-l-personaje" aria-label="Quién">' + dlg_.personajes.map(function (p) { return '<option' + (p === l.personaje ? ' selected' : '') + '>' + txt(p) + '</option>'; }).join('') + '</select>' +
            '<span class="hp2e-linea__seg">' + (accion ? 'acción · ' : '') + '~' + segundosLinea(l) + ' s</span>' +
            '<span class="hp2e-linea__acc">' +
              '<button type="button" class="js-hp2e-l-tipo" title="' + (accion ? 'Convertir en diálogo' : 'Convertir en acción') + '">' + U.ico(accion ? 'comentario' : 'actividad', 13) + '</button>' +
              (k ? '<button type="button" class="js-hp2e-l-subir" title="Subir">' + U.ico('arriba', 13) + '</button>' : '') +
              (k < dlg_.lineas.length - 1 ? '<button type="button" class="js-hp2e-l-bajar" title="Bajar">' + U.ico('abajo', 13) + '</button>' : '') +
              '<button type="button" class="js-hp2e-l-borrar" title="Borrar">' + U.ico('basura', 13) + '</button></span></div>' +
          '<textarea class="hp2e-burbuja js-hp2e-l-texto" rows="1" maxlength="400" aria-label="Texto de la línea ' + (k + 1) + '">' + txt(l.texto) + '</textarea>' +
        '</div></div>';
    }).join('');
  }
  function repintarDialogo(focoNueva) {
    var r = H().raiz(), i = idea(ideaId_);
    r.querySelector('.js-hp2e-chat').innerHTML = chatHtml();
    r.querySelector('.js-hp2e-reparto').innerHTML = repartoHtml();
    var q = r.querySelector('.js-hp2e-quien'), sel = (q.querySelector('input:checked') || {}).value;
    q.innerHTML = quienHtml(focoNueva ? null : sel);
    r.querySelector('.js-hp2e-dur-dlg').innerHTML = duracionTxt(duracionDialogo(dlg_), i.idea.duracion);
    r.querySelectorAll('.js-hp2e-l-texto').forEach(autoalto);
    if (focoNueva) { var chat = r.querySelector('.js-hp2e-chat'); chat.scrollTop = chat.scrollHeight; r.querySelector('.js-hp2e-nueva').focus(); }
  }
  function autoalto(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 240) + 'px'; }
  function agregarLinea() {
    var r = H().raiz(), t = r.querySelector('.js-hp2e-nueva'), texto = t.value.trim();
    if (!texto) { t.focus(); return; }
    var quien = (r.querySelector('.js-hp2e-quien input:checked') || {}).value || 'Hompy';
    var accion = r.querySelector('.js-hp2e-es-accion').checked;
    dlg_.lineas.push({ personaje: quien, tipo: accion ? 'accion' : 'dice', texto: texto });
    t.value = ''; autoalto(t);
    r.querySelector('.js-hp2e-es-accion').checked = false;
    repintarDialogo(true);
    var ult = r.querySelector('.hp2e-linea:last-child');
    if (ult) ult.classList.add('hp2e-linea--nueva');
    programar();
  }

  // Ensayo: lee el diálogo con la voz del navegador, una voz por personaje.
  function callar() { if (window.speechSynthesis && hablando_) { speechSynthesis.cancel(); } hablando_ = false; }
  function ensayar(btn) {
    if (!window.speechSynthesis) return;
    if (hablando_) { callar(); btn.innerHTML = U.ico('megafono', 14) + 'Ensayar en voz alta'; return; }
    var voces = speechSynthesis.getVoices().filter(function (v) { return /^es/i.test(v.lang); });
    var voz = voces.find(function (v) { return /CL|419|MX|US/i.test(v.lang); }) || voces[0] || null;
    var lineas = dlg_.lineas.map(function (l, k) { return { l: l, k: k }; }).filter(function (x) { return x.l.tipo !== 'accion'; });
    if (!lineas.length) { H().aviso('Escriban al menos una línea de diálogo para ensayar.'); return; }
    hablando_ = true; btn.innerHTML = U.ico('equis', 14) + 'Detener';
    var r = H().raiz();
    lineas.forEach(function (x, n) {
      var u = new SpeechSynthesisUtterance(x.l.texto);
      if (voz) u.voice = voz;
      u.lang = voz ? voz.lang : 'es-CL';
      var p = dlg_.personajes.indexOf(x.l.personaje);
      u.pitch = x.l.personaje.toLowerCase() === 'hompy' ? 0.6 : 0.9 + (p % 4) * 0.18;
      u.rate = 1.02;
      u.onstart = function () { r.querySelectorAll('.hp2e-linea--habla').forEach(function (e) { e.classList.remove('hp2e-linea--habla'); }); var el = r.querySelector('.hp2e-linea[data-i="' + x.k + '"]'); if (el) { el.classList.add('hp2e-linea--habla'); el.scrollIntoView({ block: 'nearest' }); } };
      if (n === lineas.length - 1) u.onend = function () { hablando_ = false; btn.innerHTML = U.ico('megafono', 14) + 'Ensayar en voz alta'; r.querySelectorAll('.hp2e-linea--habla').forEach(function (e) { e.classList.remove('hp2e-linea--habla'); }); };
      speechSynthesis.speak(u);
    });
  }

  // Guión: esc_ es la copia local de las escenas.
  function secGuion(i) {
    return '<div class="js-hp2e-form" data-sec="guion">' +
      '<div class="hp2e-linea-tiempo js-hp2e-tiempo">' + tiempoHtml(i) + '</div>' +
      '<div class="hp2e-guion-barra">' +
        (i.dialogo.lineas.length ? U.boton({ texto: 'Armar desde el diálogo', icono: 'destello', clase: 'js-hp2e-armar' }) : '<span class="sx2-tenue">Escriban el diálogo para armar el guión automáticamente.</span>') +
        '<span style="flex:1"></span>' +
        (esc_.length ? U.boton({ texto: 'Copiar guión', icono: 'copiar', sm: true, variante: 'fantasma', clase: 'js-hp2e-copiar' }) : '') + '</div>' +
      '<div class="hp2e-escenas js-hp2e-escenas">' + escenasHtml() + '</div>' +
      U.boton({ texto: 'Agregar escena', icono: 'nueva', clase: 'js-hp2e-escena-nueva hp2e-escena-nueva' }) +
    '</div>';
  }
  function tiempoHtml(i) {
    var total = duracionGuion({ escenas: esc_ }), obj = i.idea.duracion, max = Math.max(total, obj, 1);
    return '<div class="hp2e-tiempo__barra">' + esc_.map(function (e, k) {
      return '<span class="hp2e-tiempo__seg" style="width:' + ((Number(e.segundos) || 0) / max * 100) + '%" title="Escena ' + (k + 1) + ': ' + (e.segundos || 0) + ' s">' + (k + 1) + '</span>';
    }).join('') + '<i class="hp2e-tiempo__obj" style="left:' + (obj / max * 100) + '%" title="Objetivo: ' + obj + ' s"></i></div>' + duracionTxt(total, obj);
  }
  function escenasHtml() {
    if (!esc_.length) return '<div class="hp2e-chat__vacio">' + U.ico('documento', 26) + '<p>Sin escenas todavía. Ármenlas desde el diálogo o agréguenlas de a una.</p></div>';
    var planos = D().catalogos.planos;
    return esc_.map(function (e, k) {
      return '<article class="hp2e-escena" data-i="' + k + '">' +
        '<header class="hp2e-escena__cab"><span class="hp2e-escena__n">' + (k + 1) + '</span>' +
          '<select class="sx2-select hp2e-escena__plano js-hp2e-e" data-k="plano" aria-label="Plano">' + planos.map(function (p) { return '<option' + (p === e.plano ? ' selected' : '') + '>' + txt(p) + '</option>'; }).join('') + '</select>' +
          '<label class="hp2e-escena__seg"><input class="sx2-input js-hp2e-e" data-k="segundos" type="number" min="0" max="600" inputmode="numeric" value="' + (e.segundos || '') + '" aria-label="Segundos">s</label>' +
          '<span class="hp2e-linea__acc">' + (k ? '<button type="button" class="js-hp2e-e-subir" title="Subir">' + U.ico('arriba', 13) + '</button>' : '') +
            (k < esc_.length - 1 ? '<button type="button" class="js-hp2e-e-bajar" title="Bajar">' + U.ico('abajo', 13) + '</button>' : '') +
            '<button type="button" class="js-hp2e-e-duplicar" title="Duplicar">' + U.ico('copiar', 13) + '</button>' +
            '<button type="button" class="js-hp2e-e-borrar" title="Borrar">' + U.ico('basura', 13) + '</button></span></header>' +
        '<div class="hp2e-escena__campos">' +
          '<label><span>' + U.ico('ojo', 12) + 'Qué se ve</span><textarea class="sx2-input hp2-area js-hp2e-e" data-k="accion" rows="2" maxlength="400">' + txt(e.accion) + '</textarea></label>' +
          '<label><span>' + U.ico('etiqueta', 12) + 'Texto en pantalla</span><textarea class="sx2-input hp2-area js-hp2e-e" data-k="pantalla" rows="2" maxlength="200">' + txt(e.pantalla) + '</textarea></label>' +
          '<label><span>' + U.ico('megafono', 12) + 'Audio / voz</span><textarea class="sx2-input hp2-area js-hp2e-e" data-k="audio" rows="2" maxlength="400">' + txt(e.audio) + '</textarea></label>' +
        '</div></article>';
    }).join('');
  }
  function repintarGuion() {
    var r = H().raiz(), i = idea(ideaId_);
    r.querySelector('.js-hp2e-escenas').innerHTML = escenasHtml();
    r.querySelector('.js-hp2e-tiempo').innerHTML = tiempoHtml(i);
  }
  function armarDesdeDialogo() {
    var i = idea(ideaId_);
    var nuevas = i.dialogo.lineas.map(function (l, k) {
      if (l.tipo === 'accion') return { plano: 'General', accion: l.personaje + ': ' + l.texto, pantalla: '', audio: '', segundos: 2 };
      return { plano: l.personaje.toLowerCase() === 'hompy' ? 'Medio' : 'Primer plano', accion: l.personaje + ' a cámara', pantalla: '', audio: l.personaje + ': «' + l.texto + '»', segundos: segundosLinea(l) };
    });
    if (nuevas.length && i.idea.gancho) { nuevas[0].pantalla = i.idea.gancho; nuevas[0].plano = 'Primer plano'; }
    esc_ = nuevas;
    repintarGuion(); programar();
    H().aviso(nuevas.length + ' escenas armadas desde el diálogo. Ajusten los planos y los segundos.', 'exito');
  }
  function guionComoTexto() {
    var i = idea(ideaId_);
    return 'GUIÓN — ' + i.titulo + '\nGancho: ' + i.idea.gancho + '\nDuración objetivo: ' + i.idea.duracion + ' s\n\n' + esc_.map(function (e, k) {
      return 'Escena ' + (k + 1) + ' · ' + e.plano + ' · ' + (e.segundos || 0) + ' s\n  Se ve: ' + (e.accion || '—') + '\n  En pantalla: ' + (e.pantalla || '—') + '\n  Audio: ' + (e.audio || '—');
    }).join('\n\n');
  }

  function secProduccion(i) {
    var p = i.produccion, n = listos(i), total = checklist().length;
    var ev = p.evento_id && (D().eventos || []).find(function (e) { return e.evento_id === p.evento_id; });
    return '<div class="js-hp2e-form" data-sec="produccion">' +
      '<div class="hp2e-check-cab"><div class="hp2-progreso__anillo js-hp2e-anillo' + (n === total ? ' hp2-progreso__anillo--listo' : '') + '" style="--pct:' + Math.round(n / total * 100) + '"><span>' + (n === total ? U.ico('check', 18) : n + '/' + total) + '</span></div>' +
        '<div><b>Lista de producción</b><p class="sx2-tenue">«Grabado» y «Revisado y aprobado» son necesarios para publicar.</p></div></div>' +
      '<div class="hp2e-check">' + checklist().map(function (c) {
        return '<label class="hp2e-check__op' + (c[0] === 'grabado' || c[0] === 'aprobado' ? ' hp2e-check__op--clave' : '') + '"><input type="checkbox" name="check_' + c[0] + '"' + (p.checklist[c[0]] ? ' checked' : '') + '><span class="hp2e-check__caja">' + U.ico('check', 13) + '</span>' + txt(c[1]) + '</label>';
      }).join('') + '</div>' +
      '<section class="hp2e-grabacion"><h3>' + U.ico('calendario', 16) + 'Grabación</h3>' +
        '<div class="hp2-form-fila hp2-form-fila--3">' +
          U.campo('Día', '<input class="sx2-input" type="date" name="fecha_grabacion" value="' + txt(p.fecha_grabacion) + '">') +
          U.campo('Hora', '<input class="sx2-input" type="time" name="hora_grabacion" value="' + txt(p.hora_grabacion) + '">') +
          U.campo('Lugar', '<input class="sx2-input" name="lugar" maxlength="120" value="' + txt(p.lugar) + '">') +
        '</div>' +
        '<div class="hp2e-grabacion__acc">' + U.boton({ texto: ev ? 'Mover en el calendario' : 'Agendar en el calendario', icono: 'calendario', clase: 'js-hp2e-agendar' }) +
          (ev ? '<button type="button" class="hp2e-evento js-hp2e-ver-evento" data-id="' + txt(ev.evento_id) + '">' + U.ico('check', 13) + 'En el calendario: ' + txt(H().fechaLarga(ev.fecha)) + (ev.hora_inicio ? ', ' + txt(ev.hora_inicio) : '') + '</button>' : '') + '</div>' +
      '</section>' +
      '<datalist id="hp2-personas">' + (D().personas || []).map(function (x) { return '<option value="' + txt(x) + '"></option>'; }).join('') + '</datalist>' +
      '<div class="hp2-form-fila">' +
        U.campo('Quién edita', '<input class="sx2-input" name="responsable" list="hp2-personas" maxlength="60" value="' + txt(p.responsable) + '">') +
        U.campo('Enlace al borrador del video', '<input class="sx2-input" type="url" name="enlace_borrador" maxlength="500" value="' + txt(p.enlace_borrador) + '" placeholder="https://drive.google.com/…">') +
      '</div>' +
      U.campo('Notas de producción', '<textarea class="sx2-input hp2-area" name="notas" rows="3" maxlength="1500">' + txt(p.notas) + '</textarea>') +
    '</div>';
  }
  function secPublicado(i) {
    var p = i.publicacion, met = D().catalogos.metricas;
    var tasa = function (m) { return m.vistas ? ((Number(m.me_gusta || 0) + Number(m.comentarios || 0) + Number(m.compartidos || 0) + Number(m.guardados || 0)) / m.vistas * 100) : null; };
    var t24 = tasa(p.h24), t7 = tasa(p.d7);
    var crec = p.h24.vistas && p.d7.vistas ? Math.round((p.d7.vistas / p.h24.vistas - 1) * 100) : null;
    return '<div class="js-hp2e-form" data-sec="publicacion">' +
      (i.etapa !== 'PUBLICADO' ? '<p class="hp2-nota">' + U.ico('info', 14) + 'Esta parte se completa cuando el video ya esté publicado.</p>' : '') +
      '<div class="hp2-form-fila">' +
        U.campo('Enlace del video en TikTok', '<input class="sx2-input" type="url" name="url" maxlength="500" value="' + txt(p.url) + '" placeholder="https://www.tiktok.com/@…/video/…">') +
        U.campo('Fecha de publicación', '<input class="sx2-input" type="date" name="fecha" value="' + txt(p.fecha) + '">') +
      '</div>' +
      '<div class="hp2e-metricas"><table><thead><tr><th></th><th>A las 24 h</th><th>A los 7 días</th></tr></thead><tbody>' + met.map(function (m) {
        return '<tr><th scope="row">' + txt(NOMBRES_METRICA[m] || m) + '</th>' +
          '<td><input class="sx2-input js-hp2e-m" data-p="h24" data-k="' + m + '" type="number" min="0" inputmode="numeric" value="' + (p.h24[m] == null ? '' : p.h24[m]) + '" aria-label="' + txt(NOMBRES_METRICA[m]) + ' a las 24 horas"></td>' +
          '<td><input class="sx2-input js-hp2e-m" data-p="d7" data-k="' + m + '" type="number" min="0" inputmode="numeric" value="' + (p.d7[m] == null ? '' : p.d7[m]) + '" aria-label="' + txt(NOMBRES_METRICA[m]) + ' a los 7 días"></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="hp2e-metricas__res">' +
        '<div><span>Interacción a las 24 h</span><b>' + (t24 == null ? '—' : t24.toFixed(1).replace('.', ',') + ' %') + '</b></div>' +
        '<div><span>Interacción a los 7 días</span><b>' + (t7 == null ? '—' : t7.toFixed(1).replace('.', ',') + ' %') + '</b></div>' +
        '<div><span>Vistas: de 24 h a 7 días</span><b>' + (crec == null ? '—' : (crec >= 0 ? '+' : '') + crec + ' %') + '</b></div>' +
        '<p class="sx2-tenue">Interacción = (me gusta + comentarios + compartidos + guardados) ÷ vistas.</p></div></div>' +
      U.campo('Qué aprendimos', '<textarea class="sx2-input hp2-area" name="aprendizajes" rows="3" maxlength="1500" placeholder="Qué funcionó, qué no, qué repetir en el próximo video">' + txt(p.aprendizajes) + '</textarea>') +
    '</div>';
  }

  // --- leer y guardar ------------------------------------------------------------------------
  function leer() {
    var r = H().raiz(), f = r.querySelector('.js-hp2e-form');
    if (!f) return null;
    var val = function (n) { var e = f.querySelector('[name="' + n + '"]'); return e ? String(e.value || '').trim() : ''; };
    var radio = function (n) { var e = f.querySelector('[name="' + n + '"]:checked'); return e ? e.value : ''; };
    var sec = f.getAttribute('data-sec'), o = {};
    if (sec === 'idea') o.idea = { gancho: val('gancho'), objetivo: radio('objetivo'), formato: radio('formato'), duracion: Number(radio('duracion')) || 30,
      referencia: val('referencia'), audio: val('audio'), hashtags: val('hashtags').split('\n').filter(Boolean), notas: val('notas') };
    else if (sec === 'dialogo') o.dialogo = dlg_;
    else if (sec === 'guion') o.guion = { escenas: esc_ };
    else if (sec === 'produccion') {
      var ch = {}; checklist().forEach(function (c) { var e = f.querySelector('[name="check_' + c[0] + '"]'); ch[c[0]] = !!(e && e.checked); });
      o.produccion = { checklist: ch, fecha_grabacion: val('fecha_grabacion'), hora_grabacion: val('hora_grabacion'), lugar: val('lugar'), responsable: val('responsable'), enlace_borrador: val('enlace_borrador'), notas: val('notas') };
    } else if (sec === 'publicacion') {
      var m = { h24: {}, d7: {} };
      f.querySelectorAll('.js-hp2e-m').forEach(function (e) { m[e.getAttribute('data-p')][e.getAttribute('data-k')] = e.value === '' ? null : Number(e.value); });
      o.publicacion = { url: val('url'), fecha: val('fecha'), h24: m.h24, d7: m.d7, aprendizajes: val('aprendizajes') };
    }
    var t = r.querySelector('.js-hp2e-titulo');
    if (t && t.value.trim()) o.titulo = t.value.trim();
    return o;
  }
  function estado(texto, tono) {
    var e = H().raiz() && H().raiz().querySelector('.js-hp2e-guardado');
    if (e) { e.textContent = texto; e.className = 'hp2e-guardado js-hp2e-guardado' + (tono ? ' hp2e-guardado--' + tono : ''); }
  }
  function programar() {
    pendiente_ = true;
    estado('Cambios sin guardar…', 'pend');
    clearTimeout(timer_);
    timer_ = setTimeout(guardarYa, 900);
  }
  function guardarYa() {
    clearTimeout(timer_);
    if (guardando_) return guardando_.then(guardarYa);
    if (!pendiente_ || !ideaId_) return Promise.resolve();
    var datos = leer();
    if (!datos) { pendiente_ = false; return Promise.resolve(); }
    pendiente_ = false;
    datos.idea_id = ideaId_;
    estado('Guardando…', 'pend');
    guardando_ = H().api('hompyGuardarIdea', datos).then(function (r) {
      guardando_ = null;
      if (!r || !r.ok) { pendiente_ = true; estado('No se pudo guardar: ' + ((r && r.message) || 'reintenta'), 'error'); return; }
      ponerIdea(r.data.idea);
      estado('Guardado ✓', 'ok');
      repintarLado();
    });
    return guardando_;
  }
  function ocupado() { return pendiente_ || !!guardando_; }

  // --- mover entre etapas --------------------------------------------------------------------
  function mover(id, etapa, extra) {
    var antes = idea(id);
    return H().api('hompyMoverIdea', Object.assign({ idea_id: id, etapa: etapa }, extra || {})).then(function (r) {
      if (!r || !r.ok) {
        H().aviso((r && r.message) || 'No se pudo mover la idea.', 'error');
        var t = H().raiz().querySelector('.hp2e-tarjeta[data-id="' + id + '"]');
        if (t) { t.classList.remove('hp2e-sacude'); void t.offsetWidth; t.classList.add('hp2e-sacude'); }
        return null;
      }
      var i = r.data.idea;
      ponerIdea(i);
      var adelante = antes && ETAPAS.indexOf(etapa) > ETAPAS.indexOf(antes.etapa) && antes.etapa !== 'DESCARTADA';
      if (etapa === 'PUBLICADO' && adelante) H().celebrar({ titulo: '¡Video publicado!', texto: '«' + i.titulo + '» ya está en TikTok. Anoten las métricas a las 24 horas.' });
      else if (adelante) H().aviso('«' + i.titulo + '» pasó a ' + INFO[etapa].n + '.', 'exito');
      return i;
    });
  }
  function pedirUrlYPublicar(i, alTerminar) {
    U.formulario({
      titulo: '¡A publicar!', boton: 'Marcar como publicado',
      campos: '<p class="hp2-nota">' + U.ico('estrella', 14) + 'Pega el enlace del video en TikTok. Después anoten las métricas a las 24 horas y a los 7 días.</p>' +
        U.campo('Enlace del video', '<input class="sx2-input" type="url" name="url" required placeholder="https://www.tiktok.com/@…/video/…">'),
      alMontar: function (form, d) { d.el.classList.add('hp2-drawer'); },
      enviar: function (datos) { return mover(i.idea_id, 'PUBLICADO', { url: datos.url }).then(function (x) { return x ? { ok: true, data: x } : { ok: false, message: 'Revisa el enlace e inténtalo de nuevo.' }; }); },
      listo: function () { if (alTerminar) alTerminar(); }
    });
  }
  function pedirMotivo(i, alTerminar) {
    U.formulario({
      titulo: 'Descartar «' + i.titulo + '»', boton: 'Descartar',
      campos: '<p class="hp2-nota">' + U.ico('info', 14) + 'Queda guardada en «Descartadas», con el motivo, para no repetirla (o recuperarla más adelante).</p>' +
        U.campo('¿Por qué se descarta?', '<textarea class="sx2-input hp2-area" name="motivo" rows="3" maxlength="300" required placeholder="Ej.: ya lo hizo otra marca, no tenemos dónde grabarlo…"></textarea>'),
      alMontar: function (form, d) { d.el.classList.add('hp2-drawer'); },
      enviar: function (datos) { return mover(i.idea_id, 'DESCARTADA', { motivo: datos.motivo }).then(function (x) { return x ? { ok: true } : { ok: false, message: 'Cuenta brevemente por qué se descarta.' }; }); },
      aviso: 'Idea descartada.', listo: function () { if (alTerminar) alTerminar(); }
    });
  }
  function soltarEn(id, etapa) {
    var i = idea(id);
    if (!i || i.etapa === etapa) return;
    if (etapa === 'DESCARTADA') { pedirMotivo(i, tablero); return; }
    if (etapa === 'PUBLICADO' && i.etapa === 'PRODUCCION' && !i.publicacion.url) {
      if (faltan(i).length) { mover(id, etapa); return; }
      pedirUrlYPublicar(i, tablero); return;
    }
    mover(id, etapa).then(function (x) { if (x) { nuevaId_ = ''; tablero(); var t = H().raiz().querySelector('.hp2e-tarjeta[data-id="' + id + '"]'); if (t) { t.classList.add('hp2e-tarjeta--llega'); H().chispas(t); } } });
  }

  // --- portada ------------------------------------------------------------------------------
  function frases() {
    var l = ideas(), f = [];
    var porEt = function (et) { return l.filter(function (i) { return i.etapa === et; }); };
    var top = porEt('IDEA').filter(function (i) { return i.votos.length > 1; }).sort(function (a, b) { return b.votos.length - a.votos.length; })[0];
    if (top) f.push('«' + top.titulo + '» tiene ' + top.votos.length + ' votos. ¿La pasamos a diálogo?');
    if (porEt('DIALOGO').length) f.push(porEt('DIALOGO').length === 1 ? 'Hay una idea esperando su diálogo en el Estudio.' : 'Hay ' + porEt('DIALOGO').length + ' ideas esperando su diálogo en el Estudio.');
    var pub = porEt('PUBLICADO').filter(function (i) { return i.publicacion.h24.vistas != null; }).sort(function (a, b) { return a.publicacion.fecha < b.publicacion.fecha ? 1 : -1; })[0];
    if (pub) f.push('Mi último video, «' + pub.titulo + '», tuvo ' + num(pub.publicacion.h24.vistas) + ' vistas en 24 horas.');
    var sinMetricas = porEt('PUBLICADO').find(function (i) { return i.publicacion.h24.vistas == null; });
    if (sinMetricas) f.push('A «' + sinMetricas.titulo + '» le faltan las métricas. ¿Cuántas vistas lleva?');
    if (!l.length) f.push('Mi Estudio TikTok está listo. ¡Anoten la primera idea!');
    else f.push('Cualquier idea sirve: anótenla en el Estudio y la vamos puliendo.');
    return f;
  }
  function tarjetaPortada() {
    var l = ideas();
    var top = l.filter(function (i) { return i.etapa !== 'DESCARTADA' && i.etapa !== 'PUBLICADO'; }).sort(function (a, b) { return b.votos.length - a.votos.length; })[0];
    return '<section class="hp2e-portada sx2-card sx2-entra" style="--i:7">' +
      '<header class="hp2e-portada__cab"><span class="hp2e-portada__ico">' + U.ico('camara', 18) + '</span><div><h2>Estudio TikTok</h2><p>De la idea al video, paso a paso.</p></div>' +
        U.boton({ texto: 'Abrir el Estudio', icono: 'derecha', variante: 'primario', sm: true, clase: 'js-hp2-ir hp2-boton-hompy', datos: { ir: 'estudio' } }) + '</header>' +
      '<ol class="hp2e-embudo hp2e-embudo--mini">' + ETAPAS.map(function (et) {
        var n = l.filter(function (i) { return i.etapa === et; }).length;
        return '<li class="hp2-color-' + INFO[et].color + '"><span class="hp2e-embudo__ico">' + U.ico(INFO[et].ico, 14) + '</span><span><b>' + n + '</b>' + txt(INFO[et].n) + '</span></li>';
      }).join('') + '</ol>' +
      (top ? '<button type="button" class="hp2e-portada__top js-hp2e-abrir" data-id="' + txt(top.idea_id) + '"><span>🔥 ' + top.votos.length + '</span><b>' + txt(top.titulo) + '</b><small>' + txt(INFO[top.etapa].n) + '</small></button>' : '') +
    '</section>';
  }

  // --- eventos ------------------------------------------------------------------------------
  function enlazarSeccion() {
    var r = H().raiz(), f = r.querySelector('.js-hp2e-form');
    if (!f) return;
    H().enlazarChips(f, programar);
    r.querySelectorAll('.js-hp2e-l-texto').forEach(autoalto);
    var t = r.querySelector('.js-hp2e-titulo');
    if (t) { autoalto(t); t.addEventListener('input', function () { t.value = t.value.replace(/[\r\n]+/g, ' '); autoalto(t); programar(); }); }
  }
  function dentro(ev) { var r = H().raiz && H().raiz(); return r && r.contains(ev.target) && r.querySelector('.hp2e-tablero, .hp2e-taller, .hp2e-portada'); }

  document.addEventListener('input', function (ev) {
    if (!window.SigsoHompy || !dentro(ev)) return;
    var el = ev.target;
    if (!el.closest('.js-hp2e-form')) return;
    if (el.classList.contains('js-hp2e-nueva') || el.classList.contains('js-hp2e-actor-nuevo') || el.classList.contains('hp2-chips__input')) { if (el.classList.contains('js-hp2e-nueva')) autoalto(el); return; }
    if (el.classList.contains('js-hp2e-l-texto')) { var k = Number(el.closest('.hp2e-linea').getAttribute('data-i')); dlg_.lineas[k].texto = el.value; autoalto(el); }
    if (el.classList.contains('js-hp2e-e')) {
      var j = Number(el.closest('.hp2e-escena').getAttribute('data-i')), campo = el.getAttribute('data-k');
      esc_[j][campo] = campo === 'segundos' ? (Number(el.value) || 0) : el.value;
      if (campo === 'segundos') H().raiz().querySelector('.js-hp2e-tiempo').innerHTML = tiempoHtml(idea(ideaId_));
    }
    if (el.name === 'gancho') { var c = H().raiz().querySelector('.js-hp2e-contador'); if (c) c.textContent = el.value.length + '/200'; }
    programar();
  });
  document.addEventListener('change', function (ev) {
    if (!window.SigsoHompy || !dentro(ev)) return;
    var el = ev.target;
    if (!el.closest('.js-hp2e-form')) return;
    if (el.classList.contains('js-hp2e-l-personaje')) { var k = Number(el.closest('.hp2e-linea').getAttribute('data-i')); dlg_.lineas[k].personaje = el.value; repintarDialogo(); programar(); return; }
    if (el.classList.contains('js-hp2e-e')) { var j = Number(el.closest('.hp2e-escena').getAttribute('data-i')); esc_[j][el.getAttribute('data-k')] = el.getAttribute('data-k') === 'segundos' ? (Number(el.value) || 0) : el.value; }
    if (el.name && el.name.indexOf('check_') === 0) {
      var n = H().raiz().querySelectorAll('.hp2e-check input:checked').length, total = checklist().length, a = H().raiz().querySelector('.js-hp2e-anillo');
      if (a) { a.style.setProperty('--pct', Math.round(n / total * 100)); a.innerHTML = '<span>' + (n === total ? U.ico('check', 18) : n + '/' + total) + '</span>'; a.classList.toggle('hp2-progreso__anillo--listo', n === total); }
      if (el.checked && !H().sinMov()) H().chispas(el.closest('.hp2e-check__op'));
    }
    if (el.type === 'radio' || el.type === 'checkbox' || el.type === 'date' || el.type === 'time' || el.tagName === 'SELECT') programar();
  });
  document.addEventListener('keydown', function (ev) {
    if (!window.SigsoHompy || !dentro(ev)) return;
    var el = ev.target;
    if (el.classList.contains('js-hp2e-nueva') && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); agregarLinea(); }
    else if (el.classList.contains('js-hp2e-actor-nuevo') && ev.key === 'Enter') {
      ev.preventDefault();
      var v = el.value.trim();
      if (v && !dlg_.personajes.some(function (p) { return p.toLowerCase() === v.toLowerCase(); }) && dlg_.personajes.length < 8) { dlg_.personajes.push(v); repintarDialogo(); H().raiz().querySelector('.js-hp2e-actor-nuevo') && H().raiz().querySelector('.js-hp2e-actor-nuevo').focus(); programar(); }
      else el.value = '';
    }
    else if (el.classList.contains('hp2e-tarjeta') && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); H().ir('idea', el.getAttribute('data-id')); }
    else if (el.classList.contains('js-hp2e-titulo') && ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
  });
  document.addEventListener('submit', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-hp2e-captura')) return;
    ev.preventDefault();
    var input = ev.target.querySelector('input[name=titulo]'), titulo = input.value.trim();
    if (!titulo) { input.focus(); return; }
    input.disabled = true;
    H().api('hompyGuardarIdea', { titulo: titulo }).then(function (r) {
      input.disabled = false;
      if (!r || !r.ok) { H().aviso((r && r.message) || 'No se pudo anotar la idea.', 'error'); return; }
      ponerIdea(r.data.idea); nuevaId_ = r.data.idea.idea_id;
      tablero();
      var t = H().raiz().querySelector('.hp2e-tarjeta[data-id="' + r.data.idea.idea_id + '"]');
      if (t) H().chispas(t.parentNode);
    });
  });
  document.addEventListener('click', function (ev) {
    if (!window.SigsoHompy || !dentro(ev)) return;
    var b = ev.target.closest('button, .hp2e-tarjeta');
    if (!b) return;
    var cl = b.classList, id = b.getAttribute('data-id');
    var linea = b.closest('.hp2e-linea'), escena = b.closest('.hp2e-escena');
    if (cl.contains('js-hp2e-votar')) {
      ev.stopPropagation();
      H().api('hompyVotarIdea', { idea_id: id }).then(function (r) {
        if (!r || !r.ok) { H().aviso((r && r.message) || 'No se pudo votar.', 'error'); return; }
        ponerIdea(r.data.idea);
        if (H().raiz().querySelector('.hp2e-taller')) repintarLado(); else tablero();
      });
      if (!H().sinMov()) { b.classList.remove('hp2e-voto--pop'); void b.offsetWidth; b.classList.add('hp2e-voto--pop'); }
    }
    else if (cl.contains('js-hp2e-recuperar')) { ev.stopPropagation(); mover(id, 'IDEA').then(function (x) { if (x) { if (H().raiz().querySelector('.hp2e-taller')) taller(x.idea_id, 'IDEA'); else tablero(); } }); }
    else if (cl.contains('hp2e-tarjeta') || cl.contains('js-hp2e-abrir')) H().ir('idea', id);
    else if (cl.contains('js-hp2e-descartadas')) { verDescartadas_ = !verDescartadas_; tablero(); }
    else if (cl.contains('js-hp2e-volver')) H().irAItem('estudio');
    else if (cl.contains('js-hp2e-tab')) { var tb = b.getAttribute('data-tab'); guardarYa().then(function () { taller(ideaId_, tb); }); }
    else if (cl.contains('js-hp2e-avanzar')) {
      guardarYa().then(function () {
        var i = idea(ideaId_), sig = siguiente(i.etapa);
        if (sig === 'PUBLICADO' && !i.publicacion.url) { pedirUrlYPublicar(i, function () { taller(ideaId_, 'PUBLICADO'); }); return; }
        mover(ideaId_, sig).then(function (x) {
          if (!x) return;
          taller(ideaId_, sig);
          var cara = H().raiz().querySelector('.js-hp2e-tip-cara');
          if (cara && !H().sinMov()) { cara.classList.add('hp2e-tip-salta'); H().chispas(cara.parentNode); }
        });
      });
    }
    else if (cl.contains('js-hp2e-atras')) { guardarYa().then(function () { var i = idea(ideaId_), ant = anterior(i.etapa); mover(ideaId_, ant).then(function (x) { if (x) taller(ideaId_, ant); }); }); }
    else if (cl.contains('js-hp2e-descartar')) guardarYa().then(function () { pedirMotivo(idea(ideaId_), function () { H().ir('estudio'); }); });
    else if (cl.contains('js-hp2e-eliminar')) {
      var i0 = idea(ideaId_);
      U.confirmar({ titulo: 'Eliminar «' + i0.titulo + '»', texto: 'Se borra del Estudio con todo su diálogo y guión. Si solo no va por ahora, mejor descártala: así queda el registro.', boton: 'Eliminar', peligro: true }).then(function (si) {
        if (!si) return;
        pendiente_ = false; clearTimeout(timer_);
        H().api('hompyEliminarIdea', { idea_id: ideaId_ }).then(function (r) {
          if (!r || !r.ok) { H().aviso((r && r.message) || 'No se pudo eliminar.', 'error'); return; }
          D().ideas = ideas().filter(function (x) { return x.idea_id !== ideaId_; });
          ideaId_ = ''; H().aviso('Idea eliminada.', 'exito'); H().ir('estudio');
        });
      });
    }
    // Idea
    else if (cl.contains('js-hp2e-plantilla')) {
      var g = H().raiz().querySelector('[name=gancho]'), p = b.getAttribute('data-t');
      g.value = g.value.trim() ? p + ' ' + g.value.trim() : p + ' ';
      g.focus(); g.setSelectionRange(g.value.length, g.value.length);
      g.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Diálogo
    else if (cl.contains('js-hp2e-agregar')) agregarLinea();
    else if (cl.contains('js-hp2e-ensayar')) ensayar(b);
    else if (cl.contains('js-hp2e-quitar-actor')) { var pa = b.getAttribute('data-p'); dlg_.personajes = dlg_.personajes.filter(function (x) { return x !== pa; }); repintarDialogo(); programar(); }
    else if (linea && (cl.contains('js-hp2e-l-subir') || cl.contains('js-hp2e-l-bajar') || cl.contains('js-hp2e-l-borrar') || cl.contains('js-hp2e-l-tipo'))) {
      var k = Number(linea.getAttribute('data-i')), L = dlg_.lineas;
      if (cl.contains('js-hp2e-l-subir') && k > 0) L.splice(k - 1, 0, L.splice(k, 1)[0]);
      else if (cl.contains('js-hp2e-l-bajar') && k < L.length - 1) L.splice(k + 1, 0, L.splice(k, 1)[0]);
      else if (cl.contains('js-hp2e-l-borrar')) L.splice(k, 1);
      else if (cl.contains('js-hp2e-l-tipo')) L[k].tipo = L[k].tipo === 'accion' ? 'dice' : 'accion';
      repintarDialogo(); programar();
    }
    // Guión
    else if (cl.contains('js-hp2e-armar')) {
      if (esc_.length) U.confirmar({ titulo: 'Reemplazar el guión', texto: 'Ya hay ' + esc_.length + ' escenas. Armarlo desde el diálogo las reemplaza por escenas nuevas.', boton: 'Reemplazar' }).then(function (si) { if (si) armarDesdeDialogo(); });
      else armarDesdeDialogo();
    }
    else if (cl.contains('js-hp2e-escena-nueva')) { esc_.push({ plano: 'Medio', accion: '', pantalla: '', audio: '', segundos: 3 }); repintarGuion(); var ult = H().raiz().querySelector('.hp2e-escena:last-child textarea'); if (ult) ult.focus(); programar(); }
    else if (cl.contains('js-hp2e-copiar')) {
      var texto = guionComoTexto();
      (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject()).then(function () { H().aviso('Guión copiado: pégalo donde quieras.', 'exito'); }, function () { H().aviso('No se pudo copiar el guión.', 'error'); });
    }
    else if (escena && (cl.contains('js-hp2e-e-subir') || cl.contains('js-hp2e-e-bajar') || cl.contains('js-hp2e-e-borrar') || cl.contains('js-hp2e-e-duplicar'))) {
      var j = Number(escena.getAttribute('data-i'));
      if (cl.contains('js-hp2e-e-subir') && j > 0) esc_.splice(j - 1, 0, esc_.splice(j, 1)[0]);
      else if (cl.contains('js-hp2e-e-bajar') && j < esc_.length - 1) esc_.splice(j + 1, 0, esc_.splice(j, 1)[0]);
      else if (cl.contains('js-hp2e-e-borrar')) esc_.splice(j, 1);
      else if (cl.contains('js-hp2e-e-duplicar')) esc_.splice(j + 1, 0, copia(esc_[j]));
      repintarGuion(); programar();
    }
    // Producción
    else if (cl.contains('js-hp2e-agendar')) {
      var f = H().raiz().querySelector('.js-hp2e-form'), fecha = f.querySelector('[name=fecha_grabacion]').value;
      if (!fecha) { H().aviso('Elige primero el día de la grabación.', 'error'); f.querySelector('[name=fecha_grabacion]').focus(); return; }
      b.disabled = true;
      guardarYa().then(function () {
        return H().api('hompyAgendarGrabacion', { idea_id: ideaId_, fecha: fecha, hora: f.querySelector('[name=hora_grabacion]').value, lugar: f.querySelector('[name=lugar]').value });
      }).then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { H().aviso((r && r.message) || 'No se pudo agendar.', 'error'); return; }
        ponerIdea(r.data.idea);
        var evs = D().eventos, ix = evs.findIndex(function (e) { return e.evento_id === r.data.evento.evento_id; });
        if (ix === -1) evs.push(r.data.evento); else evs[ix] = r.data.evento;
        H().aviso('Grabación agendada en el calendario de Hompy.', 'exito');
        taller(ideaId_, 'PRODUCCION');
      });
    }
    else if (cl.contains('js-hp2e-ver-evento')) H().abrirEvento(id);
  });

  // Arrastrar y soltar entre columnas (escritorio).
  var arrastrando_ = '';
  document.addEventListener('dragstart', function (ev) {
    var t = ev.target.closest && ev.target.closest('.hp2e-tarjeta');
    if (!t) return;
    arrastrando_ = t.getAttribute('data-id');
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', arrastrando_); } catch (e) { /* */ }
    t.classList.add('hp2e-tarjeta--arrastra');
    H().raiz().querySelector('.hp2e-tablero').classList.add('hp2e-tablero--arrastrando');
  });
  document.addEventListener('dragend', function () {
    if (!arrastrando_) return;
    arrastrando_ = '';
    var r = H().raiz();
    r.querySelectorAll('.hp2e-tarjeta--arrastra, .hp2e-col--sobre').forEach(function (e) { e.classList.remove('hp2e-tarjeta--arrastra', 'hp2e-col--sobre'); });
    var tb = r.querySelector('.hp2e-tablero'); if (tb) tb.classList.remove('hp2e-tablero--arrastrando');
  });
  document.addEventListener('dragover', function (ev) {
    if (!arrastrando_) return;
    var col = ev.target.closest && ev.target.closest('.hp2e-col');
    if (!col) return;
    ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
    H().raiz().querySelectorAll('.hp2e-col--sobre').forEach(function (e) { if (e !== col) e.classList.remove('hp2e-col--sobre'); });
    col.classList.add('hp2e-col--sobre');
  });
  document.addEventListener('drop', function (ev) {
    if (!arrastrando_) return;
    var col = ev.target.closest && ev.target.closest('.hp2e-col');
    if (!col) return;
    ev.preventDefault();
    var id = arrastrando_;
    soltarEn(id, col.getAttribute('data-etapa'));
  });
  window.addEventListener('beforeunload', function (ev) { if (ocupado()) { guardarYa(); ev.preventDefault(); ev.returnValue = ''; } });

  window.SigsoHompyEstudio = { tablero: tablero, taller: taller, frases: frases, tarjetaPortada: tarjetaPortada, ocupado: ocupado, guardarYa: guardarYa };
})();
