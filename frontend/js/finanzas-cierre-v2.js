/**
 * finanzas-cierre-v2.js — Finanzas, Etapa 6: cierre de mes, paralelo con la
 * planilla SIGECO y retiro de la planilla (2026-10-06;
 * backend/logica/finanzasCierre.js). Pestaña «Cierre» de la bóveda.
 *
 * 2026-10-20 (FIN-41): revisión antes de cerrar (enviar a revisión, observar,
 * resolver), excepciones autorizadas con motivo (una cuenta fuera de alcance o
 * saldos iniciales pendientes) y versiones guardadas de cada cierre.
 *
 * 2026-10-20 (I08.9): una vista principal del mes elegido (avance, bloqueos con
 * acceso a su origen, avisos, siguiente paso y a quién le toca); los demás meses
 * en un selector; la transición desde SIGECO queda plegada.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;
  var est_ = { datos: null, paralelo: null, reabriendo: '', leyendo: false, periodo: '' };
  // I12.2/I12.4: al cerrarse la bóveda, la pantalla olvida las cifras que tenía cargadas.
  document.addEventListener('sigso-fin-cerrada', function () { est_.datos = null; est_.paralelo = null; });
  // I08.9: cada paso que falta abre su origen.
  var ORIGEN = { cartolas: ['bancos', 'Subir cartolas'], cuadra: ['bancos', 'Ver cartolas'], revisado: ['movimientos', 'Revisar movimientos'], aperturas: ['fondos', 'Cargar saldos'],
    identidad: ['conciliacion', 'Resolver en Conciliación'], sin_banco: ['conciliacion', 'Conciliar'], ventas: ['cobranza', 'Subir ventas'] };
  var PESO = '$', MENOS = '−';

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? MENOS : '') + PESO + Math.abs(v).toLocaleString('es-CL'); }
  function fecha(iso) { return iso ? new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : ''; }
  var avisoT_ = null;
  function aviso(msg) {
    var el = document.getElementById('fin2-toast');
    if (!el) { el = document.createElement('div'); el.id = 'fin2-toast'; el.className = 'fin2-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('fin2-toast--on');
    clearTimeout(avisoT_); avisoT_ = setTimeout(function () { el.classList.remove('fin2-toast--on'); }, 4500);
  }
  function check(ok, obligatorio) {
    return '<span class="fin2-ck ' + (ok ? 'fin2-ck--ok' : obligatorio === false ? 'fin2-ck--aviso' : 'fin2-ck--no') + '">' + U.ico(ok ? 'check' : obligatorio === false ? 'info' : 'reloj', 13) + '</span>';
  }

  function ver(x) {
    x_ = x; enlazar();
    var t = x.turno();
    x.pagina(x.cab('Cierre') + U.esqueleto('tarjetas', 3));
    x.api('finanzasCierre').then(function (r) {
      if (!x.vigente(t)) return;
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('Cierre') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: r.message || '' }) })); return; }
      est_.datos = r.data;
      pintar();
    });
  }

  /** El mes principal: el elegido o el abierto más antiguo (el que toca cerrar). */
  function mesElegido() {
    var ms = est_.datos.meses;
    var m = ms.filter(function (x) { return x.periodo === est_.periodo; })[0];
    if (m) return m;
    var abiertos = ms.filter(function (x) { return x.estado !== 'CERRADO'; });
    return abiertos.length ? abiertos[abiertos.length - 1] : ms[0];
  }
  function badgeMes(m) {
    return m.estado === 'CERRADO' ? U.badge(m.con_excepciones ? 'Cerrado con excepciones' : 'Cerrado', m.con_excepciones ? 'alerta' : 'ok') : m.estado === 'OBSERVADO' ? U.badge('Devuelto con observaciones', 'alerta') :
      m.estado === 'EN_REVISION' ? U.badge('En revisión', 'info') : m.listo ? U.badge('Listo para revisión', 'info') : U.badge('Abierto', 'neutro');
  }
  /** Siguiente paso y a quién le toca, según el estado (no solo según los avisos). */
  function siguiente(m, bloqueos) {
    if (m.estado === 'CERRADO') return ['Mes cerrado', 'Solo cambia si alguien con permiso lo reabre con motivo.'];
    if (bloqueos.length) return ['Resolver ' + bloqueos.length + ' bloqueo(s)', 'Le toca a la operación: cada bloqueo abre dónde se resuelve.'];
    if ((m.observaciones || []).some(function (o) { return !o.resuelta; })) return ['Resolver las observaciones', 'Le toca a la operación; después se vuelve a enviar a revisión.'];
    if (!m.revision) return ['Enviar a revisión', 'Le toca a la operación: todo lo obligatorio está listo.'];
    return ['Revisar y cerrar', 'Le toca a quien tiene permiso de cierre: puede cerrar u observar.'];
  }
  function filaPaso(p) {
    var o = ORIGEN[p.id];
    return '<li>' + check(p.ok, p.obligatorio) + '<div><b>' + txt(p.nombre) + '</b><span>' + txt(p.detalle) + '</span></div>' +
      (!p.ok && o ? U.boton({ texto: o[1], sm: true, variante: 'fantasma', clase: 'js-finx-ir', datos: { v: o[0], p: est_.periodoPaso || '' } }) : '') + '</li>';
  }
  function tarjetaMes(m) {
    est_.periodoPaso = m.periodo; // el botón de cada paso abre su origen en ESTE mes
    var cerrado = m.estado === 'CERRADO';
    var acc;
    if (est_.reabriendo === m.periodo) {
      acc = '<div class="fin2-editar"><input class="fin2-input fin2-input--sm js-finx-motivo" placeholder="¿Por qué se reabre?" maxlength="300">' +
        U.boton({ texto: 'Reabrir', sm: true, variante: 'primario', clase: 'js-finx-reabrir-ok', datos: { p: m.periodo } }) + U.boton({ texto: 'Cancelar', sm: true, variante: 'fantasma', clase: 'js-finx-cancelar' }) + '</div>';
    } else if (cerrado) {
      acc = U.boton({ texto: 'Reabrir', icono: 'llave', sm: true, variante: 'fantasma', clase: 'js-finx-reabrir', datos: { p: m.periodo } });
    } else {
      // I08.9: cerrar sin pasar por revisión está permitido (FIN-41), pero se nombra así y no es la acción principal.
      var revisado = !!m.revision && m.estado === 'EN_REVISION';
      acc = U.boton({ texto: !m.listo ? 'Falta para cerrar' : revisado ? 'Cerrar el mes' : 'Cerrar sin revisión', icono: 'candado', sm: true, variante: m.listo && revisado ? 'primario' : 'secundario', clase: 'js-finx-cerrar', datos: { p: m.periodo, cap: 'CIERRE' }, deshabilitado: !m.listo });
    }
    var extra = '';
    if (!cerrado) {
      var exc = [];
      (m.cobertura || []).forEach(function (c) {
        if (!c.completa && !c.excepcion) exc.push(U.boton({ texto: 'Dejar fuera ' + c.cuenta, sm: true, variante: 'fantasma', clase: 'js-finx-exc', datos: { p: m.periodo, tipo: 'CUENTA', cuenta: c.cuenta_ref, cap: 'CIERRE' } }));
      });
      var ap = (m.pasos || []).filter(function (p) { return p.id === 'aperturas'; })[0];
      if (ap && !ap.ok) exc.push(U.boton({ texto: 'Aceptar sin saldos iniciales', sm: true, variante: 'fantasma', clase: 'js-finx-exc', datos: { p: m.periodo, tipo: 'APERTURAS', cap: 'CIERRE' } }));
      var obs = m.observaciones || [];
      extra = (exc.length ? '<div class="fin2-acciones-min" style="justify-content:flex-start">' + exc.join('') + '</div><p class="fin2-ayuda">Una excepción exige motivo, queda en la bitácora y en el informe del mes.</p>' : '') +
        (m.revision ? '<p class="fin2-ayuda">Enviado a revisión por ' + txt(m.revision.enviado_por) + ' el ' + txt(fecha(m.revision.en)) + (m.revision.nota ? ': «' + txt(m.revision.nota) + '»' : '') + '</p>' : '') +
        (obs.length ? '<ul class="fin2-lista-saldos">' + obs.map(function (o, i) {
          return '<li><span>' + (o.resuelta ? U.badge('Resuelta', 'ok') : U.badge('Observación', 'alerta')) + ' ' + txt(o.texto) + '<small>' + txt(o.por) + ' · ' + txt(fecha(o.en)) + (o.respuesta ? ' · respuesta: ' + txt(o.respuesta) : '') + '</small></span>' +
            (o.resuelta ? '' : U.boton({ texto: 'Resolver', sm: true, variante: 'fantasma', clase: 'js-finx-resolver', datos: { p: m.periodo, i: i, cap: 'CONFIRMAR' } })) + '</li>';
        }).join('') + '</ul>' : '') +
        '<div class="fin2-acciones-min" style="justify-content:flex-start">' +
          (m.listo && !m.revision ? U.boton({ texto: 'Enviar a revisión', icono: 'derivar', sm: true, clase: 'js-finx-revision', datos: { p: m.periodo, cap: 'CONFIRMAR' } }) : '') +
          U.boton({ texto: 'Observar', icono: 'comentario', sm: true, variante: 'fantasma', clase: 'js-finx-observar', datos: { p: m.periodo, cap: 'CIERRE' } }) + '</div>';
    }
    var exs = m.excepciones || [];
    if (exs.length) extra += '<h3 class="fin2-mes__h">Excepciones</h3><ul class="fin2-lista-saldos">' + exs.map(function (e) {
      return '<li><span>' + U.badge(e.vigente ? 'Aceptada' : 'Quitada', e.vigente ? 'alerta' : 'neutro') + ' <b>' + txt(e.alcance || e.tipo) + '</b>: ' + txt(e.motivo || '') +
        '<small>' + (e.evidencia ? 'Evidencia: ' + txt(e.evidencia) + ' · ' : '') + 'aprobó ' + txt(e.aprobado_por || e.por || '—') + (e.vigente ? '' : ' · quitada por ' + txt(e.quitada_por || '—')) + '</small>' +
        (e.limitacion ? '<small>' + txt(e.limitacion) + '</small>' : '') + '</span></li>';
    }).join('') + '</ul>';
    if ((m.versiones || []).length) extra += '<p class="fin2-ayuda">Versiones guardadas: ' + m.versiones.map(function (v) { return '<button type="button" class="sx2-enlace js-finx-version" data-p="' + txt(m.periodo) + '" data-v="' + v.version + '">v' + v.version + ' (' + txt(v.por) + ', ' + txt(fecha(v.en)) + ')</button>'; }).join(' · ') + '</p>';
    return '<div class="fin2-mes' + (cerrado ? ' fin2-mes--cerrado' : '') + ' sx2-entra">' +
      (function () {
        // Bloqueos (obligatorios que faltan), avisos (no bloquean) y lo que ya está, plegado.
        var bloq = m.pasos.filter(function (p) { return p.obligatorio && !p.ok; }), avis = m.pasos.filter(function (p) { return !p.obligatorio && !p.ok; }), ok = m.pasos.filter(function (p) { return p.ok; });
        var oblig = m.pasos.filter(function (p) { return p.obligatorio; }), sig = siguiente(m, bloq);
        return '<div class="fin2-mes__cab"><div><b class="fin2-mes__nombre">' + txt(m.nombre) + '</b> ' + badgeMes(m) + '</div>' +
          '<span class="fin2-ayuda">' + (oblig.length - bloq.length) + ' de ' + oblig.length + ' requisitos listos</span></div>' +
          '<div class="fin2-siguiente"><span>Siguiente paso</span><b>' + txt(sig[0]) + '</b><small>' + txt(sig[1]) + '</small></div>' +
          (bloq.length ? '<h3 class="fin2-mes__h">Bloquean el cierre (' + bloq.length + ')</h3><ul class="fin2-pasos-mes">' + bloq.map(filaPaso).join('') + '</ul>' : '') +
          (avis.length ? '<h3 class="fin2-mes__h">Avisos (no bloquean)</h3><ul class="fin2-pasos-mes">' + avis.map(filaPaso).join('') + '</ul>' : '') +
          (ok.length ? '<details class="fin2-mes__listos"' + (cerrado ? ' open' : '') + '><summary>Listo (' + ok.length + ')</summary><ul class="fin2-pasos-mes">' + ok.map(filaPaso).join('') + '</ul></details>' : '');
      })() +
      (cerrado && m.foto ? '<p class="fin2-ayuda">Al cerrar: resultado <b>' + plata(m.foto.resultado) + '</b> · caja ' + plata(m.foto.caja) + ' · lo cerró ' + txt(m.cerrado_por) + ' el ' + txt(fecha(m.cerrado_en)) + '</p>' : '') +
      (!cerrado && m.ultimo_motivo ? '<p class="fin2-ayuda">Reabierto: «' + txt(m.ultimo_motivo) + '»</p>' : '') +
      extra + '<div class="fin2-mes__acc">' + acc + '</div></div>';
  }

  function tablaParalelo(p) {
    if (!p) return '<p class="fin2-ayuda">Sube la planilla SIGECO (descargada de Google Sheets como Excel) para compararla mes a mes con lo que dice el banco.</p>';
    var filas = p.meses.map(function (m) {
      return '<tr><td><b>' + txt(m.nombre) + '</b></td>' +
        '<td class="fin2-num fin2-der">' + m.planilla.movimientos + '</td><td class="fin2-num fin2-der">' + m.banco.movimientos + '</td><td class="fin2-num fin2-der">' + m.en_ambos + '</td>' +
        '<td class="fin2-num fin2-der' + (m.solo_banco.n ? ' fin2-neg' : '') + '">' + m.solo_banco.n + (m.solo_banco.n ? '<span class="fin2-motivo">+' + plata(m.solo_banco.ingresos) + ' / ' + MENOS + plata(m.solo_banco.egresos) + '</span>' : '') + '</td>' +
        '<td class="fin2-num fin2-der' + (m.solo_planilla.n ? ' fin2-neg' : '') + '">' + m.solo_planilla.n + (m.solo_planilla.n ? '<span class="fin2-motivo">+' + plata(m.solo_planilla.ingresos) + ' / ' + MENOS + plata(m.solo_planilla.egresos) + '</span>' : '') + '</td>' +
        '<td>' + (m.ok ? U.badge('Iguales', 'ok') : m.banco.movimientos ? U.badge('Con diferencias', 'alerta') : U.badge('Sin cartola', 'neutro')) + '</td></tr>';
    }).join('');
    var f = p.facturas;
    return '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Mes</th><th class="fin2-der">En la planilla</th><th class="fin2-der">En el banco</th><th class="fin2-der">En ambos</th><th class="fin2-der">Solo en el banco</th><th class="fin2-der">Solo en la planilla</th><th></th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
      '<ul class="fin2-notas">' +
        '<li><b>Solo en el banco</b>: movimientos que nunca se anotaron en la planilla. <b>Solo en la planilla</b>: anotados que no aparecen en la cartola (montos o fechas mal escritos, o duplicados).</li>' +
        (p.cuentas_sin_cartola.length ? '<li>La planilla tiene ' + p.movimientos_sin_cartola + ' movimientos de cuentas sin cartola cargada: ' + txt(p.cuentas_sin_cartola.join(', ')) + '. Súbelas en Bancos para compararlas.</li>' : '') +
        (f ? '<li>Facturas: la planilla tiene ' + f.planilla + ', y ' + f.faltan_en_boveda + ' no están en Finanzas' + (f.ejemplos.length ? ' (N° ' + txt(f.ejemplos.join(', ')) + ')' : '') + '. Mora según la planilla: <b>' + plata(f.mora_planilla) + '</b>; según Finanzas: <b>' + plata(f.mora_boveda) + '</b>.</li>' : '') +
      '</ul><p class="fin2-ayuda">Comparado por ' + txt(p.hecho_por) + ' el ' + txt(fecha(p.hecho_en)) + '.</p>';
  }

  function pintar() {
    var d = est_.datos, r = d.retiro;
    var auto = r.automaticos.map(function (a) { return '<li>' + check(a.ok) + '<div><b>' + txt(a.nombre) + '</b><span>' + txt(a.detalle) + '</span></div></li>'; }).join('');
    var man = r.manuales.map(function (m) {
      return '<li><label class="fin2-retiro-man"><input type="checkbox" class="js-finx-paso" data-id="' + txt(m.id) + '"' + (m.ok ? ' checked' : '') + (r.listo_para_archivar || m.ok ? '' : ' disabled') + '>' +
        '<div><b>' + txt(m.nombre) + '</b><span>' + txt(m.ayuda) + '</span>' + (m.ok ? '<span class="fin2-motivo">Hecho por ' + txt(m.por) + ' el ' + txt(fecha(m.en)) + '</span>' : '') + '</div></label></li>';
    }).join('');
    var estado = r.retirada ? ['ok', 'escudo', '<b>La planilla SIGECO está retirada.</b> Todo se registra en Finanzas.']
      : r.listo_para_archivar ? ['info', 'check', '<b>Finanzas ya puede reemplazar a la planilla.</b> Faltan los pasos en Google Sheets de abajo.']
      : ['alerta', 'reloj', '<b>Todavía no es momento de archivar la planilla.</b> Completa primero lo que está en gris.'];
    var sel = d.meses.length ? mesElegido() : null;
    x_.pagina(x_.cab('Cierre') +
      (d.politica ? '<p class="fin2-ayuda fin2-alcance">' + U.ico('escudo', 12) + ' Política de cierre: ' + txt(d.politica.texto) + ' Se cambia en Configuración › Catálogos (parámetros).</p>' : '') +
      (sel ? '<div class="fin2-meses-sel" role="tablist" aria-label="Meses">' + d.meses.map(function (m) {
        return '<button type="button" role="tab" class="fin2-mes-chip js-finx-mes" data-p="' + txt(m.periodo) + '" aria-selected="' + (m === sel ? 'true' : 'false') + '"><b>' + txt(m.nombre) + '</b>' + badgeMes(m) + '</button>';
      }).join('') + '</div>' + tarjetaMes(sel) : U.card({ cuerpo: U.vacio({ icono: 'calendario', texto: 'Sube cartolas en Bancos para empezar.' }) })) +
      // La comparación con SIGECO y el retiro de la planilla son de transición: accesibles, sin dominar el cierre.
      '<details class="fin2-transicion"' + (est_.paralelo || est_.leyendo ? ' open' : '') + '><summary>' + U.ico('capas', 16) + ' Transición desde la planilla SIGECO <span class="fin2-ayuda">' + (r.retirada ? 'planilla retirada' : r.listo_para_archivar ? 'lista para archivar' : 'en paralelo') + '</span></summary>' +
      '<div class="fin2-cadena fin2-cadena--' + (estado[0] === 'ok' ? 'ok' : 'mal') + ' fin2-estado-retiro sx2-tono-' + estado[0] + '">' + U.ico(estado[1], 18) + '<span>' + estado[2] + '</span></div>' +
      U.card({ titulo: 'Paralelo con la planilla SIGECO', icono: 'capas', sub: 'lo anotado a mano contra lo que dice el banco', accion: null, cuerpo:
        '<div class="fin2-fila-bot" style="margin:0 0 12px"><label class="sx2-boton sx2-boton--primario" style="cursor:pointer"><input type="file" accept=".xlsx" class="js-finx-planilla" hidden>' + U.ico('subir', 16) + (est_.leyendo ? 'Comparando…' : 'Subir la planilla para comparar') + '</label></div>' +
        tablaParalelo(est_.paralelo) }) +
      '<div class="fin2-grid fin2-grid--2">' +
        U.card({ titulo: 'Antes de archivar', icono: 'escudo', sub: 'se verifica solo', cuerpo: '<ul class="fin2-pasos-mes">' + auto + '</ul>' }) +
        U.card({ titulo: 'Pasos en Google Sheets', icono: 'documento', sub: 'los marca quien los hace', cuerpo: '<ul class="fin2-pasos-mes">' + man + '</ul>' +
          (r.listo_para_archivar ? '' : '<p class="fin2-ayuda">Se habilitan cuando todo lo de la izquierda esté listo.</p>') }) +
      '</div></details>');
    if (x_.aplicarCapacidades) x_.aplicarCapacidades();
    if (U.animar) U.animar(x_.raiz());
  }

  function paralelo(archivo) {
    est_.leyendo = true; pintar();
    SigsoLectorXlsx.leer(archivo, { hojas: function (n) { return n === 'CUENTA BANCARIA' || n === 'FACTURAS'; } }).then(function (hojas) {
      var h = function (n) { var x = hojas.filter(function (y) { return y.hoja === n; })[0]; return x ? x.filas : []; };
      if (!h('CUENTA BANCARIA').length) { est_.leyendo = false; pintar(); aviso('Ese Excel no tiene la hoja CUENTA BANCARIA.'); return; }
      return x_.api('finanzasParalelo', { banco: h('CUENTA BANCARIA'), facturas: h('FACTURAS') }).then(function (r) {
        est_.leyendo = false;
        if (!r || !r.ok) { pintar(); aviso((r && r.message) || 'No se pudo comparar.'); return; }
        est_.paralelo = r.data;
        ver(x_);
      });
    }).catch(function () { est_.leyendo = false; pintar(); aviso('El archivo no es un Excel válido.'); });
  }

  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('change', function (ev) {
      var e = ev.target;
      if (e.classList.contains('js-finx-planilla')) { if (e.files[0]) paralelo(e.files[0]); e.value = ''; }
      else if (e.classList.contains('js-finx-paso')) {
        x_.api('finanzasPasoRetiro', { id: e.dataset.id, hecho: e.checked }).then(function (r) { if (!r || !r.ok) aviso((r && r.message) || 'No se pudo guardar.'); ver(x_); });
      }
    });
    raiz.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('js-finx-mes')) { est_.periodo = b.dataset.p; est_.reabriendo = ''; pintar(); var tb = raiz.querySelector('.js-finx-mes[aria-selected="true"]'); if (tb) tb.focus(); return; }
      if (b.classList.contains('js-finx-ir')) {
        // Movimientos se abre en el mes revisado (no en el último cargado).
        if (b.dataset.v === 'movimientos' && window.SigsoFinanzasBancos && b.dataset.p) SigsoFinanzasBancos.periodo(b.dataset.p);
        if (window.SigsoFinanzas) SigsoFinanzas.irAItem(b.dataset.v);
        return;
      }
      if (b.classList.contains('js-finx-cerrar')) {
        b.disabled = true;
        x_.api('finanzasCerrarMes', { periodo: b.dataset.p }).then(function (r) {
          if (!r || !r.ok) { b.disabled = false; aviso((r && r.message) || 'No se pudo cerrar.'); return; }
          aviso('Mes cerrado: quedó fijo en Finanzas.'); ver(x_);
        });
      } else if (b.classList.contains('js-finx-exc')) {
        var tipo = b.dataset.tipo;
        U.formulario({ titulo: tipo === 'CUENTA' ? 'Dejar la cuenta fuera de este mes' : 'Cerrar sin todos los saldos iniciales', boton: 'Aceptar excepción',
          campos: U.campo('Motivo', '<input name="motivo" class="sx2-input" required maxlength="300">', tipo === 'CUENTA' ? 'Por ejemplo: la cuenta no tuvo movimientos y el banco no emite cartola.' : 'Los saldos de esos clientes quedan como parciales en el informe.') +
            U.campo('Evidencia', '<input name="evidencia" class="sx2-input" maxlength="300">', 'En qué te basas (correo del banco, acta, documento). Queda con la excepción.') +
            '<p class="fin2-ayuda">' + (tipo === 'CUENTA' ? 'Limitación: las cifras del mes no incluyen lo que falte de esa cuenta.' : 'Limitación: la disponibilidad propia sigue no determinable; la excepción solo permite cerrar.') + '</p>',
          enviar: function (d) { return x_.api('finanzasExcepcionCierre', { periodo: b.dataset.p, tipo: tipo, cuenta_ref: b.dataset.cuenta || '', motivo: d.motivo, evidencia: d.evidencia }); },
          aviso: 'Excepción registrada.', listo: function () { ver(x_); } });
      } else if (b.classList.contains('js-finx-revision')) {
        U.formulario({ titulo: 'Enviar a revisión', boton: 'Enviar', campos: U.campo('Nota para quien revisa (opcional)', '<input name="nota" class="sx2-input" maxlength="500">'),
          enviar: function (d) { return x_.api('finanzasEnviarRevision', { periodo: b.dataset.p, nota: d.nota }); }, aviso: 'Enviado a revisión.', listo: function () { ver(x_); } });
      } else if (b.classList.contains('js-finx-observar')) {
        U.formulario({ titulo: 'Observar el mes', boton: 'Guardar observación', campos: U.campo('Qué hay que corregir', '<textarea name="observacion" class="sx2-input" rows="3" required></textarea>', 'Mientras haya observaciones sin resolver, el mes no se puede cerrar.'),
          enviar: function (d) { return x_.api('finanzasObservarCierre', { periodo: b.dataset.p, observacion: d.observacion }); }, aviso: 'Observación guardada.', listo: function () { ver(x_); } });
      } else if (b.classList.contains('js-finx-resolver')) {
        U.formulario({ titulo: 'Resolver la observación', boton: 'Marcar resuelta', campos: U.campo('Qué se hizo', '<input name="respuesta" class="sx2-input" maxlength="500">'),
          enviar: function (d) { return x_.api('finanzasResolverObservacion', { periodo: b.dataset.p, indice: Number(b.dataset.i), respuesta: d.respuesta }); }, aviso: 'Observación resuelta.', listo: function () { ver(x_); } });
      } else if (b.classList.contains('js-finx-version')) {
        x_.api('finanzasVersionCierre', { periodo: b.dataset.p, version: Number(b.dataset.v) }).then(function (r) {
          if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo abrir.'); return; }
          var g = r.data.grupo || {}, mm = g.metrics || {};
          U.drawer({ titulo: 'Cierre ' + b.dataset.p + ' · versión ' + r.data.version, subtitulo: '<span class="fin2-ayuda">' + txt(r.data.por) + ' · ' + txt(fecha(r.data.en)) + ' · revisión de datos ' + txt(r.data.revision || '') + '</span>',
            cuerpo: '<div class="fin2-p"><p class="fin2-ayuda">Lo que quedó firme al cerrar (grupo). Si después cambian los datos, esta versión no cambia.</p><ul class="fin2-lista-saldos">' +
              [['Cobros propios', mm.ingresos], ['Pagos propios', mm.egresos], ['Flujo propio', mm.flujo_propio], ['Caja al cierre', mm.caja], ['Fondos de clientes (a favor)', mm.custodia_positiva]].map(function (k) { return '<li><span>' + k[0] + '</span><b class="fin2-num">' + (k[1] === null || k[1] === undefined ? '—' : plata(k[1])) + '</b></li>'; }).join('') +
              '</ul><p class="fin2-ayuda">Estado de los datos al cerrar: ' + txt((g.quality || {}).status || '—') + '. Empresas incluidas: ' + txt(Object.keys(r.data.empresas || {}).join(', ')) + '.</p></div>' });
        });
      } else if (b.classList.contains('js-finx-reabrir')) { est_.reabriendo = b.dataset.p; pintar(); var mo = raiz.querySelector('.js-finx-motivo'); if (mo) mo.focus(); }
      else if (b.classList.contains('js-finx-cancelar')) { est_.reabriendo = ''; pintar(); }
      else if (b.classList.contains('js-finx-reabrir-ok')) {
        var motivo = (raiz.querySelector('.js-finx-motivo') || {}).value || '';
        x_.api('finanzasReabrirMes', { periodo: b.dataset.p, motivo: motivo }).then(function (r) {
          if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo reabrir.'); return; }
          est_.reabriendo = ''; aviso('Mes reabierto. Quedó en la bitácora con el motivo.'); ver(x_);
        });
      }
    });
  }

  window.SigsoFinanzasCierre = { ver: ver };
})();
