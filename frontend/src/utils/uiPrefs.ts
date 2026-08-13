// Preferencias de UI puramente de cliente, sin backend — persisten en
// localStorage para sobrevivir a un refresco o una nueva sesión. Si
// localStorage no está disponible (modo privado agresivo, almacenamiento
// lleno) se degrada al default en memoria sin romper la app: leer/escribir
// la preferencia nunca debe tirar por sí sola. Patrón heredado de berserk.

// Tema: 'system' es el default — sigue prefers-color-scheme hasta que el
// usuario elige explícitamente oscuro o claro. La clave 'rg:theme' está
// DUPLICADA a propósito en el script inline de index.html (que no puede
// importar este módulo); indexHtmlTheme.spec.ts las mantiene en sincronía.
export type ThemeMode = 'dark' | 'light' | 'system'
const THEME_KEY = 'rg:theme'
const VALID_THEME_MODES: readonly ThemeMode[] = ['dark', 'light', 'system']

function isThemeMode(value: string | null): value is ThemeMode {
  return value !== null && (VALID_THEME_MODES as readonly string[]).includes(value)
}

export function getThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    // valor corrupto/ajeno: se trata igual que "nada persistido"
    return isThemeMode(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode)
  } catch {
    // no persiste, pero la clase ya aplicada en <html> sigue en pie en memoria
  }
}

// Idioma: es por defecto (instancia LAN familiar), en como alternativa.
// Local al dispositivo, igual que el tema.
export type LocalePref = 'es' | 'en'
const LOCALE_KEY = 'rg:lang'

export function getLocalePref(): LocalePref {
  try {
    const raw = localStorage.getItem(LOCALE_KEY)
    return raw === 'en' || raw === 'es' ? raw : 'es'
  } catch {
    return 'es'
  }
}

export function setLocalePref(locale: LocalePref): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale)
  } catch {
    // sin persistencia: el idioma vive lo que la sesión de página
  }
}
