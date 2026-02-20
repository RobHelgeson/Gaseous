// ui-panel.js — lil-gui wrapper, binds config parameters to UI sliders

import GUI from '../lib/lil-gui.esm.min.js';
import { Config } from './config.js';
import { listThemes, getThemeNames } from './themes/theme-registry.js';

export class UIPanel {
  /** @type {GUI} */
  #gui;
  /** @type {Config} */
  #config;
  #visible = false;
  /** Proxy object that lil-gui reads/writes */
  #proxy = {};
  /** Controllers keyed by param name, for updating on theme switch */
  #controllers = {};
  /** Live performance stats (updated externally each frame) */
  perf = { fps: 0, frameTime: 0, activeParticles: 0, cycleState: 'SPAWNING' };
  /** Per-pass GPU timings (updated externally each frame) */
  passTimes = {
    clear_bins: 0, count_bins: 0, prefix_sum: 0, sort: 0,
    density: 0, forces: 0, integrate: 0, render_total: 0,
  };

  constructor(config) {
    this.#config = config;
    this.#gui = new GUI({ title: 'Gaseous' });
    this.#gui.domElement.style.position = 'fixed';
    this.#gui.domElement.style.top = '0';
    this.#gui.domElement.style.right = '0';
    this.#gui.domElement.style.zIndex = '1000';

    this.#buildFolders();

    // Start hidden for screensaver feel
    this.#gui.domElement.style.display = 'none';
  }

  #buildFolders() {
    const params = Config.PARAMS;
    const folders = {};

    // Theme selector at the top level for easy access
    this.#proxy.theme = this.#config.get('theme');
    this.#controllers.theme = this.#gui.add(this.#proxy, 'theme', getThemeNames())
      .name('Theme').onChange((v) => {
        this.#config.set('theme', v);
      });

    for (const [key, def] of Object.entries(params)) {
      if (key === 'theme') continue; // already added at top level

      const cat = def.category;
      if (!folders[cat]) {
        folders[cat] = this.#gui.addFolder(cat.charAt(0).toUpperCase() + cat.slice(1));
      }
      const folder = folders[cat];

      // Set proxy initial value
      this.#proxy[key] = this.#config.get(key);

      if (typeof def.value === 'boolean') {
        this.#controllers[key] = folder.add(this.#proxy, key).name(def.label).onChange((v) => {
          this.#config.set(key, v);
        });
      } else if (def.min !== undefined) {
        this.#controllers[key] = folder.add(this.#proxy, key, def.min, def.max, def.step).name(def.label).onChange((v) => {
          this.#config.set(key, v);
        });
      }
    }

    // Start with physics and cycle folders closed to reduce clutter
    if (folders.physics) folders.physics.close();
    if (folders.cycle) folders.cycle.close();

    // Performance folder (read-only live stats)
    const perf = this.#gui.addFolder('Performance');
    perf.add(this.perf, 'fps', 0, 120, 1).name('FPS').listen().disable();
    perf.add(this.perf, 'frameTime', 0, 50, 0.1).name('Frame ms').listen().disable();
    perf.add(this.perf, 'activeParticles', 0, 200000, 1).name('Particles').listen().disable();
    perf.add(this.perf, 'cycleState').name('Cycle').listen().disable();

    // GPU pass timings (only shown when timestamp-query is available)
    const gpuFolder = this.#gui.addFolder('GPU Passes (ms)');
    gpuFolder.add(this.passTimes, 'clear_bins', 0, 5, 0.001).name('Clear Bins').listen().disable();
    gpuFolder.add(this.passTimes, 'count_bins', 0, 5, 0.001).name('Count Bins').listen().disable();
    gpuFolder.add(this.passTimes, 'prefix_sum', 0, 5, 0.001).name('Prefix Sum').listen().disable();
    gpuFolder.add(this.passTimes, 'sort', 0, 5, 0.001).name('Sort').listen().disable();
    gpuFolder.add(this.passTimes, 'density', 0, 5, 0.001).name('Density').listen().disable();
    gpuFolder.add(this.passTimes, 'forces', 0, 5, 0.001).name('Forces').listen().disable();
    gpuFolder.add(this.passTimes, 'integrate', 0, 5, 0.001).name('Integrate').listen().disable();
    gpuFolder.add(this.passTimes, 'render_total', 0, 5, 0.001).name('Render').listen().disable();
    gpuFolder.close();
  }

  /** Refresh all proxy values from config (e.g. after theme switch) */
  refreshFromConfig() {
    const params = Config.PARAMS;
    for (const key of Object.keys(params)) {
      const val = this.#config.get(key);
      if (this.#proxy[key] !== val) {
        this.#proxy[key] = val;
        if (this.#controllers[key]) {
          this.#controllers[key].updateDisplay();
        }
      }
    }
  }

  toggle() {
    this.#visible = !this.#visible;
    this.#gui.domElement.style.display = this.#visible ? '' : 'none';
  }

  get visible() { return this.#visible; }

  destroy() {
    this.#gui.destroy();
  }
}
