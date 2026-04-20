import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '@/shared/types/message'
import { CodeBlock } from './CodeBlock'
import { ToolCallCard } from './ToolCallCard'
import type { ReactNode, ComponentProps } from 'react'

interface Props {
  message: Message
  relatedResults?: Map<string, string>
}

export function MessageBubble({ message, relatedResults }: Props) {
  const isUser = message.role === 'user'
  const isError = message.parts.some((p) => p.type === 'text' && p.type === 'text')

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}>
      <div
        className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
          isUser
            ? 'bg-cp-accent/10 border border-cp-accent/20 text-cp-text'
            : 'bg-cp-surface border border-cp-border text-cp-text'
        }`}
      >
        {!isUser && !isError && (
          <div className="text-[10px] text-cp-accent font-semibold mb-1 font-mono">CODEPILOT</div>
        )}
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            if (isUser) {
              return (
                <p key={i} className="whitespace-pre-wrap break-words">
                  {part.text}
                </p>
              )
            }
            return (
              <div key={i} className="prose prose-sm prose-invert max-w-none">
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
                      return (
                        <CodeBlock className={className}>
                          {String(children).replace(/\n$/, '')}
                        </CodeBlock>
                      )
                    },
                    pre({ children }: { children?: ReactNode }) {
                      return <>{children}</>
                    },
                    a({ href, children }: { href?: string; children?: ReactNode }) {
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cp-info hover:underline"
                        >
                          {children}
                        </a>
                      )
                    },
                  }}
                >
                  {part.text}
                </ReactMarkdown>
              </div>
            )
          }

          if (part.type === 'tool_call') {
            const result = relatedResults?.get(part.toolCallId)
            return (
              <ToolCallCard
                key={i}
                toolCall={part}
                result={
                  result
                    ? { type: 'tool_result', toolCallId: part.toolCallId, toolName: part.toolName, result }
                    : undefined
                }
              />
            )
          }

          return null
        })}
        <div className="text-[10px] text-cp-muted mt-1 text-right">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}
