# ArbiBot Web

A cross-exchange crypto arbitrage scanner: a Python/FastAPI engine that polls public
exchange APIs, prices every route *after* taker fees and a slippage buffer, and a React
dashboard that streams the results over a WebSocket.

No API keys, no accounts, no trading — it is a read-only market scanner that tells you
where the same asset is quoted differently across venues.

```
backend/    FastAPI engine, exchange adapters, arbitrage maths, tests
frontend/   React + TypeScript + Vite dashboard (dark trading-desk UI, installable PWA)
docs/       Deployment guide (phone access, static hosting, containers)
```

## What it does

* **Cross-venue edges** — for every watched market it finds the venue with the cheapest
  ask and the venue with the richest bid, then nets out both taker fees and your slippage
  buffer to report the true spread and the expected P&L for a configurable trade size.
* **Triangular cycles** — walks every ≤3-leg path that starts and ends in the quote
  currency (e.g. `USDT → ETH → BTC → USDT`) inside a single venue, with fees folded into
  each edge, and reports only cycles that clear costs.
* **Depth awareness** — where venues publish top-of-book sizes, the engine caps the
  reported size and flags the row as `depth capped` instead of pretending the whole
  notional is executable.
* **Live venue health** — latency, pair count, last update, and the exact error for any
  venue that is refusing to answer.
* **Streaming UI** — one WebSocket snapshot per poll cycle (falling back to REST polling
  automatically), sortable tables, sparklines, and a detail drawer with the full cost
  breakdown per route.

### Venues supported

Binance · OKX · Bybit · KuCoin · Gate.io · MEXC · Bitget · HTX · Kraken · Coinbase

All via public, keyless REST endpoints. Kraken's `XBT`/`ZUSD` asset codes are resolved
through its `AssetPairs` metadata, and Coinbase's per-product endpoint is polled
concurrently.

## Quick start

Requires Python 3.10+ and Node 22+ (the dashboard tooling targets Node 22 LTS).

```bash
# 1. Backend
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# 2. Dashboard (build once; FastAPI then serves it at http://localhost:8000)
cd frontend && npm install && npm run build && cd ..

# 3. Run
cd backend && ../.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open <http://localhost:8000>. Or use the `Makefile`:

```bash
make setup      # venv + pip + npm
make backend    # API on :8000 (serves the built dashboard)
make frontend   # Vite dev server on :5173 with /api and /ws proxied to :8000
make test       # backend test suite
```

## Use it on your phone

The dashboard is an installable PWA and ships **two interchangeable engines**:

* **Backend engine** (Python/FastAPI) — one host polls the exchanges and streams every client.
* **On-device engine** (TypeScript port, `frontend/src/engine/`) — the browser polls the ten
  public exchange APIs itself and runs the identical fee/slippage maths. This is what makes a
  serverless, phone-only deployment possible.

The same build picks the right one automatically: if `/api/health` answers like an ArbiBot API it
uses the backend and its WebSocket stream, otherwise it runs the scanner in the browser. Override
it with `backendUrl` in [`frontend/public/config.js`](frontend/public/config.js)
(`''` = auto-detect, `null` = always local, or an absolute API URL).

**Fastest route to a phone-ready URL** — the built dashboard is committed in
[`docs/`](docs), so a static host needs no build step:

* **GitHub Pages:** Settings → Pages → Source: *Deploy from a branch* → `main` /
  `/docs` → live at `https://<user>.github.io/<repo>/`.
* **Netlify / Vercel / Cloudflare Pages:** publish `docs/` (or build
  `frontend/` yourself with `npm run build`). `vercel.json` is included.
* The page detects a static host (no same-origin `/api`) and runs the scanner in
  the browser, so it works with no backend at all.

```bash
make site     # rebuild docs/ after changing frontend/
```

Or run everything in one container:

```bash
docker compose up --build         # http://localhost:8000 (also reachable from your LAN)
```

Header button **▣ phone** shows a QR code of the current URL (rendered client-side, so it works
on locked-down networks) plus an *Install app* button. On iOS use Share → *Add to Home Screen*;
on Android use the ⋮ menu → *Install app*. Installing needs HTTPS — every option above provides
it, and a plain LAN IP still works as a normal web page.

Full walkthrough (static hosting, single container, split deployment, CORS notes, env reference):
**[docs/DEPLOY.md](docs/DEPLOY.md)**.

### Development with hot reload

Run `make backend` and `make frontend` in two shells and open <http://localhost:5173>.
Vite proxies `/api` and `/ws` to the API, so the dashboard always talks to the same origin.

### Docker

```bash
docker compose up --build      # http://localhost:8000
```

The image builds the dashboard with Node in one stage and serves the API plus the static
bundle from a slim Python image.

## Data modes

| `ARBIBOT_DATA_MODE` | Behaviour |
| --- | --- |
| `auto` *(default)* | Polls the live APIs. If fewer than two venues respond — a locked-down host, a corporate egress proxy, an offline demo — it transparently switches to the seeded simulator and keeps re-probing every 45 cycles. |
| `live` | Live APIs only. Unreachable venues are reported as `offline`, and the tables stay empty rather than showing invented numbers. |
| `sim` | Deterministic simulated feed: seeded price walks, per-venue basis and spreads, plus short-lived 25–110 bps dislocations so the scanner has something realistic to find. |

The dashboard always shows which mode is active and why. In `auto` mode the simulated
fallback is labelled in the header and explained in a banner, so simulated data is never
mistaken for real quotes.

## Configuration

Everything is optional environment variables (prefix `ARBIBOT_`) — see
[`.env.example`](.env.example). Highlights:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ARBIBOT_SYMBOLS` | `BTC,ETH,SOL,…` | Base assets to compare across venues |
| `ARBIBOT_POLL_INTERVAL` | `4` | Seconds between market polls |
| `ARBIBOT_NOTIONAL_USD` | `10000` | Trade size used for the profit estimate |
| `ARBIBOT_MIN_NET_SPREAD_PCT` | `0.02` | Rows below this net edge are hidden |
| `ARBIBOT_SLIPPAGE_BUFFER_PCT` | `0.02` | Flat buffer for queue position / partial fills |
| `ARBIBOT_TAKER_FEES` | per-venue defaults | Assumed taker fee per venue, in percent |
| `ARBIBOT_DISABLED_EXCHANGES` | – | Venues to skip entirely |

Settings can also be changed while the app is running: the *Scanner settings* panel patches
`PATCH /api/config`, and the engine re-scans immediately with the new economics.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness, version, active data mode and reason |
| `GET /api/snapshot` | Full engine snapshot (opportunities, triangles, markets, venues, stats) |
| `GET /api/opportunities?limit=&symbol=&min_net_spread_pct=` | Cross-venue edges |
| `GET /api/triangles` | Triangular cycles |
| `GET /api/markets` | Per-symbol aggregates plus the per-venue ladder |
| `GET /api/exchanges` | Venue health, fees and upstream docs links |
| `GET /api/history/{base}` | Rolling series for sparklines (price + best net edge) |
| `GET /api/edge-history?edge_id=` | Rolling net-edge series for one route |
| `GET/PATCH /api/config` | Read or change runtime settings |
| `POST /api/refresh` | Force one collection cycle |
| `WS /ws` | Snapshot per cycle (send `"ping"` for a `{"type":"pong"}` keepalive) |

Interactive docs are at `/docs`.

## How the numbers are computed

For each market and each ordered pair of venues:

```
gross_pct = (sell_bid - buy_ask) / buy_ask * 100
net_pct   = gross_pct - buy_fee_pct - sell_fee_pct - slippage_buffer_pct
qty       = min(notional / buy_ask, buy_ask_qty, sell_bid_qty)     # depth capped when published
profit    = qty * sell_bid * (1 - sell_fee) - qty * buy_ask * (1 + buy_fee)
            - slippage_buffer * executable_notional
```

Triangular cycles multiply fee-adjusted edge rates (`buy: (1/ask)(1-f)`, `sell: bid(1-f)`)
around the cycle; a product above 1.0 is a net-of-fee profit.

Everything is computed from top-of-book quotes, so an edge is an *indication*, not an
executable trade: real fills depend on depth, latency, transfer times between venues and
withdrawal limits. Nothing in this project is trading advice.

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest    # 49 backend tests
cd frontend && npm test                        # 25 frontend tests (vitest)
```

Backend coverage: symbol normalisation across every venue spelling, arbitrage maths
(fees, slippage, depth caps, staleness, quote-currency filtering), triangular cycle
detection and rejection, adapter parsing against recorded payload shapes with
`httpx.MockTransport`, hub behaviour (live collection, auto-fallback, runtime
reconfiguration) and the full REST/WebSocket API contract.

Frontend coverage: the browser engine's arbitrage maths and triangular scans, seeded
simulator determinism and realism, symbol parsing, the backend-vs-on-device data-source
detection (static host and offline cases), plus two jsdom end-to-end tests that mount the
whole dashboard against a static host and assert it scans on-device and renders the QR
phone panel.

## Project layout

```
backend/app/
  config.py            settings (env-driven, zero-config defaults)
  models.py            pydantic models shared by the engine and the API
  main.py              FastAPI app, REST + WebSocket, static dashboard mount
  exchanges/           one adapter per venue + symbol normalisation
  engine/
    arbitrage.py       pure scan maths (directional + triangular)
    hub.py             polling loop, mode selection, history, fan-out
    simulator.py       seeded offline feed
backend/tests/         pytest suite
frontend/src/
  App.tsx              dashboard shell, filters, tabs, phone panel
  components/          tables, venue panel, settings, detail drawer, sparkline, QR panel
  engine/              browser engine: adapters, arbitrage maths, seeded simulator
  data/                settings + client (backend | on-device) and the local engine
  api.ts               stream hook: WebSocket when a backend exists, on-device otherwise
frontend/public/       config.js, manifest, service worker, icons, offline page
```

## License

MIT — see [LICENSE](LICENSE).
