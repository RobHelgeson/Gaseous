// ui-panel.js — lil-gui wrapper, binds config parameters to UI sliders

import GUI from '../lib/lil-gui.esm.min.js';
import { Config } from './config.js';

export class UIPanel {
  /** @type {GUI} */
  #gui;
  /** @type {Config} */
  #config;
  #visible = true;
  /** Proxy object that lil-gui reads/writes */
  #proxy = {};

  constructor(config) {
    this.#config = config;
    this.#gui = new GUI({ title: 'Gaseous' });
    this.#gui.domElement.style.position = 'fixed';
    this.#gui.domElement.style.top = '0';
    this.#gui.domElement.style.right = '0';
    this.#gui.domElement.style.zIndex = '1000';

    this.#buildFolders();
  }

  #buildFolders() {
    const params = Config.PARAMS;
    const folders = {};

    for (const [key, def] of Object.entries(params)) {
      const cat = def.category;
      if (!folders[cat]) {
        folders[cat] = this.#gui.addFolder(cat.charAt(0).toUpperCase() + cat.slice(1));
      }
      const folder = folders[cat];

      // Set proxy initial value
      this.#proxy[key] = this.#config.get(key);

      if (typeof def.value === 'boolean') {
        folder.add(this.#proxy, key).name(def.label).onChange((v) => {
          this.#config.set(key, v);
        });
      } else if (typeof def.value === 'string') {
        // Theme dropdown — only nebula for now
        folder.add(this.#proxy, key, ['nebula']).name(def.label).onChange((v) => {
          this.#config.set(key, v);
        });
      } else if (def.min !== undefined) {
        folder.add(this.#proxy, key, def.min, def.max, def.step).name(def.label).onChange((v) => {
          this.#config.set(key, v);
        });
      }
    }

    // Start with physics and cycle folders closed to reduce clutter
    if (folders.physics) folders.physics.close();
    if (folders.cycle) folders.cycle.close();
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
