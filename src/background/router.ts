import { v4 as uuidv4 } from 'uuid'
import { geminiClient, messagesToGeminiContents } from './gemini'
import { sessionManager } from './session'
import { TOOL_DECLARATIONS, executeTool } from './tools'
import type { Message, PortMessage } from '@/shared/types/message'
import { SettingsSchema, DEFAULT_SETTINGS } from '@/shared/schemas/settings.schema'
import type { Settings } from '@/shared/schemas/settings.schema'
import { storageGet, storageSet } from '@/shared/utils/storage'
import { createLogger } from '@/shared/utils/logger'
import { z } from 'zod'

const logger = createLogger('router')
const SETTINGS_KEY = 'cp_settings'

async function getSettings(): Promise<Settings> {
  return storageGet('sync', SETTINGS_KEY, SettingsSchema, DEFAULT_SETTINGS)
}

async function handleChatStream(
  port: chrome.runtime.Port,
  sessionId: string,
  userContent: string
): Promise<void> {
  const settings = await getSettings()

  if (!settings.apiKey) {
    port.postMessage({ type: 'error', payload: 'API key not set. Open Options to configure.' } satisfies PortMessage)
    return
  }

  const userMessage: Message = {
    id: uuidv4(),
    role: 'user',
    parts: [{ type: 'text', text: userContent }],
    timestamp: Date.now(),
  }

  await sessionManager.append(sessionId, userMessage)
  const session = await sessionManager.get(sessionId)
  if (!session) {
    port.postMessage({ type: 'error', payload: 'Session not found' } satisfies PortMessage)
    return
  }

  const geminiContents = messagesToGeminiContents(session.messages)

  // accumulate model response for tool-call loop
  let workingContents = geminiContents
  let continueLoop = true

  while (continueLoop) {
    continueLoop = false
    let accText = ''
    const pendingToolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = []

    const stream = geminiClient.streamChat(
      workingContents,
      settings.systemPrompt,
      TOOL_DECLARATIONS,
      settings.apiKey,
      settings.model,
      { temperature: settings.temperature, maxOutputTokens: settings.maxTokens }
    )

    for await (const chunk of stream) {
      if (chunk.type === 'text') {
        accText += chunk.payload
        port.postMessage(chunk satisfies PortMessage)
      } else if (chunk.type === 'tool_call') {
        pendingToolCalls.push(chunk.payload)
        port.postMessage(chunk satisfies PortMessage)
      } else if (chunk.type === 'done') {
        port.postMessage(chunk satisfies PortMessage)
      } else if (chunk.type === 'error') {
        port.postMessage(chunk satisfies PortMessage)
        return
      }
    }

    // Build model message from accumulated response
    const modelParts: Message['parts'] = []
    if (accText) modelParts.push({ type: 'text', text: accText })
    pendingToolCalls.forEach((tc) => modelParts.push({ type: 'tool_call', toolCallId: tc.id, toolName: tc.name, args: tc.args }))

    if (modelParts.length > 0) {
      const modelMessage: Message = { id: uuidv4(), role: 'model', parts: modelParts, timestamp: Date.now() }
      await sessionManager.append(sessionId, modelMessage)

      workingContents = [
        ...workingContents,
        { role: 'model' as const, parts: [
          ...(accText ? [{ text: accText }] : []),
          ...pendingToolCalls.map((tc) => ({ functionCall: { name: tc.name, args: tc.args } })),
        ]},
      ]
    }

    if (pendingToolCalls.length > 0) {
      continueLoop = true
      const activeTab = await getActiveTab()
      const toolResultParts: import('@/shared/types/gemini').GeminiPart[] = []

      for (const tc of pendingToolCalls) {
        const result = await executeTool(tc.name, tc.args, activeTab?.id)
        port.postMessage({ type: 'tool_result', payload: { id: tc.id, name: tc.name, result } } satisfies PortMessage)

        const toolMsg: Message = {
          id: uuidv4(),
          role: 'tool',
          parts: [{ type: 'tool_result', toolCallId: tc.id, toolName: tc.name, result }],
          timestamp: Date.now(),
        }
        await sessionManager.append(sessionId, toolMsg)
        toolResultParts.push({ functionResponse: { name: tc.name, response: { content: result } } })
      }

      workingContents = [...workingContents, { role: 'user' as const, parts: toolResultParts }]
    }
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0]
}

export function setupRouter(): void {
  // Long-lived port for streaming
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'chat-stream') return

    let cancelled = false

    port.onDisconnect.addListener(() => {
      cancelled = true
      logger.info('Chat stream port disconnected')
    })

    port.onMessage.addListener((msg: PortMessage) => {
      if (cancelled) return
      if (msg.type === 'CHAT_SEND') {
        handleChatStream(port, msg.sessionId, msg.content).catch((err) => {
          logger.error('handleChatStream error', err)
          try { port.postMessage({ type: 'error', payload: String(err) }) } catch { /* port closed */ }
        })
      }
    })
  })

  // One-shot messages for session/settings CRUD
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const handle = async () => {
      switch (msg.type) {
        case 'SESSION_CREATE': return sessionManager.create()
        case 'SESSION_GET': return sessionManager.get(msg.id as string)
        case 'SESSION_LIST': return sessionManager.list()
        case 'SESSION_DELETE': { await sessionManager.delete(msg.id as string); return { ok: true } }
        case 'SESSION_CLEAR': { await sessionManager.clear(); return { ok: true } }
        case 'SETTINGS_GET': return getSettings()
        case 'SETTINGS_SET': {
          const parsed = SettingsSchema.safeParse(msg.settings)
          if (!parsed.success) return { error: 'Invalid settings' }
          await storageSet('sync', SETTINGS_KEY, parsed.data)
          return { ok: true }
        }
        case 'SETTINGS_VALIDATE_KEY': {
          const key = msg.apiKey as string
          return validateApiKey(key)
        }
        default: return { error: `Unknown message type: ${msg.type as string}` }
      }
    }
    handle().then(sendResponse).catch((err) => sendResponse({ error: String(err) }))
    return true // keep channel open for async response
  })

  // Open side panel on action click
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
      chrome.sidePanel.open({ tabId: tab.id }).catch((err) => logger.error('sidePanel.open failed', err))
    }
  })

  // Context menu
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'cp-explain',
      title: 'Explain with CodePilot',
      contexts: ['selection'],
    })
    chrome.contextMenus.create({
      id: 'cp-open',
      title: 'Open CodePilot',
      contexts: ['page', 'frame'],
    })
  })

  chrome.contextMenus.onClicked.addListener((_info, tab) => {
    if (tab?.id) {
      chrome.sidePanel.open({ tabId: tab.id }).catch((err) => logger.error('sidePanel.open failed', err))
    }
  })
}

async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { method: 'GET' }
    )
    if (resp.ok) return { valid: true }
    let message = `HTTP ${resp.status}`
    try {
      const body = await resp.json() as { error?: { message?: string } }
      message = body?.error?.message ?? message
    } catch { /* ignore */ }
    return { valid: false, error: message }
  } catch (err) {
    return { valid: false, error: `Network error: ${String(err)}` }
  }
}

// Suppress unused import warning — z is used in SettingsSchema validation path
void (z as unknown)
