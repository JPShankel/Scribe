// Runs Hunspell-compatible spellchecking off the main thread so typing stays smooth.
import nspell from 'nspell'
import affUrl from '../node_modules/dictionary-en/index.aff?url'
import dicUrl from '../node_modules/dictionary-en/index.dic?url'

let speller = null
const queue = []

async function init() {
  const [aff, dic] = await Promise.all([
    fetch(affUrl).then((r) => r.text()),
    fetch(dicUrl).then((r) => r.text()),
  ])
  speller = nspell(aff, dic)
  postMessage({ type: 'ready' })
  queue.splice(0).forEach(handle)
}

function handle(msg) {
  switch (msg.type) {
    case 'add':
      msg.words.forEach((w) => speller.add(w))
      break
    case 'remove':
      msg.words.forEach((w) => speller.remove(w))
      break
    case 'check':
      postMessage({
        type: 'checked',
        results: msg.words.map((w) => [w, speller.correct(w)]),
      })
      break
    case 'suggest':
      postMessage({
        type: 'suggestions',
        id: msg.id,
        word: msg.word,
        suggestions: speller.suggest(msg.word).slice(0, 8),
      })
      break
  }
}

onmessage = (e) => (speller ? handle(e.data) : queue.push(e.data))

init().catch((err) => postMessage({ type: 'error', message: String(err) }))
