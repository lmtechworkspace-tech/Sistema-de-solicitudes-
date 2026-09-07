# SIGSO v15.1 — Página de presentación (landing)

Página pública nueva. **No forma parte de la aplicación**: no toca el
formulario, la plataforma ni el contrato con Apps Script.

```
frontend/landing.html          la página
frontend/css/landing.css       el hero
frontend/css/landing-relato.css el tramo narrativo
frontend/js/landing.js         la coreografía del hero
frontend/js/landing-relato.js  la narrativa de scroll
```

En producción: <https://lmtechworkspace-tech.github.io/Sistema-de-solicitudes-/landing.html>

---

## El concepto: "La promesa que no se borra"

El encargo proponía como ejemplo *"el flujo de una solicitud como un
recorrido vivo"*. Se descartó: es la metáfora que produciría cualquier
sistema de tickets.

Leyendo el código, SIGSO no está construido alrededor del flujo, sino de que
**un compromiso no pueda desaparecer en silencio**. Está en tres sitios del
repositorio, y ninguno se inventó para la landing:

| dónde | qué hace |
|---|---|
| `Jefatura.gs` / `Gerencia.gs` | guarda `fecha_original` junto a la vigente — *"sin ella solo se ve la fecha vigente, que ya incorpora el atraso y por eso parece que no lo hubo"* |
| Gantt de Proyectos | dibuja la línea base como barra fantasma detrás de la real |
| `Cumplimiento.gs` | dos relojes: entrar en Terminada para el de quien ejecuta y arranca el de quien valida |

La página cuenta eso. El detalle firma: se promete una fecha, la fecha se
mueve, **y la original se queda**. Al final del recorrido se ven todas.

### Sistema de movimiento

Un solo principio: **nada desaparece, las cosas se dejan atrás**.

- Un único easing en toda la página, heredado del producto
  (`tokens.css --mov-entrada`): `cubic-bezier(0.16, 1, 0.3, 1)`. Entra
  rápido y frena largo — algo que *llega y se asienta*.
- Se mueve **una cosa por vez**. Si todo se mueve, el movimiento no
  significa nada.
- El scroll es tiempo: el riel lateral recorre los estados reales del
  sistema (`utils.js`, `SIGSO_ESTADOS_LABEL`).
- Nada se anima en bucle. Un detalle que se repite deja de leerse.

### Paleta y tipografía

Navy, sin recuperar el naranja: la v8.0 lo retiró a propósito y el encargo
pedía usarlo. Se decidió respetar el rebrand. El impacto sale de la
profundidad de un solo color, no de añadir otro.

El navy hondo del hero (`#0B1526`) **solo existe en la landing**; el
producto no lo usa.

Tipografía: `Archivo` para display (una grotesca de precisión industrial,
deliberadamente no una de las caras que aparecen por defecto en todo sitio
generado) e `Inter` para cuerpo, que ya es la cara del producto — entrar a
la plataforma desde la landing se siente continuo.

---

## Librerías

| librería | dónde | por qué |
|---|---|---|
| **GSAP 3.12.5** | solo el relato | encadenar el relevo de los dos relojes y decidir qué acto manda sobre el riel |
| **ScrollTrigger 3.12.5** | solo el relato | disparar cada acto sin que parpadee en los bordes |
| Archivo + Inter | toda la página | Google Fonts, con `display=swap` |

**El hero no carga ninguna librería.** Tiene una entrada escalonada (CSS) y
un desplazamiento (JS propio). Meter ~115 KB de motor de animación para
mover un elemento sería el antipatrón que el propio encargo pide evitar.

### Lenis se descartó

El encargo lo sugería para el scroll suave. Un scroll con inercia se lleva el
control del desplazamiento nativo, y eso toca la barra de accesibilidad que
el encargo declara **no negociable**: teclado (Espacio, AvPag, Inicio/Fin).

Se intentó comprobar y **no se pudo**: en el entorno de prueba el teclado no
mueve ninguna página, ni siquiera una sin Lenis (verificado contra
`styleguide.html` como control). La prueba no dice nada, ni a favor ni en
contra.

Ante un requisito no negociable que no se puede verificar, se eligió no
arriesgarlo. Se pierde la inercia — un gusto — y se gana certeza sobre el
teclado — un requisito. Se ahorran además 13 KB.

**Para reponerlo:** una línea de `<script>` en `landing.html` y restaurar
`arrancarLenis()` en `landing-relato.js` (el razonamiento completo está en
su cabecera). Hay que probarlo en un navegador real, con el teclado, antes
de subirlo.

---

## Cómo probarlo localmente

La landing es estática y **no necesita ningún backend**: no hace ninguna
llamada a Apps Script.

```bash
npx -y http-server frontend -p 8080 -c-1
```

Y abrir <http://localhost:8080/landing.html>.

También sirve la configuración `frontend-static` de `.claude/launch.json`.

### Qué mirar al revisarla

| caso | qué debe pasar |
|---|---|
| carga normal | el hero entra escalonado y, ~1 s después, la fecha se desplaza dejando la huella |
| bajar | el riel marca el estado del acto que se está mirando |
| acto 01 | el reloj de "quien ejecuta" se llena y **se para**; entonces arranca el otro |
| acto 03 | aparecen las cuatro huellas y la fecha vigente |
| **movimiento reducido** | todo visible de una vez, sin gesto; el riel sigue marcando |
| **sin JavaScript** | la página se ve entera y quieta |
| **sin GSAP** (bloqueador, CDN caído) | el relato se muestra completo, sin animar |

Para probar movimiento reducido: activar la preferencia del sistema
(Windows: *Configuración → Accesibilidad → Efectos visuales → Efectos de
animación*), o DevTools → *Rendering* → *Emulate CSS prefers-reduced-motion*.

---

## Cómo se despliega

Igual que el resto del frontend: **se despliega solo** al hacer push a
`main`. GitHub Pages publica `frontend/`. No hay que pegar nada en Apps
Script, porque la landing no tiene backend.

La única precaución es la de siempre en este repositorio: `frontend/js/config.js`
debe estar apuntando a producción antes de commitear (5 ocurrencias de
`script.google.com`). La landing no lo usa, pero comparte carpeta.

---

## Decisiones que conviene no deshacer sin leer esto

**El CSS de la landing está aislado.** `landing.css` no importa `tokens.css`
ni `main.css`, y repite los valores de marca en vez de heredarlos. Es
deliberado: heredar significaría que un cambio en la landing puede llegar al
producto. Si la marca cambia, se cambian los dos sitios.

**La clase `l-anim` se pone en un `<script>` en línea del `<head>`.** El CSS
solo esconde el estado inicial de la entrada cuando esa clase existe. Si se
pusiera desde `landing.js` (que va con `defer`), el hero se vería un instante
y después se ocultaría: un parpadeo. Y si no hay JavaScript, la clase no se
pone y la página se ve entera — degradar mostrando, nunca ocultando.

**No se usa `requestAnimationFrame` en ningún sitio.** rAF no dispara
mientras la página no se está pintando (pestaña en segundo plano). La primera
versión del hero lo usaba y dejaba el hero **invisible para siempre** al
abrirlo en una pestaña de fondo. Es la misma lección que `plataforma.js` ya
tenía escrita para su menú.

**El riel usa `position: sticky`, no el pin de ScrollTrigger.** Sticky es
nativo, no toca el scroll de nadie y no se descoloca si un acto cambia de
alto.

**Las fechas del rastro se escalonan en dos alturas bajo 700 px.** A 349 px
se pisaban hasta leerse "ago02 sep". Se conservan las cinco porque son el
argumento del acto. El `:not(.l-rastro__eje)` del selector excluye al eje,
que también es hijo impar y dibujaba una marca suelta en el borde.

---

## Medido, no supuesto

| | |
|---|---|
| contraste | mínimo **6,21:1** (AA pide 4,5); titular 18,27 |
| 1440×900 | titular 84 px, hero 812 px — cabe en una pantalla |
| 279 px | sin scroll horizontal; el botón pasa a "Entrar" |
| botones | 44 px de alto, una sola línea, en todos los tamaños |
| eje del hero | separación 236 px = desvío 236 px |
| rastro a 279 px | fechas en dos alturas, cero solapes |
| movimiento reducido | a los 900 ms y sin scroll, todo visible y los relojes llenos |

---

## Qué queda pendiente

1. **Es una landing de una sola pieza.** No hay navegación interna ni
   secciones de "qué incluye el sistema". Si la idea es que sirva para
   presentar SIGSO a alguien de fuera, falta esa parte informativa; si es
   una pieza de identidad interna, está completa.

2. **Nadie llega a ella todavía.** Ninguna página enlaza a `landing.html`.
   Decidir si `index.html` la enlaza, si sustituye a la portada, o si vive
   como URL suelta que se comparte a mano.

3. **Contenido real.** Los datos de ejemplo (`SOL-2026-HP-0042`, las cinco
   fechas) están escritos a mano. Podrían salir de una solicitud real
   anonimizada, que haría el argumento más fuerte.

4. **Lenis, si se quiere la inercia** — ver arriba: hay que probar el
   teclado en un navegador real primero.

5. **Idioma.** Todo en español, sin previsión de otro idioma. Correcto para
   el uso actual.

### Lo que se recomienda como siguiente iteración

Antes que añadir nada visual: **decidir el punto 2**. Una landing a la que
nadie llega no cumple ninguna función, por buena que sea, y esa decisión
condiciona si hace falta el punto 1.
