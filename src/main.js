// main.js — Entry point and orchestrator

import { GpuContext } from './gpu-context.js';
import { Config } from './config.js';
import { Input } from './input.js';
import { UIPanel } from './ui-panel.js';
import { Buffers } from './gpu/buffers.js';
import { RenderPipelines } from './gpu/render-pipeline.js';
import { ComputePipelines } from './gpu/compute-pipeline.js';
import { FrameEncoder } from './gpu/frame.js';
import { loadSharedStructs } from './gpu/shader-loader.js';

async function main() {
  const canvas = document.getElementById('canvas');
  const config = new Config();
  const gpu = new GpuContext();

  const ok = await gpu.init(canvas);
  if (!ok) return;

  console.log('WebGPU initialized',
    `${gpu.width}x${gpu.height}`,
    gpu.hasTimestampQuery ? '(timestamp-query available)' : '(no timestamp-query)');

  // Preload shared structs, then create pipelines
  await loadSharedStructs();

  const buffers = new Buffers(gpu.device);
  buffers.init(config.get('particleCount'), gpu.width, gpu.height, config.get('sphRadius'));

  const renderPipelines = new RenderPipelines();
  const computePipelines = new ComputePipelines();
  await Promise.all([
    renderPipelines.init(gpu.device, gpu.format),
    computePipelines.init(gpu.device),
  ]);

  const frameEncoder = new FrameEncoder(gpu.device, renderPipelines, computePipelines, buffers);

  const input = new Input(canvas, config);
  const ui = new UIPanel(config);

  // Wire input events
  input.onPause((paused) => {
    console.log(paused ? 'Paused' : 'Resumed');
  });
  input.onRestart(() => {
    console.log('Restart cycle');
  });
  input.onToggleUI(() => {
    ui.toggle();
  });

  // Log config changes
  config.onChange((key, value, old) => {
    console.log(`Config: ${key} ${old} → ${value}`);
  });

  // Frame loop
  let frameNumber = 0;

  function frame() {
    requestAnimationFrame(frame);

    if (input.paused) return;

    const resized = gpu.handleResize();
    if (resized) {
      buffers.handleResize(gpu.width, gpu.height, config.get('sphRadius'));
      frameEncoder.rebuildBindGroups();
    }

    // Upload sim params
    const simData = config.toSimParams(
      gpu.width, gpu.height,
      input.mouseX, input.mouseY,
      frameNumber,
    );
    buffers.uploadSimParams(simData);

    // Render
    frameEncoder.render(gpu, config.get('particleCount'), buffers.binCount);

    frameNumber++;
  }

  requestAnimationFrame(frame);

  // Expose for debugging
  window.__gaseous = { config, gpu, input, ui, buffers, renderPipelines, computePipelines };
}

main();
