# SIGSO — Sistema Integral de Gestión de Solicitudes

HomePymes / RLD — Departamento de Control.

Fuente de verdad: [`documentacion/SIGSO_Especificacion_Refinada_v1.1.docx`](documentacion/SIGSO_Especificacion_Refinada_v1.1.docx)
(arquitectura y reglas de negocio corregidas), complementado con
[`documentacion/SIGSO_EspecificacionCompleta_v1.0.docx`](documentacion/SIGSO_EspecificacionCompleta_v1.0.docx)
(catálogos, campos de formulario y entidades completas — ver
[RECONCILIACION-v1.0.md](documentacion/fases/RECONCILIACION-v1.0.md)).

SIGSO es una aplicación JAMstack de costo cero: frontend estático en GitHub
Pages, backend serverless en Google Apps Script (dos Web Apps separados —
público y de gestión), base de datos en Google Sheets, archivos en Google
Drive, documentos en Docs/PDF y notificaciones por Gmail.

## Cómo desplegar en producción

Guía paso a paso completa (GitHub Pages, Google Sheets, los 3 proyectos
Apps Script, carga de datos y primeras pruebas):
[documentacion/MANUAL-DESPLIEGUE.md](documentacion/MANUAL-DESPLIEGUE.md).

## Desarrollo por fases

El proyecto se construye en fases funcionales e independientes. Ninguna fase
avanza sin aprobación explícita. Cada una entrega código, pruebas,
documentación, README y commits sugeridos propios en
`documentacion/fases/`.

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Fundamentos e infraestructura: contrato CORS `text/plain`, esqueleto de ambos Web Apps, timezone | ✅ [documentacion/fases/FASE-00-fundamentos.md](documentacion/fases/FASE-00-fundamentos.md) |
| 1 | Modelo de datos y núcleo de solicitudes | ✅ [documentacion/fases/FASE-01-modelo-datos-nucleo.md](documentacion/fases/FASE-01-modelo-datos-nucleo.md) |
| 2 | Máquina de estados y reglas de negocio | ✅ [documentacion/fases/FASE-02-maquina-estados.md](documentacion/fases/FASE-02-maquina-estados.md) |
| 3 | Frontend público (formulario, consulta de estado) | ✅ [documentacion/fases/FASE-03-frontend-publico.md](documentacion/fases/FASE-03-frontend-publico.md) |
| 4 | Documentos y notificaciones | ✅ [documentacion/fases/FASE-04-documentos-notificaciones.md](documentacion/fases/FASE-04-documentos-notificaciones.md) |
| — | Reconciliación con SIGSO v1.0 (retrofit sobre Fases 1-4) | ✅ [documentacion/fases/RECONCILIACION-v1.0.md](documentacion/fases/RECONCILIACION-v1.0.md) |
| 5 | Backoffice (dashboard y detalle) | ✅ [documentacion/fases/FASE-05-backoffice.md](documentacion/fases/FASE-05-backoffice.md) |
| 6 | Administración (usuarios, catálogos) | ✅ [documentacion/fases/FASE-06-administracion.md](documentacion/fases/FASE-06-administracion.md) |
| 7 | Automatizaciones, KPIs y triggers restantes | ✅ [documentacion/fases/FASE-07-automatizaciones.md](documentacion/fases/FASE-07-automatizaciones.md) |
| 8 | QA integral y go-live | ✅ [documentacion/fases/FASE-08-qa-golive.md](documentacion/fases/FASE-08-qa-golive.md) |

## Estructura del repositorio

```
backend/
  intake/       Apps Script — App Pública (acceso anónimo)
  backoffice/   Apps Script — App Gestión (identidad Google del dominio)
  setup/        Apps Script — instalador del esquema de Sheets (una sola vez)
  test/         Pruebas automatizadas (node:test + vm, sin cuenta Google)
  dev-server.js             Dev server de Intake (no se despliega, ver Fase 3)
  dev-server-backoffice.js  Dev server de Backoffice (no se despliega, ver Fase 5)
frontend/
  index.html    Formulario público de solicitudes
  estado.html   Consulta pública de estado
  app.html      Backoffice: dashboard + detalle de solicitud
  admin.html    Administración: catálogos y usuarios (Fase 6)
  css/ js/      Estilos y lógica compartida (marca §12.3, ui-components.js, dashboard.js, detalle.js)
database/       schema.md — esquema documentado de las hojas (Fase 1)
documentacion/  Especificación fuente + documentación por fase
```

## Cómo correr las pruebas

```bash
npm test
```

## Cómo probar el frontend en el navegador (sin cuenta Google)

```bash
node backend/dev-server.js             # Intake real en memoria, puerto 8787
node backend/dev-server-backoffice.js  # Backoffice real en memoria, puerto 8788
npx http-server frontend -p 8080       # sirve el frontend estatico
```

Editar temporalmente en `frontend/js/config.js`: `INTAKE_URL` →
`http://localhost:8787`, `BACKOFFICE_URL` →
`http://localhost:8788?actuar_como=admin@homepymes.cl` (o
`analista@homepymes.cl` / `dev@homepymes.cl` para otros roles). Revertir
antes de commitear.

## Requisitos invariantes

Presupuesto $0 · Solo Google Workspace + GitHub · Hosting GitHub Pages ·
Backend Apps Script · BD Google Sheets · Archivos Google Drive · Sistema
multiempresa (HomePymes + RLD).
