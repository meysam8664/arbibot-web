"""Simulated feed: determinism, sanity and arbitrage visibility."""

from __future__ import annotations

from app.engine.arbitrage import scan_directional, scan_triangular
from app.engine.simulator import VENUE_PROFILES, MarketSimulator


def build(seed: int = 42, symbols=("BTC", "ETH", "SOL")) -> MarketSimulator:
    return MarketSimulator(list(VENUE_PROFILES), list(symbols), seed=seed)


def test_same_seed_produces_identical_quotes():
    a, b = build(), build()
    for _ in range(5):
        first = a.quotes()
        second = b.quotes()
    assert [(q.exchange, q.symbol, q.bid, q.ask) for q in first] == [
        (q.exchange, q.symbol, q.bid, q.ask) for q in second
    ]


def test_different_seeds_diverge():
    a, b = build(seed=1), build(seed=2)
    for _ in range(3):
        a.quotes()
        b.quotes()
    assert [q.bid for q in a.quotes()] != [q.bid for q in b.quotes()]


def test_simulated_book_is_sane():
    sim = build()
    for quote in sim.quotes():
        assert 0 < quote.bid < quote.ask
        assert quote.bid_qty > 0 and quote.ask_qty > 0
        assert quote.spread_pct < 1.0  # a believable top-of-book spread


def test_every_venue_quotes_every_symbol():
    sim = build()
    quotes = sim.quotes()
    for venue in VENUE_PROFILES:
        for symbol in ("BTC/USDT", "ETH/USDT", "SOL/USDT"):
            assert any(q.exchange == venue and q.symbol == symbol for q in quotes)


def test_simulated_feed_eventually_creates_opportunities():
    """Cross-venue edges should appear within a couple of minutes of ticks."""
    sim = build(seed=7)
    seen = 0
    for _ in range(120):  # 120 ticks ~ 8 minutes at a 4s poll
        quotes = sim.quotes()
        seen += len(
            scan_directional(
                quotes,
                notional_usd=10_000,
                fee_lookup=lambda _e: 0.10,
                slippage_pct=0.02,
                min_net_spread_pct=0.02,
                max_results=50,
                max_quote_age=3600,
            )
        )
    assert seen > 0


def test_simulated_feed_can_create_triangular_edges():
    sim = build(seed=11, symbols=("BTC", "ETH", "XRP"))
    hits = 0
    for _ in range(160):
        quotes = sim.quotes()
        hits += len(
            scan_triangular(
                quotes,
                notional_usd=10_000,
                fee_lookup=lambda _e: 0.10,
                min_net_spread_pct=0.05,
                quote_currency="USDT",
                max_age=3600,
            )
        )
    assert hits > 0
