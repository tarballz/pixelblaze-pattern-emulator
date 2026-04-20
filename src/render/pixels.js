import * as THREE from 'three'

// THREE.Points cloud, one point per LED, rendered as a soft radial sprite with
// additive blending. Pairs with the UnrealBloomPass for the Pixelblaze-preview
// glow aesthetic — bright core, soft halo, saturated overlap.

let sharedSprite = null
function spriteTexture() {
  if (sharedSprite) return sharedSprite
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d').createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
  // Sharp solid core, short feather, no long halo. Bloom adds the glow; this
  // texture just defines the dot itself.
  g.addColorStop(0.0,  'rgba(255,255,255,1)')
  g.addColorStop(0.45, 'rgba(255,255,255,1)')
  g.addColorStop(0.6,  'rgba(255,255,255,0.35)')
  g.addColorStop(1.0,  'rgba(255,255,255,0)')
  const ctx = c.getContext('2d')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  sharedSprite = new THREE.CanvasTexture(c)
  sharedSprite.colorSpace = THREE.SRGBColorSpace
  return sharedSprite
}

export function createPixelCloud(scene, { coords, pixelCount }) {
  // Center and fit raw coords into [-1, 1]^3 so camera framing is stable
  // regardless of map units.
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < pixelCount; i++) {
    const x = coords[i * 3], y = coords[i * 3 + 1], z = coords[i * 3 + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2
  const spanMax = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1
  const scale = 2 / spanMax

  const positions = new Float32Array(pixelCount * 3)
  for (let i = 0; i < pixelCount; i++) {
    positions[i * 3]     = (coords[i * 3]     - cx) * scale
    positions[i * 3 + 1] = (coords[i * 3 + 1] - cy) * scale
    positions[i * 3 + 2] = (coords[i * 3 + 2] - cz) * scale
  }

  const colors = new Float32Array(pixelCount * 3)
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  // Point size: tuned so ~1500 LEDs on a unit-scale cloud gives overlapping
  // halos without blobbing into one mass. Bloom pushes the final brightness.
  const pointSize = 0.18 * (2 / Math.cbrt(pixelCount)) * 2

  const mat = new THREE.PointsMaterial({
    size: pointSize,
    map: spriteTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    // Normal blending keeps each dot showing its actual color, not accumulating
    // behind other dots (additive made overlapping LEDs look washed-out/transparent).
    blending: THREE.NormalBlending,
    alphaTest: 0.05,
    sizeAttenuation: true
  })

  const points = new THREE.Points(geom, mat)
  scene.add(points)

  // Perceptual display boost: raw pattern values are physically accurate but
  // look dim on a monitor (dark-blue LEDs near the eye are vivid; 0.2 on screen
  // isn't). Gamma < 1 brightens midtones while preserving 0→0 and 1→1.
  const DISPLAY_GAMMA = 0.55
  function setColors(rgb) {
    for (let i = 0; i < rgb.length; i++) {
      const v = rgb[i]
      colors[i] = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, DISPLAY_GAMMA)
    }
    geom.attributes.color.needsUpdate = true
  }

  function dispose() {
    scene.remove(points)
    geom.dispose()
    mat.dispose()
  }

  function setSize(s) {
    mat.size = s
  }

  const bounds = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
  return { points, setColors, setSize, dispose, scale, center: [cx, cy, cz], positions, bounds }
}
