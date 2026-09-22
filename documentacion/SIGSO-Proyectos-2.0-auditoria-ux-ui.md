# SIGSO Proyectos 2.0 — Auditoría UX / UI / Arquitectura de Información

> Segunda etapa del análisis (companion de
> `SIGSO-Proyectos-2.0-auditoria-y-propuesta.md`). Aquella cubrió
> **funcionalidad** y decidió el rumbo (**Camino B**: PM general + finanzas +
> control + RDI). Este documento cubre **operación + UX + UI + navegabilidad +
> arquitectura de información + interacción + diseño visual**.
>
> **No contiene cambios de código.** Se basa en un recorrido visual real del
> módulo en el navegador (Portafolio, Project Home/Resumen, Cronograma
> Dedicación + Plan/Gantt, Tareas, modal Nueva tarea), no en lectura de código.
>
> Convención: hallazgos clasificados **CRÍTICO / ALTO / MEDIO / BAJO** +
> etiquetas **EXISTENTE / PROPUESTA / NUEVO**. Fecha: 2026-09-22.
>
> **Caveat de método (honesto):** el panel de navegador de este entorno escala
> los viewports anchos (1440px) a ~785px, así que varias observaciones de
> "truncamiento" pueden verse mejor en un monitor real ancho. Donde aplica, lo
> marco. La jerarquía, densidad y arquitectura de información se evalúan igual
> a cualquier ancho.

---

## 0. Veredicto de una línea

El módulo es **funcionalmente muy potente pero visualmente sub-explota esa
potencia**: el contenido bueno existe (KPIs de plan-vs-real, atención
requerida, Gantt con hitos, dedicación, salud), pero está *enterrado bajo
cabeceras que desperdician espacio, 11 pestañas planas, líneas de texto
corridas y tarjetas dominadas por descripción*. El trabajo NO es agregar
pantallas: es **jerarquizar, comprimir el cromo y volver accionable lo que ya
se muestra**.

---

## 1. Auditoría visual — hallazgos por pantalla (lo que se vio)

### 1.1 Portafolio
**EXISTENTE:** fila de 5 KPIs (16 activos · 4 críticos · 2 en riesgo · 0 vencen
14d · 13 sin novedad 7+d), bloque "Carga por persona" (barras horizontales),
barra de filtros (buscar + estado + salud + orden + "Agrupar por líder"), y
grilla de tarjetas de proyecto.

Hallazgos:
- **[ALTO] "Carga por persona" muestra correos crudos truncados**
  ("Valentina Paz Macare…", "lmtech.workspace@g…", "comercial@homepym…"). El
  Directorio de Personas (Fase 2, "Nombre — Cargo") **ya existe y se aplicó a
  las listas de tareas, pero NO acá.** Inconsistencia visible.
- **[ALTO] Las tarjetas están dominadas por la descripción.** E-Contratistas
  ocupa ~6 líneas sólo de descripción; el dato accionable (avance, atrasos,
  vence) queda abajo. La descripción es lo *menos* escaneable de una tarjeta de
  portafolio.
- **[MEDIO] "· 100 pts" / "· 23 pts" es críptico.** Junto a la salud
  ("Crítico · 100 pts") parece un puntaje de salud, pero es la ponderación de
  tamaño del proyecto. Etiqueta ambigua para quien no conoce el sistema.
- **[MEDIO] "13 sin novedad 7+ días" compite** con los KPIs de verdad urgentes
  (críticos, en riesgo). No todos los KPIs merecen el mismo peso visual.
- **[BAJO] Línea de alertas al pie de la tarjeta** ("1 hito vencido · 1
  entregable vencido") como texto corrido — escaneable a medias.

### 1.2 Project Home (pestaña Resumen)
**EXISTENTE:** cabecera de módulo → breadcrumb → cabecera de proyecto → línea
de alertas → 11 pestañas → 8 KPIs → Próximo hito → Atención requerida →
Descripción/Objetivo → Líder → 6 botones de acción.

Hallazgos:
- **[CRÍTICO] La cabecera GENÉRICA del módulo se repite dentro de cada
  proyecto.** Arriba de todo aparece "Proyectos" en grande + ícono +
  "Portafolio, equipo y sala de trabajo de tus proyectos" — *antes* del
  breadcrumb "← Portafolio" y del nombre real del proyecto. Dentro de un
  proyecto eso es ruido: desperdicia ~120px del tope, empuja las pestañas y los
  KPIs bajo el fold, y hace que "Proyectos" compita con "Estandarización de
  Dept. Comercial" por la atención. **Es el fix visual de mayor impacto.**
- **[CRÍTICO] 11 pestañas planas en scroll horizontal.** Resumen · Sala ·
  Tareas · Hitos · Cronograma · Entregables · Documentos · Reuniones ·
  Decisiones · Riesgos · Equipo. Las últimas 4 quedan *fuera de pantalla* (hay
  que scrollear la barra de tabs para descubrir que existen). Un usuario nuevo
  no sabe que hay Riesgos/Equipo. Es un problema de arquitectura de
  navegación, no cosmético.
- **[ALTO] Línea de alertas corrida y no accionable:** "1 hito vencido · 2
  tareas críticas atrasadas · 44 tareas sin actualizar hace 5+ días hábiles · 4
  entregables vencidos". Buena información, mala presentación: es una frase, no
  algo escaneable ni clickeable. No puedo hacer clic en "44 tareas sin
  actualizar" para verlas (viola el principio indicador→contexto→acción).
- **[ALTO] "Líder: lmtech.workspace@gmail.com"** — correo crudo (Directorio no
  aplicado acá tampoco).
- **[MEDIO] 8 KPIs en una fila** (Avance real · esperado · Desviación · Hitos
  completados · Tareas vencidas · Críticas atrasadas · Riesgos altos · Fecha
  objetivo). El propio brief advierte contra "muchos KPIs sin jerarquía". Se
  pueden priorizar 3–4 primarios y bajar el resto.
- **[MEDIO] "Atención requerida" es una lista plana** que mezcla tareas
  vencidas, hitos y riesgos sin agrupación clara ni acción evidente. El *qué*
  está; falta el *hazlo desde aquí*.
- **[MEDIO] Descripción y Objetivo aparecen ABAJO**, después de Atención
  requerida. Para el "test de 30 segundos" ("¿qué es este proyecto?"), la
  descripción debería estar arriba/plegable, no al fondo.
- **[MEDIO] 6 botones de acción en fila** (Editar · Guardar como plantilla ·
  Descargar PDF · Descargar Excel · Configurar informe · Cerrar). Tres son de
  exportación → deberían colapsarse en un solo menú "Exportar ▾".

### 1.3 Cronograma
**EXISTENTE:** 5 sub-vistas (Dedicación · Plan · Historial · Workload ·
Analítica).

- **Plan (Gantt) — [lo mejor del módulo].** Hitos como ◆ (gris completado /
  rojo vencido / verde futuro), línea + pill "HOY", cabecera de meses, bandas
  de fin de semana, arrastrar el borde de la barra para reprogramar. Limpio y
  profesional. **[BAJO]** redundancia menor: la etiqueta repite la fecha ("Hito
  · 03/09/2026") que ya se lee de la posición del diamante.
- **Dedicación — grilla día×tarea.** Potente (heatmap de horas, celda editable,
  registro del día, totales). Hallazgos: **[MEDIO]** nombres de tarea y
  responsable **truncados** en la columna de etiquetas ("1. Reunión inicial:
  alinea…", "Valentina Paz Macarena Cab…") — parte por el ancho del panel, pero
  la columna de etiqueta apila 4 líneas por tarea (nombre + responsable + "Plan
  …" + chips "Esp/Real/+0pp") que compiten. **[MEDIO]** mucha micro-tipografía
  por fila.
- Historial/Workload/Analítica no se auditaron en detalle (son vistas de
  lectura secundarias); por el código están consolidadas y probadas.

### 1.4 Tareas
**EXISTENTE:** toggle Lista/Tablero, "+ Nueva tarea", "Asignar en lote". En
Lista: pila de tarjetas, una por tarea (título · estado · lápiz · responsable ·
prioridad · vence · colaborador).

Hallazgos:
- **[ALTO] Sin edición inline.** Todo cambio (fecha/responsable/estado/
  prioridad) pasa por el lápiz → modal. El brief pide explícitamente
  clic→editar→guardar para esos campos (§18).
- **[ALTO] Sin vista tabla densa ni orden/agrupar en la Lista.** 47 tareas son
  un scroll plano de tarjetas altas; no hay columnas ordenables ni agrupación
  por hito/estado/responsable. Para gestión rápida, una tabla compacta
  opcional escanea mucho mejor que las tarjetas.
- **[BAJO] Nombres de responsable resueltos** ("Valentina Paz Macarena
  Caballero") — bien, Directorio aplicado; pero el chip colaborador muestra
  "Valentina Caballero" (forma corta) → dos formas del mismo nombre (efecto del
  RUT duplicado ya detectado, no de esta UI).

### 1.5 Modal "Nueva tarea"
**EXISTENTE:** formulario de una columna con TODOS los campos visibles a la vez
(Título · Descripción · Responsable · Hito · Depende de · Fecha · Prioridad ·
Colaboradores · Meta · Tarea padre).

- **[ALTO] Sin "quick add" ni progressive disclosure.** El brief pide (§17) una
  creación rápida (Título + Responsable + Fecha + Prioridad) con lo demás
  plegado. Hoy es un formulario largo, igual de burocrático que el del sistema
  de referencia.

---

## 2. Auditoría de densidad

El módulo **no** peca de vacío; peca de **densidad mal distribuida**:
- *Demasiado cromo arriba* (cabecera de módulo + breadcrumb + cabecera de
  proyecto + línea de alertas + 11 tabs = ~4 bloques antes del contenido).
- *Demasiado texto en las tarjetas* de portafolio (descripción) y en las filas
  de Dedicación (4 líneas por tarea).
- *Demasiados KPIs sin jerarquía* (8 en Resumen, 5 en Portafolio).
- Pero el *contenido accionable* (atención requerida, Gantt) tiene densidad
  razonable.

**Objetivo:** subir la densidad *informativa* (más señal por pixel) bajando la
densidad *decorativa* (cromo, descripciones largas, KPIs de relleno).

---

## 3. Jerarquía visual — el problema transversal

Hoy demasiados elementos tienen el **mismo peso**. Falta la escala de 5 niveles
que pide el brief:

| Nivel | Pregunta | Hoy | Debería |
|---|---|---|---|
| 1 ¿Qué veo? | Nombre del proyecto | Compite con "Proyectos" genérico | Dominante, solo |
| 2 ¿Qué importa? | Salud + avance + próximo hito | Mezclado entre 8 KPIs | 3–4 KPIs primarios destacados |
| 3 ¿Qué necesita atención? | Atrasos/bloqueos/riesgos | Frase corrida + lista plana | Bloque escaneable, accionable |
| 4 ¿Qué hago? | Acciones | 6 botones iguales | 1–2 primarias + menú |
| 5 ¿Más detalle? | Descripción/historial | Al fondo o en pestañas | Bajo demanda (plegado/drawer) |

---

## 4. Navegación y arquitectura de información

**[CRÍTICO] Reagrupar las 11 pestañas.** Propuesta (misma que el FASE 0, §12),
de 11 planas a 4 grupos + Resumen:

```
Proyecto
├── Resumen            (command center)
├── Trabajo   → Tareas · Cronograma · Hitos
├── Control   → Avance(NUEVO) · Riesgos · Entregables
├── Colaboración → Sala · Reuniones · Decisiones · Documentos · RDI(NUEVO)
└── Equipo
```

Con esto ninguna sección queda "fuera de pantalla" y el usuario ve de un vistazo
las 5 áreas del proyecto. (La navegación de nivel superior —Mi trabajo /
Portafolio / Calendario / Reportes— está bien; no se toca.)

**[ALTO] Contextualidad (evitar sobre-navegación).** El brief insiste (§5–6) en
resolver acciones sin abandonar el contexto. Palancas concretas para SIGSO:
- Inline editing en la lista de Tareas (fecha/responsable/estado/prioridad).
- Un **drawer lateral de tarea** (abrir tarea → panel derecho con detalle,
  comentarios, evidencia, historial) en vez de perder el contexto de la lista.
  Reusa el mismo patrón que ya existe para modales.

---

## 5. Evaluación heurística (Nielsen, resumida)

| Heurística | Estado | Nota |
|---|---|---|
| Visibilidad del estado | **Buena** | Salud, semáforos, HOY, avance — bien resueltos. |
| Correspondencia con el mundo real | Media | "pts" críptico; correos crudos en vez de nombres. |
| Control y libertad | Media | Reprogramar exige motivo (bien); faltan deshacer/inline. |
| Consistencia | **Media/baja** | Directorio aplicado a medias (tareas sí, portafolio/líder no). |
| Prevención de errores | Buena | Confirmaciones, doble-submit resuelto, motivo obligatorio. |
| Reconocer > recordar | Media | 11 tabs (4 ocultas) obligan a recordar dónde está cada cosa. |
| Flexibilidad | Media | Sin vistas alternativas de tarea (tabla), sin quick-add. |
| Minimalismo | **Baja** | Cabecera de módulo repetida, descripciones largas, 8 KPIs. |
| Recuperación de errores | Buena | Toasts, degradación elegante. |
| Ayuda contextual | Media | Textos de ayuda existen (ej. Gantt); faltan en varias. |

---

## 6. Pruebas de usuario (del brief)

**Test de 30 segundos (Project Home):** hoy se responde ~6/8 preguntas rápido
(estado, avance, responsable, próximo hito, atrasos, atención). Falla: "¿qué es
este proyecto?" (descripción al fondo) y el ruido de la cabecera de módulo
demora el "¿qué proyecto veo?". **Con quitar la cabecera genérica + subir la
descripción, pasa.**

**Operativo ("¿qué hago hoy?"):** *pasa* — "Mi trabajo en proyectos" + check-in
de un clic ya existen y funcionan.

**Líder ("¿mi proyecto está atrasado?"):** *pasa a medias* — el dato está
(desviación +5.4pp, atención requerida) pero disperso entre 8 KPIs; falta la
dimensión financiera (Camino B).

**Gerencia ("¿qué requiere atención?"):** *pasa a medias* — el Portafolio tiene
críticos/en riesgo, pero los KPIs no son clickeables a su detalle
(indicador→contexto→acción incompleto).

---

## 7. Estados y color

**EXISTENTE, y está bien:** SIGSO ya tiene tokens semánticos
(`--ok`/`--riesgo`/`--critico`/`--alerta`/`--info`/`--primario`) y los usa con
semáforos, pills y rieles de color. **No hay que inventar paleta.** El color ya
comunica (estado/salud/prioridad) más que decorar — cumple el §12 del brief.

**[BAJO] Refinamientos:** asegurar que ningún estado dependa *sólo* del color
(agregar ícono/texto donde falte, p.ej. en las marcas del heatmap de
Dedicación) — accesibilidad (§31).

---

## 8. Consistencia con SIGSO / Design system

**EXISTENTE:** el módulo respeta el shell, la tipografía, los componentes
(`Componentes.kpi/boton/badge/avatar/campoTexto`) y los tokens. Se siente parte
de SIGSO. **No** hay que rediseñar un design system nuevo.

**[PROPUESTA] Componentes reutilizables que este rediseño debería formalizar**
(sirven a todo SIGSO, no sólo Proyectos):
- **Cabecera de entidad** compacta (breadcrumb + título + estado + acciones) —
  reemplaza la cabecera de módulo repetida.
- **Grupo de pestañas con overflow** ("… más ▾") en vez de scroll horizontal
  ciego.
- **Fila de KPIs con jerarquía** (primarios grandes + secundarios chicos).
- **Drawer de detalle** lateral.
- **Bloque "requiere atención" accionable** (ítem → clic → contexto).

---

## 9. Rendimiento (a vigilar, no bloqueante hoy)

- La lista de Tareas pinta 47 tarjetas de golpe; con cientos, conviene
  paginación/virtualización o la vista tabla (que es más liviana por fila).
- El Gantt/Dedicación ya cargan lazy y repintan optimista (bien).
- **[RIESGO] Monolito de 400KB** (frontend `proyectos.js`): no es rendimiento
  de runtime sino de *mantenibilidad* — cada cambio de este rediseño arriesga
  regresión. Modularizar por vista antes de las fases grandes baja ese riesgo.

---

## 10. Clasificación de hallazgos (resumen)

**CRÍTICO** (afecta significativamente UX; máximo impacto/menor esfuerzo):
- C1. Cabecera de módulo repetida dentro del proyecto → compactar a cabecera de
  entidad. *(mucho impacto, poco esfuerzo)*
- C2. 11 pestañas planas → reagrupar en 4 grupos + Resumen.
- C3. (Ejecución) Monolito frontend → modularizar por vista antes de lo grande.

**ALTO:**
- A1. Directorio inconsistente (Portafolio "carga por persona" + Resumen
  "Líder" con correos crudos).
- A2. Línea de alertas del proyecto no escaneable/accionable.
- A3. "Atención requerida" plana y no accionable.
- A4. Tarjetas de portafolio dominadas por descripción; "pts" críptico.
- A5. Sin inline editing en Tareas.
- A6. Sin vista tabla ni orden/agrupar en la Lista de Tareas.
- A7. "Nueva tarea" sin quick-add/progressive disclosure.

**MEDIO:**
- M1. 8 KPIs sin jerarquía en Resumen. M2. 6 botones (3 export → menú).
- M3. Labels truncados + 4 líneas por fila en Dedicación.
- M4. Descripción/objetivo al fondo del Resumen.
- M5. Verificar empty/error states orientadores (§29–30).

**BAJO:**
- B1. Redundancia de fecha en labels del Gantt. B2. "pts" label. B3.
  Micro-pulidos, microinteracciones, dependencia de color en heatmap.

---

## 11. Estrategia de rediseño (no una lista — un plan)

La estrategia es **comprimir el cromo, jerarquizar el contenido y volver todo
accionable**, en incrementos desplegables y verificables en navegador, sobre la
base que ya funciona. Se reconcilia con el Camino B (funcional) en un solo
roadmap: **primero UX/UI (Fases A–C), luego los diferenciadores funcionales
(Fase H = los 3 huecos de Camino B)**, con Gantt/dashboards/reportes puliéndose
en medio.

### FASE A — Fundaciones (navegación + arquitectura) · CRÍTICO
- A0. Modularizar `proyectos.js` por vista (habilitador; puede ser parcial).
- A1. Cabecera de entidad compacta (mata la cabecera de módulo repetida).
- A2. Reagrupar las 11 pestañas en 4 grupos + Resumen.
> *Impacto inmediato en el "test de 30 segundos" y en descubribilidad.*

### FASE B — UX / flujos · ALTO
- Inline editing en Tareas (fecha/responsable/estado/prioridad).
- Quick-add de tarea + progressive disclosure.
- "Atención requerida" y línea de alertas → escaneables y clickeables
  (indicador→contexto→acción).
- Drawer de detalle de tarea.

### FASE C — UI / visual · ALTO/MEDIO
- Directorio consistente (Nombre — Cargo) en Portafolio y Líder.
- Tarjetas de portafolio rediseñadas (descripción plegada, datos accionables
  arriba, "pts" con etiqueta clara o quitado).
- Jerarquía de KPIs (3–4 primarios + secundarios) en Resumen y Portafolio.
- Menú "Exportar ▾"; densidad de Dedicación (labels, chips).
- Empty/error states orientadores donde falten.

### FASE D — Gantt (pulido, ya es fuerte)
- Leyenda/densidad, quitar redundancias, vista de doble lectura plan-vs-real
  más explícita (el baseline ya existe; falta mostrarlo superpuesto).

### FASE E — Dashboards accionables
- Portafolio ejecutivo: KPIs clickeables → su detalle; narrativa
  contexto→situación→atención→acción.

### FASE F — Reportes (ya robusto: pulir presentación).

### FASE G — Automatización / productividad
- Command palette / búsqueda global (§19), atajos, quick actions — evaluar
  según uso real.

### FASE H — Diferenciadores (= Camino B funcional)
- Avance físico (curva S de control), Avance financiero (estados de pago), RDI,
  centro de costo. Ver el FASE 0 para el modelo de datos y detalle.

---

## 12. Propuesta visual conceptual por pantalla (§54)

- **Portafolio:** cabecera compacta; fila de KPIs con 3 primarios (activos ·
  críticos · en riesgo) grandes + el resto chicos; "carga por persona" con
  Nombre — Cargo; tarjetas de proyecto **compactas** (título + salud + avance +
  próximo hito + atrasos como chips clickeables; descripción plegada). Toggle
  tarjetas/tabla.
- **Project Home:** *command center* — cabecera de entidad; franja superior con
  Salud (score) + Avance físico + (futuro) Avance financiero + Próximo hito;
  bloque "Requiere atención" accionable (agrupado por tipo, cada ítem
  clickeable); descripción/objetivo plegable arriba; 1–2 acciones primarias +
  "Exportar ▾" + "⋯".
- **Tareas:** Lista (tarjetas) / **Tabla** (densa, ordenable, agrupable) /
  Tablero (Kanban). Inline edit + drawer de detalle. Quick-add.
- **Gantt:** como está + baseline superpuesto opcional + leyenda compacta.
- **Dedicación/Workload:** labels con más aire, chips plan/esp/real colapsables.
- **Equipo:** (existe como pestaña) vista de carga por persona reusando
  Workload.
- **Reportes/Portafolio ejecutivo:** narrativa accionable.

---

## 13. No romper / refactor / riesgos (§47–49)

- **No romper:** auth, permisos, navegación superior, otros módulos, el
  PDF/Excel/CSV de un clic, y el modelo tarea≡actividad. Todo el rediseño es de
  *presentación*; el backend y los datos no cambian en Fases A–G.
- **Refactor con razón:** el monolito frontend sí justifica modularización (no
  por moda: baja el riesgo de regresión de todo lo que sigue). Se hace
  incremental, vista por vista, con verificación en navegador.
- **Migración:** ninguna en Fases A–G (sólo UI). Fase H es aditiva (FASE 0).

---

## 14. Criterio visual final (§51) y validación (§57)

Meta estética: **premium B2B SaaS** — claridad, jerarquía, espacio,
profundidad bajo demanda; nada de "dashboard genérico de IA" (exceso de
tarjetas/gradientes/sombras/colores). SIGSO ya tiene la base sobria; el trabajo
es *quitar ruido y jerarquizar*, no agregar adornos.

Cada incremento se valida en navegador (claro y oscuro, desktop y móvil) contra
copia sandbox de producción, con la pregunta de control del §56: *"¿esto
realmente parece un producto premium?"* — si no, se itera antes de dar por
cerrado.

---

## 15. Próximo paso

Con Camino B ya elegido y esta auditoría entregada, el orden recomendado para
**empezar a ejecutar** es **Fase A** (cabecera de entidad + reagrupar pestañas
— máximo impacto, bajo riesgo, sólo frontend), verificando en navegador y
desplegando. Antes de arrancar, una sola confirmación útil:

- ¿Empiezo por **Fase A completa** (incluida una primera modularización de
  `proyectos.js`), o prefieres **valor visible primero** (cabecera + pestañas +
  tarjetas de portafolio) y dejamos la modularización para cuando estorbe?

Ambas son válidas; la primera es más sana a largo plazo, la segunda muestra
resultado más rápido.
