# SIGSO — Auditoría de reportes (pantalla, PDF y Excel)

> 2026-09-25. Auditoría medida sobre el código y sobre **las descargas reales
> generadas** contra una copia de la base (sandbox), no sobre supuestos.
> Objetivo del dueño: definir qué reporte corresponde a cada módulo y
> mejorarlos — primero la versión en pantalla y después los descargables —
> con más tablas y gráficos que texto, y poniendo lo crítico al frente
> porque es lo que obliga a decidir.

---

## 1. Qué hay hoy

### 1.1 Reportes en pantalla — 48 reportes en 5 centros (motor `reportes-v2.js`)

| Centro | Reportes | Tipos | Pendientes |
|---|---|---|---|
| Proyectos | 5 | Estado, Ranking ×2, Detalle, Cumplimiento | 0 |
| Panel de gerencia | 8 | Cumplimiento, Ranking ×3, Detalle, Tendencia ×2, Comparación | 0 |
| Mi departamento | 6 | Ranking ×2, Cumplimiento ×2, Detalle, Tendencia | 0 |
| Administración | 6 | Cumplimiento, Ranking ×2, Detalle, Estado ×2 | 0 |
| Calidad (SGC) | 23 | Estado ×10, Cumplimiento ×7, Tendencia ×2, Detalle ×2, Ranking, Comparación | 4 (por área, por proceso, por responsable, evolución del riesgo) |

Piezas del motor: `kpis`, `tabla`, `ranking`, `tendencia`, `comparacion`,
`cuerpoCumplimientoPor`, `cuerpoEntradaSalida`, `cuerpoResbalon`, cabecera y
pie de documento, filtros de período/responsable. Descarga: **"Imprimir o
guardar PDF"** (impresión del navegador) y **CSV**.

Módulos **sin** reporte propio: Bandeja (tiene la vista "Análisis"),
Mis solicitudes, Mi trabajo, Novedades (su "Cumplimiento" vive dentro del
módulo, no en un centro de reportes), Pausas/Coordinación (tienen reporte y
PDF propios, fuera del motor común).

### 1.2 Descargas generadas en el servidor — 8 PDF + 1 Excel

| Descarga | Dónde se ofrece | Qué trae hoy | Páginas (muestra) |
|---|---|---|---|
| Reporte de proyecto (PDF) | Proyectos › proyecto | Ficha, resumen ejecutivo en texto, "Decisión sugerida", avance tarea por tarea, hitos, riesgos, vencimientos, rendimiento, actividad reciente | 3 |
| Libro del proyecto (Excel) | Proyectos › proyecto | 6 hojas con formato: Resumen, Carta Gantt, Tareas, Control de plazos, Responsables, Hitos | — |
| Orden de trabajo (PDF) | Bandeja › solicitud | Ficha, ítems, cómo cerrar | 1 |
| Actividades · Estado actual (PDF) | Gerencia | **Solo una tabla** de 104 filas | 6 |
| Actividades · Cumplimiento del período (PDF) | Gerencia | Línea de resumen + tabla | — |
| Acta de reunión (PDF) | Gerencia | Listas de viñetas: venció / bloqueado / reprogramó / vence | 2 |
| Pausas · Cumplimiento (PDF) | Coordinación | Ficha resumen, clima emocional en barras, tabla por persona, motivos | 2 |
| Pausas · Gerencia (PDF) | Gerencia | Igual al anterior con otro corte | 2 |
| Evidencia por cláusula ISO (PDF) | Calidad › Cobertura | Encabezado + tabla de registros | 1 |

Motor PDF: `pdfkit` + `pdfDocumento.js` (encabezado, secciones, fichas,
tablas, chips, una barra horizontal, "línea resumen"). **No tiene** tarjetas
KPI, gráficos (barras verticales, torta/dona, tendencia), ni bloque de
alertas. Excel: `xlsxZip.js` es solo un escritor de ZIP; el único Excel con
formato es el libro de Proyecto, armado a mano. El resto de exportaciones son
**CSV** (sin formato, sin gráficos, sin hojas).

---

## 2. Hallazgos (medidos en las muestras)

**Estructura**
1. **Ningún reporte tiene "la lectura"**: una frase que diga qué significa el
   reporte ("El cumplimiento cayó 12 pp; 3 áreas explican el 80 %"). El motor
   de pantalla no tiene esa pieza; el único que se acerca es el "Resumen
   ejecutivo" del proyecto, y es un párrafo.
2. **Lo crítico no está al frente.** En el reporte de proyecto, lo que obliga
   a decidir (4 riesgos ALTOS, 1 hito vencido, 5 tareas críticas atrasadas)
   está repartido en 3 secciones de 3 páginas; lo primero que aparece después
   del resumen es una lista de 25 tareas con barra, la mayoría "sin dato".
3. **Hay reportes sin ningún resumen**: *Actividades · Estado actual* es una
   tabla cruda de 104 filas en 6 páginas; el *Acta* son ~35 viñetas seguidas.
4. **Los KPI no se comparan con nada** (ni período anterior ni meta): "33 %"
   no dice si es bueno o malo, ni si mejora.
5. **Detalle sin orden de criticidad**: las tablas largas vienen por número o
   fecha, no por "lo más grave primero".

**Contenido**
6. **Correos en vez de personas** (líder, responsables, acta, actividades),
   pese a que el Directorio ya resuelve "Nombre — Cargo".
7. **Códigos internos a la vista**: `NO_INICIADA`, `EN_CURSO`, "(sin área)"
   repetido en todas las filas, fechas con "00:00".
8. **Estados sin color**: "Atrasada", "ALTA", "Muy mal" van en texto plano
   dentro de las tablas.
9. **Ruido de bajo valor**: la "Actividad reciente" del proyecto (15 filas
   "Asignada —") ocupa media página.

**Forma**
10. **Etiquetas cortadas**: "Cumplimient/o", "Participacion/es" en el
    resumen de Pausas (ancho de la columna de etiqueta).
11. **Marca desactualizada**: "Sistema de Gestión de Solicitudes" en todos los
    PDF (hoy es "Control y Gestión Empresarial").
12. **Pantalla y PDF no se parecen**: la pantalla es v2 (tarjetas, colores,
    gráficos) y los PDF son otro sistema visual; un mismo dato se ve distinto
    según dónde se mire.
13. **CSV en vez de Excel**: sin formato, sin hojas, sin gráficos; y en
    Windows con configuración regional distinta se abre mal.

**Catálogo**
14. **Duplicados**: "Resbalón de compromisos" y "Entrada vs salida por mes"
    existen en Gerencia y en Mi departamento (mismo reporte, distinto
    alcance). Conviene una sola definición con alcance.
15. **4 reportes de Calidad pendientes** desde hace tiempo, a la vista en el
    catálogo.
16. **El comparativo "período actual vs anterior" de Gerencia da cambios falsos** cuando
    se elige un período: el panel recorta los ítems por fecha de creación ANTES
    de comparar, así que la ventana anterior queda vacía y la "variación" es el
    valor actual completo (medido: con 1–25 sept, "sin comprometer" +4 cuando
    en realidad no hay dato anterior). El piloto no hereda el error: pide los
    ítems sin recorte de fecha y compara sobre el mismo conjunto.

Lo que **sí** está bien y hay que conservar: la cabecera documental (código,
fecha, quién lo generó, filtros aplicados), la "Decisión sugerida" del
proyecto, el orden "no sanos primero" de *Salud del portafolio*, y que los
datos salen del backend ya filtrados por permisos.

---

## 3. Sobre la idea: "resumen del resumen → resumen → detalle → lo crítico"

La idea es correcta y coincide con cómo se escriben los reportes de gestión
que funcionan (pirámide invertida / "lo más importante primero" y gestión por
excepción). Propongo **un ajuste de orden**: lo crítico va **segundo**, no al
final. Motivo: la mayoría de las personas lee la primera página y se detiene;
si lo que obliga a decidir queda después del detalle, no se ve.

**Anatomía propuesta — igual para pantalla, PDF y Excel:**

| Nivel | Qué es | Forma | Regla |
|---|---|---|---|
| 1. **En una línea** | La conclusión + el semáforo general | 1 frase + 3–4 KPI grandes, cada uno con su variación vs período anterior o vs meta | Se entiende en 5 segundos. Nunca un párrafo. |
| 2. **Lo que requiere decisión** | Lo malo, priorizado | Lista corta (máx. 5–7) con severidad por color, dueño y "desde cuándo" | Si no hay nada: "Sin alertas" en verde (también es información). |
| 3. **Panorama** | El resumen | 1–2 gráficos (distribución, tendencia, ranking) + 1 línea de "lo que va bien" | Gráfico antes que tabla; texto solo como leyenda. |
| 4. **Detalle** | La información completa | Tabla ordenada por criticidad, con estados en color y nombres de personas | En PDF va como anexo; en Excel es la hoja de datos. |

Reglas de diseño transversales: personas por nombre (Directorio), nunca
códigos internos, estados siempre con color, fechas legibles, fuente y fecha
de corte visibles, y el mismo sistema visual v2 en pantalla y en papel.

---

## 4. El reporte indicado para cada módulo

| Módulo | Pregunta que responde | Nivel 1 (KPI) | Nivel 2 (lo crítico) | Nivel 3 (panorama) | Formato |
|---|---|---|---|---|---|
| **Solicitudes** (Gerencia / Mi depto., mismo reporte con alcance) | ¿Estamos cumpliendo a los clientes internos? | Abiertas · fuera de plazo · cumplimiento de compromisos · tiempo de ciclo | Fuera de SLA, sin responsable, compromisos resbalados 2+ veces | Entrada vs salida por mes; cumplimiento por área/persona | Pantalla + PDF + Excel |
| **Proyectos · portafolio** | ¿Qué proyecto necesita atención? | Proyectos · en riesgo · críticos · avance medio | Proyectos críticos con su motivo y líder | Salud por proyecto; avance real vs esperado | Pantalla + PDF |
| **Proyectos · un proyecto** | ¿Va a llegar a tiempo este proyecto? | Salud · avance real vs esperado · hitos vencidos · riesgos altos | Riesgos altos, hitos vencidos, tareas críticas atrasadas (un solo bloque) | Plan/esperado/real; hitos en línea de tiempo | PDF + Excel (libro) |
| **Actividades / Mi trabajo del equipo** | ¿Qué está atrasado o bloqueado? | Abiertas · atrasadas · bloqueadas · % a tiempo | Atrasadas y bloqueadas agrupadas por persona | Carga por persona; cumplimiento del período | Pantalla + PDF (reemplaza la tabla de 104 filas) |
| **Acta de reunión** | ¿Qué decidimos y quién lo hace? | Conteos: venció · bloqueado · reprogramado · vence | Venció/bloqueado agrupado por responsable | Vence la próxima semana | PDF (documento, 1–2 págs.) |
| **Pausas activas** | ¿Se están haciendo las pausas? | Cumplimiento · realizadas · no realizadas · participación | Áreas bajo meta, pausas no realizadas y su motivo; ánimo Mal/Muy mal (solo Coordinación) | Participación por área; tendencia semanal; clima | Pantalla + PDF |
| **Novedades** | ¿La gente leyó lo obligatorio? | % leído · pendientes de acuse · leyes por vencer | Personas/áreas con acuses vencidos | Lectura por área y por novedad | Pantalla + Excel |
| **Calidad (SGC)** | ¿Estamos listos para la certificación? | Cobertura ISO · NC abiertas · acciones vencidas · documentos sin aprobar | Cláusulas en rojo, NC vencidas, auditorías con hallazgos abiertos | Cobertura por capítulo; evolución | Pantalla + PDF (evidencia para auditor) + Excel |
| **Administración** | ¿La configuración y los avisos funcionan? | Entregabilidad · fallas · cuentas sin uso | Fallas de envío, cuentas con clave temporal/sin uso | Envíos por evento | Pantalla (+ Excel) |
| **Orden de trabajo** | Documento operativo, no reporte | — | — | — | PDF: solo marca y nombres |

---

## 5. Formatos: qué hace cada uno (y dónde entra el CSS)

- **Pantalla**: la versión de referencia. Interactiva (filtros, ir al
  detalle). Aquí se define cada reporte; PDF y Excel son "fotos" de ella.
  CSS: sí, es el sistema v2.
- **PDF**: para compartir, decidir en reunión y dejar evidencia (ISO). Una
  primera página con los niveles 1–3 y el detalle como anexo.
  - Hoy se dibuja con `pdfkit`, **sin CSS**. Dos caminos:
    - **A. HTML + CSS → PDF con Chromium en el servidor**: el PDF se arma con
      el mismo HTML/CSS v2 de la pantalla (mismos colores, tarjetas y
      gráficos SVG). Pantalla y papel quedan idénticos y cada mejora de
      diseño vale para ambos. Costo: instalar Chromium en el VPS (~300 MB de
      disco, ~1–2 s por documento; el volumen de SIGSO es bajo y el VPS va
      holgado).
    - **B. Ampliar el kit `pdfkit`**: agregar tarjetas KPI, barras, dona,
      línea de tendencia y bloque de alertas dibujados a mano. Liviano, sin
      infraestructura nueva, pero es un segundo sistema visual que hay que
      mantener aparte.
- **Excel**: para analizar. Reemplaza al CSV.
  - Hoja 1 "Resumen" (niveles 1–2 con formato), hoja "Datos" (tabla plana con
    filtros, panel fijo, anchos y formatos), estados con color por formato
    condicional y **barras de datos dentro de las celdas** (se ven como
    gráfico sin tener que construir gráficos nativos de Excel).
  - Requiere un generador `.xlsx` compartido (hoy solo existe el hecho a mano
    para Proyectos).

---

## 6. Plan propuesto (orden del dueño: primero pantalla, después descargables)

1. **R-1 Base común**: nuevas piezas del motor de pantalla — "En una línea"
   (frase + KPI con variación), "Lo que requiere decisión" (lista de
   alertas con severidad) y detalle ordenado por criticidad; nombres en vez
   de correos; estados con color. Un reporte piloto de punta a punta.
2. **R-2 Pantalla, módulo por módulo** según la tabla del §4 (consolidando
   los duplicados de Gerencia/Mi depto. y resolviendo los 4 pendientes de
   Calidad).
3. **R-3 PDF** con el motor que se elija (A o B), aplicando la misma anatomía;
   se rehacen primero los peores (Actividades · Estado, Acta, Pausas) y el de
   Proyecto.
4. **R-4 Excel**: generador `.xlsx` compartido y reemplazo de todos los CSV.
5. **R-5 Pulido**: marca en los documentos, pie, numeración "página X de Y",
   Orden de trabajo.

Cada etapa se verifica en el sandbox con datos reales (como R1–R13) antes de
publicar.

---

## 7. Decisiones del dueño (2026-09-25)

1. **Orden**: lo crítico va segundo — En una línea · Lo que requiere
   decisión · Panorama · Detalle.
2. **Motor PDF**: HTML + CSS con Chromium en el servidor (mismo diseño v2
   que la pantalla). `pdfkit` queda mientras se migran los documentos.
3. **Excel**: generador `.xlsx` compartido; reemplaza todos los CSV (hoja
   Resumen + hoja Datos con filtros, colores de estado y barras en celda).
4. **Piloto**: Solicitudes (una sola definición para Gerencia y Mi
   departamento, con alcance).


## 8. Avance

- **R-1 (piloto en pantalla) — hecho**: piezas nuevas del motor (`nivel`,
  `enUnaLinea` con KPI y variación, `requiereDecision` con severidad y dueño,
  `loQueVaBien`, `columnas`) y el reporte **Estado del servicio**
  (`reporte-servicio-v2.js`), primero en el catálogo de Gerencia (por área) y
  de Mi departamento (por módulo). El período corre hasta hoy y se compara con
  el mismo tramo del período anterior (1–25 sept vs. 1–25 ago); cada indicador
  usa su fecha (entregas por término, entradas por creación); lo abierto se
  ordena del más grave al menos grave; sin actividad dice "Sin actividad", no
  "En control".
- **Hallazgo 16 corregido** (`9fdab48`): el comparativo de Gerencia compara
  sobre el conjunto sin recorte de fecha; test de regresión.
- **R-2 (pantalla por módulo) — hecho**, un commit por módulo:

  | Módulo | Reporte en 4 niveles | Commit | Notas |
  |---|---|---|---|
  | Proyectos | Estado del portafolio (1° del catálogo) | `5994206` | Panorama = composición (salud, plazo, avance en tramos), no un renglón por proyecto |
  | Calidad | Estado del SGC (1° del catálogo) | `7b388ee` | Alertas del tablero en su orden (CRITICA > ALTA > MEDIA); no usa el histórico semanal (ver abajo) |
  | Pausas | Gerencia › Pausas y Coordinación › Cumplimiento | `903d23f` | Una definición (`reporte-pausas-v2.js`), cambia el alcance |
  | Actividades | Gerencia › Actividades | `64b8d63` | Lo crítico agrupado por persona; backend suma `responsable_email` (fuera de `columnas`) |
  | Novedades | Novedades › Cumplimiento | `2eebe91` | Pide los lectores de cada novedad abierta para saber quién debe |
  | Administración | Estado de la plataforma (1° del catálogo) | `b6e43d2` | Fallas agrupadas por evento |

  Piezas nuevas del motor: `ranking` con `max` y `sinPosicion` (composiciones),
  `requiereDecision` con `conservarOrden`, `columnas` con `pie`/`pieTono`,
  lista `.rp2-agenda`.

  **Hallazgos de datos al hacer R-2** (no corregidos, para decidir):
  - Las fotos semanales de cobertura ISO dicen 29 %, 34 %, **0 %**, **4 %**
    (semanas del 31-ago al 21-sep) mientras hoy la cobertura es 59 %: las dos
    últimas se tomaron con la evidencia aún sin cargar tras la migración. El
    reporte "Cobertura: cómo evoluciona" las grafica tal cual.
  - Pausas de días pasados que quedaron abiertas (Recordatorio enviado / En
    curso): no cuentan ni como realizadas ni como no realizadas.
  - Los 4 reportes PENDIENTES de Calidad siguen pendientes: piden datos que el
    sistema no guarda (cláusula↔proceso, responsable de proceso, historia de
    la valoración de riesgos).

  **Siguiente: R-3** (PDF con Chromium + HTML/CSS en el VPS).
- **R-3 (PDF con Chromium) — hecho** (`d9302b5`):
  - "Descargar PDF" manda el reporte **tal como se ve** (HTML + las reglas CSS
    que lo pintan) y el servidor lo imprime con `chrome-headless-shell`
    (`logica/pdfChromium.js`, acción `generarPdfReporte` en
    `logica/reportePdf.js`). Pantalla y papel son el mismo diseño; lo que se
    mejore en pantalla mejora el PDF solo.
  - Seguridad: JavaScript apagado y **toda** la red bloqueada salvo `data:`
    (probado sin la capa de limpieza: 0 pedidos salen, ni `file://` ni http),
    más limpieza del HTML/CSS, límites bajo el 1 MB de nginx y 12 PDF/min por
    cuenta. El pie (quién, cuándo, página X de Y) lo firma el **servidor**
    con la sesión: un PDF manipulado desde el navegador igual queda a nombre
    de quien lo generó.
  - Qué entra: lo que está a la vista. Lo plegado (`<details>`) no se imprime;
    las cifras animadas van con su valor final. En papel los KPI van 2 × 2.
  - CSS: se lee el **texto original** de cada hoja (no el CSSOM: Chrome pierde
    `font: var(--x)` seguido de una propiedad larga) y se filtra a lo que toca
    al reporte y a sus ancestros (~25 KB). Los ancestros viajan como
    "cascarones" neutralizados.
  - Infra: `backend/scripts/asegurar-chromium.sh` (idempotente) lo corre cada
    despliegue: librerías del sistema + la versión de Chromium que pide
    `puppeteer-core`. Si falla no bloquea el despliegue; el PDF cae a Imprimir.
  - Costo medido: ~1 s el primero (arranca Chromium), ~0,2 s los siguientes;
    el navegador se cierra tras 90 s sin uso.
- **R-3b (PDF sin pantalla) — hecho** (`f460255`, `b657df6`):
  - `logica/documentoV2.js` ejecuta en el servidor los MISMOS archivos del
    frontend que arman los reportes (iconos.js, ui-v2.js, reportes-v2.js) en
    un contexto `vm` y toma el CSS de las hojas de la plataforma (orden de
    plataforma.html) filtrado a las clases del documento. El despliegue lleva
    esas piezas a /opt/sigso/frontend/ y un test exige que la lista coincida.
  - **Acta de reunión**: conteos · vencido y bloqueado por responsable · para
    planificar · hoja de Acuerdos para escribir en la reunión.
  - **Reportes tabulares de Actividades**: resumen en tarjetas, nombres, fechas
    y estados legibles, situación con color.
  - **Evidencia por cláusula ISO**: estado · lo que falta · por tipo · registros.
  - **Reporte de Proyecto (estándar)**: ¿va a llegar a tiempo? · decisión
    sugerida + un bloque de alertas · real vs. plan por tarea e hitos · detalle.
  - pdfkit queda como **respaldo** (sin Chromium o si el v2 falla) y para el
    **informe configurable de Proyecto** (Carta Gantt apaisada), la **Orden de
    trabajo** (R-5) y el **reporte periódico de pausas** (que en realidad es
    un correo de texto, sin PDF adjunto).
- **R-4 (Excel real) — hecho** (`bf7776a`):
  - Generador compartido `logica/libroExcel.js` (sin dependencias): hoja
    **Resumen** con los niveles 1–2 (frase con estado en color, KPI, lo que
    requiere decisión, lo que va bien) y **una hoja por tabla** con
    encabezado, filtros, primera fila fija, anchos, números/porcentajes/fechas
    como valores, estados con color y barras de datos en los porcentajes.
    Texto con forma de fórmula queda como texto.
  - Acción `generarExcelReporte`: "Generado por" desde la sesión, límites bajo
    el 1 MB de nginx, 20/min por cuenta.
  - El frontend arma la especificación desde lo que se ve (tablas, rankings,
    agendas, gráficos de columnas; lo plegado no entra) o desde los datos.
    Reemplaza los 5 CSV de v2 (catálogos, Gerencia › Actividades y Pausas,
    Bandeja, analítica de Proyectos) y suma Excel a Gerencia › Actividades,
    Coordinación y Novedades.
  - Queda aparte el **libro de Proyecto** (`libroProyecto.js`, 6 hojas con
    Carta Gantt en celdas), que ya era un Excel con formato propio.
  - Verificación: 5 libros reales del sandbox con todas sus partes XML bien
    formadas y leídos por un lector independiente (SheetJS). No hay Excel en
    el equipo de desarrollo para abrirlos en Microsoft Excel mismo.

  **Siguiente: R-5** (pulido: marca en los documentos, Orden de trabajo, y el
  informe configurable de Proyecto en el diseño v2).
