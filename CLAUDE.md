# CLAUDE.md — Gaseous

## Project Overview

Browser-based gas mixing screensaver. Colorful gas balls interact via gravity and SPH fluid dynamics, shedding and mixing gas. WebGPU compute shaders, vanilla ES modules, no build step.

## Architecture

- **No build step** — files served directly as ES modules, hosted on GitHub Pages
- **WebGPU only** — no WebGL fallback
- **lil-gui** vendored in `lib/` for settings panel (~30KB)
- **WGSL shared structs** — `shared-structs.wgsl` is string-concatenated (prepended) to every shader at pipeline creation time since WGSL has no `#include`

## File Size Constraints

- No JS file should exceed ~400 lines
- No WGSL file should exceed ~300 lines
- This keeps files LLM-maintainable

## Key Patterns

- `Config` class is the single source of truth for all parameters. Use `config.set(key, value)` and `config.onChange(fn)`.
- `GpuContext` handles device init and canvas resize. Call `gpu.handleResize()` each frame.
- Double-buffer pattern: Sort reads `particleBuffer`, writes `particleSortBuffer`. Forces reads sorted, writes back to `particleBuffer`.
- GPU→CPU readback (homogeneity, timestamps) is async via `mapAsync`, non-blocking, 1-2 frames behind.

## Module Structure

```
src/
├── main.js              Entry point, orchestrator
├── gpu-context.js       WebGPU device/adapter/canvas
├── config.js            Reactive config with defaults and ranges
├── input.js             Keyboard, mouse, fullscreen, cursor auto-hide
├── ui-panel.js          lil-gui wrapper
├── simulation.js        Frame loop, timing, adaptive particle control  (Phase 2+)
├── cycle-manager.js     Spawn/active/fading state machine             (Phase 6)
├── ball-manager.js      CPU-side ball state                           (Phase 5)
├── gpu/
│   ├── buffers.js       Buffer creation and resize                    (Phase 2)
│   ├── compute-pipeline.js  Compute pipelines and bind groups         (Phase 3)
│   ├── render-pipeline.js   Render pipelines and blend states         (Phase 2)
│   ├── frame.js         Per-frame command encoding                    (Phase 2)
│   └── gpu-timing.js    Timestamp queries                             (Phase 7)
├── shaders/             WGSL shader files                             (Phase 2+)
└── themes/              Theme system                                  (Phase 7)
```

## Testing

Open `index.html` in a browser with WebGPU support. No test framework — verification is visual + console logs.

To serve locally: `python3 -m http.server 8000` from the project root, then open `http://localhost:8000`.

## Design Docs

Full design documentation lives in the Obsidian vault at `Projects/Personal/Gaseous/`:
- Vision and Requirements
- Technical Architecture
- Build Plan (7 phases)
