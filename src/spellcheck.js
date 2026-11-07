// Main-thread side of the spellchecker: caches results per word, batches
// lookups to the worker, and keeps a personal dictionary in localStorage.

const DICT_KEY = 'scribe.dictionary.v1'

// Letters (incl. accented) with internal apostrophes: don't, o'clock.
// Hyphenated words are checked part by part.
export const WORD_RE = /[A-Za-zÀ-ɏ]+(?:['’][A-Za-zÀ-ɏ]+)*/g

const normalize = (w) => w.replace(/’/g, "'")

function loadPersonal() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DICT_KEY)) ?? [])
  } catch {
    return new Set()
  }
}

class SpellChecker {
  constructor() {
    this.cache = new Map() // word -> boolean (correct?)
    this.pending = new Set()
    this.personal = loadPersonal()
    this.ignored = new Set() // session-only "Ignore"
    this.projectWords = new Set() // character names etc.
    this.listeners = new Set()
    this.suggestWaiters = new Map()
    this.nextId = 1
    this.ready = false
    this.revision = 0 // bumps whenever results change, for React subscriptions

    this.worker = new Worker(new URL('./spell.worker.js', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e) => this.onMessage(e.data)
    if (this.personal.size) this.worker.postMessage({ type: 'add', words: [...this.personal] })
  }

  onMessage(msg) {
    if (msg.type === 'ready') {
      this.ready = true
      this.emit()
    } else if (msg.type === 'checked') {
      for (const [w, ok] of msg.results) {
        this.cache.set(w, ok)
        this.pending.delete(w)
      }
      this.emit()
    } else if (msg.type === 'suggestions') {
      this.suggestWaiters.get(msg.id)?.(msg.suggestions)
      this.suggestWaiters.delete(msg.id)
    } else if (msg.type === 'error') {
      console.error('Spellchecker failed to load:', msg.message)
    }
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    this.revision++
    this.listeners.forEach((fn) => fn())
  }

  /**
   * Words that are correct for this project only (e.g. character names).
   * Not persisted — the caller re-supplies them from the project.
   */
  setProjectWords(words) {
    const next = new Set(words.map(normalize))
    const added = [...next].filter((w) => !this.projectWords.has(w))
    const removed = [...this.projectWords].filter((w) => !next.has(w))
    if (!added.length && !removed.length) return
    this.projectWords = next
    if (added.length) this.worker.postMessage({ type: 'add', words: added })
    const toRemove = removed.filter((w) => !this.personal.has(w))
    if (toRemove.length) this.worker.postMessage({ type: 'remove', words: toRemove })
    // Dictionary changed; possessives/plurals of these may now check differently.
    this.cache.clear()
    this.emit()
  }

  /** Returns true if known-misspelled. Unknown words are queued and treated as fine for now. */
  isMisspelled(raw) {
    const w = normalize(raw)
    const known = (x) => this.personal.has(x) || this.ignored.has(x) || this.projectWords.has(x)
    if (known(w) || known(w.replace(/'s$/i, ''))) return false // also accept possessives: Elara's
    const ok = this.cache.get(w)
    if (ok === undefined) {
      this.request(w)
      return false
    }
    return !ok
  }

  request(w) {
    if (this.pending.has(w)) return
    this.pending.add(w)
    if (!this.flushScheduled) {
      this.flushScheduled = true
      queueMicrotask(() => {
        this.flushScheduled = false
        const words = [...this.pending]
        if (words.length) this.worker.postMessage({ type: 'check', words })
      })
    }
  }

  suggest(raw) {
    const id = this.nextId++
    this.worker.postMessage({ type: 'suggest', id, word: normalize(raw) })
    return new Promise((resolve) => this.suggestWaiters.set(id, resolve))
  }

  addToDictionary(raw) {
    const w = normalize(raw)
    this.personal.add(w)
    try {
      localStorage.setItem(DICT_KEY, JSON.stringify([...this.personal]))
    } catch {
      // personal dictionary just won't persist
    }
    this.worker.postMessage({ type: 'add', words: [w] })
    this.cache.delete(w)
    this.emit()
  }

  ignore(raw) {
    this.ignored.add(normalize(raw))
    this.emit()
  }
}

let instance = null
export const getSpellChecker = () => (instance ??= new SpellChecker())
