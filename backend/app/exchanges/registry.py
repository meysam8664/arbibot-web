"""Adapter registry — the single place that knows every supported venue."""

from __future__ import annotations

from .base import AdapterError, ExchangeAdapter
from .binance import BinanceAdapter
from .bitget import BitgetAdapter
from .bybit import BybitAdapter
from .coinbase import CoinbaseAdapter
from .gateio import GateioAdapter
from .htx import HtxAdapter
from .kraken import KrakenAdapter
from .kucoin import KucoinAdapter
from .mexc import MexcAdapter
from .okx import OkxAdapter

ADAPTER_CLASSES: tuple[type[ExchangeAdapter], ...] = (
    BinanceAdapter,
    OkxAdapter,
    BybitAdapter,
    KucoinAdapter,
    GateioAdapter,
    MexcAdapter,
    BitgetAdapter,
    HtxAdapter,
    KrakenAdapter,
    CoinbaseAdapter,
)


def build_adapters(quote_currency: str = "USDT") -> dict[str, ExchangeAdapter]:
    """Instantiate every adapter, keyed by venue id."""
    return {cls.id: cls(quote_currency=quote_currency) for cls in ADAPTER_CLASSES}


def adapter_metadata() -> list[dict[str, str]]:
    return [
        {"id": cls.id, "name": cls.name, "docs": cls.docs}
        for cls in ADAPTER_CLASSES
    ]


__all__ = [
    "ADAPTER_CLASSES",
    "AdapterError",
    "ExchangeAdapter",
    "adapter_metadata",
    "build_adapters",
]
