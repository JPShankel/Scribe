import { useMemo } from 'react'
import { CHARACTER_FIELDS, findMentions } from './store.js'

/** Sidebar section listing the cast. */
export function CharacterList({ characters, order, selectedId, open, onToggleOpen, onSelect, onAdd }) {
  return (
    <section className={`sidebar-section characters${open ? ' open' : ''}`}>
      <div className="section-header">
        <button className="section-toggle" onClick={onToggleOpen} aria-expanded={open}>
          <span className="tree-twisty">{open ? '▾' : '▸'}</span>
          Characters <span className="section-count">{order.length}</span>
        </button>
        <button onClick={onAdd} title="New character">+ Character</button>
      </div>
      {open && (
        <ul className="character-list">
          {order.length === 0 && <li className="character-empty">No characters yet.</li>}
          {order.map((id) => {
            const c = characters[id]
            return (
              <li key={id}>
                <button
                  className={`character-row${selectedId === id ? ' selected' : ''}`}
                  onClick={() => onSelect(id)}
                  title={c.name}
                >
                  <span className="character-avatar" aria-hidden="true">
                    {(c.name.trim()[0] ?? '?').toUpperCase()}
                  </span>
                  <span className="character-name">{c.name || 'Unnamed'}</span>
                  {c.role && <span className="character-role">{c.role}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Main-pane editor for one character. */
export function CharacterSheet({ character, nodes, events = [], saveState, onChange, onDelete, onOpenPage, onOpenEvent }) {
  const mentions = useMemo(() => findMentions(nodes, character), [nodes, character])
  const total = mentions.reduce((s, m) => s + m.count, 0)
  const short = CHARACTER_FIELDS.filter((f) => f.short)
  const long = CHARACTER_FIELDS.filter((f) => !f.short)

  return (
    <>
      <header className="editor-header">
        <input
          className="editor-title"
          value={character.name}
          placeholder="Character name"
          onChange={(e) => onChange({ name: e.target.value })}
          aria-label="Character name"
        />
        <button onClick={onDelete}>Delete character</button>
        <span className="editor-status">{saveState}</span>
      </header>

      <div className="sheet-scroll">
        <div className="sheet">
          <div className="sheet-grid">
            {short.map((f) => (
              <label key={f.key} className={`sheet-field${f.key === 'aliases' ? ' wide' : ''}`}>
                <span className="sheet-label">{f.label}</span>
                <input
                  value={character[f.key] ?? ''}
                  placeholder={f.hint}
                  list={f.options ? `opts-${f.key}` : undefined}
                  onChange={(e) => onChange({ [f.key]: e.target.value })}
                  spellCheck
                />
                {f.options && (
                  <datalist id={`opts-${f.key}`}>
                    {f.options.map((o) => <option key={o} value={o} />)}
                  </datalist>
                )}
              </label>
            ))}
          </div>

          {long.map((f) => (
            <label key={f.key} className="sheet-field">
              <span className="sheet-label">{f.label}</span>
              <textarea
                rows={3}
                value={character[f.key] ?? ''}
                onChange={(e) => onChange({ [f.key]: e.target.value })}
                spellCheck
              />
            </label>
          ))}

          <div className="sheet-field">
            <span className="sheet-label">Timeline</span>
            {events.length === 0 ? (
              <p className="sheet-muted">Not tagged in any timeline events yet.</p>
            ) : (
              <ul className="mention-list">
                {events.map(({ ev, index }) => (
                  <li key={ev.id}>
                    <button onClick={() => onOpenEvent(ev.id)}>
                      <span>
                        <span className="tl-index">{index + 1}</span> {ev.title || 'Untitled event'}
                      </span>
                      <span className="sheet-muted">{ev.when}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="sheet-field">
            <span className="sheet-label">
              Appears in {mentions.length ? `· ${total} mention${total === 1 ? '' : 's'}` : ''}
            </span>
            {mentions.length === 0 ? (
              <p className="sheet-muted">
                Not mentioned in any page yet. Matches the name, each part of it, and anything under
                “Also known as”.
              </p>
            ) : (
              <ul className="mention-list">
                {mentions.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => onOpenPage(m.id)}>
                      <span>📄 {m.path}</span>
                      <span className="sheet-muted">{m.count}×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
