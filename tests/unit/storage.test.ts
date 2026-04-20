import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const localData: Record<string, unknown> = {}
const syncData: Record<string, unknown> = {}

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: localData[key] })),
      set: vi.fn(async (data: Record<string, unknown>) => Object.assign(localData, data)),
      remove: vi.fn(async (key: string) => { delete localData[key] }),
      clear: vi.fn(async () => { for (const k in localData) delete localData[k] }),
    },
    sync: {
      get: vi.fn(async (key: string) => ({ [key]: syncData[key] })),
      set: vi.fn(async (data: Record<string, unknown>) => Object.assign(syncData, data)),
      remove: vi.fn(async (key: string) => { delete syncData[key] }),
      clear: vi.fn(async () => { for (const k in syncData) delete syncData[k] }),
    },
  },
})

describe('storage utils', () => {
  beforeEach(() => {
    for (const k in localData) delete localData[k]
    for (const k in syncData) delete syncData[k]
  })

  it('returns fallback for missing key', async () => {
    const { storageGet } = await import('../../src/shared/utils/storage')
    const schema = z.string()
    const result = await storageGet('local', 'missing', schema, 'default')
    expect(result).toBe('default')
  })

  it('returns parsed value when key exists', async () => {
    localData['test-key'] = 'hello'
    const { storageGet } = await import('../../src/shared/utils/storage')
    const schema = z.string()
    const result = await storageGet('local', 'test-key', schema, 'fallback')
    expect(result).toBe('hello')
  })

  it('returns fallback when stored value fails schema', async () => {
    localData['typed-key'] = 'not-a-number'
    const { storageGet } = await import('../../src/shared/utils/storage')
    const schema = z.number()
    const result = await storageGet('local', 'typed-key', schema, 42)
    expect(result).toBe(42)
  })

  it('stores and retrieves from sync', async () => {
    const { storageGet, storageSet } = await import('../../src/shared/utils/storage')
    await storageSet('sync', 'config', { model: 'gemini-2.0-flash' })
    const schema = z.object({ model: z.string() })
    const result = await storageGet('sync', 'config', schema, { model: 'default' })
    expect(result.model).toBe('gemini-2.0-flash')
  })
})
