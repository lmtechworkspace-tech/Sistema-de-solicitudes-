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

Deja un **acceso directo** en la carpeta Inicio del usuario (`SIGSO Robot TGR`,
con el ícono de Node; se ve en Administrador de tareas › Aplicaciones de
arranque) que, al iniciar sesión, abre el robot **sin ventana propia**. Mientras revisa un cliente sí se ve
Chrome (se cierra al terminar): la TGR rechaza con 403 el navegador invisible
(probado el 5-10-2026), así que no se usa ese modo; si el programa se cae, vuelve a
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

## Cartolas del BCI (desde el 3-11-2026)

El mismo programa trae las cartolas del **BCI Pyme** cuando Finanzas las pide
(Finanzas › Más › Subir archivos › **Traer del BCI**). Hace lo mismo que se hacía
a mano: Banco en Línea Pyme › **Cuentas › Cartola Histórica** › flecha de cada
cartola del mes › **Exportar › Descargar Excel**, y cierra la sesión del banco.
Los Excel se le entregan a SIGSO (en el PC quedan en una carpeta temporal que se
borra) y en Finanzas cada cartola se revisa antes de importar.

- **Chrome siempre se ve** mientras trabaja en el banco (también con el arranque
  automático).
- Si en SIGSO no escribieron la clave, el robot abre el banco y **espera hasta 4
  minutos a que alguien entre a mano en este PC**; después sigue solo. Así la
  clave del banco no pasa por SIGSO.
- Si la escribieron, entra con ella **una sola vez** (el BCI bloquea la clave
  tras varios intentos) y la borra. Nunca va al registro ni al disco.
- Solo entra a **Cuentas**: nunca a transferir ni a pagar.
- Un programa de una versión anterior no toma estos pedidos: después de
  actualizar la carpeta del proyecto (`git pull`), hay que reiniciar el robot
  (`quitar-inicio` y `instalar-inicio`, o cerrar y abrir la terminal).

## Ventas del SII (desde el 9-11-2026)

El mismo programa trae el **detalle del Registro de Ventas** del SII cuando
Finanzas lo pide (Finanzas › Más › Subir archivos › **Traer del SII**). Hace lo
mismo que se hacía a mano: entra al SII con el **RUT de la empresa** y su Clave
Tributaria › Servicios online › Impuestos mensuales › **Registro de compras y
ventas** › Ingresar › RUT y período › **Consultar** › **VENTA** › **Descargar
Detalles**, y cierra la sesión. El CSV se le entrega a SIGSO y en Finanzas se
revisa antes de importar a Cobranza.

- Igual que con el BCI: con la clave escrita en SIGSO entra solo, **una sola
  vez**; sin clave, abre el SII y espera hasta 4 minutos a que alguien entre a
  mano en este PC.
- Solo **lee**: nunca aprieta «Agregar documento», «Agregar resumen», «Ir a
  propuesta F29» ni nada de la pestaña COMPRA.
- Si el SII deja la descarga como «diferida» (meses con muchos documentos), el
  robot lo dice: se baja después desde «Descargas Diferidas» y se sube a mano.
- Un programa anterior no toma estos pedidos: actualiza la carpeta (`git pull`)
  y reinicia el robot (`quitar-inicio` y `instalar-inicio`).

## Actualizarse solo (desde el 9-11-2026)

El robot se pone al día **solo**: entre pedido y pedido, cada 15 minutos, revisa
si hay una versión nueva publicada de su rama. Si la hay, la trae (y si cambiaron
las dependencias, corre `npm install`) y se reinicia; el arranque con Windows lo
vuelve a abrir a los 30 segundos. Nunca lo hace con un pedido en curso.

- Funciona en la carpeta **solo del robot** (`C:\SIGSO-robot`, rama
  `robot-oficina` que sigue a `origin/main`). Se crea una vez con:
  `git worktree add --track -B robot-oficina C:\SIGSO-robot origin/main`,
  `npm.cmd install` e `instalar-inicio` desde esa carpeta.
- Solo **avanza**: si la carpeta tiene cambios sin subir o commits propios, no
  toca nada y lo anota en el registro (`robot-oficina.log`).
- Abierto a mano en una consola, solo avisa que hay versión nueva.
- `node backend/herramientas/robot-oficina/agente.js actualizar` la trae al
  tiro; el robot que está corriendo se reinicia con ella en menos de 15 minutos.
- `--sin-actualizar` lo apaga.

## Probar sin tocar la TGR ni el banco reales

`--prueba-tgr http://localhost:PUERTO/tramite` usa un sitio local que imita la
TGR, y `--prueba-bci http://localhost:PUERTO/login` uno que imita el BCI Pyme
(los arman los tests). Solo aceptan direcciones locales.

## Varios meses de una vez (desde el 12-11-2026)

En Finanzas, «Traer del BCI» y «Traer del SII» piden un rango **Desde · Hasta**
(hasta 12 meses). El robot entra **una sola vez** al banco o al SII y recorre
todos los meses del rango en la misma sesión (la clave, si la escribieron, se usa
una sola vez igual que antes).

- Cada archivo se le entrega a SIGSO **apenas baja** (y cómo quedó cada mes): si
  algo falla a mitad, lo ya bajado no se pierde. Al final no se repite nada.
- Un mes con problema (sin cartolas, sin ventas, descarga diferida, una cartola
  que no abre) se anota y el robot **sigue con el siguiente**. Solo se detiene si
  dos seguidos fallan porque la página se rompió (la sesión probablemente cayó).
- Ya no hay un tope fijo de 10 minutos: el pedido se da por perdido si el PC pasa
  **8 minutos sin dar noticias** (cada paso cuenta), con un máximo de 2 horas.
- Lo traído queda **12 horas** en SIGSO: se puede dejar trabajando y volver.
- Un programa anterior sigue sirviendo para un mes; para varios hay que tener
  esta versión (el robot **se actualiza solo** entre pedidos, en menos de 15
  minutos, si quedó instalado con `instalar-inicio`).
