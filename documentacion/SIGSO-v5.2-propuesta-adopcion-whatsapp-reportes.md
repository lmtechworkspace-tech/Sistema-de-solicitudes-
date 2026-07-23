# SIGSO v5.2 — Propuesta de adopción: "el sistema funciona, ahora hay que hacer que lo usen"

> Estrategia y diseño para pasar la **barrera humana**: usuarios clave (Leo,
> desarrollador; y Gerencia) que se resisten a entrar a la plataforma. La
> parte operativa ya está resuelta (v1.0 → v5.1). Este documento ataca la
> adopción. **No incluye código** — es la propuesta para decidir qué construir
> y en qué orden.

---

## 0. El problema real (no es técnico, es humano)

El sistema hace todo lo que tiene que hacer: recibe solicitudes, deriva,
compromete fechas, mide cumplimiento, avisa. Pero **una herramienta que nadie
abre no resuelve nada**. Y hoy hay dos personas que no la van a abrir por su
cuenta:

| Persona | Rol frente al sistema | Por qué se resiste | Qué necesita en realidad |
|---|---|---|---|
| **Leo** (desarrollador) | El que **hace** el trabajo | Le sobra pega, "otra plataforma más", fricción de login | Que le **llegue** el trabajo claro y no perderlo — sin sentir que "usa un sistema" |
| **Gerencia** | El que **lee** el estado | Persona mayor, no navega dashboards por más que existan | Un **vistazo** del estado, simple, que le llegue solo |

Los dos comparten la misma raíz: **quieren interactuar lo menos posible con la
plataforma**. Uno produce (resuelve solicitudes), el otro consume (mira el
estado). La solución **no es un mejor dashboard** — es dejar de exigirles que
entren, y llevarles el valor a donde ya están (WhatsApp, PDF, correo).

El objetivo tiene dos capas que no hay que confundir:

1. **Que las solicitudes no queden sin resolver.** Esto es innegociable y
   **ya se puede lograr hoy** aunque Leo nunca entre: el admin filtra, asigna,
   fecha y le pasa el trabajo. La responsabilidad queda registrada.
2. **Que, poco a poco, Leo y Gerencia se sumen a la plataforma.** Esto es
   gradual y es donde vive esta propuesta.

---

## 1. Cómo lo resolvieron sistemas parecidos (y qué copiar)

No hay que inventar: este es un problema conocido de adopción de software
B2B. El patrón que gana, una y otra vez, es el mismo.

### 1.1 La distinción clave: "sistema de registro" vs. "sistema de interacción"

- **Sistema de registro** (system of record): dónde vive la verdad —
  solicitudes, estados, fechas, cumplimiento. **Eso es SIGSO.**
- **Sistema de interacción** (system of engagement): dónde el usuario
  realmente da y recibe el trabajo. Para un usuario reacio, **no es la
  plataforma** — es su WhatsApp, su correo, un PDF.

La jugada ganadora es **desacoplar "hacer/leer el trabajo" de "usar el
software"**: el software lleva el registro y la responsabilidad en silencio,
mientras el usuario interactúa donde ya está cómodo. Después, se lo va
acercando a la plataforma un escalón a la vez.

### 1.2 Qué hicieron los referentes

| Sistema | El reacio | Cómo lo resolvieron |
|---|---|---|
| **Jira / Linear / Asana** | Devs que "no quieren otra herramienta" | Notificación por correo/Slack con **botones de acción**; "responder por correo" crea un comentario; **digest** diario. El dev casi no abre la app. |
| **Zendesk / Freshdesk / Intercom** | Agentes que odian el panel | Trabajan el ticket **desde el correo**; a los jefes les llega un **reporte programado** automático (sin login). |
| **Field service** (Jobber, ServiceTitan, ServiceNow FSM) | Técnicos en terreno | **Orden de trabajo** imprimible/móvil: el técnico no necesita la app, solo su "hoja de pega" con todo para ejecutar. |
| **Ops por WhatsApp** (PYMEs LatAm) | Todos | El registro vive atrás (planilla/CRM); la interfaz del reacio es **WhatsApp**, muchas veces con un **mini-portal por enlace** sin contraseña. |
| **CRMs para gerentes** (Pipedrive, HubSpot) | Ejecutivos que no entran | **Enlace de reporte sin login** + **resumen semanal por correo** que llega solo. |

**La lección unificada:** al usuario reacio **llévale el valor (push), no le
pidas que venga a buscarlo (pull)**. Y baja el costo de entrada a casi cero
(sin contraseñas para el primer contacto). SIGSO ya tiene media estrategia
montada (resumen WhatsApp al crear, reportes programados por correo,
impresión del panel de Gerencia); falta ordenarla como **estrategia de
adopción** y llevarla al caso de Leo y Gerencia.

---

## 2. Principio de diseño: la **escalera de adopción**

En vez de "entrar o no entrar" (un salto que el reacio no da), se define una
**escalera**: cada peldaño reduce fricción y acerca al usuario a la
plataforma. Nunca se le fuerza el salto; se sube de a un peldaño.

```
  Nivel 3  ── Entra al sistema completo (su bandeja / su panel)
     ▲
  Nivel 2  ── Actúa desde un enlace sin login (marca "listo", mueve fecha)
     ▲
  Nivel 1  ── Recibe un enlace de "solo lo suyo", sin login, solo lectura
     ▲
  Nivel 0  ── Recibe PDF por WhatsApp/correo; el admin hace todo por él
```

Reglas de la escalera:

- **En TODOS los niveles la responsabilidad queda registrada.** Aunque Leo esté
  en Nivel 0 y nunca entre, el sistema sabe qué se le asignó, con qué fecha
  comprometida, y si cumplió. **Ninguna solicitud se pierde.**
- **Cada peldaño le quita una tarea al admin** (que hoy es el puente). El admin
  no debe ser cuello de botella permanente: la escalera lo va liberando.
- **Push en Nivel 0-1, pull opcional en Nivel 2-3.** Al principio todo le
  llega; después, si quiere más, entra.
- Leo sube la escalera **produciendo**; Gerencia la sube **consumiendo**. Misma
  mecánica, distinto sentido.

---

## 3. Para Leo (el que hace) — Orden de Trabajo + escalera

### 3.1 Pieza central: la **Orden de Trabajo (OT)** descargable en PDF

Un **PDF de una página por solicitud**, pensado para enviarse por WhatsApp:
vertical, legible en celular, con **todo lo que Leo necesita para ejecutar sin
entrar al sistema**. Es su "hoja de pega".

Contenido (jerarquizado para leerse en 15 segundos):

1. **N° de solicitud grande** (`SOL-2026-...`) — es el ID de la conversación:
   Leo responde citándolo.
2. **Prioridad** con color/semáforo + **fecha comprometida destacada** (es *su*
   compromiso, no un dato más).
3. **Qué se pide**: título + descripción por ítem. Si hay varios ítems, uno por
   bloque.
4. **Contexto para ejecutar**: empresa/cliente, sistema/módulo, accesos/URLs,
   nombre y contacto del solicitante.
5. **Cómo cerrarla** (pie): *"Cuando esté listo: responde 'LISTO SOL-XXXX' por
   WhatsApp, o marca terminada en [enlace]"*. Esto es el gancho hacia el Nivel
   1-2.

Reutiliza **datos que ya existen** (`getDetalle`) y la **infraestructura de
impresión/PDF ya montada** (media print del panel de Gerencia, v5.0 F4). No es
un desarrollo desde cero: es una plantilla de impresión nueva sobre el detalle.

> **Formato:** el PDF debe verse como una **orden de trabajo profesional**, no
> como un volcado de la pantalla. Encabezado con la marca, tipografía legible
> en celular, una columna, sin tablas anchas. Ver §3 del rediseño v5.0 para el
> estilo.

### 3.2 El admin como filtro (Nivel 0, se puede hacer YA)

Flujo hoy, sin que Leo toque nada:

1. Entra la solicitud → **el admin la analiza** (filtra ruido, aclara si falta
   algo).
2. **Asigna a Leo** (`desarrollador_asignado`, ya existe).
3. **Fija la fecha comprometida** (acordada en la sesión con Leo, ver §5).
4. **Descarga la OT** y la manda por WhatsApp.
5. Leo trabaja; responde *"listo SOL-XXXX"*; **el admin marca terminada**.

Resultado: Leo recibe trabajo claro, el sistema tiene el registro y el
cumplimiento, **y ninguna solicitud queda huérfana** — aunque Leo siga sin
entrar. Este es el piso que garantiza el punto innegociable (§0.1).

### 3.3 Subir la escalera (poco a poco)

- **Nivel 1 — "Mi pauta" por enlace mágico.** Leo recibe por WhatsApp un
  **enlace con token, sin contraseña**, a **una sola pantalla**: *solo su lista
  de pendientes*, solo lectura. No se siente "el sistema", se siente "tu lista
  de trabajo". Cero fricción, cero login. El admin deja de tener que mandarle
  cada OT suelta.
- **Nivel 2 — actuar desde el mismo enlace.** En esa pantalla, Leo puede
  **marcar "Listo" de un tap** (y opcionalmente mover/confirmar fecha). Sigue
  sin login, sigue siendo "su lista", pero **ya escribe en el sistema**. El
  admin deja de tener que marcar terminada por él.
- **Nivel 3 — su bandeja completa.** Para cuando llega acá, ya está
  acostumbrado a que el sistema le entrega su trabajo; entrar es el paso
  natural, no una imposición.

Cada peldaño **le quita una tarea al admin** con fricción casi nula para Leo.

### 3.4 Pauta de trabajo por lote (alineada con "cada 2 días")

En vez de N mensajes sueltos, el admin genera **UN PDF con TODAS las
pendientes de Leo** para el periodo — una hoja de ruta que Leo tiene en el
celular. Convierte el goteo de solicitudes en una **rutina** ("esta es tu pega
de los próximos 2 días"), que es exactamente el ritmo que Gerencia quiere
imponer.

---

## 4. Para Gerencia (el que lee) — Reporte ejecutivo que llega solo

### 4.1 Pieza central: el **Reporte Ejecutivo** (1 página, para no-técnicos)

**NO es el tablero denso.** Es un vistazo. Pensado para leerse en 30 segundos
en el celular, por una persona que no navega paneles:

- **Números grandes**: abiertas, fuera de plazo, **% de cumplimiento** con
  **flecha de tendencia** vs. periodo anterior.
- **Semáforo** simple (verde/ámbar/rojo) del estado general.
- **"Lo que necesita tu atención"**: 3-5 líneas, en lenguaje llano, sin jerga.
- Nada de gráficos densos ni tablas de 10 columnas. Básico a propósito —
  lo importante es que se entienda de un vistazo.

Reutiliza **`Dashboard.getData`** (los KPIs ya calculados) y el motor de
**reportes programados** (`enviarReporteProgramado_`) que ya existe. Es
mayormente una **plantilla nueva** sobre datos existentes.

### 4.2 Que llegue SOLO, no que Gerencia lo busque (el punto clave)

Gerencia no va a ir a buscar el reporte. **El reporte va a Gerencia.**

- **Envío programado** (ya hay trigger semanal/mensual): el reporte se genera y
  se **envía por correo/WhatsApp** cada lunes (o la cadencia que definan). Cero
  login, cero esfuerzo de su parte.
- **Botón "Enviar a Gerencia ahora"** para el admin: envío puntual on-demand,
  además del programado (ej. después de una semana intensa).

### 4.3 Escalera para Gerencia (consumo, no producción)

- **Nivel 0:** recibe el PDF por WhatsApp/correo, no entra nunca. **Suficiente
  para que esté informado.**
- **Nivel 1:** el correo/WhatsApp trae un **enlace de solo lectura** al reporte
  web (sin login). Si un día quiere ver un poco más, un tap.
- **Nivel 2:** si se anima, entra al panel completo. **Nunca obligatorio.**

Para Gerencia, incluso quedarse para siempre en Nivel 0 es un éxito: está
informado sin fricción, que es justo lo que pidió.

---

## 5. Estrategia de fechas (las sesiones con Leo)

La idea de "reunirme con Leo cada 2 días para definir fechas" es buena; hay
que **convertirla en compromisos registrados y medibles**, sin que Leo toque
el sistema.

- **"Sesión de planificación"** en el admin: una pantalla donde, en una sola
  sentada (la reunión), el admin **asigna fechas comprometidas a un lote** de
  ítems de Leo. Reutiliza `comprometerFecha`.
- **Sugerencia automática de fechas**: dado el ritmo "cada 2 días", el sistema
  **propone fechas escalonadas** (P1 primero, luego P2, espaciadas según carga)
  que el admin ajusta. Formaliza la cadencia sin fricción.
- Beneficio de gestión: lo que hoy es una conversación informal pasa a ser
  **cumplimiento medible** — el panel de Gerencia (que ya existe) muestra si
  Leo va cumpliendo las fechas que se acordaron.

---

## 6. Principios transversales (la meta-estrategia)

1. **Desacoplar "hacer el trabajo" de "usar el software".** El trabajo se hace
   donde el reacio ya está; el software lleva el registro y la responsabilidad
   en silencio.
2. **Push, no pull.** Llevar el valor al usuario (PDF/WhatsApp/correo), no
   pedirle que venga.
3. **Escalera, no salto.** Cada peldaño baja fricción; nunca forzar el login de
   golpe.
4. **Costo de entrada ≈ 0.** Enlaces mágicos sin contraseña para el primer
   contacto.
5. **Responsabilidad sin obligar.** El sistema registra todo; quién, cuándo,
   cumplió/no cumplió es visible. Las solicitudes no se pierden aunque el
   usuario no entre.
6. **El admin es un puente temporal, no permanente.** El objetivo es que deje
   de ser intermediario a medida que Leo sube la escalera. **Riesgo a vigilar:**
   que el atajo por WhatsApp se vuelva permanente y **vacíe el sistema**.
   Mitigación: la escalera + medir la adopción (§8).

---

## 7. Roadmap priorizado (qué construir y en qué orden)

Ordenado por **impacto/esfuerzo**. Cada fase habilita un peldaño de la escalera
y se apoya en lo que ya existe.

| Fase | Qué | Habilita | Reutiliza | Esfuerzo |
|---|---|---|---|---|
| **A** | **OT PDF por solicitud** + **Reporte ejecutivo PDF** + botón "Enviar a Gerencia ahora" | Leo y Gerencia en **Nivel 0** de inmediato | `getDetalle`, `Dashboard.getData`, impresión v5.0 F4 | Medio-bajo |
| **B** | **Envío programado** del reporte ejecutivo a Gerencia + **Pauta de trabajo por lote** de Leo | Gerencia recibe solo; Leo con rutina | trigger semanal/mensual, `enviarReporteProgramado_` | Bajo |
| **C** | **Enlaces mágicos** de solo lectura: "Mi pauta" (Leo) y "Reporte" (Gerencia) | **Nivel 1** de ambos | tokens de sesión (ya hay infra de tokens del portal) | Medio |
| **D** | **Acciones desde el enlace** (Leo marca "listo"/mueve fecha) + **Sesión de planificación de fechas** | **Nivel 2** de Leo | `comprometerFecha`, máquina de estados | Medio |

**Recomendación:** empezar por **Fase A**. Es lo de mayor impacto inmediato
(desbloquea el flujo Leo-por-WhatsApp y el reporte para Gerencia HOY),
reutiliza casi todo, y no toca la base de datos ni los permisos. Las fases
siguientes se evalúan según cómo responda la adopción real.

---

## 8. Cómo medir si funciona (para no quedarnos en el atajo)

Para saber si la escalera está subiendo (y no si WhatsApp se volvió un
callejón sin salida), medir mes a mes:

- **% de solicitudes de Leo cerradas dentro de la fecha comprometida**
  (cumplimiento — ya lo mide Gerencia).
- **Cuántas acciones hace Leo directamente en el sistema** (Nivel 1→2→3):
  arranca en 0; si sube, la adopción avanza.
- **Solicitudes huérfanas** (asignadas y sin movimiento > X días): debe
  tender a 0 desde la Fase A, aunque Leo no entre.
- **Cuántos reportes abre Gerencia por enlace** (Nivel 0→1): opcional; su
  éxito principal es "estar informado", no "entrar".

---

## 9. Lo que esta propuesta deliberadamente NO hace

- **No reemplaza el sistema por WhatsApp.** WhatsApp/PDF son un **puente**, no
  el destino. El registro y la responsabilidad siguen en SIGSO.
- **No construye más dashboards para Gerencia.** El problema no es que falte
  información; es que no la va a ir a buscar. Se le lleva, simple.
- **No sobrecarga el PDF.** Una página, lo esencial. Un PDF de 4 páginas no lo
  lee nadie por WhatsApp.
- **No fuerza a Leo a entrar.** Se lo acerca. La responsabilidad se garantiza
  por diseño (registro + fecha comprometida + cumplimiento), no por obligarlo
  a loguearse.

---

## 10. Decisiones que necesito de ti

1. **¿Arrancamos por la Fase A (OT PDF + Reporte ejecutivo PDF)?** Es lo de
   mayor impacto inmediato y menor riesgo.
2. **Contenido de la OT de Leo:** ¿el listado de arriba (§3.1) cubre lo que
   necesita para ejecutar, o falta/sobra algo?
3. **Reporte ejecutivo de Gerencia:** ¿confirmas que va "básico y de un
   vistazo" (números grandes + semáforo + 3-5 líneas), no el tablero?
4. **Cadencia del reporte programado:** ¿semanal (lunes), o la que definan con
   Gerencia?
5. **Enlaces mágicos (Fase C-D):** ¿te interesa avanzar a que Leo actúe sin
   login más adelante, o por ahora el admin como puente es suficiente?
