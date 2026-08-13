<script setup lang="ts">
// Botón del sistema (plantilla: BkButton de berserk, con su auditoría de
// contraste ya incorporada): el texto sobre fondos de acento es SIEMPRE
// text-void fijo (nunca ink, que invierte luminancia entre temas; nunca
// hover:text-* — :hover no dispara en touch, el 99% del uso real).
// Tamaño 'md': py-2.5 + text-sm (line-height 20px) = 40px de tap-target
// exactos en móvil (WCAG 2.5.5/2.5.8) — py-2 lo rompería; `sm:` recupera el
// tamaño de desktop. 'primary' es ámbar (acento del sistema), 'cobalt' es
// el secundario (acciones de la familia vídeo/Immich).
withDefaults(
  defineProps<{
    variant?: 'primary' | 'ghost' | 'danger' | 'cobalt'
    size?: 'sm' | 'md' | 'lg'
    loading?: boolean
    block?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'primary', size: 'md', loading: false, block: false, type: 'button' },
)
</script>

<template>
  <button
    :type="type"
    :disabled="loading || undefined"
    :aria-busy="loading ? 'true' : undefined"
    class="rg-press inline-flex items-center justify-center gap-2 font-display font-semibold uppercase tracking-wide rounded-sm border transition-colors disabled:opacity-50"
    :class="[
      block && 'w-full',
      size === 'sm' && 'px-3 py-1.5 text-sm',
      size === 'md' && 'px-4 py-2.5 text-sm sm:px-5 sm:text-base',
      size === 'lg' && 'px-6 py-3.5 text-lg',
      variant === 'primary' && 'bg-amber-deep border-amber text-void hover:bg-amber',
      variant === 'ghost' && 'bg-transparent border-line text-ink-muted hover:border-line-strong hover:text-ink',
      variant === 'danger' && 'bg-transparent border-danger text-danger hover:bg-danger hover:text-void',
      variant === 'cobalt' && 'bg-cobalt-deep border-cobalt text-void hover:bg-cobalt',
    ]"
  >
    <span v-if="loading" class="rg-shimmer inline-block w-4 h-4 rounded-full border-2 border-line-strong" aria-hidden="true" />
    <slot />
  </button>
</template>
