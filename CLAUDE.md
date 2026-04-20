# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server at http://localhost:5173
- `npm run build` / `npm run preview` — production build + local preview
- `npm test` — run Vitest suites once
- `npm run test:watch` — Vitest in watch mode
- Run a single test file: `npx vitest run test/vm.test.js`
- Filter by name: `npx vitest run -t "expanding_rings"`

## Architecture

The README covers the directory layout and supported Pixelblaze DSL surface. The points below are the cross-cutting concerns that aren't obvious from any single file.

### Three-layer pipeline

A frame flows through three independent layers, glued together by `src/app/main.js`:

1. **Map layer** (`src/map/`) — parses raw map text (CSV / JSON / JS function), normalizes coords to `[0, 1)` (`fill` per-axis or `contain` aspect-preserving), detects dim, and `selectRenderFn` picks which exported render function to call per pixel using the Pixelblaze fallback cascade (3D→2D→1D, see `dispatch.js` comments).
2. **VM layer** (`src/vm/`) — `createVM({ source, pixelCount, mapDim })` evaluates the pattern source inside a scoped wrapper (`sandbox.js`), exposing `createBuiltins(ctx)` as the only globals. `classifyExports` separates lifecycle (`beforeRender`/`render*`) from UI controls (`sliderX`, `hsvPickerX`, etc.). The pattern writes color through `hsv`/`rgb`/`paint`, all of which mutate a shared accumulator in `currentPixel.js`; the host then calls `vm.readPixel(rgb, i)` to extract the final RGB triplet for pixel `i`.
3. **Render layer** (`src/render/`) — Three.js scene with an InstancedMesh of LEDs and an optional bloom pass.

The `integration.test.js` `runFrames` helper is the canonical example of wiring all three layers together.

### Key invariants and gotchas

- **The pattern intentionally executes user JS.** `sandbox.js` runs in strict mode with an empty `this` and no `window`/`fetch`/`document`, but it is *not* a security boundary — it's a same-origin sandbox to keep pattern globals from leaking. Don't add "safety" features that break legitimate pattern semantics.
- **Float64, not 16.16 fixed-point.** Patterns that deliberately overflow at ±32768 will diverge from real hardware. This is documented and intentional.
- **Control widgets are stubbed** at MVP defaults (slider 0.5, hsvPicker white/red, toggle off). Tests assert against those defaults — see the `solid_color` / `lava_flow` integration cases.
- **Transform stack** is tracked in `ctx.transformStack` but not yet multiplied through per-pixel coords. Patterns relying on `translate`/`rotate` will see untransformed coords.
- **`time()` origin** is `performance.now()` at VM construction, not wall-clock-anchored.

### Vite path aliases

`vite.config.js` aliases `/pb` → `~/code/pb` and `/marimapper` → `~/code/marimapper` and adds them to `server.fs.allow`. The "Path" loader tab uses these to load patterns/maps from sibling repos at dev time. Integration tests skip themselves if `~/code/pb/pattern_maker/maps/egg_mapping/led_map_3d.csv` is missing — don't expect them to run on a fresh clone.

## Conventions specific to this repo

- ES modules, `"type": "module"`. No build step for tests — Vitest runs the source directly.
- Each `src/<layer>/index.js` is the public entry; cross-layer code should import from those, not reach into siblings.
- Adding a new Pixelblaze built-in: define it in `src/vm/builtins.js`, add a unit test in `test/vm.test.js`, and (if it affects color output) verify against a real pattern in `test/integration.test.js`.
