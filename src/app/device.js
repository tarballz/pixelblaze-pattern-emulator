// Pixelblaze device link over the websocket API (ws://<ip>:81).
//
// Protocol reference: https://electromage.com/docs/websockets-api/ and the
// constants in zranger1/pixelblaze-client (pixelblaze/pixelblaze.py).
// Plain ws:// from an http:// origin is fine — mixed-content blocking only
// applies under https, which the dev server doesn't use. If this app is ever
// served over https, route through a dev-server ws proxy instead.
//
// ⚠ VERIFICATION NOTE (the "spike"): the stock Pixelblaze editor compiles
// patterns to bytecode IN THE BROWSER and uploads source + bytecode together.
// Whether pushing source alone (binary putSourceCode frames) makes current
// firmware compile-and-run it has to be confirmed against a real device —
// use the console: `window.__pbDevice.uploadSource('test', src)` and watch
// the device. Until confirmed, Upload is labeled experimental in the UI.
// getVars/setVars/ping/getConfig are long-established and safe.

// All protocol constants in one table — firmware drift lands here, not
// scattered through the code.
export const PROTO = {
  PORT: 81,
  // Binary frame type bytes (frame[0])
  TYPE_PUT_SOURCE: 1,
  TYPE_PUT_BYTECODE: 3,
  TYPE_PREVIEW_IMAGE: 4,
  TYPE_PREVIEW_FRAME: 5,
  TYPE_GET_SOURCE: 6,
  TYPE_GET_PROGRAM_LIST: 7,
  TYPE_PUT_PIXEL_MAP: 8,
  // Frame flag bits (frame[1])
  FRAME_FIRST: 0x01,
  FRAME_MIDDLE: 0x02,
  FRAME_LAST: 0x04,
  // Max payload bytes per source/bytecode frame
  CHUNK: 1280,
  PING_INTERVAL_MS: 3000,
  RECONNECT_BASE_MS: 1000,
  RECONNECT_MAX_MS: 15000
}

// Split a payload into protocol frames: [type, flags, ...payload], payload
// ≤ CHUNK bytes each, flags marking first/middle/last so the device can
// reassemble. Pure — exported for tests.
export function frameChunks(type, bytes) {
  const frames = []
  const total = bytes.length
  for (let off = 0; off < total || off === 0; off += PROTO.CHUNK) {
    const end = Math.min(off + PROTO.CHUNK, total)
    const chunk = bytes.subarray(off, end)
    let flags = 0
    if (off === 0) flags |= PROTO.FRAME_FIRST
    if (end >= total) flags |= PROTO.FRAME_LAST
    if (!(flags & (PROTO.FRAME_FIRST | PROTO.FRAME_LAST))) flags |= PROTO.FRAME_MIDDLE
    const frame = new Uint8Array(2 + chunk.length)
    frame[0] = type
    frame[1] = flags
    frame.set(chunk, 2)
    frames.push(frame)
    if (end >= total) break
  }
  return frames
}

// connectDevice(ip, { onStatus, onVars }) → handle.
// onStatus fires with 'connecting' | 'open' | 'closed' | 'error'.
export function connectDevice(ip, { onStatus = () => {}, onVars = () => {} } = {}) {
  let ws = null
  let closedByUser = false
  let reconnectDelay = PROTO.RECONNECT_BASE_MS
  let pingTimer = null
  let status = 'connecting'

  function setStatus(s) { status = s; onStatus(s) }

  function open() {
    setStatus('connecting')
    try {
      ws = new WebSocket(`ws://${ip}:${PROTO.PORT}`)
    } catch (err) {
      setStatus('error')
      return
    }
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      reconnectDelay = PROTO.RECONNECT_BASE_MS
      setStatus('open')
      // Keepalive — the device drops idle sockets.
      pingTimer = setInterval(() => send({ ping: true }), PROTO.PING_INTERVAL_MS)
    }
    ws.onclose = () => {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
      setStatus('closed')
      if (!closedByUser) {
        setTimeout(open, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, PROTO.RECONNECT_MAX_MS)
      }
    }
    ws.onerror = () => setStatus('error')
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.vars) onVars(msg.vars)
        } catch { /* non-JSON text frame — ignore */ }
      }
      // Binary frames (previewFrame etc.) intentionally ignored for now.
    }
  }

  function send(obj) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }

  function sendBinary(type, bytes) {
    if (ws?.readyState !== WebSocket.OPEN) throw new Error('device not connected')
    for (const frame of frameChunks(type, bytes)) ws.send(frame.buffer)
  }

  return {
    get status() { return status },

    // Push pattern source to the device (EXPERIMENTAL — see header note).
    // The editor's own save path wraps source in the same JSON shape the .epe
    // format uses before framing it as putSourceCode.
    uploadSource(name, sourceText) {
      const body = JSON.stringify({ name, sources: { main: sourceText } })
      sendBinary(PROTO.TYPE_PUT_SOURCE, new TextEncoder().encode(body))
    },

    getConfig() { send({ getConfig: true }) },
    getVars() { send({ getVars: true }) },
    setVars(vars) { send({ setVars: vars }) },
    setBrightness(v) { send({ brightness: Math.max(0, Math.min(1, v)) }) },

    close() {
      closedByUser = true
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
      try { ws?.close() } catch {}
      setStatus('closed')
    },

    _open: open
  }
}

// Convenience: start connecting immediately.
export function openDevice(ip, hooks) {
  const d = connectDevice(ip, hooks)
  d._open()
  return d
}
