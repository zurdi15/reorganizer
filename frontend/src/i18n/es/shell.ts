// Shell: navegación (rail + barra inferior), badge de subidas y banda de job.
export const shell = {
  // wordmark del rail: nombre de la app (marca, igual en ambos idiomas)
  appName: 'Reorganizer',
  nav: {
    organize: 'Organizar',
    upload: 'Subir',
    history: 'Historial',
    settings: 'Ajustes',
    label: 'Navegación principal',
  },
  // badge del item Subir mientras hay subidas en curso: "3/12"
  uploadsActive: '{done}/{total}',
  // banda persistente bajo el nav mientras corre un job
  activeJob: 'Organizando · {done}/{total}',
  // la misma banda durante la fase de planificación (dry-run asíncrono)
  activeJobPlanning: 'Preparando · {scanned}/{total}',
  // planificación recién arrancada, sin primer plan-progress todavía
  activeJobPreparing: 'Preparando…',
} as const
