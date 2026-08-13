// Shell: navegación, slab CTA de subida y banda de job activo.
export const shell = {
  nav: {
    organize: 'Organizar',
    upload: 'Subir',
    history: 'Historial',
    settings: 'Ajustes',
    label: 'Navegación principal',
  },
  // contador del slab CTA mientras hay subidas en curso: "3/12"
  uploadsActive: '{done}/{total}',
  // banda persistente bajo el nav mientras corre un job
  activeJob: 'Organizando · {done}/{total}',
  // la misma banda durante la fase de planificación (dry-run asíncrono)
  activeJobPlanning: 'Preparando · {scanned}/{total}',
  // planificación recién arrancada, sin primer plan-progress todavía
  activeJobPreparing: 'Preparando…',
} as const
