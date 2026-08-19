<script setup lang="ts">
// Barra de acción fija de la etapa plan: hermana de la de compose. El motivo
// es el mismo — los botones vivían al final de la tarjeta, DEBAJO de los
// grupos y de los avisos expandibles; desplegar «sin regla» con cientos de
// archivos los mandaba a tomar viento. Aquí quedan siempre a un dedo, con el
// recuento de lo que se va a ejecutar a la vista.
import { useI18n } from 'vue-i18n'

import RgButton from '@/lib/RgButton.vue'
import RgIcon from '@/lib/RgIcon.vue'
import { useOrganizeStore } from '@/stores/organize'

defineProps<{
  // archivos del plan: lo que se va a mover/copiar si se confirma
  count: number
}>()
const emit = defineEmits<{ organize: [] }>()

const { t } = useI18n()
const organize = useOrganizeStore()
</script>

<template>
  <footer class="rg-sticky-bar rg-chrome-bg z-10 -mx-4 border-t border-line px-4 py-3">
    <div class="flex items-center gap-2">
      <RgButton variant="ghost" data-testid="plan-back" @click="organize.backToCompose()">
        {{ t('organize.plan.back') }}
      </RgButton>
      <!-- qué se va a ejecutar, en el mismo sitio donde se pulsa ejecutar -->
      <span
        class="rg-metric min-w-0 flex-1 truncate text-center text-sm text-ink-muted"
        data-testid="plan-bar-count"
      >
        {{ t('organize.fileCount', count) }}
      </span>
      <RgButton class="shrink-0" :disabled="count === 0" data-testid="plan-organize" @click="emit('organize')">
        {{ t('organize.plan.organizeCta') }}
        <RgIcon name="arrow-right" :size="16" />
      </RgButton>
    </div>
  </footer>
</template>
