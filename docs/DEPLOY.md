# Putting ArbiBot Web on your phone

The dashboard is a PWA: it installs to the home screen, works on any modern phone browser, and
needs no app store, no API keys and (optionally) no server of your own.

There are three ways to get a URL you can open on a phone, from easiest to most capable.

---

## 1. Static hosting — no backend at all (2 minutes)

The dashboard ships a **complete scanner in the browser**: it calls the ten public exchange
APIs directly from the phone and runs the same fee/slippage maths as the Python engine. The only
caveat is CORS — venues that refuse browser requests (Binance does) show up as `offline` in the
venue panel, while the rest report normally.

**GitHub Pages (free HTTPS URL)**

1. Push this repository to GitHub.
2. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Run the **“Deploy dashboard to GitHub Pages”** workflow (it also runs on every push to `main`).
4. Open `https://<your-user>.github.io/<repo>/` on your phone.

**Netlify / Cloudflare Pages / Vercel**

| Setting | Value |
| --- | --- |
| Build command | `cd frontend && npm install && npm run build` |
| Publish directory | `frontend/dist` |
| Node version | 20 |

`vercel.json` is already included with the right command, output directory and cache headers.

**Tune the deployment** by editing `frontend/public/config.js` before building (or the copy in
`dist/config.js` after):

```js
window.__ARBIBOT_CONFIG__ = {
  backendUrl: null,        // no server: run the scanner in the browser
  symbols: ['BTC', 'ETH', 'SOL', 'XRP'],
  pollInterval: 5,
  corsProxy: '',           // e.g. 'https://corsproxy.io/?url=' to include Binance
}
```

---

## 2. One container, everything included (5 minutes)

`Dockerfile` builds the dashboard and serves it together with the API, so the phone gets live
WebSocket streaming *and* the full Python engine.

```bash
docker compose up --build          # http://localhost:8000
```

Deploy that image anywhere that runs containers:

- **Render** — `render.yaml` is included; Render → **New → Blueprint** → pick the repo.
- **Railway / Fly.io / a VPS** — use the same `Dockerfile`; expose port `8000`.
- **Home server / Raspberry Pi** — `docker compose up -d`, then open
  `http://<your-lan-ip>:8000` from a phone on the same Wi-Fi.

With the default `ARBIBOT_DATA_MODE=auto` the container uses the live exchange APIs and falls
back to the simulator if the host cannot reach them.

---

## 3. Split deployment — static dashboard + API host

Best when you want the API to do the polling (one IP hitting the exchanges instead of every
phone), while the UI is served from a CDN.

1. Deploy the backend (Render/Railway/Fly/VPS): `Dockerfile`, port `8000`, health `/api/health`.
2. Point the dashboard at it:

   ```js
   // frontend/public/config.js
   window.__ARBIBOT_CONFIG__ = { backendUrl: 'https://arbibot-api.onrender.com' }
   ```

3. Build and publish `frontend/dist` to your static host.
4. If the static host is a different origin, allow it on the API:

   ```
   ARBIBOT_CORS_ORIGINS=https://your-dashboard.example
   ```

The dashboard automatically uses the WebSocket stream when a backend is reachable and the
on-device engine when it is not (`backendUrl: ''`, the default, means *auto-detect*).

---

## Installing on the phone

- **iPhone (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** ⋮ menu → *Install app* (or the in-app **▣ phone** panel → *Install app*).

Installed, it opens full-screen without browser chrome, caches its shell for offline use, and
the **▣ phone** button in the header shows a QR code of the current URL so a second device can
join in one scan.

> The service worker (and therefore the install prompt) requires HTTPS or `localhost`. All of
> the options above give you HTTPS; a plain `http://192.168.x.x` LAN address still works as a
> normal web page, it just cannot be installed.

---

## Environment reference

| Variable | Default | Notes |
| --- | --- | --- |
| `ARBIBOT_DATA_MODE` | `auto` | `live` for real quotes only, `sim` for the demo feed |
| `ARBIBOT_POLL_INTERVAL` | `4` | Seconds between polls; phones are happy with 5–10 |
| `ARBIBOT_SYMBOLS` | 12 majors | Fewer symbols = fewer requests = less data on mobile |
| `ARBIBOT_NOTIONAL_USD` | `10000` | Trade size used for the profit estimate |
| `ARBIBOT_CORS_ORIGINS` | `*` | Restrict to your dashboard origin in production |
