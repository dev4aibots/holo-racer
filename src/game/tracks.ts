/**
 * Track environments: scenery variants recycled along the endless road.
 * buildEnvironment(scene, variant) builds the scenery group and returns
 * a dispose function. Call updateEnvironment(scene, playerZ) per frame
 * to recycle items ahead of the player.
 */
import * as THREE from 'three';
import { GAME } from '../config.ts';

export type TrackVariant = 'neon-city' | 'coast' | 'desert' | 'arctic' | 'volcano';

export const TRACKS: Array<{ id: TrackVariant; name: string; desc: string; icon: string }> = [
  { id: 'neon-city', name: 'NEON CITY', desc: 'Downtown holographic streets', icon: '🌃' },
  { id: 'coast', name: 'COAST', desc: 'Palm-lined ocean highway', icon: '🌴' },
  { id: 'desert', name: 'DESERT', desc: 'Sunset dunes and mesas', icon: '🏜️' },
  { id: 'arctic', name: 'ARCTIC', desc: 'Aurora ice fields', icon: '❄️' },
  { id: 'volcano', name: 'VOLCANO', desc: 'Lava flows and obsidian', icon: '🌋' },
];

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
  // Start palms ahead of the camera (negative z) to avoid near-plane clipping
  // at spawn. x offset keeps them clear of the road and camera frustum edges.
  for (let z = -20; z > -SPAN; z -= 45) {
    const palm = template.clone();
    palm.position.set(side * (14 + Math.random() * 9), 0, z + (Math.random() - 0.5) * 12);
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

function buildDesert(group: THREE.Group): void {
  // Mesas: flat-topped rock formations.
  const mesaGeo = cachedGeo('mesa', () => new THREE.CylinderGeometry(8, 12, 14, 7));
  const mesaMat = cachedMat('mesaMat', () =>
    new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.95 }),
  );
  for (let z = 0; z > -SPAN; z -= 90) {
    for (const s of [-1, 1]) {
      if (Math.random() < 0.7) {
        const mesa = new THREE.Mesh(mesaGeo, mesaMat);
        const h = 10 + Math.random() * 16;
        mesa.scale.set(1 + Math.random() * 0.8, h / 14, 1 + Math.random() * 0.8);
        mesa.position.set(s * (40 + Math.random() * 50), h / 2 - 1, z + (Math.random() - 0.5) * 30);
        mesa.rotation.y = Math.random() * Math.PI;
        group.add(mesa);
      }
    }
  }
  // Cacti: green columns with arms.
  const cactusGeo = cachedGeo('cactus', () => new THREE.CylinderGeometry(0.35, 0.42, 4, 8));
  const cactusMat = cachedMat('cactusMat', () =>
    new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 0.9 }),
  );
  for (let z = 20; z > -SPAN; z -= 28) {
    const s = Math.random() < 0.5 ? -1 : 1;
    const cactus = new THREE.Group();
    const trunk = new THREE.Mesh(cactusGeo, cactusMat);
    trunk.position.y = 2;
    cactus.add(trunk);
    for (const as of [-1, 1]) {
      if (Math.random() < 0.6) {
        const arm = new THREE.Mesh(cactusGeo, cactusMat);
        arm.scale.set(0.7, 0.5, 0.7);
        arm.position.set(as * 0.5, 2.2 + Math.random(), 0);
        arm.rotation.z = as * 0.5;
        cactus.add(arm);
      }
    }
    cactus.position.set(s * (11 + Math.random() * 14), 0, z);
    const sc = 0.8 + Math.random() * 0.7;
    cactus.scale.set(sc, sc, sc);
    group.add(cactus);
  }
}

function buildArctic(group: THREE.Group): void {
  // Ice shards: crystalline formations.
  const shardGeo = cachedGeo('shard', () => new THREE.ConeGeometry(1.2, 8, 5));
  const shardMat = cachedMat('shardMat', () =>
    new THREE.MeshStandardMaterial({
      color: 0x9fd8ff, roughness: 0.15, metalness: 0.1,
      transparent: true, opacity: 0.85, emissive: 0x2266aa, emissiveIntensity: 0.3,
    }),
  );
  for (let z = 10; z > -SPAN; z -= 40) {
    for (const s of [-1, 1]) {
      if (Math.random() < 0.75) {
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const shard = new THREE.Mesh(shardGeo, shardMat);
          const h = 4 + Math.random() * 10;
          shard.scale.set(0.8 + Math.random() * 0.7, h / 8, 0.8 + Math.random() * 0.7);
          shard.position.set(
            s * (14 + Math.random() * 30) + (Math.random() - 0.5) * 8,
            h / 2 - 0.5,
            z + (Math.random() - 0.5) * 20,
          );
          shard.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3);
          group.add(shard);
        }
      }
    }
  }
  // Snow pines.
  const pineGeo = cachedGeo('pine', () => new THREE.ConeGeometry(1.8, 5, 8));
  const pineMat = cachedMat('pineMat', () =>
    new THREE.MeshStandardMaterial({ color: 0x1a3d2a, roughness: 0.95 }),
  );
  const snowMat = cachedMat('snowMat', () =>
    new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.9 }),
  );
  for (let z = 30; z > -SPAN; z -= 35) {
    const s = Math.random() < 0.5 ? -1 : 1;
    const pine = new THREE.Group();
    const trunk = new THREE.Mesh(pineGeo, pineMat);
    trunk.position.y = 2.5;
    pine.add(trunk);
    const snow = new THREE.Mesh(pineGeo, snowMat);
    snow.scale.set(0.7, 0.4, 0.7);
    snow.position.y = 4.2;
    pine.add(snow);
    pine.position.set(s * (12 + Math.random() * 18), 0, z);
    const sc = 0.9 + Math.random() * 0.8;
    pine.scale.set(sc, sc, sc);
    group.add(pine);
  }
}

function buildVolcano(group: THREE.Group): void {
  // Obsidian rocks: dark jagged formations.
  const rockGeo = cachedGeo('obsidian', () => new THREE.DodecahedronGeometry(2.2, 0));
  const rockMat = cachedMat('obsidianMat', () =>
    new THREE.MeshStandardMaterial({ color: 0x1a0a0a, roughness: 0.4, metalness: 0.6 }),
  );
  const lavaMat = cachedMat('lavaMat', () =>
    new THREE.MeshBasicMaterial({ color: 0xff4400 }),
  );
  for (let z = 0; z > -SPAN; z -= 55) {
    for (const s of [-1, 1]) {
      if (Math.random() < 0.8) {
        const rock = new THREE.Mesh(rockGeo, rockMat);
        const sc = 2 + Math.random() * 5;
        rock.scale.set(sc, sc * (0.7 + Math.random() * 0.6), sc);
        rock.position.set(s * (16 + Math.random() * 30), sc * 0.3, z + (Math.random() - 0.5) * 20);
        rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        group.add(rock);
        // Lava cracks: glowing planes at rock bases.
        if (Math.random() < 0.5) {
          const lava = new THREE.Mesh(
            cachedGeo('lavaPool', () => new THREE.CircleGeometry(3, 12)),
            lavaMat,
          );
          lava.rotation.x = -Math.PI / 2;
          lava.position.set(
            s * (13 + Math.random() * 10), 0.05,
            z + (Math.random() - 0.5) * 15,
          );
          const ls = 0.6 + Math.random() * 0.8;
          lava.scale.set(ls, ls, ls);
          group.add(lava);
        }
      }
    }
  }
  // Volcano in the distance.
  const coneGeo = cachedGeo('volcanoCone', () => new THREE.ConeGeometry(40, 55, 12, 1, true));
  const coneMat = cachedMat('volcanoMat', () =>
    new THREE.MeshStandardMaterial({ color: 0x2a0f0a, roughness: 1, side: THREE.DoubleSide }),
  );
  const volcano = new THREE.Mesh(coneGeo, coneMat);
  volcano.position.set(0, 20, -SPAN + 100);
  group.add(volcano);
}

/**
 * Build scenery for the variant, add it to the scene, and return a
 * dispose function that removes it (shared caches are kept).
 */
export function buildEnvironment(scene: THREE.Scene, variant: TrackVariant): () => void {
  const group = new THREE.Group();
  if (variant === 'neon-city') buildNeonCity(group);
  else if (variant === 'coast') buildCoast(group);
  else if (variant === 'desert') buildDesert(group);
  else if (variant === 'arctic') buildArctic(group);
  else buildVolcano(group);
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
