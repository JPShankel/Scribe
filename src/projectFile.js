// Reading and writing project files on disk.
//
// Where the File System Access API exists (Chrome, Edge), Save writes back to
// the file that was opened or last saved, and the file handle is remembered in
// IndexedDB so Save keeps working after a reload. Elsewhere, Open uses a file
// input and Save downloads a copy.

const FILE_TYPES = [{ description: 'Scribe project', accept: { 'application/json': ['.json'] } }]
const PICKER_ID = 'scribe-project'

export const canWriteFiles = typeof window !== 'undefined' && 'showSaveFilePicker' in window

const isAbort = (err) => err?.name === 'AbortError'

/** Ask the user for a project file. Resolves to { handle, name, text }, or null if cancelled. */
export async function openProjectFile() {
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, id: PICKER_ID })
      const file = await handle.getFile()
      return { handle, name: file.name, text: await file.text() }
    } catch (err) {
      if (isAbort(err)) return null
      throw err
    }
  }
  const file = await pickWithInput()
  return file ? { handle: null, name: file.name, text: await file.text() } : null
}

function pickWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => resolve(input.files[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/**
 * Write the project to `handle`, or ask where to save it when there is no
 * handle (Save As). Resolves to { handle, name }, or null if cancelled.
 */
export async function saveProjectFile(project, handle, suggestedName) {
  const json = JSON.stringify(project, null, 2)
  if (!canWriteFiles) {
    download(json, suggestedName)
    return { handle: null, name: suggestedName }
  }
  try {
    if (!handle) {
      handle = await window.showSaveFilePicker({ suggestedName, types: FILE_TYPES, id: PICKER_ID })
    } else if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
        throw new Error(`Permission to write "${handle.name}" was denied.`)
      }
    }
    const writable = await handle.createWritable()
    await writable.write(json)
    await writable.close()
    return { handle, name: handle.name }
  } catch (err) {
    if (isAbort(err)) return null
    throw err
  }
}

function download(text, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 0)
}

// ---------- Remembering the current file across reloads ----------

const META_KEY = 'scribe.file'

/** { name, dirty, driveId } of the file the working copy belongs to (driveId: a Google Drive file). */
export function loadFileMeta() {
  try {
    const meta = JSON.parse(localStorage.getItem(META_KEY))
    if (meta) return { name: meta.name ?? null, dirty: !!meta.dirty, driveId: meta.driveId ?? null }
  } catch {
    // fall through
  }
  // No record: the working copy has never been saved to a file.
  return { name: null, dirty: true, driveId: null }
}

export function saveFileMeta(meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    // not critical
  }
}

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('scribe', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('kv')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('kv', mode)
      const req = fn(tx.objectStore('kv'))
      tx.oncomplete = () => {
        db.close()
        resolve(req.result)
      }
      tx.onerror = () => reject(tx.error)
    }
  })
}

export const loadFileHandle = () =>
  canWriteFiles ? withStore('readonly', (s) => s.get('handle')).catch(() => null) : Promise.resolve(null)

export const storeFileHandle = (handle) =>
  canWriteFiles
    ? withStore('readwrite', (s) => (handle ? s.put(handle, 'handle') : s.delete('handle'))).catch(() => {})
    : Promise.resolve()
