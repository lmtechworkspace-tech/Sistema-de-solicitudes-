# Robot TGR de la oficina

La TGR rechaza las conexiones que vienen del servidor de SIGSO (403 "Access
Denied", 2-10-2026). Por eso el robot corre en un PC de la oficina, con la misma
conexión a internet que usa el equipo: este programa le pide trabajo a SIGSO,
entra a la TGR y devuelve las cuotas, que se revisan en SIGSO antes de aplicar.

## Qué necesita el PC

- Windows con **Chrome o Edge** (el robot usa el que encuentre).
- **Node.js 22 o más nuevo** (`node --version`).
- Esta carpeta del proyecto SIGSO con sus dependencias (`npm ci` si falta `node_modules`).
- Internet de la oficina (o cualquier internet en Chile). **No** detrás de una VPN que salga por otro país.
- Encendido y sin suspenderse mientras se use el robot.

## Instalar (una vez)

1. En SIGSO, con una cuenta de **administrador**: Control interno › Convenios y
   postergaciones › Seguimiento de cuotas TGR › **Recibir desde la TGR** › en la
   tarjeta del robot, **Robot de la oficina** › **Autorizar este equipo**. Copia
   la llave que aparece: **se muestra una sola vez**.
2. En el PC, en una terminal, desde la carpeta del proyecto:

   ```
   node backend/herramientas/robot-oficina/agente.js configurar
   ```

   Pega la llave (no se ve al escribir) y acepta la dirección de SIGSO que
   propone. Se guarda en `%LOCALAPPDATA%\SIGSO\robot-oficina.json`, fuera de
   OneDrive y fuera del proyecto.

## Usar

Deja abierta una terminal con:

```
node backend/herramientas/robot-oficina/agente.js
```

Para el piloto, conviene ver lo que hace:

```
node backend/herramientas/robot-oficina/agente.js --ventana
```

Mientras esté abierto, la tarjeta del robot en SIGSO dice **"Robot de la oficina
conectado"** y cualquiera que registre en Contabilidad puede usarlo. Se detiene
con Ctrl+C.

## Seguridad

- No abre ningún puerto en el PC: solo hace consultas salientes (HTTPS) a SIGSO.
- Se identifica con su llave; SIGSO guarda solo su huella (hash). Un
  administrador puede dar de baja el equipo en cualquier momento.
- La clave de cada cliente llega en memoria, se usa una vez y se suelta: no se
  escribe en el disco ni en la consola. Las capturas de diagnóstico van a SIGSO.
- Un intento de ingreso por revisión; se detiene ante verificación por correo,
  cambio de clave, CAPTCHA o bloqueo. No se disfraza de persona.
- Todo sale por la IP de la oficina: el robot revisa un cliente a la vez. Si la
  TGR bloqueara esa IP, también afectaría el acceso manual; ante el primer
  bloqueo, el robot se detiene.

## Que arranque solo (después del piloto)

Programador de tareas de Windows › Crear tarea básica › "Al iniciar sesión" ›
Iniciar un programa: `node`, argumentos
`backend\herramientas\robot-oficina\agente.js`, "Iniciar en": la carpeta del
proyecto. Para un uso diario conviene un PC dedicado, siempre encendido.

## Probar sin tocar la TGR real

`--prueba-tgr http://localhost:PUERTO/tramite` usa un sitio local que imita la
TGR (lo arman los tests). Solo acepta direcciones locales.
