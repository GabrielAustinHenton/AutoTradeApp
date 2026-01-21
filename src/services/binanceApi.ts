// Binance.US Public API for cryptocurrency candle data
// No API key required - completely free and unauthenticated
// Using Binance.US to avoid geo-restrictions

import type { PriceHistory } from '../types';

const BINANCE_API_BASE = 'https://api.binance.us/api/v3';

// Map our symbols to Binance.US trading pairs (uses USD, not USDT)
const SYMBOL_TO_BINANCE: Record<string, string> = {
  'ETH': 'ETHUSD',
  'BTC': 'BTCUSD',
  'SOL': 'SOLUSD',
  'ADA': 'ADAUSD',
  'DOT': 'DOTUSD',
  'DOGE': 'DOGEUSD',
  'AVAX': 'AVAXUSD',
  'MATIC': 'MATICUSD',
  'LINK': 'LINKUSD',
  'XRP': 'XRPUSD',
};

// Convert interval to Binance format
const INTERVAL_MAP: Record<string, string> = {
  '1min': '1m',
  '5min': '5m',
  '15min': '15m',
  '30min': '30m',
  '60min': '1h',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

export function isCryptoSymbol(symbol: string): boolean {
  return symbol in SYMBOL_TO_BINANCE;
}

export function getBinanceSymbol(symbol: string): string | null {
  return SYMBOL_TO_BINANCE[symbol] || null;
}

/**
 * Fetch candle/kline data from Binance
 * @param symbol - Crypto symbol (e.g., 'ETH', 'BTC')
 * @param interval - Time interval ('15min', '1h', '1d', etc.)
 * @param limit - Number of candles to fetch (max 1000)
 */
export async function getBinanceCandles(
  symbol: string,
  interval: string = '15min',
  limit: number = 100
): Promise<PriceHistory[]> {
  const binanceSymbol = SYMBOL_TO_BINANCE[symbol];
  if (!binanceSymbol) {
    throw new Error(`Unknown crypto symbol: ${symbol}`);
  }

  const binanceInterval = INTERVAL_MAP[interval] || '15m';

  const url = `${BINANCE_API_BASE}/klines?symbol=${binanceSymbol}&interval=${binanceInterval}&limit=${limit}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = await response.json();

    // Binance klines format:
    // [
    //   [
    //     1499040000000,      // Open time
    //     "0.01634000",       // Open
    //     "0.80000000",       // High
    //     "0.01575800",       // Low
    //     "0.01577100",       // Close
    //     "148976.11427815",  // Volume
    //     1499644799999,      // Close time
    //     "2434.19055334",    // Quote asset volume
    //     308,                // Number of trades
    //     "1756.87402397",    // Taker buy base asset volume
    //     "28.46694368",      // Taker buy quote asset volume
    //     "17928899.62484339" // Ignore
    //   ]
    // ]

    return data.map((kline: (string | number)[]) => ({
      date: new Date(kline[0] as number),
      open: parseFloat(kline[1] as string),
      high: parseFloat(kline[2] as string),
      low: parseFloat(kline[3] as string),
      close: parseFloat(kline[4] as string),
      volume: parseFloat(kline[5] as string),
    }));
  } catch (error) {
    console.error(`Error fetching Binance candles for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Get the current price from Binance
 */
export async function getBinancePrice(symbol: string): Promise<number | null> {
  const binanceSymbol = SYMBOL_TO_BINANCE[symbol];
  if (!binanceSymbol) {
    return null;
  }

  try {
    const response = await fetch(`${BINANCE_API_BASE}/ticker/price?symbol=${binanceSymbol}`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return parseFloat(data.price);
  } catch {
    return null;
  }
}
