import { vi } from 'vitest'

/**
 * Mock fetch for API calls in tests
 */
export const mockFetch = (responseData: unknown, ok = true) => {
  return vi.fn(() =>
    Promise.resolve({
      ok,
      json: () => Promise.resolve(responseData),
      text: () => Promise.resolve(JSON.stringify(responseData)),
    })
  ) as typeof fetch
}

/**
 * Mock of successful input files response
 */
export const mockInputFilesResponse = [
  'photo1.jpg',
  'photo2.png',
  'video1.mp4',
  'video2.mov',
  'document.pdf',
]

/**
 * Mock of output suggestions response
 */
export const mockOutputSuggestionsResponse = [
  'folder1',
  'folder2',
  'subfolder/nested',
]
