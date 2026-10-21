import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ViewedDoc } from '../types'

// Claude Desktop's built-in browser: the tool Claude calls as
// mcp__Claude_Browser__preview_start (its prefix can differ by setup), on the
// Claude_Browser server.
const BROWSER = 'Claude_Browser'
const PREVIEW_TOOL = /^mcp__.*Claude_Browser__preview_start$/

// Opens url in the browser pane, under the person's permission settings: by
// the browser's own tool, else on its server directly. False when neither
// can (no pane in this session, or refused, as auto mode refuses a call no
// request of the person's asked for).
const openInPane = async ($: EngineInterface, url: string) => {
  const tool = (await $.tool.list()).find(t => PREVIEW_TOOL.test(t.name))
  if (tool) {
    try {
      const ran = await $.tool.call({ tool: tool.name as `mcp__${string}__${string}`, url })
      if (ran.deny === undefined && ran.isError !== true) return true
    } catch {
      // Try the server directly.
    }
  }
  try {
    return (await $.mcp.call(BROWSER, 'preview_start', { url })).isError !== true
  } catch {
    return false
  }
}

const openInDefaultBrowser = async ($: EngineInterface, url: string) => {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const opener = isWindows
    ? ['explorer.exe', url]
    : [(await $.process.run(['uname'])).stdout.trim() === 'Darwin' ? 'open' : 'xdg-open', url]
  await $.process.run(opener, { timeoutMs: 10_000 }).catch(() => undefined)
}

const doc = atom({ plugin: 'md-view', key: 'doc' } as const, null as ViewedDoc | null)

const isAbsolute = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p)
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p
const unquote = (s: string) => s.trim().replace(/^["'](.*)["']$/, '$1')

const absolute = async ($: EngineInterface, p: string) =>
  isAbsolute(p) ? p : `${(await $.session.cwd()).replace(/[\\/]$/, '')}/${p}`

// Viewer servers by file: one Node process each, alive for the session (the
// module's unload ends the loop that holds it, and that kills it).
const servers = new Map<string, { url: string; stop: () => void }>()

const startServer = async ($: EngineInterface, path: string) => {
  const key = path.replace(/\\/g, '/').toLowerCase()
  const running = servers.get(key)
  if (running) return running.url

  const child = $.process.spawn({ argv: ['node', `${$.plugin.root}/editor/server.mjs`, path] })
  let onReady: (port: number | undefined) => void = () => {}
  const ready = new Promise<number | undefined>(resolve => (onReady = resolve))

  void (async () => {
    try {
      for await (const { stream, text } of child) {
        const port = stream === 'stdout' ? /READY (\d+)/.exec(text)?.[1] : undefined
        if (port) onReady(Number(port))
        if (stream === 'stderr') $.ui.log(`md-view: ${text.trim()}`, { to: 'debug' })
      }
    } catch (err) {
      $.ui.log(`md-view: ${String(err)}`, { to: 'debug' })
    } finally {
      servers.delete(key)
      onReady(undefined)
    }
  })()

  const port = await Promise.race([ready, $.clock.sleep(10_000).then(() => undefined)])
  if (!port) {
    void child.return(undefined as never)
    throw new Error('the viewer server did not start (is Node.js installed and on PATH?)')
  }
  const url = `http://127.0.0.1:${port}/`
  servers.set(key, { url, stop: () => void child.return(undefined as never) })

  return url
}

// Starts the viewer for the file (locked in the Markdown view) and shows it in
// the browser pane, or in the default browser when the pane can't be used.
const view = async ($: EngineInterface, file: string) => {
  const path = await absolute($, file)
  if (!(await $.fs.exists(path))) return `No such file: ${path}`

  let url: string
  try {
    url = await startServer($, path)
  } catch (err) {
    return `Could not open ${baseName(path)}: ${String(err)}`
  }
  await update($, doc, () => ({ file: path }))

  if (await openInPane($, url)) return `Viewing ${baseName(path)} in the browser pane. Unlock to edit; save with Ctrl+S.`
  await openInDefaultBrowser($, url)

  return 'Could not use Claude browser, opening in default browser'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'md-view',
      description: "View and edit a Markdown file in Claude Desktop's browser pane",
      argumentHint: '<file.md> | stop',
    })

    return next(e)
  })

  on('command.run', { command: 'md-view' }, async ($, e) => {
    const arg = unquote(e.args)
    if (arg === 'stop') {
      const count = servers.size
      for (const one of servers.values()) one.stop()
      servers.clear()

      return { text: count ? `Stopped ${count} viewer server(s).` : 'No viewer is running.' }
    }
    const file = arg || (await read($, doc))?.file
    if (!file) return { text: 'Usage: /md-view <file.md>, or /md-view stop' }

    return { text: await view($, file) }
  })
}
