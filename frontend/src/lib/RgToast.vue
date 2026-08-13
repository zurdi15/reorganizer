<script setup lang="ts">
// Toasts apilados sobre el nav (plantilla: BkToast). El kind 'ok' sustituye
// al 'ember' de berserk: éxito destacado (job terminado, Immich ok).
import { useToastStore } from '@/stores/toast'

const store = useToastStore()
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-x-0 bottom-20 z-(--rg-z-toast) flex flex-col items-center gap-2 px-4 pointer-events-none">
      <TransitionGroup name="rg-rise">
        <output
          v-for="toast in store.toasts"
          :key="toast.id"
          class="rg-slab pointer-events-auto flex items-center gap-3 px-4 py-2.5 text-sm max-w-md w-fit"
          :class="{
            'border-danger text-danger': toast.kind === 'error',
            'border-ok text-ok': toast.kind === 'ok',
          }"
          @mouseenter="store.pause(toast.id)"
          @mouseleave="store.resume(toast.id)"
          @focusin="store.pause(toast.id)"
          @focusout="store.resume(toast.id)"
        >
          <span>{{ toast.message }}</span>
          <!-- hit-area ≥40px (WCAG 2.5.5/2.5.8): min-w/h-10 + centrado; los
               márgenes negativos reabsorben ese alto para no inflar el toast
               más allá de su padding visual -->
          <button
            type="button"
            class="shrink-0 -my-2.5 -mr-2 inline-flex items-center justify-center min-w-10 min-h-10 leading-none text-ink-muted hover:text-ink"
            :aria-label="$t('common.dismiss')"
            @click="store.dismiss(toast.id)"
          >
            ✕
          </button>
        </output>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
