---
title: "Gaseous - Technical Architecture"
created: 2026-02-14 12:00
updated: 2026-02-14 12:00
tags: [project, gaseous, architecture, webgpu, sph]
parent: "[[Gaseous]]"
---

# Technical Architecture

Parent project: [[Gaseous]]

## Technology Stack

- **WebGPU compute shaders** -- no WebGL fallback (friendly warning if unsupported)
- **Safari 18+** (macOS Sequoia, fall 2024) has WebGPU with compute shaders enabled by default
- **Vanilla ES modules** -- multiple `.js` files loaded via `import`, served directly
- **No build step, no compilation** -- browser-ready as-is
- **GitHub Pages** hosting
- **lil-gui** (vendored ESM `lib/lil-gui.esm.min.js`, ~30KB) for settings panel
- **WGSL** for all shader code
- Target resolution: 1080p-2K (1920x1080 to 2560x1440)

### LLM-Maintainability Constraint

All files designed for LLM-assisted development:
- No JS file exceeds ~400 lines
- No WGSL file exceeds ~300 lines
- `shared-structs.wgsl` is string-concatenated (prepended) to every shader at pipeline creation time since WGSL has no `#include`

## File / Module Structure (~25 files)

```
gaseous/
├── index.html                          (~50 lines)
├── CLAUDE.md
├── README.md
│
├── src/
│   ├── main.js                         (~120 lines)  Entry point, orchestrator
│   ├── gpu-context.js                  (~150 lines)  WebGPU device/adapter init
│   ├── simulation.js                   (~200 lines)  Simulation loop, timing, adaptive control
│   ├── cycle-manager.js                (~180 lines)  Ball spawning, homogeneity, transitions
│   ├── ball-manager.js                 (~150 lines)  Gas ball state: positions, velocities, attractor
│   ├── config.js                       (~120 lines)  Default config, parameter schema, reactive state
│   ├── input.js                        (~180 lines)  Keyboard, mouse, fullscreen, cursor auto-hide
│   ├── ui-panel.js                     (~100 lines)  lil-gui wrapper, parameter binding
│   │
│   ├── gpu/
│   │   ├── buffers.js                  (~200 lines)  Buffer creation, layout, resize logic
│   │   ├── compute-pipeline.js         (~250 lines)  All compute pipeline/bind-group creation
│   │   ├── render-pipeline.js          (~200 lines)  Render pipeline creation, blend states
│   │   ├── frame.js                    (~150 lines)  Per-frame command encoding, dispatch, draw
│   │   └── gpu-timing.js              (~80 lines)   Timestamp queries, frame budget tracking
│   │
│   ├── shaders/
│   │   ├── shared-structs.wgsl         (~60 lines)   Particle struct, SimParams, BallData
│   │   ├── spatial-hash.wgsl           (~100 lines)  Bin counting + particle sorting
│   │   ├── prefix-sum.wgsl             (~60 lines)   Parallel prefix sum for bin offsets
│   │   ├── density.wgsl                (~90 lines)   SPH density computation (Poly6 kernel)
│   │   ├── forces.wgsl                 (~120 lines)  SPH pressure/viscosity + attractor + gravity
│   │   ├── integrate.wgsl              (~80 lines)   Euler integration, boundary handling
│   │   ├── homogeneity.wgsl            (~70 lines)   Grid-based color variance reduction
│   │   ├── particle-vertex.wgsl        (~60 lines)   Instanced quad vertex shader
│   │   ├── nebula-fragment.wgsl        (~80 lines)   Nebula theme fragment shader
│   │   ├── background-vertex.wgsl      (~30 lines)   Fullscreen quad for background
│   │   ├── nebula-background.wgsl      (~60 lines)   Star field generation
│   │   └── tonemap.wgsl                (~50 lines)   HDR tonemapping + dither final pass
│   │
│   └── themes/
│       ├── theme-interface.js          (~60 lines)   Theme contract/type definitions
│       ├── nebula-theme.js             (~120 lines)  Nebula: palette, blend mode, background config
│       └── theme-registry.js           (~40 lines)   Theme lookup, future theme registration
│
└── lib/
    └── lil-gui.esm.min.js             (vendored)    Settings panel library
```

### Key File Responsibilities

- **`main.js`** -- Orchestrator. Only file `index.html` imports. Contains `requestAnimationFrame` loop.
- **`gpu-context.js`** -- Requests adapter/device, configures canvas. Handles "WebGPU not supported" error screen.
- **`simulation.js`** -- Owns the frame loop, delta time, adaptive particle count controller.
- **`cycle-manager.js`** -- Lifecycle state machine: `SPAWNING -> ACTIVE -> FADING -> SPAWNING`.
- **`ball-manager.js`** -- CPU-side ball representation. Updates ball positions (Euler + wall bounce), uploads to uniform buffer.
- **`config.js`** -- Reactive `Config` class. Fires `onChange` callbacks when properties change.

## WebGPU Pipeline

### 7 Compute Passes (each frame, in order)

| # | Pass | Description | Dispatch |
|---|---|---|---|
| 1 | Clear Bins | Zero out bin counters | `ceil(binCount/64)` workgroups |
| 2 | Bin Particles | Count particles per spatial hash cell (atomics) | `ceil(particleCount/64)` |
| 3 | Prefix Sum | Convert bin sizes to offsets (multiple sub-dispatches) | `ceil(binCount/64)`, `ceil(log2(binCount))` times |
| 4 | Sort Particles | Reorder into spatially-coherent order | `ceil(particleCount/64)` |
| 5 | Density | SPH density computation using sorted neighbors | `ceil(particleCount/64)` |
| 6 | Forces + Integrate | SPH forces + attractor + gravity, then Euler integration | `ceil(particleCount/64)` |
| 7 | Homogeneity | (every ~30 frames) Reduce color variance to readback buffer | `ceil(gridCellCount/64)` |

**Workgroup size:** 64 threads (good occupancy across GPU architectures).

### 3 Render Passes

| # | Pass | Target | Blend | Geometry |
|---|---|---|---|---|
| 1 | Background | HDR texture (`rgba16float`) | None (overwrite) | Fullscreen triangle (3 vertices), procedural star field |
| 2 | Particles | Same HDR texture | Additive (`one + one`) | Instanced quads (6 vertices x N instances) |
| 3 | Tonemap + Output | Swap chain (`bgra8unorm`) | None | Fullscreen triangle, ACES tonemap + gamma + dither |

## Particle Struct (48 bytes, aligned)

```wgsl
struct Particle {
    pos_vel: vec4<f32>,       // 0..16    xy=position, zw=velocity
    color_density: vec4<f32>, // 16..32   xyz=color, w=density
    pressure: f32,            // 32..36
    attractor_str: f32,       // 36..40
    ball_id: u32,             // 40..44
    flags: u32,               // 44..48   bit flags (alive, fading, etc.)
};
```

Two `vec4` (16-byte aligned) followed by four 4-byte scalars. Total 48 bytes per particle.

### SimParams Uniform (~128 bytes, uploaded from CPU each frame)

```wgsl
struct SimParams {
    dt: f32,
    particle_count: u32,
    ball_count: u32,
    canvas_width: f32,
    canvas_height: f32,
    sph_radius: f32,
    rest_density: f32,
    gas_constant: f32,
    viscosity: f32,
    attractor_base: f32,
    gravity_constant: f32,
    drag_coefficient: f32,
    bin_size: f32,
    bins_x: u32,
    bins_y: u32,
    mouse_x: f32,
    mouse_y: f32,
    mouse_force: f32,
    frame_number: u32,
    padding: u32,
};
```

### BallData Struct (per-ball, uploaded from CPU)

```wgsl
struct BallData {
    pos: vec2<f32>,
    vel: vec2<f32>,
    color: vec3<f32>,
    attractor_strength: f32,
    mass: f32,
    radius: f32,
    particle_start: u32,
    particle_count: u32,
};
```

## SPH Implementation

### Hybrid Approach: Central-Attractor + SPH Pressure

Three forces work together:

1. **Central attractor** -- keeps particles grouped around parent ball center; decays over time causing shedding
2. **SPH pressure and viscosity** -- local fluid dynamics; particles push apart when too dense; viscosity smooths velocity differences creating eddies
3. **Inter-ball gravity** -- between ball centers causes deflections and strips particles

### Spatial Hashing

- **Cell size** = `sph_radius` (kernel support radius, typically 20-40 pixels)
- **Grid dimensions:** `bins_x = ceil(canvas_width / cell_size)`, `bins_y = ceil(canvas_height / cell_size)`
- **Total bin count:** `bins_x * bins_y` (typically 2000-5000 cells for 1080p)
- **Hash function:** `cell_index = cy * bins_x + cx` (clamped grid coordinates)
- **Three-phase construction:**
  1. Clear + Count (`atomicAdd`)
  2. Prefix Sum (ping-pong buffers, `ceil(log2(bin_count))` iterations)
  3. Sort (atomic slot claiming)

### SPH Kernels (Muller et al. 2003)

**Poly6 kernel (density):**
```
W_poly6(r, h) = 315 / (64 * PI * h^9) * (h^2 - r^2)^3    for r <= h
```

**Spiky kernel gradient (pressure force):**
```
grad_W_spiky(r, h) = -45 / (PI * h^6) * (h - r)^2 * (r_vec / r)    for r <= h
```

**Viscosity kernel Laplacian:**
```
lap_W_viscosity(r, h) = 45 / (PI * h^6) * (h - r)    for r <= h
```

### Force Computation (6 forces per particle)

1. **SPH Pressure:** `f = -mass_j * (pressure_i + pressure_j) / (2 * density_j) * grad_W_spiky`
2. **SPH Viscosity:** `f = viscosity * mass_j * (vel_j - vel_i) / density_j * lap_W_viscosity`
3. **Central Attractor:** `f = attractor_strength * normalize(to_center) * attractor_base / max(length(to_center), 1.0)`
4. **Inter-ball Gravity:** `f = gravity_constant * ball_mass / (dist^2 + softening) * normalize(to_ball)`
5. **Mouse Interaction:** `f = mouse_force / (length(to_mouse) + 10.0) * normalize(to_mouse)`
6. **Drag (shed particles):** `f = -drag_coefficient * vel * (1.0 - attractor_strength)`

### Integration and Boundaries

**Integration:** Symplectic Euler
```
vel_new = vel + accel * dt
pos_new = pos + vel_new * dt
```

**Boundaries:**
- **Bound particles** (`attractor_strength > SHED_THRESHOLD`): Damped bounce (soft wall reflection)
- **Shed particles**: Toroidal wrap-around (prevents gas piling at walls)

### Attractor Decay and Tidal Stripping

- Each frame: `attractor_str *= (1.0 - decay_rate * dt)`
- Distance-dependent tidal stripping: `attractor_str *= (1.0 - tidal_factor * dist_from_center * dt)`
- Near-foreign-ball transfer: if close to foreign ball and foreign gravity exceeds current attractor, transfer allegiance (`ball_id` changes, `attractor_str` reset to 0.1, begin color interpolation)

## Buffer Architecture

| Buffer | Type | Size | Purpose |
|---|---|---|---|
| `particleBuffer` | storage (read-write) | `particleCount * 48 B` | Particle state |
| `particleSortBuffer` | storage (read-write) | `particleCount * 48 B` | Sorted copy |
| `binSizeBuffer` | storage (read-write) | `(binCount+1) * 4 B` | Atomic counters |
| `binOffsetBufferA` | storage (read-write) | `(binCount+1) * 4 B` | Prefix sum ping |
| `binOffsetBufferB` | storage (read-write) | `(binCount+1) * 4 B` | Prefix sum pong |
| `simParamsBuffer` | uniform | `128 B` | Simulation constants |
| `ballDataBuffer` | storage (read) | `MAX_BALLS * 48 B` | Ball centers, colors, attractor |
| `homogeneityBuffer` | storage (read-write) | `gridCells * 16 B` | Per-cell color accumulation |
| `homogeneityResultBuffer` | storage (read-write) | `16 B` | Final variance scalar |
| `homogeneityReadbackBuffer` | map-read | `16 B` | CPU-readable copy |
| `hdrTexture` | texture | `W * H * 8 B` | HDR render target (rgba16float) |

### Double-Buffer Pattern

Sort reads from `particleBuffer`, writes to `particleSortBuffer`. Forces+integrate reads from `particleSortBuffer` (cache-friendly sorted order), writes back to `particleBuffer`. This avoids read-write hazards.

### CPU <-> GPU Data Flow

**CPU -> GPU (every frame):** `SimParams` (~128 bytes) + `BallData` (~240 bytes for 5 balls) via `device.queue.writeBuffer`. Tiny uploads, no staging buffers needed.

**GPU -> CPU (periodic, async):** Homogeneity variance (every ~30 frames, 16 bytes) + GPU timestamp (every frame if supported, 16 bytes) via `mapAsync`. Non-blocking, 1-2 frames behind.

## Theme System Contract

A theme is a plain JavaScript object:

```javascript
{
  name: string,           // Display name
  id: string,             // Unique identifier
  colors: {
    palette(): number[][], // Returns array of [r,g,b] (0-1)
    mixMode: string,       // 'additive' | 'subtractive' | 'screen'
    mix(c1, c2, t): number[], // How two colors blend
  },
  rendering: {
    fragmentShader: string,     // WGSL filename
    backgroundShader: string,   // WGSL filename
    blendState: GPUBlendState,  // WebGPU blend descriptor
    particleScale: number,      // Base size multiplier
    glowFalloff: number,        // Gaussian falloff exponent
  },
  background: {
    color: number[],           // [r, g, b, a] clear color
    params: Object,            // Theme-specific background uniforms
  },
  cycle: {
    fadeOutDuration: number,    // Seconds for old gas to fade
    fadeInDuration: number,     // Seconds for new balls to appear
    transitionStyle: string,    // 'crossfade' | 'sequential' | 'burst'
  }
}
```

**Theme consumed at 3 points:**
1. **Pipeline creation** -- blend state, shader filenames (changing themes requires pipeline recreation)
2. **Per-frame rendering** -- clear color, background params
3. **Cycle transitions** -- timing, palette

**To add a new theme:** Create theme JS file + WGSL fragment/background shaders, register in `theme-registry.js`. No simulation code changes needed.

## Config System

**Reactive `Config` class** in `config.js`:
- Single source of truth for all parameters
- Stores defaults, min/max/step ranges, category, and label metadata
- `onChange` listeners fire when any property changes
- `toSimParams()` packs values into a flat array for GPU upload
- Special path for `particleCount` changes: triggers buffer reallocation + bind group recreation

**Data flow:** UI slider -> lil-gui `onChange` -> `config.set()` -> fires listeners -> `simulation.js` marks simParams dirty -> next frame: `config.toSimParams()` -> `device.queue.writeBuffer(simParamsBuffer)`

## Adaptive Performance

**Target:** 60 fps. Frame budget: 16.67ms. GPU budget: ~14.2ms (85% headroom).

**Measurement:**
- If device supports `timestamp-query`: measure GPU time per frame via `writeTimestamp` before/after compute, resolve to readback buffer, async `mapAsync`
- **Fallback:** `performance.now()` around `submit()` + `onSubmittedWorkDone()` (less accurate)

**Scaling logic:**
- Rolling window of 60 GPU frame times
- Avg time > budget * 1.1: reduce particle count by 10%, cooldown 120 frames (2 seconds)
- Avg time < budget * 0.7 and below ceiling: increase by 5%, cooldown 120 frames
- `particleCount` config value is the ceiling; adaptive works below it
- Minimum: 1,000 particles

## Memory / Performance Budgets

### GPU Time Budget (target: 14ms at 50K particles)

| Pass | Est. Cost | Notes |
|---|---|---|
| Clear bins | 0.05ms | Simple memset |
| Bin particles | 0.1ms | One atomic per particle |
| Prefix sum | 0.1ms | ~13 iterations, small dispatch |
| Sort particles | 0.15ms | One atomic + copy per particle |
| Density | 2-4ms | 9-cell neighbor search, ~50 neighbors avg |
| Forces + integrate | 3-5ms | Same neighbor search + attractor + gravity |
| Homogeneity | 0.2ms | Every 30 frames, amortized ~0.007ms/frame |
| Background render | 0.1ms | Fullscreen quad |
| Particle render | 1-2ms | 50K instanced quads, additive blend |
| Tonemap | 0.1ms | Fullscreen quad |
| **Total** | **~6-12ms** | Comfortable margin at 50K |

At 100K particles, density + forces doubles to ~10-16ms. Adaptive controller settles around 60-80K on mid-range GPUs.

### VRAM Budget

| Resource | 50K particles | 200K particles |
|---|---|---|
| particleBuffer | 2.4 MB | 9.6 MB |
| particleSortBuffer | 2.4 MB | 9.6 MB |
| Bin buffers (3x) | ~60 KB | ~60 KB |
| HDR texture (1080p) | 16 MB | 16 MB |
| Other | ~1 MB | ~1 MB |
| **Total VRAM** | **~22 MB** | **~36 MB** |

### Future Optimization Opportunities

- Particle LOD: particles far from ball centers skip SPH (just drift with drag)
- Workgroup shared memory for SPH neighbor loads
- Reduced precision: particle colors as `rgba8unorm` packed into `u32` (saves 8 bytes/particle, 48 -> 32 bytes, 33% better cache utilization)
