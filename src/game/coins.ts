/**
 * Coin manager: instanced spinning gold coins along the track.
 * Coins spawn every GAME.COIN_SPAWN_EVERY_M meters, get magnetized
 * toward the player when close, and are collected within ~2 m.
 */
import * as THREE from 'three';
import { GAME } from '../config.ts';
import { laneCenterX } from './tracks.ts';

const MAX_COINS = 64;
const SPAWN_AHEAD = 340;
const MAGNET_RADIUS = 7;
const COLLECT_RADIUS = 2;

interface Coin {
  x: number;
  z: number;
  spin: number;
  vx: number;
  vz: number;
}

const dummy = new THREE.Object3D();

export class CoinManager {
  private mesh: THREE.InstancedMesh;
  private coins: Coin[] = [];
  private nextSpawnDist = 0;
  private time = 0;

  constructor(private scene: THREE.Scene) {
    const geo = new THREE.OctahedronGeometry(0.55);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffc400,
      emissive: 0xff9d00,
      emissiveIntensity: 1.1,
      metalness: 0.9,
      roughness: 0.25,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_COINS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  reset(): void {
    this.coins = [];
    this.nextSpawnDist = 0;
    this.time = 0;
  }

  /**
   * Advance coins; returns how many were collected this frame.
   * playerZ decreases as the player drives forward (-Z).
   */
  update(dt: number, playerX: number, playerZ: number): number {
    this.time += dt;
    const playerDist = -playerZ;

    if (this.nextSpawnDist < playerDist + 40) {
      this.nextSpawnDist = playerDist + 40;
    }
    while (this.nextSpawnDist < playerDist + SPAWN_AHEAD) {
      if (this.coins.length < MAX_COINS) {
        const lane = Math.floor(Math.random() * GAME.LANES);
        this.coins.push({
          x: laneCenterX(lane),
          z: -this.nextSpawnDist,
          spin: Math.random() * Math.PI * 2,
          vx: 0,
          vz: 0,
        });
      }
      this.nextSpawnDist += GAME.COIN_SPAWN_EVERY_M;
    }

    let collected = 0;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      const dx = playerX - c.x;
      const dz = playerZ - c.z;
      const dist = Math.hypot(dx, dz);

      if (dist < COLLECT_RADIUS) {
        this.coins.splice(i, 1);
        collected++;
        continue;
      }
      if (c.z > playerZ + 15) {
        this.coins.splice(i, 1);
        continue;
      }

      // Magnet: accelerate toward the player when close.
      if (dist < MAGNET_RADIUS && dist > 0.001) {
        const pull = (1 - dist / MAGNET_RADIUS) * 26;
        c.vx += (dx / dist) * pull * dt;
        c.vz += (dz / dist) * pull * dt;
      }
      c.vx *= 1 - Math.min(1, 4 * dt);
      c.vz *= 1 - Math.min(1, 4 * dt);
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      c.spin += dt * 3.2;
    }

    // Write instance matrices.
    const n = Math.min(this.coins.length, MAX_COINS);
    for (let i = 0; i < n; i++) {
      const c = this.coins[i];
      dummy.position.set(c.x, 1.0 + Math.sin(this.time * 3 + c.spin) * 0.15, c.z);
      dummy.rotation.set(0, c.spin, 0);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;

    return collected;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
