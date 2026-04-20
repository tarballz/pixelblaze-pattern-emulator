// End-to-end: load a real pattern and a real map from ~/code/pb, drive the
// render loop for a few frames, and verify output is sane (non-zero, non-NaN).

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseMapContent, prepareMap, selectRenderFn } from '../src/map/index.js'
import { createVM } from '../src/vm/index.js'

const PB = join(homedir(), 'code/pb')

function runFrames(patternPath, mapPath, { frames = 3 } = {}) {
  const patternSource = readFileSync(patternPath, 'utf8')
  const mapText = readFileSync(mapPath, 'utf8')

  const parsed = parseMapContent(mapText)
  const map = prepareMap(parsed, { normalizeMode: 'fill' })
  const vm = createVM({ source: patternSource, pixelCount: map.pixelCount, mapDim: map.dim })
  const chosen = selectRenderFn(map.dim, vm.classified)
  const rgb = new Float32Array(map.pixelCount * 3)

  const { nx, ny, nz } = map.normalized
  const pc = map.pixelCount

  for (let f = 0; f < frames; f++) {
    vm.beforeRender()
    for (let i = 0; i < pc; i++) {
      vm.resetPixel()
      chosen(i, nx, ny, nz, pc)
      vm.readPixel(rgb, i)
    }
  }
  return { rgb, pc }
}

const haveRealMap = existsSync(join(PB, 'pattern_maker/maps/egg_mapping/led_map_3d.csv'))
const describeIf = haveRealMap ? describe : describe.skip

describeIf('integration — real patterns against the egg map', () => {
  const eggMap = join(PB, 'pattern_maker/maps/egg_mapping/led_map_3d.csv')

  it('solid_color.js produces a single uniform color across all pixels', () => {
    const { rgb, pc } = runFrames(
      join(PB, 'pattern_maker/examples/utility/solid_color.js'),
      eggMap
    )
    // All pixels should have the same color (since it's "solid").
    // Defaults: hsvPicker → (0, 1, 1), slider → 0.5. Final: hsv(0, 1, 0.5) = (0.5, 0, 0).
    for (let i = 0; i < pc; i++) {
      expect(rgb[i * 3 + 0]).toBeCloseTo(rgb[0], 4)
      expect(rgb[i * 3 + 1]).toBeCloseTo(rgb[1], 4)
      expect(rgb[i * 3 + 2]).toBeCloseTo(rgb[2], 4)
    }
    // Red channel dominant
    expect(rgb[0]).toBeGreaterThan(0.3)
    expect(rgb[0]).toBeGreaterThan(rgb[1] + 0.1)
    expect(rgb[0]).toBeGreaterThan(rgb[2] + 0.1)
  })

  it('coordinate_debug.js maps normalized coords to RGB — every pixel different', () => {
    const { rgb, pc } = runFrames(
      join(PB, 'pattern_maker/examples/utility/coordinate_debug.js'),
      eggMap
    )
    // All components should be within [0, 1] since normalized coords are [0, 1).
    for (let i = 0; i < pc; i++) {
      for (let c = 0; c < 3; c++) {
        const v = rgb[i * 3 + c]
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
    // At least some variety — not all pixels identical.
    let different = 0
    for (let i = 1; i < pc; i++) {
      if (rgb[i * 3] !== rgb[0] || rgb[i * 3 + 1] !== rgb[1] || rgb[i * 3 + 2] !== rgb[2]) different++
    }
    expect(different).toBeGreaterThan(pc * 0.5)
  })

  it('lava_flow.js produces non-zero varied RGB (perlin-driven)', () => {
    const { rgb, pc } = runFrames(
      join(PB, 'pattern_maker/examples/organic/lava_flow.js'),
      eggMap,
      { frames: 5 }
    )
    let nonZero = 0, sum = 0, maxV = 0
    for (let i = 0; i < pc * 3; i++) {
      expect(Number.isFinite(rgb[i])).toBe(true)
      if (rgb[i] > 0.01) nonZero++
      sum += rgb[i]
      if (rgb[i] > maxV) maxV = rgb[i]
    }
    expect(nonZero).toBeGreaterThan(pc)  // over a third of channels lit
    expect(sum / (pc * 3)).toBeGreaterThan(0.01)  // mean brightness non-trivial
    // With default brightness slider = 0.5 and perlin_max ≈ 0.435, peak channel
    // ≈ (0.435+0.5)³ · 0.5 ≈ 0.2 — so don't expect more than ~0.2 without wiring a
    // real slider widget.
    expect(maxV).toBeGreaterThan(0.1)
  })

  it('expanding_rings.js: time() advances across frames on one VM', () => {
    // Reuse a single VM so time() progresses between beforeRender calls.
    const patternSource = readFileSync(join(PB, 'pattern_maker/examples/geometric/expanding_rings.js'), 'utf8')
    const parsed = parseMapContent(readFileSync(eggMap, 'utf8'))
    const map = prepareMap(parsed, { normalizeMode: 'fill' })
    const vm = createVM({ source: patternSource, pixelCount: map.pixelCount, mapDim: map.dim })
    const chosen = selectRenderFn(map.dim, vm.classified)
    const { nx, ny, nz } = map.normalized
    const pc = map.pixelCount

    const captureFrame = () => {
      vm.beforeRender()
      const rgb = new Float32Array(pc * 3)
      for (let i = 0; i < pc; i++) {
        vm.resetPixel()
        chosen(i, nx, ny, nz, pc)
        vm.readPixel(rgb, i)
      }
      return rgb
    }

    const f1 = captureFrame()
    // Sleep so time() advances. Default speed is 0.04, period ≈ 2.6s, so 50ms is a real fraction.
    const start = Date.now()
    while (Date.now() - start < 50) { /* spin */ }
    const f2 = captureFrame()

    let diffs = 0
    for (let i = 0; i < f1.length; i++) if (Math.abs(f1[i] - f2[i]) > 0.01) diffs++
    expect(diffs).toBeGreaterThan(10)
  })

  it('fire.js runs on the 3D egg map via 2D render fallback', () => {
    // fire.js only exports render2D. On a 3D map, the dispatch cascade should
    // drop z and call render2D with (x, y).
    const { rgb, pc } = runFrames(
      join(PB, 'pattern_maker/examples/organic/fire.js'),
      eggMap,
      { frames: 10 }
    )
    // All finite, some non-zero.
    let nonZero = 0
    for (let i = 0; i < pc * 3; i++) {
      expect(Number.isFinite(rgb[i])).toBe(true)
      if (rgb[i] > 0.01) nonZero++
    }
    expect(nonZero).toBeGreaterThan(0)
  })
})
