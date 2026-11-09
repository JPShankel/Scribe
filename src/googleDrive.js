// Saving and opening projects in Google Drive.
//
// Sign-in uses Google Identity Services (a popup that hands back a short-lived
// access token); files go through the Drive REST API. The `drive.file` scope
// only gives Scribe access to files it created or that were opened with it,
// never the rest of the user's Drive.
//
// Needs an OAuth client ID in VITE_GOOGLE_CLIENT_ID (see .env.example).

// Trimmed: values pasted into hosting dashboards often pick up a trailing newline,
// which Google rejects as an unknown client.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

export const driveConfigured = !!CLIENT_ID

// ---------- Sign-in ----------

let gisPromise = null
/** Load the Google Identity Services script (once). */
export function loadGis() {
  gisPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      gisPromise = null
      reject(new Error('Could not reach Google sign-in. Are you online?'))
    }
    document.head.appendChild(script)
  })
  return gisPromise
}

let token = null
let expiresAt = 0
let client = null

/** Turn a Google sign-in failure into something the user can act on. */
function signInError(type, detail) {
  const origin = window.location.origin
  const messages = {
    popup_failed_to_open: 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.',
    popup_closed:
      'The Google sign-in window closed before sign-in finished. If Google showed an error there, the usual causes are: ' +
      `${origin} isn’t listed under “Authorised JavaScript origins” for the OAuth client (changes can take a few minutes to apply); ` +
      'your Google account isn’t a test user on the OAuth consent screen; or the Google Drive API isn’t enabled.',
    access_denied: 'Google sign-in was declined, so Scribe can’t reach your Drive.',
  }
  const err = new Error(messages[type] ?? `Google sign-in failed: ${detail || type}.`)
  err.code = type
  return err
}

const hasToken = () => !!token && Date.now() < expiresAt - 60_000
export const isSignedIn = hasToken

let pending = null

/**
 * Start Google sign-in now. Browsers only allow the sign-in popup when it is
 * opened directly inside a click or keypress (Safari and Firefox are strict),
 * so call this synchronously from the event handler, before any await.
 * Each call starts a fresh attempt, so a popup that was blocked or abandoned
 * never leaves later clicks stuck.
 */
export function signIn() {
  if (hasToken()) return Promise.resolve(token)
  pending = window.google?.accounts?.oauth2
    ? requestTokenNow()
    : loadGis().then(requestTokenNow) // not loaded yet: the popup may be blocked, but the retry will work
  const current = pending
  current
    .finally(() => {
      if (pending === current) pending = null
    })
    .catch(() => {})
  return current
}

/** An access token: the current one, the sign-in in progress, or a new sign-in. */
function getToken() {
  if (hasToken()) return Promise.resolve(token)
  return pending ?? signIn()
}

/** Open Google's popup synchronously (the Promise executor runs immediately). */
function requestTokenNow() {
  return new Promise((resolve, reject) => {
    client ??= window.google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => {} })
    client.callback = (resp) => {
      if (resp.error) return reject(signInError(resp.error, resp.error_description))
      token = resp.access_token
      expiresAt = Date.now() + resp.expires_in * 1000
      resolve(token)
    }
    client.error_callback = (err) => reject(signInError(err.type, err.message))
    client.requestAccessToken()
  })
}

async function api(url, options = {}, retry = true) {
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${await getToken()}` },
  })
  if (res.status === 401 && retry) {
    token = null // expired or revoked: sign in again
    return api(url, options, false)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const err = new Error(`Google Drive: ${body?.error?.message ?? res.statusText ?? res.status}`)
    err.status = res.status
    throw err
  }
  return res
}

// ---------- Files ----------

/**
 * Save the project to Drive: overwrite `fileId`, or create a new file when
 * there is none (or it has since been deleted). Resolves to { id, name }.
 */
export async function driveSave(project, fileId, name) {
  const json = JSON.stringify(project, null, 2)
  if (fileId) {
    try {
      const res = await api(`${UPLOAD}/${fileId}?uploadType=media&fields=id,name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      })
      return res.json()
    } catch (err) {
      if (err.status !== 404) throw err
      // The file is gone: fall through and create a new one.
    }
  }
  const boundary = `scribe-${Math.random().toString(36).slice(2)}`
  const meta = { name, mimeType: 'application/json', appProperties: { scribe: 'project' } }
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`
  const res = await api(`${UPLOAD}?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return res.json()
}

/** Scribe projects in Drive, newest first: [{ id, name, modifiedTime }]. */
export async function driveList() {
  const q = "appProperties has { key='scribe' and value='project' } and trashed=false"
  const params = new URLSearchParams({
    q,
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,modifiedTime)',
    pageSize: '100',
  })
  const res = await api(`${API}?${params}`)
  return (await res.json()).files ?? []
}

/** The text of a Drive file. */
export async function driveLoad(fileId) {
  const res = await api(`${API}/${fileId}?alt=media`)
  return res.text()
}
