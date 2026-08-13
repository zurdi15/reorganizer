// Cliente HTTP mínimo (berserk sin capa offline ni handler 401 — Reorganizer
// no tiene auth y no cachea lecturas: LAN/VPN, la verdad vive en el server).

export class ApiError extends Error {
  constructor(
    public status: number,
    public slug: string,
    // nombre del campo (snake_case, tal cual lo reporta pydantic) cuando
    // slug es el fallback genérico "validation" — permite interpolar
    // errors.validation ("Valor no válido en {field}") en vez de un mensaje
    // mudo. undefined para cualquier otro slug.
    public field?: string,
  ) {
    super(slug)
  }
}

// un fetch que muere por RED (TypeError — DNS, sin cobertura, servidor
// caído) es una categoría distinta de un error HTTP del servidor: la vista
// lo muestra como errors.offline con instrucción implícita (reintenta)
export class OfflineError extends Error {
  constructor() {
    super('offline')
  }
}

const BASE = '/api/v1'

// los 422 de pydantic traen detail como una LISTA de errores de validación
// (uno por campo), nunca un string — sin esto, cualquiera colapsaría al slug
// fijo 'generic' ("Algo ha fallado", inútil para saber qué corregir). Se
// extrae el PRIMER error de la lista:
//  - los ValueError propios de un @field_validator llevan su slug literal
//    incrustado en el mensaje que antepone pydantic ("Value error, <slug>")
//    — se separa con una regex y los slugs de errors.* se reutilizan sin
//    tocar el backend.
//  - las violaciones de longitud de Field(min_length=/max_length=) no traen
//    slug propio: se intenta <campo>_<tipo> — si esa clave no existe en
//    errors.*, toastApiError cae a errors.validation con el campo interpolado.
const TYPE_SUFFIXES: Record<string, string> = {
  string_too_short: 'too_short',
  string_too_long: 'too_long',
}

interface PydanticValidationEntry {
  type?: unknown
  loc?: unknown
  msg?: unknown
}

function fromValidationList(detail: unknown[]): { slug: string; field?: string } {
  const first = detail[0] as PydanticValidationEntry
  const loc = Array.isArray(first?.loc) ? first.loc : []
  const field = loc.length ? String(loc[loc.length - 1]) : undefined

  if (first?.type === 'value_error' && typeof first.msg === 'string') {
    const match = /^Value error,\s*(.+)$/.exec(first.msg)
    if (match) return { slug: match[1] }
  }
  if (field && typeof first?.type === 'string') {
    const suffix = TYPE_SUFFIXES[first.type]
    if (suffix) return { slug: `${field}_${suffix}`, field }
  }
  return { slug: 'validation', field: field ?? 'unknown' }
}

function toSlug(detail: unknown): { slug: string; field?: string } {
  if (typeof detail === 'string') return { slug: detail }
  if (Array.isArray(detail) && detail.length > 0) return fromValidationList(detail)
  return { slug: 'generic' }
}

// subida multipart — mismo contrato de errores que api(), pero con FormData
// (el navegador pone el boundary; nada de Content-Type manual). Nota: la
// cola de subidas real (oleada 3) usa XHR para tener progreso — esto queda
// para POSTs multipart sin progreso.
export async function apiForm<T = unknown>(path: string, form: FormData): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    })
  } catch {
    throw new OfflineError()
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const { slug, field } = toSlug((payload as { detail?: unknown }).detail)
    throw new ApiError(response.status, slug, field)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET'
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    // fetch solo LANZA por fallo de red/CORS, nunca por un status HTTP —
    // aquí no hubo servidor
    throw new OfflineError()
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const { slug, field } = toSlug((payload as { detail?: unknown }).detail)
    throw new ApiError(response.status, slug, field)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
