import { useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { installState, onInstallStateChange } from '../pwa'

interface Props {
  /** Reason the panel is shown — changes the copy. */
  standalone: boolean
  note?: string
}

/**
 * "Open on your phone" panel.
 *
 * Renders a QR code of the current URL entirely client-side (no third-party QR
 * service, so it works on a locked-down network), plus an install button when
 * the browser offers one.
 */
export function PhonePanel({ standalone, note }: Props) {
  const [installable, setInstallable] = useState(() => installState())
  const [copied, setCopied] = useState(false)

  useEffect(() => onInstallStateChange(() => setInstallable(installState())), [])

  const url = typeof window === 'undefined' ? '' : window.location.href.split('#')[0]

  const svg = useMemo(() => {
    if (!url) return ''
    try {
      const qr = qrcode(0, 'M')
      qr.addData(url)
      qr.make()
      return qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true })
    } catch {
      return ''
    }
  }, [url])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="phone-panel panel">
      <div className="panel__head">
        <h2>Open on your phone</h2>
        <span className="panel__meta">scan · install · share</span>
      </div>

      <div className="phone-panel__body">
        <div className="qr">
          {svg ? (
            <div className="qr__code" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="qr__code qr__code--fallback">QR unavailable</div>
          )}
          <span className="qr__caption">Point your phone camera here</span>
        </div>

        <div className="phone-panel__copy">
          <p>
            {standalone
              ? 'This build scans the exchanges directly from your browser — no server needed. Open it on your phone and add it to the home screen.'
              : 'The dashboard and API are served from this address. Open it on your phone to follow the market on the go.'}
          </p>
          <div className="link-row">
            <code className="link-row__url" title={url}>
              {url}
            </code>
            <button type="button" className="ghost-button" onClick={copy}>
              {copied ? '✓ copied' : 'copy link'}
            </button>
          </div>
          {installable.installed ? (
            <p className="hint">Already running as an installed app. 👌</p>
          ) : installable.available ? (
            <button
              type="button"
              className="primary-button"
              onClick={async () => {
                const result = await installable.prompt?.()
                if (result === 'accepted') setInstallable(installState())
              }}
            >
              ⬇ Install app
            </button>
          ) : (
            <p className="hint">
              <strong>iPhone:</strong> Share → <em>Add to Home Screen</em>. <strong>Android:</strong> ⋮ menu →
              <em> Install app</em>.
            </p>
          )}
          {note ? <p className="hint">{note}</p> : null}
          <ul className="phone-panel__facts">
            {standalone ? (
              <>
                <li>Runs the same fee- and slippage-adjusted maths as the backend engine.</li>
                <li>Live venue APIs straight from the phone; simulated feed when they are blocked.</li>
                <li>Installable (PWA) with offline shell — works over Wi-Fi or mobile data.</li>
              </>
            ) : (
              <>
                <li>Live quotes streamed from the API over WebSocket.</li>
                <li>Same address on laptop and phone — no app store needed.</li>
                <li>Installable (PWA) with offline shell.</li>
              </>
            )}
          </ul>
        </div>
      </div>
    </section>
  )
}
