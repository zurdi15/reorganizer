import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useWebSocketStore = defineStore('websocket', () => {
  const isConnected = ref(false)
  const retryCount = ref(0)
  const maxRetries = ref(10)
  const baseDelay = ref(1000) // 1 second

  /**
   * Set connected state
   */
  const setConnected = (connected: boolean): void => {
    isConnected.value = connected
    if (connected) {
      retryCount.value = 0
    }
  }

  /**
   * Increment retry count
   */
  const incrementRetry = (): void => {
    retryCount.value += 1
  }

  /**
   * Reset retry count
   */
  const resetRetry = (): void => {
    retryCount.value = 0
  }

  /**
   * Calculate exponential backoff delay
   */
  const getRetryDelay = computed(() => {
    const exponentialDelay = baseDelay.value * Math.pow(2, retryCount.value)
    const maxDelay = 30000 // 30 seconds max
    return Math.min(exponentialDelay, maxDelay)
  })

  /**
   * Check if should retry
   */
  const shouldRetry = computed(() => retryCount.value < maxRetries.value)

  return {
    isConnected,
    retryCount,
    maxRetries,
    baseDelay,
    setConnected,
    incrementRetry,
    resetRetry,
    getRetryDelay,
    shouldRetry,
  }
})
