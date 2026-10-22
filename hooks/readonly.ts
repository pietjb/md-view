// A read-only page for a Markdown file, for when no viewer server can run:
// Toast UI's Viewer and its styles inlined with the file's text, so the page
// is one self-contained file the default browser opens from disk.

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

// Keeps an inlined script or style from closing its own tag early.
const inlineSafe = (s: string, tag: 'script' | 'style') => s.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`)

export const readOnlyPage = (name: string, markdown: string, viewerJs: string, css: string, darkCss: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>${inlineSafe(css, 'style')}</style>
<style>${inlineSafe(darkCss, 'style')}</style>
<style>
  :root { --bg: #ffffff; --fg: #1f2328; --bar: #f6f8fa; --line: #d0d7de; --muted: #59636e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #121212; --fg: #e6edf3; --bar: #151b23; --line: #3d444d; --muted: #9198a1; }
  }
  html, body { margin: 0; background: var(--bg); color: var(--fg);
               font: 14px/1.4 -apple-system, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
  header { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; padding: 8px 16px;
           background: var(--bar); border-bottom: 1px solid var(--line); }
  .name { font-weight: 600; }
  .note { color: var(--muted); font-size: 12px; }
  main { max-width: 900px; margin: 0 auto; padding: 18px 25px 64px; }
  #front { margin: 0 0 16px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted);
           font: 12px/1.5 ui-monospace, "Cascadia Code", Consolas, monospace; white-space: pre-wrap; }
  #doc .toastui-editor-contents { font-size: 14px; }
</style>
</head>
<body>
<header>
  <span class="name">${escapeHtml(name)}</span>
  <span class="note">Read-only. To edit in md-view, install Node.js (nodejs.org).</span>
</header>
<main>
  <pre id="front" hidden></pre>
  <div id="doc"></div>
</main>
<script id="md" type="application/json">${JSON.stringify(markdown).replace(/</g, '\\u003c')}</script>
<script>${inlineSafe(viewerJs, 'script')}</script>
<script>
  const md = JSON.parse(document.getElementById('md').textContent);
  const front = /^---\\r?\\n([\\s\\S]*?)\\r?\\n---(\\r?\\n|$)/.exec(md);
  if (front) { document.getElementById('front').textContent = front[1]; document.getElementById('front').hidden = false; }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.getElementById('doc').classList.add('toastui-editor-dark');
  toastui.Editor.factory({
    el: document.getElementById('doc'), viewer: true, usageStatistics: false, theme: dark ? 'dark' : 'light',
    initialValue: front ? md.slice(front[0].length) : md,
  });
</script>
</body>
</html>
`
