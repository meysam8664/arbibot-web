"""Market hub behaviour: live collection, auto-fallback, runtime reconfiguration."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.config import Settings
from app.engine import MarketHub
from app.models import RuntimeConfigPatch

from .test_adapters import handler as live_handler


def failing_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("network unreachable", request=request)

    return httpx.MockTransport(handler)


def settings(**overrides) -> Settings:
    base = {
        "symbols": ["BTC", "ETH"],
        "poll_interval": 1.0,
        "data_mode": "auto",
        "http_timeout": 1.0,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_auto_mode_falls_back_to_the_simulator_when_apis_are_unreachable():
    hub = MarketHub(settings(), client=httpx.AsyncClient(transport=failing_transport()))
    await hub.refresh()
    assert hub.effective_mode == "sim"
    assert "unreachable" in hub.mode_reason
    assert hub.markets, "simulated feed should still populate the market table"
    assert all(status.status == "offline" or status.simulated for status in hub.statuses.values())
    await hub._client.aclose()  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_live_mode_stays_live_and_reports_offline_venues():
    hub = MarketHub(settings(data_mode="live"), client=httpx.AsyncClient(transport=failing_transport()))
    await hub.refresh()
    assert hub.effective_mode == "live"
    assert hub.markets == []
    # Coinbase degrades (per-product requests) instead of raising, so allow both.
    assert {s.status for s in hub.statuses.values()} <= {"offline", "degraded"}
    assert all(s.error for s in hub.statuses.values())
    await hub._client.aclose()  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_auto_mode_uses_live_data_when_venues_respond():
    hub = MarketHub(settings(), client=httpx.AsyncClient(transport=httpx.MockTransport(live_handler)))
    await hub.refresh()
    assert hub.effective_mode == "live"
    online = {s.id for s in hub.statuses.values() if s.status == "online"}
    assert {"binance", "kraken", "okx"} <= online
    assert hub.quotes, "live quotes should be cached"
    assert any(m.symbol == "BTC/USDT" for m in hub.markets)
    # Binance asks 68401.10 while Kraken bids 68300 -> no edge, but the scanner ran.
    assert hub.opportunities == []
    await hub._client.aclose()  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_runtime_config_patch_is_applied_and_can_trigger_a_refresh():
    hub = MarketHub(settings(), client=httpx.AsyncClient(transport=httpx.MockTransport(live_handler)))
    await hub.refresh()
    config = await hub.apply_patch(
        RuntimeConfigPatch(
            notional_usd=25_000,
            min_net_spread_pct=-0.5,
            slippage_buffer_pct=0.0,
            taker_fees={"binance": 0.02},
            disabled_exchanges=["coinbase"],
            data_mode="sim",
            refresh=True,
        )
    )
    assert config.notional_usd == 25_000
    assert config.min_net_spread_pct == -0.5
    assert config.taker_fees["binance"] == 0.02
    assert config.effective_mode == "sim"
    assert hub.statuses["coinbase"].status == "disabled"
    assert hub.statuses["coinbase"].enabled is False
    assert hub.markets, "refresh inside the patch should have populated markets"
    await hub._client.aclose()  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_symbol_change_rebuilds_the_simulator_and_drops_old_quotes():
    hub = MarketHub(settings(data_mode="sim"), client=httpx.AsyncClient(transport=failing_transport()))
    await hub.refresh()
    assert {m.base for m in hub.markets} == {"BTC", "ETH"}
    await hub.apply_patch(RuntimeConfigPatch(symbols=["sol"], refresh=True))
    assert hub.settings.symbols == ["SOL"]
    assert {m.base for m in hub.markets} == {"SOL"}
    await hub._client.aclose()  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_subscribers_receive_snapshots_and_history_is_recorded():
    hub = MarketHub(settings(data_mode="sim"), client=httpx.AsyncClient(transport=failing_transport()))
    queue = hub.subscribe()
    first = await queue.get()  # subscribe() seeds the queue with the current state
    assert first.type == "snapshot"

    await hub.start()  # the running loop publishes a fresh snapshot every cycle
    try:
        update = await asyncio.wait_for(queue.get(), timeout=5)
    finally:
        await hub.stop()
    assert update.markets
    history = hub.history_for("BTC")
    assert history and {"ts", "price", "net_spread_pct"} <= set(history[0])
    hub.unsubscribe(queue)
    assert hub.subscriber_count == 0
    if hub._client is not None:
        await hub._client.aclose()


@pytest.mark.asyncio
async def test_stats_reflect_engine_state():
    hub = MarketHub(settings(data_mode="sim"), client=httpx.AsyncClient(transport=failing_transport()))
    await hub.refresh()
    stats = hub.stats()
    assert stats["data_mode"] == "sim"
    assert stats["symbols"] == 2
    assert stats["exchanges_total"] == 10
    assert stats["quotes"] > 0
    await hub._client.aclose()  # type: ignore[union-attr]
