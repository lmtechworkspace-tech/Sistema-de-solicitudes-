/**
 * reporte-pausas-v2.js — "¿Se están haciendo las pausas?" en la anatomía de
 * 4 niveles (auditoría de reportes, R-2): En una línea · Lo que requiere
 * decisión · Panorama · Detalle.
 *
 * UNA sola definición para Gerencia (todas las empresas) y Coordinación (las
 * suyas): las dos reciben el mismo objeto de calcularReporte_ (backend
 * logica/pausas.js), solo cambia el alcance.
 *
 * El ánimo va AGREGADO en lo crítico y el panorama; los nombres solo en el
 * detalle, que ya mostraban ambas pantallas a quien tiene acceso.
 */
(function () {
  'use strict';

  var U = window.UIv2;
  function PY() { return window.PYv2; }
  function R() { return window.SigsoReportes; }

  var ANIMO = ['Muy mal', 'Mal', 'Regular', 'Bien', 'Muy bien'];
  var TONO_ANIMO = ['critico', 'alerta', 'neutro', 'info', 'ok'];
  // Estados que siguen "vivos": en un día pasado, la pausa quedó sin cerrar.
  var ABIERTA = { Programada: 1, Recordatorio_enviado: 1, En_curso: 1, Suspendida: 1 };
  var ESTADO = { Realizada: ['Realizada', 'ok'], Cerrada: ['Realizada', 'ok'], No_realizada: ['No realizada', 'critico'], Cancelada: ['Cancelada', 'neutro'],
    Programada: ['Programada', 'info'], Recordatorio_enviado: ['Recordatorio enviado', 'info'], En_curso: ['En curso', 'info'], Suspendida: ['Suspendida', 'alerta'] };

  function nulo(v) { return v === null || v === undefined || v === ''; }
  function hoyLocal() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function vacio(t) { return '<div class="rp2-vacio">' + U.vacio({ icono: 'grafico', titulo: '', texto: t }) + '</div>'; }
  function sub(t, nota) { return '<h3 class="rp2-sub">' + U.esc(t) + (nota ? ' <span class="sx2-tenue" style="font-weight:500;font-size:.8125rem">' + U.esc(nota) + '</span>' : '') + '</h3>'; }

  // d: respuesta de getReporteGerenciaPausas / getReporteCumplimientoPausas.
  // opts.multiempresa: muestra la columna Empresa en el detalle.
  function cuerpo(d, opts) {
    opts = opts || {};
    var Rp = R(), k = d.kpis || {}, pct = k.pct_cumplimiento;
    var hoy = hoyLocal(), resueltas = (k.realizadas || 0) + (k.no_realizadas || 0);
    var lista = d.pausas || [], tend = d.tendencia || [], rachas = d.rachas_area || [];
    var meta = rachas.length ? rachas[0].umbral_pct : 90;
    var pctTxt = function (v) { return Rp.formatearNumero(v) + ' %'; };
    function tonoPct(v) { return v >= meta ? 'ok' : (v >= 70 ? 'alerta' : 'critico'); }
    // Semanas seguidas, desde la última, con cumplimiento bajo la meta.
    var semBajo = 0;
    for (var i = tend.length - 1; i >= 0; i--) { if (nulo(tend[i].pct_cumplimiento)) continue; if (tend[i].pct_cumplimiento < meta) semBajo++; else break; }
    var sinCerrar = lista.filter(function (p) { return ABIERTA[p.estado] && p.fecha < hoy; });
    var noReal = lista.filter(function (p) { return p.estado === 'No_realizada'; });
    var clima = d.clima_emocional || {}, dist = clima.distribucion || [];
    var animoBajo = dist.filter(function (x) { return x.valor <= 2; }).reduce(function (s, x) { return s + x.cantidad; }, 0);
    var sinMotivo = (d.motivos || []).filter(function (m) { return m.motivo === '(sin motivo)'; }).reduce(function (s, m) { return s + m.cantidad; }, 0);
    var areasFuera = rachas.filter(function (a) { return a.roster > 0 && a.racha_actual === 0; });

    // 1 · En una línea
    var estado = !resueltas ? 'neutro' : (pct < 70 || semBajo >= 2 ? 'critico' : (pct < meta || semBajo || sinCerrar.length ? 'alerta' : 'ok'));
    var ultimas = tend.slice(-3).filter(function (s) { return !nulo(s.pct_cumplimiento); }).map(function (s) { return pctTxt(s.pct_cumplimiento); });
    var frase = !resueltas ? 'No hubo pausas resueltas en el período.' :
      'Se hicieron ' + (k.realizadas || 0) + ' de ' + resueltas + ' pausas (' + pctTxt(pct) + ', meta ' + meta + ' %)' +
      (semBajo ? '; ' + (semBajo === 1 ? 'la última semana quedó' : 'las últimas ' + semBajo + ' semanas quedaron') + ' bajo la meta (' + ultimas.slice(-Math.min(semBajo, 3)).join(', ') + ')' : '') +
      (nulo(k.animo_promedio) ? '' : '; ánimo promedio ' + Rp.formatearNumero(k.animo_promedio) + ' de 5') + '.';
    var pendientes = (k.programadas || 0) - resueltas - (k.canceladas || 0);
    var linea = Rp.enUnaLinea({ estado: estado, frase: frase, kpis: [
      { etiqueta: 'Cumplimiento', valor: nulo(pct) ? '—' : Math.round(pct), sufijo: nulo(pct) ? '' : '%', icono: 'diana', progreso: nulo(pct) ? null : pct,
        tono: nulo(pct) ? 'neutro' : tonoPct(pct), nota: (k.realizadas || 0) + ' de ' + resueltas + ' realizadas' },
      { etiqueta: 'No realizadas', valor: k.no_realizadas || 0, icono: 'alerta', tono: k.no_realizadas ? 'critico' : 'ok',
        nota: pendientes > 0 ? pendientes + ' sin resolver aún' : 'de ' + (k.programadas || 0) + ' programadas' },
      { etiqueta: 'Participaciones', valor: k.participaciones || 0, icono: 'equipo', tono: 'primario',
        nota: k.realizadas ? Rp.formatearNumero(Math.round((k.participaciones || 0) / k.realizadas * 10) / 10) + ' por pausa realizada' : 'sin pausas realizadas' },
      { etiqueta: 'Ánimo promedio', valor: nulo(k.animo_promedio) ? '—' : Rp.formatearNumero(k.animo_promedio), unidad: nulo(k.animo_promedio) ? '' : 'de 5', icono: 'persona',
        tono: nulo(k.animo_promedio) ? 'neutro' : (k.animo_promedio >= 3.5 ? 'ok' : (k.animo_promedio >= 2.5 ? 'alerta' : 'critico')),
        nota: clima.respuestas ? clima.respuestas + ' respuestas (opcional)' : 'sin respuestas' }
    ] });

    // 2 · Lo que requiere decisión
    var alertas = [];
    if (semBajo) alertas.push({ severidad: semBajo >= 2 ? 'critico' : 'alerta', cantidad: semBajo, titulo: (semBajo === 1 ? 'Semana' : 'Semanas seguidas') + ' bajo la meta de ' + meta + ' %',
      detalle: tend.slice(-semBajo).map(function (s) { return s.etiqueta + ': ' + pctTxt(s.pct_cumplimiento); }).join(' · '), dueno: 'Coordinación de pausas' });
    if (noReal.length) alertas.push({ severidad: noReal.length >= 3 ? 'critico' : 'alerta', cantidad: noReal.length, titulo: 'Pausas no realizadas',
      detalle: 'Las más recientes: ' + noReal.slice(0, 4).map(function (p) { return PY().fecha(p.fecha) + (p.hora_programada ? ' ' + p.hora_programada : ''); }).join(' · '), dueno: 'Coordinación de pausas' });
    if (sinCerrar.length) alertas.push({ severidad: 'alerta', cantidad: sinCerrar.length, titulo: 'Pausas de días pasados que quedaron abiertas',
      detalle: 'No cuentan ni como realizadas ni como no realizadas: ' + sinCerrar.slice(0, 3).map(function (p) { return PY().fecha(p.fecha) + ' (' + (ESTADO[p.estado] || [p.estado])[0].toLowerCase() + ')'; }).join(' · '), dueno: 'Coordinación de pausas' });
    if (animoBajo) alertas.push({ severidad: 'alerta', cantidad: animoBajo, titulo: 'Respuestas de ánimo "Mal" o "Muy mal"',
      detalle: Rp.formatearNumero(Math.round(animoBajo / (clima.respuestas || 1) * 1000) / 10) + ' % de quienes respondieron. Quiénes, en el detalle.', dueno: 'Personas' });
    if (areasFuera.length) alertas.push({ severidad: 'alerta', cantidad: areasFuera.length, titulo: 'Áreas que no llegaron a la meta en su última pausa',
      detalle: areasFuera.slice(0, 6).map(function (a) { return a.area; }).join(' · '), dueno: 'Jefaturas de área' });
    if (sinMotivo) alertas.push({ severidad: 'alerta', cantidad: sinMotivo, titulo: 'Inasistencias sin motivo', detalle: 'Se marcaron como "no participé" sin decir por qué.', dueno: 'Personas' });
    var decision = Rp.requiereDecision(alertas, { vacio: 'Las pausas se están haciendo sobre la meta y sin ánimo bajo reportado.' });

    // 3 · Panorama
    var serie = tend.map(function (s) {
      return { etiqueta: String(s.etiqueta || '').replace(/^sem\. /, ''), pie: nulo(s.pct_cumplimiento) ? '—' : s.pct_cumplimiento + '%',
        pieTono: nulo(s.pct_cumplimiento) ? '' : tonoPct(s.pct_cumplimiento), realizadas: s.realizadas || 0, no: s.no_realizadas || 0 };
    });
    var panorama = sub('Semana a semana', '(bajo cada semana, su cumplimiento)') +
      Rp.columnas(serie, [{ campo: 'realizadas', etiqueta: 'Realizadas', tono: 'ok' }, { campo: 'no', etiqueta: 'No realizadas', tono: 'critico' }], { vacio: 'Sin semanas medidas.' }) +
      '<div class="rp2-dos">' +
        '<div>' + sub('Participación por área') + Rp.ranking((d.por_area || []).map(function (a) { return { etiqueta: a.area || 'Sin área', valor: a.participaciones }; }), { vacio: 'Sin participaciones en el período.' }) + '</div>' +
        '<div>' + sub('Clima emocional', '(autorreportado)') +
          (clima.respuestas ? Rp.ranking(dist.slice().reverse().map(function (x) {
            return { etiqueta: ANIMO[x.valor - 1], valor: x.cantidad, texto: x.cantidad + ' · ' + Rp.formatearNumero(x.pct) + '%', tono: TONO_ANIMO[x.valor - 1] };
          }), { max: clima.respuestas, sinPosicion: true }) : vacio('Nadie dejó esta respuesta opcional en el período.')) +
          sub('Motivos de inasistencia') + Rp.ranking((d.motivos || []).map(function (m) { return { etiqueta: m.motivo, valor: m.cantidad, tono: 'alerta' }; }), { vacio: 'Nadie justificó inasistencias en el período.' }) +
        '</div>' +
      '</div>';
    var bien = rachas.filter(function (a) { return a.racha_actual >= 2; }).slice(0, 4);
    panorama += Rp.loQueVaBien(bien.length ? [bien.map(function (a) { return a.area; }).join(', ') + (bien.length === 1 ? ' lleva ' + bien[0].racha_actual : ' llevan al menos ' +
      Math.min.apply(null, bien.map(function (a) { return a.racha_actual; }))) + ' pausas seguidas sobre la meta.'] : []);

    // 4 · Detalle: cada pausa (la más reciente primero), rachas por área y ánimo por persona.
    var cols = [{ campo: 'fecha', titulo: 'Fecha' }, { campo: 'hora', titulo: 'Hora' }];
    if (opts.multiempresa) cols.push({ campo: 'empresa', titulo: 'Empresa' });
    cols.push({ campo: 'estado', titulo: 'Estado', html: true });
    var detalle = '<div class="rp2-detalle">' + Rp.tabla(cols, lista.map(function (p) {
      var e = ESTADO[p.estado] || [p.estado, 'neutro'], abierta = ABIERTA[p.estado] && p.fecha < hoy;
      return { fecha: PY().fecha(p.fecha, true), hora: p.hora_programada || '—', empresa: p.empresa_id || '',
        estado: U.badge(e[0], abierta ? 'alerta' : e[1], true) + (abierta ? ' <span class="sx2-tenue" style="font-size:.75rem">sin cerrar</span>' : '') };
    }), { vacio: 'No hubo pausas programadas en el período.' }) + '</div>';
    if (rachas.length) detalle += '<details class="cv2-detalle"><summary>Rachas de equipo por área (' + rachas.length + ')</summary>' +
      Rp.tabla([{ campo: 'area', titulo: 'Área' }, { campo: 'roster', titulo: 'Personas', alinear: 'derecha' }, { campo: 'actual', titulo: 'Racha actual', alinear: 'derecha' },
        { campo: 'maxima', titulo: 'Máxima', alinear: 'derecha' }, { campo: 'umbral', titulo: 'Umbral', alinear: 'derecha' }],
        rachas.map(function (a) { return { area: a.area, roster: a.roster, actual: a.racha_actual, maxima: a.racha_maxima, umbral: '≥ ' + a.umbral_pct + '%' }; })) +
      '<p class="sx2-tenue" style="margin:0;font-size:.75rem">Pausas seguidas en que el área alcanzó su umbral. Es una racha de equipo, nunca de personas.</p></details>';
    var det = clima.detalle || [];
    if (det.length) detalle += '<details class="cv2-detalle"><summary>Ánimo por persona (' + det.length + ')</summary>' +
      Rp.tabla([{ campo: 'fecha', titulo: 'Fecha' }, { campo: 'nombre', titulo: 'Persona' }, { campo: 'area', titulo: 'Área' }, { campo: 'animo', titulo: 'Respuesta', html: true }],
        det.map(function (x) { return { fecha: PY().fecha(x.fecha, true), nombre: x.nombre, area: x.area || '', animo: U.badge(ANIMO[x.valor - 1] || '', TONO_ANIMO[x.valor - 1] || 'neutro') }; })) +
      '</details>';

    return Rp.nivel('En una línea', linea) +
      Rp.nivel('Lo que requiere decisión', decision, { nota: alertas.length ? 'la cifra es cuántas' : '' }) +
      Rp.nivel('Panorama', panorama) +
      Rp.nivel('Detalle · cada pausa del período', detalle, { clase: 'rp2-nivel--detalle', nota: lista.length + (lista.length === 1 ? ' pausa' : ' pausas') });
  }

  window.SigsoReportePausas = { cuerpo: cuerpo };
})();
