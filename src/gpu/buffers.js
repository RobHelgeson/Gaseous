// buffers.js — Buffer creation, HDR texture, layout definitions, resize logic

const PARTICLE_BYTE_SIZE = 48; // 2 vec4 + 4 scalars

// Nebula palette: saturated jewel tones
const PALETTE = [
  [0.9, 0.2, 0.4],  // Ruby
  [0.2, 0.4, 0.9],  // Sapphire
  [0.1, 0.8, 0.5],  // Emerald
  [0.8, 0.3, 0.9],  // Amethyst
  [0.9, 0.7, 0.1],  // Topaz
  [0.1, 0.7, 0.9],  // Aquamarine
];

export class Buffers {
  /** @type {GPUDevice} */
  #device;
  /** @type {GPUBuffer} */
  particleBuffer = null;
  /** @type {GPUBuffer} */
  particleSortBuffer = null;
  /** @type {GPUBuffer} */
  simParamsBuffer = null;
  /** @type {GPUBuffer} */
  binCountBuffer = null;
  /** @type {GPUBuffer} */
  binOffsetBufferA = null;
  /** @type {GPUBuffer} */
  binOffsetBufferB = null;
  /** @type {GPUBuffer} */
  prefixParamsBuffer = null;
  /** @type {GPUTexture} */
  hdrTexture = null;
  /** @type {GPUTextureView} */
  hdrView = null;
  /** @type {GPUSampler} */
  hdrSampler = null;

  #width = 0;
  #height = 0;
  #particleCount = 0;
  #binCount = 0;

  constructor(device) {
    this.#device = device;
  }

  init(particleCount, width, height, sphRadius) {
    this.#particleCount = particleCount;
    this.#createParticleBuffer(particleCount, width, height);
    this.#createSortBuffer(particleCount);
    this.#createSimParamsBuffer();
    this.#createBinBuffers(width, height, sphRadius);
    this.#createPrefixParamsBuffer();
    this.#createHdrTexture(width, height);
    this.#createSampler();
  }

  #createParticleBuffer(count, canvasW, canvasH) {
    const data = new ArrayBuffer(count * PARTICLE_BYTE_SIZE);
    const f32 = new Float32Array(data);
    const u32 = new Uint32Array(data);

    // 48 bytes = 12 floats per particle
    const STRIDE = PARTICLE_BYTE_SIZE / 4;

    for (let i = 0; i < count; i++) {
      const base = i * STRIDE;

      // Random position within canvas
      const x = Math.random() * canvasW;
      const y = Math.random() * canvasH;
      f32[base + 0] = x;     // pos.x
      f32[base + 1] = y;     // pos.y
      f32[base + 2] = 0;     // vel.x
      f32[base + 3] = 0;     // vel.y

      // Random color from palette
      const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      f32[base + 4] = c[0];  // color.r
      f32[base + 5] = c[1];  // color.g
      f32[base + 6] = c[2];  // color.b
      f32[base + 7] = 1.0;   // density (unused for now)

      f32[base + 8] = 0;     // pressure
      f32[base + 9] = 1.0;   // attractor_str
      u32[base + 10] = 0;    // ball_id
      u32[base + 11] = 1;    // flags: alive=1
    }

    this.particleBuffer = this.#device.createBuffer({
      label: 'particleBuffer',
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint8Array(this.particleBuffer.getMappedRange()).set(new Uint8Array(data));
    this.particleBuffer.unmap();
  }

  #createSortBuffer(count) {
    if (this.particleSortBuffer) this.particleSortBuffer.destroy();
    this.particleSortBuffer = this.#device.createBuffer({
      label: 'particleSortBuffer',
      size: count * PARTICLE_BYTE_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
  }

  #createBinBuffers(width, height, sphRadius) {
    if (this.binCountBuffer) this.binCountBuffer.destroy();
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

  #createPrefixParamsBuffer() {
    if (this.prefixParamsBuffer) this.prefixParamsBuffer.destroy();
    this.prefixParamsBuffer = this.#device.createBuffer({
      label: 'prefixParamsBuffer',
      size: 8, // count: u32, offset: u32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  #createSimParamsBuffer() {
    this.simParamsBuffer = this.#device.createBuffer({
      label: 'simParamsBuffer',
      size: 128,
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

  /** Upload prefix sum params for one iteration */
  uploadPrefixParams(count, offset) {
    const buf = new Uint32Array([count, offset]);
    this.#device.queue.writeBuffer(this.prefixParamsBuffer, 0, buf);
  }

  get particleCount() { return this.#particleCount; }
  get binCount() { return this.#binCount; }

  destroy() {
    this.particleBuffer?.destroy();
    this.particleSortBuffer?.destroy();
    this.simParamsBuffer?.destroy();
    this.binCountBuffer?.destroy();
    this.binOffsetBufferA?.destroy();
    this.binOffsetBufferB?.destroy();
    this.prefixParamsBuffer?.destroy();
    this.hdrTexture?.destroy();
  }
}
