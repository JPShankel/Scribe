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
    characters: {},
    characterOrder: [],
    selectedCharacterId: null,
    timeline: createTimeline(),
    showTimeline: false,
  }
}

/** Fill in fields added in later versions so older saves/imports still load. */
export function normalizeProject(data) {
  if (!data?.nodes?.[ROOT_ID]) return null
  const characters = data.characters ?? {}
  const tl = data.timeline ?? createTimeline()
  const plotlines = tl.plotlines?.length ? tl.plotlines : createTimeline().plotlines
  const events = tl.events ?? {}
  return {
    ...data,
    expanded: data.expanded ?? { [ROOT_ID]: true },
    characters,
    characterOrder: (data.characterOrder ?? Object.keys(characters)).filter((id) => characters[id]),
    selectedCharacterId: characters[data.selectedCharacterId] ? data.selectedCharacterId : null,
    timeline: {
      plotlines,
      events,
      order: (tl.order ?? Object.keys(events)).filter((id) => events[id]),
      selectedEventId: events[tl.selectedEventId] ? tl.selectedEventId : null,
    },
    showTimeline: !!data.showTimeline,
  }
}

// ---------- Timeline ----------
// Events are kept in story-chronological order by hand (`order`), since
// fictional calendars rarely parse; `when` is a free-text label.

const PLOTLINE_COLORS = ['#3b6bb3', '#c2410c', '#15803d', '#9333ea', '#b45309', '#0e7490', '#be123c']

export function createTimeline() {
  return {
    plotlines: [{ id: newId(), name: 'Main plot', color: PLOTLINE_COLORS[0] }],
    events: {},
    order: [],
    selectedEventId: null,
  }
}

export const nextPlotlineColor = (plotlines) => PLOTLINE_COLORS[plotlines.length % PLOTLINE_COLORS.length]

export const createEvent = (plotlineId) => ({
  id: newId(),
  title: 'New event',
  when: '',
  plotlineId,
  summary: '',
  characterIds: [],
  pageIds: [],
})

/** Move event `id` before/after `targetId` (or to the end if no target), optionally into another plotline. */
export function moveEvent(tl, id, targetId, position, plotlineId) {
  const order = tl.order.filter((e) => e !== id)
  const idx = targetId && targetId !== id ? order.indexOf(targetId) : -1
  if (idx < 0) {
    if (targetId === id) order.splice(tl.order.indexOf(id), 0, id) // same row: keep its place
    else order.push(id)
  } else {
    order.splice(position === 'before' ? idx : idx + 1, 0, id)
  }
  const ev = tl.events[id]
  return {
    ...tl,
    order,
    events: plotlineId ? { ...tl.events, [id]: { ...ev, plotlineId } } : tl.events,
  }
}

/** Every page in manuscript order, with its folder path. */
export function listPages(nodes) {
  const out = []
  const walk = (id, path) => {
    const n = nodes[id]
    if (n.type === 'page') out.push({ id, path: [...path, n.name].join(' / '), node: n })
    else n.children.forEach((c) => walk(c, id === ROOT_ID ? path : [...path, n.name]))
  }
  walk(ROOT_ID, [])
  return out
}

/**
 * Event ids that the manuscript tells out of story order: an event whose
 * earliest linked page comes after the page of some chronologically later event
 * (e.g. a flashback).
 */
export function findOutOfOrder(tl, nodes) {
  const pagePos = new Map(listPages(nodes).map((p, i) => [p.id, i]))
  const pos = tl.order.map((id) => {
    const ps = tl.events[id].pageIds.map((p) => pagePos.get(p)).filter((p) => p !== undefined)
    return ps.length ? Math.min(...ps) : null
  })
  const flagged = new Set()
  let laterMin = Infinity
  for (let i = tl.order.length - 1; i >= 0; i--) {
    if (pos[i] === null) continue
    if (pos[i] > laterMin) flagged.add(tl.order[i])
    laterMin = Math.min(laterMin, pos[i])
  }
  return flagged
}

// ---------- Characters ----------

export const CHARACTER_FIELDS = [
  { key: 'aliases', label: 'Also known as', hint: 'Nicknames, titles, surnames — comma separated', short: true },
  { key: 'role', label: 'Role', short: true, options: ['Protagonist', 'Antagonist', 'Deuteragonist', 'Supporting', 'Love interest', 'Mentor', 'Minor'] },
  { key: 'age', label: 'Age', short: true },
  { key: 'appearance', label: 'Appearance' },
  { key: 'personality', label: 'Personality' },
  { key: 'backstory', label: 'Backstory' },
  { key: 'goals', label: 'Goals & motivation' },
  { key: 'arc', label: 'Character arc' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'notes', label: 'Notes' },
]

export function createCharacter(name) {
  const c = { id: newId(), name }
  for (const f of CHARACTER_FIELDS) c[f.key] = ''
  return c
}

/** Names a character goes by: full name, each name part (3+ letters), and aliases. */
export function characterNames(c) {
  const full = c.name.trim()
  const aliases = (c.aliases ?? '').split(',').map((a) => a.trim()).filter(Boolean)
  const parts = full.split(/\s+/).filter((w) => w.length >= 3)
  return [...new Set([full, ...aliases, ...parts].filter(Boolean))]
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Pages that mention a character, with mention counts, in manuscript order. */
export function findMentions(nodes, character) {
  const names = characterNames(character).sort((a, b) => b.length - a.length)
  if (!names.length) return []
  // Whole-word, case-sensitive match on any of the names, longest first.
  // Multi-word names also accept either case on their first letter, so
  // "the Captain" matches "The Captain" — but single words like "Will" ≠ "will".
  const pattern = (n) => {
    const first = n[0]
    const lead = /\s/.test(n) && first.toLowerCase() !== first.toUpperCase()
      ? `[${escapeRe(first.toLowerCase())}${escapeRe(first.toUpperCase())}]`
      : escapeRe(first)
    return lead + escapeRe(n.slice(1))
  }
  const re = new RegExp(`(?<![\\p{L}'’])(?:${names.map(pattern).join('|')})(?![\\p{L}])`, 'gu')
  return listPages(nodes)
    .map(({ id, path, node }) => ({ id, path, count: node.content.match(re)?.length ?? 0 }))
    .filter((m) => m.count > 0)
}

export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = normalizeProject(JSON.parse(raw))
      if (data) return data
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
