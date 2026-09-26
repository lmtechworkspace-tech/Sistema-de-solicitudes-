/**
 * reporte-servicio-v2.js — "Estado del servicio" (Solicitudes).
 *
 * Reporte piloto de la anatomía en 4 niveles (documentacion/SIGSO-v2-reportes-
 * auditoria.md): En una línea · Lo que requiere decisión · Panorama · Detalle.
 * Una sola definición para Gerencia (agrupa por área) y Mi departamento (agrupa
 * por módulo): cada uno le pasa sus ítems, ya recortados por permisos y alcance
 * en el backend.
 *
 * Los ítems llegan SIN recorte de fecha: el período y el anterior se miden
 * sobre el mismo conjunto, y cada indicador con su propia fecha (entregas por
 * fecha de término; entradas por fecha de creación). El comparativo del panel
 * recorta por fecha de creación antes de comparar y, con un período elegido,
 * la ventana anterior queda vacía (hallazgo 16 de la auditoría).
 */
(function () {
  'use strict';

  var CERRADOS = ['S09', 'S10', 'S11'];
  var DIA = 86400000;
  // Situación de un ítem ABIERTO; `orden` = gravedad para el detalle.
  var SITUACION = {
    ATRASADA_DESARROLLADOR: { texto: 'Atrasado', tono: 'critico', orden: 0 },
    EN_RIESGO: { texto: 'Por vencer', tono: 'alerta', orden: 1 },          // queda menos de una jornada hábil
    ESPERANDO_VALIDACION: { texto: 'Por validar', tono: 'info', orden: 3 },
    SIN_COMPROMISO: { texto: 'Sin fecha', tono: 'neutro', orden: 4 },
    EN_PLAZO: { texto: 'En plazo', tono: 'ok', orden: 5 }
  };
  var SIN_RESPONSABLE = { texto: 'Sin responsable', tono: 'critico', orden: 2 };
  var PRIORIDAD_TONO = { P1: 'critico', P2: 'alerta', P3: 'info', P4: 'neutro' };

  function R() { return window.SigsoReportes; }
  function U() { return window.UIv2; }
  function fmt(n) { return R().formatearNumero(n); }
  function dia(v) { return String(v || '').slice(0, 10); }
  function enRango(v, r) { return !r ? !!v : (!!v && dia(v) >= r.desde && dia(v) <= r.hasta); }
  function abierto(i) { return CERRADOS.indexOf(i.estado) === -1; }
  function codigo(i) { return (i.cumplimiento && i.cumplimiento.codigo) || ''; }
  function diasDesde(fecha) { return Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / DIA)); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function nombre(i) {
    if (i.desarrollador_nombre) return i.desarrollador_nombre;
    if (!i.desarrollador_asignado) return '';
    var p = window.PYv2 && PYv2.persona ? PYv2.persona(i.desarrollador_asignado) : null;
    return (p && p.nombre) || i.desarrollador_asignado;
  }
  function mediana(nums) {
    var v = nums.filter(function (n) { return typeof n === 'number' && isFinite(n); }).sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2 * 10) / 10;
  }
  function hoyLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  // 'AAAA-MM-DD' movido n meses (el día se ajusta al último del mes si no existe).
  function moverMeses(iso, n) {
    var a = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + n, d = Number(iso.slice(8, 10));
    var y = a + Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + Math.min(d, ultimo)).slice(-2);
  }
  // El período corre hasta HOY (un mes en curso no se compara con uno cerrado),
  // y el anterior es el mismo tramo del período anterior: 1–25 sept vs. 1–25 ago.
  var MESES_PERIODO = { mes: 1, trimestre: 3, anio: 12 };
  function rangos(periodo) {
    var base = window.SigsoReportes.rangoDePeriodo(periodo);
    if (!base.desde) return { r: null, rAnt: null };
    var hoy = hoyLocal(), hasta = base.hasta < hoy ? base.hasta : hoy;
    var n = MESES_PERIODO[periodo] || 0;
    var r = { desde: base.desde, hasta: hasta, enCurso: hasta !== base.hasta };
    return { r: r, rAnt: n ? { desde: moverMeses(base.desde, -n), hasta: moverMeses(hasta, -n) } : null };
  }
  var MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
  function textoRango(r) {
    if (!r) return '';
    var d1 = Number(r.desde.slice(8, 10)), m1 = MES_CORTO[Number(r.desde.slice(5, 7)) - 1];
    var d2 = Number(r.hasta.slice(8, 10)), m2 = MES_CORTO[Number(r.hasta.slice(5, 7)) - 1];
    var mismoAnio = r.desde.slice(0, 4) === r.hasta.slice(0, 4);
    if (mismoAnio && m1 === m2) return d1 + '–' + d2 + ' ' + m1;
    return d1 + ' ' + m1 + (mismoAnio ? '' : ' ' + r.desde.slice(0, 4)) + ' – ' + d2 + ' ' + m2;
  }

  // Lo que se mide de un período: entregas a tiempo, flujo de la cola y ciclo.
  function medir(items, r) {
    var entregados = items.filter(function (i) { return i.fecha_terminada && i.fecha_comprometida && enRango(i.fecha_terminada, r); });
    var aTiempo = entregados.filter(function (i) { return new Date(i.fecha_terminada) <= new Date(i.fecha_comprometida); }).length;
    var cerrados = items.filter(function (i) { return !abierto(i) && enRango(i.fecha_terminada, r); });
    return {
      entregados: entregados.length, aTiempo: aTiempo,
      pct: entregados.length ? Math.round(aTiempo / entregados.length * 1000) / 10 : null,
      entraron: items.filter(function (i) { return enRango(i.fecha_creacion, r); }).length,
      cerradas: cerrados.length,
      ciclo: mediana(cerrados.map(function (i) { return i.dias_abierta; }))
    };
  }
  function delta(a, b) { return (a === null || b === null || a === undefined || b === undefined) ? null : Math.round((a - b) * 10) / 10; }

  function cuerpo(items, opts) {
    opts = opts || {};
    items = items || [];
    var dim = opts.dimension || { campo: 'area_nombre', titulo: 'Área', vacia: '(sin área)' };
    var rr = rangos(opts.periodo), r = rr.r, rAnt = rr.rAnt;
    var act = medir(items, r), ant = rAnt ? medir(items, rAnt) : null;

    // --- Lo abierto, hoy (existencias: no dependen del período) -----------------------------
    var abiertos = items.filter(abierto);
    var atrasados = abiertos.filter(function (i) { return codigo(i) === 'ATRASADA_DESARROLLADOR'; })
      .sort(function (a, b) { return new Date(a.fecha_comprometida) - new Date(b.fecha_comprometida); });
    var atrasadosAltos = atrasados.filter(function (i) { return i.prioridad === 'P1' || i.prioridad === 'P2'; });
    var sinResp = abiertos.filter(function (i) { return !i.desarrollador_asignado; });
    var resbalados = abiertos.filter(function (i) { return (i.re_compromisos || 0) >= 2; });
    var esperando = abiertos.filter(function (i) { return codigo(i) === 'ESPERANDO_VALIDACION' && (i.cumplimiento.dias_esperando || 0) > 3; });
    var sinFecha = abiertos.filter(function (i) { return codigo(i) === 'SIN_COMPROMISO' && (i.dias_abierta || 0) > 5; });
    var saldo = act.entraron - act.cerradas;
    var dPct = ant ? delta(act.pct, ant.pct) : null;

    // --- Nivel 1: En una línea --------------------------------------------------------------
    var sinActividad = !abiertos.length && !act.entraron && !act.cerradas && !act.entregados;
    var estado = sinActividad ? 'neutro'
      : ((atrasadosAltos.length || sinResp.length || (act.entregados >= 3 && act.pct < 70)) ? 'critico'
        : ((atrasados.length || resbalados.length || (act.entregados >= 3 && act.pct < 90) || (r && saldo > 0)) ? 'alerta' : 'ok'));
    var partes = [];
    partes.push(act.entregados
      ? 'Se entregó a tiempo el ' + fmt(act.pct) + ' % de lo comprometido' + (dPct !== null && dPct !== 0 ? ' (' + (dPct > 0 ? '+' : '−') + fmt(Math.abs(dPct)) + ' pp vs. el período anterior)' : '')
      : 'No hubo entregas con fecha comprometida en el período');
    partes.push(atrasados.length
      ? 'hay ' + plural(atrasados.length, 'ítem atrasado', 'ítems atrasados') + (atrasadosAltos.length ? ', ' + atrasadosAltos.length + ' de prioridad alta' : '')
      : 'no hay ítems atrasados');
    if (r) {
      partes.push(saldo > 0 ? 'la cola creció en ' + saldo + ' (entraron ' + act.entraron + ', se cerraron ' + act.cerradas + ')'
        : (saldo < 0 ? 'la cola bajó en ' + Math.abs(saldo) + ' (entraron ' + act.entraron + ', se cerraron ' + act.cerradas + ')'
          : (act.entraron ? 'entró lo mismo que se cerró (' + act.entraron + ')' : 'no entraron ítems nuevos')));
    }
    var frase = partes.join('; ') + '.';
    var kpis = [
      { etiqueta: 'Entregado a tiempo', valor: act.pct === null ? '—' : act.pct, sufijo: act.pct === null ? '' : '%', icono: 'diana',
        tono: act.pct === null ? 'neutro' : (act.pct >= 90 ? 'ok' : (act.pct >= 70 ? 'alerta' : 'critico')),
        progreso: act.pct, delta: dPct, deltaSufijo: ' pp',
        nota: act.entregados ? act.aTiempo + ' de ' + act.entregados + ' entregas' : 'sin entregas en el período',
        titulo: 'Entregas con fecha comprometida que terminaron en el período, a tiempo.' },
      { etiqueta: 'Atrasados ahora', valor: atrasados.length, icono: 'alerta', tono: atrasados.length ? 'critico' : 'ok',
        nota: atrasados.length ? 'el más antiguo: ' + plural(diasDesde(atrasados[0].fecha_comprometida), 'día', 'días') : 'todo al día' },
      { etiqueta: 'Se cerraron', valor: act.cerradas, icono: 'check', tono: 'primario',
        delta: ant ? act.cerradas - ant.cerradas : null, nota: r ? 'entraron ' + act.entraron : '',
        titulo: 'Ítems cerrados en el período (entraron ' + act.entraron + ').' },
      { etiqueta: 'Tiempo de ciclo', valor: act.ciclo === null ? '—' : act.ciclo, unidad: act.ciclo === null ? '' : 'días háb.', icono: 'reloj', tono: 'neutro',
        delta: ant ? delta(act.ciclo, ant.ciclo) : null, deltaSufijo: ' d', menosEsMejor: true,
        nota: act.ciclo === null ? 'sin cierres en el período' : '',
        titulo: 'Mediana de días hábiles entre que entra y se cierra un ítem.' }
    ];
    var nivel1 = R().enUnaLinea({
      estado: estado, frase: frase, kpis: kpis,
      comparaCon: rAnt ? 'vs. ' + textoRango(rAnt) : ''
    });

    // --- Nivel 2: Lo que requiere decisión ---------------------------------------------------
    var alertas = [];
    if (atrasadosAltos.length) {
      alertas.push({ severidad: 'critico', cantidad: atrasadosAltos.length, titulo: 'Prioridad alta (P1/P2) atrasada',
        detalle: atrasadosAltos.slice(0, 2).map(function (i) { return i.titulo; }).join(' · ') + (atrasadosAltos.length > 2 ? ' · …' : ''),
        dueno: unicos(atrasadosAltos.map(nombre)).join(', ') });
    }
    if (sinResp.length) {
      var masViejo = sinResp.slice().sort(function (a, b) { return (b.dias_abierta || 0) - (a.dias_abierta || 0); })[0];
      alertas.push({ severidad: 'critico', cantidad: sinResp.length, titulo: 'Abiertos sin responsable',
        detalle: 'El más antiguo lleva ' + plural(masViejo.dias_abierta || 0, 'día hábil', 'días hábiles') + ': ' + masViejo.titulo });
    }
    var porPersona = {};
    atrasados.forEach(function (i) { var n = nombre(i) || '(sin asignar)'; (porPersona[n] = porPersona[n] || []).push(i); });
    Object.keys(porPersona).forEach(function (n) {
      var lista = porPersona[n], dias = diasDesde(lista[0].fecha_comprometida);
      alertas.push({ severidad: (lista.length >= 3 || dias > 10) ? 'critico' : 'alerta', cantidad: lista.length,
        titulo: 'Atrasados', dueno: n,
        detalle: 'El más antiguo venció hace ' + plural(dias, 'día', 'días') + ': ' + lista[0].titulo });
    });
    if (resbalados.length) {
      alertas.push({ severidad: 'alerta', cantidad: resbalados.length, titulo: 'Compromisos movidos 2 o más veces',
        detalle: resbalados.slice(0, 2).map(function (i) { return i.titulo + ' (' + i.re_compromisos + ' veces)'; }).join(' · ') });
    }
    if (esperando.length) {
      alertas.push({ severidad: 'alerta', cantidad: esperando.length, titulo: 'Terminados esperando validación hace más de 3 días',
        detalle: 'Los tiene que validar quien los pidió.', dueno: unicos(esperando.map(function (i) { return i.solicitante_nombre; })).slice(0, 3).join(', ') });
    }
    if (sinFecha.length) {
      alertas.push({ severidad: 'alerta', cantidad: sinFecha.length, titulo: 'Abiertos sin fecha comprometida (más de 5 días)',
        detalle: 'Sin fecha no se puede medir ni avisar el atraso.' });
    }
    var nivel2 = R().requiereDecision(alertas, { vacio: 'No hay atrasos, ítems sin responsable ni compromisos resbalados.' });

    // --- Nivel 3: Panorama ----------------------------------------------------------------------
    var grupos = {};
    items.forEach(function (i) {
      if (!(i.fecha_terminada && i.fecha_comprometida && enRango(i.fecha_terminada, r))) return;
      var g = i[dim.campo] || dim.vacia;
      grupos[g] = grupos[g] || { total: 0, ok: 0 };
      grupos[g].total++;
      if (new Date(i.fecha_terminada) <= new Date(i.fecha_comprometida)) grupos[g].ok++;
    });
    var filasDim = Object.keys(grupos).map(function (g) {
      var x = grupos[g], pct = Math.round(x.ok / x.total * 100);
      return { etiqueta: g, valor: pct, texto: pct + '% · ' + x.ok + '/' + x.total, tono: pct >= 90 ? 'ok' : (pct >= 70 ? 'alerta' : 'critico'), total: x.total, ok: x.ok };
    }).sort(function (a, b) { return a.valor - b.valor || b.total - a.total; }); // lo peor arriba
    var bien = [];
    filasDim.filter(function (f) { return f.valor === 100 && f.total >= 3; }).slice(0, 2).forEach(function (f) {
      bien.push(f.etiqueta + ' entregó a tiempo sus ' + f.total + ' compromisos.');
    });
    if (dPct !== null && dPct > 0) bien.push('El cumplimiento mejoró ' + fmt(dPct) + ' pp respecto del período anterior.');
    if (r && saldo < 0) bien.push('Se cerró más de lo que entró: la cola bajó en ' + Math.abs(saldo) + '.');
    var tend = (opts.tendencia || []).map(function (t) { return { etiqueta: t.etiqueta, creadas: t.creadas || 0, cerradas: t.cerradas || 0 }; });
    var nivel3 =
      '<div class="rp2-dos">' +
        '<div>' + '<h3 class="rp2-sub">Entrada y salida por mes</h3>' +
          R().columnas(tend, [{ campo: 'creadas', etiqueta: 'Entraron', tono: 'primario' }, { campo: 'cerradas', etiqueta: 'Se cerraron', tono: 'ok' }], { titulo: 'Entrada y salida por mes', vacio: 'Sin meses medidos.' }) +
        '</div>' +
        '<div>' + '<h3 class="rp2-sub">A tiempo por ' + dim.titulo.toLowerCase() + ' <span class="sx2-tenue" style="font-weight:500;font-size:.8125rem">(lo peor arriba)</span></h3>' +
          R().ranking(filasDim, { vacio: 'Nadie entregó compromisos en el período.' }) +
        '</div>' +
      '</div>' + R().loQueVaBien(bien);

    // --- Nivel 4: Detalle (lo abierto, del más grave al menos grave) -------------------------------
    var filas = abiertos.map(function (i) {
      var sit = !i.desarrollador_asignado ? SIN_RESPONSABLE : (SITUACION[codigo(i)] || SITUACION.EN_PLAZO);
      return { i: i, sit: sit };
    }).sort(function (a, b) {
      return (a.sit.orden - b.sit.orden) ||
        (a.sit.orden === 0 ? new Date(a.i.fecha_comprometida) - new Date(b.i.fecha_comprometida) : (b.i.dias_abierta || 0) - (a.i.dias_abierta || 0));
    }).map(function (x) {
      var i = x.i;
      return {
        item: '<span class="rp2-item"><strong>' + U().esc(i.titulo || '(sin título)') + '</strong><small>' + U().esc(i.solicitud_id + '-' + (i.numero_item || 1)) + '</small></span>',
        responsable: U().esc(nombre(i) || '—'),
        dim: U().esc(i[dim.campo] || dim.vacia),
        prioridad: i.prioridad ? U().badge(i.prioridad, PRIORIDAD_TONO[i.prioridad] || 'neutro', true) : '—',
        situacion: U().badge(x.sit.texto, x.sit.tono, true),
        compromiso: i.fecha_comprometida ? U().esc(PYv2.fecha(i.fecha_comprometida, true)) : '—',
        dias: i.dias_abierta === null || i.dias_abierta === undefined ? '—' : i.dias_abierta
      };
    });
    var nivel4 = '<div class="rp2-detalle">' + R().tabla([
      { campo: 'item', titulo: 'Ítem', html: true }, { campo: 'responsable', titulo: 'Responsable', html: true },
      { campo: 'dim', titulo: dim.titulo, html: true }, { campo: 'prioridad', titulo: 'Prioridad', html: true },
      { campo: 'situacion', titulo: 'Situación', html: true }, { campo: 'compromiso', titulo: 'Compromiso', html: true },
      { campo: 'dias', titulo: 'Días', alinear: 'derecha' }
    ], filas, { vacio: 'No hay ítems abiertos.' }) + '</div>';

    return R().nivel('En una línea', nivel1) +
      R().nivel('Lo que requiere decisión', nivel2, { nota: alertas.length ? plural(alertas.length, 'alerta', 'alertas') : '' }) +
      R().nivel('Panorama', nivel3, { nota: r ? textoRango(r) + (r.enCurso ? ' (a la fecha)' : '') + (rAnt ? ' · comparado con ' + textoRango(rAnt) : '') : 'todo el historial' }) +
      R().nivel('Detalle · lo abierto, del más grave al menos grave', nivel4, { clase: 'rp2-nivel--detalle', nota: plural(abiertos.length, 'ítem', 'ítems') });
  }

  function unicos(lista) {
    return lista.filter(function (x, i) { return x && lista.indexOf(x) === i; });
  }

  window.SigsoReporteServicio = { cuerpo: cuerpo, medir: medir, rangos: rangos, moverMeses: moverMeses };
})();
