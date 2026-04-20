import { useState } from 'react'
import type { ToolCallPart, ToolResultPart } from '@/shared/types/message'

interface Props {
  toolCall: ToolCallPart
  result?: ToolResultPart
}

export function ToolCallCard({ toolCall, result }: Props) {
  const [expanded, setExpanded] = useState(false)

  const statusColor = result
    ? result.isError
      ? 'text-cp-error border-cp-error/30'
      : 'text-cp-accent border-cp-accent/30'
    : 'text-cp-tool border-cp-tool/30'

  const statusIcon = result ? (result.isError ? '✗' : '✓') : '⟳'

  return (
    <div className={`my-1 rounded border bg-cp-surface/50 ${statusColor} text-xs font-mono animate-fade-in`}>
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="text-sm">{statusIcon}</span>
        <span className="text-cp-tool font-semibold">{toolCall.toolName}</span>
        <span className="text-cp-muted ml-auto">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-cp-border">
          <div>
            <div className="text-cp-muted text-[10px] uppercase tracking-wider mt-2 mb-1">Args</div>
            <pre className="text-cp-text overflow-auto max-h-40 text-[11px] whitespace-pre-wrap">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          {result && (
            <div>
              <div className="text-cp-muted text-[10px] uppercase tracking-wider mb-1">Result</div>
              <pre className={`overflow-auto max-h-40 text-[11px] whitespace-pre-wrap ${result.isError ? 'text-cp-error' : 'text-cp-text'}`}>
                {result.result.slice(0, 2000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
