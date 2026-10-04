"""Base class + shared helpers for venue adapters.

Adapters are deliberately tiny: each one knows the public endpoint that serves
top-of-book data and how to turn that payload into :class:`Quote` objects.
Everything else (polling, arbitrage maths, streaming) lives in the engine.
"""

from __future__ import annotations

import httpx

from ..models import Quote
from .symbols import split_symbol


class AdapterError(RuntimeError):
    """Raised when a venue returns something we cannot use."""


class ExchangeAdapter:
    """Interface implemented by every venue adapter."""

    id: str = ""
    name: str = ""
    docs: str = ""
    #: Whether quotes are real (False for nothing today — the simulator
    #: produces its own quotes and never goes through adapters).
    simulated: bool = False

    def __init__(self, quote_currency: str = "USDT") -> None:
        self.quote_currency = quote_currency.upper()

    # ------------------------------------------------------------------ API
    async def fetch_quotes(
        self,
        client: httpx.AsyncClient,
        bases: set[str],
    ) -> list[Quote]:  # pragma: no cover - interface
        raise NotImplementedError

    # -------------------------------------------------------------- helpers
    def canonical(self, raw_symbol: str, quotes: tuple[str, ...] | None = None) -> tuple[str, str] | None:
        """Map a venue ticker to ``(base, quote)`` when it is a pair we care about."""
        return split_symbol(raw_symbol, quotes)

    def make_quote(
        self,
        *,
        raw_symbol: str,
        bid: float,
        ask: float,
        bid_qty: float = 0.0,
        ask_qty: float = 0.0,
        quotes: tuple[str, ...] | None = None,
    ) -> Quote | None:
        """Build a :class:`Quote` for any recognised quote asset.

        Cross-quoted pairs (``ETH/BTC``) are kept as well as the configured
        quote currency: the directional scanner filters them out, while the
        triangular scanner needs them.
        """
        parts = self.canonical(raw_symbol, quotes)
        if not parts:
            return None
        base, quote = parts
        if not bid or not ask or bid <= 0 or ask <= 0:
            return None
        return Quote(
            exchange=self.id,
            exchange_name=self.name,
            symbol=f"{base}/{quote}",
            base=base,
            quote=quote,
            bid=float(bid),
            ask=float(ask),
            bid_qty=float(bid_qty or 0.0),
            ask_qty=float(ask_qty or 0.0),
        )

    # ----------------------------------------------------------------- utils
    @staticmethod
    async def get_json(client: httpx.AsyncClient, url: str, **kwargs) -> object:
        response = await client.get(url, **kwargs)
        response.raise_for_status()
        return response.json()
