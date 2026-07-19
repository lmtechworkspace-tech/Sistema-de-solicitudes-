# SIGSO v3.2 — Propuesta: portal personal con usuario y contraseña

**Estado: SUPERADA.** Esta propuesta creció a algo más ambicioso — una
plataforma modular completa por tipo de usuario. Ver
`SIGSO-v3.3-propuesta-plataforma-modular.md`, que absorbe todo lo de aquí
(cuentas, multi-correo, sesiones) y agrega la capa de módulos. Se conserva
este archivo solo como historia de la decisión.

## 1. El problema real

La necesidad expresada: que cada persona ingrese con usuario y contraseña a un
apartado personal donde vea solo lo suyo, sin depender del correo, porque en la
empresa cada persona maneja varios correos y eso ya causó problemas de acceso.

Al revisar el código, el problema es más profundo que el método de login:

- Hoy "Mis solicitudes" identifica a la persona por **un** correo
  (`misSolicitudes` filtra por coincidencia exacta con `solicitante_email` /
  `correo_cliente`).
- Si Camila ingresó solicitudes con `camila@gde.cl` y otras con
  `camila.pena@gmail.com`, **no existe ninguna forma** de verlas juntas: son dos
  identidades distintas para el sistema.
- El código de acceso por correo agrava esto: llega al correo que se escriba,
  y hay que repetir el proceso por cada correo que la persona use.

**Conclusión de diseño:** la solución no es solo cambiar "correo+código" por
"usuario+contraseña". Es separar la **identidad** (la persona: una cuenta) de
los **correos** (que pasan a ser un atributo de la cuenta, y puede haber
varios). Con eso, una cuenta ve las solicitudes de *todos* sus correos.

## 2. Factibilidad dentro del ecosistema gratuito

**Sí es 100% factible con lo que ya existe** — Apps Script + Google Sheets +
GitHub Pages — sin agregar servicios, extensiones ni costos:

| Pieza necesaria | Con qué se resuelve |
|---|---|
| Guardar cuentas y contraseñas | Hoja nueva en el mismo Sheets (patrón `USUARIOS`) |
| Hashear contraseñas (nunca en texto plano) | `Utilities.computeDigest(SHA_256)` con sal + iteraciones — nativo de Apps Script |
| Sesiones (mantener el login) | Token UUID guardado en hoja `SESIONES_PORTAL` + `CacheService`; el navegador lo guarda en `localStorage` |
| Pantalla de login | Página nueva en el frontend estático (GitHub Pages), mismo patrón que estado.html |
| Transporte seguro | Ya existe: GitHub Pages y script.google.com sirven todo por HTTPS |

### 2.1 ¿Y una "extensión de Google" (Google Sign-In / OAuth)?

Se evaluó y **se descarta**, por tres razones:

1. **Empeoraría el problema de fondo**: Google Sign-In ata la identidad a UNA
   cuenta de Google = un correo. Es exactamente la limitación que se quiere
   eliminar.
2. Requiere que cada persona tenga cuenta Google con el correo que usa — no
   siempre es cierto con correos corporativos variados.
3. Configurar OAuth propio (Google Cloud Console, pantalla de consentimiento,
   verificación de dominio) agrega complejidad administrativa sin resolver el
   multi-correo.

El único lugar donde el login de Google sí es la herramienta correcta es el
**Backoffice** (app.html/admin.html), que ya funciona así vía HtmlService y
**no se toca**: el staff (Leo, Luis, Bárbara como gestores) tiene pocas cuentas,
controladas, y ese login es más fuerte que cualquiera que podamos construir.

## 3. Diseño propuesto

### 3.1 Modelo de datos (aditivo, como siempre)

**Hoja nueva `CUENTAS_PORTAL`:**

| Columna | Nota |
|---|---|
| `cuenta_id` | UUID |
| `usuario` | Nombre de usuario para el login (ej. `cpena`). Único, sin distinguir mayúsculas |
| `nombre` | Nombre completo (se muestra en el portal: "Hola, Camila") |
| `hash_password` | SHA-256 iterado con sal. **Nunca la contraseña en claro** |
| `salt` | Sal aleatoria por cuenta |
| `emails` | **La clave de todo**: lista JSON de correos asociados (ej. `["camila@gde.cl","camila.pena@gmail.com"]`). El portal muestra las solicitudes de TODOS |
| `empresa_id` | Informativo/filtro |
| `activo` | TRUE/FALSE — desactivar sin borrar |
| `debe_cambiar_password` | TRUE cuando el Admin crea la cuenta o resetea la clave: al primer ingreso se obliga a elegir una propia |
| `ultimo_acceso` / `creado_por` | Trazabilidad, igual que `USUARIOS` |

**Hoja nueva `SESIONES_PORTAL`:**

| Columna | Nota |
|---|---|
| `token` | UUID que el navegador guarda y presenta en cada llamada |
| `cuenta_id` | A quién pertenece |
| `expira` | ISO datetime (propuesto: 12 horas) |
| `creada` | — |

### 3.2 Flujo del usuario

```
1. Entra a portal.html (o pestaña "Mi portal" en Consultar estado)
2. Usuario + contraseña → [Ingresar]
3. Backend valida hash → crea token de sesión → lo devuelve
4. El navegador guarda el token; desde ahí, cada consulta viaja con el token
5. El portal muestra: sus solicitudes (de todos sus correos), acciones
   pendientes (validar cierres, responder consultas), y su historial
6. La sesión dura 12 h o hasta [Cerrar sesión]
```

Primer ingreso: el Admin crea la cuenta con una **clave temporal** que entrega
por WhatsApp/en persona; el sistema obliga a cambiarla al primer login.

¿Olvidó su contraseña? Dos caminos (coexisten):
- Le pide al Admin un reseteo (clave temporal nueva) — el camino simple.
- Autoservicio opcional: "olvidé mi contraseña" manda un código de un solo uso
  a cualquiera de sus correos asociados (reutiliza el mecanismo de código que
  ya existe, pero ahora contra la cuenta, no contra un correo suelto).

### 3.3 Qué NO cambia (esto responde a "¿variaría mucho el flujo?")

| Superficie | Cambio |
|---|---|
| **Formulario público** (crear solicitud) | **Ninguno.** Sigue abierto, sin login — cualquiera puede ingresar una solicitud, igual que hoy. Opcional (fase 2): si estás logueado, autocompleta tus datos de solicitante |
| **Consultar estado por número + correo** | **Ninguno.** Sigue existiendo tal cual (útil para quien consulta una vez y no quiere cuenta) |
| **Backoffice** (Leo, gestores) | **Ninguno.** Sigue con login de Google |
| **Mis solicitudes** | **Aquí vive el cambio**: pasa de correo+código a usuario+contraseña, y muestra lo de todos tus correos |

O sea: el flujo NO varía para ingresar solicitudes ni para el staff. El cambio
se concentra en un solo lugar — el apartado personal — que es justamente donde
está el dolor. La transición puede ser gradual: el correo+código puede
mantenerse un tiempo como respaldo y retirarse cuando todos tengan cuenta.

### 3.4 Administración

En el panel de Administración (admin.html), sección nueva "Cuentas del portal":
- Crear cuenta (usuario, nombre, correos asociados, clave temporal).
- Editar correos asociados (agregar/quitar un correo a una cuenta existente).
- Resetear contraseña / desactivar cuenta.
- Solo rol ADM.

**No hay auto-registro.** Las cuentas las crea el Admin porque los usuarios del
portal son un grupo conocido y chico (las jefaturas: Camila, Lisseth, Bárbara,
Felipe...). El auto-registro abriría la puerta a cuentas basura y exigiría
verificación de correo — complejidad sin beneficio para este caso.

### 3.5 Seguridad — evaluación honesta

Lo que este diseño garantiza:
- Contraseñas **nunca en texto plano** (hash con sal + iteraciones).
- Todo viaja por **HTTPS** (dado por GitHub Pages y Apps Script).
- Tokens de sesión con expiración y revocables (cerrar sesión / desactivar cuenta).
- **Freno anti fuerza bruta**: tras 5 intentos fallidos, la cuenta se bloquea
  10 minutos (contador en CacheService).
- El Sheets solo lo ve el staff con acceso al archivo, igual que hoy.

Lo que hay que decir con franqueza:
- Apps Script no tiene bcrypt/argon2 (los algoritmos ideales para contraseñas);
  SHA-256 iterado con sal es lo mejor disponible en la plataforma y es
  **adecuado para este caso**, porque lo que protege el portal son datos de
  solicitudes internas — no dinero, no credenciales de terceros, no datos de
  clientes sensibles (los datos del cliente ya viajan en las solicitudes que
  el mismo usuario ingresó).
- Es un login más débil que el de Google (sin 2FA). Por eso el Backoffice del
  staff NO se migra a este esquema.
- Regla operativa: la clave del portal no debe reutilizar la clave del correo
  ni de otros sistemas de la empresa (se indica en la pantalla de cambio).

Para el nivel de riesgo del portal (ver mis solicitudes y validar cierres),
este balance es razonable y es el estándar de facto en este tipo de sistemas
internos.

## 4. Plan de implementación propuesto (si se aprueba)

| Fase | Contenido | Tamaño relativo |
|---|---|---|
| **1. Backend de cuentas** | Hojas `CUENTAS_PORTAL`/`SESIONES_PORTAL` (3 copias del esquema), módulo `Portal.gs` en Intake: `login`, `logout`, `cambiarPassword`, validación de token; `misSolicitudes` acepta token y filtra por TODOS los correos de la cuenta | El grueso |
| **2. Frontend del portal** | Pantalla de login + "Mi portal" (reutiliza el render de Mis solicitudes que ya existe), manejo de sesión en localStorage, cerrar sesión, cambio de clave obligatorio al primer ingreso | Mediano |
| **3. Administración** | CRUD de cuentas en admin.html (solo ADM) | Chico |
| **4. Transición** | Crear las cuentas reales con sus correos asociados (te genero la lista para pegar, como los catálogos); correo+código queda como respaldo hasta que decidas retirarlo | Chico |

Todo aditivo: nada de lo existente se rompe si el portal aún no tiene cuentas.
Mismo ciclo de siempre: tests + verificación en navegador + paquete de
despliegue + commit con tu confirmación.

## 5. Decisiones abiertas (para cuando apruebes)

1. **¿Retirar el correo+código al final, o dejarlo permanente como vía
   alternativa?** Recomendación: dejarlo un tiempo y decidir con uso real.
2. **¿"Olvidé mi contraseña" autoservicio (código al correo) o solo reseteo
   por Admin?** Recomendación: partir solo con Admin (son pocos usuarios) y
   agregar autoservicio si molesta.
3. **¿El login autocompleta el formulario de nueva solicitud?** Recomendación:
   sí, pero como fase 2 — no es parte del mínimo.
