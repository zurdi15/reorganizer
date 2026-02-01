<template>
  <div class="space-y-2">
    <h2 class="text-lg font-semibold text-white">Processing Logs</h2>
    <div class="card max-h-64 overflow-y-auto space-y-1 scrollbar-thin bg-gray-900 text-gray-100">
      <div v-if="logs.length === 0" class="text-center py-4 text-gray-500">
        No logs yet. Start organizing files to see logs here.
      </div>
      <template v-else>
        <div
          v-for="(log, index) in logs"
          :key="index"
          class="text-xs py-1 px-2 font-mono leading-relaxed"
          :class="isErrorLog(log) ? 'text-red-400' : 'text-green-300'"
          v-html="log"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useProcessingStore } from '../stores/processingStore'

const processingStore = useProcessingStore()
const logs = computed(() => processingStore.logs)
const errorLogs = computed(() => processingStore.errors)

const isErrorLog = (log: string): boolean => {
  return log.toLowerCase().includes('error') || log.toLowerCase().includes('❌')
}
</script>
