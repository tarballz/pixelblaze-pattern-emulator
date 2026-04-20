import { createScene } from '../render/scene.js'
import { createPixelCloud } from '../render/pixels.js'
import { parseMapContent, prepareMap, selectRenderFn } from '../map/index.js'
import { createVM } from '../vm/index.js'

// ---------- DOM refs ----------
const canvas = document.getElementById('stage')
const fpsEl = document.getElementById('fps')
const countsEl = document.getElementById('counts')
const playPauseBtn = document.getElementById('playpause')
const toggleLoaderBtn = document.getElementById('toggleLoader')
const loaderEl = document.getElementById('loader')
const errorsEl = document.getElementById('errors')

// ---------- Scene (persistent across reloads) ----------
const sceneCtx = createScene(canvas)

// ---------- Runtime state ----------
let state = {
  patternSource: null,
  mapParsed: null,        // output of parseMapContent (raw coords)
  options: {
    normalizeMode: 'fill',
    forceDim: undefined,
    swapYZ: false,
    bloom: true
  },
  running: true,
  vm: null,
  pixelCloud: null,
  chosenRender: null,
  rgb: null,              // Float32Array pixelCount*3
  frameTimes: []
}

// Restore last-used options / inputs from localStorage
try {
  const saved = JSON.parse(localStorage.getItem('pb_emu.v1') || '{}')
  if (saved.patternSource) state.patternSource = saved.patternSource
  if (saved.mapText) document.getElementById('mapPaste').value = saved.mapText
  if (saved.patternPath) document.getElementById('patternPath').value = saved.patternPath
  if (saved.mapPath) document.getElementById('mapPath').value = saved.mapPath
  if (saved.options) Object.assign(state.options, saved.options)
} catch {}

document.getElementById('normalizeMode').value = state.options.normalizeMode
document.getElementById('swapYZ').checked = state.options.swapYZ
document.getElementById('bloomToggle').checked = state.options.bloom
sceneCtx.setBloomEnabled(state.options.bloom)

// ---------- Error display ----------
function showError(err) {
  if (!err) { errorsEl.textContent = ''; return }
  const msg = err instanceof Error ? err.stack || err.message : String(err)
  errorsEl.textContent = msg
  console.error(err)
}

// ---------- Tab switching ----------
document.querySelectorAll('.tabs').forEach(tabs => {
  const group = tabs.dataset.group
  tabs.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn))
      document.querySelectorAll(`[data-panel^="${group}-"]`).forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.panel !== `${group}-${btn.dataset.tab}`)
      })
    })
  })
})

// ---------- UI: loader visibility ----------
toggleLoaderBtn.addEventListener('click', () => loaderEl.classList.toggle('hidden'))
// Show on first load if nothing's loaded yet.
if (!state.patternSource) loaderEl.classList.remove('hidden')

// ---------- Input wiring ----------
function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(fr.error)
    fr.readAsText(file)
  })
}

async function fetchText(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`fetch ${url} — ${r.status}`)
  return await r.text()
}

// Pattern inputs
document.getElementById('patternFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]
  if (!f) return
  try { loadPattern(await readFile(f)) } catch (err) { showError(err) }
})
document.getElementById('patternPasteLoad').addEventListener('click', () => {
  loadPattern(document.getElementById('patternPaste').value)
})
document.getElementById('patternUrlLoad').addEventListener('click', async () => {
  try { loadPattern(await fetchText(document.getElementById('patternUrl').value.trim())) }
  catch (err) { showError(err) }
})
document.getElementById('patternPathLoad').addEventListener('click', async () => {
  const path = document.getElementById('patternPath').value.trim()
  try { loadPattern(await fetchText(path)) }
  catch (err) { showError(err) }
})

// Map inputs
document.getElementById('mapFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]
  if (!f) return
  try { loadMap(await readFile(f)) } catch (err) { showError(err) }
})
document.getElementById('mapPasteLoad').addEventListener('click', () => {
  loadMap(document.getElementById('mapPaste').value)
})
document.getElementById('mapUrlLoad').addEventListener('click', async () => {
  try { loadMap(await fetchText(document.getElementById('mapUrl').value.trim())) }
  catch (err) { showError(err) }
})
document.getElementById('mapPathLoad').addEventListener('click', async () => {
  const path = document.getElementById('mapPath').value.trim()
  try { loadMap(await fetchText(path)) }
  catch (err) { showError(err) }
})

// Options
document.getElementById('normalizeMode').addEventListener('change', (e) => {
  state.options.normalizeMode = e.target.value
  persist(); rebuildIfReady()
})
document.getElementById('forceDim').addEventListener('change', (e) => {
  const v = e.target.value
  state.options.forceDim = v === 'auto' ? undefined : parseInt(v, 10)
  rebuildIfReady()
})
document.getElementById('swapYZ').addEventListener('change', (e) => {
  state.options.swapYZ = e.target.checked
  persist(); rebuildIfReady()
})
document.getElementById('bloomToggle').addEventListener('change', (e) => {
  state.options.bloom = e.target.checked
  sceneCtx.setBloomEnabled(state.options.bloom)
  persist()
})

// Play / pause
playPauseBtn.addEventListener('click', () => {
  state.running = !state.running
  playPauseBtn.textContent = state.running ? 'Pause' : 'Play'
})

// ---------- Persistence ----------
function persist() {
  try {
    localStorage.setItem('pb_emu.v1', JSON.stringify({
      patternSource: state.patternSource,
      mapText: document.getElementById('mapPaste').value,
      patternPath: document.getElementById('patternPath').value,
      mapPath: document.getElementById('mapPath').value,
      options: state.options
    }))
  } catch {}
}

// ---------- Load flow ----------
function loadPattern(source) {
  showError(null)
  state.patternSource = source
  persist()
  rebuildIfReady()
}

function loadMap(text) {
  showError(null)
  try {
    state.mapParsed = parseMapContent(text, { pixelCountHint: 1024 })
  } catch (err) {
    showError(err)
    return
  }
  persist()
  rebuildIfReady()
}

function rebuildIfReady() {
  if (!state.patternSource || !state.mapParsed) return
  try { rebuild() } catch (err) { showError(err) }
}

function rebuild() {
  const prepared = prepareMap(state.mapParsed, state.options)
  const { pixelCount, coords, dim, normalized } = prepared

  // Replace pixel cloud
  if (state.pixelCloud) state.pixelCloud.dispose()
  state.pixelCloud = createPixelCloud(sceneCtx.scene, { coords, pixelCount })

  // Build VM
  state.vm = createVM({ source: state.patternSource, pixelCount, mapDim: dim })
  state.chosenRender = selectRenderFn(dim, state.vm.classified)
  state.rgb = new Float32Array(pixelCount * 3)
  state.preparedMap = prepared

  countsEl.textContent = `${pixelCount} LEDs · ${dim}D (${prepared.source})`
  showError(null)
}

// ---------- Render loop ----------
function frame() {
  requestAnimationFrame(frame)

  if (state.running && state.vm && state.chosenRender) {
    try {
      const { nx, ny, nz } = state.preparedMap.normalized
      const pc = state.preparedMap.pixelCount
      const rgb = state.rgb
      const vm = state.vm
      const chosen = state.chosenRender

      vm.beforeRender()
      for (let i = 0; i < pc; i++) {
        vm.resetPixel()
        chosen(i, nx, ny, nz, pc)
        vm.readPixel(rgb, i)
      }
      state.pixelCloud.setColors(rgb)
    } catch (err) {
      showError(err)
      state.running = false
      playPauseBtn.textContent = 'Play'
    }
  }

  // FPS: EMA of last second of frame times
  const now = performance.now()
  state.frameTimes.push(now)
  while (state.frameTimes.length && now - state.frameTimes[0] > 1000) state.frameTimes.shift()
  if (state.frameTimes.length > 1) {
    const fps = (state.frameTimes.length - 1) / ((state.frameTimes[state.frameTimes.length - 1] - state.frameTimes[0]) / 1000)
    fpsEl.textContent = `${fps.toFixed(0)} fps`
  }

  sceneCtx.render()
}
requestAnimationFrame(frame)

// Try to auto-rebuild if both were restored from localStorage.
// (Not really — mapParsed isn't serialized. Pattern alone will wait for map.)
