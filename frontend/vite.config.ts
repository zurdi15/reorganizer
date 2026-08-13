import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // shell precacheado, datos siempre online: sin cache de runtime del API
      workbox: {
        // el fallback de navegación del SW no debe interceptar /api/*: si no,
        // una petición fetch a la API que falle de red cae al index.html
        navigateFallbackDenylist: [/^\/api\//],
        // el shell offline necesita las fuentes latin en el precache (por defecto
        // workbox solo mete js/css/html); los demás subsets quedan online-only
        globPatterns: ['**/*.{js,css,html,svg,png,ico}', 'assets/*-latin-[0-9w]*.woff2'],
      },
      manifest: {
        name: 'Reorganizer',
        short_name: 'Reorg',
        description: 'Organiza fotos y vídeos hacia tu librería de Immich',
        display: 'standalone',
        // sin pin de orientación a propósito: revisar fotos en landscape es legítimo
        theme_color: '#0C0C0E',
        background_color: '#0C0C0E',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // ws: true — el WebSocket de progreso vive bajo /api/v1/ws y el proxy
    // tiene que hacer upgrade, no solo HTTP
    proxy: { '/api': { target: 'http://localhost:8000', ws: true } },
  },
})
