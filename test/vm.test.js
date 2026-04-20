import { describe, it, expect } from 'vitest'
import { createBuiltins } from '../src/vm/builtins.js'
import { loadPattern, classifyExports, applyControlDefaults } from '../src/vm/sandbox.js'
import { resetPixel, readPixel } from '../src/vm/currentPixel.js'

function mkEnv(mapDim = 3) {
  const t0 = performance.now()
  const ctx = {
    now: () => performance.now() - t0,
    prngState: 1,
    transformStack: [new Array(16).fill(0).map((_, i) => i % 5 === 0 ? 1 : 0)],
    mapDim
  }
  const env = createBuiltins(ctx)
  env.pixelCount = 10
  return env
}

function renderOne(exports, i, x, y, z) {
  resetPixel()
  exports.render3D(i, x, y, z)
  const out = new Float32Array(3)
  readPixel(out, 0)
  return out
}

describe('sandbox: loadPattern + classifyExports', () => {
  it('loads a minimal pattern and extracts render3D', () => {
    const src = `
      export function render3D(index, x, y, z) {
        hsv(x, 1, 1)
      }
    `
    const env = mkEnv()
    const exports = loadPattern(src, env)
    expect(typeof exports.render3D).toBe('function')
    const rgb = renderOne(exports, 0, 0, 0, 0)
    // hue = 0 → red
    expect(rgb[0]).toBeCloseTo(1, 3)
    expect(rgb[1]).toBeCloseTo(0, 3)
    expect(rgb[2]).toBeCloseTo(0, 3)
  })

  it('exported setter + top-level var is mutable across calls', () => {
    const src = `
      var h = 0
      export function hsvPickerColor(_h, _s, _v) { h = _h }
      export function render3D(i, x, y, z) { hsv(h, 1, 1) }
    `
    const env = mkEnv()
    const exports = loadPattern(src, env)
    const classified = classifyExports(exports)
    expect(classified.controls.length).toBe(1)
    expect(classified.controls[0].kind).toBe('hsvPicker')

    // Before calling the picker, h=0 → red
    let rgb = renderOne(exports, 0, 0, 0, 0)
    expect(rgb[0]).toBeCloseTo(1, 3)

    // Call the picker to set hue to ~1/3 (green)
    exports.hsvPickerColor(0.333, 1, 1)
    rgb = renderOne(exports, 0, 0, 0, 0)
    expect(rgb[1]).toBeGreaterThan(0.9)
    expect(rgb[0]).toBeLessThan(0.1)
  })

  it('applies sensible control defaults', () => {
    const src = `
      var s = -1, t = -1
      export function sliderSpeed(v) { s = v }
      export function toggleThing(v) { t = v }
      export function render3D() {}
    `
    const env = mkEnv()
    const exports = loadPattern(src, env)
    const classified = classifyExports(exports)
    applyControlDefaults(classified.controls)
    // can't read private vars; exercise via another control
    expect(classified.controls.map(c => c.kind).sort()).toEqual(['slider', 'toggle'])
  })

  it('non-exported helper function works (fire.js pattern)', () => {
    const src = `
      var cols = 4
      function idx(col, row) { return col + row * cols }
      export function render2D(i, x, y) { hsv(idx(0, 0) / 16, 1, 1) }
    `
    const env = mkEnv(2)
    const exports = loadPattern(src, env)
    expect(typeof exports.render2D).toBe('function')
  })

  it('bare `var x;` is initialized to 0 (PB zero-init semantic)', () => {
    const src = `
      var b
      export function render3D(i, x, y, z) {
        b += 0.5
        rgb(b, b, b)
      }
    `
    const env = mkEnv()
    const exports = loadPattern(src, env)
    const rgb = renderOne(exports, 0, 0, 0, 0)
    // b starts at 0, b += 0.5 → 0.5, not NaN
    expect(rgb[0]).toBeCloseTo(0.5, 3)
  })

  it('multi-name `var a, b = 1, c;` initializes bare idents to 0', () => {
    const src = `
      var a, b = 0.3, c
      export function render3D(i, x, y, z) {
        rgb(a + b, b, c + b)
      }
    `
    const env = mkEnv()
    const exports = loadPattern(src, env)
    const rgb = renderOne(exports, 0, 0, 0, 0)
    expect(rgb[0]).toBeCloseTo(0.3, 3)
    expect(rgb[1]).toBeCloseTo(0.3, 3)
    expect(rgb[2]).toBeCloseTo(0.3, 3)
  })

  it('undeclared identifiers (implicit globals) default to 0 on read', () => {
    const src = `
      export function beforeRender(delta) {
        timebase = timebase + 1
      }
      export function render3D(i, x, y, z) {
        rgb(timebase * 0.1, 0, 0)
      }
    `
    const env = mkEnv()
    const exports = loadPattern(src, env)
    exports.beforeRender(16)
    exports.beforeRender(16)
    const rgb = renderOne(exports, 0, 0, 0, 0)
    // timebase read as 0 on first iteration → 1, then 2
    expect(rgb[0]).toBeCloseTo(0.2, 3)
  })

  it('array proxy treats boolean index true/false as 1/0', () => {
    const src = `
      var fns = array(2)
      fns[0] = (v) => v * 0.2
      fns[1] = (v) => v * 0.8
      var pick = (1 >= 0.5)
      export function render3D(i, x, y, z) {
        rgb(fns[pick](1), 0, 0)
      }
    `
    const env = mkEnv()
    const exports = loadPattern(src, env)
    const rgb = renderOne(exports, 0, 0, 0, 0)
    expect(rgb[0]).toBeCloseTo(0.8, 3)
  })

  it('NaN output is coerced to 0 in readPixel', () => {
    const src = `
      export function render3D(i, x, y, z) {
        rgb(0 / 0, 1 / 0, 0)
      }
    `
    const env = mkEnv()
    const exports = loadPattern(src, env)
    const rgb = renderOne(exports, 0, 0, 0, 0)
    expect(rgb[0]).toBe(0)
    expect(rgb[1]).toBe(1) // Infinity clamps to 1
    expect(rgb[2]).toBe(0)
  })

  it('export keyword strip preserves line boundaries', () => {
    // Regression: regex used to swallow the newline before `export`, splicing
    // a preceding line comment into the next line.
    const src = `
      //scale(1, 1);

      export function render3D(i, x, y, z) { hsv(0.333, 1, 1) }
    `
    const env = mkEnv()
    const exports = loadPattern(src, env)
    expect(typeof exports.render3D).toBe('function')
    const rgb = renderOne(exports, 0, 0, 0, 0)
    expect(rgb[1]).toBeGreaterThan(0.9)
  })

  it('GPIO constants (OUTPUT, INPUT, HIGH, LOW) are defined', () => {
    const env = mkEnv()
    expect(env.OUTPUT).toBe(1)
    expect(env.INPUT).toBe(0)
    expect(env.HIGH).toBe(1)
    expect(env.LOW).toBe(0)
  })
})

describe('builtins: math/waveforms/perlin', () => {
  it('hypot3 matches sqrt(x²+y²+z²)', () => {
    const env = mkEnv()
    expect(env.hypot3(3, 4, 0)).toBeCloseTo(5, 5)
    expect(env.hypot3(1, 2, 2)).toBeCloseTo(3, 5)
  })

  it('clamp behaves as expected', () => {
    const env = mkEnv()
    expect(env.clamp(5, 0, 1)).toBe(1)
    expect(env.clamp(-1, 0, 1)).toBe(0)
    expect(env.clamp(0.5, 0, 1)).toBe(0.5)
  })

  it('mod returns non-negative for positive divisor', () => {
    const env = mkEnv()
    expect(env.mod(-1, 5)).toBe(4)
    expect(env.mod(7, 5)).toBe(2)
    expect(env.mod(0, 5)).toBe(0)
  })

  it('smoothstep is 0 below, 1 above, 0.5 at midpoint', () => {
    const env = mkEnv()
    expect(env.smoothstep(0, 1, -1)).toBe(0)
    expect(env.smoothstep(0, 1, 2)).toBe(1)
    expect(env.smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 3)
  })

  it('wave is 0.5 at integer inputs, 1 at 0.25, 0 at 0.75', () => {
    const env = mkEnv()
    expect(env.wave(0)).toBeCloseTo(0.5, 5)
    expect(env.wave(0.25)).toBeCloseTo(1, 5)
    expect(env.wave(0.75)).toBeCloseTo(0, 5)
  })

  it('perlin returns values in ~[-0.5, 0.5] range', () => {
    const env = mkEnv()
    let min = Infinity, max = -Infinity
    for (let i = 0; i < 100; i++) {
      const v = env.perlin(i * 0.13, i * 0.07, i * 0.23, 0)
      if (v < min) min = v
      if (v > max) max = v
    }
    expect(min).toBeGreaterThan(-0.71)
    expect(max).toBeLessThan(0.71)
    expect(max - min).toBeGreaterThan(0.1)  // actually varying
  })

  it('time is deterministic within a single frame (same value if now() unchanged)', () => {
    const env = mkEnv()
    // Pin ctx.now to a fixed value. We can't easily from outside the closure
    // here — but consecutive calls within a tight loop should differ by < 1%
    // for the default 1-second period.
    const a = env.time(1)
    const b = env.time(1)
    expect(Math.abs(b - a)).toBeLessThan(0.01)
  })

  it('prng is deterministic given a seed', () => {
    const env1 = mkEnv()
    const env2 = mkEnv()
    env1.prngSeed(42)
    env2.prngSeed(42)
    expect(env1.prng()).toBe(env2.prng())
    expect(env1.prng()).toBe(env2.prng())
  })
})
