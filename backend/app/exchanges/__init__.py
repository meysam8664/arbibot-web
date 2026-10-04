"""Public exchange adapters (REST, no API keys required)."""

from .base import AdapterError, ExchangeAdapter
from .registry import ADAPTER_CLASSES, adapter_metadata, build_adapters
from .symbols import base_of, canonical, quote_of, split_symbol

__all__ = [
    "ADAPTER_CLASSES",
    "AdapterError",
    "ExchangeAdapter",
    "adapter_metadata",
    "base_of",
    "build_adapters",
    "canonical",
    "quote_of",
    "split_symbol",
]
