// frame.js — Per-frame command encoding: compute -> background -> particles -> tonemap

export class FrameEncoder {
  /** @type {GPUDevice} */
  #device;
  /** @type {GPUBuffer} */
  #bgParamsBuffer;
  #bgBindGroup = null;
  #startTime = performance.now();

  computePipelines = null;
  computeBindGroups = null;

  constructor(device, renderPipelines, computePipelines, buffers) {
    this.#device = device;
    this.pipelines = renderPipelines;
    this.computePipelines = computePipelines;
    this.buffers = buffers;

    // Background params uniform buffer (32 bytes, 8 floats)
    this.#bgParamsBuffer = device.createBuffer({
      label: 'bgParamsBuffer',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#bgBindGroup = renderPipelines.createBackgroundBindGroup(this.#bgParamsBuffer);

    this.bindGroups = renderPipelines.createBindGroups(buffers);
    if (computePipelines) {
      this.computeBindGroups = computePipelines.createBindGroups(buffers);
    }
  }

  /** Recreate bind groups after HDR texture resize */
  handleResize() {
    this.bindGroups = this.pipelines.createBindGroups(this.buffers);
  }

  /** Encode and submit one frame */
  render(gpu, particleCount) {
    const swapTexture = gpu.ctx.getCurrentTexture();
    const swapView = swapTexture.createView();
    const encoder = this.#device.createCommandEncoder({ label: 'frame' });

    // Compute: integrate particles
    if (this.computePipelines && this.computeBindGroups) {
      this.#runCompute(encoder, particleCount);
    }

    // Upload background params
    this.#uploadBgParams(gpu.width, gpu.height);

    // Render pass 1: Background -> HDR texture
    this.#renderBackground(encoder);

    // Render pass 2: Particles -> HDR texture (additive)
    this.#renderParticles(encoder, particleCount);

    // Render pass 3: Tonemap -> swap chain
    this.#renderTonemap(encoder, swapView);

    this.#device.queue.submit([encoder.finish()]);
  }

  #runCompute(encoder, particleCount) {
    const pass = encoder.beginComputePass({ label: 'integrate' });
    pass.setPipeline(this.computePipelines.integratePipeline);
    pass.setBindGroup(0, this.computeBindGroups.integrateBG);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
    pass.end();
  }

  #uploadBgParams(width, height) {
    const buf = new Float32Array(8);
    buf[0] = width;
    buf[1] = height;
    buf[2] = 0.003;   // star_density
    buf[3] = 0.8;     // star_brightness
    buf[4] = 0.15;    // nebula_glow
    buf[5] = (performance.now() - this.#startTime) / 1000; // time
    buf[6] = 0;       // pad
    buf[7] = 0;       // pad
    this.#device.queue.writeBuffer(this.#bgParamsBuffer, 0, buf);
  }

  #renderBackground(encoder) {
    const pass = encoder.beginRenderPass({
      label: 'background',
      colorAttachments: [{
        view: this.buffers.hdrView,
        clearValue: [0.01, 0.005, 0.02, 1.0],
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipelines.backgroundPipeline);
    pass.setBindGroup(0, this.#bgBindGroup);
    pass.draw(3); // fullscreen triangle
    pass.end();
  }

  #renderParticles(encoder, particleCount) {
    const pass = encoder.beginRenderPass({
      label: 'particles',
      colorAttachments: [{
        view: this.buffers.hdrView,
        loadOp: 'load', // preserve background
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipelines.particlePipeline);
    pass.setBindGroup(0, this.bindGroups.particleBG);
    pass.draw(6, particleCount); // 6 verts per quad, instanced
    pass.end();
  }

  #renderTonemap(encoder, swapView) {
    const pass = encoder.beginRenderPass({
      label: 'tonemap',
      colorAttachments: [{
        view: swapView,
        clearValue: [0, 0, 0, 1],
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipelines.tonemapPipeline);
    pass.setBindGroup(0, this.bindGroups.tonemapBG);
    pass.draw(3); // fullscreen triangle
    pass.end();
  }

  destroy() {
    this.#bgParamsBuffer?.destroy();
  }
}
