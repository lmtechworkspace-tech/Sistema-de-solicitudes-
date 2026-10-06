/**
 * hompy-marcas-v2.js — Marcas colaboradoras y reporte mensual de Hompy
 * (Etapa 3, 2026-10-06; backend/logica/hompy.js).
 *
 *  - Marcas: tarjetas con su color, estado y cuántas colaboraciones,
 *    actividades y videos tienen. La ficha de cada marca muestra el contacto y
 *    una línea de tiempo con sus colaboraciones (lo que Hompy entregó y lo que
 *    se recibió), las actividades del calendario y los videos del Estudio.
 *  - Reporte mensual: cifras del mes contra el anterior, salidas, videos,
 *    colaboraciones, estado del traje y lo pendiente; PDF con la marca SIGSO.
 *
 * Usa lo que comparte el módulo principal (SigsoHompy._interno).
 */
(function () {
  'use strict';

  var U = UIv2;
  function H() { return window.SigsoHompy._interno; }
  function D() { return H().datos(); }
  function txt(v) { return H().txt(v); }
  var ESTADO_MARCA = { ACTIVA: ['Activa', 'ok'], CONVERSACION: ['En conversación', 'info'], PAUSADA: ['Pausada', 'alerta'], TERMINADA: ['Terminada', 'neutro'] };
  var TIPO_COLAB = { VIDEO: ['Video', 'camara'], EVENTO: ['Evento', 'ubicacion'], SORTEO: ['Sorteo', 'estrella'], CANJE: ['Canje', 'derivar'], AUSPICIO: ['Auspicio', 'dinero'], OTRO: ['Otro', 'caja'] };
  var ESTADO_COLAB = { PROPUESTA: ['Propuesta', 'neutro'], ACORDADA: ['Acordada', 'info'], EN_CURSO: ['En curso', 'primario'], REALIZADA: ['Realizada', 'ok'], CANCELADA: ['Cancelada', 'critico'] };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var filtro_ = 'TODAS', busca_ = '', periodo_ = '', reporte_ = null, turno_ = 0;

  function marcas() { return (D() && D().marcas) || []; }
  function colabs() { return (D() && D().colaboraciones) || []; }
  function marca(id) { return marcas().find(function (m) { return m.marca_id === id; }) || null; }
  function pesos(n) { return n == null || n === '' ? '—' : '$' + Math.round(n).toLocaleString('es-CL'); }
  function num(n) { return n == null ? '—' : Number(n).toLocaleString('es-CL'); }
  // Sigla corta (BCI) completa; si no, las iniciales de las dos primeras palabras.
  function iniciales(n) {
    var p = String(n || '?').trim().split(/\s+/).filter(Boolean);
    if (p.length === 1) return /^[A-ZÁÉÍÓÚÑ0-9]{2,4}$/.test(p[0]) ? p[0] : p[0].slice(0, 2).toUpperCase();
    return (p[0].charAt(0) + p[1].charAt(0)).toUpperCase();
  }
  function logo(m, tam) { return '<span class="hp2m-logo hp2-color-' + txt(m.color) + (tam ? ' hp2m-logo--' + tam : '') + '" aria-hidden="true">' + txt(iniciales(m.nombre)) + '</span>'; }
  function deMarca(id) {
    return {
      colabs: colabs().filter(function (c) { return c.marca_id === id; }),
      eventos: (D().eventos || []).filter(function (e) { return e.marca_id === id; }),
      videos: (D().ideas || []).filter(function (i) { return i.marca_id === id; })
    };
  }
  function ponerEn(lista, clave, obj) {
    var l = D()[lista], i = l.findIndex(function (x) { return x[clave] === obj[clave]; });
    if (i === -1) l.push(obj); else l[i] = obj;
  }
  function fechaCorta(f) { return f ? H().fechaCorta(f) : '—'; }
  function estrellas(n) { n = Number(n) || 0; return '<span class="hp2-estrellas-mini" aria-label="' + n + ' de 5">' + '★★★★★'.slice(0, n) + '<i>' + '★★★★★'.slice(n) + '</i></span>'; }

  // --- lista de marcas --------------------------------------------------------------------------
  function lista() {
    var l = marcas(), anio = D().hoy.slice(0, 4);
    var activas = l.filter(function (m) { return m.estado === 'ACTIVA'; }).length;
    var delAnio = colabs().filter(function (c) { return c.fecha_inicio.slice(0, 4) === anio && c.estado !== 'CANCELADA'; });
    var enCurso = colabs().filter(function (c) { return c.estado === 'EN_CURSO' || c.estado === 'ACORDADA'; }).length;
    var valor = delAnio.reduce(function (a, c) { return a + (Number(c.valor) || 0); }, 0);
    var q = busca_.trim().toLowerCase();
    var vis = l.filter(function (m) { return (filtro_ === 'TODAS' || m.estado === filtro_) && (!q || (m.nombre + ' ' + m.rubro).toLowerCase().indexOf(q) !== -1); });
    var kpis = '<div class="sx2-fila-kpis hp2-kpis">' +
      U.kpi({ etiqueta: 'Marcas activas', valor: activas, icono: 'megafono', i: 1 }) +
      U.kpi({ etiqueta: 'Colaboraciones en ' + anio, valor: delAnio.length, icono: 'estrella', i: 2 }) +
      U.kpi({ etiqueta: 'En curso o acordadas', valor: enCurso, icono: 'actividad', i: 3, tono: enCurso ? 'info' : '' }) +
      U.kpi({ etiqueta: 'Valor estimado ' + anio, valor: valor ? pesos(valor) : '—', icono: 'dinero', i: 4 }) + '</div>';
    var filtros = '<div class="hp2m-filtros sx2-entra">' +
      ['TODAS', 'ACTIVA', 'CONVERSACION', 'PAUSADA', 'TERMINADA'].map(function (k) {
        var n = k === 'TODAS' ? l.length : l.filter(function (m) { return m.estado === k; }).length;
        return U.chip({ texto: k === 'TODAS' ? 'Todas' : ESTADO_MARCA[k][0], n: n, activo: filtro_ === k, clase: 'js-hp2m-filtro', datos: { id: k } });
      }).join('') +
      '<label class="sx2-buscar hp2m-buscar">' + U.ico('lupa', 15) + '<input class="sx2-input js-hp2m-buscar" type="search" placeholder="Buscar marca o rubro" value="' + txt(busca_) + '" aria-label="Buscar marca"></label></div>';
    var tarjetas = vis.map(function (m, i) {
      var x = deMarca(m.marca_id), est = ESTADO_MARCA[m.estado];
      var ult = x.colabs.slice().sort(function (a, b) { return a.fecha_inicio < b.fecha_inicio ? 1 : -1; })[0];
      return '<button type="button" class="hp2m-card sx2-entra hp2-color-' + txt(m.color) + ' js-hp2m-abrir" data-id="' + txt(m.marca_id) + '" style="--i:' + i + '">' +
        '<span class="hp2m-card__banda" aria-hidden="true"></span>' +
        '<span class="hp2m-card__cab">' + logo(m) + '<span class="hp2m-card__t"><b>' + txt(m.nombre) + '</b><small>' + txt(m.rubro || 'Sin rubro') + '</small></span>' + U.badge(est[0], est[1]) + '</span>' +
        '<span class="hp2m-card__cifras"><span><b>' + x.colabs.length + '</b>colaboraciones</span><span><b>' + x.eventos.length + '</b>actividades</span><span><b>' + x.videos.length + '</b>videos</span></span>' +
        '<span class="hp2m-card__pie">' + (ult ? U.ico('reloj', 12) + 'Última: ' + txt(ult.titulo) + ' · ' + txt(fechaCorta(ult.fecha_inicio)) : U.ico('info', 12) + 'Sin colaboraciones todavía') + '</span>' +
      '</button>';
    }).join('');
    H().pagina(H().cabecera('Marcas colaboradoras', 'Con quién ha trabajado Hompy: qué entregamos, qué recibimos y qué salió de cada colaboración.',
      U.boton({ texto: 'Nueva marca', icono: 'nueva', variante: 'primario', clase: 'js-hp2m-nueva hp2-boton-hompy' })) +
      kpis + (l.length ? filtros + (vis.length ? '<div class="hp2m-grilla">' + tarjetas + '</div>' : U.card({ cuerpo: U.vacio({ icono: 'lupa', titulo: 'Ninguna marca coincide', texto: 'Prueba con otro filtro o búsqueda.' }) }))
        : U.card({ cuerpo: '<div class="hp2e-bienvenida"><img src="assets/hompy/hompy-cara.webp" alt="" width="64" height="64"><div><b>¿Con qué marcas hemos trabajado?</b><p>Registren la primera (por ejemplo, BCI) y sus colaboraciones: así queda la historia de Hompy con cada una.</p>' +
          U.boton({ texto: 'Registrar la primera marca', icono: 'nueva', variante: 'primario', sm: true, clase: 'js-hp2m-nueva hp2-boton-hompy' }) + '</div></div>' })));
  }

  // --- ficha de una marca -------------------------------------------------------------------------
  function ficha(id) {
    var m = marca(id);
    if (!m) { H().ir('marcas'); return; }
    var x = deMarca(id), est = ESTADO_MARCA[m.estado];
    var valor = x.colabs.filter(function (c) { return c.estado !== 'CANCELADA'; }).reduce(function (a, c) { return a + (Number(c.valor) || 0); }, 0);
    var salidas = (D().salidas || []);
    var publico = x.eventos.reduce(function (a, e) { var s = salidas.find(function (y) { return y.evento_id === e.evento_id && y.estado === 'CERRADO'; }); return a + (s ? Number(s.datos.publico) || 0 : 0); }, 0);
    var vistas = x.videos.reduce(function (a, v) { return a + (Number(v.publicacion.h24.vistas) || 0); }, 0);
    var tel = String(m.contacto_telefono || '').replace(/[^\d+]/g, '');
    var wa = tel.replace(/^\+/, '');
    if (wa && wa.length === 9 && wa.charAt(0) === '9') wa = '56' + wa;
    var contacto = (m.contacto_nombre || m.contacto_correo || m.contacto_telefono) ? '<div class="hp2m-contacto">' +
      '<span class="hp2m-contacto__quien">' + U.avatar({ nombre: m.contacto_nombre || m.nombre }, 'sm') + '<span><b>' + txt(m.contacto_nombre || 'Contacto') + '</b>' + (m.contacto_cargo ? '<small>' + txt(m.contacto_cargo) + '</small>' : '') + '</span></span>' +
      (m.contacto_correo ? '<a class="hp2m-contacto__a" href="mailto:' + txt(m.contacto_correo) + '">' + U.ico('correo', 14) + txt(m.contacto_correo) + '</a>' : '') +
      (tel ? '<a class="hp2m-contacto__a" href="tel:' + txt(tel) + '">' + U.ico('persona', 14) + txt(m.contacto_telefono) + '</a>' : '') +
      (wa.length >= 10 ? '<a class="hp2m-contacto__a" href="https://wa.me/' + txt(wa) + '" target="_blank" rel="noopener">' + U.ico('comentario', 14) + 'WhatsApp</a>' : '') +
      '</div>' : '';
    var heroe = '<section class="hp2m-heroe sx2-entra hp2-color-' + txt(m.color) + '">' +
      '<div class="hp2m-heroe__cab">' + logo(m, 'xl') + '<div class="hp2m-heroe__t"><span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(est[0], est[1]) + (m.rubro ? '<span class="hp2e-chip">' + txt(m.rubro) + '</span>' : '') + '</span>' +
        '<h1>' + txt(m.nombre) + '</h1>' + (m.sitio ? '<a class="hp2m-sitio" href="' + txt(m.sitio) + '" target="_blank" rel="noopener">' + U.ico('enlace', 13) + txt(m.sitio.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</a>' : '') + '</div>' +
        '<img class="hp2m-heroe__hompy" src="' + H().IMG + '" alt="" width="559" height="900"></div>' +
      contacto +
      '<div class="hp2m-heroe__cifras">' +
        '<div><span>Colaboraciones</span><b>' + x.colabs.length + '</b></div><div><span>Actividades</span><b>' + x.eventos.length + '</b></div>' +
        '<div><span>Público alcanzado</span><b>' + num(publico) + '</b></div><div><span>Vistas de videos</span><b>' + num(vistas) + '</b></div>' +
        '<div><span>Valor estimado</span><b>' + (valor ? pesos(valor) : '—') + '</b></div></div>' +
      (m.notas ? '<p class="hp2m-notas">' + U.ico('info', 13) + txt(m.notas) + '</p>' : '') +
    '</section>';

    // Línea de tiempo: colaboraciones, actividades y videos de la marca, del más nuevo al más antiguo.
    var items = x.colabs.map(function (c) { return { f: c.fecha_inicio, tipo: 'colab', o: c }; })
      .concat(x.eventos.map(function (e) { return { f: e.fecha, tipo: 'evento', o: e }; }))
      .concat(x.videos.map(function (v) { return { f: (v.publicacion.fecha || (v.fecha_creacion || '').slice(0, 10)), tipo: 'video', o: v }; }))
      .sort(function (a, b) { return a.f < b.f ? 1 : -1; });
    var linea = items.length ? '<ol class="hp2m-tiempo">' + items.map(function (it, i) {
      return '<li class="hp2m-tiempo__item hp2m-tiempo__item--' + it.tipo + ' sx2-entra" style="--i:' + i + '"><span class="hp2m-tiempo__punto">' + U.ico(it.tipo === 'colab' ? (TIPO_COLAB[it.o.tipo] || TIPO_COLAB.OTRO)[1] : it.tipo === 'evento' ? 'calendario' : 'camara', 14) + '</span>' +
        '<span class="hp2m-tiempo__fecha">' + txt(fechaCorta(it.f)) + '</span>' + (it.tipo === 'colab' ? colabHtml(it.o) : it.tipo === 'evento' ? eventoHtml(it.o) : videoHtml(it.o)) + '</li>';
    }).join('') + '</ol>'
      : U.vacio({ icono: 'estrella', titulo: 'Todavía no hay historia con ' + m.nombre, texto: 'Registren la primera colaboración. Las actividades y los videos que marquen con esta marca aparecerán aquí solos.' });

    H().pagina(H().cabecera(m.nombre, '', U.boton({ texto: 'Marcas', icono: 'izquierda', variante: 'fantasma', clase: 'js-hp2m-volver' }) +
      U.boton({ texto: 'Editar', icono: 'editar', clase: 'js-hp2m-editar', datos: { id: id } }) +
      U.boton({ texto: 'Nueva colaboración', icono: 'nueva', variante: 'primario', clase: 'js-hp2m-colab-nueva hp2-boton-hompy', datos: { id: id } })) +
      heroe + U.card({ titulo: 'Historia con ' + m.nombre, icono: 'reloj', sub: items.length + ' registro' + (items.length === 1 ? '' : 's'), cuerpo: linea, clase: 'hp2m-historia' }));
    var h1 = H().raiz().querySelector('.hp2-cab h1');
    if (h1) h1.parentNode.classList.add('sigso-oculto-visual'); // el nombre ya va grande en el héroe
  }
  function colabHtml(c) {
    var t = TIPO_COLAB[c.tipo] || TIPO_COLAB.OTRO, e = ESTADO_COLAB[c.estado];
    var enlaces = c.evento_ids.map(function (id) { var ev = (D().eventos || []).find(function (x) { return x.evento_id === id; }); return ev ? '<button type="button" class="hp2m-enlace js-hp2m-ev" data-id="' + txt(id) + '">' + U.ico('calendario', 12) + txt(ev.titulo) + '</button>' : ''; })
      .concat(c.idea_ids.map(function (id) { var v = (D().ideas || []).find(function (x) { return x.idea_id === id; }); return v ? '<button type="button" class="hp2m-enlace js-hp2m-idea" data-id="' + txt(id) + '">' + U.ico('camara', 12) + txt(v.titulo) + '</button>' : ''; })).join('');
    return '<article class="hp2m-colab">' +
      '<header><span class="hp2m-colab__tipo">' + U.ico(t[1], 13) + txt(t[0]) + '</span><b>' + txt(c.titulo) + '</b>' + U.badge(e[0], e[1]) +
        '<span class="hp2m-colab__acc">' + U.boton({ soloIcono: true, icono: 'editar', titulo: 'Editar colaboración', sm: true, variante: 'fantasma', clase: 'js-hp2m-colab-editar', datos: { id: c.colab_id } }) +
        U.boton({ soloIcono: true, icono: 'basura', titulo: 'Eliminar colaboración', sm: true, variante: 'fantasma', clase: 'js-hp2m-colab-borrar', datos: { id: c.colab_id } }) + '</span></header>' +
      '<p class="hp2m-colab__fechas">' + txt(fechaCorta(c.fecha_inicio)) + (c.fecha_fin && c.fecha_fin !== c.fecha_inicio ? ' → ' + txt(fechaCorta(c.fecha_fin)) : '') + (c.valor ? ' · Valor estimado ' + pesos(c.valor) : '') + (c.calificacion ? ' · ' + estrellas(c.calificacion) : '') + '</p>' +
      ((c.entregamos || c.recibimos) ? '<div class="hp2m-intercambio"><div><span>' + U.ico('subir', 12) + 'Hompy entregó</span><p>' + (c.entregamos ? txt(c.entregamos) : '<i>—</i>') + '</p></div>' +
        '<div><span>' + U.ico('descargar', 12) + 'Recibimos</span><p>' + (c.recibimos ? txt(c.recibimos) : '<i>—</i>') + '</p></div></div>' : '') +
      (c.resultado ? '<p class="hp2m-colab__res">' + U.ico('check', 13) + txt(c.resultado) + '</p>' : '') +
      (enlaces ? '<div class="hp2m-enlaces">' + enlaces + '</div>' : '') +
    '</article>';
  }
  function eventoHtml(e) {
    var t = H().tipo(e.tipo_id), s = (D().salidas || []).find(function (y) { return y.evento_id === e.evento_id && y.estado === 'CERRADO'; });
    return '<button type="button" class="hp2m-mini js-hp2m-ev" data-id="' + txt(e.evento_id) + '"><b>' + txt(e.titulo) + '</b><span>' + txt(t.nombre) + (e.lugar ? ' · ' + txt(e.lugar) : '') +
      (s && s.datos.publico != null ? ' · ' + num(s.datos.publico) + ' personas' : '') + (e.estado === 'CANCELADO' ? ' · cancelada' : '') + '</span></button>';
  }
  function videoHtml(v) {
    var nom = (D().catalogos.nombres_etapa || {})[v.etapa] || v.etapa;
    return '<button type="button" class="hp2m-mini js-hp2m-idea" data-id="' + txt(v.idea_id) + '"><b>' + txt(v.titulo) + '</b><span>Video · ' + txt(nom) +
      (v.publicacion.h24.vistas != null ? ' · ' + num(v.publicacion.h24.vistas) + ' vistas' : '') + '</span></button>';
  }

  // --- formularios -------------------------------------------------------------------------------
  function formularioMarca(m) {
    m = m || { color: (D().catalogos.colores || []).find(function (c) { return !marcas().some(function (x) { return x.color === c; }); }) || 'azul', estado: 'ACTIVA' };
    var campos = '<div class="hp2-form-fila">' + U.campo('Nombre de la marca', '<input class="sx2-input" name="nombre" maxlength="80" required value="' + txt(m.nombre || '') + '" placeholder="Ej.: BCI">') +
        U.campo('Rubro', '<input class="sx2-input" name="rubro" maxlength="80" value="' + txt(m.rubro || '') + '" placeholder="Ej.: Banca, Construcción…">') + '</div>' +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">Estado</span><div class="hp2e-radios">' + D().catalogos.estados_marca.map(function (k) {
        return '<label class="hp2e-radio"><input type="radio" name="estado" value="' + k + '"' + (m.estado === k ? ' checked' : '') + '><span>' + txt(ESTADO_MARCA[k][0]) + '</span></label>';
      }).join('') + '</div></div>' +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">Color en SIGSO</span><div class="hp2-colores" role="radiogroup" aria-label="Color">' + D().catalogos.colores.map(function (c) {
        return '<label class="hp2-color-op hp2-color-' + c + '"><input type="radio" name="color" value="' + c + '"' + (m.color === c ? ' checked' : '') + '><span></span><span class="sigso-oculto-visual">' + c + '</span></label>';
      }).join('') + '</div></div>' +
      '<div class="hp2-form-fila">' + U.campo('Contacto', '<input class="sx2-input" name="contacto_nombre" maxlength="80" value="' + txt(m.contacto_nombre || '') + '">') +
        U.campo('Cargo', '<input class="sx2-input" name="contacto_cargo" maxlength="80" value="' + txt(m.contacto_cargo || '') + '" placeholder="Ej.: Marketing">') + '</div>' +
      '<div class="hp2-form-fila">' + U.campo('Correo', '<input class="sx2-input" type="email" name="contacto_correo" maxlength="120" value="' + txt(m.contacto_correo || '') + '">') +
        U.campo('Teléfono', '<input class="sx2-input" type="tel" name="contacto_telefono" maxlength="30" value="' + txt(m.contacto_telefono || '') + '" placeholder="+56 9 …">') + '</div>' +
      U.campo('Sitio web', '<input class="sx2-input" type="url" name="sitio" maxlength="500" value="' + txt(m.sitio || '') + '" placeholder="https://…">') +
      U.campo('Notas', '<textarea class="sx2-input hp2-area" name="notas" rows="3" maxlength="1500" placeholder="Cómo llegamos a ellos, qué les interesa, acuerdos generales…">' + txt(m.notas || '') + '</textarea>') +
      (m.marca_id ? '<p class="hp2m-borrar-marca"><button type="button" class="sx2-enlace js-hp2m-borrar">' + U.ico('basura', 13) + 'Eliminar esta marca</button></p>' : '');
    var d = U.formulario({
      titulo: m.marca_id ? 'Editar marca' : 'Nueva marca', boton: 'Guardar', campos: campos, ancho: true,
      alMontar: function (form, dr) { dr.el.classList.add('hp2-drawer'); },
      enviar: function (datos, form) {
        datos.estado = (form.querySelector('input[name=estado]:checked') || {}).value;
        datos.color = (form.querySelector('input[name=color]:checked') || {}).value;
        if (m.marca_id) datos.marca_id = m.marca_id;
        return H().api('hompyGuardarMarca', datos);
      },
      aviso: m.marca_id ? 'Marca actualizada.' : '¡Marca registrada!',
      listo: function (r) { ponerEn('marcas', 'marca_id', r.data.marca); D().marcas.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); }); H().ir('marca', r.data.marca.marca_id); }
    });
    d.el.addEventListener('click', function (ev) {
      if (!ev.target.closest('.js-hp2m-borrar')) return;
      U.confirmar({ titulo: 'Eliminar «' + m.nombre + '»', texto: 'Solo se puede eliminar si no tiene colaboraciones, actividades ni videos. Si ya trabajaron juntos, déjenla como «Terminada».', boton: 'Eliminar', peligro: true }).then(function (si) {
        if (!si) return;
        H().api('hompyEliminarMarca', { marca_id: m.marca_id }).then(function (r) {
          if (!r || !r.ok) { H().aviso((r && r.message) || 'No se pudo eliminar.', 'error'); return; }
          D().marcas = marcas().filter(function (x) { return x.marca_id !== m.marca_id; });
          d.cerrar(); H().aviso('Marca eliminada.', 'exito'); H().ir('marcas');
        });
      });
    });
  }
  function formularioColab(marcaId, c) {
    c = c || { tipo: 'EVENTO', estado: 'ACORDADA', fecha_inicio: D().hoy, evento_ids: [], idea_ids: [] };
    var m = marca(marcaId || c.marca_id);
    var evs = (D().eventos || []).filter(function (e) { return e.marca_id === m.marca_id || c.evento_ids.indexOf(e.evento_id) !== -1; }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    var vids = (D().ideas || []).filter(function (i) { return i.marca_id === m.marca_id || c.idea_ids.indexOf(i.idea_id) !== -1; });
    var casillas = function (nombre, l, sel, etiq) {
      return l.length ? '<div class="hp2m-casillas">' + l.map(function (x) {
        var id = x.evento_id || x.idea_id;
        return '<label class="hp2-toggle"><input type="checkbox" name="' + nombre + '" value="' + txt(id) + '"' + (sel.indexOf(id) !== -1 ? ' checked' : '') + '><span>' + U.ico('check', 12) + txt(etiq(x)) + '</span></label>';
      }).join('') + '</div>' : '<p class="sx2-tenue hp2m-sin">Aún no hay ' + (nombre === 'evento_ids' ? 'actividades' : 'videos') + ' marcados con ' + txt(m.nombre) + '. Elijan la marca al agendar una actividad o en la idea del Estudio.</p>';
    };
    var campos = U.campo('¿Qué colaboración es?', '<input class="sx2-input" name="titulo" maxlength="120" required value="' + txt(c.titulo || '') + '" placeholder="Ej.: Activación en sucursales de octubre">') +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">Tipo</span><div class="hp2e-radios">' + D().catalogos.tipos_colab.map(function (k) {
        return '<label class="hp2e-radio"><input type="radio" name="tipo" value="' + k + '"' + (c.tipo === k ? ' checked' : '') + '><span>' + U.ico(TIPO_COLAB[k][1], 14) + txt(TIPO_COLAB[k][0]) + '</span></label>';
      }).join('') + '</div></div>' +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">Estado</span><div class="hp2e-radios">' + D().catalogos.estados_colab.map(function (k) {
        return '<label class="hp2e-radio"><input type="radio" name="estado" value="' + k + '"' + (c.estado === k ? ' checked' : '') + '><span>' + txt(ESTADO_COLAB[k][0]) + '</span></label>';
      }).join('') + '</div></div>' +
      '<div class="hp2-form-fila hp2-form-fila--3">' + U.campo('Desde', '<input class="sx2-input" type="date" name="fecha_inicio" required value="' + txt(c.fecha_inicio || '') + '">') +
        U.campo('Hasta (opcional)', '<input class="sx2-input" type="date" name="fecha_fin" value="' + txt(c.fecha_fin || '') + '">') +
        U.campo('Valor estimado ($)', '<input class="sx2-input" type="number" min="0" inputmode="numeric" name="valor" value="' + (c.valor == null ? '' : txt(c.valor)) + '">', 'Lo que vale lo recibido (canje, auspicio).') + '</div>' +
      '<div class="hp2-form-fila">' + U.campo('Hompy entregó', '<textarea class="sx2-input hp2-area" name="entregamos" rows="3" maxlength="1500" placeholder="Ej.: Hompy en 3 sucursales, 2 videos para sus redes">' + txt(c.entregamos || '') + '</textarea>') +
        U.campo('Recibimos', '<textarea class="sx2-input hp2-area" name="recibimos" rows="3" maxlength="1500" placeholder="Ej.: merchandising, difusión en su Instagram, pago">' + txt(c.recibimos || '') + '</textarea>') + '</div>' +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">Actividades de esta colaboración</span>' + casillas('evento_ids', evs, c.evento_ids, function (e) { return H().fechaCorta(e.fecha) + ' · ' + e.titulo; }) + '</div>' +
      '<div class="hp2-campo-grupo"><span class="sx2-campo__et">Videos de esta colaboración</span>' + casillas('idea_ids', vids, c.idea_ids, function (v) { return v.titulo; }) + '</div>' +
      U.campo('Resultado', '<textarea class="sx2-input hp2-area" name="resultado" rows="2" maxlength="1500" placeholder="Cómo resultó, si se repite, qué dijo la marca">' + txt(c.resultado || '') + '</textarea>') +
      '<fieldset class="hp2-estrellas"><legend>¿Cómo resultó? (opcional)</legend><div class="hp2-estrellas__fila">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<label class="hp2-estrella"><input type="radio" name="calificacion" value="' + n + '"' + (Number(c.calificacion) === n ? ' checked' : '') + '><span aria-hidden="true">★</span><span class="sigso-oculto-visual">' + n + ' de 5</span></label>';
      }).join('') + '</div></fieldset>';
    U.formulario({
      titulo: (c.colab_id ? 'Editar colaboración' : 'Nueva colaboración') + ' con ' + m.nombre, boton: 'Guardar', campos: campos, ancho: true,
      alMontar: function (form, dr) { dr.el.classList.add('hp2-drawer'); },
      enviar: function (datos, form) {
        var val = function (n) { return (form.querySelector('input[name=' + n + ']:checked') || {}).value || ''; };
        datos.tipo = val('tipo'); datos.estado = val('estado'); datos.calificacion = val('calificacion');
        datos.evento_ids = Array.prototype.map.call(form.querySelectorAll('input[name=evento_ids]:checked'), function (i) { return i.value; });
        datos.idea_ids = Array.prototype.map.call(form.querySelectorAll('input[name=idea_ids]:checked'), function (i) { return i.value; });
        datos.marca_id = m.marca_id;
        if (c.colab_id) datos.colab_id = c.colab_id;
        return H().api('hompyGuardarColaboracion', datos);
      },
      aviso: c.colab_id ? 'Colaboración actualizada.' : '¡Colaboración registrada!',
      listo: function (r) { ponerEn('colaboraciones', 'colab_id', r.data.colaboracion); ficha(m.marca_id); }
    });
  }
  /** Selector de marca para el formulario de actividades y la idea del Estudio. */
  function selector(nombre, actual) {
    var l = marcas().filter(function (m) { return m.estado !== 'TERMINADA' || m.marca_id === actual; });
    return '<select class="sx2-select" name="' + (nombre || 'marca_id') + '"><option value="">Sin marca</option>' + l.map(function (m) {
      return '<option value="' + txt(m.marca_id) + '"' + (m.marca_id === actual ? ' selected' : '') + '>' + txt(m.nombre) + '</option>';
    }).join('') + '</select>';
  }
  function chip(id) { var m = marca(id); return m ? '<button type="button" class="hp2m-chip hp2-color-' + txt(m.color) + ' js-hp2m-abrir" data-id="' + txt(m.marca_id) + '">' + logo(m, 'xs') + txt(m.nombre) + '</button>' : ''; }

  // --- reporte mensual ----------------------------------------------------------------------------
  function nombreMes(p) { var a = p.split('-'); return MESES[Number(a[1]) - 1] + ' ' + a[0]; }
  function moverPeriodo(p, d) { var a = Number(p.slice(0, 4)), m = Number(p.slice(5, 7)) - 1 + d; return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 7); }
  function mensual(p) {
    periodo_ = p || periodo_ || D().hoy.slice(0, 7);
    var t = ++turno_;
    H().pagina(cabMensual() + U.esqueleto('kpis', 6) + U.esqueleto('tarjetas', 3));
    H().api('hompyReporteMensual', { periodo: periodo_ }).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { H().pagina(cabMensual() + U.card({ cuerpo: U.vacio({ icono: 'grafico', titulo: 'No se pudo armar el reporte', texto: (r && r.message) || 'Inténtalo de nuevo.' }) })); return; }
      reporte_ = r.data; pintarMensual();
    });
  }
  function cabMensual() {
    var p = periodo_, hoyP = D().hoy.slice(0, 7);
    return H().cabecera('Reporte mensual', 'Lo que hizo Hompy en el mes: salidas, público, videos y marcas, comparado con el mes anterior.',
      '<span class="hp2m-mes">' + U.boton({ soloIcono: true, icono: 'izquierda', titulo: 'Mes anterior', variante: 'fantasma', clase: 'js-hp2m-mes', datos: { d: -1 } }) +
        '<b>' + txt(nombreMes(p)) + '</b>' + U.boton({ soloIcono: true, icono: 'derecha', titulo: 'Mes siguiente', variante: 'fantasma', clase: 'js-hp2m-mes', datos: { d: 1 }, deshabilitado: p >= hoyP }) + '</span>' +
      U.boton({ texto: 'Descargar PDF', icono: 'descargar', variante: 'primario', clase: 'js-hp2m-pdf hp2-boton-hompy' }));
  }
  function tend(k) {
    var d = reporte_.kpis[k], dif = Math.round(((d.actual || 0) - (d.anterior || 0)) * 10) / 10;
    if (!d.anterior && !d.actual) return null;
    return { texto: dif === 0 ? 'igual que ' + reporte_.anterior.split(' de ')[0] : (dif > 0 ? '+' : '') + dif.toLocaleString('es-CL') + ' vs. ' + reporte_.anterior.split(' de ')[0], tono: dif > 0 ? 'ok' : dif < 0 ? 'alerta' : 'neutro', icono: dif > 0 ? 'tendencia' : dif < 0 ? 'tendenciaBaja' : '' };
  }
  function pintarMensual() {
    var r = reporte_, k = r.kpis;
    var kpis = '<div class="sx2-fila-kpis hp2-kpis hp2m-kpis">' +
      U.kpi({ etiqueta: 'Actividades', valor: k.actividades.actual, icono: 'calendario', i: 1, tendencia: tend('actividades') }) +
      U.kpi({ etiqueta: 'Salidas con reporte', valor: k.salidas.actual, icono: 'ubicacion', i: 2, tendencia: tend('salidas') }) +
      U.kpi({ etiqueta: 'Público alcanzado', valor: k.publico.actual, icono: 'equipo', i: 3, tendencia: tend('publico') }) +
      U.kpi({ etiqueta: 'Horas en terreno', valor: k.horas.actual, icono: 'reloj', i: 4, tendencia: tend('horas') }) +
      U.kpi({ etiqueta: 'Videos publicados', valor: k.videos.actual, icono: 'camara', i: 5, tendencia: tend('videos') }) +
      U.kpi({ etiqueta: 'Vistas (24 h)', valor: k.vistas.actual, icono: 'ojo', i: 6, tendencia: tend('vistas') }) + '</div>';
    var avisos = [];
    if (r.pendientes.length) avisos.push('<li class="sx2-tono-alerta">' + U.ico('portapapeles', 15) + '<span><b>' + r.pendientes.length + ' actividad' + (r.pendientes.length === 1 ? '' : 'es') + ' sin reporte cerrado:</b> ' + r.pendientes.map(function (p) { return '<button type="button" class="sx2-enlace js-hp2m-rep" data-id="' + txt(p.evento_id) + '">' + txt(p.titulo) + '</button>'; }).join(', ') + '</span></li>');
    if (r.traje && r.traje.estado !== 'BUENO') avisos.push('<li class="sx2-tono-' + (r.traje.estado === 'REPARACION' ? 'critico' : 'alerta') + '">' + U.ico('casco', 15) + '<span><b>El traje: ' + txt(r.traje.texto.toLowerCase()) + '</b> (último reporte, ' + txt(H().fechaCorta(r.traje.fecha)) + ')' + (r.traje.nota ? ': ' + txt(r.traje.nota) : '') + '</span></li>');
    var resumen = '<div class="hp2m-resumen sx2-entra">' +
      '<img src="assets/hompy/hompy-cara.webp" alt="" width="56" height="56"><p>En <b>' + txt(r.nombre) + '</b> Hompy tuvo <b>' + k.actividades.actual + '</b> actividad' + (k.actividades.actual === 1 ? '' : 'es') + ', llegó a <b>' + num(k.publico.actual) + '</b> personas' +
      (k.calificacion != null ? ' con una evaluación promedio de <b>' + String(k.calificacion).replace('.', ',') + '</b>' : '') + ' y se publicaron <b>' + k.videos.actual + '</b> video' + (k.videos.actual === 1 ? '' : 's') +
      (k.colaboraciones ? '. Hubo <b>' + k.colaboraciones + '</b> ' + (k.colaboraciones === 1 ? 'colaboración vigente' : 'colaboraciones vigentes') + ' con marcas' : '') + '.</p></div>';
    var otros = '<div class="hp2m-otros">' + [
      ['Evaluación promedio', k.calificacion == null ? '—' : String(k.calificacion).replace('.', ',') + ' / 5', 'estrella'], ['Minutos en el traje', num(k.minutos_traje), 'casco'],
      ['Interacción promedio', k.interaccion == null ? '—' : String(k.interaccion).replace('.', ',') + ' %', 'comentario'], ['Gastos de salidas', pesos(k.gastos), 'dinero'],
      ['Canceladas', num(k.canceladas), 'equis'], ['Ideas nuevas', num(k.ideas_nuevas), 'bombilla']
    ].map(function (o) { return '<div><span>' + U.ico(o[2], 14) + txt(o[0]) + '</span><b>' + txt(o[1]) + '</b></div>'; }).join('') + '</div>';
    var total = r.por_tipo.reduce(function (a, x) { return a + x.n; }, 0);
    var tipos = total ? '<div class="hp2m-barra" role="img" aria-label="Actividades por tipo">' + r.por_tipo.map(function (x) { return '<span class="hp2-color-' + txt(x.color) + '" style="flex:' + x.n + '" title="' + txt(x.nombre + ': ' + x.n) + '"></span>'; }).join('') + '</div>' +
      '<ul class="hp2m-leyenda">' + r.por_tipo.map(function (x) { return '<li class="hp2-color-' + txt(x.color) + '"><i></i>' + txt(x.nombre) + ' <b>' + x.n + '</b></li>'; }).join('') + '</ul>' : '<p class="sx2-tenue">Sin actividades este mes.</p>';
    var tabla = function (cab, filas, vacio) {
      return filas.length ? '<div class="hp2-tabla-cont"><table class="hp2-tabla"><thead><tr>' + cab.map(function (c) { return '<th' + (c.charAt(0) === '#' ? ' class="hp2-num"' : '') + '>' + txt(c.replace(/^#/, '')) + '</th>'; }).join('') + '</tr></thead><tbody>' + filas.join('') + '</tbody></table></div>' : '<p class="sx2-tenue">' + txt(vacio) + '</p>';
    };
    var salidas = tabla(['Fecha', 'Actividad', 'Marca', '#Público', 'Traje', 'Evaluación'], r.salidas.map(function (s) {
      return '<tr><td>' + txt(H().fechaCorta(s.fecha)) + '</td><td><button type="button" class="hp2-enlace-ev js-hp2m-rep" data-id="' + txt(s.evento_id) + '"><b>' + txt(s.titulo) + '</b></button><div class="hp2-fila__meta">' + txt(s.tipo + (s.lugar ? ' · ' + s.lugar : '')) + '</div></td>' +
        '<td>' + txt(s.marca || '—') + '</td><td class="hp2-num">' + num(s.publico) + '</td><td>' + txt(s.traje || '—') + (s.minutos_traje ? '<div class="hp2-fila__meta">' + s.minutos_traje + ' min</div>' : '') + '</td><td>' + estrellas(s.calificacion) + '</td></tr>';
    }), 'No hubo salidas con reporte cerrado este mes.');
    var videos = tabla(['Fecha', 'Video', 'Marca', '#Vistas 24 h', '#Vistas 7 días', '#Interacción'], r.videos.map(function (v) {
      return '<tr><td>' + txt(v.fecha ? H().fechaCorta(v.fecha) : '—') + '</td><td><button type="button" class="hp2-enlace-ev js-hp2m-idea" data-id="' + txt(v.idea_id) + '"><b>' + txt(v.titulo) + '</b></button></td><td>' + txt(v.marca || '—') + '</td>' +
        '<td class="hp2-num">' + num(v.vistas24) + '</td><td class="hp2-num">' + num(v.vistas7) + '</td><td class="hp2-num">' + (v.interaccion == null ? '—' : v.interaccion.toFixed(1).replace('.', ',') + ' %') + '</td></tr>';
    }), 'No se publicaron videos este mes.');
    var cols = r.colaboraciones.length ? '<ul class="hp2-lista">' + r.colaboraciones.map(function (c) {
      var m = marcas().find(function (x) { return x.nombre === c.marca; }), e = ESTADO_COLAB[c.estado] || ESTADO_COLAB.PROPUESTA, t = TIPO_COLAB[c.tipo] || TIPO_COLAB.OTRO;
      return '<li class="hp2m-col-fila">' + (m ? logo(m, 'sm') : '') + '<span class="hp2-fila__txt"><b>' + txt(c.titulo) + '</b><span class="hp2-fila__meta">' + txt(c.marca) + ' · ' + U.ico(t[1], 12) + txt(t[0]) + (c.valor ? ' · ' + pesos(c.valor) : '') + '</span></span>' + U.badge(e[0], e[1]) + '</li>';
    }).join('') + '</ul>' : '<p class="sx2-tenue">Sin colaboraciones vigentes este mes.</p>';
    var estudio = '<ol class="hp2e-embudo hp2e-embudo--mini">' + r.estudio.map(function (e) {
      var c = { IDEA: 'ambar', DIALOGO: 'azul', GUION: 'violeta', PRODUCCION: 'rosa', PUBLICADO: 'verde' }[e.etapa];
      return '<li class="hp2-color-' + c + '"><span><b>' + e.n + '</b>' + txt(e.nombre) + '</span></li>';
    }).join('') + '</ol>';
    H().pagina(cabMensual() + resumen + kpis + (avisos.length ? '<ul class="hp2m-avisos sx2-entra">' + avisos.join('') + '</ul>' : '') +
      '<div class="sx2-grid hp2-dos"><div class="sx2-col-7">' + U.card({ titulo: 'Más datos del mes', icono: 'grafico', cuerpo: otros, i: 7 }) + '</div>' +
        '<div class="sx2-col-5">' + U.card({ titulo: 'Actividades por tipo', icono: 'calendario', cuerpo: tipos, i: 8 }) + '</div></div>' +
      U.card({ titulo: 'Salidas a terreno', icono: 'ubicacion', sub: String(r.salidas.length), cuerpo: salidas, i: 9 }) +
      '<div class="sx2-grid hp2-dos"><div class="sx2-col-7">' + U.card({ titulo: 'Videos publicados', icono: 'camara', sub: String(r.videos.length), cuerpo: videos, i: 10 }) + '</div>' +
        '<div class="sx2-col-5">' + U.card({ titulo: 'Marcas y colaboraciones', icono: 'megafono', cuerpo: cols, i: 11 }) + '</div></div>' +
      U.card({ titulo: 'Estudio TikTok hoy', icono: 'bombilla', cuerpo: estudio, i: 12 }));
  }
  function pdf(b) {
    var t = b.innerHTML; b.disabled = true; b.innerHTML = 'Generando…';
    H().api('hompyPdfMensual', { periodo: periodo_ }).then(function (r) {
      b.disabled = false; b.innerHTML = t;
      if (r && r.ok && r.data && r.data.pdf_base64) H().descargarBase64(r.data.pdf_base64, r.data.filename || 'Hompy-reporte.pdf', 'application/pdf');
      else H().aviso((r && r.message) || 'No se pudo generar el PDF.', 'error');
    });
  }

  // --- portada --------------------------------------------------------------------------------------
  function tarjetaPortada() {
    var l = marcas(), ult = colabs().filter(function (c) { return c.estado !== 'CANCELADA'; }).sort(function (a, b) { return a.fecha_inicio < b.fecha_inicio ? 1 : -1; })[0];
    var m = ult && marca(ult.marca_id);
    return '<section class="hp2m-portada sx2-entra" style="--i:8">' +
      '<button type="button" class="hp2m-portada__op js-hp2-ir" data-ir="marcas"><span class="hp2e-portada__ico hp2m-portada__ico">' + U.ico('megafono', 18) + '</span><span><b>Marcas colaboradoras</b><small>' +
        (l.length ? (function (n) { return n + (n === 1 ? ' activa' : ' activas'); })(l.filter(function (x) { return x.estado === 'ACTIVA'; }).length) + (m ? ' · última: ' + txt(m.nombre) + ', ' + txt(ult.titulo) : '') : 'Registren la primera (por ejemplo, BCI)') + '</small></span>' + U.ico('derecha', 16) + '</button>' +
      '<button type="button" class="hp2m-portada__op js-hp2-ir" data-ir="reportes"><span class="hp2e-portada__ico hp2m-portada__ico hp2m-portada__ico--rep">' + U.ico('grafico', 18) + '</span><span><b>Reporte del mes</b><small>Salidas, público, videos y marcas, con PDF</small></span>' + U.ico('derecha', 16) + '</button>' +
    '</section>';
  }

  // --- eventos ----------------------------------------------------------------------------------------
  function dentro(ev) { var r = H().raiz && H().raiz(); return r && r.contains(ev.target); }
  document.addEventListener('click', function (ev) {
    if (!window.SigsoHompy) return;
    var b = ev.target.closest('button');
    if (!b || !b.className || String(b.className).indexOf('js-hp2m-') === -1) return;
    if (!dentro(ev) && !b.closest('.hp2-drawer')) return;
    var cl = b.classList, id = b.getAttribute('data-id');
    if (cl.contains('js-hp2m-abrir')) { var dr = b.closest('.sx2-drawer'); if (dr) { var x = dr.querySelector('.js-sx2-drawer-cerrar'); if (x) x.click(); } H().ir('marca', id); }
    else if (cl.contains('js-hp2m-nueva')) formularioMarca(null);
    else if (cl.contains('js-hp2m-editar')) formularioMarca(marca(id));
    else if (cl.contains('js-hp2m-volver')) H().ir('marcas');
    else if (cl.contains('js-hp2m-filtro')) { filtro_ = id; lista(); }
    else if (cl.contains('js-hp2m-colab-nueva')) formularioColab(id, null);
    else if (cl.contains('js-hp2m-colab-editar')) { var c = colabs().find(function (x) { return x.colab_id === id; }); if (c) formularioColab(c.marca_id, JSON.parse(JSON.stringify(c))); }
    else if (cl.contains('js-hp2m-colab-borrar')) {
      var c2 = colabs().find(function (x) { return x.colab_id === id; });
      U.confirmar({ titulo: 'Eliminar «' + c2.titulo + '»', texto: 'Se quita del historial de la marca. Si no se concretó, mejor márquenla como «Cancelada».', boton: 'Eliminar', peligro: true }).then(function (si) {
        if (!si) return;
        H().api('hompyEliminarColaboracion', { colab_id: id }).then(function (r) {
          if (!r || !r.ok) { H().aviso((r && r.message) || 'No se pudo eliminar.', 'error'); return; }
          D().colaboraciones = colabs().filter(function (x) { return x.colab_id !== id; });
          H().aviso('Colaboración eliminada.', 'exito'); ficha(c2.marca_id);
        });
      });
    }
    else if (cl.contains('js-hp2m-ev')) H().abrirEvento(id);
    else if (cl.contains('js-hp2m-idea')) H().ir('idea', id);
    else if (cl.contains('js-hp2m-rep')) H().ir('salida', id);
    else if (cl.contains('js-hp2m-mes')) mensual(moverPeriodo(periodo_, Number(b.getAttribute('data-d'))));
    else if (cl.contains('js-hp2m-pdf')) pdf(b);
  });
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-hp2m-buscar')) return;
    busca_ = ev.target.value;
    var pos = ev.target.selectionStart;
    lista();
    var i = H().raiz().querySelector('.js-hp2m-buscar');
    if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) { /* */ } }
  });

  window.SigsoHompyMarcas = { lista: lista, ficha: ficha, mensual: mensual, selector: selector, chip: chip, tarjetaPortada: tarjetaPortada, marca: marca };
})();
