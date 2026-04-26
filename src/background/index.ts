chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Relay these message types to the active tab's content script
const RELAY_TO_CONTENT = new Set([
  'GET_JOB_ELEMENTS', 'FILL_FORM', 'FILL_AND_SUBMIT', 'CLICK_BUTTON', 'EXPAND_PROFILE_SECTIONS',
])

// Tab we're watching for a load-complete event → fires TAB_READY to the side panel
let watchedTabId: number | null = null
// Tab that might spawn a child tab from an "Apply now" click
let watchedOpenerTabId: number | null = null
// New tab whose URL isn't yet known — redirect the opener once we see it
let pendingNewTab: { newTabId: number; openerTabId: number } | null = null

// ── New-tab redirect ──────────────────────────────────────────────────────────
// When an "Apply now" button spawns a popup, grab its URL, navigate the current
// tab there, and close the popup — no extra tabs ever appear.
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId == null || tab.openerTabId !== watchedOpenerTabId || tab.id == null) return

  const newTabId    = tab.id
  const openerTabId = tab.openerTabId
  watchedOpenerTabId = null
  watchedTabId = openerTabId   // keep watching the original tab

  const url = (tab.url && tab.url !== 'about:blank') ? tab.url
            : (tab.pendingUrl && tab.pendingUrl !== 'about:blank') ? tab.pendingUrl
            : null

  if (url && !url.startsWith('chrome') && !url.startsWith('about')) {
    console.log(`[BG] Popup ${newTabId}: redirecting tab ${openerTabId} → ${url}`)
    chrome.tabs.update(openerTabId, { url })
    chrome.tabs.remove(newTabId)
  } else {
    console.log(`[BG] Popup ${newTabId} — waiting for URL`)
    pendingNewTab = { newTabId, openerTabId }
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Pending popup: grab URL as soon as available, then close it
  if (pendingNewTab && tabId === pendingNewTab.newTabId) {
    const url = changeInfo.url
    if (url && url !== 'about:blank' && !url.startsWith('chrome') && !url.startsWith('about')) {
      const { openerTabId } = pendingNewTab
      pendingNewTab = null
      console.log(`[BG] Popup ${tabId} got URL — redirecting tab ${openerTabId} → ${url}`)
      chrome.tabs.update(openerTabId, { url })
      chrome.tabs.remove(tabId)
    }
    return
  }

  // Tracked tab finished loading → tell side panel to re-analyze the page
  if (tabId === watchedTabId && changeInfo.status === 'complete') {
    console.log(`[BG] Tab ${tabId} loaded — sending TAB_READY`)
    watchedTabId = null
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'TAB_READY' }, () => { void chrome.runtime.lastError })
    }, 800)
  }
})

// ── Content-script relay ──────────────────────────────────────────────────────
function sendToContentScript(
  tabId: number,
  message: unknown,
  sendResponse: (r: unknown) => void,
) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (!chrome.runtime.lastError) { sendResponse(response); return }

    const err = chrome.runtime.lastError.message ?? 'Unknown error'
    if (!err.includes('Receiving end does not exist')) {
      console.error(`[BG] Content script error: ${err}`)
      sendResponse({ error: err })
      return
    }

    // Content script not present — auto-inject from manifest
    console.log('[BG] Auto-injecting content script...')
    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? []
    chrome.scripting.executeScript({ target: { tabId }, files }, () => {
      if (chrome.runtime.lastError) {
        const injectErr = chrome.runtime.lastError.message ?? 'Injection failed'
        console.error(`[BG] Injection failed: ${injectErr}`)
        sendResponse({ error: `Cannot inject on this page: ${injectErr}` })
        return
      }
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

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message.type as string

  // Relay form-automation commands to the active tab's content script
  if (RELAY_TO_CONTENT.has(type)) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) { sendResponse({ error: 'No active tab found' }); return }
      console.log(`[BG] Relay ${type} → tab ${tabId}`)
      sendToContentScript(tabId, message, sendResponse)
    })
    return true
  }

  if (type === 'NAVIGATE') {
    const url = message.url as string
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId && url) {
        watchedTabId       = tabId
        watchedOpenerTabId = null
        pendingNewTab      = null
        chrome.tabs.update(tabId, { url })
        console.log(`[BG] NAVIGATE tab ${tabId} → ${url}`)
      }
      sendResponse({})
    })
    return true
  }

  if (type === 'WATCH_FOR_NEW_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId) {
        watchedOpenerTabId = tabId
        watchedTabId       = tabId
        pendingNewTab      = null
        console.log(`[BG] Watching tab ${tabId} for popup child`)
      }
      sendResponse({})
    })
    return true
  }

  if (type === 'WATCH_CURRENT_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId) {
        watchedTabId       = tabId
        watchedOpenerTabId = null
        console.log(`[BG] Watching tab ${tabId} for reload`)
      }
      sendResponse({})
    })
    return true
  }

  if (type === 'OPEN_SIDE_PANEL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id || tab.windowId == null) { sendResponse({}); return }

      const tabId    = tab.id
      const windowId = tab.windowId
      const jobUrl   = message.jobUrl as string | undefined

      // 1. Open the side panel
      chrome.sidePanel.open({ windowId }, () => {
        if (chrome.runtime.lastError) {
          console.error('[BG] sidePanel.open failed:', chrome.runtime.lastError.message)
        }

        // 2. Navigate the CURRENT tab to the job URL — no new tab is created
        if (jobUrl) {
          watchedTabId       = tabId
          watchedOpenerTabId = null
          pendingNewTab      = null
          chrome.tabs.update(tabId, { url: jobUrl })
          console.log(`[BG] Tab ${tabId} navigating to job → ${jobUrl}`)
        }

        // 3. Notify the side panel to start automation.
        //    1 200 ms gives a freshly-opened panel time to mount and load its API key.
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'START_AUTO_APPLY', ...message }, () => {
            void chrome.runtime.lastError
          })
        }, 1200)

        sendResponse({})
      })
    })
    return true
  }

  if (type === 'FOCUS_TAB') {
    // Nothing to do — user is already on the tab (we navigate it, not the sidepanel)
    sendResponse({})
    return true
  }
})
