import { useEffect, useCallback } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import { SettingsSchema } from '@/shared/schemas/settings.schema'
import type { Settings } from '@/shared/schemas/settings.schema'

const SETTINGS_KEY = 'cp_settings'

export function useSettings() {
  const { settings, loaded, setSettings, setLoaded } = useSettingsStore()

  // Load directly from chrome.storage.sync — no service worker hop needed
  useEffect(() => {
    if (loaded) return
    chrome.storage.sync.get(SETTINGS_KEY, (result) => {
      if (chrome.runtime.lastError) {
        setLoaded(true)
        return
      }
      const parsed = SettingsSchema.safeParse(result[SETTINGS_KEY])
      if (parsed.success) setSettings(parsed.data)
      setLoaded(true)
    })
  }, [loaded, setSettings, setLoaded])

  const save = useCallback(
    (partial: Partial<Settings>) => {
      const next = { ...settings, ...partial }
      setSettings(next)
      // Write directly to chrome.storage.sync — background reads fresh on each request
      chrome.storage.sync.set({ [SETTINGS_KEY]: next })
    },
    [settings, setSettings]
  )

  return { settings, loaded, save }
}
