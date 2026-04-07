import { computed } from 'vue'
import { useWebSocketStore } from '../stores/wsStore'
import { useProcessingStore } from '../stores/processingStore'
import type { WebSocketMessage } from '../types/index'

// Singleton state - shared across all useWebSocket() calls
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let messageCallbacks: ((message: WebSocketMessage) => void)[] = []

/**
 * Composable for WebSocket management with auto-reconnect.
 * Connection is persistent - stays open to receive broadcasts from the server.
 * On (re)connect the server sends a state-sync with the full current state.
 */
export const useWebSocket = () => {
  const wsStore = useWebSocketStore()
  const processingStore = useProcessingStore()

  /**
   * Parse incoming JSON WebSocket message
   */
  const parseMessage = (raw: string): WebSocketMessage | null => {
    try {
      return JSON.parse(raw) as WebSocketMessage
    } catch (error) {
      console.error('Error parsing WebSocket message:', error, raw)
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
    if (!message) return

    switch (message.type) {
      case 'state-sync':
        // Full state restore (on connect / reconnect)
        processingStore.applyStateSync(message.data)
        break

      case 'status':
        if (message.data === 'processing') {
          processingStore.startProcessing()
        } else {
          processingStore.stopProcessing()
        }
        break

      case 'total':
        processingStore.updateStats({ total: message.data })
        break

      case 'processed':
        processingStore.updateStats(message.data.stats)
        processingStore.addLog(message.data.log)
        break

      case 'error':
        processingStore.addError(message.data)
        break

      case 'log':
        processingStore.addLog(message.data)
        break
    }

    // Call registered callbacks
    messageCallbacks.forEach(cb => cb(message))
  }

  /**
   * Connect to WebSocket
   */
  const connect = (): Promise<void> => {
    // If already connected, resolve immediately
    if (ws && ws.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }

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
          ws = null
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
      })
    }, delay)
  }

  /**
   * Send a JSON command through WebSocket
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
