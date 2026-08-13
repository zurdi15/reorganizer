<script setup lang="ts">
// Banda fina bajo el nav, visible en TODA la app mientras hay un job vivo:
// el usuario puede irse a Subir o Ajustes sin perder de vista el progreso, y
// un tap le devuelve a /organize. Alimentada por el store de jobs (WS):
//   - planning  → "Preparando · scanned/total" (plan-progress), o
//                 "Preparando…" si aún no llegó el primer tick
//   - resto     → "Organizando · done/total" (counters de ejecución)
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useJobsStore } from '@/stores/jobs'

const jobs = useJobsStore()
const router = useRouter()
const { t } = useI18n()

const visible = computed(() => jobs.activeJob !== null)

const label = computed(() => {
  const job = jobs.activeJob
  if (!job) return ''
  if (job.status === 'planning') {
    const plan = jobs.planProgress
    if (!plan) return t('shell.activeJobPreparing')
    return t('shell.activeJobPlanning', { scanned: plan.scanned, total: plan.total })
  }
  return t('shell.activeJob', { done: job.done, total: job.total })
})

function goOrganize() {
  router.push({ name: 'organize' })
}
</script>

<template>
  <!-- informativa pero tappable entera (target generoso, no un link chico
       dentro): un <button> de banda completa -->
  <button
    v-if="visible"
    type="button"
    class="rg-chrome-bg block w-full border-b border-line px-4 py-1.5 text-center text-xs text-amber"
    data-testid="active-job-band"
    @click="goOrganize"
  >
    {{ label }}
  </button>
</template>
