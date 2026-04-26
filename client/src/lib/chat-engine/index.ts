/**
 * ChatEngine — the main entry point for the chat module.
 *
 * Zero React imports. Communicates via callbacks.
 * Extractable into its own package for other RTL products.
 */

import { runToolLoop, type ToolExecutor, type ToolLoopOptions } from './tool-loop'
import { composeSystemPrompt } from './prompt-loader'
import type {
  ProviderConfig,
  ChatMessage,
  ChatEngineCallbacks,
  PromptFile,
} from './types'

export type { ProviderConfig, ChatMessage, ChatEngineCallbacks, ToolExecutor, PromptFile }
export type { ToolCallRequest, ToolCallResult, OpenAITool, PromptLayer, PromptTemplate } from './types'
export { PROVIDER_DEFAULTS } from './types'
export { buildConfigCatalog, composeSystemPrompt } from './prompt-loader'

export interface ChatEngineOptions {
  maxIterations?: number
}

export class ChatEngine {
  private messages: ChatMessage[] = []
  private abortController: AbortController | null = null
  private systemPrompt: string = ''
  private isRunning = false

  constructor(
    private llmConfig: ProviderConfig,
    private executor: ToolExecutor,
    private callbacks: ChatEngineCallbacks,
    private options: ChatEngineOptions = {},
  ) {}

  /**
   * Set the system prompt (built from layers + variable injection).
   * Call this after fetching config catalog.
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt
  }

  /** Build and set system prompt from a PromptFile + template + variables */
  buildSystemPrompt(
    promptFile: PromptFile,
    templateId: string,
    variables: Record<string, string> = {},
  ): void {
    this.systemPrompt = composeSystemPrompt(promptFile, templateId, variables)
  }

  /** Send a user message and run the full tool loop */
  async send(content: string): Promise<void> {
    if (this.isRunning) return

    this.isRunning = true
    this.abortController = new AbortController()

    // Create and emit user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    this.callbacks.onMessageStart(userMsg)
    this.messages.push(userMsg)

    const loopOptions: ToolLoopOptions = {
      maxIterations: this.options.maxIterations ?? 25,
      signal: this.abortController.signal,
    }

    try {
      const updatedHistory = await runToolLoop(
        this.llmConfig,
        this.messages,
        this.systemPrompt,
        this.executor,
        this.callbacks,
        loopOptions,
      )
      // Sync history — exclude the user message we already pushed
      this.messages = updatedHistory
    } finally {
      this.isRunning = false
      this.abortController = null
    }
  }

  /** Stop the current generation */
  abort(): void {
    this.abortController?.abort()
  }

  /** Get the full message history (includes tool result messages) */
  getMessages(): ChatMessage[] {
    return [...this.messages]
  }

  /** Clear conversation and reset state */
  reset(): void {
    this.messages = []
    this.abort()
  }

  /** Swap LLM provider mid-conversation */
  setProvider(config: ProviderConfig): void {
    this.llmConfig = config
  }

  get running(): boolean {
    return this.isRunning
  }
}
