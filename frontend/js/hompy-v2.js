/**
 * hompy-v2.js — módulo Hompy, la mascota de HomePymes (Etapa 1, 2026-10-06;
 * backend/logica/hompy.js).
 *
 * Es «el apartado de marketing» de SIGSO: por eso Hompy está a la vista y se
 * mueve (entra con un rebote, respira, saluda al pasar el mouse, salta al
 * tocarlo, mira hacia el cursor y celebra al cerrar un reporte). Todo el
 * movimiento se apaga con «reducir movimiento» del sistema.
 *
 * Vistas: Portada · Calendario · Estudio TikTok (hompy-estudio-v2.js, Etapa 2)
 * · Marcas y Reporte mensual (hompy-marcas-v2.js, Etapa 3) · Salidas a terreno
 * (+ el reporte de cada una) · Tipos de evento.
 */
(function () {
  'use strict';

  var U = UIv2;
  var IMG = 'assets/hompy/hompy.webp';
  var VISTAS = { inicio: 1, calendario: 1, salidas: 1, tipos: 1, salida: 1, estudio: 1, idea: 1, marcas: 1, marca: 1, reportes: 1 };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var NOMBRES_COLOR = { naranja: 'Naranja', azul: 'Azul', rosa: 'Rosa', verde: 'Verde', ambar: 'Ámbar', violeta: 'Violeta', turquesa: 'Turquesa', gris: 'Gris' };
  var TRAJE = {
    BUENO: { t: 'En buen estado', ico: 'check', tono: 'ok' },
    LIMPIEZA: { t: 'Necesita limpieza', ico: 'info', tono: 'alerta' },
    REPARACION: { t: 'Necesita reparación', ico: 'alerta', tono: 'critico' }
  };

  var raiz_ = null, D = null, vista_ = 'inicio', arg_ = '', turno_ = 0;
  var mes_ = '', modoCal_ = 'mes', ocultos_ = {}, filtroSalidas_ = 'pendientes', diaSel_ = '';
  var sucio_ = false, frases_ = [], fraseI_ = 0, tipeo_ = null;

  // --- utilidades ---------------------------------------------------------------------------
  function txt(v) { return U.esc(v == null ? '' : String(v)); }
  function sinMov() { return U.reducirMovimiento(); }
  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {})
      .catch(function (e) { return { ok: false, message: (e && e.message) || 'No se pudo conectar.' }; });
  }
  function aviso(texto, tipo) { if (window.Componentes && Componentes.aviso) Componentes.aviso({ texto: texto, tipo: tipo || 'info' }); }
  function dia(f) { return new Date(f + 'T12:00:00Z'); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function sumarDias(f, n) { return iso(new Date(dia(f).getTime() + n * 864e5)); }
  function diasEntre(a, b) { return Math.round((dia(b) - dia(a)) / 864e5); }
  function fechaCorta(f) { var d = dia(f); return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()].slice(0, 3); }
  function fechaLarga(f) { var d = dia(f); return DIAS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' de ' + MESES[d.getUTCMonth()]; }
  function cuando(f) {
    var n = diasEntre(D.hoy, f);
    if (n === 0) return 'Hoy'; if (n === 1) return 'Mañana'; if (n === -1) return 'Ayer';
    if (n > 1 && n < 7) return 'En ' + n + ' días'; if (n < -1 && n > -7) return 'Hace ' + (-n) + ' días';
    return fechaCorta(f);
  }
  function horario(e) { return e.hora_inicio ? e.hora_inicio + (e.hora_fin ? '–' + e.hora_fin : '') : 'Sin hora'; }
  function miNombre() {
    try { var c = JSON.parse(localStorage.getItem('sigso_portal_cuenta') || '{}'); return String(c.nombre || '').split(' ')[0]; } catch (e) { return ''; }
  }
  function nombreDe(email) { return (D && D.nombres && D.nombres[String(email || '').toLowerCase()]) || email || ''; }
  function descargarBase64(base64, nombre, tipo) {
    var bin = atob(base64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    var a = document.createElement('a'); a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // --- datos derivados ----------------------------------------------------------------------
  function tipo(id) { return (D.tipos || []).find(function (t) { return t.tipo_id === id; }) || { tipo_id: id, nombre: 'Sin tipo', color: 'gris', icono: 'calendario', activo: false }; }
  function tiposActivos() { return D.tipos.filter(function (t) { return t.activo; }); }
  function salidaDe(id) { return (D.salidas || []).find(function (s) { return s.evento_id === id; }) || null; }
  function evento(id) { return (D.eventos || []).find(function (e) { return e.evento_id === id; }) || null; }
  /** Estado visible: lo que la persona tiene que saber (y hacer) de la actividad. */
  function estadoDe(e) {
    var s = salidaDe(e.evento_id);
    if (e.estado === 'CANCELADO') return { clave: 'cancelada', t: 'Cancelada', tono: 'neutro' };
    if (s && s.estado === 'CERRADO') return { clave: 'cerrada', t: 'Reporte cerrado', tono: 'ok' };
    if (s) return { clave: 'borrador', t: 'Reporte en borrador', tono: 'alerta' };
    if (e.estado === 'REALIZADO') return { clave: 'falta', t: 'Falta el reporte', tono: 'alerta' };
    if (e.fecha < D.hoy) return { clave: 'sehizo', t: '¿Se realizó?', tono: 'alerta' };
    if (e.estado === 'CONFIRMADO') return { clave: 'confirmada', t: 'Confirmada', tono: 'info' };
    return { clave: 'planificada', t: 'Planificada', tono: 'neutro' };
  }
  function pendientes() {
    return D.eventos.filter(function (e) {
      var k = estadoDe(e).clave;
      return (k === 'falta' || k === 'sehizo' || k === 'borrador') && e.fecha <= D.hoy;
    }).sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
  }
  function proximas() {
    return D.eventos.filter(function (e) { return e.estado !== 'CANCELADO' && e.fecha >= D.hoy && !(salidaDe(e.evento_id) || {}).estado; })
      .sort(function (a, b) { return (a.fecha + a.hora_inicio) < (b.fecha + b.hora_inicio) ? -1 : 1; });
  }
  function delMes(m) { return D.eventos.filter(function (e) { return e.fecha.slice(0, 7) === m; }); }
  function ordenar(lista) { return lista.slice().sort(function (a, b) { return (a.fecha + (a.hora_inicio || '99')) < (b.fecha + (b.hora_inicio || '99')) ? -1 : 1; }); }

  // --- carga y navegación -------------------------------------------------------------------
  function cargar() {
    raiz_ = document.getElementById('modulo-hompy');
    if (!raiz_) return;
    registrarArbol();
    var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta) ? SigsoShell.tomarItemDeRuta() : '';
    var p = partes(pedida || vista_ || 'inicio');
    traer(p.vista, p.arg);
  }
  function partes(item) {
    var s = String(item || ''), i = s.indexOf(':');
    var v = i === -1 ? s : s.slice(0, i);
    return { vista: VISTAS[v] ? v : 'inicio', arg: i === -1 ? '' : s.slice(i + 1) };
  }
  function traer(v, arg, silencioso, reintento) {
    var t = ++turno_;
    if ((!silencioso || !D) && !reintento) pagina('<div class="hp2-cargando">' + U.esqueleto('kpis', 4) + U.esqueleto('tarjetas', 3) + '</div>');
    return api('hompyDatos').then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) {
        // Una actualización de fondo que falla no borra lo que se está viendo.
        if (silencioso && D) return;
        // La carga inicial se reintenta una vez (el servidor a veces tarda) antes de mostrar el error.
        if (!reintento) return new Promise(function (ok) { setTimeout(ok, 1200); }).then(function () { return traer(v, arg, silencioso, true); });
        pagina(U.card({ cuerpo: U.vacio({ icono: 'hompy', titulo: 'No se pudo abrir Hompy', texto: (r && r.message) || 'Inténtalo de nuevo en un momento.',
          accion: U.boton({ texto: 'Reintentar', icono: 'derivar', variante: 'primario', sm: true, clase: 'js-hp2-reintentar hp2-boton-hompy' }) }) }));
        return;
      }
      D = r.data;
      if (!mes_) mes_ = D.hoy.slice(0, 7);
      pintarBadge();
      ir(v, arg, true);
    });
  }
  // El Estudio TikTok vive en su propio archivo (hompy-estudio-v2.js).
  function E() { return window.SigsoHompyEstudio || null; }
  // Marcas y reporte mensual (hompy-marcas-v2.js).
  function M() { return window.SigsoHompyMarcas || null; }
  function refrescar() {
    if (!raiz_ || raiz_.classList.contains('sigso-oculto')) return;
    // Nunca por debajo de un formulario abierto, de un reporte a medio llenar ni de una idea guardándose.
    if (sucio_ || (E() && E().ocupado()) || document.querySelector('.sx2-drawer, .sx2-dialogo, .hp2-celebra')) return;
    traer(vista_, arg_, true);
  }
  function irAItem(item) {
    var p = partes(item);
    if (!D) { traer(p.vista, p.arg); return; }
    confirmarSalir().then(function (ok) { if (ok) ir(p.vista, p.arg); });
  }
  function confirmarSalir() {
    // Las ideas se guardan solas: antes de salir se termina de guardar lo pendiente.
    if (E() && E().ocupado()) return E().guardarYa().then(function () { return true; });
    if (!sucio_) return Promise.resolve(true);
    return U.confirmar({ titulo: 'Tienes cambios sin guardar', texto: 'El reporte de salida tiene cambios que no se han guardado. ¿Salir de todas formas?', boton: 'Salir sin guardar', peligro: true })
      .then(function (si) { if (si) sucio_ = false; return si; });
  }
  function ir(v, arg, sinRuta) {
    vista_ = VISTAS[v] ? v : 'inicio'; arg_ = arg || '';
    if (vista_ === 'salida' && !evento(arg_)) { vista_ = 'salidas'; arg_ = ''; }
    if ((vista_ === 'estudio' || vista_ === 'idea') && !E()) { vista_ = 'inicio'; arg_ = ''; }
    if ((vista_ === 'marcas' || vista_ === 'marca' || vista_ === 'reportes') && !M()) { vista_ = 'inicio'; arg_ = ''; }
    if (vista_ === 'marca' && !(D.marcas || []).some(function (x) { return x.marca_id === arg_; })) { vista_ = 'marcas'; arg_ = ''; }
    if (vista_ === 'idea' && !(D.ideas || []).some(function (x) { return x.idea_id === arg_; })) { vista_ = 'estudio'; arg_ = ''; }
    sucio_ = false;
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(vista_ === 'salida' ? 'salidas' : vista_ === 'idea' ? 'estudio' : vista_ === 'marca' ? 'marcas' : vista_);
    if (vista_ === 'inicio') pintarInicio();
    else if (vista_ === 'calendario') pintarCalendario();
    else if (vista_ === 'salidas') pintarSalidas();
    else if (vista_ === 'tipos') pintarTipos();
    else if (vista_ === 'salida') pintarSalida(arg_);
    else if (vista_ === 'estudio') E().tablero();
    else if (vista_ === 'idea') E().taller(arg_);
    else if (vista_ === 'marcas') M().lista();
    else if (vista_ === 'marca') M().ficha(arg_);
    else if (vista_ === 'reportes') M().mensual();
    if (!sinRuta) window.scrollTo({ top: 0, behavior: sinMov() ? 'auto' : 'smooth' });
  }
  function pagina(html) {
    if (!raiz_) return;
    raiz_.innerHTML = '<div class="sx2 sx2-pagina hp2">' + html + '</div>';
    U.animar(raiz_);
  }
  function pintarBadge() {
    if (window.SigsoShell && SigsoShell.pintarBadge) { var n = pendientes().length; SigsoShell.pintarBadge('hompy', n, n ? 'ambar' : 'gris'); }
  }

  var ARQUITECTURA = [
    { id: 'inicio', nombre: 'Portada', icono: 'inicio', items: [{ id: 'inicio', nombre: 'Portada' }] },
    { id: 'calendario', nombre: 'Calendario', icono: 'calendario', items: [{ id: 'calendario', nombre: 'Calendario' }] },
    { id: 'estudio', nombre: 'Estudio TikTok', icono: 'camara', items: [{ id: 'estudio', nombre: 'Estudio TikTok' }] },
    { id: 'marcas', nombre: 'Marcas colaboradoras', icono: 'megafono', items: [{ id: 'marcas', nombre: 'Marcas colaboradoras' }] },
    { id: 'salidas', nombre: 'Salidas a terreno', icono: 'ubicacion', items: [{ id: 'salidas', nombre: 'Salidas a terreno' }] },
    { id: 'tipos', nombre: 'Tipos de evento', icono: 'ajustes', items: [{ id: 'tipos', nombre: 'Tipos de evento' }] },
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', plano: true, descripcion: 'El mes de Hompy, con PDF', items: [{ id: 'reportes', nombre: 'Reporte mensual' }] }
  ];
  function registrarArbol() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('hompy', { nombre: 'Hompy', submodulos: ARQUITECTURA });
  }

  function cabecera(titulo, sub, acciones) {
    return '<header class="sx2-cabecera sx2-entra hp2-cab"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">' +
      'Hompy</span>' +
      '<h1>' + txt(titulo) + '</h1>' + (sub ? '<p>' + txt(sub) + '</p>' : '') + '</div>' +
      '<div class="sx2-cabecera__acciones">' + (acciones || '') + '</div></header>';
  }
  function chipTipo(t, sm) {
    return '<span class="hp2-tipo hp2-color-' + txt(t.color) + (sm ? ' hp2-tipo--sm' : '') + '">' + U.ico(t.icono, sm ? 12 : 14) + txt(t.nombre) + '</span>';
  }
  function bloqueFecha(f) {
    var d = dia(f);
    return '<span class="hp2-fecha' + (f === D.hoy ? ' hp2-fecha--hoy' : '') + '"><b>' + d.getUTCDate() + '</b><span>' + MESES[d.getUTCMonth()].slice(0, 3) + '</span></span>';
  }

  // --- Hompy: la mascota que habla ----------------------------------------------------------
  function frasesDelDia() {
    var f = [], pend = pendientes(), prox = proximas();
    var hoyEv = prox.filter(function (e) { return e.fecha === D.hoy; });
    var manana = prox.filter(function (e) { return e.fecha === sumarDias(D.hoy, 1); });
    var semana = prox.filter(function (e) { return diasEntre(D.hoy, e.fecha) < 7; });
    if (hoyEv.length) f.push('¡Hoy salimos! ' + hoyEv[0].titulo + (hoyEv[0].hora_inicio ? ' a las ' + hoyEv[0].hora_inicio : '') + '. ¡Casco puesto!');
    if (pend.length) f.push(pend.length === 1 ? 'Tengo una salida sin reporte: «' + pend[0].titulo + '». ¿La anotamos?' : 'Tengo ' + pend.length + ' salidas sin reporte. ¿Las anotamos?');
    if (manana.length) f.push('Mañana tenemos «' + manana[0].titulo + '». ¿Está listo el traje?');
    if (semana.length > 1) f.push('Esta semana tenemos ' + semana.length + ' actividades. ¡Qué agenda!');
    if (!prox.length) f.push('Mi agenda está vacía… ¿salimos a alguna parte?');
    if (D.tipos.every(function (t) { return t.origen === 'PROPUESTA'; })) f.push('Mis tipos de evento son una propuesta: pónganles los nombres reales en «Tipos de evento».');
    f.push('Tómense pausas con el traje: ¡aquí adentro hace calor!');
    f.push('Seguridad primero: casco, chaleco… y una buena sonrisa.');
    if (E()) f = f.concat(E().frases());
    return f;
  }
  function decir(texto) {
    var el = raiz_ && raiz_.querySelector('.js-hp2-globo');
    if (!el) return;
    var vis = el.querySelector('.js-hp2-globo-txt'), sr = el.querySelector('.js-hp2-globo-sr');
    if (tipeo_) { clearInterval(tipeo_); tipeo_ = null; }
    sr.textContent = texto;
    el.classList.remove('hp2-globo--pop'); void el.offsetWidth; el.classList.add('hp2-globo--pop');
    if (sinMov()) { vis.textContent = texto; return; }
    var i = 0; vis.textContent = '';
    tipeo_ = setInterval(function () {
      i += 2; vis.textContent = texto.slice(0, i);
      if (i >= texto.length) { clearInterval(tipeo_); tipeo_ = null; }
    }, 22);
  }
  function chispas(cont) {
    if (sinMov() || !cont) return;
    for (var i = 0; i < 8; i++) {
      var s = document.createElement('span');
      s.className = 'hp2-chispa';
      var ang = (Math.PI * 2 * i) / 8 + Math.random() * 0.5, dist = 60 + Math.random() * 50;
      s.style.setProperty('--dx', Math.round(Math.cos(ang) * dist) + 'px');
      s.style.setProperty('--dy', Math.round(Math.sin(ang) * dist - 30) + 'px');
      s.style.setProperty('--h', (i % 3 === 0 ? 'var(--hp-azul)' : i % 3 === 1 ? 'var(--hp-naranja)' : '#ffd166'));
      cont.appendChild(s);
      setTimeout(function (x) { return function () { x.remove(); }; }(s), 800);
    }
  }
  function mascota(alto) {
    return '<div class="hp2-escena js-hp2-escena" style="--alto:' + (alto || 300) + 'px">' +
      '<div class="hp2-globo js-hp2-globo"><span class="js-hp2-globo-txt" aria-hidden="true"></span><span class="sigso-oculto-visual js-hp2-globo-sr" role="status" aria-live="polite"></span></div>' +
      '<button type="button" class="hp2-mascota js-hp2-mascota" aria-label="Hompy. Tócalo para que te cuente algo">' +
        '<span class="hp2-mascota__giro"><img src="' + IMG + '" alt="" width="559" height="900" decoding="async"></span>' +
      '</button>' +
      '<span class="hp2-sombra" aria-hidden="true"></span>' +
    '</div>';
  }
  function animarMascota() {
    var esc = raiz_.querySelector('.js-hp2-escena');
    if (!esc) return;
    frases_ = frasesDelDia(); fraseI_ = 0;
    setTimeout(function () { decir(frases_[0]); }, sinMov() ? 0 : 650);
    var btn = esc.querySelector('.js-hp2-mascota');
    btn.addEventListener('click', function () {
      fraseI_ = (fraseI_ + 1) % frases_.length;
      decir(frases_[fraseI_]);
      if (sinMov()) return;
      btn.classList.remove('hp2-salta'); void btn.offsetWidth; btn.classList.add('hp2-salta');
      chispas(esc);
    });
    // Mira hacia el cursor (un giro leve, sin bucle: solo cuando el mouse se mueve).
    if (sinMov() || !window.matchMedia('(hover: hover)').matches) return;
    var heroe = raiz_.querySelector('.hp2-heroe') || esc, pend = false, ex = 0, ey = 0;
    heroe.addEventListener('pointermove', function (ev) {
      ex = ev.clientX; ey = ev.clientY;
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

  // --- Portada ------------------------------------------------------------------------------
  function pintarInicio() {
    var pend = pendientes(), prox = proximas(), mes = D.hoy.slice(0, 7);
    var delMesAct = delMes(mes).filter(function (e) { return e.estado !== 'CANCELADO'; });
    var hechas = delMesAct.filter(function (e) { var k = estadoDe(e).clave; return k === 'cerrada' || k === 'borrador' || k === 'falta'; });
    var publico = D.salidas.filter(function (s) { var e = evento(s.evento_id); return e && e.fecha.slice(0, 7) === mes && s.datos.publico; })
      .reduce(function (a, s) { return a + Number(s.datos.publico || 0); }, 0);
    var nombre = miNombre();
    var resumen = prox.length
      ? 'Lo próximo: «' + prox[0].titulo + '», ' + cuando(prox[0].fecha).toLowerCase() + (prox[0].lugar ? ' en ' + prox[0].lugar : '') + '.'
      : 'No hay actividades por delante. Agenda la próxima salida de Hompy.';

    var heroe = '<section class="hp2-heroe sx2-entra">' +
      '<div class="hp2-heroe__fondo" aria-hidden="true"><span class="hp2-franja"></span><span class="hp2-franja hp2-franja--b"></span><span class="hp2-puntos"></span></div>' +
      '<div class="hp2-heroe__txt">' +
        '<span class="hp2-heroe__ceja">' + U.ico('estrella', 14) + 'La mascota de HomePymes</span>' +
        '<h1>¡Hola' + (nombre ? ', ' + txt(nombre) : '') + '!</h1>' +
        '<p>' + txt(resumen) + '</p>' +
        '<div class="hp2-heroe__acciones">' +
          U.boton({ texto: 'Nueva actividad', icono: 'nueva', variante: 'primario', clase: 'js-hp2-nuevo hp2-boton-hompy' }) +
          U.boton({ texto: 'Ver calendario', icono: 'calendario', clase: 'js-hp2-ir', datos: { ir: 'calendario' } }) +
          (pend.length ? U.boton({ texto: 'Llenar reportes (' + pend.length + ')', icono: 'portapapeles', variante: 'fantasma', clase: 'js-hp2-ir', datos: { ir: 'salidas' } }) : '') +
        '</div>' +
      '</div>' +
      '<div class="hp2-heroe__mascota">' + mascota(300) + '</div>' +
    '</section>';

    var kpis = '<div class="sx2-fila-kpis hp2-kpis">' +
      U.kpi({ etiqueta: 'Actividades este mes', valor: delMesAct.length, icono: 'calendario', i: 1 }) +
      U.kpi({ etiqueta: 'Salidas realizadas', valor: hechas.length, icono: 'ubicacion', i: 2, tono: 'ok' }) +
      U.kpi({ etiqueta: 'Público alcanzado', valor: publico, unidad: 'personas', icono: 'equipo', i: 3 }) +
      U.kpi({ etiqueta: 'Reportes por llenar', valor: pend.length, icono: 'portapapeles', i: 4, tono: pend.length ? 'alerta' : 'ok', filtro: pend.length ? 'pendientes' : '' }) +
    '</div>';

    var listaProx = prox.slice(0, 5).map(function (e, i) { return filaEvento(e, i); }).join('');
    var cardProx = U.card({ titulo: 'Próximas actividades', icono: 'calendario', i: 5, accion: { texto: 'Calendario', clase: 'js-hp2-ir', datos: { ir: 'calendario' } },
      cuerpo: listaProx ? '<ul class="hp2-lista">' + listaProx + '</ul>' : U.vacio({ icono: 'calendario', titulo: 'Sin actividades por delante', texto: 'Cuando agenden una salida aparecerá aquí.', accion: U.boton({ texto: 'Nueva actividad', icono: 'nueva', variante: 'primario', sm: true, clase: 'js-hp2-nuevo' }) }) });
    var listaPend = pend.slice(0, 5).map(function (e, i) { return filaEvento(e, i, true); }).join('');
    var cardPend = U.card({ titulo: 'Reportes por llenar', icono: 'portapapeles', i: 6, accion: pend.length ? { texto: 'Todas las salidas', clase: 'js-hp2-ir', datos: { ir: 'salidas' } } : null,
      cuerpo: listaPend ? '<ul class="hp2-lista">' + listaPend + '</ul>' : '<div class="hp2-todo-listo"><img src="assets/hompy/hompy-cara.webp" alt="" width="56" height="56"><p><b>¡Todo al día!</b> No hay reportes de salida pendientes.</p></div>' });

    var estudio = E() ? E().tarjetaPortada() : '';
    var pronto = M() ? M().tarjetaPortada() : '';

    pagina(heroe + kpis + '<div class="sx2-grid hp2-dos"><div class="sx2-col-7">' + cardProx + '</div><div class="sx2-col-5">' + cardPend + '</div></div>' + estudio + pronto);
    animarMascota();
  }
  function filaEvento(e, i, pendiente) {
    var t = tipo(e.tipo_id), est = estadoDe(e);
    return '<li class="hp2-fila sx2-entra" style="--i:' + (i || 0) + '">' +
      '<button type="button" class="hp2-fila__btn js-hp2-evento" data-id="' + txt(e.evento_id) + '">' + bloqueFecha(e.fecha) +
        '<span class="hp2-fila__txt"><b>' + txt(e.titulo) + '</b><span class="hp2-fila__meta">' + chipTipo(t, true) +
          // En «por llenar» el estado va en la misma línea: la tarjeta es angosta y lleva el botón.
          (pendiente ? U.badge(est.t, est.tono) + '<span>' + U.ico('reloj', 12) + txt(cuando(e.fecha)) + '</span>'
            : '<span>' + U.ico('reloj', 12) + txt(horario(e)) + '</span>' + (e.lugar ? '<span>' + U.ico('ubicacion', 12) + txt(e.lugar) + '</span>' : '')) +
        '</span></span>' +
        (pendiente ? '' : U.badge(est.t, est.tono)) + '</button>' +
      (pendiente ? U.boton({ texto: est.clave === 'borrador' ? 'Seguir' : 'Llenar', icono: 'editar', sm: true, variante: 'primario', clase: 'js-hp2-reporte hp2-boton-hompy', datos: { id: e.evento_id } }) : '') +
    '</li>';
  }

  // --- Calendario ---------------------------------------------------------------------------
  function pintarCalendario(dir) {
    var a = Number(mes_.slice(0, 4)), m = Number(mes_.slice(5, 7));
    var titulo = MESES[m - 1].charAt(0).toUpperCase() + MESES[m - 1].slice(1) + ' ' + a;
    var eventos = ordenar(delMes(mes_)).filter(function (e) { return !ocultos_[e.tipo_id]; });
    var leyenda = '<div class="hp2-leyenda" role="group" aria-label="Mostrar u ocultar tipos de evento">' + D.tipos.filter(function (t) { return t.activo || delMes(mes_).some(function (e) { return e.tipo_id === t.tipo_id; }); }).map(function (t) {
      var n = delMes(mes_).filter(function (e) { return e.tipo_id === t.tipo_id && e.estado !== 'CANCELADO'; }).length;
      return '<button type="button" class="hp2-leyenda__op hp2-color-' + txt(t.color) + ' js-hp2-filtro" data-id="' + txt(t.tipo_id) + '" aria-pressed="' + (ocultos_[t.tipo_id] ? 'false' : 'true') + '">' +
        '<span class="hp2-leyenda__punto"></span>' + txt(t.nombre) + '<span class="hp2-leyenda__n">' + n + '</span></button>';
    }).join('') + '</div>';

    var barra = '<div class="hp2-cal-barra sx2-entra">' +
      '<div class="hp2-cal-nav">' +
        U.boton({ soloIcono: true, icono: 'izquierda', titulo: 'Mes anterior', variante: 'fantasma', clase: 'js-hp2-mes', datos: { d: -1 } }) +
        '<h2 class="hp2-cal-titulo" aria-live="polite">' + txt(titulo) + '</h2>' +
        U.boton({ soloIcono: true, icono: 'derecha', titulo: 'Mes siguiente', variante: 'fantasma', clase: 'js-hp2-mes', datos: { d: 1 } }) +
        (mes_ !== D.hoy.slice(0, 7) ? U.boton({ texto: 'Hoy', sm: true, clase: 'js-hp2-mes', datos: { d: 0 } }) : '') +
      '</div>' +
      U.segmento([{ id: 'mes', texto: 'Mes', icono: 'calendario' }, { id: 'agenda', texto: 'Agenda', icono: 'lista' }], modoCal_, 'js-hp2-modo') +
    '</div>';

    var cuerpo = modoCal_ === 'agenda' ? agenda(eventos) : grilla(eventos);
    pagina(cabecera('Calendario', 'Las actividades de Hompy, mes a mes. Toca un día para agendar.',
      U.boton({ texto: 'Nueva actividad', icono: 'nueva', variante: 'primario', clase: 'js-hp2-nuevo hp2-boton-hompy' })) +
      U.card({ clase: 'hp2-cal-card', cuerpo: barra + leyenda + '<div class="hp2-cal-cuerpo' + (dir ? ' hp2-desliza-' + (dir > 0 ? 'izq' : 'der') : '') + '">' + cuerpo + '</div>' }));
  }
  function grilla(eventos) {
    var a = Number(mes_.slice(0, 4)), m = Number(mes_.slice(5, 7));
    var primero = new Date(Date.UTC(a, m - 1, 1, 12));
    var desfase = (primero.getUTCDay() + 6) % 7; // lunes = 0
    var inicio = sumarDias(iso(primero), -desfase);
    var porDia = {};
    eventos.forEach(function (e) { (porDia[e.fecha] = porDia[e.fecha] || []).push(e); });
    var semanas = Math.ceil((desfase + new Date(Date.UTC(a, m, 0)).getUTCDate()) / 7);
    var h = '<div class="hp2-cal" role="grid" aria-label="Calendario del mes"><div class="hp2-cal__dias" role="row">' +
      DIAS_CORTOS.map(function (d) { return '<span role="columnheader">' + d + '</span>'; }).join('') + '</div><div class="hp2-cal__grilla">';
    for (var i = 0; i < semanas * 7; i++) {
      var f = sumarDias(inicio, i), lista = porDia[f] || [];
      var fuera = f.slice(0, 7) !== mes_, finde = i % 7 >= 5;
      var visibles = lista.slice(0, 3), mas = lista.length - visibles.length;
      h += '<div class="hp2-dia' + (fuera ? ' hp2-dia--fuera' : '') + (finde ? ' hp2-dia--finde' : '') + (f === D.hoy ? ' hp2-dia--hoy' : '') + (f === diaSel_ ? ' hp2-dia--sel' : '') + '" role="gridcell" style="--i:' + (i % 7) + '">' +
        '<button type="button" class="hp2-dia__num js-hp2-dia" data-fecha="' + f + '" aria-label="' + txt(fechaLarga(f)) + (lista.length ? ', ' + lista.length + ' actividad' + (lista.length > 1 ? 'es' : '') : '') + '. Agendar">' +
          dia(f).getUTCDate() + '</button>' +
        '<div class="hp2-dia__eventos">' + visibles.map(function (e) {
          var t = tipo(e.tipo_id), est = estadoDe(e);
          return '<button type="button" class="hp2-pildora hp2-color-' + txt(t.color) + (est.clave === 'cancelada' ? ' hp2-pildora--cancelada' : '') + (est.clave === 'cerrada' ? ' hp2-pildora--lista' : '') + ' js-hp2-evento" data-id="' + txt(e.evento_id) + '" title="' + txt(e.titulo + ' · ' + t.nombre + ' · ' + est.t) + '">' +
            (e.hora_inicio ? '<span class="hp2-pildora__hora">' + txt(e.hora_inicio) + '</span>' : '') + '<span class="hp2-pildora__t">' + txt(e.titulo) + '</span>' +
            (est.tono === 'alerta' ? '<span class="hp2-pildora__alerta" aria-hidden="true"></span>' : '') + '</button>';
        }).join('') + (mas > 0 ? '<button type="button" class="hp2-dia__mas js-hp2-verdia" data-fecha="' + f + '">+' + mas + ' más</button>' : '') + '</div>' +
        '<div class="hp2-dia__puntos" aria-hidden="true">' + lista.slice(0, 4).map(function (e) { return '<i class="hp2-color-' + txt(tipo(e.tipo_id).color) + '"></i>'; }).join('') + '</div>' +
      '</div>';
    }
    h += '</div></div>';
    // En el celular la grilla queda en puntos: el día elegido se lista abajo.
    var sel = diaSel_ && diaSel_.slice(0, 7) === mes_ ? diaSel_ : (D.hoy.slice(0, 7) === mes_ ? D.hoy : '');
    var delDia = sel ? (porDia[sel] || []) : [];
    h += '<div class="hp2-cal__movil">' + (sel ? '<h3>' + txt(fechaLarga(sel)) + '</h3>' + (delDia.length ? '<ul class="hp2-lista">' + delDia.map(function (e, i) { return filaEvento(e, i); }).join('') + '</ul>'
      : '<p class="sx2-tenue">Sin actividades. ' + '<button type="button" class="sx2-enlace js-hp2-nuevo" data-fecha="' + sel + '">Agendar una</button></p>') : '<p class="sx2-tenue">Toca un día para ver sus actividades.</p>') + '</div>';
    return h;
  }
  function agenda(eventos) {
    if (!eventos.length) return U.vacio({ icono: 'calendario', titulo: 'Nada agendado este mes', texto: 'Agenda la próxima salida de Hompy.', accion: U.boton({ texto: 'Nueva actividad', icono: 'nueva', variante: 'primario', sm: true, clase: 'js-hp2-nuevo' }) });
    var grupos = [], ult = '';
    eventos.forEach(function (e) { if (e.fecha !== ult) { grupos.push({ f: e.fecha, l: [] }); ult = e.fecha; } grupos[grupos.length - 1].l.push(e); });
    return '<div class="hp2-agenda">' + grupos.map(function (g, gi) {
      return '<section class="hp2-agenda__dia sx2-entra' + (g.f === D.hoy ? ' hp2-agenda__dia--hoy' : '') + '" style="--i:' + gi + '"><h3>' + txt(fechaLarga(g.f)) + '<span>' + txt(cuando(g.f)) + '</span></h3>' +
        '<ul class="hp2-lista">' + g.l.map(function (e, i) { return filaEvento(e, i); }).join('') + '</ul></section>';
    }).join('') + '</div>';
  }
  function moverMes(d) {
    if (d === 0) { mes_ = D.hoy.slice(0, 7); diaSel_ = D.hoy; pintarCalendario(); return; }
    var a = Number(mes_.slice(0, 4)), m = Number(mes_.slice(5, 7)) - 1 + d;
    var n = new Date(Date.UTC(a, m, 1));
    mes_ = n.toISOString().slice(0, 7); diaSel_ = '';
    pintarCalendario(d);
  }

  // --- Detalle de una actividad -------------------------------------------------------------
  function abrirEvento(id) {
    var e = evento(id);
    if (!e) return;
    var t = tipo(e.tipo_id), est = estadoDe(e), s = salidaDe(id);
    var pasado = e.fecha <= D.hoy, cancelada = e.estado === 'CANCELADO';
    var datosEv = '<dl class="hp2-datos">' +
      '<div><dt>' + U.ico('calendario', 14) + 'Fecha</dt><dd>' + txt(fechaLarga(e.fecha)) + ' <span class="sx2-tenue">· ' + txt(cuando(e.fecha)) + '</span></dd></div>' +
      '<div><dt>' + U.ico('reloj', 14) + 'Horario</dt><dd>' + txt(horario(e)) + '</dd></div>' +
      '<div><dt>' + U.ico('ubicacion', 14) + 'Lugar</dt><dd>' + (e.lugar || e.direccion ? txt([e.lugar, e.direccion, e.comuna].filter(Boolean).join(' · ')) : '<span class="sx2-tenue">Sin lugar</span>') + '</dd></div>' +
      (e.marca_id && M() && M().marca(e.marca_id) ? '<div><dt>' + U.ico('megafono', 14) + 'Marca</dt><dd>' + M().chip(e.marca_id) + '</dd></div>' : '') +
      '<div><dt>' + U.ico('equipo', 14) + 'Van</dt><dd>' + (e.participantes.length ? '<span class="hp2-personas">' + e.participantes.map(function (p) { return '<span class="hp2-persona">' + U.avatar({ nombre: p }, 'xs') + txt(p) + '</span>'; }).join('') + '</span>' : '<span class="sx2-tenue">Sin definir</span>') + '</dd></div>' +
    '</dl>' +
    (e.descripcion ? '<div class="hp2-desc"><h3>Detalle</h3><p>' + txt(e.descripcion) + '</p></div>' : '') +
    (cancelada && e.motivo_cancelacion ? '<p class="hp2-nota hp2-nota--neutro">' + U.ico('info', 14) + 'Cancelada: ' + txt(e.motivo_cancelacion) + '</p>' : '');

    var bloqueSalida = '';
    if (!cancelada) {
      if (s && s.estado === 'CERRADO') {
        bloqueSalida = '<div class="hp2-salida-mini hp2-salida-mini--ok"><img src="assets/hompy/hompy-cara.webp" alt="" width="44" height="44"><div><b>Reporte de salida cerrado</b>' +
          '<p>' + estrellasTxt(s.datos.calificacion) + (s.datos.publico != null ? ' · ' + Number(s.datos.publico).toLocaleString('es-CL') + ' personas' : '') + (s.datos.traje ? ' · Traje: ' + txt(s.datos.traje) : '') + '</p></div></div>';
      } else if (pasado) {
        bloqueSalida = '<div class="hp2-salida-mini"><span class="hp2-salida-mini__ico">' + U.ico('portapapeles', 20) + '</span><div><b>' + (s ? 'El reporte quedó en borrador' : '¿Cómo les fue?') + '</b>' +
          '<p>' + (s ? 'Termínalo y ciérralo para que quede el registro.' : 'Llena el reporte de salida: horarios, quiénes fueron, el traje, el público y la evaluación.') + '</p></div></div>';
      } else {
        bloqueSalida = '<p class="hp2-nota">' + U.ico('info', 14) + 'El reporte de salida se llena el mismo día o después de la actividad.</p>';
      }
    }

    var acc = [];
    if (!cancelada && pasado) {
      if (s && s.estado === 'CERRADO') {
        acc.push(U.boton({ texto: 'Ver reporte', icono: 'ojo', variante: 'primario', clase: 'js-hp2-d-reporte' }));
        acc.push(U.boton({ texto: 'PDF', icono: 'descargar', clase: 'js-hp2-d-pdf' }));
      } else acc.push(U.boton({ texto: s ? 'Seguir el reporte' : 'Llenar reporte', icono: 'editar', variante: 'primario', clase: 'js-hp2-d-reporte hp2-boton-hompy' }));
    }
    if (!cancelada && !pasado && e.estado === 'PLANIFICADO') acc.push(U.boton({ texto: 'Confirmar', icono: 'check', variante: 'primario', clase: 'js-hp2-d-estado', datos: { estado: 'CONFIRMADO' } }));
    if (!cancelada && !pasado && e.estado === 'CONFIRMADO') acc.push(U.boton({ texto: 'Volver a planificada', icono: 'derivar', variante: 'fantasma', clase: 'js-hp2-d-estado', datos: { estado: 'PLANIFICADO' } }));
    if (e.idea_id && E()) acc.unshift(U.boton({ texto: 'Abrir en el Estudio', icono: 'camara', variante: 'fantasma', clase: 'js-hp2-d-idea' }));
    if (cancelada) acc.push(U.boton({ texto: 'Reactivar', icono: 'derivar', clase: 'js-hp2-d-estado', datos: { estado: 'PLANIFICADO' } }));
    var cerrada = s && s.estado === 'CERRADO';
    var menu = (cerrada ? '' : U.boton({ texto: 'Editar', icono: 'editar', variante: 'fantasma', clase: 'js-hp2-d-editar' })) +
      (!cancelada && !cerrada ? U.boton({ texto: 'Cancelar actividad', icono: 'equis', variante: 'fantasma', clase: 'js-hp2-d-cancelar' }) : '') +
      (!cerrada ? U.boton({ soloIcono: true, icono: 'basura', titulo: 'Eliminar', variante: 'fantasma', clase: 'js-hp2-d-eliminar' }) : '');

    var d = U.drawer({
      titulo: e.titulo,
      subtitulo: '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + chipTipo(t) + U.badge(est.t, est.tono) + '</span>',
      cuerpo: '<div class="hp2-detalle hp2-color-' + txt(t.color) + '"><div class="hp2-detalle__franja"></div>' + datosEv + bloqueSalida + '</div>',
      pie: menu + '<span style="flex:1"></span>' + acc.join('')
    });
    d.el.classList.add('hp2-drawer');
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('js-hp2-d-reporte')) { d.cerrar(true); ir('salida', id); }
      else if (b.classList.contains('js-hp2-d-idea')) { d.cerrar(true); ir('idea', e.idea_id); }
      else if (b.classList.contains('js-hp2-d-pdf')) descargarPdf(id, b);
      else if (b.classList.contains('js-hp2-d-editar')) { d.cerrar(true); formularioEvento(e); }
      else if (b.classList.contains('js-hp2-d-estado')) cambiarEstado(id, b.getAttribute('data-estado'), '', d);
      else if (b.classList.contains('js-hp2-d-cancelar')) { d.cerrar(true); formularioCancelar(e); }
      else if (b.classList.contains('js-hp2-d-eliminar')) {
        U.confirmar({ titulo: 'Eliminar «' + e.titulo + '»', texto: s ? 'Se elimina también su reporte en borrador. Si la actividad no se hizo, mejor cancélala: así queda el registro.' : 'Se quita del calendario. Si la actividad no se hizo, mejor cancélala: así queda el registro.', boton: 'Eliminar', peligro: true })
          .then(function (si) {
            if (!si) return;
            api('hompyEliminarEvento', { evento_id: id }).then(function (r) {
              if (!r.ok) { aviso(r.message || 'No se pudo eliminar.', 'error'); return; }
              d.cerrar(); aviso('Actividad eliminada.', 'exito'); traer(vista_, arg_, true);
            });
          });
      }
    });
  }
  function estrellasTxt(n) { n = Number(n) || 0; return '<span class="hp2-estrellas-mini" aria-label="' + n + ' de 5">' + '★★★★★'.slice(0, n) + '<i>' + '★★★★★'.slice(n) + '</i></span>'; }
  function cambiarEstado(id, estado, motivo, d) {
    return api('hompyCambiarEstadoEvento', { evento_id: id, estado: estado, motivo: motivo }).then(function (r) {
      if (!r.ok) { aviso(r.message || 'No se pudo cambiar.', 'error'); return r; }
      if (d) d.cerrar();
      aviso(estado === 'CONFIRMADO' ? '¡Confirmada! Hompy ya está listo.' : estado === 'CANCELADO' ? 'Actividad cancelada.' : 'Actividad actualizada.', 'exito');
      traer(vista_, arg_, true);
      return r;
    });
  }
  function formularioCancelar(e) {
    U.formulario({
      titulo: 'Cancelar «' + e.titulo + '»', boton: 'Cancelar actividad',
      campos: '<p class="hp2-nota">' + U.ico('info', 14) + 'Queda en el calendario tachada, con el motivo, para que no se pierda el registro.</p>' +
        U.campo('¿Por qué se canceló?', '<textarea class="sx2-input hp2-area" name="motivo" rows="3" maxlength="300" required placeholder="Ej.: el cliente la reagendó, lluvia, el traje estaba en reparación…"></textarea>'),
      enviar: function (datos) {
        if (!datos.motivo) return Promise.resolve({ ok: false, message: 'Cuenta brevemente por qué se canceló.' });
        return api('hompyCambiarEstadoEvento', { evento_id: e.evento_id, estado: 'CANCELADO', motivo: datos.motivo });
      },
      aviso: 'Actividad cancelada.', listo: function () { traer(vista_, arg_, true); }
    });
  }

  // --- Alta y edición de una actividad -------------------------------------------------------
  function datalistPersonas(extra) {
    var vistos = {}, l = [];
    (extra || []).concat(D.personas || []).forEach(function (p) { var k = String(p).toLowerCase(); if (p && !vistos[k]) { vistos[k] = 1; l.push(p); } });
    return '<datalist id="hp2-personas">' + l.map(function (p) { return '<option value="' + txt(p) + '"></option>'; }).join('') + '</datalist>';
  }
  function chipsInput(nombre, valores, placeholder, lista) {
    return '<div class="hp2-chips js-hp2-chips" data-name="' + txt(nombre) + '">' +
      (valores || []).map(chipHtml).join('') +
      '<input class="hp2-chips__input"' + (lista === false ? '' : ' list="' + (lista || 'hp2-personas') + '"') + ' placeholder="' + txt(placeholder || 'Escribe un nombre y presiona Enter') + '" aria-label="' + txt(placeholder || 'Agregar persona') + '">' +
      '<input type="hidden" name="' + txt(nombre) + '" value="' + txt((valores || []).join('\n')) + '"></div>';
  }
  function chipHtml(v) { return '<span class="hp2-chip" data-v="' + txt(v) + '">' + txt(v) + '<button type="button" class="hp2-chip__x" aria-label="Quitar ' + txt(v) + '">' + U.ico('equis', 11) + '</button></span>'; }
  function enlazarChips(cont, alCambiar) {
    cont.querySelectorAll('.js-hp2-chips').forEach(function (box) {
      var input = box.querySelector('.hp2-chips__input'), oculto = box.querySelector('input[type=hidden]');
      function valores() { return Array.prototype.map.call(box.querySelectorAll('.hp2-chip'), function (c) { return c.getAttribute('data-v'); }); }
      function sync() { oculto.value = valores().join('\n'); if (alCambiar) alCambiar(); }
      function agregar(v) {
        v = String(v || '').replace(/[,;]+$/, '').trim();
        if (!v) return;
        if (valores().some(function (x) { return x.toLowerCase() === v.toLowerCase(); })) { input.value = ''; return; }
        input.insertAdjacentHTML('beforebegin', chipHtml(v));
        input.value = ''; sync();
      }
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ',' || ev.key === ';') { ev.preventDefault(); agregar(input.value); }
        else if (ev.key === 'Backspace' && !input.value) { var u = box.querySelectorAll('.hp2-chip'); if (u.length) { u[u.length - 1].remove(); sync(); } }
      });
      // Elegir del datalist dispara "input" con el valor completo.
      input.addEventListener('input', function (ev) { if (ev.inputType === 'insertReplacementText' || ev.inputType === undefined) agregar(input.value); });
      input.addEventListener('blur', function () { agregar(input.value); });
      box.addEventListener('click', function (ev) {
        var x = ev.target.closest('.hp2-chip__x');
        if (x) { x.parentNode.remove(); sync(); input.focus(); } else if (ev.target === box) input.focus();
      });
    });
  }
  function selectorTipos(actual) {
    return '<div class="hp2-tipos-sel" role="radiogroup" aria-label="Tipo de evento">' + tiposActivos().map(function (t) {
      return '<label class="hp2-tipo-op hp2-color-' + txt(t.color) + '"><input type="radio" name="tipo_id" value="' + txt(t.tipo_id) + '"' + (t.tipo_id === actual ? ' checked' : '') + ' required>' +
        '<span class="hp2-tipo-op__ico">' + U.ico(t.icono, 18) + '</span><span class="hp2-tipo-op__t">' + txt(t.nombre) + '</span></label>';
    }).join('') + '</div>';
  }
  function formularioEvento(e, fecha) {
    e = e || {};
    var nuevo = !e.evento_id;
    var tipoIni = e.tipo_id || (tiposActivos()[0] || {}).tipo_id;
    var campos = datalistPersonas(e.participantes) +
      U.campo('Tipo de evento', selectorTipos(tipoIni)) +
      U.campo('¿Qué actividad es?', '<input class="sx2-input" name="titulo" maxlength="120" required value="' + txt(e.titulo || '') + '" placeholder="Ej.: Feria de seguridad en Mall Plaza">') +
      (M() && (D.marcas || []).length ? U.campo('Marca (opcional)', M().selector('marca_id', e.marca_id || ''), 'Si la actividad es con una marca colaboradora, como BCI.') : '') +
      '<div class="hp2-form-fila hp2-form-fila--3">' +
        U.campo('Fecha', '<input class="sx2-input" type="date" name="fecha" required value="' + txt(e.fecha || fecha || D.hoy) + '">') +
        U.campo('Desde', '<input class="sx2-input" type="time" name="hora_inicio" value="' + txt(e.hora_inicio || '') + '">') +
        U.campo('Hasta', '<input class="sx2-input" type="time" name="hora_fin" value="' + txt(e.hora_fin || '') + '">') +
      '</div>' +
      U.campo('Lugar', '<input class="sx2-input" name="lugar" maxlength="120" value="' + txt(e.lugar || '') + '" placeholder="Ej.: Mall Plaza Oeste, patio central">') +
      '<div class="hp2-form-fila">' +
        U.campo('Dirección', '<input class="sx2-input" name="direccion" maxlength="160" value="' + txt(e.direccion || '') + '">') +
        U.campo('Comuna', '<input class="sx2-input" name="comuna" maxlength="60" value="' + txt(e.comuna || '') + '">') +
      '</div>' +
      U.campo('¿Quiénes van?', chipsInput('participantes', e.participantes, 'Escribe un nombre y presiona Enter'), 'Incluye a quien usará el traje, el apoyo y quien maneja.') +
      U.campo('Detalle (opcional)', '<textarea class="sx2-input hp2-area" name="descripcion" rows="3" maxlength="1500" placeholder="Qué se hará, con quién se coordinó, qué llevar…">' + txt(e.descripcion || '') + '</textarea>');
    U.formulario({
      titulo: nuevo ? 'Nueva actividad de Hompy' : 'Editar actividad', boton: nuevo ? 'Agendar' : 'Guardar', ancho: true,
      campos: campos,
      alMontar: function (form, d) { d.el.classList.add('hp2-drawer'); enlazarChips(form); },
      enviar: function (datos, form) {
        var sel = form.querySelector('input[name=tipo_id]:checked');
        datos.tipo_id = sel ? sel.value : '';
        datos.participantes = (datos.participantes || '').split('\n').filter(Boolean);
        if (e.evento_id) datos.evento_id = e.evento_id;
        return api('hompyGuardarEvento', datos);
      },
      aviso: nuevo ? '¡Agendado! Hompy ya lo anotó.' : 'Actividad actualizada.',
      listo: function (r) {
        var ev = r.data && r.data.evento;
        if (ev && nuevo) { mes_ = ev.fecha.slice(0, 7); diaSel_ = ev.fecha; }
        traer(vista_, arg_, true);
      }
    });
  }

  // --- Salidas a terreno (lista) ------------------------------------------------------------
  function pintarSalidas() {
    var pend = pendientes();
    var cerradas = ordenar(D.eventos.filter(function (e) { return estadoDe(e).clave === 'cerrada'; })).reverse();
    var lista = filtroSalidas_ === 'cerradas' ? cerradas : pend;
    var filas = lista.map(function (e, i) {
      var t = tipo(e.tipo_id), s = salidaDe(e.evento_id), est = estadoDe(e);
      var dd = (s && s.datos) || {};
      return '<tr class="sx2-entra" style="--i:' + i + '">' +
        '<td>' + bloqueFecha(e.fecha) + '</td>' +
        '<td><button type="button" class="hp2-enlace-ev js-hp2-evento" data-id="' + txt(e.evento_id) + '"><b>' + txt(e.titulo) + '</b></button><div class="hp2-fila__meta">' + chipTipo(t, true) + (e.lugar ? '<span>' + U.ico('ubicacion', 12) + txt(e.lugar) + '</span>' : '') + '</div></td>' +
        (filtroSalidas_ === 'cerradas'
          ? '<td class="hp2-num">' + (dd.publico != null ? Number(dd.publico).toLocaleString('es-CL') : '—') + '</td><td>' + estrellasTxt(dd.calificacion) + '</td><td>' + txt(dd.traje || '—') + '</td>' +
            '<td class="hp2-acc">' + U.boton({ texto: 'Ver', icono: 'ojo', sm: true, clase: 'js-hp2-reporte', datos: { id: e.evento_id } }) + U.boton({ soloIcono: true, icono: 'descargar', titulo: 'Descargar PDF', sm: true, variante: 'fantasma', clase: 'js-hp2-pdf', datos: { id: e.evento_id } }) + '</td>'
          : '<td>' + U.badge(est.t, est.tono) + '</td><td class="sx2-tenue">' + txt(cuando(e.fecha)) + '</td>' +
            '<td class="hp2-acc">' + U.boton({ texto: est.clave === 'borrador' ? 'Seguir' : 'Llenar reporte', icono: 'editar', sm: true, variante: 'primario', clase: 'js-hp2-reporte hp2-boton-hompy', datos: { id: e.evento_id } }) +
              (est.clave === 'sehizo' ? U.boton({ texto: 'No se hizo', sm: true, variante: 'fantasma', clase: 'js-hp2-nosehizo', datos: { id: e.evento_id } }) : '') + '</td>') +
      '</tr>';
    }).join('');
    var cab = filtroSalidas_ === 'cerradas'
      ? '<tr><th>Fecha</th><th>Actividad</th><th class="hp2-num">Público</th><th>Evaluación</th><th>Traje</th><th></th></tr>'
      : '<tr><th>Fecha</th><th>Actividad</th><th>Estado</th><th>Cuándo</th><th></th></tr>';
    var cuerpo = lista.length
      ? '<div class="hp2-tabla-cont"><table class="hp2-tabla"><thead>' + cab + '</thead><tbody>' + filas + '</tbody></table></div>'
      : (filtroSalidas_ === 'cerradas'
        ? U.vacio({ icono: 'portapapeles', titulo: 'Todavía no hay reportes cerrados', texto: 'Cuando cierren el primer reporte de salida aparecerá aquí, con su PDF.' })
        : '<div class="hp2-todo-listo hp2-todo-listo--grande"><img src="assets/hompy/hompy-cara.webp" alt="" width="84" height="84"><p><b>¡Todo al día!</b> No hay salidas esperando su reporte.</p></div>');
    pagina(cabecera('Salidas a terreno', 'Cada actividad realizada lleva su reporte: lugar, horarios, quiénes fueron, el traje, el público y cómo les fue.') +
      U.card({ cuerpo: '<div class="hp2-salidas-barra">' + U.segmento([{ id: 'pendientes', texto: 'Por llenar (' + pend.length + ')', icono: 'portapapeles' }, { id: 'cerradas', texto: 'Cerradas (' + cerradas.length + ')', icono: 'check' }], filtroSalidas_, 'js-hp2-filtro-sal') + '</div>' + cuerpo }));
  }

  // --- El reporte de salida a terreno ---------------------------------------------------------
  function pintarSalida(id) {
    var e = evento(id), s = salidaDe(id);
    if (!e) { ir('salidas'); return; }
    if (s && s.estado === 'CERRADO') { pintarSalidaLectura(e, s); return; }
    var t = tipo(e.tipo_id), d = (s && s.datos) || {};
    var personasEv = e.participantes || [];
    var hora = function (n, et, v) { return U.campo(et, '<input class="sx2-input" type="time" name="' + n + '" value="' + txt(v || '') + '">'); };
    var num = function (n, et, v, extra) { return U.campo(et, '<input class="sx2-input" type="number" inputmode="numeric" min="0" step="1" name="' + n + '" value="' + (v == null ? '' : txt(v)) + '"' + (extra || '') + '>'); };
    var texto = function (n, et, v, ph, filas) { return U.campo(et, '<textarea class="sx2-input hp2-area" name="' + n + '" rows="' + (filas || 3) + '" maxlength="1500" placeholder="' + txt(ph || '') + '">' + txt(v || '') + '</textarea>'); };
    var interruptor = function (n, et, on) { return '<label class="hp2-switch"><input type="checkbox" name="' + n + '"' + (on ? ' checked' : '') + '><span class="hp2-switch__pista"><span></span></span>' + txt(et) + '</label>'; };
    var seccion = function (n, ico, titulo, sub, cuerpo, opcional) {
      return '<section class="hp2-sec sx2-card sx2-entra" style="--i:' + n + '"><header class="hp2-sec__cab"><span class="hp2-sec__n">' + U.ico(ico, 18) + '</span><div><h2>' + txt(titulo) +
        (opcional ? ' <span class="hp2-opcional">opcional</span>' : '') + '</h2>' + (sub ? '<p>' + txt(sub) + '</p>' : '') + '</div></header>' + cuerpo + '</section>';
    };
    var reqs = '<span class="hp2-req" title="Necesario para cerrar">*</span>';

    var s1 = seccion(1, 'reloj', 'Lugar y horarios', 'Desde que salieron de la oficina hasta que volvieron.',
      '<div class="hp2-horas">' + hora('hora_salida', 'Salida oficina', d.hora_salida) + hora('hora_llegada', 'Llegada', d.hora_llegada) +
        U.campo('Inicio *', '<input class="sx2-input" type="time" name="hora_inicio" value="' + txt(d.hora_inicio || e.hora_inicio || '') + '">') +
        U.campo('Término *', '<input class="sx2-input" type="time" name="hora_fin" value="' + txt(d.hora_fin || e.hora_fin || '') + '">') + hora('hora_regreso', 'Regreso', d.hora_regreso) + '</div>' +
      '<p class="hp2-duracion js-hp2-duracion" aria-live="polite"></p>' +
      U.campo('Lugar exacto', '<input class="sx2-input" name="lugar_real" maxlength="160" value="' + txt(d.lugar_real || [e.lugar, e.comuna].filter(Boolean).join(', ')) + '" placeholder="Si cambió respecto de lo agendado, anótalo">'));

    var s2 = seccion(2, 'equipo', 'Quiénes fueron', '',
      U.campo('¿Quién usó el traje de Hompy? *', '<input class="sx2-input" name="traje" list="hp2-personas" maxlength="60" value="' + txt(d.traje || '') + '" placeholder="Nombre de quien estuvo dentro del traje">') +
      U.campo('Apoyo', chipsInput('apoyo', d.apoyo || personasEv.filter(function (p) { return p !== d.traje; }), 'Quién acompañó: Enter para agregar'), 'Quien guía al traje, saca fotos o atiende al público.') +
      '<div class="hp2-form-fila hp2-form-fila--3">' +
        U.campo('Conductor', '<input class="sx2-input" name="conductor" list="hp2-personas" maxlength="60" value="' + txt(d.conductor || '') + '">') +
        U.campo('Contacto en el lugar', '<input class="sx2-input" name="contacto_lugar" maxlength="80" value="' + txt(d.contacto_lugar || '') + '" placeholder="Quién los recibió">') +
        U.campo('Teléfono del contacto', '<input class="sx2-input" type="tel" name="contacto_telefono" maxlength="30" value="' + txt(d.contacto_telefono || '') + '">') +
      '</div>');

    var s3 = seccion(3, 'casco', 'Hompy y el traje', 'El traje es caluroso: registrar el tiempo y las pausas cuida a quien lo usa.',
      '<div class="hp2-form-fila hp2-form-fila--3">' + num('minutos_traje', 'Minutos dentro del traje', d.minutos_traje, ' max="720"') + num('pausas', 'Pausas que tomó', d.pausas, ' max="50"') +
        '<div class="hp2-switch-cont">' + interruptor('hidratacion', 'Se hidrató durante la actividad', d.hidratacion) + '</div></div>' +
      '<p class="hp2-nota hp2-nota--alerta js-hp2-calor" hidden>' + U.ico('alerta', 14) + 'Más de 40 minutos en el traje sin pausas: es mucho calor. Consideren pausas la próxima vez.</p>' +
      '<fieldset class="hp2-traje"><legend>¿Cómo quedó el traje? *</legend>' + ['BUENO', 'LIMPIEZA', 'REPARACION'].map(function (k) {
        return '<label class="hp2-traje__op sx2-tono-' + TRAJE[k].tono + '"><input type="radio" name="estado_traje" value="' + k + '"' + (d.estado_traje === k ? ' checked' : '') + '>' +
          '<span class="hp2-traje__ico">' + U.ico(TRAJE[k].ico, 18) + '</span><span>' + txt(TRAJE[k].t) + '</span></label>';
      }).join('') + '</fieldset>' +
      texto('nota_traje', 'Detalle del traje', d.nota_traje, 'Ej.: se soltó una costura del guante derecho, quedó con barro…', 2));

    var s4 = seccion(4, 'camara', 'Público, material y contenido', '',
      '<div class="hp2-form-fila hp2-form-fila--3">' + num('publico', 'Público estimado *', d.publico) + num('fotos', 'Fotos tomadas', d.fotos) + num('videos', 'Videos grabados', d.videos) + '</div>' +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">Material que llevaron</span><div class="hp2-material">' + D.catalogos.material.map(function (m) {
        var on = (d.material || (s ? [] : ['Traje de Hompy'])).indexOf(m) !== -1;
        return '<label class="hp2-toggle"><input type="checkbox" name="material" value="' + txt(m) + '"' + (on ? ' checked' : '') + '><span>' + U.ico('check', 12) + txt(m) + '</span></label>';
      }).join('') + '</div></div>' +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">¿Volvió todo completo?</span><div class="hp2-sino">' +
        '<label><input type="radio" name="material_completo" value="si"' + (d.material_completo === true ? ' checked' : '') + '><span>Sí, todo</span></label>' +
        '<label><input type="radio" name="material_completo" value="no"' + (d.material_completo === false ? ' checked' : '') + '><span>No, faltó algo</span></label></div></div>' +
      texto('nota_material', 'Sobre el material', d.nota_material, 'Qué faltó o qué se entregó (regalos, volantes…)', 2) +
      '<div class="hp2-form-fila">' +
        U.campo('Carpeta con las fotos', '<input class="sx2-input" type="url" name="enlace_fotos" maxlength="500" value="' + txt(d.enlace_fotos || '') + '" placeholder="https://drive.google.com/…">', 'Enlace a Drive o Google Fotos.') +
        '<div class="hp2-switch-cont">' + interruptor('tiktok', 'Se grabó material para TikTok', d.tiktok) + '</div>' +
      '</div>');

    var s5 = seccion(5, 'estrella', 'Cómo nos fue', '',
      '<fieldset class="hp2-estrellas js-hp2-estrellas"><legend>Califica la salida *</legend><div class="hp2-estrellas__fila">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<label class="hp2-estrella"><input type="radio" name="calificacion" value="' + n + '"' + (Number(d.calificacion) === n ? ' checked' : '') + '><span aria-hidden="true">★</span><span class="sigso-oculto-visual">' + n + ' de 5</span></label>';
      }).join('') + '<span class="hp2-estrellas__txt js-hp2-estrellas-txt"></span></div></fieldset>' +
      '<div class="hp2-form-fila">' + texto('bien', 'Lo que salió bien', d.bien, 'Lo que conviene repetir') + texto('mejorar', 'Qué mejorar', d.mejorar, 'Lo que cambiarían la próxima vez') + '</div>' +
      texto('incidentes', 'Incidentes', d.incidentes, 'Golpes, mareos, problemas con el público o el lugar… (vacío si no hubo)', 2));

    var s6 = '<details class="hp2-sec hp2-sec--plegable sx2-card sx2-entra" style="--i:6"' + (d.gasto_transporte || d.gasto_estacionamiento || d.gasto_colacion || d.gasto_otros ? ' open' : '') + '>' +
      '<summary class="hp2-sec__cab"><span class="hp2-sec__n">' + U.ico('dinero', 18) + '</span><div><h2>Gastos <span class="hp2-opcional">opcional</span></h2><p>Transporte, estacionamiento, colación.</p></div><span class="hp2-sec__total js-hp2-total"></span>' + U.ico('abajo', 16) + '</summary>' +
      '<div class="hp2-form-fila hp2-form-fila--4">' + num('gasto_transporte', 'Transporte ($)', d.gasto_transporte) + num('gasto_estacionamiento', 'Estacionamiento ($)', d.gasto_estacionamiento) +
        num('gasto_colacion', 'Colación ($)', d.gasto_colacion) + num('gasto_otros', 'Otros ($)', d.gasto_otros) + '</div></details>';

    var s7 = seccion(7, 'comentario', 'Comentarios', '', texto('comentarios', 'Algo más que quieran dejar registrado', d.comentarios, '', 3));

    var lado = '<aside class="hp2-salida-lado">' +
      '<div class="hp2-progreso sx2-card"><div class="hp2-progreso__anillo js-hp2-anillo"></div><div><b class="js-hp2-progreso-txt"></b><p class="js-hp2-faltan"></p></div></div>' +
      '<div class="hp2-lado-mascota"><img src="assets/hompy/hompy-cara.webp" alt="" width="64" height="64"><p class="js-hp2-tip">Los campos con * son los necesarios para cerrar. Lo demás suma, pero se puede guardar en borrador y seguir después.</p></div>' +
    '</aside>';

    var info = '<div class="hp2-salida-ev sx2-entra hp2-color-' + txt(t.color) + '">' + bloqueFecha(e.fecha) + '<div><b>' + txt(e.titulo) + '</b><span class="hp2-fila__meta">' + chipTipo(t, true) +
      (e.lugar ? '<span>' + U.ico('ubicacion', 12) + txt(e.lugar) + '</span>' : '') + '<span>' + U.ico('reloj', 12) + txt(horario(e)) + '</span></span></div>' +
      (s ? U.badge('Borrador guardado', 'alerta') : '') + '</div>';

    pagina(cabecera('Reporte de salida a terreno', '', U.boton({ texto: 'Volver', icono: 'izquierda', variante: 'fantasma', clase: 'js-hp2-ir', datos: { ir: 'salidas' } })) + info +
      '<div class="hp2-salida">' + '<form class="hp2-salida-form js-hp2-salida" novalidate>' + datalistPersonas(personasEv) + s1 + s2 + s3 + s4 + s5 + s6 + s7 +
        '<p class="hp2-error js-hp2-error" role="alert" hidden></p>' +
        '<div class="hp2-salida-pie"><span class="hp2-salida-pie__estado js-hp2-sucio"></span><span style="flex:1"></span>' +
          U.boton({ texto: 'Guardar borrador', icono: 'documento', clase: 'js-hp2-guardar' }) +
          U.boton({ texto: 'Cerrar reporte', icono: 'check', variante: 'primario', clase: 'js-hp2-cerrar hp2-boton-hompy' }) + '</div>' +
      '</form>' + lado + '</div>');

    var form = raiz_.querySelector('.js-hp2-salida');
    enlazarChips(form, marcarSucio);
    form.addEventListener('input', marcarSucio);
    form.addEventListener('change', marcarSucio);
    actualizarResumenSalida(form);
    sucio_ = false;
    form.querySelector('.js-hp2-sucio').textContent = s ? 'Borrador guardado ' + horaDe(s.fecha_actualizacion) : 'Sin guardar todavía';

    function marcarSucio() {
      sucio_ = true;
      form.querySelector('.js-hp2-sucio').textContent = 'Cambios sin guardar';
      actualizarResumenSalida(form);
    }
    form.addEventListener('submit', function (ev) { ev.preventDefault(); });
    form.querySelector('.js-hp2-guardar').addEventListener('click', function (ev) { guardarSalida(form, e, false, ev.currentTarget); });
    form.querySelector('.js-hp2-cerrar').addEventListener('click', function (ev) { guardarSalida(form, e, true, ev.currentTarget); });
  }
  function horaDe(isoTxt) {
    if (!isoTxt) return '';
    return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(isoTxt));
  }
  function leerSalida(form) {
    var d = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') {
        if (el.name === 'material') { d.material = d.material || []; if (el.checked) d.material.push(el.value); }
        else d[el.name] = el.checked;
      } else if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; else if (!(el.name in d)) d[el.name] = ''; }
      else d[el.name] = String(el.value || '').trim();
    });
    d.apoyo = (d.apoyo || '').split('\n').filter(Boolean);
    d.material_completo = d.material_completo === 'si' ? true : d.material_completo === 'no' ? false : undefined;
    ['minutos_traje', 'pausas', 'publico', 'fotos', 'videos', 'calificacion', 'gasto_transporte', 'gasto_estacionamiento', 'gasto_colacion', 'gasto_otros'].forEach(function (k) {
      d[k] = d[k] === '' || d[k] == null ? null : Number(d[k]);
    });
    return d;
  }
  // Mismas reglas que faltantesParaCerrar_ del servidor (que es quien manda).
  var REQUISITOS = [
    ['hora_inicio', 'Hora de inicio', function (d) { return !!d.hora_inicio; }],
    ['hora_fin', 'Hora de término', function (d) { return !!d.hora_fin && (!d.hora_inicio || d.hora_fin > d.hora_inicio); }],
    ['traje', 'Quién usó el traje', function (d) { return !!d.traje; }],
    ['estado_traje', 'Estado del traje', function (d) { return !!d.estado_traje; }],
    ['publico', 'Público estimado', function (d) { return d.publico != null && d.publico >= 0; }],
    ['calificacion', 'Calificación', function (d) { return !!d.calificacion; }]
  ];
  function minutos(h) { if (!h) return null; var p = h.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
  function actualizarResumenSalida(form) {
    var d = leerSalida(form);
    var ok = REQUISITOS.filter(function (r) { return r[2](d); });
    var faltan = REQUISITOS.filter(function (r) { return !r[2](d); });
    var pct = Math.round(ok.length / REQUISITOS.length * 100);
    var anillo = raiz_.querySelector('.js-hp2-anillo');
    if (anillo) {
      anillo.style.setProperty('--pct', pct);
      anillo.innerHTML = '<span>' + (pct === 100 ? U.ico('check', 18) : pct + '%') + '</span>';
      anillo.classList.toggle('hp2-progreso__anillo--listo', pct === 100);
    }
    var pt = raiz_.querySelector('.js-hp2-progreso-txt'), pf = raiz_.querySelector('.js-hp2-faltan');
    if (pt) pt.textContent = pct === 100 ? '¡Listo para cerrar!' : ok.length + ' de ' + REQUISITOS.length + ' datos necesarios';
    if (pf) pf.textContent = faltan.length ? 'Falta: ' + faltan.map(function (r) { return r[1].toLowerCase(); }).join(', ') + '.' : 'Revisa y presiona «Cerrar reporte».';
    REQUISITOS.forEach(function (r) {
      var el = form.querySelector('[name="' + r[0] + '"]');
      var campo = el && (el.closest('.sx2-campo') || el.closest('fieldset'));
      if (campo) campo.classList.toggle('hp2-campo--listo', r[2](d));
    });
    var dur = form.querySelector('.js-hp2-duracion'), m = minutos(d.hora_fin) - minutos(d.hora_inicio);
    if (dur) dur.innerHTML = d.hora_inicio && d.hora_fin && m > 0 ? U.ico('reloj', 13) + 'La actividad duró ' + (m >= 60 ? Math.floor(m / 60) + ' h ' : '') + (m % 60 ? m % 60 + ' min' : '') : '';
    var calor = form.querySelector('.js-hp2-calor');
    if (calor) calor.hidden = !(d.minutos_traje > 40 && !d.pausas);
    var et = form.querySelector('.js-hp2-estrellas-txt');
    if (et) et.textContent = ['', 'Mal', 'Regular', 'Bien', 'Muy bien', '¡Excelente!'][d.calificacion || 0] || '';
    var total = ['gasto_transporte', 'gasto_estacionamiento', 'gasto_colacion', 'gasto_otros'].reduce(function (a, k) { return a + (Number(d[k]) || 0); }, 0);
    var tt = form.querySelector('.js-hp2-total');
    if (tt) tt.textContent = total ? '$' + total.toLocaleString('es-CL') : '';
  }
  function guardarSalida(form, e, cerrar, boton) {
    var err = form.querySelector('.js-hp2-error');
    err.hidden = true;
    form.querySelectorAll('.hp2-campo--falta').forEach(function (c) { c.classList.remove('hp2-campo--falta'); });
    var datos = leerSalida(form);
    var textoBtn = boton.innerHTML;
    boton.disabled = true; boton.innerHTML = cerrar ? 'Cerrando…' : 'Guardando…';
    api('hompyGuardarSalida', { evento_id: e.evento_id, datos: datos, cerrar: cerrar }).then(function (r) {
      boton.disabled = false; boton.innerHTML = textoBtn;
      if (!r || !r.ok) {
        err.textContent = (r && r.message) || 'No se pudo guardar.'; err.hidden = false;
        (r && r.fields || []).forEach(function (f) {
          var el = form.querySelector('[name="' + f.campo + '"]');
          var c = el && (el.closest('.sx2-campo') || el.closest('fieldset'));
          if (c) c.classList.add('hp2-campo--falta');
        });
        var primero = form.querySelector('.hp2-campo--falta') || err;
        primero.scrollIntoView({ block: 'center', behavior: sinMov() ? 'auto' : 'smooth' });
        return;
      }
      sucio_ = false;
      // Actualiza lo local sin volver a pedir todo.
      var s = r.data.salida, ev = r.data.evento;
      D.salidas = D.salidas.filter(function (x) { return x.evento_id !== s.evento_id; }).concat([s]);
      D.eventos = D.eventos.map(function (x) { return x.evento_id === ev.evento_id ? ev : x; });
      pintarBadge();
      if (cerrar) { celebrar({ titulo: '¡Reporte cerrado!', texto: '«' + e.titulo + '» quedó registrada. ¡Buen trabajo, equipo!', pdf: e.evento_id }); pintarSalidaLectura(ev, s); }
      else { form.querySelector('.js-hp2-sucio').textContent = 'Borrador guardado ' + horaDe(s.fecha_actualizacion); aviso('Borrador guardado.', 'exito'); }
    });
  }

  function pintarSalidaLectura(e, s) {
    var t = tipo(e.tipo_id), d = s.datos || {};
    var nada = '<span class="sx2-tenue">—</span>';
    var v = function (x) { return x === null || x === undefined || x === '' ? nada : txt(x); };
    var dato = function (et, val) { return '<div><dt>' + txt(et) + '</dt><dd>' + val + '</dd></div>'; };
    var m = minutos(d.hora_fin) - minutos(d.hora_inicio);
    var gastos = ['gasto_transporte', 'gasto_estacionamiento', 'gasto_colacion', 'gasto_otros'].reduce(function (a, k) { return a + (Number(d[k]) || 0); }, 0);
    var tr = TRAJE[d.estado_traje];
    var parrafo = function (et, x) { return x ? '<div class="hp2-desc"><h3>' + txt(et) + '</h3><p>' + txt(x) + '</p></div>' : ''; };

    var portada = '<section class="hp2-lectura-portada sx2-entra hp2-color-' + txt(t.color) + '">' +
      '<img class="hp2-lectura-portada__hompy" src="' + IMG + '" alt="" width="559" height="900">' +
      '<div class="hp2-lectura-portada__txt">' + chipTipo(t) + '<h2>' + txt(e.titulo) + '</h2><p>' + txt(fechaLarga(e.fecha)) + (e.lugar ? ' · ' + txt(e.lugar) : '') + '</p>' +
        '<div class="hp2-lectura-portada__nota">' + estrellasTxt(d.calificacion) + '</div></div>' +
      '<div class="hp2-lectura-cifras">' +
        '<div><span>Duración</span><b>' + (m > 0 ? (m >= 60 ? Math.floor(m / 60) + ' h ' : '') + (m % 60 ? m % 60 + ' min' : '') : '—') + '</b></div>' +
        '<div><span>Público</span><b>' + (d.publico != null ? Number(d.publico).toLocaleString('es-CL') : '—') + '</b></div>' +
        '<div><span>Fotos / videos</span><b>' + (d.fotos || 0) + ' / ' + (d.videos || 0) + '</b></div>' +
        '<div><span>En el traje</span><b>' + (d.minutos_traje != null ? d.minutos_traje + ' min' : '—') + '</b></div>' +
      '</div></section>';

    var grilla = '<div class="sx2-grid hp2-lectura">' +
      '<div class="sx2-col-6">' + U.card({ titulo: 'Lugar y horarios', icono: 'reloj', i: 1, cuerpo: '<dl class="hp2-datos hp2-datos--2">' +
        dato('Lugar', v(d.lugar_real || e.lugar)) + dato('Salida de la oficina', v(d.hora_salida)) + dato('Llegada', v(d.hora_llegada)) + dato('Inicio', v(d.hora_inicio)) + dato('Término', v(d.hora_fin)) + dato('Regreso', v(d.hora_regreso)) + '</dl>' }) + '</div>' +
      '<div class="sx2-col-6">' + U.card({ titulo: 'Quiénes fueron', icono: 'equipo', i: 2, cuerpo: '<dl class="hp2-datos hp2-datos--2">' +
        dato('Usó el traje', v(d.traje)) + dato('Conductor', v(d.conductor)) + dato('Apoyo', v((d.apoyo || []).join(', '))) + dato('Contacto en el lugar', v([d.contacto_lugar, d.contacto_telefono].filter(Boolean).join(' · '))) + '</dl>' }) + '</div>' +
      '<div class="sx2-col-6">' + U.card({ titulo: 'Hompy y el traje', icono: 'casco', i: 3, cuerpo: '<dl class="hp2-datos hp2-datos--2">' +
        dato('Minutos en el traje', v(d.minutos_traje)) + dato('Pausas', v(d.pausas)) + dato('Hidratación', d.hidratacion ? 'Sí' : 'No registrada') +
        dato('Estado del traje', tr ? U.badge(tr.t, tr.tono) : nada) + '</dl>' + parrafo('Detalle del traje', d.nota_traje) }) + '</div>' +
      '<div class="sx2-col-6">' + U.card({ titulo: 'Material y contenido', icono: 'camara', i: 4, cuerpo: '<dl class="hp2-datos hp2-datos--2">' +
        dato('Material', v((d.material || []).join(', '))) + dato('¿Volvió completo?', d.material_completo === true ? 'Sí' : d.material_completo === false ? 'No' : nada) +
        dato('TikTok', d.tiktok ? 'Se grabó material' : 'No') + dato('Fotos', d.enlace_fotos ? '<a href="' + txt(d.enlace_fotos) + '" target="_blank" rel="noopener">Abrir carpeta</a>' : nada) + '</dl>' + parrafo('Sobre el material', d.nota_material) }) + '</div>' +
      '<div class="sx2-col-12">' + U.card({ titulo: 'Cómo nos fue', icono: 'estrella', i: 5, cuerpo:
        '<div class="hp2-form-fila">' + (parrafo('Lo que salió bien', d.bien) || '') + (parrafo('Qué mejorar', d.mejorar) || '') + '</div>' + parrafo('Incidentes', d.incidentes) + parrafo('Comentarios', d.comentarios) +
        (gastos ? '<p class="hp2-nota">' + U.ico('dinero', 14) + 'Gastos de la salida: <b>$' + gastos.toLocaleString('es-CL') + '</b></p>' : '') +
        (!d.bien && !d.mejorar && !d.incidentes && !d.comentarios ? '<p class="sx2-tenue">Sin comentarios registrados.</p>' : '') }) + '</div>' +
    '</div>';

    var firma = '<p class="hp2-firma sx2-tenue">' + U.ico('check', 14) + 'Cerrado por ' + txt(nombreDe(s.cerrado_por)) + ' · ' + txt(horaDe(s.fecha_cierre)) + '</p>';
    pagina(cabecera('Reporte de salida a terreno', '',
      U.boton({ texto: 'Volver', icono: 'izquierda', variante: 'fantasma', clase: 'js-hp2-ir', datos: { ir: 'salidas' } }) +
      U.boton({ texto: 'Reabrir', icono: 'editar', clase: 'js-hp2-reabrir', datos: { id: e.evento_id } }) +
      U.boton({ texto: 'Descargar PDF', icono: 'descargar', variante: 'primario', clase: 'js-hp2-pdf hp2-boton-hompy', datos: { id: e.evento_id } })) + portada + grilla + firma);
  }

  function descargarPdf(id, boton) {
    var txtBtn = boton ? boton.innerHTML : '';
    if (boton) { boton.disabled = true; boton.setAttribute('aria-busy', 'true'); }
    return api('hompyPdfSalida', { evento_id: id }).then(function (r) {
      if (boton) { boton.disabled = false; boton.removeAttribute('aria-busy'); boton.innerHTML = txtBtn; }
      if (r && r.ok && r.data && r.data.pdf_base64) descargarBase64(r.data.pdf_base64, r.data.filename || 'Salida-Hompy.pdf', 'application/pdf');
      else aviso((r && r.message) || 'No se pudo generar el PDF.', 'error');
    });
  }

  // Al cerrar un reporte o publicar un video: Hompy celebra (confeti con los colores de su ropa).
  // o: { titulo, texto, pdf (evento_id, opcional) }.
  function celebrar(o) {
    var el = document.createElement('div');
    el.className = 'sx2 hp2-celebra';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', o.titulo);
    var confeti = '';
    if (!sinMov()) for (var i = 0; i < 42; i++) {
      confeti += '<i style="--x:' + Math.round(Math.random() * 100) + ';--r:' + Math.round(Math.random() * 360) + 'deg;--d:' + (0.9 + Math.random() * 1.1).toFixed(2) + 's;--w:' + (i * 0.025).toFixed(2) + 's;--c:' +
        ['var(--hp-naranja)', 'var(--hp-azul)', '#ffffff', '#ffd166', '#c9d2dd'][i % 5] + '"></i>';
    }
    el.innerHTML = '<div class="hp2-celebra__telon"></div><div class="hp2-celebra__confeti" aria-hidden="true">' + confeti + '</div>' +
      '<div class="hp2-celebra__caja"><img src="' + IMG + '" alt="" width="559" height="900"><h2>' + txt(o.titulo) + '</h2>' +
      '<p>' + txt(o.texto) + '</p>' +
      '<div class="hp2-celebra__acc">' + (o.pdf ? U.boton({ texto: 'Descargar PDF', icono: 'descargar', clase: 'js-hp2-cel-pdf' }) : '') + U.boton({ texto: 'Listo', icono: 'check', variante: 'primario', clase: 'js-hp2-cel-ok hp2-boton-hompy' }) + '</div></div>';
    document.body.appendChild(el);
    var previo = document.activeElement;
    function cerrar() { document.removeEventListener('keydown', tecla, true); el.classList.add('hp2-celebra--sale'); setTimeout(function () { el.remove(); }, sinMov() ? 0 : 220); if (previo && previo.focus) try { previo.focus(); } catch (x) { /* */ } }
    function tecla(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); cerrar(); } }
    document.addEventListener('keydown', tecla, true);
    el.addEventListener('click', function (ev) {
      if (ev.target.closest('.js-hp2-cel-pdf')) descargarPdf(o.pdf, ev.target.closest('button'));
      else if (ev.target.closest('.js-hp2-cel-ok') || ev.target.classList.contains('hp2-celebra__telon')) cerrar();
    });
    el.querySelector('.js-hp2-cel-ok').focus();
  }

  // --- Tipos de evento ----------------------------------------------------------------------
  function pintarTipos() {
    var propuesta = D.tipos.every(function (t) { return t.origen === 'PROPUESTA'; });
    var tarjetas = D.tipos.map(function (t, i) {
      var usos = D.eventos.filter(function (e) { return e.tipo_id === t.tipo_id; }).length;
      return '<article class="hp2-tipo-card sx2-entra hp2-color-' + txt(t.color) + (t.activo ? '' : ' hp2-tipo-card--apagado') + '" style="--i:' + i + '">' +
        '<span class="hp2-tipo-card__ico">' + U.ico(t.icono, 24) + '</span>' +
        '<div class="hp2-tipo-card__txt"><b>' + txt(t.nombre) + '</b><span>' + usos + ' actividad' + (usos === 1 ? '' : 'es') + (t.activo ? '' : ' · apagado') + (t.origen === 'PROPUESTA' ? ' · propuesta' : '') + '</span></div>' +
        U.boton({ texto: 'Editar', icono: 'editar', sm: true, variante: 'fantasma', clase: 'js-hp2-tipo', datos: { id: t.tipo_id } }) + '</article>';
    }).join('');
    pagina(cabecera('Tipos de evento', 'Cada actividad del calendario es de uno de estos tipos, con su color y su ícono.',
      D.tipos.length < D.catalogos.max_tipos ? U.boton({ texto: 'Agregar tipo', icono: 'nueva', clase: 'js-hp2-tipo' }) : '') +
      (propuesta ? '<div class="hp2-aviso-propuesta sx2-entra"><img src="assets/hompy/hompy-cara.webp" alt="" width="52" height="52"><div><b>Estos 5 tipos son una propuesta</b>' +
        '<p>Cuando definan sus 5 tipos de evento, cámbienles el nombre aquí (y el color o el ícono si quieren). Lo que ya esté agendado se actualiza solo.</p></div></div>' : '') +
      '<div class="hp2-tipos-grilla">' + tarjetas + '</div>');
  }
  function formularioTipo(t) {
    t = t || { color: D.catalogos.colores.find(function (c) { return !D.tipos.some(function (x) { return x.color === c; }); }) || 'gris', icono: 'calendario', activo: true };
    var campos = U.campo('Nombre', '<input class="sx2-input" name="nombre" maxlength="50" required value="' + txt(t.nombre || '') + '" placeholder="Ej.: Feria de seguridad">') +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">Color</span><div class="hp2-colores" role="radiogroup" aria-label="Color">' + D.catalogos.colores.map(function (c) {
        return '<label class="hp2-color-op hp2-color-' + c + '" title="' + NOMBRES_COLOR[c] + '"><input type="radio" name="color" value="' + c + '"' + (t.color === c ? ' checked' : '') + '><span></span><span class="sigso-oculto-visual">' + NOMBRES_COLOR[c] + '</span></label>';
      }).join('') + '</div></div>' +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">Ícono</span><div class="hp2-iconos" role="radiogroup" aria-label="Ícono">' + D.catalogos.iconos.map(function (ic) {
        return '<label class="hp2-icono-op"><input type="radio" name="icono" value="' + ic + '"' + (t.icono === ic ? ' checked' : '') + '><span>' + U.ico(ic, 20) + '</span></label>';
      }).join('') + '</div></div>' +
      (t.tipo_id ? '<label class="hp2-switch"><input type="checkbox" name="activo"' + (t.activo ? ' checked' : '') + '><span class="hp2-switch__pista"><span></span></span>Activo (se puede elegir al agendar)</label>' : '');
    U.formulario({
      titulo: t.tipo_id ? 'Editar tipo de evento' : 'Nuevo tipo de evento', boton: 'Guardar', campos: campos,
      alMontar: function (form, d) { d.el.classList.add('hp2-drawer'); },
      enviar: function (datos, form) {
        datos.color = (form.querySelector('input[name=color]:checked') || {}).value;
        datos.icono = (form.querySelector('input[name=icono]:checked') || {}).value;
        if (t.tipo_id) { datos.tipo_id = t.tipo_id; datos.activo = !!form.querySelector('input[name=activo]:checked'); }
        return api('hompyGuardarTipo', datos);
      },
      aviso: 'Tipo de evento guardado.', listo: function () { traer('tipos', '', true); }
    });
  }

  // --- Eventos de la página -----------------------------------------------------------------
  document.addEventListener('click', function (ev) {
    if (!raiz_ || !raiz_.contains(ev.target)) return;
    var b = ev.target.closest('button, [data-filtro]');
    if (!b) return;
    var id = b.getAttribute('data-id');
    if (b.classList.contains('js-hp2-ir')) irAItem(b.getAttribute('data-ir'));
    else if (b.classList.contains('js-hp2-reintentar')) traer(vista_, arg_);
    else if (b.classList.contains('js-hp2-nuevo')) formularioEvento(null, b.getAttribute('data-fecha') || (vista_ === 'calendario' && diaSel_ >= D.hoy ? diaSel_ : ''));
    else if (b.classList.contains('js-hp2-evento')) abrirEvento(id);
    else if (b.classList.contains('js-hp2-reporte')) ir('salida', id);
    else if (b.classList.contains('js-hp2-pdf')) descargarPdf(id, b);
    else if (b.classList.contains('js-hp2-reabrir')) {
      U.confirmar({ titulo: 'Reabrir el reporte', texto: 'Vuelve a quedar en borrador para corregirlo. Recuerden cerrarlo de nuevo.', boton: 'Reabrir' }).then(function (si) {
        if (!si) return;
        api('hompyReabrirSalida', { evento_id: id }).then(function (r) {
          if (!r.ok) { aviso(r.message || 'No se pudo reabrir.', 'error'); return; }
          D.salidas = D.salidas.filter(function (x) { return x.evento_id !== id; }).concat([r.data.salida]);
          pintarBadge(); ir('salida', id);
        });
      });
    }
    else if (b.classList.contains('js-hp2-nosehizo')) { var e = evento(id); if (e) formularioCancelar(e); }
    else if (b.classList.contains('js-hp2-mes')) moverMes(Number(b.getAttribute('data-d')));
    else if (b.classList.contains('js-hp2-modo')) { modoCal_ = b.getAttribute('data-id'); pintarCalendario(); }
    else if (b.classList.contains('js-hp2-filtro')) { ocultos_[id] = !ocultos_[id]; pintarCalendario(); }
    else if (b.classList.contains('js-hp2-filtro-sal')) { filtroSalidas_ = b.getAttribute('data-id'); pintarSalidas(); }
    else if (b.classList.contains('js-hp2-tipo')) formularioTipo(id ? tipo(id) : null);
    else if (b.classList.contains('js-hp2-verdia')) { diaSel_ = b.getAttribute('data-fecha'); modoCal_ = 'agenda'; pintarCalendario(); }
    else if (b.classList.contains('js-hp2-dia')) {
      var f = b.getAttribute('data-fecha');
      // En el celular, tocar un día lo muestra abajo; en escritorio, agenda en ese día.
      if (window.matchMedia('(max-width: 720px)').matches) { diaSel_ = f; if (f.slice(0, 7) !== mes_) mes_ = f.slice(0, 7); pintarCalendario(); }
      else formularioEvento(null, f);
    }
    else if (b.getAttribute('data-filtro') === 'pendientes') irAItem('salidas');
  });
  window.addEventListener('beforeunload', function (ev) { if (sucio_) { ev.preventDefault(); ev.returnValue = ''; } });

  window.SigsoHompy = {
    cargar: cargar, refrescar: refrescar, irAItem: irAItem,
    // Lo que comparte con el Estudio TikTok (hompy-estudio-v2.js).
    _interno: {
      datos: function () { return D; }, raiz: function () { return raiz_; }, api: api, aviso: aviso, txt: txt, sinMov: sinMov,
      pagina: pagina, cabecera: cabecera, ir: ir, irAItem: irAItem, traer: function (v, a) { return traer(v, a, true); },
      chipsInput: chipsInput, enlazarChips: enlazarChips, chispas: chispas, celebrar: celebrar, abrirEvento: abrirEvento,
      fechaLarga: fechaLarga, fechaCorta: fechaCorta, cuando: cuando, nombreDe: nombreDe, horaDe: horaDe, tipo: tipo, IMG: IMG,
      descargarBase64: descargarBase64
    }
  };
  registrarArbol();
})();
