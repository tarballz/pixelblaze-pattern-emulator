// Build a DOM control panel from a pattern's exported UI controls. Today the
// VM auto-invokes them once via applyControlDefaults() — this replaces that
// once the panel is mounted by calling each widget's initial value.
//
// Per-pattern values persist in localStorage keyed by a hash of the pattern
// source, so reloading a familiar pattern restores knob positions.

const STORE_KEY = 'pb_emu.controls.v1'

// Tracks the live value of every widget in a container so the host can
// hand them back as `previousValues` on the next editor-driven rebuild.
// The hash-keyed localStorage below is per-source; this one is per-container
// so in-editor typing doesn't snap knobs back to 0.5 on every reload.
const liveValues = new WeakMap()

// 32-bit FNV-1a — good enough to key localStorage entries.
export function hashSource(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') } catch { return {} }
}

// Debounced write: slider drags fire `input` at frame rate, and a synchronous
// JSON.stringify + localStorage.setItem on every tick blocks the main thread
// (noticeably on large stores). Coalesce to one write per idle window; flush
// on tab hide / unload so nothing is lost.
let pendingStore = null
let storeWriteTimer = null
const STORE_WRITE_DELAY_MS = 250
function saveStore(store) {
  pendingStore = store
  if (storeWriteTimer) return
  storeWriteTimer = setTimeout(flushStore, STORE_WRITE_DELAY_MS)
}
function flushStore() {
  if (storeWriteTimer) { clearTimeout(storeWriteTimer); storeWriteTimer = null }
  if (pendingStore === null) return
  try { localStorage.setItem(STORE_KEY, JSON.stringify(pendingStore)) } catch {}
  pendingStore = null
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushStore)
  window.addEventListener('beforeunload', flushStore)
}

// Build a panel inside `container` for every control in `controls` (from
// classifyExports). `source` is used to derive a persistence key.
// If `previousValues` is provided, it takes precedence over the hash-keyed
// store — used for editor-driven rebuilds so sliders stay put across edits.
// Returns a disposer that clears the panel.
export function buildControlPanel(container, controls, source, previousValues = null) {
  container.replaceChildren()
  const live = {}
  liveValues.set(container, live)
  if (!controls.length) { container.classList.add('hidden'); return () => {} }
  container.classList.remove('hidden')

  const key = hashSource(source)
  const store = loadStore()
  const saved = store[key] || {}
  const nextSaved = { ...saved }

  function persist(name, value) {
    nextSaved[name] = value
    store[key] = nextSaved
    saveStore(store)
  }

  for (const c of controls) {
    const row = document.createElement('div')
    row.className = 'ctl-row'

    const label = document.createElement('label')
    label.textContent = humanize(c.label || c.name)
    row.appendChild(label)

    const prev = previousValues && Object.prototype.hasOwnProperty.call(previousValues, c.name)
      ? previousValues[c.name]
      : undefined
    const initial = prev !== undefined ? prev : saved[c.name]
    const widget = makeWidget(c, initial, (value) => {
      live[c.name] = value
      persist(c.name, value)
    })
    row.appendChild(widget)
    container.appendChild(row)
    // Seed live with whatever the widget adopted (either `initial` or its default).
    live[c.name] = initial !== undefined ? initial : defaultFor(c)
  }

  return () => { container.replaceChildren(); liveValues.delete(container) }
}

// Read the current {name: value} map from widgets built by buildControlPanel.
// Returns an empty object if the container was never populated.
export function readCurrentValues(container) {
  const live = liveValues.get(container)
  return live ? { ...live } : {}
}

function defaultFor(c) {
  switch (c.kind) {
    case 'slider': return 0.5
    case 'toggle': return false
    case 'hsvPicker': return [0, 1, 1]
    case 'rgbPicker': return [1, 1, 1]
    case 'inputNumber': return 0
    default: return undefined
  }
}

function humanize(s) {
  // "Brightness" → "Brightness"; "HueOffset" → "Hue Offset"; "speedX" → "Speed X"
  return s.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function makeWidget(c, initial, persist) {
  switch (c.kind) {
    case 'slider':      return sliderWidget(c, initial, persist)
    case 'toggle':      return toggleWidget(c, initial, persist)
    case 'trigger':     return triggerWidget(c)
    case 'hsvPicker':   return hsvPickerWidget(c, initial, persist)
    case 'rgbPicker':   return rgbPickerWidget(c, initial, persist)
    case 'inputNumber': return inputNumberWidget(c, initial, persist)
    default:
      const span = document.createElement('span')
      span.textContent = `(unsupported: ${c.kind})`
      return span
  }
}

function sliderWidget(c, initial, persist) {
  const v = typeof initial === 'number' ? initial : 0.5
  const wrap = document.createElement('div'); wrap.className = 'ctl-slider'
  const input = document.createElement('input')
  input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.001'
  input.value = String(v)
  const out = document.createElement('span'); out.className = 'ctl-val'
  out.textContent = v.toFixed(2)
  input.addEventListener('input', () => {
    const val = parseFloat(input.value)
    out.textContent = val.toFixed(2)
    safeCall(c.fn, [val], c.name)
    persist(val)
  })
  safeCall(c.fn, [v], c.name)
  wrap.appendChild(input); wrap.appendChild(out)
  return wrap
}

function toggleWidget(c, initial, persist) {
  const v = initial ? 1 : 0
  const wrap = document.createElement('div'); wrap.className = 'ctl-toggle'
  const input = document.createElement('input')
  input.type = 'checkbox'; input.checked = !!v
  input.addEventListener('change', () => {
    const val = input.checked ? 1 : 0
    safeCall(c.fn, [val], c.name)
    persist(!!input.checked)
  })
  safeCall(c.fn, [v], c.name)
  wrap.appendChild(input)
  return wrap
}

function triggerWidget(c) {
  const btn = document.createElement('button')
  btn.className = 'ctl-trigger'
  btn.type = 'button'
  btn.textContent = 'Fire'
  btn.addEventListener('click', () => safeCall(c.fn, [], c.name))
  return btn
}

function hsvPickerWidget(c, initial, persist) {
  const [h, s, v] = Array.isArray(initial) && initial.length === 3 ? initial : [0, 1, 1]
  const wrap = document.createElement('div'); wrap.className = 'ctl-hsv'
  const state = { h, s, v }
  const swatch = document.createElement('div'); swatch.className = 'ctl-swatch'
  const syncSwatch = () => { swatch.style.background = hsvToCSS(state.h, state.s, state.v) }
  for (const ch of ['h', 's', 'v']) {
    const row = document.createElement('div'); row.className = 'ctl-hsv-row'
    const lbl = document.createElement('span'); lbl.textContent = ch.toUpperCase()
    const input = document.createElement('input')
    input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.001'
    input.value = String(state[ch])
    input.addEventListener('input', () => {
      state[ch] = parseFloat(input.value)
      syncSwatch()
      safeCall(c.fn, [state.h, state.s, state.v], c.name)
      persist([state.h, state.s, state.v])
    })
    row.appendChild(lbl); row.appendChild(input)
    wrap.appendChild(row)
  }
  syncSwatch()
  wrap.appendChild(swatch)
  safeCall(c.fn, [state.h, state.s, state.v], c.name)
  return wrap
}

function rgbPickerWidget(c, initial, persist) {
  const [r, g, b] = Array.isArray(initial) && initial.length === 3 ? initial : [1, 1, 1]
  const input = document.createElement('input')
  input.type = 'color'
  input.value = rgbToHex(r, g, b)
  input.addEventListener('input', () => {
    const [nr, ng, nb] = hexToRgb(input.value)
    safeCall(c.fn, [nr, ng, nb], c.name)
    persist([nr, ng, nb])
  })
  safeCall(c.fn, [r, g, b], c.name)
  return input
}

function inputNumberWidget(c, initial, persist) {
  const v = typeof initial === 'number' ? initial : 0
  const input = document.createElement('input')
  input.type = 'number'
  input.value = String(v)
  input.addEventListener('input', () => {
    const val = parseFloat(input.value)
    if (!Number.isFinite(val)) return
    safeCall(c.fn, [val], c.name)
    persist(val)
  })
  safeCall(c.fn, [v], c.name)
  return input
}

function safeCall(fn, args, name) {
  try { fn(...args) } catch (err) { console.warn(`control ${name} threw:`, err) }
}

// HSV→RGB for the swatch preview. Matches src/vm/currentPixel.js.
function hsvToCSS(h, s, v) {
  h = (h - Math.floor(h)) * 6
  const c = v * s, x = c * (1 - Math.abs((h % 2) - 1)), m = v - c
  let r, g, b
  if (h < 1)      { r = c; g = x; b = 0 }
  else if (h < 2) { r = x; g = c; b = 0 }
  else if (h < 3) { r = 0; g = c; b = x }
  else if (h < 4) { r = 0; g = x; b = c }
  else if (h < 5) { r = x; g = 0; b = c }
  else            { r = c; g = 0; b = x }
  return `rgb(${((r + m) * 255) | 0}, ${((g + m) * 255) | 0}, ${((b + m) * 255) | 0})`
}

function rgbToHex(r, g, b) {
  const to = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')
  return '#' + to(r) + to(g) + to(b)
}

function hexToRgb(hex) {
  const h = hex.replace(/^#/, '')
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  ]
}

// Exported for tests.
export const _internals = { hashSource, humanize, hsvToCSS, rgbToHex, hexToRgb }
