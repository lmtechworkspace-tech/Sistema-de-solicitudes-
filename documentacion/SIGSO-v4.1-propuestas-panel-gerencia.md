# SIGSO v4.1 — Propuestas para el Panel de Gerencia

> Estado: **propuesta, sin implementar**. Pendiente de que el usuario apruebe
> qué entra y qué no.

Origen: Gerencia pidió (a) ver el contenido de la solicitud en el tablero de
seguimiento y (b) más información útil para tomar decisiones.

---

## Punto de partida: qué hay hoy

**El tablero de seguimiento tiene 10 columnas**: Solicitud, Solicitante,
Responsable, Estado, Prioridad, Días abierta, Días con el desarrollador, Días
esperando, Fecha comprometida, Semáforo.

Todas son de **proceso** (quién, cuándo, cuánto se demora). **Ninguna dice de
qué se trata la solicitud.** Ese es exactamente el vacío que Gerencia detectó.

**Dato importante**: `titulo`, `tipo_nombre` y `modulo_nombre` **ya viajan** al
panel desde `Gerencia.gs` — simplemente nunca se pintaron como columna. Y
`descripcion` (¿Qué pasa?) y `resultado_esperado` (¿Qué debería pasar?) ya
existen en la hoja `SUBSOLICITUDES`. **Nada de esto requiere tocar el esquema.**

---

## G1 — Contenido de la solicitud en el tablero *(lo que pidió Gerencia)*

Agregar al tablero de seguimiento:

| Columna | Campo | Cuándo tiene dato |
|---|---|---|
| **Tipo** | `tipo_nombre` | Siempre (ya viaja, solo falta pintarlo) |
| **Módulo** | `modulo_nombre` | Siempre (ya viaja) |
| **Título** | `titulo` | Siempre (ya viaja) |
| **¿Qué pasa?** | `descripcion` | **Siempre** — es obligatorio en ambos modos |
| **¿Qué debería pasar?** | `resultado_esperado` | Solo en modo Completo |

### El problema de espacio, y cómo lo resolvería

El tablero ya se desborda con 10 columnas. Sumar 5 (dos de ellas de texto
largo) lo vuelve ilegible. Tres opciones:

- **G1-a — Fila expandible (recomendada).** Se agregan Tipo, Módulo y Título
  como columnas normales (son cortas). "¿Qué pasa?" y "¿Qué debería pasar?"
  van en una **segunda línea plegable** dentro de la misma fila: se hace clic
  en la fila y se despliega el texto completo debajo, sin romper la grilla ni
  el PDF. Nada se trunca ni se pierde.
- **G1-b — Truncado con tooltip.** Columnas nuevas de texto cortadas a ~60
  caracteres, con el texto completo al pasar el mouse. Más simple, pero en el
  PDF impreso el tooltip no existe: se imprime cortado.
- **G1-c — Selector de densidad.** Un control "Vista: Compacta / Completa" que
  muestra u oculta el bloque de contenido. Gerencia elige según si está
  revisando plazos o revisando contenido.

Mi recomendación: **G1-a + G1-c**. La fila expandible resuelve el espacio sin
perder información, y el selector deja el PDF ejecutivo limpio cuando se
quiere solo el seguimiento de plazos.

---

## Una observación honesta sobre el objetivo de fondo

Gerencia explicó *para qué* quiere esto: **saber qué tipo de solicitud se
repite más**, y si se repite un error/bug, tomar una decisión para mitigarlo.

**G1 por sí solo no responde eso.** Un texto libre en una tabla de 200 filas
no se agrega ni se cuenta: hay que leerlo fila por fila. Sirve para *entender
una solicitud puntual* (que es valioso), pero no para *detectar el patrón*.

Lo que sí responde la pregunta de Gerencia es **G2**. Sugiero aprobar los dos
juntos: G1 da el contexto al mirar una fila, G2 da la decisión.

---

## G2 — Análisis de recurrencia: "¿qué se nos repite?" *(el que responde la pregunta real)*

Una pestaña nueva junto a "Tablero de seguimiento" y "Línea de tiempo", con un
ranking de **Módulo × Tipo**:

| Módulo | Tipo | Cantidad | % del total | Tendencia vs período anterior | Días prom. resolución | Reaperturas |
|---|---|---|---|---|---|---|
| Facturación | Error / Bug | 23 | 18% | ▲ +9 | 4.2 d | 3 |
| Dashboard | Mejora | 11 | 9% | ▼ −2 | 6.0 d | 0 |

Cada fila es clicable y filtra el tablero a esas solicitudes, para leer los
"¿Qué pasa?" concretos detrás del número.

**Por qué esto es la decisión y no el dato**: "Facturación / Error×23, subiendo"
es accionable — justifica parar y arreglar la causa raíz. Ya existe algo
parecido (`Triggers.detectarPatrones` avisa por correo al superar un umbral),
pero es una alerta que llega y se pierde en la bandeja; no es una vista donde
Gerencia pueda mirar y decidir.

Datos: todos existen. Sin cambios de esquema.

---

## G3 — Tendencia en el tiempo: "¿vamos mejorando o empeorando?"

Los KPIs de arriba son una **foto**: "100% de cumplimiento" no dice si veníamos
de 60% o de 100%. Gráfico de línea (Chart.js ya está cargado en el panel) con:

- Solicitudes **creadas vs cerradas** por semana/mes → si la línea de creadas
  se despega de cerradas, la deuda está creciendo.
- **% de cumplimiento** mes a mes → si el compromiso con las fechas mejora.

Sin esto, Gerencia no puede distinguir "un mal mes" de "una tendencia".

Datos: todos existen (`fecha_creacion`, `fecha_terminada`, `fecha_comprometida`).

---

## G4 — Dónde se pierde el tiempo (tiempo de ciclo por etapa)

Hoy se sabe cuántos días lleva abierta una solicitud, pero **no en qué etapa se
va el tiempo**. Un desglose del promedio de días en cada estado:

```
Nueva → Recibida      0.4 d
Recibida → Aprobada   3.1 d   ← el cuello de botella
Aprobada → Desarrollo 0.6 d
Desarrollo → Terminada 2.2 d
Terminada → Cerrada   4.8 d   ← el solicitante no valida
```

Esto cambia la conversación: si el tiempo se va esperando aprobación, el
problema no es el desarrollador. Es probablemente el hallazgo más accionable
de toda la lista.

Datos: `HISTORIAL_ESTADOS` ya guarda cada transición con timestamp. Sin cambios
de esquema.

---

## G5 — Reaperturas / reincidencias (calidad de las entregas)

Ítems que se cerraron y volvieron a abrirse, o que el solicitante rechazó al
validar. Es la medida de **"se entregó mal"**, que hoy no se mide en ninguna
parte: el % de cumplimiento solo mira la fecha, no si la solución sirvió.

Un número alto acá significa que se está cerrando rápido pero mal — que es
justamente lo que un KPI de cumplimiento al 100% puede estar escondiendo.

Datos: `HISTORIAL_ESTADOS` (transiciones desde S09 hacia atrás). Sin cambios
de esquema.

---

## G6 — Carga por empresa / plataforma / área

Distribución de solicitudes (barras) por empresa, plataforma y área. Responde
"¿qué sistema nos consume más equipo?" — insumo directo para decidir dónde
invertir o qué migrar.

Parcialmente cubierto: hoy se puede *filtrar* por empresa, pero hay que ir uno
por uno y anotar; no hay una vista comparativa.

Datos: todos existen.

---

## G7 — Comparador de períodos en los KPIs

Cada KPI con su variación respecto del período anterior:

```
Atrasadas activas
5          ▲ +2 vs mes anterior
```

Barato de implementar y multiplica el valor de los KPIs que ya existen.

---

## G8 — Horas / esfuerzo por módulo *(NO recomendada por ahora)*

Sería lo ideal para decisiones de inversión ("Facturación nos costó 120 h este
trimestre"). El esquema **ya tiene** `estimacion_horas` y `horas_reales` en
`SUBSOLICITUDES`, y el detalle los muestra si existen.

**Pero no hay ninguna pantalla donde cargarlos.** Nadie los llena, así que hoy
están vacíos en el 100% de los registros. Implementar el reporte primero daría
un panel lleno de ceros.

Si interesa, el orden correcto es: (1) agregar el campo en el detalle para que
Leo cargue las horas al cerrar, (2) esperar unas semanas de datos, (3) recién
ahí el reporte. Lo dejo señalado, no lo propongo para ahora.

---

## Resumen para decidir

| # | Propuesta | Responde | Esfuerzo | Datos listos |
|---|---|---|---|---|
| **G1** | Contenido en el tablero | "¿De qué trata esta solicitud?" | Bajo | ✅ |
| **G2** | Análisis de recurrencia | **"¿Qué se nos repite?"** | Medio | ✅ |
| **G3** | Tendencia temporal | "¿Mejoramos o empeoramos?" | Medio | ✅ |
| **G4** | Tiempo de ciclo por etapa | "¿Dónde se pierde el tiempo?" | Medio | ✅ |
| **G5** | Reaperturas | "¿Entregamos bien?" | Bajo | ✅ |
| **G6** | Carga por empresa/plataforma | "¿Qué sistema consume más?" | Bajo | ✅ |
| **G7** | Comparador de períodos | "¿Comparado con antes?" | Bajo | ✅ |
| G8 | Horas por módulo | "¿Cuánto nos costó?" | Alto | ❌ (nadie los carga) |

**Mi recomendación si hay que elegir**: **G1 + G2** primero (juntos responden
completo lo que Gerencia pidió), después **G4** (el hallazgo más accionable) y
**G7** (barato, mejora lo que ya existe).

Ninguna de las 7 primeras requiere tocar el esquema ni pedirle nada nuevo a
quien ingresa solicitudes.
