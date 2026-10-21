# I05 · Registro rápido y reutilización — probado (20-10-2026)

## Reutilizar obligaciones de Control interno (I05.5)

**Qué se encontró.** Control interno guarda cada matriz en `CI_REGISTROS`: `registro_id`, `matriz`,
`periodo` («AAAA-MNN»), `cliente_id`, `cliente_nombre`, `datos` (objeto) y `fecha_actualizacion`. No
tiene columna de versión, así que la versión de la fila es su `fecha_actualizacion`. Sirven para pagos:

| Matriz | Concepto en Finanzas | Destino | Monto esperado | Estado de los datos |
|---|---|---|---|---|
| `IVA` | IVA | SII (F29) | `datos.monto_pago` («MONTO A PAGO», numérico) | con datos |
| `PAGO_IMPOSICIONES` | Imposiciones | Previred | `datos.total_pago_intereses` o, si falta, `total_pagar_sin_intereses` (texto convertido a CLP) | la hoja venía vacía; queda lista para cuando se llene |

Campos comunes: cliente (`cliente_id`, `cliente_nombre`) y período de la obligación (`periodo` →
«AAAA-MM»). No se inventó ningún servicio de Control interno: se lee la tabla con su propio
`consultar_`.

**Cómo funciona**

- Se puede entrar desde el **Registro** (Formulario guiado → «Pagar una obligación que ya está en Control
  interno») o desde la **obligación** (en la fila IVA o Pago de imposiciones de Control interno,
  «Registrar el pago en Finanzas»: lleva el id y Finanzas abre el pago).
- Recorrido: elegir la obligación → revisar los datos precompletados (cliente, concepto, período,
  destino, monto pendiente) → confirmar la fecha y el monto real → guardar en borrador o confirmar.
- La operación guarda `origen = { CONTROL_INTERNO, registro_id, matriz, versión, monto_esperado }`,
  validado contra la fila real.
- **Pagos parciales permitidos.** No hay «una operación por obligación»: la lista muestra lo esperado, lo
  registrado y lo pendiente. Un reintento con la misma clave no repite el evento.
- Si el pago supera lo esperado, se avisa antes de confirmar; si es menor, se informa que es parcial.
- Si la obligación **cambia después**, el pago confirmado no se toca y su panel avisa («cambió en Control
  interno… $300.000 → $320.000»).
- Acciones nuevas: `finanzasFuentesObligacion`, `finanzasFuenteObligacion`.

## Registro como centro de trabajo (I05.1–I05.3)

- **Empresa concreta al crear.** Con «Todas las empresas», la primera fila nueva o el formulario guiado
  piden la empresa **una vez** y se recuerda mientras sigas en esa vista. Ya no se crean filas que fallen
  después por no tener empresa.
- **Columnas:** fecha, quién paga o recibe, cliente, naturaleza, concepto, entrada, salida, **Registro**
  (borrador listo, «Por completar: …», confirmada, anulada) y **Banco** (con banco, en parte, falta el
  banco, posible duplicado, «No aplica · efectivo»). «Efectivo» es un medio y «Con banco» es un vínculo:
  ninguno reemplaza al estado del registro.
- **Totales con su alcance.** «Totales de 2026-10 · todas las empresas…». Lo confirmado y los borradores
  van separados (demo: entradas confirmadas $1.276.000; borradores +$476.000 / −$89.000). La selección
  muestra su propio total: cantidad, cuánto entra y cuánto sale.
- **Orden por columna** (fecha, quién, entrada/monto) aplicado en el servidor **antes** de paginar
  (`orden`, `dir`). Se cargan hasta 500 filas y, si hay más, se avisa.
- **Guardado visible:** «Guardando…», luego «✓ Guardado HH:MM». Si sales con una fila editada sin
  guardar, el navegador avisa.
- **Duplicar** (botón o Ctrl+D) ocurre **en el servidor** (`finanzasDuplicarOperacion`): crea un
  borrador con fecha a revisar, copia empresa, cuenta, monto, tercero y todas sus partes, y **no** copia
  la referencia, el vínculo bancario, las aplicaciones ni el origen. Queda la marca «Duplicada de…».

## Formulario y panel coherentes (I05.4)

- El panel muestra solo los campos de la naturaleza de cada parte: cliente para ingresos y fondos;
  período y destino para fondos; proyecto para ingresos y gastos; **empresa contraparte solo para
  préstamos**. Un campo oculto **conserva su valor** (no se borra al ocultarlo) y se muestra si ya traía
  uno.
- Con una sola parte no se pide dos veces el monto. «Dividir importe» abre las partes con total, asignado
  y lo que falta asignar; el servidor exige la suma exacta.

## Plantillas (I05.5)

- **Vista previa** antes de crear (`finanzasPrevisualizarPlantillas`): una instancia por plantilla y mes,
  con fecha y monto, y cuáles **ya existen** (con su estado).
- Si la plantilla cambió, muestra en qué difiere lo ya generado («monto $450.000 → $470.000»). Generar de
  nuevo no duplica ni sobrescribe.
- Dos plantillas del mismo cliente conviven sin confundirse (la clave es plantilla + mes).

## Pruebas

- Nuevo `backend/test/finanzas-v2-registro-i05.test.js` (4 casos).
- `npm test` → **1836/1836**.

## Recorrido en el navegador (base DEMO, datos ficticios)

1. `i05-registro.png`: columnas Registro y Banco, alcance de los totales, «Datos por completar».
2. `i05-guiado.png` y `i05-fuentes.png`: la entrada «Pagar una obligación…» y la lista de Control interno.
3. `i05-pago-precompletado.png`: IVA de Panadería, 2026-09, esperado $185.000; se pide la empresa.
4. Pago parcial de $100.000 confirmado: la fuente queda con registrado $100.000 y pendiente $85.000.
5. `i05-desde-ci.png`: desde la fila de imposiciones (Constructora Norte, $412.500) se abre el pago
   precompletado.
6. `i05-panel.png`: «Desde Control interno…». Se ocultan préstamo y proyecto; se ven cliente, período y
   destino. Aparece el botón «Dividir importe».
7. `i05-empresa-una-vez.png`: con «Todas», la fila nueva pide la empresa una vez.
8. El duplicado quedó en borrador, 2026-10-20, $100.000, sin referencia y «Falta el banco».
9. `i05-plantillas.png`: la vista previa; la segunda vez dice «0 nuevo(s) · 1 ya existen».
10. `i05-orden.png`: ordenado por monto, de mayor a menor.

## Límites conocidos

- La matriz Pago de imposiciones está vacía en las planillas. La integración está hecha y probada con
  datos sintéticos; en producción mostrará filas cuando RR.HH. la llene.
- Abrir el pago desde Control interno exige el código de la bóveda de Finanzas: el enlace solo lleva el
  id de la fila.
- En 1440 px, la columna Banco se recorta. Se resuelve en I08 (navegación más angosta).
- La captura del manual del Registro se rehará después de I08.
