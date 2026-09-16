'use strict';

/**
 * resend.js — cliente minimo para la API HTTP de Resend. Sin SDK: mismo
 * criterio de "sin dependencias externas" que el resto del backend, usando
 * el fetch nativo de Node 22+. Expuesto como funcion propia (no inline en
 * notificaciones.js) para poder mockearla en tests sin tocar la red real.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

async function enviarCorreoResend_(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const err = new Error('RESEND_API_KEY no configurada');
    err.codigo = 'SIN_API_KEY';
    throw err;
  }
  const respuesta = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!respuesta.ok) {
    const texto = await respuesta.text().catch(() => '');
    const err = new Error('Resend respondio ' + respuesta.status + ': ' + texto);
    err.status = respuesta.status;
    throw err;
  }
  return respuesta.json();
}

module.exports = { enviarCorreoResend_ };
