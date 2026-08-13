import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../client'
import { deleteRule, patchRule, reorderRules, testRules } from '../rules'
import { testImmich, updateSettings } from '../settings'

// Los slugs del backend (detail="…") tienen que atravesar la capa api()
// intactos hasta ApiError.slug — de eso vive toastApiError y el inline de
// RuleSheet. Aquí se verifica el passthrough por dominio settings/rules.

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api/settings + api/rules — slug passthrough', () => {
  it('updateSettings surfaces a 400 slug (invalid_immich_url) as ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'invalid_immich_url' }, 400)))

    const error = await updateSettings({ immich_url: 'nota-url' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).slug).toBe('invalid_immich_url')
  })

  it('testImmich posts the override body and surfaces 502 slugs', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ detail: 'immich_auth_failed' }, 502))
    vi.stubGlobal('fetch', fetchMock)

    const error = await testImmich({ url: 'http://x', api_key: '****abcd' }).catch((e: unknown) => e)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/settings/immich/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'http://x', api_key: '****abcd' }),
      }),
    )
    expect((error as ApiError).slug).toBe('immich_auth_failed')
  })

  it('patchRule surfaces a 422 slug (invalid_regex) as ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'invalid_regex' }, 422)))

    const error = await patchRule(4, { filename_regex: '[' }).catch((e: unknown) => e)
    expect((error as ApiError).status).toBe(422)
    expect((error as ApiError).slug).toBe('invalid_regex')
  })

  it('reorderRules posts the exact {ids} contract shape', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await reorderRules([2, 1, 3])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/rules/reorder',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: [2, 1, 3] }) }),
    )
  })

  it('testRules returns the parsed match result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ matched_rule_id: 4, matched_rule_name: 'Dron', dest: 'video/h/dron' }),
      ),
    )

    await expect(testRules({ filename: 'DJI_0042.MP4', media_type: 'video' })).resolves.toEqual({
      matched_rule_id: 4,
      matched_rule_name: 'Dron',
      dest: 'video/h/dron',
    })
  })

  it('deleteRule resolves void on 204 (no body to parse)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }) as unknown as Response),
    )

    await expect(deleteRule(4)).resolves.toBeUndefined()
  })
})
