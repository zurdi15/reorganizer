// Aplica la preferencia de tema (uiPrefs.ThemeMode) al documento en runtime.
// El guard contra el flash inicial vive aparte, en el script inline de
// index.html (tiene que correr ANTES de que este módulo siquiera se parsee)
// — este archivo mantiene el estado correcto una vez la app ya está viva:
// toggles desde Ajustes y cambios en vivo del tema del SO en modo 'system'.
import { getThemeMode, setThemeMode, type ThemeMode } from './uiPrefs'

const MEDIA_QUERY = '(prefers-color-scheme: light)'

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MEDIA_QUERY).matches
    : false
}

// exportada para poder testear la resolución sin pasar por el DOM
export function resolveIsLight(mode: ThemeMode): boolean {
  return mode === 'light' || (mode === 'system' && systemPrefersLight())
}

// aplica la clase + el meta theme-color para el modo dado. No toca
// localStorage (eso es cosa de uiPrefs) ni el listener de sistema (eso es
// cosa de watchSystemTheme) — una única responsabilidad, testeable aparte.
export function applyTheme(mode: ThemeMode): void {
  const isLight = resolveIsLight(mode)
  document.documentElement.classList.toggle('rg-light', isLight)

  // el color real lo define tokens.css (--rg-bg-void, distinto bajo :root y
  // bajo html.rg-light) — se RELEE del DOM en vez de hardcodear el hex aquí:
  // guard:tokens prohíbe hex crudo fuera de tokens/, y a diferencia del
  // script inline de index.html este módulo corre con la hoja ya cargada
  const meta = document.querySelector('meta[name="theme-color"]')
  const voidColor = getComputedStyle(document.documentElement).getPropertyValue('--rg-bg-void').trim()
  if (meta && voidColor) meta.setAttribute('content', voidColor)
}

let stopWatchingSystem: (() => void) | null = null

function watchSystemTheme(mode: ThemeMode): void {
  stopWatchingSystem?.()
  stopWatchingSystem = null
  if (mode !== 'system' || typeof window.matchMedia !== 'function') return

  const mql = window.matchMedia(MEDIA_QUERY)
  const onChange = () => applyTheme('system')
  mql.addEventListener('change', onChange)
  stopWatchingSystem = () => mql.removeEventListener('change', onChange)
}

// arranque de la app (llamado una vez desde main.ts): aplica lo persistido y
// engancha el listener de sistema si hace falta. El script inline de
// index.html ya dejó la clase/meta correctas antes del primer paint — esto
// es lo que mantiene ambas cosas correctas DESPUÉS, mientras dura la sesión.
export function initTheme(): void {
  const mode = getThemeMode()
  applyTheme(mode)
  watchSystemTheme(mode)
}

// llamado por el picker de Ajustes (oleada 4): persiste + aplica +
// re-engancha (o desengancha) el listener de sistema según el nuevo modo
export function setTheme(mode: ThemeMode): void {
  setThemeMode(mode)
  applyTheme(mode)
  watchSystemTheme(mode)
}
