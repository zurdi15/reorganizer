<script setup lang="ts">
// Barra de acción fija de la etapa compose. Nace de un problema real: con
// miles de archivos sin organizar, la grid del input crece con el scroll
// infinito y todo lo que viniera DEBAJO (el destino y el CTA) quedaba a un
// scroll interminable — encima cargando páginas por el camino. Ahora el
// destino vive arriba del todo y su CTA aquí, pegado abajo: llegue donde
// llegue el usuario en la grid, la acción sigue a un dedo de distancia.
//
// El pegado lo pone .rg-sticky-bar (base.css), compartido con el pie de Subir
// y con la barra de la etapa plan.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import RgButton from '@/lib/RgButton.vue'
import RgIcon from '@/lib/RgIcon.vue'
import { useInputStore } from '@/stores/input'
import { useOrganizeStore } from '@/stores/organize'

const emit = defineEmits<{ edit: [] }>()

const { t } = useI18n()
const organize = useOrganizeStore()
const input = useInputStore()

// el CTA exige lote no vacío Y al menos un segmento (dest_path nunca puede ir
// vacío al backend) — misma regla que tenía el botón en el flujo
const disabled = computed(
  () => input.files.length === 0 || organize.destSegments.length === 0,
)
</script>

<template>
  <footer class="rg-sticky-bar rg-chrome-bg z-10 -mx-4 border-t border-line px-4 py-3">
    <div class="flex items-center gap-3">
      <!-- la ruta elegida SIEMPRE visible; tocarla sube al compositor (que
           puede haber quedado muy arriba tras scrollear la grid) -->
      <button
        type="button"
        class="rg-press flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-left"
        :aria-label="t('organize.bar.edit')"
        data-testid="compose-bar-dest"
        @click="emit('edit')"
      >
        <RgIcon name="folder-open" :size="16" class="shrink-0 text-ink-faint" />
        <span
          v-if="organize.destPath"
          class="rg-metric truncate text-sm text-ink"
          data-testid="compose-bar-path"
        >{{ organize.destPath }}/</span>
        <span v-else class="truncate text-sm text-ink-faint" data-testid="compose-bar-empty">
          {{ t('organize.bar.noDest') }}
        </span>
      </button>

      <RgButton
        class="shrink-0"
        :loading="organize.creating"
        :disabled="disabled"
        data-testid="organize-preview-cta"
        @click="organize.createPlan()"
      >
        {{ t('organize.previewCta') }}
      </RgButton>
    </div>
  </footer>
</template>
