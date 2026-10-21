# Third-party notices

md-preview bundles the following libraries. Each keeps its own licence.

| Library | Version | Licence | Where |
|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 12.0.2 | MIT | `hooks/vendor/marked.js`, licence in `hooks/vendor/marked-LICENSE.md` |
| [Toast UI Editor](https://github.com/nhn/tui.editor) | 3.2.2 | MIT | `editor/assets/toastui-editor-all.min.js` and its CSS |
| [ProseMirror](https://prosemirror.net) (commands, history, inputrules, keymap, model, state, transform, view) | 1.x | MIT | bundled into `toastui-editor-all.min.js` |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 2.5.9 | MPL-2.0 or Apache-2.0 | bundled into `toastui-editor-all.min.js` |
| orderedmap 2.1.1, rope-sequence 1.3.4, w3c-keyname 2.2.8 | — | MIT | bundled into `toastui-editor-all.min.js` |

`toastui-editor-all.min.js` was built with esbuild from `@toast-ui/editor@3.2.2` and its dependencies. The licence comments of the bundled packages are kept at the end of that file.
