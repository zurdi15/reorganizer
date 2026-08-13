import { ApiError, OfflineError } from '@/api/client'
import { i18n } from '@/i18n'
import { useToastStore } from '@/stores/toast'

// tres niveles de fallback, nunca directo a "Algo ha fallado" (herencia
// berserk) — 1) el slug específico (del backend o reconstruido por client.ts
// a partir de una lista de validación) si existe traducción; 2)
// errors.validation con el CAMPO interpolado, si client.ts pudo identificar
// cuál era; 3) errors.generic, solo cuando no hay ninguna pista aprovechable.
export function toastApiError(error: unknown) {
  const message = resolveApiErrorMessage(error)
  useToastStore().push('error', message)
}

export function resolveApiErrorMessage(error: unknown): string {
  // sin red no es "algo ha fallado" — es un estado con nombre y con
  // instrucción implícita (reintenta con cobertura)
  if (error instanceof OfflineError) return i18n.global.t('errors.offline')
  if (!(error instanceof ApiError)) return i18n.global.t('errors.generic')

  // "validation" (el fallback fielded de client.ts) SIEMPRE necesita el
  // campo interpolado cuando lo hay — se resuelve ANTES de la comprobación
  // genérica de abajo, que si no devolvería el placeholder sin interpolar
  if (error.slug === 'validation' && error.field) {
    return i18n.global.t('errors.validation', { field: error.field })
  }

  const specificKey = `errors.${error.slug}`
  if (i18n.global.te(specificKey)) return i18n.global.t(specificKey)

  return i18n.global.t('errors.generic')
}
