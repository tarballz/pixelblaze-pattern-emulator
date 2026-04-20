// Click-an-LED inspector. Raycasts the points cloud on canvas click, finds the
// nearest LED, and shows its index, raw+normalized coords, and current RGB in
// a floating overlay.

import * as THREE from 'three'

export function createInspector({ canvas, overlay, sceneCtx, getState }) {
  const raycaster = new THREE.Raycaster()
  // Threshold in world units — the points cloud is fit into [-1, 1]³, so a
  // small absolute threshold gives a generous but not-whole-scene hit zone.
  raycaster.params.Points = { threshold: 0.04 }
  const pointer = new THREE.Vector2()

  canvas.addEventListener('click', (e) => {
    const s = getState()
    if (!s || !s.pixelCloud || !s.preparedMap) { hide(); return }
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, sceneCtx.camera)
    const hits = raycaster.intersectObject(s.pixelCloud.points, false)
    if (!hits.length) { hide(); return }

    // Nearest by distance to camera — first entry.
    const hit = hits[0]
    const i = hit.index
    const { nx, ny, nz } = s.preparedMap.normalized
    const coords = s.preparedMap.coords
    const rgb = s.rgb

    overlay.replaceChildren()
    const title = document.createElement('div')
    title.className = 'insp-title'
    title.textContent = `LED #${i}`
    overlay.appendChild(title)
    overlay.appendChild(kv('raw', `${fmt(coords[i*3])}, ${fmt(coords[i*3+1])}, ${fmt(coords[i*3+2])}`))
    overlay.appendChild(kv('norm', `${fmt(nx[i])}, ${fmt(ny[i])}, ${fmt(nz[i])}`))
    overlay.appendChild(kv('rgb', `${fmt(rgb[i*3])}, ${fmt(rgb[i*3+1])}, ${fmt(rgb[i*3+2])}`))
    overlay.classList.remove('hidden')
  })

  overlay.addEventListener('click', hide)

  function hide() { overlay.classList.add('hidden') }
}

function kv(k, v) {
  const row = document.createElement('div')
  row.className = 'insp-kv'
  const key = document.createElement('span'); key.className = 'insp-k'; key.textContent = k
  const val = document.createElement('span'); val.className = 'insp-v'; val.textContent = v
  row.appendChild(key); row.appendChild(val)
  return row
}

function fmt(n) { return Number.isFinite(n) ? n.toFixed(3) : '—' }
