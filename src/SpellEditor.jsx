import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { WORD_RE, getSpellChecker } from './spellcheck.js'

/**
 * A textarea with red wavy underlines under misspelled words.
 *
 * The underlines live in a "mirror" div positioned exactly behind the
 * textarea, with identical font/padding/wrapping. Its text is transparent, so
 * only the underlines show through the textarea's transparent background.
 */
export default function SpellEditor({ value, onChange, enabled, inputRef, ...rest }) {
  const checker = getSpellChecker()
  const mirrorRef = useRef(null)
  const ownRef = useRef(null)
  const textareaRef = inputRef ?? ownRef
  const [menu, setMenu] = useState(null)

  // Re-render whenever the checker learns new results.
  useSyncExternalStore(
    (cb) => checker.subscribe(cb),
    () => checker.revision,
  )

  const syncScroll = () => {
    if (mirrorRef.current && textareaRef.current) {
      mirrorRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }
  useLayoutEffect(syncScroll)

  // Close the menu on outside click / Escape / resize.
  useEffect(() => {
    if (!menu) return
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return
      if (e.type === 'mousedown' && e.target.closest?.('.spell-menu')) return
      setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const segments = []
  if (enabled) {
    let last = 0
    for (const m of value.matchAll(WORD_RE)) {
      if (!checker.isMisspelled(m[0])) continue
      const start = m.index
      const end = start + m[0].length
      if (start > last) segments.push(value.slice(last, start))
      segments.push(
        <span key={start} className="misspelled" data-start={start} data-end={end}>
          {m[0]}
        </span>,
      )
      last = end
    }
    segments.push(value.slice(last))
  }

  const onContextMenu = (e) => {
    if (!enabled || !mirrorRef.current) return
    const { clientX: x, clientY: y } = e
    for (const span of mirrorRef.current.querySelectorAll('.misspelled')) {
      for (const r of span.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          e.preventDefault()
          const start = Number(span.dataset.start)
          const end = Number(span.dataset.end)
          const word = value.slice(start, end)
          setMenu({ x, y, start, end, word, suggestions: null })
          checker.suggest(word).then((suggestions) =>
            setMenu((m) => (m && m.start === start && m.word === word ? { ...m, suggestions } : m)),
          )
          return
        }
      }
    }
    // Not on a misspelled word: fall through to the browser's normal menu.
  }

  const replace = (replacement) => {
    const ta = textareaRef.current
    const { start, end } = menu
    setMenu(null)
    ta.focus()
    ta.setSelectionRange(start, end)
    // execCommand keeps the browser's undo history intact; fall back if unsupported.
    if (!document.execCommand?.('insertText', false, replacement)) {
      onChange(value.slice(0, start) + replacement + value.slice(end))
      requestAnimationFrame(() => {
        const caret = start + replacement.length
        ta.setSelectionRange(caret, caret)
      })
    }
  }

  // Keep the menu on-screen.
  const menuStyle = menu && {
    left: Math.min(menu.x, window.innerWidth - 220),
    top: Math.min(menu.y, window.innerHeight - 300),
  }

  return (
    <div className="editor-paper">
      <div ref={mirrorRef} className="editor-surface editor-mirror" aria-hidden="true">
        {segments}
        {/* keeps a trailing newline from collapsing so heights match */}
        {'​'}
      </div>
      <textarea
        ref={textareaRef}
        className="editor-surface editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onContextMenu={onContextMenu}
        spellCheck={false}
        {...rest}
      />
      {menu && (
        <div className="spell-menu" style={menuStyle} role="menu">
          {menu.suggestions === null ? (
            <div className="spell-menu-note">Looking up suggestions…</div>
          ) : menu.suggestions.length === 0 ? (
            <div className="spell-menu-note">No suggestions</div>
          ) : (
            menu.suggestions.map((s) => (
              <button key={s} role="menuitem" className="spell-menu-suggestion" onClick={() => replace(s)}>
                {s}
              </button>
            ))
          )}
          <hr />
          <button
            role="menuitem"
            onClick={() => {
              checker.addToDictionary(menu.word)
              setMenu(null)
            }}
          >
            Add “{menu.word}” to dictionary
          </button>
          <button
            role="menuitem"
            onClick={() => {
              checker.ignore(menu.word)
              setMenu(null)
            }}
          >
            Ignore for this session
          </button>
        </div>
      )}
    </div>
  )
}
