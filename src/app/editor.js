// CodeMirror 6 wrapper for pb_emu.
//
// Responsibilities:
// - Host the EditorView in a provided DOM node.
// - Debounce user edits and pipe them back through onChange(source).
// - Allow the host to swap the buffer (external pattern load) without
//   firing onChange — otherwise every path/drop/recents load would re-enter
//   the editor-driven reload path and duplicate work.
// - Expose setLintDiagnostics / setRuntimeDiagnostic for inline markers.
//   Two channels: lint findings (persistent until the next call replaces
//   them) and a single runtime error marker (dropped on any user keystroke
//   because its position is frozen against the prior doc). Diagnostics are
//   committed via @codemirror/lint's setDiagnostics transaction spec, which
//   is synchronous — no linter-callback indirection, so host updates show up
//   on the next dispatch tick without waiting for a scheduled lint run.

import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { Annotation } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import { indentWithTab } from '@codemirror/commands'

// Annotation applied to programmatic doc replacements so the change listener
// can distinguish them from user typing.
const fromHost = Annotation.define()

export function createEditor({ parent, onChange, onSave, debounceMs = 200 }) {
  let lintDiags = []
  let runtimeDiag = null
  let debounceTimer = null

  const changeHandler = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return
    if (update.transactions.some(tr => tr.annotation(fromHost))) return
    if (runtimeDiag) {
      runtimeDiag = null
      commit()
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

  function commit() {
    const all = runtimeDiag ? [...lintDiags, runtimeDiag] : lintDiags
    const diags = all.map(toDiagnostic).filter(Boolean)
    view.dispatch(setDiagnostics(view.state, diags))
  }

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
    setLintDiagnostics(next) {
      lintDiags = Array.isArray(next) ? next : []
      commit()
    },
    setRuntimeDiagnostic(next) {
      runtimeDiag = next || null
      commit()
    },
    focus() { view.focus() },
    destroy() { clearTimeout(debounceTimer); view.destroy() }
  }
}

function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n }
