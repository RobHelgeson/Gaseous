// buffers.js — Buffer creation, HDR texture, layout definitions, resize logic

import { getActiveTheme } from '../themes/theme-registry.js';

const PARTICLE_BYTE_SIZE = 48; // 2 vec4 + 4 scalars

export class Buffers {
  /** @type {GPUDevice} */
  #device;
  /** @type {GPUBuffer} */
  particleBufferA = null;
  /** @type {GPUBuffer} */
  particleBufferB = null;
  /** Which buffer has the current (readable) particle data: true = A, false = B */
  #particleFlip = true;
  /** @type {GPUBuffer} */
  simParamsBuffer = null;
  /** @type {GPUBuffer} */
  binCountBuffer = null;
  /** @type {GPUBuffer} */
  binCountSavedBuffer = null;
  /** @type {GPUBuffer} */
  binOffsetBufferA = null;
  /** @type {GPUBuffer} */
  binOffsetBufferB = null;
  /** @type {GPUBuffer} */
  prefixParamsBuffer = null;
  /** @type {GPUBuffer} */
  ballDataBuffer = null;
  /** @type {GPUTexture} */
  hdrTexture = null;
  /** @type {GPUTextureView} */
  hdrView = null;
  /** @type {GPUSampler} */
  hdrSampler = null;
  /** @type {GPUBuffer} */
  homogCellBuffer = null;
  /** @type {GPUBuffer} */
  homogResultBuffer = null;
  /** @type {GPUBuffer} */
  #homogReadbackBuffer = null;
  #homogReadbackAvailable = true;

  #width = 0;
  #height = 0;
  #particleCount = 0;
  #binCount = 0;

  constructor(device) {
    this.#device = device;
  }

  init(particleCount, width, height, sphRadius, ballManager) {
    this.#particleCount = particleCount;
    this.#particleFlip = true;
    this.#createParticleBuffers(particleCount, width, height, ballManager);
    this.#createSimParamsBuffer();
    this.#createBallDataBuffer();
    this.#createBinBuffers(width, height, sphRadius);
    this.#createPrefixParamsBuffers();
    this.#createHdrTexture(width, height);
    this.#createSampler();
    this.#createHomogeneityBuffers();
  }

  #createParticleBuffers(count, canvasW, canvasH, ballManager) {
    if (this.particleBufferA) this.particleBufferA.destroy();
    if (this.particleBufferB) this.particleBufferB.destroy();

    const data = new ArrayBuffer(count * PARTICLE_BYTE_SIZE);
    const f32 = new Float32Array(data);
    const u32 = new Uint32Array(data);
    const STRIDE = PARTICLE_BYTE_SIZE / 4;

    const balls = ballManager ? ballManager.balls : null;

    for (let i = 0; i < count; i++) {
      const base = i * STRIDE;
      let x, y, vx, vy, color, ballId;

      if (balls && balls.length > 0) {
        // Assign particles to balls in order
        const ballIndex = Math.min(
          Math.floor(i / Math.ceil(count / balls.length)),
          balls.length - 1,
        );
        const ball = balls[ballIndex];

        // Disk distribution around ball center
        const angle = Math.random() * 2 * Math.PI;
        const r = Math.sqrt(Math.random()) * ball.radius;
        x = ball.x + Math.cos(angle) * r;
        y = ball.y + Math.sin(angle) * r;
        vx = ball.vx + (Math.random() - 0.5) * 10;
        vy = ball.vy + (Math.random() - 0.5) * 10;
        color = ball.color;
        ballId = ballIndex;
      } else {
        x = Math.random() * canvasW;
        y = Math.random() * canvasH;
        vx = 0; vy = 0;
        const palette = getActiveTheme().colors.palette;
        color = palette[Math.floor(Math.random() * palette.length)];
        ballId = 0;
      }

      f32[base + 0] = x;
      f32[base + 1] = y;
      f32[base + 2] = vx;
      f32[base + 3] = vy;
      f32[base + 4] = color[0];
      f32[base + 5] = color[1];
      f32[base + 6] = color[2];
      f32[base + 7] = 1.0;   // density
      f32[base + 8] = 0;     // pressure
      f32[base + 9] = 1.0;   // attractor_str
      u32[base + 10] = ballId;
      u32[base + 11] = 1;    // flags: alive=1
    }

    const bufferUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

    // Buffer A gets initial particle data
    this.particleBufferA = this.#device.createBuffer({
      label: 'particleBufferA',
      size: data.byteLength,
      usage: bufferUsage,
      mappedAtCreation: true,
    });
    new Uint8Array(this.particleBufferA.getMappedRange()).set(new Uint8Array(data));
    this.particleBufferA.unmap();

    // Buffer B starts empty (sort target for first frame)
    this.particleBufferB = this.#device.createBuffer({
      label: 'particleBufferB',
      size: data.byteLength,
      usage: bufferUsage,
    });
  }

  #createBinBuffers(width, height, sphRadius) {
    if (this.binCountBuffer) this.binCountBuffer.destroy();
    if (this.binCountSavedBuffer) this.binCountSavedBuffer.destroy();
    if (this.binOffsetBufferA) this.binOffsetBufferA.destroy();
    if (this.binOffsetBufferB) this.binOffsetBufferB.destroy();

    const binsX = Math.ceil(width / sphRadius);
    const binsY = Math.ceil(height / sphRadius);
    this.#binCount = binsX * binsY + 1; // +1 for dead particle overflow bin
    const byteSize = this.#binCount * 4;

    this.binCountBuffer = this.#device.createBuffer({
      label: 'binCountBuffer',
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.binCountSavedBuffer = this.#device.createBuffer({
      label: 'binCountSavedBuffer',
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.binOffsetBufferA = this.#device.createBuffer({
      label: 'binOffsetBufferA',
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.binOffsetBufferB = this.#device.createBuffer({
      label: 'binOffsetBufferB',
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
  }

  #createBallDataBuffer() {
    if (this.ballDataBuffer) this.ballDataBuffer.destroy();
    this.ballDataBuffer = this.#device.createBuffer({
      label: 'ballDataBuffer',
      size: 5 * 48, // MAX_BALLS * BallData size
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  #createPrefixParamsBuffers() {
    if (this.prefixParamsBuffers) {
      for (const buf of this.prefixParamsBuffers) buf.destroy();
    }
    // Pre-allocate uniform buffers for each prefix sum iteration + make_exclusive
    // Max iterations = ceil(log2(maxBins)) + 1 for make_exclusive
    this.prefixParamsBuffers = [];
    for (let i = 0; i < 17; i++) {
      this.prefixParamsBuffers.push(this.#device.createBuffer({
        label: `prefixParams-${i}`,
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }));
    }
    // Keep legacy alias for bind group creation
    this.prefixParamsBuffer = this.prefixParamsBuffers[0];
  }

  /** Pre-fill all prefix sum uniform buffers for the current bin count */
  preparePrefixParams(binCount) {
    const iterations = Math.ceil(Math.log2(binCount));
    for (let i = 0; i < iterations; i++) {
      const buf = new Uint32Array([binCount, 1 << i]);
      this.#device.queue.writeBuffer(this.prefixParamsBuffers[i], 0, buf);
    }
    // make_exclusive params (stride=0 is unused, just needs count)
    const excBuf = new Uint32Array([binCount, 0]);
    this.#device.queue.writeBuffer(this.prefixParamsBuffers[iterations], 0, excBuf);
  }

  #createSimParamsBuffer() {
    this.simParamsBuffer = this.#device.createBuffer({
      label: 'simParamsBuffer',
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  #createHdrTexture(width, height) {
    if (this.hdrTexture) this.hdrTexture.destroy();
    this.#width = width;
    this.#height = height;

    this.hdrTexture = this.#device.createTexture({
      label: 'hdrTexture',
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.hdrView = this.hdrTexture.createView();
  }

  #createHomogeneityBuffers() {
    if (this.homogCellBuffer) this.homogCellBuffer.destroy();
    if (this.homogResultBuffer) this.homogResultBuffer.destroy();
    if (this.#homogReadbackBuffer) this.#homogReadbackBuffer.destroy();

    // 256 cells × 4 u32s (r_sum, g_sum, b_sum, count)
    this.homogCellBuffer = this.#device.createBuffer({
      label: 'homogCellBuffer',
      size: 256 * 4 * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    this.homogResultBuffer = this.#device.createBuffer({
      label: 'homogResultBuffer',
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.#homogReadbackBuffer = this.#device.createBuffer({
      label: 'homogReadbackBuffer',
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.#homogReadbackAvailable = true;
  }

  #createSampler() {
    this.hdrSampler = this.#device.createSampler({
      label: 'hdrSampler',
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }

  /** Recreate HDR texture and bin buffers on resize. Returns true if resized. */
  handleResize(width, height, sphRadius) {
    if (width === this.#width && height === this.#height) return false;
    this.#createHdrTexture(width, height);
    this.#createBinBuffers(width, height, sphRadius);
    return true;
  }

  /** Upload simParams to GPU */
  uploadSimParams(data) {
    this.#device.queue.writeBuffer(this.simParamsBuffer, 0, data);
  }

  /** Upload ball data to GPU */
  uploadBallData(data) {
    this.#device.queue.writeBuffer(this.ballDataBuffer, 0, data);
  }

  /** Upload prefix sum params for one iteration (legacy, used for single-buffer fallback) */
  uploadPrefixParams(count, offset) {
    const buf = new Uint32Array([count, offset]);
    this.#device.queue.writeBuffer(this.prefixParamsBuffer, 0, buf);
  }

  /** Async readback of homogeneity variance from GPU */
  async readHomogeneity() {
    if (!this.#homogReadbackAvailable) return null;
    this.#homogReadbackAvailable = false;
    try {
      await this.#homogReadbackBuffer.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(this.#homogReadbackBuffer.getMappedRange());
      const value = data[0];
      this.#homogReadbackBuffer.unmap();
      return value;
    } catch {
      return null;
    } finally {
      this.#homogReadbackAvailable = true;
    }
  }

  /** Buffer with current particle data (read source for spatial hash) */
  get currentParticleBuffer() { return this.#particleFlip ? this.particleBufferA : this.particleBufferB; }
  /** Buffer that sort writes into (becomes current next frame) */
  get sortTargetBuffer() { return this.#particleFlip ? this.particleBufferB : this.particleBufferA; }
  /** Flip buffers at end of frame */
  flipParticleBuffers() { this.#particleFlip = !this.#particleFlip; }
  /** Legacy alias — returns current particle buffer for compatibility */
  get particleBuffer() { return this.currentParticleBuffer; }
  /** Legacy alias — returns sort target for compatibility */
  get particleSortBuffer() { return this.sortTargetBuffer; }

  get homogReadbackBuffer() { return this.#homogReadbackBuffer; }
  get homogReadbackAvailable() { return this.#homogReadbackAvailable; }
  get particleCount() { return this.#particleCount; }
  get binCount() { return this.#binCount; }

  destroy() {
    this.particleBufferA?.destroy();
    this.particleBufferB?.destroy();
    this.simParamsBuffer?.destroy();
    this.binCountBuffer?.destroy();
    this.binCountSavedBuffer?.destroy();
    this.binOffsetBufferA?.destroy();
    this.binOffsetBufferB?.destroy();
    if (this.prefixParamsBuffers) {
      for (const buf of this.prefixParamsBuffers) buf.destroy();
    }
    this.ballDataBuffer?.destroy();
    this.homogCellBuffer?.destroy();
    this.homogResultBuffer?.destroy();
    this.#homogReadbackBuffer?.destroy();
    this.hdrTexture?.destroy();
  }
}
