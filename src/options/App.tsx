import { useState, useEffect } from 'react'
import { z } from 'zod'
import { SettingsSchema } from '@/shared/schemas/settings.schema'
import type { Settings } from '@/shared/schemas/settings.schema'
import { GEMINI_MODELS } from '@/shared/constants/models'
import { DEFAULT_SYSTEM_PROMPT } from '@/shared/constants/prompts'
import '@/assets/styles/globals.css'

const SETTINGS_KEY = 'cp_settings'

function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTINGS_KEY, (result) => {
      const parsed = SettingsSchema.safeParse(result[SETTINGS_KEY])
      resolve(parsed.success ? parsed.data : SettingsSchema.parse({}))
    })
  })
}

function saveSettings(s: Settings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [SETTINGS_KEY]: s }, resolve)
  })
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keyStatus, setKeyStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle')
  const [keyError, setKeyError] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s)
      setApiKey(s.apiKey)
    })
  }, [])

  const patch = (partial: Partial<Settings>) => setSettings((s) => s ? { ...s, ...partial } : s)

  // Direct fetch — no service worker hop needed, extension pages have host_permissions
  const validateKey = async (key: string) => {
    if (!key.trim()) return
    setKeyStatus('validating')
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key.trim()}`,
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
      setKeyError(`Network error: ${String(err)}`)
    }
  }

  const handleSave = async () => {
    if (!settings) return
    const updated = { ...settings, apiKey }
    const parsed = SettingsSchema.safeParse(updated)
    if (!parsed.success) {
      setToast('Invalid settings — check values')
      setTimeout(() => setToast(null), 3000)
      return
    }
    await saveSettings(parsed.data)
    setToast('Settings saved ✓')
    setTimeout(() => setToast(null), 2500)
  }

  const exportHistory = () => {
    chrome.storage.local.get('cp_sessions', (result) => {
      const data = JSON.stringify(result.cp_sessions ?? [], null, 2)
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `codepilot-history-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  const importHistory = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      setImporting(true)
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string)
          chrome.storage.local.set({ cp_sessions: data }, () => {
            setImporting(false)
            setToast('History imported ✓')
            setTimeout(() => setToast(null), 2500)
          })
        } catch {
          setImporting(false)
          setToast('Invalid JSON file')
          setTimeout(() => setToast(null), 3000)
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const clearAll = () => {
    if (!confirm('Delete ALL conversation history? This cannot be undone.')) return
    chrome.storage.local.clear(() => {
      setToast('All data cleared')
      setTimeout(() => setToast(null), 2500)
    })
  }

  const resetPrompt = () => patch({ systemPrompt: DEFAULT_SYSTEM_PROMPT })

  // Zod z imported to prevent unused lint error
  void (z as unknown)

  if (!settings) {
    return (
      <div className="min-h-screen bg-cp-bg flex items-center justify-center">
        <div className="text-cp-muted text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cp-bg text-cp-text font-sans py-8 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="text-cp-accent text-2xl font-mono">✦</span>
          <div>
            <h1 className="text-lg font-bold text-cp-text">CodePilot AI — Settings</h1>
            <p className="text-xs text-cp-muted">Configure your Gemini-powered coding assistant</p>
          </div>
        </div>

        {/* API Key */}
        <section className="bg-cp-surface border border-cp-border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-cp-text">API Configuration</h2>
          <div>
            <label className="block text-xs text-cp-muted mb-1">Gemini API Key</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setKeyStatus('idle') }}
                  onBlur={(e) => validateKey(e.target.value)}
                  placeholder="AIzaSy…"
                  className="w-full bg-cp-bg border border-cp-border rounded-lg px-3 py-2 text-sm font-mono text-cp-text placeholder-cp-muted focus:outline-none focus:border-cp-accent"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-cp-muted hover:text-cp-text focus:outline-none"
                >
                  {showKey ? 'hide' : 'show'}
                </button>
              </div>
              <button
                onClick={() => validateKey(apiKey)}
                disabled={keyStatus === 'validating' || !apiKey.trim()}
                className="px-3 py-2 text-sm border border-cp-border rounded-lg text-cp-muted hover:text-cp-text hover:border-cp-accent transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
              >
                {keyStatus === 'validating' ? '…' : 'Test'}
              </button>
            </div>
            {keyStatus === 'valid' && <p className="mt-1 text-xs text-cp-accent">✓ API key is valid</p>}
            {keyStatus === 'invalid' && (
              <div className="mt-1 space-y-1">
                <p className="text-xs text-cp-error">✗ {keyError || 'Invalid API key'}</p>
                <p className="text-xs text-cp-muted">
                  This extension requires a <strong className="text-cp-text">Google AI Studio</strong> key (free) —
                  not a Google Cloud key. Get one at{' '}
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-cp-info underline">
                    aistudio.google.com/app/apikey
                  </a>
                </p>
              </div>
            )}
            <p className="mt-1 text-[11px] text-cp-muted">
              Keys are stored in chrome.storage.sync and never sent anywhere except Gemini API.
            </p>
          </div>

          <div>
            <label className="block text-xs text-cp-muted mb-1">Model</label>
            <select
              value={settings.model}
              onChange={(e) => patch({ model: e.target.value })}
              className="w-full bg-cp-bg border border-cp-border rounded-lg px-3 py-2 text-sm text-cp-text focus:outline-none focus:border-cp-accent"
            >
              {GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.description}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Generation */}
        <section className="bg-cp-surface border border-cp-border rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold text-cp-text">Generation</h2>
          <div>
            <label className="flex justify-between text-xs text-cp-muted mb-1">
              <span>Temperature</span>
              <span className="text-cp-text font-mono">{settings.temperature.toFixed(1)}</span>
            </label>
            <input type="range" min={0} max={2} step={0.1} value={settings.temperature}
              onChange={(e) => patch({ temperature: parseFloat(e.target.value) })}
              className="w-full accent-cp-accent"
            />
            <div className="flex justify-between text-[10px] text-cp-muted mt-0.5">
              <span>0 — Deterministic</span>
              <span>2 — Creative</span>
            </div>
          </div>
          <div>
            <label className="flex justify-between text-xs text-cp-muted mb-1">
              <span>Max output tokens</span>
              <span className="text-cp-text font-mono">{settings.maxTokens}</span>
            </label>
            <input type="range" min={256} max={8192} step={256} value={settings.maxTokens}
              onChange={(e) => patch({ maxTokens: parseInt(e.target.value) })}
              className="w-full accent-cp-accent"
            />
            <div className="flex justify-between text-[10px] text-cp-muted mt-0.5">
              <span>256</span>
              <span>8192</span>
            </div>
          </div>
        </section>

        {/* System Prompt */}
        <section className="bg-cp-surface border border-cp-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-cp-text">System Prompt</h2>
            <button onClick={resetPrompt} className="text-xs text-cp-muted hover:text-cp-accent transition-colors focus:outline-none">
              Reset to default
            </button>
          </div>
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => patch({ systemPrompt: e.target.value })}
            rows={8}
            className="w-full bg-cp-bg border border-cp-border rounded-lg px-3 py-2 text-xs font-mono text-cp-text placeholder-cp-muted resize-y focus:outline-none focus:border-cp-accent"
          />
        </section>

        {/* Theme */}
        <section className="bg-cp-surface border border-cp-border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-cp-text">Appearance</h2>
          <div className="flex gap-2">
            {(['dark', 'light', 'system'] as const).map((t) => (
              <button
                key={t}
                onClick={() => patch({ theme: t })}
                className={`flex-1 py-2 text-xs rounded-lg border transition-colors capitalize focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent ${
                  settings.theme === t
                    ? 'border-cp-accent text-cp-accent bg-cp-accent/10'
                    : 'border-cp-border text-cp-muted hover:border-cp-accent/50'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* History */}
        <section className="bg-cp-surface border border-cp-border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-cp-text">Conversation History</h2>
          <div className="flex gap-2">
            <button
              onClick={exportHistory}
              className="flex-1 py-2 text-xs border border-cp-border rounded-lg text-cp-muted hover:text-cp-text hover:border-cp-accent transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
            >
              Export JSON
            </button>
            <button
              onClick={importHistory}
              disabled={importing}
              className="flex-1 py-2 text-xs border border-cp-border rounded-lg text-cp-muted hover:text-cp-text hover:border-cp-accent transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
            >
              {importing ? 'Importing…' : 'Import JSON'}
            </button>
          </div>
        </section>

        {/* Danger zone */}
        <section className="bg-cp-surface border border-cp-error/20 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-cp-error">Danger Zone</h2>
          <button
            onClick={clearAll}
            className="w-full py-2 text-sm text-cp-error border border-cp-error/30 rounded-lg hover:bg-cp-error/10 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-error"
          >
            Clear all data (sessions + settings)
          </button>
        </section>

        {/* Save */}
        <button
          onClick={handleSave}
          className="w-full py-3 bg-cp-accent text-cp-bg text-sm font-bold rounded-xl hover:bg-cp-accent-dim transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cp-accent"
        >
          Save Settings
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-cp-surface border border-cp-accent/30 text-cp-accent text-xs px-4 py-2 rounded-full shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  )
}
