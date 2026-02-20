// frame.js — Per-frame command encoding: spatial hash -> integrate -> render

import { getActiveTheme } from '../themes/theme-registry.js';

export class FrameEncoder {
  /** @type {GPUDevice} */
  #device;
  /** @type {GPUBuffer} */
  #bgParamsBuffer;
  #bgBindGroup = null;
  #startTime = performance.now();
  /** @type {import('./gpu-timing.js').GpuPassTimer|null} */
  #passTimer = null;
  /** @type {GPUBuffer} */
  #resolveParamsBuffer;
  #resolveBindGroup = null;

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

    // Resolve params uniform buffer (32 bytes, 8 floats) for metaball theme
    this.#resolveParamsBuffer = device.createBuffer({
      label: 'resolveParamsBuffer',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#resolveBindGroup = renderPipelines.createResolveBindGroup(buffers, this.#resolveParamsBuffer);

    this.bindGroups = renderPipelines.createBindGroups(buffers);
    if (computePipelines) {
      this.computeBindGroups = computePipelines.createBindGroups(buffers);
    }
  }

  /** Recreate bind groups after resize or buffer recreation */
  rebuildBindGroups() {
    this.bindGroups = this.pipelines.createBindGroups(this.buffers);
    this.#resolveBindGroup = this.pipelines.createResolveBindGroup(this.buffers, this.#resolveParamsBuffer);
    if (this.computePipelines) {
      this.computeBindGroups = this.computePipelines.createBindGroups(this.buffers);
    }
  }

  /** Rebuild background bind group after pipeline recreation (theme switch) */
  rebuildBgBindGroup() {
    this.#bgBindGroup = this.pipelines.createBackgroundBindGroup(this.#bgParamsBuffer);
  }

  /** Rebuild resolve bind group after pipeline recreation (theme switch) */
  rebuildResolveBindGroup() {
    this.#resolveBindGroup = this.pipelines.createResolveBindGroup(this.buffers, this.#resolveParamsBuffer);
  }

  /** Set GPU pass timer for per-pass profiling */
  setPassTimer(passTimer) {
    this.#passTimer = passTimer;
  }

  /** Encode and submit one frame */
  render(gpu, particleCount, binCount, runHomogeneity = false, ballCount = 0) {
    if (this.computePipelines && this.computeBindGroups) {
      // Single command encoder for the entire frame
      const encoder = this.#device.createCommandEncoder({ label: 'frame' });

      // Prefix sum uniforms are pre-filled, so everything goes in one submission
      this.buffers.preparePrefixParams(binCount);

      // Get flip-state bind groups for current particle buffer orientation
      const flip = this.buffers.currentParticleBuffer === this.buffers.particleBufferA;
      const fbg = this.computeBindGroups.byFlip[flip];

      const offsetInA = this.#runSpatialHash(encoder, particleCount, binCount, fbg);

      // No copy needed — sort wrote directly to sortTargetBuffer
      // density/forces/integrate operate on sortTargetBuffer via flip-aware bind groups

      this.#runDensity(encoder, particleCount, offsetInA, fbg);
      this.#runForces(encoder, particleCount, offsetInA, fbg);
      this.#runIntegrate(encoder, particleCount, fbg);

      this.#uploadBgParams(gpu.width, gpu.height);
      this.#renderBackground(encoder);
      this.#renderFog(encoder, ballCount);

      const isMetaball = getActiveTheme().rendering.mode === 'metaball';
      if (isMetaball) {
        this.#renderParticlesToEnergy(encoder, particleCount, flip);
        this.#uploadResolveParams(gpu.width, gpu.height);
        this.#renderMetaballResolve(encoder);
      } else {
        this.#renderParticles(encoder, particleCount, flip);
      }

      this.#renderTonemap(encoder, gpu.ctx.getCurrentTexture().createView());

      // Resolve GPU timestamps before finishing the encoder
      if (this.#passTimer) {
        this.#passTimer.resolve(encoder);
      }

      this.#device.queue.submit([encoder.finish()]);

      // Flip particle buffers — sort target becomes current for next frame
      this.buffers.flipParticleBuffers();

      // Non-blocking readback of GPU pass timings
      if (this.#passTimer) {
        this.#passTimer.readback();
      }

      // Homogeneity check (separate submit, reads current particle state)
      // fbg was computed pre-flip, its homogAccumBG reads sortTargetBuf which has the integrated data
      if (runHomogeneity) {
        this.#runHomogeneity(particleCount, fbg);
      }
    } else {
      const encoder = this.#device.createCommandEncoder({ label: 'frame' });
      this.#uploadBgParams(gpu.width, gpu.height);
      this.#renderBackground(encoder);
      this.#renderFog(encoder, ballCount);

      const isMetaball2 = getActiveTheme().rendering.mode === 'metaball';
      if (isMetaball2) {
        this.#renderParticlesToEnergy(encoder, particleCount, false);
        this.#uploadResolveParams(gpu.width, gpu.height);
        this.#renderMetaballResolve(encoder);
      } else {
        // In non-compute mode, render from buffer A (initial data, no ping-pong)
        this.#renderParticles(encoder, particleCount, false);
      }

      this.#renderTonemap(encoder, gpu.ctx.getCurrentTexture().createView());
      this.#device.queue.submit([encoder.finish()]);
    }
  }

  /** @returns {boolean} true if exclusive prefix sum result is in buffer A */
  #runSpatialHash(enc, particleCount, binCount, fbg) {
    const cp = this.computePipelines;
    const bg = this.computeBindGroups;
    const wgParticles = Math.ceil(particleCount / 64);
    const wgBins = Math.ceil(binCount / 64);

    // 1. Clear bins
    const tw0 = this.#passTimer?.getTimestampWrites(this.#passTimer.passIndex('clear_bins'));
    const clear = enc.beginComputePass({ label: 'clear-bins', ...(tw0 && { timestampWrites: tw0 }) });
    clear.setPipeline(cp.clearBinsPipeline);
    clear.setBindGroup(0, bg.clearBinsBG);
    clear.dispatchWorkgroups(wgBins);
    clear.end();

    // 2. Count particles per bin (reads from current particle buffer)
    const tw1 = this.#passTimer?.getTimestampWrites(this.#passTimer.passIndex('count_bins'));
    const count = enc.beginComputePass({ label: 'count-bins', ...(tw1 && { timestampWrites: tw1 }) });
    count.setPipeline(cp.countBinsPipeline);
    count.setBindGroup(0, fbg.countBinsBG);
    count.dispatchWorkgroups(wgParticles);
    count.end();

    // 3a. Save bin counts before sort clears them (density/forces need original counts)
    enc.copyBufferToBuffer(
      this.buffers.binCountBuffer, 0,
      this.buffers.binCountSavedBuffer, 0,
      binCount * 4,
    );

    // 3b. Copy bin counts to offset buffer A as prefix sum input
    enc.copyBufferToBuffer(
      this.buffers.binCountBuffer, 0,
      this.buffers.binOffsetBufferA, 0,
      binCount * 4,
    );

    // 4. Prefix sum iterations — each uses its own bind group with pre-filled uniform
    // Timestamp the first pass and last (make_exclusive) to measure total prefix sum time
    const iterations = Math.ceil(Math.log2(binCount));
    const twPS = this.#passTimer?.getTimestampWrites(this.#passTimer.passIndex('prefix_sum'));
    for (let i = 0; i < iterations; i++) {
      const tw = (i === 0 && twPS) ? { timestampWrites: { querySet: twPS.querySet, beginningOfPassWriteIndex: twPS.beginningOfPassWriteIndex } } : {};
      const pass = enc.beginComputePass({ label: `prefix-sum-${i}`, ...tw });
      pass.setPipeline(cp.prefixSumPipeline);
      pass.setBindGroup(0, bg.prefixSumBGs[i]);
      pass.dispatchWorkgroups(wgBins);
      pass.end();
    }

    // 5. Convert inclusive to exclusive prefix sum
    const twExc = twPS ? { timestampWrites: { querySet: twPS.querySet, endOfPassWriteIndex: twPS.endOfPassWriteIndex } } : {};
    const excPass = enc.beginComputePass({ label: 'make-exclusive', ...twExc });
    excPass.setPipeline(cp.makeExclusivePipeline);
    excPass.setBindGroup(0, bg.prefixSumBGs[iterations]);
    excPass.dispatchWorkgroups(wgBins);
    excPass.end();

    // Determine which buffer has the exclusive prefix sum result
    const readFromA = ((iterations + 1) % 2 === 0);

    // 6. Clear bin counts (for sort atomics)
    const clearSort = enc.beginComputePass({ label: 'clear-bins-for-sort' });
    clearSort.setPipeline(cp.clearBinsPipeline);
    clearSort.setBindGroup(0, bg.clearBinsBG);
    clearSort.dispatchWorkgroups(wgBins);
    clearSort.end();

    // 7. Sort particles into bins (reads current, writes to sort target)
    const tw3 = this.#passTimer?.getTimestampWrites(this.#passTimer.passIndex('sort'));
    const sort = enc.beginComputePass({ label: 'sort-particles', ...(tw3 && { timestampWrites: tw3 }) });
    sort.setPipeline(cp.sortPipeline);
    sort.setBindGroup(0, readFromA ? fbg.sortBG_A : fbg.sortBG_B);
    sort.dispatchWorkgroups(wgParticles);
    sort.end();

    return readFromA;
  }

  #runHomogeneity(particleCount, fbg) {
    const cp = this.computePipelines;
    const bg = this.computeBindGroups;

    const encoder = this.#device.createCommandEncoder({ label: 'homogeneity' });

    // Clear cell accumulators (256 cells × 4 u32s = 1024 values)
    const clear = encoder.beginComputePass({ label: 'homog-clear' });
    clear.setPipeline(cp.homogClearPipeline);
    clear.setBindGroup(0, fbg.homogAccumBG);
    clear.dispatchWorkgroups(Math.ceil(1024 / 64));
    clear.end();

    // Accumulate particle colors per cell
    const accum = encoder.beginComputePass({ label: 'homog-accumulate' });
    accum.setPipeline(cp.homogAccumPipeline);
    accum.setBindGroup(0, fbg.homogAccumBG);
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

  #runDensity(encoder, particleCount, offsetInA, fbg) {
    const tw = this.#passTimer?.getTimestampWrites(this.#passTimer.passIndex('density'));
    const pass = encoder.beginComputePass({ label: 'density', ...(tw && { timestampWrites: tw }) });
    pass.setPipeline(this.computePipelines.densityPipeline);
    pass.setBindGroup(0, offsetInA ? fbg.densityBG_A : fbg.densityBG_B);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    pass.end();
  }

  #runForces(encoder, particleCount, offsetInA, fbg) {
    const tw = this.#passTimer?.getTimestampWrites(this.#passTimer.passIndex('forces'));
    const pass = encoder.beginComputePass({ label: 'forces', ...(tw && { timestampWrites: tw }) });
    pass.setPipeline(this.computePipelines.forcesPipeline);
    pass.setBindGroup(0, offsetInA ? fbg.forcesBG_A : fbg.forcesBG_B);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    pass.end();
  }

  #runIntegrate(encoder, particleCount, fbg) {
    const tw = this.#passTimer?.getTimestampWrites(this.#passTimer.passIndex('integrate'));
    const pass = encoder.beginComputePass({ label: 'integrate', ...(tw && { timestampWrites: tw }) });
    pass.setPipeline(this.computePipelines.integratePipeline);
    pass.setBindGroup(0, fbg.integrateBG);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
    pass.end();
  }

  #uploadBgParams(width, height) {
    const theme = getActiveTheme();
    const sp = theme.background.shaderParams;
    const buf = new Float32Array(8);
    buf[0] = width;
    buf[1] = height;
    buf[2] = sp[0] || 0;   // theme-specific param 0
    buf[3] = sp[1] || 0;   // theme-specific param 1
    buf[4] = sp[2] || 0;   // theme-specific param 2
    buf[5] = (performance.now() - this.#startTime) / 1000; // time
    buf[6] = sp[3] || 0;   // theme-specific param 3
    buf[7] = sp[4] || 0;   // theme-specific param 4
    this.#device.queue.writeBuffer(this.#bgParamsBuffer, 0, buf);
  }

  #renderBackground(encoder) {
    const tw = this.#passTimer?.getTimestampWrites(this.#passTimer.passIndex('render_total'));
    // Attach begin timestamp to first render pass
    const twBegin = tw ? { timestampWrites: { querySet: tw.querySet, beginningOfPassWriteIndex: tw.beginningOfPassWriteIndex } } : {};
    const pass = encoder.beginRenderPass({
      label: 'background',
      colorAttachments: [{
        view: this.buffers.hdrView,
        clearValue: getActiveTheme().background.clearColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
      ...twBegin,
    });
    pass.setPipeline(this.pipelines.backgroundPipeline);
    pass.setBindGroup(0, this.#bgBindGroup);
    pass.draw(3);
    pass.end();
  }

  #renderFog(encoder, ballCount) {
    if (ballCount === 0) return;
    const pass = encoder.beginRenderPass({
      label: 'ball-fog',
      colorAttachments: [{
        view: this.buffers.hdrView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipelines.fogPipeline);
    pass.setBindGroup(0, this.bindGroups.fogBG);
    pass.draw(6, ballCount);
    pass.end();
  }

  #renderParticles(encoder, particleCount, flip) {
    const particleBG = this.bindGroups.particleBGByFlip[flip];
    const pass = encoder.beginRenderPass({
      label: 'particles',
      colorAttachments: [{
        view: this.buffers.hdrView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipelines.particlePipeline);
    pass.setBindGroup(0, particleBG);
    pass.draw(6, particleCount);
    pass.end();
  }

  #renderParticlesToEnergy(encoder, particleCount, flip) {
    const particleBG = this.bindGroups.particleBGByFlip[flip];
    const pass = encoder.beginRenderPass({
      label: 'particles-energy',
      colorAttachments: [{
        view: this.buffers.energyView,
        clearValue: [0, 0, 0, 0],
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipelines.particlePipeline);
    pass.setBindGroup(0, particleBG);
    pass.draw(6, particleCount);
    pass.end();
  }

  #uploadResolveParams(width, height) {
    const theme = getActiveTheme();
    const mb = theme.metaball || {};
    const buf = new Float32Array(8);
    buf[0] = width;
    buf[1] = height;
    buf[2] = mb.threshold ?? 0.3;
    buf[3] = mb.edgeSoftness ?? 0.15;
    buf[4] = mb.specularIntensity ?? 0.3;
    buf[5] = mb.lightX ?? 0.3;
    buf[6] = mb.lightY ?? -0.5;
    buf[7] = 0; // padding
    this.#device.queue.writeBuffer(this.#resolveParamsBuffer, 0, buf);
  }

  #renderMetaballResolve(encoder) {
    const pass = encoder.beginRenderPass({
      label: 'metaball-resolve',
      colorAttachments: [{
        view: this.buffers.hdrView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipelines.resolvePipeline);
    pass.setBindGroup(0, this.#resolveBindGroup);
    pass.draw(3);
    pass.end();
  }

  #renderTonemap(encoder, swapView) {
    const tw = this.#passTimer?.getTimestampWrites(this.#passTimer.passIndex('render_total'));
    // Attach end timestamp to last render pass
    const twEnd = tw ? { timestampWrites: { querySet: tw.querySet, endOfPassWriteIndex: tw.endOfPassWriteIndex } } : {};
    const pass = encoder.beginRenderPass({
      label: 'tonemap',
      colorAttachments: [{
        view: swapView,
        clearValue: [0, 0, 0, 1],
        loadOp: 'clear',
        storeOp: 'store',
      }],
      ...twEnd,
    });
    pass.setPipeline(this.pipelines.tonemapPipeline);
    pass.setBindGroup(0, this.bindGroups.tonemapBG);
    pass.draw(3);
    pass.end();
  }

  destroy() {
    this.#bgParamsBuffer?.destroy();
    this.#resolveParamsBuffer?.destroy();
  }
}
