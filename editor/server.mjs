// Local editing server for md-preview's /md-edit, started by the hooks module
// with Node:  node server.mjs <file.md>
//
// It listens on 127.0.0.1 on a free port, prints "READY <port>" once listening,
// serves the editor page and its assets, and reads and writes exactly the one
// Markdown file it was started for. It exits after IDLE_MS without a request
// (the open page polls every few seconds), or when its parent kills it.

import { createServer } from 'node:http'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = process.argv[2]
if (!file) {
  console.error('usage: node server.mjs <file.md>')
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const IDLE_MS = 30 * 60 * 1000
const MAX_BODY = 10 * 1024 * 1024
const ASSETS = {
  'toastui-editor-all.min.js': 'text/javascript; charset=utf-8',
  'restore-style.js': 'text/javascript; charset=utf-8',
  'toastui-editor.css': 'text/css; charset=utf-8',
  'toastui-editor-dark.css': 'text/css; charset=utf-8',
}
const page = readFileSync(join(here, 'editor.html'), 'utf8')

let port = 0
let idle = setTimeout(() => process.exit(0), IDLE_MS)
const touch = () => {
  clearTimeout(idle)
  idle = setTimeout(() => process.exit(0), IDLE_MS)
}

const mtimeOf = async () => (await stat(file)).mtimeMs

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

const readBody = req =>
  new Promise((resolve, reject) => {
    let size = 0
    const parts = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
      } else parts.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })

const server = createServer(async (req, res) => {
  // Only this machine, by this exact address: refuses DNS-rebound names.
  if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, { error: 'bad host' })
  touch()

  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, page.replaceAll('__TITLE__',basename(file).replace(/[<>&"]/g, '')), 'text/html; charset=utf-8')
    }

    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const name = url.pathname.slice('/assets/'.length)
      if (!Object.hasOwn(ASSETS, name)) return send(res, 404, { error: 'not found' })
      return send(res, 200, await readFile(join(here, 'assets', name)), ASSETS[name])
    }

    if (req.method === 'GET' && url.pathname === '/api/doc') {
      const [text, mtime] = await Promise.all([readFile(file, 'utf8'), mtimeOf()])
      return send(res, 200, { name: basename(file), path: file, text, mtime })
    }

    if (req.method === 'GET' && url.pathname === '/api/mtime') {
      return send(res, 200, { mtime: await mtimeOf() })
    }

    if (req.method === 'POST' && url.pathname === '/api/save') {
      // A write only from the editor page itself, never from another site.
      if (req.headers.origin !== `http://127.0.0.1:${port}`) return send(res, 403, { error: 'bad origin' })
      if (!String(req.headers['content-type']).startsWith('application/json')) {
        return send(res, 415, { error: 'json only' })
      }
      const { text, baseMtime, force } = JSON.parse(await readBody(req))
      if (typeof text !== 'string') return send(res, 400, { error: 'text missing' })

      const current = await mtimeOf()
      if (!force && current !== baseMtime) return send(res, 409, { conflict: true, mtime: current })

      await writeFile(file, text, 'utf8')
      return send(res, 200, { mtime: await mtimeOf() })
    }

    send(res, 404, { error: 'not found' })
  } catch (err) {
    send(res, 500, { error: String(err?.message ?? err) })
  }
})

server.listen(0, '127.0.0.1', () => {
  port = server.address().port
  console.log(`READY ${port}`)
})
