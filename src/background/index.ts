chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_ELEMENTS') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) {
        sendResponse({ error: 'No active tab found' })
        return
      }
      chrome.tabs.sendMessage(tabId, { type: 'GET_ELEMENTS' }, (response) => {
        sendResponse(response)
      })
    })
    return true
  }
})
