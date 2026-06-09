import { Terminal, FileText, Database, Cylinder, FlaskConical, AlertTriangle } from 'lucide-react'
import { JsonPreview } from '@/components/configs/JsonPreview'

// ── Snippet data ───────────────────────────────────────────────────

const CLI_SNIPPET = {
  id: 'gh-cli',
  name: 'GitHub CLI',
  connector: {
    type: 'cli',
    shell: false,
    timeout_ms: 10000,
  },
  tools: [
    {
      name: 'pr_list',
      description: 'List open pull requests',
      params: [
        { name: 'limit', type: 'number', required: false, description: 'Max results to return' },
      ],
      command: 'gh',
      args_template: ['pr', 'list', '--limit', '{{limit}}'],
      output_as: 'json',
    },
  ],
}

const FILE_SNIPPET = {
  id: 'fs-read',
  name: 'Filesystem Read',
  connector: {
    type: 'file',
    base_path: '/home/user/documents',
  },
  tools: [
    {
      name: 'read_file',
      description: 'Read a file from the documents directory',
      params: [
        { name: 'path', type: 'string', required: true, description: 'Relative path within base directory' },
      ],
      operation: 'read',
      path_template: '{{path}}',
    },
  ],
}

const SQL_SNIPPET = {
  id: 'my-postgres',
  name: 'App Database',
  connector: {
    type: 'sql',
    dialect: 'postgres',
    connection_string_env: 'DATABASE_URL',
  },
  tools: [
    {
      name: 'get_users',
      description: 'Fetch active users from the database',
      params: [
        { name: 'limit', type: 'number', required: false, description: 'Max rows to return' },
      ],
      sql: 'SELECT id, name, email FROM users WHERE active = true LIMIT :limit',
      max_rows: 100,
    },
  ],
}

const MONGO_SNIPPET = {
  id: 'my-mongo',
  name: 'App MongoDB',
  connector: {
    type: 'mongodb',
    connection_string_env: 'MONGODB_URI',
    database: 'myapp',
  },
  tools: [
    {
      name: 'find_users',
      description: 'Find users matching a filter',
      params: [
        { name: 'active', type: 'boolean', required: false, description: 'Filter by active status' },
      ],
      operation: 'find',
      collection: 'users',
      filter_template: { active: '{{active}}' },
      limit: 100,
    },
  ],
}

// ── Per-connector metadata ─────────────────────────────────────────

interface ConnectorMeta {
  type: string
  label: string
  Icon: React.FC<{ size?: number; style?: React.CSSProperties }>
  tagline: string
  caveats: string[]
  whenToUse: string
  snippet: object
}

const CONNECTORS: ConnectorMeta[] = [
  {
    type: 'cli',
    label: 'CLI',
    Icon: Terminal,
    tagline: 'Wrap a local command-line tool as MCP tools',
    caveats: [
      'Current implementation defaults shell to true — enables shell injection if params contain special characters. Always set "shell": false and use args_template (not command string templates) until the redesign ships.',
      'Redesign drafted (docs/cli-connector-redesign-brainstorm.md) — CLI will graduate to a primary connector post v0.1.0.',
    ],
    whenToUse: 'Trusted local CLIs (gh, kubectl, docker) where the binary is fixed and you control the environment. Not for arbitrary command execution.',
    snippet: CLI_SNIPPET,
  },
  {
    type: 'file',
    label: 'File',
    Icon: FileText,
    tagline: 'Read and write local files via MCP tools',
    caveats: [
      'Path-jail enforcement (base_path containment) has not been fully audited — a crafted path_template could escape the base directory.',
      'Write and delete operations have no confirmation primitive — the LLM can overwrite or delete files without a second check.',
    ],
    whenToUse: 'Read-only access to a tightly scoped directory you own. Avoid write/delete operations until the path-jail audit is complete.',
    snippet: FILE_SNIPPET,
  },
  {
    type: 'sql',
    label: 'SQL',
    Icon: Database,
    tagline: 'Query a PostgreSQL, MySQL, or SQLite database',
    caveats: [
      'Parameter binding is per-dialect — the :name placeholder syntax works for postgres and mysql, but sqlite uses ? positional binding. Cross-dialect configs are not guaranteed to be portable.',
      'max_rows is per-tool only; there is no global cap. A tool without max_rows set will stream unbounded result sets.',
    ],
    whenToUse: 'Read-heavy analytical queries against a database you own. Set max_rows on every tool. Avoid write tools until the binding strategy is unified.',
    snippet: SQL_SNIPPET,
  },
  {
    type: 'mongodb',
    label: 'MongoDB',
    Icon: Cylinder,
    tagline: 'Query a MongoDB collection via MCP tools',
    caveats: [
      'filter_template, update_template, and pipeline_template are unvalidated Record<string, unknown> — MongoDB operator injection ($where, $function) is possible if the LLM constructs the filter from untrusted input.',
      'No UI support — configs must be authored by hand. The editor will load existing configs but there is no guided create flow.',
    ],
    whenToUse: 'Read queries (find, findOne, aggregate) against a collection you own. Avoid update/delete operations until operator injection guards are in place.',
    snippet: MONGO_SNIPPET,
  },
]

// ── Sub-components ─────────────────────────────────────────────────

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.69rem', letterSpacing: '0.1em', color: 'var(--text-dim)',
  textTransform: 'uppercase', marginBottom: 6,
}

function CaveatList({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AlertTriangle size={10} style={{ color: 'rgba(255,200,0,0.7)', flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.55, letterSpacing: '0.01em' }}>
            {item}
          </span>
        </div>
      ))}
    </div>
  )
}

function AuthorInstructions() {
  return (
    <div style={{
      marginTop: 10, padding: '8px 12px',
      background: 'var(--surface3, rgba(255,255,255,0.03))',
      border: '1px solid var(--border)', borderRadius: 5,
    }}>
      <div style={sectionTitleStyle}>How to author</div>
      <ol style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[
          'Copy the snippet above and fill in your values.',
          'Save as mcp-configs/mcp.{your-id}.json alongside your other configs.',
          'heku hot-reloads — no restart needed.',
          'The config will appear in Configs with an "experimental" tag.',
        ].map((step, i) => (
          <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.5, letterSpacing: '0.01em' }}>
            {step}
          </li>
        ))}
      </ol>
    </div>
  )
}

function ConnectorCard({ meta }: { meta: ConnectorMeta }) {
  const { label, Icon, tagline, caveats, whenToUse, snippet } = meta

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* Top accent bar */}
      <div style={{ height: 2, background: 'rgba(255,200,0,0.5)' }} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
      }}>
        <Icon size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.04em' }}>
          {label}
        </span>
        <span style={{
          fontSize: '0.69rem', padding: '2px 8px', borderRadius: 99,
          letterSpacing: '0.06em',
          background: 'rgba(255,200,0,0.12)', color: 'rgba(255,200,0,0.85)',
          border: '1px solid rgba(255,200,0,0.2)',
        }}>
          experimental
        </span>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginLeft: 2 }}>
          {tagline}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Caveats */}
        <div>
          <div style={sectionTitleStyle}>Why experimental</div>
          <CaveatList items={caveats} />
        </div>

        {/* When to use */}
        <div>
          <div style={sectionTitleStyle}>When to use</div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.55, letterSpacing: '0.01em' }}>
            {whenToUse}
          </p>
        </div>

        {/* Snippet */}
        <div>
          <div style={sectionTitleStyle}>Minimal config</div>
          <JsonPreview json={snippet} maxHeight={320} />
          <AuthorInstructions />
        </div>

      </div>
    </div>
  )
}

// ── Main view ──────────────────────────────────────────────────────

export function ExperimentalView() {
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {/* Page header */}
      <div style={{
        height: 42, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, flexShrink: 0,
        position: 'sticky', top: 0, zIndex: 1,
      }}>
        <FlaskConical size={13} style={{ color: 'var(--text-dim)' }} />
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', letterSpacing: '0.08em' }}>
          Experimental
        </span>
      </div>

      <div style={{ padding: '20px 20px 48px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Intro blurb */}
        <div style={{
          padding: '12px 14px',
          background: 'rgba(255,200,0,0.04)',
          border: '1px solid rgba(255,200,0,0.15)',
          borderRadius: 6,
          marginBottom: 8,
        }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.6, letterSpacing: '0.01em' }}>
            These connector types ship with heku but are outside the v0.1.0 supported surface. The runtime executes them, but each has known rough edges documented below. There is no designer UI — power users can author configs by hand using the snippets provided. Self-authored configs appear in{' '}
            <span style={{ color: 'var(--text)' }}>Configs</span>
            {' '}with an <span style={{ color: 'rgba(255,200,0,0.85)' }}>experimental</span> tag and are editable through the available UI.
          </p>
        </div>

        {/* Connector cards */}
        {CONNECTORS.map((meta) => (
          <ConnectorCard key={meta.type} meta={meta} />
        ))}
      </div>
    </div>
  )
}
