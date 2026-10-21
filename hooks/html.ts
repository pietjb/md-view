// Builds a standalone HTML page for one Markdown document. Everything is
// rendered here (marked, vendored) with inline styles and no scripts, so the
// page reads the same in Claude Desktop's browser pane, which shows local files
// as static snapshots, and in any other browser.

import { marked } from './vendor/marked.js'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const stripTags = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

// Gives h1-h4 ids and collects them for the table of contents.
const withAnchors = (body: string) => {
  const used = new Map<string, number>()
  const toc: string[] = []
  const html = body.replace(/<h([1-4])>([\s\S]*?)<\/h\1>/g, (_, level: string, inner: string) => {
    const text = stripTags(inner).trim()
    let id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-') || 'section'
    const seen = used.get(id) ?? 0
    used.set(id, seen + 1)
    if (seen) id += `-${seen}`
    toc.push(`<a class="l${level}" href="#${id}">${escapeHtml(text)}</a>`)

    return `<h${level} id="${id}">${inner}</h${level}>`
  })

  return { html, toc }
}

// YAML front matter is shown as a properties box, not parsed as Markdown
// (where it would read as a rule and a heading).
const FRONT = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/

const frontMatterHtml = (yaml: string) =>
  `<pre class="front"><span>Front matter</span>${escapeHtml(yaml)}</pre>`

export const toHtml = (title: string, markdown: string, source = title): string => {
  const front = FRONT.exec(markdown)
  const body = front ? markdown.slice(front[0].length) : markdown
  const rendered = (front ? frontMatterHtml(front[1]!) : '') + (marked.parse(body, { gfm: true, async: false }) as string)
  const { html, toc } = withAnchors(rendered.replace(/<a href="http/g, '<a target="_blank" rel="noopener" href="http'))
  const hasToc = toc.length >= 2

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg: #ffffff; --fg: #1f2328; --side: #f6f8fa; --line: #d0d7de; --muted: #59636e;
          --accent: #0969da; --code: #eff1f3; --pre: #f6f8fa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0d1117; --fg: #e6edf3; --side: #151b23; --line: #3d444d; --muted: #9198a1;
            --accent: #4493f8; --code: #262c36; --pre: #151b23; }
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--fg);
         font: 16px/1.6 -apple-system, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
  .layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }
  .layout.no-toc { display: block; }
  nav { position: sticky; top: 0; height: 100vh; overflow: auto; padding: 24px 16px;
        background: var(--side); border-right: 1px solid var(--line); font-size: 13px; }
  nav h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 12px; border: 0; }
  nav a { display: block; color: var(--muted); text-decoration: none; padding: 3px 0; line-height: 1.35; }
  nav a:hover { color: var(--accent); }
  nav .l1 { font-weight: 600; } nav .l3 { padding-left: 12px; } nav .l4 { padding-left: 24px; }
  main { padding: 40px 48px 96px; }
  .doc, .meta { max-width: 860px; margin: 0 auto; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 24px; word-break: break-all; }
  .doc h1, .doc h2 { padding-bottom: .3em; border-bottom: 1px solid var(--line); }
  .doc h1 { font-size: 2em; margin: 0 0 16px; } .doc h2 { font-size: 1.5em; margin: 32px 0 16px; }
  .doc h3 { font-size: 1.25em; margin: 24px 0 12px; } .doc h4 { margin: 20px 0 8px; }
  .doc a { color: var(--accent); text-decoration: none; } .doc a:hover { text-decoration: underline; }
  .doc code { font: 85%/1.45 ui-monospace, "Cascadia Code", Consolas, monospace; background: var(--code);
              padding: .2em .4em; border-radius: 6px; }
  .doc pre { background: var(--pre); border: 1px solid var(--line); border-radius: 8px; padding: 16px; overflow: auto; }
  .doc pre code { background: none; padding: 0; font-size: 13px; }
  .doc pre.front { font: 13px/1.5 ui-monospace, "Cascadia Code", Consolas, monospace; color: var(--muted); margin: 0 0 24px; }
  .doc pre.front span { display: block; font: 600 11px/1.6 -apple-system, "Segoe UI", sans-serif;
                        text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
  .doc blockquote { margin: 0 0 16px; padding: 0 1em; color: var(--muted); border-left: 4px solid var(--line); }
  .doc table { border-collapse: collapse; display: block; overflow: auto; margin: 0 0 16px; }
  .doc th, .doc td { border: 1px solid var(--line); padding: 6px 13px; }
  .doc th { background: var(--side); font-weight: 600; }
  .doc tr:nth-child(2n) td { background: var(--side); }
  .doc img { max-width: 100%; }
  .doc hr { border: 0; border-top: 1px solid var(--line); margin: 24px 0; }
  .doc li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.3em; }
  @media (max-width: 820px) { .layout { display: block; } nav { display: none; } main { padding: 24px 16px 64px; } }
  @media print { nav { display: none; } .layout { display: block; } main { padding: 0; } }
</style>
</head>
<body>
<div class="layout${hasToc ? '' : ' no-toc'}">
  ${hasToc ? `<nav><h2>Contents</h2>${toc.join('')}</nav>` : ''}
  <main>
    <div class="meta">${escapeHtml(source)}</div>
    <article class="doc">${html}</article>
  </main>
</div>
</body>
</html>
`
}
