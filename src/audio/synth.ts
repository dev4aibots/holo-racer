/**
 * AudioEngine — 100% synthesized WebAudio sound for holo-racer.
 *
 * Zero audio assets: every sound is generated with stable WebAudio nodes
 * (OscillatorNode, GainNode, BiquadFilterNode, AudioBufferSourceNode).
 *
 * Lifecycle:
 *   const audio = new AudioEngine();      // creates nothing
 *   await audio.init();                   // from a user gesture
 *   audio.setEngine(speed01, throttle01); // every frame
 *   ...
 *   audio.dispose();
 *
 * Every method is a safe no-op before init() completes.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sawOsc: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private initPromise: Promise<void> | null = null;
  private muted = false;

  constructor() {
    // Intentionally empty: all AudioContext setup happens in init().
  }

  /**
   * Create the AudioContext, master chain, engine hum nodes and noise
   * buffer. Must be called from a user gesture so the context can start.
   * Idempotent: concurrent or repeated calls share one setup promise.
   */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async (): Promise<void> => {
      try {
        await this.doInit();
      } catch (err) {
        // Allow a later retry instead of caching the failure.
        if (this.initPromise !== null) this.initPromise = null;
        throw err;
      }
    })();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const ctx = new AudioContext();

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER_LEVEL;
    master.connect(ctx.destination);

    // Persistent engine hum: sawtooth + sub sine (one octave down),
    // shaped by a lowpass filter and an engine gain stage.
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = ENGINE_BASE_HZ;

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = ENGINE_BASE_HZ / 2;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = ENGINE_FILTER_BASE_HZ;
    filter.Q.value = 0.8;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0; // ramped up by setEngine; avoids a startup pop

    saw.connect(filter);
    sub.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(master);
    saw.start();
    sub.start();

    // One second of white noise, reused by crash().
    const len = Math.max(1, Math.floor(ctx.sampleRate));
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = Math.random() * 2 - 1;
    }

    // We were asked to init from a user gesture, so try to un-suspend.
    // resume() can hang forever when the output device can't start
    // (no audio hardware, blocked autoplay) — never block the game on it.
    if (ctx.state === 'suspended') {
      await Promise.race([
        ctx.resume(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }

    this.ctx = ctx;
    this.master = master;
    this.sawOsc = saw;
    this.subOsc = sub;
    this.engineFilter = filter;
    this.engineGain = engineGain;
    this.noiseBuffer = noise;
  }

  /** Mute (master gain 0) or unmute (restore master level). Safe pre-init. */
  setMuted(m: boolean): void {
    this.muted = m;
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(m ? 0 : MASTER_LEVEL, ctx.currentTime, 0.02);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Update the engine hum. Called every frame; performs no allocations —
   * it only re-targets the persistent oscillators/filter/gain with
   * setTargetAtTime smoothing.
   */
  setEngine(speed01: number, throttle01: number): void {
    const ctx = this.ctx;
    const saw = this.sawOsc;
    const sub = this.subOsc;
    const filter = this.engineFilter;
    const gain = this.engineGain;
    if (!ctx || !saw || !sub || !filter || !gain) return;

    const speed = clamp01(speed01);
    const throttle = clamp01(throttle01);
    const t = ctx.currentTime;

    const sawHz = ENGINE_BASE_HZ + speed * ENGINE_RANGE_HZ;
    saw.frequency.setTargetAtTime(sawHz, t, ENGINE_TC);
    sub.frequency.setTargetAtTime(sawHz / 2, t, ENGINE_TC);
    filter.frequency.setTargetAtTime(ENGINE_FILTER_BASE_HZ + speed * ENGINE_FILTER_RANGE_HZ, t, ENGINE_TC);
    gain.gain.setTargetAtTime(ENGINE_IDLE_GAIN + throttle * ENGINE_THROTTLE_GAIN, t, ENGINE_TC);
  }

  /** Bright two-tone pickup blip: sine E6 -> B6, ~0.12s. */
  coin(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1318.51, t); // E6
    osc.frequency.setValueAtTime(1975.53, t + 0.06); // B6

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  /** Filtered noise burst plus a low thump, ~0.3s. */
  crash(): void {
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noiseBuffer;
    if (!ctx || !master || !noise) return;
    const t = ctx.currentTime;

    // Noise burst with a downward-sweeping lowpass.
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2500, t);
    filter.frequency.exponentialRampToValueAtTime(150, t + 0.3);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(filter);
    filter.connect(ng);
    ng.connect(master);
    src.start(t);
    src.stop(t + 0.32);

    // Low thump: sine dropping 70Hz -> 35Hz.
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(70, t);
    thump.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.6, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    thump.connect(tg);
    tg.connect(master);
    thump.start(t);
    thump.stop(t + 0.32);
  }

  /** Short UI square-wave blip. */
  click(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1400, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  /**
   * Countdown beep. n > 0: 440Hz tick; n === 0 ("GO"): 880Hz, longer.
   */
  countdown(n: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;

    const isGo = n === 0;
    const dur = isGo ? 0.4 : 0.12;

    const osc = ctx.createOscillator();
    osc.type = isGo ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Suspend the AudioContext (e.g. on pause). Safe pre-init. */
  pause(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    void ctx.suspend().catch(() => undefined);
  }

  /** Resume the AudioContext after pause(). Safe pre-init. */
  resume(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    void ctx.resume().catch(() => undefined);
  }

  /**
   * Stop the engine oscillators, close the context and drop all
   * references. Safe to call twice; init() may be called again after.
   */
  dispose(): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.drop();
      return;
    }
    try {
      this.sawOsc?.stop();
    } catch {
      // Already stopped — nothing to do.
    }
    try {
      this.subOsc?.stop();
    } catch {
      // Already stopped — nothing to do.
    }
    void ctx.close().catch(() => undefined);
    this.drop();
  }

  private drop(): void {
    this.ctx = null;
    this.master = null;
    this.sawOsc = null;
    this.subOsc = null;
    this.engineFilter = null;
    this.engineGain = null;
    this.noiseBuffer = null;
    this.initPromise = null;
  }
}

const MASTER_LEVEL = 0.6;
const ENGINE_BASE_HZ = 60;
const ENGINE_RANGE_HZ = 160;
const ENGINE_FILTER_BASE_HZ = 300;
const ENGINE_FILTER_RANGE_HZ = 1200;
const ENGINE_IDLE_GAIN = 0.03;
const ENGINE_THROTTLE_GAIN = 0.25;
const ENGINE_TC = 0.06;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
