// Classic Ken Perlin noise, 3D, with a seedable permutation table.
// Output in approximately [-0.5, 0.5] to match Pixelblaze semantics.
// (Raw gradient noise is [-1, 1]; we halve.)

const BASE_PERM = new Uint8Array([
  151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,
  8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,
  35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,
  134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,
  55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,
  18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,
  250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,
  189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,
  172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,
  228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,
  107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,
  138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180
])

// One permutation table per seed, memoized. Seed of 0 uses the raw BASE_PERM.
const permCache = new Map()

function makePerm(seed) {
  if (seed === 0 || seed === undefined) return BASE_PERM
  let cached = permCache.get(seed)
  if (cached) return cached

  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i

  // deterministic shuffle driven by seed via xorshift32
  let s = (seed | 0) || 1
  for (let i = 255; i > 0; i--) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    const j = (s >>> 0) % (i + 1)
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp
  }
  permCache.set(seed, p)
  return p
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10) }
function lerp(a, b, t) { return a + t * (b - a) }

function grad(hash, x, y, z) {
  const h = hash & 15
  const u = h < 8 ? x : y
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z)
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
}

export function perlin(x, y = 0, z = 0, seed = 0) {
  const p = makePerm(seed)
  const X = Math.floor(x) & 255
  const Y = Math.floor(y) & 255
  const Z = Math.floor(z) & 255
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z)
  const u = fade(x), v = fade(y), w = fade(z)

  const A  = (p[X] + Y) & 255
  const AA = (p[A] + Z) & 255
  const AB = (p[(A + 1) & 255] + Z) & 255
  const B  = (p[(X + 1) & 255] + Y) & 255
  const BA = (p[B] + Z) & 255
  const BB = (p[(B + 1) & 255] + Z) & 255

  const v1 = lerp(grad(p[AA],     x,     y,     z),
                  grad(p[BA],     x - 1, y,     z), u)
  const v2 = lerp(grad(p[AB],     x,     y - 1, z),
                  grad(p[BB],     x - 1, y - 1, z), u)
  const v3 = lerp(grad(p[(AA + 1) & 255], x,     y,     z - 1),
                  grad(p[(BA + 1) & 255], x - 1, y,     z - 1), u)
  const v4 = lerp(grad(p[(AB + 1) & 255], x,     y - 1, z - 1),
                  grad(p[(BB + 1) & 255], x - 1, y - 1, z - 1), u)

  return 0.5 * lerp(lerp(v1, v2, v), lerp(v3, v4, v), w)
}

// Fractal Brownian motion: sum octaves of perlin with increasing frequency, decreasing amplitude.
export function perlinFbm(x, y = 0, z = 0, octaves = 4, seed = 0) {
  let sum = 0, amp = 1, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin(x * freq, y * freq, z * freq, seed + i)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return norm > 0 ? sum / norm : 0
}

// Ridge noise: 1 - |perlin| summed, squared.
export function perlinRidge(x, y = 0, z = 0, octaves = 4, seed = 0) {
  let sum = 0, amp = 1, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(2 * perlin(x * freq, y * freq, z * freq, seed + i))
    sum += amp * n * n
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return norm > 0 ? sum / norm - 0.5 : 0
}

// Turbulence: |perlin| summed.
export function perlinTurbulence(x, y = 0, z = 0, octaves = 4, seed = 0) {
  let sum = 0, amp = 1, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * Math.abs(2 * perlin(x * freq, y * freq, z * freq, seed + i))
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return norm > 0 ? sum / norm - 0.5 : 0
}

// Per-axis tiling region. Stubbed for MVP — perlin output won't actually wrap,
// but patterns can call it without crashing.
export function setPerlinWrap(_x, _y, _z) {}
