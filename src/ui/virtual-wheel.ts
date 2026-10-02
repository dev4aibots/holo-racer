/**
 * Virtual Steering Wheel — a visible wheel the player grips with their hands.
 *
 * The wheel rotates 1:1 with the steering input (from hand rotation + lateral
 * movement). Grip markers show where each hand holds the rim. This makes
 * steering a physical interaction with a visible control, not a blind gesture.
 */

export class VirtualWheel {
  private root: HTMLElement;
  private rimGroup: SVGGElement;
  private gripL: SVGCircleElement;
  private gripR: SVGCircleElement;
  private glowRing: SVGCircleElement;
  private steerLabel: HTMLElement;
  private lastAngle = 0;
  private visible = true;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'virtual-wheel';
    this.root.style.cssText = `
      position: fixed; left: 50%; bottom: 18px;
      transform: translateX(-50%);
      width: 190px; height: 190px;
      pointer-events: none; z-index: 26;
      transition: opacity 0.3s;
    `;
    this.root.innerHTML = `
      <svg viewBox="0 0 200 200" width="190" height="190">
        <defs>
          <filter id="wheel-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="rim-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#00e5ff"/>
            <stop offset="1" stop-color="#7c4dff"/>
          </linearGradient>
        </defs>
        <circle id="wheel-glow-ring" cx="100" cy="100" r="88" fill="none"
          stroke="#00e5ff" stroke-width="2" opacity="0.25" filter="url(#wheel-glow)"/>
        <g id="wheel-rotor">
          <circle cx="100" cy="100" r="78" fill="rgba(8,12,28,0.55)"
            stroke="url(#rim-grad)" stroke-width="10" filter="url(#wheel-glow)"/>
          <circle cx="100" cy="100" r="78" fill="none"
            stroke="#ffffff" stroke-width="2" opacity="0.25"/>
          <!-- spokes -->
          <rect x="96" y="100" width="8" height="72" rx="4" fill="url(#rim-grad)" opacity="0.9"/>
          <rect x="28" y="96" width="72" height="8" rx="4" fill="url(#rim-grad)" opacity="0.9"
            transform="rotate(35 100 100)"/>
          <rect x="100" y="96" width="72" height="8" rx="4" fill="url(#rim-grad)" opacity="0.9"
            transform="rotate(-35 100 100)"/>
          <!-- hub -->
          <circle cx="100" cy="100" r="26" fill="rgba(10,16,36,0.9)"
            stroke="#00e5ff" stroke-width="3" filter="url(#wheel-glow)"/>
          <text x="100" y="107" text-anchor="middle" fill="#00e5ff"
            font-size="16" font-weight="700" font-family="system-ui">HR</text>
          <!-- center marker (12 o'clock) -->
          <rect x="97" y="16" width="6" height="18" rx="3" fill="#ff2d78"/>
        </g>
        <circle id="grip-l" cx="45" cy="75" r="10" fill="#00e5ff" opacity="0"
          filter="url(#wheel-glow)"/>
        <circle id="grip-r" cx="155" cy="75" r="10" fill="#ff2d78" opacity="0"
          filter="url(#wheel-glow)"/>
      </svg>
      <div id="wheel-steer-label" style="
        position:absolute; left:50%; top:50%; transform:translate(-50%,140%);
        font:700 13px system-ui; color:#9ff3ff; text-shadow:0 0 8px #00e5ff;
        white-space:nowrap;">0°</div>
    `;
    document.body.appendChild(this.root);
    const svg = this.root.querySelector('svg') as SVGSVGElement;
    this.rimGroup = svg.querySelector('#wheel-rotor') as unknown as SVGGElement;
    this.gripL = svg.querySelector('#grip-l') as unknown as SVGCircleElement;
    this.gripR = svg.querySelector('#grip-r') as unknown as SVGCircleElement;
    this.glowRing = svg.querySelector('#wheel-glow-ring') as unknown as SVGCircleElement;
    this.steerLabel = this.root.querySelector('#wheel-steer-label') as HTMLElement;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.opacity = v ? '1' : '0';
  }

  /**
   * Update the wheel.
   * @param steer -1..1 steering input
   * @param gripLocked whether both fists are gripping
   * @param handL handR normalized positions (mirrored already) or null
   */
  update(
    steer: number,
    gripLocked: boolean,
    handL: { x: number; y: number } | null,
    handR: { x: number; y: number } | null,
  ): void {
    if (!this.visible) return;
    // Wheel rotates up to ±135° at full lock — feels like a real wheel.
    const targetAngle = steer * 135;
    // Fast smoothing: wheel must feel glued to the hands.
    this.lastAngle += (targetAngle - this.lastAngle) * 0.35;
    this.rimGroup.setAttribute(
      'transform', `rotate(${this.lastAngle.toFixed(1)} 100 100)`,
    );
    this.steerLabel.textContent = `${Math.round(this.lastAngle)}°`;

    // Glow ring intensity reflects grip.
    this.glowRing.setAttribute('opacity', gripLocked ? '0.85' : '0.25');
    this.glowRing.setAttribute(
      'stroke', gripLocked ? '#00ff9d' : '#00e5ff',
    );

    // Grip markers track the hands on the rim.
    this.placeGrip(this.gripL, handL, '#00e5ff');
    this.placeGrip(this.gripR, handR, '#ff2d78');
  }

  private placeGrip(
    el: SVGCircleElement,
    hand: { x: number; y: number } | null,
    color: string,
  ): void {
    if (!hand) {
      el.setAttribute('opacity', '0');
      return;
    }
    // Map the hand's camera position onto the wheel face.
    // Camera coords are mirrored already; wheel center = screen bottom-center.
    // We place the marker on the rim at the angle toward the hand.
    const dx = hand.x - 0.5; // -0.5..0.5
    const dy = hand.y - 0.75; // hands are usually above wheel (y < 0.75)
    const ang = Math.atan2(dy, dx);
    const rx = 100 + Math.cos(ang) * 78;
    const ry = 100 + Math.sin(ang) * 78;
    el.setAttribute('cx', rx.toFixed(1));
    el.setAttribute('cy', ry.toFixed(1));
    el.setAttribute('opacity', '0.95');
    el.setAttribute('fill', color);
  }

  dispose(): void {
    this.root.remove();
  }
}
