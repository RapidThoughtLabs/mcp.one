/**
 * OpenAI-spec streaming chat completions adapter.
 * Works with OpenAI and Together AI (both use the same API spec).
 * Calls directly from the browser — no server proxy needed.
 * API keys stay in sessionStorage only.
 */

import type { ProviderConfig, OpenAITool, OpenAIMessage, ToolCallRequest, TokenUsage } from './types'

interface StreamCallbacks {
  onToken: (token: string) => void
  onToolCalls: (calls: ToolCallRequest[]) => void
  onDone: () => void
  onError: (err: Error) => void
  onUsage?: (usage: TokenUsage) => void
}

function serverLog(level: 'info' | 'warn' | 'error' | 'debug', msg: string) {
  fetch('/api/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, source: 'api', msg })
  }).catch(() => {})
}

export async function streamChatCompletion(
  config: ProviderConfig,
  messages: OpenAIMessage[],
  tools: OpenAITool[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  const startTime = Date.now()
  serverLog('info', `[LLM] Request started: ${config.model} via ${config.baseUrl}`)

  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 8192,
      }),
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    serverLog('error', `[LLM] Network error after ${Date.now() - startTime}ms: ${(err as Error).message}`)
    callbacks.onError(err as Error)
    return
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = await response.json() as { error?: { message?: string } }
      message = body?.error?.message ?? message
    } catch { /* ignore */ }

    if (response.status === 401) {
      serverLog('error', `[LLM] API Error 401 after ${Date.now() - startTime}ms: Invalid API key. ${message}`)
      callbacks.onError(new Error(`Invalid API key. ${message}`))
    } else if (response.status === 429) {
      serverLog('error', `[LLM] API Error 429 after ${Date.now() - startTime}ms: Rate limit exceeded. ${message}`)
      callbacks.onError(new Error(`Rate limit exceeded. ${message}`))
    } else if (response.status === 404) {
      serverLog('error', `[LLM] API Error 404 after ${Date.now() - startTime}ms: Model not found: ${config.model}. ${message}`)
      callbacks.onError(new Error(`Model not found: ${config.model}. ${message}`))
    } else {
      serverLog('error', `[LLM] API Error ${response.status} after ${Date.now() - startTime}ms: ${message}`)
      callbacks.onError(new Error(message))
    }
    return
  }

  if (!response.body) {
    callbacks.onError(new Error('No response body from LLM'))
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  // Accumulate streaming tool call chunks — LLM sends them in pieces
  const toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }> = {}
  let hasToolCalls = false
  let buffer = ''
  let usageTokens: any = null

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue

        let chunk: {
          choices?: Array<{
            delta?: {
              content?: string | null
              tool_calls?: Array<{
                index: number
                id?: string
                type?: string
                function?: { name?: string; arguments?: string }
              }>
            }
            finish_reason?: string | null
          }>
          usage?: {
            prompt_tokens: number
            completion_tokens: number
            total_tokens: number
          }
        }

        try {
          chunk = JSON.parse(trimmed.slice(6))
        } catch { continue }

        // Usage chunk arrives after the last delta (choices may be empty)
        if (chunk.usage && callbacks.onUsage) {
          usageTokens = chunk.usage
          callbacks.onUsage({
            input: chunk.usage.prompt_tokens,
            output: chunk.usage.completion_tokens,
            total: chunk.usage.total_tokens,
          })
        }

        const choice = chunk.choices?.[0]
        if (!choice) continue

        const delta = choice.delta

        // Text tokens
        if (delta?.content) {
          callbacks.onToken(delta.content)
        }

        // Tool call streaming — accumulate JSON pieces
        if (delta?.tool_calls) {
          hasToolCalls = true
          for (const tc of delta.tool_calls) {
            if (!toolCallAccumulator[tc.index]) {
              toolCallAccumulator[tc.index] = { id: '', name: '', arguments: '' }
            }
            const acc = toolCallAccumulator[tc.index]
            if (tc.id) acc.id = tc.id
            if (tc.function?.name) acc.name += tc.function.name
            if (tc.function?.arguments) acc.arguments += tc.function.arguments
          }
        }

        // Explicitly handle output truncation
        if (choice.finish_reason === 'length') {
          callbacks.onError(new Error("Generation stopped early because the model reached its output token limit (max_tokens). The output was truncated."));
          return;
        }

        // When finish_reason arrives, emit accumulated tool calls
        if (choice.finish_reason === 'tool_calls' || (choice.finish_reason === 'stop' && hasToolCalls)) {
          const calls: ToolCallRequest[] = Object.values(toolCallAccumulator).map((tc) => ({
            id: tc.id || crypto.randomUUID(),
            name: tc.name,
            arguments: tc.arguments,
          }))
          if (calls.length > 0) {
            callbacks.onToolCalls(calls)
          }
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    serverLog('error', `[LLM] Streaming error after ${Date.now() - startTime}ms: ${(err as Error).message}`)
    callbacks.onError(err as Error)
    return
  }

  const duration = Date.now() - startTime
  const usageStr = usageTokens ? ` (Tokens: In=${usageTokens.prompt_tokens}, Out=${usageTokens.completion_tokens}, Total=${usageTokens.total_tokens})` : ''
  serverLog('info', `[LLM] Request completed in ${duration}ms${usageStr}`)

  callbacks.onDone()
}
