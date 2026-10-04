"""Pydantic models shared by the market engine and the HTTP/WebSocket API."""

from __future__ import annotations

import time
from typing import Literal, Optional

from pydantic import BaseModel, Field


class Quote(BaseModel):
    """Top of book for one symbol on one venue."""

    exchange: str
    exchange_name: str = ""
    symbol: str  # canonical, e.g. "BTC/USDT"
    base: str
    quote: str
    bid: float
    ask: float
    bid_qty: float = 0.0
    ask_qty: float = 0.0
    ts: float = Field(default_factory=time.time)

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2 if self.bid and self.ask else 0.0

    @property
    def spread_pct(self) -> float:
        if not self.bid or not self.ask:
            return 0.0
        return (self.ask - self.bid) / self.bid * 100

    def bid_depth_usd(self) -> float:
        return self.bid * self.bid_qty

    def ask_depth_usd(self) -> float:
        return self.ask * self.ask_qty


class Leg(BaseModel):
    exchange: str
    exchange_name: str = ""
    side: Literal["buy", "sell", "sell_base", "buy_base"]
    symbol: str
    price: float
    qty: float
    fee_pct: float
    fee_usd: float
    notional_usd: float


class Opportunity(BaseModel):
    """A cross-venue buy-here / sell-there opportunity."""

    id: str
    symbol: str
    base: str
    quote: str
    buy_exchange: str
    buy_exchange_name: str = ""
    sell_exchange: str
    sell_exchange_name: str = ""
    buy_ask: float
    sell_bid: float
    buy_ask_qty: float = 0.0
    sell_bid_qty: float = 0.0
    reference_price: float = 0.0
    gross_spread_pct: float
    net_spread_pct: float
    total_fees_pct: float
    notional_usd: float
    executable_notional_usd: float
    qty: float
    est_profit_usd: float
    #: False when the edge is positive but does not clear costs (near-miss row).
    profitable: bool = True
    depth_limited: bool = False
    buy_fee_pct: float
    sell_fee_pct: float
    legs: list[Leg] = Field(default_factory=list)
    ts: float = Field(default_factory=time.time)


class TriangleLeg(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    price: float
    fee_pct: float


class TriangleOpportunity(BaseModel):
    """A three-leg cycle inside a single venue (e.g. USDT→BTC→ETH→USDT)."""

    id: str
    exchange: str
    exchange_name: str = ""
    path: list[str]
    legs: list[TriangleLeg]
    gross_spread_pct: float
    net_spread_pct: float
    total_fees_pct: float
    notional_usd: float
    est_profit_usd: float
    ts: float = Field(default_factory=time.time)


class ExchangeStatus(BaseModel):
    id: str
    name: str
    enabled: bool = True
    status: Literal["online", "degraded", "offline", "disabled", "probing"] = "probing"
    fee_taker_pct: float = 0.10
    latency_ms: Optional[float] = None
    pairs: int = 0
    last_update: Optional[float] = None
    error: Optional[str] = None
    docs: str = ""
    simulated: bool = False


class SymbolSnapshot(BaseModel):
    symbol: str
    base: str
    quote: str
    reference_price: float
    best_bid: float
    best_ask: float
    best_bid_exchange: str
    best_ask_exchange: str
    max_net_spread_pct: float
    venues: int
    quotes: list[Quote] = Field(default_factory=list)


class MarketUpdate(BaseModel):
    """WebSocket payload: one full snapshot of engine state."""

    type: Literal["snapshot"] = "snapshot"
    ts: float = Field(default_factory=time.time)
    data_mode: Literal["live", "sim", "probing"] = "probing"
    data_mode_reason: str = ""
    cycle: int = 0
    cycle_ms: float = 0.0
    opportunities: list[Opportunity] = Field(default_factory=list)
    triangles: list[TriangleOpportunity] = Field(default_factory=list)
    exchanges: list[ExchangeStatus] = Field(default_factory=list)
    markets: list[SymbolSnapshot] = Field(default_factory=list)
    stats: dict[str, float | int | str] = Field(default_factory=dict)


class RuntimeConfig(BaseModel):
    """Client-visible / client-editable runtime settings."""

    data_mode: Literal["auto", "live", "sim"] = "auto"
    effective_mode: Literal["live", "sim", "probing"] = "probing"
    data_mode_reason: str = ""
    poll_interval: float = 4.0
    quote_currency: str = "USDT"
    symbols: list[str] = Field(default_factory=list)
    notional_usd: float = 10_000.0
    min_net_spread_pct: float = 0.02
    slippage_buffer_pct: float = 0.02
    taker_fees: dict[str, float] = Field(default_factory=dict)
    disabled_exchanges: list[str] = Field(default_factory=list)
    supported_exchanges: list[str] = Field(default_factory=list)
    supported_symbols: list[str] = Field(default_factory=list)
    version: str = "1.0.0"


class RuntimeConfigPatch(BaseModel):
    """Partial update for :class:`RuntimeConfig`."""

    data_mode: Optional[Literal["auto", "live", "sim"]] = None
    poll_interval: Optional[float] = None
    symbols: Optional[list[str]] = None
    notional_usd: Optional[float] = Field(default=None, gt=0)
    # A negative threshold is allowed on purpose: it lets the dashboard surface
    # the *best available* spreads even when they do not (yet) beat costs.
    min_net_spread_pct: Optional[float] = Field(default=None, ge=-10)
    slippage_buffer_pct: Optional[float] = Field(default=None, ge=0)
    taker_fees: Optional[dict[str, float]] = None
    disabled_exchanges: Optional[list[str]] = None
    refresh: bool = False
