import type { Message } from './message'

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

export type SessionSummary = Omit<Session, 'messages'> & { messageCount: number }
