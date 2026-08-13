import { defineStore } from 'pinia'
import { ref } from 'vue'

// 'ok' sustituye al 'ember' de berserk: aviso de éxito destacado (job
// terminado, conexión Immich verificada)
export type ToastKind = 'info' | 'error' | 'ok'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

let nextId = 1

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])
  // handles del timer de auto-dismiss por toast: hover/foco los pausa y
  // libera un handle nuevo al reanudar, sin tocar la API pública de push
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  function schedule(id: number) {
    timers.set(
      id,
      setTimeout(() => dismiss(id), 4000),
    )
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
  }

  function push(kind: ToastKind, message: string) {
    const id = nextId++
    toasts.value.push({ id, kind, message })
    schedule(id)
  }

  function pause(id: number) {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
  }

  function resume(id: number) {
    if (!toasts.value.some((t) => t.id === id)) return
    schedule(id)
  }

  return { toasts, push, dismiss, pause, resume }
})
