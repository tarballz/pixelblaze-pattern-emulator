// Public VM entry: load a pattern, return an object with a frame-step method.

import { createBuiltins } from './builtins.js'
import { loadPattern, classifyExports, applyControlDefaults } from './sandbox.js'
import { resetPixel, readPixel } from './currentPixel.js'

export function createVM({ source, pixelCount, mapDim }) {
  // Sim clock: time() inside a pattern reads ctx.now(), which returns a value
  // we control. advance() adds `deltaMs * speed` so a speed slider slows/
  // fast-forwards the pattern, and a paused host can step exactly one frame
  // without wall-clock drift.
  const ctx = {
    simTime: 0,
    speed: 1,
    now: () => ctx.simTime,
    advance(realDeltaMs) {
      const d = realDeltaMs * ctx.speed
      ctx.simTime += d
      return d
    },
    prngState: 1,
    transformStack: [identity()],
    mapDim
  }

  const env = createBuiltins(ctx)
  env.pixelCount = pixelCount

  const rawExports = loadPattern(source, env)
  const classified = classifyExports(rawExports)
  applyControlDefaults(classified.controls)

  let lastWall = performance.now()

  // If the host doesn't pass a delta, derive it from wall time since the last
  // call (matches the original behavior).
  function beforeRender(realDeltaMs) {
    if (realDeltaMs == null) {
      const wall = performance.now()
      realDeltaMs = wall - lastWall
      lastWall = wall
    } else {
      lastWall = performance.now()
    }
    const simDelta = ctx.advance(realDeltaMs)
    if (classified.beforeRender) classified.beforeRender(simDelta)
  }

  return {
    ctx,
    classified,
    beforeRender,
    render: classified.render,
    render2D: classified.render2D,
    render3D: classified.render3D,
    resetPixel,
    readPixel
  }
}

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}
