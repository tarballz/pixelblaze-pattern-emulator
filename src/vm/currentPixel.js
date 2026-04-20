// Per-pixel RGB accumulator. hsv/rgb/paint set it; the render loop reads it.
// RGB is linear [0, 1] and may exceed 1 (patterns sometimes paint >1, we clamp at readout).

const state = {
  r: 0, g: 0, b: 0,
  palette: null  // flat [pos, r, g, b, pos, r, g, b, …] sorted by pos
}

export function resetPixel() {
  state.r = 0
  state.g = 0
  state.b = 0
}

export function readPixel(out, i) {
  // NaN-check via self-compare: patterns that divide by zero produce Infinity
  // that propagates to NaN through sin/cos. NaN < 0 and NaN > 1 are both false,
  // so the plain clamp would leak NaN into the renderer. Coerce to 0 instead.
  const r = state.r, g = state.g, b = state.b
  out[i * 3 + 0] = r !== r || r < 0 ? 0 : r > 1 ? 1 : r
  out[i * 3 + 1] = g !== g || g < 0 ? 0 : g > 1 ? 1 : g
  out[i * 3 + 2] = b !== b || b < 0 ? 0 : b > 1 ? 1 : b
}

function frac(x) { return x - Math.floor(x) }

// HSV → RGB, all channels [0, 1]. Hue wraps.
export function hsv(h, s, v) {
  h = frac(h) * 6
  const c = v * s
  const x = c * (1 - Math.abs((h % 2) - 1))
  const m = v - c
  let r, g, b
  if (h < 1)      { r = c; g = x; b = 0 }
  else if (h < 2) { r = x; g = c; b = 0 }
  else if (h < 3) { r = 0; g = c; b = x }
  else if (h < 4) { r = 0; g = x; b = c }
  else if (h < 5) { r = x; g = 0; b = c }
  else            { r = c; g = 0; b = x }
  state.r = r + m
  state.g = g + m
  state.b = b + m
}

export function rgb(r, g, b) {
  state.r = r
  state.g = g
  state.b = b
}

// Pixelblaze accepts the same signature; we don't emulate the 24-bit quantization.
export const hsv24 = hsv

// setPalette([pos, r, g, b, pos, r, g, b, …]) or nested [[pos,r,g,b], …]
// Holds a LIVE reference to the passed array. Many PB patterns (axial_flow,
// gyroid, hc_pat, …) call setPalette once with an array they mutate every
// frame inside beforeRender — we must read those mutations through, not
// snapshot them. For the nested form we wrap in a flat view at set time;
// that form isn't typically mutated live so a copy is acceptable.
export function setPalette(arr) {
  if (!arr || !arr.length) { state.palette = null; return }
  if (Array.isArray(arr[0])) {
    const flat = []
    for (const [p, r, g, b] of arr) flat.push(p, r, g, b)
    state.palette = flat
  } else {
    state.palette = arr
  }
}

// Sample a palette (flat [pos, r, g, b, ...]) at `v` in [0, 1]. Returns [r, g, b].
// Exported for reuse by the palette-strip viewer. Assumes stops are sorted
// by position (Pixelblaze convention); linear scan is fine for ≤ ~16 entries.
export function samplePalette(p, v) {
  const entries = Math.floor(p.length / 4)
  let loIdx = 0
  for (let i = 0; i < entries - 1; i++) {
    if (v >= p[i * 4] && v <= p[(i + 1) * 4]) { loIdx = i; break }
    if (v > p[(i + 1) * 4]) loIdx = i + 1
  }
  const loP = loIdx * 4
  const hiP = Math.min((loIdx + 1) * 4, (entries - 1) * 4)
  const lo = p[loP], hi = p[hiP]
  const span = hi - lo
  const t = span > 0 ? (v - lo) / span : 0
  return [
    p[loP + 1] + (p[hiP + 1] - p[loP + 1]) * t,
    p[loP + 2] + (p[hiP + 2] - p[loP + 2]) * t,
    p[loP + 3] + (p[hiP + 3] - p[loP + 3]) * t
  ]
}

export function getPalette() { return state.palette }

// paint(value, brightness=1) looks up the palette at `value` (wraps 0..1),
// multiplies by brightness. Reads the stored array directly so live mutations
// propagate without a re-setPalette call.
export function paint(value, brightness = 1) {
  const p = state.palette
  if (!p || p.length < 4) {
    // no palette set — fall back to hsv(value, 1, brightness) per PB
    hsv(value, 1, brightness)
    return
  }
  const [r, g, b] = samplePalette(p, frac(value))
  state.r = r * brightness
  state.g = g * brightness
  state.b = b * brightness
}
