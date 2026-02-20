// render-pipeline.js — Render pipeline creation for background, particles, fog, and tonemap

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

  resolvePipeline = null;
  resolveBindGroupLayout = null;

  async init(device, canvasFormat, theme) {
    this.#device = device;

    await Promise.all([
      this.#createBackgroundPipeline(theme),
      this.#createFogPipeline(theme),
      this.#createParticlePipeline(theme),
      this.#createTonemapPipeline(canvasFormat),
      this.#createResolvePipeline(theme),
    ]);
  }

  async #createBackgroundPipeline(theme) {
    const bgShader = theme.rendering.backgroundShader;
    const [vertCode, fragCode] = await Promise.all([
      loadShader('src/shaders/background-vertex.wgsl'),
      loadShader(bgShader),
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

  async #createFogPipeline(theme) {
    const code = await loadParticleShader('src/shaders/ball-fog.wgsl');
    const module = this.#device.createShaderModule({ label: 'ball-fog', code });

    const fogBlend = theme.rendering.blendState.fog;

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
          blend: fogBlend,
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  async #createParticlePipeline(theme) {
    const fragShader = theme.rendering.fragmentShader;
    const [vertCode, fragCode] = await Promise.all([
      loadParticleShader('src/shaders/particle-vertex.wgsl'),
      loadShader(fragShader),
    ]);

    const vertModule = this.#device.createShaderModule({ label: 'particle-vert', code: vertCode });
    const fragModule = this.#device.createShaderModule({ label: 'particle-frag', code: fragCode });

    const particleBlend = theme.rendering.blendState.particle;

    this.particleBindGroupLayout = this.#device.createBindGroupLayout({
      label: 'particle-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
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
          blend: particleBlend,
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

  async #createResolvePipeline(theme) {
    const resolveShader = theme.rendering.resolveShader;
    if (!resolveShader) {
      this.resolvePipeline = null;
      this.resolveBindGroupLayout = null;
      return;
    }

    const code = await loadShader(resolveShader);
    const module = this.#device.createShaderModule({ label: 'metaball-resolve', code });

    this.resolveBindGroupLayout = this.#device.createBindGroupLayout({
      label: 'resolve-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    this.resolvePipeline = this.#device.createRenderPipeline({
      label: 'resolvePipeline',
      layout: this.#device.createPipelineLayout({
        bindGroupLayouts: [this.resolveBindGroupLayout],
      }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  /** Create bind groups that reference current buffers/textures.
   *  Particle rendering reads from the sort target buffer (has sorted + integrated data).
   *  Returns bind groups for both flip orientations. */
  createBindGroups(buffers) {
    const device = this.#device;

    // Fog and tonemap don't depend on particle buffer orientation
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

    // Particle BG per flip state: render reads from sort target
    const makeParticleBG = (sortTargetBuf) => device.createBindGroup({
      label: 'particle-bg',
      layout: this.particleBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: sortTargetBuf } },
        { binding: 1, resource: { buffer: buffers.simParamsBuffer } },
        { binding: 2, resource: { buffer: buffers.ballDataBuffer } },
      ],
    });

    return {
      fogBG,
      tonemapBG,
      particleBGByFlip: {
        true: makeParticleBG(buffers.particleBufferB),   // flip=true -> sort target is B
        false: makeParticleBG(buffers.particleBufferA),  // flip=false -> sort target is A
      },
    };
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

  /** Create resolve bind group for metaball theme. Returns null if no resolve pipeline. */
  createResolveBindGroup(buffers, resolveParamsBuffer) {
    if (!this.resolveBindGroupLayout) return null;
    return this.#device.createBindGroup({
      label: 'resolve-bg',
      layout: this.resolveBindGroupLayout,
      entries: [
        { binding: 0, resource: buffers.energyView },
        { binding: 1, resource: buffers.hdrSampler },
        { binding: 2, resource: { buffer: resolveParamsBuffer } },
      ],
    });
  }
}
