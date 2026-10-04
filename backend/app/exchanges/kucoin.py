"""KuCoin public spot adapter (``/api/v1/market/allTickers``)."""

from __future__ import annotations

import httpx

from ..models import Quote
from .base import ExchangeAdapter


class KucoinAdapter(ExchangeAdapter):
    id = "kucoin"
    name = "KuCoin"
    docs = "https://api.kucoin.com/api/v1/market/allTickers"

    URL = "https://api.kucoin.com/api/v1/market/allTickers"

    async def fetch_quotes(self, client: httpx.AsyncClient, bases: set[str]) -> list[Quote]:
        payload = await self.get_json(client, self.URL)
        rows = ((payload or {}).get("data") or {}).get("ticker") or []
        quotes: list[Quote] = []
        for row in rows:
            raw = row.get("symbol", "")
            quote = self.make_quote(
                raw_symbol=raw,
                bid=float(row.get("buy") or 0),
                ask=float(row.get("sell") or 0),
                bid_qty=float(row.get("buySize") or 0),
                ask_qty=float(row.get("sellSize") or 0),
            )
            if quote and (not bases or quote.base in bases):
                quotes.append(quote)
        return quotes
