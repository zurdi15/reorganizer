import { ref, computed } from 'vue'
import { useWebSocketStore } from '../stores/wsStore'
import { useProcessingStore } from '../stores/processingStore'
import type { WebSocketMessage } from '../types/index'

// Singleton state - shared across all useWebSocket() calls
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let messageCallbacks: ((message: WebSocketMessage) => void)[] = []

/**
 * Composable for WebSocket management with auto-reconnect capability
 * Uses singleton pattern to share connection across components
 */
export const useWebSocket = () => {
  const wsStore = useWebSocketStore()
  const processingStore = useProcessingStore()

  /**
   * Parse WebSocket message string into typed message
   */
  const parseMessage = (data: string): WebSocketMessage | null => {
    try {
      // Handle prefixed messages like "event-total:100"
      if (data.includes(':')) {
        const colonIndex = data.indexOf(':')
        const prefix = data.substring(0, colonIndex)
        const value = data.substring(colonIndex + 1)
        const eventType = prefix.replace('event-', '')

        if (eventType === 'total') {
          return { type: 'total', data: parseInt(value, 10) }
        } else if (eventType === 'processed') {
          return { type: 'processed', data: value }
        } else if (eventType === 'processed-pictures') {
          return { type: 'processed-pictures', data: null }
        } else if (eventType === 'processed-videos') {
          return { type: 'processed-videos', data: null }
        } else if (eventType === 'error') {
          return { type: 'error', data: value }
        } else if (eventType === 'busy') {
          return { type: 'busy', data: value === 'true' }
        } else if (eventType === 'complete') {
          return { type: 'complete', data: null }
        }
      }

      // Handle other messages
      if (data.includes('event-complete')) {
        return { type: 'complete', data: null }
      }

      // Default: treat as log
      return { type: 'log', data }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error, data)
      return null
    }
  }

  /**
   * Register a callback for incoming messages
   */
  const onMessage = (callback: (message: WebSocketMessage) => void): void => {
    messageCallbacks.push(callback)
  }

  /**
   * Remove a message callback
   */
  const offMessage = (callback: (message: WebSocketMessage) => void): void => {
    messageCallbacks = messageCallbacks.filter(cb => cb !== callback)
  }

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = (event: MessageEvent): void => {
    const message = parseMessage(event.data)
    if (message) {
      // Update stores based on message type
      switch (message.type) {
        case 'total':
          processingStore.updateStats({ total: message.data })
          break
        case 'processed':
          processingStore.updateStats({ processed: processingStore.stats.processed + 1 })
          processingStore.addLog(message.data)
          break
        case 'processed-pictures':
          processingStore.updateStats({ pictures: processingStore.stats.pictures + 1 })
          break
        case 'processed-videos':
          processingStore.updateStats({ videos: processingStore.stats.videos + 1 })
          break
        case 'error':
          processingStore.addError(message.data)
          break
        case 'busy':
          if (message.data) {
            processingStore.startProcessing()
          } else {
            processingStore.stopProcessing()
          }
          break
        case 'complete':
          processingStore.stopProcessing()
          break
        case 'log':
          processingStore.addLog(message.data)
          break
      }

      // Call registered callbacks
      messageCallbacks.forEach(cb => cb(message))
    }
  }

  /**
   * Connect to WebSocket
   */
  const connect = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const isDev = import.meta.env.DEV
        const host = isDev ? 'localhost:3334' : window.location.host
        const wsUrl = `${protocol}//${host}/ws/reorganizer`

        ws = new WebSocket(wsUrl)

        ws.onopen = () => {
          console.log('WebSocket connected')
          wsStore.setConnected(true)
          wsStore.resetRetry()
          resolve()
        }

        ws.onmessage = handleMessage

        ws.onerror = (event) => {
          console.error('WebSocket error:', event)
          reject(new Error('WebSocket connection failed'))
        }

        ws.onclose = () => {
          console.log('WebSocket closed')
          wsStore.setConnected(false)
          attemptReconnect()
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  const attemptReconnect = (): void => {
    if (!wsStore.shouldRetry) {
      console.error('Max reconnection attempts reached')
      return
    }

    wsStore.incrementRetry()
    const delay = wsStore.getRetryDelay

    console.log(
      `Attempting to reconnect in ${delay}ms (attempt ${wsStore.retryCount}/${wsStore.maxRetries})`
    )

    reconnectTimer = setTimeout(() => {
      connect().catch(err => {
        console.error('Reconnection failed:', err)
        attemptReconnect()
      })
    }, delay)
  }

  /**
   * Send message through WebSocket
   */
  const send = (data: Record<string, unknown>): void => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    } else {
      console.error('WebSocket is not connected')
    }
  }

  /**
   * Disconnect from WebSocket
   */
  const disconnect = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (ws) {
      ws.close()
      ws = null
    }

    wsStore.setConnected(false)
    messageCallbacks = []
  }

  const isConnected = computed(() => wsStore.isConnected)
  const retryCount = computed(() => wsStore.retryCount)

  return {
    connect,
    disconnect,
    send,
    onMessage,
    offMessage,
    isConnected,
    retryCount,
  }
}
