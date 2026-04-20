import { useState } from 'react'

interface FileItem {
  name: string
  content: string
  type: 'page' | 'clipboard' | 'selection'
}

interface Props {
  files: FileItem[]
  onRemove: (idx: number) => void
}

export function FileTree({ files, onRemove }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  if (files.length === 0) return null

  const toggle = (idx: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })

  return (
    <div className="px-3 py-2 border-b border-cp-border bg-cp-surface/50 space-y-1">
      <div className="text-[10px] text-cp-muted uppercase tracking-wider mb-1">Attached context</div>
      {files.map((f, i) => (
        <div key={i} className="rounded border border-cp-border text-xs font-mono">
          <div className="flex items-center gap-2 px-2 py-1 hover:bg-cp-border/30 cursor-pointer" onClick={() => toggle(i)}>
            <span className="text-cp-muted">{f.type === 'page' ? '🌐' : f.type === 'clipboard' ? '📋' : '✂️'}</span>
            <span className="truncate flex-1 text-cp-text">{f.name}</span>
            <span className="text-cp-muted text-[10px]">{f.content.length} chars</span>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(i) }}
              className="text-cp-muted hover:text-cp-error transition-colors focus:outline-none"
            >×</button>
          </div>
          {expanded.has(i) && (
            <pre className="px-2 pb-2 text-[11px] text-cp-muted max-h-32 overflow-auto whitespace-pre-wrap border-t border-cp-border">
              {f.content.slice(0, 1000)}
              {f.content.length > 1000 && '\n…'}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
