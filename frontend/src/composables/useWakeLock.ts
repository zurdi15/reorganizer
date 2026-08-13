import { getCurrentInstance, onBeforeUnmount, watch, type Ref } from 'vue'

// Mantiene la pantalla encendida mientras `hold` sea true (cola de subidas
// activa): sin pantalla, iOS congela los XHR a los pocos segundos y una
// subida de vídeos largos muere a mitad. MEJORA PROGRESIVA estricta: sin
// navigator.wakeLock (iOS viejo, contexto sin HTTPS) no hace nada y la cola
// reintentable + hint "mantén la app abierta" siguen cubriendo el caso.
export function useWakeLock(hold: Ref<boolean>) {
  let sentinel: WakeLockSentinel | null = null

  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

  async function acquire() {
    // solo visible: pedir el lock en background rechaza siempre (NotAllowed)
    if (!supported || sentinel || document.visibilityState !== 'visible') return
    try {
      sentinel = await navigator.wakeLock.request('screen')
      // el SO puede soltarlo por su cuenta (ocultar pestaña, ahorro de
      // batería): al soltarse se olvida el sentinel para poder re-adquirir
      sentinel.addEventListener('release', () => {
        sentinel = null
      })
    } catch {
      // denegado — mejora progresiva, sin ruido para el usuario
      sentinel = null
    }
  }

  async function release() {
    const current = sentinel
    sentinel = null
    try {
      await current?.release()
    } catch {
      // ya liberado por el SO
    }
  }

  // el lock se libera SOLO al ocultar la página y no vuelve gratis: al
  // regresar a foreground con la cola aún activa hay que pedirlo de nuevo
  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && hold.value) void acquire()
  }

  const stopWatch = watch(
    hold,
    (value) => {
      if (value) void acquire()
      else void release()
    },
    { immediate: true },
  )

  document.addEventListener('visibilitychange', onVisibilityChange)

  function stop() {
    stopWatch()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    void release()
  }

  // limpieza automática solo si vivimos dentro de un componente (los tests
  // pueden invocar el composable a pelo y parar con stop())
  if (getCurrentInstance()) {
    onBeforeUnmount(stop)
  }

  return { acquire, release, stop }
}
