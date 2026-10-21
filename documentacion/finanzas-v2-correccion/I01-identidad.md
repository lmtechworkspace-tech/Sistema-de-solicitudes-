# I01 · Identidad económica y doble conteo (20-10-2026)

## Reproducción (antes de corregir)

| Caso | Antes | Causa |
|---|---|---|
| Demo de octubre: movimiento Andes $357.000 **ya clasificado** + operación registrada Andes $357.000 + Panadería $619.000 | Cobros propios $1.333.000 | `finanzasHechos.todos_()` sumaba las partes confirmadas del banco **y** las operaciones confirmadas sin conciliar, sin preguntarse si eran el mismo dinero. |
| Prueba antigua T28 «banco primero» | Afirmaba 420.000 = dos veces 210.000 «antes de conciliar» | La prueba aceptaba el doble conteo. |
| Cobro registrado → aplicado a una factura → conciliado | La aplicación quedaba huérfana y la factura volvía a deber | Al conciliar, la parte del registro (`op:…`) desaparece de los hechos y la aplicación apuntaba a ella. |

En los datos del demo es **una sola operación**: misma fecha, cliente, monto y glosa. La corrección no cambia esos datos.

## Política adoptada (y usada por todos los consumidores)

| Relación | Tratamiento |
|---|---|
| Operación confirmada sin banco ↔ movimiento del banco **ya clasificado** sin vínculo; misma empresa, sentido y monto exacto, ±N días (parámetro `conciliacion_dias`, 10) y cuenta compatible | **Posible duplicado** (`finanzasHechos.conflictos_`). No se fusiona ni se borra. **Cuenta el banco** (la evidencia) y la operación queda fuera de las cifras como «pendiente de identidad», visible en calidad, Registro, Conciliación e Informes. |
| La persona confirma que son el mismo dinero | Concilia: un solo hecho. Cada parte del movimiento guarda `origen_ref` (`op:<id>:<parte>`). Así lo que apuntaba al registro (aplicaciones a facturas) lo sigue encontrando (`resolverRef_`, `alias_`). |
| La persona confirma que son pagos distintos | `finanzasMarcarDistintas` (capacidad CONCILIAR, versión obligatoria, motivo). Cuentan los dos. La decisión queda en la historia de la operación, se puede quitar y no se revierte al reimportar la cartola. Ese par ya no se propone ni se puede conciliar. |
| Movimiento todavía **sin clasificar** + operación registrada | No es conflicto: el pendiente no suma. Se propone conciliar (ya existía, T28 registro primero). |
| Efectivo o compensación | No pasa por el banco: nunca es posible duplicado. |
| Misma clave de reintento | Devuelve el mismo resultado (idempotencia existente). |

**Por qué cuenta el banco:** es la evidencia inalterada del dinero. Lo registrado que coincide puede ser la misma plata (lo más probable) o un cobro distinto que todavía no llega al banco. Mientras nadie decida, el total no se certifica: la calidad queda PROVISIONAL y el monto aparte se muestra junto a la cifra.

## Cambios

| Archivo | Cambio |
|---|---|
| `backend/logica/finanzasHechos.js` | Detección de posibles duplicados con índice por empresa, sentido y monto. Los registros en conflicto salen de `todos_()` y quedan en `conflictos_()`. Nuevos `origen_ref`, `resolverRef_` y `alias_`. |
| `backend/logica/finanzasOperaciones.js` | `hechosRegistro_` expone monto, sentido y decisiones «distintas». `guardar` y `detalle` devuelven `coincidencias_banco`. `listar` separa totales confirmados de borradores (QA-R12) y cuenta posibles duplicados. Nuevo `marcarDistinta_`. |
| `backend/logica/finanzasConciliacion.js` | `origen_ref` en cada parte al conciliar. Bloqueo explicado si una parte con aplicaciones se repartiría en varios cargos. Pares «distintos» excluidos de candidatos y de conciliar. Ventana de días configurable y ampliable (`dias`, hasta 120). La bandeja trae los `conflictos`. Nueva acción `marcarDistintas`. |
| `backend/logica/finanzasCobranza.js` | Una aplicación sobre un registro ya conciliado sigue encontrando su abono (alias). El registro en conflicto no se ofrece como abono, pero sus aplicaciones previas se respetan. «Ya aplicado» suma todas las referencias equivalentes. Error explicativo si se intenta aplicar un registro en conflicto. |
| `backend/logica/finanzasReportes.js` | Motivo de calidad `CONFLICTO_IDENTIDAD`, métrica `pendiente_identidad` y definiciones. |
| `backend/logica/finanzasCierre.js` | Paso obligatorio «Sin posibles duplicados por resolver» (I11.3). |
| `backend/server/router.js` | Nueva acción `finanzasMarcarDistintas`. |
| `frontend/js/finanzas-registro-v2.js` | Tiras confirmado / borrador / posibles duplicados. Estado «Posible duplicado». Bloque al inicio del panel con «Es el mismo: vincular» y «Son pagos distintos». Aviso al guardar. |
| `frontend/js/finanzas-conciliacion-v2.js` | Sección «Posibles duplicados» separada de las sugeridas. «Revisar y aceptar sugeridas» muestra cuáles y por cuánto. |
| `frontend/js/finanzas-informes-v2.js` | Cinta «Aparte, sin sumar» con enlace a Conciliación. |
| Pruebas | Nueva `finanzas-v2-identidad.test.js` (8 casos). T28 «banco primero» actualizada (esperaba el doble conteo). La prueba de cierre cuenta el nuevo paso obligatorio. |

## Pruebas

`node --test backend/test/finanzas*.test.js` → **103 / 103**.

| Caso | Resultado |
|---|---|
| QA-R01 registro primero, luego banco y vínculo | Pendiente del banco no suma; después de vincular, un hecho por $357.000. |
| QA-R02 banco primero, luego registro | Aviso al guardar; informe $357.000 (no $714.000); $357.000 aparte; calidad no completa; tras vincular, sin pendiente. |
| Demo de octubre | $976.000 + $357.000 aparte (antes $1.333.000). |
| QA-R03 dos cobros iguales legítimos | «Son distintas» → $240.000; reimportar no lo revierte; el par no se concilia ni se propone. |
| QA-R04 aplicar, conciliar y deshacer | La factura sigue pagada, nada huérfano, no se puede volver a aplicar el mismo abono. |
| Recepción mixta $619.000 conciliada | $119.000 cobro propio + $500.000 fondos; custodia $500.000; cada parte sabe su origen. |
| Anular el registro en conflicto y reintento | Sale del pendiente; la misma clave no duplica. |
| Efectivo | No se considera duplicado del banco. |

**En el navegador (demo, octubre):** informe con cobros $976.000 y pendiente $357.000; Registro con «Entradas confirmadas $1.276.000» y borradores aparte; panel y Conciliación con las dos decisiones. Evidencia en `evidencia/i01-*.png`.

## Pendiente o limitación

- La comparación y los comentarios automáticos todavía no usan la calidad para decidir si se puede evaluar una mejora. Eso es I03 / I09.
- Las pantallas de Fondos y Cobranza aún no muestran el pendiente de identidad junto a sus saldos (I04 / I06).
