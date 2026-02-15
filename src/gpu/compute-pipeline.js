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

    const countBinsBG = d.createBindGroup({
      label: 'count-bins-bg',
      layout: this.countBinsBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.binCountBuffer } },
        { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
        { binding: 2, resource: { buffer: buffers.particleBuffer } },
      ],
    });

    // Prefix sum: A->B and B->A bind groups for ping-pong
    const prefixSumAB = d.createBindGroup({
      label: 'prefix-sum-ab',
      layout: this.prefixSumBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.binOffsetBufferA } },
        { binding: 1, resource: { buffer: buffers.binOffsetBufferB } },
        { binding: 2, resource: { buffer: buffers.prefixParamsBuffer } },
      ],
    });
    const prefixSumBA = d.createBindGroup({
      label: 'prefix-sum-ba',
      layout: this.prefixSumBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.binOffsetBufferB } },
        { binding: 1, resource: { buffer: buffers.binOffsetBufferA } },
        { binding: 2, resource: { buffer: buffers.prefixParamsBuffer } },
      ],
    });

    // Sort: reuses bin_counts as atomic counters (cleared to 0 before sort)
    // bin_offsets comes from whichever buffer has the final prefix sum
    // We'll pass both offset buffers; frame.js picks the right one
    const makeSortBG = (offsetBuffer) => d.createBindGroup({
      label: 'sort-bg',
      layout: this.sortBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.binCountBuffer } },
        { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
        { binding: 2, resource: { buffer: buffers.particleBuffer } },
        { binding: 3, resource: { buffer: offsetBuffer } },
        { binding: 4, resource: { buffer: buffers.particleSortBuffer } },
      ],
    });
    const sortBG_A = makeSortBG(buffers.binOffsetBufferA);
    const sortBG_B = makeSortBG(buffers.binOffsetBufferB);

    // Density: uses sorted particle buffer + bin offsets + bin counts
    // After sort, bin_counts has been cleared and re-filled as atomic counters.
    // We need the original counts — so we re-derive from offsets.
    // Actually: after sort, frame.js copies sorted->main. Density reads main buffer.
    // bin_offsets come from whichever prefix sum buffer was final.
    // bin_counts: we need original counts. We'll re-count or store them.
    // Simplification: density/forces use the exclusive prefix sum offsets.
    // For count per bin: count[i] = offset[i+1] - offset[i].
    // But that requires the inclusive sum. Let's just store counts separately.
    // Actually the simplest: just use the same approach as sort — two variants.
    const makeDensityBG = (offsetBuffer, countBuffer) => d.createBindGroup({
      label: 'density-bg',
      layout: this.densityBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.particleBuffer } },
        { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
        { binding: 2, resource: { buffer: offsetBuffer } },
        { binding: 3, resource: { buffer: countBuffer } },
      ],
    });
    const densityBG_A = makeDensityBG(buffers.binOffsetBufferA, buffers.binCountBuffer);
    const densityBG_B = makeDensityBG(buffers.binOffsetBufferB, buffers.binCountBuffer);

    const makeForcesBG = (offsetBuffer, countBuffer) => d.createBindGroup({
      label: 'forces-bg',
      layout: this.forcesBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.particleBuffer } },
        { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
        { binding: 2, resource: { buffer: offsetBuffer } },
        { binding: 3, resource: { buffer: countBuffer } },
        { binding: 4, resource: { buffer: buffers.ballDataBuffer } },
      ],
    });
    const forcesBG_A = makeForcesBG(buffers.binOffsetBufferA, buffers.binCountBuffer);
    const forcesBG_B = makeForcesBG(buffers.binOffsetBufferB, buffers.binCountBuffer);

    const integrateBG = d.createBindGroup({
      label: 'integrate-bg',
      layout: this.integrateBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.particleBuffer } },
        { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
      ],
    });

    // Homogeneity bind groups
    const homogAccumBG = d.createBindGroup({
      label: 'homog-accum-bg',
      layout: this.homogAccumBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.homogCellBuffer } },
        { binding: 1, resource: { buffer: buffers.particleBuffer } },
        { binding: 2, resource: { buffer: buffers.simParamsBuffer } },
      ],
    });
    const homogReduceBG = d.createBindGroup({
      label: 'homog-reduce-bg',
      layout: this.homogReduceBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.homogCellBuffer } },
        { binding: 1, resource: { buffer: buffers.homogResultBuffer } },
      ],
    });

    return {
      clearBinsBG,
      countBinsBG,
      prefixSumAB,
      prefixSumBA,
      sortBG_A,
      sortBG_B,
      densityBG_A,
      densityBG_B,
      forcesBG_A,
      forcesBG_B,
      integrateBG,
      homogAccumBG,
      homogReduceBG,
    };
  }
}
