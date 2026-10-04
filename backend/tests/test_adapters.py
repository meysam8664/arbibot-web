"""Venue adapter parsing, exercised against recorded payload shapes."""

from __future__ import annotations

import httpx
import pytest

from app.exchanges.registry import build_adapters

BINANCE = [
    {"symbol": "BTCUSDT", "bidPrice": "68400.10", "bidQty": "3.5", "askPrice": "68401.10", "askQty": "2.1"},
    {"symbol": "ETHBTC", "bidPrice": "0.046", "bidQty": "12", "askPrice": "0.0461", "askQty": "9"},
    {"symbol": "ETHUSDT", "bidPrice": "3149.5", "bidQty": "40", "askPrice": "3149.9", "askQty": "38"},
]
OKX = {
    "code": "0",
    "data": [
        {"instId": "BTC-USDT", "bidPx": "68400", "askPx": "68402", "bidSz": "1.2", "askSz": "0.9"},
        {"instId": "BTC-USDC", "bidPx": "68400", "askPx": "68402", "bidSz": "1", "askSz": "1"},
    ],
}
BYBIT = {
    "retCode": 0,
    "result": {
        "list": [
            {"symbol": "BTCUSDT", "bid1Price": "68399", "bid1Size": "2", "ask1Price": "68401", "ask1Size": "1.5"}
        ]
    },
}
KUCOIN = {
    "code": "200000",
    "data": {
        "ticker": [
            {"symbol": "BTC-USDT", "buy": "68390", "sell": "68400", "buySize": "0.4", "sellSize": "0.7"}
        ]
    },
}
GATEIO = [
    {
        "currency_pair": "BTC_USDT",
        "highest_bid": "68395",
        "lowest_ask": "68405",
        "highest_size": "1.1",
        "lowest_size": "1.3",
    }
]
MEXC = [{"symbol": "BTCUSDT", "bidPrice": "68380", "bidQty": "1", "askPrice": "68410", "askQty": "2"}]
BITGET = {
    "code": "00000",
    "data": [
        {"symbol": "BTCUSDT", "bidPr": "68370", "askPr": "68420", "bidSz": "0.5", "askSz": "0.6"}
    ],
}
HTX = {"status": "ok", "data": [{"symbol": "btcusdt", "bid": 68300.0, "ask": 68450.0}]}
KRAKEN_PAIRS = {
    "error": [],
    "result": {
        "XXBTZUSD": {"altname": "XBTUSD", "wsname": "XBT/USD"},
        "XBTUSDT": {"altname": "XBTUSDT", "wsname": "XBT/USDT"},
        "ETHUSDT": {"altname": "ETHUSDT", "wsname": "ETH/USDT"},
    },
}
KRAKEN_TICKER = {
    "error": [],
    "result": {
        "XBTUSDT": {"b": ["68300.0", "1", "1"], "a": ["68450.0", "2", "2"]},
        "ETHUSDT": {"b": ["3140.0", "10", "10"], "a": ["3145.0", "10", "10"]},
    },
}
COINBASE_BTC = {
    "bid": "68250.00",
    "ask": "68400.00",
    "bid_size": "0.8",
    "ask_size": "1.0",
    "price": "68300.00",
}

ROUTES: dict[str, object] = {
    "api.binance.com": BINANCE,
    "www.okx.com": OKX,
    "api.bybit.com": BYBIT,
    "api.kucoin.com": KUCOIN,
    "api.gateio.ws": GATEIO,
    "api.mexc.com": MEXC,
    "api.bitget.com": BITGET,
    "api.huobi.pro": HTX,
}


def handler(request: httpx.Request) -> httpx.Response:
    host = request.url.host
    if host == "api.kraken.com":
        body = KRAKEN_PAIRS if "AssetPairs" in request.url.path else KRAKEN_TICKER
        return httpx.Response(200, json=body)
    if host == "api.exchange.coinbase.com":
        # Coinbase is per-product: only BTC-USDT exists in this fixture set.
        if "products/BTC-USDT" in request.url.path:
            return httpx.Response(200, json=COINBASE_BTC)
        return httpx.Response(404, json={"message": "NotFound"})
    if host in ROUTES:
        return httpx.Response(200, json=ROUTES[host])
    return httpx.Response(404, json={"error": "not found"})


@pytest.fixture
def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "venue,expected_bid,expected_ask",
    [
        ("binance", 68400.10, 68401.10),
        ("okx", 68400.0, 68402.0),
        ("bybit", 68399.0, 68401.0),
        ("kucoin", 68390.0, 68400.0),
        ("gateio", 68395.0, 68405.0),
        ("mexc", 68380.0, 68410.0),
        ("bitget", 68370.0, 68420.0),
        ("htx", 68300.0, 68450.0),
        ("kraken", 68300.0, 68450.0),
        ("coinbase", 68250.0, 68400.0),
    ],
)
async def test_adapter_parses_usdt_quotes(client, venue, expected_bid, expected_ask):
    adapters = build_adapters("USDT")
    quotes = await adapters[venue].fetch_quotes(client, {"BTC", "ETH"})
    assert quotes, f"{venue} returned no quotes"
    btc = [q for q in quotes if q.base == "BTC" and q.quote == "USDT"]
    assert btc, f"{venue} did not return BTC/USDT"
    assert btc[0].bid == pytest.approx(expected_bid)
    assert btc[0].ask == pytest.approx(expected_ask)
    assert btc[0].exchange == venue


@pytest.mark.asyncio
async def test_binance_keeps_cross_pairs_for_triangles(client):
    adapters = build_adapters("USDT")
    quotes = await adapters["binance"].fetch_quotes(client, {"BTC", "ETH"})
    symbols = {q.symbol for q in quotes}
    assert "BTC/USDT" in symbols
    assert "ETH/BTC" in symbols  # needed by the triangular scanner


@pytest.mark.asyncio
async def test_binance_drops_pairs_outside_the_watch_list(client):
    adapters = build_adapters("USDT")
    quotes = await adapters["binance"].fetch_quotes(client, {"BTC"})
    assert {q.base for q in quotes} == {"BTC"}


@pytest.mark.asyncio
async def test_okx_filters_other_quote_assets_for_directional_scan(client):
    adapters = build_adapters("USDT")
    quotes = await adapters["okx"].fetch_quotes(client, {"BTC"})
    assert all(q.quote in {"USDT", "USDC"} for q in quotes)
