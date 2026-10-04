'use strict';

/**
 * Informe de gestión del mes y su cadena (2026-10-03): Administración lo
 * envía, Finanzas y Cobranzas lo aprueban, Control propone decisiones y
 * Gerencia lo cierra. Snapshot congelado, devoluciones, comentarios,
 * plazos en días hábiles y permisos.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const RD = require('../logica/departamentosReportes');
const IG = require('../logica/informesGestion');
const C = require('../logica/calidadDatos');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const p = (email) => ({ email, rol: 'DEV', modulos: [] });
const FRANCISCA = p('francisca@homepymes.cl'), BARBARA = p('barbara@homepymes.cl'), LISSETH = p('lisseth@homepymes.cl');
const MARISOL = p('marisol@homepymes.cl'), LUIS = p('luis@homepymes.cl'), ROGELIO = p('rogelio@homepymes.cl');
const PER = '2026-M08';

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  C.asegurarFeriados_(db);
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }, { email: BARBARA.email, rol: 'JEFATURA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'ADMINISTRACION', miembros: [{ email: LISSETH.email, rol: 'REGISTRA' }] }, ADM);
  IG.guardarCadena(db, { rol: 'FINANZAS', personas: [BARBARA.email] }, ADM);
  IG.guardarCadena(db, { rol: 'COBRANZAS', personas: [MARISOL.email] }, ADM);
  IG.guardarCadena(db, { rol: 'CONTROL', personas: [LUIS.email] }, ADM);
  IG.guardarCadena(db, { rol: 'GERENCIA', personas: [ROGELIO.email] }, ADM);
  agregarFila_(db, 'CI_REGISTROS', { registro_id: 'R1', depto: 'RRHH', matriz: 'RLE_FINIQUITOS', periodo: '2025-M10', cliente_id: 'C1', cliente_nombre: 'Cliente 1', datos: {}, estado: 'PENDIENTE', activa: true });
  return db;
}
function avisos(db, email) { return leerFilas_(db, 'NOTIFICACIONES_APP', COLUMNAS.NOTIFICACIONES_APP).filter((n) => n.destinatario_email === email && n.tipo === 'INFORME_GESTION').length; }

test('plazos: los días hábiles 3 a 10 del mes siguiente, sin feriados ni fines de semana', () => {
  const db = crear();
  const pl = IG.plazos_(db, PER);
  assert.deepEqual(pl.map((x) => [x.clave, x.fecha]), [['OPERATIVO', '2026-09-03'], ['JEFATURA', '2026-09-07'], ['ADMINISTRACION', '2026-09-08'],
    ['FINANZAS', '2026-09-10'], ['CONTROL', '2026-09-11'], ['GERENCIA', '2026-09-14']]);
});

test('la cadena completa: Administración → Finanzas y Cobranzas → Control → Gerencia, con devolución', () => {
  const db = crear();
  // Quién ve: la cadena entra a Administración; un área no.
  assert.equal(IG.obtener(db, { periodo: PER }, FRANCISCA)._forbidden, true);
  assert.deepEqual(CI.modulosDeDepartamento_(db, ROGELIO), ['dep_administracion'], 'Gerencia ve el módulo Administración');
  const v = IG.obtener(db, { periodo: PER }, LISSETH);
  assert.equal(v.estado, 'SIN_INICIAR');
  assert.equal(v.acciones.enviar_finanzas, true);
  assert.ok(v.ejecutivo.alertas.some((a) => a.clave === 'rle_pendiente'), 'el informe trae las alertas del mes');
  assert.ok(v.decisiones_sugeridas.length >= 1, 'las decisiones sugeridas salen de las alertas');

  // 3. Administración envía (avisa qué áreas faltan).
  const f = IG.avanzar(db, { periodo: PER, accion: 'enviar_finanzas' }, LISSETH);
  assert.equal(f.ok, false);
  assert.ok(f.faltan.includes('Contabilidad'));
  assert.equal(IG.avanzar(db, { periodo: PER, accion: 'enviar_finanzas', confirmar_faltantes: true }, LISSETH).estado, 'EN_FINANZAS');
  assert.equal(avisos(db, BARBARA.email) + avisos(db, MARISOL.email), 2);
  // El snapshot quedó congelado: un dato nuevo no cambia lo enviado.
  agregarFila_(db, 'CI_REGISTROS', { registro_id: 'R2', depto: 'RRHH', matriz: 'RLE_CONTRATOS', periodo: '2025-M01', cliente_id: 'C2', cliente_nombre: 'Cliente 2', datos: {}, estado: 'PENDIENTE', activa: true });
  const cong = IG.obtener(db, { periodo: PER }, MARISOL);
  assert.equal(cong.congelado, true);
  assert.match(cong.ejecutivo.alertas.find((a) => a.clave === 'rle_pendiente').cifra, /0 contratos/);
  assert.deepEqual(cong.ejecutivo.faltantes_al_enviar.length, 4);

  // 4. Las dos aprueban; nadie más.
  assert.equal(IG.avanzar(db, { periodo: PER, accion: 'enviar_gerencia' }, MARISOL)._forbidden, true);
  assert.equal(IG.avanzar(db, { periodo: PER, accion: 'aprobar' }, LUIS)._forbidden, true);
  assert.equal(IG.avanzar(db, { periodo: PER, accion: 'aprobar', observacion: 'Conforme' }, BARBARA).estado, 'EN_FINANZAS');
  assert.equal(IG.avanzar(db, { periodo: PER, accion: 'aprobar' }, BARBARA)._forbidden, true, 'no aprueba dos veces');
  assert.equal(IG.avanzar(db, { periodo: PER, accion: 'aprobar' }, MARISOL).estado, 'EN_CONTROL');
  assert.equal(avisos(db, LUIS.email), 1);

  // Comentarios opcionales de cada uno.
  assert.equal(IG.comentar(db, { periodo: PER, texto: 'La cobranza de agosto está al día.' }, MARISOL).ok, true);
  assert.equal(IG.comentar(db, { periodo: PER, texto: 'x' }, FRANCISCA)._forbidden, true);

  // 5. Control: decisiones y conclusión; envía a Gerencia.
  const dec = [{ texto: 'Confirmar el estado del RLE esta semana', responsable: 'Jefatura RR.HH.', plazo: '2026-10-10' }];
  assert.equal(IG.guardarDecisiones(db, { periodo: PER, decisiones: dec, conclusion: 'Mes estable salvo el RLE.' }, LUIS).ok, true);
  assert.equal(IG.avanzar(db, { periodo: PER, accion: 'enviar_gerencia' }, LUIS).estado, 'EN_GERENCIA');
  // 6. Gerencia devuelve, Control reenvía, Gerencia cierra con lo acordado.
  assert.match(IG.avanzar(db, { periodo: PER, accion: 'devolver' }, ROGELIO).message, /qué hay que corregir/);
  assert.equal(IG.avanzar(db, { periodo: PER, accion: 'devolver', observacion: 'Agregar el plan de RLE.' }, ROGELIO).estado, 'EN_CONTROL');
  assert.equal(IG.avanzar(db, { periodo: PER, accion: 'enviar_gerencia' }, LUIS).estado, 'EN_GERENCIA');
  const fin = IG.avanzar(db, { periodo: PER, accion: 'cerrar', decisiones: [Object.assign({}, dec[0], { estado: 'ACORDADA' })] }, ROGELIO);
  assert.equal(fin.estado, 'CERRADO');
  const final = IG.obtener(db, { periodo: PER }, ROGELIO);
  assert.equal(final.informe.decisiones[0].estado, 'ACORDADA');
  assert.equal(final.informe.conclusion, 'Mes estable salvo el RLE.');
  assert.equal(final.informe.comentarios[0].rol, 'COBRANZAS');
  assert.equal(final.acciones.comentar, false, 'cerrado: ya no se comenta');
  const h = IG.historial(db, { periodo: PER }, ROGELIO).historial.map((x) => x.accion);
  assert.deepEqual(h, ['INFORME_CREADO', 'INFORME_A_FINANZAS', 'INFORME_APROBADO_FINANZAS', 'INFORME_APROBADO_COBRANZAS', 'INFORME_A_GERENCIA', 'INFORME_DEVUELTO', 'INFORME_A_GERENCIA', 'INFORME_CERRADO']);
});

test('Finanzas devuelve a Administración y se piden de nuevo las dos aprobaciones; contadores', () => {
  const db = crear();
  IG.avanzar(db, { periodo: PER, accion: 'enviar_finanzas', confirmar_faltantes: true }, LISSETH);
  assert.equal(IG.pendientes_(db, BARBARA), 1);
  IG.avanzar(db, { periodo: PER, accion: 'aprobar' }, MARISOL);
  assert.equal(IG.pendientes_(db, MARISOL), 0);
  assert.equal(IG.avanzar(db, { periodo: PER, accion: 'devolver', observacion: 'Falta la cobranza.' }, BARBARA).estado, 'PREPARACION');
  assert.equal(IG.obtener(db, { periodo: PER }, LISSETH).congelado, false, 'en preparación vuelve a estar en vivo');
  IG.avanzar(db, { periodo: PER, accion: 'enviar_finanzas', confirmar_faltantes: true }, LISSETH);
  assert.equal(IG.avanzar(db, { periodo: PER, accion: 'aprobar' }, BARBARA).estado, 'EN_FINANZAS', 'la aprobación anterior de Cobranzas se borró');
  // El contador de Administración en el menú suma el informe.
  assert.equal(RD.pendientes(db, {}, MARISOL).pendientes.dep_administracion, 1);
});
