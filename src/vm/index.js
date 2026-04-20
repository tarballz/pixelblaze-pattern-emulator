// Public VM entry: load a pattern, return an object with a frame-step method.

import { createBuiltins } from './builtins.js'
import { loadPattern, classifyExports, applyControlDefaults } from './sandbox.js'
import { resetPixel, readPixel } from './currentPixel.js'

export function createVM({ source, pixelCount, mapDim }) {
  const startTime = performance.now()
  const ctx = {
    now: () => performance.now() - startTime,
    prngState: 1,
    transformStack: [identity()],
    mapDim
  }

  const env = createBuiltins(ctx)
  env.pixelCount = pixelCount

  const rawExports = loadPattern(source, env)
  const classified = classifyExports(rawExports)
  applyControlDefaults(classified.controls)

  let lastFrame = ctx.now()

  function beforeRender() {
    const t = ctx.now()
    const delta = t - lastFrame
    lastFrame = t
    if (classified.beforeRender) classified.beforeRender(delta)
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
