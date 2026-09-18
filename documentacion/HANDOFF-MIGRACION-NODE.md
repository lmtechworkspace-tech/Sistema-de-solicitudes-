# Handoff — migración SIGSO a Node + SQLite (VPS Hetzner)

> **Para quien retoma esta sesión desde otra cuenta**: este documento es
> autocontenido. No depende de la memoria de Claude Code de la cuenta
> anterior (esa memoria vive en el equipo/cuenta de origen y esta sesión
> nueva no la va a tener disponible). Todo lo que necesitas para seguir
> trabajando sin fricción está acá o es derivable del propio repositorio.
>
> Última actualización: 2026-09-18, tras el commit `8a709a1`.

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
  del proyecto, antes tenía cero). **Lo que sigue faltando NO es activar
  R2 (ya está), es desgatear cada acción gateada una por una**: hoy
  ninguna de las ~35 acciones que suben/bajan archivos usa
  `almacenamiento.js` todavía — cada una sigue devolviendo el mismo stub
  `_validationError` de antes ("no está disponible... falta configurar
  el almacenamiento"). Para desgatear una acción: reemplazar ese stub por
  una llamada real a `Almacenamiento.subirArchivo_`/`descargarArchivo_`,
  definir la convención de `clave` para ese módulo (ej.
  `novedades/<novedad_id>/<archivo_id>.pdf`), y cortarla a
  `ACCIONES_PORTADAS_NODE` en el mismo commit (regla de siempre, §4).
  Las acciones que generan PDF siguen bloqueadas aparte — ver el punto
  del motor de PDF más abajo, R2 no resuelve eso.
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
   §4) — excepto las que tocan archivos, que se documentan como
   excluidas en el comentario de cabecera.
9. **Correr la suite completa**: `npm test` debe dar 0 fallas.
10. **Commit** con mensaje descriptivo (qué se portó, la decisión de
    diseño central del módulo, qué queda pendiente si algo queda
    pendiente) y `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
    al final.
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
rápida, no reemplaza revisar ese archivo. Números concretos al
2026-09-18: de 262 acciones totales en `Code.gs`, **241 ya están en el
backend Node y 228 cortadas al frontend real**. Quedan 35 acciones sin
portar y 13 ya portadas en el backend pero sin cortar al frontend (todas
del SGC, gateadas por archivo — ver §8.1).

### Núcleo (portado antes de este tramo de sesiones)
Auth/Portal, Catálogos, Solicitudes (ciclo completo S02-S09), Dashboard,
Panel Gerencia, Panel Jefatura, notificaciones vivas, digest de
Jefatura, alertas de patrón (P7).

### Módulos operacionales
- **Novedades** — 16 acciones (adjunto/descarga gateadas, ver §8.1).
- **Pausas activas** — 20 de 22 (los 2 PDF de reporte gateados).
- **Actividades** (motor base v7.0) — 14 de 16 (los 2 PDF gateados).
- **Proyectos** — 36 de 48 (centro documental/adjuntos/PDF/libro Excel
  gateados, 10 acciones). Incremento 1 (31 acciones) + incremento 2
  (cronograma avanzado: registro diario, baseline, rendimiento,
  analítica, workload).

### SGC ISO 9001 — PLAN v11.0 COMPLETO (las 8 fases, cerrado 2026-09-18)
El bloque más grande de la migración, ~123 acciones totales en el `.gs`.
**Las 8 fases del plan v11.0 están portadas** — ver tabla completa abajo.
`matrizCoberturaSgc.js` (el evaluador de las 28 cláusulas ISO auditables)
**ya no tiene NINGÚN stub ni evaluador degradado**: las 8 fases le pasan
datos reales.

| Fase | Módulo `.gs` | Módulo Node | Acciones cortadas | Commit |
|---|---|---|---|---|
| 1 | Documentos | `calidadSgc.js` | 11 de 15 (archivo, gateado) | `6ffc25d` |
| 2a+2b | Personas | `personasSgc.js` | 11 de 16 (archivo, gateado) | `29f4f08` |
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

### 8.1 Acciones ya escritas del lado de negocio, solo gateadas por archivo/PDF
Con R2 activo, estas ya NO están bloqueadas por infraestructura — solo
falta escribir el código de cada acción para que use
`backend/logica/almacenamiento.js` en vez del stub, y cortarla al
frontend. Las de PDF siguen bloqueadas aparte (no hay motor de PDF):

- **Proyectos** (10): centro documental completo (subir/descargar/
  versionar documento de proyecto), adjunto de tarea, reporte PDF, acta
  de reunión PDF, libro Excel del proyecto.
- **SGC** (13, ya en `router.js` pero sin cortar al frontend —
  `actualizarDescriptorSgc`, `actualizarDocumentoSgc`,
  `crearDocumentoSgc`, `descargarAdjuntoNovedad`, `descargarDescriptorSgc`,
  `descargarDocumentoPersonaSgc`, `descargarDocumentoSgc`,
  `descargarReporteCumplimientoPausasPdf`,
  `descargarReporteGerenciaPausasPdf`, `guardarDescriptorSgc`,
  `guardarDocumentoPersonaSgc`, `nuevaVersionDocumentoSgc`,
  `publicarNovedad`).
- **Novedades** (2): adjunto PDF, publicar con adjunto.
- **Actividades** (2): reporte PDF, acta de reunión PDF.
- **Pausas** (2): los dos reportes PDF (cumplimiento y gerencia).
- **`OrdenTrabajo.gs`** (464 líneas, módulo completo sin portar): genera
  el PDF de la orden de trabajo que se manda al derivar una solicitud.

**Patrón para desgatear una acción de archivo (no-PDF)**: reemplazar el
stub `_validationError` por `Almacenamiento.subirArchivo_`/
`descargarArchivo_`/`eliminarArchivo_` (ver firma en §5), definir la
convención de `clave` de ese módulo, correr los tests, cortar a
`ACCIONES_PORTADAS_NODE` en el mismo commit.

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

## 9. Punto exacto donde quedó la sesión (2026-09-18, tras `8a709a1`)

No hay un "siguiente paso" único prescrito — quedaron dos hilos abiertos
a elección del usuario:

1. **Empezar el motor de PDF en Node** (§8.3) — no depende de nada
   externo, se puede arrancar ya. Evaluar `pdfkit` primero (instalar,
   generar un PDF de prueba simple, confirmar que el tamaño/rendimiento
   es aceptable en el VPS) antes de comprometerse a portar una acción
   real con él.
2. **Empezar a desgatear las acciones de R2** (§8.1) — módulo por
   módulo, el mismo patrón de siempre. Buen candidato para arrancar:
   Novedades (solo 2 acciones, módulo ya aislado, sin acoplamiento con
   otros).

Si la cuenta que retoma no tiene esa respuesta a mano, preguntarle al
usuario cuál de los dos prefiere antes de escribir código — no asumir.

**Nota de seguridad para quien retome**: durante la activación de R2 en
esta sesión, el valor real de `RESEND_API_KEY` quedó expuesto una vez en
la transcripción de la conversación (por un `sudo cat` innecesario sobre
el archivo de secretos del VPS — nunca repetir ese comando, alcanza con
`ls -la` para ver permisos/existencia). El usuario decidió explícitamente
NO rotarla por ahora. No es necesario actuar sobre esto salvo que el
usuario lo pida.

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
