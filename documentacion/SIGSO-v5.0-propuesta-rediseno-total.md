# SIGSO v5.0 — Propuesta de rediseño total: "de herramienta interna a producto"

> Estado: **propuesta, sin implementar**. Pendiente de aprobación por fases.
> Regla de oro de todo el documento: **cero cambios de lógica de negocio**.
> Se rediseña la piel y la experiencia; el backend, los permisos, los flujos
> y los datos no se tocan.

---

## 0. Diagnóstico honesto (por qué se ve "2018")

El problema no es un color ni una fuente. Es que la interfaz actual **no tiene
opinión**: todo pesa lo mismo, todo está al mismo nivel, y el ojo no sabe por
dónde entrar. Síntomas concretos, pantalla por pantalla:

| Síntoma | Dónde se nota |
|---|---|
| Todo compite por atención (filtros, KPIs, tabs, tablas al mismo peso) | Bandeja de trabajo, Panel de Gerencia |
| Densidad sin jerarquía: mucho texto, poco aire, radios de 4-8px | Todas |
| El color de marca (naranja) está en todos lados, así que no significa nada | Botones, tabs, KPIs, header |
| Los estados vacíos, cargas y errores son texto plano | Todas |
| No hay identidad: podría ser cualquier admin de Bootstrap | Login de plataforma, Home |
| Cada pantalla resuelve el mismo problema con un componente distinto | Tablas de Gerencia vs Bandeja vs Admin |

**La conclusión importante**: el sistema funcional está bien (v4.2 tiene
paneles por rol, aislamiento, digest, todo probado). Lo que falta es un
**sistema de diseño** que le dé jerarquía, respiración e identidad — y una
capa de experiencia (atajos, paleta de comandos, notificaciones) que lo haga
sentir producto y no formulario.

---

## 1. Restricciones reales (lo que la propuesta respeta sí o sí)

Esto es lo que separa esta propuesta de una lámina de Dribbble:

1. **Vanilla JS, sin framework.** Nada de React/Next/Tailwind build. El
   proyecto se sirve como archivos estáticos (GitHub Pages) y como HTML
   inlineado dentro de Apps Script (`build-backoffice-html.js`). Un framework
   rompería el build, el deploy por copy-paste y los dev-servers. Todo el
   rediseño se hace con **CSS moderno (custom properties, grid, container
   queries donde aporten) + los mismos .js de siempre**.
2. **La duplicación deliberada se mantiene** (app.html / plataforma.html /
   admin.html comparten markup). El Design System reduce el dolor de esa
   duplicación: si un componente vive en `components.css`/`components.js`,
   las tres páginas lo heredan igual.
3. **Modo oscuro ya existe** (tokens en `main.css`, v4.0). No se reinventa:
   se **re-tokeniza** — cada color nuevo nace con su par claro/oscuro.
4. **Accesibilidad no es fase 4**: contraste AA, foco visible, navegación
   por teclado y `aria-*` se exigen en cada componente desde la fase 1
   (varios ya existen: el autocomplete de clientes es navegable por teclado).
5. **Se avanza pantalla por pantalla sin romper las demás**: los tokens
   nuevos conviven con los viejos durante la transición (alias), igual que
   se hizo en v4.0 Fase 6.

---

## 2. Identidad visual: la personalidad de SIGSO

### 2.1 De qué debe dejar de parecer y qué debe transmitir

- **Deja de ser**: un formulario administrativo genérico.
- **Pasa a ser**: una herramienta de trabajo seria, veloz y silenciosa. La
  referencia de *sensación* (no de copia) es Linear/Stripe Dashboard: fondo
  tranquilo, texto que manda, color solo donde hay significado, movimiento
  solo donde hay causa.

### 2.2 Color — la decisión más visible

Según lo pedido, el **primario pasa a la familia índigo/violeta** de la
imagen de referencia, y el naranja actual **no se elimina: se degrada a
acento secundario** (marca histórica del logo y alertas cálidas). Propuesta
de paleta (con su par oscuro desde el día 1):

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--primario` | `#6D5DF6` (índigo SIGSO) | `#8B7DFF` | Acciones primarias, links, foco, selección |
| `--primario-intenso` | `#4F46E5` | `#6D5DF6` | Hover/active del primario |
| `--primario-suave` | `#EEF0FE` | `rgba(109,93,246,.16)` | Fondos de selección, badges informativos |
| `--fondo` | `#F8FAFC` | `#0E1116` | Fondo de página (frío, no blanco puro) |
| `--superficie` | `#FFFFFF` | `#161B22` | Cards, paneles |
| `--superficie-2` | `#F1F4F9` | `#1D242E` | Zonas hundidas, inputs, hover de fila |
| `--borde` | `#E5E8EF` | `#2A323E` | Bordes 1px (nunca más gruesos) |
| `--texto` | `#0F172A` | `#E7EBF2` | Texto principal |
| `--texto-2` | `#64748B` | `#93A0B4` | Metadatos, ayudas |
| `--ok` / `--alerta` / `--critico` / `--info` | verdes/ámbar/rojo/azul actuales, recalibrados a AA | ídem | Semántica de estado (única fuente de color "fuerte") |
| `--acento-marca` | `#F97316` (naranja actual) | `#FB923C` | Logo, momentos de marca, ilustraciones. **No botones.** |

**Regla de uso del color** (esto es lo que hace que se vea diseñado y no
generado): en una pantalla cualquiera, el 90% debe ser fondo/superficie/
texto; el índigo aparece solo en la acción primaria y la selección; los
semánticos solo en estados. Si un color aparece más de 3 veces en un
viewport, está mal usado.

### 2.3 Tipografía

- **Inter ya está cargada** (v4.0) — se mantiene, pero con una **escala
  tipográfica real** en tokens: `--t-display 28/34`, `--t-title 20/28`,
  `--t-body 14/22`, `--t-small 12.5/18`, `--t-mono` (IDs de solicitud,
  ya existe la convención `sigso-id`).
- Pesos: 600 para títulos y valores de KPI, 500 para labels/acciones, 400
  para cuerpo. **Nunca 700 masivo ni 300 fino** (los dos extremos gritan
  "plantilla").
- Números tabulares (`font-variant-numeric: tabular-nums`) en TODA cifra:
  KPIs, tablas, fechas. Es el detalle que más "profesionaliza" una tabla.

### 2.4 Geometría, aire y sombra

- Radios: `--r-s 8px` (inputs, badges), `--r-m 12px` (cards, botones),
  `--r-l 16px` (paneles, modales). Se acabó el 4px.
- Espaciado en escala de 4: `4/8/12/16/24/32/48`. Padding mínimo de card:
  20-24px (hoy ~12).
- Sombras: solo **dos** — `--sombra-1: 0 1px 2px rgba(15,23,42,.06)` para
  reposo y `--sombra-2: 0 8px 30px rgba(15,23,42,.10)` para elevación
  (modales, popovers, hover de card clicable). El resto de la separación la
  hacen **bordes de 1px y diferencias de fondo**, no sombras — esa es la
  gramática Linear/Stripe y lo que evita el look "card flotante de IA".

### 2.5 Iconografía e ilustración

- Ya existe `iconos.js` (SVG inline que hereda color, v4.0) — se **amplía a
  un set único de ~40 íconos** de trazo 1.5px, y se prohíbe el emoji como
  ícono de UI (hoy el semáforo usa 🔴🟡🟢: se reemplaza por puntos de color
  + texto, manteniendo el emoji solo en correos, donde sí funciona).
- Estados vacíos con mini-ilustraciones geométricas propias (SVG, 2 colores:
  borde + primario-suave), no clipart ni blobs genéricos.

### 2.6 Anti-"generado por IA": reglas explícitas

Lo que delata a un sitio generado y cómo lo evitamos, como checklist de
revisión de cada pantalla:

1. **Nada de gradientes violeta-rosa de héroe** ni glassmorphism. Fondos
   planos, color con significado.
2. **Nada de emojis decorativos en la UI** (ver 2.5).
3. **Sin simetría perfecta de tarjetitas 3x3 con ícono centrado**: los
   layouts usan jerarquía asimétrica (una zona principal ancha + un rail
   secundario), como una herramienta real.
4. **Microcopy con voz propia**, en el español chileno directo que ya usa el
   sistema ("Estás viendo tu propia bandeja", "no queda guardada: cópiala
   ahora") — nada de "¡Ups! Algo salió mal 🚀".
5. **Densidad de verdad donde se trabaja**: las tablas de bandeja/gerencia
   son densas y potentes (48px por fila, no cards infladas), porque Leo las
   usa 4 horas al día. Las cards se reservan para el Home y móviles.
6. **Detalles de artesanía**: alineación óptica de íconos, `letter-spacing`
   negativo leve en display, transiciones de 150ms con `ease-out`, focus
   ring de 2px del primario con offset. Son 20 decisiones chicas que en
   conjunto se leen como "alguien diseñó esto".

---

## 3. El Design System (Fase 1 — la base de todo)

Un solo lugar de verdad, construido sobre los archivos que ya existen:

```
frontend/css/
  tokens.css        ← NUEVO: todos los tokens (color/tipo/espaciado/radio/
                       sombra/z-index/movimiento), claro y oscuro
  base.css          ← reset + tipografía global + utilidades mínimas
  components.css    ← se REESCRIBE componente a componente sobre tokens
  (main.css queda como alias de compatibilidad y muere al final)
```

### 3.1 Inventario de componentes (todos ya existen en el sistema; se
rediseñan, no se inventan)

**Primitivos**: botón (primario/secundario/fantasma/peligro/ícono), input,
select, textarea, checkbox/toggle, radio, chip seleccionable, badge de
estado, badge de prioridad, avatar de iniciales, tooltip, tag de conteo.

**Estructura**: card, panel con header, tabla densa (orden/agrupación/hover/
selección), tabs con indicador animado, sidebar/nav, header de página
(título + acciones), toolbar de filtros colapsable, modal/confirm/prompt
(ya existen en `Componentes`), popover, divider.

**Feedback**: alerta inline, toast/aviso (existe), **skeleton loaders**
(nuevo — reemplaza todos los "Cargando…"), estado vacío ilustrado (existe
básico, se eleva), barra de progreso, spinner fino.

**Dominio SIGSO**: tarjeta KPI (número grande + tendencia + sparkline
opcional), semáforo de cumplimiento (punto + label, sin emoji), timeline de
historial (existe en detalle, se refina), fila de solicitud (versión tabla y
versión card móvil), galería de adjuntos, autocomplete (existe), selector de
densidad (existe en Gerencia), delta badge (existe).

### 3.2 Entregable de la fase

- `tokens.css` + `base.css` funcionando en las 5 páginas sin romper nada
  (los tokens viejos quedan como alias).
- **Una página interna `styleguide.html`** (no enlazada, solo para nosotros)
  que muestra cada componente en claro/oscuro — es el "contrato visual" que
  usaremos para validar cada fase siguiente y para que cualquier
  funcionalidad futura salga consistente.
- Documento `UI-GUIDELINES.md`: reglas de color, voz, espaciado y el
  checklist anti-genérico del §2.6.

---

## 4. Layout global y navegación (Fase 2)

### 4.1 Navegación: de tabs horizontales a sidebar

La plataforma (shell) pasa de la barra horizontal actual a un **sidebar
izquierdo colapsable** (72px colapsado / 240px expandido), el patrón de toda
herramienta de trabajo seria:

```
┌────────┬──────────────────────────────────────┐
│ ◆ SIGSO│  Bandeja de trabajo          🔔  LM  │
│        │ ────────────────────────────────────  │
│ ⌂ Inicio│                                      │
│ ✚ Nueva │        (contenido)                   │
│ ≡ Mis   │                                      │
│ ▣ Bandeja ●5                                   │
│ ↗ Gerencia                                     │
│ ⚑ Mi depto.                                    │
│ ⚙ Admin │                                      │
│ ─────── │                                      │
│ ◐ Tema  │                                      │
│ LM Luis │                                      │
└────────┴──────────────────────────────────────┘
```

- Ítem activo: fondo `primario-suave` + barra lateral de 3px + ícono en
  primario. Hover suave de 150ms. Badges de conteo integrados.
- Los acentos por módulo de v4.0 se conservan (ya existen los pares
  acento/suave) pero más sutiles: solo tiñen el indicador activo.
- En móvil: bottom-bar de 4 accesos + menú. (La base responsive de v4.0
  Fase 6 ya existe; se adapta.)
- El sitio público (index/estado) mantiene header horizontal — es para
  solicitantes ocasionales, un sidebar los confundiría. Misma piel, distinto
  chasis: decisión de UX, no inconsistencia.

### 4.2 Header de contenido

Cada pantalla adopta el mismo patrón: **título grande a la izquierda,
acciones a la derecha, una sola acción primaria** (índigo). Actualizar,
exportar, imprimir → botones secundarios/fantasma. Se acaba la sopa de
botones naranjas.

### 4.3 Centro de notificaciones

La campana del header abre un panel (popover) con las novedades relevantes al
rol, agrupadas por día — construido **sobre datos que ya existen** (los
mismos que alimentan "Requieren tu acción", el badge P5 y el digest de
Jefatura). Sin backend nuevo: es una vista, no una feature de datos.

### 4.4 Modo oscuro

Ya existe; en esta fase se **audita contra los tokens nuevos** y se agrega el
conmutador visible (sidebar, abajo) con persistencia en localStorage —
hoy depende del sistema operativo.

---

## 5. Pantallas clave (Fase 3) — qué cambia en cada una

Orden propuesto por impacto/uso diario:

### 5.1 Home del shell → Dashboard personal
Hoy: saludo + grilla de tarjetas de módulos. Pasa a: saludo con fecha,
**resumen del día según rol** (4 KPIs con tendencia), actividad reciente
(timeline compacto), accesos rápidos. Para un SOLICITANTE muestra sus
solicitudes activas; para DEV su carga; para JEFATURA el resumen de su
equipo (reutiliza `hoy` de Jefatura.getPanel); para GERENCIA los KPIs
globales. **Todo con acciones que ya existen** — es composición, no backend.

### 5.2 Bandeja de trabajo
- Recorrido visual en 3 niveles: (1) KPIs clicables arriba —más chicos que
  hoy, con tendencia—, (2) "Requieren tu acción" como zona destacada con
  fondo `primario-suave`, (3) la tabla densa.
- Filtros en una toolbar de una línea con selects estilizados + botón
  "Filtros" que expande los avanzados (hoy los 6 selects pesan tanto como
  los datos).
- Filas de 48px, hover, columna de prioridad como punto de color + texto,
  SLA restante con color semántico. Vista guardada del orden (ya existe el
  patrón en Gerencia).

### 5.3 Nueva solicitud
Las tarjetas temáticas de UI-4 ya son buenas; se re-tokenizan y se agrega:
indicador de progreso lateral (pasos), autosave visible ("Borrador guardado
hace 5 s" — el borrador ya existe), y microvalidación en vivo con los nuevos
estilos de error.

### 5.4 Mis solicitudes / Consultar estado
Cards de solicitud con la línea de tiempo horizontal ya existente (UI-3),
elevadas al nuevo sistema: estado como stepper de puntos, acciones
pendientes del solicitante como bloque destacado.

### 5.5 Panel de Gerencia y Mi Departamento
Ya tienen la información correcta (v4.1/v4.2); el rediseño es puramente
visual: KPIs con tendencia y mini-sparkline (Chart.js ya está), tabs con
indicador animado, tablas al componente denso común, gráficos con la paleta
nueva (hoy usan colores hardcodeados del 2023), y el PDF de Gerencia se
rediseña con encabezado institucional limpio.

### 5.6 Administración
La pantalla más "Bootstrap" de todas. Pasa al patrón lista-maestro/detalle:
menú lateral propio (ya existe) restilizado, tablas densas comunes,
formularios en panel lateral deslizante (drawer) en vez de formulario arriba
de la tabla — el patrón actual obliga a hacer scroll constante.

### 5.7 Login de la plataforma
La primera impresión. Split-screen: izquierda panel de marca (fondo índigo
profundo, logo, tagline "Sistema Integral de Gestión de Solicitudes", un
patrón geométrico sutil propio — no foto de stock, eso es lo más "IA" que
existe), derecha el formulario con los inputs nuevos. Con el flujo de
cambio de clave obligatorio ya existente, restilizado.

---

## 6. Experiencia premium (Fase 4)

Lo que separa "se ve bien" de "se siente increíble":

1. **Command Palette (Ctrl+K)**: buscar y saltar — "Nueva solicitud",
   "SOL-2026-RLD-0031", "Ir a Gerencia", "Buscar: Vanessa". Vanilla JS puro
   (un modal + índice en memoria de rutas y solicitudes ya cargadas); las
   búsquedas server-side reutilizan acciones existentes.
2. **Atajos de teclado**: `N` nueva solicitud, `G` luego `B` ir a bandeja,
   `/` foco en buscador, `Esc` cerrar. Con hoja de atajos (`?`).
3. **Skeleton loaders** en todas las cargas (tabla, KPIs, detalle) — muerte
   definitiva del "Cargando…".
4. **Microinteracciones**: transiciones de 150ms, elevación sutil en cards
   clicables, tabs con underline animado, toasts que entran desde abajo,
   check animado al completar una acción. **Sin** parallax, sin scroll-jacking,
   sin partículas — ver §2.6.
5. **Tour de bienvenida** (primera sesión por rol): 4-5 tooltips anclados
   que presentan la pantalla. Se guarda en localStorage.
6. **Impresión/PDF cuidada** para Gerencia y Jefatura (media print ya
   existe, se eleva al nuevo sistema).

Drag & drop se evalúa al final y solo si aparece un caso real (¿reordenar
prioridad de la cola?); no se agrega interacción sin causa.

---

## 7. Plan por fases (resumen ejecutivo)

| Fase | Contenido | Resultado visible | Esfuerzo | Riesgo |
|---|---|---|---|---|
| **F1** | Identidad + tokens + base.css + styleguide.html + UI-GUIDELINES | Todo el sitio cambia de piel (color, tipo, aire, radios) sin tocar estructura | Medio | Bajo (tokens con alias) |
| **F2** | Sidebar + header de contenido + centro de notificaciones + dark mode audit + toggle | El sistema "se siente otro" al navegar | Medio-alto | Medio (navegación toca las 3 páginas duplicadas) |
| **F3** | 7 pantallas clave una a una (orden: Bandeja → Home → Gerencia/Depto → Admin → Nueva → Mis/Estado → Login) | Cada semana una pantalla queda nivel producto | Alto (repartible) | Bajo (pantalla a pantalla, verificable en navegador) |
| **F4** | Ctrl+K, atajos, skeletons, microinteracciones, tour, print | La capa "premium" | Medio | Bajo |

Cada fase cierra igual que siempre: `npm test` verde (la lógica no cambia,
los tests deben seguir pasando), verificación en navegador claro/oscuro/
móvil, build de App/Admin.html, paquete de deploy, commit con tu aprobación.

**Regla de aprobación**: al final de F1 te muestro el styleguide y la
Bandeja re-tokenizada en el navegador; nada de F2 empieza sin tu visto bueno
sobre esa base — así el gusto se calibra al principio y no al final.

---

## 8. Lo que esta propuesta deliberadamente NO hace

- No migra a React/Next/Tailwind (rompería build, deploy y dev-servers, y
  obligaría a reescribir 15 archivos .js que funcionan y están testeados).
- No toca ninguna acción del backend, permisos ni esquema.
- No agrega librerías de UI de terceros (el peso de la página es una
  ventaja actual: se carga al instante en el celular de un supervisor en
  terreno; solo Chart.js se mantiene).
- No rediseña los correos en esta versión (quedan para una v5.1 con
  plantilla HTML propia — hoy son texto plano y funcionan).

---

## 9. Decisiones que necesito de ti

1. **Paleta**: ¿confirmas índigo `#6D5DF6` como primario y el naranja
   degradado a acento de marca? (Puedo mostrarte 2-3 variantes del índigo
   en el styleguide de F1 antes de fijarlo.)
2. **Sidebar**: ¿apruebas el cambio de navegación horizontal → sidebar en
   el shell? Es el cambio estructural más grande de F2.
3. **Orden de F3**: propongo Bandeja primero (la pantalla más usada). ¿O
   prefieres partir por el Login/Home (la más visible para Gerencia)?
4. **Alcance**: ¿apruebo las 4 fases completas, o partimos con F1+F2 y
   evaluamos?
