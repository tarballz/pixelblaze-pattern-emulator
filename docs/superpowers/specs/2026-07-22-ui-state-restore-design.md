# UI State Restore — Design

## Problem

Reloading the emulator loses all navigation state: the active loader tab
(File/Paste/URL/Path) in the Pattern and Pixel Map sections resets, the Path
browser forgets which root/folder was open, and the last-loaded pattern and
map are not restored (their descriptors are saved in localStorage but
deliberately never read back). Every session starts with re-clicking the Path
tab, re-drilling the folder tree, and re-picking the same files.

Goal: reload drops the user exactly where they were — same tabs, same browser
folder, last pattern and map already loaded and running — with zero behavior
change when nothing is saved or a restore step fails.

## Scope decisions (user-confirmed)

- Restore: active tabs, Path-browser locations, last pattern + map.
- Editor visibility stays deliberately unrestored (current intentional
  behavior, unchanged).
- `file`-kind loads cannot be restored (browsers cannot re-read a `File`
  object after reload) — those sessions start blank as today.

## Approach

Extend the existing `pb_emu.v1` localStorage blob and `persist()` flow in
`src/app/main.js` — no new storage keys, no new mechanism. Rejected
alternatives: a separate `pb_emu.ui.v1` key (diverges from the single-blob
convention for no gain) and URL-hash state (adds shareability nobody asked
for, more machinery).

## Design

### Persisted state (new `ui` field in `pb_emu.v1`)

```js
ui: {
  patternTab: 'path',                     // 'file' | 'paste' | 'url' | 'path'
  mapTab: 'gen',                          // + 'gen' for the map section
  patternBrowser: { root: 'external', path: 'egg' },
  mapBrowser:     { root: 'external', path: '' },
}
```

Written by the existing `persist()`; new persist() triggers on tab clicks and
on Path-browser navigation. `lastPattern`/`lastMap` descriptors are already
saved today — auto-reload needs no new data.

### `src/app/browser.js` interface change

`createBrowser(opts)` gains two optional fields:

- `initial: { root, path }` — navigate here on mount instead of the default
  root listing (invalid/missing target falls back to the default silently).
- `onNavigate(loc)` — called with `{ root, path }` after each successful
  `navigate()`, so `main.js` owns persistence and `browser.js` stays a dumb
  component with no storage knowledge.

### Restore flow (in `main.js` startup, after existing options restore)

Each step independently try/caught; any failure falls back silently to
today's blank behavior:

1. **Tabs**: activate `ui.patternTab` / `ui.mapTab` through the existing
   toggle code path (so panel visibility stays in sync) — not by duplicating
   the classList logic.
2. **Browser locations**: passed as `initial` to the two `createBrowser`
   calls.
3. **Pattern**: if `lastPattern.kind` is `'path'`/`'url'`, fetch and
   `loadPattern` via the existing `reloadPattern()` machinery; `'paste'`
   restores from the descriptor's stored value. `'file'`/`'editor'` kinds:
   no restore.
4. **Map**: same, plus `'generated'` restores via
   `loadGeneratedMap(JSON.parse(d.value))` — all reusing `reloadMap()`
   logic.

Restoring a pattern goes through the normal `loadPattern` path, so Recents,
the file-watcher, lint, and the hardware-compile check all behave exactly as
a manual load.

## Error handling

- Saved folder deleted → browser falls back to default listing.
- Saved pattern/map file moved/deleted → that restore step no-ops (existing
  `showError` stays silent on startup restore; app starts blank as today).
- Corrupt/missing `ui` blob → ignored (same pattern as the existing
  options-restore try/catch).

## Testing

- Existing vitest suite stays green.
- New unit coverage following `watcher.test.js` conventions for the pure
  parts: `browser.js` `initial`/`onNavigate` behavior (happy-dom), and the
  restore-decision logic (which kinds restore, failure fallbacks) if
  extracted testably.
- Live end-to-end via Playwright against `npm run dev`: navigate to a folder,
  load a pattern, reload the page, assert same tab + folder + pattern
  running; repeat with a deleted-file case asserting silent fallback.
