"""HTX (Huobi) public spot adapter (``/market/tickers``).

HTX does not expose sizes on its aggregate ticker endpoint, so depth is
reported as zero and the engine treats those quotes as top-of-book only.
"""

from __future__ import annotations

import httpx

from ..models import Quote
from .base import ExchangeAdapter


class HtxAdapter(ExchangeAdapter):
    id = "htx"
    name = "HTX"
    docs = "https://api.huobi.pro/market/tickers"

    URL = "https://api.huobi.pro/market/tickers"

    async def fetch_quotes(self, client: httpx.AsyncClient, bases: set[str]) -> list[Quote]:
        payload = await self.get_json(client, self.URL)
        rows = (payload or {}).get("data") or []
        quotes: list[Quote] = []
        for row in rows:
            raw = str(row.get("symbol", "")).upper()
            quote = self.make_quote(
                raw_symbol=raw,
                bid=float(row.get("bid") or 0),
                ask=float(row.get("ask") or 0),
                bid_qty=float(row.get("bidSize") or 0),
                ask_qty=float(row.get("askSize") or 0),
            )
            if quote and (not bases or quote.base in bases):
                quotes.append(quote)
        return quotes
