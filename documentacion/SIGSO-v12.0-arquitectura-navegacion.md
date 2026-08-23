# SIGSO v12.0 — Arquitectura de navegación Módulo → Submódulo → Ítem

Fecha: 2026-08-23 · Estado: **Fase 2 y 3 entregadas (base + Calidad). Fases 4-6 parciales.**

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
