<script setup lang="ts">
// Tarjeta base (plantilla: BkCard): losa .rg-slab con cabecera opcional.
defineProps<{ title?: string }>()
</script>

<template>
  <section class="rg-slab p-4">
    <header v-if="title || $slots.header" class="mb-3 flex items-center justify-between">
      <h2 v-if="title" class="font-display font-semibold text-ink uppercase tracking-wider text-sm">
        {{ title }}
      </h2>
      <slot name="header" />
    </header>
    <slot />
  </section>
</template>
