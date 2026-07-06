# Fase 1 — Modelo de datos y núcleo de solicitudes

Fuente de verdad: `documentacion/SIGSO_Especificacion_Refinada_v1.1.docx` (§5.1, §5.4, §6, §7.1, §7.2 parcial).
Depende de la Fase 0 (contrato de transporte) — ver [FASE-00-fundamentos.md](FASE-00-fundamentos.md).

## Objetivo

Dejar `crearSolicitud` y `getCatalogos` funcionando de punta a punta contra
un esquema de Google Sheets real: validación de reglas de negocio,
correlativo inmutable, deduplicación y la primera derivación de prioridad.

## Alcance de esta fase

Incluido:

- Esquema completo de las 15 hojas de §6 (`database/schema.md`), creado por
  `backend/setup/Instalador.gs` de forma idempotente.
- `generarId_()` — correlativo `SOL-AAAA-EMPRESA-NNNN` sobre `COUNTERS` con
  `LockService`, reinicio automático por año (§5.4, RN-003, C-12).
- `Solicitudes.crearSolicitud(data)` completo: validación (RN-001, RN-002,
  RN-004, RN-005), deduplicación por hash (RF-F06), derivación inicial de
  prioridad (RN-006), escritura en `SOLICITUDES`/`SUBSOLICITUDES`, registro
  del estado inicial `S01` en `HISTORIAL_ESTADOS`, y generación del resumen
  WhatsApp (§5.1).
- `Catalogos.getAll()` — lectura de catálogos activos (§4.2).
- 30 pruebas automatizadas (`npm test`), incluyendo una prueba de
  consistencia entre los dos esquemas duplicados (`Constantes.gs` /
  `Instalador.gs`).

Explícitamente fuera de esta fase:

- Máquina de estados y transiciones S01→S11, `estado_derivado` recalculado,
  modificación de prioridad (RN-007/008/009), cálculo de SLA en horas
  hábiles (Fase 2).
- `subirArchivo` y `consultarEstado` (siguen respondiendo `internal`
  documentado).
- Alertas P1 y acuse de recibo por Gmail (§5.1, pasos 6-7 restantes) — la
  cola de notificaciones es Fase 4; esta fase deja `prioridad_derivada` y
  `estado` listos para que esa cola los consuma.
- Gestión de usuarios/catálogos desde el Backoffice (Fase 6).

## Decisiones y supuestos (léase antes de ajustar reglas de negocio)

| Decisión | Detalle |
|---|---|
| `prioridad_derivada` en `SOLICITUDES` | Campo agregado por analogía con `estado_derivado` (§8, C-08); no tiene nombre explícito en la especificación. Ver `database/schema.md` para el razonamiento completo. |
| `derivarPrioridad_` sin impacto → `P4` | RN-006 solo define la tabla P1/P2/P3 para "Error de cliente"; se generalizó a cualquier tipo y se fijó `P4` como default conservador cuando no hay `impacto`. Ajustable en `Constantes.gs` sin tocar `Solicitudes.gs`. |
| Deduplicación "avisa", no bloquea | RF-F06 dice "avisar si hay una solicitud abierta equivalente": se implementó como campo `posible_duplicado` en la respuesta, sin impedir la creación. |
| Dos proyectos Apps Script más `setup/` | `Constantes.gs`/`Instalador.gs` duplican el esquema de columnas (mismo criterio que `Config.gs` en Fase 0). `schema-consistency.test.js` es la red de seguridad contra desincronización. |

## Cómo correr las pruebas

```bash
npm test
```

30 casos: contrato de transporte (Fase 0, 12), correlativo y reinicio por
año (5), `crearSolicitud` con sus reglas y deduplicación (7), catálogos (2),
instalador idempotente (3), consistencia de esquema (1).

## Cómo instalar el esquema en una planilla real

1. Crear la planilla en Drive y copiar su ID.
2. Crear un proyecto Apps Script standalone apuntando a
   `backend/setup/` (o `clasp push` esa carpeta).
3. En Script Properties del proyecto, definir `SIGSO_SHEET_ID` con el ID de
   la planilla.
4. Ejecutar `instalarHojas()` una vez desde el editor de Apps Script.
   Verificar en los logs las hojas creadas.
5. Repetir en `backend/intake` y `backend/backoffice`: mismo
   `SIGSO_SHEET_ID` en sus propios Script Properties (los tres proyectos
   comparten la misma planilla, cada uno con su propio código).
6. Cargar manualmente: `CONFIG_FERIADOS` del año en curso, catálogos
   iniciales (`CAT_EMPRESAS`/`PLATAFORMAS`/`MODULOS`/`TIPOS`), y al menos
   2 filas en `USUARIOS` con rol `ADM` (checklist §17.2 — se automatiza en
   fases futuras, hoy es carga manual de datos, no de esquema).

## Checklist de la Fase 1

- [x] Esquema de las 15 hojas de §6 definido y creado por el instalador.
- [x] `generarId_()` con `LockService`, formato correcto, reinicio por año.
- [x] `crearSolicitud` valida RN-001/002/004/005 y responde `validation` con
      el detalle por campo.
- [x] Deduplicación por hash (RF-F06) implementada como aviso no bloqueante.
- [x] Prioridad inicial derivada por impacto (RN-006) y persistida en padre
      e hijas.
- [x] `getCatalogos` filtra solo entradas activas.
- [x] Suite de pruebas en verde (`npm test`, 30/30).
- [ ] Instalación real contra una planilla Google Sheets y carga manual de
      catálogos/feriados/usuarios (pendiente de cuenta Workspace, igual que
      el smoke test de la Fase 0).

## Próximos pasos (Fase 2)

- Máquina de estados S01-S11 y `estado_derivado` del padre (§8, C-08).
- Modificación de prioridad con justificación e historial (RN-007/008/009).
- `Utils.horasHabilesEntre()` con pruebas unitarias (feriados, DST, pausa
  S06) — el punto de mayor riesgo técnico según la auditoría (§10).

## Commits sugeridos

```
feat(backend): esquema completo de hojas + instalador idempotente
feat(backend): generarId_ con LockService y reinicio de correlativo por anio
feat(backend): Solicitudes.crearSolicitud con validaciones RN-001/002/004/005
feat(backend): deduplicacion por hash y derivacion inicial de prioridad (RN-006)
feat(backend): Catalogos.getAll y conexion del router de Intake
test(backend): suite Fase 1 (correlativo, solicitudes, catalogos, instalador, consistencia de esquema)
docs: esquema de datos (database/schema.md) y documentacion de la Fase 1
```
