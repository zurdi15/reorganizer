<script setup lang="ts">
// Panel de las etapas running/done. Running: barra + contadores en vivo
// (WS → store de jobs) + log del ring (≤200, TEXTO PLANO SIEMPRE — jamás
// v-html: los nombres de archivo son hostiles por definición) + cancelar.
// Reconexión-safe por construcción: todo sale de los stores, que el
// state-sync restaura solo. Done: resumen por estado final + chip Immich
// (spinner mientras no llega el evento; skipped enlaza a Ajustes) +
// "Ver en historial" / "Organizar más".
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import RgBadge from '@/lib/RgBadge.vue'
import RgButton from '@/lib/RgButton.vue'
import RgCard from '@/lib/RgCard.vue'
import RgIcon from '@/lib/RgIcon.vue'
import RgProgress from '@/lib/RgProgress.vue'
import RgSpinner from '@/lib/RgSpinner.vue'
import type { IconName } from '@/lib/icons'
import { useJobsStore } from '@/stores/jobs'
import { useOrganizeStore } from '@/stores/organize'
import type { JobStatus } from '@/types/api'

const { t, te } = useI18n()
const router = useRouter()
const organize = useOrganizeStore()
const jobs = useJobsStore()

const job = computed(() => organize.currentJob)
const running = computed(() => organize.stage === 'running')

const processed = computed(() =>
  job.value ? job.value.done + job.value.errors + job.value.skipped : 0,
)

// entre el job-status terminal y el fetch del estado final, la foto local
// puede decir aún `running`: el resumen final solo se pinta con un status
// terminal de verdad
const TERMINAL: readonly JobStatus[] = [
  'completed',
  'completed_with_errors',
  'cancelled',
  'failed',
  'interrupted',
  'discarded',
]
const terminal = computed(() => job.value !== null && TERMINAL.includes(job.value.status))

const RESULT_ICONS: Partial<Record<JobStatus, { icon: IconName; cls: string }>> = {
  completed: { icon: 'check', cls: 'text-ok' },
  completed_with_errors: { icon: 'warning', cls: 'text-amber' },
  cancelled: { icon: 'x', cls: 'text-ink-muted' },
  failed: { icon: 'warning', cls: 'text-danger' },
  interrupted: { icon: 'warning', cls: 'text-danger' },
  discarded: { icon: 'x', cls: 'text-ink-muted' },
}
const result = computed(() => (job.value ? RESULT_ICONS[job.value.status] : undefined))

// slug del fallo fatal, resuelto contra errors.* (crudo si no hay traducción:
// mejor un slug legible que "algo ha fallado")
const fatalError = computed(() => {
  const slug = job.value?.error
  if (!slug) return null
  return te(`errors.${slug}`) ? t(`errors.${slug}`) : slug
})

// chip Immich solo cuando el job acabó bien (es cuando el rescan se dispara)
const immichState = computed<'pending' | 'ok' | 'failed' | 'skipped' | null>(() => {
  const current = job.value
  if (!current || organize.stage !== 'done') return null
  if (current.status !== 'completed' && current.status !== 'completed_with_errors') return null
  return current.immich_status ?? 'pending'
})

// log del ring, filtrado al job seguido, más recientes primero
const logEvents = computed(() => {
  const id = organize.currentJobId
  if (id === null) return []
  return jobs.events.filter((event) => event.data.job_id === id).slice().reverse()
})

type LogEvent = (typeof jobs.events)[number]

function resolveSlug(slug: string): string {
  return te(`errors.${slug}`) ? t(`errors.${slug}`) : slug
}

function lineText(event: LogEvent): string {
  switch (event.type) {
    case 'item-done':
      return event.data.error
        ? `${event.data.source_path} · ${resolveSlug(event.data.error)}`
        : `${event.data.source_path} → ${event.data.dest ?? ''}`
    case 'job-error':
      return resolveSlug(event.data.slug)
    case 'immich':
      return `Immich: ${event.data.status}`
  }
}

function isDangerLine(event: LogEvent): boolean {
  if (event.type === 'job-error') return true
  if (event.type === 'item-done') return event.data.error !== null || event.data.status === 'error'
  return event.data.status === 'failed'
}

function logKey(event: LogEvent, index: number): string {
  return event.type === 'item-done' ? `item-${event.data.item_id}` : `${event.type}-${index}`
}
</script>

<template>
  <RgCard :title="running ? t('organize.progress.title') : t('organize.title')">
    <!-- ejecución en vivo -->
    <div v-if="running" class="flex flex-col gap-3" data-testid="job-running">
      <div class="flex items-center justify-between gap-2">
        <span class="rg-metric text-sm text-ink-muted" data-testid="job-processed">
          {{ processed }}/{{ job?.total ?? 0 }}
        </span>
      </div>
      <RgProgress :value="processed" :max="job?.total || 1" label />
      <div class="flex flex-wrap gap-2">
        <RgBadge variant="ok" data-testid="counter-ok">
          {{ t('organize.progress.ok', { n: job?.done ?? 0 }) }}
        </RgBadge>
        <RgBadge :variant="(job?.errors ?? 0) > 0 ? 'error' : 'neutral'" data-testid="counter-errors">
          {{ t('organize.progress.errors', job?.errors ?? 0) }}
        </RgBadge>
        <RgBadge variant="neutral" data-testid="counter-skipped">
          {{ t('organize.progress.skipped', job?.skipped ?? 0) }}
        </RgBadge>
      </div>
    </div>

    <!-- estado final -->
    <div v-else class="flex flex-col gap-3" data-testid="job-done">
      <template v-if="terminal && job">
        <div class="flex items-center gap-2">
          <RgIcon v-if="result" :name="result.icon" :size="20" :class="result.cls" />
          <span
            class="font-display font-semibold uppercase tracking-wide"
            :class="result?.cls"
            data-testid="job-result"
          >
            {{ t(`organize.result.${job.status}`) }}
          </span>
        </div>
        <p v-if="fatalError" class="text-sm text-danger" data-testid="job-fatal-error">{{ fatalError }}</p>
        <p class="rg-metric text-sm text-ink-muted" data-testid="job-summary">
          {{ t('organize.result.summary', job.done) }} ·
          {{ t('organize.progress.errors', job.errors) }} ·
          {{ t('organize.progress.skipped', job.skipped) }}
        </p>

        <div v-if="immichState" class="flex items-center gap-2" data-testid="immich-chip">
          <RgBadge v-if="immichState === 'pending'" variant="neutral" data-testid="immich-pending">
            <RgSpinner size="sm" />
            {{ t('organize.result.immichPending') }}
          </RgBadge>
          <RgBadge v-else-if="immichState === 'ok'" variant="ok" data-testid="immich-ok">
            {{ t('organize.result.immichOk') }}
          </RgBadge>
          <RgBadge v-else-if="immichState === 'failed'" variant="error" data-testid="immich-failed">
            {{ t('organize.result.immichFailed') }}
          </RgBadge>
          <!-- skipped: Immich sin configurar — el chip lleva a Ajustes -->
          <button
            v-else
            type="button"
            class="rg-press"
            data-testid="immich-skipped"
            @click="router.push({ name: 'settings' })"
          >
            <RgBadge variant="neutral">{{ t('organize.result.immichSkipped') }} →</RgBadge>
          </button>
        </div>
      </template>
      <!-- terminal aún sin confirmar por el fetch final: no inventar resumen -->
      <div v-else class="flex items-center gap-2 text-sm text-ink-muted">
        <RgSpinner size="sm" />
      </div>
    </div>

    <!-- log del ring (texto plano, errores en danger) — visible en running y
         done mientras haya eventos -->
    <div v-if="logEvents.length > 0" class="mt-3 flex flex-col gap-1.5">
      <span class="font-display text-2xs uppercase tracking-wider text-ink-faint">
        {{ t('organize.progress.log') }}
      </span>
      <ul class="max-h-64 overflow-y-auto rounded-sm border border-line bg-void p-2" data-testid="job-log">
        <li
          v-for="(event, i) in logEvents"
          :key="logKey(event, i)"
          class="rg-metric break-all py-0.5 text-xs"
          :class="isDangerLine(event) ? 'text-danger' : 'text-ink-muted'"
        >
          {{ lineText(event) }}
        </li>
      </ul>
    </div>

    <div class="mt-3">
      <RgButton
        v-if="running"
        variant="danger"
        block
        :loading="organize.cancelling"
        data-testid="job-cancel"
        @click="organize.cancel()"
      >
        {{ t('organize.progress.cancel') }}
      </RgButton>
      <div v-else class="flex flex-col gap-2 sm:flex-row">
        <RgButton
          variant="ghost"
          class="sm:flex-1"
          data-testid="job-to-history"
          @click="router.push({ name: 'history' })"
        >
          {{ t('organize.result.toHistory') }}
        </RgButton>
        <RgButton
          class="sm:flex-1"
          data-testid="job-organize-more"
          @click="organize.reset()"
        >
          {{ t('organize.result.organizeMore') }}
        </RgButton>
      </div>
    </div>
  </RgCard>
</template>
