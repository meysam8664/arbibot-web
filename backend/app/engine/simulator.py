"""Deterministic simulated market feed.

Used when the host running ArbiBot Web cannot reach the exchange REST APIs
(CI, locked-down containers, offline demos).  The feed is *seeded*, so the same
seed always produces the same sequence of prices — useful for screenshots,
tests and demos.

Realism notes
-------------
* every venue quotes the same underlying "true" price with its own, slowly
  mean-reverting basis (venue character) and its own half-spread,
* cross pairs (``ETH/BTC`` …) are *derived* from the true prices, so the three
  legs of a triangular cycle stay internally consistent and triangular edges
  only appear when a single pair genuinely gets knocked out of line,
* transient dislocations (20-90 bps, decaying over ~10 ticks) model the
  order-book imbalances that create real, short-lived arbitrage windows.
"""

from __future__ import annotations

import random

from ..exchanges.symbols import BASE_ALIASES
from ..models import Quote

#: Rough reference prices (USD).  Simulated venues walk around these.
REFERENCE_PRICES: dict[str, float] = {
    "BTC": 68_400.0,
    "ETH": 3_150.0,
    "SOL": 168.0,
    "XRP": 0.58,
    "BNB": 592.0,
    "DOGE": 0.163,
    "ADA": 0.47,
    "AVAX": 36.5,
    "LINK": 17.8,
    "TON": 7.1,
    "DOT": 6.9,
    "LTC": 84.0,
    "BCH": 430.0,
    "TRX": 0.128,
    "SHIB": 0.0000245,
    "POL": 0.72,
    "ATOM": 8.4,
    "NEAR": 5.6,
    "APT": 9.3,
    "ARB": 1.12,
}

#: Per-venue character: (basis in bps, half-spread in bps, depth in USD).
VENUE_PROFILES: dict[str, tuple[float, float, float]] = {
    "binance": (-1.5, 1.0, 250_000.0),
    "okx": (0.5, 1.2, 180_000.0),
    "bybit": (1.0, 1.4, 150_000.0),
    "kucoin": (3.0, 2.2, 90_000.0),
    "gateio": (-2.5, 2.6, 80_000.0),
    "mexc": (4.0, 2.0, 60_000.0),
    "bitget": (2.0, 1.8, 70_000.0),
    "htx": (-1.0, 3.0, 55_000.0),
    "kraken": (5.0, 3.5, 120_000.0),
    "coinbase": (6.0, 5.0, 100_000.0),
}

#: Venues that also quote the majors against BTC/ETH (used for triangles).
CROSS_QUOTE_VENUES = {"binance", "okx", "bybit", "kucoin", "gateio", "mexc", "bitget"}
CROSS_QUOTES = ("BTC", "ETH")

DISLOCATION_PROBABILITY = 0.45
DISLOCATION_DECAY = 0.88
DISLOCATION_MIN_BPS = 25.0
DISLOCATION_MAX_BPS = 110.0


class MarketSimulator:
    """Generates reproducible quotes for every enabled venue."""

    def __init__(
        self,
        venues: list[str],
        symbols: list[str],
        *,
        quote_currency: str = "USDT",
        seed: int = 1337,
        venue_names: dict[str, str] | None = None,
    ) -> None:
        self.venues = list(venues)
        self.symbols = [BASE_ALIASES.get(s.upper(), s.upper()) for s in symbols]
        self.quote_currency = quote_currency.upper()
        self.venue_names = dict(venue_names or simulated_venue_names(self.venues))
        self._rng = random.Random(seed)
        self._tick = 0

        #: "True" price per asset, common to all venues.
        self._true: dict[str, float] = {}
        #: Mean-reverting drift of the true price.
        self._drift: dict[str, float] = {}
        #: Venue basis vs. the true price (fraction).
        self._basis: dict[tuple[str, str], float] = {}
        #: Transient, decaying dislocations keyed by (venue, market key).
        self._dislocations: dict[tuple[str, str], float] = {}

        for base in self.symbols:
            reference = REFERENCE_PRICES.get(base, self._fallback_price(base))
            self._true[base] = reference
            self._drift[base] = 0.0
            for venue in self.venues:
                self._basis[(venue, base)] = self._character_bps(venue) / 10_000.0

    # ------------------------------------------------------------------ utils
    @staticmethod
    def _character_bps(venue: str) -> float:
        return VENUE_PROFILES.get(venue, (0.0, 2.0, 50_000.0))[0]

    @staticmethod
    def _half_spread_bps(venue: str) -> float:
        return VENUE_PROFILES.get(venue, (0.0, 2.0, 50_000.0))[1]

    @staticmethod
    def _depth_usd(venue: str) -> float:
        return VENUE_PROFILES.get(venue, (0.0, 2.0, 50_000.0))[2]

    def _fallback_price(self, base: str) -> float:
        rng = random.Random(f"{base}-price")
        return round(rng.uniform(1.5, 240.0), 6)

    def cross_markets(self) -> list[tuple[str, str]]:
        """Cross pairs we simulate, e.g. ``[("ETH", "BTC"), ("SOL", "ETH")]``."""
        others = [asset for asset in self.symbols if asset in CROSS_QUOTES]
        markets: list[tuple[str, str]] = []
        for base in self.symbols:
            for cross in others:
                if base != cross:
                    markets.append((base, cross))
        return markets

    # ------------------------------------------------------------------ steps
    def _step(self) -> None:
        self._tick += 1
        for base in self.symbols:
            shock = self._rng.gauss(0, 0.0006)
            self._drift[base] = self._drift[base] * 0.92 + shock
            self._true[base] = max(1e-12, self._true[base] * (1.0 + self._drift[base]))

        self._step_dislocations()

        for key in self._basis:
            venue, base = key
            target = self._character_bps(venue) / 10_000.0
            current = self._basis[key]
            shock = self._dislocations.get((venue, base), 0.0)
            self._basis[key] = (
                current + (target - current) * 0.08 + self._rng.gauss(0, 0.00030) + shock
            )

    def _step_dislocations(self) -> None:
        """Knock a single market out of line, then let it decay away."""
        for key, value in list(self._dislocations.items()):
            decayed = value * DISLOCATION_DECAY
            if abs(decayed) < 2e-5:
                del self._dislocations[key]
            else:
                self._dislocations[key] = decayed

        if self._rng.random() >= DISLOCATION_PROBABILITY:
            return
        venue = self._rng.choice(self.venues)
        market = self._rng.choice(self.symbols + [f"{b}/{q}" for b, q in self.cross_markets()])
        direction = 1.0 if self._rng.random() < 0.5 else -1.0
        size = self._rng.uniform(DISLOCATION_MIN_BPS, DISLOCATION_MAX_BPS) / 10_000.0
        key = (venue, market)
        self._dislocations[key] = self._dislocations.get(key, 0.0) + direction * size

    # ------------------------------------------------------------------ API
    def quotes(self) -> list[Quote]:
        """Advance the simulation one tick and return every venue's top of book."""
        self._step()
        out: list[Quote] = []
        for base in self.symbols:
            for venue in self.venues:
                out.append(
                    self._make_quote(
                        venue=venue,
                        base=base,
                        quote_asset=self.quote_currency,
                        mid=self._true[base] * (1.0 + self._basis[(venue, base)]),
                    )
                )
            for quote_asset in CROSS_QUOTES:
                if base == quote_asset or quote_asset not in self.symbols:
                    continue
                reference = self._true.get(quote_asset)
                if not reference:
                    continue
                rate = self._true[base] / reference
                for venue in self.venues:
                    if venue not in CROSS_QUOTE_VENUES:
                        continue
                    basis = (
                        self._basis.get((venue, base), 0.0)
                        - self._basis.get((venue, quote_asset), 0.0)
                        + self._dislocations.get((venue, f"{base}/{quote_asset}"), 0.0)
                    )
                    out.append(
                        self._make_quote(
                            venue=venue,
                            base=base,
                            quote_asset=quote_asset,
                            mid=rate * (1.0 + basis),
                            depth_scale=0.6,
                            spread_scale=1.4,
                        )
                    )
        return out

    def _make_quote(
        self,
        *,
        venue: str,
        base: str,
        quote_asset: str,
        mid: float,
        depth_scale: float = 1.0,
        spread_scale: float = 1.0,
    ) -> Quote:
        half_spread = mid * self._half_spread_bps(venue) / 10_000.0 * spread_scale
        jitter = 1.0 + abs(self._rng.gauss(0, 0.15))
        bid = mid - half_spread * jitter
        ask = mid + half_spread * jitter
        if bid >= ask:
            ask = bid + mid * 1e-5
        depth_usd = self._depth_usd(venue) * depth_scale
        return Quote(
            exchange=venue,
            exchange_name=self.venue_names.get(venue, venue.title()),
            symbol=f"{base}/{quote_asset}",
            base=base,
            quote=quote_asset,
            bid=round(bid, 12),
            ask=round(ask, 12),
            bid_qty=round(depth_usd / max(bid, 1e-12), 8),
            ask_qty=round(depth_usd / max(ask, 1e-12), 8),
        )


def simulated_venue_names(venues: list[str]) -> dict[str, str]:
    return {venue: venue.title() for venue in venues}


def triangle_candidates() -> list[tuple[str, str]]:
    return list(CROSS_QUOTES)
