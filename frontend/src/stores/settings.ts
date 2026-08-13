import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  createRule,
  deleteRule,
  fetchRules,
  patchRule,
  reorderRules,
  type RuleRead,
  type RuleSavePayload,
} from '@/api/rules'
import {
  fetchImmichLibraries,
  fetchSettings,
  testImmich,
  updateSettings,
  type ImmichLibrary,
  type ImmichTestOverride,
  type ImmichTestResult,
} from '@/api/settings'
import type { Settings } from '@/types/api'

// Estado de Ajustes: settings de servidor + lista de reglas. La API key de
// Immich JAMÁS vive aquí en claro: el server la devuelve enmascarada
// ("****" + últimos 4) y el estado siempre refleja la respuesta del server.
export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings | null>(null)
  const rules = ref<RuleRead[]>([])
  const loading = ref(false)
  // primer load con ÉXITO: la vista distingue "cargando" de "listo"
  const loaded = ref(false)

  // promesa compartida del load en vuelo — el deduplicador: la vista y
  // cualquier tarjeta pueden pedirlo a la vez sin duplicar peticiones
  let inflight: Promise<void> | null = null

  function ensureLoaded(): Promise<void> {
    if (loaded.value) return Promise.resolve()
    if (inflight) return inflight
    loading.value = true
    inflight = Promise.all([fetchSettings(), fetchRules()])
      .then(([nextSettings, nextRules]) => {
        settings.value = nextSettings
        rules.value = nextRules
        loaded.value = true
      })
      .finally(() => {
        inflight = null
        loading.value = false
      })
    return inflight
  }

  // ---- settings ----

  // PUT parcial; el estado se reemplaza SIEMPRE por la respuesta del server
  // (key enmascarada incluida) — nunca por lo que tecleó el usuario
  async function save(partial: Partial<Settings>): Promise<void> {
    settings.value = await updateSettings(partial)
  }

  // ---- Immich (passthroughs sin estado: el resultado es efímero de la UI) ----

  function immichTest(override?: ImmichTestOverride): Promise<ImmichTestResult> {
    return testImmich(override)
  }

  function immichLibraries(): Promise<ImmichLibrary[]> {
    return fetchImmichLibraries()
  }

  // ---- reglas ----

  function replaceRule(updated: RuleRead) {
    rules.value = rules.value.map((rule) => (rule.id === updated.id ? updated : rule))
  }

  // crear (id null) o parchear; la lista local se actualiza con la respuesta
  // canónica del server, re-ordenada por priority por si acaso
  async function saveRule(id: number | null, payload: RuleSavePayload): Promise<RuleRead> {
    if (id === null) {
      const created = await createRule(payload)
      rules.value = [...rules.value, created].sort((a, b) => a.priority - b.priority)
      return created
    }
    const updated = await patchRule(id, payload)
    replaceRule(updated)
    return updated
  }

  // switch inline de la lista: optimista (el toggle responde YA) con
  // rollback si el PATCH falla — el error se relanza para que la vista toaste
  async function toggleRule(id: number, enabled: boolean): Promise<void> {
    const rule = rules.value.find((r) => r.id === id)
    if (!rule || rule.enabled === enabled) return
    const previous = rule.enabled
    rule.enabled = enabled
    try {
      replaceRule(await patchRule(id, { enabled }))
    } catch (error) {
      rule.enabled = previous
      throw error
    }
  }

  async function removeRule(id: number): Promise<void> {
    await deleteRule(id)
    rules.value = rules.value.filter((rule) => rule.id !== id)
  }

  // reorder optimista: el nuevo orden se pinta al instante y se revierte al
  // snapshot previo si el server lo rechaza (invalid_rule_order…)
  async function reorder(ids: number[]): Promise<void> {
    const previous = rules.value
    const byId = new Map(previous.map((rule) => [rule.id, rule]))
    const next = ids
      .map((id) => byId.get(id))
      .filter((rule): rule is RuleRead => rule !== undefined)
    rules.value = next
    try {
      // la respuesta trae las priorities reescritas (10,20,30…): manda ella
      rules.value = await reorderRules(ids)
    } catch (error) {
      rules.value = previous
      throw error
    }
  }

  // ↑/↓ de una fila: construye la permutación completa de ids que exige el
  // contrato. En los bordes es un no-op silencioso (los botones ya van
  // disabled — esto es el cinturón)
  function moveRule(id: number, delta: -1 | 1): Promise<void> {
    const ids = rules.value.map((rule) => rule.id)
    const from = ids.indexOf(id)
    const to = from + delta
    if (from === -1 || to < 0 || to >= ids.length) return Promise.resolve()
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    return reorder(ids)
  }

  return {
    settings,
    rules,
    loading,
    loaded,
    ensureLoaded,
    save,
    immichTest,
    immichLibraries,
    saveRule,
    toggleRule,
    removeRule,
    reorder,
    moveRule,
  }
})
