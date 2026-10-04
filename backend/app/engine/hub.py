"""The market hub: polls venues, computes edges, fans out state.

A single asyncio task drives the whole application:

1.  every ``poll_interval`` seconds it requests top-of-book from each enabled
    venue (in parallel, with per-venue error isolation),
2.  runs the directional and triangular scanners,
3.  publishes an immutable :class:`MarketUpdate` snapshot to every subscriber
    (WebSocket clients) and keeps the latest snapshot for REST clients.

Data mode handling
------------------
``ARBIBOT_DATA_MODE=auto`` (default) probes the live APIs.  If fewer than two
venues respond, the hub transparently switches to the seeded simulator and
keeps re-probing in the background, so a locked-down host still shows a
working dashboard instead of an empty one.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import deque
from typing import Any, Optional

import httpx

from ..config import ALL_EXCHANGES, Settings
from ..exchanges import adapter_metadata, build_adapters
from ..models import (
    ExchangeStatus,
    MarketUpdate,
    Opportunity,
    Quote,
    RuntimeConfig,
    RuntimeConfigPatch,
    SymbolSnapshot,
    TriangleOpportunity,
)
from .arbitrage import scan_directional, scan_triangular
from .simulator import VENUE_PROFILES, MarketSimulator

log = logging.getLogger("arbibot.hub")

PROBE_EVERY_CYCLES = 45  # while simulating, retry live APIs this often
MIN_LIVE_VENUES = 2


class MarketHub:
    def __init__(self, settings: Settings, client: Optional[httpx.AsyncClient] = None) -> None:
        self.settings = settings
        self._client = client
        self._owns_client = client is None
        self.adapters: dict[str, Any] = {}
        self.quotes: dict[tuple[str, str], Quote] = {}
        self._venue_names: dict[str, str] = {
            entry["id"]: entry["name"] for entry in adapter_metadata()
        }
        self.opportunities: list[Opportunity] = []
        self.triangles: list[TriangleOpportunity] = []
        self.markets: list[SymbolSnapshot] = []
        self.statuses: dict[str, ExchangeStatus] = {}
        self.simulator = MarketSimulator(
            [name for name in settings.enabled_exchanges],
            list(settings.symbols),
            quote_currency=settings.quote_currency,
            seed=settings.sim_seed,
            venue_names=self.venue_names(),
        )
        self.effective_mode: str = "probing"
        self.mode_reason: str = "starting up"
        self.cycle = 0
        self.cycle_ms = 0.0
        self.started_at = time.time()
        self._subscribers: set[asyncio.Queue[MarketUpdate]] = set()
        self._task: Optional[asyncio.Task[None]] = None
        self._stop = asyncio.Event()
        self._lock = asyncio.Lock()
        self.history: dict[str, deque[tuple[float, float, float]]] = {}
        self.edge_history: dict[str, deque[tuple[float, float]]] = {}
        self._rebuild_adapters()

    def venue_names(self) -> dict[str, str]:
        """Human-readable venue names (shared by statuses and the simulator)."""
        return {
            name: self._venue_names.get(name, name.title()) for name in ALL_EXCHANGES
        }

    # ------------------------------------------------------------- lifecycle
    def _rebuild_adapters(self) -> None:
        self.adapters = build_adapters(self.settings.quote_currency)
        for name in ALL_EXCHANGES:
            enabled = name in self.settings.enabled_exchanges
            meta = self.adapters.get(name)
            self.statuses[name] = ExchangeStatus(
                id=name,
                name=self._venue_names.get(name, name.title()),
                enabled=enabled,
                status="probing" if enabled else "disabled",
                fee_taker_pct=self.settings.fee_for(name),
                docs=getattr(meta, "docs", ""),
            )

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        if self._owns_client and self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.settings.http_timeout),
                headers={"User-Agent": "ArbiBotWeb/1.0 (+https://github.com/meysam8664/arbibot-web)"},
                follow_redirects=True,
            )
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="arbibot-market-hub")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------ subscriber
    def subscribe(self) -> asyncio.Queue[MarketUpdate]:
        queue: asyncio.Queue[MarketUpdate] = asyncio.Queue(maxsize=4)
        self._subscribers.add(queue)
        snapshot = self.snapshot()
        with contextlib.suppress(asyncio.QueueFull):
            queue.put_nowait(snapshot)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[MarketUpdate]) -> None:
        self._subscribers.discard(queue)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def _publish(self, update: MarketUpdate) -> None:
        for queue in list(self._subscribers):
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(update)

    # ---------------------------------------------------------------- snapshot
    def snapshot(self) -> MarketUpdate:
        return MarketUpdate(
            ts=time.time(),
            data_mode=self.effective_mode,  # type: ignore[arg-type]
            data_mode_reason=self.mode_reason,
            cycle=self.cycle,
            cycle_ms=round(self.cycle_ms, 2),
            opportunities=self.opportunities,
            triangles=self.triangles,
            exchanges=[self.statuses[name] for name in ALL_EXCHANGES],
            markets=self.markets,
            stats=self.stats(),
        )

    def stats(self) -> dict[str, Any]:
        online = [s for s in self.statuses.values() if s.status in ("online", "degraded")]
        best = self.opportunities[0].net_spread_pct if self.opportunities else 0.0
        best_profit = self.opportunities[0].est_profit_usd if self.opportunities else 0.0
        latencies = [s.latency_ms for s in online if s.latency_ms]
        return {
            "cycle": self.cycle,
            "cycle_ms": round(self.cycle_ms, 2),
            "poll_interval": self.settings.poll_interval,
            "exchanges_online": len(online),
            "exchanges_total": len([s for s in self.statuses.values() if s.enabled]),
            "symbols": len(self.settings.symbols),
            "quotes": len(self.quotes),
            "opportunities": len(self.opportunities),
            "triangles": len(self.triangles),
            "best_net_spread_pct": best,
            "best_profit_usd": best_profit,
            "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0.0,
            "data_mode": self.effective_mode,
            "notional_usd": self.settings.notional_usd,
            "uptime_s": round(time.time() - self.started_at, 1),
            "clients": self.subscriber_count,
        }

    # ------------------------------------------------------------------ loop
    async def _run(self) -> None:
        log.info("market hub starting (mode=%s, venues=%s)", self.settings.data_mode, self.adapters.keys())
        while not self._stop.is_set():
            started = time.perf_counter()
            try:
                await self._cycle()
                self._scan()
                self._record_history()
            except asyncio.CancelledError:
                raise
            except Exception:  # pragma: no cover - defensive
                log.exception("market cycle failed")
            self.cycle_ms = (time.perf_counter() - started) * 1000.0
            self.cycle += 1
            self._publish(self.snapshot())
            delay = max(0.2, self.settings.poll_interval - self.cycle_ms / 1000.0)
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._stop.wait(), timeout=delay)

    async def _cycle(self) -> None:
        mode = self.settings.data_mode
        if mode == "sim":
            self._set_mode("sim", "simulated feed (ARBIBOT_DATA_MODE=sim)")
            await self._collect_simulated()
            return

        if mode == "auto" and self.effective_mode == "sim":
            if self.cycle % PROBE_EVERY_CYCLES != 0:
                await self._collect_simulated()
                return

        await self._collect_live()

        online = [s for s in self.statuses.values() if s.status in ("online", "degraded")]
        if mode == "live":
            if self.effective_mode != "live":
                self._set_mode("live", "live exchange APIs")
            return

        if len(online) >= MIN_LIVE_VENUES:
            self._set_mode("live", f"live exchange APIs ({len(online)} venues responding)")
        else:
            self._set_mode(
                "sim",
                "exchange APIs unreachable from this host — showing the simulated feed",
            )
            await self._collect_simulated()

    # ------------------------------------------------------------------ live
    async def _collect_live(self) -> None:
        assert self._client is not None
        bases = set(self.settings.symbols)
        venues = [name for name in self.settings.enabled_exchanges if name in self.adapters]
        tasks = {
            name: asyncio.create_task(self._fetch_one(name, bases)) for name in venues
        }
        for name, task in tasks.items():
            status = self.statuses[name]
            started = time.perf_counter()
            try:
                quotes = await task
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - per-venue isolation
                status.status = "offline"
                status.error = _short_error(exc)
                status.latency_ms = round((time.perf_counter() - started) * 1000, 1)
                log.warning("venue %s failed: %s", name, status.error)
                continue
            latency = (time.perf_counter() - started) * 1000.0
            status.latency_ms = round(latency, 1)
            status.error = None
            status.pairs = len(quotes)
            if not quotes:
                status.status = "degraded"
                status.error = "no matching USDT pairs returned"
                continue
            status.status = "online"
            status.last_update = time.time()
            status.simulated = False
            for quote in quotes:
                quote.exchange_name = status.name
                self.quotes[(quote.exchange, quote.symbol)] = quote

    async def _fetch_one(self, name: str, bases: set[str]) -> list[Quote]:
        assert self._client is not None
        adapter = self.adapters[name]
        async with self._lock:
            return await adapter.fetch_quotes(self._client, bases)

    # ------------------------------------------------------------------- sim
    async def _collect_simulated(self) -> None:
        quotes = self.simulator.quotes()
        counts: dict[str, int] = {}
        for quote in quotes:
            self.quotes[(quote.exchange, quote.symbol)] = quote
            counts[quote.exchange] = counts.get(quote.exchange, 0) + 1
        for name, status in self.statuses.items():
            if not status.enabled:
                continue
            status.status = "online"
            status.simulated = True
            status.pairs = counts.get(name, 0)
            status.latency_ms = 0.0
            status.last_update = time.time()
            status.error = None

    def _set_mode(self, mode: str, reason: str) -> None:
        if mode != self.effective_mode:
            log.info("data mode -> %s (%s)", mode, reason)
        self.effective_mode = mode
        self.mode_reason = reason

    # --------------------------------------------------------------- scanning
    async def refresh(self) -> MarketUpdate:
        """Run one cycle immediately (used by ``/api/refresh`` and tests)."""
        await self._cycle()
        self._scan()
        self._record_history()
        return self.snapshot()

    def _scan(self) -> None:
        settings = self.settings
        # Drop quotes for symbols/pairs we no longer track, plus anything stale.
        cutoff = time.time() - max(60.0, settings.poll_interval * 15)
        wanted = set(settings.symbols)
        self.quotes = {
            key: quote
            for key, quote in self.quotes.items()
            if quote.ts >= cutoff and quote.base in wanted
        }

        max_age = max(30.0, settings.poll_interval * 6)
        quotes = [
            quote
            for quote in self.quotes.values()
            if quote.exchange in settings.enabled_exchanges
        ]
        self.opportunities = scan_directional(
            quotes,
            notional_usd=settings.notional_usd,
            fee_lookup=settings.fee_for,
            slippage_pct=settings.slippage_buffer_pct,
            min_net_spread_pct=settings.min_net_spread_pct,
            max_results=settings.max_opportunities,
            quote_currency=settings.quote_currency,
            max_quote_age=max_age,
        )
        self.triangles = scan_triangular(
            quotes,
            notional_usd=settings.notional_usd,
            fee_lookup=settings.fee_for,
            min_net_spread_pct=max(settings.min_net_spread_pct, 0.05),
            quote_currency=settings.quote_currency,
            max_results=15,
            max_age=max_age,
            venue_names=self.venue_names(),
        )
        self.markets = self._build_markets(quotes)

    def _build_markets(self, quotes: list[Quote]) -> list[SymbolSnapshot]:
        by_symbol: dict[str, list[Quote]] = {}
        for quote in quotes:
            if quote.quote != self.settings.quote_currency:
                continue
            by_symbol.setdefault(quote.symbol, []).append(quote)

        edge_lookup = {o.symbol: o for o in self.opportunities}
        snapshots: list[SymbolSnapshot] = []
        for symbol, group in sorted(by_symbol.items()):
            best_bid_quote = max(group, key=lambda q: q.bid)
            best_ask_quote = min(group, key=lambda q: q.ask)
            reference = (best_bid_quote.bid + best_ask_quote.ask) / 2
            edge = edge_lookup.get(symbol)
            net = edge.net_spread_pct if edge else 0.0
            if not edge and len(group) >= 2:
                # Report the theoretical best even when it is below threshold.
                buys = min(group, key=lambda q: q.ask)
                sells = max(group, key=lambda q: q.bid)
                if buys.exchange != sells.exchange:
                    fees = self.settings.fee_for(buys.exchange) + self.settings.fee_for(sells.exchange)
                    net = round(
                        (sells.bid - buys.ask) / buys.ask * 100
                        - fees
                        - self.settings.slippage_buffer_pct,
                        4,
                    )
            snapshots.append(
                SymbolSnapshot(
                    symbol=symbol,
                    base=symbol.split("/")[0],
                    quote=symbol.split("/")[-1],
                    reference_price=round(reference, 10),
                    best_bid=round(best_bid_quote.bid, 10),
                    best_ask=round(best_ask_quote.ask, 10),
                    best_bid_exchange=best_bid_quote.exchange,
                    best_ask_exchange=best_ask_quote.exchange,
                    max_net_spread_pct=net,
                    venues=len(group),
                    quotes=sorted(group, key=lambda q: q.exchange),
                )
            )
        snapshots.sort(key=lambda s: s.max_net_spread_pct, reverse=True)
        return snapshots

    # -------------------------------------------------------------- history
    def _record_history(self) -> None:
        limit = self.settings.history_points
        now = time.time()
        for market in self.markets:
            for key in {market.base, market.symbol}:
                series = self.history.setdefault(key, deque(maxlen=limit))
                series.append((now, market.reference_price, market.max_net_spread_pct))
        for opportunity in self.opportunities[:25]:
            series = self.edge_history.setdefault(opportunity.id, deque(maxlen=limit))
            series.append((time.time(), opportunity.net_spread_pct))

    def history_for(self, symbol: str) -> list[dict[str, float]]:
        key = symbol.upper()
        series = self.history.get(key)
        if series is None:
            series = self.history.get(f"{key}/{self.settings.quote_currency.upper()}", ())
        return [
            {"ts": ts, "price": price, "net_spread_pct": net}
            for ts, price, net in (series or ())
        ]

    def edge_history_for(self, edge_id: str) -> list[dict[str, float]]:
        return [
            {"ts": ts, "net_spread_pct": net}
            for ts, net in self.edge_history.get(edge_id, ())
        ]

    # ----------------------------------------------------------------- config
    def runtime_config(self) -> RuntimeConfig:
        settings = self.settings
        return RuntimeConfig(
            data_mode=settings.data_mode,
            effective_mode=self.effective_mode,  # type: ignore[arg-type]
            data_mode_reason=self.mode_reason,
            poll_interval=settings.poll_interval,
            quote_currency=settings.quote_currency,
            symbols=list(settings.symbols),
            notional_usd=settings.notional_usd,
            min_net_spread_pct=settings.min_net_spread_pct,
            slippage_buffer_pct=settings.slippage_buffer_pct,
            taker_fees=dict(settings.taker_fees),
            disabled_exchanges=list(settings.disabled_exchanges),
            supported_exchanges=list(ALL_EXCHANGES),
            supported_symbols=list(settings.symbols),
            version=settings.version,
        )

    async def apply_patch(self, patch: RuntimeConfigPatch) -> RuntimeConfig:
        settings = self.settings
        if patch.data_mode is not None:
            settings.data_mode = patch.data_mode
            if patch.data_mode != "auto":
                self.effective_mode = "probing"
        if patch.poll_interval is not None:
            settings.poll_interval = max(1.0, patch.poll_interval)
        if patch.notional_usd is not None:
            settings.notional_usd = patch.notional_usd
        if patch.min_net_spread_pct is not None:
            settings.min_net_spread_pct = patch.min_net_spread_pct
        if patch.slippage_buffer_pct is not None:
            settings.slippage_buffer_pct = patch.slippage_buffer_pct
        if patch.taker_fees:
            merged = dict(settings.taker_fees)
            for name, value in patch.taker_fees.items():
                merged[name.lower()] = float(value)
            settings.taker_fees = merged
        if patch.disabled_exchanges is not None:
            settings.disabled_exchanges = [name.lower() for name in patch.disabled_exchanges]

        for name, status in self.statuses.items():
            status.enabled = name in settings.enabled_exchanges
            status.fee_taker_pct = settings.fee_for(name)
            if not status.enabled:
                status.status = "disabled"

        if patch.symbols is not None:
            new_symbols = [s.upper().split("/")[0] for s in patch.symbols]
            settings.symbols = new_symbols
            self.simulator = MarketSimulator(
                list(settings.enabled_exchanges),
                list(new_symbols),
                quote_currency=settings.quote_currency,
                seed=settings.sim_seed,
                venue_names=self.venue_names(),
            )

        if patch.refresh:
            await self.refresh()
        else:
            self._scan()
        return self.runtime_config()


def _short_error(exc: BaseException) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    return text[:200]


def venue_profiles() -> dict[str, tuple[float, float, float]]:
    return dict(VENUE_PROFILES)
