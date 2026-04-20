import { create } from 'zustand'
import type { Message } from '@/shared/types/message'

interface ChatState {
  messages: Message[]
  streamingText: string
  isStreaming: boolean
  error: string | null
  totalTokens: number
  setMessages: (msgs: Message[]) => void
  appendMessage: (msg: Message) => void
  updateLastMessage: (patch: Partial<Message>) => void
  setStreamingText: (text: string) => void
  appendStreamingText: (chunk: string) => void
  setIsStreaming: (v: boolean) => void
  setError: (e: string | null) => void
  setTotalTokens: (n: number) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  streamingText: '',
  isStreaming: false,
  error: null,
  totalTokens: 0,

  setMessages: (messages) => set({ messages }),
  appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateLastMessage: (patch) =>
    set((s) => {
      if (s.messages.length === 0) return s
      const msgs = [...s.messages]
      const last = msgs[msgs.length - 1]
      if (last) {
        msgs[msgs.length - 1] = { ...last, ...patch }
      }
      return { messages: msgs }
    }),
  setStreamingText: (streamingText) => set({ streamingText }),
  appendStreamingText: (chunk) => set((s) => ({ streamingText: s.streamingText + chunk })),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setError: (error) => set({ error }),
  setTotalTokens: (totalTokens) => set({ totalTokens }),
  reset: () => set({ messages: [], streamingText: '', isStreaming: false, error: null, totalTokens: 0 }),
}))
