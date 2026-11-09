// Light/dark view. With no saved choice the app follows the system setting;
// once the user toggles, the choice is kept in localStorage.

const KEY = 'scribe.theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function savedTheme() {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : null
  } catch {
    return null
  }
}

/** The theme currently showing. */
export const currentTheme = () => savedTheme() ?? (media.matches ? 'dark' : 'light')

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
}

export function setTheme(theme) {
  applyTheme(theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // still applies for this session
  }
}

/** Apply the saved theme, if any (otherwise the CSS follows the system). */
export function initTheme() {
  const saved = savedTheme()
  if (saved) applyTheme(saved)
}

/** Call `fn` when the system theme changes while the user hasn't picked one. */
export function onSystemThemeChange(fn) {
  const listener = () => {
    if (!savedTheme()) fn(currentTheme())
  }
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
