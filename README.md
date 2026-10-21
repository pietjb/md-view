# md-preview

A Claude Code plugin for reading and editing Markdown files as formatted documents, right inside Claude Desktop's browser pane.

## Commands

| Command | What it does |
|---|---|
| `/md-preview <file.md>` | Renders the file as a styled HTML page and opens it in the browser pane, with a contents sidebar and light/dark mode. |
| `/md-html <file.md>` | Opens the same page in your default browser. |
| `/md-edit <file.md>` | Opens an editor for the file in the browser pane. Saving writes back to the file. |
| `/md-edit stop` | Stops the editor's local server. |

With no file name, each command uses the last file you previewed.

## The editor

The editor has two views, switched in its header:

- **Text**: the whole file exactly as it is on disk, front matter included. It saves exactly what you type.
- **Markdown**: a visual editor. It opens **locked** (view only) every time you switch to it; click the lock to edit.

When saving from the Markdown view, the editor keeps the file's own style: bullet character, list indentation, horizontal-rule marker, `<url>` autolinks and Windows line endings. YAML front matter is edited in its own box and saved back exactly. A few things don't survive a visual edit: raw HTML tags are dropped, and table column padding is removed. Use the Text view when exact formatting matters.

Other details:
- If the file changes on disk while it's open, the editor reloads it, or warns you if you have unsaved edits.
- Save with **Ctrl+S**.
- The editor runs a small local server, which needs [Node.js](https://nodejs.org). It listens only on `127.0.0.1` and can write only the file it was opened for.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install md-preview --marketplace pietjb/md-view
```

Answer `y` to add the marketplace, then choose a scope.

From a shell:

```bash
claude plugin install md-preview --marketplace pietjb/md-view
```

In the Claude Desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `pietjb/md-view`, then **Add plugin**.

## Requirements

- Claude Code with plugin support. The browser-pane commands need Claude Desktop; elsewhere they fall back to your default browser.
- Node.js on your `PATH`, for `/md-edit`.

## Licence

MIT, see [LICENSE](LICENSE). Bundled third-party libraries keep their own licences, listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
