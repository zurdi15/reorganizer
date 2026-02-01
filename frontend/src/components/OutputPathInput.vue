<template>
  <div class="space-y-2">
    <label for="path" class="block text-sm font-semibold text-gray-300">
      Output Path
    </label>
    <div class="relative">
      <input
        id="path"
        v-model="currentPath"
        type="text"
        placeholder="e.g., 2024/12/hungary/"
        class="input-base"
        :class="{ 'input-error': !isValidPath && hasAttempted }"
        @input="handlePathInput"
        @focus="handleFocus"
      />
      <div
        v-if="!isValidPath && hasAttempted"
        class="mt-1 text-xs text-red-600"
      >
        Output path cannot be empty
      </div>
    </div>

    <!-- Folder Explorer (always visible when focused or has suggestions) -->
    <div 
      v-if="showExplorer" 
      class="mt-2 card max-h-64 overflow-y-auto scrollbar-thin"
    >
      <ul class="divide-y divide-gray-700">
        <!-- Parent directory option -->
        <li 
          v-if="currentPath.trim()"
          class="cursor-pointer hover:bg-amber-500/20 transition-colors rounded-lg"
          @click="navigateUp"
        >
          <div class="px-4 py-2.5 flex items-center gap-2">
            <span class="text-lg">⬆️</span>
            <span class="text-sm font-medium text-white">..</span>
          </div>
        </li>
        
        <!-- Folder suggestions -->
        <li
          v-for="folder in suggestions"
          :key="folder"
          class="cursor-pointer hover:bg-amber-500/20 transition-colors rounded-lg"
          @click="selectFolder(folder)"
        >
          <div class="px-4 py-2.5 flex items-center gap-2">
            <span class="text-lg">📁</span>
            <span class="text-sm font-medium text-white">{{ folder }}</span>
          </div>
        </li>

        <!-- Empty state -->
        <li v-if="suggestions.length === 0 && !loading" class="px-4 py-3 text-sm text-gray-400 italic">
          No folders found
        </li>

        <!-- Loading state -->
        <li v-if="loading" class="px-4 py-3 text-sm text-gray-400">
          Loading folders...
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { usePathStore } from '../stores/pathStore'

const pathStore = usePathStore()
const hasAttempted = ref(false)
const showExplorer = ref(true)

let inputTimeout: ReturnType<typeof setTimeout> | null = null

const currentPath = computed({
  get: () => pathStore.currentPath,
  set: (value: string) => {
    pathStore.updatePath(value)
  },
})

const suggestions = computed(() => pathStore.suggestions)
const isValidPath = computed(() => pathStore.isValidPath)
const loading = computed(() => pathStore.loading)

const handlePathInput = (): void => {
  if (inputTimeout) clearTimeout(inputTimeout)
  
  hasAttempted.value = false
  showExplorer.value = true

  inputTimeout = setTimeout(() => {
    pathStore.fetchSuggestions(currentPath.value)
  }, 300)
}

const handleFocus = (): void => {
  showExplorer.value = true
  hasAttempted.value = false
  // Fetch suggestions for current path on focus
  pathStore.fetchSuggestions(currentPath.value)
}

const selectFolder = (folder: string): void => {
  let newPath = currentPath.value
  if (newPath && !newPath.endsWith('/')) {
    newPath += '/'
  }
  newPath += folder + '/'
  
  pathStore.updatePath(newPath)
  pathStore.fetchSuggestions(newPath)
}

const navigateUp = (): void => {
  const parts = currentPath.value.split('/').filter(p => p)
  parts.pop()
  const newPath = parts.join('/') + (parts.length > 0 ? '/' : '')
  
  pathStore.updatePath(newPath)
  pathStore.fetchSuggestions(newPath)
}

const setAttempted = (): void => {
  hasAttempted.value = true
}

// Load initial suggestions on mount
onMounted(() => {
  pathStore.fetchSuggestions('')
})

defineExpose({ setAttempted })
</script>
