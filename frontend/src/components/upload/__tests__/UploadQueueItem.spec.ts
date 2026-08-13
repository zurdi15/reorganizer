import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import UploadQueueItem from '../UploadQueueItem.vue'
import { createI18nInstance } from '@/i18n'
import type { UploadItem } from '@/stores/uploads'

function makeItem(overrides: Partial<UploadItem> = {}): UploadItem {
  return {
    id: 1,
    file: new File(['x'], 'foto.jpg', { type: 'image/jpeg' }),
    name: 'foto.jpg',
    size: 1024,
    kind: 'image',
    status: 'queued',
    progress: 0,
    batch: 1,
    ...overrides,
  }
}

function mountItem(overrides: Partial<UploadItem> = {}) {
  return mount(UploadQueueItem, {
    props: { item: makeItem(overrides) },
    global: { plugins: [createI18nInstance()] },
  })
}

describe('UploadQueueItem', () => {
  it('renders the objectURL thumb for images and the human size', () => {
    const wrapper = mountItem({ objectUrl: 'blob:mock-1' })
    expect(wrapper.get('[data-testid="item-thumb"]').attributes('src')).toBe('blob:mock-1')
    expect(wrapper.text()).toContain('1 KB')
  })

  it('renders an icon glyph (no client frame extraction) for videos', () => {
    const wrapper = mountItem({ kind: 'video', name: 'clip.mp4' })
    expect(wrapper.find('[data-testid="item-thumb"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="item-glyph"]').exists()).toBe(true)
  })

  it('middle-truncates long names while keeping the full name in the title attribute', () => {
    const name = 'DJI_20240817_una_tarde_larguisima_en_croacia_0042.MP4'
    const wrapper = mountItem({ kind: 'video', name })
    const label = wrapper.get('[data-testid="item-name"]')
    expect(label.attributes('title')).toBe(name)
    expect(label.text()).toContain('…')
    expect(label.text().endsWith('0042.MP4')).toBe(true)
  })

  it('queued: shows the waiting icon and an always-visible cancel button', () => {
    const wrapper = mountItem({ status: 'queued' })
    expect(wrapper.find('[data-testid="status-queued"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cancel-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="retry-btn"]').exists()).toBe(false)
  })

  it('uploading: shows the progress bar wired to item.progress plus cancel', () => {
    const wrapper = mountItem({ status: 'uploading', progress: 0.5 })
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('50')
    expect(wrapper.find('[data-testid="cancel-btn"]').exists()).toBe(true)
  })

  it('done: shows the check state without any action buttons', () => {
    const wrapper = mountItem({ status: 'done', progress: 1 })
    expect(wrapper.find('[data-testid="status-done"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="retry-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cancel-btn"]').exists()).toBe(false)
  })

  it('error: resolves the slug to a message and offers retry', () => {
    const wrapper = mountItem({ status: 'error', errorSlug: 'file_too_large' })
    expect(wrapper.get('[data-testid="item-error"]').text()).toBe(
      'El archivo supera el tamaño máximo permitido.',
    )
    expect(wrapper.find('[data-testid="retry-btn"]').exists()).toBe(true)
  })

  it('error with an unknown slug falls back to the generic message', () => {
    const wrapper = mountItem({ status: 'error', errorSlug: 'weird_new_slug' })
    expect(wrapper.get('[data-testid="item-error"]').text()).toBe(
      'Algo ha fallado. Inténtalo de nuevo.',
    )
  })

  it('canceled: labels the state and offers retry', () => {
    const wrapper = mountItem({ status: 'canceled' })
    expect(wrapper.find('[data-testid="item-canceled"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="retry-btn"]').exists()).toBe(true)
  })

  it('warns (without blocking) on files over 2 GB', () => {
    const small = mountItem()
    expect(small.find('[data-testid="too-big-badge"]').exists()).toBe(false)

    const big = mountItem({ kind: 'video', size: 3 * 1024 ** 3 })
    expect(big.find('[data-testid="too-big-badge"]').exists()).toBe(true)
    // sigue habiendo cancel normal: avisa, no bloquea
    expect(big.find('[data-testid="cancel-btn"]').exists()).toBe(true)
  })

  it('emits retry/cancel with the item id', async () => {
    const error = mountItem({ id: 7, status: 'error', errorSlug: 'offline' })
    await error.get('[data-testid="retry-btn"]').trigger('click')
    expect(error.emitted('retry')).toEqual([[7]])

    const uploading = mountItem({ id: 9, status: 'uploading' })
    await uploading.get('[data-testid="cancel-btn"]').trigger('click')
    expect(uploading.emitted('cancel')).toEqual([[9]])
  })
})
