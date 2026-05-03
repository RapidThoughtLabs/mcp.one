// ── Provider ──────────────────────────────────────────────────────

export type ProviderName = 'openai' | 'togetherai'

export interface ProviderConfig {
  provider: ProviderName
  apiKey: string
  model: string
  baseUrl: string
}

export const PROVIDER_DEFAULTS: Record<ProviderName, { baseUrl: string; models: string[] }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini'],
  },
  togetherai: {
    baseUrl: 'https://api.together.xyz/v1',
    models: [
      'deepseek-ai/DeepSeek-V4-Pro',
      'Qwen/Qwen3.5-397B-A17B',
      'zai-org/GLM-5.1',
      'moonshotai/Kimi-K2.6',
    ],
  },
}

// ── Messages ──────────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCallRequest {
  id: string
  name: string      // e.g. "github.list_repos" or "one.list_configs"
  arguments: string // JSON string
}

export interface ToolCallResult {
  toolCallId: string
  name: string
  result: unknown
  durationMs: number
  isError: boolean
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string | null
  toolCalls?: ToolCallRequest[]
  toolResult?: ToolCallResult
  timestamp: number
  isStreaming?: boolean
}

// ── OpenAI Wire Format ────────────────────────────────────────────

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface OpenAIMessage {
  role: MessageRole
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

// ── Prompt System ─────────────────────────────────────────────────

export interface PromptLayer {
  id: string
  name: string
  description: string
  content: string
  tags: string[]
  required?: boolean
  variables?: string[]
}

export interface PromptTemplate {
  id: string
  name: string
  description: string
  layers: string[]
  tags: string[]
}

export interface PromptFile {
  version: 1
  layers: PromptLayer[]
  templates: PromptTemplate[]
}

// ── Token Usage ───────────────────────────────────────────────────

export interface TokenUsage {
  input: number
  output: number
  total: number
}

// ── Engine Callbacks (no React dependency) ────────────────────────

export interface ChatEngineCallbacks {
  onMessageStart: (msg: ChatMessage) => void
  onMessageDelta: (msgId: string, delta: string) => void
  onMessageComplete: (msg: ChatMessage) => void
  onToolCallStart: (msgId: string, toolCall: ToolCallRequest) => void
  onToolCallComplete: (msgId: string, result: ToolCallResult) => void
  onError: (error: Error) => void
  onUsage?: (usage: TokenUsage) => void
}
