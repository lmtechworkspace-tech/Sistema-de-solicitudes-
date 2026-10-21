# I14 · Plan de paso a producción y reversión de Finanzas v2

**Estado: preparado para revisión. NO ejecutado.** No se hizo commit, push ni despliegue, y no se tocó producción.
La decisión de oficializarlo es del dueño.

## 1. Revisión candidata exacta

**Base:** `main` en `af41a43` (igual a `origin/main` al 20-10-2026).

**Cambios:** solo los de Finanzas, separados de los cambios ajenos sin commit (ver §9):

- 105 archivos: 57 nuevos, 35 modificados y 13 borrados;
- 14.997 líneas agregadas y 1.135 quitadas.

**Huella del parche:** `53a52aff76f42b8b…` (SHA-256 de `git diff --binary` armado con un índice temporal; cómo
rehacerlo en §9).

**Verificado:**
- el parche aplicado sobre una copia limpia de `af41a43` pasa **`npm test`: 1870/1870**;
- en el árbol local completo, que además tiene cambios ajenos, pasa **1872/1872**.

## 2. Requisitos de entorno

| Requisito | Estado en el VPS | Acción |
|---|---|---|
| Node 24 con `node:sqlite` | Ya en uso | Ninguna |
| Chromium para el PDF | Ya lo instala `backend/scripts/asegurar-chromium.sh` | Ninguna |
| `SIGSO_FINANZAS_LLAVE` | Ya configurada (`/etc/sigso/finanzas.env`) | No cambia. **Sin ella, o con otra, la bóveda no se descifra** |
| `SIGSO_FINANZAS_ACCESO`, `SIGSO_FINANZAS_SOLO_LECTURA`, `SIGSO_FINANZAS_AVISAR` | Ya configuradas | Revisar que la lista sea la vigente |
| `SIGSO_FINANZAS_CAPACIDADES` (**nueva, opcional**) | No existe | Solo si se quieren capacidades por persona, por ejemplo quién aprueba saldos iniciales o quién cierra. Sin ella, la lista de acceso tiene todas las capacidades, como hoy |
| Dependencias npm | Sin dependencias nuevas | Ninguna |

Ningún secreto va en el repositorio ni en este plan.

## 3. Cambios de esquema (todos aditivos)

Se aplican solos en el primer uso, de forma idempotente: `CREATE TABLE IF NOT EXISTS` y `asegurarColumna_`, que
solo **agrega**.

| Tipo | Detalle |
|---|---|
| Tablas nuevas (20) | `FIN_ADJUNTOS`, `FIN_APERTURAS`, `FIN_APLICACIONES`, `FIN_ASIGNACIONES_PROYECTO`, `FIN_CATALOGO`, `FIN_CIERRE_VERSIONES`, `FIN_CONCILIACIONES`, `FIN_DOCUMENTOS`, `FIN_FICHAS`, `FIN_FUENTES`, `FIN_FUENTE_FILAS`, `FIN_GESTIONES`, `FIN_IDEMPOTENCIA`, `FIN_OPERACIONES`, `FIN_PERFILES`, `FIN_PRESUPUESTO_VERSIONES`, `FIN_REASIGNACIONES`, `FIN_RELACIONES_COBRO`, `FIN_REVISION`, `FIN_SERVICIOS` |
| Columnas nuevas | `FIN_MOVIMIENTOS.version`; `FIN_REGLAS.activa` y `.version`; `FIN_FACTURAS.version`; `FIN_PRESUPUESTO.estado`, `.version` y `.base`; `FIN_CATALOGO.version` |
| Índices | En período, lote, huella, factura, recepción, conciliación y gestión |
| Triggers | `rev_<tabla>_<op>`: suben el contador `FIN_REVISION` cuando cambian datos financieros. Se excluyen sesiones, bitácora, autenticador, idempotencia y cierres |
| Datos existentes | **No se reescriben.** El presupuesto anterior se muestra como «HEREDADO», sin aprobador ni fecha inventados. Los catálogos se siembran con `INSERT OR IGNORE` |

**Lo que no hay:**
- ningún `DROP TABLE` ni ningún borrado de filas reales en la migración;
- el único `DELETE` de operaciones descarta un borrador **nunca confirmado**, a pedido de la persona.

## 4. Respaldo y recuperación

1. **Respaldo inmediato antes de publicar.** En el VPS: `node backend/scripts/backup-db.js` respalda `sigso.db`,
   `finanzas.db` y `credenciales.db` con `VACUUM INTO`, y los sube a R2.
2. **Ensayo de restauración en el VPS, sobre copias.**
   - Restaurar el respaldo en `/tmp/ensayo-restauracion/`.
   - Calcular `huella-boveda.js` sobre el respaldo y sobre la restauración, con la misma llave, y comparar la
     `huella`.
   - Ensayado en local (QA-R22): 87/87 registros descifrados, huella idéntica; con otra llave, 0/87.
3. **Guardar la llave** `SIGSO_FINANZAS_LLAVE` fuera del servidor (gestor de contraseñas). Sin ella el respaldo no
   sirve.

## 5. Orden de publicación (cuando el dueño lo decida)

1. **Revisar el paquete:** el parche de Finanzas, sin los cambios ajenos (§9).
2. **Comprobaciones antes del commit:**
   - `frontend/js/config.js` **no** está incluido y sigue apuntando a `https://api.ctrly.cl`;
   - `git diff --cached | grep 127.0.0.1` no muestra nada;
   - `documentacion/finanzas-documento/datos-iniciales/` y el `.zip` CONFIDENCIAL están ignorados;
   - `npm test` pasa.
3. **Avisar** a las personas de Finanzas que guarden y cierren la bóveda. El despliegue reinicia el servicio.
4. **Respaldo** (§4.1).
5. **Push a `main`:** despliega el backend (`deploy-backend.yml`) y el frontend (`pages.yml`).
   - `backend/herramientas/` **no** llega al VPS: el workflow no lo sincroniza.
   - Los tests tampoco.
6. **Verificación posterior** (§6).
7. **Activación por alcance:** solo la lista fija ve Finanzas, igual que hoy.
   - La carga de las planillas reales (SIGECO y BANCOS) es un paso **aparte y posterior**.
   - Primero se ensaya con `aceptacion-fuentes-reales.js` en una copia.
   - Después lo hace una persona en el Centro de cargas, hoja por hoja.

## 6. Verificación posterior

| Comprobación | Esperado |
|---|---|
| Abrir la bóveda con TOTP | Abre; Pendientes y Registro cargan sin error |
| Registros del servidor (`journalctl -u sigso`) | Sin errores de Finanzas en los primeros 15 minutos |
| Informe de un mes ya **cerrado** | Mismas cifras que su versión de cierre guardada |
| `node backend/scripts/finanzas-boveda.js verificar` | Bitácora íntegra |
| `huella-boveda.js` sobre un respaldo tomado después de publicar | Descifra todo (0 fallos) |
| Navegador con recarga forzada (Ctrl+Shift+R) | Columna de Finanzas con sus 7 áreas; el manual abre con sus 14 capturas |

**Caché del navegador:** los scripts no llevan versión en la URL. Alguien con la versión anterior en caché podría
llamar la ruta retirada `finanzasTablero` hasta recargar. Por eso hay que pedir **Ctrl+Shift+R** después de
publicar.

## 7. Escrituras concurrentes durante el despliegue

- **Idempotencia:** guardar, aplicar y publicar llevan una clave. Un reintento después del reinicio no duplica.
- **Versiones:** una edición con versión vieja recibe un conflicto. No pisa nada.
- **Lo que se pierde:** lo escrito y no guardado en el navegador al momento del reinicio. Por eso se avisa antes de
  publicar.

## 8. Criterios para detener y cómo recuperar

**Detener** si ocurre cualquiera de estas cosas:
- falla `npm test` en el workflow;
- hay errores 500 de Finanzas;
- la huella no descifra;
- el informe de un mes cerrado no coincide con su versión guardada;
- la bitácora no está íntegra.

**Reversión de código** (`git revert` del commit de Finanzas y push):
- **Es compatible para leer:** las tablas y columnas nuevas son aditivas y la versión anterior las ignora.
- **No ve lo escrito con la versión nueva:** el registro diario, las conciliaciones, los fondos, las aplicaciones
  y las cargas siguen en la base, pero sin pantalla.
- **Recomendación:** preferir **corrección hacia adelante**. Revertir solo si el problema impide operar.

**Restaurar el respaldo** solo es aceptable si **nadie escribió** desde la publicación. Si hubo escrituras reales:
1. exportarlas antes (Informes → Exportación: operaciones, aplicaciones, fondos);
2. restaurar;
3. volver a cargarlas con un procedimiento acordado.

**No existe un «down»** que borre tablas o registros. No se propone ninguno.

## 9. Cómo armar el paquete sin mezclar cambios ajenos

**Cambios ajenos, sin commit, que NO van:**
- Bandeja y portal: `bandeja-v2.*`, `portal-cliente.*`, `portalClientes.js`, `solicitudes*.js`,
  `archivosSolicitud.js`, `schema.js` y la prueba `portal-clientes-pedidos`;
- `DECISIONES-CODEX-CLAUDE.md` y `SIGSO-conexion-Codex-Claude.patch`;
- dentro de `router.js`, la línea `publicarArchivosEquipo`;
- `frontend/js/config.js` (apunta a local);
- `.claude/launch.json`;
- otras carpetas de documentación que no son de Finanzas.

**El índice real no se tocó.** El paquete se armó con un índice temporal:

```
cp .git/index /tmp/idx; export GIT_INDEX_FILE=/tmp/idx
git add -A -- <archivos de Finanzas (lista en I14-entrega.md)>
git rm --cached -q frontend/js/finanzas-tablero-v2.js
grep -v "publicarArchivosEquipo: (db" backend/server/router.js > /tmp/router.js
git update-index --cacheinfo 100644,$(git hash-object -w /tmp/router.js),backend/server/router.js
git diff --cached --binary HEAD > finanzas-v2.patch
```

**Para el commit real**, con autorización del dueño, se sugieren cuatro commits locales, que se publican **juntos**
en un solo push:

1. **Backend:** lógica, router y pruebas.
2. **Frontend:** vistas, estilos, `plataforma.html` y el marco.
3. **Manual y herramientas:** `frontend/manuales/*` y `backend/herramientas/finanzas-demo/`.
4. **Documentación:** `documentacion/finanzas-v2-correccion/`.

Se publican juntos porque el backend retira la ruta `finanzasTablero` que usaba la pantalla anterior.
