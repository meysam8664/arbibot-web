import { describe, expect, it, vi } from 'vitest'
import { detectDataSource } from '../client'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const htmlResponse = () =>
  new Response('<!doctype html><html><body>app shell</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  })

describe('data source detection', () => {
  it('uses the explicit backend URL when configured', async () => {
    const fetchImpl = vi.fn()
    await expect(detectDataSource(fetchImpl as unknown as typeof fetch, 'https://api.example.com')).resolves.toBe(
      'backend',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('runs locally when backendUrl is null', async () => {
    const fetchImpl = vi.fn()
    await expect(detectDataSource(fetchImpl as unknown as typeof fetch, null)).resolves.toBe('local')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('detects a same-origin ArbiBot API', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok', app: 'ArbiBot Web' }))
    await expect(detectDataSource(fetchImpl as unknown as typeof fetch, '')).resolves.toBe('backend')
  })

  it('falls back to the browser engine on a static host (HTML for /api/health)', async () => {
    const fetchImpl = vi.fn(async () => htmlResponse())
    await expect(detectDataSource(fetchImpl as unknown as typeof fetch, '')).resolves.toBe('local')
  })

  it('falls back to the browser engine when the network is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(detectDataSource(fetchImpl as unknown as typeof fetch, '')).resolves.toBe('local')
  })

  it('ignores a JSON 404 from an unrelated host', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ detail: 'Not Found' }, 404))
    await expect(detectDataSource(fetchImpl as unknown as typeof fetch, '')).resolves.toBe('local')
  })
})
