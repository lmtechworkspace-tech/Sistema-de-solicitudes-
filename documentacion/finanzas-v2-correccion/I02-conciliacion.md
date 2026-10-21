# I02 · Conciliación parcial, fechas y correcciones — probado (20-10-2026)

## Qué cambió

**Cada vínculo lleva un importe.** `FIN_CONCILIACIONES` guarda `{monto, previo, motivo}` por par
movimiento ↔ operación. Lo disponible de cada lado = monto − vínculos activos (− diferencia explicada).

| Caso | Cómo se concilia | Resultado |
|---|---|---|
| Exacto 1:1, 1:N, N:1 | «Vincular lo marcado» o sugerida | `CONCILIADA` |
| Pago parcial | «Indicar importes…» (tabla movimiento × operación) | operación `PARCIAL`, el resto queda a la vista |
| Varios contra varios | «Indicar importes…» obligatorio; sin importes el servidor rechaza | cada par con su importe |
| Movimiento mayor que lo registrado | el resto del movimiento queda como parte **pendiente** del banco | no se inventa un ajuste |
| Diferencia que nunca llegará (comisión, retención) | «Explicar diferencia» en el panel, con concepto, motivo y respaldo | operación propia de COMPENSACIÓN (no es caja); la original pasa a `CONCILIADA` |

Estados de la operación: `SIN_BANCO` · `PARCIAL` («Banco en parte») · `CONCILIADA` · `NO_APLICA`.

**Fechas.** Los hechos usan la **fecha efectiva** (la de la operación registrada) para período y
reportes; se conservan `fecha_banco` y `periodo_banco`. La caja se calcula por fecha del banco
(`saldosAl_`). Vincular una operación de un mes cerrado está permitido porque sus cifras no cambian.

**Deshacer con dependencias.** `finanzasDesconciliar` se bloquea si, después de vincular, el movimiento
recibió gestión de fondos, préstamo, gasto compartido o aplicaciones de cobranza; el mensaje dice cuál.
Bancos no deja reclasificar un movimiento vinculado (código `CONCILIADO`).

**Ventana configurable.** Conciliación tiene «Buscar a ± 10/20/30/45/60/90 días» (servidor: tope 120).

**Vincular desde Por revisar** (Bancos → panel del movimiento): «Vincular con este registro» con los
candidatos; si ya está vinculado, lo dice y lleva a Conciliación; al vincular, pasa al siguiente pendiente.

## Pruebas

- `backend/test/finanzas-v2-conciliacion.test.js` (7): parcial (QA-R05), N:M con reversión si algo falla,
  movimiento mayor que la operación, explicar remanente, fechas con julio cerrado (QA-R06),
  deshacer bloqueado por dependencia, ventana de días.
- `node --test backend/test/finanzas*.test.js` → **110/110**.

## Recorrido en el navegador (base DEMO)

Arriendo registrado por $500.000; la cartola trae $450.000 («ARRIENDO OFICINA»).

1. `evidencia/i02-bandeja.png` — bandeja de octubre con selector de días y lo disponible por fila.
2. `evidencia/i02-seleccion.png` — marcados $450.000 vs $500.000: «No cuadra… indica los importes».
3. `evidencia/i02-importes.png` — tabla de importes: queda $0 del movimiento y $50.000 de la operación.
4. `evidencia/i02-panel-parcial.png` — Registro: «Banco en parte · llegó $450.000 de $500.000; falta $50.000», el vínculo con su importe, y los botones Buscar el resto / Explicar diferencia / Deshacer.
5. `evidencia/i02-explicar.png` — explicación con concepto «Comisión Banco» y respaldo.
   Resultado verificado por API: operación `CONCILIADA`, disponible 0, `remanente_explicado` con autor y fecha.

## Límites conocidos (honestos)

- El historial de la operación no lista el vínculo como evento propio; queda en la bitácora general
  (`CONCILIAR`) y en la sección Banco del panel.
- Una operación con aplicaciones de cobranza no se puede dividir ni vincular en parte (se avisa);
  primero se desaplica.
