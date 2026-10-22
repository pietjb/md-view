import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ViewedDoc } from '../types'
import { readOnlyPage } from './readonly'

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

// Viewer servers by file: one process each, alive for the session (the
// module's unload ends the loop that holds it, and that kills it).
const servers = new Map<string, { url: string; stop: () => void }>()

// The runtimes a viewer server can run on, in order: Node.js where installed,
// else Windows PowerShell, which every Windows machine has.
const serverCommands = async ($: EngineInterface, path: string) => {
  const editor = `${$.plugin.root}/editor`
  const commands = [['node', `${editor}/server.mjs`, path]]
  if ((await $.env.get('OS')) === 'Windows_NT') {
    commands.push([
      'powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', `${editor}/server.ps1`, path,
    ])
  }
  return commands
}

// Runs one server command; its URL once it prints READY, else undefined (the
// runtime is missing or failed). A missing runtime fails at once.
const trySpawn = async ($: EngineInterface, key: string, argv: string[]) => {
  const child = $.process.spawn({ argv })
  const stop = () => void child.return(undefined as never)
  let onReady: (port: number | undefined) => void = () => {}
  const ready = new Promise<number | undefined>(resolve => (onReady = resolve))

  void (async () => {
    try {
      for await (const { stream, text } of child) {
        const port = stream === 'stdout' ? /READY (\d+)/.exec(text)?.[1] : undefined
        if (port) onReady(Number(port))
        if (stream === 'stderr') $.ui.log(`md-view (${argv[0]}): ${text.trim()}`, { to: 'debug' })
      }
    } catch (err) {
      $.ui.log(`md-view (${argv[0]}): ${String(err)}`, { to: 'debug' })
    } finally {
      if (servers.get(key)?.stop === stop) servers.delete(key)
      onReady(undefined)
    }
  })()

  const port = await Promise.race([ready, $.clock.sleep(15_000).then(() => undefined)])
  if (!port) {
    stop()
    return undefined
  }
  const url = `http://127.0.0.1:${port}/`
  servers.set(key, { url, stop })

  return url
}

// The viewer's URL for the file, or undefined when no runtime could serve it.
const startServer = async ($: EngineInterface, path: string) => {
  const key = path.replace(/\\/g, '/').toLowerCase()
  const running = servers.get(key)
  if (running) return running.url

  for (const argv of await serverCommands($, path)) {
    const url = await trySpawn($, key, argv)
    if (url) return url
  }
  return undefined
}

// Without a viewer server: the file read-only in the default browser, from a
// self-contained page written to <temp>/md-view/.
const openReadOnly = async ($: EngineInterface, path: string) => {
  const assets = `${$.plugin.root}/editor/assets`
  const [text, viewerJs, css, darkCss] = await Promise.all([
    $.fs.read(path),
    $.fs.read(`${assets}/toastui-editor-all.min.js`),
    $.fs.read(`${assets}/toastui-editor.css`),
    $.fs.read(`${assets}/toastui-editor-dark.css`),
  ])
  const tmp = ((await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp').replace(/[\\/]$/, '')
  const page = `${tmp}/md-view/${baseName(path).replace(/[^\w.-]/g, '_')}.html`
  await $.fs.write(page, readOnlyPage(baseName(path), text, viewerJs, css, darkCss))
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  await openInDefaultBrowser($, isWindows ? page.replace(/\//g, '\\') : page)
}

// Starts the viewer for the file (locked in the Markdown view) and shows it in
// the browser pane, or in the default browser when the pane can't be used.
const view = async ($: EngineInterface, file: string) => {
  const path = await absolute($, file)
  if (!(await $.fs.exists(path))) return `No such file: ${path}`

  const url = await startServer($, path)
  if (!url) {
    try {
      await openReadOnly($, path)
    } catch (err) {
      return `Could not open ${baseName(path)}: ${String(err)}`
    }
    return `Opened ${baseName(path)} read-only in your default browser. To edit it in md-view, install Node.js (nodejs.org).`
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
