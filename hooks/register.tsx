import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ViewedDoc } from '../types'

// Claude Desktop's built-in browser: the MCP server whose tools Claude calls
// as mcp__Claude_Browser__*. Its exact prefix can differ by setup, so the tool
// is looked up by its ending first.
const BROWSER = 'Claude_Browser'
const PREVIEW_TOOL = /^mcp__.*Claude_Browser__preview_start$/

const describe = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return (text ?? String(value)).replace(/\s+/g, ' ').slice(0, 200)
}

// Opens url in the browser pane. Returns null when it opened, else why not.
const openInPane = async ($: EngineInterface, url: string): Promise<string | null> => {
  const reasons: string[] = []

  // The way Claude opens it: the browser's own tool, through the tool chain.
  const tool = (await $.tool.list()).find(t => PREVIEW_TOOL.test(t.name))
  if (tool) {
    try {
      const ran = await $.tool.call({ tool: tool.name as `mcp__${string}__${string}`, url })
      if (ran.deny !== undefined) reasons.push(`${tool.name} was refused: ${describe(ran.deny)}`)
      else if (ran.isError) reasons.push(`${tool.name} failed: ${describe(ran.result)}`)
      else return null
    } catch (err) {
      reasons.push(`${tool.name} failed: ${describe(String(err))}`)
    }
  } else {
    reasons.push('no browser pane tool is available in this session')
  }

  // Directly on the server, for setups where the tool is not listed.
  try {
    const result = await $.mcp.call(BROWSER, 'preview_start', { url })
    if (result.isError !== true) return null
    reasons.push(`${BROWSER} server: ${describe(result.content)}`)
  } catch (err) {
    reasons.push(`${BROWSER} server: ${describe(String(err))}`)
  }

  return reasons.join('; ')
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

// Opens the file in the browser pane, locked in the Markdown view; the default
// browser when the pane cannot be reached (another surface, or it is off).
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

  const failure = await openInPane($, url)
  if (failure === null) return `Viewing ${baseName(path)} in the browser pane. Unlock to edit; save with Ctrl+S.`
  $.ui.log(`md-view: browser pane not opened: ${failure}`, { to: 'debug' })

  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const opener = isWindows
    ? ['explorer.exe', url]
    : [(await $.process.run(['uname'])).stdout.trim() === 'Darwin' ? 'open' : 'xdg-open', url]
  await $.process.run(opener, { timeoutMs: 10_000 }).catch(() => undefined)

  return `Viewing ${baseName(path)} in your default browser at ${url}. The browser pane could not be opened: ${failure}`
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
