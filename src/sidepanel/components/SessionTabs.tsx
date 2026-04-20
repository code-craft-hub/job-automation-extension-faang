import type { Session } from '@/shared/types/session'

interface Props {
  sessions: Session[]
  currentId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export function SessionTabs({ sessions, currentId, onSelect, onNew, onDelete }: Props) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-cp-border overflow-x-auto scrollbar-none">
      <button
        onClick={onNew}
        className="flex-shrink-0 px-2 py-1 text-xs text-cp-accent border border-cp-accent/30 rounded hover:bg-cp-accent/10 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
        title="New conversation"
      >
        + New
      </button>
      {sessions.map((s) => (
        <div
          key={s.id}
          className={`group flex items-center gap-1 flex-shrink-0 max-w-[140px] px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
            s.id === currentId
              ? 'bg-cp-accent/15 text-cp-text border border-cp-accent/30'
              : 'text-cp-muted hover:bg-cp-surface border border-transparent'
          }`}
          onClick={() => onSelect(s.id)}
          role="tab"
          aria-selected={s.id === currentId}
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onSelect(s.id)}
        >
          <span className="truncate">{s.title}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(s.id)
            }}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-cp-muted hover:text-cp-error transition-all focus:outline-none"
            title="Delete"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
