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
  `_fila`, `_hoja` y `_origen` si se importó), `CI_MIEMBROS`, `CI_HISTORIAL`.
- Siempre se consulta filtrando en SQL por matriz + período con índice. Los
  reportes leen solo las columnas fijas salvo cuando necesitan montos o fechas.

## Pendiente (decidir con el uso)

- Que la liberación aquí genere la evidencia de Servicios prestados (§8.5/8.6)
  sin doble registro — apagado a propósito mientras el Drive sea el oficial.
- Conciliar los clientes fuera del catálogo (el panel los muestra con "•").
