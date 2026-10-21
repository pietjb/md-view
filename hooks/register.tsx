import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PreviewDoc } from '../types'
import { toHtml } from './html'

// Claude Desktop's built-in browser, reached as an MCP server.
const BROWSER = 'Claude_Browser'
const IS_MARKDOWN = /\.(md|markdown|mdx)$/i

const doc = atom({ plugin: 'md-preview', key: 'doc' } as const, null as PreviewDoc | null)

const isAbsolute = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p)
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p
const unquote = (s: string) => s.trim().replace(/^["'](.*)["']$/, '$1')
const fileUrl = (p: string) => `file:///${encodeURI(p.replace(/\\/g, '/').replace(/^\//, ''))}`

const absolute = async ($: EngineInterface, p: string) =>
  isAbsolute(p) ? p : `${(await $.session.cwd()).replace(/[\\/]$/, '')}/${p}`

// Renders the Markdown file to <temp>/md-preview/<name>.html and remembers it.
const render = async ($: EngineInterface, file: string): Promise<PreviewDoc> => {
  const path = await absolute($, file)
  const text = await $.fs.read(path)
  const tmp = ((await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp').replace(/[\\/]$/, '')
  const htmlPath = `${tmp}/md-preview/${baseName(path).replace(IS_MARKDOWN, '')}.html`

  await $.fs.write(htmlPath, toHtml(baseName(path), text, path))
  const rendered = { file: path, htmlPath }
  await update($, doc, () => rendered)

  return rendered
}

const openInSystemBrowser = async ($: EngineInterface, htmlPath: string) => {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const opener = isWindows
    ? ['explorer.exe', htmlPath.replace(/\//g, '\\')]
    : [(await $.process.run(['uname'])).stdout.trim() === 'Darwin' ? 'open' : 'xdg-open', htmlPath]
  await $.process.run(opener, { timeoutMs: 10_000 })
}

// Opens the page in the desktop app's browser pane; false when that pane
// cannot be reached (another surface, or the browser server is off).
const openInPane = async ($: EngineInterface, htmlPath: string) => {
  try {
    const result = await $.mcp.call(BROWSER, 'preview_start', { url: fileUrl(htmlPath) })

    return result.isError !== true
  } catch {
    return false
  }
}

// Editing servers by file: one Node process each, alive for the session (the
// module's unload ends the loop that holds it, and that kills it).
const editors = new Map<string, { url: string; stop: () => void }>()

const startEditor = async ($: EngineInterface, path: string) => {
  const key = path.replace(/\\/g, '/').toLowerCase()
  const running = editors.get(key)
  if (running) return running.url

  const child = $.process.spawn({ argv: ['node', `${$.plugin.root}/editor/server.mjs`, path] })
  let onReady: (port: number | undefined) => void = () => {}
  const ready = new Promise<number | undefined>(resolve => (onReady = resolve))

  void (async () => {
    try {
      for await (const { stream, text } of child) {
        const port = stream === 'stdout' ? /READY (\d+)/.exec(text)?.[1] : undefined
        if (port) onReady(Number(port))
        if (stream === 'stderr') $.ui.log(`md-edit: ${text.trim()}`, { to: 'debug' })
      }
    } catch (err) {
      $.ui.log(`md-edit: ${String(err)}`, { to: 'debug' })
    } finally {
      editors.delete(key)
      onReady(undefined)
    }
  })()

  const port = await Promise.race([ready, $.clock.sleep(10_000).then(() => undefined)])
  if (!port) {
    void child.return(undefined as never)
    throw new Error('the editor server did not start (is Node.js installed and on PATH?)')
  }
  const url = `http://127.0.0.1:${port}/`
  editors.set(key, { url, stop: () => void child.return(undefined as never) })

  return url
}

const edit = async ($: EngineInterface, file: string) => {
  const path = await absolute($, file)
  if (!(await $.fs.exists(path))) return `No such file: ${path}`

  let url: string
  try {
    url = await startEditor($, path)
  } catch (err) {
    return `Could not start the editor: ${String(err)}`
  }
  await update($, doc, d => d ?? { file: path, htmlPath: '' })

  try {
    const result = await $.mcp.call(BROWSER, 'preview_start', { url })
    if (result.isError !== true) return `Editing ${baseName(path)} in the browser pane (${url}). Save with Ctrl+S.`
  } catch {
    // Fall through to the default browser.
  }
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  await $.process.run(isWindows ? ['explorer.exe', url] : ['xdg-open', url], { timeoutMs: 10_000 }).catch(() => undefined)

  return `Editing ${baseName(path)} at ${url} (the browser pane was not available).`
}

const preview = async ($: EngineInterface, file: string, where: 'pane' | 'system') => {
  let rendered: PreviewDoc
  try {
    rendered = await render($, file)
  } catch (err) {
    return `Could not read ${file}: ${String(err)}`
  }

  if (where === 'pane' && (await openInPane($, rendered.htmlPath))) {
    return `Previewing ${baseName(rendered.file)} in the browser pane.`
  }
  try {
    await openInSystemBrowser($, rendered.htmlPath)
  } catch {
    return `HTML written to ${rendered.htmlPath} (could not open a browser automatically).`
  }

  return where === 'pane'
    ? `The browser pane was not available, so ${baseName(rendered.file)} opened in your default browser.`
    : `Opened ${baseName(rendered.file)} in your default browser.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'md-preview',
      description: "Preview a Markdown file as HTML in Claude Desktop's browser pane",
      argumentHint: '<file.md>',
    })
    await $.command.register({
      name: 'md-html',
      description: 'Open a Markdown file as HTML in your default browser',
      argumentHint: '<file.md>',
    })
    await $.command.register({
      name: 'md-edit',
      description: "Edit a Markdown file visually in Claude Desktop's browser pane; saves back to the file",
      argumentHint: '<file.md> | stop',
    })

    return next(e)
  })

  on('command.run', { command: 'md-edit' }, async ($, e) => {
    const arg = unquote(e.args)
    if (arg === 'stop') {
      const count = editors.size
      for (const one of editors.values()) one.stop()
      editors.clear()

      return { text: count ? `Stopped ${count} editor server(s).` : 'No editor is running.' }
    }
    const file = arg || (await read($, doc))?.file
    if (!file) return { text: 'Usage: /md-edit <file.md>' }

    return { text: await edit($, file) }
  })

  on('command.run', { command: 'md-preview' }, async ($, e) => {
    const file = unquote(e.args) || (await read($, doc))?.file
    if (!file) return { text: 'Usage: /md-preview <file.md>' }

    return { text: await preview($, file, 'pane') }
  })

  on('command.run', { command: 'md-html' }, async ($, e) => {
    const file = unquote(e.args) || (await read($, doc))?.file
    if (!file) return { text: 'Usage: /md-html <file.md>' }

    return { text: await preview($, file, 'system') }
  })

  // Keep the HTML current when Claude edits the file being previewed.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path = e.tool === 'Write' || e.tool === 'Edit' ? e.file_path : undefined
    const current = await read($, doc)
    if (path && current && ran.deny === undefined && ran.isError !== true &&
        (await absolute($, path)).replace(/\\/g, '/').toLowerCase() === current.file.replace(/\\/g, '/').toLowerCase()) {
      await render($, current.file).catch(() => undefined)
      $.ui.status(`md-preview: ${baseName(current.file)} updated, reload the preview`)
    }

    return ran
  })
}
