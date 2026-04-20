# pb_emu — Pixelblaze emulator

A browser-based emulator for [Pixelblaze](https://electromage.com/) patterns. Runs pattern JS against a user-supplied pixel map (1D, 2D, or 3D) and renders the result live via Three.js.

## Usage

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Use the loader panel to supply a pattern and map. Drag-and-drop onto the canvas also works.

**First time?** In the loader's **Path** tab, type `/samples/rainbow.js` as the pattern and `/samples/ring.csv` as the map, then click **Load** on each. Or open the map's **Gen** tab and generate a 2D grid — no files needed.

## Inputs

**Pattern** and **map** each accept these input methods:

1. **File** — pick a pattern (`.js` or `.epe`) or map (`.csv` / `.json`).
2. **Paste** — paste source text directly.
3. **URL** — fetch from a URL (GitHub raw, gist, etc.). CORS-limited.
4. **Path** — any path served by the dev server. Bundled samples live under `/samples/` — e.g. `/samples/rainbow.js` and `/samples/ring.csv`. Drop additional files into `public/` and they'll be served at the matching URL.
5. **Gen** *(map only)* — build a synthetic map without a file: 1D strip of N pixels, 2D grid (W×H), or 3D cube (W×H×D). Ideal for quickly testing a 2D matrix pattern.

Drag a file onto the canvas to load it: `.js` / `.epe` → pattern, `.csv` → map, `.json` → pattern if it parses as an EPE envelope, else map.

## Supported pattern formats

- **Raw JS** (`.js`) — standard Pixelblaze pattern source.
- **EPE** (`.epe`) — Pixelblaze's JSON export envelope (`{ name, id, sources, preview }`). `sources.main` is unwrapped automatically; the preview JPEG is ignored; a leading UTF-8 BOM is tolerated.

## Supported map formats

- **Marimapper CSV** — `index,x,y,z,...`
- **Pixelblaze JSON** — `[[x,y,z], [x,y,z], …]`
- **Pixelblaze mapper function** — `function (pixelCount) { … return mapArray; }`
- **Generated** — the **Gen** tab builds a synthetic 1D/2D/3D map.

1D and 2D patterns render through Pixelblaze's dispatch cascade (3D→2D→1D fallbacks). The **Force dim** option overrides auto-detection.

Normalization modes (matching Pixelblaze's Mapper tab):

- **Fill** — per-axis independent scaling, each axis → `[0, 1)`.
- **Contain** — uniform scaling by the largest span, preserving aspect ratio.

## Supported DSL

All Pixelblaze built-ins except 16.16 fixed-point arithmetic:

- Lifecycle: `beforeRender`, `render`, `render2D`, `render3D`
- Math: `abs sin cos tan atan atan2 sqrt exp log pow clamp hypot hypot3 mod frac …`
- Waveforms: `time wave square triangle mix smoothstep bezier* perlin perlinFbm perlinRidge perlinTurbulence`
- Color: `hsv hsv24 rgb setPalette paint`
- Array helpers: `array arrayForEach arrayMutate arraySum …`
- Transform stack: `translate scale rotate rotateX/Y/Z translate3D scale3D resetTransform` (stack tracked, per-pixel application is stubbed)
- UI controls: `sliderX hsvPickerX rgbPickerX toggleX triggerX inputNumberX` — rendered as live widgets in a left-side panel; values persist per-pattern in `localStorage`.

## HUD and interactions

- **Control panel** (left) — one widget per exported `sliderX`/`toggleX`/`hsvPickerX`/`rgbPickerX`/`inputNumberX`/`triggerX`. Values persist per pattern, keyed by a hash of the source.
- **Palette strip** (bottom-center) — shows the current palette when `setPalette` is active.
- **LED inspector** — click any LED to see its index, raw coords, normalized coords, and current RGB.
- **View presets** — Front / Top / Side / Iso. Camera auto-fits to the map on load.
- **Time controls** — simulation clock decoupled from wall clock: speed slider (0.1×–4×), pause/play, single-frame step (`.` while paused).
- **Live visual tuning** — LED size and bloom strength/radius sliders; values persist.
- **Screenshot** — download the current canvas as a PNG.
- **Reload / recents** — reload re-fetches the current pattern (path/url); the Recents dropdown keeps the last 8 path/url loads for pattern and map.
- **Linter** — flags hardware-fidelity gotchas at load: `array()` / array-literals in render, `time()` in render, nested functions in render, expensive ops per frame (`perlin`, `atan2`, `sqrt`, `sin`, etc.).
- **Render-fn indicator** — the HUD shows which render function actually runs (e.g. `render2D (z dropped)` for a 3D map with only `render2D` exported).

### Keyboard shortcuts

| Key | Action |
|---|---|
| <kbd>Space</kbd> | play / pause |
| <kbd>.</kbd> | single-frame step (while paused) |
| <kbd>R</kbd> | reload current pattern |
| <kbd>L</kbd> | toggle loader panel |
| <kbd>?</kbd> | help overlay |

## Known fidelity gaps vs real hardware

- **Float64 math, not 16.16 fixed-point.** Patterns that deliberately overflow at ±32 768 or exploit 32-bit bitwise fraction bits will diverge. Virtually all published patterns are unaffected.
- **Transform stack** is tracked but not yet multiplied through per-pixel coords (patterns that rely on `translate`/`rotate` will see untransformed coords).
- **Sensor-board globals** (`frequencyData`, `accelerometer`, `light`) are zero-filled. Audio/sensor reactivity is post-MVP.
- **`time()` origin** is the simulator's internal clock (starts at 0, advanced each frame by `realDelta × speed`), not wall-clock-anchored.

## Architecture

```
src/
  app/
    main.js              Loader UI, render loop, HUD, keyboard/drag-drop, persistence
    controls.js          Live widget panel for exported UI controls
    palette.js           Palette gradient strip
    inspector.js         Click-to-inspect LED overlay
    epe.js               EPE envelope unwrapping
  vm/
    sandbox.js           Pattern source evaluated in a scoped wrapper
    builtins.js          Pixelblaze built-in library
    perlin.js            Classic Perlin + fBm/ridge/turbulence
    currentPixel.js      hsv/rgb/paint → shared pixel accumulator; samplePalette
    lint.js              Hardware-fidelity checks (port of pb/pattern_maker/validate.py)
    index.js             Public entry — createVM, ctx.simTime, ctx.speed
  map/
    csv.js               Marimapper CSV parser
    json.js              Pixelblaze JSON array parser
    mapperFn.js          Evaluate a JS mapper function once at load
    generate.js          Synthetic 1D/2D/3D maps (Gen tab)
    normalize.js         Fill | Contain normalization to [0, 1)
    dispatch.js          Render-fn cascade + dim detection
    index.js             Public entry
  render/
    scene.js             Three.js scene, camera, orbit controls, bloom, view presets
    pixels.js            THREE.Points sprite cloud with live setSize
```

## Testing

```bash
npm test
```

Suites:

- `vm.test.js` — sandbox, built-ins, control classification
- `map.test.js` — parsers, normalize modes, dispatch cascade
- `generate.test.js` — synthetic map generator
- `epe.test.js` — EPE envelope parsing
- `lint.test.js` — pattern linter findings
- `palette.test.js` — `samplePalette` interpolation
- `controls.test.js` — control widget helpers
- `integration.test.js` — real patterns (`solid_color`, `coordinate_debug`, `lava_flow`, `expanding_rings`, `fire`) against the real egg map; skipped if `~/code/pb/` isn't present

## Security note

Loading a pattern evaluates user-supplied JavaScript. That's the point of the emulator. Evaluation is same-origin, strict mode, with an empty `this` and no `window`/`fetch`/`document` handed into the pattern scope. Trust model is the same as loading a user script in any web IDE — don't paste code you wouldn't run.
