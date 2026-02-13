/**
 * Historical Stock Data Generator (1996-2012)
 * Generates realistic price data based on actual market patterns
 *
 * Key historical events modeled:
 * - 1996-1999: Dot-com boom
 * - 2000-2002: Dot-com bust
 * - 2003-2007: Housing bubble / recovery
 * - 2008-2009: Financial crisis
 * - 2010-2012: Recovery
 */

import type { IntradayData } from '../services/alphaVantage';

// Market regime definitions for each year
const MARKET_REGIMES: Record<number, { trend: number; volatility: number; description: string }> = {
  1996: { trend: 0.0008, volatility: 0.012, description: 'Bull market' },
  1997: { trend: 0.0010, volatility: 0.015, description: 'Strong bull' },
  1998: { trend: 0.0012, volatility: 0.020, description: 'Dot-com acceleration' },
  1999: { trend: 0.0015, volatility: 0.025, description: 'Dot-com peak' },
  2000: { trend: -0.0005, volatility: 0.030, description: 'Dot-com bust begins' },
  2001: { trend: -0.0008, volatility: 0.025, description: 'Recession + 9/11' },
  2002: { trend: -0.0006, volatility: 0.022, description: 'Bear market bottom' },
  2003: { trend: 0.0008, volatility: 0.015, description: 'Recovery begins' },
  2004: { trend: 0.0005, volatility: 0.012, description: 'Steady growth' },
  2005: { trend: 0.0004, volatility: 0.010, description: 'Low volatility' },
  2006: { trend: 0.0006, volatility: 0.012, description: 'Housing peak' },
  2007: { trend: 0.0003, volatility: 0.015, description: 'Pre-crisis' },
  2008: { trend: -0.0015, volatility: 0.040, description: 'Financial crisis' },
  2009: { trend: 0.0008, volatility: 0.030, description: 'Recovery rally' },
  2010: { trend: 0.0005, volatility: 0.018, description: 'Gradual recovery' },
  2011: { trend: 0.0001, volatility: 0.022, description: 'Debt ceiling crisis' },
  2012: { trend: 0.0005, volatility: 0.015, description: 'Stable growth' },
};

// Stocks that existed in each era with approximate starting prices
const STOCK_HISTORY: Record<string, { startYear: number; startPrice: number; sector: string }> = {
  // Tech - existed since 1990s
  AAPL: { startYear: 1996, startPrice: 5, sector: 'tech' },  // Split-adjusted
  MSFT: { startYear: 1996, startPrice: 10, sector: 'tech' },
  INTC: { startYear: 1996, startPrice: 8, sector: 'tech' },
  ORCL: { startYear: 1996, startPrice: 4, sector: 'tech' },
  CSCO: { startYear: 1996, startPrice: 3, sector: 'tech' },
  IBM: { startYear: 1996, startPrice: 50, sector: 'tech' },
  HPQ: { startYear: 1996, startPrice: 20, sector: 'tech' },

  // Financials
  JPM: { startYear: 1996, startPrice: 25, sector: 'financial' },
  BAC: { startYear: 1996, startPrice: 15, sector: 'financial' },
  GS: { startYear: 1999, startPrice: 55, sector: 'financial' },  // IPO 1999
  WFC: { startYear: 1996, startPrice: 12, sector: 'financial' },
  C: { startYear: 1998, startPrice: 20, sector: 'financial' },

  // Healthcare
  JNJ: { startYear: 1996, startPrice: 25, sector: 'defensive' },
  PFE: { startYear: 1996, startPrice: 12, sector: 'defensive' },
  MRK: { startYear: 1996, startPrice: 35, sector: 'defensive' },
  ABT: { startYear: 1996, startPrice: 22, sector: 'defensive' },

  // Consumer Defensive
  KO: { startYear: 1996, startPrice: 25, sector: 'defensive' },
  PEP: { startYear: 1996, startPrice: 28, sector: 'defensive' },
  WMT: { startYear: 1996, startPrice: 12, sector: 'defensive' },
  PG: { startYear: 1996, startPrice: 45, sector: 'defensive' },
  MCD: { startYear: 1996, startPrice: 22, sector: 'defensive' },

  // Consumer Cyclical
  HD: { startYear: 1996, startPrice: 8, sector: 'consumer' },
  NKE: { startYear: 1996, startPrice: 10, sector: 'consumer' },
  DIS: { startYear: 1996, startPrice: 30, sector: 'consumer' },

  // Energy
  XOM: { startYear: 1996, startPrice: 25, sector: 'energy' },
  CVX: { startYear: 1996, startPrice: 28, sector: 'energy' },

  // Industrial
  GE: { startYear: 1996, startPrice: 18, sector: 'industrial' },
  CAT: { startYear: 1996, startPrice: 30, sector: 'industrial' },
  MMM: { startYear: 1996, startPrice: 40, sector: 'industrial' },
  BA: { startYear: 1996, startPrice: 45, sector: 'industrial' },
};

// Sector-specific volatility multipliers
const SECTOR_VOLATILITY: Record<string, number> = {
  tech: 1.5,
  financial: 1.3,
  defensive: 0.7,
  consumer: 1.0,
  energy: 1.2,
  industrial: 1.1,
};

// Generate trading days for a year
function generateTradingDays(year: number): string[] {
  const days: string[] = [];
  const start = new Date(`${year}-01-02`);
  const end = new Date(`${year}-12-31`);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

// Generate price data for a stock/year
function generateYearData(
  symbol: string,
  year: number,
  startPrice: number,
  sector: string
): IntradayData[] {
  const regime = MARKET_REGIMES[year];
  if (!regime) return [];

  const days = generateTradingDays(year);
  const data: IntradayData[] = [];
  const sectorMult = SECTOR_VOLATILITY[sector] || 1.0;

  let price = startPrice;

  // Seed random based on symbol+year for reproducibility
  const seed = (symbol.charCodeAt(0) * 1000 + year) % 1000;
  let random = seed;
  const nextRandom = () => {
    random = (random * 9301 + 49297) % 233280;
    return random / 233280;
  };

  for (const date of days) {
    const month = parseInt(date.split('-')[1]);

    // Add monthly variations
    let monthlyAdj = 0;
    if (year === 2008 && month >= 9) {
      // 2008 crisis intensifies Sep-Nov
      monthlyAdj = month === 10 ? -0.003 : month === 9 ? -0.002 : -0.001;
    } else if (year === 2001 && month === 9) {
      // 9/11
      monthlyAdj = -0.005;
    } else if (year === 2000 && month >= 3) {
      // Dot-com bust March 2000
      monthlyAdj = -0.001;
    }

    const baseVol = regime.volatility * sectorMult;
    const dailyReturn = regime.trend + monthlyAdj + (nextRandom() - 0.5) * baseVol * 2;

    const open = price;
    const close = price * (1 + dailyReturn);
    const intradayVol = baseVol * 1.5;
    const high = Math.max(open, close) * (1 + nextRandom() * intradayVol);
    const low = Math.min(open, close) * (1 - nextRandom() * intradayVol);

    data.push({
      timestamp: date,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume: Math.floor(5000000 + nextRandom() * 30000000),
    });

    price = close;
  }

  return data;
}

// Main data structure: symbol -> year -> data
export const HISTORICAL_DATA: Record<string, Record<number, IntradayData[]>> = {};

// Track ending prices for continuity
const endingPrices: Record<string, number> = {};

// Generate all historical data
for (const [symbol, info] of Object.entries(STOCK_HISTORY)) {
  HISTORICAL_DATA[symbol] = {};
  let currentPrice = info.startPrice;

  for (let year = info.startYear; year <= 2012; year++) {
    if (!MARKET_REGIMES[year]) continue;

    const yearData = generateYearData(symbol, year, currentPrice, info.sector);
    if (yearData.length > 0) {
      HISTORICAL_DATA[symbol][year] = yearData;
      currentPrice = yearData[yearData.length - 1].close;
    }
  }

  endingPrices[symbol] = currentPrice;
}

// Helper to get data for a specific symbol/year
export function getHistoricalData(symbol: string, year: number): IntradayData[] | null {
  return HISTORICAL_DATA[symbol]?.[year] || null;
}

// Get list of available years for a symbol
export function getAvailableYears(symbol: string): number[] {
  const data = HISTORICAL_DATA[symbol];
  if (!data) return [];
  return Object.keys(data).map(Number).sort();
}

// Get all symbols available for a year
export function getSymbolsForYear(year: number): string[] {
  return Object.entries(HISTORICAL_DATA)
    .filter(([_, years]) => year in years)
    .map(([symbol]) => symbol);
}

// Legacy export for backwards compatibility
export const HISTORICAL_DATA_2008 = Object.fromEntries(
  Object.entries(HISTORICAL_DATA)
    .filter(([_, years]) => 2008 in years)
    .map(([symbol, years]) => [symbol, years[2008]])
);

export default HISTORICAL_DATA;

