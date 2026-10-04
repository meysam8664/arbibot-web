"""Coinbase Exchange public spot adapter.

Coinbase has no "all tickers in one call" endpoint, so the adapter fans out
over the configured watch-list (one lightweight request per product) using the
shared ``httpx`` client.
"""

from __future__ import annotations

import asyncio

import httpx

from ..models import Quote
from .base import ExchangeAdapter


class CoinbaseAdapter(ExchangeAdapter):
    id = "coinbase"
    name = "Coinbase"
    docs = "https://api.exchange.coinbase.com/products/{id}/ticker"

    BASE = "https://api.exchange.coinbase.com"
    MAX_CONCURRENCY = 4
    #: Per-product endpoint: we only poll the configured quote currency, so this
    #: venue takes part in cross-venue scans but not in triangular ones.
    supports_cross_pairs = False

    async def fetch_quotes(self, client: httpx.AsyncClient, bases: set[str]) -> list[Quote]:
        targets = sorted(bases) or []
        if not targets:
            return []
        semaphore = asyncio.Semaphore(self.MAX_CONCURRENCY)

        async def one(base: str) -> Quote | None:
            product = f"{base}-{self.quote_currency}"
            async with semaphore:
                try:
                    row = await self.get_json(client, f"{self.BASE}/products/{product}/ticker")
                except httpx.HTTPError:
                    return None
            if not isinstance(row, dict):
                return None
            return self.make_quote(
                raw_symbol=product,
                bid=float(row.get("bid") or 0),
                ask=float(row.get("ask") or 0),
                bid_qty=float(row.get("bid_size") or 0),
                ask_qty=float(row.get("ask_size") or 0),
            )

        results = await asyncio.gather(*(one(base) for base in targets), return_exceptions=True)
        return [q for q in results if isinstance(q, Quote)]
