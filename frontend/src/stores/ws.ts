import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

// Estado de conexión + contadores de reintento del WebSocket (port del
// wsStore del Reorganizer viejo, ya probado en producción). La aritmética
// del backoff vive AQUÍ y el composable useWebSocket solo la consume:
// 1s base ×2 por intento, techo 30s, máximo 10 reintentos — a partir de ahí
// solo el revival por visibilitychange (volver a primer plano) resetea la
// cuenta y reconecta.
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30000
const MAX_RETRIES = 10

export const useWsStore = defineStore('ws', () => {
  const connected = ref(false)
  const retryCount = ref(0)

  // delay del PRÓXIMO intento según los reintentos ya consumidos: con
  // retryCount=0 → 1s (el primer reintento no espera 2s — deviation
  // deliberada del código viejo, que incrementaba antes de leer y se saltaba
  // el escalón de 1s de su propia base)
  const retryDelay = computed(() =>
    Math.min(BASE_DELAY_MS * Math.pow(2, retryCount.value), MAX_DELAY_MS),
  )

  const shouldRetry = computed(() => retryCount.value < MAX_RETRIES)

  function setConnected(value: boolean) {
    connected.value = value
    // conexión viva = presupuesto de reintentos restaurado
    if (value) retryCount.value = 0
  }

  function incrementRetry() {
    retryCount.value += 1
  }

  function resetRetry() {
    retryCount.value = 0
  }

  return { connected, retryCount, retryDelay, shouldRetry, setConnected, incrementRetry, resetRetry }
})
