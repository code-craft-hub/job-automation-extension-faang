import { useRef, useCallback } from 'react'
import { useChatStore } from '../store/chatStore'
import type { PortMessage, StreamChunk } from '@/shared/types/message'

export interface UseStreamReturn {
  isStreaming: boolean
  error: string | null
  send: (sessionId: string, content: string) => void
  cancel: () => void
}

export function useStream(onToolCall?: (chunk: StreamChunk & { type: 'tool_call' }) => void): UseStreamReturn {
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const { isStreaming, error, setIsStreaming, setError, appendStreamingText, setStreamingText, setTotalTokens } =
    useChatStore()

  const cancel = useCallback(() => {
    portRef.current?.disconnect()
    portRef.current = null
    setIsStreaming(false)
  }, [setIsStreaming])

  const send = useCallback(
    (sessionId: string, content: string) => {
      if (portRef.current) {
        portRef.current.disconnect()
      }

      setStreamingText('')
      setIsStreaming(true)
      setError(null)

      let port: chrome.runtime.Port
      try {
        port = chrome.runtime.connect({ name: 'chat-stream' })
      } catch (err) {
        setError(`Could not connect to extension background. Try reloading the extension at chrome://extensions. (${String(err)})`)
        setIsStreaming(false)
        return
      }
      portRef.current = port

      port.onMessage.addListener((msg: PortMessage) => {
        switch (msg.type) {
          case 'text':
            appendStreamingText(msg.payload)
            break
          case 'tool_call':
            onToolCall?.(msg)
            break
          case 'tool_result':
            break
          case 'done':
            if (msg.payload.totalTokens) setTotalTokens(msg.payload.totalTokens)
            setIsStreaming(false)
            portRef.current = null
            break
          case 'error':
            setError(msg.payload)
            setIsStreaming(false)
            portRef.current = null
            break
        }
      })

      port.onDisconnect.addListener(() => {
        // chrome.runtime.lastError must be read to suppress the unchecked error warning
        const reason = chrome.runtime.lastError?.message
        if (reason) {
          setError(`Background disconnected: ${reason}. Try reloading the extension.`)
        }
        setIsStreaming(false)
        portRef.current = null
      })

      port.postMessage({ type: 'CHAT_SEND', sessionId, content } satisfies PortMessage)
    },
    [setStreamingText, setIsStreaming, setError, appendStreamingText, setTotalTokens, onToolCall]
  )

  return { isStreaming, error, send, cancel }
}
