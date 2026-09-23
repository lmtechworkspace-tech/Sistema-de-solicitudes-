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

function fechaCorta_(valor) {
  if (!valor) return '—';
  return String(valor).slice(0, 10);
}

// Mismas frases que seccionNarrativaPdf_ (heurística determinística sobre
// datos ya calculados, no IA): salud, avance vs. esperado, qué requiere
// atención, próximo hito, y una decisión sugerida.
function construirNarrativa_(detalle) {
  const at = detalle.requiere_atencion || {};
  const avance = detalle.avance_pct;
  const esperado = detalle.avance_esperado_pct;
  const desviacion = (avance != null && esperado != null) ? Math.round((avance - esperado) * 10) / 10 : null;

  const frases = [];
  frases.push('El proyecto está en estado ' + (SALUD_LABEL[detalle.salud] || detalle.salud) +
    (detalle.salud_penalizacion ? ' (' + detalle.salud_penalizacion + ' puntos en contra)' : '') + '.');

  if (avance == null) {
    frases.push('Todavía no hay tareas activas para medir avance.');
  } else if (desviacion == null) {
    frases.push('Avance real: ' + avance + '%.');
  } else if (desviacion < -5) {
    frases.push('El avance real (' + avance + '%) está ' + Math.abs(desviacion) + ' puntos por debajo de lo planificado (' + esperado + '%).');
  } else if (desviacion > 5) {
    frases.push('El avance real (' + avance + '%) está ' + desviacion + ' puntos por encima de lo planificado (' + esperado + '%).');
  } else {
    frases.push('El avance real (' + avance + '%) está en línea con lo planificado (' + esperado + '%).');
  }

  const problemas = [];
  if (at.tareas_criticas_atrasadas > 0) problemas.push(at.tareas_criticas_atrasadas + ' tarea(s) crítica(s) (P1/P2) atrasada(s)');
  if (at.tareas_bloqueadas > 0) problemas.push(at.tareas_bloqueadas + ' tarea(s) bloqueada(s)');
  if (at.hitos_atrasados > 0) problemas.push(at.hitos_atrasados + ' hito(s) vencido(s)');
  if (at.riesgos_altos > 0) problemas.push(at.riesgos_altos + ' riesgo(s) alto(s) abierto(s)');
  frases.push(problemas.length
    ? 'Requiere atención: ' + problemas.join(', ') + '.'
    : 'No hay tareas críticas atrasadas, bloqueos, hitos vencidos ni riesgos altos abiertos en este momento.');

  const hitosVivos = (detalle.hitos || [])
    .filter((h) => h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo)
    .sort((a, b) => new Date(a.fecha_objetivo) - new Date(b.fecha_objetivo));
  if (hitosVivos[0]) frases.push('Próximo hito: ' + hitosVivos[0].nombre + ' (' + fechaCorta_(hitosVivos[0].fecha_objetivo) + ').');

  let decision;
  if (at.riesgos_altos > 0) decision = 'Revisar la mitigación de los riesgos altos abiertos.';
  else if (at.tareas_criticas_atrasadas > 0) decision = 'Priorizar destrabar las tareas críticas atrasadas.';
  else if (at.hitos_atrasados > 0) decision = 'Replanificar el/los hito(s) vencido(s) con el equipo.';
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
  mostrar.forEach((a) => {
    const plan = avancePorTarea[a.actividad_id];
    // avanceRealTarea_ devuelve null cuando la tarea no tiene un avance_pct
    // explicito ni esta NO_INICIADA/TERMINADA -- eso es "sin dato", no "0%
    // de avance". Mostrarlo como 0% seria fingir un numero que no existe.
    const pctReal = plan ? plan.avance_real_pct : null;
    const pct = pctReal == null ? 0 : pctReal;
    PdfDoc.asegurarEspacio(doc, 26);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PdfDoc.DOC.INK).text(a.titulo, PdfDoc.MARGIN, y, { width: PdfDoc.CONTENT_WIDTH - 140 });
    doc.font('Helvetica').fontSize(7.5).fillColor(PdfDoc.DOC.MUTED)
      .text((a.responsable_nombre || a.responsable_email || 'Sin asignar') + ' · ' + (SEMAFORO_LABEL[a.semaforo] || a.semaforo || '—') +
        ' · vence ' + fechaCorta_(a.fecha_compromiso), PdfDoc.MARGIN, y + 12, { width: PdfDoc.CONTENT_WIDTH - 140 });
    PdfDoc.barraHorizontal(doc, '', pct, pctReal == null ? 'sin dato' : pct + '%');
    // barraHorizontal ya avanzo doc.y una fila; nos aseguramos que quede
    // debajo de las dos lineas de texto de arriba (altura variable si el
    // titulo envuelve a 2 lineas).
    const alturaTexto = doc.heightOfString(a.titulo, { width: PdfDoc.CONTENT_WIDTH - 140 });
    if (doc.y < y + alturaTexto + 14) doc.y = y + alturaTexto + 14;
    doc.moveDown(0.35);
    doc.x = PdfDoc.MARGIN;
  });
  if (activas.length > mostrar.length) {
    doc.font('Helvetica').fontSize(8).fillColor(PdfDoc.DOC.FAINT).text('+ ' + (activas.length - mostrar.length) + ' tarea(s) más.', PdfDoc.MARGIN, doc.y);
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
    ['Entregas a tiempo', c.entregadas ? (c.a_tiempo + ' de ' + c.entregadas) : '—', 'Horas registradas', String(rendimiento.horas_totales_proyecto || '—')],
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
      horas: b.horas != null ? String(b.horas) : '—',
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
function inicioBarraGantt_(a, proyIniClave) {
  const creClave = claveDia_(a.fecha_creacion);
  const finClave = claveDia_(a.fecha_compromiso);
  if (creClave && finClave && creClave <= finClave) return creClave;
  if (proyIniClave && finClave && proyIniClave <= finClave) return proyIniClave;
  return creClave || proyIniClave || finClave;
}

function dibujarGanttEjecutivo_(doc, detalle, tareas, hitos) {
  const p = detalle.proyecto;
  const tareasConFecha = tareas.filter((a) => a.fecha_compromiso);
  if (!tareasConFecha.length && !hitos.length) return;

  const hoyClave = new Date().toISOString().slice(0, 10);
  const proyIniClave = claveDia_(p.fecha_inicio);
  const claves = [hoyClave];
  if (proyIniClave) claves.push(proyIniClave);
  hitos.forEach((h) => { const c = claveDia_(h.fecha_objetivo); if (c) claves.push(c); });
  tareasConFecha.forEach((a) => {
    claves.push(inicioBarraGantt_(a, proyIniClave));
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
    const barIni = inicioBarraGantt_(a, proyIniClave);
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
    [horas ? (Math.round(horas * 10) / 10) + 'h' : '—', 'Horas registradas', ''],
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
  hito_vencido: 'Hito(s) vencido(s)', tarea_critica_atrasada: 'Tarea(s) crítica(s) atrasada(s)',
  tarea_atrasada: 'Tarea(s) atrasada(s)', bloqueo_estancado: 'Bloqueo(s) estancado(s)',
  tarea_bloqueada: 'Tarea(s) bloqueada(s)', sin_actualizar: 'Tarea(s) sin actualizar',
  entregable_vencido: 'Entregable(s) vencido(s)', entregable_observado: 'Entregable(s) observado(s)'
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

async function descargarReporteEstandar_(db, data, contexto, detalle, tareas, rendimiento, nombresPorEmail) {
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
  return { pdf_base64: buffer.toString('base64'), filename: 'Reporte - ' + p.nombre + '.pdf' };
}

async function descargarReporteConfigurado_(db, data, contexto, detalle, tareas, rendimiento, nombresPorEmail, config) {
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
  if (incluye('gantt')) dibujarGanttEjecutivo_(doc, detalle, tareasFiltradas, detalle.hitos || []);
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
  return { pdf_base64: buffer.toString('base64'), filename: 'Reporte - ' + p.nombre + '.pdf' };
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

module.exports = { descargarReporte, normalizarConfig_, filtrarTareas_ };
