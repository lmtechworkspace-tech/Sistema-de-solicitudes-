# SIGSO — UI Guidelines (Design System v5.0)

> Contrato visual del sistema. Toda pantalla o componente nuevo se valida
> contra este documento y contra `frontend/styleguide.html` (la versión
> viva, en claro y oscuro) antes de mergearse. Fuente de tokens:
> `frontend/css/tokens.css` — **nunca** un hex suelto en una regla.

---

## 1. Color

**La regla del 90%**: en cualquier viewport, el 90% debe ser
fondo/superficie/texto. Si un color aparece más de 3 veces, está mal usado.

| Quién | Cuándo | Nunca |
|---|---|---|
| `--primario` (índigo) | LA acción primaria de la pantalla (una sola), links, foco, selección, ítem de nav activo | Fondos grandes, texto largo, decoración |
| `--acento-marca` (naranja) | Logo y momentos de marca (login, encabezado de PDF) | Botones, estados, navegación |
| `--ok/--alerta/--critico/--info` | Estados con significado (semáforo, SLA, alertas) | Decoración, "para que se vea alegre" |
| `--p1..--p5` | Solo la escala de prioridad | Estados generales (para eso están los semánticos) |
| Neutros | Todo lo demás | — |

Cada color tiene su par `-suave` para fondos de pastilla/selección, con el
texto en la variante `tinta`/oscura correspondiente (contraste AA mínimo).

## 2. Tipografía

- Inter, pesos **400/500/600** únicamente (700 solo en cifras de KPI si hace
  falta énfasis extra; nunca en texto).
- Títulos grandes con `letter-spacing` negativo leve (−0.02em / −0.01em).
- **Toda cifra usa números tabulares** (`.sigso-cifra` o herencia de tabla).
- IDs de solicitud siempre en `.sigso-id` (mono).

## 3. Espaciado, radio, elevación

- Escala de 4px (`--esp-1..7`). Padding mínimo de card: `--esp-5` (24px).
- Radios: `--radio-sm 8` inputs/badges, `--radio-md 12` cards/botones,
  `--radio-lg 16` modales/paneles. **Nada de 4px.**
- **Dos sombras y no más**: `--sombra-1` reposo, `--sombra-2` flotante
  (modal, popover, hover clicable). La separación entre superficies la
  hacen bordes de 1px (`--borde`) y diferencias de fondo, no sombras.

## 4. Movimiento

- `--mov-normal` (150ms ease-out) para hover/estado; `--mov-entrada` para
  aparición de paneles. Nada más largo que 200ms.
- Sin parallax, sin scroll-jacking, sin animación decorativa. Todo
  movimiento tiene causa (feedback de una acción del usuario).
- `prefers-reduced-motion` se respeta globalmente (ya está en main.css).

## 5. Componentes — decisiones fijas

- **Un botón primario por pantalla.** Actualizar/Exportar/Imprimir son
  secundarios siempre.
- Botón secundario = borde neutro + texto (no outline de color).
- Inputs: borde neutro, foco con borde primario + halo `--primario-suave`.
- Tablas de trabajo (bandeja/gerencia/depto): **densas** — están para
  trabajar 4 horas al día, no para lucirse. Cards solo en Home y móvil.
- Estados de carga: skeleton (F4). Mientras tanto, `sigso-cargando`.
- Estados vacíos: icono + texto + siguiente acción (ya existe el patrón).

## 6. Voz y microcopy

Español chileno directo, sin exclamaciones ni emojis en la UI. Se dice qué
pasó y qué hacer después: *"No se pudo cargar el panel. Reintenta con
'Actualizar'; si persiste, avisa a soporte."* — nunca *"¡Ups! Algo salió
mal 🚀"*. Los emojis quedan solo en correos (donde sí funcionan).

## 7. Checklist anti-"generado por IA"

Revisar antes de dar por buena cualquier pantalla:

- [ ] ¿Hay gradientes decorativos o glassmorphism? → fuera.
- [ ] ¿Hay emojis como íconos de UI? → reemplazar por `iconos.js` o puntos
      de color.
- [ ] ¿La grilla es una simetría perfecta de tarjetitas iguales con ícono
      centrado? → romper con jerarquía asimétrica (zona principal + rail).
- [ ] ¿El color primario aparece en más de 3 lugares? → recortar.
- [ ] ¿Los números alinean dígito a dígito? (tabular-nums)
- [ ] ¿El foco por teclado se ve en cada elemento interactivo?
- [ ] ¿Funciona y se lee bien en modo oscuro? (styleguide + pantalla real)
- [ ] ¿El microcopy dice qué hacer después, con la voz del sistema?

## 8. Cómo agregar algo nuevo

1. ¿Existe ya un componente que lo resuelve? Usarlo (styleguide.html es el
   catálogo).
2. Si es nuevo: se construye con tokens, se agrega al styleguide en claro y
   oscuro, y recién después se usa en una pantalla.
3. Nunca un hex/px mágico en una regla: si falta un token, se agrega a
   `tokens.css` con su par oscuro y se documenta aquí.
