# SIGSO v9.0 — Propuesta: Módulo de Gestión de Proyectos Internos

> **Estado:** propuesta para aprobación. **No se ha escrito código de implementación.**
> Documento de auditoría + arquitectura, siguiendo el mismo formato que las
> propuestas previas (v4.2 Jefatura, v7.0 Gestión Operacional).

---

## 0. Resumen ejecutivo — la decisión que lo cambia todo

SIGSO **ya tiene el motor de un gestor de tareas**, y es muy completo:
`Actividades.gs` (v7.0, "Gestión Operacional"). No es un TODO simple: es una
máquina de estados con check-in de un clic, bloqueos, validación del
supervisor, reasignación, recurrencia, **historial de avance** (cada check-in
guarda `avance_pct` en la bitácora → la línea "15/08 20% → 16/08 40% → …" ya
existe), semáforo de urgencia, cálculo de alertas, panel de Gerencia con KPIs +
mapa de calor, y 3 motores de reporte. Y su hoja `ACTIVIDADES` **ya trae los
campos `proyecto` y `solicitud_id`**.

**Por lo tanto, la recomendación central es:**

> **NO crear una entidad "tarea de proyecto" nueva.** Las tareas de un proyecto
> **son** `ACTIVIDADES`, extendidas con `proyecto_id` y `hito_id`. El módulo de
> Proyectos es una **capa contenedora + sala de trabajo + tablero** encima del
> motor que ya existe. Esto evita duplicar ~1.200 líneas de lógica ya probada
> (751 tests verdes) y le da al nuevo módulo, gratis: check-in ligero, estados,
> bloqueos, historial de avance, semáforo, alertas, reasignación, recurrencia,
> "Mi trabajo", KPIs y reportes.

Todo lo nuevo (Proyectos, integrantes, hitos, sala, entregables, riesgos) se
apoya en los patrones que SIGSO ya usa: bitácora unificada, gate por módulo +
alcance por membresía, notificación viva + correo agrupado, HTML→PDF, LOG_SISTEMA.

---

## A. Arquitectura actual de SIGSO (diagnóstico)

**Dos proyectos Apps Script separados** (duplicación deliberada del núcleo):
- **Intake** (`backend/intake/`): formulario público + login del portal.
- **Backoffice** (`backend/backoffice/`): toda la gestión interna. **El módulo
  de Proyectos vive solo aquí** (es 100% interno → sin duplicación en Intake).

**Transporte / identidad.** POST `text/plain`, cuerpo JSON, sin headers custom.
La identidad se resuelve de dos formas y ambas terminan en un `contexto`
uniforme `{ email, rol, modulos, cuenta_id, via_portal }`:
1. **Login Google** → `email` → hoja `USUARIOS` → `rol`.
2. **Token de portal** → `portal_token` en el body → `SESIONES_PORTAL` →
   `CUENTAS_PORTAL` → `rol` + **`modulos`** (lista de módulos habilitados).

**Almacenamiento.** Google Sheets (~40 hojas). Repositorio: `leerFilas_` /
`leerFilasSeguro_` (lee por nombre de encabezado), `agregarFila_` (escribe por
el encabezado REAL de la hoja), `actualizarFilaPorId_`, con **caché por
request**. IDs vía `Utilities.getUuid()` (sin contador → sin lock).

**Frontend.** GitHub Pages. `plataforma.html` = **el shell** (sidebar navy +
módulos, v8.0). `index.html`/`estado.html` = público. `App.html`/`Admin.html` =
bundles embebidos para el Backoffice con login Google (se generan de
`app.html`/`admin.html` con `build-backoffice-html.js`). Design system central:
`tokens.css` (v8.0 navy `#14213D` + azul `#2A5FD6`), `components.css`.

**Sistema de módulos (clave para integrarse).**
- `MODULOS_SHELL` (en `plataforma.js`) registra cada módulo del sidebar:
  `{ icono, nombre, descripcion, interno }`. Hoy: bandeja, gerencia, jefatura,
  administracion, pausas, pausas_coordinacion, novedades, mi_trabajo.
- Cada cuenta de portal tiene un array `modulos`.
- `MODULO_POR_ACCION` (en `Code.gs`) es el **gate grueso**: mapea cada acción a
  un módulo (o lista de módulos). Ej. `checkinActividad: 'mi_trabajo'`,
  `panelEquipoActividades: 'jefatura'`.
- El **gate fino** vive dentro de cada módulo: Actividades acota por
  `JEFATURAS` (tu equipo), Novedades por `CAT_AREAS.responsable_email`. Ese es
  el patrón a seguir: módulo como puerta gruesa + membresía como puerta fina.

**Roles.** `SOL/SOLICITANTE`, `ANA` (analista), `DEV` (desarrollador), `ADM`,
`GERENCIA` (solo lectura), `JEFATURA`. Una cuenta portal `SOLICITANTE` con
módulo 'bandeja' se normaliza a `DEV`.

**Jerarquía de equipo.** Hoja `JEFATURAS` (`jefe_email`, `subordinado_email`,
`activo`). Helpers `obtenerEquipoJefe_`, `jefeDeSubordinado_`.

**Trazabilidad / auditoría.** `LOG_SISTEMA` (log genérico), `LOG_NOTIFICACIONES`,
historiales por entidad. Actividades usa **una** bitácora (`ACTIVIDADES_BITACORA`)
en vez de 4 hojas `HISTORIAL_*` — decisión deliberada de v7.0, y el patrón que
adoptaremos.

**Notificaciones.** Dos canales transversales, ya reutilizables desde cualquier
módulo: `encolarNotificacionApp_` (viva, hoja `NOTIFICACIONES_APP`) y
`enviarCorreo_` (correo branded, con `CONFIG_NOTIFICACIONES` para apagar
canales). Regla de oro heredada de Novedades/Actividades: **un solo correo
diario por persona, agrupando todo.**

**Documentos / archivos.** `ARCHIVOS` (hoy acotada a `solicitud_id` /
`subsolicitud_id`) + subida a Drive por carpeta de solicitud (`Drive.subirArchivo`).

**Presupuesto de triggers.** GAS permite **máximo 20 triggers de tiempo; SIGSO
ya está en 20.** Cualquier automatización nueva **no puede crear un trigger
propio** — debe colgarse del trigger diario de las 09:00 (como ya hace
`Actividades.calcularAlertas`) o calcularse on-read.

---

## B. Funcionalidades reutilizables (el corazón de la propuesta)

| Necesidad del módulo Proyectos | Qué ya existe en SIGSO | Cómo se reutiliza |
|---|---|---|
| **Tareas** (estados, avance, responsable, bloqueo, revisión) | `ACTIVIDADES` + máquina de estados completa | **Extender** `ACTIVIDADES` con `proyecto_id` + `hito_id`. Cero motor nuevo. |
| **Historial de avance** (20%→40%→…) | `ACTIVIDADES_BITACORA` guarda `avance_pct` en cada check-in | Se lee tal cual por tarea. |
| **"¿Qué hiciste hoy?"** (check-in ligero) | `Actividades.checkin` (avance/sin_cambio/bloqueo/listo) | La misma acción; "Mi trabajo" ya es la pantalla. |
| **Bloqueos** | Campos `bloqueo_motivo/responsable/desde` + estado `BLOQUEADA` en ACTIVIDADES | Reuso directo; se agregan a nivel proyecto (agregación). |
| **Solicitudes del líder** ("actualiza", "acelera") | `Actividades.pedirActualizacion` (correo + notif viva + bitácora) | Se generaliza a "solicitud del líder" con tipos. |
| **Reasignar** | `Actividades.reasignar` | Reuso directo (acota a integrantes del proyecto). |
| **Semáforo / urgencia** | `semaforoActividad_` | Reuso por tarea; la salud del proyecto lo agrega. |
| **Alertas (sin novedad, vencidas, bloqueo estancado)** | `Actividades.calcularAlertas` (cuelga del trigger 09:00) | Se extiende con alertas de proyecto en la misma pasada. |
| **KPIs + carga por persona + heatmap** | `getPanelGerenciaActividades` | Base del dashboard gerencial de portafolio. |
| **Reportes PDF** | `ReporteActividades.gs` + `OrdenTrabajo.gs` (HTML→PDF) | Motor de "reporte semanal del proyecto" y "resumen ejecutivo". |
| **Permisos** | `MODULO_POR_ACCION` (gate grueso) + membresía (gate fino) | Nuevos módulos `proyectos`; roles de proyecto en su hoja de integrantes. |
| **Equipo / jerarquía** | `JEFATURAS` + helpers | Para defaults de supervisor; la membresía del proyecto es su propia tabla. |
| **Notificaciones** | `encolarNotificacionApp_` + `enviarCorreo_` | Reuso directo (agrupadas). |
| **Auditoría** | `LOG_SISTEMA` + bitácora | Bitácora del proyecto = feed de la sala. |
| **Sala / feed / comentarios** | Patrón bitácora (`ACTIVIDADES_BITACORA`) + feed de Novedades | Nueva hoja `PROYECTO_EVENTOS` con el mismo patrón (append-only, tipado). |
| **Archivos** | `ARCHIVOS` + subida a Drive | **Generalizar** `ARCHIVOS` con `entidad_tipo`/`entidad_id` (o `proyecto_id`). |
| **Notif. de mención / navegación a módulo** | `NOTIFICACIONES_APP.modulo_id` + `texto_accion` | Reuso directo. |

**Lo que NO se duplica:** ni tareas, ni comentarios (la sala los cubre), ni
archivos, ni notificaciones, ni permisos, ni auditoría, ni reportes.

---

## C. Problemas y riesgos técnicos

1. **Presupuesto de triggers agotado (20/20).** → Sin triggers nuevos: las
   alertas de proyecto se calculan en la misma pasada de `calcularAlertas`
   (09:00); la salud se calcula **on-read** (barata, cacheable).
2. **Límite de 6 min por ejecución.** El portafolio de gerencia sobre muchos
   proyectos × tareas puede ser pesado → cachear (ya se usa `CacheService`
   para el panel de Gerencia), leer con la caché por request, y paginar por
   estado (activos primero).
3. **Escalabilidad de Sheets (filas).** `ACTIVIDADES` y `PROYECTO_EVENTOS`
   crecen. Mitigación: feed append-only (barato de leer con caché); **archivar
   proyectos cerrados** (`activa=false`) para que las lecturas por defecto no
   los recorran.
4. **Consistencia de estado.** Nada de contadores nuevos → `Utilities.getUuid()`
   evita locks. La salud es derivada (no un campo que se pueda desincronizar).
5. **No romper Actividades.** `proyecto_id`/`hito_id` son **aditivos** (columnas
   al final); una actividad sin proyecto sigue funcionando exactamente igual
   ("Mi trabajo" personal). Cero regresión sobre los 751 tests.
6. **Riesgo de sobre-diseño (el más importante para el producto).** El pedido es
   enorme (31 áreas). La disciplina: MVP que se apoye en el motor existente y
   entregue valor real; lo demás por fases, cada cosa justificada.

---

## D. Arquitectura propuesta

**Entidades nuevas (mínimas):**
- `PROYECTOS` — el contenedor.
- `PROYECTO_INTEGRANTES` — equipo + rol de proyecto (membresía = gate fino).
- `PROYECTO_HITOS` — hitos (agrupan tareas).
- `PROYECTO_EVENTOS` — **la sala**: feed append-only tipado (actualización,
  comentario, decisión, reunión, bloqueo, solicitud del líder, cambio de
  estado…). Patrón bitácora unificada.
- `PROYECTO_ENTREGABLES` — entregables con flujo aprobar/observar.
- `PROYECTO_RIESGOS` — registro de riesgos.

**Entidad extendida:** `ACTIVIDADES` += `proyecto_id`, `hito_id`, `colaboradores`
(CSV opcional), `depende_de` (actividad_id opcional).

**Relaciones:**
```
PROYECTO 1─┬─* PROYECTO_INTEGRANTES (usuario + rol de proyecto)
           ├─* PROYECTO_HITOS 1─* ACTIVIDADES (tareas, vía proyecto_id/hito_id)
           ├─* PROYECTO_EVENTOS (sala: updates, decisiones, reuniones, bloqueos)
           ├─* PROYECTO_ENTREGABLES
           ├─* PROYECTO_RIESGOS
           └─* ARCHIVOS (generalizada) / LOG_SISTEMA (auditoría)
SOLICITUD ─(opcional)→ PROYECTO   (una solicitud grande puede volverse proyecto)
```

**APIs (acciones nuevas en Code.gs).** Nomenclatura y contrato idénticos al
resto (`errorValidacion_` / `_forbidden`). Ejemplos:
`listarProyectos`, `crearProyecto`, `getProyectoDetalle`, `actualizarProyecto`,
`gestionarIntegrante`, `gestionarHito`, `publicarEnSala`, `comentarSala`,
`convertirEventoEnTarea`, `gestionarEntregable`, `revisarEntregable`,
`gestionarRiesgo`, `solicitudLider`, `getPortafolio`, `getCargaTrabajo`,
`getSaludProyecto`, `generarReporteProyecto`. Las tareas siguen usando las
acciones de `ACTIVIDADES` que ya existen (`crearActividad`, `checkinActividad`,
`reasignarActividad`, …) + `proyecto_id`.

**Permisos (gate grueso, en MODULO_POR_ACCION):**
- `proyectos` — trabajar en proyectos donde soy integrante (crear/ver/actuar
  según rol de proyecto).
- `getPortafolio`/`getCargaTrabajo` → aceptan `['proyectos','gerencia']`
  (mismo patrón que `getSolicitudDetalle`).
- El **gate fino** (líder vs integrante vs observador) lo aplica el backend por
  `PROYECTO_INTEGRANTES`, igual que Actividades usa JEFATURAS.

**Navegación.** Un nuevo módulo `proyectos` en `MODULOS_SHELL`
(icono "carpeta/tablero", `interno:true`, layout ancho). El portafolio y la
sala del proyecto viven dentro del shell (`frontend/js/proyectos.js`),
reutilizando componentes de `components.js`.

---

## E. Modelo de datos (hojas nuevas y deltas)

**`PROYECTOS`**
`proyecto_id, codigo, nombre, descripcion, objetivo, resultado_esperado,
lider_email, area_id, cliente_id, categoria, prioridad, estado,
fecha_inicio, fecha_objetivo, fecha_cierre_real, avance_pct_manual,
salud_override, ultima_actualizacion, creado_por, fecha_creacion, activa`

- `estado`: `PLANIFICACION | ACTIVO | EN_PAUSA | EN_REVISION | CERRADO | CANCELADO`
  (mayúsculas, como `ACTIVIDADES_ESTADOS`; "CERRADO" alinea con "Cerrada" S09).
- `salud_override`: normalmente vacío → la salud se **calcula**; sólo un ADM/
  líder puede fijarla a mano de forma excepcional (con motivo en la bitácora).
- `avance_pct_manual`: opcional; por defecto el avance es **derivado** de las
  tareas (ver KPIs).

**`PROYECTO_INTEGRANTES`**
`integrante_id, proyecto_id, usuario_email, rol_proyecto, responsabilidad,
activo, agregado_por, fecha`
- `rol_proyecto`: `LIDER | INTEGRANTE | COLABORADOR | OBSERVADOR`.

**`PROYECTO_HITOS`**
`hito_id, proyecto_id, nombre, descripcion, fecha_objetivo, estado, orden,
fecha_creacion`

**`PROYECTO_EVENTOS`** (la sala — bitácora unificada)
`evento_id, proyecto_id, tipo, autor_email, autor_nombre, titulo, cuerpo,
ref_tipo, ref_id, menciones, timestamp`
- `tipo`: `ACTUALIZACION | COMENTARIO | DECISION | REUNION | BLOQUEO |
  SOLICITUD_LIDER | CAMBIO_ESTADO | ENTREGABLE | RIESGO`.
- `ref_tipo`/`ref_id`: enlaza el evento a una tarea, hito o entregable.

**`PROYECTO_ENTREGABLES`**
`entregable_id, proyecto_id, hito_id, nombre, descripcion, responsable_email,
fecha_comprometida, estado, url_evidencia, fecha_entrega_real,
revisado_por, resultado_revision, observaciones, fecha_creacion`
- `estado`: `PENDIENTE | ENTREGADO | EN_REVISION | APROBADO | OBSERVADO`.

**`PROYECTO_RIESGOS`**
`riesgo_id, proyecto_id, descripcion, probabilidad, impacto, nivel,
responsable_email, mitigacion, estado, fecha_creacion`

**Delta a `ACTIVIDADES`** (aditivo, columnas al final):
`+ proyecto_id, hito_id, colaboradores, depende_de`

**Delta a `ARCHIVOS`** (para no duplicar el sistema de archivos):
`+ entidad_tipo, entidad_id` (o `proyecto_id`, `tarea_id`) — Fase 2.

Todas las hojas se crean por el **Instalador** con el patrón de siempre; los
deltas son aditivos → sin migración destructiva.

---

## F. Flujo de usuario (de punta a punta)

```
Crear proyecto (líder/ADM)
  → agregar equipo + roles de proyecto
  → definir objetivo y resultado esperado
  → crear hitos (Levantamiento, Diseño, Implementación, Cierre)
  → crear tareas dentro de cada hito  ── (= ACTIVIDADES con proyecto_id/hito_id)
        · el integrante confirma su compromiso (RN-710 ya existe)
  → TRABAJO DIARIO
        · integrante: check-in de un clic en "Mi trabajo"
          (avance % / sin cambios / bloqueo / listo)  ── motor existente
        · sala: publica avances, decisiones, adjunta documentos, @menciona
        · líder: pide actualización / acelera / revisa (solicitud del líder)
  → REVISIÓN
        · tareas que requieren validación → EN_REVISION → líder aprueba/devuelve
        · entregables → líder APRUEBA u OBSERVA (devuelve con motivo)
  → DETECCIÓN DE PROBLEMAS
        · salud del proyecto (🟢/🟡/🔴) recalculada, con motivos explícitos
        · bloqueos, vencidos, sin actualización, hitos atrasados → "requiere atención"
  → CIERRE (proceso, no un toggle)
        · checklist: entregables aprobados, objetivos cumplidos, pendientes,
          lecciones aprendidas, documentos finales → estado CERRADO + fecha real
        · toda la trazabilidad histórica se conserva (bitácora + eventos)
```

---

## G. Pantallas (UX/UI) — consistentes con SIGSO v8.0

1. **Portafolio** (tabla/tarjetas): nombre, líder, integrantes (avatares),
   estado, prioridad, **avance %**, fechas, **salud 🟢/🟡/🔴**, última
   actualización. Filtros por estado/área/salud. (Reusa `Componentes.avatar`,
   chips de estado, tablas de `components.css`.)
2. **Vista del proyecto** (la "sala de trabajo"), con pestañas:
   - **Resumen** — salud + motivos, avance real vs esperado, próximos
     vencimientos, "requiere tu atención".
   - **Sala** — feed cronológico (publicar, comentar, @mencionar, adjuntar,
     convertir comentario→tarea).
   - **Tareas** — lista/Kanban por estado, agrupadas por hito (= ACTIVIDADES).
   - **Hitos** — con avance y tareas asociadas.
   - **Entregables** — con aprobar/observar.
   - **Equipo** — integrantes + rol + carga.
   - **Riesgos / Decisiones** (Fase 3).
3. **Mi trabajo** (ya existe): las tareas de proyecto aparecen aquí junto a las
   demás; el check-in es idéntico. Cero pantalla nueva para el integrante.
4. **Vista del líder** — su proyecto con "requiere atención" arriba
   (vencidas, bloqueadas, sin actualización, entregables por revisar).
5. **Dashboard gerencial de portafolio** (Fase 3, dentro de 'gerencia'):
   activos / en riesgo / críticos / atrasados / sin actualización + **carga de
   trabajo por persona**.
6. **Móvil**: check-in, comentar, ver estado y notificaciones responsive (el
   shell ya lo es).

---

## H. Integraciones con módulos existentes

- **Actividades** → tareas del proyecto (extensión). El integrante trabaja desde
  "Mi trabajo" sin cambiar de contexto.
- **Solicitudes** → una solicitud grande puede **convertirse en proyecto**
  (`ACTIVIDADES.solicitud_id` ya vincula tarea↔solicitud). Fase 2.
- **Jefatura** → defaults de supervisor y alcance de equipo.
- **Gerencia** → el portafolio y la carga viven en el panel de Gerencia (read-only).
- **Notificaciones (viva + correo)** → menciones, asignaciones, solicitudes del
  líder, vencimientos, salud en rojo — agrupadas.
- **Perfiles** → avatares del equipo.
- **Drive / Archivos** → documentos del proyecto (ARCHIVOS generalizada).
- **Reportes HTML→PDF** → reporte semanal del proyecto y resumen ejecutivo.
- **LOG_SISTEMA** → auditoría de acciones importantes.

---

## I. Automatizaciones (respetando el presupuesto de triggers = 0 nuevos)

Todas cuelgan del **trigger diario 09:00** existente (misma pasada de
`calcularAlertas`) o se calculan on-read. Notificaciones **agrupadas** (un correo
diario por persona):
- Tarea vence mañana → recordar al responsable.
- Tarea vencida → marcar atraso (deriva del semáforo, no de un campo).
- X días hábiles sin actualización → pedir actualización.
- Tarea crítica atrasada → alertar al líder.
- Hito comprometido / atrasado → recalcular salud (on-read).
- Entregable observado → vuelve automáticamente al responsable (cambio de estado).
- Dependencia: si la tarea A se atrasa, marcar B como "potencialmente
  comprometida" (bandera derivada, no cascada automática de fechas).

Se evita automatización excesiva: nada mueve fechas ni cierra cosas solo.

---

## J. Indicadores (KPIs) — accionables, no decorativos + Salud explicable

**KPIs por proyecto:** avance real (derivado de tareas terminadas/hito) vs
avance esperado (lineal entre `fecha_inicio` y `fecha_objetivo`); % tareas
atrasadas; cumplimiento de entregables; días desde la última actualización;
bloqueos activos; desviación del cronograma; carga por integrante.

**KPIs de portafolio:** proyectos por salud, atrasados, sin actualización,
próximos a cerrar, **carga por persona** (tareas activas y suma de `tamano`
S/M/L/XL — la sobrecarga es "muchos L/XL", no solo conteo).

**Salud del proyecto (🟢/🟡/🔴) — lógica explicable, sin caja negra:**
```
Se calcula on-read a partir de señales objetivas y DEVUELVE SUS MOTIVOS:
  🔴 CRÍTICO   si: hito vencido | ≥1 tarea crítica (P1/P2) atrasada | bloqueo estancado
  🟡 EN RIESGO si: tareas atrasadas | integrante sin actualización N días |
                   avance real muy por debajo del esperado | entregable observado/vencido
  🟢 NORMAL    en otro caso
Ejemplo de salida:
  🟡 EN RIESGO — "2 tareas atrasadas · 1 hito comprometido · 3 días sin
  actualización de Juan"
```
Reutiliza `semaforoActividad_` por tarea + agregación. Un `salud_override` (con
motivo) permite corrección manual excepcional, pero **el default es calculado y
justificado.**

---

## K. Roadmap por fases + MVP recomendado

**MVP — Fase 1 (el corazón, apoyado en el motor existente):**
`PROYECTOS` + `PROYECTO_INTEGRANTES` + extensión de `ACTIVIDADES`
(`proyecto_id`/`hito_id`) + `PROYECTO_HITOS` + `PROYECTO_EVENTOS` (sala) +
Portafolio + Vista de proyecto (Resumen/Sala/Tareas/Hitos/Equipo) + salud
automática básica + check-in de tareas vía "Mi trabajo" (ya existe) +
notificaciones de mención/asignación (reuso). Módulo `proyectos` en el shell.

**Fase 2:** Entregables (aprobar/observar) · dependencias tarea↔tarea ·
generalizar `ARCHIVOS` (documentos del proyecto) · solicitud→proyecto ·
notificaciones de proyecto agrupadas en la pasada de alertas · solicitudes del
líder estructuradas.

**Fase 3:** Dashboard gerencial de portafolio · **carga de trabajo por persona**
(con `tamano`) · riesgos · decisiones/reuniones estructuradas (reunión→tareas) ·
reporte semanal del proyecto + resumen ejecutivo (HTML→PDF) · cronograma/timeline
ligero (estilo heatmap, si se justifica).

**Fase 4:** automatizaciones avanzadas (dentro del presupuesto) · métricas
históricas de cumplimiento · plantillas de proyecto · mejoras de productividad.

---

## L. Mejoras adicionales que propongo (como arquitecto/PM)

Cada una con problema / cómo / por qué / impacto / fase:

1. **Plantillas de proyecto.** *Problema:* proyectos del mismo tipo se arman
   desde cero. *Cómo:* clonar hitos + tareas base de una plantilla. *Impacto:*
   arranque en minutos, consistencia. *Fase 3–4.*
2. **Solicitud → Proyecto.** *Problema:* pedidos grandes no caben en una
   solicitud. *Cómo:* botón "convertir en proyecto" (ACTIVIDADES ya tiene
   `solicitud_id`). *Impacto:* integración natural con el core de SIGSO.
   *Fase 2.*
3. **Capacidad por `tamano` (no solo conteo).** *Problema:* "14 tareas" no dice
   si son triviales o enormes. *Cómo:* sumar `tamano` S/M/L/XL (ya existe) por
   persona. *Impacto:* detección real de sobrecarga. *Fase 3.*
4. **Estado semanal auto-borrador.** *Problema:* redactar el avance semanal
   consume tiempo. *Cómo:* el motor de reportes arma un borrador; el líder lo
   edita y publica a Gerencia. *Impacto:* menos fricción, más trazabilidad.
   *Fase 3.*
5. **Observadores para Gerencia** sin participar. *Cómo:* rol `OBSERVADOR` +
   lectura por módulo 'gerencia'. *Impacto:* visión ejecutiva sin ruido. *MVP/F1.*
6. **Reunión → tareas.** Un acuerdo de reunión se convierte en `ACTIVIDAD`
   (reuso del motor). *Fase 3.*

No se agregan por "hacer el módulo más grande": cada una resuelve algo concreto
y se apoya en piezas existentes.

---

## M. Principios respetados

1. No duplicar (tareas = ACTIVIDADES; comentarios = sala; archivos/notif/permisos/
   auditoría = reuso). 2. No romper módulos actuales (todo aditivo, 751 tests).
3. Analizar impacto antes de tocar estructuras. 4. Compatibilidad con usuarios
actuales. 5. Mantener el sistema de permisos existente (módulo + membresía).
6. Trazabilidad (bitácora/eventos + LOG_SISTEMA). 7. Simplicidad para el
trabajador (check-in de un clic, sin formularios largos). 8. Más supervisión al
líder. 9. Visión ejecutiva a Gerencia. 10. Datos accionables. 11. Sin
sobre-ingeniería. 12. Cada función justifica su utilidad. 13. Consistencia
visual con SIGSO v8.0. 14. Escalabilidad (archivado, caché, sin locks nuevos).

---

## Criterio de éxito (validación)

Un **gerente** responde rápido: ¿qué proyectos activos? ¿quién lidera? ¿en qué
estado? ¿cuáles atrasados y por qué? ¿quién bloqueado/sobrecargado? ¿qué esta
semana? → **Portafolio + salud + carga.**
Un **líder**: ¿qué hace cada integrante? ¿qué está atrasado? ¿quién no
actualizó? ¿qué solicitar? ¿qué revisar? → **Vista de proyecto + "requiere
atención".**
Un **integrante**: ¿qué hago? ¿para cuándo? ¿qué prioridad? ¿qué me bloquea?
¿qué me pide el líder? → **"Mi trabajo" (ya existe).**

---

## Recomendación

Aprobar el **MVP — Fase 1** con la decisión central (tareas = ACTIVIDADES
extendida). Es la ruta que entrega una "sala de trabajo" real, con historial de
avance y supervisión, apoyándose en un motor ya probado, sin romper nada y sin
gastar el presupuesto de triggers. **A la espera de tu aprobación antes de
escribir código de implementación.**
