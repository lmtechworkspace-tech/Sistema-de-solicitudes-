/**
 * control-interno-v2.js — módulo "Control interno": las matrices de
 * Contabilidad y RR.HH. del Drive dentro de SIGSO, como ESPEJO del Excel
 * (versión 2026-10-01, pedido del dueño: "toda la información, lo más
 * parecido al Excel").
 *
 * Vistas (el árbol del sidebar las elige):
 *  - inicio        Resumen del mes por departamento y sección.
 *  - m:CLAVE       La matriz como planilla: mismas columnas, nombres y orden
 *                  que el Excel (encabezado de dos niveles donde la planilla
 *                  lo tiene), una fila por fila de la planilla y en su orden.
 *                  Se edita en la celda (clic, Enter baja, Tab avanza, Esc
 *                  cancela). La "Situación" la calcula el servidor con las
 *                  columnas: no se escribe.
 *  - rep:*         Reportes (control-interno-reportes-v2.js).
 *  - conv[:id]     Seguimiento de convenios TGR (control-interno-convenios-v2.js).
 *  - sii           Recibir F29 y Registro de Compras y Ventas (control-interno-sii-v2.js).
 *  - recibir       Destino del marcador "Enviar a SIGSO": va a conv:tgr o a sii.
 *  - accesos       (ADM) quién registra o solo mira cada departamento.
 *
 * Mensuales (Contabilidad): un mes a la vez, como una hoja por mes.
 * Registro (RR.HH.): un año a la vez (filtro de mes opcional), en el orden de
 * la planilla. Listas: la foto completa.
 *
 * El backend decide los permisos y la situación; aquí solo se pinta.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var LOTE_FILAS = 200;

  var cfg_ = null, vista_ = 'inicio', periodo_ = '', anio_ = '', mesFiltro_ = '', lista_ = null, turno_ = 0;
  var sel_ = {}, f_ = { q: '', estado: '', resp: '', liberar: false, nuevos: false }, mostrar_ = LOTE_FILAS, verSinUso_ = false;

  // --- utilidades ----------------------------------------------------------------------
  function api(accion, datos) {
    return llamarApi((window.SIGSO_CONFIG || {}).BACKOFFICE_URL, accion, datos || {}).then(function (r) {
      if (r && r.ok && r.data && r.data.ok === false) return { ok: false, message: r.data.message || 'No se pudo guardar.', data: r.data };
      return r;
    }).catch(function (e) { return { ok: false, message: (e && e.message) || 'No se pudo conectar.' }; });
  }
  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function nombre(email) { return email ? PY.persona(email).nombre : '—'; }
  function titulo(t) { return String(t || '').toLowerCase().replace(/(^|[\s(])([a-záéíóúñ])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function miles(n) { if (n === '' || n === null || n === undefined || !isFinite(Number(n))) return String(n == null ? '' : n); return Number(n).toLocaleString('es-CL', { maximumFractionDigits: 2 }); }
  function fechaCorta(v) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v == null ? '' : v); }
  function periodoActual() { var h = PY.hoyClave(); return h.slice(0, 4) + '-M' + h.slice(5, 7); }
  function mover(per, n) {
    var m = /^(\d{4})-M(\d{2})$/.exec(per || ''); if (!m) return per;
    var t = Number(m[1]) * 12 + Number(m[2]) - 1 + n;
    return Math.floor(t / 12) + '-M' + ('0' + (t % 12 + 1)).slice(-2);
  }
  function perTexto(per, largo) { var m = /^(\d{4})-M(\d{2})$/.exec(per || ''); return m ? (largo ? MESES_LARGO : MESES)[+m[2] - 1] + (largo ? ' de ' : ' ') + m[1] : String(per || ''); }
  function matriz(clave) { return cfg_ ? cfg_.matrices.filter(function (m) { return m.clave === clave; })[0] : null; }
  function depto(clave) { return cfg_ ? cfg_.departamentos.filter(function (d) { return d.clave === clave; })[0] : null; }
  function estadoDe(m, clave) { return m.estados.filter(function (e) { return e.clave === clave; })[0] || { clave: clave, etiqueta: clave, tono: 'neutro' }; }
  function liberable(m, r) { var e = estadoDe(m, r.estado); return !m.sinLiberacion && !!e.final && !r.liberado_por; }
  function colRol(m, rol) { return m.columnas.filter(function (c) { return c.rol === rol; })[0] || null; }
  // `extra` puede traer su propio class="…": entonces no se pone el de por defecto.
  function select(nombre_, ops, v, extra) {
    extra = extra || '';
    return '<select ' + (/\bclass="/.test(extra) ? '' : 'class="sx2-select" ') + (nombre_ ? 'name="' + nombre_ + '" ' : '') + extra + '>' + ops.map(function (o) {
      return '<option value="' + U.esc(o[0]) + '"' + (String(o[0]) === String(v == null ? '' : v) ? ' selected' : '') + '>' + U.esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function resolverPersonas(lista) {
    if (!window.SigsoDirectorio || !SigsoDirectorio.resolver) return Promise.resolve();
    var correos = [];
    (lista || []).forEach(function (r) { [r.responsable_email, r.liberado_por, r.email, r.usuario_email].forEach(function (e) { if (e && /@/.test(e)) correos.push(e); }); });
    return SigsoDirectorio.resolver(correos).catch(function () { /* sin nombres: se ve el correo */ });
  }
  /** Quién realizó la fila: el nombre de la cuenta si calzó; si no, lo que dice la planilla. */
  function quien(m, r) {
    var c = colRol(m, 'responsable');
    var t = c ? (r.datos || {})[c.clave] : '';
    if (r.responsable_email) return nombre(r.responsable_email);
    return t ? titulo(t) : '—';
  }
  function claveQuien(m, r) {
    if (r.responsable_email) return r.responsable_email;
    var c = colRol(m, 'responsable'), t = c ? String((r.datos || {})[c.clave] || '').trim() : '';
    return t ? 'txt:' + t.toUpperCase() : '';
  }

  // --- marco ------------------------------------------------------------------------------
  function raiz() {
    var s = document.getElementById('modulo-control_interno');
    if (!s) return null;
    var c = document.getElementById('ci2');
    if (!c) { c = document.createElement('div'); c.id = 'ci2'; c.className = 'sx2 ci2'; s.appendChild(c); }
    return c;
  }
  function pagina(html, silencioso) {
    var c = raiz();
    if (!c) return;
    var y = window.scrollY;
    var g = c.querySelector('.ci2-grilla'), sl = g ? g.scrollLeft : 0, st = g ? g.scrollTop : 0;
    c.innerHTML = '<div class="sx2-pagina sx2-pagina--ancha">' + html + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
      var g2 = c.querySelector('.ci2-grilla');
      if (g2) { g2.scrollLeft = sl; g2.scrollTop = st; }
    }
    U.animar(c);
  }
  function cabecera(migas, tituloTxt, sub, acciones) {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">' + U.esc(migas) + '</span><h1>' + U.esc(tituloTxt) + '</h1>' +
      (sub ? '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc(sub) + '</span>' : '') + '</div><div class="sx2-cabecera__acciones">' + (acciones || '') + '</div></header>';
  }
  function selectorPeriodo() {
    return '<span class="ci2-periodo" role="group" aria-label="Mes">' +
      U.boton({ soloIcono: true, icono: 'izquierda', variante: 'fantasma', sm: true, titulo: 'Mes anterior', clase: 'js-ci2-per', datos: { n: -1 } }) +
      '<strong>' + U.esc(perTexto(periodo_)) + '</strong>' +
      U.boton({ soloIcono: true, icono: 'derecha', variante: 'fantasma', sm: true, titulo: 'Mes siguiente', clase: 'js-ci2-per', datos: { n: 1 } }) + '</span>';
  }
  function aviso(tono, icono, html) { return '<div class="mj2-aviso sx2-tono-' + tono + ' sx2-entra">' + U.ico(icono, 16) + '<span>' + html + '</span></div>'; }
  function error(r) {
    pagina(cabecera('Control interno', 'No se pudo cargar', '') + U.card({ i: 1, cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-ci2-recargar' }) }) }));
  }

  // --- árbol del sidebar ----------------------------------------------------------------
  // Contabilidad y RR.HH. en sus secciones, en el orden de las planillas.
  function secciones(d) {
    var out = [];
    cfg_.matrices.filter(function (m) { return m.depto === d.clave && !m.sinUso; }).forEach(function (m) {
      var s = out.filter(function (x) { return x.nombre === m.seccion; })[0];
      if (!s) { s = { nombre: m.seccion, matrices: [] }; out.push(s); }
      s.matrices.push(m);
    });
    return out;
  }
  function arbol() {
    var subs = [{ id: 'inicio', nombre: 'Resumen del mes', icono: 'panel', plano: true, items: [{ id: 'inicio', nombre: 'Resumen del mes' }] }];
    subs.push({ id: 'reportes', nombre: 'Reportes', icono: 'grafico', items: [
      { id: 'rep:informe', nombre: 'Informe mensual' }, { id: 'rep:panel', nombre: 'Panel histórico' },
      { id: 'rep:cliente', nombre: 'Ficha por cliente' }, { id: 'rep:personas', nombre: 'Personas y tiempos' }
    ] });
    (cfg_ ? cfg_.departamentos : []).forEach(function (d) {
      secciones(d).forEach(function (s, k) {
        subs.push({ id: 'd-' + d.clave + '-' + k, nombre: s.nombre, descripcion: d.nombre, icono: d.clave === 'RRHH' ? 'equipo' : 'dinero',
          items: s.matrices.map(function (m) { return { id: 'm:' + m.clave, nombre: m.nombre }; })
            .concat(s.matrices.some(function (m) { return m.clave === 'CONVENIOS'; }) ? [{ id: 'conv', nombre: 'Seguimiento de cuotas TGR' }] : [])
            .concat(s.matrices.some(function (m) { return m.clave === 'IVA'; }) ? [{ id: 'sii', nombre: 'Recibir desde el SII' }] : []) });
      });
      // Hojas que ya no se usan (reunión con Francisca): quedan para consulta, al final.
      var sinUso = cfg_.matrices.filter(function (m) { return m.depto === d.clave && m.sinUso; });
      if (sinUso.length) subs.push({ id: 'd-' + d.clave + '-sinuso', nombre: 'Hojas que ya no se usan', descripcion: d.nombre, icono: 'carpeta',
        items: sinUso.map(function (m) { return { id: 'm:' + m.clave, nombre: m.nombre }; }) });
    });
    if (cfg_ && cfg_.puede_administrar) subs.push({ id: 'accesos', nombre: 'Accesos', icono: 'llave', plano: true, items: [{ id: 'accesos', nombre: 'Accesos' }] });
    return subs;
  }
  function registrarArbol() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('control_interno', { nombre: 'Control interno', submodulos: arbol() });
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
  }

  // --- "Enviar a SIGSO" (TGR y SII, piloto asistido en el navegador, 2026-10-01) ----------
  // La persona entra a la TGR o al SII con su sesión y toca el marcador: el
  // marcador lee el texto de la página (o lo seleccionado) y lo manda a una
  // pestaña de SIGSO con postMessage. SIGSO no guarda claves ni se conecta a
  // esos sitios, y solo acepta mensajes de sus dominios (https).
  var envio_ = null;
  function fuenteDe(origen, texto) {
    var h = '';
    try { h = new URL(origen).hostname; } catch (e) { return ''; }
    if (/^https:/.test(origen) && /(^|\.)(tgr\.cl|tesoreria\.cl|tgr\.gob\.cl)$/.test(h)) return 'tgr';
    if (/^https:/.test(origen) && /(^|\.)sii\.cl$/.test(h)) return 'sii';
    // Para probar en local (páginas de prueba servidas junto a SIGSO).
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^(localhost|127\.0\.0\.1)$/.test(h)) return /tesorer[ií]a|cuotas de convenios/i.test(texto) ? 'tgr' : 'sii';
    return '';
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.tipo !== 'sigso-envio' || typeof d.texto !== 'string') return;
    var fuente = fuenteDe(e.origin, d.texto);
    if (!fuente) return;
    try { e.source.postMessage('sigso-envio-recibido', e.origin); } catch (er) { /* la pestaña de origen se cerró */ }
    // El marcador reintenta hasta que SIGSO contesta: el mismo envío llega varias veces.
    if (envio_ && envio_.texto === d.texto && Date.now() - envio_.t < 5000) return;
    envio_ = { texto: d.texto.slice(0, 3000000), pagina: String(d.pagina || '').slice(0, 80), fuente: fuente, t: Date.now() };
    var destino = fuente === 'tgr' ? 'conv:tgr' : 'sii';
    if (!/^#\/control_interno(\/|$)/.test(location.hash)) location.hash = '#/control_interno/' + encodeURIComponent(destino);
    else irAItem(destino);
  });
  /** El marcador (bookmarklet) que se arrastra a la barra de marcadores; lleva la dirección de este SIGSO. */
  function marcador() {
    var destino = location.origin + location.pathname + '#/control_interno/recibir';
    var codigo = '(function(){var D=' + JSON.stringify(destino) + ',O=' + JSON.stringify(location.origin) + ';' +
      'var t=String(window.getSelection?window.getSelection():"");' +
      'if(t.length<40){t=document.body?document.body.innerText:"";for(var i=0;i<window.frames.length;i++){try{t+="\\n"+window.frames[i].document.body.innerText;}catch(e){}}}' +
      'var w=window.open(D,"sigso_envio");if(!w){alert("SIGSO: permite las ventanas emergentes de este sitio.");return;}' +
      'var n=0,iv=setInterval(function(){n++;try{w.postMessage({tipo:"sigso-envio",texto:t,pagina:location.hostname},O);}catch(e){}if(n>60)clearInterval(iv);},500);' +
      'window.addEventListener("message",function(e){if(e.origin===O&&e.data==="sigso-envio-recibido")clearInterval(iv);});})();';
    return 'javascript:' + encodeURIComponent(codigo);
  }
  function vistaEsperando() {
    pagina(cabecera('Control interno', 'Enviar a SIGSO', 'Esperando lo que envía la página de la TGR o del SII…') +
      U.card({ cuerpo: U.vacio({ icono: 'reloj', titulo: 'Esperando el envío', texto: 'Deja esta pestaña abierta. Si no llega en unos segundos, vuelve a tocar el marcador en la otra pestaña.' }) }));
  }

  // --- carga y navegación -----------------------------------------------------------------
  function cargar() {
    var pedido = (window.SigsoShell && SigsoShell.tomarItemDeRuta && SigsoShell.tomarItemDeRuta()) || '';
    if (!periodo_) periodo_ = periodoActual();
    if (!cfg_) pagina(cabecera('Control interno', 'Control interno', 'Cargando…') + U.esqueleto('tarjetas', 6));
    return api('getControlInterno', { periodo: periodo_ }).then(function (r) {
      if (!r || !r.ok) { error(r); return; }
      cfg_ = r.data;
      registrarArbol();
      irAItem(pedido || vista_ || 'inicio');
      var libs = [];
      cfg_.departamentos.forEach(function (d) { (d.liberadores || []).forEach(function (e) { libs.push({ email: e }); }); });
      resolverPersonas(libs).then(function () { if (vista_ === 'inicio') vistaInicio(true); });
    });
  }
  function irAItem(id) {
    vista_ = id || 'inicio';
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(vista_);
    mostrar();
  }
  function mostrar() {
    if (!cfg_) { cargar(); return; }
    var p = String(vista_).split(':');
    if (p[0] === 'm' && matriz(p[1])) { sel_ = {}; f_ = { q: '', estado: '', resp: '', liberar: false, nuevos: false }; mostrar_ = LOTE_FILAS; verSinUso_ = false; abrirMatriz(p[1]); return; }
    if (p[0] === 'rep' && window.SigsoCIReportes) { SigsoCIReportes.mostrar(p[1], ctxReportes()); return; }
    if (p[0] === 'conv' && window.SigsoCIConvenios && matriz('CONVENIOS')) { SigsoCIConvenios.mostrar(p.slice(1).join(':'), ctxReportes()); return; }
    if (vista_ === 'sii' && window.SigsoCISII) { SigsoCISII.mostrar(ctxReportes()); return; }
    if (vista_ === 'recibir') { if (envio_) irAItem(envio_.fuente === 'tgr' ? 'conv:tgr' : 'sii'); else vistaEsperando(); return; }
    if (vista_ === 'accesos' && cfg_.puede_administrar) { vistaAccesos(); return; }
    vista_ = 'inicio';
    vistaInicio();
  }
  function ctxReportes() {
    return { cfg: cfg_, api: api, pagina: pagina, cabecera: cabecera, raiz: raiz, perTexto: perTexto, mover: mover, periodoActual: periodoActual,
      nombre: nombre, titulo: titulo, miles: miles, resolverPersonas: resolverPersonas, irAItem: irAItem, matriz: matriz, depto: depto, secciones: secciones,
      periodo: function () { return periodo_; }, vista: function () { return vista_; },
      envio: function () { return envio_; }, marcador: marcador, fechaCorta: fechaCorta };
  }
  function cambiarPeriodo(n) {
    periodo_ = mover(periodo_, n);
    var p = String(vista_).split(':');
    if (p[0] === 'm') { sel_ = {}; mostrar_ = LOTE_FILAS; abrirMatriz(p[1]); } else vistaInicio();
  }

  // =========================================================================================
  // Resumen del mes
  // =========================================================================================
  function vistaInicio(silencioso) {
    var t = ++turno_;
    if (cfg_.periodo !== periodo_) {
      pagina(cabecera('Control interno', 'Resumen del mes', 'Cargando…', selectorPeriodo()) + U.esqueleto('tarjetas', 6));
      api('getControlInterno', { periodo: periodo_ }).then(function (r) { if (t !== turno_) return; if (!r || !r.ok) { error(r); return; } cfg_ = r.data; vistaInicio(); });
      return;
    }
    var SUB = 'Las matrices de Contabilidad y RR.HH. con las mismas columnas que sus planillas. Mientras dure la prueba, el registro oficial sigue siendo el Drive.';
    if (!cfg_.departamentos.length) {
      pagina(cabecera('Control interno', 'Resumen del mes', SUB) + U.card({ i: 1, cuerpo: U.vacio({ icono: 'candado', titulo: 'Todavía no tienes un departamento asignado', texto: 'Pide al administrador que te dé acceso a Contabilidad o a RR.HH. en Control interno › Accesos.' }) }));
      return;
    }
    var i = 0;
    var html = cfg_.departamentos.map(function (d) {
      var lib = (d.liberadores || []).map(nombre).join(', ');
      return '<section class="ci2-depto sx2-entra" style="--i:' + (i++) + '"><div class="ci2-depto__cab"><h2>' + txt(d.nombre) + '</h2>' +
        '<span class="sx2-tenue">' + (d.registra ? 'Registras' : 'Solo lectura') + (d.libera ? ' · Liberas' : '') + ' · Libera: ' + (lib ? txt(lib) : '<i>sin asignar</i>') + '</span></div>' +
        secciones(d).map(function (s) {
          return '<h3 class="ci2-seccion">' + txt(s.nombre) + '</h3><div class="ci2-tarjetas">' + s.matrices.map(tarjeta).join('') + '</div>';
        }).join('') + '</section>';
    }).join('');
    pagina(cabecera('Control interno', 'Resumen de ' + perTexto(periodo_, true), SUB, selectorPeriodo() +
      (cfg_.puede_administrar ? U.boton({ texto: 'Importar planillas', icono: 'subir', clase: 'js-ci2-importar' }) : '') +
      U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-ci2-recargar' })) + html, !!silencioso);
  }
  function tarjeta(m) {
    var r = cfg_.resumen[m.clave];
    var cuerpo;
    if (m.tipo === 'lista') cuerpo = '<span class="ci2-tarjeta__vacia">Lista de situación por cliente</span>';
    else if (!r || !r.total) cuerpo = '<span class="ci2-tarjeta__vacia">Sin filas en ' + U.esc(perTexto(periodo_)) + '</span>';
    else {
      var pct = Math.round(100 * r.finalizados / r.total);
      cuerpo = '<span class="ci2-tarjeta__cifras"><span><b>' + r.total + '</b> filas</span>' +
        (r.pendientes ? '<span class="sx2-tono-alerta"><b>' + r.pendientes + '</b> sin terminar</span>' : '') +
        (r.por_liberar ? '<span class="sx2-tono-info"><b>' + r.por_liberar + '</b> por liberar</span>' : '') +
        (r.liberados ? '<span class="sx2-tono-ok"><b>' + r.liberados + '</b> liberadas</span>' : '') + '</span>' + U.barra(pct, pct === 100 ? 'ok' : 'primario');
    }
    return '<button type="button" class="ci2-tarjeta" data-ci2-ir="m:' + U.esc(m.clave) + '">' +
      '<span class="ci2-tarjeta__nom">' + txt(m.nombre) + (m.codigo ? ' <small class="sx2-tenue">' + txt(m.codigo) + '</small>' : '') + '</span>' +
      '<span class="ci2-tarjeta__desc">' + txt(m.descripcion || (m.tipo === 'registro' ? 'Una fila por requerimiento, como en la planilla.' : '')) + '</span>' + cuerpo + '</button>';
  }

  // =========================================================================================
  // La matriz como planilla
  // =========================================================================================
  function pedidoMatriz(m) {
    if (m.tipo === 'lista') return { matriz: m.clave };
    if (m.tipo === 'registro') { if (!anio_) anio_ = periodo_.slice(0, 4); return { matriz: m.clave, anio: anio_ }; }
    return { matriz: m.clave, periodo: periodo_ };
  }
  function abrirMatriz(clave, silencioso) {
    var m = matriz(clave), t = ++turno_;
    if (!silencioso) pagina(cabecera('Control interno · ' + depto(m.depto).nombre + ' · ' + m.seccion, m.nombre, m.descripcion) + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 10));
    return api('listarRegistrosCI', pedidoMatriz(m)).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { error(r); return; }
      lista_ = r.data;
      pintarMatriz(!!silencioso);
      resolverPersonas(lista_.registros).then(function () { if (t === turno_ && lista_ && lista_.matriz === clave) pintarMatriz(true); });
    });
  }
  /** Columnas que se ven: las de la planilla actual + las antiguas que tienen datos en lo listado. */
  function columnasVisibles(m) {
    var conDatos = {};
    (lista_.columnas_con_datos || []).forEach(function (k) { conDatos[k] = true; });
    var cCli = colRol(m, 'cliente');
    return m.columnas.filter(function (c) { return c !== cCli && (!c.antigua || conDatos[c.clave]) && (verSinUso_ || !c.sinUso); });
  }
  function esNuevo(x) { return !!lista_.nuevos && lista_.nuevos.indexOf(x.registro_id) !== -1; }
  function tituloCol(c) { return c.etiqueta + (c.ayuda ? ' — ' + c.ayuda : '') + (c.sinUso ? ' (sin uso)' : ''); }
  function claseTh(c) { return 'ci2-th-' + c.tipo + (c.ayuda ? ' ci2-th--ayuda' : '') + (c.sinUso ? ' ci2-th--sinuso' : ''); }
  function filtrados() {
    var m = matriz(lista_.matriz), q = norm(f_.q);
    return lista_.registros.filter(function (r) {
      if (f_.estado && r.estado !== f_.estado) return false;
      if (f_.resp && claveQuien(m, r) !== f_.resp) return false;
      if (f_.liberar && !liberable(m, r)) return false;
      if (f_.nuevos && !esNuevo(r)) return false;
      if (mesFiltro_ && m.tipo === 'registro' && r.periodo !== mesFiltro_) return false;
      if (q) {
        var heno = norm([r.cliente_nombre, r.cliente_rut, r.observaciones].concat(Object.keys(r.datos || {}).filter(function (k) { return k.charAt(0) !== '_'; }).map(function (k) { return r.datos[k]; })).join(' '));
        if (heno.indexOf(q) === -1) return false;
      }
      return true;
    });
  }
  function valorVisible(c, v) {
    if (v === undefined || v === null || v === '') return '';
    if (c.tipo === 'fecha') return fechaCorta(v);
    if (c.tipo === 'monto') return typeof v === 'number' ? '$ ' + miles(v) : String(v);
    if (c.tipo === 'numero') return typeof v === 'number' ? miles(v) : String(v);
    return String(v);
  }
  function encabezado(m, cols, reg) {
    var hayGrupos = cols.some(function (c) { return c.grupo; });
    var fijas = '<th class="ci2-fija ci2-col-sel" rowspan="' + (hayGrupos ? 2 : 1) + '">' + (reg || lista_.puede_liberar ? '<input type="checkbox" class="js-ci2-todos" aria-label="Marcar todas las visibles">' : '') + '</th>' +
      '<th class="ci2-fija ci2-col-n" rowspan="' + (hayGrupos ? 2 : 1) + '">N°</th>' +
      '<th class="ci2-fija ci2-col-sit" rowspan="' + (hayGrupos ? 2 : 1) + '">Situación</th>' +
      (m.sinCliente ? '' : '<th class="ci2-fija ci2-col-cli" rowspan="' + (hayGrupos ? 2 : 1) + '">' + txt((colRol(m, 'cliente') || {}).etiqueta || 'Cliente') + '</th>');
    if (!hayGrupos) return '<tr>' + fijas + cols.map(function (c) { return '<th class="' + claseTh(c) + '" title="' + U.esc(tituloCol(c)) + '">' + txt(c.etiqueta) + '</th>'; }).join('') + '</tr>';
    var fila1 = '', fila2 = '', k = 0;
    while (k < cols.length) {
      var c = cols[k];
      if (!c.grupo) { fila1 += '<th rowspan="2" class="' + claseTh(c) + '" title="' + U.esc(tituloCol(c)) + '">' + txt(c.etiqueta) + '</th>'; k++; continue; }
      var n = 0;
      while (k + n < cols.length && cols[k + n].grupo === c.grupo) { fila2 += '<th class="' + claseTh(cols[k + n]) + '" title="' + U.esc(tituloCol(cols[k + n])) + '">' + txt(cols[k + n].etiqueta) + '</th>'; n++; }
      fila1 += '<th colspan="' + n + '" class="ci2-th-grupo">' + txt(c.grupo) + '</th>';
      k += n;
    }
    return '<tr>' + fijas + fila1 + '</tr><tr>' + fila2 + '</tr>';
  }
  function fila(m, x, cols, reg, n) {
    var e = estadoDe(m, x.estado);
    var sens = {}, auto = {};
    (m.sensibles || []).forEach(function (k) { sens[k] = true; });
    ((x.datos || {})._auto || []).forEach(function (k) { auto[k] = true; });
    return '<tr data-id="' + U.esc(x.registro_id) + '"' + (sel_[x.registro_id] ? ' class="ci2-fila--sel"' : '') + '>' +
      '<td class="ci2-fija ci2-col-sel">' + (reg || lista_.puede_liberar ? '<input type="checkbox" class="js-ci2-sel" aria-label="Marcar"' + (sel_[x.registro_id] ? ' checked' : '') + '>' : '') + '</td>' +
      '<td class="ci2-fija ci2-col-n"><button type="button" class="ci2-n js-ci2-ver" title="Ver la fila completa e historial">' + n + '</button></td>' +
      '<td class="ci2-fija ci2-col-sit">' + U.badge(e.etiqueta, e.tono) + (x.liberado_por ? ' <span class="ci2-lib" title="Liberado por ' + U.esc(nombre(x.liberado_por)) + '">' + U.ico('escudoCheck', 14) + '</span>' : '') + '</td>' +
      (m.sinCliente ? '' : '<td class="ci2-fija ci2-col-cli' + (reg ? ' ci2-ed' : '') + '" data-col="__cliente" title="' + U.esc(x.cliente_nombre + (x.cliente_rut ? ' · ' + x.cliente_rut : '')) + '">' + (esNuevo(x) ? '<span class="ci2-nuevo" title="Primera vez en esta matriz">Nuevo</span> ' : '') + txt(x.cliente_nombre) + (x.cliente_id ? '' : ' <span class="ci2-fuera" title="No está en el catálogo de clientes de SIGSO">•</span>') + '</td>') +
      cols.map(function (c) {
        var v = (x.datos || {})[c.clave];
        var vis = valorVisible(c, v);
        var editable = reg && !sens[c.clave];
        var tit = auto[c.clave] ? 'Calculado por SIGSO. ' + (c.ayuda || 'Puedes escribir otro valor.') : (vis.length > 28 ? vis : '');
        return '<td class="ci2-c ci2-td-' + c.tipo + (editable ? ' ci2-ed' : '') + (auto[c.clave] ? ' ci2-c--auto' : '') + '" data-col="' + U.esc(c.clave) + '"' + (tit ? ' title="' + U.esc(tit) + '"' : '') + '>' + txt(vis) + '</td>';
      }).join('') + '</tr>';
  }
  function pintarMatriz(silencioso) {
    var m = matriz(lista_.matriz), d = depto(m.depto), r = lista_.resumen;
    var reg = !!lista_.puede_registrar, lib = !!lista_.puede_liberar;
    var visibles = filtrados();
    var cols = columnasVisibles(m);
    var nSel = Object.keys(sel_).filter(function (k) { return sel_[k]; }).length;
    var selPer = '';
    if (m.tipo === 'mensual') selPer = selectorPeriodo();
    else if (m.tipo === 'registro') {
      var anios = (lista_.anios || []).slice();
      if (anios.indexOf(anio_) === -1) anios.unshift(anio_);
      selPer = select('', anios.map(function (a) { return [a, a]; }), anio_, 'class="sx2-select js-ci2-anio" aria-label="Año"') +
        select('', [['', 'Todo el año']].concat(MESES_LARGO.map(function (mm, k) { var p = anio_ + '-M' + ('0' + (k + 1)).slice(-2); return [p, mm.charAt(0).toUpperCase() + mm.slice(1)]; })), mesFiltro_, 'class="sx2-select js-ci2-mes" aria-label="Mes"');
    }
    var acciones = selPer +
      (reg && m.abrirMes && lista_.por_abrir ? U.boton({ texto: 'Abrir el mes (' + lista_.por_abrir + ')', icono: 'calendario', clase: 'js-ci2-abrir', titulo: 'Crea las filas de ' + perTexto(periodo_) + ' con los clientes de ' + perTexto(lista_.periodo_anterior) }) : '') +
      (reg ? U.boton({ texto: 'Agregar fila', icono: 'nueva', variante: 'primario', clase: 'js-ci2-nuevo' }) : '') +
      (m.tipo !== 'lista' ? U.boton({ soloIcono: true, icono: 'grafico', titulo: 'Informe del mes de esta matriz', clase: 'js-ci2-informe' }) : '') +
      U.boton({ soloIcono: true, icono: 'descargar', titulo: 'Descargar a Excel (lo que se ve)', clase: 'js-ci2-excel' }) +
      U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-ci2-recargar' });
    var donde = m.tipo === 'mensual' ? perTexto(periodo_, true) : (m.tipo === 'registro' ? (mesFiltro_ ? perTexto(mesFiltro_, true) : 'todo ' + anio_) : 'la lista');
    var kpis = m.tipo === 'lista' ? '' : '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, etiqueta: 'Filas', valor: r.total, icono: 'tabla', tono: 'primario', unidad: donde }) +
      U.kpi({ i: 1, etiqueta: 'Sin terminar', valor: r.pendientes, icono: 'reloj', tono: r.pendientes ? 'alerta' : 'ok' }) +
      U.kpi({ i: 2, etiqueta: 'Terminadas', valor: r.finalizados, icono: 'check', tono: 'info', progreso: r.total ? 100 * r.finalizados / r.total : 0 }) +
      (m.sinLiberacion ? '' : U.kpi({ i: 3, etiqueta: 'Por liberar', valor: r.por_liberar, icono: 'escudoCheck', tono: r.por_liberar ? 'alerta' : 'ok', filtro: 'liberar', activo: f_.liberar, titulo: 'Mostrar solo lo que espera liberación' })) +
      '</div>';
    var resps = {};
    lista_.registros.forEach(function (x) { var k = claveQuien(m, x); if (k) resps[k] = quien(m, x); });
    var nSinUso = m.columnas.filter(function (c) { return c.sinUso; }).length;
    var barra = '<div class="sx2-card ci2-herr sx2-entra"><div class="sx2-barra-filtros">' +
      '<input class="sx2-input js-ci2-q" type="search" placeholder="Buscar en ' + U.esc(m.nombre.toLowerCase()) + '…" value="' + U.esc(f_.q) + '" aria-label="Buscar">' +
      (m.tipo === 'lista' ? '' : select('', [['', 'Toda situación']].concat(m.estados.map(function (e) { return [e.clave, e.etiqueta]; })), f_.estado, 'class="sx2-select js-ci2-f" data-f="estado" aria-label="Situación"')) +
      (Object.keys(resps).length ? select('', [['', 'Todos los responsables']].concat(Object.keys(resps).sort(function (a, b) { return resps[a].localeCompare(resps[b]); }).map(function (k) { return [k, resps[k]]; })), f_.resp, 'class="sx2-select js-ci2-f" data-f="resp" aria-label="Responsable"') : '') +
      (lista_.nuevos && lista_.nuevos.length ? U.chip({ texto: 'Clientes nuevos', n: lista_.nuevos.length, icono: 'nueva', activo: f_.nuevos, clase: 'js-ci2-nuevos', tono: 'info' }) : '') +
      (nSinUso ? U.chip({ texto: (verSinUso_ ? 'Ocultar' : 'Ver') + ' columnas sin uso', n: nSinUso, activo: verSinUso_, clase: 'js-ci2-sinuso' }) : '') +
      (f_.q || f_.estado || f_.resp || f_.liberar || f_.nuevos ? U.boton({ texto: 'Limpiar', variante: 'fantasma', sm: true, clase: 'js-ci2-limpiar' }) : '') +
      '<span class="sx2-tenue ci2-cuenta">' + visibles.length + (visibles.length === 1 ? ' fila' : ' filas') + '</span></div>' +
      (nSel ? '<div class="ci2-lote">' + '<b>' + nSel + (nSel === 1 ? ' marcada' : ' marcadas') + '</b>' +
        (lib ? U.boton({ texto: 'Liberar', icono: 'escudoCheck', sm: true, variante: 'primario', clase: 'js-ci2-lote', datos: { accion: 'liberar' } }) + U.boton({ texto: 'Quitar liberación', sm: true, clase: 'js-ci2-lote', datos: { accion: 'desliberar' } }) : '') +
        (reg ? U.boton({ texto: 'Anular', icono: 'basura', sm: true, variante: 'peligro', clase: 'js-ci2-lote', datos: { accion: 'anular' } }) : '') +
        U.boton({ texto: 'Desmarcar', sm: true, variante: 'fantasma', clase: 'js-ci2-desmarcar' }) + '</div>' : '') + '</div>';
    var nota = reg ? '<p class="ci2-ayuda sx2-tenue">Haz clic en una celda para escribir (Enter baja, Tab avanza, Esc cancela). La <b>Situación</b> se calcula con las columnas de la fila; el N° abre la fila completa con su historial.</p>' : '';
    var cuerpo;
    if (!visibles.length) {
      cuerpo = U.card({ i: 4, cuerpo: U.vacio({ icono: 'tabla', titulo: lista_.registros.length ? 'Ninguna fila calza con el filtro' : 'Sin filas en ' + donde, texto: reg && !lista_.registros.length ? (m.abrirMes && lista_.por_abrir ? 'Abre el mes para copiar los clientes del mes anterior, o agrega una fila.' : 'Agrega la primera fila.') : '' }) });
    } else {
      var muestra = visibles.slice(0, mostrar_);
      cuerpo = '<div class="ci2-grilla-caja sx2-entra"><div class="ci2-grilla"><table class="ci2-tabla"><thead>' + encabezado(m, cols, reg) + '</thead><tbody>' +
        muestra.map(function (x, k) { return fila(m, x, cols, reg, (x.datos && x.datos._fila && m.tipo !== 'registro' ? k + 1 : k + 1)); }).join('') + '</tbody></table></div>' +
        (visibles.length > mostrar_ ? '<div class="ci2-mas">' + U.boton({ texto: 'Mostrar ' + Math.min(LOTE_FILAS, visibles.length - mostrar_) + ' más (de ' + (visibles.length - mostrar_) + ')', clase: 'js-ci2-mas' }) + '</div>' : '') + '</div>' +
        datalists(m, cols);
    }
    pagina(cabecera('Control interno · ' + d.nombre + ' · ' + m.seccion, m.nombre + (m.codigo ? ' · ' + m.codigo : ''), m.descripcion, acciones) + kpis + alertas(reg) + barra + nota + cuerpo, !!silencioso);
  }
  /** Avisos que cruzan columnas o matrices (IVA: recordatorio, postergación, impuesto único de RR.HH.). */
  function alertas(reg) {
    var l = lista_.alertas || [];
    if (!l.length) return '';
    return '<div class="ci2-alertas sx2-entra">' + l.map(function (a) {
      var max = 8;
      return '<details class="ci2-alerta sx2-tono-' + U.esc(a.tono) + '"' + (a.tono === 'critico' ? ' open' : '') + '><summary>' + U.ico(a.tono === 'info' ? 'info' : 'alerta', 16) + '<b>' + txt(a.titulo) + '</b>' + (a.texto ? ' <span class="sx2-tenue">' + txt(a.texto) + '</span>' : '') + '</summary><ul>' +
        a.items.slice(0, max).map(function (it) {
          return '<li><span><b>' + txt(it.cliente) + '</b> · ' + txt(it.texto) + '</span>' +
            (it.registro_id ? U.boton({ texto: 'Ver fila', sm: true, variante: 'fantasma', clase: 'js-ci2-alerta-fila', datos: { id: it.registro_id } }) : '') +
            (reg && it.usar && it.registro_id ? U.boton({ texto: 'Usar este monto', sm: true, clase: 'js-ci2-alerta-usar', datos: { id: it.registro_id, usar: JSON.stringify(it.usar) } }) : '') + '</li>';
        }).join('') + (a.items.length > max ? '<li class="sx2-tenue">… y ' + (a.items.length - max) + ' más.</li>' : '') + '</ul></details>';
    }).join('') + '</div>';
  }
  function usarValor(b) {
    var datos;
    try { datos = JSON.parse(b.getAttribute('data-usar')); } catch (e) { return; }
    b.disabled = true;
    api('guardarRegistroCI', { registro_id: b.getAttribute('data-id'), datos: datos }).then(function (r) {
      if (!r || !r.ok) { b.disabled = false; PY.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return; }
      PY.aviso('Guardado.', 'exito');
      abrirMatriz(lista_.matriz, true);
    });
  }
  // Sugerencias al escribir: los valores que más se repiten en la planilla.
  function datalists(m, cols) {
    return '<div hidden>' + cols.filter(function (c) { return c.sugerencias && c.sugerencias.length; }).map(function (c) {
      return '<datalist id="ci2-dl-' + U.esc(c.clave) + '">' + c.sugerencias.map(function (s) { return '<option value="' + U.esc(s) + '"></option>'; }).join('') + '</datalist>';
    }).join('') + '<datalist id="ci2-dl-__cliente">' + (cfg_.clientes || []).map(function (c) { return '<option value="' + U.esc(etiquetaCliente(c)) + '"></option>'; }).join('') + '</datalist></div>';
  }
  function etiquetaCliente(c) { return c.nombre + (c.rut ? ' · ' + c.rut : ''); }
  function registroDe(id) { return (lista_.registros || []).filter(function (x) { return x.registro_id === id; })[0]; }
  function reemplazar(reg) {
    lista_.registros = lista_.registros.map(function (x) { return x.registro_id === reg.registro_id ? reg : x; });
  }
  function recalcularResumen() {
    var m = matriz(lista_.matriz), r = { total: 0, pendientes: 0, finalizados: 0, liberados: 0, por_liberar: 0, por_estado: {} };
    lista_.registros.forEach(function (x) {
      r.total++;
      var e = estadoDe(m, x.estado);
      if (e.final) r.finalizados++; else r.pendientes++;
      if (x.liberado_por) r.liberados++; else if (liberable(m, x)) r.por_liberar++;
    });
    lista_.resumen = r;
  }

  // --- edición en la celda ------------------------------------------------------------------
  var editando_ = null;
  function abrirEditor(td) {
    if (editando_) cerrarEditor(true);
    var tr = td.parentNode, id = tr.getAttribute('data-id'), col = td.getAttribute('data-col');
    var m = matriz(lista_.matriz), x = registroDe(id);
    if (!x) return;
    var c = col === '__cliente' ? { clave: '__cliente', tipo: 'texto', etiqueta: 'Cliente' } : m.columnas.filter(function (k) { return k.clave === col; })[0];
    if (!c) return;
    var v = col === '__cliente' ? (x.cliente_id ? etiquetaCliente({ nombre: x.cliente_nombre, rut: x.cliente_rut }) : x.cliente_nombre) : (x.datos || {})[col];
    v = v === undefined || v === null ? '' : v;
    var esFecha = c.tipo === 'fecha' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(v)));
    var el;
    if (c.tipo === 'texto_largo') el = '<textarea class="ci2-editor" rows="3">' + U.esc(v) + '</textarea>';
    else el = '<input class="ci2-editor" ' + (esFecha ? 'type="date"' : (c.tipo === 'hora' ? 'type="time"' : 'type="text"')) + ' value="' + U.esc(v) + '"' +
      ((c.sugerencias && c.sugerencias.length) || col === '__cliente' ? ' list="ci2-dl-' + U.esc(col) + '"' : '') + (c.tipo === 'monto' || c.tipo === 'numero' ? ' inputmode="decimal"' : '') + ' autocomplete="off">';
    editando_ = { td: td, id: id, col: col, c: c, antes: String(v), html: td.innerHTML };
    td.classList.add('ci2-c--editando');
    td.innerHTML = el;
    var inp = td.querySelector('.ci2-editor');
    inp.focus();
    if (inp.select && inp.type === 'text') inp.select();
  }
  function cerrarEditor(guardar, mover_) {
    var e = editando_;
    if (!e) return;
    editando_ = null;
    var inp = e.td.querySelector('.ci2-editor');
    var nuevo = inp ? inp.value : e.antes;
    e.td.classList.remove('ci2-c--editando');
    e.td.innerHTML = e.html;
    if (guardar && String(nuevo).trim() !== String(e.antes).trim()) guardarCelda(e, nuevo);
    if (mover_) moverCelda(e.td, mover_);
  }
  function moverCelda(td, dir) {
    var tr = td.parentNode, idx = [].indexOf.call(tr.children, td);
    var sig = null;
    if (dir === 'abajo' && tr.nextElementSibling) sig = tr.nextElementSibling.children[idx];
    if (dir === 'derecha') { sig = td.nextElementSibling; while (sig && !sig.classList.contains('ci2-ed')) sig = sig.nextElementSibling; }
    if (dir === 'izquierda') { sig = td.previousElementSibling; while (sig && !sig.classList.contains('ci2-ed')) sig = sig.previousElementSibling; }
    if (sig && sig.classList.contains('ci2-ed')) { sig.scrollIntoView({ block: 'nearest', inline: 'nearest' }); abrirEditor(sig); }
  }
  function guardarCelda(e, valor) {
    var payload = { registro_id: e.id, datos: {} };
    var m = matriz(lista_.matriz);
    if (e.col === '__cliente') {
      var v = String(valor).trim();
      var hallado = (cfg_.clientes || []).filter(function (c) { return etiquetaCliente(c) === v; })[0];
      if (hallado) payload.cliente_id = hallado.cliente_id;
      else { if (v.length < 2) { PY.aviso('Escribe el nombre del cliente o elígelo de la lista.', 'error'); return; } payload.cliente_id = ''; payload.cliente_nombre = v; var cc = colRol(m, 'cliente'); if (cc) payload.datos[cc.clave] = v; }
    } else payload.datos[e.col] = valor;
    e.td.classList.add('ci2-c--guardando');
    api('guardarRegistroCI', payload).then(function (r) {
      var td = raiz() && raiz().querySelector('tr[data-id="' + e.id + '"] [data-col="' + e.col + '"]');
      if (!r || !r.ok) { if (td) td.classList.remove('ci2-c--guardando'); PY.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return; }
      reemplazar(r.data.registro);
      recalcularResumen();
      // Se repinta solo la fila (rápido aunque la planilla tenga cientos).
      var tr = raiz().querySelector('tr[data-id="' + e.id + '"]');
      if (tr) {
        var n = tr.querySelector('.ci2-n') ? tr.querySelector('.ci2-n').textContent : '';
        var tmp = document.createElement('tbody');
        tmp.innerHTML = fila(m, r.data.registro, columnasVisibles(m), !!lista_.puede_registrar, n);
        var nueva = tmp.firstChild;
        // Si mientras tanto se abrió otra celda de la misma fila, se conserva.
        if (editando_ && editando_.id === e.id) { var abierta = editando_.td; var col2 = editando_.col; var celda = nueva.querySelector('[data-col="' + col2 + '"]'); if (celda) nueva.replaceChild(abierta, celda); }
        tr.parentNode.replaceChild(nueva, tr);
        var hecha = nueva.querySelector('[data-col="' + e.col + '"]');
        if (hecha) { hecha.classList.add('ci2-c--ok'); setTimeout(function () { hecha.classList.remove('ci2-c--ok'); }, 900); }
      }
      if (/liberad/.test(r.data.message || '')) PY.aviso(r.data.message, 'info');
    });
  }

  // --- fila completa (panel) -------------------------------------------------------------------
  function control(c, v, attrs) {
    v = v === undefined || v === null ? '' : v;
    if (c.tipo === 'fecha' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(v)))) return '<input class="sx2-input" type="date" value="' + U.esc(v) + '" ' + attrs + '>';
    if (c.tipo === 'hora') return '<input class="sx2-input" type="text" placeholder="hh:mm" value="' + U.esc(v) + '" ' + attrs + '>';
    if (c.tipo === 'texto_largo') return '<textarea class="sx2-input" rows="3" ' + attrs + '>' + U.esc(v) + '</textarea>';
    return '<input class="sx2-input" value="' + U.esc(v) + '" ' + attrs + ((c.sugerencias && c.sugerencias.length) ? ' list="ci2-dlf-' + U.esc(c.clave) + '"' : '') + ' autocomplete="off">';
  }
  function formFila(m, x) {
    var nuevo = !x, d = depto(m.depto);
    var reg = !!lista_.puede_registrar;
    var cCli = colRol(m, 'cliente');
    var sens = {};
    (m.sensibles || []).forEach(function (k) { sens[k] = true; });
    var cliVal = x ? (x.cliente_id ? etiquetaCliente({ nombre: x.cliente_nombre, rut: x.cliente_rut }) : x.cliente_nombre) : '';
    var grupos = [], actual = null;
    m.columnas.filter(function (c) { return c !== cCli && (!c.antigua || (x && (x.datos || {})[c.clave] !== undefined)); }).forEach(function (c) {
      var g = c.grupo || '';
      if (!actual || actual.g !== g) { actual = { g: g, cols: [] }; grupos.push(actual); }
      actual.cols.push(c);
    });
    var campos =
      (m.sinCliente ? '' : U.campo(cCli ? cCli.etiqueta : 'Cliente', '<input class="sx2-input" name="cliente" list="ci2-dlf-__cliente" value="' + U.esc(cliVal) + '" placeholder="Busca por nombre o RUT" autocomplete="off"' + (reg ? ' required' : ' disabled') + '>', 'Si no está en el catálogo, escribe el nombre: queda marcado para conciliar.')) +
      grupos.map(function (gr) {
        var cuerpo = '<div class="ci2-form-grid">' + gr.cols.map(function (c) {
          var v = x ? (x.datos || {})[c.clave] : '';
          if (sens[c.clave] && v === '•••') return U.campo(c.etiqueta, '<input class="sx2-input" value="Reservado a RR.HH." disabled>');
          var esAuto = x && ((x.datos || {})._auto || []).indexOf(c.clave) !== -1;
          return U.campo(c.etiqueta + (c.sinUso ? ' (sin uso)' : ''), control(c, v, 'name="d_' + U.esc(c.clave) + '"' + (reg ? '' : ' disabled')),
            (esAuto ? 'Calculado por SIGSO. ' : '') + (c.ayuda || ''));
        }).join('') + '</div>';
        return gr.g ? '<fieldset class="ci2-grupo"><legend>' + txt(gr.g) + '</legend>' + cuerpo + '</fieldset>' : cuerpo;
      }).join('') +
      U.campo('Observaciones (SIGSO)', '<textarea class="sx2-input" name="observaciones" rows="2"' + (reg ? '' : ' disabled') + '>' + U.esc(x ? x.observaciones : '') + '</textarea>') +
      '<div hidden><datalist id="ci2-dlf-__cliente">' + (cfg_.clientes || []).map(function (c) { return '<option value="' + U.esc(etiquetaCliente(c)) + '"></option>'; }).join('') + '</datalist>' +
        m.columnas.filter(function (c) { return c.sugerencias && c.sugerencias.length; }).map(function (c) { return '<datalist id="ci2-dlf-' + U.esc(c.clave) + '">' + c.sugerencias.map(function (s) { return '<option value="' + U.esc(s) + '"></option>'; }).join('') + '</datalist>'; }).join('') + '</div>' +
      (x ? '<div class="ci2-historial js-ci2-historial"><span class="sx2-campo__et">Historial</span><p class="sx2-tenue">Cargando…</p></div>' : '');
    var e = x ? estadoDe(m, x.estado) : null;
    U.formulario({
      titulo: (nuevo ? 'Agregar fila · ' : '') + m.nombre, ancho: true, boton: reg ? (nuevo ? 'Agregar' : 'Guardar') : '',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + txt(d.nombre) + ' · ' + txt(m.tipo === 'lista' ? 'lista' : (x ? perTexto(x.periodo, true) : (m.tipo === 'mensual' ? perTexto(periodo_, true) : 'el mes sale de la fecha'))) +
        (e ? ' · Situación: ' + U.badge(e.etiqueta, e.tono) : '') + (x && x.liberado_por ? ' · Liberado por ' + txt(nombre(x.liberado_por)) + ': si lo cambias, vuelve a revisión.' : '') +
        (x && x.datos && x.datos._hoja ? ' · Importado de la hoja “' + txt(x.datos._hoja) + '”' : '') + '</span>',
      campos: campos,
      alMontar: function (form, dw) {
        if (x) api('getRegistroCI', { registro_id: x.registro_id }).then(function (r) {
          var h = dw.el.querySelector('.js-ci2-historial');
          if (!h) return;
          var l = (r && r.ok && r.data.historial) || [];
          resolverPersonas(l).then(function () {
            h.innerHTML = '<span class="sx2-campo__et">Historial</span>' + (l.length ? '<ol class="ci2-hist">' + l.map(function (k) {
              return '<li><b>' + txt(nombre(k.usuario_email)) + '</b> · ' + txt(PY.fecha(k.fecha, true)) + ' — ' + txt(k.detalle || k.accion) + '</li>';
            }).join('') + '</ol>' : '<p class="sx2-tenue">Sin cambios registrados.</p>');
          });
        });
      },
      preparar: function (v) {
        if (!reg) return 'Solo lectura.';
        var p = { matriz: m.clave, datos: {} };
        if (x) p.registro_id = x.registro_id;
        if (!m.sinCliente) {
          var cli = String(v.cliente || '').trim();
          if (!x || cli !== cliVal) {
            var hallado = (cfg_.clientes || []).filter(function (c) { return etiquetaCliente(c) === cli; })[0];
            if (hallado) p.cliente_id = hallado.cliente_id;
            else { if (cli.length < 2) return 'Elige el cliente o escribe su nombre.'; p.cliente_id = ''; p.cliente_nombre = cli; if (cCli) p.datos[cCli.clave] = cli; }
          }
        }
        if (nuevo && m.tipo === 'mensual') p.periodo = periodo_;
        p.observaciones = v.observaciones || '';
        m.columnas.forEach(function (c) {
          if (c === cCli || v['d_' + c.clave] === undefined) return;
          var antes = x ? (x.datos || {})[c.clave] : '';
          if (sens[c.clave] && antes === '•••') return;
          if (String(v['d_' + c.clave]) !== String(antes === undefined || antes === null ? '' : antes)) p.datos[c.clave] = v['d_' + c.clave];
        });
        return p;
      },
      enviar: function (p) { return api('guardarRegistroCI', p); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Guardado.'; },
      listo: function () { abrirMatriz(m.clave, true); }
    });
  }

  // --- acciones ---------------------------------------------------------------------------
  function marcados() { return Object.keys(sel_).filter(function (k) { return sel_[k]; }); }
  function resultadoLote(r) {
    if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
    var o = (r.data && r.data.omitidas) || [];
    PY.aviso(r.data.message + (o.length ? ' ' + o.slice(0, 3).map(function (k) { return (k.cliente_nombre || '—') + ': ' + k.motivo; }).join(' · ') + (o.length > 3 ? ' · y ' + (o.length - 3) + ' más.' : '') : ''), o.length && !r.data.hechos ? 'error' : 'exito');
    sel_ = {};
    abrirMatriz(lista_.matriz, true);
  }
  function lote(accion) {
    var ids = marcados();
    if (!ids.length) return;
    api('accionLoteCI', { matriz: lista_.matriz, accion: accion, ids: ids }).then(resultadoLote);
  }
  // El Excel sale con las mismas columnas que la planilla (lo filtrado).
  function excelMatriz() {
    var m = matriz(lista_.matriz), cols = columnasVisibles(m), cCli = colRol(m, 'cliente');
    var columnas = ['Situación'].concat(m.sinCliente ? [] : [cCli ? cCli.etiqueta : 'Cliente'], cols.map(function (c) { return (c.grupo ? c.grupo + ' · ' : '') + c.etiqueta; }), m.sinLiberacion ? [] : ['Liberado por', 'Fecha liberación'], ['Observaciones SIGSO']);
    var filas = filtrados().map(function (x) {
      var e = estadoDe(m, x.estado);
      return [{ v: e.etiqueta, tono: e.tono }].concat(m.sinCliente ? [] : [x.cliente_nombre], cols.map(function (c) {
        var v = (x.datos || {})[c.clave];
        if (v === undefined || v === null) return '';
        if (c.tipo === 'fecha') return fechaCorta(v);
        return v;
      }), m.sinLiberacion ? [] : [x.liberado_por ? nombre(x.liberado_por) : '', fechaCorta(x.fecha_liberacion)], [x.observaciones]);
    });
    var donde = m.tipo === 'mensual' ? perTexto(periodo_, true) : (m.tipo === 'registro' ? (mesFiltro_ ? perTexto(mesFiltro_, true) : anio_) : 'lista');
    SigsoReportes.descargarExcelDeDatos({ titulo: m.nombre + ' · ' + donde, subtitulo: depto(m.depto).nombre + ' · Control interno',
      meta: [['Período', donde], ['Filas', String(filas.length)]], hojas: [{ nombre: m.nombre.slice(0, 30), columnas: columnas, filas: filas }],
      nombreArchivo: m.nombre + ' ' + donde }, { boton: raiz().querySelector('.js-ci2-excel') });
  }

  // =========================================================================================
  // Accesos (ADM)
  // =========================================================================================
  function vistaAccesos() {
    var t = ++turno_;
    pagina(cabecera('Control interno', 'Accesos', 'Quién registra o solo mira cada departamento.') + U.esqueleto('tarjetas', 2));
    api('listarMiembrosCI', {}).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { error(r); return; }
      var data = r.data;
      var todos = [];
      data.departamentos.forEach(function (d) { d.miembros.forEach(function (m) { todos.push({ email: m.email }); }); d.liberadores.forEach(function (e) { todos.push({ email: e }); }); });
      resolverPersonas(todos).then(function () {
        if (t !== turno_) return;
        var i = 0;
        pagina(cabecera('Control interno', 'Accesos', 'Quién registra o solo mira cada departamento. La cuenta además necesita el módulo “Control interno” (Administración › Cuentas).') +
          aviso('info', 'escudoCheck', 'Quién <b>libera</b> cada área se define en un solo lugar para Calidad y Control interno: Calidad › Servicios prestados › <b>Quién libera</b>. El motivo de las licencias solo lo ven las personas de RR.HH. de esta lista.') +
          '<div class="ci2-rep-grid">' + data.departamentos.map(function (d) {
            return U.card({ i: ++i, titulo: d.nombre, icono: d.clave === 'RRHH' ? 'equipo' : 'dinero', accion: { texto: 'Editar', clase: 'js-ci2-acc-editar', datos: { depto: d.clave } }, cuerpo:
              (d.miembros.length ? '<ul class="ci2-miembros">' + d.miembros.map(function (m) { return '<li>' + txt(nombre(m.email)) + U.badge(m.rol === 'REGISTRA' ? 'Registra' : 'Solo lectura', m.rol === 'REGISTRA' ? 'ok' : 'neutro') + '</li>'; }).join('') + '</ul>' : '<p class="sx2-tenue">Nadie asignado.</p>') +
              '<p class="sx2-tenue" style="margin:8px 0 0">Libera: ' + (d.liberadores.length ? txt(d.liberadores.map(nombre).join(', ')) : '<i>sin asignar</i>') + '</p>' });
          }).join('') + '</div>');
        raiz().__accesos = data;
      });
    });
  }
  function formAccesos(clave) {
    var data = raiz().__accesos, d = data && data.departamentos.filter(function (x) { return x.clave === clave; })[0];
    if (!d) return;
    var filas = d.miembros.concat([{ email: '', rol: 'REGISTRA' }, { email: '', rol: 'REGISTRA' }, { email: '', rol: 'REGISTRA' }]);
    U.formulario({ titulo: 'Accesos · ' + d.nombre, boton: 'Guardar', ancho: true,
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Deja vacía una fila para quitar a esa persona.</span>',
      campos: filas.map(function (m, k) {
        return '<div class="sx2-form__fila">' + U.campo('Persona', '<input class="sx2-input" type="email" data-persona name="p_' + k + '" value="' + U.esc(m.email) + '">') +
          U.campo('Acceso', select('r_' + k, [['REGISTRA', 'Registra'], ['LECTURA', 'Solo lectura']], m.rol)) + '</div>';
      }).join(''),
      preparar: function (v) {
        var miembros = [];
        filas.forEach(function (m, k) { if (v['p_' + k]) miembros.push({ email: v['p_' + k], rol: v['r_' + k] }); });
        return { depto: clave, miembros: miembros };
      },
      enviar: function (p) { return api('guardarMiembrosCI', p); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Guardado.'; },
      listo: function () { vistaAccesos(); } });
  }

  // =========================================================================================
  // Importar las planillas (ADM): completas, como espejo, reemplazando lo importado
  // =========================================================================================
  function abrirImportar() {
    var est = { paso: 'elegir', archivos: [], resultados: [], preparar: null, avance: '', error: '' };
    var dr = U.drawer({ titulo: 'Importar planillas', subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Las 7 planillas del Drive, completas (todos los años). Reemplaza lo que vino de planillas; lo ingresado a mano en SIGSO se conserva.</span>', cuerpo: '', pie: ' ' });
    dr.el.classList.add('sx2-drawer--ancho');
    function totales() {
      var t = { nuevas: 0, ya: 0, fuera: 0, hojas: 0, omitidas: [], sinCuenta: {}, porMatriz: {}, avisos: [], excluidas: {} };
      est.resultados.forEach(function (r) {
        if (r.omitida || !r.matriz) { t.omitidas.push(r.hoja + (r.motivo ? ' (' + r.motivo + ')' : '')); return; }
        t.hojas++; t.nuevas += r.nuevas || 0; t.ya += r.ya_estaban || 0; t.fuera += r.fuera_catalogo || 0;
        var pm = t.porMatriz[r.matriz] = t.porMatriz[r.matriz] || { nombre: r.nombre, hojas: 0, nuevas: 0, fuera: 0, desde: '', hasta: '' };
        pm.hojas++; pm.nuevas += r.nuevas || 0; pm.fuera += r.fuera_catalogo || 0;
        Object.keys(r.por_periodo || {}).forEach(function (p) { if (p === '0000-M01') return; if (!pm.desde || p < pm.desde) pm.desde = p; if (!pm.hasta || p > pm.hasta) pm.hasta = p; });
        (r.sin_cuenta || []).forEach(function (n) { t.sinCuenta[n] = true; });
        (r.columnas_excluidas || []).forEach(function (n) { t.excluidas[n] = true; });
        (r.avisos || []).forEach(function (a) { if (t.avisos.length < 12) t.avisos.push(r.hoja + ': ' + a); });
      });
      return t;
    }
    function pintar() {
      var c = '', p = '';
      if (est.paso === 'elegir') {
        c = '<div class="sx2-form">' +
          U.campo('Planillas (.xlsx)', '<input class="sx2-input js-ci2-imp-arch" type="file" accept=".xlsx" multiple>', 'Elige las 7 a la vez: facturación, IVA, contabilización, convenios, acuse, anotaciones y el control de matrices de RR.HH.') +
          (est.archivos.length ? '<p class="sx2-tenue" style="margin:0">' + est.archivos.length + (est.archivos.length === 1 ? ' archivo elegido' : ' archivos elegidos') + '</p>' : '') +
          (est.error ? '<p class="sx2-campo__error">' + txt(est.error) + '</p>' : '') + '</div>';
        p = '<span style="flex:1"></span>' + U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) + U.boton({ texto: 'Revisar', icono: 'lupa', variante: 'primario', clase: 'js-ci2-imp-revisar', deshabilitado: !est.archivos.length });
      } else if (est.paso === 'revisando' || est.paso === 'importando') {
        c = '<div class="ci2-imp-avance">' + U.ico('reloj', 18) + '<span>' + txt(est.avance) + '</span></div>';
        p = ' ';
      } else {
        var t = totales(), listo = est.paso === 'listo';
        var pm = Object.keys(t.porMatriz).map(function (k) { return t.porMatriz[k]; });
        c = (listo ? aviso('ok', 'check', '<b>' + t.nuevas.toLocaleString('es-CL') + ' filas importadas</b> de ' + t.hojas + ' hojas.') :
            aviso(t.nuevas ? 'info' : 'alerta', 'info', 'Se importarían <b>' + t.nuevas.toLocaleString('es-CL') + ' filas</b> de ' + t.hojas + ' hojas' +
              (est.preparar && est.preparar.a_borrar ? ', reemplazando <b>' + est.preparar.a_borrar.toLocaleString('es-CL') + ' filas</b> importadas antes' : '') +
              (est.preparar && est.preparar.conservadas_a_mano ? '; se conservan ' + est.preparar.conservadas_a_mano + ' ingresadas a mano' : '') + '. No se ha guardado nada todavía.')) +
          (t.fuera ? aviso('alerta', 'empresa', t.fuera.toLocaleString('es-CL') + ' filas con clientes que no calzan con el catálogo de SIGSO: quedan con su nombre y marcadas “fuera del catálogo”.') : '') +
          (Object.keys(t.excluidas).length ? aviso('info', 'candado', 'Columnas de usuarios y claves que NO se cargan: ' + txt(Object.keys(t.excluidas).join(', ')) + '.') : '') +
          (Object.keys(t.sinCuenta).length ? aviso('info', 'persona', 'Personas de la planilla sin cuenta en SIGSO (se ve su nombre tal cual): ' + txt(Object.keys(t.sinCuenta).slice(0, 25).join(', ')) + '.') : '') +
          (t.avisos.length ? '<details class="ci2-imp-det"><summary>Avisos de lectura (' + t.avisos.length + ')</summary><ul>' + t.avisos.map(function (a) { return '<li>' + txt(a) + '</li>'; }).join('') + '</ul></details>' : '') +
          '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Matriz</th><th class="sx2-num">Hojas</th><th class="sx2-num">' + (listo ? 'Importadas' : 'Filas') + '</th><th>Desde</th><th>Hasta</th><th class="sx2-num">Fuera del catálogo</th></tr></thead><tbody>' +
          pm.map(function (r) { return '<tr><td>' + txt(r.nombre) + '</td><td class="sx2-num">' + r.hojas + '</td><td class="sx2-num"><b>' + r.nuevas.toLocaleString('es-CL') + '</b></td><td>' + txt(r.desde ? perTexto(r.desde) : '—') + '</td><td>' + txt(r.hasta ? perTexto(r.hasta) : '—') + '</td><td class="sx2-num">' + r.fuera + '</td></tr>'; }).join('') + '</tbody></table></div>' +
          (t.omitidas.length ? '<details class="ci2-imp-det"><summary>' + t.omitidas.length + ' hojas que no se importan</summary><p class="sx2-tenue">' + txt(t.omitidas.join(' · ')) + '</p></details>' : '');
        p = '<span style="flex:1"></span>' + (listo
          ? U.boton({ texto: 'Ver el resumen', icono: 'panel', variante: 'primario', clase: 'js-ci2-imp-fin' })
          : U.boton({ texto: 'Volver', clase: 'js-ci2-imp-volver' }) + U.boton({ texto: 'Reemplazar e importar', icono: 'subir', variante: 'primario', clase: 'js-ci2-imp-ok', deshabilitado: !t.nuevas }));
      }
      dr.cuerpo(c);
      dr.el.querySelector('.sx2-drawer__pie').innerHTML = p;
    }
    // Lee cada archivo y manda sus hojas de a una (simular o importar).
    function procesar(simular) {
      // Se reemplaza solo lo de las matrices que traen estos archivos (lo revisado).
      var matrices = simular ? [] : Object.keys(est.resultados.reduce(function (o, r) { if (r.matriz && !r.omitida) o[r.matriz] = true; return o; }, {}));
      est.paso = simular ? 'revisando' : 'importando';
      est.resultados = [];
      var inicio = api('prepararImportacionCI', { simular: simular, matrices: matrices });
      return inicio.then(function (r0) {
        if (!r0 || !r0.ok) throw new Error((r0 && r0.message) || 'No se pudo preparar la importación.');
        if (simular) est.preparar = r0.data;
        return est.archivos.reduce(function (p, archivo) {
          return p.then(function () {
            est.avance = 'Leyendo ' + archivo.name + '…';
            pintar();
            // Fichas A–W de Anotaciones: también el color (azul = resuelta).
            return SigsoLectorXlsx.leer(archivo, { colores: function (n) { return /^[A-Z]$/.test(n); } }).then(function (hojas) {
              var nombres = hojas.map(function (h) { return h.hoja; });
              return hojas.reduce(function (q, h, k) {
                return q.then(function () {
                  est.avance = (simular ? 'Revisando ' : 'Importando ') + archivo.name + ' › ' + h.hoja + ' (' + (k + 1) + ' de ' + hojas.length + ')';
                  pintar();
                  if (!h.filas.some(function (f) { return f && f.some(function (v) { return v !== undefined && v !== null && String(v).trim() !== ''; }); })) return null;
                  var pedido = { archivo: archivo.name, hoja: h.hoja, hojas: nombres, filas: h.filas, simular: simular };
                  if (h.colores) pedido.colores = h.colores;
                  return api('importarHojaCI', pedido).then(function (r) {
                    if (r && r.ok) est.resultados.push(r.data);
                    else est.resultados.push({ archivo: archivo.name, hoja: h.hoja, omitida: true, motivo: (r && r.message) || 'No se pudo' });
                  });
                });
              }, Promise.resolve());
            });
          });
        }, Promise.resolve());
      }).then(function () { est.paso = simular ? 'revisado' : 'listo'; pintar(); }, function (e) {
        est.paso = 'elegir'; est.error = (e && e.message) || 'No se pudo leer el archivo.'; pintar();
      });
    }
    dr.el.addEventListener('change', function (ev) {
      if (ev.target.classList.contains('js-ci2-imp-arch')) { est.archivos = [].slice.call(ev.target.files || []); est.error = ''; pintar(); }
    });
    dr.el.addEventListener('click', function (ev) {
      if (ev.target.closest('.js-ci2-imp-revisar')) {
        if (!window.SigsoLectorXlsx || typeof DecompressionStream === 'undefined') { est.error = 'Este navegador no puede leer .xlsx: usa Chrome o Edge actualizados.'; pintar(); return; }
        procesar(true);
      } else if (ev.target.closest('.js-ci2-imp-volver')) { est.paso = 'elegir'; pintar(); }
      else if (ev.target.closest('.js-ci2-imp-ok')) {
        U.confirmar({ titulo: '¿Reemplazar e importar?', texto: 'Se borra lo que vino de planillas antes (incluida la carga anterior) y se carga todo de nuevo desde estos archivos. Lo ingresado a mano en SIGSO no se toca. Las liberaciones hechas sobre filas importadas se pierden.', boton: 'Reemplazar e importar', peligro: true }).then(function (ok) { if (ok) procesar(false); });
      } else if (ev.target.closest('.js-ci2-imp-fin')) { dr.cerrar(); cfg_ = null; vista_ = 'inicio'; cargar(); }
    });
    pintar();
  }

  // =========================================================================================
  // Eventos
  // =========================================================================================
  function mio(ev) { var c = document.getElementById('ci2'); return !!c && c.contains(ev.target); }
  document.addEventListener('click', function (ev) {
    if (!mio(ev)) return;
    var t = ev.target, b;
    if (editando_ && !t.closest('.ci2-c--editando')) cerrarEditor(true);
    if (t.closest('.js-ci2-recargar')) { cfg_ = null; cargar(); return; }
    if ((b = t.closest('.js-ci2-per'))) { cambiarPeriodo(Number(b.getAttribute('data-n'))); return; }
    if ((b = t.closest('[data-ci2-ir]'))) { irAItem(b.getAttribute('data-ci2-ir')); return; }
    if (t.closest('.js-ci2-importar')) { abrirImportar(); return; }
    // Matriz
    if ((b = t.closest('td.ci2-ed')) && !b.classList.contains('ci2-c--editando')) { abrirEditor(b); return; }
    if (t.closest('.js-ci2-nuevo')) { formFila(matriz(lista_.matriz), null); return; }
    if (t.closest('.js-ci2-excel')) { excelMatriz(); return; }
    if (t.closest('.js-ci2-informe')) { if (window.SigsoCIReportes) SigsoCIReportes.prefijar({ matriz: lista_.matriz, periodo: lista_.periodo || (mesFiltro_ || periodo_) }); irAItem('rep:informe'); return; }
    if (t.closest('.js-ci2-mas')) { mostrar_ += LOTE_FILAS; pintarMatriz(true); return; }
    if (t.closest('.js-ci2-abrir')) {
      var m = matriz(lista_.matriz);
      U.confirmar({ titulo: 'Abrir ' + perTexto(periodo_, true), texto: 'Se crean las filas de ' + m.nombre + ' con los clientes de ' + perTexto(lista_.periodo_anterior, true) + ' (y las columnas que se arrastran de un mes a otro). Lo que ya está en este mes no se duplica.', boton: 'Abrir el mes' }).then(function (ok) {
        if (ok) api('abrirPeriodoCI', { matriz: m.clave, periodo: periodo_ }).then(function (r) {
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
          PY.aviso(r.data.message, 'exito');
          abrirMatriz(m.clave, true);
        });
      });
      return;
    }
    if (t.closest('.js-ci2-ver')) { var tr = t.closest('tr[data-id]'); if (tr) formFila(matriz(lista_.matriz), registroDe(tr.getAttribute('data-id'))); return; }
    if (t.closest('.js-ci2-limpiar')) { f_ = { q: '', estado: '', resp: '', liberar: false, nuevos: false }; mostrar_ = LOTE_FILAS; pintarMatriz(true); return; }
    if (t.closest('.js-ci2-sinuso')) { verSinUso_ = !verSinUso_; pintarMatriz(true); return; }
    if (t.closest('.js-ci2-nuevos')) { f_.nuevos = !f_.nuevos; mostrar_ = LOTE_FILAS; pintarMatriz(true); return; }
    if ((b = t.closest('.js-ci2-alerta-fila'))) { var xr = registroDe(b.getAttribute('data-id')); if (xr) formFila(matriz(lista_.matriz), xr); return; }
    if ((b = t.closest('.js-ci2-alerta-usar'))) { usarValor(b); return; }
    if ((b = t.closest('.sx2-kpi--clic')) && b.getAttribute('data-filtro') === 'liberar') { f_.liberar = !f_.liberar; pintarMatriz(true); return; }
    if (t.closest('.js-ci2-desmarcar')) { sel_ = {}; pintarMatriz(true); return; }
    if ((b = t.closest('.js-ci2-lote'))) {
      var accion = b.getAttribute('data-accion'), n = marcados().length;
      if (accion === 'anular') {
        U.confirmar({ titulo: '¿Anular ' + n + (n === 1 ? ' fila?' : ' filas?'), texto: 'Dejan de contar en la matriz y en los reportes. Queda en el historial quién lo hizo.', boton: 'Anular', peligro: true }).then(function (ok) { if (ok) lote('anular'); });
      } else lote(accion);
      return;
    }
    if ((b = t.closest('.js-ci2-acc-editar'))) { formAccesos(b.getAttribute('data-depto')); return; }
  });
  document.addEventListener('change', function (ev) {
    if (!mio(ev)) return;
    var t = ev.target;
    if (t.classList.contains('js-ci2-sel')) { var id = t.closest('tr').getAttribute('data-id'); sel_[id] = t.checked; pintarMatriz(true); return; }
    if (t.classList.contains('js-ci2-todos')) { filtrados().slice(0, mostrar_).forEach(function (x) { sel_[x.registro_id] = t.checked; }); pintarMatriz(true); return; }
    if (t.classList.contains('js-ci2-f')) { f_[t.getAttribute('data-f')] = t.value; mostrar_ = LOTE_FILAS; pintarMatriz(true); return; }
    if (t.classList.contains('js-ci2-anio')) { anio_ = t.value; mesFiltro_ = ''; sel_ = {}; mostrar_ = LOTE_FILAS; abrirMatriz(lista_.matriz); return; }
    if (t.classList.contains('js-ci2-mes')) { mesFiltro_ = t.value; mostrar_ = LOTE_FILAS; pintarMatriz(true); }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!mio(ev) || !ev.target.classList.contains('js-ci2-q')) return;
    var v = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { f_.q = v; mostrar_ = LOTE_FILAS; pintarMatriz(true); var q = raiz().querySelector('.js-ci2-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 220);
  });
  // En la celda: Enter guarda y baja, Tab guarda y avanza, Esc cancela.
  document.addEventListener('keydown', function (ev) {
    if (!editando_ || !ev.target.classList || !ev.target.classList.contains('ci2-editor')) return;
    if (ev.key === 'Escape') { ev.preventDefault(); cerrarEditor(false); return; }
    if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') { ev.preventDefault(); cerrarEditor(true, 'abajo'); return; }
    if (ev.key === 'Tab') { ev.preventDefault(); cerrarEditor(true, ev.shiftKey ? 'izquierda' : 'derecha'); }
  });

  window.SigsoControlInterno = {
    cargar: cargar,
    refrescar: function () { if (!cfg_) cargar(); else mostrar(); },
    irAItem: irAItem
  };
})();
