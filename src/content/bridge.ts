import { getPageCode, getSelection, getActiveEditorContent, injectCodeSuggestion } from './dom-reader'

export type BridgeRequest =
  | { type: 'GET_PAGE_CODE' }
  | { type: 'GET_SELECTION' }
  | { type: 'GET_EDITOR_CONTENT' }
  | { type: 'INJECT_CODE'; code: string; selector?: string }

export type BridgeResponse =
  | { type: 'PAGE_CODE'; content: string }
  | { type: 'SELECTION'; content: string }
  | { type: 'EDITOR_CONTENT'; content: string | null }
  | { type: 'INJECT_RESULT'; success: boolean }
  | { type: 'ERROR'; message: string }

export function setupBridge(): void {
  chrome.runtime.onMessage.addListener(
    (msg: BridgeRequest, _sender, sendResponse: (r: BridgeResponse) => void) => {
      switch (msg.type) {
        case 'GET_PAGE_CODE':
          sendResponse({ type: 'PAGE_CODE', content: getPageCode() })
          break
        case 'GET_SELECTION':
          sendResponse({ type: 'SELECTION', content: getSelection() })
          break
        case 'GET_EDITOR_CONTENT':
          sendResponse({ type: 'EDITOR_CONTENT', content: getActiveEditorContent() })
          break
        case 'INJECT_CODE': {
          const ok = injectCodeSuggestion(msg.code, msg.selector)
          sendResponse({ type: 'INJECT_RESULT', success: ok })
          break
        }
        default:
          return false
      }
      return true
    }
  )
}
