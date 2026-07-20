# SIGSO v4.2 — Propuestas para el módulo de Jefatura

> Estado: **propuesta, sin implementar**. Pendiente de que el usuario apruebe
> qué entra y qué no, y de resolver la decisión de alcance (§0).

Origen: se pidió un rol de **Jefatura** para que ciertas personas supervisen a
su gente (ej. Lisseth → Vanessa, Hernán → Juan). Lo que la jefatura quiere es
**enterarse de qué pasa en su departamento** — idealmente, al terminar el día,
ver qué ocurrió con su equipo. Se toma inspiración del Panel de Gerencia, pero
**acotado a las personas a cargo** (nunca al sistema completo).

---

## Punto de partida: qué hay hoy y qué falta

**Cómo se identifica a las personas hoy** (todo por correo):

| Rol de la persona en una solicitud | Campo que la vincula |
|---|---|
| Quien reporta (solicitante) | `solicitante_email` / `creado_por` |
| Quien resuelve (desarrollador/analista) | `desarrollador_asignado` / `analista_asignado` |

**Lo que NO existe todavía:** no hay ninguna relación "jefe → personas a cargo",
ni un concepto de "departamento" para los solicitantes (el `area` que ya existe
es del lado técnico — quién resuelve —, no del lado del que pide).

**La buena noticia:** el shell de plataforma ya funciona con **módulos por
cuenta** y acciones gateadas por módulo, igual que `gerencia`. Agregar un módulo
`jefatura` + una acción `getPanelJefatura` sigue el patrón que ya existe, sin
tocar el esquema de solicitudes.

---

## §0 — Decisión de alcance (hay que resolverla antes de construir)

Una persona a cargo puede aparecer en SIGSO de dos formas, y esto cambia qué ve
la jefatura:

- **Como solicitante** — reporta problemas / pide cosas. La jefatura vería *"qué
  está reportando mi gente y cómo va"*.
- **Como resolutor** (si es Desarrollador/Analista) — tiene solicitudes
  asignadas. La jefatura vería *"qué está resolviendo mi gente y si cumple los
  plazos"*.

Mi recomendación: **diseñar para ambas** y que el panel muestre las dos
dimensiones de cada persona (lo que pidió + lo que tiene asignado), separadas.
Así el mismo módulo sirve tanto a un jefe de un área operativa (su gente
reporta) como a un jefe técnico (su gente resuelve), sin decidirlo ahora. Cada
tarjeta/tablero indica desde qué rol aparece la solicitud.

**→ Necesito que confirmes:** ¿las personas a cargo son solicitantes, resolutores,
o ambos? (Recomiendo "ambos".)

---

## §1 — Modelo de la relación jefe → personas *(fundacional, no opcional)*

Antes de cualquier panel hay que poder decir "Lisseth supervisa a Vanessa". Tres
formas:

- **J1-a — Hoja `JEFATURAS` por correo (recomendada).** Una hoja nueva y aditiva:
  `jefe_email`, `subordinado_email`, `activo`. Muchos-a-muchos (un jefe, varias
  personas; y hasta soporta el caso matricial de una persona con dos jefes). Se
  administra desde el panel de Administración. **Por correo** y no por cuenta,
  porque el correo es lo que vincula a la persona con sus solicitudes — funciona
  aunque la persona nunca haya iniciado sesión en la plataforma, solo mandado
  solicitudes.
- **J1-b — Campo `jefe_email` en `CUENTAS_PORTAL`.** Cada cuenta apunta a su
  jefe. Más simple, pero solo cubre a quien tiene cuenta de plataforma, y limita
  a un jefe por persona.
- **J1-c — Catálogo de departamentos.** Cada persona pertenece a un departamento
  y el jefe es "jefe del departamento X". Más escalable a futuro, pero obliga a
  catalogar departamentos y clasificar a todos antes de que sirva.

Recomendación: **J1-a**. Es lo mínimo que resuelve el pedido, es aditivo, y no
obliga a reorganizar a nadie. Si más adelante crece, J1-c se puede construir
encima sin romperlo.

---

## §2 — El rol JEFATURA y sus permisos

**Principio rector:** la Jefatura ve **solo a su gente**, en **solo lectura**.
Es un "Gerencia acotado": mismo tipo de información, pero recortada a las
personas a cargo, nunca al sistema completo.

| Puede | No puede |
|---|---|
| Ver el panel de su departamento (solo su gente) | Ver solicitudes de personas fuera de su equipo |
| Abrir el detalle de una solicitud de su gente (solo lectura) | Cambiar estados, asignar, comprometer fechas, cerrar |
| Ver el contenido (¿qué pasa?/¿qué debería pasar?), estado, plazos, semáforo | Ver comentarios internos del equipo técnico (`es_interno`) |
| Filtrar/agrupar/exportar lo de su equipo | Editar catálogos, usuarios ni cuentas |
| Recibir el resumen diario de su departamento | Ver el Panel de Gerencia global |

Detalles de permiso que vale la pena fijar:

- **Aislamiento estricto:** toda consulta de Jefatura se acota en el backend a
  `{ correos de su equipo } ∪ { su propio correo }`. No es un filtro de UI que se
  pueda saltar mandando otro parámetro (mismo blindaje que se acaba de hacer con
  la Bandeja de trabajo: el alcance se impone en el servidor).
- **Solo lectura**, como Gerencia (`Solicitudes.getDetalle` ya devuelve una
  versión sin transiciones ni acciones para roles de solo lectura).
- **Sin notas internas:** el jefe ve la solicitud como la ve el solicitante, no
  los comentarios internos del equipo técnico.

**Dónde vive el rol:** un módulo `jefatura` en `CUENTAS_PORTAL.modulos` +
`JEFATURA` como plantilla de rol, exactamente como está montado `gerencia`. El
panel se muestra en el shell de plataforma (y en el Backoffice si el jefe fuera
staff), gateado por el módulo.

---

## §3 — Panel de Jefatura: "Mi departamento" *(el equivalente acotado del de Gerencia)*

Una pestaña/pantalla "Mi departamento" con, para el conjunto de su gente:

- **KPIs del equipo:** abiertas, en riesgo, vencidas, cerradas esta semana,
  tiempo promedio de resolución, y "mi gente debe validar" (pendientes de
  respuesta del propio equipo).
- **Tablero de seguimiento** de las solicitudes de su gente — el mismo tablero
  que ya tiene Gerencia (con contenido de la solicitud, estado, plazos,
  semáforo), pero recortado al equipo.

Es lo que le da la foto general "¿cómo está mi departamento ahora mismo?".

---

## §4 — Cierre del día: "Hoy en mi departamento" *(lo que más se pidió)*

La jefatura dijo explícitamente que quiere, **al terminar el día, ver qué
ocurrió con su equipo**. Una vista dedicada con lo que pasó *hoy*:

- **Nuevas** solicitudes que reportó su gente hoy.
- **Avanzaron** hoy (cambiaron de estado — se aprobaron, entraron a desarrollo,
  se cerraron).
- **Se cerraron / rechazaron** hoy.
- **Entraron en riesgo o vencieron** hoy.
- **Requieren acción de mi gente** (algo que alguien de mi equipo debe validar y
  no lo ha hecho).
- Un **resumen numérico** del día ("3 nuevas, 2 avanzaron, 1 cerrada, 1 en
  riesgo").

**Extra recomendado — digest por correo:** un trigger diario (fin de jornada)
que le manda a cada jefe el resumen de su departamento por correo, para que se
entere sin tener que entrar. Reutiliza toda la maquinaria de correo que ya
existe (colas, dedup, plantillas). Es probablemente la funcionalidad más valiosa
del módulo, porque cumple literal el pedido ("al finalizar el día poder ver qué
ocurrió").

---

## §5 — Vista por persona *(Lisseth ve a Vanessa, individualmente)*

Un desglose **por cada subordinado**: cuántas solicitudes tiene abiertas, en qué
estados, si algo está atrasado, si debe validar algo, cuánto lleva sin moverse.
Sirve para el seguimiento uno-a-uno y para las reuniones de equipo. Clic en una
persona filtra el tablero a lo suyo.

---

## §6 — ¿Qué le pasa a mi departamento? (carga y recurrencia acotadas)

El equivalente de los análisis de recurrencia/carga de Gerencia (G2/G6), pero
recortado al equipo: qué **módulos/tipos** reporta más mi gente, qué
**plataforma** les da más problemas. Responde *"¿mi equipo pierde mucho tiempo
con el mismo sistema o el mismo error?"* — insumo para que el jefe escale un
problema recurrente.

---

## §7 — Tendencia del departamento *(opcional, como G3/G7)*

Evolución semanal/mensual del volumen y del cumplimiento del equipo — para
distinguir "una mala semana" de "vamos empeorando". Barato si ya se hizo para
Gerencia (se reutiliza el mismo cálculo, acotado).

---

## Resumen para decidir

| # | Propuesta | Responde | Esfuerzo | Depende de |
|---|---|---|---|---|
| **§1** | Relación jefe → personas | (base, habilita todo) | Bajo | — |
| **§2** | Rol JEFATURA + permisos | "¿qué puede ver/hacer?" | Bajo | §1 |
| **§3** | Panel "Mi departamento" | "¿cómo está mi equipo ahora?" | Medio | §1, §2 |
| **§4** | Cierre del día + digest por correo | **"¿qué ocurrió hoy?"** | Medio | §1, §3 |
| **§5** | Vista por persona | "¿cómo va cada uno?" | Bajo | §3 |
| **§6** | Carga/recurrencia del depto. | "¿qué nos pasa repetido?" | Bajo | §3 |
| **§7** | Tendencia del depto. | "¿mejoramos o empeoramos?" | Bajo | §3 |

**Mi recomendación mínima para que sea 100% útil desde el día 1:** §1 + §2
(base y permisos), §3 (la foto), §4 (el cierre del día con digest por correo —
el corazón del pedido) y §5 (por persona). §6 y §7 se pueden sumar después.

Nada de esto toca el esquema de solicitudes; lo único nuevo es la hoja
`JEFATURAS` (§1). Toda la información que consume ya existe.

---

## Decisiones que necesito de ti antes de construir

1. **Alcance (§0):** ¿las personas a cargo son solicitantes, resolutores o
   **ambos**? (Recomiendo ambos.)
2. **Relación (§1):** ¿vamos con la hoja `JEFATURAS` por correo (J1-a)?
3. **Qué propuestas apruebas** (§3–§7) y si el **digest por correo** (§4) entra.
