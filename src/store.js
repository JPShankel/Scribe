// Document model: a flat map of nodes keyed by id, with a fixed root folder.
// Folders hold an ordered `children` array of ids; pages hold `content`.

export const ROOT_ID = 'root'
const STORAGE_KEY = 'scribe.project.v1'

export const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export function createInitialProject() {
  const chapterId = newId()
  const pageId = newId()
  return {
    nodes: {
      [ROOT_ID]: { id: ROOT_ID, type: 'folder', name: 'My Novel', parentId: null, children: [chapterId] },
      [chapterId]: { id: chapterId, type: 'folder', name: 'Chapter 1', parentId: ROOT_ID, children: [pageId] },
      [pageId]: { id: pageId, type: 'page', name: 'Opening', parentId: chapterId, content: '' },
    },
    selectedId: pageId,
    expanded: { [ROOT_ID]: true, [chapterId]: true },
  }
}

export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      if (data?.nodes?.[ROOT_ID]) return data
    }
  } catch {
    // fall through to a fresh project
  }
  return createInitialProject()
}

export function saveProject(project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
    return true
  } catch {
    return false
  }
}

/** True if `id` is `ancestorId` or lies somewhere beneath it. */
export function isDescendant(nodes, id, ancestorId) {
  for (let cur = nodes[id]; cur; cur = nodes[cur.parentId]) {
    if (cur.id === ancestorId) return true
  }
  return false
}

/** Insert a new node under `parentId` (after `afterId` if given). */
export function addNode(nodes, parentId, node, afterId) {
  const parent = nodes[parentId]
  const children = [...parent.children]
  const idx = afterId ? children.indexOf(afterId) : -1
  if (idx >= 0) children.splice(idx + 1, 0, node.id)
  else children.push(node.id)
  return {
    ...nodes,
    [parentId]: { ...parent, children },
    [node.id]: { ...node, parentId },
  }
}

export function updateNode(nodes, id, patch) {
  return { ...nodes, [id]: { ...nodes[id], ...patch } }
}

/** Remove a node and everything beneath it. */
export function deleteNode(nodes, id) {
  if (id === ROOT_ID) return nodes
  const next = { ...nodes }
  const parent = next[next[id].parentId]
  next[parent.id] = { ...parent, children: parent.children.filter((c) => c !== id) }
  const stack = [id]
  while (stack.length) {
    const cur = next[stack.pop()]
    if (cur.type === 'folder') stack.push(...cur.children)
    delete next[cur.id]
  }
  return next
}

/**
 * Move `id` relative to `targetId`.
 * position: 'before' | 'after' | 'inside' (inside = append to folder)
 */
export function moveNode(nodes, id, targetId, position) {
  if (id === ROOT_ID || id === targetId) return nodes
  if (isDescendant(nodes, targetId, id)) return nodes // can't move into itself

  const node = nodes[id]
  const next = { ...nodes }

  const oldParent = next[node.parentId]
  next[oldParent.id] = { ...oldParent, children: oldParent.children.filter((c) => c !== id) }

  let newParentId
  let children
  if (position === 'inside') {
    newParentId = targetId
    children = [...next[targetId].children, id]
  } else {
    newParentId = next[targetId].parentId
    children = [...next[newParentId].children]
    const idx = children.indexOf(targetId)
    children.splice(position === 'before' ? idx : idx + 1, 0, id)
  }
  next[newParentId] = { ...next[newParentId], children }
  next[id] = { ...node, parentId: newParentId }
  return next
}

export function countWords(text) {
  const m = text.trim().match(/\S+/g)
  return m ? m.length : 0
}
