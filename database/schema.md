# Esquema de datos (Google Sheets)

Mantenido incrementalmente desde la Fase 1; cada sección indica en qué fase
se agregó.

Fuente de verdad: `documentacion/SIGSO_Especificacion_Refinada_v1.1.docx` §6,
complementado con `documentacion/SIGSO_EspecificacionCompleta_v1.0.docx`
doc 9 (entidades completas) — ver
`documentacion/fases/RECONCILIACION-v1.0.md` para el porqué de esa
complementación. Implementado por `backend/setup/Instalador.gs` (headers) y
consumido por `backend/intake/Constantes.gs` (`COLUMNAS`) — ambos deben
coincidir; `backend/test/schema-consistency.test.js` lo verifica en cada
corrida de `npm test`.

> Convención: los campos marcados **(futuro)** ya existen en la hoja desde
> esta fase para no requerir una migración de columnas más adelante, pero
> ninguna función de la Fase 1 los llena todavía.

## SOLICITUDES (padre)

| Columna | Tipo | Origen / regla |
|---|---|---|
| `solicitud_id` | string | `SOL-AAAA-EMPRESA-NNNN`, `Correlativo.gs` (§5.4, RN-003) |
| `empresa_id` | string | RN-002 |
| `empresa_nombre` | string | Fase 6 (segunda reconciliación): nombre desnormalizado de `CAT_EMPRESAS`, resuelto en `crearSolicitud` (§13.2 v1.0 — legible directo en Sheets sin cruzar hojas). Queda vacío si el catálogo aún no tiene esa fila |
| `plataforma` | string | RN-002 |
| `plataforma_nombre` | string | Idem `empresa_nombre`, resuelto de `CAT_PLATAFORMAS` |
| `modulo` | string | **Fase 10** (rediseño UX): ya no viene de un campo único del formulario — se deriva del **primer ítem** en `crearSolicitud`. Se mantiene por compatibilidad con `dedup_hash`/`resumen_whatsapp`/`Dashboard.gs`, pero deja de reflejar la solicitud completa cuando hay ítems en módulos distintos (el desglose real vive en `SUBSOLICITUDES.modulo`) |
| `modulo_nombre` | string | Idem `empresa_nombre`, resuelto de `CAT_MODULOS` a partir del `modulo` del primer ítem |
| `tipo` | string | **Fase 10**: idem `modulo` — se deriva del primer ítem, ya no es una pregunta única de la solicitud (una solicitud real mezcla Error+Mejora+Nuevo módulo). Catálogo `CAT_TIPOS` con los 7 tipos reales de RF-009 v1.0: `ERR`/`MOD`/`MEJ`/`DES`/`NMO`/`MIG`/`CON` |
| `tipo_nombre` | string | Idem `empresa_nombre`, resuelto de `CAT_TIPOS` a partir del `tipo` del primer ítem |
| `solicitante_nombre` | string | Identidad del solicitante (§12.1) |
| `solicitante_cargo` | string | RF-001 v1.0: campo base obligatorio del formulario |
| `solicitante_email` | string | Identidad del solicitante (§12.1); usado para magic link |
| `es_cliente` | boolean | Toggle del formulario (§12.2) |
| `empresa_cliente` | string | Obligatorio si `es_cliente` (RN-005) |
| `cliente_mandante` | string | Opcional; RF-002 v1.0 |
| `cliente_obra` | string | Opcional; RF-002 v1.0 |
| `contacto_cliente` | string | Obligatorio si `es_cliente` (RN-005) |
| `correo_cliente` | string | Obligatorio si `es_cliente` (RN-005) |
| `telefono_cliente` | string | Opcional; RF-002 v1.0 |
| `urgencia_cliente` | string (`Alta`/`Normal`/`Baja`) | Opcional; insumo que el Analista pondera, no fija la prioridad (RN-006). Es un campo por solicitud (RF-002 v1.0), no por subsolicitud |
| `estado_derivado` | string (`S01`-`S11`) | `S01` al crear; recalculado por la máquina de estados (§8, Fase 2) |
| `prioridad_derivada` | string (`P1`-`P5`) | Más crítica entre subsolicitudes activas al crear (§7.2, ver nota de supuesto abajo); ajustada en Fase 2 |
| `orden_atencion` | number | RN-009, lo fija el Admin (Fase 2, `actualizarPrioridad`) |
| `analista_asignado` | string (email) | Fase 6: Actores §5 v1.0 ("Analista responsable"); solo Admin lo reasigna |
| `desarrollador_asignado` | string (email) | Fase 6: Actores §5 v1.0 ("Ver solicitudes asignadas a él"); Analista/Admin lo asignan. Usado por la vista filtrada del Dashboard para el rol DEV |
| `doc_estado` | string | `PENDIENTE`/`LISTO`/`ERROR`; `PENDIENTE` al pasar a S04, procesado por la cola (Fase 4, C-04) |
| `doc_reintentos` | number | Fase 4: contador de fallos de generación (máx. 3, §5.2) |
| `url_doc` / `url_pdf` | string | Fase 4: URLs del Doc y del PDF más reciente |
| `version_documento` | number | Fase 4 (§11.3): se incrementa en cada regeneración (reaprobación tras rechazo) |
| `url_pdf_historial` | string (JSON) | Fase 4 (§11.3): array de URLs de versiones anteriores del PDF |
| `dedup_hash` | string | hash MD5 de empresa+plataforma+modulo+solicitante+descripción del ítem 1 (RF-F06) |
| `estimacion_total_horas` | number | Suma de `estimacion_horas` de las subsolicitudes (RF-F04) |
| `horas_reales` | number | **(futuro)** se completa durante el desarrollo (Fase 2/5) |
| `observaciones_generales` | string | Opcional; Bloque 6 del formulario (doc 12.1 v1.0), observaciones del solicitante sobre la solicitud completa |
| `resumen_whatsapp` | string | Formato exacto de RF-015 v1.0 (con emojis), generado en `crearSolicitud` |
| `fecha_creacion` | ISO datetime | — |
| `creado_por` | string | `solicitante_email` |
| `cc` | string (email) | **Fase 9** (hallazgo de datos reales, ej. RLD "Hoja de ruta": `Cc: Monje Fuji`): opcional; correo adicional a copiar en las notificaciones de la solicitud, además de `solicitante_email`. Se copia (Gmail `cc`) en el acuse de recibo |

## SUBSOLICITUDES

| Columna | Tipo | Origen / regla |
|---|---|---|
| `subsolicitud_id` | string | `{solicitud_id}-01`, `-02`, ... |
| `solicitud_id` | string | FK a `SOLICITUDES` |
| `numero_item` | number | Posición dentro de la solicitud (1, 2, 3...), RF-003/entidad SUBSOLICITUD v1.0 |
| `titulo` / `descripcion` | string | Obligatorios (RN-004) |
| `contexto` | string | Opcional; RF-003 v1.0 — antecedentes de cómo se llegó al problema |
| `resultado_esperado` | string | Opcional; RF-003 v1.0 — qué debería ocurrir una vez resuelto |
| `impacto` | string | `SISTEMA_CAIDO`/`PERDIDA_DATOS`/`BLOQUEO_OPERATIVO`/`DEGRADACION_IMPORTANTE`/`PARCIAL_CON_WORKAROUND`/`PLANIFICADO`; insumo de `derivarPrioridad_` (RN-006) |
| `prioridad` | string (`P1`-`P5`) | `derivarPrioridad_(impacto)` |
| `estado` | string (`S01`-`S11`) | `S01` al crear; ver máquina de estados (§8, Fase 2) |
| `url_modulo` | string | Opcional; RF-003 v1.0 — URL exacta donde se reproduce el problema (URL principal) |
| `usuario_prueba` | string | Opcional; RF-003 v1.0 |
| `ref_credencial` | string | Enlace a `Sistema_Control_Credenciales` (C-06/§3.4); reemplaza a `password_prueba` de v1.0, nunca contraseña en claro |
| `centro_costos` | string | Opcional; RF-003 v1.0 |
| `url_video` | string | Opcional; RF-003 v1.0 — link a video explicativo (Drive/YouTube/Loom). **Fase 9**: se retiró del formulario visible (ningún ejemplo real lo usa — sí se usan capturas de pantalla, ver `ARCHIVOS`); la columna se mantiene por si algún caso futuro lo necesita |
| `observaciones` | string | Opcional; observaciones específicas del ítem (distinto de `observaciones_generales` en `SOLICITUDES`) |
| `sla_objetivo_horas` | number | Leído de `CONFIG_SLA` según `prioridad` |
| `estimacion_horas` | number | Opcional; estimación del desarrollador, entidad SUBSOLICITUD v1.0 |
| `horas_reales` | number | **(futuro)**; se completa durante el desarrollo |
| `fecha_creacion` | ISO datetime | — |
| `desarrollador_asignado` | string (email) | Fase 6 (segunda reconciliación), §13.3 v1.0: las subsolicitudes pueden trabajarse en paralelo por distintos desarrolladores, así que la asignación también existe a este nivel (no solo en `SOLICITUDES.desarrollador_asignado`, que sigue siendo el responsable "por defecto"). La asignación puntual se hace vía `actualizarPrioridad({ solicitud_id, subsolicitud_id, desarrollador_asignado })`; el Dashboard (vista DEV) muestra una solicitud si el desarrollador está asignado a ella o a cualquiera de sus subsolicitudes |
| `urls_adicionales` | string (JSON) | **Fase 9** (hallazgo de datos reales, RLD "Hoja de ruta": hasta 4 URLs distintas en una sola solicitud — módulo, modal de validación, modal de información, documento generado). Array `[{titulo, url}, ...]` serializado, mismo patrón que `url_pdf_historial`. `url_modulo` sigue siendo la URL principal; esta columna guarda las adicionales |
| `tipo` / `tipo_nombre` | string | **Fase 10** (rediseño UX, auditoría de producto): el tipo pasa de ser una pregunta global (`SOLICITUDES.tipo`) a una pregunta por ítem — la corrección conceptual central del rediseño: una solicitud real mezcla Error+Mejora+Nuevo módulo. `SOLICITUDES.tipo` se mantiene mientras existe, pero ahora es solo el del primer ítem (ver nota ahí) |
| `modulo` / `modulo_nombre` | string | **Fase 10**: idem `tipo` — cada ítem puede vivir en un módulo distinto (confirmado con datos reales de Camila Peña/Lisseth Vilchez); reemplaza el supuesto de "un solo módulo por solicitud" |
| `frecuencia` | string (`SIEMPRE`/`A_VECES`/`UNA_VEZ`) | **Fase 10**: reemplaza a `estimacion_horas` en el formulario público — el solicitante no puede estimar esfuerzo de desarrollo, pero sí sabe cuán seguido ocurre el problema. `estimacion_horas` se mantiene para que el desarrollador la complete después desde el Backoffice |
| `personas_afectadas` | number | **Fase 10**: idem — a cuántas personas afecta, insumo de priorización más realista que una estimación de horas hecha por quien no desarrolla |
| `imagen_descripciones` | string (JSON) | **Fase 10**: caption corto por imagen, sin agregar una columna a `ARCHIVOS`. Array de strings serializado — el índice `i` corresponde a la i-ésima imagen subida para ese ítem (`subirArchivo` se llama en el mismo orden después de `crearSolicitud`, ya que el `archivo_id` real no existe todavía al momento de guardar la subsolicitud) |
| `fecha_propuesta` | ISO datetime / date | **v2.1 (Fase A, "dos promesas, dos relojes")**: lo que el solicitante propone en el formulario — una sola fecha por solicitud, replicada como default en cada ítem (`crearSolicitud`). Opcional en general; **obligatoria con hora** si `es_cliente` o si el ítem tiene un `impacto` que deriva `P1` (`SISTEMA_CAIDO`/`PERDIDA_DATOS`/`BLOQUEO_OPERATIVO`) — ahí se puede resolver en horas/minutos. No es vinculante |
| `fecha_comprometida` | ISO datetime | **v2.1 (Fase A)**: la fecha que fija el **desarrollador** (`Solicitudes.comprometerFecha`, Backoffice) — es la definitiva, la que mide Gerencia (Fase C). Re-comprometer (ya había una fecha) exige `motivo` (≥20 caracteres, mismo patrón que `HISTORIAL_PRIORIDAD`/RN-007) y queda registrado en `HISTORIAL_COMPROMISO` |
| `fecha_terminada` | ISO datetime | **v2.1 (Fase A)**: sellada automáticamente por `actualizarEstado` al entrar a `S08` (Terminada) — detiene el "reloj del desarrollador". Se limpia si el ítem sale de `S08` (reabierto), para que el reloj se reanude |
| `comprometida_por` | string (email) | **v2.1 (Fase A)**: quien fijó `fecha_comprometida` |
| `area` / `area_nombre` | string | **v3.0 (Fase 1, multi-responsable)**: a qué área/responsable va dirigido el ítem. El formulario elige por **área** (`CAT_AREAS`, por nombre); `crearSolicitud` resuelve `area → responsable_email` **del lado del servidor** (nunca viaja al navegador público) y escribe ese correo en `desarrollador_asignado`. `''` = "No estoy seguro" → bandeja de triage (responsable por defecto, `EMAIL_DESARROLLO`). `area_nombre` es la desnormalización legible (se muestra al solicitante en Consultar Estado; el correo del responsable, no) |

## COUNTERS (nueva, C-12)

| Columna | Tipo | Nota |
|---|---|---|
| `empresa_id` | string | Clave junto con `anio` |
| `anio` | number | — |
| `ultimo_numero` | number | Incrementado con `LockService` en `generarId_` |

## CONFIG_FERIADOS (nueva)

`fecha`, `nombre`, `anio` — feriados de Chile para el cálculo de SLA hábil
(§10, Fase 2). Se crea vacía en esta fase; se carga manualmente (checklist §17.2).

## CONFIG_SLA

| Columna | Tipo | Valores iniciales (sembrados por el instalador) |
|---|---|---|
| `prioridad` | string | `P1`..`P5` |
| `sla_horas` | number / vacío | `P1=2, P2=24, P3=72, P4=120, P5=''` (§7.2) |

## USUARIOS

`usuario_id`, `nombre`, `email`, `empresa_id`, `rol` (`ANA`/`DEV`/`ADM`),
`activo`, `ultimo_acceso`, `creado_por` — sin `hash_password` ni
`token_sesion` (C-03/§3.1). Se crea vacía en la Fase 1; desde la Fase 2 el
router del Backoffice ya la lee para resolver el rol de quien llama (ver
sección propia más abajo). La gestión (alta/edición) sigue siendo Fase 6.

## Catálogos (`CAT_EMPRESAS`, `CAT_PLATAFORMAS`, `CAT_MODULOS`, `CAT_TIPOS`)

Cada uno con `*_id`, `nombre`, `activo` (y `CAT_PLATAFORMAS`/`CAT_MODULOS`
agregan la FK a su padre: `empresa_id` / `plataforma_id`). `CAT_EMPRESAS`
agrega `logo` (URL) y `CAT_PLATAFORMAS` agrega `url_base` — campos reales de
RF-006/RF-007 (v1.0) que se habían omitido en la primera pasada de
reconciliación; agregados en la Fase 6 (ver
`documentacion/fases/RECONCILIACION-v1.0.md`).

`CAT_MODULOS` agrega además `modulo_padre_id` (post-Fase 8, durante el
despliegue real): el catálogo real de módulos de HomePymes/GDE/Intranet
tiene hasta 4 niveles (módulo principal → submódulo → ítem → sub-ítem — ver el mapa de
procesos real, no modelado en ninguna versión de la especificación
original). Vacío si el módulo es raíz de su plataforma. El formulario
público arma una cascada de selects (`campo-modulo` → `campo-submodulo` →
`campo-item`, ver `frontend/js/formulario.js`) que se muestran solo si el
nivel anterior efectivamente tiene hijos; el valor que se guarda en
`SOLICITUDES.modulo` es siempre el del nivel más profundo elegido, sin
importar la profundidad real de ese módulo en particular. `admin.html`
gestiona el árbol con un campo de texto simple (`modulo_padre_id`, el
código del padre) en vez de un editor de árbol dedicado — consistente con
cómo ya se referencian `empresa_id`/`plataforma_id` en el resto del panel de
catálogos.

`Catalogos.getAll()` (Intake,
formulario público) solo devuelve filas con `activo=true`;
`Catalogos.listar()` (Backoffice, panel de administración) devuelve todas,
activas e inactivas, para poder editarlas. `CAT_EMPRESAS`/`CAT_PLATAFORMAS`/`CAT_MODULOS`
se crean vacías (datos propios de la organización, checklist §17.2, carga
manual vía `admin.html`, Fase 6). `CAT_TIPOS` es la excepción: es un catálogo
fijo de la especificación (RF-009 v1.0), así que **sí** se siembra
automáticamente (`Instalador.gs`, `TIPOS_INICIALES`) con sus 7 tipos y
agrega la columna `prioridad_default` (solo informativa/UX — la prioridad
real siempre se
deriva por impacto, RN-006, nunca por tipo). **v2.0 (Sprint 2, P2)** agrega
`es_urgente` (booleano, aditivo al final): a diferencia de
`prioridad_default`, este **sí** afecta la prioridad real —
`derivarPrioridad_` (`backend/intake/Solicitudes.gs`) no deja que un tipo
marcado urgente (o cualquier solicitud de cliente) quede por debajo de P2,
sin importar el impacto que declare el solicitante. Sembrado por defecto en
`ERR`/`MIG`; el resto se ajusta desde `admin.html` según el criterio real de
cada equipo.

## CAT_AREAS (nueva, v3.0 Fase 1 — multi-responsable)

| Columna | Tipo | Nota |
|---|---|---|
| `area_id` | string | Código del área |
| `nombre` | string | Lo que ve el solicitante en el formulario ("Plataformas / sistemas", "Contabilidad"…) |
| `responsable_email` | string | Correo que **recibe** las solicitudes de esa área. **Nunca** se expone al navegador público |
| `activo` | boolean | Solo las activas se listan en el formulario |

Catálogo administrable (solo `ADM`), mismo patrón que el resto de `CAT_*`.
Habilita el ruteo multi-responsable (`documentacion/SIGSO-v3.0-multi-
responsable-y-control.md`): el formulario elige un **área** por su nombre
(`Catalogos.getAll` la proyecta a solo `{area_id, nombre}`, sin el correo);
`crearSolicitud` (`resolverResponsable_`) traduce `area → responsable_email`
y lo escribe en `SUBSOLICITUDES.desarrollador_asignado`, y le **avisa a ese
responsable** en vez de al buzón fijo. Si el área no existe/está inactiva o
la hoja aún no se creó (instalación previa a v3.0), cae al buzón por defecto
(`EMAIL_DESARROLLO`), preservando el comportamiento anterior. Se crea **vacía**
(dato de la organización, carga manual desde Administración).

> **Nota de comportamiento (v3.0):** el aviso de nueva solicitud ahora va
> **siempre** al responsable ruteado cuando el switch global `AVISO_LEO` está
> activo (antes una solicitud interna no urgente no avisaba salvo opt-in). Es
> el objetivo del ruteo: quien recibe la solicitud se entera. Ítems que caen
> en el mismo responsable generan un solo aviso (dedup por destinatario).

## Bandeja por responsable (v3.0 Fase 2 — sin columnas ni hojas nuevas)

`Dashboard.getData` (`backend/backoffice/Dashboard.gs`) resuelve el **ámbito**
según el rol de quien consulta (`documentacion/SIGSO-v3.0-multi-responsable-
y-control.md` §5):

- **Responsable individual (`DEV`)**: `aplicarAmbitoRol_` lo acota SIEMPRE a
  `desarrollador_asignado === su correo` (filtro interno `vistaDev`) — ya no
  hay forma de que otro filtro (p. ej. `estado`) cancele ese auto-scope
  (bug corregido en v3.0: antes `!filtros.estado` lo dejaba ver TODAS las
  solicitudes de ese estado, sin importar el responsable).
- **`ADM` / `GERENCIA`**: ven todo por defecto. Si mandan el filtro
  `verBandeja` (email de un responsable, elegido desde el selector "¿Qué
  bandeja ver?" del Dashboard), se acotan a esa persona igual que un `DEV`.
- La respuesta agrega `responsables` (lista `{email, nombre}` de `USUARIOS`
  activos con rol `DEV`/`ANA`) **solo** cuando el rol de quien consulta es
  `ADM` o `GERENCIA` — es la lista que puebla el selector; un responsable
  individual no la necesita, ya está auto-acotado.

## Avisos por responsable (v3.0 Fase 2.1 — hallazgo real de producción)

`Notificaciones.notificarRespuestaSolicitante` y `.notificarValidacionSolicitante`
(`backend/intake/Notificaciones.gs`) mandaban **siempre** al buzón por
defecto (`EMAIL_DESARROLLO`, Leo) cuando el solicitante respondía una
consulta (S06) o validaba/reabría un ítem "Terminada" — tenía sentido
mientras Leo era el único desarrollador, pero con el ruteo por área (Fase 1)
cada ítem tiene su propio responsable, y el aviso debe llegarle a esa
persona, no siempre a Leo.

- `Solicitudes.validarCierre` ahora pasa
  `subsolicitud.desarrollador_asignado || solicitud.desarrollador_asignado`
  como destinatario.
- `Solicitudes.responderConsulta` resuelve destinatarios vía
  `resolverDestinatariosRespuesta_`: si la respuesta es sobre un ítem
  puntual (`subsolicitud_id`), va solo a su responsable; si es general, va a
  todos los responsables **distintos** de la solicitud (dedup).
- Si el ítem no tiene `desarrollador_asignado` (instalación previa a v3.0,
  o sin área configurada), cae al buzón por defecto — retrocompatible.

## HISTORIAL_ESTADOS

`historial_id`, `solicitud_id`, `subsolicitud_id`, `estado_anterior`,
`estado_nuevo`, `usuario`, `comentario`, `timestamp` (RN-014). `crearSolicitud`
escribe el registro inicial `S01`; desde la Fase 2, `Solicitudes.actualizarEstado`
escribe cada transición posterior (§8, §9).

## HISTORIAL_PRIORIDAD (nueva, Fase 2)

| Columna | Tipo | Nota |
|---|---|---|
| `historial_id` | string | `Utilities.getUuid()` |
| `subsolicitud_id` / `solicitud_id` | string | FK |
| `prioridad_anterior` / `prioridad_nueva` | string (`P1`-`P5`) | — |
| `justificacion` | string | Obligatoria, mínimo 20 caracteres (RN-007) |
| `usuario` | string | Email de quien modifica |
| `timestamp` | ISO datetime | — |

No está en el inventario de hojas de §6: se agregó porque RN-007 exige
explícitamente que "cada modificación... queda en historial" y ninguna hoja
existente tiene esa forma (`HISTORIAL_ESTADOS` es específicamente de
estados, RN-014). Ver el razonamiento completo en
`documentacion/fases/FASE-02-maquina-estados.md`.

## Semáforo de cumplimiento (v2.1 Fase B, derivado — no persiste en Sheets)

`backend/backoffice/Cumplimiento.gs` (`Cumplimiento.clasificar(subsolicitud)`)
calcula, en el momento de pedir el detalle (`Solicitudes.getDetalle`), la
clasificación de "dos relojes" descrita en
`documentacion/SIGSO-v2.1-plazos-y-control.md` §2.2/§6, a partir de
`estado`/`fecha_comprometida`/`fecha_terminada` — reutilizando
`Utils.horasHabilesEntre` (mismo motor de horas hábiles del SLA, §10). No
agrega columnas: es un campo calculado (`cumplimiento: { codigo, etiqueta,
emoji, dias_esperando }`) que viaja en la respuesta, nunca se escribe en
`SUBSOLICITUDES`. Códigos: `EN_PLAZO`, `EN_RIESGO`,
`ATRASADA_DESARROLLADOR`, `ESPERANDO_VALIDACION` (con `dias_esperando`),
`SIN_COMPROMISO`, `CERRADA_A_TIEMPO`, `CERRADA_CON_ATRASO`.

## Panel de Control de Gerencia (v2.1 Fase C, derivado — no persiste en Sheets)

`backend/backoffice/Gerencia.gs` (`Gerencia.getPanel(filtros, contexto)`,
acción `getPanelGerencia`) es una vista sobre `SOLICITUDES`/`SUBSOLICITUDES`
+ el semáforo de `Cumplimiento.gs` — no agrega columnas ni hojas. Devuelve:
- `kpis`: `pct_cumplimiento_desarrollador`, `atrasadas_activas`,
  `esperando_validacion` (+ `esperando_validacion_promedio_dias`),
  `atraso_promedio_dias`, `sin_comprometer` (§7A de la especificación).
- `items`: uno por subsolicitud filtrada, con su `cumplimiento` (Fase B),
  `fecha_original` (línea base antes del primer re-compromiso, para el
  "resbalón" de la carta Gantt, §7C) y `re_compromisos` (conteo, de
  `HISTORIAL_COMPROMISO`).

Reutiliza `coincideFiltros_` (`Dashboard.gs`) para los filtros a nivel
solicitud (empresa/solicitante) y agrega `coincideFiltroItem_` (propio de
este archivo) para los filtros a nivel ítem (desarrollador, tipo, período).
El frontend (`frontend/js/gerencia.js`, sección `#vista-gerencia` en
`app.html`) dibuja la carta Gantt con barras posicionadas por CSS (sin
librería Gantt), consistente con `documentacion/SIGSO-v2.1-plazos-y-
control.md` §9 ("Gantt pesado en el stack" — riesgo mitigado). Solo se
ofrece como vista al rol `GERENCIA` (botón "Ver Panel de Gerencia" en el
Dashboard); el backend no bloquea la acción para otros roles autenticados,
igual que `getDashboardData`.

`Solicitudes.getDetalle` también agrega `historial_compromiso` (filtrado
por `solicitud_id`) para el drill-down (§7, línea de tiempo de fechas):
`detalle.js` lo muestra como "Historial de compromiso" bajo cada ítem que
tuvo al menos un re-compromiso.

## Avisos de plazos (v2.1 Fase D — §8, reutiliza la cola de correo existente)

Tres avisos nuevos, todos en `backend/backoffice/Notificaciones.gs`, sin
hoja ni columna nueva (usan `LOG_NOTIFICACIONES` para el dedup, igual que
el resto de la cola de correo):

- **`avisarCompromisoFecha`**: se dispara de forma síncrona desde
  `Solicitudes.comprometerFecha` (Fase A) — avisa al solicitante que el
  desarrollador se comprometió (o re-comprometió) a una fecha. El evento
  de dedup incluye la fecha nueva, así que re-comprometer a una fecha
  distinta genera un aviso nuevo (no lo deduplica contra el anterior).
- **`alertaFechaEnRiesgo`** + `Triggers.verificarFechasComprometidas`
  (trigger diario 09:00, mismo horario que `verificarSLAsTrigger`):
  recorre las subsolicitudes con `fecha_comprometida` y usa
  `Cumplimiento.clasificar` (Fase B) — si el código es `EN_RIESGO`, avisa
  al desarrollador asignado y a Gerencia/Admin de la empresa. Análoga a
  `alertaSLAProximo` (A-08) pero sobre la fecha comprometida, no el SLA.
- **`recordarValidacionPendiente`** + `Triggers.recordarValidacionPendiente`
  (mismo horario): recorre los items en "Terminada" (S08) y, si llevan
  entre `UMBRAL_RECORDATORIO_DIAS_HABILES` (2) y
  `DIAS_HABILES_CIERRE_AUTOMATICO` (5, RN-201) días hábiles sin validar,
  le recuerda al solicitante — antes de que actúe el cierre automático.
  Comparte el cálculo de "días hábiles en Terminada" (`diasHabilesEnTerminada_`,
  `Triggers.gs`) con `cerrarInactivosPorValidacion`, que ya existía.

## HISTORIAL_COMPROMISO (nueva, v2.1 Fase A)

| Columna | Tipo | Nota |
|---|---|---|
| `historial_id` | string | `Utilities.getUuid()` |
| `subsolicitud_id` / `solicitud_id` | string | FK |
| `fecha_anterior` / `fecha_nueva` | ISO datetime | El "resbalón" — la línea base es la primera fila de esta hoja para ese ítem; si nunca hubo re-compromiso, la línea base es `fecha_comprometida` misma |
| `motivo` | string | Obligatorio, mínimo 20 caracteres — evidencia que el Panel de Gerencia (Fase C) necesita para mostrar por qué se movió la fecha |
| `usuario` | string | Email de quien re-comprometió |
| `timestamp` | ISO datetime | — |

Mismo patrón que `HISTORIAL_PRIORIDAD`: solo se escribe cuando ya existía una
`fecha_comprometida` previa (el primer compromiso no es un "resbalón", no
genera fila aquí). Ver
`documentacion/SIGSO-v2.1-plazos-y-control.md` §5 para el diseño completo
("dos promesas, dos relojes") y §10 para el plan de fases.

## ARCHIVOS (nueva, Fase 4)

| Columna | Tipo | Nota |
|---|---|---|
| `archivo_id` | string | `Utilities.getUuid()` |
| `solicitud_id` / `subsolicitud_id` | string | FK; `subsolicitud_id` opcional |
| `nombre_original` | string | Nombre declarado por el cliente (no se confía en su extensión) |
| `url` | string | URL de Drive del blob guardado |
| `tipo_mime` | string | Detectado por firma de bytes, no por lo declarado (§5.3, C-06) |
| `tamano_bytes` | number | Validado contra el límite de su categoría (imagen 5 MB, documento 10 MB) |
| `fecha_subida` | ISO datetime | — |

No está en el inventario de §6 (que no detalla el modelo de adjuntos);
se agregó para poder registrar la metadata de cada archivo subido
por-archivo (`Drive.subirArchivo`, §5.3).

## LOG_NOTIFICACIONES (columna nueva en Fase 4)

Se agrega `reintentos` (number) a las columnas ya existentes desde la Fase
1 (`log_id`, `timestamp`, `solicitud_id`, `canal`, `destinatario`, `evento`,
`resultado`), para soportar la cola de reintentos por cuota de Gmail (A-12,
`Notificaciones.procesarColaCorreo`). `resultado` ahora puede ser
`ENVIADO`, `PENDIENTE_REINTENTO` o `FALLIDO`.

## COMENTARIOS, LOG_SISTEMA

Se crean con sus headers desde la Fase 1 (para no requerir una migración de
esquema más adelante) pero sin lógica de escritura propia todavía —
`COMENTARIOS` llega en Fase 5/6; `LOG_SISTEMA` se usa transversalmente para
logging de errores (el `ref` de error interno, desde la Fase 0, y los
fallos de generación de documentos desde la Fase 4).

## CONFIG_NOTIFICACIONES

`notif_id`, `evento`, `rol_destinatario`, `emails_extra`, `activo` —
columnas corregidas en la segunda reconciliación con v1.0 (doc 9,
inventario de hojas): la primera pasada había inventado un esquema
genérico (`tipo_evento`/`canal`/`plantilla`/`activo`) sin base en la
especificación. Se crea vacía desde la Fase 1; queda para cuando se
administren las reglas de notificación desde el Backoffice (Fase 7+),
ya que las notificaciones actuales (`Notificaciones.gs`, Fase 4) usan
reglas fijas en código, no configurables todavía.

**v2.0 (Sprint 3, P12)**: deja de estar infrautilizada. `Instalador.gs`
siembra un registro `AVISO_LEO` (`evento='AVISO_DESARROLLO'`,
`activo=true`) que funciona como switch global: `crearSolicitud`
(`backend/intake/Solicitudes.gs`, `avisoDesarrolloActivo_`) lo consulta
antes de avisarle a Leo por correo (cliente, P1 u opt-in) — si está en
`false`, no se envía ningún aviso automático, sin tocar código (resuelve
la contradicción C2: "Felipe dijo que no le enviara ni un correo
todavía"). Editable desde Administración > Notificaciones (mismo CRUD
genérico que el resto de catálogos, solo Admin).

## Supuestos documentados (no literales en la especificación)

- **`prioridad_derivada` en `SOLICITUDES`**: la especificación define
  `estado_derivado` explícitamente (§8, C-08) pero no nombra un campo
  equivalente para prioridad a nivel de padre — solo dice que cada
  subsolicitud "lleva su propio `sla_objetivo_horas` derivado de su
  prioridad" (§8.2) y que RN-009 fija `orden_atencion` "en la solicitud"
  para dos P1 simultáneos. Se agrega `prioridad_derivada` (la más crítica
  entre las subsolicitudes activas) siguiendo el mismo patrón arquitectónico
  que `estado_derivado`, para que el dashboard (Fase 5) y RN-009 (Fase 2)
  tengan un campo persistido donde apoyarse.
- **`derivarPrioridad_` sin impacto explícito → `P4`**: RN-006 solo define
  la tabla de impacto para el caso "Error de cliente"; para el resto de
  casos (tipo distinto de Error, o impacto no informado) la especificación
  no fija una regla. Se aplica la misma tabla de impacto a cualquier tipo de
  solicitud y se usa `P4` como default conservador cuando no hay impacto
  informado. Esto es ajustable en `MAPA_IMPACTO_PRIORIDAD` /
  `PRIORIDAD_POR_DEFECTO` (`backend/intake/Constantes.gs`) sin tocar el
  resto del código.
- **Carpeta de la solicitud creada desde `crearSolicitud`, no recién en
  S04**: RN-025 dice "carpeta de Drive creada al aprobar (S04)", pero
  `subirArchivo` (§5.3) puede llamarse justo después de crear la solicitud,
  en S01 — antes de cualquier aprobación. Se interpreta que RN-025 se
  refiere a cuándo se genera el *documento* dentro de esa carpeta, no a
  cuándo puede existir la carpeta en sí. Ver
  `documentacion/fases/FASE-04-documentos-notificaciones.md`.
- **Plantilla de documento embebida en código, no leída desde Drive**: §11.1
  modela `template_solicitud.gdoc` como un Google Doc real con marcadores
  `{{CAMPO}}`. Esta implementación usa una constante de texto equivalente
  (`PLANTILLA_DOCUMENTO` en `Documentos.gs`) para que la generación sea
  autocontenida y testeable sin Drive real; migrar a leer el `.gdoc` es un
  cambio acotado a `generarDocumento_()`.
- **`urgencia_cliente` es un campo de `SOLICITUDES`, no de `SUBSOLICITUDES`**:
  la Fase 2 lo había modelado por subsolicitud (una lectura posible de v1.1,
  que no repite el detalle); RF-002 de v1.0 lo define una sola vez por
  solicitud, como parte del bloque de datos de cliente. Se corrigió en la
  reconciliación con v1.0 — ver `documentacion/fases/RECONCILIACION-v1.0.md`.
