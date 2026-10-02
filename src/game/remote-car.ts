/**
 * RemoteCar — a ghost car for multiplayer opponents.
 *
 * Renders a simplified holographic car that interpolates toward the latest
 * network snapshots (100ms behind for smoothness).
 */
import * as THREE from 'three';
import type { CarSnapshot } from '../net/room.ts';

const INTERP_DELAY_MS = 100;

interface TimedSnapshot extends CarSnapshot {
  tRecv: number;
}

export class RemoteCar {
  readonly group = new THREE.Group();
  private snapshots: TimedSnapshot[] = [];
  private bodyMat: THREE.MeshStandardMaterial;

  constructor(color: number, playerName: string) {
    // Simplified car: body + cabin + glow
    this.bodyMat = new THREE.MeshStandardMaterial({
      color, roughness: 0.3, metalness: 0.7,
      emissive: color, emissiveIntensity: 0.25,
      transparent: true, opacity: 0.92,
    });
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.55, 3.6),
      this.bodyMat,
    );
    body.position.y = 0.55;
    this.group.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.5, 1.6),
      new THREE.MeshStandardMaterial({
        color: 0x0a0f1e, roughness: 0.1, metalness: 0.9,
      }),
    );
    cabin.position.set(0, 1.05, 0.3);
    this.group.add(cabin);

    // Name tag (sprite)
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '700 28px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 8;
    ctx.fillText(playerName.slice(0, 12), 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sprite.scale.set(4, 0.75, 1);
    sprite.position.y = 2.2;
    this.group.add(sprite);

    // Underglow
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 4.2),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.06;
    this.group.add(glow);
  }

  /** Add a network snapshot. */
  pushSnapshot(snap: CarSnapshot): void {
    this.snapshots.push({ ...snap, tRecv: performance.now() });
    // Keep only recent history
    const cutoff = performance.now() - 500;
    while (this.snapshots.length > 2 && this.snapshots[0].tRecv < cutoff) {
      this.snapshots.shift();
    }
  }

  /** Update interpolation. Call every frame. */
  update(): void {
    if (this.snapshots.length === 0) return;
    const renderTime = performance.now() - INTERP_DELAY_MS;

    // Find the two snapshots to interpolate between
    let a = this.snapshots[0];
    let b = this.snapshots[this.snapshots.length - 1];
    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (this.snapshots[i].tRecv <= renderTime && this.snapshots[i + 1].tRecv >= renderTime) {
        a = this.snapshots[i];
        b = this.snapshots[i + 1];
        break;
      }
    }

    const span = Math.max(1, b.tRecv - a.tRecv);
    const t = Math.min(1, Math.max(0, (renderTime - a.tRecv) / span));

    this.group.position.set(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t,
    );
    // Shortest-arc heading interpolation
    let dh = b.heading - a.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.group.rotation.y = a.heading + dh * t;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}
