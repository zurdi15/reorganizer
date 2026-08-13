// Slugs de error del backend (detail="...") resueltos a texto en cliente —
// patrón berserk. Cada oleada añade aquí los slugs de sus endpoints.
export const errors = {
  generic: 'Algo ha fallado. Inténtalo de nuevo.',
  offline: 'Sin conexión con el servidor. Comprueba la red y reintenta.',
  // fallback fielded de client.ts para 422 de pydantic sin slug propio;
  // {field} es el nombre del campo tal cual lo reporta pydantic
  validation: 'Valor no válido en {field}.',
  invalid_path: 'Esa ruta no es válida.',
  file_too_large: 'El archivo supera el tamaño máximo permitido.',
  // slugs de POST /uploads (fase 11)
  too_many_files: 'Demasiados archivos en una sola petición.',
  no_files: 'La petición llegó sin archivos.',
  job_already_active: 'Ya hay un trabajo en marcha. Espera a que termine.',
  not_implemented: 'Esta función todavía no está disponible.',
  // slugs de PUT /settings y POST /settings/immich/* (fase 13)
  invalid_immich_url: 'La URL de Immich no es válida (http://… o https://…).',
  invalid_duplicate_strategy: 'Estrategia de duplicados no válida.',
  invalid_transfer_mode: 'Modo de transferencia no válido.',
  immich_not_configured: 'Configura primero la URL y la API key de Immich.',
  immich_unreachable: 'No se pudo contactar con Immich. Revisa la URL.',
  immich_auth_failed: 'Immich rechazó la API key.',
  immich_error: 'Immich respondió con un error.',
  // slugs de /rules (fase 13)
  invalid_regex: 'La expresión regular no es válida.',
  invalid_dest_template: 'La plantilla de destino no es una ruta válida.',
  unknown_placeholder: 'La plantilla usa un placeholder desconocido.',
  priority_taken: 'Ya existe una regla con esa prioridad.',
  invalid_rule_order: 'El orden enviado no coincide con las reglas actuales.',
  rule_not_found: 'Esa regla ya no existe.',
  invalid_media_type: 'Tipo de medio no válido.',
  invalid_orientation: 'Orientación no válida.',
  // slugs de /jobs y del motor de ejecución (fase 12)
  job_not_found: 'Ese trabajo ya no existe.',
  job_not_planned: 'El trabajo no está en estado planificado.',
  job_not_cancellable: 'Ese trabajo ya no se puede cancelar.',
  invalid_item_status: 'Filtro de estado no válido.',
  job_failed: 'El trabajo falló de forma inesperada.',
  plan_failed: 'La planificación falló de forma inesperada.',
  input_dir_missing: 'La carpeta de entrada no existe o no es accesible.',
  transfer_failed: 'No se pudo mover o copiar este archivo.',
  // slugs de lectura de input (fase 2)
  file_not_found: 'Ese archivo ya no está en la bandeja de entrada.',
  thumb_unavailable: 'No se pudo generar la miniatura.',
} as const
