// render-pipeline.js — Render pipeline creation for background, particles, and tonemap

import { loadShader, loadParticleShader } from './shader-loader.js';

export class RenderPipelines {
  /** @type {GPUDevice} */
  #device;

  backgroundPipeline = null;
  backgroundBindGroupLayout = null;

  particlePipeline = null;
  particleBindGroupLayout = null;

  fogPipeline = null;
  fogBindGroupLayout = null;

  tonemapPipeline = null;
  tonemapBindGroupLayout = null;

  async init(device, canvasFormat) {
    this.#device = device;

    await Promise.all([
      this.#createBackgroundPipeline(canvasFormat),
      this.#createFogPipeline(),
      this.#createParticlePipeline(canvasFormat),
      this.#createTonemapPipeline(canvasFormat),
    ]);
  }

  async #createBackgroundPipeline() {
    const [vertCode, fragCode] = await Promise.all([
      loadShader('src/shaders/background-vertex.wgsl'),
      loadShader('src/shaders/nebula-background.wgsl'),
    ]);

    const vertModule = this.#device.createShaderModule({ label: 'bg-vert', code: vertCode });
    const fragModule = this.#device.createShaderModule({ label: 'bg-frag', code: fragCode });

    this.backgroundBindGroupLayout = this.#device.createBindGroupLayout({
      label: 'bg-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    this.backgroundPipeline = this.#device.createRenderPipeline({
      label: 'backgroundPipeline',
      layout: this.#device.createPipelineLayout({
        bindGroupLayouts: [this.backgroundBindGroupLayout],
      }),
      vertex: { module: vertModule, entryPoint: 'vs_main' },
      fragment: {
        module: fragModule,
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  async #createFogPipeline() {
    const code = await loadParticleShader('src/shaders/ball-fog.wgsl');
    const module = this.#device.createShaderModule({ label: 'ball-fog', code });

    this.fogBindGroupLayout = this.#device.createBindGroupLayout({
      label: 'fog-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    this.fogPipeline = this.#device.createRenderPipeline({
      label: 'fogPipeline',
      layout: this.#device.createPipelineLayout({
        bindGroupLayouts: [this.fogBindGroupLayout],
      }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  async #createParticlePipeline() {
    const [vertCode, fragCode] = await Promise.all([
      loadParticleShader('src/shaders/particle-vertex.wgsl'),
      loadShader('src/shaders/nebula-fragment.wgsl'),
    ]);

    const vertModule = this.#device.createShaderModule({ label: 'particle-vert', code: vertCode });
    const fragModule = this.#device.createShaderModule({ label: 'particle-frag', code: fragCode });

    this.particleBindGroupLayout = this.#device.createBindGroupLayout({
      label: 'particle-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });

    this.particlePipeline = this.#device.createRenderPipeline({
      label: 'particlePipeline',
      layout: this.#device.createPipelineLayout({
        bindGroupLayouts: [this.particleBindGroupLayout],
      }),
      vertex: { module: vertModule, entryPoint: 'vs_main' },
      fragment: {
        module: fragModule,
        entryPoint: 'fs_main',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  async #createTonemapPipeline(canvasFormat) {
    const code = await loadShader('src/shaders/tonemap.wgsl');
    const module = this.#device.createShaderModule({ label: 'tonemap', code });

    this.tonemapBindGroupLayout = this.#device.createBindGroupLayout({
      label: 'tonemap-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    this.tonemapPipeline = this.#device.createRenderPipeline({
      label: 'tonemapPipeline',
      layout: this.#device.createPipelineLayout({
        bindGroupLayouts: [this.tonemapBindGroupLayout],
      }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: canvasFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  /** Create bind groups that reference current buffers/textures */
  createBindGroups(buffers) {
    const device = this.#device;

    const particleBG = device.createBindGroup({
      label: 'particle-bg',
      layout: this.particleBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buffers.particleBuffer } },
        { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
      ],
    });

    const fogBG = device.createBindGroup({
      label: 'fog-bg',
      layout: this.fogBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buffers.ballDataBuffer } },
        { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
      ],
    });

    const tonemapBG = device.createBindGroup({
      label: 'tonemap-bg',
      layout: this.tonemapBindGroupLayout,
      entries: [
        { binding: 0, resource: buffers.hdrView },
        { binding: 1, resource: buffers.hdrSampler },
      ],
    });

    return { particleBG, fogBG, tonemapBG };
  }

  /** Create background bind group with uniform buffer */
  createBackgroundBindGroup(bgParamsBuffer) {
    return this.#device.createBindGroup({
      label: 'bg-bg',
      layout: this.backgroundBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: bgParamsBuffer } },
      ],
    });
  }
}
