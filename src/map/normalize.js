// Normalize raw world coordinates into [0, 1) per Pixelblaze semantics.
//
// Two modes (per canonical README.mapper.md):
//   Fill    — per-axis independent scaling. Each axis spans [0, 1-EPS].
//             Non-square maps get stretched to fill the unit cube. (PB default.)
//   Contain — divide all axes by the single largest (max-min). Preserves aspect
//             ratio; smaller axes use only part of the [0, 1] range.
//
// Output is strictly < 1.0 (exclusive upper bound) so patterns checking `x == 1`
// never match, per the README's explicit note.

const EPS = 1e-6

export function normalize(coords, { mode = 'fill', swapYZ = false } = {}) {
  const n = coords.length / 3
  if (!n) return { nx: new Float32Array(0), ny: new Float32Array(0), nz: new Float32Array(0), dims: [0, 0, 0] }

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (let i = 0; i < n; i++) {
    let x = coords[i * 3 + 0]
    let y = coords[i * 3 + 1]
    let z = coords[i * 3 + 2]
    if (swapYZ) { const t = y; y = z; z = t }
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }

  const spanX = maxX - minX
  const spanY = maxY - minY
  const spanZ = maxZ - minZ

  const nx = new Float32Array(n)
  const ny = new Float32Array(n)
  const nz = new Float32Array(n)

  // Divisor chosen per mode, per axis. We treat a zero-span axis as collapsed
  // to 0 (patterns get a consistent value rather than NaN).
  let dx, dy, dz
  if (mode === 'contain') {
    const maxSpan = Math.max(spanX, spanY, spanZ)
    dx = dy = dz = maxSpan > 0 ? maxSpan : 1
  } else {
    dx = spanX > 0 ? spanX : 1
    dy = spanY > 0 ? spanY : 1
    dz = spanZ > 0 ? spanZ : 1
  }

  // Scale by (1 - EPS) so the top of the range is strictly < 1.0.
  const clip = 1 - EPS

  for (let i = 0; i < n; i++) {
    let x = coords[i * 3 + 0]
    let y = coords[i * 3 + 1]
    let z = coords[i * 3 + 2]
    if (swapYZ) { const t = y; y = z; z = t }
    const normX = spanX > 0 ? ((x - minX) / dx) * clip : 0
    const normY = spanY > 0 ? ((y - minY) / dy) * clip : 0
    const normZ = spanZ > 0 ? ((z - minZ) / dz) * clip : 0
    nx[i] = normX
    ny[i] = normY
    nz[i] = normZ
  }

  return { nx, ny, nz, dims: [spanX, spanY, spanZ] }
}
