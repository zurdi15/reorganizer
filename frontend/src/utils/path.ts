// Validación PURA de segmentos/rutas de destino para el path builder
// (DestinationBuilder, oleada 4) — el backend re-valida SIEMPRE con
// resolve_under(); esto solo da feedback inmediato en cliente. Reglas del
// plan: rechazar `..`, rutas absolutas (/ inicial) y caracteres prohibidos;
// recortar puntos/espacios en los extremos (Windows-safe: un segmento que
// termina en punto o espacio rompe en SMB/NTFS).

// prohibidos: separadores (/ \), reservados de Windows (< > : " | ? *) y
// caracteres de control C0 + DEL
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>:"|?*\/\\\u0000-\u001F\u007F]/

const MAX_SEGMENT_LENGTH = 120

// normaliza un segmento tecleado: espacios fuera y puntos/espacios de los
// extremos fuera. Lo que quede es lo que se validará/confirmará como chip.
export function normalizeSegment(raw: string): string {
  return raw.trim().replace(/^[.\s]+|[.\s]+$/g, '')
}

// un segmento ya normalizado, ¿es un nombre de carpeta válido?
export function isValidSegment(segment: string): boolean {
  if (segment.length === 0 || segment.length > MAX_SEGMENT_LENGTH) return false
  if (segment === '.' || segment === '..') return false
  if (FORBIDDEN_CHARS.test(segment)) return false
  return true
}

// valida una ruta relativa completa "2024/08/croacia": relativa (sin /
// inicial ni final), sin segmentos vacíos (//) y con cada segmento válido
// TAL CUAL (sin normalizar aquí: una ruta con espacios colgantes debe
// rechazarse, no arreglarse en silencio — normalizar es cosa del builder al
// confirmar cada chip).
export function isValidRelPath(path: string): boolean {
  if (path.length === 0) return false
  if (path.startsWith('/') || path.endsWith('/')) return false
  const segments = path.split('/')
  return segments.every((s) => s === normalizeSegment(s) && isValidSegment(s))
}

// segmentos confirmados → ruta relativa (los inválidos nunca deberían llegar
// aquí; se filtran por si acaso para no componer una ruta corrupta)
export function joinSegments(segments: string[]): string {
  return segments.filter((s) => isValidSegment(s)).join('/')
}
