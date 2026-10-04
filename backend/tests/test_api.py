"""API contract tests against a simulated hub (no network required)."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.engine import MarketHub
from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    settings = Settings(
        data_mode="sim",
        symbols=["BTC", "ETH", "SOL"],
        poll_interval=1.0,
        min_net_spread_pct=-1.0,  # surface the best spreads regardless of sign
    )
    hub = MarketHub(settings, client=httpx.AsyncClient(timeout=2.0))
    app = create_app(hub=hub)
    with TestClient(app) as test_client:
        yield test_client
    # The hub owns no client here, so nothing leaks between tests.


def test_health(client: TestClient):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["data_mode"] in {"sim", "live", "probing"}


def test_config_round_trip(client: TestClient):
    config = client.get("/api/config").json()
    assert config["data_mode"] == "sim"
    assert config["quote_currency"] == "USDT"
    assert set(config["supported_exchanges"]) >= {"binance", "kraken"}

    patched = client.patch(
        "/api/config",
        json={"notional_usd": 50_000, "min_net_spread_pct": -0.2, "disabled_exchanges": ["htx"]},
    ).json()
    assert patched["notional_usd"] == 50_000
    assert patched["min_net_spread_pct"] == -0.2
    assert "htx" in patched["disabled_exchanges"]

    status = client.get("/api/exchanges").json()
    htx = next(row for row in status["exchanges"] if row["id"] == "htx")
    assert htx["status"] == "disabled"
    assert htx["enabled"] is False


def test_snapshot_contains_everything_the_dashboard_needs(client: TestClient):
    client.post("/api/refresh")
    snapshot = client.get("/api/snapshot").json()
    assert snapshot["type"] == "snapshot"
    assert snapshot["data_mode"] == "sim"
    assert len(snapshot["markets"]) == 3
    assert len(snapshot["exchanges"]) == 10
    for market in snapshot["markets"]:
        assert market["reference_price"] > 0
        assert market["venues"] >= 5
        assert market["quotes"], "each market should ship its per-venue books"
        quote = market["quotes"][0]
        assert {"exchange", "bid", "ask", "bid_qty", "ask_qty"} <= set(quote)
    stats = snapshot["stats"]
    assert stats["exchanges_online"] == 10
    assert stats["data_mode"] == "sim"
    assert stats["poll_interval"] == 1.0


def test_opportunity_rows_are_costed(client: TestClient):
    client.patch("/api/config", json={"min_net_spread_pct": -1.0, "refresh": True})
    body = client.get("/api/opportunities?limit=5").json()
    assert body["count"] >= 1
    row = body["opportunities"][0]
    assert row["buy_exchange"] != row["sell_exchange"]
    assert row["gross_spread_pct"] - row["total_fees_pct"] - 0.02 == pytest.approx(
        row["net_spread_pct"], abs=0.01
    )
    assert len(row["legs"]) == 2
    assert row["legs"][0]["side"] == "buy"
    assert row["legs"][1]["side"] == "sell"
    assert row["qty"] > 0


def test_history_endpoint(client: TestClient):
    client.post("/api/refresh")
    body = client.get("/api/history/btc").json()
    assert body["symbol"] == "BTC"
    assert body["points"]
    assert {"ts", "price", "net_spread_pct"} <= set(body["points"][-1])
    assert client.get("/api/history/ZZZ").status_code == 404


def test_markets_and_triangles_endpoints(client: TestClient):
    client.post("/api/refresh")
    markets = client.get("/api/markets").json()
    assert markets["count"] == 3
    assert markets["markets"][0]["max_net_spread_pct"] >= markets["markets"][-1]["max_net_spread_pct"]
    triangles = client.get("/api/triangles").json()
    assert isinstance(triangles["triangles"], list)


def test_refresh_endpoint_runs_a_cycle(client: TestClient):
    before = client.get("/api/health").json()["cycle"]
    client.post("/api/refresh")
    after = client.get("/api/health").json()["cycle"]
    assert after >= before


def test_websocket_streams_snapshots(client: TestClient):
    with client.websocket_connect("/ws") as websocket:
        payload = websocket.receive_json()
        assert payload["type"] == "snapshot"
        assert "markets" in payload
        websocket.send_text("ping")
        pong = websocket.receive_json()
        assert pong["type"] == "pong"
