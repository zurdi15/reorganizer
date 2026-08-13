import { createI18n } from 'vue-i18n'

import { getLocalePref, setLocalePref, type LocalePref } from '@/utils/uiPrefs'
import { en } from './en'
import { es } from './es'

export type Locale = LocalePref

export function createI18nInstance(locale: Locale = 'es') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'es',
    messages: { es, en },
  })
}

// el lang del <html> acompaña SIEMPRE al locale activo (lectores de pantalla,
// hyphens): compartido por el arranque y por applyLocale para que nunca se
// desincronicen. El index.html sirve con lang="es" fijo; sin esta llamada en
// boot, un usuario con inglés persistido arrancaría con lang="es" hasta que
// tocara el picker.
export function syncHtmlLang(locale: string) {
  document.documentElement.lang = locale
}

// instancia única: los helpers fuera de componentes (toasts de error) y la
// app comparten el mismo i18n. Arranca con lo persistido en rg:lang.
export const i18n = createI18nInstance(getLocalePref())
syncHtmlLang(i18n.global.locale.value)

// aplica + persiste el idioma (picker de Ajustes, oleada 4).
export function applyLocale(locale: string) {
  if (locale !== 'es' && locale !== 'en') return
  i18n.global.locale.value = locale
  setLocalePref(locale)
  syncHtmlLang(locale)
}
