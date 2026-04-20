import '@/assets/styles/globals.css'

export default function App() {
  const openSidePanel = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId) {
        chrome.sidePanel.open({ tabId })
        window.close()
      }
    })
  }

  const openOptions = () => {
    chrome.runtime.openOptionsPage()
    window.close()
  }

  return (
    <div className="w-64 bg-cp-bg text-cp-text font-sans p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-cp-accent font-bold font-mono text-lg">✦</span>
        <div>
          <h1 className="text-sm font-semibold text-cp-text">CodePilot AI</h1>
          <p className="text-[10px] text-cp-muted">Gemini-powered coding assistant</p>
        </div>
      </div>

      <button
        onClick={openSidePanel}
        className="w-full py-2 bg-cp-accent text-cp-bg text-sm font-semibold rounded-lg hover:bg-cp-accent-dim transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cp-accent"
      >
        Open Side Panel
      </button>

      <div className="flex gap-2">
        <button
          onClick={openOptions}
          className="flex-1 py-1.5 text-xs text-cp-muted border border-cp-border rounded-lg hover:text-cp-text hover:border-cp-accent transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
        >
          Settings
        </button>
        <button
          onClick={() => chrome.tabs.create({ url: 'https://aistudio.google.com/app/apikey' })}
          className="flex-1 py-1.5 text-xs text-cp-muted border border-cp-border rounded-lg hover:text-cp-text hover:border-cp-accent transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
        >
          Get API Key
        </button>
      </div>

      <p className="text-[10px] text-cp-muted text-center">
        Powered by Gemini 2.0 Flash
      </p>
    </div>
  )
}
