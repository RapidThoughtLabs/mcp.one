import { useEffect, useRef } from 'react'
import { Settings2, Bot, Zap } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useChat } from '@/hooks/useChat'
import { useLlmStore } from '@/stores/llm-store'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ProviderPicker } from './ProviderPicker'
import { TypingIndicator } from './TypingIndicator'

export function ChatView() {
  const {
    messages,
    isStreaming,
    isConnected,
    provider,
    providerPickerOpen,
    activeTemplateId,
    tokenUsage,
    send,
    stop,
    clear,
    switchModel,
    openProviderPicker,
    closeProviderPicker,
    setProvider,
    clearProvider,
    setActiveTemplateId,
  } = useChat()

  function formatTokens(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  }

  const { getModels, customModels } = useLlmStore()

  const bottomRef = useRef<HTMLDivElement>(null)

  const providerName = provider?.provider
  const builtInModels = providerName ? getModels(providerName).filter(
    (m) => !customModels[providerName].includes(m)
  ) : []
  const customModelList = providerName ? customModels[providerName] : []

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const visibleMessages = messages.filter((m) => m.role !== 'tool')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Topbar */}
      <div
        style={{
          height: 42,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          flexShrink: 0,
          gap: 10,
        }}
      >
        <span style={{ fontSize: '0.85rem', letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
          <span style={{ color: 'var(--accent)' }}>heku</span> / chat
        </span>

        {/* Template selector */}
        <select
          value={activeTemplateId}
          onChange={(e) => setActiveTemplateId(e.target.value)}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '2px 8px',
            color: 'var(--text-dim)',
            fontSize: '0.69rem',
            fontFamily: "'JetBrains Mono', monospace",
            cursor: 'pointer',
            letterSpacing: '0.06em',
            outline: 'none',
          }}
        >
          <option value="default">default</option>
          <option value="config-builder">config-builder</option>
          <option value="full-agent">full-agent</option>
          <option value="demo">demo</option>
        </select>

        <div style={{ flex: 1 }} />

        {/* Connection status */}
        {isConnected ? (
          <>
            <Badge variant="online" style={{ padding: '5px 10px' }}>
              <Zap size={8} style={{ marginRight: 4 }} />
              {provider!.provider}
            </Badge>
            <select
              value={provider!.model}
              onChange={(e) => switchModel(e.target.value)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '2px 8px',
                color: 'var(--text-dim)',
                fontSize: '0.69rem',
                fontFamily: "'JetBrains Mono', monospace",
                cursor: 'pointer',
                letterSpacing: '0.06em',
                outline: 'none',
                maxWidth: 200,
              }}
            >
              <optgroup label="Provided">
                {builtInModels.map((m) => (
                  <option key={m} value={m} style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                    {m.split('/').pop()}
                  </option>
                ))}
              </optgroup>
              {customModelList.length > 0 && (
                <optgroup label="Custom">
                  {customModelList.map((m) => (
                    <option key={m} value={m} style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                      {m.split('/').pop()}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {tokenUsage.total > 0 && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {[
                  { label: '↓', value: tokenUsage.input },
                  { label: '↑', value: tokenUsage.output },
                  { label: 'Σ', value: tokenUsage.total },
                ].map(({ label, value }) => (
                  <span
                    key={label}
                    style={{
                      background: 'var(--accent-dim)',
                      color: 'var(--accent)',
                      borderRadius: 3,
                      padding: '1px 5px',
                      fontSize: '0.69rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label} {formatTokens(value)}
                  </span>
                ))}
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={clearProvider}>
              disconnect
            </Button>
          </>
        ) : (
          <>
            <Badge variant="offline">not connected</Badge>
            <Button size="sm" variant="ghost" onClick={openProviderPicker}>
              <Settings2 size={11} style={{ marginRight: 5 }} />
              Connect
            </Button>
          </>
        )}

        {messages.length > 0 && (
          <Button size="sm" variant="ghost" onClick={clear}>
            clear
          </Button>
        )}
      </div>

      {/* Chat messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 20px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {visibleMessages.length === 0 ? (
          /* Empty state */
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              opacity: 0.5,
              paddingBottom: 60,
            }}
          >
            <Bot size={28} style={{ color: 'var(--accent)' }} />
            <div
              style={{
                fontSize: '0.85rem',
                color: 'var(--text-dim)',
                letterSpacing: '0.08em',
                textAlign: 'center',
                lineHeight: 1.8,
              }}
            >
              {isConnected
                ? 'Start a conversation · ask about your MCP configs'
                : 'Connect an LLM provider to start chatting'}
            </div>
            {isConnected && (
              <div
                style={{
                  fontSize: '0.69rem',
                  color: 'var(--text-dim)',
                  letterSpacing: '0.06em',
                  lineHeight: 2,
                  textAlign: 'center',
                  opacity: 0.7,
                }}
              >
                <div>try: "list my configs"</div>
                <div>try: "create a github config"</div>
                <div>try: "what tools does github expose?"</div>
              </div>
            )}
          </div>
        ) : (
          visibleMessages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))
        )}

        {/* Typing indicator — shows when streaming but no streaming message yet */}
        {isStreaming && !messages.some((m) => m.isStreaming) && (
          <div style={{ padding: '6px 0 6px 21px' }}>
            <TypingIndicator />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={send}
        onStop={stop}
        isStreaming={isStreaming}
        disabled={!isConnected}
      />

      {/* Provider picker modal */}
      <ProviderPicker
        open={providerPickerOpen}
        onClose={closeProviderPicker}
        onSave={setProvider}
        current={provider}
      />
    </div>
  )
}
