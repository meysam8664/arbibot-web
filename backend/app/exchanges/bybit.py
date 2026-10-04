"""Bybit v5 public spot adapter (``/v5/market/tickers``)."""

from __future__ import annotations

import httpx

from ..models import Quote
from .base import ExchangeAdapter


class BybitAdapter(ExchangeAdapter):
    id = "bybit"
    name = "Bybit"
    docs = "https://api.bybit.com/v5/market/tickers?category=spot"

    URL = "https://api.bybit.com/v5/market/tickers"

    async def fetch_quotes(self, client: httpx.AsyncClient, bases: set[str]) -> list[Quote]:
        payload = await self.get_json(client, self.URL, params={"category": "spot"})
        rows = ((payload or {}).get("result") or {}).get("list") or []
        quotes: list[Quote] = []
        for row in rows:
            raw = row.get("symbol", "")
            quote = self.make_quote(
                raw_symbol=raw,
                bid=float(row.get("bid1Price") or 0),
                ask=float(row.get("ask1Price") or 0),
                bid_qty=float(row.get("bid1Size") or 0),
                ask_qty=float(row.get("ask1Size") or 0),
            )
            if quote and (not bases or quote.base in bases):
                quotes.append(quote)
        return quotes
