export type MessageRole = 'user' | 'model' | 'tool'

export interface TextPart {
  type: 'text'
  text: string
}

export interface ToolCallPart {
  type: 'tool_call'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

export interface ToolResultPart {
  type: 'tool_result'
  toolCallId: string
  toolName: string
  result: string
  isError?: boolean
}

export type MessagePart = TextPart | ToolCallPart | ToolResultPart

export interface Message {
  id: string
  role: MessageRole
  parts: MessagePart[]
  timestamp: number
}

export type StreamChunk =
  | { type: 'text'; payload: string }
  | { type: 'tool_call'; payload: { id: string; name: string; args: Record<string, unknown> } }
  | { type: 'tool_result'; payload: { id: string; name: string; result: string } }
  | { type: 'done'; payload: { totalTokens?: number } }
  | { type: 'error'; payload: string }

export type PortMessage =
  | { type: 'CHAT_SEND'; sessionId: string; content: string }
  | { type: 'CHAT_CANCEL' }
  | StreamChunk
