// @vitest-environment jsdom
/**
 * End-to-end test of the *phone path*: the app is mounted in a browser-like DOM
 * with a static host (no backend), so it must detect that and run the scanner
 * in the browser, then render markets, venues and the phone panel.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

/** A static host answers every unknown path with the app shell (HTML). */
const staticHostFetch = () =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/')) {
      return new Response('<!doctype html><html><body>shell</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    }
    throw new TypeError('Failed to fetch')
  })

describe('standalone dashboard (phone path)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('fetch', staticHostFetch())
  })

  // Vitest runs without globals, so React Testing Library's automatic cleanup
  // is not installed — do it explicitly.
  afterEach(() => cleanup())

  it('falls back to the on-device engine and renders the dashboard', async () => {
    render(<App />)

    // Brand + shell render immediately, before any data arrives.
    expect(screen.getByText('ArbiBot Web')).toBeTruthy()
    expect(screen.getByText(/Cross-venue/)).toBeTruthy()
    expect(screen.getByText(/Venues online/)).toBeTruthy()

    // Mode is labelled honestly: the static host has no API, so the scanner
    // runs on-device and says so.
    await waitFor(() => expect(screen.getAllByText(/SIMULATED FEED/i).length).toBeGreaterThan(0), {
      timeout: 8000,
    })
    // The header states that this build runs without a server.
    expect(screen.getByText(/Runs in your browser/)).toBeTruthy()

    // The venue panel is populated with all ten venues (from the local engine).
    expect(screen.getByText('Binance')).toBeTruthy()
    expect(screen.getByText('Coinbase')).toBeTruthy()

    // The engine produced markets: switch to the Markets tab and look for one.
    fireEvent.click(screen.getByText(/^Markets/))
    await waitFor(() => expect(screen.getAllByText('BTC').length).toBeGreaterThan(0), { timeout: 8000 })
    expect(screen.getAllByText(/Best net edge/).length).toBeGreaterThan(0)

    // Settings are local to the device, so the panel is available.
    expect(screen.getAllByText('Scanner settings').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Data source').length).toBeGreaterThan(0)
    // …and the venues panel exposes all ten venues for enabling/disabling.
    expect(screen.getAllByText('Venues').length).toBeGreaterThan(0)
  }, 20_000)

  it('shows the phone panel with a scannable QR code and install guidance', async () => {
    render(<App />)
    const phoneButton = await screen.findByTitle('Open this dashboard on your phone')
    fireEvent.click(phoneButton)

    await waitFor(() => expect(screen.getByText('Open on your phone')).toBeTruthy())

    // The QR code is generated client-side as inline SVG (no third-party call),
    // and its modules are drawn as real geometry.
    const svg = document.querySelector('.qr__code svg') as SVGElement | null
    expect(svg).toBeTruthy()
    const geometry = svg?.querySelector('path, rect')
    expect(geometry?.getAttribute('d') ?? geometry?.getAttribute('width')).toBeTruthy()
    expect(svg?.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/)

    // The current URL is shown so a second device can be pointed at it.
    expect(screen.getByText(new RegExp(window.location.host))).toBeTruthy()
    expect(screen.getAllByText(/Add to Home Screen|Install app/).length).toBeGreaterThan(0)
  }, 20_000)
})
