# Control interno — las matrices de Contabilidad y RR.HH. en SIGSO

Inicio: 2026-10-01. Pedido del dueño: pasar las matrices que hoy se llenan en el
Drive a SIGSO, para probar si ingresar los datos aquí suma al proceso y, sobre
todo, para sacar reportes (hoy no se sacan por lo difícil que es en el Drive).
**Mientras dure la prueba, el registro oficial para la certificación sigue en el
Drive.** El módulo no escribe en el SGC (Calidad › Servicios prestados).

## Qué hay

| Departamento | Matrices |
|---|---|
| Contabilidad | Facturación · Informe y pago de IVA · Contabilización mensual · Convenios y postergaciones · Acuse de recibo · Anotaciones y notificaciones |
| RR.HH. | Remuneraciones · Contratos · Anexos · Finiquitos · Finiquito electrónico · Licencias médicas · Certificados F30 y F30-1 · Constancias laborales · Cartas de aviso · Libro de remuneraciones (LRE) · Plataformas externas · Moras e imposiciones impagas |

Cada matriz es **configuración** de un solo motor: `backend/logica/controlInternoMatrices.js`
(campos, listas, estados, qué se ve en la grilla, qué se copia al abrir el mes).
Agregar o cambiar una matriz es editar ese archivo.

Lo que la planilla resolvía a mano y aquí lo resuelve la estructura:

- una hoja por mes → cada registro tiene su período;
- columnas repetidas (Convenio 1…9) → una lista dentro del registro, y el estado
  ("Al día" / "Con cuotas vencidas") se calcula solo;
- 25 subtareas con quién/cuándo (Contabilización) → una checklist con avance;
- hojas RLE aparte → "Cargado en la DT" dentro de Contratos, Anexos y Finiquitos;
- F30 y F30-1 en hojas separadas → una matriz con el tipo de certificado;
- estados escritos a mano (20 formas de "activa") → listas cerradas.

Observaciones de la auditoría de procesos (30-09) que quedan cubiertas en la
estructura: Facturación pide la **cotización / referencia**; Finiquitos pide
**quién validó el cálculo** y cuándo; todo registro terminado espera la
**liberación** de quien libera el área, nunca la de quien lo realizó.

## Permisos (verificados en el servidor)

1. La cuenta necesita el módulo **Control interno** (Administración › Cuentas).
   ADM lo tiene siempre.
2. Por departamento (Control interno › Accesos, solo ADM): **Registra** o
   **Solo lectura**.
3. Ven todo sin registrar: Gerencia y el Encargado del SGC.
4. **Libera** quien libera el área en Calidad › Servicios prestados › *Quién libera*
   (una sola lista para los dos módulos), además de la jefatura de área y el
   Encargado del SGC. Nadie libera lo que realizó. Editar algo liberado le quita
   la liberación (vuelve a revisión) y queda en el historial.

## Datos y escala

- Tablas: `CI_REGISTROS` (lo propio de cada matriz va en `datos`), `CI_MIEMBROS`,
  `CI_HISTORIAL`. Se crean solas al desplegar.
- Siempre se consulta filtrando en SQL por matriz + período con índice
  (`ix_ci_registros_matriz_periodo`, creado por `controlInterno.js`). Medido:
  0,2 ms por consulta con 100.000 registros; el volumen real es ~10.000 al año.
- Clientes: se eligen del catálogo; si no está, se escribe el nombre y queda
  marcado "Fuera del catálogo" (el reporte los cuenta: es la conciliación
  pendiente).

## Pendiente (decidir con el uso)

- Importar 2026 desde las planillas (acordado: 2026 completo + totales por año
  2022–2025) cuando se decida pasar de prueba a uso real.
- Que la liberación aquí genere la evidencia de Servicios prestados (§8.5/8.6)
  sin doble registro — hoy apagado a propósito mientras el Drive sea el oficial.
