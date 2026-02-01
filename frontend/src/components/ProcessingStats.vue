<template>
  <div class="space-y-4">
    <h2 class="text-lg font-semibold text-white">Processing Statistics</h2>

    <!-- Main progress card -->
    <div class="card space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-gray-300">Progress</span>
        <span class="text-xl font-bold text-amber-400">{{ completionPercentage }}%</span>
      </div>
      
      <div class="h-3 overflow-hidden rounded-full bg-gray-700">
        <div
          class="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-300 shadow-lg shadow-amber-500/50"
          :style="{ width: `${completionPercentage}%` }"
        />
      </div>
      
      <div class="text-sm text-gray-400">
        {{ processingStore.stats.processed }} of {{ processingStore.stats.total }} files processed
      </div>
    </div>

    <!-- File type statistics - grouped -->
    <div class="card">
      <div class="space-y-3">
        <!-- Pictures -->
        <div class="flex items-center justify-between border-b border-gray-700 pb-3">
          <div class="flex items-center gap-3">
            <div class="rounded-lg bg-blue-500/10 p-2">
              <span class="text-2xl">🖼️</span>
            </div>
            <div>
              <div class="text-xs text-gray-400">Pictures</div>
              <div class="text-lg font-bold text-blue-400">{{ processingStore.stats.pictures }}</div>
            </div>
          </div>
        </div>

        <!-- Videos -->
        <div class="flex items-center justify-between border-b border-gray-700 pb-3">
          <div class="flex items-center gap-3">
            <div class="rounded-lg bg-purple-500/10 p-2">
              <span class="text-2xl">🎞️</span>
            </div>
            <div>
              <div class="text-xs text-gray-400">Videos</div>
              <div class="text-lg font-bold text-purple-400">{{ processingStore.stats.videos }}</div>
            </div>
          </div>
        </div>

        <!-- Unknown files -->
        <div class="flex items-center justify-between border-b border-gray-700 pb-3">
          <div class="flex items-center gap-3">
            <div class="rounded-lg bg-gray-500/10 p-2">
              <span class="text-2xl">📄</span>
            </div>
            <div>
              <div class="text-xs text-gray-400">Unknown</div>
              <div class="text-lg font-bold text-gray-400">{{ processingStore.stats.unknown }}</div>
            </div>
          </div>
        </div>

        <!-- Errors -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="rounded-lg p-2" :class="hasErrors ? 'bg-red-500/10' : 'bg-green-500/10'">
              <span class="text-2xl">{{ hasErrors ? '❌' : '✅' }}</span>
            </div>
            <div>
              <div class="text-xs text-gray-400">Errors</div>
              <div class="text-lg font-bold" :class="hasErrors ? 'text-red-400' : 'text-green-400'">
                {{ processingStore.errors.length }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useProcessingStore } from '../stores/processingStore'

const processingStore = useProcessingStore()

const completionPercentage = computed(() => processingStore.completionPercentage)
const hasErrors = computed(() => processingStore.hasErrors)
</script>
