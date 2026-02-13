#!/usr/bin/env npx tsx
/**
 * Download Historical Data Script
 * Downloads real price data from Yahoo Finance and saves locally
 * Run once, then backtesting uses local data (no more API calls!)
 *
 * Usage: npx tsx scripts/downloadHistoricalData.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Stocks to download - major liquid stocks that existed since 2013
const STOCKS = [
  // Tech
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'INTC', 'ORCL', 'CSCO', 'IBM', 'ADBE', 'CRM', 'AMD',
  // Financials
  'JPM', 'BAC', 'GS', 'WFC', 'C', 'MS', 'BLK', 'AXP',
  // Healthcare
  'JNJ', 'PFE', 'MRK', 'ABT', 'UNH', 'LLY', 'TMO',
  // Consumer
  'KO', 'PEP', 'WMT', 'HD', 'MCD', 'NKE', 'PG', 'COST', 'TGT', 'SBUX',
  // Energy
  'XOM', 'CVX', 'COP',
  // Industrial
  'GE', 'CAT', 'MMM', 'BA', 'HON', 'UPS',
  // Other
  'DIS', 'NFLX', 'TSLA', 'V', 'MA', 'PYPL',
];

// Years to download: 2013 through current (Feb 2026)
const START_YEAR = 2013;
const END_YEAR = 2026;

interface PriceData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function downloadSymbol(symbol: string): Promise<Record<number, PriceData[]>> {
  // Yahoo Finance chart API - get all data at once
  const startTimestamp = Math.floor(new Date(`${START_YEAR}-01-01`).getTime() / 1000);
  const endTimestamp = Math.floor(new Date('2026-02-12').getTime() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startTimestamp}&period2=${endTimestamp}&interval=1d&events=history`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.error(`  HTTP ${response.status} for ${symbol}`);
      return {};
    }

    const json = await response.json();
    const result = json.chart?.result?.[0];

    if (!result || !result.timestamp) {
      console.error(`  No data for ${symbol}`);
      return {};
    }

    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    const adjClose = result.indicators?.adjclose?.[0]?.adjclose;

    if (!quote) {
      return {};
    }

    // Group by year
    const byYear: Record<number, PriceData[]> = {};

    for (let i = 0; i < timestamps.length; i++) {
      const date = new Date(timestamps[i] * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const year = date.getFullYear();

      // Skip if any price is null/undefined
      if (quote.open[i] == null || quote.high[i] == null ||
          quote.low[i] == null || quote.close[i] == null) {
        continue;
      }

      // Use adjusted close if available for accurate backtesting (accounts for splits/dividends)
      const close = adjClose?.[i] ?? quote.close[i];
      // Adjust OHLC proportionally based on adjustment factor
      const adjFactor = adjClose?.[i] ? adjClose[i] / quote.close[i] : 1;

      if (!byYear[year]) {
        byYear[year] = [];
      }

      byYear[year].push({
        timestamp: dateStr,
        open: Math.round(quote.open[i] * adjFactor * 100) / 100,
        high: Math.round(quote.high[i] * adjFactor * 100) / 100,
        low: Math.round(quote.low[i] * adjFactor * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.round(quote.volume[i] || 0),
      });
    }

    return byYear;
  } catch (error: any) {
    console.error(`  Error: ${error.message}`);
    return {};
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Yahoo Finance Historical Data Downloader');
  console.log('='.repeat(60));
  console.log(`Stocks: ${STOCKS.length}`);
  console.log(`Period: ${START_YEAR} - ${END_YEAR}`);
  console.log('');

  const allData: Record<string, Record<number, PriceData[]>> = {};
  let totalDays = 0;
  let stocksDownloaded = 0;

  for (const symbol of STOCKS) {
    process.stdout.write(`Downloading ${symbol}... `);

    const symbolData = await downloadSymbol(symbol);
    const years = Object.keys(symbolData).map(Number).sort();

    if (years.length > 0) {
      allData[symbol] = symbolData;
      const days = Object.values(symbolData).reduce((sum, arr) => sum + arr.length, 0);
      totalDays += days;
      stocksDownloaded++;
      console.log(`${days} days (${years[0]}-${years[years.length - 1]})`);
    } else {
      console.log('no data');
    }

    // Small delay to be nice to Yahoo
    await new Promise(r => setTimeout(r, 100));
  }

  // Save to file
  const outputPath = path.join(__dirname, '..', 'src', 'data', 'yahooHistorical.json');
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(allData));

  // Also create a TypeScript wrapper for type safety
  const tsPath = path.join(__dirname, '..', 'src', 'data', 'yahooHistorical.ts');
  const tsContent = `// Auto-generated - DO NOT EDIT
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
`;
  fs.writeFileSync(tsPath, tsContent);

  console.log('');
  console.log('='.repeat(60));
  console.log('Download complete!');
  console.log(`Stocks: ${stocksDownloaded}/${STOCKS.length}`);
  console.log(`Total days: ${totalDays.toLocaleString()}`);
  console.log(`File size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Saved to: ${outputPath}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
