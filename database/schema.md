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
| `modulo` | string | RN-002 |
| `modulo_nombre` | string | Idem `empresa_nombre`, resuelto de `CAT_MODULOS` |
| `tipo` | string | RN-002; catálogo `CAT_TIPOS` con los 7 tipos reales de RF-009 v1.0: `ERR`/`MOD`/`MEJ`/`DES`/`NMO`/`MIG`/`CON` |
| `tipo_nombre` | string | Idem `empresa_nombre`, resuelto de `CAT_TIPOS` |
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
| `url_modulo` | string | Opcional; RF-003 v1.0 — URL exacta donde se reproduce el problema |
| `usuario_prueba` | string | Opcional; RF-003 v1.0 |
| `ref_credencial` | string | Enlace a `Sistema_Control_Credenciales` (C-06/§3.4); reemplaza a `password_prueba` de v1.0, nunca contraseña en claro |
| `centro_costos` | string | Opcional; RF-003 v1.0 |
| `url_video` | string | Opcional; RF-003 v1.0 — link a video explicativo (Drive/YouTube/Loom) |
| `observaciones` | string | Opcional; observaciones específicas del ítem (distinto de `observaciones_generales` en `SOLICITUDES`) |
| `sla_objetivo_horas` | number | Leído de `CONFIG_SLA` según `prioridad` |
| `estimacion_horas` | number | Opcional; estimación del desarrollador, entidad SUBSOLICITUD v1.0 |
| `horas_reales` | number | **(futuro)**; se completa durante el desarrollo |
| `fecha_creacion` | ISO datetime | — |
| `desarrollador_asignado` | string (email) | Fase 6 (segunda reconciliación), §13.3 v1.0: las subsolicitudes pueden trabajarse en paralelo por distintos desarrolladores, así que la asignación también existe a este nivel (no solo en `SOLICITUDES.desarrollador_asignado`, que sigue siendo el responsable "por defecto"). La asignación puntual se hace vía `actualizarPrioridad({ solicitud_id, subsolicitud_id, desarrollador_asignado })`; el Dashboard (vista DEV) muestra una solicitud si el desarrollador está asignado a ella o a cualquiera de sus subsolicitudes |

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
`documentacion/fases/RECONCILIACION-v1.0.md`). `Catalogos.getAll()` (Intake,
formulario público) solo devuelve filas con `activo=true`;
`Catalogos.listar()` (Backoffice, panel de administración) devuelve todas,
activas e inactivas, para poder editarlas. `CAT_EMPRESAS`/`CAT_PLATAFORMAS`/`CAT_MODULOS`
se crean vacías (datos propios de la organización, checklist §17.2, carga
manual vía `admin.html`, Fase 6). `CAT_TIPOS` es la excepción: es un catálogo
fijo de la especificación (RF-009 v1.0), así que **sí** se siembra
automáticamente (`Instalador.gs`, `TIPOS_INICIALES`) con sus 7 tipos y
agrega la columna `prioridad_default` (solo informativa/UX — la prioridad
real siempre se
deriva por impacto, RN-006, nunca por tipo).

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
