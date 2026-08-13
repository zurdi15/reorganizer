import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RgSegmented from '../RgSegmented.vue'

const options = [
  { value: 'move', label: 'Mover' },
  { value: 'copy', label: 'Copiar' },
]

function mountSegmented(modelValue = 'move', opts = options) {
  return mount(RgSegmented, {
    props: { modelValue, options: opts, label: 'Modo' },
  })
}

describe('RgSegmented', () => {
  it('renders one radio per option with exactly the active one checked', () => {
    const wrapper = mountSegmented('copy')
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios).toHaveLength(2)
    expect(radios[0].attributes('aria-checked')).toBe('false')
    expect(radios[1].attributes('aria-checked')).toBe('true')
    expect(wrapper.find('[role="radiogroup"]').attributes('aria-label')).toBe('Modo')
  })

  it('emits update:modelValue on click', async () => {
    const wrapper = mountSegmented('move')
    await wrapper.findAll('[role="radio"]')[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['copy']])
  })

  it('moves with arrow keys, wrapping at the edges', async () => {
    const wrapper = mountSegmented('copy')
    await wrapper.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowRight' })
    // copy es el último: la derecha da la vuelta al primero
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['move'])

    await wrapper.setProps({ modelValue: 'move' })
    await wrapper.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['copy'])
  })

  it('slides a single always-mounted indicator to the active index (translateX in whole segments)', async () => {
    const wrapper = mountSegmented('move')
    const indicator = wrapper.get('[data-testid="segmented-indicator"]')
    expect(indicator.attributes('style')).toContain('translateX(0%)')

    await wrapper.setProps({ modelValue: 'copy' })
    expect(indicator.attributes('style')).toContain('translateX(100%)')
    // sigue siendo EL MISMO nodo (se traslada, no se remonta)
    expect(wrapper.findAll('[data-testid="segmented-indicator"]')).toHaveLength(1)
  })

  it('sizes the indicator as one nth of the track for any option count', () => {
    expect(mountSegmented('move').get('[data-testid="segmented-indicator"]').attributes('style')).toContain('width: 50%')
    const three = mountSegmented('a', [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ])
    expect(three.get('[data-testid="segmented-indicator"]').attributes('style')).toContain('width: 33.33')
  })

  it('hides the indicator via opacity (never a lying position) when the value matches no option', () => {
    const wrapper = mountSegmented('nonexistent')
    const indicator = wrapper.get('[data-testid="segmented-indicator"]')
    expect(indicator.attributes('style')).toContain('opacity: 0')
  })
})
