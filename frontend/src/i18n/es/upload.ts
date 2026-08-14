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
    canceled: 'Cancelado',
    // no se subió: ese nombre ya estaba en la bandeja (ajuste «Duplicados al
    // subir» = Saltar)
    skipped: 'Ya estaba en la bandeja',
  },
  summary: {
    uploading: '{n} subiendo',
    queued: '{n} en cola',
    done: '{n} subidos',
    skipped: '{n} ya estaban',
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
  // aviso (no error) de los archivos que no se subieron por estar ya en la
  // bandeja; se suma al de arriba cuando el lote trae de los dos
  toastSkipped:
    'Archivos ya en la bandeja | 1 archivo ya estaba en la bandeja | {n} archivos ya estaban en la bandeja',
} as const
