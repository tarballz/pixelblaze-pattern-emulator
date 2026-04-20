// CodeMirror 6 wrapper for pb_emu.
//
// Responsibilities:
// - Host the EditorView in a provided DOM node.
// - Debounce user edits and pipe them back through onChange(source).
// - Allow the host to swap the buffer (external pattern load) without
//   firing onChange — otherwise every path/drop/recents load would re-enter
//   the editor-driven reload path and duplicate work.
// - Expose setDiagnostics({line, message, severity}[]) for inline lint /
//   runtime error markers. The linter callback reads a mutable array so
//   forceLinting can flush on host-driven updates.

import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { Annotation } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { linter, lintGutter, forceLinting } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import { indentWithTab } from '@codemirror/commands'

// Annotation applied to programmatic doc replacements so the change listener
// can distinguish them from user typing.
const fromHost = Annotation.define()

export function createEditor({ parent, onChange, onSave, debounceMs = 200 }) {
  let diagnostics = []
  let debounceTimer = null

  const changeHandler = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return
    // Ignore programmatic replacements (host load, external file watcher).
    if (update.transactions.some(tr => tr.annotation(fromHost))) return
    // Any user edit invalidates previously-reported runtime/rebuild diagnostics:
    // their line/col was frozen against the prior doc, so they'd paint at the
    // wrong position until the debounced onChange → rebuild refreshes them.
    // Clear synchronously; rebuild will repopulate within the debounce window
    // if the error is still real.
    if (diagnostics.length) {
      diagnostics = []
      forceLinting(view)
    }
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      onChange?.(view.state.doc.toString())
    }, debounceMs)
  })

  const view = new EditorView({
    parent,
    doc: '',
    extensions: [
      basicSetup,
      javascript(),
      oneDark,
      lintGutter(),
      linter(() => diagnostics.map(toDiagnostic).filter(Boolean), { delay: 0 }),
      keymap.of([
        indentWithTab,
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onSave?.(view.state.doc.toString())
            return true
          }
        }
      ]),
      changeHandler
    ]
  })

  // Convert {line, col?, endLine?, endCol?, message, severity} → CM6 Diagnostic.
  // Line / col are 1-based in the input (matches Error.stack conventions).
  function toDiagnostic(d) {
    if (!d || !d.message) return null
    const doc = view.state.doc
    const line = clamp(d.line ?? 1, 1, doc.lines)
    const lineObj = doc.line(line)
    const from = d.col != null ? Math.min(lineObj.from + Math.max(0, d.col - 1), lineObj.to) : lineObj.from
    const endLine = d.endLine != null ? clamp(d.endLine, 1, doc.lines) : line
    const endLineObj = doc.line(endLine)
    const to = d.endCol != null ? Math.min(endLineObj.from + Math.max(0, d.endCol - 1), endLineObj.to) : endLineObj.to
    return {
      from,
      to: Math.max(to, from + 1),
      severity: d.severity || 'error',
      message: d.message
    }
  }

  return {
    setDoc(source) {
      const text = source ?? ''
      if (text === view.state.doc.toString()) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: fromHost.of(true)
      })
    },
    getDoc() { return view.state.doc.toString() },
    setDiagnostics(next) {
      diagnostics = Array.isArray(next) ? next : []
      forceLinting(view)
    },
    focus() { view.focus() },
    destroy() { clearTimeout(debounceTimer); view.destroy() }
  }
}

function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n }
