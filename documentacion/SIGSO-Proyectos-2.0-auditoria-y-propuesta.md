# SIGSO Proyectos 2.0 — Auditoría y Propuesta Arquitectónica (FASE 0)

> Documento interno de descubrimiento. **No contiene cambios de código.** Su
> objetivo es diagnosticar el módulo Proyectos actual, analizar el material de
> referencia (sistema ITO "Portal de Hitos") y proponer una evolución por
> fases, distinguiendo siempre: **EXISTENTE** (ya lo tiene SIGSO) ·
> **PROPUESTA** (cambiar algo existente) · **NUEVO** (no existe) ·
> **RIESGO** · **PRIORIDAD**.
>
> Fecha: 2026-09-22 · Autor: sesión de auditoría · Estado: **borrador para
> decisión del dueño** (hay UNA decisión estratégica que bloquea el roadmap,
> ver §10 y §23).

---

## 1. Resumen ejecutivo

El encargo pide "llevar el módulo Proyectos a nivel de producto profesional,
robusto, escalable y comercializable" y trae un brief de ~59 puntos + un
benchmark de mercado. La conclusión honesta de la auditoría, antes que
cualquier otra cosa:

**SIGSO Proyectos NO es un gestor de tareas básico. Ya es un módulo maduro que
implementa la gran mayoría del brief.** No necesita reconstrucción; necesita
*evolución dirigida* + *cierre de tres huecos concretos* que el sistema de
referencia (una plataforma de **Inspección Técnica de Obras**) deja al
descubierto.

Del brief de 59 puntos, medido contra el código real:

- **Ya existe y funciona (≈40 puntos):** portafolio con búsqueda/orden/agrupar,
  "Mi trabajo" transversal, tareas con check-in diario + Kanban + subtareas con
  rollup + dependencias con impacto + multi-asignación + meta cuantificable,
  hitos, entregables, riesgos, reuniones, decisiones, sala append-only con
  adjuntos y resumen "desde tu última visita", **Cronograma con 5 vistas**
  (Plan/Gantt navegable con zoom y drag&drop, Dedicación día×tarea editable,
  Historial, Workload, Analítica), **baseline**, **Plan/Esperado/Real/
  Desviación**, **registro del día ≠ estado de tarea** (¡el punto #11, ya
  implementado!), **salud numérica ponderada y explicable**, calendario,
  plantillas, reportes PDF ejecutivo configurable + Excel + CSV, notificaciones
  agrupadas.
- **Existe pero parcial / mejorable (≈10 puntos):** UX/densidad, permisos por
  rol (grueso), edición de tarea (recién agregada), búsqueda global,
  automatizaciones, "IA/resúmenes" (no hay).
- **NO existe — los huecos reales que revela la referencia (≈3 grandes):**
  1. **Avance físico manual (curva S de control)** — puntos de control
     proyectado-vs-real a nivel de proyecto, independientes de las tareas.
  2. **Avance financiero (estados de pago)** — dimensión monetaria: hitos de
     pago proyectados vs reales, en UF/CLP, curva financiera.
  3. **RDI (Requerimiento de Información)** — flujo formal de RFI con centro de
     costo, especialidad, categoría, responsables, vencimiento, seguimientos.

**La decisión que bloquea todo el roadmap (§10):** esos tres huecos son
conceptos del **mundo construcción/ITO**. ¿SIGSO Proyectos debe convertirse en
un **vertical de construcción** (absorber RDI, avance físico/financiero, libro
de obra, centro de costo, especialidades) o quedarse **general** y sólo
adoptar las piezas domain-neutral (dimensión financiera + curva de control)?
Esta elección cambia el alcance por completo y es del dueño, no mía. Doy una
recomendación en §10.

---

## 2. Estado actual — arquitectura

**EXISTENTE.** Tras la migración Apps Script/Sheets → Node/SQLite (ver
[[sigso-ecosistema-nuevo]]), el módulo vive así:

| Capa | Ubicación | Notas |
|---|---|---|
| Backend lógica | `backend/logica/proyectos.js` | Núcleo del módulo. **Archivo muy grande.** |
| Backend reportes | `backend/logica/reporteProyecto.js` (PDF, pdfkit) · `backend/logica/libroProyecto.js` (Excel, xlsxZip propio) | Motores propios sin dependencias pesadas. |
| Ruteo | `backend/server/router.js` | **49 acciones** de Proyectos (ver §3). |
| Datos | `backend/db/schema.js` | **17 tablas** (§13). Cada celda es TEXT JSON en SQLite. |
| Frontend | `frontend/js/proyectos.js` (~6.600+ líneas, IIFE única, vanilla JS) | **Compartido** por `plataforma.html` (token) y `app.html` (login Google). Sin framework. |
| Estilos | `frontend/css/components.css` (clases `.sigso-py-*`) | Tokens de diseño compartidos con el resto de SIGSO. |
| Archivos | Cloudflare R2 vía `almacenamiento.js` | Adjuntos de sala + documentos versionados. |
| Identidad | Directorio de Personas (Fase 1+2, 2026-09-22) | Resuelve correo → "Nombre — Cargo". |

**Modelo central (EXISTENTE, decisión de diseño heredada):** *una tarea de
proyecto ES una ACTIVIDAD* (`ACTIVIDADES.proyecto_id`). El módulo "Mi trabajo"
y Proyectos comparten la misma tabla y el mismo motor de check-in (RN-702: sólo
el responsable/colaborador registra avance). Esto es una fortaleza (una sola
fuente de verdad de "lo que cada persona hace") y a la vez la principal
restricción de acoplamiento (§6).

**Despliegue (EXISTENTE):** frontend auto-publica a GitHub Pages en cada push;
backend se despliega por CI test-gated a la VPS `api.ctrly.cl`. Ya no hay
pegado manual de Apps Script.

---

## 3. Estado actual — inventario funcional completo (EXISTENTE)

Mapa de las 49 acciones + 11 pestañas + 5 sub-vistas, agrupadas por capacidad.
Todo esto **ya está en producción**.

**Portafolio y vista personal**
- Portafolio con búsqueda/orden/agrupar (client-side), resumen ejecutivo con
  KPIs y carga por persona ponderada, filtros estado/salud.
- "Mi trabajo en proyectos" — tareas y entregables pendientes del usuario de
  TODOS sus proyectos, ordenados por urgencia; con sub-vista "Mi dedicación".
- Calendario transversal (tareas/hitos/entregables de todos los proyectos).
- Centro de reportes.

**Project Room (11 pestañas):** Resumen · Sala · Tareas · Hitos · Cronograma ·
Entregables · Documentos · Reuniones · Decisiones · Riesgos · Equipo.

**Tareas**
- CRUD (`crearTarea`/`editarTarea`), estados (máquina de Actividades),
  prioridad P1–P5, fecha comprometida con confirmación (RN-710),
  reprogramación con motivo (RN-703), avance %.
- **Check-in diario de un clic** (Avancé/Sin cambios/Bloqueado/Listo) + horas +
  nota opcional (plegado). **Registro del día** editable con 9 estados
  (asignado/planificado/en_proceso/bloqueado/pausado/finalizado/entregado/
  revisión/esperando_tercero) — *el "estado del día ≠ estado de tarea" que pide
  el punto #11, ya existe*.
- **Kanban** (4 columnas, drag&drop restringido a tarea propia).
- **Subtareas con rollup** (avance del padre = promedio de hijas, un nivel).
- **Dependencias con impacto** (`depende_de`; "si se atrasa, afecta a N
  tareas", BFS transitivo con protección de ciclos).
- **Multi-asignación** (responsable dueño + colaboradores).
- **Meta cuantificable** (16 + "imágenes") → chip + ritmo unidades/día.

**Hitos · Entregables · Riesgos · Reuniones · Decisiones**
- Hitos (CRUD, completar, estados).
- Entregables (comprometer/entregar/aprobar/observar, evidencia URL).
- Riesgos (probabilidad×impacto → nivel, mitigación, estado).
- Reuniones (participantes/objetivo/minuta/acuerdos) → acuerdo se convierte en
  tarea de un clic.
- Decisiones (contexto/impacto/responsable).

**Sala (colaboración) · Documentos**
- Sala append-only (`PROYECTO_EVENTOS`), menciones, adjuntos (a R2), resumen
  "desde tu última visita".
- Documentos versionados por proyecto (subir/descargar/versión vigente).

**Cronograma (5 sub-vistas)** — la joya del módulo:
- **Plan:** Carta Gantt navegable con 4 niveles de zoom (trimestre/mes/quincena/
  semana), columna de etiquetas fija, regla de meses, línea de HOY, bandas de
  fin de semana/mes, **drag&drop del borde de la barra → reprogramar con
  motivo**.
- **Dedicación:** carta día×tarea, celda editable (registro del día), heatmap
  por horas, totales por día/tarea, agrupar por persona, filtros, feriados,
  reporte imprimible con cabecera/pie por hoja.
- **Historial:** feed reverso de toda la bitácora, con frase humana por tipo.
- **Workload:** grilla persona×día heatmapeada, anillo de sobrecarga (>9h),
  KPIs; + versión **cruzada multi-proyecto** desde el portafolio.
- **Analítica:** lead time, cycle time, tiempo de bloqueo/revisión, SPI.

**Control y planificación**
- **Baseline** (congelar línea base como evento).
- **Plan/Esperado/Real/Desviación** por tarea (avance esperado lineal, chips en
  pantalla).
- **Salud numérica ponderada** (score 0–100 + desglose explicable, pesos
  documentados) con override manual.

**Reportes / exportación**
- **PDF ejecutivo configurable** (portada, KPIs, salud, desviaciones, Gantt de
  barras, workload, bitácora; A4/A3/A2 landscape automático).
- **Excel** ("libro" del proyecto: Resumen/Gantt/Tareas/Hitos/Historial/
  Dependencias).
- **CSV** de la analítica.

**Ecosistema**
- Solicitud → Proyecto (`solicitud_origen_id`).
- Plantillas de proyecto (clona estructura de hitos).
- Notificaciones agrupadas (una por proyecto/día, colgadas del pase diario).

> **Lectura clave:** el brief pide construir casi todo esto. La respuesta
> honesta a 40 de sus puntos es "ya está — verifícalo, no lo reconstruyas".

---

## 4. Problemas detectados (lo que SÍ está mal o incompleto)

No asumimos que lo actual está bien sólo porque funciona. Hallazgos reales:

1. **RIESGO — Monolito frontend.** `proyectos.js` es una IIFE de ~6.600
   líneas / ~400 KB. Todo (portafolio, gantt, dedicación, reportes, modales)
   vive en un solo archivo/scope. Cada cambio obliga a leer/verificar mucho, y
   el riesgo de regresión sube con el tamaño. **Es el mayor riesgo técnico del
   módulo**, no una funcionalidad faltante.
2. **PROPUESTA — Densidad y jerarquía visual.** Las capturas del propio dueño
   muestran pestañas y KPIs que compiten por espacio; la cabecera del proyecto
   y la barra de 11 pestañas son mucha superficie. Hay trabajo de *altitud
   informativa* (qué se muestra primero) más que de features.
3. **PROPUESTA — Permisos gruesos.** El control es por rol global
   (ADM/GERENCIA/DEV/ANA/JEFATURA) + `puede_gestionar` por proyecto (líder o
   ADM). No hay roles *por proyecto* finos (observador, colaborador, gestor de
   riesgos, etc.). Para vender a terceros esto probablemente se queda corto.
4. **PROPUESTA — La "salud" y el "Plan/Esperado/Real" se derivan sólo de
   tareas.** No hay una curva de avance *físico del proyecto* declarada a mano
   (la que un jefe de obra reporta semanalmente, independiente del detalle de
   tareas). Es exactamente lo que la referencia llama "Avance Simple".
5. **HALLAZGO — Sin dimensión monetaria.** No existe ningún campo de valor,
   costo, monto ni moneda en todo Proyectos (la Fase G4b "peso de valor" se
   difirió justamente por esto). Cualquier reporte a gerencia/cliente hoy es
   *sólo físico*, nunca financiero.
6. **PROPUESTA — Búsqueda sólo dentro del portafolio.** No hay búsqueda global
   (tareas/hitos/personas/entregables) transversal.
7. **PROPUESTA — Reportes: alto acoplamiento a su motor.** El PDF cargó una
   larga historia de bugs de renderer (rellenos que no pintan). Funciona, pero
   es frágil ante cambios.
8. **RIESGO — Acoplamiento tarea≡actividad.** Potente pero rígido: cualquier
   cosa que necesite una tarea "sólo de proyecto" (sin semántica de
   Actividades/Mi trabajo) hoy no tiene lugar.

---

## 5. Oportunidades

1. **Dimensión financiera como diferenciador** (NUEVO). Conectar avance físico
   ↔ avance financiero ↔ estados de pago es lo que un gerente de verdad pide y
   lo que Excel hace mal. SIGSO ya tiene la mitad (avance físico); falta la
   plata.
2. **Curva S de control manual** (NUEVO) — barata de construir, alto valor
   percibido, encaja con lo que ya existe (rendimiento/desviación).
3. **RDI integrado al ecosistema** (NUEVO/PROPUESTA) — SIGSO ya tiene
   Solicitudes (intake/bandeja) y Directorio de Personas; un RDI es una
   Solicitud especializada por proyecto. Reusar en vez de duplicar.
4. **Ventaja de ecosistema** (PROPUESTA) — ninguna herramienta del mercado
   conecta Solicitud → Proyecto → Hito → Tarea → Evidencia → Documento →
   Calidad (ISO 9001) → Reporte en un solo sistema. SIGSO **ya** tiene todos
   esos módulos. El diferenciador no es "otra Gantt", es la trazabilidad
   cruzada.
5. **Modularizar el frontend** (PROPUESTA) — dividir `proyectos.js` bajaría el
   riesgo de todo lo que venga después.

---

## 6. Riesgos técnicos

| Riesgo | Severidad | Mitigación propuesta |
|---|---|---|
| Monolito frontend de 400KB | Alta | Refactor incremental por vista antes de agregar features grandes. |
| Acoplamiento tarea≡actividad | Media | No romperlo; las entidades nuevas (RDI, estados de pago, curva) son *hermanas* del proyecto, no tocan ACTIVIDADES. |
| Motor PDF frágil | Media | pdfkit (Node) es más robusto que el viejo HTML→PDF de Apps Script; no re-introducir dependencias de renderer. |
| Migración de datos de 10+ proyectos reales en producción | Alta | Todo cambio de esquema es **aditivo** (patrón ya establecido); nunca destructivo. |
| Multi-tenant a medias | Media | `organizacion_id` ya existe en el contexto; cualquier entidad nueva nace con él. |
| Alcance runaway (el brief pide "todo") | Alta | Este documento + decisión §10 acotan; MVP estricto. |

---

## 7. Análisis del material de referencia (sistema ITO "Portal de Hitos")

Las capturas y PDFs son de un **sistema distinto**, de dominio construcción:
"Portal de Hitos • Sistema de Gestión Técnica" (usuario visible:
`lestay@rld.cl`, RLD — una de las empresas del entorno del dueño). Es un
**software de Inspección Técnica de Obras (ITO)**. No es SIGSO.

Lo que aporta como *fuente de patrones* (nunca a copiar tal cual):

**Carta Gantt jerárquica** (capturas 11–13) — Proyecto → Tarea → Subtarea, con
**% del padre calculado automáticamente promediando subtareas**, "dependencia =
pertenece a" (jerarquía, no FS/SS), grilla día a día.
→ **EXISTENTE en SIGSO** (rollup de subtareas + Gantt navegable). SIGSO ya está
por delante aquí (zoom, drag&drop, dedicación, baseline).

**Avance Simple** (capturas 14–15) — KPIs (Último control, % Proyectado, %
Real, % Desvío), **curva S Proyectado vs Real**, y una tabla de **puntos de
control** manuales: en cada fecha, el usuario ingresa "% proyectado" y "% real"
y el sistema calcula el desvío (Al día / Retraso).
→ **NUEVO en SIGSO.** SIGSO deriva plan/esperado/real *de las tareas*; no tiene
una curva de avance **físico declarada a mano a nivel proyecto**. Este es el
hueco #1 y es domain-neutral (sirve a cualquier proyecto, no sólo obra).

**Avance Financiero** (captura 16) — "Nuevo Proyecto Financiero": Nombre,
Fecha, **Monto**, **Tipo de Moneda (UF/CLP)**, y una tabla de **Estados de Pago
y Pagos Proyectados** (estado de pago + fecha proyectada + monto proyectado).
→ **NUEVO en SIGSO.** Hueco #2. Es la dimensión monetaria que SIGSO nunca tuvo.

**RDI — Requerimiento de Información** (captura 17 + RDI_2.pdf) — RFI formal:
N° correlativo, estado (Abierto/…), Título, **Centro de Costo**, **Especialidad**
(Arquitectura/…), **Categoría** (Aclaración de Especificaciones/…), Prioridad,
Fecha creación/vencimiento, Solicitante, **Responsables (multi)**, Descripción,
**Historial de Seguimientos**, y un **PDF por RDI**.
→ **NUEVO en SIGSO.** Hueco #3. Pero *conceptualmente cercano* al módulo
Solicitudes que SIGSO ya tiene.

**Libro de obra** (menú) — bitácora legal de obra.
→ SIGSO tiene "bitácora" por tarea y un "libro" Excel de exportación, pero **no**
un libro de obra formal (registro diario cronológico a nivel proyecto con valor
documental). Hueco menor.

**Centro de Costo** — dimensión transversal (CC-102 - Condominio Los Robles).
→ **PARCIAL:** existe en Solicitudes, no en Proyectos.

---

## 8. Qué rescatar vs. qué NO copiar

**A. ADOPTAR (aporta valor real):**
- Curva S de control físico manual (Avance Simple).
- Estados de pago / avance financiero (con moneda UF/CLP).
- RDI como flujo formal (reusando Solicitudes + Directorio).
- Centro de costo como dimensión del proyecto.

**B. MEJORAR (SIGSO puede hacerlo mejor):**
- La Gantt de la referencia es plana (sin baseline, sin drag&drop, sin
  dedicación real por horas). SIGSO ya la supera; sólo hay que *conectar* la
  curva física y financiera encima.
- Su RDI no se ve integrado a tareas/documentos; SIGSO puede hacer que un RDI
  genere una tarea y adjunte evidencia.

**C. EVITAR (complejidad sin valor para SIGSO hoy):**
- Tipos de dependencia FS/SS/FF/SF — SIGSO no tiene motor de reprogramación
  automática que los interprete (ya evaluado y descartado). El "impacto de
  retraso" que sí aporta control ya existe.
- CPM/ruta crítica dibujada — sin motor de scheduling, sería decorativo.
- IA generativa "porque sí" — sólo si reduce trabajo real y medible (§20).

**D. DIFERENCIAR (donde SIGSO gana):**
- Trazabilidad cruzada Solicitud↔Proyecto↔Calidad↔Evidencia (ningún referente
  la tiene).
- Un solo login/identidad/permisos/notificaciones para toda la empresa.

---

## 9. Gap analysis (matriz condensada)

| Área | Referente ITO | SIGSO actual | Veredicto |
|---|---|---|---|
| Portafolio + vistas | Lista básica | Portafolio + KPIs + carga + calendario | **EXISTENTE (SIGSO gana)** |
| Gantt / cronograma | Plano, día×día | 5 vistas, zoom, drag&drop, baseline, dedicación | **EXISTENTE (SIGSO gana)** |
| Tareas/subtareas/dependencias | Sí, rollup | Sí + impacto + multi-asignación + registro del día | **EXISTENTE (SIGSO gana)** |
| Hitos | Con semántica ITO | Genéricos | **PROPUESTA (enriquecer)** |
| Riesgos / entregables / reuniones / decisiones | No visibles | Sí | **EXISTENTE (SIGSO gana)** |
| Avance físico (curva S de control) | **Avance Simple** | Derivado de tareas, no manual | **NUEVO — hueco #1** |
| Avance financiero / estados de pago | **Sí (UF)** | No existe | **NUEVO — hueco #2** |
| RDI / RFI | **Sí** | No (pero hay Solicitudes) | **NUEVO — hueco #3** |
| Centro de costo | Transversal | Sólo en Solicitudes | **PROPUESTA (extender)** |
| Libro de obra | Sí | Bitácora + libro Excel | **PROPUESTA (formalizar)** |
| Especialidades | Sí | No | **NUEVO (menor)** |
| Reportes PDF/Excel | PDF por RDI | PDF configurable + Excel + CSV | **EXISTENTE (SIGSO gana)** |
| Permisos por proyecto | ? | Grueso (rol + líder) | **PROPUESTA** |
| Trazabilidad cruzada de ecosistema | No | Solicitud→Proyecto→Calidad | **DIFERENCIADOR SIGSO** |

---

## 10. LA decisión estratégica que bloquea el roadmap

Los tres huecos (avance físico manual, avance financiero, RDI) + centro de
costo + especialidades + libro de obra son, todos, **conceptos del mundo
construcción/ITO**. Hay dos caminos y **la elección es del dueño**:

### Camino A — "Vertical construcción/ITO"
SIGSO Proyectos absorbe el modelo ITO completo: RDI, avance físico, estados de
pago, centro de costo, especialidades, libro de obra. Se vuelve competidor
directo del "Portal de Hitos" y sistemas ITO, pensado para vender a
constructoras/ITO.
- **Pro:** mercado concreto y con dolor real (hoy usan Excel); RLD (del entorno)
  ya vive ese mundo.
- **Contra:** SIGSO deja de ser genérico; carga conceptos (especialidades,
  libro de obra legal) que a una PYME de servicios no le sirven; más superficie
  que mantener; compites con verticales ya establecidos.

### Camino B — "PM general + capacidades financieras/control" (RECOMENDADO)
SIGSO adopta **sólo las piezas domain-neutral**, generalizadas para que sirvan a
CUALQUIER proyecto (no sólo obra):
- **Curva de control** (avance físico manual) → útil en cualquier proyecto con
  hitos de avance.
- **Dimensión financiera** (monto, moneda, estados/hitos de pago proyectado vs
  real) → útil en cualquier proyecto con presupuesto/facturación.
- **RDI generalizado como "Solicitud de proyecto"** → reusa el módulo
  Solicitudes existente, acotado al proyecto; sin jerga ITO obligatoria.
- **Centro de costo** como campo opcional del proyecto (ya existe en
  Solicitudes; extenderlo).
- Lo específico de obra (especialidades fijas, libro de obra legal) queda como
  *configuración/plantilla opcional*, no como núcleo.
- **Pro:** SIGSO sigue vendible a su base actual (PYMEs de servicios, software,
  ops) Y suma lo que el mundo obra necesita, sin encasillarse; menor superficie;
  cada pieza sirve a más clientes.
- **Contra:** un cliente 100% constructora podría pedir más semántica ITO
  específica; se resuelve luego con una "plantilla construcción".

**Recomendación:** **Camino B.** Da el 90% del valor comercial de A con la mitad
del riesgo, no rompe la base instalada, y encaja con la arquitectura
multi-tenant ("Organización invisible") que ya se está preparando para vender.
El Camino A se puede alcanzar *después* como una capa/plantilla sobre B, si un
cliente constructora lo justifica.

> **Todo el §12–§18 asume Camino B.** Si el dueño elige A, el modelo de datos y
> el roadmap cambian (más entidades ITO-específicas) y hay que revisar este
> documento.

---

## 11. Propuesta de producto (visión, Camino B)

**SIGSO Proyectos = centro de gestión, control y trazabilidad de proyectos,
con tres lentes sobre el mismo proyecto:**

1. **Ejecución** (lo que ya existe): tareas, dedicación, Gantt, colaboración.
2. **Control** (a reforzar): avance físico planificado vs real (curva),
   desviación, salud, baseline — *ahora también declarable a mano, no sólo
   derivado de tareas*.
3. **Finanzas** (nuevo): presupuesto, estados/hitos de pago, avance financiero
   proyectado vs real, y el cruce físico↔financiero (la pregunta gerencial:
   "¿el % de plata pagada va acorde al % de obra avanzada?").

Y un flujo formal transversal: **RDI / Solicitudes de proyecto** (preguntas
formales con responsable y vencimiento, integradas al proyecto).

La promesa por rol (las "pruebas" del brief, §51–54):
- **Operativo:** "sé qué tengo hoy y registro mi avance en un clic" — *ya se
  cumple*.
- **Líder:** "veo avance físico, financiero, atrasos y quién está cargado" —
  *se cumple a medias; falta finanzas y curva de control*.
- **Gerencia:** "veo el portafolio, dónde intervenir, y si la plata va con la
  obra" — *falta la dimensión financiera*.

---

## 12. Nueva arquitectura funcional (navegación)

**PROPUESTA.** No se agregan pestañas sueltas (ya hay 11). Se reorganiza en
grupos y se suman dos capacidades:

Project Room, reagrupado (mismas pestañas, mejor jerarquía):
- **Resumen** (ejecutivo: salud + avance físico + avance financiero + próximos
  hitos + lo que requiere atención — *un solo tablero de 30 segundos*).
- **Trabajo:** Tareas · Cronograma · Hitos.
- **Control:** **Avance** (NUEVO — curva física + financiera) · Riesgos ·
  Entregables.
- **Colaboración:** Sala · Reuniones · Decisiones · Documentos · **RDI** (NUEVO).
- **Equipo.**

Portafolio: agregar al resumen ejecutivo una columna financiera (presupuesto vs
comprometido/pagado) para los proyectos que la tengan; los que no, la ocultan
(cero ruido para proyectos sin plata).

---

## 13. Modelo de datos actual + propuesto

**EXISTENTE (17 tablas):** `PROYECTOS`, `PROYECTO_INTEGRANTES`,
`PROYECTO_HITOS`, `PROYECTO_EVENTOS`, `PROYECTO_ENTREGABLES`,
`PROYECTO_RIESGOS`, `PROYECTO_PLANTILLAS`, `PROYECTO_PLANTILLA_HITOS`,
`PROYECTO_DOCUMENTOS`, `PROYECTO_DOC_VERSIONES`, `PROYECTO_REUNIONES`,
`PROYECTO_REUNION_ACUERDOS`, `PROYECTO_DECISIONES`, + `ACTIVIDADES` (tareas) y
`ACTIVIDADES_BITACORA` (registro del día/check-ins).

**NUEVO propuesto (todo aditivo, nada destructivo):**

1. `PROYECTOS +=` `centro_costo` · `presupuesto_monto` · `presupuesto_moneda`
   (UF/CLP) — campos opcionales.
2. `PROYECTO_CONTROL_AVANCE` — la curva S de control física:
   `control_id, proyecto_id, fecha, pct_proyectado, pct_real, nota,
   registrado_por, fecha_creacion`. (Hueco #1.)
3. `PROYECTO_ESTADOS_PAGO` — estados/hitos de pago:
   `estado_pago_id, proyecto_id, nombre, fecha_proyectada, monto_proyectado,
   fecha_real, monto_real, estado (proyectado/facturado/pagado), orden,
   fecha_creacion`. (Hueco #2.)
4. `PROYECTO_RDI` + `PROYECTO_RDI_SEGUIMIENTOS` — RFI formal:
   `rdi_id, proyecto_id, numero, titulo, centro_costo, especialidad, categoria,
   prioridad, estado, fecha_vencimiento, solicitante_email, responsables_emails
   (JSON), descripcion, fecha_creacion` + seguimientos
   `(seguimiento_id, rdi_id, texto, autor_email, timestamp)`. (Hueco #3.)
   **Alternativa a evaluar:** modelar RDI como un *tipo* dentro de Solicitudes en
   vez de tabla propia (reuso máximo, ver §16).

Todas con `organizacion_id` implícito (multi-tenant desde el día uno).

---

## 14. UX (principios y pruebas)

**PROPUESTA.** Regla del brief: "máxima información útil sin saturación". Aplica
especialmente a las *nuevas* pantallas de Avance/Finanzas — no llenar de KPIs.

- **Resumen = tablero de 30 segundos:** salud + % físico + % financiero +
  próximo hito + "lo que requiere atención" con enlaces (indicador → contexto →
  acción, como pide §7 del brief). Cada número lleva a la lista que lo explica.
- **Curva de control:** una sola gráfica proyectado-vs-real (reusar el motor de
  gráficos que ya usa Gerencia), con la tabla de puntos debajo. Nada más.
- **Finanzas:** una curva (proyectado-vs-pagado) + tabla de estados de pago. El
  cruce físico↔financiero como UNA línea de texto ("obra 45% · plata 52% —
  vas cobrando más rápido que avanzando").
- **Color con significado** (ya establecido en tokens SIGSO; no inventar
  paleta) + iconografía + texto (nunca sólo color — accesibilidad, §44).
- Reusar componentes existentes (`Componentes.kpi`, tablas, modales, chips).

Pruebas de aceptación (del brief) que se deben poder pasar: 30 segundos,
líder, operativo, ejecutivo (§51–54). Hoy pasan las de operativo; el objetivo
es cerrar las de líder/gerencia con la dimensión financiera.

---

## 15. Permisos

**PROPUESTA.** Mantener el modelo actual (rol global + `puede_gestionar` por
proyecto) para el MVP. Evaluar, sólo si un cliente lo exige, roles finos por
proyecto (observador/colaborador/gestor). Las entidades nuevas heredan el
permiso del proyecto:
- Ver avance/finanzas/RDI = ver el proyecto.
- Editar curva/estados de pago = `puede_gestionar` (líder/ADM) — **la plata la
  toca sólo quien gestiona**.
- Crear/seguir RDI = cualquier integrante; cerrarlo = quien gestiona.

**RIESGO:** el dato financiero es sensible. Debe respetar el límite multi-tenant
(`organizacion_id`) y no filtrarse entre organizaciones — mismo criterio ya
aplicado en el Directorio de Personas.

---

## 16. Integraciones con el ecosistema SIGSO (una sola fuente de verdad)

**PROPUESTA — no duplicar lo que ya existe:**
- **RDI ↔ Solicitudes:** SIGSO ya tiene intake/bandeja/seguimiento con estados,
  responsables y adjuntos. Evaluar seriamente modelar el RDI como una Solicitud
  *acotada a un proyecto* (campo `proyecto_id` + tipo "RDI" + centro de costo/
  especialidad/categoría) en vez de una tabla nueva. Reuso máximo, y el RDI
  hereda gratis: notificaciones, adjuntos, PDF, historial.
- **Personas ↔ Directorio:** responsables/solicitantes de RDI y estados de pago
  se resuelven con el Directorio (Nombre — Cargo), ya desplegado.
- **Documentos ↔ evidencia:** un estado de pago o un RDI adjunta desde el mismo
  gestor documental del proyecto (R2), no uno nuevo.
- **Calidad (ISO 9001):** el diferenciador — un entregable/hito de proyecto
  puede enlazar a evidencia de cláusula ISO. Ya hay módulo Calidad.
- **Reportes:** las secciones "Avance físico", "Avance financiero" y "RDI
  abiertos" se suman al PDF configurable existente (no un motor nuevo).

---

## 17. Migración y compatibilidad

**RIESGO bajo, patrón ya establecido.**
- Todo el esquema nuevo es **aditivo** (`asegurarEsquema` crea tablas/columnas
  al arrancar, nunca destruye). Los 10+ proyectos reales en producción no se
  tocan.
- Un proyecto sin datos financieros/curva/RDI se ve **exactamente igual que
  hoy** (las nuevas pestañas/columnas se ocultan si están vacías —
  "degradación elegante", criterio ya usado en todo SIGSO).
- No se toca `ACTIVIDADES` ni el acoplamiento tarea≡actividad.
- No se rompe: auth, permisos, navegación, otros módulos, reportes actuales
  (el PDF/Excel/CSV de un clic queda byte-a-byte intacto; lo nuevo va detrás de
  su propia sección/pestaña).

---

## 18. Plan de implementación por fases (Camino B)

Priorizado por **valor / esfuerzo / riesgo**. Cada fase es desplegable sola y
verificable en navegador antes de la siguiente.

**FASE 0 — Este documento + decisión del dueño (§10, §23).** *Bloqueante.*

**FASE 1 — Higiene y base (bajo riesgo, habilita el resto):**
- 1a. `centro_costo` + `presupuesto_monto/moneda` en `PROYECTOS` (aditivo) +
  mostrarlos en Resumen/edición.
- 1b. (Opcional pero recomendado) empezar a **modularizar `proyectos.js`** por
  vista — reduce el riesgo de todo lo que sigue. Se puede diferir si se prefiere
  entregar valor visible antes.

**FASE 2 — Avance físico (curva de control) [hueco #1]:**
- `PROYECTO_CONTROL_AVANCE` + acciones CRUD + sub-pestaña "Avance" con la curva
  proyectado-vs-real y tabla de puntos. KPIs "% proyectado / % real / desvío".
- Sección "Avance físico" en el PDF.

**FASE 3 — Avance financiero (estados de pago) [hueco #2]:**
- `PROYECTO_ESTADOS_PAGO` + CRUD + curva financiera (proyectado-vs-pagado) +
  el cruce físico↔financiero en el Resumen.
- Sección "Avance financiero" en el PDF.

**FASE 4 — RDI [hueco #3]:**
- Decidir §16 (tabla propia vs. tipo de Solicitud). Implementar el flujo:
  crear/seguir/cerrar, con centro de costo/especialidad/categoría, responsables,
  vencimiento, seguimientos, y **PDF por RDI**.

**FASE 5 — Pulido y comercial:**
- Búsqueda global, mejoras de densidad/jerarquía del Resumen, roles finos por
  proyecto (si se pidió), "plantilla construcción" (si se quiere acercar al
  Camino A sin comprometerse).

> El brief propone un orden MVP distinto (portafolio/creación/room/…), pero eso
> **ya existe**. El orden real de valor para SIGSO es cerrar los 3 huecos, que
> es lo que este plan hace.

---

## 19. Criterios de calidad y pruebas

**No se acepta:** placeholders, datos falsos permanentes, botones sin
funcionalidad, gráficos decorativos, componentes duplicados, navegación rota.
Todo lo que aparezca debe persistir y funcionar (regla del propio brief).

Por cada fase, como mínimo:
- **Tests backend** (node:test) por cada acción nueva + mutation-testing en lo
  sensible (permisos, límite multi-tenant del dato financiero).
- **Integridad:** un estado de pago editado se refleja en la curva; un punto de
  control cambia el desvío; el RDI cerrado sale del "abiertos".
- **Permisos:** probar que un no-gestor no toca la plata; que una organización
  no ve datos de otra.
- **Regresión:** la suite completa en verde (hoy ~2.767 tests) + el PDF/Excel/
  CSV de un clic intacto.
- **Verificación en navegador real** (Browser pane + backend local contra copia
  sandbox de producción) — nunca dar por buena una UI sin verla, criterio ya
  establecido en este proyecto.

---

## 20. Mejoras futuras (fuera del MVP, evaluar con datos)

- **Inteligencia explicable** (no IA porque sí): "este proyecto está en riesgo
  porque 3 tareas críticas atrasadas + plata cobrada > obra avanzada". Sólo si
  reduce trabajo real. SIGSO ya calcula los insumos (salud, desviación); un
  resumen redactado es el paso, no el modelo.
- Roles finos por proyecto (observador/colaborador/gestor).
- "Plantilla construcción" (Camino A como capa opcional).
- Libro de obra formal (si un cliente ITO lo exige legalmente).
- Portafolio ejecutivo cross-proyecto financiero.

---

## 21. Objetivo comercial

Pregunta guía del brief: *"¿qué mostrar a una empresa que hoy usa Excel para que
entienda el valor de cambiar?"*

Con Camino B, la demo de venta es: **"tu Excel de avance y tu Excel de estados
de pago, unidos al detalle de tareas y a la evidencia, en un solo lugar, con la
curva que tu gerente pide y un reporte PDF que le puedes mandar — y todo
conectado a las solicitudes, la calidad y las personas de tu empresa."** Eso es
lo que ni monday ni un ITO suelto entregan: la **trazabilidad de ecosistema**.

Potencia debajo, simplicidad encima: el operativo sigue haciendo check-in de un
clic; el líder gana finanzas; la gerencia gana el portafolio con plata.

---

## 22. Riesgos del proyecto (de esta evolución)

1. **Alcance runaway** — el brief pide "todo"; este plan acota a 3 huecos.
   Disciplina: no implementar lo que ya existe, no agregar por acumulación.
2. **Definir "valor/plata"** — la Fase G4b se difirió por esto; ahora hay que
   fijar el modelo (monto de contrato + estados de pago). Decisión de negocio,
   no técnica.
3. **Monolito frontend** — si no se modulariza, cada fase cuesta más y arriesga
   regresión.
4. **Sensibilidad del dato financiero** — filtración entre organizaciones sería
   grave; el límite multi-tenant debe testearse por mutación.

---

## 23. Próximo paso — decisión pendiente (BLOQUEANTE)

Antes de implementar, necesito **una** decisión del dueño:

**¿Camino A (vertical construcción/ITO completo) o Camino B (PM general +
finanzas + control + RDI generalizado)?** — recomiendo **B** (§10).

Con la respuesta:
- Si **B**: arranco por Fase 1 (centro de costo + presupuesto, aditivo, bajo
  riesgo) y sigo con la curva de control (Fase 2), validando en navegador y
  desplegando fase por fase.
- Si **A**: reviso §12–§18 para sumar el modelo ITO específico (especialidades,
  libro de obra legal) antes de empezar.

Preguntas menores que puedo resolver sobre la marcha (no bloquean):
- RDI: ¿tabla propia o tipo de Solicitud? (recomiendo tipo de Solicitud, §16).
- Moneda por defecto: ¿UF, CLP o ambas configurables? (la referencia usa UF).

**Hasta esta decisión, no se toca código.**
