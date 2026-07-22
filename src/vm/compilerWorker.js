// Runs the real PixelBlaze compiler in an isolated Worker scope.
//
// The compiler text fetched from `/__pb_emu__/compiler` starts with
// `window = {};` — it was written to run inside Python's MiniRacer sandbox,
// which has no pre-existing `window`. A dedicated Worker has `self`, not the
// page's real `window`, so the same trick works here: the assignment just
// creates a normal worker-global property instead of colliding with
// anything. This file itself contains no proprietary code — it's just
// plumbing that evaluates whatever compiler text the dev server hands it.
// The `const compilePattern = ...` capture logic lives in compilerLoad.js
// (pure, unit-tested there) since it doesn't need Worker/`self` at all.

import { loadCompiler } from './compilerLoad.js'

let compilePatternFn = null

self.onmessage = (event) => {
  const { id, compilerSrc, source } = event.data

  if (compilerSrc !== undefined) {
    try {
      compilePatternFn = loadCompiler(compilerSrc)
      self.postMessage({ id, ready: !!compilePatternFn })
    } catch (err) {
      self.postMessage({ id, ready: false, error: String(err?.message || err) })
    }
    return
  }

  if (!compilePatternFn) {
    self.postMessage({ id, status: 'compiler not initialized' })
    return
  }
  try {
    const result = compilePatternFn(source)
    self.postMessage({ id, status: result?.status ?? 'unknown compiler response' })
  } catch (err) {
    self.postMessage({ id, status: String(err?.message || err) })
  }
}
