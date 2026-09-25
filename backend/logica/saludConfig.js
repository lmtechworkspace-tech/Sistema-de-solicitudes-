'use strict';

/**
 * saludConfig.js — SIGSO v2, Módulo 7A: "Salud de la configuración"
 * (análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * Administración tenía 15 pantallas y ninguna decía qué estaba mal
 * configurado, aunque la configuración de una cosa depende de otra (una
 * jefatura necesita que el jefe tenga cuenta Y el módulo; la lista de pausas
 * necesita cuenta Y módulo…). Aquí se revisa todo junto y, para los casos
 * simples, se ofrece un arreglo que el administrador confirma (decisión del
 * dueño). Los que requieren criterio llevan a la pantalla correspondiente.
 *
 * Solo ADM. Los arreglos pasan por las MISMAS funciones que usan las
 * pantallas de Administración (CuentasPortal.gestionar, Pausas.gestionar-
 * Trabajador): mismas validaciones y reglas (p. ej. RN-030).
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { parsearListaPortal } = require('./portal');
const CuentasPortal = require('./cuentasPortal');
const Pausas = require('./pausas');

const DIA = 86400000;
const PLANTILLA = /\[[A-Z_]+\]/;

function leer_(db, hoja) { try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (e) { return []; } }
function v_(x) { return x === true || x === 'TRUE' || x === 1 || x === 'true'; }
function n_(e) { return String(e || '').trim().toLowerCase(); }

function contexto_(db) {
  const cuentas = leer_(db, 'CUENTAS_PORTAL').map((c) => Object.assign({}, c, {
    emailsL: parsearListaPortal(c.emails).map(n_), modulosL: parsearListaPortal(c.modulos), activa: v_(c.activo)
  }));
  const activas = cuentas.filter((c) => c.activa);
  const cuentaDe = (email) => activas.find((c) => c.emailsL.indexOf(n_(email)) !== -1) || null;
  return { cuentas, activas, cuentaDe };
}

function caso_(texto, extra) { return Object.assign({ texto: texto }, extra || {}); }

function revisar(db) {
  const ctx = contexto_(db);
  const ahora = Date.now();
  const checks = [];
  const add = (c) => { if (c.casos.length) checks.push(c); };

  // --- Accesos ---------------------------------------------------------------
  add({ id: 'claves_temporales', grupo: 'Accesos', severidad: 'alerta', ir: 'CUENTAS_PORTAL',
    titulo: 'Cuentas con clave temporal sin cambiar',
    explicacion: 'La persona todavía no fija su propia clave: o no ha entrado desde que se la dieron, o no terminó el cambio. Genera una nueva y entrégasela.',
    casos: ctx.activas.filter((c) => v_(c.debe_cambiar_password)).map((c) => caso_(c.nombre + ' — ' + (c.ultimo_acceso ? 'último acceso ' + String(c.ultimo_acceso).slice(0, 10) : 'nunca entró'), {
      cuenta_id: c.cuenta_id, arreglos: [{ tipo: 'resetear_clave', texto: 'Generar clave nueva', params: { cuenta_id: c.cuenta_id },
        confirmar: 'Se genera una clave temporal nueva para ' + c.nombre + ' (la anterior deja de servir). Te la mostraremos para que se la entregues.' }]
    })) });
  add({ id: 'sin_entrar', grupo: 'Accesos', severidad: 'info', ir: 'CUENTAS_PORTAL',
    titulo: 'Cuentas activas que no entran hace más de 30 días',
    explicacion: 'Revisa si la persona sigue en la empresa o si le cuesta entrar. Si ya no está, desactiva la cuenta.',
    casos: ctx.activas.filter((c) => c.ultimo_acceso && ahora - new Date(c.ultimo_acceso).getTime() > 30 * DIA && !v_(c.debe_cambiar_password))
      .map((c) => caso_(c.nombre + ' — último acceso ' + String(c.ultimo_acceso).slice(0, 10), { cuenta_id: c.cuenta_id })) });
  const porCorreo = {};
  ctx.activas.forEach((c) => c.emailsL.forEach((e) => { (porCorreo[e] = porCorreo[e] || []).push(c); }));
  add({ id: 'correos_repetidos', grupo: 'Accesos', severidad: 'critico', ir: 'CUENTAS_PORTAL',
    titulo: 'Un mismo correo en más de una cuenta activa',
    explicacion: 'SIGSO identifica a las personas por su correo: dos cuentas con el mismo correo mezclan su trabajo y sus avisos.',
    casos: Object.keys(porCorreo).filter((e) => porCorreo[e].length > 1).map((e) => caso_(e + ' — ' + porCorreo[e].map((c) => c.nombre).join(' / '))) });
  const legado = leer_(db, 'USUARIOS').filter((u) => v_(u.activo) && !ctx.cuentaDe(u.email));
  add({ id: 'legado_sin_cuenta', grupo: 'Accesos', severidad: 'alerta', ir: 'USUARIOS',
    titulo: 'Personas del sistema antiguo sin cuenta en la plataforma',
    explicacion: 'Siguen activas en "Usuarios (legado)", así que aparecen para elegirlas en equipos y avisos, pero no pueden entrar. Crea su cuenta o desactívalas en el legado.',
    casos: legado.map((u) => caso_((u.nombre || u.email) + ' <' + u.email + '>')) });

  // --- Jefaturas -----------------------------------------------------------------
  const jefaturas = leer_(db, 'JEFATURAS').filter((j) => v_(j.activo));
  const jefaSinMod = [], jefeSinCuenta = [], subSinCuenta = [];
  jefaturas.forEach((j) => {
    const cj = ctx.cuentaDe(j.jefe_email);
    if (!cj) jefeSinCuenta.push(caso_(j.jefe_email + ' (equipo: ' + j.subordinado_email + ')'));
    else if (cj.modulosL.indexOf('jefatura') === -1 && !jefaSinMod.some((x) => x.cuenta_id === cj.cuenta_id)) {
      jefaSinMod.push(caso_(cj.nombre + ' tiene equipo a cargo pero no ve "Mi departamento"', { cuenta_id: cj.cuenta_id,
        arreglos: [{ tipo: 'dar_modulo', texto: 'Darle Mi departamento', params: { cuenta_id: cj.cuenta_id, modulo: 'jefatura' },
          confirmar: 'Se agrega el módulo "Mi departamento" a la cuenta de ' + cj.nombre + '.' }] }));
    }
    if (!ctx.cuentaDe(j.subordinado_email)) subSinCuenta.push(caso_(j.subordinado_email + ' (jefe: ' + j.jefe_email + ')'));
  });
  add({ id: 'jefe_sin_cuenta', grupo: 'Jefaturas', severidad: 'critico', ir: 'JEFATURAS', titulo: 'Jefaturas cuyo jefe no tiene cuenta activa',
    explicacion: 'Nadie ve ese equipo. Reasigna la jefatura o reactiva la cuenta del jefe.', casos: jefeSinCuenta });
  add({ id: 'jefe_sin_modulo', grupo: 'Jefaturas', severidad: 'alerta', ir: 'CUENTAS_PORTAL', titulo: 'Jefes sin el módulo Mi departamento',
    explicacion: 'Tienen un equipo configurado pero no pueden verlo.', casos: jefaSinMod });
  add({ id: 'subordinado_sin_cuenta', grupo: 'Jefaturas', severidad: 'info', ir: 'JEFATURAS', titulo: 'Personas en un equipo sin cuenta activa',
    explicacion: 'El jefe verá a esa persona siempre sin actividad.', casos: subSinCuenta });
  add({ id: 'modulo_jefatura_sin_equipo', grupo: 'Jefaturas', severidad: 'info', ir: 'JEFATURAS', titulo: 'Con "Mi departamento" pero sin equipo configurado',
    explicacion: 'Ven el módulo vacío. Configura su equipo en Jefaturas o quítales el módulo.',
    casos: ctx.activas.filter((c) => c.modulosL.indexOf('jefatura') !== -1 && !jefaturas.some((j) => c.emailsL.indexOf(n_(j.jefe_email)) !== -1))
      .map((c) => caso_(c.nombre, { cuenta_id: c.cuenta_id, arreglos: [{ tipo: 'quitar_modulo', texto: 'Quitarle Mi departamento', params: { cuenta_id: c.cuenta_id, modulo: 'jefatura' },
        confirmar: 'Se quita el módulo "Mi departamento" de la cuenta de ' + c.nombre + '.' }] })) });

  // --- Pausas activas -------------------------------------------------------------
  const empresasPausas = leer_(db, 'PAUSAS_CONFIG').filter((c) => v_(c.activo)).map((c) => String(c.empresa_id));
  const roster = leer_(db, 'PAUSAS_TRABAJADORES').filter((t) => v_(t.activo));
  const enLista = (c) => roster.some((t) => c.emailsL.indexOf(n_(t.email)) !== -1);
  add({ id: 'lista_sin_cuenta', grupo: 'Pausas activas', severidad: 'alerta', ir: 'PAUSAS', titulo: 'En la lista de pausas sin cuenta activa',
    explicacion: 'No pueden declarar su participación: siempre salen "sin registro".',
    casos: roster.filter((t) => !ctx.cuentaDe(t.email)).map((t) => caso_((t.nombre || t.email) + ' <' + t.email + '>')) });
  add({ id: 'lista_sin_modulo', grupo: 'Pausas activas', severidad: 'alerta', ir: 'CUENTAS_PORTAL', titulo: 'En la lista de pausas sin el módulo Pausas activas',
    explicacion: 'Están en la lista pero no ven la pantalla para declarar.',
    casos: roster.map((t) => ctx.cuentaDe(t.email)).filter((c, i, arr) => c && c.modulosL.indexOf('pausas') === -1 && arr.indexOf(c) === i)
      .map((c) => caso_(c.nombre, { cuenta_id: c.cuenta_id, arreglos: [{ tipo: 'dar_modulo', texto: 'Darle Pausas activas', params: { cuenta_id: c.cuenta_id, modulo: 'pausas' },
        confirmar: 'Se agrega el módulo "Pausas activas" a la cuenta de ' + c.nombre + '.' }] })) });
  add({ id: 'modulo_pausas_fuera_lista', grupo: 'Pausas activas', severidad: 'alerta', ir: 'PAUSAS', titulo: 'Con el módulo Pausas activas pero fuera de la lista',
    explicacion: 'Ven "no estás en la lista": o se agregan a la lista de su empresa, o se les quita el módulo.',
    casos: ctx.activas.filter((c) => c.modulosL.indexOf('pausas') !== -1 && !enLista(c)).map((c) => {
      const arreglos = [];
      if (empresasPausas.indexOf(String(c.empresa_id)) !== -1) {
        arreglos.push({ tipo: 'agregar_lista_pausas', texto: 'Agregar a la lista de ' + c.empresa_id, params: { cuenta_id: c.cuenta_id },
          confirmar: 'Se agrega a ' + c.nombre + ' a la lista de pausas de ' + c.empresa_id + ' (' + c.emailsL[0] + ').' });
      }
      arreglos.push({ tipo: 'quitar_modulo', texto: 'Quitarle el módulo', params: { cuenta_id: c.cuenta_id, modulo: 'pausas' },
        confirmar: 'Se quita el módulo "Pausas activas" de la cuenta de ' + c.nombre + '.' });
      return caso_(c.nombre + ' (' + (c.empresa_id || 'sin empresa') + ')', { cuenta_id: c.cuenta_id, arreglos: arreglos });
    }) });
  add({ id: 'coordinador_sin_modulo', grupo: 'Pausas activas', severidad: 'alerta', ir: 'CUENTAS_PORTAL', titulo: 'Coordinadores de pausas sin el módulo Coordinación',
    explicacion: 'Están registrados como coordinadores pero no pueden operar la pausa.',
    casos: leer_(db, 'PAUSAS_COORDINADORES').filter((k) => v_(k.activo)).map((k) => ({ k: k, c: ctx.cuentaDe(k.email) }))
      .filter((x) => x.c && x.c.modulosL.indexOf('pausas_coordinacion') === -1)
      .map((x) => caso_(x.c.nombre, { cuenta_id: x.c.cuenta_id, arreglos: [{ tipo: 'dar_modulo', texto: 'Darle Coordinación de pausas', params: { cuenta_id: x.c.cuenta_id, modulo: 'pausas_coordinacion' },
        confirmar: 'Se agrega el módulo "Coordinación de pausas" a la cuenta de ' + x.c.nombre + '.' }] })) });

  // --- Datos -----------------------------------------------------------------------
  const conPlantilla = [];
  leer_(db, 'SOLICITUDES').forEach((s) => {
    const campos = ['solicitante_email', 'solicitante_cargo', 'desarrollador_asignado', 'solicitante_nombre'].filter((k) => PLANTILLA.test(String(s[k] || '')));
    if (campos.length) conPlantilla.push(caso_(s.solicitud_id + ' — ' + campos.map((k) => k + ' = "' + s[k] + '"').join(', '), { solicitud_id: s.solicitud_id }));
  });
  add({ id: 'datos_plantilla', grupo: 'Datos', severidad: 'critico', ir: '', titulo: 'Solicitudes con datos de plantilla sin reemplazar',
    explicacion: 'Tienen textos como "[CORREO_...]" en vez de datos reales: a nadie le llegan los avisos. Hay que corregirlas con el dato verdadero (no hay arreglo automático).',
    casos: conPlantilla });
  add({ id: 'areas_sin_responsable', grupo: 'Datos', severidad: 'info', ir: 'AREA', titulo: 'Áreas activas sin responsable',
    explicacion: 'Las solicitudes y publicaciones de esas áreas no tienen a quién llegar.',
    casos: leer_(db, 'CAT_AREAS').filter((a) => v_(a.activo) && !String(a.responsable_email || '').trim()).map((a) => caso_(a.nombre)) });

  const orden = { critico: 0, alerta: 1, info: 2 };
  checks.sort((a, b) => orden[a.severidad] - orden[b.severidad]);
  return {
    generado_en: new Date().toISOString(),
    resumen: {
      problemas: checks.reduce((s, c) => s + c.casos.length, 0),
      criticos: checks.filter((c) => c.severidad === 'critico').reduce((s, c) => s + c.casos.length, 0),
      con_arreglo: checks.reduce((s, c) => s + c.casos.filter((k) => k.arreglos && k.arreglos.length).length, 0),
      cuentas_activas: ctx.activas.length
    },
    checks: checks
  };
}

function getSalud(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo un Administrador puede ver la salud de la configuración.' };
  return revisar(db);
}

// Arreglos en un clic: siempre por las funciones de las pantallas de
// Administración, con sus validaciones.
function arreglar(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo un Administrador puede aplicar arreglos.' };
  const tipo = data && data.tipo, p = (data && data.params) || {};
  const cuenta = CuentasPortal.listar(db, {}, contexto).cuentas.find((c) => c.cuenta_id === p.cuenta_id);
  if (!cuenta) return { _validationError: true, message: 'Cuenta no encontrada.' };
  if (tipo === 'resetear_clave') {
    return CuentasPortal.gestionar(db, { operacion: 'resetear_password', cuenta_id: cuenta.cuenta_id }, contexto);
  }
  if (tipo === 'dar_modulo' || tipo === 'quitar_modulo') {
    if (CuentasPortal.MODULOS_VALIDOS.indexOf(p.modulo) === -1) return { _validationError: true, message: 'Módulo inválido.' };
    const actuales = cuenta.modulos.slice();
    const nuevos = tipo === 'dar_modulo'
      ? (actuales.indexOf(p.modulo) === -1 ? actuales.concat([p.modulo]) : actuales)
      : actuales.filter((m) => m !== p.modulo);
    if (!nuevos.length) return { _validationError: true, message: 'La cuenta quedaría sin módulos: hazlo desde Cuentas plataforma.' };
    return CuentasPortal.gestionar(db, { operacion: 'actualizar', cuenta_id: cuenta.cuenta_id, modulos: nuevos }, contexto);
  }
  if (tipo === 'agregar_lista_pausas') {
    if (!cuenta.empresa_id) return { _validationError: true, message: 'La cuenta no tiene empresa.' };
    return Pausas.gestionarTrabajador(db, { operacion: 'crear', empresa_id: cuenta.empresa_id, nombre: cuenta.nombre, email: cuenta.emails[0], cargo: cuenta.cargo || '' }, contexto);
  }
  return { _validationError: true, message: 'Arreglo desconocido.' };
}

module.exports = { getSalud, arreglar, revisar };
