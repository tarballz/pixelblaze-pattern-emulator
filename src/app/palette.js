// Live palette strip: polls getPalette() each frame and resamples it into a
// 256-wide canvas so the user can see the gradient driving paint(). Hidden
// whenever the pattern hasn't called setPalette.

import { getPalette, samplePalette } from '../vm/currentPixel.js'

export function createPaletteStrip(canvas) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height
  const image = ctx.createImageData(w, 1)

  function draw() {
    const p = getPalette()
    if (!p || p.length < 4) {
      canvas.classList.add('hidden')
      return
    }
    canvas.classList.remove('hidden')
    const data = image.data
    for (let x = 0; x < w; x++) {
      const [r, g, b] = samplePalette(p, x / (w - 1))
      const o = x * 4
      data[o]     = clamp255(r)
      data[o + 1] = clamp255(g)
      data[o + 2] = clamp255(b)
      data[o + 3] = 255
    }
    // Tile the 1-pixel-high image up to the full canvas height.
    for (let y = 0; y < h; y++) ctx.putImageData(image, 0, y)
  }

  return { draw }
}

function clamp255(v) {
  if (v <= 0) return 0
  if (v >= 1) return 255
  return (v * 255) | 0
}
