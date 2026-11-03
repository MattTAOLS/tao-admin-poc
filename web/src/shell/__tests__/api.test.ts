// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiBlob, roleHeaders } from '../api'
import { KEY } from '../roles'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

describe('apiBlob', () => {
  it('sends the role headers and returns the body as a Blob', async () => {
    localStorage.setItem(KEY, 'investor_viewer')
    const fetchMock = vi.fn(async () => new Response('png-bytes', { status: 200, headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)
    const blob = await apiBlob('/uploads/u1/pages/2.png')
    expect(await blob.text()).toBe('png-bytes')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url.endsWith('/uploads/u1/pages/2.png')).toBe(true)
    expect(init.headers).toEqual({ 'X-Role': 'investor_viewer', 'X-Partner': 'investor' })
  })
  it('throws with code and status on an error response', async () => {
    localStorage.setItem(KEY, 'tao_analyst')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'not_found', message: 'No page 9' }), { status: 404 })))
    await expect(apiBlob('/uploads/u1/pages/9.png')).rejects.toMatchObject({ code: 'not_found', status: 404, message: 'No page 9' })
  })
  it('roleHeaders has no X-Partner for TAO roles', () => {
    localStorage.setItem(KEY, 'tao_admin')
    expect(roleHeaders()).toEqual({ 'X-Role': 'tao_admin' })
  })
})
