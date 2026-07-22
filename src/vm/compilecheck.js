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
    if (!res.ok) return false
    const { version: v, source } = await res.json()
    version = v
    worker = new Worker(new URL('./compilerWorker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      const { id, ...rest } = event.data
      const resolve = pending.get(id)
      if (!resolve) return
      pending.delete(id)
      resolve(rest)
    }
    const initId = nextId++
    const initResult = await new Promise((resolve) => {
      pending.set(initId, resolve)
      worker.postMessage({ id: initId, compilerSrc: source })
    })
    return !!initResult.ready
  })().catch(() => false)
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
