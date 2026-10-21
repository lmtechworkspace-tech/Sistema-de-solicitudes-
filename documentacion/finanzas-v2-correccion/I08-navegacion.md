# I08 · Navegación y sistema visual — probado, con límites declarados (20-10-2026)

Todo se verificó en la base DEMO local (datos inventados), con Chrome sin ventana a 1440×900, 1366×768,
1024×768, 768×1024 y 390×844, en claro y oscuro, y con la cuenta de solo lectura.

## Errores encontrados y corregidos (con prueba)

1. **Cobranza tapaba «Estado» y cortaba «Saldo».** La tabla medía 1155 px en un espacio de 1015 px, y la
   columna de acciones fija se montaba encima. Ahora el documento y los créditos bajan de línea y las
   acciones van apiladas: la tabla mide lo mismo que su espacio a 1366 (`i08-1366-cobranza.png`).
2. **Un corte de red decía «Failed to fetch».** Ahora dice: «No hay conexión con el servidor…». Además, un
   error de carga nunca se muestra como lista vacía (`i08-error-cobranza.png`).
3. **«Todas / sin cuenta» era una sola opción.** Ahora son dos filtros distintos: «Todas las cuentas» y
   «Sin cuenta asignada». Si la cuenta elegida es de otra empresa, se avisa y se vuelve a «todas»; ya no
   queda filtrando en silencio. Prueba nueva en el backend.
4. **El modo oscuro elegido a mano no aplicaba la paleta de Finanzas.** El CSS usaba `data-theme`, pero
   SIGSO marca el tema con `data-tema`. Corregido.
5. **Etiquetas de estado en oscuro bajo 4,5:1.** La de «crítico» medía 4,0:1. Ahora mide 5,1:1 y
   conserva su color.
6. **Quien solo consulta veía casillas de selección en Registro.** No le servían de nada. Ya no aparecen,
   y el tabulador no pasa por ellas.

## Lo que se hizo

### I08.2 · Estructura

La navegación del módulo vive en la segunda columna de SIGSO (244 px en escritorio) y se quitó el menú de
arriba. Hay 7 áreas con los nombres de la orden; Registro, Pendientes y Seguimiento del mes van primero.

Al abrir la bóveda se entra a la pantalla pedida por la ruta o a la última válida. Si no hay ninguna, la
operación entra a Registro y quien consulta, al Resumen. Lo que se recuerda es solo el nombre de la
pantalla.

La bóveda abierta (reloj y candado) va junto a las acciones de la cabecera, en la misma fila.

**Origen y retorno:**

- Quien llega a una pantalla desde Pendientes o desde la ficha de un cliente ve «← Volver a …».
- Pendientes vuelve con el foco en la fila siguiente.
- La ficha vuelve abierta en la misma pestaña.
- Navegar por el árbol olvida el retorno.

**Adaptaciones respecto de la tabla de la orden** (no se crearon pantallas duplicadas):

- *Comparaciones* e *Informes detallados* viven dentro de Resumen (selector «Comparar con» y detalle
  de cada cifra). Su cartera se rehace en I09.
- *Versiones* del cierre se abren desde cada mes, en Revisión del período.

### I08.3 · Contexto común

- Respuestas que llegan tarde: las 14 vistas descartan las que ya no corresponden a la pantalla actual
  (se verificó que todas usan `turno`/`vigente`).
- El contexto (`sessionStorage`) guarda solo filtros y nombres de pantalla. Ningún monto ni cliente queda
  en un almacenamiento persistente.

### I08.4 · Registro

**Espacio vertical:**

- Se quitó la bajada repetida de la pantalla; la explicación vive en el manual.
- Los bloques se separan 12 px, igual que en Bandeja, y no se suman los márgenes propios.
- Etiquetas de las tiras más cortas.

| Tamaño | Filas visibles antes | Ahora (cómoda) | Ahora (compacta) | Texto de la fila |
|---|---|---|---|---|
| 1440×900 | 7 | 8 | — | 14 px (antes 13 px) |
| 1366×768 | 5 | **6** | 8 | 14 px |

- **Densidad cómoda/compacta:** un botón en la última celda del encabezado de la tabla. Es una
  preferencia de cada persona y se guarda sin datos financieros.
- El encabezado de la tabla queda fijo dentro del contenedor.
- Orden por fecha, cliente, monto y estado (desde I05).
- **Elección de columnas:** no se ofrece, por decisión. Las 9 columnas visibles son las que se necesitan
  para confirmar, y la orden prohíbe esconderlas; el resto está en el panel.

### I08.5 · Paneles

- El panel de detalle mide 600 px en escritorio (rango pedido: 480–640) y ocupa todo el ancho en el
  teléfono.
- Escape lo cierra y el foco vuelve a donde estaba.

### I08.6 · Estación de pendientes (nueva)

**Backend:** `finanzasPendientes` (`backend/logica/finanzasPendientes.js`). Reúne lo que ya existe, sin
copiar operaciones:

| Tipo | De dónde sale | Impide cerrar | Abre |
|---|---|---|---|
| Movimiento del banco sin clasificar | movimientos no confirmados | sí | Bancos › Movimientos (su mes) |
| Posible duplicado | conflictos de identidad (I01) | sí | Conciliación |
| Datos por completar | borradores con faltantes | no | Registro filtrado en «Datos por completar» |
| Sin su movimiento del banco | confirmadas sin banco o en parte | no | Conciliación |
| Cobro sin aplicar | abonos con saldo sin aplicar | no | Cobranza del cliente |
| Fondos sin gestión | saldo sin gestión por cliente | no | Fondos del cliente |
| Saldo inicial por aprobar | aperturas propuestas | no | Fondos |

**Orden explicable** (no es un puntaje de riesgo): primero lo que impide cerrar el mes, después lo más
antiguo y, a igual antigüedad, el importe mayor. La pantalla lo dice tal cual.

**Fallas parciales:** si una fuente falla, el resto se muestra y se avisa que la lista puede estar
incompleta.

**Solo lectura:** quien solo consulta ve la misma lista. Las acciones abren la pantalla de origen, donde
rigen sus permisos.

**En la demo:** 20 pendientes de 7 tipos.

1. «Completar» abrió el Registro filtrado, con «← Volver a Pendientes».
2. Al volver, el foco quedó en la fila siguiente.

Antes, «Pendientes» era otra entrada a la misma vista de Movimientos.

### I08.7 · Cliente

La ficha tiene ahora 5 pestañas: Resumen (ficha comercial), Cobranza, Fondos, Servicios y documentos, e
Historial.

- Arriba, separados: lo que debe por servicios y los fondos administrados. No se compensan.
- Cambiar de pestaña no vuelve a pintar: lo escrito y no guardado se conserva (verificado).
- Las flechas ← → recorren las pestañas.

### I08.9 · Revisión del período (reescrita)

Antes eran tres columnas estrechas con la misma lista. Ahora:

- **Un selector de meses** con su estado. Se distingue «Cerrado» de «Cerrado con excepciones» (marca
  nueva en el backend).
- **El mes elegido:**
  - por defecto, el abierto más antiguo, que es el que toca cerrar;
  - cuántos requisitos están listos;
  - **Siguiente paso y a quién le toca**;
  - «Bloquean el cierre», cada uno con su botón al origen;
  - «Avisos (no bloquean)»;
  - lo ya listo, plegado.
- **Cerrar:** el servidor permite cerrar sin revisión (así quedó en FIN-41). La pantalla ahora lo nombra:
  «Cerrar sin revisión», como acción secundaria. Solo con el mes en revisión dice «Cerrar el mes» y es la
  acción principal. Quien solo consulta no ve Cerrar, Enviar ni Observar.
- **Transición SIGECO:** la comparación y el retiro de la planilla quedan plegados en «Transición desde
  la planilla SIGECO». Siguen accesibles, pero ya no dominan el cierre.

### I08.10 · Contraste medido con el CSS real

Mezclando las transparencias sobre el fondo real:

| Elemento | Claro | Oscuro |
|---|---|---|
| Título | 16,4 | 15,8 |
| Bajada | 5,5 | 7,1 |
| Texto de fila | 17,9 | 14,5 |
| Texto secundario | 5,3 | 5,4 |
| Encabezado de tabla | 5,3 | 5,4 |
| Etiqueta de estado (la más débil) | 4,5 | 5,1 (antes 4,0) |
| Chip de filtro | 5,7 | 6,9 |

### I08.11 · Tamaños, teclado y estados

**Tamaños y teclado:**

- Ningún tamaño probado desborda la página en horizontal (1440, 1366, 1024, 768 y 390), en las 8 vistas
  medidas.
- En el teléfono, el árbol vive en el menú ☰ de SIGSO. Los filtros pasan a una fila desplazable y
  Pendientes se ve como lista.
- El botón de Préstamos ya no se corta: la celda de acciones vuelve a ser celda de tabla y la columna de
  acciones queda fija a la derecha.
- Tabulador: foco visible en botones y filtros. Escape cierra el panel y devuelve el foco.
- Movimiento reducido: las transiciones bajan a 0,001 s.

**Estados verificados:**

- **Oscuro:** Registro, Cobranza, Revisión del período y Pendientes.
- **Error:** se simuló una falla de red en Cobranza.
- **Vacío:** mensajes propios por filtro.
- **Solo lectura:** Resumen, Registro, Revisión del período y Pendientes.

## Pruebas

- Nueva: `backend/test/finanzas-v2-pendientes-i08.test.js`. Cubre:
  - los pendientes salen de su origen y no crean filas;
  - el orden;
  - el filtro por tipo;
  - quien solo consulta ve lo mismo;
  - lo resuelto sale de la lista.
- Nueva en `finanzas-v2-registro-i05.test.js`: «Sin cuenta asignada» frente a «Todas las cuentas».
- `npm test` → **1847/1847**.

## Evidencia (`evidencia/i08-*.png`)

| Tema | Archivos |
|---|---|
| Registro y su densidad | `1440-registro`, `1366-registro`, `1366-registro-compacta` |
| Cobranza | `1366-cobranza` |
| Pendientes | `1440-pendientes`, `pendientes-origen` (con «Volver a Pendientes»), `390-pendientes` |
| Revisión del período | `1440-cierre`, `1440-cierre-cerrado`, `390-cierre` |
| Ficha del cliente | `ficha-resumen`, `ficha-cobranza` |
| Tamaños | `768-tablero`, `390-registro` |
| Oscuro | `oscuro-registro`, `oscuro-cobranza`, `oscuro-cierre`, `oscuro-pendientes` |
| Solo lectura | `lectura-resumen`, `lectura-registro`, `lectura-cierre`, `lectura-pendientes` |
| Otros | `error-cobranza`, `1440-panel`, `1440-prestamos` |

## Límites conocidos (no se dan por hechos)

- **Capturas del manual de Finanzas desactualizadas.** El texto del manual describe todavía el menú de
  pestañas de arriba y el cierre en columnas, y sus imágenes tienen marcas numeradas. Hay que rehacer las
  capturas y las marcas cuando la interfaz quede estable (al final de I13), no por partes.
- **Zoom:** se probó por anchos equivalentes; un zoom de 200 % a 1366 equivale a unos 683 px, entre los
  768 y los 390 medidos. No se probó con el zoom del navegador.
- **Botones pequeños de 32 px** en las tablas, bajo el objetivo de 36–40 px. Se mantuvieron por densidad;
  los controles de formulario miden 40 px.
- **Revisión obligatoria antes de cerrar:** hoy es opcional por diseño (FIN-41). Exigirla es una decisión
  del dueño, que se retoma en I11.
- **Informes:** los 3–4 hallazgos principales y la cartera de reportes son de I09.
