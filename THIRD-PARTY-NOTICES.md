# Third-party notices

md-view bundles the following libraries. Each keeps its own licence.

| Library | Version | Licence | Where |
|---|---|---|---|
| [Toast UI Editor](https://github.com/nhn/tui.editor) | 3.2.2 | MIT | `editor/assets/toastui-editor-all.min.js` and its CSS |
| [ProseMirror](https://prosemirror.net) (commands, history, inputrules, keymap, model, state, transform, view) | 1.x | MIT | bundled into `toastui-editor-all.min.js` |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 2.5.9 | MPL-2.0 or Apache-2.0 | bundled into `toastui-editor-all.min.js` |
| orderedmap 2.1.1, rope-sequence 1.3.4, w3c-keyname 2.2.8 | — | MIT | bundled into `toastui-editor-all.min.js` |
| [CodeMirror](https://codemirror.net) 6 (codemirror 6.0.1; @codemirror/view, state, language, commands, autocomplete, search, lint, lang-markdown, lang-yaml, lang-javascript, lang-json, lang-css, lang-html, lang-python, legacy-modes, streamparser) | 6.x | MIT | `editor/assets/codemirror-bundle.js` |
| [Lezer](https://lezer.codemirror.net) (common, lr, highlight, markdown, yaml, javascript, json, css, html, python) | 1.x | MIT | bundled into `codemirror-bundle.js` |
| style-mod 4.1.4, crelt 1.0.7, w3c-keyname 2.2.8, @marijn/find-cluster-break 1.0.4 | — | MIT | bundled into `codemirror-bundle.js` |

`toastui-editor-all.min.js` was built with esbuild from `@toast-ui/editor@3.2.2` and its dependencies. `codemirror-bundle.js` was built with esbuild from `editor/src/codemirror-entry.js` and the packages above. The licence comments of the bundled packages are kept at the end of each file.
