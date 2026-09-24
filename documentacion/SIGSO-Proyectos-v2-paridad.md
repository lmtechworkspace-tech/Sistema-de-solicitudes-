# Proyectos v2 — checklist de paridad con v1 (F8)

Fecha: 2026-09-24. Resultado: **v2 es la versión por defecto para todos los
roles**. La clásica (v1, `proyectos.js`) queda un ciclo como respaldo con el
botón flotante "Volver a la versión clásica" y después se retira.

Cada pantalla de v1 y dónde vive ahora en v2. "Verificado" = probado en el
sandbox (backend local contra copia de producción) con datos reales.

## Nivel módulo (árbol del sidebar)

| v1 | v2 | Estado |
|---|---|---|
| Portafolio (lista, filtros, nuevo proyecto) | Portafolio (tarjetas/lista, KPIs filtrables, gráfico de salud, carga del equipo, "Nuevo proyecto") | Verificado |
| Mi trabajo — Lista (check-in inline) | Mi trabajo — "Mis tareas": agrupadas por urgencia, "Actualizar" abre el panel único sin salir | Verificado |
| Mi trabajo — Dedicación transversal (editable) | Mi trabajo — "Mis horas": mapa de calor por proyecto (solo lectura) + gráfico; un día abre la tarea para corregir | Verificado |
| Calendario (puntos por día) | Calendario: títulos dentro del día, filtros por proyecto/tipo/"solo lo mío", agenda lateral; clic abre la tarea o su proyecto | Verificado |
| Centro de reportes | Se mantiene en el motor compartido de SIGSO (`SigsoReportes`), igual que el resto de los módulos | Delegado a propósito |

## Dentro de un proyecto

| v1 (pestaña / sub-vista) | v2 | Estado |
|---|---|---|
| Resumen (KPIs, atención requerida, descripción, acciones) | Resumen: KPIs, Gantt 12 semanas, avance real vs esperado, próximas tareas, carga, actividad, hitos, "Sobre el proyecto", franja de alertas | Verificado |
| Sala (publicar, menciones, adjuntos, convertir en tarea, "desde tu última visita") | Botón "Sala" en la cabecera (drawer) con todo lo anterior | Verificado (subir adjunto: el sandbox no tiene almacenamiento; probar en producción) |
| Tareas — Lista / Tabla / Tablero | Trabajo — Tabla / Kanban / Gantt con filtros compartidos | Verificado |
| Check-in + Registro diario (dos puertas) | "Actualizar tarea" único (`actualizarTareaProyecto`) | Verificado |
| Planificación — Cronograma / Tabla | Trabajo — Gantt / Tabla | Verificado |
| Planificación — Dedicación (workload) y Registro diario | Equipo — personas, mapa de calor, horas por día | Verificado |
| Planificación — Historial | Panel de tarea → Historial; Resumen → Actividad reciente | Verificado |
| Planificación — Analítica / Avance / Financiero / RDI | Seguimiento — Analítica / Avance y costos / RDI | Verificado |
| Congelar línea base | Menú "Más" → Congelar línea base | Verificado |
| Hitos | Seguimiento — Hitos (línea de tiempo) | Verificado |
| Equipo | Equipo | Verificado |
| Documentos (versiones, historial, vigente) | Archivos — Documentos | Verificado (subida: ver nota de almacenamiento) |
| Entregables | Archivos — Entregables | Verificado |
| Riesgos | Seguimiento — Riesgos (matriz probabilidad × impacto) | Verificado |
| Reuniones (acuerdos → tarea) y Decisiones | Seguimiento — Reuniones y decisiones | Verificado |
| Editar proyecto / Guardar como plantilla / Cerrar proyecto | Menú "Más" de la cabecera | Verificado (cerrar: formulario revisado, no ejecutado sobre datos reales) |
| Descargar PDF / Excel / Configurar informe | Botones PDF y Excel + "Más" → Configurar informe PDF | Verificado |

## Diferencias intencionales

- La Dedicación ya no se edita en una grilla: se corrige desde el panel de la
  tarea (misma acción que "Actualizar tarea"). Era la causa de la confusión
  Tareas ↔ Dedicación.
- Reportes del módulo sigue en el motor compartido; se rediseñará cuando el
  sistema visual `.sx2` se lleve al resto de SIGSO.

## Retiro de v1 (siguiente ciclo)

1. Confirmar con el equipo que nadie depende de la versión clásica.
2. Quitar el interruptor y el despacho en `plataforma.js` (`moduloProyectos_`).
3. Eliminar de `proyectos.js` todo salvo lo que usa Reportes (o migrar
   Reportes al registrar de v2) y los estilos `.sigso-py-*` sin uso.
