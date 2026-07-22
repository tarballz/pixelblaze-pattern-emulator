# UI State Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Page reload restores the active loader tabs, Path-browser folder locations, and the last-loaded pattern/map — spec: `docs/superpowers/specs/2026-07-22-ui-state-restore-design.md`.

**Architecture:** Extend the existing `pb_emu.v1` localStorage blob + `persist()` flow in `src/app/main.js`; give `createBrowser` an optional `initial` location and `onNavigate` callback so `browser.js` stays storage-agnostic; auto-reload last pattern/map through the existing `reloadPattern()`/`reloadMap()` with a new silent option.

**Tech Stack:** Vanilla JS (Vite app), vitest (+happy-dom for DOM tests).

## Global Constraints

- Every restore step independently try/caught; failure falls back silently to current blank behavior (spec: "a broken restore must never break the app").
- `file`-kind descriptors are never restored; editor visibility stays unrestored.
- No new localStorage keys — everything rides `pb_emu.v1`.
- Repo commit rule: no Co-Authored-By / Generated-with trailers.

---

### Task 1: `browser.js` — `initial` + `onNavigate`

**Files:**
- Modify: `src/app/browser.js` (signature line 11; `navigate()` ~line 44; `init()` ~line 130)
- Test: `test/browser.test.js` (create)

**Interfaces:**
- Produces: `createBrowser({ container, kind, onPick, filter, emptyMessage, initial, onNavigate })` — `initial: {root, path}|undefined` navigated to on mount when its root exists (else default behavior); `onNavigate({root, path})` called after every successful directory listing. Task 2 consumes both.

- [ ] **Step 1: Write the failing tests** (happy-dom + stubbed `fetch`, modeled on `test/watcher.test.js` fetch stubbing and `test/controls.dom.test.js` DOM setup):

```js
// @vitest-environment happy-dom
// Path-browser navigation callbacks + initial location restore.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBrowser } from '../src/app/browser.js'

function stubListEndpoint(tree) {
  // tree: { roots: [...], dirs: {'root|path': {dirs, files}} }
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = new URL(url, 'http://x')
    const root = u.searchParams.get('root')
    if (!root) return { ok: true, json: async () => ({ roots: tree.roots }) }
    const key = `${root}|${u.searchParams.get('path') || ''}`
    const node = tree.dirs[key]
    if (!node) return { ok: false, status: 404 }
    return { ok: true, json: async () => ({ dirs: node.dirs, files: node.files }) }
  }))
}

function mount() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return container
}

const TREE = {
  roots: ['samples', 'external'],
  dirs: {
    'external|': { dirs: ['egg'], files: [] },
    'external|egg': { dirs: [], files: ['a.js'] },
    'samples|': { dirs: [], files: ['rainbow.js'] },
  }
}

async function settle() { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)) }

describe('createBrowser navigation state', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('reports each successful navigation via onNavigate', async () => {
    stubListEndpoint(TREE)
    const seen = []
    createBrowser({ container: mount(), kind: 'pattern', onPick: () => {}, onNavigate: (loc) => seen.push(loc) })
    await settle()
    expect(seen).toEqual([{ root: 'external', path: '' }])   // default mount navigation
  })

  it('navigates to initial location on mount when valid', async () => {
    stubListEndpoint(TREE)
    const seen = []
    const container = mount()
    createBrowser({ container, kind: 'pattern', onPick: () => {}, initial: { root: 'external', path: 'egg' }, onNavigate: (loc) => seen.push(loc) })
    await settle()
    expect(seen).toEqual([{ root: 'external', path: 'egg' }])
    expect(container.querySelector('.pbb-root').value).toBe('external')
    expect([...container.querySelectorAll('.pbb-file')].map(b => b.textContent)).toContain('a.js')
  })

  it('falls back to default root when initial root is unknown', async () => {
    stubListEndpoint(TREE)
    const seen = []
    createBrowser({ container: mount(), kind: 'pattern', onPick: () => {}, initial: { root: 'gone', path: 'x' }, onNavigate: (loc) => seen.push(loc) })
    await settle()
    expect(seen).toEqual([{ root: 'external', path: '' }])
  })

  it('failed initial path listing shows error but still reports nothing (no onNavigate on failure)', async () => {
    stubListEndpoint(TREE)
    const seen = []
    createBrowser({ container: mount(), kind: 'pattern', onPick: () => {}, initial: { root: 'external', path: 'deleted-dir' }, onNavigate: (loc) => seen.push(loc) })
    await settle()
    expect(seen).toEqual([])   // 404 listing → no successful navigation reported
  })

  it('works with neither initial nor onNavigate (back-compat)', async () => {
    stubListEndpoint(TREE)
    expect(() => createBrowser({ container: mount(), kind: 'pattern', onPick: () => {} })).not.toThrow()
    await settle()
  })
})
```

- [ ] **Step 2: Run to verify failure**: `npx vitest run test/browser.test.js` — expect FAIL (onNavigate never called / initial ignored).

- [ ] **Step 3: Implement.** In `src/app/browser.js`:
  - Signature: `export function createBrowser({ container, kind, onPick, filter, emptyMessage = 'Empty', initial, onNavigate }) {`
  - In `navigate(root, path = '')`: move the `onNavigate` report to AFTER the successful `render(data)`:

```js
  async function navigate(root, path = '') {
    current = { root, path }
    renderCrumb()
    list.replaceChildren(msgRow('Loading…'))
    try {
      const data = await listDir(root, path)
      render(data)
      if (onNavigate) onNavigate({ root, path })
    } catch (err) {
      list.replaceChildren(msgRow(String(err.message || err), 'err'))
    }
  }
```

  - In `init()`, honor `initial` when its root exists:

```js
      if (roots.length) {
        let chosen = roots.includes('external') ? 'external' : roots[0]
        let startPath = ''
        if (initial && roots.includes(initial.root)) {
          chosen = initial.root
          startPath = initial.path || ''
        }
        rootSel.value = chosen
        navigate(chosen, startPath)
      } else {
```

- [ ] **Step 4: Run tests**: `npx vitest run test/browser.test.js` — expect 5 passed. Then full suite `npx vitest run` — everything green.

- [ ] **Step 5: Commit**: `git add src/app/browser.js test/browser.test.js && git commit -m "browser: support initial location and onNavigate callback"`

---

### Task 2: `main.js` — persist tabs + browser locations, restore on load

**Files:**
- Modify: `src/app/main.js` — state init (~line 54), tab-switch block (~line 361), the two `createBrowser` calls (~lines 414, 440), `flushPersist()` (~line 741), saved-state restore block (~line 88)

**Interfaces:**
- Consumes: Task 1's `initial`/`onNavigate`.
- Produces: `state.ui = { patternTab, mapTab, patternBrowser, mapBrowser }`; saved blob gains `ui`. Task 3 consumes `state.ui` being restored before its auto-reload runs.

- [ ] **Step 1: Add `ui` to state** (in the `let state = {` literal):

```js
  ui: {
    patternTab: null,        // 'file' | 'paste' | 'url' | 'path' — null = leave HTML default
    mapTab: null,            // + 'gen'
    patternBrowser: null,    // { root, path } | null
    mapBrowser: null,
  },
```

- [ ] **Step 2: Restore `ui` in the saved-state try/catch** (next to `if (saved.options) ...`):

```js
  if (saved.ui) Object.assign(state.ui, saved.ui)
```

- [ ] **Step 3: Record + restore tabs.** Replace the tab-switching block:

```js
// ---------- Tab switching ----------
document.querySelectorAll('.tabs').forEach(tabs => {
  const group = tabs.dataset.group
  tabs.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn))
      document.querySelectorAll(`[data-panel^="${group}-"]`).forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.panel !== `${group}-${btn.dataset.tab}`)
      })
      state.ui[`${group}Tab`] = btn.dataset.tab
      persist()
    })
  })
  // Restore the saved tab through the same code path so panels stay in sync.
  try {
    const saved = state.ui[`${group}Tab`]
    if (saved) tabs.querySelector(`button[data-tab="${saved}"]`)?.click()
  } catch {}
})
```

- [ ] **Step 4: Wire the two `createBrowser` calls.** Pattern browser call gains:

```js
  initial: state.ui.patternBrowser || undefined,
  onNavigate: (loc) => { state.ui.patternBrowser = loc; persist() },
```

Map browser call gains the same with `mapBrowser`.

- [ ] **Step 5: Persist `ui`** — add to the `flushPersist()` JSON: `ui: state.ui,`

- [ ] **Step 6: Verify**: `npx vitest run` green (no unit test for this glue — it's covered live in Task 4); `node --check src/app/main.js` passes.

- [ ] **Step 7: Commit**: `git add src/app/main.js && git commit -m "main: persist and restore loader tabs and browser locations"`

---

### Task 3: `main.js` — auto-reload last pattern/map on startup

**Files:**
- Modify: `src/app/main.js` — `reloadPattern()` (~line 828), `reloadMap()` (~line 843), saved-state restore block

**Interfaces:**
- Consumes: `state.lastPattern`/`state.lastMap` descriptors (already persisted today), `reloadPattern`/`reloadMap`.

- [ ] **Step 1: Add `{ silent }` to both reload functions** so startup failures don't flash errors (manual reload behavior unchanged):

```js
async function reloadPattern({ silent = false } = {}) {
  const d = state.lastPattern
  if (!d) return
  try {
    if (d.kind === 'path' || d.kind === 'url') {
      loadPattern(await fetchText(d.value), d)
    } else if (d.kind === 'paste') {
      loadPattern(d.value, d)
    } else {
      if (state.patternSource) loadPattern(state.patternSource, d)
    }
  } catch (err) { if (!silent) showError(err) }
}
```

Same shape for `reloadMap({ silent = false } = {})` (its `generated` branch stays).

- [ ] **Step 2: Restore descriptors + trigger reloads** in the saved-state restore block. The existing comment explains descriptors aren't restored because content isn't serialized — replace that comment and add (only re-fetchable kinds; `file` content is truly gone):

```js
  // Restore last pattern/map for re-fetchable kinds ('path'/'url' re-fetch,
  // 'paste'/'generated' carry their content in the descriptor). 'file' kinds
  // can't be re-read after reload and stay unrestored.
  const restorable = (d, kinds) => d && kinds.includes(d.kind) ? d : null
  state.lastPattern = restorable(saved.lastPattern, ['path', 'url', 'paste'])
  state.lastMap = restorable(saved.lastMap, ['path', 'url', 'paste', 'generated'])
```

Then AFTER the editor + browsers are mounted (bottom of startup, after the `createBrowser` calls — `loadPattern` pokes `editor.setDoc`), kick off:

```js
// ---------- Session restore ----------
if (state.lastMap) reloadMap({ silent: true })
if (state.lastPattern) reloadPattern({ silent: true })
```

(Map first: `rebuildIfReady` needs the map to build the VM; order isn't strictly required — `rebuildIfReady` guards on both — but map-first avoids a wasted no-op rebuild.)

- [ ] **Step 3: Verify mechanically**: `npx vitest run` green; `node --check src/app/main.js`.

- [ ] **Step 4: Commit**: `git add src/app/main.js && git commit -m "main: auto-reload last pattern and map on startup"`

---

### Task 4: Live end-to-end verification (Playwright MCP against `npm run dev`)

**Files:** none (verification only; fixes loop back into Tasks 1-3 files)

- [ ] **Step 1**: Start dev server (`npx vite --port 5183`, background). Open `http://localhost:5183/` via Playwright.
- [ ] **Step 2**: Click Pattern→Path tab, click `gyroid.js`; click Map→Path tab. Reload the page. Assert: Pattern section shows Path tab active with the same folder listing, Map section shows Path tab, and the pattern is loaded and rendering (`#warnings` shows the compile row, header filename says `gyroid.js`) — all without any clicks.
- [ ] **Step 3**: Failure fallback: in localStorage, edit `pb_emu.v1`'s `lastPattern.value` to a nonexistent path (via `browser_evaluate`), reload, assert the app loads blank with NO error banner (silent fallback) and tabs still restore.
- [ ] **Step 4**: `npx vitest run` one final time; kill the dev server.
- [ ] **Step 5**: Push: `git push origin main` (per repo convention, after user-visible verification passes).

## Self-review notes

- Spec coverage: persisted `ui` field (T2), browser `initial`/`onNavigate` (T1), tab restore via existing toggle path (T2 step 3), auto-reload with kind rules + silent failures (T3), `generated` maps (T3 via reloadMap's existing branch), file-kind exclusion (T3 restorable filter), editor visibility untouched (no task touches it), tests (T1 unit, T4 live). Gap check: none found.
- Type consistency: `state.ui` field names (`patternTab`/`mapTab`/`patternBrowser`/`mapBrowser`) match between T2 steps 1/3/4/5; `{root, path}` shape matches T1's `onNavigate` payload.
