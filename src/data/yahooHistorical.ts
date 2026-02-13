// Auto-generated - DO NOT EDIT
// Run: npx tsx scripts/downloadHistoricalData.ts to regenerate

import type { IntradayData } from '../services/alphaVantage';
import rawData from './yahooHistorical.json';

export const YAHOO_HISTORICAL: Record<string, Record<number, IntradayData[]>> = rawData as any;

export function getYahooHistoricalData(symbol: string, year: number): IntradayData[] | null {
  return YAHOO_HISTORICAL[symbol]?.[year] || null;
}

export function getYahooAvailableYears(symbol: string): number[] {
  const data = YAHOO_HISTORICAL[symbol];
  if (!data) return [];
  return Object.keys(data).map(Number).sort();
}

export function getYahooSymbolsForYear(year: number): string[] {
  return Object.entries(YAHOO_HISTORICAL)
    .filter(([_, years]) => year in years)
    .map(([symbol]) => symbol);
}

export default YAHOO_HISTORICAL;
