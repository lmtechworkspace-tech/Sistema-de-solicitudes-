'use strict';

/**
 * oficinaVirtual.js — datos de la Oficina virtual (recorrido 3D de la oficina
 * de HomePymes, frontend/oficina.html).
 *
 * Quién se sienta dónde sale de Calidad → Personas (SGC_PERSONAS) y lo que hace
 * cada cargo, de su descriptor vigente (SGC_DESCRIPTORES). Las salas, lo que
 * hace cada una y cómo se comunican viven en el frontend (oficina/datos.js):
 * son el plano, no datos de personas.
 *
 * Qué se muestra y a quién (decisión 2026-11-26): cualquier persona con sesión
 * ve el recorrido completo -- nombre, cargo, oficina, jefatura y el CONTENIDO
 * del descriptor (objetivo, funciones, responsabilidades, habilidades y
 * requisitos), que es información del cargo, no de la persona. NUNCA salen de
 * aquí RUT, correos, documentos, inducciones ni evaluaciones: eso sigue con el
 * permiso de siempre en Calidad → Personas.
 *
 * Oficina de cada persona: la que se asignó a mano (OFICINA_PUESTOS) o, si no
 * hay, una sugerida por el cargo. Las externas (tipo EXT) solo aparecen si se
 * les asigna oficina. Asignar lo puede quien gobierna el SGC o un super admin.
 *
 * Fantasmas (2026-11-26, pedido del dueño): personas sin puesto fijo que se ven
 * translúcidas recorriendo la oficina. Por ficha o, si no tienen ficha, por su
 * cuenta de SIGSO (solo nombre y cargo de la cuenta). Los marca quien ordena.
 * «yo»: la ficha (o el fantasma) de quien mira, por sus correos, para que pueda
 * tomar el control de su mono. Nunca sale un correo en la respuesta.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');

// Las salas del plano donde se puede sentar alguien (ids de oficina/datos.js).
const SALAS_OFICINA = ['recepcion', 'reuniones', 'operativo', 'jefaturas', 'plataformas', 'almacen', 'podcast', 'bano', 'prevencion', 'comedor'];

// Sugerencia por cargo, en orden: la primera que calza gana.
const REGLAS_CARGO = [
  [/prevenci|riesgo/i, 'prevencion'], // antes que «practicante»: la practicante de Prevención va a Prevención
  [/practicante|plataforma/i, 'plataformas'],
  [/podcast|entrevist/i, 'podcast'],
  [/gerent[ea].*(administraci|finanz)|encargad[ao]\s+de\s+administraci|jef[ea]\s+de\s+administraci/i, 'jefaturas'],
  [/factura|cobranza|recepci/i, 'recepcion'],
  [/contab|contador|rr\.?\s*hh|recursos\s+humanos|remuneraci|personal/i, 'operativo']
];

function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function leerSeguro_(db, hoja) { try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (err) { return []; } }
function normalizarEmail_(e) { return String(e || '').trim().toLowerCase(); }

function salaSugerida_(cargo) {
  const texto = String(cargo || '');
  const regla = REGLAS_CARGO.find(([re]) => re.test(texto));
  return regla ? regla[1] : '';
}
// Un descriptor guarda las listas como texto (una por línea) o como JSON.
function lista_(valorItems, valorTexto) {
  let items = [];
  if (Array.isArray(valorItems)) items = valorItems;
  else if (valorItems) { try { const p = JSON.parse(valorItems); if (Array.isArray(p)) items = p; } catch (err) { /* texto */ } }
  items = items.map((x) => (typeof x === 'string' ? x : (x && (x.texto || x.descripcion || x.nombre)) || '')).map((s) => String(s).trim()).filter(Boolean);
  if (items.length) return items;
  return String(valorTexto || '').split(/\r?\n/).map((s) => s.replace(/^\s*[-•*·]\s*/, '').trim()).filter(Boolean);
}
function puedeOrdenar_(db, contexto) {
  return !!contexto && (contexto.super_admin === true || Calidad.gobiernaSgc_(db, contexto));
}

/** Todo lo que la oficina necesita: personas con su oficina, jefatura y descriptor. */
function getOficina(db, data, contexto) {
  if (!contexto) return { _validationError: true, message: 'Ingresa a SIGSO para ver la oficina.' };
  const fichas = leerSeguro_(db, 'SGC_PERSONAS').filter((p) => esVerdadero_(p.activa) && p.estado !== 'DESVINCULADO');
  const descriptores = leerSeguro_(db, 'SGC_DESCRIPTORES').filter((d) => esVerdadero_(d.vigente));
  const puestos = leerSeguro_(db, 'OFICINA_PUESTOS').filter((p) => esVerdadero_(p.activa));
  const puestoDe = new Map(puestos.map((p) => [p.persona_id, p.sala_id]));
  // jefatura: viene como correo; se traduce a la ficha de esa persona (el correo no sale).
  const fichaPorEmail = new Map();
  fichas.forEach((p) => { const e = normalizarEmail_(p.usuario_email); if (e && !fichaPorEmail.has(e)) fichaPorEmail.set(e, p.persona_id); });

  const formato = (d) => (d ? {
    version: d.version || '', objetivo: d.objetivo || '',
    funciones: lista_(null, d.funciones),
    responsabilidades: lista_(d.items_responsabilidades, d.responsabilidades),
    habilidades: lista_(d.items_habilidades, d.habilidades),
    nivel_educacional: d.nivel_educacional || '', formacion_tecnica: d.formacion_tecnica || '', experiencia: d.experiencia || ''
  } : null);

  // Una persona con dos cargos tiene DOS fichas con el mismo correo (v14.0): en
  // la oficina es UNA sola persona, con todos sus cargos y descriptores.
  const grupos = new Map();
  for (const p of fichas) {
    const clave = normalizarEmail_(p.usuario_email) || ('id:' + p.persona_id);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(p);
  }
  // Fantasmas: por ficha o por cuenta. Una cuenta cuyo correo ya tiene ficha se
  // trata como esa ficha (nunca dos personajes para la misma persona).
  const cuentas = leerSeguro_(db, 'CUENTAS_PORTAL').filter((c) => esVerdadero_(c.activo));
  const correosDe = (c) => listaCorreos_(c.emails);
  const fantasmas = leerSeguro_(db, 'OFICINA_FANTASMAS').filter((f) => esVerdadero_(f.activa));
  const fichaFantasma = new Set(fantasmas.filter((f) => f.persona_id).map((f) => f.persona_id));
  const cuentasFantasma = [];
  fantasmas.filter((f) => f.cuenta_id).forEach((f) => {
    const c = cuentas.find((x) => x.cuenta_id === f.cuenta_id); if (!c) return;
    const conFicha = correosDe(c).map((e) => grupos.get(e)).find(Boolean);
    if (conFicha) conFicha.forEach((p) => fichaFantasma.add(p.persona_id));
    else cuentasFantasma.push(c);
  });
  const misCorreos = [].concat(contexto.emails || [], contexto.email || []).map(normalizarEmail_).filter(Boolean);
  let yoId = '';
  // Inducción: los recorridos confirmados y, para quien puede registrarlos, los ítems.
  const recorridos = leerSeguro_(db, 'OFICINA_RECORRIDOS').filter((r) => esVerdadero_(r.confirmado));
  const inducciones = leerSeguro_(db, 'SGC_INDUCCIONES');
  const gobierna = Calidad.gobiernaSgc_(db, contexto);

  const personas = [];
  const sinOficina = [];
  const idPrincipal = new Map();
  for (const grupo of grupos.values()) {
    const conPuesto = grupo.find((p) => SALAS_OFICINA.indexOf(puestoDe.get(p.persona_id)) !== -1);
    const conSugerida = grupo.find((p) => p.tipo !== 'EXT' && salaSugerida_(p.cargo));
    const principal = conPuesto || conSugerida || grupo[0];
    const asignada = conPuesto ? puestoDe.get(conPuesto.persona_id) : '';
    const sala = asignada || (conSugerida ? salaSugerida_(conSugerida.cargo) : '');
    // primero el cargo de la ficha principal, después los demás
    const orden = [principal].concat(grupo.filter((p) => p !== principal));
    const cargos = orden.map((p) => String(p.cargo || '').trim()).filter((c, i, a) => c && a.indexOf(c) === i);
    const descs = orden.map((p) => ({ cargo: p.cargo || '', d: formato(descriptores.find((x) => x.persona_id === p.persona_id)) })).filter((x) => x.d);
    const fila = {
      persona_id: principal.persona_id, nombre: principal.nombre || '', cargo: cargos.join(' · '),
      sala_id: sala, sala_asignada: !!asignada,
      jefatura_persona_id: fichaPorEmail.get(normalizarEmail_(principal.jefatura_email)) || '',
      descriptor: descs.length ? descs[0].d : null,
      descriptores: descs.map((x) => Object.assign({ cargo: x.cargo }, x.d))
    };
    // Recorrido de inducción: la fecha la ve cualquiera; los ítems por registrar,
    // solo su jefatura directa o quien gobierna Calidad (la misma regla de siempre).
    const rec = recorridos.filter((r) => grupo.some((p) => p.persona_id === r.persona_id))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
    if (rec) fila.recorrido = { fecha: rec.fecha, areas: listaJson_(rec.salas).length };
    if (gobierna || misCorreos.indexOf(normalizarEmail_(principal.jefatura_email)) !== -1) {
      fila.puede_registrar_induccion = true;
      fila.inducciones = inducciones.filter((i) => i.persona_id === principal.persona_id && ITEMS_RECORRIDO.indexOf(i.item) !== -1)
        .map((i) => ({ induccion_id: i.induccion_id, item: i.item, estado: i.estado, fecha: i.fecha }));
    }
    grupo.forEach((p) => idPrincipal.set(p.persona_id, principal.persona_id));
    if (grupo.some((p) => misCorreos.indexOf(normalizarEmail_(p.usuario_email)) !== -1)) yoId = principal.persona_id;
    if (grupo.some((p) => fichaFantasma.has(p.persona_id))) { fila.fantasma = true; personas.push(fila); continue; }
    if (sala) personas.push(fila); else sinOficina.push({ persona_id: principal.persona_id, nombre: fila.nombre, cargo: fila.cargo });
  }
  for (const c of cuentasFantasma) {
    const id = 'cuenta:' + c.cuenta_id;
    if (String(contexto.cuenta_id || '') === String(c.cuenta_id)) yoId = id;
    personas.push({ persona_id: id, nombre: c.nombre || 'Sin nombre', cargo: c.cargo || '', sala_id: '', sala_asignada: false,
      jefatura_persona_id: '', descriptor: null, descriptores: [], fantasma: true });
  }
  // la jefatura apunta a la persona (su ficha principal), y nadie se reporta a sí mismo
  personas.forEach((f) => {
    const jefe = idPrincipal.get(f.jefatura_persona_id) || '';
    f.jefatura_persona_id = jefe === f.persona_id ? '' : jefe;
  });
  personas.sort((a, b) => a.nombre.localeCompare(b.nombre));
  const ordenar = puedeOrdenar_(db, contexto);
  const miCuenta = cuentas.find((c) => String(c.cuenta_id) === String(contexto.cuenta_id || ''));
  // Para marcar fantasmas: las cuentas sin ficha que aún no lo son (solo nombre y cargo).
  const candidatos = ordenar ? cuentas
    .filter((c) => !correosDe(c).some((e) => grupos.has(e)) && !cuentasFantasma.includes(c))
    .map((c) => ({ persona_id: 'cuenta:' + c.cuenta_id, nombre: c.nombre || '', cargo: c.cargo || '' }))
    .filter((c) => c.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre)) : [];
  return {
    personas, puede_ordenar: ordenar, sin_oficina: ordenar ? sinOficina : [], salas: SALAS_OFICINA,
    yo: { persona_id: yoId, nombre: (miCuenta && miCuenta.nombre) || '' },
    candidatos_fantasma: candidatos,
    pizarras: pizarras_(db), deptos_de_sala: DEPTOS_DE_SALA,
    vivo: estadoOficina(db, {}, contexto) // estados de las personas y reservas de las salas
  };
}
function listaJson_(v) { if (Array.isArray(v)) return v; try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch (err) { return []; } }

// ===========================================================================
// Pizarras con lo pendiente de cada área (2026-11-26). Solo CONTEOS (nada de
// detalle): solicitudes abiertas y atrasadas del departamento y su Agenda de
// hoy. Cada oficina del plano es de uno o más departamentos de Solicitudes.
// TECNICO = Soporte de plataformas (ítems sin departamento).
// ===========================================================================
const DEPTOS_DE_SALA = {
  recepcion: ['COBRANZAS'], operativo: ['RRHH', 'CONTABILIDAD'], jefaturas: ['ADMINISTRACION'],
  prevencion: ['PREVENCION'], plataformas: ['TECNICO']
  // podcast: sin departamento por ahora (el dueño lo define después, 2026-11-26)
};
const ITEMS_RECORRIDO = ['Organigrama', 'Descriptor de cargo']; // lo que cubre el recorrido virtual
const CERRADOS = ['S08', 'S09', 'S10', 'S11']; // Resuelta, Cerrada, Rechazada, Cancelada
let cachePizarras_ = { ts: 0, db: null, v: null };
function pizarras_(db, ahora = Date.now()) {
  if (cachePizarras_.v && cachePizarras_.db === db && ahora - cachePizarras_.ts < 60000) return cachePizarras_.v;
  const items = leerSeguro_(db, 'SUBSOLICITUDES');
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(ahora));
  let Agenda = null;
  try { Agenda = require('./agendaDepto'); } catch (err) { Agenda = null; } // perezoso: evita ciclos al cargar
  const porDepto = (clave) => {
    const suyos = items.filter((i) => (clave === 'TECNICO' ? !i.depto : i.depto === clave) && CERRADOS.indexOf(i.estado) === -1);
    const vence = (i) => {
      if (i.fecha_comprometida) return new Date(i.fecha_comprometida).getTime();
      const h = Number(i.sla_objetivo_horas);
      return i.fecha_creacion && h > 0 ? new Date(i.fecha_creacion).getTime() + h * 3600000 : NaN;
    };
    const r = { abiertas: suyos.length, atrasadas: suyos.filter((i) => vence(i) < ahora).length, nuevas: suyos.filter((i) => i.estado === 'S01').length };
    if (clave !== 'TECNICO' && Agenda && Agenda.calcularHoy_) {
      try {
        const h = Agenda.calcularHoy_(db, clave, hoy);
        r.agenda_hoy = (h.resumen && h.resumen.por_enviar) || 0;
        r.agenda_atrasados = (h.resumen && h.resumen.atrasados) || 0;
        if (h.proximo) r.proximo = { titulo: h.proximo.titulo, dias_habiles: h.proximo.dias_habiles };
      } catch (err) { /* área sin agenda configurada */ }
    }
    return r;
  };
  const v = {};
  for (const [sala, deptos] of Object.entries(DEPTOS_DE_SALA)) v[sala] = deptos.map((d) => Object.assign({ depto: d }, porDepto(d)));
  cachePizarras_ = { ts: ahora, db, v };
  return v;
}
function getPizarras(db, data, contexto) {
  if (!contexto) return { _validationError: true, message: 'Ingresa a SIGSO para ver la oficina.' };
  return { pizarras: pizarras_(db) };
}

/** La persona confirma que terminó el recorrido de inducción; se avisa a su jefatura. */
function registrarRecorrido(db, data, contexto) {
  if (!contexto) return { _validationError: true, message: 'Ingresa a SIGSO para ver la oficina.' };
  const misCorreos = [].concat(contexto.emails || [], contexto.email || []).map(normalizarEmail_).filter(Boolean);
  const ficha = leerSeguro_(db, 'SGC_PERSONAS').find((p) => esVerdadero_(p.activa) && misCorreos.indexOf(normalizarEmail_(p.usuario_email)) !== -1);
  if (!ficha) return { _validationError: true, message: 'Para registrar tu inducción necesitas tu ficha en Calidad → Personas. Pídesela al Encargado SGC.' };
  const salas = [...new Set(listaJson_(data && data.salas).map(String))].filter((s) => SALAS_OFICINA.indexOf(s) !== -1);
  if (salas.length < 6) return { _validationError: true, campo: 'salas', message: 'Te faltan áreas por recorrer: haz el recorrido de inducción completo.' };
  const fecha = new Date().toISOString();
  agregarFila_(db, 'OFICINA_RECORRIDOS', {
    recorrido_id: crypto.randomUUID(), persona_id: ficha.persona_id, usuario_email: normalizarEmail_(ficha.usuario_email), fecha,
    salas: JSON.stringify(salas), duracion_seg: Math.max(0, Math.min(36000, Math.round(Number(data && data.duracion_seg) || 0))), confirmado: true,
    observaciones: 'Recorrido de inducción en la oficina virtual; confirma haber leído su descriptor de cargo.'
  });
  const jefe = normalizarEmail_(ficha.jefatura_email);
  if (jefe) {
    try {
      require('./notificacionesApp').encolarLote(db, [{
        destinatario: jefe, tipo: 'OFICINA_RECORRIDO', titulo: (ficha.nombre || 'Una persona de tu equipo') + ' completó el recorrido de inducción',
        mensaje: 'Recorrió las ' + salas.length + ' áreas de la oficina virtual y confirmó haber leído su descriptor de cargo. Ábrela para registrar los ítems «Organigrama» y «Descriptor de cargo».',
        modulo_id: 'oficina', texto_accion: 'Abrir la oficina', vidaHoras: 24 * 7
      }]);
    } catch (err) { /* el registro vale aunque el aviso falle */ }
  }
  return { fecha, areas: salas.length, aviso_jefatura: !!jefe };
}
function listaCorreos_(valor) {
  let l = valor;
  if (typeof l === 'string') { try { l = JSON.parse(l); } catch (err) { l = l.split(/[,;\s]+/); } }
  return (Array.isArray(l) ? l : []).map(normalizarEmail_).filter(Boolean);
}

/** Marca o desmarca a alguien como fantasma: una ficha (persona_id) o una cuenta sin ficha ('cuenta:<id>'). */
function marcarFantasma(db, data, contexto) {
  if (!puedeOrdenar_(db, contexto)) return { _validationError: true, message: 'Solo quien administra Calidad puede ordenar la oficina.' };
  const id = String((data && data.persona_id) || '');
  const fantasma = !!(data && data.fantasma);
  const activos = leerSeguro_(db, 'OFICINA_FANTASMAS').filter((f) => esVerdadero_(f.activa));
  const apagar = (filtro) => activos.filter(filtro).forEach((f) => actualizarFilaPorId_(db, 'OFICINA_FANTASMAS', 'fantasma_id', f.fantasma_id, { activa: false }));
  const nueva = (campos) => agregarFila_(db, 'OFICINA_FANTASMAS', Object.assign({
    fantasma_id: crypto.randomUUID(), persona_id: '', cuenta_id: '', creado_por: contexto.email || '', fecha: new Date().toISOString(), activa: true
  }, campos));
  const cuentas = leerSeguro_(db, 'CUENTAS_PORTAL').filter((c) => esVerdadero_(c.activo));

  if (id.indexOf('cuenta:') === 0) {
    const cuentaId = id.slice(7);
    if (!cuentas.some((c) => String(c.cuenta_id) === cuentaId)) return { _validationError: true, campo: 'persona_id', message: 'No encontré esa cuenta.' };
    apagar((f) => String(f.cuenta_id) === cuentaId);
    if (fantasma) nueva({ cuenta_id: cuentaId });
    return { persona_id: id, fantasma };
  }
  const ficha = leerSeguro_(db, 'SGC_PERSONAS').find((p) => p.persona_id === id && esVerdadero_(p.activa));
  if (!ficha) return { _validationError: true, campo: 'persona_id', message: 'No encontré a esa persona en Calidad → Personas.' };
  const email = normalizarEmail_(ficha.usuario_email);
  const suyas = new Set(leerSeguro_(db, 'SGC_PERSONAS').filter((p) => p.persona_id === id || (email && normalizarEmail_(p.usuario_email) === email)).map((p) => p.persona_id));
  const cuentasSuyas = new Set(cuentas.filter((c) => email && listaCorreos_(c.emails).indexOf(email) !== -1).map((c) => String(c.cuenta_id)));
  apagar((f) => suyas.has(f.persona_id) || cuentasSuyas.has(String(f.cuenta_id)));
  if (fantasma) nueva({ persona_id: id });
  return { persona_id: id, fantasma };
}

/** Sienta a una persona en una oficina (sala_id vacío = volver a la sugerida por el cargo). */
function asignarPuesto(db, data, contexto) {
  if (!puedeOrdenar_(db, contexto)) return { _validationError: true, message: 'Solo quien administra Calidad puede ordenar la oficina.' };
  const personaId = String((data && data.persona_id) || '');
  const salaId = String((data && data.sala_id) || '');
  const ficha = leerSeguro_(db, 'SGC_PERSONAS').find((p) => p.persona_id === personaId && esVerdadero_(p.activa));
  if (!ficha) return { _validationError: true, campo: 'persona_id', message: 'No encontré a esa persona en Calidad → Personas.' };
  if (salaId && SALAS_OFICINA.indexOf(salaId) === -1) return { _validationError: true, campo: 'sala_id', message: 'Esa oficina no está en el plano.' };
  const ahora = new Date().toISOString();
  // la persona puede tener más de una ficha (dos cargos): se limpia el puesto de todas
  const email = normalizarEmail_(ficha.usuario_email);
  const suyas = new Set(leerSeguro_(db, 'SGC_PERSONAS').filter((p) => p.persona_id === personaId || (email && normalizarEmail_(p.usuario_email) === email)).map((p) => p.persona_id));
  leerSeguro_(db, 'OFICINA_PUESTOS').filter((p) => suyas.has(p.persona_id) && esVerdadero_(p.activa))
    .forEach((p) => actualizarFilaPorId_(db, 'OFICINA_PUESTOS', 'puesto_id', p.puesto_id, { activa: false }));
  if (salaId) {
    agregarFila_(db, 'OFICINA_PUESTOS', {
      puesto_id: crypto.randomUUID(), persona_id: personaId, sala_id: salaId,
      actualizado_por: contexto.email || '', fecha: ahora, activa: true
    });
  }
  return { persona_id: personaId, sala_id: salaId || salaSugerida_(ficha.cargo), sala_asignada: !!salaId };
}

/**
 * Una sola vez (al arrancar el servidor): pone el módulo «oficina» en TODAS las
 * cuentas, para que la Oficina virtual quede activa en todas. Después manda el
 * Admin: si se la quita a alguien, no se la vuelve a poner. La marca de «ya se
 * hizo» queda en LOG_SISTEMA. Corre desde server/index.js en cada arranque
 * (la marca hace que solo actúe la primera vez).
 */
const MARCA_MIGRACION = 'MIGRACION_MODULO_OFICINA';
function activarModuloEnCuentas_(db) {
  const log = leerSeguro_(db, 'LOG_SISTEMA');
  if (log.some((l) => l.contexto === MARCA_MIGRACION)) return { ya_hecha: true, cuentas: 0 };
  let cuentas = 0;
  for (const c of leerSeguro_(db, 'CUENTAS_PORTAL')) {
    let lista;
    try { lista = JSON.parse(c.modulos || '[]'); } catch (err) { lista = String(c.modulos || '').split(/[,;\s]+/).filter(Boolean); }
    if (!Array.isArray(lista) || lista.indexOf('oficina') !== -1) continue;
    actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', c.cuenta_id, { modulos: JSON.stringify(lista.concat('oficina')) });
    cuentas++;
  }
  agregarFila_(db, 'LOG_SISTEMA', {
    log_id: crypto.randomUUID(), timestamp: new Date().toISOString(), contexto: MARCA_MIGRACION,
    mensaje: 'Módulo Oficina virtual activado en ' + cuentas + ' cuentas', ref: 'OFICINA'
  });
  return { ya_hecha: false, cuentas };
}

// ===========================================================================
// Presencia en vivo (2026-11-26): quienes están moviendo su mono se ven entre
// todos. Vive SOLO en memoria del proceso (nada se escribe en la base): cada
// oficina abierta manda su posición cada ~0,7 s y recibe la de los demás. Quien
// deja de reportar 8 s desaparece. La clave es un hash de la cuenta (no su id).
// ===========================================================================
const PRESENCIA = new Map();   // clave -> { clave, persona_id, nombre, x, z, ry, mov, ts }
const BUZON = new Map();       // clave -> [{ de, nombre, ts }]   saludos por entregar
const YO_CACHE = new Map();    // cuenta -> { v: {persona_id, nombre}, ts }
const VIDA_MS = 8000, MAX_PRESENTES = 200;
const recortar = (n, a, b) => Math.max(a, Math.min(b, Number(n) || 0));
function claveDe_(contexto) {
  return crypto.createHash('sha1').update('oficina:' + String(contexto.cuenta_id || contexto.email || '')).digest('hex').slice(0, 12);
}
function yoCacheado_(db, contexto) { // quién es (su ficha o su fantasma), recordado 5 min
  const k = String(contexto.cuenta_id || contexto.email || '');
  const c = YO_CACHE.get(k);
  if (c && Date.now() - c.ts < 5 * 60 * 1000) return c.v;
  const r = getOficina(db, {}, contexto);
  const pid = (r.yo && r.yo.persona_id) || '';
  const ficha = pid && (r.personas || []).find((p) => p.persona_id === pid);
  const v = { persona_id: pid, nombre: (ficha && ficha.nombre) || (r.yo && r.yo.nombre) || '' };
  YO_CACHE.set(k, { v, ts: Date.now() });
  return v;
}
// Canal en vivo (2026-11-26, v2): cada oficina abierta mantiene una conexión
// (POST /v1/oficina/vivo, text/event-stream) y el servidor le EMPUJA cada
// posición apenas llega, en vez de que cada uno pregunte cada tantos segundos.
const SUSCRIPTORES = new Set();   // { clave, emitir }
const publico_ = (v, ahora) => ({ clave: v.clave, persona_id: v.persona_id, nombre: v.nombre, x: v.x, z: v.z, ry: v.ry, mov: v.mov, edad: ahora - v.ts });
function difundir_(ev, excepto) {
  for (const s of SUSCRIPTORES) if (s.clave !== excepto) { try { s.emitir(ev); } catch (err) { SUSCRIPTORES.delete(s); } }
}
function barrer_(ahora) { // quien no reporta en 8 s se va, y se avisa a todos
  for (const [k, v] of PRESENCIA) if (ahora - v.ts > VIDA_MS) { PRESENCIA.delete(k); difundir_({ tipo: 'sale', clave: k }); }
}
const barrendero = setInterval(() => barrer_(Date.now()), 2000);
if (barrendero.unref) barrendero.unref(); // no impide que el proceso (o las pruebas) terminen
function otrosDe_(clave, ahora) { return [...PRESENCIA.values()].filter((v) => v.clave !== clave).map((v) => publico_(v, ahora)); }
/** Abre el canal en vivo de una oficina: le manda quiénes están y luego cada cambio. Devuelve cómo cerrarlo. */
function suscribir(db, contexto, emitir, ahora = Date.now()) {
  const clave = claveDe_(contexto);
  const s = { clave, emitir };
  SUSCRIPTORES.add(s);
  barrer_(ahora);
  emitir({ tipo: 'estado', yo: clave, otros: otrosDe_(clave, ahora) });
  const pendientes = (BUZON.get(clave) || []).filter((x) => ahora - x.ts < 30000);
  BUZON.delete(clave);
  pendientes.forEach((x) => emitir({ tipo: 'saludo', de: x.de, nombre: x.nombre }));
  return () => SUSCRIPTORES.delete(s);
}

function presencia(db, data, contexto, ahora = Date.now()) {
  if (!contexto) return { _validationError: true, message: 'Ingresa a SIGSO para ver la oficina.' };
  data = data || {};
  const clave = claveDe_(contexto);
  const e = data.estado;
  if (e && Number.isFinite(Number(e.x)) && Number.isFinite(Number(e.z)) && (PRESENCIA.has(clave) || PRESENCIA.size < MAX_PRESENTES)) {
    const yo = yoCacheado_(db, contexto);
    const v = {
      clave, persona_id: yo.persona_id, nombre: String(yo.nombre || 'Visita').trim().split(/\s+/)[0],
      x: recortar(e.x, -12, 12), z: recortar(e.z, -25, 12), ry: recortar(e.ry, -100, 100), mov: !!e.mov, ts: ahora
    };
    PRESENCIA.set(clave, v);
    difundir_(Object.assign({ tipo: 'pos' }, publico_(v, ahora)), clave);
  } else if (data.fin) { if (PRESENCIA.delete(clave)) difundir_({ tipo: 'sale', clave }, clave); }
  const destino = String(data.saludar_a || '');
  if (destino && destino !== clave && PRESENCIA.has(destino)) {
    const yo = yoCacheado_(db, contexto);
    const saludo = { de: clave, nombre: String(yo.nombre || 'Alguien').trim().split(/\s+/)[0], ts: ahora };
    const conectados = [...SUSCRIPTORES].filter((s) => s.clave === destino);
    if (conectados.length) conectados.forEach((s) => { try { s.emitir({ tipo: 'saludo', de: saludo.de, nombre: saludo.nombre }); } catch (err) { SUSCRIPTORES.delete(s); } });
    else BUZON.set(destino, (BUZON.get(destino) || []).concat(saludo).slice(-5));
  }
  barrer_(ahora);
  if (data.ligero) return { yo: clave }; // con el canal en vivo abierto, no hace falta devolver la lista
  const otros = otrosDe_(clave, ahora);
  const saludos = (BUZON.get(clave) || []).filter((s) => ahora - s.ts < 30000).map((s) => ({ de: s.de, nombre: s.nombre }));
  BUZON.delete(clave);
  return { yo: clave, otros, saludos };
}
function reiniciarPresencia_() { PRESENCIA.clear(); BUZON.clear(); YO_CACHE.clear(); SUSCRIPTORES.clear(); } // pruebas

// ===========================================================================
// 4 · Estado de cada persona (2026-11-26). Lo pone cada uno (o quien ordena la
// oficina). Con «hasta», vuelve solo a disponible. Sin datos sensibles: no hay
// «licencia médica», solo «Fuera (vacaciones o permiso)».
// 5 · Reservas de la sala de reuniones y del podcast, sin topes. Quien está en
// una reserva en curso aparece «En reunión» solo, sin tener que ponerlo.
// ===========================================================================
const ESTADOS_PERSONA = ['DISPONIBLE', 'REUNION', 'TERRENO', 'TELETRABAJO', 'COLACION', 'FUERA'];
const SALAS_RESERVABLES = ['reuniones', 'podcast'];
const DIA_MS = 86400000;
function organizador_(db, contexto) {
  const yo = yoCacheado_(db, contexto);
  if (yo.persona_id) return yo;
  const c = leerSeguro_(db, 'CUENTAS_PORTAL').find((x) => String(x.cuenta_id) === String(contexto.cuenta_id || ''));
  return { persona_id: contexto.cuenta_id ? 'cuenta:' + contexto.cuenta_id : '', nombre: (c && c.nombre) || '' };
}
function horaChile_(iso) { return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)); }
function reservasActivas_(db) { return leerSeguro_(db, 'OFICINA_RESERVAS').filter((r) => esVerdadero_(r.activa)); }

/** Estados vigentes y reservas próximas (para pintar la oficina y sus salas). */
function estadoOficina(db, data, contexto, ahora = Date.now()) {
  if (!contexto) return { _validationError: true, message: 'Ingresa a SIGSO para ver la oficina.' };
  const estados = {};
  for (const e of leerSeguro_(db, 'OFICINA_ESTADOS')) {
    if (!esVerdadero_(e.activa) || (e.hasta && new Date(e.hasta).getTime() < ahora)) continue;
    estados[e.persona_id] = { estado: e.estado, nota: e.nota || '', hasta: e.hasta || '' };
  }
  const reservas = reservasActivas_(db)
    .filter((r) => new Date(r.fin).getTime() > ahora - 3600000 && new Date(r.inicio).getTime() < ahora + 14 * DIA_MS)
    .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
    .map((r) => ({ reserva_id: r.reserva_id, sala_id: r.sala_id, titulo: r.titulo, inicio: r.inicio, fin: r.fin,
      organizador_id: r.organizador_id, organizador_nombre: r.organizador_nombre, asistentes: listaJson_(r.asistentes) }));
  // En una reserva en curso = «En reunión», si no puso otra cosa.
  for (const r of reservas) {
    const ini = new Date(r.inicio).getTime(), fin = new Date(r.fin).getTime();
    if (ini > ahora || fin <= ahora) continue;
    for (const pid of [r.organizador_id].concat(r.asistentes)) {
      if (!pid || (estados[pid] && estados[pid].estado !== 'DISPONIBLE')) continue;
      estados[pid] = { estado: 'REUNION', nota: r.sala_id === 'podcast' ? 'Grabando en el podcast' : 'En la sala de reuniones', hasta: r.fin, auto: true };
    }
  }
  return { estados, reservas };
}

function ponerEstado(db, data, contexto) {
  if (!contexto) return { _validationError: true, message: 'Ingresa a SIGSO para ver la oficina.' };
  const yo = organizador_(db, contexto);
  const destino = String((data && data.persona_id) || yo.persona_id || '');
  if (!destino) return { _validationError: true, message: 'Necesitas tu ficha en Calidad → Personas (o una cuenta) para poner tu estado.' };
  if (destino !== yo.persona_id && !puedeOrdenar_(db, contexto)) return { _validationError: true, message: 'Solo puedes cambiar tu propio estado.' };
  const estado = String((data && data.estado) || 'DISPONIBLE').toUpperCase();
  if (ESTADOS_PERSONA.indexOf(estado) === -1) return { _validationError: true, campo: 'estado', message: 'Estado no válido.' };
  let hasta = '';
  if (data && data.hasta) {
    const t = new Date(data.hasta).getTime();
    if (isNaN(t) || t <= Date.now()) return { _validationError: true, campo: 'hasta', message: 'La hora de término tiene que ser futura.' };
    if (t > Date.now() + 62 * DIA_MS) return { _validationError: true, campo: 'hasta', message: 'Como máximo, dos meses.' };
    hasta = new Date(t).toISOString();
  }
  const nota = String((data && data.nota) || '').trim().slice(0, 60);
  leerSeguro_(db, 'OFICINA_ESTADOS').filter((e) => e.persona_id === destino && esVerdadero_(e.activa))
    .forEach((e) => actualizarFilaPorId_(db, 'OFICINA_ESTADOS', 'estado_id', e.estado_id, { activa: false }));
  if (estado !== 'DISPONIBLE') {
    agregarFila_(db, 'OFICINA_ESTADOS', { estado_id: crypto.randomUUID(), persona_id: destino, estado, nota, hasta,
      actualizado_por: contexto.email || '', fecha: new Date().toISOString(), activa: true });
  }
  return { persona_id: destino, estado, nota, hasta };
}

function crearReserva(db, data, contexto) {
  if (!contexto) return { _validationError: true, message: 'Ingresa a SIGSO para ver la oficina.' };
  data = data || {};
  const sala = String(data.sala_id || '');
  if (SALAS_RESERVABLES.indexOf(sala) === -1) return { _validationError: true, campo: 'sala_id', message: 'Esa sala no se reserva.' };
  const titulo = String(data.titulo || '').trim().slice(0, 80);
  if (!titulo) return { _validationError: true, campo: 'titulo', message: 'Ponle un título a la reserva (para qué es).' };
  const ini = new Date(data.inicio).getTime(), fin = new Date(data.fin).getTime(), ahora = Date.now();
  if (isNaN(ini) || isNaN(fin)) return { _validationError: true, campo: 'inicio', message: 'Indica el día y las horas.' };
  if (fin <= ini) return { _validationError: true, campo: 'fin', message: 'La hora de término tiene que ser después de la de inicio.' };
  if (fin - ini > 10 * 3600000) return { _validationError: true, campo: 'fin', message: 'Una reserva dura como máximo 10 horas.' };
  if (ini < ahora - 5 * 60000) return { _validationError: true, campo: 'inicio', message: 'No se puede reservar en el pasado.' };
  if (ini > ahora + 90 * DIA_MS) return { _validationError: true, campo: 'inicio', message: 'Se reserva con hasta tres meses de anticipación.' };
  const tope = reservasActivas_(db).find((r) => r.sala_id === sala && new Date(r.inicio).getTime() < fin && new Date(r.fin).getTime() > ini);
  if (tope) return { _validationError: true, campo: 'inicio', message: `Choca con «${tope.titulo}» (${horaChile_(tope.inicio)} a ${horaChile_(tope.fin)}).` };
  const yo = organizador_(db, contexto);
  const asistentes = [...new Set(listaJson_(data.asistentes).map(String))].filter((x) => x && x !== yo.persona_id).slice(0, 30);
  const fila = {
    reserva_id: crypto.randomUUID(), sala_id: sala, titulo, inicio: new Date(ini).toISOString(), fin: new Date(fin).toISOString(),
    organizador_id: yo.persona_id, organizador_nombre: yo.nombre || '', asistentes: JSON.stringify(asistentes),
    creado_por: normalizarEmail_(contexto.email), fecha_creacion: new Date().toISOString(), activa: true
  };
  agregarFila_(db, 'OFICINA_RESERVAS', fila);
  return { reserva_id: fila.reserva_id, sala_id: sala, titulo, inicio: fila.inicio, fin: fila.fin };
}

function cancelarReserva(db, data, contexto) {
  if (!contexto) return { _validationError: true, message: 'Ingresa a SIGSO para ver la oficina.' };
  const r = reservasActivas_(db).find((x) => x.reserva_id === String((data && data.reserva_id) || ''));
  if (!r) return { _validationError: true, campo: 'reserva_id', message: 'Esa reserva ya no existe.' };
  const yo = organizador_(db, contexto);
  const suya = (yo.persona_id && r.organizador_id === yo.persona_id) || normalizarEmail_(r.creado_por) === normalizarEmail_(contexto.email);
  if (!suya && !puedeOrdenar_(db, contexto)) return { _validationError: true, message: 'Solo quien reservó (o quien ordena la oficina) puede cancelarla.' };
  actualizarFilaPorId_(db, 'OFICINA_RESERVAS', 'reserva_id', r.reserva_id, { activa: false });
  return { reserva_id: r.reserva_id, cancelada: true };
}

module.exports = { estadoOficina, ponerEstado, crearReserva, cancelarReserva, ESTADOS_PERSONA, SALAS_RESERVABLES,
  getOficina, getPizarras, registrarRecorrido, asignarPuesto, marcarFantasma, presencia, suscribir, reiniciarPresencia_, activarModuloEnCuentas_, salaSugerida_, SALAS_OFICINA };
