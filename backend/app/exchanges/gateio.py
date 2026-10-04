"""Gate.io public spot adapter (``/api/v4/spot/tickers``)."""

from __future__ import annotations

import httpx

from ..models import Quote
from .base import ExchangeAdapter


class GateioAdapter(ExchangeAdapter):
    id = "gateio"
    name = "Gate.io"
    docs = "https://api.gateio.ws/api/v4/spot/tickers"

    URL = "https://api.gateio.ws/api/v4/spot/tickers"

    async def fetch_quotes(self, client: httpx.AsyncClient, bases: set[str]) -> list[Quote]:
        payload = await self.get_json(client, self.URL)
        quotes: list[Quote] = []
        for row in payload or []:
            raw = row.get("currency_pair", "")
            quote = self.make_quote(
                raw_symbol=raw,
                bid=float(row.get("highest_bid") or 0),
                ask=float(row.get("lowest_ask") or 0),
                bid_qty=float(row.get("highest_size") or 0),
                ask_qty=float(row.get("lowest_size") or 0),
            )
            if quote and (not bases or quote.base in bases):
                quotes.append(quote)
        return quotes
