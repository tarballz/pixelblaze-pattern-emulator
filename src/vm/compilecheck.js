// Client-side wrapper around the real-compiler Worker (compilerWorker.js).
// Degrades silently to `{ available: false }` when no compiler has ever been
// cached locally (nothing has ever talked to real hardware) — same UI as
// before this feature existed.

let worker = null
let readyPromise = null
let version = null
let nextId = 1
const pending = new Map()

async function ensureWorker() {
  if (readyPromise) return readyPromise
  readyPromise = (async () => {
    const res = await fetch('/__pb_emu__/compiler')
    if (!res.ok) return false // expected/common: nothing cached yet, stay silent
    const { version: v, source } = await res.json()
    version = v
    worker = new Worker(new URL('./compilerWorker.js', import.meta.url), { type: 'module' })
    // A Worker failing to even load its script (bad MIME type, module
    // resolution error, syntax error) fires `error`, not a catchable
    // exception here — without this handler the init promise below would
    // hang forever with nothing in the console.
    const initId = nextId++
    const initResult = await new Promise((resolve, reject) => {
      pending.set(initId, resolve)
      worker.onerror = (event) => {
        pending.delete(initId)
        reject(new Error(`compiler worker failed to load: ${event.message || event}`))
      }
      worker.onmessage = (event) => {
        const { id, ...rest } = event.data
        const resolve = pending.get(id)
        if (!resolve) return
        pending.delete(id)
        resolve(rest)
      }
      worker.postMessage({ id: initId, compilerSrc: source })
    })
    if (initResult.error) throw new Error(`compiler failed to initialize: ${initResult.error}`)
    return !!initResult.ready
  })().catch((err) => {
    console.warn('[pb_emu] real-compiler check unavailable:', err)
    return false
  })
  return readyPromise
}

// Called once at startup so the fetch/Worker spin-up happens off the
// critical path of the first pattern load rather than blocking on it.
export function initCompilerCheck() {
  ensureWorker()
}

// Resolves `{ available: false }` if no compiler is cached, otherwise
// `{ available: true, status, version }`. `status` is `"OK"` on success or
// the real compiler's error text (format: "<desc> at line N column M") on
// failure — never throws.
export async function checkCompile(source) {
  const ready = await ensureWorker()
  if (!ready || !worker) return { available: false }
  const id = nextId++
  const result = await new Promise((resolve) => {
    pending.set(id, resolve)
    worker.postMessage({ id, source })
  })
  return { available: true, status: result.status, version }
}
