<script setup lang="ts">
// Sheet de confirmación previa a ejecutar (bottom sheet, nunca modal):
// resumen n → ruta, modo mover/copiar y estrategia de duplicados. Los
// valores iniciales son el ECO del job planificado (defaults de settings ya
// resueltos por el server); cambiarlos re-planifica vía store (el backend
// descarta el plan obsoleto solo). El commit ejecuta y cierra.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import RgButton from '@/lib/RgButton.vue'
import RgSegmented from '@/lib/RgSegmented.vue'
import RgSheet from '@/lib/RgSheet.vue'
import RgSpinner from '@/lib/RgSpinner.vue'
import { useOrganizeStore } from '@/stores/organize'
import type { DuplicateStrategy, TransferMode } from '@/types/api'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const organize = useOrganizeStore()

const job = computed(() => organize.currentJob)
const count = computed(() => job.value?.total ?? organize.planItems.length)

// re-planificando (opciones recién cambiadas): el commit espera al plan nuevo
const replanning = computed(() => organize.creating || job.value?.status === 'planning')

const mode = computed<string>({
  get: () => organize.options.transfer_mode ?? job.value?.transfer_mode ?? 'move',
  set: (value) => {
    void organize.updateOptions({ transfer_mode: value as TransferMode })
  },
})

const strategy = computed<string>({
  get: () => organize.options.duplicate_strategy ?? job.value?.duplicate_strategy ?? 'rename',
  set: (value) => {
    void organize.updateOptions({ duplicate_strategy: value as DuplicateStrategy })
  },
})

const modeOptions = computed(() => [
  { value: 'move', label: t('organize.confirm.modeMove') },
  { value: 'copy', label: t('organize.confirm.modeCopy') },
])

const strategyOptions = computed(() => [
  { value: 'rename', label: t('organize.confirm.strategyRename') },
  { value: 'skip', label: t('organize.confirm.strategySkip') },
  { value: 'overwrite', label: t('organize.confirm.strategyOverwrite') },
])

const commitLabel = computed(() =>
  t(
    mode.value === 'copy' ? 'organize.confirm.commitCopy' : 'organize.confirm.commitMove',
    count.value,
  ),
)

async function commit() {
  if (replanning.value || organize.executing || count.value === 0) return
  await organize.execute()
  emit('close')
}
</script>

<template>
  <RgSheet :open="open" :title="t('organize.confirm.title')" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <p class="rg-metric break-all text-sm text-ink" data-testid="confirm-summary">
        {{ t('organize.confirm.summary', { n: count, path: job?.dest_path ?? organize.destPath }, count) }}
      </p>

      <div class="flex flex-col gap-1.5">
        <span class="text-sm text-ink-muted">{{ t('organize.confirm.mode') }}</span>
        <RgSegmented
          v-model="mode"
          :options="modeOptions"
          :label="t('organize.confirm.mode')"
          data-testid="confirm-mode"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-sm text-ink-muted">{{ t('organize.confirm.strategy') }}</span>
        <RgSegmented
          v-model="strategy"
          :options="strategyOptions"
          :label="t('organize.confirm.strategy')"
          data-testid="confirm-strategy"
        />
      </div>

      <div
        v-if="replanning"
        class="flex items-center gap-2 text-sm text-ink-muted"
        data-testid="confirm-replanning"
      >
        <RgSpinner size="sm" />
        <span>{{ t('organize.confirm.replanning') }}</span>
      </div>

      <RgButton
        size="lg"
        block
        :loading="organize.executing"
        :disabled="replanning || count === 0"
        data-testid="confirm-commit"
        @click="commit"
      >
        {{ commitLabel }}
      </RgButton>
    </div>
  </RgSheet>
</template>
