'use strict';

/**
 * app.js — nucleo HTTP del backend Node de SIGSO (nuevo ecosistema).
 *
 * Reemplaza el doGet/doPost de Apps Script. Se separa de index.js (que solo
 * hace listen) para poder probarlo sin abrir un puerto fijo: los tests crean
 * el servidor y lo atan al puerto 0 (efimero).
 *
 * Contrato de respuesta identico al de Apps Script: SIEMPRE { ok, data } en
 * exito y { ok:false, error } en fallo. Asi el frontend (api.js) no distingue
 * de donde viene la respuesta y la migracion es transparente para el.
 *
 * Sin dependencias externas: solo modulos nativos de Node. El despliegue no
 * necesita `npm install` -- copiar los .js basta.
 */

const http = require('node:http');

const VERSION_API = '1.0.0-poc';
const ARRANCADO_EN = new Date().toISOString();

function responderJson(res, codigo, payload) {
  const cuerpo = JSON.stringify(payload);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    // El frontend vive en otro origen (GitHub Pages / ctrly.cl); permitir CORS
    // para las llamadas de la plataforma. Se restringira por origen cuando el
    // dominio final este fijo.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(cuerpo);
}

async function manejar(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ruta = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    return responderJson(res, 204, {});
  }

  // Salud / smoke-test. Mismo rol que el doGet de Apps Script: confirma que el
  // servicio esta vivo sin necesidad de login.
  if (req.method === 'GET' && (ruta === '/' || ruta === '/v1/estado')) {
    return responderJson(res, 200, {
      ok: true,
      data: {
        servicio: 'SIGSO API',
        estado: 'activo',
        version: VERSION_API,
        node: process.version,
        arrancado_en: ARRANCADO_EN,
        ts: new Date().toISOString()
      }
    });
  }

  return responderJson(res, 404, { ok: false, error: 'Ruta no encontrada: ' + ruta });
}

function crearServidor() {
  return http.createServer((req, res) => {
    manejar(req, res).catch((err) => {
      console.error('error no capturado en la peticion:', err);
      if (!res.headersSent) responderJson(res, 500, { ok: false, error: 'Error interno del servidor' });
    });
  });
}

module.exports = { crearServidor, manejar, responderJson, VERSION_API };
