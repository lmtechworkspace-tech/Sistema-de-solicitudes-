# Fase 0 — Fundamentos e infraestructura

Fuente de verdad: `documentacion/SIGSO_Especificacion_Refinada_v1.1.docx` (SIGSO v1.1).

## Objetivo

Dejar en pie, probado y ejecutable el **transporte** entre frontend y backend
antes de escribir una sola regla de negocio. Es el bloqueador de día 1 que
identifica la auditoría (§4, §17): Apps Script no permite fijar headers CORS
arbitrarios y un `fetch` con `Content-Type: application/json` dispara un
preflight `OPTIONS` que el Web App no responde. Si esto no queda resuelto y
probado, ninguna fase posterior es viable.

## Alcance de esta fase

Incluido:

- Separación en dos superficies de ejecución: App Pública (Intake) y App
  Gestión (Backoffice) — §2.1.
- Esqueleto de ambos proyectos Apps Script: `doGet`/`doPost`, router de
  `action`, envoltura de respuesta `{ ok, data | error }` (§4.3), manejo de
  errores con referencia de log.
- Contrato de llamada obligatorio: POST + `Content-Type: text/plain;charset=utf-8`
  + cuerpo string JSON (§4.1).
- Resolución de identidad en el Backoffice vía `Session.getActiveUser()`,
  con rechazo `forbidden` si no hay email de dominio resuelto (§3.1).
- Timezone del proyecto fijado en `America/Santiago` en ambos
  `appsscript.json` (§10).
- Configuración por `PropertiesService` (Script Properties), nunca IDs
  hardcodeados en el código (`Config.gs` en cada proyecto).
- `config.js` / `api.js` en el frontend con el mismo contrato de transporte.
- Páginas stub (`index.html`, `estado.html`, `app.html`) que permiten probar
  la conexión (`action=ping`) contra cada Web App una vez desplegado.
- Suite de pruebas automatizadas (`node --test`) que simula el runtime de
  Apps Script y verifica el contrato sin depender de una cuenta Google.

Explícitamente fuera de esta fase (llega en fases futuras):

- Modelo de datos en Sheets, `COUNTERS`, `generarId()` (Fase 1).
- Cualquier lógica de negocio: `crearSolicitud`, `subirArchivo`,
  `getCatalogos`, `consultarEstado`, dashboard, administración. Todas estas
  acciones ya están registradas en el router pero responden
  `{ ok:false, error:'internal', ref:'NOT_IMPLEMENTED_FASE0' }` a propósito.
- Diseño visual (§12.3): los stubs usan HTML mínimo, sin la identidad de
  marca. Eso es Fase 3.

## Decisiones de diseño y por qué

| Decisión | Motivo |
|---|---|
| Dos proyectos Apps Script separados, cada uno con su propio `Config.gs`/`Code.gs` | Apps Script no permite compartir código entre Web Apps sin publicar una librería; duplicar estos dos archivos pequeños es más simple y explícito que introducir esa dependencia en la Fase 0 (§2.1). |
| `action=ping` en ambos routers | No está en la tabla de endpoints de la especificación (§4.2); se agrega como diagnóstico de infraestructura para la prueba de humo de esta fase. No reemplaza ningún endpoint de negocio. |
| IDs vía `PropertiesService` en vez de constantes en el código | Permite desplegar el mismo código en distintos ambientes (dev/prod) sin tocar el fuente, y evita commitear IDs de Sheets/Drive reales. |
| Pruebas con `node:test` + `node:vm` en vez de `clasp`/Jest | Cero dependencias externas que instalar: Node trae ambos módulos. El `.gs` se carga tal cual en un contexto `vm` con mocks de `ContentService`, `PropertiesService`, `Utilities`, `Logger` y `Session` — igual a como corre en Apps Script, sin necesitar una cuenta Google para validar el contrato. |

## Estructura entregada

```
backend/
  intake/
    appsscript.json      (acceso ANYONE_ANONYMOUS, ejecuta como USER_DEPLOYING)
    Config.gs
    Code.gs
  backoffice/
    appsscript.json       (acceso DOMAIN, ejecuta como USER_ACCESSING)
    Config.gs
    Code.gs
  test/
    helpers/gasSandbox.js
    mocks/gas-globals.js
    intake.smoke.test.js
    backoffice.smoke.test.js
frontend/
  index.html / estado.html / app.html   (stubs con botón "probar conexión")
  css/main.css
  js/config.js
  js/api.js
package.json               (script "test")
```

## Cómo correr las pruebas

```bash
npm test
```

Ejecuta 12 casos que cubren: `ping` exitoso en ambas apps, timezone por
defecto, acción desconocida (`validation`), body JSON inválido o
`postData` ausente (`internal` con `ref`), rechazo por falta de identidad de
dominio en el Backoffice (`forbidden`), y que las acciones de negocio aún no
implementadas respondan de forma controlada en vez de lanzar una excepción
sin capturar.

## Cómo probar el contrato real contra Google (smoke test end-to-end)

Este paso requiere una cuenta Google Workspace real y no se puede automatizar
desde este entorno. Antes de dar por cerrada la Fase 0:

1. Crear dos proyectos Apps Script (o usar `clasp create` apuntando a las
   carpetas `backend/intake` y `backend/backoffice`).
2. Publicar Intake como Web App: **Ejecutar como:** cuenta que lo despliega ·
   **Acceso:** cualquiera.
3. Publicar Backoffice como Web App: **Ejecutar como:** usuario que accede ·
   **Acceso:** solo usuarios del dominio.
4. Copiar ambas URLs `/exec` en `frontend/js/config.js`
   (`INTAKE_URL` / `BACKOFFICE_URL`).
5. Servir `frontend/` (por ejemplo `npx http-server frontend`) y abrir
   `index.html` / `app.html`; el botón "Probar conexión" debe devolver
   `{ ok: true, data: { pong: true, ... } }` sin error de CORS ni preflight
   en la consola del navegador.
6. Repetir en `app.html` estando autenticado con una cuenta del dominio;
   verificar que `data.usuario` trae el email correcto.

Esto corresponde al ítem "Prueba de humo del contrato CORS (text/plain)
superada" del checklist de preparación (§17.2).

## Checklist de la Fase 0

- [x] Estructura de repositorio creada (§2.4).
- [x] Ambos Web Apps con esqueleto de router y manejo de errores.
- [x] Contrato `text/plain` implementado en backend y frontend.
- [x] Timezone `America/Santiago` fijado en ambos `appsscript.json`.
- [x] Identidad de dominio resuelta en Backoffice vía `Session.getActiveUser()`.
- [x] Suite de pruebas automatizada en verde (`npm test`).
- [ ] Prueba de humo real contra Google Apps Script desplegado (manual,
      pendiente de cuenta Workspace — ver sección anterior).

## Próximos pasos (Fase 1)

- Modelo de datos en Sheets: `SOLICITUD`, `SUBSOLICITUD`, `USUARIOS`,
  catálogos, `COUNTERS`, `CONFIG_FERIADOS` (§6).
- `generarId()` con `LockService` sobre `COUNTERS` (§5.4).
- `Solicitudes.crearSolicitud()` con validaciones RN-001–005 (§7.1) y
  deduplicación por hash (RF-F06, §5.1).
- Reemplazar el stub `getCatalogos` por la lectura real de catálogos.

## Commits sugeridos

```
feat(backend): esqueleto Apps Script Intake con router y contrato text/plain
feat(backend): esqueleto Apps Script Backoffice con identidad de dominio
test(backend): sandbox vm + smoke tests del contrato de transporte
feat(frontend): config.js/api.js y stubs de paginas para probar conexion
docs: documentacion de la Fase 0 (fundamentos e infraestructura)
```
