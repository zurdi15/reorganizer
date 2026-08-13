import { describe, expect, it } from 'vitest'

import { KNOWN_PLACEHOLDERS, previewRuleTemplate } from '../ruleTemplate'

describe('utils/ruleTemplate', () => {
  it('renders every known placeholder with its example value', () => {
    const result = previewRuleTemplate('{media_type}/{orientation}/{make}/{model}/{yyyy}/{mm}')
    expect(result).toEqual({ ok: true, dest: 'video/horizontal/DJI/mini3/2024/08' })
  })

  it('renders the canonical legacy template (segmento fijo + placeholder)', () => {
    const result = previewRuleTemplate('video/{orientation}/dron/mini3')
    expect(result).toEqual({ ok: true, dest: 'video/horizontal/dron/mini3' })
  })

  it('passes through a template without placeholders untouched', () => {
    expect(previewRuleTemplate('photo')).toEqual({ ok: true, dest: 'photo' })
  })

  it('flags the FIRST unknown placeholder instead of rendering garbage', () => {
    const result = previewRuleTemplate('video/{orientacion}/{make}')
    expect(result).toEqual({ ok: false, unknown: 'orientacion' })
  })

  it('does not treat stray braces without placeholder shape as placeholders', () => {
    // llaves sin nombre válido dentro: no matchean la regex y quedan tal cual
    expect(previewRuleTemplate('a{}/b{1x}')).toEqual({ ok: true, dest: 'a{}/b{1x}' })
  })

  it('exposes the same placeholder set the backend knows, wrapped in braces', () => {
    expect([...KNOWN_PLACEHOLDERS].sort()).toEqual(
      ['{media_type}', '{orientation}', '{make}', '{model}', '{yyyy}', '{mm}'].sort(),
    )
    for (const placeholder of KNOWN_PLACEHOLDERS) {
      expect(previewRuleTemplate(placeholder).ok).toBe(true)
    }
  })
})
