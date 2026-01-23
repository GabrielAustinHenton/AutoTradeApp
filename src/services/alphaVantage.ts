import axios from 'axios';
import { logger } from '../utils/logger';
import type { PriceHistory } from '../types';

const BASE_URL = 'https://www.alphavantage.co/query';
const FINNHUB_URL = 'https://finnhub.io/api/v1';
// Use Vite proxy to bypass CORS for Twelve Data
const TWELVE_DATA_URL = '/api/twelvedata';

const getApiKey = () => {
  const key = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY;
  if (!key) {
    logger.warn('API', 'Alpha Vantage API key not set. Add VITE_ALPHA_VANTAGE_API_KEY to .env');
  }
  return key || 'demo';
};

const getFinnhubApiKey = () => {
  return import.meta.env.VITE_FINNHUB_API_KEY || '';
};

const getTwelveDataApiKey = () => {
  return import.meta.env.VITE_TWELVE_DATA_API_KEY || 'demo';
};

// Common crypto symbols - map to Finnhub's Binance format
const CRYPTO_SYMBOLS: Record<string, string> = {
  BTC: 'BINANCE:BTCUSDT',
  ETH: 'BINANCE:ETHUSDT',
  SOL: 'BINANCE:SOLUSDT',
  XRP: 'BINANCE:XRPUSDT',
  ADA: 'BINANCE:ADAUSDT',
  DOGE: 'BINANCE:DOGEUSDT',
  DOT: 'BINANCE:DOTUSDT',
  POL: 'BINANCE:POLUSDT',
  LINK: 'BINANCE:LINKUSDT',
  AVAX: 'BINANCE:AVAXUSDT',
  LTC: 'BINANCE:LTCUSDT',
  UNI: 'BINANCE:UNIUSDT',
  ATOM: 'BINANCE:ATOMUSDT',
  XLM: 'BINANCE:XLMUSDT',
  ALGO: 'BINANCE:ALGOUSDT',
};

export function isCryptoSymbol(symbol: string): boolean {
  return symbol.toUpperCase() in CRYPTO_SYMBOLS;
}

function getFinnhubSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  return CRYPTO_SYMBOLS[upper] || symbol;
}

export interface QuoteData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  previousClose: number;
  latestTradingDay: string;
}

export interface IntradayData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SearchResult {
  symbol: string;
  name: string;
  type: string;
  region: string;
  currency: string;
}

// Get real-time quote from Finnhub (requires free API key from finnhub.io)
// Supports both stocks and crypto (ETH, BTC, etc.)
async function getFinnhubQuote(symbol: string): Promise<QuoteData | null> {
  const apiKey = getFinnhubApiKey();
  if (!apiKey) {
    return null;
  }

  const finnhubSymbol = getFinnhubSymbol(symbol);
  const isCrypto = isCryptoSymbol(symbol);

  try {
    const response = await axios.get(`${FINNHUB_URL}/quote`, {
      params: {
        symbol: finnhubSymbol,
        token: apiKey,
      },
    });

    const data = response.data;
    if (!data || data.c === 0) {
      return null;
    }

    const quote = {
      symbol: symbol.toUpperCase(), // Return original symbol, not Binance format
      price: data.c, // Current price
      change: data.d, // Change
      changePercent: data.dp, // Change percent
      high: data.h, // High
      low: data.l, // Low
      volume: 0, // Finnhub quote doesn't include volume
      previousClose: data.pc, // Previous close
      latestTradingDay: new Date().toISOString().split('T')[0],
    };

    logger.info('API', `Finnhub quote: ${quote.symbol} $${quote.price.toFixed(2)} (${isCrypto ? 'crypto' : 'real-time'})`);
    return quote;
  } catch (error) {
    logger.error('API', 'Finnhub error', error);
    return null;
  }
}

// Get quote from Alpha Vantage (fallback, returns end-of-day prices)
async function getAlphaVantageQuote(symbol: string): Promise<QuoteData | null> {
  try {
    const response = await axios.get(BASE_URL, {
      params: {
        function: 'GLOBAL_QUOTE',
        symbol,
        apikey: getApiKey(),
        _t: Date.now(),
      },
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });

    const data = response.data['Global Quote'];
    if (!data || Object.keys(data).length === 0) {
      if (response.data['Note']) {
        logger.warn('API', 'Alpha Vantage rate limit', response.data['Note']);
      }
      if (response.data['Information']) {
        logger.warn('API', 'Alpha Vantage info', response.data['Information']);
      }
      return null;
    }

    const quote = {
      symbol: data['01. symbol'],
      price: parseFloat(data['05. price']),
      change: parseFloat(data['09. change']),
      changePercent: parseFloat(data['10. change percent']?.replace('%', '') || '0'),
      high: parseFloat(data['03. high']),
      low: parseFloat(data['04. low']),
      volume: parseInt(data['06. volume']),
      previousClose: parseFloat(data['08. previous close']),
      latestTradingDay: data['07. latest trading day'],
    };

    logger.info('API', `Alpha Vantage quote: ${quote.symbol} $${quote.price} (trading day: ${quote.latestTradingDay})`);
    return quote;
  } catch (error) {
    logger.error('API', 'Alpha Vantage error', error);
    return null;
  }
}

// Main getQuote function - tries Finnhub first for real-time prices, falls back to Alpha Vantage
export async function getQuote(symbol: string): Promise<QuoteData | null> {
  // Try Finnhub first for real-time prices (if API key is configured)
  const finnhubQuote = await getFinnhubQuote(symbol);
  if (finnhubQuote) {
    return finnhubQuote;
  }

  // Fall back to Alpha Vantage (note: returns end-of-day prices, not real-time during market hours)
  return getAlphaVantageQuote(symbol);
}

export async function getMultipleQuotes(symbols: string[]): Promise<Map<string, QuoteData>> {
  const quotes = new Map<string, QuoteData>();

  // Alpha Vantage free tier has rate limits (5 calls/min, 500/day)
  // Fetch sequentially with small delay to avoid rate limiting
  for (const symbol of symbols) {
    const quote = await getQuote(symbol);
    if (quote) {
      quotes.set(symbol, quote);
    }
    // Small delay between requests
    if (symbols.indexOf(symbol) < symbols.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  return quotes;
}

// Finnhub candle data - 60 calls/min vs Alpha Vantage's 5 calls/min
export async function getFinnhubCandles(
  symbol: string,
  resolution: '1' | '5' | '15' | '30' | '60' | 'D' = '15',
  count: number = 100
): Promise<PriceHistory[]> {
  const apiKey = getFinnhubApiKey();
  if (!apiKey) {
    logger.warn('API', 'Finnhub API key not set');
    return [];
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    // Calculate 'from' based on resolution and count
    let secondsPerCandle = 60; // default 1 min
    if (resolution === '5') secondsPerCandle = 5 * 60;
    else if (resolution === '15') secondsPerCandle = 15 * 60;
    else if (resolution === '30') secondsPerCandle = 30 * 60;
    else if (resolution === '60') secondsPerCandle = 60 * 60;
    else if (resolution === 'D') secondsPerCandle = 24 * 60 * 60;

    const from = now - (count * secondsPerCandle * 2); // Extra buffer for market hours

    const response = await axios.get(`${FINNHUB_URL}/stock/candle`, {
      params: {
        symbol: symbol.toUpperCase(),
        resolution,
        from,
        to: now,
        token: apiKey,
      },
    });

    const data = response.data;
    if (!data || data.s === 'no_data' || !data.c || data.c.length === 0) {
      logger.warn('API', `Finnhub no candle data for ${symbol}`);
      return [];
    }

    // Convert Finnhub format to PriceHistory format
    const candles: PriceHistory[] = [];
    for (let i = 0; i < data.c.length; i++) {
      candles.push({
        date: new Date(data.t[i] * 1000),
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v[i],
      });
    }

    logger.info('API', `Finnhub candles: ${symbol} - ${candles.length} candles`);
    return candles;
  } catch (error) {
    logger.error('API', `Finnhub candles error for ${symbol}`, error);
    return [];
  }
}

// Twelve Data candle data - 800 calls/day, 8 calls/min on free tier
// Works with demo key for testing
export async function getTwelveDataCandles(
  symbol: string,
  interval: '1min' | '5min' | '15min' | '30min' | '1h' = '15min',
  outputSize: number = 100
): Promise<PriceHistory[]> {
  const apiKey = getTwelveDataApiKey();

  try {
    const response = await axios.get(`${TWELVE_DATA_URL}/time_series`, {
      params: {
        symbol: symbol.toUpperCase(),
        interval,
        outputsize: outputSize,
        apikey: apiKey,
      },
    });

    const data = response.data;
    if (!data || data.status === 'error' || !data.values || data.values.length === 0) {
      const errorMsg = data?.message || 'No data';
      logger.warn('API', `Twelve Data no candle data for ${symbol}: ${errorMsg}`);
      return [];
    }

    // Convert Twelve Data format to PriceHistory format
    // Note: Twelve Data returns newest first, so we reverse
    const candles: PriceHistory[] = data.values.map((v: any) => ({
      date: new Date(v.datetime),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseInt(v.volume) || 0,
    })).reverse(); // Oldest first

    logger.info('API', `Twelve Data candles: ${symbol} - ${candles.length} candles`);
    return candles;
  } catch (error) {
    logger.error('API', `Twelve Data candles error for ${symbol}`, error);
    return [];
  }
}

// Alpha Vantage intraday - DEPRECATED: use getTwelveDataCandles instead (rate limited to 5 calls/min)
export async function getIntradayData(
  symbol: string,
  interval: '1min' | '5min' | '15min' | '30min' | '60min' = '5min'
): Promise<IntradayData[]> {
  try {
    const response = await axios.get(BASE_URL, {
      params: {
        function: 'TIME_SERIES_INTRADAY',
        symbol,
        interval,
        apikey: getApiKey(),
      },
    });

    const timeSeries = response.data[`Time Series (${interval})`];
    if (!timeSeries) {
      return [];
    }

    return Object.entries(timeSeries)
      .map(([timestamp, values]: [string, any]) => ({
        timestamp,
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        volume: parseInt(values['5. volume']),
      }))
      .reverse(); // Oldest first
  } catch (error) {
    logger.error('API', 'Error fetching intraday data', error);
    return [];
  }
}

export async function getDailyData(symbol: string, outputSize: 'compact' | 'full' = 'compact'): Promise<IntradayData[]> {
  try {
    const response = await axios.get(BASE_URL, {
      params: {
        function: 'TIME_SERIES_DAILY',
        symbol,
        outputsize: outputSize,
        apikey: getApiKey(),
      },
    });

    const timeSeries = response.data['Time Series (Daily)'];
    if (!timeSeries) {
      // Check for API error messages
      if (response.data['Note']) {
        logger.error('API', 'Alpha Vantage rate limit', response.data['Note']);
        throw new Error('API rate limit reached. Please wait a minute and try again.');
      }
      if (response.data['Error Message']) {
        logger.error('API', 'Alpha Vantage error', response.data['Error Message']);
        throw new Error(response.data['Error Message']);
      }
      logger.warn('API', 'No daily data returned for symbol');
      return [];
    }

    return Object.entries(timeSeries)
      .map(([timestamp, values]: [string, any]) => ({
        timestamp,
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        volume: parseInt(values['5. volume']),
      }))
      .reverse(); // Oldest first
  } catch (error) {
    logger.error('API', 'Error fetching daily data', error);
    return [];
  }
}

// Crypto names for display
const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  XRP: 'XRP',
  ADA: 'Cardano',
  DOGE: 'Dogecoin',
  DOT: 'Polkadot',
  POL: 'Polygon',
  LINK: 'Chainlink',
  AVAX: 'Avalanche',
  LTC: 'Litecoin',
  UNI: 'Uniswap',
  ATOM: 'Cosmos',
  XLM: 'Stellar',
  ALGO: 'Algorand',
};

export async function searchSymbol(keywords: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const searchTerm = keywords.toLowerCase();

  // Check for matching crypto symbols first
  for (const [symbol, name] of Object.entries(CRYPTO_NAMES)) {
    if (
      symbol.toLowerCase().includes(searchTerm) ||
      name.toLowerCase().includes(searchTerm)
    ) {
      results.push({
        symbol,
        name,
        type: 'Cryptocurrency',
        region: 'Global',
        currency: 'USD',
      });
    }
  }

  // Then search for stocks via Alpha Vantage
  try {
    const response = await axios.get(BASE_URL, {
      params: {
        function: 'SYMBOL_SEARCH',
        keywords,
        apikey: getApiKey(),
      },
    });

    const matches = response.data.bestMatches;
    if (matches) {
      const stockResults = matches.map((match: any) => ({
        symbol: match['1. symbol'],
        name: match['2. name'],
        type: match['3. type'],
        region: match['4. region'],
        currency: match['8. currency'],
      }));
      results.push(...stockResults);
    }
  } catch (error) {
    logger.error('API', 'Error searching symbols', error);
  }

  return results;
}
