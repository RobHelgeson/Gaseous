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
import { BallManager } from './ball-manager.js';
import { CycleManager } from './cycle-manager.js';
import { GpuTiming, GpuPassTimer } from './gpu/gpu-timing.js';
import { loadThemes, getActiveTheme, setActiveTheme, getTheme, nextThemeId } from './themes/theme-registry.js';

async function main() {
  const canvas = document.getElementById('canvas');
  const config = new Config();
  const gpu = new GpuContext();

  const ok = await gpu.init(canvas);
  if (!ok) return;

  console.log('WebGPU initialized',
    `${gpu.width}x${gpu.height}`,
    gpu.hasTimestampQuery ? '(timestamp-query available)' : '(no timestamp-query)');

  // Preload shared structs and themes, then create pipelines
  await Promise.all([loadSharedStructs(), loadThemes()]);

  // Apply initial theme defaults to config
  const initialTheme = getActiveTheme();
  config.applyTheme(initialTheme);

  const ballManager = new BallManager(
    config.get('ballCount'),
    config.get('particleCount'),
    gpu.width, gpu.height,
  );

  const buffers = new Buffers(gpu.device);
  buffers.init(config.get('particleCount'), gpu.width, gpu.height, config.get('sphRadius'), ballManager);

  const renderPipelines = new RenderPipelines();
  const computePipelines = new ComputePipelines();
  await Promise.all([
    renderPipelines.init(gpu.device, gpu.format, initialTheme),
    computePipelines.init(gpu.device),
  ]);

  const frameEncoder = new FrameEncoder(gpu.device, renderPipelines, computePipelines, buffers);
  const passTimer = new GpuPassTimer(gpu.device, gpu.hasTimestampQuery);
  frameEncoder.setPassTimer(passTimer);

  // Cycle manager — respawn callback reinits buffers + bind groups
  const cycleManager = new CycleManager(config, ballManager, () => {
    buffers.init(config.get('particleCount'), gpu.width, gpu.height, config.get('sphRadius'), ballManager);
    frameEncoder.rebuildBindGroups();
  });

  const gpuTiming = new GpuTiming(
    config.get('particleCount'),
    config.get('adaptiveParticles'),
  );

  const input = new Input(canvas, config);
  const ui = new UIPanel(config);

  // Wire input events
  input.onPause((paused) => {
    console.log(paused ? 'Paused' : 'Resumed');
  });
  input.onRestart(() => {
    cycleManager.restart();
  });
  input.onToggleUI(() => {
    ui.toggle();
    input.setKeepCursorVisible(ui.visible);
  });
  input.onCycleTheme(() => {
    const next = nextThemeId(config.get('theme'));
    config.set('theme', next);
  });

  // Handle config changes
  config.onChange((key, value, old) => {
    console.log(`Config: ${key} ${old} → ${value}`);
    if (key === 'particleCount') {
      gpuTiming.setCeiling(value);
      ballManager.respawn(config.get('ballCount'), value);
      buffers.init(value, gpu.width, gpu.height, config.get('sphRadius'), ballManager);
      frameEncoder.rebuildBindGroups();
    }
    if (key === 'adaptiveParticles') {
      gpuTiming.setEnabled(value);
    }
  });

  // Theme switching — recreates render pipelines with new blend states and shaders
  let themeSwitching = false;
  config.onChange(async (key, value) => {
    if (key !== 'theme' || themeSwitching) return;
    const newTheme = getTheme(value);
    if (!newTheme || newTheme.id === getActiveTheme().id) return;

    themeSwitching = true;
    console.log(`Theme: switching to ${newTheme.name}`);
    setActiveTheme(newTheme.id);

    // Apply theme param defaults to config (fires onChange for each param)
    config.applyTheme(newTheme);

    // Recreate render pipelines with new blend states and shaders
    await renderPipelines.init(gpu.device, gpu.format, newTheme);

    // Reinit ball manager + buffers with new theme colors and params
    ballManager.respawn(config.get('ballCount'), config.get('particleCount'));
    buffers.init(config.get('particleCount'), gpu.width, gpu.height, config.get('sphRadius'), ballManager);
    frameEncoder.rebuildBindGroups();
    frameEncoder.rebuildBgBindGroup();

    // Restart the cycle
    cycleManager.restart();

    // Refresh UI sliders to show new param values
    ui.refreshFromConfig();

    themeSwitching = false;
    console.log(`Theme: ${newTheme.name} active`);
  });

  // Frame loop
  let frameNumber = 0;

  function frame() {
    requestAnimationFrame(frame);

    if (input.paused || themeSwitching) return;

    gpuTiming.beginFrame();

    const resized = gpu.handleResize();
    if (resized) {
      buffers.handleResize(gpu.width, gpu.height, config.get('sphRadius'));
      ballManager.updateCanvasSize(gpu.width, gpu.height);
      frameEncoder.rebuildBindGroups();
    }

    // Advance cycle state machine (may trigger respawn)
    cycleManager.update(1 / 60);

    // Update ball positions
    ballManager.update(1 / 60, config.get('bounceDamping'), config.get('ballGravity'));

    // Adaptive particle count (dispatch size only, buffers stay at ceiling)
    gpuTiming.update();
    const activeCount = gpuTiming.activeParticleCount;

    // Upload sim params (with cycle fade alpha + adaptive count) + ball data
    const simData = config.toSimParams(
      gpu.width, gpu.height,
      input.mouseX, input.mouseY,
      frameNumber,
      cycleManager.fadeAlpha,
      activeCount,
    );
    buffers.uploadSimParams(simData);
    buffers.uploadBallData(ballManager.toGpuData());

    // Check if we should run homogeneity this frame
    const runHomog = cycleManager.shouldCheckHomogeneity(frameNumber) &&
                     buffers.homogReadbackAvailable;

    // Render — dispatch activeCount but bin buffers use full allocated size
    frameEncoder.render(gpu, activeCount, buffers.binCount, runHomog, config.get('ballCount'));

    // Async homogeneity readback (non-blocking, 1-2 frames behind)
    if (runHomog) {
      buffers.readHomogeneity().then(v => {
        cycleManager.onHomogeneityResult(v);
      });
    }

    // Update performance display
    ui.perf.fps = gpuTiming.fps;
    ui.perf.frameTime = gpuTiming.avgFrameTime;
    ui.perf.activeParticles = activeCount;
    ui.perf.cycleState = cycleManager.state;

    // Update per-pass GPU timings
    if (passTimer.enabled) {
      const timings = passTimer.getPassTimings();
      for (const [name, ms] of timings) {
        ui.passTimes[name] = ms;
      }
    }

    frameNumber++;
  }

  requestAnimationFrame(frame);

  // Expose for debugging
  window.__gaseous = { config, gpu, input, ui, buffers, ballManager, cycleManager, gpuTiming, passTimer, renderPipelines, computePipelines };
}

main();
