import { useRef, useEffect, useState } from 'react'
import { Send, Square, Paperclip, X, FileText } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface ChatInputProps {
  onSend: (content: string) => void
  onStop: () => void
  isStreaming: boolean
  disabled?: boolean
}

interface AttachedFile {
  name: string
  content: string
}

export function ChatInput({ onSend, onStop, isStreaming, disabled }: ChatInputProps) {
  const [value, setValue] = useState('')
  const [attached, setAttached] = useState<AttachedFile | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [value])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    const trimmed = value.trim()
    if ((!trimmed && !attached) || isStreaming) return

    let content = trimmed
    if (attached) {
      const fileBlock = `<attached-file name="${attached.name}">\n${attached.content}\n</attached-file>`
      content = trimmed ? `${fileBlock}\n\n${trimmed}` : fileBlock
      setAttached(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }

    onSend(content)
    setValue('')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setAttached({ name: file.name, content: ev.target?.result as string })
    }
    reader.readAsText(file)
  }

  const canSend = (!!value.trim() || !!attached) && !disabled

  return (
    <div
      style={{
        padding: '12px 16px 14px',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
      }}
    >
      {/* File chip */}
      {attached && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.1)',
            border: '1px solid hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.25)',
            borderRadius: 6,
            padding: '4px 8px',
            width: 'fit-content',
            maxWidth: '100%',
          }}
        >
          <FileText size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {attached.name}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0 }}>
            {attached.content.split('\n').length} lines
          </span>
          <button
            onClick={() => {
              setAttached(null)
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--text-dim)', flexShrink: 0 }}
          >
            <X size={11} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        {/* Hidden file input — .md only */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {/* Attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isStreaming}
          title="Attach .md file"
          style={{
            background: 'none',
            border: '1px solid var(--border2)',
            borderRadius: 8,
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: disabled || isStreaming ? 'not-allowed' : 'pointer',
            color: attached ? 'var(--accent)' : 'var(--text-dim)',
            flexShrink: 0,
            opacity: disabled ? 0.5 : 1,
            transition: 'color 0.15s, border-color 0.15s',
          }}
        >
          <Paperclip size={14} />
        </button>

        <div style={{ flex: 1, position: 'relative' }}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled
                ? 'Connect an LLM provider to start chatting...'
                : attached
                ? 'Add a message or send the file as-is...'
                : 'Send a message... (⇧↩ for new line)'
            }
            rows={1}
            disabled={disabled || isStreaming}
            style={{
              width: '100%',
              background: 'var(--bg)',
              border: '1px solid var(--border2)',
              borderRadius: 8,
              padding: '8px 14px',
              color: 'var(--text)',
              fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
              outline: 'none',
              resize: 'none',
              lineHeight: 1.5,
              minHeight: 36,
              maxHeight: 120,
              transition: 'border-color 0.15s, box-shadow 0.2s',
              letterSpacing: '0.02em',
              opacity: disabled ? 0.5 : 1,
              boxSizing: 'border-box',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor =
                'hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.5)'
              e.currentTarget.style.boxShadow =
                '0 0 0 3px hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.08)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border2)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          />
        </div>

        {isStreaming ? (
          <Button
            variant="cancel"
            onClick={onStop}
            style={{ flexShrink: 0, width: 36, height: 36, borderRadius: '50%', padding: 0 }}
          >
            <Square size={12} />
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!canSend}
            onClick={handleSend}
            style={{ flexShrink: 0, width: 36, height: 36, borderRadius: '50%', padding: 0 }}
          >
            <Send size={14} />
          </Button>
        )}
      </div>
    </div>
  )
}
