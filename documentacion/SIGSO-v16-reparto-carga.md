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

### Paso 2.1 — Decidir cuántas cuentas

Empieza con **2 cuentas extra** (3 carriles en total). Es el mejor cambio
por esfuerzo. Se puede subir a 3 extra después con los mismos pasos.

### Paso 2.2 — Crear 2 cuentas de Google

Cuentas nuevas de Gmail, o cuentas de la empresa que no se usen para otra
cosa. Anótalas — aquí las llamo **cuenta-2** y **cuenta-3**.

### Paso 2.3 — Darles acceso a los datos

Con tu cuenta de siempre (la dueña):

1. **El Google Sheet de SIGSO** (el libro con todas las hojas) → botón
   *Compartir* → agregar cuenta-2 y cuenta-3 como **Editor**.

2. **La carpeta de Drive de los adjuntos** → *Compartir* → cuenta-2 y
   cuenta-3 como **Editor**.
   - ¿Cuál carpeta? Su ID está en el proyecto Apps Script del Backoffice:
     *Configuración del proyecto* (el engranaje) → *Propiedades de la
     secuencia de comandos* → valor de `SIGSO_DRIVE_ROOT_FOLDER_ID`.
     Pega ese ID después de `https://drive.google.com/drive/folders/` para
     abrirla.

3. **El proyecto Apps Script del Backoffice** → en el editor, botón
   *Compartir* (arriba a la derecha) → cuenta-2 y cuenta-3 como **Editor**.

> Si tu organización de Google Workspace **bloquea** compartir proyectos de
> Apps Script o crear web apps desde cuentas que no son la dueña, este
> método no te va a funcionar. En ese caso, salta al **Plan B** al final.

### Paso 2.4 — Publicar un despliegue desde cada cuenta extra

Repite esto **una vez por cada cuenta** (cuenta-2, luego cuenta-3):

1. Cierra sesión / abre una ventana de incógnito e **inicia sesión con
   cuenta-2**.
2. Ve a `drive.google.com` → *Compartidos conmigo* → abre el proyecto Apps
   Script del Backoffice (el mismo que compartiste en el paso 2.3.3).
3. *Implementar* → *Nueva implementación*.
4. Engranaje de tipo → **Aplicación web**.
5. Rellena:
   - **Descripción:** `por token — cuenta 2`
   - **Ejecutar como:** **Yo (cuenta-2@…)**  ← esto es lo que crea el carril nuevo
   - **Quién tiene acceso:** **Cualquier persona**
6. *Implementar*. Sale el diálogo de permisos de Google:
   - *Revisar permisos* → elige cuenta-2 → puede aparecer **"Google no
     verificó esta app"** → *Configuración avanzada* → *Ir a … (no seguro)*.
     Es tu propia app; es normal.
   - *Permitir*.
7. Copia la **URL que termina en `/exec`**. Guárdala junto a "cuenta 2".

Al terminar tienes **2 URLs nuevas** (una por cuenta).

### Paso 2.5 — Pegar las URLs en el frontend

Abre `frontend/js/config.js`. Busca `BACKOFFICE_TOKEN_URLS: []` y déjalo así:

```js
  BACKOFFICE_TOKEN_URLS: [
    'https://script.google.com/macros/s/PEGA_AQUI_LA_DE_CUENTA_2/exec',
    'https://script.google.com/macros/s/PEGA_AQUI_LA_DE_CUENTA_3/exec',
  ],
```

Guarda, y desde la carpeta del proyecto:

```bash
git add frontend/js/config.js
git commit -m "config: activar reparto de carga (cuentas 2 y 3)"
git push
```

GitHub Pages lo publica solo en 1–2 minutos. **Desde ahí el reparto está
activo.** No hay que tocar Apps Script para esto.

---

## PARTE 3 — Verificar que quedó bien

1. Entra a la plataforma. Abre la consola del navegador (**F12** →
   *Console*) y escribe:

   ```js
   window.SIGSO_CONFIG.BACKOFFICE_TOKEN_URLS
   ```

   Debe mostrar tus 2 URLs. Si sale `[]`, el push todavía no llegó a Pages
   (espera un minuto y recarga con Ctrl+F5).

2. Usa la plataforma unos minutos (abre Bandeja, Gerencia, Calidad…). Luego:

   ```js
   SigsoPerf.csv()
   ```

   La última columna, `despliegue`, muestra `0`, `1` o `2`. Un mismo
   navegador siempre da el mismo número (reparto estable por usuario). Pídele
   a otra persona que abra la plataforma en su equipo: debería caer en otro
   número → el tráfico se está repartiendo.

3. Que **nadie** vea *"Sesión inválida"* al usar la plataforma. Si una cuenta
   extra da ese error siempre, es que le falta el acceso **Editor al Sheet**
   (Paso 2.3.1). Arréglalo o quita esa URL de `BACKOFFICE_TOKEN_URLS` y haz
   push.

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
tendrías el pase diario corriendo 3 veces, con correos duplicados.

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
