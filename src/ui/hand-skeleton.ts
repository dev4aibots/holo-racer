/**
 * Hand Skeleton Overlay — renders live hand/finger skeletons during gameplay.
 *
 * Shows ONLY the hands (21 landmarks + connections per hand) as holographic
 * skeletons. No camera feed. This gives the player visual feedback of their
 * finger tracking while keeping the screen focused on the game.
 */

const CONNECTIONS: Array<[number, number]> = [
  // Wrist to finger bases
  [0, 1], [0, 5], [0, 9], [0, 13], [0, 17],
  // Thumb
  [1, 2], [2, 3], [3, 4],
  // Index
  [5, 6], [6, 7], [7, 8],
  // Middle
  [9, 10], [10, 11], [11, 12],
  // Ring
  [13, 14], [14, 15], [15, 16],
  // Pinky
  [17, 18], [18, 19], [19, 20],
  // Knuckle arc
  [5, 9], [9, 13], [13, 17],
];

export interface SkeletonHand {
  landmarks: Array<{ x: number; y: number; z: number }>;
  label: 'Left' | 'Right';
  grip: boolean;
}

export class HandSkeletonOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible = true;
  private opacity = 0.9;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'hand-skeleton';
    this.canvas.style.cssText = `
      position: fixed; inset: 0; width: 100vw; height: 100vh;
      pointer-events: none; z-index: 25;
    `;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.body.appendChild(this.canvas);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.canvas.style.display = v ? 'block' : 'none';
  }

  setOpacity(o: number): void {
    this.opacity = Math.max(0, Math.min(1, o));
  }

  /**
   * Draw hand skeletons. Landmarks are in normalized camera coords
   * (0-1, origin top-left). The view is mirrored for a natural feel.
   */
  draw(hands: SkeletonHand[]): void {
    if (!this.visible) return;
    const { ctx } = this;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    if (hands.length === 0) return;

    ctx.save();
    ctx.globalAlpha = this.opacity;

    for (const hand of hands) {
      const pts = hand.landmarks.map((lm) => ({
        x: (1 - lm.x) * w, // mirror
        y: lm.y * h,
        z: lm.z,
      }));

      const hue = hand.label === 'Left' ? 190 : 310; // cyan / magenta
      const gripGlow = hand.grip ? 1 : 0.55;

      // Bones
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const [a, b] of CONNECTIONS) {
        const pa = pts[a];
        const pb = pts[b];
        if (!pa || !pb) continue;
        const grad = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
        grad.addColorStop(0, `hsla(${hue}, 100%, 65%, ${0.85 * gripGlow})`);
        grad.addColorStop(1, `hsla(${hue + 20}, 100%, 55%, ${0.85 * gripGlow})`);
        ctx.strokeStyle = grad;
        ctx.shadowColor = `hsla(${hue}, 100%, 60%, 0.8)`;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // Joints
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
        const r = isTip ? 5 : 3;
        ctx.fillStyle = isTip
          ? `hsla(${hue}, 100%, 75%, ${gripGlow})`
          : `hsla(${hue}, 90%, 60%, ${0.7 * gripGlow})`;
        ctx.shadowColor = `hsla(${hue}, 100%, 65%, 0.9)`;
        ctx.shadowBlur = isTip ? 12 : 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Wrist label
      const wrist = pts[0];
      if (wrist) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.9)`;
        ctx.textAlign = 'center';
        ctx.fillText(hand.label.toUpperCase(), wrist.x, wrist.y + 22);
      }
    }
    ctx.restore();
  }

  dispose(): void {
    this.canvas.remove();
  }
}
