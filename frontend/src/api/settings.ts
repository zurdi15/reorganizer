// Endpoints tipados del dominio settings (fase 13). Funciones finas sobre
// api(): la política de errores (ApiError/OfflineError) vive en client.ts y
// el estado en stores/settings.ts — aquí solo URLs y tipos.
import { api } from './client'
import type { Settings } from '@/types/api'

// Respuesta de POST /settings/immich/test (tipos locales: no forman parte
// del contrato compartido de types/api.ts, solo de este dominio)
export interface ImmichTestResult {
  ok: boolean
  version: string
}

export interface ImmichLibrary {
  id: string
  name: string
}

// Override opcional para probar credenciales ANTES de guardarlas; un
// api_key enmascarado ("****…") o vacío = usar el almacenado en el server
export interface ImmichTestOverride {
  url?: string
  api_key?: string
}

export function fetchSettings(): Promise<Settings> {
  return api<Settings>('/settings')
}

// PUT parcial: campo ausente = sin cambios. La api_key enmascarada que el
// form re-envía tal cual también significa "sin cambios" (contrato backend);
// "" la borra y cualquier otro valor la sobrescribe.
export function updateSettings(partial: Partial<Settings>): Promise<Settings> {
  return api<Settings>('/settings', { method: 'PUT', body: partial })
}

export function testImmich(override?: ImmichTestOverride): Promise<ImmichTestResult> {
  return api<ImmichTestResult>('/settings/immich/test', {
    method: 'POST',
    body: override ?? {},
  })
}

// listado de librerías externas — SIEMPRE con las credenciales guardadas en
// DB (el endpoint no acepta override): probar conexión persiste primero
export function fetchImmichLibraries(): Promise<ImmichLibrary[]> {
  return api<ImmichLibrary[]>('/settings/immich/libraries')
}
