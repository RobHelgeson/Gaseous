// config.js — Reactive configuration with defaults, ranges, and onChange listeners

const PARAM_DEFS = {
  // Simulation
  particleCount:       { value: 50000, min: 1000,  max: 200000, step: 1000,  category: 'simulation', label: 'Particles' },
  adaptiveParticles:   { value: false,                                        category: 'simulation', label: 'Adaptive' },

  // Physics
  sphRadius:           { value: 25.0,  min: 5.0,   max: 100.0,  step: 1.0,   category: 'physics', label: 'SPH Radius' },
  restDensity:         { value: 1.0,   min: 0.1,   max: 5.0,    step: 0.1,   category: 'physics', label: 'Rest Density' },
  gasConstant:         { value: 200.0, min: 10.0,  max: 2000.0, step: 10.0,  category: 'physics', label: 'Gas Constant' },
  viscosity:           { value: 50.0,  min: 0.0,   max: 500.0,  step: 5.0,   category: 'physics', label: 'Viscosity' },
  attractorBase:       { value: 800.0, min: 0.0,   max: 2000.0, step: 10.0,  category: 'physics', label: 'Attractor Base' },
  attractorDecay:      { value: 0.005, min: 0.0,   max: 0.1,    step: 0.001, category: 'physics', label: 'Attractor Decay' },
  tidalStripping:      { value: 0.002, min: 0.0,   max: 0.01,   step: 0.0005,category: 'physics', label: 'Tidal Stripping' },
  gravityConstant:     { value: 100.0, min: 0.0,   max: 1000.0, step: 10.0,  category: 'physics', label: 'Particle Gravity' },
  ballGravity:         { value: 400.0, min: 0.0,   max: 5000.0, step: 50.0,  category: 'physics', label: 'Ball Gravity' },
  dragCoefficient:     { value: 0.01,  min: 0.0,   max: 0.1,    step: 0.005, category: 'physics', label: 'Drag' },
  bounceDamping:       { value: 0.7,   min: 0.1,   max: 1.0,    step: 0.05,  category: 'physics', label: 'Bounce Damping' },

  // Cycle
  ballCount:           { value: 3,     min: 2,     max: 5,      step: 1,     category: 'cycle', label: 'Ball Count' },
  autoCycle:           { value: true,                                         category: 'cycle', label: 'Auto Cycle' },
  homogeneityThreshold:{ value: 0.05,  min: 0.01,  max: 0.2,    step: 0.01,  category: 'cycle', label: 'Homogeneity' },

  // Interaction
  mouseForce:          { value: 0.0,   min: 0.0,   max: 500.0,  step: 10.0,  category: 'interaction', label: 'Mouse Force' },

  // Visual
  particleScale:       { value: 1.0,   min: 0.1,   max: 5.0,    step: 0.1,   category: 'visual', label: 'Particle Scale' },
  intensityFalloff:    { value: 1.5,   min: 0.0,   max: 5.0,    step: 0.1,   category: 'visual', label: 'Intensity Falloff' },
  intensityFloor:      { value: 0.03,  min: 0.01,  max: 0.5,    step: 0.01,  category: 'visual', label: 'Intensity Floor' },
  brightnessFalloff:   { value: 1.5,   min: 0.0,   max: 5.0,    step: 0.1,   category: 'visual', label: 'Brightness Falloff' },
  brightnessFloor:     { value: 0.05,  min: 0.01,  max: 0.5,    step: 0.01,  category: 'visual', label: 'Brightness Floor' },
  fogIntensity:        { value: 0.15,  min: 0.0,   max: 1.0,    step: 0.01,  category: 'visual', label: 'Fog Intensity' },
  fogFalloff:          { value: 4.0,   min: 0.5,   max: 10.0,   step: 0.5,   category: 'visual', label: 'Fog Falloff' },
  fogSize:             { value: 2.5,   min: 1.0,   max: 8.0,    step: 0.5,   category: 'visual', label: 'Fog Size' },
  glowFalloff:         { value: 2.5,   min: 0.5,   max: 8.0,    step: 0.1,   category: 'visual', label: 'Glow Falloff' },
  theme:               { value: 'nebula',                                      category: 'visual', label: 'Theme' },
};

// Parameters that are theme-owned (reset when theme changes)
const THEME_PARAMS = new Set([
  // physics
  'sphRadius', 'restDensity', 'gasConstant', 'viscosity', 'attractorBase',
  'attractorDecay', 'tidalStripping', 'gravityConstant', 'ballGravity',
  'dragCoefficient', 'bounceDamping',
  // visual
  'particleScale', 'intensityFalloff', 'intensityFloor', 'brightnessFalloff',
  'brightnessFloor', 'fogIntensity', 'fogFalloff', 'fogSize', 'glowFalloff',
  // cycle
  'ballCount',
]);

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

  /** Apply theme defaults to all theme-owned parameters */
  applyTheme(theme) {
    const map = {
      ...theme.physics,
      ...theme.visual,
      ballCount: theme.cycle.ballCount,
    };
    for (const [key, val] of Object.entries(map)) {
      if (THEME_PARAMS.has(key)) {
        this.set(key, val);
      }
    }
    this.set('theme', theme.id);
  }

  /** Returns all current values as a plain object */
  snapshot() {
    return { ...this.#values };
  }

  /** Pack numeric params into a Float32Array for GPU upload */
  toSimParams(canvasWidth, canvasHeight, mouseX, mouseY, frameNumber, fadeAlpha = 1.0, activeParticleCount = null) {
    const v = this.#values;
    const binSize = v.sphRadius;
    const binsX = Math.ceil(canvasWidth / binSize);
    const binsY = Math.ceil(canvasHeight / binSize);

    // Must match SimParams struct layout in shared-structs.wgsl (40 × f32 = 160 bytes)
    const buf = new ArrayBuffer(160);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);

    const h = v.sphRadius;
    const h2 = h * h;
    const h6 = h2 * h2 * h2;
    const h9 = h6 * h2 * h;
    const PI = Math.PI;

    f32[0]  = 1 / 60;            // dt (fixed timestep)
    u32[1]  = activeParticleCount || v.particleCount; // particle_count (adaptive override)
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
    f32[20] = fadeAlpha;          // fade_alpha
    f32[21] = v.attractorDecay;   // attractor_decay
    f32[22] = v.bounceDamping;   // bounce_damping
    f32[23] = v.tidalStripping;  // tidal_stripping
    f32[24] = v.fogIntensity;   // fog_intensity
    f32[25] = v.fogFalloff;     // fog_falloff
    f32[26] = v.fogSize;        // fog_size
    f32[27] = v.intensityFalloff; // intensity_falloff
    f32[28] = v.intensityFloor;   // intensity_floor
    f32[29] = v.brightnessFalloff; // brightness_falloff
    f32[30] = v.brightnessFloor;   // brightness_floor
    f32[31] = v.glowFalloff;      // glow_falloff
    // Precomputed kernel coefficients (avoid per-interaction pow/division)
    f32[32] = 315.0 / (64.0 * PI * h9);  // poly6_scale
    f32[33] = -45.0 / (PI * h6);         // spiky_scale
    f32[34] = 45.0 / (PI * h6);          // visc_scale
    f32[35] = 1.0 / binSize;             // inv_bin_size
    f32[36] = h2;                         // sph_radius_sq

    return buf;
  }

  static get PARAMS() {
    return PARAM_DEFS;
  }

  static get THEME_PARAMS() {
    return THEME_PARAMS;
  }
}
