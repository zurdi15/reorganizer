// Dominio Historial (fase 13): JobCard expandible + repetir ruta. Los
// mensajes con `|` usan la pluralización de vue-i18n: t(clave, n) elige la
// forma y rellena {n}.
export const history = {
  title: 'Historial',
  refresh: 'Actualizar',
  empty: 'Aún no hay trabajos',
  emptyCta: 'Organizar ahora',
  loadFailed: 'No se pudo cargar el historial.',
  // banda sutil cuando hay un job vivo: enlaza a /organize, donde vive el
  // progreso real (JobProgressPanel)
  activeBanner: 'Hay un trabajo en curso',
  status: {
    completed: 'Completado',
    completedWithErrors: 'Con errores',
    cancelled: 'Cancelado',
    interrupted: 'Interrumpido',
    discarded: 'Descartado',
    failed: 'Fallido',
    // planning|planned|running colapsan en una sola pill: el detalle vivo
    // está en /organize, aquí solo importa "no ha terminado"
    inProgress: 'En curso',
  },
  mode: {
    move: 'Movido',
    copy: 'Copiado',
  },
  counters: {
    done: '{n} ok',
    errors: '{n} error | {n} errores',
    skipped: '{n} saltado | {n} saltados',
  },
  immich: {
    ok: 'Immich ok',
    failed: 'Immich falló',
    skipped: 'Immich omitido',
  },
  repeat: 'Repetir con esta ruta',
  items: {
    empty: 'Este trabajo no tiene archivos.',
    errorsHeading: 'Errores',
    loadMore: 'Cargar más',
    loadFailed: 'No se pudieron cargar los archivos.',
    status: {
      planned: 'pendiente',
      skipped: 'saltado',
      duplicate: 'duplicado',
      cancelled: 'cancelado',
      missing: 'no encontrado',
    },
  },
} as const
