// Historical Data Cache Service
// Caches downloaded historical data in localStorage to avoid rate limits

import type { IntradayData } from './alphaVantage';

const CACHE_KEY_PREFIX = 'historical_data_';
const CACHE_VERSION = 'v1';

interface CachedData {
  version: string;
  symbol: string;
  year: number;
  data: IntradayData[];
  cachedAt: string;
}

// Get cached data for a symbol/year
export function getCachedData(symbol: string, year: number): IntradayData[] | null {
  try {
    const key = `${CACHE_KEY_PREFIX}${symbol.toUpperCase()}_${year}_${CACHE_VERSION}`;
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const parsed: CachedData = JSON.parse(cached);
    if (parsed.version !== CACHE_VERSION) return null;

    console.log(`[CACHE] Hit: ${symbol} ${year} (${parsed.data.length} days, cached ${parsed.cachedAt})`);
    return parsed.data;
  } catch (e) {
    return null;
  }
}

// Save data to cache
export function setCachedData(symbol: string, year: number, data: IntradayData[]): void {
  try {
    const key = `${CACHE_KEY_PREFIX}${symbol.toUpperCase()}_${year}_${CACHE_VERSION}`;
    const cacheEntry: CachedData = {
      version: CACHE_VERSION,
      symbol: symbol.toUpperCase(),
      year,
      data,
      cachedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(cacheEntry));
    console.log(`[CACHE] Saved: ${symbol} ${year} (${data.length} days)`);
  } catch (e) {
    console.warn(`[CACHE] Failed to save ${symbol} ${year}:`, e);
  }
}

// Clear all cached data
export function clearCache(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_KEY_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
  console.log(`[CACHE] Cleared ${keysToRemove.length} cached items`);
}

// Get cache stats
export function getCacheStats(): { symbols: string[]; totalDays: number; sizeKB: number } {
  const symbols = new Set<string>();
  let totalDays = 0;
  let totalSize = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_KEY_PREFIX)) {
      const value = localStorage.getItem(key);
      if (value) {
        totalSize += value.length;
        try {
          const parsed: CachedData = JSON.parse(value);
          symbols.add(parsed.symbol);
          totalDays += parsed.data.length;
        } catch (e) {}
      }
    }
  }

  return {
    symbols: Array.from(symbols),
    totalDays,
    sizeKB: Math.round(totalSize / 1024),
  };
}

// Import pre-downloaded data (for bulk loading)
export function importHistoricalData(jsonData: Record<string, Record<number, IntradayData[]>>): number {
  let count = 0;
  for (const [symbol, years] of Object.entries(jsonData)) {
    for (const [yearStr, data] of Object.entries(years)) {
      const year = parseInt(yearStr);
      setCachedData(symbol, year, data);
      count++;
    }
  }
  console.log(`[CACHE] Imported ${count} symbol/year combinations`);
  return count;
}
