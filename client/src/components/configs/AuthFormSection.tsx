import { type ReactNode } from 'react'

export type AuthType = 'none' | 'bearer' | 'basic' | 'api_key' | 'oauth2_static'

export interface AuthFields {
  authType: AuthType
  bearerTokenEnv: string
  bearerAuthUrl: string
  basicUsernameEnv: string
  basicTokenEnv: string
  apiKeyEnv: string
  apiKeyHeader: string
  oauth2TokenEnv: string
}

export const DEFAULT_AUTH_FIELDS: AuthFields = {
  authType: 'none',
  bearerTokenEnv: '',
  bearerAuthUrl: '',
  basicUsernameEnv: '',
  basicTokenEnv: '',
  apiKeyEnv: '',
  apiKeyHeader: 'X-API-Key',
  oauth2TokenEnv: '',
}

interface AuthFormSectionProps {
  fields: AuthFields
  onChange: (fields: AuthFields) => void
  errors?: Record<string, string>
  lockedType?: AuthType
  labels?: { usernameEnv?: string; tokenEnv?: string }
}

const AUTH_OPTIONS: { value: AuthType; label: string; desc: string }[] = [
  { value: 'none',          label: 'None',          desc: 'No authentication required' },
  { value: 'bearer',        label: 'Bearer Token',  desc: 'Authorization: Bearer <token>' },
  { value: 'basic',         label: 'Basic Auth',    desc: 'Username + password credentials' },
  { value: 'api_key',       label: 'API Key',       desc: 'Custom header (e.g. X-API-Key)' },
  { value: 'oauth2_static', label: 'OAuth2 Static', desc: 'Pre-obtained OAuth access token' },
]

const inputStyle: React.CSSProperties = {
  background: 'var(--surface2)',
  border: '1px solid var(--border2)',
  borderRadius: 5,
  padding: '7px 10px',
  fontSize: 11,
  color: 'var(--text)',
  fontFamily: 'inherit',
  letterSpacing: '0.02em',
  outline: 'none',
  width: '100%',
  transition: 'border-color 0.12s',
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.07em' }}>{label}</label>
      {children}
      {hint && !error && <span style={{ fontSize: 9, color: 'var(--text-dim)', opacity: 0.7, lineHeight: 1.4 }}>{hint}</span>}
      {error && <span style={{ fontSize: 9, color: 'var(--red)', letterSpacing: '0.03em' }}>{error}</span>}
    </div>
  )
}

export function AuthFormSection({ fields, onChange, errors = {}, lockedType, labels }: AuthFormSectionProps) {
  const set = (partial: Partial<AuthFields>) => onChange({ ...fields, ...partial })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Auth type selector — hidden when lockedType is set */}
      {!lockedType && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.07em' }}>AUTH TYPE</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {AUTH_OPTIONS.map((opt) => {
            const active = fields.authType === opt.value
            return (
              <label
                key={opt.value}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 5, cursor: 'pointer',
                  background: active ? 'var(--accent-dim)' : 'var(--surface2)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  transition: 'all 0.12s',
                }}
              >
                <input
                  type="radio"
                  name="authType"
                  value={opt.value}
                  checked={active}
                  onChange={() => set({ authType: opt.value })}
                  style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600, letterSpacing: '0.02em' }}>{opt.label}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.3 }}>{opt.desc}</div>
                </div>
              </label>
            )
          })}
        </div>
      </div>
      )}

      {/* Bearer fields */}
      {fields.authType === 'bearer' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <Field label="TOKEN ENV VAR *" hint="Name of the env var holding your bearer token (stored on your machine, never sent to us)" error={errors['auth.token_env']}>
            <input
              style={{ ...inputStyle, borderColor: errors['auth.token_env'] ? 'rgba(255,95,87,0.5)' : 'var(--border2)' }}
              value={fields.bearerTokenEnv}
              onChange={(e) => set({ bearerTokenEnv: e.target.value })}
              placeholder="e.g. MY_API_TOKEN"
            />
          </Field>
          <Field label="AUTH URL (optional)" hint="Where users can create or manage this token">
            <input
              style={inputStyle}
              value={fields.bearerAuthUrl}
              onChange={(e) => set({ bearerAuthUrl: e.target.value })}
              placeholder="e.g. https://example.com/settings/tokens"
            />
          </Field>
        </div>
      )}

      {/* Basic auth fields */}
      {(fields.authType === 'basic' || lockedType === 'basic') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <Field label={labels?.usernameEnv ?? 'USERNAME ENV VAR *'} error={errors['auth.username_env']}>
            <input
              style={{ ...inputStyle, borderColor: errors['auth.username_env'] ? 'rgba(255,95,87,0.5)' : 'var(--border2)' }}
              value={fields.basicUsernameEnv}
              onChange={(e) => set({ basicUsernameEnv: e.target.value })}
              placeholder="e.g. MY_SERVICE_USER"
            />
          </Field>
          <Field label={labels?.tokenEnv ?? 'PASSWORD ENV VAR *'} error={errors['auth.token_env']}>
            <input
              style={{ ...inputStyle, borderColor: errors['auth.token_env'] ? 'rgba(255,95,87,0.5)' : 'var(--border2)' }}
              value={fields.basicTokenEnv}
              onChange={(e) => set({ basicTokenEnv: e.target.value })}
              placeholder="e.g. MY_SERVICE_PASS"
            />
          </Field>
        </div>
      )}

      {/* API Key fields */}
      {fields.authType === 'api_key' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <Field label="API KEY ENV VAR *" error={errors['auth.key_env']}>
            <input
              style={{ ...inputStyle, borderColor: errors['auth.key_env'] ? 'rgba(255,95,87,0.5)' : 'var(--border2)' }}
              value={fields.apiKeyEnv}
              onChange={(e) => set({ apiKeyEnv: e.target.value })}
              placeholder="e.g. MY_API_KEY"
            />
          </Field>
          <Field label="HEADER NAME" hint="The HTTP header the key is sent in">
            <input
              style={inputStyle}
              value={fields.apiKeyHeader}
              onChange={(e) => set({ apiKeyHeader: e.target.value })}
              placeholder="X-API-Key"
            />
          </Field>
        </div>
      )}

      {/* OAuth2 static fields */}
      {fields.authType === 'oauth2_static' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <Field label="ACCESS TOKEN ENV VAR *" error={errors['auth.token_env']}>
            <input
              style={{ ...inputStyle, borderColor: errors['auth.token_env'] ? 'rgba(255,95,87,0.5)' : 'var(--border2)' }}
              value={fields.oauth2TokenEnv}
              onChange={(e) => set({ oauth2TokenEnv: e.target.value })}
              placeholder="e.g. MY_OAUTH_TOKEN"
            />
          </Field>
        </div>
      )}
    </div>
  )
}
