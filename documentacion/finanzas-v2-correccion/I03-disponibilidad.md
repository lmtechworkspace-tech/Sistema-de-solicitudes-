# I03 · Disponibilidad, calidad, comparación y proyección — probado (20-10-2026)

## El problema que se corrigió

El comentario automático comparaba la **caja total** contra lo comprometido y decía «alcanza», aunque
faltaran saldos iniciales de clientes. En la demo: $3.084.000 en el banco, de los que $2.050.000 son de un
cliente sin saldo inicial aprobado, y $450.000 + ≈ $1.800.000 de compromisos y estimaciones.
**Ahora:** «No se puede afirmar si alcanza» con sus razones. La resta $3.084.000 − $2.050.000 = $1.034.000
se muestra aparte como **referencia no acreditada**. Tampoco se dice «no alcanza»: un déficit no acreditado
sería igual de engañoso.

## Tres cifras distintas (I03.1)

| Cifra | Nombre en pantalla | Qué es |
|---|---|---|
| `caja` | Saldo bancario al corte | Solo cuentas bancarias, con la fecha de la última cartola de cada una. No es plata propia por sí sola. |
| `custodia` | Fondos administrados de clientes | Suma de saldos A FAVOR por cliente; el déficit va aparte y no reduce lo de otro. |
| `caja_libre` | Disponibilidad propia | Solo se determina si se cumplen todos los requisitos; si no, `null` y «No determinable». |

## Evaluación común por métrica (I03.3)

`finanzasReportes.js` → `evaluar_()` y `REQUISITOS`. El contrato del informe trae `evaluacion` con
`{ metric, status: DETERMINED | PROVISIONAL | NOT_DETERMINABLE, amount, currency, cutoff, reasons, detalle, can_assess_sufficiency, referencial }`.
Cada métrica declara qué la vuelve no determinable y qué solo provisoria:

| Métrica | No determinable si… | Provisoria si… |
|---|---|---|
| Cobros/pagos/flujo/fondos | no hay datos | cobertura, descuadre, pendientes, posible duplicado, sin banco, mes en curso |
| Saldo bancario | no hay cartolas | cobertura, descuadre |
| Fondos de clientes | — | falta apertura, pendientes, posible duplicado |
| Disponibilidad propia | sin cartolas, cobertura, descuadre, apertura, pendientes, posible duplicado | — |
| Meses de caja | lo mismo que disponibilidad + sin pagos base | — |

`null` = desconocido; `0` = importe conocido igual a cero. La pantalla (tarjetas y «Cómo se calculó»), los
comentarios, el PDF y la exportación leen esta misma evaluación.

## Comparaciones homogéneas (I03.4)

- Mes cerrado: período completo contra completo.
- Mes en curso: **acumulado a la fecha contra el mismo tramo** del otro mes. Día comparable = mismo número
  de día, con tope en el largo del mes (31-oct se compara con 1–30 sep). Cada comparación trae `fechas`,
  `modalidad`, `periodo`, `corte`, `basis`, `alcance` y `revision`.
- Presupuesto con mes en curso: se muestra, pero **no se evalúa** (no hay regla de distribución aprobada).
- `evaluable`: solo si la comparación es interpretable y ninguno de los dos meses tiene cifras provisorias.
  Si no, se muestra la diferencia «sin calificar», sin color de mejor o peor. Una baja sigue avisándose con
  cautela; una subida provisoria nunca se pinta como buena.
- Los casos base cero, ambos cero, base negativa y cambio de signo se mantienen (T29).

## Proyección de recursos propios (I03.5)

`finanzasPlanificacion.js` → `proyeccion`:

1. Parte de la disponibilidad propia al corte. Si no es determinable, el escenario es **PARCIAL**: arranca
   desde la referencia, con las razones a la vista.
2. El horizonte empieza en el **mes del corte**: se cuenta lo que vence o se paga después del corte. En ese
   mes se descuenta lo ya pagado de cada obligación.
3. La cobranza, los compromisos confirmados y las estimaciones van separados. Los fondos de clientes van en
   su propio circuito.
4. Un compromiso del mismo concepto **reemplaza** la estimación de ese mes. La sustitución se muestra y no
   se suman los dos.
5. La cobranza es un escenario (el % elegido), con las facturas que la componen.
6. Una obligación sin pagos queda «por determinar»: no se inventa un monto.
7. `suficiencia.evaluable` solo con disponibilidad determinada y sin montos por determinar.

El tablero antiguo (`finanzasTablero`, sin ruta en el menú desde FIN-48) ya no concluye «alcanza».

## Pruebas

- Nuevo `backend/test/finanzas-v2-disponibilidad.test.js` (5 casos): el caso del PDF, la disponibilidad
  determinada con apertura, la diferencia entre null y 0, el tramo comparable con tope de mes, y la
  proyección parcial con sustitución.
- `node --test backend/test/finanzas*.test.js` → **115/115**.

## Evidencia (base DEMO)

- `evidencia/i03-informe.png`: «Datos provisorios»; saldo bancario $3.084.000 con «última cartola al 14-10»;
  fondos de clientes «Provisoria»; disponibilidad propia «—, No determinable (referencia $1,0 M, no acreditada)»;
  comparaciones «sin calificar».
- `evidencia/i03-disponibilidad.png`: «Cómo se calculó» con el estado, las razones (cada una con «Ir»), la
  referencia y la cobertura.
- `evidencia/i03-proyeccion.png`: «No se evalúa si alcanza…», escenario parcial y saldos marcados «referencial».

## Límites conocidos

- Hoy no existe una regla de distribución diaria del presupuesto. Por eso el presupuesto contra un mes en
  curso se muestra y no se evalúa.
- Para definir la caja chica se necesitan sus hechos y su apertura (I06). Hasta entonces, el «saldo
  bancario» incluye solo bancos y lo declara.
