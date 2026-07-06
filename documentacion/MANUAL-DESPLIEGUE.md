# Manual de despliegue — de este repositorio a SIGSO operativo

Guía paso a paso para: subir el código a GitHub, publicar el frontend,
crear la Google Sheet real, crear los 3 proyectos de Apps Script, dejar
todo conectado, y arrancar las primeras pruebas. Está pensado para
seguirse en orden, de arriba hacia abajo, sin saltarse pasos.

Tiempo estimado: 1-2 horas la primera vez.

---

## Paso 0 — Arreglar la ubicación del repositorio Git (IMPORTANTE, hacer primero)

Se detectó que el repositorio Git actual **no está dentro de la carpeta
`SIGSO`**, sino en la raíz de tu carpeta de usuario de Windows
(`C:\Users\luis1`). Esto es un problema real: si en ese estado se hiciera
`git add .`, Git intentaría empezar a rastrear todo tu perfil de Windows
(`AppData`, `Documents`, `NTUSER.DAT`, etc.), no solo el proyecto SIGSO.

El remoto ya está bien configurado (`https://github.com/luis11cesar11lm-dot/Formulario-HomePymes-1.git`),
así que solo hay que mover el repositorio al lugar correcto. Ejecuta esto
en una terminal (Git Bash o PowerShell), **sin borrar nada todavía**:

```bash
# 1. Confirma que el repo actual esta en la raiz del usuario (no en SIGSO)
cd ~
git rev-parse --show-toplevel   # deberia mostrar C:/Users/luis1, eso es el problema

# 2. Anota el remoto para no perderlo (ya lo sabemos, pero por si acaso)
git remote -v

# 3. Elimina SOLO la carpeta .git de la raiz del usuario (esto NO borra
#    ningun archivo tuyo, solo el historial de git mal ubicado; como no
#    hay commits todavia -- "No commits yet" -- no se pierde ningun trabajo)
rm -rf ~/.git

# 4. Ve a la carpeta del proyecto e inicializa el repo ahi, que es donde
#    debio estar desde el principio
cd "C:/Users/luis1/OneDrive/Desktop/SIGSO"
git init
git remote add origin https://github.com/luis11cesar11lm-dot/Formulario-HomePymes-1.git
```

Verifica que quedó bien:

```bash
git rev-parse --show-toplevel   # ahora debe mostrar la ruta de SIGSO
git status                       # debe listar solo archivos del proyecto SIGSO
```

> Si prefieres que yo ejecute estos comandos por ti en vez de hacerlo tú
> mismo, dímelo antes de continuar y lo hago.

---

## Paso 1 — Primer commit y subida a GitHub

Desde la carpeta `SIGSO`:

```bash
git add .
git commit -m "SIGSO: version completa Fases 0-8"
git branch -M main
git push -u origin main
```

Si el repositorio de GitHub ya tiene contenido (por ejemplo, si lo creaste
con un README inicial desde la web), puede que `git push` rechace el push.
En ese caso:

```bash
git pull origin main --allow-unrelated-histories
# resolver conflictos si aparecen (poco probable, el repo estaba vacio)
git push -u origin main
```

---

## Paso 2 — Activar GitHub Pages para el frontend

El frontend vive en `frontend/`, no en la raíz del repo, así que GitHub
Pages necesita un paso extra (no puede servir una subcarpeta directamente
sin ayuda). Ya dejé preparado un workflow de GitHub Actions para esto:
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) — publica
automáticamente el contenido de `frontend/` cada vez que se hace push a
`main`.

Para activarlo:

1. En GitHub, entra al repositorio → **Settings** → **Pages** (menú
   izquierdo, bajo "Code and automation").
2. En "Build and deployment" → **Source**, selecciona **GitHub Actions**
   (no "Deploy from a branch").
3. Guarda. No hace falta configurar nada más ahí: el workflow ya está en
   el repo.
4. Ve a la pestaña **Actions** del repositorio: deberías ver correr el
   workflow "Publicar frontend en GitHub Pages" automáticamente (se activó
   con el push del Paso 1). Espera a que termine en verde (~1 minuto).
5. Al terminar, en **Settings → Pages** aparecerá la URL pública, algo
   como `https://luis11cesar11lm-dot.github.io/Formulario-HomePymes-1/`.
   Anótala — la necesitarás para probar el sistema al final.

> Nota: en cada push posterior que toque archivos de `frontend/`, el sitio
> se vuelve a publicar solo, sin que tengas que hacer nada manual.

---

## Paso 3 — Crear la Google Sheet real

1. Entra a [sheets.google.com](https://sheets.google.com) con la cuenta
   Google (idealmente de Workspace) que va a ser la dueña del sistema.
2. Crea una hoja de cálculo nueva en blanco. Nómbrala, por ejemplo,
   `SIGSO - Base de Datos`.
3. En la URL de la hoja, copia el ID: es la parte larga entre `/d/` y
   `/edit`, por ejemplo:
   `https://docs.google.com/spreadsheets/d/`**`1AbCdEfGhIjKlMnOpQrStUvWxYz`**`/edit`
4. Guarda ese ID en un lugar a mano — lo vas a pegar 3 veces (Setup,
   Intake, Backoffice).

No hace falta crear las hojas/columnas a mano: eso lo hace
`backend/setup/Instalador.gs` en el Paso 5.

---

## Paso 4 — Crear la carpeta raíz en Google Drive

1. En [drive.google.com](https://drive.google.com), crea una carpeta nueva
   llamada `SIGSO_Sistema`.
2. Ábrela y copia su ID de la URL (misma lógica que el paso anterior, la
   parte después de `/folders/`).
3. Guarda ese ID también — se usa en Intake y Backoffice (no en Setup).

---

## Paso 5 — Proyecto Apps Script "Setup" (crea las hojas una sola vez)

Este proyecto solo se usa una vez, para crear todas las hojas con sus
columnas. Después de correrlo, puedes archivarlo o dejarlo — no se
publica como Web App.

1. Desde la Google Sheet del Paso 3: menú **Extensiones → Apps Script**.
   Esto crea un proyecto ya enlazado a esa hoja (mejor que crear uno suelto
   desde script.google.com, porque así `SpreadsheetApp.getActive()` no
   haría falta y evitamos confusiones — aunque este código usa
   `SpreadsheetApp.openById` de todos modos, así que también funcionaría
   un proyecto standalone).
2. Borra el contenido del archivo `Code.gs` que Apps Script crea por
   defecto.
3. Copia el contenido de estos 3 archivos del repo, cada uno en un archivo
   nuevo del editor con el mismo nombre (botón "+" junto a "Archivos"):
   - `backend/setup/Config.gs`
   - `backend/setup/Instalador.gs`
4. En el editor, abre **Configuración del proyecto** (ícono de engranaje) →
   marca **"Mostrar archivo de manifiesto 'appsscript.json' en el editor"**.
   Abre `appsscript.json` y reemplaza su contenido por el de
   `backend/setup/appsscript.json` del repo.
5. Ve a **Configuración del proyecto → Propiedades del script** → **Añadir
   propiedad del script**:
   - `SIGSO_SHEET_ID` = el ID del Paso 3.
6. Vuelve al editor, selecciona la función `instalarHojas` en el desplegable
   de funciones (arriba), y presiona **Ejecutar**. La primera vez pedirá
   autorización — acéptala (es tu propia cuenta, tu propia hoja).
7. Verifica: vuelve a la Google Sheet, refresca — deberían aparecer todas
   las hojas (`SOLICITUDES`, `SUBSOLICITUDES`, `CAT_TIPOS` ya con sus 7
   tipos cargados, `CONFIG_SLA` ya con los tiempos por prioridad, etc.).

Si algo falla, revisa el log de ejecución (icono de reloj/"Ejecuciones" en
el editor) para ver el error exacto.

---

## Paso 6 — Proyecto Apps Script "Intake" (App Pública)

1. En [script.google.com](https://script.google.com), **Nuevo proyecto**.
   Nómbralo `SIGSO - Intake`.
2. Borra el `Code.gs` por defecto. Copia, uno por uno (mismo nombre de
   archivo, sin la extensión `.gs` al nombrarlo en el editor — Apps Script
   la agrega solo), todos los archivos de `backend/intake/`:
   - `Config.gs`, `Constantes.gs`, `SheetsRepo.gs`, `Correlativo.gs`,
     `Notificaciones.gs`, `Solicitudes.gs`, `Catalogos.gs`, `DriveRepo.gs`,
     `Drive.gs`, `Code.gs`
3. Manifiesto: igual que el Paso 5.5, activa la vista del manifiesto y
   reemplaza `appsscript.json` por el de `backend/intake/appsscript.json`
   (ya trae `"access": "ANYONE_ANONYMOUS"`, `"executeAs": "USER_DEPLOYING"`
   — acceso público anónimo, ejecutado como tú).
4. Propiedades del script (mismo lugar que el Paso 5.5):
   - `SIGSO_SHEET_ID` = ID del Paso 3.
   - `SIGSO_DRIVE_ROOT_FOLDER_ID` = ID del Paso 4.
   - `SIGSO_TIMEZONE` = `America/Santiago` (opcional, ya es el default).
5. **Implementar → Nueva implementación**:
   - Tipo: **Aplicación web**.
   - Descripción: `Intake v1`.
   - Ejecutar como: **Yo (tu cuenta)**.
   - Quién tiene acceso: **Cualquier usuario**.
   - Presiona **Implementar**, autoriza si te lo pide.
6. Copia la **URL de la aplicación web** que te muestra (termina en
   `/exec`). Esa es tu `INTAKE_URL`.

---

## Paso 7 — Proyecto Apps Script "Backoffice" (App Gestión)

Igual que el Paso 6, pero:

1. Nuevo proyecto, nómbralo `SIGSO - Backoffice`.
2. Copia todos los archivos de `backend/backoffice/`:
   - `Config.gs`, `Constantes.gs`, `SheetsRepo.gs`, `Utils.gs`,
     `DriveRepo.gs`, `Notificaciones.gs`, `Documentos.gs`, `Solicitudes.gs`,
     `Dashboard.gs`, `Comentarios.gs`, `Catalogos.gs`, `Auth.gs`,
     `Triggers.gs`, `Code.gs`
3. Manifiesto: reemplaza por `backend/backoffice/appsscript.json` (trae
   `"access": "DOMAIN"`, `"executeAs": "USER_ACCESSING"` — solo usuarios
   del dominio de Google Workspace, cada uno ejecuta con su propia
   identidad).

   > Si HomePymes/RLD **no** tiene Google Workspace (cuentas @tudominio.com
   > administradas), sino cuentas Gmail normales, `"access": "DOMAIN"` no
   > va a funcionar — no hay dominio que reconocer. En ese caso, cambia a
   > `"access": "ANYONE"` (cualquiera con cuenta Google, no anónimo) y
   > gestiona el control de acceso completamente vía la hoja `USUARIOS`
   > (que ya es como funciona el control de roles en este sistema, `Code.gs`
   > ya rechaza a cualquier email que no esté en `USUARIOS` con `activo=true`).
4. Mismas 3 Propiedades del script que el Paso 6.4 (mismo Sheet ID, mismo
   Drive folder ID).
5. **Implementar → Nueva implementación** → Aplicación web:
   - Ejecutar como: **El usuario que accede a la aplicación web**.
   - Quién tiene acceso: **Cualquier usuario de [tu dominio]** (o "Cualquier
     usuario con una Cuenta de Google" si usaste `ANYONE` arriba).
   - Implementar, copiar la URL `/exec` → esa es tu `BACKOFFICE_URL`.
6. En el editor, selecciona la función `configurarTriggers` en el
   desplegable de funciones y **Ejecútala una sola vez**. Esto instala los
   7 triggers de tiempo (cola de documentos, cola de correo, verificación
   de SLA, refresco de cache, suspensión de inactivos, resumen semanal,
   reporte mensual). Verifica en el ícono de reloj ("Triggers") del editor
   que aparezcan 7 entradas.

---

## Paso 8 — Conectar el frontend a las URLs reales

1. Edita `frontend/js/config.js` en tu copia local del repo:

```js
window.SIGSO_CONFIG = Object.freeze({
  INTAKE_URL: 'https://script.google.com/macros/s/TU_ID_DE_INTAKE/exec',
  BACKOFFICE_URL: 'https://script.google.com/macros/s/TU_ID_DE_BACKOFFICE/exec',
  TIMEZONE: 'America/Santiago'
});
```

Pega las URLs reales de los Pasos 6.6 y 7.5.

2. Commitea y sube el cambio:

```bash
git add frontend/js/config.js
git commit -m "config: URLs reales de Intake/Backoffice"
git push
```

El workflow de GitHub Pages (Paso 2) va a republicar el sitio solo en
cuanto detecte el push.

---

## Paso 9 — Prueba de humo del contrato CORS (antes de seguir)

Antes de cargar datos reales, confirma que ambos Web Apps responden al
contrato `text/plain` sin errores de CORS. Desde cualquier terminal con
`curl`, o pegando esto en la consola del navegador (F12):

```js
fetch('TU_INTAKE_URL', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'ping', data: {} })
}).then(r => r.json()).then(console.log);
```

*(Nota: `ping` existe en Backoffice; si Intake no tiene una acción `ping`,
usa `{ action: 'getCatalogos', data: {} }` en su lugar — cualquier
respuesta con `ok: true` o `ok: false` pero **sin** error de red confirma
que el contrato CORS funciona).*

Repite contra `TU_BACKOFFICE_URL` con `{ action: 'ping', data: {} }` —
debería responder `ok:false, error:"forbidden"` si tu cuenta todavía no
está en `USUARIOS` (eso es correcto y esperado en este punto, lo resuelves
en el Paso 10).

Si en vez de eso ves un error de red / CORS bloqueado en la consola del
navegador, algo quedó mal configurado en el Paso 6 o 7 (revisa
"Quién tiene acceso" de la implementación).

---

## Paso 10 — Cargar datos iniciales reales

Con `CAT_TIPOS` y `CONFIG_SLA` ya poblados por el instalador (Paso 5), falta
cargar a mano, directamente en la Google Sheet (edición directa de filas,
es la forma más rápida para la carga inicial — después ya se administra
desde `admin.html`):

1. **`USUARIOS`**: agrega al menos 2 filas con rol `ADM` por empresa (tú
   mismo y otra persona), más los Analistas/Desarrolladores reales.
   Columnas: `usuario_id` (cualquier texto único), `nombre`, `email` (el
   real de Google de esa persona), `empresa_id` (código corto que tú
   definas, ej. `HP`/`RLD`), `rol` (`ANA`/`DEV`/`ADM`), `activo` (`TRUE`),
   `ultimo_acceso` (vacío), `creado_por` (tu email).
2. **`CAT_EMPRESAS`**: una fila por empresa (`empresa_id`, `nombre`, `logo`
   opcional, `activo=TRUE`).
3. **`CAT_PLATAFORMAS`**: una fila por plataforma real (`plataforma_id`,
   `nombre`, `empresa_id` de la fila anterior, `url_base` opcional,
   `activo=TRUE`).
4. **`CAT_MODULOS`**: una fila por módulo real (`modulo_id`, `nombre`,
   `plataforma_id`, `activo=TRUE`).
5. **`CONFIG_FERIADOS`**: una fila por feriado de Chile del año en curso
   (`fecha` en formato `YYYY-MM-DD`, `nombre`, `anio`).

A partir de aquí, empresas/plataformas/módulos/usuarios adicionales ya se
pueden cargar desde `admin.html` sin tocar la hoja directamente.

---

## Paso 11 — Empezar a probar

1. Abre la URL pública de GitHub Pages (Paso 2.5), por ejemplo
   `https://tuusuario.github.io/Formulario-HomePymes-1/index.html`.
2. **Como solicitante (sin login)**: llena el formulario de una solicitud
   de prueba y envíala. Verifica: aparece en `SOLICITUDES` de la hoja,
   llega el correo de acuse de recibo, y `estado.html` permite consultarla
   por número + correo.
3. **Como Analista** (con tu cuenta Google, la que agregaste con rol `ANA`
   en el Paso 10): abre `app.html`, verifica que la solicitud aparece en el
   dashboard, ábrela y avánzala: `S02 → S03 → S04` (aprobar). Espera hasta
   5 minutos (o ejecuta manualmente `procesarColaDocumentosTrigger` desde
   el editor de Apps Script de Backoffice) y confirma que se generó el
   documento (`url_pdf` se llena en la hoja, y llega el correo al
   Desarrollador).
4. **Como Desarrollador**: avanza `S04 → S05 → S07` (a pruebas).
5. **Como Analista de nuevo**: `S07 → S08 → S09` (cierre). Confirma en el
   dashboard que ya no aparece como abierta.
6. **Como Admin**: abre `admin.html` → pestaña "Automatizaciones" y
   confirma que ves los logs de todas las notificaciones enviadas en la
   prueba anterior.
7. Repite un ciclo corto para la segunda empresa (RLD) y confirma que el
   dashboard filtra correctamente por empresa.

Si algo no funciona en producción pero sí en `npm test` /
`node backend/dev-server*.js`, casi siempre es una de estas 3 causas:
Script Properties mal escritas (revisa que los 3 nombres sean EXACTOS:
`SIGSO_SHEET_ID`, `SIGSO_DRIVE_ROOT_FOLDER_ID`, `SIGSO_TIMEZONE`), el
manifiesto (`appsscript.json`) no se guardó bien, o falta volver a
**Implementar → Gestionar implementaciones → Editar → Nueva versión**
después de cambiar código (Apps Script no actualiza la URL `/exec` con el
código nuevo hasta que creas una nueva versión de la implementación).

---

## Resumen de lo que necesitas tener a mano al terminar

| Dato | De dónde sale |
|---|---|
| `SIGSO_SHEET_ID` | Paso 3 |
| `SIGSO_DRIVE_ROOT_FOLDER_ID` | Paso 4 |
| `INTAKE_URL` | Paso 6.6 |
| `BACKOFFICE_URL` | Paso 7.5 |
| URL pública del frontend | Paso 2.5 |

Con esto, SIGSO queda operativo de punta a punta y listo para las pruebas
reales con HomePymes/RLD.
