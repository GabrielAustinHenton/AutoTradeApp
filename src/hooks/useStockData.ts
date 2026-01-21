import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getQuote,
  getMultipleQuotes,
  getIntradayData,
  getDailyData,
  searchSymbol,
  type QuoteData,
  type IntradayData,
  type SearchResult,
} from '../services/alphaVantage';
import { getBinanceCandles, isCryptoSymbol } from '../services/binanceApi';

interface UseQuoteResult {
  quote: QuoteData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useQuote(symbol: string | null, autoRefresh = false): UseQuoteResult {
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentSymbolRef = useRef<string | null>(null);

  const fetchQuote = useCallback(async (symbolToFetch: string) => {
    setLoading(true);
    setError(null);

    try {
      const data = await getQuote(symbolToFetch);
      // Only update if this is still the current symbol (prevents race conditions)
      if (currentSymbolRef.current === symbolToFetch) {
        if (data) {
          setQuote(data);
        } else {
          setError(`No data found for ${symbolToFetch}`);
        }
      }
    } catch (err) {
      if (currentSymbolRef.current === symbolToFetch) {
        setError('Failed to fetch quote');
      }
    } finally {
      if (currentSymbolRef.current === symbolToFetch) {
        setLoading(false);
      }
    }
  }, []);

  // Debounced fetch - wait 500ms after user stops typing
  useEffect(() => {
    currentSymbolRef.current = symbol;

    if (!symbol) {
      setQuote(null);
      setLoading(false);
      return;
    }

    // Clear old quote immediately when symbol changes
    setQuote(null);
    setLoading(true);

    const timeoutId = setTimeout(() => {
      fetchQuote(symbol);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [symbol, fetchQuote]);

  // Auto-refresh every 60 seconds if enabled
  useEffect(() => {
    if (!autoRefresh || !symbol) return;

    const interval = setInterval(() => fetchQuote(symbol), 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, symbol, fetchQuote]);

  const refetch = useCallback(() => {
    if (symbol) {
      fetchQuote(symbol);
    }
  }, [symbol, fetchQuote]);

  return { quote, loading, error, refetch };
}

interface UseMultipleQuotesResult {
  quotes: Map<string, QuoteData>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useMultipleQuotes(
  symbols: string[],
  autoRefresh = false
): UseMultipleQuotesResult {
  const [quotes, setQuotes] = useState<Map<string, QuoteData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const symbolsRef = useRef(symbols);

  // Update ref when symbols change
  useEffect(() => {
    symbolsRef.current = symbols;
  }, [symbols]);

  const fetchQuotes = useCallback(async () => {
    const currentSymbols = symbolsRef.current;
    if (currentSymbols.length === 0) {
      setQuotes(new Map());
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getMultipleQuotes(currentSymbols);
      setQuotes(data);
    } catch (err) {
      setError('Failed to fetch quotes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuotes();
  }, [symbols.join(','), fetchQuotes]);

  // Auto-refresh every 60 seconds if enabled
  useEffect(() => {
    if (!autoRefresh || symbols.length === 0) return;

    const interval = setInterval(fetchQuotes, 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, symbols.length, fetchQuotes]);

  return { quotes, loading, error, refetch: fetchQuotes };
}

interface UseIntradayResult {
  data: IntradayData[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useIntradayData(
  symbol: string | null,
  interval: '1min' | '5min' | '15min' | '30min' | '60min' = '5min'
): UseIntradayResult {
  const [data, setData] = useState<IntradayData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!symbol) {
      setData([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use Binance for crypto symbols
      if (isCryptoSymbol(symbol)) {
        const binanceData = await getBinanceCandles(symbol, interval, 100);
        // Convert to IntradayData format
        const result: IntradayData[] = binanceData.map((d) => ({
          timestamp: d.date instanceof Date
            ? d.date.toISOString().replace('T', ' ').slice(0, 16)
            : String(d.date),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume,
        }));
        setData(result);
      } else {
        const result = await getIntradayData(symbol, interval);
        setData(result);
      }
    } catch (err) {
      setError('Failed to fetch intraday data');
    } finally {
      setLoading(false);
    }
  }, [symbol, interval]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

interface UseDailyResult {
  data: IntradayData[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDailyData(
  symbol: string | null,
  outputSize: 'compact' | 'full' = 'compact'
): UseDailyResult {
  const [data, setData] = useState<IntradayData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!symbol) {
      setData([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use Binance for crypto symbols
      if (isCryptoSymbol(symbol)) {
        // Get more candles for full output size
        const limit = outputSize === 'full' ? 365 : 100;
        const binanceData = await getBinanceCandles(symbol, '1d', limit);
        // Convert to IntradayData format
        const result: IntradayData[] = binanceData.map((d) => ({
          timestamp: d.date instanceof Date
            ? d.date.toISOString().split('T')[0]
            : String(d.date).split('T')[0],
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume,
        }));
        setData(result);
      } else {
        const result = await getDailyData(symbol, outputSize);
        setData(result);
      }
    } catch (err) {
      setError('Failed to fetch daily data');
    } finally {
      setLoading(false);
    }
  }, [symbol, outputSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

interface UseSymbolSearchResult {
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  search: (query: string) => void;
}

export function useSymbolSearch(): UseSymbolSearchResult {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    if (!query || query.length < 1) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await searchSymbol(query);
      setResults(data);
    } catch (err) {
      setError('Failed to search symbols');
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, loading, error, search };
}
