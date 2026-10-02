/**
 * MR Spatial View — camera feed with holographic hand skeleton overlay.
 *
 * Matches the reference MR Spatial Computer: live camera background,
 * red fingertip dots, green skeleton bones, pinch distance readout.
 * This is the "what you see is what you get" tracking view.
 */
export class MRSpatialView {
  private container: HTMLElement;
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible = false;
  private stream: MediaStream | null = null;

  // Official MediaPipe hand topology
  private static readonly CONNECTIONS: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17],
  ];
  private static readonly FINGERTIPS = new Set([4, 8, 12, 16, 20]);

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'mr-spatial-view';
    this.container.style.cssText = `
      position: fixed; inset: 0; z-index: 40;
      display: none; background: #000;
    `;

    this.video = document.createElement('video');
    this.video.style.cssText = `
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: cover; transform: scaleX(-1);
    `;
    this.video.muted = true;
    this.video.playsInline = true;

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: absolute; inset: 0; width: 100%; height: 100%;
      pointer-events: none;
    `;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;

    this.container.appendChild(this.video);
    this.container.appendChild(this.canvas);
    document.body.appendChild(this.container);

    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  async show(): Promise<void> {
    this.visible = true;
    this.container.style.display = 'block';
    this.resize();
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      });
      this.video.srcObject = this.stream;
      await this.video.play();
    }
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /**
   * Draw the MR overlay: skeleton + fingertip dots + pinch readout.
   * Matches the reference: red dots on tips, green bones, "Pin 78.0" label.
   */
  draw(
    hands: Array<{
      landmarks: Array<{ x: number; y: number }>;
      label: string;
      pinchDistance: number;
    }>,
  ): void {
    if (!this.visible) return;
    const { ctx } = this;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const hand of hands) {
      const pts = hand.landmarks.map((lm) => ({
        x: (1 - lm.x) * w, // mirrored to match video
        y: lm.y * h,
      }));

      // Green skeleton bones (reference style)
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00ff00';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      for (const [a, b] of MRSpatialView.CONNECTIONS) {
        const pa = pts[a], pb = pts[b];
        if (!pa || !pb) continue;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Red fingertip dots (reference style) + smaller green joints
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const isTip = MRSpatialView.FINGERTIPS.has(i);
        if (isTip) {
          ctx.fillStyle = '#ff0000';
          ctx.shadowColor = '#ff0000';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          // White core
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#00ff00';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Pinch readout like "Pin 78.0" in reference
      const thumbTip = pts[4];
      const indexTip = pts[8];
      if (thumbTip && indexTip) {
        const mx = (thumbTip.x + indexTip.x) / 2;
        const my = (thumbTip.y + indexTip.y) / 2;
        const pinchPx = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);

        // Pinch line
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(thumbTip.x, thumbTip.y);
        ctx.lineTo(indexTip.x, indexTip.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.font = '700 14px monospace';
        ctx.textAlign = 'center';
        const label = `Pin ${pinchPx.toFixed(1)}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(mx - tw / 2 - 6, my - 28, tw + 12, 22);
        ctx.fillStyle = '#ffff00';
        ctx.fillText(label, mx, my - 12);

        // Hand label
        const wrist = pts[0];
        if (wrist) {
          ctx.font = '700 12px system-ui';
          ctx.fillStyle = '#00ff00';
          ctx.fillText(hand.label.toUpperCase(), wrist.x, wrist.y + 24);
        }
      }
    }
    ctx.restore();
  }

  dispose(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.container.remove();
  }
}
