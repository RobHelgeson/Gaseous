// compute-pipeline.js — Compute pipelines and bind group creation
// Passes: clear bins, count bins, prefix sum, sort, integrate

import { loadComputeShader, loadShader } from './shader-loader.js';

export class ComputePipelines {
  /** @type {GPUDevice} */
  #device;

  // Pipelines
  clearBinsPipeline = null;
  countBinsPipeline = null;
  sortPipeline = null;
  prefixSumPipeline = null;
  makeExclusivePipeline = null;
  densityPipeline = null;
  forcesPipeline = null;
  integratePipeline = null;
  homogClearPipeline = null;
  homogAccumPipeline = null;
  homogReducePipeline = null;

  // Bind group layouts
  clearBinsBGL = null;
  countBinsBGL = null;
  sortBGL = null;
  prefixSumBGL = null;
  densityBGL = null;
  forcesBGL = null;
  integrateBGL = null;
  homogAccumBGL = null;
  homogReduceBGL = null;

  async init(device) {
    this.#device = device;
    await Promise.all([
      this.#createSpatialHashPipelines(),
      this.#createPrefixSumPipeline(),
      this.#createDensityPipeline(),
      this.#createForcesPipeline(),
      this.#createIntegratePipeline(),
      this.#createHomogeneityPipelines(),
    ]);
  }

  async #createSpatialHashPipelines() {
    const code = await loadComputeShader('src/shaders/spatial-hash.wgsl');
    const module = this.#device.createShaderModule({ label: 'spatial-hash', code });

    // Clear bins: just bin_counts + params
    this.clearBinsBGL = this.#device.createBindGroupLayout({
      label: 'clear-bins-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.clearBinsPipeline = this.#device.createComputePipeline({
      label: 'clearBinsPipeline',
      layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.clearBinsBGL] }),
      compute: { module, entryPoint: 'clear_bins' },
    });

    // Count bins: bin_counts + params + particles_in
    this.countBinsBGL = this.#device.createBindGroupLayout({
      label: 'count-bins-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.countBinsPipeline = this.#device.createComputePipeline({
      label: 'countBinsPipeline',
      layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.countBinsBGL] }),
      compute: { module, entryPoint: 'count_bins' },
    });

    // Sort: bin_counts + params + particles_in + bin_offsets + particles_out
    this.sortBGL = this.#device.createBindGroupLayout({
      label: 'sort-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.sortPipeline = this.#device.createComputePipeline({
      label: 'sortPipeline',
      layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.sortBGL] }),
      compute: { module, entryPoint: 'sort_particles' },
    });
  }

  async #createPrefixSumPipeline() {
    const code = await loadShader('src/shaders/prefix-sum.wgsl');
    const module = this.#device.createShaderModule({ label: 'prefix-sum', code });

    this.prefixSumBGL = this.#device.createBindGroupLayout({
      label: 'prefix-sum-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.prefixSumPipeline = this.#device.createComputePipeline({
      label: 'prefixSumPipeline',
      layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.prefixSumBGL] }),
      compute: { module, entryPoint: 'prefix_sum' },
    });

    this.makeExclusivePipeline = this.#device.createComputePipeline({
      label: 'makeExclusivePipeline',
      layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.prefixSumBGL] }),
      compute: { module, entryPoint: 'make_exclusive' },
    });
  }

  async #createDensityPipeline() {
    const code = await loadComputeShader('src/shaders/density.wgsl');
    const module = this.#device.createShaderModule({ label: 'density', code });

    // particles (rw) + params + bin_offsets (read) + bin_counts (read)
    this.densityBGL = this.#device.createBindGroupLayout({
      label: 'density-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.densityPipeline = this.#device.createComputePipeline({
      label: 'densityPipeline',
      layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.densityBGL] }),
      compute: { module, entryPoint: 'cs_main' },
    });
  }

  async #createForcesPipeline() {
    const code = await loadComputeShader('src/shaders/forces.wgsl');
    const module = this.#device.createShaderModule({ label: 'forces', code });

    // particles (rw) + params + bin_offsets + bin_counts + balls
    this.forcesBGL = this.#device.createBindGroupLayout({
      label: 'forces-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.forcesPipeline = this.#device.createComputePipeline({
      label: 'forcesPipeline',
      layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.forcesBGL] }),
      compute: { module, entryPoint: 'cs_main' },
    });
  }

  async #createIntegratePipeline() {
    const code = await loadComputeShader('src/shaders/integrate.wgsl');
    const module = this.#device.createShaderModule({ label: 'integrate', code });

    this.integrateBGL = this.#device.createBindGroupLayout({
      label: 'integrate-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.integratePipeline = this.#device.createComputePipeline({
      label: 'integratePipeline',
      layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.integrateBGL] }),
      compute: { module, entryPoint: 'cs_main' },
    });
  }

  async #createHomogeneityPipelines() {
    const accumCode = await loadComputeShader('src/shaders/homogeneity.wgsl');
    const accumModule = this.#device.createShaderModule({ label: 'homogeneity', code: accumCode });

    const reduceCode = await loadShader('src/shaders/homogeneity-reduce.wgsl');
    const reduceModule = this.#device.createShaderModule({ label: 'homogeneity-reduce', code: reduceCode });

    // Shared BGL for clear + accumulate: cells(rw) + particles(read) + params(uniform)
    this.homogAccumBGL = this.#device.createBindGroupLayout({
      label: 'homog-accum-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    const accumLayout = this.#device.createPipelineLayout({ bindGroupLayouts: [this.homogAccumBGL] });

    this.homogClearPipeline = this.#device.createComputePipeline({
      label: 'homogClearPipeline',
      layout: accumLayout,
      compute: { module: accumModule, entryPoint: 'clear_cells' },
    });
    this.homogAccumPipeline = this.#device.createComputePipeline({
      label: 'homogAccumPipeline',
      layout: accumLayout,
      compute: { module: accumModule, entryPoint: 'accumulate' },
    });

    // Reduce BGL: cells(read) + result(rw)
    this.homogReduceBGL = this.#device.createBindGroupLayout({
      label: 'homog-reduce-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.homogReducePipeline = this.#device.createComputePipeline({
      label: 'homogReducePipeline',
      layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.homogReduceBGL] }),
      compute: { module: reduceModule, entryPoint: 'reduce_variance' },
    });
  }

  /** Create bind groups for both particle buffer orientations (ping-pong double buffering).
   *  Returns an object with bind groups indexed by flip state (true=A current, false=B current). */
  createBindGroups(buffers) {
    const d = this.#device;

    const clearBinsBG = d.createBindGroup({
      label: 'clear-bins-bg',
      layout: this.clearBinsBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.binCountBuffer } },
        { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
      ],
    });

    // Prefix sum: per-iteration bind groups (independent of particle buffers)
    const prefixSumBGs = [];
    const maxIter = buffers.prefixParamsBuffers.length;
    for (let i = 0; i < maxIter; i++) {
      const readFromA = (i % 2 === 0);
      prefixSumBGs.push(d.createBindGroup({
        label: `prefix-sum-${i}`,
        layout: this.prefixSumBGL,
        entries: [
          { binding: 0, resource: { buffer: readFromA ? buffers.binOffsetBufferA : buffers.binOffsetBufferB } },
          { binding: 1, resource: { buffer: readFromA ? buffers.binOffsetBufferB : buffers.binOffsetBufferA } },
          { binding: 2, resource: { buffer: buffers.prefixParamsBuffers[i] } },
        ],
      }));
    }

    // Homogeneity reduce (independent of particle buffers)
    const homogReduceBG = d.createBindGroup({
      label: 'homog-reduce-bg',
      layout: this.homogReduceBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.homogCellBuffer } },
        { binding: 1, resource: { buffer: buffers.homogResultBuffer } },
      ],
    });

    // Create particle-dependent bind groups for both orientations
    // When flip=true: A is current (read source), B is sort target (write dest)
    // When flip=false: B is current, A is sort target
    const makeParticleBGs = (currentBuf, sortTargetBuf) => {
      // count_bins reads from current buffer
      const countBinsBG = d.createBindGroup({
        label: 'count-bins-bg',
        layout: this.countBinsBGL,
        entries: [
          { binding: 0, resource: { buffer: buffers.binCountBuffer } },
          { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
          { binding: 2, resource: { buffer: currentBuf } },
        ],
      });

      // Sort reads from current, writes to sort target
      const makeSortBG = (offsetBuffer) => d.createBindGroup({
        label: 'sort-bg',
        layout: this.sortBGL,
        entries: [
          { binding: 0, resource: { buffer: buffers.binCountBuffer } },
          { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
          { binding: 2, resource: { buffer: currentBuf } },
          { binding: 3, resource: { buffer: offsetBuffer } },
          { binding: 4, resource: { buffer: sortTargetBuf } },
        ],
      });
      const sortBG_A = makeSortBG(buffers.binOffsetBufferA);
      const sortBG_B = makeSortBG(buffers.binOffsetBufferB);

      // Density/forces/integrate operate on sort target (has sorted data)
      const makeDensityBG = (offsetBuffer) => d.createBindGroup({
        label: 'density-bg',
        layout: this.densityBGL,
        entries: [
          { binding: 0, resource: { buffer: sortTargetBuf } },
          { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
          { binding: 2, resource: { buffer: offsetBuffer } },
          { binding: 3, resource: { buffer: buffers.binCountSavedBuffer } },
        ],
      });
      const densityBG_A = makeDensityBG(buffers.binOffsetBufferA);
      const densityBG_B = makeDensityBG(buffers.binOffsetBufferB);

      const makeForcesBG = (offsetBuffer) => d.createBindGroup({
        label: 'forces-bg',
        layout: this.forcesBGL,
        entries: [
          { binding: 0, resource: { buffer: sortTargetBuf } },
          { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
          { binding: 2, resource: { buffer: offsetBuffer } },
          { binding: 3, resource: { buffer: buffers.binCountSavedBuffer } },
          { binding: 4, resource: { buffer: buffers.ballDataBuffer } },
        ],
      });
      const forcesBG_A = makeForcesBG(buffers.binOffsetBufferA);
      const forcesBG_B = makeForcesBG(buffers.binOffsetBufferB);

      const integrateBG = d.createBindGroup({
        label: 'integrate-bg',
        layout: this.integrateBGL,
        entries: [
          { binding: 0, resource: { buffer: sortTargetBuf } },
          { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
        ],
      });

      // Homogeneity reads from sort target (current frame's final particle state)
      const homogAccumBG = d.createBindGroup({
        label: 'homog-accum-bg',
        layout: this.homogAccumBGL,
        entries: [
          { binding: 0, resource: { buffer: buffers.homogCellBuffer } },
          { binding: 1, resource: { buffer: sortTargetBuf } },
          { binding: 2, resource: { buffer: buffers.simParamsBuffer } },
        ],
      });

      return {
        countBinsBG, sortBG_A, sortBG_B,
        densityBG_A, densityBG_B, forcesBG_A, forcesBG_B,
        integrateBG, homogAccumBG,
      };
    };

    const flipTrue = makeParticleBGs(buffers.particleBufferA, buffers.particleBufferB);
    const flipFalse = makeParticleBGs(buffers.particleBufferB, buffers.particleBufferA);

    return {
      clearBinsBG,
      prefixSumBGs,
      homogReduceBG,
      // Particle-dependent bind groups indexed by flip state
      byFlip: { true: flipTrue, false: flipFalse },
    };
  }
}
