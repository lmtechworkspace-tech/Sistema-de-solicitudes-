/**
 * hompy-ayudante-v2.js — Hompy pasa de mascota a ayudante (2026-10-08).
 *
 * Sin IA: reglas sobre los datos del módulo. Lo que hace:
 *  - En la portada, cada cosa que dice puede traer un botón que lleva a hacerla
 *    («Llenar ahora», «Abrir la idea»…).
 *  - «Pregúntale a Hompy»: qué hay hoy, anotar una idea desde el globo, una idea
 *    de video, un dato de seguridad o un truco.
 *  - Trucos al tocarlo (salta, gira, baila, saluda, se sorprende; si lo tocan
 *    muchas veces seguidas, se marea), cosquillas al pasarle el mouse de lado a
 *    lado, y ratos libres: mira alrededor, se estira y, si nadie lo toca, se duerme.
 *  - En las demás vistas, un Hompy chico en la esquina con consejos de esa vista.
 *
 * Todo el movimiento se apaga con «reducir movimiento». Usa SigsoHompy._interno.
 */
(function () {
  'use strict';

  var U = UIv2;
  function H() { return window.SigsoHompy._interno; }
  function E() { return window.SigsoHompyEstudio || null; }
  function txt(v) { return H().txt(v); }
  function sinMov() { return H().sinMov(); }
  function D() { return H().datos(); }
  function corto(t, n) { t = String(t || ''); n = n || 48; return t.length > n ? t.slice(0, n - 1).trim() + '…' : t; }
  function azar(l) { return l[Math.floor(Math.random() * l.length)]; }
  function ses(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } return null; }

  var DATOS_SEGURIDAD = [
    'Las pausas activas cortas durante la jornada ayudan a prevenir dolores y lesiones.',
    'Para levantar algo pesado: espalda recta, rodillas dobladas y la carga pegada al cuerpo.',
    'Un pasillo despejado es la mejor ruta de evacuación. ¡Nada de cajas en el camino!',
    'Hidratarse no es solo cosa del verano: con calor o esfuerzo, agua cada rato.',
    'El extintor tiene que estar a la vista, señalizado y sin nada que lo tape.',
    'Si ves un riesgo, avísalo: reportar a tiempo evita accidentes.',
    'El chaleco reflectante sirve si se ve: limpio y bien puesto.',
    'La pantalla a la altura de los ojos cuida el cuello.',
    'Cables sueltos en el piso son tropiezos seguros. Ordénalos o señalízalos.',
    'Conocer la zona de seguridad de tu oficina toma un minuto y puede servir mucho.',
    'Los elementos de protección personal se cuidan y se revisan antes de usarlos.',
    'Después de mucho rato sentado, párate y estira las piernas. ¡Como yo!'
  ];
  var IDEAS_VIDEO = [
    '¿Sabías que el casco también se cambia cada cierto tiempo?',
    'POV: eres el chaleco reflectante y nadie te usa',
    '3 cosas que nadie te dice de las pausas activas',
    'El error que todos cometen al levantar una caja',
    'Hompy responde: ¿de verdad hay que usar zapatos de seguridad?',
    'No hagas esto en tu trabajo: bajar la escalera mirando el celular',
    'Hompy intenta trabajar sin hidratarse (spoiler: no le va bien)',
    'Antes y después de ordenar el puesto de trabajo',
    '¿Sabías que el extintor tiene que estar a la vista y sin nada delante?',
    'POV: llega la fiscalización y tu empresa está al día',
    'Hompy reacciona a los peores «tutoriales» de seguridad',
    '3 señales de que necesitas una pausa (y Hompy las tiene todas)',
    'El baile de la pausa activa, con Hompy',
    'Un día en la vida de una mascota con casco y chaleco'
  ];
  var RATOS_LIBRES = [
    'Psst… tócame y te cuento algo.',
    '¿Seguimos? Tengo el calendario a mano.',
    'Me encantaría salir a terreno hoy…',
    'El traje pesa harto. ¡Por eso las pausas!',
    '¿Y si anotamos una idea para TikTok?'
  ];
  var COSQUILLAS = ['¡Jiji, cosquillas!', '¡Ay, el chaleco no!', '¡Eso me gusta!', '¡Más despacito, que me despeino el casco!'];
  var TRUCOS = {
    salta: '¡Hop!',
    gira: '¡Vuelta completa!',
    baila: '♪ Un pasito pa\'lante… ♪',
    saluda: '¡Hola, hola!',
    sorpresa: '¡Oh! ¿Y eso?',
    corazon: '¡Saranghae! Un corazón coreano para ti.',
    guino: 'Te guiño un ojo: lo estás haciendo bien.',
    asiente: 'Sí, sí, ¡de acuerdo!',
    risa: '¡Jajaja! Me dio risa.',
    pulgar: '¡Buen trabajo, equipo!',
    piensa: 'Mmm… déjame pensar…'
  };
  // Cuánto dura cada gesto (ms), para quitar su clase al terminar.
  var DURA = { salta: 620, gira: 900, baila: 1300, saluda: 1800, sorpresa: 550, mareo: 1600, estira: 1600, corazon: 2000, guino: 800, asiente: 1100, niega: 1000, risa: 1400, pulgar: 1100, piensa: 2200 };
  var CHISTES = [
    '¿Qué le dijo el chaleco reflectante a la noche? ¡Contigo brillo!',
    '¿Por qué el extintor es tan tranquilo? Porque sabe apagar cualquier problema.',
    'Me dijeron que hiciera pausas activas… y me pausé activamente en el sillón.',
    '¿Qué hace un rinoceronte en una obra? ¡Pone el cuerno a trabajar!',
    'Mi casco y yo somos inseparables: él me protege y yo lo luzco.',
    '¿Por qué el casco nunca se preocupa? Porque siempre tiene la cabeza bien puesta.',
    '¿El colmo de una mascota? Que le pidan sacarse el traje… ¡si es mi piel!'
  ];
  var DICHOS_CABEZA = ['¡Mi casco! Recién lo limpié.', '¡Ey, que me despeinas el cuerno!', 'Toc, toc… ¿hay alguien en este casco? ¡Sí, yo!'];

  // --- Lo que Hompy sabe del día ---------------------------------------------------------------
  // Frase: { t: texto, acc: { texto, ir: [vista, arg] } | { texto, fn } }.
  function saludo() {
    var h = new Date().getHours(), d = new Date().getDay(), n = H().miNombre();
    var s = (h < 12 ? '¡Buenos días' : h < 20 ? '¡Buenas tardes' : '¡Buenas noches') + (n ? ', ' + n : '') + '!';
    if (d === 1) return s + ' Lunes: a empezar la semana con todo.';
    if (d === 5) return s + ' ¡Es viernes! ¿Qué dejamos listo antes del fin de semana?';
    if (d === 0 || d === 6) return s + ' ¿Trabajando en fin de semana? Yo también: el traje no descansa.';
    return s + ' ¿En qué te ayudo hoy?';
  }
  function frasesDelDia() {
    var f = [], h = H(), d = D(), pend = h.pendientes(), prox = h.proximas();
    var hoyEv = prox.filter(function (e) { return e.fecha === d.hoy; });
    var manana = prox.filter(function (e) { return e.fecha === h.sumarDias(d.hoy, 1); });
    var semana = prox.filter(function (e) { return h.diasEntre(d.hoy, e.fecha) < 7; });
    if (hoyEv.length) f.push({ t: '¡Hoy salimos! «' + corto(hoyEv[0].titulo) + '»' + (hoyEv[0].hora_inicio ? ' a las ' + hoyEv[0].hora_inicio : '') + '. ¡Casco puesto!', acc: { texto: 'Ver la actividad', fn: function () { h.abrirEvento(hoyEv[0].evento_id); } } });
    if (pend.length) f.push({ t: pend.length === 1 ? 'Tengo una salida sin reporte: «' + corto(pend[0].titulo) + '». ¿La anotamos?' : 'Tengo ' + pend.length + ' salidas sin reporte. ¿Las anotamos?', acc: { texto: 'Llenar ahora', ir: ['salida', pend[0].evento_id] } });
    if (!hoyEv.length && !pend.length) f.push({ t: saludo() });
    if (window.SigsoHompyTraje) f = f.concat(SigsoHompyTraje.frases());
    var dev = h.porDevolver();
    if (dev.length) f.push({ t: 'Hay ' + h.pesos(dev.reduce(function (a, g) { return a + (Number(g.monto) || 0); }, 0)) + ' por devolver a quienes pagaron gastos míos.', acc: { texto: 'Ver salidas', ir: ['salidas'] } });
    if (manana.length) f.push({ t: 'Mañana tenemos «' + corto(manana[0].titulo) + '». ¿Está listo el traje?', acc: { texto: 'Ver la actividad', fn: function () { h.abrirEvento(manana[0].evento_id); } } });
    if (semana.length > 1) f.push({ t: 'Esta semana tenemos ' + semana.length + ' actividades. ¡Qué agenda!', acc: { texto: 'Ver calendario', ir: ['calendario'] } });
    if (!prox.length) f.push({ t: 'Mi agenda está vacía… ¿salimos a alguna parte?', acc: { texto: 'Agendar una salida', fn: function () { h.nuevaActividad(); } } });
    if (d.tipos.every(function (t) { return t.origen === 'PROPUESTA'; })) f.push({ t: 'Mis tipos de evento son una propuesta: pónganles los nombres reales.', acc: { texto: 'Tipos de evento', ir: ['tipos'] } });
    f.push({ t: 'Tómense pausas con el traje: ¡aquí adentro hace calor!' });
    f.push({ t: 'Seguridad primero: casco, chaleco… y una buena sonrisa.' });
    if (E()) f = f.concat(E().frases().map(function (x) { return typeof x === 'string' ? { t: x } : x; }));
    var res = window.SigsoHompyResultados && SigsoHompyResultados.frase();
    if (res) f.push(res);
    return f;
  }
  function resumenHoy() {
    var h = H(), d = D(), pend = h.pendientes(), prox = h.proximas();
    var hoyEv = prox.filter(function (e) { return e.fecha === d.hoy; });
    var sinGancho = (d.ideas || []).filter(function (i) { return i.etapa === 'IDEA' && !i.idea.gancho; }).length;
    var partes = [];
    if (hoyEv.length) partes.push('hoy hay ' + (hoyEv.length === 1 ? 'una actividad: «' + corto(hoyEv[0].titulo, 36) + '»' + (hoyEv[0].hora_inicio ? ' a las ' + hoyEv[0].hora_inicio : '') : hoyEv.length + ' actividades'));
    if (pend.length) partes.push(pend.length === 1 ? 'un reporte por llenar' : pend.length + ' reportes por llenar');
    if (sinGancho) partes.push(sinGancho === 1 ? 'una idea sin gancho' : sinGancho + ' ideas sin gancho');
    if (!partes.length) {
      return prox.length
        ? { t: '¡Día tranquilo! Todo al día. Lo próximo: «' + corto(prox[0].titulo, 36) + '», ' + h.cuando(prox[0].fecha).toLowerCase() + '.', acc: { texto: 'Ver la actividad', fn: function () { h.abrirEvento(prox[0].evento_id); } } }
        : { t: '¡Día tranquilo! Nada agendado y todo al día. ¿Grabamos algo para TikTok?', acc: { texto: 'Abrir el Estudio', ir: ['estudio'] } };
    }
    var t = partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] : partes[0];
    var acc = pend.length ? { texto: 'Llenar el más antiguo', ir: ['salida', pend[0].evento_id] }
      : hoyEv.length ? { texto: 'Ver la actividad', fn: function () { h.abrirEvento(hoyEv[0].evento_id); } }
      : { texto: 'Ir al Estudio', ir: ['estudio'] };
    return { t: 'A ver… ' + t + '.', acc: acc };
  }
  function ideaDeVideo() {
    var g = azar(IDEAS_VIDEO);
    return { t: 'Idea de video: «' + g + '». ¿La anoto en el Estudio?', acc: { texto: 'Anotarla', fn: function () { anotarIdea(g); } } };
  }
  function datoSeguridad() { return { t: azar(DATOS_SEGURIDAD) }; }

  // Anota una idea en el Estudio sin salir de donde se está.
  function anotarIdea(titulo) {
    titulo = String(titulo || '').trim().slice(0, 120);
    if (!titulo) return Promise.resolve(null);
    return H().api('hompyGuardarIdea', { titulo: titulo }).then(function (r) {
      if (!r || !r.ok) { H().aviso((r && r.message) || 'No se pudo anotar la idea.', 'error'); return null; }
      var i = r.data.idea;
      if (E() && E().ponerIdea) E().ponerIdea(i); else (D().ideas = D().ideas || []).unshift(i);
      var f = { t: '¡Anotada! «' + corto(i.titulo) + '» ya está en el Estudio.', acc: { texto: 'Abrirla', ir: ['idea', i.idea_id] } };
      if (esc_ && esc_.isConnected) { decir(f); truco('salta'); H().chispas(esc_); }
      else { H().aviso('Idea anotada en el Estudio.', 'exito'); mostrarEnPanel(f); }
      return i;
    });
  }
  function hacer(acc) {
    if (!acc) return;
    if (acc.fn) acc.fn();
    else if (acc.ir) H().irAItem(acc.ir[0] + (acc.ir[1] ? ':' + acc.ir[1] : ''));
  }

  // --- La portada: globo, trucos y ratos libres ------------------------------------------------
  var esc_ = null, frases_ = [], fraseI_ = 0, actual_ = null, tipeo_ = null, clics_ = [], ultTruco_ = '';
  var ocio_ = null, zzz_ = null, nOcio_ = 0, durmiendo_ = false, cosq_ = { dir: 0, cambios: [], hasta: 0, x: 0 };

  function globo() { return esc_ && esc_.querySelector('.js-hp2-globo'); }
  function decir(f, inmediato) {
    var el = globo();
    if (!el) return;
    f = typeof f === 'string' ? { t: f } : f;
    actual_ = f;
    var vis = el.querySelector('.js-hp2-globo-txt'), acc = el.querySelector('.js-hp2-globo-acc');
    if (tipeo_) { clearInterval(tipeo_); tipeo_ = null; }
    el.querySelector('.js-hp2-globo-sr').textContent = f.t;
    acc.innerHTML = '';
    var botones = function () { if (f.acc) acc.innerHTML = '<button type="button" class="hp2-globo__btn js-hp2a-acc">' + txt(f.acc.texto) + U.ico('derecha', 12) + '</button>'; };
    if (inmediato || sinMov()) { el.classList.add('hp2-globo--fijo'); vis.textContent = f.t; botones(); return; }
    el.classList.remove('hp2-globo--pop', 'hp2-globo--fijo'); void el.offsetWidth; el.classList.add('hp2-globo--pop');
    var i = 0; vis.textContent = '';
    tipeo_ = setInterval(function () {
      i += 2; vis.textContent = f.t.slice(0, i);
      if (i >= f.t.length) { clearInterval(tipeo_); tipeo_ = null; botones(); }
    }, 22);
  }
  function pedirIdea() {
    var el = globo();
    if (!el) return;
    decir({ t: '¿Qué se te ocurrió? Anótalo y lo guardo en el Estudio.' }, true);
    el.querySelector('.js-hp2-globo-acc').innerHTML = '<form class="hp2-globo__form js-hp2a-form" autocomplete="off">' +
      '<input class="sx2-input" name="titulo" maxlength="120" placeholder="Tu idea en una frase" aria-label="Idea para TikTok" required>' +
      '<button type="submit" class="hp2-globo__btn">' + U.ico('nueva', 12) + 'Anotar</button></form>';
    el.querySelector('input').focus();
  }
  // o (opcional): { x, y } en % de la escena desde donde salen; grande: un símbolo enorme.
  function particulas(simbolo, n, color, o) {
    var cont = esc_ && esc_.querySelector('.js-hp2-efectos');
    if (!cont || sinMov()) return;
    for (var i = 0; i < (n || 5); i++) {
      var s = document.createElement('span');
      s.className = 'hp2-fx' + (o && o.grande ? ' hp2-fx--grande' : '');
      s.textContent = simbolo;
      s.style.setProperty('--x', (o ? o.x + (Math.random() - 0.5) * 10 : 30 + Math.random() * 40).toFixed(0) + '%');
      s.style.setProperty('--y', (o ? o.y + (Math.random() - 0.5) * 8 : 8 + Math.random() * 30).toFixed(0) + '%');
      s.style.setProperty('--dx', Math.round((Math.random() - 0.5) * 70) + 'px');
      s.style.setProperty('--r', Math.round((Math.random() - 0.5) * 50) + 'deg');
      s.style.setProperty('--s', (14 + Math.random() * 10).toFixed(0) + 'px');
      s.style.setProperty('--c', color || 'var(--hp-naranja)');
      s.style.animationDelay = (i * 0.12).toFixed(2) + 's';
      cont.appendChild(s);
      setTimeout(function (x) { return function () { x.remove(); }; }(s), 1800 + i * 120);
    }
  }
  function truco(nombre) {
    var btn = esc_ && esc_.querySelector('.js-hp2-mascota');
    if (!btn || sinMov()) return;
    if (!nombre) {
      var l = Object.keys(TRUCOS).filter(function (k) { return k !== ultTruco_; });
      nombre = azar(l);
    }
    ultTruco_ = nombre;
    btn.className = btn.className.replace(/\s?hp2-(salta|truco--\w+)/g, '');
    void btn.offsetWidth;
    btn.classList.add(nombre === 'salta' ? 'hp2-salta' : 'hp2-truco--' + nombre);
    clearTimeout(truco.t);
    truco.t = setTimeout(function () { btn.className = btn.className.replace(/\s?hp2-(salta|truco--\w+)/g, ''); }, (DURA[nombre] || 1000) + 60);
    if (nombre === 'baila') particulas('♪', 5, 'var(--hp-azul)');
    else if (nombre === 'sorpresa') particulas('!', 3, 'var(--hp-naranja)');
    else if (nombre === 'saluda') particulas('✦', 4, '#f59e0b', { x: 12, y: 30 });
    else if (nombre === 'mareo') particulas('★', 6, '#f59e0b');
    else if (nombre === 'corazon') setTimeout(function () { particulas('♥', 1, '#e11d48', { x: 16, y: 30, grande: true }); particulas('♥', 4, '#fb7185', { x: 18, y: 34 }); }, 450);
    else if (nombre === 'risa') particulas('ja', 4, 'var(--hp-naranja)');
    else if (nombre === 'pulgar') particulas('✦', 4, '#f59e0b', { x: 14, y: 36 });
    else if (nombre === 'piensa') particulas('?', 3, 'var(--hp-azul)', { x: 64, y: 4 });
    else if (nombre === 'guino') particulas('✦', 2, '#f59e0b', { x: 38, y: 16 });
    return nombre;
  }
  function despertar() {
    if (!durmiendo_) return false;
    durmiendo_ = false;
    clearInterval(zzz_); zzz_ = null;
    var btn = esc_ && esc_.querySelector('.js-hp2-mascota');
    if (btn) btn.classList.remove('hp2-mascota--duerme');
    decir('¡Ah! Me quedé dormido… el traje da calor.');
    truco('sorpresa');
    return true;
  }
  function programarOcio() {
    clearTimeout(ocio_);
    if (sinMov()) return;
    ocio_ = setTimeout(ratoLibre, 22000 + Math.random() * 10000);
  }
  function ratoLibre() {
    if (!esc_ || !esc_.isConnected) return;
    if (document.hidden) { programarOcio(); return; }
    var btn = esc_.querySelector('.js-hp2-mascota');
    nOcio_++;
    if (nOcio_ >= 4) {
      durmiendo_ = true;
      btn.className = btn.className.replace(/\s?hp2-(salta|truco--\w+)/g, '');
      btn.classList.add('hp2-mascota--duerme');
      decir('Zzz…');
      particulas('z', 2, 'var(--hp-azul)');
      zzz_ = setInterval(function () { if (!esc_ || !esc_.isConnected) { clearInterval(zzz_); return; } if (!document.hidden) particulas('z', 2, 'var(--hp-azul)'); }, 2600);
      return;
    }
    var r = Math.random();
    if (r < 0.25) { esc_.classList.remove('hp2-escena--mira'); void esc_.offsetWidth; esc_.classList.add('hp2-escena--mira'); }
    else if (r < 0.42) truco('estira');
    else if (r < 0.62) truco(azar(['guino', 'piensa', 'saluda']));
    else decir(azar(RATOS_LIBRES));
    programarOcio();
  }
  function actividad() {
    nOcio_ = 0;
    if (despertar()) { programarOcio(); return true; }
    programarOcio();
    return false;
  }
  // Dónde se lo toca importa: la cabeza reacciona, el brazo levanta el pulgar y el cuerpo cuenta algo.
  function tocarMascota(ev) {
    if (actividad()) return;
    var r = ev && ev.detail ? ev.currentTarget.getBoundingClientRect() : null;
    var zx = r ? (ev.clientX - r.left) / r.width : 0.5, zy = r ? (ev.clientY - r.top) / r.height : 0.6;
    var ahora = Date.now();
    clics_ = clics_.filter(function (t) { return ahora - t < 2600; }).concat([ahora]);
    if (clics_.length >= 6) {
      clics_ = [];
      decir('¡Me mareo! Tantas vueltas con este casco…');
      truco('mareo');
      return;
    }
    if (zy < 0.44 && zx > 0.24) { decir(azar(DICHOS_CABEZA)); truco(azar(['asiente', 'guino', 'risa', 'niega'])); return; }
    if (zx < 0.3 && zy >= 0.3 && zy < 0.6) { decir(TRUCOS.pulgar); truco('pulgar'); return; }
    fraseI_ = (fraseI_ + 1) % frases_.length;
    decir(frases_[fraseI_]);
    truco(clics_.length > 2 ? null : 'salta');
    H().chispas(esc_);
  }
  // Cosquillas: pasar el mouse de lado a lado sobre Hompy (varios cambios de dirección en un segundo).
  function cosquillas(ev) {
    var dx = ev.clientX - cosq_.x; cosq_.x = ev.clientX;
    if (Math.abs(dx) < 3) return;
    var dir = dx > 0 ? 1 : -1, ahora = Date.now();
    if (dir !== cosq_.dir) { cosq_.dir = dir; cosq_.cambios = cosq_.cambios.filter(function (t) { return ahora - t < 1100; }).concat([ahora]); }
    if (cosq_.cambios.length >= 5 && ahora > cosq_.hasta) {
      cosq_.cambios = []; cosq_.hasta = ahora + 4000;
      actividad();
      decir(azar(COSQUILLAS));
      truco('sorpresa');
      particulas('♥', 5, '#e11d48');
    }
  }

  function portada(esc, quieto) {
    clearTimeout(ocio_); clearInterval(zzz_); zzz_ = null;
    esc_ = esc;
    if (!esc) return;
    durmiendo_ = false; nOcio_ = 0; clics_ = [];
    frases_ = frasesDelDia();
    // Un repintado de fondo mantiene lo que Hompy estaba diciendo (sin volver a tipearlo).
    if (quieto && actual_) decir(actual_, true);
    // Al llegar a la portada, Hompy saluda con la mano.
    else { fraseI_ = 0; setTimeout(function () { if (esc_ === esc) { decir(frases_[0]); truco('saluda'); } }, sinMov() ? 0 : 900); }
    programarOcio();

    var btn = esc.querySelector('.js-hp2-mascota');
    btn.addEventListener('click', tocarMascota);
    esc.addEventListener('animationend', function (ev) { if (ev.target === esc) esc.classList.remove('hp2-escena--mira'); });
    if (sinMov() || !window.matchMedia('(hover: hover)').matches) return;
    btn.addEventListener('pointermove', cosquillas);
    // Mira hacia el cursor (un giro leve, sin bucle: solo cuando el mouse se mueve).
    var heroe = esc.closest('.hp2-heroe') || esc, pend = false, ex = 0, ey = 0, ultimo = 0;
    heroe.addEventListener('pointermove', function (ev) {
      ex = ev.clientX; ey = ev.clientY;
      if (Date.now() - ultimo > 1500) { ultimo = Date.now(); actividad(); }
      if (pend) return; pend = true;
      requestAnimationFrame(function () {
        pend = false;
        var r = esc.getBoundingClientRect();
        var dx = Math.max(-1, Math.min(1, (ex - (r.left + r.width / 2)) / (r.width * 1.5)));
        var dy = Math.max(-1, Math.min(1, (ey - (r.top + r.height / 3)) / (r.height * 1.5)));
        esc.style.setProperty('--mx', dx.toFixed(3)); esc.style.setProperty('--my', dy.toFixed(3));
      });
    });
    heroe.addEventListener('pointerleave', function () { esc.style.setProperty('--mx', 0); esc.style.setProperty('--my', 0); });
  }

  var PREGUNTAS = [
    ['hoy', '¿Qué hay hoy?', 'calendario'],
    ['idea', 'Anotar una idea', 'bombilla'],
    ['video', 'Idea de video', 'camara'],
    ['dato', 'Dato de seguridad', 'casco']
  ];
  var JUEGOS = [
    ['saluda', 'Saluda', 'hompy'],
    ['corazon', 'Corazón coreano', 'corazon'],
    ['baila', 'Baila', 'actividad'],
    ['chiste', 'Cuéntame un chiste', 'comentario'],
    ['guino', 'Guiño', 'ojo'],
    ['truco', 'Sorpréndeme', 'destello']
  ];
  function preguntas() {
    return '<div class="hp2a-preguntas" role="group" aria-label="Pregúntale a Hompy"><span class="hp2a-preguntas__et">Pregúntale a Hompy</span>' +
      PREGUNTAS.map(function (p) { return '<button type="button" class="hp2a-pregunta js-hp2a-p" data-p="' + p[0] + '">' + U.ico(p[2], 14) + txt(p[1]) + '</button>'; }).join('') +
      '<span class="hp2a-preguntas__et hp2a-preguntas__et--juego">Juega con Hompy</span>' +
      JUEGOS.map(function (p) { return '<button type="button" class="hp2a-pregunta hp2a-pregunta--juego js-hp2a-p" data-p="' + p[0] + '">' + U.ico(p[2], 14) + txt(p[1]) + '</button>'; }).join('') +
      (ses('hp2a-oculto') ? '<button type="button" class="hp2a-pregunta js-hp2a-volver">' + U.ico('hompy', 14) + 'Traer al ayudante</button>' : '') +
    '</div>';
  }
  function responder(p) {
    actividad();
    if (p === 'hoy') { decir(resumenHoy()); truco('saluda'); }
    else if (p === 'idea') pedirIdea();
    else if (p === 'video') { decir(ideaDeVideo()); truco('gira'); }
    else if (p === 'dato') { decir(datoSeguridad()); truco('sorpresa'); }
    else if (p === 'truco') { var n = truco(); decir(n ? TRUCOS[n] : 'Con «reducir movimiento» activado me quedo quieto… ¡pero sonrío!'); }
    else if (p === 'chiste') { decir(azar(CHISTES)); setTimeout(function () { truco('risa'); }, sinMov() ? 0 : 1600); }
    else if (TRUCOS[p]) { decir(TRUCOS[p]); truco(p); }
  }

  // --- El Hompy de la esquina (las demás vistas) ------------------------------------------------
  var SIN_FLOTANTE = { inicio: 1, salida: 1, idea: 1 };
  var consejos_ = [], consejoI_ = 0;
  function consejosDe(vista) {
    var h = H(), d = D(), c = [], prox = h.proximas(), pend = h.pendientes();
    if (vista === 'calendario') {
      if (prox.length) c.push({ t: 'Lo próximo: «' + corto(prox[0].titulo) + '», ' + h.cuando(prox[0].fecha).toLowerCase() + (prox[0].hora_inicio ? ' a las ' + prox[0].hora_inicio : '') + '.', acc: { texto: 'Ver la actividad', fn: function () { h.abrirEvento(prox[0].evento_id); } } });
      c.push({ t: 'Toca un día del calendario y agendamos ahí mismo.', acc: { texto: 'Nueva actividad', fn: function () { h.nuevaActividad(); } } });
      c.push({ t: 'Toca un tipo en la leyenda para ocultarlo o mostrarlo.' });
    } else if (vista === 'estudio') {
      if (E()) c = c.concat(E().frases().map(function (x) { return typeof x === 'string' ? { t: x } : x; }).filter(function (x) { return !(x.acc && x.acc.ir && x.acc.ir[0] === 'estudio'); }));
      c.push(ideaDeVideo());
      c.push({ t: 'Arrastra las tarjetas entre columnas para cambiarlas de etapa. Las más votadas quedan arriba.' });
    } else if (vista === 'salidas') {
      if (pend.length) c.push({ t: pend.length === 1 ? 'Falta el reporte de «' + corto(pend[0].titulo) + '».' : 'Faltan ' + pend.length + ' reportes. Partamos por el más antiguo.', acc: { texto: 'Llenar ahora', ir: ['salida', pend[0].evento_id] } });
      else c.push({ t: '¡Todo al día! No hay salidas esperando su reporte.' });
      c.push({ t: 'Los reportes cerrados se descargan en PDF desde «Cerradas».' });
    } else if (vista === 'marcas' || vista === 'marca') {
      c.push({ t: 'Cada actividad o video con una marca queda en su historia. Elíjanla al agendar o en la idea.' });
      c.push({ t: 'El reporte del mes junta marcas, salidas, videos y dinero.', acc: { texto: 'Reporte mensual', ir: ['reportes'] } });
    } else if (vista === 'reportes') {
      c.push({ t: 'Este reporte se descarga en PDF: sirve para mostrar el mes de Hompy a la gerencia o a una marca.' });
    } else if (vista === 'tipos') {
      if (d.tipos.every(function (t) { return t.origen === 'PROPUESTA'; })) c.push({ t: 'Estos tipos son una propuesta: cámbienles el nombre y lo agendado se actualiza solo.' });
      c.push({ t: 'Si un tipo ya no se usa, apáguenlo: lo agendado se conserva.' });
    } else if (vista === 'traje') {
      c.push({ t: 'Cuando el traje vuelva de la lavandería o de la reparación, márquenlo como listo: así no salgo con él malo.' });
      c.push({ t: 'Rotar quién usa el traje reparte el calor. Miren los turnos: les digo a quién le toca.' });
    } else if (vista === 'resultados') {
      var rf = window.SigsoHompyResultados && SigsoHompyResultados.frase();
      if (rf) c.push({ t: rf.t.replace(/ ¿Vemos qué nos funciona\?$/, '') });
      c.push({ t: 'Anoten las vistas a las 24 horas y a los 7 días: con eso comparo qué tipo de video nos resulta mejor.', acc: { texto: 'Ir al Estudio', ir: ['estudio'] } });
    } else if (vista === 'redes') {
      c.push({ t: 'Activen la verificación en dos pasos en cada red: si alguien saca la clave, igual no entra.' });
    }
    c.push(datoSeguridad());
    c.push({ t: '¿Volvemos a la portada? Ahí te cuento todo lo del día.', acc: { texto: 'Ir a la portada', ir: ['inicio'] } });
    return c;
  }
  function flotante(vista) {
    var envoltura = H().raiz() && H().raiz().querySelector('.hp2');
    if (!envoltura || SIN_FLOTANTE[vista] || ses('hp2a-oculto')) return;
    consejos_ = consejosDe(vista); consejoI_ = 0;
    var urgente = H().pendientes().length > 0;
    var el = document.createElement('div');
    el.className = 'hp2a-flota';
    el.innerHTML = '<div class="hp2a-panel js-hp2a-panel" role="dialog" aria-label="Hompy, tu ayudante" hidden>' +
        '<header class="hp2a-panel__cab"><img src="assets/hompy/hompy-cara.webp" alt="" width="36" height="36"><div><b>Hompy</b><small>Tu ayudante</small></div>' +
          '<button type="button" class="hp2a-panel__x js-hp2a-cerrar" aria-label="Cerrar">' + U.ico('equis', 14) + '</button></header>' +
        '<p class="hp2a-panel__txt js-hp2a-txt" aria-live="polite"></p>' +
        '<div class="hp2a-panel__acc js-hp2a-panel-acc"></div>' +
        '<footer class="hp2a-panel__pie"><button type="button" class="sx2-enlace js-hp2a-ocultar">Esconder a Hompy por hoy</button></footer>' +
      '</div>' +
      '<button type="button" class="hp2a-boton js-hp2a-abrir" aria-expanded="false" aria-label="Hompy, tu ayudante: consejos para esta pantalla">' +
        '<img src="assets/hompy/hompy-cara.webp" alt="" width="52" height="52">' + (urgente ? '<span class="hp2a-boton__punto" aria-hidden="true"></span>' : '') + '</button>';
    envoltura.appendChild(el);
  }
  function mostrarEnPanel(c) {
    var p = document.querySelector('.hp2a-flota--abierta .js-hp2a-panel');
    if (!p || !c) return;
    p.querySelector('.js-hp2a-txt').textContent = c.t;
    p.querySelector('.js-hp2a-panel-acc').innerHTML = (c.acc ? U.boton({ texto: c.acc.texto, icono: 'derecha', sm: true, variante: 'primario', clase: 'js-hp2a-panel-hacer hp2-boton-hompy' }) : '') +
      (consejos_.length > 1 ? U.boton({ texto: 'Otro consejo', icono: 'bombilla', sm: true, variante: 'fantasma', clase: 'js-hp2a-otro' }) : '');
    p._consejo = c;
  }
  function abrirPanel(flota, abrir) {
    var p = flota.querySelector('.js-hp2a-panel'), b = flota.querySelector('.js-hp2a-abrir');
    flota.classList.toggle('hp2a-flota--abierta', abrir);
    p.hidden = !abrir; b.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    if (abrir) {
      mostrarEnPanel(consejos_[consejoI_ % consejos_.length]);
      var punto = b.querySelector('.hp2a-boton__punto'); if (punto) punto.remove();
      var foco = p.querySelector('.js-hp2a-panel-hacer, .js-hp2a-otro, .js-hp2a-cerrar'); if (foco) foco.focus();
    }
  }

  // --- Eventos ----------------------------------------------------------------------------------
  document.addEventListener('click', function (ev) {
    var r = window.SigsoHompy && H().raiz();
    if (!r || !r.contains(ev.target)) {
      // Clic fuera del ayudante abierto: se cierra.
      var ab = document.querySelector('.hp2a-flota--abierta');
      if (ab && !ab.contains(ev.target)) abrirPanel(ab, false);
      return;
    }
    var b = ev.target.closest('button');
    var ab2 = document.querySelector('.hp2a-flota--abierta');
    if (ab2 && !ab2.contains(ev.target)) abrirPanel(ab2, false);
    if (!b) return;
    var cl = b.classList, flota = b.closest('.hp2a-flota');
    if (cl.contains('js-hp2a-p')) responder(b.getAttribute('data-p'));
    else if (cl.contains('js-hp2a-acc')) { var a = actual_ && actual_.acc; actividad(); hacer(a); }
    else if (cl.contains('js-hp2a-volver')) { ses('hp2a-oculto', null); b.remove(); H().aviso('¡Volví! Me verás en la esquina de las demás pantallas.', 'exito'); }
    else if (cl.contains('js-hp2a-abrir')) abrirPanel(flota, !flota.classList.contains('hp2a-flota--abierta'));
    else if (cl.contains('js-hp2a-cerrar')) { abrirPanel(flota, false); flota.querySelector('.js-hp2a-abrir').focus(); }
    else if (cl.contains('js-hp2a-otro')) { consejoI_ = (consejoI_ + 1) % consejos_.length; mostrarEnPanel(consejos_[consejoI_]); }
    else if (cl.contains('js-hp2a-panel-hacer')) { var c = flota.querySelector('.js-hp2a-panel')._consejo; abrirPanel(flota, false); hacer(c && c.acc); }
    else if (cl.contains('js-hp2a-ocultar')) { ses('hp2a-oculto', '1'); flota.remove(); H().aviso('Hompy se esconde por hoy. Lo traes de vuelta desde la portada.', 'info'); }
  });
  document.addEventListener('submit', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-hp2a-form')) return;
    ev.preventDefault();
    var input = ev.target.querySelector('input'), boton = ev.target.querySelector('button');
    if (!input.value.trim()) { input.focus(); return; }
    input.disabled = boton.disabled = true;
    anotarIdea(input.value).then(function (i) { if (!i) { input.disabled = boton.disabled = false; input.focus(); } });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    var ab = document.querySelector('.hp2a-flota--abierta');
    if (ab) { abrirPanel(ab, false); ab.querySelector('.js-hp2a-abrir').focus(); return; }
    var form = ev.target.closest && ev.target.closest('.js-hp2a-form');
    if (form && actual_) { fraseI_ = (fraseI_ + 1) % frases_.length; decir(frases_[fraseI_], true); }
  });

  window.SigsoHompyAyudante = { portada: portada, preguntas: preguntas, flotante: flotante };
})();
