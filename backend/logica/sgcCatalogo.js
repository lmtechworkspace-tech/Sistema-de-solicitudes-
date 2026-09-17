'use strict';

/**
 * sgcCatalogo.js — catalogos compartidos del modulo SGC ISO 9001, portados
 * una sola vez para que ningun modulo del SGC (Calidad, Auditorias, ...) lo
 * duplique. Puerto de las constantes CLAUSULAS_ISO9001 y
 * PREGUNTAS_VERIFICACION_ISO9001 de backend/backoffice/Auditorias.gs.
 */

// Las 27 clausulas auditables de la norma (4.1 a 10.3).
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

// v10.0 Tanda A: las preguntas reales de la lista de verificacion
// (FO-PRO-03-04), copiadas tal como estan en el documento -- no una
// redaccion propia. Se ofrecen como sugerencia al registrar un hallazgo (el
// auditor puede elegir una o escribir otra cosa). 4.4 no tiene preguntas: el
// FO-PRO-03-04 de la empresa no la desarrolla (salta de 4.3 a 5.1); queda
// como clausula del catalogo por completitud de la norma, sin banco propio.
const PREGUNTAS_VERIFICACION_ISO9001 = {
  '4.1': [
    '¿Dispone la organización de una metodología para el análisis, seguimiento y revisión del contexto interno y externo?',
    '¿Ha detectado la organización todos los factores externos que afectan al desempeño de la organización?',
    '¿Ha detectado la organización todos los factores internos que afectan al desempeño de la organización?',
    '¿Se han tenido en cuenta los factores empleados en la definición y planificación del sistema de gestión?'
  ],
  '4.2': [
    '¿Dispone la organización de una metodología para la detección y el análisis de expectativas y necesidades de las partes interesadas?',
    '¿Se han detectado todas las necesidades y expectativas de las partes interesadas que puedan afectar al desempeño del sistema de gestión?',
    '¿Se realiza el seguimiento y la revisión de la información relacionada con las partes interesadas y sus requisitos pertinentes?',
    '¿Se han tenido en cuenta las necesidades y expectativas de las partes interesadas en la definición del sistema y su planificación de actividades?'
  ],
  '4.3': [
    '¿Tiene documentado la organización el alcance del sistema de gestión?',
    '¿Se han delimitado claramente los límites físicos y las actividades del sistema?',
    '¿Se han justificado adecuadamente la no aplicabilidad de los requisitos señalados por la organización?',
    '¿Los requisitos no aplicables no afectan a la calidad de los productos o la satisfacción de los clientes?'
  ],
  '4.4': [],
  '5.1': [
    'La alta dirección debe demostrar liderazgo y compromiso con respecto al sistema de gestión de la calidad',
    'La alta dirección debe demostrar liderazgo y compromiso con respecto al enfoque al cliente'
  ],
  '5.2': [
    '¿Mantiene la organización una política de la calidad apropiada al propósito y contexto de la organización?',
    '¿Incluye la política los compromisos de cumplimiento de requisitos y mejora continua?',
    '¿Existe una relación entre la política y los objetivos de la calidad?',
    '¿La política se encuentra disponible para las partes interesadas?',
    '¿La política es comunicada y entendida dentro de la organización?'
  ],
  '5.3': [
    '¿Existe evidencia de la definición de responsabilidades y autoridades para cada uno de los roles de la organización?',
    '¿Estas responsabilidades y autoridades han sido comunicadas y entendidas en toda la organización?',
    '¿Ha asignado la alta dirección la responsabilidad para el aseguramiento del cumplimiento de los requisitos de la norma, el correcto funcionamiento de los procesos, etc.?'
  ],
  '6.1': [
    '¿Se han identificado los riesgos y oportunidades relacionados con el análisis de contexto, las necesidades y expectativas de las partes interesadas y los procesos?',
    '¿Se han evaluado estos riesgos y oportunidades para determinar acciones proporcionales al impacto potencial?',
    '¿Se han planificado acciones para abordar los riesgos y las oportunidades?'
  ],
  '6.2': [
    '¿Se han establecido objetivos coherentes con la política de la calidad?',
    '¿Los objetivos están relacionados con la conformidad del producto y con el aumento de la satisfacción del cliente?',
    '¿Los objetivos son medibles y disponen de metodología de seguimiento?',
    '¿La planificación de los objetivos contempla las actividades, los recursos, los plazos y las responsabilidades para su realización?',
    '¿Se han comunicado los objetivos en la organización en los niveles pertinentes?'
  ],
  '6.3': [
    '¿Los cambios realizados en el sistema de gestión de calidad han sido planificados?',
    '¿Los cambios a realizar tienen en cuenta las consecuencias potenciales y la integridad del sistema de gestión de la calidad?',
    '¿Los cambios tienen en cuenta la necesidad de recursos y la asignación de responsabilidades?'
  ],
  '7.1': [
    '¿La organización dispone de los recursos necesarios para el correcto desempeño de los procesos?',
    '¿La organización ha determinado y proporcionado las personas necesarias para la implementación eficaz del sistema de gestión de la calidad?'
  ],
  '7.2': [
    '¿Se han determinado las competencias necesarias de las personas para realizar las tareas del sistema de gestión de la calidad?',
    '¿Se han emprendido acciones para asegurar o mejorar la competencia del personal de la organización?',
    '¿Existen evidencias documentadas de la competencia necesaria?'
  ],
  '7.3': [
    '¿Se han realizado acciones para asegurar que las personas tomen conciencia de la política de la calidad y los objetivos de calidad?',
    '¿Se ha comunicado su contribución a la eficacia del sistema y los beneficios de una mejora del desempeño?',
    '¿Se han realizado acciones para que las personas tomen conciencia de las consecuencias de incumplir los requisitos del sistema de gestión de calidad?'
  ],
  '7.4': [
    '¿Se han determinado las comunicaciones internas y externas pertinentes al sistema de gestión de la calidad?',
    '¿Se encuentra definido qué, cuándo, a quién, cómo y quién realiza cada comunicación?'
  ],
  '7.5': [
    '¿Se ha identificado la documentación requerida por la norma y el propio sistema de gestión?',
    '¿La identificación y descripción de los documentos es apropiada?',
    '¿Se encuentra definido el formato y soporte de cada documento?',
    '¿Existe una metodología de revisión y aprobación adecuada?',
    '¿La documentación está disponible en los puntos de uso para su consulta?',
    '¿La documentación está protegida adecuadamente contra pérdida o uso inadecuado?',
    '¿Se han definido metodologías para la distribución, acceso, recuperación y uso de los documentos?',
    '¿Se contemplan actividades para el almacenamiento y preservación de los documentos (copias de seguridad)?',
    '¿Existe un control de cambios en los documentos del sistema?',
    '¿Se ha identificado la documentación de origen externo necesaria para el desempeño de los procesos?'
  ],
  '8.1': [
    '¿Se han identificado los procesos necesarios para cumplir los requisitos de los clientes?',
    '¿Se han establecido criterios para la operación de los procesos?',
    '¿Se controlan los procesos contratados externamente?'
  ],
  '8.2': [
    '¿Se han determinado cuáles son las comunicaciones necesarias con los clientes?',
    '¿Se determinan los requisitos de los clientes y adicionales de los productos y servicios a ofrecer?',
    '¿Se revisa la definición de requisitos y la posibilidad de cumplimiento de las condiciones por la organización?',
    '¿Se han tenido en cuenta los requisitos legales asociados a los productos y servicios?',
    '¿Se conserva toda la información documentada sobre las comunicaciones, requisitos y revisiones con los clientes (presupuestos, contratos, etc.)?',
    '¿Existe una metodología para realizar cambios, su revisión y comunicación de las modificaciones?'
  ],
  '8.3': [
    '¿Existe una planificación del diseño y desarrollo?',
    '¿Existe una metodología definida para la identificación de entradas para el diseño?',
    '¿Existen controles establecidos para cada una de las etapas del diseño?',
    '¿Existe una metodología para validar las salidas del diseño y desarrollo?',
    '¿Existe una metodología para el control de cambios en el diseño y desarrollo?'
  ],
  '8.4': [
    'La organización debe asegurarse de que los procesos, productos y servicios suministrados externamente son conformes a los requisitos',
    'La organización debe determinar los controles a aplicar a los procesos, productos y servicios suministrados externamente',
    'La organización debe determinar y aplicar criterios para la evaluación, la selección, el seguimiento del desempeño y la reevaluación de los proveedores externos',
    'La organización debe asegurarse de que los procesos, productos y servicios suministrados externamente no afectan de manera adversa a la capacidad de la organización de entregar productos y servicios conformes de manera coherente a sus clientes',
    'La organización debe asegurarse de la adecuación de los requisitos antes de su comunicación al proveedor externo'
  ],
  '8.5': [
    '¿Están la producción y provisión del servicio bajo condiciones controladas?',
    '¿Se dispone de la información documentada y recursos necesarios para la operación?',
    '¿Existen etapas de implementación de actividades de seguimiento y medición, especialmente previas a la liberación y a la entrega?',
    '¿Se aplican métodos adecuados para la identificación y trazabilidad de las salidas para asegurar la conformidad de los productos?',
    '¿Existen requisitos de trazabilidad que se desarrollan de acuerdo a los requisitos?',
    '¿Se cuida, identifica y protege la propiedad perteneciente a clientes y proveedores externos?',
    '¿Las condiciones de preservación de los productos son las adecuadas?',
    '¿Se cumplen con las actividades posteriores a la entrega cuando existan y sea un requisito?',
    '¿En caso de cambios los mismos son justificados por información documentada?'
  ],
  '8.6': [
    '¿Se han establecido los controles oportunos para la liberación del producto?',
    '¿Se han determinado las responsabilidades para la liberación de los productos?',
    '¿Existe información documentada que evidencie la liberación y que permita la trazabilidad de la misma?'
  ],
  '8.7': [
    '¿Las salidas no conformes son identificadas para prevenir su uso o entrega no intencionada?',
    '¿Se emprenden las acciones oportunas sobre el producto no conforme: corrección, separación, información al cliente, etc.?',
    '¿Se mantiene la información documentada de cada salida no conforme?'
  ],
  '9.1': [
    '¿La organización evalúa el desempeño y la eficacia del sistema de gestión de la calidad?',
    '¿Existe una metodología definida para realizar el seguimiento de las percepciones de los clientes del grado en el que se cumplen sus necesidades y expectativas?',
    '¿Los resultados de esta retroalimentación de la percepción del cliente permiten evidenciar la mejora en la satisfacción del cliente?',
    '¿Los clientes analizados son suficientemente representativos para conocer la satisfacción general de los clientes?'
  ],
  '9.2': [
    '¿Las auditorías internas se realizan de forma planificada?',
    '¿Se garantiza la competencia e independencia de los auditores internos?',
    '¿El alcance de la auditoría y los métodos son apropiados para evaluar la eficacia del sistema de gestión de la calidad?',
    '¿La dirección pertinente es informada de los resultados de auditoría?',
    '¿Se emprenden acciones para solventar los incumplimientos detectados en las auditorías internas?'
  ],
  '9.3': [
    '¿Se han incluido todas las entradas de la revisión presentes en la norma de referencia?',
    '¿Se han tratado todas las salidas necesarias requeridas por la norma de referencia?',
    '¿Existe una metodología definida y una planificación para la realización de las revisiones por la dirección?',
    '¿Se está empleando la revisión por la dirección como una herramienta de mejora del sistema de gestión de la calidad?'
  ],
  '10.1': [
    '¿La organización planifica acciones para la mejora de la satisfacción del cliente y del desempeño del sistema de gestión de la calidad?',
    '¿Se contemplan para la mejora las necesidades y expectativas de las partes interesadas?',
    '¿Se contemplan los riesgos y oportunidades para emprender acciones para la mejora?'
  ],
  '10.2': [
    '¿Existe una metodología para el tratamiento de las no conformidades y las quejas?',
    '¿Se está realizando análisis de las causas de las no conformidades para emprender acciones correctivas?',
    '¿Existe análisis de la repetitividad de las no conformidades para emprender acciones correctivas?',
    '¿La documentación de las no conformidades y acciones correctivas es adecuada para conocer las causas, responsabilidades, resultados y análisis de la eficacia?'
  ],
  '10.3': [
    '¿La organización dispone de las herramientas adecuadas para favorecer la mejora continua (objetivos, acciones, salidas de la revisión, etc.)?',
    '¿Existen evidencias de estas mejoras planificadas por la organización?',
    '¿Las mejoras a emprender tienen en cuenta las necesidades y expectativas de las partes interesadas, el análisis de contexto y los riesgos y oportunidades?'
  ]
};

module.exports = { CLAUSULAS_ISO9001, PREGUNTAS_VERIFICACION_ISO9001 };
