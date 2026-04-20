// Static metadata for Pixelblaze built-ins, used by the static analyzer
// (src/vm/symbols.js). Parallel to the runtime implementations in builtins.js
// — a test asserts the name sets stay in sync.
//
// kind:
//   'function'      — callable. arity: [min, max], max === Infinity for rest-like.
//   'constant'      — read-only numeric constant (e.g. PI). writable=false.
//   'pin'           — hardware pin constant (HIGH, LOW, INPUT, …). writable=false.
//   'sensor-global' — sensor-board data (accelerometer, light, …). writable=true on hardware.

function fn(min, max = min) { return { kind: 'function', arity: [min, max] } }
const K = { kind: 'constant' }
const PIN = { kind: 'pin' }
const SENSOR = { kind: 'sensor-global' }

export const BUILTIN_CATALOG = {
  // Math constants
  PI: K, PI2: K, PI3_4: K, PISQ: K,
  E: K, LN2: K, LN10: K, LOG2E: K, LOG10E: K, SQRT1_2: K, SQRT2: K,

  // Math (unary unless noted)
  abs: fn(1), acos: fn(1), asin: fn(1), atan: fn(1),
  ceil: fn(1), cos: fn(1), exp: fn(1), floor: fn(1),
  log: fn(1), log2: fn(1), round: fn(1), sin: fn(1),
  sqrt: fn(1), tan: fn(1), trunc: fn(1), frac: fn(1),
  atan2: fn(2), pow: fn(2), mod: fn(2),
  max: fn(2, Infinity), min: fn(2, Infinity), hypot: fn(2, Infinity),
  hypot3: fn(3), clamp: fn(3),

  // PRNG
  random: fn(0, 1), prngSeed: fn(1), prng: fn(0, 1),

  // Waveforms
  time: fn(1), wave: fn(1), triangle: fn(1),
  square: fn(1, 2), mix: fn(3), smoothstep: fn(3),
  bezierQuadratic: fn(4), bezierCubic: fn(5),

  // Perlin
  perlin: fn(4), perlinFbm: fn(4, Infinity), perlinRidge: fn(4, Infinity),
  perlinTurbulence: fn(4, Infinity), setPerlinWrap: fn(3),

  // Color / pixel output
  hsv: fn(3), hsv24: fn(1), rgb: fn(3),
  setPalette: fn(1), paint: fn(1, 2),

  // Arrays
  array: fn(1), arrayLength: fn(1),
  arrayForEach: fn(2), arrayMapTo: fn(3), arrayMutate: fn(2),
  arrayReduce: fn(2, 3), arrayReplace: fn(2), arrayReplaceAt: fn(3),
  arraySort: fn(1, 2), arraySortBy: fn(2), arraySum: fn(1),

  // Transforms
  resetTransform: fn(0), transform: fn(1),
  translate: fn(2), scale: fn(2), rotate: fn(1),
  translate3D: fn(3), scale3D: fn(3),
  rotateX: fn(1), rotateY: fn(1), rotateZ: fn(1),

  // Map introspection
  pixelMapDimensions: fn(0), has2DMap: fn(0), has3DMap: fn(0),
  mapPixels: fn(1),

  // Clock
  clockYear: fn(0), clockMonth: fn(0), clockDay: fn(0),
  clockHour: fn(0), clockMinute: fn(0), clockSecond: fn(0),
  clockWeekday: fn(0),

  // Hardware I/O (no-ops on emulator)
  analogRead: fn(1), digitalRead: fn(1), digitalWrite: fn(2),
  pinMode: fn(2), touchRead: fn(1),
  INPUT: PIN, OUTPUT: PIN, INPUT_PULLUP: PIN, INPUT_PULLDOWN: PIN,
  HIGH: PIN, LOW: PIN,

  // Sequencer / misc
  sequencerNext: fn(0), sequencerGetMode: fn(0),
  playlistGetPosition: fn(0), playlistSetPosition: fn(1),
  playlistGetLength: fn(0), nodeId: fn(0),

  // Sensor globals — writable (hardware updates them each frame).
  frequencyData: SENSOR, energyAverage: SENSOR,
  maxFrequency: SENSOR, maxFrequencyMagnitude: SENSOR,
  accelerometer: SENSOR, light: SENSOR, analogInputs: SENSOR,

  // Runtime-injected globals (not in createBuiltins, but always available to a
  // pattern via the VM env). Writable=false — the runtime sets these and the
  // pattern reads them.
  pixelCount: K,
}

export const BUILTIN_NAMES = new Set(Object.keys(BUILTIN_CATALOG))

// Identifiers that are writable: sensor globals. Constants/pins/functions are
// flagged if assigned to.
export function isWritable(name) {
  const meta = BUILTIN_CATALOG[name]
  if (!meta) return true
  return meta.kind === 'sensor-global'
}
