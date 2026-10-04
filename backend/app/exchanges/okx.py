"""OKX public spot adapter (``/api/v5/market/tickers``)."""

from __future__ import annotations

import httpx

from ..models import Quote
from .base import ExchangeAdapter


class OkxAdapter(ExchangeAdapter):
    id = "okx"
    name = "OKX"
    docs = "https://www.okx.com/api/v5/market/tickers?instType=SPOT"

    URL = "https://www.okx.com/api/v5/market/tickers"

    async def fetch_quotes(self, client: httpx.AsyncClient, bases: set[str]) -> list[Quote]:
        payload = await self.get_json(client, self.URL, params={"instType": "SPOT"})
        rows = (payload or {}).get("data") or []
        quotes: list[Quote] = []
        for row in rows:
            raw = row.get("instId", "")
            quote = self.make_quote(
                raw_symbol=raw,
                bid=float(row.get("bidPx") or 0),
                ask=float(row.get("askPx") or 0),
                bid_qty=float(row.get("bidSz") or 0),
                ask_qty=float(row.get("askSz") or 0),
            )
            if quote and (not bases or quote.base in bases):
                quotes.append(quote)
        return quotes
