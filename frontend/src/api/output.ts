// Árbol de salida para el autocompletado del DestinationBuilder. El server
// es traversal-safe (resolve_under) y responde [] para rutas aún no creadas:
// componer una carpeta nueva es el caso normal, no un error.
import { api } from './client'
import type { OutputDir } from '@/types/api'

export function fetchOutputDirs(path = ''): Promise<OutputDir[]> {
  const suffix = path ? `?path=${encodeURIComponent(path)}` : ''
  return api<OutputDir[]>(`/output/dirs${suffix}`)
}
