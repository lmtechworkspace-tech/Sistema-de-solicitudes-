'use strict';

/**
 * credencialesClientes.js — claves de los clientes (2026-10-19).
 *
 * Pedido del dueño: tener, como la planilla de HomePymes, una tabla por
 * empresa cliente con su mutual adherida y el usuario y la clave de la Mutual
 * y de la SEREMI, para que Prevención entre a esos portales; y resguardar
 * esas claves. Decisiones aprobadas:
 *  - Vive dentro de Credenciales (no en Prevención, que sigue en obra), en la
 *    categoría «Claves de clientes»: quien tenga esa categoría la ve; el
 *    acceso lo da el super admin, como cualquier categoría.
 *  - Mismo resguardo que el resto de la bóveda (credenciales.js): la clave va
 *    cifrada (AES-256-GCM), verla o cambiarla pide el código del teléfono y
 *    cada vista queda en la bitácora encadenada. La lista trae el usuario,
 *    nunca la clave. No hay exportación con claves (la planilla original las
 *    bajaba en CSV/Excel a cualquiera).
 *  - Una fila por empresa y portal (MUTUAL | SEREMI). La empresa sale de la
 *    base de clientes (CAT_CLIENTES); si no está, se guarda por su RUT.
 *  - Por ahora sin la clave del SII.
 *  - Mejoras sobre la planilla: «¿funcionó?» después de usar una clave (las
 *    de clientes cambian sin aviso), carga masiva pegando desde Excel con vista
 *    previa, y validación del RUT.
 */

const crypto = require('node:crypto');
const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion } = require('./errores');
const C = require('./credenciales');

const TIPOS = {
  MUTUAL: { nombre: 'Mutual', url: '' },
  SEREMI: { nombre: 'SEREMI de Salud', url: 'https://seremienlinea.minsal.cl' }
};
// Organismo administrador del seguro de la Ley 16.744. ISL = sin mutual.
const MUTUALES = [
  { id: 'ACHS', nombre: 'ACHS', url: 'https://www.achs.cl' },
  { id: 'IST', nombre: 'IST', url: 'https://www.ist.cl' },
  { id: 'MUTUAL', nombre: 'Mutual de Seguridad CChC', url: 'https://www.mutual.cl' },
  { id: 'ISL', nombre: 'ISL (sin mutual)', url: 'https://www.isl.gob.cl' }
];
const ESTADOS = ['SIN_PROBAR', 'FUNCIONA', 'NO_FUNCIONA'];
const MAX_IMPORTAR = 1000;

// ---------------------------------------------------------------- utilidades

function rutLimpio_(rut) { return String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase().replace(/^0+/, ''); }
/** «76.353.457-K» si el dígito verificador cuadra; '' si no. */
function rutValido_(rut) {
  const s = rutLimpio_(rut);
  if (s.length < 7 || s.length > 9) return '';
  const cuerpo = s.slice(0, -1), dv = s.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return '';
  let suma = 0, mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const r = 11 - (suma % 11), esperado = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  if (esperado !== dv) return '';
  return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
}
/** Reconoce cómo se escribe la mutual en una planilla. '' si no se entiende. */
function mutualDe_(texto) {
  const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (!t) return '';
  if (/\bachs\b|asociacion chilena/.test(t)) return 'ACHS';
  if (/\bist\b|instituto de seguridad del trabajo/.test(t)) return 'IST';
  if (/\bisl\b|instituto de seguridad laboral|\binp\b|\bips\b/.test(t)) return 'ISL';
  if (/mutual|cchc|camara chilena/.test(t)) return 'MUTUAL';
  return '';
}
function clientesCat_(db) { try { return leerFilas_(db, 'CAT_CLIENTES', COLUMNAS.CAT_CLIENTES); } catch (e) { return []; } }
function activo_(c) { return c.activo === true || c.activo === 'TRUE' || c.activo === 1 || c.activo === '1'; }
function puede_(contexto) { return C.puedeCategoria_(contexto, C.CAT_CLIENTES); }
function publica_(f) {
  return {
    id: f.id, cliente_id: f.cliente_id, razon_social: f.razon_social || '', rut: f.rut || '', tipo: f.tipo, institucion: f.institucion || '',
    usuario: f.usuario || '', url: f.url || '', notas: f.notas || '', tiene_clave: !!f.secreto,
    estado: f.estado, estado_nota: f.estado_nota || '', verificada_en: f.verificada_en || '', verificada_por: f.verificada_por || '',
    clave_cambiada_en: f.clave_cambiada_en || '', actualizado_por: f.actualizado_por || '', actualizada_en: f.actualizada_en || f.creada_en
  };
}
function detalle_(f) { return (TIPOS[f.tipo] || { nombre: f.tipo }).nombre + (f.tipo === 'MUTUAL' && f.institucion ? ' (' + f.institucion + ')' : '') + ' · ' + (f.razon_social || f.rut || f.cliente_id); }

/** Resuelve la empresa: por cliente_id de la base, o por RUT (de la base o suelta). */
function empresa_(db, data) {
  const cat = clientesCat_(db);
  if (data.cliente_id && !/^RUT-/.test(String(data.cliente_id))) {
    const c = cat.find((x) => String(x.cliente_id) === String(data.cliente_id));
    return c ? { cliente_id: String(c.cliente_id), razon_social: c.razon_social || '', rut: c.rut || '' } : null;
  }
  const rut = rutValido_(data.rut || String(data.cliente_id || '').replace(/^RUT-/, ''));
  if (!rut) return null;
  const c = cat.find((x) => rutLimpio_(x.rut) === rutLimpio_(rut));
  if (c) return { cliente_id: String(c.cliente_id), razon_social: c.razon_social || '', rut: c.rut || rut };
  const nombre = C.linea_(data.razon_social, 160);
  return nombre ? { cliente_id: 'RUT-' + rutLimpio_(rut), razon_social: nombre, rut } : null;
}

// ---------------------------------------------------------------- lectura (sin bóveda)

/** Empresas + sus filas (sin claves). Basta con la sesión de SIGSO y la categoría. */
function datos(db, data, contexto) {
  if (!C.tieneAcceso(db, contexto) || !puede_(contexto)) return C.NO_ENCONTRADO;
  const filas = C.dbCred().prepare('SELECT * FROM CRED_CLIENTES ORDER BY razon_social').all().map(publica_);
  const clientes = clientesCat_(db).map((c) => ({
    cliente_id: String(c.cliente_id), razon_social: c.razon_social || '', rut: c.rut || '', codigo: c.codigo_cliente || '',
    estado: c.estado || '', bloqueo: c.bloqueo || '', activo: activo_(c)
  }));
  // Las que solo existen por su RUT (no están en la base de clientes).
  const ids = new Set(clientes.map((c) => c.cliente_id));
  const sueltas = {};
  filas.forEach((f) => { if (!ids.has(f.cliente_id) && !sueltas[f.cliente_id]) sueltas[f.cliente_id] = { cliente_id: f.cliente_id, razon_social: f.razon_social, rut: f.rut, codigo: '', estado: '', bloqueo: '', activo: true, fuera_de_base: true }; });
  return {
    clientes: clientes.concat(Object.values(sueltas)).sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es')),
    filas,
    catalogos: { tipos: TIPOS, mutuales: MUTUALES }
  };
}

// ---------------------------------------------------------------- con bóveda

const verClave = C.conBoveda(function (db, data, contexto, x) {
  if (!puede_(contexto)) return C.NO_ENCONTRADO;
  const f = C.dbCred().prepare('SELECT * FROM CRED_CLIENTES WHERE id = ?').get(String(data.id || ''));
  if (!f) return errorValidacion('id', 'Esa clave ya no existe.');
  const s = f.secreto ? C.json_(C.descifrar(f.secreto), {}) : {};
  x.registrar('VER_CLAVE', { categoria_id: C.CAT_CLIENTES, credencial_id: f.id, detalle: detalle_(f) });
  return { clave: s.clave || '' };
});

/** Crea o edita la fila de una empresa para un portal. La clave vacía no borra la guardada. */
const guardar = C.conBoveda(function (db, data, contexto, x) {
  if (!puede_(contexto)) return C.NO_ENCONTRADO;
  const tipo = String(data.tipo || '').toUpperCase();
  if (!TIPOS[tipo]) return errorValidacion('tipo', 'Elige Mutual o SEREMI.');
  const emp = empresa_(db, data);
  if (!emp) return errorValidacion('rut', data.cliente_id ? 'Esa empresa no está en la base de clientes.' : 'Escribe un RUT válido y el nombre de la empresa.');
  const r = escribir_(emp, tipo, data, x);
  return { fila: publica_(C.dbCred().prepare('SELECT * FROM CRED_CLIENTES WHERE id = ?').get(r.id)) };
});

/** Escribe una fila (lo usan guardar e importar). Devuelve { id, accion }. */
function escribir_(emp, tipo, data, x) {
  const d = C.dbCred();
  const previa = d.prepare('SELECT * FROM CRED_CLIENTES WHERE cliente_id = ? AND tipo = ?').get(emp.cliente_id, tipo);
  const clavePrevia = previa && previa.secreto ? C.json_(C.descifrar(previa.secreto), {}).clave || '' : '';
  const claveNueva = data.clave === undefined || data.clave === null ? '' : String(data.clave).slice(0, 200);
  const borrar = data.borrar_clave === true || data.borrar_clave === 'true';
  const clave = borrar ? '' : (claveNueva || clavePrevia);
  const cambio = !borrar && !!claveNueva && claveNueva !== clavePrevia;
  const institucion = tipo === 'MUTUAL' ? (mutualDe_(data.institucion) || (data.institucion === undefined && previa ? previa.institucion : '')) : C.linea_(data.institucion, 80);
  const ahora = new Date().toISOString();
  const fila = {
    razon_social: emp.razon_social, rut: emp.rut, institucion: institucion || '',
    usuario: data.usuario === undefined && previa ? previa.usuario : C.linea_(data.usuario, 160),
    url: data.url === undefined && previa ? previa.url : C.url_(data.url),
    notas: data.notas === undefined && previa ? previa.notas : C.texto_(data.notas, 1000),
    secreto: clave ? C.cifrar(JSON.stringify({ clave })) : null,
    // Una clave nueva no se ha probado todavía.
    estado: cambio || borrar ? 'SIN_PROBAR' : (previa ? previa.estado : 'SIN_PROBAR'),
    estado_nota: cambio || borrar ? '' : (previa ? previa.estado_nota : ''),
    clave_cambiada_en: cambio ? C.hoy_() : (previa ? previa.clave_cambiada_en : ''),
    actualizado_por: x.nombre, actualizada_en: ahora
  };
  if (previa) {
    d.prepare('UPDATE CRED_CLIENTES SET ' + Object.keys(fila).map((k) => k + ' = ?').join(', ') + ' WHERE id = ?').run(...Object.values(fila), previa.id);
    const accion = borrar ? 'BORRAR_CLAVE' : cambio ? 'CAMBIAR_CLAVE' : 'EDITAR';
    if (x.registrar) x.registrar(accion, { categoria_id: C.CAT_CLIENTES, credencial_id: previa.id, detalle: detalle_(Object.assign({}, previa, fila)) });
    return { id: previa.id, accion };
  }
  const id = 'CC-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const nueva = Object.assign({ id, cliente_id: emp.cliente_id, tipo, creado_por: x.nombre, creada_en: ahora }, fila);
  d.prepare('INSERT INTO CRED_CLIENTES (' + Object.keys(nueva).join(', ') + ') VALUES (' + Object.keys(nueva).map(() => '?').join(', ') + ')').run(...Object.values(nueva));
  if (x.registrar) x.registrar('CREAR', { categoria_id: C.CAT_CLIENTES, credencial_id: id, detalle: detalle_(nueva) });
  return { id, accion: 'CREAR' };
}

/** «¿Funcionó?» después de usar la clave. */
const marcar = C.conBoveda(function (db, data, contexto, x) {
  if (!puede_(contexto)) return C.NO_ENCONTRADO;
  const d = C.dbCred();
  const f = d.prepare('SELECT * FROM CRED_CLIENTES WHERE id = ?').get(String(data.id || ''));
  if (!f) return errorValidacion('id', 'Esa clave ya no existe.');
  const estado = ESTADOS.indexOf(data.estado) !== -1 && data.estado !== 'SIN_PROBAR' ? data.estado : null;
  if (!estado) return errorValidacion('estado', 'Indica si funcionó o no.');
  const nota = estado === 'NO_FUNCIONA' ? C.linea_(data.nota, 200) : '';
  d.prepare('UPDATE CRED_CLIENTES SET estado = ?, estado_nota = ?, verificada_en = ?, verificada_por = ? WHERE id = ?').run(estado, nota, new Date().toISOString(), x.nombre, f.id);
  x.registrar(estado === 'FUNCIONA' ? 'CLAVE_FUNCIONA' : 'CLAVE_NO_FUNCIONA', { categoria_id: C.CAT_CLIENTES, credencial_id: f.id, detalle: detalle_(f) + (nota ? ': ' + nota : '') });
  return { fila: publica_(d.prepare('SELECT * FROM CRED_CLIENTES WHERE id = ?').get(f.id)) };
});

/**
 * Carga masiva. filas: [{ rut, empresa, mutual, usuario_mutual, clave_mutual,
 * usuario_seremi, clave_seremi }] (el navegador ya leyó lo pegado desde Excel).
 * Sin `confirmar` solo devuelve la vista previa; nada se guarda. Una celda de
 * clave vacía nunca borra la clave que ya estaba.
 */
const importar = C.conBoveda(function (db, data, contexto, x) {
  if (!puede_(contexto)) return C.NO_ENCONTRADO;
  const entrada = Array.isArray(data.filas) ? data.filas : [];
  if (!entrada.length) return errorValidacion('filas', 'No llegó ninguna fila.');
  if (entrada.length > MAX_IMPORTAR) return errorValidacion('filas', 'Son más de ' + MAX_IMPORTAR + ' filas: divídelas en partes.');
  const d = C.dbCred(), vistos = new Set(), resultado = [];
  const conteo = { nuevas: 0, actualizadas: 0, sin_cambios: 0, errores: 0, fuera_de_base: 0 };
  const plan = [];
  entrada.forEach((e, i) => {
    const linea = i + 1, empresa = C.linea_(e && e.empresa, 160), rutTxt = C.linea_(e && e.rut, 20);
    const emp = empresa_(db, { rut: rutTxt, razon_social: empresa });
    if (!rutValido_(rutTxt)) { conteo.errores++; resultado.push({ linea, empresa, rut: rutTxt, problema: 'RUT inválido' }); return; }
    if (!emp) { conteo.errores++; resultado.push({ linea, empresa, rut: rutTxt, problema: 'Falta el nombre de la empresa (no está en la base de clientes)' }); return; }
    if (vistos.has(emp.cliente_id)) { conteo.errores++; resultado.push({ linea, empresa, rut: rutTxt, problema: 'RUT repetido en la planilla (se usa la primera fila)' }); return; }
    vistos.add(emp.cliente_id);
    if (/^RUT-/.test(emp.cliente_id)) conteo.fuera_de_base++;
    const mutualTxt = C.linea_(e.mutual, 80), mutual = mutualDe_(mutualTxt);
    const avisos = [];
    if (mutualTxt && !mutual) avisos.push('No se reconoce la mutual «' + mutualTxt + '»');
    const porTipo = [
      ['MUTUAL', { institucion: mutual || undefined, usuario: C.linea_(e.usuario_mutual, 160), clave: String((e && e.clave_mutual) || '').trim() }],
      ['SEREMI', { usuario: C.linea_(e.usuario_seremi, 160), clave: String((e && e.clave_seremi) || '').trim() }]
    ];
    porTipo.forEach(([tipo, v]) => {
      const tieneAlgo = v.usuario || v.clave || (tipo === 'MUTUAL' && mutual);
      if (!tieneAlgo) return;
      const previa = d.prepare('SELECT * FROM CRED_CLIENTES WHERE cliente_id = ? AND tipo = ?').get(emp.cliente_id, tipo);
      let cambia = !previa;
      if (previa) {
        const clavePrevia = previa.secreto ? C.json_(C.descifrar(previa.secreto), {}).clave || '' : '';
        cambia = (v.usuario && v.usuario !== previa.usuario) || (v.clave && v.clave !== clavePrevia) || (tipo === 'MUTUAL' && mutual && mutual !== previa.institucion);
      }
      if (!cambia) { conteo.sin_cambios++; return; }
      conteo[previa ? 'actualizadas' : 'nuevas']++;
      // Solo se mandan los campos que trae la planilla: lo demás se conserva.
      const datosFila = { clave: v.clave || undefined };
      if (v.usuario) datosFila.usuario = v.usuario;
      if (tipo === 'MUTUAL') datosFila.institucion = mutual || (previa ? previa.institucion : '');
      if (!previa) { datosFila.url = ''; datosFila.notas = ''; if (!v.usuario) datosFila.usuario = ''; }
      plan.push({ emp, tipo, datos: datosFila });
    });
    resultado.push({ linea, empresa: emp.razon_social, rut: emp.rut, fuera_de_base: /^RUT-/.test(emp.cliente_id), avisos });
  });
  if (!data.confirmar) return { vista_previa: true, conteo, filas: resultado };
  plan.forEach((p) => escribir_(p.emp, p.tipo, p.datos, { nombre: x.nombre }));
  x.registrar('IMPORTAR_CLIENTES', { categoria_id: C.CAT_CLIENTES, detalle: conteo.nuevas + ' nuevas, ' + conteo.actualizadas + ' actualizadas, ' + conteo.errores + ' con error' });
  return { vista_previa: false, conteo, filas: resultado };
});

module.exports = { datos, verClave, guardar, marcar, importar, TIPOS, MUTUALES, rutValido_, mutualDe_ };
