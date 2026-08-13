<script setup lang="ts">
// Spinner indeterminado: anillo con un cuarto en ámbar girando
// (animate-spin de Tailwind — el guard universal de reduced-motion de
// animations.css lo neutraliza igual que al resto).
withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })
</script>

<template>
  <span
    role="status"
    class="inline-block animate-spin rounded-full border-2 border-line-strong border-t-amber"
    :class="{
      'w-4 h-4': size === 'sm',
      'w-6 h-6': size === 'md',
      'w-9 h-9': size === 'lg',
    }"
  >
    <span class="sr-only">{{ $t('common.loading') }}</span>
  </span>
</template>
