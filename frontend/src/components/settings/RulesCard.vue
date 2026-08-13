<script setup lang="ts">
// Lista ordenada de reglas de clasificación: el orden ES la prioridad (gana
// la primera que coincide). Reorder con ↑/↓ — fiable en táctil, sin drag —
// que envía la permutación COMPLETA de ids; switch de activación inline con
// PATCH optimista (rollback en el store); tap en el cuerpo → RuleSheet.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { RuleRead } from '@/api/rules'
import RgButton from '@/lib/RgButton.vue'
import RgCard from '@/lib/RgCard.vue'
import RgIcon from '@/lib/RgIcon.vue'
import RgSwitch from '@/lib/RgSwitch.vue'
import { useSettingsStore } from '@/stores/settings'
import { toastApiError } from '@/utils/apiErrors'
import RuleSheet from './RuleSheet.vue'

const { t } = useI18n()
const store = useSettingsStore()

const sheetOpen = ref(false)
// null = crear una regla nueva
const editing = ref<RuleRead | null>(null)

function openSheet(rule: RuleRead | null) {
  editing.value = rule
  sheetOpen.value = true
}

// resumen legible de las condiciones AND ("vídeo · vertical · ^dji");
// también es el nombre de respaldo cuando la regla no tiene nombre
function summary(rule: RuleRead): string {
  const parts: string[] = []
  if (rule.media_type && rule.media_type !== 'unknown') {
    parts.push(t(`settings.rules.kinds.${rule.media_type}`))
  }
  if (rule.orientation) parts.push(t(`settings.rules.orientations.${rule.orientation}`))
  if (rule.filename_regex) parts.push(rule.filename_regex)
  if (rule.camera_make) parts.push(rule.camera_make)
  if (rule.camera_model) parts.push(rule.camera_model)
  return parts.length ? parts.join(' · ') : t('settings.rules.anyFile')
}

function displayName(rule: RuleRead): string {
  return rule.name || summary(rule)
}

async function onToggle(rule: RuleRead, enabled: boolean) {
  try {
    await store.toggleRule(rule.id, enabled)
  } catch (error) {
    toastApiError(error)
  }
}

async function onMove(rule: RuleRead, delta: -1 | 1) {
  try {
    await store.moveRule(rule.id, delta)
  } catch (error) {
    toastApiError(error)
  }
}
</script>

<template>
  <RgCard :title="t('settings.rules.title')">
    <p class="mb-3 text-sm text-ink-muted">{{ t('settings.rules.explainer') }}</p>

    <p v-if="store.rules.length === 0" class="py-4 text-center text-sm text-ink-faint">
      {{ t('settings.rules.empty') }}
    </p>

    <ul v-else class="divide-y divide-line" data-testid="rules-list">
      <li
        v-for="(rule, index) in store.rules"
        :key="rule.id"
        class="flex items-center gap-2 py-2"
        :data-testid="`rule-row-${rule.id}`"
      >
        <!-- el switch necesita ancho propio (su primitiva es fila completa);
             label vacío + aria-label con el nombre real de la regla -->
        <div class="shrink-0">
          <RgSwitch
            :model-value="rule.enabled"
            label=""
            :aria-label="t('settings.rules.toggle', { name: displayName(rule) })"
            :data-testid="`rule-toggle-${rule.id}`"
            @update:model-value="onToggle(rule, $event)"
          />
        </div>

        <!-- cuerpo tappable → editar. Regla desactivada se atenúa entera -->
        <button
          type="button"
          class="min-w-0 flex-1 py-1 text-left"
          :class="rule.enabled ? '' : 'opacity-50'"
          :aria-label="t('settings.rules.edit', { name: displayName(rule) })"
          :data-testid="`rule-edit-${rule.id}`"
          @click="openSheet(rule)"
        >
          <span class="block truncate text-sm text-ink">{{ displayName(rule) }}</span>
          <span v-if="rule.name" class="block truncate text-xs text-ink-muted">
            {{ summary(rule) }}
          </span>
          <span class="rg-metric block truncate text-xs text-amber">{{ rule.dest_template }}</span>
        </button>

        <!-- ↑/↓: tap-target 40px, deshabilitado en los bordes -->
        <div class="flex shrink-0 flex-col">
          <button
            type="button"
            class="flex h-10 w-10 items-center justify-center rounded-sm text-ink-muted hover:text-ink disabled:opacity-30"
            :disabled="index === 0 || undefined"
            :aria-label="t('settings.rules.moveUp', { name: displayName(rule) })"
            :data-testid="`rule-up-${rule.id}`"
            @click="onMove(rule, -1)"
          >
            <RgIcon name="chevron-down" :size="18" class="rotate-180" />
          </button>
          <button
            type="button"
            class="flex h-10 w-10 items-center justify-center rounded-sm text-ink-muted hover:text-ink disabled:opacity-30"
            :disabled="index === store.rules.length - 1 || undefined"
            :aria-label="t('settings.rules.moveDown', { name: displayName(rule) })"
            :data-testid="`rule-down-${rule.id}`"
            @click="onMove(rule, 1)"
          >
            <RgIcon name="chevron-down" :size="18" />
          </button>
        </div>
      </li>
    </ul>

    <RgButton variant="ghost" block class="mt-3" data-testid="rule-add" @click="openSheet(null)">
      + {{ t('settings.rules.add') }}
    </RgButton>

    <RuleSheet :open="sheetOpen" :rule="editing" @close="sheetOpen = false" />
  </RgCard>
</template>
