import { useEffect, useRef, useState } from 'react'
import Tree from './Tree.jsx'
import {
  ROOT_ID,
  addNode,
  countWords,
  deleteNode,
  loadProject,
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
  const editorRef = useRef(null)

  const { nodes, selectedId, expanded } = project
  const selected = nodes[selectedId]

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

  const select = (id) => patch(() => ({ selectedId: id }))
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

  const importProject = (file) => {
    file.text().then((text) => {
      try {
        const data = JSON.parse(text)
        if (!data?.nodes?.[ROOT_ID]) throw new Error('not a Scribe project')
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
      <aside className="sidebar" tabIndex={-1} onKeyDown={onSidebarKey}>
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
        <div className="sidebar-tree">
          <Tree
            nodes={nodes}
            selectedId={selectedId}
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
        <div className="sidebar-footer">
          <span>{totalWords.toLocaleString()} words total</span>
          <span className="sidebar-io">
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
        {selected?.type === 'page' ? (
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
              <span className="editor-status">
                {countWords(selected.content).toLocaleString()} words · {saveState}
              </span>
            </header>
            <div className="editor-scroll">
              <textarea
                key={selectedId}
                ref={editorRef}
                className="editor"
                value={selected.content}
                onChange={(e) =>
                  patch((p) => ({ nodes: updateNode(p.nodes, selectedId, { content: e.target.value }) }))
                }
                placeholder="Start writing…"
                spellCheck
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
