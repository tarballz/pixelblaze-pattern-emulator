import { defineConfig, loadEnv } from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'

const LIST_ROUTE = '/__pb_emu__/list'
const FILE_ROUTE = '/__pb_emu__/external'
const WRITE_ROUTE = '/__pb_emu__/write'

function pbEmuBrowser({ patternsDir, mapsDir }) {
  return {
    name: 'pb-emu-browser',
    configureServer(server) {
      const samplesDir = path.resolve('public/samples')
      // Roots are scoped per kind so pattern/map browsers get their own space.
      const roots = {
        pattern: { samples: samplesDir },
        map:     { samples: samplesDir }
      }
      if (patternsDir) {
        roots.pattern.external = path.resolve(patternsDir)
        server.config.logger.info(`[pb_emu] pattern external root: ${roots.pattern.external}`)
      }
      if (mapsDir) {
        roots.map.external = path.resolve(mapsDir)
        server.config.logger.info(`[pb_emu] map external root: ${roots.map.external}`)
      }

      function safeJoin(root, rel) {
        const cleaned = String(rel || '').replace(/^\/+/, '')
        const joined = path.resolve(root, cleaned)
        const withSep = root.endsWith(path.sep) ? root : root + path.sep
        if (joined !== root && !joined.startsWith(withSep)) return null
        return joined
      }

      server.middlewares.use(LIST_ROUTE, async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://x')
          const kind = url.searchParams.get('kind') || 'pattern'
          const kindRoots = roots[kind]
          if (!kindRoots) return error(res, 400, `unknown kind: ${kind}`)
          const rootName = url.searchParams.get('root') || ''
          const rel = url.searchParams.get('path') || ''
          const roster = Object.keys(kindRoots)
          if (!rootName) return json(res, { roots: roster })
          const root = kindRoots[rootName]
          if (!root) return error(res, 404, 'unknown root')
          const target = safeJoin(root, rel)
          if (!target) return error(res, 400, 'bad path')
          const entries = await fs.readdir(target, { withFileTypes: true })
          const dirs = [], files = []
          await Promise.all(entries.map(async (e) => {
            if (e.name.startsWith('.')) return
            let isDir = e.isDirectory(), isFile = e.isFile()
            if (e.isSymbolicLink()) {
              try {
                const s = await fs.stat(path.join(target, e.name))
                isDir = s.isDirectory(); isFile = s.isFile()
              } catch { return }
            }
            if (isDir) dirs.push(e.name)
            else if (isFile) files.push(e.name)
          }))
          dirs.sort(); files.sort()
          json(res, { kind, root: rootName, path: rel, dirs, files, roots: roster })
        } catch (err) {
          error(res, 500, String(err?.message || err))
        }
      })

      // POST write endpoint — overwrite an existing file under the configured
      // external root. Declines writes to `samples` (shipped-with-repo) and to
      // paths that don't already exist (avoids stray file creation from typos).
      server.middlewares.use(WRITE_ROUTE, async (req, res) => {
        if (req.method !== 'POST') return error(res, 405, 'POST only')
        try {
          const body = await readBody(req)
          let parsed
          try { parsed = JSON.parse(body) } catch { return error(res, 400, 'invalid JSON') }
          const { kind, root: rootName, path: rel, content } = parsed || {}
          if (!kind || !rootName || typeof rel !== 'string' || typeof content !== 'string') {
            return error(res, 400, 'missing kind/root/path/content')
          }
          if (rootName !== 'external') return error(res, 403, `writes forbidden to root '${rootName}'`)
          const kindRoots = roots[kind]
          if (!kindRoots) return error(res, 400, `unknown kind: ${kind}`)
          const root = kindRoots[rootName]
          if (!root) return error(res, 404, `root '${rootName}' not configured`)
          const target = safeJoin(root, rel)
          if (!target) return error(res, 400, 'bad path')
          // Overwrite only — don't surprise the user by creating new files here.
          try {
            const st = await fs.stat(target)
            if (!st.isFile()) return error(res, 400, 'target is not a file')
          } catch {
            return error(res, 404, 'file does not exist (writes are overwrite-only)')
          }
          await fs.writeFile(target, content, 'utf8')
          json(res, { ok: true, bytes: Buffer.byteLength(content, 'utf8') })
        } catch (err) {
          error(res, 500, String(err?.message || err))
        }
      })

      // Files are served under /__pb_emu__/external/<kind>/<path>. The client
      // encodes the kind into the URL so this middleware stays stateless.
      server.middlewares.use(FILE_ROUTE, async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://x')
          const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
          const slash = rel.indexOf('/')
          const kind = slash < 0 ? rel : rel.slice(0, slash)
          const sub  = slash < 0 ? '' : rel.slice(slash + 1)
          const root = roots[kind]?.external
          if (!root) return error(res, 404, 'no external root for kind')
          const target = safeJoin(root, sub)
          if (!target) return error(res, 400, 'bad path')
          const buf = await fs.readFile(target)
          res.setHeader('Content-Type', contentTypeFor(target))
          res.setHeader('Cache-Control', 'no-store')
          res.end(buf)
        } catch (err) {
          error(res, 404, String(err?.message || err))
        }
      })
    }
  }
}

function json(res, obj) {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(obj))
}
function error(res, code, msg) {
  res.statusCode = code
  res.setHeader('Content-Type', 'text/plain')
  res.end(msg)
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
function contentTypeFor(p) {
  const ext = path.extname(p).toLowerCase()
  if (ext === '.js')   return 'application/javascript; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.epe')  return 'application/json; charset=utf-8'
  if (ext === '.csv')  return 'text/csv; charset=utf-8'
  return 'text/plain; charset=utf-8'
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PB_EMU_')
  return {
    plugins: [pbEmuBrowser({
      patternsDir: env.PB_EMU_EXTERNAL_PATTERNS || '',
      mapsDir:     env.PB_EMU_EXTERNAL_MAPS || ''
    })],
    test: {
      environment: 'node',
      include: ['test/**/*.test.js']
    }
  }
})
