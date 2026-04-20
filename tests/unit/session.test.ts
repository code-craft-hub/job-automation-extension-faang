import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionManager } from '../../src/background/session'
import type { Session } from '../../src/shared/types/session'

// Mock chrome.storage.local
const storageData: Record<string, unknown> = {}
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storageData[key] })),
      set: vi.fn(async (data: Record<string, unknown>) => {
        Object.assign(storageData, data)
      }),
    },
  },
})

// Mock uuid
vi.mock('uuid', () => ({ v4: () => 'test-uuid-' + Math.random().toString(36).slice(2, 8) }))

describe('SessionManager', () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager()
    storageData['cp_sessions'] = []
  })

  it('creates a new session', async () => {
    const session = await manager.create()
    expect(session.id).toBeDefined()
    expect(session.title).toBe('New conversation')
    expect(session.messages).toHaveLength(0)
  })

  it('lists created sessions', async () => {
    await manager.create()
    await manager.create()
    const list = await manager.list()
    expect(list).toHaveLength(2)
  })

  it('appends a message and auto-titles from first user message', async () => {
    const session = await manager.create()
    const msg = {
      id: '1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'How do I use async/await?' }],
      timestamp: Date.now(),
    }
    const updated = await manager.append(session.id, msg)
    expect(updated?.messages).toHaveLength(1)
    expect(updated?.title).toBe('How do I use async/await?')
  })

  it('deletes a session', async () => {
    const s = await manager.create()
    await manager.delete(s.id)
    const list = await manager.list()
    expect(list.find((x: Session) => x.id === s.id)).toBeUndefined()
  })

  it('clears all sessions', async () => {
    await manager.create()
    await manager.create()
    await manager.clear()
    const list = await manager.list()
    expect(list).toHaveLength(0)
  })

  it('returns null when getting nonexistent session', async () => {
    const result = await manager.get('does-not-exist')
    expect(result).toBeNull()
  })
})
