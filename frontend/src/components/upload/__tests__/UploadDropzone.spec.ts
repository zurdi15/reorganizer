import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import UploadDropzone from '../UploadDropzone.vue'
import { createI18nInstance } from '@/i18n'

function mountDropzone(compact = false) {
  return mount(UploadDropzone, {
    props: { compact },
    global: { plugins: [createI18nInstance()] },
  })
}

// eventos de drag construidos a mano (Event + dataTransfer inyectado):
// deterministas en happy-dom, sin depender de su constructor de DragEvent
async function fireDrag(
  wrapper: VueWrapper,
  type: string,
  { types = ['Files'], files = [] as File[] } = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types, files } })
  wrapper.get('[data-testid="dropzone"]').element.dispatchEvent(event)
  await wrapper.vm.$nextTick()
}

const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })

describe('UploadDropzone', () => {
  it('emits the picked files and resets the input so the same file can be re-picked', async () => {
    const wrapper = mountDropzone()
    const input = wrapper.get<HTMLInputElement>('[data-testid="dropzone-input"]')
    expect(input.attributes('accept')).toBe('image/*,video/*')
    expect(input.attributes('multiple')).toBeDefined()

    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    expect(wrapper.emitted('files')).toEqual([[[file]]])
    expect(input.element.value).toBe('')

    // segundo pick del MISMO archivo: el reset permite que change dispare
    await input.trigger('change')
    expect(wrapper.emitted('files')).toHaveLength(2)
  })

  it('tracks dragenter/dragleave with a counter so child hover pairs do not flicker', async () => {
    const wrapper = mountDropzone()
    const zone = () => wrapper.get('[data-testid="dropzone"]')

    await fireDrag(wrapper, 'dragenter')
    // entrar en un hijo dispara otro par enter/leave
    await fireDrag(wrapper, 'dragenter')
    await fireDrag(wrapper, 'dragleave')
    expect(zone().attributes('data-dragging')).toBe('true')
    expect(wrapper.find('[data-testid="dropzone-glow"]').exists()).toBe(true)

    await fireDrag(wrapper, 'dragleave')
    expect(zone().attributes('data-dragging')).toBeUndefined()
    expect(wrapper.find('[data-testid="dropzone-glow"]').exists()).toBe(false)
  })

  it('ignores drags that carry no files (text selections)', async () => {
    const wrapper = mountDropzone()
    await fireDrag(wrapper, 'dragenter', { types: ['text/plain'] })
    expect(wrapper.get('[data-testid="dropzone"]').attributes('data-dragging')).toBeUndefined()
  })

  it('emits dropped files and clears the hover state', async () => {
    const wrapper = mountDropzone()
    await fireDrag(wrapper, 'dragenter')
    await fireDrag(wrapper, 'drop', { files: [file] })

    expect(wrapper.emitted('files')).toEqual([[[file]]])
    expect(wrapper.get('[data-testid="dropzone"]').attributes('data-dragging')).toBeUndefined()
  })

  it('renders the tall empty slab by default and a compact bar when the queue has items', () => {
    const empty = mountDropzone(false)
    expect(empty.get('[data-testid="dropzone-button"]').attributes('style')).toContain('40dvh')

    const compact = mountDropzone(true)
    expect(compact.get('[data-testid="dropzone-button"]').attributes('style') ?? '').not.toContain(
      '40dvh',
    )
  })
})
