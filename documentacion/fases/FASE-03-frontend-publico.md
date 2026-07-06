# Fase 3 — Frontend público

Fuente de verdad: `documentacion/SIGSO_Especificacion_Refinada_v1.1.docx` (§2.4, §3.2, §4.1, §12.1, §12.2, §12.3).
Depende de las Fases 0-2 (transporte, `crearSolicitud`, `getCatalogos`).

## Objetivo

El formulario público de ingreso y la consulta pública de estado,
funcionando de punta a punta contra el backend real (no un mock),
respetando el contrato `text/plain` y la identidad visual de la
especificación.

## Alcance de esta fase

Incluido:

- `index.html` + `js/formulario.js`: formulario progresivo (§12.2) —
  selects encadenados Empresa→Plataforma→Módulo vía `getCatalogos`, toggle
  "¿solicitud de cliente?", acordeón de subsolicitudes (mín. 1, máx. 10,
  solo el ítem activo expandido), barra de progreso, borrador en
  `localStorage`, spinner + botón deshabilitado al enviar, éxito con número
  de solicitud + resumen WhatsApp copiable, error que conserva los datos.
- `estado.html` + `js/estado.js`: consulta pública por número + correo.
- `Solicitudes.estadoPublico()` (backend, Intake) conectado a la acción
  `consultarEstado`.
- CSS de marca (§12.3): variables de color naranja/azul/grises/prioridades,
  tipografía Inter/system-ui, en `css/main.css` (tokens + layout) y
  `css/formulario.css` (específico del formulario).
- `js/ui-components.js`: header/nav compartido entre `index.html`,
  `estado.html` y `app.html`.
- `js/utils.js`: etiquetas de estado (`S01`.."Nueva", etc.) compartidas.
- `backend/dev-server.js`: servidor local de desarrollo (no se despliega)
  que carga el Code.gs real de Intake en el mismo sandbox `vm` de los
  tests, con catálogos de ejemplo, para poder probar el formulario en el
  navegador sin depender de una cuenta Google.

Explícitamente fuera de esta fase:

- Adjuntar archivos (`subirArchivo`, §5.3): sigue sin implementar, el
  formulario no tiene campo de archivos todavía — llega en Fase 4 junto
  con la infraestructura de carpetas Drive (§11).
- Magic link real por Gmail: ver supuesto documentado abajo.
- `app.html` (Backoffice): sigue siendo el stub de la Fase 0 — Fase 5.

## Decisiones y supuestos

| Decisión | Detalle |
|---|---|
| `estadoPublico` compara el correo en texto plano, sin token | §3.2/§12.1 hablan de "verificación de correo" vía magic link (token de un solo uso enviado por Gmail). Implementar el envío real requiere `GmailApp`, que es Fase 4. Esta fase implementa la verificación por coincidencia directa de correo como paso intermedio funcional, documentado como limitación de seguridad conocida (cualquiera que conozca el email correcto puede consultar esa solicitud puntual; no hay forma de listar ni de adivinar el `solicitud_id`). Se endurece en Fase 4. |
| `backend/dev-server.js` reutiliza el sandbox `vm` de los tests | En vez de escribir un mock de API aparte para el frontend, se reusa `backend/test/helpers/gasSandbox.js` para correr el `Code.gs` real de Intake fuera de Google. Esto prueba la integración real (validaciones, dedup, correlativo) en el navegador, no una respuesta hardcodeada. Nunca se despliega; está separado claramente del código Apps Script. |
| Sin adjuntos en el formulario todavía | El backend no implementa `subirArchivo` (sigue en `NOT_IMPLEMENTED_FASE0`); agregar el campo de archivos sin backend que lo soporte sería una UI que no hace nada. Se difiere a la Fase 4 junto con Drive. |

## Cómo probar en el navegador

```bash
# Terminal 1
node backend/dev-server.js         # puerto 8787, backend real en memoria

# Terminal 2
npx http-server frontend -p 8080 -c-1
```

Con ambos corriendo, editar temporalmente `frontend/js/config.js` para que
`INTAKE_URL` apunte a `http://localhost:8787` (revertir antes de commitear:
el valor real de producción es el placeholder que reemplaza el checklist
§17.2). Abrir `http://localhost:8080/index.html` y `estado.html`.

Verificado manualmente en esta fase: selects encadenados con datos reales,
envío completo (`SOL-2026-HP-0001`, `SOL-2026-HP-0002` con prioridad `P1`
derivada de "Sistema caído"), toggle de cliente, acordeón con más de una
subsolicitud, consulta de estado exitosa y consulta rechazada por correo
no coincidente.

## Cómo correr las pruebas de backend

```bash
npm test
```

66 casos (58 de Fases 0-2 + 8 nuevos de `estadoPublico`).

## Checklist de la Fase 3

- [x] Formulario progresivo completo con selects encadenados reales.
- [x] Acordeón de subsolicitudes (1-10, un solo ítem expandido).
- [x] Borrador en `localStorage`, progreso, spinner anti doble envío.
- [x] Éxito con número + resumen WhatsApp copiable; error conserva datos.
- [x] Consulta pública de estado funcional (`estadoPublico` + `estado.html`).
- [x] Identidad visual de marca aplicada (§12.3).
- [x] Verificado en navegador real contra el backend real (dev-server).
- [x] Suite de backend en verde (`npm test`, 66/66).
- [ ] Publicación real en GitHub Pages + Web App de Google (pendiente de
      cuenta Workspace/GitHub, igual que fases anteriores).

## Próximos pasos (Fase 4)

- `subirArchivo` por-archivo con validación server-side (§5.3, C-06).
- Cola de generación de documentos (`doc_estado`, §5.2, C-04).
- Estructura de carpetas Drive (§11) y notificaciones por Gmail
  (acuse de recibo, alerta P1, magic link real).

## Commits sugeridos

```
feat(backend): Solicitudes.estadoPublico y accion consultarEstado
feat(frontend): tokens de marca (§12.3) y header/nav compartido
feat(frontend): formulario publico progresivo con selects encadenados y acordeon
feat(frontend): consulta publica de estado (estado.html)
chore(backend): dev-server local para probar el frontend sin Google
test(backend): suite de estadoPublico
docs: documentacion de la Fase 3
```
