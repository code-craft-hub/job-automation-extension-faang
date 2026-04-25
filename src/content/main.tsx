chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_ELEMENTS') {
    const elements = document.querySelectorAll('*')
    const counts: Record<string, number> = {}
    elements.forEach((el) => {
      const tag = el.tagName.toLowerCase()
      counts[tag] = (counts[tag] || 0) + 1
    })
    const tags = Object.entries(counts).sort((a, b) => b[1] - a[1])
    sendResponse({ total: elements.length, tags })
  }
  return true
})
