/**
 * api.js — Cliente HTTP compartido para llamar a los Web Apps de Apps Script.
 *
 * Contrato obligatorio (§4.1): POST + Content-Type text/plain;charset=utf-8 +
 * cuerpo string JSON { action, data }. Nunca application/json ni headers
 * custom (Authorization, X-*): cualquiera de los dos dispara un preflight
 * OPTIONS que el Web App no responde (bloqueador de dia 1, §4).
 */
async function llamarApi(url, action, data) {
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, data: data || {} })
  });
  return respuesta.json();
}
