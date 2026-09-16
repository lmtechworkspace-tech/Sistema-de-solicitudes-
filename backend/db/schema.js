'use strict';

/**
 * schema.js — equivalente Node del Instalador de Apps Script (backend/setup):
 * declara las tablas y las crea si faltan, sin tocar las que ya existen.
 *
 * Mismos nombres de columna que COLUMNAS en backend/backoffice/Constantes.gs
 * -- se van agregando aqui a medida que se porta cada modulo de logica,
 * empezando por Catalogos.
 */

const { asegurarTabla_ } = require('./sqliteRepo');

const COLUMNAS = {
  CAT_EMPRESAS: ['empresa_id', 'nombre', 'logo', 'activo'],
  CAT_PLATAFORMAS: ['plataforma_id', 'nombre', 'empresa_id', 'url_base', 'activo'],
  CAT_MODULOS: ['modulo_id', 'nombre', 'plataforma_id', 'modulo_padre_id', 'activo'],
  CAT_TIPOS: ['tipo_id', 'nombre', 'prioridad_default', 'activo', 'es_urgente'],
  CAT_AREAS: ['area_id', 'nombre', 'responsable_email', 'activo'],
  CONFIG_NOTIFICACIONES: ['notif_id', 'evento', 'rol_destinatario', 'emails_extra', 'activo'],
  // v3.3 (§2.4): cuentas e identidad de la plataforma (Portal.gs/
  // CuentasPortal.gs). hash_password nunca guarda la clave en claro --
  // ver backend/logica/passwordHash.js sobre el cambio de algoritmo.
  CUENTAS_PORTAL: [
    'cuenta_id', 'usuario', 'nombre', 'cargo',
    'hash_password', 'salt', 'emails', 'rol', 'modulos',
    'empresa_id', 'activo', 'debe_cambiar_password',
    'ultimo_acceso', 'creado_por'
  ],
  SESIONES_PORTAL: ['token', 'cuenta_id', 'expira', 'creada'],

  // Nucleo del helpdesk (backend/intake/Solicitudes.gs: crearSolicitud).
  SOLICITUDES: [
    'solicitud_id', 'empresa_id', 'empresa_nombre', 'plataforma', 'plataforma_nombre',
    'modulo', 'modulo_nombre', 'tipo', 'tipo_nombre',
    'solicitante_nombre', 'solicitante_cargo', 'solicitante_email',
    'es_cliente', 'empresa_cliente', 'cliente_mandante', 'cliente_obra',
    'contacto_cliente', 'correo_cliente', 'telefono_cliente', 'urgencia_cliente',
    'estado_derivado', 'prioridad_derivada', 'orden_atencion',
    'analista_asignado', 'desarrollador_asignado',
    'doc_estado', 'doc_reintentos', 'url_doc', 'url_pdf',
    'version_documento', 'url_pdf_historial',
    'dedup_hash', 'estimacion_total_horas', 'horas_reales',
    'observaciones_generales',
    'resumen_whatsapp', 'fecha_creacion', 'creado_por',
    'cc', 'rut_cliente', 'codigo_cliente', 'atencion_directa', 'proyecto_id'
  ],
  SUBSOLICITUDES: [
    'subsolicitud_id', 'solicitud_id', 'numero_item', 'titulo', 'descripcion',
    'contexto', 'resultado_esperado',
    'impacto', 'prioridad', 'estado',
    'url_modulo', 'usuario_prueba', 'ref_credencial', 'centro_costos',
    'url_video', 'observaciones',
    'sla_objetivo_horas', 'estimacion_horas', 'horas_reales', 'fecha_creacion',
    'desarrollador_asignado', 'urls_adicionales',
    'tipo', 'tipo_nombre', 'modulo', 'modulo_nombre',
    'frecuencia', 'personas_afectadas', 'imagen_descripciones',
    'fecha_propuesta', 'fecha_comprometida', 'fecha_terminada', 'comprometida_por',
    'area', 'area_nombre',
    'atencion_resuelto_por', 'atencion_fecha_resolucion', 'atencion_detalle'
  ],
  HISTORIAL_ESTADOS: [
    'historial_id', 'solicitud_id', 'subsolicitud_id',
    'estado_anterior', 'estado_nuevo', 'usuario', 'comentario', 'timestamp'
  ],
  COUNTERS: ['empresa_id', 'anio', 'ultimo_numero'],
  CONFIG_SLA: ['prioridad', 'sla_horas'],
  LOG_NOTIFICACIONES: [
    'log_id', 'timestamp', 'solicitud_id', 'canal',
    'destinatario', 'evento', 'resultado', 'reintentos', 'asunto', 'cuerpo'
  ]
};

function asegurarEsquema(db) {
  Object.keys(COLUMNAS).forEach((hoja) => asegurarTabla_(db, hoja, COLUMNAS[hoja]));
}

module.exports = { COLUMNAS, asegurarEsquema };
