import { alpaca } from './alpaca';
import type { MarketRegime } from '../types';

export async function checkMarketRegime(isPaper: boolean): Promise<{
  regime: MarketRegime;
  spyPrice: number;
  sma200: number;
}> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 300);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  const bars = await alpaca.getHistoricalBars(
    isPaper,
    'SPY',
    formatDate(startDate),
    formatDate(endDate),
  );

  const closes = bars.map((b) => b.close);
  const spyPrice = closes[closes.length - 1];

  const last200 = closes.slice(-200);
  const sma200 = last200.reduce((sum, c) => sum + c, 0) / 200;

  const regime: MarketRegime = spyPrice > sma200 ? 'bullish' : 'bearish';

  return { regime, spyPrice, sma200 };
}
