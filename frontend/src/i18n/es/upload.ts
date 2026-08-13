// Dominio Subir (fase 11): dropzone, cola por archivo y resumen del lote.
export const upload = {
  title: 'Subir',
  dropzone: {
    cta: 'Toca para elegir fotos y vídeos',
    // solo tiene sentido con puntero: se oculta en móvil
    hint: 'o arrastra archivos aquí',
    addMore: 'Añadir más archivos',
  },
  queue: {
    // aviso pre-vuelo (espejo del cap del backend): avisar, nunca bloquear
    tooBig: '>2 GB — puede fallar en móvil',
    canceled: 'Cancelado',
  },
  summary: {
    uploading: '{n} subiendo',
    queued: '{n} en cola',
    done: '{n} subidos',
    errors: '{n} errores',
    keepOpen: 'Mantén la app abierta hasta que termine la subida',
    doneTitle: 'Subida completada',
    organizeNow: 'Organizar ahora',
    retryFailed: 'Reintentar fallidos',
    cancelPending: 'Cancelar pendientes',
    clearFinished: 'Limpiar terminados',
  },
  // toast al drenar el lote con éxito (pluralizado por vue-i18n)
  toastDone: 'Subida completada | 1 archivo subido | {n} archivos subidos',
} as const
