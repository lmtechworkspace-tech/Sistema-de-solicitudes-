/**
 * calidad-personas-v2.js — Calidad: Personas v2 (SIGSO v2, Módulo 8C;
 * análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 *  - Lista con el estado de cada persona (inducción, evaluación, formación)
 *    y panel lateral con su resumen; la inducción se registra ahí mismo.
 *  - Pestaña "Inducciones": matriz personas × 5 ítems para registrar EN LOTE
 *    las inducciones que se hicieron y nunca se registraron (decisión del
 *    dueño). Fecha: la de ingreso de cada persona por defecto, o una común;
 *    nunca futura. El Encargado SGC registra a todos; cada jefatura, a su
 *    equipo (backend getPanelPersonasSgc / registrarInduccionesEnLoteSgc).
 *  - "Requiere capacitación" se muestra según la regla (promedio < 3), con
 *    aviso cuando lo importado no coincide (decisión del dueño).
 *  - Descriptor, carpeta y evaluación se editan en la ficha completa de
 *    siempre (SigsoCalidad.abrirFicha).
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var ALERTA = {
    induccion: ['Inducción pendiente', 'alerta'],
    sin_evaluacion: ['Sin evaluación', 'alerta'],
    evaluacion_sin_fecha: ['Evaluación sin fecha', 'neutro'],
    evaluacion_vencida: ['Evaluación vencida', 'critico'],
    requiere_capacitacion: ['Requiere capacitación', 'critico'],
    sin_descriptor: ['Sin descriptor', 'alerta']
  };
  var datos_ = null, turno_ = 0, tab_ = 'lista', q_ = '', filtro_ = '', soloPend_ = true;
  var modoFecha_ = 'ingreso', fechaComun_ = '', sel_ = {};

  function C() { return window.SigsoCalidadV2.util; }
  function api(a, d) { return C().api(a, d); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function clave(f) { var k = String(f || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : ''; }
  function fechaDe(p) {
    if (modoFecha_ === 'comun') return fechaComun_ || datos_.hoy;
    var k = clave(p.fecha_ingreso);
    return k && k <= datos_.hoy ? k : datos_.hoy;
  }
  function fmt(k) { return k ? k.slice(8, 10) + '/' + k.slice(5, 7) + '/' + k.slice(0, 4) : ''; }
  function persona(p) { return PY.persona(p.usuario_email, p.nombre); }
  function nombreDe(email) { return email ? PY.persona(email).nombre : ''; }
  function sk(pid, item) { return pid + '|' + item; }
  function nSel() { return Object.keys(sel_).filter(function (k) { return sel_[k]; }).length; }

  // --- Carga ---------------------------------------------------------------------------
  function mostrar() { cargar(!!datos_ && C().ocupa('personas')); }
  function refrescar() { if (C().ocupa('personas')) cargar(true); }

  function cargar(silencioso) {
    var c = C().contenedor('personas');
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !datos_) c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 6) + '</div>';
    api('getPanelPersonasSgc', {}).then(function (r) {
      if (t !== turno_ || !C().ocupa('personas')) return;
      if (!r || !r.ok) {
        c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar Personas',
          texto: (r && r.message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-pc2-recargar' }) }) }) + '</div>';
        return;
      }
      datos_ = r.data;
      if (window.SigsoCalidad && SigsoCalidad.usarSecciones) SigsoCalidad.usarSecciones(datos_.secciones_visibles);
      // Quien solo se ve a sí mismo (operativo) va directo a su ficha, como siempre.
      if (!datos_.puede_gestionar && !datos_.puede_registrar_alguna && datos_.personas.length === 1 && window.SigsoCalidad) {
        SigsoCalidad.abrirFicha(datos_.personas[0].persona_id, true);
        return;
      }
      if (!datos_.puede_registrar_alguna) tab_ = 'lista';
      pintar(!!silencioso);
      var correos = [];
      datos_.personas.forEach(function (p) {
        correos.push(p.usuario_email, p.jefatura_email);
        p.induccion.forEach(function (i) { if (i.relator_email) correos.push(i.relator_email); });
      });
      correos = correos.filter(Boolean);
      Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve(), U.precargarFotos(correos)])
        .then(function () { if (t === turno_) pintar(true); });
    });
  }

  // --- Pintado --------------------------------------------------------------------------
  function cabecera() {
    var g = datos_ && datos_.puede_gestionar;
    return '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · ISO 9001</span><h1>Personas</h1>' +
        '<span class="sx2-tenue" style="font-size:.875rem">Competencia y toma de conciencia (7.2 y 7.3): inducción, evaluación y formación de cada persona.</span></div>' +
      (g && window.SigsoCalidad && SigsoCalidad.formularioPersona ? '<div class="sx2-cabecera__acciones">' + U.boton({ texto: 'Agregar persona', icono: 'mas', variante: 'primario', clase: 'js-pc2-nueva' }) + '</div>' : '') +
    '</header>';
  }

  function pintar(silencioso) {
    var c = document.getElementById('calidad-v2');
    if (!c || !datos_ || !C().ocupa('personas')) return;
    var y = window.scrollY;
    var foco = document.activeElement && document.activeElement.classList.contains('js-pc2-q');
    // Pendientes que ESTA persona puede registrar (la jefatura, solo su equipo).
    var misPend = datos_.personas.reduce(function (s, p) { return s + (p.puede_registrar_induccion ? p.induccion_pendientes : 0); }, 0);
    var h = '<div class="sx2-pagina">' + cabecera() +
      (datos_.puede_registrar_alguna ? '<div class="dc2-tabs sx2-entra">' + U.segmento([{ id: 'lista', texto: 'Personas', icono: 'equipo' },
        { id: 'induccion', texto: 'Inducciones' + (misPend ? ' · ' + misPend + ' pendientes' : ''), icono: 'check' }], tab_, 'js-pc2-tab') + '</div>' : '') +
      (tab_ === 'induccion' ? vistaInduccion() : vistaLista()) + '</div>';
    c.innerHTML = h;
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    if (foco) { var q = c.querySelector('.js-pc2-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    U.animar(c);
  }

  function vistaLista() {
    var r = datos_.resumen, n = r.personas || 0;
    var cumplenHoras = datos_.personas.filter(function (p) { return p.horas_formacion_anio >= 5; }).length;
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ etiqueta: 'Inducción completa', valor: r.induccion_completa, unidad: 'de ' + n, icono: 'check', tono: r.induccion_completa === n ? 'ok' : 'alerta', progreso: n ? r.induccion_completa * 100 / n : 0, i: 2, filtro: 'induccion', activo: filtro_ === 'induccion' }) +
      U.kpi({ etiqueta: 'Sin evaluación o sin fecha', valor: r.sin_evaluacion + r.evaluacion_sin_fecha, icono: 'reloj', tono: (r.sin_evaluacion + r.evaluacion_sin_fecha) ? 'alerta' : 'ok', i: 3, filtro: 'evaluacion', activo: filtro_ === 'evaluacion' }) +
      U.kpi({ etiqueta: 'Requiere capacitación', valor: r.requiere_capacitacion, icono: 'alerta', tono: r.requiere_capacitacion ? 'critico' : 'ok', i: 4, filtro: 'requiere_capacitacion', activo: filtro_ === 'requiere_capacitacion', titulo: 'Promedio de la última evaluación menor a 3' }) +
      U.kpi({ etiqueta: 'Formación ≥ 5 h este año', valor: cumplenHoras, unidad: 'de ' + n, icono: 'tendencia', tono: cumplenHoras === n ? 'ok' : 'info', i: 5 }) + '</div>';
    var aviso = datos_.puede_gestionar && r.evaluaciones_difieren
      ? '<p class="nv2-acuse sx2-tono-info sx2-entra" style="margin:0 0 var(--sx-e-4)">' + U.ico('info', 15) +
        r.evaluaciones_difieren + (r.evaluaciones_difieren === 1 ? ' evaluación importada dice' : ' evaluaciones importadas dicen') +
        ' "requiere capacitación" aunque el promedio es 3 o más. Aquí se muestra según la regla (promedio menor a 3); si alguien sí la necesita, regístralo al volver a evaluar.</p>' : '';
    var lista = filtrados();
    return kpis + aviso +
      '<div class="dc2-barra sx2-entra"><label class="dc2-buscar">' + U.ico('lupa', 16) +
        '<input type="search" class="js-pc2-q" placeholder="Buscar por nombre, cargo o área…" value="' + U.esc(q_) + '" aria-label="Buscar una persona"></label>' +
        (filtro_ || q_ ? U.boton({ texto: 'Limpiar', sm: true, variante: 'fantasma', clase: 'js-pc2-limpiar' }) : '') + '</div>' +
      U.card({ sinRelleno: true, i: 6, cuerpo: lista.length ? '<ul class="dc2-lista">' + lista.map(filaPersona).join('') + '</ul>'
        : U.vacio({ icono: 'lupa', titulo: 'Nadie coincide', texto: 'Prueba con otra palabra o limpia el filtro.' }) });
  }

  function filtrados() {
    var palabras = norm(q_).split(/\s+/).filter(Boolean);
    return datos_.personas.filter(function (p) {
      if (filtro_ === 'induccion' && !p.induccion_pendientes) return false;
      if (filtro_ === 'evaluacion' && !(p.alertas.indexOf('sin_evaluacion') !== -1 || p.alertas.indexOf('evaluacion_sin_fecha') !== -1)) return false;
      if (filtro_ === 'requiere_capacitacion' && p.alertas.indexOf('requiere_capacitacion') === -1) return false;
      if (!palabras.length) return true;
      var heno = norm([persona(p).nombre, p.cargo, p.area_id, p.usuario_email].join(' '));
      return palabras.every(function (w) { return heno.indexOf(w) !== -1; });
    });
  }

  function filaPersona(p) {
    var hechas = 5 - p.induccion_pendientes;
    var ev = p.evaluacion;
    return '<li class="dc2-fila pc2-fila" data-pc2="' + U.esc(p.persona_id) + '" tabindex="0">' +
      U.avatar(persona(p)) +
      '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(persona(p).nombre) + '</strong>' +
        '<span class="dc2-fila__meta"><span>' + U.esc(p.cargo || '—') + '</span>' + (p.area_id ? '<span>' + U.esc(p.area_id) + '</span>' : '') +
          (p.tipo === 'EXT' ? '<span>Externo</span>' : '') + '</span></span>' +
      '<span class="pc2-induccion" title="Inducción: ' + hechas + ' de 5 ítems"><span class="sx2-tenue">Inducción</span>' + U.barra(hechas * 20, hechas === 5 ? 'ok' : (hechas ? 'alerta' : 'critico')) + '<strong>' + hechas + '/5</strong></span>' +
      '<span class="pc2-eval">' + (ev ? '<span class="sx2-tenue">Evaluación</span><strong>' + U.esc(ev.promedio_responsabilidades + ' · ' + ev.promedio_habilidades) + '</strong>' : '<span class="sx2-tenue">Sin evaluación</span>') + '</span>' +
      '<span class="dc2-fila__senales">' + p.alertas.filter(function (a) { return a !== 'induccion'; }).map(function (a) { return U.badge(ALERTA[a][0], ALERTA[a][1]); }).join('') + '</span>' +
      U.ico('derecha', 16) + '</li>';
  }

  // --- Panel de la persona -----------------------------------------------------------------
  function abrir(id) {
    var p = datos_.personas.filter(function (x) { return x.persona_id === id; })[0];
    if (!p) return;
    var marcados = {};
    var fecha = (function () { var k = clave(p.fecha_ingreso); return k && k <= datos_.hoy ? k : datos_.hoy; })();
    var d = U.drawer({ titulo: persona(p).nombre, subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc([p.cargo, p.area_id].filter(Boolean).join(' · ')) + '</span>', cuerpo: '', pie: ' ' });
    d.el.classList.add('bj2-drawer', 'cq2-drawer');

    function pintarP() {
      var ev = p.evaluacion;
      var pend = p.induccion.filter(function (i) { return i.estado !== 'COMPLETADA'; });
      var n = Object.keys(marcados).filter(function (k) { return marcados[k]; }).length;
      var h =
        (p.alertas.length ? '<div class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + p.alertas.map(function (a) { return U.badge(ALERTA[a][0], ALERTA[a][1]); }).join('') + '</div>' : '') +
        '<dl class="cq2-ficha">' +
          fila('Correo', p.usuario_email) + fila('Ingreso', fmt(clave(p.fecha_ingreso))) +
          fila('Jefatura', nombreDe(p.jefatura_email)) + fila('Tipo', p.tipo === 'EXT' ? 'Externo' : 'Interno') +
          fila('Descriptor de cargo', p.tiene_descriptor ? (p.descriptor_version || 'Vigente') : 'Falta') +
          fila('Carpeta', p.documentos_n + (p.documentos_n === 1 ? ' documento' : ' documentos')) +
          fila('Formación este año', p.horas_formacion_anio + ' h (meta 5 h)') +
        '</dl>' +
        '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Inducción al SGC (FO-PRO-02-02) · ' + (5 - pend.length) + ' de 5</h3>' +
          '<ul class="pc2-items">' + p.induccion.map(function (i) {
            var hecha = i.estado === 'COMPLETADA';
            return '<li class="' + (hecha ? 'pc2-item--hecho' : '') + '">' +
              (hecha ? '<span class="pc2-check sx2-tono-ok">' + U.ico('check', 14) + '</span>'
                : (p.puede_registrar_induccion ? '<input type="checkbox" class="js-pc2-item" data-item="' + U.esc(i.item) + '"' + (marcados[i.item] ? ' checked' : '') + ' aria-label="' + U.esc(i.item) + '">' : '<span class="pc2-check sx2-tono-alerta">' + U.ico('reloj', 14) + '</span>')) +
              '<span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong>' + U.esc(i.item) + '</strong>' +
                (hecha ? '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(fmt(clave(i.fecha)) + (i.relator_email ? ' · ' + nombreDe(i.relator_email) : '')) + '</span>' : '<span class="sx2-tenue" style="font-size:.75rem">Pendiente</span>') + '</span>' +
              (hecha && p.puede_registrar_induccion && i.induccion_id ? U.boton({ texto: 'Deshacer', sm: true, variante: 'fantasma', clase: 'js-pc2-deshacer', datos: { id: i.induccion_id } }) : '') + '</li>';
          }).join('') + '</ul>' +
          (p.puede_registrar_induccion && pend.length ?
            '<div class="dc2-aprob"><label><span>Fecha en que se hizo</span><input type="date" class="js-pc2-fecha" max="' + datos_.hoy + '" value="' + fecha + '"></label>' +
              U.boton({ texto: n ? 'Registrar ' + n + ' ítem' + (n === 1 ? '' : 's') : 'Marca los ítems realizados', sm: true, variante: 'primario', clase: 'js-pc2-registrar', deshabilitado: !n }) +
              U.boton({ texto: 'Marcar todos', sm: true, variante: 'fantasma', clase: 'js-pc2-todos' }) + '</div>' +
            '<p class="sx2-tenue" style="margin:0;font-size:.75rem">Por defecto, la fecha de ingreso. Quedas como relator.</p>' : '') +
        '</section>' +
        '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Competencias (FO-PRO-02-04)</h3>' +
          (ev ? '<dl class="cq2-ficha">' + fila('Última evaluación', ev.sin_fecha ? 'Sin fecha (importada)' : fmt(clave(ev.fecha))) +
              fila('Funciones', String(ev.promedio_responsabilidades) + ' de 4') + fila('Habilidades', String(ev.promedio_habilidades) + ' de 4') +
              fila('Capacitación', ev.requiere_capacitacion ? 'Requiere (promedio menor a 3)' : 'No requiere') + '</dl>' +
              (ev.difiere_de_regla ? '<p class="sx2-tenue" style="margin:0;font-size:.75rem">La evaluación importada decía "' + (ev.requiere_capacitacion ? 'no requiere' : 'requiere') + ' capacitación"; se muestra según la regla.</p>' : '')
            : '<p class="sx2-tenue" style="margin:0">Aún no tiene evaluación de competencias.' + (p.descriptor_evaluable ? '' : ' Primero hay que completar su descriptor de cargo.') + '</p>') +
        '</section>';
      d.cuerpo(h);
      d.el.querySelector('.sx2-drawer__pie').innerHTML =
        (window.SigsoCalidad && SigsoCalidad.abrirFicha ? U.boton({ texto: 'Abrir ficha completa', icono: 'persona', variante: 'primario', clase: 'js-pc2-ficha' }) : '') +
        U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' });
    }
    function fila(k, v) { return v ? '<dt>' + U.esc(k) + '</dt><dd>' + U.esc(v) + '</dd>' : ''; }

    d.el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.classList.contains('js-pc2-item')) { marcados[t.getAttribute('data-item')] = t.checked; pintarP(); }
      if (t.classList.contains('js-pc2-fecha')) fecha = t.value;
    });
    d.el.addEventListener('click', function (ev) {
      var b, t = ev.target;
      if (t.closest('.js-pc2-todos')) { p.induccion.forEach(function (i) { if (i.estado !== 'COMPLETADA') marcados[i.item] = true; }); pintarP(); return; }
      if ((b = t.closest('.js-pc2-registrar'))) {
        var items = Object.keys(marcados).filter(function (k) { return marcados[k]; });
        if (!fecha) { PY.aviso('Indica la fecha en que se hizo.', 'error'); return; }
        b.disabled = true;
        registrar([{ persona_id: p.persona_id, items: items, fecha: fecha }]).then(function (ok) {
          b.disabled = false;
          if (!ok) return;
          marcados = {};
          p = datos_.personas.filter(function (x) { return x.persona_id === id; })[0] || p;
          pintarP();
        });
        return;
      }
      if ((b = t.closest('.js-pc2-deshacer'))) {
        U.confirmar({ titulo: 'Deshacer el registro', texto: 'El ítem vuelve a quedar pendiente y se borra su fecha.', boton: 'Deshacer' }).then(function (si) {
          if (!si) return;
          api('registrarInduccionSgc', { persona_id: p.persona_id, induccion_id: b.getAttribute('data-id'), estado: 'PENDIENTE' }).then(function (r) {
            if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo deshacer.', 'error'); return; }
            recargarDatos().then(function () { p = datos_.personas.filter(function (x) { return x.persona_id === id; })[0] || p; pintarP(); });
          });
        });
        return;
      }
      if (t.closest('.js-pc2-ficha')) { d.cerrar(true); SigsoCalidad.abrirFicha(p.persona_id); }
    });
    pintarP();
    return d;
  }

  // Registra y recarga los datos (sin repintar si la vista no está montada).
  function registrar(registros) {
    return api('registrarInduccionesEnLoteSgc', { registros: registros }).then(function (r) {
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo registrar.', 'error'); return false; }
      var x = r.data;
      PY.aviso(x.aplicados + (x.aplicados === 1 ? ' ítem registrado' : ' ítems registrados') + ' en ' + x.personas + (x.personas === 1 ? ' persona' : ' personas') +
        (x.fallas.length ? ' · ' + x.fallas.join(' ') : ''), x.fallas.length ? 'error' : 'exito');
      return recargarDatos().then(function () { return true; });
    });
  }
  function recargarDatos() {
    return api('getPanelPersonasSgc', {}).then(function (r) {
      if (r && r.ok) { datos_ = r.data; pintar(true); }
    });
  }

  // --- Inducciones en lote ------------------------------------------------------------------
  function vistaInduccion() {
    var items = datos_.items_induccion;
    var gente = datos_.personas.filter(function (p) { return p.puede_registrar_induccion && (!soloPend_ || p.induccion_pendientes); });
    var n = nSel();
    var cab = '<tr><th>Persona</th><th>Fecha</th>' + items.map(function (it) {
      return '<th><button type="button" class="pc2-col js-pc2-col" data-item="' + U.esc(it) + '" title="Marcar la columna">' + U.esc(it) + '</button></th>';
    }).join('') + '</tr>';
    var filas = gente.map(function (p) {
      return '<tr><th scope="row"><button type="button" class="pc2-quien js-pc2-fila" data-pid="' + U.esc(p.persona_id) + '" title="Marcar la fila">' + U.avatar(persona(p), 'xs') +
          '<span class="sx2-apilado" style="gap:0;min-width:0;text-align:left"><strong class="sx2-cortar">' + U.esc(persona(p).nombre) + '</strong><span class="sx2-tenue sx2-cortar" style="font-size:.6875rem">' + U.esc(p.cargo || '') + '</span></span></button></th>' +
        '<td class="pc2-fecha">' + U.esc(fmt(fechaDe(p))) + '</td>' +
        p.induccion.map(function (i) {
          if (i.estado === 'COMPLETADA') return '<td><span class="pc2-hecho" title="' + U.esc(fmt(clave(i.fecha))) + '">' + U.ico('check', 14) + '</span></td>';
          return '<td><input type="checkbox" class="js-pc2-sel" data-pid="' + U.esc(p.persona_id) + '" data-item="' + U.esc(i.item) + '"' + (sel_[sk(p.persona_id, i.item)] ? ' checked' : '') + ' aria-label="' + U.esc(persona(p).nombre + ' · ' + i.item) + '"></td>';
        }).join('') + '</tr>';
    }).join('');
    return U.card({ titulo: 'Registrar inducciones realizadas', icono: 'check', i: 2, cuerpo:
      '<p class="sx2-tenue dc2-ayuda">Marca lo que cada persona ya recibió (toca un nombre para marcar su fila, o el título de un ítem para la columna) y regístralo de una vez. ' +
        (datos_.puede_gestionar ? '' : 'Ves a las personas de tu equipo. ') + 'Quedas como relator.</p>' +
      '<div class="pc2-opciones">' +
        '<span>Fecha: ' + U.segmento([{ id: 'ingreso', texto: 'Ingreso de cada persona' }, { id: 'comun', texto: 'Una fecha común' }], modoFecha_, 'js-pc2-modo') + '</span>' +
        (modoFecha_ === 'comun' ? '<input type="date" class="js-pc2-fcomun" max="' + datos_.hoy + '" value="' + U.esc(fechaComun_ || datos_.hoy) + '" aria-label="Fecha común">' : '') +
        '<label class="pc2-solo"><input type="checkbox" class="js-pc2-solo"' + (soloPend_ ? ' checked' : '') + '> Solo con pendientes</label>' +
      '</div>' +
      (gente.length ? '<div class="pc2-matriz-caja"><table class="pc2-matriz"><thead>' + cab + '</thead><tbody>' + filas + '</tbody></table></div>'
        : U.vacio({ icono: 'check', titulo: 'Todas las inducciones están registradas', texto: 'Cuando entre alguien nuevo, aparecerá aquí.' })) +
      '<div class="cq2-mas">' + (n ? U.boton({ texto: 'Quitar marcas', sm: true, variante: 'fantasma', clase: 'js-pc2-limpiar-sel' }) : '') +
        U.boton({ texto: 'Registrar ' + n + (n === 1 ? ' inducción' : ' inducciones'), icono: 'check', variante: 'primario', clase: 'js-pc2-lote', deshabilitado: !n }) + '</div>' });
  }

  function registrarLote(b) {
    var porPersona = {};
    Object.keys(sel_).forEach(function (k) {
      if (!sel_[k]) return;
      var i = k.indexOf('|');
      var pid = k.slice(0, i);
      (porPersona[pid] = porPersona[pid] || []).push(k.slice(i + 1));
    });
    var registros = Object.keys(porPersona).map(function (pid) {
      var p = datos_.personas.filter(function (x) { return x.persona_id === pid; })[0];
      return { persona_id: pid, items: porPersona[pid], fecha: fechaDe(p) };
    });
    var n = nSel();
    U.confirmar({ titulo: 'Registrar ' + n + (n === 1 ? ' inducción' : ' inducciones'), boton: 'Registrar',
      texto: registros.length + (registros.length === 1 ? ' persona' : ' personas') + ', con ' + (modoFecha_ === 'comun' ? 'fecha ' + fmt(fechaComun_ || datos_.hoy) : 'la fecha de ingreso de cada una') + '. Quedas como relator; se puede deshacer por ítem en el panel de cada persona.' }).then(function (si) {
      if (!si) return;
      b.disabled = true;
      registrar(registros).then(function (ok) { b.disabled = false; if (ok) { sel_ = {}; pintar(true); } });
    });
  }

  // --- Eventos ----------------------------------------------------------------------------
  function enVista(t) {
    var raiz = document.getElementById('calidad-v2');
    return raiz && raiz.contains(t) && C().ocupa('personas');
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target, b;
    if (!enVista(t)) return;
    if ((b = t.closest('.js-pc2-tab'))) { tab_ = b.getAttribute('data-id'); pintar(true); return; }
    if (t.closest('.js-pc2-recargar')) { cargar(); return; }
    if (t.closest('.js-pc2-nueva')) { SigsoCalidad.formularioPersona(); return; }
    if ((b = t.closest('.sx2-kpi--clic'))) { var f = b.getAttribute('data-filtro'); filtro_ = filtro_ === f ? '' : f; pintar(true); return; }
    if (t.closest('.js-pc2-limpiar')) { filtro_ = ''; q_ = ''; pintar(true); return; }
    if ((b = t.closest('.js-pc2-modo'))) { modoFecha_ = b.getAttribute('data-id'); pintar(true); return; }
    if (t.closest('.js-pc2-limpiar-sel')) { sel_ = {}; pintar(true); return; }
    if ((b = t.closest('.js-pc2-fila'))) {
      var p = datos_.personas.filter(function (x) { return x.persona_id === b.getAttribute('data-pid'); })[0];
      var pend = p.induccion.filter(function (i) { return i.estado !== 'COMPLETADA'; });
      var todas = pend.every(function (i) { return sel_[sk(p.persona_id, i.item)]; });
      pend.forEach(function (i) { sel_[sk(p.persona_id, i.item)] = !todas; });
      pintar(true);
      return;
    }
    if ((b = t.closest('.js-pc2-col'))) {
      var it = b.getAttribute('data-item');
      var celdas = datos_.personas.filter(function (x) { return x.puede_registrar_induccion && (!soloPend_ || x.induccion_pendientes); })
        .filter(function (x) { return x.induccion.some(function (i) { return i.item === it && i.estado !== 'COMPLETADA'; }); });
      var todasC = celdas.every(function (x) { return sel_[sk(x.persona_id, it)]; });
      celdas.forEach(function (x) { sel_[sk(x.persona_id, it)] = !todasC; });
      pintar(true);
      return;
    }
    if ((b = t.closest('.js-pc2-lote'))) { registrarLote(b); return; }
    if ((b = t.closest('[data-pc2]'))) abrir(b.getAttribute('data-pc2'));
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t.classList || !enVista(t)) return;
    if (t.classList.contains('js-pc2-sel')) {
      sel_[sk(t.getAttribute('data-pid'), t.getAttribute('data-item'))] = t.checked;
      var b = document.querySelector('#calidad-v2 .js-pc2-lote');
      var n = nSel();
      if (b) { b.disabled = !n; b.lastChild.textContent = 'Registrar ' + n + (n === 1 ? ' inducción' : ' inducciones'); }
      return;
    }
    if (t.classList.contains('js-pc2-solo')) { soloPend_ = t.checked; pintar(true); return; }
    if (t.classList.contains('js-pc2-fcomun')) {
      if (t.value && t.value > datos_.hoy) { PY.aviso('La fecha no puede ser futura.', 'error'); t.value = datos_.hoy; }
      fechaComun_ = t.value;
      pintar(true);
    }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-pc2-q')) return;
    q_ = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { pintar(true); }, 150);
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#calidad-v2 [data-pc2]')) { ev.preventDefault(); ev.target.click(); }
  });

  window.SigsoCalidadPersonasV2 = { mostrar: mostrar, refrescar: refrescar, abrir: function (id) { if (datos_) abrir(id); } };
})();
