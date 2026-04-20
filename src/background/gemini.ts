import type { GeminiContent, GeminiGenerationConfig, GeminiStreamChunk } from '@/shared/types/gemini'
import type { FunctionDeclaration } from '@/shared/types/tool'
import type { StreamChunk } from '@/shared/types/message'
import { createLogger } from '@/shared/utils/logger'

const logger = createLogger('gemini')

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class GeminiClient {
  async *streamChat(
    messages: GeminiContent[],
    systemPrompt: string,
    tools: FunctionDeclaration[],
    apiKey: string,
    model: string,
    config: GeminiGenerationConfig
  ): AsyncGenerator<StreamChunk> {
    const url = `${BASE_URL}/${model}:streamGenerateContent?key=${apiKey}&alt=sse`

    const body: Record<string, unknown> = {
      contents: messages,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: config,
    }
    if (tools.length > 0) {
      body.tools = [{ functionDeclarations: tools }]
    }

    let attempt = 0
    while (attempt < 3) {
      let response: Response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch (err) {
        attempt++
        if (attempt >= 3) {
          yield { type: 'error', payload: `Network error: ${String(err)}` }
          return
        }
        await sleep(Math.pow(2, attempt) * 500)
        continue
      }

      if (response.status === 429 || response.status === 503) {
        attempt++
        if (attempt >= 3) {
          yield { type: 'error', payload: `Rate limited (${response.status}). Please retry.` }
          return
        }
        const delay = Math.pow(2, attempt) * 1000
        logger.warn(`Gemini ${response.status}, retrying in ${delay}ms`)
        await sleep(delay)
        continue
      }

      if (!response.ok) {
        let errText = ''
        try { errText = await response.text() } catch { /* ignore */ }
        yield { type: 'error', payload: `Gemini API error ${response.status}: ${errText.slice(0, 200)}` }
        return
      }

      if (!response.body) {
        yield { type: 'error', payload: 'Empty response body from Gemini' }
        return
      }

      yield* this.parseStream(response.body)
      return
    }
  }

  private async *parseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') return

          let chunk: GeminiStreamChunk
          try {
            chunk = JSON.parse(data) as GeminiStreamChunk
          } catch {
            continue
          }

          if (chunk.error) {
            yield { type: 'error', payload: chunk.error.message }
            return
          }

          const candidate = chunk.candidates?.[0]
          if (!candidate?.content?.parts) continue

          for (const part of candidate.content.parts) {
            if (part.text) {
              yield { type: 'text', payload: part.text }
            } else if (part.functionCall) {
              yield {
                type: 'tool_call',
                payload: {
                  id: crypto.randomUUID(),
                  name: part.functionCall.name,
                  args: part.functionCall.args,
                },
              }
            }
          }

          if (chunk.usageMetadata?.totalTokenCount) {
            yield { type: 'done', payload: { totalTokens: chunk.usageMetadata.totalTokenCount } }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}

export function messagesToGeminiContents(
  messages: import('@/shared/types/message').Message[]
): GeminiContent[] {
  const result: GeminiContent[] = []

  for (const msg of messages) {
    if (msg.role === 'tool') continue

    const parts: import('@/shared/types/gemini').GeminiPart[] = []

    for (const part of msg.parts) {
      if (part.type === 'text') {
        parts.push({ text: part.text })
      } else if (part.type === 'tool_call') {
        parts.push({ functionCall: { name: part.toolName, args: part.args } })
      } else if (part.type === 'tool_result') {
        parts.push({
          functionResponse: {
            name: part.toolName,
            response: { content: part.result },
          },
        })
      }
    }

    if (parts.length > 0) {
      result.push({ role: msg.role === 'user' ? 'user' : 'model', parts })
    }
  }

  return result
}

export const geminiClient = new GeminiClient()
