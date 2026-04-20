import { useCallback, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useChatStore } from '../store/chatStore'
import { useStream } from './useStream'
import { useSession } from './useSession'
import type { Message, StreamChunk } from '@/shared/types/message'

export function useChat() {
  const {
    messages,
    streamingText,
    isStreaming,
    error,
    totalTokens,
    appendMessage,
    setStreamingText,
    setMessages,
    setError,
  } = useChatStore()

  const { currentSessionId, createSession, refreshCurrentSession } = useSession()
  const sessionIdRef = useRef<string | null>(currentSessionId)

  useEffect(() => {
    sessionIdRef.current = currentSessionId
  }, [currentSessionId])

  const handleToolCall = useCallback(
    (chunk: StreamChunk & { type: 'tool_call' }) => {
      const toolMsg: Message = {
        id: uuidv4(),
        role: 'tool',
        parts: [{ type: 'tool_call', toolCallId: chunk.payload.id, toolName: chunk.payload.name, args: chunk.payload.args }],
        timestamp: Date.now(),
      }
      appendMessage(toolMsg)
    },
    [appendMessage]
  )

  const { send: streamSend, cancel, isStreaming: _streaming, error: _error } = useStream(handleToolCall)

  // Flush streamed text into a persisted message once streaming finishes
  const prevStreamingRef = useRef(false)
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current
    prevStreamingRef.current = isStreaming

    if (wasStreaming && !isStreaming && streamingText) {
      const modelMsg: Message = {
        id: uuidv4(),
        role: 'model',
        parts: [{ type: 'text', text: streamingText }],
        timestamp: Date.now(),
      }
      appendMessage(modelMsg)
      setStreamingText('')
      if (sessionIdRef.current) {
        refreshCurrentSession(sessionIdRef.current)
      }
    }
  }, [isStreaming, streamingText, appendMessage, setStreamingText, refreshCurrentSession])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return

      if (content.trim() === '/clear') {
        setMessages([])
        setStreamingText('')
        return
      }

      // Always append the user message immediately — never block on async ops first
      const userMsg: Message = {
        id: uuidv4(),
        role: 'user',
        parts: [{ type: 'text', text: content }],
        timestamp: Date.now(),
      }
      appendMessage(userMsg)

      // Get existing session or create a new one
      let sessionId = sessionIdRef.current
      if (!sessionId) {
        sessionId = await createSession()
      }

      if (!sessionId) {
        setError(
          'Could not create a session — the extension background may not be running. ' +
          'Go to chrome://extensions, find CodePilot, and click the "service worker" link to check for errors. ' +
          'Then reload the extension.'
        )
        return
      }

      streamSend(sessionId, content)
    },
    [isStreaming, createSession, appendMessage, streamSend, setMessages, setStreamingText, setError]
  )

  return {
    messages,
    streamingText,
    isStreaming,
    error,
    totalTokens,
    sendMessage,
    cancel,
  }
}
