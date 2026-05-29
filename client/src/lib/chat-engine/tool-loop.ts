/**
 * Agentic tool loop.
 *
 * All tools are equal — one.list_configs, github.create_issue, one.create_config
 * all go through the same executor.callTool path. No client-side interception.
 *
 * Progressive discovery happens naturally: the LLM calls one.list_configs,
 * gets the catalog, then calls one.list_tools to see specific tools, then calls them.
 */

import { streamChatCompletion } from './llm-client'
import type {
  ProviderConfig,
  ChatMessage,
  OpenAITool,
  OpenAIMessage,
  ToolCallRequest,
  ToolCallResult,
  ChatEngineCallbacks,
} from './types'

export interface ToolExecutor {
  callTool: (name: string, args: Record<string, unknown>) => Promise<{
    ok: boolean
    result: unknown
    durationMs: number
  }>
  getTools: () => Promise<OpenAITool[]>
}

export interface ToolLoopOptions {
  maxIterations?: number  // default: 25
  signal?: AbortSignal
}

function genId(): string {
  return crypto.randomUUID()
}

// Hard cap on tool result size sent to the LLM.
// Large payloads (e.g. Context7 doc fetches) cause context-overflow 400s on the next turn.
const MAX_TOOL_RESULT_CHARS = 32_000

/** Convert internal ChatMessage history to OpenAI API wire format */
function toOpenAIMessages(messages: ChatMessage[], systemPrompt: string): OpenAIMessage[] {
  const result: OpenAIMessage[] = [
    { role: 'system', content: systemPrompt },
  ]

  for (const msg of messages) {
    if (msg.role === 'system') continue // handled above

    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: msg.content ?? null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        })
      } else {
        result.push({ role: 'assistant', content: msg.content })
      }
    } else if (msg.role === 'tool' && msg.toolResult) {
      let content = JSON.stringify(msg.toolResult.result)
      if (content.length > MAX_TOOL_RESULT_CHARS) {
        content = content.slice(0, MAX_TOOL_RESULT_CHARS) + `\n...[truncated — ${content.length} chars total]`
      }
      result.push({
        role: 'tool',
        content,
        tool_call_id: msg.toolResult.toolCallId,
        name: msg.toolResult.name,
      })
    }
  }

  return result
}

export async function runToolLoop(
  llmConfig: ProviderConfig,
  messages: ChatMessage[],
  systemPrompt: string,
  executor: ToolExecutor,
  callbacks: ChatEngineCallbacks,
  options: ToolLoopOptions = {},
): Promise<ChatMessage[]> {
  const maxIter = options.maxIterations ?? 25
  const signal = options.signal

  const history = [...messages]
  let iteration = 0

  // one.* tool list is stable for the lifetime of a turn — fetch once.
  // Service tools are discovered via one.search/one.get_tool and called
  // directly; they never appear in the function list.
  const tools = await executor.getTools()

  while (iteration < maxIter) {
    iteration++

    // Build LLM messages from history
    const openAiMessages = toOpenAIMessages(history, systemPrompt)

    // Stream the LLM response
    let accumulatedContent = ''
    let pendingToolCalls: ToolCallRequest[] = []
    let streamError: Error | null = null
    let messageStarted = false

    // Create the assistant message placeholder for streaming
    const assistantMsgId = genId()

    await new Promise<void>((resolve) => {
      streamChatCompletion(
        llmConfig,
        openAiMessages,
        tools,
        {
          onToken: (token) => {
            if (accumulatedContent === '' && !pendingToolCalls.length) {
              // First token — start the message
              const msg: ChatMessage = {
                id: assistantMsgId,
                role: 'assistant',
                content: token,
                timestamp: Date.now(),
                isStreaming: true,
              }
              callbacks.onMessageStart(msg)
              messageStarted = true
            }
            accumulatedContent += token
            callbacks.onMessageDelta(assistantMsgId, token)
          },
          onToolCalls: (calls) => {
            pendingToolCalls = calls
          },
          onDone: () => {
            resolve()
          },
          onError: (err) => {
            streamError = err
            resolve()
          },
          onUsage: callbacks.onUsage,
        },
        signal,
      )
    })

    if (streamError) {
      callbacks.onError(streamError)
      return history
    }

    if (signal?.aborted) {
      if (messageStarted) {
        callbacks.onMessageComplete({
          id: assistantMsgId,
          role: 'assistant',
          content: accumulatedContent || null,
          timestamp: Date.now(),
          isStreaming: false,
        })
      }
      return history
    }

    // ── Case 1: Text response (no tool calls) — done ──────────────
    if (pendingToolCalls.length === 0) {
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: accumulatedContent,
        timestamp: Date.now(),
        isStreaming: false,
      }
      callbacks.onMessageComplete(assistantMsg)
      history.push(assistantMsg)
      return history
    }

    // ── Case 2: Tool calls — execute and loop ─────────────────────

    // Emit the assistant message with tool calls
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: accumulatedContent || null,
      toolCalls: pendingToolCalls,
      timestamp: Date.now(),
      isStreaming: false,
    }
    // If streaming already started for this message, finalize in-place to
    // avoid adding a second entry with the same id (duplicate key warning).
    if (messageStarted) {
      callbacks.onMessageComplete(assistantMsg)
    } else {
      callbacks.onMessageStart(assistantMsg)
    }
    history.push(assistantMsg)

    // Execute all tool calls (parallel)
    const toolResults = await Promise.all(
      pendingToolCalls.map(async (tc) => {
        callbacks.onToolCallStart(assistantMsgId, tc)

        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(tc.arguments) as Record<string, unknown>
        } catch {
          args = {}
        }

        const { ok, result, durationMs } = await executor.callTool(tc.name, args)

        const toolResult: ToolCallResult = {
          toolCallId: tc.id,
          name: tc.name,
          result,
          durationMs,
          isError: !ok,
        }

        callbacks.onToolCallComplete(assistantMsgId, toolResult)
        return toolResult
      }),
    )

    // Add tool result messages to history
    for (const tr of toolResults) {
      const toolMsg: ChatMessage = {
        id: genId(),
        role: 'tool',
        content: JSON.stringify(tr.result),
        toolResult: tr,
        timestamp: Date.now(),
      }
      history.push(toolMsg)
    }

    // Loop back to LLM with tool results
  }

  callbacks.onError(new Error(`Max iterations (${maxIter}) reached`))
  return history
}
