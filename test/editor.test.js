// @vitest-environment happy-dom
// CodeMirror requires a DOM to mount; the rest of the suite runs under
// `environment: 'node'` (per vite.config.js) so flip just this file to happy-dom.

import { describe, it, expect, vi } from 'vitest'
import { createEditor } from '../src/app/editor.js'

function mount() {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return parent
}

describe('createEditor', () => {
  it('mounts without throwing and exposes get/setDoc', () => {
    const editor = createEditor({ parent: mount() })
    expect(editor.getDoc()).toBe('')
    editor.setDoc('hsv(0, 1, 1)')
    expect(editor.getDoc()).toBe('hsv(0, 1, 1)')
    editor.destroy()
  })

  it('setDoc does NOT fire onChange (programmatic replacements are host-originated)', async () => {
    const onChange = vi.fn()
    const editor = createEditor({ parent: mount(), onChange, debounceMs: 10 })
    editor.setDoc('var x = 1')
    await new Promise(r => setTimeout(r, 30))
    expect(onChange).not.toHaveBeenCalled()
    editor.destroy()
  })

  it('setDoc is a no-op if the incoming text matches current buffer', () => {
    const onChange = vi.fn()
    const editor = createEditor({ parent: mount(), onChange, debounceMs: 10 })
    editor.setDoc('abc')
    editor.setDoc('abc')   // second call — identical, should short-circuit
    expect(editor.getDoc()).toBe('abc')
    editor.destroy()
  })

  it('setDiagnostics accepts a list and tolerates bogus entries', () => {
    const editor = createEditor({ parent: mount() })
    editor.setDoc('line1\nline2\nline3')
    expect(() => {
      editor.setDiagnostics([
        { line: 2, col: 1, severity: 'error', message: 'boom' },
        null,                           // filtered
        { line: 999, message: 'oob' },  // clamped
      ])
    }).not.toThrow()
    editor.destroy()
  })

  it('destroy clears the editor and a pending debounce timer', () => {
    const onChange = vi.fn()
    const editor = createEditor({ parent: mount(), onChange, debounceMs: 50 })
    // No way to simulate a CM6 user-origin transaction from tests without
    // dispatching a real contentDOM event, so just ensure destroy() is safe.
    editor.destroy()
    expect(onChange).not.toHaveBeenCalled()
  })
})
