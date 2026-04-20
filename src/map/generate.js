// Synthetic maps for testing patterns without a real map file. Outputs the
// same { pixelCount, coords, dimHint, source } shape as the parsers — normalize
// later flattens raw coords into [0, 1) just like a loaded map.

export function generateMap({ shape, w = 8, h = 8, d = 8 } = {}) {
  w = Math.max(1, Math.round(w))
  h = Math.max(1, Math.round(h))
  d = Math.max(1, Math.round(d))

  if (shape === '1d') {
    const coords = new Float32Array(w * 3)
    for (let i = 0; i < w; i++) coords[i * 3] = i
    return { pixelCount: w, coords, dimHint: 1, source: `generated 1D ×${w}` }
  }

  if (shape === '2d') {
    const pc = w * h
    const coords = new Float32Array(pc * 3)
    let k = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++, k++) {
        coords[k * 3]     = x
        coords[k * 3 + 1] = y
      }
    }
    return { pixelCount: pc, coords, dimHint: 2, source: `generated 2D ${w}×${h}` }
  }

  if (shape === '3d') {
    const pc = w * h * d
    const coords = new Float32Array(pc * 3)
    let k = 0
    for (let z = 0; z < d; z++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++, k++) {
          coords[k * 3]     = x
          coords[k * 3 + 1] = y
          coords[k * 3 + 2] = z
        }
      }
    }
    return { pixelCount: pc, coords, dimHint: 3, source: `generated 3D ${w}×${h}×${d}` }
  }

  throw new Error(`unknown shape: ${shape}`)
}
