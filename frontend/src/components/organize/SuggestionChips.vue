<script setup lang="ts">
// Chips de sugerencia del path builder: dos fuentes ETIQUETADAS y nunca
// auto-aplicadas. EXIF del lote (años; y meses zero-padded cuando el último
// segmento confirmado es un año con fotos) se AÑADE como segmento; un
// Reciente (destinos de los últimos 3 jobs) REEMPLAZA la ruta entera.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useInputStore } from '@/stores/input'
import { useJobsStore } from '@/stores/jobs'
import { useOrganizeStore } from '@/stores/organize'

const { t } = useI18n()
const input = useInputStore()
const jobs = useJobsStore()
const organize = useOrganizeStore()

// años EXIF (strings del backend) que aún no forman parte de la ruta (un chip
// ya aplicado no aporta)
const yearChips = computed(() =>
  input.suggestedYears.filter((year) => !organize.destSegments.includes(year)),
)

// meses del último segmento confirmado, SI ese segmento es un año del lote.
// Los meses llegan zero-padded ("08") del backend: se pintan y se añaden tal
// cual, sin aritmética que asuma número
const monthChips = computed(() => {
  const last = organize.destSegments[organize.destSegments.length - 1]
  if (!last || !input.suggestedYears.includes(last)) return []
  return input.monthsForYear(last).filter((month) => !organize.destSegments.includes(month))
})

const hasExif = computed(() => yearChips.value.length > 0 || monthChips.value.length > 0)
const hasRecent = computed(() => jobs.lastDestPaths.length > 0)

const CHIP_CLASS =
  'rg-press rg-metric shrink-0 rounded-full border border-line bg-void px-3 py-2.5 text-sm text-ink hover:border-amber hover:text-amber'
</script>

<template>
  <!-- scroller horizontal sin scrollbar; data-no-swipe: el gesto de cambiar
       de sección del shell no debe robarle el scroll -->
  <div
    v-if="hasExif || hasRecent"
    class="no-scrollbar flex items-center gap-2 overflow-x-auto"
    data-no-swipe
    data-testid="suggestion-chips"
  >
    <template v-if="hasExif">
      <span class="shrink-0 font-display text-2xs uppercase tracking-wider text-ink-faint">
        {{ t('organize.builder.suggestionsExif') }}
      </span>
      <button
        v-for="year in yearChips"
        :key="`y-${year}`"
        type="button"
        :class="CHIP_CLASS"
        data-testid="suggestion-year"
        @click="organize.addSegment(year)"
      >
        {{ year }}
      </button>
      <button
        v-for="month in monthChips"
        :key="`m-${month}`"
        type="button"
        :class="CHIP_CLASS"
        data-testid="suggestion-month"
        @click="organize.addSegment(month)"
      >
        {{ month }}
      </button>
    </template>

    <template v-if="hasRecent">
      <span class="shrink-0 font-display text-2xs uppercase tracking-wider text-ink-faint">
        {{ t('organize.builder.suggestionsRecent') }}
      </span>
      <button
        v-for="path in jobs.lastDestPaths"
        :key="path"
        type="button"
        :class="CHIP_CLASS"
        data-testid="suggestion-recent"
        @click="organize.setFromPath(path)"
      >
        {{ path }}
      </button>
    </template>
  </div>
</template>
