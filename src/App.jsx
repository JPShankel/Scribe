import { useEffect, useRef, useState } from 'react'
import Tree from './Tree.jsx'
import SpellEditor from './SpellEditor.jsx'
import { CharacterList, CharacterSheet } from './Characters.jsx'
import Timeline from './Timeline.jsx'
import { WORD_RE, getSpellChecker } from './spellcheck.js'
import { exportPdf } from './exportPdf.js'
import {
  ROOT_ID,
  addNode,
  characterNames,
  countWords,
  createCharacter,
  deleteNode,
  loadProject,
  normalizeProject,
  moveNode,
  newId,
  saveProject,
  updateNode,
} from './store.js'
import './App.css'

export default function App() {
  const [project, setProject] = useState(loadProject)
  const [renamingId, setRenamingId] = useState(null)
  const [saveState, setSaveState] = useState('Saved')
  const [spellOn, setSpellOn] = useState(() => {
    try {
      return localStorage.getItem('scribe.spellcheck') !== 'off'
    } catch {
      return true
    }
  })
  const editorRef = useRef(null)

  const toggleSpell = (on) => {
    setSpellOn(on)
    try {
      localStorage.setItem('scribe.spellcheck', on ? 'on' : 'off')
    } catch {
      // preference just won't persist
    }
  }

  const { nodes, selectedId, expanded, characters, characterOrder, selectedCharacterId, timeline, showTimeline } =
    project
  const selected = nodes[selectedId]
  const character = !showTimeline && selectedCharacterId ? characters[selectedCharacterId] : null
  const [charsOpen, setCharsOpen] = useState(true)

  // Character names and aliases count as correctly spelled words.
  useEffect(() => {
    const words = Object.values(characters).flatMap((c) =>
      characterNames(c).flatMap((n) => n.match(WORD_RE) ?? []),
    )
    getSpellChecker().setProjectWords(words)
  }, [characters])

  // Autosave (debounced) to localStorage.
  useEffect(() => {
    const t = setTimeout(() => {
      setSaveState(saveProject(project) ? 'Saved' : 'Save failed — storage full?')
    }, 400)
    return () => clearTimeout(t)
  }, [project])

  const patch = (fn) => {
    setSaveState('Saving…')
    setProject((p) => ({ ...p, ...fn(p) }))
  }

  const select = (id) => patch(() => ({ selectedId: id, selectedCharacterId: null, showTimeline: false }))
  const openCharacter = (id) => patch(() => ({ selectedCharacterId: id, showTimeline: false }))
  const openTimeline = (eventId) =>
    patch((p) => ({
      showTimeline: true,
      timeline: eventId === undefined ? p.timeline : { ...p.timeline, selectedEventId: eventId },
    }))
  const updateTimeline = (fn) => patch((p) => ({ timeline: fn(p.timeline) }))

  const addCharacter = () => {
    const c = createCharacter('New character')
    patch((p) => ({
      characters: { ...p.characters, [c.id]: c },
      characterOrder: [...p.characterOrder, c.id],
      selectedCharacterId: c.id,
      showTimeline: false,
    }))
    setCharsOpen(true)
    // Put the cursor in the name field, ready to type over the placeholder name.
    requestAnimationFrame(() => {
      const el = document.querySelector('.editor-title')
      el?.focus()
      el?.select()
    })
  }

  const updateCharacter = (id, fields) =>
    patch((p) => ({ characters: { ...p.characters, [id]: { ...p.characters[id], ...fields } } }))

  const deleteCharacter = (id) => {
    if (!confirm(`Delete the character "${characters[id].name}"?`)) return
    patch((p) => {
      const rest = { ...p.characters }
      delete rest[id]
      return {
        characters: rest,
        characterOrder: p.characterOrder.filter((c) => c !== id),
        selectedCharacterId: null,
      }
    })
  }
  const toggle = (id) =>
    patch((p) => ({ expanded: { ...p.expanded, [id]: !p.expanded[id] } }))

  // New items go inside the selected folder, or next to the selected page.
  const create = (type) => {
    const id = newId()
    const count = Object.values(nodes).filter((n) => n.type === type).length
    const node =
      type === 'folder'
        ? { id, type, name: `Folder ${count}`, children: [] }
        : { id, type, name: `Page ${count + 1}`, content: '' }
    patch((p) => {
      const sel = p.nodes[p.selectedId] ?? p.nodes[ROOT_ID]
      const parentId = sel.type === 'folder' ? sel.id : sel.parentId
      const afterId = sel.type === 'folder' ? undefined : sel.id
      return {
        nodes: addNode(p.nodes, parentId, node, afterId),
        expanded: { ...p.expanded, [parentId]: true },
        selectedId: id,
        selectedCharacterId: null,
        showTimeline: false,
      }
    })
    setRenamingId(id)
  }

  const remove = () => {
    if (!selected || selectedId === ROOT_ID) return
    const what = selected.type === 'folder' ? 'folder and everything in it' : 'page'
    if (!confirm(`Delete the ${what} "${selected.name}"?`)) return
    patch((p) => ({
      nodes: deleteNode(p.nodes, p.selectedId),
      selectedId: p.nodes[p.selectedId].parentId,
    }))
  }

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${nodes[ROOT_ID].name.replace(/[^\w -]+/g, '') || 'novel'}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // The manuscript header needs the author's last name; ask once and keep it with the project.
  const exportManuscript = () => {
    let author = project.author ?? ''
    if (!author.trim()) {
      const answer = prompt('Author name (its last name goes in the page header):', '')
      if (answer === null) return
      author = answer.trim()
      if (author) patch(() => ({ author }))
    }
    exportPdf(nodes, author)
  }

  const importProject = (file) => {
    file.text().then((text) => {
      try {
        const data = normalizeProject(JSON.parse(text))
        if (!data) throw new Error('not a Scribe project')
        if (confirm('Replace the current project with the imported one?')) setProject(data)
      } catch (err) {
        alert(`Could not import: ${err.message}`)
      }
    })
  }

  // Keyboard shortcuts in the tree: F2 rename, Delete remove.
  const onSidebarKey = (e) => {
    if (renamingId || e.target.tagName === 'INPUT') return
    if (e.key === 'F2') setRenamingId(selectedId)
    if (e.key === 'Delete') remove()
  }

  const totalWords = Object.values(nodes)
    .filter((n) => n.type === 'page')
    .reduce((sum, n) => sum + countWords(n.content), 0)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-toolbar">
          <button onClick={() => create('page')} title="New page">+ Page</button>
          <button onClick={() => create('folder')} title="New folder">+ Folder</button>
          <button onClick={() => setRenamingId(selectedId)} title="Rename (F2)">
            Rename
          </button>
          <button onClick={remove} disabled={selectedId === ROOT_ID} title="Delete (Del)">
            Delete
          </button>
        </div>
        <div className="sidebar-tree" tabIndex={-1} onKeyDown={onSidebarKey}>
          <Tree
            nodes={nodes}
            selectedId={character || showTimeline ? null : selectedId}
            expanded={expanded}
            renamingId={renamingId}
            setRenamingId={setRenamingId}
            onSelect={select}
            onToggle={toggle}
            onRename={(id, name) => patch((p) => ({ nodes: updateNode(p.nodes, id, { name }) }))}
            onMove={(id, targetId, position) =>
              patch((p) => ({
                nodes: moveNode(p.nodes, id, targetId, position),
                expanded: position === 'inside' ? { ...p.expanded, [targetId]: true } : p.expanded,
              }))
            }
          />
        </div>
        <section className="sidebar-section">
          <button
            className={`sidebar-link${showTimeline ? ' selected' : ''}`}
            onClick={() => openTimeline()}
          >
            <span aria-hidden="true">🕒</span>
            <span className="sidebar-link-label">Timeline</span>
            <span className="section-count">
              {timeline.order.length} event{timeline.order.length === 1 ? '' : 's'}
            </span>
          </button>
        </section>
        <CharacterList
          characters={characters}
          order={characterOrder}
          selectedId={character ? selectedCharacterId : null}
          open={charsOpen}
          onToggleOpen={() => setCharsOpen((o) => !o)}
          onSelect={openCharacter}
          onAdd={addCharacter}
        />
        <div className="sidebar-footer">
          <span>{totalWords.toLocaleString()} words total</span>
          <span className="sidebar-io">
            <button onClick={exportManuscript} title="Print the manuscript or save it as a PDF">
              PDF
            </button>
            <button onClick={exportProject} title="Download project as JSON">Export</button>
            <label className="button" title="Load project from JSON">
              Import
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  if (e.target.files[0]) importProject(e.target.files[0])
                  e.target.value = ''
                }}
              />
            </label>
          </span>
        </div>
      </aside>

      <main className="editor-pane">
        {showTimeline ? (
          <Timeline
            timeline={timeline}
            nodes={nodes}
            characters={characters}
            characterOrder={characterOrder}
            saveState={saveState}
            onChange={updateTimeline}
            onOpenPage={select}
            onOpenCharacter={openCharacter}
          />
        ) : character ? (
          <CharacterSheet
            key={character.id}
            character={character}
            nodes={nodes}
            events={timeline.order
              .map((id, index) => ({ ev: timeline.events[id], index }))
              .filter(({ ev }) => ev.characterIds.includes(character.id))}
            onOpenEvent={openTimeline}
            saveState={saveState}
            onChange={(fields) => updateCharacter(character.id, fields)}
            onDelete={() => deleteCharacter(character.id)}
            onOpenPage={select}
          />
        ) : selected?.type === 'page' ? (
          <>
            <header className="editor-header">
              <input
                className="editor-title"
                value={selected.name}
                onChange={(e) =>
                  patch((p) => ({ nodes: updateNode(p.nodes, selectedId, { name: e.target.value }) }))
                }
                onKeyDown={(e) => e.key === 'Enter' && editorRef.current?.focus()}
                aria-label="Page title"
              />
              <label className="editor-toggle" title="Underline misspelled words; right-click one for suggestions">
                <input type="checkbox" checked={spellOn} onChange={(e) => toggleSpell(e.target.checked)} />
                Spellcheck
              </label>
              <span className="editor-status">
                {countWords(selected.content).toLocaleString()} words · {saveState}
              </span>
            </header>
            <div className="editor-scroll">
              <SpellEditor
                key={selectedId}
                inputRef={editorRef}
                enabled={spellOn}
                value={selected.content}
                onChange={(content) =>
                  patch((p) => ({ nodes: updateNode(p.nodes, selectedId, { content }) }))
                }
                placeholder="Start writing…"
                autoFocus
              />
            </div>
          </>
        ) : (
          <div className="editor-empty">
            <p>Select a page to start writing, or create a new one.</p>
            <button onClick={() => create('page')}>+ New page</button>
          </div>
        )}
      </main>
    </div>
  )
}
