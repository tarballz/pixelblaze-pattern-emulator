// Live palette strip: polls getPalette() each frame and resamples it into a
// full-height canvas so the user can see the gradient driving paint(). Hidden
// whenever the pattern hasn't called setPalette.

import { getPalette } from '../vm/currentPixel.js'

export function createPaletteStrip(canvas) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height
  // One full-height ImageData + one row's worth of RGBA values pre-alpha'd
  // means we can sample once per column and memcpy the row down y-axis.
  const image = ctx.createImageData(w, h)
  const rowRGBA = new Uint8ClampedArray(w * 4)

  function draw() {
    const p = getPalette()
    if (!p || p.length < 4) {
      canvas.classList.add('hidden')
      return
    }
    canvas.classList.remove('hidden')

    // Inlined palette sampling — avoids the [r,g,b] allocation that
    // samplePalette() returns for every column.
    const entries = (p.length / 4) | 0
    for (let x = 0; x < w; x++) {
      const v = x / (w - 1)
      let loIdx = 0
      for (let i = 0; i < entries - 1; i++) {
        if (v >= p[i * 4] && v <= p[(i + 1) * 4]) { loIdx = i; break }
        if (v > p[(i + 1) * 4]) loIdx = i + 1
      }
      const loP = loIdx * 4
      const hiP = Math.min((loIdx + 1) * 4, (entries - 1) * 4)
      const lo = p[loP], hi = p[hiP]
      const t = hi > lo ? (v - lo) / (hi - lo) : 0
      const r = p[loP + 1] + (p[hiP + 1] - p[loP + 1]) * t
      const g = p[loP + 2] + (p[hiP + 2] - p[loP + 2]) * t
      const b = p[loP + 3] + (p[hiP + 3] - p[loP + 3]) * t
      const o = x * 4
      rowRGBA[o]     = clamp255(r)
      rowRGBA[o + 1] = clamp255(g)
      rowRGBA[o + 2] = clamp255(b)
      rowRGBA[o + 3] = 255
    }
    // Tile the row into the full-height buffer, then one putImageData.
    const data = image.data
    for (let y = 0; y < h; y++) data.set(rowRGBA, y * w * 4)
    ctx.putImageData(image, 0, 0)
  }

  return { draw }
}

function clamp255(v) {
  if (v <= 0) return 0
  if (v >= 1) return 255
  return (v * 255) | 0
}
