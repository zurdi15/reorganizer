import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProcessingStats } from '../types/index'

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
   * Start processing
   */
  const startProcessing = (): void => {
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
   * Stop processing
   */
  const stopProcessing = (): void => {
    isProcessing.value = false
  }

  /**
   * Update stats
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
    startProcessing,
    stopProcessing,
    updateStats,
    addLog,
    addError,
    clearLogs,
    completionPercentage,
    hasErrors,
  }
})
