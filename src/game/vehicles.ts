/**
 * Holographic car builder.
 * Lightweight stylized cars from shared cached geometries/materials:
 * dark metallic body + emissive wireframe overlay + underglow.
 * Car forward is -Z.
 */
import * as THREE from 'three';

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

function boxGeo(key: string, w: number, h: number, d: number): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

function wheelGeo(): THREE.BufferGeometry {
  let g = geoCache.get('wheel');
  if (!g) {
    g = new THREE.CylinderGeometry(0.34, 0.34, 0.32, 14);
    g.rotateZ(Math.PI / 2); // axle along X
    geoCache.set('wheel', g);
  }
  return g;
}

function glowGeo(): THREE.BufferGeometry {
  let g = geoCache.get('glow');
  if (!g) {
    g = new THREE.PlaneGeometry(2.5, 4.7);
    g.rotateX(-Math.PI / 2);
    geoCache.set('glow', g);
  }
  return g;
}

function bodyMat(): THREE.Material {
  let m = matCache.get('body');
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: 0x0d1526,
      metalness: 0.85,
      roughness: 0.32,
    });
    matCache.set('body', m);
  }
  return m;
}

function wheelMat(): THREE.Material {
  let m = matCache.get('wheelMat');
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 0.9, metalness: 0.2 });
    matCache.set('wheelMat', m);
  }
  return m;
}

function edgeMat(color: number): THREE.Material {
  const key = `edge:${color}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });
    matCache.set(key, m);
  }
  return m;
}

function lightMat(color: number): THREE.Material {
  const key = `light:${color}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    matCache.set(key, m);
  }
  return m;
}

function glowMat(color: number): THREE.Material {
  const key = `glow:${color}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    matCache.set(key, m);
  }
  return m;
}

/**
 * Build a holographic car. Geometries and materials are shared across
 * instances via module-level caches. Wheels are exposed for spin via
 * `group.userData.wheels` (THREE.Mesh[]).
 */
export function buildHologramCar(color: number): THREE.Group {
  const car = new THREE.Group();

  const body = new THREE.Mesh(boxGeo('body', 1.9, 0.55, 4.2), bodyMat());
  body.position.y = 0.58;
  car.add(body);

  const bodyWire = new THREE.Mesh(boxGeo('body', 1.9, 0.55, 4.2), edgeMat(color));
  bodyWire.position.copy(body.position);
  bodyWire.scale.set(1.015, 1.03, 1.008);
  car.add(bodyWire);

  const cabin = new THREE.Mesh(boxGeo('cabin', 1.5, 0.5, 1.9), bodyMat());
  cabin.position.set(0, 1.08, 0.35);
  car.add(cabin);

  const cabinWire = new THREE.Mesh(boxGeo('cabin', 1.5, 0.5, 1.9), edgeMat(color));
  cabinWire.position.copy(cabin.position);
  cabinWire.scale.set(1.02, 1.04, 1.02);
  car.add(cabinWire);

  // Headlights (front is -Z) and taillights.
  const headGeo = boxGeo('headlight', 0.34, 0.14, 0.06);
  for (const sx of [-0.6, 0.6]) {
    const head = new THREE.Mesh(headGeo, lightMat(0xd8f4ff));
    head.position.set(sx, 0.62, -2.11);
    car.add(head);
    const tail = new THREE.Mesh(headGeo, lightMat(0xff2d4e));
    tail.position.set(sx, 0.62, 2.11);
    car.add(tail);
  }

  // Wheels with glowing rims.
  const wheels: THREE.Mesh[] = [];
  const wg = wheelGeo();
  const wm = wheelMat();
  const rimGeo = boxGeo('rim', 0.36, 0.1, 0.1);
  for (const [sx, sz] of [[-0.98, -1.35], [0.98, -1.35], [-0.98, 1.35], [0.98, 1.35]] as const) {
    const wheel = new THREE.Mesh(wg, wm);
    wheel.position.set(sx, 0.34, sz);
    car.add(wheel);
    wheels.push(wheel);
    // Glowing rim accent.
    const rim = new THREE.Mesh(rimGeo, lightMat(color));
    rim.position.set(sx + (sx > 0 ? 0.17 : -0.17), 0.34, sz);
    car.add(rim);
  }
  car.userData.wheels = wheels;

  // Sporty spoiler.
  const spoiler = new THREE.Mesh(boxGeo('spoiler', 1.7, 0.08, 0.45), bodyMat());
  spoiler.position.set(0, 1.25, 1.85);
  car.add(spoiler);
  const spoilerWire = new THREE.Mesh(boxGeo('spoiler', 1.7, 0.08, 0.45), edgeMat(color));
  spoilerWire.position.copy(spoiler.position);
  spoilerWire.scale.set(1.02, 1.3, 1.05);
  car.add(spoilerWire);
  for (const sx of [-0.7, 0.7]) {
    const strut = new THREE.Mesh(boxGeo('strut', 0.08, 0.35, 0.08), bodyMat());
    strut.position.set(sx, 1.05, 1.85);
    car.add(strut);
  }

  // Holographic underglow.
  const glow = new THREE.Mesh(glowGeo(), glowMat(color));
  glow.position.y = 0.03;
  car.add(glow);

  return car;
}
