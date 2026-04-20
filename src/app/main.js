import { createScene } from '../render/scene.js'
import { createPixelCloud } from '../render/pixels.js'
import { parseMapContent, prepareMap, selectRenderFnInfo, generateMap } from '../map/index.js'
import { createVM } from '../vm/index.js'
import { lintPattern } from '../vm/lint.js'
import { buildControlPanel } from './controls.js'
import { createPaletteStrip } from './palette.js'
import { createInspector } from './inspector.js'
import { unwrapPatternText } from './epe.js'

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
const paletteStrip = createPaletteStrip(document.getElementById('paletteStrip'))
createInspector({
  canvas,
  overlay: document.getElementById('inspector'),
  sceneCtx,
  getState: () => state
})

// ---------- Runtime state ----------
let state = {
  patternSource: null,
  mapParsed: null,        // output of parseMapContent (raw coords)
  lastPattern: null,      // { kind: 'path'|'url'|'paste'|'file'|'drop', value, name }
  lastMap: null,
  options: {
    normalizeMode: 'fill',
    forceDim: undefined,
    swapYZ: false,
    bloom: true,
    speed: 1,
    ledSize: null,         // null = use pixels.js default
    bloomStrength: 0.55,
    bloomRadius: 0.2
  },
  running: true,
  vm: null,
  pixelCloud: null,
  chosenRender: null,
  rgb: null,              // Float32Array pixelCount*3
  frameTimes: []
}

const RECENTS_KEY = 'pb_emu.recents.v1'
const RECENTS_MAX = 8

// Restore last-used options / inputs from localStorage
try {
  const saved = JSON.parse(localStorage.getItem('pb_emu.v1') || '{}')
  if (saved.patternSource) state.patternSource = saved.patternSource
  if (saved.mapText) document.getElementById('mapPaste').value = saved.mapText
  if (saved.patternPath) document.getElementById('patternPath').value = saved.patternPath
  if (saved.mapPath) document.getElementById('mapPath').value = saved.mapPath
  if (saved.options) Object.assign(state.options, saved.options)
  if (saved.lastPattern) state.lastPattern = saved.lastPattern
  if (saved.lastMap) state.lastMap = saved.lastMap
} catch {}

document.getElementById('normalizeMode').value = state.options.normalizeMode
document.getElementById('swapYZ').checked = state.options.swapYZ
document.getElementById('bloomToggle').checked = state.options.bloom
document.getElementById('speed').value = String(state.options.speed ?? 1)
document.getElementById('speedVal').textContent = (state.options.speed ?? 1).toFixed(2) + '\u00D7'
sceneCtx.setBloomEnabled(state.options.bloom)

// ---------- Source descriptors + recents ----------
function descriptorName(d) {
  if (!d) return ''
  if (d.name) return d.name
  if (d.kind === 'path' || d.kind === 'url') {
    const tail = d.value.split(/[?#]/)[0].split('/').filter(Boolean).pop() || d.value
    return tail
  }
  if (d.kind === 'paste') return 'paste: ' + d.value.slice(0, 24).replace(/\s+/g, ' ')
  return d.kind
}

function loadRecents() {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]') } catch { return [] }
}
function saveRecents(list) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX))) } catch {}
}
function pushRecent(kind, descriptor) {
  // Never store file contents: files can't be reopened by path, and paste bodies can be huge.
  if (descriptor.kind !== 'path' && descriptor.kind !== 'url') return
  const list = loadRecents()
  const entry = { kind, descriptor: { kind: descriptor.kind, value: descriptor.value, name: descriptor.name } }
  const filtered = list.filter(r => !(r.kind === entry.kind && r.descriptor.kind === entry.descriptor.kind && r.descriptor.value === entry.descriptor.value))
  filtered.unshift(entry)
  saveRecents(filtered)
  renderRecents()
}
function renderRecents() {
  const sel = document.getElementById('recents')
  if (!sel) return
  const list = loadRecents()
  sel.replaceChildren()
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = list.length ? 'Recents…' : '(no recents)'
  sel.appendChild(placeholder)
  list.forEach((r, i) => {
    const opt = document.createElement('option')
    opt.value = String(i)
    opt.textContent = `${r.kind === 'pattern' ? '▸' : '▹'} ${descriptorName(r.descriptor)}`
    sel.appendChild(opt)
  })
  sel.disabled = list.length === 0
}

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
  try { loadPattern(await readFile(f), { kind: 'file', value: null, name: f.name }) } catch (err) { showError(err) }
})
document.getElementById('patternPasteLoad').addEventListener('click', () => {
  const text = document.getElementById('patternPaste').value
  loadPattern(text, { kind: 'paste', value: text })
})
document.getElementById('patternUrlLoad').addEventListener('click', async () => {
  const url = document.getElementById('patternUrl').value.trim()
  try { loadPattern(await fetchText(url), { kind: 'url', value: url }) }
  catch (err) { showError(err) }
})
document.getElementById('patternPathLoad').addEventListener('click', async () => {
  const path = document.getElementById('patternPath').value.trim()
  try { loadPattern(await fetchText(path), { kind: 'path', value: path }) }
  catch (err) { showError(err) }
})

// Map inputs
document.getElementById('mapFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]
  if (!f) return
  try { loadMap(await readFile(f), { kind: 'file', value: null, name: f.name }) } catch (err) { showError(err) }
})
document.getElementById('mapPasteLoad').addEventListener('click', () => {
  const text = document.getElementById('mapPaste').value
  loadMap(text, { kind: 'paste', value: text })
})
document.getElementById('mapUrlLoad').addEventListener('click', async () => {
  const url = document.getElementById('mapUrl').value.trim()
  try { loadMap(await fetchText(url), { kind: 'url', value: url }) }
  catch (err) { showError(err) }
})
document.getElementById('mapPathLoad').addEventListener('click', async () => {
  const path = document.getElementById('mapPath').value.trim()
  try { loadMap(await fetchText(path), { kind: 'path', value: path }) }
  catch (err) { showError(err) }
})

// Map generator
const mapGenShape = document.getElementById('mapGenShape')
const mapGenW = document.getElementById('mapGenW')
const mapGenH = document.getElementById('mapGenH')
const mapGenD = document.getElementById('mapGenD')
function updateGenInputs() {
  const s = mapGenShape.value
  mapGenH.style.display = s === '1d' ? 'none' : ''
  mapGenD.style.display = s === '3d' ? '' : 'none'
}
mapGenShape.addEventListener('change', updateGenInputs)
updateGenInputs()
document.getElementById('mapGenLoad').addEventListener('click', () => {
  loadGeneratedMap({
    shape: mapGenShape.value,
    w: parseInt(mapGenW.value, 10) || 1,
    h: parseInt(mapGenH.value, 10) || 1,
    d: parseInt(mapGenD.value, 10) || 1
  })
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

// View preset buttons
document.querySelectorAll('#viewPresets button').forEach(btn => {
  btn.addEventListener('click', () => sceneCtx.setView(btn.dataset.view))
})

// Live visual tuning
const ledSizeInput = document.getElementById('ledSize')
const bloomStrengthInput = document.getElementById('bloomStrength')
const bloomRadiusInput = document.getElementById('bloomRadius')
if (state.options.ledSize != null) ledSizeInput.value = String(state.options.ledSize)
bloomStrengthInput.value = String(state.options.bloomStrength)
bloomRadiusInput.value = String(state.options.bloomRadius)

ledSizeInput.addEventListener('input', () => {
  const v = parseFloat(ledSizeInput.value)
  state.options.ledSize = v
  if (state.pixelCloud) state.pixelCloud.setSize(v)
  persist()
})
bloomStrengthInput.addEventListener('input', () => {
  const v = parseFloat(bloomStrengthInput.value)
  state.options.bloomStrength = v
  sceneCtx.setBloom({ strength: v })
  persist()
})
bloomRadiusInput.addEventListener('input', () => {
  const v = parseFloat(bloomRadiusInput.value)
  state.options.bloomRadius = v
  sceneCtx.setBloom({ radius: v })
  persist()
})

// Apply stored bloom values on startup so sliders aren't out of sync with the scene.
sceneCtx.setBloom({ strength: state.options.bloomStrength, radius: state.options.bloomRadius })

// Reload
document.getElementById('reload').addEventListener('click', () => { reloadPattern() })

// Recents
const recentsSel = document.getElementById('recents')
recentsSel.addEventListener('change', async () => {
  const idx = parseInt(recentsSel.value, 10)
  recentsSel.value = ''
  if (!Number.isInteger(idx)) return
  const list = loadRecents()
  const entry = list[idx]
  if (!entry) return
  try {
    const text = await fetchText(entry.descriptor.value)
    if (entry.kind === 'pattern') loadPattern(text, entry.descriptor)
    else loadMap(text, entry.descriptor)
  } catch (err) { showError(err) }
})
renderRecents()
updateReloadButton()

// Help overlay
const helpOverlay = document.getElementById('helpOverlay')
document.getElementById('help').addEventListener('click', () => helpOverlay.classList.toggle('hidden'))
helpOverlay.addEventListener('click', () => helpOverlay.classList.add('hidden'))

// Drag-and-drop — route by extension. `.js` → pattern, `.csv|.json` → map.
const dropTarget = document.getElementById('dropTarget')
let dragDepth = 0
document.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return
  dragDepth++
  dropTarget.classList.remove('hidden')
})
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dropTarget.classList.add('hidden')
})
document.addEventListener('dragover', (e) => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
})
document.addEventListener('drop', async (e) => {
  if (!e.dataTransfer || !e.dataTransfer.files.length) return
  e.preventDefault()
  dragDepth = 0
  dropTarget.classList.add('hidden')
  for (const file of e.dataTransfer.files) {
    const name = file.name.toLowerCase()
    try {
      const text = await readFile(file)
      if (name.endsWith('.csv')) {
        loadMap(text, { kind: 'file', value: null, name: file.name })
      } else if (name.endsWith('.epe') || name.endsWith('.js')) {
        loadPattern(text, { kind: 'file', value: null, name: file.name })
      } else if (name.endsWith('.json')) {
        // Ambiguous — EPE is valid JSON. If it parses as an EPE, unwrap as a
        // pattern; otherwise treat as a map.
        const epe = unwrapPatternText(text, file.name)
        if (epe.source !== text) loadPattern(text, { kind: 'file', value: null, name: file.name })
        else loadMap(text, { kind: 'file', value: null, name: file.name })
      } else {
        showError(new Error(`Unsupported drop: ${file.name}`))
      }
    } catch (err) { showError(err) }
  }
})

// Keyboard shortcuts — skip when typing in an input/textarea.
document.addEventListener('keydown', (e) => {
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); return }
  if (e.key === '.')      { if (!state.running) runOnePatternFrame(1000 / 60); return }
  if (e.key === 'r' || e.key === 'R') { reloadPattern(); return }
  if (e.key === 'l' || e.key === 'L') { loaderEl.classList.toggle('hidden'); return }
  if (e.key === '?')      { helpOverlay.classList.toggle('hidden'); return }
})

// Play / pause
playPauseBtn.addEventListener('click', togglePlay)

function togglePlay() {
  state.running = !state.running
  playPauseBtn.textContent = state.running ? 'Pause' : 'Play'
  document.getElementById('step').disabled = state.running
  // When resuming after a pause, reset the real-delta clock so the pattern
  // doesn't eat the whole pause as one giant frame.
  if (state.running) lastFrameWall = performance.now()
}

// Step: advance exactly one frame while paused.
document.getElementById('step').addEventListener('click', () => {
  if (state.running) return
  runOnePatternFrame(1000 / 60)
})

// Screenshot — preserveDrawingBuffer is enabled in scene.js so .toBlob works.
document.getElementById('screenshot').addEventListener('click', () => {
  sceneCtx.render()  // ensure the current frame is on the buffer before capture
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pb_emu-${Date.now()}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, 'image/png')
})

// Speed slider.
const speedInput = document.getElementById('speed')
const speedVal = document.getElementById('speedVal')
speedInput.addEventListener('input', () => {
  const v = parseFloat(speedInput.value)
  speedVal.textContent = v.toFixed(2) + '\u00D7'
  if (state.vm) state.vm.ctx.speed = v
  state.options.speed = v
  persist()
})

// ---------- Persistence ----------
function persist() {
  try {
    localStorage.setItem('pb_emu.v1', JSON.stringify({
      patternSource: state.patternSource,
      mapText: document.getElementById('mapPaste').value,
      patternPath: document.getElementById('patternPath').value,
      mapPath: document.getElementById('mapPath').value,
      lastPattern: state.lastPattern,
      lastMap: state.lastMap,
      options: state.options
    }))
  } catch {}
}

// ---------- Load flow ----------
function loadPattern(text, descriptor) {
  showError(null)
  // Auto-unwrap EPE: the file dialog may pass in a raw .epe JSON, drag-drop
  // can too, and even the URL/Path fetchers can hit ".epe" endpoints.
  const { source, name } = unwrapPatternText(text, descriptor?.name)
  state.patternSource = source
  if (descriptor) {
    const d = name && !descriptor.name ? { ...descriptor, name } : descriptor
    state.lastPattern = d
    pushRecent('pattern', d)
  }
  updateReloadButton()
  showLintFindings(lintPattern(source))
  persist()
  rebuildIfReady()
}

async function reloadPattern() {
  const d = state.lastPattern
  if (!d) return
  try {
    if (d.kind === 'path' || d.kind === 'url') {
      loadPattern(await fetchText(d.value), d)
    } else if (d.kind === 'paste') {
      loadPattern(d.value, d)
    } else {
      // 'file' — can't re-read; just re-apply the last source we have.
      if (state.patternSource) loadPattern(state.patternSource, d)
    }
  } catch (err) { showError(err) }
}

async function reloadMap() {
  const d = state.lastMap
  if (!d) return
  try {
    if (d.kind === 'path' || d.kind === 'url') {
      loadMap(await fetchText(d.value), d)
    } else if (d.kind === 'paste') {
      loadMap(d.value, d)
    } else if (d.kind === 'generated') {
      loadGeneratedMap(JSON.parse(d.value))
    }
  } catch (err) { showError(err) }
}

function updateReloadButton() {
  const btn = document.getElementById('reload')
  if (!btn) return
  const d = state.lastPattern
  const reloadable = d && (d.kind === 'path' || d.kind === 'url' || d.kind === 'paste')
  btn.disabled = !reloadable
  btn.title = reloadable ? `Reload ${descriptorName(d)} (R)` : 'Loaded from file — re-open to reload (R)'
}

function showLintFindings(findings) {
  const el = document.getElementById('warnings')
  if (!el) return
  el.replaceChildren()
  if (!findings.length) { el.classList.add('hidden'); return }
  for (const f of findings) {
    const row = document.createElement('div')
    row.className = `warn-${f.severity}`
    row.textContent = `[${f.severity}] ${f.message}`
    el.appendChild(row)
  }
  el.classList.remove('hidden')
}

function loadMap(text, descriptor) {
  showError(null)
  let parsed
  try {
    parsed = parseMapContent(text, { pixelCountHint: 1024 })
  } catch (err) {
    showError(err)
    return
  }
  applyMapParsed(parsed, descriptor)
}

function applyMapParsed(parsed, descriptor) {
  showError(null)
  state.mapParsed = parsed
  if (descriptor) {
    state.lastMap = descriptor
    pushRecent('map', descriptor)
  }
  persist()
  rebuildIfReady()
}

function loadGeneratedMap(params) {
  try {
    const parsed = generateMap(params)
    const name = params.shape === '1d' ? `1D ×${params.w}`
               : params.shape === '2d' ? `2D ${params.w}×${params.h}`
               :                          `3D ${params.w}×${params.h}×${params.d}`
    applyMapParsed(parsed, { kind: 'generated', value: JSON.stringify(params), name })
  } catch (err) { showError(err) }
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

  // Auto-fit the camera to the cloud. Positions are in [-1, 1]^3 (pixels.js
  // re-centers), so the fit is symmetric about the origin.
  sceneCtx.fitTo([0, 0, 0], Math.sqrt(3))

  // Build VM
  state.vm = createVM({ source: state.patternSource, pixelCount, mapDim: dim })
  state.vm.ctx.speed = state.options.speed ?? 1
  const info = selectRenderFnInfo(dim, state.vm.classified)
  state.chosenRender = info.fn
  state.rgb = new Float32Array(pixelCount * 3)
  state.preparedMap = prepared

  // Build the control panel — this replaces applyControlDefaults' single
  // default invocation with live widgets, each setting its own initial value.
  const controlsEl = document.getElementById('controls')
  buildControlPanel(controlsEl, state.vm.classified.controls, state.patternSource)

  countsEl.textContent = `${pixelCount} LEDs · ${dim}D (${prepared.source ?? 'map'}) · ${info.picked}`
  showError(null)
}

// ---------- Render loop ----------
function runOnePatternFrame(realDeltaMs) {
  if (!state.vm || !state.chosenRender) return
  try {
    const { nx, ny, nz } = state.preparedMap.normalized
    const pc = state.preparedMap.pixelCount
    const rgb = state.rgb
    const vm = state.vm
    const chosen = state.chosenRender

    vm.beforeRender(realDeltaMs)
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

let lastFrameWall = performance.now()
function frame() {
  requestAnimationFrame(frame)

  const wall = performance.now()
  const realDelta = wall - lastFrameWall
  lastFrameWall = wall

  if (state.running) runOnePatternFrame(realDelta)
  paletteStrip.draw()

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
