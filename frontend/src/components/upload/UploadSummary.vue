<script setup lang="ts">
// Resumen pegajoso al pie de la vista: la foto del lote de un vistazo
// ("3 subiendo · 12 en cola · 2 errores") + acciones de conjunto. Al drenar
// con éxito se convierte en el puente al flujo principal ("Organizar
// ahora") — Subir y Organizar son sesiones distintas cross-linkeadas.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import RgButton from '@/lib/RgButton.vue'
import RgIcon from '@/lib/RgIcon.vue'
import { useUploadsStore } from '@/stores/uploads'

const { t } = useI18n()
const router = useRouter()
const uploads = useUploadsStore()

const line = computed(() => {
  const s = uploads.stats
  const parts: string[] = []
  if (s.uploading > 0) parts.push(t('upload.summary.uploading', { n: s.uploading }))
  if (s.queued > 0) parts.push(t('upload.summary.queued', { n: s.queued }))
  if (s.done > 0) parts.push(t('upload.summary.done', { n: s.done }))
  if (s.skipped > 0) parts.push(t('upload.summary.skipped', { n: s.skipped }))
  if (s.error > 0) parts.push(t('upload.summary.errors', { n: s.error }))
  return parts.join(' · ')
})

// drenado con el lote resuelto: estado de éxito (aunque haya errores al lado —
// esos conservan su retry). Los saltados cuentan: sus archivos YA están en la
// bandeja, así que "Organizar ahora" sigue siendo el siguiente paso.
const drained = computed(
  () => !uploads.active && uploads.stats.done + uploads.stats.skipped > 0,
)
// "Limpiar terminados" SOLO cuenta lo que de verdad barre (completados +
// saltados + cancelados). Los fallidos NO se limpian (se reintentan), así que
// el botón ni aparece por ellos ni da a entender que los va a tocar.
const finishedCount = computed(
  () => uploads.stats.done + uploads.stats.skipped + uploads.stats.canceled,
)
</script>

<template>
  <footer class="upload-summary rg-chrome-bg z-10 -mx-4 border-t border-line px-4 py-3">
    <p v-if="line" class="rg-metric text-sm text-ink-muted" data-testid="summary-line">
      {{ line }}
    </p>
    <!-- hint pasivo del riesgo iOS: los XHR mueren en background -->
    <p v-if="uploads.active" class="mt-1 text-xs text-ink-faint" data-testid="summary-keep-open">
      {{ t('upload.summary.keepOpen') }}
    </p>
    <p v-if="drained" class="mt-1 flex items-center gap-2 text-sm text-ok" data-testid="summary-drained">
      <RgIcon name="check" :size="16" />
      {{ t('upload.summary.doneTitle') }}
    </p>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <RgButton
        v-if="drained"
        variant="primary"
        data-testid="organize-now"
        @click="router.push({ name: 'organize' })"
      >
        {{ t('upload.summary.organizeNow') }}
        <RgIcon name="arrow-right" :size="16" />
      </RgButton>
      <RgButton
        v-if="uploads.stats.error > 0"
        variant="ghost"
        data-testid="retry-failed"
        @click="uploads.retryFailed()"
      >
        {{ t('upload.summary.retryFailed') }}
      </RgButton>
      <RgButton
        v-if="uploads.stats.queued > 0"
        variant="ghost"
        data-testid="cancel-pending"
        @click="uploads.cancelPending()"
      >
        {{ t('upload.summary.cancelPending') }}
      </RgButton>
      <RgButton
        v-if="finishedCount > 0"
        variant="ghost"
        data-testid="clear-finished"
        @click="uploads.clearFinished()"
      >
        {{ t('upload.summary.clearFinished') }}
      </RgButton>
    </div>
  </footer>
</template>

<style scoped>
/* pegado POR ENCIMA del bottom nav móvil (fijo, ~4rem de alto + safe-area);
   en ≥sm el nav vive arriba y el pie puede pegarse al borde real del
   scrollport. sticky contra el <main> del shell (único scroller). */
.upload-summary {
  position: sticky;
  bottom: calc(4rem + env(safe-area-inset-bottom));
}
@media (min-width: 640px) {
  .upload-summary {
    bottom: 0;
  }
}
</style>
