import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const usePathStore = defineStore('path', () => {
  const currentPath = ref<string>('')
  const suggestions = ref<string[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Fetch path suggestions from the server
   */
  const fetchSuggestions = async (subfolder: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams({
        subfolder: subfolder,
      })
      const baseUrl = import.meta.env.DEV ? 'http://localhost:3334' : ''
      const response = await fetch(`${baseUrl}/api/output?${params.toString()}`, {
        headers: { 'Accept': 'application/json' }
      })
      const data: string[] = await response.json()
      suggestions.value = data.filter(
        item => !item.includes('photo') && !item.includes('video') && !item.includes('reorganizer')
      )
    } catch (err) {
      error.value = `Failed to fetch suggestions: ${err}`
      suggestions.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Update current path
   */
  const updatePath = (path: string): void => {
    currentPath.value = path
  }

  /**
   * Navigate to a folder (append folder name to current path)
   */
  const navigateToFolder = (folderName: string): void => {
    if (folderName === '..') {
      const parts = currentPath.value.split('/').filter(p => p)
      parts.pop()
      currentPath.value = parts.join('/') + (parts.length > 0 ? '/' : '')
    } else {
      if (currentPath.value && !currentPath.value.endsWith('/')) {
        currentPath.value += '/'
      }
      currentPath.value += folderName + '/'
    }
  }

  /**
   * Clear path
   */
  const clearPath = (): void => {
    currentPath.value = ''
    suggestions.value = []
  }

  /**
   * Check if path is valid (non-empty)
   */
  const isValidPath = computed(() => currentPath.value.trim().length > 0)

  return {
    currentPath,
    suggestions,
    loading,
    error,
    fetchSuggestions,
    updatePath,
    navigateToFolder,
    clearPath,
    isValidPath,
  }
})
