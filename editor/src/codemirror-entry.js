// The Text view's editor for md-view: CodeMirror 6 with Markdown highlighting
// in VS Code's Dark+ and Light+ colours. Exposed as window.mdCode.create().
import { Annotation, EditorState, Prec } from '@codemirror/state'
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  HighlightStyle, LanguageDescription, LanguageSupport, StreamLanguage, syntaxHighlighting, indentUnit,
} from '@codemirror/language'
import { Tag, styleTags, tags as t } from '@lezer/highlight'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { yaml, yamlFrontmatter } from '@codemirror/lang-yaml'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { python } from '@codemirror/lang-python'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'

const codeLanguages = [
  LanguageDescription.of({ name: 'JavaScript', alias: ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'typescript'],
    support: javascript({ jsx: true, typescript: true }) }),
  LanguageDescription.of({ name: 'JSON', alias: ['jsonc', 'json5'], support: json() }),
  LanguageDescription.of({ name: 'CSS', alias: ['scss', 'less'], support: css() }),
  LanguageDescription.of({ name: 'HTML', alias: ['htm', 'xml', 'svg'], support: html() }),
  LanguageDescription.of({ name: 'Python', alias: ['py'], support: python() }),
  LanguageDescription.of({ name: 'YAML', alias: ['yml'], support: yaml() }),
  LanguageDescription.of({ name: 'Shell', alias: ['sh', 'bash', 'zsh', 'console', 'shellscript'],
    support: new LanguageSupport(StreamLanguage.define(shell)) }),
  LanguageDescription.of({ name: 'PowerShell', alias: ['ps1', 'pwsh', 'powershell'],
    support: new LanguageSupport(StreamLanguage.define(powerShell)) }),
]

// As in VS Code: a list's marker is coloured, not its text, and a heading's
// # marks take the heading's colour.
const listMark = Tag.define()
const vscodeMarks = { props: [styleTags({ ListMark: listMark, HeaderMark: t.heading })] }

// VS Code's Dark+ / Light+ colours for Markdown and the code inside it.
const palette = dark => dark ? {
  heading: '#569cd6', link: '#4fc1ff', url: '#ce9178', code: '#ce9178', quote: '#6a9955', list: '#6796e6',
  mark: '#808080', keyword: '#569cd6', control: '#c586c0', string: '#ce9178', number: '#b5cea8',
  comment: '#6a9955', fn: '#dcdcaa', variable: '#9cdcfe', property: '#9cdcfe', type: '#4ec9b0',
  tag: '#569cd6', attr: '#9cdcfe', invalid: '#f44747',
} : {
  heading: '#800000', link: '#0070c1', url: '#a31515', code: '#800000', quote: '#008000', list: '#0451a5',
  mark: '#808080', keyword: '#0000ff', control: '#af00db', string: '#a31515', number: '#098658',
  comment: '#008000', fn: '#795e26', variable: '#001080', property: '#0451a5', type: '#267f99',
  tag: '#800000', attr: '#e50000', invalid: '#cd3131',
}

const highlightStyle = dark => {
  const c = palette(dark)
  return HighlightStyle.define([
    { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: c.heading, fontWeight: 'bold' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, color: c.link },
    { tag: t.url, color: c.url, textDecoration: 'underline' },
    { tag: t.monospace, color: c.code },
    { tag: t.quote, color: c.quote },
    { tag: listMark, color: c.list },
    { tag: [t.processingInstruction, t.contentSeparator, t.meta, t.labelName], color: c.mark },
    { tag: [t.keyword, t.bool, t.null, t.atom, t.self], color: c.keyword },
    { tag: [t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: c.control },
    { tag: [t.string, t.special(t.string), t.regexp, t.character], color: c.string },
    { tag: [t.number, t.integer, t.float, t.unit], color: c.number },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: c.comment, fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: c.fn },
    { tag: [t.variableName, t.definition(t.variableName)], color: c.variable },
    { tag: [t.propertyName, t.definition(t.propertyName)], color: c.property },
    { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName)], color: c.type },
    { tag: t.tagName, color: c.tag },
    { tag: t.attributeName, color: c.attr },
    { tag: [t.angleBracket, t.punctuation, t.bracket], color: c.mark },
    { tag: t.invalid, color: c.invalid },
  ])
}

const baseTheme = dark => EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--fg)', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace', lineHeight: '1.5', fontVariantLigatures: 'none',
  },
  '.cm-content': { padding: '12px 0', caretColor: dark ? '#aeafad' : '#000' },
  '.cm-line': { padding: '0 24px 0 12px' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: dark ? '#6e7681' : '#999', border: 'none', paddingLeft: '8px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: dark ? '#c6c6c6' : '#0b216f' },
  '.cm-activeLine': { backgroundColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)' },
  '.cm-cursor': { borderLeftColor: dark ? '#aeafad' : '#000' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: dark ? '#264f78 !important' : '#add6ff !important',
  },
}, { dark })

const external = Annotation.define()

window.mdCode = {
  create(parent, { doc = '', dark = false, onChange = () => {}, onSave = () => {} } = {}) {
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(),
          EditorView.lineWrapping, indentUnit.of('  '), EditorState.tabSize.of(4),
          Prec.highest(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { onSave(); return true } }])),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          yamlFrontmatter({ content: markdown({ base: markdownLanguage, codeLanguages, extensions: [vscodeMarks] }) }),
          syntaxHighlighting(highlightStyle(dark)),
          baseTheme(dark),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !update.transactions.some(tr => tr.annotation(external))) onChange()
          }),
        ],
      }),
    })

    return {
      getValue: () => view.state.doc.toString(),
      // Replaces the text without counting as an edit (a load or a save).
      setValue: text => view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: external.of(true),
      }),
      focus: () => view.focus(),
      refresh: () => view.requestMeasure(),
    }
  },
}
