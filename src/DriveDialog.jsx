import { useEffect, useRef, useState } from 'react'
import { driveList } from './googleDrive.js'

/** Modal listing the Scribe projects in Google Drive. */
export default function DriveDialog({ onPick, onClose }) {
  const ref = useRef(null)
  const [files, setFiles] = useState(null)
  const [error, setError] = useState('')
  const live = useRef(true)

  // Errors stay on screen (with Try again) rather than closing the dialog,
  // so a failed sign-in is never silent.
  const fetchFiles = () =>
    driveList()
      .then((f) => live.current && setFiles(f))
      .catch((err) => live.current && setError(err.message))

  const retry = () => {
    setError('')
    setFiles(null)
    fetchFiles()
  }

  useEffect(() => {
    live.current = true
    if (!ref.current.open) ref.current.showModal()
    fetchFiles()
    return () => {
      live.current = false
    }
  }, [])

  return (
    <dialog ref={ref} className="drive-dialog" onClose={onClose} onCancel={onClose}>
      <h2>Open from Google Drive</h2>
      {error ? (
        <p className="drive-error">{error}</p>
      ) : !files ? (
        <p className="sheet-muted">Loading your projects…</p>
      ) : files.length === 0 ? (
        <p className="sheet-muted">No Scribe projects in your Drive yet. Use “Save to Drive” to put one there.</p>
      ) : (
        <ul className="drive-files">
          {files.map((f) => (
            <li key={f.id}>
              <button onClick={() => onPick(f)}>
                <span>{f.name}</span>
                <span className="sheet-muted">
                  {new Date(f.modifiedTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="sheet-muted drive-note">
        Only projects saved from Scribe are listed. Scribe can’t see anything else in your Drive.
      </p>
      <div className="drive-actions">
        {error && <button onClick={retry}>Try again</button>}
        <button onClick={onClose}>Cancel</button>
      </div>
    </dialog>
  )
}
