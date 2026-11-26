// Oficina virtual — trae a las personas reales desde SIGSO (getOficinaVirtual)
// antes de armar la escena. Sin sesión, o si el servidor no responde, se ve la
// distribución con los cargos de ejemplo de datos.js.
//
// Cada persona real hereda de la "plantilla" de su oficina (datos.js) cómo se
// ve (genero, audífonos) y su globo de tarea: se empareja por oficina y por
// las palabras del cargo. El nombre, el cargo, la jefatura y el descriptor
// vienen siempre de Calidad → Personas.
const D = window.OFICINA;
const plantilla = D.personas.slice();
D.modo = 'ejemplo';

const normal = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const palabras = s => normal(s).split(/[^a-z0-9]+/).filter(w => w.length > 3);
function corto(nombre) {
  const p = String(nombre || '').trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[1][0]}.` : (p[0] || '');
}
// Primero se emparejan los cargos que más se parecen (y no en orden alfabético),
// para que un cargo sin plantilla no le quite la suya a otro.
function emparejar(reales) {
  const pares = [];
  reales.forEach((r, i) => plantilla.forEach(t => {
    if (r.fantasma || t.sala !== r.sala_id) return;
    pares.push({ i, t, puntos: palabras(t.cargo).filter(w => palabras(r.cargo).includes(w)).length });
  }));
  pares.sort((a, b) => b.puntos - a.puntos);
  const resultado = reales.map(() => null), usadas = new Set();
  for (const { i, t, puntos } of pares) {
    if (resultado[i] || usadas.has(t.id) || puntos === 0) continue;
    resultado[i] = t; usadas.add(t.id);
  }
  return resultado;
}

async function cargar() {
  let token = null;
  try { token = localStorage.getItem('sigso_portal_token'); } catch (e) { /* sin almacenamiento */ }
  if (!token || typeof window.llamarApi !== 'function' || !window.SIGSO_CONFIG) return 'Vista de ejemplo · ingresa a SIGSO para ver a tu equipo';
  let r;
  try { r = await window.llamarApi(window.SIGSO_CONFIG.NODE_API_URL, 'getOficinaVirtual', {}); }
  catch (e) { return 'Vista de ejemplo · no se pudo conectar con SIGSO'; }
  if (!r || !r.ok || !r.data) return 'Vista de ejemplo · ' + ((r && r.message) || 'no se pudo leer SIGSO');

  const reales = r.data.personas || [];
  const tipos = emparejar(reales);
  const personas = reales.map((p, i) => {
    const t = tipos[i] || {};
    const d = p.descriptor;
    return {
      id: p.persona_id, real: true, nombre: p.nombre, cargo: p.cargo, sala_asignada: p.sala_asignada,
      // los fantasmas no tienen puesto: recorren la oficina
      sala: p.fantasma ? '' : p.sala_id, fantasma: !!p.fantasma,
      jefatura: p.jefatura_persona_id || null, corto: corto(p.nombre),
      genero: t.genero || null, audifonos: !!t.audifonos,
      tarea: t.tarea || (d && d.funciones && d.funciones[0]) || p.cargo,
      descriptor: d, descriptores: p.descriptores || []
    };
  });
  // El podcast recibe invitados que no son personal: si nadie del equipo está
  // sentado ahí, se mantienen el entrevistador y el invitado de la plantilla.
  if (!personas.some(p => p.sala === 'podcast')) personas.push(...plantilla.filter(t => t.sala === 'podcast'));
  D.personas = personas;
  D.modo = 'real';
  D.puede_ordenar = !!r.data.puede_ordenar;
  D.sin_oficina = r.data.sin_oficina || [];
  D.yo = r.data.yo || { persona_id: '', nombre: '' };          // a quién controla «Moverme»
  D.candidatos_fantasma = r.data.candidatos_fantasma || [];
  return 'Datos de SIGSO · Calidad → Personas';
}

const aviso = await cargar();
D.aviso = aviso;
await import('./escena.js' + new URL(import.meta.url).search); // misma versión que esta página
