// gpu-timing.js — Frame timing, rolling average, adaptive particle count controller

const WINDOW_SIZE = 60;       // frames for rolling average
const COOLDOWN_FRAMES = 120;  // frames between adaptive adjustments (2s)
const SCALE_DOWN = 0.9;       // reduce by 10%
const SCALE_UP = 1.05;        // increase by 5%
const MIN_PARTICLES = 1000;
const OVER_BUDGET = 1.1;      // scale down if avg > budget * 1.1
const UNDER_BUDGET = 0.7;     // scale up if avg < budget * 0.7
const LERP_RATE = 0.02;       // ~60 frames to converge (2% per frame)

export class GpuTiming {
  #samples = [];
  #cooldown = 0;
  #budgetMs;
  #ceiling;
  #targetCount;
  #displayCount;
  #enabled;
  #lastFrameTime = 0;

  constructor(ceiling, enabled, targetFps = 60) {
    this.#ceiling = ceiling;
    this.#targetCount = ceiling;
    this.#displayCount = ceiling;
    this.#enabled = enabled;
    this.#budgetMs = 1000 / targetFps;
    this.#lastFrameTime = performance.now();
  }

  get activeParticleCount() { return Math.round(this.#displayCount); }

  get avgFrameTime() {
    if (this.#samples.length === 0) return 0;
    return this.#samples.reduce((a, b) => a + b) / this.#samples.length;
  }

  get fps() {
    const avg = this.avgFrameTime;
    return avg > 0 ? 1000 / avg : 0;
  }

  /** Call at the start of each frame to measure frame-to-frame timing */
  beginFrame() {
    const now = performance.now();
    if (this.#lastFrameTime > 0) {
      const dt = now - this.#lastFrameTime;
      this.#samples.push(dt);
      if (this.#samples.length > WINDOW_SIZE) this.#samples.shift();
    }
    this.#lastFrameTime = now;
  }

  /** Call once per frame after beginFrame. Lerps display count toward target. */
  update() {
    // Smooth transition: lerp displayCount toward targetCount
    if (Math.abs(this.#displayCount - this.#targetCount) > 1) {
      this.#displayCount += (this.#targetCount - this.#displayCount) * LERP_RATE;
    } else {
      this.#displayCount = this.#targetCount;
    }

    if (!this.#enabled) return;
    if (this.#cooldown > 0) { this.#cooldown--; return; }
    if (this.#samples.length < WINDOW_SIZE) return;

    const avg = this.avgFrameTime;

    if (avg > this.#budgetMs * OVER_BUDGET) {
      const newCount = Math.max(Math.floor(this.#targetCount * SCALE_DOWN), MIN_PARTICLES);
      if (newCount < this.#targetCount) {
        console.log(`Adaptive: ${this.#targetCount} -> ${newCount} (avg ${avg.toFixed(1)}ms)`);
        this.#targetCount = newCount;
        this.#cooldown = COOLDOWN_FRAMES;
      }
    } else if (avg < this.#budgetMs * UNDER_BUDGET && this.#targetCount < this.#ceiling) {
      const newCount = Math.min(Math.floor(this.#targetCount * SCALE_UP), this.#ceiling);
      if (newCount > this.#targetCount) {
        console.log(`Adaptive: ${this.#targetCount} -> ${newCount} (avg ${avg.toFixed(1)}ms)`);
        this.#targetCount = newCount;
        this.#cooldown = COOLDOWN_FRAMES;
      }
    }
  }

  /** Update ceiling when user changes particleCount config */
  setCeiling(n) {
    this.#ceiling = n;
    this.#targetCount = Math.min(this.#targetCount, n);
    this.#displayCount = Math.min(this.#displayCount, n);
  }

  /** Toggle adaptive mode */
  setEnabled(on) {
    this.#enabled = on;
    if (!on) {
      this.#targetCount = this.#ceiling;
      this.#displayCount = this.#ceiling;
    }
  }
}
