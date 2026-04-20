export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  enum?: string[]
  properties?: Record<string, ToolParameter>
  required?: string[]
  items?: ToolParameter
}

export interface FunctionDeclaration {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolParameter>
    required?: string[]
  }
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  result: string
  isError: boolean
}

export type ToolName = 'read_file' | 'write_file' | 'search_code' | 'explain_selection'
