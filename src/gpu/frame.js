// frame.js — Per-frame command encoding: spatial hash -> integrate -> render

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

  /** Recreate bind groups after resize or buffer recreation */
  rebuildBindGroups() {
    this.bindGroups = this.pipelines.createBindGroups(this.buffers);
    if (this.computePipelines) {
      this.computeBindGroups = this.computePipelines.createBindGroups(this.buffers);
    }
  }

  /** Encode and submit one frame */
  render(gpu, particleCount, binCount, runHomogeneity = false) {
    if (this.computePipelines && this.computeBindGroups) {
      // Spatial hashing requires multiple submits for prefix sum uniform updates
      // Returns true if exclusive prefix sum ended in buffer A
      const offsetInA = this.#runSpatialHash(particleCount, binCount);

      // Sort->main copy + density + forces + integrate + render
      const encoder = this.#device.createCommandEncoder({ label: 'frame' });

      encoder.copyBufferToBuffer(
        this.buffers.particleSortBuffer, 0,
        this.buffers.particleBuffer, 0,
        particleCount * 48,
      );

      this.#runDensity(encoder, particleCount, offsetInA);
      this.#runForces(encoder, particleCount, offsetInA);
      this.#runIntegrate(encoder, particleCount);

      this.#uploadBgParams(gpu.width, gpu.height);
      this.#renderBackground(encoder);
      this.#renderParticles(encoder, particleCount);
      this.#renderTonemap(encoder, gpu.ctx.getCurrentTexture().createView());

      this.#device.queue.submit([encoder.finish()]);

      // Homogeneity check (separate submit, reads current particle state)
      if (runHomogeneity) {
        this.#runHomogeneity(particleCount);
      }
    } else {
      const encoder = this.#device.createCommandEncoder({ label: 'frame' });
      this.#uploadBgParams(gpu.width, gpu.height);
      this.#renderBackground(encoder);
      this.#renderParticles(encoder, particleCount);
      this.#renderTonemap(encoder, gpu.ctx.getCurrentTexture().createView());
      this.#device.queue.submit([encoder.finish()]);
    }
  }

  /** @returns {boolean} true if exclusive prefix sum result is in buffer A */
  #runSpatialHash(particleCount, binCount) {
    const bg = this.computeBindGroups;
    const cp = this.computePipelines;
    const wgParticles = Math.ceil(particleCount / 64);
    const wgBins = Math.ceil(binCount / 64);

    // 1-2. Clear bins + count particles (single submit)
    {
      const enc = this.#device.createCommandEncoder({ label: 'hash-count' });

      const clear = enc.beginComputePass({ label: 'clear-bins' });
      clear.setPipeline(cp.clearBinsPipeline);
      clear.setBindGroup(0, bg.clearBinsBG);
      clear.dispatchWorkgroups(wgBins);
      clear.end();

      const count = enc.beginComputePass({ label: 'count-bins' });
      count.setPipeline(cp.countBinsPipeline);
      count.setBindGroup(0, bg.countBinsBG);
      count.dispatchWorkgroups(wgParticles);
      count.end();

      // Copy bin counts to offset buffer A as prefix sum input
      enc.copyBufferToBuffer(
        this.buffers.binCountBuffer, 0,
        this.buffers.binOffsetBufferA, 0,
        binCount * 4,
      );

      this.#device.queue.submit([enc.finish()]);
    }

    // 3. Prefix sum iterations (each needs its own submit for uniform update)
    const iterations = Math.ceil(Math.log2(binCount));
    let readFromA = true;

    for (let i = 0; i < iterations; i++) {
      this.buffers.uploadPrefixParams(binCount, 1 << i);

      const enc = this.#device.createCommandEncoder({ label: `prefix-${i}` });
      const pass = enc.beginComputePass({ label: `prefix-sum-${i}` });
      pass.setPipeline(cp.prefixSumPipeline);
      pass.setBindGroup(0, readFromA ? bg.prefixSumAB : bg.prefixSumBA);
      pass.dispatchWorkgroups(wgBins);
      pass.end();
      this.#device.queue.submit([enc.finish()]);

      readFromA = !readFromA;
    }

    // 4. Convert inclusive to exclusive prefix sum
    {
      this.buffers.uploadPrefixParams(binCount, 0);

      const enc = this.#device.createCommandEncoder({ label: 'make-exclusive' });
      const pass = enc.beginComputePass({ label: 'make-exclusive' });
      pass.setPipeline(cp.makeExclusivePipeline);
      pass.setBindGroup(0, readFromA ? bg.prefixSumAB : bg.prefixSumBA);
      pass.dispatchWorkgroups(wgBins);
      pass.end();
      this.#device.queue.submit([enc.finish()]);

      readFromA = !readFromA;
    }

    // 5-6. Clear bin counts (for sort atomics) + sort particles
    {
      const enc = this.#device.createCommandEncoder({ label: 'sort' });

      const clear = enc.beginComputePass({ label: 'clear-bins-for-sort' });
      clear.setPipeline(cp.clearBinsPipeline);
      clear.setBindGroup(0, bg.clearBinsBG);
      clear.dispatchWorkgroups(wgBins);
      clear.end();

      const sort = enc.beginComputePass({ label: 'sort-particles' });
      sort.setPipeline(cp.sortPipeline);
      sort.setBindGroup(0, readFromA ? bg.sortBG_A : bg.sortBG_B);
      sort.dispatchWorkgroups(wgParticles);
      sort.end();

      this.#device.queue.submit([enc.finish()]);
    }

    return readFromA;
  }

  #runHomogeneity(particleCount) {
    const bg = this.computeBindGroups;
    const cp = this.computePipelines;

    const encoder = this.#device.createCommandEncoder({ label: 'homogeneity' });

    // Clear cell accumulators (256 cells × 4 u32s = 1024 values)
    const clear = encoder.beginComputePass({ label: 'homog-clear' });
    clear.setPipeline(cp.homogClearPipeline);
    clear.setBindGroup(0, bg.homogAccumBG);
    clear.dispatchWorkgroups(Math.ceil(1024 / 64));
    clear.end();

    // Accumulate particle colors per cell
    const accum = encoder.beginComputePass({ label: 'homog-accumulate' });
    accum.setPipeline(cp.homogAccumPipeline);
    accum.setBindGroup(0, bg.homogAccumBG);
    accum.dispatchWorkgroups(Math.ceil(particleCount / 64));
    accum.end();

    // Reduce to single variance value
    const reduce = encoder.beginComputePass({ label: 'homog-reduce' });
    reduce.setPipeline(cp.homogReducePipeline);
    reduce.setBindGroup(0, bg.homogReduceBG);
    reduce.dispatchWorkgroups(1);
    reduce.end();

    // Copy result to CPU-readable buffer
    encoder.copyBufferToBuffer(
      this.buffers.homogResultBuffer, 0,
      this.buffers.homogReadbackBuffer, 0,
      4,
    );

    this.#device.queue.submit([encoder.finish()]);
  }

  #runDensity(encoder, particleCount, offsetInA) {
    const bg = this.computeBindGroups;
    const pass = encoder.beginComputePass({ label: 'density' });
    pass.setPipeline(this.computePipelines.densityPipeline);
    pass.setBindGroup(0, offsetInA ? bg.densityBG_A : bg.densityBG_B);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
    pass.end();
  }

  #runForces(encoder, particleCount, offsetInA) {
    const bg = this.computeBindGroups;
    const pass = encoder.beginComputePass({ label: 'forces' });
    pass.setPipeline(this.computePipelines.forcesPipeline);
    pass.setBindGroup(0, offsetInA ? bg.forcesBG_A : bg.forcesBG_B);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
    pass.end();
  }

  #runIntegrate(encoder, particleCount) {
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
    pass.draw(3);
    pass.end();
  }

  #renderParticles(encoder, particleCount) {
    const pass = encoder.beginRenderPass({
      label: 'particles',
      colorAttachments: [{
        view: this.buffers.hdrView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipelines.particlePipeline);
    pass.setBindGroup(0, this.bindGroups.particleBG);
    pass.draw(6, particleCount);
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
    pass.draw(3);
    pass.end();
  }

  destroy() {
    this.#bgParamsBuffer?.destroy();
  }
}
