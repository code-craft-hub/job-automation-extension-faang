import { useState } from 'react'
import { ChatWindow } from './components/ChatWindow'
import { InputBar } from './components/InputBar'
import { SessionTabs } from './components/SessionTabs'
import { FileTree } from './components/FileTree'
import { SettingsModal } from './components/SettingsModal'
import { StatusBar } from './components/StatusBar'
import { useChat } from './hooks/useChat'
import { useSession } from './hooks/useSession'
import { useSettings } from './hooks/useSettings'

interface FileItem {
  name: string
  content: string
  type: 'page' | 'clipboard' | 'selection'
}

export default function App() {
  const { messages, streamingText, isStreaming, error, sendMessage, cancel } = useChat()
  const { sessions, currentSessionId, createSession, switchSession, deleteSession } = useSession()
  const { settings, loaded: settingsLoaded } = useSettings()
  const [showSettings, setShowSettings] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<FileItem[]>([])
  const [lastUserMessage, setLastUserMessage] = useState('')

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  if (isDark) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }

  const handleSend = (content: string) => {
    let fullContent = content
    if (attachedFiles.length > 0) {
      const ctx = attachedFiles
        .map((f) => `\`\`\`\n// Attached: ${f.name}\n${f.content}\n\`\`\``)
        .join('\n\n')
      fullContent = `${ctx}\n\n${content}`
      setAttachedFiles([])
    }
    setLastUserMessage(fullContent)
    sendMessage(fullContent)
  }

  const handleRetry = () => {
    if (lastUserMessage) sendMessage(lastUserMessage)
  }

  const handleNewSession = () => {
    createSession()
    setAttachedFiles([])
  }

  return (
    <div className="flex flex-col h-screen bg-cp-bg text-cp-text font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-cp-surface border-b border-cp-border flex-shrink-0">
        <span className="text-cp-accent font-bold text-sm font-mono">✦ CodePilot</span>
        <button
          onClick={() => setShowSettings(true)}
          className="text-cp-muted hover:text-cp-text transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent rounded p-1 text-base"
          title="Settings"
          aria-label="Open settings"
        >
          ⚙
        </button>
      </div>

      {/* Session tabs */}
      <div className="flex-shrink-0">
        <SessionTabs
          sessions={sessions}
          currentId={currentSessionId}
          onSelect={switchSession}
          onNew={handleNewSession}
          onDelete={deleteSession}
        />
      </div>

      {/* Attached files */}
      <div className="flex-shrink-0">
        <FileTree
          files={attachedFiles}
          onRemove={(i) => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
        />
      </div>

      {/* Chat area — fills remaining height */}
      <ChatWindow
        messages={messages}
        streamingText={streamingText}
        isStreaming={isStreaming}
        error={error}
        onRetry={handleRetry}
        onExamplePrompt={handleSend}
      />

      {/* Input */}
      <div className="flex-shrink-0">
        <InputBar
          onSend={handleSend}
          onAttach={(f) => setAttachedFiles((prev) => [...prev, f])}
          isStreaming={isStreaming}
          onCancel={cancel}
        />
      </div>

      {/* Status bar */}
      <div className="flex-shrink-0">
        <StatusBar />
      </div>

      {/* API key banner — shown once settings have loaded and key is missing */}
      {settingsLoaded && !settings.apiKey && (
        <div className="fixed bottom-16 inset-x-0 mx-3 flex items-center justify-between gap-2 px-3 py-2 bg-cp-warn/10 border border-cp-warn/30 rounded-lg text-xs text-cp-warn z-40">
          <span>⚠ No API key — messages won't send</span>
          <button
            onClick={() => setShowSettings(true)}
            className="underline hover:text-cp-text transition-colors focus:outline-none"
          >
            Configure →
          </button>
        </div>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
