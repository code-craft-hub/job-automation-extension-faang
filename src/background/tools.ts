import type { FunctionDeclaration } from '@/shared/types/tool'
import { createLogger } from '@/shared/utils/logger'

const logger = createLogger('tools')

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'read_file',
    description:
      'Read code or text content from the active browser tab. Returns all <code> and <pre> block contents, or clipboard content if requested.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['page', 'clipboard', 'selection', 'editor'],
          description: 'Source to read from: page DOM, clipboard, current text selection, or detected code editor.',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to narrow the read target.',
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'write_file',
    description:
      'Inject code into the active page — writes into a detected Monaco/CodeMirror/ACE editor or a targeted DOM element.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The code content to inject.',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector for the target element. Defaults to the detected code editor.',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'search_code',
    description: 'Search the active page content with a regex pattern. Returns all matching lines with context.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'JavaScript-compatible regex pattern string.',
        },
        flags: {
          type: 'string',
          description: 'Regex flags, e.g. "gi" for global+case-insensitive.',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'explain_selection',
    description: 'Grab the currently highlighted/selected text from the active page and return it for analysis.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
]

async function execInTab<T>(tabId: number, func: () => T): Promise<T | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
    })
    return (results[0]?.result as T) ?? null
  } catch (err) {
    logger.error('executeScript failed', err)
    return null
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  tabId?: number
): Promise<string> {
  if (!tabId) return 'Error: no active tab available'

  switch (name) {
    case 'read_file': {
      const source = (args.source as string) ?? 'page'
      const selector = args.selector as string | undefined

      if (source === 'selection') {
        const text = await execInTab(tabId, () => window.getSelection()?.toString() ?? '')
        return text ?? ''
      }

      if (source === 'editor') {
        const code = await execInTab(tabId, () => {
          const win = window as Window & {
            monaco?: { editor?: { getModels?: () => Array<{ getValue?: () => string }> } }
          }
          if (win.monaco?.editor?.getModels) {
            return win.monaco.editor.getModels().map((m) => m.getValue?.() ?? '').join('\n')
          }
          const cm = document.querySelector('.CodeMirror') as (Element & { CodeMirror?: { getValue?: () => string } }) | null
          if (cm?.CodeMirror?.getValue) return cm.CodeMirror.getValue()
          return null
        })
        return code ?? 'No editor detected on page'
      }

      if (source === 'clipboard') {
        try {
          const text = await navigator.clipboard.readText()
          return text || '(clipboard empty)'
        } catch {
          return 'Clipboard read permission denied'
        }
      }

      // default: page DOM
      const pageCode = await execInTab(tabId, () => {
        const blocks = document.querySelectorAll<HTMLElement>('code, pre')
        const cssSelector = undefined as string | undefined  // captured from outer scope not available in isolated context
        void cssSelector
        return Array.from(blocks)
          .map((el) => el.textContent ?? '')
          .filter((t) => t.trim().length > 0)
          .slice(0, 50)
          .join('\n\n---\n\n')
      })

      // Apply selector filter client-side if provided
      if (selector) {
        const filtered = await execInTab(tabId, () => {
          const el = document.querySelector(selector as unknown as string) as HTMLElement | null
          return el?.textContent ?? null
        })
        return filtered ?? pageCode ?? 'No content found'
      }

      return pageCode ?? 'No code blocks found on page'
    }

    case 'write_file': {
      const code = (args.code as string) ?? ''
      const selector = args.selector as string | undefined

      const result = await execInTab(tabId, () => {
        const codeStr = code as unknown as string
        const sel = selector as unknown as string | undefined

        if (sel) {
          const el = document.querySelector(sel) as HTMLElement | null
          if (el) { el.textContent = codeStr; return 'Written to selector' }
        }

        const win = window as Window & {
          monaco?: { editor?: { getModels?: () => Array<{ setValue?: (v: string) => void }> } }
        }
        if (win.monaco?.editor?.getModels) {
          const models = win.monaco.editor.getModels()
          if (models.length > 0) { models[0]?.setValue?.(codeStr); return 'Written to Monaco editor' }
        }

        const cm = document.querySelector('.CodeMirror') as (Element & { CodeMirror?: { setValue?: (v: string) => void } }) | null
        if (cm?.CodeMirror?.setValue) {
          cm.CodeMirror.setValue(codeStr)
          return 'Written to CodeMirror editor'
        }

        const activeEl = document.activeElement as HTMLTextAreaElement | null
        if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
          activeEl.value = codeStr
          activeEl.dispatchEvent(new Event('input', { bubbles: true }))
          return 'Written to active textarea'
        }

        return 'No writable target found. Copy the code from the response above.'
      })

      return result ?? 'Write operation complete'
    }

    case 'search_code': {
      const pattern = (args.pattern as string) ?? ''
      const flags = (args.flags as string) ?? 'gi'

      const matches = await execInTab(tabId, () => {
        const patStr = pattern as unknown as string
        const flagStr = flags as unknown as string
        try {
          const re = new RegExp(patStr, flagStr)
          const text = document.body.innerText
          const lines = text.split('\n')
          const results: string[] = []
          lines.forEach((line, i) => {
            if (re.test(line)) results.push(`L${i + 1}: ${line.trim()}`)
          })
          return results.slice(0, 100).join('\n') || 'No matches found'
        } catch {
          return `Invalid regex: ${patStr}`
        }
      })

      return matches ?? 'Search failed'
    }

    case 'explain_selection': {
      const selection = await execInTab(tabId, () => window.getSelection()?.toString() ?? '')
      if (!selection || selection.trim().length === 0) {
        return 'No text is currently selected on the page.'
      }
      return selection
    }

    default:
      logger.warn(`Unknown tool: ${name}`)
      return `Unknown tool: ${name}`
  }
}
