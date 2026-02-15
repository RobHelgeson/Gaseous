// main.js — Entry point and orchestrator

import { GpuContext } from './gpu-context.js';
import { Config } from './config.js';
import { Input } from './input.js';
import { UIPanel } from './ui-panel.js';

async function main() {
  const canvas = document.getElementById('canvas');
  const config = new Config();
  const gpu = new GpuContext();

  const ok = await gpu.init(canvas);
  if (!ok) return;

  console.log('WebGPU initialized',
    `${gpu.width}x${gpu.height}`,
    gpu.hasTimestampQuery ? '(timestamp-query available)' : '(no timestamp-query)');

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

  // Log config changes during scaffolding phase
  config.onChange((key, value, old) => {
    console.log(`Config: ${key} ${old} → ${value}`);
  });

  // Frame loop stub — will be replaced by simulation in Phase 2+
  let frameNumber = 0;
  let running = true;

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);

    if (input.paused) return;

    const resized = gpu.handleResize();
    if (resized) {
      console.log(`Resized to ${gpu.width}x${gpu.height}`);
    }

    frameNumber++;
  }

  requestAnimationFrame(frame);

  // Expose for debugging
  window.__gaseous = { config, gpu, input, ui };
}

main();
