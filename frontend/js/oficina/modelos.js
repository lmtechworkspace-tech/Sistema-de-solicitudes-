// Modelos 3D hechos en código (sin archivos externos): muebles, objetos y personajes.
// Todos miran hacia +z en su sistema local; se giran con rotation.y al ubicarlos.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- utilidades ----------
const cacheGeo = new Map();
export function rbox(w, h, d, r = 0.02, seg = 2) {
  const k = `rb${w}|${h}|${d}|${r}`;
  if (!cacheGeo.has(k)) cacheGeo.set(k, new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2)));
  return cacheGeo.get(k);
}
export function malla(geo, mat, x = 0, y = 0, z = 0, sombra = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = sombra; m.receiveShadow = true;
  return m;
}
export function lienzo(w, h, dibujar) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  dibujar(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
export function azar(semilla) { let s = semilla >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function hash(txt) { let h = 2166136261; for (const c of String(txt)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

export const pon = (padre, hijo) => (padre.add(hijo), hijo);

// ---------- materiales ----------
const std = (color, rough = 0.6, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
export const MAT = {
  nogal: std('#5b3a26', 0.45),          // escritorios café oscuro del video
  caoba: std('#8a3b1e', 0.35),          // mesón de recepción y escritorio en L
  negroMesa: std('#1c1b1d', 0.22, 0.1),
  cromo: std('#c9ccd1', 0.25, 0.9),
  bronce: std('#6d6256', 0.4, 0.6),     // marcos de aluminio color bronce
  plastNegro: std('#26272b', 0.55),
  malla: std('#2e3035', 0.85),
  blanco: std('#f7f7f5', 0.5),
  blancoMate: std('#eeeeea', 0.8),
  gris: std('#9aa0a6', 0.6),
  pantallaMarco: std('#17181b', 0.35),
  vidrio: new THREE.MeshPhysicalMaterial({ color: '#d8eef5', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false }),
  vidrioMesa: new THREE.MeshPhysicalMaterial({ color: '#cfe8e0', roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false }),
  esmerilado: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false }),
  franjaOscura: new THREE.MeshStandardMaterial({ color: '#3b2f28', roughness: 0.3, transparent: true, opacity: 0.6, depthWrite: false }),
  hoja: std('#4e8f3a', 0.7), hoja2: std('#6aab45', 0.7), tierra: std('#4a3426', 1),
  maceta: std('#f1efe9', 0.5), macetaTerracota: std('#c56a3e', 0.8),
  rojo: std('#c8211d', 0.4), verdeSalida: std('#11a359', 0.5, 0, { emissive: '#0a6', emissiveIntensity: 0.25 }),
  papel: std('#fbfbf8', 0.9), corcho: std('#b98b5c', 0.95), carpetaAzul: std('#2f5fa8', 0.7),
  carpetaRoja: std('#b8442f', 0.7), carpetaAmarilla: std('#d9a521', 0.7), carpetaVerde: std('#3b8a4d', 0.7),
  piel: ['#f1c7a6', '#e0ac87', '#c98e66', '#a9714d', '#f5d5bd'].map(c => std(c, 0.75)),
  pelo: ['#2b1d16', '#4a2f20', '#1a1414', '#7a4a2a', '#b3833f', '#3b2a22'].map(c => std(c, 0.85)),
  pantalon: ['#2b3445', '#3a3a3f', '#1f2a37', '#4a4038'].map(c => std(c, 0.8)),
  ojos: std('#1a1414', 0.3), mejilla: new THREE.MeshBasicMaterial({ color: '#ff9e9e', transparent: true, opacity: 0.55 }),
  zapato: std('#222', 0.6)
};

// ---------- texturas de pantalla, pizarras y diario mural ----------
function pantallaTex(tipo, color) {
  return lienzo(256, 160, (g, w, h) => {
    g.fillStyle = '#f7f9fc'; g.fillRect(0, 0, w, h);
    g.fillStyle = color; g.fillRect(0, 0, w, 18);
    g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.fillText('SIGSO', 8, 13);
    if (tipo === 0) { // planilla
      g.strokeStyle = '#d5dbe3';
      for (let y = 26; y < h; y += 12) { g.beginPath(); g.moveTo(6, y); g.lineTo(w - 6, y); g.stroke(); }
      for (let x = 6; x < w; x += 50) { g.beginPath(); g.moveTo(x, 22); g.lineTo(x, h - 4); g.stroke(); }
      g.fillStyle = '#9aa7b6'; for (let y = 34; y < h; y += 12) for (let x = 12; x < w - 40; x += 50) g.fillRect(x, y - 6, 18 + (x * y) % 22, 4);
    } else if (tipo === 1) { // tablero con barras
      for (let i = 0; i < 3; i++) { g.fillStyle = '#e8edf3'; g.fillRect(8 + i * 82, 26, 74, 34); g.fillStyle = color; g.font = 'bold 15px sans-serif'; g.fillText(['92%', '14', '3'][i], 16 + i * 82, 50); }
      for (let i = 0; i < 10; i++) { const a = 20 + ((i * 37) % 60); g.fillStyle = i % 2 ? color : '#94a3b8'; g.fillRect(14 + i * 23, h - 10 - a, 14, a); }
    } else { // bandeja de solicitudes
      for (let y = 26, i = 0; y < h - 10; y += 22, i++) {
        g.fillStyle = '#ffffff'; g.fillRect(8, y, w - 16, 18); g.strokeStyle = '#e2e8f0'; g.strokeRect(8, y, w - 16, 18);
        g.fillStyle = ['#16a34a', '#e9a23b', '#dc2626', '#0284c7'][i % 4]; g.fillRect(12, y + 5, 8, 8);
        g.fillStyle = '#64748b'; g.fillRect(26, y + 6, 90 + (i * 23) % 60, 5);
      }
    }
  });
}
const cachePantalla = new Map();
export function matPantalla(tipo, color) {
  const k = tipo + color;
  if (!cachePantalla.has(k)) cachePantalla.set(k, new THREE.MeshStandardMaterial({ map: pantallaTex(tipo, color), emissive: '#ffffff', emissiveMap: pantallaTex(tipo, color), emissiveIntensity: 0.55, roughness: 0.3 }));
  return cachePantalla.get(k);
}
export function texPizarra(lineas = ['Metas noviembre', '• Cierre F29', '• Auditoría ISO'], conBandera = false) {
  return lienzo(512, 256, (g, w, h) => {
    g.fillStyle = '#fbfcfd'; g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    lineas.forEach((t, i) => { g.fillStyle = i === 0 ? '#1d4ed8' : '#334155'; g.font = (i === 0 ? 'bold 34px' : '28px') + ' "Comic Sans MS", cursive'; g.fillText(t, 26, 50 + i * 44); });
    g.strokeStyle = '#dc2626'; g.lineWidth = 4; g.beginPath(); g.ellipse(w - 110, h - 70, 70, 34, -0.1, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#dc2626'; g.font = 'bold 26px "Comic Sans MS", cursive'; g.fillText('¡OK!', w - 140, h - 62);
    if (conBandera) { g.fillStyle = '#fff'; g.fillRect(w - 120, 14, 96, 64); g.fillStyle = '#d52b1e'; g.fillRect(w - 120, 46, 96, 32); g.fillStyle = '#0039a6'; g.fillRect(w - 120, 14, 32, 32); g.strokeStyle = '#999'; g.strokeRect(w - 120, 14, 96, 64); }
  });
}
export function texDiarioMural() {
  return lienzo(256, 192, (g, w, h) => {
    g.fillStyle = '#b98b5c'; g.fillRect(0, 0, w, h);
    const r = azar(7);
    for (let i = 0; i < 14; i++) {
      g.save(); g.translate(20 + r() * (w - 60), 16 + r() * (h - 60)); g.rotate((r() - 0.5) * 0.3);
      g.fillStyle = ['#fff59d', '#ffffff', '#f8bbd0', '#b3e5fc', '#c8e6c9', '#d32f2f'][i % 6]; g.fillRect(0, 0, 40, 34);
      g.fillStyle = 'rgba(0,0,0,.35)'; for (let k = 0; k < 3; k++) g.fillRect(5, 8 + k * 8, 26, 2); g.restore();
    }
  });
}
export function texPiso(tonos = ['#7d3417', '#8b3c1b', '#96441f', '#843a1d', '#a14b24'], ancho = 0.14) {
  const plancha = 1024, filas = Math.round(1.6 / ancho);
  return lienzo(plancha, plancha, (g, w, h) => {
    const r = azar(3), alto = h / filas;
    for (let f = 0; f < filas; f++) {
      let x = -r() * 300;
      while (x < w) {
        const largo = 260 + r() * 360;
        g.fillStyle = tonos[Math.floor(r() * tonos.length)]; g.fillRect(x, f * alto, largo, alto);
        for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(40,12,0,${0.05 + r() * 0.07})`; g.fillRect(x, f * alto + r() * alto, largo, 1 + r() * 2); }
        g.fillStyle = 'rgba(30,8,0,.55)'; g.fillRect(x, f * alto, 2, alto);
        x += largo;
      }
      g.fillStyle = 'rgba(30,8,0,.5)'; g.fillRect(0, f * alto, w, 2);
    }
  });
}
export function texBaldosa(color = '#eef0f2') {
  return lienzo(256, 256, (g, w, h) => { g.fillStyle = color; g.fillRect(0, 0, w, h); g.strokeStyle = '#c9cdd2'; g.lineWidth = 3; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); } });
}

// ---------- muebles ----------
export function sillaOficina({ color = MAT.malla, brazos = true } = {}) {
  const g = new THREE.Group();
  g.add(malla(rbox(0.5, 0.08, 0.48, 0.035), MAT.plastNegro, 0, 0.47, 0));
  g.add(malla(rbox(0.46, 0.05, 0.44, 0.02), color, 0, 0.52, 0.01));
  const resp = malla(rbox(0.46, 0.62, 0.06, 0.03), color, 0, 0.88, -0.24); resp.rotation.x = -0.12; g.add(resp);
  g.add(malla(rbox(0.06, 0.4, 0.04, 0.01), MAT.plastNegro, 0, 0.62, -0.24));
  if (brazos) for (const s of [-1, 1]) { g.add(malla(rbox(0.05, 0.03, 0.26, 0.012), MAT.plastNegro, s * 0.27, 0.72, -0.02)); g.add(malla(rbox(0.03, 0.2, 0.03, 0.01), MAT.plastNegro, s * 0.27, 0.62, -0.1)); }
  g.add(malla(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 10), MAT.cromo, 0, 0.27, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, pata = malla(rbox(0.3, 0.035, 0.05, 0.012), MAT.plastNegro, Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15);
    pata.rotation.y = -a; g.add(pata);
    g.add(malla(new THREE.SphereGeometry(0.03, 8, 6), MAT.plastNegro, Math.cos(a) * 0.29, 0.03, Math.sin(a) * 0.29));
  }
  return g;
}
export function sillaVisita() { // silla negra de malla con patas cromadas (sala de reuniones)
  const g = new THREE.Group();
  g.add(malla(rbox(0.46, 0.06, 0.44, 0.03), MAT.malla, 0, 0.46, 0));
  const r = malla(rbox(0.46, 0.42, 0.05, 0.03), MAT.malla, 0, 0.72, -0.21); r.rotation.x = -0.15; g.add(r);
  for (const sx of [-0.19, 0.19]) for (const sz of [-0.18, 0.18]) g.add(malla(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6), MAT.cromo, sx, 0.22, sz));
  return g;
}
export function monitor(matP) {
  const g = new THREE.Group();
  g.add(malla(rbox(0.22, 0.015, 0.16, 0.007), MAT.pantallaMarco, 0, 0.008, 0));
  g.add(malla(rbox(0.04, 0.2, 0.025, 0.01), MAT.pantallaMarco, 0, 0.11, -0.02));
  g.add(malla(rbox(0.6, 0.36, 0.03, 0.012), MAT.pantallaMarco, 0, 0.32, 0));
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.32), matP); p.position.set(0, 0.32, 0.0162); g.add(p);
  return g;
}
export function notebook(matP) {
  const g = new THREE.Group();
  g.add(malla(rbox(0.34, 0.015, 0.24, 0.006), MAT.gris, 0, 0.008, 0));
  const tapa = new THREE.Group(); tapa.position.set(0, 0.015, -0.12); tapa.rotation.x = -0.25;
  tapa.add(malla(rbox(0.34, 0.22, 0.01, 0.006), MAT.gris, 0, 0.11, 0));
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.19), matP); p.position.set(0, 0.11, 0.0055); tapa.add(p);
  g.add(tapa); return g;
}
export function teclado() { const g = new THREE.Group(); g.add(malla(rbox(0.42, 0.018, 0.13, 0.006), MAT.plastNegro, 0, 0.009, 0)); g.add(malla(rbox(0.06, 0.02, 0.1, 0.01), MAT.plastNegro, 0.3, 0.01, 0.02)); return g; }
export function taza(color = '#ffffff') { const g = new THREE.Group(); g.add(malla(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 14), std(color, 0.4), 0, 0.05, 0)); g.add(malla(new THREE.TorusGeometry(0.025, 0.008, 6, 12), std(color, 0.4), 0.045, 0.055, 0)); return g; }
export function papeles(n = 3) { const g = new THREE.Group(); for (let i = 0; i < n; i++) { const p = malla(new THREE.BoxGeometry(0.21, 0.003, 0.297), MAT.papel, i * 0.02, 0.002 + i * 0.003, i * 0.01, false); p.rotation.y = (i - 1) * 0.15; g.add(p); } return g; }
export function impresora() { const g = new THREE.Group(); g.add(malla(rbox(0.42, 0.24, 0.36, 0.03), std('#e7e7e3', 0.5), 0, 0.12, 0)); g.add(malla(rbox(0.36, 0.03, 0.2, 0.01), MAT.plastNegro, 0, 0.25, -0.04)); g.add(malla(new THREE.BoxGeometry(0.21, 0.004, 0.15), MAT.papel, 0, 0.18, 0.21)); return g; }
export function ventilador() {
  const g = new THREE.Group();
  g.add(malla(new THREE.CylinderGeometry(0.13, 0.15, 0.03, 18), MAT.blanco, 0, 0.015, 0));
  g.add(malla(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 8), MAT.blanco, 0, 0.32, 0));
  const c = new THREE.Group(); c.position.y = 0.66; g.add(c);
  c.add(malla(new THREE.TorusGeometry(0.17, 0.008, 6, 28), MAT.blanco, 0, 0, 0.03));
  const aspas = new THREE.Group(); aspas.position.z = 0.03; c.add(aspas);
  for (let i = 0; i < 3; i++) { const a = malla(new THREE.CircleGeometry(0.08, 10), std('#e8eef5', 0.4, 0, { side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), 0, 0, 0, false); a.scale.set(0.55, 1, 1); a.position.set(Math.sin(i * 2.09) * 0.07, Math.cos(i * 2.09) * 0.07, 0); a.rotation.z = -i * 2.09; aspas.add(a); }
  g.userData.aspas = aspas;
  return g;
}
export function planta(tam = 1, tipo = 0) {
  const g = new THREE.Group();
  const r = azar(hash(tam + ':' + tipo));
  g.add(malla(new THREE.CylinderGeometry(0.16 * tam, 0.12 * tam, 0.3 * tam, 16), tipo === 2 ? MAT.macetaTerracota : MAT.maceta, 0, 0.15 * tam, 0));
  g.add(malla(new THREE.CylinderGeometry(0.15 * tam, 0.15 * tam, 0.02, 16), MAT.tierra, 0, 0.29 * tam, 0, false));
  if (tipo === 1) { // arbolito de bola como el del mesón de recepción
    g.add(malla(new THREE.CylinderGeometry(0.012 * tam, 0.015 * tam, 0.5 * tam, 6), MAT.nogal, 0, 0.55 * tam, 0));
    for (const [y, s] of [[0.55, 0.16], [0.75, 0.13], [0.9, 0.09]]) g.add(malla(new THREE.IcosahedronGeometry(s * tam, 1), MAT.hoja, 0, y * tam, 0));
    return g;
  }
  for (let i = 0; i < 9; i++) {
    const h = malla(new THREE.ConeGeometry(0.07 * tam, (0.55 + r() * 0.35) * tam, 5), i % 2 ? MAT.hoja : MAT.hoja2, 0, 0.5 * tam, 0);
    const a = (i / 9) * Math.PI * 2; h.rotation.set(Math.cos(a) * (0.25 + r() * 0.35), 0, Math.sin(a) * (0.25 + r() * 0.35));
    h.position.x = Math.sin(a) * 0.05 * tam; h.position.z = Math.cos(a) * 0.05 * tam; g.add(h);
  }
  return g;
}
export function arbol(tam = 1) {
  const g = new THREE.Group();
  g.add(malla(new THREE.CylinderGeometry(0.1 * tam, 0.14 * tam, 1.3 * tam, 7), std('#6b4a2f', 0.9), 0, 0.65 * tam, 0));
  for (const [x, y, z, s] of [[0, 1.7, 0, 0.75], [0.35, 1.45, 0.15, 0.5], [-0.3, 1.5, -0.1, 0.55], [0.05, 2.1, 0.05, 0.5]]) g.add(malla(new THREE.IcosahedronGeometry(s * tam, 0), std('#5d9b45', 0.8, 0, { flatShading: true }), x * tam, y * tam, z * tam));
  return g;
}
export function escritorio({ ancho = 1.4, fondo = 0.7, mat = MAT.nogal, cajonera = 1 } = {}) {
  const g = new THREE.Group(), h = 0.75;
  g.add(malla(rbox(ancho, 0.035, fondo, 0.012), mat, 0, h, 0));
  g.add(malla(rbox(0.035, h, fondo - 0.04, 0.01), mat, -ancho / 2 + 0.03, h / 2, 0));
  if (!cajonera) g.add(malla(rbox(0.035, h, fondo - 0.04, 0.01), mat, ancho / 2 - 0.03, h / 2, 0));
  g.add(malla(rbox(ancho - 0.08, 0.45, 0.02, 0.008), mat, 0, h - 0.27, fondo / 2 - 0.04)); // faldón
  if (cajonera) {
    const x = ancho / 2 - 0.22;
    g.add(malla(rbox(0.42, h - 0.02, fondo - 0.04, 0.012), mat, x, (h - 0.02) / 2, 0));
    for (let i = 0; i < 3; i++) g.add(malla(rbox(0.14, 0.015, 0.015, 0.005), MAT.cromo, x, 0.17 + i * 0.2, -fondo / 2 + 0.01));
  }
  return g;
}
export function escritorioL({ mat = MAT.caoba } = {}) { // escritorio en L de la oficina con vidrio
  const g = new THREE.Group();
  g.add(malla(rbox(1.6, 0.035, 0.7, 0.02), mat, 0, 0.75, 0));
  g.add(malla(rbox(0.6, 0.035, 1.1, 0.02), mat, 0.8 + 0.3 - 0.05, 0.75, -0.2));
  g.add(malla(rbox(0.04, 0.73, 0.6, 0.01), MAT.gris, -0.75, 0.37, 0));
  g.add(malla(rbox(0.45, 0.72, 0.6, 0.02), MAT.nogal, 1.07, 0.36, -0.45));
  g.add(malla(rbox(1.5, 0.4, 0.02, 0.01), mat, 0, 0.5, 0.33));
  return g;
}
export function cajonera(alto = 0.7, mat = MAT.nogal, ancho = 0.5) {
  const g = new THREE.Group(); g.add(malla(rbox(ancho, alto, 0.55, 0.015), mat, 0, alto / 2, 0));
  const n = Math.max(2, Math.round(alto / 0.25));
  for (let i = 0; i < n; i++) g.add(malla(rbox(0.16, 0.018, 0.018, 0.006), MAT.cromo, 0, (i + 0.6) * (alto / n), 0.28));
  return g;
}
export function estante({ ancho = 1.0, alto = 1.8, fondo = 0.35, carpetas = true } = {}) {
  const g = new THREE.Group(), niveles = 5, r = azar(hash(ancho + alto));
  g.add(malla(rbox(ancho, alto, 0.02, 0.005), MAT.nogal, 0, alto / 2, -fondo / 2));
  for (const s of [-1, 1]) g.add(malla(rbox(0.025, alto, fondo, 0.005), MAT.nogal, s * (ancho / 2 - 0.012), alto / 2, 0));
  const mats = [MAT.carpetaAzul, MAT.carpetaRoja, MAT.carpetaAmarilla, MAT.carpetaVerde, MAT.blancoMate];
  for (let i = 0; i <= niveles; i++) {
    const y = (i / niveles) * (alto - 0.03) + 0.015;
    g.add(malla(rbox(ancho - 0.04, 0.025, fondo - 0.02, 0.005), MAT.nogal, 0, y, 0));
    if (carpetas && i < niveles) for (let x = -ancho / 2 + 0.06; x < ancho / 2 - 0.08; x += 0.075) {
      if (r() < 0.18) continue;
      const hc = 0.26 + r() * 0.04;
      g.add(malla(rbox(0.065, hc, fondo * 0.8, 0.006), mats[Math.floor(r() * mats.length)], x, y + hc / 2 + 0.012, 0.01));
    }
  }
  return g;
}
export function pizarra(tex, ancho = 1.6, alto = 0.9) {
  const g = new THREE.Group();
  g.add(malla(rbox(ancho + 0.04, alto + 0.04, 0.025, 0.006), MAT.cromo, 0, 0, 0));
  const p = new THREE.Mesh(new THREE.PlaneGeometry(ancho, alto), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25 })); p.position.z = 0.014; g.add(p);
  g.add(malla(rbox(ancho * 0.6, 0.025, 0.06, 0.005), MAT.cromo, 0, -alto / 2 - 0.02, 0.03));
  return g;
}
export function tele() {
  const g = new THREE.Group(); g.add(malla(rbox(1.3, 0.74, 0.05, 0.01), MAT.pantallaMarco, 0, 0, 0));
  const p = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.68), new THREE.MeshStandardMaterial({ color: '#0e1a2b', roughness: 0.15, metalness: 0.3 })); p.position.z = 0.026; g.add(p);
  return g;
}
export function aireAcondicionado() { const g = new THREE.Group(); g.add(malla(rbox(0.9, 0.3, 0.22, 0.06), MAT.blanco, 0, 0, 0)); g.add(malla(rbox(0.8, 0.02, 0.02, 0.005), MAT.gris, 0, -0.1, 0.11)); return g; }
export function extintor() {
  const g = new THREE.Group();
  g.add(malla(new THREE.CylinderGeometry(0.08, 0.08, 0.45, 14), MAT.rojo, 0, 0.225, 0));
  g.add(malla(new THREE.SphereGeometry(0.08, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.rojo, 0, 0.45, 0));
  g.add(malla(rbox(0.05, 0.08, 0.05, 0.01), MAT.plastNegro, 0, 0.53, 0));
  const letrero = malla(new THREE.BoxGeometry(0.2, 0.3, 0.01), std('#d0201b', 0.6), 0, 0.85, -0.06); g.add(letrero);
  return g;
}
export function letreroSalida() { const g = new THREE.Group(); g.add(malla(new THREE.BoxGeometry(0.3, 0.16, 0.015), MAT.verdeSalida, 0, 0, 0)); return g; }
export function dispensadorAgua() { const g = new THREE.Group(); g.add(malla(rbox(0.32, 0.95, 0.32, 0.03), MAT.blanco, 0, 0.475, 0)); g.add(malla(new THREE.CylinderGeometry(0.13, 0.13, 0.4, 16), std('#7cc4f0', 0.1, 0, { transparent: true, opacity: 0.7 }), 0, 1.15, 0)); return g; }
export function puertaHoja(ancho = 0.85, alto = 2.05, mat = MAT.blanco) { // hoja blanca con manilla dorada; bisagra en x=0
  const g = new THREE.Group();
  g.add(malla(rbox(ancho, alto, 0.04, 0.008), mat, ancho / 2, alto / 2, 0));
  g.add(malla(rbox(0.12, 0.02, 0.03, 0.008), std('#c9a54a', 0.3, 0.8), ancho - 0.1, 1.0, 0.04));
  return g;
}
export function persiana(ancho, alto, color = '#d7c8b0') { // persianas horizontales (las del video)
  const g = new THREE.Group(), m = std(color, 0.6);
  for (let y = 0; y < alto; y += 0.05) pon(g, malla(new THREE.BoxGeometry(ancho, 0.035, 0.01), m, 0, y - alto / 2 + 0.03, 0, false)).rotation.x = 0.5;
  return g;
}

// ---------- estudio de podcast ----------
export function microfonoBrazo() { // micrófono de podcast en brazo articulado, sujeto a la mesa
  const g = new THREE.Group(), ma = std('#1d1e22', 0.35, 0.4);
  g.add(malla(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10), ma, 0, 0.03, 0));
  const b1 = malla(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8), ma, 0, 0.24, 0.08); b1.rotation.x = 0.4; g.add(b1);
  const b2 = malla(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 8), ma, 0, 0.47, 0.32); b2.rotation.x = 1.25; g.add(b2);
  const mic = malla(new THREE.CapsuleGeometry(0.035, 0.12, 6, 12), std('#2a2b30', 0.3, 0.6), 0, 0.42, 0.52); mic.rotation.x = 0.35; g.add(mic);
  g.add(malla(new THREE.SphereGeometry(0.055, 14, 10), std('#3b3c42', 0.9), 0, 0.47, 0.54)); // espuma
  return g;
}
export function camaraTripode() {
  const g = new THREE.Group(), ma = std('#1f2023', 0.4, 0.3);
  for (let i = 0; i < 3; i++) { const a = i * 2.09, p = malla(new THREE.CylinderGeometry(0.012, 0.016, 1.45, 6), ma, Math.sin(a) * 0.2, 0.68, Math.cos(a) * 0.2); p.rotation.set(Math.cos(a) * 0.28, 0, -Math.sin(a) * 0.28); g.add(p); }
  g.add(malla(rbox(0.16, 0.12, 0.24, 0.02), ma, 0, 1.45, 0));
  pon(g, malla(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 16), std('#111', 0.2, 0.5), 0, 1.46, 0.16)).rotation.x = Math.PI / 2;
  const luz = malla(new THREE.SphereGeometry(0.015, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3b30' }), 0.06, 1.53, 0.1, false); g.add(luz);
  g.userData.luz = luz;
  return g;
}
export function aroLuz() {
  const g = new THREE.Group(), ma = std('#1f2023', 0.4, 0.3);
  g.add(malla(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16), ma, 0, 0.01, 0));
  g.add(malla(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 8), ma, 0, 0.75, 0));
  g.add(malla(new THREE.TorusGeometry(0.22, 0.03, 10, 32), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff6e6', emissiveIntensity: 1.4 }), 0, 1.62, 0, false));
  return g;
}
export function panelAcustico(color = '#2f3b4c') {
  const g = new THREE.Group(), m = std(color, 1);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g.add(malla(rbox(0.38, 0.38, 0.05, 0.02), m, (i - 1) * 0.4, (j - 0.5) * 0.4, 0, false));
  return g;
}
export function sillon(color = '#6b7280') {
  const g = new THREE.Group(), m = std(color, 0.9);
  g.add(malla(rbox(0.75, 0.42, 0.7, 0.08), m, 0, 0.25, 0));
  g.add(malla(rbox(0.75, 0.5, 0.18, 0.08), m, 0, 0.62, -0.28));
  for (const s of [-1, 1]) g.add(malla(rbox(0.14, 0.24, 0.7, 0.06), m, s * 0.33, 0.55, 0));
  return g;
}
export function letreroNeon(texto, color = '#ff9f1c') {
  const tex = lienzo(1024, 200, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.font = 'bold 92px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 30; g.fillStyle = color; g.fillText(texto, w / 2, h / 2); g.shadowBlur = 0; g.fillStyle = '#fff7e8'; g.fillText(texto, w / 2, h / 2);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
}

// ---------- estudio «Vida de Contratistas» (según la foto del set) ----------
// Logo del podcast dibujado (no es la imagen original): fondo oscuro con franjas
// naranjas, grúa, casco, y el nombre del programa.
export function texLogoPodcast(conFranjas = true) {
  return lienzo(640, 360, (g, w, h) => {
    const fondo = g.createLinearGradient(0, 0, w, h); fondo.addColorStop(0, '#15161a'); fondo.addColorStop(1, '#2a2622');
    g.fillStyle = fondo; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.05)'; for (let x = 30; x < w; x += 46) g.fillRect(x, 170 + (x * 7) % 90, 26, h); // edificios
    if (conFranjas) { g.fillStyle = '#f08a1c'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(10 + i * 34, 0); g.lineTo(40 + i * 34, 0); g.lineTo(-40 + i * 34, 120); g.lineTo(-70 + i * 34, 120); g.fill(); g.beginPath(); g.moveTo(w - 10 - i * 34, h); g.lineTo(w - 40 - i * 34, h); g.lineTo(w + 40 - i * 34, h - 120); g.lineTo(w + 70 - i * 34, h - 120); g.fill(); } }
    g.strokeStyle = '#f2c230'; g.lineWidth = 5; g.beginPath(); g.moveTo(250, 120); g.lineTo(250, 50); g.lineTo(410, 50); g.moveTo(250, 62); g.lineTo(400, 62); g.stroke(); // grúa
    g.fillStyle = '#f4f4f4'; g.beginPath(); g.arc(320, 128, 38, Math.PI, 0); g.fill(); g.fillRect(276, 126, 88, 10); // casco
    g.fillStyle = '#d52b1e'; g.fillRect(300, 36, 30, 10); g.fillStyle = '#fff'; g.fillRect(300, 28, 30, 8); g.fillStyle = '#0039a6'; g.fillRect(300, 28, 10, 8); // bandera
    g.textAlign = 'center'; g.lineJoin = 'round';
    g.font = '900 54px "Arial Black", Impact, sans-serif'; g.lineWidth = 10; g.strokeStyle = '#3a1d06';
    for (const [t, y] of [['VIDA DE', 196], ['CONTRATISTAS', 250]]) { g.strokeText(t, w / 2, y); const gr = g.createLinearGradient(0, y - 46, 0, y); gr.addColorStop(0, '#ffcf4a'); gr.addColorStop(1, '#f07a16'); g.fillStyle = gr; g.fillText(t, w / 2, y); }
    g.font = 'bold 20px Arial, sans-serif'; g.fillStyle = '#f0a03a'; g.fillText('PODCAST', w / 2, 280);
    g.font = 'bold 15px Arial, sans-serif'; g.fillStyle = '#e8e8e8'; g.fillText('HISTORIAS DE LOS QUE CONSTRUYEN CHILE', w / 2, 320);
    g.fillStyle = '#f08a1c'; for (let i = 0; i < 16; i++) { const a = 4 + Math.abs(Math.sin(i * 1.7)) * 14; g.fillRect(w / 2 - 80 + i * 10, 295 - a / 2, 5, a); } // onda de audio
  });
}
export function tvPedestal(tex) { // TV grande sobre un pie, como en el set
  const g = new THREE.Group(), ma = std('#1b1c20', 0.4, 0.3);
  g.add(malla(rbox(0.7, 0.04, 0.45, 0.02), ma, 0, 0.02, 0));
  for (const s of [-0.18, 0.18]) g.add(malla(rbox(0.07, 1.0, 0.05, 0.015), ma, s, 0.52, 0));
  g.add(malla(rbox(1.75, 1.0, 0.06, 0.012), MAT.pantallaMarco, 0, 1.45, 0));
  const p = new THREE.Mesh(new THREE.PlaneGeometry(1.69, 0.94), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.75, roughness: 0.25 }));
  p.position.set(0, 1.45, 0.032); g.add(p);
  return g;
}
export function microfonoMesa() { // micrófono dinámico en pie de mesa
  const g = new THREE.Group(), ma = std('#1a1b1f', 0.35, 0.4);
  g.add(malla(new THREE.CylinderGeometry(0.07, 0.08, 0.02, 18), ma, 0, 0.01, 0));
  g.add(malla(new THREE.CylinderGeometry(0.01, 0.01, 0.26, 8), ma, 0, 0.14, 0));
  const mic = malla(new THREE.CapsuleGeometry(0.04, 0.17, 6, 12), std('#202125', 0.3, 0.6), 0, 0.33, 0.06); mic.rotation.x = 1.05; g.add(mic);
  return g;
}
export function tazaLogo() { // tazón blanco con el logo
  const tex = texLogoPodcast(false), g = new THREE.Group();
  g.add(malla(new THREE.CylinderGeometry(0.045, 0.042, 0.11, 18), new THREE.MeshStandardMaterial({ color: '#fff', map: tex, roughness: 0.35 }), 0, 0.055, 0));
  g.add(malla(new THREE.TorusGeometry(0.03, 0.009, 6, 12), MAT.blanco, 0.05, 0.06, 0));
  return g;
}
export function gruaMaqueta() { // grúa torre amarilla de juguete, colgada en la pared
  const g = new THREE.Group(), am = std('#e9b21c', 0.5, 0.2), neg = std('#2a2a2a', 0.6);
  for (let y = 0; y < 1.4; y += 0.14) { g.add(malla(new THREE.BoxGeometry(0.1, 0.012, 0.012), am, 0, y, 0)); g.add(malla(new THREE.BoxGeometry(0.012, 0.14, 0.012), am, -0.045, y + 0.07, 0)); g.add(malla(new THREE.BoxGeometry(0.012, 0.14, 0.012), am, 0.045, y + 0.07, 0)); }
  g.add(malla(new THREE.BoxGeometry(1.3, 0.05, 0.03), am, 0.35, 1.42, 0));
  g.add(malla(new THREE.BoxGeometry(0.22, 0.12, 0.05), neg, -0.2, 1.36, 0));
  g.add(malla(new THREE.BoxGeometry(0.004, 0.35, 0.004), neg, 0.75, 1.24, 0));
  g.add(malla(new THREE.BoxGeometry(0.06, 0.05, 0.04), neg, 0.75, 1.05, 0));
  return g;
}
export function casco(color = '#f4f4f2') {
  const g = new THREE.Group(), m = std(color, 0.35);
  g.add(malla(new THREE.SphereGeometry(0.13, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0, 0));
  g.add(malla(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 20), m, 0, 0.004, 0.02));
  return g;
}
export function rollosPlano() {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) { const r = malla(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 10), MAT.papel, -0.15 + i * 0.08, 0.04 + (i % 2) * 0.06, 0, false); r.rotation.z = Math.PI / 2 + (i - 1.5) * 0.15; g.add(r); }
  return g;
}
export function basurero(color = '#2f7d32', alto = 0.9) { // contenedor con tapa y ruedas
  const g = new THREE.Group(), m = std(color, 0.6);
  g.add(malla(rbox(0.5, alto, 0.55, 0.04), m, 0, alto / 2 + 0.05, 0));
  const tapa = malla(rbox(0.54, 0.05, 0.6, 0.02), std(color, 0.5), 0, alto + 0.08, 0); tapa.rotation.x = -0.08; g.add(tapa);
  for (const s of [-1, 1]) pon(g, malla(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), MAT.plastNegro, s * 0.2, 0.05, -0.24)).rotation.z = Math.PI / 2;
  return g;
}

// ---------- personajes ----------
// Personaje chibi: cabeza grande, cara, pelo con varios estilos, brazos que teclean.
export function personaje({ semilla = 1, camisa = '#3b82f6', sentado = true, genero = null, audifonos = false } = {}) {
  const r = azar(semilla), g = new THREE.Group();
  const piel = MAT.piel[Math.floor(r() * MAT.piel.length)], pelo = MAT.pelo[Math.floor(r() * MAT.pelo.length)];
  const pant = MAT.pantalon[Math.floor(r() * MAT.pantalon.length)];
  const ropa = std(camisa, 0.7);
  // mujeres: pelo largo, cola, tomate o melena; hombres: pelo corto (3), con o sin barba
  const estilo = genero === 'm' ? 3 : genero === 'f' ? [0, 1, 2, 4][Math.floor(r() * 4)] : Math.floor(r() * 5);
  const cadera = sentado ? 0.56 : 0.82;
  const partes = {};

  // tronco
  const torso = malla(new THREE.CapsuleGeometry(0.2, 0.26, 6, 14), ropa, 0, cadera + 0.3, 0); torso.scale.set(1, 1, 0.82); g.add(torso);
  pon(g, malla(new THREE.TorusGeometry(0.12, 0.025, 6, 16, Math.PI), std('#ffffff', 0.6), 0, cadera + 0.53, 0.04)).rotation.x = Math.PI / 2 + 0.3; // cuello
  g.add(malla(rbox(0.07, 0.09, 0.012, 0.008), MAT.blanco, 0.09, cadera + 0.34, 0.165)); // credencial
  partes.torso = torso;

  // piernas
  const piernas = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(s * 0.1, cadera, 0); g.add(p);
    if (sentado) {
      pon(p, malla(new THREE.CapsuleGeometry(0.085, 0.28, 4, 10), pant, 0, 0, 0.18)).rotation.x = Math.PI / 2;
      p.add(malla(new THREE.CapsuleGeometry(0.075, 0.3, 4, 10), pant, 0, -0.24, 0.36));
      p.add(malla(rbox(0.12, 0.08, 0.2, 0.03), MAT.zapato, 0, -cadera + 0.04, 0.4));
    } else {
      p.add(malla(new THREE.CapsuleGeometry(0.085, 0.55, 4, 10), pant, 0, -0.38, 0));
      p.add(malla(rbox(0.12, 0.08, 0.2, 0.03), MAT.zapato, 0, -cadera + 0.04, 0.04));
    }
    piernas.push(p);
  }
  partes.piernas = piernas;

  // brazos (pivote en el hombro)
  const brazos = [];
  for (const s of [-1, 1]) {
    const b = new THREE.Group(); b.position.set(s * 0.25, cadera + 0.47, 0); g.add(b);
    b.add(malla(new THREE.CapsuleGeometry(0.065, 0.26, 4, 10), ropa, 0, -0.17, 0));
    b.add(malla(new THREE.SphereGeometry(0.065, 12, 10), piel, 0, -0.36, 0));
    b.rotation.x = sentado ? -1.15 : 0.05; b.rotation.z = s * (sentado ? 0.12 : 0.08);
    brazos.push(b);
  }
  partes.brazos = brazos;

  // cabeza
  const cab = new THREE.Group(); cab.position.y = cadera + 0.82; g.add(cab); partes.cabeza = cab;
  cab.add(malla(new THREE.SphereGeometry(0.27, 24, 18), piel));
  for (const s of [-1, 1]) {
    pon(cab, malla(new THREE.SphereGeometry(0.036, 10, 8), MAT.ojos, s * 0.09, 0.01, 0.245, false)).scale.set(1, 1.25, 0.6);
    cab.add(malla(new THREE.SphereGeometry(0.012, 6, 6), MAT.blanco, s * 0.085 + 0.01, 0.03, 0.27, false));
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.045, 14), MAT.mejilla); m.position.set(s * 0.16, -0.06, 0.215); m.rotation.y = s * 0.55; cab.add(m);
    cab.add(malla(new THREE.SphereGeometry(0.045, 10, 8), piel, s * 0.27, -0.01, 0, false)); // orejas
  }
  const boca = malla(new THREE.TorusGeometry(0.035, 0.009, 6, 14, Math.PI), std('#7a2e2e', 0.6), 0, -0.075, 0.255, false); boca.rotation.z = Math.PI; cab.add(boca);
  const casco = malla(new THREE.SphereGeometry(0.285, 24, 16, 0, Math.PI * 2, 0, Math.PI * (estilo === 3 ? 0.42 : 0.52)), pelo, 0, 0.02, -0.02);
  casco.rotation.x = -0.32; cab.add(casco);
  if (estilo === 0) { const l = malla(new THREE.CapsuleGeometry(0.22, 0.22, 4, 12), pelo, 0, -0.16, -0.1); l.scale.set(1.15, 1, 0.65); cab.add(l); }      // pelo largo
  if (estilo === 1) { cab.add(malla(new THREE.SphereGeometry(0.1, 12, 10), pelo, 0, 0.06, -0.3)); cab.add(malla(new THREE.CapsuleGeometry(0.06, 0.18, 4, 8), pelo, 0, -0.12, -0.33)); } // cola
  if (estilo === 2) cab.add(malla(new THREE.SphereGeometry(0.12, 12, 10), pelo, 0, 0.26, -0.1)); // tomate
  if (estilo === 4) { const b = malla(new THREE.CapsuleGeometry(0.2, 0.06, 4, 12), pelo, 0, -0.04, -0.12); b.scale.set(1.3, 1, 0.8); cab.add(b); } // melena corta
  if (genero === 'm' && r() < 0.6) { // barba
    const b = malla(new THREE.SphereGeometry(0.278, 20, 12, 0, Math.PI * 2, Math.PI * 0.63, Math.PI * 0.27), pelo, 0, 0, 0.005, false); cab.add(b);
  }
  if (audifonos) {
    const ma = std('#202125', 0.4);
    const arco = malla(new THREE.TorusGeometry(0.29, 0.022, 8, 24, Math.PI), ma, 0, 0.02, 0); arco.rotation.y = Math.PI / 2; cab.add(arco);
    for (const s of [-1, 1]) pon(cab, malla(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16), ma, s * 0.28, -0.02, 0)).rotation.z = Math.PI / 2;
  }
  if (r() < 0.3) { // lentes
    const ml = std('#222', 0.3, 0.5);
    for (const s of [-1, 1]) cab.add(malla(new THREE.TorusGeometry(0.055, 0.008, 6, 16), ml, s * 0.09, 0.01, 0.262, false));
    cab.add(malla(new THREE.BoxGeometry(0.06, 0.008, 0.008), ml, 0, 0.015, 0.268, false));
  }

  g.userData = { partes, sentado, fase: r() * 10, mira: 0 };
  return g;
}
// Fantasma: el mismo personaje, translúcido y brillante, sin piernas y con una
// "cola" de sábana; flota. Se usa para quien no tiene puesto fijo en la oficina.
export function hacerFantasma(pj) {
  pj.traverse(o => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    Object.assign(o.material, { transparent: true, opacity: 0.55, depthWrite: false });
    if (o.material.emissive) { o.material.emissive.set('#a9c8ff'); o.material.emissiveIntensity = 0.45; }
    o.castShadow = false;
  });
  pj.userData.partes.piernas.forEach(l => { l.visible = false; });
  const sabana = new THREE.MeshStandardMaterial({ color: '#e4eeff', emissive: '#a9c8ff', emissiveIntensity: 0.5, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
  const cola = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.62, 20, 1, true), sabana);
  cola.rotation.x = Math.PI; cola.position.y = 0.55; pj.add(cola);
  const aura = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), new THREE.MeshBasicMaterial({ color: '#bcd6ff', transparent: true, opacity: 0.08, depthWrite: false }));
  aura.position.y = 1.2; pj.add(aura);
  pj.userData.fantasma = true;
  return pj;
}
// Saludo con la mano (al hacerle clic o al acercarse y apretar E).
export function saludar(p, t, duracion = 1.8) {
  const b = p.userData.partes.brazos[1];
  if (!p.userData.saludo) p.userData.saludo = { z0: b.rotation.z, x0: b.rotation.x };
  p.userData.saludo.hasta = t + duracion;
}
export function animarSaludo(p, t) {
  const s = p.userData.saludo; if (!s) return;
  const b = p.userData.partes.brazos[1];
  if (t > s.hasta) { b.rotation.z = s.z0; b.rotation.x = s.x0; p.userData.saludo = null; return; }
  b.rotation.x = -2.75; b.rotation.z = 0.35 + Math.sin(t * 13) * 0.4;
}
// De pie y quieto (el mono que uno controla, cuando no camina).
export function quieto(p) {
  const { partes } = p.userData;
  for (const l of partes.piernas) l.rotation.x *= 0.8;
  for (const b of partes.brazos) b.rotation.x += (0.05 - b.rotation.x) * 0.2;
}
export function animarPersonaje(p, t, { caminando = false } = {}) {
  const { partes, fase } = p.userData;
  if (caminando) {
    const a = Math.sin(t * 9 + fase) * 0.5;
    partes.piernas[0].rotation.x = a; partes.piernas[1].rotation.x = -a;
    partes.brazos[0].rotation.x = -a * 0.8; partes.brazos[1].rotation.x = a * 0.8;
    partes.torso.position.y = 1.12 + Math.abs(Math.cos(t * 9 + fase)) * 0.025;
    return;
  }
  // tecleo + respiración + mirar de vez en cuando
  partes.brazos[0].rotation.x = -1.15 + Math.max(0, Math.sin(t * 14 + fase)) * 0.07;
  partes.brazos[1].rotation.x = -1.15 + Math.max(0, Math.sin(t * 14 + fase + 1.7)) * 0.07;
  partes.torso.scale.y = 1 + Math.sin(t * 2 + fase) * 0.015;
  const ciclo = (t * 0.25 + fase) % 6;
  const giro = ciclo > 5 ? Math.sin((ciclo - 5) * Math.PI) * 0.6 : 0;
  partes.cabeza.rotation.y += ((p.userData.mira || giro) - partes.cabeza.rotation.y) * 0.08;
  partes.cabeza.rotation.x = Math.sin(t * 1.3 + fase) * 0.03 + 0.08;
}
