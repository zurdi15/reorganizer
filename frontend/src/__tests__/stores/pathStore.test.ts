import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePathStore } from '../../stores/pathStore'
import { mockFetch, mockOutputSuggestionsResponse } from '../mocks/api'

describe('PathStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initializes with empty path and suggestions', () => {
    const store = usePathStore()
    expect(store.currentPath).toBe('')
    expect(store.suggestions).toEqual([])
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('updates current path', () => {
    const store = usePathStore()
    store.updatePath('2024/12/hungary/')

    expect(store.currentPath).toBe('2024/12/hungary/')
  })

  it('validates path correctly', () => {
    const store = usePathStore()
    expect(store.isValidPath).toBe(false)

    store.updatePath('some/path')
    expect(store.isValidPath).toBe(true)

    store.updatePath('  ')
    expect(store.isValidPath).toBe(false)
  })

  it('navigates to folder by appending name', () => {
    const store = usePathStore()
    store.updatePath('2024/')

    store.navigateToFolder('12')
    expect(store.currentPath).toBe('2024/12/')

    store.navigateToFolder('hungary')
    expect(store.currentPath).toBe('2024/12/hungary/')
  })

  it('handles parent directory navigation with ..', () => {
    const store = usePathStore()
    store.updatePath('2024/12/hungary/')

    store.navigateToFolder('..')
    expect(store.currentPath).toBe('2024/12/')

    store.navigateToFolder('..')
    expect(store.currentPath).toBe('2024/')
  })

  it('fetches and filters suggestions', async () => {
    const store = usePathStore()
    global.fetch = mockFetch(mockOutputSuggestionsResponse)

    await store.fetchSuggestions('2024/12/')

    expect(store.suggestions).toHaveLength(3)
    expect(store.loading).toBe(false)
  })

  it('filters out internal folders from suggestions', async () => {
    const store = usePathStore()
    const mixedResponse = ['folder1', 'photo', 'video', 'folder2', 'reorganizer', 'folder3']
    global.fetch = mockFetch(mixedResponse)

    await store.fetchSuggestions('2024/')

    expect(store.suggestions).not.toContain('photo')
    expect(store.suggestions).not.toContain('video')
    expect(store.suggestions).not.toContain('reorganizer')
    expect(store.suggestions).toContain('folder1')
  })

  it('clears path and suggestions', () => {
    const store = usePathStore()
    store.updatePath('2024/12/')
    store.suggestions = ['folder1', 'folder2']

    store.clearPath()

    expect(store.currentPath).toBe('')
    expect(store.suggestions).toEqual([])
  })

  it('returns empty suggestions for empty subfolder', async () => {
    const store = usePathStore()
    global.fetch = mockFetch([])

    await store.fetchSuggestions('')

    expect(store.suggestions).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('handles fetch errors gracefully', async () => {
    const store = usePathStore()
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    await store.fetchSuggestions('2024/')

    expect(store.suggestions).toEqual([])
    expect(store.loading).toBe(false)
    expect(store.error).toBeTruthy()
  })
})
