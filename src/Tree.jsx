import { useEffect, useRef, useState } from 'react'
import { ROOT_ID } from './store.js'

function NameInput({ initial, onDone }) {
  const [value, setValue] = useState(initial)
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const commit = () => onDone(value.trim() || initial)
  return (
    <input
      ref={ref}
      className="tree-rename"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onDone(initial)
      }}
    />
  )
}

function TreeItem({ id, depth, ctx }) {
  const { nodes, selectedId, expanded, renamingId, dropHint } = ctx
  const node = nodes[id]
  const isFolder = node.type === 'folder'
  const isOpen = !!expanded[id]
  const isRoot = id === ROOT_ID

  const hintClass =
    dropHint?.targetId === id ? ` drop-${dropHint.position}` : ''

  const handleDragOver = (e) => {
    if (!ctx.dragId) return
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    let position
    if (isRoot) position = 'inside'
    else if (isFolder) position = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside'
    else position = y < 0.5 ? 'before' : 'after'
    ctx.setDropHint({ targetId: id, position })
  }

  return (
    <li role="treeitem" aria-expanded={isFolder ? isOpen : undefined} aria-selected={selectedId === id}>
      <div
        className={`tree-row${selectedId === id ? ' selected' : ''}${hintClass}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable={!isRoot && renamingId !== id}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', id)
          ctx.setDragId(id)
        }}
        onDragEnd={() => {
          ctx.setDragId(null)
          ctx.setDropHint(null)
        }}
        onDragOver={handleDragOver}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (ctx.dragId && dropHint) ctx.onMove(ctx.dragId, dropHint.targetId, dropHint.position)
          ctx.setDragId(null)
          ctx.setDropHint(null)
        }}
        onClick={() => {
          ctx.onSelect(id)
          if (isFolder && !isRoot) ctx.onToggle(id)
        }}
        onDoubleClick={() => ctx.setRenamingId(id)}
      >
        <span
          className="tree-twisty"
          onClick={(e) => {
            if (!isFolder) return
            e.stopPropagation()
            ctx.onToggle(id)
          }}
        >
          {isFolder ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="tree-icon" aria-hidden="true">
          {isFolder ? (isOpen ? '📂' : '📁') : '📄'}
        </span>
        {renamingId === id ? (
          <NameInput
            initial={node.name}
            onDone={(name) => {
              ctx.onRename(id, name)
              ctx.setRenamingId(null)
            }}
          />
        ) : (
          <span className="tree-label" title={node.name}>{node.name}</span>
        )}
      </div>
      {isFolder && isOpen && node.children.length > 0 && (
        <ul role="group">
          {node.children.map((childId) => (
            <TreeItem key={childId} id={childId} depth={depth + 1} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function Tree(props) {
  const [dragId, setDragId] = useState(null)
  const [dropHint, setDropHint] = useState(null)
  const ctx = { ...props, dragId, setDragId, dropHint, setDropHint }
  return (
    <ul className="tree" role="tree" onDragLeave={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropHint(null)
    }}>
      <TreeItem id={ROOT_ID} depth={0} ctx={ctx} />
    </ul>
  )
}
