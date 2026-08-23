# SIGSO v12.0/v12.1 — Arquitectura de navegación Módulo → Submódulo → Ítem

Fecha: 2026-08-23 · Estado: **v12.0 base + Calidad. v12.1 enrutamiento por URL + Administración, Novedades y Coordinación.**

---

## A. Auditoría de la arquitectura actual (Fase 0)

### A.1 Lo que ya estaba bien y NO había que rehacer

| Hallazgo | Detalle |
|---|---|
| **Ya existe un catálogo central de módulos** | `MODULOS_SHELL` en `frontend/js/plataforma.js:28` — 12 módulos con `icono`, `nombre`, `descripcion`, `interno`. No hizo falta inventar un `MODULES = [...]`: ya estaba. |
| **La navegación de primer nivel ya es vertical** | `.plataforma-sidebar` + `#nav-modulos`, colapsable, con drawer en móvil. El problema nunca fue el primer nivel. |
| **Ya existe un design system maduro** | `css/tokens.css` v8.0: navy institucional + azul de acción, semánticos sólo para estado, dos niveles de sombra, modo oscuro con los tres estados. Toda la navegación nueva se construyó **sólo con esos tokens** — cero colores nuevos, y el modo oscuro funcionó sin escribir una regla extra. |
| **La jerarquía de Calidad ya existía en los datos** | `GRUPOS_SECCIONES_SGC` declaraba **7 grupos con 16 secciones**. Lo que faltaba no era el modelo: era dibujarlo. |
| **Administración ya usaba menú vertical** | `.sigso-admin-menu` (14 ítems, `flex-direction: column`) y hasta un tercer nivel dentro de Pausas. El patrón a generalizar ya existía en el propio SIGSO. |
| **Los permisos ya vienen del backend** | `seccionesVisiblesSgc_()` en `backend/backoffice/Calidad.gs:1067` devuelve un mapa `sección → bool`. La navegación nueva lo obedece; no reimplementa reglas. |

### A.2 El problema real

**No era "hay pestañas". Era que la jerarquía existía y se dibujaba aplanada.**

El propio CSS dejó escrito el diagnóstico, en `components.css`, sobre `.sgc-secciones`:

> *"Con la quinta sección (Auditorías) la barra dejó de caber en un móvil y estiraba la página entera... Envolver no sirve: dos filas de pestañas se leen como dos niveles de navegación."*

Ese comentario se escribió cuando había 5 secciones. Al llegar la v11.0 había **16**, en una sola barra con scroll lateral.

### A.3 Inventario de navegación horizontal encontrada

| Módulo | Patrón | Elementos |
|---|---|---|
| **Calidad** | `.sgc-secciones` (barra con scroll) | **16 secciones en 7 grupos** |
| Proyectos | `.sigso-tabs` | 7 pestañas por proyecto |
| Novedades | `.sigso-tabs` | 3-4 vistas |
| Coordinación de pausas | `.sigso-tabs` | 3 vistas |
| Administración | `.sigso-admin-menu` (ya vertical) | 14 ítems + sub-pestañas en Pausas |
| Bandeja / Gerencia / Jefatura | `.sigso-tabs__boton` | vistas del panel |

### A.4 Hallazgo que cambia el alcance: **SIGSO no tiene enrutamiento por URL**

Verificado: cero `location.hash`, cero `history.pushState` para navegar. `plataforma.js:140` hace `replaceState(null, '', pathname)` y **borra la URL**. Los módulos se muestran/ocultan con clases CSS.

El único parámetro es `?modulo=` de un enlace mágico, consumido una sola vez.

**Consecuencia para el §18 del encargo ("no rompas rutas"): no hay rutas que romper.** No existen bookmarks profundos, ni enlaces internos por URL, ni accesos directos. Tampoco existe hoy el riesgo de "entrar por URL sin permiso", porque no se entra por URL. Esto simplificó enormemente la migración — y es también un pendiente propio (ver §G).

### A.5 Reportes existentes, dispersos

| Dónde | Qué |
|---|---|
| `gerencia.js` | El módulo entero es un reporte; además "Reporte Ejecutivo" y envío por correo |
| `coordinacion.js` | Pestaña "Reportes" (cumplimiento de pausas) |
| `dashboard.js` | `exportarCSV_()` |
| `calidad.js` | Cobertura ISO + "Descargar evidencia (PDF)" del modo auditoría |
| `jefatura.js` | KPIs del equipo |

No existía ningún criterio común. Ningún módulo tenía un submódulo "Reportes" salvo Coordinación.

---

## B. Nueva arquitectura

### B.1 El contrato (`frontend/js/navegacion.js`)

```js
SigsoNav.render({
  contenedor, modulo, submodulos, activo,
  visible: function (llavePermiso, item) { return bool; },
  badges: { itemId: valor },
  onSeleccion: function (itemId, { seccion, argumento }) {}
});
SigsoNav.migas({ modulo, moduloNombre, submodulos, activo, detalle });
```

Tres decisiones que lo hacen reutilizable sin sobrediseñar:

1. **No decide permisos.** Recibe un predicado y lo obedece. Quien manda sigue siendo el backend.
2. **Regla de aplanado.** Un submódulo con un solo ítem homónimo (o con `plano: true`) se dibuja como enlace directo, no como acordeón de una sola cosa. Evita la navegación de tres niveles siempre visible que el §24 pedía evitar.
3. **Ítems compuestos `seccion:argumento`.** Un ítem puede ser una **vista filtrada de una sección que ya existe**, sin duplicar pantallas ni crear endpoints. Así "Procedimientos" es `documentos:PRO` — la misma pantalla de documentos con el filtro que existe desde la v10.0.

### B.2 Mapa de Calidad (implementado)

```
SIGSO
└── Calidad
    ├── Inicio                          → tablero          (enlace directo)
    │
    ├── Sistema de Gestión              (capítulo 4)
    │   ├── Alcance                     → alcance          §4.3
    │   ├── Contexto y partes           → contexto         §4.1 / §4.2
    │   ├── Mapa de procesos            → procesos         §4.4
    │   └── Cobertura ISO               → cobertura        transversal 4-10
    │
    ├── Planificación                   (capítulo 6)
    │   ├── Riesgos y oportunidades     → riesgos          §6.1
    │   └── Objetivos de calidad        → objetivos        §6.2
    │
    ├── Documentación                   (§7.5)
    │   ├── Lista maestra               → documentos
    │   ├── Procedimientos              → documentos:PRO
    │   ├── Instructivos                → documentos:INS
    │   ├── Formularios                 → documentos:FO
    │   └── Documentos externos         → documentos:EXTERNO
    │
    ├── Personas                        (§7.2 / §7.3)
    │   ├── Personal                    → personas
    │   └── Capacitaciones              → capacitaciones
    │
    ├── Operación                       (capítulo 8)
    │   ├── Servicios prestados         → servicios        §8.1/8.5/8.6
    │   └── Proveedores                 → proveedores      §8.4
    │
    ├── Control y mejora                (capítulos 9 y 10)
    │   ├── Indicadores                 → indicadores      §9.1.1
    │   ├── Quejas                      → quejas           §9.1.2
    │   ├── Auditorías internas         → auditorias       §9.2
    │   ├── Revisión por la dirección   → revision         §9.3
    │   └── No conformidades            → nc               §10.2
    │
    ├── ★ Reportes                      → reportes         (destacado, enlace directo)
    │
    └── Administración
        └── Accesos                     → accesos
```

**Por qué este agrupamiento y no el propuesto en el encargo:** el encargo proponía un submódulo "Sistema de Gestión" con los siete capítulos (Contexto, Liderazgo, Planificación, Apoyo, Operación, Evaluación, Mejora) como ítems. Eso habría creado **siete pantallas que no existen**. La vista por capítulo de la norma **ya existe y funciona**: es *Cobertura ISO*, que agrupa las 28 cláusulas en los capítulos 4-10 (`saludPorCapitulo_` en `Tablero.gs`). Se dejó ahí en vez de duplicarla.

Los 16 ítems son **exactamente** las 16 secciones que ya existían. No se creó ni se eliminó ninguna funcionalidad.

---

## C. Cambios realizados

| Archivo | Cambio |
|---|---|
| `frontend/js/navegacion.js` | **NUEVO** (255 líneas). Componente reutilizable + migas de pan. |
| `frontend/js/calidad.js` | `GRUPOS_SECCIONES_SGC` → `ARQUITECTURA_SGC`. `barraSecciones_()` ahora devuelve **migas** en vez de la barra de pestañas (un solo punto de cambio para sus **51 llamadas**). Nuevos `panelSgc_()`, `pintarNavSgc_()`, `puedeVerSeccion_()`, `irASeccion_()`. Los **27** `getElementById('calidad-contenido')` pasan a `panelSgc_()`. Centro de reportes. |
| `frontend/css/components.css` | Bloque `.sigso-nav2` + `.sigso-modulo-layout` + `.sigso-migas` + fichas de reportes. Se retiró el CSS muerto de `.sgc-secciones` / `.sgc-nav-grupo` / `.sgc-nav-separador` (36 líneas). |
| `frontend/plataforma.html`, `frontend/app.html` | Carga de `navegacion.js`. Descripción del módulo actualizada (decía "Documentos vigentes", pero desde la v11.0 cubre 16 secciones). |
| `frontend/js/plataforma.js` | Misma corrección de descripción en `MODULOS_SHELL.calidad`. |

**Estrategia de migración:** en vez de tocar 51 sitios que pintaban la barra y 27 que escribían el contenido, se cambió **qué devuelven** dos funciones que ya existían. Riesgo bajo y reversible.

---

## D. Funcionalidades migradas

Ninguna funcionalidad se movió de lugar ni se eliminó. Las 16 secciones siguen existiendo con el mismo id y el mismo comportamiento. Lo que cambió es **cómo se llega a ellas**.

Lo único genuinamente nuevo:
- **5 ítems de Documentación por tipo** — no son pantallas nuevas: son el filtro `filtroTipo_` (que existe desde v10.0) con entrada por navegación.
- **Submódulo Reportes.**
- **Migas de pan** en las 51 vistas.

---

## E. Compatibilidad

| Riesgo del encargo | Estado |
|---|---|
| Romper rutas | **No aplica**: SIGSO no tiene enrutamiento por URL (§A.4). |
| Romper enlaces internos | Sin cambios: `window.SigsoShell.irAModulo` y `SigsoApp.irAModulo` siguen igual. |
| Romper permisos | La navegación consume `seccionesVisiblesSgc_` igual que antes. Verificado: **Administración sólo aparece cuando llega el mapa de permisos**. |
| Romper las dos vías de acceso | Verificado en `app.html` (login Google) **y** `plataforma.html` (token). |
| Romper el backend | Cero cambios de backend. 1197/1197 tests pasan. |

---

## F. Reportes: qué quedó preparado

Catálogo declarativo `REPORTES_SGC`: **8 grupos, 23 reportes**. Cada uno declara su estado y **de qué dato real sale**:

- **16 `LISTO`** — se arman con endpoints que ya responden.
- **7 `PENDIENTE`** — la ficha existe y **dice qué le falta**, en vez de mostrar un gráfico inventado.

Implementados aquí: *Cumplimiento general* (por capítulo de la norma) y *Cumplimiento por cláusula* (las 28). Los otros 14 disponibles **navegan a la sección que ya los contiene** en vez de duplicar la pantalla.

Los pendientes y su motivo real:

| Reporte | Qué falta |
|---|---|
| Cumplimiento por área | Las cláusulas no se atribuyen a un área |
| Cumplimiento por proceso | Falta enlazar cláusula ↔ proceso; hoy sólo los indicadores tienen `proceso_id` |
| Cumplimiento por responsable | Los 14 procesos del mapa están sin responsable asignado |
| Evolución del riesgo | SIGSO guarda la valoración **vigente**, no su historia |
| Tendencias de indicadores | Las lecturas ya se guardan con período; falta la vista de serie temporal ← **el más fácil de construir; es por donde empezar** |
| Período actual vs anterior | Requiere una foto periódica del estado; hoy la cobertura se calcula siempre contra el presente |
| Rankings por área | Depende de "Cumplimiento por área" |

---

## G. Pendientes

**Fase 3 (migración del resto de módulos):**
- `proyectos.js` — 7 pestañas por proyecto
- `novedades.js` — 3-4 vistas
- `coordinacion.js` — 3 vistas (su "Reportes" ya existe: es el primer candidato a encajar en el patrón)
- `admin.js` — 14 ítems ya verticales; falta agrupar en submódulos y sacar el tercer nivel de Pausas
- `gerencia.js` / `jefatura.js` / `dashboard.js`

**Reportes transversales:** ningún módulo salvo Calidad tiene todavía su submódulo Reportes. La regla arquitectónica está, falta aplicarla.

**Enrutamiento (no estaba en el encargo, pero lo condiciona):** sin URL no hay bookmarks, no se puede compartir un enlace a una sección, y el botón *atrás* del navegador no funciona dentro del módulo. Las migas de pan hoy **informan** dónde estás pero no son clicables, justamente porque no hay a dónde enlazar. Si se quiere navegación por URL, es un trabajo propio y previo.

**Verificación pendiente:** captura visual. El panel del navegador de esta sesión no compone frames, así que la validación se hizo por DOM y estilos computados (más estricta para lo que importa aquí, pero no reemplaza mirar la pantalla).

---

# v12.1 — Enrutamiento por URL y migración de tres módulos más

## H. Enrutamiento (el pendiente que condicionaba todo lo demás)

En la v12.0 dejé escrito que sin URL no hay bookmarks, ni enlaces compartibles, ni botón atrás, y que **por eso las migas de pan informaban pero no eran clicables**. Eso ya está resuelto.

### H.1 Por qué hash y no History API

SIGSO se publica en **GitHub Pages**, que sirve archivos estáticos. Con `pushState`, recargar en `/plataforma/calidad` daría **404**: no hay servidor que reescriba la ruta al `index`. El hash no toca el servidor.

```
#/<modulo>            →  #/calidad
#/<modulo>/<itemId>   →  #/calidad/documentos:PRO
```

### H.2 La URL no es una autorización

Verificado con una cuenta sin el módulo `calidad` entrando por `#/calidad/riesgos`: **cae a Home, la URL se reescribe a `#/home`, y el módulo ni siquiera se renderiza.** Cada módulo valida además que el ítem exista en su arquitectura, así que una URL escrita a mano no puede inventar una sección. Y el backend sigue validando cada acción por su cuenta, como siempre.

### H.3 Dos defectos reales que aparecieron al conectarlo

| Defecto | Detalle |
|---|---|
| **El enlace mágico borraba la sección** | La limpieza del `?token=` usaba `replaceState(null,'',location.pathname)`, y `pathname` **descarta el hash**. Un enlace con token *y* sección (`?token=…#/calidad/riesgos`) abría Calidad en su sección por defecto y el usuario no tenía forma de saber por qué. |
| **`SigsoShell` se definía demasiado tarde** | Estaba **después** de `mostrarModulo_(moduloInicial)`. Cuando el módulo preguntaba por la ruta, el puente todavía no existía, así que un enlace directo abría el módulo pero caía en su sección por defecto. |

Los dos son del tipo que sólo aparece al ejercer el camino completo: ningún test unitario los habría visto.

## I. Módulos migrados en la v12.1

| Módulo | Antes | Ahora |
|---|---|---|
| **Administración** | 14 botones planos en una columna | 6 submódulos agrupados (Organización · Catálogos · Accesos · Comunicaciones · Operación · **Reportes**) |
| **Novedades** | 4 pestañas horizontales | 4 enlaces directos verticales, con **Reportes** destacado |
| **Coordinación de pausas** | 3 pestañas horizontales | 3 enlaces directos, con **Reportes** destacado |

Ninguno perdió funcionalidad. En Administración los 14 ítems son los mismos 14 `data-tipo` de siempre; el resto de `admin.js` no se enteró del cambio.

**De paso, una duplicación que se elimina:** el menú de Administración estaba **hardcodeado en dos HTML** (`plataforma.html` y `admin.html`), con la misma lista de 14 botones que había que mantener sincronizada a mano. Ahora lo pinta `admin.js` desde una sola definición.

### I.1 Reportes: qué se puso en cada uno, sin inventar

| Módulo | Reporte | De dónde salió |
|---|---|---|
| Administración | Automatizaciones | Ya existía (`listarLogs`, historial de triggers); estaba suelto entre los catálogos |
| Novedades | Cumplimiento de lectura | Ya existía; era una pestaña más, indistinguible de las vistas de trabajo |
| Coordinación | Cumplimiento de pausas | Ya tenía su apartado "Reportes" antes de que existiera la regla |

## J. Lo que deliberadamente NO se convirtió

Quedan barras horizontales en `admin.js` (sub-pestañas de Pausas), `calidad.js` (ficha de persona, sub-nav de Accesos), `proyectos.js` (7 pestañas de un proyecto), `dashboard.js`, `gerencia.js`, `jefatura.js` y `estado.js`.

**No es trabajo pendiente: es una distinción de diseño.** Esas son pestañas **sobre una entidad** (una persona, un proyecto, una solicitud) o conmutadores de vista, no navegación de módulo. Convertirlas a acordeón vertical:

- crearía **tres niveles verticales visibles a la vez** (nav de módulo + nav de entidad + contenido), que es justo lo que el §24 del encargo pedía evitar;
- competiría visualmente con la navegación del módulo, que está a su izquierda;
- y sería exactamente el *"cambiar los tabs por acordeones"* que el §31 dice que **no** es la solicitud.

Con 3-7 pestañas sobre una entidad, una barra horizontal no scrollea ni fragmenta. El problema que motivó todo esto aparecía a los 16 ítems de navegación de módulo.

## K. Verificación de la v12.1

- **12 rutas** recorridas (home, calidad ×4, administración ×2, novedades, coordinación, proyectos, mi_trabajo, bandeja): todas cargan, **cero errores JS**, cero scroll horizontal.
- **Atrás / adelante** del navegador: recorren el historial interno y la navegación lateral y las migas siguen el cambio.
- **Enlace directo con recarga**: `#/calidad/auditorias` abre el módulo en esa sección.
- **Enlace mágico + sección**: `?token=…#/calidad/riesgos` funciona y el token se limpia de la URL.
- **Permiso por URL**: cuenta sin `calidad` pidiendo `#/calidad/riesgos` → Home.
- **Móvil (375px)**: los cuatro módulos migrados sin scroll horizontal; el menú de Administración se mantiene en columna (antes pasaba a fila envolviendo, que con acordeones sería ilegible).
- **1197/1197 tests** de backend.

## L. Pendientes tras la v12.1

- **Proyectos, Gerencia, Jefatura, Bandeja** no tienen submódulo Reportes. Gerencia y Jefatura *son* casi enteramente reportes: la conversión ahí es más una reorganización que un agregado, y conviene hacerla junto con la Fase 2 de Reportes.
- **`app.html`** (la vía con login Google) no tiene enrutamiento: `SigsoShell` sólo existe en `plataforma.html`. Los módulos degradan bien —se comportan como antes— pero no hay enlaces profundos por esa vía.
- **Captura visual**: sigue pendiente. El panel del navegador de esta sesión no compone frames; la verificación fue por DOM y estilos computados.

---

# v12.2 — FASE 2: arquitectura de Reportes

## M. Auditoría de datos (lo que pedía el §32)

### M.1 Corrección a la v12.0: **sí hay historia**

En la v12.0 marqué "tendencias" y "comparación de períodos" como imposibles por falta de datos históricos. **Era un error de auditoría mío.** SIGSO guarda historia en varias tablas:

| Tabla | Qué guarda | Sirve para |
|---|---|---|
| `HISTORIAL_ESTADOS` | Cada transición de estado, con timestamp | Tiempo de ciclo, throughput por mes |
| `HISTORIAL_COMPROMISO` | Fecha anterior → nueva, con motivo | Reporte de "resbalón" de plazos |
| `HISTORIAL_PRIORIDAD` / `HISTORIAL_ASIGNACION` | Cambios con justificación | Trazabilidad de decisiones |
| `ACTIVIDADES_BITACORA` | `avance_pct` con timestamp | Avance en el tiempo |
| `SGC_INDICADOR_LECTURAS` | `anio` + `periodo` + `valor` + `cumple` | **Serie temporal de indicadores** |
| `NOVEDADES_LECTURAS`, `SGC_DOC_ACUSES` | Fecha de lectura/acuse | Cumplimiento de difusión |
| `PAUSAS_ASISTENCIA` | Registro con fecha y hora | Cumplimiento de pausas |
| `LOG_NOTIFICACIONES` | Envío, resultado, reintentos | Entregabilidad |

Lo que **de verdad** no existe es una **foto periódica de la cobertura ISO**: se calcula siempre contra el presente y no se archiva. Ese sigue siendo el único bloqueo real para "cobertura: período actual vs anterior".

### M.2 Dónde están los hechos reportables

- **Solicitudes**: la tabla de hechos es `SUBSOLICITUDES`, no `SOLICITUDES`. Ahí viven `area`, `estado`, `prioridad`, `sla_objetivo_horas`, `estimacion_horas`, `horas_reales`, `fecha_comprometida`, `fecha_terminada`, `desarrollador_asignado`, `centro_costos`.
- **Actividades**: `responsable_email`, `area_id`, `cliente_id`, `estado`, `prioridad` + cinco campos de fecha.
- **Proyectos**: `lider_email`, `area_id`, `cliente_id`, `categoria`, `estado`, fechas objetivo/cierre.
- **Calidad**: los indicadores traen su meta y `listarIndicadoresSgc` ya devuelve **todas las lecturas de cada uno**.

## N. El motor (`frontend/js/reportes.js`)

```js
SigsoReportes.registrar(moduloId, { titulo, nota, grupos });
SigsoReportes.pintarCatalogo({ contenedor, modulo, onAbrir, onIrASeccion, visible });
SigsoReportes.pintarFiltros(reporte, opciones, valores);   // sólo los declarados
SigsoReportes.kpis / tabla / ranking / tendencia / comparacion
SigsoReportes.barraAcciones / wireAcciones                 // CSV + imprimir/PDF
```

### N.1 Tres reglas que lo ordenan

1. **Cada reporte declara de qué dato real sale.** Si el dato no existe, el reporte aparece marcado y dice qué le falta. Nunca un gráfico con datos inventados.
2. **Sólo se muestran los filtros que aplican.** Un selector de "área" en un reporte que no desagrega por área no es neutro: promete un corte que no existe.
3. **No decide permisos.** Recibe un predicado y lo obedece, igual que `navegacion.js`.

### N.2 Decisiones técnicas

| Decisión | Por qué |
|---|---|
| **SVG inline y CSS, no Chart.js** | El motor funciona también en `admin.html`, que no carga la librería, y los reportes se imprimen bien. |
| **El CSV sale de la tabla YA PINTADA** | Lo que se descarga es exactamente lo que la persona ve. Si saliera de una segunda consulta podrían diferir, y en un reporte de gestión eso es grave. |
| **BOM en el CSV** | Sin él, Excel en Windows abre los acentos rotos. |
| **La tendencia lleva pie de texto con los valores** | Un lector de pantalla no puede leer un `<path>`. El pie es la versión accesible del gráfico. |
| **La comparación escribe el signo (+/−/=)** | El estado no puede depender sólo del color (§20 del encargo, WCAG 1.4.1). |
| **`@media print`** | Al guardar como PDF se ocultan sidebar, navegación, filtros y botones: queda el reporte. |

## O. Aplicado a dos módulos

**Calidad** (23 reportes, 8 grupos) — migrado al motor. Se implementaron aquí:

- *Cumplimiento general* y *Por cláusula* (con filtro por estado)
- ***Ranking de capítulos*** — nuevo
- ***Tendencia de un indicador*** — **nuevo, y es el que la v12.0 daba por imposible.** Sale de `listarIndicadoresSgc` sin tocar el backend: dibuja la serie, la línea de meta, y la tabla de lecturas.

**Administración** (6 reportes, 3 grupos) — segundo módulo, prueba de que el motor se reutiliza sin reescribir nada:

- *Entregabilidad* y *Fallas por evento*, agregando `LOG_NOTIFICACIONES`
- *Estado del esquema*, de `getEstadoSistema`
- *Cuentas por módulo*, de `listarCuentasPortal`

## P. Verificación de la v12.2

- Tendencia: 6 períodos, línea de meta, selector entre indicadores, tabla y pie accesible; cambiar de indicador recalcula meta y serie.
- Ranking: ordenado de mayor a menor, verificado programáticamente.
- Filtros: en *Por cláusula* se muestra **sólo** el filtro declarado (`estado`); aplicarlo llevó la tabla de 28 a 23 filas, todas "Faltante".
- **Exportación CSV**: el contenido coincide exactamente con lo filtrado en pantalla (24 líneas = 23 filas + encabezado).
- *Entregabilidad* sin logs muestra el estado vacío, **no datos de ejemplo**.
- 12 rutas recorridas, cero errores JS. 1197/1197 tests.

**Falso positivo que conviene no repetir:** medir scroll horizontal con `scrollWidth > clientWidth` da un falso positivo cuando hay un elemento `position:fixed` a ancho completo: la diferencia es el ancho de la barra de scroll (`innerWidth − clientWidth`). La comprobación válida es intentar `window.scrollTo(500,0)` y ver si `scrollX` queda en 0.

## Q. Pendientes tras la v12.2 (Fase 3)

- **Reportes para Bandeja, Gerencia, Jefatura y Proyectos.** Los datos están (`SUBSOLICITUDES`, `HISTORIAL_*`, `ACTIVIDADES_BITACORA`); falta declarar sus catálogos. Gerencia y Jefatura *son* casi enteramente reportes: ahí es reorganizar, no agregar.
- **Los reportes que la auditoría destrabó y todavía no están construidos:** cumplimiento de SLA por área y por responsable, tiempo de ciclo por estado, resbalón de fechas comprometidas, throughput mensual. Todos salen de `SUBSOLICITUDES` + `HISTORIAL_*`.
- **Foto periódica de la cobertura ISO** — sigue siendo el único bloqueo real para comparar períodos en Calidad.
- **Filtros contra el backend.** Hoy los filtros se aplican en el cliente sobre datos ya traídos. Sirve para volúmenes actuales; con muchas filas habrá que filtrar en origen.

---

# v12.3 — FASE 3: Gerencia, el módulo que ya era un centro de reportes

## R. Lo que la auditoría encontró en Gerencia

`getPanelGerencia` **ya calculaba casi todo** lo que la v12.2 dejó como pendiente:

| Ya venía en la respuesta | Desde |
|---|---|
| `items[]` con `area_nombre`, `desarrollador_nombre`, `cumplimiento`, `dias_abierta`, `dias_desarrollador`, `re_compromisos`, `reaperturas`, `fecha_original` | v3.0 / v4.1 |
| `tendencia` — seis meses de creadas / cerradas / entregados / a tiempo | v4.1 (G3) |
| `ciclo_por_etapa` — dónde se va el tiempo | v4.1 (G4) |
| `carga` — por empresa, plataforma y área | v4.1 (G6) |
| `recurrencia` — ranking módulo × tipo | v4.1 (G2) |
| `kpis.comparativo` — variación vs la ventana anterior | v4.1 (G7) |

**Los tres reportes "nuevos" no piden nada al backend.** Estaban en la respuesta desde la v4.1; lo que faltaba era mirarlos así.

## S. Gerencia migrada

Sus **siete pestañas horizontales** eran navegación de módulo (vistas analíticas completas), no pestañas sobre una entidad. Aplicaba el mismo criterio que en Calidad y Administración, así que pasan a la navegación vertical:

```
Gerencia
├── Seguimiento
│   ├── Tablero de seguimiento
│   └── Línea de tiempo
├── Operación
│   ├── Actividades
│   └── Pausas activas
└── ★ Reportes
    ├── Centro de reportes
    ├── Tendencia y ciclo
    ├── Recurrencia
    └── Carga
```

Tendencia, Recurrencia y Carga quedan **dentro de Reportes** y no sueltas entre las vistas de trabajo: son reportes. Siguen siendo ítems propios de la navegación además de estar en el catálogo, para que al entrar a una de ellas la navegación marque dónde estás.

## T. Los ocho reportes de Gerencia

**Cumplimiento**
- *Por área* y *Por responsable* — miden sólo sobre lo **entregado con fecha comprometida**. Un ítem sin comprometer no cuenta como incumplido: todavía no hay promesa que romper, y meterlo hundiría el porcentaje de quien recién recibió trabajo. Quien no tiene entregas aparece como "sin entregas", no como 0%.
- *Resbalón de compromisos* — ítems que movieron fecha (`re_compromisos`) o se reabrieron (`reaperturas`). La reapertura es la medida de "se entregó mal" que el % de cumplimiento no captura: un cierre rápido que se reabre tres veces igual cuenta como "a tiempo".

**Evolución**
- *Entrada vs salida por mes* — dos series y el **saldo de la cola**: positivo significa que entra más de lo que sale.
- *Tendencia y ciclo*, *Recurrencia*, *Carga* — navegan a las vistas que ya existían, no las duplican.

**Comparación**
- *Período actual vs anterior* — ver abajo.

## U. Un error propio que el dato corrigió

Asumí que `kpis.comparativo` traía `{actual, anterior}` por indicador. **No**: trae la **variación ya calculada** (`actual − anterior`), y además sobre las dos ventanas de comparación, mientras la banda de KPIs se calcula sobre el conjunto completo.

Mi primera versión buscaba `.actual`/`.anterior`, no los encontraba y mostraba *"No hay indicadores comparables"* — **un vacío que mentía**: sí había datos.

La corrección no fue sólo leer bien el campo. Restar la variación del KPI de la banda para "recuperar" el valor anterior habría dado un número de otro universo: **sería inventarlo**. El reporte ahora muestra la variación, dice explícitamente qué dos ventanas compara y con qué fechas, y distingue `null` ("una de las dos ventanas no tenía datos") de cero ("igual que la ventana anterior"). El sentido de cada indicador está declarado: en *atrasadas activas* bajar es bueno; en *cumplimiento* es al revés.

## V. Verificación de la v12.3

- **8 vistas** de Gerencia: exactamente un panel visible en cada una, la navegación marca la correcta, la URL sigue el cambio, cero errores JS.
- **5 reportes** ejercidos: los que no tienen datos muestran el estado vacío **con la razón** ("Ningún área tiene todavía entregas con fecha comprometida"), no un 0% falso.
- *Entrada vs salida*: 2 gráficos, 6 meses, saldo `+5`.
- *Período actual vs anterior*: fechas reales de ambas ventanas, `sin comparación` donde el backend manda `null`, `+5 → Empeora` en "sin comprometer" (donde subir es malo).
- Enlace directo `#/gerencia/reportes` con recarga.
- Funciona igual en `app.html`, donde `SigsoShell` no existe: degrada sin romperse.
- 1197/1197 tests.

**Defecto encontrado al verificar:** entrar por enlace directo a `#/gerencia/reportes` dejaba fijo el "Esperando los datos del panel". El catálogo se pintaba antes que `panelActual` y nadie lo volvía a mirar. `renderTodo_` ahora lo repinta al llegar los datos.

## W. Pendientes tras la v12.3

- **Proyectos y Jefatura** sin submódulo Reportes. Jefatura es "Gerencia acotado al equipo": puede reusar los mismos cuerpos de reporte casi sin cambios.
- **Bandeja** — su `exportarCSV_` propio podría pasar al motor.
- **Los filtros del motor no están conectados en Gerencia**: los reportes usan el conjunto que ya trajo el panel, que respeta los filtros de la barra superior. Es coherente, pero los filtros por período/área del motor todavía no se aplican ahí.
- **Foto periódica de la cobertura ISO** — sigue siendo el único bloqueo real para comparar períodos en Calidad.

---

# v12.4 — Fase 3 (cont.): Jefatura, Proyectos y la regla compartida

## X. La agregación de cumplimiento sube al motor

Gerencia y Jefatura necesitaban la misma medición. Se promovió a `SigsoReportes`:

```js
SigsoReportes.agruparCumplimiento(items, campo, etiquetaVacia)
SigsoReportes.tablaCumplimiento(filas, dimension)
SigsoReportes.cuerpoCumplimientoPor(items, { campo, etiquetaVacia, dimension, etiquetaTotal })
SigsoReportes.cuerpoEntradaSalida(serie)
```

**No es sólo ahorro de código.** Si un panel midiera el cumplimiento distinto que el otro, un jefe y Gerencia verían números distintos del mismo equipo y no habría forma de saber cuál creer. La regla vive en un solo lugar:

> Se mide **sólo** sobre lo entregado **con fecha comprometida**. Un ítem sin comprometer no cuenta como incumplido — no hay promesa que romper todavía, y meterlo hundiría el porcentaje de quien recién recibió trabajo. Quien no tiene entregas queda en `pct = null`, que se muestra como **"sin entregas"** y nunca como 0%.

`gerencia.js` perdió 99 líneas al pasar a usarlo.

## Y. Jefatura — "Mi Departamento"

Sus **4 pestañas** pasan a navegación vertical (mismo criterio: navegación de módulo).

```
Mi Departamento
├── Mi equipo
│   ├── Tablero
│   ├── Por persona
│   └── Actividades del equipo
└── ★ Reportes
    ├── Centro de reportes
    └── Carga por módulo y tipo
```

**6 reportes, 5 disponibles:** cumplimiento por persona, por módulo y por tipo (los tres con los cuerpos del motor), entrada vs salida por mes, y carga.

*Resbalón de compromisos* queda **PENDIENTE con el motivo exacto**: `getPanelJefatura` no devuelve `re_compromisos` ni `reaperturas`, que Gerencia sí calcula. Es una diferencia real entre dos endpoints, y decirlo vale más que omitir la ficha.

## Z. Proyectos

Aquí la decisión fue **no** tocar las 7 pestañas del detalle de un proyecto: son pestañas sobre una **entidad**, no navegación de módulo. Lo que sí es navegación de módulo son sus dos destinos:

```
Proyectos
├── Portafolio
└── ★ Reportes
```

Verificado que dentro de un proyecto la navegación de módulo queda al lado y las 7 pestañas de la entidad siguen intactas.

**5 reportes, 4 disponibles:** salud del portafolio (con los motivos de cada proyecto no sano), avance por proyecto, plazos (vencidos y por vencer en 30 días, **excluyendo cerrados y cancelados** — un proyecto cerrado con fecha pasada no es un atraso) y carga por líder.

*Cumplimiento de tareas* queda PENDIENTE: `listarProyectos` devuelve el **conteo** de tareas, no sus fechas.

## AA. Un defecto que la inicialización escondía

`proyectosPortafolioSinFiltrarSalud_` arranca en `[]`, no en `null`. Mi primera guarda (`if (!lista)`) para "todavía no cargué" **nunca se habría cumplido**, y entrar directo por URL a Reportes habría mostrado un portafolio vacío como si esa fuera la respuesta real. Se resolvió con una bandera propia `portafolioCargado_`: una lista vacía legítima y "aún no pedí" son estados distintos y no pueden compartir representación.

## AB. Verificación de la v12.4

- **13 rutas** recorridas, cero errores JS.
- Scroll horizontal medido **de verdad** (`scrollTo(500,0)` y ver si `scrollX` queda en 0), no con `scrollWidth`: **ninguna ruta se desplaza**.
- Gerencia: sus 5 reportes siguen funcionando tras quitarle las funciones que se fueron al motor.
- Jefatura: catálogo de 6, tres reportes ejercidos.
- Proyectos: catálogo de 5, cuatro reportes ejercidos; portafolio y detalle intactos.
- **`#/jefatura/reportes` desde una cuenta sin ese módulo cae a Home** — la comprobación de permisos por URL sigue en pie.
- 1197/1197 tests.

## AC. Estado final de la arquitectura

| Módulo | Navegación vertical | Submódulo Reportes |
|---|---|---|
| Calidad | ✅ 9 submódulos | ✅ 23 reportes |
| Administración | ✅ 6 submódulos | ✅ 6 reportes |
| Gerencia | ✅ 3 submódulos | ✅ 8 reportes |
| Jefatura | ✅ 2 submódulos | ✅ 6 reportes |
| Proyectos | ✅ 2 destinos | ✅ 5 reportes |
| Novedades | ✅ 4 destinos | ✅ 1 reporte |
| Coordinación | ✅ 3 destinos | ✅ 1 reporte |
| Bandeja | ❌ | ❌ |

**Bandeja** es lo único que queda: es una cola de trabajo más que un módulo analítico, y su `exportarCSV_` propio podría pasar al motor.

## AD. Pendientes reales (no cosméticos)

1. **Los filtros del motor no están conectados** en Gerencia, Jefatura ni Proyectos: sus reportes usan el conjunto que ya trajo el panel. Es coherente (respeta los filtros de la barra superior), pero el período y el área del motor todavía no operan ahí.
2. **`re_compromisos`/`reaperturas` en `Jefatura.getPanel`** — desbloquearía el resbalón para jefes.
3. **Tareas con fechas en `listarProyectos`** — desbloquearía el cumplimiento por proyecto.
4. **Foto periódica de la cobertura ISO** — sigue siendo el único bloqueo para comparar períodos en Calidad.
5. Los filtros se aplican **en el cliente**; con más volumen habrá que filtrar en origen.

---

# v13.0 — CORRECCIÓN: el árbol va en la barra lateral, no en el contenido

## AE. Qué estaba mal

La v12 leyó bien la jerarquía Módulo → Submódulo → Ítem, pero la puso **en el lugar equivocado**: una columna de acordeones dentro del contenido, a la izquierda del panel. Debía vivir en la **barra azul**.

El síntoma de que estaba mal: había **dos navegaciones**. El sidebar listaba módulos y el contenido volvía a listar las secciones de ese módulo.

```
ANTES                                AHORA
sidebar: Calidad                     sidebar: ▼ Calidad
contenido: [acordeones] | panel                  Inicio
                                                 Sistema de Gestión
                                                 Documentación
                                                    · Lista maestra
                                     contenido: sólo la pantalla
```

## AF. `SigsoNav.renderArbol` — tres niveles en el sidebar

| Nivel | Qué es | Cómo se lee |
|---|---|---|
| 1 | Módulo | El ítem del sidebar de siempre, + chevron si tiene árbol |
| 2 | Submódulo | Indentado, con línea vertical que lo cuelga del módulo |
| 3 | Ítem | Más indentado, punto, menor peso; el activo lleva punto lleno **y** negrita |

**Un módulo sin árbol registrado sigue siendo un enlace simple.** No se le inventa jerarquía: Bandeja, Mi trabajo, Pausas, Nueva solicitud y Mis solicitudes se comportan igual que antes.

### El contrato

```js
SigsoNav.registrar('calidad', { nombre, submodulos, visible });  // el módulo declara
SigsoNav.renderArbol({ contenedor, modulos, moduloActivo, itemActivo, onModulo, onItem });
SigsoShell.refrescarArbol();   // el módulo avisa que cambiaron sus permisos
SigsoShell.publicarItem(id);   // el módulo avisa dónde quedó
```

El árbol **no decide permisos**: cada módulo registra su predicado `visible` y el árbol lo obedece. Un ítem sin permiso no se dibuja; un submódulo sin ítems visibles tampoco.

## AG. Módulos migrados (todos los que tienen jerarquía)

| Módulo | Submódulos en el sidebar |
|---|---|
| Calidad | Inicio · Sistema de Gestión · Planificación · Documentación · Personas · Operación · Control y mejora · **Reportes** · Administración |
| Administración | Organización · Catálogos · Accesos · Comunicaciones · Operación · **Reportes** |
| Gerencia | Seguimiento · Operación · **Reportes** |
| Jefatura | Mi equipo · **Reportes** |
| Proyectos | Portafolio · **Reportes** |
| Novedades | Publicadas · Por aprobar · Mis envíos · **Reportes** |
| Coordinación | Hoy · Historial · **Reportes** |

**Reportes es navegable desde el sidebar**: en Calidad se despliega en Centro de reportes, Cumplimiento general, Por cláusula, Ranking de capítulos, Tendencia de indicador y Estado documental. Sólo se listan los que se **arman ahí**; los que viven en su propia sección ya están en el árbol por su cuenta, y duplicarlos daría dos caminos al mismo sitio.

## AH. Las 7 pruebas del encargo

| Prueba | Resultado |
|---|---|
| 1. Clic en Calidad → se expande **en la barra azul** | OK, 9 submódulos |
| 2. Clic en Documentación → se expande debajo, en la barra | OK, `aria-expanded=true`, 5 ítems |
| 3. Clic en Lista maestra → cambia el contenido | OK, + hoja marcada activa |
| 4. Sin navegación horizontal duplicada arriba | OK, **0** elementos de nav en el contenido |
| 5. Clic otra vez en Documentación → se contrae | OK, 0 hijos visibles |
| 6. Clic otra vez en Calidad → se contrae todo | OK, 0 submódulos |
| 7. URL directa → el sidebar se abre solo | OK, `#/calidad/documentos:PRO` abre Calidad → Documentación → Procedimientos |

## AI. Dos defectos encontrados al verificar

**Los badges se perdían al primer clic.** Los contadores se piden una vez al entrar, pero el árbol se repinta cada vez que se abre o cierra una rama. Se resolvió recordándolos (`badgesRecordados_`).

**En móvil el drawer abría vacío de submódulos.** La regla que oculta el árbol con el sidebar colapsado también se aplicaba al drawer — y `--colapsado` se recuerda entre sesiones. Quien hubiera colapsado el menú en el escritorio abría el drawer en el teléfono y **no veía ningún submódulo**. Corregido acotando la regla con `:not(--abierto)`. Verificado: las 28 hojas tienen ancho real en el drawer de 375px.

## AJ. Verificación

- Permisos: un **OPERATIVO** del SGC ve **9 de 28 ítems** — se le ocultan Reportes completo, Accesos, Riesgos, Indicadores, Auditorías y el resto del gobierno.
- Scroll independiente del sidebar: `overflow-y: auto`, 1887px de contenido en 528px de alto.
- Colapsada: el árbol se oculta y al expandir vuelve con la rama y la hoja activa donde estaban.
- Móvil 375px: drawer con el árbol completo, sin scroll horizontal.
- 1197/1197 tests.

**Nota de método:** medir el ancho de la sidebar colapsada dio 240px en lugar de 68px. **No era un fallo**: el panel del navegador de esta sesión no compone frames, así que la transición CSS queda congelada en el valor inicial. Al desactivar la transición midió 68px. Un `getAnimations().length === 1` permanente es la señal.

## AK. Qué NO cambió

Backend, datos, permisos y lógica de negocio quedaron intactos: la corrección es de arquitectura de navegación y UI. Las pestañas **sobre una entidad** (las 7 de un proyecto, la ficha de una persona, la sub-nav de Accesos) siguen donde estaban: no son navegación de módulo.
