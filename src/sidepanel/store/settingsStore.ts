import { create } from 'zustand'
import type { Settings } from '@/shared/schemas/settings.schema'
import { DEFAULT_SETTINGS } from '@/shared/schemas/settings.schema'

interface SettingsState {
  settings: Settings
  loaded: boolean
  setSettings: (s: Settings) => void
  setLoaded: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  setSettings: (settings) => set({ settings }),
  setLoaded: (loaded) => set({ loaded }),
}))
