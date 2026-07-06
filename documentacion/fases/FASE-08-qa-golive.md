# Fase 8 — QA integral y go-live

Fuente de verdad: `SIGSO_Especificacion_Refinada_v1.1.docx` §17.2 ("Checklist
de preparación para desarrollo", que aquí se adapta a checklist de
*despliegue* porque el desarrollo ya está completo) + `SIGSO_EspecificacionCompleta_v1.0.docx`
§20.5 (versión original del mismo checklist). Depende de las Fases 0-7.

## Objetivo

Cerrar el ciclo de desarrollo por fases con una prueba de integración de
extremo a extremo (ingreso → aprobación → desarrollo → cierre, para ambas
empresas) y dejar un checklist ejecutable de todo lo que falta para que
alguien con acceso al Google Workspace real de HomePymes/RLD pueda poner
SIGSO en producción.

Esta fase **no despliega nada real**: no hay credenciales de Google
Workspace en este entorno de desarrollo, y crear recursos reales (Sheets,
Drive, Apps Script) es una acción que corresponde a la organización, no a
una tarea de código. Lo que esta fase entrega es la prueba de que el
sistema funciona de punta a punta y la guía exacta para el despliegue.

## Alcance de esta fase

Incluido:

- **QA integral**: `backend/test/e2e-ciclo-vida.test.js`, 3 pruebas de
  integración (no unitarias) que recorren:
  1. Ciclo de vida feliz completo S01→S02→S03→S04→S05→S07→S08→S09 para una
     solicitud de HomePymes, verificando en cada paso: transición de
     estado, generación real del documento al aprobar (cola A-04),
     asignación de desarrollador, notificaciones registradas (RF-019),
     `estado_derivado` final del padre, y que el Dashboard ya no la cuenta
     como abierta.
  2. Rechazo (S03→S10) y reapertura (RN-012/013, solo Admin con
     justificación) para una solicitud de RLD, verificando que un Analista
     no puede reabrir.
  3. Aislamiento multiempresa: HomePymes y RLD conviven en las mismas
     hojas sin filtrarse entre sí en el Dashboard.
- Este checklist de go-live (abajo).
- 3 pruebas nuevas (146 en total).

Explícitamente fuera de esta fase:

- Cualquier acción real contra un Google Workspace (crear Sheet, publicar
  Web Apps, etc.) — ver la nota de alcance arriba.
- Ítems de v1.1 §17.1 ("Diferido a versiones futuras"): SSO ampliado, PWA,
  portal de cliente self-service, IA de priorización, integración
  Jira/Linear, firma digital, API pública, notificaciones Telegram/Slack.
  Backlog v1.2: búsqueda, etiquetas, duplicar solicitud, exportar PDF desde
  el dashboard, modo oscuro.

## Checklist de go-live

Basado en v1.1 §17.2. Se marca **[Código]** lo que ya está resuelto por lo
construido en las Fases 0-7 (no requiere trabajo adicional) y **[Manual]**
lo que exige una acción humana en el Google Workspace/GitHub reales de la
organización.

| # | Ítem | Tipo | Detalle |
|---|---|---|---|
| 1 | Documento v1.1 aprobado por el equipo | Manual | Responsable: Rulac/Rogelio (fuera del alcance de este repositorio). |
| 2 | Cuenta/servicio Google Workspace con permisos para Sheets/Docs/Drive/Gmail/Apps Script | Manual | Administración de HomePymes/RLD. |
| 3 | Timezone del proyecto Apps Script fijado en `America/Santiago` | Código | `getConfig_()` en ambos proyectos ya usa `America/Santiago` como default (`Config.gs`); solo verificar que el proyecto Apps Script real tenga esa misma zona horaria en su configuración (Ajustes del proyecto). |
| 4 | Repositorio GitHub creado | Manual | Ya existe (este repositorio). Falta conectarlo a GitHub Pages para servir `frontend/`. |
| 5 | IDs de Sheets, carpetas Drive y ambos Web Apps registrados en `Config.gs`/`config.js` | Manual (con soporte de código) | El código ya lee estos valores desde Script Properties (`SIGSO_SHEET_ID`, `SIGSO_DRIVE_ROOT_FOLDER_ID`, `SIGSO_TIMEZONE`) y `frontend/js/config.js` (`INTAKE_URL`, `BACKOFFICE_URL`) — falta solo completarlos con los IDs reales tras crear los recursos (paso a paso abajo). |
| 6 | `CONFIG_FERIADOS` cargado con feriados de Chile del año en curso | Manual | La hoja se crea vacía por diseño (`backend/setup/Instalador.gs`); `Utils.horasHabilesEntre` ya excluye correctamente cualquier fecha que se cargue ahí (probado en `test/utils-horas-habiles.test.js`). |
| 7 | `COUNTERS` inicializado por empresa+año | Código | `Correlativo.gs` (`generarId_`) crea la fila la primera vez que se pide un número para una empresa+año, con `LockService` para evitar carreras — no requiere carga manual previa. |
| 8 | Catálogos iniciales (empresas, plataformas, módulos) cargados | Manual | Se cargan desde `admin.html` (Fase 6) una vez publicado el Web App de gestión. `CAT_TIPOS` es la excepción: se siembra solo (`Instalador.gs`, 7 tipos reales de RF-009). |
| 9 | Usuarios iniciales con rol (mín. 2 Admin) y emails de dominio | Manual | Se cargan desde `admin.html` (`Auth.gestionarUsuario`). RN-030 ya impide bajar de 2 Admin activos por empresa una vez cargados. |
| 10 | Plantilla `template_solicitud.gdoc` con marcadores | No aplica (decisión documentada) | Esta implementación no lee un `.gdoc` real: la plantilla vive como texto en `Documentos.gs` (`PLANTILLA_DOCUMENTO`) para que la generación sea autocontenida — ver supuesto en `database/schema.md` y `FASE-04-documentos-notificaciones.md`. Migrar a un `.gdoc` real es un cambio acotado si se necesita en el futuro. |
| 11 | Prueba de humo del contrato CORS (`text/plain`) superada | Código | `backend/test/*.smoke.test.js` la cubre en cada `npm test`; en producción se verifica repitiendo el mismo `fetch` contra las URLs `/exec` reales antes de anunciar el sistema (paso a paso abajo). |
| 12 | Comunicado oficial de uso obligatorio | Manual | Responsable: Rogelio (fuera del alcance de este repositorio). |

### Paso a paso de despliegue (orden sugerido)

1. Crear la planilla de Google Sheets real (vacía) y anotar su ID.
2. Crear la carpeta raíz en Drive (`SIGSO_Sistema/` según v1.0 §20.5) y
   anotar su ID.
3. Crear el proyecto Apps Script de `backend/setup/` (subir `Instalador.gs`
   + `Config.gs` + `Constantes.gs`), fijar `SIGSO_SHEET_ID` en Script
   Properties, y ejecutar `instalarHojas()` una vez (crea todas las hojas +
   siembra `CONFIG_SLA`/`CAT_TIPOS`).
4. Crear el proyecto Apps Script de `backend/intake/` (App Pública):
   subir todos los `.gs`, fijar `SIGSO_SHEET_ID`/`SIGSO_DRIVE_ROOT_FOLDER_ID`
   en Script Properties, publicar como Web App con "Ejecutar como: yo" y
   "Acceso: cualquier usuario, incluso anónimo" (§2.1).
5. Crear el proyecto Apps Script de `backend/backoffice/` (App Gestión):
   mismos `.gs`, mismas Script Properties, publicar como Web App con
   "Ejecutar como: usuario que accede" y "Acceso: solo usuarios del
   dominio" (§3.1). Ejecutar `configurarTriggers()` una sola vez (instala
   los 7 triggers de tiempo de la Fase 4/7).
6. Reemplazar `INTAKE_URL`/`BACKOFFICE_URL` en `frontend/js/config.js` con
   las URLs `/exec` reales de los pasos 4-5.
7. Repetir la prueba de humo del contrato CORS contra ambas URLs reales
   (un `fetch` POST con `text/plain` a cada una, verificando `ok: true`)
   antes de continuar — ítem 11 de la tabla.
8. Cargar catálogos (`admin.html`) y usuarios iniciales (mínimo 2 Admin por
   empresa) — ítems 8-9.
9. Cargar `CONFIG_FERIADOS` del año en curso — ítem 6.
10. Publicar `frontend/` en GitHub Pages (o el hosting estático elegido).
11. Enviar el comunicado oficial (ítem 12) y dar el sistema por operativo.

## Cómo correr las pruebas

```bash
npm test
```

146 casos: 143 de Fases 0-7 + 3 de QA integral (ciclo de vida completo,
rechazo/reapertura, aislamiento multiempresa).

## Checklist de la Fase 8

- [x] Prueba de integración de ciclo de vida completo (S01→S09) con
      generación real de documento, notificaciones y dashboard consistente.
- [x] Prueba de rechazo/reapertura con control de rol (RN-012/013).
- [x] Prueba de aislamiento multiempresa en el Dashboard.
- [x] Checklist de go-live basado en v1.1 §17.2, con paso a paso de
      despliegue real.
- [x] Suite en verde (`npm test`, 146/146).

## Commits sugeridos

```
test(backend): E2E de ciclo de vida completo (S01-S09), rechazo/reapertura y multiempresa
docs: checklist de go-live (Fase 8) y paso a paso de despliegue real
```
