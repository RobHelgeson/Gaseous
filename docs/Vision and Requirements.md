---
title: "Gaseous - Vision and Requirements"
created: 2026-02-14 12:00
updated: 2026-02-14 12:00
tags: [project, gaseous, requirements, vision]
parent: "[[Gaseous]]"
---

# Vision and Requirements

Parent project: [[Gaseous]]

## Core Concept

Gaseous is a browser-based gas mixing screensaver/visualization. The core loop:

1. **Gas balls** (2-5 per cycle) spawn at screen edges with inward motion vectors
2. Balls maintain coherence via central-attractor self-gravity
3. Balls bounce off scene edges
4. Balls **shed gas** as they move (atmospheric drag metaphor)
5. Balls' gravity affects one another and **strips gas** off neighboring balls
6. Gases **visually mix** and create eddies via SPH fluid dynamics
7. Each gas ball has a bright, saturated color
8. When the scene reaches **homogeneity**, new balls spawn and old gas fades out
9. The cycle repeats indefinitely

Priority: cool, relatively high-resolution visualization over rigorously detailed simulation. Target: ~60 fps at 1080p-2K resolution.

## Visual Style

### Default Theme: Nebula / Space Gas

Wispy, luminous clouds with glow effects (Hubble photo aesthetic). Bright cores fading to translucent edges. Particles blend additively for beautiful color mixing.

**Color Palette (saturated jewel tones):**

| Name | RGB (0-1) |
|---|---|
| Ruby | `[0.9, 0.2, 0.4]` |
| Sapphire | `[0.2, 0.4, 0.9]` |
| Emerald | `[0.1, 0.8, 0.5]` |
| Amethyst | `[0.8, 0.3, 0.9]` |
| Topaz | `[0.9, 0.7, 0.1]` |
| Aquamarine | `[0.1, 0.7, 0.9]` |

**Background:** Star field on very dark purple-black: `[0.01, 0.005, 0.02, 1.0]`
- `starDensity: 0.003`, `starBrightness: 0.8`, `nebulaGlow: 0.15`

**Rendering:**
- HDR render target: `rgba16float` texture
- Additive blend: `src: 'one', dst: 'one', op: 'add'`
- Instanced quad rendering with Gaussian falloff (`glowFalloff: 2.5`)
- ACES tonemapping + gamma correction + optional blue-noise dither
- Final output: `bgra8unorm` with `premultiplied` alphaMode

### Theme Architecture

Themes are swappable. Nebula is the MVP theme. Future themes (Ink in Water, Lava Lamp) can be added without changing simulation code. Per-theme customization:
- Color mixing mode (additive for Nebula, subtractive for Ink)
- Background effects
- Color palettes
- Blend states
- Fragment shaders

See [[Technical Architecture]] for the theme system contract.

## Interaction Model

### Default: Screensaver Mode

Runs autonomously with no user interaction required.

### Configurable Interaction

- Mouse/touch creates gentle forces (attract/repel gas)
- Does not disrupt the simulation, just lets you poke at it
- Returns to screensaver mode when idle
- `mouseForce` defaults to `0.0` (pure screensaver); increase to enable interaction

### Settings Panel

- dat.GUI-style floating overlay (using **lil-gui**, vendored ESM ~30KB)
- Toggle visibility with `H` key
- All configurable parameters exposed with sliders

## Cycle Behavior

### State Machine

```
SPAWNING -> ACTIVE -> FADING -> SPAWNING
```

### Spawning Phase (~2 seconds)

- 2-5 new balls created by ball manager
- Positions: random points along edges or just outside viewport
- Velocities: aimed inward
- Each ball gets `particlesPerBall = particleCount / ballCount` particles
- Particles initialized in a disk around ball center with small random offsets
- `attractor_strength` starts at 1.0
- Colors randomly selected from theme palette (no repeats within a cycle)

### Active Phase

- Ball attractor strengths **decay globally** over time
- Edge particles shed first (tidal decay -- distance-dependent)
- Inter-ball gravity causes close passes, stripping particles aggressively
- Shed particles gradually lose color intensity as they mix
- Color mixing happens in render pass via additive blending (no explicit interpolation in simulation for MVP)

### Homogeneity Detection

- Runs every ~30 frames as a compute pass
- Divides screen into 16x16 grid (256 cells)
- Per cell: accumulate sum of particle colors and count
- Compute per-cell mean, then variance: `|mean_color - global_mean|^2`
- Final value: `total_variance / cell_count`
- When `total_variance < homogeneity_threshold` (default `0.05`), transition to FADING
- Uses atomics (fixed-point integers for float atomics workaround)
- Readback is asynchronous and non-blocking (1-2 frames behind)

### Fading Phase (Crossfade Transition)

- Old particles: `fade_alpha` decreases 1.0 -> 0.0 over `fadeOutDuration` (3.0s for Nebula)
- New balls: spawn at edges after 0.5s delay, fade in over `fadeInDuration` (2.0s)
- Particle buffer never reallocated -- uses generation counter
- Old-generation particles fade out; same buffer slots reinitialized for new-generation

## Controls

| Key | Action |
|---|---|
| `Space` | Pause / Resume |
| `H` | Hide / Show UI panel |
| `F` | Toggle fullscreen |
| `R` | Restart cycle |
| `Esc` | Show cursor |

**Cursor auto-hide:** Mouse movement shows cursor briefly, then auto-hides after a timeout.

## Configurable Parameters

All parameters with defaults, ranges, and categories:

### Simulation

| Parameter | Default | Min | Max | Step |
|---|---|---|---|---|
| `particleCount` | 50,000 | 1,000 | 200,000 | 1,000 |
| `adaptiveParticles` | true | - | - | - |

### Physics

| Parameter | Default | Min | Max | Step |
|---|---|---|---|---|
| `sphRadius` | 25.0 | 5.0 | 100.0 | 1.0 |
| `restDensity` | 1.0 | 0.1 | 5.0 | 0.1 |
| `gasConstant` | 200.0 | 10.0 | 2,000.0 | 10.0 |
| `viscosity` | 50.0 | 0.0 | 500.0 | 5.0 |
| `attractorBase` | 500.0 | 0.0 | 2,000.0 | 10.0 |
| `attractorDecay` | 0.02 | 0.001 | 0.1 | 0.001 |
| `gravityConstant` | 100.0 | 0.0 | 1,000.0 | 10.0 |
| `dragCoefficient` | 0.01 | 0.0 | 0.1 | 0.005 |
| `bounceDamping` | 0.7 | 0.1 | 1.0 | 0.05 |

### Cycle

| Parameter | Default | Min | Max | Step |
|---|---|---|---|---|
| `ballCount` | 3 | 2 | 5 | 1 |
| `homogeneityThreshold` | 0.05 | 0.01 | 0.2 | 0.01 |

### Interaction

| Parameter | Default | Min | Max | Step |
|---|---|---|---|---|
| `mouseForce` | 0.0 | 0.0 | 500.0 | 10.0 |

### Visual

| Parameter | Default | Min | Max | Step |
|---|---|---|---|---|
| `particleScale` | 1.0 | 0.1 | 5.0 | 0.1 |
| `theme` | 'nebula' | - | - | - |

Ball sizes are proportional to the scene: `(canvasArea / ballCount)^0.5 * scaleFactor`

## Non-Goals (Out of Scope for MVP)

- **Audio:** Architecture supports hooks but no audio implementation in v1
- **WebGL fallback:** WebGPU only. Show friendly message if unsupported, suggesting Chrome/Edge/Safari 18+
- **Additional themes:** Only Nebula fully implemented. Ink-in-Water, Lava Lamp are future work
- **Mobile/touch optimization:** Target is 1080p-2K desktop monitors
- **MLS-MPM alternative:** Rejected because SPH's neighbor search is needed for the gravity-stripping mechanic
