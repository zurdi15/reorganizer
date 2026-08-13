<script setup lang="ts">
// Shell de la app (port del MODELO FINAL de berserk/ShellView, no de su
// historia — los comentarios heredados resumen las regresiones que ya se
// pagaron allí para no repetirlas aquí).
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import ActiveJobBand from '@/components/shell/ActiveJobBand.vue'
import RgIcon from '@/lib/RgIcon.vue'
import type { IconName } from '@/lib/icons'
import { useUploadsStore } from '@/stores/uploads'

// 4 secciones; "Subir" ocupa el slab CTA elevado (patrón workout-slab de
// berserk): es LA acción que se hace con una mano desde el sofá, merece el
// target grande — y con subidas en curso muestra n/total con glow ámbar.
const items: { name: string; label: string; icon: IconName }[] = [
  { name: 'organize', label: 'shell.nav.organize', icon: 'folder-open' },
  { name: 'upload', label: 'shell.nav.upload', icon: 'upload' },
  { name: 'history', label: 'shell.nav.history', icon: 'history' },
  { name: 'settings', label: 'shell.nav.settings', icon: 'gear' },
]

const route = useRoute()
const router = useRouter()
const uploads = useUploadsStore()
// el locale vivo entra en la remedida del indicador: las etiquetas del nav
// cambian de ancho al cambiar de idioma (ver el watcher del indicador)
const { locale } = useI18n()

// <main> es el ÚNICO contenedor de scroll de la app y las vistas fluyen.
// El reset de scroll al cambiar de sección no llega gratis — se hace aquí,
// explícito, sobre el PATH. Asignación directa a scrollTop (no scrollTo()):
// mismo efecto y los entornos de test (happy-dom) la soportan sin mock.
const mainEl = ref<HTMLElement | null>(null)
watch(() => route.path, () => {
  if (mainEl.value) mainEl.value.scrollTop = 0
})

// el item del CTA no es un RouterLink (una losa <div> con botón dentro,
// herencia del patrón berserk que permitió anidar controles): navega por
// router.push
function goUpload() {
  if (route.name !== 'upload') router.push({ name: 'upload' })
}

// jerarquía del glow del CTA: ruta /upload activa (opacity 1) > subidas en
// curso desde otra ruta (tenue) > apagado
const uploadGlowOpacity = computed(() => {
  if (route.name === 'upload') return 1
  return uploads.active ? 0.5 : 0
})

// swipe horizontal sobre <main> navega al item anterior/siguiente del nav
// (sin dar la vuelta en los extremos). Guardas para no secuestrar gestos
// legítimos: (1) el arrastre debe ser claramente horizontal (≥60px y el
// doble que su componente vertical); (2) se ignora si empieza sobre un
// scroller horizontal (tiras con overflow) — se detecta subiendo por el DOM
// hasta <main>; (3) se ignora sobre inputs y sobre [data-no-swipe] (la grid
// del input lo usará para el arrastre de selección). Listeners passive:
// nunca bloquean el scroll.
let swipeStartX = 0
let swipeStartY = 0
let swipeEligible = false

function hasHorizontalScroller(start: Element | null): boolean {
  let el: Element | null = start
  while (el && el !== mainEl.value) {
    if (el.scrollWidth > el.clientWidth + 4) {
      const overflowX = getComputedStyle(el).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}

function onMainTouchStart(event: TouchEvent) {
  const touch = event.touches[0]
  if (!touch) return
  swipeStartX = touch.clientX
  swipeStartY = touch.clientY
  const target = event.target as Element | null
  swipeEligible =
    !target?.closest('canvas, input, textarea, [data-no-swipe]') &&
    !hasHorizontalScroller(target)
}

function onMainTouchEnd(event: TouchEvent) {
  if (!swipeEligible) return
  const touch = event.changedTouches[0]
  if (!touch) return
  const dx = touch.clientX - swipeStartX
  const dy = touch.clientY - swipeStartY
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return
  const target = items[activeIndex.value + (dx < 0 ? 1 : -1)]
  if (target) router.push({ name: target.name })
}

// índice de la sección activa, para el indicador deslizante del bottom bar
// (móvil): -1 (sin match) cae a 0 en vez de esconder la barra en una
// posición rara — dentro de este shell siempre hay una ruta hija activa
const activeIndex = computed(() => {
  const idx = items.findIndex((item) => item.name === route.name)
  return idx === -1 ? 0 : idx
})

// indicador deslizante también arriba (desktop) — pero ahí los items son de
// ancho VARIABLE (etiquetas de texto), no columnas iguales, así que en vez
// de fracciones fijas se mide el rectángulo real del item activo
// (offsetLeft/offsetWidth) y el indicador se posiciona con transform+width
// en píxeles. El <header> es el contexto de posicionamiento
// (position:relative) para que translateX() sea relativo al header entero y
// el indicador pueda vivir bottom-0 DEL HEADER, sobre su border-b.
const desktopItemRefs = ref<(HTMLLIElement | null)[]>([])
function setDesktopItemRef(el: Element | null, index: number) {
  desktopItemRefs.value[index] = el as HTMLLIElement | null
}

const indicatorLeft = ref(0)
const indicatorWidth = ref(0)

function updateIndicator() {
  const el = desktopItemRefs.value[activeIndex.value]
  if (!el) return
  indicatorLeft.value = el.offsetLeft
  indicatorWidth.value = el.offsetWidth
}

onMounted(() => {
  updateIndicator()
  window.addEventListener('resize', updateIndicator)
})
onUnmounted(() => {
  window.removeEventListener('resize', updateIndicator)
})
// remedir cuando cambia CUÁL item está activo y también al cambiar de idioma:
// las etiquetas de texto (ancho variable en desktop) se re-miden, si no el
// subrayado queda desalineado sobre el ancho del idioma anterior
watch([activeIndex, locale], () => nextTick(updateIndicator))

// h-dvh (no min-h-dvh) en la raíz del template: un tope real de altura es lo
// que permite que <main> reparta con flex-1 un alto DEFINIDO — sin él, una
// vista que pida "ocupa el resto del viewport" no tiene contra qué medirse y
// la página entera crece en vez de scrollear por dentro. (Nota: este
// comentario vive en <script>, no como primer hijo de <template> — un
// comentario HTML ahí convierte la raíz en un fragmento de dos nodos y rompe
// wrapper.classes()/fallthrough de un solo elemento raíz.)
</script>

<template>
  <div class="h-dvh flex flex-col">
    <!-- Desktop navbar: barra superior centrada. relative: contexto de
         posicionamiento del indicador deslizante — translateX() queda
         relativo al header entero y el indicador vive bottom-0 DE AQUÍ,
         sobre la misma línea que border-b. -->
    <header class="hidden sm:block border-b border-line relative">
      <nav :aria-label="$t('shell.nav.label')">
        <!-- items-end: sin esto, align-items:stretch estira cada <li> al
             alto del más alto (la CTA, por su losa) pero el contenido de los
             DEMÁS items se queda arriba, dejando hueco vacío antes del
             border-b — los items "flotan" a media barra. items-end alinea
             cada <li> por su propio borde inferior; la CTA sobresale por
             debajo vía su propio -mb-5, fuera de su caja de layout. -->
        <ul class="flex items-end justify-center gap-2">
          <li
            v-for="(item, index) in items"
            :key="item.name"
            :ref="(el) => setDesktopItemRef(el as Element | null, index)"
          >
            <div
              v-if="item.name === 'upload'"
              class="flex flex-col items-center gap-1 px-3 py-2"
              :class="route.name === 'upload' ? 'text-amber' : 'text-ink-faint hover:text-ink'"
            >
              <span class="text-xs tracking-wide">{{ $t(item.label) }}</span>
              <div class="rg-slab relative -mb-5 h-12 flex items-stretch border-amber text-amber" data-testid="cta-slab">
                <!-- una sola capa de glow, apagada por defecto, que funde a
                     opacity según la jerarquía (ver script) -->
                <span
                  class="absolute inset-0 rounded-sm shadow-(--rg-shadow-amber)"
                  :style="{ opacity: uploadGlowOpacity, transition: 'opacity var(--rg-dur-3) var(--rg-ease-out)' }"
                  aria-hidden="true"
                  data-testid="upload-glow"
                />
                <button
                  type="button"
                  class="rg-press relative px-2.5 flex items-center justify-center"
                  :aria-label="$t(item.label)"
                  @click="goUpload"
                >
                  <!-- con subidas activas, el hueco del icono muestra el
                       contador n/total (el estado del lote sigue visible
                       desde cualquier sección) -->
                  <span v-if="uploads.active" class="rg-metric text-sm whitespace-nowrap" data-testid="cta-uploads">
                    {{ $t('shell.uploadsActive', { done: uploads.done, total: uploads.total }) }}
                  </span>
                  <RgIcon v-else :name="item.icon" :size="26" />
                </button>
              </div>
            </div>
            <RouterLink
              v-else
              :to="{ name: item.name }"
              class="flex flex-col items-center gap-1 px-3 py-2 text-ink-faint hover:text-ink"
              active-class="text-amber"
            >
              <span class="text-xs tracking-wide">{{ $t(item.label) }}</span>
              <span><RgIcon :name="item.icon" :size="20" class="relative" /></span>
            </RouterLink>
          </li>
        </ul>
      </nav>
      <!-- indicador deslizante único (no uno por item) — SIEMPRE montado,
           cruza a opacity 0 en vez de desmontarse cuando la sección activa
           es la CTA; medido en px porque los items no son columnas iguales -->
      <div
        class="absolute bottom-0 left-0 h-0.5 rounded-full bg-amber"
        :style="{
          transform: `translateX(${indicatorLeft}px)`,
          width: `${indicatorWidth}px`,
          opacity: route.name === 'upload' ? 0 : 1,
          transition:
            'transform var(--rg-dur-3) var(--rg-ease-out), width var(--rg-dur-3) var(--rg-ease-out), opacity var(--rg-dur-3) var(--rg-ease-out)',
        }"
        aria-hidden="true"
        data-testid="nav-indicator-desktop"
      />
    </header>
    <!-- banda de job activo: visible en toda la app mientras corre un job,
         navega a /organize (ver ActiveJobBand.vue) -->
    <ActiveJobBand />
    <!-- Mobile bottom nav: barra inferior fija en móvil; oculta en desktop -->
    <nav
      class="fixed inset-x-0 bottom-0 z-(--rg-z-nav) border-t border-line bg-stone pb-[env(safe-area-inset-bottom)] sm:hidden"
      :aria-label="$t('shell.nav.label')"
    >
      <div class="relative max-w-3xl mx-auto">
        <!-- indicador deslizante: una barra por cada 1/4 del ancho, se
             traslada al índice activo — SIEMPRE montado (nunca v-if) para
             poder cruzar a opacity 0 en vez de desaparecer de golpe al
             entrar en /upload; ya se traslada solo hasta la posición de la
             CTA (activeIndex la incluye), así que el fade queda encima de
             ese movimiento, no en lugar de él -->
        <div
          class="absolute top-0 left-0 h-0.5 w-1/4 rounded-full bg-amber"
          :style="{
            transform: `translateX(${activeIndex * 100}%)`,
            opacity: route.name === 'upload' ? 0 : 1,
            transition: 'transform var(--rg-dur-3) var(--rg-ease-out), opacity var(--rg-dur-3) var(--rg-ease-out)',
          }"
          aria-hidden="true"
          data-testid="nav-indicator"
        />
        <ul class="flex justify-around">
          <!-- flex-1 SIEMPRE: las 4 columnas del bottom nav miden 1/4 cada
               una — el indicador deslizante depende de esa aritmética -->
          <li v-for="item in items" :key="item.name" class="flex-1">
            <div
              v-if="item.name === 'upload'"
              class="flex flex-col items-center gap-1 py-2"
              :class="route.name === 'upload' ? 'text-amber' : 'text-ink-faint'"
            >
              <div class="rg-slab relative -mt-5 h-12 flex items-stretch border-amber text-amber" data-testid="cta-slab-mobile">
                <span
                  class="absolute inset-0 rounded-sm shadow-(--rg-shadow-amber)"
                  :style="{ opacity: uploadGlowOpacity, transition: 'opacity var(--rg-dur-3) var(--rg-ease-out)' }"
                  aria-hidden="true"
                  data-testid="upload-glow"
                />
                <button
                  type="button"
                  class="rg-press relative px-2.5 flex items-center justify-center"
                  :aria-label="$t(item.label)"
                  @click="goUpload"
                >
                  <span v-if="uploads.active" class="rg-metric text-sm whitespace-nowrap" data-testid="cta-uploads-mobile">
                    {{ $t('shell.uploadsActive', { done: uploads.done, total: uploads.total }) }}
                  </span>
                  <RgIcon v-else :name="item.icon" :size="26" />
                </button>
              </div>
              <span class="text-2xs tracking-wide">{{ $t(item.label) }}</span>
            </div>
            <RouterLink
              v-else
              :to="{ name: item.name }"
              class="flex flex-col items-center gap-1 py-2 text-ink-faint"
              active-class="text-amber"
            >
              <span><RgIcon :name="item.icon" :size="20" class="relative" /></span>
              <span class="text-2xs tracking-wide">{{ $t(item.label) }}</span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>
    <!-- EL MODELO DE SCROLL (tercera iteración de berserk, importada ya
         estable): <main> es el ÚNICO scroller de la app, A ANCHO COMPLETO
         (la columna centrada vive en el wrapper de abajo) — su scrollbar
         pinta en el borde real de la ventana en desktop. Las vistas FLUYEN
         (altura por contenido, sin acotarse) y su chrome se pega arriba con
         sticky top-0 contra este scrollport — sticky exige que ningún
         ancestro intermedio tenga overflow propio ni transform retenido
         (las entradas rg-stagger usan fill backwards: el transform se
         limpia al terminar). El scroll interno sobrevive SOLO en cajas hoja
         con su propia altura (paneles de RgSelect, sheets) — nunca como
         cadena de referencias de altura entre niveles. -->
    <main
      ref="mainEl"
      class="flex-1 min-h-0 overflow-y-auto rg-scroll-stable w-full"
      @touchstart.passive="onMainTouchStart"
      @touchend.passive="onMainTouchEnd"
    >
      <!-- wrapper de FLUJO puro — columna centrada, altura por contenido,
           sin calc ni flex-col ni spacer. pb-24 como padding es CORRECTO
           aquí: con altura auto la caja TERMINA donde termina el contenido y
           el padding queda siempre después de él, reservando el hueco del
           navbar móvil fijo. -->
      <div class="max-w-3xl mx-auto w-full px-4 pt-4 pb-24">
        <!-- sin Transition aquí a propósito: envolver la vista ENTERA en un
             fade MIENTRAS su propio rg-stagger interno corre con su delay
             son dos sistemas de animación a la vez (las opacidades se
             multiplican y el viewport se ve negro unos ms tras navegar).
             Cada vista es dueña de su única animación de entrada. -->
        <RouterView />
      </div>
    </main>
  </div>
</template>
