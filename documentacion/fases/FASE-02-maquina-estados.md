# Fase 2 — Máquina de estados y reglas de negocio

Fuente de verdad: `documentacion/SIGSO_Especificacion_Refinada_v1.1.docx` (§7.2 resto, §8, §9, §10).
Depende de las Fases 0 y 1 (transporte, esquema, `crearSolicitud`).

## Objetivo

El punto de mayor riesgo técnico según la auditoría: la máquina de estados
(S01-S11, estado derivado del padre) y el cálculo de SLA en horas hábiles,
con feriados y horario de verano resueltos automáticamente en vez de
hardcodeados.

## Alcance de esta fase

Incluido:

- `Solicitudes.actualizarEstado(data, contexto)` (Backoffice) — tabla de
  transiciones válidas por rol (`TRANSICIONES_VALIDAS`, §9.1-9.4, RN-012,
  RN-013, RN-016), comentario obligatorio en rechazos/reaperturas,
  validación RN-015, registro en `HISTORIAL_ESTADOS`.
- `estado_derivado` del padre recalculado en cada transición (§8.2, C-08):
  mínimo entre subsolicitudes activas, `S09` solo si todas las no
  rechazadas están en `S09`, `S10`/`S11` cuando todas están cerradas.
- `Solicitudes.actualizarPrioridad(data, contexto)` — RN-007 (Analista
  modifica sin tope, justificación ≥20 caracteres, historial en la nueva
  hoja `HISTORIAL_PRIORIDAD`), RN-008 (Developer bloqueado), RN-009 (Admin
  fija `orden_atencion` en la solicitud).
- `Utils.horasHabilesEntre(inicio, fin, opciones)` — jornada L-V 09:00-18:00
  America/Santiago, feriados, pausas explícitas (S06), horario de verano
  resuelto vía `Intl.DateTimeFormat` (nunca UTC-3/UTC-4 hardcodeado).
- Resolución de rol por email (`obtenerRolUsuario_`, USUARIOS) integrada al
  router del Backoffice, con `forbidden` si el usuario no está registrado o
  está inactivo.
- 58 pruebas automatizadas (`npm test`), incluyendo la consistencia de
  esquema ahora entre **tres** proyectos (Intake, Backoffice, Instalador).

Explícitamente fuera de esta fase:

- Confirmación de cierre por el propio Solicitante (S08→S09 vía magic
  link) y cancelación directa en S01/S02 (RN-016): viajan por la App
  Pública, no por este endpoint autenticado — Fase 3/4.
- Alertas de SLA al 80%/100%, escalación automática de dos P1 (RN-009):
  automatizaciones con trigger de tiempo — Fase 7.
- `getDashboardData`, `getSolicitudDetalle`, `agregarComentario`,
  `guardarCatalogo`, `gestionarUsuario`: siguen respondiendo `internal`
  documentado (Fases 5/6).

## Decisiones y supuestos (léase antes de tocar la máquina de estados)

| Decisión | Detalle |
|---|---|
| `actualizarEstado`/`actualizarPrioridad` operan sobre `subsolicitud_id` | El router (§4.2) usa un "id" genérico y ambiguo; §8 modela el estado y la prioridad a nivel de subsolicitud, así que se adoptó esa granularidad. Documentado también en Fase 1. |
| Rol resuelto desde `USUARIOS` en el propio router del Backoffice | RN-007/008 y la columna "Asigna" de §8.1 son inherentes a esta fase; sin resolución de rol no hay forma de aplicarlas. La gestión (alta/edición) de usuarios sigue siendo Fase 6. |
| `HISTORIAL_PRIORIDAD` (hoja nueva) | RN-007 exige que cada cambio de prioridad "quede en historial"; ninguna hoja de §6 tiene esa forma (`HISTORIAL_ESTADOS` es específicamente de estados, RN-014). Ver `database/schema.md`. |
| Destino de S10 al reabrir (RN-013) | La especificación no fija el estado destino cuando el Admin reabre una solicitud rechazada. Se asumió `S10 → S03` (vuelve a revisión), análogo a `S09 → S05` que sí está explícito. |
| `orden_atencion` dentro de `actualizarPrioridad` | RN-009 no aparece como acción propia en el router de §4.2; se expone como una capacidad adicional restringida a Admin dentro de `actualizarPrioridad`, ya que edita el mismo tipo de dato (prioridad/orden de atención). |
| Cancelación aprobada (RN-016) permitida desde S03 hasta S08 | El texto dice "desde S03" sin acotar hasta dónde; se interpretó como válida en cualquier estado activo posterior, no solo en S03. |

## Cómo correr las pruebas

```bash
npm test
```

58 casos: Fases 0-1 (31) + máquina de estados (11) + prioridad (6) + Utils
horas hábiles (10, incluye cruce de DST real de Chile en abril 2026, fin de
semana, feriados y pausas) + consistencia de esquema entre los tres
proyectos.

## Cómo se verificó `horasHabilesEntre` sin una librería de timezones

`Utils.gs` no incluye ninguna tabla de reglas de horario de verano: usa
`Intl.DateTimeFormat` para preguntar, para cada instante, qué hora es en
`America/Santiago`. Esto funciona igual en Apps Script V8 (que soporta
`Intl` con `timeZone`) y en Node con ICU completo, por lo que se pudo
probar con datos reales del calendario chileno 2026:

```
node -e "... offsetMinutos_(new Date('2026-07-01...'), 'America/Santiago')"
// julio (invierno): -240 (UTC-4)
// enero (verano):   -180 (UTC-3)
```

El test `el calculo cruza correctamente el cambio de horario de verano`
verifica primero que el offset efectivamente cambia entre las fechas usadas
(para no quedar en falso positivo si la regla de DST de Chile cambia en el
futuro), y luego confirma que el total de horas hábiles across ese fin de
semana es correcto sin importar el cambio.

## Checklist de la Fase 2

- [x] Tabla de transiciones válidas por rol implementada y probada.
- [x] `estado_derivado` recalculado correctamente en los 4 casos de §8.2.
- [x] RN-007/008/009 implementados con historial propio.
- [x] `Utils.horasHabilesEntre` cubre jornada, fin de semana, feriados,
      pausas y DST real.
- [x] Resolución de rol por email conectada al router del Backoffice.
- [x] Suite en verde (`npm test`, 58/58).
- [ ] Validación end-to-end contra Sheets reales con datos de prueba
      (pendiente de cuenta Workspace, igual que fases anteriores).

## Próximos pasos (Fase 3)

- Frontend público: `index.html` (formulario progresivo) y `estado.html`
  (consulta por magic link) con el contrato `text/plain`.
- Endpoint público `consultarEstado` (hoy responde `internal`).

## Commits sugeridos

```
feat(backend): esquema HISTORIAL_PRIORIDAD y duplicacion en Backoffice/Instalador
feat(backend): tabla de transiciones y Solicitudes.actualizarEstado (§8, §9)
feat(backend): estado_derivado del padre recalculado por transicion (C-08)
feat(backend): Solicitudes.actualizarPrioridad con historial (RN-007/008/009)
feat(backend): Utils.horasHabilesEntre con soporte de DST via Intl (§10)
feat(backend): resolucion de rol por email en el router del Backoffice
test(backend): suite Fase 2 (maquina de estados, prioridad, horas habiles)
docs: documentacion de la Fase 2
```
