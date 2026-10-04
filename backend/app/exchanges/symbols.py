"""Venue-agnostic symbol handling.

Every exchange spells pairs differently (``BTCUSDT``, ``BTC-USDT``,
``XBT/USDT`` …).  The functions here normalise any of those into the canonical
``BASE/QUOTE`` form used across the app.
"""

from __future__ import annotations

from typing import Iterable, Optional, Sequence

#: Quote assets we understand, longest first so ``BTCUSDT`` does not match ``BTC``.
QUOTE_ASSETS: Sequence[str] = (
    "USDT",
    "USDC",
    "FDUSD",
    "TUSD",
    "BUSD",
    "USDP",
    "DAI",
    "USD",
    "EUR",
    "TRY",
    "GBP",
    "BRL",
    "JPY",
    "AUD",
    "BTC",
    "ETH",
    "BNB",
)

#: Venue-specific base tickers that map onto a canonical asset.
BASE_ALIASES: dict[str, str] = {
    "XBT": "BTC",
    "XDG": "DOGE",
    "WETH": "ETH",
    "WBTC": "BTC",
    "BCC": "BCH",
    "BCHABC": "BCH",
    "IOT": "IOTA",
    "MIOTA": "IOTA",
    "TONCOIN": "TON",
    "MATIC": "POL",
}

_SEPARATORS = ("-", "_", "/", ":", " ")


def _clean(raw: str) -> str:
    text = raw.strip().upper()
    for sep in _SEPARATORS:
        text = text.replace(sep, "")
    return text


def split_symbol(raw: str, quotes: Optional[Iterable[str]] = None) -> Optional[tuple[str, str]]:
    """Split an exchange ticker into ``(base, quote)``.

    >>> split_symbol("BTCUSDT")
    ('BTC', 'USDT')
    >>> split_symbol("xbt/usdt")
    ('BTC', 'USDT')
    >>> split_symbol("eth-btc")
    ('ETH', 'BTC')
    >>> split_symbol("weird") is None
    True
    """
    if not raw:
        return None
    text = _clean(raw)
    quote_universe = tuple(quotes) if quotes else QUOTE_ASSETS
    for quote in quote_universe:  # longest first
        q = _clean(quote)
        if not q or len(text) <= len(q) or not text.endswith(q):
            continue
        base = text[: -len(q)]
        base = BASE_ALIASES.get(base, base)
        return base, quote.upper()
    return None


def canonical(base: str, quote: str) -> str:
    return f"{BASE_ALIASES.get(base.upper(), base.upper())}/{quote.upper()}"


def base_of(symbol: str) -> str:
    return symbol.split("/")[0].upper()


def quote_of(symbol: str) -> str:
    return symbol.split("/")[-1].upper()
