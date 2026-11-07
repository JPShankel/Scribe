// PDF export: lay the manuscript out as a print-ready HTML document in a hidden
// iframe and open the browser's print dialog, where "Save as PDF" writes the file.
// The browser's own typesetting gives proper fonts, Unicode and hyphenation with
// no PDF library.

import { ROOT_ID, countWords } from './store.js'

const escapeHtml = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** Plain text → paragraphs: each non-blank line is one paragraph. */
const paragraphs = (text) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join('\n')

/**
 * Top-level folders become chapters (each starting on a new page), deeper
 * folders become section headings, and consecutive pages within a folder are
 * separated by a scene break. Page names are working titles and are left out.
 */
function renderBody(nodes) {
  const out = []
  const walk = (id, depth) => {
    const n = nodes[id]
    let prevWasPage = false
    for (const childId of n.children) {
      const c = nodes[childId]
      if (c.type === 'page') {
        if (!c.content.trim()) continue
        if (prevWasPage) out.push('<p class="scene-break" aria-hidden="true">*&nbsp;&nbsp;*&nbsp;&nbsp;*</p>')
        out.push(`<section class="text">\n${paragraphs(c.content)}\n</section>`)
        prevWasPage = true
      } else {
        const tag = depth === 0 ? 'h2' : 'h3'
        out.push(`<${tag}>${escapeHtml(c.name)}</${tag}>`)
        walk(childId, depth + 1)
        prevWasPage = false
      }
    }
  }
  walk(ROOT_ID, 0)
  return out.join('\n')
}

/** Quote a string for use inside a CSS `content` value (and safely inside <style>). */
const cssString = (s) => `"${s.replace(/[\\"]/g, '\\$&').replace(/</g, '\\3c ').replace(/\s+/g, ' ')}"`

/** Standard manuscript format: Times New Roman 12pt, double-spaced, 1in margins. */
export function buildManuscriptHtml(nodes, author = '') {
  const title = nodes[ROOT_ID].name || 'Untitled'
  const words = Object.values(nodes)
    .filter((n) => n.type === 'page')
    .reduce((sum, n) => sum + countWords(n.content), 0)
  // Round like a manuscript cover page does.
  const approx = words < 1000 ? words : Math.round(words / 1000) * 1000
  const lastName = author.trim().split(/\s+/).pop() ?? ''
  const header = lastName ? `${cssString(lastName + ' ')} counter(page)` : 'counter(page)'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page {
    size: auto;
    margin: 1in;
    @top-right { content: ${header}; font: 12pt 'Times New Roman', Times, serif; }
  }
  @page :first { @top-right { content: none; } }
  html { font: 12pt/2 'Times New Roman', Times, serif; color: #000; background: #fff; }
  body { margin: 0; }
  .title-page {
    height: 9in; display: flex; flex-direction: column;
    justify-content: center; align-items: center; text-align: center;
    break-after: page;
  }
  .title-page h1 { font-size: 12pt; font-weight: normal; text-transform: uppercase; margin: 0; }
  .title-page p { text-indent: 0; text-align: center; }
  h2 {
    break-before: page; break-after: avoid;
    font-size: 12pt; font-weight: normal; text-align: center;
    margin: 3in 0 2em;
  }
  h3 { break-after: avoid; font-size: 12pt; font-weight: normal; text-align: center; margin: 2em 0 0; }
  p { margin: 0; text-indent: 0.5in; text-align: left; orphans: 2; widows: 2; }
  .scene-break { text-align: center; text-indent: 0; break-after: avoid; }
</style>
</head>
<body>
<div class="title-page">
  <h1>${escapeHtml(title)}</h1>
  ${author.trim() ? `<p>by ${escapeHtml(author.trim())}</p>` : ''}
  ${words ? `<p>approx. ${approx.toLocaleString()} words</p>` : ''}
</div>
${renderBody(nodes)}
</body>
</html>`
}

/** Open the print dialog for the manuscript; the user picks "Save as PDF". */
export function exportPdf(nodes, author) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  // Browsers name the saved PDF after the document title.
  const prevTitle = document.title
  document.title = nodes[ROOT_ID].name || 'Untitled'

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    document.title = prevTitle
    iframe.remove()
  }

  iframe.onload = () => {
    const win = iframe.contentWindow
    win.addEventListener('afterprint', () => setTimeout(cleanup, 0))
    win.focus()
    win.print()
    // print() blocks in most browsers; this catches ones that don't fire afterprint.
    setTimeout(cleanup, 60_000)
  }
  iframe.srcdoc = buildManuscriptHtml(nodes, author)
  document.body.appendChild(iframe)
}
