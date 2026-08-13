import { describe, expect, it } from 'vitest'

import { en } from '../en'
import { es } from '../es'

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

// El árbol de claves es idéntico entre locales por contrato: una clave que
// existe solo en es se cuela sin traducir en en (y viceversa) sin que nadie
// lo note hasta verlo en pantalla. Con los mensajes repartidos en ficheros
// por dominio (deviation deliberada, ver es.ts) este test es lo único que
// garantiza que los dos lados crecen a la vez.
// (El barrido de slugs del backend — cada detail="..." con su clave
// errors.* — llega con la oleada 5, cuando el backend esté completo.)
describe('i18n messages', () => {
  it('es and en share the exact same key tree', () => {
    expect(flatten(es).sort()).toEqual(flatten(en).sort())
  })

  it('both locales expose every domain namespace', () => {
    for (const domain of ['common', 'shell', 'upload', 'organize', 'history', 'settings', 'errors']) {
      expect(Object.keys(es)).toContain(domain)
      expect(Object.keys(en)).toContain(domain)
    }
  })

  it('the error table covers the generic fallbacks client code relies on', () => {
    const keys = flatten(es)
    for (const slug of ['generic', 'offline', 'validation']) {
      expect(keys).toContain(`errors.${slug}`)
    }
  })
})
