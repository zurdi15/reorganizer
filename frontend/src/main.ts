// Fuentes: solo los pesos que el sistema usa de verdad (display 600/700
// para títulos/botones, mono 400/600 para rutas y contadores; Inter
// variable cubre el body entero)
import '@fontsource/space-grotesk/latin-600.css'
import '@fontsource/space-grotesk/latin-700.css'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import './styles/base.css'
import './styles/animations.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { i18n } from './i18n'
import { router } from './router'
import { initTheme } from './utils/theme'

// el script inline de index.html ya aplicó la clase/meta correctas antes del
// primer paint (evita el flash) — esto reafirma el estado y, sobre todo,
// engancha el listener de prefers-color-scheme para el modo 'system' (el
// script inline es un IIFE de un solo disparo, no puede dejar nada vivo)
initTheme()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)

// esperar a que el router resuelva la ruta inicial antes de montar: sin
// esto, el primer frame pinta el shell sin vista hija y salta un reflow
// visible cuando la ruta llega un tick después
router.isReady().then(() => {
  app.mount('#app')
})
