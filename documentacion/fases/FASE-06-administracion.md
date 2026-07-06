# Fase 6 — Administración (usuarios, catálogos)

Fuente de verdad: `SIGSO_EspecificacionCompleta_v1.0.docx` (RF-006/007/019,
CU-006, CU-007, §8.7, §12.6, Actores §5) + `SIGSO_Especificacion_Refinada_v1.1.docx` (§3.1, §6).
Depende de las Fases 0-5.

## Objetivo

Cerrar el router (§4.2): las dos acciones que faltaban —
`guardarCatalogo` y `gestionarUsuario` — y el panel de administración real
(`admin.html`). Además, corrige dos vacíos reales encontrados al releer
`SIGSO_EspecificacionCompleta_v1.0.docx` de punta a punta (ver
[RECONCILIACION-v1.0.md](RECONCILIACION-v1.0.md)): campos de catálogo
(`logo`, `url_base`) y de asignación (`analista_asignado`,
`desarrollador_asignado`).

## Alcance de esta fase

Incluido:

- `Catalogos.guardar(data, contexto)`: crea o actualiza un registro de
  `CAT_EMPRESAS`/`CAT_PLATAFORMAS`/`CAT_MODULOS`/`CAT_TIPOS` (nunca
  elimina — "desactivar" es `activo=false`, RF-F03). Permisos: Admin
  administra los 4 catálogos; Analista solo Módulos y Tipos ("nivel
  básico", Actor Analista, doc 5 v1.0).
- `Catalogos.listar(data, contexto)`: lista un catálogo completo (activos
  e inactivos) para el panel de administración — no es una acción del
  router de §4.2, se agregó porque `Catalogos.getAll()` (Intake) solo
  expone activos al formulario público.
- `Auth.gestionarUsuario(data, contexto)`: crea/edita usuarios, solo Admin.
  Aplica RN-030 (mínimo 2 Administradores activos por empresa) antes de
  desactivar un Admin o bajarle el rol.
- `Auth.listarUsuarios(data, contexto)`: lista todos los usuarios (mismo
  criterio que `Catalogos.listar`).
- Asignación de responsables: `actualizarPrioridad` ahora también acepta
  `desarrollador_asignado` (Analista/Admin) y `analista_asignado` (solo
  Admin) sobre una `SOLICITUD` — Actores §5 v1.0 menciona que el
  Desarrollador debe poder "ver solicitudes asignadas a él".
- `Dashboard.getData`: la "vista filtrada" del rol `DEV` ahora usa
  `desarrollador_asignado` real, con respaldo a estados de trabajo activo
  (S04-S07) para solicitudes aún sin asignar.
- `admin.html`: panel con menú lateral (Empresas, Plataformas, Módulos,
  Tipos, Usuarios), tabla + formulario genérico de alta/edición por
  sección (§12.6, CU-006/CU-007).
- Esquema: `logo` en `CAT_EMPRESAS`, `url_base` en `CAT_PLATAFORMAS`
  (RF-006/007 v1.0).
- 23 pruebas nuevas (129 en total).

Explícitamente fuera de esta fase:

- Vista de logs de automatizaciones (RF-019, §12.6): Fase 7, junto con las
  automatizaciones que los generan.
- Exportación de datos a Excel (RF-019): backlog, sin fecha.
- Jerarquía de módulos (`modulo_padre_id`) y `orden_display`: ver
  RECONCILIACION-v1.0.md — se dejaron fuera deliberadamente.

## Decisiones y supuestos

| Decisión | Detalle |
|---|---|
| Asignación se agrupa en `actualizarPrioridad`, no una acción nueva | El router de §4.2 no define una acción de "asignar"; se agrupó con `actualizarPrioridad` porque ambas tocan campos "administrativos" de `SOLICITUDES` (mismo patrón ya usado para `orden_atencion`, RN-009). |
| `Catalogos.listar` / `Auth.listarUsuarios` no están en el router literal | Necesarias para que el panel de administración pueda mostrar una tabla editable (CU-006/CU-007 exigen "ver y editar"); sin una acción de lectura completa, `admin.html` no podría funcionar. Documentado como adición justificada, igual criterio que `ping` en la Fase 0. |
| Reasignar el Analista responsable requiere Admin, pero asignar Desarrollador no | RF-019/Actor Analista dice que el Analista es quien aprueba y deriva el trabajo al desarrollador — asignarlo es parte de su operación diaria. Reasignar al Analista responsable de una solicitud es una decisión de administración, no operativa. |
| Vista filtrada del Developer con respaldo | Si un Desarrollador todavía no tiene ninguna solicitud asignada (dato nuevo, planillas existentes no lo tienen poblado), el dashboard no debe verse vacío: cae a mostrar las solicitudes en estados de trabajo activo sin asignar. |

## Cómo correr las pruebas

```bash
npm test
```

129 casos: 108 de Fases 0-5 + 7 de `Catalogos.guardar`/`listar` + 8 de
`Auth.gestionarUsuario`/`listarUsuarios` + 4 de asignación de responsables
+ 2 ajustes al dashboard filtrado.

## Cómo probar en el navegador

```bash
node backend/dev-server-backoffice.js
npx http-server frontend -p 8080
```

Editar temporalmente `BACKOFFICE_URL` en `frontend/js/config.js` →
`http://localhost:8788?actuar_como=admin@homepymes.cl`. Abrir
`admin.html`: se probó crear una empresa nueva y listar usuarios/catálogos
con datos reales del backend.

## Checklist de la Fase 6

- [x] `guardarCatalogo` y `gestionarUsuario` conectados (router completo).
- [x] RN-030 aplicada al desactivar/reasignar rol de Administrador.
- [x] `logo` y `url_base` agregados a los catálogos (RF-006/007 v1.0).
- [x] Asignación de analista/desarrollador implementada y usada por el
      dashboard filtrado.
- [x] `admin.html` funcional, verificado en navegador.
- [x] Suite en verde (`npm test`, 129/129).

## Próximos pasos (Fase 7)

- Automatizaciones restantes de §13/§16: verificación de SLA (A-07/08/09),
  refresco de cache del dashboard (A-10), suspensión de inactivos
  (RN-029/A-12), reportes programados (§14 v1.1).
- Vista de logs de automatizaciones en `admin.html`.

## Commits sugeridos

```
feat(backend): logo/url_base en catalogos y analista/desarrollador_asignado en SOLICITUDES
feat(backend): Catalogos.guardar y Catalogos.listar (CRUD de catalogos por rol)
feat(backend): Auth.gestionarUsuario y listarUsuarios con RN-029/030/031
feat(backend): asignacion de responsables en actualizarPrioridad + dashboard filtrado real
feat(frontend): admin.html con panel de catalogos y usuarios
test(backend): suite Fase 6 (catalogos, usuarios, asignacion)
docs: documentacion de la Fase 6
```
