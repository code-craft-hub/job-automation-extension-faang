import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

export function CodeBlock({ children, className }: Props) {
  const codeRef = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<string | null>(null)

  const raw = typeof children === 'string' ? children : String(children ?? '')
  const lang = className?.replace('language-', '') ?? ''

  useEffect(() => {
    const el = codeRef.current
    if (!el) return

    import('highlight.js').then(({ default: hljs }) => {
      if (lang && hljs.getLanguage(lang)) {
        el.innerHTML = hljs.highlight(raw, { language: lang }).value
      } else {
        el.innerHTML = hljs.highlightAuto(raw).value
      }
    })
  }, [raw, lang])

  const copyCode = async () => {
    await navigator.clipboard.writeText(raw)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const applyToPage = () => {
    setApplying(true)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) {
        setApplyResult('No active tab')
        setApplying(false)
        return
      }
      chrome.tabs.sendMessage(tabId, { type: 'INJECT_CODE', code: raw }, (resp: { success?: boolean } | undefined) => {
        if (chrome.runtime.lastError || !resp) {
          setApplyResult('Could not inject — no writable editor found')
        } else {
          setApplyResult(resp.success ? 'Applied!' : 'No editor found on page')
        }
        setApplying(false)
        setTimeout(() => setApplyResult(null), 3000)
      })
    })
  }

  return (
    <div className="group relative my-2 rounded-md overflow-hidden border border-cp-border bg-cp-bg">
      {lang && (
        <div className="flex items-center justify-between px-3 py-1 bg-cp-surface border-b border-cp-border">
          <span className="text-[10px] text-cp-muted font-mono uppercase tracking-wider">{lang}</span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={applyToPage}
              disabled={applying}
              className="px-2 py-0.5 text-[10px] rounded bg-cp-accent/10 text-cp-accent hover:bg-cp-accent/20 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent disabled:opacity-50"
              title="Apply to detected editor on page"
            >
              {applying ? '…' : applyResult ?? 'Apply'}
            </button>
            <button
              onClick={copyCode}
              className="px-2 py-0.5 text-[10px] rounded bg-cp-surface hover:bg-cp-border text-cp-muted hover:text-cp-text transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
              title="Copy code"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <pre className="p-3 text-[12px] leading-relaxed m-0">
          <code
            ref={codeRef}
            className={`hljs font-mono ${className ?? ''}`}
          >
            {raw}
          </code>
        </pre>
      </div>
      {!lang && (
        <button
          onClick={copyCode}
          className="absolute top-2 right-2 px-2 py-0.5 text-[10px] rounded bg-cp-surface text-cp-muted opacity-0 group-hover:opacity-100 transition-opacity hover:text-cp-text focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
        >
          {copied ? '✓' : 'Copy'}
        </button>
      )}
    </div>
  )
}
