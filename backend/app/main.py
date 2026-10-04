"""FastAPI application for ArbiBot Web.

Serves three things from one process:

* the JSON REST API (``/api/*``),
* a WebSocket stream of engine snapshots (``/ws``),
* the built React dashboard (``frontend/dist``) when it exists.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import Body, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import ALL_EXCHANGES, DEFAULT_TAKER_FEES, get_settings
from .engine import MarketHub
from .exchanges import adapter_metadata
from .models import MarketUpdate, RuntimeConfig, RuntimeConfigPatch

log = logging.getLogger("arbibot.api")

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


def create_app(hub: MarketHub | None = None) -> FastAPI:
    settings = get_settings()
    market_hub = hub or MarketHub(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await market_hub.start()
        log.info("ArbiBot Web %s ready", settings.version)
        try:
            yield
        finally:
            await market_hub.stop()

    app = FastAPI(
        title=settings.app_name,
        version=settings.version,
        description=(
            "Cross-exchange crypto arbitrage scanner. Compares top-of-book "
            "prices across public exchange APIs, nets out taker fees and a "
            "slippage buffer, and streams live opportunities to the dashboard."
        ),
        lifespan=lifespan,
    )
    app.state.hub = market_hub
    app.state.settings = settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins or ["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ------------------------------------------------------------------ meta
    @app.get("/api/health", tags=["meta"])
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "app": settings.app_name,
            "version": settings.version,
            "data_mode": market_hub.effective_mode,
            "reason": market_hub.mode_reason,
            "cycle": market_hub.cycle,
            "uptime_s": round(market_hub.stats()["uptime_s"], 1),
        }

    @app.get("/api/config", response_model=RuntimeConfig, tags=["meta"])
    async def get_config() -> RuntimeConfig:
        return market_hub.runtime_config()

    @app.patch("/api/config", response_model=RuntimeConfig, tags=["meta"])
    async def patch_config(patch: RuntimeConfigPatch = Body(...)) -> RuntimeConfig:
        return await market_hub.apply_patch(patch)

    @app.get("/api/exchanges", tags=["meta"])
    async def list_exchanges() -> dict[str, Any]:
        supported = {entry["id"]: entry for entry in adapter_metadata()}
        rows: list[dict[str, Any]] = []
        for status in market_hub.statuses.values():
            row = status.model_dump()
            row["docs"] = supported.get(status.id, {}).get("docs", row.get("docs", ""))
            row["default_fee_pct"] = DEFAULT_TAKER_FEES.get(status.id, 0.10)
            rows.append(row)
        return {"count": len(rows), "exchanges": rows}

    # ------------------------------------------------------------- market data
    @app.get("/api/snapshot", response_model=MarketUpdate, tags=["market"])
    async def snapshot() -> MarketUpdate:
        return market_hub.snapshot()

    @app.get("/api/opportunities", tags=["market"])
    async def opportunities(
        limit: int = Query(default=50, ge=1, le=500),
        symbol: str | None = Query(default=None),
        min_net_spread_pct: float | None = Query(default=None),
    ) -> dict[str, Any]:
        rows = market_hub.opportunities
        if symbol:
            wanted = symbol.upper().split("/")[0]
            rows = [row for row in rows if row.base == wanted]
        if min_net_spread_pct is not None:
            rows = [row for row in rows if row.net_spread_pct >= min_net_spread_pct]
        return {"count": len(rows), "opportunities": [row.model_dump() for row in rows[:limit]]}

    @app.get("/api/triangles", tags=["market"])
    async def triangles(limit: int = Query(default=25, ge=1, le=200)) -> dict[str, Any]:
        rows = market_hub.triangles[:limit]
        return {"count": len(rows), "triangles": [row.model_dump() for row in rows]}

    @app.get("/api/markets", tags=["market"])
    async def markets() -> dict[str, Any]:
        return {"count": len(market_hub.markets), "markets": [m.model_dump() for m in market_hub.markets]}

    @app.get("/api/history/{symbol}", tags=["market"])
    async def history(symbol: str) -> dict[str, Any]:
        base = symbol.upper().split("/")[0]
        points = market_hub.history_for(base)
        if not points:
            raise HTTPException(status_code=404, detail=f"no history for {base} yet")
        return {"symbol": base, "points": points}

    @app.get("/api/edge-history", tags=["market"])
    async def edge_history(
        edge_id: str = Query(..., description="Opportunity id, e.g. BTC/USDT:binance->kraken"),
    ) -> dict[str, Any]:
        return {"edge_id": edge_id, "points": market_hub.edge_history_for(edge_id)}

    @app.post("/api/refresh", tags=["market"])
    async def refresh() -> MarketUpdate:
        return await market_hub.refresh()

    # --------------------------------------------------------------- streaming
    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        queue = market_hub.subscribe()
        try:
            while True:
                getter = asyncio.create_task(queue.get())
                receiver = asyncio.create_task(websocket.receive_text())
                done, pending = await asyncio.wait(
                    {getter, receiver}, return_when=asyncio.FIRST_COMPLETED
                )
                for task in pending:
                    task.cancel()
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await task
                if receiver in done:
                    message = receiver.result()
                    if message.strip() in ('"ping"', "ping", '{"type":"ping"}'):
                        await websocket.send_text('{"type":"pong"}')
                        continue
                if getter in done:
                    update = getter.result()
                    await websocket.send_text(update.model_dump_json())
        except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
            pass
        finally:
            market_hub.unsubscribe(queue)

    # ------------------------------------------------------------- static app
    @app.get("/api", include_in_schema=False)
    async def api_index() -> JSONResponse:
        return JSONResponse(
            {
                "name": settings.app_name,
                "version": settings.version,
                "docs": "/docs",
                "endpoints": [
                    "/api/health",
                    "/api/config",
                    "/api/snapshot",
                    "/api/opportunities",
                    "/api/triangles",
                    "/api/markets",
                    "/api/exchanges",
                    "/api/history/{symbol}",
                    "/ws",
                ],
            }
        )

    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="dashboard")
    else:

        @app.get("/", include_in_schema=False)
        async def dashboard_not_built() -> HTMLResponse:
            """Friendly placeholder until `npm run build` has produced the UI."""
            return HTMLResponse(
                f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{settings.app_name} — dashboard not built yet</title>
    <style>
      body {{ background:#080b12; color:#e9edf8; font-family:system-ui,sans-serif;
             display:grid; place-items:center; min-height:100vh; margin:0 }}
      main {{ max-width:640px; padding:32px; border:1px solid #1f2947; border-radius:14px;
              background:#0d1220; line-height:1.6 }}
      h1 {{ font-size:20px; margin:0 0 8px }} code {{ background:#151d38; padding:2px 6px;
              border-radius:6px; font-size:13px }} a {{ color:#5b8cff }}
      p {{ color:#9aa6c4; font-size:14px }}
    </style>
  </head>
  <body>
    <main>
      <h1>The API is running — the dashboard has not been built yet</h1>
      <p>Build it once and reload this page:</p>
      <p><code>cd frontend &amp;&amp; npm install &amp;&amp; npm run build</code></p>
      <p>
        During development you can also run <code>npm run dev</code> for a hot-reloading
        dashboard on <a href="http://localhost:5173">localhost:5173</a>.
      </p>
      <p>
        API: <a href="/docs">/docs</a> ·
        <a href="/api/health">/api/health</a> ·
        <a href="/api/snapshot">/api/snapshot</a> ·
        <a href="/api/opportunities">/api/opportunities</a> ·
        WebSocket <code>/ws</code>
      </p>
    </main>
  </body>
</html>"""
            )

    return app


app = create_app()


def main() -> None:  # pragma: no cover - CLI entry point
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
        log_config=None,
    )
    _ = settings


if __name__ == "__main__":  # pragma: no cover
    main()
