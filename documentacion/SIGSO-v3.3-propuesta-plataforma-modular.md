# SIGSO v3.3 — Propuesta: plataforma modular con identidad por usuario

**Estado: PROPUESTA — pendiente de aprobación.** Nada de esto está implementado.

Absorbe y reemplaza la propuesta v3.2 (portal con credenciales): todo lo de
allá — cuentas, contraseñas, multi-correo, sesiones — sigue vigente y es la
base; esto agrega la capa que faltaba: **una sola plataforma, con módulos por
tipo de usuario**.

---

## 1. La idea, estudiada

Lo pedido: que SIGSO se sienta como una **plataforma** — un solo lugar donde
cada persona ingresa con su usuario y contraseña y ve *sus* módulos:

- El solicitante: enviar solicitudes, ver el estado de las suyas.
- El desarrollador: la bandeja de trabajo (Backoffice).
- Gerencia: su panel, separado.
- Y además: poder dar **módulos específicos a ciertos usuarios** puntuales.

### 1.1 Por qué la idea es mejor de lo que parece

Hoy SIGSO son **cuatro puertas distintas** (formulario, consultar estado,
backoffice, admin), cada una con su propia forma de entrar (nada, correo+código,
Google, Google). Eso tiene tres costos reales que la plataforma elimina:

1. **Confusión de flujo**: la gente no sabe cuál link usar ni cuál guardar.
   Con la plataforma hay UNA dirección, UN login, y adentro cada uno ve solo
   lo que le corresponde — el flujo se explica solo.
2. **Sin identidad**: hoy nadie "es alguien" en SIGSO; es un correo que se
   repite en formularios. Con cuenta, la plataforma te saluda, recuerda tus
   datos, te autocompleta el formulario y te muestra tus pendientes al entrar.
3. **El problema multi-correo** (ya diagnosticado en v3.2): la identidad hoy
   ES un correo. Con cuentas, los correos son un atributo (una cuenta puede
   tener varios) y ves lo de todos los tuyos.

### 1.2 El hallazgo técnico que lo hace barato

El frontend **ya está construido en módulos independientes**: `formulario.js`,
`estado.js`, `dashboard.js`, `detalle.js`, `gerencia.js`, `admin.js` son piezas
separadas que hoy viven en páginas distintas. Y `api.js` ya soporta los dos
transportes (fetch desde GitHub Pages y `google.script.run`).

O sea: **no hay que reescribir los módulos — hay que construir el cascarón**
que los monte según los permisos del usuario. La plataforma es en gran parte
un reordenamiento de piezas que ya existen y funcionan.

---

## 2. Diseño propuesto

### 2.1 La experiencia

**Una sola página de entrada: `plataforma.html`** (en GitHub Pages, gratis,
como todo lo demás).

```
┌──────────────────────────────────────────┐
│  SIGSO                                   │
│  ┌────────────────────────────────────┐  │
│  │  Usuario:     [ cpena          ]   │  │
│  │  Contraseña:  [ ••••••••       ]   │  │
│  │           [ Ingresar ]             │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

Tras ingresar, el **inicio personal**: saludo, resumen de "requieren tu
acción" (reutiliza lo construido en UI-5), y la barra de módulos — solo los
suyos:

```
┌─────────────────────────────────────────────────────────┐
│ SIGSO   [📝 Nueva] [📋 Mis solicitudes]      Camila ▾   │
├─────────────────────────────────────────────────────────┤
│  Hola, Camila                                           │
│                                                         │
│  ⚠ Tienes 2 ítems terminados esperando tu validación    │
│                                                         │
│  ┌───────────────────┐  ┌───────────────────┐           │
│  │ 📝 Nueva solicitud│  │ 📋 Mis solicitudes│           │
│  │                   │  │   5 abiertas      │           │
│  └───────────────────┘  └───────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

El mismo login, para Leo, muestra además `🗂 Bandeja de trabajo`; para
Gerencia, `📊 Panel de gerencia`; para el Admin, `⚙ Administración`. **Misma
puerta, casas distintas.**

### 2.2 Catálogo de módulos

| Módulo (id) | Qué es | Pieza existente que se reutiliza |
|---|---|---|
| `nueva_solicitud` | Ingresar solicitudes. Logueado, autocompleta nombre/cargo/correo — deja de ser tedioso | formulario.js completo |
| `mis_solicitudes` | Sus solicitudes (de TODOS sus correos), validar cierres, responder consultas, cierre directo | estado.js (pestaña Mis solicitudes) |
| `bandeja` | El Backoffice del desarrollador: dashboard, detalle, cambiar estados, comprometer fechas, prioridad, derivar | dashboard.js + detalle.js |
| `gerencia` | Panel de control: KPIs, semáforo, atenciones directas, export | gerencia.js |
| `administracion` | Catálogos, usuarios, cuentas de la plataforma, logs | admin.js |

Los módulos son **independientes entre sí**: agregar uno nuevo mañana (p. ej.
"reportes" o "documentación") es agregar una entrada al catálogo y una pieza
JS, sin tocar el resto.

### 2.3 Permisos: roles como plantilla + ajustes por persona

Esto responde directamente a "incluir módulos específicos a ciertos usuarios":

- Cada **rol** define el set de módulos por defecto:

| Rol | Módulos por defecto |
|---|---|
| SOLICITANTE | nueva_solicitud, mis_solicitudes |
| DEV | nueva_solicitud, mis_solicitudes, **bandeja** |
| GERENCIA | nueva_solicitud, mis_solicitudes, **gerencia** |
| ADM | todos |

- Pero lo que manda es la **lista de módulos de la cuenta**, que el Admin
  puede ajustar persona a persona. Ejemplos reales que esto habilita:
  - Darle a Felipe (jefatura RLD) el módulo `gerencia` sin hacerlo ADM.
  - Darle a Bárbara `bandeja` un tiempo mientras cubre a Leo, y quitárselo
    después.
  - Un usuario "solo consulta" con únicamente `mis_solicitudes`.

El rol es la plantilla al crear la cuenta; la lista por cuenta es la verdad.
El backend valida el módulo en **cada acción** (no solo esconde botones): un
usuario sin `bandeja` que intente llamar `actualizarEstado` recibe rechazo,
aunque manipule el navegador.

### 2.4 Modelo de datos (aditivo, 3 copias del esquema como siempre)

**`CUENTAS_PORTAL`** — la identidad:

| Columna | Nota |
|---|---|
| `cuenta_id` | UUID |
| `usuario` | Para el login (ej. `cpena`), único |
| `nombre` | "Hola, Camila" |
| `hash_password` / `salt` | SHA-256 iterado con sal. Nunca texto plano |
| `emails` | JSON: TODOS los correos de la persona — resuelve el multi-correo |
| `rol` | SOLICITANTE / DEV / GERENCIA / ADM (plantilla) |
| `modulos` | JSON: la lista efectiva (editable por Admin) |
| `empresa_id`, `activo`, `debe_cambiar_password`, `ultimo_acceso`, `creado_por` | Como en v3.2 |

**`SESIONES_PORTAL`**: `token`, `cuenta_id`, `expira` (12 h), `creada`.

La hoja `USUARIOS` actual (staff del Backoffice por correo Google) **no se
toca** durante la transición: ambos sistemas conviven hasta que la migración
termine (ver §4).

### 2.5 Arquitectura técnica

```
GitHub Pages (gratis)                 Apps Script (gratis)
┌──────────────────────┐              ┌─────────────────────────┐
│ plataforma.html      │   fetch      │ Intake Web App          │
│  ├─ login            │────────────► │  + Portal.gs (login,    │
│  ├─ shell (nav+home) │   token en   │    sesiones, cuentas)   │
│  ├─ formulario.js    │   el body    │                         │
│  ├─ estado.js        │              │ Backoffice Web App      │
│  ├─ dashboard.js     │────────────► │  identidad: token O     │
│  ├─ gerencia.js      │              │  Google (dos caminos)   │
│  └─ admin.js         │              └─────────────────────────┘
└──────────────────────┘                        │
                                         Google Sheets
```

El punto técnico central: hoy el Backoffice resuelve la identidad con
`Session.getActiveUser()` (login Google, vía HtmlService). Para la plataforma,
`resolverIdentidadYRol_` gana un **segundo camino**: si la llamada trae un
token de sesión válido, la identidad y los módulos salen de `CUENTAS_PORTAL`.
Los dos caminos conviven — `api.js` ya soporta ambos transportes, así que
las páginas actuales (app.html/admin.html por Google) siguen funcionando
**sin cambios** mientras la plataforma se prueba.

### 2.6 Qué pasa con las páginas actuales

| Hoy | Con la plataforma |
|---|---|
| index.html (formulario) | **Se mantiene** como entrada pública sin login — un cliente externo o alguien sin cuenta puede seguir ingresando solicitudes. La plataforma es la puerta principal; esta queda como puerta de servicio |
| estado.html (consulta por número) | **Se mantiene**: consulta puntual sin cuenta sigue siendo útil |
| estado.html → Mis solicitudes (correo+código) | Migra a la plataforma; el correo+código queda de respaldo y se retira cuando todos tengan cuenta |
| app.html / admin.html (Google) | **Se mantienen operativas** durante toda la transición, como respaldo del staff. Se decide su retiro solo cuando la plataforma esté probada en uso real |

Nada se apaga hasta que su reemplazo esté probado. Cero riesgo de quedarse
sin sistema a mitad de camino.

---

## 3. Seguridad — evaluación honesta

Igual que en v3.2, con un punto nuevo importante:

**Lo que se mantiene del análisis anterior**: hash con sal e iteraciones
(Apps Script no tiene bcrypt; es lo mejor de la plataforma y adecuado al
riesgo), HTTPS garantizado, bloqueo tras 5 intentos fallidos, tokens con
expiración, sin auto-registro (cuentas las crea el Admin).

**El punto nuevo — y la decisión más seria de esta propuesta**: al darle
`bandeja` a los desarrolladores vía plataforma, las acciones de escritura del
staff (cambiar estados, derivar, comprometer fechas) pasan a estar protegidas
por **nuestro login** en vez del de Google (que tiene 2FA). Es objetivamente
más débil. Mitigación propuesta:

1. app.html/admin.html con Google **siguen existiendo** — quien prefiera la vía
   más segura la tiene, y es el respaldo si algo falla.
2. Toda acción de escritura ya queda trazada (historiales + LOG) con el usuario
   que la hizo.
3. Sesiones de 12 h, revocables al desactivar la cuenta.
4. Regla operativa: claves del portal distintas de las del correo.

Para un equipo interno chico y un sistema de gestión de solicitudes (no dinero,
no datos regulados), este balance es razonable. Pero es una decisión tuya y
por eso está escrita acá y no escondida.

---

## 4. Plan de implementación (si se aprueba)

El orden está pensado para que **cada fase entregue algo usable** y nada
existente se rompa:

| Fase | Contenido | Entrega |
|---|---|---|
| **P1 — Identidad** | `CUENTAS_PORTAL` + `SESIONES_PORTAL` (3 copias), `Portal.gs` (login/logout/cambiar clave/validar token, bloqueo anti fuerza bruta), CRUD de cuentas en Administración | El login funciona; aún sin shell |
| **P2 — Shell + módulos del solicitante** | `plataforma.html`: login, inicio personal, nav por módulos; monta `nueva_solicitud` (autocompletado con los datos de la cuenta) y `mis_solicitudes` (multi-correo) | **La plataforma ya sirve para las jefaturas** — el caso que hoy duele |
| **P3 — Bandeja (staff)** | Identidad por token en el Backoffice (segundo camino en `resolverIdentidadYRol_`), validación de módulo por acción; monta `bandeja` en el shell | Leo/devs pueden trabajar desde la plataforma |
| **P4 — Gerencia + ajuste fino** | Monta `gerencia` y `administracion`; permisos por persona (módulos extra/quitados) desde Administración | Plataforma completa |
| **P5 — Transición** | Crear las cuentas reales (te genero el listado para pegar), período de convivencia, decidir retiro de correo+código y de las páginas antiguas | Migración cerrada |

Cada fase con el ciclo de siempre: tests + verificación en navegador + paquete
de despliegue + commit con tu confirmación. P1+P2 son el mínimo con valor; P3
es la fase con más cuidado (toca la autorización del staff).

Es la reestructuración más grande desde el go-live, pero por fases y con las
páginas viejas siempre operativas de respaldo, el riesgo en cada paso es bajo.

---

## 5. Decisiones que quedan en tu cancha

1. **Alcance de la primera entrega**: ¿P1+P2 (plataforma para solicitantes,
   staff sigue con Google) y evaluar antes de seguir, o comprometer de una las
   5 fases? Recomendación: aprobar P1+P2, decidir P3 con la plataforma andando.
2. **El trade-off de seguridad de P3** (staff con nuestro login vs. Google):
   leer §3 y decidir. La mitigación de mantener las páginas Google de respaldo
   está incluida en cualquier caso.
3. **Formulario público**: ¿se mantiene abierto sin login para siempre
   (recomendado — clientes externos), o a futuro todo entra por la plataforma?
4. **Nombres de usuario**: ¿los defines tú (ej. inicial+apellido: `cpena`,
   `lvilchez`) o cada uno elige al recibir su clave temporal? Recomendación:
   los defines tú — consistencia y cero fricción.
