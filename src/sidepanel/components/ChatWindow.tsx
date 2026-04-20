import { useEffect, useRef } from 'react'
import type { Message } from '@/shared/types/message'
import { MessageBubble } from './MessageBubble'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'
import type { ReactNode, ComponentProps } from 'react'

const EXAMPLE_PROMPTS = [
  'Explain the code on this page',
  'Find all async functions and explain each one',
  'Refactor the selected code for readability',
  'What bugs might be in this code?',
  'Write unit tests for the selected function',
]

interface Props {
  messages: Message[]
  streamingText: string
  isStreaming: boolean
  error: string | null
  onRetry: () => void
  onExamplePrompt: (p: string) => void
}

export function ChatWindow({
  messages,
  streamingText,
  isStreaming,
  error,
  onRetry,
  onExamplePrompt,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)

  // Auto-scroll to bottom unless user has scrolled up
  useEffect(() => {
    if (!userScrolledRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streamingText])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledRef.current = distFromBottom > 80
  }

  // Build tool result map for MessageBubble
  const toolResults = new Map<string, string>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'tool_result') {
        toolResults.set(part.toolCallId, part.result)
      }
    }
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto p-3 space-y-3 scroll-smooth"
    >
      {messages.length === 0 && !isStreaming && (
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-4 text-center">
          <div className="text-3xl">✦</div>
          <h3 className="text-sm font-semibold text-cp-text">CodePilot AI</h3>
          <p className="text-xs text-cp-muted max-w-[240px]">
            Your Gemini-powered coding assistant. Ask about code on this page or start a conversation.
          </p>
          <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => onExamplePrompt(p)}
                className="text-left px-3 py-2 text-xs text-cp-muted border border-cp-border rounded-lg hover:border-cp-accent hover:text-cp-text hover:bg-cp-accent/5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} relatedResults={toolResults} />
      ))}

      {/* Streaming bubble */}
      {isStreaming && streamingText && (
        <div className="flex w-full justify-start animate-fade-in">
          <div className="max-w-[90%] rounded-xl px-3 py-2 text-sm bg-cp-surface border border-cp-border text-cp-text">
            <div className="text-[10px] text-cp-accent font-semibold mb-1 font-mono">CODEPILOT</div>
            <div className="prose prose-sm prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }: ComponentProps<'code'> & { inline?: boolean }) {
                    const match = /language-(\w+)/.exec(className ?? '')
                    const isInline = !match && !String(children).includes('\n')
                    if (isInline) {
                      return (
                        <code className="bg-cp-border px-1 py-0.5 rounded text-[11px] font-mono text-cp-accent" {...props}>
                          {children}
                        </code>
                      )
                    }
                    return <CodeBlock className={className}>{String(children).replace(/\n$/, '')}</CodeBlock>
                  },
                  pre({ children }: { children?: ReactNode }) {
                    return <>{children}</>
                  },
                }}
              >
                {streamingText}
              </ReactMarkdown>
            </div>
            <span className="inline-block w-1.5 h-3.5 bg-cp-accent animate-cursor ml-0.5 align-middle" />
          </div>
        </div>
      )}

      {/* Streaming spinner without text yet */}
      {isStreaming && !streamingText && (
        <div className="flex justify-start animate-fade-in">
          <div className="px-3 py-2 bg-cp-surface border border-cp-border rounded-xl">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="inline-block w-1.5 h-1.5 rounded-full bg-cp-accent"
                  style={{ animation: `blink 1.2s ${i * 0.2}s step-end infinite` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center gap-2 py-3">
          <p className="text-xs text-cp-error bg-cp-error/10 border border-cp-error/20 rounded-lg px-3 py-2">
            {error}
          </p>
          <button
            onClick={onRetry}
            className="text-xs text-cp-accent hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-cp-accent rounded"
          >
            Try again
          </button>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
