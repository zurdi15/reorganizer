// Formateadores puros (testeables sin DOM): tamaños de archivo y fechas
// relativas. El locale llega por parámetro con default es — los consumidores
// de componentes pasan el locale activo de vue-i18n.

// bytes → texto humano en base 1024, un decimal solo cuando aporta
// (12.3 MB sí, 12.0 MB no). Techo en TB: nadie sube nada mayor.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 'B'
  for (const next of units) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text} ${unit}`
}

// truncado POR EL MEDIO para nombres de archivo: el FINAL del nombre es lo
// que distingue IMG_2024 (1).jpg de IMG_2024 (2).jpg — text-overflow del CSS
// solo trunca por el final, así que se hace en JS con un único "…". El
// cabezal se lleva el carácter impar: el inicio del nombre orienta más.
export function middleTruncate(text: string, max = 34): string {
  if (text.length <= max) return text
  const keep = Math.max(0, max - 1)
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

// fecha → relativo corto ("hace 3 min", "ayer") con Intl.RelativeTimeFormat;
// más de una semana → fecha absoluta local (el relativo pierde utilidad).
// `now` inyectable para tests deterministas.
export function formatRelativeDate(iso: string | Date, locale = 'es', now: Date = new Date()): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(date.getTime())) return '—'

  const diffMs = date.getTime() - now.getTime()
  const diffSec = Math.round(diffMs / 1000)
  const abs = Math.abs(diffSec)

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < 60) return rtf.format(Math.trunc(diffSec / 1), 'second')
  if (abs < 3600) return rtf.format(Math.trunc(diffSec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.trunc(diffSec / 3600), 'hour')
  if (abs < 604800) return rtf.format(Math.trunc(diffSec / 86400), 'day')

  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}
