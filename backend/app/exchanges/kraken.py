"""Kraken public spot adapter.

Kraken's ``/0/public/Ticker`` uses internal asset codes (``XXBTZUSD``,
``XBTUSDT`` …), so the adapter first resolves ``/0/public/AssetPairs`` to learn
the human-readable ``wsname`` (``BTC/USDT``) and then maps tickers onto it.
"""

from __future__ import annotations

import time

import httpx

from ..models import Quote
from .base import ExchangeAdapter


class KrakenAdapter(ExchangeAdapter):
    id = "kraken"
    name = "Kraken"
    docs = "https://api.kraken.com/0/public/Ticker"

    BASE = "https://api.kraken.com"
    PAIR_TTL = 3600.0  # asset pair metadata rarely changes

    def __init__(self, quote_currency: str = "USDT") -> None:
        super().__init__(quote_currency)
        self._pair_map: dict[str, str] = {}
        self._pairs_fetched_at: float = 0.0

    async def _pair_names(self, client: httpx.AsyncClient) -> dict[str, str]:
        if self._pair_map and (time.time() - self._pairs_fetched_at) < self.PAIR_TTL:
            return self._pair_map
        payload = await self.get_json(client, f"{self.BASE}/0/public/AssetPairs")
        mapping: dict[str, str] = {}
        for key, meta in ((payload or {}).get("result") or {}).items():
            wsname = meta.get("wsname")  # e.g. "BTC/USDT"
            if wsname:
                mapping[key] = wsname
                altname = meta.get("altname")
                if altname:
                    mapping.setdefault(altname, wsname)
        if mapping:
            self._pair_map = mapping
            self._pairs_fetched_at = time.time()
        return self._pair_map

    async def fetch_quotes(self, client: httpx.AsyncClient, bases: set[str]) -> list[Quote]:
        names = await self._pair_names(client)
        payload = await self.get_json(client, f"{self.BASE}/0/public/Ticker")
        rows = (payload or {}).get("result") or {}
        quotes: list[Quote] = []
        for key, row in rows.items():
            wsname = names.get(key, key)
            bid = _first(row.get("b"))
            ask = _first(row.get("a"))
            quote = self.make_quote(
                raw_symbol=wsname,
                bid=bid,
                ask=ask,
                bid_qty=_second(row.get("b")),
                ask_qty=_second(row.get("a")),
            )
            if quote and (not bases or quote.base in bases):
                quotes.append(quote)
        return quotes


def _first(value: object) -> float:
    if isinstance(value, (list, tuple)) and value:
        return float(value[0])
    return float(value or 0)  # type: ignore[arg-type]


def _second(value: object) -> float:
    if isinstance(value, (list, tuple)) and len(value) > 1:
        try:
            return float(value[1])
        except (TypeError, ValueError):
            return 0.0
    return 0.0
