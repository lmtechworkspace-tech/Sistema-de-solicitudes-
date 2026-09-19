'use strict';

/**
 * reporteProyecto.js — puerto del camino "de un clic" (sin configurar) de
 * Proyectos.descargarReporte en backend/backoffice/Proyectos.gs
 * (construirHtmlReporteProyecto_): ficha, resumen ejecutivo, avance por
 * tarea, hitos, riesgos abiertos, próximos vencimientos, rendimiento y
 * bitácora reciente. Reusa Proyectos.getDetalle/listarTareas/
 * obtenerRendimiento/listarBitacora -- misma lógica de datos que ya usa la
 * pantalla, este módulo solo la dibuja.
 *
 * FUERA DE ALCANCE A PROPÓSITO (v11 "PDF ejecutivo configurable" del .gs:
 * secciones a elección, rango de fechas, filtro por persona, Carta Gantt
 * día a día multipágina, Workload, Desviaciones Plan/Esperado/Real): es
 * una función mucho más grande que el resto de los reportes de este motor
 * junta -- queda para su propio incremento si se necesita. Lo que SÍ cubre
 * este módulo es el botón "Descargar PDF" de siempre, sin abrir
 * "Configurar informe".
 *
 * "Avance por tarea" reemplaza la Carta Gantt semanal del .gs (grilla de
 * chips por semana) por una lista de barras de progreso por tarea --
 * decisión de diseño explícita: mismo contenido (qué tan avanzada va cada
 * tarea, comparado con el plan), forma más simple de dibujar con pdfkit.
 */

const Proyectos = require('./proyectos');
const PdfDoc = require('./pdfDocumento');
const { errorValidacion } = require('./errores');

const ESTADO_PROYECTO_LABEL = {
  PLANIFICACION: 'Planificación', ACTIVO: 'Activo', EN_PAUSA: 'En pausa',
  EN_REVISION: 'En revisión', CERRADO: 'Cerrado', CANCELADO: 'Cancelado'
};
const SALUD_LABEL = { normal: 'Normal', riesgo: 'En riesgo', critico: 'Crítico' };
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

async function descargarReporte(db, data, contexto) {
  // El modo "Configurar informe" (secciones a elección, rango, personas,
  // Gantt/Workload/Desviaciones) no esta portado -- ver la cabecera del
  // archivo. Servir el reporte de siempre cuando el usuario pidio uno
  // configurado seria fingir que se cumplio su pedido; mejor un error claro.
  if (data && data.config) {
    return errorValidacion('config', 'El informe configurable (secciones a elección, rango, Carta Gantt) todavía no está disponible en el nuevo backend. Descarga el reporte estándar por ahora.');
  }
  const detalle = Proyectos.getDetalle(db, data, contexto);
  if (detalle && (detalle._validationError || detalle._forbidden)) return detalle;
  const tareas = Proyectos.listarTareas(db, data, contexto);
  const rendimiento = Proyectos.obtenerRendimiento(db, data, contexto);
  const bitacora = Proyectos.listarBitacora(db, data, contexto).slice(-15).reverse();

  const nombresPorEmail = {};
  (detalle.integrantes || []).forEach((i) => { nombresPorEmail[i.usuario_email] = i.usuario_nombre || i.usuario_email; });

  const p = detalle.proyecto;
  const doc = PdfDoc.crearDocumento();
  PdfDoc.encabezado(doc, { tipoDoc: 'Reporte de proyecto', referencia: p.codigo || p.nombre });

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

module.exports = { descargarReporte };
