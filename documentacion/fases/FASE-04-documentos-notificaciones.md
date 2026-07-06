# Fase 4 — Documentos y notificaciones

Fuente de verdad: `documentacion/SIGSO_Especificacion_Refinada_v1.1.docx` (§5.2, §5.3, §11, §13 parcial, C-04, C-06).
Depende de las Fases 0-3.

## Objetivo

Cerrar el ciclo de vida operativo de una solicitud: adjuntar archivos,
generar el documento formal (Doc→PDF) sin bloquear el request, y notificar
por Gmail en los puntos clave del flujo — todo de forma encolada y con
reintentos, tal como exige la auditoría (C-04, C-06, R-013, R-016).

## Alcance de esta fase

Incluido:

- `Drive.subirArchivo` (Intake, §5.3, C-06): un archivo por request,
  detección de tipo real por firma de bytes (no por extensión ni por el
  `Content-Type` declarado), límites de tamaño por categoría (imagen 5 MB,
  documento 10 MB), metadata registrada en la nueva hoja `ARCHIVOS`.
- Estructura de carpetas de Drive (§11.1): `SIGSO_Solicitudes/[AÑO]/[EMPRESA]/[N°_SOL]/Adjuntos/`,
  creada de forma idempotente (`DriveRepo.gs`, duplicado en Intake y Backoffice).
- `Documentos.procesarColaDocumentos` (Backoffice, §5.2, C-04): cola
  encolada y diferida — `actualizarEstado` solo marca `doc_estado='PENDIENTE'`
  al pasar a S04; un trigger de tiempo separado genera el Doc, lo exporta a
  PDF, y versiona (`url_pdf_v1`, `v2`... vía `version_documento` +
  `url_pdf_historial`, §11.3). Reintentos automáticos hasta 3 veces; al
  tercer fallo alerta al Admin.
- `Notificaciones.gs` (duplicado en Intake y Backoffice): acuse de recibo y
  alerta P1 al crear una solicitud (A-02/A-03), aviso al desarrollador
  cuando el documento está listo (A-05), notificación de cambio de estado
  (A-06), y una cola de reintento por cuota de Gmail (A-12). Deduplicación
  por (solicitud, evento, destinatario) dentro de 30 minutos (RN-026).
- `Triggers.configurarTriggers` (Backoffice, §13): instala una sola vez los
  triggers de tiempo de la cola de documentos y de la cola de correo.
- 21 pruebas nuevas (86 en total) y mocks nuevos de `DriveApp`,
  `DocumentApp`, `GmailApp` y `ScriptApp`.

Explícitamente fuera de esta fase:

- Magic link real (token firmado enviado por Gmail) para `estadoPublico`:
  sigue con la verificación de correo directa de la Fase 3. Se posterga a
  la Fase 8 (endurecimiento de seguridad), no a esta, porque el foco aquí
  es documentos/notificaciones del flujo interno, no la autenticación
  pública.
- El resto de triggers de §13 (verificación de SLA A-07/08/09, refresco de
  cache A-10, suspensión de inactivos A-11): Fase 7 (Automatizaciones).
- Plantillas administrables de notificación (`CONFIG_NOTIFICACIONES`):
  Fase 6, junto con la administración de catálogos/usuarios.

## Decisiones y supuestos

| Decisión | Detalle |
|---|---|
| Carpeta de la solicitud creada desde `crearSolicitud`, no solo en S04 | RN-025 ("carpeta creada al aprobar") entra en tensión con que `subirArchivo` puede llamarse en S01. Se interpretó que RN-025 habla de cuándo se genera el documento dentro de la carpeta, no de cuándo puede existir la carpeta. Ver `database/schema.md`. |
| Plantilla de documento embebida en código (`PLANTILLA_DOCUMENTO`), no leída de un `.gdoc` real | Generar el Doc creando uno nuevo y llenándolo con `DocumentApp` es equivalente funcionalmente a copiar una plantilla real de Drive, y es autocontenido/testeable sin depender de un archivo externo que no se puede versionar en este repo. Migrar a leer `SIGSO_Templates/template_solicitud.gdoc` real es un cambio acotado a `generarDocumento_()`. |
| Reintentos de documentos: `ERROR` sigue siendo reprocesado hasta el tope | El texto dice "se marca 'ERROR' con contador de reintentos (máx. 3)"; para que el reintento automático tenga sentido, `procesarColaDocumentos` también recoge filas en `ERROR` con `doc_reintentos < 3`, no solo `PENDIENTE`. Al llegar a 3, deja de reprocesarse y ya se alertó al Admin. |
| Dedup de notificaciones por `(solicitud, evento, destinatario)` | La especificación solo dice "mismo evento/solicitud en 30 min" (RN-026); se agregó `destinatario` a la clave porque, si no, la segunda persona en una lista de varios destinatarios (p. ej. Analista + Desarrollador en la alerta P1) quedaría bloqueada por el envío al primero. Encontrado y corregido durante las pruebas de esta fase. |
| Magic link diferido a Fase 8, no a esta fase | Aunque §12.1 lo menciona junto al flujo de notificaciones, endurecer `estadoPublico` es un cambio de superficie de seguridad pública, más alineado con el resto de endurecimiento del endpoint público que ya está planificado para la Fase 8. |

## Cómo correr las pruebas

```bash
npm test
```

86 casos: 65 de Fases 0-3 + 8 de `subirArchivo`/Drive + 4 de la cola de
documentos + 7 de notificaciones + 2 de triggers.

## Checklist de la Fase 4

- [x] `subirArchivo` valida tamaño y tipo MIME real, guarda en la carpeta
      correcta, registra metadata en `ARCHIVOS`.
- [x] Estructura de carpetas de Drive idempotente (§11.1).
- [x] Cola de documentos encolada/diferida, con versionado y reintentos
      (§5.2, §11.3, C-04).
- [x] Notificaciones de acuse, alerta P1, cambio de estado y aviso al
      desarrollador, con deduplicación (RN-026).
- [x] Cola de reintento de correo por cuota (A-12).
- [x] `configurarTriggers` idempotente.
- [x] Suite en verde (`npm test`, 86/86).
- [ ] Instalación real de triggers y prueba de envío de Gmail real
      (pendiente de cuenta Workspace, igual que fases anteriores).

## Próximos pasos (Fase 5)

- Backoffice real: dashboard con Chart.js, detalle de solicitud,
  `getDashboardData`/`getSolicitudDetalle`.
- `agregarComentario` y cache del dashboard vía `CacheService` (C-13).

## Commits sugeridos

```
feat(backend): mocks de DriveApp/DocumentApp/GmailApp/ScriptApp
feat(backend): esquema ARCHIVOS + doc_reintentos/version_documento + reintentos en LOG_NOTIFICACIONES
feat(backend): Drive.subirArchivo con validacion de tamano y MIME real (§5.3)
feat(backend): estructura de carpetas de Drive idempotente (§11.1)
feat(backend): Documentos.procesarColaDocumentos con versionado y reintentos (§5.2, C-04)
feat(backend): Notificaciones.gs con dedup por solicitud+evento+destinatario (RN-026)
feat(backend): Triggers.configurarTriggers idempotente (§13)
test(backend): suite Fase 4 (archivos, documentos, notificaciones, triggers)
docs: documentacion de la Fase 4
```
