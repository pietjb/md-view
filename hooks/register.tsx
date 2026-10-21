import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ViewedDoc } from '../types'

// Claude Desktop's built-in browser: the tool Claude calls as
// mcp__Claude_Browser__preview_start (its prefix can differ by setup).
const PREVIEW_TOOL = /^mcp__.*Claude_Browser__preview_start$/

// Opens url in the pane through the browser's own tool, under the person's
// permission settings. In auto mode a call with no request behind it is
// refused, unless they set it up (extras/allow-local-preview.mjs, see the
// README). Returns 'opened', 'refused' or 'no-pane'.
const openInPane = async ($: EngineInterface, url: string) => {
  const tool = (await $.tool.list()).find(t => PREVIEW_TOOL.test(t.name))
  if (!tool) return 'no-pane' as const
  try {
    const ran = await $.tool.call({ tool: tool.name as `mcp__${string}__${string}`, url })

    return ran.deny === undefined && ran.isError !== true ? ('opened' as const) : ('refused' as const)
  } catch {
    return 'refused' as const
  }
}

// When the pane can't be opened directly, the request is drafted in the
// prompt box; the person reads it and sends it, and Claude opens the pane like
// for any request they type. True when the draft is in.
const draftPaneRequest = async ($: EngineInterface, url: string, path: string) => {
  const filled = await $.prompt
    .fill({ text: `Open ${url} in the browser pane (md-view viewer for ${baseName(path)})` })
    .catch(() => ({ isFilled: false }))

  return filled.isFilled
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
// the browser pane: directly where permitted, else by drafting the request;
// the default browser where the session has no pane or no prompt box.
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

  const pane = await openInPane($, url)
  if (pane === 'opened') return `Viewing ${baseName(path)} in the browser pane. Unlock to edit; save with Ctrl+S.`
  if (pane === 'refused' && (await draftPaneRequest($, url, path))) {
    return `The viewer for ${baseName(path)} is ready. Press Enter to send the request in your prompt box, and Claude opens it in the browser pane. (To open it in one step, see "One-step opening" in md-view's README.)`
  }
  await openInDefaultBrowser($, url)

  return `Viewing ${baseName(path)} in your default browser at ${url}.`
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
