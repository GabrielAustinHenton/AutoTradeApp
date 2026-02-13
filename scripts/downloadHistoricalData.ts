#!/usr/bin/env npx tsx
/**
 * Download Historical Data Script
 * Run this when Tiingo rate limit resets to cache historical data
 *
 * Usage: npx tsx scripts/downloadHistoricalData.ts
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const TIINGO_API_KEY = process.env.VITE_TIINGO_API_KEY || '2fd88f3d5c641166864fa08c2eed31f4f8eddb40';

const HISTORICAL_STOCKS = [
  'AAPL', 'MSFT', 'INTC', 'ORCL', 'CSCO', 'IBM', 'HPQ',
  'JPM', 'BAC', 'GS', 'WFC', 'C',
  'JNJ', 'PFE', 'MRK', 'ABT',
  'KO', 'PEP', 'WMT', 'HD', 'MCD', 'NKE', 'PG',
  'XOM', 'CVX',
  'GE', 'CAT', 'MMM', 'BA',
  'DIS'
];

const YEARS_TO_DOWNLOAD = [2007, 2008, 2009, 2010, 2011, 2012];

interface PriceData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function downloadSymbolYear(symbol: string, year: number): Promise<PriceData[]> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const url = `https://api.tiingo.com/tiingo/daily/${symbol.toLowerCase()}/prices`;

  try {
    const response = await axios.get(url, {
      params: {
        startDate,
        endDate,
        token: TIINGO_API_KEY,
      },
    });

    if (!response.data || !Array.isArray(response.data)) {
      return [];
    }

    return response.data.map((d: any) => ({
      timestamp: d.date.split('T')[0],
      open: d.adjOpen || d.open,
      high: d.adjHigh || d.high,
      low: d.adjLow || d.low,
      close: d.adjClose || d.close,
      volume: d.adjVolume || d.volume || 0,
    }));
  } catch (error: any) {
    if (error.response?.status === 429 || error.response?.data?.detail?.includes('hourly request')) {
      console.error(`Rate limit hit! Wait 1 hour and try again.`);
      process.exit(1);
    }
    console.error(`Error downloading ${symbol} ${year}:`, error.message);
    return [];
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Historical Data Downloader');
  console.log('='.repeat(60));
  console.log(`Symbols: ${HISTORICAL_STOCKS.length}`);
  console.log(`Years: ${YEARS_TO_DOWNLOAD.join(', ')}`);
  console.log('');

  const allData: Record<string, Record<number, PriceData[]>> = {};
  let totalDays = 0;

  for (const symbol of HISTORICAL_STOCKS) {
    allData[symbol] = {};

    for (const year of YEARS_TO_DOWNLOAD) {
      process.stdout.write(`Downloading ${symbol} ${year}... `);

      const data = await downloadSymbolYear(symbol, year);
      if (data.length > 0) {
        allData[symbol][year] = data;
        totalDays += data.length;
        console.log(`${data.length} days`);
      } else {
        console.log('no data');
      }

      // Rate limit: wait 200ms between requests
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Save to file
  const outputPath = path.join(__dirname, '..', 'src', 'data', 'historicalData.json');
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(allData, null, 2));

  console.log('');
  console.log('='.repeat(60));
  console.log(`Download complete!`);
  console.log(`Total: ${totalDays} days of data`);
  console.log(`Saved to: ${outputPath}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
