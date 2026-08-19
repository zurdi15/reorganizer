<script setup lang="ts">
// Preview del plan (etapa plan). Mientras el job está `planning`: progreso
// del dry-run + cancelar. En `planned`: avisos FIJADOS primero (archivos sin
// regla → _unknown/ y duplicados previstos → estrategia actual), cada uno
// expandible a su lista, y después grupos colapsables por subcarpeta
// destino. Footer: Volver (descarta el plan sin miedo — el backend lo marca
// discarded al crear el siguiente) / Organizar… (abre RunConfirmSheet).
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RgButton from '@/lib/RgButton.vue'
import RgCard from '@/lib/RgCard.vue'
import RgIcon from '@/lib/RgIcon.vue'
import RgProgress from '@/lib/RgProgress.vue'
import RgSpinner from '@/lib/RgSpinner.vue'
import { useJobsStore } from '@/stores/jobs'
import { useOrganizeStore } from '@/stores/organize'
import type { JobItem } from '@/types/api'
import { groupPlanItems, isUnknownDest } from '@/utils/planGroups'

import PlanActionBar from './PlanActionBar.vue'
import PlanGroup from './PlanGroup.vue'
import RunConfirmSheet from './RunConfirmSheet.vue'

const { t } = useI18n()
const organize = useOrganizeStore()
const jobs = useJobsStore()

const job = computed(() => organize.currentJob)
const planning = computed(() => job.value?.status === 'planning')

const destPath = computed(() => job.value?.dest_path ?? organize.destPath)

// UNA pasada sobre los items del plan (hasta 2000). Antes eran tres filtros
// independientes más el barrido de groupPlanItems, con isUnknownDest —que
// trocea strings— recalculado dos veces por archivo.
// Los sin-regla ya tienen su aviso fijado con lista propia: fuera de los
// grupos normales (las colisiones sí se quedan en el suyo — la anotación no
// cambia dónde acaba el archivo).
const partition = computed(() => {
  const dest = destPath.value
  const unknown: JobItem[] = []
  const collisions: JobItem[] = []
  const classified: JobItem[] = []
  for (const item of organize.planItems) {
    if (item.collision === true) collisions.push(item)
    if (isUnknownDest(item, dest)) unknown.push(item)
    else classified.push(item)
  }
  return { unknown, collisions, groups: groupPlanItems(classified, dest) }
})

const unknownItems = computed(() => partition.value.unknown)
const collisionItems = computed(() => partition.value.collisions)
const groups = computed(() => partition.value.groups)

const strategyLabel = computed(() => {
  const key = {
    rename: 'strategyRename',
    skip: 'strategySkip',
    overwrite: 'strategyOverwrite',
  }[job.value?.duplicate_strategy ?? 'rename']
  return t(`organize.confirm.${key}`)
})

const unknownOpen = ref(false)
const collisionsOpen = ref(false)
const confirmOpen = ref(false)
</script>

<template>
  <RgCard :title="t('organize.plan.title')">
    <!-- dry-run en marcha: progreso del planner (plan-progress WS) -->
    <div v-if="planning" class="flex flex-col gap-3" data-testid="plan-planning">
      <div class="flex items-center gap-2 text-sm text-ink-muted">
        <RgSpinner size="sm" />
        <span>{{ t('organize.plan.planning') }}</span>
        <span v-if="jobs.planProgress" class="rg-metric">
          {{ t('organize.plan.planningProgress', { scanned: jobs.planProgress.scanned, total: jobs.planProgress.total }) }}
        </span>
      </div>
      <RgProgress
        :value="jobs.planProgress?.scanned ?? 0"
        :max="jobs.planProgress?.total || 100"
      />
      <RgButton
        variant="ghost"
        block
        :loading="organize.cancelling"
        data-testid="plan-cancel"
        @click="organize.cancel()"
      >
        {{ t('common.cancel') }}
      </RgButton>
    </div>

    <div v-else class="flex flex-col gap-3">
      <div
        v-if="organize.planItemsLoading"
        class="flex items-center gap-2 text-sm text-ink-muted"
        data-testid="plan-items-loading"
      >
        <RgSpinner size="sm" />
        <span>{{ t('organize.plan.itemsLoading') }}</span>
      </div>

      <template v-else>
        <!-- avisos fijados, SIEMPRE antes de los grupos -->
        <div
          v-if="unknownItems.length > 0"
          class="rounded-sm border border-danger/40 bg-danger/10"
          data-testid="plan-warning-unknown"
        >
          <button
            type="button"
            class="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger"
            :aria-expanded="unknownOpen ? 'true' : 'false'"
            @click="unknownOpen = !unknownOpen"
          >
            <RgIcon name="warning" :size="16" class="shrink-0" />
            <span class="flex-1">{{ t('organize.plan.unknownWarning', unknownItems.length) }}</span>
            <RgIcon
              name="chevron-down"
              :size="16"
              class="shrink-0 transition-transform"
              :class="unknownOpen && 'rotate-180'"
            />
          </button>
          <ul v-if="unknownOpen" class="border-t border-danger/40 px-3 py-2" data-testid="plan-warning-unknown-list">
            <li v-for="item in unknownItems" :key="item.id" class="rg-metric break-all py-0.5 text-xs text-danger">
              {{ item.source_path }}
            </li>
          </ul>
        </div>

        <div
          v-if="collisionItems.length > 0"
          class="rounded-sm border border-amber/40 bg-amber/10"
          data-testid="plan-warning-collisions"
        >
          <button
            type="button"
            class="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm text-amber"
            :aria-expanded="collisionsOpen ? 'true' : 'false'"
            @click="collisionsOpen = !collisionsOpen"
          >
            <RgIcon name="warning" :size="16" class="shrink-0" />
            <span class="flex-1">
              {{ t('organize.plan.collisionWarning', { n: collisionItems.length, strategy: strategyLabel }, collisionItems.length) }}
            </span>
            <RgIcon
              name="chevron-down"
              :size="16"
              class="shrink-0 transition-transform"
              :class="collisionsOpen && 'rotate-180'"
            />
          </button>
          <ul v-if="collisionsOpen" class="border-t border-amber/40 px-3 py-2" data-testid="plan-warning-collisions-list">
            <li v-for="item in collisionItems" :key="item.id" class="rg-metric break-all py-0.5 text-xs text-amber">
              {{ item.source_path }}
            </li>
          </ul>
        </div>

        <p v-if="organize.planItems.length === 0" class="text-sm text-ink-muted" data-testid="plan-empty">
          {{ t('organize.plan.empty') }}
        </p>

        <PlanGroup v-for="group in groups" :key="group.subfolder" :group="group" />
      </template>
    </div>

    <RunConfirmSheet :open="confirmOpen" @close="confirmOpen = false" />
  </RgCard>

  <!-- volver / ejecutar: fuera de la tarjeta y pegados abajo, para que
       desplegar un aviso con cientos de archivos no los entierre -->
  <PlanActionBar
    v-if="!planning && !organize.planItemsLoading"
    :count="organize.planItems.length"
    @organize="confirmOpen = true"
  />
</template>
