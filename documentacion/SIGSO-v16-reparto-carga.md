# SIGSO v16 — Reparto de carga (destrabar la cola de ejecución)

**Para: Luis. Es una guía de pasos, no de código.** El código ya está hecho y
subido; lo que falta es trabajo en la consola de Google (crear cuentas,
publicar despliegues, pegar URLs).

---

## Qué problema resuelve y por qué esto

Apps Script **serializa** las ejecuciones de una misma cuenta de Google. La
plataforma corre todo su tráfico como **una sola cuenta** (la implementación
"por token"). Con varias personas usándola a la vez, las llamadas hacen cola
y la que queda atrás se pasa del tiempo → *"El servidor tardó demasiado"*.

La solución de **costo $0**: publicar el **mismo** proyecto Backoffice desde
**varias cuentas** de Google, y que el frontend reparta a cada persona entre
ellas. **N cuentas = N carriles en paralelo.**

No es una migración. No se reescribe nada. Si algo sale mal, se quita una URL
de un archivo y se vuelve al estado de hoy.

---

## PARTE 1 — Pegar el backend pendiente (primero esto)

Hay 14 archivos sin pegar, 3 de seguridad, más la medición de rendimiento.
Ya está todo empaquetado y verificado:

    _deploy-fase10/PENDIENTE-2026-09-06/

Abre ese `LEEME.txt` y sigue sus pasos. Es una única "Versión nueva" al
final. **Esto va antes que la Parte 2.**

---

## PARTE 2 — Crear las cuentas y los despliegues extra

> **Qué hace cada carril.** El código reparte **solo las lecturas** entre
> todas las cuentas. **Las escrituras van SIEMPRE a tu cuenta dueña.** Por
> eso las cuentas extra son "carriles de lectura": no mandan correo, no
> generan PDFs, no tocan casi nada más que leer hojas. Eso simplifica sus
> permisos y hace que todo el correo del sistema siga saliendo de una sola
> dirección (la tuya).

---

### Paso 2.1 — Decidir cuántas cuentas

Empieza con **2 cuentas extra** → 3 carriles de lectura en total (la tuya +
2). Es el mejor cambio por esfuerzo. Se puede subir a 3 extra después
repitiendo los mismos pasos.

En esta guía las llamo **cuenta-2** y **cuenta-3**. Tu cuenta de siempre es
la **dueña**.

---

### Paso 2.2 — Crear las 2 cuentas de Google

Opciones, de mejor a peor:

- **Cuentas de tu Workspace de HomePymes** que no se usen para nada más
  (ideal: cuota de envío alta, mismo dominio, administración central).
  Ejemplos: `sigso-exec2@grupohb.cl`, `sigso-exec3@grupohb.cl`.
- **Cuentas nuevas de Gmail gratuitas.** Funcionan, pero: no van a mandar
  correo (eso es solo la dueña), así que su cuota de Gmail no importa aquí.

Para cada una:

1. Créala (o pídela al admin de Workspace).
2. **Inicia sesión al menos una vez** en `mail.google.com` con ella, acepta
   los términos, y déjala lista. Una cuenta recién creada que nunca se abrió
   a veces rechaza compartir recursos.
3. Anota el correo exacto. Los vas a necesitar tres veces cada uno.

---

### Paso 2.3 — Darles acceso a los datos (desde tu cuenta dueña)

Son **tres cosas** que compartir. Hazlas con tu cuenta dueña.

#### 2.3.a — El Google Sheet de SIGSO

1. Abre el libro de Google Sheets de SIGSO (el que tiene todas las hojas:
   `SOLICITUDES`, `SUBSOLICITUDES`, `SGC_*`, etc.).
2. Botón **Compartir** (arriba a la derecha).
3. Escribe el correo de **cuenta-2** → rol **Editor** → quita la casilla
   "Notificar a las personas" si quieres → **Enviar / Compartir**.
4. Repite con **cuenta-3**.

> **Por qué Editor y no Lector:** aunque las cuentas extra solo sirven
> lecturas, el sistema escribe `ultimo_acceso` en la hoja `USUARIOS` en
> casi cada request (limitado a 1 vez cada 10 min por persona). Con permiso
> de solo lectura, esas requests fallarían. Editor es lo correcto.

#### 2.3.b — La carpeta de Drive de los adjuntos

1. Averigua qué carpeta es: abre el proyecto **Apps Script del Backoffice** →
   engranaje **Configuración del proyecto** → sección **Propiedades de la
   secuencia de comandos** → copia el valor de
   **`SIGSO_DRIVE_ROOT_FOLDER_ID`**.
2. Abre `https://drive.google.com/drive/folders/` + ese ID pegado al final.
3. En esa carpeta: clic derecho → **Compartir** → agrega **cuenta-2** y
   **cuenta-3** como **Editor**.

> Algunas lecturas descargan un archivo de Drive (foto de perfil, documento
> del SGC, adjunto de una novedad). Sin este acceso, esas descargas
> concretas fallarían cuando el usuario caiga en una cuenta extra.

#### 2.3.c — El proyecto Apps Script del Backoffice

1. Abre el proyecto **Apps Script del Backoffice**
   (`script.google.com` → tu proyecto).
2. Botón **Compartir** (arriba a la derecha, o el ícono de persona con `+`).
3. Agrega **cuenta-2** y **cuenta-3** como **Editor**.
4. **Enviar**.

> Esto es lo que permite que cuenta-2 y cuenta-3 abran el **mismo** proyecto
> y publiquen su propio despliegue. Un solo código, N despliegues.

> **Si tu Workspace bloquea compartir proyectos de Apps Script** (algunos
> admins lo restringen), este método no funciona → ve al **Plan B** al final
> del documento.

---

### Paso 2.4 — Publicar el despliegue desde cada cuenta extra

Haz esto **una vez con cuenta-2**, luego **otra vez con cuenta-3**.
Recomendado: usa una **ventana de incógnito** para no mezclar sesiones.

1. Abre una ventana de **incógnito** e inicia sesión **solo con cuenta-2**.
2. Ve a `script.google.com` → menú lateral → **Mis proyectos** →
   pestaña **Compartidos conmigo** → abre el proyecto del Backoffice.
   - Si no aparece: entra por `drive.google.com` → **Compartidos conmigo** →
     busca el archivo del proyecto (ícono de Apps Script) → doble clic.
3. Arriba a la derecha: **Implementar** → **Nueva implementación**.
4. En el diálogo, clic en el **engranaje** junto a "Seleccionar tipo" →
   elige **Aplicación web**.
5. Completa:
   | Campo | Valor |
   |---|---|
   | **Descripción** | `por token — carril lectura cuenta-2` |
   | **Ejecutar como** | **Yo (`cuenta-2@…`)** — este es el punto clave, crea el carril nuevo |
   | **Quién tiene acceso** | **Cualquier persona** |
6. **Implementar**.
7. Aparece el diálogo de **autorización**:
   - **Autorizar acceso** → elige **cuenta-2**.
   - Si sale **"Google no verificó esta aplicación"**:
     **Configuración avanzada** → **Ir a … (no seguro)**. Es tu propia app;
     es esperable en apps internas sin verificar.
   - Revisa los permisos que pide (Sheets, Drive, Gmail, conexión a
     servicios externos) → **Permitir**.

   > La cuenta extra autoriza Gmail también, aunque **no** vaya a mandar
   > correo desde el uso normal (las escrituras que disparan correo van a la
   > dueña). Es solo porque el proyecto declara ese permiso en su manifiesto;
   > autorizarlo no envía nada.

8. Copia la **URL de la aplicación web** (termina en **`/exec`**).
   Guárdala rotulada: `cuenta-2 → https://…/exec`.
9. **Cierra la ventana de incógnito.** Abre otra nueva y repite 1–8 con
   **cuenta-3**.

Al terminar tienes **2 URLs `/exec` nuevas**, una por cuenta.

> **No ejecutes ninguna función** desde estas cuentas (ni `configurarTriggers`,
> ni el Instalador, ni nada). Solo se publica el despliegue y se copia la URL.

---

### Paso 2.5 — Pegar las URLs en el frontend

1. Abre `frontend/js/config.js`.
2. Busca la línea `BACKOFFICE_TOKEN_URLS: [],` y déjala así (con **tus** URLs
   reales del paso 2.4, respetando las comas y las comillas):

```js
  BACKOFFICE_TOKEN_URLS: [
    'https://script.google.com/macros/s/AKfycb...CUENTA_2.../exec',
    'https://script.google.com/macros/s/AKfycb...CUENTA_3.../exec',
  ],
```

3. Guarda. Desde la carpeta del proyecto, en una terminal:

```bash
git add frontend/js/config.js
git commit -m "config: activar reparto de carga (cuentas 2 y 3)"
git push
```

4. GitHub Pages publica solo en 1–2 minutos. **Desde ese momento el reparto
   está activo.** No hay que tocar Apps Script para esto — el frontend elige
   la URL.

> **Importante para el orden de trabajo:** haz este paso 2.5 **al final**,
> cuando las 2 cuentas ya tengan su despliegue funcionando (Parte 3). Si
> pegas una URL que todavía no autorizó permisos, los usuarios que caigan en
> esa cuenta verán errores hasta que la arregles.

---

## PARTE 3 — Verificar que quedó bien

### 3.1 — Probar cada despliegue nuevo ANTES de pegarlo en config.js

Por cada URL `/exec` del paso 2.4, ábrela **tal cual en el navegador** (una
petición GET simple, sin parámetros):

    https://script.google.com/macros/s/…CUENTA_2…/exec

Debe responder este JSON, sin pedir login:

    {"ok":true,"data":{"servicio":"SIGSO Backoffice","estado":"activo"}}

- Si en vez de eso ves una **página de login de Google** o *"Necesitas
  acceso"* → el despliegue no quedó como **"Acceso: cualquier persona"**
  (rehaz el paso 2.4).
- Si ves un **error de permisos** al usar la plataforma después → falta
  compartir el Sheet (2.3.a) o la carpeta de Drive (2.3.b) con esa cuenta.
  Este GET simple no lo detecta porque no toca datos.

### 3.2 — Activar y comprobar el reparto

1. Ya con las URLs pegadas y el push hecho (paso 2.5), entra a la
   plataforma. Consola del navegador (**F12** → *Console*):

   ```js
   window.SIGSO_CONFIG.BACKOFFICE_TOKEN_URLS
   ```

   Debe mostrar tus 2 URLs. Si sale `[]`, el push aún no llegó a Pages
   (espera un minuto, recarga con **Ctrl+F5**).

2. Usa la plataforma unos minutos (Bandeja, Gerencia, Calidad, Proyectos…).
   Luego:

   ```js
   SigsoPerf.csv()
   ```

   Mira la última columna, **`despliegue`**:
   - En las **lecturas** (`getInicio`, `getDashboardData`, `listar…`,
     `getPanel…`) debe mostrar `0`, `1` o `2`. Un mismo navegador da
     **siempre el mismo número** (reparto estable por usuario).
   - En las **escrituras** (`actualizarEstado`, `comprometerFecha`,
     `guardar…`) debe mostrar **siempre `0`** (van a la cuenta dueña).
   - Pídele a otra persona que abra la plataforma en su equipo: en sus
     lecturas debería salir **otro número** → el tráfico se reparte.

3. Que **nadie** vea *"Sesión inválida"* ni *"El servidor respondió algo
   inesperado"* al usar la plataforma normal. Si pasa **solo con ciertos
   usuarios** (los que caen en una cuenta extra), esa cuenta tiene mal el
   acceso al Sheet (2.3.a) o el despliegue (2.4). Arréglala, o **quita su
   URL** de `BACKOFFICE_TOKEN_URLS` y haz push — el reparto sigue con las que
   queden.

---

## PARTE 4 — El costo permanente (léelo, importa)

**Cada vez que pegues código nuevo del Backoffice**, ahora hay que subir la
versión en **cada despliegue por token**: el tuyo **y** el de cada cuenta
extra. En cada cuenta:

> *Implementar* → *Gestionar implementaciones* → lápiz (editar) → *Versión* →
> *Nueva versión* → *Implementar*.

Si te saltas una, esa cuenta sigue sirviendo la versión vieja y los usuarios
que caigan ahí verán el aviso naranjo de "falta pegar…". No es grave, pero
hay que hacerlo.

**Los triggers de tiempo (pase diario, correos, digests) se quedan SOLO en
tu cuenta.** **No ejecutes `configurarTriggers()` desde las cuentas extra** —
tendrías el pase diario corriendo 3 veces, con correos duplicados. Las
cuentas extra solo publican un despliegue; nunca se ejecuta nada en ellas.

**El correo sigue saliendo de una sola dirección (la tuya).** El código
manda las escrituras — que son las que disparan notificaciones — siempre a
la cuenta dueña, así que ningún correo sale nunca desde `cuenta-2` ni
`cuenta-3`. Si más adelante alguien mueve esa lógica, revísalo: el
remitente se volvería inconsistente.

**Para desactivar el reparto:** vacía `BACKOFFICE_TOKEN_URLS: []` y haz push.
Vuelve al estado de hoy al instante. Las cuentas y despliegues extra pueden
quedar creados sin hacer daño.

---

## PARTE 5 — Después de una semana

Con el reparto activo y la plataforma en uso normal ~7 días, en la consola de
quien más la usa:

```js
SigsoPerf.resumen()
```

Mándame lo que imprime (o `SigsoPerf.csv()` para el detalle). Ahí se ve:

- Si el `overhead` (cola + red) **bajó** → el reparto funcionó, y quizás con
  eso alcanza.
- Si el `io Sheets` sigue alto incluso sin cola → toca el **Tier 2**:
  cachear en memoria las hojas frías (roles, catálogos, feriados) que hoy se
  releen en cada request.
- Si la columna `despliegue` muestra que **una** cuenta es mucho más lenta
  que las otras → esa implementación quedó mal (versión vieja, o permisos), y
  se revisa solo esa.

---

## Plan B — si Workspace bloquea el método de arriba

Si no puedes compartir el proyecto Apps Script ni crear web apps desde las
cuentas extra:

1. Con cada cuenta extra: abre el proyecto Backoffice compartido →
   *Descripción general* → **"Crear una copia"**.
2. En la copia: *Configuración del proyecto* → *Propiedades de la secuencia
   de comandos* → agrega **las mismas** `SIGSO_SHEET_ID` y
   `SIGSO_DRIVE_ROOT_FOLDER_ID` que tiene el original.
3. Despliega la copia como *Aplicación web* / *Ejecutar como: Yo* / *Acceso:
   Cualquiera*. Copia la URL `/exec`.
4. Pega las URLs en `BACKOFFICE_TOKEN_URLS` igual que en el Paso 2.5.

**Costo:** ahora son 3 proyectos separados. Cada paste de código hay que
hacerlo en los 3. Es bastante más trabajo — si llegas a este plan B,
conviene primero probar si el **Tier 2** (cachear hojas frías, sin cuentas
extra) ya resuelve lo suficiente.
