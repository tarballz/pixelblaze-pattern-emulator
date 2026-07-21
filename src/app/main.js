import { createScene } from '../render/scene.js'
import { createPixelCloud } from '../render/pixels.js'
import { parseMapContent, prepareMap, selectRenderFnInfo, generateMap } from '../map/index.js'
import { createVM } from '../vm/index.js'
import { lintPattern, countExpensiveRenderOps } from '../vm/lint.js'
import { PATTERN_LINE_OFFSET } from '../vm/sandbox.js'
import { buildControlPanel, readCurrentValues } from './controls.js'
import { createPaletteStrip } from './palette.js'
import { createInspector } from './inspector.js'
import { unwrapPatternText } from './epe.js'
import { createWatcher } from './watcher.js'
import { createBrowser } from './browser.js'
import { createEditor } from './editor.js'
import { openDevice } from './device.js'

// ---------- DOM refs ----------
const canvas = document.getElementById('stage')
const countsEl = document.getElementById('counts')
const playPauseBtn = document.getElementById('playpause')
const toggleLoaderBtn = document.getElementById('toggleLoader')
const loaderEl = document.getElementById('loader')
const errorsEl = document.getElementById('errors')
const editorEl = document.getElementById('editor')
const fileNameEl = document.getElementById('fileName')
const renderIndicatorEl = document.getElementById('renderIndicator')
const saveBtnEl = document.getElementById('saveBtn')
const toggleEditorBtnEl = document.getElementById('toggleEditor')

// Keep the loader panel just below the HUD regardless of how tall the HUD is
// (stats lines, device row, etc. all change its height). A hardcoded CSS top
// overlapped the two panels the moment the HUD grew a row.
{
  const hudEl = document.getElementById('hud')
  const positionLoader = () => {
    const top = hudEl.offsetTop + hudEl.offsetHeight + 8
    loaderEl.style.top = `${top}px`
    loaderEl.style.maxHeight = `calc(100% - ${top + 12}px)`
  }
  new ResizeObserver(positionLoader).observe(hudEl)
  positionLoader()
}

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
    fixedPoint: 'auto',   // 'auto' (honor // @fixedpoint pragma) | 'on' | 'off'
    outputMethod: 'ws2812', // 'ws2812' | 'expander' | 'apa102' — for the HW FPS estimate
    simHwFps: false,        // step the pattern at the estimated hardware frame rate
    deviceIp: '',           // last-used Pixelblaze IP for the device link
    bloom: false,
    speed: 1,
    ledSize: null,         // null = use pixels.js default
    bloomStrength: 0.55,
    bloomRadius: 0.2,
    autoReload: true
  },
  running: true,
  needsFit: true,
  editorVisible: false,
  dirty: false,           // editor buffer is newer than the on-disk source
  vm: null,
  pixelCloud: null,
  chosenRender: null,
  rgb: null,              // Float32Array pixelCount*3
}

const RECENTS_KEY = 'pb_emu.recents.v1'
const RECENTS_MAX = 8

// Restore last-used options / inputs from localStorage
try {
  const saved = JSON.parse(localStorage.getItem('pb_emu.v1') || '{}')
  // NB: patternSource / lastPattern / lastMap are intentionally NOT restored —
  // the editor starts blank on every load, and those descriptors only make
  // sense alongside their actual content (which isn't serialized). Restoring
  // them independently leaves the UI pointing at a pattern that isn't loaded.
  if (saved.mapText) document.getElementById('mapPaste').value = saved.mapText
  if (saved.options) Object.assign(state.options, saved.options)
  // editorVisible intentionally not restored — every load starts with the
  // editor hidden; the user opts in per session via the Edit button / `E`.
} catch {}

document.getElementById('normalizeMode').value = state.options.normalizeMode
document.getElementById('swapYZ').checked = state.options.swapYZ
document.getElementById('fixedPoint').value = state.options.fixedPoint ?? 'auto'
document.getElementById('outputMethod').value = state.options.outputMethod ?? 'ws2812'
document.getElementById('simHwFps').checked = !!state.options.simHwFps
document.getElementById('bloomToggle').checked = state.options.bloom
document.getElementById('speed').value = String(state.options.speed ?? 1)
document.getElementById('speedVal').textContent = (state.options.speed ?? 1).toFixed(2) + '\u00D7'
sceneCtx.setBloomEnabled(state.options.bloom)

// ---------- Editor (CodeMirror 6) ----------
// Mounted before the watcher because loadPattern pokes editor.setDoc, and
// the watcher's onChange closure captures `editor` by reference.
const editor = createEditor({
  parent: editorEl,
  onChange: (source) => {
    // Keep the current descriptor on in-editor edits so Save knows where to
    // write back. If there's no prior descriptor (blank buffer scenario), fall
    // back to an ephemeral 'editor' kind — download-only.
    const prev = state.lastPattern
    const descriptor = prev || { kind: 'editor', value: null, name: 'untitled.js' }
    const previousValues = readCurrentValues(document.getElementById('controls'))
    loadPattern(source, descriptor, { previousValues, fromEditor: true })
  },
  onSave: () => saveOrDownload()
})

function downloadPattern(text, name) {
  const blob = new Blob([text], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = /\.js$/i.test(name) ? name : `${name}.js`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Whether the active descriptor maps to a writable file on disk. The write
// endpoint only permits the 'external' root (shipped samples stay read-only).
function canWriteToDisk(d) {
  return !!(d && d.kind === 'path' && d.root === 'external' && typeof d.relPath === 'string')
}

async function saveOrDownload() {
  const d = state.lastPattern
  const text = editor.getDoc()
  if (canWriteToDisk(d)) {
    await saveToDisk(d, text)
  } else {
    // Paste / URL / file / raw-editor buffers → no known disk target. Fall back
    // to a browser download so the user can still keep their work.
    downloadPattern(text, d?.name || 'pattern.js')
    flashSaveButton('Downloaded', 'ok')
  }
}

async function writeToDisk(d, text) {
  const r = await fetch('/__pb_emu__/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'pattern', root: d.root, path: d.relPath, content: text })
  })
  if (!r.ok) {
    const msg = await r.text().catch(() => `HTTP ${r.status}`)
    throw new Error(msg || `HTTP ${r.status}`)
  }
}

async function saveToDisk(d, text) {
  clearTimeout(autosaveTimer)
  setSaveButtonState('Saving…', 'busy')
  try {
    // Watcher pause/rebaseline/resume avoids the poll reading our own write
    // and firing onChange against whatever the user is typing now.
    watcher.pause()
    await writeToDisk(d, text)
    state.dirty = false
    updateFileNameLabel()
    watcher.rebaseline('pattern', text)
    flashSaveButton('Saved', 'ok')
  } catch (err) {
    showError(err)
    flashSaveButton('Save failed', 'err')
  } finally {
    watcher.resume()
  }
}

// Autosave: on editor edits to a path-writable descriptor, write through to
// disk after a brief idle. The editor's onChange is already debounced ~200ms,
// so this extra delay just coalesces fast bursts into one write.
let autosaveTimer = null
const AUTOSAVE_DELAY_MS = 200
function scheduleAutosave() {
  if (!canWriteToDisk(state.lastPattern)) return
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(runAutosave, AUTOSAVE_DELAY_MS)
}
async function runAutosave() {
  const d = state.lastPattern
  if (!canWriteToDisk(d)) return
  const text = editor.getDoc()
  try {
    await writeToDisk(d, text)
    // User may have swapped files mid-flight — only clear dirty if we're
    // still on the same descriptor we just wrote.
    if (state.lastPattern !== d) return
    state.dirty = false
    updateFileNameLabel()
    // Re-arm the watcher so external edits land once the user idles. The
    // first tick baselines against our freshly-written content, so we won't
    // self-fire; rebaseline is belt-and-suspenders against a racing external
    // writer between our POST and the poll.
    watcher.watch('pattern', d, onExternalPatternChange)
    watcher.rebaseline('pattern', text)
  } catch (err) {
    showError(err)
    flashSaveButton('Save failed', 'err')
  }
}

function onExternalPatternChange(fresh) {
  const d = state.lastPattern
  if (!d) return
  editor?.setDoc(fresh)
  loadPattern(fresh, d)
}

let saveFlashTimer = null
function flashSaveButton(label, tone) {
  setSaveButtonState(label, tone)
  clearTimeout(saveFlashTimer)
  saveFlashTimer = setTimeout(() => setSaveButtonState('Save', null), 1200)
}
function setSaveButtonState(label, tone) {
  if (!saveBtnEl) return
  saveBtnEl.textContent = label
  saveBtnEl.dataset.tone = tone || ''
}

function updateFileNameLabel() {
  if (!fileNameEl) return
  const base = descriptorName(state.lastPattern) || 'untitled'
  fileNameEl.textContent = state.dirty ? `${base} •` : base
}

saveBtnEl?.addEventListener('click', () => { saveOrDownload() })

// ---------- Editor visibility toggle ----------
function applyEditorVisibility() {
  document.body.classList.toggle('editor-hidden', !state.editorVisible)
  if (toggleEditorBtnEl) toggleEditorBtnEl.textContent = state.editorVisible ? 'Hide' : 'Edit'
  // The scene's ResizeObserver on #stage picks up the grid re-layout and
  // rescales the canvas on its own — no explicit renderer notification needed.
}
function toggleEditor() {
  state.editorVisible = !state.editorVisible
  applyEditorVisibility()
  persist()
  if (state.editorVisible) editor.focus()
}
toggleEditorBtnEl?.addEventListener('click', toggleEditor)
applyEditorVisibility()

if (fileNameEl) fileNameEl.textContent = descriptorName(state.lastPattern) || 'untitled'

// ---------- Watcher (polls path/url descriptors for external edits) ----------
const watcher = createWatcher()
const autoReloadEl = document.getElementById('autoReload')
autoReloadEl.checked = state.options.autoReload !== false
watcher.setEnabled(autoReloadEl.checked)
autoReloadEl.addEventListener('change', () => {
  state.options.autoReload = autoReloadEl.checked
  watcher.setEnabled(autoReloadEl.checked)
  persist()
})

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
  if (!err) {
    errorsEl.textContent = ''
    editor?.setRuntimeDiagnostic(null)
    return
  }
  const msg = err instanceof Error
    ? (err.stack && err.stack.includes(err.message) ? err.stack : `${err.message}\n${err.stack || ''}`)
    : String(err)
  errorsEl.textContent = msg
  console.error(err)
  editor?.setRuntimeDiagnostic(extractErrorLocation(err))
}

// Parse a runtime error's stack and locate it in the user's source.
// The VM runs patterns inside a synthesized function wrapper, so stack-reported
// line numbers are offset by PATTERN_LINE_OFFSET from the editor's line 1.
function extractErrorLocation(err) {
  if (!err || !err.stack) return null
  const m = err.stack.match(/<anonymous>:(\d+):(\d+)/)
            || err.stack.match(/eval:(\d+):(\d+)/)
            || err.stack.match(/Function:(\d+):(\d+)/)
  if (!m) return null
  const line = parseInt(m[1], 10) - PATTERN_LINE_OFFSET
  const col = parseInt(m[2], 10)
  if (!Number.isFinite(line) || line < 1) return null
  return { line, col, severity: 'error', message: err.message || String(err) }
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
  const text = await r.text()
  const ct = r.headers.get('content-type') || ''
  if (ct.includes('text/html') || /^\s*<!doctype html/i.test(text)) {
    throw new Error(`fetch ${url} — got HTML (likely dev-server SPA fallback for a missing file). Check the path.`)
  }
  return text
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
createBrowser({
  container: document.getElementById('patternBrowser'),
  kind: 'pattern',
  filter: (name) => /\.(js|epe)$/i.test(name),
  emptyMessage: 'No .js or .epe files here.',
  onPick: async (url, { name, root, relPath }) => {
    try { loadPattern(await fetchText(url), { kind: 'path', value: url, name, root, relPath }) }
    catch (err) { showError(err) }
  }
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
createBrowser({
  container: document.getElementById('mapBrowser'),
  kind: 'map',
  filter: (name) => /\.(csv|json|js)$/i.test(name),
  emptyMessage: 'No .csv / .json / .js files here.',
  onPick: async (url, { name, root, relPath }) => {
    try { loadMap(await fetchText(url), { kind: 'path', value: url, name, root, relPath }) }
    catch (err) { showError(err) }
  }
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
  state.preparedMap = null
  persist(); rebuildIfReady()
})
document.getElementById('forceDim').addEventListener('change', (e) => {
  const v = e.target.value
  state.options.forceDim = v === 'auto' ? undefined : parseInt(v, 10)
  state.preparedMap = null
  rebuildIfReady()
})
document.getElementById('swapYZ').addEventListener('change', (e) => {
  state.options.swapYZ = e.target.checked
  state.preparedMap = null
  persist(); rebuildIfReady()
})
document.getElementById('fixedPoint').addEventListener('change', (e) => {
  state.options.fixedPoint = e.target.value
  // VM-only option — the prepared map is unaffected, so a pattern-only rebuild suffices.
  persist(); rebuildIfReady({ patternOnly: true })
})
document.getElementById('outputMethod').addEventListener('change', (e) => {
  state.options.outputMethod = e.target.value
  persist(); updateFpsHud(true)
})
document.getElementById('simHwFps').addEventListener('change', (e) => {
  state.options.simHwFps = e.target.checked
  hwAccumMs = 0
  persist(); updateFpsHud(true)
})

// ---------- Device link (push-to-Pixelblaze) ----------
const deviceIpEl = document.getElementById('deviceIp')
const deviceDotEl = document.getElementById('deviceDot')
const deviceConnectBtn = document.getElementById('deviceConnect')
const deviceUploadBtn = document.getElementById('deviceUpload')
const deviceCopyBtn = document.getElementById('deviceCopy')
deviceIpEl.value = state.options.deviceIp || ''
let device = null

function deviceStatusChanged(s) {
  deviceDotEl.className = s === 'open' ? 'open' : s === 'connecting' ? 'connecting' : s === 'error' ? 'error' : ''
  deviceUploadBtn.disabled = s !== 'open'
  deviceConnectBtn.textContent = (s === 'open' || s === 'connecting') ? 'Disconnect' : 'Connect'
}

deviceConnectBtn.addEventListener('click', () => {
  if (device && (device.status === 'open' || device.status === 'connecting')) {
    device.close(); device = null
    return
  }
  const ip = deviceIpEl.value.trim()
  if (!ip) { showError(new Error('Enter the Pixelblaze IP first')); return }
  state.options.deviceIp = ip
  persist()
  device = openDevice(ip, { onStatus: deviceStatusChanged })
  // Console escape hatch for the protocol spike (see device.js header note).
  window.__pbDevice = device
})

deviceUploadBtn.addEventListener('click', () => {
  if (!device || device.status !== 'open') return
  const src = editor.getDoc()
  if (!src) { showError(new Error('Nothing to upload — editor is empty')); return }
  const name = (state.lastPattern?.name || 'pb_emu_pattern').replace(/\.js$/i, '')
  try {
    device.uploadSource(name, src)
    console.info(`Uploaded "${name}" (${src.length} bytes) via putSourceCode — verify the device picked it up (experimental path).`)
  } catch (err) {
    showError(err)
  }
})

// Zero-risk interim: copy the buffer and open the device's own editor.
deviceCopyBtn.addEventListener('click', async () => {
  const src = editor.getDoc()
  if (!src) { showError(new Error('Nothing to copy — editor is empty')); return }
  try { await navigator.clipboard.writeText(src) } catch {}
  const ip = deviceIpEl.value.trim() || state.options.deviceIp
  if (ip) window.open(`http://${ip}/`, '_blank')
})
function updateBloomSlidersVisible() {
  const vis = !!state.options.bloom
  document.getElementById('bloomStrengthLbl').classList.toggle('hidden', !vis)
  document.getElementById('bloomRadiusLbl').classList.toggle('hidden', !vis)
}
document.getElementById('bloomToggle').addEventListener('change', (e) => {
  state.options.bloom = e.target.checked
  sceneCtx.setBloomEnabled(state.options.bloom)
  updateBloomSlidersVisible()
  persist()
  markDirty()
})
updateBloomSlidersVisible()

// View preset buttons
document.querySelectorAll('#viewPresets button').forEach(btn => {
  btn.addEventListener('click', () => { sceneCtx.setView(btn.dataset.view); markDirty() })
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
  markDirty()
})
bloomStrengthInput.addEventListener('input', () => {
  const v = parseFloat(bloomStrengthInput.value)
  state.options.bloomStrength = v
  sceneCtx.setBloom({ strength: v })
  persist()
  markDirty()
})
bloomRadiusInput.addEventListener('input', () => {
  const v = parseFloat(bloomRadiusInput.value)
  state.options.bloomRadius = v
  sceneCtx.setBloom({ radius: v })
  persist()
  markDirty()
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
  if (e.key === 'e' || e.key === 'E') { toggleEditor(); return }
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
// Option sliders (ledSize, bloomStrength, bloomRadius, speed) fire input events
// at frame rate during drag; a sync localStorage.setItem on each one blocks the
// main thread. Coalesce to one write per idle window, flush on hide/unload.
let persistTimer = null
const PERSIST_DELAY_MS = 250
function persist() {
  if (persistTimer) return
  persistTimer = setTimeout(flushPersist, PERSIST_DELAY_MS)
}
function flushPersist() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
  try {
    localStorage.setItem('pb_emu.v1', JSON.stringify({
      mapText: document.getElementById('mapPaste').value,
      lastPattern: state.lastPattern,
      lastMap: state.lastMap,
      options: state.options
    }))
  } catch {}
}
window.addEventListener('pagehide', flushPersist)
window.addEventListener('beforeunload', flushPersist)

// ---------- Load flow ----------
// `fromEditor` distinguishes in-browser typing (no Recents, no editor.setDoc,
// mark dirty, pause watcher) from external loads (push Recents, sync buffer,
// clear dirty, re-watch).
function loadPattern(text, descriptor, { previousValues, fromEditor = false } = {}) {
  showError(null)
  // Auto-unwrap EPE: the file dialog may pass in a raw .epe JSON, drag-drop
  // can too, and even the URL/Path fetchers can hit ".epe" endpoints.
  const { source, name } = unwrapPatternText(text, descriptor?.name)
  state.patternSource = source
  if (descriptor) {
    const d = name && !descriptor.name ? { ...descriptor, name } : descriptor
    state.lastPattern = d
    if (fromEditor) {
      // User is typing. Don't pollute Recents with every keystroke, don't
      // re-push into the editor (infinite loop), drop the pattern watch so
      // a poll of the on-disk copy doesn't clobber in-flight edits, and
      // (if writable) schedule an autosave so the file on disk tracks the
      // editor buffer — matches how the Pixelblaze web IDE behaves.
      state.dirty = true
      watcher.stop('pattern')
      scheduleAutosave()
    } else {
      state.dirty = false
      clearTimeout(autosaveTimer)
      // Ephemeral 'editor' kind exists only when the user starts typing into
      // a blank buffer with no prior pattern — no Recents entry / no watch.
      if (d.kind !== 'editor') {
        pushRecent('pattern', d)
        watcher.watch('pattern', d, onExternalPatternChange)
      } else {
        watcher.stop('pattern')
      }
      // Sync editor buffer only on external loads (avoid self-feedback loop).
      editor?.setDoc(source)
    }
  }
  updateFileNameLabel()
  updateReloadButton()
  showLintFindings(lintPattern(source))
  persist()
  rebuildIfReady({ previousValues, patternOnly: true })
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
  // Editor-side: findings with positions become inline squiggles.
  const diags = findings
    .filter(f => Number.isFinite(f?.line))
    .map(f => ({ line: f.line, col: f.col, endLine: f.endLine, endCol: f.endCol, severity: f.severity, message: f.message }))
  editor?.setLintDiagnostics(diags)
  // DOM panel: full list, severity-tagged, collapsible.
  const el = document.getElementById('warnings')
  if (!el) return
  el.replaceChildren()
  if (!findings.length) { el.classList.add('hidden'); return }
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'warn-close'
  close.textContent = '×'
  close.title = 'Dismiss'
  close.addEventListener('click', () => el.classList.add('hidden'))
  el.appendChild(close)
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
  state.preparedMap = null  // map changed → force re-prepare
  state.needsFit = true
  if (descriptor) {
    state.lastMap = descriptor
    pushRecent('map', descriptor)
    if (descriptor.kind === 'path' || descriptor.kind === 'url') {
      watcher.watch('map', descriptor, (fresh) => loadMap(fresh, descriptor))
    } else {
      watcher.stop('map')
    }
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

function rebuildIfReady({ previousValues, patternOnly = false } = {}) {
  if (!state.patternSource || !state.mapParsed) return
  try { rebuild({ previousValues, patternOnly }) } catch (err) { showError(err) }
}

function rebuild({ previousValues, patternOnly = false } = {}) {
  // Pattern-only edits (editor keystrokes, pattern reloads) can reuse the
  // prepared map + pixel cloud + rgb buffer. Map / option changes rerun the
  // full path. First-ever build always runs full path because preparedMap is null.
  let prepared = state.preparedMap
  if (!patternOnly || !prepared) {
    prepared = prepareMap(state.mapParsed, state.options)
    const { pixelCount, coords } = prepared

    if (state.pixelCloud) state.pixelCloud.dispose()
    state.pixelCloud = createPixelCloud(sceneCtx.scene, {
      coords,
      pixelCount,
      // Pixelblaze 2D maps are Y-down (3D maps are Y-up) — always mirror the
      // DISPLAY of 2D maps so the preview matches exactly what the hardware
      // renders on a physically mounted matrix. Pattern coords are untouched
      // (hardware doesn't flip them either), so this is not optional.
      flipY: prepared.dim === 2
    })

    // Auto-fit only when the map changes — pattern-only reloads keep the camera.
    if (state.needsFit) {
      sceneCtx.fitTo([0, 0, 0], Math.sqrt(3))
      state.needsFit = false
    }

    state.rgb = new Float32Array(pixelCount * 3)
    state.preparedMap = prepared
  }
  const { pixelCount, dim } = prepared

  // Build VM (pattern source or map dim may have changed)
  state.vm = createVM({
    source: state.patternSource,
    pixelCount,
    mapDim: dim,
    mapCoords: prepared.normalized,
    fixedPoint: state.options.fixedPoint ?? 'auto'
  })
  state.vm.ctx.speed = state.options.speed ?? 1
  const info = selectRenderFnInfo(dim, state.vm.classified)
  state.chosenRender = info.fn
  state.chosenRenderRaw = info.raw
  state.chosenRenderKind = info.kind

  // Build the control panel — this replaces applyControlDefaults' single
  // default invocation with live widgets, each setting its own initial value.
  const controlsEl = document.getElementById('controls')
  buildControlPanel(controlsEl, state.vm.classified.controls, state.patternSource, previousValues)

  if (renderIndicatorEl) renderIndicatorEl.textContent = info.picked
  countsEl.textContent = `${pixelCount} LEDs · ${dim}D (${prepared.source ?? 'map'}) · ${info.picked}`
  // Feed the HW-FPS estimate: count expensive per-pixel ops in the render fn
  // the dispatch cascade actually picked (picked is e.g. "render2D (z dropped)").
  expensiveOpCount = countExpensiveRenderOps(state.patternSource, info.picked.split(' ')[0])
  updateFpsHud(true)
  showError(null)

  // A previous pattern may have errored out and forced state.running=false.
  // A fresh VM earns a fresh chance — re-arm the render loop.
  state.running = true
  playPauseBtn.textContent = 'Pause'
  markDirty()
}

// ---------- FPS / hardware-estimate HUD ----------
// Constants are official ElectroMage / forum numbers, not measurements of this
// machine. Sources:
//   - compute ~48k px/s avg V3 pattern eval (product page; confirmed in
//     https://forum.electromage.com/t/what-is-the-fastest-output-fps-possible-for-3600-pixels-on-pb-non-micro/4574)
//   - WS2812 direct: 800 kbps / 24 bits ≈ 33k px/s + ~300 µs reset latch (same thread)
//   - Output Expander: 66k px/s total per 2 Mbps serial bus, channels clock out
//     in parallel (https://www.bhencke.com/serial-ws2812-driver) — the per-bus
//     ceiling doesn't rise with more channels, but it sits above the compute
//     ceiling, so expander rigs are compute-bound rather than output-bound.
//   - APA102 direct: SPI to 20 MHz — effectively compute-bound at any count.
// EXPENSIVE_OP_PENALTY is a rough calibration factor (est., not measured):
// each expensive per-pixel call site (perlin/atan2/sin/...) shaves the compute
// budget. FPS = 1 / max(computeTime, outputTime) — the optimistic-overlap
// model, which matches wizard's published 3600-px measurements within
// pattern-cost variance.
const HW_EST = {
  COMPUTE_PX_PER_SEC: 48000,
  EXPENSIVE_OP_PENALTY: 0.15,
  OUTPUT: {
    ws2812:   { rate: 33000,    resetSec: 0.0003, label: 'WS2812' },
    expander: { rate: 66000,    resetSec: 0,      label: 'Expander' },
    apa102:   { rate: Infinity, resetSec: 0,      label: 'APA102' }
  },
  MAX_DISPLAY_FPS: 120
}

const fpsEl = document.getElementById('fps')
let expensiveOpCount = 0        // recomputed on pattern load in rebuild()
let emuFpsEma = 0               // exponential moving average ≈ rolling 30 frames
let patternMsEma = 0
let lastFpsHudUpdate = 0
let hwAccumMs = 0               // elapsed-time accumulator for Sim HW FPS mode

function estimateHardwareFps() {
  const pc = state.preparedMap?.pixelCount
  if (!pc) return null
  const out = HW_EST.OUTPUT[state.options.outputMethod] || HW_EST.OUTPUT.ws2812
  const computeRate = HW_EST.COMPUTE_PX_PER_SEC / (1 + HW_EST.EXPENSIVE_OP_PENALTY * expensiveOpCount)
  const tCompute = pc / computeRate
  const tOutput = out.rate === Infinity ? 0 : pc / out.rate + out.resetSec
  return Math.min(1 / Math.max(tCompute, tOutput), HW_EST.MAX_DISPLAY_FPS)
}

function updateFpsHud(force = false) {
  const now = performance.now()
  if (!force && now - lastFpsHudUpdate < 500) return
  lastFpsHudUpdate = now
  if (!fpsEl) return
  const out = HW_EST.OUTPUT[state.options.outputMethod] || HW_EST.OUTPUT.ws2812
  const hw = estimateHardwareFps()
  const sim = state.options.simHwFps ? ' · SIM' : ''
  const emu = emuFpsEma > 0 ? `${Math.round(emuFpsEma)} FPS · ${patternMsEma.toFixed(1)}ms eval` : '—'
  fpsEl.textContent = hw
    ? `${emu} · est HW ~${hw >= 10 ? Math.round(hw) : hw.toFixed(1)} FPS (${out.label})${sim}`
    : emu
}

// ---------- Render loop ----------
function runOnePatternFrame(realDeltaMs) {
  if (!state.vm || !state.chosenRenderRaw) return
  try {
    const { nx, ny, nz } = state.preparedMap.normalized
    const pc = state.preparedMap.pixelCount
    const rgb = state.rgb
    const vm = state.vm
    const fn = state.chosenRenderRaw
    const kind = state.chosenRenderKind
    const reset = vm.resetPixel
    const read = vm.readPixel

    vm.beforeRender(realDeltaMs)
    // Branch once on dispatch kind to keep per-pixel call sites monomorphic.
    switch (kind) {
      case '3d':
        for (let i = 0; i < pc; i++) { reset(); fn(i, nx[i], ny[i], nz[i]); read(rgb, i) }
        break
      case '2d':
        for (let i = 0; i < pc; i++) { reset(); fn(i, nx[i], ny[i]); read(rgb, i) }
        break
      case '2d-as-3d':
        for (let i = 0; i < pc; i++) { reset(); fn(i, nx[i], ny[i], 0.5); read(rgb, i) }
        break
      case '1d-as-2d':
        for (let i = 0; i < pc; i++) { reset(); fn(i, i / pc, 0.5); read(rgb, i) }
        break
      case '1d-as-3d':
        for (let i = 0; i < pc; i++) { reset(); fn(i, i / pc, 0.5, 0.5); read(rgb, i) }
        break
      case 'index':
      default:
        for (let i = 0; i < pc; i++) { reset(); fn(i); read(rgb, i) }
    }
    state.pixelCloud.setColors(rgb)
  } catch (err) {
    showError(err)
    state.running = false
    playPauseBtn.textContent = 'Play'
  }
}

let lastFrameWall = performance.now()
let sceneDirty = true
function markDirty() { sceneDirty = true }
// Anything a user can poke that affects the rendered frame feeds into this flag.
sceneCtx.controls.addEventListener('change', markDirty)
window.addEventListener('resize', markDirty)

function frame() {
  requestAnimationFrame(frame)

  const wall = performance.now()
  const realDelta = wall - lastFrameWall
  lastFrameWall = wall

  if (state.running) {
    // Sim HW FPS: only step the pattern when the estimated hardware frame
    // interval has elapsed, passing the hardware-sized delta to beforeRender —
    // per-frame-budgeted patterns (opsPerCycle/drawsPerFrame) then progress at
    // true-to-hardware speed. The display simply holds the last frame between
    // steps. Delta-based animations are unaffected in rate, only in smoothness.
    let stepDelta = realDelta
    let doStep = true
    if (state.options.simHwFps) {
      hwAccumMs += realDelta
      const hwFps = estimateHardwareFps()
      const interval = hwFps ? 1000 / hwFps : 0
      if (hwAccumMs >= interval) { stepDelta = hwAccumMs; hwAccumMs = 0 }
      else doStep = false
    }
    if (doStep) {
      const t0 = performance.now()
      runOnePatternFrame(stepDelta)
      const evalMs = performance.now() - t0
      // EMA with α≈1/30 ≈ a rolling 30-frame window. In sim mode stepDelta is
      // the hardware interval, so the FPS readout shows the simulated rate.
      patternMsEma += (evalMs - patternMsEma) / 30
      if (stepDelta > 0) emuFpsEma += (1000 / stepDelta - emuFpsEma) / 30
      sceneDirty = true
    }
    updateFpsHud()
  }
  if (sceneDirty) {
    paletteStrip.draw()
    sceneCtx.render()
    sceneDirty = false
  }
}
requestAnimationFrame(frame)

// Try to auto-rebuild if both were restored from localStorage.
// (Not really — mapParsed isn't serialized. Pattern alone will wait for map.)
