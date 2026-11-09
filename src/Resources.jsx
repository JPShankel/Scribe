import { useState } from 'react'
import { isWebUrl, normalizeUrl, titleFromUrl } from './store.js'

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Links dragged in from a browser (address bar, page links, bookmarks).
 * Returns [{ url, title }]; titles come along where the browser provides them.
 */
function linksFromDrop(dt) {
  // Firefox: "url\ntitle" pairs.
  const moz = dt.getData('text/x-moz-url')
  if (moz) {
    const lines = moz.split(/\r?\n/)
    const out = []
    for (let i = 0; i < lines.length; i += 2) if (lines[i]) out.push({ url: lines[i], title: lines[i + 1] ?? '' })
    return out
  }
  // Chrome/Edge/Safari: anchor text lives in the HTML flavour.
  const html = dt.getData('text/html')
  if (html) {
    const anchors = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a[href]')]
    if (anchors.length) return anchors.map((a) => ({ url: a.href, title: a.textContent.trim() }))
  }
  const list = dt.getData('text/uri-list') || dt.getData('text/plain')
  return list
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && /^https?:\/\/\S+$/i.test(l))
    .map((url) => ({ url, title: '' }))
}

/** Sidebar section listing gathered webpages. Drop links on it to add them. */
export function ResourceList({ resources, order, selectedId, open, onToggleOpen, onSelect, onAdd, onAddLinks }) {
  const [dropping, setDropping] = useState(false)
  const accepts = (e) => ['text/uri-list', 'text/x-moz-url', 'text/plain'].some((t) => e.dataTransfer.types.includes(t))

  return (
    <section
      className={`sidebar-section resources${open ? ' open' : ''}${dropping ? ' dropping' : ''}`}
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false)
      }}
      onDrop={(e) => {
        setDropping(false)
        const links = linksFromDrop(e.dataTransfer)
        if (!links.length) return
        e.preventDefault()
        onAddLinks(links)
      }}
    >
      <div className="section-header">
        <button className="section-toggle" onClick={onToggleOpen} aria-expanded={open}>
          <span className="tree-twisty">{open ? '▾' : '▸'}</span>
          Resources <span className="section-count">{order.length}</span>
        </button>
        <button onClick={onAdd} title="Add a webpage (or drag links here)">+ Link</button>
      </div>
      {open && (
        <ul className="character-list">
          {order.length === 0 && (
            <li className="character-empty">No resources yet. Add a link, or drag one here from your browser.</li>
          )}
          {order.map((id) => {
            const r = resources[id]
            return (
              <li key={id}>
                <button
                  className={`character-row${selectedId === id ? ' selected' : ''}`}
                  onClick={() => onSelect(id)}
                  title={r.url || r.title}
                >
                  <span className="resource-icon" aria-hidden="true">🔗</span>
                  <span className="character-name">{r.title || 'Untitled'}</span>
                  {r.url && <span className="character-role resource-host">{hostOf(r.url)}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const SEARCH_URL = 'https://www.google.com/search?q='

/** Open a browser window on the right half of the screen, next to Scribe. */
function openBrowseWindow(url) {
  const sw = window.screen.availWidth
  const sh = window.screen.availHeight
  const width = Math.max(480, Math.min(1100, Math.round(sw / 2)))
  const left = (window.screen.availLeft ?? 0) + sw - width
  const top = window.screen.availTop ?? 0
  window.open(url, 'scribe-browse', `popup,noopener,width=${width},height=${sh},left=${left},top=${top}`)
}

/** The first http(s) link in some text. */
const findUrl = (text) => text.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? null

/** Main-pane editor for one resource. */
export function ResourceSheet({ resource, saveState, onChange, onDelete }) {
  // Edit the URL as typed; tidy it (add https://) when the field is left.
  // Text with spaces is a search, not an address, and is left for Browse.
  const [urlDraft, setUrlDraft] = useState(resource.url)
  const [browsing, setBrowsing] = useState(false)
  const [pasteError, setPasteError] = useState('')
  const isPlaceholderTitle =
    !resource.title.trim() || resource.title === 'New resource' || resource.title === titleFromUrl(resource.url)

  const setLink = (raw, linkTitle = '') => {
    const url = normalizeUrl(raw)
    setUrlDraft(url)
    setBrowsing(false)
    setPasteError('')
    if (url === resource.url) return
    const fields = { url }
    // Replace a placeholder title with the link's own text, or one derived from the link.
    if (isPlaceholderTitle) fields.title = linkTitle.trim() || (url ? titleFromUrl(url) : resource.title)
    onChange(fields)
  }

  const commitUrl = () => {
    if (/\s/.test(urlDraft.trim())) return
    setLink(urlDraft)
  }

  const browse = () => {
    const typed = urlDraft.trim()
    let target
    if (typed && !/\s/.test(typed) && typed.includes('.')) target = normalizeUrl(typed)
    else if (typed) target = SEARCH_URL + encodeURIComponent(typed)
    else if (!isPlaceholderTitle) target = SEARCH_URL + encodeURIComponent(resource.title)
    else target = 'https://www.google.com/'
    if (!isWebUrl(target)) target = SEARCH_URL + encodeURIComponent(typed)
    openBrowseWindow(target)
    setBrowsing(true)
  }

  const paste = async () => {
    try {
      const url = findUrl(await navigator.clipboard.readText())
      if (url) setLink(url)
      else setPasteError('No web link on the clipboard. Copy the page address first.')
    } catch {
      setPasteError('Scribe isn’t allowed to read the clipboard. Paste into the field with Ctrl+V instead.')
    }
  }

  const href = isWebUrl(resource.url) ? resource.url : null

  return (
    <>
      <header className="editor-header">
        <input
          className="editor-title"
          value={resource.title}
          placeholder="Title"
          onChange={(e) => onChange({ title: e.target.value })}
          aria-label="Resource title"
        />
        {href && (
          <a className="button" href={href} target="_blank" rel="noopener noreferrer" title={href}>
            Open page ↗
          </a>
        )}
        <button onClick={onDelete}>Delete resource</button>
        <span className="editor-status">{saveState}</span>
      </header>

      <div className="sheet-scroll">
        <div className="sheet">
          <div className="sheet-field">
            <label className="sheet-label" htmlFor="resource-url">Web address</label>
            <div className="resource-url-row">
              <input
                id="resource-url"
                value={urlDraft}
                placeholder="https://… or words to search for"
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={commitUrl}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  if (/\s/.test(urlDraft.trim())) browse()
                  else e.currentTarget.blur()
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const [link] = linksFromDrop(e.dataTransfer)
                  if (!link) return
                  e.preventDefault()
                  setLink(link.url, link.title)
                }}
                spellCheck={false}
                autoFocus={!resource.url}
              />
              <button onClick={browse} title="Search the web or open the address in a window beside Scribe">
                Browse…
              </button>
              <button onClick={paste} title="Use the web address on the clipboard">Paste</button>
            </div>
            {browsing && (
              <span className="resource-hint">
                Found the page? Drag its link or address-bar icon onto the field above, or copy its address and
                click Paste.
              </span>
            )}
            {pasteError && <span className="sheet-muted">{pasteError}</span>}
            {resource.url && !href && <span className="sheet-muted">Only http(s) links can be opened.</span>}
          </div>

          <label className="sheet-field">
            <span className="sheet-label">Notes</span>
            <textarea
              rows={8}
              value={resource.notes}
              placeholder="What's useful here — facts, quotes, ideas for scenes…"
              onChange={(e) => onChange({ notes: e.target.value })}
              spellCheck
            />
          </label>

          {resource.addedAt && (
            <p className="sheet-muted">
              Added {new Date(resource.addedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </p>
          )}
        </div>
      </div>
    </>
  )
}
