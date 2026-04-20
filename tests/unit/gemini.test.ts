import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GeminiClient } from '../../src/background/gemini'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk))
      }
      controller.close()
    },
  })
}

describe('GeminiClient', () => {
  let client: GeminiClient

  beforeEach(() => {
    client = new GeminiClient()
    vi.clearAllMocks()
  })

  it('streams text chunks from API', async () => {
    const sseChunk = `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Hello' }], role: 'model' } }],
    })}\n\ndata: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: ' world' }], role: 'model' } }],
      usageMetadata: { totalTokenCount: 5 },
    })}\n\n`

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: makeSSEStream([sseChunk]),
    })

    const results = []
    const stream = client.streamChat(
      [{ role: 'user', parts: [{ text: 'hi' }] }],
      'You are helpful',
      [],
      'test-key',
      'gemini-2.0-flash',
      { temperature: 0.7 }
    )
    for await (const chunk of stream) {
      results.push(chunk)
    }

    const textChunks = results.filter((r) => r.type === 'text')
    expect(textChunks).toHaveLength(2)
    expect(textChunks[0]).toEqual({ type: 'text', payload: 'Hello' })
    expect(textChunks[1]).toEqual({ type: 'text', payload: ' world' })
  })

  it('yields error on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    })

    const results = []
    const stream = client.streamChat([], 'sys', [], 'key', 'model', {})
    for await (const chunk of stream) {
      results.push(chunk)
    }

    expect(results[0]?.type).toBe('error')
  })

  it('retries on 429 rate limit', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: false, status: 429 })

    const results = []
    const stream = client.streamChat([], 'sys', [], 'key', 'model', {})
    for await (const chunk of stream) {
      results.push(chunk)
    }

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(results.some((r) => r.type === 'error')).toBe(true)
  })

  it('yields tool_call for functionCall parts', async () => {
    const sseChunk = `data: ${JSON.stringify({
      candidates: [{
        content: {
          parts: [{ functionCall: { name: 'read_file', args: { source: 'page' } } }],
          role: 'model',
        },
      }],
    })}\n\n`

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: makeSSEStream([sseChunk]),
    })

    const results = []
    const stream = client.streamChat(
      [{ role: 'user', parts: [{ text: 'read the page' }] }],
      'sys', [], 'key', 'model', {}
    )
    for await (const chunk of stream) {
      results.push(chunk)
    }

    const toolChunks = results.filter((r) => r.type === 'tool_call')
    expect(toolChunks).toHaveLength(1)
    if (toolChunks[0]?.type === 'tool_call') {
      expect(toolChunks[0].payload.name).toBe('read_file')
    }
  })
})
