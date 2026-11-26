// Oficina virtual — escena 3D. Plano reconstruido del video de la oficina real:
// x hacia el este, z hacia el sur (la entrada está al sur, en z=7). El pasillo
// corre hacia el norte entre x=1 y x=2.6, desde el hall hasta la oficina del fondo.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as K from './modelos.js';
const { MAT, malla, rbox, pon } = K;

const D = window.OFICINA;
const salaPorId = Object.fromEntries(D.salas.map(s => [s.id, s]));
const personaPorId = Object.fromEntries(D.personas.map(p => [p.id, p]));

// ---------- plano (metros) ----------
const PLANO = {
  // columna izquierda (de arriba hacia abajo en el plano): 1, 2, 3, 4
  plataformas: { x0: -5.7, x1: -0.9, z0: -15.5, z1: -11.8, ruta: [[-1.6, -12.4], [0, -12.4]] },
  jefaturas:   { x0: -5.7, x1: -0.9, z0: -11.8, z1: -7.9,  ruta: [[-1.6, -8.75], [0, -8.75]] },
  operativo:   { x0: -5.7, x1: -0.9, z0: -7.9,  z1: -0.6,  ruta: [[-1.6, -1.45], [0, -1.45]] },
  reuniones:   { x0: -5.7, x1: -2.2, z0: -0.6,  z1: 5.5,   ruta: [[-3.2, 1.0], [-1.4, 1.0], [0, 0.2]] },
  // columna derecha: 5, 6, 7, 8
  podcast:     { x0: 0.9, x1: 5.7,  z0: -15.5, z1: -11.6, ruta: [[1.6, -12.95], [0, -12.95]] },
  bano:        { x0: 0.9, x1: 5.7,  z0: -11.6, z1: -9.2,  ruta: [[1.6, -10.4], [0, -10.4]] },
  prevencion:  { x0: 0.9, x1: 5.7,  z0: -9.2,  z1: -4.5,  ruta: [[1.6, -8.45], [0, -8.45]] },
  // 8 se divide (croquis del dueño): arriba 8.1 baño de mujeres y 8.2 basureros; abajo el comedor
  comedor:     { x0: 0.9, x1: 5.7,  z0: -3.3,  z1: -0.6,  ruta: [[1.8, -2.25], [0, -2.25]] },
  banom:       { x0: 0.9, x1: 3.7,  z0: -4.5,  z1: -3.3,  ruta: [[3.1, -3.9], [4.2, -3.9], [4.95, -2.9], [1.8, -2.25], [0, -2.25]] },
  basura:      { x0: 3.7, x1: 5.7,  z0: -4.5,  z1: -3.3,  ruta: [[4.95, -3.9], [4.95, -2.9], [1.8, -2.25], [0, -2.25]] },
  // 9 recepción (abajo, ancho completo menos la sala de reuniones) y 10 almacén al fondo del pasillo
  recepcion:   { x0: -2.2, x1: 5.7, z0: -0.6,  z1: 5.5,   ruta: [[0.3, 1.3], [0, 0.2]] },
  almacen:     { x0: -1.5, x1: 1.5, z0: -18,   z1: -15.5, ruta: [[0, -16.7], [0, -15.0]] }
};
const H = 2.3, T = 0.12, TE = 0.22;
const centro = id => { const p = PLANO[id]; return new THREE.Vector3((p.x0 + p.x1) / 2, 0, (p.z0 + p.z1) / 2); };

// ---------- motor ----------
const cont = document.getElementById('escena');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const PR = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
cont.appendChild(renderer.domElement);

const css2d = new CSS2DRenderer();
css2d.setSize(innerWidth, innerHeight);
Object.assign(css2d.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
cont.appendChild(css2d.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9eef2');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 400);
const DIR = new THREE.Vector3(0.62, 1.2, 1).normalize();   // la cámara mira desde el sureste, como en los TikTok
const GENERAL = { target: new THREE.Vector3(0, 0, -6), dist: 44 };
camera.position.copy(GENERAL.target).addScaledVector(DIR, GENERAL.dist);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(GENERAL.target);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.44; controls.minDistance = 3; controls.maxDistance = 90;

scene.add(new THREE.HemisphereLight('#ffffff', '#b8a58c', 0.9));
const sol = new THREE.DirectionalLight('#fff1dc', 2.6);
sol.position.set(-16, 30, 16);
sol.castShadow = true;
sol.shadow.mapSize.set(4096, 4096);
Object.assign(sol.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
sol.target.position.set(0, 0, -6); scene.add(sol.target);
sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.02;
scene.add(sol);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * PR, innerHeight * PR, { samples: 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1.1 });
ao.blendIntensity = 0.85;
composer.addPass(ao);
composer.addPass(new OutputPass());

function add(obj, x, y, z, ry) { if (x !== undefined) obj.position.set(x, y, z); if (ry !== undefined) obj.rotation.y = ry; scene.add(obj); return obj; }
const mirar = (nx, nz) => Math.atan2(nx, nz); // giro para que el frente (+z) mire hacia (nx,nz)

// ---------- exterior ----------
add(malla(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: '#dfe5d7', roughness: 1 }), 0, -0.26, 0, false)).rotation.x = -Math.PI / 2;
add(malla(rbox(11.9, 0.3, 21.5, 0.06), new THREE.MeshStandardMaterial({ color: '#d9d4cb', roughness: 0.95 }), 0, -0.17, -5, false));
add(malla(rbox(3.5, 0.3, 2.9, 0.06), new THREE.MeshStandardMaterial({ color: '#d9d4cb', roughness: 0.95 }), 0, -0.17, -16.8, false));
add(malla(new THREE.BoxGeometry(2.8, 0.06, 6), new THREE.MeshStandardMaterial({ color: '#c7c9cc', roughness: 0.9 }), 7.3, -0.22, 3.2, false)); // vereda frente a la salida
for (const [x, z, s] of [[-8.6, 7.5, 1.2], [9.4, 7.8, 1.4], [-8.8, -3, 1.1], [9.2, -8, 1.3], [-8.4, -14, 1.25], [8.6, -16.5, 1.1], [-4.5, -20.5, 1]]) add(K.arbol(s), x, -0.25, z, x * z);
for (let z = -14; z <= 1.2; z += 0.9) add(malla(new THREE.IcosahedronGeometry(0.32, 1), MAT.hoja2), 6.25, 0.05, z);

// ---------- pisos ----------
const texMadera = K.texPiso(); texMadera.wrapS = texMadera.wrapT = THREE.RepeatWrapping;
texMadera.repeat.set(11.4 / 1.6, 21 / 1.6);
const matMadera = new THREE.MeshStandardMaterial({ map: texMadera, roughness: 0.22, metalness: 0.05, envMapIntensity: 1.3 });
const piso = add(malla(new THREE.PlaneGeometry(11.4, 21), matMadera, 0, 0.001, -5, false));
piso.rotation.x = -Math.PI / 2; piso.receiveShadow = true;
const pisoAlm = add(malla(new THREE.PlaneGeometry(3, 2.5), matMadera, 0, 0.001, -16.75, false));
pisoAlm.rotation.x = -Math.PI / 2; pisoAlm.receiveShadow = true;
for (const id of ['comedor', 'bano', 'banom', 'basura']) {
  const p = PLANO[id], tex = K.texBaldosa(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set((p.x1 - p.x0) / 1.2, (p.z1 - p.z0) / 1.2);
  const m = add(malla(new THREE.PlaneGeometry(p.x1 - p.x0, p.z1 - p.z0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 }), (p.x0 + p.x1) / 2, 0.004, (p.z0 + p.z1) / 2, false));
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true;
}
const alfombra = add(malla(rbox(1.4, 0.02, 2.0, 0.01), new THREE.MeshStandardMaterial({ color: '#3d4148', roughness: 1 }), 4.9, 0.01, 3.2, false));

// ---------- muros ----------
// Cada pieza de muro se puede volver translúcida si tapa la sala que se mira.
const piezas = [];
const matMuro = new THREE.MeshStandardMaterial({ color: '#efe8da', roughness: 0.92 });
const matTope = new THREE.MeshStandardMaterial({ color: '#d8cfbf', roughness: 0.9 });
const matZocalo = new THREE.MeshStandardMaterial({ color: '#5e2f17', roughness: 0.5 });
const matMarcoPuerta = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.6 });
const matVidrioVentana = new THREE.MeshStandardMaterial({ color: '#cfe7f5', emissive: '#bfe3ff', emissiveIntensity: 0.55, roughness: 0.1, transparent: true, opacity: 0.85 });

function pieza(horiz, fijo, u0, u1, y0, y1, grosor, mat, { zocalo = true, tope = true } = {}) {
  const largo = u1 - u0; if (largo <= 0.005 || y1 - y0 <= 0.005) return;
  const u = (u0 + u1) / 2, y = (y0 + y1) / 2;
  const g = new THREE.Group(); scene.add(g);
  const m = mat.clone();
  const box = horiz ? new THREE.BoxGeometry(largo, y1 - y0, grosor) : new THREE.BoxGeometry(grosor, y1 - y0, largo);
  const malla_ = malla(box, m, horiz ? u : fijo, y, horiz ? fijo : u); g.add(malla_);
  const extras = [];
  if (zocalo && y0 === 0) extras.push(malla(horiz ? new THREE.BoxGeometry(largo, 0.1, grosor + 0.03) : new THREE.BoxGeometry(grosor + 0.03, 0.1, largo), matZocalo.clone(), horiz ? u : fijo, 0.05, horiz ? fijo : u));
  if (tope && y1 >= H - 0.001) extras.push(malla(horiz ? new THREE.BoxGeometry(largo, 0.025, grosor + 0.01) : new THREE.BoxGeometry(grosor + 0.01, 0.025, largo), matTope.clone(), horiz ? u : fijo, H + 0.012, horiz ? fijo : u, false));
  extras.forEach(e => g.add(e));
  const caja = new THREE.Box3().setFromObject(g);
  piezas.push({ mallas: [malla_, ...extras], caja, opacidad: 1, base: 1 });
}
function ventana(horiz, fijo, u0, u1, normal, { y0 = 0.95, y1 = 2.0, persianaColor = '#c9a77c' } = {}) {
  const g = new THREE.Group(), largo = u1 - u0, alto = y1 - y0;
  g.add(malla(new THREE.BoxGeometry(largo, alto, 0.02), matVidrioVentana, 0, 0, 0, false));
  for (const y of [-alto / 2, alto / 2]) g.add(malla(new THREE.BoxGeometry(largo, 0.05, 0.08), MAT.bronce, 0, y, 0));
  for (const x of [-largo / 2, 0, largo / 2]) g.add(malla(new THREE.BoxGeometry(0.05, alto, 0.08), MAT.bronce, x, 0, 0));
  const pers = K.persiana(largo - 0.06, alto * 0.62, persianaColor); pers.position.set(0, alto * 0.19, 0.07); g.add(pers);
  g.add(malla(new THREE.BoxGeometry(largo + 0.1, 0.04, 0.18), matMarcoPuerta, 0, -alto / 2 - 0.02, 0.05)); // alféizar
  g.position.set(horiz ? (u0 + u1) / 2 : fijo, (y0 + y1) / 2, horiz ? fijo : (u0 + u1) / 2);
  g.rotation.y = mirar(normal[0], normal[1]);
  scene.add(g);
}
function marcoPuerta(horiz, fijo, u0, u1, grosor) {
  for (const u of [u0, u1]) add(malla(horiz ? new THREE.BoxGeometry(0.07, 2.12, grosor + 0.04) : new THREE.BoxGeometry(grosor + 0.04, 2.12, 0.07), matMarcoPuerta, horiz ? u : fijo, 1.06, horiz ? fijo : u));
  add(malla(horiz ? new THREE.BoxGeometry(u1 - u0 + 0.14, 0.07, grosor + 0.04) : new THREE.BoxGeometry(grosor + 0.04, 0.07, u1 - u0 + 0.14), matMarcoPuerta, horiz ? (u0 + u1) / 2 : fijo, 2.12, horiz ? fijo : (u0 + u1) / 2));
}
// Muro sólido recto con huecos {a,b,t:'puerta'|'ventana'|'libre'|'entrada'}; normal = hacia dónde abre la puerta / lado interior.
function muro(ax, az, bx, bz, huecos = [], { grosor = T, normal = [0, 1], persiana } = {}) {
  const horiz = az === bz, fijo = horiz ? az : ax;
  let u = Math.min(horiz ? ax : az, horiz ? bx : bz); const fin = Math.max(horiz ? ax : az, horiz ? bx : bz);
  for (const h of [...huecos].sort((p, q) => p.a - q.a)) {
    pieza(horiz, fijo, u, h.a, 0, H, grosor, matMuro);
    if (h.t === 'puerta') {
      pieza(horiz, fijo, h.a, h.b, 2.12, H, grosor, matMuro, { zocalo: false });
      marcoPuerta(horiz, fijo, h.a, h.b, grosor);
      const hoja = K.puertaHoja(h.b - h.a - 0.04); // abierta hacia adentro, ~70°
      const n = h.n || normal;
      hoja.position.set(horiz ? h.a + 0.02 : fijo + n[0] * 0.05, 0, horiz ? fijo + n[1] * 0.05 : h.a + 0.02);
      hoja.rotation.y = horiz ? (n[1] > 0 ? -1.2 : 1.2) : (n[0] > 0 ? -0.37 : -Math.PI + 0.37);
      scene.add(hoja);
    } else if (h.t === 'ventana') {
      pieza(horiz, fijo, h.a, h.b, 0, 0.95, grosor, matMuro, { tope: false });
      pieza(horiz, fijo, h.a, h.b, 2.0, H, grosor, matMuro, { zocalo: false });
      ventana(horiz, fijo, h.a, h.b, normal, { persianaColor: h.persiana || persiana });
    } else if (h.t === 'entrada') {
      pieza(horiz, fijo, h.a, h.b, 2.25, H, grosor, matMuro, { zocalo: false });
      for (const s of [0, 1]) { // puerta doble de vidrio, abierta
        const hoja = new THREE.Group(), ancho = (h.b - h.a) / 2 - 0.03;
        hoja.add(malla(new THREE.BoxGeometry(ancho, 2.2, 0.02), MAT.vidrio, ancho / 2, 1.1, 0, false));
        for (const y of [0.04, 2.18]) hoja.add(malla(new THREE.BoxGeometry(ancho, 0.07, 0.05), MAT.bronce, ancho / 2, y, 0));
        for (const x of [0, ancho]) hoja.add(malla(new THREE.BoxGeometry(0.06, 2.2, 0.05), MAT.bronce, x, 1.1, 0));
        if (horiz) { hoja.position.set(s ? h.b : h.a, 0, fijo); hoja.rotation.y = s ? Math.PI + 1.25 : -1.25; }
        else { // muro vertical: abren hacia afuera
          const e = -normal[0];
          hoja.position.set(fijo, 0, s ? h.b : h.a);
          hoja.rotation.y = s ? (e > 0 ? 0.3 : Math.PI - 0.3) : (e > 0 ? -0.3 : -Math.PI + 0.3);
        }
        scene.add(hoja);
      }
    }
    u = h.b;
  }
  pieza(horiz, fijo, u, fin, 0, H, grosor, matMuro);
}
// Muro de vidrio con marcos bronce; franja esmerilada o franja oscura (como las correderas del video).
function muroVidrio(ax, az, bx, bz, huecos = [], { franja = 'esmerilado' } = {}) {
  const horiz = az === bz, fijo = horiz ? az : ax;
  const ini = Math.min(horiz ? ax : az, horiz ? bx : bz), fin = Math.max(horiz ? ax : az, horiz ? bx : bz);
  const tramos = []; let u = ini;
  for (const h of [...huecos].sort((p, q) => p.a - q.a)) { tramos.push([u, h.a]); u = h.b; } tramos.push([u, fin]);
  const pos = (uu, y) => horiz ? [uu, y, fijo] : [fijo, y, uu];
  const caja = (l, alto, prof) => horiz ? new THREE.BoxGeometry(l, alto, prof) : new THREE.BoxGeometry(prof, alto, l);
  for (const [a, b] of tramos) {
    const l = b - a; if (l <= 0.01) continue; const c = (a + b) / 2;
    const g = new THREE.Group(); scene.add(g);
    const vid = malla(caja(l, H, 0.02), MAT.vidrio.clone(), ...pos(c, H / 2), false); g.add(vid);
    const extras = [];
    for (const y of [0.03, H - 0.03]) extras.push(malla(caja(l, 0.06, 0.07), MAT.bronce, ...pos(c, y)));
    const n = Math.max(1, Math.round(l / 1.2));
    for (let i = 0; i <= n; i++) extras.push(malla(caja(0.05, H, 0.07), MAT.bronce, ...pos(a + (l * i) / n, H / 2)));
    if (franja === 'esmerilado') for (let k = 0; k < 5; k++) extras.push(malla(caja(l, 0.045, 0.025), MAT.esmerilado, ...pos(c, 1.0 + k * 0.09), false));
    else extras.push(malla(caja(l, 0.42, 0.025), MAT.franjaOscura, ...pos(c, 1.1), false));
    extras.forEach(e => g.add(e));
    piezas.push({ mallas: [vid], caja: new THREE.Box3().setFromObject(g), opacidad: 1, base: 1, vidrio: true });
  }
  for (const h of huecos) { // puerta de vidrio abierta (corredera desplazada o batiente)
    const l = h.b - h.a, hoja = new THREE.Group();
    hoja.add(malla(new THREE.BoxGeometry(l, H - 0.08, 0.02), MAT.vidrio, l / 2, H / 2, 0, false));
    for (const y of [0.04, H - 0.04]) hoja.add(malla(new THREE.BoxGeometry(l, 0.06, 0.05), MAT.bronce, l / 2, y, 0));
    for (const x of [0, l]) hoja.add(malla(new THREE.BoxGeometry(0.05, H - 0.08, 0.05), MAT.bronce, x, H / 2, 0));
    if (franja === 'esmerilado') for (let k = 0; k < 5; k++) hoja.add(malla(new THREE.BoxGeometry(l, 0.045, 0.025), MAT.esmerilado, l / 2, 1.0 + k * 0.09, 0, false));
    else hoja.add(malla(new THREE.BoxGeometry(l, 0.42, 0.025), MAT.franjaOscura, l / 2, 1.1, 0, false));
    if (h.t === 'corredera') { hoja.position.set(...(horiz ? [h.b - 0.05, 0, fijo + 0.06] : [fijo + 0.06, 0, h.b - 0.05])); if (!horiz) hoja.rotation.y = -Math.PI / 2; }
    else { hoja.position.set(...(horiz ? [h.a, 0, fijo] : [fijo, 0, h.a])); hoja.rotation.y = horiz ? -1.2 : -Math.PI / 2 - 1.2; }
    scene.add(hoja);
  }
}

// Exterior. La salida (11) está en el muro oriente, a la altura de la recepción.
muro(-5.7, 5.5, 5.7, 5.5, [{ a: -5.0, b: -3.0, t: 'ventana', persiana: '#a8774b' }, { a: 1.6, b: 3.4, t: 'ventana' }], { grosor: TE, normal: [0, -1], persiana: '#ececea' });
muro(-5.7, 5.5, -5.7, -15.5, [
  { a: 1.0, b: 3.4, t: 'ventana', persiana: '#a8774b' }, { a: -5.4, b: -3.0, t: 'ventana' },
  { a: -10.8, b: -8.8, t: 'ventana', persiana: '#f2f2f0' }, { a: -14.6, b: -12.8, t: 'ventana', persiana: '#f2f2f0' }
], { grosor: TE, normal: [1, 0] });
muro(5.7, 5.5, 5.7, -15.5, [
  { a: 2.4, b: 4.0, t: 'entrada' }, { a: -0.2, b: 1.6, t: 'ventana', persiana: '#ececea' }, { a: -3.0, b: -1.5, t: 'ventana', persiana: '#f2f2f0' },
  { a: -8.0, b: -5.8, t: 'ventana', persiana: '#f2f2f0' }, { a: -10.8, b: -10.0, t: 'ventana', persiana: '#f2f2f0' }
], { grosor: TE, normal: [-1, 0] });
muro(-5.7, -15.5, 5.7, -15.5, [{ a: -4.4, b: -2.6, t: 'ventana', persiana: '#f2f2f0' }, { a: -0.45, b: 0.45, t: 'puerta', n: [0, -1] }], { grosor: TE, normal: [0, 1] });
// 10 Almacén, al fondo del pasillo
muro(-1.5, -15.5, -1.5, -18, [], { grosor: TE }); muro(1.5, -15.5, 1.5, -18, [], { grosor: TE }); muro(-1.5, -18, 1.5, -18, [], { grosor: TE });
// 4 Sala de reuniones: frente de vidrio con correderas y franja oscura, mirando a la recepción
muroVidrio(-2.2, -0.6, -2.2, 5.5, [{ a: 0.4, b: 1.6, t: 'corredera' }], { franja: 'oscura' });
// Pasillo, lado izquierdo: 1 y 2 con muro y puerta blanca; 3 con vidrio esmerilado
muro(-0.9, -15.5, -0.9, -11.8, [{ a: -12.8, b: -11.95, t: 'puerta', n: [-1, 0] }]);
muro(-0.9, -11.8, -0.9, -7.9, [{ a: -9.2, b: -8.3, t: 'puerta', n: [-1, 0] }]);
muroVidrio(-0.9, -7.9, -0.9, -0.6, [{ a: -1.9, b: -1.0, t: 'batiente' }]);
// Pasillo, lado derecho: 5, 6, 7 y 8 con muros blancos y puertas
muro(0.9, -15.5, 0.9, -11.6, [{ a: -13.4, b: -12.5, t: 'puerta', n: [1, 0] }]);
muro(0.9, -11.6, 0.9, -9.2, [{ a: -10.8, b: -10.0, t: 'puerta', n: [1, 0] }]);
muro(0.9, -9.2, 0.9, -4.5, [{ a: -8.9, b: -8.0, t: 'puerta', n: [1, 0] }]);
muro(0.9, -4.5, 0.9, -3.3);
muro(0.9, -3.3, 0.9, -0.6, [{ a: -2.7, b: -1.85, t: 'puerta', n: [1, 0] }]);
// 8.1 baño de mujeres y 8.2 basureros: se entra por el comedor, por el hueco bajo 8.2; el baño, por la puerta entre ambos
muro(0.9, -3.3, 3.7, -3.3);
muro(3.7, -3.3, 5.7, -3.3, [{ a: 4.6, b: 5.3, t: 'libre' }]);
muro(3.7, -4.5, 3.7, -3.3, [{ a: -4.3, b: -3.5, t: 'puerta', n: [-1, 0] }]);
// Divisiones entre oficinas
muro(-5.7, -11.8, -0.9, -11.8); muro(-5.7, -7.9, -0.9, -7.9); muro(-5.7, -0.6, -0.9, -0.6);
muro(0.9, -11.6, 5.7, -11.6); muro(0.9, -9.2, 5.7, -9.2); muro(0.9, -4.5, 5.7, -4.5); muro(0.9, -0.6, 5.7, -0.6);

// ---------- mobiliario ----------
const personas3D = {}, ventiladores = [], etiquetas = {}, globos = {};
let pantallaTipo = 0;
function puesto(x, z, ang, { persona = null, salaId, mesa = 'normal', notebook = false, extra = true } = {}) {
  const g = add(new THREE.Group(), x, 0, z, ang);
  const color = salaPorId[salaId]?.color || '#64748b';
  g.add(K.sillaOficina());
  const esc = mesa === 'L' ? K.escritorioL() : K.escritorio({ mat: mesa === 'caoba' ? MAT.caoba : MAT.nogal });
  esc.position.z = 0.62; g.add(esc);
  const mp = K.matPantalla(pantallaTipo++ % 3, color);
  const mon = notebook ? K.notebook(mp) : K.monitor(mp);
  mon.position.set(0, 0.768, notebook ? 0.62 : 0.86); mon.rotation.y = notebook ? 0 : Math.PI; g.add(mon);
  if (!notebook) { const t = K.teclado(); t.position.set(0, 0.768, 0.5); g.add(t); }
  if (extra) { const tz = K.taza(['#ffffff', '#f4c542', '#e85d5d', '#5aa0e8'][pantallaTipo % 4]); tz.position.set(0.48, 0.768, 0.55); g.add(tz); const pp = K.papeles(); pp.position.set(-0.42, 0.768, 0.62); g.add(pp); }
  if (persona) {
    const p = personaPorId[persona];
    const pj = crearPersona(p, color); pj.position.z = 0.03; g.add(pj);
  }
  return g;
}
function crearPersona(p, color) {
  const pj = K.personaje({ semilla: K.hash(p.id + p.nombre), camisa: color, sentado: true, genero: p.genero, audifonos: p.audifonos });
  pj.traverse(o => { if (o.isMesh) o.userData.persona = p.id; });
  personas3D[p.id] = pj;
  etiquetaPersona(pj, p, color);
  return pj;
}
// Persona sentada sin escritorio (sillón del podcast)
function sentado(pid, x, z, ang, asiento) {
  const p = personaPorId[pid]; if (!p) return;
  const g = add(new THREE.Group(), x, 0, z, ang);
  if (asiento) g.add(asiento);
  const pj = crearPersona(p, salaPorId[p.sala].color); pj.position.z = 0.05; g.add(pj);
}
function etiquetaPersona(pj, p, color) {
  const el = document.createElement('div'); el.className = 'nombre';
  el.innerHTML = `<i style="background:${color}"></i>${p.corto || p.nombre.split(' ')[0]}`;
  el.addEventListener('click', e => { e.stopPropagation(); detenerTour(); abrirPersona(p.id); });
  const o = new CSS2DObject(el); o.position.set(0, 1.98, 0); pj.add(o); etiquetas[p.id] = el;
  const gl = document.createElement('div'); gl.className = 'globo'; gl.textContent = p.tarea || p.cargo;
  const og = new CSS2DObject(gl); og.position.set(0, 2.45, 0); pj.add(og); globos[p.id] = gl;
}
const gente = id => D.personas.filter(p => p.sala === id).map(p => p.id);
const enPared = (obj, x, y, z, nx, nz) => add(obj, x, y, z, mirar(nx, nz));

const camaras = [];
function std2(c) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }); }
// 9 Recepción: mesón en L de caoba con vidrio y arbolito, mirando a la salida (11)
{
  add(malla(rbox(0.55, 1.08, 2.6, 0.03), MAT.caoba), 2.3, 0.54, 2.0);
  add(malla(rbox(1.3, 1.08, 0.55, 0.03), MAT.caoba), 1.92, 0.54, 0.43);
  for (const y of [0.35, 0.7]) { add(malla(new THREE.BoxGeometry(0.56, 0.025, 2.62), std2('#5a240f')), 2.3, y, 2.0); add(malla(new THREE.BoxGeometry(1.32, 0.025, 0.56), std2('#5a240f')), 1.92, y, 0.43); }
  add(malla(rbox(0.7, 0.04, 2.7, 0.01), MAT.caoba), 2.38, 1.1, 2.0);
  add(malla(new THREE.BoxGeometry(0.015, 0.6, 2.4, 1, 1, 1), MAT.vidrioMesa, 0, 0, 0, false), 2.45, 1.42, 2.05);
  add(malla(new THREE.BoxGeometry(0.9, 0.015, 0.6), MAT.vidrioMesa, 0, 0, 0, false), 2.85, 1.18, 3.0);
  add(K.planta(0.7, 1), 2.38, 1.12, 0.95);
  puesto(0.95, 2.0, Math.PI / 2, { persona: gente('recepcion')[0], salaId: 'recepcion' });
  add(K.cajonera(0.75, MAT.nogal, 0.9), 0.4, 0, 5.1); add(K.impresora(), 0.4, 0.75, 5.1);
  for (const x of [3.3, 4.0, 4.7]) add(K.sillaVisita(), x, 0, 5.05, Math.PI);
  add(K.planta(1.4), 5.2, 0, -0.1); add(K.planta(1.2, 2), -1.7, 0, 5.0);
  add(K.dispensadorAgua(), -1.7, 0, -0.15);
  enPared(K.extintor(), 3.4, 0, -0.45, 0, 1);
  enPared(K.letreroSalida(), 5.56, 1.95, 4.6, -1, 0);
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.45), new THREE.MeshStandardMaterial({ map: K.lienzo(512, 144, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.font = 'bold 76px system-ui, sans-serif'; g.fillStyle = '#1f2328'; g.fillText('Home', 40, 100); g.fillStyle = '#e9a23b'; g.fillText('Pymes', 238, 100); }), roughness: 0.4 }));
  enPared(logo, 4.6, 1.65, 5.37, 0, -1);
}
// 4 Sala de reuniones: mesa negra, sillas de malla, pizarra, TV, cajonera
{
  const cx = -3.95, cz = 2.5;
  add(malla(rbox(1.3, 0.05, 3.0, 0.015), MAT.negroMesa), cx, 0.76, cz);
  for (const dx of [-0.55, 0.55]) for (const dz of [-1.35, 1.35]) add(malla(new THREE.CylinderGeometry(0.02, 0.02, 0.74, 8), MAT.cromo), cx + dx, 0.37, cz + dz);
  for (const dz of [-1.0, 0, 1.0]) { add(K.sillaVisita(), cx - 1.0, 0, cz + dz, Math.PI / 2); add(K.sillaVisita(), cx + 1.0, 0, cz + dz, -Math.PI / 2); }
  add(K.sillaVisita(), cx, 0, cz + 1.9, Math.PI);
  enPared(K.pizarra(K.texPizarra(['Reunión semanal', '1. Clientes nuevos', '2. Cobranza', '3. Podcast']), 1.5, 0.85), -4.0, 1.45, -0.52, 0, 1);
  enPared(K.tele(), -5.56, 1.55, 4.5, 1, 0);
  add(K.cajonera(0.75, MAT.nogal, 0.9), -2.75, 0, 4.95);
  add(K.planta(1.1), -5.2, 0, 0);
}
// 3 Operativo RR.HH. y Contabilidad: dos puestos enfrentados + uno junto al vidrio
{
  const ids = gente('operativo');
  puesto(-4.2, -3.6, Math.PI, { persona: ids[0], salaId: 'operativo' });
  puesto(-4.2, -5.55, 0, { persona: ids[1], salaId: 'operativo' });
  puesto(-2.0, -2.1, -Math.PI / 2, { persona: ids[2], salaId: 'operativo' });
  add(malla(rbox(1.3, 0.38, 0.03, 0.01), MAT.blancoMate), -4.2, 0.97, -4.575);
  enPared(K.pizarra(K.texPizarra(['Remuneraciones nov.', '• Liquidaciones: día 28', '• F29: día 20'])), -3.3, 1.5, -7.82, 0, 1);
  enPared(K.aireAcondicionado(), -5.55, 2.0, -6.6, 1, 0);
  enPared(new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), new THREE.MeshStandardMaterial({ map: K.texDiarioMural(), roughness: 0.9 })), -4.3, 1.45, -0.68, 0, -1);
  enPared(K.estante({ ancho: 1.2, alto: 1.8 }), -5.45, 0, -1.6, 1, 0);
  add(K.cajonera(0.7), -5.25, 0, -7.4); add(K.impresora(), -5.25, 0.7, -7.4);
  const v = K.ventilador(); add(v, -1.4, 0, -3.3, -0.8); ventiladores.push(v);
  add(K.planta(1.0), -1.35, 0, -7.4);
}
// 2 Jefaturas: dos puestos enfrentados con separador
{
  const ids = gente('jefaturas');
  puesto(-3.4, -8.65, Math.PI, { persona: ids[0], salaId: 'jefaturas' });
  puesto(-3.4, -10.6, 0, { persona: ids[1], salaId: 'jefaturas' });
  add(malla(rbox(1.3, 0.38, 0.03, 0.01), MAT.blancoMate), -3.4, 0.97, -9.625);
  enPared(K.estante({ ancho: 1.4, alto: 1.9 }), -1.9, 0, -11.62, 0, 1);
  add(K.sillaVisita(), -1.6, 0, -9.8, -Math.PI / 2);
  enPared(K.pizarra(K.texPizarra(['Pendientes', '• Aprobar pagos', '• Grabación jueves']), 1.0, 0.6), -4.8, 1.5, -7.98, 0, -1);
  add(K.planta(1.0), -5.2, 0, -8.3);
}
// 1 Administración de Plataformas: dos escritorios juntos con impresora (oficina del final del video)
{
  puesto(-2.0, -13.9, -Math.PI / 2, { persona: gente('plataformas')[0], salaId: 'plataformas', notebook: true });
  add(K.escritorio({ ancho: 1.4 }), -4.02, 0, -13.9, -Math.PI / 2); add(K.impresora(), -4.0, 0.77, -14.2, -Math.PI / 2);
  add(K.sillaOficina(), -4.0, 0, -12.6, 2.6);
  enPared(K.aireAcondicionado(), -4.2, 2.0, -11.92, 0, -1);
  enPared(K.estante({ ancho: 1.2, alto: 1.7 }), -2.2, 0, -12.0, 0, -1);
}
// 5 Podcast «Vida de Contratistas», como el set real: muro de listones de madera,
// TV con el logo sobre un pie, mesa larga de madera, micrófonos de mesa y tazones,
// estante con cascos y planos, grúa de maqueta, y las cámaras de las jefaturas.
{
  const cx = 3.3, cz = -13.3;
  add(malla(new THREE.BoxGeometry(4.7, 2.28, 0.02), new THREE.MeshStandardMaterial({ color: '#4a2d18', roughness: 0.9 }), 0, 0, 0, false), 3.3, 1.14, -15.37);
  const listonA = new THREE.MeshStandardMaterial({ color: '#b9844f', roughness: 0.55 }), listonB = new THREE.MeshStandardMaterial({ color: '#a26d3c', roughness: 0.55 });
  const geoListon = new THREE.BoxGeometry(0.055, 2.28, 0.04);
  for (let x = 0.98, i = 0; x < 5.65; x += 0.085, i++) add(malla(geoListon, i % 3 ? listonA : listonB, 0, 0, 0, false), x, 1.14, -15.34);
  const logo = K.texLogoPodcast();
  add(K.tvPedestal(logo), cx, 0, -14.9, 0);
  enPared(K.aireAcondicionado(), cx, 2.08, -15.26, 0, 1);
  enPared(new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.31), new THREE.MeshBasicMaterial({ map: K.texLogoPodcast(false) })), 5.15, 1.95, -15.3, 0, 1);
  enPared(K.gruaMaqueta(), 4.45, 0.45, -15.28, 0, 1);
  // estante con cascos, planos enrollados y una planta (a la izquierda de la TV)
  enPared(K.estante({ ancho: 1.0, alto: 1.9, carpetas: false }), 1.5, 0, -15.12, 0, 1);
  add(K.casco(), 1.3, 1.155, -15.1); add(K.casco(), 1.65, 1.155, -15.1, 0.4); add(K.rollosPlano(), 1.5, 1.535, -15.1);
  add(K.casco('#c8211d'), 1.3, 0.775, -15.1); add(K.casco('#1e5bd8'), 1.6, 0.775, -15.12); add(K.planta(0.55), 1.5, 0.395, -15.1);
  // mesa larga ovalada de madera
  const madera = new THREE.MeshStandardMaterial({ color: '#8a5530', roughness: 0.3, metalness: 0.05 });
  const cubierta = add(malla(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 48), madera), cx, 0.74, cz); cubierta.scale.set(2.7, 1, 1.05);
  for (const dx of [-0.75, 0.75]) add(malla(new THREE.CylinderGeometry(0.06, 0.12, 0.72, 12), MAT.plastNegro), cx + dx, 0.36, cz);
  add(K.microfonoMesa(), 2.4, 0.765, cz, -Math.PI / 2); add(K.microfonoMesa(), 4.2, 0.765, cz, Math.PI / 2);
  add(K.tazaLogo(), 2.65, 0.765, cz + 0.25, 2.6); add(K.tazaLogo(), 3.85, 0.765, cz + 0.2, 0.6);
  add(K.papeles(2), 2.55, 0.765, cz - 0.25);
  const ids = gente('podcast');
  sentado(ids[0], 1.72, cz, Math.PI / 2, K.sillaOficina());
  sentado(ids[1], 4.88, cz, -Math.PI / 2, K.sillaOficina());
  // cámaras (las manejan las jefaturas): cada una apunta a uno de los dos
  const c1 = K.camaraTripode(); add(c1, 2.3, 0, -11.95, Math.atan2(4.88 - 2.3, cz + 11.95)); camaras.push(c1);
  const c2 = K.camaraTripode(); add(c2, 4.3, 0, -11.95, Math.atan2(1.72 - 4.3, cz + 11.95)); camaras.push(c2);
}
// 6 Baño de hombres
{
  for (const x of [3.4, 4.2]) { add(malla(rbox(0.36, 0.55, 0.3, 0.1), MAT.blanco), x, 0.85, -11.42); }
  add(malla(rbox(0.42, 0.42, 0.6, 0.12), MAT.blanco), 5.25, 0.21, -9.75); add(malla(rbox(0.5, 0.45, 0.2, 0.04), MAT.blanco), 5.25, 0.65, -9.4);
  add(malla(new THREE.BoxGeometry(0.04, 1.8, 1.4), MAT.gris), 4.75, 0.95, -9.9);
  add(malla(rbox(0.45, 0.15, 0.4, 0.05), MAT.blanco), 1.9, 0.85, -9.42); add(malla(new THREE.CylinderGeometry(0.06, 0.08, 0.8, 10), MAT.blanco), 1.9, 0.4, -9.42);
  enPared(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshStandardMaterial({ color: '#dfe9ef', metalness: 0.9, roughness: 0.05 })), 1.9, 1.5, -9.28, 0, -1);
}
// 7 Prevención: dos puestos contra la ventana, pizarra con la bandera
{
  const ids = gente('prevencion');
  puesto(4.0, -5.6, Math.PI / 2, { persona: ids[0], salaId: 'prevencion' });
  puesto(4.0, -7.6, Math.PI / 2, { persona: ids[1], salaId: 'prevencion', notebook: true });
  enPared(K.pizarra(K.texPizarra(['Charlas diciembre', '• Uso de EPP', '• Inducciones: 3'], true), 1.5, 0.85), 2.6, 1.5, -4.58, 0, -1);
  enPared(K.estante({ ancho: 1.4, alto: 1.8 }), 2.0, 0, -9.02, 0, 1);
  add(K.planta(1.0), 1.4, 0, -5.0);
}
// 8 Comedor: mueble de cocina contra el muro oriente, refrigerador y mesa con 4 sillas
{
  add(malla(rbox(0.62, 0.9, 1.35, 0.02), MAT.blanco), 5.39, 0.45, -2.43);
  add(malla(rbox(0.66, 0.04, 1.39, 0.01), MAT.caoba), 5.39, 0.92, -2.43);
  add(malla(rbox(0.4, 0.06, 0.45, 0.02), MAT.cromo), 5.39, 0.93, -2.8);
  add(malla(rbox(0.38, 0.3, 0.5, 0.03), MAT.plastNegro), 5.42, 1.09, -2.05);
  add(malla(rbox(0.7, 1.8, 0.7, 0.04), MAT.blanco), 5.3, 0.9, -1.05);
  add(malla(rbox(1.4, 0.04, 0.8, 0.01), MAT.caoba), 2.9, 0.74, -1.9);
  for (const dx of [-0.62, 0.62]) for (const dz of [-0.32, 0.32]) add(malla(new THREE.CylinderGeometry(0.02, 0.02, 0.72, 8), MAT.cromo), 2.9 + dx, 0.36, -1.9 + dz);
  for (const x of [2.5, 3.3]) { add(K.sillaVisita(), x, 0, -1.3, Math.PI); add(K.sillaVisita(), x, 0, -2.5, 0); }
  add(K.taza('#f4c542'), 2.7, 0.76, -1.8); add(K.taza('#5aa0e8'), 3.2, 0.76, -2.05);
}
// 8.1 Baño de mujeres: inodoro tras un tabique, lavamanos y espejo
{
  add(malla(rbox(0.42, 0.42, 0.6, 0.12), MAT.blanco), 1.45, 0.21, -4.05); add(malla(rbox(0.5, 0.45, 0.2, 0.04), MAT.blanco), 1.45, 0.65, -4.38);
  add(malla(new THREE.BoxGeometry(0.04, 1.8, 1.0), MAT.gris), 2.1, 0.95, -4.0);
  add(malla(rbox(0.45, 0.15, 0.4, 0.05), MAT.blanco), 3.0, 0.85, -4.27); add(malla(new THREE.CylinderGeometry(0.06, 0.08, 0.8, 10), MAT.blanco), 3.0, 0.4, -4.27);
  enPared(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshStandardMaterial({ color: '#dfe9ef', metalness: 0.9, roughness: 0.05 })), 3.0, 1.5, -4.43, 0, 1);
}
// 8.2 Espacio de los basureros: contenedores de colores y un balde de aseo
{
  add(K.basurero('#2f7d32'), 4.1, 0, -4.15, 0); add(K.basurero('#1e5bd8'), 4.7, 0, -4.15, 0); add(K.basurero('#e0a512', 0.8), 5.3, 0, -4.15, 0);
  add(malla(new THREE.CylinderGeometry(0.16, 0.13, 0.3, 16), new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.6 })), 4.0, 0.15, -3.55);
  add(malla(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 6), MAT.gris), 4.15, 0.6, -3.55).rotation.z = 0.25;
}
// 10 Almacén
{
  enPared(K.estante({ ancho: 1.1, alto: 2.0, fondo: 0.4 }), -1.18, 0, -16.9, 1, 0);
  enPared(K.estante({ ancho: 1.1, alto: 2.0, fondo: 0.4 }), 1.18, 0, -16.9, -1, 0);
  for (const [x, z] of [[-0.2, -17.6], [0.35, -17.55], [0.1, -17.2]]) add(malla(rbox(0.5, 0.32, 0.38, 0.02), std2('#c8a46e')), x, 0.16, z);
}
// Pasillo: diario mural y letrero de salida (lado derecho, como en el video), extintor
{
  enPared(new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.8), new THREE.MeshStandardMaterial({ map: K.texDiarioMural(), roughness: 0.9 })), 0.83, 1.45, -1.9, -1, 0);
  enPared(K.letreroSalida(), 0.83, 1.6, -2.75, -1, 0);
  enPared(K.extintor(), 0.78, 0, -6.6, -1, 0);
}

// ---------- personas que no tenían puesto en el plano ----------
// Si en SIGSO hay más gente en una oficina que escritorios dibujados, se le
// arma un puesto extra; si ya no caben, se sienta en una silla dentro de la sala.
{
  const EXTRA = {
    recepcion: [[-1.3, 3.4, 0]],
    operativo: [[-2.0, -4.3, -Math.PI / 2], [-2.0, -6.5, -Math.PI / 2]],
    jefaturas: [[-1.75, -10.9, 0]],
    plataformas: [[-4.0, -12.6, -Math.PI / 2]],
    prevencion: [[2.0, -6.8, -Math.PI / 2]]
  };
  const usados = {};
  for (const p of D.personas) {
    if (personas3D[p.id] || !PLANO[p.sala]) continue;
    const i = usados[p.sala] = (usados[p.sala] || 0) + 1;
    const lugar = (EXTRA[p.sala] || [])[i - 1];
    if (lugar) { puesto(lugar[0], lugar[1], lugar[2], { persona: p.id, salaId: p.sala }); continue; }
    const c = centro(p.sala), a = i * 2.4;
    sentado(p.id, c.x + Math.cos(a) * 0.9, c.z + Math.sin(a) * 0.9, Math.atan2(-Math.cos(a), -Math.sin(a)), K.sillaVisita());
  }
}

// ---------- salas clicables (piso de color + rótulo) ----------
const pisos = [];
for (const s of D.salas) {
  const p = PLANO[s.id]; if (!p) continue;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(p.x1 - p.x0 - 0.2, p.z1 - p.z0 - 0.2), new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set((p.x0 + p.x1) / 2, 0.015, (p.z0 + p.z1) / 2); m.userData.sala = s.id; m.renderOrder = 1;
  scene.add(m); pisos.push(m);
  const el = document.createElement('div'); el.className = 'rotulo'; el.style.setProperty('--c', s.color);
  const n = gente(s.id).length;
  el.innerHTML = `${s.nombre}${n ? `<span>${n}</span>` : ''}`;
  el.addEventListener('click', e => { e.stopPropagation(); detenerTour(); abrirSala(s.id); });
  const o = new CSS2DObject(el); o.position.set((p.x0 + p.x1) / 2, H + 0.5, (p.z0 + p.z1) / 2); scene.add(o);
  s._rotulo = el;
}

// ---------- mensajeros: personas que llevan documentos de un área a otra ----------
const mensajeros = [];
function rutaEntre(de, a) {
  const r1 = PLANO[de].ruta.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const r2 = PLANO[a].ruta.map(([x, z]) => new THREE.Vector3(x, 0, z)).reverse();
  return [...r1, ...r2];
}
function crearMensajero(de, a, color) {
  const pj = K.personaje({ semilla: K.hash(de + a), camisa: salaPorId[de].color, sentado: false });
  const carpeta = malla(rbox(0.26, 0.34, 0.04, 0.01), K.MAT.carpetaAzul, 0.0, -0.33, 0.1);
  carpeta.material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  pj.userData.partes.brazos[1].add(carpeta);
  scene.add(pj);
  const carril = (mensajeros.length % 3 - 1) * 0.28; // cada uno por su carril, para que no se pisen
  const ruta = rutaEntre(de, a).map(p => p.clone().add(new THREE.Vector3(carril, 0, carril))), largos = []; let total = 0;
  for (let i = 1; i < ruta.length; i++) { const l = ruta[i].distanceTo(ruta[i - 1]); largos.push(l); total += l; }
  const m = { pj, ruta, largos, total, d: Math.random() * total, ida: true, pausa: 0, carpeta };
  mensajeros.push(m); return m;
}
function limpiarMensajeros() { for (const m of mensajeros) scene.remove(m.pj); mensajeros.length = 0; }
function moverMensajero(m, dt, t) {
  if (m.pausa > 0) { m.pausa -= dt; K.animarPersonaje(m.pj, 0, { caminando: true }); return; }
  m.d += dt * 1.25;
  if (m.d >= m.total) { m.d = 0; m.ida = !m.ida; m.pausa = 1.2; m.ruta.reverse(); m.largos.reverse(); m.carpeta.visible = m.ida; }
  let d = m.d, i = 0; while (i < m.largos.length - 1 && d > m.largos[i]) { d -= m.largos[i]; i++; }
  const a = m.ruta[i], b = m.ruta[i + 1], k = Math.min(1, d / m.largos[i]);
  m.pj.position.lerpVectors(a, b, k);
  const ang = Math.atan2(b.x - a.x, b.z - a.z);
  let dif = ang - m.pj.rotation.y; dif = Math.atan2(Math.sin(dif), Math.cos(dif));
  m.pj.rotation.y += dif * Math.min(1, dt * 10);
  K.animarPersonaje(m.pj, t, { caminando: true });
}

// ---------- arcos de comunicación ----------
const arcos = new THREE.Group(); scene.add(arcos);
const viajeros = [];
function limpiarArcos() { while (arcos.children.length) { const c = arcos.children.pop(); c.geometry?.dispose(); } viajeros.length = 0; }
function arco(de, a, color, op = 0.9) {
  const p = centro(de).setY(H + 0.4), q = centro(a).setY(H + 0.4);
  const m = p.clone().add(q).multiplyScalar(0.5); m.y = H + 1.6 + p.distanceTo(q) * 0.25;
  const curva = new THREE.QuadraticBezierCurve3(p, m, q);
  arcos.add(new THREE.Mesh(new THREE.TubeGeometry(curva, 60, 0.035, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op * 0.55 })));
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color })); arcos.add(b);
    viajeros.push({ b, curva, t: k / 3 });
  }
}
function relaciones(id) { return salaPorId[id].comunica.filter(c => PLANO[c.con]).map(c => c.dir === 'sale' ? [id, c.con] : [c.con, id]); }
function todasRelaciones() { const r = []; for (const s of D.salas) for (const c of s.comunica) if (c.dir === 'sale' && PLANO[c.con]) r.push([s.id, c.con]); return r; }
function mostrarFlujos() {
  limpiarArcos(); limpiarMensajeros();
  const pares = verTodas ? todasRelaciones() : salaActual ? relaciones(salaActual) : ambiente;
  for (const [de, a] of pares) { if (verTodas || salaActual) arco(de, a, salaPorId[de].color, verTodas ? 0.6 : 0.9); crearMensajero(de, a, salaPorId[de].color); }
  actualizarEstado();
}
const ambiente = (() => { const t = todasRelaciones(); return [t[0], t[5], t[9]].filter(Boolean); })();

// ---------- cámara ----------
let anim = null;
function volarA(target, dist, dur = 1.6) {
  const pos = target.clone().addScaledVector(DIR, dist);
  anim = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target.clone(), ini: performance.now(), dur: dur * 1000 };
}
const derechaPantalla = new THREE.Vector3(DIR.z, 0, -DIR.x).normalize();
const conPanel = () => innerWidth > 760;
function vistaSala(id) {
  const p = PLANO[id], w = p.x1 - p.x0, d = p.z1 - p.z0;
  const dist = Math.min(30, Math.max(12, Math.max(w, d) * 1.6 + 5));
  const t = centro(id).setY(0.6).addScaledVector(derechaPantalla, conPanel() ? dist * 0.11 : 0);
  return { t, dist };
}
const easing = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// ---------- muros que se vuelven translúcidos si tapan lo que se mira ----------
const rayo = new THREE.Ray(), tmp = new THREE.Vector3();
function actualizarMuros() {
  const objetivos = [];
  if (salaActual && !anim) {
    const p = PLANO[salaActual];
    for (const [fx, fz] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) objetivos.push(new THREE.Vector3(p.x0 + (p.x1 - p.x0) * fx, 0.7, p.z0 + (p.z1 - p.z0) * fz));
  }
  for (const pz of piezas) {
    let tapa = false;
    for (const o of objetivos) {
      rayo.origin.copy(camera.position); rayo.direction.copy(o).sub(camera.position);
      const lim = rayo.direction.length() - 0.25; rayo.direction.normalize();
      if (rayo.intersectBox(pz.caja, tmp) && tmp.distanceTo(camera.position) < lim) { tapa = true; break; }
    }
    const meta = tapa ? 0.12 : 1;
    pz.opacidad += (meta - pz.opacidad) * 0.15;
    for (const m of pz.mallas) {
      const mat = m.material;
      if (pz.vidrio) { mat.opacity = 0.22 * pz.opacidad + 0.02; continue; }
      const tr = pz.opacidad < 0.98;
      if (mat.transparent !== tr) { mat.transparent = tr; mat.depthWrite = !tr; mat.needsUpdate = true; }
      mat.opacity = pz.opacidad; m.castShadow = pz.opacidad > 0.5;
    }
  }
}

// ---------- panel ----------
const panel = document.getElementById('panel');
let salaActual = null, personaActual = null, verTodas = false;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const iniciales = n => n.split(' ').map(x => x[0]).slice(0, 2).join('');

function resaltar() {
  for (const m of pisos) m.material.opacity = m.userData.sala === salaActual ? 0.16 : 0;
  for (const s of D.salas) s._rotulo?.classList.toggle('activo', s.id === salaActual);
  for (const [id, el] of Object.entries(etiquetas)) el.classList.toggle('activo', id === personaActual);
  for (const [id, gl] of Object.entries(globos)) {
    const p = personaPorId[id];
    gl.classList.toggle('visible', personaActual ? id === personaActual : p.sala === salaActual);
  }
  for (const [id, pj] of Object.entries(personas3D)) pj.userData.mira = 0;
}
function filaFlujo(c, s) {
  const otra = salaPorId[c.con];
  return `<li data-ir="${c.con}"><div class="dir" style="color:${otra?.color}">${c.dir === 'sale' ? 'Entrega a →' : '← Recibe de'} ${esc(otra?.nombre)}</div>${esc(c.que)}<div class="canal">${esc(c.canal)}</div></li>`;
}
function abrirSala(id, { volar = true } = {}) {
  const s = salaPorId[id]; salaActual = id; personaActual = null;
  const ids = gente(id);
  panel.innerHTML = `
    <div class="cab"><span class="chip" style="background:${s.color}"></span>
      <div><h2>${esc(s.nombre)}</h2><small>${ids.length ? ids.length + (ids.length === 1 ? ' persona' : ' personas') : 'Espacio común'}</small></div>
      <button class="cerrar" data-cerrar aria-label="Cerrar">×</button></div>
    <div class="cuerpo">
      <h3>Qué hace</h3><p>${esc(s.que_hace)}</p>
      ${s.procesos.length ? `<h3>Procesos</h3><div class="etiquetas">${s.procesos.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
      ${s.comunica.length ? `<h3>Cómo se comunica</h3><ul class="flujo">${s.comunica.map(c => filaFlujo(c, s)).join('')}</ul>` : ''}
      ${ids.length ? `<h3>Quiénes trabajan aquí</h3><div class="gente">${ids.map(pid => { const p = personaPorId[pid]; return `
        <button class="persona" data-persona="${p.id}"><span class="avatar" style="background:${s.color}">${iniciales(p.nombre)}</span>
          <span><b>${esc(p.nombre)}</b><small>${esc(p.cargo)}</small></span><em>Ver descriptor ›</em></button>`; }).join('')}</div>` : ''}
    </div>`;
  panel.classList.add('abierto');
  resaltar(); mostrarFlujos();
  if (volar) { const v = vistaSala(id); volarA(v.t, v.dist); }
  hablar(`${s.nombre}. ${s.que_hace}`);
}
const OPCIONES_SALA = D.salas.filter(s => PLANO[s.id]).map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
function bloqueOrdenar(p) { // solo quien administra Calidad: cambiar a la persona de oficina
  if (!D.puede_ordenar || !p.real) return '';
  return `<div class="ordenar"><label>Se sienta en <select data-asignar="${p.id}">${OPCIONES_SALA.replace(`value="${p.sala}"`, `value="${p.sala}" selected`)}</select></label>
    <small>${p.sala_asignada ? 'Asignada a mano' : 'Sugerida por su cargo'}</small></div>`;
}
function bloqueDescriptor(d, lista) {
  if (!d) return `<div class="descriptor"><div class="desc-cab">Descriptor de cargo</div><p class="sin-desc">Todavía no tiene un descriptor de cargo vigente en Calidad → Personas.</p></div>`;
  return `<div class="descriptor">
        <div class="desc-cab">Descriptor de cargo${d.version ? ` · versión ${esc(d.version)}` : ''}</div>
        <h3>Objetivo del cargo</h3><p>${esc(d.objetivo) || '—'}</p>
        <h3>Funciones</h3>${lista(d.funciones)}
        <h3>Responsabilidades</h3>${lista(d.responsabilidades)}
        <h3>Habilidades</h3>${(d.habilidades || []).length ? `<div class="etiquetas">${d.habilidades.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '<p>—</p>'}
        <h3>Requisitos</h3>
        <dl class="dato"><dt>Educación</dt><dd>${esc(d.nivel_educacional) || '—'}</dd>${d.formacion_tecnica ? `<dt>Formación</dt><dd>${esc(d.formacion_tecnica)}</dd>` : ''}<dt>Experiencia</dt><dd>${esc(d.experiencia) || '—'}</dd></dl>
      </div>`;
}
function abrirPersona(pid) {
  const p = personaPorId[pid], s = salaPorId[p.sala], d = p.descriptor || {};
  const cambioSala = salaActual !== p.sala;
  personaActual = pid; salaActual = p.sala;
  const jefe = p.jefatura ? personaPorId[p.jefatura] : null, aCargo = D.personas.filter(x => x.jefatura === pid);
  const lista = arr => arr?.length ? `<ul class="lista">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>—</p>';
  panel.innerHTML = `
    <div class="cab"><span class="avatar grande" style="background:${s.color}">${iniciales(p.nombre)}</span>
      <div><h2>${esc(p.nombre)}</h2><small>${esc(p.cargo)} · ${esc(s.nombre)}</small></div>
      <button class="cerrar" data-cerrar aria-label="Cerrar">×</button></div>
    <div class="cuerpo">
      <button class="volver" data-ir="${s.id}">← Volver a ${esc(s.nombre)}</button>
      <div class="ahora"><span></span>${esc(p.tarea || '')}</div>
      <dl class="dato">
        <dt>Reporta a</dt><dd>${jefe ? `<span class="enlace" data-persona="${jefe.id}">${esc(jefe.nombre)}</span><br><small>${esc(jefe.cargo)}</small>` : 'Directorio'}</dd>
        <dt>A su cargo</dt><dd>${aCargo.length ? aCargo.map(x => `<span class="enlace" data-persona="${x.id}">${esc(x.nombre)}</span>`).join(', ') : '—'}</dd>
      </dl>
      ${bloqueOrdenar(p)}
      ${bloqueDescriptor(p.descriptor, lista)}
      ${s.comunica.length ? `<h3>Con quién se comunica su área</h3><ul class="flujo">${s.comunica.map(c => filaFlujo(c, s)).join('')}</ul>` : ''}
    </div>`;
  panel.classList.add('abierto');
  resaltar(); if (cambioSala) mostrarFlujos();
  const pj = personas3D[pid], w = new THREE.Vector3(); pj.getWorldPosition(w); w.y = 1.0;
  volarA(w.addScaledVector(derechaPantalla, conPanel() ? 1.1 : 0), 6.5, 1.3);
  hablar(`${p.nombre}, ${p.cargo}. ${d.objetivo || ''}`);
}
panel.addEventListener('click', e => {
  const t = e.target.closest('[data-persona],[data-ir],[data-cerrar]'); if (!t) return;
  detenerTour();
  if (t.dataset.cerrar !== undefined) { cerrarPanel(); volarGeneral(); }
  else if (t.dataset.persona) abrirPersona(t.dataset.persona);
  else if (t.dataset.ir) abrirSala(t.dataset.ir);
});
// Ordenar la oficina (solo quien administra Calidad): se guarda y se vuelve a armar.
panel.addEventListener('change', async e => {
  const sel = e.target.closest('[data-asignar]'); if (!sel) return;
  sel.disabled = true;
  try {
    const r = await window.llamarApi(window.SIGSO_CONFIG.NODE_API_URL, 'asignarPuestoOficina', { persona_id: sel.dataset.asignar, sala_id: sel.value });
    if (!r || !r.ok) { alert((r && r.message) || 'No se pudo guardar.'); sel.disabled = false; return; }
    location.reload();
  } catch (err) { alert('No se pudo conectar con SIGSO.'); sel.disabled = false; }
});
function abrirSinOficina() {
  detenerTour(); salaActual = personaActual = null; resaltar();
  panel.innerHTML = `
    <div class="cab"><span class="chip" style="background:#94a3b8"></span>
      <div><h2>Personas sin oficina</h2><small>Su cargo no indica dónde se sienta</small></div>
      <button class="cerrar" data-cerrar aria-label="Cerrar">×</button></div>
    <div class="cuerpo"><p>Están en Calidad → Personas, pero el recorrido no sabe en qué oficina ponerlas. Elige una y aparecerán en su puesto.</p>
      <div class="gente">${D.sin_oficina.map(p => `<div class="persona"><span class="avatar" style="background:#94a3b8">${iniciales(p.nombre)}</span>
        <span><b>${esc(p.nombre)}</b><small>${esc(p.cargo)}</small></span>
        <select data-asignar="${p.persona_id}"><option value="">Elegir…</option>${OPCIONES_SALA}</select></div>`).join('')}</div></div>`;
  panel.classList.add('abierto');
}
function cerrarPanel() { panel.classList.remove('abierto'); salaActual = personaActual = null; resaltar(); mostrarFlujos(); callar(); }
function volarGeneral() { volarA(GENERAL.target.clone(), GENERAL.dist); }

// ---------- voz ----------
let voz = false;
function hablar(texto) {
  if (!voz || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto), vs = speechSynthesis.getVoices();
  u.voice = vs.find(v => /es[-_]CL/i.test(v.lang)) || vs.find(v => /es[-_](419|MX|US)/i.test(v.lang)) || vs.find(v => /^es/i.test(v.lang)) || null;
  u.lang = u.voice?.lang || 'es-CL'; u.rate = 1.02; speechSynthesis.speak(u);
}
function callar() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
document.getElementById('bVoz').onclick = e => { voz = !voz; e.currentTarget.classList.toggle('on', voz); e.currentTarget.querySelector('span').textContent = voz ? 'Voz activada' : 'Voz'; if (!voz) callar(); };

// ---------- recorrido guiado ----------
const tourEl = document.getElementById('tour'), DUR = 12000;
let tour = null;
function irPaso(i) {
  tour.i = (i + D.recorrido.length) % D.recorrido.length; tour.ini = performance.now();
  abrirSala(D.recorrido[tour.i]);
  document.getElementById('tPaso').innerHTML = `<b>${tour.i + 1}/${D.recorrido.length}</b> ${esc(salaPorId[D.recorrido[tour.i]].nombre)}`;
}
function iniciarTour() { tour = { i: 0, ini: 0, pausa: false }; tourEl.classList.add('activo'); document.getElementById('tPausa').textContent = '❚❚'; irPaso(0); }
function detenerTour() { if (!tour) return; tour = null; tourEl.classList.remove('activo'); }
document.getElementById('bTour').onclick = iniciarTour;
document.getElementById('tSig').onclick = () => irPaso(tour.i + 1);
document.getElementById('tAnt').onclick = () => irPaso(tour.i - 1);
document.getElementById('tSalir').onclick = () => { detenerTour(); cerrarPanel(); volarGeneral(); };
document.getElementById('tPausa').onclick = e => {
  tour.pausa = !tour.pausa; e.currentTarget.textContent = tour.pausa ? '▶' : '❚❚';
  if (tour.pausa) tour.resto = performance.now() - tour.ini; else tour.ini = performance.now() - (tour.resto || 0);
};
document.getElementById('bGeneral').onclick = () => { detenerTour(); cerrarPanel(); volarGeneral(); };
document.getElementById('bComu').onclick = e => { verTodas = !verTodas; e.currentTarget.classList.toggle('on', verTodas); mostrarFlujos(); };

// ---------- estado (arriba, como los TikTok) ----------
function actualizarEstado() {
  document.getElementById('estado').innerHTML =
    `<span><i style="background:#16a34a"></i>${D.personas.length} trabajando</span>` +
    `<span><i style="background:#0284c7"></i>${mensajeros.length} llevando documentos</span>` +
    `<span><i style="background:#e9a23b"></i>${D.salas.filter(s => PLANO[s.id]).length} espacios</span>`;
}

// ---------- mouse ----------
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = document.getElementById('tip');
const clicables = [...pisos]; for (const pj of Object.values(personas3D)) pj.traverse(o => { if (o.isMesh) clicables.push(o); });
let abajo = null, hover = null;
function tocado(e) {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const h = ray.intersectObjects(clicables, false).find(x => x.object.userData.persona || x.object.userData.sala);
  return h ? h.object.userData : null;
}
renderer.domElement.addEventListener('pointerdown', e => { abajo = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!abajo || Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) > 5) return;
  const u = tocado(e); if (!u) return; detenerTour();
  if (u.persona) abrirPersona(u.persona); else if (u.sala) abrirSala(u.sala);
});
renderer.domElement.addEventListener('pointermove', e => {
  const u = tocado(e);
  renderer.domElement.style.cursor = u ? 'pointer' : 'grab';
  if (u?.persona) { const p = personaPorId[u.persona]; tip.innerHTML = `<b>${esc(p.nombre)}</b> · ${esc(p.cargo)}`; }
  else if (u?.sala) tip.innerHTML = `<b>${esc(salaPorId[u.sala].nombre)}</b> · clic para entrar`;
  tip.style.display = u ? 'block' : 'none';
  tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px';
  const hs = u?.sala || (u?.persona && personaPorId[u.persona].sala) || null;
  if (hs !== hover) { hover = hs; for (const m of pisos) m.material.opacity = m.userData.sala === salaActual ? 0.16 : (m.userData.sala === hover ? 0.09 : 0); }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); css2d.setSize(innerWidth, innerHeight);
});

// ---------- arranque ----------
document.getElementById('empresa').textContent = `${D.empresa} · ${D.personas.length} personas`;
const avisoEl = document.getElementById('aviso');
if (avisoEl) { avisoEl.textContent = D.aviso || ''; avisoEl.classList.toggle('real', D.modo === 'real'); }
if (D.puede_ordenar && (D.sin_oficina || []).length) {
  const b = document.getElementById('bSinOficina');
  b.hidden = false; b.querySelector('span').textContent = D.sin_oficina.length;
  b.onclick = abrirSinOficina;
}
mostrarFlujos();
const reloj = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, reloj.getDelta()), t = reloj.elapsedTime, ahora = performance.now();
  if (anim) {
    const k = Math.min(1, (ahora - anim.ini) / anim.dur), e = easing(k);
    camera.position.lerpVectors(anim.p0, anim.p1, e); controls.target.lerpVectors(anim.t0, anim.t1, e);
    if (k >= 1) anim = null;
  }
  if (tour && !tour.pausa) {
    const k = (ahora - tour.ini) / DUR;
    document.getElementById('tBarra').style.width = Math.min(100, k * 100) + '%';
    if (k >= 1) irPaso(tour.i + 1);
  }
  for (const pj of Object.values(personas3D)) K.animarPersonaje(pj, t);
  for (const m of mensajeros) moverMensajero(m, dt, t);
  for (const v of viajeros) { v.t = (v.t + dt * 0.25) % 1; v.b.position.copy(v.curva.getPoint(v.t)); }
  for (const v of ventiladores) v.userData.aspas.rotation.z += dt * 18;
  for (const c of camaras) c.userData.luz.visible = Math.sin(t * 4) > -0.3; // grabando
  actualizarMuros();
  controls.update();
  composer.render();
  css2d.render(scene, camera);
});
