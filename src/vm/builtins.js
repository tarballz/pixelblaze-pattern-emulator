// Pixelblaze built-in library implemented in JS (Float64 semantics).
// Bound into the sandbox scope as a plain object of names.
//
// Reference: https://electromage.com/docs/language-reference
// (mirror: https://github.com/simap/pixelblaze/blob/master/README.expressions.md)

import * as perlinFns from './perlin.js'
import * as pixel from './currentPixel.js'

const FRACTIONAL_INDEX = /^-?\d+\.\d+$/
function coerceIndex(prop) {
  if (typeof prop !== 'string') return prop
  if (prop === 'true') return '1'
  if (prop === 'false') return '0'
  if (FRACTIONAL_INDEX.test(prop)) return String(Math.trunc(Number(prop)))
  return prop
}
const pbArrayHandler = {
  get(target, prop, receiver) {
    return Reflect.get(target, coerceIndex(prop), receiver)
  },
  set(target, prop, value, receiver) {
    return Reflect.set(target, coerceIndex(prop), value, receiver)
  }
}
function makePbArray(n) {
  return new Proxy(new Array(n).fill(0), pbArrayHandler)
}

// A VM instance's time origin and deterministic PRNG state.
// `createBuiltins(ctx)` returns a fresh environment tied to the given ctx object
// (so beforeRender timers and PRNG are per-pattern-load).
export function createBuiltins(ctx) {
  // ctx = { now(): ms since start, prngState: [seed], transformStack: [mat4], ... }

  const env = Object.create(null)

  // -------- Constants --------
  env.PI = Math.PI
  env.PI2 = Math.PI * 2
  env.PI3_4 = (Math.PI * 3) / 4
  env.PISQ = Math.PI * Math.PI
  env.E = Math.E
  env.LN2 = Math.LN2
  env.LN10 = Math.LN10
  env.LOG2E = Math.LOG2E
  env.LOG10E = Math.LOG10E
  env.SQRT1_2 = Math.SQRT1_2
  env.SQRT2 = Math.SQRT2

  // -------- Math --------
  env.abs = Math.abs
  env.acos = Math.acos
  env.asin = Math.asin
  env.atan = Math.atan
  env.atan2 = Math.atan2
  env.ceil = Math.ceil
  env.cos = Math.cos
  env.exp = Math.exp
  env.floor = Math.floor
  env.log = Math.log
  env.log2 = Math.log2
  env.max = Math.max
  env.min = Math.min
  env.pow = Math.pow
  env.round = Math.round
  env.sin = Math.sin
  env.sqrt = Math.sqrt
  env.tan = Math.tan
  env.trunc = Math.trunc
  env.hypot = Math.hypot
  env.hypot3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z)
  env.frac = (x) => x - Math.floor(x)
  env.clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x
  // PB `mod` returns a value with the same sign as the divisor (always non-negative for positive n).
  env.mod = (a, n) => {
    const r = a % n
    return (r < 0 && n > 0) || (r > 0 && n < 0) ? r + n : r
  }

  // -------- PRNG --------
  // random(max): non-deterministic (Math.random-backed)
  env.random = (max = 1) => Math.random() * max
  // prng(): deterministic 0..1, advanced by prngSeed(n)
  env.prngSeed = (seed) => { ctx.prngState = ((seed | 0) || 1) >>> 0 }
  env.prng = (max = 1) => {
    let s = ctx.prngState >>> 0
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    ctx.prngState = s >>> 0
    return (ctx.prngState / 0x100000000) * max
  }

  // -------- Waveforms --------
  // time(interval): sawtooth 0..1, period ≈ 65.536 * interval seconds
  // (per docs: "a full cycle every 65.536 * interval seconds"). interval units = seconds.
  env.time = (interval) => {
    if (interval <= 0) return 0
    const period = 65.536 * interval * 1000 // ms
    return (ctx.now() % period) / period
  }
  env.wave = (v) => 0.5 + 0.5 * Math.sin(v * Math.PI * 2)
  env.square = (v, duty = 0.5) => (v - Math.floor(v)) < duty ? 1 : 0
  env.triangle = (v) => {
    const f = v - Math.floor(v)
    return f < 0.5 ? f * 2 : 2 - f * 2
  }
  env.mix = (a, b, t) => a + (b - a) * t
  env.smoothstep = (a, b, x) => {
    if (a === b) return x < a ? 0 : 1
    const t = (x - a) / (b - a)
    const c = t < 0 ? 0 : t > 1 ? 1 : t
    return c * c * (3 - 2 * c)
  }
  env.bezierQuadratic = (t, p1, p2, p3) => {
    const u = 1 - t
    return u * u * p1 + 2 * u * t * p2 + t * t * p3
  }
  env.bezierCubic = (t, p1, p2, p3, p4) => {
    const u = 1 - t
    return u * u * u * p1 + 3 * u * u * t * p2 + 3 * u * t * t * p3 + t * t * t * p4
  }

  // -------- Perlin --------
  env.perlin = perlinFns.perlin
  env.perlinFbm = perlinFns.perlinFbm
  env.perlinRidge = perlinFns.perlinRidge
  env.perlinTurbulence = perlinFns.perlinTurbulence
  env.setPerlinWrap = perlinFns.setPerlinWrap

  // -------- Color / pixel output --------
  env.hsv = pixel.hsv
  env.hsv24 = pixel.hsv24
  env.rgb = pixel.rgb
  env.setPalette = pixel.setPalette
  env.paint = pixel.paint

  // -------- Arrays --------
  // Pixelblaze arrays are dynamic, nestable, and implicitly truncate fractional
  // indices (hardware arithmetic is 16.16 fixed-point). JS does neither out of
  // the box: typed arrays coerce stored subarrays to NaN, and `arr[10.14]`
  // evaluates to undefined. Wrap a plain Array in a Proxy that floors
  // numeric-looking index strings on both get and set.
  env.array = (n) => makePbArray(n | 0)
  // Note: patterns may use both method-form (a.length, a.forEach) and functional form.
  // The method form works natively on Array and (for some methods) Float64Array.
  // Provide the functional aliases.
  env.arrayLength = (a) => a.length
  env.arrayForEach = (a, fn) => { for (let i = 0; i < a.length; i++) fn(a[i], i, a) }
  env.arrayMapTo = (src, dst, fn) => { for (let i = 0; i < src.length; i++) dst[i] = fn(src[i], i, src) }
  env.arrayMutate = (a, fn) => { for (let i = 0; i < a.length; i++) a[i] = fn(a[i], i, a) }
  env.arrayReduce = (a, fn, init) => {
    let acc = init
    for (let i = 0; i < a.length; i++) acc = fn(acc, a[i], i, a)
    return acc
  }
  env.arrayReplace = (dst, src) => { for (let i = 0; i < src.length; i++) dst[i] = src[i]; return dst }
  env.arrayReplaceAt = (dst, at, src) => { for (let i = 0; i < src.length; i++) dst[at + i] = src[i]; return dst }
  env.arraySort = (a, cmp) => cmp ? Array.from(a).sort(cmp) : Array.from(a).sort((x, y) => x - y)
  env.arraySortBy = (a, key) => Array.from(a).sort((x, y) => key(x) - key(y))
  env.arraySum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s }

  // -------- Transform stack (4×4 matrices, up to 31 deep) --------
  // Applied to (x, y, z) before the render function sees them.
  // For MVP: stub that records calls but doesn't actually transform coordinates yet
  // (the test patterns in pattern_maker/examples don't use transforms).
  // A full implementation multiplies matrices and applies the top of stack per-pixel.
  env.resetTransform = () => { ctx.transformStack.length = 1; ctx.transformStack[0] = identity() }
  env.transform = (mat) => ctx.transformStack[ctx.transformStack.length - 1] = mat
  env.translate = (x, y) => applyTransform(ctx, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1])
  env.scale = (x, y) => applyTransform(ctx, [x, 0, 0, 0, 0, y, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  env.rotate = (a) => {
    const c = Math.cos(a), s = Math.sin(a)
    applyTransform(ctx, [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  }
  env.translate3D = (x, y, z) => applyTransform(ctx, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])
  env.scale3D = (x, y, z) => applyTransform(ctx, [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1])
  env.rotateX = (a) => {
    const c = Math.cos(a), s = Math.sin(a)
    applyTransform(ctx, [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1])
  }
  env.rotateY = (a) => {
    const c = Math.cos(a), s = Math.sin(a)
    applyTransform(ctx, [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])
  }
  env.rotateZ = (a) => {
    const c = Math.cos(a), s = Math.sin(a)
    applyTransform(ctx, [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  }

  // -------- Map introspection --------
  env.pixelMapDimensions = () => ctx.mapDim
  env.has2DMap = () => ctx.mapDim >= 2 ? 1 : 0
  env.has3DMap = () => ctx.mapDim >= 3 ? 1 : 0
  env.mapPixels = (fn) => { /* would remap at load; no-op for MVP */ }

  // -------- Clock --------
  env.clockYear = () => new Date().getFullYear()
  env.clockMonth = () => new Date().getMonth() + 1
  env.clockDay = () => new Date().getDate()
  env.clockHour = () => new Date().getHours()
  env.clockMinute = () => new Date().getMinutes()
  env.clockSecond = () => new Date().getSeconds()
  env.clockWeekday = () => new Date().getDay()

  // -------- Hardware I/O (no-ops) --------
  env.analogRead = () => 0
  env.digitalRead = () => 0
  env.digitalWrite = () => {}
  env.pinMode = () => {}
  env.touchRead = () => 0
  env.INPUT = 0
  env.OUTPUT = 1
  env.INPUT_PULLUP = 2
  env.INPUT_PULLDOWN = 3
  env.HIGH = 1
  env.LOW = 0

  // -------- Sequencer / misc --------
  env.sequencerNext = () => {}
  env.sequencerGetMode = () => 0
  env.playlistGetPosition = () => 0
  env.playlistSetPosition = () => {}
  env.playlistGetLength = () => 0
  env.nodeId = () => 0

  // -------- Sensor-board globals (default to safe zeros) --------
  env.frequencyData = new Float64Array(32)
  env.energyAverage = 0
  env.maxFrequency = 0
  env.maxFrequencyMagnitude = 0
  env.accelerometer = new Float64Array(3)
  env.light = 0
  env.analogInputs = new Float64Array(5)

  return env
}

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

function applyTransform(ctx, m) {
  // Post-multiply top-of-stack by m. Stubbed: only maintains the stack, does
  // NOT yet transform per-pixel coords. Patterns that rely on transforms will
  // run without error but won't see the expected remapping until this is wired
  // through the render loop.
  const top = ctx.transformStack[ctx.transformStack.length - 1]
  ctx.transformStack[ctx.transformStack.length - 1] = mulMat4(top, m)
}

function mulMat4(a, b) {
  const out = new Array(16)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] =
        a[i * 4 + 0] * b[0 * 4 + j] +
        a[i * 4 + 1] * b[1 * 4 + j] +
        a[i * 4 + 2] * b[2 * 4 + j] +
        a[i * 4 + 3] * b[3 * 4 + j]
    }
  }
  return out
}
