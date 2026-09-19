# Handoff — migración SIGSO a Node + SQLite (VPS Hetzner)

> **Para quien retoma esta sesión desde otra cuenta**: este documento es
> autocontenido. No depende de la memoria de Claude Code de la cuenta
> anterior (esa memoria vive en el equipo/cuenta de origen y esta sesión
> nueva no la va a tener disponible). Todo lo que necesitas para seguir
> trabajando sin fricción está acá o es derivable del propio repositorio.
>
> Última actualización: 2026-09-19, tras el commit `1eac8f4`
> (Fase 1a de un plan de fases post-migración: modo "Configurar informe"
> de Proyectos, casi completo -- todo excepto la grilla día×tarea
> (gantt/workload/leyenda), dejada a su propio incremento por decisión
> explícita del usuario. Ver §8.1. Fases 0 (respaldo, §10.2), 2 (R2 al
> 100%, §8.1) y 3a (Comentarios/canales de alerta/disparadores/
> diagnóstico, §8.2) también resueltas. Plan de fases completo: §12).

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
rápida, no reemplaza revisar ese archivo. **Números medidos al 2026-09-19
(commit `c04409d`), no estimados**: `ACCIONES_PORTADAS_NODE` tiene **264
cortadas al frontend real**. Solo **1 stub** queda en `router.js`
(`descargarLibroProyecto`, Excel — motor distinto, fuera de alcance del
motor de PDF). El backend de `descargarReporteProyecto` (PDF de
Proyecto, camino "de un clic") YA existe y está probado
(`backend/logica/reporteProyecto.js`), pero **no está en
`ACCIONES_PORTADAS_NODE` a propósito** — ver la nota grande en la
cabecera de ese archivo del frontend: el enrutamiento es por nombre de
acción, no por payload, y 2 de los 3 sitios que llaman a esa acción
siempre mandan `config` (modo "Configurar informe", no portado) — cortar
la acción ahora regresionaría esos dos flujos.

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
- **Pausas activas** — **22 de 22, módulo 100% en Node.** PDF de reporte
  desgateados del motor pdfkit el 2026-09-19 (`234c7e0`); evidencia
  fotográfica de `finalizar` desgateada el 2026-09-19 (`5642141`, Fase 2
  — ver §8.1). Sin nada pendiente de R2 en ningún módulo del sistema.
- **Actividades** (motor base v7.0) — **16 de 16** (los 2 PDF desgateados
  del motor pdfkit el 2026-09-19, commit `0f8f77d`).
- **Proyectos** — **45 de 48** en `ACCIONES_PORTADAS_NODE` (el backend ya
  cubre 46/48 — `descargarReporteProyecto` también está portado, pero esa
  acción no se corta al frontend todavía — ver la nota grande arriba).
  Incremento 1: 31 acciones; incremento 2: cronograma avanzado;
  incremento 3 (`5879005`): centro documental + adjuntos de Sala;
  incremento 4 (`f85f6f3`, motor PDF): `descargarReporteProyecto` camino
  "de un clic"; incremento 5 (Fase 1b, 2026-09-19): `descargarLibroProyecto`
  (libro Excel completo, sin recortar alcance — ver §8.1). Queda el modo
  "Configurar informe" de `descargarReporteProyecto`
  (secciones/rango/personas/Gantt), documentado como pendiente explícito
  en §8.1.

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
| 6b | Matriz de cobertura ISO | `matrizCoberturaSgc.js` | **4 de 4** (PDF desgateado del motor pdfkit `2c8f678`) | `7691fc1` |
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

### 8.1 Lo que sigue gateado (lista completa y verificada al commit `f85f6f3`)

**R2: RESUELTO AL 100% (2026-09-19, commit `5642141`, Fase 2 del plan
post-migración, §12).** Ya no queda NINGUNA acción de archivo gateada en
todo el sistema. La última era la evidencia fotográfica de Pausas
(`gestionarPausaCoordinador`/`finalizar`) — ahora sube de verdad a R2,
clave `pausas/<pausa_id>/<uuid>/<nombre>`, valida por firma de imagen
(`detectarMimeImagenProyecto_` de `proyectos.js`, al que se le sumó GIF
para no perder esa capacidad del `.gs` al reusarlo). Nueva acción
`descargarEvidenciaPausa` (mismo patrón que `descargarAdjuntoNovedad`:
el archivo se proxea por el backend, nunca una URL directa de R2).
`gestionarPausaCoordinador` pasó a `async` — se actualizaron los 8
escenarios de `pausas-porteo.test.js` que la llamaban sin `await`.

**Motor de PDF (§8.3): resuelto en su alcance acordado.** Los 7 stubs
originales (5 inline en `router.js` + 2 dentro de `pausas.js`) más
`OrdenTrabajo.gs` (464 líneas, módulo completo que no existía en Node)
están portados, testeados, mutation-testeados, verificados en vivo y
desplegados — commits `247ea00`, `0f8f77d`, `234c7e0`, `2c8f678`,
`f85f6f3` (2026-09-19). Motor elegido: `pdfkit` (evaluado en el propio
incremento — ~80ms/~4KB para un documento de 2 páginas, sin navegador
headless). Helper compartido: `backend/logica/pdfDocumento.js`
(encabezado/chrome, fichas, secciones, tablas genéricas, chips de
prioridad, barra horizontal) — lo reusan los 5 módulos de PDF.

**Fase 1a (§12): CASI RESUELTA (2026-09-19, commit `1eac8f4`).** El modo
"Configurar informe" de `descargarReporteProyecto` está portado excepto
las 3 secciones de grilla día×tarea (`gantt`, `workload`, `leyenda`,
~540 de las ~1395 líneas del feature original) — decisión explícita del
usuario (preguntado, no asumido) dado el riesgo/tamaño de portar
paginación multipágina + colores por celda + conectores con fidelidad
completa. Si el config las pide, el backend devuelve un
`_validationError` explícito con el nombre de la sección, nunca un PDF a
medias. Todo lo demás SÍ está portado y probado: portada (con índice de
contenido), narrativa, ficha, kpis (banda de tarjetas), salud (chip +
desglose), avance por tarea, hitos, riesgos, vencimientos, rendimiento,
desviaciones (Plan·Esperado·Real), bitácora — todos respetando los
filtros de personas/estado/rango del config.

**Una cosa queda pendiente DENTRO de Proyectos, documentada
explícitamente (no fingida):**
1. **La grilla día×tarea** (`gantt`/`workload`/`leyenda`) — su propio
   incremento futuro si se necesita, ver `reporteProyecto.js`.
   **Por esto la acción `descargarReporteProyecto` TODAVÍA no está en
   `ACCIONES_PORTADAS_NODE`** (ver la nota grande en la cabecera de
   `frontend/js/api.js`): el reporte de "Cronograma"
   (`frontend/js/proyectos.js`, `CRONOGRAMA_REPORTE_SECCIONES_`) SIEMPRE
   pide `gantt`+`workload`+`leyenda` — conectar la acción hoy dejaría
   ESE botón puntual siempre fallando (con el enrutamiento por nombre de
   acción, no por payload, no se puede cortar "la mayoría de las
   configs" y dejar esa una en Apps Script). El botón simple y el modal
   "Configurar informe" (para quien no pide esas 3 secciones) ya
   funcionarían bien en Node.

**`descargarLibroProyecto` (Fase 1b): RESUELTA (2026-09-19).** Libro Excel
completo — `backend/logica/libroProyecto.js`, puerto 1:1 de
`ExcelGantt.gs`. A diferencia de la grilla día×tarea del PDF (lienzo de
tamaño fijo, coordenadas y paginación a calcular a mano — la razón de
fondo por la que esa se dejó para después), la Carta Gantt del Excel usa
la hoja de cálculo COMO la grilla: cada semana es una columna, cada barra
es el relleno de una celda — sin lienzo ni paginación que portar, así que
se porta el libro completo sin recortar alcance. `Utilities.zip` (Apps
Script) se reemplaza por `backend/logica/xlsxZip.js`, un escritor de ZIP
(DEFLATE) de ~100 líneas propias con `zlib.crc32`/`zlib.deflateRawSync`
(Node 21+) — mismo criterio de dependencias mínimas que `aws4fetch`/
`pdfkit`/`scrypt`, sin sumar `exceljs` ni ninguna librería nueva. Fechas:
mismo cuidado que el resto del backend — un timestamp real se formatea
vía `Intl` con zona `America/Santiago`; una clave ya-solo-día (`AAAA-MM-DD`,
como `plan_inicio` de `obtenerRendimiento`) nunca se reinterpreta con una
zona horaria, se reordena como texto (ver la cabecera de
`libroProyecto.js` y el mismo criterio ya documentado en `utils.js`).

### 8.2 Módulos/lógica sin portar, NO bloqueados por archivos

**Fase 3a (§12): RESUELTA (2026-09-19, commits `3df51bc` + `c04409d`).**
De los 8 ítems originales, 4 quedaron portados en esta fase:
- **`Comentarios.gs`** → `backend/logica/comentarios.js`.
- **Canales de alerta / permisos de notificaciones del navegador** (4
  acciones: `listarCanalesAlerta`, `guardarCanalAlerta`,
  `listarPermisosNotificacionesSO`, `reportarPermisoNotificacionesSO`)
  → `backend/logica/notificaciones.js`. Hallazgo real del porteo: el
  gate de canales (`correoActivoParaEvento_`) NUNCA había estado
  implementado en Node -- se agregó de verdad, conectado en los dos
  puntos de salida de correo (`enviarCorreo_`/`encolarCorreo_`), no solo
  el CRUD de la config (que habría sido una función fingida).
- **Disparadores manuales de ADM** (`enviarAlertaManual`,
  `getDirectorioAlerta`, `enviarReporteGerenciaAhora`) →
  `backend/logica/notificaciones.js`.
- **Panel de diagnóstico** (`getEstadoSistema` → nuevo
  `backend/logica/sistema.js`; `listarLogs` → ya existía la lógica en
  Node, solo estaba wireada bajo un nombre de acción que el frontend
  nunca llamaba, mismo patrón de §4).

**Quedan 3 ítems, ninguno bloqueado por infraestructura:**
1. **Lado de lectura de notificaciones in-app** (`notificacionesApp.js`
   solo tiene `encolarLote`; falta sincronizar/marcar leída/marcar todas
   leídas).
2. **`Inicio.gs`** (143 líneas) — `getInicio`, pantalla de inicio
   autenticada.
3. **`Perfiles.gs`** (510 líneas, sin la parte de fotos que sí depende
   de R2) — `getMiPerfil` y edición de perfil propio.
4. **`Auth.gs`** (112 líneas) — `gestionarUsuario`/`listarUsuarios`/
   `suspenderInactivos`: administración de la tabla `USUARIOS` (cuentas
   de staff). Esa tabla ya la LEEN varios módulos Node (Dashboard,
   Gerencia, Novedades, Pausas...), solo falta el panel para
   gestionarla.

### 8.3 Motor de PDF en Node — RESUELTO (2026-09-19)
Ver el resumen completo en §8.1. `pdfkit` elegido y en producción desde
el commit `247ea00`. Lo único que queda relacionado es el modo
"Configurar informe" de Proyectos (§8.1, punto 1) — no bloqueado por
infraestructura, es tamaño de tarea.

### 8.4 Cierre final
- Migrar cualquier dato real adicional que dependa de los módulos del
  §8.2 (igual que se hizo con Solicitudes y con `CAT_CLIENTES`).
- Decidir el modelo de auth del staff legado (`Auth.gs`/`USUARIOS`,
  Google OAuth) vs. seguir todo por el portal — sigue abierto, ver §11
  del documento de memoria si existe acceso a él.
- Una vez cerrado todo lo anterior, apagar Apps Script por completo —
  solo ahí se deja de pagar la infraestructura duplicada.

---

## 9. Punto exacto donde quedó la sesión (2026-09-19, tras `f85f6f3`)

**Estado: todo commiteado, pusheado, desplegado y verificado. No hay
trabajo a medias ni archivos sin terminar.** La suite completa da
**2562/2562 verdes**. Los 5 incrementos del motor de PDF se desplegaron
y se confirmaron uno por uno por avance de `arrancado_en`, y cada acción
nueva se verificó en vivo (curl a `/v1/accion` → `forbidden`, nunca
"Acción desconocida"; el backend de `descargarReporteProyecto` se
verificó igual aunque no está cortada al frontend, ver §8.1).

Lo último que se hizo, en orden, en una sola sesión: motor de PDF
(`pdfkit`, evaluado e instalado) + helper compartido `pdfDocumento.js`
→ Orden de Trabajo completa (`247ea00`) → reporte de Actividades + acta
(`0f8f77d`) → reportes de Pausas (`234c7e0`) → evidencia de auditoría
SGC (`2c8f678`) → reporte de Proyecto "de un clic" (`f85f6f3`).

**QA visual atrapó 3 bugs reales antes de deployar** (útil documentarlo
para la próxima sesión que toque `pdfDocumento.js`): las fuentes
estándar de pdfkit (Helvetica, WinAnsiEncoding) no cubren emoji ni el
símbolo "≥" (salían como caracteres rotos, corregido en el reporte de
Pausas); y `avanceRealTarea_` devuelve `null` (sin dato) para una tarea
en curso sin `avance_pct` explícito, pero el reporte de Proyecto lo
mostraba como "0%" — fingiendo un número que no existía, corregido a
"sin dato". Ninguno de los tres se habría visto sin abrir el PDF
generado en el navegador — correr los tests no alcanza para esto.

**Dos caminos abiertos, a elección del usuario** (preguntarle si no lo
dijo, no asumir):

1. **Modo "Configurar informe" de Proyectos** (§8.1) — el resto del PDF
   ejecutivo: secciones a elección, rango, personas, Carta Gantt día a
   día multipágina, Workload, Desviaciones. Sustancialmente más grande
   que los 5 reportes ya portados juntos.
2. **Lógica sin bloquear** (§8.2) — 8 ítems, ninguno depende de
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

## 10.1 Detalles operativos que cuestan una hora de tropiezos si no se saben

Todo esto se aprendió tropezando durante la migración. Está acá para que
la cuenta nueva no lo repita.

**El contrato HTTP real de `/v1/accion`** — los campos son `action` y
`data`, **en inglés**. Mandar `accion`/`datos` (que es como se llaman en
todo el código en español) devuelve `"Acción desconocida: undefined"`
para CUALQUIER acción, incluso una válida: parece un problema de deploy
y no lo es. Se confirma leyendo `backend/server/app.js`.

```bash
curl -sS -X POST https://api.ctrly.cl/v1/accion \
  -H "Content-Type: application/json" \
  -d '{"action":"listarProyectos","data":{}}'
```

**Qué prueba y qué NO prueba ese curl**: el guardia de sesión corre
ANTES del dispatcher de acciones. Entonces: acción inexistente → `404`
"Acción desconocida"; acción existente sin sesión → `403` "Sesión
inválida". Ese contraste 404 vs 403 es la señal de que el deploy llegó.
Pero **una acción gateada (stub) y una implementada de verdad responden
EXACTAMENTE igual** sin sesión — el curl anónimo no las distingue. Para
eso, o se mira el código, o se usa una sesión real.

**Zona horaria**: dev, CI y VPS corren en `America/Santiago`. Toda la
lógica de fechas (jornada 09-18, feriados, "hoy", DST) lo asume. En UTC
fallan 2 tests de `proyectos-registro-dia.test.js` en la ventana
nocturna. El workflow fija `TZ: America/Santiago`. **Si algún día un test
falla solo en CI y no en local, sospechar primero la zona horaria.**

**El repo tiene DOS familias de tests y `npm test` corre las dos:**
- `backend/test/<modulo>.test.js` → prueban el código **Apps Script**
  (`backend/backoffice/*.gs`) contra el sandbox `helpers/gasSandbox.js`.
  Son la fuente de verdad de las reglas de negocio. **No se tocan al
  portar** — siguen verdes porque el `.gs` sigue existiendo.
- `backend/test/<modulo>-porteo.test.js` → prueban el puerto Node
  (`backend/logica/*.js`). Son los que se escriben al portar, copiando
  los escenarios del test `.gs` hermano y adaptándolos a
  `(db, data, contexto)`.

Las dos familias son independientes: cambiar `backend/logica/*` no puede
romper un test `.gs`, y viceversa. Lo que SÍ puede romper es otro test
`-porteo` (ver la viñeta de `async` en §5).

**Dependencias y deploy**: el proyecto tuvo cero dependencias hasta
`aws4fetch`. Por eso el workflow no instalaba nada — se le agregó
`npm ci` en CI y un `rsync` de `node_modules/` al VPS (el VPS **nunca**
corre `npm install` por su cuenta). **Si se agrega una dependencia
nueva, verificar que siga sincronizándose**, y probar en limpio con
`rm -rf node_modules && npm ci && npm test` antes de pushear.

**Gotcha de `aws4fetch` al mockear**: internamente llama
`fetch(await this.sign(input, init))` — es decir, **un solo argumento,
un objeto `Request`**, no `(url, init)`. Un mock que espere dos
argumentos falla de forma confusa. Además el cliente se construye con
`retries: 0` a propósito (el default son 10 con backoff exponencial: un
solo test de error simulado tardaba ~24s).

**Base de datos de producción**: `/opt/sigso/data/sigso.db` (SQLite,
`node:sqlite`). El servicio la abre en exclusiva mientras corre, así que
no se puede editar el archivo por fuera con el servicio arriba — por eso
las migraciones de datos reales se hicieron por HTTP con una herramienta
temporal (`bootstrapAdmin` + `importarDatosMigracion`), usada una vez y
revertida del repo (commits `f3373e1`/`cf4f9f8` para `CAT_CLIENTES`).
Si hay que migrar otra tabla real, ese es el patrón a repetir.

**El export completo de producción** (84 hojas, foto del 2026-09-18 con
datos reales de SGC/Proyectos/Actividades/Pausas) está en
`C:\Users\luis1\Downloads\SIGSO - Base de Datos (6).xlsx` en el equipo
del usuario. Solo se migró `CAT_CLIENTES` de ahí, a propósito. Si se
necesita refrescar otra tabla, la fuente está ahí (pedirle el archivo al
usuario si la cuenta nueva corre en otra máquina).

**Cómo revertir un deploy malo**: `git revert <commit> && git push` —
el workflow redespliega solo. No hay que tocar el VPS a mano. (Se usó de
verdad para revertir la herramienta de migración.)

**Script extra**: `npm run build:backoffice-html` regenera el HTML del
backoffice Apps Script. Solo se usa si se toca el mundo `.gs`.

**Windows / Git Bash**: pasar rutas de Windows dentro de `node -e` por
Git Bash rompe (los backslashes se mezclan y arman rutas inválidas). La
solución usada siempre: escribir un archivo `.js` de verdad en el
scratchpad e invocarlo con barras normales
(`node "C:/Users/.../script.js"`).

---

## 10.2 RESUELTO (2026-09-19, commit `8e2c9ee`): respaldo diario de la base

**Era el riesgo más importante fuera del trabajo de migración en sí —
verificado por SSH el 2026-09-18: cero respaldo, ni timer ni crontab.
Cerrado como Fase 0 de un plan de fases post-migración, antes de seguir
con cualquier otro trabajo.**

Solución:
- `backend/scripts/backup-db.js` — usa `VACUUM INTO` (SQLite 3.27+, vía
  `node:sqlite`, sin depender del binario `sqlite3` que no está
  instalado en el VPS) para una foto consistente de la base con el
  servicio corriendo. Retención local de 14 días (poda automática cada
  corrida) + sube la copia del día a R2 (bucket ya existente, clave
  `backups/sigso-<fecha>.db`). Testeado (`backend/test/backup-db.test.js`,
  nunca pega a R2 real — mock `conMockAlmacenamiento_`).
- `sigso-backup.service` + `sigso-backup.timer` (systemd, creados a mano
  por SSH el 2026-09-19 — no son código, no se despliegan por git,
  mismo criterio que el resto de la config del VPS): corre todos los
  días a las 03:30 hora Chile, `Persistent=true` (si el VPS estuvo
  apagado a esa hora, corre apenas vuelve). El drop-in de credenciales
  R2 (`sigso-backup.service.d/r2.conf`) es una copia server-side del
  mismo `r2.conf` que ya usa `sigso-api` — nunca se leyó ni se escribió
  el valor del secreto desde esta sesión, solo `sudo cp` de un archivo a
  otro.
- **Verificado en producción de punta a punta** el 2026-09-19: corrida
  manual (`systemctl start sigso-backup.service`) escribió
  `/opt/sigso/backups/sigso-2026-09-18.db` (700416 bytes, mismo tamaño
  que la base real) y lo subió a R2; se confirmó bajándolo de vuelta
  (`ok:true, bytes:700416`) con una unidad systemd temporal que se borró
  después de verificar.

Pendiente, no urgente: R2 no se poda (crece ~700KB/día, ~21MB/mes —
irrelevante en el corto plazo; si algún día importa, agregar un `list`
a `almacenamiento.js` y podar por prefijo `backups/`).

---

## 11. Nota sobre memoria y continuidad

La sesión anterior mantenía notas de memoria persistente en
`C:\Users\luis1\.claude\projects\C--Users-luis1-OneDrive-Desktop-SIGSO\memory\sigso-ecosistema-nuevo.md`
(~560 líneas) — **son bastante más detalladas que este documento**:
incluyen el razonamiento completo de cada módulo portado, los bugs
encontrados y por qué, y las decisiones descartadas con su motivo.

**Esos archivos viven en el disco, no en la nube de la cuenta.** Si la
cuenta nueva corre en la misma máquina y el mismo usuario de Windows,
el directorio sigue ahí aunque la sesión sea de otra cuenta de Claude —
vale mucho la pena pedirle a la sesión nueva que lo lea explícitamente
(no lo va a cargar solo si su memoria está vacía):

> «Lee `C:\Users\luis1\.claude\projects\C--Users-luis1-OneDrive-Desktop-SIGSO\memory\sigso-ecosistema-nuevo.md`
> y `documentacion/HANDOFF-MIGRACION-NODE.md`, y seguimos desde ahí.»

Si la cuenta nueva corre en otra máquina, **este documento es
autosuficiente** para continuar: el propio código
(comentarios de cabecera de cada `*Sgc.js`, mensajes de commit) tiene la
misma información que la memoria, porque esa fue siempre la fuente
primaria — la memoria era un resumen derivado, nunca al revés.

Si la cuenta nueva quiere reconstruir su propia memoria de este proyecto,
el material más denso está en:
- Los mensajes de commit de `git log` (cada uno explica la decisión
  central del módulo que introduce).
- Los comentarios de cabecera de cada archivo en `backend/logica/*Sgc.js`.
- Este documento.

---

## 12. Plan de fases post-migración (definido 2026-09-19)

Con el motor de PDF (§8.3) resuelto, se organizó lo que queda en fases,
para trabajar ordenado en vez de saltar entre módulos. Verificado contra
el código real al commit `8e2c9ee` (no contra este mismo documento — el
método: `npm test`, releer router.js/api.js, y para infraestructura del
VPS, SSH de solo lectura antes de asumir nada).

- **Fase 0 — Respaldo de la base de producción.** ✅ **RESUELTA**
  (2026-09-19, commit `8e2c9ee`) — ver §10.2. Se hizo primero porque era
  el único riesgo de pérdida total de datos, independiente de cualquier
  otra prioridad de migración.
- **Fase 1 — Cerrar Proyectos al 100%.**
  - 1a. Modo "Configurar informe" (§8.1): ✅ **CASI RESUELTA**
    (2026-09-19, commit `1eac8f4`) — todo portado excepto la grilla
    día×tarea (`gantt`/`workload`/`leyenda`), dejada a propósito para su
    propio incremento (decisión del usuario). La acción todavía no está
    conectada al frontend por el botón "Cronograma", que siempre pide
    esas 3 secciones — ver §8.1.
  - 1b. Libro Excel (`descargarLibroProyecto`, §8.1): ✅ **RESUELTA**
    (2026-09-19) — portado completo, sin recortar alcance (la Carta
    Gantt del Excel es la propia hoja de cálculo, no un lienzo con
    coordenadas). Sin librería nueva: ZIP propio (`xlsxZip.js`) con
    `zlib` de Node en vez de `exceljs`.
  - 1c (nueva, no estaba en el plan original). La grilla día×tarea
    (`gantt`/`workload`/`leyenda`) — ~540 líneas, paginación
    multipágina, colores por celda, conectores. Necesaria para conectar
    `descargarReporteProyecto` al frontend real (el botón "Cronograma"
    depende de ella).
- **Fase 2 — Cerrar R2 del todo.** ✅ **RESUELTA** (2026-09-19, commit
  `5642141`) — ver §8.1. La evidencia fotográfica de Pausas, última
  acción de archivo gateada en todo el sistema, ya sube a R2 de verdad.
- **Fase 3 — Lógica sin portar, sin bloqueos de infraestructura** (§8.2):
  - 3a (rápidos): ✅ **RESUELTA** (2026-09-19, `3df51bc`+`c04409d`) —
    `Comentarios.gs`, canales de alerta (las 4 acciones, incluido el
    gate real de correo), disparadores manuales de ADM, panel de
    diagnóstico.
  - 3b (medianos): notificaciones in-app (falta sincronizar/marcar
    leída), `Inicio.gs`.
  - 3c (sensible, toca permisos): `Perfiles.gs`, `Auth.gs` (gestión de
    cuentas de staff).
- **Fase 4 — Cierre final** (§8.4): migrar cualquier dato real adicional
  que dependa de los módulos de la Fase 3 (mismo patrón que
  `CAT_CLIENTES`); decidir el modelo de auth del staff legado; apagar
  Apps Script por completo.

Orden sugerido al usuario: 0 → 2 (rápido, mientras se decide el alcance
real de la 1) → 1 → 3 → 4. Es una sugerencia, no una regla — confirmar
con el usuario antes de asumir el orden si retoma la sesión sin decirlo.
