<script setup lang="ts">
// Vista Organizar (fase 12): orquestador FINO de la máquina de etapas del
// store organize — compose (input + destino + CTA) → plan → running/done.
// Todo el peso vive en los componentes y el store; si hay un job vivo al
// entrar (state-sync), el store lo adopta solo y esta vista aterriza directa
// en la etapa correcta.
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import DestinationBuilder from '@/components/organize/DestinationBuilder.vue'
import InputGrid from '@/components/organize/InputGrid.vue'
import JobProgressPanel from '@/components/organize/JobProgressPanel.vue'
import PlanPreview from '@/components/organize/PlanPreview.vue'
import SuggestionChips from '@/components/organize/SuggestionChips.vue'
import RgBadge from '@/lib/RgBadge.vue'
import RgButton from '@/lib/RgButton.vue'
import RgCard from '@/lib/RgCard.vue'
import { useInputStore } from '@/stores/input'
import { useOrganizeStore } from '@/stores/organize'
import { toastApiError } from '@/utils/apiErrors'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const input = useInputStore()
const organize = useOrganizeStore()

onMounted(() => {
  input.refresh().catch(toastApiError)
  // contrato con el historial ("Repetir con esta ruta"): ?dest=<ruta> siembra
  // el builder — los segmentos inválidos se descartan en setFromPath — y la
  // query se limpia de la URL para que un reload no re-siembre
  const dest = route.query.dest
  if (typeof dest === 'string' && dest.length > 0) {
    organize.setFromPath(dest)
    void router.replace({ query: {} })
  }
})
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="font-display text-lg font-semibold uppercase tracking-wider">
        {{ t('organize.title') }}
      </h1>
      <!-- resumen por kind: el lenguaje foto↔ámbar / vídeo↔cobalto del
           sistema; unknown solo si existe (en danger, como el strip) -->
      <div v-if="input.summary" class="flex flex-wrap items-center gap-2" data-testid="input-summary">
        <RgBadge variant="photo">{{ t('organize.summaryPhotos', input.summary.photo) }}</RgBadge>
        <RgBadge variant="video">{{ t('organize.summaryVideos', input.summary.video) }}</RgBadge>
        <RgBadge v-if="input.summary.unknown > 0" variant="unknown">
          {{ t('organize.summaryUnknown', input.summary.unknown) }}
        </RgBadge>
      </div>
    </div>

    <!-- etapa compose: revisar el lote + componer el destino -->
    <template v-if="organize.stage === 'compose'">
      <InputGrid />

      <RgCard :title="t('organize.builder.title')">
        <div class="flex flex-col gap-3">
          <DestinationBuilder />
          <SuggestionChips />
        </div>
      </RgCard>

      <!-- el CTA exige lote no vacío Y al menos un segmento (dest_path nunca
           puede ir vacío al backend) -->
      <RgButton
        size="lg"
        block
        :loading="organize.creating"
        :disabled="input.files.length === 0 || organize.destSegments.length === 0"
        data-testid="organize-preview-cta"
        @click="organize.createPlan()"
      >
        {{ t('organize.previewCta') }}
      </RgButton>
    </template>

    <!-- etapa plan: preview del dry-run (incluye la RunConfirmSheet) -->
    <PlanPreview v-else-if="organize.stage === 'plan'" />

    <!-- etapas running/done -->
    <JobProgressPanel v-else />
  </section>
</template>
