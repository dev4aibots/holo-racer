/**
 * World: scene dressing owned by the game — fog, sky gradient dome,
 * hemisphere + directional lighting, ground plane, and 3 recycled
 * road segments with baked lane markings.
 */
import * as THREE from 'three';
import { GAME } from '../config.ts';

export type TrackVariant = 'neon-city' | 'coast';

const SEG_LEN = 150;
const SEG_COUNT = 3;
const ROAD_WIDTH = GAME.LANES * GAME.LANE_WIDTH + 5.6; // lanes + shoulders

function makeRoadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#15171e';
  g.fillRect(0, 0, 256, 256);
  // Subtle asphalt noise.
  for (let i = 0; i < 500; i++) {
    const v = 18 + Math.random() * 14;
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // Solid edge lines.
  g.fillStyle = '#dfeefb';
  g.fillRect(9, 0, 5, 256);
  g.fillRect(242, 0, 5, 256);
  // Dashed lane dividers for 4 lanes.
  g.fillStyle = '#8fa3b8';
  for (const x of [67, 128, 189]) {
    for (let y = 0; y < 256; y += 64) {
      g.fillRect(x - 2, y, 4, 32);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 6); // one tile = 25 m
  tex.anisotropy = 4;
  return tex;
}

function makeSkyTexture(top: string, mid: string, horizon: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, top);
  grad.addColorStop(0.55, mid);
  grad.addColorStop(0.82, horizon);
  grad.addColorStop(1, horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class World {
  private roadSegs: THREE.Group[] = [];
  private strips: THREE.Mesh[] = [];
  private ground!: THREE.Mesh;
  private groundMat!: THREE.MeshStandardMaterial;
  private sky!: THREE.Mesh;
  private skyMat!: THREE.MeshBasicMaterial;
  private skyNeon!: THREE.CanvasTexture;
  private skyCoast!: THREE.CanvasTexture;
  private hemi!: THREE.HemisphereLight;
  private dir!: THREE.DirectionalLight;
  private disposables: { dispose(): void }[] = [];

  constructor(private scene: THREE.Scene) {
    // Lights.
    this.hemi = new THREE.HemisphereLight(0x4a5aa8, 0x0a0c18, 0.75);
    this.dir = new THREE.DirectionalLight(0xff9a5c, 0.9);
    this.dir.position.set(30, 45, 25);
    scene.add(this.hemi, this.dir);

    // Sky dome (follows player; unaffected by fog).
    this.skyNeon = makeSkyTexture('#04060e', '#1b2a5e', '#c65a2e');
    this.skyCoast = makeSkyTexture('#2f7fd0', '#7db9e8', '#d8f0ff');
    const skyGeo = new THREE.SphereGeometry(650, 24, 16);
    this.skyMat = new THREE.MeshBasicMaterial({
      map: this.skyNeon,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.disposables.push(skyGeo, this.skyMat, this.skyNeon, this.skyCoast);

    // Ground plane (repositioned to follow the player).
    const groundGeo = new THREE.PlaneGeometry(600, 800);
    groundGeo.rotateX(-Math.PI / 2);
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x070912, roughness: 1 });
    this.ground = new THREE.Mesh(groundGeo, this.groundMat);
    this.ground.position.y = -0.08;
    scene.add(this.ground);
    this.disposables.push(groundGeo, this.groundMat);

    // Road segments.
    const roadTex = makeRoadTexture();
    const roadGeo = new THREE.PlaneGeometry(ROAD_WIDTH, SEG_LEN);
    roadGeo.rotateX(-Math.PI / 2);
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 });
    const stripGeo = new THREE.PlaneGeometry(0.35, SEG_LEN);
    stripGeo.rotateX(-Math.PI / 2);
    const stripMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(roadTex, roadGeo, roadMat, stripGeo, stripMat);

    for (let i = 0; i < SEG_COUNT; i++) {
      const seg = new THREE.Group();
      const road = new THREE.Mesh(roadGeo, roadMat);
      road.position.y = 0;
      seg.add(road);
      for (const sx of [-1, 1]) {
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(sx * (GAME.LANES * GAME.LANE_WIDTH) / 2 + sx * 0.6, 0.02, 0);
        seg.add(strip);
        this.strips.push(strip);
      }
      seg.position.z = 60 - i * SEG_LEN;
      scene.add(seg);
      this.roadSegs.push(seg);
    }

    this.setVariant('neon-city');
  }

  setVariant(v: TrackVariant): void {
    if (v === 'neon-city') {
      this.scene.fog = new THREE.Fog(0x0b1030, 45, 260);
      this.scene.background = new THREE.Color(0x0b1030);
      this.skyMat.map = this.skyNeon;
      this.hemi.color.set(0x4a5aa8);
      this.hemi.groundColor.set(0x0a0c18);
      this.hemi.intensity = 0.75;
      this.dir.color.set(0xff9a5c);
      this.dir.intensity = 0.9;
      this.groundMat.color.set(0x070912);
      for (const s of this.strips) s.visible = true;
    } else {
      this.scene.fog = new THREE.Fog(0xcfe8f7, 60, 340);
      this.scene.background = new THREE.Color(0xcfe8f7);
      this.skyMat.map = this.skyCoast;
      this.hemi.color.set(0xbfe3ff);
      this.hemi.groundColor.set(0x9a8a6a);
      this.hemi.intensity = 1.15;
      this.dir.color.set(0xfff2d8);
      this.dir.intensity = 1.5;
      this.groundMat.color.set(0xcbb37e);
      for (const s of this.strips) s.visible = false;
    }
    this.skyMat.needsUpdate = true;
  }

  /** Recycle road segments and follow the player with ground + sky. */
  update(playerZ: number): void {
    for (const seg of this.roadSegs) {
      if (seg.position.z - SEG_LEN / 2 > playerZ + 60) {
        seg.position.z -= SEG_LEN * SEG_COUNT;
      }
    }
    this.ground.position.z = playerZ - 260;
    this.sky.position.set(0, 0, playerZ - 150);
  }

  dispose(): void {
    for (const seg of this.roadSegs) this.scene.remove(seg);
    this.scene.remove(this.ground, this.sky, this.hemi, this.dir);
    for (const d of this.disposables) d.dispose();
    this.roadSegs = [];
    this.strips = [];
  }
}
