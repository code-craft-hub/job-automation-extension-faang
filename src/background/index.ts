chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const RELAY_TO_CONTENT = new Set(['GET_JOB_ELEMENTS', 'FILL_FORM'])

function sendToContentScript(
  tabId: number,
  message: unknown,
  sendResponse: (r: unknown) => void,
) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    // Success path
    if (!chrome.runtime.lastError) {
      sendResponse(response)
      return
    }

    const err = chrome.runtime.lastError.message ?? 'Unknown error'

    // Any other error (not a missing content script)
    if (!err.includes('Receiving end does not exist')) {
      console.error(`[BG] Content script error: ${err}`)
      sendResponse({ error: err })
      return
    }

    // Content script not present — auto-inject from the manifest's declared files
    console.log('[BG] Content script missing — auto-injecting...')
    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? []
    console.log('[BG] Injecting:', files)

    chrome.scripting.executeScript({ target: { tabId }, files }, () => {
      if (chrome.runtime.lastError) {
        const injectErr = chrome.runtime.lastError.message ?? 'Injection failed'
        console.error(`[BG] Injection failed: ${injectErr}`)
        sendResponse({ error: `Cannot inject on this page: ${injectErr}` })
        return
      }

      console.log('[BG] Injected — retrying message...')
      chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
        if (chrome.runtime.lastError) {
          const retryErr = chrome.runtime.lastError.message ?? 'Retry failed'
          console.error(`[BG] Retry failed: ${retryErr}`)
          sendResponse({ error: retryErr })
          return
        }
        console.log('[BG] Retry succeeded')
        sendResponse(retryResponse)
      })
    })
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message.type as string

  if (RELAY_TO_CONTENT.has(type)) {
    console.log(`[BG] Received: ${type} — looking up active tab...`)

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      const tabId = tab?.id

      if (!tabId) {
        console.warn('[BG] No active tab found')
        sendResponse({ error: 'No active tab found' })
        return
      }

      console.log(`[BG] Active tab: id=${tabId}, url=${tab.url ?? 'unknown'}`)
      sendToContentScript(tabId, message, sendResponse)
    })

    return true
  }

  if (type === 'NAVIGATE') {
    const url = message.url as string
    console.log(`[BG] Received: NAVIGATE → ${url}`)

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId && url) {
        console.log(`[BG] Updating tab ${tabId} to ${url}`)
        chrome.tabs.update(tabId, { url })
      } else {
        console.warn(`[BG] NAVIGATE failed: tabId=${tabId}, url=${url}`)
      }
      sendResponse({})
    })

    return true
  }
})
