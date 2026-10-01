# Control interno — las matrices de Contabilidad y RR.HH. en SIGSO

Inicio: 2026-10-01. Pedido del dueño: pasar las matrices que hoy se llenan en el
Drive a SIGSO, para probar si ingresar los datos aquí suma al proceso y, sobre
todo, para sacar reportes. **Mientras dure la prueba, el registro oficial para la
certificación sigue en el Drive.** El módulo no escribe en el SGC (Calidad ›
Servicios prestados).

## Versión "espejo del Excel" (2026-10-01, tarde)

Segundo pedido del mismo día, con las 7 planillas reales: *"que la información
completa se distribuya según corresponde, que sea lo más similar al Excel: en
Contabilidad igual que están ordenadas, en RR.HH. por las hojas del libro; y
mejorar bastante el módulo, sobre todo los reportes"*. Decisiones del dueño:

| Tema | Decisión |
|---|---|
| Lo ya importado (6.305 filas de 2026, todas importadas) | Se **reemplaza**; lo ingresado a mano en SIGSO se conserva |
| Años | **2022–2026 completo** (~41.000 filas) |
| Datos sensibles | Las **claves** (Previred, DT, SENCE, plataformas, AFC) **nunca** se cargan; el **motivo** de la licencia sí, visible solo para los miembros de RR.HH. |
| Reportes | Los cuatro: informe mensual, panel histórico, ficha por cliente, personas y tiempos |

### Qué cambió respecto de la primera versión

| | Antes (mañana del 1-oct) | Ahora |
|---|---|---|
| Matrices | 18 resumidas (6 + 12) | **54**: 15 de Contabilidad (incluye las listas de cada libro) + **39 de RR.HH., una por hoja y en el orden del libro** |
| Columnas | ~2/3, con nombres propios | **Las mismas de la planilla, con su nombre y orden** (923 columnas). Las de versiones viejas se reconocen por nombre y se muestran solo si el mes tiene datos |
| Contabilización | checklist de 3 grupos, un quién/cuándo por grupo | **Encabezado de dos niveles como el Excel**: quién y cuándo por cada bloque |
| Convenios | lista de convenios dentro de la fila | Columnas Convenio 1…9 como en la planilla |
| Estado | escrito a mano en una lista | **Situación calculada** con las columnas de la fila (regla por matriz) |
| Años | 2026 | 2022–2026 |
| Reportes | 1 tabla por matriz | 4 reportes, con PDF y Excel |

## Cómo está armado

- `backend/logica/controlInternoColumnas.js` — las columnas de cada matriz,
  **generadas** de las planillas reales (`backend/herramientas/control-interno/`,
  ver su LEEME). Cada columna: `clave`, `etiqueta` (el nombre del Excel), `tipo`
  (texto, fecha, monto, número, hora, texto_largo), `nombres` (cómo se llamó en
  cada versión), `grupo` (encabezado de dos niveles), `rol` (cliente / rut /
  responsable), `antigua` y `sugerencias` (valores frecuentes, se ofrecen al
  escribir).
- `backend/logica/controlInternoMatrices.js` — lo que la planilla no dice:
  - `tipo`: **mensual** (una hoja por mes: Contabilidad), **registro** (lista que
    crece con cada requerimiento: RR.HH.; el mes sale de una fecha) o **lista**
    (foto de la situación de cada cliente, sin mes ni liberación);
  - `situacion(datos)`: pendiente / en proceso / terminado / no aplica (o las
    propias de Convenios: sin convenio / al día / con cuotas vencidas), leyendo las
    columnas igual que una persona: el texto de la columna de estado si dice algo
    claro ("OK", "ENVIADO", "NO APLICA", "PENDIENTE"…), si no, una fecha de cierre
    (envío al cliente, carga en la DT, pago…), si no, cualquier avance;
  - `tiempos` (de qué fecha a qué fecha se miden los días de respuesta),
    `montos` (qué se suma en los reportes), `copiar` (qué se arrastra al abrir el
    mes), `sensibles`.
- `backend/logica/controlInternoPlanillas.js` — cómo se leen las planillas
  (encabezado en distintas filas y versiones, columnas repetidas, hojas sin año,
  fechas como número de serie, claves escritas en celdas). Lo usan el importador
  y el generador.
- `backend/logica/controlInterno.js` — el motor: permisos, listar por mes / año /
  lista, guardar celda a celda (todo lo de la planilla se guarda tal cual, "NA"
  incluido), situación, responsable (el nombre de la planilla contra las cuentas),
  abrir el mes, liberar/anular, historial.
- `backend/logica/controlInternoImportar.js` — importación completa.
- `backend/logica/controlInternoReportes.js` — los cuatro reportes.
- Pantalla: `frontend/js/control-interno-v2.js` (planilla, fila completa,
  accesos, importación) y `frontend/js/control-interno-reportes-v2.js`.

### La planilla en pantalla

- Mismas columnas y orden que el Excel; encabezado de dos niveles donde la
  planilla lo tiene; quedan fijas la marca, el N°, la **Situación** y el cliente.
- Se edita en la celda: clic, **Enter** guarda y baja, **Tab** avanza, **Esc**
  cancela. Las columnas con valores repetidos ofrecen sugerencias.
- Contabilidad: un mes a la vez (‹ mes ›) y "Abrir el mes" copia los clientes del
  anterior. RR.HH.: un año a la vez, con filtro de mes. Listas: completas.
- El N° abre la fila completa con su historial (y la hoja de origen si se
  importó). Se muestran 200 filas y "Mostrar más".
- Excel: descarga lo que se ve, con las columnas de la planilla.

## Importación (solo ADM)

Control interno › Resumen › **Importar planillas** → elegir las 7 → **Revisar**
(simula: filas por matriz, desde/hasta, clientes fuera del catálogo, columnas de
claves que no se cargan, hojas que no son matrices) → **Reemplazar e importar**.

- Reemplaza lo que vino de planillas en las matrices de esos archivos (incluida la
  carga anterior con la estructura vieja). Lo ingresado a mano se conserva.
  Volver a importar el mismo archivo deja lo mismo. Las liberaciones hechas sobre
  filas importadas se pierden al reemplazar.
- No se importan: listas de validación, macros, plantillas vacías ("Datos
  finiquito electrónico"), "Claves plataformas externas", hojas de notas o de
  cálculo ("Hoja 14/15/23/25"), los informes hechos a mano ("Hoja 16/22") y las
  copias ("Copia de OCTUBRE").
- Medido con las planillas reales en una copia local: **40.889 filas en 19 s**,
  Contabilidad sep-2022 → oct-2026, RR.HH. desde 2022.
- Hallazgos de la lectura (para revisar con las encargadas): fechas con año mal
  tipeado (0204, 2016, 2032) que no se usan para el mes; filas sin fecha que
  toman el mes de la fila anterior; ~1.200 filas con clientes que no calzan con el
  catálogo; la hoja "SOLO RENTA 2026" tenía una clave del SII escrita junto al
  nombre de la empresa (no se guarda).

## Reportes

| Reporte | Qué responde |
|---|---|
| **Informe mensual** | El "INFORME PROCESO MENSUAL" que hoy se arma a mano por matriz: realizado por, período, clientes activos / pendientes / cerrados, avance y comparación con el mes anterior, situación de las filas, por responsable, montos, días de respuesta (tramos) y el detalle. De cualquier matriz y mes. |
| **Panel histórico** | Por departamento o matriz, desde 2022: filas y % terminado por mes, año contra año, por matriz; en una matriz, también montos, días de respuesta y clientes por mes. |
| **Ficha por cliente** | Todo lo del cliente en todas las matrices: lo pendiente, por matriz, montos por año y su actividad de 24 meses. |
| **Personas y tiempos** | Carga por persona, % terminado y días de respuesta; días por matriz; antigüedad de lo sin terminar y lo más antiguo. |

Todos con PDF (Chromium en el servidor) y Excel, desde el motor común de reportes.
Medido: informe mensual 6–21 ms, panel de un departamento 0,5 s, ficha 50 ms.

## Seguimiento de convenios TGR (etapa 1, 2026-10-01)

Reemplaza la hoja impresa de Francisca (reunión del 30-09): por cada folio
imprimía "Imprimir cuotas de convenios vigentes" de la TGR, a mitad de mes
marcaba cada cuota a mano (azul pagada, rojo vencida, verde contabilizada) y
después traspasaba a la matriz Convenios (≈ medio día al mes).

Control interno › Contabilidad › Convenios y postergaciones › **Seguimiento de
cuotas TGR** (`frontend/js/control-interno-convenios-v2.js`,
`backend/logica/controlInternoConvenios.js`, tabla `CI_CONVENIOS`).

| Qué | Cómo |
|---|---|
| Convenio | Cliente (catálogo o texto), folio (único), tipo IVA / Renta / IVA y Renta / Otro, fecha, pie, deuda total. Estado vigente / terminado / caído (caído pide motivo). |
| Cuotas | **Pegar desde la TGR**: se copia la tabla de "Imprimir cuotas de convenios vigentes" y se pega; "Revisar" muestra qué cambia antes de aplicar. Montos con punto de miles, "(*)", tabulaciones o una celda por línea. Si lo pegado es de otro folio, se rechaza. Sin claves: la persona entra a la TGR como siempre. |
| Revisión manual | Por cuota (o varias a la vez): pagada / vencida y contabilizada, con fecha. Volver a pegar conserva lo marcado; si la TGR ya da por pagada una cuota marcada "vencida", pasa a pagada. |
| Situación | Calculada: pagada (TGR o revisión), vencida (pasó la fecha), por vencer, y la **cuota de ajuste** (la última en $0) que no cuenta como impaga. |
| Alertas | Cuotas vencidas sin pagar, pagadas sin contabilizar, vencen en 7 días, convenios sin cuotas cargadas, todas pagadas → marcar terminado. |
| Desde la matriz | "Crear fichas desde la matriz Convenios" (botón ↑): cada folio del mes que no esté en el seguimiento entra con su fecha, pie, deuda, tipo (y caído si así figura). |
| A la matriz | "Pasar a la matriz del mes": llena Convenio 1…9 de la fila del cliente (folio, pie, deuda, cuotas canceladas y vencidas, situación "AL DIA" / "N CUOTAS VENCIDAS" / "CAÍDO" / "TERMINADO", término y tipo); quién realiza = el primer nombre de la cuenta, fecha = hoy. **No pisa** lo que la matriz ya sabe: en convenios sin cuotas cargadas se mantienen cuotas pagadas/vencidas/situación de la matriz, y los folios que están en la matriz y no en el seguimiento se conservan. Solo se escriben las casillas que cambian. |
| Historial | Cada pegado (con lo que cambió en la TGR), marca, cambio de estado y edición. |

Permisos: los de la matriz Convenios (Contabilidad): solo lectura ve y puede
revisar un pegado, no guardar. Tests: `backend/test/control-interno-convenios.test.js`.

Siguiente (decidir con Francisca): robot de la TGR (etapa 3) que haga el pegado
solo; mientras, el pegado manual ya evita imprimir y traspasar.

## Ajustes de la reunión con Francisca (etapa 2, 2026-10-01)

| Qué | Dónde | Cómo |
|---|---|---|
| Columnas sin uso | Facturación: CÓDIGO, CLASIFICACIÓN INTERNA, ENVIAR A CLIENTE/OBRA | Ocultas por defecto, con sus datos; botón "Ver columnas sin uso" (`sinUso` en `AJUSTES` de `controlInternoMatrices.js`) |
| Qué es cada columna | Facturación, IVA, Convenios, Anotaciones | Al pasar el mouse por el encabezado (subrayado punteado) y bajo cada campo de la fila completa (`ayuda`) |
| Hojas que ya no se usan | Cartas poder (libro de IVA) y Arriendos | Al final del menú, en "Hojas que ya no se usan"; se siguen importando |
| Postergación del IVA | IVA › fecha vencimiento | POSTERGA = SI + fecha de postergación → vence 2 meses después (sábado o domingo → lunes; sin feriados). Regla sacada de la planilla 2025-2026 (20-02 → 20-04, 19-03 → 19-05) |
| PPM | IVA › columna nueva VENTAS (BASE PPM) | MONTO PPM = ventas × tasa. La tasa va en % (0,5 = 0,5 %); si viene como fracción de una celda con formato % (0,01) se entiende 1 % |
| Lo calculado | Cualquier columna con fórmula | Se ve en azul y cursiva; se recalcula si cambian sus datos; si la persona escribe otro valor, ese manda (`datos._auto`) |
| "No aplica" de una vez | Contabilización › Abrir el mes | Lo que el mes anterior decía NO APLICA / NA en las tareas se precarga (el perfil del cliente sale de su historia) |
| Clientes nuevos del mes | Toda matriz mensual con cliente; informe mensual | Primera vez que el cliente aparece en esa matriz (el primer mes con datos no cuenta). Marca "Nuevo", filtro y KPI del informe |
| Alertas del IVA | IVA, sobre la planilla | (1) impuesto único sin recordatorio pasado el 15; (2) postergaciones que vencen en 10 días sin pago; (3) impuesto único que RR.HH. informó en 3 % e IUSC y que en IVA está vacío o en 0, con "Usar este monto" (`controlInternoAlertas.js`) |
| Anotaciones resueltas | Notificaciones y anotaciones SII | Columna RESUELTA; situación Vigente / Resuelta. Al importar se lee el color: celda azul = resuelta (en la planilla real: 42 de 222) |
| Servicios sin matriz | Contabilidad › Otros servicios | Certificado de deuda TGR, E-RUT, carpeta tributaria, pre-renta, creación de empresa, declaración de renta, término de giro: una fila por solicitud |
| Mes sin año | 3 % e IUSC (RR.HH.) | "MAYO" a secas = el último mayo que pasó (antes quedaba en el mes de la importación) |

Hallazgo de control: en la copia de las planillas, RR.HH. informa impuesto único
para clientes donde la matriz de IVA dice 0 (p. ej. $86.818 contra 0). La alerta
(3) los muestra cuando los dos están en el mismo mes.

Las columnas de RESUELTA y del mes de 3 % e IUSC necesitan **volver a importar**
las planillas (Anotaciones y Control de matrices) para verse con los datos del Drive.

## Permisos (verificados en el servidor)

1. La cuenta necesita el módulo **Control interno** (Administración › Cuentas).
   ADM lo tiene siempre.
2. Por departamento (Control interno › Accesos, solo ADM): **Registra** o
   **Solo lectura**.
3. Ven todo sin registrar: Gerencia y el Encargado del SGC.
4. **Libera** quien libera el área en Calidad › Servicios prestados › *Quién libera*
   (una sola lista para los dos módulos), además de la jefatura de área y el
   Encargado del SGC. Nadie libera lo que realizó. Editar algo liberado le quita
   la liberación (vuelve a revisión) y queda en el historial. Las listas no se
   liberan.
5. Columnas sensibles (motivo de la licencia): solo los miembros del departamento
   y ADM; el resto ve "•••" y no puede cambiarlo.

## Datos y escala

- Tablas: `CI_REGISTROS` (cada fila de la planilla; sus celdas en `datos`, más
  `_fila`, `_hoja` y `_origen` si se importó), `CI_MIEMBROS`, `CI_HISTORIAL`
  (también el de los convenios: `registro_id` = `convenio_id`), `CI_CONVENIOS`
  (las cuotas en JSON dentro de la fila: son ≤ 72 por convenio).
- Siempre se consulta filtrando en SQL por matriz + período con índice. Los
  reportes leen solo las columnas fijas salvo cuando necesitan montos o fechas.

## Pendiente (decidir con el uso)

- Que la liberación aquí genere la evidencia de Servicios prestados (§8.5/8.6)
  sin doble registro — apagado a propósito mientras el Drive sea el oficial.
- Conciliar los clientes fuera del catálogo (el panel los muestra con "•").
