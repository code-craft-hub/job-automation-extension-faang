import { useState, useRef, useCallback, useEffect } from 'react'
import { estimateTokens } from '@/shared/utils/tokenCounter'
import type { KeyboardEvent, ChangeEvent } from 'react'

interface FileItem {
  name: string
  content: string
  type: 'page' | 'clipboard' | 'selection'
}

interface Props {
  onSend: (content: string) => void
  onAttach: (file: FileItem) => void
  isStreaming: boolean
  onCancel: () => void
}

const SLASH_COMMANDS = ['/clear', '/model', '/help'] as const

export function InputBar({ onSend, onAttach, isStreaming, onCancel }: Props) {
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const estimatedTokens = estimateTokens(value)

  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  useEffect(() => {
    resize()
  }, [value, resize])

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setValue(v)

    // Show slash command autocomplete
    if (v.startsWith('/')) {
      const matched = SLASH_COMMANDS.filter((cmd) => cmd.startsWith(v))
      setSuggestions(matched)
    } else {
      setSuggestions([])
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'Escape' && isStreaming) {
      onCancel()
    }
  }

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) return

    // Handle @file mention
    if (trimmed.startsWith('@file')) {
      navigator.clipboard.readText().then((text) => {
        onAttach({ name: 'clipboard', content: text, type: 'clipboard' })
        setValue('')
      }).catch(() => {
        setValue('')
      })
      return
    }

    onSend(trimmed)
    setValue('')
    setSuggestions([])
  }

  const applySuggestion = (cmd: string) => {
    setValue(cmd + ' ')
    setSuggestions([])
    textareaRef.current?.focus()
  }

  const attachFromPage = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) return
      chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CODE' }, (resp: { content?: string }) => {
        if (chrome.runtime.lastError || !resp?.content) return
        onAttach({ name: 'page-code', content: resp.content, type: 'page' })
      })
    })
  }

  const attachSelection = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) return
      chrome.tabs.sendMessage(tabId, { type: 'GET_SELECTION' }, (resp: { content?: string }) => {
        if (chrome.runtime.lastError || !resp?.content) return
        onAttach({ name: 'selection', content: resp.content, type: 'selection' })
      })
    })
  }

  return (
    <div className="border-t border-cp-border bg-cp-bg">
      {suggestions.length > 0 && (
        <div className="border-b border-cp-border px-2 py-1 bg-cp-surface">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => applySuggestion(s)}
              className="block w-full text-left px-2 py-0.5 text-xs font-mono text-cp-accent hover:bg-cp-border/40 rounded transition-colors focus:outline-none"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1 px-2 py-2">
        {/* Attach buttons */}
        <div className="flex flex-col gap-0.5 pb-0.5">
          <button
            onClick={attachFromPage}
            title="Attach page code"
            className="w-6 h-6 flex items-center justify-center text-cp-muted hover:text-cp-text rounded text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
          >
            🌐
          </button>
          <button
            onClick={attachSelection}
            title="Attach selection"
            className="w-6 h-6 flex items-center justify-center text-cp-muted hover:text-cp-text rounded text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
          >
            ✂️
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          placeholder={isStreaming ? 'Streaming… (Esc to cancel)' : 'Ask anything… (⌘↵ to send, @file, /clear)'}
          rows={1}
          className="flex-1 bg-cp-surface border border-cp-border rounded-lg px-3 py-2 text-sm text-cp-text placeholder-cp-muted resize-none overflow-hidden focus:outline-none focus:border-cp-accent transition-colors disabled:opacity-60 disabled:cursor-not-allowed font-mono"
          style={{ minHeight: '40px', maxHeight: '200px' }}
        />

        <div className="flex flex-col items-center gap-0.5 pb-0.5">
          {isStreaming ? (
            <button
              onClick={onCancel}
              className="w-8 h-8 flex items-center justify-center bg-cp-error/20 border border-cp-error/30 text-cp-error rounded-lg hover:bg-cp-error/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-error"
              title="Stop (Esc)"
            >
              ■
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!value.trim()}
              className="w-8 h-8 flex items-center justify-center bg-cp-accent text-cp-bg rounded-lg hover:bg-cp-accent-dim transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-cp-accent font-bold text-sm"
              title="Send (⌘↵)"
            >
              ↑
            </button>
          )}
          {estimatedTokens > 0 && (
            <span className="text-[9px] text-cp-muted">{estimatedTokens}t</span>
          )}
        </div>
      </div>
    </div>
  )
}
