/**
 * Track environments: scenery variants recycled along the endless road.
 * buildEnvironment(scene, variant) builds the scenery group and returns
 * a dispose function. Call updateEnvironment(scene, playerZ) per frame
 * to recycle items ahead of the player.
 */
import * as THREE from 'three';
import { GAME } from '../config.ts';

export type TrackVariant = 'neon-city' | 'coast';

const SPAN = 720; // meters of scenery coverage

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

function cachedMat(key: string, make: () => THREE.Material): THREE.Material {
  let m = matCache.get(key);
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

function makeWindowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05070d';
  g.fillRect(0, 0, 64, 128);
  const lit = ['#ffd27a', '#7ae2ff', '#ff9ad5'];
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (Math.random() < 0.42) {
        g.fillStyle = lit[Math.floor(Math.random() * lit.length)];
        g.fillRect(x, y, 4, 5);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const updaters = new Map<THREE.Scene, (playerZ: number) => void>();

function buildNeonCity(group: THREE.Group): void {
  const poleGeo = cachedGeo('pole', () => new THREE.CylinderGeometry(0.12, 0.18, 7, 8));
  const poleMat = cachedMat('poleMat', () =>
    new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.7, metalness: 0.5 }),
  );
  const armGeo = cachedGeo('arm', () => new THREE.BoxGeometry(2.4, 0.14, 0.14));
  const lampGeo = cachedGeo('lamp', () => new THREE.SphereGeometry(0.38, 12, 8));
  const lampMat = cachedMat('lampMat', () => new THREE.MeshBasicMaterial({ color: 0xffb14e }));

  let side = 1;
  for (let z = 40; z > -SPAN; z -= 36) {
    const light = new THREE.Group();
    const x = side * 9.6;
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 3.5, 0);
    light.add(pole);
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.set(x - side * 1.1, 6.9, 0);
    light.add(arm);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(x - side * 2.2, 6.7, 0);
    light.add(lamp);
    light.position.z = z;
    group.add(light);
    side = -side;
  }

  // City silhouette boxes with lit windows.
  const bldgGeo = cachedGeo('bldg', () => new THREE.BoxGeometry(1, 1, 1));
  const winTex = makeWindowTexture();
  const bldgMat = cachedMat('bldgMat', () =>
    new THREE.MeshStandardMaterial({
      color: 0x0c1226,
      roughness: 0.9,
      emissive: 0xffffff,
      emissiveMap: winTex,
      emissiveIntensity: 0.85,
    }),
  );
  for (let z = 20; z > -SPAN; z -= 55) {
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(bldgGeo, bldgMat);
      const w = 10 + Math.random() * 14;
      const h = 14 + Math.random() * 42;
      const d = 10 + Math.random() * 14;
      b.scale.set(w, h, d);
      b.position.set(s * (28 + Math.random() * 34), h / 2 - 0.1, z + (Math.random() - 0.5) * 20);
      group.add(b);
    }
  }
}

function palmTemplate(): THREE.Group {
  const palm = new THREE.Group();
  const trunkGeo = cachedGeo('trunk', () => new THREE.CylinderGeometry(0.16, 0.3, 5.6, 8));
  const trunkMat = cachedMat('trunkMat', () =>
    new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 }),
  );
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 2.8;
  trunk.rotation.z = 0.06;
  palm.add(trunk);

  const frondGeo = cachedGeo('frond', () => new THREE.ConeGeometry(0.55, 2.8, 6));
  const frondMat = cachedMat('frondMat', () =>
    new THREE.MeshStandardMaterial({ color: 0x2f8f4e, roughness: 0.9 }),
  );
  for (let i = 0; i < 6; i++) {
    const frond = new THREE.Mesh(frondGeo, frondMat);
    const a = (i / 6) * Math.PI * 2;
    frond.position.set(Math.cos(a) * 1.1, 5.7, Math.sin(a) * 1.1);
    frond.rotation.z = Math.cos(a) * 1.15;
    frond.rotation.x = -Math.sin(a) * 1.15;
    palm.add(frond);
  }
  const nutGeo = cachedGeo('nut', () => new THREE.SphereGeometry(0.22, 8, 6));
  const nutMat = cachedMat('nutMat', () =>
    new THREE.MeshStandardMaterial({ color: 0x5a3d1e, roughness: 1 }),
  );
  const nut = new THREE.Mesh(nutGeo, nutMat);
  nut.position.y = 5.5;
  palm.add(nut);
  return palm;
}

function buildCoast(group: THREE.Group): void {
  const template = palmTemplate();
  let side = 1;
  for (let z = 30; z > -SPAN; z -= 45) {
    const palm = template.clone();
    palm.position.set(side * (12 + Math.random() * 9), 0, z + (Math.random() - 0.5) * 12);
    palm.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.85 + Math.random() * 0.5;
    palm.scale.set(s, s, s);
    group.add(palm);
    side = -side;
  }

  // Dunes: squashed spheres in sand tones.
  const duneGeo = cachedGeo('dune', () => new THREE.SphereGeometry(1, 14, 10));
  const duneMat = cachedMat('duneMat', () =>
    new THREE.MeshStandardMaterial({ color: 0xd9bd85, roughness: 1 }),
  );
  for (let z = 0; z > -SPAN; z -= 70) {
    for (const s of [-1, 1]) {
      const dune = new THREE.Mesh(duneGeo, duneMat);
      dune.scale.set(16 + Math.random() * 14, 3 + Math.random() * 3, 10 + Math.random() * 8);
      dune.position.set(s * (34 + Math.random() * 46), -0.4, z + (Math.random() - 0.5) * 24);
      group.add(dune);
    }
  }
}

/**
 * Build scenery for the variant, add it to the scene, and return a
 * dispose function that removes it (shared caches are kept).
 */
export function buildEnvironment(scene: THREE.Scene, variant: TrackVariant): () => void {
  const group = new THREE.Group();
  if (variant === 'neon-city') buildNeonCity(group);
  else buildCoast(group);
  scene.add(group);

  const update = (playerZ: number): void => {
    for (const child of group.children) {
      if (child.position.z > playerZ + 60) {
        child.position.z -= SPAN;
      }
    }
  };
  updaters.set(scene, update);

  return () => {
    scene.remove(group);
    updaters.delete(scene);
  };
}

/** Recycle scenery items so they stay ahead of the player. */
export function updateEnvironment(scene: THREE.Scene, playerZ: number): void {
  const update = updaters.get(scene);
  if (update) update(playerZ);
}

export function laneCenterX(lane: number): number {
  return (lane - (GAME.LANES - 1) / 2) * GAME.LANE_WIDTH;
}
