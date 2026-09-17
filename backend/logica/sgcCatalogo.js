'use strict';

/**
 * sgcCatalogo.js — catalogos compartidos del modulo SGC ISO 9001, portados
 * una sola vez para que ningun modulo del SGC (Calidad, Auditorias, ...) lo
 * duplique. Puerto de la constante CLAUSULAS_ISO9001 de
 * backend/backoffice/Auditorias.gs (Calidad.gs ya la referenciaba desde ahi,
 * mismo scope global de Apps Script -- aca es un modulo explicito).
 */

// Las 27 clausulas auditables de la norma (4.1 a 10.3). Catalogo fijo -- no
// se porta el banco de preguntas de verificacion (PREGUNTAS_VERIFICACION_ISO9001,
// FO-PRO-03-04) porque solo lo usa Auditorias.gs, todavia no portado.
const CLAUSULAS_ISO9001 = [
  { codigo: '4.1', titulo: 'Comprensión de la organización y su contexto' },
  { codigo: '4.2', titulo: 'Necesidades y expectativas de las partes interesadas' },
  { codigo: '4.3', titulo: 'Alcance del sistema de gestión de la calidad' },
  { codigo: '4.4', titulo: 'Sistema de gestión de la calidad y sus procesos' },
  { codigo: '5.1', titulo: 'Liderazgo y compromiso' },
  { codigo: '5.2', titulo: 'Política de la calidad' },
  { codigo: '5.3', titulo: 'Roles, responsabilidades y autoridades' },
  { codigo: '6.1', titulo: 'Acciones para abordar riesgos y oportunidades' },
  { codigo: '6.2', titulo: 'Objetivos de la calidad y planificación' },
  { codigo: '6.3', titulo: 'Planificación de los cambios' },
  { codigo: '7.1', titulo: 'Recursos' },
  { codigo: '7.2', titulo: 'Competencia' },
  { codigo: '7.3', titulo: 'Toma de conciencia' },
  { codigo: '7.4', titulo: 'Comunicación' },
  { codigo: '7.5', titulo: 'Información documentada' },
  { codigo: '8.1', titulo: 'Planificación y control operacional' },
  { codigo: '8.2', titulo: 'Requisitos para los productos y servicios' },
  { codigo: '8.3', titulo: 'Diseño y desarrollo' },
  { codigo: '8.4', titulo: 'Control de procesos, productos y servicios externos' },
  { codigo: '8.5', titulo: 'Producción y provisión del servicio' },
  { codigo: '8.6', titulo: 'Liberación de los productos y servicios' },
  { codigo: '8.7', titulo: 'Control de las salidas no conformes' },
  { codigo: '9.1', titulo: 'Seguimiento, medición, análisis y evaluación' },
  { codigo: '9.2', titulo: 'Auditoría interna' },
  { codigo: '9.3', titulo: 'Revisión por la dirección' },
  { codigo: '10.1', titulo: 'Mejora — generalidades' },
  { codigo: '10.2', titulo: 'No conformidad y acción correctiva' },
  { codigo: '10.3', titulo: 'Mejora continua' }
];

module.exports = { CLAUSULAS_ISO9001 };
