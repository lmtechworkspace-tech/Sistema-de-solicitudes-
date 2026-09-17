/**
 * Migracion.gs — TEMPORAL. Exporta como JSON las hojas reales que el nuevo
 * backend Node/SQLite (ver backend/db/schema.js) necesita para el corte de
 * Apps Script + Sheets al VPS. Solo ADM. Se puede borrar este archivo (y su
 * entrada en Code.gs) una vez terminada la migracion de datos.
 *
 * Deliberadamente NO exporta:
 *  - hash_password/salt de CUENTAS_PORTAL: el backend nuevo usa scrypt
 *    (backend/logica/passwordHash.js), incompatible con el hash viejo -- las
 *    cuentas migradas necesitan clave nueva de todas formas, asi que no hay
 *    ninguna razon para hacer viajar el hash por HTTP.
 *  - SESIONES_PORTAL: efimero, no tiene sentido migrar sesiones activas.
 *  - LOG_NOTIFICACIONES/LOG_SISTEMA: historial operativo del sistema viejo,
 *    no datos de negocio -- el nuevo backend empieza su propio historial.
 *
 * Uso: action=exportarDatosMigracion, data={ hoja: 'SOLICITUDES' } (una hoja
 * a la vez, para no armar una respuesta gigante) o data={} para traer TODAS
 * las de HOJAS_MIGRACION_ en un solo JSON (ok si el volumen real es chico).
 */

var HOJAS_MIGRACION_ = [
  'CAT_EMPRESAS', 'CAT_PLATAFORMAS', 'CAT_MODULOS', 'CAT_TIPOS', 'CAT_AREAS',
  'CONFIG_NOTIFICACIONES', 'CONFIG_SLA', 'CONFIG_FERIADOS',
  'USUARIOS', 'JEFATURAS',
  'SOLICITUDES', 'SUBSOLICITUDES', 'HISTORIAL_ESTADOS',
  'HISTORIAL_PRIORIDAD', 'HISTORIAL_COMPROMISO', 'HISTORIAL_ASIGNACION',
  'COMENTARIOS', 'ARCHIVOS', 'COUNTERS',
  'CUENTAS_PORTAL'
];

function exportarDatosMigracion_(data, contexto) {
  if (contexto.rol !== 'ADM') {
    return { _forbidden: true, message: 'Solo un Administrador puede exportar datos para la migracion.' };
  }
  var soloHoja = data && data.hoja;
  if (soloHoja && HOJAS_MIGRACION_.indexOf(soloHoja) === -1) {
    return { _validationError: true, message: 'Hoja no reconocida para migracion: ' + soloHoja, fields: [] };
  }
  var hojas = soloHoja ? [soloHoja] : HOJAS_MIGRACION_;
  var resultado = {};
  hojas.forEach(function (nombre) {
    var filas = leerFilasSeguro_(SHEETS[nombre] || nombre);
    if (nombre === 'CUENTAS_PORTAL') {
      filas = filas.map(function (f) {
        var copia = Object.assign({}, f);
        delete copia.hash_password;
        delete copia.salt;
        return copia;
      });
    }
    resultado[nombre] = filas;
  });
  return resultado;
}
