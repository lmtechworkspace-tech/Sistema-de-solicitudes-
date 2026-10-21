# I07 · Cargas, migración y reglas — probado (20-10-2026)

## Errores encontrados y corregidos (con prueba)

1. **Facturas en $0 desde la planilla.** El importador de la hoja FACTURAS convertía un monto ilegible
   (`#REF!`, `US$ 300`, texto) en **0** y publicaba la factura. Ahora la fila se rechaza como **incidencia**
   con su motivo y no se crea ninguna factura.
2. **«1.500» escrito como texto se leía como 1,5 → $2.** El lector de montos de la migración probaba primero
   el formato numérico de Excel. Ahora un texto con miles chilenos se lee como mil quinientos.

## Lo que se hizo

### Centro único (I07.1)

El mismo cuadro de **Bancos › Cargas** reconoce qué se sube y usa el **lector de siempre** (no se
reescribió ninguno):

| Archivo | Cómo se reconoce | Qué hace |
|---|---|---|
| Cartola del BCI (.xlsx) | su lector (`finanzasRevisarCartola`) | muestra cuenta, período, nuevos y si cuadra → «Importar» |
| Registro de Ventas del SII (.csv, .gz) | columnas Tipo Doc / Folio | resumen, empresa emisora → «Importar» (avisa las facturas que no se actualizan) |
| Saldos iniciales (.xlsx) | títulos cliente/RUT, corte, monto, fuente | revisión con incidentes → «Proponer» (quedan por aprobar en Fondos) |
| SIGECO / BANCOS (.xlsx) | sus hojas | staging y revisión por hoja (como antes) |
| Detalle del banco y filas sueltas | — | se indica dónde subirlos (necesitan cuenta o mapeo) |
| Cartola Santander | — | se dice **antes** que aún no hay lector (falta una cartola real); sus movimientos del Excel BANCOS entran como borradores con su origen |

Un PDF o una imagen se rechazan con una explicación, sin prometer nada.

### Revisar y corregir dentro de SIGSO (I07.2)

- En cada hoja cargada: primero el **resultado**, luego la fila de origen, los datos (con las fórmulas
  marcadas «ƒ») y las acciones.
- **Corregir** (`finanzasCorregirFilaCarga`): se escribe el valor correcto. El original del archivo **no se
  modifica**: la corrección se guarda aparte, con quién y por qué, y la fila vuelve a «por publicar» (su
  vista previa anterior ya no vale). No se crean clientes por parecido.
- **Apartar** con motivo: no se publica ni se reintenta. **Recuperar** la devuelve.
- Publicar dos veces no duplica (claves de origen).
- **Perfiles de mapeo del pegado:** guardan el encabezado, un ejemplo y su **versión**. Si el archivo trae
  otro encabezado, se avisa y se mapean solo las columnas con el mismo nombre; nunca se aplican posiciones
  viejas en silencio.
- Al publicar una hoja antes que aquellas de las que depende (clientes antes que catálogos, pagos antes que
  facturas…), se avisa qué falta publicar.

### Procedencia, fórmulas y monedas (I07.3)

- Ya se guardaba: archivo y huella, hoja (también las ocultas), fila, valores originales, fórmulas (como
  texto, nunca se ejecutan), destino, regla y responsable.
- Nuevo lector de montos (`monto_`):
  - error de fórmula → incidencia;
  - **otra moneda** (US$, USD, €, UF) → incidencia que conserva código e importe y la deja fuera del
    consolidado;
  - un «$» chileno sí es CLP.

### Cuadro de control (I07.5)

`finanzasCuadroControl`, por hoja:

- filas leídas y por estado (cada fila está en **un solo** estado);
- columna de monto usada (TOTAL antes que NETO);
- importe leído e importe sin resolver;
- **montos ilegibles que no se sumaron**;
- motivos de incidencia agrupados;
- historia de publicaciones.

### Editor de reglas (I07.6)

- «Nueva regla» y «Editar» con: glosa **exacta**, qué propone, **alcance** (empresa, cuenta, entra o sale),
  **vigencia** (desde/hasta), **evidencia** obligatoria, quién la creó y versión.
- El motor de sugerencias respeta el alcance y la vigencia.
- Antes de guardar se ve:
  - cuántos pendientes calzan y cuáles cambian;
  - **conflictos**: hoy los propone algo más fuerte, como una operación registrada o un pagador conocido;
  - si el nombre corto es ambiguo.
- Se mantiene: no hay reglas desde glosas genéricas ni desde movimientos divididos; un pagador con varios
  clientes conserva sus alternativas; cambiar una regla solo recalcula lo pendiente.

## Lo de I07.4 que ya estaba y se verificó

- Las 18 hojas de SIGECO entran a staging, también las ocultas.
- Una fila idéntica de otro libro (BANCOS 2026 contra Julio, la historia de Santander repetida) queda
  REPETIDA: no se suma dos veces.
- PAZ no crea una empresa (incidencia).
- UNITARIO queda como grupo **candidato** con su fórmula y su remanente.
- Una celda de presupuesto con texto («abc») no se vuelve cero.
- Las facturas inexistentes referidas por pagos quedan como incidencia.

## Pruebas

- Nuevo `backend/test/finanzas-v2-cargas-i07.test.js` (5 casos).
- `npm test` → **1845/1845**. Una corrida anterior mostró 1844 sin fallos, omisiones ni cancelaciones;
  parece un conteo inestable ajeno a Finanzas.

## Recorrido en el navegador (base DEMO)

Archivos .xlsx sintéticos generados con el escritor de zip del proyecto: saldos iniciales, una cartola BCI
de noviembre y una planilla SIGECO con `#REF!`, `US$` y un RUT mal escrito.

1. `i07-centro.png`: la tabla de qué se puede subir y qué no.
2. `i07-saldos.png`: 2 aceptadas → propuestas.
3. `i07-cartola.png` e `i07-cartola-importada.png`: se reconoció la cartola BCI ···2222 (cuadra, 2 nuevos)
   y se importó.
4. `i07-facturas.png` e `i07-cuadro.png`: FACTURAS con 1 publicada y 2 incidencias (fórmula y dólares).
   El cuadro usa TOTAL ($1.190) y dice que 2 montos ilegibles no se sumaron.
5. `i07-corregir.png`: corrección del RUT. La fila quedó PUBLICADA en la ficha de Panadería y el original
   (`99.999.999-9`) se conserva.
6. `i07-regla.png`, `i07-regla-impacto.png` e `i07-reglas.png`: la regla con alcance HomePymes, sale,
   vigente desde 2026-01-01 y evidencia. Al editarla a GDE: «Calzan 1 pendiente… Cuentas Básicas · alta →
   baja».

## Límites conocidos

- No hay lector de cartola Santander: requiere una cartola real para construirlo y probarlo.
- El detalle del banco sigue subiéndose en Bancos, porque hay que elegir la cuenta. El centro lo indica.
- No hay conversión de monedas: lo que no es CLP queda fuera del consolidado como incidencia, hasta definir
  la regla.
