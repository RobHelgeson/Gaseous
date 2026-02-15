// config.js — Reactive configuration with defaults, ranges, and onChange listeners

const PARAM_DEFS = {
  // Simulation
  particleCount:       { value: 50000, min: 1000,  max: 200000, step: 1000,  category: 'simulation', label: 'Particles' },
  adaptiveParticles:   { value: true,                                         category: 'simulation', label: 'Adaptive' },

  // Physics
  sphRadius:           { value: 25.0,  min: 5.0,   max: 100.0,  step: 1.0,   category: 'physics', label: 'SPH Radius' },
  restDensity:         { value: 1.0,   min: 0.1,   max: 5.0,    step: 0.1,   category: 'physics', label: 'Rest Density' },
  gasConstant:         { value: 200.0, min: 10.0,  max: 2000.0, step: 10.0,  category: 'physics', label: 'Gas Constant' },
  viscosity:           { value: 50.0,  min: 0.0,   max: 500.0,  step: 5.0,   category: 'physics', label: 'Viscosity' },
  attractorBase:       { value: 500.0, min: 0.0,   max: 2000.0, step: 10.0,  category: 'physics', label: 'Attractor Base' },
  attractorDecay:      { value: 0.02,  min: 0.001, max: 0.1,    step: 0.001, category: 'physics', label: 'Attractor Decay' },
  gravityConstant:     { value: 100.0, min: 0.0,   max: 1000.0, step: 10.0,  category: 'physics', label: 'Gravity' },
  dragCoefficient:     { value: 0.01,  min: 0.0,   max: 0.1,    step: 0.005, category: 'physics', label: 'Drag' },
  bounceDamping:       { value: 0.7,   min: 0.1,   max: 1.0,    step: 0.05,  category: 'physics', label: 'Bounce Damping' },

  // Cycle
  ballCount:           { value: 3,     min: 2,     max: 5,      step: 1,     category: 'cycle', label: 'Ball Count' },
  homogeneityThreshold:{ value: 0.05,  min: 0.01,  max: 0.2,    step: 0.01,  category: 'cycle', label: 'Homogeneity' },

  // Interaction
  mouseForce:          { value: 0.0,   min: 0.0,   max: 500.0,  step: 10.0,  category: 'interaction', label: 'Mouse Force' },

  // Visual
  particleScale:       { value: 1.0,   min: 0.1,   max: 5.0,    step: 0.1,   category: 'visual', label: 'Particle Scale' },
  theme:               { value: 'nebula',                                      category: 'visual', label: 'Theme' },
};

export class Config {
  #values = {};
  #listeners = [];

  constructor() {
    for (const [key, def] of Object.entries(PARAM_DEFS)) {
      this.#values[key] = def.value;
    }
  }

  get(key) {
    return this.#values[key];
  }

  set(key, value) {
    if (!(key in PARAM_DEFS)) return;
    const def = PARAM_DEFS[key];
    if (def.min !== undefined) {
      value = Math.max(def.min, Math.min(def.max, value));
    }
    if (this.#values[key] === value) return;
    const old = this.#values[key];
    this.#values[key] = value;
    for (const fn of this.#listeners) {
      fn(key, value, old);
    }
  }

  onChange(fn) {
    this.#listeners.push(fn);
    return () => {
      const i = this.#listeners.indexOf(fn);
      if (i >= 0) this.#listeners.splice(i, 1);
    };
  }

  /** Returns all current values as a plain object */
  snapshot() {
    return { ...this.#values };
  }

  /** Pack numeric params into a Float32Array for GPU upload */
  toSimParams(canvasWidth, canvasHeight, mouseX, mouseY, frameNumber) {
    const v = this.#values;
    const binSize = v.sphRadius;
    const binsX = Math.ceil(canvasWidth / binSize);
    const binsY = Math.ceil(canvasHeight / binSize);

    // Must match SimParams struct layout in shared-structs.wgsl
    const buf = new ArrayBuffer(128);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);

    f32[0]  = 1 / 60;            // dt (fixed timestep)
    u32[1]  = v.particleCount;    // particle_count
    u32[2]  = v.ballCount;        // ball_count
    f32[3]  = canvasWidth;        // canvas_width
    f32[4]  = canvasHeight;       // canvas_height
    f32[5]  = v.sphRadius;        // sph_radius
    f32[6]  = v.restDensity;      // rest_density
    f32[7]  = v.gasConstant;      // gas_constant
    f32[8]  = v.viscosity;        // viscosity
    f32[9]  = v.attractorBase;    // attractor_base
    f32[10] = v.gravityConstant;  // gravity_constant
    f32[11] = v.dragCoefficient;  // drag_coefficient
    f32[12] = binSize;            // bin_size
    u32[13] = binsX;              // bins_x
    u32[14] = binsY;              // bins_y
    f32[15] = mouseX;             // mouse_x
    f32[16] = mouseY;             // mouse_y
    f32[17] = v.mouseForce;       // mouse_force
    u32[18] = frameNumber;        // frame_number
    f32[19] = v.particleScale;    // particle_scale

    return buf;
  }

  static get PARAMS() {
    return PARAM_DEFS;
  }
}
