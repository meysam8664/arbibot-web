"""Unit tests for the arbitrage maths."""

from __future__ import annotations

import time

import pytest

from app.engine.arbitrage import directional_edge, scan_directional, scan_triangular
from app.models import Quote


def make_quote(exchange: str, *, bid: float, ask: float, bid_qty: float = 0.0, ask_qty: float = 0.0,
               base: str = "BTC", quote: str = "USDT", ts: float | None = None) -> Quote:
    return Quote(
        exchange=exchange,
        exchange_name=exchange.title(),
        symbol=f"{base}/{quote}",
        base=base,
        quote=quote,
        bid=bid,
        ask=ask,
        bid_qty=bid_qty,
        ask_qty=ask_qty,
        ts=ts if ts is not None else time.time(),
    )


def no_fees(_exchange: str) -> float:
    return 0.0


def ten_bps(_exchange: str) -> float:
    return 0.10


# --------------------------------------------------------------------- edge
def test_directional_edge_nets_out_fees_and_slippage():
    buy = make_quote("binance", bid=99.9, ask=100.0)
    sell = make_quote("kraken", bid=101.0, ask=101.1)
    opp = directional_edge(
        buy, sell, notional_usd=10_000, buy_fee_pct=0.10, sell_fee_pct=0.20, slippage_pct=0.02
    )
    assert opp.gross_spread_pct == pytest.approx(1.0, abs=1e-6)
    assert opp.total_fees_pct == pytest.approx(0.30, abs=1e-6)
    assert opp.net_spread_pct == pytest.approx(1.0 - 0.30 - 0.02, abs=1e-6)
    assert opp.qty == pytest.approx(100.0, abs=1e-9)
    # 100 units bought at 100.0, sold at 101.0, minus fees and slippage buffer.
    expected = 10100 - 10100 * 0.002 - 10000 - 10000 * 0.001 - 10000 * 0.0002
    assert opp.est_profit_usd == pytest.approx(expected, abs=1e-6)
    assert [leg.side for leg in opp.legs] == ["buy", "sell"]
    assert opp.depth_limited is False


def test_depth_limits_the_trade_size():
    buy = make_quote("binance", bid=99.9, ask=100.0, ask_qty=2.0)
    sell = make_quote("kraken", bid=101.0, ask=101.1, bid_qty=50.0)
    opp = directional_edge(
        buy, sell, notional_usd=10_000, buy_fee_pct=0.0, sell_fee_pct=0.0, slippage_pct=0.0
    )
    assert opp.qty == pytest.approx(2.0)
    assert opp.executable_notional_usd == pytest.approx(200.0)
    assert opp.depth_limited is True


def test_zero_fees_produce_positive_edge_in_both_directions():
    buy = make_quote("a", bid=99.0, ask=100.0)
    sell = make_quote("b", bid=100.0, ask=101.0)
    opp = directional_edge(
        buy, sell, notional_usd=1_000, buy_fee_pct=0.0, sell_fee_pct=0.0, slippage_pct=0.0
    )
    assert opp.est_profit_usd == pytest.approx(0.0, abs=1e-9)


# -------------------------------------------------------------------- scans
def test_scan_directional_picks_cheapest_ask_and_richest_bid():
    quotes = [
        make_quote("binance", bid=100.0, ask=100.1),
        make_quote("kraken", bid=101.5, ask=101.6),
        make_quote("okx", bid=100.8, ask=100.9),
    ]
    found = scan_directional(
        quotes,
        notional_usd=5_000,
        fee_lookup=no_fees,
        slippage_pct=0.0,
        min_net_spread_pct=0.0,
        max_results=10,
    )
    assert len(found) == 1
    assert found[0].buy_exchange == "binance"
    assert found[0].sell_exchange == "kraken"
    assert found[0].net_spread_pct == pytest.approx((101.5 - 100.1) / 100.1 * 100, abs=1e-4)


def test_scan_directional_respects_min_net_spread_and_fees():
    quotes = [
        make_quote("binance", bid=100.0, ask=100.0),
        make_quote("kraken", bid=100.1, ask=100.2),  # 10 bps gross
    ]
    found = scan_directional(
        quotes,
        notional_usd=5_000,
        fee_lookup=ten_bps,  # 20 bps of taker fees round-trip
        slippage_pct=0.0,
        min_net_spread_pct=0.0,
        max_results=10,
    )
    assert found == []


def test_scan_directional_skips_stale_and_single_venue_quotes():
    stale = make_quote("kraken", bid=200.0, ask=200.1, ts=time.time() - 600)
    quotes = [make_quote("binance", bid=100.0, ask=100.1), stale]
    found = scan_directional(
        quotes,
        notional_usd=5_000,
        fee_lookup=no_fees,
        slippage_pct=0.0,
        min_net_spread_pct=0.0,
        max_results=10,
        max_quote_age=60,
    )
    assert found == []


def test_scan_directional_ignores_other_quote_currencies():
    quotes = [
        make_quote("binance", bid=100.0, ask=100.1, quote="BTC"),
        make_quote("kraken", bid=101.0, ask=101.1, quote="BTC"),
        make_quote("binance", bid=100.0, ask=100.1, quote="USDT"),
    ]
    found = scan_directional(
        quotes,
        notional_usd=5_000,
        fee_lookup=no_fees,
        slippage_pct=0.0,
        min_net_spread_pct=0.0,
        max_results=10,
    )
    assert found == []


# --------------------------------------------------------------- triangular
def _triangle_quotes(eth_btc_ask: float) -> list[Quote]:
    return [
        make_quote("binance", base="BTC", bid=67_900, ask=68_000, quote="USDT",
                   bid_qty=5, ask_qty=5),
        make_quote("binance", base="ETH", bid=3_149, ask=3_150, quote="USDT",
                   bid_qty=50, ask_qty=50),
        make_quote("binance", base="ETH", bid=eth_btc_ask - 0.00001, ask=eth_btc_ask,
                   quote="BTC", bid_qty=50, ask_qty=50),
    ]


def test_triangular_cycle_detected_when_cross_rate_is_out_of_line():
    fair = 3_150 / 68_000
    cheap_cross = fair * 0.997  # 30 bps dislocation: ETH is cheap in BTC terms
    found = scan_triangular(
        _triangle_quotes(cheap_cross),
        notional_usd=10_000,
        fee_lookup=no_fees,
        min_net_spread_pct=0.05,
        quote_currency="USDT",
    )
    assert found, "expected a profitable USDT->ETH->BTC->USDT cycle"
    top = found[0]
    assert top.path[0] == "USDT" and top.path[-1] == "USDT"
    assert len(top.legs) == 3
    assert [leg.side for leg in top.legs] == ["buy", "buy", "sell"]


def test_triangular_cycle_rejected_when_fees_eat_the_edge():
    fair = 3_150 / 68_000
    cheap_cross = fair * 0.997
    found = scan_triangular(
        _triangle_quotes(cheap_cross),
        notional_usd=10_000,
        fee_lookup=lambda _e: 0.30,  # 90 bps of fees over three legs
        min_net_spread_pct=0.05,
        quote_currency="USDT",
    )
    assert found == []
