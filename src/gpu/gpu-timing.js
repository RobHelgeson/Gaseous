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

// --- Per-pass GPU timestamp profiling ---

const PASS_NAMES = [
  'clear_bins', 'count_bins', 'prefix_sum', 'sort',
  'density', 'forces', 'integrate', 'render_total',
];
const TIMESTAMP_COUNT = PASS_NAMES.length * 2; // begin + end per pass
const READBACK_SMOOTHING = 0.9; // EMA alpha for smoothing timings

export class GpuPassTimer {
  #device;
  #querySet = null;
  #resolveBuffer = null;
  #readbackBuffer = null;
  #readbackAvailable = true;
  #enabled = false;
  /** @type {Map<string, number>} smoothed pass durations in ms */
  #timings = new Map();
  #timestampPeriod = 1;

  constructor(device, hasTimestampQuery) {
    this.#device = device;
    if (!hasTimestampQuery) return;

    this.#enabled = true;
    this.#querySet = device.createQuerySet({
      type: 'timestamp',
      count: TIMESTAMP_COUNT,
    });
    this.#resolveBuffer = device.createBuffer({
      label: 'timestamp-resolve',
      size: TIMESTAMP_COUNT * 8, // 8 bytes per u64 timestamp
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.#readbackBuffer = device.createBuffer({
      label: 'timestamp-readback',
      size: TIMESTAMP_COUNT * 8,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Initialize smoothed timings to 0
    for (const name of PASS_NAMES) {
      this.#timings.set(name, 0);
    }
  }

  get enabled() { return this.#enabled; }

  /** Get timestamp writes descriptor for a compute/render pass */
  getTimestampWrites(passIndex) {
    if (!this.#enabled) return undefined;
    return {
      querySet: this.#querySet,
      beginningOfPassWriteIndex: passIndex * 2,
      endOfPassWriteIndex: passIndex * 2 + 1,
    };
  }

  /** Pass index by name */
  passIndex(name) {
    return PASS_NAMES.indexOf(name);
  }

  /** Resolve timestamps and copy to readback buffer after encoding all passes */
  resolve(encoder) {
    if (!this.#enabled) return;
    encoder.resolveQuerySet(this.#querySet, 0, TIMESTAMP_COUNT, this.#resolveBuffer, 0);
    encoder.copyBufferToBuffer(
      this.#resolveBuffer, 0,
      this.#readbackBuffer, 0,
      TIMESTAMP_COUNT * 8,
    );
  }

  /** Non-blocking async readback of timestamp data */
  readback() {
    if (!this.#enabled || !this.#readbackAvailable) return;
    this.#readbackAvailable = false;

    this.#readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
      const data = new BigInt64Array(this.#readbackBuffer.getMappedRange());
      for (let i = 0; i < PASS_NAMES.length; i++) {
        const begin = data[i * 2];
        const end = data[i * 2 + 1];
        if (end > begin) {
          const durationNs = Number(end - begin);
          const durationMs = durationNs / 1_000_000;
          const prev = this.#timings.get(PASS_NAMES[i]) || 0;
          this.#timings.set(PASS_NAMES[i],
            prev * READBACK_SMOOTHING + durationMs * (1 - READBACK_SMOOTHING));
        }
      }
      this.#readbackBuffer.unmap();
      this.#readbackAvailable = true;
    }).catch(() => {
      this.#readbackAvailable = true;
    });
  }

  /** @returns {Map<string, number>} pass name → smoothed duration in ms */
  getPassTimings() {
    return this.#timings;
  }

  destroy() {
    this.#querySet?.destroy();
    this.#resolveBuffer?.destroy();
    this.#readbackBuffer?.destroy();
  }
}
