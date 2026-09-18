# Handoff — migración SIGSO a Node + SQLite (VPS Hetzner)

> **Para quien retoma esta sesión desde otra cuenta**: este documento es
> autocontenido. No depende de la memoria de Claude Code de la cuenta
> anterior (esa memoria vive en el equipo/cuenta de origen y esta sesión
> nueva no la va a tener disponible). Todo lo que necesitas para seguir
> trabajando sin fricción está acá o es derivable del propio repositorio.
>
> Última actualización: 2026-09-18, tras el commit `ce8dc02`.

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

**Nunca se necesita ni se debe pedir**: la llave SSH del VPS, contraseñas,
ni tocar Cloudflare/DNS/Caddy directamente — todo eso ya está resuelto y
estable. Si algo ahí se rompe, es una señal de que algo excepcional pasó,
no parte del flujo de trabajo normal de portar módulos.

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

- **Nunca subir/bajar archivos reales todavía**: no existe Cloudflare R2
  configurado. Toda acción que suba o baje un archivo (adjuntos, PDF,
  centro documental, descriptores con archivo) se deja **excluida** del
  corte de frontend — la lista completa y por qué está en el comentario
  de cabecera de `ACCIONES_PORTADAS_NODE` en `frontend/js/api.js`. En el
  backend, esas acciones devuelven un stub `_validationError` tipo "aun
  no esta disponible... falta el motor de PDF / falta configurar el
  almacenamiento" en vez de implementarse — mismo patrón en
  `backend/server/router.js`, buscar `motor de PDF` o `almacenamiento no
  configurado` para ver los ejemplos exactos.
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
rápida, no reemplaza revisar ese archivo.

### Núcleo (portado antes de este tramo de sesiones)
Auth/Portal, Catálogos, Solicitudes (ciclo completo S02-S09), Dashboard,
Panel Gerencia, Panel Jefatura, notificaciones vivas, digest de
Jefatura, alertas de patrón (P7).

### Módulos operacionales
- **Novedades** — 16 acciones (adjunto/descarga en Apps Script).
- **Pausas activas** — 20 de 22 (los PDF de reporte en Apps Script).
- **Actividades** (motor base v7.0) — 14 de 16 (los PDF en Apps Script).
- **Proyectos** — 36 de 48 (centro documental/adjuntos/PDF/libro Excel
  en Apps Script). Incremento 1 (31 acciones) + incremento 2 (cronograma
  avanzado: registro diario, baseline, rendimiento, analítica, workload).

### SGC ISO 9001 (el bloque más grande, ~123 acciones totales en el `.gs`)
| Fase | Módulo `.gs` | Módulo Node | Acciones cortadas | Commit |
|---|---|---|---|---|
| 1 | Documentos | `calidadSgc.js` | 11 de 15 (archivo en Apps Script) | `6ffc25d` |
| 2a+2b | Personas | `personasSgc.js` | 11 de 16 (archivo en Apps Script) | `29f4f08` |
| 3a | No conformidades (PRO-06) | `noConformidadesSgc.js` | 9 de 9 | `4a1b302` |
| 3b | Auditoría interna (PRO-03) | `auditoriasSgc.js` | 11 de 11 | `5f80a60` |
| 4 | Quejas (PRO-07) | `quejasSgc.js` | 10 de 10 | `949e980` |
| 5a | Proveedores (PRO-04) | `proveedoresSgc.js` | 5 de 5 | `abc3d70` |
| 5b | Revisión por la dirección (PRO-05) | `revisionDireccionSgc.js` | 9 de 9 | `e87af80` |
| 6a | Objetivos de calidad (DOC-07) | `objetivosSgc.js` | 7 de 7 | `3f57562` |
| 6b | Matriz de cobertura ISO | `matrizCoberturaSgc.js` | 3 de 4 (PDF en Apps Script) | `7691fc1` |
| v11-F1 | Alcance y exclusiones (§4.3) | `alcanceSgc.js` | 5 de 5 | `ce8dc02` |

**Todas las fases anteriores están verificadas en vivo** (backend
reconoce la acción, frontend la llama) al momento del commit indicado.

---

## 8. Qué falta (en orden recomendado)

### 8.1 SGC — fases v11 restantes (7 de 8)
Mismo patrón del §6, un módulo por sesión enfocada:

1. **v11 Fase 2 — Contexto (§4.1/§4.2)** ← **SIGUIENTE PASO**. Ver
   detalle completo en §9.
2. **v11 Fase 3 — Riesgos y oportunidades (§6.1)**
3. **v11 Fase 4 — Procesos (§4.4)**
4. **v11 Fase 5 — Documentos externos**: ya cubierta por
   `sembrarDocumentosExternosSgc` (Fase 1) — nada pendiente acá.
5. **v11 Fase 6 — Indicadores** (de proceso, distintos de los objetivos
   de calidad de la Fase 6a)
6. **v11 Fase 7 — Tablero** (`Tablero.gs` — dashboard consolidado del
   SGC; ojo que `saludPorCapitulo_`/`CAPITULOS_ISO` ya se portaron de
   forma standalone dentro de `matrizCoberturaSgc.js` porque
   `archivarFoto` los necesitaba antes de que existiera Tablero — al
   portar esta fase, evaluar si conviene centralizarlos en un módulo
   `tableroSgc.js` y que `matrizCoberturaSgc.js` los importe de ahí)
7. **v11 Fase 8 — Prestaciones** (servicios prestados/liberados — la
   tabla `SGC_PRESTACIONES` todavía no existe en `schema.js`; varios
   evaluadores de `matrizCoberturaSgc.js` la leen vía `leerSeguro_` que
   ya tolera la ausencia de tabla)

**Cada vez que se porte una de estas, volver a
`backend/logica/matrizCoberturaSgc.js`** y reemplazar el stub
correspondiente (`factoresContextoActivos_`, `partesInteresadasActivas_`,
`riesgosActivos_`, `procesosActivos_`, `pasosActivos_`,
`indicadoresActivos_`) por un `require` real del módulo nuevo — están
todos marcados con `// TODO v11 Fase N` en ese archivo.

### 8.2 Núcleo pendiente (se puede intercalar)
`agregarComentario`, notificaciones-app (lado de lectura: sincronizar/
marcar leída — el lado de encolado ya existe en `notificacionesApp.js`),
gestión de usuarios, algunas alertas menores.

### 8.3 Bloqueado por infraestructura, no por código
- **Cloudflare R2**: sin activar. Bloquea ~25 acciones de archivos ya
  identificadas y excluidas a propósito (ver §5). Cuando se active, hay
  que: (a) revisar cada acción gateada en `router.js` y
  `alcanceSgc.js`/`*Sgc.js` (buscar "almacenamiento no configurado" y
  "motor de PDF"), implementar la subida/bajada real, y (b) agregarlas a
  `ACCIONES_PORTADAS_NODE` en el frontend.
- **Motor de PDF en Node**: bloquea las descargas de PDF (reportes,
  actas, evidencia de auditoría). Apps Script las genera con
  `HtmlService`; Node necesita una librería (no elegida todavía).

---

## 9. El siguiente paso exacto: v11 Fase 2 — Contexto

Para que la cuenta nueva pueda arrancar sin releer todo el histórico:

- **Leer**: `backend/backoffice/Contexto.gs` (488 líneas) completo.
- **Test a portar**: `backend/test/contexto.test.js` (293 líneas) — son
  los escenarios exactos a adaptar a `(db, data, contexto)`.
- **Tablas nuevas** (ya están en `Constantes.gs`, copiar el array de
  columnas exacto a `backend/db/schema.js`): `SGC_CONTEXTO`,
  `SGC_PARTES_INTERESADAS`.
- **Lo que expone para reuso** (mirar qué ya consume
  `matrizCoberturaSgc.js` de este módulo, vía los stubs a reemplazar):
  `factoresContextoActivos_(db)` y `partesInteresadasActivas_(db)`
  — deben devolver lo mismo que hoy devuelven `[]` (arrays de factores
  FODA / partes interesadas activas), y `matrizCoberturaSgc.js` ya tiene
  los evaluadores `evaluarContextoOrganizacion_` (4.1) y
  `evaluarPartesInteresadas_` (4.2) escritos en su forma degradada —
  hay que revisar si el `.gs` real (con Contexto ya integrado) tiene más
  lógica en esos evaluadores que la que quedó en el stub actual del
  `.gs` de `MatrizCobertura.gs` (sección `evaluarContextoOrganizacion_`/
  `evaluarPartesInteresadas_`, ya leída una vez para portar la Fase 6b —
  tiene la lógica completa con `resumenContexto_`, `MESES_REVISION_CONTEXTO`,
  que en Contexto.gs deben estar definidos).
- **Acciones de frontend ya confirmadas** (grepeadas en
  `frontend/js/calidad.js`, 6 acciones): `obtenerContextoSgc`,
  `guardarFactorContextoSgc`, `anularFactorContextoSgc`,
  `guardarParteInteresadaSgc`, `anularParteInteresadaSgc`,
  `registrarRevisionContextoSgc`. Confirmar que coinciden 1:1 con las
  funciones públicas de `Contexto.gs` antes de wirear.
- Seguir el flujo completo del §6, en el mismo orden.

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
