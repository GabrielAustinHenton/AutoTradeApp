/**
 * Permanent Watchlist Configuration
 *
 * These symbols are always included in the watchlist and tracked in git.
 * Edit this file to add or remove permanent symbols.
 *
 * Trading rules will be auto-generated for each symbol.
 */

// Stocks to always track - Top 20 most traded (Alpha Vantage rate limit: 5/min)
export const PERMANENT_STOCKS = [
  // Mega-cap Tech (most liquid)
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
  // High-volume semiconductors
  'AMD', 'INTC',
  // Financials
  'JPM', 'V', 'BAC',
  // Healthcare
  'UNH', 'JNJ',
  // Consumer
  'KO', 'WMT',
  // Energy
  'XOM',
  // Media
  'NFLX', 'DIS',
  // Fintech
  'PYPL',
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
