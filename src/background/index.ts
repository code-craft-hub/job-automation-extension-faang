chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Relay these message types straight through to the active tab's content script
const RELAY_TO_CONTENT = new Set(['GET_JOB_ELEMENTS', 'FILL_FORM', 'FILL_AND_SUBMIT', 'CLICK_BUTTON'])

// Tab we're watching for a load-complete event (fires TAB_READY to the side panel)
let watchedTabId: number | null = null
// Tab that might spawn a child tab from an "Apply now" click
let watchedOpenerTabId: number | null = null
// New tab that opened but whose URL we haven't seen yet — we'll redirect it once we do
let pendingNewTab: { newTabId: number; openerTabId: number } | null = null

// ── New-tab redirect ──────────────────────────────────────────────────────────
// Goal: keep the user in ONE tab at all times.
// When "Apply now" spawns a new tab, we grab its URL, navigate the original tab
// to that URL, and close the unwanted new tab immediately.
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId == null || tab.openerTabId !== watchedOpenerTabId || tab.id == null) return

  const newTabId     = tab.id
  const openerTabId  = tab.openerTabId
  watchedOpenerTabId = null

  // Keep watching the OPENER tab (not the new one) so TAB_READY fires on it
  watchedTabId = openerTabId

  // If the URL is already known (e.g. simple <a href> click), redirect immediately
  const url = (tab.url && tab.url !== 'about:blank') ? tab.url
            : (tab.pendingUrl && tab.pendingUrl !== 'about:blank') ? tab.pendingUrl
            : null

  if (url && !url.startsWith('chrome') && !url.startsWith('about')) {
    console.log(`[BG] New tab ${newTabId}: URL known immediately — redirecting opener ${openerTabId} → ${url}`)
    chrome.tabs.update(openerTabId, { url })
    chrome.tabs.remove(newTabId)
  } else {
    // URL not yet available (window.open, deferred navigation) — track the new tab
    console.log(`[BG] New tab ${newTabId} from ${openerTabId} — waiting for URL`)
    pendingNewTab = { newTabId, openerTabId }
    // Don't activate the new tab — user stays on the opener
  }
})

// When the watched tab OR a pending-redirect tab gets a URL / finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Pending new-tab redirect: grab the URL as soon as it appears, then close the new tab
  if (pendingNewTab && tabId === pendingNewTab.newTabId) {
    const url = changeInfo.url
    if (url && url !== 'about:blank' && !url.startsWith('chrome') && !url.startsWith('about')) {
      const { openerTabId } = pendingNewTab
      pendingNewTab = null
      console.log(`[BG] New tab ${tabId} got URL — redirecting opener ${openerTabId} → ${url}`)
      chrome.tabs.update(openerTabId, { url })
      chrome.tabs.remove(tabId)
      // watchedTabId is already openerTabId (set in onCreated); TAB_READY will fire when it loads
    }
    return
  }

  // Main watcher: when the tracked tab finishes loading, tell the side panel to re-analyze
  if (tabId === watchedTabId && changeInfo.status === 'complete') {
    console.log(`[BG] Tab ${tabId} finished loading — sending TAB_READY`)
    watchedTabId = null
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'TAB_READY' }, () => { void chrome.runtime.lastError })
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message.type as string

  if (RELAY_TO_CONTENT.has(type)) {
    console.log(`[BG] Received: ${type}`)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      const tabId = tab?.id
      if (!tabId) { sendResponse({ error: 'No active tab found' }); return }
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
        pendingNewTab = null
        chrome.tabs.update(tabId, { url })
        console.log(`[BG] Tab ${tabId} navigating, now watching for load...`)
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
        // Also watch the CURRENT tab: if the click navigates same-tab (no new tab
        // opened), TAB_READY still fires when loading completes.
        watchedTabId = tabId
        pendingNewTab = null
        console.log(`[BG] Watching tab ${tabId} — will redirect any child tab back here`)
      }
      sendResponse({})
    })
    return true
  }

  if (type === 'WATCH_CURRENT_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId) {
        watchedTabId = tabId
        watchedOpenerTabId = null
        console.log(`[BG] Watching current tab ${tabId} for reload`)
      }
      sendResponse({})
    })
    return true
  }
})
