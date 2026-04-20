import { useSettingsStore } from '../store/settingsStore'
import { useChatStore } from '../store/chatStore'
import { formatTokenCount } from '@/shared/utils/tokenCounter'

export function StatusBar() {
  const { settings } = useSettingsStore()
  const { isStreaming, totalTokens } = useChatStore()

  return (
    <div className="flex items-center justify-between px-3 py-1 bg-cp-surface border-t border-cp-border text-xs text-cp-muted select-none">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${isStreaming ? 'bg-cp-accent animate-pulse' : 'bg-cp-muted'}`}
        />
        <span className="font-mono">{settings.model}</span>
      </div>
      <div className="flex items-center gap-3">
        {totalTokens > 0 && (
          <span>{formatTokenCount(totalTokens)} tokens</span>
        )}
        {isStreaming && <span className="text-cp-accent">streaming…</span>}
      </div>
    </div>
  )
}
