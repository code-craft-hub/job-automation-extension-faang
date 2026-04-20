export function getPageCode(): string {
  const blocks = document.querySelectorAll<HTMLElement>('code, pre')
  return Array.from(blocks)
    .map((el) => el.textContent ?? '')
    .filter((t) => t.trim().length > 0)
    .slice(0, 50)
    .join('\n\n---\n\n')
}

export function getSelection(): string {
  return window.getSelection()?.toString() ?? ''
}

interface MonacoEditor {
  editor?: {
    getModels?: () => Array<{ getValue?: () => string; setValue?: (v: string) => void }>
  }
}

interface CodeMirrorElement extends HTMLElement {
  CodeMirror?: {
    getValue?: () => string
    setValue?: (v: string) => void
  }
}

export function getActiveEditorContent(): string | null {
  const win = window as Window & { monaco?: MonacoEditor }
  if (win.monaco?.editor?.getModels) {
    const models = win.monaco.editor.getModels()
    if (models.length > 0) {
      return models.map((m) => m.getValue?.() ?? '').join('\n')
    }
  }

  const cm = document.querySelector('.CodeMirror') as CodeMirrorElement | null
  if (cm?.CodeMirror?.getValue) {
    return cm.CodeMirror.getValue()
  }

  // ACE editor
  const aceEl = document.querySelector('.ace_editor') as HTMLElement | null
  if (aceEl) {
    const aceEditor = (window as unknown as Record<string, unknown>)['ace']
    if (aceEditor && typeof (aceEditor as Record<string, unknown>)['edit'] === 'function') {
      try {
        const editor = (aceEditor as { edit: (el: HTMLElement) => { getValue?: () => string } }).edit(aceEl)
        return editor.getValue?.() ?? null
      } catch {
        return null
      }
    }
  }

  return null
}

export function injectCodeSuggestion(code: string, targetSelector?: string): boolean {
  if (targetSelector) {
    const el = document.querySelector(targetSelector) as HTMLElement | null
    if (el) {
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        el.value = code
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }
      if (el.isContentEditable) {
        el.textContent = code
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }
    }
  }

  const win = window as Window & { monaco?: MonacoEditor }
  if (win.monaco?.editor?.getModels) {
    const models = win.monaco.editor.getModels()
    if (models.length > 0) {
      models[0]?.setValue?.(code)
      return true
    }
  }

  const cm = document.querySelector('.CodeMirror') as CodeMirrorElement | null
  if (cm?.CodeMirror?.setValue) {
    cm.CodeMirror.setValue(code)
    return true
  }

  const active = document.activeElement
  if (active instanceof HTMLTextAreaElement) {
    active.value = code
    active.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }

  return false
}
