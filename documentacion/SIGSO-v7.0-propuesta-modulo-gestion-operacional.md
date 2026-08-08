# SIGSO v7.0 — Módulo de Gestión Operacional ("Plan de trabajo")

> Documento base de arquitectura funcional. Escrito para servir de insumo al
> desarrollo completo del módulo, no como resumen ejecutivo.
>
> Estado: **propuesta**. Nada de esto está implementado todavía.

---

## Parte I — Análisis del sistema existente

Esta parte no propone nada. Documenta lo que SIGSO **ya es**, porque el módulo
nuevo debe apoyarse en eso en vez de duplicarlo.

### 1.1 Arquitectura real

| Capa | Implementación |
|---|---|
| Backend | 2 proyectos Apps Script independientes: `backend/intake` (formulario público) y `backend/backoffice` (gestión) |
| Base de datos | Google Sheets — 35 hojas, acceso exclusivo por `SheetsRepo.gs` (caché por request desde v6.9) |
| Frontend | JS estático en GitHub Pages. Shell modular `plataforma.html` + `plataforma.js`; el Backoffice con login Google usa `app.html`/`admin.html`, empaquetados a `App.html`/`Admin.html` |
| Identidad | Dos caminos: sesión Google, o token de portal (`CUENTAS_PORTAL` + `SESIONES_PORTAL`) |
| Despliegue | **Dos** Web Apps del mismo proyecto Backoffice (login Google / token portal). Ambas deben actualizarse juntas |

### 1.2 Modelo de permisos (cuatro capas, no una)

1. **Rol**: `ADM`, `ANA`, `DEV`, `GERENCIA`, `JEFATURA`, `SOLICITANTE`.
2. **Módulos por cuenta**: `MODULOS_POR_ROL` da la plantilla, pero la lista
   efectiva vive en `CUENTAS_PORTAL.modulos` y es editable cuenta por cuenta.
3. **Gate por acción**: `MODULO_POR_ACCION` en `Code.gs` exige un módulo por
   cada acción del router.
4. **Validación dentro de la función**: cada módulo revalida (ej. Novedades
   comprueba `CAT_AREAS.responsable_email`; Jefatura acota al equipo).

**Consecuencia de diseño:** una acción nueva necesita decidir su capa. No todo
va en `MODULO_POR_ACCION` — Perfiles y el feed de Novedades no llevan gate
porque pertenecen a *toda* identidad autenticada.

### 1.3 Módulos actuales del shell

`nueva_solicitud`, `mis_solicitudes`, `bandeja`, `gerencia`, `jefatura`
(Mi departamento), `administracion`, `pausas`, `pausas_coordinacion`,
`novedades`.

### 1.4 Conceptos de dominio que YA existen y son reutilizables

Esto es lo más importante del análisis. SIGSO **ya sabe** modelar compromisos:

| Concepto existente | Dónde vive | Reutilizable para el módulo nuevo |
|---|---|---|
| Compromiso de fecha | `SUBSOLICITUDES.fecha_propuesta / comprometida / terminada` | Sí — mismo vocabulario |
| Semáforo de cumplimiento | `Cumplimiento.gs` (`EN_RIESGO`, `ATRASADA_DESARROLLADOR`, `ESPERANDO_VALIDACION`) | Sí — extender, no reinventar |
| SLA en horas hábiles | `Utils.horasHabilesEntre` (feriados, DST, pausas) | Sí — cálculo de plazos |
| Relación supervisor→equipo | `JEFATURAS` (`jefe_email`/`subordinado_email`) | Sí — ya la usan Jefatura **y** la aprobación de Novedades |
| Historial de cambios | Patrón `HISTORIAL_ESTADOS / PRIORIDAD / COMPROMISO / ASIGNACION` | Sí — mismo patrón |
| Comentarios y adjuntos | `COMENTARIOS`, `ARCHIVOS` + Drive | Sí |
| Notificaciones | `Notificaciones.gs`: dedup, plantilla HTML, cola de reintento | Sí |
| Prioridad P1–P5 | `Constantes.gs` | Sí |
| Áreas y clientes | `CAT_AREAS`, `CAT_CLIENTES` | Sí |

**No hay que construir un sistema de seguimiento desde cero. Hay que
generalizar el que ya existe.**

### 1.5 Convenciones de UI vigentes (`UI-GUIDELINES.md`)

- Un solo botón primario por pantalla.
- Tablas de trabajo **densas** (están para trabajar 4 horas al día). Tarjetas
  solo en Home y móvil.
- Sin emojis en UI (solo en correos). Sin gradientes ni glassmorphism.
- Español chileno directo: *qué pasó y qué hacer después*.
- Componentes ya disponibles: `kpi`, `badge`, `badgeEstado`, `badgePrioridad`,
  `chipSituacion`, `flujoEstados`, `stepper`, `tarjeta`, `vacio`, `esqueleto`,
  `avatar`, `confirmar`, `prompt`, `galeriaImagenes`, `listaArchivos`.
- Modo claro y oscuro obligatorios.

### 1.6 Restricciones técnicas duras

| Restricción | Estado actual | Implicancia |
|---|---|---|
| **Límite de 20 triggers** en Apps Script | **17 usados** | Quedan 3. El módulo nuevo **no puede** basarse en triggers propios |
| Sheets se lee por hoja completa | Mitigado con caché v6.9 | Toda tabla que crezca rápido es un riesgo de rendimiento |
| `CacheService` limita 100 KB por valor | Ya afecta a Gerencia | Los paneles grandes no se pueden cachear enteros |
| Dos implementaciones del Web App | — | Todo despliegue se hace dos veces |

> Precedente relevante: en v6.5.1 el recordatorio de Novedades **no** creó un
> trigger propio; se colgó del trigger diario existente (`recordarValidacion
> PendienteTrigger`, 09:00) envuelto en `try/catch`. El módulo nuevo debe
> seguir esa misma técnica.

---

## Parte II — El problema, replanteado

### 2.1 Lo que se describió

Un supervisor pide una actividad. El colaborador acepta. Pasan días sin
información. Al final entrega tarde diciendo que estuvo en otras cosas, y no
hay forma de verificarlo.

### 2.2 Lo que realmente está fallando

El problema **no** es que falte una lista de tareas. Es que **no existe un
compromiso explícito ni un canal barato para actualizarlo**. Descompuesto:

1. **No hay compromiso registrado.** "Lo veo esta semana" no es una fecha.
2. **No hay costo bajo de actualizar.** Si actualizar cuesta más que no
   hacerlo, nadie actualiza.
3. **No hay lugar donde declarar lo no planificado.** El colaborador que
   *efectivamente* estuvo en otra cosa no tiene dónde registrarlo, así que su
   explicación siempre suena a excusa aunque sea cierta.
4. **La información se pide, no se publica.** Preguntar es caro para ambos.

El punto 3 es el que casi siempre se omite al diseñar estos módulos, y es la
causa de que fracasen: **si el sistema solo mide lo planificado, castiga la
honestidad y todos aprenden a inflar los avances.**

### 2.3 Criterio rector (no negociable)

El módulo mide **compromisos**, no personas. Cada decisión de diseño de este
documento se somete a esta prueba:

> ¿Esto le sirve también al colaborador, o solo al que lo supervisa?

Si la respuesta es "solo al supervisor", es vigilancia y se rediseña.

---

## Parte III — Alternativas evaluadas

Antes de proponer, descarto tres caminos razonables. Registro por qué.

### Alternativa A — Extender SOLICITUDES

Reutilizar el ticket que ya existe: cada actividad interna es una solicitud.

- ✅ Cero entidades nuevas, hereda estados, SLA, historial, adjuntos.
- ❌ El modelo de ticket es *demanda→resolución*: se mide en horas hábiles
  desde la creación y se cierra una vez. Una actividad vive semanas con avance
  parcial.
- ❌ La taxonomía (`plataforma`/`módulo`/`tipo`) es de software; no calza con
  trabajo operacional de RRHH, contabilidad o prevención.
- ❌ Contaminaría los KPIs de Gerencia ya existentes (tiempo promedio de
  resolución, cumplimiento) mezclando dos poblaciones distintas.

**Descartada**, pero con una lección: hay que *poder vincular* una actividad a
una solicitud.

### Alternativa B — Tablero Kanban genérico

Columnas arrastrables, tarjetas libres.

- ✅ Familiar, visualmente atractivo.
- ❌ Un Kanban responde "¿en qué columna está?", no "¿llega a la fecha?".
- ❌ No modela compromiso ni antigüedad de la información: una tarjeta puede
  estar 3 semanas en "En curso" y el tablero se ve perfecto.
- ❌ No escala a las preguntas de gerencia (carga, riesgo, cumplimiento).

**Descartada.** El Kanban puede existir como *vista*, jamás como modelo.

### Alternativa C — Parte diario / timesheet

Cada persona registra en qué usó sus horas.

- ✅ Datos ricos de capacidad real.
- ❌ Es exactamente lo que el objetivo prohíbe: se percibe como control horario.
- ❌ Costo de registro altísimo → datos falsos en 2 semanas.

**Descartada por principio**, no solo por costo.

### Alternativa D (elegida) — Compromisos con check-in ligero

Entidad propia `ACTIVIDADES` + una bitácora de check-ins de fricción mínima,
apoyada en la infraestructura existente (`JEFATURAS`, `Cumplimiento`, `SLA`,
`Notificaciones`, `CAT_AREAS`, `CAT_CLIENTES`).

Justificación completa en la Parte IV.

---

## Parte IV — Diseño propuesto

### 4.1 Dónde vive dentro de SIGSO

**Decisión: un solo módulo nuevo, más pestañas en paneles existentes.**

| Rol | Dónde entra | Por qué |
|---|---|---|
| Colaborador | **Módulo nuevo `mi_trabajo`** ("Mi trabajo") en el shell | Necesita un lugar propio, diario |
| Supervisor | **Pestaña nueva dentro de "Mi departamento"** (`jefatura`) | Ya tiene su panel; un segundo panel de supervisor fragmentaría |
| Gerencia | **Pestaña nueva dentro de "Panel de gerencia"** | Igual criterio; ya hay precedente con la pestaña de Pausas (v6.0 P5) |
| Administración | Config y catálogos dentro de `administracion` | Igual que Pausas y Jefaturas |

Esto evita el error de crear tres módulos y que el sistema se sienta partido.
Se agrega **un** ítem al menú lateral, no tres.

### 4.2 Modelo de entidades

#### `ACTIVIDADES` (una fila por compromiso)

| Campo | Tipo | Nota |
|---|---|---|
| `actividad_id` | uuid | |
| `titulo` | string | obligatorio |
| `descripcion` | texto | opcional |
| `origen` | enum | `ASIGNADA` \| `PROPIA` \| `EMERGENTE` \| `SOLICITUD` |
| `solicitud_id` | string | opcional — vínculo con el módulo de Solicitudes |
| `responsable_email` / `_nombre` | string | quién la ejecuta |
| `supervisor_email` | string | a quién le reporta (por defecto, su jefe en `JEFATURAS`) |
| `area_id` | string | `CAT_AREAS` |
| `cliente_id` | string | opcional, `CAT_CLIENTES` |
| `proyecto` | string | texto libre **con autocompletado** sobre los valores ya usados (ver §4.9) |
| `prioridad` | `P1`–`P5` | reutiliza la escala existente |
| `estado` | enum | `NO_INICIADA` \| `EN_CURSO` \| `BLOQUEADA` \| `EN_REVISION` \| `TERMINADA` \| `CANCELADA` |
| `tamano` | enum | `S` \| `M` \| `L` \| `XL` → horas estimadas (ver §4.5) |
| `fecha_propuesta` | fecha | la que sugiere quien asigna (ver §4.3.1) |
| `fecha_compromiso` | fecha | **el corazón del módulo** — la que confirma el responsable |
| `confirmada_en` | datetime | vacía = compromiso aún no aceptado |
| `requiere_validacion` | boolean | si el supervisor debe revisar antes de cerrar (§4.3) |
| `recurrencia` | enum | `NINGUNA` \| `SEMANAL` \| `MENSUAL` — trabajo periódico (§11.3-A) |
| `recurrencia_origen_id` | uuid | si nació al cerrarse una recurrente, apunta a la anterior (trazabilidad de la cadena) |
| `fecha_inicio_plan` | fecha | opcional |
| `fecha_terminada` | datetime | sellada automáticamente |
| `confianza` | enum | `VERDE` \| `AMARILLO` \| `ROJO` — última declarada |
| `avance_pct` | número | **opcional**, ver §4.4 |
| `bloqueo_motivo` | texto | vigente, si `estado = BLOQUEADA` |
| `bloqueo_responsable_email` | string | quién debe destrabar |
| `bloqueo_desde` | datetime | para medir tiempo de desbloqueo |
| `ultima_actualizacion` | datetime | **denormalizado** — clave de rendimiento |
| `reprogramaciones` | número | contador; métrica de calidad de planificación |
| `fecha_creacion`, `creado_por`, `activa` | | patrón estándar del sistema |

#### `ACTIVIDADES_BITACORA` (una fila por evento)

`bitacora_id`, `actividad_id`, `tipo`, `autor_email`, `autor_nombre`, `nota`,
`avance_pct`, `confianza`, `datos` (JSON libre), `timestamp`.

`tipo` ∈ `CREADA`, `CHECKIN_AVANCE`, `CHECKIN_SIN_CAMBIO`, `BLOQUEO`,
`DESBLOQUEO`, `REPROGRAMACION`, `CAMBIO_ESTADO`, `REASIGNACION`, `ENTREGA`,
`VALIDACION`, `COMENTARIO`.

> **Decisión deliberada: una sola tabla de historial, no cuatro.** SIGSO tiene
> cuatro hojas `HISTORIAL_*` para Solicitudes. Repetir ese patrón aquí sería
> 4 lecturas de hoja por detalle. Con Sheets como base de datos, una bitácora
> unificada con `tipo` es más barata y no pierde información.

#### `ACTIVIDADES_CAPACIDAD` (Fase 3)

`email`, `horas_asignables_semana`, `activo`. Sin fila propia, la persona toma
el default global configurable en Administración.

**Default recomendado: 25 h/semana asignables** (no 42). Ver §4.5.1 — es la
decisión que hace que el indicador de carga sirva para algo.

#### Relaciones

```
JEFATURAS ──(supervisor)──► ACTIVIDADES ◄──(1:N)── ACTIVIDADES_BITACORA
                                 │
CAT_AREAS ───────────────────────┤
CAT_CLIENTES ────────────────────┤
SOLICITUDES ──(opcional)─────────┘
```

### 4.3 Máquina de estados

```
NO_INICIADA ──► EN_CURSO ──► EN_REVISION ──► TERMINADA
     ▲             │  ▲            │
     │             ▼  │            └──► EN_CURSO   (el supervisor devuelve)
     │         BLOQUEADA
 (pendiente         │
 de confirmar)      └──► CANCELADA  (desde cualquier estado, con motivo)
```

#### 4.3.1 El compromiso se acepta, no se impone

Cuando **un supervisor** crea una actividad para otra persona, la fecha entra
como `fecha_propuesta` y la actividad queda en `NO_INICIADA` **pendiente de
confirmación**. El responsable tiene dos respuestas de un clic:

- **Confirmo** → la propuesta pasa a `fecha_compromiso` y se sella
  `confirmada_en`.
- **Propongo otra fecha** → indica fecha y motivo; vuelve al supervisor.

Por qué importa: el caso que originó este módulo empieza con *"el colaborador
acepta realizarla"*, y ahí se pierde el rastro. **Una fecha que la persona no
confirmó no es un compromiso, es una imposición** — y nadie defiende una fecha
que no puso. Además reutiliza exactamente el vocabulario que SIGSO ya tiene en
Solicitudes (`fecha_propuesta` → `fecha_comprometida`), así que no introduce un
concepto nuevo que aprender.

Cuando el propio responsable crea su actividad (`origen = PROPIA` o
`EMERGENTE`), confirma en el mismo acto: no hay paso extra.

Una actividad sin confirmar **no cuenta** en cumplimiento, pero sí aparece en
el panel del supervisor como *"esperando confirmación"* — un silencio de tres
días ahí ya es información accionable.

Reglas:
- `EN_REVISION` es **opcional por actividad** (`requiere_validacion`), apagado
  por defecto. Para trabajo rutinario se salta: `EN_CURSO → TERMINADA`.
  Obligar a validar todo genera burocracia y cuellos de botella.
- `BLOQUEADA` exige motivo y, si se puede, responsable de destrabe. Sin eso el
  bloqueo no es accionable.
- `CANCELADA` exige motivo. Es terminal.
- Cambiar `fecha_compromiso` de una actividad ya iniciada es una
  **reprogramación**: exige motivo, incrementa el contador y queda en bitácora.
  No se puede mover la fecha en silencio — ahí está la trazabilidad que hoy
  falta.

### 4.4 El check-in: la decisión de diseño más importante

Es donde el módulo se gana o se pierde. Requisito: **menos de un minuto**.

#### Cuestionamiento al "% de avance"

Se pidió explícitamente porcentaje de avance. **Recomiendo degradarlo a campo
opcional y secundario.** Razones:

1. Es subjetivo y no verificable. El "90% eterno" es un clásico.
2. Es un indicador **retrasado**: dice dónde estuvo, no si va a llegar.
3. Fuerza a inventar. Nadie sabe si va en 40% o 55%, y esa precisión falsa
   contamina todos los reportes de arriba.
4. Se siente a vigilancia mucho más que declarar una fecha.

#### Lo que propongo en su lugar: **semáforo de confianza**

Una sola pregunta, en el lenguaje de quien trabaja:

> **¿Llegas con la fecha comprometida?**
> 🟢 Sí, va bien  🟡 Ajustado  🔴 No llego

Esto es un indicador **adelantado**: avisa antes de que el atraso ocurra, que
es exactamente lo que hoy no pasa. Es honesto (nadie tiene que fingir un
número) y es accionable (un 🔴 dispara conversación *antes* del vencimiento).

El `%` queda disponible solo para actividades largas (`L`/`XL`), y siempre
opcional.

#### El flujo real de actualización

El colaborador entra a "Mi trabajo" y ve sus actividades. Por cada una, cuatro
botones grandes, sin escribir nada:

```
┌──────────────────────────────────────────────────────────┐
│ Informe mensual de remuneraciones          🔴 vence en 2d │
│ ───────────────────────────────────────────────────────── │
│  [ Avancé ]  [ Sin cambios ]  [ Estoy bloqueado ] [ Listo ]│
└──────────────────────────────────────────────────────────┘
```

- **Avancé** → 1 clic. Opcional: una línea de nota. Actualiza
  `ultima_actualizacion` y pregunta confianza solo si cambió el semáforo o si
  van >5 días sin preguntarla.
- **Sin cambios** → 1 clic. **Es una respuesta legítima y no penalizada.** Sin
  esta opción, la gente deja de actualizar cuando no hay avance, que es
  justo cuando más importa saberlo.
- **Estoy bloqueado** → pide motivo y, si aplica, quién destraba. Es el evento
  de mayor valor del sistema: convierte un silencio de 5 días en una acción de
  hoy.
- **Listo** → pasa a `TERMINADA` (o `EN_REVISION` si lo exige).

**Costo total del día típico: 2 o 3 clics.** Sin formularios.

#### Registro de trabajo emergente (la pieza que faltaba)

Un botón permanente: **"Registrar algo no planificado"**. Título + tamaño +
área. Tres campos, 20 segundos.

Esto resuelve estructuralmente el caso que originó todo: el colaborador que
"estuvo en otras cosas" ahora **tiene dónde decirlo cuando pasa**, no después.
Y la empresa gana el dato más valioso del módulo: **cuánto del tiempo real se
va en trabajo no planificado** (§4.7, KPI 6).

### 4.5 Estimación por tamaño, no por horas

Pedir horas es preciso pero caro y poco confiable. Propongo tallas:

| Talla | Equivale a | Uso |
|---|---|---|
| S | ~2 h | Algo del día |
| M | ~1 día | Default |
| L | ~3 días | |
| XL | ~1 semana o más | Sugiere partirla en varias |

Un clic en vez de pensar un número. La equivalencia en horas es configurable y
sirve para calcular carga sin pedirle horas a nadie. Si `XL` se usa mucho, el
sistema sugiere dividir — mejora la planificación sin imponerla.

#### 4.5.1 Capacidad asignable ≠ jornada legal

Es el error más común al construir estos módulos: tomar la jornada legal como
capacidad de planificación.

En Chile la jornada legal es de **42 h** semanales desde abril de 2026
(Ley 21.561, en transición a 40 h en 2028). Pero **nadie dedica el 100% de su
semana a actividades planificadas**: hay reuniones, correo, interrupciones,
pausas activas (SIGSO tiene un módulo entero para eso) y trabajo emergente.

Si se fija la capacidad en 42 h y se asignan 42 h de actividades, **todo el
mundo queda estructuralmente sobrecargado y el semáforo de carga vive en rojo**
— o sea, deja de informar.

Por eso el default es **25 h semanales asignables (≈60% de la jornada)**, con
override por persona. La brecha entre la jornada y la capacidad asignable es,
justamente, donde vive el trabajo emergente — y el KPI 6 (§4.7) la mide. Si el
emergente ocupa sistemáticamente más que esa brecha, el número a corregir es la
capacidad asignable, con dato real en la mano.

### 4.6 Alertas y automatizaciones (con presupuesto de 0 triggers nuevos)

Dado que quedan solo 3 slots de 20, **todo se cuelga del trigger diario
existente de las 09:00**, envuelto en `try/catch` (mismo patrón que v6.5.1).

| Alerta | Condición | Destinatario |
|---|---|---|
| Sin novedad | Umbral **escalonado**, ver §4.6.1 | Colaborador (recordatorio suave); al 2.º ciclo también supervisor |
| Sin confirmar | Actividad asignada sin confirmar hace ≥ 2 días hábiles | Supervisor |
| Compromiso próximo | Vence en ≤ 2 días hábiles y confianza ≠ 🟢 | Supervisor |
| Vencida | Pasó `fecha_compromiso` sin `TERMINADA` | Supervisor |
| Bloqueo estancado | `BLOQUEADA` hace ≥ 2 días hábiles | Supervisor + responsable de destrabe |
| Sobrecarga | Carga asignada > capacidad de la semana | Supervisor **al momento de asignar**, no después |

**Regla de oro (aprendida de Novedades):** un **solo** correo diario por
persona, agrupando todo. Nunca un correo por actividad.

#### 4.6.1 Umbral de "sin novedad": escalonado, no fijo

Un umbral único es siempre el equivocado para alguien: molesta a quien trabaja
en algo de tres semanas y llega tarde en lo que vence pasado mañana. **La
frescura exigida debe ser proporcional a la cercanía del compromiso.**

| Situación de la actividad | Umbral sin novedad |
|---|---|
| Compromiso dentro de los próximos 5 días hábiles | **2 días hábiles** |
| Compromiso más lejano, o sin fecha aún | **5 días hábiles** |
| Estado `BLOQUEADA` | **2 días hábiles** (un bloqueo callado es el peor caso) |

Ambos valores son configurables en Administración. El primer aviso va **solo al
colaborador** y en tono de recordatorio; recién si pasa un segundo ciclo sin
novedad se suma el supervisor. Esa gradualidad es lo que separa "el sistema me
ayuda a no olvidar" de "el sistema me está vigilando".

### 4.7 KPIs de Gerencia — con justificación y descartes

#### Propuestos

| # | KPI | Por qué merece existir | Decisión que habilita |
|---|---|---|---|
| 1 | **% de compromisos cumplidos en fecha** (por periodo) | Métrica de resultado del módulo | ¿Mejoramos o no? |
| 2 | **Antigüedad media de la información** (días sin actualizar) | **Meta-KPI**: si es alta, todos los demás KPIs son ficción | ¿Puedo confiar en este panel? |
| 3 | **Actividades bloqueadas y tiempo medio de desbloqueo** | Mide fricción organizacional, no desempeño individual | Dónde intervenir la gerencia |
| 4 | **Reprogramaciones por actividad** | 1 es normal; 4 indica mala estimación o alcance que crece | ¿Hay que revisar cómo planificamos? |
| 5 | **Distribución de carga por persona/área** (sin ranking) | Capacidad, no productividad | ¿A quién le pido lo próximo? |
| 6 | **% de trabajo emergente vs planificado** | Explica estructuralmente el "estuve en otras cosas" | Si es 60%, planificar es teatro y hay que rediseñar el trabajo |

El #6 es el más valioso y no estaba en el pedido original.

#### Descartados a propósito

| KPI | Por qué NO |
|---|---|
| Productividad por colaborador | Vigilancia; incentiva inflar datos; destruye la calidad de todo lo demás |
| Horas trabajadas | No medible con honestidad sin control horario |
| Ranking de cumplimiento individual | El primer ranking publicado es el último dato confiable que se recibe |
| % de avance promedio | Promedia un número inventado; da falsa precisión |

### 4.8 Reportes

En vez de 18 reportes sueltos, **3 motores + filtros comunes**
(persona, área, supervisor, cliente, proyecto, rango de fechas, estado,
prioridad, origen):

1. **Estado actual** (foto de hoy): qué hay abierto, con quién, con qué
   semáforo y qué vence. Para el día a día.
2. **Cumplimiento del periodo**: comprometido vs cumplido, reprogramaciones,
   vencidas, tiempos. Para reuniones mensuales y auditoría.
3. **Carga y capacidad**: distribución por persona/área, emergente vs
   planificado. Para decisiones de asignación y dotación.

Formatos: **PDF** en servidor (reutilizando el patrón HTML→PDF de
`OrdenTrabajo.gs`), **CSV/Excel**, e impresión con el CSS de impresión que ya
existe (v5.0 F4).

**Extra propuesto: "Acta de reunión de seguimiento".** Un PDF que arma solo la
agenda de la reunión semanal del equipo: qué venció, qué está bloqueado, qué
se reprogramó y qué vence la semana entrante — en ese orden. El reporte *es* la
pauta de la reunión. Es lo que convierte al módulo en herramienta de gestión y
no en archivo de datos.

### 4.9 Alcance deliberadamente excluido de la v1

Registro qué dejo fuera y por qué, para que la decisión sea explícita:

| Función pedida | Decisión | Motivo |
|---|---|---|
| **Dependencias entre actividades** | Versión ligera: bloqueo de tipo "espera a otra actividad" | Un grafo de dependencias real (con ruta crítica) es un motor de proyectos; 90% del valor se obtiene con el bloqueo tipado, a 10% del costo |
| **Proyectos como entidad** | v1: campo de texto libre + catálogo simple | Convertirlo en entidad con presupuesto y fases es otro módulo. Si el texto libre se usa mucho, se promueve a catálogo con datos reales en mano |
| **Priorización automática** | No | Una prioridad calculada que nadie entiende se ignora. La prioridad la pone una persona; el sistema solo **ordena** por vencimiento y semáforo |
| **Planificación mensual formal** | v1 semanal | El horizonte real de este problema es la semana |

---

## Parte V — Experiencia por rol (UX/UI)

Todo lo que sigue respeta `UI-GUIDELINES.md`: un primario por pantalla, tablas
densas para trabajo, tarjetas solo en Home/móvil, sin emojis en UI (los
semáforos son puntos de color con texto, no emojis), claro y oscuro.

### 5.1 Colaborador — "Mi trabajo"

**Por qué existe:** es el único lugar donde el colaborador ve *todo lo que
debe* sin que se lo pregunten.

Estructura vertical, sin tabla (aquí sí tarjetas: son pocas filas y se opera
con el pulgar en el celular):

```
Mi trabajo                                  [ + Registrar actividad ]

Hoy importa                        ← agrupación por urgencia, no por estado
┌────────────────────────────────────────────────────────────────┐
│ ● Informe mensual de remuneraciones               vence mañana │
│   RRHH · comprometida 12-08                                     │
│   [ Avancé ]  [ Sin cambios ]  [ Bloqueado ]  [ Listo ]         │
└────────────────────────────────────────────────────────────────┘

Esta semana
┌────────────────────────────────────────────────────────────────┐
│ ● Revisión de contratos                          vence viernes │
└────────────────────────────────────────────────────────────────┘

Más adelante  (3)                                        [desplegar]

Bloqueadas  (1)                                          [desplegar]
```

Decisiones y su justificación:

- **Agrupado por urgencia, no por estado.** El colaborador no piensa en
  estados; piensa en "qué me toca hoy". Los estados son lenguaje del sistema.
- **Las acciones están en la tarjeta**, no dentro de un detalle. Abrir un
  modal para decir "sin cambios" ya rompe el minuto.
- **"Más adelante" viene colapsado.** Ver 14 actividades genera parálisis; ver
  2 genera acción.
- **Un solo botón primario** ("Registrar actividad"), coherente con la guía.
- La barra superior muestra **su propia carga** de la semana. No es control:
  es su argumento para decir "estoy al tope" con dato, no con percepción.

### 5.2 Supervisor — pestaña "Actividades del equipo" en *Mi departamento*

**Por qué ahí:** el supervisor ya entra a ese panel; un segundo panel partiría
su flujo en dos.

Encabezado con 4 KPI accionables — cada uno es un **filtro clicable**, no
decoración:

```
[ 3 sin novedad ] [ 2 bloqueadas ] [ 4 vencen esta semana ] [ 1 vencida ]
```

Debajo, **tabla densa** (patrón de bandeja/gerencia ya existente):

| Actividad | Responsable | Compromiso | Semáforo | Últ. novedad | Estado |
|---|---|---|---|---|---|

- Orden por defecto: **riesgo**, no alfabético ni por fecha de creación.
- "Últ. novedad" en días, con color: es la columna que responde la pregunta
  que hoy no se puede responder.
- Fila expandible con la bitácora (patrón ya usado en Gerencia v4.1).
- Acciones directas desde la fila: **pedir actualización** (un clic, manda un
  recordatorio puntual), **reasignar**, **ajustar compromiso**.
- Segunda sub-pestaña **"Carga del equipo"**: barras por persona contra su
  capacidad. Sirve para asignar, y para *no* sobreasignar.

### 5.3 Gerencia — pestaña en *Panel de gerencia*

Mismo criterio que la pestaña de Pausas (v6.0 P5): no es un panel nuevo.

- Los 6 KPIs de §4.7 arriba, con comparación contra el periodo anterior (el
  componente de delta ya existe, v4.1 G7).
- Un mapa de calor **área × semana** de cumplimiento. Responde "¿dónde está el
  problema?" sin leer filas.
- Tabla de **actividades críticas** (P1/P2 vencidas o en rojo), transversal a
  todos los departamentos.
- Botón de exportación a los 3 reportes.

Nada de gráficos decorativos: cada elemento responde una pregunta de decisión
declarada en §4.7.

---

## Parte VI — Reglas de negocio (numeradas para trazabilidad)

- **RN-700** Toda actividad tiene responsable, supervisor y fecha de
  compromiso. Sin los tres no se crea.
- **RN-701** El supervisor por defecto es el jefe del responsable según
  `JEFATURAS`. Si no lo tiene, se exige elegirlo explícitamente.
- **RN-702** Solo el responsable hace check-in de su actividad. El supervisor
  comenta y ajusta, pero no reporta avance por otro (destruiría el dato).
- **RN-703** Cambiar `fecha_compromiso` de una actividad iniciada exige motivo
  y cuenta como reprogramación.
- **RN-704** `BLOQUEADA` exige motivo. Si hay responsable de destrabe, se le
  notifica.
- **RN-705** `ultima_actualizacion` solo la mueve un check-in real. Abrir la
  actividad **no** cuenta como actualizar.
- **RN-706** El trabajo emergente entra siempre como `origen = EMERGENTE` y no
  penaliza el cumplimiento de lo planificado, pero sí consume capacidad.
- **RN-707** Nadie ve actividades fuera de su alcance: el colaborador ve las
  suyas; el supervisor, las de su equipo (`JEFATURAS`); Gerencia y ADM, todas.
- **RN-708** Ninguna métrica individual se expone en rankings comparativos
  entre personas. La carga se muestra contra la **capacidad propia**, no
  contra los pares.
- **RN-709** Crean actividades: el colaborador (para sí mismo), el supervisor
  (para su equipo según `JEFATURAS`) y ADM (para cualquiera). Nadie crea
  actividades para alguien que no está bajo su alcance.
- **RN-710** Una actividad asignada por un tercero **no tiene compromiso** hasta
  que el responsable confirma la fecha (o propone otra). Sin `confirmada_en` no
  entra en el cálculo de cumplimiento, pero sí figura como *pendiente de
  confirmación*.
- **RN-711** El responsable puede proponer una fecha distinta a la sugerida, con
  motivo. La contrapropuesta **no** es un rechazo del trabajo: es parte normal
  de acordar un compromiso realista.
- **RN-712** La capacidad asignable por defecto (25 h/semana) es un parámetro de
  planificación, **no** una medida de jornada ni de cumplimiento laboral, y no
  se usa para evaluar personas.
- **RN-713** Al cerrar (`TERMINADA`) una actividad con `recurrencia ≠ NINGUNA`,
  el sistema crea automáticamente la siguiente instancia: mismos datos, fecha de
  compromiso corrida según la periodicidad, bitácora en blanco,
  `recurrencia_origen_id` apuntando a la cerrada. La cadena es rastreable y se
  corta al poner `recurrencia = NINGUNA` o cancelar. (Cubre el "recordatorio
  mensual" de contabilidad/RRHH visto en la reunión real, §11.3-A.)

RN-708 y RN-712 son reglas de producto, no técnicas, y son las que sostienen la
confiabilidad de los datos en el largo plazo.

---

## Parte VII — Plan por fases

Siguiendo el patrón del proyecto (fases pequeñas, verificables, desplegables).

| Fase | Alcance | Entregable |
|---|---|---|
| **F1 — Núcleo** | Esquema (3 copias + Instalador), `Actividades.gs` CRUD, estados, bitácora, permisos por `JEFATURAS` | Se pueden crear y actualizar actividades por API, con tests |
| **F2 — Mi trabajo** | Módulo `mi_trabajo` en el shell: lista agrupada, check-in de 1 clic, trabajo emergente | El colaborador ya puede usarlo a diario |
| **F3 — Supervisor** | Pestaña en Mi departamento: KPIs clicables, tabla densa, pedir actualización, reasignar, carga del equipo | El supervisor deja de preguntar |
| **F4 — Alertas** | Digest diario colgado del trigger de 09:00, alertas de §4.6 | Cero triggers nuevos |
| **F5 — Gerencia y reportes** | Pestaña de gerencia, 3 motores de reporte, PDF/CSV, acta de reunión | Cierre del ciclo de gestión |
| **F6 — Integración** | Vínculo actividad↔solicitud; "Mi trabajo" unifica solicitudes asignadas + actividades | Un solo lugar para "lo que debo" |

F6 es la que hace que no se sienta un sistema aparte. Vale la pena llegar ahí.

---

## Parte VIII — Riesgos y sostenibilidad a años

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Crecimiento de la bitácora** | ~15.000 filas/año (20 personas × 3 actividades × 250 días). Sheets aguanta, pero la lectura completa se degrada | Nunca leer bitácora en listados (usar `ultima_actualizacion` denormalizado). Archivar cerradas > 12 meses a `ACTIVIDADES_ARCHIVO` |
| **Adopción** | Si el colaborador no ve beneficio, reporta falso y el módulo muere | Protección de sobrecarga, canal de bloqueos, registro de emergente, y "no me pregunten más" |
| **Se percibe como vigilancia** | Pérdida de confianza, datos inflados | RN-708, sin rankings, lenguaje de compromisos, métricas de flujo y no de persona |
| **Presupuesto de triggers (17/20)** | No se pueden agregar automatizaciones | Todo cuelga del trigger diario existente (patrón v6.5.1) |
| **Duplicación con Solicitudes** | Dos sistemas de "trabajo" conviviendo | F6 unifica la vista; el vínculo `solicitud_id` existe desde F1 |
| **Estados que crecen sin control** | Cada excepción pide un estado nuevo | 6 estados fijos. Las variantes se modelan con campos (`requiere_validacion`, `origen`), no con estados |

---

## Parte IX — Decisiones tomadas

Las cinco preguntas abiertas quedaron resueltas con las recomendaciones del
arquitecto (decisión del 05-08-2026). Se registran con su fundamento y, sobre
todo, con **qué habría que observar para revisarlas**.

### D-1 · Crean actividades el colaborador y el supervisor

**Decisión:** ambos. El colaborador planifica lo propio; el supervisor asigna a
su equipo; ADM puede todo. → RN-709.

**Fundamento:** si solo asigna el supervisor, el módulo se convierte en una
lista de tareas impuestas. El colaborador pasa a ser un ejecutor que reporta, no
alguien que gestiona su trabajo — y la adopción cae, que es el riesgo #1 del
proyecto.

**Consecuencia mayor:** trajo el paso de **confirmación del compromiso**
(§4.3.1). Una fecha puesta por un tercero no es un compromiso. Esto cubre
literalmente el momento del caso original donde *"el colaborador acepta
realizarla"* y hoy no queda registrado.

**Revisar si:** aparece mucha actividad `PROPIA` que en realidad es trabajo
personal sin valor para el equipo (indicaría que falta criterio de qué merece
registrarse, no que la decisión esté mal).

### D-2 · La validación del supervisor es opcional por actividad

**Decisión:** `requiere_validacion` apagado por defecto; se activa al crear
cuando corresponde.

**Fundamento:** validar todo genera cuello de botella en el supervisor y castiga
el trabajo rutinario, que es la mayoría. La validación tiene sentido donde hay
entregable formal (un informe, un documento a cliente), no en todo.

**Revisar si:** aparecen disputas frecuentes sobre si algo quedó terminado.
Sería señal de subir el uso de validación en ciertos tipos de trabajo.

### D-3 · "Proyecto" es texto libre con autocompletado

**Decisión:** campo de texto libre en v1, **con autocompletado sobre los valores
ya usados**. Promoción a catálogo (`CAT_PROYECTOS`) en fase posterior, si el uso
lo justifica.

**Fundamento:** un catálogo exige que alguien lo mantenga desde el día uno, sin
saber todavía qué proyectos existen realmente. El autocompletado es la pieza
clave: texto libre *sin* autocompletado produce quince escrituras del mismo
proyecto; *con* autocompletado, la lista se auto-organiza y a los tres meses
tenemos el catálogo real, deducido del uso en vez de inventado.

**Revisar si:** a los 3–6 meses hay un conjunto estable de proyectos → promover
a catálogo con reglas y responsable.

### D-4 · Umbral de "sin novedad": escalonado (2 / 5 días hábiles)

**Decisión:** 2 días hábiles si el compromiso vence dentro de 5 días hábiles o
si está `BLOQUEADA`; 5 días hábiles en el resto. Configurable. Primer aviso solo
al colaborador; el supervisor entra al segundo ciclo. → §4.6.1.

**Fundamento:** descarté el valor fijo de 3 días que yo mismo había insinuado.
Un umbral único siempre es el equivocado para alguien: molesta a quien trabaja
en algo de tres semanas y llega tarde en lo que vence pasado mañana. La frescura
exigida debe ser proporcional a la cercanía del compromiso.

**Revisar si:** el volumen de avisos genera fatiga (subir umbrales) o si siguen
apareciendo sorpresas de último minuto (bajarlos).

### D-5 · Capacidad asignable: 25 h/semana por defecto, no la jornada

**Decisión:** default global de **25 h semanales asignables**, con override por
persona. **No** se usa la jornada legal (42 h en Chile desde abril 2026,
Ley 21.561). → §4.5.1, RN-712.

**Fundamento:** es el error más común de estos módulos. Nadie dedica el 100% de
su semana a actividades planificadas: hay reuniones, correo, interrupciones,
pausas activas y trabajo emergente. Si la capacidad se fija en 42 h y se asignan
42 h, **todos quedan estructuralmente sobrecargados y el semáforo de carga vive
en rojo** — deja de informar. Además, la brecha entre jornada y capacidad
asignable es exactamente donde vive el trabajo emergente que mide el KPI 6.

Se descartó diferenciar por cargo: `cargo` hoy es texto libre en el sistema, no
un catálogo; crear esa taxonomía solo para esto no se justifica. El override por
persona cubre los casos reales (media jornada, roles con mucha reunión).

**Revisar si:** a los 3 meses el emergente ocupa sistemáticamente más que la
brecha → ajustar el default con dato real, no con intuición.

---

## Parte XI — Validación contra un caso real (reunión de Marketing)

Se analizó el acta de una reunión real de control del equipo de Marketing
(revisión de pendientes e inventario de un encargado). No es un ejercicio
teórico: es exactamente el tipo de reunión que este módulo busca hacer
innecesaria. Sirve para dos cosas: **confirmar** que el diseño cubre el caso
real y **descubrir** lo que se me había pasado.

### 11.1 La reunión, en una frase

Un jefe reconstruye verbalmente, preguntando una por una, el estado de los
pendientes de su encargado: qué está hecho, qué falta, qué espera a terceros,
cuánto contenido queda para publicar, y qué se prioriza esta semana.

**Esa reunión completa es el síntoma que describe §2.2:** la información se
*pide*, no se *publica*. Todo lo que ahí se dijo en 40 minutos debería poder
leerse en una pantalla en 40 segundos. Ese es el examen del módulo.

### 11.2 Lo que la reunión confirma (≈80% ya está cubierto)

| Lo que pasó en la reunión | Cómo lo cubre el módulo tal como está diseñado |
|---|---|
| Deliverables con fecha: videos de testimonios, decks, brochures, imágenes web, credenciales, formulario de logo | `ACTIVIDADES` con `fecha_compromiso`. Es el caso central |
| "La pelota está en la chiquilla"; falta contabilidad y RRHH | `BLOQUEADA` con responsable de destrabe (RN-704). El módulo lo hace **visible sin preguntar** |
| "Matemos esta semana estas cosas"; "carruseles en stand-by" | Reprioriza (prioridad P1–P5) y `EN_CURSO`/`CANCELADA`; la vista del supervisor ordena por riesgo |
| "¿Cuándo se termina si publicamos todos los días?" | La pregunta de fecha comprometida vs hoy: es el semáforo |
| El jefe pide "una matriz de inventario con todas las cosas que haya" | **Es, literalmente, la tabla del supervisor** (§5.2). El jefe está pidiendo este módulo sin saberlo |
| Trabajo distribuido en varias personas (la chica nueva, Camila, etc.) | Alcance por `JEFATURAS` + sub-pestaña de carga por persona |
| La reunión misma | El **"Acta de reunión de seguimiento"** que ya propuse (§4.8) es exactamente esta reunión, generada sola |

Conclusión: el modelo de *compromisos con check-in ligero* calza con el caso
real sin forzarlo. El jefe ya trabaja con el mismo vocabulario (pendientes,
responsables, quién bloquea, qué se prioriza).

### 11.3 Lo que la reunión DESCUBRE que faltaba

Aquí está el valor de haber leído el acta en vez de asumir. Aparecen tres cosas
que el diseño no contemplaba. Dos son reales y generalizables; una es específica
de marketing y **recomiendo no construirla ahora**.

#### Hallazgo A — Trabajo recurrente (gap real, se incorpora)

En la reunión: *"los recordatorios de contabilidad son mensuales… recursos
humanos tampoco… ya no se deben hacer más"*. Hay trabajo que **se repite en un
calendario** (gráfica mensual de contabilidad, recordatorio de RRHH, cierres).

El diseño solo modelaba actividades de una sola vez. **Esto es generalizable**:
contabilidad tiene cierres mensuales, RRHH tiene liquidaciones, prevención tiene
reportes periódicos. No es un capricho de marketing.

**Decisión — se agrega `recurrencia` como campo, no como motor pesado:**
una actividad puede marcarse `recurrencia = NINGUNA | SEMANAL | MENSUAL`. Al
cerrarse una recurrente, el sistema **genera automáticamente la siguiente** con
la fecha corrida y la bitácora en blanco. Sin motor de cron, sin entidad nueva:
un campo y una regla al cerrar. Esto convierte "no olvidar la gráfica mensual"
en algo que el sistema sostiene, no la memoria de una persona.
→ **Nueva regla RN-713.** Va en **Fase 1** (es barato) aunque la UI de
recurrencia se afine en Fase 2.

#### Hallazgo B — Inventario / stock producible (gap real, NO se fuerza)

En la reunión: *"tenemos 67 carruseles disponibles… queda como para un mes si
publicamos todos los días"*. Esto **no es una actividad**: es un **stock de
unidades fungibles con una tasa de consumo**, y su métrica clave es el *runway*
("¿para cuántos días de publicación alcanza?").

Es un modelo mental **distinto** al de compromiso con fecha. Meterlo a la fuerza
en `ACTIVIDADES` sería un error: 67 actividades idénticas ensucian todo, y una
sola actividad "carruseles" no captura el stock ni el runway.

**Decisión — separar y diferir, con matiz:**
- **Producir** contenido *sí* es trabajo con compromiso → entra como actividad
  normal ("preparar 10 carruseles de agosto", talla `L`).
- **El stock/runway** (cuántas unidades listas quedan y para cuántos días) es
  otra cosa. **No se construye en v1.** Se deja anotado como candidato a una
  vista ligera posterior ("pipeline de contenido": un contador por área con su
  tasa de consumo) *si* se confirma que más de un área lo necesita. Marketing
  es hoy el único caso claro; no se generaliza sobre un solo dato.
- Mientras tanto, el runway se puede llevar como **una actividad recurrente de
  control** ("revisar stock de contenido") sin código nuevo.

Esto es disciplina de alcance: el pedido "hazme la matriz de inventario" se
cumple con la tabla del supervisor (§11.2); el "stock con runway" es un
problema aparte que no debe frenar ni inflar el módulo.

#### Hallazgo C — Métricas de publicación real (fuera de alcance, se declara)

En la reunión: *"el reporte por palabra no toma todo lo que verdaderamente
realizó… en post de carrusel no cuenta la cantidad real"*. Es un problema de
**analítica de redes sociales** (qué se publicó y cómo rindió), que vive en las
plataformas de redes, no en SIGSO. **Fuera de alcance**, y conviene decirlo
explícitamente para no crear la expectativa de que el módulo mide el rendimiento
de las publicaciones. El módulo mide el **trabajo comprometido**, no el
resultado en redes.

### 11.4 La lección más importante de la reunión: la fricción mata

El encargado describe su dolor actual con total claridad: *"uno se enreda porque
abre la carpeta, ingresa lo del día, se devuelve y aparece de nuevo al
principio… no sé si se podrán ir archivando las que ya están listas para que no
aparezcan"*.

Está **ahogado en fricción de seguimiento manual** (carpetas de Drive que no se
archivan solas). Si el módulo nuevo agrega *un solo paso* de fricción, no lo va
a usar: ya tiene demasiada. Esto **refuerza**, con evidencia real, la decisión
central del diseño (§4.4): check-in de 1 clic, "sin cambios" como respuesta
válida, y la lista que **esconde sola** lo cerrado (equivalente a "archivar las
carpetas listas" que el encargado pide a gritos).

> Traducción de diseño: en "Mi trabajo", lo `TERMINADA` desaparece de la vista
> activa automáticamente. El encargado no debería tener que "archivar" nada — es
> exactamente el gesto manual que hoy lo atrasa.

### 11.5 Sobre "aplica a otros cargos"

La reunión valida que el modelo es **transversal por diseño**: un encargado de
marketing (editar video, hacer deck) y un contador (cierre mensual) tienen ambos
*actividades con compromiso*. **No se construyen pantallas por cargo.** Lo que
cambia entre cargos es el **contenido** (`area_id`, `tipo` de trabajo, si es
recurrente), no la herramienta. Un contador verá su "Mi trabajo" con cierres
recurrentes; el de marketing, con deliverables de campaña. La misma pantalla, el
mismo clic.

El único ajuste por cargo que el caso justifica es el de **Hallazgo A**
(recurrencia), más frecuente en contabilidad/RRHH/prevención que en marketing —
y ya quedó incorporado.

---

## Parte X — Lo que sigue

Con las Partes IX y XI cerradas, el diseño funcional está completo, validado
contra un caso real e implementable. El orden recomendado:

1. **Wireframes de las 3 pantallas** (Mi trabajo · Actividades del equipo ·
   pestaña de Gerencia) para validar la UX **antes** de escribir código. Es
   donde el módulo se gana o se pierde, y corregir un boceto es barato.
2. **Fase 1** (§Parte VII): esquema en las 3 copias + Instalador,
   `Actividades.gs`, máquina de estados, bitácora, **recurrencia (RN-713)**,
   permisos y tests.

---

*Documento preparado como base de desarrollo. Las decisiones de la Parte IX son
revisables con dato real salvo las reglas de producto (RN-708, RN-712), que
sostienen la confiabilidad del módulo y no deberían negociarse por conveniencia
de un reporte.*
