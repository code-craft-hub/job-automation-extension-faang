import { v4 as uuidv4 } from 'uuid'
import type { Session } from '@/shared/types/session'
import type { Message } from '@/shared/types/message'
import { createLogger } from '@/shared/utils/logger'

const logger = createLogger('session')
const STORAGE_KEY = 'cp_sessions'
const MAX_SESSIONS = 50

async function loadAll(): Promise<Session[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    return (result[STORAGE_KEY] as Session[] | undefined) ?? []
  } catch (err) {
    logger.error('Failed to load sessions', err)
    return []
  }
}

async function saveAll(sessions: Session[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: sessions })
}

export class SessionManager {
  async create(): Promise<Session> {
    const sessions = await loadAll()
    const session: Session = {
      id: uuidv4(),
      title: 'New conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }
    const updated = [session, ...sessions].slice(0, MAX_SESSIONS)
    await saveAll(updated)
    return session
  }

  async get(id: string): Promise<Session | null> {
    const sessions = await loadAll()
    return sessions.find((s) => s.id === id) ?? null
  }

  async list(): Promise<Session[]> {
    return loadAll()
  }

  async append(id: string, message: Message): Promise<Session | null> {
    const sessions = await loadAll()
    const idx = sessions.findIndex((s) => s.id === id)
    if (idx === -1) {
      logger.warn(`Session ${id} not found`)
      return null
    }

    const session = sessions[idx]
    if (!session) return null

    const updated: Session = {
      ...session,
      messages: [...session.messages, message],
      updatedAt: Date.now(),
      title: session.messages.length === 0 && message.role === 'user'
        ? deriveTitle(message)
        : session.title,
    }
    sessions[idx] = updated
    await saveAll(sessions)
    return updated
  }

  async updateMessage(sessionId: string, messageId: string, patch: Partial<Message>): Promise<void> {
    const sessions = await loadAll()
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return
    const msgIdx = session.messages.findIndex((m) => m.id === messageId)
    if (msgIdx === -1) return
    const existing = session.messages[msgIdx]
    if (existing) {
      session.messages[msgIdx] = { ...existing, ...patch }
    }
    session.updatedAt = Date.now()
    await saveAll(sessions)
  }

  async delete(id: string): Promise<void> {
    const sessions = await loadAll()
    await saveAll(sessions.filter((s) => s.id !== id))
  }

  async clear(): Promise<void> {
    await saveAll([])
  }
}

function deriveTitle(message: Message): string {
  for (const part of message.parts) {
    if (part.type === 'text') {
      return part.text.slice(0, 50).replace(/\n/g, ' ').trim() || 'New conversation'
    }
  }
  return 'New conversation'
}

export const sessionManager = new SessionManager()
