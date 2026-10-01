/**
 * control-interno-v2.js — módulo "Control interno" (2026-10-01): las matrices
 * de Contabilidad y RR.HH. que hoy se llenan en el Drive, dentro de SIGSO.
 *
 * Vistas (el árbol del sidebar las elige):
 *  - inicio      Resumen del mes: una tarjeta por matriz con lo pendiente,
 *                lo que espera liberación y lo liberado.
 *  - m:CLAVE     La matriz del mes como planilla: se edita en la misma
 *                celda (se guarda al salir de ella), "Abrir el mes" copia los
 *                clientes del mes anterior, acciones en lote (estado,
 *                responsable, liberar, anular) y descarga a Excel.
 *  - reportes    Mes a mes, por responsable y por cliente, lo que arrastra
 *                meses y los días de respuesta. Descarga a Excel.
 *  - accesos     (ADM) quién registra o solo mira cada departamento.
 *
 * La definición de cada matriz (campos, listas, estados) llega del servidor
 * (controlInternoMatrices.js): esta pantalla no conoce ninguna en particular.
 * El backend decide los permisos; aquí solo se esconden botones.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var CHECK = [['', '—'], ['OK', 'OK'], ['PENDIENTE', 'Pendiente'], ['NO_APLICA', 'No aplica']];

  var cfg_ = null, vista_ = 'inicio', periodo_ = '', lista_ = null, turno_ = 0;
  var sel_ = {}, f_ = { q: '', estado: '', resp: '', liberar: false };
  var rep_ = { matriz: '', meses: 12, datos: null };

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
  function fecha(v) { return v ? PY.fecha(v, true) : ''; }
  function miles(n) { if (n === '' || n === null || n === undefined || !isFinite(Number(n))) return ''; return Number(n).toLocaleString('es-CL', { maximumFractionDigits: 2 }); }
  function periodoActual() { var h = PY.hoyClave(); return h.slice(0, 4) + '-M' + h.slice(5, 7); }
  function mover(per, n) {
    var m = /^(\d{4})-M(\d{2})$/.exec(per || ''); if (!m) return per;
    var t = Number(m[1]) * 12 + Number(m[2]) - 1 + n;
    return Math.floor(t / 12) + '-M' + ('0' + (t % 12 + 1)).slice(-2);
  }
  function perTexto(per, largo) { var m = /^(\d{4})-M(\d{2})$/.exec(per || ''); return m ? (largo ? MESES_LARGO : MESES)[+m[2] - 1] + (largo ? ' de ' : ' ') + m[1] : String(per || ''); }
  function periodosOpciones() { var l = [], p = mover(periodoActual(), 1); for (var i = 0; i < 24; i++) { l.push([p, perTexto(p)]); p = mover(p, -1); } return l; }
  function matriz(clave) { return cfg_ ? cfg_.matrices.filter(function (m) { return m.clave === clave; })[0] : null; }
  function depto(clave) { return cfg_ ? cfg_.departamentos.filter(function (d) { return d.clave === clave; })[0] : null; }
  function estadoDe(m, clave) { return m.estados.filter(function (e) { return e.clave === clave; })[0] || { clave: clave, etiqueta: clave, tono: 'neutro' }; }
  function esAnulado(clave) { return /^ANULAD/.test(String(clave || '')); }
  function liberable(m, r) { var e = estadoDe(m, r.estado); return !!e.final && !esAnulado(r.estado) && !r.liberado_por; }
  function yo() { return String((cfg_ && cfg_.yo) || '').toLowerCase(); }
  // `extra` puede traer su propio class="…" (celdas, filtros): entonces no se
  // pone el de por defecto — dos atributos class y el navegador ignora el segundo.
  function select(nombre_, ops, v, extra) {
    extra = extra || '';
    return '<select ' + (/\bclass="/.test(extra) ? '' : 'class="sx2-select" ') + (nombre_ ? 'name="' + nombre_ + '" ' : '') + extra + '>' + ops.map(function (o) {
      return '<option value="' + U.esc(o[0]) + '"' + (String(o[0]) === String(v == null ? '' : v) ? ' selected' : '') + '>' + U.esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function resolverPersonas(lista) {
    if (!window.SigsoDirectorio || !SigsoDirectorio.resolver) return Promise.resolve();
    var correos = [];
    (lista || []).forEach(function (r) { [r.responsable_email, r.liberado_por, r.email].forEach(function (e) { if (e) correos.push(e); }); });
    return SigsoDirectorio.resolver(correos).catch(function () { /* sin nombres: se ve el correo */ });
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
    var foco = document.activeElement && c.contains(document.activeElement) ? document.activeElement : null;
    var claveFoco = foco ? (foco.getAttribute('data-foco') || '') : '';
    // Si la persona ya escribe en otra celda cuando llega el guardado de la
    // anterior, el repintado no puede borrarle lo que lleva tecleado.
    var valorFoco = foco && 'value' in foco ? foco.value : null;
    var scrollGrilla = c.querySelector('.ci2-grilla') ? c.querySelector('.ci2-grilla').scrollLeft : 0;
    c.innerHTML = '<div class="sx2-pagina">' + html + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
      var grilla = c.querySelector('.ci2-grilla');
      if (grilla) grilla.scrollLeft = scrollGrilla;
      if (claveFoco) {
        var el = c.querySelector('[data-foco="' + claveFoco + '"]');
        if (el) {
          if (valorFoco !== null && el.value !== valorFoco && el.tagName !== 'SELECT') el.value = valorFoco;
          el.focus();
          if (el.setSelectionRange && (el.type === 'text' || el.type === 'search')) { try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* */ } }
        }
      }
    }
    U.animar(c);
  }
  function cabecera(migas, titulo, sub, acciones) {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">' + U.esc(migas) + '</span><h1>' + U.esc(titulo) + '</h1>' +
      (sub ? '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc(sub) + '</span>' : '') + '</div><div class="sx2-cabecera__acciones">' + (acciones || '') + '</div></header>';
  }
  function selectorPeriodo() {
    return '<span class="ci2-periodo" role="group" aria-label="Período">' +
      U.boton({ soloIcono: true, icono: 'izquierda', variante: 'fantasma', sm: true, titulo: 'Mes anterior', clase: 'js-ci2-per', datos: { n: -1 } }) +
      '<strong>' + U.esc(perTexto(periodo_)) + '</strong>' +
      U.boton({ soloIcono: true, icono: 'derecha', variante: 'fantasma', sm: true, titulo: 'Mes siguiente', clase: 'js-ci2-per', datos: { n: 1 } }) + '</span>';
  }
  function aviso(tono, icono, html) { return '<div class="mj2-aviso sx2-tono-' + tono + ' sx2-entra">' + U.ico(icono, 16) + '<span>' + html + '</span></div>'; }
  function error(r) {
    pagina(cabecera('Control interno', 'No se pudo cargar', '') + U.card({ i: 1, cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || '', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-ci2-recargar' }) }) }));
  }

  // --- árbol del sidebar ----------------------------------------------------------------
  function arbol() {
    var subs = [{ id: 'inicio', nombre: 'Resumen del mes', icono: 'panel', plano: true, items: [{ id: 'inicio', nombre: 'Resumen del mes' }] }];
    (cfg_ ? cfg_.departamentos : []).forEach(function (d) {
      subs.push({ id: 'd-' + d.clave, nombre: d.nombre, icono: d.clave === 'RRHH' ? 'equipo' : 'dinero',
        items: cfg_.matrices.filter(function (m) { return m.depto === d.clave; }).map(function (m) { return { id: 'm:' + m.clave, nombre: m.nombre }; }) });
    });
    subs.push({ id: 'reportes', nombre: 'Reportes', icono: 'grafico', plano: true, items: [{ id: 'reportes', nombre: 'Reportes' }] });
    if (cfg_ && cfg_.puede_administrar) subs.push({ id: 'accesos', nombre: 'Accesos', icono: 'llave', plano: true, items: [{ id: 'accesos', nombre: 'Accesos' }] });
    return subs;
  }
  function registrarArbol() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('control_interno', { nombre: 'Control interno', submodulos: arbol() });
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
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
      // Quién libera se muestra con nombre: se resuelve en el directorio y se repinta.
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
    if (p[0] === 'm' && matriz(p[1])) { sel_ = {}; f_ = { q: '', estado: '', resp: '', liberar: false }; abrirMatriz(p[1]); return; }
    if (vista_ === 'reportes') { vistaReportes(); return; }
    if (vista_ === 'accesos' && cfg_.puede_administrar) { vistaAccesos(); return; }
    vista_ = 'inicio';
    vistaInicio();
  }
  function cambiarPeriodo(n) {
    periodo_ = mover(periodo_, n);
    var p = String(vista_).split(':');
    if (p[0] === 'm') { sel_ = {}; abrirMatriz(p[1]); } else vistaInicio();
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
    var SUB = 'Las matrices de Contabilidad y RR.HH., mes a mes. Mientras dure la prueba, el registro oficial sigue siendo el Drive.';
    if (!cfg_.departamentos.length) {
      pagina(cabecera('Control interno', 'Resumen del mes', SUB) + U.card({ i: 1, cuerpo: U.vacio({ icono: 'candado', titulo: 'Todavía no tienes un departamento asignado', texto: 'Pide al administrador que te dé acceso a Contabilidad o a RR.HH. en Control interno › Accesos.' }) }));
      return;
    }
    var i = 0;
    var html = cfg_.departamentos.map(function (d) {
      var lib = (d.liberadores || []).map(nombre).join(', ');
      return '<section class="ci2-depto sx2-entra" style="--i:' + (i++) + '"><div class="ci2-depto__cab"><h2>' + txt(d.nombre) + '</h2>' +
        '<span class="sx2-tenue">' + (d.registra ? 'Registras' : 'Solo lectura') + (d.libera ? ' · Liberas' : '') + ' · Libera: ' + (lib ? txt(lib) : '<i>sin asignar</i>') + '</span></div>' +
        '<div class="ci2-tarjetas">' + cfg_.matrices.filter(function (m) { return m.depto === d.clave; }).map(function (m) {
          var r = cfg_.resumen[m.clave] || { total: 0, pendientes: 0, por_liberar: 0, liberados: 0, finalizados: 0 };
          var pct = r.total ? Math.round(100 * r.finalizados / r.total) : 0;
          return '<button type="button" class="ci2-tarjeta" data-ci2-ir="m:' + U.esc(m.clave) + '">' +
            '<span class="ci2-tarjeta__nom">' + txt(m.nombre) + '</span>' +
            '<span class="ci2-tarjeta__desc">' + txt(m.descripcion) + '</span>' +
            (r.total ? '<span class="ci2-tarjeta__cifras">' +
              '<span><b>' + r.total + '</b> registros</span>' +
              (r.pendientes ? '<span class="sx2-tono-alerta"><b>' + r.pendientes + '</b> pendientes</span>' : '') +
              (r.por_liberar ? '<span class="sx2-tono-info"><b>' + r.por_liberar + '</b> por liberar</span>' : '') +
              (r.liberados ? '<span class="sx2-tono-ok"><b>' + r.liberados + '</b> liberados</span>' : '') + '</span>' +
              U.barra(pct, pct === 100 ? 'ok' : 'primario')
              : '<span class="ci2-tarjeta__vacia">Sin registros en ' + U.esc(perTexto(periodo_)) + '</span>') +
          '</button>';
        }).join('') + '</div></section>';
    }).join('');
    pagina(cabecera('Control interno', 'Resumen de ' + perTexto(periodo_, true), SUB, selectorPeriodo() +
      (cfg_.puede_administrar ? U.boton({ texto: 'Importar desde Excel', icono: 'subir', clase: 'js-ci2-importar' }) : '') +
      U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-ci2-recargar' })) + html, !!silencioso);
  }

  // =========================================================================================
  // La matriz del mes
  // =========================================================================================
  function abrirMatriz(clave, silencioso) {
    var m = matriz(clave), t = ++turno_;
    if (!silencioso) pagina(cabecera('Control interno · ' + depto(m.depto).nombre, m.nombre, m.descripcion, selectorPeriodo()) + U.esqueleto('kpis', 5) + U.esqueleto('tabla', 8));
    return api('listarRegistrosCI', { matriz: clave, periodo: periodo_ }).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { error(r); return; }
      lista_ = r.data;
      pintarMatriz(!!silencioso);
      resolverPersonas(lista_.registros).then(function () { if (t === turno_ && lista_ && lista_.matriz === clave) pintarMatriz(true); });
    });
  }
  function camposTabla(m) { return m.campos.filter(function (c) { return c.tabla; }); }
  function filtrados() {
    var m = matriz(lista_.matriz), q = norm(f_.q);
    return lista_.registros.filter(function (r) {
      if (f_.estado && r.estado !== f_.estado) return false;
      if (f_.resp && String(r.responsable_email) !== f_.resp) return false;
      if (f_.liberar && !liberable(m, r)) return false;
      if (q) {
        var heno = norm([r.cliente_nombre, r.cliente_rut, r.observaciones].concat(Object.keys(r.datos || {}).map(function (k) { var v = r.datos[k]; return typeof v === 'object' ? '' : v; })).join(' '));
        if (heno.indexOf(q) === -1) return false;
      }
      return true;
    });
  }
  function pintarMatriz(silencioso) {
    var m = matriz(lista_.matriz), d = depto(m.depto), r = lista_.resumen;
    var reg = !!lista_.puede_registrar, lib = !!lista_.puede_liberar;
    var visibles = filtrados();
    var nSel = Object.keys(sel_).filter(function (k) { return sel_[k]; }).length;
    var acciones = selectorPeriodo() +
      (reg && m.abrirMes && lista_.por_abrir ? U.boton({ texto: 'Abrir el mes (' + lista_.por_abrir + ')', icono: 'calendario', clase: 'js-ci2-abrir', titulo: 'Crea los registros de ' + perTexto(periodo_) + ' con los clientes de ' + perTexto(lista_.periodo_anterior) }) : '') +
      (reg ? U.boton({ texto: 'Nuevo registro', icono: 'nueva', variante: 'primario', clase: 'js-ci2-nuevo' }) : '') +
      U.boton({ soloIcono: true, icono: 'descargar', titulo: 'Descargar a Excel', clase: 'js-ci2-excel' }) +
      U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-ci2-recargar' });
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, etiqueta: 'Registros', valor: r.total, icono: 'tabla', tono: 'primario' }) +
      U.kpi({ i: 1, etiqueta: 'Pendientes', valor: r.pendientes, icono: 'reloj', tono: r.pendientes ? 'alerta' : 'ok' }) +
      U.kpi({ i: 2, etiqueta: 'Terminados', valor: r.finalizados, icono: 'check', tono: 'info', progreso: r.total ? 100 * r.finalizados / r.total : 0 }) +
      U.kpi({ i: 3, etiqueta: 'Por liberar', valor: r.por_liberar, icono: 'escudo', tono: r.por_liberar ? 'info' : 'neutro', filtro: 'liberar', activo: f_.liberar, titulo: 'Terminados que esperan la revisión de quien libera el área' }) +
      U.kpi({ i: 4, etiqueta: 'Liberados', valor: r.liberados, icono: 'escudoCheck', tono: 'ok' }) + '</div>';
    var resps = {};
    lista_.registros.forEach(function (x) { if (x.responsable_email) resps[x.responsable_email] = true; });
    var filtros = '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:2"><div class="sx2-barra-filtros">' +
      '<input class="sx2-input js-ci2-q" type="search" placeholder="Buscar cliente, RUT, folio, trabajador…" aria-label="Buscar" value="' + U.esc(f_.q) + '" data-foco="q">' +
      select('', [['', 'Todos los estados']].concat(m.estados.map(function (e) { return [e.clave, e.etiqueta]; })), f_.estado, 'class="sx2-select js-ci2-f" data-f="estado" aria-label="Estado"') +
      select('', [['', 'Todos los responsables']].concat(Object.keys(resps).map(function (e) { return [e, nombre(e)]; })), f_.resp, 'class="sx2-select js-ci2-f" data-f="resp" aria-label="Responsable"') +
      (f_.q || f_.estado || f_.resp || f_.liberar ? U.chip({ texto: 'Quitar filtros', icono: 'equis', clase: 'js-ci2-limpiar' }) : '') +
      '<span class="sx2-tenue ci2-cuenta">' + visibles.length + ' de ' + lista_.registros.length + '</span></div></div>';
    var lote = nSel ? '<div class="ci2-lote sx2-entra" role="region" aria-label="Acciones sobre lo marcado"><b>' + nSel + (nSel === 1 ? ' marcado' : ' marcados') + '</b>' +
      (reg && !m.estadoCalculado ? select('', [['', 'Cambiar estado a…']].concat(m.estados.map(function (e) { return [e.clave, e.etiqueta]; })), '', 'class="sx2-select js-ci2-lote-estado" aria-label="Cambiar estado"') : '') +
      (reg ? U.boton({ texto: 'Asignar responsable', icono: 'persona', sm: true, clase: 'js-ci2-lote-resp' }) : '') +
      (lib ? U.boton({ texto: 'Liberar', icono: 'escudoCheck', sm: true, variante: 'primario', clase: 'js-ci2-lote', datos: { accion: 'liberar' } }) : '') +
      (lib ? U.boton({ texto: 'Quitar liberación', sm: true, clase: 'js-ci2-lote', datos: { accion: 'desliberar' } }) : '') +
      (reg ? U.boton({ texto: 'Anular', icono: 'basura', sm: true, clase: 'js-ci2-lote', datos: { accion: 'anular' } }) : '') +
      U.boton({ texto: 'Desmarcar', sm: true, variante: 'fantasma', clase: 'js-ci2-desmarcar' }) + '</div>' : '';
    var cols = camposTabla(m);
    var tabla = lista_.registros.length ? (visibles.length ?
      '<section class="sx2-card sx2-card--sin-relleno sx2-entra ci2-grilla-card" style="--i:3"><div class="sx2-tabla-wrap ci2-grilla"><table class="sx2-tabla ci2-tabla"><thead><tr>' +
        '<th class="ci2-col-sel"><input type="checkbox" class="js-ci2-todos" aria-label="Marcar todos los visibles"' + (visibles.length && visibles.every(function (x) { return sel_[x.registro_id]; }) ? ' checked' : '') + '></th>' +
        '<th class="ci2-col-cli">Cliente</th>' + cols.map(function (c) { return '<th>' + txt(c.etiqueta) + '</th>'; }).join('') +
        '<th>Responsable</th><th>Estado</th><th>Liberación</th></tr></thead><tbody>' +
        visibles.map(function (x) { return fila(m, x, reg, lib); }).join('') + '</tbody></table></div></section>'
      : U.card({ i: 3, cuerpo: U.vacio({ icono: 'filtro', titulo: 'Nada coincide con los filtros' }) }))
      : U.card({ i: 3, cuerpo: U.vacio({ icono: 'tabla', titulo: 'Sin registros en ' + perTexto(periodo_, true),
        texto: m.periodica && m.abrirMes && lista_.por_abrir ? '“Abrir el mes” crea los registros con los ' + lista_.por_abrir + ' de ' + perTexto(lista_.periodo_anterior) + '.' : 'Agrega el primero con “Nuevo registro”.',
        accion: reg ? (m.abrirMes && lista_.por_abrir ? U.boton({ texto: 'Abrir el mes', icono: 'calendario', variante: 'primario', clase: 'js-ci2-abrir' }) : U.boton({ texto: 'Nuevo registro', icono: 'nueva', variante: 'primario', clase: 'js-ci2-nuevo' })) : '' }) });
    var libs = (d.liberadores || []).map(nombre).join(', ');
    pagina(cabecera('Control interno · ' + d.nombre, m.nombre, m.descripcion, acciones) + kpis +
      (lib ? aviso('info', 'escudoCheck', 'Liberas ' + txt(d.nombre) + ': marca los terminados y usa <b>Liberar</b>. Lo que realizaste tú lo libera otra persona.') :
        (r.por_liberar ? aviso('info', 'info', 'Libera ' + txt(d.nombre) + ': ' + (libs ? txt(libs) : '<i>nadie asignado todavía</i>') + '.') : '')) +
      filtros + lote + tabla, silencioso);
  }

  // Una fila de la grilla. Las celdas editables guardan al salir de ellas.
  function fila(m, x, reg, lib) {
    var e = estadoDe(m, x.estado);
    var editable = reg;
    var celdas = camposTabla(m).map(function (c) { return '<td class="ci2-td-' + c.tipo + '">' + celda(m, x, c, editable) + '</td>'; }).join('');
    var liberacion = x.liberado_por
      ? '<span class="ci2-lib">' + U.badge('Liberado', 'ok') + '<small>' + txt(nombre(x.liberado_por)) + ' · ' + txt(fecha(x.fecha_liberacion)) + '</small></span>'
      : (liberable(m, x) ? (lib && (lista_.gobierna || String(x.responsable_email).toLowerCase() !== yo())
        ? U.boton({ texto: 'Liberar', icono: 'escudoCheck', sm: true, clase: 'js-ci2-liberar-uno', datos: { id: x.registro_id } })
        : U.badge('Por liberar', 'info')) : '<span class="sx2-tenue">—</span>');
    var estado = editable && !m.estadoCalculado
      ? select('', m.estados.map(function (k) { return [k.clave, k.etiqueta]; }), x.estado, 'class="sx2-select ci2-celda ci2-estado sx2-tono-' + e.tono + '" data-campo="__estado" data-foco="' + x.registro_id + '-__estado" aria-label="Estado"')
      : U.badge(e.etiqueta, e.tono);
    return '<tr data-id="' + U.esc(x.registro_id) + '"' + (sel_[x.registro_id] ? ' class="ci2-fila--sel"' : '') + '>' +
      '<td class="ci2-col-sel"><input type="checkbox" class="js-ci2-sel" aria-label="Marcar"' + (sel_[x.registro_id] ? ' checked' : '') + '></td>' +
      '<td class="ci2-col-cli"><button type="button" class="ci2-cliente js-ci2-abrir-reg">' + txt(x.cliente_nombre) + '</button>' +
        (x.cliente_rut ? '<small>' + txt(x.cliente_rut) + '</small>' : '') + (!x.cliente_id ? U.badge('Fuera del catálogo', 'alerta', true) : '') + '</td>' +
      celdas + '<td class="ci2-td-resp">' + txt(nombre(x.responsable_email)) + '</td><td>' + estado + '</td><td>' + liberacion + '</td></tr>';
  }
  function celda(m, x, c, editable) {
    var v = (x.datos || {})[c.clave];
    var foco = ' data-foco="' + U.esc(x.registro_id + '-' + c.clave) + '" data-campo="' + U.esc(c.clave) + '" aria-label="' + U.esc(c.etiqueta) + '"';
    if (c.tipo === 'items') {
      var l = Array.isArray(v) ? v : [];
      var venc = l.filter(function (k) { return Number(k.cuotas_vencidas) > 0; }).length;
      return '<button type="button" class="ci2-mini js-ci2-abrir-reg">' + (l.length ? l.length + (l.length === 1 ? ' fila' : ' filas') : 'Agregar') + '</button>' + (venc ? ' ' + U.badge(venc + ' con vencidas', 'critico', true) : '');
    }
    if (c.tipo === 'checklist') {
      var a = x.avance || { ok: 0, aplica: 0, pct: 0 };
      return '<button type="button" class="ci2-mini ci2-avance js-ci2-abrir-reg">' + U.barra(a.pct, a.pct === 100 ? 'ok' : 'primario') + '<span>' + a.ok + '/' + a.aplica + '</span></button>';
    }
    if (c.tipo === 'texto_largo' || c.tipo === 'persona' || !editable) {
      var t = c.tipo === 'persona' ? nombre(v) : (c.tipo === 'fecha' ? fecha(v) : (c.tipo === 'monto' ? miles(v) : v));
      return c.tipo === 'texto_largo' && editable ? '<button type="button" class="ci2-mini ci2-largo js-ci2-abrir-reg">' + (t ? txt(String(t).slice(0, 60)) : 'Escribir') + '</button>' : '<span>' + txt(t || '') + '</span>';
    }
    if (c.tipo === 'lista') return select('', [['', '—']].concat((c.opciones || []).map(function (o) { return [o, o]; })), v, 'class="sx2-select ci2-celda"' + foco);
    if (c.tipo === 'fecha') return '<input class="sx2-input ci2-celda" type="date" value="' + U.esc(v || '') + '"' + foco + '>';
    if (c.tipo === 'hora') return '<input class="sx2-input ci2-celda" type="time" value="' + U.esc(v || '') + '"' + foco + '>';
    if (c.tipo === 'monto' || c.tipo === 'numero') return '<input class="sx2-input ci2-celda ci2-num" inputmode="decimal" value="' + U.esc(c.tipo === 'monto' ? miles(v) : (v === undefined ? '' : v)) + '"' + foco + '>';
    return '<input class="sx2-input ci2-celda" value="' + U.esc(v == null ? '' : v) + '"' + foco + '>';
  }
  function registroDe(id) { return (lista_.registros || []).filter(function (x) { return x.registro_id === id; })[0]; }
  function reemplazar(reg) {
    lista_.registros = lista_.registros.map(function (x) { return x.registro_id === reg.registro_id ? reg : x; });
  }
  // Recalcula los KPI en el navegador tras un cambio de celda (sin volver a pedir la lista).
  function recalcular() {
    var m = matriz(lista_.matriz), r = { total: 0, pendientes: 0, finalizados: 0, liberados: 0, por_liberar: 0 };
    lista_.registros.forEach(function (x) {
      if (esAnulado(x.estado)) return;
      r.total++;
      if (estadoDe(m, x.estado).final) r.finalizados++; else r.pendientes++;
      if (x.liberado_por) r.liberados++; else if (liberable(m, x)) r.por_liberar++;
    });
    lista_.resumen = Object.assign({}, lista_.resumen, r);
  }
  function guardarCelda(el) {
    var tr = el.closest('tr[data-id]');
    if (!tr || !lista_) return;
    var campo = el.getAttribute('data-campo');
    var payload = { registro_id: tr.getAttribute('data-id') };
    if (campo === '__estado') payload.estado = el.value;
    else { payload.datos = {}; payload.datos[campo] = el.value; }
    el.classList.remove('ci2-celda--error');
    el.classList.add('ci2-celda--guardando');
    api('guardarRegistroCI', payload).then(function (r) {
      el.classList.remove('ci2-celda--guardando');
      if (!r || !r.ok) {
        el.classList.add('ci2-celda--error');
        el.title = (r && r.message) || 'No se guardó';
        PY.aviso((r && r.message) || 'No se guardó.', 'error');
        return;
      }
      if (r.data && r.data.registro) reemplazar(r.data.registro);
      if (r.data && /de nuevo/.test(r.data.message || '')) PY.aviso(r.data.message, 'info');
      recalcular();
      pintarMatriz(true);
      var nuevo = raiz().querySelector('tr[data-id="' + payload.registro_id + '"] [data-campo="' + campo + '"]');
      if (nuevo) { nuevo.classList.add('ci2-celda--ok'); setTimeout(function () { nuevo.classList.remove('ci2-celda--ok'); }, 900); }
    });
  }

  // --- formulario del registro (nuevo y edición completa) -------------------------------
  function control(c, v, attrs) {
    attrs = attrs || '';
    if (c.tipo === 'lista') return select('', [['', '—']].concat((c.opciones || []).map(function (o) { return [o, o]; })), v, 'class="sx2-select" ' + attrs);
    if (c.tipo === 'fecha') return '<input class="sx2-input" type="date" value="' + U.esc(v || '') + '" ' + attrs + '>';
    if (c.tipo === 'hora') return '<input class="sx2-input" type="time" value="' + U.esc(v || '') + '" ' + attrs + '>';
    if (c.tipo === 'monto') return '<input class="sx2-input" inputmode="decimal" value="' + U.esc(miles(v)) + '" ' + attrs + '>';
    if (c.tipo === 'numero') return '<input class="sx2-input" inputmode="decimal" value="' + U.esc(v === undefined ? '' : v) + '" ' + attrs + '>';
    if (c.tipo === 'texto_largo') return '<textarea class="sx2-input" rows="3" ' + attrs + '>' + U.esc(v || '') + '</textarea>';
    if (c.tipo === 'persona') return '<input class="sx2-input" type="email" data-persona value="' + U.esc(v || '') + '" ' + attrs + '>';
    return '<input class="sx2-input" value="' + U.esc(v == null ? '' : v) + '" ' + attrs + '>';
  }
  function filaItem(c, it) {
    return '<div class="ci2-items__fila">' + c.subcampos.map(function (sc) {
      return '<label class="ci2-items__c"><span>' + txt(sc.etiqueta) + '</span>' + control(sc, (it || {})[sc.clave], 'data-sub="' + U.esc(sc.clave) + '"') + '</label>';
    }).join('') + U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Quitar fila', clase: 'js-ci2-item-menos' }) + '</div>';
  }
  function editorCampo(c, v) {
    if (c.tipo === 'items') {
      var l = Array.isArray(v) && v.length ? v : [{}];
      return '<div class="sx2-campo ci2-items" data-campo="' + U.esc(c.clave) + '"><span class="sx2-campo__et">' + txt(c.etiqueta) + '</span><div class="ci2-items__filas">' +
        l.map(function (it) { return filaItem(c, it); }).join('') + '</div>' + U.boton({ texto: 'Agregar ' + c.etiqueta.toLowerCase().replace(/s$/, ''), icono: 'nueva', sm: true, clase: 'js-ci2-item-mas', datos: { campo: c.clave } }) + '</div>';
    }
    if (c.tipo === 'checklist') {
      var val = v && typeof v === 'object' ? v : {};
      return '<div class="sx2-campo"><span class="sx2-campo__et">' + txt(c.etiqueta) + '</span>' + c.grupos.map(function (g) {
        var gv = val[g.clave] || {};
        return '<fieldset class="ci2-check"><legend>' + txt(g.nombre) + '</legend><div class="sx2-form__fila">' +
          U.campo('Quién', '<input class="sx2-input" type="email" data-persona name="chk_' + g.clave + '_quien" value="' + U.esc(gv.quien || '') + '">') +
          U.campo('Fecha', '<input class="sx2-input" type="date" name="chk_' + g.clave + '_fecha" value="' + U.esc(gv.fecha || '') + '">') + '</div>' +
          '<div class="ci2-check__items">' + g.items.map(function (it) {
            return '<label class="ci2-check__item"><span>' + txt(it) + '</span>' + select('', CHECK, (gv.items || {})[it] || '', 'class="sx2-select" data-grupo="' + U.esc(g.clave) + '" data-item="' + U.esc(it) + '"') + '</label>';
          }).join('') + '</div>' + U.boton({ texto: 'Lo pendiente a OK', sm: true, variante: 'fantasma', clase: 'js-ci2-chk-ok', datos: { grupo: g.clave } }) + '</fieldset>';
      }).join('') + '</div>';
    }
    return U.campo(c.etiqueta, control(c, v, 'name="d_' + U.esc(c.clave) + '"'), c.ayuda || '');
  }
  function etiquetaCliente(c) { return c.nombre + (c.rut ? ' · ' + c.rut : ''); }
  function formRegistro(m, x) {
    var nuevo = !x, d = depto(m.depto);
    var listaId = 'ci2-clientes-' + Date.now();
    var cliVal = x ? (x.cliente_id ? etiquetaCliente({ nombre: x.cliente_nombre, rut: x.cliente_rut }) : x.cliente_nombre) : '';
    var campos =
      U.campo('Cliente', '<input class="sx2-input" name="cliente" list="' + listaId + '" value="' + U.esc(cliVal) + '" placeholder="Busca por nombre o RUT" autocomplete="off" required>' +
        '<datalist id="' + listaId + '">' + (cfg_.clientes || []).map(function (c) { return '<option value="' + U.esc(etiquetaCliente(c)) + '"></option>'; }).join('') + '</datalist>',
        'Si no está en el catálogo, escribe el nombre: queda marcado para conciliar.') +
      '<div class="sx2-form__fila">' +
        (nuevo && m.periodica ? U.campo('Período', select('periodo', periodosOpciones(), periodo_)) : '') +
        (m.estadoCalculado ? '' : U.campo('Estado', select('estado', m.estados.map(function (e) { return [e.clave, e.etiqueta]; }), x ? x.estado : m.estados[0].clave))) +
      '</div>' +
      U.campo('Quién lo realiza', '<input class="sx2-input" type="email" data-persona name="responsable_email" value="' + U.esc(x ? x.responsable_email : yo()) + '">') +
      m.campos.map(function (c) { return editorCampo(c, x ? (x.datos || {})[c.clave] : undefined); }).join('') +
      U.campo('Observaciones', '<textarea class="sx2-input" name="observaciones" rows="2">' + U.esc(x ? x.observaciones : '') + '</textarea>') +
      (x ? '<div class="ci2-historial js-ci2-historial"><span class="sx2-campo__et">Historial</span><p class="sx2-tenue">Cargando…</p></div>' : '');
    var dr = U.formulario({
      titulo: (nuevo ? 'Nuevo registro · ' : '') + m.nombre, ancho: true, boton: nuevo ? 'Crear' : 'Guardar',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + txt(d.nombre) + ' · ' + txt(x ? perTexto(x.periodo, true) : (m.periodica ? 'mes elegido abajo' : 'el mes sale de la fecha')) +
        (x && x.liberado_por ? ' · Liberado por ' + txt(nombre(x.liberado_por)) + ': si lo cambias, vuelve a revisión.' : '') + '</span>',
      campos: campos,
      alMontar: function (form, dw) {
        dw.el.addEventListener('click', function (ev) {
          var b;
          if ((b = ev.target.closest('.js-ci2-item-mas'))) {
            var c = m.campos.filter(function (k) { return k.clave === b.getAttribute('data-campo'); })[0];
            b.parentNode.querySelector('.ci2-items__filas').insertAdjacentHTML('beforeend', filaItem(c, {}));
          } else if ((b = ev.target.closest('.js-ci2-item-menos'))) {
            b.closest('.ci2-items__fila').remove();
          } else if ((b = ev.target.closest('.js-ci2-chk-ok'))) {
            b.closest('.ci2-check').querySelectorAll('select[data-item]').forEach(function (s) { if (!s.value || s.value === 'PENDIENTE') s.value = 'OK'; });
          }
        });
        if (x) api('getRegistroCI', { registro_id: x.registro_id }).then(function (r) {
          var h = dw.el.querySelector('.js-ci2-historial');
          if (!h) return;
          var l = (r && r.ok && r.data.historial) || [];
          resolverPersonas(l.map(function (k) { return { email: k.usuario_email }; })).then(function () {
            h.innerHTML = '<span class="sx2-campo__et">Historial</span>' + (l.length ? '<ol class="ci2-hist">' + l.map(function (k) {
              return '<li><b>' + txt(nombre(k.usuario_email)) + '</b> · ' + txt(PY.fecha(k.fecha, true)) + ' — ' + txt(k.detalle || k.accion) + '</li>';
            }).join('') + '</ol>' : '<p class="sx2-tenue">Sin cambios registrados.</p>');
          });
        });
      },
      preparar: function (v, form) {
        var p = { matriz: m.clave, datos: {} };
        if (x) p.registro_id = x.registro_id;
        var cli = String(v.cliente || '').trim();
        if (!x || cli !== cliVal) {
          var hallado = (cfg_.clientes || []).filter(function (c) { return etiquetaCliente(c) === cli; })[0];
          if (hallado) { p.cliente_id = hallado.cliente_id; } else { if (cli.length < 3) return 'Elige el cliente o escribe su nombre.'; p.cliente_id = ''; p.cliente_nombre = cli; }
        }
        if (nuevo && m.periodica) p.periodo = v.periodo;
        if (!m.estadoCalculado) p.estado = v.estado;
        p.responsable_email = v.responsable_email || '';
        p.observaciones = v.observaciones || '';
        m.campos.forEach(function (c) {
          if (c.tipo === 'items') {
            p.datos[c.clave] = [].map.call(form.querySelectorAll('.ci2-items[data-campo="' + c.clave + '"] .ci2-items__fila'), function (filaEl) {
              var o = {};
              filaEl.querySelectorAll('[data-sub]').forEach(function (el) { o[el.getAttribute('data-sub')] = el.value; });
              return o;
            });
          } else if (c.tipo === 'checklist') {
            var o = {};
            c.grupos.forEach(function (g) {
              var items = {};
              form.querySelectorAll('select[data-grupo="' + g.clave + '"]').forEach(function (s) { items[s.getAttribute('data-item')] = s.value; });
              o[g.clave] = { quien: v['chk_' + g.clave + '_quien'] || '', fecha: v['chk_' + g.clave + '_fecha'] || '', items: items };
            });
            p.datos[c.clave] = o;
          } else {
            p.datos[c.clave] = v['d_' + c.clave] !== undefined ? v['d_' + c.clave] : '';
          }
        });
        return p;
      },
      enviar: function (p) { return api('guardarRegistroCI', p); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Guardado.'; },
      listo: function () { abrirMatriz(m.clave, true); }
    });
    return dr;
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
  function lote(accion, extra) {
    var ids = marcados();
    if (!ids.length) return;
    api('accionLoteCI', Object.assign({ matriz: lista_.matriz, accion: accion, ids: ids }, extra || {})).then(resultadoLote);
  }
  function formResponsable() {
    var ids = marcados();
    U.formulario({ titulo: 'Asignar responsable', boton: 'Asignar',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + ids.length + (ids.length === 1 ? ' registro' : ' registros') + '</span>',
      campos: U.campo('Quién lo realiza', '<input class="sx2-input" type="email" data-persona name="responsable_email" required>'),
      preparar: function (v) { return v.responsable_email ? v : 'Elige a la persona.'; },
      enviar: function (v) { return api('accionLoteCI', { matriz: lista_.matriz, accion: 'responsable', ids: ids, responsable_email: v.responsable_email }); },
      aviso: function (r) { return (r && r.data && r.data.message) || 'Listo.'; },
      listo: function () { sel_ = {}; abrirMatriz(lista_.matriz, true); } });
  }
  function excelMatriz() {
    var m = matriz(lista_.matriz);
    var cols = ['Cliente', 'RUT', 'Período'].concat(m.campos.map(function (c) { return c.etiqueta; }), ['Estado', 'Responsable', 'Liberado por', 'Fecha liberación', 'Observaciones']);
    var filas = filtrados().map(function (x) {
      var e = estadoDe(m, x.estado);
      return [x.cliente_nombre, x.cliente_rut, perTexto(x.periodo)].concat(m.campos.map(function (c) {
        var v = (x.datos || {})[c.clave];
        if (c.tipo === 'items') return (Array.isArray(v) ? v : []).map(function (it) { return c.subcampos.map(function (sc) { return it[sc.clave]; }).filter(function (k) { return k !== '' && k !== undefined; }).join(' / '); }).join(' | ');
        if (c.tipo === 'checklist') return x.avance ? x.avance.pct + ' %' : '';
        if (c.tipo === 'fecha') return v ? fecha(v) : '';
        if (c.tipo === 'persona') return v ? nombre(v) : '';
        if (c.tipo === 'monto' || c.tipo === 'numero') return v === '' || v === undefined ? '' : Number(v);
        return v === undefined ? '' : v;
      }), [{ v: e.etiqueta, tono: e.tono }, nombre(x.responsable_email), x.liberado_por ? nombre(x.liberado_por) : '', fecha(x.fecha_liberacion), x.observaciones]);
    });
    if (!window.SigsoReportes || !SigsoReportes.descargarExcelDeDatos) { PY.aviso('No está disponible la descarga a Excel.', 'error'); return; }
    SigsoReportes.descargarExcelDeDatos({ titulo: m.nombre + ' · ' + perTexto(periodo_, true), subtitulo: depto(m.depto).nombre + ' · Control interno',
      meta: [['Período', perTexto(periodo_, true)], ['Registros', String(filas.length)]], hojas: [{ nombre: m.nombre.slice(0, 30), columnas: cols, filas: filas }],
      nombreArchivo: m.nombre + ' ' + perTexto(periodo_) }, { boton: raiz().querySelector('.js-ci2-excel') });
  }

  // =========================================================================================
  // Reportes
  // =========================================================================================
  function vistaReportes() {
    if (!cfg_.matrices.length) { pagina(cabecera('Control interno', 'Reportes', '') + U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'Sin departamentos asignados' }) })); return; }
    if (!matriz(rep_.matriz)) rep_.matriz = cfg_.matrices[0].clave;
    var t = ++turno_;
    pintarReporte(true);
    var hasta = periodoActual();
    api('reporteControlInterno', { matriz: rep_.matriz, desde: mover(hasta, -(rep_.meses - 1)), hasta: hasta }).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { error(r); return; }
      rep_.datos = r.data;
      resolverPersonas(r.data.por_responsable.concat(r.data.arrastre)).then(function () { if (t === turno_) pintarReporte(false); });
    });
  }
  function pintarReporte(cargando) {
    var opciones = cfg_.departamentos.map(function (d) {
      return '<optgroup label="' + U.esc(d.nombre) + '">' + cfg_.matrices.filter(function (m) { return m.depto === d.clave; }).map(function (m) {
        return '<option value="' + U.esc(m.clave) + '"' + (m.clave === rep_.matriz ? ' selected' : '') + '>' + U.esc(m.nombre) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    var barra = '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:1"><div class="sx2-barra-filtros">' +
      '<select class="sx2-select js-ci2-rep-matriz" aria-label="Matriz">' + opciones + '</select>' +
      select('', [[6, 'Últimos 6 meses'], [12, 'Últimos 12 meses'], [24, 'Últimos 24 meses']], rep_.meses, 'class="sx2-select js-ci2-rep-meses" aria-label="Rango"') +
      U.boton({ texto: 'Excel', icono: 'descargar', clase: 'js-ci2-rep-excel' }) + '</div></div>';
    var cab = cabecera('Control interno', 'Reportes', 'Lo que hoy no se puede sacar del Drive: mes a mes, por responsable, por cliente y lo que se arrastra.');
    var d = rep_.datos;
    if (cargando || !d || d.matriz !== rep_.matriz) { pagina(cab + barra + U.esqueleto('kpis', 5) + U.esqueleto('tabla', 6)); return; }
    var m = matriz(d.matriz), t = d.total;
    var pctFin = t.total ? Math.round(100 * t.finalizados / t.total) : 0;
    var pctLib = t.finalizados ? Math.round(100 * t.liberados / t.finalizados) : 0;
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, etiqueta: 'Registros', valor: t.total, icono: 'tabla', tono: 'primario', unidad: perTexto(d.desde) + ' a ' + perTexto(d.hasta) }) +
      U.kpi({ i: 1, etiqueta: 'Terminados', valor: pctFin, sufijo: ' %', icono: 'check', tono: pctFin >= 90 ? 'ok' : 'alerta', progreso: pctFin }) +
      U.kpi({ i: 2, etiqueta: 'Liberados de lo terminado', valor: pctLib, sufijo: ' %', icono: 'escudoCheck', tono: pctLib >= 90 ? 'ok' : 'alerta', progreso: pctLib }) +
      U.kpi({ i: 3, etiqueta: 'Arrastran meses', valor: d.arrastre.length, icono: 'reloj', tono: d.arrastre.length ? 'critico' : 'ok', titulo: 'Sin terminar en meses ya cerrados' }) +
      U.kpi({ i: 4, etiqueta: 'Clientes fuera del catálogo', valor: d.fuera_catalogo, icono: 'empresa', tono: d.fuera_catalogo ? 'alerta' : 'ok' }) + '</div>';
    var atencion = U.card({ i: 5, titulo: 'Lo que requiere atención', icono: 'alerta', cuerpo: d.arrastre.length
      ? '<ul class="ci2-arrastre">' + d.arrastre.slice(0, 12).map(function (a) {
          var e = estadoDe(m, a.estado);
          return '<li>' + U.badge(perTexto(a.periodo), 'critico', true) + '<b>' + txt(a.cliente_nombre) + '</b>' + U.badge(e.etiqueta, e.tono) + '<span class="sx2-tenue">' + txt(nombre(a.responsable_email)) + '</span></li>';
        }).join('') + '</ul>' + (d.arrastre.length > 12 ? '<p class="sx2-tenue">Y ' + (d.arrastre.length - 12) + ' más en el Excel.</p>' : '')
      : '<p class="sx2-tenue" style="margin:0">Nada quedó sin terminar en los meses anteriores.</p>' });
    // Los meses vacíos del comienzo del rango no aportan: se parte en el primero con datos.
    var primero = 0;
    while (primero < d.por_mes.length - 1 && !d.por_mes[primero].total) primero++;
    var porMes = d.por_mes.slice(primero);
    var maxMes = Math.max.apply(null, porMes.map(function (x) { return x.total; }).concat([1]));
    var meses = U.card({ i: 6, titulo: 'Mes a mes', icono: 'grafico', sub: 'terminados y pendientes', cuerpo: '<ul class="ci2-meses">' + porMes.map(function (x) {
      var wf = 100 * x.finalizados / maxMes, wp = 100 * x.pendientes / maxMes;
      return '<li><span class="ci2-meses__mes">' + U.esc(perTexto(x.periodo)) + '</span><span class="ci2-meses__barra"><span class="ci2-meses__fin" style="width:' + wf.toFixed(1) + '%"></span><span class="ci2-meses__pen" style="width:' + wp.toFixed(1) + '%"></span></span>' +
        '<span class="ci2-meses__n">' + x.total + (x.pendientes ? ' <small>(' + x.pendientes + ' pend.)</small>' : '') + '</span></li>';
    }).join('') + '</ul><p class="ci2-leyenda"><span class="ci2-leyenda__fin"></span>Terminados <span class="ci2-leyenda__pen"></span>Pendientes</p>' });
    var conCasos = d.tiempos ? d.tiempos.por_mes.filter(function (x) { return x.promedio !== null; }) : [];
    var tiempos = d.tiempos ? U.card({ i: 7, titulo: 'Días de respuesta', icono: 'reloj', sub: d.tiempos.desde + ' → ' + d.tiempos.hasta, cuerpo: conCasos.length
      ? '<ul class="ci2-meses">' + conCasos.map(function (x) {
        return '<li><span class="ci2-meses__mes">' + U.esc(perTexto(x.periodo)) + '</span><span class="ci2-meses__n" style="text-align:left"><b>' + String(x.promedio).replace('.', ',') + '</b> días en promedio <small>(' + x.casos + (x.casos === 1 ? ' caso' : ' casos') + ')</small></span></li>';
      }).join('') + '</ul>'
      : '<p class="sx2-tenue" style="margin:0">Todavía no hay registros con las dos fechas para calcularlo.</p>' }) : '';
    var resp = U.card({ i: 8, titulo: 'Por responsable', icono: 'equipo', sinRelleno: true, cuerpo: d.por_responsable.length ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Persona</th><th class="sx2-num">Registros</th><th class="sx2-num">Terminados</th><th class="sx2-num">Liberados</th></tr></thead><tbody>' +
      d.por_responsable.map(function (p) { return '<tr><td>' + txt(nombre(p.email)) + '</td><td class="sx2-num">' + p.total + '</td><td class="sx2-num">' + p.finalizados + '</td><td class="sx2-num">' + p.liberados + '</td></tr>'; }).join('') + '</tbody></table></div>' : U.vacio({ titulo: 'Sin registros' }) });
    var cli = U.card({ i: 9, titulo: 'Por cliente', icono: 'empresa', sub: 'los 25 con más registros', sinRelleno: true, cuerpo: d.por_cliente.length ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Cliente</th><th class="sx2-num">Registros</th><th class="sx2-num">Pendientes</th></tr></thead><tbody>' +
      d.por_cliente.map(function (c) { return '<tr><td>' + txt(c.cliente_nombre) + (c.fuera_catalogo ? ' ' + U.badge('Fuera del catálogo', 'alerta', true) : '') + '</td><td class="sx2-num">' + c.total + '</td><td class="sx2-num">' + c.pendientes + '</td></tr>'; }).join('') + '</tbody></table></div>' : U.vacio({ titulo: 'Sin registros' }) });
    pagina(cab + barra + kpis + atencion + '<div class="ci2-rep-grid">' + meses + tiempos + '</div><div class="ci2-rep-grid">' + resp + cli + '</div>', true);
  }
  function excelReporte() {
    var d = rep_.datos;
    if (!d) return;
    var m = matriz(d.matriz);
    SigsoReportes.descargarExcelDeDatos({ titulo: 'Reporte · ' + m.nombre, subtitulo: perTexto(d.desde, true) + ' a ' + perTexto(d.hasta, true),
      meta: [['Matriz', m.nombre], ['Departamento', depto(m.depto).nombre], ['Desde', perTexto(d.desde, true)], ['Hasta', perTexto(d.hasta, true)]],
      hojas: [
        { nombre: 'Mes a mes', columnas: ['Mes', 'Registros', 'Terminados', 'Pendientes', 'Liberados'].concat(d.tiempos ? ['Días promedio (' + d.tiempos.desde + ' → ' + d.tiempos.hasta + ')'] : []),
          filas: d.por_mes.map(function (x, i) { return [perTexto(x.periodo), x.total, x.finalizados, x.pendientes, x.liberados].concat(d.tiempos ? [d.tiempos.por_mes[i].promedio === null ? '' : d.tiempos.por_mes[i].promedio] : []); }) },
        { nombre: 'Por responsable', columnas: ['Persona', 'Registros', 'Terminados', 'Liberados'], filas: d.por_responsable.map(function (p) { return [nombre(p.email), p.total, p.finalizados, p.liberados]; }) },
        { nombre: 'Por cliente', columnas: ['Cliente', 'Fuera del catálogo', 'Registros', 'Pendientes'], filas: d.por_cliente.map(function (c) { return [c.cliente_nombre, c.fuera_catalogo ? 'Sí' : '', c.total, c.pendientes]; }) },
        { nombre: 'Arrastran meses', columnas: ['Mes', 'Cliente', 'Estado', 'Responsable'], filas: d.arrastre.map(function (a) { var e = estadoDe(m, a.estado); return [perTexto(a.periodo), a.cliente_nombre, { v: e.etiqueta, tono: e.tono }, nombre(a.responsable_email)]; }) }
      ], nombreArchivo: 'Reporte ' + m.nombre }, { boton: raiz().querySelector('.js-ci2-rep-excel') });
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
          aviso('info', 'escudoCheck', 'Quién <b>libera</b> cada área se define en un solo lugar para Calidad y Control interno: Calidad › Servicios prestados › <b>Quién libera</b>.') +
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
  // Importar desde Excel (ADM): las planillas del Drive, hoja por hoja
  // =========================================================================================
  var MESES_RE = /(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)/i;
  // Hojas que vale la pena mandar: las del año elegido, y las que no son "de un mes"
  // (las de RR.HH. y las listas de Anotaciones). El servidor decide el resto.
  function hojaDelAnio(nombre_, anio) { return /20\d\d/.test(nombre_) ? nombre_.indexOf(anio) !== -1 : !MESES_RE.test(nombre_); }
  function abrirImportar() {
    var est = { paso: 'elegir', archivos: [], anio: String(new Date().getFullYear()), resultados: [], avance: '', error: '' };
    var dr = U.drawer({ titulo: 'Importar desde Excel', subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Las planillas del Drive. Se importa solo el año elegido y volver a importar no duplica.</span>', cuerpo: '', pie: ' ' });
    dr.el.classList.add('sx2-drawer--ancho');
    function totales() {
      var t = { nuevas: 0, ya: 0, dup: 0, fuera: 0, hojas: 0, omitidas: 0, sinCuenta: {}, fueraEj: {}, errores: [] };
      est.resultados.forEach(function (r) {
        if (r.omitida || !r.matriz) { t.omitidas++; return; }
        t.hojas++; t.nuevas += r.nuevas || 0; t.ya += r.ya_estaban || 0; t.dup += r.duplicadas || 0; t.fuera += r.fuera_catalogo || 0;
        (r.sin_cuenta || []).forEach(function (n) { t.sinCuenta[n] = true; });
        (r.fuera_catalogo_ejemplos || []).forEach(function (n) { t.fueraEj[n] = true; });
        (r.errores || []).forEach(function (e) { if (t.errores.length < 10) t.errores.push(r.hoja + ': ' + e); });
      });
      return t;
    }
    function pintar() {
      var c = '', p = '';
      if (est.paso === 'elegir') {
        c = '<div class="sx2-form">' +
          U.campo('Planillas (.xlsx)', '<input class="sx2-input js-ci2-imp-arch" type="file" accept=".xlsx" multiple>', 'Puedes elegir varias a la vez: facturación, IVA, contabilización, convenios, acuse, anotaciones y el control de matrices de RR.HH.') +
          U.campo('Año a importar', select('', [['2026', '2026'], ['2025', '2025'], ['2024', '2024']], est.anio, 'class="sx2-select js-ci2-imp-anio"'), 'Lo acordado: 2026 completo. Los años anteriores quedan en el Drive.') +
          (est.archivos.length ? '<p class="sx2-tenue" style="margin:0">' + est.archivos.length + (est.archivos.length === 1 ? ' archivo elegido' : ' archivos elegidos') + '</p>' : '') +
          (est.error ? '<p class="sx2-campo__error">' + txt(est.error) + '</p>' : '') + '</div>';
        p = '<span style="flex:1"></span>' + U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) + U.boton({ texto: 'Revisar', icono: 'lupa', variante: 'primario', clase: 'js-ci2-imp-revisar', deshabilitado: !est.archivos.length });
      } else if (est.paso === 'revisando' || est.paso === 'importando') {
        c = '<div class="ci2-imp-avance">' + U.ico('reloj', 18) + '<span>' + txt(est.avance) + '</span></div>';
        p = ' ';
      } else {
        var t = totales();
        var filas = est.resultados.filter(function (r) { return r.matriz && !r.omitida; });
        var listo = est.paso === 'listo';
        c = (listo ? aviso('ok', 'check', '<b>' + t.nuevas + ' registros importados</b> en ' + t.hojas + ' hojas.') :
            aviso(t.nuevas ? 'info' : 'alerta', 'info', 'Se importarían <b>' + t.nuevas + ' registros</b> de ' + t.hojas + ' hojas' + (t.ya ? ' (' + t.ya + ' ya estaban importados)' : '') + '. No se ha guardado nada todavía.')) +
          (t.dup ? aviso('info', 'copiar', t.dup + ' filas aparecen repetidas tal cual dentro de la misma planilla: se importan una vez.') : '') +
          (t.fuera ? aviso('alerta', 'empresa', t.fuera + ' registros con clientes que no calzan con el catálogo de SIGSO (quedan con su nombre y marcados “Fuera del catálogo”). Ej.: ' + txt(Object.keys(t.fueraEj).slice(0, 6).join(', ')) + '.') : '') +
          (Object.keys(t.sinCuenta).length ? aviso('info', 'persona', 'Responsables sin cuenta en SIGSO (quedan en observaciones): ' + txt(Object.keys(t.sinCuenta).join(', ')) + '.') : '') +
          (t.errores.length ? aviso('critico', 'alerta', 'Filas con problemas: ' + txt(t.errores.join(' · '))) : '') +
          '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Hoja</th><th>Matriz</th><th class="sx2-num">' + (listo ? 'Importadas' : 'Nuevas') + '</th><th class="sx2-num">Ya estaban</th><th class="sx2-num">Otro año</th><th class="sx2-num">Fuera del catálogo</th></tr></thead><tbody>' +
          filas.map(function (r) {
            return '<tr><td>' + txt(r.hoja) + '<br><small class="sx2-tenue">' + txt(r.archivo) + '</small></td><td>' + txt(r.nombre) + '</td><td class="sx2-num"><b>' + r.nuevas + '</b></td><td class="sx2-num">' + (r.ya_estaban || 0) + '</td><td class="sx2-num">' + (r.otro_anio || 0) + '</td><td class="sx2-num">' + (r.fuera_catalogo || 0) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          (t.omitidas ? '<p class="sx2-tenue" style="margin:8px 0 0;font-size:.8125rem">' + t.omitidas + ' hojas no corresponden a una matriz del módulo o son de otro año (listas auxiliares, fichas de texto libre, hojas vacías).</p>' : '');
        p = '<span style="flex:1"></span>' + (listo
          ? U.boton({ texto: 'Ver el resumen', icono: 'panel', variante: 'primario', clase: 'js-ci2-imp-fin' })
          : U.boton({ texto: 'Volver', clase: 'js-ci2-imp-volver' }) + U.boton({ texto: 'Importar ' + t.nuevas + ' registros', icono: 'subir', variante: 'primario', clase: 'js-ci2-imp-ok', deshabilitado: !t.nuevas }));
      }
      dr.cuerpo(c);
      dr.el.querySelector('.sx2-drawer__pie').innerHTML = p;
    }
    // Lee cada archivo y manda sus hojas de a una (simular o importar).
    function procesar(simular) {
      est.paso = simular ? 'revisando' : 'importando';
      est.resultados = [];
      var trabajos = [];
      return est.archivos.reduce(function (p, archivo) {
        return p.then(function () {
          est.avance = 'Leyendo ' + archivo.name + '…';
          pintar();
          return SigsoLectorXlsx.leer(archivo, { hojas: function (n) { return hojaDelAnio(n, est.anio); } }).then(function (hojas) {
            return hojas.reduce(function (q, h, k) {
              return q.then(function () {
                est.avance = (simular ? 'Revisando ' : 'Importando ') + archivo.name + ' › ' + h.hoja + ' (' + (k + 1) + ' de ' + hojas.length + ')';
                pintar();
                var filas = h.filas.filter(function (f) { return f.some(function (v) { return v !== undefined && v !== null && String(v).trim() !== ''; }); });
                if (!filas.length) return null;
                return api('importarHojaCI', { archivo: archivo.name, hoja: h.hoja, filas: filas, anio: est.anio, simular: simular }).then(function (r) {
                  if (r && r.ok) est.resultados.push(r.data);
                  else est.resultados.push({ archivo: archivo.name, hoja: h.hoja, omitida: false, matriz: '?', nombre: 'Error', nuevas: 0, errores: [(r && r.message) || 'No se pudo'] });
                });
              });
            }, Promise.resolve());
          });
        });
      }, Promise.resolve()).then(function () { est.paso = simular ? 'revisado' : 'listo'; pintar(); }, function (e) {
        est.paso = 'elegir'; est.error = (e && e.message) || 'No se pudo leer el archivo.'; pintar();
      });
    }
    dr.el.addEventListener('change', function (ev) {
      if (ev.target.classList.contains('js-ci2-imp-arch')) { est.archivos = [].slice.call(ev.target.files || []); est.error = ''; pintar(); }
      if (ev.target.classList.contains('js-ci2-imp-anio')) est.anio = ev.target.value;
    });
    dr.el.addEventListener('click', function (ev) {
      if (ev.target.closest('.js-ci2-imp-revisar')) {
        if (!window.SigsoLectorXlsx || typeof DecompressionStream === 'undefined') { est.error = 'Este navegador no puede leer .xlsx: usa Chrome o Edge actualizados.'; pintar(); return; }
        procesar(true);
      } else if (ev.target.closest('.js-ci2-imp-volver')) { est.paso = 'elegir'; pintar(); }
      else if (ev.target.closest('.js-ci2-imp-ok')) {
        U.confirmar({ titulo: '¿Importar los registros?', texto: 'Quedan en Control interno con su historial ("Importado de…"). Si después se vuelve a importar el mismo archivo, lo ya importado no se duplica.', boton: 'Importar' }).then(function (ok) { if (ok) procesar(false); });
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
    if (t.closest('.js-ci2-recargar')) { cfg_ = null; cargar(); return; }
    if ((b = t.closest('.js-ci2-per'))) { cambiarPeriodo(Number(b.getAttribute('data-n'))); return; }
    if ((b = t.closest('[data-ci2-ir]'))) { irAItem(b.getAttribute('data-ci2-ir')); return; }
    if (t.closest('.js-ci2-importar')) { abrirImportar(); return; }
    // Matriz
    if (t.closest('.js-ci2-nuevo')) { formRegistro(matriz(lista_.matriz), null); return; }
    if (t.closest('.js-ci2-excel')) { excelMatriz(); return; }
    if (t.closest('.js-ci2-abrir')) {
      var m = matriz(lista_.matriz);
      U.confirmar({ titulo: 'Abrir ' + perTexto(periodo_, true), texto: 'Se crean los registros de ' + m.nombre + ' con los clientes de ' + perTexto(lista_.periodo_anterior, true) + ', en estado inicial. Lo que ya está en este mes no se duplica.', boton: 'Abrir el mes' }).then(function (ok) {
        if (ok) api('abrirPeriodoCI', { matriz: m.clave, periodo: periodo_ }).then(function (r) {
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
          PY.aviso(r.data.message, 'exito');
          abrirMatriz(m.clave, true);
        });
      });
      return;
    }
    if (t.closest('.js-ci2-abrir-reg')) { var tr = t.closest('tr[data-id]'); if (tr) formRegistro(matriz(lista_.matriz), registroDe(tr.getAttribute('data-id'))); return; }
    if ((b = t.closest('.js-ci2-liberar-uno'))) {
      api('accionLoteCI', { matriz: lista_.matriz, accion: 'liberar', ids: [b.getAttribute('data-id')] }).then(resultadoLote);
      return;
    }
    if (t.closest('.js-ci2-limpiar')) { f_ = { q: '', estado: '', resp: '', liberar: false }; pintarMatriz(true); return; }
    if ((b = t.closest('.sx2-kpi--clic')) && b.getAttribute('data-filtro') === 'liberar') { f_.liberar = !f_.liberar; pintarMatriz(true); return; }
    if (t.closest('.js-ci2-desmarcar')) { sel_ = {}; pintarMatriz(true); return; }
    if (t.closest('.js-ci2-lote-resp')) { formResponsable(); return; }
    if ((b = t.closest('.js-ci2-lote'))) {
      var accion = b.getAttribute('data-accion'), n = marcados().length;
      if (accion === 'anular') {
        U.confirmar({ titulo: '¿Anular ' + n + (n === 1 ? ' registro?' : ' registros?'), texto: 'Dejan de contar en la matriz y en los reportes. Queda en el historial quién lo hizo.', boton: 'Anular', peligro: true }).then(function (ok) { if (ok) lote('anular'); });
      } else lote(accion);
      return;
    }
    // Reportes y accesos
    if (t.closest('.js-ci2-rep-excel')) { excelReporte(); return; }
    if ((b = t.closest('.js-ci2-acc-editar'))) { formAccesos(b.getAttribute('data-depto')); return; }
  });
  document.addEventListener('change', function (ev) {
    if (!mio(ev)) return;
    var t = ev.target;
    if (t.classList.contains('ci2-celda')) { guardarCelda(t); return; }
    if (t.classList.contains('js-ci2-sel')) { var id = t.closest('tr').getAttribute('data-id'); sel_[id] = t.checked; pintarMatriz(true); return; }
    if (t.classList.contains('js-ci2-todos')) { filtrados().forEach(function (x) { sel_[x.registro_id] = t.checked; }); pintarMatriz(true); return; }
    if (t.classList.contains('js-ci2-f')) { f_[t.getAttribute('data-f')] = t.value; pintarMatriz(true); return; }
    if (t.classList.contains('js-ci2-lote-estado') && t.value) { lote('estado', { estado: t.value }); return; }
    if (t.classList.contains('js-ci2-rep-matriz')) { rep_.matriz = t.value; rep_.datos = null; vistaReportes(); return; }
    if (t.classList.contains('js-ci2-rep-meses')) { rep_.meses = Number(t.value) || 12; rep_.datos = null; vistaReportes(); }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!mio(ev) || !ev.target.classList.contains('js-ci2-q')) return;
    var v = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () { f_.q = v; pintarMatriz(true); }, 180);
  });
  // Enter en una celda pasa a la de abajo (como en la planilla) y guarda.
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || !ev.target.classList || !ev.target.classList.contains('ci2-celda') || ev.target.tagName === 'SELECT' || !mio(ev)) return;
    ev.preventDefault();
    var td = ev.target.closest('td'), tr = td && td.parentNode, idx = tr ? [].indexOf.call(tr.children, td) : -1;
    var sig = tr && tr.nextElementSibling;
    ev.target.blur();
    if (sig && idx >= 0) { var el = sig.children[idx] && sig.children[idx].querySelector('.ci2-celda'); if (el) el.focus(); }
  });

  window.SigsoControlInterno = {
    cargar: cargar,
    refrescar: function () { if (!cfg_) cargar(); else mostrar(); },
    irAItem: irAItem
  };
})();
