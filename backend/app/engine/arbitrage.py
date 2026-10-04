"""Pure arbitrage maths.

Kept free of I/O so it can be unit-tested and reasoned about in isolation.

Two strategies are modelled:

``directional``
    Buy on venue A, sell on venue B.  Gross edge is ``(sell_bid - buy_ask)``.
``triangular``
    Three (or fewer) legs inside a single venue, starting and ending in the
    quote currency, e.g. ``USDT → BTC → ETH → USDT``.
"""

from __future__ import annotations

import math
import time
from collections import defaultdict

from ..models import Leg, Opportunity, Quote, TriangleLeg, TriangleOpportunity


def _round(value: float, digits: int = 8) -> float:
    if value is None or math.isnan(value) or math.isinf(value):
        return 0.0
    return round(value, digits)


def directional_edge(
    buy: Quote,
    sell: Quote,
    *,
    notional_usd: float,
    buy_fee_pct: float,
    sell_fee_pct: float,
    slippage_pct: float,
) -> Opportunity:
    """Evaluate buying ``buy.base`` on one venue and selling it on another.

    Fees are charged on each leg's notional, the slippage setting is a flat
    buffer (in percent) that models queue position / partial fills.
    """
    gross_pct = (sell.bid - buy.ask) / buy.ask * 100.0
    fees_pct = buy_fee_pct + sell_fee_pct
    net_pct = gross_pct - fees_pct - slippage_pct

    target_qty = notional_usd / buy.ask
    depth_qty: float | None = None
    if buy.ask_qty > 0 and sell.bid_qty > 0:
        depth_qty = min(buy.ask_qty, sell.bid_qty)
    qty = target_qty if depth_qty is None else min(target_qty, depth_qty)
    depth_limited = depth_qty is not None and qty < target_qty * 0.999

    executable_notional = qty * buy.ask
    buy_fee_usd = executable_notional * buy_fee_pct / 100.0
    gross_proceeds = qty * sell.bid
    sell_fee_usd = gross_proceeds * sell_fee_pct / 100.0
    slippage_usd = executable_notional * slippage_pct / 100.0
    profit = gross_proceeds - sell_fee_usd - executable_notional - buy_fee_usd - slippage_usd

    reference = (buy.ask + sell.bid) / 2.0
    return Opportunity(
        id=f"{buy.symbol}:{buy.exchange}->{sell.exchange}",
        symbol=buy.symbol,
        base=buy.base,
        quote=buy.quote,
        buy_exchange=buy.exchange,
        buy_exchange_name=buy.exchange_name,
        sell_exchange=sell.exchange,
        sell_exchange_name=sell.exchange_name,
        buy_ask=_round(buy.ask),
        sell_bid=_round(sell.bid),
        buy_ask_qty=_round(buy.ask_qty),
        sell_bid_qty=_round(sell.bid_qty),
        reference_price=_round(reference),
        gross_spread_pct=_round(gross_pct, 4),
        net_spread_pct=_round(net_pct, 4),
        total_fees_pct=_round(fees_pct, 4),
        notional_usd=_round(notional_usd, 2),
        executable_notional_usd=_round(executable_notional, 2),
        qty=_round(qty),
        est_profit_usd=_round(profit, 4),
        profitable=profit > 0,
        depth_limited=depth_limited,
        buy_fee_pct=_round(buy_fee_pct, 4),
        sell_fee_pct=_round(sell_fee_pct, 4),
        legs=[
            Leg(
                exchange=buy.exchange,
                exchange_name=buy.exchange_name,
                side="buy",
                symbol=buy.symbol,
                price=_round(buy.ask),
                qty=_round(qty),
                fee_pct=_round(buy_fee_pct, 4),
                fee_usd=_round(buy_fee_usd, 4),
                notional_usd=_round(executable_notional, 2),
            ),
            Leg(
                exchange=sell.exchange,
                exchange_name=sell.exchange_name,
                side="sell",
                symbol=sell.symbol,
                price=_round(sell.bid),
                qty=_round(qty),
                fee_pct=_round(sell_fee_pct, 4),
                fee_usd=_round(sell_fee_usd, 4),
                notional_usd=_round(gross_proceeds, 2),
            ),
        ],
        ts=max(buy.ts, sell.ts, time.time()),
    )


def scan_directional(
    quotes: list[Quote],
    *,
    notional_usd: float,
    fee_lookup,
    slippage_pct: float,
    min_net_spread_pct: float,
    max_results: int,
    quote_currency: str = "USDT",
    max_quote_age: float = 60.0,
) -> list[Opportunity]:
    """Find the best buy-venue / sell-venue pair for every symbol."""
    now = time.time()
    by_symbol: dict[str, list[Quote]] = defaultdict(list)
    for quote in quotes:
        if quote.quote != quote_currency:
            continue
        if quote.ask <= 0 or quote.bid <= 0:
            continue
        if now - quote.ts > max_quote_age:
            continue
        by_symbol[quote.symbol].append(quote)

    found: list[Opportunity] = []
    for symbol, group in by_symbol.items():
        if len(group) < 2:
            continue
        cheapest_ask = min(group, key=lambda q: q.ask)
        richest_bid = max(group, key=lambda q: q.bid)
        if cheapest_ask.exchange == richest_bid.exchange:
            continue
        opportunity = directional_edge(
            cheapest_ask,
            richest_bid,
            notional_usd=notional_usd,
            buy_fee_pct=fee_lookup(cheapest_ask.exchange),
            sell_fee_pct=fee_lookup(richest_bid.exchange),
            slippage_pct=slippage_pct,
        )
        if opportunity.net_spread_pct >= min_net_spread_pct:
            found.append(opportunity)
    found.sort(key=lambda o: o.net_spread_pct, reverse=True)
    return found[:max_results]


def scan_triangular(
    quotes: list[Quote],
    *,
    notional_usd: float,
    fee_lookup,
    min_net_spread_pct: float,
    quote_currency: str = "USDT",
    max_results: int = 25,
    max_legs: int = 3,
    max_age: float = 60.0,
    venue_names: dict[str, str] | None = None,
) -> list[TriangleOpportunity]:
    """Enumerate ≤``max_legs`` cycles that start and end in ``quote_currency``.

    Each edge rate already includes the taker fee, so a product of edge rates
    above 1.0 is a genuine net-of-fee profit.  Only the best cycle per
    (venue, currency-set) is reported.
    """
    now = time.time()
    graphs: dict[str, dict[str, list[tuple[str, float, Quote]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for quote in quotes:
        if now - quote.ts > max_age or quote.bid <= 0 or quote.ask <= 0:
            continue
        fee = 1.0 - fee_lookup(quote.exchange) / 100.0
        if fee <= 0:
            continue
        graph = graphs[quote.exchange]
        graph[quote.quote].append((quote.base, (1.0 / quote.ask) * fee, quote))
        graph[quote.base].append((quote.quote, quote.bid * fee, quote))

    results: list[TriangleOpportunity] = []
    for exchange, graph in graphs.items():
        if quote_currency not in graph:
            continue
        best_per_key: dict[tuple[str, ...], TriangleOpportunity] = {}
        _walk(
            graph,
            quote_currency,
            quote_currency,
            [quote_currency],
            [],
            1.0,
            max_legs,
            best_per_key,
            exchange,
            (venue_names or {}).get(exchange, exchange.title()),
            fee_lookup,
            notional_usd,
        )
        for cycle in best_per_key.values():
            if cycle.net_spread_pct >= min_net_spread_pct:
                results.append(cycle)

    results.sort(key=lambda c: c.net_spread_pct, reverse=True)
    return results[:max_results]


def _walk(
    graph: dict[str, list[tuple[str, float, Quote]]],
    start: str,
    node: str,
    path: list[str],
    edges: list[tuple[float, Quote]],
    rate: float,
    depth_left: int,
    best: dict[tuple[str, ...], TriangleOpportunity],
    exchange: str,
    exchange_name: str,
    fee_lookup,
    notional_usd: float,
) -> None:
    if depth_left == 0:
        return
    for nxt, edge_rate, quote in graph.get(node, []):
        new_rate = rate * edge_rate
        if nxt == start:
            if len(path) < 3:  # ignore 1- and 2-leg pseudo cycles
                continue
            key = _canonical_key(path)
            net_pct = (new_rate - 1.0) * 100.0
            candidate = _build_cycle(
                exchange,
                exchange_name,
                path + [start],
                edges + [(edge_rate, quote)],
                net_pct,
                fee_lookup,
                notional_usd,
            )
            current = best.get(key)
            if current is None or candidate.net_spread_pct > current.net_spread_pct:
                best[key] = candidate
            continue
        if nxt in path:
            continue
        _walk(
            graph,
            start,
            nxt,
            path + [nxt],
            edges + [(edge_rate, quote)],
            new_rate,
            depth_left - 1,
            best,
            exchange,
            exchange_name,
            fee_lookup,
            notional_usd,
        )


def _canonical_key(path: list[str]) -> tuple[str, ...]:
    """Rotate a cycle so the same loop always yields the same key."""
    body = path[:-1]
    if not body:
        return tuple(path)
    rotations = [tuple(body[i:] + body[:i]) for i in range(len(body))]
    return min(rotations)


def _build_cycle(
    exchange: str,
    exchange_name: str,
    path: list[str],
    edges: list[tuple[float, Quote]],
    net_pct: float,
    fee_lookup,
    notional_usd: float,
) -> TriangleOpportunity:
    """Materialise a cycle into buy/sell legs.

    Edge rates already include the taker fee, so the gross (fee-free) spread is
    reported as ``net + sum(fees)``: a first-order estimate that keeps the
    headline numbers additive and easy to audit.
    """
    fee_pct = round(fee_lookup(exchange), 4)
    legs: list[TriangleLeg] = []
    for index, (_edge_rate, quote) in enumerate(edges):
        from_asset = path[index]
        to_asset = path[index + 1]
        # A buy consumes the ask of the pair whose base is `to_asset`.
        is_buy = quote.base == to_asset and quote.quote == from_asset
        price = quote.ask if is_buy else quote.bid
        legs.append(
            TriangleLeg(
                symbol=quote.symbol,
                side="buy" if is_buy else "sell",
                price=_round(price),
                fee_pct=fee_pct,
            )
        )
    total_fees_pct = round(fee_pct * len(legs), 4)
    return TriangleOpportunity(
        id=f"{exchange}:{'->'.join(path)}",
        exchange=exchange,
        exchange_name=exchange_name,
        path=path,
        legs=legs,
        gross_spread_pct=_round(net_pct + total_fees_pct, 4),
        net_spread_pct=_round(net_pct, 4),
        total_fees_pct=total_fees_pct,
        notional_usd=_round(notional_usd, 2),
        est_profit_usd=_round(notional_usd * net_pct / 100.0, 4),
    )
