# Handoff — migración SIGSO a Node + SQLite (VPS Hetzner)

> **Para quien retoma esta sesión desde otra cuenta**: este documento es
> autocontenido. No depende de la memoria de Claude Code de la cuenta
> anterior (esa memoria vive en el equipo/cuenta de origen y esta sesión
> nueva no la va a tener disponible). Todo lo que necesitas para seguir
> trabajando sin fricción está acá o es derivable del propio repositorio.
>
> Última actualización: 2026-09-18, tras el commit `5879005`
> (4 módulos desgateados de R2; queda **una** acción de archivo pendiente:
> la evidencia fotográfica de Pausas — ver §8.1).

---

## 1. Qué es esto, en una frase

SIGSO (HomePymes / Asesorías Integrales AyS SpA) se está migrando de
**Google Apps Script + Google Sheets** (modelo viejo, todavía en
producción en paralelo) a un stack **Node.js + SQLite autoalojado en un
VPS Hetzner**, con **git push → despliegue automático**. La migración se
hace **módulo por módulo**, preservando el comportamiento de negocio
exacto del `.gs` original (mismas reglas, mismos mensajes de error, mismos
tests adaptados), no una reescritura libre.

El repo tiene **ambos mundos a la vez**: `backend/backoffice/*.gs` /
`backend/intake/*.gs` / `backend/setup/*.gs` son el código Apps Script
histórico (fuente de verdad de las reglas de negocio, todavía sirviendo
partes del sistema real). `backend/logica/*.js`, `backend/server/`,
`backend/db/` son el puerto a Node — se escriben leyendo el `.gs`
correspondiente y portando su lógica y sus tests, no diseñando desde cero.

---

## 2. Mapa de infraestructura y accesos

| Recurso | Valor / ubicación | Notas |
|---|---|---|
| Repo GitHub | `https://github.com/lmtechworkspace-tech/Sistema-de-solicitudes-` | rama `main`, push-to-deploy |
| VPS backend | `2.29.39.143`, dominio `api.ctrly.cl` | Node detrás de Caddy (reverse proxy, TLS Let's Encrypt), systemd (`sigso-api`) |
| Frontend público | `https://lmtechworkspace-tech.github.io/Sistema-de-solicitudes-/` | GitHub Pages, publica `frontend/` |
| Frontend real (Apps Script Backoffice, modelo viejo) | URLs `/exec` de los 3 proyectos Apps Script | sigue vivo, coexiste con Node vía enrutamiento por acción (ver §5) |
| DNS | Cloudflare, proxy "DNS only" (nube gris) sobre `api.ctrly.cl` | necesario para que Caddy emita su propio certificado |
| Deploy backend | `.github/workflows/deploy-backend.yml` | en cada push a `main` que toque `backend/server|db|logica`: corre `node --test backend/test/*.test.js`, si pasa hace `rsync` al VPS por SSH y reinicia el servicio |
| Deploy frontend | `.github/workflows/pages.yml` | en cada push a `main` que toque `frontend/`: publica a GitHub Pages |
| Secretos del deploy | GitHub Actions Secrets (`VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`) | **ya están configurados en el repo** — nadie necesita pegarlos de nuevo. Esta sesión nunca tuvo ni necesitó verlos: el flujo entero es `git push` y el workflow hace el resto. |

**Lo único que la cuenta nueva necesita para poder trabajar:**
1. El repo clonado/accesible en el filesystem donde corre Claude Code
   (si es la misma máquina que la sesión anterior, ya está en
   `C:\Users\luis1\OneDrive\Desktop\SIGSO`; si es una máquina distinta,
   pedirle al usuario el `git clone` de la URL de arriba).
2. **Permiso de `git push` a `main`** en ese repo — sin push no hay
   deploy. Si la cuenta nueva usa una identidad de git distinta, pedirle
   al usuario que confirme que tiene acceso de escritura al repo (o que
   configure sus credenciales de GitHub localmente).
3. Node.js instalado localmente (para `npm test` antes de cada push — el
   repo no especifica una versión mínima estricta, pero CI usa Node 22).
4. Acceso a internet saliente para verificar en vivo con `curl` contra
   `https://api.ctrly.cl` y la URL de GitHub Pages (no hace falta SSH al
   VPS para nada del trabajo normal: todo pasa por git push).

**Para el flujo normal de portar módulos, nunca se necesita ni se debe
pedir**: la llave SSH del VPS, contraseñas, ni tocar Cloudflare/DNS/Caddy
directamente — todo eso ya está resuelto y estable, y el flujo entero es
`git push`.

---

## 2.1 Credenciales: inventario completo y qué necesita realmente la cuenta nueva

**Respuesta corta: la cuenta nueva NO necesita ninguna credencial para
continuar el trabajo.** No es una restricción de seguridad arbitraria —
es cómo está diseñado el sistema: los secretos ya están **instalados en su
destino final** (GitHub Actions y el VPS), y el flujo de trabajo entero
(portar → testear → commit → push → deploy → verificar) no vuelve a
tocarlos nunca.

Este es el inventario completo de secretos del ecosistema, dónde vive cada
uno y quién lo consume. **Ninguno de estos valores se escribe acá a
propósito**: este documento vive en un repositorio Git — escribir un
secreto acá lo publicaría de forma permanente en el historial (mucho peor
que cualquier exposición en una conversación, que es efímera y privada).

| Secreto | Dónde vive hoy | Quién lo consume | ¿La cuenta nueva lo necesita? |
|---|---|---|---|
| `VPS_SSH_KEY` (llave privada de `sigso_deploy_ci`) | GitHub Actions Secrets del repo | El workflow de deploy, en cada push | **No.** Ya configurado; el deploy es automático |
| `VPS_HOST` (`2.29.39.143`) | GitHub Actions Secrets | Workflow de deploy | **No** (y además no es secreto: está acá arriba en §2) |
| `VPS_USER` (`sigso`) | GitHub Actions Secrets | Workflow de deploy | **No** (ídem) |
| `RESEND_API_KEY` | VPS: `/etc/systemd/system/sigso-api.service.d/resend.conf` | El servicio `sigso-api` en runtime | **No.** Ya inyectado por systemd |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_ENDPOINT` | VPS: `/etc/systemd/system/sigso-api.service.d/r2.conf` | El servicio `sigso-api` en runtime (`almacenamiento.js`) | **No.** Ya inyectado por systemd |
| Llave SSH personal `~/.ssh/sigso_vps` | El equipo del usuario (Windows, `C:\Users\luis1\.ssh\`) | Acceso admin manual al VPS | **Solo** si hay que agregar un secreto NUEVO al VPS. Si la cuenta nueva corre en la misma máquina, ya la tiene |
| Credenciales de Cloudflare / Resend / Hetzner (paneles web) | Cuentas del usuario | El usuario, manualmente | **No.** Nada del trabajo normal requiere entrar a esos paneles |
| Contraseñas de cuentas de portal reales (staff) | Base de datos del VPS (hash scrypt) | Los usuarios reales | **No**, y no se deben pedir |

**Si en algún momento SÍ hace falta agregar un secreto nuevo al VPS**
(único caso real que ocurrió: activar R2), el procedimiento es el de la
"excepción" descrita justo abajo — y el valor lo provee el usuario en ese
momento, no queda escrito en ningún archivo del repo.

**Regla de oro heredada de un incidente real de esta sesión**: nunca
`cat`/mostrar el contenido de un archivo de secretos del VPS, ni siquiera
"solo para ver el formato". `ls -la` alcanza para confirmar permisos y
existencia. Para confirmar que una variable está viva sin verla:
`sudo systemctl show sigso-api -p Environment --value` capturado en una
variable de shell y evaluado dentro de un `node -e` que imprima solo
booleanos/conteos, nunca el valor.

**Deuda de seguridad pendiente (heredada, el usuario ya la conoce)**: el
valor real de `RESEND_API_KEY` quedó expuesto una vez en la transcripción
de la conversación del 2026-09-18 por un `sudo cat` innecesario. El
usuario decidió **explícitamente no rotarla por ahora**. No hace falta
actuar sobre esto salvo que el usuario lo pida; si lo pide, el
procedimiento es: generar una key nueva en el panel de Resend, reemplazar
`resend.conf` en el VPS con el patrón de abajo, reiniciar el servicio, y
recién ahí revocar la vieja. Lo mismo aplica al token de R2 (su valor
también se vio una vez, en una captura de pantalla que el usuario
compartió; decidió continuar igual porque solo él tiene acceso a esa
cuenta).

---

**Excepción real que sí ocurrió (2026-09-18)**: activar R2 y migrar
`CAT_CLIENTES` sí requirió acceso directo al VPS — configurar variables
de entorno del servicio no se puede hacer por git push (son secretos,
nunca van al repo). Para eso existe la llave `~/.ssh/sigso_vps` (admin
personal, distinta de `VPS_SSH_KEY`/`sigso_deploy_ci` que usa CI) en el
equipo donde corrió esa sesión — si es la misma máquina, ya está en
`~/.ssh/`. El patrón usado (ver memoria o el commit `8a709a1`): generar/
recibir el secreto, subirlo por `scp` a `/tmp`, moverlo con `sudo mv` a
`/etc/systemd/system/sigso-api.service.d/<nombre>.conf` (permisos 600,
root:root), `sudo systemctl daemon-reload && sudo systemctl restart
sigso-api`. **Nunca `cat`/mostrar el contenido de un archivo de
secretos** — ni siquiera "para ver el formato": alcanza con `ls -la`
para confirmar permisos/existencia sin exponer el valor.

---

## 3. Cómo verificar que el ecosistema está sano (arrancar por acá)

```bash
# 1. El backend Node responde y muestra hace cuánto se reinició.
curl -sS https://api.ctrly.cl/v1/estado

# 2. La suite completa de tests pasa en local.
cd /ruta/al/repo && npm test 2>&1 | tail -15

# 3. El frontend público está sirviendo el archivo más reciente.
curl -sS https://lmtechworkspace-tech.github.io/Sistema-de-solicitudes-/js/api.js | grep -c "true"
```

Si `npm test` da algo distinto de "0 fail", **no sigas portando módulos
nuevos** hasta entender por qué — puede ser una regresión real o un
cambio local sin terminar.

---

## 4. LA LECCIÓN CRÍTICA (ya costó un hallazgo real del usuario, no la repitas)

Portar un módulo a Node **no sirve de nada si el sitio real no lo llama**.
Hay que cortar **dos lados**, siempre en el mismo commit:

1. **Backend**: `backend/server/router.js` — mapear cada `accion` a la
   función de `backend/logica/<modulo>.js` correspondiente.
2. **Frontend**: `frontend/js/api.js`, objeto `ACCIONES_PORTADAS_NODE` —
   agregar el mismo nombre de acción ahí. El enrutamiento real del sitio
   es **por nombre de acción**, sin importar qué URL (Apps Script o Node)
   haya pasado la página que llama: si la acción no está en ese mapa,
   `llamarApi()` la sigue mandando a Apps Script aunque el backend Node ya
   la tenga implementada y probada.

Este mapa (`ACCIONES_PORTADAS_NODE`, arriba de todo en `frontend/js/api.js`)
es la **fuente de verdad de qué está realmente cortado a Node hoy** — más
confiable que cualquier resumen (incluido este documento). Antes de portar
algo, revisa ese archivo para confirmar el estado real.

**Nunca alcanza con `curl` contra `api.ctrly.cl`** para probar que "ya
está migrado" — eso solo prueba que el backend Node responde, no que el
sitio lo use. La verificación real de cada incremento fue: (a) `curl`
contra `api.ctrly.cl/v1/accion` con la acción nueva → debe responder
`forbidden` (sesión inválida) y **no** `Acción desconocida` (eso confirma
que el backend la reconoce); (b) `curl` contra el `api.js` publicado en
GitHub Pages → debe traer las keys nuevas en `ACCIONES_PORTADAS_NODE`.

---

## 5. Reglas del juego (convenciones ya establecidas, no las rediscutas)

- **Cloudflare R2 YA está activo (desde 2026-09-18, commit `8a709a1`)** —
  esto cambió respecto a versiones anteriores de este documento. Bucket
  `sigso-archivos`, credenciales configuradas como variables de entorno
  del servicio en el VPS (`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/
  `R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_ENDPOINT`, mismo patrón que
  `RESEND_API_KEY`). El cliente genérico ya existe y está probado de
  punta a punta contra el bucket real:
  `backend/logica/almacenamiento.js` (`disponible_()`,
  `subirArchivo_(clave, base64, contentType)`, `descargarArchivo_(clave)`,
  `eliminarArchivo_(clave)`, vía `aws4fetch` — primera dependencia real
  del proyecto, antes tenía cero). **Y ya está casi exprimido
  (2026-09-18, commits `a7fe506`/`77b74d4`/`cd4e6ed`/`5879005`)**: los 4
  módulos grandes con acciones de archivo (Novedades, SGC Documentos, SGC
  Personas, Proyectos centro documental + adjuntos de Sala) usan R2 de
  verdad. **Queda exactamente UNA acción de archivo gateada en todo el
  sistema**: la evidencia fotográfica de Pausas
  (`pausas.js`, `finalizar` con `evidencia_base64`) — trabajo chico, es el
  candidato obvio si se quiere cerrar R2 del todo. Todo lo demás que sigue
  gateado depende del **motor de PDF**, que es un problema distinto (§8.3)
  — R2 no lo resuelve.
- **Convenciones de clave R2 ya establecidas** (respetarlas si se agrega
  un módulo nuevo con archivos): `novedades/<novedad_id>/<nombre>`,
  `sgc/documentos/<codigo>/<uuid>/<nombre>`,
  `proyectos/<proyecto_id>/<adjuntos|documentos>/<uuid>/<nombre>`.
  **La regla dura: si el archivo puede tener MÁS DE UNA versión a lo largo
  de su vida, la clave DEBE llevar un `uuid_()` fresco por subida.** R2 no
  tiene versionado propio (a diferencia de Drive, que siempre creaba un
  file-id nuevo): sin el uuid, subir "v2" con el mismo nombre de archivo
  pisa silenciosamente los bytes de "v1" en el bucket, y se pierde la
  trazabilidad de "qué versión regía en qué fecha" que ISO exige. Esto ya
  está aplicado en SGC Documentos y en Proyectos.
- **Validación de archivos por FIRMA BINARIA, nunca por extensión** (un
  `.png` renombrado a `.pdf` se rechaza), tope 10 MB. El detector vive en
  `calidadSgc.js`: `mimeArchivoSgc_(bytes, nombre)` (PDF/DOCX/XLSX/PPTX
  vía cabecera ZIP, DOC/XLS legado vía cabecera OLE) y el wrapper completo
  `subirArchivoSgc_(data, codigo)` (valida + sube). `personasSgc.js`
  importa el **wrapper completo** (sus reglas son idénticas a las de
  Documentos); `proyectos.js` importa **solo el detector** y escribe su
  propio wrapper, porque además acepta imágenes
  (`detectarMimeImagenProyecto_`: JPEG/PNG/WebP por firma). Nunca
  reimplementar esta validación en un módulo nuevo — importar la que
  corresponda.
- **Los tests NUNCA pegan a R2 real.** El patrón establecido en los 4
  módulos es `conMockAlmacenamiento_(t)`: un `Map` en memoria que se
  comporta como un bucket (lo que se sube es lo que se lee de vuelta), vía
  `t.mock.method(Almacenamiento, 'subirArchivo_'|'descargarArchivo_', ...)`.
  Copiarlo de `backend/test/proyectos-fase4-documentos-porteo.test.js` o
  de `calidad-sgc-porteo.test.js`.
- **Convertir una función a `async` rompe a quien la llamaba sin `await`.**
  Pasó de verdad (commit `77b74d4`): dos archivos de test HERMANOS
  (`matriz-cobertura-sgc-porteo.test.js`, `tablero-sgc-porteo.test.js`)
  sembraban datos con `Calidad.crearDocumento(...)` sin `await`; al
  volverse `async`, leían `documento_id` de una Promise (`undefined`) y
  fallaban con un error que no apuntaba a la causa. **Por eso el paso
  "correr la suite COMPLETA, no solo el archivo editado" (§6, paso 9) no
  es opcional** — grepear también por llamadas a la función que se volvió
  async en el resto del repo.
- **Nunca duplicar un helper compartido.** Antes de escribir una función
  que ya podría existir en otro módulo SGC ya portado, revisa
  `backend/logica/calidadSgc.js` (permisos: `gobiernaSgc_`, `rolSgc_`,
  `veTodoSgc_`, `esAdminSgc_`, `areaSgc_`, `parsearClausulasIso_`),
  `backend/logica/sgcCatalogo.js` (`CLAUSULAS_ISO9001`,
  `PREGUNTAS_VERIFICACION_ISO9001`), `backend/logica/utils.js`
  (`sumarDiasHabiles_`, `restarDiasHabiles_`, `horasHabilesEntre`),
  `backend/logica/noConformidadesSgc.js` (`crearTareaSgc_`,
  `tareaResumen_` — el wrapper compartido sobre `Actividades.crear` que
  usan NC y Revisión por la dirección), `backend/logica/personasSgc.js`
  (`horasFormacionPorPersonaSgc_`), `backend/logica/alcanceSgc.js`
  (`alcanceVigente_`, `exclusionesVigentesPorClausula_`). Si algo que
  necesitas existe pero no está exportado, expórtalo — no lo copies.
- **Nunca fingir un dato que no existe.** Cuando un módulo depende de
  otro que todavía no está portado, el patrón establecido es: replicar el
  mismo comportamiento de degradación que tenía el propio `.gs` cuando
  ESE módulo tampoco existía (casi siempre `typeof X === 'function' ?
  X() : []` en Apps Script → un stub local en Node que devuelve
  `null`/`[]`, con un comentario `// TODO v11 Fase N` marcando qué
  reemplazar). El ejemplo más grande de esto es
  `backend/logica/matrizCoberturaSgc.js`: depende de 5 fases v11 que
  aún no existen (Contexto, Riesgos, Procesos, Indicadores, Prestaciones)
  y las declara como stubs explícitos — cuando se porte cada una, hay que
  volver ahí y reemplazar el stub correspondiente por un `require` real
  (ya se hizo una vez con Alcance→v11 Fase 1, y antes con
  Objetivos→RevisionDireccion). Nunca inventar un resumen ni simular que
  el módulo ya existe.
- **Nunca usar días corridos donde la norma pide días hábiles** (y
  viceversa: Quejas/PRO-07 es la única excepción que usa días CORRIDOS a
  propósito, documentado en su cabecera). Usar siempre
  `Utils.sumarDiasHabiles_` / `Utils.restarDiasHabiles_`, nunca
  reimplementar la aritmética de fechas.
- **El modelo de permisos del SGC vive DENTRO del SGC** (`SGC_ROLES`,
  nunca toca los roles globales de SIGSO `ANA/DEV/ADM/GERENCIA`). Ver
  `gobiernaSgc_`/`veTodoSgc_`/`esAdminSgc_` en `calidadSgc.js` antes de
  escribir un chequeo de permiso nuevo.
- **Toda escritura queda de baja lógica** (`activa: false`), nunca se
  borra una fila. Todo el SGC es evidencia para un auditor de
  certificación — esto es central, no un detalle.
- **Mutation-test al menos la regla más importante de cada módulo** antes
  de darlo por terminado (ver §6, paso 5). No es opcional: varias veces
  encontró guardas rotas que los tests "en verde" no habían detectado.

---

## 6. El flujo exacto para portar el siguiente módulo (repetir tal cual)

Este es el patrón usado en los últimos ~15 módulos, sin variación. Selo
al pie de la letra salvo que el usuario pida explícitamente otra cosa.

1. **Leer el `.gs` completo** del módulo en `backend/backoffice/<Modulo>.gs`
   y su tabla de columnas en `backend/backoffice/Constantes.gs` (buscar
   `SHEETS.<NOMBRE_HOJA>` y luego la entrada correspondiente en
   `COLUMNAS`).
2. **Leer el test `.gs` existente** en `backend/test/<modulo>.test.js`
   (el que corre contra el sandbox de Apps Script, `gasSandbox.js`) — ahí
   están los escenarios exactos a portar. Si ese test asume que OTRO
   módulo v11 todavía no portado ya existe, **no fuerces la integración**:
   adapta el test al estado real (ver el patrón de
   `matriz-cobertura-sgc-porteo.test.js`, que documenta explícitamente
   las diferencias con el `.gs`-test original).
3. **Escribir `backend/logica/<modulo>Sgc.js`**: `db` como primer
   argumento explícito de cada función pública, mismos nombres de
   función, misma lógica, mismos mensajes de error al usuario (son
   parte del contrato). Agregar las tablas nuevas a
   `backend/db/schema.js` (columnas exactas de `Constantes.gs`).
4. **Escribir `backend/test/<modulo>-sgc-porteo.test.js`**: mismos
   escenarios que el test `.gs`, adaptados a `(db, data, contexto)`. Para
   mocks de correo, usar el patrón `conMockCorreo(t)` con
   `t.mock.method(Resend, 'enviarCorreoResend_', ...)` (ver cualquier
   test reciente, ej. `objetivos-sgc-porteo.test.js`).
5. **Mutation-test la regla central** del módulo: comentar/relajar la
   guarda más importante con un script `node -e` temporal, confirmar que
   un test la detecta, restaurar el archivo original. Documentar el
   resultado en el mensaje de commit.
6. **Wirear `backend/server/router.js`**: agregar el `require` del
   módulo arriba, y cada acción al objeto `BACKOFFICE_ACTIONS` (mismo
   nombre de acción que usa el frontend — confirmarlo grepeando
   `frontend/js/calidad.js` por el nombre exacto de la acción, nunca
   inventarlo).
7. **Wirear `backend/server/index.js`** si el módulo tiene un trigger
   diario (`recordatorioPendientes`, `alertarLecturasPendientes`, etc.):
   agregarlo dentro de la ventana horaria correspondiente
   (`enVentanaDiaria_(ahora, 9)` para el pase de las 09:00).
8. **Wirear `frontend/js/api.js`**: agregar las mismas acciones a
   `ACCIONES_PORTADAS_NODE` **en el mismo commit** (paso obligatorio, ver
   §4). Si alguna queda excluida (hoy solo las de PDF/Excel), sacarla
   también de la lista de "excluidas a propósito" del comentario de
   cabecera de ese archivo, que se mantiene al día incremento a
   incremento.
9. **Correr la suite completa**: `npm test` debe dar 0 fallas. **La suite
   COMPLETA, no solo el archivo editado** — ver §5, última viñeta: una
   función que pasa a `async` rompe a cualquier test hermano que la
   llamaba sin `await`, y eso solo aparece corriendo todo.
10. **Commit** con mensaje descriptivo (qué se portó, la decisión de
    diseño central del módulo, qué queda pendiente si algo queda
    pendiente) y la línea `Co-Authored-By: Claude <modelo> <noreply@anthropic.com>`
    al final, con el modelo que esté corriendo en esa sesión.
11. **`git push origin main`**.
12. **Poll del deploy**: comparar `arrancado_en` de
    `curl -sS https://api.ctrly.cl/v1/estado` antes y después del push,
    esperando en intervalos de ~15s hasta que cambie (el deploy tarda
    ~5-10 min: corre toda la suite en CI antes de desplegar).
13. **Verificar en vivo, los dos lados** (ver §4): `curl` a
    `/v1/accion` con la acción nueva (debe dar `forbidden`, no `Acción
    desconocida`) y `curl` al `api.js` publicado (debe traer las keys
    nuevas).
14. **Reportar al usuario** qué se hizo, en qué commit, y verificado
    cómo — sin inventar resultados de verificación que no se corrieron
    de verdad.

No hace falta pedirle permiso al usuario para cada paso de este flujo una
vez que dijo "sigue con [la fase X]" — es la instrucción que ya lo
autoriza a portar, wirear, testear, commitear, pushear y verificar en
producción de punta a punta, igual que se hizo en cada módulo anterior.

---

## 7. Estado actual: qué ya está migrado

**Fuente de verdad real**: `frontend/js/api.js`, objeto
`ACCIONES_PORTADAS_NODE` (línea ~64). Este resumen es un mapa de lectura
rápida, no reemplaza revisar ese archivo. **Números medidos al 2026-09-18
(commit `5879005`), no estimados**: `router.js` tiene **254 acciones** y
`ACCIONES_PORTADAS_NODE` tiene **247 cortadas al frontend real**. De esas
254, solo **5 siguen siendo stubs** en `router.js`, y las 5 son de PDF/
Excel (`descargarReporteActividadesPdf`, `descargarActaReunionPdf`,
`descargarReporteProyecto`, `descargarLibroProyecto`,
`descargarEvidenciaClausulaSgc`); hay 2 más gateadas dentro de
`pausas.js` (los reportes PDF de cumplimiento y gerencia) y 1 de archivo
(la evidencia fotográfica de Pausas).

Para recontar esto en cualquier momento sin confiar en este documento:

```bash
node -e "const f=require('fs');const b=f.readFileSync('frontend/js/api.js','utf8').split('var ACCIONES_PORTADAS_NODE = {')[1].split('\n};')[0];console.log('frontend:',new Set([...b.matchAll(/([a-zA-Z0-9_]+)\s*:\s*true/g)].map(m=>m[1])).size)"
grep -c "_validationError: true" backend/server/router.js   # stubs que quedan
```

### Núcleo (portado antes de este tramo de sesiones)
Auth/Portal, Catálogos, Solicitudes (ciclo completo S02-S09), Dashboard,
Panel Gerencia, Panel Jefatura, notificaciones vivas, digest de
Jefatura, alertas de patrón (P7).

### Módulos operacionales
- **Novedades** — **16 de 16** (adjunto PDF desgateado de R2 el
  2026-09-18, commit `a7fe506`).
- **Pausas activas** — 20 de 22 (los 2 PDF de reporte gateados; además la
  evidencia fotográfica de `finalizar` sigue gateada por R2 — es la única
  que queda, ver §8.1).
- **Actividades** (motor base v7.0) — 14 de 16 (los 2 PDF gateados).
- **Proyectos** — **44 de 48** (incremento 1: 31 acciones; incremento 2:
  cronograma avanzado; incremento 3, commit `5879005`: centro documental
  v13 Fase 4 + adjuntos de Sala v10 Fase D, 8 acciones escritas desde
  cero — nunca habían existido en Node, `router.js` las tenía como stub
  inline). Las 4 que faltan son PDF/libro Excel.

### SGC ISO 9001 — PLAN v11.0 COMPLETO (las 8 fases, cerrado 2026-09-18)
El bloque más grande de la migración, ~123 acciones totales en el `.gs`.
**Las 8 fases del plan v11.0 están portadas** — ver tabla completa abajo.
`matrizCoberturaSgc.js` (el evaluador de las 28 cláusulas ISO auditables)
**ya no tiene NINGÚN stub ni evaluador degradado**: las 8 fases le pasan
datos reales.

| Fase | Módulo `.gs` | Módulo Node | Acciones cortadas | Commit |
|---|---|---|---|---|
| 1 | Documentos | `calidadSgc.js` | **15 de 15** (R2 desgateado `77b74d4`) | `6ffc25d` |
| 2a+2b | Personas | `personasSgc.js` | **16 de 16** (R2 desgateado `cd4e6ed`) | `29f4f08` |
| 3a | No conformidades (PRO-06) | `noConformidadesSgc.js` | 9 de 9 | `4a1b302` |
| 3b | Auditoría interna (PRO-03) | `auditoriasSgc.js` | 11 de 11 | `5f80a60` |
| 4 | Quejas (PRO-07) | `quejasSgc.js` | 10 de 10 | `949e980` |
| 5a | Proveedores (PRO-04) | `proveedoresSgc.js` | 5 de 5 | `abc3d70` |
| 5b | Revisión por la dirección (PRO-05) | `revisionDireccionSgc.js` | 9 de 9 | `e87af80` |
| 6a | Objetivos de calidad (DOC-07) | `objetivosSgc.js` | 7 de 7 | `3f57562` |
| 6b | Matriz de cobertura ISO | `matrizCoberturaSgc.js` | 3 de 4 (PDF, gateado) | `7691fc1` |
| v11-F1 | Alcance y exclusiones (§4.3) | `alcanceSgc.js` | 5 de 5 | `ce8dc02` |
| v11-F2 | Contexto y partes interesadas (§4.1/§4.2) | `contextoSgc.js` | 8 de 8 | `2f55907` |
| v11-F3 | Riesgos y oportunidades (§6.1) | `riesgosSgc.js` | 6 de 6 | `095be4d` |
| v11-F4 | Procesos (§4.4) | `procesosSgc.js` | 6 de 6 | `3989cd5` |
| v11-F5 | Documentos externos | ya cubierta por Fase 1 | — | — |
| v11-F6 | Indicadores de proceso (§9.1.1) | `indicadoresSgc.js` | 5 de 5 | `f2fa310` |
| v11-F7 | Tablero (centro de control) | `tableroSgc.js` | 1 de 1 | `d3f304b` |
| v11-F8 | Prestaciones (§8.1/§8.5/§8.6/§8.7) | `prestacionesSgc.js` | 6 de 6 | `ae8a494` |

**Todas las fases están verificadas en vivo** (backend reconoce la
acción, frontend la llama) al momento del commit indicado.

### Dato de producción real: `CAT_CLIENTES` ya migrado
Las 284 filas reales del catálogo de clientes (`CAT_CLIENTES`, tabla que
existe en SIGSO desde la v1.0 pero nunca se había llevado al esquema
Node) se migraron el 2026-09-18 (commits `f3373e1`/`cf4f9f8`) usando una
herramienta temporal (`bootstrapAdmin`+`importarDatosMigracion`, mismo
mecanismo que la migración de datos original del 2026-09-16/17) — se usó
una vez y se revirtió del repo. Desbloquea el uso real de
`prestacionesSgc.js` (antes de esto, cualquier intento de registrar una
prestación fallaba con "el cliente no está en el catálogo").

### Cloudflare R2: activo
Ver el punto correspondiente en §5 — bucket, credenciales y cliente
(`almacenamiento.js`) verificados de punta a punta en producción. Falta
desgatear las ~35 acciones que lo necesitan, una por una (§8.1).

---

## 8. Qué falta

### 8.1 Lo que sigue gateado (lista completa y verificada al commit `5879005`)

**Bloqueado por R2 — queda UNA sola, y es chica:**
- **Pausas, evidencia fotográfica**: `backend/logica/pausas.js:834`,
  dentro de `finalizar` — `data.evidencia_base64` devuelve el stub
  "falta configurar el almacenamiento". Es lo único de archivo que queda
  en todo el sistema. Para cerrarlo: mismo patrón de siempre (§5), clave
  sugerida `pausas/<pausa_id>/<uuid>/<nombre>`, validando por firma de
  IMAGEN (reusar `detectarMimeImagenProyecto_` de `proyectos.js`
  exportándolo, no reimplementarlo), y el test con
  `conMockAlmacenamiento_(t)`. Ojo: `finalizar` pasaría a `async` →
  grepear quién la llama sin `await` antes de commitear (§5, última
  viñeta).

**Bloqueado por el motor de PDF/Excel (7 acciones + 1 módulo):**
- 5 stubs inline en `router.js`: `descargarReporteActividadesPdf`,
  `descargarActaReunionPdf` (líneas ~175-176),
  `descargarReporteProyecto`, `descargarLibroProyecto` (~235-236),
  `descargarEvidenciaClausulaSgc` (~362).
- 2 dentro de `pausas.js` (~919-927): `descargarReporteCumplimientoPdf`,
  `descargarReporteGerenciaPdf`.
- **`OrdenTrabajo.gs`** (464 líneas, módulo completo sin portar): genera
  el PDF de la orden de trabajo que se manda al derivar una solicitud.

Nada de esto se destraba con R2 — necesitan §8.3.

### 8.2 Módulos/lógica sin portar, NO bloqueados por archivos
Trabajo puro de lógica, se puede hacer en cualquier momento:
1. **Lado de lectura de notificaciones in-app** (`notificacionesApp.js`
   solo tiene `encolarLote`; falta sincronizar/marcar leída/marcar todas
   leídas).
2. **`Comentarios.gs`** (37 líneas) — `agregarComentario`, sistema de
   comentarios genérico.
3. **`Inicio.gs`** (143 líneas) — `getInicio`, pantalla de inicio
   autenticada.
4. **`Perfiles.gs`** (510 líneas, sin la parte de fotos que sí depende
   de R2) — `getMiPerfil` y edición de perfil propio.
5. **`Auth.gs`** (112 líneas) — `gestionarUsuario`/`listarUsuarios`/
   `suspenderInactivos`: administración de la tabla `USUARIOS` (cuentas
   de staff). Esa tabla ya la LEEN varios módulos Node (Dashboard,
   Gerencia, Novedades, Pausas...), solo falta el panel para
   gestionarla.
6. **Canales de alerta / permisos de notificaciones del navegador** (4):
   `guardarCanalAlerta`, `listarCanalesAlerta`,
   `listarPermisosNotificacionesSO`, `reportarPermisoNotificacionesSO`.
7. **Disparadores manuales de ADM** (2): `enviarAlertaManual`,
   `enviarReporteGerenciaAhora`.
8. **Panel de diagnóstico** (2): `getEstadoSistema`, `listarLogs`.

### 8.3 Motor de PDF en Node
No elegido todavía. Bloquea reportes, actas y órdenes de trabajo en PDF
(ver lista en §8.1). Candidato razonable dado el criterio de
dependencias mínimas ya establecido (scrypt en vez de bcrypt, `fetch`
nativo en vez del SDK de Resend, `aws4fetch` en vez del SDK de AWS):
`pdfkit` (generación pura en JS, sin depender de un navegador headless
como Puppeteer, que sería pesado para un VPS de 2 vCPU/4GB). No
instalado ni decidido en firme todavía — evaluarlo antes de comprometerse.

### 8.4 Cierre final
- Migrar cualquier dato real adicional que dependa de los módulos del
  §8.2 (igual que se hizo con Solicitudes y con `CAT_CLIENTES`).
- Decidir el modelo de auth del staff legado (`Auth.gs`/`USUARIOS`,
  Google OAuth) vs. seguir todo por el portal — sigue abierto, ver §11
  del documento de memoria si existe acceso a él.
- Una vez cerrado todo lo anterior, apagar Apps Script por completo —
  solo ahí se deja de pagar la infraestructura duplicada.

---

## 9. Punto exacto donde quedó la sesión (2026-09-18, tras `5879005`)

**Estado: todo commiteado, pusheado, desplegado y verificado. No hay
trabajo a medias ni archivos sin terminar.** La suite completa da
**2538/2538 verdes**. El último incremento (Proyectos centro documental)
se desplegó y se confirmó por avance de `arrancado_en` (16:41→20:54Z).

Lo último que se hizo, en orden: desgatear Novedades (`a7fe506`) → SGC
Documentos (`77b74d4`) → SGC Personas (`cd4e6ed`) → escribir desde cero
el centro documental + adjuntos de Sala de Proyectos (`5879005`).

**Tres caminos abiertos, a elección del usuario** (preguntarle si no lo
dijo, no asumir):

1. **Motor de PDF en Node** (§8.3) — el que más destraba: 7 acciones +
   `OrdenTrabajo.gs` completo. No depende de nada externo. Evaluar
   `pdfkit` primero (instalar, generar un PDF simple, confirmar
   tamaño/rendimiento en un VPS de 2 vCPU) antes de comprometerse.
2. **Cerrar R2 del todo** (§8.1) — queda solo la evidencia fotográfica
   de Pausas. Es el trabajo más chico de los tres, una sola acción.
3. **Lógica sin bloquear** (§8.2) — 8 ítems, ninguno depende de
   infraestructura: lado de lectura de notificaciones in-app,
   `Comentarios.gs`, `Inicio.gs`, `Perfiles.gs`, gestión de usuarios de
   `Auth.gs`, canales de alerta, disparadores manuales, panel de
   diagnóstico.

**Sobre la atribución en commits**: los commits de esta sesión llevan
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. La cuenta
nueva debe usar la línea que corresponda al modelo con el que corra
(p. ej. `Claude Opus 5`), no copiar esta literalmente.

---

## 10. Cómo verificar el trabajo del usuario (si pide "revisa que todo esté bien")

```bash
cd /ruta/al/repo
npm test 2>&1 | tail -15          # 0 fail esperado
curl -sS https://api.ctrly.cl/v1/estado   # backend vivo
```

Si el usuario reporta que "algo que ya se portó no funciona en el sitio
real", el primer sospechoso es SIEMPRE el §4: revisar si la acción está
en `ACCIONES_PORTADAS_NODE` del `frontend/js/api.js` publicado
(`curl` al `api.js` real de GitHub Pages, no al del repo local — pueden
estar desincronizados si hubo un push sin terminar el deploy).

---

## 11. Nota sobre memoria y continuidad

La sesión anterior mantenía notas de memoria persistente en
`C:\Users\luis1\.claude\projects\...\memory\sigso-ecosistema-nuevo.md`
(y archivos relacionados) — son mucho más detalladas que este documento
(incluyen el razonamiento completo de cada decisión de diseño, línea por
línea). Si la cuenta nueva corre en la **misma máquina** y tiene acceso a
ese filesystem, vale la pena leerlas para contexto adicional. Si no,
**este documento es autosuficiente** para continuar: el propio código
(comentarios de cabecera de cada `*Sgc.js`, mensajes de commit) tiene la
misma información que la memoria, porque esa fue siempre la fuente
primaria — la memoria era un resumen derivado, nunca al revés.

Si la cuenta nueva quiere reconstruir su propia memoria de este proyecto,
el material más denso está en:
- Los mensajes de commit de `git log` (cada uno explica la decisión
  central del módulo que introduce).
- Los comentarios de cabecera de cada archivo en `backend/logica/*Sgc.js`.
- Este documento.
