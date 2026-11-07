import { useMemo, useState } from 'react'
import {
  createEvent,
  findOutOfOrder,
  listPages,
  moveEvent,
  newId,
  nextPlotlineColor,
} from './store.js'

/**
 * Story timeline: rows are events in chronological story order, columns are
 * plotlines. Drag a card up/down to reorder, or sideways to change plotline.
 */
export default function Timeline({
  timeline,
  nodes,
  characters,
  characterOrder,
  saveState,
  onChange, // (timeline => timeline) => void
  onOpenPage,
  onOpenCharacter,
}) {
  const { plotlines, events, order, selectedEventId } = timeline
  const [focusCharacter, setFocusCharacter] = useState('')
  const [drag, setDrag] = useState(null) // { id, hint: { targetId, position, plotlineId } }
  const [editingPlotline, setEditingPlotline] = useState(null)

  const outOfOrder = useMemo(() => findOutOfOrder(timeline, nodes), [timeline, nodes])
  const selected = selectedEventId ? events[selectedEventId] : null
  const select = (id) => onChange((tl) => ({ ...tl, selectedEventId: id }))

  const addEvent = (plotlineId = selected?.plotlineId ?? plotlines[0].id) => {
    const ev = createEvent(plotlineId)
    onChange((tl) => {
      // Insert right after the selected event, else at the end.
      const order = [...tl.order]
      const at = tl.selectedEventId ? order.indexOf(tl.selectedEventId) + 1 : order.length
      order.splice(at, 0, ev.id)
      return { ...tl, events: { ...tl.events, [ev.id]: ev }, order, selectedEventId: ev.id }
    })
    requestAnimationFrame(() => {
      const el = document.querySelector('.event-detail-title')
      el?.focus()
      el?.select()
    })
  }

  const updateEvent = (id, fields) =>
    onChange((tl) => ({ ...tl, events: { ...tl.events, [id]: { ...tl.events[id], ...fields } } }))

  const deleteEvent = (id) => {
    if (!confirm(`Delete the event "${events[id].title}"?`)) return
    onChange((tl) => {
      const rest = { ...tl.events }
      delete rest[id]
      return { ...tl, events: rest, order: tl.order.filter((e) => e !== id), selectedEventId: null }
    })
  }

  const addPlotline = () => {
    const pl = { id: newId(), name: `Plotline ${plotlines.length + 1}`, color: nextPlotlineColor(plotlines) }
    onChange((tl) => ({ ...tl, plotlines: [...tl.plotlines, pl] }))
    setEditingPlotline(pl.id)
  }

  const updatePlotline = (id, fields) =>
    onChange((tl) => ({ ...tl, plotlines: tl.plotlines.map((p) => (p.id === id ? { ...p, ...fields } : p)) }))

  const deletePlotline = (id) => {
    const pl = plotlines.find((p) => p.id === id)
    const fallback = plotlines.find((p) => p.id !== id)
    const count = order.filter((e) => events[e].plotlineId === id).length
    const msg = count
      ? `Delete plotline "${pl.name}"? Its ${count} event${count === 1 ? '' : 's'} will move to "${fallback.name}".`
      : `Delete plotline "${pl.name}"?`
    if (!confirm(msg)) return
    onChange((tl) => {
      const evs = { ...tl.events }
      for (const eid of tl.order) if (evs[eid].plotlineId === id) evs[eid] = { ...evs[eid], plotlineId: fallback.id }
      return { ...tl, events: evs, plotlines: tl.plotlines.filter((p) => p.id !== id) }
    })
  }

  // ----- drag & drop -----
  const onCellDragOver = (e, rowId, plotlineId) => {
    if (!drag) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const position = e.clientY - r.top < r.height / 2 ? 'before' : 'after'
    const hint = { targetId: rowId, position, plotlineId }
    const h = drag.hint
    if (!h || h.targetId !== rowId || h.position !== position || h.plotlineId !== plotlineId) {
      setDrag({ ...drag, hint })
    }
  }
  const onDrop = (e) => {
    e.preventDefault()
    if (drag?.hint) {
      const { targetId, position, plotlineId } = drag.hint
      onChange((tl) => moveEvent(tl, drag.id, targetId, position, plotlineId))
    }
    setDrag(null)
  }

  const gridCols = `minmax(110px, 140px) repeat(${plotlines.length}, minmax(190px, 1fr))`

  return (
    <>
      <header className="editor-header">
        <h1 className="timeline-title">Timeline</h1>
        <label className="timeline-filter">
          Highlight
          <select value={focusCharacter} onChange={(e) => setFocusCharacter(e.target.value)}>
            <option value="">all characters</option>
            {characterOrder.map((id) => (
              <option key={id} value={id}>{characters[id].name || 'Unnamed'}</option>
            ))}
          </select>
        </label>
        <button onClick={addPlotline}>+ Plotline</button>
        <button onClick={() => addEvent()}>+ Event</button>
        <span className="editor-status">{saveState}</span>
      </header>

      <div className="timeline-body">
        <div className="timeline-scroll">
          <div className="timeline-grid" style={{ gridTemplateColumns: gridCols }}>
            {/* Header row */}
            <div className="tl-corner">Story order ↓</div>
            {plotlines.map((pl) => (
              <div key={pl.id} className="tl-lane-header" style={{ '--lane': pl.color }}>
                <input
                  type="color"
                  value={pl.color}
                  onChange={(e) => updatePlotline(pl.id, { color: e.target.value })}
                  title="Plotline colour"
                />
                {editingPlotline === pl.id ? (
                  <input
                    className="tl-lane-name-input"
                    autoFocus
                    defaultValue={pl.name}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => {
                      updatePlotline(pl.id, { name: e.target.value.trim() || pl.name })
                      setEditingPlotline(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.target.blur()
                      if (e.key === 'Escape') setEditingPlotline(null)
                    }}
                  />
                ) : (
                  <span className="tl-lane-name" onDoubleClick={() => setEditingPlotline(pl.id)} title="Double-click to rename">
                    {pl.name}
                  </span>
                )}
                <button className="tl-icon-btn" onClick={() => addEvent(pl.id)} title={`Add event to ${pl.name}`}>+</button>
                {plotlines.length > 1 && (
                  <button className="tl-icon-btn" onClick={() => deletePlotline(pl.id)} title="Delete plotline">×</button>
                )}
              </div>
            ))}

            {order.length === 0 && (
              <div className="tl-empty" style={{ gridColumn: '1 / -1' }}>
                <p>No events yet. Add the moments of your story, then drag them into the order they happen.</p>
                <button onClick={() => addEvent()}>+ Add the first event</button>
              </div>
            )}

            {/* One row per event */}
            {order.map((id, i) => {
              const ev = events[id]
              const hint = drag?.hint?.targetId === id ? drag.hint : null
              const dimmed = focusCharacter && !ev.characterIds.includes(focusCharacter)
              return (
                <div key={id} className="tl-row" style={{ display: 'contents' }}>
                  <div className="tl-when" onClick={() => select(id)}>
                    <span className="tl-index">{i + 1}</span>
                    <span>{ev.when}</span>
                  </div>
                  {plotlines.map((pl) => (
                    <div
                      key={pl.id}
                      className={`tl-cell${hint && hint.plotlineId === pl.id ? ` drop-${hint.position}` : ''}`}
                      style={{ '--lane': pl.color }}
                      onDragOver={(e) => onCellDragOver(e, id, pl.id)}
                      onDrop={onDrop}
                    >
                      {ev.plotlineId === pl.id && (
                        <EventCard
                          ev={ev}
                          characters={characters}
                          selected={selectedEventId === id}
                          dimmed={dimmed}
                          flashback={outOfOrder.has(id)}
                          dragging={drag?.id === id}
                          onClick={() => select(id)}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', id)
                            setDrag({ id, hint: null })
                          }}
                          onDragEnd={() => setDrag(null)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {selected && (
          <EventDetail
            key={selected.id}
            ev={selected}
            index={order.indexOf(selected.id)}
            count={order.length}
            plotlines={plotlines}
            nodes={nodes}
            characters={characters}
            characterOrder={characterOrder}
            flashback={outOfOrder.has(selected.id)}
            onChange={(fields) => updateEvent(selected.id, fields)}
            onMove={(delta) =>
              onChange((tl) => {
                const order = [...tl.order]
                const i = order.indexOf(selected.id)
                const j = i + delta
                if (j < 0 || j >= order.length) return tl
                ;[order[i], order[j]] = [order[j], order[i]]
                return { ...tl, order }
              })
            }
            onDelete={() => deleteEvent(selected.id)}
            onClose={() => select(null)}
            onOpenPage={onOpenPage}
            onOpenCharacter={onOpenCharacter}
          />
        )}
      </div>
    </>
  )
}

function EventCard({ ev, characters, selected, dimmed, flashback, dragging, ...handlers }) {
  const cast = ev.characterIds.map((c) => characters[c]).filter(Boolean)
  return (
    <div
      className={`tl-card${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}${dragging ? ' dragging' : ''}`}
      draggable
      {...handlers}
    >
      <div className="tl-card-title">{ev.title || 'Untitled event'}</div>
      {ev.summary && <div className="tl-card-summary">{ev.summary}</div>}
      <div className="tl-card-meta">
        {cast.map((c) => (
          <span key={c.id} className="character-avatar small" title={c.name}>
            {(c.name.trim()[0] ?? '?').toUpperCase()}
          </span>
        ))}
        {ev.pageIds.length > 0 && <span title="Linked pages">📄 {ev.pageIds.length}</span>}
        {flashback && (
          <span className="tl-flag" title="The manuscript tells this after events that happen later (flashback?)">
            ↺ told later
          </span>
        )}
      </div>
    </div>
  )
}

function EventDetail({
  ev, index, count, plotlines, nodes, characters, characterOrder, flashback,
  onChange, onMove, onDelete, onClose, onOpenPage, onOpenCharacter,
}) {
  const pages = useMemo(() => listPages(nodes), [nodes])
  const linked = ev.pageIds.map((id) => pages.find((p) => p.id === id)).filter(Boolean)
  const unlinked = pages.filter((p) => !ev.pageIds.includes(p.id))

  const toggleCharacter = (id) =>
    onChange({
      characterIds: ev.characterIds.includes(id)
        ? ev.characterIds.filter((c) => c !== id)
        : [...ev.characterIds, id],
    })

  return (
    <aside className="event-detail">
      <div className="event-detail-head">
        <span className="sheet-label">Event {index + 1} of {count}</span>
        <button className="tl-icon-btn" onClick={onClose} title="Close">×</button>
      </div>

      <input
        className="event-detail-title"
        value={ev.title}
        placeholder="What happens?"
        onChange={(e) => onChange({ title: e.target.value })}
      />

      <div className="sheet-grid">
        <label className="sheet-field">
          <span className="sheet-label">When</span>
          <input
            value={ev.when}
            placeholder="e.g. Day 3, dawn"
            onChange={(e) => onChange({ when: e.target.value })}
          />
        </label>
        <label className="sheet-field">
          <span className="sheet-label">Plotline</span>
          <select value={ev.plotlineId} onChange={(e) => onChange({ plotlineId: e.target.value })}>
            {plotlines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      <label className="sheet-field">
        <span className="sheet-label">Summary</span>
        <textarea
          rows={4}
          value={ev.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
          spellCheck
        />
      </label>

      <div className="sheet-field">
        <span className="sheet-label">Characters</span>
        {characterOrder.length === 0 ? (
          <p className="sheet-muted">Add characters in the sidebar to tag them here.</p>
        ) : (
          <div className="chip-list">
            {characterOrder.map((id) => {
              const on = ev.characterIds.includes(id)
              return (
                <button
                  key={id}
                  className={`chip${on ? ' on' : ''}`}
                  onClick={() => toggleCharacter(id)}
                  onDoubleClick={() => onOpenCharacter(id)}
                  title={on ? 'Click to remove · double-click to open' : 'Click to add · double-click to open'}
                  aria-pressed={on}
                >
                  {characters[id].name || 'Unnamed'}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="sheet-field">
        <span className="sheet-label">Told in</span>
        {linked.length > 0 && (
          <ul className="mention-list">
            {linked.map((p) => (
              <li key={p.id} className="linked-page">
                <button onClick={() => onOpenPage(p.id)}>📄 {p.path}</button>
                <button
                  className="tl-icon-btn"
                  title="Unlink page"
                  onClick={() => onChange({ pageIds: ev.pageIds.filter((x) => x !== p.id) })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {unlinked.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && onChange({ pageIds: [...ev.pageIds, e.target.value] })}
          >
            <option value="">+ Link a page…</option>
            {unlinked.map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
          </select>
        )}
        {flashback && (
          <p className="sheet-muted">
            ↺ This event happens before others that the manuscript tells first, so it reads as a
            flashback or reveal.
          </p>
        )}
      </div>

      <div className="event-detail-actions">
        <button onClick={() => onMove(-1)} disabled={index === 0}>↑ Earlier</button>
        <button onClick={() => onMove(1)} disabled={index === count - 1}>↓ Later</button>
        <span style={{ flex: 1 }} />
        <button onClick={onDelete}>Delete event</button>
      </div>
    </aside>
  )
}
