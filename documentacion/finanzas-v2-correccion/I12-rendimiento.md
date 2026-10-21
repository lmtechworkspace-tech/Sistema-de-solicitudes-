# I12 · Rendimiento, sesión y recuperación de errores — probado, con límites declarados (21-10-2026)

## I12.1 · Medición (antes de concluir)

**Banco de medición.** Usa la misma API que la pantalla sobre una bóveda **temporal** con datos inventados; nunca
la real. Mide la mediana y el p95 de 7 repeticiones (5 en la exportación).

**Entorno:**

| | |
|---|---|
| Equipo | AMD Ryzen 9 270 (16 núcleos), 16 GB |
| Node | v24.16.0 |
| Base | SQLite cifrada |

**Escenarios** (los JSON completos están en `evidencia/i12-medicion-{antes,despues}-S{1,2}.json`):

| | S1 · volumen actual aproximado | S2 · crecimiento ×10 |
|---|---|---|
| Cuentas | 2 (2 empresas) | 4 (3 empresas) |
| Meses | 6 | 12 |
| Movimientos | 1.440 (80 % clasificados) | 14.400 |
| Operaciones registradas | 240 | 1.200 |
| Facturas | 360 | 1.800 |
| Tamaño de la base | 2,3 MB | 21,7 MB |

**Mediana en milisegundos** (p95 de la medición de después entre paréntesis):

| Operación | S1 antes | S1 después | S2 antes | S2 después |
|---|---|---|---|---|
| Listar el registro del mes | 12 | 6 (7) | 28 | 16 (20) |
| Buscar en el registro | 14 | 7 (10) | 31 | 12 (17) |
| Movimientos del mes | 6 | 6 (8) | 42 | 51 (96) |
| Guardar una operación (borrador) | 30 | 3 (7) | 376 | 3 (4) |
| Informe del mes en frío (tras una escritura) | 255 | 77 (86) | **11.779** | **623** (650) |
| Informe del mes en caliente | 225 | 0 (0) | **11.733** | 0 (0) |
| Pendientes | 259 | 36 (47) | **11.816** | **217** (236) |
| Candidatos de conciliación (una operación) | 7 | 11 (28) | 66 | 50 (58) |
| Bandeja de cobranza | 195 | 3 (8) | **9.963** | 10 (17) |
| Exportar movimientos del mes (xlsx) | 267 | 18 (25) | **10.595** | 75 (119) |
| Carga masiva completa (s) | 8,2 | 3,2 | 564 | 231 |

Con el volumen ×10, el informe, la bandeja de cobranza, pendientes y la exportación tardaban **10 a 12 segundos**:
podían chocar con el «El servidor tardó demasiado» de producción. No se fija un umbral «garantizado»; las cifras
valen para este equipo y estos volúmenes.

**Perfil de CPU** (lo que se encontró midiendo):

1. **Cartera de cobranza:** el reparto FIFO sugerido recorría, por cada factura, todas las recepciones del cliente,
   incluidas las ya agotadas. Además creaba un objeto nuevo en cada par factura–recepción. Unos 7,4 s de 10 s.
2. **Cada escritura invalidaba la caché de hechos.** Lo siguiente en leer descifraba de nuevo todos los
   movimientos con AES; guardar una operación buscaba coincidencias con el banco incluso en borradores.
3. **El catálogo se rearmaba con cualquier escritura**, aunque solo cambia cuando se edita el catálogo.
4. **Costos repetidos:** `hoy_` creaba un formateador de fecha en cada llamada; la llave se decodificaba en cada
   descifrado; la revisión contaba las tablas del esquema en cada llamada.

## I12.2 · Consultas y caché (lo que se cambió)

**Reparto FIFO sin trabajo repetido.** El resultado no cambia:
- el objeto de la factura se arma una vez;
- el permiso (emisor o relación vigente) se recuerda por par recepción–empresa;
- se saltan las recepciones agotadas del principio.

**Descifrado memorizado por texto cifrado y llave.**
- Cada cifrado usa un IV aleatorio, así que un mismo texto cifrado siempre corresponde al mismo texto: no hay datos
  viejos. Cada lector recibe su propio texto, y nadie comparte objetos.
- Con otra llave no se abre: lo comprobó una prueba de seguridad existente, que falló con la primera versión y se
  corrigió.
- Se **vacía al cerrar la última sesión** de la bóveda, junto con las demás cachés de cifras.

**Cartera e informe memorizados** por revisión de datos, período, alcance, base, comparación y día. El resultado se
**congela**: ningún consumidor puede modificarlo y dañar la caché de otros. Las 1868 pruebas pasan con los
resultados congelados.

**Catálogo con firma propia** (`FIN_CATALOGO`: cantidad, suma de versiones y última edición).
- Solo se guarda en memoria lo armado fuera de una transacción.
- Se comprobó que un cambio hecho por **otra conexión** se ve.

**Revisión durable:** `FIN_REVISION`, desde I09, es un contador en la base que suben triggers. Así:
- ve las escrituras de otras conexiones (probado);
- deja fuera la auditoría (bitácora, sesiones, autenticador, idempotencia) y el flujo de cierre, de modo que
  consultar o exportar no invalida los informes.

El esquema se revisa con `PRAGMA schema_version`.

**Error de corrección encontrado y corregido** (prueba que falla sin el arreglo):
- **El problema:** una caché armada dentro de una transacción que luego se revierte podía reaparecer. El contador
  vuelve atrás y la siguiente escritura confirmada reutiliza el mismo número.
- **La regla nueva:** una caché armada dentro de una transacción solo vale dentro de ella (`marcaCache_` y
  `cacheVigente_`).

**Borradores:** no buscan coincidencias con el banco (no pueden tenerlas).

**Lo que no se cambió, y por qué:**
- Los listados ya filtran por período, empresa, cuenta y estado en SQL antes de descifrar.
- Los hechos globales (base de informes, conflictos y sugerencias) se descifran en conjunto una vez por revisión.
  Dividirlos por tabla sería más rápido al escribir, pero arriesga datos viejos; se prefirió la corrección.

## I12.3 · Interfaz y eventos (verificado en la demo)

**Sin manejadores duplicados.** Tras entrar y salir de Finanzas 3 veces, cada acción hizo **una** sola llamada
(contadas en la red).

**Respuestas tardías.** Las 15 vistas descartan las que ya no corresponden a su pantalla (`turno` y `vigente`,
I08).

**Cierre de la bóveda.**
- Se emite un aviso único (`sigso-fin-cerrada`) y cada pantalla **olvida las cifras** que tenía cargadas.
- El catálogo de la pantalla también se vacía.
- Con el candado puesto, no queda ningún importe en la página (verificado).

**Exportar y PDF:** el botón queda ocupado (`aria-busy`) mientras se generan; el resto de la pantalla se puede
seguir usando.

## I12.4 · Fallos que maneja la persona (verificado en la demo)

| Situación | Resultado |
|---|---|
| Falla la consulta | Mensaje localizado («No hay conexión con el servidor…») y botón **Reintentar** en las 17 pantallas de error; el reintento carga en la misma vista y contexto. Nunca una lista vacía. |
| Red caída al guardar una fila | La fila queda **«No guardado: …»** con lo escrito intacto. Al salir de nuevo de la fila se reintenta. |
| Timeout después de confirmar | El reintento usa **la misma clave de idempotencia**, comprobado en la red. Resultado: **una** fila. |
| La bóveda se cierra | Las filas con cambios sin guardar se **rescatan en memoria** (nunca en el navegador). Al volver: «N cambio(s) sin guardar… [Guardarlos ahora] [Descartar]». Verificado de punta a punta. |
| Cambió la versión | Antes se recargaba y **se perdía lo escrito**. Ahora se carga lo último y el cambio queda en la misma franja, para aplicarlo sobre lo nuevo (decisión explícita) o descartarlo. |
| Falta permiso | Mensaje de permiso sin datos (matriz de I11). |
| Importación parcial | Resultado por fila y por hoja, incidencias recuperables, sin duplicar al reanudar (I07). |
| Exportación lenta | Botón ocupado y pantalla usable; la exportación de S2 ahora tarda 75 ms. |

## I12.5 · Accesibilidad

- **Contraste medido con el CSS real** en claro y oscuro (I08): la etiqueta más débil queda en 5,1:1.
- **Medido en I08:** tamaños de control, reflujo por anchos equivalentes al zoom (768 y 390), modo oscuro,
  teclado (foco visible, Escape) y movimiento reducido.
- **Mensajes de estado:** los avisos usan `role="status"` (y `alert` si es error); la franja de rescate es
  `role="status"`.
- **No se declara certificación de accesibilidad:** fueron mediciones puntuales, no una auditoría formal.

## Pruebas

**Nueva:** `backend/test/finanzas-v2-rendimiento-i12.test.js`, con 4 casos:
- caché frente a una transacción revertida (falla sin el arreglo);
- otra conexión;
- catálogo, cartera e informe memorizados que ven lo nuevo, con resultados que no se pueden modificar;
- olvido al cerrar la última sesión.

`npm test` → **1868/1868**.

## Evidencia (`evidencia/i12-*`)

| Archivo | Muestra |
|---|---|
| `i12-medicion-{antes,despues}-S{1,2}.json` | las mediciones completas |
| `i12-no-guardado.png` | fila no guardada por la red caída |
| `i12-error-reintentar.png` | error de carga con su botón |
| `i12-rescate.png` | cambios rescatados al volver a abrir la bóveda |
| `i12-conflicto.png` | conflicto que conserva lo escrito |

## Límites conocidos

- **La carga masiva sigue lenta con volumen grande** (231 s para 14.400 movimientos). Cada confirmación recalcula
  los posibles duplicados con todo el histórico. Es un proceso de migración puntual; si hace falta, se puede
  procesar por lotes.
- **Movimientos del mes en S2:** su p95 (96 ms) varía entre corridas.
- **Tiempos de la pantalla:** se midió la ida y vuelta en la demo pequeña; no se midió con una base de 14.400
  movimientos.
- **Cachés del servidor:** son de un solo proceso. Con varios procesos escritores habría que compartir la
  invalidación. La revisión durable ya lo permite, pero la memoria de descifrado es por proceso.
