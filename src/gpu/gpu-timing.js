// gpu-timing.js — Frame timing, rolling average, adaptive particle count controller

const WINDOW_SIZE = 60;       // frames for rolling average
const COOLDOWN_FRAMES = 120;  // frames between adaptive adjustments (2s)
const SCALE_DOWN = 0.9;       // reduce by 10%
const SCALE_UP = 1.05;        // increase by 5%
const MIN_PARTICLES = 1000;
const OVER_BUDGET = 1.1;      // scale down if avg > budget * 1.1
const UNDER_BUDGET = 0.7;     // scale up if avg < budget * 0.7

export class GpuTiming {
  #samples = [];
  #cooldown = 0;
  #budgetMs;
  #ceiling;
  #activeCount;
  #enabled;
  #lastFrameTime = 0;

  constructor(ceiling, enabled, targetFps = 60) {
    this.#ceiling = ceiling;
    this.#activeCount = ceiling;
    this.#enabled = enabled;
    this.#budgetMs = 1000 / targetFps;
    this.#lastFrameTime = performance.now();
  }

  get activeParticleCount() { return this.#activeCount; }

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

  /** Call once per frame after beginFrame. Returns true if active count changed. */
  update() {
    if (!this.#enabled) return false;
    if (this.#cooldown > 0) { this.#cooldown--; return false; }
    if (this.#samples.length < WINDOW_SIZE) return false;

    const avg = this.avgFrameTime;

    if (avg > this.#budgetMs * OVER_BUDGET) {
      const newCount = Math.max(Math.floor(this.#activeCount * SCALE_DOWN), MIN_PARTICLES);
      if (newCount < this.#activeCount) {
        console.log(`Adaptive: ${this.#activeCount} -> ${newCount} (avg ${avg.toFixed(1)}ms)`);
        this.#activeCount = newCount;
        this.#cooldown = COOLDOWN_FRAMES;
        return true;
      }
    } else if (avg < this.#budgetMs * UNDER_BUDGET && this.#activeCount < this.#ceiling) {
      const newCount = Math.min(Math.floor(this.#activeCount * SCALE_UP), this.#ceiling);
      if (newCount > this.#activeCount) {
        console.log(`Adaptive: ${this.#activeCount} -> ${newCount} (avg ${avg.toFixed(1)}ms)`);
        this.#activeCount = newCount;
        this.#cooldown = COOLDOWN_FRAMES;
        return true;
      }
    }
    return false;
  }

  /** Update ceiling when user changes particleCount config */
  setCeiling(n) {
    this.#ceiling = n;
    this.#activeCount = Math.min(this.#activeCount, n);
  }

  /** Toggle adaptive mode */
  setEnabled(on) {
    this.#enabled = on;
    if (!on) this.#activeCount = this.#ceiling;
  }
}
