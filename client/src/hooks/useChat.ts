/**
 * useChat — React hook that bridges ChatEngine to the chat-store.
 * Creates one ChatEngine instance per component mount.
 * Implements ToolExecutor by calling /api/tools/call for all tools.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import { useChatStore, restoreProviderFromSession } from '@/stores/chat-store'
import { useLlmStore } from '@/stores/llm-store'
import { api } from '@/lib/api'
import {
  ChatEngine,
  buildConfigCatalog,
  type ChatMessage,
  type ToolCallRequest,
  type ToolCallResult,
  type OpenAITool,
  type ToolExecutor,
} from '@/lib/chat-engine'
import type { McpTool } from '@/types/server'
import promptData from '@/prompts/default.json'

// Convert McpTool (server format) → OpenAI tool format
function mcpToOpenAI(tool: McpTool): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }
}

export function useChat() {
  const { tools, serverStatus, configs } = useAppStore()
  const {
    provider,
    providerPickerOpen,
    activeTemplateId,
    messages,
    isStreaming,
    tokenUsage,
    addMessage,
    updateMessageContent,
    finalizeMessage,
    updateToolCallResult,
    addUsage,
    clearMessages,
    setStreaming,
    setProviderModel,
    openProviderPicker,
    closeProviderPicker,
    setProvider,
    clearProvider,
    setActiveTemplateId,
  } = useChatStore()

  const { setSelectedModel } = useLlmStore()

  const engineRef = useRef<ChatEngine | null>(null)

  // Restore provider from session on first mount
  useEffect(() => {
    const restored = restoreProviderFromSession()
    if (restored) {
      setProvider(restored)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Create engine on first connect; update provider config (e.g. model swap) without
  // recreating it so in-flight conversation history is preserved.
  useEffect(() => {
    if (!provider) {
      engineRef.current = null
      return
    }

    if (engineRef.current) {
      engineRef.current.setProvider(provider)
      return
    }

    const executor: ToolExecutor = {
      callTool: async (name: string, args: Record<string, unknown>) => {
        const start = Date.now()
        try {
          const result = await api.post<{ ok: boolean; result: unknown }>(
            '/tools/call',
            { name, arguments: args },
          )
          return { ok: result.ok, result: result.result, durationMs: Date.now() - start }
        } catch (err) {
          return {
            ok: false,
            result: { error: (err as Error).message },
            durationMs: Date.now() - start,
          }
        }
      },

      getTools: async () => {
        try {
          const fresh = await api.get<McpTool[]>('/tools/manifest')
          return fresh.map(mcpToOpenAI)
        } catch {
          // Fallback to cached tools from app store
          return tools.map(mcpToOpenAI)
        }
      },
    }

    engineRef.current = new ChatEngine(provider, executor, {
      onMessageStart: (msg: ChatMessage) => {
        addMessage(msg)
        setStreaming(true)
      },
      onMessageDelta: (msgId: string, delta: string) => {
        updateMessageContent(msgId, delta)
      },
      onMessageComplete: (msg: ChatMessage) => {
        finalizeMessage(msg.id, { content: msg.content, toolCalls: msg.toolCalls, isStreaming: false })
        setStreaming(false)
      },
      onToolCallStart: (msgId: string, toolCall: ToolCallRequest) => {
        void msgId
        void toolCall
      },
      onToolCallComplete: (msgId: string, result: ToolCallResult) => {
        updateToolCallResult(msgId, result)
      },
      onError: (error: Error) => {
        setStreaming(false)
        addMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: `Error: ${error.message}`,
          timestamp: Date.now(),
        })
      },
      onUsage: (usage) => {
        addUsage(usage)
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  // Build system prompt when template or installed configs change
  const buildPrompt = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return

    const catalog = buildConfigCatalog(
      configs.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        connector_type: c.connector?.type ?? 'unknown',
        tool_count: c.toolCount,
      })),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine.buildSystemPrompt(promptData as any, activeTemplateId, {
      config_catalog: catalog,
    })
  }, [activeTemplateId, configs])

  useEffect(() => {
    buildPrompt()
  }, [buildPrompt])

  const send = useCallback(async (content: string) => {
    const engine = engineRef.current
    if (!engine || isStreaming) return

    if (!provider) {
      openProviderPicker()
      return
    }

    await engine.send(content)
  }, [isStreaming, provider, openProviderPicker])

  const stop = useCallback(() => {
    engineRef.current?.abort()
    setStreaming(false)
  }, [setStreaming])

  const clear = useCallback(() => {
    engineRef.current?.reset()
    clearMessages()
  }, [clearMessages])

  const switchModel = useCallback((model: string) => {
    if (!provider) return
    setProviderModel(model)
    setSelectedModel(provider.provider, model)
  }, [provider, setProviderModel, setSelectedModel])

  return {
    // State
    messages,
    isStreaming,
    isConnected: !!provider && serverStatus === 'online',
    provider,
    providerPickerOpen,
    activeTemplateId,
    tokenUsage,

    // Actions
    send,
    stop,
    clear,
    switchModel,
    openProviderPicker,
    closeProviderPicker,
    setProvider,
    clearProvider,
    setActiveTemplateId,
  }
}
