# Reconciliación con SIGSO v1.0

Al llegar a la Fase 5, el cliente aportó `documentacion/SIGSO_EspecificacionCompleta_v1.0.docx`
(no disponible hasta ese momento) y pidió revisarlo antes de continuar. Este
documento explica qué se tomó de ahí, por qué, y qué se ajustó en el código
ya construido (Fases 0-4).

> **Actualización (cierre de Fase 5 → inicio de Fase 6):** una segunda
> relectura completa de v1.0 (secciones §4-8, que en la primera pasada se
> habían revisado por muestreo, no íntegras) encontró dos vacíos reales que
> esta reconciliación había dejado pasar: los campos `logo` (RF-006) y
> `url_base` (RF-007) de los catálogos, y el campo de asignación de
> analista/desarrollador que los Actores (§5) dan por sentado. Ambos se
> corrigieron en la Fase 6 — ver la tabla actualizada más abajo y
> `documentacion/fases/FASE-06-administracion.md`. Las secciones "qué NO
> cambió" y "reglas de auto-prioridad" de este documento se re-verificaron
> en esa misma relectura y siguen siendo correctas tal como están descritas.

> **Actualización (post-Fase 6, antes de Fase 7):** ante una nueva pregunta
> del cliente sobre si ambos documentos habían sido revisados a fondo, se
> hizo una tercera relectura — esta vez completa y literal de v1.0 (incluidas
> las secciones que hasta entonces solo se habían mirado por muestreo: §9
> entidades adicionales, §13 diseño completo de columnas de Sheets, §14
> Drive, §15 endpoints/funciones, §16 triggers, §17 KPIs, §18 escalabilidad,
> §19 riesgos). Encontró tres vacíos reales, ya corregidos:
> 1. **Nombres de catálogo desnormalizados** (§13.2 v1.0): `SOLICITUDES`
>    debía guardar `empresa_nombre`/`plataforma_nombre`/`modulo_nombre`/`tipo_nombre`
>    junto a los `*_id`, para que la hoja fuera legible por un humano sin
>    cruzar catálogos. Agregado en `crearSolicitud` vía `resolverNombreCatalogo_`
>    (`backend/intake/Solicitudes.gs`), con fallback a cadena vacía si el
>    catálogo aún no tiene esa fila.
> 2. **Asignación de desarrollador por subsolicitud** (§13.3 v1.0): las
>    subsolicitudes pueden trabajarse en paralelo por distintos
>    desarrolladores, no solo por el responsable "por defecto" de la
>    solicitud completa. Agregada la columna `SUBSOLICITUDES.desarrollador_asignado`
>    y la ruta `actualizarPrioridad({ solicitud_id, subsolicitud_id, desarrollador_asignado })`
>    (`backend/backoffice/Solicitudes.gs`); el Dashboard (vista DEV) ahora
>    incluye una solicitud si el desarrollador está asignado a ella o a
>    cualquiera de sus subsolicitudes (`backend/backoffice/Dashboard.gs`).
> 3. **`CONFIG_NOTIFICACIONES` con columnas inventadas**: la hoja tenía un
>    esquema genérico (`tipo_evento`/`canal`/`plantilla`/`activo`) sin base en
>    la especificación; corregido a las columnas reales del doc 9:
>    `notif_id`, `evento`, `rol_destinatario`, `emails_extra`, `activo`.
>
> Un cuarto punto (arquitectura de columnas calculadas vs. materializadas —
> v1.0 modela varias columnas como recalculadas por triggers, esta
> implementación las calcula al vuelo en cada lectura) se evaluó
> explícitamente y se decidió **mantener el cálculo al vuelo**: es
> equivalente en resultado, más simple de razonar y no depende de que un
> trigger se dispare correctamente. Ver `database/schema.md` para el detalle
> columna por columna de los tres puntos corregidos, y
> `backend/test/prioridad.test.js` / `backend/test/dashboard.test.js` para
> las pruebas nuevas (134 tests en verde tras estos cambios).

## Por qué hacía falta

`SIGSO_Especificacion_Refinada_v1.1.docx` (la única fuente usada hasta la
Fase 4) es un documento de **diferencias**: registra los cambios que una
auditoría de arquitectura introdujo sobre v1.0 (§0 "Registro de cambios"),
pero explícitamente dice que "todo lo no modificado se mantiene vigente
respecto de v1.0". El problema es que v1.1 nunca llegó a subirse junto con
v1.0 — así que SIGSO se construyó con v1.1 como única referencia, y todo lo
que v1.1 daba por sentado sin repetir (el catálogo real de tipos de
solicitud, los campos completos del formulario, las plataformas/módulos
reales de HomePymes/RLD, el formato exacto del resumen de WhatsApp) tuvo que
inventarse o simplificarse de forma razonable pero genérica.

## Qué NO cambió (v1.1 sigue siendo la autoridad)

Las correcciones de arquitectura y reglas de negocio de v1.1 siguen vigentes
tal cual — v1.0 no las contradice, v1.1 es explícitamente su corrección:

- Separación App Pública / App Gestión, contrato `text/plain` (§2-4).
- Autenticación por identidad Google, sin contraseñas propias (§3, C-03).
- **RN-006 corregida**: la prioridad se deriva por impacto, no por tipo ni
  por "es de cliente". La regla de v1.0 (RF-011: "Error + cliente = Crítica
  automática") es precisamente la que v1.1 corrige y reemplaza — no se
  revirtió al reconciliar.
- Cola de documentos encolada/diferida (§5.2, C-04), subida de archivos
  por-archivo (§5.3, C-06), `ref_credencial` en vez de `password_prueba`
  (§3.4, ya corregido en v1.1).
- Máquina de estados S01-S11 y estado derivado del padre (§8, C-08).

## Qué se agregó desde v1.0 (Fases 1-4, retrofit)

| Elemento | Antes (inventado/simplificado) | Ahora (v1.0, doc 3 y 9) |
|---|---|---|
| Catálogo de tipos | 3 tipos genéricos (`ERROR`/`REQUERIMIENTO`/`CONSULTA`) | 7 tipos reales: `ERR`/`MOD`/`MEJ`/`DES`/`NMO`/`MIG`/`CON` (RF-009), con `prioridad_default` informativa |
| Campo cargo del solicitante | No existía | `solicitante_cargo`, obligatorio (RF-001) |
| Datos de cliente | Solo empresa/contacto/correo | + `cliente_mandante`, `cliente_obra`, `telefono_cliente`, `urgencia_cliente` (RF-002) |
| Campos de subsolicitud | `titulo`, `descripcion`, `impacto`, `ref_credencial` | + `numero_item`, `contexto`, `resultado_esperado`, `url_modulo`, `usuario_prueba`, `centro_costos`, `url_video`, `observaciones`, `estimacion_horas` (RF-003, entidad SUBSOLICITUD) |
| `urgencia_cliente` | Modelada por subsolicitud | Movida a `SOLICITUDES` (una vez por solicitud, RF-002) |
| Resumen de WhatsApp | Formato libre de 3 líneas | Formato exacto de RF-015 (emojis, orden fijo) + regla de múltiples ítems (RF-F07: "N ítems — ver detalle en correo") |
| Límites de archivos | Solo tamaño (5/10 MB) | + cantidad: máx. 5 imágenes y 3 documentos por solicitud (RF-003) |
| Tipo de archivo detectado | JPEG/PNG/GIF/PDF | + XLSX (firma ZIP, con la ambigüedad documentada) |
| Catálogos de ejemplo (`dev-server.js`) | Genéricos (`ERP`, `Facturación`) | Plataformas/módulos reales de HomePymes/RLD (RF-007/008) |
| Campos de catálogo (Fase 6) | `CAT_EMPRESAS`/`CAT_PLATAFORMAS` sin `logo`/`url_base` | + `logo` (RF-006) y `url_base` (RF-007), encontrados en la relectura completa de §4-8 |
| Asignación de responsables (Fase 6) | No existía | `analista_asignado`/`desarrollador_asignado` en `SOLICITUDES` (Actores §5: "ver solicitudes asignadas a él"), usado por el dashboard filtrado del rol DEV |

Todos estos cambios están implementados y probados (129 tests en verde al
cierre de la Fase 6) — ver los commits de cada fase y `database/schema.md`
para el detalle columna por columna.

## Qué se dejó fuera deliberadamente

- **Reglas de auto-prioridad por tipo de v1.0 (RF-011)**: no se reintrodujeron
  porque v1.1 las corrige explícitamente (ver arriba). Se conserva
  `prioridad_default` en `CAT_TIPOS` solo como sugerencia informativa/UX, no
  como regla de negocio.
- **Jerarquía de módulos (`modulo_padre_id`) y `orden_display`**: v1.0 los
  define en la entidad `MODULO`/`PLATAFORMA`, pero los ejemplos reales del
  documento (GDE — Prevención, GDE — RRHH) son listas planas, no árboles
  visibles. No se agregó la columna ni la UI de jerarquía: se puede sumar
  después si un módulo específico lo necesita, sin tocar el resto del
  esquema.

  > **Actualización (durante el despliegue real, post-Fase 8):** al cargar
  > el catálogo real de módulos (HomePymes/GDE/Intranet), el cliente aportó
  > un mapa de procesos completo (draw.io) que sí tiene una jerarquía real
  > de hasta 4 niveles (módulo principal → submódulo → ítem → sub-ítem), más profunda
  > que los ejemplos planos de v1.0/v1.1. Se agregó `modulo_padre_id` a
  > `CAT_MODULOS`, una cascada de selects en el formulario público
  > (`campo-modulo` → `campo-submodulo` → `campo-item`, visibles solo si el
  > nivel anterior tiene hijos) y el campo correspondiente en la gestión de
  > catálogos de `admin.html`. Ver `database/schema.md` para el detalle.
- **Pantallas de v1.0 no cubiertas aún** (login.html, dashboard.html,
  admin.html, detalle de solicitud): corresponden a fases futuras (5 y 6),
  no a este retrofit. La paleta de colores y tipografía de v1.0 ya
  coincidían exactamente con lo implementado en la Fase 3 — no hubo que
  tocar nada ahí.
- **Vista pública de estado por URL con query param** (`estado.html?buscar=SOL-...`,
  RF-F01): ya existe desde la Fase 3 (`estado.html?id=...`); no requirió
  cambios.

## Impacto en fases futuras

- **Fase 5 (Backoffice)**: el detalle de solicitud debe mostrar todos los
  campos nuevos (contexto, resultado esperado, datos de cliente completos,
  etc.) — ya están en el esquema, solo falta la UI de lectura.
- **Fase 6 (Administración)**: la gestión de catálogos debe considerar que
  `CAT_TIPOS` ya viene poblado por el instalador (a diferencia de
  empresas/plataformas/módulos, que siguen siendo carga manual).
