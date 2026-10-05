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

### Etapa 3: piloto "Enviar a SIGSO" (asistido en el navegador, 2026-10-01)

Por qué este camino (decisión del dueño): BaseAPI, el proveedor que se iba a
probar, **cierra el 11-12-2026** y ya no da cuentas gratis; Boufin no cubre TGR;
Smartbot es a medida y por cotización; y la TGR rechaza accesos automatizados
(403) y pide clave tributaria o ClaveÚnica de cada cliente. Un robot propio
obligaría a custodiar esas claves. El asistido cuesta $0 y SIGSO no guarda claves.

Cómo funciona:
1. Seguimiento de cuotas TGR › **Recibir desde la TGR** (`conv:tgr`) muestra el
   marcador **Enviar a SIGSO** para arrastrar a la barra de marcadores (una vez
   por computador; el código se arma con la dirección de SIGSO).
2. Francisca entra a la TGR con su sesión, abre *Imprimir cuotas de convenios
   vigentes* y toca el marcador. El marcador lee el texto de la página (o lo
   seleccionado), abre o reutiliza la pestaña `sigso_tgr` de SIGSO y se lo manda
   con `postMessage`; reintenta cada medio segundo hasta que SIGSO responde.
3. SIGSO acepta solo mensajes de `*.tgr.cl`, `*.tesoreria.cl` y `tgr.gob.cl` por
   https (en local, también localhost). Separa la página por folio
   (`bloquesTGR_`), reconoce al cliente por el RUT de la página y muestra por
   folio qué cambia (o que no está en el seguimiento, para crearlo).
4. **Aplicar** (`recibirTGR`) actualiza los convenios que existen —conservando
   lo marcado a mano— y crea los nuevos. El texto de la página no se guarda.

Respaldo sin marcador: Ctrl+A y Ctrl+C en la página de la TGR y pegar en la
misma vista (lee varios convenios de una vez).

**Primera prueba real (2-10-2026)**, en web.tesoreria.cl › Imprimir Cuotas de
Convenios Vigentes: el marcador llegó a SIGSO, pero (1) la tabla está en un
recuadro (iframe) de www.tesoreria.cl que el navegador no deja leer desde afuera,
y (2) la página no muestra folio ni RUT, solo Cuota · Vencimiento · Monto ·
Pagada. Ajustes: el marcador ahora ofrece abrir ese recuadro solo en la pestaña
(y se toca de nuevo), y en Recibir desde la TGR se elige **"¿De qué convenio son
estas cuotas?"** cuando la página no trae folio (`asignar` en `recibirTGR`).
Ojo: la página "Cuotas Vigentes" del Centro de Pagos (N° de Resolución, N° de
Cuota, N° de Folio por cuota) NO sirve: solo lista lo impago y sin SÍ/NO.

Probado con una página de prueba local que imita la de la TGR (dos folios):
reconoció al cliente por el RUT, detectó las cuotas pagadas nuevas, creó el folio
que faltaba y no repitió el envío. Falta la prueba en la TGR real (la hace el
equipo): confirmar que el navegador permite el marcador en ese sitio y que la
página trae el folio en el texto. Si la página no trae el folio, el convenio se
actualiza desde su ficha con "Pegar desde la TGR".

### Robot TGR semiautomático (2026-10-02)

Opción 2 del dueño, como paso previo a un robot completo: en **Recibir desde la
TGR** › tarjeta **Robot TGR**, la persona elige el cliente, escribe su RUT y su
Clave Tributaria y toca "Revisar en la TGR". En el servidor, `robotTgr.js`
(Chromium con puppeteer-core, el mismo motor de los PDF) entra a tgr.cl › Imprimir
cuotas de convenios vigentes → autentica.tgr.cl (Clave Tributaria) → formulario
del SII → recorre las resoluciones del recuadro y lee las cuotas. Las cuotas pasan
por la misma revisión (asignar la primera vez → queda `resolucion` en el
convenio → la próxima vez se reconoce sola) y se aplican con historial "Revisado
por el robot TGR".

| Regla | Cómo |
|---|---|
| La clave no se guarda | Viaja una vez en la petición, se escribe en el formulario y se suelta; no va a la base, al trabajo, al historial ni a logs (el servidor no registra cuerpos de petición) |
| Un intento de ingreso | Si el SII no acepta, se detiene (`CLAVE_INVALIDA`) |
| No se salta controles | Se detiene ante verificación por correo (`DESAFIO`), cambio de clave (`CAMBIO_CLAVE`), CAPTCHA o 403/429 (`BLOQUEADO`); no se disfraza de persona |
| Un robot a la vez | Para todo SIGSO; el trabajo vive 30 min en memoria (`controlInternoRobot.js`) |
| Quién | Registra de Contabilidad; ve el avance quien lo inició (o ADM); constancia en CI_HISTORIAL `ROBOT_TGR` (cliente, RUT, resultado) |
| Diagnóstico | Al detenerse devuelve una captura y la dirección donde quedó, solo a quien lo inició |

Lo que depende de la página está en `RECETA` (robotTgr.js). Probado de punta a
punta contra un sitio local que imita TGR + SII (test con navegador real; se salta
en CI). Falta la primera prueba con la TGR real: la página después del ingreso no
se pudo ver; si se detiene con `PAGINA_DISTINTA`, la captura dice qué ajustar.
Riesgo conocido: la TGR podría rechazar accesos desde el servidor (ya respondió 403
a una consulta automática); en ese caso habría que correrlo desde un equipo de la
oficina.

#### El robot corre en un PC de la oficina (2026-10-02)

Primera prueba real desde el servidor: `www.tgr.cl` respondió "la página no
existe" y `web.tesoreria.cl` **403 Access Denied** (protección de la TGR contra
conexiones de centros de datos). El robot se detuvo antes de ingresar. Solución
elegida por el dueño, con su PC como piloto: un **agente** en un equipo de la
oficina (`backend/herramientas/robot-oficina/agente.js`, ver su LEEME).

- El agente consulta a SIGSO (`robotAgenteTomar`, espera hasta 20 s; ningún
  puerto abierto en el PC), recibe RUT + clave en memoria, corre `robotTgr.js`
  con la conexión de la oficina y entrega (`robotAgentePaso`,
  `robotAgenteEntregar`). Lo entregado se valida (cuotas con forma conocida).
- Se identifica con su llave (`sgr_…`), creada por un ADM en Recibir desde la TGR
  › Robot de la oficina; en `CI_ROBOT_AGENTES` queda solo su hash (SHA-256). Se
  puede dar de baja.
- Sin agente conectado (sin señal en 45 s) la revisión no se inicia y se dice; si
  nadie la toma en 25 s se cancela; si no se entrega en 5 min, se da por perdida.
- La clave espera en memoria del servidor solo hasta que el agente la toma y se
  borra; en el PC no se escribe en disco ni en consola. Opción `--ventana` para
  ver el navegador en el piloto. Probado de punta a punta en local (servidor +
  TGR falsa + agente real).

### Lo mismo para el SII: F29 y Registro de Compras y Ventas (2026-10-01)

Un solo marcador **Enviar a SIGSO** sirve para la TGR y el SII: abre (o reutiliza)
la pestaña `sigso_envio` en `#/control_interno/recibir`, y el núcleo
(`control-interno-v2.js`) decide por el sitio de origen si va a **Recibir desde
la TGR** (`conv:tgr`) o a **Recibir desde el SII** (`sii`, en el menú bajo
*Informe y pago de IVA*). Orígenes aceptados: https `*.tgr.cl`, `*.tesoreria.cl`,
`tgr.gob.cl` y `*.sii.cl`.

| Llega | Se lee | Se compara con | Qué se aplica (solo lo marcado) |
|---|---|---|---|
| Página del F29 (marcador o pegado) | Códigos 538, 537, 89, 77, 48, 151, 563, 115, 62, 91, 94; RUT; período; folio; fecha de presentación | Informe y pago de IVA (fila del cliente y mes) | Monto pago ← 91, tasa ← 115, ventas (base PPM) ← 563, monto PPM ← 62, retención honorarios ← 151, impuesto único ← 48, fecha declaración ← fecha de presentación. Débitos, créditos, IVA determinado y el pre-IVA de la matriz se muestran para comparar. Si no hay fila, se crea |
| CSV "Descargar detalles" de **ventas** (.csv o .gz; RUT y mes del nombre del archivo) | Cada documento: tipo, folio, fecha, RUT y razón social del cliente, montos | Facturación (mismo cliente y mes), por folio y tipo | Agregar los folios que faltan, con tipo (33 → FE, 61 → NC…), mandante, RUT, neto y total; se avisan montos distintos y folios que están en la matriz y no en el SII |
| CSV de **compras** | Ídem, con IVA recuperable y fecha de acuse | Acuse de recibo | Cantidad e IVA de facturas; cantidad e IVA de notas de crédito; se informa cuántos documentos no tienen fecha de acuse |
| Resumen del RCV (la página) | Una línea por tipo de documento | Facturación o Acuse | Solo comparación (totales); para aplicar, el CSV |

El servidor vuelve a leer todo al aplicar (nunca usa valores de la pantalla) y
deja en el historial de la fila qué se trajo del SII. Si la página no trae RUT o
mes, se eligen en la pantalla. Archivos: `backend/logica/controlInternoSII.js`,
`frontend/js/control-interno-sii-v2.js`, tests `control-interno-sii.test.js`.

Probado con páginas y archivos de prueba locales (F29, CSV de ventas en Latin-1
como lo exporta el SII, flujo de la TGR con el marcador común). Falta la prueba
con el SII real: confirmar que el texto del F29 trae los códigos junto a sus
valores (si la página los muestra en otra disposición, se ajusta el lector).

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

## Departamentos del organigrama (2026-10-03)

Pedido del dueño: dividir "Control interno" por área y darle a cada área solo
lo suyo, con un fin de **reportabilidad**: cada departamento genera su reporte,
lo valida su jefatura y la jefatura lo entrega a la Encargada de
Administración. Base: organigramas DOC-05 (servicios a clientes) y DOC-09.

**Menú.** El módulo "Control interno" desaparece. En su lugar, el grupo
**Departamentos** con un módulo por área: Contabilidad (`dep_contabilidad`),
Recursos Humanos (`dep_rrhh`), Prevención de riesgos (`dep_prevencion`),
Marketing corporativo (`dep_marketing`) y Administración
(`dep_administracion`). Todos tienen las mismas secciones, en el mismo orden:
Resumen del mes · Reporte mensual · el trabajo del área (sus matrices) · Mi
equipo (solo jefatura) · Reportes · Accesos (solo ADM). Administración tiene
"Reportes de las áreas".

**Quién ve qué.** Lo decide la lista de cada área (`CI_MIEMBROS`), no la
cuenta: JEFATURA (registra y valida el reporte), REGISTRA o LECTURA. La sesión
trae `cuenta.departamentos` (los dep_* que ve) y `cuenta.jefatura_de`. Ver
todas las áreas sin estar en sus listas: ADM, o Gerencia / Encargado del SGC
con el módulo `control_interno` (en Cuentas se llama "Departamentos: ver todas
las áreas"). El enlace antiguo `#/control_interno/...` (y el marcador "Enviar a
SIGSO" ya instalado) abre Contabilidad.

**Reporte mensual** (`departamentosReportes.js`, tabla `DEP_REPORTES`):
BORRADOR → EN_REVISION (jefatura) → VALIDADO (por recibir) → RECIBIDO; la
jefatura o Administración pueden devolverlo (OBSERVADO) con una observación
obligatoria. Uno MENSUAL por área y mes, más los EXTRAORDINARIOS que hagan
falta. Si lo envía la jefatura (p. ej. Marketing, una sola persona) queda
validado al enviarlo. Sin jefatura asignada no se puede enviar. Plantilla común
(resumen, actividades, indicadores, dificultades, pendientes, respaldos) + lo
que SIGSO ya sabe del mes (matrices, tareas, solicitudes del equipo), que se
congela al enviarlo. Avisos en SIGSO y por correo en cada paso; contador en el
menú de lo que espera a cada persona. Las claves escritas se reemplazan por
"[clave omitida]".

**Mi equipo.** La jefatura de un área tiene a cargo a quienes REGISTRAN en su
lista (`jefatura.obtenerEquipoJefe_` suma esto a Administración › Jefaturas;
`jefeDeSubordinado_` también lo usa). Por eso "Mi equipo", reasignar tareas y
aprobar novedades siguen al organigrama. El panel de "Mi departamento" se pinta
dentro de cada área (`SigsoJefatura.hospedar`); el módulo suelto solo lo ve
una jefatura sin área.

**Pendiente del dueño en producción:** cargar las listas de cada área en
Accesos (quién es jefatura, quién registra) y la de Administración (la
Encargada de Administración registra; Gerencia/Director en solo lectura).

## Reportabilidad: indicadores, informe de gestión y cadena (2026-10-03)

Propuesta aprobada por el dueño (artefacto «Reportabilidad HomePymes»): que
cada reporte sirva para decidir, que se arme solo con los datos y que
gerencia vea primero lo malo.

**1. Limpieza del dato al arrancar** (`calidadDatos.js`, corre en
`server/index.js`, idempotente):
- Montos y RUT que Excel entregó en notación científica («1.3256668E7»)
  pasan a número (montos) o a dígitos (RUT, N° de contrato). El importador
  (`controlInternoPlanillas.numero_`/`valor_`) ya los lee bien.
- Feriados de Chile 2024–2027 en `CONFIG_FERIADOS` (estaba vacía). Revisar la
  lista cada diciembre (`FERIADOS_CHILE`).

**2. Motor de indicadores** (`indicadoresDepto.js`): por área y mes calcula
indicadores con meta, estado, serie de 12 meses, comparación (mes anterior,
promedio 12 meses, hace un año) y una explicación escrita con reglas fijas;
alertas con qué pasa / por qué / impacto / decisión sugerida, ordenadas de lo
crítico a lo menor; tablas de detalle; y calidad del dato (matrices sin
actualizar o con pendientes antiguos).
- Contabilidad: F29 a tiempo (vencimiento hábil del día 20), F29 al límite,
  sin registro, reincidentes, IVA a pagar, avance contable (alerta si empeora
  3 meses seguidos), atraso acumulado, facturación, concentración en 5
  clientes, convenios con cuotas vencidas, notificaciones del SII abiertas.
- RR.HH.: liquidaciones, cotizaciones a tiempo e intereses (hoy «sin dato»:
  esas columnas no se llenan), RLE pendiente fuera de plazo, salidas por cada
  entrada, causales, anexos pendientes, certificados, licencias.
- Transversal: clientes atendidos (altas, bajas, hace un año), dependencia de
  una persona (cuenta también los nombres de la planilla).
- Facturación y Cobranzas: cartera vencida (crítica si hay deuda de más de 90
  días), cobrado y facturado del mes, días de cobro.
- `ejecutivo_`: el semáforo de las áreas, todas las alertas, 6–7 indicadores
  de gerencia y lo que va bien.

**3. Reporte del área**: en Contabilidad y RR.HH. trae el bloque completo de
indicadores (congelado al enviarlo); el texto del área pasa a ser un
comentario opcional. Prevención y Marketing siguen con la plantilla (resumen
obligatorio).

**4. Informe de gestión** (`informesGestion.js`, tabla `DEP_INFORMES`, módulo
Administración › Informe de gestión): Administración lo envía (avisa qué áreas
faltan) → Finanzas y Cobranzas aprueban las dos → el Analista de Control deja
su conclusión y propone decisiones (vienen sugeridas desde las alertas) →
Gerencia acuerda o descarta y cierra. Cada paso devuelve con observación y
deja un comentario opcional. Plazos: días hábiles 3, 5, 6, 8, 9 y 10 del mes
siguiente; un paso atrasado se marca en rojo. Al enviarlo a Finanzas se
congela el snapshot. Quién ocupa cada paso: `DEP_CADENA` (Administración ›
Cadena de reportes, solo ADM); Administración = la lista de su departamento.
Quien está en la cadena ve el módulo Administración.

**5. Facturación y Cobranzas**: departamento nuevo (`dep_cobranzas`, sin
reporte mensual propio) con la matriz «Cobranza de honorarios»: una fila por
factura de HomePymes; la situación (por cobrar, abonada, pagada, anulada) sale
de los montos y lo vencido se calcula al leer.

**Pendiente del dueño en producción:** cargar la cadena (Finanzas: Gte. Adm. y
Finanzas; Cobranzas: Enc. Facturación y Cobranzas; Control: Analista de
Control; Gerencia: Director), las listas de cada área (incluida Facturación y
Cobranzas) y empezar a registrar las facturas en la matriz de cobranza.

## Agenda de los departamentos (2026-10-04)

Propuesta aprobada por el dueño (artefacto «Agenda de departamentos»): fechas
clave, recordatorios a clientes con escalamiento y registro de cada aviso.
Decisiones: SIGSO **no envía** nada (costo cero): prepara el mensaje; WhatsApp
se abre con el texto listo (`wa.me`, gratis) y el correo se copia y sale desde
el correo corporativo del área. Todo queda registrado.

**Menú de cada área (las mismas seis entradas):** Hoy · Agenda (Calendario,
Recordatorios enviados, Por cliente) · Trabajo (las 5 matrices más usadas en
12 meses + convenios/SII + «Todo el trabajo») · Reportes · Equipo (jefatura) ·
Ajustes (Recordatorios y fechas; Accesos para ADM). «Todo el trabajo» agrupa
las matrices por cómo se trabajan: Proceso mensual, Por solicitud, Consulta y
Archivo (sin filas en 12 meses o sin uso, cerrado). Administración suma
«Agenda general» (todas las áreas). `getControlInterno` devuelve `uso`
(filas por matriz en 12 meses).

**Obligaciones** (`DEP_OBLIGACIONES`, propuesta inicial en
`agendaPropuesta.js`, sacada de DOC-10 a 13 y de las matrices): qué vence,
la regla de la fecha (mensual/anual con día hábil, o «evento» = cada caso trae
su fecha), la escalera de recordatorios (escalones en días hábiles respecto
al vencimiento, canal, a quién y el mensaje con variables {contacto}
{empresa} {periodo} {monto} {fecha_limite} {dias}…), y qué pasa si no se
recuerda o el cliente no responde. A quién recordar sale de las matrices
(fuentes): IVA por pagar, cuotas de convenio impagas, asistencia sin recibir,
Previred, facturas por cobrar, clientes con contabilidad (Renta); las fechas
manuales (examen ocupacional, pacto de horas extra) y las propias del área
van en `DEP_EVENTOS`. Un cliente sale de la lista cuando la matriz lo da por
cumplido o cuando se registra «Ya cumplió» / «No corresponde».

**Registro** (`DEP_RECORDATORIOS`): cada envío (canal, destino, mensaje
final, quién, cuándo) y cada respuesta (Confirmó, Ya cumplió, Pidió plazo,
No contesta, No corresponde). Deshacer: quien lo registró o la jefatura.

**Editar:** la jefatura del área, ADM o el superusuario (`ajustesAgenda`,
`guardarObligacionAgenda`, `restaurarObligacionAgenda`); historial en
`CI_HISTORIAL`. Una obligación nueva solo puede ser tarea interna o fecha
manual (las fuentes de matrices son las de la propuesta).

**Alertas:** número de «Hoy» en el menú (recordatorios de hoy + atrasados,
rojo si hay atrasados); aviso llamativo al entrar, una vez al día; franja
con cuenta regresiva del próximo vencimiento (roja a 3 días hábiles o menos);
a las 08:00 de cada día hábil, notificación en SIGSO a quien registra en el
área y, a la jefatura, los atrasados y los clientes sin respuesta.

**Reportes:** desde octubre de 2026 el área mide «Recordatorios enviados a
tiempo» y «Clientes que no respondieron»; en el F29 atrasado se indica si el
cliente tuvo recordatorio antes del vencimiento (atraso del cliente) o no
(atraso interno).
