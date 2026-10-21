# I09 · Informes y lectura automática verificable — probado, con límites declarados (20-10-2026)

## Error grave encontrado y corregido

**El PDF y la exportación con revisión fallaban siempre con «Los datos cambiaron».** La revisión de datos usaba
`total_changes()` de SQLite, que cuenta también lo que escribe cada pedido: el último uso de la sesión
(`FIN_SESIONES`) y la bitácora. Entonces cada llamada «cambiaba los datos», y la revisión que la pantalla
enviaba nunca coincidía con la del servidor (en la demo pasó de `…-9` a `…-27` sin tocar nada). El error
venía de FIN-39.

**Ahora:** un contador `FIN_REVISION` que suben triggers solo en las tablas de datos financieros. No lo tocan
sesiones, bitácora, autenticador ni respuestas idempotentes. Los triggers se crean al primer uso y se vuelven a
revisar si aparece una tabla nueva o si una transacción se revierte.

**Verificado:**

- Leer dos veces da la misma revisión, y guardar un dato la cambia (prueba).
- En la demo, el PDF se genera con la revisión vista.
- Con una revisión vieja, el PDF sigue pidiendo recargar (`CONFLICTO_VERSION`).

## I09.1 · Un contrato para todos

El contrato de `finanzasReportes` sube a **v2**: `contract_version`, `rule_version`, `currency` y `reglas`
(tabla de elegibilidad). La pantalla, el detalle, los comentarios, el PDF y la planilla leen el mismo
`reporte_`; ninguno recalcula por su cuenta.

**Cada métrica** trae su ficha: definición, fuentes, exclusiones, fecha usada, moneda, calidad requerida y
dónde se consulta el detalle. La calidad requerida sale de `REQUISITOS`, la misma regla que evalúa la cifra.

**Lo que no se confunde:**

- Cobros con ventas: la base documental no llama «utilidad» a ventas menos cero; la ficha lo dice.
- Pagos con gastos devengados.
- Flujo con saldo bancario.

## I09.2 · Portafolio

En el Resumen, una tarjeta «Informes» lista los 12 informes y la pregunta que responde cada uno. Lleva al
lugar de la página o abre su pantalla.

| Informe | Dónde | Nuevo en I09 |
|---|---|---|
| Resumen mensual | Lectura del mes + cifras en dos zonas (flujo del mes / liquidez al corte) | zonas |
| Comparación | Tabla con mes anterior, año anterior y presupuesto | — |
| **Cascada de flujo** | Cobros y pagos por concepto hasta el flujo; lo ajeno y lo interno, aparte | **sí**, y verifica que cuadra |
| Presupuesto | Pantalla Presupuesto | — |
| **Cuentas y caja** | Apertura, entradas, salidas, cierre, cobertura y diferencia por cuenta | **sí** |
| Fondos de clientes | Pantalla Fondos y tarjeta del Resumen | — |
| Cobranza | Tarjeta del Resumen + pantalla | **antigüedad por tramos** (saldo confirmado) |
| Empresas | Tabla por empresa con **cuadre contra el grupo** | **sí** |
| Préstamos y gastos compartidos | Pantallas de Planificación | — |
| Obligaciones y proyección | Pantalla Compromisos y proyección | — |
| Proyectos | Pantalla Proyectos | — |
| **Servicios, canales y vendedores** | Cobros del mes por canal y por vendedor, y servicios vigentes | **sí**, con cobertura |

**Reglas para «Servicios, canales y vendedores»:**

- No inventa categorías: lo que no tiene dato aparece como «(sin dato en la ficha)» o «(cobro sin cliente)»,
  con su cantidad.
- Muestra la cobertura (cuántos clientes tienen canal o vendedor) y un botón «Completar fichas».
- Separa la caja recibida (cobros) de lo contratado (servicios vigentes) y dice cuál es cada métrica.

**En la demo (octubre 2026):**

| Cifra | Resultado |
|---|---|
| Cascada | $976.000 − $450.000 − $25.000 = $501.000, cuadra con el flujo propio |
| BCI ···2222 | apertura $2.408.000 + entradas $2.476.000 − salidas $1.800.000 = cierre $3.084.000; diferencia $0 |
| Empresas | suman lo mismo que el grupo (diferencia $0) |
| Canales | las fichas de la demo no tienen canal: todo aparece «(sin dato en la ficha)», con 0 de 2 clientes cubiertos |

## I09.3 · Gráficos y tablas

- **Gráfico de evolución:**
  - lleva escala (máximo y $0, con unidad) y el mes en curso marcado «en curso» (atenuado en el PDF);
  - los meses sin datos son huecos rotulados, no ceros;
  - la línea de presupuesto se llama «Presupuesto aprobado de cobros»: es solo de cobros;
  - tiene una **tabla equivalente** («Ver como tabla»).
- **Cascada:** tabla con barras proporcionales; cada concepto abre sus registros («Ver»).
- **Contribuciones al cambio:** «Ver qué cambió» del flujo abre el efecto de cada concepto en el flujo (un pago
  mayor resta), y cada fila lleva a sus registros.

## I09.4 · Motor de comentarios

**Hechos antes del texto.** Cada comentario trae `hechos` con cinco partes:

- `observa`: qué se observa;
- `magnitud`: cuánto representa;
- `componentes`: qué lo explica;
- `falta`: qué falta para concluir;
- `revisar`: qué revisar.

El texto se arma con los importes del momento; no hay frases fijas en el código.

**Lo que cambia la interpretación va primero y una sola vez.** En la demo se lee:

> «Octubre 2026 aún no permite evaluar una mejora: hay $1.350.000 por revisar en 1 movimiento(s), una
> coincidencia de $357.000 pendiente de vincular y 2 operación(es) por $400.000 sin su movimiento del banco.
> Completa esas revisiones antes de comparar el flujo.»

A continuación dice qué deja sin evaluar: las comparaciones, la disponibilidad propia y si alcanza para
noviembre.

**Sin repeticiones:** «meses de caja no determinable» ya no se repite cuando la causa es la misma; solo sale si
la razón es propia (no hay cartolas, no hay pagos de base).

**Calificación:**

- «Favorable», antes «Bien», solo sale de reglas que calificaron con datos comparables.
- Con datos provisorios, la caída del flujo se informa «sin calificar» y no como «alerta».
- La prueba T31 se ajustó así: el criterio original solo exige la provisionalidad.

**Prioridad:**

1. Lo que cambia la interpretación.
2. La severidad.
3. La materialidad.

La lectura muestra los **4 principales**; el resto queda en «Ver los otros N hallazgos».

**Acciones con contenido:**

- «Cómo se calculó» solo cuando la métrica tiene definición.
- «Ver qué cambió» solo cuando hay conceptos que compararon.
- El botón de destino dice adónde lleva («Ir a Cobranza», «Ir a Compromisos y proyección»…). «Revisar
  pendientes» queda solo para la falta de datos.
- La regla, su versión, la base, el corte y la revisión se ven en «Cómo se calculó», no en la lectura.

**Tabla de elegibilidad por regla:** está en el contrato, al final de la pantalla («Reglas de los
comentarios») y en el PDF.

Sin proveedor de IA: reglas y plantillas.

## I09.5 · PDF y planillas

**PDF:** se genera desde el contrato del servidor y se rechaza si la revisión cambió. Se inspeccionó el
archivo completo (5 páginas):

- encabezado con alcance, período, corte, base, moneda, estado, revisión y versión de reglas;
- lectura (principales y «otros»);
- indicadores con su estado y el porqué, y «—» si no se determinan;
- comparaciones (3 bases), con las fechas del tramo una sola vez;
- gráfico con escala;
- cascada con total y cuadre;
- pagos por concepto;
- cuentas y caja;
- antigüedad de la cobranza;
- calidad y pendientes;
- fichas de las métricas;
- reglas;
- pie con revisión;
- marca «CONFIDENCIAL» legible.

Los encabezados de tabla se repiten al cambiar de página.

**Defectos vistos al inspeccionar y corregidos:**

- «No determinable» repetido en Valor y en Estado.
- La escala cortada.
- Las fechas repetidas en cada celda.

**XLSX y CSV:**

- **Sin mes, no se exporta toda la base.** Movimientos, operaciones y aplicaciones exigen el mes o marcar
  «Todo el historial». Las aplicaciones ahora sí se filtran por mes.
- **El informe exportado** trae:
  - indicadores con su estado, las 3 comparaciones y la ficha;
  - razones de calidad;
  - comentarios (marcando los principales);
  - cascada con su cuadre;
  - cuentas;
  - serie, con «sin datos» en vez de cero.
- **Metadatos del mismo contrato:** corte, base, moneda, estado, revisión y versión de reglas.
- **Inspección del .xlsx:** 22 importes numéricos (los negativos también), 123 textos en línea y ninguna
  fórmula.
- **CSV:** un texto que parece fórmula se neutraliza con apóstrofo; un negativo sigue siendo número (prueba).

## Pruebas

- Nueva: `backend/test/finanzas-v2-reportes-i09.test.js`, con 6 casos:
  - fichas de las métricas;
  - cascada, cuentas y empresas;
  - informe comercial con «sin dato»;
  - comentarios sin repetición y con acciones con contenido;
  - revisión estable y secciones del PDF;
  - exportación acotada, metadatos y neutralización.
- Ajustadas en `finanzas-v2-reportes.test.js` (T31):
  - la severidad «info» y «sin calificar»;
  - el concepto se informa por su efecto en el flujo.
- `npm test` → **1853/1853**.

## Evidencia (`evidencia/i09-*`)

| Tema | Archivos |
|---|---|
| Resumen | `resumen` (dos zonas), `lectura` (4 principales, botones con destino), `390-resumen` |
| Detalle de un hallazgo | `que-cambio`, `como-se-calculo` (ficha + regla y revisión) |
| Secciones nuevas | `cascada`, `cuentas`, `comercial`, `portafolio` |
| Salidas | `exportar` (mes y «Todo el historial»), `informe.pdf` (5 páginas), `informe.csv` |

## Límites conocidos

- **Informes que viven en su pantalla:** Presupuesto, Fondos, Préstamos y gastos compartidos, Proyectos y
  Proyección siguen ahí. No se rehicieron en I09; su paridad funcional es tarea de I10.
- **Fechas en la planilla:** van como texto ISO (AAAA-MM-DD), no como fecha de Excel.
- **Comercial en la demo:** no se pudo ver con datos reales de canal o vendedor, porque las fichas no los
  tienen. La prueba sí cubre un cliente con canal y uno sin canal.
- **Base documental:** no trae documentos de gastos, así que no hay «utilidad» documental. Se declara, no se
  calcula.
