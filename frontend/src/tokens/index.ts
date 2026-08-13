// Única fuente de verdad del diseño "darkroom": cualquier color/duración/
// curva nuevos nacen aquí y llegan al CSS vía `npm run build:tokens`, nunca
// a mano. Principios (ver plan Reorganizer 2.0):
//   - grises NEUTROS, sin tinte azul y sin textura de ruido: el chrome de
//     una herramienta de fotos debe ser cromáticamente silencioso (principio
//     Lightroom) — los colores protagonistas son los de las fotos.
//   - ámbar como acento primario (luz de cuarto oscuro, continuidad con la
//     identidad gris+ámbar del Reorganizer original) + cobalto secundario:
//     lenguaje de color instantáneo foto↔ámbar / vídeo↔cobalto.

export const themes = {
  dark: {
    'bg-void': '#0C0C0E',
    'bg-stone': '#141417',
    'bg-slab': '#1C1C21',
    line: '#26262A',
    'line-strong': '#38383E',
    ink: '#ECECEF',
    'ink-muted': '#9D9DA3',
    'ink-faint': '#626268',
    'accent-amber': '#F5A93F',
    'accent-amber-deep': '#CE8A28',
    'accent-cobalt': '#5CA8FF',
    'accent-cobalt-deep': '#3C7DD9',
    ok: '#4CC38A',
    danger: '#E25C4E',
    'amber-glow': 'rgba(245, 169, 63, 0.30)',
    // scrim de overlays (RgSheet): SIEMPRE oscuro en los dos temas — mismo
    // criterio que berserk/Material: un scrim atenúa, nunca aclara
    scrim: 'rgba(12, 12, 14, 0.7)',
    // losa realzada: en oscuro, line es más claro que la superficie y el
    // inset lee como filo iluminado desde arriba
    'slab-shadow': 'inset 0 1px 0 var(--rg-line)',
  },
  // Tema claro: la MISMA jerarquía de superficies (void < slab < stone) y el
  // mismo criterio WCAG AA que berserk — los acentos se usan como TEXTO real
  // (badges de kind, contadores, errores), así que todos superan 4.5:1 sobre
  // bg-stone (blanco). Verificado numéricamente al diseñar la paleta:
  // amber 5.21:1 / amber-deep 7.28:1 / cobalt 6.03:1 / cobalt-deep 7.78:1 /
  // ok 5.78:1 / danger 5.97:1 / ink sobre void 15.6:1. El matiz se conserva
  // (ámbar sigue siendo ámbar, cobalto sigue siendo azul) bajando solo la
  // luminosidad hasta cruzar el umbral con margen.
  light: {
    'bg-void': '#F4F4F5',
    'bg-stone': '#FFFFFF',
    'bg-slab': '#EBEBED',
    line: '#D9D9DE',
    'line-strong': '#BEBEC4',
    ink: '#1B1B1F',
    'ink-muted': '#5E5E64',
    'ink-faint': '#8E8E94',
    'accent-amber': '#996007',
    'accent-amber-deep': '#7F4A05',
    'accent-cobalt': '#2160BE',
    'accent-cobalt-deep': '#1D4FA3',
    ok: '#177449',
    danger: '#B3382C',
    // el halo se pierde sobre blanco con la misma opacidad que sobre negro:
    // rgb del ámbar ya oscurecido + opacidad un punto más alta
    'amber-glow': 'rgba(153, 96, 7, 0.32)',
    // scrim con el ink propio del tema (casi negro neutro), no negro puro
    scrim: 'rgba(27, 27, 31, 0.45)',
    // en claro, un inset con line (más oscuro que stone) leería como
    // hendidura: sombra de contacto + inset blanco (elevación real)
    'slab-shadow': '0 1px 3px rgba(20, 20, 24, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.7)',
  },
} as const

export const core = {
  radius: { xs: '2px', sm: '6px', md: '10px', full: '9999px' },
  font: {
    display: "'Space Grotesk', system-ui, sans-serif",
    body: "'Inter Variable', system-ui, sans-serif",
    // mono es FUNCIONAL, no decorativa: nombres de archivo, rutas, EXIF
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  dur: { 1: '120ms', 2: '200ms', 3: '320ms', 4: '600ms', 5: '1200ms' },
  ease: {
    out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    spring: 'cubic-bezier(0.34, 1.4, 0.44, 1)',
    inout: 'cubic-bezier(0.45, 0, 0.55, 1)',
    linear: 'linear',
  },
  // sin capa de ruido → sin z-noise: el eje termina en toast
  z: { nav: '40', sheet: '50', toast: '60' },
  shadow: {
    amber: '0 0 24px var(--rg-amber-glow)',
  },
} as const
