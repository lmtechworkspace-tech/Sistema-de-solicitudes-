# I00 · Preparación, respaldo y línea base (20-10-2026)

## I00.1 Inventario

| Elemento | Estado real |
|---|---|
| Instrucciones del proyecto | No existen `AGENTS.md` ni `CLAUDE.md`. Se usan las instrucciones del usuario y la memoria del proyecto. |
| Documento `SIGSO-Finanzas_revision-profunda-y-correcciones-para-Claude-Code.md` | **No está disponible** en Descargas. Se trabaja con la orden v2, que reproduce sus casos C01–C16, V01–V10 y QA-R01–R26. |
| Rama / HEAD | `main` en `af41a43` (igual que `origin/main`). Los cambios de Finanzas están **sin commit**. |
| Cambios ajenos sin commit, que no se tocan | Bandeja y portal de contratistas (`bandeja-v2.*`, `portal-cliente.*`, `portalClientes.js`, `solicitudes*.js`, `archivosSolicitud.js`, `schema.js`, prueba `portal-clientes-pedidos`), `DECISIONES-CODEX-CLAUDE.md`, el parche `SIGSO-conexion-Codex-Claude.patch` y, dentro de `router.js`, el bloque `publicarArchivosEquipo`. |
| Node / pruebas | Node v24.16.0. Única orden de pruebas: `npm test` (`node --test backend/test/*.test.js`). |
| Bases | Producción en `/opt/sigso/data` (VPS, no se toca). Local de demostración: `sigso.db` y `finanzas.db` en una carpeta fuera del repositorio, elegidas con `SIGSO_DB_PATH` y `SIGSO_FINANZAS_DB_PATH`. |
| Llave de la bóveda | `SIGSO_FINANZAS_LLAVE` (variable de entorno). La de demostración es aleatoria y vive fuera del repositorio. |
| Frontend local | `frontend/js/config.js` apunta a `127.0.0.1:3099` (API de demostración). **Riesgo:** ese archivo nunca se sube. Hay que revisarlo antes de cualquier commit (queda en el plan de publicación). |
| Arquitectura | Node.js + SQLite (`node:sqlite`) + módulos IIFE. Se conserva. |

## I00.2 Git y respaldo

1. **Primero se preservó el trabajo:** los 328 archivos modificados o nuevos (`git ls-files -m -o`) se copiaron fuera del repositorio, junto con una copia de `.git/index`.
2. **Diagnóstico (`git fsck`):**
   - faltaba el blob `08cf86eb` (versión de `lector-xlsx.js` en HEAD);
   - faltaban árboles referenciados desde el índice;
   - dos índices de paquete (`pack-6b7c…`, `pack-e765…`) no tenían su archivo `.pack`, probablemente porque OneDrive los liberó del disco;
   - además había entradas inválidas en el reflog y en la rama antigua `poc/sqlite-backend`.
3. **Reparación sin borrar nada:**
   - Se descargó un clon *bare* limpio del remoto, fuera del repositorio, y su paquete se **agregó** a `.git/objects/pack`.
   - Los dos índices huérfanos y el `multi-pack-index` antiguo se **movieron** a una cuarentena fuera del repositorio, desde donde se pueden devolver, y se regeneró el `multi-pack-index`.
4. **Resultado:**
   - `git fsck --no-reflogs` queda sin errores.
   - El diff de `lector-xlsx.js` ya se puede leer (+13 / −6).
   - El árbol de trabajo no cambió.
   - El reflog antiguo y la rama `poc/sqlite-backend` siguen con referencias a objetos que ya no existen. No afectan a `main` y no se tocaron.

**Recomendación:** mantener el repositorio fuera de la sincronización de OneDrive, o con la opción «mantener siempre en este dispositivo». Así OneDrive no vuelve a liberar los paquetes de git.

### Respaldo y restauración ensayados (QA-R22)

Se usó la base de demostración, enriquecida con un documento con adjunto cifrado y el cierre de septiembre (versión 1).

| Paso | Resultado |
|---|---|
| Respaldo consistente con `VACUUM INTO` (mismo mecanismo que `backend/scripts/backup-db.js`) de `sigso.db` y `finanzas.db` | OK |
| Restaurar en **otra carpeta** y calcular el resumen con la misma llave | **Idéntico** al original: conteo de las 38 tablas FIN, 43 registros cifrados descifrados sin fallo, adjunto con el mismo SHA-256, versión del cierre 2026-09, cadena de bitácora íntegra (187 filas), custodia y reporte de septiembre iguales. |
| Restaurar con **otra llave** | 0 de 43 registros descifrables («unable to authenticate data»). La llave es indispensable: **no basta con que la base abra.** |

**Para recuperar hace falta:**
- los dos archivos `.db` del respaldo;
- la misma `SIGSO_FINANZAS_LLAVE`, guardada aparte del respaldo y protegida;
- las variables de acceso de la bóveda (`SIGSO_FINANZAS_ACCESO` y, si se usan, `SIGSO_FINANZAS_SOLO_LECTURA` / `SIGSO_FINANZAS_CAPACIDADES`).

Los adjuntos viven dentro de `finanzas.db`, cifrados, así que no requieren un respaldo aparte. Las sesiones de la bóveda (`FIN_SESIONES`) viajan en el respaldo: al restaurar en producción conviene invalidarlas (ver el plan de publicación).

## I00.3 Línea base

| Elemento | Valor |
|---|---|
| Fecha | 2026-10-20 14:46 (America/Santiago) |
| Revisión | `af41a43` + cambios locales; huella de los archivos de Finanzas `5d569ed645451050` |
| Orden | `npm test` |
| Resultado | **1805 pruebas, 1805 pasan, 0 fallan** (100 s). No hay fallos previos. |
| Capturas del estado inicial | Las 45 de `documentacion/finanzas-cambios/capturas/` (datos de demostración, primera entrega). |

## Diferencias entre el PDF de la primera entrega y el código

- El PDF dice que el diff de `lector-xlsx.js` no estaba disponible. Ya está disponible tras la reparación de git.
- El PDF cuenta «111 acciones de Finanzas». Se confirmó con el router; se volverá a contar al final.
- Resto: sin diferencias detectadas en I00. Cada paquete registra las que encuentre.
