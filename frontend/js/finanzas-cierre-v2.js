/**
 * finanzas-cierre-v2.js — Finanzas, Etapa 6: cierre de mes, paralelo con la
 * planilla SIGECO y retiro de la planilla (2026-10-06;
 * backend/logica/finanzasCierre.js). Pestaña «Cierre» de la bóveda.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;
  var est_ = { datos: null, paralelo: null, reabriendo: '', leyendo: false };
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
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('Cierre') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: r.message || '' }) })); return; }
      est_.datos = r.data;
      pintar();
    });
  }

  function tarjetaMes(m) {
    var cerrado = m.estado === 'CERRADO';
    var acc;
    if (est_.reabriendo === m.periodo) {
      acc = '<div class="fin2-editar"><input class="fin2-input fin2-input--sm js-finx-motivo" placeholder="¿Por qué se reabre?" maxlength="300">' +
        U.boton({ texto: 'Reabrir', sm: true, variante: 'primario', clase: 'js-finx-reabrir-ok', datos: { p: m.periodo } }) + U.boton({ texto: 'Cancelar', sm: true, variante: 'fantasma', clase: 'js-finx-cancelar' }) + '</div>';
    } else if (cerrado) {
      acc = U.boton({ texto: 'Reabrir', icono: 'llave', sm: true, variante: 'fantasma', clase: 'js-finx-reabrir', datos: { p: m.periodo } });
    } else {
      acc = U.boton({ texto: m.listo ? 'Cerrar el mes' : 'Falta para cerrar', icono: 'candado', sm: true, variante: m.listo ? 'primario' : 'secundario', clase: 'js-finx-cerrar', datos: { p: m.periodo }, deshabilitado: !m.listo });
    }
    return '<div class="fin2-mes' + (cerrado ? ' fin2-mes--cerrado' : '') + ' sx2-entra">' +
      '<div class="fin2-mes__cab"><b>' + txt(m.nombre) + '</b>' + (cerrado ? U.badge('Cerrado', 'ok') : m.listo ? U.badge('Listo para cerrar', 'info') : U.badge('Abierto', 'neutro')) + '</div>' +
      '<ul class="fin2-pasos-mes">' + m.pasos.map(function (p) {
        return '<li>' + check(p.ok, p.obligatorio) + '<div><b>' + txt(p.nombre) + (p.obligatorio ? '' : ' <span class="fin2-ayuda">(aviso)</span>') + '</b><span>' + txt(p.detalle) + '</span></div></li>';
      }).join('') + '</ul>' +
      (cerrado && m.foto ? '<p class="fin2-ayuda">Al cerrar: resultado <b>' + plata(m.foto.resultado) + '</b> · caja ' + plata(m.foto.caja) + ' · lo cerró ' + txt(m.cerrado_por) + ' el ' + txt(fecha(m.cerrado_en)) + '</p>' : '') +
      (!cerrado && m.ultimo_motivo ? '<p class="fin2-ayuda">Reabierto: «' + txt(m.ultimo_motivo) + '»</p>' : '') +
      '<div class="fin2-mes__acc">' + acc + '</div></div>';
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
    x_.pagina(x_.cab('Cierre') +
      '<div class="fin2-cadena fin2-cadena--' + (estado[0] === 'ok' ? 'ok' : 'mal') + ' fin2-estado-retiro sx2-tono-' + estado[0] + ' sx2-entra">' + U.ico(estado[1], 18) + '<span>' + estado[2] + '</span></div>' +
      U.card({ titulo: 'Cierre de mes', icono: 'candado', sub: 'un mes cerrado ya no se puede reclasificar ni recibir movimientos nuevos', cuerpo:
        (d.meses.length ? '<div class="fin2-meses">' + d.meses.map(tarjetaMes).join('') + '</div>' : U.vacio({ icono: 'calendario', texto: 'Sube cartolas en Bancos para empezar.' })) }) +
      U.card({ titulo: 'Paralelo con la planilla SIGECO', icono: 'capas', sub: 'lo anotado a mano contra lo que dice el banco', accion: null, cuerpo:
        '<div class="fin2-fila-bot" style="margin:0 0 12px"><label class="sx2-boton sx2-boton--primario" style="cursor:pointer"><input type="file" accept=".xlsx" class="js-finx-planilla" hidden>' + U.ico('subir', 16) + (est_.leyendo ? 'Comparando…' : 'Subir la planilla para comparar') + '</label></div>' +
        tablaParalelo(est_.paralelo) }) +
      '<div class="fin2-grid fin2-grid--2">' +
        U.card({ titulo: 'Antes de archivar', icono: 'escudo', sub: 'se verifica solo', cuerpo: '<ul class="fin2-pasos-mes">' + auto + '</ul>' }) +
        U.card({ titulo: 'Pasos en Google Sheets', icono: 'documento', sub: 'los marca quien los hace', cuerpo: '<ul class="fin2-pasos-mes">' + man + '</ul>' +
          (r.listo_para_archivar ? '' : '<p class="fin2-ayuda">Se habilitan cuando todo lo de la izquierda esté listo.</p>') }) +
      '</div>');
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
      if (b.classList.contains('js-finx-cerrar')) {
        b.disabled = true;
        x_.api('finanzasCerrarMes', { periodo: b.dataset.p }).then(function (r) {
          if (!r || !r.ok) { b.disabled = false; aviso((r && r.message) || 'No se pudo cerrar.'); return; }
          aviso('Mes cerrado: quedó fijo en Finanzas.'); ver(x_);
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
