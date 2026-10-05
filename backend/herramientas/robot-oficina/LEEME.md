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

### Varios clientes de una vez (lote)

En la tarjeta del robot, **Varios clientes**: se escriben hasta 15 clientes
(RUT y Clave Tributaria; **Agregar los clientes con convenio** llena los RUT) y
**Revisar N clientes**. El robot los revisa **uno tras otro**, con una pausa de
20 segundos entre cada uno, y la lista muestra el avance. Cada cliente con
convenios queda con **Revisar y aplicar**: nada se aplica sin mirarlo.

- Si la TGR pide un CAPTCHA o rechaza el acceso, el lote **se detiene**: los
  clientes que faltaban quedan como "No se revisó" y no se intentan.
- Las claves se escriben en pantalla y se borran apenas el programa las toma;
  no se guardan en SIGSO, ni en el PC, ni en el registro.
- Requiere este programa actualizado: uno antiguo no anuncia que sabe de lotes y
  SIGSO pide reiniciarlo (Ctrl+C y abrir de nuevo, después de `git pull`).

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

## Que arranque solo con Windows

Una vez configurada la llave, desde la carpeta del proyecto:

```
node backend/herramientas/robot-oficina/agente.js instalar-inicio
```

Deja un acceso en la carpeta Inicio del usuario (`SIGSO Robot TGR.vbs`) que, al
iniciar sesión, abre el robot **sin ventana**; si el programa se cae, vuelve a
abrirlo a los 30 segundos. Lo arranca de inmediato, sin reiniciar el PC. No pide
permisos de administrador ni toca el registro de Windows.

- `agente.js estado`: dice si está instalado y corriendo, y muestra las últimas
  líneas del registro.
- `agente.js quitar-inicio`: lo saca del inicio y lo detiene.
- Registro: `%LOCALAPPDATA%\SIGSO\robot-oficina.log` (se renueva al pasar 1 MB;
  nunca contiene claves).
- Solo corre uno a la vez (`robot-oficina.lock`): si ya hay uno abierto, el
  segundo se cierra solo. Para verlo en pantalla (`--ventana`), primero
  `quitar-inicio`.
- El PC tiene que quedar con la sesión iniciada; para uso diario conviene un PC
  dedicado, siempre encendido.

## Probar sin tocar la TGR real

`--prueba-tgr http://localhost:PUERTO/tramite` usa un sitio local que imita la
TGR (lo arman los tests). Solo acepta direcciones locales.
