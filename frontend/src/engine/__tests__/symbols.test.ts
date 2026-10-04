import { describe, expect, it } from 'vitest'
import { canonicalBase, splitSymbol } from '../symbols'

describe('symbol normalisation', () => {
  it('handles every venue spelling', () => {
    expect(splitSymbol('BTCUSDT')).toEqual(['BTC', 'USDT'])
    expect(splitSymbol('XBT/USDT')).toEqual(['BTC', 'USDT'])
    expect(splitSymbol('eth-btc')).toEqual(['ETH', 'BTC'])
    expect(splitSymbol('sol_usdt')).toEqual(['SOL', 'USDT'])
    expect(splitSymbol('BTC-USDC')).toEqual(['BTC', 'USDC'])
    expect(splitSymbol('BTCFDUSD')).toEqual(['BTC', 'FDUSD'])
  })

  it('prefers the longest matching quote asset', () => {
    // USDC must not be misread as USD.
    expect(splitSymbol('BTCUSDC')).toEqual(['BTC', 'USDC'])
  })

  it('returns null for unknown tickers', () => {
    expect(splitSymbol('NOTAPAIR')).toBeNull()
    expect(splitSymbol('')).toBeNull()
  })

  it('canonicalises aliased bases', () => {
    expect(canonicalBase('xbt')).toBe('BTC')
    expect(canonicalBase('weth')).toBe('ETH')
    expect(canonicalBase('ada')).toBe('ADA')
  })
})
