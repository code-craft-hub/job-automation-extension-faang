chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Messages that need to be forwarded to the active tab's content script
const RELAY_TO_CONTENT = new Set(['GET_JOB_ELEMENTS', 'FILL_FORM'])

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (RELAY_TO_CONTENT.has(message.type)) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) {
        sendResponse({ error: 'No active tab found' })
        return
      }
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message })
          return
        }
        sendResponse(response)
      })
    })
    return true
  }

  if (message.type === 'NAVIGATE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId && message.url) chrome.tabs.update(tabId, { url: message.url as string })
      sendResponse({})
    })
    return true
  }
})
