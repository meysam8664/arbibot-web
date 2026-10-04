"""Binance public spot adapter (``/api/v3/ticker/bookTicker``)."""

from __future__ import annotations

import httpx

from ..models import Quote
from .base import ExchangeAdapter


class BinanceAdapter(ExchangeAdapter):
    id = "binance"
    name = "Binance"
    docs = "https://api.binance.com/api/v3/ticker/bookTicker"

    URL = "https://api.binance.com/api/v3/ticker/bookTicker"

    async def fetch_quotes(self, client: httpx.AsyncClient, bases: set[str]) -> list[Quote]:
        payload = await self.get_json(client, self.URL)
        quotes: list[Quote] = []
        for row in payload or []:
            raw = row.get("symbol", "")
            quote = self.make_quote(
                raw_symbol=raw,
                bid=float(row.get("bidPrice") or 0),
                ask=float(row.get("askPrice") or 0),
                bid_qty=float(row.get("bidQty") or 0),
                ask_qty=float(row.get("askQty") or 0),
            )
            if quote and (not bases or quote.base in bases):
                quotes.append(quote)
        return quotes
