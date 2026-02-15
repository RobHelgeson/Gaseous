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
  integratePipeline = null;

  // Bind group layouts
  clearBinsBGL = null;
  countBinsBGL = null;
  sortBGL = null;
  prefixSumBGL = null;
  integrateBGL = null;

  async init(device) {
    this.#device = device;
    await Promise.all([
      this.#createSpatialHashPipelines(),
      this.#createPrefixSumPipeline(),
      this.#createIntegratePipeline(),
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

    const integrateBG = d.createBindGroup({
      label: 'integrate-bg',
      layout: this.integrateBGL,
      entries: [
        { binding: 0, resource: { buffer: buffers.particleBuffer } },
        { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
      ],
    });

    return {
      clearBinsBG,
      countBinsBG,
      prefixSumAB,
      prefixSumBA,
      sortBG_A,
      sortBG_B,
      integrateBG,
    };
  }
}
