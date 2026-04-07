import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProcessingStats, ServerState } from '../types/index'

export const useProcessingStore = defineStore('processing', () => {
  const isProcessing = ref(false)
  const stats = ref<ProcessingStats>({
    total: 0,
    processed: 0,
    pictures: 0,
    videos: 0,
    unknown: 0,
    errors: 0,
  })
  const logs = ref<string[]>([])
  const errors = ref<string[]>([])

  /**
   * Apply a full state-sync from the server (on connect / reconnect)
   */
  const applyStateSync = (serverState: ServerState): void => {
    isProcessing.value = serverState.status === 'processing'
    stats.value = { ...serverState.stats }
    logs.value = [...serverState.logs]
    errors.value = [...serverState.errors]
  }

  /**
   * Start processing
   */
  const startProcessing = (): void => {
    isProcessing.value = true
  }

  /**
   * Stop processing
   */
  const stopProcessing = (): void => {
    isProcessing.value = false
  }

  /**
   * Reset state for a new job
   */
  const resetForNewJob = (): void => {
    isProcessing.value = true
    logs.value = []
    errors.value = []
    stats.value = {
      total: 0,
      processed: 0,
      pictures: 0,
      videos: 0,
      unknown: 0,
      errors: 0,
    }
  }

  /**
   * Update stats (partial merge)
   */
  const updateStats = (newStats: Partial<ProcessingStats>): void => {
    stats.value = { ...stats.value, ...newStats }
  }

  /**
   * Add a log entry
   */
  const addLog = (message: string): void => {
    logs.value.push(message)
  }

  /**
   * Add an error entry
   */
  const addError = (error: string): void => {
    errors.value.push(error)
    stats.value.errors += 1
  }

  /**
   * Clear logs
   */
  const clearLogs = (): void => {
    logs.value = []
    errors.value = []
  }

  /**
   * Get completion percentage
   */
  const completionPercentage = computed(() => {
    if (stats.value.total === 0) return 0
    return Math.round((stats.value.processed / stats.value.total) * 100)
  })

  /**
   * Check if there are errors
   */
  const hasErrors = computed(() => stats.value.errors > 0)

  return {
    isProcessing,
    stats,
    logs,
    errors,
    applyStateSync,
    startProcessing,
    stopProcessing,
    resetForNewJob,
    updateStats,
    addLog,
    addError,
    clearLogs,
    completionPercentage,
    hasErrors,
  }
})
