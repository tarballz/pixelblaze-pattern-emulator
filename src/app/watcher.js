// Poll-based watcher for path/url descriptors. Browsers can't re-read a File
// object after it's picked/dropped, so only remote-fetchable descriptors are
// watchable; others are silently ignored.
//
// Each key (e.g. 'pattern' or 'map') tracks one active watch at a time. Calling
// watch(key, ...) replaces any prior watch for that key.

import { hashSource } from './controls.js'

export function createWatcher({ intervalMs = 700, fetchImpl } = {}) {
  const fetch_ = fetchImpl || ((...a) => globalThis.fetch(...a))
  const active = new Map() // key → { descriptor, onChange, lastHash, timer, abort }
  let enabled = true

  function isWatchable(descriptor) {
    return descriptor && (descriptor.kind === 'path' || descriptor.kind === 'url')
  }

  async function tick(entry) {
    if (!enabled) return
    entry.abort?.abort()
    const abort = new AbortController()
    entry.abort = abort
    try {
      const r = await fetch_(entry.descriptor.value, { cache: 'no-store', signal: abort.signal })
      if (!r.ok) return
      const text = await r.text()
      const h = hashSource(text)
      if (entry.lastHash === null) {
        entry.lastHash = h    // baseline — don't fire on first tick
      } else if (h !== entry.lastHash) {
        entry.lastHash = h
        try { entry.onChange(text) } catch {}
      }
    } catch {
      // Transient errors (atomic-save 404, network hiccup) — retry next tick.
    }
  }

  function start(entry) {
    stopTimer(entry)
    entry.timer = setInterval(() => tick(entry), intervalMs)
    tick(entry)  // prime immediately
  }

  function stopTimer(entry) {
    if (entry.timer) { clearInterval(entry.timer); entry.timer = null }
    entry.abort?.abort()
    entry.abort = null
  }

  return {
    watch(key, descriptor, onChange) {
      stop(key)
      if (!isWatchable(descriptor)) return
      const entry = { descriptor, onChange, lastHash: null, timer: null, abort: null }
      active.set(key, entry)
      if (enabled) start(entry)
    },
    stop,
    stopAll() { for (const k of [...active.keys()]) stop(k) },
    setEnabled(on) {
      enabled = !!on
      for (const entry of active.values()) {
        if (enabled) start(entry)
        else stopTimer(entry)
      }
    },
    pause() { this.setEnabled(false) },
    resume() { this.setEnabled(true) },
    // Update the baseline hash for a watched key without re-fetching. Used
    // after we've written the file ourselves — the poller would otherwise
    // see our own writeback as a "change" and fire onChange spuriously.
    rebaseline(key, source) {
      const entry = active.get(key)
      if (!entry) return
      entry.lastHash = hashSource(source)
    },
    isWatchable,
    get active() { return active }
  }

  function stop(key) {
    const entry = active.get(key)
    if (!entry) return
    stopTimer(entry)
    active.delete(key)
  }
}
