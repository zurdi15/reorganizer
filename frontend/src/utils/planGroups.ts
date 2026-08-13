// Agrupación PURA de los items de un plan para la preview (testeable sin
// DOM). planned_dest llega con el dest_path del job como prefijo
// ("2024/08/croacia/photo/IMG_1.jpg"): aquí se separa la parte relativa y se
// agrupa por subcarpeta (lo que hay entre el destino y el nombre).
import type { JobItem } from '@/types/api'

// carpeta fallback built-in del backend (rules.UNKNOWN_DEST) — nombre real
// en disco, no se traduce
export const UNKNOWN_DIR = '_unknown'

export interface PlanRow {
  item: JobItem
  // ruta relativa al dest_path del job ("photo/IMG_1.jpg")
  relDest: string
  filename: string
}

export interface PlanGroup {
  // subcarpeta entre dest_path y el nombre ('' = raíz del destino)
  subfolder: string
  rows: PlanRow[]
}

// parte de planned_dest relativa al destino del job. Si el prefijo no cuadra
// (no debería pasar), se devuelve tal cual antes que inventar rutas.
export function relativeDest(item: JobItem, destPath: string): string {
  const dest = item.planned_dest ?? item.source_path
  const prefix = `${destPath}/`
  return destPath && dest.startsWith(prefix) ? dest.slice(prefix.length) : dest
}

// ¿el item cae en el fallback _unknown/ (sin regla que lo clasifique)?
export function isUnknownDest(item: JobItem, destPath: string): boolean {
  const rel = relativeDest(item, destPath)
  return rel === UNKNOWN_DIR || rel.startsWith(`${UNKNOWN_DIR}/`)
}

function toRow(item: JobItem, destPath: string): PlanRow {
  const rel = relativeDest(item, destPath)
  const slash = rel.lastIndexOf('/')
  return {
    item,
    relDest: rel,
    filename: slash === -1 ? rel : rel.slice(slash + 1),
  }
}

// grupos ordenados alfabéticamente por subcarpeta (la raíz '' primero);
// dentro de cada grupo se conserva el orden de llegada (el del plan)
export function groupPlanItems(items: JobItem[], destPath: string): PlanGroup[] {
  const map = new Map<string, PlanRow[]>()
  for (const item of items) {
    const row = toRow(item, destPath)
    const slash = row.relDest.lastIndexOf('/')
    const subfolder = slash === -1 ? '' : row.relDest.slice(0, slash)
    const rows = map.get(subfolder)
    if (rows) rows.push(row)
    else map.set(subfolder, [row])
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subfolder, rows]) => ({ subfolder, rows }))
}
