// Choose which pattern render function to call per pixel, given a map's
// effective dimensionality. Per the Pixelblaze fallback cascade (forum thread
// 4228 / beta notes):
//
//   Map is 3D → render3D → render2D (z dropped) → render(index)
//   Map is 2D → render2D → render3D with z=0.5 → render(index)
//   No map    → render(index) — with x = index/pixelCount if a coord-using
//               fallback is chosen
//
// Returns a function (i, nx, ny, nz, pixelCount) => void that invokes the
// best available exported render function with the right args.

export function selectRenderFn(dim, exports) {
  return selectRenderFnInfo(dim, exports).fn
}

// Same selection logic, but returns { fn, picked } so the HUD can show which
// path won. `picked` describes the effective mapping, e.g. 'render3D' or
// 'render2D (z dropped)'.
export function selectRenderFnInfo(dim, exports) {
  const { render, render2D, render3D } = exports

  // `raw` + `kind` let the host inline the per-pixel call site (no arrow-fn
  // indirection in the hot loop). `fn` is kept for existing callers/tests.
  if (dim === 3) {
    if (render3D) return { fn: (i, nx, ny, nz) => render3D(i, nx[i], ny[i], nz[i]), picked: 'render3D',            kind: '3d',      raw: render3D }
    if (render2D) return { fn: (i, nx, ny)     => render2D(i, nx[i], ny[i]),        picked: 'render2D (z dropped)', kind: '2d',      raw: render2D }
    if (render)   return { fn: (i)             => render(i),                        picked: 'render (index only)',  kind: 'index',   raw: render }
  } else if (dim === 2) {
    if (render2D) return { fn: (i, nx, ny)     => render2D(i, nx[i], ny[i]),        picked: 'render2D',             kind: '2d',      raw: render2D }
    if (render3D) return { fn: (i, nx, ny)     => render3D(i, nx[i], ny[i], 0.5),   picked: 'render3D (z=0.5)',     kind: '2d-as-3d',raw: render3D }
    if (render)   return { fn: (i)             => render(i),                        picked: 'render (index only)',  kind: 'index',   raw: render }
  } else {
    if (render)   return { fn: (i)                       => render(i),              picked: 'render',               kind: 'index',   raw: render }
    if (render2D) return { fn: (i, _nx, _ny, _nz, pc)    => render2D(i, i / pc, 0.5), picked: 'render2D (x=i/pc)',  kind: '1d-as-2d',raw: render2D }
    if (render3D) return { fn: (i, _nx, _ny, _nz, pc)    => render3D(i, i / pc, 0.5, 0.5), picked: 'render3D (x=i/pc)', kind: '1d-as-3d', raw: render3D }
  }

  throw new Error('pattern has no render function')
}

// Detect the effective map dimensionality. Forced overrides win.
//   auto: if any z is non-zero → 3D, else 2D; pixelCount==1 → 1D
export function detectDim(map, forced) {
  if (forced === 1 || forced === 2 || forced === 3) return forced
  if (map.dimHint === 1) return 1
  if (map.dimHint === 2) return 2
  // dimHint was 3 by source — confirm with actual data
  const { coords, pixelCount } = map
  if (pixelCount === 0) return 1
  for (let i = 0; i < pixelCount; i++) {
    if (coords[i * 3 + 2] !== 0) return 3
  }
  return 2
}
