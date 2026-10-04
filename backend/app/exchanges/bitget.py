"""Bitget v2 public spot adapter (``/api/v2/spot/market/tickers``)."""

from __future__ import annotations

import httpx

from ..models import Quote
from .base import ExchangeAdapter


class BitgetAdapter(ExchangeAdapter):
    id = "bitget"
    name = "Bitget"
    docs = "https://api.bitget.com/api/v2/spot/market/tickers"

    URL = "https://api.bitget.com/api/v2/spot/market/tickers"

    async def fetch_quotes(self, client: httpx.AsyncClient, bases: set[str]) -> list[Quote]:
        payload = await self.get_json(client, self.URL)
        rows = (payload or {}).get("data") or []
        quotes: list[Quote] = []
        for row in rows:
            raw = row.get("symbol", "")
            quote = self.make_quote(
                raw_symbol=raw,
                bid=float(row.get("bidPr") or 0),
                ask=float(row.get("askPr") or 0),
                bid_qty=float(row.get("bidSz") or 0),
                ask_qty=float(row.get("askSz") or 0),
            )
            if quote and (not bases or quote.base in bases):
                quotes.append(quote)
        return quotes
