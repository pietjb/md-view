# md-view

A Claude Code plugin to view and edit Markdown files as formatted documents, right inside Claude Desktop's browser pane.

## Usage

```
/md-view <file.md>
```

Starts the viewer for the file and puts a request to open it in your prompt box, such as *"Open http://127.0.0.1:52344/ in the browser pane (md-view viewer for notes.md)"*. Press **Enter** to send it, and Claude opens the file in the browser pane as a formatted document, view only. The path can be absolute or relative to the session's folder.

Why the extra Enter: the plugin doesn't open the pane itself. In auto mode, Claude Code allows a tool call only when you asked for it, so the plugin drafts the request and you send it. Outside Claude Desktop, where there's no browser pane, the file opens in your default browser.

- `/md-view` with no file reopens the last file viewed.
- `/md-view stop` closes the viewer's local server.

## Viewing and editing

The page has two views, switched in its header:

- **Markdown** (the default): the formatted document. It opens **locked** for viewing; click the lock to edit it visually. It locks again each time you switch back to it.
- **Text**: the whole file exactly as it is on disk, front matter included. It saves exactly what you type.

Save with **Ctrl+S** or the **Save** button. Saving writes back to the file.

When you save from the Markdown view, the file keeps its own style: bullet character, list indentation, horizontal-rule marker, `<url>` autolinks and Windows line endings. YAML front matter is edited in its own box and saved back exactly. A visual edit can't keep everything, though: raw HTML tags are dropped, and table column padding is removed. Use the Text view when exact formatting matters.

If the file changes on disk while it's open, the page reloads it, or warns you if you have unsaved edits.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install md-view --marketplace pietjb/md-view
```

Answer `y` to add the marketplace, then choose a scope.

From a shell:

```bash
claude plugin install md-view --marketplace pietjb/md-view
```

In the Claude Desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `pietjb/md-view`, then **Add plugin**.

## Requirements

- Claude Code with plugin support. Outside Claude Desktop, the file opens in your default browser instead of the browser pane.
- [Node.js](https://nodejs.org) on your `PATH`. The page is served by a small local server that listens only on `127.0.0.1` and can write only the file it was opened for.

## Licence

MIT, see [LICENSE](LICENSE). Bundled third-party libraries keep their own licences, listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
