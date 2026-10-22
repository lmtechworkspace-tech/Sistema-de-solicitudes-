/**
 * finanzas-cargas-v2.js — Cargas y migración (2026-10-20; FIN-17, FIN-18, FIN-33 y FIN-45;
 * backend/logica/finanzasCargas.js).
 *
 * Primero se CARGA (staging): el libro entero, hoja por hoja, con sus
 * fórmulas y hojas ocultas, sin tocar nada. Cada fila queda con su huella:
 * subir el mismo archivo o una fila ya cargada en otro no duplica. Después
 * se PUBLICA hoja por hoja, viendo antes a dónde va cada una; cada fila
 * termina Publicada, con observación, Incidencia o Histórica, y se puede
 * preguntar «¿dónde quedó?» por cualquiera.
 *
 * Corrección v2 I07: CENTRO ÚNICO. El mismo cuadro recibe la cartola del BCI,
 * el Registro de Ventas del SII, una tabla de saldos iniciales y los libros
 * SIGECO / BANCOS; reconoce el tipo y usa su lector de siempre (no se
 * reescriben). Lo que no se puede leer se dice ANTES de prometer nada. Las
 * filas con problema se corrigen o se apartan aquí (el original no se toca) y
 * cada carga tiene su cuadro de control (cantidades e importes por hoja).
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null, cat_ = null;
  var est_ = { lotes: null, lote: '', hoja: '', estado: '', datos: null, cuentas: [] };
  // I12.2/I12.4: al cerrarse la bóveda, la pantalla olvida las cifras que tenía cargadas.
  document.addEventListener('sigso-fin-cerrada', function () { est_.lotes = null; est_.datos = null; est_.cuentas = []; });
  var TONO = { PENDIENTE: 'info', PUBLICADA: 'ok', PARCIAL: 'alerta', INCIDENCIA: 'critico', HISTORICA: 'neutro', REPETIDA: 'neutro', APARTADA: 'neutro' };
  function plata(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function opciones(l, actual, vacio) { return (vacio !== undefined ? '<option value="">' + txt(vacio) + '</option>' : '') + l.map(function (o) { return '<option value="' + txt(o[0]) + '"' + (String(o[0]) === String(actual) ? ' selected' : '') + '>' + txt(o[1]) + '</option>'; }).join(''); }
  function sha256(buf) {
    return crypto.subtle.digest('SHA-256', buf).then(function (h) { return Array.prototype.map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); });
  }

  function ver(x, modo) {
    x_ = x; est_.modo = modo || 'cargas';
    var vista = est_.modo === 'migracion' ? 'migracion' : 'cargas';
    var t = x.turno();
    x.pagina(x.cab(vista) + U.esqueleto('tabla', 6));
    Promise.all([x.catalogo(), x.api('finanzasFuentes'), x.api('finanzasResumenBancos'), est_.modo === 'migracion' ? x.api('finanzasMejoras') : Promise.resolve(null)]).then(function (rs) {
      if (!x.vigente(t)) return;
      cat_ = rs[0];
      if (!rs[1] || !rs[1].ok) { if (rs[1] && !rs[1].boveda_cerrada) x.pagina(x.cab(vista) + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: (rs[1] && rs[1].message) || '' }) })); return; }
      est_.lotes = rs[1].data; est_.cuentas = rs[2] && rs[2].ok ? rs[2].data.cuentas : [];
      est_.mejoras = rs[3] && rs[3].ok ? rs[3].data.mejoras : null;
      pintar(vista);
    });
  }
  function pintar(vista) {
    var L = est_.lotes;
    x_.pagina(x_.cab(vista) + '<div class="fin2-cargas">' +
      U.card({ titulo: 'Subir un archivo', icono: 'subir', cuerpo:
        '<div data-cap="MIGRAR|REGISTRAR|FONDOS"><label class="fin2-soltar js-fca-soltar" tabindex="0"><input type="file" class="js-fca-archivo" accept=".xlsx,.xlsm,.csv,.gz,.txt" hidden>' + U.ico('subir', 26) +
          '<b>Arrastra aquí el archivo</b><span>SIGSO reconoce qué es y te muestra qué hará antes de guardar nada. Se lee en tu navegador (con fórmulas y hojas ocultas); al servidor viaja cifrado.</span></label>' +
        '<table class="fin2-tabla fin2-tabla--chica fin2-cargas__tipos"><thead><tr><th>Qué subes</th><th>Cómo lo reconoce</th><th>Dónde queda</th></tr></thead><tbody>' +
          '<tr><td>Cartola del BCI (.xlsx)</td><td>Formato de cartola con saldos</td><td>Libro del banco: se une con lo anotado; lo demás queda «falta anotar»</td></tr>' +
          '<tr><td>Registro de Ventas del SII (.csv, .gz)</td><td>Columnas «Tipo Doc» y «Folio»</td><td>Facturas (Cobranza)</td></tr>' +
          '<tr><td>Saldos iniciales de fondos (.xlsx)</td><td>Cliente/RUT, fecha de corte, monto y fuente</td><td>Saldos propuestos (Fondos)</td></tr>' +
          '<tr><td>Planilla SIGECO o Excel BANCOS (.xlsx)</td><td>Sus hojas conocidas</td><td>Revisión por hoja antes de publicar</td></tr>' +
          '<tr><td>Detalle del banco</td><td>—</td><td>Se sube en <button type="button" class="sx2-enlace js-fca-ir" data-vista="bancos">Bancos</button> (hay que elegir la cuenta)</td></tr>' +
          '<tr><td>Filas sueltas de Excel</td><td>—</td><td><button type="button" class="sx2-enlace js-fca-ir" data-vista="planilla">Planilla · Ctrl+V o «Pegar desde Excel»</button></td></tr>' +
          '<tr><td>Cartola de Santander</td><td colspan="2"><b>Aún no se puede leer:</b> falta una cartola real para construir y probar su lector. Mientras tanto, los movimientos de Santander anotados en el Excel BANCOS entran como borradores con su origen.</td></tr>' +
        '</tbody></table>' +
        '<div class="js-fca-progreso" aria-live="polite"></div></div>' }) +
      U.card({ titulo: 'Archivos cargados', icono: 'carpeta', sub: L.lotes.length + ' archivo(s)', sinRelleno: true, cuerpo: L.lotes.length ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Archivo</th><th>Tipo</th><th>Cargado</th><th>Hojas</th><th>Estado de las filas</th><th></th></tr></thead><tbody>' + L.lotes.map(function (l) {
        var tot = {}; l.hojas.forEach(function (h) { Object.keys(h.por_estado).forEach(function (k) { tot[k] = (tot[k] || 0) + h.por_estado[k]; }); });
        return '<tr><td><b>' + txt(l.nombre) + '</b></td><td>' + txt(l.tipo) + '</td><td class="fin2-num">' + txt(String(l.creado_en || '').slice(0, 16).replace('T', ' ')) + '<br><small class="fin2-ayuda">' + txt(l.creado_por) + '</small></td><td>' + l.hojas.length + '</td>' +
          '<td>' + Object.keys(tot).map(function (k) { return U.badge(L.estados[k] + ' ' + tot[k], TONO[k]); }).join(' ') + '</td><td>' + U.boton({ texto: 'Abrir', sm: true, clase: 'js-fca-lote', datos: { id: l.id } }) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'carpeta', texto: 'Todavía no se carga ninguna planilla.' }) }) +
      (est_.mejoras ? U.card({ titulo: 'Pedidos de mejora (hoja MEJORAS)', icono: 'bombilla', sub: 'y qué los atiende', cuerpo: est_.mejoras.length ? '<ul class="fin2-lista-saldos">' + est_.mejoras.map(function (m) {
        return '<li><span>' + txt(m.idea || '') + '<small>' + txt([m.fecha, m.quien, m.hoja, m.estado, m.comentario].filter(Boolean).join(' · ')) + '</small></span><span class="fin2-ayuda">' + txt(m.funcionalidad || 'Sin funcionalidad asociada todavía') + '</span></li>';
      }).join('') + '</ul>' : '<p class="fin2-ayuda">Se llena al publicar la hoja MEJORAS de la planilla SIGECO.</p>' }) : '') +
    '</div>');
    x_.aplicarCapacidades(x_.raiz());
  }

  // ---- subir ---------------------------------------------------------------------------
  function subir(archivo) {
    var prog = x_.raiz().querySelector('.js-fca-progreso');
    if (!archivo) return;
    if (/\.(csv|gz|txt)$/i.test(archivo.name)) { subirVentas(archivo, prog); return; }
    if (!/\.xls[xm]$/i.test(archivo.name)) { prog.innerHTML = '<div class="fin2-cinta fin2-cinta--alerta">' + U.ico('alerta', 16) + '<span>Ese formato no se puede leer (' + txt(archivo.name) + '). Aquí entran Excel (.xlsx) y el Registro de Ventas del SII (.csv o .gz). Un PDF o una imagen no se importan.</span></div>'; return; }
    if (!window.SigsoLectorXlsx || !window.crypto || !crypto.subtle) { x_.aviso('Este navegador no puede leer el archivo.', 'error'); return; }
    prog.innerHTML = '<p class="fin2-ayuda">Leyendo ' + txt(archivo.name) + '…</p>';
    archivo.arrayBuffer().then(function (buf) {
      return Promise.all([sha256(buf), SigsoLectorXlsx.leer(archivo, { formulas: true })]);
    }).then(function (rs) {
      var hojas = rs[1].map(function (h) { return { nombre: h.hoja, oculta: !!h.oculta, filas: h.filas, formulas: h.formulas || [] }; });
      // 1) ¿Saldos iniciales? (títulos de cliente, corte, monto y fuente en la primera fila)
      var t0 = ((hojas[0] && hojas[0].filas[0]) || []).map(function (c) { return String(c || '').toUpperCase(); }).join('|');
      if (/CLIENTE|RUT/.test(t0) && /CORTE/.test(t0) && /MONTO|SALDO/.test(t0) && /FUENTE|RESPALDO/.test(t0)) { subirAperturas(hojas[0].filas, archivo.name, prog); return null; }
      // 2) ¿Cartola del banco? (su lector de siempre decide)
      prog.innerHTML = '<p class="fin2-ayuda">' + hojas.length + ' hoja(s) leídas · reconociendo…</p>';
      return x_.api('finanzasRevisarCartola', { filas: (hojas[0] && hojas[0].filas) || [] }).then(function (rc) {
        if (rc && rc.ok && hojas.length === 1) { mostrarCartola(rc.data, hojas[0].filas, archivo.name, prog); return null; }
        // v3: el Excel BANCOS se lleva mes a mes al libro del banco (cada fila con su movimiento, su OBS y sus grupos).
        if (hojas.some(esHojaBancos)) { mostrarBancos(hojas, archivo.name, prog); return null; }
        // 3) Libro SIGECO o BANCOS: staging (nada se publica todavía).
        prog.innerHTML = '<p class="fin2-ayuda">' + hojas.length + ' hoja(s) leídas · cargando sin publicar…</p>';
        return x_.api('finanzasCargarLibro', { hash: rs[0], nombre: archivo.name, hojas: hojas });
      });
    }).then(function (r) {
      if (r === null) return;
      if (!r || !r.ok) {
        var irA = r && r.codigo === 'FUENTE_NO_SOPORTADA';
        prog.innerHTML = '<div class="fin2-cinta fin2-cinta--' + (irA ? 'alerta' : 'critico') + '">' + U.ico('alerta', 16) + '<span>' + txt((r && r.message) || 'No se pudo cargar.') + '</span></div>';
        return;
      }
      if (r.data.repetido) { prog.innerHTML = '<div class="fin2-cinta fin2-cinta--info">' + U.ico('info', 16) + '<span>' + txt(r.data.mensaje) + '</span></div>'; abrirLote(r.data.lote_id); return; }
      x_.aviso('Archivo cargado: ' + r.data.hojas.length + ' hoja(s). Nada se publicó todavía.', 'exito');
      abrirLote(r.data.lote_id, true);
    }).catch(function (e) { prog.innerHTML = '<p class="fin2-error">' + txt(e && e.message || 'No se pudo leer el archivo.') + '</p>'; });
  }

  // ---- centro único: cada tipo con su lector de siempre ------------------------------------
  function cinta(tono, html) { return '<div class="fin2-cinta fin2-cinta--' + tono + '">' + U.ico(tono === 'ok' ? 'check' : tono === 'info' ? 'info' : 'alerta', 16) + '<span>' + html + '</span></div>'; }
  function mostrarCartola(v, filas, nombre, prog) {
    var emp = v.cuenta_conocida ? v.cuenta_conocida.empresa : '';
    prog.innerHTML = cinta(v.cuadra ? 'info' : 'critico', '<b>Cartola ' + txt(v.banco) + ' ···' + txt(v.ultimos4) + '</b> · ' + txt(v.desde) + ' al ' + txt(v.hasta) + ' · ' + v.movimientos + ' movimiento(s), ' + v.nuevas + ' nuevo(s)' +
      (v.cuadra ? ' · los saldos cuadran.' : ' · <b>los saldos NO cuadran</b>: ' + txt((v.errores || [])[0] || 'revisa el archivo antes de importar.'))) +
      ((v.avisos || []).length ? cinta('alerta', '<b>Ojo:</b> ' + v.avisos.map(txt).join(' ')) : '') +
      '<div class="fin2-acciones" style="justify-content:flex-start">' + (v.cuenta_conocida ? '<span class="fin2-ayuda">Cuenta de ' + txt(emp) + '</span>' : '<label class="fin2-campo fin2-campo--fila"><span>Empresa de la cuenta</span><select class="fin2-input fin2-input--sm js-fca-cemp">' + opciones((cat_.empresas || []).map(function (e) { return [e, e]; }), '', 'Elige…') + '</select></label>') +
      U.boton({ texto: v.nuevas ? 'Importar ' + v.nuevas + ' movimiento(s)' : 'Nada nuevo', icono: 'check', variante: 'primario', sm: true, clase: 'js-fca-icart', deshabilitado: !v.nuevas || !v.cuadra }) + '</div>';
    prog.querySelector('.js-fca-icart').addEventListener('click', function (ev) {
      var e = emp || (prog.querySelector('.js-fca-cemp') || {}).value;
      if (!e) { x_.aviso('Elige la empresa de la cuenta.', 'error'); return; }
      ev.currentTarget.disabled = true;
      x_.api('finanzasImportarCartola', { filas: filas, empresa: e, nombre_archivo: nombre }).then(function (r) {
        if (!r || !r.ok) { prog.innerHTML = cinta('critico', txt((r && r.message) || 'No se pudo importar.')); return; }
        var u = r.data.unidas || 0, falta = r.data.nuevas - u;
        prog.innerHTML = cinta('ok', '<b>Importada:</b> ' + r.data.nuevas + ' movimiento(s) del banco' + (u ? ' · <b>' + u + '</b> se unieron con lo anotado ✓' : '') +
          (falta ? ' · <b>' + falta + '</b> quedan «falta anotar»' : '') + '. <button type="button" class="sx2-enlace js-fca-ir" data-vista="planilla">Ir a la planilla</button>');
        if (r.data.periodo) x_.contexto({ periodo_hoja: r.data.periodo });
      });
    });
  }
  // ---- v3: Excel BANCOS → libro del banco ------------------------------------------------
  function encabezadoBancos(h) {
    for (var i = 0; i < Math.min(h.filas.length, 40); i++) {
      var f = (h.filas[i] || []).map(function (c) { return String(c == null ? '' : c).trim().toUpperCase(); });
      if (f.indexOf('FECHA') !== -1 && f.indexOf('TOTAL') !== -1 && f.indexOf('OBS') !== -1) return { fila: i, cab: f };
    }
    return null;
  }
  function esHojaBancos(h) { return !!encabezadoBancos(h); }
  function mesesDeHoja(h) {
    var e = encabezadoBancos(h); if (!e) return [];
    var iF = e.cab.indexOf('FECHA'), iT = e.cab.indexOf('TOTAL'), cuenta = {};
    h.filas.slice(e.fila + 1).forEach(function (f) {
      var n = Number((f || [])[iF]), t = Number((f || [])[iT]);
      if (!(n > 30000 && n < 60000) || !t) return;
      var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5).toISOString().slice(0, 7);
      cuenta[d] = (cuenta[d] || 0) + 1;
    });
    return Object.keys(cuenta).sort().map(function (m) { return { mes: m, filas: cuenta[m] }; });
  }
  function mostrarBancos(hojas, nombre, prog) {
    var lista = hojas.filter(esHojaBancos);
    x_.api('finanzasResumenBancos', {}).then(function (rb) {
      var cuentas = rb && rb.ok ? (rb.data.cuentas || []) : [];
      prog.innerHTML = cinta('info', '<b>Excel BANCOS · ' + txt(nombre) + '</b>: cada mes se lleva a la <b>planilla</b>. Cada fila se une a su movimiento de la cartola (o, si ese mes no tiene cartola, queda «esperando» la cartola), se clasifica como dice la columna OBS y se arman sus grupos de fondos. Repetirlo no duplica nada.') +
        lista.map(function (h, i) {
          return '<div class="fin3-hoja" data-i="' + i + '"><b>' + txt(h.nombre) + (h.oculta ? ' <small class="fin2-ayuda">(oculta)</small>' : '') + '</b>' +
            '<label class="fin2-campo fin2-campo--fila"><span>Cuenta</span><select class="fin2-input fin2-input--sm js-fca-bcta">' + opciones(cuentas.map(function (c) { return [c.id, c.banco + ' ···' + c.ultimos4 + ' · ' + c.empresa]; }), /BCI/i.test(h.nombre) && cuentas[0] ? cuentas[0].id : '', 'Elige la cuenta…') + '</select></label>' +
            '<span class="fin3-hoja__meses">' + mesesDeHoja(h).map(function (m) { return U.boton({ texto: 'Llevar ' + m.mes + ' (' + m.filas + ')', sm: true, clase: 'js-fca-bmes', datos: { mes: m.mes, i: i, cap: 'MIGRAR' } }); }).join('') + '</span></div>';
        }).join('') + '<div class="js-fca-bres"></div>';
      prog.querySelectorAll('.js-fca-bmes').forEach(function (b) {
        b.addEventListener('click', function () {
          var h = lista[Number(b.dataset.i)];
          var cta = prog.querySelector('.fin3-hoja[data-i="' + b.dataset.i + '"] .js-fca-bcta').value;
          if (!cta) { x_.aviso('Elige a qué cuenta del banco corresponde la hoja.', 'error'); return; }
          b.disabled = true; b.setAttribute('aria-busy', 'true');
          x_.api('finanzasLlevarMesBancos', { filas: h.filas, formulas: h.formulas || [], periodo: b.dataset.mes, cuenta_ref: cta, archivo: nombre + ' · ' + h.nombre }).then(function (r) {
            b.disabled = false; b.removeAttribute('aria-busy');
            var res = prog.querySelector('.js-fca-bres');
            if (!r || !r.ok) { res.innerHTML = cinta('critico', txt((r && r.message) || 'No se pudo llevar el mes.')); return; }
            var d = r.data, gr = d.grupos.filter(function (g) { return g.gestion_id; });
            res.innerHTML = cinta(d.por_revisar.length || d.sin_banco.length ? 'alerta' : 'ok', '<b>' + txt(d.periodo) + ':</b> ' + d.filas + ' filas · ' + d.emparejadas + ' unidas a la cartola' +
              (d.creadas_sin_cartola ? ' · ' + d.creadas_sin_cartola + ' sin cartola (no verificadas)' : '') + (d.sin_banco.length ? ' · <b>' + d.sin_banco.length + ' que el banco no trae este mes</b>' : '') +
              ' · ' + d.clasificadas + ' clasificadas · ' + d.por_revisar.length + ' por revisar · ' + gr.length + ' grupos de fondos.') +
              (d.sin_banco.length ? '<details class="fin2-p"><summary>Filas de la planilla que no están en el banco de ' + txt(d.periodo) + '</summary><ul class="fin2-lista-saldos">' + d.sin_banco.map(function (s) { return '<li><span>' + txt(s.fecha) + ' · ' + txt(s.alias) + ' · ' + txt(s.obs) + '</span><b>' + txt(String(s.monto)) + '</b></li>'; }).join('') + '</ul></details>' : '') +
              '<div class="fin2-acciones" style="justify-content:flex-start">' + U.boton({ texto: 'Abrir la planilla de ' + d.periodo, icono: 'derecha', sm: true, variante: 'primario', clase: 'js-fca-alibro', datos: { mes: d.periodo } }) + '</div>';
            res.querySelector('.js-fca-alibro').addEventListener('click', function (ev) { x_.ir('planilla', { periodo_hoja: ev.currentTarget.dataset.mes }); });
          });
        });
      });
      x_.aplicarCapacidades(prog);
    });
  }

  function subirVentas(archivo, prog) {
    var leer = archivo.arrayBuffer();
    if (/\.gz$/i.test(archivo.name)) {
      if (typeof DecompressionStream === 'undefined') { prog.innerHTML = cinta('alerta', 'Este navegador no abre .gz: usa Chrome o Edge actualizados.'); return; }
      leer = leer.then(function (b) { return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); });
    }
    leer.then(function (b) { var t = new TextDecoder('utf-8').decode(b); if (t.indexOf('\uFFFD') !== -1) t = new TextDecoder('windows-1252').decode(b); return t; }).then(function (texto) {
      return x_.api('finanzasRevisarVentas', { texto: texto, nombre: archivo.name }).then(function (r) {
        if (!r || !r.ok) { prog.innerHTML = cinta('alerta', txt((r && r.message) || 'No se reconoce el archivo.') + ' Aquí entran el Registro de Ventas del SII (CSV del RCV) y los Excel de la tabla de arriba.'); return; }
        var v = r.data;
        prog.innerHTML = cinta('info', '<b>Registro de Ventas del SII</b> · ' + v.facturas + ' factura(s), ' + v.notas_credito + ' nota(s) de crédito · ' + v.nuevas + ' nueva(s)' + (v.sin_cliente ? ' · ' + v.sin_cliente + ' de clientes que no están en SIGSO (se guardan marcadas)' : '')) +
          '<div class="fin2-acciones" style="justify-content:flex-start"><label class="fin2-campo fin2-campo--fila"><span>Empresa emisora</span><select class="fin2-input fin2-input--sm js-fca-vemp">' + opciones((cat_.empresas || []).map(function (e) { return [e, e]; }), v.empresa_sugerida || '', 'Elige…') + '</select></label>' +
          U.boton({ texto: v.nuevas ? 'Importar ' + v.nuevas + ' documento(s)' : 'Nada nuevo', icono: 'check', variante: 'primario', sm: true, clase: 'js-fca-iven', deshabilitado: !v.nuevas }) + '</div>';
        prog.querySelector('.js-fca-iven').addEventListener('click', function (ev) {
          var e = prog.querySelector('.js-fca-vemp').value;
          if (!e) { x_.aviso('Elige la empresa que emitió estas facturas.', 'error'); return; }
          ev.currentTarget.disabled = true;
          x_.api('finanzasImportarVentas', { texto: texto, nombre: archivo.name, empresa: e }).then(function (q) {
            if (!q || !q.ok) { prog.innerHTML = cinta('critico', txt((q && q.message) || 'No se pudo importar.')); return; }
            var cf = q.data.conflictos || [];
            prog.innerHTML = cinta(cf.length ? 'alerta' : 'ok', '<b>Importado:</b> ' + q.data.nuevas + ' nuevo(s), ' + q.data.actualizadas + ' actualizado(s) desde el SII' + (cf.length ? ' · ' + cf.length + ' factura(s) NO se actualizaron: ya tienen más aplicado que el total nuevo' : '') + '. <button type="button" class="sx2-enlace js-fca-ir" data-vista="cobranza">Ir a Cobranza</button>');
          });
        });
      });
    }).catch(function () { prog.innerHTML = cinta('critico', 'No se pudo leer el archivo.'); });
  }
  function subirAperturas(filas, nombre, prog) {
    x_.api('finanzasRevisarAperturas', { filas: filas }).then(function (r) {
      if (!r || !r.ok) { prog.innerHTML = cinta('critico', txt((r && r.message) || 'No se pudo revisar.')); return; }
      var v = r.data;
      prog.innerHTML = cinta(v.incidentes ? 'alerta' : 'info', '<b>Saldos iniciales de fondos</b> · ' + v.aceptadas + ' aceptada(s), ' + v.incidentes + ' con incidentes · ' + Object.keys(v.totales_por_empresa).map(function (k) { return txt(k) + ' ' + plata(v.totales_por_empresa[k]); }).join(' · ')) +
        (v.incidentes ? '<ul class="fin2-razones">' + v.revision.filter(function (y) { return !y.ok; }).slice(0, 10).map(function (y) { return '<li>Fila ' + y.fila + ' · ' + txt(y.cliente) + ': ' + txt(y.errores.join(' · ')) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="fin2-acciones" style="justify-content:flex-start">' + U.boton({ texto: 'Proponer ' + v.aceptadas + ' saldo(s)', icono: 'check', variante: 'primario', sm: true, clase: 'js-fca-iap', deshabilitado: !v.aceptadas }) + '</div>';
      prog.querySelector('.js-fca-iap').addEventListener('click', function (ev) {
        ev.currentTarget.disabled = true;
        x_.api('finanzasProponerAperturas', { filas: filas, token: v.token, idempotency_key: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) }).then(function (q) {
          prog.innerHTML = q && q.ok ? cinta('ok', '<b>' + q.data.propuestas + ' saldo(s) inicial(es) propuesto(s)</b>: falta aprobarlos en <button type="button" class="sx2-enlace js-fca-ir" data-vista="fondos">Fondos</button>.') : cinta('critico', txt((q && q.message) || 'No se pudo.'));
        });
      });
    });
  }

  // ---- un lote ---------------------------------------------------------------------------
  function abrirLote(id, recargar) {
    est_.lote = id; est_.hoja = ''; est_.estado = '';
    (recargar ? x_.api('finanzasFuentes').then(function (r) { if (r && r.ok) est_.lotes = r.data; }) : Promise.resolve()).then(function () { cargarHoja(); });
  }
  function cargarHoja() {
    x_.api('finanzasFuente', { lote_id: est_.lote, hoja: est_.hoja, estado: est_.estado }).then(function (r) {
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo abrir.', 'error'); return; }
      est_.datos = r.data; est_.hoja = r.data.hoja.nombre;
      pintarLote();
    });
  }
  function pintarLote() {
    var d = est_.datos, l = (est_.lotes.lotes || []).filter(function (y) { return y.id === est_.lote; })[0] || { hojas: [] };
    var h = d.hoja;
    var esBci = d.lote.tipo === 'BANCOS' && /BCI/i.test(h.nombre);
    var info = l.hojas.filter(function (y) { return y.nombre === h.nombre; })[0] || { por_estado: {} };
    var pendientes = (info.por_estado.PENDIENTE || 0) + (info.por_estado.INCIDENCIA || 0);
    var cuerpo = '<div class="fin2-p">' +
      '<div class="fin2-hojas" role="tablist" aria-label="Hojas">' + l.hojas.map(function (y) {
        var p = (y.por_estado.PENDIENTE || 0);
        return '<button type="button" role="tab" class="fin2-hoja js-fca-hoja' + (y.nombre === h.nombre ? ' fin2-hoja--act' : '') + '" data-h="' + txt(y.nombre) + '" aria-selected="' + (y.nombre === h.nombre) + '">' + txt(y.nombre) + (y.oculta ? ' ' + U.ico('ojoTachado', 12) : '') + (p ? ' <span class="sx2-chip__n">' + p + '</span>' : '') + '</button>';
      }).join('') + '</div>' +
      '<div class="fin2-p-caja fin2-p-caja--info">' + U.ico('derivar', 16) + '<span><b>Destino:</b> ' + txt(h.destino) + (h.oculta ? ' · hoja oculta en el Excel' : '') + ' · encabezado en la fila ' + h.encabezado_fila + '</span></div>' +
      (h.arriba && h.arriba.length ? '<details class="fin2-gest"><summary>Lo que hay arriba del encabezado (' + h.arriba.length + ' fila(s), se conserva como evidencia)</summary><ul class="fin2-razones">' + h.arriba.slice(0, 20).map(function (a) { return '<li>Fila ' + a.fila + ': ' + txt(a.valores.filter(Boolean).join(' · ')) + '</li>'; }).join('') + '</ul></details>' : '') +
      '<div class="fin2-filtros">' + [''].concat(Object.keys(d.estados)).map(function (k) { return U.chip({ texto: k ? d.estados[k] : 'Todas', n: k ? info.por_estado[k] || 0 : h.filas, activo: est_.estado === k, clase: 'js-fca-est', datos: { id: k || 'TODAS' } }); }).join('') + '</div>' +
      (esBci ? '<label class="fin2-campo"><span>Cuenta del banco de esta hoja</span><select class="fin2-input fin2-input--sm js-fca-cuenta">' + opciones(est_.cuentas.map(function (c) { return [c.id, c.banco + ' ···' + c.ultimos4 + ' · ' + c.empresa]; }), '', 'Elige…') + '</select></label>' : '') +
      '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-tabla--chica"><thead><tr><th>Resultado</th><th>Fila</th>' + h.columnas.slice(0, 9).map(function (c) { return '<th>' + txt(c) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
        d.filas.map(function (f) {
          var corr = f.correcciones || {};
          var corregible = ['PENDIENTE', 'INCIDENCIA', 'PARCIAL'].indexOf(f.estado) !== -1;
          return '<tr><td>' + U.badge(d.estados[f.estado], TONO[f.estado]) + (f.incidencia ? '<br><small class="fin2-neg">' + txt(f.incidencia) + '</small>' : '') + (Object.keys(corr).length ? '<br><small class="fin2-ayuda">Corregida en SIGSO</small>' : '') + '</td><td class="fin2-num">' + f.fila + '</td>' +
            (f.valores || []).slice(0, 9).map(function (v, i) { var fx = (f.formulas || [])[i]; var c = corr[i]; return '<td' + (fx ? ' title="' + txt(fx) + '"' : '') + '>' + (c !== undefined ? '<s class="fin2-ayuda">' + txt(String(v).slice(0, 30)) + '</s> <b>' + txt(String(c).slice(0, 30)) + '</b>' : txt(String(v).slice(0, 40))) + (fx ? ' <small class="fin2-ayuda">ƒ</small>' : '') + '</td>'; }).join('') +
            '<td class="fin2-acciones-min"><button type="button" class="sx2-enlace js-fca-donde" data-f="' + f.fila + '">¿Dónde quedó?</button>' +
              (corregible ? ' <button type="button" class="sx2-enlace js-fca-corr" data-f="' + f.fila + '" data-cap="MIGRAR">Corregir</button> <button type="button" class="sx2-enlace js-fca-apartar" data-f="' + f.fila + '" data-cap="MIGRAR">Apartar</button>' : '') +
              (f.estado === 'APARTADA' ? ' <button type="button" class="sx2-enlace js-fca-recup" data-f="' + f.fila + '" data-cap="MIGRAR">Recuperar</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' + (d.total > d.filas.length ? '<p class="fin2-ayuda">Se muestran ' + d.filas.length + ' de ' + d.total + '.</p>' : '') +
      (d.lote.tipo === 'BANCOS' && esBci ? '<div class="js-fca-cand"></div>' : '') +
    '</div>';
    var dr = U.drawer({ titulo: d.lote.nombre, subtitulo: '<span class="fin2-ayuda">' + txt(d.lote.tipo) + ' · ' + l.hojas.length + ' hoja(s)</span>', cuerpo: cuerpo,
      pie: '<span class="fin2-ayuda">' + (pendientes ? pendientes + ' fila(s) por publicar o con incidencia en esta hoja.' : 'Nada por publicar en esta hoja.') + '</span><span style="flex:1"></span>' +
        U.boton({ texto: 'Cuadro de control', icono: 'tabla', clase: 'js-fca-cuadro' }) +
        U.boton({ texto: 'Publicar esta hoja', icono: 'check', variante: 'primario', clase: 'js-fca-publicar', datos: { cap: 'MIGRAR' }, deshabilitado: !pendientes }) });
    dr.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    x_.aplicarCapacidades(dr.el);
    if (esBci) candidatas(dr.el);
    dr.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.classList.contains('js-fca-hoja')) { est_.hoja = b.dataset.h; est_.estado = ''; cargarHoja(); }
      else if (b.classList.contains('js-fca-est')) { est_.estado = b.dataset.id === 'TODAS' ? '' : b.dataset.id; cargarHoja(); }
      else if (b.classList.contains('js-fca-donde')) donde(Number(b.dataset.f));
      else if (b.classList.contains('js-fca-cuadro')) cuadro();
      else if (b.classList.contains('js-fca-corr')) corregir(Number(b.dataset.f));
      else if (b.classList.contains('js-fca-apartar') || b.classList.contains('js-fca-recup')) {
        var rec = b.classList.contains('js-fca-recup');
        U.formulario({ titulo: (rec ? 'Recuperar' : 'Apartar') + ' la fila ' + b.dataset.f, boton: rec ? 'Recuperar' : 'Apartar', campos: U.campo('Motivo', '<input name="motivo" class="sx2-input"' + (rec ? '' : ' required') + '>', rec ? 'Vuelve a quedar por publicar.' : 'No se publica ni se reintenta; queda recuperable.'),
          enviar: function (v) { return x_.api('finanzasCorregirFilaCarga', { lote_id: est_.lote, hoja: h.nombre, fila: Number(b.dataset.f), accion: rec ? 'RECUPERAR' : 'APARTAR', motivo: v.motivo }); },
          aviso: rec ? 'Fila recuperada.' : 'Fila apartada.', listo: function () { abrirLote(est_.lote, true); } });
      }
      else if (b.classList.contains('js-fca-publicar')) {
        var cuenta = dr.el.querySelector('.js-fca-cuenta');
        if (cuenta && !cuenta.value) { x_.aviso('Elige a qué cuenta del banco corresponde esta hoja.', 'alerta'); cuenta.focus(); return; }
        U.confirmar({ titulo: 'Publicar «' + h.nombre + '»', texto: 'Destino: ' + h.destino + '. Las filas ya publicadas no se repiten; las que no calcen quedan como incidencia con su motivo.', boton: 'Publicar' }).then(function (si) {
          if (!si) return;
          b.disabled = true;
          x_.api('finanzasPublicarHoja', { lote_id: est_.lote, hoja: h.nombre, cuenta_ref: cuenta ? cuenta.value : '' }).then(function (r) {
            if (!r || !r.ok) { b.disabled = false; x_.aviso((r && r.message) || 'No se pudo publicar.', 'error'); return; }
            var res = r.data.resultado || {};
            x_.aviso('Publicada: ' + Object.keys(res).map(function (k) { return res[k] + ' ' + (d.estados[k] || k).toLowerCase(); }).join(' · ') + (r.data.aviso ? '. ' + r.data.aviso : ''), res.INCIDENCIA || r.data.aviso ? 'alerta' : 'exito');
            x_.catalogo(true);
            abrirLote(est_.lote, true);
          });
        });
      }
      else if (b.classList.contains('js-fca-crear')) crearGestion(dr, Number(b.dataset.i));
    });
  }
  /** Corregir una fila sin tocar el original: se escribe el valor correcto y vuelve a «por publicar». */
  function corregir(fila) {
    var d = est_.datos, f = d.filas.filter(function (y) { return y.fila === fila; })[0]; if (!f) return;
    var corr = f.correcciones || {};
    U.formulario({ titulo: 'Corregir la fila ' + fila + ' de «' + d.hoja.nombre + '»', boton: 'Guardar corrección', ancho: true,
      campos: (f.incidencia ? '<p class="fin2-neg">' + txt(f.incidencia) + '</p>' : '') + '<p class="fin2-ayuda">El archivo original no se modifica: la corrección queda registrada con tu nombre y la fila vuelve a «por publicar». No se crean clientes por parecido: escribe el RUT o el nombre exacto.</p><div class="fin2-form-grid">' +
        d.hoja.columnas.map(function (c, i) { var v = corr[i] !== undefined ? corr[i] : (f.valores[i] || ''); return c ? U.campo(c + (corr[i] !== undefined ? ' (corregido)' : ''), '<input name="c' + i + '" class="sx2-input" value="' + txt(v) + '" data-orig="' + txt(f.valores[i] || '') + '">', (f.formulas || [])[i] ? 'Fórmula: ' + (f.formulas || [])[i] : '') : ''; }).join('') +
        U.campo('Motivo', '<input name="motivo" class="sx2-input" required>') + '</div>',
      enviar: function (v) {
        var cambios = {};
        d.hoja.columnas.forEach(function (c, i) { var nv = v['c' + i]; if (nv !== undefined && String(nv) !== String(corr[i] !== undefined ? corr[i] : (f.valores[i] || ''))) cambios[i] = nv; });
        if (!Object.keys(cambios).length) return Promise.resolve({ ok: false, message: 'No cambiaste ningún valor.' });
        return x_.api('finanzasCorregirFilaCarga', { lote_id: est_.lote, hoja: d.hoja.nombre, fila: fila, cambios: cambios, motivo: v.motivo });
      }, aviso: 'Corrección guardada: publica la hoja para aplicarla.', listo: function () { abrirLote(est_.lote, true); } });
  }
  /** Cuadro de control de la carga: por hoja, cantidades e importes, con los motivos agrupados. */
  function cuadro() {
    x_.api('finanzasCuadroControl', { lote_id: est_.lote }).then(function (r) {
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
      var q = r.data, T = q.totales;
      var dr = U.drawer({ titulo: 'Cuadro de control', subtitulo: '<span class="fin2-ayuda">' + txt(q.lote.nombre) + ' · ' + txt(q.lote.tipo) + ' · cargado por ' + txt(q.lote.creado_por) + '</span>',
        cuerpo: '<div class="fin2-p">' + cinta('info', '<b>' + T.leidas + ' fila(s) leídas</b>: ' + T.publicadas + ' publicadas · ' + T.con_observacion + ' con observación · ' + T.incidencias + ' incidencias · ' + T.apartadas + ' apartadas · ' + T.repetidas + ' repetidas de otro archivo · ' + T.historicas + ' solo consulta · ' + T.por_publicar + ' por publicar. Cada fila está en un solo estado.') +
          '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-tabla--chica"><thead><tr><th>Hoja</th><th>Destino</th><th class="fin2-der">Leídas</th><th>Por estado</th><th class="fin2-der">Importe leído</th><th class="fin2-der">Sin resolver</th><th>Motivos</th></tr></thead><tbody>' +
          q.hojas.map(function (h) {
            return '<tr><td><b>' + txt(h.hoja) + '</b>' + (h.oculta ? ' <small class="fin2-ayuda">(oculta)</small>' : '') + '</td><td><small>' + txt(h.destino) + '</small></td><td class="fin2-der fin2-num">' + h.leidas + (h.plantilla ? '<br><small class="fin2-ayuda">+ ' + h.plantilla + ' de plantilla (sin datos)</small>' : '') + '</td>' +
              '<td>' + Object.keys(h.por_estado).map(function (k) { return U.badge(q.estados[k] + ' ' + h.por_estado[k], TONO[k]); }).join(' ') + '</td>' +
              '<td class="fin2-der fin2-num">' + (h.importe_leido === null ? '<small class="fin2-ayuda">sin columna de monto</small>' : plata(h.importe_leido) + '<br><small class="fin2-ayuda">' + txt(h.columna_monto) + '</small>') + (h.montos_no_leibles ? '<br><small class="fin2-neg">' + h.montos_no_leibles + ' monto(s) ilegibles: no se sumaron</small>' : '') + '</td>' +
              '<td class="fin2-der fin2-num">' + (h.importe_sin_resolver === null ? '—' : plata(h.importe_sin_resolver)) + '</td>' +
              '<td><small>' + h.motivos.slice(0, 4).map(function (m) { return txt(m.motivo) + ' (' + m.filas + ')'; }).join('<br>') + '</small></td></tr>';
          }).join('') + '</tbody></table></div>' +
          (q.publicaciones.length ? '<section class="fin2-p-sec"><h3>Publicaciones</h3><ul class="fin2-hist">' + q.publicaciones.slice(-15).reverse().map(function (p2) { return '<li>' + txt(String(p2.en).slice(0, 16).replace('T', ' ')) + ' · ' + txt(p2.hoja) + ' · ' + txt(p2.por) + ': ' + txt(Object.keys(p2.resultado || {}).map(function (k) { return k + ' ' + p2.resultado[k]; }).join(', ')) + '</li>'; }).join('') + '</ul></section>' : '') + '</div>' });
      dr.el.classList.add('fin2-panel', 'sx2-drawer--ancho');
    });
  }
  function donde(fila) {
    x_.api('finanzasDondeQuedo', { lote_id: est_.lote, hoja: est_.hoja, fila: fila }).then(function (r) {
      if (!r || !r.ok) { x_.aviso((r && r.message) || 'No se pudo.', 'error'); return; }
      var d = r.data;
      U.confirmar({ titulo: 'Fila ' + d.fila + ' de «' + d.hoja + '»: ' + d.estado_nombre,
        texto: (d.destino ? 'Quedó en: ' + d.destino + '. ' : '') + (d.incidencia ? 'Observación: ' + d.incidencia + '. ' : '') + (d.regla ? 'Regla: ' + d.regla + '. ' : '') +
          'Valores: ' + d.columnas.map(function (c, i) { return c + '=' + ((d.valores || [])[i] || '') + ((d.formulas || [])[i] ? ' (' + d.formulas[i] + ')' : ''); }).filter(function (s) { return !/=$/.test(s); }).slice(0, 12).join(' · '),
        boton: 'Entendido' });
    });
  }
  function candidatas(el) {
    x_.api('finanzasCandidatas', { lote_id: est_.lote }).then(function (r) {
      var c = el.querySelector('.js-fca-cand'); if (!c || !r || !r.ok) return;
      var g = r.data.grupos || [];
      est_.grupos = g;
      c.innerHTML = '<section class="fin2-p-sec"><h3>Grupos de fondos candidatos (columna UNITARIO)</h3>' + (g.length ? '<p class="fin2-ayuda">La planilla sumaba estas filas con una fórmula: probablemente son el dinero de un cliente para una obligación. Créalos como gestión si corresponde; nada se crea solo.</p><ul class="fin2-lista-saldos">' + g.map(function (y, i) {
        return '<li><span><b>' + txt(y.alias || 'Grupo ' + (i + 1)) + '</b> <code>' + txt(y.formula) + '</code><small>' + y.miembros.length + ' fila(s): ' + y.miembros.slice(0, 4).map(function (m) { return 'f' + m.fila + ' ' + (m.monto || 0).toLocaleString('es-CL'); }).join(' · ') + ' · remanente en la planilla ' + (y.remanente_planilla === null ? '—' : y.remanente_planilla.toLocaleString('es-CL')) + '</small></span>' +
          U.boton({ texto: 'Crear gestión', sm: true, clase: 'js-fca-crear', datos: { i: i, cap: 'FONDOS' } }) + '</li>';
      }).join('') + '</ul>' : '<p class="fin2-ayuda">Se arman al publicar esta hoja.</p>') + '</section>';
      x_.aplicarCapacidades(c);
    });
  }
  function crearGestion(dr, i) {
    var g = est_.grupos[i];
    var t = ((cat_.tipos || []).filter(function (y) { return y.id === 'FONDO_PAGADO'; })[0] || { cuentas: [] }).cuentas;
    U.formulario({ titulo: 'Crear gestión desde la planilla', subtitulo: '<span class="fin2-ayuda">' + txt(g.alias) + ' · ' + txt(g.formula) + '</span>', boton: 'Crear',
      campos: U.campo('Cliente', '<select name="cliente_id" class="sx2-input" required>' + opciones((cat_.clientes || []).map(function (c) { return [c.id, c.nombre + ' · ' + c.rut]; }), '', 'Elige…') + '</select>', 'Tú dices de qué cliente es: no se adivina por el nombre.') +
        U.campo('Obligación', '<select name="obligacion" class="sx2-input" required>' + opciones(t.map(function (o) { return [o, o]; }), '', 'Elige…') + '</select>') + U.campo('Período', '<input type="month" name="periodo_obligacion" class="sx2-input">'),
      preparar: function (v) { return Object.assign(v, { lote_id: est_.lote, indice: i }); },
      enviar: function (v) { return x_.api('finanzasGestionDeCandidata', v); },
      aviso: function (r) { return 'Gestión creada: ' + r.data.asignadas + ' movimiento(s) asignados' + (r.data.revisar.length ? ', ' + r.data.revisar.length + ' para revisar' : '') + (r.data.diferencia ? '. Diferencia con la planilla: ' + r.data.diferencia.toLocaleString('es-CL') : '') + '.'; },
      listo: function () { abrirLote(est_.lote, true); } });
  }

  var enlazado_ = false;
  function enlazar(x) {
    var raiz = x.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('change', function (ev) { if (ev.target.classList.contains('js-fca-archivo')) subir(ev.target.files[0]); });
    raiz.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b || !raiz.querySelector('.fin2-cargas')) return;
      if (b.classList.contains('js-fca-lote')) abrirLote(b.dataset.id);
      else if (b.classList.contains('js-fca-ir')) x_.ir(b.dataset.vista);
    });
    raiz.addEventListener('keydown', function (ev) { var s = ev.target.closest && ev.target.closest('.js-fca-soltar'); if (s && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); s.querySelector('input').click(); } });
    raiz.addEventListener('dragover', function (ev) { var s = ev.target.closest && ev.target.closest('.js-fca-soltar'); if (s) { ev.preventDefault(); s.classList.add('fin2-soltar--sobre'); } });
    raiz.addEventListener('dragleave', function (ev) { var s = ev.target.closest && ev.target.closest('.js-fca-soltar'); if (s) s.classList.remove('fin2-soltar--sobre'); });
    raiz.addEventListener('drop', function (ev) { var s = ev.target.closest && ev.target.closest('.js-fca-soltar'); if (s) { ev.preventDefault(); s.classList.remove('fin2-soltar--sobre'); subir(ev.dataTransfer.files[0]); } });
  }

  window.SigsoFinanzasCargas = {
    ver: function (x) { enlazar(x); ver(x, 'cargas'); },
    verMigracion: function (x) { enlazar(x); ver(x, 'migracion'); }
  };
})();
