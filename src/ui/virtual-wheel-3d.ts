/**
 * Virtual Steering Wheel — a 3D holographic wheel rendered in Three.js.
 *
 * The wheel rotates 1:1 with steering input. Hands grip it visually via
 * the skeleton overlay. Premium 3D look with metallic materials, emissive
 * glow, and smooth rotation.
 */
import * as THREE from 'three';

export class VirtualWheel3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private wheelGroup: THREE.Group;
  private rimMat: THREE.MeshStandardMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private gripL: THREE.Mesh;
  private gripR: THREE.Mesh;
  private container: HTMLElement;
  private lastAngle = 0;
  private visible = true;
  private steerLabel: HTMLElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'virtual-wheel-3d';
    this.container.style.cssText = `
      position: fixed; left: 50%; bottom: 12px;
      transform: translateX(-50%);
      width: 220px; height: 220px;
      pointer-events: none; z-index: 26;
    `;

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(220, 220);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 0, 8);
    this.camera.lookAt(0, 0, 0);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0x00e5ff, 1.2);
    dir.position.set(3, 4, 5);
    this.scene.add(dir);
    const rim = new THREE.DirectionalLight(0x7c4dff, 0.8);
    rim.position.set(-3, -2, 4);
    this.scene.add(rim);

    this.wheelGroup = new THREE.Group();
    this.scene.add(this.wheelGroup);

    // Rim: torus with metallic holographic material
    this.rimMat = new THREE.MeshStandardMaterial({
      color: 0x0a1628,
      metalness: 0.9,
      roughness: 0.25,
      emissive: 0x00e5ff,
      emissiveIntensity: 0.35,
    });
    const rimMesh = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.22, 16, 64),
      this.rimMat,
    );
    this.wheelGroup.add(rimMesh);

    // Neon strip on rim
    const neonMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const neon = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.06, 8, 64),
      neonMat,
    );
    neon.position.z = 0.18;
    this.wheelGroup.add(neon);

    // Spokes
    const spokeMat = new THREE.MeshStandardMaterial({
      color: 0x1a2a4a,
      metalness: 0.8,
      roughness: 0.3,
      emissive: 0x7c4dff,
      emissiveIntensity: 0.2,
    });
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 2.0, 0.18),
        spokeMat,
      );
      const angle = (i / 3) * Math.PI * 2;
      spoke.position.set(
        Math.sin(angle) * 1.1,
        -Math.cos(angle) * 1.1,
        0,
      );
      spoke.rotation.z = angle;
      this.wheelGroup.add(spoke);
    }

    // Hub
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.4, 32),
      new THREE.MeshStandardMaterial({
        color: 0x0a1628,
        metalness: 0.95,
        roughness: 0.2,
        emissive: 0x00e5ff,
        emissiveIntensity: 0.5,
      }),
    );
    hub.rotation.x = Math.PI / 2;
    this.wheelGroup.add(hub);

    // Center marker (12 o'clock)
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.5, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff2d78 }),
    );
    marker.position.set(0, 2.2, 0.15);
    this.wheelGroup.add(marker);

    // Glow ring behind wheel
    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(2.5, 2.9, 64),
      this.glowMat,
    );
    glow.position.z = -0.3;
    this.scene.add(glow);

    // Grip markers (spheres that track hands)
    const gripGeo = new THREE.SphereGeometry(0.22, 16, 16);
    this.gripL = new THREE.Mesh(
      gripGeo,
      new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0 }),
    );
    this.gripR = new THREE.Mesh(
      gripGeo,
      new THREE.MeshBasicMaterial({ color: 0xff2d78, transparent: true, opacity: 0 }),
    );
    this.scene.add(this.gripL, this.gripR);

    // Steering angle label
    this.steerLabel = document.createElement('div');
    this.steerLabel.style.cssText = `
      position: absolute; left: 50%; bottom: -4px;
      transform: translateX(-50%);
      font: 700 14px system-ui; color: #9ff3ff;
      text-shadow: 0 0 10px #00e5ff; white-space: nowrap;
    `;
    this.steerLabel.textContent = '0°';
    this.container.appendChild(this.steerLabel);

    document.body.appendChild(this.container);
    this.animate();
  }

  private animate = (): void => {
    if (!this.visible) return;
    requestAnimationFrame(this.animate);
    // Gentle idle rotation when not steering
    this.wheelGroup.rotation.z += (0 - this.wheelGroup.rotation.z) * 0.01;
    this.renderer.render(this.scene, this.camera);
  };

  setVisible(v: boolean): void {
    this.visible = v;
    this.container.style.display = v ? 'block' : 'none';
    if (v) this.animate();
  }

  update(
    steer: number,
    gripLocked: boolean,
    handL: { x: number; y: number } | null,
    handR: { x: number; y: number } | null,
  ): void {
    if (!this.visible) return;

    // Wheel rotates ±135° at full lock
    const targetAngle = -steer * (Math.PI * 0.75);
    this.lastAngle += (targetAngle - this.lastAngle) * 0.4;
    this.wheelGroup.rotation.z = this.lastAngle;
    this.steerLabel.textContent = `${Math.round(-this.lastAngle * 180 / Math.PI)}°`;

    // Glow intensity
    const targetOpacity = gripLocked ? 0.45 : 0.15;
    this.glowMat.opacity += (targetOpacity - this.glowMat.opacity) * 0.2;
    this.glowMat.color.set(gripLocked ? 0x00ff9d : 0x00e5ff);

    // Rim emissive boost on grip
    const targetEmissive = gripLocked ? 0.6 : 0.35;
    this.rimMat.emissiveIntensity += (targetEmissive - this.rimMat.emissiveIntensity) * 0.2;

    // Grip markers track hands on the rim
    this.placeGrip(this.gripL, handL);
    this.placeGrip(this.gripR, handR);
  }

  private placeGrip(mesh: THREE.Mesh, hand: { x: number; y: number } | null): void {
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (!hand) {
      mat.opacity = 0;
      return;
    }
    // Map hand position to wheel rim
    const dx = hand.x - 0.5;
    const dy = 0.5 - hand.y; // flip Y
    const angle = Math.atan2(dy, dx);
    const r = 2.2;
    mesh.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0.3);
    mat.opacity = 0.95;
  }

  dispose(): void {
    this.container.remove();
    this.renderer.dispose();
  }
}
