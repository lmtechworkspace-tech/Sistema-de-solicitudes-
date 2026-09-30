'use strict';

/**
 * reporteProyecto.js — puerto de Proyectos.descargarReporte en
 * backend/backoffice/Proyectos.gs: cubre los DOS caminos del .gs --
 * "de un clic" (construirHtmlReporteProyecto_, sin config: ficha, resumen
 * ejecutivo, avance por tarea, hitos, riesgos abiertos, próximos
 * vencimientos, rendimiento y bitácora reciente) y el modo "Configurar
 * informe" (construirHtmlReporteConfigurado_, con `data.config`: secciones
 * a elección + filtro de personas/estado/rango). Reusa Proyectos.getDetalle/
 * listarTareas/obtenerRendimiento/listarBitacora -- misma lógica de datos
 * que ya usa la pantalla, este módulo solo la dibuja.
 *
 * `gantt`/`workload`/`leyenda` (Etapa 9 de la refactorización de
 * Planificación): NO reproducen la grilla día×letra del .gs (paginación
 * multipágina celda a celda) sino una Carta Gantt ejecutiva -- una página
 * apaisada propia con una fila por hito/tarea y una barra de color por
 * semana, más carga de trabajo (tareas activas por responsable) y su
 * leyenda -- mismo criterio de simplificación ya aplicado en `mini_gantt`
 * (contenido equivalente, forma más simple de dibujar con pdfkit).
 *
 * "Avance por tarea" (sección `mini_gantt` del config) reemplaza la Carta
 * Gantt semanal del .gs (grilla de chips por semana) por una lista de
 * barras de progreso por tarea -- decisión de diseño explícita: mismo
 * contenido (qué tan avanzada va cada tarea, comparado con el plan), forma
 * más simple de dibujar con pdfkit. Mismo criterio ya usado en el camino
 * "de un clic".
 */

const Proyectos = require('./proyectos');
const PdfDoc = require('./pdfDocumento');
const DocV2 = require('./documentoV2');
const ReportePdf = require('./reportePdf');

// Nombre de archivo único para todo lo que se descarga de un proyecto
// (auditoría P5): sigso-<qué>-<proyecto>-<aaaa-mm-dd>.pdf, en minúsculas y sin
// tildes. Antes: "Reporte - X.pdf", "reporte-x-fecha.pdf" y "X.xlsx".
function baseArchivoProyecto_(p) { return [p.codigo, p.nombre].filter(Boolean).join('-') || 'proyecto'; }
function nombreArchivoProyecto_(que, p) {
  return ReportePdf.nombreArchivo_('sigso-' + que + '-' + baseArchivoProyecto_(p));
}
const { errorValidacion } = require('./errores');

const ESTADO_PROYECTO_LABEL = {
  PLANIFICACION: 'Planificación', ACTIVO: 'Activo', EN_PAUSA: 'En pausa',
  EN_REVISION: 'En revisión', CERRADO: 'Cerrado', CANCELADO: 'Cancelado'
};
const SALUD_LABEL = { normal: 'Normal', riesgo: 'En riesgo', critico: 'Crítico' };
const SALUD_COLOR = { normal: '#16A34A', riesgo: '#D97706', critico: '#DC2626' };
const SEMAFORO_LABEL = {
  atrasada: 'Atrasada', riesgo: 'En riesgo', pendiente: 'Pendiente',
  bloqueada: 'Bloqueada', 'al-dia': 'Al día', terminada: 'Terminada', revision: 'En revisión'
};
const HITO_ESTADO_LABEL = { PENDIENTE: 'Pendiente', EN_CURSO: 'En curso', COMPLETADO: 'Completado', CANCELADO: 'Cancelado' };
const BITACORA_TIPO_LABEL = {
  CREADA: 'Asignada', CHECKIN_AVANCE: 'Avance', CHECKIN_SIN_CAMBIO: 'Sin cambios',
  DESBLOQUEO: 'Se destrabó', BLOQUEO: 'Bloqueada', ENTREGA: 'Entregada', VALIDACION: 'Revisión',
  REGISTRO_DIA: 'Registro del día'
};
const VENCIMIENTOS_ORDEN = { atrasada: 0, riesgo: 1, pendiente: 2, bloqueada: 3, 'al-dia': 4, revision: 5 };
const VENCIMIENTOS_TOPE = 8;
const AVANCE_TOPE = 15;

// Mismo catálogo que REPORTE_SECCIONES_DISPONIBLES_ (Proyectos.gs).
const SECCIONES_DISPONIBLES = [
  'portada', 'narrativa', 'ficha', 'kpis', 'salud', 'mini_gantt', 'gantt', 'workload', 'leyenda',
  'hitos', 'riesgos', 'vencimientos', 'rendimiento', 'desviaciones', 'bitacora'
];
// Ninguna sección sin soportar por ahora -- se deja el arreglo (en vez de
// borrarlo) porque descargarReporte lo usa como el único punto de control
// si algún día se vuelve a acotar el alcance de una sección nueva.
const SECCIONES_NO_SOPORTADAS = [];
const REPORTE_SECCION_LABEL = {
  narrativa: 'Resumen ejecutivo', ficha: 'Ficha del proyecto', kpis: 'Indicadores clave',
  salud: 'Salud del proyecto', mini_gantt: 'Avance por tarea', gantt: 'Carta Gantt ejecutiva',
  workload: 'Carga de trabajo', leyenda: 'Leyenda', hitos: 'Hitos',
  riesgos: 'Riesgos abiertos', vencimientos: 'Próximos vencimientos', rendimiento: 'Rendimiento',
  desviaciones: 'Plan · Esperado · Real', bitacora: 'Actividad reciente'
};

// Puerto de normalizarConfigReporte_: nunca deja pasar una config con forma
// inesperada, cae a valores seguros. null = "no hay config" (camino clásico).
function normalizarConfig_(config) {
  if (!config) return null;
  let secciones = Array.isArray(config.secciones) ? config.secciones.filter((s) => SECCIONES_DISPONIBLES.indexOf(s) !== -1) : [];
  if (!secciones.length) secciones = ['ficha'];
  const personas = Array.isArray(config.personas)
    ? config.personas.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const estado = ['abiertas', 'atrasadas'].indexOf(config.estado) !== -1 ? config.estado : '';
  let rango = null;
  if (config.rango && /^\d{4}-\d{2}-\d{2}$/.test(config.rango.desde || '') &&
      /^\d{4}-\d{2}-\d{2}$/.test(config.rango.hasta || '') && config.rango.desde <= config.rango.hasta) {
    rango = { desde: config.rango.desde, hasta: config.rango.hasta };
  }
  return { secciones, personas, estado, rango };
}

function filtrarTareas_(tareas, config) {
  return tareas.filter((a) => {
    if (config.personas.length) {
      const email = String(a.responsable_email || '').trim().toLowerCase();
      if (config.personas.indexOf(email) === -1) return false;
    }
    if (config.estado === 'abiertas' && (a.estado === 'TERMINADA' || a.estado === 'CANCELADA')) return false;
    if (config.estado === 'atrasadas' && a.semaforo !== 'atrasada') return false;
    return true;
  });
}

// dd/mm/aaaa para el texto corrido (la fecha ISO no se lee en una frase).
function fechaLegible_(valor) {
  const m = String(valor || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
}

function fechaCorta_(valor) {
  if (!valor) return '—';
  return String(valor).slice(0, 10);
}

// Mismas frases que seccionNarrativaPdf_ (heurística determinística sobre
// datos ya calculados, no IA): salud, avance vs. esperado, qué requiere
// atención, próximo hito, y una decisión sugerida.
// Número con coma decimal (es-CL), como el resto del documento: "19,6 %".
function numeroCl_(n) { return Number(n).toLocaleString('es-CL', { maximumFractionDigits: 1 }); }
function pctCl_(n) { return numeroCl_(n) + ' %'; }

function construirNarrativa_(detalle) {
  const at = detalle.requiere_atencion || {};
  const avance = detalle.avance_pct;
  const esperado = detalle.avance_esperado_pct;
  const desviacion = (avance != null && esperado != null) ? Math.round((avance - esperado) * 10) / 10 : null;

  const frases = [];
  // Sin "(N puntos en contra)": el puntaje se explica en la sección Salud.
  frases.push('El proyecto está en estado ' + (SALUD_LABEL[detalle.salud] || detalle.salud) + '.');

  // "En línea" solo si la brecha es menor a 1 punto: con −2,5 pp el KPI ya
  // sale en rojo y la frase no puede decir lo contrario (auditoría P3).
  if (avance == null) {
    frases.push('Todavía no hay tareas activas para medir avance.');
  } else if (desviacion == null) {
    frases.push('Avance real: ' + pctCl_(avance) + '.');
  } else if (desviacion <= -1) {
    frases.push('El avance real (' + pctCl_(avance) + ') va ' + numeroCl_(Math.abs(desviacion)) + ' puntos por debajo de lo planificado (' + pctCl_(esperado) + ').');
  } else if (desviacion >= 1) {
    frases.push('El avance real (' + pctCl_(avance) + ') va ' + numeroCl_(desviacion) + ' puntos por encima de lo planificado (' + pctCl_(esperado) + ').');
  } else {
    frases.push('El avance real (' + pctCl_(avance) + ') está en línea con lo planificado (' + pctCl_(esperado) + ').');
  }

  const problemas = [];
  const pl = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
  if (at.tareas_criticas_atrasadas > 0) problemas.push(pl(at.tareas_criticas_atrasadas, 'tarea crítica (P1/P2) atrasada', 'tareas críticas (P1/P2) atrasadas'));
  if (at.tareas_bloqueadas > 0) problemas.push(pl(at.tareas_bloqueadas, 'tarea bloqueada', 'tareas bloqueadas'));
  if (at.hitos_atrasados > 0) problemas.push(pl(at.hitos_atrasados, 'hito vencido', 'hitos vencidos'));
  if (at.riesgos_altos > 0) problemas.push(pl(at.riesgos_altos, 'riesgo alto abierto', 'riesgos altos abiertos'));
  frases.push(problemas.length
    ? 'Requiere atención: ' + problemas.join(', ') + '.'
    : 'No hay tareas críticas atrasadas, bloqueos, hitos vencidos ni riesgos altos abiertos en este momento.');

  const hitosVivos = (detalle.hitos || [])
    .filter((h) => h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo)
    .sort((a, b) => new Date(a.fecha_objetivo) - new Date(b.fecha_objetivo));
  if (hitosVivos[0]) frases.push('Próximo hito: ' + hitosVivos[0].nombre + ' (' + fechaLegible_(hitosVivos[0].fecha_objetivo) + ').');

  let decision;
  if (at.riesgos_altos > 0) decision = 'Revisar la mitigación de los riesgos altos abiertos.';
  else if (at.tareas_criticas_atrasadas > 0) decision = 'Priorizar destrabar las tareas críticas atrasadas.';
  else if (at.hitos_atrasados > 0) decision = at.hitos_atrasados === 1 ? 'Replanificar el hito vencido con el equipo.' : 'Replanificar los hitos vencidos con el equipo.';
  else if (desviacion != null && desviacion < -10) decision = 'Evaluar un ajuste de plan: el atraso acumulado supera 10 puntos.';
  else decision = 'Sin decisiones urgentes -- seguimiento normal.';

  return { texto: frases.join(' '), decision };
}

function dibujarNarrativa_(doc, detalle) {
  PdfDoc.seccion(doc, 'Resumen ejecutivo');
  const n = construirNarrativa_(detalle);
  doc.font('Helvetica').fontSize(9.5).fillColor(PdfDoc.DOC.INK_SOFT).text(n.texto, PdfDoc.MARGIN, doc.y, { width: PdfDoc.CONTENT_WIDTH });
  doc.moveDown(0.5);
  PdfDoc.asegurarEspacio(doc, 30);
  const y = doc.y;
  doc.rect(PdfDoc.MARGIN, y, 3, 26).fill(PdfDoc.DOC.NAVY);
  doc.rect(PdfDoc.MARGIN + 3, y, PdfDoc.CONTENT_WIDTH - 3, 26).fill(PdfDoc.DOC.PANEL);
  doc.fillColor(PdfDoc.DOC.INK).font('Helvetica-Bold').fontSize(8.5)
    .text('Decisión sugerida: ', PdfDoc.MARGIN + 10, y + 8, { continued: true })
    .font('Helvetica').text(n.decision, { width: PdfDoc.CONTENT_WIDTH - 20 });
  doc.y = y + 34;
  doc.x = PdfDoc.MARGIN;
}

// "Gantt simplificado": una barra de progreso por tarea (avance real, de
// rendimiento.plan_seguimiento) en vez de la grilla semana x semana del
// .gs -- ver la nota de diseño en la cabecera del archivo.
function dibujarAvancePorTarea_(doc, tareas, rendimiento) {
  const avancePorTarea = {};
  (rendimiento.plan_seguimiento || []).forEach((p) => { avancePorTarea[p.actividad_id] = p; });
  const activas = tareas.filter((a) => a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA');
  if (!activas.length) return;

  PdfDoc.seccion(doc, 'Avance por tarea');
  const mostrar = activas.slice(0, AVANCE_TOPE);
  const anchoTexto = PdfDoc.CONTENT_WIDTH - 140;
  mostrar.forEach((a) => {
    const plan = avancePorTarea[a.actividad_id];
    // avanceRealTarea_ devuelve null cuando la tarea no tiene un avance_pct
    // explicito ni esta NO_INICIADA/TERMINADA -- eso es "sin dato", no "0%
    // de avance". Mostrarlo como 0% seria fingir un numero que no existe.
    const pctReal = plan ? plan.avance_real_pct : null;
    const pct = pctReal == null ? 0 : pctReal;
    // Alto real de la fila (titulo -- puede envolver a 2+ lineas -- +
    // subtitulo + la barra) reservado de una sola vez ANTES de dibujar
    // nada: si se reserva de a poco (como antes, un 26 fijo) la fila
    // puede partirse a mitad de pagina -- el titulo queda en una pagina y
    // la barra, huerfana, en la siguiente (el asegurarEspacio interno de
    // barraHorizontal encuentra que ya no hay espacio y corta ahi). Medir
    // heightOfString con la MISMA fuente/tamaño del titulo, nunca con la
    // que haya quedado activa despues de dibujar otra cosa.
    const alturaTitulo = doc.font('Helvetica-Bold').fontSize(8.5).heightOfString(a.titulo, { width: anchoTexto });
    PdfDoc.asegurarEspacio(doc, alturaTitulo + 36);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PdfDoc.DOC.INK).text(a.titulo, PdfDoc.MARGIN, y, { width: anchoTexto });
    doc.font('Helvetica').fontSize(7.5).fillColor(PdfDoc.DOC.MUTED)
      .text((a.responsable_nombre || a.responsable_email || 'Sin asignar') + ' · ' + (SEMAFORO_LABEL[a.semaforo] || a.semaforo || '—') +
        ' · vence ' + fechaCorta_(a.fecha_compromiso), PdfDoc.MARGIN, y + alturaTitulo + 2, { width: anchoTexto });
    // Posicion fija (no la que haya dejado el ultimo .text()): la barra
    // siempre debajo del titulo+subtitulo, nunca depende de cuanto haya
    // avanzado doc.y con la fuente de turno.
    doc.y = y + alturaTitulo + 14;
    doc.x = PdfDoc.MARGIN;
    PdfDoc.barraHorizontal(doc, '', pct, pctReal == null ? 'sin dato' : pct + '%');
    doc.moveDown(0.35);
    doc.x = PdfDoc.MARGIN;
  });
  if (activas.length > mostrar.length) {
    doc.font('Helvetica').fontSize(8).fillColor(PdfDoc.DOC.FAINT).text('+ ' + (activas.length - mostrar.length) + ((activas.length - mostrar.length) === 1 ? ' tarea más.' : ' tareas más.'), PdfDoc.MARGIN, doc.y);
    doc.moveDown(0.4);
  }
}

function dibujarHitos_(doc, hitos) {
  if (!hitos.length) return;
  const hoy = new Date();
  const ordenados = hitos.slice().sort((a, b) => {
    const ka = a.fecha_objetivo || '9999-99-99', kb = b.fecha_objetivo || '9999-99-99';
    return ka < kb ? -1 : (ka > kb ? 1 : 0);
  });
  PdfDoc.seccion(doc, 'Hitos');
  PdfDoc.tablaGenerica(doc,
    [{ campo: 'nombre', etiqueta: 'Hito' }, { campo: 'estado', etiqueta: 'Estado' }, { campo: 'fecha', etiqueta: 'Fecha objetivo' }, { campo: 'cuando', etiqueta: 'Cuándo' }],
    ordenados.map((h) => {
      let cuando = '—';
      if (h.estado === 'COMPLETADO') cuando = 'Completado';
      else if (h.fecha_objetivo) {
        const dias = Math.round((new Date(h.fecha_objetivo) - hoy) / 86400000);
        cuando = dias < 0 ? 'venció hace ' + (-dias) + ' d' : (dias === 0 ? 'hoy' : 'en ' + dias + ' d');
      }
      return { nombre: h.nombre, estado: HITO_ESTADO_LABEL[h.estado] || h.estado, fecha: fechaCorta_(h.fecha_objetivo), cuando };
    })
  );
  doc.moveDown(0.3);
}

function dibujarRiesgos_(doc, riesgos, nombresPorEmail) {
  const abiertos = (riesgos || []).filter((r) => r.estado !== 'CERRADO');
  if (!abiertos.length) return;
  PdfDoc.seccion(doc, 'Riesgos abiertos');
  PdfDoc.tablaGenerica(doc,
    [{ campo: 'riesgo', etiqueta: 'Riesgo' }, { campo: 'nivel', etiqueta: 'Nivel' }, { campo: 'responsable', etiqueta: 'Responsable' }, { campo: 'mitigacion', etiqueta: 'Mitigación' }],
    abiertos.map((r) => ({
      riesgo: r.descripcion, nivel: r.nivel,
      responsable: r.responsable_email ? (nombresPorEmail[r.responsable_email] || r.responsable_email) : '—',
      mitigacion: r.mitigacion || 'Sin plan de mitigación'
    }))
  );
  doc.moveDown(0.3);
}

function dibujarVencimientos_(doc, tareas) {
  const pendientes = tareas.filter((a) => a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA')
    .sort((a, b) => {
      const oa = VENCIMIENTOS_ORDEN[a.semaforo] === undefined ? 9 : VENCIMIENTOS_ORDEN[a.semaforo];
      const ob = VENCIMIENTOS_ORDEN[b.semaforo] === undefined ? 9 : VENCIMIENTOS_ORDEN[b.semaforo];
      if (oa !== ob) return oa - ob;
      return new Date(a.fecha_compromiso || '9999-12-31') - new Date(b.fecha_compromiso || '9999-12-31');
    });
  if (!pendientes.length) return;
  const mostrar = pendientes.slice(0, VENCIMIENTOS_TOPE);
  PdfDoc.seccion(doc, 'Próximos vencimientos');
  doc.font('Helvetica').fontSize(8).fillColor(PdfDoc.DOC.MUTED).text(
    pendientes.length + (pendientes.length === 1 ? ' tarea pendiente en total' : ' tareas pendientes en total') +
    (pendientes.length > mostrar.length ? ' · se listan las ' + mostrar.length + ' más urgentes' : ''),
    PdfDoc.MARGIN, doc.y
  );
  doc.moveDown(0.3);
  PdfDoc.tablaGenerica(doc,
    [{ campo: 'tarea', etiqueta: 'Tarea' }, { campo: 'estado', etiqueta: 'Estado' }, { campo: 'responsable', etiqueta: 'Responsable' }, { campo: 'compromiso', etiqueta: 'Compromiso' }],
    mostrar.map((a) => ({
      tarea: a.titulo, estado: SEMAFORO_LABEL[a.semaforo] || a.semaforo || '—',
      responsable: a.responsable_nombre || a.responsable_email || '—', compromiso: fechaCorta_(a.fecha_compromiso)
    }))
  );
  doc.moveDown(0.3);
}

function dibujarRendimiento_(doc, rendimiento) {
  if (!rendimiento) return;
  const c = rendimiento.cumplimiento_tareas || {};
  const tieneRitmo = rendimiento.promedio_unidades_dia != null;
  PdfDoc.seccion(doc, 'Rendimiento');
  PdfDoc.fichaTabla(doc, [
    ['Entregas a tiempo', c.entregadas ? (c.a_tiempo + ' de ' + c.entregadas) : '—', 'Horas registradas', rendimiento.horas_totales_proyecto ? numeroCl_(rendimiento.horas_totales_proyecto) : '—'],
    ['Ritmo promedio', tieneRitmo ? rendimiento.promedio_unidades_dia + '/día' : '—', 'Tareas sin arrancar', String(rendimiento.tareas_sin_avance)]
  ]);
  if (rendimiento.por_tarea && rendimiento.por_tarea.length) {
    doc.moveDown(0.2);
    PdfDoc.tablaGenerica(doc,
      [{ campo: 'titulo', etiqueta: 'Tarea' }, { campo: 'meta', etiqueta: 'Meta' }, { campo: 'ritmo', etiqueta: 'Ritmo' }],
      rendimiento.por_tarea.map((t) => ({
        titulo: t.titulo, meta: t.meta_cantidad + (t.meta_unidad ? ' ' + t.meta_unidad : ''),
        ritmo: t.unidades_por_dia !== '' ? t.unidades_por_dia + '/día' : '—'
      }))
    );
  }
  doc.moveDown(0.3);
}

function dibujarBitacora_(doc, bitacora) {
  if (!bitacora.length) return;
  PdfDoc.seccion(doc, 'Actividad reciente');
  PdfDoc.tablaGenerica(doc,
    [{ campo: 'fecha', etiqueta: 'Fecha' }, { campo: 'tipo', etiqueta: 'Tipo' }, { campo: 'horas', etiqueta: 'Horas' }, { campo: 'nota', etiqueta: 'Nota' }],
    bitacora.map((b) => ({
      fecha: fechaCorta_(b.tipo === 'REGISTRO_DIA' && b.dia ? b.dia : b.timestamp),
      tipo: BITACORA_TIPO_LABEL[b.tipo] || b.tipo,
      horas: b.horas != null && b.horas !== '' ? numeroCl_(b.horas) : '—',
      nota: b.nota || '—'
    }))
  );
}

// --- Carta Gantt ejecutiva / Carga de trabajo / Leyenda --------------------
// Puerto de construirSemanasBarrasPdf_/rangoBarrasPdf_/seccionCronogramaBarrasPdf_
// (Proyectos.gs): NO reproduce la grilla día×letra completa del .gs (esa es
// la parte "fuera de alcance" documentada arriba), sino la Carta Gantt
// ejecutiva -- una fila por hito/tarea, una barra de color por semana que
// toca, línea de HOY -- en una página propia APAISADA (más ancho que el
// resto del informe, que es retrato) porque una grilla semanal no entra en
// el ancho de una A4 vertical. Mismo criterio semáforo que
// hojaCartaGanttXlsx_ (libroProyecto.js): reutiliza los mismos 6 colores,
// no los reinventa.
const GANTT_TOPE_SEMANAS = 20; // menos que las 27 del Excel: una pagina apaisada tiene bastante menos ancho que una hoja de calculo que hace scroll
const GANTT_COLOR = {
  'al-dia': '#16A34A', terminada: '#16A34A', riesgo: '#D97706', atrasada: '#DC2626',
  bloqueada: '#2563EB', revision: '#7C3AED', pendiente: '#64748B'
};
const GANTT_COLOR_ATRASO = '#B91C1C';
const GANTT_LEYENDA = [
  ['Al día / terminada', GANTT_COLOR['al-dia']], ['En riesgo', GANTT_COLOR.riesgo],
  ['Atrasada', GANTT_COLOR.atrasada], ['Bloqueada', GANTT_COLOR.bloqueada],
  ['En revisión', GANTT_COLOR.revision], ['Pendiente', GANTT_COLOR.pendiente],
  ['Semana vencida sin cerrar', GANTT_COLOR_ATRASO]
];

// Rombo relleno para marcar un hito en la semana correspondiente -- se
// dibuja como path, no como el caracter '◆' (U+25C6): la fuente estandar
// Helvetica/WinAnsiEncoding de pdfkit no lo tiene y lo muestra como
// caracteres basura (hallazgo de la validacion visual de Etapa 10).
function marcadorHito_(doc, cx, cy, color) {
  const r = 3.5;
  doc.moveTo(cx, cy - r).lineTo(cx + r, cy).lineTo(cx, cy + r).lineTo(cx - r, cy).closePath().fill(color);
}

function claveDia_(valor) {
  if (!valor) return null;
  const f = new Date(valor);
  if (isNaN(f.getTime())) return null;
  return f.toISOString().slice(0, 10);
}
function sumarDiasClave_(clave, n) {
  const p = clave.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}
function lunesDeClave_(clave) {
  const dow = new Date(clave + 'T00:00:00Z').getUTCDay();
  return sumarDiasClave_(clave, dow === 0 ? -6 : -(dow - 1));
}
// Semanas lunes-a-domingo entre dos claves, topadas -- mismo criterio que
// REPORTE_TOPE_SEMANAS_ del .gs (evitar un documento de decenas de paginas).
function semanasGantt_(claveMin, claveMax, tope) {
  const semanas = [];
  let cur = lunesDeClave_(claveMin);
  while (cur <= claveMax && semanas.length < tope) {
    semanas.push({ inicio: cur, fin: sumarDiasClave_(cur, 6), etiqueta: cur.slice(8, 10) + '/' + cur.slice(5, 7) });
    cur = sumarDiasClave_(cur, 7);
  }
  return semanas;
}
// Igual que duracionDiasTarea_ (proyectos.js): si falta fecha_creacion, la
// barra arranca en el inicio del proyecto (o en la fecha de compromiso, a
// falta de ambas) -- nunca se inventa una fecha de inicio que no existe.
//
// Auditoría 2026-09-29 (C2): si viene el plan de obtenerRendimiento, la barra
// arranca en SU plan_inicio (propio, por dependencia o por creación) -- el
// mismo que dibuja la pantalla y el Excel. Sin plan, el criterio de siempre.
function inicioBarraGantt_(a, proyIniClave, plan) {
  if (plan && plan.plan_inicio) return String(plan.plan_inicio).slice(0, 10);
  const creClave = claveDia_(a.fecha_creacion);
  const finClave = claveDia_(a.fecha_compromiso);
  if (creClave && finClave && creClave <= finClave) return creClave;
  if (proyIniClave && finClave && proyIniClave <= finClave) return proyIniClave;
  return creClave || proyIniClave || finClave;
}

function dibujarGanttEjecutivo_(doc, detalle, tareas, hitos, rendimiento) {
  const p = detalle.proyecto;
  const tareasConFecha = tareas.filter((a) => a.fecha_compromiso);
  if (!tareasConFecha.length && !hitos.length) return;
  const planPorId = {};
  ((rendimiento && rendimiento.plan_seguimiento) || []).forEach((t) => { planPorId[t.actividad_id] = t; });

  // "Hoy" en Chile, no en UTC: desde las 21:00 la hora UTC ya es mañana.
  const hoyClave = claveHoyChile_();
  const proyIniClave = claveDia_(p.fecha_inicio);
  const claves = [hoyClave];
  if (proyIniClave) claves.push(proyIniClave);
  hitos.forEach((h) => { const c = claveDia_(h.fecha_objetivo); if (c) claves.push(c); });
  tareasConFecha.forEach((a) => {
    claves.push(inicioBarraGantt_(a, proyIniClave, planPorId[a.actividad_id]));
    claves.push(claveDia_(a.fecha_compromiso));
  });
  const clavesValidas = claves.filter(Boolean);
  const claveMin = clavesValidas.reduce((m, c) => (m === null || c < m ? c : m), null);
  const claveMax = clavesValidas.reduce((m, c) => (m === null || c > m ? c : m), null);
  const semanas = semanasGantt_(claveMin, claveMax, GANTT_TOPE_SEMANAS);
  if (!semanas.length) return;

  // Página propia apaisada: doc.page.width/height ya reflejan la nueva
  // orientación desde este punto (asegurarEspacio/seccion de PdfDoc leen
  // esos valores dinámicamente, no una constante de ancho fijo).
  doc.addPage({ size: 'A4', layout: 'landscape', margin: PdfDoc.MARGIN });
  const anchoContenido = doc.page.width - PdfDoc.MARGIN * 2;
  PdfDoc.seccion(doc, 'Carta Gantt ejecutiva');
  if (tareasConFecha.length > 0 && clavesValidas.length && semanas[semanas.length - 1].fin < claveMax) {
    doc.font('Helvetica').fontSize(7).fillColor(PdfDoc.DOC.FAINT)
      .text('Se muestran las primeras ' + GANTT_TOPE_SEMANAS + ' semanas del proyecto.', PdfDoc.MARGIN, doc.y);
    doc.moveDown(0.3);
  }

  const anchoLabel = 170;
  const anchoSemana = (anchoContenido - anchoLabel) / semanas.length;
  const alturaFila = 12;

  function encabezadoSemanas_() {
    asegurarEspacioApaisado_(doc, alturaFila + 4);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(6);
    semanas.forEach((s, i) => {
      const x = PdfDoc.MARGIN + anchoLabel + i * anchoSemana;
      if (s.inicio <= hoyClave && s.fin >= hoyClave) doc.rect(x, y, anchoSemana, alturaFila).fill('#EEF2F7');
      doc.fillColor(PdfDoc.DOC.MUTED).text(s.etiqueta, x, y + 2, { width: anchoSemana, align: 'center' });
    });
    doc.y = y + alturaFila + 2;
    doc.moveTo(PdfDoc.MARGIN, doc.y).lineTo(PdfDoc.MARGIN + anchoContenido, doc.y).lineWidth(1).strokeColor(PdfDoc.DOC.INK).stroke();
    doc.y += 3;
    doc.x = PdfDoc.MARGIN;
  }
  encabezadoSemanas_();

  const porHito = {};
  const sinHito = [];
  tareasConFecha.forEach((a) => {
    if (a.hito_id && hitos.some((h) => h.hito_id === a.hito_id)) (porHito[a.hito_id] = porHito[a.hito_id] || []).push(a);
    else sinHito.push(a);
  });
  const porCompromiso_ = (a, b) => new Date(a.fecha_compromiso) - new Date(b.fecha_compromiso);
  const hitosOrdenados = hitos.slice().sort((a, b) => new Date(a.fecha_objetivo || '9999-12-31') - new Date(b.fecha_objetivo || '9999-12-31'));

  function filaHito_(h) {
    asegurarEspacioApaisado_(doc, alturaFila, encabezadoSemanas_);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(PdfDoc.DOC.INK)
      .text(h.nombre, PdfDoc.MARGIN, y, { width: anchoLabel - 4, height: alturaFila, ellipsis: true });
    const objClave = claveDia_(h.fecha_objetivo);
    if (objClave) {
      semanas.forEach((s, i) => {
        if (objClave >= s.inicio && objClave <= s.fin) {
          marcadorHito_(doc, PdfDoc.MARGIN + anchoLabel + i * anchoSemana + anchoSemana / 2, y + alturaFila / 2, PdfDoc.DOC.NAVY);
        }
      });
    }
    doc.y = y + alturaFila;
    doc.x = PdfDoc.MARGIN;
  }
  function filaTarea_(a) {
    asegurarEspacioApaisado_(doc, alturaFila, encabezadoSemanas_);
    const y = doc.y;
    doc.font('Helvetica').fontSize(6.5).fillColor(PdfDoc.DOC.INK_SOFT)
      .text(a.titulo, PdfDoc.MARGIN + 4, y, { width: anchoLabel - 8, height: alturaFila, ellipsis: true });
    const barIni = inicioBarraGantt_(a, proyIniClave, planPorId[a.actividad_id]);
    const fin = claveDia_(a.fecha_compromiso);
    const terminal = a.estado === 'TERMINADA' || a.estado === 'CANCELADA';
    const color = GANTT_COLOR[a.semaforo] || GANTT_COLOR.pendiente;
    semanas.forEach((s, i) => {
      const x = PdfDoc.MARGIN + anchoLabel + i * anchoSemana;
      if (barIni && fin && s.fin >= barIni && s.inicio <= fin) {
        doc.rect(x + 0.5, y + 1, anchoSemana - 1, alturaFila - 3).fill(color);
      } else if (!terminal && fin && s.inicio > fin && s.inicio <= hoyClave) {
        doc.rect(x + 0.5, y + 1, anchoSemana - 1, alturaFila - 3).fill(GANTT_COLOR_ATRASO);
      }
    });
    doc.y = y + alturaFila;
    doc.x = PdfDoc.MARGIN;
  }

  hitosOrdenados.forEach((h) => {
    filaHito_(h);
    (porHito[h.hito_id] || []).sort(porCompromiso_).forEach(filaTarea_);
  });
  if (sinHito.length) {
    asegurarEspacioApaisado_(doc, alturaFila, encabezadoSemanas_);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(PdfDoc.DOC.MUTED).text('Sin hito', PdfDoc.MARGIN, doc.y);
    doc.y += alturaFila;
    doc.x = PdfDoc.MARGIN;
    sinHito.sort(porCompromiso_).forEach(filaTarea_);
  }

  // Vuelve a retrato para lo que siga (workload/leyenda/bitácora...): sin
  // opciones, addPage usa las mismas que crearDocumento (A4 retrato) -- el
  // resto de las funciones de dibujo asumen PdfDoc.CONTENT_WIDTH (ancho
  // fijo de A4 retrato), no el ancho de la página apaisada.
  doc.addPage();
  doc.x = PdfDoc.MARGIN;
}

// asegurarEspacio de PdfDoc no sirve tal cual aquí: si toca página nueva,
// esta también debe salir apaisada (addPage sin opciones vuelve a retrato)
// y hay que repetir el encabezado de semanas -- por eso esta variante local.
function asegurarEspacioApaisado_(doc, altura, repintarEncabezado) {
  const limite = doc.page.height - doc.page.margins.bottom;
  if (doc.y + altura > limite) {
    doc.addPage({ size: 'A4', layout: 'landscape', margin: PdfDoc.MARGIN });
    doc.x = PdfDoc.MARGIN;
    if (repintarEncabezado) repintarEncabezado();
  }
}

// Carga de trabajo: cantidad de tareas activas por responsable (no horas --
// la bitácora de horas es opcional y por tarea, no da una cifra fiable de
// "carga" comparable entre personas; el conteo de tareas activas sí lo es).
// Misma barra horizontal que ya usa dibujarAvancePorTarea_/Pausas.gs.
function dibujarCargaTrabajo_(doc, tareas, nombresPorEmail) {
  const activas = tareas.filter((a) => a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA');
  if (!activas.length) return;
  const porPersona = {};
  activas.forEach((a) => {
    const key = a.responsable_email || '(sin asignar)';
    if (!porPersona[key]) porPersona[key] = { nombre: nombresPorEmail[key] || a.responsable_nombre || key, total: 0, atrasadas: 0 };
    porPersona[key].total++;
    if (a.semaforo === 'atrasada') porPersona[key].atrasadas++;
  });
  const claves = Object.keys(porPersona);
  const maxTotal = Math.max.apply(null, claves.map((k) => porPersona[k].total));

  PdfDoc.seccion(doc, 'Carga de trabajo');
  doc.font('Helvetica').fontSize(7.5).fillColor(PdfDoc.DOC.FAINT).text('Tareas activas por responsable (no cerradas).', PdfDoc.MARGIN, doc.y);
  doc.moveDown(0.3);
  claves.sort((x, y) => porPersona[y].total - porPersona[x].total).forEach((key) => {
    const r = porPersona[key];
    const pct = maxTotal ? Math.round((r.total / maxTotal) * 100) : 0;
    PdfDoc.barraHorizontal(doc, r.nombre, pct, r.total + (r.total === 1 ? ' tarea' : ' tareas') + (r.atrasadas ? ' · ' + r.atrasadas + ' atr.' : ''));
  });
  doc.moveDown(0.3);
}

function dibujarLeyendaGantt_(doc) {
  PdfDoc.seccion(doc, 'Leyenda');
  let x = PdfDoc.MARGIN;
  let y = doc.y;
  const filaAltura = 20;
  GANTT_LEYENDA.forEach(([etiqueta, color]) => {
    doc.font('Helvetica').fontSize(8);
    const ancho = 14 + doc.widthOfString(etiqueta) + 16;
    if (x + ancho > PdfDoc.MARGIN + PdfDoc.CONTENT_WIDTH) { x = PdfDoc.MARGIN; y += filaAltura; }
    PdfDoc.asegurarEspacio(doc, filaAltura);
    doc.rect(x, y + 3, 10, 10).fill(color);
    doc.fillColor(PdfDoc.DOC.INK_SOFT).text(etiqueta, x + 14, y + 3, { lineBreak: false });
    x += ancho;
  });
  doc.y = y + filaAltura;
  doc.x = PdfDoc.MARGIN;
  doc.moveDown(0.2);
}

function dibujarFicha_(doc, detalle) {
  const p = detalle.proyecto;
  PdfDoc.seccion(doc, 'Ficha del proyecto');
  PdfDoc.fichaTabla(doc, [
    ['Líder', p.lider_email || '—', 'Estado', ESTADO_PROYECTO_LABEL[p.estado] || p.estado],
    ['Salud', SALUD_LABEL[detalle.salud] || detalle.salud, 'Avance', detalle.avance_pct == null ? '—' : detalle.avance_pct + '%'],
    ['Inicio', fechaCorta_(p.fecha_inicio), 'Fecha objetivo', fechaCorta_(p.fecha_objetivo)]
  ]);
  if (detalle.salud_motivos && detalle.salud_motivos.length) {
    doc.font('Helvetica').fontSize(8).fillColor(PdfDoc.DOC.MUTED).text(detalle.salud_motivos.join(' · '), PdfDoc.MARGIN, doc.y, { width: PdfDoc.CONTENT_WIDTH });
    doc.moveDown(0.4);
  }
}

// Puerto de seccionPortadaPdf_/lineaEstadoPortadaPdf_/indiceContenidoPdf_,
// simplificado a alineación izquierda (el resto del documento tampoco
// centra nada -- consistencia visual > replicar el centrado del .gs).
function dibujarPortada_(doc, detalle, seccionesIncluidas) {
  const p = detalle.proyecto;
  doc.font('Helvetica').fontSize(9).fillColor(PdfDoc.DOC.MUTED).text('REPORTE EJECUTIVO DE PROYECTO', PdfDoc.MARGIN, doc.y, { characterSpacing: 1.2 });
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(PdfDoc.DOC.INK).text(p.nombre, PdfDoc.MARGIN, doc.y, { width: PdfDoc.CONTENT_WIDTH });
  doc.moveDown(0.5);
  const scoreTxt = detalle.salud_penalizacion ? ' · ' + detalle.salud_penalizacion + ' pts en contra' : '';
  PdfDoc.chip(doc, (SALUD_LABEL[detalle.salud] || detalle.salud) + scoreTxt, SALUD_COLOR[detalle.salud] || PdfDoc.DOC.MUTED);
  doc.moveDown(0.3);

  const partes = [];
  if (detalle.avance_pct != null) partes.push(detalle.avance_pct + '% avanzado');
  if (detalle.avance_pct != null && detalle.avance_esperado_pct != null) {
    const d = Math.round((detalle.avance_pct - detalle.avance_esperado_pct) * 10) / 10;
    partes.push(d < 0 ? (-d) + ' pp bajo lo esperado' : (d > 0 ? '+' + d + ' pp sobre lo esperado' : 'en línea con lo esperado'));
  }
  const venc = (detalle.requiere_atencion || {}).tareas_vencidas || 0;
  if (venc > 0) partes.push(venc + (venc === 1 ? ' tarea vencida' : ' tareas vencidas'));
  if (partes.length) {
    doc.font('Helvetica').fontSize(9).fillColor(PdfDoc.DOC.MUTED).text(partes.join('  ·  '), PdfDoc.MARGIN, doc.y, { width: PdfDoc.CONTENT_WIDTH });
    doc.moveDown(0.5);
  }

  PdfDoc.fichaTabla(doc, [
    ['Código', p.codigo || '—', 'Estado', ESTADO_PROYECTO_LABEL[p.estado] || p.estado],
    ['Líder', p.lider_email || '—', 'Período', fechaCorta_(p.fecha_inicio) + ' – ' + fechaCorta_(p.fecha_objetivo)]
  ]);

  const items = (seccionesIncluidas || []).filter((s) => REPORTE_SECCION_LABEL[s]);
  if (items.length >= 3) {
    doc.moveDown(0.5);
    PdfDoc.subseccion(doc, 'Contenido');
    items.forEach((s, i) => {
      PdfDoc.asegurarEspacio(doc, 14);
      doc.font('Helvetica').fontSize(8.5).fillColor(PdfDoc.DOC.INK).text((i + 1) + '. ' + REPORTE_SECCION_LABEL[s], PdfDoc.MARGIN, doc.y);
      doc.moveDown(0.15);
    });
  }
  doc.addPage();
}

// Puerto de bandaKpisPdf_/kpiTarjetaPdf_: fila de tarjetas con el numero
// grande y su etiqueta. Mismos numeros que Resumen/rendimiento -- cero
// calculo nuevo, solo presentacion. Los KPIs alarmantes (>0) se pintan en
// rojo; la desviacion vs esperado, rojo si va atras, verde si va al dia o
// adelante.
function dibujarKpis_(doc, detalle, rendimiento) {
  const at = detalle.requiere_atencion || {};
  const c = (rendimiento && rendimiento.cumplimiento_tareas) || {};
  const horas = (rendimiento && rendimiento.horas_totales_proyecto) || 0;
  const avance = detalle.avance_pct;
  const esperado = detalle.avance_esperado_pct;
  const hayDesv = avance != null && esperado != null;
  const desv = hayDesv ? Math.round((avance - esperado) * 10) / 10 : null;
  const desvValor = hayDesv ? ((desv >= 0 ? '+' : '') + desv + ' pp') : '—';
  const desvEtiqueta = hayDesv ? ('Avance vs esperado (' + esperado + '%)') : 'Avance vs esperado';

  const specs = [
    [avance == null ? '—' : avance + '%', 'Avance real', ''],
    [desvValor, desvEtiqueta, hayDesv ? (desv < 0 ? 'alerta' : 'ok') : ''],
    [c.entregadas ? c.a_tiempo + '/' + c.entregadas : '—', 'Entregas a tiempo', ''],
    [horas ? numeroCl_(horas) + ' h' : '—', 'Horas registradas', ''],
    [at.tareas_vencidas || 0, 'Tareas vencidas', at.tareas_vencidas > 0 ? 'alerta' : ''],
    [at.tareas_bloqueadas || 0, 'Bloqueadas', at.tareas_bloqueadas > 0 ? 'alerta' : ''],
    [at.hitos_atrasados || 0, 'Hitos atrasados', at.hitos_atrasados > 0 ? 'alerta' : '']
  ];

  PdfDoc.seccion(doc, 'Indicadores clave');
  const anchoCol = PdfDoc.CONTENT_WIDTH / specs.length;
  PdfDoc.asegurarEspacio(doc, 48);
  const y = doc.y;
  specs.forEach((s, i) => {
    const x = PdfDoc.MARGIN + i * anchoCol;
    const color = s[2] === 'alerta' ? '#B91C1C' : (s[2] === 'ok' ? '#15803D' : PdfDoc.DOC.INK);
    doc.rect(x, y, anchoCol, 44).lineWidth(0.5).strokeColor(PdfDoc.DOC.HAIRLINE).stroke();
    doc.font('Helvetica-Bold').fontSize(13).fillColor(color).text(String(s[0]), x + 1, y + 8, { width: anchoCol - 2, align: 'center' });
    doc.font('Helvetica').fontSize(6).fillColor(PdfDoc.DOC.MUTED).text(String(s[1]).toUpperCase(), x + 2, y + 28, { width: anchoCol - 4, align: 'center' });
  });
  doc.y = y + 48;
  doc.x = PdfDoc.MARGIN;
  doc.moveDown(0.3);
}

const SALUD_FACTOR_LABEL = {
  hito_vencido: 'Hitos vencidos', tarea_critica_atrasada: 'Tareas críticas atrasadas',
  tarea_atrasada: 'Tareas atrasadas', bloqueo_estancado: 'Bloqueos estancados',
  tarea_bloqueada: 'Tareas bloqueadas', sin_actualizar: 'Tareas sin actualizar',
  entregable_vencido: 'Entregables vencidos', entregable_observado: 'Entregables observados'
};
function dibujarSalud_(doc, detalle) {
  PdfDoc.seccion(doc, 'Salud del proyecto');
  const scoreTxt = detalle.salud_penalizacion == null ? 'Fijado manualmente'
    : (detalle.salud_penalizacion === 0 ? 'Sin factores en contra' : detalle.salud_penalizacion + ' puntos en contra');
  PdfDoc.chip(doc, (SALUD_LABEL[detalle.salud] || detalle.salud) + ' · ' + scoreTxt, SALUD_COLOR[detalle.salud] || PdfDoc.DOC.MUTED);
  doc.moveDown(0.2);
  const desglose = detalle.salud_desglose || [];
  if (!desglose.length) return;
  PdfDoc.tablaGenerica(doc,
    [{ campo: 'factor', etiqueta: 'Factor que resta salud' }, { campo: 'cantidad', etiqueta: 'Cantidad' }, { campo: 'puntos', etiqueta: 'Puntos' }],
    desglose.map((d) => ({ factor: SALUD_FACTOR_LABEL[d.factor] || d.factor, cantidad: d.cantidad, puntos: '-' + d.puntos }))
  );
  doc.moveDown(0.3);
}

// Puerto de seccionDesviacionesPdf_: mismos datos que la tabla Plan ·
// Esperado · Real en pantalla, ordenada por desviación (más atrasado
// arriba). Sin la mini-barra de color por fila del .gs -- tablaGenerica no
// pinta por celda; el signo +/- de la desviación ya comunica lo mismo.
function dibujarDesviaciones_(doc, rendimiento, tareasFiltradas, tareasPorId) {
  const plan = (rendimiento && rendimiento.plan_seguimiento) || [];
  const idsFiltrados = {};
  tareasFiltradas.forEach((a) => { idsFiltrados[a.actividad_id] = true; });
  const filasPlan = plan.filter((t) => idsFiltrados[t.actividad_id] && t.plan_fin);
  if (!filasPlan.length) return;
  filasPlan.sort((a, b) => {
    const na = (a.desviacion_pp == null) ? 1 : 0;
    const nb = (b.desviacion_pp == null) ? 1 : 0;
    if (na !== nb) return na - nb;
    if (na) return 0;
    return a.desviacion_pp - b.desviacion_pp;
  });
  PdfDoc.seccion(doc, 'Plan · Esperado · Real');
  PdfDoc.tablaGenerica(doc,
    [{ campo: 'tarea', etiqueta: 'Tarea' }, { campo: 'plan', etiqueta: 'Plan (fin)' }, { campo: 'esperado', etiqueta: 'Esperado' },
      { campo: 'real', etiqueta: 'Real' }, { campo: 'desviacion', etiqueta: 'Desviación' }],
    filasPlan.map((t) => {
      const tarea = tareasPorId[t.actividad_id];
      const tieneDesv = t.desviacion_pp != null;
      return {
        tarea: tarea ? tarea.titulo : '—', plan: fechaCorta_(t.plan_fin),
        esperado: t.avance_esperado_pct == null ? '—' : t.avance_esperado_pct + '%',
        real: t.avance_real_pct == null ? '—' : t.avance_real_pct + '%',
        desviacion: tieneDesv ? ((t.desviacion_pp >= 0 ? '+' : '') + t.desviacion_pp + 'pp') : '—'
      };
    })
  );
  doc.moveDown(0.3);
}

// Puerto del recorte de bitácora dentro de construirHtmlReporteConfigurado_:
// con rango (explícito), TODO lo que pasó en esa ventana; sin rango, las
// últimas 30 (el doble que el reporte clásico -- este SÍ es a medida).
async function bitacoraConfigurada_(db, data, contexto, tareasFiltradas, config) {
  const idsFiltrados = {};
  tareasFiltradas.forEach((a) => { idsFiltrados[a.actividad_id] = true; });
  const completa = Proyectos.listarBitacora(db, data, contexto).filter((b) => idsFiltrados[b.actividad_id]);
  if (config.rango) {
    return completa
      .filter((b) => {
        const k = (b.tipo === 'REGISTRO_DIA' && b.dia) ? b.dia : (b.timestamp ? String(b.timestamp).slice(0, 10) : '');
        return k >= config.rango.desde && k <= config.rango.hasta;
      })
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }
  return completa.slice(-30).reverse();
}

// --- Reporte estándar v2 (R-3b de la auditoría de reportes) -------------------------------
// ¿Va a llegar a tiempo este proyecto? En una línea (salud, avance real vs lo planificado,
// vencidos, riesgos altos) · Lo que requiere decisión (decisión sugerida + tareas
// críticas atrasadas, bloqueos, hitos vencidos, riesgos altos, en UN solo bloque) ·
// Panorama (avance real vs esperado por tarea, hitos en el tiempo) · Detalle (tareas
// pendientes, riesgos, actividad reciente). Mismas piezas que la pantalla (documentoV2).
const TONO_SEMAFORO = { atrasada: 'critico', bloqueada: 'critico', riesgo: 'alerta', pendiente: 'info', revision: 'info', 'al-dia': 'ok', terminada: 'neutro' };
const TONO_HITO = { COMPLETADO: 'ok', EN_CURSO: 'info', PENDIENTE: 'neutro', CANCELADO: 'neutro' };
function claveHoyChile_() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); }
}
function diasEntreClaves_(a, b) {
  const pa = String(a).slice(0, 10).split('-').map(Number), pb = String(b).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

// Piezas del reporte de proyecto v2: se calculan UNA vez y las usan tanto el reporte
// estándar (4 niveles) como el informe configurable (secciones a elección). Cada pieza
// devuelve HTML hecho con las mismas piezas de la pantalla (documentoV2.js).
const TONO_GANTT = { 'al-dia': 'ok', terminada: 'ok', riesgo: 'alerta', atrasada: 'critico', bloqueada: 'info', revision: 'hito', pendiente: 'neutro' };
const LEYENDA_GANTT_V2 = [['Al día / terminada', 'ok'], ['En riesgo', 'alerta'], ['Atrasada', 'critico'], ['Bloqueada', 'info'],
  ['En revisión', 'hito'], ['Pendiente', 'neutro'], ['Semana vencida sin cerrar', 'vencida']];

function piezasProyectoV2_(detalle, tareas, rendimiento, nombres, R, U, fecha, todasPorId) {
  const at = detalle.requiere_atencion || {};
  const p = detalle.proyecto || {};
  const hoy = claveHoyChile_();
  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
  const persona = (email, nombre) => (nombre && !/@/.test(nombre) ? String(nombre).trim() : '') || nombres[String(email || '').toLowerCase()] || email || 'Sin asignar';
  const vivas = tareas.filter((a) => a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA');
  const alta = (a) => a.prioridad === 'P1' || a.prioridad === 'P2';
  const atrasadas = vivas.filter((a) => a.semaforo === 'atrasada');
  const criticas = atrasadas.filter(alta), otrasAtrasadas = atrasadas.filter((a) => !alta(a));
  const bloqueadas = vivas.filter((a) => a.semaforo === 'bloqueada' || a.estado === 'BLOQUEADA');
  const hitos = (detalle.hitos || []).slice().sort((a, b) => String(a.fecha_objetivo || '9').localeCompare(String(b.fecha_objetivo || '9')));
  const hitosVencidos = hitos.filter((h) => h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo && String(h.fecha_objetivo).slice(0, 10) < hoy);
  const riesgos = (detalle.riesgos || []).filter((r) => r.estado !== 'CERRADO');
  const riesgosAltos = riesgos.filter((r) => r.nivel === 'ALTA' || r.nivel === 'ALTO' || r.nivel === 'CRITICO');
  const avance = detalle.avance_pct, esperado = detalle.avance_esperado_pct;
  const desv = avance != null && esperado != null ? Math.round((avance - esperado) * 10) / 10 : null;
  const c = (rendimiento && rendimiento.cumplimiento_tareas) || {};
  const n = construirNarrativa_(detalle);
  const ejemplos = (lista, fn) => lista.slice(0, 3).map(fn).join(' · ') + (lista.length > 3 ? ' · y ' + (lista.length - 3) + ' más' : '');
  const estado = detalle.salud === 'critico' ? 'critico' : (detalle.salud === 'riesgo' ? 'alerta' : 'ok');
  const tareaPorId = {};
  tareas.forEach((a) => { tareaPorId[a.actividad_id] = a; });
  const hitoPorId = {};
  (detalle.hitos || []).forEach((h) => { hitoPorId[h.hito_id] = h; });
  const plan = (rendimiento && rendimiento.plan_seguimiento) || [];
  // "Próximos vencimientos" = lo atrasado + lo que vence en los próximos 14 días
  // (antes eran TODAS las pendientes: la misma lista larga salía 3 veces).
  const en14 = sumarDiasClave_(hoy, 14);
  const proximos = vivas.filter((a) => a.semaforo === 'atrasada' || (a.fecha_compromiso && claveDia_(a.fecha_compromiso) <= en14));
  const tabla = (cols, filas, vacio) => '<div class="rp2-detalle">' + R.tabla(cols, filas, { vacio }) + '</div>';
  const pendientes = vivas.slice().sort((a, b) => ((VENCIMIENTOS_ORDEN[a.semaforo] === undefined ? 9 : VENCIMIENTOS_ORDEN[a.semaforo]) -
    (VENCIMIENTOS_ORDEN[b.semaforo] === undefined ? 9 : VENCIMIENTOS_ORDEN[b.semaforo])) ||
    String(a.fecha_compromiso || '9').localeCompare(String(b.fecha_compromiso || '9')));

  const kpisPrincipales = [
    { etiqueta: 'Avance real', valor: avance == null ? '—' : Math.round(avance), sufijo: avance == null ? '' : '%', icono: 'tendencia', progreso: avance,
      tono: desv == null ? 'primario' : (desv < -10 ? 'critico' : (desv < 0 ? 'alerta' : 'ok')),
      delta: desv == null ? undefined : desv, deltaSufijo: ' pp', nota: avance == null ? 'sin tareas para medir' : '' },
    { etiqueta: 'Tareas vencidas', valor: at.tareas_vencidas || 0, icono: 'alerta', tono: at.tareas_vencidas ? 'critico' : 'ok',
      nota: at.tareas_criticas_atrasadas ? at.tareas_criticas_atrasadas + ' de prioridad alta' : plural(vivas.length, 'tarea abierta', 'tareas abiertas') },
    { etiqueta: 'Hitos vencidos', valor: hitosVencidos.length, icono: 'diana', tono: hitosVencidos.length ? 'critico' : 'ok',
      nota: hitos.filter((h) => h.estado === 'COMPLETADO').length + ' de ' + hitos.length + ' completados' },
    { etiqueta: 'Riesgos altos', valor: riesgosAltos.length, icono: 'escudo', tono: riesgosAltos.length ? 'critico' : 'ok', nota: plural(riesgos.length, 'riesgo abierto', 'riesgos abiertos') }
  ];
  const comparaCon = esperado != null ? 'vs. lo planificado (' + esperado + ' %)' : '';

  // Fila de tarea para las tablas: título en negrita y, debajo, prioridad e hito.
  const celdaTarea = (a) => {
    const sub = [a.prioridad, a.hito_id && hitoPorId[a.hito_id] ? hitoPorId[a.hito_id].nombre : ''].filter(Boolean).join(' · ');
    return '<span class="rp2-item"><strong>' + U.esc(a.titulo) + '</strong>' + (sub ? '<small>' + U.esc(sub) + '</small>' : '') + '</span>';
  };
  const filaPendiente = (a) => ({
    tarea: celdaTarea(a),
    resp: persona(a.responsable_email, a.responsable_nombre),
    sit: U.badge(SEMAFORO_LABEL[a.semaforo] || a.semaforo || '—', TONO_SEMAFORO[a.semaforo] || 'neutro', true),
    vence: a.fecha_compromiso ? fecha(a.fecha_compromiso, true) : '—', avance: a.avance_pct == null ? '—' : Math.round(a.avance_pct) + '%'
  });
  const colsPendientes = [
    { campo: 'tarea', titulo: 'Tarea', html: true }, { campo: 'resp', titulo: 'Responsable' }, { campo: 'sit', titulo: 'Situación', html: true },
    { campo: 'vence', titulo: 'Compromiso' }, { campo: 'avance', titulo: 'Avance', alinear: 'derecha' }
  ];

  const P = {
    plural, pendientesN: pendientes.length, proximosN: proximos.length,
    // La frase y los 4 KPI (nivel 1 del estándar).
    linea: () => R.enUnaLinea({ estado, frase: n.texto, comparaCon, kpis: kpisPrincipales }),
    // Solo la frase con su estado y la decisión sugerida (sección "Resumen ejecutivo").
    narrativa: () => R.enUnaLinea({ estado, frase: n.texto }) + '<p class="rp2-decision"><strong>Decisión sugerida</strong><span>' + U.esc(n.decision) + '</span></p>',
    alertas: () => {
      const dias = (f) => (f ? diasEntreClaves_(f, hoy) : 0);
      const lista = [];
      if (criticas.length) lista.push({ severidad: 'critico', cantidad: criticas.length, titulo: 'Tareas P1/P2 atrasadas',
        detalle: ejemplos(criticas.slice().sort((a, b) => dias(b.fecha_compromiso) - dias(a.fecha_compromiso)), (a) => '«' + a.titulo + '» (' + persona(a.responsable_email, a.responsable_nombre) + ', hace ' + dias(a.fecha_compromiso) + ' d)') });
      if (bloqueadas.length) lista.push({ severidad: 'critico', cantidad: bloqueadas.length, titulo: 'Tareas bloqueadas',
        detalle: ejemplos(bloqueadas, (a) => '«' + a.titulo + '»' + (a.bloqueo_motivo ? ': ' + a.bloqueo_motivo : '')) });
      if (hitosVencidos.length) lista.push({ severidad: 'critico', cantidad: hitosVencidos.length, titulo: 'Hitos vencidos',
        detalle: ejemplos(hitosVencidos, (h) => h.nombre + ' (vencía ' + fecha(h.fecha_objetivo) + (h.avance_pct != null ? ', va en ' + Math.round(h.avance_pct) + ' %' : '') + ')') });
      if (riesgosAltos.length) lista.push({ severidad: 'critico', cantidad: riesgosAltos.length, titulo: 'Riesgos altos abiertos',
        detalle: ejemplos(riesgosAltos, (r) => r.descripcion + (r.mitigacion ? '' : ' — sin plan de mitigación')) });
      if (otrasAtrasadas.length) lista.push({ severidad: 'alerta', cantidad: otrasAtrasadas.length, titulo: 'Otras tareas atrasadas',
        detalle: ejemplos(otrasAtrasadas, (a) => '«' + a.titulo + '» (' + persona(a.responsable_email, a.responsable_nombre) + ')') });
      return lista;
    },
    decision: (alertas) => '<p class="rp2-decision"><strong>Decisión sugerida</strong><span>' + U.esc(n.decision) + '</span></p>' +
      R.requiereDecision(alertas, { conservarOrden: true, vacio: 'Sin tareas críticas atrasadas, bloqueos, hitos vencidos ni riesgos altos.' }),
    avance: () => {
      const conPlan = plan.filter((x) => tareaPorId[x.actividad_id] && x.estado_plazo !== 'COMPLETADA' && x.avance_esperado_pct != null)
        .sort((a, b) => (a.desviacion_pp == null ? 0 : a.desviacion_pp) - (b.desviacion_pp == null ? 0 : b.desviacion_pp)).slice(0, 12);
      return conPlan.length
        ? R.ranking(conPlan.map((x) => ({ etiqueta: tareaPorId[x.actividad_id].titulo, valor: x.avance_real_pct || 0,
            // La raya es lo planificado a hoy: una barra vacía igual dice cuánto faltaba.
            marca: x.avance_esperado_pct, marcaTitulo: 'Planificado a hoy: ' + Math.round(x.avance_esperado_pct) + ' %',
            texto: (x.avance_real_pct == null ? '—' : Math.round(x.avance_real_pct) + '%') + ' · plan ' + Math.round(x.avance_esperado_pct) + '%',
            tono: x.desviacion_pp == null ? 'primario' : (x.desviacion_pp < -10 ? 'critico' : (x.desviacion_pp < 0 ? 'alerta' : 'ok')) })), { max: 100, sinPosicion: true })
        : R.ranking(vivas.slice(0, 12).map((a) => ({ etiqueta: a.titulo, valor: a.avance_pct || 0, texto: Math.round(a.avance_pct || 0) + '%' })), { max: 100, sinPosicion: true, vacio: 'Sin tareas abiertas.' });
    },
    hitos: () => (hitos.length ? '<ul class="rp2-agenda">' + hitos.map((h) => {
      const venc = hitosVencidos.indexOf(h) !== -1;
      return '<li><time>' + U.esc(h.fecha_objetivo ? fecha(h.fecha_objetivo, true) : 'Sin fecha') + '</time><span class="rp2-item"><strong>' + U.esc(h.nombre) + '</strong><small>' +
        U.badge(venc ? 'Vencido' : (HITO_ESTADO_LABEL[h.estado] || h.estado), venc ? 'critico' : (TONO_HITO[h.estado] || 'neutro'), true) +
        (h.avance_pct != null && h.estado !== 'COMPLETADO' ? ' ' + U.esc(Math.round(h.avance_pct) + ' % de avance') : '') + '</small></span></li>';
    }).join('') + '</ul>' : ''),
    bien: () => {
      const b = [];
      if (c.entregadas) b.push(c.a_tiempo + ' de ' + c.entregadas + ' tareas entregadas a tiempo.');
      const ok = hitos.filter((h) => h.estado === 'COMPLETADO');
      if (ok.length) b.push(plural(ok.length, 'hito completado', 'hitos completados') + ': ' + ok.slice(0, 3).map((h) => h.nombre).join(', ') + '.');
      return R.loQueVaBien(b);
    },
    pendientes: () => tabla(colsPendientes, pendientes.map(filaPendiente), 'No hay tareas pendientes.'),
    proximos: () => tabla(colsPendientes, proximos.map(filaPendiente), 'Nada atrasado ni por vencer en los próximos 14 días.'),
    riesgos: () => (riesgos.length ? tabla([
      { campo: 'riesgo', titulo: 'Riesgo' }, { campo: 'nivel', titulo: 'Nivel', html: true }, { campo: 'resp', titulo: 'Responsable' }, { campo: 'mit', titulo: 'Mitigación' }
    ], riesgos.map((r) => ({ riesgo: r.descripcion, nivel: U.badge(r.nivel || '—', riesgosAltos.indexOf(r) !== -1 ? 'critico' : 'alerta', true),
      resp: r.responsable_email ? persona(r.responsable_email) : '—', mit: r.mitigacion || 'Sin plan de mitigación' })), '') : ''),
    // Qué pasó, EN QUÉ TAREA y QUIÉN (auditoría C5: antes "24/09 · Asignada · — · —").
    bitacora: (lista) => (lista.length ? tabla([
      // La tarea primero: las tablas de detalle le dan a la primera columna el ancho.
      { campo: 'tarea', titulo: 'Tarea', html: true }, { campo: 'tipo', titulo: 'Qué pasó' }, { campo: 'fecha', titulo: 'Fecha' },
      { campo: 'quien', titulo: 'Quién' }, { campo: 'horas', titulo: 'Horas', alinear: 'derecha' }
    ], lista.map((b) => {
      const t = tareaPorId[b.actividad_id] || (todasPorId && todasPorId[b.actividad_id]);
      return {
        fecha: fecha(b.tipo === 'REGISTRO_DIA' && b.dia ? b.dia : b.timestamp, true),
        tarea: '<span class="rp2-item"><strong>' + U.esc(t ? t.titulo : 'Tarea eliminada') + '</strong>' + (b.nota ? '<small>' + U.esc(b.nota) + '</small>' : '') + '</span>',
        tipo: BITACORA_TIPO_LABEL[b.tipo] || b.tipo,
        quien: b.autor_email || b.autor_nombre ? persona(b.autor_email, b.autor_nombre) : '—',
        horas: b.horas != null && b.horas !== '' ? numeroCl_(b.horas) : '—'
      };
    }), '') : ''),

    // --- Solo en el informe configurable ---
    ficha: () => '<dl class="ot2-datos rp2-ficha">' + [
      ...(p.codigo ? [['Código', p.codigo]] : []), ['Líder', persona(p.lider_email)], ['Estado', ESTADO_PROYECTO_LABEL[p.estado] || p.estado || '—'],
      ['Salud', SALUD_LABEL[detalle.salud] || detalle.salud || '—'], ['Avance', avance == null ? '—' : Math.round(avance) + '%'],
      ['Inicio', p.fecha_inicio ? fecha(p.fecha_inicio, true) : '—'], ['Fecha objetivo', p.fecha_objetivo ? fecha(p.fecha_objetivo, true) : '—']
    ].map((f) => '<div><dt>' + U.esc(f[0]) + '</dt><dd>' + U.esc(f[1]) + '</dd></div>').join('') + '</dl>' +
      ((detalle.salud_motivos || []).length ? '<p class="ot2-nota">' + U.esc(detalle.salud_motivos.join(' · ')) + '</p>' : ''),
    kpis: () => {
      const horas = (rendimiento && rendimiento.horas_totales_proyecto) || 0;
      const extra = [
        { etiqueta: 'Entregas a tiempo', valor: c.entregadas ? c.a_tiempo + '/' + c.entregadas : '—', icono: 'check', tono: c.entregadas && c.a_tiempo === c.entregadas ? 'ok' : 'neutro' },
        { etiqueta: 'Horas registradas', valor: horas ? Math.round(horas * 10) / 10 : '—', unidad: horas ? 'h' : '', icono: 'reloj', tono: 'neutro' },
        { etiqueta: 'Bloqueadas', valor: at.tareas_bloqueadas || 0, icono: 'pausado', tono: at.tareas_bloqueadas ? 'critico' : 'ok' }
      ];
      return R.enUnaLinea({ estado, frase: '', comparaCon, kpis: kpisPrincipales.concat(extra) }).replace(/<p class="rp2-linea__frase">[\s\S]*?<\/p>/, '');
    },
    salud: () => {
      const puntos = detalle.salud_penalizacion == null ? 'Fijada manualmente'
        : (detalle.salud_penalizacion === 0 ? 'Sin factores en contra' : plural(detalle.salud_penalizacion, 'punto en contra', 'puntos en contra'));
      const des = detalle.salud_desglose || [];
      return '<p>' + U.badge(SALUD_LABEL[detalle.salud] || detalle.salud || '—', estado, true) + ' <span class="sx2-tenue">' + U.esc(puntos) + '</span></p>' +
        (des.length ? tabla([{ campo: 'factor', titulo: 'Factor que resta salud' }, { campo: 'cantidad', titulo: 'Cantidad', alinear: 'derecha' }, { campo: 'puntos', titulo: 'Puntos', alinear: 'derecha' }],
          des.map((d) => ({ factor: SALUD_FACTOR_LABEL[d.factor] || d.factor, cantidad: d.cantidad, puntos: '−' + d.puntos })), '') : '');
    },
    carga: () => {
      const porPersona = {};
      vivas.forEach((a) => {
        const k = a.responsable_email || '(sin asignar)';
        const o = porPersona[k] = porPersona[k] || { nombre: k === '(sin asignar)' ? 'Sin asignar' : persona(a.responsable_email, a.responsable_nombre), total: 0, atr: 0 };
        o.total++;
        if (a.semaforo === 'atrasada') o.atr++;
      });
      const filas = Object.keys(porPersona).map((k) => porPersona[k]).sort((a, b) => b.total - a.total);
      return R.ranking(filas.map((o) => ({ etiqueta: o.nombre, valor: o.total, texto: plural(o.total, 'tarea', 'tareas') + (o.atr ? ' · ' + o.atr + ' atr.' : ''),
        tono: o.atr > o.total / 2 ? 'critico' : (o.atr ? 'alerta' : 'ok') })), { vacio: 'Sin tareas activas.' });
    },
    rendimiento: () => {
      const r = rendimiento || {};
      const filas = [['Entregas a tiempo', c.entregadas ? c.a_tiempo + ' de ' + c.entregadas : '—'], ['Horas registradas', r.horas_totales_proyecto ? numeroCl_(r.horas_totales_proyecto) : '—'],
        ['Ritmo promedio', r.promedio_unidades_dia != null ? r.promedio_unidades_dia + '/día' : '—'], ['Tareas sin arrancar', String(r.tareas_sin_avance == null ? '—' : r.tareas_sin_avance)]];
      return '<dl class="ot2-datos rp2-ficha">' + filas.map((f) => '<div><dt>' + U.esc(f[0]) + '</dt><dd>' + U.esc(f[1]) + '</dd></div>').join('') + '</dl>' +
        ((r.por_tarea || []).length ? tabla([{ campo: 't', titulo: 'Tarea' }, { campo: 'meta', titulo: 'Meta' }, { campo: 'ritmo', titulo: 'Ritmo', alinear: 'derecha' }],
          r.por_tarea.map((t) => ({ t: t.titulo, meta: t.meta_cantidad + (t.meta_unidad ? ' ' + t.meta_unidad : ''), ritmo: t.unidades_por_dia !== '' ? t.unidades_por_dia + '/día' : '—' })), '') : '');
    },
    // Solo lo que va DETRÁS del plan (auditoría P2): la lista completa ya está en el
    // detalle; lo que va al día o adelantado se cuenta en una línea.
    desviaciones: () => {
      const conPlan = plan.filter((x) => tareaPorId[x.actividad_id] && x.plan_fin);
      const filas = conPlan.filter((x) => x.desviacion_pp != null && x.desviacion_pp < 0).sort((a, b) => a.desviacion_pp - b.desviacion_pp);
      const resto = conPlan.length - filas.length;
      return (resto ? '<p class="ot2-nota">' + U.esc(plural(resto, 'tarea va', 'tareas van') + ' al día o adelantadas, o sin medición; no se listan.') + '</p>' : '') + tabla([{ campo: 't', titulo: 'Tarea' }, { campo: 'plan', titulo: 'Plan (fin)' }, { campo: 'esp', titulo: 'Esperado', alinear: 'derecha' },
        { campo: 'real', titulo: 'Real', alinear: 'derecha' }, { campo: 'desv', titulo: 'Desviación', html: true, alinear: 'derecha' }],
      filas.map((x) => ({ t: tareaPorId[x.actividad_id].titulo, plan: fecha(x.plan_fin, true),
        esp: x.avance_esperado_pct == null ? '—' : x.avance_esperado_pct + '%', real: x.avance_real_pct == null ? '—' : x.avance_real_pct + '%',
        desv: x.desviacion_pp == null ? '—' : U.badge((x.desviacion_pp >= 0 ? '+' : '−') + Math.abs(x.desviacion_pp) + ' pp', x.desviacion_pp < -10 ? 'critico' : (x.desviacion_pp < 0 ? 'alerta' : 'ok'), true) })),
      'Ninguna tarea va detrás de lo planificado.');
    },
    // Carta Gantt ejecutiva: hitos y tareas por semana (lunes a domingo), hasta
    // GANTT_TOPE_SEMANAS. Mismos criterios que la versión pdfkit (inicio de la barra,
    // semanas vencidas sin cerrar en rojo oscuro, semana de hoy resaltada).
    gantt: () => {
      const proyIni = claveDia_(p.fecha_inicio);
      const conFecha = tareas.filter((a) => a.fecha_compromiso);
      if (!conFecha.length && !hitos.length) return '<p class="ot2-nota">Sin tareas con fecha comprometida ni hitos que graficar.</p>';
      // "Hoy" en Chile (no en UTC) y el mismo inicio de plan que la pantalla.
      const hoyUtc = hoy;
      const planPorId = {};
      ((rendimiento && rendimiento.plan_seguimiento) || []).forEach((t) => { planPorId[t.actividad_id] = t; });
      const claves = [hoyUtc, proyIni].concat(hitos.map((h) => claveDia_(h.fecha_objetivo)))
        .concat(...conFecha.map((a) => [inicioBarraGantt_(a, proyIni, planPorId[a.actividad_id]), claveDia_(a.fecha_compromiso)])).filter(Boolean);
      const min = claves.reduce((m, x) => (x < m ? x : m)), max = claves.reduce((m, x) => (x > m ? x : m));
      const semanas = semanasGantt_(min, max, GANTT_TOPE_SEMANAS);
      if (!semanas.length) return '';
      const esHoy = (s) => s.inicio <= hoyUtc && s.fin >= hoyUtc;
      const cab = '<thead><tr><th class="rp2-gantt__et">Hito / tarea</th>' + semanas.map((s) => '<th' + (esHoy(s) ? ' class="rp2-gantt--hoy"' : '') + '>' + U.esc(s.etiqueta) + '</th>').join('') + '</tr></thead>';
      const filaHito = (h) => {
        const obj = claveDia_(h.fecha_objetivo);
        return '<tr class="rp2-gantt__hito"><th class="rp2-gantt__et">' + U.esc(h.nombre) + '</th>' + semanas.map((s) =>
          '<td' + (esHoy(s) ? ' class="rp2-gantt--hoy"' : '') + '>' + (obj && obj >= s.inicio && obj <= s.fin ? '<span class="rp2-gantt__rombo" title="' + U.esc(fecha(h.fecha_objetivo, true)) + '"></span>' : '') + '</td>').join('') + '</tr>';
      };
      const filaTarea = (a) => {
        const ini = inicioBarraGantt_(a, proyIni, planPorId[a.actividad_id]), fin = claveDia_(a.fecha_compromiso);
        const terminal = a.estado === 'TERMINADA' || a.estado === 'CANCELADA';
        const tono = TONO_GANTT[a.semaforo] || 'neutro';
        return '<tr><td class="rp2-gantt__et"><span class="rp2-item"><strong>' + U.esc(a.titulo) + '</strong><small>' + U.esc(persona(a.responsable_email, a.responsable_nombre)) + '</small></span></td>' +
          semanas.map((s) => {
            let barra = '';
            if (ini && fin && s.fin >= ini && s.inicio <= fin) barra = '<span class="rp2-gantt__b sx2-tono-' + tono + '"></span>';
            else if (!terminal && fin && s.inicio > fin && s.inicio <= hoyUtc) barra = '<span class="rp2-gantt__b rp2-gantt__b--vencida"></span>';
            return '<td' + (esHoy(s) ? ' class="rp2-gantt--hoy"' : '') + '>' + barra + '</td>';
          }).join('') + '</tr>';
      };
      const porHito = {}, sinHito = [];
      conFecha.forEach((a) => { if (a.hito_id && hitos.some((h) => h.hito_id === a.hito_id)) (porHito[a.hito_id] = porHito[a.hito_id] || []).push(a); else sinHito.push(a); });
      const porCompromiso = (a, b) => String(a.fecha_compromiso).localeCompare(String(b.fecha_compromiso));
      const cuerpo = hitos.map((h) => filaHito(h) + (porHito[h.hito_id] || []).sort(porCompromiso).map(filaTarea).join('')).join('') +
        (sinHito.length ? '<tr class="rp2-gantt__hito"><th class="rp2-gantt__et" colspan="' + (semanas.length + 1) + '">Sin hito</th></tr>' + sinHito.sort(porCompromiso).map(filaTarea).join('') : '');
      const tope = semanas[semanas.length - 1].fin < max ? '<p class="ot2-nota">Se muestran las primeras ' + GANTT_TOPE_SEMANAS + ' semanas del proyecto.</p>' : '';
      return tope + '<table class="rp2-gantt">' + cab + '<tbody>' + cuerpo + '</tbody></table>';
    },
    leyenda: () => '<ul class="rp2-gantt-leyenda">' + LEYENDA_GANTT_V2.map((l) => '<li><span class="rp2-gantt__b ' +
      (l[1] === 'vencida' ? 'rp2-gantt__b--vencida' : 'sx2-tono-' + l[1]) + '"></span>' + U.esc(l[0]) + '</li>').join('') +
      '<li><span class="rp2-gantt__rombo"></span>Hito</li></ul>'
  };
  return P;
}

function cuerpoProyectoV2_(detalle, tareas, rendimiento, bitacora, nombres, R, U, fecha) {
  const P = piezasProyectoV2_(detalle, tareas, rendimiento, nombres, R, U, fecha);
  const alertas = P.alertas();
  const hitos = P.hitos();
  const panorama = '<h3 class="rp2-sub">Avance real vs. lo planificado <span class="sx2-tenue" style="font-weight:500;font-size:.8125rem">(lo más atrasado arriba)</span></h3>' +
    P.avance() + (hitos ? '<h3 class="rp2-sub">Hitos</h3>' + hitos : '') + P.bien();
  const riesgos = P.riesgos(), bit = P.bitacora(bitacora);
  const detalleHtml = '<h3 class="rp2-sub">Tareas pendientes</h3>' + P.pendientes() +
    (riesgos ? '<h3 class="rp2-sub">Riesgos abiertos</h3>' + riesgos : '') + (bit ? '<h3 class="rp2-sub">Actividad reciente</h3>' + bit : '');
  return R.nivel('En una línea', P.linea()) +
    R.nivel('Lo que requiere decisión', P.decision(alertas), { nota: alertas.length ? 'la cifra es cuántas' : '' }) +
    R.nivel('Panorama', panorama) +
    R.nivel('Detalle', detalleHtml, { clase: 'rp2-nivel--detalle', nota: P.plural(P.pendientesN, 'tarea pendiente', 'tareas pendientes') });
}

// Informe configurable v2: las secciones que eligió la persona, en el orden de
// siempre, cada una como un nivel con su título. La portada va sola en su página
// y la Carta Gantt en una página apaisada propia.
function cuerpoConfiguradoV2_(config, detalle, tareasFiltradas, rendimiento, bitacora, nombres, R, U, fecha) {
  const P = piezasProyectoV2_(detalle, tareasFiltradas, rendimiento, nombres, R, U, fecha);
  const p = detalle.proyecto || {};
  const incluye = (s) => config.secciones.indexOf(s) !== -1;
  const nivel = (s, html, opts) => (html ? R.nivel(REPORTE_SECCION_LABEL[s], html, opts) : '');
  let h = '';
  if (incluye('portada')) {
    const contenido = config.secciones.filter((s) => s !== 'portada' && REPORTE_SECCION_LABEL[s]);
    // El nombre del proyecto ya es el título de la cabecera: la portada no lo repite.
    h += '<section class="rp2-portada"><span class="rp2-portada__eyebrow">Reporte ejecutivo de proyecto</span>' +
      P.linea() + (contenido.length >= 3 ? '<h3 class="rp2-sub">Contenido</h3><ol class="rp2-portada__indice">' +
        contenido.map((s) => '<li>' + U.esc(REPORTE_SECCION_LABEL[s]) + '</li>').join('') + '</ol>' : '') + '</section>';
  }
  if (incluye('narrativa')) h += nivel('narrativa', P.narrativa());
  if (incluye('ficha')) h += nivel('ficha', P.ficha());
  if (incluye('kpis')) h += nivel('kpis', P.kpis());
  if (incluye('salud')) h += nivel('salud', P.salud());
  if (incluye('mini_gantt')) h += nivel('mini_gantt', P.avance(), { nota: 'real vs. lo planificado · lo más atrasado arriba' });
  if (incluye('gantt')) {
    // Carta Gantt: el mismo dibujo de la pantalla (antes, una tabla de semanas propia).
    const G = DocV2.piezas().G;
    const ctxG = contextoGanttPapel_(detalle, tareasFiltradas, rendimiento, nombres);
    const bloques = G ? ganttPapelV2_(G, ctxG, GANTT_PAPEL_FILAS) : [];
    const cuerpoG = bloques.length ? bloques.join('') + G.aviso(ctxG) + (incluye('leyenda') ? G.leyenda({ papel: true, lineaBase: !!(rendimiento && rendimiento.baseline) }) : '')
      : P.gantt() + (incluye('leyenda') ? P.leyenda() : '');
    h += '<div class="rp2-apaisada">' + nivel('gantt', cuerpoG) + '</div>';
  }
  if (incluye('workload')) h += nivel('workload', P.carga(), { nota: 'tareas activas por responsable' });
  if (incluye('leyenda') && !incluye('gantt') && incluye('workload')) h += nivel('leyenda', P.leyenda());
  if (incluye('hitos')) h += nivel('hitos', P.hitos() || '<p class="ot2-nota">Sin hitos.</p>');
  if (incluye('riesgos')) h += nivel('riesgos', P.riesgos() || '<p class="ot2-nota">Sin riesgos abiertos.</p>');
  if (incluye('vencimientos')) h += nivel('vencimientos', P.proximos(), { nota: 'atrasadas y las que vencen en 14 días · ' + P.plural(P.proximosN, 'tarea', 'tareas') });
  if (incluye('rendimiento')) h += nivel('rendimiento', P.rendimiento());
  if (incluye('desviaciones')) h += nivel('desviaciones', P.desviaciones(), { nota: 'lo más atrasado arriba' });
  if (incluye('bitacora')) h += nivel('bitacora', P.bitacora(bitacora) || '<p class="ot2-nota">Sin actividad en el rango.</p>');
  return h;
}

async function descargarReporteEstandarV2_(db, data, contexto, detalle, tareas, rendimiento, nombresPorEmail) {
  const p = detalle.proyecto;
  const bitacora = Proyectos.listarBitacora(db, data, contexto).slice(-15).reverse();
  const { R, U } = DocV2.piezas();
  const nombres = Object.assign({}, DocV2.nombresPorCorreo(db));
  Object.keys(nombresPorEmail).forEach((e) => { if (nombresPorEmail[e] && !/@/.test(nombresPorEmail[e])) nombres[e.toLowerCase()] = nombresPorEmail[e]; });
  const lider = nombres[String(p.lider_email || '').toLowerCase()] || p.lider_email || '—';
  return DocV2.aPdf(db, contexto, {
    titulo: p.nombre, subtitulo: 'Reporte de proyecto · ¿va a llegar a tiempo?', modulo: 'Proyectos', codigo: p.codigo || '',
    periodo: DocV2.fecha_(p.fecha_inicio, true) + ' al ' + DocV2.fecha_(p.fecha_objetivo, true),
    filtros: [{ etiqueta: 'Líder', valor: lider }, { etiqueta: 'Estado', valor: ESTADO_PROYECTO_LABEL[p.estado] || p.estado }],
    cuerpo: cuerpoProyectoV2_(detalle, tareas, rendimiento, bitacora, nombres, R, U, DocV2.fecha_),
    nombreArchivo: 'sigso-proyecto-' + baseArchivoProyecto_(p)
  });
}

async function descargarReporteEstandar_(db, data, contexto, detalle, tareas, rendimiento, nombresPorEmail) {
  if (DocV2.disponible()) {
    try { return await descargarReporteEstandarV2_(db, data, contexto, detalle, tareas, rendimiento, nombresPorEmail); } catch (e) {
      console.error('[reporte proyecto] sin diseño v2, se usa pdfkit:', e && e.message);
    }
  }
  const p = detalle.proyecto;
  const bitacora = Proyectos.listarBitacora(db, data, contexto).slice(-15).reverse();

  const doc = PdfDoc.crearDocumento();
  PdfDoc.encabezado(doc, { tipoDoc: 'Reporte de proyecto', referencia: p.codigo || p.nombre });

  dibujarFicha_(doc, detalle);
  dibujarNarrativa_(doc, detalle);
  dibujarAvancePorTarea_(doc, tareas, rendimiento);
  dibujarHitos_(doc, detalle.hitos || []);
  dibujarRiesgos_(doc, detalle.riesgos || [], nombresPorEmail);
  dibujarVencimientos_(doc, tareas);
  dibujarRendimiento_(doc, rendimiento);
  dibujarBitacora_(doc, bitacora);

  PdfDoc.pie(doc);
  const buffer = await PdfDoc.finalizar(doc);
  return { pdf_base64: buffer.toString('base64'), filename: nombreArchivoProyecto_('proyecto', p) };
}

// La Carta Gantt va en una página apaisada dentro de un informe vertical: página con
// nombre en el CSS (Chromium la respeta con preferCSSPageSize).
const CSS_PAGINAS_PROYECTO = '@page { size: A4 portrait; } @page apaisada { size: A4 landscape; } ' +
  '.rp2-apaisada { page: apaisada; break-before: page; } .rp2-portada { break-after: page; }';

// --- Carta Gantt v2 en papel (auditoría 2026-09-29, etapa 2) ------------------
// El MISMO dibujo de la pantalla (frontend/js/proyectos-v2/gantt-dibujo.js,
// corrido en el vm de documentoV2): mismos colores, mismo inicio de barra,
// avance dentro de la barra, línea de lo real, hitos con barra resumen y "Hoy".
// El papel no repite la cabecera de un <div>, así que se reparte en bloques de
// filas, cada uno con su cabecera de meses/semanas, uno por página apaisada.
const GANTT_PAPEL_FILAS = 21;          // filas por página apaisada (densidad compacta)
const GANTT_PAPEL_FILAS_PRIMERA = 14;  // la primera comparte hoja con la cabecera del documento
const GANTT_PAPEL_PISTA_PX = 720;      // ancho aproximado de la línea de tiempo en A4 apaisado
const CSS_GANTT_PAPEL = '.rp2-gantt-pag + .rp2-gantt-pag { break-before: page; } ' +
  '.rp2-gantt-pag { break-inside: avoid; } .rp2-gantt-pag .sx2-py-gantt__fila { break-inside: avoid; } ' +
  '.rp2-gantt-pag .sx2-py-gantt { --sx-gantt-et: 250px; } .rp2-gantt-pag .sx2-py-gantt__pista { background-image: none; } ' +
  // La regla de celular de la pantalla (max-width: 720px) oculta los nombres junto
  // a las barras; al imprimir en vertical el papel "mide" menos que eso.
  '.rp2-gantt-pag .sx2-py-gantt__et { display: block; }';

function contextoGanttPapel_(detalle, tareas, rendimiento, nombres) {
  const persona = (email, nombre) => (nombre && !/@/.test(nombre) ? String(nombre).trim() : '') || nombres[String(email || '').toLowerCase()] || email || 'Sin asignar';
  return {
    tareas: tareas.map((a) => Object.assign({}, a, { responsable_nombre: persona(a.responsable_email, a.responsable_nombre) })),
    proyecto: detalle.proyecto || {}, detalle: { hitos: detalle.hitos || [] }, rendimiento: rendimiento || {}
  };
}
// Bloques de HTML (uno por página) de la Carta Gantt; [] si no hay nada que dibujar.
function ganttPapelV2_(G, ctx, primera) {
  const r = G.rango(ctx);
  return G.paginas(ctx, { desde: r.desde, semanas: r.semanas, agrupar: true, densidad: 'compacta', quieto: true,
    anchoEstimado: GANTT_PAPEL_PISTA_PX, lineasSemana: true,
    lineaBase: !!(ctx.rendimiento && ctx.rendimiento.baseline) }, GANTT_PAPEL_FILAS, primera || GANTT_PAPEL_FILAS)
    .map((b) => '<div class="rp2-gantt-pag">' + b + '</div>');
}

async function descargarReporteConfiguradoV2_(db, data, contexto, detalle, tareas, rendimiento, nombresPorEmail, config) {
  const p = detalle.proyecto;
  const tareasFiltradas = filtrarTareas_(tareas, config);
  const bitacora = config.secciones.indexOf('bitacora') !== -1 ? await bitacoraConfigurada_(db, data, contexto, tareasFiltradas, config) : [];
  const { R, U } = DocV2.piezas();
  const nombres = Object.assign({}, DocV2.nombresPorCorreo(db));
  Object.keys(nombresPorEmail).forEach((e) => { if (nombresPorEmail[e] && !/@/.test(nombresPorEmail[e])) nombres[e.toLowerCase()] = nombresPorEmail[e]; });
  const filtros = [{ etiqueta: 'Líder', valor: nombres[String(p.lider_email || '').toLowerCase()] || p.lider_email || '—' },
    { etiqueta: 'Estado', valor: ESTADO_PROYECTO_LABEL[p.estado] || p.estado }];
  if (config.personas.length) filtros.push({ etiqueta: 'Personas', valor: config.personas.map((e) => nombres[e] || e).join(', ') });
  if (config.estado) filtros.push({ etiqueta: 'Tareas', valor: config.estado === 'atrasadas' ? 'Solo atrasadas' : 'Solo abiertas' });
  if (config.rango) filtros.push({ etiqueta: 'Actividad', valor: DocV2.fecha_(config.rango.desde, true) + ' al ' + DocV2.fecha_(config.rango.hasta, true) });
  const r = await DocV2.aPdf(db, contexto, {
    titulo: p.nombre, subtitulo: 'Reporte de proyecto', modulo: 'Proyectos', codigo: p.codigo || '',
    periodo: DocV2.fecha_(p.fecha_inicio, true) + ' al ' + DocV2.fecha_(p.fecha_objetivo, true), filtros,
    cuerpo: cuerpoConfiguradoV2_(config, detalle, tareasFiltradas, rendimiento, bitacora, nombres, R, U, DocV2.fecha_),
    cssExtra: CSS_PAGINAS_PROYECTO + ' ' + CSS_GANTT_PAPEL, tamanosCss: true
  });
  return { pdf_base64: r.pdf_base64, filename: nombreArchivoProyecto_('informe-proyecto', p) };
}

async function descargarReporteConfigurado_(db, data, contexto, detalle, tareas, rendimiento, nombresPorEmail, config) {
  if (DocV2.disponible()) {
    try { return await descargarReporteConfiguradoV2_(db, data, contexto, detalle, tareas, rendimiento, nombresPorEmail, config); } catch (e) {
      console.error('[informe configurable] sin diseño v2, se usa pdfkit:', e && e.message);
    }
  }
  const tareasFiltradas = filtrarTareas_(tareas, config);
  const tareasPorId = {};
  tareas.forEach((a) => { tareasPorId[a.actividad_id] = a; });
  const incluye = (s) => config.secciones.indexOf(s) !== -1;

  const p = detalle.proyecto;
  const doc = PdfDoc.crearDocumento();
  PdfDoc.encabezado(doc, { tipoDoc: 'Reporte de proyecto', referencia: p.codigo || p.nombre });

  if (incluye('portada')) dibujarPortada_(doc, detalle, config.secciones);
  if (incluye('narrativa')) dibujarNarrativa_(doc, detalle);
  if (incluye('ficha')) dibujarFicha_(doc, detalle);
  if (incluye('kpis')) dibujarKpis_(doc, detalle, rendimiento);
  if (incluye('salud')) dibujarSalud_(doc, detalle);
  if (incluye('mini_gantt')) dibujarAvancePorTarea_(doc, tareasFiltradas, rendimiento);
  if (incluye('gantt')) dibujarGanttEjecutivo_(doc, detalle, tareasFiltradas, detalle.hitos || [], rendimiento);
  if (incluye('workload')) dibujarCargaTrabajo_(doc, tareasFiltradas, nombresPorEmail);
  if (incluye('leyenda') && (incluye('gantt') || incluye('workload'))) dibujarLeyendaGantt_(doc);
  if (incluye('hitos')) dibujarHitos_(doc, detalle.hitos || []);
  if (incluye('riesgos')) dibujarRiesgos_(doc, detalle.riesgos || [], nombresPorEmail);
  if (incluye('vencimientos')) dibujarVencimientos_(doc, tareasFiltradas);
  if (incluye('rendimiento')) dibujarRendimiento_(doc, rendimiento);
  if (incluye('desviaciones')) dibujarDesviaciones_(doc, rendimiento, tareasFiltradas, tareasPorId);
  if (incluye('bitacora')) dibujarBitacora_(doc, await bitacoraConfigurada_(db, data, contexto, tareasFiltradas, config));

  PdfDoc.pie(doc);
  const buffer = await PdfDoc.finalizar(doc);
  return { pdf_base64: buffer.toString('base64'), filename: nombreArchivoProyecto_('informe-proyecto', p) };
}

async function descargarReporte(db, data, contexto) {
  const detalle = Proyectos.getDetalle(db, data, contexto);
  if (detalle && (detalle._validationError || detalle._forbidden)) return detalle;
  const tareas = Proyectos.listarTareas(db, data, contexto);
  const rendimiento = Proyectos.obtenerRendimiento(db, data, contexto);

  const nombresPorEmail = {};
  (detalle.integrantes || []).forEach((i) => { nombresPorEmail[i.usuario_email] = i.usuario_nombre || i.usuario_email; });

  if (data && data.config) {
    const config = normalizarConfig_(data.config);
    const noSoportada = config.secciones.find((s) => SECCIONES_NO_SOPORTADAS.indexOf(s) !== -1);
    if (noSoportada) {
      return errorValidacion('config',
        'La sección "' + (noSoportada === 'leyenda' ? 'Leyenda' : (REPORTE_SECCION_LABEL[noSoportada] || noSoportada)) +
        '" (Carta Gantt/Workload día a día) todavía no está disponible en el nuevo backend. Quita esa sección de tu informe, o descarga el reporte estándar.');
    }
    return descargarReporteConfigurado_(db, data, contexto, detalle, tareas, rendimiento, nombresPorEmail, config);
  }

  return descargarReporteEstandar_(db, data, contexto, detalle, tareas, rendimiento, nombresPorEmail);
}

// "Descargar Gantt" desde la propia vista (auditoría G7): solo la Carta Gantt,
// en A4 apaisado, con las tareas que se están viendo. data.actividades (opcional)
// = ids que dejó el filtro de la pantalla; data.filtros = [{etiqueta, valor}]
// para decir en la cabecera qué se filtró. Sin Chromium no hay versión pdfkit
// de este dibujo: se avisa y el informe configurable sigue disponible.
async function descargarGantt(db, data, contexto) {
  const detalle = Proyectos.getDetalle(db, data, contexto);
  if (detalle && (detalle._validationError || detalle._forbidden)) return detalle;
  if (!DocV2.disponible()) return errorValidacion('pdf', 'La Carta Gantt en PDF no está disponible en este momento. Prueba con el informe configurable (menú Más).');
  let tareas = Proyectos.listarTareas(db, data, contexto);
  const rendimiento = Proyectos.obtenerRendimiento(db, data, contexto);
  if (Array.isArray(data.actividades)) {
    const ids = {};
    data.actividades.forEach((id) => { ids[String(id)] = true; });
    tareas = tareas.filter((a) => ids[a.actividad_id]);
  }
  const { G } = DocV2.piezas();
  const nombres = Object.assign({}, DocV2.nombresPorCorreo(db));
  (detalle.integrantes || []).forEach((i) => { if (i.usuario_nombre && !/@/.test(i.usuario_nombre)) nombres[String(i.usuario_email || '').toLowerCase()] = i.usuario_nombre; });
  const p = detalle.proyecto;
  const ctxG = contextoGanttPapel_(detalle, tareas, rendimiento, nombres);
  const bloques = ganttPapelV2_(G, ctxG, GANTT_PAPEL_FILAS_PRIMERA);
  const filtros = [{ etiqueta: 'Líder', valor: nombres[String(p.lider_email || '').toLowerCase()] || p.lider_email || '—' },
    { etiqueta: 'Estado', valor: ESTADO_PROYECTO_LABEL[p.estado] || p.estado }];
  (Array.isArray(data.filtros) ? data.filtros : []).slice(0, 6).forEach((f) => {
    if (f && f.etiqueta && f.valor) filtros.push({ etiqueta: String(f.etiqueta).slice(0, 40), valor: String(f.valor).slice(0, 120) });
  });
  const cuerpo = (bloques.length ? bloques.join('') : '<p class="ot2-nota">No hay tareas con fecha comprometida ni hitos que graficar con estos filtros.</p>') +
    G.aviso(ctxG) + G.leyenda({ papel: true, lineaBase: !!(rendimiento && rendimiento.baseline) });
  return DocV2.aPdf(db, contexto, {
    titulo: p.nombre, subtitulo: 'Carta Gantt', modulo: 'Proyectos', codigo: p.codigo || '',
    periodo: DocV2.fecha_(p.fecha_inicio, true) + ' al ' + DocV2.fecha_(p.fecha_objetivo, true), filtros,
    cuerpo, horizontal: true, cssExtra: CSS_GANTT_PAPEL,
    nombreArchivo: 'sigso-carta-gantt-' + baseArchivoProyecto_(p)
  });
}

module.exports = { descargarReporte, descargarGantt, nombreArchivoProyecto_, normalizarConfig_, filtrarTareas_, cuerpoProyectoV2_, cuerpoConfiguradoV2_ };
