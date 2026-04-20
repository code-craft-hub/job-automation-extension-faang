export interface ModelInfo {
  id: string
  label: string
  maxTokens: number
  description: string
}

export const GEMINI_MODELS: ModelInfo[] = [
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    maxTokens: 8192,
    description: 'Fastest, great for most tasks',
  },
  {
    id: 'gemini-1.5-pro',
    label: 'Gemini 1.5 Pro',
    maxTokens: 8192,
    description: 'Highest capability, longer context',
  },
  {
    id: 'gemini-1.5-flash',
    label: 'Gemini 1.5 Flash',
    maxTokens: 8192,
    description: 'Fast and efficient',
  },
]

export const DEFAULT_MODEL = 'gemini-2.0-flash'
