import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    // storage funcional + limpio por test en CUALQUIER versión de Node —
    // el porqué completo vive en el propio setup (herencia berserk)
    setupFiles: ['./src/test/setup.ts'],
    // zona pineada: los tests de fechas relativas (utils/format) solo son
    // deterministas si la zona activa no depende del entorno del CI
    env: { TZ: 'Europe/Madrid' },
    // .worktrees/ (gitignored, usada por sesiones en paralelo) queda DENTRO
    // del árbol del proyecto: sin la exclusión explícita, vitest correría
    // por duplicado los tests de un checkout ajeno en marcha
    exclude: ['**/node_modules/**', '**/dist/**', '**/.{git,cache,output,temp}/**', '**/.worktrees/**'],
  },
})
