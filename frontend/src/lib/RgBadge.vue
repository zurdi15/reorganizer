<script setup lang="ts">
// Pill de estado/kind. El lenguaje de color del sistema en miniatura:
// foto↔ámbar / vídeo↔cobalto (instantáneo en la grid del input), unknown y
// error en danger, ok en verde, neutral para todo lo demás (contadores,
// estados intermedios). Fondo al 10% + texto al 100% del acento: legible en
// los dos temas sin pares de tokens nuevos. `cobalt` es el alias semántico
// de la pill cobalto para estados que no son "vídeo" (job en curso en el
// historial): mismo estilo, nombre honesto en el punto de uso.
withDefaults(
  defineProps<{ variant?: 'photo' | 'video' | 'unknown' | 'ok' | 'error' | 'neutral' | 'cobalt' }>(),
  { variant: 'neutral' },
)
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-display uppercase tracking-wide"
    :class="{
      'border-amber/40 bg-amber/10 text-amber': variant === 'photo',
      'border-cobalt/40 bg-cobalt/10 text-cobalt': variant === 'video' || variant === 'cobalt',
      'border-danger/40 bg-danger/10 text-danger': variant === 'unknown' || variant === 'error',
      'border-ok/40 bg-ok/10 text-ok': variant === 'ok',
      'border-line text-ink-muted': variant === 'neutral',
    }"
  >
    <slot />
  </span>
</template>
