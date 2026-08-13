// Dominio Organizar (fase 10: grid del input + sheet de detalle; la oleada
// 4 añade destino, plan y progreso). Los mensajes con `|` usan la
// pluralización de vue-i18n: t(clave, n) elige la forma y rellena {n}.
export const organize = {
  title: 'Organizar',
  refresh: 'Actualizar',
  fileCount: 'sin archivos | 1 archivo | {n} archivos',
  // resumen por kind en la cabecera (badges)
  summaryPhotos: '0 fotos | 1 foto | {n} fotos',
  summaryVideos: '0 vídeos | 1 vídeo | {n} vídeos',
  summaryUnknown: '0 sin clasificar | 1 sin clasificar | {n} sin clasificar',
  // strip de aviso sobre la grid: el fallback _unknown/ es literal (nombre
  // real de la carpeta), no se traduce
  unknownStrip:
    'Sin avisos | 1 archivo sin clasificar irá a _unknown/ al organizar | {n} archivos sin clasificar irán a _unknown/ al organizar',
  empty: 'El input está vacío. Sube fotos o vídeos para empezar.',
  emptyAction: 'Subir archivos',
  kinds: {
    photo: 'Foto',
    video: 'Vídeo',
    unknown: 'Sin clasificar',
  },
  // sheet de detalle de archivo
  sheet: {
    title: 'Archivo',
    probing: 'Leyendo metadatos…',
    mediaType: 'Tipo',
    orientation: 'Orientación',
    takenAt: 'Capturado',
    camera: 'Cámara',
    rule: 'Regla',
    noRule: 'Sin regla → _unknown/',
    delete: 'Borrar del input',
    deleteWarning: 'Se borrará del disco. Esto no se puede deshacer.',
    deleteConfirm: 'Confirmar borrado',
    deleted: 'Archivo borrado del input.',
  },
  // etapa compose: path builder por segmentos
  builder: {
    title: 'Destino',
    fieldLabel: 'Añadir carpeta…',
    fieldHint: 'Enter confirma; / encadena segmentos. Las carpetas nuevas se crean al organizar.',
    invalidSegment: 'Nombre de carpeta no válido.',
    up: 'Quitar el último segmento',
    removeSegment: 'Quitar {segment}',
    pathPreview: 'Ruta completa',
    suggestionsExif: 'EXIF',
    suggestionsRecent: 'Recientes',
  },
  // navegador del árbol de salida: lista visible de subcarpetas + creación
  tree: {
    root: '/output',
    loading: 'Cargando carpetas…',
    empty: 'Sin subcarpetas aquí.',
    noMatches: 'Ninguna carpeta coincide.',
    newFolder: 'Nueva carpeta…',
    newFolderHint: 'Enter crea la carpeta; / encadena niveles.',
    willCreate: 'se creará',
    open: 'Abrir {name}',
  },
  previewCta: 'Previsualizar',
  // etapa plan: dry-run + preview agrupada
  plan: {
    title: 'Plan',
    planning: 'Planificando…',
    planningProgress: '{scanned}/{total} analizados',
    itemsLoading: 'Cargando el plan…',
    empty: 'El plan no contiene archivos.',
    unknownWarning: 'Sin avisos | 1 archivo sin regla → _unknown/ | {n} archivos sin regla → _unknown/',
    collisionWarning:
      'Sin duplicados | 1 duplicado previsto → {strategy} | {n} duplicados previstos → {strategy}',
    rootGroup: './',
    organizeCta: 'Organizar…',
    back: 'Volver',
  },
  // sheet de confirmación previa a ejecutar
  confirm: {
    title: 'Confirmar',
    summary: 'sin archivos → /output/{path} | 1 archivo → /output/{path} | {n} archivos → /output/{path}',
    mode: 'Modo',
    modeMove: 'Mover',
    modeCopy: 'Copiar',
    strategy: 'Duplicados',
    strategyRename: 'Renombrar',
    strategySkip: 'Saltar',
    strategyOverwrite: 'Sobrescribir',
    replanning: 'Actualizando el plan…',
    commitMove: 'Mover 0 archivos | Mover 1 archivo | Mover {n} archivos',
    commitCopy: 'Copiar 0 archivos | Copiar 1 archivo | Copiar {n} archivos',
  },
  // etapa running + done: progreso en vivo y estado final
  progress: {
    title: 'Organizando',
    ok: '{n} ok',
    errors: '0 errores | 1 error | {n} errores',
    skipped: '0 saltados | 1 saltado | {n} saltados',
    log: 'Registro',
    cancel: 'Cancelar trabajo',
  },
  result: {
    completed: 'Completado',
    completed_with_errors: 'Completado con errores',
    cancelled: 'Cancelado',
    failed: 'Falló',
    interrupted: 'Interrumpido',
    discarded: 'Descartado',
    summary: 'sin archivos organizados | 1 archivo organizado | {n} archivos organizados',
    immichPending: 'Immich…',
    immichOk: 'Immich ok',
    immichFailed: 'Immich falló',
    immichSkipped: 'Immich omitido',
    toHistory: 'Ver en historial',
    organizeMore: 'Organizar más',
  },
} as const
