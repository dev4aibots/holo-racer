/**
 * Hand Skeleton Overlay — renders live hand/finger skeletons during gameplay.
 *
 * Uses the official @mediapipe/drawing_utils (the same library Google uses
 * in all MediaPipe demos) for production-quality rendering. Shows ONLY the
 * hands as holographic skeletons — no camera feed.
 */
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';

// Official MediaPipe hand topology (21 landmarks)
const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
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
  private opacity = 0.95;

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
   * Draw hand skeletons using MediaPipe's official drawing utils.
   * Landmarks are in normalized camera coords (0-1). View is mirrored.
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
      // Mirror X for natural view, convert to pixel coords for drawing utils
      const pts = hand.landmarks.map((lm) => ({
        x: 1 - lm.x,
        y: lm.y,
        z: lm.z,
      }));

      const isLeft = hand.label === 'Left';
      const baseHue = isLeft ? 190 : 310;
      const gripBoost = hand.grip ? 1 : 0.6;

      // Bones — using official HAND_CONNECTIONS topology
      drawConnectors(ctx, pts, HAND_CONNECTIONS, {
        color: `hsla(${baseHue}, 100%, 60%, ${0.9 * gripBoost})`,
        lineWidth: 4,
      });

      // Joints — fingertips larger and brighter
      drawLandmarks(ctx, pts, {
        color: (data: { index?: number }) => {
          const idx = data.index ?? 0;
          const isTip = idx === 4 || idx === 8 || idx === 12 || idx === 16 || idx === 20;
          return isTip
            ? `hsla(${baseHue}, 100%, 75%, ${gripBoost})`
            : `hsla(${baseHue}, 90%, 55%, ${0.75 * gripBoost})`;
        },
        lineWidth: 2,
        radius: (data: { index?: number }) => {
          const idx = data.index ?? 0;
          const isTip = idx === 4 || idx === 8 || idx === 12 || idx === 16 || idx === 20;
          return isTip ? 6 : 3;
        },
      });

      // Holographic glow pass — draw again with shadow for the glow effect
      ctx.save();
      ctx.shadowColor = `hsla(${baseHue}, 100%, 60%, 0.8)`;
      ctx.shadowBlur = 12;
      drawConnectors(ctx, pts, HAND_CONNECTIONS, {
        color: `hsla(${baseHue}, 100%, 65%, ${0.35 * gripBoost})`,
        lineWidth: 6,
      });
      ctx.restore();

      // Label
      const wrist = pts[0];
      if (wrist) {
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.fillStyle = `hsla(${baseHue}, 100%, 75%, 0.95)`;
        ctx.textAlign = 'center';
        ctx.shadowColor = `hsla(${baseHue}, 100%, 60%, 0.8)`;
        ctx.shadowBlur = 8;
        ctx.fillText(hand.label.toUpperCase(), wrist.x * w, wrist.y * h + 24);
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }

  dispose(): void {
    this.canvas.remove();
  }
}
