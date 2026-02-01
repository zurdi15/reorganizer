import { vi } from 'vitest'

/**
 * Mock WebSocket for testing
 */
export class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState: number = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(url: string) {
    this.url = url
    // Simulate connection opening after microtask
    Promise.resolve().then(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.(new Event('open'))
    })
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  /**
   * Simulate receiving a message (for tests)
   */
  simulateMessage(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  /**
   * Simulate an error (for tests)
   */
  simulateError(): void {
    this.onerror?.(new Event('error'))
  }

  /**
   * Simulate connection closing (for tests)
   */
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }
}

/**
 * Global mock setup for WebSocket
 */
export const setupWebSocketMock = (): typeof WebSocket => {
  return MockWebSocket as unknown as typeof WebSocket
}
