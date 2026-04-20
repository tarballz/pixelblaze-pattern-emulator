# pb_emu — Pixelblaze emulator

A browser-based emulator for [Pixelblaze](https://electromage.com/) patterns. Runs pattern JS against a user-supplied pixel map (2D or 3D) and renders the result live via Three.js.

## Usage

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Use the loader panel to supply a pattern and map.

## Inputs

Both the **pattern** and **map** accept four input methods:

1. **File** — pick a `.js` / `.csv` / `.json` file.
2. **Paste** — paste source text directly.
3. **URL** — fetch from a URL (GitHub raw, gist, etc.). CORS-limited.
4. **Path** — in dev mode, the following are served:
   - `/pb/…` → `~/code/pb/…`
   - `/marimapper/…` → `~/code/marimapper/…`

   E.g. paste `/pb/pattern_maker/examples/organic/lava_flow.js` as the pattern path and `/pb/pattern_maker/maps/egg_mapping/led_map_3d.csv` as the map path.

## Supported map formats

- **Marimapper CSV** — `index,x,y,z,...`
- **Pixelblaze JSON** — `[[x,y,z], [x,y,z], …]`
- **Pixelblaze mapper function** — `function (pixelCount) { … return mapArray; }`

Normalization modes (like Pixelblaze's Mapper tab):

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
- UI controls: `sliderX hsvPickerX rgbPickerX toggleX triggerX inputNumberX` — **stubbed with defaults** in MVP (sliders fire at 0.5, pickers at white/red, toggles off). Real widgets are post-MVP.

## Known fidelity gaps vs real hardware

- **Float64 math, not 16.16 fixed-point.** Patterns that deliberately overflow at ±32 768 or exploit 32-bit bitwise fraction bits will diverge. Virtually all published patterns are unaffected.
- **Transform stack** is tracked but not yet multiplied through per-pixel coords (patterns that rely on `translate`/`rotate` will see untransformed coords).
- **Sensor-board globals** (`frequencyData`, `accelerometer`, `light`) are zero-filled. Audio/sensor reactivity is post-MVP.
- **`time()` origin** is `performance.now()` at VM load, not synced across devices. Patterns that assume a wall-clock-anchored phase may drift.

## Architecture

```
src/
  app/main.js            Loader UI, render loop, HUD
  vm/
    sandbox.js           Pattern source evaluated in a scoped wrapper
    builtins.js          Pixelblaze built-in library
    perlin.js            Classic Perlin + fBm/ridge/turbulence
    currentPixel.js      hsv/rgb/paint → shared pixel accumulator
    index.js             Public entry
  map/
    csv.js               Marimapper CSV parser
    json.js              Pixelblaze JSON array parser
    mapperFn.js          Evaluate a JS mapper function once at load
    normalize.js         Fill | Contain normalization to [0, 1)
    dispatch.js          Render-fn cascade (3D→2D→1D fallbacks)
    index.js             Public entry
  render/
    scene.js             Three.js scene, camera, orbit controls, bloom
    pixels.js            InstancedMesh of LEDs
```

## Testing

```bash
npm test
```

Three suites:
- `map.test.js` — parsers, normalize modes, dispatch cascade
- `vm.test.js` — sandbox, built-ins, control classification
- `integration.test.js` — real patterns (`solid_color`, `coordinate_debug`, `lava_flow`, `expanding_rings`, `fire`) against the real egg map, skipped if `~/code/pb/` isn't present

## Security note

Loading a pattern evaluates user-supplied JavaScript. This is the point of the emulator. Evaluation is same-origin, strict mode, with an empty `this` and no `window`/`fetch`/`document` handed into the pattern scope. Trust model is the same as loading a user script in any web IDE — don't paste code you wouldn't run.
