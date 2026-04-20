import { z } from 'zod'
import { createLogger } from './logger'

const logger = createLogger('storage')

export async function storageGet<T>(
  area: 'local' | 'sync',
  key: string,
  schema: z.ZodType<T>,
  fallback: T
): Promise<T> {
  try {
    const store = area === 'local' ? chrome.storage.local : chrome.storage.sync
    const result = await store.get(key)
    if (result[key] === undefined) return fallback
    const parsed = schema.safeParse(result[key])
    if (!parsed.success) {
      logger.warn(`Invalid stored value for key "${key}", using fallback`)
      return fallback
    }
    return parsed.data
  } catch (err) {
    logger.error(`storageGet failed for "${key}"`, err)
    return fallback
  }
}

export async function storageSet(
  area: 'local' | 'sync',
  key: string,
  value: unknown
): Promise<void> {
  try {
    const store = area === 'local' ? chrome.storage.local : chrome.storage.sync
    await store.set({ [key]: value })
  } catch (err) {
    logger.error(`storageSet failed for "${key}"`, err)
    throw err
  }
}

export async function storageRemove(area: 'local' | 'sync', key: string): Promise<void> {
  const store = area === 'local' ? chrome.storage.local : chrome.storage.sync
  await store.remove(key)
}

export async function storageClear(area: 'local' | 'sync'): Promise<void> {
  const store = area === 'local' ? chrome.storage.local : chrome.storage.sync
  await store.clear()
}
