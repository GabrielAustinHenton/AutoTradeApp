/**
 * Permanent Watchlist Configuration
 *
 * These symbols are always included in the watchlist and tracked in git.
 * Edit this file to add or remove permanent symbols.
 *
 * Trading rules will be auto-generated for each symbol.
 */

// Stocks to always track - Top 100 by market cap/popularity
export const PERMANENT_STOCKS = [
  // Mega-cap Tech
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA',
  // Semiconductors
  'AVGO', 'AMD', 'INTC', 'QCOM', 'TXN', 'MU', 'AMAT', 'LRCX', 'KLAC', 'MRVL',
  // Software & Cloud
  'CRM', 'ORCL', 'ADBE', 'NOW', 'INTU', 'SNOW', 'PLTR', 'PANW', 'CRWD', 'ZS',
  // Financials
  'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'BLK', 'SCHW', 'AXP', 'C', 'USB',
  // Healthcare & Pharma
  'UNH', 'JNJ', 'LLY', 'PFE', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'BMY', 'AMGN', 'GILD',
  // Consumer
  'KO', 'PEP', 'PG', 'COST', 'WMT', 'HD', 'MCD', 'NKE', 'SBUX', 'TGT', 'LOW',
  // Industrial & Aerospace
  'CAT', 'DE', 'BA', 'HON', 'UPS', 'RTX', 'LMT', 'GE', 'MMM',
  // Energy
  'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY',
  // Communications & Media
  'NFLX', 'DIS', 'CMCSA', 'T', 'VZ', 'TMUS',
  // EV & Auto
  'F', 'GM', 'RIVN', 'LCID',
  // Fintech & Payments
  'PYPL', 'SQ', 'COIN', 'AFRM', 'SOFI',
  // E-commerce & Internet
  'SHOP', 'BABA', 'JD', 'MELI', 'SE', 'UBER', 'LYFT', 'ABNB', 'DASH', 'RBLX',
  // Biotech
  'MRNA', 'REGN', 'VRTX', 'BIIB',
  // REITs & Real Estate
  'AMT', 'PLD', 'SPG',
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
