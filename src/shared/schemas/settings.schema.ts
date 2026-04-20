import { z } from 'zod'
import { DEFAULT_MODEL } from '../constants/models'
import { DEFAULT_SYSTEM_PROMPT } from '../constants/prompts'

export const SettingsSchema = z.object({
  apiKey: z.string().default(''),
  model: z.string().default(DEFAULT_MODEL),
  systemPrompt: z.string().default(DEFAULT_SYSTEM_PROMPT),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(256).max(8192).default(4096),
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
})

export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})
