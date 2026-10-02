/**
 * Hand Skeleton Overlay — renders live hand/finger skeletons during gameplay.
 *
 * Custom high-performance renderer (exceeds @mediapipe/drawing_utils for
 * game UI with holographic glow effects). Shows ONLY the hands — no camera feed.
 * Uses the per-index style pattern from drawing_utils for clean fingertip emphasis.
 */

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const FINGERTIPS = new Set([4, 8, 12, 16, 20]);

export interface SkeletonHand {
  landmarks: Array<{ x: number; y: number; z: number }>;
  label: 'Left' | 'Right';
  grip: boolean;
}

export class HandSkeletonOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible = true;
  private opacity = 0.95;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'hand-skeleton';
    this.canvas.style.cssText = `
      position: fixed; inset: 0; width: 100vw; height: 100vh;
      pointer-events: none; z-index: 25;
      mix-blend-mode: screen;
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

  draw(hands: SkeletonHand[]): void {
    if (!this.visible) return;
    const { ctx } = this;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    if (hands.length === 0) return;

    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const hand of hands) {
      const pts = hand.landmarks.map((lm) => ({
        x: (1 - lm.x) * w,
        y: lm.y * h,
      }));

      // Bones (reference spec: green [0,200,0], 2px, flat - no glow)
      ctx.strokeStyle = 'rgb(0, 200, 0)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        const pa = pts[a], pb = pts[b];
        if (!pa || !pb) continue;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();

      // Joints (reference spec: fingertips red 6px, others green 4px, flat)
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const isTip = FINGERTIPS.has(i);
        if (isTip) {
          ctx.fillStyle = '#ff0000';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = 'rgb(0, 200, 0)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Label
      const wrist = pts[0];
      if (wrist) {
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgb(0, 200, 0)';
        ctx.fillText(hand.label.toUpperCase(), wrist.x, wrist.y + 22);
      }
    }
    ctx.restore();
  }

  dispose(): void {
    this.canvas.remove();
  }
}
