// Preview en vivo de dest_template (RuleSheet) — espejo CLIENTE del motor
// del backend (services/rules.py): misma regex de placeholder y mismo set
// conocido. Puro y testeado; el backend re-valida siempre al guardar.

// mismo patrón que PLACEHOLDER_RE del backend
const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

// valores de ejemplo para la preview (un vídeo horizontal de un DJI mini3
// tomado en 2024-08 — el caso canónico del árbol legacy)
export const EXAMPLE_VALUES: Record<string, string> = {
  media_type: 'video',
  orientation: 'horizontal',
  make: 'DJI',
  model: 'mini3',
  yyyy: '2024',
  mm: '08',
}

// en orden de utilidad para los chips insertables de la sheet
export const KNOWN_PLACEHOLDERS = [
  '{media_type}',
  '{orientation}',
  '{make}',
  '{model}',
  '{yyyy}',
  '{mm}',
] as const

export type TemplatePreview =
  | { ok: true; dest: string }
  // primer placeholder desconocido encontrado (para el aviso inline)
  | { ok: false; unknown: string }

export function previewRuleTemplate(template: string): TemplatePreview {
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    if (!(match[1] in EXAMPLE_VALUES)) return { ok: false, unknown: match[1] }
  }
  const dest = template.replace(PLACEHOLDER_RE, (_, name: string) => EXAMPLE_VALUES[name])
  return { ok: true, dest }
}
