// Endpoints tipados del dominio input (fase 10). Funciones finas sobre
// api(): la política de errores (ApiError/OfflineError) vive en client.ts y
// el estado en stores/input.ts — aquí solo URLs y tipos.
import { api } from './client'
import type { InputDates, InputFile, InputProbe, InputSummary } from '@/types/api'

export function fetchInputFiles(): Promise<InputFile[]> {
  return api<InputFile[]>('/input/files')
}

export function fetchInputSummary(): Promise<InputSummary> {
  return api<InputSummary>('/input/summary')
}

export function fetchInputDates(): Promise<InputDates> {
  return api<InputDates>('/input/dates')
}

// probe on-demand de UN archivo (EXIF/ffprobe + regla que matchearía) —
// solo lo dispara la sheet de detalle al abrirse, nunca la grid entera
export function probeInputFile(path: string): Promise<InputProbe> {
  return api<InputProbe>(`/input/probe?path=${encodeURIComponent(path)}`)
}

export function deleteInputFile(path: string): Promise<void> {
  return api<void>(`/input/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
}

// URL de miniatura para <img src> directo — SIEMPRE thumb=1 (JPEG 512px
// cacheado en el server): la grid móvil jamás descarga originales, y para la
// preview grande de la sheet 512px también sobra. El original (thumb=0)
// no tiene consumidor en la UI de esta fase, así que ni se ofrece.
export function inputThumbUrl(path: string): string {
  return `/api/v1/input/preview?path=${encodeURIComponent(path)}&thumb=1`
}
