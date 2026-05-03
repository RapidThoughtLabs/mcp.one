import { create } from 'zustand'
import type { ChatMessage, ProviderConfig, ToolCallResult, ToolCallRequest, TokenUsage } from '@/lib/chat-engine'

interface ChatState {
  // ── Provider ──────────────────────────────────────────────────
  provider: ProviderConfig | null
  providerPickerOpen: boolean
  setProvider: (config: ProviderConfig) => void
  clearProvider: () => void
  openProviderPicker: () => void
  closeProviderPicker: () => void

  // ── Active prompt template ────────────────────────────────────
  activeTemplateId: string
  setActiveTemplateId: (id: string) => void

  // ── Messages ──────────────────────────────────────────────────
  messages: ChatMessage[]
  addMessage: (msg: ChatMessage) => void
  updateMessageContent: (id: string, delta: string) => void
  finalizeMessage: (id: string, updates: Partial<ChatMessage>) => void
  updateToolCallResult: (msgId: string, result: ToolCallResult) => void
  addToolCallToMessage: (msgId: string, toolCall: ToolCallRequest) => void
  clearMessages: () => void

  // ── Model swap (no re-auth) ───────────────────────────────────
  setProviderModel: (model: string) => void

  // ── Token usage ───────────────────────────────────────────────
  tokenUsage: TokenUsage
  addUsage: (delta: TokenUsage) => void

  // ── Streaming ─────────────────────────────────────────────────
  isStreaming: boolean
  setStreaming: (v: boolean) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Provider
  provider: null,
  providerPickerOpen: false,

  setProvider: (config) => {
    // Store API key in sessionStorage only — never in zustand persist
    sessionStorage.setItem('chat_provider', JSON.stringify({ ...config, apiKey: '' }))
    sessionStorage.setItem('chat_apikey', config.apiKey)
    set({ provider: config, providerPickerOpen: false })
  },

  clearProvider: () => {
    sessionStorage.removeItem('chat_provider')
    sessionStorage.removeItem('chat_apikey')
    set({ provider: null })
  },

  openProviderPicker: () => set({ providerPickerOpen: true }),
  closeProviderPicker: () => set({ providerPickerOpen: false }),

  // Active template
  activeTemplateId: 'default',
  setActiveTemplateId: (id) => set({ activeTemplateId: id }),

  // Messages
  messages: [],

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  updateMessageContent: (id, delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: (m.content ?? '') + delta } : m,
      ),
    })),

  finalizeMessage: (id, updates) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, ...updates, isStreaming: false } : m,
      ),
    })),

  updateToolCallResult: (msgId, result) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== msgId) return m
        // Find the tool call in this message's toolCalls array
        // and attach the result so ToolCallBlock can display it
        const updatedToolCalls = m.toolCalls?.map((tc) =>
          tc.id === result.toolCallId ? tc : tc,
        )
        // Store results in a map keyed by toolCallId on the message
        const results = { ...(m as ChatMessage & { _results?: Record<string, ToolCallResult> })._results, [result.toolCallId]: result }
        return { ...m, toolCalls: updatedToolCalls, _results: results }
      }),
    })),

  addToolCallToMessage: (msgId, toolCall) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId
          ? { ...m, toolCalls: [...(m.toolCalls ?? []), toolCall] }
          : m,
      ),
    })),

  clearMessages: () => set({ messages: [], tokenUsage: { input: 0, output: 0, total: 0 } }),

  // Token usage
  tokenUsage: { input: 0, output: 0, total: 0 },

  addUsage: (delta) =>
    set((s) => ({
      tokenUsage: {
        input: s.tokenUsage.input + delta.input,
        output: s.tokenUsage.output + delta.output,
        total: s.tokenUsage.total + delta.total,
      },
    })),

  setProviderModel: (model) => {
    const { provider } = get()
    if (!provider) return
    const updated = { ...provider, model }
    sessionStorage.setItem('chat_provider', JSON.stringify({ ...updated, apiKey: '' }))
    set({ provider: updated })
  },

  // Streaming
  isStreaming: false,
  setStreaming: (v) => set({ isStreaming: v }),
}))

/** Restore provider from sessionStorage on page load */
export function restoreProviderFromSession(): ProviderConfig | null {
  try {
    const raw = sessionStorage.getItem('chat_provider')
    const key = sessionStorage.getItem('chat_apikey')
    if (!raw || !key) return null
    const config = JSON.parse(raw) as ProviderConfig
    return { ...config, apiKey: key }
  } catch {
    return null
  }
}

// Extend ChatMessage type to allow internal _results map
declare module '@/lib/chat-engine' {
  interface ChatMessage {
    _results?: Record<string, ToolCallResult>
  }
}
