<script setup lang="ts">
// Icono inline del set propio (lib/icons.ts) — currentColor, así que el
// color lo pone el consumidor con utilidades text-*. Decorativo por defecto
// (aria-hidden); si acompaña a un control sin texto, el control es quien
// debe llevar el aria-label.
import { computed } from 'vue'
import { icons, type IconName } from './icons'

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 20 })

const paths = computed(() => icons[props.name])
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>
