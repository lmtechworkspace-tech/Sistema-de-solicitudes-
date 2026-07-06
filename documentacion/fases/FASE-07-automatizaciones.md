# Fase 7 — Automatizaciones, KPIs y triggers restantes

Fuente de verdad: `SIGSO_EspecificacionCompleta_v1.0.docx` (§13 Matriz de
Automatizaciones AUTO-001 a AUTO-016, §16.3 Configuración de Triggers, §17
KPIs e Indicadores, RN-027/029, RF-019) + `SIGSO_Especificacion_Refinada_v1.1.docx`
(§13 tabla A-01 a A-13, que reemplaza la de v1.0 — ver
[RECONCILIACION-v1.0.md](RECONCILIACION-v1.0.md)). Depende de las Fases 0-6.

## Objetivo

Cerrar las automatizaciones de tiempo que quedaban pendientes desde la Fase
4 (A-07 a A-11 de v1.1), los reportes programados de §17.4 v1.0, y la vista
de logs de automatizaciones (RF-019) que la Fase 6 dejó para esta fase.

## Alcance de esta fase

Incluido:

- **A-07 (`Triggers.verificarSLAs`)**: recorre `SUBSOLICITUDES` abiertas,
  calcula horas hábiles consumidas vs. `sla_objetivo_horas` (misma función
  `Utils.horasHabilesEntre` de la Fase 2) y dispara A-08 o A-09 según el
  ratio. Corre diario a las 09:00 (America/Santiago).
- **A-08/09 (`Notificaciones.alertaSLAProximo`/`alertaSLAVencido`)**: email
  a Analista+Admin de la empresa. RN-027 ("SLA vencido notifica 1 vez/día")
  se implementa generalizando `yaNotificadoRecientemente_`/`enviarCorreo_`
  con una ventana de dedup configurable (24h para SLA vencido, en vez de
  los 30 minutos por defecto de RN-026).
- **A-10 (`Dashboard.refrescarCache` en trigger)**: se agrega a
  `configurarTriggers` con la misma cadencia de 5 minutos que las colas de
  documentos/correo (v1.0 sugiere 30 min, pero el `CACHE_TTL_SEGUNDOS` real
  de la Fase 5 es de 5 min — se prioriza esa consistencia, ver Decisiones).
- **A-11 (`Auth.suspenderInactivos`, RN-029)**: desactiva usuarios con más
  de 90 días sin acceso. Corre semanal, lunes 08:00. No suspende usuarios
  que nunca accedieron (`ultimo_acceso` vacío).
- **Soporte real para RN-029**: `Code.gs` (Backoffice) ahora actualiza
  `USUARIOS.ultimo_acceso` en cada request autenticado — sin esto,
  `suspenderInactivos` no tenía datos reales de los que partir.
- **§17.4 v1.0 — Reportes programados**: `Notificaciones.enviarResumenSemanal`
  (lunes 09:00, a Analista+Admin) y `Notificaciones.enviarReporteMensual`
  (día 1, a Analista+Admin+Desarrollador), uno por empresa, reusando
  `Dashboard.getData` (Fase 5) para los KPIs.
- **RF-019 — Vista de logs de automatizaciones**: `Notificaciones.listarLogs`
  (solo Admin, más recientes primero) + pestaña "Automatizaciones" en
  `admin.html`.
- `configurarTriggers` ahora instala 7 triggers de tiempo (2 de la Fase 4 +
  5 nuevos), sigue siendo idempotente.
- 9 pruebas nuevas (143 en total).

Explícitamente fuera de esta fase:

- **`limpiarSesionesExpiradas` (AUTO-011 v1.0)**: v1.1 la retira
  explícitamente ("al no haber sesiones propias, no hay tokens que
  limpiar") — no se implementa.
- **Persistir un flag `sla_vencido` en `SUBSOLICITUDES`**: se mantiene el
  cálculo al vuelo (decisión ya tomada en la segunda reconciliación con
  v1.0, ver RECONCILIACION-v1.0.md) — `verificarSLAs` solo envía alertas,
  no escribe estado.
- **Exportación de datos a Excel (RF-019)**: sigue en backlog, sin fecha.

## Decisiones y supuestos

| Decisión | Detalle |
|---|---|
| Refresco de cache cada 5 min, no 30 | v1.0 fija 30 min en su ejemplo de `configurarTriggers`, pero esta implementación ya tiene `CACHE_TTL_SEGUNDOS = 300` (5 min) desde la Fase 5. Refrescar cada 30 min dejaría el cache "frío" la mayor parte del tiempo (C-13 busca justo evitarlo). |
| Dedup de SLA vencido con ventana de 24h, no por día calendario | RN-027 dice "1 vez/día". Anclar al día calendario de Chile exigiría más lógica (zonas horarias) para un beneficio marginal; una ventana deslizante de 24h cumple la misma intención (no saturar de correos) con el mismo mecanismo de dedup ya usado en toda la app. |
| `suspenderInactivos` no respeta el mínimo de 2 Admins (RN-030) | RN-030 está definida específicamente para `Auth.gestionarUsuario` (una acción manual). La especificación no extiende esa excepción a la suspensión automática por inactividad; se implementó literal. Si en producción esto genera un caso real (una empresa se queda sin Admin activo por inactividad simultánea), es un ajuste acotado a `Auth.suspenderInactivos`. |
| Reportes semanal/mensual, uno por empresa | La especificación (§17.4) no distingue por empresa, pero SIGSO es multiempresa (HomePymes/RLD) desde el diseño original — un solo reporte global mezclaría KPIs de ambas. Se itera sobre las empresas presentes en `USUARIOS` y se reusa `Dashboard.getData({ empresa_id })` (ya soporta ese filtro desde la Fase 5). |
| `listarLogs` limita a 100 filas por defecto | RF-019 no fija un límite; se eligió uno razonable para no cargar toda la hoja en cada apertura del panel, ajustable vía `data.limite`. |

## Cómo correr las pruebas

```bash
npm test
```

143 casos: 134 de Fases 0-6 + 9 de automatizaciones (`Triggers.verificarSLAs`,
`Auth.suspenderInactivos`, `ultimo_acceso`, reportes programados, `listarLogs`).

## Cómo probar en el navegador

```bash
node backend/dev-server-backoffice.js
npx http-server frontend -p 8080
```

Editar temporalmente `BACKOFFICE_URL` en `frontend/js/config.js` →
`http://localhost:8788?actuar_como=admin@homepymes.cl`. Abrir `admin.html`
→ pestaña "Automatizaciones": se probó generando una notificación real
(`actualizarEstado` sobre una subsolicitud de ejemplo) y confirmando que
aparece en la tabla de logs con evento, destinatario y resultado correctos.

## Checklist de la Fase 7

- [x] `Triggers.verificarSLAs` (A-07) + `alertaSLAProximo`/`alertaSLAVencido` (A-08/09).
- [x] RN-027 (SLA vencido, máx. 1 email/día) implementada y probada.
- [x] `Dashboard.refrescarCache` conectado a un trigger de tiempo (A-10).
- [x] `Auth.suspenderInactivos` (A-11, RN-029) + `ultimo_acceso` real.
- [x] Reportes programados (§17.4): resumen semanal y reporte mensual.
- [x] `Notificaciones.listarLogs` + pestaña "Automatizaciones" en `admin.html`.
- [x] `configurarTriggers` instala los 7 triggers, sigue siendo idempotente.
- [x] Verificado en navegador (log real de notificación visible en el panel).
- [x] Suite en verde (`npm test`, 143/143).

## Próximos pasos (Fase 8)

- QA integral: revisión end-to-end de los flujos completos (ingreso →
  aprobación → desarrollo → cierre) con datos reales de ambas empresas.
- Checklist de go-live (§17.2 v1.0): creación de la planilla real, carga de
  catálogos (empresas/plataformas/módulos), feriados de Chile del año en
  curso, despliegue de los 3 proyectos Apps Script y reemplazo de las URLs
  en `frontend/js/config.js`.

## Commits sugeridos

```
feat(backend): Triggers.verificarSLAs + alertaSLAProximo/Vencido (A-07/08/09, RN-027)
feat(backend): wiring de refrescarCache a trigger de tiempo (A-10)
feat(backend): Auth.suspenderInactivos + ultimo_acceso real en cada request (A-11, RN-029)
feat(backend): reportes programados (resumen semanal, reporte mensual, §17.4)
feat(backend): Notificaciones.listarLogs (RF-019)
feat(frontend): pestaña "Automatizaciones" en admin.html
test(backend): suite Fase 7 (SLA, inactivos, reportes, logs) + mocks de ScriptApp
docs: documentacion de la Fase 7
```
