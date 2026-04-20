// Small in-panel file browser for the Path tab. Talks to the dev-server
// listing endpoint (/__pb_emu__/list) to enumerate roots and subdirectories.
//
// Selecting a file invokes onPick(url, { name }) where `url` is directly
// fetchable — /samples/foo.js for the bundled root, /__pb_emu__/external/...
// for a user-mounted root.

const LIST_URL = '/__pb_emu__/list'
const FILE_URL = '/__pb_emu__/external'

export function createBrowser({ container, kind, onPick, filter, emptyMessage = 'Empty' }) {
  container.classList.add('pbb')
  const rootSel = document.createElement('select')
  rootSel.className = 'pbb-root'
  const crumb = document.createElement('span')
  crumb.className = 'pbb-crumb'
  const list = document.createElement('div')
  list.className = 'pbb-list'
  const bar = document.createElement('div')
  bar.className = 'pbb-bar'
  bar.append(rootSel, crumb)
  container.replaceChildren(bar, list)

  let current = { root: null, path: '' }
  let activeUrl = null

  async function listRoots() {
    const r = await fetch(`${LIST_URL}?kind=${encodeURIComponent(kind)}`)
    if (!r.ok) throw new Error(`list roots: ${r.status}`)
    return r.json()
  }
  async function listDir(root, path) {
    const r = await fetch(`${LIST_URL}?kind=${encodeURIComponent(kind)}&root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`)
    if (!r.ok) throw new Error(`list ${root}/${path}: ${r.status}`)
    return r.json()
  }

  function urlFor(root, relPath) {
    const p = relPath ? `/${relPath.replace(/^\/+/, '')}` : ''
    if (root === 'samples') return `/samples${p}`
    return `${FILE_URL}/${kind}${p}`
  }

  async function navigate(root, path = '') {
    current = { root, path }
    renderCrumb()
    list.replaceChildren(msgRow('Loading…'))
    try {
      const data = await listDir(root, path)
      render(data)
    } catch (err) {
      list.replaceChildren(msgRow(String(err.message || err), 'err'))
    }
  }

  function renderCrumb() {
    crumb.replaceChildren()
    const parts = current.path ? current.path.split('/').filter(Boolean) : []
    const mkCrumb = (label, path) => {
      const a = document.createElement('a')
      a.className = 'pbb-crumb-link'
      a.textContent = label
      a.href = '#'
      a.addEventListener('click', (e) => { e.preventDefault(); navigate(current.root, path) })
      return a
    }
    crumb.append(mkCrumb('/', ''))
    let acc = ''
    parts.forEach((p, i) => {
      acc += (acc ? '/' : '') + p
      crumb.append(document.createTextNode(i === 0 ? '' : '/'))
      crumb.append(mkCrumb(p, acc))
    })
  }

  function render({ dirs = [], files = [] }) {
    list.replaceChildren()
    if (current.path) {
      list.append(row('..', 'dir', () => {
        const parts = current.path.split('/').filter(Boolean)
        parts.pop()
        navigate(current.root, parts.join('/'))
      }))
    }
    for (const d of dirs) {
      list.append(row(d + '/', 'dir', () => {
        const next = current.path ? `${current.path}/${d}` : d
        navigate(current.root, next)
      }))
    }
    const filtered = typeof filter === 'function' ? files.filter(f => filter(f)) : files
    for (const f of filtered) {
      const rel = current.path ? `${current.path}/${f}` : f
      const url = urlFor(current.root, rel)
      const r = row(f, 'file', () => {
        activeUrl = url
        markActive()
        onPick(url, { name: f })
      })
      r.dataset.url = url
      if (url === activeUrl) r.classList.add('pbb-active')
      list.append(r)
    }
    if (!dirs.length && !filtered.length) list.append(msgRow(emptyMessage))
  }

  function markActive() {
    for (const el of list.querySelectorAll('.pbb-row.pbb-file')) {
      el.classList.toggle('pbb-active', el.dataset.url === activeUrl)
    }
  }

  function row(label, kind, onClick) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = `pbb-row pbb-${kind}`
    el.textContent = label
    el.addEventListener('click', onClick)
    return el
  }
  function msgRow(text, cls = '') {
    const el = document.createElement('div')
    el.className = `pbb-msg ${cls}`.trim()
    el.textContent = text
    return el
  }

  async function init() {
    try {
      const { roots } = await listRoots()
      rootSel.replaceChildren()
      for (const r of roots) {
        const opt = document.createElement('option')
        opt.value = r
        opt.textContent = r
        rootSel.append(opt)
      }
      rootSel.disabled = roots.length <= 1
      rootSel.addEventListener('change', () => navigate(rootSel.value, ''))
      if (roots.length) {
        const chosen = roots.includes('external') ? 'external' : roots[0]
        rootSel.value = chosen
        navigate(chosen, '')
      } else {
        list.replaceChildren(msgRow('No roots available.', 'err'))
      }
    } catch (err) {
      list.replaceChildren(msgRow(`Browser unavailable: ${err.message || err}`, 'err'))
    }
  }

  init()

  return { refresh: () => navigate(current.root, current.path) }
}
