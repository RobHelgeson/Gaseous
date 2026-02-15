// compute-pipeline.js — Compute pipeline and bind group creation

import { loadComputeShader } from './shader-loader.js';

export class ComputePipelines {
  /** @type {GPUDevice} */
  #device;

  integratePipeline = null;
  integrateBindGroupLayout = null;

  async init(device) {
    this.#device = device;
    await this.#createIntegratePipeline();
  }

  async #createIntegratePipeline() {
    const code = await loadComputeShader('src/shaders/integrate.wgsl');
    const module = this.#device.createShaderModule({ label: 'integrate', code });

    this.integrateBindGroupLayout = this.#device.createBindGroupLayout({
      label: 'integrate-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    this.integratePipeline = this.#device.createComputePipeline({
      label: 'integratePipeline',
      layout: this.#device.createPipelineLayout({
        bindGroupLayouts: [this.integrateBindGroupLayout],
      }),
      compute: { module, entryPoint: 'cs_main' },
    });
  }

  createBindGroups(buffers) {
    return {
      integrateBG: this.#device.createBindGroup({
        label: 'integrate-bg',
        layout: this.integrateBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: buffers.particleBuffer } },
          { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
        ],
      }),
    };
  }
}
