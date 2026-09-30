# Auditoría del módulo Proyectos — Carta Gantt, PDF y Excel

**Fecha:** 29-09-2026 · **Alcance:** Proyectos v2 (pantalla), informe PDF (un clic y configurable) y libro Excel.

**Cómo se midió:** backend y frontend corriendo en local contra una **copia de la base de prueba** (nunca producción).
Proyecto de referencia: *Estandarización de Dept. Comercial* (51 tareas, 30 dependencias, 8 hitos, 3 personas).
Se descargaron los archivos reales y se revisaron página por página y celda por celda; cada hallazgo de datos se
confirmó contra la base y el código. Muestras en `data/muestras-reportes/auditoria-proyectos-2026-09-29/` (fuera de git).

**Límite:** la copia no trae el proyecto ISO 9001 de producción (100+ tareas); la escala grande se evaluó por código.

---

## En una línea

La pantalla está madura y bien resuelta; **los problemas serios están en los datos que alimentan la Carta Gantt y la
salud, y en los descargables**: el Excel corre fechas un día, las tres Cartas Gantt (pantalla, PDF y Excel) dibujan
todas las tareas empezando el mismo día, y la salud "Crítico" está inflada por tareas que ya se terminaron.

**Lo que está bien:** navegación en 5 secciones, Gantt de pantalla con zoom, hitos, línea real, dependencias y pantalla
completa; PDF con diseño v2 y "En una línea" + "Lo que requiere decisión"; sin desbordes horizontales en móvil.

---

## 1 · Lo crítico (corregir primero)

| # | Hallazgo | Evidencia | Impacto | Esfuerzo |
|---|---|---|---|---|
| C1 | **Excel: fechas corridas un día y en dos formatos.** | Tarea 1 comprometida el 03/09 → Excel dice `02-09-2026`; H2 vence 19/09 → Excel `18-09-2026`. En la misma fila conviven `04/09/2026` y `02-09-2026`. La desviación de la tarea 1 sale 2 días en vez de 1. | Quien trabaje con el Excel ve fechas y atrasos equivocados. | Bajo |
| C2 | **El inicio planificado de cada tarea es su fecha de creación.** Ninguna de las 51 tiene inicio propio, así que 49 "empiezan" el 04/09 aunque 30 dependen de otra. | Tarea 18 (vence 01/10, depende de la 17): plan 04/09 → 01/10. | Las tres Cartas Gantt muestran barras que arrancan todas juntas, sin escalera. El **avance esperado** se infla (tarea 18: esperado 96 %, real 0 %, −96 pp) y distorsiona *Plan · Esperado · Real*, el SPI y el "−2,5 pp bajo lo esperado". | Medio |
| C3 | **La salud "Crítico" cuenta como "sin actualizar" tareas terminadas y tareas que aún no empiezan.** | 46 de 51 tareas "sin actualizar hace 5+ días hábiles" (incluye las 10 terminadas) → −184 puntos. | Proyectos se marcan críticos sin serlo; se pierde confianza en el semáforo del portafolio. | Bajo |
| C4 | **El Gantt del PDF calcula "hoy" en hora UTC.** | `new Date().toISOString().slice(0,10)` en la Carta Gantt del PDF. | Desde las 21:00 (Chile) el PDF marca el día siguiente como hoy y adelanta el rojo de "vencida". Es la misma trampa ya documentada en v2. | Bajo |
| C5 | **"Actividad reciente" sin tarea ni persona.** | PDF: `24/09/2026 · Asignada · — · —` (15 filas así). Excel "Historial": códigos crudos (`CREADA`, `CHECKIN_AVANCE`, `en_proceso`). | La bitácora no se puede leer: no dice qué tarea ni quién. | Bajo |

**Causas:**
- **C1:** algunas fechas quedaron guardadas como instante (`2026-09-03T00:00:00.000Z`) y el Excel (`fechaXlsx_` en `libroProyecto.js`) las formatea en hora de Chile. La pantalla y el PDF cortan el texto y no tienen el problema.
- **C2:** `planInicioTareaClave_` en `proyectos.js` usa el inicio propio o, si no hay, la fecha de creación. Las dependencias no se consideran.
- **C3:** `calcularSaludProyecto_` en `proyectos.js` filtra solo por `activa` y no por estado.
- **C5:** la bitácora del PDF (`reporteProyecto.js`) muestra el tipo y la nota, pero no la tarea ni la persona.

**Propuesta C2:** si la tarea no tiene inicio propio, usar el término de la tarea de la que depende + 1 día hábil y, solo si no depende de ninguna, la fecha de creación. Sumar:
- un aviso "N tareas sin inicio planificado";
- una acción para planificar los inicios en bloque desde la tabla.

---

## 2 · Carta Gantt en pantalla

| # | Hallazgo | Propuesta |
|---|---|---|
| G1 | Las tareas **sin fecha comprometida desaparecen del Gantt sin aviso** (2 en este proyecto). | Fila "Sin fecha (2)" al final, con acceso para fecharlas. |
| G2 | En el cronograma del Resumen, las barras que empiezan antes del rango **se cortan en el borde sin indicarlo** (parecen empezar ese día). Además el nombre se repite junto a la barra y se cruza con la línea de Hoy. | Flecha "◂ continúa" en el borde; en el adelanto del Resumen, solo la columna de nombre. |
| G3 | No se puede **reprogramar arrastrando** la barra. | Arrastrar abre el modal de reprogramar (motivo obligatorio, RN-703) con la fecha nueva precargada. |
| G4 | La **línea base congelada no se ve**, aunque existe y el backend ya entrega `baseline_inicio/fin`. | Barra fantasma bajo la del plan, con interruptor "Línea base". |
| G5 | Las **subtareas no se anidan** bajo su tarea padre (en la tabla sí). | Anidar con sangría y barra resumen del padre. |
| G6 | **Una sola dependencia** por tarea, solo fin→inicio; la "ruta crítica" es una marca manual (`es_critica`), no se calcula. | Varias dependencias y ruta crítica calculada (holgura 0). |
| G7 | No hay **"Descargar Gantt"** en la propia vista: hay que ir a Más → Configurar informe → marcar la sección. | Botón en la barra del Gantt: PDF/Excel con el zoom y los filtros que se están viendo. |
| G8 | Móvil: la barra de herramientas ocupa media pantalla; nombres cortados a ~12 caracteres; la etiqueta "HOY" sale cortada. | Herramientas plegadas en un menú; columna de nombre más ancha con salto de línea. |
| G9 | En zoom Mes o Semana, las flechas de dependencias atraviesan los nombres escritos junto a las barras. | Dibujar las flechas bajo las etiquetas o atenuarlas fuera del foco. |

---

## 3 · Informe PDF

| # | Hallazgo | Propuesta |
|---|---|---|
| P1 | **La Carta Gantt del PDF es otra distinta a la de pantalla.** Es semanal por celdas (bloques), sin % de avance en la barra, sin línea real, sin dependencias ni línea base. Sus colores no coinciden con pantalla ni Excel (el verde se usa para "terminada" y también para "al día"). | Renderizar en Chromium el **mismo** `gantt.js` de pantalla, como ya se hace con los reportes v2: una sola Carta Gantt en los tres formatos. |
| P2 | El informe configurable con todo sale en **15 páginas**. La lista de 41 tareas aparece **3 veces**: Avance por tarea, Próximos vencimientos (que son *todas* las pendientes, no las próximas) y Plan · Esperado · Real. La página 4 queda casi vacía por el salto forzado antes del Gantt apaisado. | Una sola tabla de detalle con todas las columnas. "Próximos vencimientos" = próximos 14 días. Sin salto forzado. |
| P3 | **Frase contradictoria:** "El avance real (19.6%) **está en línea** con lo planificado (22.1%)", junto a un KPI rojo de −2,5 pp y el estado Crítico. Formatos mezclados: `19.6%` / `22,1 %` / `1.5` h. Jerga: "(100 puntos en contra)". Plurales sin resolver: "Hito(s) vencido(s)" (también en el Resumen de pantalla). | Umbral explícito ("en línea" solo si la brecha es menor a 1 pp), formato es-CL en todo y plurales resueltos (ya existe la función en `reportes.js`). |
| P4 | "Avance real vs. lo planificado": **barras vacías** (todas en 0 %) sin marca del plan: no se ve nada. | Marca vertical del "esperado" dentro de cada barra. |
| P5 | **Nombres de archivo distintos para lo mismo:** `Estandarización de Dept. Comercial.xlsx`, `reporte-estandarizacion-de-dept.-comercial-2026-09-29.pdf` y `Reporte - Estandarización de Dept. Comercial.pdf`. | Uno solo: `SIGSO-Proyecto-<código>-<aaaa-mm-dd>.<pdf/xlsx>`. |
| P6 | 16 de 17 proyectos **no tienen código**: la cabecera dice "Código —". | Correlativo automático (p. ej. `PRY-2026-001`) al crear el proyecto. |
| P7 | El PDF incrusta **Segoe UI y Arial** como respaldo para glifos que Inter no trae (flechas). En el VPS Linux esas fuentes no existen y el resultado puede variar. | Reemplazar esos glifos por íconos SVG o fijar una fuente de respaldo. |

---

## 4 · Libro Excel

| # | Hallazgo | Propuesta |
|---|---|---|
| E1 | Fechas corridas un día (ver C1). | Tratar como día (`AAAA-MM-DD`), nunca como instante. |
| E2 | **Fechas y porcentajes guardados como texto** (`"04/09/2026"`, `"19.6%"`, `"96.1%"`). No se puede ordenar, filtrar por fecha ni sumar. | Fecha real de Excel y número con formato %. |
| E3 | **No usa el generador de Excel v2** (`libroExcel.js`, R-4: tipos, tonos, filtros, barras de datos). Se ve distinto al resto de SIGSO y ninguna hoja tiene filtro. | Pasar el libro al generador compartido. |
| E4 | Hoja "Carta Gantt" **sin configuración de impresión** (sin apaisado, sin ajustar a una página de ancho, sin repetir encabezados). El texto del estado contradice el color: la tarea 16 dice "Sin empezar" y está pintada roja (atrasada). | Impresión apaisada ajustada al ancho, estado y color con la misma regla, y marca de "hoy". |
| E5 | Hoja "Tareas" empieza con el **ID interno (UUID)**. La columna "Avance" está vacía al lado de "Esperado" y "Real". Encabezados sin tildes (Codigo, Desviacion, Duracion). La hoja "Resumen" se titula "CARTA GANTT". | Quitar el ID (o moverlo al final), una sola columna de avance, tildes y títulos correctos. |
| E6 | Hoja "Responsables": aparece un **correo crudo** (`lmtech.workspace@gmail…`) en vez del nombre. | Resolver con el Directorio, como en pantalla. |

---

## 5 · Visual y operativo general

| # | Hallazgo | Propuesta |
|---|---|---|
| V1 | A 1440 px la **6.ª tarjeta de KPI queda sola** en una segunda fila: "Sin novedad 7+ días" en el portafolio y "Cumplimiento de plazos" en el Resumen. | Grilla de 6 o 3×2 según el ancho. |
| V2 | En el Resumen, "Próximas tareas" y "Carga del equipo" tienen **scroll horizontal** a 1440 px (la columna Estado queda cortada). | Columnas más compactas o menos columnas en el adelanto. |
| V3 | 4 proyectos "Críticos" en el portafolio incluyen **proyectos sin tareas** ("Proyecto Cero Papel": 0 tareas, crítico solo por fecha vencida). | Estado propio "Sin planificar", separado del riesgo real. |
| V4 | Una persona concentra **39 de 41 tareas abiertas (96 %)** y no hay ninguna alerta. | Alerta de concentración o sobrecarga en "Lo que requiere decisión". |
| V5 | En Reportes, "Estado del portafolio" es a la vez nombre de grupo y de reporte. | Renombrar el grupo ("Salud y plazos"). |

---

## 6 · Hoja de ruta propuesta (por valor)

1. **Datos correctos** (1–2 días): C1, C2 (inicio por dependencia + aviso), C3, C4, E2, formatos es-CL y plurales (P3).
2. **Una sola Carta Gantt en los tres formatos**: el PDF con el renderizador de pantalla (apaisado, % de avance, línea real, hoy, dependencias y línea base) y el Excel con `libroExcel.js` más impresión. Botón "Descargar Gantt" en la propia vista, con el zoom y los filtros actuales (G7, P1, E3, E4).
3. **Informe PDF más corto y legible**: una tabla de detalle, bitácora con tarea y persona, gráficos con la marca del plan, nombres de archivo uniformes y código de proyecto automático (P2, P4, P5, P6, C5).
4. **Gantt operativo**: arrastrar para reprogramar (con motivo), línea base superpuesta, subtareas anidadas, varias dependencias, ruta crítica y mejoras de móvil (G3–G6, G8).

---

## 7 · Avance

- **Etapa 1 — Datos correctos:** desplegada (`9141889`). C1, C2, C3, C4, E2 y P3.
- **Etapa 2 — Una sola Carta Gantt:** el dibujo vive en `frontend/js/proyectos-v2/gantt-dibujo.js` y lo usan
  la pantalla y el PDF (el servidor lo corre como los demás reportes v2). Botón "Descargar" PDF/Excel en la
  propia Carta Gantt, con los filtros que se están viendo. El Excel usa los mismos tonos, el avance dentro de
  la barra, la semana de hoy, el resumen por hito, la leyenda, filtros e impresión apaisada. Cubre P1, G7, E4
  y la parte de E3 de formato; el paso completo al generador `libroExcel.js` queda para la etapa 3.
  Pendiente: las flechas de dependencias no se dibujan en el papel (en pantalla sí).
- **Arreglo del despliegue (`e1e320a`):** los fallos intermitentes de "Desplegar backend" (83ad545, e2de0a0,
  306b5db) eran Chromium lento en el runner de GitHub: el Acta caía al respaldo pdfkit, que usaba otro nombre de
  archivo. Ambos usan ahora el mismo nombre, y el test de "Descargar Gantt" ya no lanza Chromium real.
- **Etapa 3 — Informe más corto y Excel ordenado:** "Próximos vencimientos" = atrasadas + 14 días (41 → 23
  tareas en el proyecto de prueba); "Plan · Esperado · Real" solo lo que va detrás; marca de lo planificado
  sobre cada barra de avance; actividad reciente con tarea y quién; nombres de archivo
  `sigso-<qué>-<código>-<nombre>-<fecha>`; código automático `PRY-AAAA-NNN` al crear y campo Código en
  "Editar proyecto". Excel sin ID interno, una sola columna de avance, nombres en vez de correos e historial en
  palabras con quién lo registró. Informe completo: 15 → 13 páginas.
  No se pasó el libro al generador `libroExcel.js`: el libro propio ya tiene tipos, filtros, tonos e impresión, y
  la Carta Gantt coloreada no cabe en ese generador.
