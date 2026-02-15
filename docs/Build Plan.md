---
title: "Gaseous - Build Plan"
created: 2026-02-14 12:00
updated: 2026-02-14 12:00
tags: [project, gaseous, build-plan, implementation]
parent: "[[Gaseous]]"
---

# Build Plan

Parent project: [[Gaseous]]

7 phases, each with clear deliverables that can be verified independently. Designed for LLM-assisted development -- each phase builds on the last and produces a testable checkpoint.

## Phase 1: Scaffolding (Non-GPU)

**Goal:** Project skeleton with configuration, input handling, and UI -- no rendering yet.

**Files created:**
- `index.html` -- Canvas element, module script import
- `src/main.js` -- Entry point, `requestAnimationFrame` stub
- `src/gpu-context.js` -- Request adapter/device, configure canvas, "WebGPU not supported" error screen
- `src/config.js` -- Reactive `Config` class with all defaults, min/max/step, onChange listeners
- `src/input.js` -- Keyboard handlers (Space, H, F, R, Esc), mouse position tracking, fullscreen toggle, cursor auto-hide
- `src/ui-panel.js` -- lil-gui wrapper, bind all config parameters to sliders
- `lib/lil-gui.esm.min.js` -- Vendored dependency

**Verification:**
- Page loads, WebGPU device acquired (or friendly error shown)
- UI panel toggles with H key
- Config changes fire onChange callbacks (log to console)
- Keyboard shortcuts work (fullscreen, pause stub)

## Phase 2: Render Pipeline

**Goal:** Static particles visible on screen with HDR rendering, tonemapping, and star field background.

**Files created:**
- `src/gpu/buffers.js` -- Particle buffer with random initial positions, HDR texture
- `src/gpu/render-pipeline.js` -- Particle render pipeline (additive blend), background pipeline, tonemap pipeline
- `src/gpu/frame.js` -- Per-frame command encoding: background pass -> particle pass -> tonemap pass
- `src/shaders/shared-structs.wgsl` -- Particle, SimParams, BallData struct definitions
- `src/shaders/particle-vertex.wgsl` -- Instanced quad vertex shader
- `src/shaders/nebula-fragment.wgsl` -- Gaussian falloff fragment shader
- `src/shaders/background-vertex.wgsl` -- Fullscreen quad vertex shader
- `src/shaders/nebula-background.wgsl` -- Procedural star field
- `src/shaders/tonemap.wgsl` -- ACES tonemapping + gamma + dither

**Verification:**
- Star field background visible
- 50K colored particles rendered as soft glowing dots
- HDR -> tonemap pipeline produces correct color output
- Additive blending creates color mixing where particles overlap
- Resizing window updates render targets

## Phase 3: Basic Simulation

**Goal:** Particles move under simple gravity, bounce off walls. No SPH yet.

**Files created/modified:**
- `src/gpu/compute-pipeline.js` -- Single compute pass (integrate only)
- `src/shaders/integrate.wgsl` -- Euler integration with gravity toward screen center, wall bounce

**Verification:**
- Particles fall/move under gravity
- Particles bounce off screen edges with damping
- Pause/resume works (Space key)
- Frame rate stable at 60fps

## Phase 4: Spatial Hashing

**Goal:** Particles binned into spatial hash grid. Sort verified but not yet used for neighbor queries.

**Files created/modified:**
- `src/shaders/spatial-hash.wgsl` -- Bin counting (atomicAdd) + particle sorting (atomic slot claiming)
- `src/shaders/prefix-sum.wgsl` -- Parallel prefix sum with ping-pong buffers
- `src/gpu/buffers.js` -- Add bin buffers (binSize, binOffsetA, binOffsetB, particleSortBuffer)
- `src/gpu/compute-pipeline.js` -- Add clear-bins, bin-particles, prefix-sum, sort passes

**Verification:**
- Particles sorted into spatially-coherent order each frame
- Debug visualization: color particles by bin index to verify spatial coherence
- No visual change to simulation behavior yet
- Frame rate remains acceptable

## Phase 5: SPH Physics

**Goal:** Full fluid dynamics -- density, pressure, viscosity, attractor forces, inter-ball gravity.

**Files created/modified:**
- `src/shaders/density.wgsl` -- Poly6 kernel density computation over sorted neighbors
- `src/shaders/forces.wgsl` -- All 6 forces: SPH pressure (Spiky), SPH viscosity, central attractor, inter-ball gravity, mouse interaction, drag
- `src/ball-manager.js` -- CPU-side ball state, position updates, wall bounce, upload to ballDataBuffer
- `src/gpu/compute-pipeline.js` -- Wire up density and forces passes, add ballDataBuffer binding

**Verification:**
- Particles cluster around ball centers (attractor force working)
- Particles spread out when too dense (pressure force working)
- Smooth velocity fields visible (viscosity working)
- Particles gradually shed from balls (attractor decay + drag)
- Multiple balls deflect each other (inter-ball gravity)
- Mouse interaction pushes particles (if mouseForce > 0)
- Tuning: adjust `sphRadius`, `gasConstant`, `viscosity`, `attractorBase` via UI panel

## Phase 6: Cycle Management

**Goal:** Complete autonomous cycle -- spawn balls, detect homogeneity, crossfade transition, repeat.

**Files created/modified:**
- `src/cycle-manager.js` -- State machine (`SPAWNING -> ACTIVE -> FADING -> SPAWNING`), ball spawning logic, transition timing
- `src/shaders/homogeneity.wgsl` -- 16x16 grid color variance reduction with atomics
- `src/gpu/buffers.js` -- Add homogeneity buffers (accumulation, result, readback)
- `src/gpu/compute-pipeline.js` -- Add homogeneity pass (every ~30 frames)

**Verification:**
- Balls spawn at screen edges with inward velocity
- Attractor decay causes gradual gas shedding
- Homogeneity detection triggers transition when colors are well-mixed
- Old particles fade out, new balls fade in (crossfade)
- Cycle repeats indefinitely without intervention
- R key restarts the cycle immediately

## Phase 7: Polish

**Goal:** Performance optimization, theme system, and final UX polish.

**Files created/modified:**
- `src/gpu/gpu-timing.js` -- Timestamp queries, rolling average, frame budget tracking
- `src/simulation.js` -- Adaptive particle count controller (scale down if over budget, up if under)
- `src/themes/theme-interface.js` -- Theme contract/type definitions
- `src/themes/nebula-theme.js` -- Extract nebula config into theme object
- `src/themes/theme-registry.js` -- Theme lookup, registration
- `src/input.js` -- Cursor auto-hide timer refinement

**Verification:**
- GPU timing displayed in UI panel (optional debug readout)
- Particle count auto-adjusts to maintain 60fps
- Theme system correctly provides palette, blend state, shaders to pipeline
- Cursor auto-hides after inactivity
- All keyboard shortcuts functional
- Clean startup experience (no flicker, graceful WebGPU detection)
- Runs as a screensaver indefinitely without memory leaks or degradation

## Phase Dependencies

```
Phase 1 (Scaffolding)
  └─> Phase 2 (Render Pipeline)
        └─> Phase 3 (Basic Simulation)
              └─> Phase 4 (Spatial Hashing)
                    └─> Phase 5 (SPH Physics)
                          └─> Phase 6 (Cycle Management)
                                └─> Phase 7 (Polish)
```

Each phase is strictly additive -- no phase requires reworking a previous phase's output. The render pipeline from Phase 2 carries through unchanged to Phase 7.
