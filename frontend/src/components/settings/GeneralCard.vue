<script setup lang="ts">
// Defaults de usuario para los jobs (estrategia de duplicados y mover/copiar):
// se persisten al cambiar el segmento, sin botón de guardar. El toast de
// confirmación va con debounce: dos taps seguidos → un solo aviso.
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

import RgCard from '@/lib/RgCard.vue'
import RgSegmented from '@/lib/RgSegmented.vue'
import { useSettingsStore } from '@/stores/settings'
import { useToastStore } from '@/stores/toast'
import type { DuplicateStrategy, TransferMode } from '@/types/api'
import { toastApiError } from '@/utils/apiErrors'

const { t } = useI18n()
const store = useSettingsStore()
const toast = useToastStore()

const duplicateOptions = computed(() => [
  { value: 'rename', label: t('settings.general.rename') },
  { value: 'skip', label: t('settings.general.skip') },
  { value: 'overwrite', label: t('settings.general.overwrite') },
])
const transferOptions = computed(() => [
  { value: 'move', label: t('settings.general.move') },
  { value: 'copy', label: t('settings.general.copy') },
])

let toastTimer: ReturnType<typeof setTimeout> | null = null
onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer)
})

// toast de "guardado" con debounce: se re-arma en cada cambio y solo suena
// cuando el usuario deja de tocar (600 ms)
function scheduleSavedToast() {
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.push('ok', t('settings.saved')), 600)
}

async function persist(partial: Parameters<typeof store.save>[0]) {
  try {
    await store.save(partial)
    scheduleSavedToast()
  } catch (error) {
    toastApiError(error)
  }
}

// modelos computados sobre el store: leer del server, escribir persiste
const duplicateStrategy = computed({
  get: () => store.settings?.default_duplicate_strategy ?? 'rename',
  set: (value: string) => {
    void persist({ default_duplicate_strategy: value as DuplicateStrategy })
  },
})
const transferMode = computed({
  get: () => store.settings?.default_transfer_mode ?? 'move',
  set: (value: string) => {
    void persist({ default_transfer_mode: value as TransferMode })
  },
})
</script>

<template>
  <RgCard :title="t('settings.general.title')">
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <span class="text-sm text-ink-muted">{{ t('settings.general.duplicates') }}</span>
        <RgSegmented
          v-model="duplicateStrategy"
          :options="duplicateOptions"
          :label="t('settings.general.duplicates')"
          data-testid="general-duplicates"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-sm text-ink-muted">{{ t('settings.general.transfer') }}</span>
        <RgSegmented
          v-model="transferMode"
          :options="transferOptions"
          :label="t('settings.general.transfer')"
          data-testid="general-transfer"
        />
      </div>
    </div>
  </RgCard>
</template>
