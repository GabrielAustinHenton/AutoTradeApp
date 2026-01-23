/**
 * Permanent Watchlist Configuration
 *
 * These symbols are always included in the watchlist and tracked in git.
 * Edit this file to add or remove permanent symbols.
 *
 * Trading rules will be auto-generated for each symbol.
 */

// Stocks to always track
export const PERMANENT_STOCKS = [
  'AAPL',
  'GOOGL',
  'MSFT',
  'AMZN',
  'TSLA',
  'KO',
  'META',
  'NVDA',
  'JPM',
  'V',
];

// Crypto symbols to always track (uses Binance API)
export const PERMANENT_CRYPTO = [
  'ETH',
  'BTC',
  'SOL',
  'ADA',
  'DOT',
  'DOGE',
  'AVAX',
  'POL',
  'LINK',
  'XRP',
];

// Combined permanent watchlist
export const PERMANENT_WATCHLIST = [...PERMANENT_STOCKS, ...PERMANENT_CRYPTO];
