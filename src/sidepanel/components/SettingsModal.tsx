import { useState, useEffect } from 'react'
import { useSettings } from '../hooks/useSettings'
import { GEMINI_MODELS } from '@/shared/constants/models'

interface Props {
  onClose: () => void
}

export function SettingsModal({ onClose }: Props) {
  const { settings, save } = useSettings()
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [showKey, setShowKey] = useState(false)
  const [validating, setValidating] = useState(false)
  const [keyStatus, setKeyStatus] = useState<'idle' | 'valid' | 'invalid'>('idle')
  const [keyError, setKeyError] = useState('')
  const [model, setModel] = useState(settings.model)
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt)
  const [temperature, setTemperature] = useState(settings.temperature)
  const [maxTokens, setMaxTokens] = useState(settings.maxTokens)

  useEffect(() => {
    setApiKey(settings.apiKey)
    setModel(settings.model)
    setSystemPrompt(settings.systemPrompt)
    setTemperature(settings.temperature)
    setMaxTokens(settings.maxTokens)
  }, [settings])

  // Direct fetch — extension pages have host_permissions so no service worker needed
  const validateKey = async () => {
    if (!apiKey.trim()) return
    setValidating(true)
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`,
        { method: 'GET' }
      )
      if (resp.ok) {
        setKeyStatus('valid')
        setKeyError('')
      } else {
        let msg = `HTTP ${resp.status}`
        try {
          const body = await resp.json() as { error?: { message?: string } }
          msg = body?.error?.message ?? msg
        } catch { /* ignore */ }
        setKeyStatus('invalid')
        setKeyError(msg)
      }
    } catch (err) {
      setKeyStatus('invalid')
      setKeyError(`Network error — check your connection: ${String(err)}`)
    } finally {
      setValidating(false)
    }
  }

  const handleSave = () => {
    save({ apiKey, model, systemPrompt, temperature, maxTokens })
    onClose()
  }

  const handleClearAll = () => {
    if (confirm('Delete all conversation history? This cannot be undone.')) {
      chrome.runtime.sendMessage({ type: 'SESSION_CLEAR' })
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-cp-surface border border-cp-border rounded-xl shadow-2xl overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between px-4 py-3 border-b border-cp-border">
          <h2 className="text-sm font-semibold text-cp-text">Settings</h2>
          <button
            onClick={onClose}
            className="text-cp-muted hover:text-cp-text transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent rounded"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* API Key */}
          <div>
            <label className="block text-xs text-cp-muted mb-1">Gemini API Key</label>
            <div className="flex gap-1">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setKeyStatus('idle') }}
                  onBlur={validateKey}
                  placeholder="AIza…"
                  className="w-full bg-cp-bg border border-cp-border rounded px-2 py-1.5 text-xs font-mono text-cp-text placeholder-cp-muted focus:outline-none focus:border-cp-accent"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-cp-muted hover:text-cp-text text-[10px] focus:outline-none"
                >
                  {showKey ? 'hide' : 'show'}
                </button>
              </div>
              <button
                onClick={validateKey}
                disabled={validating || !apiKey.trim()}
                className="px-2 py-1 text-xs rounded border border-cp-border text-cp-muted hover:text-cp-text hover:border-cp-accent transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
              >
                {validating ? '…' : 'Test'}
              </button>
            </div>
            {keyStatus === 'valid' && <p className="mt-1 text-[11px] text-cp-accent">✓ API key is valid</p>}
            {keyStatus === 'invalid' && (
              <div className="mt-1 space-y-0.5">
                <p className="text-[11px] text-cp-error">✗ {keyError || 'Invalid API key'}</p>
                <p className="text-[10px] text-cp-muted">Need a key? Go to <span className="text-cp-info">aistudio.google.com/app/apikey</span> (free, no billing needed)</p>
              </div>
            )}
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs text-cp-muted mb-1">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-cp-bg border border-cp-border rounded px-2 py-1.5 text-xs text-cp-text focus:outline-none focus:border-cp-accent"
            >
              {GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.description}
                </option>
              ))}
            </select>
          </div>

          {/* Temperature */}
          <div>
            <label className="block text-xs text-cp-muted mb-1">
              Temperature <span className="text-cp-text">{temperature.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-cp-accent"
            />
            <div className="flex justify-between text-[10px] text-cp-muted mt-0.5">
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div>
            <label className="block text-xs text-cp-muted mb-1">
              Max tokens <span className="text-cp-text">{maxTokens}</span>
            </label>
            <input
              type="range"
              min={256}
              max={8192}
              step={256}
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value))}
              className="w-full accent-cp-accent"
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-xs text-cp-muted mb-1">System prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5}
              className="w-full bg-cp-bg border border-cp-border rounded px-2 py-1.5 text-xs font-mono text-cp-text placeholder-cp-muted resize-y focus:outline-none focus:border-cp-accent"
            />
          </div>

          {/* Danger zone */}
          <div className="pt-2 border-t border-cp-error/20">
            <div className="text-[10px] text-cp-error uppercase tracking-wider mb-2">Danger zone</div>
            <button
              onClick={handleClearAll}
              className="w-full py-1.5 text-xs text-cp-error border border-cp-error/30 rounded hover:bg-cp-error/10 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-error"
            >
              Clear all conversation history
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-cp-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-cp-muted border border-cp-border rounded hover:bg-cp-border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs bg-cp-accent text-cp-bg font-semibold rounded hover:bg-cp-accent-dim transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cp-accent"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
