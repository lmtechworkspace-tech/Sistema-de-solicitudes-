/**
 * api.js — Cliente compartido para llamar a los Web Apps de Apps Script.
 *
 * Dos transportes segun donde corra la pagina:
 * - Intake (index.html/estado.html, GitHub Pages): POST + Content-Type
 *   text/plain;charset=utf-8 + cuerpo string JSON { action, data } (§4.1).
 *   Nunca application/json ni headers custom: cualquiera de los dos
 *   dispara un preflight OPTIONS que el Web App no responde.
 * - Backoffice (app.html/admin.html, Fase 8): estas paginas las sirve el
 *   propio proyecto Apps Script via HtmlService, y usan `google.script.run`
 *   en vez de fetch. No es una preferencia de estilo: un fetch cross-origin
 *   contra un Web App que exige identidad de Google (no anonimo) requiere
 *   la cookie de sesion de Google como "cookie de tercero", y los
 *   navegadores actuales la bloquean cada vez mas agresivo incluso fuera de
 *   modo incognito -- rompe el fetch con 401 antes de llegar al script.
 *   `google.script.run` no usa red ni cookies (puente nativo del sandbox
 *   de Apps Script), asi que evita ese problema por completo.
 */
async function llamarApi(url, action, data) {
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    return new Promise(function (resolve, reject) {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .ejecutarAccionBackoffice(action, data || {});
    });
  }
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, data: data || {} })
  });
  return respuesta.json();
}
