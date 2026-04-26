chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const RELAY_TO_CONTENT = new Set(['GET_JOB_ELEMENTS', 'FILL_FORM'])

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
      console.log(`[BG] Forwarding ${type} to content script...`)

      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          const err = chrome.runtime.lastError.message ?? 'Unknown error'
          console.error(`[BG] Content script error: ${err}`)
          sendResponse({ error: err })
          return
        }
        console.log(`[BG] Content script replied for ${type}`)
        sendResponse(response)
      })
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
