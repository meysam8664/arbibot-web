"""Symbol normalisation for every venue spelling we support."""

from app.exchanges.symbols import base_of, canonical, quote_of, split_symbol


def test_binance_style_ticker():
    assert split_symbol("BTCUSDT") == ("BTC", "USDT")


def test_kraken_style_ticker_with_alias():
    assert split_symbol("XBT/USDT") == ("BTC", "USDT")


def test_dash_and_underscore_separators():
    assert split_symbol("ETH-BTC") == ("ETH", "BTC")
    assert split_symbol("sol_usdt") == ("SOL", "USDT")


def test_longest_quote_wins():
    # USDC must not be misread as USD.
    assert split_symbol("BTCUSDC") == ("BTC", "USDC")
    assert split_symbol("BTCFDUSD") == ("BTC", "FDUSD")


def test_unknown_ticker_returns_none():
    assert split_symbol("NOTAPAIR") is None
    assert split_symbol("") is None


def test_helpers():
    assert canonical("xbt", "usdt") == "BTC/USDT"
    assert base_of("ETH/USDT") == "ETH"
    assert quote_of("ETH/USDT") == "USDT"
