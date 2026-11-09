import { useEffect, useEffectEvent, useRef, useState } from 'react'
import Tree from './Tree.jsx'
import SpellEditor from './SpellEditor.jsx'
import { CharacterList, CharacterSheet } from './Characters.jsx'
import Timeline from './Timeline.jsx'
import { ResourceList, ResourceSheet } from './Resources.jsx'
import { WORD_RE, getSpellChecker } from './spellcheck.js'
import { exportPdf } from './exportPdf.js'
import {
  ROOT_ID,
  addNode,
  characterNames,
  countWords,
  createCharacter,
  createInitialProject,
  createResource,
  deleteNode,
  loadProject,
  normalizeProject,
  moveNode,
  newId,
  saveProject,
  updateNode,
} from './store.js'
import {
  canWriteFiles,
  loadFileHandle,
  loadFileMeta,
  openProjectFile,
  saveFileMeta,
  saveProjectFile,
  storeFileHandle,
} from './projectFile.js'
import DriveDialog from './DriveDialog.jsx'
import { driveConfigured, driveLoad, driveSave, loadGis, signIn } from './googleDrive.js'
import { currentTheme, onSystemThemeChange, setTheme } from './theme.js'
import './App.css'

/** Whether the writing itself changed — not just which page is selected or open. */
const contentChanged = (a, b) =>
  ['nodes', 'characters', 'characterOrder', 'resources', 'resourceOrder', 'author'].some((k) => a[k] !== b[k]) ||
  ['plotlines', 'events', 'order'].some((k) => a.timeline[k] !== b.timeline[k])

export default function App() {
  const [project, setProject] = useState(loadProject)
  const [renamingId, setRenamingId] = useState(null)
  const [storageOk, setStorageOk] = useState(true)
  // The project file on disk: its name, the handle used to write it, and the
  // project as it was last saved/opened (null = changed since, as far as we know).
  const [fileName, setFileName] = useState(() => loadFileMeta().name)
  // Set when the project lives in Google Drive rather than on disk.
  const [driveId, setDriveId] = useState(() => loadFileMeta().driveId)
  const [driveOpen, setDriveOpen] = useState(false)
  const [savedProject, setSavedProject] = useState(() => (loadFileMeta().dirty ? null : project))
  const fileHandle = useRef(null)
  const [spellOn, setSpellOn] = useState(() => {
    try {
      return localStorage.getItem('scribe.spellcheck') !== 'off'
    } catch {
      return true
    }
  })
  const editorRef = useRef(null)
  const [theme, setThemeState] = useState(currentTheme)
  useEffect(() => onSystemThemeChange(setThemeState), [])
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  const toggleSpell = (on) => {
    setSpellOn(on)
    try {
      localStorage.setItem('scribe.spellcheck', on ? 'on' : 'off')
    } catch {
      // preference just won't persist
    }
  }

  const {
    nodes,
    selectedId,
    expanded,
    characters,
    characterOrder,
    selectedCharacterId,
    timeline,
    showTimeline,
    resources,
    resourceOrder,
    selectedResourceId,
  } = project
  const selected = nodes[selectedId]
  const character = !showTimeline && selectedCharacterId ? characters[selectedCharacterId] : null
  const resource = !showTimeline && !character && selectedResourceId ? resources[selectedResourceId] : null
  const [charsOpen, setCharsOpen] = useState(true)
  const [resourcesOpen, setResourcesOpen] = useState(true)

  // Character names and aliases count as correctly spelled words.
  useEffect(() => {
    const words = Object.values(characters).flatMap((c) =>
      characterNames(c).flatMap((n) => n.match(WORD_RE) ?? []),
    )
    getSpellChecker().setProjectWords(words)
  }, [characters])

  // Autosave a working copy (debounced) to localStorage, so nothing is lost
  // between file saves.
  useEffect(() => {
    const t = setTimeout(() => setStorageOk(saveProject(project)), 400)
    return () => clearTimeout(t)
  }, [project])

  const dirty = !savedProject || contentChanged(savedProject, project)
  useEffect(() => saveFileMeta({ name: fileName, dirty, driveId }), [fileName, dirty, driveId])

  // Load Google sign-in early so its popup opens straight from the click.
  useEffect(() => {
    if (driveConfigured) loadGis().catch(() => {})
  }, [])

  // Reconnect to the file we were editing before the reload.
  useEffect(() => {
    loadFileHandle().then((h) => {
      if (h && h.name === loadFileMeta().name && !fileHandle.current) fileHandle.current = h
    })
  }, [])

  const saveState = !storageOk
    ? 'Browser storage full — save to a file!'
    : !fileName
      ? 'Not saved to a file'
      : dirty
        ? 'Unsaved changes'
        : driveId
          ? 'Saved to Drive'
          : 'Saved'

  const patch = (fn) => setProject((p) => ({ ...p, ...fn(p) }))

  // ---------- Project files ----------

  const setFile = (name, handle, snapshot, newDriveId = null) => {
    setFileName(name)
    setDriveId(newDriveId)
    setSavedProject(snapshot)
    fileHandle.current = handle
    storeFileHandle(handle)
  }

  const confirmDiscard = () =>
    !dirty || confirm('This project has unsaved changes. Discard them?')

  const newProject = () => {
    if (!confirmDiscard()) return
    // Keep the author's name; it's who's writing, not what.
    const p = { ...createInitialProject(), author: project.author }
    setProject(p)
    setFile(null, null, p)
    setRenamingId(null)
  }

  const openProject = async () => {
    if (!confirmDiscard()) return
    try {
      const file = await openProjectFile()
      if (!file) return
      const data = normalizeProject(JSON.parse(file.text))
      if (!data) throw new Error('this is not a Scribe project file.')
      setProject(data)
      setFile(file.name, file.handle, data)
      setRenamingId(null)
    } catch (err) {
      alert(`Could not open the project: ${err.message}`)
    }
  }

  const suggestedName = () =>
    fileName ?? `${project.nodes[ROOT_ID].name.replace(/[^\w -]+/g, '').trim() || 'novel'}.json`

  /** Save wherever the project lives; Save As always goes to a file on disk. */
  const saveToFile = async (saveAs = false) => {
    if (driveId && !saveAs) return saveToDrive()
    const snapshot = project
    const suggested = suggestedName()
    try {
      const res = await saveProjectFile(snapshot, saveAs ? null : fileHandle.current, suggested)
      if (res) setFile(res.name, res.handle, snapshot)
    } catch (err) {
      alert(`Could not save the project: ${err.message}`)
    }
  }

  // ---------- Google Drive ----------

  /** Update the project's Drive file, or create one if it isn't in Drive yet. */
  const saveToDrive = async () => {
    const snapshot = project
    // Open Google's sign-in popup (if needed) right here in the click, before any await.
    signIn().catch(() => {}) // failures are reported by driveSave below
    try {
      const res = await driveSave(snapshot, driveId, suggestedName())
      setFile(res.name, null, snapshot, res.id)
      // First save to Drive: say exactly where it went (and in which account).
      if (res.created) {
        const link = res.webViewLink ?? `https://drive.google.com/file/d/${res.id}/view`
        if (confirm(`Saved “${res.name}” to the top level of My Drive in the Google account you just signed in with.

Open it in Google Drive?`)) {
          window.open(link, '_blank', 'noopener')
        }
      }
    } catch (err) {
      alert(`Could not save to Google Drive: ${err.message}`)
    }
  }

  const openFromDrive = () => {
    if (confirmDiscard()) setDriveOpen(true)
  }

  const pickDriveFile = async (file) => {
    setDriveOpen(false)
    try {
      const data = normalizeProject(JSON.parse(await driveLoad(file.id)))
      if (!data) throw new Error('this is not a Scribe project file.')
      setProject(data)
      setFile(file.name, null, data, file.id)
      setRenamingId(null)
    } catch (err) {
      if (err.name !== 'AbortError') alert(`Could not open the project: ${err.message}`)
    }
  }

  // Ctrl/Cmd+S save, Ctrl/Cmd+Shift+S save as, Ctrl/Cmd+O open.
  const onKey = useEffectEvent((e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const key = e.key.toLowerCase()
    if (key === 's') {
      e.preventDefault()
      saveToFile(e.shiftKey)
    } else if (key === 'o' && !e.shiftKey) {
      e.preventDefault()
      openProject()
    }
  })
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const select = (id) =>
    patch(() => ({ selectedId: id, selectedCharacterId: null, selectedResourceId: null, showTimeline: false }))
  const openCharacter = (id) => patch(() => ({ selectedCharacterId: id, selectedResourceId: null, showTimeline: false }))
  const openResource = (id) => patch(() => ({ selectedResourceId: id, selectedCharacterId: null, showTimeline: false }))

  /** Add webpages; opens the last one added. */
  const addResources = (links) => {
    const created = links.map(({ url, title }) => createResource(url, title))
    patch((p) => ({
      resources: { ...p.resources, ...Object.fromEntries(created.map((r) => [r.id, r])) },
      resourceOrder: [...p.resourceOrder, ...created.map((r) => r.id)],
      selectedResourceId: created.at(-1).id,
      selectedCharacterId: null,
      showTimeline: false,
    }))
    setResourcesOpen(true)
  }

  const updateResource = (id, fields) =>
    patch((p) => ({ resources: { ...p.resources, [id]: { ...p.resources[id], ...fields } } }))

  const deleteResource = (id) => {
    if (!confirm(`Delete the resource "${resources[id].title}"?`)) return
    patch((p) => {
      const rest = { ...p.resources }
      delete rest[id]
      return {
        resources: rest,
        resourceOrder: p.resourceOrder.filter((r) => r !== id),
        selectedResourceId: null,
      }
    })
  }
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
      selectedResourceId: null,
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
        selectedResourceId: null,
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
        <div className="project-bar">
          <span
            className="project-file"
            title={
              fileName
                ? `${fileName}${driveId ? ' (Google Drive)' : ''}${dirty ? ' — unsaved changes' : ''}`
                : 'Not saved to a file yet'
            }
          >
            {driveId && <span aria-label="In Google Drive">☁ </span>}
            {fileName ?? 'Untitled project'}
            {dirty && <span className="project-dirty" aria-label="unsaved changes"> ●</span>}
          </span>
          <span className="project-actions">
            <button onClick={newProject} title="Start a new, empty project">New</button>
            <button onClick={openProject} title="Open a project file (Ctrl+O)">Open…</button>
            <button
              onClick={() => saveToFile(false)}
              title={
                driveId
                  ? 'Save to Google Drive (Ctrl+S)'
                  : canWriteFiles
                    ? 'Save to the project file (Ctrl+S)'
                    : 'Download the project file (Ctrl+S)'
              }
            >
              Save
            </button>
            {canWriteFiles && (
              <button onClick={() => saveToFile(true)} title="Save to a new file on this computer (Ctrl+Shift+S)">
                Save As…
              </button>
            )}
            {driveConfigured && (
              <>
                <button onClick={openFromDrive} title="Open a project saved in Google Drive">
                  Open from Drive…
                </button>
                <button
                  onClick={saveToDrive}
                  title={driveId ? 'Save to this project’s Google Drive file' : 'Save a copy to Google Drive and keep saving there'}
                >
                  Save to Drive
                </button>
              </>
            )}
          </span>
        </div>
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
            selectedId={character || resource || showTimeline ? null : selectedId}
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
        <ResourceList
          resources={resources}
          order={resourceOrder}
          selectedId={resource ? selectedResourceId : null}
          open={resourcesOpen}
          onToggleOpen={() => setResourcesOpen((o) => !o)}
          onSelect={openResource}
          onAdd={() => addResources([{ url: '', title: '' }])}
          onAddLinks={addResources}
        />
        <div className="sidebar-footer">
          <span>{totalWords.toLocaleString()} words total</span>
          <span className="sidebar-io">
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light view' : 'Switch to dark view'}
              aria-label={theme === 'dark' ? 'Switch to light view' : 'Switch to dark view'}
            >
              {theme === 'dark' ? '☀ Light' : '☾ Dark'}
            </button>
            <button onClick={exportManuscript} title="Print the manuscript or save it as a PDF">
              PDF
            </button>
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
        ) : resource ? (
          <ResourceSheet
            key={resource.id}
            resource={resource}
            saveState={saveState}
            onChange={(fields) => updateResource(resource.id, fields)}
            onDelete={() => deleteResource(resource.id)}
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
      {driveOpen && <DriveDialog onPick={pickDriveFile} onClose={() => setDriveOpen(false)} />}
    </div>
  )
}
