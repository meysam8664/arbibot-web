"""Runtime configuration for ArbiBot Web.

Everything is driven by environment variables (prefix ``ARBIBOT_``) with sane
defaults so the service can boot with zero configuration:

    ARBIBOT_DATA_MODE=auto        # auto | live | sim
    ARBIBOT_SYMBOLS=BTC,ETH,SOL   # base assets to scan
    ARBIBOT_NOTIONAL_USD=10000    # trade size used for P&L estimates
    ARBIBOT_POLL_INTERVAL=4       # seconds between market polls
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Any, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

#: Default taker fee in percent per exchange (retail / lowest public tier).
DEFAULT_TAKER_FEES: dict[str, float] = {
    "binance": 0.10,
    "okx": 0.08,
    "bybit": 0.10,
    "kucoin": 0.10,
    "gateio": 0.20,
    "mexc": 0.05,
    "bitget": 0.10,
    "htx": 0.20,
    "kraken": 0.26,
    "coinbase": 0.60,
}

#: Base assets scanned by default.  Keep this list tight: each symbol is
#: compared across every enabled venue, and public REST endpoints are rate
#: limited.  All of these trade against USDT on every supported venue.
DEFAULT_SYMBOLS: list[str] = [
    "BTC",
    "ETH",
    "SOL",
    "XRP",
    "BNB",
    "DOGE",
    "ADA",
    "AVAX",
    "LINK",
    "TON",
    "DOT",
    "LTC",
]

ALL_EXCHANGES: list[str] = [
    "binance",
    "okx",
    "bybit",
    "kucoin",
    "gateio",
    "mexc",
    "bitget",
    "htx",
    "kraken",
    "coinbase",
]


def _split_csv(value: Any) -> Any:
    """Allow ``A,B,C`` (or a JSON array) for list-valued settings."""
    if value is None or isinstance(value, (list, tuple, set)):
        return list(value) if value is not None else value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if text.startswith("["):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                pass
        return [part.strip() for part in text.split(",") if part.strip()]
    return value


class Settings(BaseSettings):
    """Application settings."""

    model_config = SettingsConfigDict(
        env_prefix="ARBIBOT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "ArbiBot Web"
    version: str = "1.0.0"

    # ------------------------------------------------------------------ data
    data_mode: Literal["auto", "live", "sim"] = "auto"
    quote_currency: str = "USDT"
    symbols: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: list(DEFAULT_SYMBOLS)
    )
    poll_interval: float = 4.0
    http_timeout: float = 8.0

    # ------------------------------------------------------------ economics
    notional_usd: float = 10_000.0
    min_net_spread_pct: float = 0.02
    slippage_buffer_pct: float = 0.02
    taker_fees: Annotated[dict[str, float], NoDecode] = Field(
        default_factory=lambda: dict(DEFAULT_TAKER_FEES)
    )

    # ------------------------------------------------------------- engines
    disabled_exchanges: Annotated[list[str], NoDecode] = Field(default_factory=list)
    history_points: int = 240
    max_opportunities: int = 250
    live_probe_cycles: int = 2
    sim_seed: int = 1337

    # ---------------------------------------------------------------- http
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["*"])

    # ------------------------------------------------------------ validators
    @field_validator("symbols", "disabled_exchanges", "cors_origins", mode="before")
    @classmethod
    def _csv_lists(cls, value: Any) -> Any:
        return _split_csv(value)

    @field_validator("symbols", mode="after")
    @classmethod
    def _normalise_symbols(cls, value: list[str]) -> list[str]:
        seen: dict[str, None] = {}
        for item in value:
            base = str(item).strip().upper().split("/")[0]
            if base:
                seen.setdefault(base, None)
        return list(seen)

    @field_validator("taker_fees", mode="before")
    @classmethod
    def _fees(cls, value: Any) -> Any:
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("{"):
                return json.loads(text)
            fees: dict[str, float] = {}
            for part in text.split(","):
                name, _, raw = part.partition("=")
                if name.strip() and raw.strip():
                    fees[name.strip().lower()] = float(raw.strip())
            return fees
        return value

    @field_validator("poll_interval")
    @classmethod
    def _min_interval(cls, value: float) -> float:
        return max(1.0, float(value))

    # ------------------------------------------------------------- helpers
    @property
    def enabled_exchanges(self) -> list[str]:
        disabled = {name.lower() for name in self.disabled_exchanges}
        return [name for name in ALL_EXCHANGES if name not in disabled]

    def fee_for(self, exchange: str) -> float:
        """Taker fee in percent for an exchange (falls back to 0.10%)."""
        return float(self.taker_fees.get(exchange, DEFAULT_TAKER_FEES.get(exchange, 0.10)))

    def canonical_symbol(self, base: str) -> str:
        return f"{base.upper()}/{self.quote_currency.upper()}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
