import { type ReactNode } from 'react'

interface BadgeProps {
  variant?: 'online' | 'offline' | 'error' | 'info' | 'warn'
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}

const variantStyles = {
  online: { background: 'var(--accent-dim)', color: 'var(--accent)' },
  offline: { background: 'rgba(120,120,112,0.12)', color: 'var(--text-dim)' },
  error: { background: 'rgba(255,95,87,0.1)', color: 'var(--red)' },
  info: { background: 'var(--accent-dim)', color: 'var(--accent)' },
  warn: { background: 'rgba(254,188,46,0.1)', color: 'var(--yellow)' },
}

export function Badge({ variant = 'info', children, className = '', style }: BadgeProps) {
  return (
    <span
      className={className}
      style={{
        ...variantStyles[variant],
        fontSize: 9,
        padding: '2px 8px',
        borderRadius: 99,
        letterSpacing: '0.08em',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        ...style,
      }}
    >
      {children}
    </span>
  )
}
