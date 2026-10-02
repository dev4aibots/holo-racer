/**
 * Traffic manager: a pool of slower hologram cars ahead of the player.
 * Cars keep their lane with occasional lane changes; cars that fall
 * behind the player are recycled ahead.
 */
import * as THREE from 'three';
import { GAME } from '../config.ts';
import { buildHologramCar } from './vehicles.ts';
import { laneCenterX } from './tracks.ts';

const MAX_CARS = 14;
const COLORS = [0xff2d78, 0xffb300, 0x7cff00, 0xb14bff, 0xff6b2d, 0x4dd2ff];

export interface TrafficCollider {
  x: number;
  z: number;
}

interface TrafficCar {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  lane: number;
  targetLane: number;
  z: number;
  speed: number;
  changeT: number;
}

export class TrafficManager {
  private cars: TrafficCar[] = [];
  private colliders: TrafficCollider[] = [];

  constructor(private scene: THREE.Scene) {}

  /** Remove all cars; they respawn on the next update. */
  reset(): void {
    for (const car of this.cars) this.scene.remove(car.group);
    this.cars = [];
    this.colliders = [];
  }

  private spawnCar(playerZ: number, minAhead: number, maxAhead: number): void {
    const lane = Math.floor(Math.random() * GAME.LANES);
    const z = playerZ - (minAhead + Math.random() * (maxAhead - minAhead));
    // Avoid stacking two cars in the same lane.
    for (const c of this.cars) {
      if (c.lane === lane && Math.abs(c.z - z) < 30) return;
    }
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const group = buildHologramCar(color);
    const speed = 14 + Math.random() * 14; // slower than the player
    group.position.set(laneCenterX(lane), 0, z);
    this.scene.add(group);
    const collider: TrafficCollider = { x: laneCenterX(lane), z };
    this.colliders.push(collider);
    this.cars.push({
      group,
      wheels: group.userData.wheels as THREE.Mesh[],
      lane,
      targetLane: lane,
      z,
      speed,
      changeT: 2 + Math.random() * 5,
    });
  }

  update(dt: number, playerZ: number, _playerSpeed: number): void {
    const target = Math.max(4, Math.round(MAX_CARS * GAME.TRAFFIC_DENSITY));
    let guard = 0;
    while (this.cars.length < target && guard++ < 8) {
      this.spawnCar(playerZ, 120, 380);
    }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      car.z -= car.speed * dt;

      // Occasional lane change.
      car.changeT -= dt;
      if (car.changeT <= 0) {
        car.changeT = 3 + Math.random() * 5;
        const dir = Math.random() < 0.5 ? -1 : 1;
        const next = car.targetLane + dir;
        if (next >= 0 && next < GAME.LANES) car.targetLane = next;
      }
      car.lane = car.targetLane;
      const tx = laneCenterX(car.targetLane);
      const x = car.group.position.x + THREE.MathUtils.clamp(tx - car.group.position.x, -2.4 * dt, 2.4 * dt);
      car.group.position.set(x, 0, car.z);
      car.group.rotation.y = THREE.MathUtils.clamp((tx - x) * -0.12, -0.2, 0.2);

      for (const w of car.wheels) w.rotation.x += (car.speed * dt) / 0.34;

      // Recycle cars that fell behind the player.
      if (car.z > playerZ + 40) {
        this.scene.remove(car.group);
        this.cars.splice(i, 1);
        this.colliders.splice(i, 1);
        continue;
      }
      const col = this.colliders[i];
      col.x = x;
      col.z = car.z;
    }
  }

  /** Reused collider list for AABB checks (do not retain). */
  getCars(): TrafficCollider[] {
    return this.colliders;
  }
}
