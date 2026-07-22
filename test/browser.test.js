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
