// Puts a Markdown file's own style back on what the visual editor saves.
//
// Toast UI writes Markdown its own way: "*" bullets, 4-space list nesting,
// "***" rules and [url](url) for <url>. Those render the same but make every
// save rewrite lines nobody touched. restoreStyle(saved, original) takes the
// editor's output and the body as it was loaded, and keeps the original's
// choices. Lines inside code fences are never changed, except to move a fence
// nested in a list along with its list item.
(function (g) {
  const FENCE = /^(\s*)(```+|~~~+)/;
  const ITEM = /^( *)([-*+]|\d+[.)]) /;
  const RULE = /^ {0,3}([-*_])( *\1){2,} *$/;

  // Each line with whether it is inside a fence, and whether it opens one.
  const scan = text => {
    const lines = [];
    let fence = null;
    for (const line of text.split('\n')) {
      const m = FENCE.exec(line);
      if (fence === null && m) {
        fence = m[2][0];
        lines.push({ line, fenced: true, opens: true });
      } else if (fence !== null) {
        lines.push({ line, fenced: true, opens: false });
        if (m && m[2][0] === fence && line.trim().replace(/[`~]/g, '') === '') fence = null;
      } else {
        lines.push({ line, fenced: false, opens: false });
      }
    }
    return lines;
  };

  const restoreBullets = (text, original) => {
    const dash = (original.match(/^\s*- /gm) || []).length;
    const star = (original.match(/^\s*\* /gm) || []).length;
    if (star > dash) return text;
    return scan(text).map(l => (l.fenced ? l.line : l.line.replace(/^(\s*)\* /, '$1- '))).join('\n');
  };

  // The editor nests lists by 4 spaces. When the original nested otherwise,
  // re-indent each level to its parent item's content column ("- " is 2 wide,
  // "1. " is 3), the CommonMark-aligned style.
  const restoreListIndent = (text, original) => {
    const nested = scan(original)
      .filter(l => !l.fenced)
      .map(l => ITEM.exec(l.line))
      .filter(m => m && m[1].length > 0)
      .map(m => m[1].length);
    if (!nested.length || nested.every(n => n % 4 === 0)) return text;

    let stack = [];
    let fenceDelta = 0;
    const shift = (line, delta) =>
      delta >= 0 ? ' '.repeat(delta) + line : line.replace(new RegExp(`^ {0,${-delta}}`), '');

    // Where a line indented `indent` (a multiple of 4 deep, plus extra) belongs.
    const contentColumn = indent => {
      const level = Math.floor(indent / 4);
      if (level < 1 || level > stack.length) return null;
      const parent = stack[level - 1];
      return parent.indent + parent.width + (indent - level * 4);
    };

    return scan(text).map(({ line, fenced, opens }) => {
      const indent = line.length - line.trimStart().length;

      if (fenced && !opens) return shift(line, fenceDelta);
      if (opens) {
        const column = indent > 0 && stack.length ? contentColumn(indent) : null;
        fenceDelta = column === null ? 0 : column - indent;
        return shift(line, fenceDelta);
      }
      if (line.trim() === '') return line;

      const item = ITEM.exec(line);
      if (item) {
        const level = indent / 4;
        if (!Number.isInteger(level) || level > stack.length) return line;
        stack = stack.slice(0, level);
        const column = level === 0 ? 0 : stack[level - 1].indent + stack[level - 1].width;
        stack.push({ indent: column, width: item[2].length + 1 });
        return ' '.repeat(column) + line.slice(indent);
      }
      if (indent === 0) {
        stack = [];
        return line;
      }
      const column = stack.length ? contentColumn(indent) : null;
      return column === null ? line : ' '.repeat(column) + line.slice(indent);
    }).join('\n');
  };

  // The editor writes every rule as "***"; use the original's first rule marker.
  const restoreRules = (text, original) => {
    const lines = scan(original);
    const rule = lines.find((l, i) => !l.fenced && RULE.test(l.line) && (i === 0 || lines[i - 1].line.trim() === ''));
    if (!rule) return text;
    const marker = rule.line.trim();
    const out = scan(text);
    return out
      .map((l, i) => (!l.fenced && l.line === '***' && (i === 0 || out[i - 1].line.trim() === '') ? marker : l.line))
      .join('\n');
  };

  // The editor turns <url> into [url](url); put back the ones written as <url>.
  const restoreAutolinks = (text, original) => {
    const urls = new Set([...original.matchAll(/<((?:https?|mailto):[^\s<>]+)>/g)].map(m => m[1]));
    if (!urls.size) return text;
    return scan(text)
      .map(l => (l.fenced ? l.line : l.line.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
        (all, label, href) => (label === href && urls.has(href) ? `<${href}>` : all))))
      .join('\n');
  };

  const restoreStyle = (saved, original) => {
    const source = original.replace(/\r\n/g, '\n');
    let text = saved.replace(/\r\n/g, '\n');
    text = restoreBullets(text, source);
    text = restoreListIndent(text, source);
    text = restoreRules(text, source);
    text = restoreAutolinks(text, source);
    return text;
  };

  g.mdRestore = { restoreStyle };
})(typeof window !== 'undefined' ? window : globalThis);
