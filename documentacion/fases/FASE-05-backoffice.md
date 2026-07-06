# Fase 5 — Backoffice (dashboard y detalle)

Fuente de verdad: `SIGSO_Especificacion_Refinada_v1.1.docx` (§5.5, C-13) +
`SIGSO_EspecificacionCompleta_v1.0.docx` (RF-017/018, §12.4/12.5).
Depende de las Fases 0-4.

## Objetivo

El Backoffice real: dashboard con KPIs y gráficos, detalle completo de una
solicitud (subsolicitudes, historial, comentarios) y las acciones de
cambiar estado/prioridad ya conectadas a la UI.

## Alcance de esta fase

Incluido:

- `Dashboard.getData(filtros, contexto)` con cache vía `CacheService`
  (C-13, §5.5): resumen (abiertas, críticas, SLA vencido, del día),
  agrupaciones (empresa, plataforma, tipo, estado, prioridad, top 5
  módulos), tiempo promedio de resolución, tendencia mensual (6 meses) y
  lista de recientes. Filtros por empresa/estado/prioridad.
- `Solicitudes.getDetalle(solicitudId)`: solicitud + subsolicitudes +
  historial de estados + historial de prioridad + comentarios.
- `Comentarios.agregarComentario(data, contexto)` (RF-018), con soporte de
  comentario interno (`es_interno`).
- `app.html` real: dashboard con Chart.js (gráficos por estado/prioridad/
  empresa), tarjetas KPI, tabla de recientes clicable, y vista de detalle
  con acordeón de subsolicitudes, timeline de historial, hilo de
  comentarios y paneles para cambiar estado/prioridad.
- `backend/dev-server-backoffice.js`: servidor local (no se despliega) que
  permite simular distintos usuarios/roles vía `?actuar_como=email` en la
  URL, sin tocar el contrato de transporte real (§4.1).
- 21 pruebas nuevas (107 en total).

Explícitamente fuera de esta fase:

- `guardarCatalogo` / `gestionarUsuario` (administración): Fase 6.
- Triggers de refresco de cache (`Dashboard.refrescarCache`) y de SLA:
  la función existe y el cache se autorrepara al expirar (fallback a
  lectura directa, tal como pide C-13), pero conectarla a un trigger de
  tiempo periódico es Fase 7 (Automatizaciones).
- Filtro por período (semana/mes/trimestre/custom) del dashboard (§12.4
  v1.0): se implementaron los filtros de empresa/estado/prioridad; el de
  período queda para cuando el volumen real de datos lo justifique.

## Decisiones y supuestos

| Decisión | Detalle |
|---|---|
| "Vista filtrada" del Developer sin campo de asignación | El modelo no tiene `desarrollador_asignado` (ver RECONCILIACION-v1.0.md). Se interpretó como: el rol `DEV` solo ve solicitudes en estados de trabajo activo (S04-S07) por defecto, salvo que pida un estado específico. |
| `getSolicitudDetalle` sin restricción de ámbito por rol | El router (§4.2) dice "según ámbito del rol" pero no hay un campo de asignación con el que acotar esa vista. Cualquier rol autenticado del Backoffice puede ver el detalle completo. Se ajusta si en el futuro se agrega asignación explícita. |
| Sin duplicar `TRANSICIONES_VALIDAS` en el frontend | El selector de "nuevo estado" ofrece los 11 estados; el backend es la única fuente de verdad sobre qué transición es válida para qué rol, y responde con un mensaje claro si no lo es (verificado en el navegador: Admin rechazado, Analista aceptado, para la misma transición S02→S03). |
| `dev-server-backoffice.js` simula el usuario vía query string, no headers | Mantiene el contrato de transporte real intacto (§4.1, sin headers custom) — es una comodidad de testing que vive enteramente en la URL de desarrollo, nunca en el código de producción del frontend. |

## Cómo correr las pruebas

```bash
npm test
```

107 casos: 86 de Fases 0-4 + 7 de `Dashboard.getData` + 3 de `getDetalle` +
4 de `Comentarios` + los ajustes de los smoke tests existentes.

## Cómo probar en el navegador

```bash
node backend/dev-server-backoffice.js   # puerto 8788
npx http-server frontend -p 8080
```

Editar temporalmente `BACKOFFICE_URL` en `frontend/js/config.js`:
`http://localhost:8788?actuar_como=admin@homepymes.cl` (o
`analista@homepymes.cl` / `dev@homepymes.cl` para probar otros roles).
Revertir antes de commitear.

Verificado manualmente en esta fase: dashboard con KPIs y gráficos reales,
tabla de recientes clicable, detalle completo de una solicitud, envío de
comentario, y la regla de roles en `actualizarEstado` funcionando en la UI
(Admin rechazado con mensaje claro, Analista aceptado, para la misma
transición).

## Checklist de la Fase 5

- [x] `Dashboard.getData` con cache y fallback a lectura directa (C-13).
- [x] `getSolicitudDetalle` y `agregarComentario` conectados.
- [x] Dashboard real con Chart.js, KPIs, filtros y tabla clicable.
- [x] Detalle real con subsolicitudes, historial, comentarios y acciones.
- [x] Verificado en navegador con datos reales y distintos roles.
- [x] Suite en verde (`npm test`, 107/107).
- [ ] Trigger de refresco periódico del cache (Fase 7).

## Próximos pasos (Fase 6)

- `guardarCatalogo`: administración de empresas/plataformas/módulos/tipos.
- `gestionarUsuario`: alta/edición/suspensión de usuarios (RN-029/030).
- Panel de administración (`admin.html`, §12.6 v1.0).

## Commits sugeridos

```
feat(backend): mock de CacheService y esquema COMENTARIOS verificado
feat(backend): Dashboard.getData con cache (C-13) y vista filtrada por rol
feat(backend): Solicitudes.getDetalle y Comentarios.agregarComentario
chore(backend): dev-server-backoffice.js para probar app.html localmente
feat(frontend): dashboard real con Chart.js, KPIs, filtros y tabla
feat(frontend): panel de detalle de solicitud con acciones
test(backend): suite Fase 5 (dashboard, detalle, comentarios)
docs: documentacion de la Fase 5
```
