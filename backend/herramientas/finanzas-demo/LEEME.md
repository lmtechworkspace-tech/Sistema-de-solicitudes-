# Herramientas de demostración y piloto de Finanzas

Sirven para ver, probar y hacer el piloto de Finanzas en local, con **datos ficticios**. No son para el servidor.

## Protección (`guardia.js`)

Las herramientas que arman una base **borran y vuelven a crear** `sigso.db` y `finanzas.db` en la carpeta que se
les indica. Por eso, todas se niegan si:

- `NODE_ENV=production`;
- la carpeta es de servidor (`/opt`, `/var`, `/srv`, `/etc`) o es la de producción;
- la carpeta está **dentro del repositorio**, porque una base nunca se versiona;
- el nombre de la carpeta no dice «demo», «piloto» o «ensayo»;
- ya hay una `sigso.db` con más de 5 cuentas, porque parece una base real.

## Claves y secretos

- La clave y los secretos TOTP se generan **al azar** en cada base.
- Quedan en `acceso.txt` y `secretos.json`, dentro de esa carpeta y fuera del repositorio.
- No hay claves de demostración fijas.

## Comandos

```
node backend/herramientas/finanzas-demo/preparar-demo.js   C:/sigso-demo     # base de demostración
node backend/herramientas/finanzas-demo/preparar-piloto.js C:/sigso-piloto   # base del piloto (6 tareas)
node backend/herramientas/finanzas-demo/ensayo-piloto.js   C:/sigso-piloto   # resuelve las 6 tareas en una COPIA
node backend/herramientas/finanzas-demo/servidor.js        C:/sigso-demo     # API en el puerto 3099 con esa base
node backend/herramientas/finanzas-demo/codigo.js          C:/sigso-demo demo   # código TOTP del momento
```

**Para usar la pantalla:** el frontend local debe apuntar a `http://127.0.0.1:3099`. Ese cambio en
`frontend/js/config.js` es **solo local y jamás se sube**.

## Verificación

**`huella-boveda.js`** compara un respaldo con su restauración (QA-R22):

```
SIGSO_FINANZAS_LLAVE=... node backend/herramientas/finanzas-demo/huella-boveda.js <carpeta>
```

- Imprime conteos y una huella sin importes.
- Se corre **sobre copias**, nunca sobre `/opt/sigso/data`.

**`aceptacion-fuentes-reales.js`** prueba T01, T02, T04, T07–T10 y T37 con las fuentes reales:

```
node backend/herramientas/finanzas-demo/aceptacion-fuentes-reales.js <carpeta datos-iniciales>
```

- Trabaja en una bóveda temporal que se borra al terminar.
- La carpeta de datos es confidencial y está excluida en `.gitignore`.
- Solo imprime totales y conteos.

**Guion del piloto:** `documentacion/finanzas-v2-correccion/I13-guion-piloto.md`.
