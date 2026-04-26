chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Relay these message types straight through to the active tab's content script
const RELAY_TO_CONTENT = new Set(['GET_JOB_ELEMENTS', 'FILL_FORM', 'FILL_AND_SUBMIT', 'CLICK_BUTTON'])

// Track which tab we navigated so we know when it finishes loading
let watchedTabId: number | null = null
let watchedOpenerTabId: number | null = null

// If "Apply now" opens a new tab, start watching that tab instead
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId != null && tab.openerTabId === watchedOpenerTabId && tab.id != null) {
    console.log(`[BG] New tab ${tab.id} opened from watched tab ${tab.openerTabId} — switching watch`)
    watchedTabId = tab.id
    watchedOpenerTabId = null
    // Focus new tab so the side panel stays associated with it
    chrome.tabs.update(tab.id, { active: true })
  }
})

// When the watched tab finishes loading, tell the side panel to re-analyze
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === watchedTabId && changeInfo.status === 'complete') {
    console.log(`[BG] Tab ${tabId} finished loading — sending TAB_READY`)
    watchedTabId = null
    // Small delay so the declarative content script has time to initialize
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'TAB_READY' }, () => {
        // Suppress "no listener" error if side panel isn't open
        void chrome.runtime.lastError
      })
    }, 800)
  }
})

function sendToContentScript(
  tabId: number,
  message: unknown,
  sendResponse: (r: unknown) => void,
) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (!chrome.runtime.lastError) {
      sendResponse(response)
      return
    }

    const err = chrome.runtime.lastError.message ?? 'Unknown error'
    if (!err.includes('Receiving end does not exist')) {
      console.error(`[BG] Content script error: ${err}`)
      sendResponse({ error: err })
      return
    }

    // Content script not present — auto-inject from manifest
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
      console.log('[BG] Injected — retrying...')
      chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message ?? 'Retry failed' })
          return
        }
        sendResponse(retryResponse)
      })
    })
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message.type as string

  if (RELAY_TO_CONTENT.has(type)) {
    console.log(`[BG] Received: ${type}`)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      const tabId = tab?.id
      if (!tabId) {
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
    console.log(`[BG] NAVIGATE → ${url}`)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId && url) {
        watchedTabId = tabId
        watchedOpenerTabId = null
        chrome.tabs.update(tabId, { url })
        console.log(`[BG] Tab ${tabId} navigating, now watching for load...`)
      }
      sendResponse({})
    })
    return true
  }

  if (type === 'WATCH_FOR_NEW_TAB') {
    // Side panel tells us a click may open a new tab — watch for it
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId) {
        watchedOpenerTabId = tabId
        watchedTabId = null
        console.log(`[BG] Watching tab ${tabId} for child tab creation`)
      }
      sendResponse({})
    })
    return true
  }
})
